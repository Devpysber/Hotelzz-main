'use strict';
/**
 * Ad-platform fulfilment.
 *
 * `launch()` pushes a paid campaign to Meta (and Google, when a search package
 * is bought); `syncMetrics()` pulls spend/impressions/clicks back so owner and
 * admin dashboards show real numbers.
 *
 * Both platforms are optional. With no credentials the adapters report
 * `configured: false`, the campaign stays in Pending for the marketing team to
 * run by hand, and nothing else in the system changes. That keeps the manual
 * workflow the business runs today as the default, not an error path.
 */
const env = require('./env');
const { db, uid, audit } = require('./db');
const { sendMailAsync } = require('./mailer');

const META_VERSION = 'v21.0';
const GOOGLE_VERSION = 'v18';

function event(campaignId, title, description) {
  db.prepare('INSERT INTO campaign_events (id, campaign_id, title, description) VALUES (?,?,?,?)')
    .run(uid('cev'), campaignId, title, description || null);
}

async function callJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
  if (!res.ok) {
    const message = (body.error && (body.error.message || body.error.error_user_msg)) ||
                    body.raw || ('HTTP ' + res.status);
    throw new Error(message);
  }
  return body;
}

/* -------------------------------------------------------------------- Meta */

const meta = {
  name: 'meta',
  configured: () => env.metaAdsConfigured,

  /** Creates a paused campaign; Meta reviews it before anything can spend. */
  async create(campaign, details) {
    const account = env.META_AD_ACCOUNT_ID.startsWith('act_')
      ? env.META_AD_ACCOUNT_ID
      : 'act_' + env.META_AD_ACCOUNT_ID;

    const body = new URLSearchParams({
      name: campaign.name,
      objective: 'OUTCOME_LEADS',
      status: 'PAUSED',
      special_ad_categories: '[]',
      daily_budget: String(Math.max(Math.round((details.total || campaign.budget) * 100 / Math.max(details.totalDays || 30, 1)), 10000)),
      access_token: env.META_ACCESS_TOKEN
    });

    const created = await callJson(
      `https://graph.facebook.com/${META_VERSION}/${account}/campaigns`,
      { method: 'POST', body }
    );
    return { externalId: created.id, status: 'PAUSED' };
  },

  async metrics(externalId) {
    const url = `https://graph.facebook.com/${META_VERSION}/${externalId}/insights` +
                `?fields=impressions,clicks,spend,actions&access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`;
    const body = await callJson(url, { method: 'GET' });
    const row = (body.data && body.data[0]) || {};
    const leads = (row.actions || []).find((a) => a.action_type === 'lead');
    return {
      impressions: parseInt(row.impressions, 10) || 0,
      clicks: parseInt(row.clicks, 10) || 0,
      spend: parseFloat(row.spend) || 0,
      leads: leads ? parseInt(leads.value, 10) : 0
    };
  }
};

/* ------------------------------------------------------------ Google Ads */

const google = {
  name: 'google',
  configured: () => env.googleAdsConfigured,

  async create(campaign, details) {
    const customer = String(env.GOOGLE_ADS_CUSTOMER_ID).replace(/-/g, '');
    const budget = await callJson(
      `https://googleads.googleapis.com/${GOOGLE_VERSION}/customers/${customer}/campaignBudgets:mutate`,
      {
        method: 'POST',
        headers: authHeaders(customer),
        body: JSON.stringify({
          operations: [{
            create: {
              name: `${campaign.name} budget ${Date.now()}`,
              // Google Ads money fields are micros.
              amountMicros: String(Math.round(((details.total || campaign.budget) / Math.max(details.totalDays || 30, 1)) * 1e6)),
              deliveryMethod: 'STANDARD'
            }
          }]
        })
      }
    );

    const created = await callJson(
      `https://googleads.googleapis.com/${GOOGLE_VERSION}/customers/${customer}/campaigns:mutate`,
      {
        method: 'POST',
        headers: authHeaders(customer),
        body: JSON.stringify({
          operations: [{
            create: {
              name: campaign.name,
              status: 'PAUSED',
              advertisingChannelType: 'SEARCH',
              campaignBudget: budget.results[0].resourceName,
              manualCpc: {}
            }
          }]
        })
      }
    );
    return { externalId: created.results[0].resourceName, status: 'PAUSED' };
  },

  async metrics(externalId) {
    const customer = String(env.GOOGLE_ADS_CUSTOMER_ID).replace(/-/g, '');
    const body = await callJson(
      `https://googleads.googleapis.com/${GOOGLE_VERSION}/customers/${customer}/googleAds:search`,
      {
        method: 'POST',
        headers: authHeaders(customer),
        body: JSON.stringify({
          query: `SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
                    FROM campaign WHERE campaign.resource_name = '${externalId}'`
        })
      }
    );
    const m = (body.results && body.results[0] && body.results[0].metrics) || {};
    return {
      impressions: parseInt(m.impressions, 10) || 0,
      clicks: parseInt(m.clicks, 10) || 0,
      spend: (parseInt(m.costMicros, 10) || 0) / 1e6,
      leads: Math.round(parseFloat(m.conversions) || 0)
    };
  }
};

function authHeaders(customer) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + env.GOOGLE_ADS_ACCESS_TOKEN,
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'login-customer-id': customer
  };
}

/* ------------------------------------------------------------- orchestration */

/** Picks the platform a package should run on. */
function adapterFor(details) {
  if (details.packageId === 'pkg-website') return google;
  return meta;
}

function status() {
  return {
    meta: { configured: meta.configured() },
    google: { configured: google.configured() },
    mode: (meta.configured() || google.configured()) ? 'api' : 'manual'
  };
}

/**
 * Pushes one campaign to its ad platform. Safe to call more than once: a
 * campaign that already holds an externalId is left alone.
 */
async function launch(campaignId) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error('Campaign not found: ' + campaignId);

  const details = JSON.parse(campaign.details || '{}');
  if (details.externalId) return { ok: true, alreadyLaunched: true, externalId: details.externalId };

  const adapter = adapterFor(details);
  if (!adapter.configured()) {
    event(campaignId, 'Awaiting manual setup',
          `No ${adapter.name} credentials configured — the Hotelzz marketing team runs this campaign by hand.`);
    return { ok: true, mode: 'manual', platform: adapter.name };
  }

  try {
    const created = await adapter.create(campaign, details);
    details.externalId = created.externalId;
    details.platform = adapter.name;

    db.prepare(
      `UPDATE campaigns SET details = ?, channel = ?, status = 'Active', updated_at = datetime('now')
        WHERE id = ?`
    ).run(JSON.stringify(details), adapter.name, campaignId);

    event(campaignId, 'Submitted to ' + adapter.name,
          `Created as ${created.externalId}, paused pending platform review.`);
    audit(campaign.owner_id, 'campaign.launch', 'campaign', campaignId,
          { platform: adapter.name, externalId: created.externalId }, null);

    const owner = campaign.owner_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(campaign.owner_id) : null;
    if (owner) {
      sendMailAsync(owner.email, 'campaignStatus', {
        name: owner.name, campaignId, campaign: campaign.name, status: 'Active',
        note: `Your ads are with ${adapter.name} for review and go live once approved.`
      });
    }
    return { ok: true, mode: 'api', platform: adapter.name, externalId: created.externalId };
  } catch (err) {
    event(campaignId, 'Platform submission failed', err.message);
    audit(campaign.owner_id, 'campaign.launch.failed', 'campaign', campaignId, { error: err.message }, null);
    sendMailAsync(env.ADMIN_EMAIL, 'adminNewLead', {
      name: 'Ad platform error', hotelName: campaign.name, plan: adapter.name,
      message: `Campaign ${campaignId} could not be created: ${err.message}`
    });
    return { ok: false, error: err.message, platform: adapter.name };
  }
}

/** Pulls fresh spend/impressions/clicks for every live campaign. */
async function syncMetrics() {
  const rows = db.prepare("SELECT * FROM campaigns WHERE status = 'Active'").all();
  let synced = 0;

  for (const campaign of rows) {
    const details = JSON.parse(campaign.details || '{}');
    if (!details.externalId) continue;
    const adapter = details.platform === 'google' ? google : meta;
    if (!adapter.configured()) continue;

    try {
      const m = await adapter.metrics(details.externalId);
      db.prepare(
        `UPDATE campaigns SET impressions = ?, clicks = ?, spend = ?, leads_count = ?,
                updated_at = datetime('now') WHERE id = ?`
      ).run(m.impressions, m.clicks, m.spend, m.leads, campaign.id);
      synced++;
    } catch (err) {
      console.error('[ads] metrics failed for', campaign.id, err.message);
    }
  }
  return synced;
}

module.exports = { launch, syncMetrics, status, adapters: { meta, google } };

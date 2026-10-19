/**
 * Hotelzz Admin — Site Kit (SEO + AEO).
 * Overview, Google Search Console / GA4 data, live site audit, listing
 * quality, AEO answers, per-page titles, redirects and connections.
 * Talks to /api/admin/sitekit (server/routes/sitekit.js).
 */
(function () {
  var API = window.HotelzzAPI;
  var state = { data: null, audit: null, content: null, google: null, days: 28, tab: 'overview', issue: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function fail(err) { toast((err && err.message) || 'Something went wrong.', 'danger'); }
  function $(id) { return document.getElementById(id); }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function pct(n) { return (Number(n || 0) * 100).toFixed(1) + '%'; }
  function pane(name) { return $('skPane-' + name); }
  function when(iso) { if (!iso) return 'never'; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
  function chip(on, yes, no) { return '<span class="badge ' + (on ? 'badge-success' : 'badge-warning') + '">' + (on ? (yes || 'Connected') : (no || 'Not set up')) + '</span>'; }
  function card(title, sub, body, extra) {
    return '<div class="admin-card sk-card"' + (extra || '') + '><div class="sk-card-head"><div><div class="card-title">' + title + '</div>' +
      (sub ? '<div class="card-subtitle">' + sub + '</div>' : '') + '</div></div>' + body + '</div>';
  }

  window.initSiteKitView = function () { load().then(function () { skTabRender(state.tab); }); };

  function load() {
    return API.get('/admin/sitekit').then(function (r) { state.data = r; }).catch(fail);
  }

  window.skTab = function (name) {
    state.tab = name;
    document.querySelectorAll('#skTabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-sk') === name); b.setAttribute('aria-selected', b.getAttribute('data-sk') === name); });
    document.querySelectorAll('#view-sitekit .sk-pane').forEach(function (p) { p.classList.toggle('active', p.id === 'skPane-' + name); });
    if (state.data) skTabRender(name);
  };

  function skTabRender(name) {
    ({ overview: renderOverview, search: renderSearch, audit: renderAudit, content: renderContent, aeo: renderAeo,
       pages: renderPages, redirects: renderRedirects, connections: renderConnections }[name] || renderOverview)();
  }

  function save(patch, msg) {
    return API.put('/admin/sitekit', patch).then(function (r) {
      state.data.settings = r.settings;
      state.data.connections = r.connections;
      toast(msg || 'Saved. Live on the site now.');
      return r;
    });
  }

  window.skRefresh = function () {
    API.post('/admin/sitekit/refresh', {}).then(function () { toast('Sitemap, llms.txt and page caches rebuilt.'); return load(); })
      .then(function () { skTabRender(state.tab); }).catch(fail);
  };

  /* ------------------------------------------------------------ overview */

  function renderOverview() {
    var d = state.data, c = d.connections, s = d.settings, st = d.stats;
    var steps = [
      { done: c.searchConsole.verification || c.searchConsole.api, text: 'Verify hotelzz.in in Google Search Console', tab: 'connections' },
      { done: c.ga4.on, text: 'Google Analytics 4 tag on every public page', tab: 'connections' },
      { done: c.bing.on, text: 'Verify in Bing Webmaster Tools (feeds Bing, Copilot and ChatGPT search)', tab: 'connections' },
      { done: c.serviceAccount.configured, text: 'Connect Google data (Search Console + GA4 numbers inside this panel)', tab: 'search' },
      { done: !!s.lastIndexNowAt && /accepted/.test(s.lastIndexNowResult || ''), text: 'Ping IndexNow once so Bing and Yandex pick up every page', tab: 'overview' },
      { done: (s.org.sameAs || []).length > 0, text: 'Add social profiles (Instagram, Facebook, LinkedIn…) to the organisation', tab: 'connections' },
      { done: (s.faqs || []).length >= 5, text: 'Write at least 5 AEO answers for questions travellers and owners ask', tab: 'aeo' },
      { done: !!state.audit && state.audit.score >= 85, text: 'Site audit score of 85 or more', tab: 'audit' }
    ];
    var last = state.audit || s.lastAudit;
    steps[steps.length - 1].done = !!last && last.score >= 85;
    var done = steps.filter(function (x) { return x.done; }).length;
    var tiles = [
      ['SEO health', last ? last.score + '/100' : '—', last ? 'Last audit ' + when(last.ranAt) : 'Run the site audit', last ? (last.score >= 85 ? 'good' : last.score >= 65 ? 'ok' : 'bad') : ''],
      ['Indexable pages', num(st.indexablePages), num(st.cities) + ' cities · ' + num(st.listings) + ' hotels', ''],
      ['AEO answers', num(st.aeoAnswers), 'plus auto answers on every city & hotel page', ''],
      ['Listing views (28 days)', num(st.views28), num(st.leads28) + ' WhatsApp / call taps', ''],
      ['Setup', done + ' / ' + steps.length, done === steps.length ? 'All set' : 'steps done', done === steps.length ? 'good' : 'ok']
    ];
    var html = '<div class="sk-tiles">' + tiles.map(function (t) {
      return '<div class="admin-card sk-tile ' + t[3] + '"><div class="sk-tile-label">' + t[0] + '</div><div class="sk-tile-value">' + t[1] + '</div><div class="sk-tile-sub">' + esc(t[2]) + '</div></div>';
    }).join('') + '</div>';

    html += '<div class="sk-grid">';
    html += card('Setup checklist', 'What Google Site Kit would ask you to do — tick them off once.',
      '<ul class="sk-steps">' + steps.map(function (x) {
        return '<li class="' + (x.done ? 'done' : '') + '"><span class="sk-tick">' + (x.done ? '✓' : '') + '</span><span>' + esc(x.text) + '</span>' +
          (x.done ? '' : '<button class="btn-secondary sk-mini" onclick="skTab(\'' + x.tab + '\')">Set up</button>') + '</li>';
      }).join('') + '</ul>');

    html += card('Connected services', 'Tags are added to every public page by the server — no file edits needed.',
      '<div class="sk-conn">' +
        row('Google Analytics 4', chip(c.ga4.on, esc(c.ga4.value))) +
        row('Google Tag Manager', chip(c.gtm.on, esc(c.gtm.value), 'Optional')) +
        row('Search Console', chip(c.searchConsole.on, c.searchConsole.api ? 'Verified + data' : 'Verified')) +
        row('Bing Webmaster Tools', chip(c.bing.on, 'Verified')) +
        row('Meta Pixel', chip(c.metaPixel.on, esc(c.metaPixel.value), 'Optional')) +
        row('Google data in this panel', chip(c.serviceAccount.configured, 'Service account', 'Not connected')) +
        row('IndexNow', chip(true, s.autoIndexNow ? 'Auto, hourly' : 'Manual')) +
      '</div>');
    html += '</div>';

    html += '<div class="sk-grid">';
    html += card('Instant indexing (IndexNow)', 'Tells Bing, Yandex, Seznam and Naver about new or changed pages within minutes. Google reads the sitemap.',
      '<div class="sk-kv"><span>Last accepted</span><b>' + esc(when(s.lastIndexNowAt)) + '</b></div>' +
      '<div class="sk-kv"><span>Result</span><b>' + esc(s.lastIndexNowResult || '—') + '</b></div>' +
      '<div class="sk-kv"><span>Key file</span><a href="' + esc(d.links.indexNowKey) + '" target="_blank" rel="noopener">' + esc(d.links.indexNowKey.replace('https://', '')) + '</a></div>' +
      '<div class="sk-actions"><button class="btn-primary" onclick="skIndexNow(\'changed\')">Submit changed pages</button>' +
      '<button class="btn-secondary" onclick="skIndexNow(\'key\')">Submit all key pages</button></div>' +
      (d.env.production ? '' : '<p class="sk-note">This is a development server — IndexNow only runs on the live site.</p>'));

    html += card('Your SEO files', 'What search engines and AI assistants read first.',
      '<ul class="sk-links">' + [
        ['sitemap.xml', d.links.sitemap, (st.sitemapUrls ? num(st.sitemapUrls) + ' URLs' : 'built on first visit')],
        ['robots.txt', d.links.robots, 'crawl rules + AI crawlers'],
        ['llms.txt', d.links.llms, 'site summary for ChatGPT, Claude, Perplexity'],
        ['Search Console', d.links.searchConsole, 'Google'],
        ['Bing Webmaster', d.links.bing, 'Bing + Copilot'],
        ['Google Analytics', d.links.analytics, 'GA4'],
        ['PageSpeed Insights', d.links.pageSpeed, 'Core Web Vitals'],
        ['Rich Results Test', d.links.richResults, 'structured data']
      ].map(function (l) { return '<li><a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + ' ↗</a><span>' + esc(l[2]) + '</span></li>'; }).join('') + '</ul>' +
      (c.serviceAccount.configured ? '<div class="sk-actions"><button class="btn-secondary" onclick="skSubmitSitemap()">Submit sitemap to Google</button></div>' : ''));
    html += '</div>';

    if ((d.topViewed || []).length) {
      html += card('Most viewed hotels (28 days)', 'From Hotelzz\'s own listing stats — no Google account needed.',
        '<div class="table-responsive"><table class="admin-table"><thead><tr><th>Hotel</th><th>City</th><th>Views</th><th>WhatsApp / call taps</th></tr></thead><tbody>' +
        d.topViewed.map(function (p) {
          return '<tr><td><a href="property.html?id=' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener" style="font-weight:700;">' + esc(p.name) + '</a></td><td>' + esc(p.location || '') + '</td><td>' + num(p.views) + '</td><td>' + num(p.leads) + '</td></tr>';
        }).join('') + '</tbody></table></div>');
    }
    pane('overview').innerHTML = html;
  }

  function row(label, value) { return '<div class="sk-conn-row"><span>' + label + '</span>' + value + '</div>'; }

  window.skIndexNow = function (scope) {
    API.post('/admin/sitekit/indexnow', { scope: scope }).then(function (r) {
      toast(r.submitted ? r.submitted + ' URLs sent to IndexNow.' : (r.note || 'Nothing to send.'), r.skipped ? 'warning' : 'success');
      return load();
    }).catch(function (e) { fail(e); return load(); }).then(function () { if (state.tab === 'overview') renderOverview(); });
  };

  window.skSubmitSitemap = function () {
    API.post('/admin/sitekit/google/sitemap', {}).then(function () { toast('Sitemap submitted to Google Search Console.'); }).catch(fail);
  };

  /* --------------------------------------------------------------- search */

  function renderSearch() {
    var c = state.data.connections;
    if (!c.serviceAccount.configured) {
      pane('search').innerHTML = card('Connect Google data', 'See Search Console clicks, queries and GA4 traffic here, the way WordPress Site Kit does.',
        '<ol class="sk-howto">' +
          '<li>Open <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener">Google Cloud → Service accounts</a>, create one (any name), then <b>Keys → Add key → JSON</b>.</li>' +
          '<li>In the same project enable <a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank" rel="noopener">Search Console API</a> and <a href="https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com" target="_blank" rel="noopener">Google Analytics Data API</a>.</li>' +
          '<li>Upload the JSON to the server as <code>/var/www/hotelzz/google-service-account.json</code> and add <code>GOOGLE_SERVICE_ACCOUNT_FILE=/var/www/hotelzz/google-service-account.json</code> to <code>.env</code>, then <code>pm2 restart hotelzz</code>.</li>' +
          '<li>Search Console → Settings → Users and permissions → <b>Add user</b>: the service account email, permission <b>Full</b>.</li>' +
          '<li>GA4 → Admin → Property access management → add the same email as <b>Viewer</b>, and put the GA4 <b>property id</b> (a number) in Connections.</li>' +
        '</ol>' + (c.serviceAccount.error ? '<p class="sk-note">Status: ' + esc(c.serviceAccount.error) + '</p>' : ''));
      return;
    }
    pane('search').innerHTML = '<div class="sk-loading">Loading Google data…</div>';
    API.get('/admin/sitekit/google?days=' + state.days + (state.fresh ? '&fresh=1' : '')).then(function (g) { state.google = g; drawSearch(); }).catch(function (e) {
      pane('search').innerHTML = card('Google data', '', '<p class="sk-note">' + esc(e.message) + '</p>');
    });
  }

  window.skDays = function (d) { state.days = d; renderSearch(); };
  window.skReloadGoogle = function () { state.fresh = true; renderSearch(); state.fresh = false; };

  function drawSearch() {
    var g = state.google, html = '';
    html += '<div class="sk-range">' + [7, 28, 90].map(function (d) {
      return '<button class="' + (d === state.days ? 'active' : '') + '" onclick="skDays(' + d + ')">' + d + ' days</button>';
    }).join('') + '<button onclick="skReloadGoogle()">↻ Reload</button><span>Service account: ' + esc(g.status.email) + '</span></div>';

    if (g.search) {
      var t = g.search.totals;
      html += card('Google Search', esc(g.search.range.start) + ' → ' + esc(g.search.range.end) + ' (Search Console data lags ~2 days)',
        '<div class="sk-tiles sk-tiles-in">' + [['Clicks', num(t.clicks)], ['Impressions', num(t.impressions)], ['CTR', pct(t.ctr)], ['Avg. position', t.position ? t.position.toFixed(1) : '—']]
          .map(function (x) { return '<div class="sk-tile"><div class="sk-tile-label">' + x[0] + '</div><div class="sk-tile-value">' + x[1] + '</div></div>'; }).join('') + '</div>' +
        lineChart(g.search.daily, [{ key: 'clicks', label: 'Clicks', color: '#2563EB' }, { key: 'impressions', label: 'Impressions', color: '#7C3AED', own: true }]) +
        '<div class="sk-grid">' + table('Top searches', ['Query', 'Clicks', 'Impr.', 'Pos.'], g.search.queries, function (r) { return [esc(r.key), num(r.clicks), num(r.impressions), r.position.toFixed(1)]; }) +
        table('Top pages', ['Page', 'Clicks', 'Impr.', 'CTR'], g.search.pages, function (r) { return ['<a href="' + esc(r.key) + '" target="_blank" rel="noopener">' + esc(r.key.replace(/^https?:\/\/[^/]+/, '')) + '</a>', num(r.clicks), num(r.impressions), pct(r.ctr)]; }) + '</div>');
    } else {
      html += card('Google Search', '', '<p class="sk-note">' + esc(g.searchError || 'No data') + ' — check that the service account is a user on the Search Console property <b>' + esc(state.data.settings.gscSiteUrl) + '</b>.</p>');
    }
    if ((g.sitemaps || []).length) {
      html += card('Sitemaps in Search Console', '', table('', ['Sitemap', 'Submitted', 'Last read by Google', 'Errors'], g.sitemaps, function (s) {
        return [esc(s.path), num(s.submitted) + ' URLs', esc(when(s.lastDownloaded)), s.errors ? '<span class="badge badge-danger">' + s.errors + '</span>' : '0'];
      }));
    }
    if (g.analytics) {
      var a = g.analytics.totals;
      html += card('Google Analytics 4', 'Visitors to hotelzz.in',
        '<div class="sk-tiles sk-tiles-in">' + [['Users', num(a.users)], ['Sessions', num(a.sessions)], ['Page views', num(a.views)], ['Engagement', pct(a.engagement)]]
          .map(function (x) { return '<div class="sk-tile"><div class="sk-tile-label">' + x[0] + '</div><div class="sk-tile-value">' + x[1] + '</div></div>'; }).join('') + '</div>' +
        lineChart(g.analytics.daily, [{ key: 'users', label: 'Users', color: '#059669' }, { key: 'views', label: 'Page views', color: '#D97706', own: true }]) +
        '<div class="sk-grid">' + table('Top pages', ['Page', 'Views', 'Users'], g.analytics.pages, function (r) { return [esc(r.path), num(r.views), num(r.users)]; }) +
        table('Traffic sources', ['Channel', 'Sessions'], g.analytics.sources, function (r) { return [esc(r.channel), num(r.sessions)]; }) + '</div>');
    } else {
      html += card('Google Analytics 4', '', '<p class="sk-note">' + esc(g.analyticsError || '') + '</p>');
    }
    pane('search').innerHTML = html;
  }

  function table(title, heads, rows, cells) {
    return '<div>' + (title ? '<div class="sk-sub">' + title + '</div>' : '') + '<div class="table-responsive"><table class="admin-table"><thead><tr>' +
      heads.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ((rows || []).map(function (r) { return '<tr>' + cells(r).map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') ||
        '<tr><td colspan="' + heads.length + '" style="text-align:center; color:var(--admin-text-muted); padding:18px;">No data yet</td></tr>') +
      '</tbody></table></div></div>';
  }

  /** Small dependency-free SVG line chart; series with own:true get their own scale. */
  function lineChart(rows, series) {
    rows = (rows || []).map(function (r) { return { date: r.key || r.date, v: r }; });
    if (rows.length < 2) return '<p class="sk-note">Not enough days of data for a chart yet.</p>';
    var W = 760, H = 180, P = 8;
    var paths = series.map(function (s) {
      var vals = rows.map(function (r) { return Number(r.v[s.key] || 0); });
      var max = Math.max.apply(null, vals) || 1;
      var pts = vals.map(function (v, i) { return (P + i * (W - 2 * P) / (vals.length - 1)).toFixed(1) + ',' + (H - P - v / max * (H - 2 * P)).toFixed(1); });
      return '<polyline fill="none" stroke="' + s.color + '" stroke-width="2.5" stroke-linejoin="round" points="' + pts.join(' ') + '"/>';
    }).join('');
    return '<div class="sk-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + series.map(function (s) { return s.label; }).join(' and ') + ' by day">' +
      '<line x1="0" x2="' + W + '" y1="' + (H - P) + '" y2="' + (H - P) + '" stroke="#E2E8F0"/>' + paths + '</svg>' +
      '<div class="sk-legend">' + series.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + s.label + '</span>'; }).join('') +
      '<span class="sk-legend-range">' + esc(rows[0].date) + ' → ' + esc(rows[rows.length - 1].date) + '</span></div></div>';
  }

  /* ---------------------------------------------------------------- audit */

  window.skRunAudit = function () {
    pane('audit').innerHTML = '<div class="sk-loading">Checking every key page of the live site…</div>';
    API.get('/admin/sitekit/audit').then(function (r) { state.audit = r; renderAudit(); }).catch(function (e) {
      pane('audit').innerHTML = card('Site audit', '', '<p class="sk-note">' + esc(e.message) + '</p>');
    });
  };

  function renderAudit() {
    var a = state.audit;
    if (!a) {
      pane('audit').innerHTML = card('Site audit', 'Loads each key page the way Google does and checks titles, descriptions, canonical links, headings, structured data, AEO answers, social previews, alt text and analytics.',
        '<div class="sk-actions"><button class="btn-primary" onclick="skRunAudit()">Run site audit</button></div>');
      return;
    }
    var cls = a.score >= 85 ? 'good' : a.score >= 65 ? 'ok' : 'bad';
    var html = '<div class="sk-grid sk-grid-score"><div class="admin-card sk-score ' + cls + '"><div class="sk-ring" style="--p:' + a.score + '"><span>' + a.score + '</span></div>' +
      '<div><div class="card-title">SEO health score</div><div class="card-subtitle">Average of ' + a.pages.length + ' pages · ' + esc(when(a.ranAt)) + '</div>' +
      '<button class="btn-secondary sk-mini" style="margin-top:10px;" onclick="skRunAudit()">Run again</button></div></div>';
    html += card('Site-wide checks', '', '<ul class="sk-checks">' + a.site.map(function (c) {
      return '<li class="' + c.level + '"><span class="sk-dot"></span><b>' + esc(c.name) + '</b><span>' + esc(c.detail) + '</span>' + (c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">open ↗</a>' : '') + '</li>';
    }).join('') + '</ul>') + '</div>';
    html += card('Pages', 'Click a page to see each check.', '<div class="sk-pages">' + a.pages.map(function (p, i) {
      var c2 = p.score >= 85 ? 'good' : p.score >= 65 ? 'ok' : 'bad';
      var issues = p.checks.filter(function (c) { return c.level !== 'pass'; }).length;
      return '<details class="sk-page"><summary><span class="sk-pscore ' + c2 + '">' + p.score + '</span><span class="sk-ppath">' + esc(p.page) + '</span>' +
        '<span class="sk-pissues">' + (issues ? issues + ' to improve' : 'All good') + '</span></summary>' +
        '<ul class="sk-checks">' + p.checks.map(function (c) {
          return '<li class="' + c.level + '"><span class="sk-dot"></span><b>' + esc(c.name) + '</b><span>' + esc(c.detail) + '</span></li>';
        }).join('') + '</ul><div class="sk-actions"><a class="btn-secondary sk-mini" href="' + esc(p.page) + '" target="_blank" rel="noopener">Open page ↗</a>' +
        '<a class="btn-secondary sk-mini" href="https://search.google.com/test/rich-results?url=' + encodeURIComponent('https://hotelzz.in' + p.page) + '" target="_blank" rel="noopener">Rich results test ↗</a>' +
        '<a class="btn-secondary sk-mini" href="https://pagespeed.web.dev/analysis?url=' + encodeURIComponent('https://hotelzz.in' + p.page) + '" target="_blank" rel="noopener">PageSpeed ↗</a></div></details>';
    }).join('') + '</div>');
    pane('audit').innerHTML = html;
  }

  /* -------------------------------------------------------------- content */

  function renderContent() {
    pane('content').innerHTML = '<div class="sk-loading">Checking listings…</div>';
    API.get('/admin/sitekit/content' + (state.issue ? '?issue=' + state.issue : '')).then(function (r) {
      state.content = r;
      var html = '<p class="sk-intro">Every hotel page gets an automatic answer box built from its data. The more complete the listing, the better the answer — and the more likely Google and AI assistants quote it. ' + num(r.total) + ' live listings.</p>';
      html += '<div class="sk-issues">' + r.counts.map(function (c) {
        var share = r.total ? Math.round(c.count / r.total * 100) : 0;
        return '<button class="admin-card sk-issue ' + (state.issue === c.key ? 'active' : '') + (c.count ? '' : ' clean') + '" onclick="skIssue(\'' + c.key + '\')">' +
          '<div class="sk-tile-label">' + esc(c.label) + '</div><div class="sk-tile-value">' + num(c.count) + '</div>' +
          '<div class="sk-bar"><i style="width:' + share + '%"></i></div><div class="sk-tile-sub">' + esc(c.hint) + '</div></button>';
      }).join('') + '</div>';
      if (r.issue) {
        var label = r.counts.filter(function (c) { return c.key === r.issue; })[0].label;
        html += card(esc(label) + ' — ' + num(r.rows.length) + (r.rows.length === 100 ? '+' : '') + ' listings', 'Most-reviewed first. Owners can fix these from their dashboard once they claim; admins from All Properties or a CSV re-import.',
          table('', ['Hotel', 'City', 'Type', 'Phone', 'Owner'], r.rows, function (p) {
            return ['<a href="property.html?id=' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener" style="font-weight:700;">' + esc(p.name) + '</a>', esc(p.location || '—'), esc(p.property_type || '—'), esc(p.phone || '—'),
              '<span class="badge ' + (p.claim_status === 'verified' ? 'badge-success' : 'badge-gray') + '">' + esc(p.claim_status) + '</span>'];
          }));
      }
      html += card('Cities', 'Each city page has its own answer box and FAQ markup.', table('', ['City', 'Listings', 'With description', 'Owner-verified', 'Avg. rating', ''], r.cities, function (c) {
        return ['<b>' + esc(c.name || c.slug) + '</b>', num(c.listings), Math.round(c.described / Math.max(1, c.listings) * 100) + '%', num(c.verified), c.rating || '—',
          '<a href="city.html?city=' + encodeURIComponent(c.slug) + '#answers" target="_blank" rel="noopener">View answers ↗</a>'];
      }));
      pane('content').innerHTML = html;
    }).catch(fail);
  }

  window.skIssue = function (key) { state.issue = state.issue === key ? null : key; renderContent(); };

  /* ------------------------------------------------------------------ AEO */

  var PAGE_OPTIONS = [['/', 'Home page'], ['/city', 'Every city page ({city} = city name)'], ['/deals.html', 'Deals'], ['/ota-listing.html', 'List your property'],
                      ['/marketing.html', 'Hotel marketing'], ['/claim.html', 'Claim a listing'], ['/city.html?city=all', 'All destinations']];
  function pageLabel(p) {
    var hit = PAGE_OPTIONS.filter(function (o) { return o[0] === p; })[0];
    return hit ? hit[1] : p;
  }

  function renderAeo() {
    var faqs = state.data.settings.faqs || [];
    var html = '<p class="sk-intro">AEO (answer-engine optimisation) answers are short, direct question-and-answer pairs. They show on the page, are marked up as <code>FAQPage</code> for Google, and appear in <a href="/llms.txt" target="_blank" rel="noopener">llms.txt</a> for ChatGPT, Claude, Perplexity and Gemini. ' +
      'City and hotel pages already get automatic answers from live data; add the questions people actually ask you here.</p>';
    html += card('Add an answer', 'Write the answer as one or two complete sentences that make sense on their own.',
      '<form class="sk-form" onsubmit="skAddFaq(event)"><div class="sk-row2"><div class="form-group"><label for="skFaqPage">Show on</label><select id="skFaqPage" class="form-control">' +
      PAGE_OPTIONS.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') + '<option value="custom">Specific page…</option></select></div>' +
      '<div class="form-group" id="skFaqCustomWrap" style="display:none;"><label for="skFaqCustom">Page path</label><input id="skFaqCustom" class="form-control" placeholder="/city.html?city=goa" /></div></div>' +
      '<div class="form-group"><label for="skFaqQ">Question</label><input id="skFaqQ" class="form-control" maxlength="200" placeholder="e.g. Can I book a hotel in {city} without paying online?" /></div>' +
      '<div class="form-group"><label for="skFaqA">Answer</label><textarea id="skFaqA" class="form-control" rows="3" maxlength="1200" placeholder="Yes. Every stay on Hotelzz is booked directly with the hotel on WhatsApp or phone…"></textarea></div>' +
      '<div class="acct-error" id="skFaqErr"></div><button class="btn-primary" type="submit">Add answer</button></form>');
    html += card('Your answers (' + faqs.length + ')', '', faqs.length ? '<div class="sk-faqs">' + faqs.map(function (f, i) {
      return '<div class="sk-faq"><div class="sk-faq-meta"><span class="badge badge-info">' + esc(pageLabel(f.page)) + '</span>' +
        '<span class="sk-faq-btns"><button class="btn-secondary sk-mini" onclick="skMoveFaq(' + i + ',-1)" ' + (i ? '' : 'disabled') + ' aria-label="Move up">↑</button>' +
        '<button class="btn-secondary sk-mini" onclick="skMoveFaq(' + i + ',1)" ' + (i < faqs.length - 1 ? '' : 'disabled') + ' aria-label="Move down">↓</button>' +
        '<button class="btn-secondary sk-mini" onclick="skEditFaq(' + i + ')">Edit</button>' +
        '<button class="btn-secondary sk-mini" style="color:#B91C1C;" onclick="skDeleteFaq(' + i + ')">Delete</button></span></div>' +
        '<div class="sk-faq-q">' + esc(f.q) + '</div><div class="sk-faq-a">' + esc(f.a) + '</div></div>';
    }).join('') + '</div>' : '<p class="sk-note">No answers yet.</p>');
    pane('aeo').innerHTML = html;
    $('skFaqPage').onchange = function () { $('skFaqCustomWrap').style.display = this.value === 'custom' ? '' : 'none'; };
  }

  function saveFaqs(list, msg) {
    return save({ faqs: list }, msg).then(renderAeo);
  }

  window.skAddFaq = function (e) {
    e.preventDefault();
    var page = $('skFaqPage').value === 'custom' ? $('skFaqCustom').value.trim() : $('skFaqPage').value;
    var item = { page: page, q: $('skFaqQ').value.trim(), a: $('skFaqA').value.trim() };
    var err = $('skFaqErr');
    err.textContent = '';
    if (!/^\//.test(page)) { err.textContent = 'Page paths start with /'; return; }
    if (item.q.length < 5) { err.textContent = 'Write the question.'; return; }
    if (item.a.length < 10) { err.textContent = 'Write a complete answer.'; return; }
    var list = (state.data.settings.faqs || []).slice();
    var editing = $('skFaqQ').getAttribute('data-edit');
    if (editing !== null && editing !== '') list[Number(editing)] = item; else list.push(item);
    saveFaqs(list, 'Answer saved — live on the page and in llms.txt.').catch(function (x) { err.textContent = x.message; });
  };

  window.skEditFaq = function (i) {
    var f = state.data.settings.faqs[i];
    var known = PAGE_OPTIONS.some(function (o) { return o[0] === f.page; });
    $('skFaqPage').value = known ? f.page : 'custom';
    $('skFaqCustomWrap').style.display = known ? 'none' : '';
    $('skFaqCustom').value = known ? '' : f.page;
    $('skFaqQ').value = f.q;
    $('skFaqA').value = f.a;
    $('skFaqQ').setAttribute('data-edit', i);
    $('skFaqQ').focus();
    $('skFaqQ').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  window.skDeleteFaq = function (i) {
    if (!window.confirm('Delete this answer from the site?')) return;
    var list = state.data.settings.faqs.slice();
    list.splice(i, 1);
    saveFaqs(list, 'Answer deleted.').catch(fail);
  };

  window.skMoveFaq = function (i, dir) {
    var list = state.data.settings.faqs.slice();
    var j = i + dir;
    if (j < 0 || j >= list.length) return;
    var t = list[i]; list[i] = list[j]; list[j] = t;
    saveFaqs(list, 'Order saved.').catch(fail);
  };

  /* ------------------------------------------------------------ page SEO */

  var EDITABLE = [['/', 'Home'], ['/deals.html', 'Deals'], ['/ota-listing.html', 'List your property'], ['/marketing.html', 'Hotel marketing'],
                  ['/claim.html', 'Claim a listing'], ['/city.html?city=all', 'All destinations'], ['/privacy.html', 'Privacy'], ['/terms.html', 'Terms']];

  function renderPages() {
    var pages = state.data.settings.pages || {};
    var keys = EDITABLE.map(function (e) { return e[0]; });
    Object.keys(pages).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var html = '<p class="sk-intro">Override the title and description Google shows for a page. Leave a field empty to keep the built-in one (city and hotel pages write their own from live data). Changes are live as soon as you save.</p>';
    html += '<div class="sk-pagelist">' + keys.map(function (k, i) {
      var o = pages[k] || {};
      var label = (EDITABLE.filter(function (e) { return e[0] === k; })[0] || [k, k])[1];
      return '<div class="admin-card sk-pageedit" data-key="' + esc(k) + '"><div class="sk-card-head"><div><div class="card-title">' + esc(label) + '</div><div class="card-subtitle"><a href="' + esc(k) + '" target="_blank" rel="noopener">' + esc(k) + ' ↗</a></div></div>' +
        (o.title || o.description || o.noindex ? '<span class="badge badge-info">Overridden</span>' : '') + '</div>' +
        '<div class="form-group"><label>SEO title <small class="sk-count" data-for="t' + i + '"></small></label><input id="skPt' + i + '" class="form-control" maxlength="70" value="' + esc(o.title || '') + '" placeholder="Built-in title" oninput="skCount(this, 60, \'t' + i + '\')" /></div>' +
        '<div class="form-group"><label>Meta description <small class="sk-count" data-for="d' + i + '"></small></label><textarea id="skPd' + i + '" class="form-control" rows="2" maxlength="170" placeholder="Built-in description" oninput="skCount(this, 155, \'d' + i + '\')">' + esc(o.description || '') + '</textarea></div>' +
        '<label class="sk-check"><input type="checkbox" id="skPn' + i + '"' + (o.noindex ? ' checked' : '') + ' /> Hide from search results (noindex)</label>' +
        '<div class="sk-serp"><div class="sk-serp-url">hotelzz.in' + esc(k === '/' ? '' : k) + '</div><div class="sk-serp-title" id="skPst' + i + '">' + esc(o.title || label + ' | Hotelzz.in') + '</div><div class="sk-serp-desc" id="skPsd' + i + '">' + esc(o.description || 'Built-in description') + '</div></div>' +
        '</div>';
    }).join('') + '</div>';
    html += '<div class="admin-card sk-card"><div class="sk-row2"><div class="form-group"><label for="skNewPage">Add another page (e.g. a city or hotel)</label><input id="skNewPage" class="form-control" placeholder="/city.html?city=goa" /></div>' +
      '<div class="form-group" style="align-self:end;"><button class="btn-secondary" onclick="skAddPage()">Add page</button></div></div></div>' +
      '<div class="sk-sticky"><button class="btn-primary" onclick="skSavePages()">Save page SEO</button></div>';
    pane('pages').innerHTML = html;
    keys.forEach(function (k, i) { skCount($('skPt' + i), 60, 't' + i); skCount($('skPd' + i), 155, 'd' + i); });
  }

  window.skCount = function (el, ideal, id) {
    var n = el.value.length;
    var tag = document.querySelector('.sk-count[data-for="' + id + '"]');
    if (tag) { tag.textContent = n ? n + ' / ' + ideal : ''; tag.className = 'sk-count' + (n > ideal ? ' over' : ''); }
    var i = id.slice(1), prev = $((id[0] === 't' ? 'skPst' : 'skPsd') + i);
    if (prev && n) prev.textContent = el.value;
  };

  window.skAddPage = function () {
    var p = $('skNewPage').value.trim();
    if (!/^\/[A-Za-z0-9_\-./?=&%]*$/.test(p)) { toast('Enter a path starting with /, e.g. /city.html?city=goa', 'warning'); return; }
    var pages = Object.assign({}, state.data.settings.pages || {});
    if (!pages[p]) pages[p] = { title: '', description: '', noindex: false };
    state.data.settings.pages = pages;
    renderPages();
  };

  window.skSavePages = function () {
    var out = {};
    document.querySelectorAll('#skPane-pages .sk-pageedit').forEach(function (el, i) {
      out[el.getAttribute('data-key')] = { title: $('skPt' + i).value.trim(), description: $('skPd' + i).value.trim(), noindex: $('skPn' + i).checked };
    });
    save({ pages: out }, 'Page SEO saved.').then(renderPages).catch(fail);
  };

  /* ------------------------------------------------------------ redirects */

  function renderRedirects() {
    var list = state.data.settings.redirects || [];
    pane('redirects').innerHTML = '<p class="sk-intro">Permanent (301) redirects keep Google rankings and old links working when a page moves. The query string is carried over.</p>' +
      card('Redirects', list.length + ' active', '<div class="sk-redirects" id="skRedirects">' + list.map(redirectRow).join('') + '</div>' +
        '<div class="sk-actions"><button class="btn-secondary" onclick="skAddRedirect()">+ Add redirect</button><button class="btn-primary" onclick="skSaveRedirects()">Save redirects</button></div>');
    if (!list.length) skAddRedirect();
  }

  function redirectRow(r) {
    return '<div class="sk-redirect"><input class="form-control" placeholder="/old-page.html" value="' + esc(r.from) + '" aria-label="From path" />' +
      '<span>→</span><input class="form-control" placeholder="/new-page.html or https://…" value="' + esc(r.to) + '" aria-label="To" />' +
      '<button class="btn-secondary sk-mini" onclick="this.parentNode.remove()" aria-label="Remove">✕</button></div>';
  }

  window.skAddRedirect = function () { $('skRedirects').insertAdjacentHTML('beforeend', redirectRow({ from: '', to: '' })); };

  window.skSaveRedirects = function () {
    var list = [];
    document.querySelectorAll('#skRedirects .sk-redirect').forEach(function (r) {
      var i = r.querySelectorAll('input');
      if (i[0].value.trim() || i[1].value.trim()) list.push({ from: i[0].value.trim(), to: i[1].value.trim() });
    });
    save({ redirects: list }, 'Redirects saved.').then(renderRedirects).catch(fail);
  };

  /* ---------------------------------------------------------- connections */

  function field(id, label, value, help, ph) {
    return '<div class="form-group"><label for="' + id + '">' + label + '</label><input id="' + id + '" class="form-control" value="' + esc(value || '') + '" placeholder="' + esc(ph || '') + '" />' +
      (help ? '<div class="sk-help">' + help + '</div>' : '') + '</div>';
  }

  function renderConnections() {
    var d = state.data, s = d.settings, c = d.connections;
    var html = '<form onsubmit="skSaveConnections(event)">';
    html += '<div class="sk-grid">';
    html += card('Analytics & tags', 'Added to every public page. Admin, owner and login pages are never tracked.',
      field('skGa4', 'GA4 measurement id ' + chip(c.ga4.on, 'On', 'Off'), s.ga4Id, 'GA4 → Admin → Data streams → Web → Measurement ID.', 'G-XXXXXXXXXX') +
      field('skGtm', 'Google Tag Manager id (optional)', s.gtmId, 'Only if you manage tags in GTM. Do not add GA4 in GTM too, or visits count twice.', 'GTM-XXXXXXX') +
      field('skPixel', 'Meta Pixel id (optional)', s.metaPixelId, 'For Facebook / Instagram ads.', '1234567890'));
    html += card('Ownership verification', 'Paste only the code inside content="…". The tag goes on every page.',
      field('skGsc', 'Google Search Console ' + chip(!!s.gscVerification, 'Tag on site', 'Missing'), s.gscVerification,
        'Search Console → Add property → URL prefix https://hotelzz.in/ → HTML tag. (Domain properties verify by DNS instead.)', 'abc123…') +
      field('skBing', 'Bing Webmaster Tools ' + chip(!!s.bingVerification, 'Tag on site', 'Missing'), s.bingVerification,
        'Bing Webmaster → Add site → HTML Meta Tag (msvalidate.01). Or import straight from Search Console.', '') +
      field('skYandex', 'Yandex', s.yandexVerification, '', '') +
      field('skPinterest', 'Pinterest', s.pinterestVerification, '', '') +
      field('skFb', 'Facebook domain verification', s.facebookDomainVerification, '', ''));
    html += '</div><div class="sk-grid">';
    html += card('Google data connection', 'Brings Search Console and GA4 numbers into Search &amp; traffic.',
      '<div class="sk-kv"><span>Service account</span><b>' + (c.serviceAccount.configured ? esc(c.serviceAccount.email) : 'Not connected') + '</b></div>' +
      (c.serviceAccount.configured ? '' : '<p class="sk-note">' + esc(c.serviceAccount.error || '') + ' — see <a href="#" onclick="skTab(\'search\'); return false;">the setup steps</a>.</p>') +
      field('skGscSite', 'Search Console property', s.gscSiteUrl, 'sc-domain:hotelzz.in for a Domain property, or https://hotelzz.in/ for a URL-prefix property.', 'sc-domain:hotelzz.in') +
      field('skGa4Prop', 'GA4 property id', s.ga4PropertyId, 'GA4 → Admin → Property details (a number, not G-…).', '123456789'));
    html += card('IndexNow', '',
      '<div class="sk-kv"><span>Key</span><code>' + esc(s.indexNowKey) + '</code></div>' +
      '<label class="sk-check"><input type="checkbox" id="skAutoIndex"' + (s.autoIndexNow ? ' checked' : '') + ' /> Every hour, send listings that changed to IndexNow automatically</label>' +
      field('skImage', 'Default share image', s.defaultImage, 'Used when a page has no image of its own (1200×630 works best).', 'https://hotelzz.in/og-image.jpg'));
    html += '</div>';
    html += card('Organisation (schema.org)', 'Shown to Google as the business behind hotelzz.in — feeds the knowledge panel and AI answers about Hotelzz.',
      '<div class="sk-row2">' + field('skOrgName', 'Name', s.org.name) + field('skOrgLegal', 'Legal name', s.org.legalName, '', 'e.g. Psyber Inc.') + '</div>' +
      '<div class="sk-row2">' + field('skOrgEmail', 'Email', s.org.email) + field('skOrgPhone', 'Phone', s.org.phone) + '</div>' +
      '<div class="sk-row2">' + field('skOrgCity', 'City', s.org.city) + field('skOrgRegion', 'State', s.org.region) + '</div>' +
      field('skOrgLogo', 'Logo URL', s.org.logo) +
      '<div class="form-group"><label for="skOrgDesc">Description</label><textarea id="skOrgDesc" class="form-control" rows="2" maxlength="400">' + esc(s.org.description) + '</textarea></div>' +
      '<div class="form-group"><label for="skOrgSame">Social profiles (one https:// link per line)</label><textarea id="skOrgSame" class="form-control" rows="3" placeholder="https://www.instagram.com/hotelzz.in&#10;https://www.facebook.com/hotelzz">' + esc((s.org.sameAs || []).join('\n')) + '</textarea></div>');
    html += card('AI crawlers', 'Allowing answer engines lets ChatGPT, Claude, Perplexity, Gemini and Copilot read and cite Hotelzz. Turning one off adds a Disallow rule to robots.txt.',
      '<div class="table-responsive"><table class="admin-table"><thead><tr><th>Crawler</th><th>Company</th><th>Used for</th><th>Allowed</th></tr></thead><tbody>' +
      d.crawlers.map(function (cr) {
        return '<tr><td><code>' + esc(cr.id) + '</code></td><td>' + esc(cr.owner) + '</td><td>' + esc(cr.use) + '</td><td><label class="sk-switch"><input type="checkbox" data-crawler="' + esc(cr.id) + '"' + (s.aiCrawlers[cr.id] !== false ? ' checked' : '') + ' /><span></span></label></td></tr>';
      }).join('') + '</tbody></table></div>');
    html += '<div class="acct-error" id="skConnErr"></div><div class="sk-sticky"><button class="btn-primary" type="submit">Save connections</button></div></form>';
    pane('connections').innerHTML = html;
  }

  window.skSaveConnections = function (e) {
    e.preventDefault();
    var v = function (id) { return $(id).value.trim(); };
    var crawlers = {};
    document.querySelectorAll('#skPane-connections [data-crawler]').forEach(function (x) { crawlers[x.getAttribute('data-crawler')] = x.checked; });
    var payload = {
      ga4Id: v('skGa4').toUpperCase(), gtmId: v('skGtm').toUpperCase(), metaPixelId: v('skPixel'),
      gscVerification: v('skGsc'), bingVerification: v('skBing'), yandexVerification: v('skYandex'),
      pinterestVerification: v('skPinterest'), facebookDomainVerification: v('skFb'),
      gscSiteUrl: v('skGscSite'), ga4PropertyId: v('skGa4Prop'), autoIndexNow: $('skAutoIndex').checked,
      org: { name: v('skOrgName'), legalName: v('skOrgLegal'), email: v('skOrgEmail'), phone: v('skOrgPhone'), city: v('skOrgCity'),
             region: v('skOrgRegion'), logo: v('skOrgLogo'), description: v('skOrgDesc'),
             sameAs: v('skOrgSame').split(/\s+/).filter(Boolean) },
      aiCrawlers: crawlers
    };
    if (v('skImage')) payload.defaultImage = v('skImage');
    // People often paste the whole <meta …> tag: keep just the content value.
    ['gscVerification', 'bingVerification', 'yandexVerification', 'pinterestVerification', 'facebookDomainVerification'].forEach(function (k) {
      var m = payload[k].match(/content=["']([^"']+)["']/i);
      if (m) payload[k] = m[1];
    });
    $('skConnErr').textContent = '';
    save(payload, 'Connections saved — tags are live on every public page.').then(renderConnections).catch(function (x) { $('skConnErr').textContent = x.message; });
  };
})();

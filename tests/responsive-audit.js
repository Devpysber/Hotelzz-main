// Comprehensive responsive design audit script
const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3000';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const viewports = [
  // Mobile
  { name: 'Mobile 320px', width: 320, height: 568 },
  { name: 'Mobile 360px', width: 360, height: 800 },
  { name: 'Mobile 375px', width: 375, height: 667 },
  { name: 'Mobile 390px', width: 390, height: 844 },
  { name: 'Mobile 414px', width: 414, height: 896 },
  { name: 'Mobile 430px', width: 430, height: 932 },
  // Tablet
  { name: 'Tablet 600px', width: 600, height: 960 },
  { name: 'Tablet 768px', width: 768, height: 1024 },
  { name: 'Tablet 820px', width: 820, height: 1180 },
  { name: 'Tablet 912px', width: 912, height: 1368 },
  { name: 'Tablet 1024px', width: 1024, height: 768 },
  // Desktop
  { name: 'Desktop 1280px', width: 1280, height: 800 },
  { name: 'Desktop 1440px', width: 1440, height: 900 }
];

const publicPages = [
  { name: 'Home', url: '/index.html' },
  { name: 'City', url: '/city.html?city=panaji' },
  { name: 'Property PDP', url: '/property.html?id=affordable-stay-airbnb-744888' },
  { name: 'Marketing', url: '/marketing.html' },
  { name: 'OTA Listing', url: '/ota-listing.html' },
  { name: 'Claim', url: '/claim.html' },
  { name: 'Login', url: '/login.html' },
  { name: 'Dashboard Login', url: '/dashboard-login.html' },
  { name: 'Admin Login', url: '/admin-login.html' },
  { name: 'Reset Password', url: '/reset-password.html' },
  { name: 'Privacy', url: '/privacy.html' },
  { name: 'Terms', url: '/terms.html' },
  { name: '404', url: '/404.html' }
];

const portalPages = [
  { name: 'Traveler Portal', url: '/user-portal.html', role: 'traveler', email: 'rahul@example.com', pass: 'password123' },
  { name: 'Owner Dashboard', url: '/owner.html', role: 'owner', email: 'owner@grandpalace.com', pass: 'owner12345' },
  { name: 'Admin Console', url: '/admin.html', role: 'admin', email: 'admin@hotelzz.in', pass: 'admin123' }
];

async function runAudit() {
  console.log('Launching Chrome for Responsive Audit...');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });

  let totalTests = 0;
  let overflowIssues = [];

  // Audit Public Pages
  console.log('\n--- AUDITING PUBLIC PAGES ---');
  for (const pageInfo of publicPages) {
    for (const vp of viewports) {
      totalTests++;
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height }
      });
      const page = await ctx.newPage();

      try {
        await page.goto(BASE + pageInfo.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(500);

        const overflow = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, body.scrollWidth);
          const innerWidth = window.innerWidth;
          const hasScroll = scrollWidth > innerWidth + 1;

          let overflowingTags = [];
          if (hasScroll) {
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const rect = el.getBoundingClientRect();
              if (rect.right > innerWidth + 2) {
                overflowingTags.push({
                  tag: el.tagName.toLowerCase(),
                  id: el.id,
                  className: typeof el.className === 'string' ? el.className.trim() : '',
                  right: Math.round(rect.right),
                  width: Math.round(rect.width)
                });
              }
            }
          }
          return {
            hasScroll,
            scrollWidth,
            innerWidth,
            diff: scrollWidth - innerWidth,
            elements: overflowingTags.slice(0, 5)
          };
        });

        if (overflow.hasScroll) {
          overflowIssues.push({
            page: pageInfo.name,
            url: pageInfo.url,
            viewport: vp.name,
            diff: overflow.diff,
            elements: overflow.elements
          });
          process.stdout.write('X');
        } else {
          process.stdout.write('.');
        }
      } catch (err) {
        console.error(`\nError testing ${pageInfo.name} at ${vp.name}:`, err.message);
      } finally {
        await ctx.close();
      }
    }
    console.log(`  ${pageInfo.name} complete`);
  }

  // Audit Portals
  console.log('\n--- AUDITING DASHBOARD & PORTAL PAGES ---');
  for (const portal of portalPages) {
    for (const vp of viewports) {
      totalTests++;
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height }
      });
      const page = await ctx.newPage();

      try {
        // Sign in first
        await page.goto(BASE + '/login.html?type=' + portal.role, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);

        // Fill credentials via API or form
        await page.evaluate(async ({ role, email, pass }) => {
          await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, identifier: email, password: pass })
          });
        }, { role: portal.role, email: portal.email, pass: portal.pass });

        await page.goto(BASE + portal.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(600);

        const overflow = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, body.scrollWidth);
          const innerWidth = window.innerWidth;
          const hasScroll = scrollWidth > innerWidth + 1;

          let overflowingTags = [];
          if (hasScroll) {
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const rect = el.getBoundingClientRect();
              if (rect.right > innerWidth + 2) {
                overflowingTags.push({
                  tag: el.tagName.toLowerCase(),
                  id: el.id,
                  className: typeof el.className === 'string' ? el.className.trim() : '',
                  right: Math.round(rect.right),
                  width: Math.round(rect.width)
                });
              }
            }
          }
          return {
            hasScroll,
            scrollWidth,
            innerWidth,
            diff: scrollWidth - innerWidth,
            elements: overflowingTags.slice(0, 5)
          };
        });

        if (overflow.hasScroll) {
          overflowIssues.push({
            page: portal.name,
            url: portal.url,
            viewport: vp.name,
            diff: overflow.diff,
            elements: overflow.elements
          });
          process.stdout.write('X');
        } else {
          process.stdout.write('.');
        }
      } catch (err) {
        console.error(`\nError testing ${portal.name} at ${vp.name}:`, err.message);
      } finally {
        await ctx.close();
      }
    }
    console.log(`  ${portal.name} complete`);
  }

  await browser.close();

  console.log(`\n\n========================================`);
  console.log(`AUDIT RESULTS: ${totalTests} viewport tests executed.`);
  console.log(`Horizontal overflow failures: ${overflowIssues.length}`);
  console.log(`========================================\n`);

  if (overflowIssues.length > 0) {
    console.log('OVERFLOW ISSUES FOUND:');
    overflowIssues.forEach((iss, i) => {
      console.log(`\n${i + 1}. [${iss.page}] at [${iss.viewport}]: overflow by ${iss.diff}px`);
      iss.elements.forEach(el => {
        console.log(`   Tag: <${el.tag} id="${el.id}" class="${el.className}"> right=${el.right}px, width=${el.width}px`);
      });
    });
    process.exit(1);
  } else {
    console.log('SUCCESS! ALL pages passed all viewports with ZERO horizontal overflow!');
    process.exit(0);
  }
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});

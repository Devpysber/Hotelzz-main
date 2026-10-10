// Shared by every browser test: where the app runs and which Chromium to drive.
// HZ_BASE overrides the server URL; CHROME_PATH overrides the browser. Without
// CHROME_PATH it looks in the usual Playwright install folders on Windows,
// Linux and macOS.
const fs = require('fs');
const path = require('path');

const BASE = (process.env.HZ_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    path.join(process.env.HOME || '', '.cache', 'ms-playwright'),
    path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
  ].filter((r) => r && fs.existsSync(r));
  const subs = ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome',
                'chrome-mac/Chromium.app/Contents/MacOS/Chromium'];
  for (const root of roots) {
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+/.test(d)).sort().reverse();
    for (const dir of dirs) {
      for (const sub of subs) {
        const exe = path.join(root, dir, sub);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  const win = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (fs.existsSync(win)) return win;
  throw new Error('Chromium not found — set CHROME_PATH');
}

module.exports = { BASE, findChrome };

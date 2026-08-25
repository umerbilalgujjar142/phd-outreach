/*
 * One-time Indeed login into the persistent profile (via YOUR Google sign-in).
 *
 * A visible Chrome window opens on Indeed's sign-in page. YOU click
 * "Continue with Google" and complete it (password + 2FA) yourself — the script
 * never touches your Google credentials. It watches for a logged-in state and
 * saves the session into JOB_BROWSER_PROFILE, which the app reuses for every
 * later Indeed apply (no re-login, no Google-OAuth automation).
 *
 * Run on YOUR machine (needs a real display):
 *     node scripts/warm-indeed-profile.js
 *     node scripts/warm-indeed-profile.js ie      # market: ae|sa|ie|uk (default ae)
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const p = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const { chromium } = require('playwright');

const PROFILE = path.resolve(process.env.JOB_BROWSER_PROFILE || './.browser-profile');
const MARKET = (process.argv[2] || 'ae').replace(/[^a-z]/gi, '').toLowerCase();
const DOMAIN = `${MARKET}.indeed.com`;
const HOME = `https://${DOMAIN}/`;
const LOGIN = `https://${DOMAIN}/account/login`;
const MAX_WAIT_MS = 8 * 60 * 1000; // give ample time for Google + 2FA
const log = (...a) => console.log('[indeed-warm]', ...a);

async function isLoggedIn(page) {
  // Only trust the check on an Indeed page (during Google OAuth we're elsewhere).
  if (!/indeed\.com/.test(page.url())) return false;
  return page
    .evaluate(() => {
      const acct = document.querySelector(
        '[data-gnav-element-name="AccountMenu"], [data-testid="gnav-AccountMenu"], [data-gnav-element-name="Resume"]',
      );
      const signIn = Array.from(document.querySelectorAll('a,button')).some(
        (e) => /^\s*sign in\s*$/i.test((e.textContent || '').trim()),
      );
      return !!acct && !signIn;
    })
    .catch(() => false);
}

async function main() {
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
  log(`profile: ${PROFILE}`);
  log(`market:  ${DOMAIN}`);

  // Launch REAL Google Chrome (channel:'chrome') with the automation flags
  // stripped so Google does not refuse sign-in with "this browser may not be
  // secure". `--enable-automation` is removed and AutomationControlled disabled
  // so navigator.webdriver is not set — the window looks like a normal Chrome.
  // Falls back to bundled Chromium (still de-automated) if Chrome isn't found.
  const launchOpts = {
    headless: false,
    // NO --no-sandbox on macOS desktop: it triggers the "unsupported flag"
    // banner and flags us to Cloudflare. Keep only the de-automation switch.
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    locale: 'en-US',
    viewport: null,
    acceptDownloads: true,
    // NOTE: no custom userAgent — a real Chrome sends its own genuine UA, which
    // Google trusts more than a spoofed string.
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', ...launchOpts });
    log('using your real Google Chrome (de-automated)');
  } catch (e) {
    log(`real Chrome unavailable (${e.message.slice(0, 60)}) — falling back to Chromium`);
    context = await chromium.launchPersistentContext(PROFILE, launchOpts);
  }
  // Extra belt-and-braces: hide the webdriver flag before any page script runs.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = context.pages()[0] || (await context.newPage());

  log('warming past Cloudflare…');
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(4000);

  // Already logged in from a previous run?
  if (await isLoggedIn(page)) {
    log('ALREADY LOGGED IN — profile is ready. Nothing to do.');
    await page.waitForTimeout(3000);
    await context.close();
    return;
  }

  await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  log('');
  log('────────────────────────────────────────────────────────────');
  log('In the browser window:');
  log('  1. Click "Continue with Google".');
  log('  2. Complete your Google sign-in (password + 2FA) yourself.');
  log('  3. Wait until you land back on Indeed, logged in.');
  log('This script is watching and will save the profile automatically.');
  log('────────────────────────────────────────────────────────────');
  log('');

  const start = Date.now();
  let done = false;
  while (Date.now() - start < MAX_WAIT_MS) {
    // If the user closed the window, treat as finished (cookies are persisted).
    if (context.pages().length === 0) {
      log('window closed by user — session saved.');
      done = true;
      break;
    }
    const live = context.pages()[0];
    if (live && (await isLoggedIn(live))) {
      log('LOGGED IN detected ✓  saving session…');
      await live.waitForTimeout(4000);
      done = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  if (!done) log('timed out waiting for login — closing; re-run if you did not finish.');
  await context.close().catch(() => {});
  log('SAVED — the app will reuse this Indeed session for assisted apply.');
}

main().catch((e) => {
  console.error('[indeed-warm] FATAL', e.message);
  process.exit(1);
});

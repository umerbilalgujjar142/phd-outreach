/*
 * One-time profile warm-up for assisted apply.
 *
 * IrishJobs (and many boards) sit behind a bot manager (Akamai / DataDome) that
 * blocks FRESH automated browser sessions on job-detail + application URLs. The
 * fix is a PERSISTENT profile: sign in once here, by hand, and the app reuses
 * that logged-in, bot-validated session on every later apply.
 *
 * Run on YOUR machine (needs a real display):
 *     node scripts/warm-irishjobs-profile.js
 *     node scripts/warm-irishjobs-profile.js "https://www.irishjobs.ie/"
 *
 * A Chrome window opens. Log in (creds are pre-filled if the fields are found),
 * click through any "verify you're human" step, land on your logged-in account,
 * then come back to THIS terminal and press Enter. The profile is saved to
 * JOB_BROWSER_PROFILE and the app will reuse it.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// --- minimal .env loader (no dependency) ---
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
const EMAIL = process.env.APPLICANT_EMAIL || 'mumerbilal142@gmail.com';
const PASSWORD = process.env.APPLICANT_PASSWORD || '';
const START_URL = process.argv[2] || 'https://www.irishjobs.ie/candidate/login';

const ask = (q) =>
  new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res(a); });
  });

async function tryPrefill(page) {
  const emailSel = 'input[type="email"], input[name*="email" i], input[autocomplete="username"]';
  const email = page.locator(emailSel).first();
  if ((await email.count().catch(() => 0)) > 0) {
    await email.fill(EMAIL).catch(() => {});
    console.log('  · pre-filled email');
  }
  const pw = page.locator('input[type="password"]').first();
  if (PASSWORD && (await pw.count().catch(() => 0)) > 0) {
    await pw.fill(PASSWORD).catch(() => {});
    console.log('  · pre-filled password');
  }
}

async function main() {
  if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });
  console.log(`\nProfile dir: ${PROFILE}`);
  console.log(`Opening: ${START_URL}\n`);

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1280, height: 1400 },
    acceptDownloads: true,
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) =>
    console.log('  (initial load slow/blocked — you can still navigate in the window):', e.message.slice(0, 80)),
  );
  await page.waitForTimeout(1500);
  await tryPrefill(page).catch(() => {});

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('In the browser window:');
  console.log('  1. Finish signing in (submit the login).');
  console.log('  2. Clear any "verify you are human" / cookie prompt.');
  console.log('  3. Make sure you land on your logged-in IrishJobs account.');
  console.log('Then return here and press Enter to save the profile.');
  console.log('──────────────────────────────────────────────────────────────\n');

  await ask('Press Enter when you are logged in… ');

  // Quick validation: can we now load a protected job-detail page?
  const testUrl =
    'https://www.irishjobs.ie/job/full-stack-engineer/proofpoint-job107868768';
  console.log('\nValidating: loading a job-detail page with the saved session…');
  const ok = await page
    .goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    .then(() => true)
    .catch((e) => (console.log('  load error:', e.message.slice(0, 80)), false));
  if (ok) {
    const loggedIn = await page
      .getByText(/sign out|log out|my account|dashboard/i)
      .count()
      .catch(() => 0);
    console.log(`  job-detail page loaded ✓  (logged-in markers: ${loggedIn})`);
  } else {
    console.log('  ⚠ job-detail page still blocked — the bot wall may need another human pass.');
  }

  await context.close();
  console.log('\nProfile saved. The app will now reuse this session for assisted apply.\n');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

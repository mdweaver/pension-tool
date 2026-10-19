#!/usr/bin/env node
// Opens the site in a headless browser in DEMO mode (config.js is replaced with a blank one,
// so the live database is never touched) and checks that the main things RAs do still work.
//   npm install --no-save playwright && npx playwright install chromium && node tools/smoke_test.js
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const results = []; let failed = false;
const ok = (cond, msg) => { results.push((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed = true; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route(/\/config\.js$/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "window.CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:''};" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  const step = async (msg, fn) => { try { await fn(); } catch (e) { ok(false, `${msg} (${e.message.split('\n')[0]})`); } };
  const T = { timeout: 8000 };

  await step('page loads in demo mode with a sign-in screen', async () => {
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForSelector('#loginform', T);
    ok(await page.isVisible('#banner'), 'page loads in demo mode with a sign-in screen');
  });
  await step('an RA can sign in and see the records list', async () => {
    await page.click('[data-act=demoas][data-email="ada@example.edu"]');
    await page.waitForSelector('.rtab tbody tr', T);
    ok((await page.$$('.rtab tbody tr')).length >= 1, 'an RA can sign in and see the records list');
  });
  await step('every section of a record opens', async () => {
    await page.click('[data-act=open]');
    await page.waitForSelector('.prov', T);
    const secs = await page.evaluate(() => SCHEMA.map(s => [s.id, s.title]));
    const bad = [];
    for (const [id, title] of secs) {
      await page.click(`nav [data-sec="${id}"]`);
      const h = (await page.textContent('#main h1')).trim();
      if (h !== title) bad.push(id);
    }
    ok(!bad.length, `every section of a record opens (${secs.length} sections${bad.length ? '; broken: ' + bad.join(', ') : ''})`);
  });
  await step('typing, adding rows and saving work', async () => {
    await page.click('nav [data-sec="apps"]');
    await page.click('[data-act=addsub]');
    const ids = await page.$$eval('input[id^="f-apps-app-0-claims-"][id$="-claim"]', els => els.map(e => e.id));
    await page.fill('#' + ids[ids.length - 1], 'hernia');
    await page.dispatchEvent('#' + ids[ids.length - 1], 'input');
    await page.click('#b-save');
    await page.waitForFunction(() => /Saved · v3/.test(document.querySelector('#saved').textContent), null, T);
    ok(true, 'typing, adding rows and saving work (saved as version 3)');
  });
  await step('edit history shows the save with its author and change', async () => {
    await page.click('nav [data-sec="history"]');
    await page.waitForSelector('#main .diff', T);
    const head = await page.textContent('#main .ghead');
    const diff = await page.textContent('#main .diff');
    ok(/Version 3/i.test(head) && /Ada/.test(head) && /HERNIA/.test(diff), 'edit history shows the save with its author and change');
  });
  await step('field checks flag a bad date', async () => {
    await page.click('nav [data-sec="personal"]');
    await page.fill('#f-personal-death-date', '');
    await page.type('#f-personal-death-date', '13401899');
    await page.click('#main h1');
    ok(await page.$eval('#f-personal-death-date', e => e.classList.contains('bad')), 'field checks flag a bad date');
  });
  await step('export builds a CSV', async () => {
    const head = await page.evaluate(async () => toCSV((await API.allData()).map(upgrade)).split('\r\n')[0]);
    ok(head.startsWith('record_uid,sailor_id,section,group,row'), 'export builds a CSV');
  });
  await step('an admin sees Team & activity', async () => {
    await page.click('#b-me'); await page.click('[data-act=signout]');
    await page.click('[data-act=demoas][data-email="you@example.edu"]');
    await page.waitForSelector('nav [data-sec="team"]', T);
    await page.click('nav [data-sec="team"]');
    await page.waitForSelector('.team tbody tr', T);
    ok((await page.$$('.team tbody tr')).length === 4, 'an admin sees Team & activity');
  });
  await step('no horizontal scrolling on a phone', async () => {
    await page.setViewportSize({ width: 400, height: 850 });
    await page.click('nav [data-sec="records"]'); await page.waitForSelector('.rtab tbody tr', T);
    await page.click('[data-act=open]'); await page.waitForSelector('.prov', T);
    const wide = [];
    for (const id of ['meta', 'personal', 'family', 'apps', 'aff']) {
      await page.click(`nav [data-sec="${id}"]`);
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) wide.push(id);
    }
    ok(!wide.length, 'no horizontal scrolling on a phone' + (wide.length ? ' (too wide: ' + wide.join(', ') + ')' : ''));
  });
  ok(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log((failed ? '✗ Browser smoke test failed' : '✓ Browser smoke test passed') + '\n' + results.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) require('fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Browser smoke test\n```\n' + results.join('\n') + '\n```\n');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

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
    const secs = await page.evaluate(() => visSections().map(s => [s.id, s.title]));
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
  const dpart = (path, part) => `[data-path="${path}"][data-dpart="${part}"]`;
  await step('field checks flag a bad date', async () => {
    await page.click('nav [data-sec="personal"]');
    await page.fill(dpart('personal.death.date', 'm'), '13');
    await page.fill(dpart('personal.death.date', 'd'), '34');
    await page.fill(dpart('personal.death.date', 'y'), '1899');
    await page.click('#main h1');
    ok(await page.$eval(dpart('personal.death.date', 'y'), e => e.classList.contains('bad')), 'field checks flag a bad date');
  });
  await step('a year-only or year-and-month date is stored with dashes and accepted', async () => {
    await page.fill(dpart('personal.death.date', 'm'), '');
    await page.fill(dpart('personal.death.date', 'd'), '');
    await page.dispatchEvent(dpart('personal.death.date', 'd'), 'input');
    const yearOnly = await page.evaluate(() => cur.personal.death.date);
    await page.fill(dpart('personal.death.date', 'm'), '4');
    await page.dispatchEvent(dpart('personal.death.date', 'm'), 'input');
    const yearMonth = await page.evaluate(() => cur.personal.death.date);
    await page.click('#main h1');
    ok(yearOnly === '--/--/1899' && yearMonth === '04/--/1899' && !(await page.$eval(dpart('personal.death.date', 'y'), e => e.classList.contains('bad'))), 'a year-only or year-and-month date is stored with dashes and accepted');
  });
  await step('choosing a US state fills in the country', async () => {
    await page.fill('[data-path="personal.death.state"]', 'virginia');
    await page.dispatchEvent('[data-path="personal.death.state"]', 'input');
    await page.click('#main h1'); // leaving the box matches it to the list's spelling
    const st = await page.evaluate(() => [cur.personal.death.state, cur.personal.death.country]);
    await page.fill('[data-path="personal.death.county"]', 'x');
    await page.fill('[data-path="personal.death.state"]', 'Narnia');
    await page.dispatchEvent('[data-path="personal.death.state"]', 'input');
    await page.click('#main h1');
    const custom = await page.evaluate(() => [cur.personal.death.state, document.querySelector('[data-path="personal.death.state"]').classList.contains('custom')]);
    await page.fill('[data-path="personal.death.state"]', 'va');
    await page.dispatchEvent('[data-path="personal.death.state"]', 'input');
    await page.click('#main h1');
    const oldcode = await page.evaluate(() => cur.personal.death.state);
    ok(st[0] === 'Virginia' && st[1] === 'United States' && custom[0] === 'Narnia' && custom[1] === true && oldcode === 'Virginia' && (await page.inputValue('[data-path="personal.death.country"]')) === 'United States', 'choosing a US state fills in the country');
  });
  await step('a source URL is checked and every row has one', async () => {
    await page.fill('[data-path="personal.death.src"]', 'not a url');
    await page.dispatchEvent('[data-path="personal.death.src"]', 'input');
    const msg = await page.evaluate(() => checkField(fieldForPath('personal.death.src'), cur.personal.death.src, cur.personal.death));
    const hasSrc = await page.evaluate(() => visSections().every(s => visGroups(s).every(g => g.id === 'rmk' || g.id.endsWith('_rmk') || g.nosrc || g.fields.some(f => f.k === 'src'))));
    ok(msg && msg.lvl === 'err' && hasSrc, 'a source URL is checked and every row has one');
  });
  await step('sources: page label from the Fold3 address, extra sources, per-field source, address list', async () => {
    await page.click('nav [data-sec="personal"]');
    const u = 'https://www.fold3.com/image/259904703/example-person-page-10-us-civil-war-service-records-1';
    await page.evaluate(() => { cur.personal.death.srcs = []; cur.personal.death.src_note = ''; renderMain(); }); // start from none (the example has some)
    await page.fill('[data-path="personal.death.src"]', u);
    await page.dispatchEvent('[data-path="personal.death.src"]', 'input');
    const label = await page.inputValue('[data-path="personal.death.src_note"]');
    await page.fill('[data-path="personal.death.src"]', 'https://www.fold3.com/file/56832385');
    await page.dispatchEvent('[data-path="personal.death.src"]', 'input');
    const cleared = await page.inputValue('[data-path="personal.death.src_note"]');
    await page.fill('[data-path="personal.death.src_note"]', 'by hand');
    await page.dispatchEvent('[data-path="personal.death.src_note"]', 'input');
    await page.click('[data-act=addsrc][data-path="personal.death"]');
    await page.fill('[data-path="personal.death.srcs.0.url"]', u);
    await page.dispatchEvent('[data-path="personal.death.srcs.0.url"]', 'input');
    const extra = await page.inputValue('[data-path="personal.death.srcs.0.note"]');
    await page.click('[data-act=addsrc][data-path="personal.death"]');
    await page.click('[data-act=fsrc][data-path="personal.death"][data-fkey="cause"]');
    const panel = await page.$$eval('[data-path^="personal.death.srcs."][data-path$=".url"]', els => els.length);
    await page.fill('[data-path="personal.death.srcs.2.url"]', 'https://www.fold3.com/image/1-page-3-x');
    await page.dispatchEvent('[data-path="personal.death.srcs.2.url"]', 'input');
    await page.waitForTimeout(500);
    const listed = await page.$$eval('#dl-SRCS option', els => els.length);
    const pruned = await page.evaluate(() => { const c = prunedCopy(cur).personal.death.srcs; return [c.length, c[0].url, c[1] && c[1].field]; });
    ok(label === 'p. 10' && cleared === '' && extra === 'p. 10' && panel >= 3 && listed >= 2 && pruned[0] === 2 && pruned[1] === u && pruned[2] === 'cause',
      'sources: page label from the Fold3 address, extra sources, per-field source, address list');
  });
  await step('file tab starts with an application row and a certificate row', async () => {
    await page.click('nav [data-sec="meta"]');
    const kinds = await page.$$eval('[data-path^="meta.appfiles."][data-path$=".kind"]', els => els.map(e => e.value));
    const opts = await page.$$eval('[data-path="meta.appfiles.0.nara"] option', els => els.length);
    ok(kinds.length >= 2 && kinds[0] === 'Application number' && kinds[1] === 'Certificate number' && opts === 5, 'file tab starts with an application row and a certificate row');
  });
  await step('immigration can have several rows and depositions pick a file from File & tracking', async () => {
    await page.click('nav [data-sec="personal"]');
    const before = await page.$$eval('[data-path^="personal.immigs."][data-path$=".years"]', els => els.length);
    await page.click('[data-act=add][data-path="personal.immigs"]');
    const after = await page.$$eval('[data-path^="personal.immigs."][data-path$=".years"]', els => els.length);
    await page.click('nav [data-sec="deps"]');
    const opts = await page.$$eval('[data-path="deps.depo.0.file"] option', els => els.map(e => e.textContent));
    await page.selectOption('[data-path="deps.depo.0.file"]', { index: 2 });
    const saved = await page.evaluate(() => cur.deps.depo[0].file);
    ok(after === before + 1 && opts.length >= 3 && opts.includes('Application number 000001') && opts.includes('Certificate number 000002') && saved === opts[2], 'immigration can have several rows and depositions pick a file from File & tracking');
  });
  await step('old codes are fixed when saving even with the cursor still in the box; built-in words are not list entries', async () => {
    await page.click('nav [data-sec="personal"]');
    const sel = '[data-path="personal.death.state"]';
    await page.fill('[data-path="personal.death.country"]', '');
    await page.focus(sel); await page.fill(sel, 'va'); await page.dispatchEvent(sel, 'input');
    await page.evaluate(() => saveNow(true));
    const r = await page.evaluate(() => [cur.personal.death.state, cur.personal.death.country, document.querySelector('[data-path="personal.death.state"]').value]);
    const ctor = await page.evaluate(() => { const f = fieldForPath('personal.death.source'); const c = checkField(f, 'constructor', cur.personal.death); return [c && c.lvl, 'constructor' in CODES.MF, String(CODES.STATUS['toString'])]; });
    ok(r[0] === 'Virginia' && r[1] === 'United States' && r[2] === 'Virginia' && ctor[0] === 'note' && ctor[1] === false && ctor[2] === 'undefined', 'old codes are fixed when saving even with the cursor still in the box; built-in words are not list entries');
  });
  await step('a value typed outside a list is kept and is not listed as a problem', async () => {
    await page.fill('[data-path="personal.death.state"]', 'Narnia'); await page.dispatchEvent('[data-path="personal.death.state"]', 'input');
    await page.click('#main h1');
    const r = await page.evaluate(() => [cur.personal.death.state, allChecks(cur).some(c => /not in the list/.test(c.msg)), document.querySelector('[data-path="personal.death.state"]').classList.contains('custom')]);
    await page.evaluate(() => saveNow(true));
    ok(r[0] === 'Narnia' && r[1] === false && r[2] === true, 'a value typed outside a list is kept and is not listed as a problem');
  });
  await step('a source error inside a closed per-field panel can still be reached from the check list', async () => {
    await page.evaluate(() => { cur.personal.death.srcs = [{ field: 'cause', url: 'not a url', note: '' }]; renderMain(); sideRefresh(); });
    const p = await page.evaluate(() => (allChecks(cur).find(c => /srcs\.\d+\.url$/.test(c.path)) || {}).path);
    await page.click(`.chk[data-path="${p}"]`);
    await page.waitForTimeout(200);
    const there = await page.evaluate(path => !!document.getElementById(idOf(path)), p);
    await page.evaluate(() => { cur.personal.death.srcs = []; renderMain(); });
    ok(!!p && there, 'a source error inside a closed per-field panel can still be reached from the check list');
  });
  await step('an open source panel stays with its row when rows are sorted or removed', async () => {
    await page.click('nav [data-sec="family"]');
    await page.evaluate(() => { cur.family.children[0].b_date = '--/--/1900'; cur.family.children[1].b_date = '--/--/1850'; renderMain(); });
    await page.click('[data-act=fsrc][data-path="family.children.0"][data-fkey="name"]');
    const first = await page.evaluate(() => cur.family.children[0].name);
    await page.click('[data-act=sort][data-path="family.children"]');
    const afterSort = await page.evaluate(() => { const d = document.querySelector('.fsrc[data-for^="family.children."]'); const i = d ? +d.dataset.for.split('|')[0].split('.')[2] : -1; return [i, i >= 0 ? cur.family.children[i].name : '']; });
    await page.click('[data-act=del][data-path="family.children.0"]'); await page.click('[data-act=del][data-path="family.children.0"]');
    const afterDel = await page.evaluate(() => { const d = document.querySelector('.fsrc[data-for^="family.children."]'); return [d ? d.dataset.for.split('|')[0] : '', cur.family.children.length, cur.family.children[0].name]; });
    ok(afterSort[1] === first && afterSort[0] === 1 && afterDel[0] === 'family.children.0' && afterDel[2] === first, 'an open source panel stays with its row when rows are sorted or removed');
  });
  await step('cut sections are hidden but kept in the data', async () => {
    const r = await page.evaluate(() => [!!document.querySelector('nav [data-sec="aff"]'), !!document.querySelector('nav [data-sec="va"]'), !!document.querySelector('nav [data-sec="slavery"]'), !!document.querySelector('nav [data-sec="medical"]'), 'aff' in cur && 'slavery' in cur]);
    ok(!r[0] && !r[1] && !r[2] && !r[3] && r[4], 'cut sections are hidden but kept in the data');
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
  await step('an admin can review a typed value and add it to a list, then remove it', async () => {
    await page.click('[data-act=customvals]');
    await page.waitForSelector('[data-act=promote]', T);
    const row = await page.$eval('[data-act=promote]', b => b.closest('tr').textContent);
    await page.click('[data-act=promote]');
    await page.waitForSelector('[data-act=rmopt]', T);
    const listed = await page.evaluate(() => 'Narnia' in CODES.STATES && !!document.querySelector('#dl-STATES option[value="Narnia"]'));
    await page.click('[data-act=rmopt]'); await page.click('[data-act=rmopt]');
    await page.waitForSelector('[data-act=promote]', T);
    const gone = await page.evaluate(() => !('Narnia' in CODES.STATES));
    ok(/Narnia/.test(row) && listed && gone, 'an admin can review a typed value and add it to a list, then remove it');
  });
  await step('no horizontal scrolling on a phone', async () => {
    await page.setViewportSize({ width: 400, height: 850 });
    await page.click('nav [data-sec="records"]'); await page.waitForSelector('.rtab tbody tr', T);
    await page.click('[data-act=open]'); await page.waitForSelector('.prov', T);
    const wide = [];
    for (const id of ['meta', 'personal', 'family', 'service', 'apps', 'deps']) {
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

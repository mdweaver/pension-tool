#!/usr/bin/env node
// Repo checks run by .github/workflows/deploy.yml before anything is deployed. Run locally with:
//   node tools/check.js                 (checks the working tree)
//   BASE_SHA=origin/main node tools/check.js   (also compares against what is already deployed)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { ROOT, loadSchema, schemaShape, compareShapes, dataDictionaryCSV } = require('./lib');

const errors = [], warnings = [], notes = [];
const gh = !!process.env.GITHUB_ACTIONS;
const err = (msg, file) => { errors.push(msg); if (gh) console.log(`::error${file ? ` file=${file}` : ''}::${msg}`); };
const warn = (msg, file) => { warnings.push(msg); if (gh) console.log(`::warning${file ? ` file=${file}` : ''}::${msg}`); };
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const BASE = process.env.BASE_SHA && !/^0+$/.test(process.env.BASE_SHA) ? process.env.BASE_SHA : null;
const baseHas = BASE && (() => { try { git('cat-file', '-e', BASE + '^{commit}'); return true; } catch (e) { return false; } })();

// 1. JavaScript parses
const jsFiles = ['config.js', ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f),
  ...fs.readdirSync(path.join(ROOT, 'tools')).filter(f => f.endsWith('.js')).map(f => 'tools/' + f)];
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
  catch (e) { err(`JavaScript syntax error in ${f}: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`, f); }
}

// 2. config.js holds only public values
try {
  const cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  const key = (cfg.match(/SUPABASE_ANON_KEY\s*:\s*['"]([^'"]*)['"]/) || [])[1] || '';
  const url = (cfg.match(/SUPABASE_URL\s*:\s*['"]([^'"]*)['"]/) || [])[1] || '';
  if (key.startsWith('sb_secret_')) err('config.js contains a SECRET key (sb_secret_...). Use the publishable/anon key and rotate the secret key in Supabase now.', 'config.js');
  else if (key.split('.').length === 3) {
    try { const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; if (role !== 'anon') err(`config.js key has role "${role}". Only the anon/publishable key belongs here; rotate this key in Supabase now.`, 'config.js'); } catch (e) { warn('config.js key looks like a JWT but could not be read.', 'config.js'); }
  } else if (key && !key.startsWith('sb_publishable_')) warn('config.js key is not a recognised publishable or anon key.', 'config.js');
  if (url && !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) warn(`config.js URL looks unusual: ${url}`, 'config.js');
  if (!url || !key) notes.push('config.js is blank: the site will run in demo mode.');
} catch (e) { err('config.js is missing or unreadable.'); }

// 3. Schema: lock file current, no unacknowledged breaking change, dictionary current
let S;
try { S = loadSchema(); } catch (e) { err('js/schema.js failed to load: ' + e.message, 'js/schema.js'); }
if (S) {
  const shape = schemaShape(S);
  const lockPath = path.join(ROOT, 'schema.lock.json');
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
  if (!lock) err('schema.lock.json is missing. Run: node tools/update.js');
  else {
    const vsLock = compareShapes(lock.shape, shape), vsNew = compareShapes(shape, lock.shape);
    if (vsLock.breaking.length || vsLock.added.length || vsNew.added.length || JSON.stringify(lock.shape.codes) !== JSON.stringify(shape.codes))
      err('js/schema.js changed but schema.lock.json was not regenerated. Run: node tools/update.js (it will stop you if the change would orphan saved data).', 'schema.lock.json');
    if (baseHas) {
      let baseLock = null;
      try { baseLock = JSON.parse(git('show', `${BASE}:schema.lock.json`)); } catch (e) { /* no lock yet at base */ }
      if (baseLock) {
        const acked = new Set((lock.acknowledged_breaking || []).map(a => a.change));
        const cmp = compareShapes(baseLock.shape, shape);
        for (const b of cmp.breaking) (acked.has(b) ? warn : err)(acked.has(b) ? `Acknowledged breaking change: ${b}. Make sure a data migration handles saved records.` : `Breaking change to saved-data shape: ${b}. Revert it, or run node tools/update.js --allow-breaking and add a data migration.`, 'js/schema.js');
        for (const w of cmp.warnings) warn(w, 'js/schema.js');
        if (cmp.added.length) notes.push('Fields added: ' + cmp.added.join(', '));
      }
    }
  }
  const dict = fs.existsSync(path.join(ROOT, 'data_dictionary.csv')) ? fs.readFileSync(path.join(ROOT, 'data_dictionary.csv'), 'utf8') : '';
  if (dict !== dataDictionaryCSV(S)) err('data_dictionary.csv is out of date. Run: node tools/update.js', 'data_dictionary.csv');
}

// 4. Migrations: well named; applied ones never edited, renamed or deleted; new ones sort last
const migDir = 'supabase/migrations';
const migs = fs.readdirSync(path.join(ROOT, migDir)).filter(f => f.endsWith('.sql')).sort();
for (const f of migs) if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(f)) err(`Migration name must look like 20261101120000_short_name.sql: ${f}`, `${migDir}/${f}`);
if (baseHas) {
  const changes = git('diff', '--name-status', '--no-renames', BASE, 'HEAD', '--', migDir).split('\n').filter(Boolean);
  const wt = git('status', '--porcelain', '--', migDir).split('\n').filter(Boolean);
  const baseFiles = git('ls-tree', '--name-only', BASE, migDir + '/').split('\n').filter(Boolean).map(p => path.basename(p)).sort();
  const lastBase = baseFiles[baseFiles.length - 1] || '';
  for (const line of changes) {
    const [st, p] = line.split('\t');
    if (st === 'M') err(`Applied migration was edited: ${p}. Migrations never re-run, so the change would silently not happen. Revert it and put the change in a NEW migration file.`, p);
    if (st === 'D') err(`Applied migration was deleted: ${p}. Restore it; undo its effect with a new migration instead.`, p);
    if (st === 'A' && path.basename(p) <= lastBase) err(`New migration ${path.basename(p)} sorts before the last applied one (${lastBase}). Give it a later timestamp.`, p);
  }
  for (const line of wt) if (/^ ?M/.test(line) && baseFiles.includes(path.basename(line.slice(3)))) err(`Applied migration has uncommitted edits: ${line.slice(3)}`);
}

// 5. No secrets and no exported data in tracked files
const tracked = git('ls-files').split('\n').filter(Boolean);
const secretPatterns = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/sbp_[A-Za-z0-9]{30,}/, 'Supabase access token'],
  [/postgres(?:ql)?:\/\/[^\s:@'"]+:(?![<\[])[^\s@'"<>\[\]]{6,}@[^\s'"]*supabase/, 'database connection string with password'],
  [/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/, 'private key'],
  [/ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/AGE-SECRET-KEY-1[0-9A-Z]{20,}/, 'private backup key (age; make a new key pair after removing it)']
];
for (const f of tracked) {
  if (/\.age$|(^|\/)(public_data|auth_data)\.sql$|(^|\/)(records|record_versions|profiles)\.jsonl$/.test(f)) err(`Backup file is committed: ${f}. Backups belong in the workflow artifacts and the backup-latest release, never in the repo.`, f);
  if (/(^|\/)(pension_records_[^/]*|[^/]*_\d{4}-\d{2}-\d{2})\.(json|csv)$/.test(f)) err(`Exported data file is committed: ${f}. Data belongs in Supabase, not the repo. Remove it (git rm --cached).`, f);
  let txt; try { const st = fs.statSync(path.join(ROOT, f)); if (st.size > 2e6) continue; txt = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
  for (const [re, what] of secretPatterns) if (re.test(txt)) err(`Possible ${what} in ${f}. Remove it and rotate the credential.`, f);
  const jwts = txt.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
  for (const t of jwts) { try { const role = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).role; if (role && role !== 'anon') err(`A "${role}" key (JWT) is committed in ${f}. Remove it and rotate it in Supabase.`, f); } catch (e) {} }
}

// Report
const out = [];
out.push(errors.length ? `✗ ${errors.length} problem(s)` : '✓ Repo checks passed');
for (const e of errors) out.push('  ERROR   ' + e);
for (const w of warnings) out.push('  warning ' + w);
for (const n of notes) out.push('  note    ' + n);
console.log(out.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Repo checks\n```\n' + out.join('\n') + '\n```\n');
process.exit(errors.length ? 1 : 0);

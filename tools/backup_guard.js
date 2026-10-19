#!/usr/bin/env node
// Decides whether a new backup may replace "backup-latest".
//   node tools/backup_guard.js PREVIOUS_manifest.json NEW_manifest.json [--allow-shrink]
// Refuses (exit 1) if history shrank (it never shrinks in normal use), if every record vanished,
// or if active records dropped by more than 10%. Pass --allow-shrink after an intended large deletion.
const fs = require('fs');
const [prevPath, nextPath] = process.argv.slice(2);
const allow = process.argv.includes('--allow-shrink');
const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8')), next = JSON.parse(fs.readFileSync(nextPath, 'utf8'));
const problems = [];
if (next.record_versions < prev.record_versions) problems.push(`history entries fell from ${prev.record_versions} to ${next.record_versions} (history is never deleted in normal use)`);
if (prev.records_active > 0 && next.records_active === 0) problems.push(`all ${prev.records_active} records are gone`);
else if (next.records_active < prev.records_active * 0.9) problems.push(`active records fell from ${prev.records_active} to ${next.records_active} (more than 10%)`);
if (next.profiles < prev.profiles) problems.push(`people fell from ${prev.profiles} to ${next.profiles}`);
console.log(`previous backup ${prev.created_at}: ${prev.records_active} records, ${prev.record_versions} history entries, ${prev.profiles} people`);
console.log(`this backup     ${next.created_at}: ${next.records_active} records, ${next.record_versions} history entries, ${next.profiles} people`);
if (!problems.length) { console.log('OK: no sign of data loss.'); process.exit(0); }
for (const p of problems) console.log((allow ? '::warning::' : '::error::') + 'Possible data loss: ' + p);
if (allow) { console.log('Allowed by --allow-shrink.'); process.exit(0); }
console.log('backup-latest was NOT replaced, so the previous good backup is kept. If this drop was intended, re-run the workflow with "allow shrink" ticked.');
process.exit(1);

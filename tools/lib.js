// Shared helpers for the repo checks. Loads js/schema.js outside a browser.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

function loadSchema(file) {
  const src = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(path.join(ROOT, 'js/schema.js'), 'utf8');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.__out = { SCHEMA, CODES, HELP };', ctx, { filename: 'schema.js' });
  return ctx.__out;
}

// The parts of the schema that stored data depends on: section/group ids, whether a group
// repeats, field keys and types, sub-blocks, and the codes in each code list.
function schemaShape(S) {
  const shape = { sections: {}, codes: {} };
  const fieldsShape = fields => {
    const o = {};
    for (const f of fields) {
      if (f.t === 'br') continue;
      if (f.t === 'sub') { o[f.k] = { type: 'sub', fields: fieldsShape(f.fields) }; continue; }
      o[f.k] = { type: f.t === 'name' ? 'text' : f.t };
      if (f.t === 'code') o[f.k].list = f.list;
      if (f.t === 'date' && f.q) o[f.k].quality = true;
    }
    return o;
  };
  for (const s of S.SCHEMA) {
    shape.sections[s.id] = {};
    for (const g of s.groups) shape.sections[s.id][g.id] = { repeat: !!g.repeat, fields: fieldsShape(g.fields) };
  }
  for (const [k, v] of Object.entries(S.CODES)) shape.codes[k] = Object.keys(v).sort();
  return shape;
}

// Compare an old shape with a new one. Returns { breaking: [...], warnings: [...], added: [...] }.
function compareShapes(oldS, newS) {
  const breaking = [], warnings = [], added = [];
  const cmpFields = (a, b, where) => {
    for (const k of Object.keys(a)) {
      if (!(k in b)) { breaking.push(`field removed or renamed: ${where}.${k}`); continue; }
      if (a[k].type !== b[k].type) breaking.push(`field type changed: ${where}.${k} (${a[k].type} -> ${b[k].type})`);
      if (a[k].type === 'sub' && b[k].type === 'sub') cmpFields(a[k].fields, b[k].fields, `${where}.${k}`);
      if (a[k].list && b[k].list && a[k].list !== b[k].list) warnings.push(`code list changed: ${where}.${k} (${a[k].list} -> ${b[k].list})`);
      if (a[k].quality && !b[k].quality) breaking.push(`quality code removed from date: ${where}.${k}`);
    }
    for (const k of Object.keys(b)) if (!(k in a)) added.push(`${where}.${k}`);
  };
  for (const [sid, groups] of Object.entries(oldS.sections)) {
    if (!(sid in newS.sections)) { breaking.push(`section removed or renamed: ${sid}`); continue; }
    for (const [gid, g] of Object.entries(groups)) {
      const ng = newS.sections[sid][gid];
      if (!ng) { breaking.push(`block removed or renamed: ${sid}.${gid}`); continue; }
      if (g.repeat !== ng.repeat) breaking.push(`block changed between one-off and repeatable: ${sid}.${gid}`);
      cmpFields(g.fields, ng.fields, `${sid}.${gid}`);
    }
    for (const gid of Object.keys(newS.sections[sid])) if (!(gid in groups)) added.push(`${sid}.${gid}`);
  }
  for (const sid of Object.keys(newS.sections)) if (!(sid in oldS.sections)) added.push(sid);
  for (const [list, codes] of Object.entries(oldS.codes)) {
    const now = newS.codes[list];
    if (!now) { warnings.push(`code list removed: ${list}`); continue; }
    const gone = codes.filter(c => !now.includes(c));
    if (gone.length) warnings.push(`codes removed from ${list}: ${gone.join(', ')} (records already using them will be flagged)`);
  }
  return { breaking, warnings, added };
}

function dataDictionaryCSV(S) {
  const out = [['section', 'group', 'repeatable', 'subgroup', 'field', 'label', 'type', 'codes', 'ua_var', 'origin', 'help']];
  for (const s of S.SCHEMA) for (const g of s.groups) {
    const walk = (fields, sub) => {
      for (const f of fields) {
        if (f.t === 'br') continue;
        if (f.t === 'sub') { walk(f.fields, f.k); continue; }
        const origin = f.tag === 'navy' ? 'adapted for Navy' : f.tag === 'project' ? 'new for this project' : (f.ua ? 'Union Army program' : 'new');
        const codes = f.t === 'code' ? (f.list === 'STATES' ? 'state/country codes (Appendix A)' : Object.entries(S.CODES[f.list]).map(([k, v]) => k + '=' + v).join('; ')) : (f.t === 'x' ? 'X' : '');
        out.push([s.id, g.id, g.repeat ? 'yes' : 'no', sub || '', f.k, f.l, f.t === 'name' ? 'text (name rule)' : f.t, codes, f.ua || '', origin, (f.help || S.HELP[f.ua] || '')]);
        if (f.t === 'date' && f.q) out.push([s.id, g.id, g.repeat ? 'yes' : 'no', sub || '', f.k + '_q', 'Quality code for ' + f.l, 'code', 'quality codes 1–9, B', f.uaq || '', origin, '']);
      }
    };
    walk(g.fields, '');
  }
  return out.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
}

const stable = o => JSON.stringify(o, null, 1) + '\n';
module.exports = { ROOT, loadSchema, schemaShape, compareShapes, dataDictionaryCSV, stable };

/* =====================================================================
   DATA LAYER — two interchangeable backends with the same methods.
   SupabaseBackend talks to your Supabase project (logins, records, history).
   DemoBackend keeps everything in this browser and follows the same rules,
   so the page can be tried without a server.
   ===================================================================== */
function SupabaseBackend(url, key){
  if (!window.supabase || !window.supabase.createClient) throw new Error('The Supabase library did not load. Check your internet connection and reload.');
  const sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  const chk = ({ data, error }) => { if (error) throw error; return data; };
  let user = null;
  return {
    kind: 'supabase',
    async init(){ const { data } = await sb.auth.getSession(); user = data.session ? data.session.user : null; return user; },
    async signIn(email, pw){ const r = await sb.auth.signInWithPassword({ email, password: pw }); if (r.error) throw r.error; user = r.data.user; return user; },
    async signOut(){ await sb.auth.signOut(); user = null; },
    async me(){ return chk(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle()); },
    async list(includeDeleted){
      let all = [];
      for (let from = 0; ; from += 1000){
        let q = sb.from('records_overview').select('*').order('updated_at', { ascending: false }).range(from, from + 999);
        if (!includeDeleted) q = q.is('deleted_at', null);
        const d = chk(await q); all = all.concat(d); if (d.length < 1000) break;
      }
      return all;
    },
    async get(uid){
      const r = chk(await sb.from('records').select('uid,data,version,created_at,updated_at,deleted_at').eq('uid', uid).single());
      const o = chk(await sb.from('records_overview').select('created_by_name,updated_by_name').eq('uid', uid).single());
      return Object.assign(r, o);
    },
    async save(uid, data, base){ return chk(await sb.rpc('save_record', { p_uid: uid, p_data: data, p_base_version: base })); },
    async versions(uid){
      const v = chk(await sb.from('record_versions').select('version,action,edited_at,edited_by').eq('record_uid', uid).order('version', { ascending: false }));
      const ps = chk(await sb.from('profiles').select('id,display_name'));
      const names = Object.fromEntries(ps.map(p => [p.id, p.display_name]));
      return v.map(x => Object.assign(x, { who: names[x.edited_by] || '?' }));
    },
    async changes(uid){ return chk(await sb.rpc('record_changes', { p_uid: uid })) || []; },
    async versionData(uid, v){ return chk(await sb.from('record_versions').select('data').eq('record_uid', uid).eq('version', v).single()).data; },
    async setDeleted(uid, del){ chk(await sb.rpc('set_record_deleted', { p_uid: uid, p_deleted: del })); },
    async team(){ return chk(await sb.from('profiles').select('*').order('email')); },
    async updateProfile(id, patch){
      const d = chk(await sb.from('profiles').update(patch).eq('id', id).select());
      if (!d.length) throw new Error('Only an admin can change other people\'s accounts.');
      return d[0];
    },
    async activity(){ return chk(await sb.from('ra_activity').select('*').order('day', { ascending: false }).limit(300)); },
    async setMyName(n){ chk(await sb.rpc('set_my_display_name', { p_name: n })); },
    async changePassword(pw){ const r = await sb.auth.updateUser({ password: pw }); if (r.error) throw r.error; },
    async allData(){
      let all = [];
      for (let from = 0; ; from += 500){
        const d = chk(await sb.from('records').select('uid,data').is('deleted_at', null).order('uid').range(from, from + 499));
        all = all.concat(d.map(x => Object.assign(x.data, { _uid: x.uid }))); if (d.length < 500) break;
      }
      return all;
    }
  };
}

function flatPaths(o, p, out){
  p = p || []; out = out || {};
  if (o && typeof o === 'object'){
    if (Array.isArray(o)) o.forEach((v, i) => flatPaths(v, p.concat(String(i)), out));
    else for (const k in o) flatPaths(o[k], p.concat(k), out);
  } else if (o != null && String(o) !== '') out[p.join('.')] = String(o);
  return out;
}

function DemoBackend(){
  const KEY = 'spe.demo.db.v2', SKEY = 'spe.demo.session.v2';
  const iso = (minsAgo) => new Date(Date.now() - (minsAgo || 0) * 60000).toISOString();
  let db = null, uid = null;
  const load = () => { try { const d = JSON.parse(sget(KEY) || 'null'); if (d && d.profiles) return d; } catch (e) {} return seed(); };
  const store = () => sset(KEY, JSON.stringify(db));
  const prof = id => db.profiles.find(p => p.id === id);
  const meP = () => prof(uid);
  const active = () => !!(meP() && meP().active);
  const admin = () => active() && meP().role === 'admin';
  const fresh = () => { db = load(); };
  const need = () => { fresh(); if (!active()) throw new Error('Your account isn\'t active yet. Ask an admin to switch it on.'); };
  const clone = x => JSON.parse(JSON.stringify(x));
  function write(asUser, recUid, data, base, at){
    const r = db.records[recUid];
    if (!r){
      db.records[recUid] = { uid: recUid, data: clone(data), version: 1, created_by: asUser, created_at: at, updated_by: asUser, updated_at: at, deleted_at: null };
      db.versions.push({ record_uid: recUid, version: 1, action: 'create', data: clone(data), edited_by: asUser, edited_at: at });
      return { ok: true, version: 1, updated_at: at, created: true };
    }
    if (r.deleted_at) throw new Error('An admin deleted this record. Ask them to restore it.');
    if (r.version !== (base || 0)) return { ok: false, conflict: true, version: r.version, updated_by: (prof(r.updated_by) || {}).display_name, updated_at: r.updated_at };
    if (JSON.stringify(r.data) === JSON.stringify(data)) return { ok: true, version: r.version, updated_at: r.updated_at };
    Object.assign(r, { data: clone(data), version: r.version + 1, updated_by: asUser, updated_at: at });
    db.versions.push({ record_uid: recUid, version: r.version, action: 'edit', data: clone(data), edited_by: asUser, edited_at: at });
    return { ok: true, version: r.version, updated_at: at };
  }
  function seed(){
    db = { profiles: [
      { id: 'u-admin', email: 'you@example.edu', display_name: 'You (PI)', role: 'admin', active: true, created_at: iso(5000) },
      { id: 'u-ada', email: 'ada@example.edu', display_name: 'Ada', role: 'ra', active: true, created_at: iso(4000) },
      { id: 'u-ben', email: 'ben@example.edu', display_name: 'Ben', role: 'ra', active: true, created_at: iso(4000) },
      { id: 'u-new', email: 'new.ra@example.edu', display_name: 'New RA', role: 'ra', active: false, created_at: iso(30) }
    ], records: {}, versions: [] };
    // A fictional record: Ada starts it yesterday, Ben adds to it this morning.
    const ex = exampleRecord(); ex._uid = 'rexample0001';
    const first = clone(ex); first.family.children = first.family.children.slice(0, 1); first.aff.aff = [blankFields(SCHEMA.find(s => s.id === 'aff').groups[0].fields)]; first.meta.file.status = 'P';
    write('u-ada', ex._uid, first, 0, iso(60 * 20));
    const second = clone(first); second.family.children = clone(ex.family.children); second.aff.aff = clone(ex.aff.aff); second.personal.names[0].name = 'EXAMPLE, JAMES HENRY';
    write('u-ben', ex._uid, second, 1, iso(90));
    return db;
  }
  return {
    kind: 'demo',
    async init(){ db = load(); store(); uid = sget(SKEY) || null; if (uid && !prof(uid)) uid = null; return uid ? { id: uid, email: meP().email } : null; },
    demoUsers(){ fresh(); return db.profiles.map(p => ({ email: p.email, label: `${p.display_name} · ${p.role === 'admin' ? 'admin' : 'RA'}${p.active ? '' : ' (not yet active)'}` })); },
    async signIn(email){ const p = db.profiles.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase()); if (!p) throw new Error('Invalid login credentials'); uid = p.id; sset(SKEY, uid); return { id: uid, email: p.email }; },
    async signOut(){ uid = null; sset(SKEY, ''); },
    async me(){ fresh(); return clone(meP()); },
    async list(includeDeleted){ fresh();
      if (!active()) return [];
      return Object.values(db.records).filter(r => includeDeleted || !r.deleted_at).map(r => ({
        uid: r.uid, sailor_id: r.data.meta.file.sailor_id || null, sailor_name: (r.data.personal.names[0] || {}).name || null, status: r.data.meta.file.status || null,
        version: r.version, created_at: r.created_at, created_by_name: (prof(r.created_by) || {}).display_name, updated_at: r.updated_at,
        updated_by_name: (prof(r.updated_by) || {}).display_name, n_editors: new Set(db.versions.filter(v => v.record_uid === r.uid).map(v => v.edited_by)).size, deleted_at: r.deleted_at
      })).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    async get(recUid){ need(); const r = db.records[recUid]; if (!r) throw new Error('Record not found'); return { uid: r.uid, data: clone(r.data), version: r.version, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at, created_by_name: (prof(r.created_by) || {}).display_name, updated_by_name: (prof(r.updated_by) || {}).display_name }; },
    async save(recUid, data, base){ need(); await new Promise(r => setTimeout(r, 250)); const res = write(uid, recUid, data, base, new Date().toISOString()); store(); return res; },
    async versions(recUid){ need(); return db.versions.filter(v => v.record_uid === recUid).sort((a, b) => b.version - a.version).map(v => ({ version: v.version, action: v.action, edited_at: v.edited_at, edited_by: v.edited_by, who: (prof(v.edited_by) || {}).display_name || '?' })); },
    async changes(recUid){
      need();
      const vs = db.versions.filter(v => v.record_uid === recUid).sort((a, b) => a.version - b.version); const out = [];
      vs.forEach((v, i) => {
        const a = i ? flatPaths(vs[i - 1].data) : {}, b = flatPaths(v.data);
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => k[0] !== '_' && k !== 'meta.file.minutes').sort();
        for (const k of keys) if (a[k] !== b[k]) out.push({ version: v.version, action: v.action, edited_at: v.edited_at, edited_by: (prof(v.edited_by) || {}).display_name, path: k, old_value: a[k] ?? null, new_value: b[k] ?? null });
      });
      return out;
    },
    async versionData(recUid, ver){ need(); return clone(db.versions.find(v => v.record_uid === recUid && v.version === ver).data); },
    async setDeleted(recUid, del){ fresh();
      if (!admin()) throw new Error('Only an admin can delete or restore a record.');
      const r = db.records[recUid]; const at = new Date().toISOString();
      r.deleted_at = del ? at : null; r.version += 1; r.updated_by = uid; r.updated_at = at;
      db.versions.push({ record_uid: recUid, version: r.version, action: del ? 'delete' : 'restore', data: clone(r.data), edited_by: uid, edited_at: at }); store();
    },
    async team(){ need(); return clone(db.profiles).sort((a, b) => a.email.localeCompare(b.email)); },
    async updateProfile(id, patch){ fresh();
      if (!admin()) throw new Error('Only an admin can change other people\'s accounts.');
      const p = prof(id);
      if (id === uid && (('role' in patch && patch.role !== p.role) || ('active' in patch && patch.active !== p.active))) throw new Error('You can\'t change your own role or switch off your own account. Ask another admin.');
      Object.assign(p, patch); store(); return clone(p);
    },
    async activity(){
      need(); const m = {};
      for (const v of db.versions){ const p = prof(v.edited_by); const day = new Date(v.edited_at).toLocaleDateString('en-CA'); const k = p.id + '|' + day;
        m[k] = m[k] || { display_name: p.display_name, email: p.email, day, records_created: 0, saves: 0, _recs: new Set(), first_save: v.edited_at, last_save: v.edited_at };
        const a = m[k]; if (v.action === 'create') a.records_created++; if (v.action === 'edit') a.saves++; a._recs.add(v.record_uid);
        if (v.edited_at < a.first_save) a.first_save = v.edited_at; if (v.edited_at > a.last_save) a.last_save = v.edited_at; }
      return Object.values(m).map(a => Object.assign(a, { records_touched: a._recs.size, _recs: undefined })).sort((a, b) => b.day.localeCompare(a.day) || a.display_name.localeCompare(b.display_name));
    },
    async setMyName(n){ fresh(); meP().display_name = String(n).trim().slice(0, 60); store(); },
    async changePassword(){ /* demo: nothing to change */ },
    async allData(){ need(); return Object.values(db.records).filter(r => !r.deleted_at).map(r => Object.assign(clone(r.data), { _uid: r.uid })); },
    resetDemo(){ sset(KEY, ''); sset(SKEY, ''); }
  };
}

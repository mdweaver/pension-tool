/* ---------- top bar, nav, save state ---------- */
function renderSaveState(){
  const el=$('#saved'), btn=$('#b-save'); if (!el) return;
  if (!cur || view==='login'){ el.textContent=''; el.className='saved'; if (btn) btn.hidden=true; return; }
  if (btn) btn.hidden=false;
  if (saving){ el.textContent='Saving…'; el.className='saved'; }
  else if (curMeta.deleted){ el.textContent='Deleted · read-only'; el.className='saved bad'; }
  else if (dirty){ el.textContent='Unsaved changes'; el.className='saved dirty'; }
  else if (curMeta.isNew){ el.textContent='Not saved yet'; el.className='saved dirty'; }
  else { el.textContent=`Saved · v${curMeta.version} · ${fmtTime(curMeta.updated_at)}`; el.className='saved ok'; }
  if (btn) btn.disabled = saving || curMeta.deleted;
}
function renderTop(){
  const signed = ME && view!=='login';
  for (const id of ['b-records','b-new','b-exp','b-me']) { const b=document.getElementById(id); if (b) b.hidden=!signed || (id==='b-new' && !(ME && ME.active)); }
  if (signed) $('#b-me').textContent = `${ME.display_name||ME.email}${isAdmin()?' · admin':''}`;
  if (!signed || !cur){ $('#cur').innerHTML = signed ? '<span class="sid">No file open</span>' : ''; renderSaveState(); return; }
  const st=cur.meta.file.status||'P';
  $('#cur').innerHTML=`<b>${esc(recName(cur))}</b><span class="sid">${esc(cur.meta.file.sailor_id||'no Sailor ID')}</span><span class="pill st-${st==='C'?'complete':st==='K'?'checked':'prog'}">${esc(CODES.STATUS[st]||st)}</span>${curMeta.deleted?'<span class="pill example">Deleted</span>':''}`;
  renderSaveState();
}
function renderNav(){
  if (view==='login' || !ME || !ME.active){ $('#idx').innerHTML=''; return; }
  const checks = cur ? allChecks(cur) : [];
  let h = `<a href="#" data-sec="records" class="${view==='records'?'on':''}"><span class="n">≡</span><span>All records</span><span></span></a>`;
  if (isAdmin()) h += `<a href="#" data-sec="team" class="${view==='team'?'on':''}"><span class="n">◎</span><span>Team & activity</span><span></span></a>`;
  if (cur){
    h+='<div class="grp">This file</div>';
    for (const s of SCHEMA){ const n=checks.filter(c=>c.sec===s.id).length;
      h+=`<a href="#" data-sec="${s.id}" class="${view==='edit'&&curSec===s.id?'on':''}"><span class="n">${s.n}</span><span>${esc(s.title)}</span>${n?`<span class="b" title="${n} item(s) to check">${n}</span>`:'<span></span>'}</a>`; }
    if (!curMeta.isNew) h+=`<a href="#" data-sec="history" class="${view==='history'?'on':''}"><span class="n">↺</span><span>Edit history</span><span></span></a>`;
  }
  h+=`<div class="kbd"><kbd>Enter</kbd> next field<br><kbd>Alt</kbd>+<kbd>↓</kbd>/<kbd>↑</kbd> next / previous section<br><kbd>Ctrl</kbd>+<kbd>S</kbd> save<br>Type <kbd>-</kbd> for unreadable date digits</div>`;
  $('#idx').innerHTML=h;
}
function renderMain(){
  if (view==='login') return renderLogin();
  if (ME && !ME.active) return renderInactive();
  if (view==='records') return renderRecords();
  if (view==='history') return renderHistory();
  if (view==='team') return renderTeam();
  const s=secById(curSec);
  let h=`<div class="sechead"><h1>${esc(s.title)}</h1><span class="ua">${esc(s.ua)}</span></div><p class="intro">${s.intro}</p>`;
  if (curSec==='meta'){
    if (curMeta.deleted) h+=`<div class="callout">An admin deleted this record, so it can't be saved. Its history is kept.${isAdmin()?' <button class="btn" data-act="restore" data-uid="'+esc(cur._uid)+'" type="button">Restore it</button>':''}</div>`;
    if (staleDraft) h+=`<div class="callout">You have <b>unsaved changes from ${esc(fmtTime(staleDraft.at))}</b>, made on an older version of this record. Someone has saved it since. <div class="tools" style="margin-top:8px"><button class="btn" data-act="usedraft" type="button">Load my unsaved copy</button><button class="btn ghost" data-act="dropdraft" type="button">Discard it</button></div><span class="hint">If you load it, saving will show what changed and let you choose.</span></div>`;
    h+= curMeta.isNew ? `<div class="prov">New record. It will be saved under your name, <b>${esc(ME.display_name)}</b>.</div>`
      : `<div class="prov">Created by <b>${esc(curMeta.created_by_name||'?')}</b> on ${esc(fmtTime(curMeta.created_at))} · last saved by <b>${esc(curMeta.updated_by_name||'?')}</b> on ${esc(fmtTime(curMeta.updated_at))} (version ${curMeta.version}) · <a href="#" data-sec="history">see edit history</a></div>`;
  }
  for (const g of s.groups) h+=groupHTML(s,g);
  const i=SCHEMA.indexOf(s);
  h+=`<div class="tools" style="margin-top:6px">${i>0?`<button class="btn" data-sec="${SCHEMA[i-1].id}" type="button">← ${esc(SCHEMA[i-1].title)}</button>`:''}${i<SCHEMA.length-1?`<button class="btn" data-sec="${SCHEMA[i+1].id}" type="button">${esc(SCHEMA[i+1].title)} →</button>`:''}<button class="btn primary" data-act="save" type="button">Save</button></div>`;
  $('#main').innerHTML=h;
}

/* ---------- sign-in ---------- */
function renderLogin(){
  const demo = API.kind==='demo';
  $('#main').innerHTML=`<div class="login"><div class="gcard">
    <div class="eyebrow">${demo?'Demo · data stays in this browser':'Sign in'}</div><h3>Sailor Pension Entry</h3>
    <p class="hint">${demo?'Pick someone to sign in as. Try an RA and the admin to see how edits are attributed.':'Use the email and password your project admin gave you.'}</p>
    <form id="loginform" class="stack">
      <label for="li-email">Email</label><input class="in txtplain" id="li-email" type="email" autocomplete="username" required>
      ${demo?'':`<label for="li-pw">Password</label><input class="in txtplain" id="li-pw" type="password" autocomplete="current-password" required>`}
      <button class="btn primary" type="submit" id="li-go">Sign in</button>
      <div id="li-msg" class="errline" role="alert"></div>
    </form>
    ${demo?`<div class="stack" style="margin-top:12px">${API.demoUsers().map(u=>`<button class="btn" type="button" data-act="demoas" data-email="${esc(u.email)}">${esc(u.label)}</button>`).join('')}</div>
      <p class="hint" style="margin-top:12px">To connect a real database, set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in <code>config.js</code>. <button class="linkbtn" data-act="demoreset" type="button">Reset demo data</button></p>`:
      `<p class="hint" style="margin-top:12px">Forgot your password? Ask the project admin to reset it.</p>`}
  </div></div>`;
  setTimeout(()=>$('#li-email')?.focus(),10);
}
function renderInactive(){
  $('#main').innerHTML=`<div class="login"><div class="gcard"><div class="eyebrow">Signed in as ${esc(ME.email)}</div><h3>Waiting for an admin</h3>
  <p>Your account exists but hasn't been switched on yet. Ask the project admin to activate it on the Team page, then reload this page.</p>
  <div class="tools"><button class="btn" data-act="reload" type="button">Reload</button><button class="btn ghost" data-act="signout" type="button">Sign out</button></div></div></div>`;
}

/* ---------- records list ---------- */
async function refreshList(){ try { LIST = await API.list(isAdmin() && showDeleted); } catch(e){ toast(errMsg(e,'Could not load the records list.')); } }
function renderRecords(){
  const q=listQ.trim().toUpperCase();
  const rows=LIST.filter(r=>!q || [r.sailor_name,r.sailor_id,r.created_by_name,r.updated_by_name].some(v=>String(v||'').toUpperCase().includes(q)));
  const onServer=new Set(LIST.map(r=>r.uid));
  const unsaved=myDrafts().filter(d=>d.isNew && !onServer.has(d.data._uid));
  let h=`<div class="recs"><div class="sechead"><h1>Pension files</h1><span class="ua">${LIST.length} on the server</span></div>
  <p class="intro">Everyone on the team sees the same list. Every save is recorded with the person's name, so the history shows who entered or changed each field.</p>
  <div class="tools" style="margin-bottom:12px"><button class="btn primary" data-act="newrec" type="button">New record</button>
   <input class="in txtplain" id="listq" placeholder="Search name, Sailor ID or RA" value="${esc(listQ)}" style="--w:30" aria-label="Search records">
   <button class="btn" data-act="refresh" type="button">Refresh</button><button class="btn" data-act="import" type="button">Import JSON…</button><button class="btn" data-act="expall" type="button">Export all</button>
   ${isAdmin()?`<label class="chkl"><input type="checkbox" id="showdel" ${showDeleted?'checked':''}> Show deleted</label>`:''}
   <input type="file" id="impfile" accept=".json,application/json" hidden></div>`;
  if (unsaved.length) h+=`<div class="callout"><b>Not yet on the server:</b> ${unsaved.map(d=>`<button class="linkbtn" data-act="opendraft" data-uid="${esc(d.data._uid)}" type="button">${esc(recName(upgrade(d.data)))} (${esc(d.data.meta.file.sailor_id||'no ID')})</button>`).join(', ')}. Open and save to share with the team.</div>`;
  if (!rows.length) h+=`<div class="rtab-wrap"><div class="empty">${LIST.length?'No records match that search.':'No records yet. Choose <b>New record</b> to enter the first pension file.'}</div></div>`;
  else {
    h+='<div class="rtab-wrap"><table class="rtab"><thead><tr><th>Sailor</th><th>Sailor ID</th><th>Status</th><th>Ver.</th><th>Created by</th><th>Last saved by</th><th>Last saved</th><th>Editors</th><th></th></tr></thead><tbody>';
    for (const r of rows){
      h+=`<tr class="${cur&&cur._uid===r.uid?'open':''}${r.deleted_at?' deleted':''}"><td class="m">${esc(r.sailor_name||'(no name)')}</td><td class="m">${esc(r.sailor_id||'')}</td><td>${esc(CODES.STATUS[r.status]||r.status||'')}</td><td class="m">${r.version}</td><td>${esc(r.created_by_name||'')}</td><td>${esc(r.updated_by_name||'')}</td><td class="m">${esc(fmtTime(r.updated_at))}</td><td class="m">${r.n_editors??''}</td>
      <td><div class="tools"><button class="btn" data-act="open" data-uid="${esc(r.uid)}" type="button">Open</button><button class="btn ghost" data-act="openhist" data-uid="${esc(r.uid)}" type="button">History</button>${isAdmin()?(r.deleted_at?`<button class="btn ghost" data-act="restore" data-uid="${esc(r.uid)}" type="button">Restore</button>`:`<button class="btn ghost danger" data-act="delrec" data-uid="${esc(r.uid)}" type="button">Delete</button>`):''}</div></td></tr>`;
    }
    h+='</tbody></table></div>';
  }
  $('#main').innerHTML=h+'</div>';
}

/* ---------- history ---------- */
function pathLabel(path){
  const ks=path.split('.'); const s=secById(ks[0]); if (!s) return path;
  const g=s.groups.find(x=>x.id===ks[1]); if (!g) return s.title+' › '+path;
  let lab=`${s.title} › ${g.title}`; let i=2;
  if (g.repeat && /^\d+$/.test(ks[2]||'')){ lab+=` ${+ks[2]+1}`; i=3; }
  const sub=g.fields.find(f=>f.t==='sub'&&f.k===ks[i]);
  if (sub){ lab+=` › ${sub.l} ${String.fromCharCode(65+(+ks[i+1]||0))}`; }
  const f=fieldForPath(path);
  return lab+' › '+(f?f.l:ks[ks.length-1]);
}
async function renderHistory(){
  if (!cur || curMeta.isNew){ goSec('records'); return; }
  $('#main').innerHTML=`<div class="sechead"><h1>Edit history</h1><span class="ua">${esc(recName(cur))}</span></div><p class="intro">Loading…</p>`;
  try {
    const [vers, ch] = await Promise.all([API.versions(cur._uid), API.changes(cur._uid)]);
    histCache = {vers, ch};
    const byV={}; for (const c of ch) (byV[c.version]=byV[c.version]||[]).push(c);
    const latest = vers.length ? vers[0].version : 0;
    let h=`<div class="sechead"><h1>Edit history</h1><span class="ua">${esc(recName(cur))} · ${vers.length} save${vers.length===1?'':'s'}</span></div>
    <p class="intro">Every save, newest first, with who made it and which fields changed. Names come from the login, not from anything typed in the form. The automatic minutes counter is left out. <b>Load into editor</b> brings back an older version; it becomes current only when you save.</p>`;
    if (dirty) h+=`<div class="callout">You have unsaved changes. They aren't shown here until you save.</div>`;
    for (const v of vers){
      const cs=byV[v.version]||[];
      const verb={create:'Created',edit:'Saved',delete:'Deleted',restore:'Restored'}[v.action]||v.action;
      h+=`<section class="group"><div class="ghead"><h2>Version ${v.version}</h2><span class="hint"><b>${esc(verb)}</b> by <b>${esc(v.who)}</b> · ${esc(fmtTime(v.edited_at))} · ${cs.length} field${cs.length===1?'':'s'} ${v.action==='create'?'entered':'changed'}</span>${v.version!==latest?`<button class="btn" data-act="loadver" data-ver="${v.version}" type="button">Load into editor</button>`:'<span class="pill st-complete">Current</span>'}</div>`;
      if (cs.length){
        const shown = v.action==='create' ? cs.slice(0,12) : cs;
        h+=`<div class="rtab-wrap flat"><table class="rtab diff"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${shown.map(c=>`<tr><td>${esc(pathLabel(c.path))}</td><td class="m old">${c.old_value==null?'<span class="nil">—</span>':esc(c.old_value)}</td><td class="m new">${c.new_value==null?'<span class="nil">removed</span>':esc(c.new_value)}</td></tr>`).join('')}</tbody></table></div>`;
        if (shown.length<cs.length) h+=`<div class="hint" style="padding:6px 14px 10px">…and ${cs.length-shown.length} more fields entered when the record was created.</div>`;
      }
      h+='</section>';
    }
    $('#main').innerHTML=h;
  } catch(e){ $('#main').innerHTML=`<div class="callout">${esc(errMsg(e,'Could not load the history.'))}</div>`; }
}

/* ---------- team (admins) ---------- */
async function renderTeam(){
  if (!isAdmin()){ goSec('records'); return; }
  $('#main').innerHTML=`<div class="sechead"><h1>Team & activity</h1></div><p class="intro">Loading…</p>`;
  try {
    const [team, act] = await Promise.all([API.team(), API.activity()]);
    let h=`<div class="recs"><div class="sechead"><h1>Team & activity</h1><span class="ua">${team.length} accounts</span></div>
    <p class="intro">New people: add them in the Supabase dashboard (<b>Authentication → Users → Add user</b>, with a temporary password and "Auto confirm"). They appear here as inactive; switch them on to let them work. Switch someone off to remove access without losing their history.</p>
    <div class="rtab-wrap"><table class="rtab team"><thead><tr><th>Name shown in history</th><th>Email</th><th>Role</th><th>Active</th><th>Since</th></tr></thead><tbody>`;
    for (const p of team){ const self=p.id===ME.id;
      h+=`<tr><td><input class="in txtplain" style="--w:22" value="${esc(p.display_name)}" data-prof="${esc(p.id)}" data-pk="display_name" aria-label="Display name for ${esc(p.email)}"></td><td class="m">${esc(p.email)}</td>
      <td><select class="in" data-prof="${esc(p.id)}" data-pk="role" ${self?'disabled title="You can\'t change your own role"':''}><option value="ra" ${p.role==='ra'?'selected':''}>RA</option><option value="admin" ${p.role==='admin'?'selected':''}>Admin</option></select></td>
      <td><label class="chkl"><input type="checkbox" data-prof="${esc(p.id)}" data-pk="active" ${p.active?'checked':''} ${self?'disabled':''}> ${p.active?'Active':'Off'}</label></td><td class="m">${esc(fmtTime(p.created_at))}</td></tr>`; }
    h+=`</tbody></table></div>
    <div class="sechead" style="margin-top:22px"><h1 style="font-size:18px">Activity by day</h1><span class="ua">from the edit history</span></div>
    <div class="rtab-wrap"><table class="rtab"><thead><tr><th>Day</th><th>Person</th><th>Records created</th><th>Saves</th><th>Records touched</th><th>First save</th><th>Last save</th></tr></thead><tbody>
    ${act.length?act.map(a=>`<tr><td class="m">${esc(a.day)}</td><td>${esc(a.display_name)}</td><td class="m">${a.records_created}</td><td class="m">${a.saves}</td><td class="m">${a.records_touched}</td><td class="m">${esc(fmtTime(a.first_save))}</td><td class="m">${esc(fmtTime(a.last_save))}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">No saves yet.</td></tr>'}
    </tbody></table></div></div>`;
    $('#main').innerHTML=h;
  } catch(e){ $('#main').innerHTML=`<div class="callout">${esc(errMsg(e,'Could not load the team.'))}</div>`; }
}

/* ---------- account ---------- */
function accountModal(){
  const demo=API.kind==='demo';
  $('#modal').innerHTML=`<div class="mbox narrow" role="dialog" aria-label="Your account"><header><b>Your account</b><button class="btn ghost" data-act="close" type="button">Close</button></header><div class="mbody stack">
   <div class="hint">${esc(ME.email)} · ${isAdmin()?'admin':'RA'}</div>
   <label for="acc-name">Name shown in the edit history</label><div class="tools"><input class="in txtplain" id="acc-name" style="--w:28" value="${esc(ME.display_name)}"><button class="btn" data-act="savename" type="button">Save name</button></div>
   ${demo?'':`<label for="acc-pw">New password (at least 8 characters)</label><div class="tools"><input class="in txtplain" id="acc-pw" type="password" autocomplete="new-password" style="--w:24"><button class="btn" data-act="savepw" type="button">Change password</button></div>`}
   <div class="tools" style="margin-top:8px"><button class="btn" data-act="signout" type="button">Sign out</button></div></div></div>`;
  $('#modal').hidden=false;
}

/* ---------- conflict ---------- */
let pendingMine=null;
function showConflict(res, mine){
  pendingMine=mine;
  $('#modal').innerHTML=`<div class="mbox narrow" role="dialog" aria-label="Someone else saved this record"><header><b>Someone else saved this record</b><button class="btn ghost" data-act="close" type="button">Cancel</button></header><div class="mbody stack">
   <p style="margin:0"><b>${esc(res.updated_by||'Another person')}</b> saved it at ${esc(fmtTime(res.updated_at))} (version ${res.version}), after you opened it. Saving now would replace their changes.</p>
   <div class="choice"><button class="btn primary" data-act="cf-mine" data-ver="${res.version}" type="button">Save mine anyway</button><span class="hint">Their version stays in the edit history, so nothing is lost; you or an admin can compare and fix it there.</span></div>
   <div class="choice"><button class="btn" data-act="cf-theirs" type="button">Load their version</button><span class="hint">Discards your unsaved changes. Copy them first if you want to re-enter them: <button class="linkbtn" data-act="cf-copy" type="button">copy my version</button></span></div>
  </div></div>`;
  $('#modal').hidden=false;
}

/* ---------- field editing ---------- */
function onInput(e){
  const el=e.target;
  if (el.id==='listq'){ listQ=el.value; const pos=el.selectionStart; renderRecords(); const n=$('#listq'); n.focus(); try{n.setSelectionRange(pos,pos);}catch(_){} return; }
  const path=el.dataset.path; if (!path||!cur) return;
  const f=fieldForPath(path); let v;
  if (el.type==='checkbox') v = el.checked?'X':'';
  else if (f && f.t==='date'){
    let raw=el.value.replace(/\?/g,'-').replace(/[^\d-]/g,'').slice(0,8);
    v = raw.length>4 ? raw.slice(0,2)+'/'+raw.slice(2,4)+'/'+raw.slice(4) : raw.length>2 ? raw.slice(0,2)+'/'+raw.slice(2) : raw;
    if (el.value!==v){ el.value=v; }
  } else if (f && f.t!=='area'){
    const p=el.selectionStart; v=el.value.toUpperCase(); if (el.value!==v){ el.value=v; try{el.setSelectionRange(p,p);}catch(_){} }
  } else v=el.value;
  setPath(cur, path, v);
  if (f && f.t==='code'){ const m=el.parentElement.querySelector('.meaning'); if (m) m.textContent = CODES[f.list][v]||''; }
  markActive(); schedSave();
  if (path.startsWith('personal.names.0')||path.startsWith('meta.file.')) renderTop();
}
function onBlur(e){
  const el=e.target; const path=el.dataset?.path; if (!path||!cur) return;
  const f=fieldForPath(path); if (!f) return;
  const rowPath=path.split('.').slice(0,-1).join('.'); const row=getPath(cur,rowPath);
  const target = path.endsWith('_q') ? document.getElementById('f-'+path.slice(0,-2).replace(/\./g,'-')) : el;
  const ff = path.endsWith('_q') ? fieldForPath(path.slice(0,-2)) : f;
  if (target && ff){ const res=checkField(ff, getPath(cur, path.endsWith('_q')?path.slice(0,-2):path), row); target.classList.toggle('bad', !!res && res.lvl==='err'); target.classList.toggle('warn', !!res && res.lvl==='warn'); }
  sideRefresh();
}
let ptrDown=false, sidePending=false;
document.addEventListener('pointerdown', ()=>{ ptrDown=true; }, true);
document.addEventListener('pointerup', ()=>{ setTimeout(()=>{ ptrDown=false; if (sidePending){ sidePending=false; doSideRefresh(); } }, 0); }, true);
function sideRefresh(){ if (ptrDown){ sidePending=true; return; } doSideRefresh(); }
function doSideRefresh(){ if (!cur || view!=='edit') return; updateNavBadges(); refreshChecks(); }
function updateNavBadges(){ const checks=allChecks(cur); document.querySelectorAll('#idx a[data-sec]').forEach(a=>{ const id=a.dataset.sec; if (!secById(id)) return; const n=checks.filter(c=>c.sec===id).length; const last=a.lastElementChild; last.className=n?'b':''; last.textContent=n?n:''; }); }
function refreshChecks(){ const a=document.activeElement; const p=a&&a.dataset?a.dataset.path:null; renderGuide(p?fieldForPath(p):null, p); }
document.addEventListener('input', onInput);
document.addEventListener('focusout', onBlur);
document.addEventListener('focusin', e=>{ const p=e.target.dataset?.path; if (p && cur) renderGuide(fieldForPath(p), p); });
document.addEventListener('keydown', e=>{
  if (e.key==='Enter' && e.target.matches('#main input.in[data-path]') && !e.shiftKey){ e.preventDefault(); const all=[...document.querySelectorAll('#main input.in[data-path], #main textarea.in[data-path], #main input[type=checkbox][data-path]')]; const i=all.indexOf(e.target); if (all[i+1]) all[i+1].focus(); }
  if (e.altKey && (e.key==='ArrowDown'||e.key==='ArrowUp') && cur && view==='edit'){ e.preventDefault(); const i=SCHEMA.findIndex(s=>s.id===curSec); const j=Math.max(0,Math.min(SCHEMA.length-1,i+(e.key==='ArrowDown'?1:-1))); goSec(SCHEMA[j].id); }
  if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveNow(); }
  if (e.key==='Escape' && !$('#modal').hidden){ $('#modal').hidden=true; }
});

function renderAll(){ renderTop(); renderNav(); renderMain(); if (view==='edit' && cur) renderGuide(null); else $('#guide').innerHTML = (view==='login'||!ME||!ME.active)?'':guideIdle(); }
function guideIdle(){ return `<div class="gcard"><div class="eyebrow">Signed in</div><h3>${esc(ME.display_name)}</h3><p>${isAdmin()?'You are an admin: you can activate people, see team activity, and delete or restore records.':'Your saves are recorded under this name.'}</p><div class="src">Change your name or password from the button with your name at the top right.</div></div>`; }
async function goSec(id){
  if (id==='records'){ view='records'; renderAll(); await refreshList(); if (view==='records') renderRecords(); }
  else if (id==='team'){ view='team'; renderAll(); }
  else if (id==='history'){ view='history'; renderAll(); }
  else { view='edit'; curSec=id; renderAll(); sset('spe.sec', curSec); }
  window.scrollTo(0,0);
}

/* ---------- saving ---------- */
async function saveNow(force){
  if (!cur || saving || curMeta.deleted) return;
  if (!dirty && !curMeta.isNew && !force){ toast('No changes to save'); return; }
  saving=true; renderSaveState();
  const payload=JSON.parse(JSON.stringify(cur));
  try {
    const res = await API.save(cur._uid, payload, curMeta.isNew ? 0 : curMeta.version);
    if (res && res.ok){
      if (curMeta.isNew){ curMeta.created_by_name=ME.display_name; curMeta.created_at=res.updated_at; }
      Object.assign(curMeta, {version:res.version, updated_at:res.updated_at, updated_by_name:ME.display_name, isNew:false});
      dirty=false; staleDraft=null; clearDraft(cur._uid);
      toast(`Saved · version ${res.version}`);
      if (view==='edit' && curSec==='meta') renderMain();
      renderNav();
    } else if (res && res.conflict){ showConflict(res, payload); }
  } catch(e){ toast(errMsg(e,'Could not save. Your changes are kept in this browser; try again.')); }
  finally { saving=false; renderSaveState(); renderTop(); }
}
setInterval(()=>{ if (cur && dirty && !saving && !curMeta.deleted && Date.now()-lastAct > 4000 && $('#modal').hidden) saveNow(); }, 120000);   // autosave every 2 minutes
window.addEventListener('beforeunload', e=>{ if (dirty){ saveDraft(); e.preventDefault(); e.returnValue=''; } });

/* ---------- opening ---------- */
async function openRec(uid, toSec){
  if (cur && dirty && cur._uid!==uid){ await saveNow(); if (dirty) return; }
  try {
    const r = await API.get(uid);
    cur = upgrade(r.data); cur._uid = uid;
    curMeta = {version:r.version, isNew:false, created_by_name:r.created_by_name, created_at:r.created_at, updated_by_name:r.updated_by_name, updated_at:r.updated_at, deleted:!!r.deleted_at};
    dirty=false; staleDraft=null;
    const d=loadDraft(uid);
    if (d && d.data){
      if (d.base===r.version){ cur=upgrade(d.data); cur._uid=uid; dirty=true; toast('Brought back your unsaved changes from '+fmtTime(d.at)); }
      else staleDraft=d;
    }
    sset(`spe.cur.${ME.id}`, uid);
    if (toSec==='history'){ view='history'; } else { view='edit'; curSec=staleDraft?'meta':(toSec||'meta'); }
    renderAll(); window.scrollTo(0,0);
  } catch(e){ toast(errMsg(e,'Could not open that record.')); }
}
function openDraft(uid){
  const d=loadDraft(uid); if (!d) return;
  cur=upgrade(d.data); cur._uid=uid; curMeta={version:0, isNew:true}; dirty=true; staleDraft=null;
  view='edit'; curSec='meta'; renderAll();
}
async function startNew(){
  if (cur && dirty){ await saveNow(); if (dirty) return; }
  cur=newRecord(); curMeta={version:0, isNew:true}; dirty=false; staleDraft=null;
  view='edit'; curSec='meta'; renderAll(); setTimeout(()=>document.getElementById('f-meta-file-sailor_id')?.focus(),20);
}

/* ---------- clicks ---------- */
const armed = new Map();
function arm(btn, key, label, fn){ if (armed.get(key)){ armed.delete(key); fn(); return; } armed.set(key, true); const old=btn.textContent; btn.textContent=label; btn.classList.add('arm'); setTimeout(()=>{ if(armed.get(key)){ armed.delete(key); btn.textContent=old; btn.classList.remove('arm'); } }, 3000); }

document.addEventListener('click', async e=>{
  const nav=e.target.closest('[data-sec]'); if (nav){ e.preventDefault(); goSec(nav.dataset.sec); return; }
  const b=e.target.closest('[data-act]'); if (!b) return;
  const act=b.dataset.act, path=b.dataset.path;
  if (act==='add'){ const [sid,gid]=path.split('.'); const g=secById(sid).groups.find(x=>x.id===gid); cur[sid][gid].push(blankFields(g.fields)); schedSave(); renderMain(); const rows=document.querySelectorAll(`#g-${sid}-${gid} .row`); rows[rows.length-1]?.querySelector('input,textarea')?.focus(); }
  else if (act==='del'){ arm(b, path, 'Confirm', ()=>{ const ks=path.split('.'); const arr=cur[ks[0]][ks[1]]; arr.splice(+ks[2],1); if (!arr.length){ const g=secById(ks[0]).groups.find(x=>x.id===ks[1]); arr.push(blankFields(g.fields)); } schedSave(); renderMain(); renderNav(); refreshChecks(); }); }
  else if (act==='sort'){ const [sid,gid]=path.split('.'); const k=b.dataset.key; const arr=cur[sid][gid]; const blanks=arr.filter(isBlank); const filled=arr.filter(r=>!isBlank(r)).sort((a,b2)=>dateKey(a[k]).localeCompare(dateKey(b2[k]))); cur[sid][gid]=[...filled,...blanks]; schedSave(); renderMain(); toast('Sorted by date'); }
  else if (act==='addsub'){ const arr=getPath(cur,path); const sub=SCHEMA.find(s=>s.id==='apps').groups[0].fields.find(x=>x.t==='sub'); arr.push(blankFields(sub.fields)); schedSave(); renderMain(); }
  else if (act==='delsub'){ const ks=path.split('.'); const idx=+ks.pop(); const arr=getPath(cur,ks.join('.')); arr.splice(idx,1); if (!arr.length){ const sub=SCHEMA.find(s=>s.id==='apps').groups[0].fields.find(x=>x.t==='sub'); arr.push(blankFields(sub.fields)); } schedSave(); renderMain(); }
  else if (act==='goto'){ goSec(b.dataset.secid); setTimeout(()=>{ const el=document.getElementById('f-'+path.replace(/\./g,'-')); if (el){ el.scrollIntoView({block:'center'}); el.focus(); } }, 30); }
  else if (act==='save'){ saveNow(); }
  else if (act==='open'){ openRec(b.dataset.uid); }
  else if (act==='openhist'){ openRec(b.dataset.uid, 'history'); }
  else if (act==='opendraft'){ openDraft(b.dataset.uid); }
  else if (act==='newrec'){ startNew(); }
  else if (act==='refresh'){ await refreshList(); renderRecords(); toast('List refreshed'); }
  else if (act==='delrec'){ arm(b, 'rec'+b.dataset.uid, 'Confirm delete', async ()=>{ try { await API.setDeleted(b.dataset.uid, true); if (cur && cur._uid===b.dataset.uid) curMeta.deleted=true; toast('Record deleted (kept in history; can be restored)'); await refreshList(); renderAll(); } catch(err){ toast(errMsg(err,'Could not delete.')); } }); }
  else if (act==='restore'){ try { await API.setDeleted(b.dataset.uid, false); if (cur && cur._uid===b.dataset.uid){ await openRec(cur._uid); } toast('Record restored'); await refreshList(); if (view==='records') renderRecords(); } catch(err){ toast(errMsg(err,'Could not restore.')); } }
  else if (act==='loadver'){ try { const d=await API.versionData(cur._uid, +b.dataset.ver); cur=upgrade(d); dirty=true; saveDraft(); view='edit'; curSec='meta'; renderAll(); toast(`Loaded version ${b.dataset.ver}. Save to make it the current version.`); } catch(err){ toast(errMsg(err,'Could not load that version.')); } }
  else if (act==='usedraft'){ const d=staleDraft; cur=upgrade(d.data); dirty=true; staleDraft=null; renderAll(); toast('Loaded your unsaved copy. Save when ready.'); }
  else if (act==='dropdraft'){ clearDraft(cur._uid); staleDraft=null; renderMain(); toast('Discarded'); }
  else if (act==='cf-mine'){ $('#modal').hidden=true; curMeta.version=+b.dataset.ver; await saveNow(true); }
  else if (act==='cf-theirs'){ $('#modal').hidden=true; dirty=false; clearDraft(cur._uid); await openRec(cur._uid, view==='edit'?curSec:'meta'); toast('Loaded their version'); }
  else if (act==='cf-copy'){ const t=JSON.stringify(pendingMine); navigator.clipboard?.writeText(t).then(()=>toast('Your version is on the clipboard'),()=>toast('Copy failed; use Export instead')); }
  else if (act==='import'){ $('#impfile').click(); }
  else if (act==='expall'){ exportMenu(true); }
  else if (act==='close'){ $('#modal').hidden=true; }
  else if (act==='copy'){ const ta=$('#modal textarea'); navigator.clipboard?.writeText(ta.value).then(()=>toast('Copied'),()=>{ ta.select(); toast('Press Ctrl+C to copy'); }); }
  else if (act==='dl'){ doExport(b.dataset.kind, b.dataset.scope==='all'); }
  else if (act==='demoas'){ $('#li-email').value=b.dataset.email; signIn(b.dataset.email, 'demo'); }
  else if (act==='demoreset'){ API.resetDemo(); location.reload(); }
  else if (act==='signout'){ if (dirty) await saveNow(); await API.signOut(); ME=null; cur=null; curMeta=null; view='login'; $('#modal').hidden=true; renderAll(); }
  else if (act==='reload'){ location.reload(); }
  else if (act==='savename'){ const n=$('#acc-name').value.trim(); if (!n) return toast('Enter a name'); try { await API.setMyName(n); ME.display_name=n; renderTop(); toast('Name saved'); } catch(err){ toast(errMsg(err,'Could not save the name.')); } }
  else if (act==='savepw'){ const p=$('#acc-pw').value; if (p.length<8) return toast('Use at least 8 characters'); try { await API.changePassword(p); $('#acc-pw').value=''; toast('Password changed'); } catch(err){ toast(errMsg(err,'Could not change the password.')); } }
});
document.addEventListener('change', async e=>{
  const t=e.target;
  if (t.id==='showdel'){ showDeleted=t.checked; await refreshList(); renderRecords(); return; }
  if (t.dataset.prof){
    const patch={[t.dataset.pk]: t.type==='checkbox' ? t.checked : t.value.trim()};
    try { await API.updateProfile(t.dataset.prof, patch); toast('Saved'); if (t.dataset.prof===ME.id && 'display_name' in patch){ ME.display_name=patch.display_name; renderTop(); } if (t.type==='checkbox') renderTeam(); }
    catch(err){ toast(errMsg(err,'Could not update that account.')); renderTeam(); }
    return;
  }
  if (t.id==='impfile'){ const file=t.files[0]; if (!file) return; t.value=''; importFile(file); }
});
document.addEventListener('submit', e=>{ if (e.target.id==='loginform'){ e.preventDefault(); signIn($('#li-email').value, $('#li-pw') ? $('#li-pw').value : 'demo'); } });
$('#b-records').onclick=()=>goSec('records');
$('#b-new').onclick=()=>startNew();
$('#b-exp').onclick=()=>exportMenu(!cur);
$('#b-save').onclick=()=>saveNow();
$('#b-me').onclick=()=>accountModal();

/* ---------- import ---------- */
function importFile(file){
  const fr=new FileReader();
  fr.onload=async ()=>{
    let arr;
    try { const d=JSON.parse(fr.result); arr=Array.isArray(d)?d:(d._uid?[d]:Object.values(d)); } catch(err){ return toast('That file is not a record export (JSON).'); }
    const have=new Set(LIST.map(r=>r.uid)); let made=0, skipped=0, failed=0;
    for (const r of arr){
      if (!r || !r.meta || !r.personal){ failed++; continue; }
      const uid = (r._uid && /^r[a-z0-9]{4,40}$/.test(r._uid)) ? r._uid : newUid();
      if (have.has(uid)){ skipped++; continue; }
      const data=upgrade(r); data._uid=uid; delete data._modified; delete data._example;
      try { const res=await API.save(uid, data, 0); if (res.ok) made++; else skipped++; } catch(err){ failed++; }
    }
    await refreshList(); renderRecords();
    toast(`Imported ${made}${skipped?`, skipped ${skipped} already on the server`:''}${failed?`, ${failed} failed`:''}`);
  };
  fr.readAsText(file);
}

/* ---------- active time ---------- */
let lastAct=Date.now(); function markActive(){ lastAct=Date.now(); }
document.addEventListener('keydown', markActive); document.addEventListener('pointerdown', markActive);
setInterval(()=>{ if (cur && view==='edit' && !curMeta.deleted && document.visibilityState==='visible' && Date.now()-lastAct < 5*60*1000){ cur.meta.file.minutes=String(Math.round(((+cur.meta.file.minutes||0)+0.5)*10)/10); schedSave(); const el=document.getElementById('f-meta-file-minutes'); if (el && document.activeElement!==el) el.value=cur.meta.file.minutes; } }, 30000);

/* ---------- sign-in & boot ---------- */
async function signIn(email, pw){
  const msg=$('#li-msg'); if (msg) msg.textContent=''; const go=$('#li-go'); if (go) go.disabled=true;
  try { await API.signIn(email.trim(), pw); await afterSignIn(); }
  catch(e){ if (msg) msg.textContent = /invalid login/i.test(errMsg(e,'')) ? 'That email and password don\'t match an account.' : errMsg(e,'Could not sign in.'); }
  finally { if (go) go.disabled=false; }
}
async function afterSignIn(){
  ME = await API.me();
  if (!ME){ ME={email:'?', display_name:'?', active:false, role:'ra'}; }
  view='records'; cur=null; curMeta=null;
  if (!ME.active){ renderAll(); return; }
  await refreshList();
  const last=sget(`spe.cur.${ME.id}`);
  if (last && LIST.some(r=>r.uid===last)) { await openRec(last, sget('spe.sec')||'meta'); return; }
  renderAll();
}
async function boot(){
  buildDatalists();
  try {
    API = (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) ? SupabaseBackend(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : DemoBackend();
  } catch(e){ $('#main').innerHTML=`<div class="callout">${esc(errMsg(e,'Could not start.'))}</div>`; return; }
  if (API.kind==='demo'){ $('#banner').hidden=false; $('#banner').textContent='Demo mode: no server is configured, so data stays in this browser. Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js to go live.'; }
  try { const u = await API.init(); if (u) await afterSignIn(); else { view='login'; renderAll(); } }
  catch(e){ view='login'; renderAll(); toast(errMsg(e,'Could not reach the server.')); }
  if (!storageOK){ $('#banner').hidden=false; $('#banner').textContent='This browser is blocking local storage, so unsaved changes are not backed up between visits. Save often.'; }
}
boot();

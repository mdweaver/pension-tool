/* =====================================================================
   APP — sign-in, records, saving with conflict checks, history, team.
   ===================================================================== */
let storageOK = true;
function sget(k){ try { return localStorage.getItem(k); } catch(e){ storageOK=false; return null; } }
function sset(k,v){ try { localStorage.setItem(k,v); return true; } catch(e){ storageOK=false; return false; } }
function sdel(k){ try { localStorage.removeItem(k); } catch(e){} }

function blankFields(fields){ const o={}; for (const f of fields){ if (f.t==='br') continue; if (f.t==='sub'){ o[f.k]=[blankFields(f.fields)]; continue; } o[f.k]=''; if (f.t==='date' && f.q) o[f.k+'_q']=''; } return o; }
function newUid(){ return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function newRecord(){
  const r={_uid:newUid(), _schema:2};
  for (const s of SCHEMA){ r[s.id]={}; for (const g of s.groups){ r[s.id][g.id] = g.repeat ? [blankFields(g.fields)] : blankFields(g.fields); } }
  r.meta.file.status='P'; r.meta.file.minutes='0';
  return r;
}
function upgrade(r){ // fill any groups/fields added to the schema since the record was made
  for (const s of SCHEMA){ r[s.id]=r[s.id]||{}; for (const g of s.groups){
    if (g.repeat){ if (!Array.isArray(r[s.id][g.id])) r[s.id][g.id]=[blankFields(g.fields)]; r[s.id][g.id]=r[s.id][g.id].map(row=>Object.assign(blankFields(g.fields),row)); }
    else r[s.id][g.id]=Object.assign(blankFields(g.fields), r[s.id][g.id]||{});
  } }
  return r;
}

/* ---------- state ---------- */
let API = null;          // backend
let ME = null;           // my profile {id,email,display_name,role,active}
let LIST = [];           // records list from the server
let cur = null;          // the record being edited (its full data)
let curMeta = null;      // {version, isNew, created_by_name, created_at, updated_by_name, updated_at, deleted}
let dirty = false, saving = false;
let view = 'login', curSec = 'meta';
let showDeleted = false, listQ = '', staleDraft = null, histCache = null;
const isAdmin = () => ME && ME.active && ME.role==='admin';

/* local safety copies of unsaved work, per person and record */
const draftKey = uid => `spe.draft.${ME?ME.id:'x'}.${uid}`;
function saveDraft(){ if (cur && ME) sset(draftKey(cur._uid), JSON.stringify({data:cur, base:curMeta.isNew?0:curMeta.version, isNew:curMeta.isNew, at:Date.now()})); }
function loadDraft(uid){ try { return JSON.parse(sget(draftKey(uid))||'null'); } catch(e){ return null; } }
function clearDraft(uid){ sdel(draftKey(uid)); }
function myDrafts(){ const out=[]; try { const pre=`spe.draft.${ME.id}.`; for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if (k && k.startsWith(pre)){ const d=JSON.parse(localStorage.getItem(k)); if (d && d.data) out.push(d); } } } catch(e){} return out; }

let draftT=null;
function schedSave(){ dirty=true; clearTimeout(draftT); draftT=setTimeout(saveDraft,300); renderSaveState(); }
function errMsg(e, fallback){ const m = e && (e.message || e.error_description || e.msg); return m ? String(m) : fallback; }
function fmtTime(t){ if (!t) return ''; const d=new Date(t); return d.toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}); }

/* ---------- utilities ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, 2600); }
function getPath(obj, path){ return path.split('.').reduce((o,k)=> o==null?o:o[k], obj); }
function setPath(obj, path, val){ const ks=path.split('.'); let o=obj; for (let i=0;i<ks.length-1;i++) o=o[ks[i]]; o[ks[ks.length-1]]=val; }
function secById(id){ return SCHEMA.find(s=>s.id===id); }
function isBlank(o){ if (o==null) return true; if (typeof o==='string') return o.trim()===''; if (Array.isArray(o)) return o.every(isBlank); return Object.entries(o).every(([k,v])=> k==='_' || isBlank(v)); }
function recName(r){ const n=(r.personal.names[0]||{}).name; return n && n.trim() ? n : '(no name yet)'; }
function dateKey(v){ if (!v) return '99999999'; const m=v.match(/^(..)\/(..)\/(....)$/); if(!m) return '99999999'; return m[3].replace(/-/g,'0')+m[1].replace(/-/g,'0')+m[2].replace(/-/g,'0'); }

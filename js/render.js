/* ---------- validation ---------- */
function checkDate(v, f, qv){
  if (!v) return null;
  if (!/^[\d-]{2}\/[\d-]{2}\/[\d-]{4}$/.test(v)) return {lvl:'err', msg:'Use MM/DD/YYYY, with dashes for unreadable parts (04/--/1865).'};
  const [mm,dd,yy]=v.split('/');
  if (/^\d\d$/.test(mm) && (+mm<1 || +mm>12)) return {lvl:'err', msg:'Month must be 01–12.'};
  if (/^\d\d$/.test(dd) && (+dd<1 || +dd>31)) return {lvl:'err', msg:'Day must be 01–31.'};
  const msgs=[];
  if (v.includes('-') && f.q && !qv) msgs.push('Incomplete date: add a quality code (Q).');
  if (/^\d{4}$/.test(yy) && f.min && (+yy<f.min || +yy>f.max)) msgs.push(`Year ${yy} is outside the expected ${f.min}–${f.max}. Check it, or explain in Remarks.`);
  return msgs.length ? {lvl:'warn', msg:msgs.join(' ')} : null;
}
function checkField(f, v, row){
  if (f.t==='date') return checkDate(v, f, row ? row[f.k+'_q'] : '');
  if (v==null || String(v).trim()==='') return (f.req ? {lvl:'err', msg:f.l+' is required.'} : null);
  if (f.t==='code' && !(v in CODES[f.list])) return {lvl:'warn', msg:`"${v}" is not a listed code. Keep it only if you mean to override.`};
  if (f.t==='num'){ const n=Number(v); if (isNaN(n)) return {lvl:'err', msg:'Numbers only.'}; if (n<f.min||n>f.max) return {lvl:'warn', msg:`Expected ${f.min}–${f.max}.`}; if (!f.dec && !Number.isInteger(n)) return {lvl:'warn', msg:'Whole number expected.'}; }
  if (f.nameRule && !v.includes(',')) return {lvl:'warn', msg:'Name rule: LAST NAME, FIRST NAME M (e.g. JOHNSON, HENRY). Last name only → JOHNSON,'};
  return null;
}
function allChecks(r){
  const out=[];
  const walk=(fields,obj,base,sec,gtitle)=>{ for (const f of fields){ if (f.t==='br') continue;
      if (f.t==='sub'){ (obj[f.k]||[]).forEach((sr,j)=>walk(f.fields,sr,`${base}.${f.k}.${j}`,sec,gtitle)); continue; }
      const res=checkField(f,obj[f.k],obj); if (res) out.push({...res, path:`${base}.${f.k}`, sec, where:`${gtitle} · ${f.l}`}); } };
  for (const s of SCHEMA) for (const g of s.groups){
    const v=r[s.id][g.id];
    if (g.repeat) v.forEach((row,i)=>{ if (!isBlank(row)) walk(g.fields,row,`${s.id}.${g.id}.${i}`,s.id,`${g.title} ${i+1}`); });
    else walk(g.fields,v,`${s.id}.${g.id}`,s.id,g.title);
  }
  if (isBlank(r.personal.names)) out.push({lvl:'err', msg:'Enter the sailor\'s name.', path:'personal.names.0.name', sec:'personal', where:'Names'});
  if (isBlank(r.personal.appcert)) out.push({lvl:'warn', msg:'No application or certificate number yet. It is needed to re-request the file.', path:'personal.appcert.0.number', sec:'personal', where:'App & cert numbers'});
  if (isBlank(r.socio.finance)) out.push({lvl:'warn', msg:'State of finances should always have a row (UNKNOWN is fine).', path:'socio.finance.0.state', sec:'socio', where:'State of finances'});
  return out;
}

/* ---------- rendering ---------- */
function fieldHTML(f, val, path, row){
  if (f.t==='br') return '<span class="fbreak"></span>';
  const id='f-'+path.replace(/\./g,'-');
  const w=`style="--w:${f.t==='date'?10:Math.min(f.w||12,48)}"`;
  const chk=checkField(f,val,row); const cls=chk?(chk.lvl==='err'?' bad':' warn'):'';
  const da=`data-path="${path}" id="${id}"`;
  const lab=`<label for="${id}" title="${esc(f.l)}">${esc(f.l)}</label>`;
  if (f.t==='area') return `<div class="f wide">${lab}<textarea class="in${cls}" ${da} rows="3">${esc(val)}</textarea></div>`;
  if (f.t==='x') return `<div class="f"><span class="lab">${esc(f.l)}</span><span class="xbox"><input type="checkbox" ${da} ${val==='X'?'checked':''} aria-label="${esc(f.l)}"></span></div>`;
  if (f.t==='date'){
    const qv=row?row[f.k+'_q']:''; const qid=id+'_q';
    const q = f.q ? `<input class="in mono q" data-path="${path}_q" id="${qid}" value="${esc(qv)}" maxlength="1" list="dl-QC" aria-label="Quality code for ${esc(f.l)}" placeholder="Q">` : '';
    return `<div class="f">${lab}<div class="dq"><input class="in mono${cls}" ${da} ${w} value="${esc(val)}" placeholder="MM/DD/YYYY" inputmode="numeric" autocomplete="off">${q}</div></div>`;
  }
  if (f.t==='code'){
    const m = val && CODES[f.list][val] ? CODES[f.list][val] : '';
    return `<div class="f">${lab}<input class="in mono${cls}" ${da} style="--w:${Math.max(f.w,2)+3}" value="${esc(val)}" maxlength="${f.w}" list="dl-${f.list}" autocomplete="off"><span class="meaning">${esc(m)}</span></div>`;
  }
  const mono = f.t==='num' ? ' mono' : ' txt';
  const list = f.list ? ` list="dl-${f.list}"` : '';
  return `<div class="f">${lab}<input class="in${mono}${cls}" ${da} ${w} value="${esc(val)}" autocomplete="off"${list}${f.t==='num'?' inputmode="decimal"':''}></div>`;
}
function fieldsHTML(fields, obj, base){
  let h='';
  for (const f of fields){
    if (f.t==='sub'){
      const rows=obj[f.k]||[];
      h+=`<div class="sub"><div class="slab">${esc(f.l)} <button type="button" class="linkbtn" data-act="addsub" data-path="${base}.${f.k}">+ Add claim</button></div>`;
      rows.forEach((sr,j)=>{ h+=`<div class="srow"><span class="si">${String.fromCharCode(65+j%26)}</span>${fieldsHTML(f.fields, sr, `${base}.${f.k}.${j}`)}<button type="button" class="linkbtn" data-act="delsub" data-path="${base}.${f.k}.${j}" aria-label="Remove claim">×</button></div>`; });
      h+='</div>';
      continue;
    }
    h+=fieldHTML(f, obj[f.k], `${base}.${f.k}`, obj);
  }
  return h;
}
function groupHTML(s, g){
  const v=cur[s.id][g.id]; const path=`${s.id}.${g.id}`;
  const tags = [...new Set(g.fields.filter(f=>f.tag).map(f=>f.tag))];
  let h=`<section class="group" id="g-${s.id}-${g.id}"><div class="ghead"><h2>${esc(g.title)}</h2>`;
  if (g.repeat) h+=`<span class="cnt">${v.filter(r=>!isBlank(r)).length} entered</span>`;
  if (g.hint) h+=`<span class="hint">${esc(g.hint)}</span>`;
  h+='</div><div class="rows">';
  if (g.repeat){
    v.forEach((row,i)=>{ h+=`<div class="row"><div class="ri">${i+1}</div><div class="fields">${fieldsHTML(g.fields,row,`${path}.${i}`)}</div><div class="ract"><button type="button" data-act="del" data-path="${path}.${i}" title="Remove this row">Remove</button></div></div>`; });
  } else {
    h+=`<div class="row single"><div class="fields">${fieldsHTML(g.fields,v,path)}</div></div>`;
  }
  h+='</div>';
  if (g.repeat) h+=`<div class="addrow"><button type="button" class="linkbtn" data-act="add" data-path="${path}">+ Add row</button>${g.sortBy?`<button type="button" class="linkbtn" data-act="sort" data-path="${path}" data-key="${g.sortBy}">Sort by date</button>`:''}</div>`;
  return h+'</section>';
}
function renderGuide(f, path){
  let h='';
  if (!cur){ $('#guide').innerHTML='<div class="gcard"><div class="eyebrow">Field guide</div><h3>Open a record</h3><p>Click into any field to see the coding instructions from the old Union Army manual, adapted for Navy pension files.</p></div>'; return; }
  if (f){
    const help = f.help || HELP[f.ua] || '';
    h+=`<div class="gcard"><div class="eyebrow">Field guide${f.tag==='navy'?' · adapted for Navy':f.tag==='project'?' · added for this project':''}</div><h3>${esc(f.l)}</h3><div class="var">${f.ua?'Old variable: '+esc(f.ua):'New field'}${path?' · '+esc(path):''}</div>`;
    if (f.t==='date') h+=`<p><b>Format</b> MM/DD/YYYY. Type <kbd>-</kbd> for any digit you can't read (April 1865 → 04/--/1865); an incomplete date needs a quality code.</p>`;
    if (help) h+=`<p>${esc(help)}</p>`;
    if (f.t==='code'){ const L=CODES[f.list]; h+=`<div class="ctabwrap"><table class="ctab">${Object.entries(L).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>`; }
    if (f.t==='date' && f.q) h+=`<div class="src">Quality codes: ${Object.entries(CODES.QC).map(([k,v])=>`<b>${k}</b> ${esc(v)}`).join(' · ')}</div>`;
    h+='</div>';
  } else {
    h+=`<div class="gcard"><div class="eyebrow">Field guide</div><h3>${esc(secById(curSec)?.title||'')}</h3><p>Click into any field to see its coding instructions and code list here.</p><div class="src">General rules: no abbreviations except the approved ones; MSR-type official records beat self-reported ones; overflow goes in Remarks, labeled by field (e.g. CAUSE OF DEATH: …; separate remarks with semicolons).</div></div>`;
  }
  const checks=allChecks(cur);
  h+=`<div class="checks"><h4>To check (${checks.length})</h4>`;
  if (!checks.length) h+='<div class="chk" style="border-left-color:var(--ok)">No problems found.</div>';
  for (const c of checks.slice(0,40)) h+=`<button type="button" class="chk ${c.lvl}" data-act="goto" data-path="${c.path}" data-secid="${c.sec}">${esc(c.msg)}<small>${esc(secById(c.sec).title)} · ${esc(c.where)}</small></button>`;
  if (checks.length>40) h+=`<div class="src">…and ${checks.length-40} more.</div>`;
  $('#guide').innerHTML=h+'</div>';
}

/* datalists for codes and ratings */
function buildDatalists(){
  let h=''; for (const [k,L] of Object.entries(CODES)) h+=`<datalist id="dl-${k}">${Object.entries(L).map(([c,m])=>`<option value="${esc(c)}" label="${esc(m)}"></option>`).join('')}</datalist>`;
  h+=`<datalist id="dl-RATINGS">${RATINGS.map(r=>`<option value="${esc(r)}"></option>`).join('')}</datalist>`;
  const d=document.createElement('div'); d.hidden=true; d.innerHTML=h; document.body.appendChild(d);
}

/* ---------- field lookup by path ---------- */
function fieldForPath(path){
  const ks=path.split('.'); const s=secById(ks[0]); if (!s) return null; const g=s.groups.find(g=>g.id===ks[1]); if (!g) return null;
  let rest=ks.slice(2); if (g.repeat) rest=rest.slice(1);
  let fields=g.fields; let key=rest[0];
  const sub=fields.find(f=>f.t==='sub'&&f.k===key); if (sub){ fields=sub.fields; key=rest[2]; }
  if (!key) return null;
  if (key.endsWith('_q')){ const base=fields.find(f=>f.k===key.slice(0,-2) && f.t==='date'); if (base) return {k:key,l:'Quality code — '+base.l,t:'code',list:'QC',w:1,ua:base.uaq}; }
  return fields.find(f=>f.k===key) || null;
}

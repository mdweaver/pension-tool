/* ---------- export ---------- */
function flatRows(r){
  const rows=[]; const sid=r.meta.file.sailor_id||'';
  const push=(sec,grp,i,sub,j,f,key,val)=>{ if (val==null||String(val).trim()==='') return; rows.push([r._uid,sid,sec,grp,i,sub,j,key,f&&f.ua?f.ua:'',String(val)]); };
  const walk=(fields,obj,sec,grp,i,sub,j)=>{ for (const f of fields){ if (f.t==='br') continue;
    if (f.t==='sub'){ (obj[f.k]||[]).forEach((sr,jj)=>{ if(!isBlank(sr)) walk(f.fields,sr,sec,grp,i,f.k,jj+1); }); continue; }
    push(sec,grp,i,sub,j,f,f.k,obj[f.k]); if (f.t==='date'&&f.q) push(sec,grp,i,sub,j,{ua:f.uaq},f.k+'_q',obj[f.k+'_q']); } };
  for (const s of SCHEMA) for (const g of s.groups){ const v=r[s.id][g.id];
    if (g.repeat) v.forEach((row,i)=>{ if(!isBlank(row)) walk(g.fields,row,s.id,g.id,i+1,'',''); });
    else walk(g.fields,v,s.id,g.id,'','',''); }
  return rows;
}
const csvCell = v => /[",\n\r]/.test(v) ? '"'+String(v).replace(/"/g,'""')+'"' : String(v);
function toCSV(recs){ const head=['record_uid','sailor_id','section','group','row','subgroup','subrow','field','ua_var','value']; return [head, ...recs.flatMap(flatRows)].map(r=>r.map(csvCell).join(',')).join('\r\n'); }
function stamp(){ return new Date().toISOString().slice(0,10); }
function fileBase(r){ return (r.meta.file.sailor_id||recName(r)).replace(/[^\w-]+/g,'_').replace(/^_|_$/g,'') || 'record'; }
function exportMenu(all){
  if (!all && !cur) all=true;
  const label = all ? `all ${LIST.length} records on the server` : esc(recName(cur));
  $('#modal').innerHTML=`<div class="mbox" role="dialog" aria-label="Export"><header><b>Export ${label}</b><button class="btn ghost" data-act="close" type="button">Close</button></header><div class="mbody">
  <p style="margin-top:0"><b>JSON</b> keeps everything and can be imported again. <b>CSV</b> is one row per filled field (long format, with the old Union Army variable name in <code>ua_var</code>), ready for R or Stata. ${all?'':'Exports what is on screen, including unsaved changes.'}</p>
  <div class="tools"><button class="btn primary" data-act="dl" data-kind="json" data-scope="${all?'all':'one'}" type="button">Download JSON</button><button class="btn" data-act="dl" data-kind="csv" data-scope="${all?'all':'one'}" type="button">Download CSV</button>${!all?`<button class="btn ghost" data-act="expall" type="button">Export all records instead</button>`:''}</div>
  <div id="expout"></div></div></div>`;
  $('#modal').hidden=false;
}
async function doExport(kind, all){
  let recs;
  try { recs = all ? (await API.allData()).map(upgrade) : [cur]; } catch(e){ return toast(errMsg(e,'Could not fetch the records.')); }
  const name = (all ? `pension_records_${stamp()}` : `${fileBase(cur)}_${stamp()}`) + '.' + kind;
  const text = kind==='json' ? JSON.stringify(all?recs:cur, null, 1) : toCSV(recs);
  let ok=false;
  try { const blob=new Blob([text],{type:kind==='json'?'application/json':'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); ok = (window.self===window.top); } catch(e){ ok=false; }
  if (!ok){ $('#expout').innerHTML=`<p class="intro" style="margin:12px 0 6px">If no download started (some embedded previews block downloads), copy the text below and save it as <code>${esc(name)}</code>.</p><div class="tools" style="margin-bottom:6px"><button class="btn" data-act="copy" type="button">Copy</button></div><textarea readonly>${esc(text)}</textarea>`; }
  else { $('#modal').hidden=true; toast('Downloaded '+name); }
}

/* ---------- fictional example record (demo mode only) ---------- */
function exampleRecord(){
  const r=newRecord(); r._example=true;
  const F=r.meta.file; Object.assign(F,{sailor_id:'EXAMPLE-0001',status:'P',minutes:'38',nara_ref:'(fictional example)',scan_ref:'example_scans/EXAMPLE-0001',n_images:'64',n_surg:'3'});
  const P=r.personal;
  P.names=[{name:'EXAMPLE, JAMES H',note:''},{name:'EXEMPLAR, JAMES',note:'NAME AT ENLISTMENT'}];
  P.appcert=[{kind:'A',number:'000001',claimant:'S'},{kind:'C',number:'000002',claimant:'S'},{kind:'A',number:'000003',claimant:'W'}];
  P.ftype.file_type='W';
  P.births=[{date:'--/--/1841',date_q:'6',city:'',county:'NORFOLK',state:'VA',place_q:''}];
  Object.assign(P.appear,{complexion:'BK',complexion_q:'',eyes:'BK',eyes_q:'',hair:'BK',hair_q:''});
  P.heights=[{feet:'5',inches:'6.5',hq:'',date:'08/14/1863',date_q:''}];
  Object.assign(P.death,{source:'C',date:'03/02/1902',date_q:'',city:'NORFOLK',county:'NORFOLK',state:'VA',place_q:'',cause:'PNEUMONIA',cause_beg:'02/20/1902',cause_beg_q:'',img:'0051'});
  P.rmk.remarks='NAME: SIGNS AS JAMES H EXAMPLE AFTER 1880';
  const G=(sid,gi)=>blankFields(SCHEMA.find(s=>s.id===sid).groups[gi].fields);
  r.family.spouses=[{...G('family',0), name:'EXAMPLE, MARY (NEE SAMPLE)', m_date:'12/--/1866', m_date_q:'1', m_place:'BRIDES HOME', m_city:'NORFOLK', m_state:'VA', officiator:'PASTOR, JOHN (REV)', source:'MARRIAGE CERTIFICATE', img:'0012'}];
  r.family.children=[{...G('family',1), name:'WILLIAM', sex:'M', ld:'L', ld_date:'06/01/1898', b_date:'05/--/1868', b_date_q:'1', b_state:'VA'},{...G('family',1), name:'(DEAD CHILD)', ld:'D', ld_date:'06/01/1898'}];
  r.socio.res=[{street:'',city:'NORFOLK',county:'NORFOLK',state:'VA',from:'01/--/1866',from_q:'1',to:'03/02/1902',to_q:''}];
  r.socio.jobs=[{job:'OYSTERMAN',from:'--/--/1870',from_q:'1',to:'--/--/1890',to_q:'1'}];
  r.socio.finance=[{state:'DEPENDENT ON CHARITY OF OTHERS',date:'05/10/1902',date_q:''}];
  r.socio.wealth=[{type:'R',source:'WIDOWS DECLARATION',date:'05/10/1902',date_q:'',amt:'150',desc:'HOUSE AND LOT, VALUE STATED BY WIDOW',img:'0055'}];
  r.service.enl=[{...G('service',0), date:'08/14/1863', city:'NORFOLK', state:'VA', age:'22', term_y:'1', rating:'LANDSMAN', vessel:'USS MINNESOTA', img:'0003'}];
  r.service.vessels=[{duty:'USS MINNESOTA',from:'08/14/1863',from_q:'',to:'08/13/1864',to_q:''}];
  r.service.dch=[{...G('service',3), date:'08/13/1864', hd:'H', reason:'T', vessel:'USS MINNESOTA'}];
  r.apps.app=[{...G('apps',0), claimant:'S', type:'N', date:'07/15/1890', age:'49', law_date:'06/27/1890', claims:[{claim:'RHEUMATISM',by_sailor:'X',by_board:'X'},{claim:'DISEASE OF HEART',by_sailor:'X',by_board:''}], amt:'8', r_from:'07/15/1890', writes:'N', img:'0021'},
              {...G('apps',0), claimant:'W', type:'N', date:'05/10/1902', age:'55', law_date:'06/27/1890', claims:[{claim:'',by_sailor:'',by_board:''}], amt:'8', r_from:'05/10/1902', writes:'N', img:'0054'}];
  r.aff.aff=[{...G('aff',0), dep:'M', signs:'M', date:'03/04/1891', t1:'H', period:'W', desc:'AFFIANT SERVED WITH CLAIMANT ON THE MINNESOTA AND SAW HIM HURT HIS BACK HANDLING COAL IN THE WINTER OF 1863.', img:'0030'}];
  Object.assign(r.slavery.status,{former:'Y',freed:'--/--/1862',freed_q:'1',at_enl:'F',how:'ESCAPED TO UNION LINES'});
  return r;
}

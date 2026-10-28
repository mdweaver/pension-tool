/* ---------- export ---------- */
function flatRows(r){
  const rows=[]; const sid=r.meta.file.sailor_id||'';
  const push=(sec,grp,i,sub,j,f,key,val)=>{ if (val==null||String(val).trim()==='') return; rows.push([r._uid,sid,sec,grp,i,sub,j,key,f&&f.ua?f.ua:'',String(val)]); };
  const walk=(fields,obj,sec,grp,i,sub,j)=>{ for (const f of fields){ if (f.t==='br' || f.hide) continue;
    if (f.t==='sub'){ (obj[f.k]||[]).forEach((sr,jj)=>{ if(!isBlank(sr)) walk(f.fields,sr,sec,grp,i,f.k,jj+1); }); continue; }
    push(sec,grp,i,sub,j,f,f.k,obj[f.k]); if (f.t==='date'&&f.q) push(sec,grp,i,sub,j,{ua:f.uaq},f.k+'_q',obj[f.k+'_q']); } };
  for (const s of visSections()) for (const g of visGroups(s)){ const v=r[s.id][g.id];
    if (g.repeat) v.forEach((row,i)=>{ if(!rowBlank(g,row)) walk(g.fields,row,s.id,g.id,i+1,'',''); });
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
  const F=r.meta.file; Object.assign(F,{sailor_id:'EXAMPLE-0001',status:'P',minutes:'38'});
  const P=r.personal;
  P.names=[{name:'EXAMPLE, JAMES H',note:''},{name:'EXEMPLAR, JAMES',note:'NAME AT ENLISTMENT'}];
  r.meta.appfiles=[{kind:'A',number:'000001',fiche:'',nara:'SO',url:'https://www.fold3.com/example/0001'},{kind:'C',number:'000002',fiche:'F-12',nara:'SC',url:'https://www.fold3.com/example/0002'},{kind:'A',number:'000003',fiche:'',nara:'WO',url:'https://www.fold3.com/example/0003'}];
  P.births=[{date:'--/--/1841',date_q:'6',city:'',county:'NORFOLK',state:'VA',place_q:''}];
  Object.assign(P.appear,{complexion:'BK',complexion_q:'',eyes:'BK',eyes_q:'',hair:'BK',hair_q:'',contraband:'Y',contraband_note:'ENLISTMENT RETURN: CONTRABAND',contraband_src:'https://www.fold3.com/example/0004'});
  P.heights=[{feet:'5',inches:'6.5',hq:'',date:'08/14/1863',date_q:''}];
  Object.assign(P.death,{source:'C',date:'03/02/1902',date_q:'',city:'NORFOLK',county:'NORFOLK',state:'VA',place_q:'',cause:'PNEUMONIA',cause_beg:'02/20/1902',cause_beg_q:'',addr:'12 BAY STREET',country:'US',src:'https://www.fold3.com/example/0051'});
  P.rmk.remarks='NAME: SIGNS AS JAMES H EXAMPLE AFTER 1880';
  const G=(sid,gid)=>blankFields(SCHEMA.find(s=>s.id===sid).groups.find(g=>g.id===gid).fields);
  r.family.spouses=[{...G('family','spouses'), name:'EXAMPLE, MARY (NEE SAMPLE)', m_date:'12/--/1866', m_date_q:'1', m_place:'BRIDES HOME', m_city:'NORFOLK', m_state:'VA', m_country:'US', src:'https://www.fold3.com/example/0012'}];
  r.family.children=[{...G('family','children'), name:'WILLIAM', sex:'M', ld:'L', ld_date:'06/01/1898', b_date:'05/--/1868', b_date_q:'1', b_state:'VA', b_country:'US'},{...G('family','children'), name:'(DEAD CHILD)', ld:'D', ld_date:'06/01/1898'}];
  r.socio.res=[{street:'',city:'NORFOLK',county:'NORFOLK',state:'VA',country:'US',from:'01/--/1866',from_q:'1',to:'03/02/1902',to_q:''}];
  r.socio.jobs=[{job:'OYSTERMAN',from:'--/--/1870',from_q:'1',to:'--/--/1890',to_q:'1'}];
  r.socio.finance=[{state:'DEPENDENT ON CHARITY OF OTHERS',date:'05/10/1902',date_q:''}];
  r.socio.wealth=[{type:'R',source:'WIDOWS DECLARATION',date:'05/10/1902',date_q:'',amt:'150',desc:'HOUSE AND LOT, VALUE STATED BY WIDOW',src:'https://www.fold3.com/example/0055'}];
  r.service.enl=[{...G('service','enl'), date:'08/14/1863', city:'NORFOLK', state:'VA', country:'US', age:'22', term_y:'1', rating:'LANDSMAN', vessel:'USS MINNESOTA', src:'https://www.fold3.com/example/0003'}];
  r.service.vessels=[{duty:'USS MINNESOTA',from:'08/14/1863',from_q:'',to:'08/13/1864',to_q:''}];
  r.service.dch=[{...G('service','dch'), date:'08/13/1864', hd:'H', reason:'T', vessel:'USS MINNESOTA'}];
  r.service.prizes=[{...G('service','prizes'), captor:'USS MINNESOTA', prize:'SCHOONER EXAMPLE', date:'--/--/1863', date_q:'6', paid:'45.50', src:'https://www.fold3.com/example/0030'}];
  r.apps.app=[{...G('apps','app'), claimant:'S', type:'N', date:'07/15/1890', age:'49', law_date:'06/27/1890', claims:[{claim:'RHEUMATISM',by_sailor:'X',by_board:'X'},{claim:'DISEASE OF HEART',by_sailor:'X',by_board:''}], amt:'8', r_from:'07/15/1890', writes:'N', src:'https://www.fold3.com/example/0021'},
              {...G('apps','app'), claimant:'W', type:'N', date:'05/10/1902', age:'55', law_date:'06/27/1890', claims:[{claim:'',by_sailor:'',by_board:''}], amt:'8', r_from:'05/10/1902', writes:'N', src:'https://www.fold3.com/example/0054'}];
  Object.assign(r.personal.enslaved,{former:'Y',freed:'--/--/1862',freed_q:'1',at_enl:'F',how:'ESCAPED TO UNION LINES'});
  return r;
}

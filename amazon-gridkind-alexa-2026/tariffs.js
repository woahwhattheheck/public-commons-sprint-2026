const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
let state=null,busy=false,brokenPending=false,pending=null,rejected=null,source=null,headers=[],sourcePreview=null,applyPreview=null,sourcePage=null,weekPage=null,rowOffset=0;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const stamp=v=>JSON.stringify(stable(v));
async function hash(v){const bytes=new TextEncoder().encode(stamp(v));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const context=()=>({householdId:state.workspace.selectedId,revision:state.workspace.revision,generation:state.workspace.generation});
const key=(householdId=state.workspace.selectedId)=> 'gridkind-tariff-pending-v1:'+householdId;
function intent(body){return body.action==='save'?{action:'save',source:body.source,previewSha256:body.previewSha256}:{action:'apply',tariffId:body.tariffId,targetId:body.targetId,previewSha256:body.previewSha256};}
function message(text){$('status').textContent=text;}
function fail(error){$('error').textContent=error?.message||String(error);}
function lock(){
  const blocked=busy||!!pending||brokenPending||!state;
  $('source-fields').disabled=blocked;$('apply-fields').disabled=blocked;
  document.querySelectorAll('[data-control]').forEach(n=>n.disabled=blocked);
  document.querySelectorAll('[data-row-nav]').forEach(n=>n.disabled=blocked||n.dataset.edge==='true');
  $('save-source').disabled=blocked||!sourcePreview;
  $('apply').disabled=blocked||!applyPreview?.complete;
  $('retry').disabled=busy||!pending;$('preserve').disabled=busy||!pending||!rejected;
  $('pending').hidden=!pending;$('preserve').hidden=!rejected;
  if(pending)$('pending-description').textContent=pending.body.action+' · '+pending.body.requestId+' · '+(rejected?'The server found no committed outcome for this exact request. Preserve it before re-previewing.':'Outcome may be saved or still unknown. Retry the exact retained request.');
  if(sourcePage){$('source-newer').disabled=blocked||sourcePage.offset===0;$('source-older').disabled=blocked||!sourcePage.hasMore;}
  if(weekPage){$('week-newer').disabled=blocked||weekPage.offset===0;$('week-older').disabled=blocked||!weekPage.hasMore;}
}
function clearPreviews(){sourcePreview=null;applyPreview=null;$('source-preview').replaceChildren();$('apply-preview').replaceChildren();lock();}
function adopt(next){
  if(state&&state.workspace.selectedId!==next.workspace.selectedId){source=null;headers=[];mappingOptions();$('source-file').value='';$('filename').textContent='Household changed; choose the original source again.';}
  if(state&&stamp(context())!==stamp({householdId:next.workspace.selectedId,revision:next.workspace.revision,generation:next.workspace.generation}))clearPreviews();
  state=next;$('household').textContent=state.workspace.selectedName+' · saved revision '+state.workspace.revision;lock();
}
async function api(path,body){
  const response=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);
  const result=await response.json();if(!response.ok){const e=Error(result.error||'Request failed.');e.status=response.status;e.result=result;throw e;}return result;
}
async function run(fn){if(busy)return;busy=true;$('error').textContent='';lock();try{return await fn();}catch(error){fail(error);}finally{busy=false;lock();}}
function table(parent,titles,rows){
  const wrap=el('div');wrap.className='scroll';const t=el('table'),head=el('thead'),tr=el('tr');
  for(const v of titles){const th=el('th',v);th.scope='col';tr.append(th);}head.append(tr);t.append(head);
  const body=el('tbody');for(const values of rows){const tr=el('tr');for(const v of values)tr.append(el('td',v??'Unknown'));body.append(tr);}t.append(body);wrap.append(t);parent.append(wrap);
}
function rowView(edition){
  const out=$('source-preview');out.replaceChildren();
  out.append(el('h3','Source preview'),el('p',edition.summary.rows+' original records; '+edition.summary.invalidRows+' invalid; '+edition.summary.completeDays+' complete nominal days. Saving preserves diagnostics; applying requires complete coverage for the selected week.'));
  const id=el('p','Original SHA-256: '+edition.source.sha256);id.className='identity';out.append(id);
  const incomplete=edition.summary.coverage.filter(d=>d.knownHours!==24);
  out.append(el('p',incomplete.length+' date(s) have missing, duplicate or invalid hours. No hour is filled or averaged.'));
  table(out,['Date','Known / 24','Missing','Duplicate','Invalid'],edition.summary.coverage.slice(0,100).map(d=>[d.date,d.knownHours,d.missingHours.join(', '),d.duplicateHours.join(', '),d.invalidHours.join(', ')]));
  if(edition.summary.coverage.length>100)out.append(el('p','First 100 dates shown; the saved report includes all dates.'));
  const rows=edition.rows.slice(rowOffset,rowOffset+100);
  out.append(el('h3','Original row references'),el('p',(rowOffset+1)+'–'+(rowOffset+rows.length)+' of '+edition.rows.length+' records'));
  table(out,['Row / line','Original date','Hour','Original price','USD/kWh','Issues'],rows.map(r=>[r.sourceRow+' / '+r.sourceLine,r.tokens.date,r.tokens.hour,r.tokens.price,r.exactUsdPerKwh,r.issues.join('; ')||'Valid']));
  const nav=el('div');nav.className='controls';
  for(const [label,offset,disabled] of [['Previous rows',rowOffset-100,rowOffset===0],['Next rows',rowOffset+100,rowOffset+100>=edition.rows.length]]){
    const b=el('button',label);b.type='button';b.dataset.rowNav='true';b.dataset.edge=String(disabled);b.disabled=busy||!!pending||disabled;b.onclick=()=>{if(busy||pending)return;rowOffset=offset;rowView(edition);};nav.append(b);
  }out.append(nav);
}
function sourceFields(){
  if(!source)throw Error('Choose an original CSV or source JSON first.');
  if(!$('source-form').reportValidity())throw Error('Complete the source fields and clock confirmation.');
  return {filename:source.filename,title:$('source-title').value.trim(),sourceUrl:$('source-url').value,note:$('source-note').value,
    role:$('source-role').value,unit:$('source-unit').value,clockBasis:'nominal-local-24h',
    mapping:{date:$('map-date').value,hour:$('map-hour').value,price:$('map-price').value},csv:source.csv};
}
function mappingOptions(values={}){
  for(const name of ['date','hour','price']){
    const select=$('map-'+name);select.replaceChildren(new Option('Choose exact header',''));
    for(const h of headers)select.add(new Option(h,h));
    select.value=values[name]??headers.find(h=>h.toLowerCase()===name)??'';
  }
}
async function page(kind,offset=0,keep=null){
  const result=await api('/api/tariffs?kind='+kind+'&offset='+offset+'&householdId='+encodeURIComponent(state.workspace.selectedId));
  const select=$(kind==='tariff'?'saved-source':'saved-week');select.replaceChildren(new Option(kind==='tariff'?'Choose a saved source':'Choose a saved week',''));
  for(const r of result.records)select.add(new Option('#'+r.sequence+' · '+r.label+(r.startDate?' · '+r.startDate:''),r.id));
  if(keep&&result.records.some(r=>r.id===keep))select.value=keep;
  if(kind==='tariff'){sourcePage=result;$('source-page').textContent=result.total? (result.offset+1)+'–'+(result.offset+result.records.length)+' of '+result.total:'No saved sources';downloads();}
  else{weekPage=result;$('week-page').textContent=result.total?(result.offset+1)+'–'+(result.offset+result.records.length)+' of '+result.total:'No saved weeks';}
  applyPreview=null;$('apply-preview').replaceChildren();lock();
}
function downloads(){
  const out=$('source-downloads');out.replaceChildren();const id=$('saved-source').value;if(!id)return;
  for(const [format,label] of [['source','Original CSV'],['json','Source JSON'],['csv','All normalized rows'],['html','Readable source report']]){
    const a=el('a',label);a.href='/api/tariffs/export?householdId='+encodeURIComponent(state.workspace.selectedId)+'&recordId='+encodeURIComponent(id)+'&format='+format;a.download='';out.append(a);
  }
}
async function refresh(){
  const selected=state?.workspace.selectedId;adopt(await api('/api/state'));
  if(selected&&selected!==state.workspace.selectedId){pending=null;rejected=null;source=null;headers=[];clearPreviews();$('filename').textContent='Household changed; choose the original source again.';}
  await Promise.all([page('tariff'),page('week')]);await recover();lock();
}
async function recover(){
  const raw=sessionStorage.getItem(key());if(!raw){brokenPending=false;return;}brokenPending=true;
  const value=JSON.parse(raw);
  if(value.schema!=='gridkind-tariff-pending/v1'||value.body?.context?.householdId!==state.workspace.selectedId||value.intentSha256!==await hash(intent(value.body)))throw Error('The retained tariff request has changed. Preserve the browser data and original request before continuing.');
  pending=value;brokenPending=false;rejected=null;lock();
}
function renderApply(p){
  const out=$('apply-preview');out.replaceChildren();out.append(el('h3',p.complete?'All 168 prices are ready':'The selected week is incomplete'));
  out.append(el('p',p.preserved),el('p',p.selectedRows.length+' selected original rows; '+p.unselectedRows+' unselected rows, including '+p.invalidUnselectedRows+' invalid unselected rows. Unselected rows remain in the original source; no dates are inferred.'),el('p','Original price source SHA-256: '+p.sourceSha256));
  if(p.errors.length)table(out,['Date','Hour','Problem','Source rows'],p.errors.map(e=>[e.date,String(e.hour).padStart(2,'0'),e.status,e.sourceRows.join(', ')]));
  table(out,['Date','Hour','Source row','Old USD/kWh','Original price','New exact USD/kWh'],p.selectedRows.map(r=>[r.date,String(r.hour).padStart(2,'0'),r.sourceRow,r.previousUsdPerKwh,r.originalPrice,r.exactUsdPerKwh]));
  if(p.complete)out.append(el('p','Apply saves a new week through the original scheduler. The original week remains unchanged; this action does not approve or execute a day.'));
}
async function prepare(body){
  if(pending)throw Error('Reconcile the retained request first.');
  pending={schema:'gridkind-tariff-pending/v1',createdAt:new Date().toISOString(),body:{...body,requestId:crypto.randomUUID(),context:context()}};
  pending.intentSha256=await hash(intent(pending.body));rejected=null;
  try{sessionStorage.setItem(key(pending.body.context.householdId),JSON.stringify(pending));}catch(error){pending=null;throw Error('The exact request could not be saved in this browser. Nothing was dispatched: '+error.message);}
  await dispatch();
}
async function dispatch(){
  const original=pending;if(!original)return;
  // Persist before every dispatch, including a retry after earlier storage failure.
  sessionStorage.setItem(key(original.body.context.householdId),JSON.stringify(original));lock();
  try{
    const result=await api('/api/tariffs',original.body);
    if(pending!==original)throw Error('The original request selection changed.');
    sessionStorage.removeItem(key(original.body.context.householdId));pending=null;rejected=null;adopt(result.state);
    const out=$('outcome');out.replaceChildren(el('h3',result.replayed?'Original outcome recovered':'Saved'));
    out.append(el('p',result.record.label+' · '+result.record.id));const a=el('a',result.record.kind==='week'?'Open saved week':'Inspect source and downloads');
    a.href=result.record.kind==='week'?'/week?record='+encodeURIComponent(result.record.id):'#saved-source';out.append(a);
    await Promise.all([page('tariff',0,result.record.kind==='tariff'?result.record.id:original.body.tariffId),page('week',0,result.record.kind==='week'?result.record.id:null)]);
    message(result.record.kind==='week'?'A new weekly record is saved. Open it in the week planner; daily approval is still a separate deliberate step.':'Original source and its interpretation are saved as an immutable edition.');
  }catch(error){
    const marker=error.result?.tariffOutcome;
    if(marker?.status==='not_committed'&&marker.householdId===original.body.context.householdId&&marker.requestId===original.body.requestId&&marker.requestSha256===original.intentSha256)rejected=marker;
    if(error.result?.state)adopt(error.result.state);throw error;
  }finally{lock();}
}
$('source-file').onchange=()=>run(async()=>{
  const file=$('source-file').files[0];if(!file)return;
  clearPreviews();source=null;headers=[];mappingOptions();$('filename').textContent='Reading '+file.name+'…';
  if(file.size>8*1024*1024){$('source-file').value='';throw Error('Choose a CSV up to 1 MiB or an exported source JSON up to 8 MiB.');}
  const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
  let result;
  if(file.name.toLowerCase().endsWith('.json')){
    result=await api('/api/tariffs',{action:'headers',edition:JSON.parse(raw.replace(/^\uFEFF/,'')),context:context()});
    source=result.source;headers=result.headers;
    $('source-title').value=source.title;$('source-unit').value=source.unit;$('source-role').value=source.role;$('source-url').value=source.sourceUrl;$('source-note').value=source.note;
    mappingOptions(source.mapping);
  }else{
    if(new TextEncoder().encode(raw).length>1048576){$('source-file').value='';throw Error('Original CSV exceeds 1 MiB.');}
    result=await api('/api/tariffs',{action:'headers',csv:raw,context:context()});
    source={filename:file.name,csv:raw};headers=result.headers;mappingOptions();$('source-unit').value='';$('source-role').value='user_supplied';$('source-url').value='';$('source-note').value='';$('source-title').value=file.name.replace(/\.csv$/i,'').slice(0,100);
  }
  adopt(result.state);$('clock-confirm').checked=false;$('filename').textContent=source.filename+' · '+result.rows+' original records';message('Choose explicit units and confirm the clock interpretation, then preview.');
});
$('source-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const fields=sourceFields(),result=await api('/api/tariffs',{action:'preview-source',source:fields,context:context()});
  adopt(result.state);sourcePreview={edition:result.preview,fields,context:context()};rowOffset=0;rowView(result.preview);message('Review the original rows and coverage before saving.');
});};
for(const id of ['source-title','map-date','map-hour','map-price','source-unit','source-role','source-url','source-note','clock-confirm'])$(id).addEventListener('input',()=>{sourcePreview=null;$('source-preview').replaceChildren();lock();});
$('save-source').onclick=()=>run(async()=>{
  if(!sourcePreview||stamp(sourcePreview.fields)!==stamp(sourceFields())||stamp(sourcePreview.context)!==stamp(context()))throw Error('Preview this exact source and current household again.');
  await prepare({action:'save',source:sourcePreview.fields,previewSha256:sourcePreview.edition.sha256});
});
$('preview-apply').onclick=()=>run(async()=>{
  const tariffId=$('saved-source').value,targetId=$('saved-week').value;if(!tariffId||!targetId)throw Error('Choose a saved source and a saved week.');
  const result=await api('/api/tariffs',{action:'preview-apply',tariffId,targetId,context:context()});
  adopt(result.state);applyPreview={...result.preview,context:context()};renderApply(applyPreview);message('Review every selected price, original row and retained load setting.');
});
$('apply').onclick=()=>run(async()=>{
  if(!applyPreview?.complete||applyPreview.tariffId!==$('saved-source').value||applyPreview.targetId!==$('saved-week').value||stamp(applyPreview.context)!==stamp(context()))throw Error('Preview the exact selected source/week again.');
  await prepare({action:'apply',tariffId:applyPreview.tariffId,targetId:applyPreview.targetId,previewSha256:applyPreview.sha256});
});
for(const id of ['saved-source','saved-week'])$(id).onchange=()=>{applyPreview=null;$('apply-preview').replaceChildren();downloads();lock();};
$('refresh').onclick=()=>run(refresh);$('retry').onclick=()=>run(dispatch);
$('preserve').onclick=()=>run(async()=>{
  if(!pending||!rejected)throw Error('Only an exact server-confirmed uncommitted request can be re-previewed.');
  const original=pending;sessionStorage.setItem('gridkind-tariff-rejected-v1:'+original.body.requestId,JSON.stringify({pending:original,outcome:rejected}));
  sessionStorage.removeItem(key(original.body.context.householdId));pending=null;rejected=null;clearPreviews();await refresh();message('The rejected request remains archived in this browser. Re-preview the current source or week before a new deliberate request.');
});
for(const [id,kind,step] of [['source-newer','tariff',-50],['source-older','tariff',50],['week-newer','week',-50],['week-older','week',50]])$(id).onclick=()=>run(()=>page(kind,(kind==='tariff'?sourcePage:weekPage).offset+step));
await run(async()=>{
  await refresh();
  const sourceId=new URLSearchParams(location.search).get('source');
  if(sourceId&&!pending){
    const record=await api('/api/workspace/record?householdId='+encodeURIComponent(state.workspace.selectedId)+'&id='+encodeURIComponent(sourceId));
    if(record.kind!=='tariff')throw Error('This record is not a saved tariff source.');
    if(![...$('saved-source').options].some(o=>o.value===record.id))$('saved-source').add(new Option('#'+record.sequence+' · '+record.label,record.id));
    $('saved-source').value=record.id;downloads();
  }
});

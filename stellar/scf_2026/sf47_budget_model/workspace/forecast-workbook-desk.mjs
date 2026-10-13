// MIT. Complete returned assumption review in the original Forecast workspace.
import {FORECAST_WORKBOOK_SHEETS,signature,createForecastWorkbook,receiveForecastWorkbook,
 receiveForecastCsv,inspectForecastCsv,validateForecastWorkbookReturn,reconcileForecastWorkbook,
 workbookUpload,decodeWorkbookBytes,MAX_FORECAST_WORKBOOK_BYTES} from './forecast-workbook.mjs';
const SCHEMA='stellar-forge.forecast-workbook-desk.v1';
const clone=v=>JSON.parse(JSON.stringify(v)),plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const same=(a,b)=>signature(a)===signature(b),need=(v,m)=>{if(!v)throw Error(m);};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const blank=()=>({schema:SCHEMA,received:null,choices:{},note:'',sourceReceipt:null,appliedReview:null,selectedSheet:'Forecast',search:'',page:0,sourcePage:0,csvDraft:{baseline:null,materials:[]}});
const keys=['schema','received','choices','note','sourceReceipt','appliedReview','selectedSheet','search','page','sourcePage','csvDraft'];
const opts=c=>({caseId:c.program.id,originCaseId:c.program.origin?.programId,planContentSha256:c.plan.contentSha256});
async function checkedRaw(raw){const data=decodeWorkbookBytes(raw?.dataBase64||'');const again=await workbookUpload(raw.filename,data);need(same(again,raw),'Retain the complete original selected file and byte identity.');return raw;}
export async function validateForecastWorkbookDeskState(value,options={}){
 if(value===null||value===undefined)return blank();
 need(plain(value)&&value.schema===SCHEMA&&Object.keys(value).every(k=>keys.includes(k)),'Open the complete Forecast workbook review.');
 const s={...blank(),...clone(value)};
 need(plain(s.choices)&&Object.values(s.choices).every(v=>['current','returned'].includes(v)),'Retain explicit current or returned conflict choices.');
 need(typeof s.note==='string'&&s.note.length<=12000&&typeof s.search==='string'&&s.search.length<=1000,'Keep the complete note and source search within their field limits.');
 need(FORECAST_WORKBOOK_SHEETS.some(t=>t.name===s.selectedSheet)&&[s.page,s.sourcePage].every(v=>Number.isSafeInteger(v)&&v>=0),'Retain a valid complete review selection.');
 need(plain(s.csvDraft)&&Object.keys(s.csvDraft).every(k=>['baseline','materials'].includes(k))&&Array.isArray(s.csvDraft.materials)&&s.csvDraft.materials.length<FORECAST_WORKBOOK_SHEETS.length,'Retain the complete CSV source-selection draft.');
 if(s.csvDraft.baseline)await checkedRaw(s.csvDraft.baseline);
 const sheets=new Set;
 for(const m of s.csvDraft.materials){
  need(plain(m)&&Object.keys(m).every(k=>['sheet','source','delimiter','columns'].includes(k))&&
   FORECAST_WORKBOOK_SHEETS.some(t=>t.name===m.sheet&&t.name!=='Original')&&!sheets.has(m.sheet)&&plain(m.columns),
   'Retain each CSV sheet, full source and selected columns.');sheets.add(m.sheet);await checkedRaw(m.source);
  const p=inspectForecastCsv(m.source,{delimiter:m.delimiter}),spec=FORECAST_WORKBOOK_SHEETS.find(t=>t.name===m.sheet);
  need(Object.keys(m.columns).every(k=>spec.headers.includes(k))&&Object.values(m.columns).every(v=>Number.isSafeInteger(v)&&v>=-1&&v<p.headings.length),'Retain valid unfinished CSV column selections.');
 }
 if(s.received)s.received=await validateForecastWorkbookReturn(s.received,options);
 else need(!Object.keys(s.choices).length&&!s.appliedReview,'Receive a source before retaining its review.');
 if(s.sourceReceipt){need(s.received&&plain(s.sourceReceipt)&&/^source-[a-f0-9]{32}$/.test(s.sourceReceipt.id||'')&&s.sourceReceipt.sha256===s.received.source.sha256&&Number.isSafeInteger(s.sourceReceipt.version)&&s.sourceReceipt.version>=1,'Retain the original source receipt for this complete return.');}
 if(s.appliedReview){
  const a=s.appliedReview;
  need(plain(a)&&Object.keys(a).every(k=>['received','beforeInputs','choices','reviewedInputs','note','sourceReceipt','appliedInputs'].includes(k))&&same(a.received,s.received)&&typeof a.note==='string'&&a.note.length<=12000,'Retain the complete applied review.');
  const r=reconcileForecastWorkbook(s.received,a.beforeInputs,a.choices);
  need(!r.unresolved&&same(r.inputs,a.reviewedInputs)&&plain(a.appliedInputs)&&plain(a.sourceReceipt)&&typeof a.sourceReceipt.id==='string'&&a.sourceReceipt.sha256===s.received.source.sha256&&Number.isSafeInteger(a.sourceReceipt.version)&&a.sourceReceipt.version>=1,'Retain the original reviewed assumptions and complete source receipt.');
  signature(a.appliedInputs);need(Object.keys(s.choices).length===0,'Applied conflict choices remain in the original completed review.');
 }else if(s.received&&options.currentInputs)reconcileForecastWorkbook(s.received,options.currentInputs,s.choices);
 need(new TextEncoder().encode(JSON.stringify(s)).length<=32*1024*1024,'The complete workbook working review exceeds 32 MiB.');
 return s;
}
function download(value,name,type){const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
const button=(name,label,disabled=false)=>'<button type="button" data-fwb="'+name+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const display=v=>v?.present?JSON.stringify(v.value,null,2):'(absent)';
const cell=v=>'<details><summary>'+esc(display(v).slice(0,100))+'</summary><pre>'+esc(display(v))+'</pre></details>';
const styles='<link rel="stylesheet" href="/forecast-workbook.css">';
export function mountForecastWorkbook(context){
 const root=context.container;need(root&&typeof context.getCurrent==='function'&&typeof context.getInputs==='function','Mount in the original Forecast workspace.');
 let s=blank(),busy=false,hostBusy=false,disposed=false,generation=0,error='',status='',ready=false;
 const nativeReceived=new WeakSet;
 const current=()=>context.getCurrent(),inputs=()=>context.getInputs();
 const active=()=>!disposed&&(typeof context.available!=='function'||context.available());
 const blocked=()=>busy||hostBusy||!ready||!active()||(typeof context.isBlocked==='function'&&context.isBlocked());
 const snap=()=>clone(s);
 async function notify(){if(context.onStateChange)await context.onStateChange(snap());}
 const stamp=()=>({generation,case:current().program.id,plan:current().plan.contentSha256,inputs:signature(inputs())});
 function guard(t){need(active()&&t.generation===generation&&t.case===current().program.id&&t.plan===current().plan.contentSha256&&t.inputs===signature(inputs()),'The selected case or Forecast draft changed while the source was being read. The current work is retained; review this selection again.');}
 async function run(fn){if(blocked())return;busy=true;error='';status='Working with complete original source…';render();try{await fn();}catch(e){error=e.message||String(e);}finally{busy=false;status='';if(active())render();}}
 function plan(){return s.received?reconcileForecastWorkbook(s.received,inputs(),s.choices):null;}
 function render(){
  if(disposed)return;
  const locked=blocked();let hasInputs=true;try{inputs();}catch{hasInputs=false;}
  let out=styles+'<section class="forecast-workbook"><h4>Prepare forecast assumptions</h4><p>Work across complete package costs, invoice and grant dates, customer scope and receipts, capacity and explicit currency assumptions. Receive the returned workbook into this original Forecast draft.</p>'+
   '<div class="fwb-actions">'+button('xlsx','Download editable XLSX',locked||!hasInputs)+button('kit','Download workbook, original JSON and CSV sheets',locked||!hasInputs)+button('receive-xlsx','Receive returned XLSX',locked||!hasInputs)+button('review-download','Download complete workbook review',locked)+button('review-choose','Reopen workbook review',locked)+'</div>'+
   '<input hidden data-fwb-xlsx type="file" accept=".xlsx"><input hidden data-fwb-review type="file" accept=".json">'+
   (status?'<p role="status">'+esc(status)+'</p>':'')+(error?'<p class="fwb-alert" role="alert">'+esc(error)+'</p>':'')+
   '<details'+(s.csvDraft.baseline||s.csvDraft.materials.length?' open':'')+'><summary>Return CSV or TSV sheets</summary><p>Choose the complete original-forecast.json from the exported kit. Add each returned sheet, select its delimiter and map every field. Unselected sheets retain their original values.</p>'+
   '<div class="fwb-actions">'+button('baseline','Choose original Forecast JSON',locked)+button('csv-file','Add returned CSV/TSV',locked)+button('csv-review','Review selected sheets',locked||!s.csvDraft.baseline||!s.csvDraft.materials.length)+'</div>'+
   '<input hidden data-fwb-baseline type="file" accept=".json"><input hidden data-fwb-csv type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values">'+
   (s.csvDraft.baseline?'<p>Original input: '+esc(s.csvDraft.baseline.filename)+' · '+s.csvDraft.baseline.bytes+' bytes</p>':'');
  s.csvDraft.materials.forEach((m,i)=>{
   const spec=FORECAST_WORKBOOK_SHEETS.find(t=>t.name===m.sheet);let p=null;try{p=inspectForecastCsv(m.source,{delimiter:m.delimiter});}catch(e){out+='<p role="alert">'+esc(e.message)+'</p>';}
   out+='<div class="fwb-file"><strong>'+esc(m.source.filename)+'</strong> · '+m.source.bytes+' bytes'+
    '<div class="fwb-actions"><label>Worksheet <select data-fwb-csv-sheet="'+i+'"'+(locked?' disabled':'')+'>'+FORECAST_WORKBOOK_SHEETS.filter(t=>t.name!=='Original').map(t=>'<option'+(t.name===m.sheet?' selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select></label>'+
    '<label>Delimiter <select data-fwb-csv-delimiter="'+i+'"'+(locked?' disabled':'')+'>'+[[',','Comma'],['\t','Tab'],[';','Semicolon'],['|','Pipe']].map(([v,l])=>'<option value="'+esc(v)+'"'+(v===m.delimiter?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
    '<button type="button" data-fwb-remove-csv="'+i+'"'+(locked?' disabled':'')+'>Remove this selection</button></div>';
   if(p)out+='<p>'+p.rows.length+' complete returned rows</p><div class="fwb-mapping">'+spec.headers.map(h=>'<label>'+esc(h)+' <select data-fwb-map="'+esc(h)+'" data-fwb-map-row="'+i+'"'+(locked?' disabled':'')+'><option value="-1">Choose source column</option>'+p.headings.map((v,n)=>'<option value="'+n+'"'+(m.columns[h]===n?' selected':'')+'>'+esc((n+1)+': '+v)+'</option>').join('')+'</select></label>').join('')+'</div>';
   out+='</div>';
  });
  out+='</details>';
  if(s.received){
   const source=s.received.source;
   out+='<h5>Complete returned source</h5><p>'+esc(source.filename)+' · '+source.bytes+' bytes · <code>'+esc(source.sha256)+'</code></p>'+
    '<div class="fwb-actions">'+button('source','Download original returned source',locked)+button('refresh','Review against current draft again',locked)+'</div>'+
    '<label>Source and assumption review note<textarea data-fwb-note maxlength="12000" rows="3"'+(locked?' disabled':'')+'>'+esc(s.note)+'</textarea></label>';
   if(s.sourceReceipt&&!s.appliedReview)out+='<p class="fwb-alert">The complete source is already retained in this case: '+esc(s.sourceReceipt.id)+'. Review the current draft below before applying its assumptions.</p>';
   if(s.appliedReview){out+='<p class="fwb-alert">This reviewed return was applied through the original native preview. Source '+esc(s.appliedReview.sourceReceipt.id)+' remains in the case. Use the original Save forecast control to retain its next immutable edition.</p>'+
    '<details><summary>Original applied choices and values</summary><pre>'+esc(JSON.stringify({beforeInputs:s.appliedReview.beforeInputs,choices:s.appliedReview.choices,reviewedInputs:s.appliedReview.reviewedInputs,note:s.appliedReview.note,sourceReceipt:s.appliedReview.sourceReceipt,appliedInputs:s.appliedReview.appliedInputs},null,2))+'</pre></details>';}
   else{
    let p;try{p=plan();}catch(e){out+='<p role="alert">'+esc(e.message)+'</p>';}
    if(p){
     const max=Math.max(1,Math.ceil(p.changes.length/25)),pg=Math.min(s.page,max-1);
     out+='<p>'+p.changes.length+' proposed changes · '+p.conflicts.length+' conflicts · '+p.unresolved+' choices remaining. Omitted original rows remain unchanged.</p>'+
      '<div class="fwb-table"><table><thead><tr><th>Field / original row</th><th>Current draft</th><th>Reviewed return</th></tr></thead><tbody>'+p.changes.slice(pg*25,(pg+1)*25).map(r=>'<tr><th>'+esc(r.path)+'</th><td>'+cell(r.before)+'</td><td>'+cell(r.after)+'</td></tr>').join('')+'</tbody></table></div>'+
      '<div class="fwb-actions">'+button('prev','Previous changes',locked||pg===0)+'<span>Page '+(pg+1)+' of '+max+'</span>'+button('next','Next changes',locked||pg+1>=max)+'</div>';
     if(p.conflicts.length)out+='<h5>Resolve concurrent changes</h5><div class="fwb-table"><table><thead><tr><th>Field</th><th>Original export</th><th>Current draft</th><th>Returned source</th><th>Keep</th></tr></thead><tbody>'+p.conflicts.map(r=>'<tr><th>'+esc(r.path)+'</th><td>'+cell(r.original)+'</td><td>'+cell(r.current)+'</td><td>'+cell(r.returned)+'</td><td><select data-fwb-choice="'+esc(r.path)+'"'+(locked?' disabled':'')+'><option value="">Choose</option><option value="current"'+(r.choice==='current'?' selected':'')+'>Current draft</option><option value="returned"'+(r.choice==='returned'?' selected':'')+'>Returned source</option></select></td></tr>').join('')+'</tbody></table></div>';
     out+='<div class="fwb-actions">'+button('apply','Retain source and apply reviewed assumptions',locked||p.unresolved>0||!s.note.trim())+'</div>';
    }
   }
   const table=s.received.tables.find(t=>t.name===s.selectedSheet),rows=table.rows.filter(r=>!s.search||r.some(v=>v.toLocaleLowerCase().includes(s.search.toLocaleLowerCase()))),max=Math.max(1,Math.ceil(rows.length/25)),pg=Math.min(s.sourcePage,max-1);
   out+='<h5>All original returned cells</h5><div class="fwb-actions"><label>Sheet <select data-fwb-sheet'+(locked?' disabled':'')+'>'+s.received.tables.map(t=>'<option'+(t.name===s.selectedSheet?' selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select></label>'+
    '<label>Search selected sheet <input data-fwb-search value="'+esc(s.search)+'" maxlength="1000"'+(locked?' disabled':'')+'></label></div><p>'+rows.length+' matching rows; '+table.rows.length+' total. Complete values remain in the download.</p>'+
    '<div class="fwb-table"><table><thead><tr>'+table.headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(pg*25,(pg+1)*25).map(r=>'<tr>'+r.map(v=>'<td><details><summary>'+esc(v.slice(0,100)||'(empty)')+'</summary><pre>'+esc(v)+'</pre></details></td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
    '<div class="fwb-actions">'+button('source-prev','Previous source rows',locked||pg===0)+'<span>Page '+(pg+1)+' of '+max+'</span>'+button('source-next','Next source rows',locked||pg+1>=max)+'</div>';
  }else out+='<p>No returned source selected. The original Forecast draft remains available above.</p>';
  root.innerHTML=out+'</section>';
 }
 const apiInspect=body=>context.api('/api/source-tables/workbook/inspect',body),apiProject=body=>context.api('/api/source-tables/workbook/project',body);
 async function upload(file){need(file&&file.size>0&&file.size<=MAX_FORECAST_WORKBOOK_BYTES,'Choose a complete file within the original 8 MiB source allowance.');return workbookUpload(file.name,new Uint8Array(await file.arrayBuffer()));}
 async function chooseFile(file,type){
  const t=stamp();const raw=await upload(file);guard(t);
  if(type==='xlsx'){
   const r=await receiveForecastWorkbook(raw,{...opts(current()),inspectWorkbook:apiInspect,projectWorkbook:apiProject});guard(t);
   nativeReceived.add(r);s.received=r;s.choices={};s.sourceReceipt=null;s.appliedReview=null;s.page=0;s.sourcePage=0;s.selectedSheet='Forecast';
  }else if(type==='baseline')s.csvDraft.baseline=raw;
  else{
   const name=file.name.replace(/\.(csv|tsv)$/i,'').replace(/-/g,' '),spec=FORECAST_WORKBOOK_SHEETS.find(x=>x.name.toLowerCase()===name.toLowerCase()&&x.name!=='Original')||FORECAST_WORKBOOK_SHEETS.find(x=>x.name!=='Original'&&!s.csvDraft.materials.some(m=>m.sheet===x.name));
   need(spec&&!s.csvDraft.materials.some(m=>m.sheet===spec.name),'Each returned sheet is selected once. Remove or change the existing selection before adding another.');
   const delimiter=/\.tsv$/i.test(file.name)?'\t':',',p=inspectForecastCsv(raw,{delimiter});
   s.csvDraft.materials.push({sheet:spec.name,source:raw,delimiter,columns:Object.fromEntries(spec.headers.map(h=>[h,p.headings.indexOf(h)]))});
  }
  generation++;await notify();
 }
 async function apply(){
  need(s.received&&!s.appliedReview&&s.note.trim(),'Receive and review the complete source first.');
  const t=stamp(),original=s.received;
  if(original.transport==='xlsx'&&!nativeReceived.has(original)){
   const replay=await receiveForecastWorkbook(original.source,{...opts(current()),inspectWorkbook:apiInspect,projectWorkbook:apiProject,receivedAt:original.receivedAt});guard(t);
   need(same(replay.baseInputs,original.baseInputs)&&same(replay.returnedInputs,original.returnedInputs)&&same(replay.tables,original.tables),'Native receiving found different source cells. Receive this workbook again before applying.');nativeReceived.add(original);
  }
  await validateForecastWorkbookReturn(original,opts(current()));guard(t);
  const beforeInputs=clone(inputs()),p=reconcileForecastWorkbook(original,beforeInputs,s.choices);need(!p.unresolved,'Resolve every concurrent field before applying.');
  const review={received:clone(original),beforeInputs,choices:clone(s.choices),reviewedInputs:clone(p.inputs),note:s.note};
  await notify();guard(t);
  const result=await context.applyReviewedInputs({inputs:clone(p.inputs),expectedCurrentSignature:p.currentSignature,source:clone(original.source),review});
  need(active()&&s.received===original,'The original source operation completed after this review closed; recover the same retained operation in the original Forecast desk.');
  s.sourceReceipt=clone(result.sourceReceipt);s.choices={};
  if(result.adopted===false){s.appliedReview=null;error=result.message||'The source is saved; review it against the changed current draft.';}
  else s.appliedReview={...review,sourceReceipt:clone(result.sourceReceipt),appliedInputs:clone(result.inputs)};
  generation++;await notify();
 }
 async function click(e){
  const remove=e.target.closest('[data-fwb-remove-csv]');if(remove&&!blocked()){s.csvDraft.materials.splice(Number(remove.dataset.fwbRemoveCsv),1);generation++;await notify();render();return;}
  const b=e.target.closest('[data-fwb]');if(!b||b.disabled)return;
  const name=b.dataset.fwb;if(['receive-xlsx','review-choose','baseline','csv-file'].includes(name)){root.querySelector({'receive-xlsx':'[data-fwb-xlsx]','review-choose':'[data-fwb-review]',baseline:'[data-fwb-baseline]','csv-file':'[data-fwb-csv]'}[name]).click();return;}
  await run(async()=>{
   if(name==='xlsx'||name==='kit'){const t=stamp(),p=await createForecastWorkbook(inputs(),opts(current()));guard(t);download(name==='xlsx'?p.workbook.data:p.kit.data,name==='xlsx'?p.workbook.filename:p.kit.filename,name==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/zip');return;}
   if(name==='review-download'){download(JSON.stringify(s,null,2)+'\n','forecast-workbook-review.json','application/json');return;}
   if(name==='csv-review'){const t=stamp(),r=await receiveForecastCsv(s.csvDraft.baseline,s.csvDraft.materials,opts(current()));guard(t);s.received=r;s.choices={};s.sourceReceipt=null;s.appliedReview=null;s.page=s.sourcePage=0;s.selectedSheet='Forecast';generation++;await notify();return;}
   if(name==='apply'){await apply();return;}
   if(name==='source'){download(decodeWorkbookBytes(s.received.source.dataBase64),s.received.source.filename,s.received.source.mediaType);return;}
   if(name==='refresh'){s.choices={};s.appliedReview=null;s.page=0;}
   if(name==='prev')s.page=Math.max(0,s.page-1);if(name==='next')s.page++;
   if(name==='source-prev')s.sourcePage=Math.max(0,s.sourcePage-1);if(name==='source-next')s.sourcePage++;
   generation++;await notify();
  });
 }
 async function change(e){
  const target=e.target;if(blocked())return;
  if(target.matches('[data-fwb-xlsx],[data-fwb-baseline],[data-fwb-csv]')){const file=target.files?.[0],type=target.matches('[data-fwb-xlsx]')?'xlsx':target.matches('[data-fwb-baseline]')?'baseline':'csv';if(file)await run(()=>chooseFile(file,type));return;}
  if(target.matches('[data-fwb-review]')){const file=target.files?.[0];if(!file)return;await run(async()=>{need(file.size<=32*1024*1024,'Choose a complete workbook review within 32 MiB.');const t=stamp(),checked=await validateForecastWorkbookDeskState(JSON.parse(await file.text()),{...opts(current()),currentInputs:inputs()});guard(t);s=checked;generation++;await notify();});return;}
  try{
   if(target.dataset.fwbChoice!==undefined){if(target.value)s.choices[target.dataset.fwbChoice]=target.value;else delete s.choices[target.dataset.fwbChoice];}
   if(target.matches('[data-fwb-sheet]')){s.selectedSheet=target.value;s.sourcePage=0;}
   if(target.dataset.fwbCsvSheet!==undefined){const m=s.csvDraft.materials[Number(target.dataset.fwbCsvSheet)];need(!s.csvDraft.materials.some(v=>v!==m&&v.sheet===target.value),'Each returned sheet is selected once.');m.sheet=target.value;const spec=FORECAST_WORKBOOK_SHEETS.find(t=>t.name===m.sheet),p=inspectForecastCsv(m.source,{delimiter:m.delimiter});m.columns=Object.fromEntries(spec.headers.map(h=>[h,p.headings.indexOf(h)]));}
   if(target.dataset.fwbCsvDelimiter!==undefined){const m=s.csvDraft.materials[Number(target.dataset.fwbCsvDelimiter)],p=inspectForecastCsv(m.source,{delimiter:target.value});m.delimiter=target.value;const spec=FORECAST_WORKBOOK_SHEETS.find(t=>t.name===m.sheet);m.columns=Object.fromEntries(spec.headers.map(h=>[h,p.headings.indexOf(h)]));}
   if(target.dataset.fwbMap!==undefined)s.csvDraft.materials[Number(target.dataset.fwbMapRow)].columns[target.dataset.fwbMap]=Number(target.value);
   generation++;await notify();
  }catch(err){error=err.message;}render();
 }
 function input(e){
  if(blocked())return;
  if(e.target.matches('[data-fwb-note]')){s.note=e.target.value;generation++;void notify().catch(err=>{error=err.message;render();});const b=root.querySelector('[data-fwb="apply"]');if(b){let okay=false;try{okay=!plan().unresolved&&s.note.trim();}catch{}b.disabled=!okay;} }
  if(e.target.matches('[data-fwb-search]')){s.search=e.target.value;s.sourcePage=0;generation++;void notify().catch(err=>{error=err.message;});const start=e.target.selectionStart;render();const el=root.querySelector('[data-fwb-search]');el?.focus();el?.setSelectionRange(start,start);}
 }
 const onClick=e=>void click(e).catch(err=>{error=err.message;render();}),onChange=e=>void change(e).catch(err=>{error=err.message;render();});
 root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('input',input);
 async function restore(value){const recoverInputs=()=>typeof context.getRecoveryInputs==='function'?context.getRecoveryInputs():inputs();const original=generation,t=opts(current()),before=signature(recoverInputs());const checked=await validateForecastWorkbookDeskState(value,{...t,currentInputs:recoverInputs()});need(!disposed&&original===generation&&same(t,opts(current()))&&before===signature(recoverInputs()),'The original draft changed while its workbook review was reopened.');s=checked;generation++;ready=true;render();return snap();}
 const restored=restore(context.initialState).catch(err=>{error=err.message;ready=true;render();});
 render();
 return{dispose(){disposed=true;generation++;root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);root.removeEventListener('input',input);},
 setHostBusy(value){hostBusy=Boolean(value);render();},snapshot:snap,restore,ready:restored};
}

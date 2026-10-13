/** Plain recipient inspection of an immutable collection edition. */
import {collectionRandomId} from './collection_transfer.mjs';
import {collectionReadingFilters} from './edition_reader.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shown=x=>x===undefined?'Absent':x===null?'Null':typeof x==='object'?JSON.stringify(x):String(x);
const FORMAT='upper-savannah-edition-reading-work/v1';
const SESSION='upper-savannah-edition-reading-session/v1';
const css=".collection-edition-reader{padding:16px;border:1px solid #b8bec5;background:#f6f7f8;color:#20242a;font:14px/1.5 system-ui,sans-serif;max-width:100%;box-sizing:border-box}.collection-edition-reader *{box-sizing:border-box}.collection-edition-reader h3,.collection-edition-reader h4,.collection-edition-reader label,.collection-edition-reader summary,.collection-edition-reader p,.collection-edition-reader td,.collection-edition-reader th,.collection-edition-reader dd,.collection-edition-reader dt{color:#20242a}.collection-edition-reader h3{font-size:20px;margin:0 0 8px}.collection-edition-reader h4{font-size:16px;margin:18px 0 8px}.collection-edition-reader dl{display:grid;grid-template-columns:180px 1fr;gap:6px 12px;background:#fff;padding:12px;border:1px solid #ccd1d6}.collection-edition-reader dt{font-weight:600}.collection-edition-reader dd{margin:0;overflow-wrap:anywhere}.collection-edition-reader code,.collection-edition-reader pre{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}.collection-edition-reader pre{max-height:32em;overflow:auto;background:#fff;border:1px solid #ccd1d6;color:#20242a;padding:10px}.collection-edition-reader details{margin:10px 0}.collection-edition-reader summary{cursor:pointer;font-weight:600}.collection-edition-reader label{display:grid;gap:4px}.collection-edition-reader .er-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:16px}.collection-edition-reader input,.collection-edition-reader select,.collection-edition-reader button{font:inherit;color:#20242a;background:#fff;border:1px solid #8b939c;border-radius:3px;padding:8px;max-width:100%}.collection-edition-reader button{background:#edf0f2;cursor:pointer;min-height:36px}.collection-edition-reader button:disabled{background:#e2e5e8;color:#6e7781;cursor:default}.collection-edition-reader :is(button,input,select):focus-visible{outline:2px solid #20242a;outline-offset:2px}.collection-edition-reader .er-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.collection-edition-reader .er-scroll{max-width:100%;overflow:auto}.collection-edition-reader table{border-collapse:collapse;min-width:800px;width:100%;background:#fff}.collection-edition-reader th,.collection-edition-reader td{padding:8px;border:1px solid #ccd1d6;text-align:left;vertical-align:top}.collection-edition-reader th{background:#e8ebee}.collection-edition-reader td{overflow-wrap:anywhere;max-width:360px}.collection-edition-reader .er-help{background:#eef0f2;color:#20242a;border:1px solid #9da5ae;border-left:4px solid #59636d;padding:12px;margin:14px 0}.collection-edition-reader .er-help strong{color:#20242a}.collection-edition-reader .er-help p{margin:6px 0}.collection-edition-reader [role=alert]{padding:10px;background:#f0eded;border-left:3px solid #4b3838;color:#302424}.collection-edition-reader [role=status]{min-height:24px}.collection-edition-reader progress{width:100%;height:14px}.collection-edition-reader [hidden]{display:none!important}@media(max-width:600px){.collection-edition-reader{padding:10px;font-size:13px}.collection-edition-reader dl{grid-template-columns:1fr}.collection-edition-reader dd{margin-bottom:8px}.collection-edition-reader .er-actions>button{flex:1 1 140px}.collection-edition-reader .er-controls{grid-template-columns:1fr}}@media print{.collection-edition-reader{background:#fff;border:0;padding:0}.collection-edition-reader button,.collection-edition-reader input,.collection-edition-reader select,.collection-edition-reader progress,.collection-edition-reader .er-controls{display:none}.collection-edition-reader .er-scroll,.collection-edition-reader pre{overflow:visible;max-height:none}.collection-edition-reader table{min-width:0;font-size:10px}}";
export function mountCollectionEditionReader(host,{reader,workspaceKey,downloadOriginal,initialPosition=null,onChange=()=>{},check=()=>{}}){
 if(!reader?.page||typeof workspaceKey!=='string'||!workspaceKey)throw Error('Select the original edition and workspace/account before reading.');
 const edition=reader.edition,lifetime=new AbortController(),urls=new Set();
 let dead=false,busy=false,sequence=0,openSequence=0,version=0,abort=null,result=null;
 let position=reader.position(),draft={population:'accepted',stationId:'',parameter:'',reason:'',limit:'50'},pending=null,dirty=false,persistenceText='',guidanceDismissed=[];
 function work(){return {format:FORMAT,position:clone(position),draft:clone(draft),pending:pending?clone(pending):null,guidanceDismissed:[...guidanceDismissed]};}
 function snapshot(){return {format:SESSION,workspaceKey,work:work()};}
 function validateWork(v){
  if(!v||v.format!==FORMAT)throw Error('Choose a complete saved edition reading file.');
  const p=reader.validatePosition(v.position),d=v.draft;
  if(!d||!['accepted','excluded'].includes(d.population)||typeof d.limit!=='string'||!/^\d{0,3}$/.test(d.limit))throw Error('The saved unfinished reading controls are invalid.');
  collectionReadingFilters({stationId:d.stationId,parameter:d.parameter,reason:d.reason});
  const dismissed=v.guidanceDismissed??[];
  if(!Array.isArray(dismissed)||new Set(dismissed).size!==dismissed.length||dismissed.some(x=>!['population','records','originals'].includes(x)))throw Error('The saved reading guidance state is invalid.');
  return {position:p,draft:clone(d),pending:v.pending?reader.validatePosition(v.pending):null,guidanceDismissed:[...dismissed]};
 }
 function notify(message,error=false){if(dead)return;const n=el('[data-er-status]');n.textContent=message;n.setAttribute('role',error?'alert':'status');}
 function persistence(){if(dead)return;const n=el('[data-er-persistence]');n.hidden=!persistenceText;n.textContent=persistenceText;}
 function save(){
  dirty=true;version++;
  try{const saved=onChange(snapshot());if(saved===false)throw Error('The parent working copy could not be saved in this browser.');dirty=false;persistenceText='';}
  catch(e){persistenceText=e.message+' The exact reading position and unfinished controls remain here. Download the complete reading file before leaving.';}
  persistence();
 }
 function emit(name,blob){const url=URL.createObjectURL(blob);urls.add(url);const a=document.createElement('a');a.href=url;a.download=name;a.click();}
 function saveFile(suffix='reading'){emit('measurement-'+edition.id.slice(0,12)+'-'+suffix+'.json',new Blob([JSON.stringify(work(),null,2)+'\n'],{type:'application/json'}));notify('The complete reading file is ready to save, including the selected edition, original position and unfinished filters.');}
 if(initialPosition){
  if(initialPosition.format===SESSION){if(initialPosition.workspaceKey!==workspaceKey)throw Error('The retained reader belongs to another workspace or account.');({position,draft,pending,guidanceDismissed}=validateWork(initialPosition.work));}
  else ({position,draft,pending,guidanceDismissed}=validateWork(initialPosition));
 }
 host.classList.add('collection-edition-reader');
 host.innerHTML='<style>'+css+'</style><h3>Saved measured-input edition</h3><p>Prepared by TokenJunkieLabs</p><button type="button" data-er-action="show-help">Show reading guidance</button><p>Read the complete original population from this saved revision. Display filters select original rows; they do not alter eligibility, source measurements or native model inputs.</p><div data-er-context></div>'+
 '<details><summary>Complete native edition, source binding and scientific filters</summary><pre data-er-native></pre></details>'+
 '<aside class="er-help" data-er-help="population"><strong>1. Choose the measurements to inspect</strong><p>Select eligible or excluded inputs, then Read selected population. Leave the filter boxes blank to see every record. Each filter uses the original station, constituent or reason exactly.</p><div class="er-actions"><button type="button" data-er-point="population">Show population selector</button><button type="button" data-er-dismiss="population">Got it</button></div></aside>'+
 '<div class="er-controls"><label>Population<select data-er-field="population"><option value="accepted">Eligible measured inputs</option><option value="excluded">Excluded measured inputs</option></select></label><label>Exact station ID<input data-er-field="stationId" maxlength="4096"></label><label>Exact constituent code<input data-er-field="parameter" maxlength="4096"></label><label>Exact exclusion reason<input data-er-field="reason" maxlength="4096"></label><label>Records per page<input data-er-field="limit" inputmode="numeric" maxlength="3"></label></div>'+
 '<p>Blank filters include every original value. Nonblank filters match exact, case-sensitive native IDs or reason strings. Excluded inputs retain all original reasons. Missing and null values are shown separately.</p>'+
 '<div class="er-actions"><button type="button" data-er-action="apply">Read selected population</button><button type="button" data-er-action="reopen">Reopen saved page</button><button type="button" data-er-action="previous">Previous page</button><button type="button" data-er-action="next">Continue reading</button><button type="button" data-er-action="resume">Resume retained reading</button><button type="button" data-er-action="pause">Pause reading</button></div>'+
 '<div data-er-status role="status" aria-live="polite"></div><div data-er-persistence role="alert" hidden></div><progress data-er-progress hidden></progress><p data-er-page></p><aside class="er-help" data-er-help="records"><strong>2. Inspect the complete original record</strong><p>The table keeps dates, units, censoring and missing values intact. Expand Complete original fields and source references within a row to inspect every saved field.</p><div class="er-actions"><button type="button" data-er-point="records">Show record table</button><button type="button" data-er-dismiss="records">Got it</button></div></aside><div class="er-scroll" data-er-rows></div>'+
 '<details><summary>Save or reopen this reading position</summary><p>The reading file includes the full immutable edition metadata, applied position and unfinished controls. Original population bytes remain in the native edition or received folder. Reopen those same originals to continue.</p><div class="er-actions"><button type="button" data-er-action="save">Download complete reading file</button><button type="button" data-er-action="restart-history">Retain file and start history here</button><label>Open reading file<input type="file" data-er-open accept=".json,application/json"></label></div></details>'+
 '<aside class="er-help" data-er-help="originals"><strong>3. Keep the original files and your place</strong><p>File downloads contain the whole original, including rows outside the display filters. Save a reading file to keep your current page and unfinished controls. The complete editable study remains in project.zip.</p><div class="er-actions"><button type="button" data-er-point="originals">Show original files</button><button type="button" data-er-dismiss="originals">Got it</button></div></aside><h4>Complete original files</h4><p>These downloads contain the entire original member. The display filters above do not change their content.</p><div class="er-scroll" data-er-files></div>';
 function el(s){return host.querySelector(s);}
 function controls(){
  if(dead)return;host.setAttribute('aria-busy',String(busy));
  for(const n of host.querySelectorAll('[data-er-field]'))n.disabled=busy;
  el('[data-er-action="apply"]').disabled=busy;
  el('[data-er-action="reopen"]').disabled=busy;
  el('[data-er-action="restart-history"]').disabled=busy||!!pending||!position.history.length;
  el('[data-er-action="previous"]').disabled=busy||!position.history.length;
  el('[data-er-action="next"]').disabled=busy||!result||result.end;
  el('[data-er-action="resume"]').disabled=busy||!pending;
  el('[data-er-action="pause"]').disabled=!busy;
  el('[data-er-open]').disabled=busy;
  for(const n of host.querySelectorAll('[data-er-download]'))n.disabled=busy;
 }
 function renderGuidance(){for(const n of host.querySelectorAll('[data-er-help]'))n.hidden=guidanceDismissed.includes(n.dataset.erHelp);}
 function renderDraft(){for(const n of host.querySelectorAll('[data-er-field]'))n.value=draft[n.dataset.erField];renderGuidance();}
 function renderContext(){
  el('[data-er-context]').innerHTML='<dl><dt>Collection</dt><dd><code>'+esc(edition.collectionBinding.collectionId)+'</code></dd><dt>Edition</dt><dd><code>'+esc(edition.id)+'</code></dd><dt>Saved workspace revision</dt><dd>'+edition.workspaceRevision+'</dd><dt>Complete native population</dt><dd>'+edition.recordCount+' records: '+edition.counts.accepted+' eligible; '+edition.counts.excluded+' excluded</dd><dt>Source</dt><dd>'+esc(reader.folderName?'Received folder '+reader.folderName:'Original installed saved edition')+'</dd></dl>';
  el('[data-er-native]').textContent=JSON.stringify(edition,null,2);
  el('[data-er-files]').innerHTML='<table><thead><tr><th>Original member</th><th>Bytes</th><th>Complete original</th></tr></thead><tbody>'+edition.files.map(f=>'<tr><td><code>'+esc(f.path)+'</code></td><td>'+f.bytes+'</td><td><button type="button" data-er-download="'+esc(f.path)+'">Download complete file</button></td></tr>').join('')+'</tbody></table>';
 }
 function renderRows(){
  if(!result){el('[data-er-page]').textContent=pending?'The original reading request is retained. Resume it to inspect its complete rows.':'Choose a population to inspect its complete saved rows.';el('[data-er-rows]').replaceChildren();controls();return;}
  const filters=Object.entries(result.filters).filter(([,v])=>v).map(([k,v])=>k+' = '+JSON.stringify(v)).join('; ');
  el('[data-er-page]').textContent=result.rows.length+' complete records shown; '+result.scanned+' original records inspected on this page. Original '+result.member.path+' bytes '+result.offset+'–'+result.nextOffset+' of '+result.member.bytes+'. '+(result.end?'Reached the end of this original population.':'Continue reading scans the following original records.')+(filters?' Applied display filters: '+filters+'.':' No display filters applied.');
  el('[data-er-rows]').innerHTML=result.rows.length?'<table><thead><tr><th>Original record / source</th><th>Station / reach</th><th>Original date / time</th><th>Constituent / basis / fraction</th><th>Value / bounds / unit</th><th>Eligibility and complete source record</th></tr></thead><tbody>'+result.rows.map(({data:r,byteOffset})=>'<tr><td><code>'+esc(r.id)+'</code><br><span>Original result: '+esc(shown(r.sourceResultId))+'</span><br><small>Byte '+byteOffset+'</small></td><td>'+esc(shown(r.stationId))+'<br>'+esc(shown(r.reachId))+'</td><td>'+esc(shown(r.sampledDate))+'<br>'+esc(shown(r.sampledAt))+'<br>'+esc(shown(r.timePrecision))+'</td><td>'+esc(shown(r.parameter))+'<br>'+esc(shown(r.basis))+'<br>'+esc(shown(r.fraction))+'</td><td>'+esc(shown(r.value))+' '+esc(shown(r.unit))+'<br>Lower: '+esc(shown(r.lower))+'<br>Upper: '+esc(shown(r.upper))+'<br>Censor: '+esc(shown(r.censor))+'</td><td>'+(result.population==='accepted'?'Eligible measured input':esc(Array.isArray(r.reasons)?r.reasons.join('; '):shown(r.reasons)))+'<details><summary>Complete original fields and source references</summary><pre>'+esc(JSON.stringify(r,null,2))+'</pre></details></td></tr>').join('')+'</tbody></table>':'<p>No original record matched in this scanned range. '+(result.end?'This population is complete.':'Continue reading checks the remaining original bytes.')+'</p>';
  controls();
 }
 function guard(token){check();if(dead||sequence!==token)throw Error('Reading paused. The exact selected position remains available.');}
 async function read(target){
  if(busy||dead)return;target=reader.validatePosition(target);pending=clone(target);save();
  busy=true;abort=new AbortController();const token=++sequence;controls();notify('Reading checked original population bytes…');
  try{
   const page=await reader.page(target,{signal:abort.signal,progress:p=>{guard(token);const n=el('[data-er-progress]');n.hidden=false;n.max=p.total||1;n.value=p.bytes;}});guard(token);
   result=page;position=target;pending=null;save();renderRows();notify('Complete original rows are displayed from the selected saved edition.');
  }catch(e){if(!dead)notify(e.message,true);}
  finally{busy=false;abort=null;if(!dead){controls();persistence();}}
 }
 async function runDownload(name){
  if(busy||dead)return;busy=true;const token=++sequence;abort=new AbortController();controls();
  try{
   if(downloadOriginal)await downloadOriginal(name,()=>guard(token));
   else if(reader.originalFile){const file=await reader.originalFile(name);guard(token);emit(name,file);}
   else throw Error('Use the original saved-edition file download for this complete member.');
   guard(token);notify('The complete original '+name+' is ready to save. Its original bytes are unchanged.');
  }catch(e){if(!dead)notify(e.message,true);}
  finally{busy=false;abort=null;if(!dead)controls();}
 }
 host.addEventListener('input',event=>{
  const field=event.target.dataset.erField;if(!field||busy)return;draft[field]=event.target.value;save();
 },{signal:lifetime.signal});
 host.addEventListener('change',event=>{
  const field=event.target.dataset.erField;if(field&&!busy){draft[field]=event.target.value;save();return;}
  if(!event.target.matches('[data-er-open]'))return;
  const input=event.target,file=input.files[0];if(!file)return;const token=++openSequence,startingVersion=version;
  (async()=>{
   try{
    if(busy)throw Error('Pause the current read before opening another position.');
    const text=await file.text();if(dead||token!==openSequence)return;if(version!==startingVersion||busy)throw Error('Your current reading controls changed while the file was read. Choose it again to replace this work.');
    const next=validateWork(JSON.parse(text));saveFile('before-open');({position,draft,pending,guidanceDismissed}=next);result=null;sequence++;save();renderDraft();renderRows();notify('Opened the complete saved reading position. Read or resume to inspect its original bytes.');
   }catch(e){if(!dead&&token===openSequence)notify(e.message,true);}
   finally{if(token===openSequence)input.value='';}
  })();
 },{signal:lifetime.signal});
 host.addEventListener('click',event=>{
  const node=event.target.closest('button');if(!node||!host.contains(node))return;const action=node.dataset.erAction;
  if(action==='show-help'){guidanceDismissed=[];save();renderGuidance();return;}
  if(node.dataset.erDismiss){if(!guidanceDismissed.includes(node.dataset.erDismiss))guidanceDismissed.push(node.dataset.erDismiss);save();renderGuidance();return;}
  if(node.dataset.erPoint){const selectors={population:'[data-er-field="population"]',records:'[data-er-rows]',originals:'[data-er-files]'},target=el(selectors[node.dataset.erPoint]);target.scrollIntoView({block:'center',behavior:'auto'});if(!target.matches('input,select,button'))target.setAttribute('tabindex','-1');target.focus({preventScroll:true});return;}
  if(action==='save'){try{saveFile();}catch(e){notify(e.message,true);}return;}
  if(action==='pause'){sequence++;abort?.abort();notify('Reading paused. Resume the retained original position to continue.');return;}
  if(busy)return;
  if(node.dataset.erDownload){runDownload(node.dataset.erDownload);return;}
  try{
   if(action==='apply'){if(!/^\d+$/.test(draft.limit))throw Error('Choose 1 to 200 complete records per page.');read(reader.position({population:draft.population,filters:collectionReadingFilters({stationId:draft.stationId,parameter:draft.parameter,reason:draft.reason}),limit:Number(draft.limit),offset:0,history:[]}));}
   else if(action==='reopen')read(position);
   else if(action==='restart-history'&&!pending){saveFile('previous-history');position=reader.position({...position,history:[]});save();controls();notify('The previous reading history is ready to save. This original position starts the new history.');}
   else if(action==='resume'&&pending)read(pending);
   else if(action==='next'&&result&&!result.end){if(position.history.length>=10000)throw Error('Use Retain file and start history here to preserve the full preceding reading history and continue at this original position.');read({...position,offset:result.nextOffset,history:[...position.history,position.offset]});}
   else if(action==='previous'&&position.history.length)read({...position,offset:position.history.at(-1),history:position.history.slice(0,-1)});
  }catch(e){notify(e.message,true);}
 },{signal:lifetime.signal});
 window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}},{signal:lifetime.signal});
 renderContext();renderDraft();renderRows();persistence();
 return {snapshot,hasUnsaved(){return dirty||busy;},destroy(){dead=true;sequence++;openSequence++;abort?.abort();lifetime.abort();reader.close();for(const url of urls)URL.revokeObjectURL(url);urls.clear();host.replaceChildren();}};
}

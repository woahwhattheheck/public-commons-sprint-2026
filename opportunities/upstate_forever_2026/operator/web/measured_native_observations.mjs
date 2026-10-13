/** Explicit current Measurements import to native context observations. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=v=>JSON.parse(JSON.stringify(v));
const num=v=>Number(v??0).toLocaleString();
function download(name,value){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000);}
export function mountNativeObservations(host,{request,openMonitoring}={}){
 if(!(host instanceof Element)||typeof request!=='function')throw TypeError('Use the original native Measurements host');
 const controller=new AbortController(),signal=controller.signal;
 let dead=false,busy=false,catalogue={imports:[],handoffs:[]},selection={import_id:'',title:'',value_policy:'retained-canonical-context'},preview=null,saved=null;
 host.innerHTML='<details class="mw-panel"><summary><strong>Use a retained Measurements source in Monitoring change</strong></summary><p>Review one original import and retain its exact canonical property measurements as native context in this project. The original text, mapping, rejected rows and review history remain attached. This does not run a model or calculate an annual load.</p><p role="status" aria-live="polite">Opening original sources…</p><div data-native-body></div></details>';
 const status=host.querySelector('[role=status]'),body=host.querySelector('[data-native-body]');
 function message(value,error=false){if(!dead){status.textContent=value;status.dataset.error=String(error);}}
 function controls(){host.setAttribute('aria-busy',String(busy));for(const e of host.querySelectorAll('button,input,select'))e.disabled=busy||e.dataset.unavailable==='true';}
 async function task(fn){if(dead||busy)return;busy=true;controls();try{await fn();}catch(e){if(!dead&&e.name!=='AbortError')message(e.message,true);}finally{busy=false;if(!dead)controls();}}
 function capture(){const id=host.querySelector('[name=source]'),title=host.querySelector('[name=title]');if(id)selection.import_id=id.value;if(title)selection.title=title.value.trim();}
 function changed(){capture();preview=null;saved=null;renderPreview();renderSaved();message('Source or title changed. Inspect this exact selection before retaining it.');}
 async function refresh(){const r=await request('catalog');if(dead)return;catalogue=r;}
 function render(){
  if(dead)return;
  body.innerHTML='<div class="mw-grid"><label>Complete original Measurements import<select name="source"><option value="">Choose a retained source</option>'+catalogue.imports.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===selection.import_id?' selected':'')+'>'+esc(r.label)+' · '+num(r.summary.rows)+' rows</option>').join('')+'</select></label><label>Native context title<input name="title" maxlength="300" value="'+esc(selection.title)+'"></label></div><p class="mw-notice">The projection uses the current import’s retained canonical values and units. Original reported values and units remain alongside them. Unknown or incompatible bounds, excluded reviews and unresolved source revisions stay context only. Nonnegative support is not assumed.</p><div class="mw-buttons"><button type="button" data-native-act="preview">Inspect original handoff</button><button type="button" data-native-act="refresh">Refresh sources and saved handoffs</button></div>'+(!catalogue.imports.length?'<p>No property imports are retained in Measurements. Receive an original source through the existing intake first.</p>':'')+'<div data-native-preview></div><h3>Saved context handoffs</h3>'+(!catalogue.handoffs.length?'<p>No source has been handed off from this Measurements store.</p>':'<div class="mw-scroll"><table><thead><tr><th>Title</th><th>Original rows / rejected</th><th>Open</th></tr></thead><tbody>'+catalogue.handoffs.map(r=>'<tr><td>'+esc(r.title)+'</td><td>'+num(r.summary.source_rows)+' / '+num(r.summary.rejected_original_rows)+'</td><td><button type="button" data-native-act="open" data-id="'+esc(r.id)+'">Open retained handoff</button></td></tr>').join('')+'</tbody></table></div>')+'<div data-native-saved></div>';
  renderPreview();renderSaved();controls();
 }
 function renderPreview(){
  const box=host.querySelector('[data-native-preview]');if(!box)return;
  if(!preview){box.innerHTML='';return;}
  const s=preview.summary;
  box.innerHTML='<h3>Reviewed original source</h3><p><strong>'+esc(preview.source.label)+'</strong> · '+num(s.source_rows)+' retained rows · '+num(s.rejected_original_rows)+' original rejected rows retained separately · '+num(s.context_only_rows)+' context-only dispositions · '+num(s.left_censored_rows)+' left-censored / '+num(s.right_censored_rows)+' right-censored rows.</p><p>Native annual-load admission: <strong>0</strong>. Below-limit bounds are not replaced by zero or half a limit. Above-limit bounds are not point estimates.</p><div class="mw-scroll"><table><thead><tr><th>Original row / station</th><th>Property / fraction</th><th>Original value / unit</th><th>Canonical point or bound / unit</th><th>Method / source disposition</th></tr></thead><tbody>'+preview.preview.map(r=>'<tr><td>'+esc(r.original_source_line)+' · '+esc(r.station_id)+'</td><td>'+esc(r.parameter)+' / '+esc(r.fraction)+'</td><td>'+esc(r.original_value)+' '+esc(r.original_unit)+'</td><td>'+esc(r.qualifier)+' '+esc(r.value)+' '+esc(r.unit)+'</td><td>'+esc(r.method_authority)+' / '+esc(r.method)+'<br>'+esc(r.source_disposition||'Retained canonical observation')+'</td></tr>').join('')+'</tbody></table></div><p>Showing the first '+num(preview.preview.length)+' original occurrences. The saved handoff retains every original and rejected row.</p><details><summary>Exact mapping, source identity and scientific field counts</summary><pre>'+esc(JSON.stringify({source:preview.source,revision:preview.revision,summary:preview.summary,projection:preview.projection,producer:preview.producer},null,2))+'</pre></details><label class="mw-check"><input type="checkbox" name="confirmed"> I reviewed this original source, canonical unit/value projection and context-only support.</label><div class="mw-buttons"><button type="button" data-native-act="prepare">Retain exact native context</button><button type="button" data-native-act="preview-json">Download complete preview</button></div>';controls();
 }
 function renderSaved(){
  const box=host.querySelector('[data-native-saved]');if(!box)return;if(!saved){box.innerHTML='';return;}
  box.innerHTML='<h3>'+esc(saved.title)+'</h3><p>'+num(saved.observation.rows)+' original occurrences retained in native observations; '+num(saved.observation.admitted_count)+' admitted annual loads.</p><p>Open Monitoring change and select this title under <strong>Analyze your imported measurements</strong>. Its exact native observation ID is retained below. The original temporal calculation remains a separate explicit operation.</p><div class="mw-buttons">'+(typeof openMonitoring==='function'?'<button type="button" data-native-act="monitoring">Open Monitoring change</button>':'')+'<button type="button" data-native-act="export">Complete original source and native observation JSON</button><button type="button" data-native-act="selection">Download original temporal interpretation</button></div><details><summary>Retained native identities and interpretation</summary><pre>'+esc(JSON.stringify(saved,null,2))+'</pre></details>';controls();
 }
 host.addEventListener('change',e=>{if(e.target.name==='source'){capture();const item=catalogue.imports.find(r=>r.id===selection.import_id);selection.title=item?.label||'';const title=host.querySelector('[name=title]');if(title)title.value=selection.title;changed();}},{signal});
 host.addEventListener('input',e=>{if(e.target.name==='title')changed();},{signal});
 host.addEventListener('click',e=>{
  const b=e.target.closest('[data-native-act]');if(!b||!host.contains(b))return;e.preventDefault();e.stopPropagation();
  // Read the confirmation while the actual control is still enabled.
  const confirmed=host.querySelector('[name=confirmed]')?.checked===true;
  task(async()=>{
   const act=b.dataset.nativeAct;
   if(act==='refresh'){capture();await refresh();render();message('Original source catalogue and saved handoffs refreshed.');}
   if(act==='preview'){capture();const p=await request('preview',{selection});if(dead)return;preview=p;saved=null;renderPreview();renderSaved();message('Full original import inspected. Review the source and confirm this exact projection.');}
   if(act==='prepare'){
    if(!preview||!confirmed)throw Error('Inspect the original and confirm its complete context projection first.');
    const r=await request('prepare',{selection:{...preview.selection,expected_revision:preview.revision,expected_id:preview.id,confirmed:true}});if(dead)return;saved=r;preview=null;await refresh();render();message('Original source retained as native context in this project. No model or temporal calculation was started.');
   }
   if(act==='open'){const r=await request('get',{id:b.dataset.id});if(dead)return;saved=r;renderSaved();message('Opened original saved handoff.');}
   if(act==='export'){const r=await request('export',{id:saved.id});if(dead)return;download('measurement-native-context-'+saved.id.slice(0,12)+'.json',r);}
   if(act==='selection')download('monitoring-original-interpretation.json',saved.temporal_selection);
   if(act==='preview-json')download('measurement-native-preview.json',preview);
   if(act==='monitoring')openMonitoring();
  });
 },{signal});
 render();task(async()=>{await refresh();if(dead)return;render();message('Choose an original Measurements import, inspect its mapping, then retain native context explicitly.');});
 return {destroy(){dead=true;controller.abort();host.replaceChildren();}};
}

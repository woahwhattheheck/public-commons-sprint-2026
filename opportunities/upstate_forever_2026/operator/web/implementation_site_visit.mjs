import {clone,esc,validatePlan} from './implementation_core.mjs';
import {evidenceSha256} from './implementation_evidence.mjs';
import {SITE_VISIT_FIELDS,blankSiteVisitMapping,inspectPortableSiteVisitCSV,previewPortableSiteVisits,applyPortableSiteVisits,stableSiteVisitJSON} from './implementation_site_visit_csv.mjs';

const button=(action,label,disabled=false,extra='')=>'<button type="button" data-sv-action="'+action+'"'+(disabled?' disabled':'')+' '+extra+'>'+esc(label)+'</button>';
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';
const field=(label,body)=>'<label><span>'+esc(label)+'</span>'+body+'</label>';
const uid=()=>globalThis.crypto?.randomUUID?.()||'site-visit-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const sha=/^[a-f0-9]{64}$/;
const sourceKinds=['sites','visits'];
const styles='.iw-site-visit{width:min(1320px,96vw);max-width:none;max-height:94vh;border:1px solid #777;padding:0;background:#fff;color:#222;font:14px/1.5 system-ui,sans-serif}.iw-site-visit::backdrop{background:#0007}.iw-site-visit header{padding:18px;position:sticky;top:0;z-index:2;border-bottom:1px solid #ccc;background:#fff;display:flex;justify-content:space-between;gap:15px}.iw-site-visit main{padding:18px}.iw-site-visit h2{font-size:23px;margin:0}.iw-site-visit h3{margin:0 0 10px}.iw-site-visit p{margin:8px 0}.iw-site-visit button,.iw-site-visit input,.iw-site-visit select,.iw-site-visit textarea{font:inherit;border:1px solid #888;border-radius:3px;background:#fff;color:inherit;padding:8px}.iw-site-visit button{cursor:pointer}.iw-site-visit button:disabled{opacity:.5;cursor:default}.iw-site-visit label{display:block}.iw-site-visit label>span{display:block;font-weight:600;margin-bottom:4px}.iw-site-visit input:not([type=checkbox]),.iw-site-visit select,.iw-site-visit textarea{box-sizing:border-box;width:100%}.iw-site-visit textarea{min-height:90px;font-family:ui-monospace,monospace}.iw-site-visit .sv-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}.iw-site-visit .sv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.iw-site-visit .sv-three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.iw-site-visit .sv-box{border:1px solid #ccc;padding:14px;margin:14px 0}.iw-site-visit .sv-note{padding:12px;background:#f2f2f2;border-left:3px solid #777}.iw-site-visit .sv-error{padding:12px;background:#f6f6f6;border:1px solid #777;white-space:pre-wrap}.iw-site-visit .sv-meta{font-size:12px;color:#444;overflow-wrap:anywhere}.iw-site-visit .sv-table{overflow:auto}.iw-site-visit table{width:100%;border-collapse:collapse}.iw-site-visit th,.iw-site-visit td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:8px;overflow-wrap:anywhere}.iw-site-visit th{background:#f2f2f2}.iw-site-visit details{margin:10px 0}.iw-site-visit pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;padding:10px;background:#f7f7f7}.iw-site-visit .sv-primary{background:#303030;color:#fff}.iw-site-visit a{color:#202020}@media(max-width:760px){.iw-site-visit .sv-grid,.iw-site-visit .sv-three{grid-template-columns:1fr}.iw-site-visit header{display:block}.iw-site-visit main{padding:12px}}';
function download(name,value){const body=JSON.stringify(value,null,2)+'\n',url=URL.createObjectURL(new Blob([body],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function publicPreview(value){if(!value)return null;const r={...value};for(const key of Object.keys(r))if(key.startsWith('_'))delete r[key];return clone(r);}
function mappingDraft(kind,value){if(!value||typeof value!=='object'||Array.isArray(value)||value.schema!=='upstate.implementation-site-visit-mapping/v1')throw Error('Choose an original site/visit mapping.');const draft={...blankSiteVisitMapping(kind),...clone(value)};for(const key of ['columns','constants','fallback_columns','crs_values','time_zone_values','status_values','row_actions'])if(!draft[key]||typeof draft[key]!=='object'||Array.isArray(draft[key]))throw Error('Mapping '+key+' must be a keyed object.');return draft;}
function pendingValid(p,id){return p&&p.action==='implementation.site-visit.import'&&typeof p.operation_id==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(p.operation_id)&&p.payload?.id===id&&Number.isSafeInteger(p.payload.revision)&&sha.test(p.payload.document_digest||'')&&sha.test(p.payload.expected_operation_id||'')&&Array.isArray(p.payload.inputs)&&p.payload.inputs.length>0&&p.payload.inputs.every(x=>sourceKinds.includes(x.kind)&&typeof x.upload_id==='string'&&x.mapping?.schema==='upstate.implementation-site-visit-mapping/v1');}

export class SiteVisitIntake {
 constructor(w){
  this.w=w;this.host=w.host;this.workspace=w.workspace;this.planId=w.plan.id;this.generation=w.generation;this.snapshot=clone(w.native?w.nativePlan:w.plan);this.planStamp=stableSiteVisitJSON(w.plan);this.native=!!w.native;
  this.savedPlan=this.native?clone(w.nativePlan):null;this.digest=null;this.closed=false;this.busy=false;this.turn=0;this.controllers=new Set();this.timer=null;this.files={};this.pending=null;this.receipt=null;this.preview=null;this.analysis=null;this.actor='';this.error='';this.notice='';this.storageIssue='';this.activeKind='sites';this.query='';this.filter='all';this.page=0;this.selectedRecord=null;
  this.storageKey='upstate.site-visit-intake/v1/'+(this.native?this.workspace:'portable')+'/'+this.planId;
  try{
   const saved=JSON.parse(localStorage.getItem(this.storageKey)||'null');
   if(saved?.plan_id===this.planId&&saved.native===this.native&&(!this.native||saved.workspace_key===this.workspace)){
    this.files=saved.files||{};this.actor=saved.actor||'';this.receipt=saved.receipt||null;
    if(saved.pending){if(!pendingValid(saved.pending,this.planId))throw Error('The retained batch request has changed. Recover its original native task before starting another import.');this.pending=saved.pending;}
   }
  }catch(e){this.storageIssue=e.message||String(e);this.restoreBlocked=true;}
  this.node=document.createElement('dialog');this.node.className='iw-site-visit';this.node.setAttribute('aria-label','Import sites and visits from original CSVs');
  this.node.addEventListener('click',e=>{const b=e.target.closest('[data-sv-action]');if(!b||!this.node.contains(b))return;e.preventDefault();e.stopPropagation();this.action(b).catch(x=>this.fail(x));});
  this.node.addEventListener('change',e=>this.change(e.target).catch(x=>this.fail(x)));
  this.node.addEventListener('input',e=>{if(e.target.dataset.sv==='query'){this.query=e.target.value;this.page=0;this.renderRows();}});
  this.node.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  w.root.append(this.node);this.render();this.node.showModal();
 }
 alive(){return !this.closed&&!this.w.gone&&this.w.generation===this.generation&&this.w.plan?.id===this.planId&&stableSiteVisitJSON(this.w.plan)===this.planStamp&&(!this.native||this.host.getState?.()?.workspace_key===this.workspace)&&this.node.isConnected;}
 requireCurrent(){if(!this.alive())throw new DOMException('The original plan changed while its CSV batch was open.','AbortError');}
 locked(){return this.busy||!!this.pending||this.restoreBlocked;}
 persist(){if(this.closed||this.restoreBlocked)return;try{localStorage.setItem(this.storageKey,JSON.stringify({schema:'upstate.site-visit-intake/v1',workspace_key:this.workspace,plan_id:this.planId,native:this.native,files:this.files,actor:this.actor,pending:this.pending,receipt:this.receipt}));this.storageIssue='';}catch{this.storageIssue='Browser draft storage is unavailable. Download the mapping and original request before closing.';}}
 fail(error){if(!this.closed){this.error=error?.message||String(error);this.busy=false;this.render();}}
 close(){if(this.closed)return;this.persist();this.closed=true;this.turn++;clearTimeout(this.timer);for(const c of this.controllers)c.abort();this.controllers.clear();this.node.close();this.node.remove();if(this.w.siteVisitEditor===this)this.w.siteVisitEditor=null;}
 async request(path,values={},body){
  this.requireCurrent();const controller=new AbortController();this.controllers.add(controller);
  try{const result=await this.host.api(this.host.endpoint(path,values),{...(body===undefined?{}:{method:'POST',body}),signal:controller.signal});this.requireCurrent();return result;}finally{this.controllers.delete(controller);}
 }
 async start(){
  if(this.restoreBlocked)return;
  if(this.native){
   const r=await this.request('/api/implementation/detail',{id:this.planId,revision:this.savedPlan.revision});
   if(r.workspace_key!==this.workspace||stableSiteVisitJSON(r.plan)!==stableSiteVisitJSON(this.savedPlan)||!sha.test(r.document_digest||''))throw Error('The original saved plan binding changed. Reopen the saved revision.');
   this.digest=r.document_digest;
   if(this.pending?.id)await this.poll();else if(this.receipt?.task_id)await this.refreshReceipt();
  }
  this.render();
 }
 invalidate(){this.preview=null;this.analysis=null;this.selectedRecord=null;this.page=0;this.error='';this.persist();}
 async chooseFile(kind,file){
  if(!file)return;if(this.locked())throw Error('Finish or recover the original batch before changing its files.');
  if(file.size>64*1024*1024)throw Error('Choose an original CSV within 64 MiB.');
  this.busy=true;this.error='';this.preview=null;this.analysis=null;this.render();const previous=this.files[kind],mapping=previous?.mapping||blankSiteVisitMapping(kind);
  try{
   let entry;
   if(this.native){
    const controller=new AbortController();this.controllers.add(controller);let ticket;
    try{ticket=await this.host.api('/api/upload',{method:'POST',raw:file,filename:file.name,signal:controller.signal});this.requireCurrent();}finally{this.controllers.delete(controller);}
    if(!ticket?.id||!sha.test(ticket.sha256||'')||ticket.bytes!==file.size)throw Error('The original upload receipt is incomplete.');
    entry={kind,upload_id:ticket.id,filename:ticket.filename||file.name,sha256:ticket.sha256,bytes:ticket.bytes,mapping};
   }else{
    const bytes=new Uint8Array(await file.arrayBuffer());this.requireCurrent();const hash=await evidenceSha256(bytes),vault=await this.w.evidence.vault();this.requireCurrent();await vault.putMany([{sha256:hash,size_bytes:bytes.length,bytes}]);this.requireCurrent();
    entry={kind,filename:file.name,sha256:hash,bytes:bytes.length,mapping};
   }
   this.files[kind]=entry;this.activeKind=kind;this.persist();await this.inspect(kind);this.notice='Original '+kind+' CSV retained. Select its actual columns and source conventions.';
  }finally{if(!this.closed){this.busy=false;this.render();}}
 }
 async bytes(kind){
  const input=this.files[kind];if(!input)throw Error('Choose the original '+kind+' CSV.');
  const vault=await this.w.evidence.vault(),stored=await vault.get(input.sha256);this.requireCurrent();const bytes=stored?.bytes??stored;
  if(!(bytes instanceof Uint8Array)||bytes.length!==input.bytes||await evidenceSha256(bytes)!==input.sha256)throw Error('Reselect the original '+kind+' CSV; its exact bytes are unavailable in this browser.');
  return bytes;
 }
 async inspect(kind){
  const input=this.files[kind];if(!input)return;
  const result=this.native?await this.request('/api/implementation/site-visit-inspect',{}, {kind,upload_id:input.upload_id,delimiter:input.mapping.delimiter,encoding:input.mapping.encoding}):await inspectPortableSiteVisitCSV(await this.bytes(kind),{filename:input.filename,delimiter:input.mapping.delimiter,encoding:input.mapping.encoding});
  this.requireCurrent();
  if(result.source?.sha256!==input.sha256||result.source?.bytes!==input.bytes)throw Error('The inspected CSV differs from its original retained bytes.');
  input.inspection=result;this.persist();
 }
 async portableInputs(){const inputs=[];for(const kind of sourceKinds)if(this.files[kind])inputs.push({kind,bytes:await this.bytes(kind),filename:this.files[kind].filename,mapping:clone(this.files[kind].mapping)});return inputs;}
 nativePayload(){if(!this.digest)throw Error('Read the exact saved native revision first.');return {id:this.planId,revision:this.savedPlan.revision,document_digest:this.digest,inputs:sourceKinds.filter(k=>this.files[k]).map(kind=>({kind,upload_id:this.files[kind].upload_id,mapping:clone(this.files[kind].mapping)}))};}
 async prepare(){
  if(this.locked())throw Error('Finish or recover the original batch request first.');
  if(!Object.keys(this.files).length)throw Error('Choose an original sites CSV, visits CSV or both.');
  this.busy=true;this.preview=null;this.error='';this.render();
  try{
   const result=this.native?await this.request('/api/implementation/site-visit-preview',{},this.nativePayload()):await previewPortableSiteVisits(this.snapshot,await this.portableInputs());this.requireCurrent();
   if(result.plan?.id!==this.planId||this.native&&(result.workspace_key!==this.workspace||result.document_digest!==this.digest||result.plan.revision!==this.savedPlan.revision))throw Error('The reviewed CSV batch belongs to a different original plan.');
   this.preview=result;this.analysis=result;this.page=0;this.selectedRecord=null;this.notice='The complete batch is reviewed. Resolve all errors before applying.';this.persist();
  }finally{if(!this.closed){this.busy=false;this.render();}}
 }

 mappingHtml(kind){
  const input=this.files[kind];if(!input)return '<p>Select the original '+kind+' CSV to map its actual columns.</p>';
  const m=input.mapping,headers=input.inspection?.headers||[],locked=this.locked();
  const select=(name,rows,value)=>'<select data-sv-setting="'+name+'" data-kind="'+kind+'"'+(locked?' disabled':'')+'>'+rows.map(x=>option(x[0],x[1],value)).join('')+'</select>';
  let html='<p><strong>'+esc(input.filename)+'</strong> · '+input.bytes.toLocaleString()+' original bytes</p><p class="sv-meta">SHA-256 '+esc(input.sha256)+'</p><div class="sv-three">'+
   field('Delimiter',select('delimiter',[[',','Comma'],[';','Semicolon'],['\t','Tab'],['|','Pipe']],m.delimiter))+
   field('Encoding',select('encoding',[['utf-8-sig','UTF-8 (optional BOM)'],['utf-8','UTF-8'],['utf-16','UTF-16 with BOM'],['cp1252','Windows-1252'],['latin-1','Latin-1']],m.encoding))+
   field('Record IDs',select('id_mode',[['native','Original native IDs'],['stable','Stable IDs from original identifiers'],['source_record','IDs from this exact source row']],m.id_mode))+
   field('Declared source namespace','<input data-sv-setting="namespace" data-kind="'+kind+'" value="'+esc(m.namespace)+'"'+(locked?' disabled':'')+'>')+
   (kind==='sites'?field('Coordinate admission',select('coordinate_mode',[['retain_only','Retain original cells only'],['geographic','Declared geographic coordinates']],m.coordinate_mode))+field('Decimal separator',select('decimal_separator',[['.','Decimal point'],[',','Decimal comma']],m.decimal_separator)):
   field('Site identifiers',select('site_binding',[['native_id','Exact native site IDs'],['source_id','Exact original source site IDs']],m.site_binding))+field('Source date convention',select('date_format',[['iso','ISO: YYYY-MM-DD'],['mdy','Month/day/year'],['dmy','Day/month/year']],m.date_format)))+'</div>'+
   '<p class="sv-meta">'+(kind==='sites'?'Geographic coordinates retain the explicit source datum. No datum transformation or projection is performed. Retain-only preserves source cells and leaves native coordinates unchanged.':'Planned dates are calendar dates. An actual visit time needs its source date, clock and explicit offset. No midnight, timezone or daylight-saving rule is inferred.')+'</p>'+
   '<div class="sv-actions">'+button('inspect','Read original headers',locked,'data-kind="'+kind+'"')+button('map-native','Map matching native field names',locked,'data-kind="'+kind+'"')+button('remove-file','Remove this input',locked,'data-kind="'+kind+'"')+'</div>'+
   (input.inspection?'<p>'+input.inspection.row_count+' original data records · '+headers.length+' columns</p>':'<p>Read the original headers after choosing its delimiter and encoding.</p>')+
   '<div class="sv-table"><table><thead><tr><th>Plan field</th><th>Original source column</th><th>Explicit constant (instead of column)</th></tr></thead><tbody>'+SITE_VISIT_FIELDS[kind].map(name=>'<tr><td>'+esc(name)+'</td><td><select data-sv-column="'+name+'" data-kind="'+kind+'"'+(locked?' disabled':'')+'>'+option('','Not mapped',m.columns[name]||'')+headers.map(h=>option(h,h,m.columns[name])).join('')+'</select></td><td><input data-sv-constant="'+name+'" data-kind="'+kind+'" value="'+esc(m.constants[name]??'')+'"'+(locked||name==='id'?' disabled':'')+'></td></tr>').join('')+'</tbody></table></div>'+
   '<details><summary>Explicit aliases, fallback columns and complete mapping JSON</summary><p>Use crs_values, status_values and time_zone_values for documented source labels; fallback_columns names actual headers in order. Row choices require a recorded reason. Mapping JSON also keeps every selected source convention.</p><textarea rows="16" data-sv-mapping="'+kind+'"'+(locked?' disabled':'')+'>'+esc(JSON.stringify(m,null,2))+'</textarea><div class="sv-actions">'+button('mapping-apply','Apply mapping JSON',locked,'data-kind="'+kind+'"')+button('mapping-download','Download mapping',false,'data-kind="'+kind+'"')+button('mapping-open','Open mapping JSON',locked,'data-kind="'+kind+'"')+'</div></details>'+
   '<details><summary>Original source sample</summary><pre>'+esc(JSON.stringify(input.inspection?.sample_rows?.slice(0,5)||[],null,2))+'</pre><p class="sv-meta">Up to five original records shown. The full CSV is retained unchanged.</p></details>';
  return html;
 }
 matched(){
  const q=this.query.toLocaleLowerCase();
  return (this.analysis?.decisions||[]).filter(row=>(this.filter==='all'||row.status===this.filter)&&(!q||JSON.stringify(row).toLocaleLowerCase().includes(q)));
 }
 renderRows(){
  const target=this.node.querySelector('[data-sv-rows]');if(!target)return;const rows=this.matched(),pages=Math.max(1,Math.ceil(rows.length/30));this.page=Math.max(0,Math.min(pages-1,this.page));
  target.innerHTML='<p>'+rows.length+' matching decisions of '+(this.analysis?.decisions?.length||0)+' · page '+(this.page+1)+' of '+pages+'</p><div class="sv-actions">'+button('previous','Previous',this.page===0)+button('next','Next',this.page===pages-1)+'</div><div class="sv-table"><table><thead><tr><th>Original row</th><th>Native record</th><th>Definition</th><th>Decision</th><th>Source issues</th><th></th></tr></thead><tbody>'+rows.slice(this.page*30,(this.page+1)*30).map(row=>'<tr><td>'+esc(row.kind)+' '+esc(row.record)+'<br><span class="sv-meta">lines '+esc(row.line_start)+'–'+esc(row.line_end)+'</span></td><td>'+esc(row.native_id||'Unresolved')+'<br><span class="sv-meta">'+esc(row.original_identifier||'No external ID')+'</span></td><td>'+esc(row.kind==='sites'?(row.row?.label||''):(row.row?.site_id||''))+'<br><span class="sv-meta">'+esc(row.kind==='sites'?[row.row?.latitude,row.row?.longitude,row.row?.coordinate_reference_system].filter(x=>x!==null&&x!==undefined&&x!=='').join(' · '):[row.row?.planned_date,row.row?.visited_at,row.row?.observer].filter(Boolean).join(' · '))+'</span></td><td>'+esc(row.status)+'</td><td>'+esc((row.issues||[]).map(x=>x.message).join(' · '))+'</td><td>'+button('record','Review row',this.locked(),'data-kind="'+esc(row.kind)+'" data-record="'+row.record+'"')+'</td></tr>').join('')+'</tbody></table></div>'+(rows.length?'':'<p>No original records match this view.</p>');
 }
 rowEditor(){
  const selected=this.selectedRecord;if(!selected)return '';const row=(this.analysis?.decisions||[]).find(x=>x.kind===selected.kind&&x.record===selected.record);if(!row)return '';
  const action=this.files[row.kind].mapping.row_actions[String(row.record)]||{},locked=this.locked();
  return '<section class="sv-box"><h3>Resolve '+esc(row.kind)+' source record '+row.record+'</h3><p>The original CSV row stays unchanged. Select a deliberate action and record its reason; preview the whole batch again afterwards.</p><div class="sv-three">'+field('Action','<select data-sv-resolution="action">'+[['import','Import with explicit overrides'],['skip','Skip this original row'],['replace','Replace an existing record']].map(x=>option(x[0],x[1],action.action||'import')).join('')+'</select>')+
   field('Explicit new native ID','<input data-sv-resolution="id" value="'+esc(action.id||'')+'">')+
   field('Existing replacement target','<select data-sv-resolution="target_id">'+option('','Choose an original record',action.target_id||'')+this.snapshot[row.kind].map(x=>option(x.id,x.id+' · '+(x.label||x.planned_date||x.site_id||''),action.target_id)).join('')+'</select>')+
   (row.kind==='visits'?field('Explicit existing or reviewed site ID','<input data-sv-resolution="site_id" value="'+esc(action.site_id||'')+'" list="sv-review-site-ids"><datalist id="sv-review-site-ids">'+[...new Set([...this.snapshot.sites.map(x=>x.id),...(this.analysis.decisions||[]).filter(x=>x.kind==='sites'&&x.row).map(x=>x.native_id)])].map(id=>'<option value="'+esc(id)+'"></option>').join('')+'</datalist>'):'')+
   field('Reason for this decision','<textarea data-sv-resolution="reason">'+esc(action.reason||'')+'</textarea>')+'</div><div class="sv-actions">'+button('resolve','Keep this explicit decision',locked)+button('resolve-clear','Clear this row override',locked)+button('record-download','Download complete original row review')+'</div><details><summary>Full original record and proposed native definition</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details></section>';
 }
 render(){
  if(this.closed)return;const locked=this.locked(),analysis=this.analysis;
  this.node.innerHTML='<style>'+styles+'</style><header><div><h2>Import sites and visits</h2><p>'+esc(this.snapshot.title)+' · '+(this.native?'saved native revision '+this.savedPlan.revision:'portable draft')+'</p></div>'+button('close','Close and retain selection')+'</header><main>'+
   (this.error?'<div class="sv-error" role="alert">'+esc(this.error)+'</div>':'')+(this.storageIssue?'<div class="sv-error">'+esc(this.storageIssue)+'</div>':'')+
   (this.notice?'<div class="sv-note" role="status">'+esc(this.notice)+'</div>':'')+
   '<p>Choose the original sites CSV, visits CSV or both. Map actual source columns and conventions, resolve duplicate IDs and site links, then review the entire batch. Original CSVs and the complete decision audit travel with the plan and its file package.</p>'+
   (this.native&&this.w.dirty?'<p class="sv-note">Your unsaved browser edits remain retained. Native import applies to the saved revision shown above; opening the latest plan later preserves this draft separately.</p>':'')+
   '<div class="sv-actions">'+button('choose-sites','Choose sites CSV',locked)+button('choose-visits','Choose visits CSV',locked)+button('batch-download','Download all mappings')+button('batch-open','Open batch mappings',locked)+'</div>'+
   (this.busy?'<p role="status">Reading and verifying the original batch…</p>':'')+
   '<div class="sv-actions">'+sourceKinds.filter(k=>this.files[k]).map(kind=>button('kind',kind==='sites'?'Sites mapping':'Visits mapping',false,'data-kind="'+kind+'"')).join('')+'</div>'+
   '<section class="sv-box"><h3>'+esc(this.activeKind==='sites'?'Sites and station definitions':'Visits and sampling schedule')+'</h3>'+this.mappingHtml(this.activeKind)+'</section>'+
   '<div class="sv-actions">'+button('preview','Preview complete batch',locked||!Object.keys(this.files).length,'class="sv-primary"')+(analysis?button('preview-download','Download complete batch review'):'')+'</div>'+
   (analysis?'<section class="sv-box"><h3>Whole-batch review</h3><div class="sv-table"><table><thead><tr><th>Table</th><th>Append</th><th>Replace</th><th>Identical</th><th>Skipped</th><th>Errors</th></tr></thead><tbody>'+sourceKinds.map(kind=>'<tr><td>'+kind+'</td>'+['append','replace','identical','skip','error'].map(name=>'<td>'+esc(analysis.summary?.[kind]?.[name]||0)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><p>'+esc(analysis.summary?.record_count)+' original records; '+esc(analysis.summary?.error_count)+' errors; '+esc(analysis.summary?.warning_count)+' warnings.</p><div class="sv-grid">'+field('Find source IDs, records or values','<input type="search" data-sv="query" value="'+esc(this.query)+'">')+field('Decision filter','<select data-sv="filter">'+['all','append','replace','identical','skip','error'].map(x=>option(x,x==='all'?'All original decisions':x,this.filter)).join('')+'</select>')+'</div><div data-sv-rows></div>'+
   this.rowEditor()+'<details'+((analysis.issues||[]).length?' open':'')+'><summary>All source and plan issues ('+(analysis.issues?.length||0)+')</summary><ul>'+(analysis.issues||[]).map(x=>'<li>'+esc([x.severity,x.kind,x.record?'record '+x.record:'',x.message].filter(Boolean).join(' · '))+'</li>').join('')+'</ul></details>'+field('Reviewer (optional)','<input data-sv="actor" maxlength="800" value="'+esc(this.actor)+'"'+(locked?' disabled':'')+'>')+
   '<div class="sv-actions">'+button('apply',this.native?'Save reviewed batch as one native revision':'Apply reviewed batch to portable draft',locked||!this.preview?.can_import,'class="sv-primary"')+'</div><p class="sv-meta">'+(this.native?'The saved plan revision, original bytes and mappings are pinned by the native preview. A changed plan requires a new review.':'The complete draft is validated before its original files and audit are retained and the draft is replaced once. Its native revision number is unchanged.')+'</p></section>':'')+
   this.pendingHtml()+this.receiptHtml()+
   '<input hidden type="file" data-sv="file-sites" accept=".csv,.tsv,text/csv,text/tab-separated-values"><input hidden type="file" data-sv="file-visits" accept=".csv,.tsv,text/csv,text/tab-separated-values"><input hidden type="file" data-sv="mapping-file" accept=".json,application/json"></main>';
  this.renderRows();
 }
 pendingHtml(){
  const p=this.pending;if(!p)return '';
  return '<section class="sv-box"><h3>Original native batch request</h3><p>'+esc(p.operation_id)+' · '+esc(p.state||'response unconfirmed')+'</p><div class="sv-actions">'+
   (p.id?button('poll','Refresh original task',this.busy)+button('task','Open original task'):button('recover','Recover original request',this.busy))+
   (p.state==='interrupted'?button('resume','Resume original task',this.busy):'')+
   (['failed','cancelled'].includes(p.state)?button('retire','Retain failed request and review again',this.busy):'')+button('request-download','Download original request')+'</div></section>';
 }
 receiptHtml(){
  const r=this.receipt;if(!r)return '';
  return '<section class="sv-note"><h3>Retained batch</h3><p>'+esc(r.status)+' · '+(r.status==='portable_draft'?'Portable revision retained without a native save':'applied revision '+esc(r.applied_revision)+' · current native revision '+esc(r.current_revision))+'</p><div class="sv-actions">'+button('receipt-download','Download batch receipt')+(this.native?button('open-current','Open latest saved plan',this.locked()):'')+(r.task_id?button('receipt-refresh','Refresh receipt downloads',this.locked()):'')+'</div>'+(this.native?this.w.nativeDownloads(r._downloads||[]):'<p>Use Handover → Export plan + files ZIP to carry the complete original CSVs and decision audit with this draft.</p>')+'</section>';
 }

 async change(target){
  const name=target.dataset.sv;
  if(name==='file-sites'||name==='file-visits'){await this.chooseFile(name.slice(5),target.files?.[0]);return;}
  if(name==='filter'){this.filter=target.value;this.page=0;this.renderRows();return;}
  if(name==='actor'){this.actor=target.value;this.persist();return;}
  if(name==='mapping-file'){
   const file=target.files?.[0];if(!file)return;if(this.locked())throw Error('Recover the original batch first.');
   if(file.size>4*1024*1024)throw Error('Choose a mapping JSON within 4 MiB.');
   const value=JSON.parse(await file.text());this.requireCurrent();
   if(this.mappingFileKind){
    const kind=this.mappingFileKind;if(!this.files[kind])throw Error('Choose its original CSV first.');
    if(value.schema!=='upstate.implementation-site-visit-mapping/v1')throw Error('Choose an original site/visit mapping.');
    this.files[kind].mapping=mappingDraft(kind,value);this.invalidate();this.busy=true;this.render();
    try{await this.inspect(kind);}finally{this.busy=false;this.render();}
   }else{
    if(value.schema!=='upstate.implementation-site-visit-mappings/v1'||!value.mappings||typeof value.mappings!=='object')throw Error('Choose the complete batch mapping JSON.');
    for(const kind of sourceKinds)if(value.mappings[kind]&&!this.files[kind])throw Error('Choose the original '+kind+' CSV before applying its mapping.');
    const reviewed=Object.fromEntries(sourceKinds.filter(kind=>value.mappings[kind]).map(kind=>[kind,mappingDraft(kind,value.mappings[kind])]));
    for(const kind of sourceKinds)if(value.mappings[kind])this.files[kind].mapping=reviewed[kind];
    this.invalidate();this.busy=true;this.render();try{for(const kind of sourceKinds)if(this.files[kind])await this.inspect(kind);}finally{this.busy=false;this.render();}
   }return;
  }
  const kind=target.dataset.kind,input=this.files[kind];if(!input)return;
  if(this.locked())throw Error('Recover the original batch before changing its mapping.');
  const column=target.dataset.svColumn,constant=target.dataset.svConstant,setting=target.dataset.svSetting;
  if(column){if(target.value){input.mapping.columns[column]=target.value;delete input.mapping.constants[column];}else{delete input.mapping.columns[column];delete input.mapping.fallback_columns[column];}}
  else if(constant){if(target.value!==''){input.mapping.constants[constant]=target.value;delete input.mapping.columns[constant];delete input.mapping.fallback_columns[constant];}else delete input.mapping.constants[constant];}
  else if(setting)input.mapping[setting]=target.value;
  else return;
  this.invalidate();
  if(setting==='delimiter'||setting==='encoding'){this.busy=true;this.render();try{await this.inspect(kind);}finally{this.busy=false;this.render();}}else this.render();
 }
 async submit(){
  const p=this.pending;if(!p||this.busy)return;
  this.busy=true;this.error='';this.persist();this.render();
  try{
   if(p.id){await this.poll();return;}
   const r=await this.request('/api/actions',{}, {workspace:this.workspace,action:p.action,payload:p.payload,operation_id:p.operation_id});
   if(this.pending!==p)return;const task=r.task||r;
   if(task.workspace&&task.workspace!==this.workspace)throw Error('The original task belongs to another Workspace.');
   if(!task.id)throw Error('No original task ID was returned. Recover the same request.');
   p.id=task.id;p.state=task.state||'queued';this.persist();await this.poll();
  }catch(e){if(this.alive()&&this.pending===p&&!p.id){p.state='response_unconfirmed';this.persist();}throw e;}
  finally{if(this.alive()){this.busy=false;this.render();}}
 }
 async poll(){
  clearTimeout(this.timer);const p=this.pending;if(!p?.id||!this.alive())return;
  const r=await this.request('/api/task',{id:p.id}),task=r.task||r;if(this.pending!==p)return;
  if(task.workspace!==this.workspace||task.action!==p.action||task.operation_id!==p.operation_id||stableSiteVisitJSON(task.payload)!==stableSiteVisitJSON(p.payload))throw Error('The native task differs from the original reviewed batch request.');
  p.state=task.state;this.persist();
  if(task.state==='complete'){
   const result=task.result||{};
   if(result.plan?.id!==this.planId||result.operation_id!==p.payload.expected_operation_id||result.base_revision!==p.payload.revision)throw Error('The applied batch differs from its original saved revision and preview.');
   this.receipt={...clone(result),task_id:task.id||p.id,_downloads:clone(task._downloads||result._downloads||[])};delete this.receipt.plan;
   this.pending=null;this.preview=null;this.analysis=null;this.notice='The original CSVs, audit and reviewed rows are saved in one native revision. Your open browser draft remains unchanged.';this.persist();
   await(this.host.refresh?.({force:true})||this.host.refreshState?.({force:true}));if(this.alive())this.render();return;
  }
  if(['failed','cancelled','interrupted'].includes(task.state)){this.error=task.error?.message||'The original batch task '+task.state+'.';this.render();return;}
  this.render();this.timer=setTimeout(()=>this.poll().catch(e=>this.fail(e)),2000);
 }
 async refreshReceipt(){
  const prior=this.receipt;if(!prior?.task_id||this.pending||this.busy)return;
  this.busy=true;this.error='';this.render();
  try{
   const r=await this.request('/api/task',{id:prior.task_id}),task=r.task||r,result=task.result||{};
   if(this.receipt!==prior)return;
   if(task.id!==prior.task_id||task.workspace!==this.workspace||task.action!=='implementation.site-visit.import'||task.state!=='complete'||result.plan?.id!==this.planId||result.operation_id!==prior.operation_id)throw Error('The completed native task differs from this retained batch receipt.');
   this.receipt={...clone(result),task_id:task.id,_downloads:clone(task._downloads||result._downloads||[])};delete this.receipt.plan;this.persist();
  }finally{if(this.alive()){this.busy=false;this.render();}}
 }
 async apply(){
  if(this.locked()||this.w.pending)throw Error('Finish or recover the original plan operation first.');
  const preview=this.preview;if(!preview?.can_import||!sha.test(preview.operation_id||''))throw Error('Review the entire valid batch before applying it.');
  this.requireCurrent();this.w.cache();
  if(this.native){
   const payload={...this.nativePayload(),expected_operation_id:preview.operation_id,actor:this.actor};
   this.pending={action:'implementation.site-visit.import',operation_id:uid(),payload,state:'submitting'};this.persist();await this.submit();return;
  }
  this.busy=true;this.error='';this.render();
  try{
   const inputs=await this.portableInputs(),vault=await this.w.evidence.vault();this.requireCurrent();
   const result=await applyPortableSiteVisits(this.snapshot,inputs,{expected_operation_id:preview.operation_id,vault,actor:this.actor});this.requireCurrent();
   const plan=result.plan;this.receipt=clone(result);delete this.receipt.plan;this.preview=null;this.analysis=null;this.persist();
   const w=this.w;this.close();w.plan=plan;w.dirty=true;w.cache();w.message='Reviewed sites and visits applied together to the portable draft. Original CSVs and the complete audit are retained for Export plan + files ZIP; no native revision was issued.';w.render();
  }finally{if(this.alive()){this.busy=false;this.render();}}
 }
 async action(b){
  const a=b.dataset.svAction,kind=b.dataset.kind;
  if(a==='close'){this.close();return;}
  if(a==='previous'||a==='next'){this.page+=a==='previous'?-1:1;this.renderRows();return;}
  if(a==='kind'){this.activeKind=kind;this.render();return;}
  if(a==='choose-sites'||a==='choose-visits'){if(this.locked())throw Error('Recover the original batch first.');this.node.querySelector('[data-sv="file-'+a.slice(7)+'"]').click();return;}
  if(a==='batch-download'){download(this.planId+'-site-visit-mappings.json',{schema:'upstate.implementation-site-visit-mappings/v1',mappings:Object.fromEntries(sourceKinds.filter(k=>this.files[k]).map(k=>[k,clone(this.files[k].mapping)])),sources:Object.fromEntries(sourceKinds.filter(k=>this.files[k]).map(k=>[k,{filename:this.files[k].filename,sha256:this.files[k].sha256,bytes:this.files[k].bytes}]))});return;}
  if(a==='batch-open'||a==='mapping-open'){if(this.locked())throw Error('Recover the original batch first.');this.mappingFileKind=a==='mapping-open'?kind:null;this.node.querySelector('[data-sv="mapping-file"]').click();return;}
  if(a==='mapping-download'){download(this.planId+'-'+kind+'-mapping.json',this.files[kind].mapping);return;}
  if(a==='mapping-apply'){
   if(this.locked())throw Error('Recover the original batch first.');
   const value=JSON.parse(this.node.querySelector('[data-sv-mapping="'+kind+'"]').value);
   if(value.schema!=='upstate.implementation-site-visit-mapping/v1')throw Error('Choose the original mapping schema.');
   this.files[kind].mapping=mappingDraft(kind,value);this.invalidate();this.busy=true;this.render();
   try{await this.inspect(kind);}finally{this.busy=false;this.render();}return;
  }
  if(a==='inspect'){if(this.locked())throw Error('Recover the original batch first.');this.busy=true;this.invalidate();this.render();try{await this.inspect(kind);}finally{this.busy=false;this.render();}return;}
  if(a==='map-native'){
   if(this.locked())throw Error('Recover the original batch first.');
   const input=this.files[kind],headers=input?.inspection?.headers||[];
   for(const field of SITE_VISIT_FIELDS[kind])if(headers.includes(field)){input.mapping.columns[field]=field;delete input.mapping.constants[field];delete input.mapping.fallback_columns[field];}
   this.invalidate();this.render();return;
  }
  if(a==='remove-file'){if(this.locked())throw Error('Recover the original batch first.');delete this.files[kind];this.activeKind=sourceKinds.find(k=>this.files[k])||'sites';this.invalidate();this.render();return;}
  if(a==='preview'){await this.prepare();return;}
  if(a==='preview-download'){if(this.analysis)download(this.planId+'-complete-site-visit-review.json',publicPreview(this.analysis));return;}
  if(a==='record'){this.selectedRecord={kind,record:Number(b.dataset.record)};this.render();return;}
  if(a==='record-download'){const selected=this.selectedRecord,row=this.analysis?.decisions?.find(x=>x.kind===selected?.kind&&x.record===selected?.record);if(row)download(this.planId+'-'+row.kind+'-record-'+row.record+'.json',row);return;}
  if(a==='resolve'||a==='resolve-clear'){
   if(this.locked())throw Error('Recover the original batch first.');const selected=this.selectedRecord;if(!selected)return;
   const m=this.files[selected.kind].mapping;
   if(a==='resolve-clear')delete m.row_actions[String(selected.record)];
   else{
    const read=name=>this.node.querySelector('[data-sv-resolution="'+name+'"]')?.value||'',action=read('action'),reason=read('reason');
    if(!reason.trim())throw Error('Record the reason for this deliberate row decision.');
    const row={action,reason};
    if(action!=='skip'){for(const name of ['id','site_id'])if(read(name))row[name]=read(name);if(action==='replace'){if(!read('target_id'))throw Error('Choose the exact original replacement target.');row.target_id=read('target_id');}}
    m.row_actions[String(selected.record)]=row;
   }
   this.preview=null;this.persist();this.notice='Row decision retained. Preview the complete batch again to validate all site and activity relationships.';this.render();return;
  }
  if(a==='apply'){await this.apply();return;}
  if(a==='recover'){await this.submit();return;}
  if(a==='poll'){await this.poll();return;}
  if(a==='task'){if(this.pending?.id)await this.host.showTask?.(this.pending.id);return;}
  if(a==='resume'){const p=this.pending;if(!p?.id||p.state!=='interrupted')throw Error('Choose the original interrupted task.');const r=await this.request('/api/task/resume',{}, {id:p.id});if(this.pending!==p)return;p.state=(r.task||r).state||'queued';this.persist();await this.poll();return;}
  if(a==='retire'){if(!this.pending||!['failed','cancelled'].includes(this.pending.state))throw Error('Retain the original request until its actual task status is known.');download(this.planId+'-original-failed-site-visit-request.json',this.pending);this.pending=null;this.invalidate();this.render();return;}
  if(a==='request-download'){if(this.pending)download(this.planId+'-original-site-visit-request.json',this.pending);return;}
  if(a==='receipt-download'){if(this.receipt)download(this.planId+'-site-visit-receipt.json',this.receipt);return;}
  if(a==='receipt-refresh'){await this.refreshReceipt();return;}
  if(a==='open-current'){
   if(this.pending||this.w.pending||this.busy)throw Error('Finish or recover the original native operation first.');
   const w=this.w,id=this.planId,workspace=this.workspace;this.close();await w.openPlan(id,true);
   if(!w.gone&&w.workspace===workspace&&w.plan?.id===id){w.tab='sites';w.message='Opened the latest native plan; any previous browser draft remains retained separately.';w.render();}return;
  }
 }
}
export async function openSiteVisitIntake(w){
 if(w.gone||!w.plan?.id)throw Error('Open the original implementation plan first.');
 if(w.pending)throw Error('Finish or recover its original plan operation first.');
 if(w.native&&(!w.nativePlan?.revision||w.host.getState?.()?.workspace_key!==w.workspace))throw Error('Save the native plan before importing its reviewed CSV batch.');
 if(w.root.querySelector('dialog[open]'))throw Error('Close the current plan editor before opening a CSV batch.');
 detachSiteVisitIntake(w);w.cache();const editor=new SiteVisitIntake(w);w.siteVisitEditor=editor;
 try{await editor.start();}catch(error){if(error.name!=='AbortError')editor.fail(error);}return editor;
}
export function detachSiteVisitIntake(w){w.siteVisitEditor?.close();w.siteVisitEditor=null;}

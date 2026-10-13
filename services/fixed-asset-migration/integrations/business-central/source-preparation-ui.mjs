/** Guided offline preparation uses the maintained master/work-order converters.
 * Originals, preparation context and mapping decisions enter the original
 * workspace journal together. No network or supplier-side mutation occurs. */
export const DRAFT_SCHEMA='tjlabs.business-central-source-preparation-draft.v1';
export const ADOPTION_PURPOSE='Business Central source preparation / tjlabs.business-central-source-adoption.v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const need=(ok,message)=>{if(!ok)throw Error(message);};
const masterKinds=['fixedAssets','maintenanceAssets'];
const kinds=[['fixedAssets','Business Central fixed-asset cards'],['maintenanceAssets','Dynaway maintenance assets'],['resourceLines','Dynaway resource line responses'],['itemLines','Dynaway item line responses'],['expenseLines','Dynaway expense line responses'],['postedLedger','Dynaway posted work-order ledger']];
const encode=text=>{
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',bytes=[];
 for(const c of text){const n=c.codePointAt(0);need(n<55296||n>57343,'Retain valid UTF-8 source text.');if(n<128)bytes.push(n);else if(n<2048)bytes.push(192|(n>>6),128|(n&63));else if(n<65536)bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}
 let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],v=(a<<16)|((b||0)<<8)|(c||0);out+=alphabet[v>>>18]+alphabet[(v>>>12)&63]+(b===undefined?'=':alphabet[(v>>>6)&63])+(c===undefined?'=':alphabet[v&63]);}return out;
};
const nonempty=(value,label,max=4000)=>{need(typeof value==='string'&&value.trim()&&value.length<=max,'Enter '+label+'.');return value;};
export function createSourcePreparation({E,W,prepareMasterCapture,prepareWorkOrderCapture,sha256Utf8}){
 const identity=text=>sha256Utf8(text);
 const artifact=(path,mimeType,text)=>({path,mimeType,text,...identity(text)});
 function blank(){return{schema:DRAFT_SCHEMA,role:'',actor:'',reason:'',capture:{schema:'',kind:'',tenantId:'',environment:'',companyId:'',canonicalCompanyId:'',collectionUrl:'',observedAt:'',population:{complete:null,description:''},selection:{quantityField:'',actor:'',reason:''},pages:[]},captureOriginal:null,pageNames:[],contextName:null};}
 function receiveCapture(text,filename){
  need(identity(text).bytes<=E.LIMITS.supportingBytes,'The complete capture exceeds the supporting-file limit.');
  const capture=JSON.parse(text.charCodeAt(0)===0xfeff?text.slice(1):text);
  need(capture&&typeof capture==='object'&&!Array.isArray(capture)&&kinds.some(([k])=>k===capture.kind),'Choose a complete supported master or work-order capture JSON.');
  need(Array.isArray(capture.pages),'The capture must retain its complete original response pages.');
  const original=artifact(nonempty(filename,'the original capture filename',300),'application/json',text);
  return{...blank(),capture:clone(capture),captureOriginal:original,actor:capture.selection?.actor||'',reason:capture.selection?.reason||'',pageNames:capture.pages.map((_,i)=>'Captured response '+(i+1)),contextName:capture.companyContext?'Captured general-ledger setup':null};
 }
 function prepare(draft){
  need(draft?.schema===DRAFT_SCHEMA,'Retain the complete source-preparation draft.');
  need(['source','target'].includes(draft.role),'Choose Original source or Returned target explicitly.');
  nonempty(draft.actor,'the preparation reviewer',200);nonempty(draft.reason,'the source and selection explanation');
  const capture=clone(draft.capture),isMaster=masterKinds.includes(capture.kind);
  const prepared=isMaster?prepareMasterCapture(capture):prepareWorkOrderCapture(capture);
  const sourcePath=isMaster?'assets.csv':'work-order-source.csv';
  const source=prepared.files.find(f=>f.path===sourcePath);need(source,'The maintained converter did not return its complete prepared CSV.');
  for(const file of prepared.files){const actual=identity(file.text);need(file.bytes===actual.bytes&&file.sha256===actual.sha256,'A prepared source identity differs: '+file.path);}
  const inputText=JSON.stringify({schema:DRAFT_SCHEMA,role:draft.role,actor:draft.actor,reason:draft.reason,capture,captureOriginal:draft.captureOriginal,pageNames:draft.pageNames,contextName:draft.contextName},null,2)+'\n';
  const files=[...prepared.files];
  if(!files.some(f=>f.path==='capture.json'))files.push(artifact('capture.json','application/json',JSON.stringify(capture,null,2)+'\n'));
  if(draft.captureOriginal){const f=draft.captureOriginal,actual=identity(f.text);need(f.bytes===actual.bytes&&f.sha256===actual.sha256,'The imported original capture document changed.');files.push({...f,path:'original-capture-document.json'});}
  const binding={schema:'tjlabs.business-central-source-adoption.v1',role:draft.role,domain:isMaster?'assets':'costs',actor:draft.actor,reason:draft.reason,captureSha256:identity(JSON.stringify(capture)).sha256,originalCapture:draft.captureOriginal?{filename:draft.captureOriginal.path,bytes:draft.captureOriginal.bytes,sha256:draft.captureOriginal.sha256}:null,originalFileNames:{pages:clone(draft.pageNames||[]),companyContext:draft.contextName||null},scope:prepared.scope,files:files.map(({text,...f})=>f)};
  const id=identity(JSON.stringify(binding)).sha256;
  files.push(artifact('preparation-review.json','application/json',JSON.stringify({...binding,id},null,2)+'\n'));
  need(files.length+2<=E.LIMITS.supportingFiles,'This complete selection leaves no room for the original import and mapping journal. Choose a complete population that fits the workspace limits.');
  need(files.every(f=>f.bytes<=E.LIMITS.supportingBytes),'A complete preparation member exceeds the supporting-file limit.');
  // This is an early conservative bound; the original journal also validates its
  // full postimage after every mutation before the application commits anything.
  need(files.reduce((n,f)=>n+4*Math.ceil(f.bytes/3),0)+source.bytes*2<E.LIMITS.workspaceBytes,'This complete preparation exceeds the portable workspace limit.');
  return{id,inputSha256:identity(inputText).sha256,scope:prepared.scope,files,sourcePath,role:draft.role,domain:isMaster?'assets':'costs',isMaster,binding};
 }
 function adopt(workspace,draft,preview,input){
  E.validateWorkspace(workspace);need(input.expectedRevision===workspace.revision,'The workspace changed. Preview the complete preparation against its current revision.');
  const fresh=prepare(draft);need(preview&&fresh.id===preview.id&&fresh.inputSha256===preview.inputSha256,'The source or review choices changed. Preview the complete current selection again.');
  need(input.confirmed===true,'Confirm review of the full source scope and findings before adoption.');
  const at=nonempty(input.at,'the adoption time',64),rootId=nonempty(input.operationId,'the adoption operation',120),receipts=[],supporting=[];
  let current=workspace,index=0,sourceId;
  const meta=()=>({operationId:rootId+':source-preparation:'+String(++index),expectedRevision:current.revision,at});
  function take(result){current=result.workspace;receipts.push(result.receipt);return result;}
  for(const f of fresh.files){
   const result=take(E.importSupportingFile(current,{...meta(),filename:'bc-'+fresh.id.slice(0,12)+'-'+f.path.replaceAll('/','--'),mimeType:f.mimeType.split(';')[0],purpose:ADOPTION_PURPOSE+'; capture '+fresh.id+'; member '+f.path,base64:encode(f.text)}));
   supporting.push({path:f.path,id:result.receipt.result.supportingFileId,bytes:f.bytes,sha256:f.sha256});
  }
  const source=fresh.files.find(f=>f.path===fresh.sourcePath),filename='bc-'+draft.capture.kind+'-'+fresh.id.slice(0,12)+'.csv';
  if(fresh.isMaster){
   const imported=take(E.importCsv(current,{...meta(),role:fresh.role,domain:'assets',filename,text:source.text,observedAt:draft.capture.observedAt}));
   sourceId=imported.receipt.result.sourceId;
   take(E.saveMapping(current,{...meta(),role:fresh.role,domain:'assets',sourceId,columns:{company_id:0,asset_id:1,parent_asset_id:2,class_code:3,description:4},amount_multiplier:1}));
  }else{
   need(W,'The original work-order journal is required.');
   const imported=take(W.run(current,'import',{...meta(),role:fresh.role,domain:'costs',filename,text:source.text,observedAt:draft.capture.observedAt}));
   sourceId=imported.workOrderResult.id;
   take(W.run(current,'map',{...meta(),sourceId,columns:fresh.scope.mappingColumns}));
  }
  // A complete independent reopen proves that every original operation is
  // replayable; the browser persists this single final candidate atomically.
  const portable=E.exportWorkspace(current),reopened=E.importWorkspace(portable);
  if(!fresh.isMaster)W.read(reopened);
  need(E.exportWorkspace(reopened)===portable,'The complete prepared workspace did not reopen identically.');
  return{workspace:current,receipt:receipts.at(-1),preparation:{id:fresh.id,sourceId,role:fresh.role,domain:fresh.domain,operations:receipts.map(r=>r.id),supporting,revision:current.revision}};
 }
 return Object.freeze({blank,receiveCapture,prepare,adopt});
}

export function createSourcePreparationPanel(dependencies,host){
 const {E,sha256Utf8}=dependencies,model=createSourcePreparation(dependencies);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const $=selector=>document.querySelector(selector);
 let workspaceId=null,draftReference=null,draft=null,preview=null,confirmed=false,generation=0,filePath='',query='',page=0,lastResult=null;
 function state(){
  const id=host.getWorkspace().id,saved=host.getDraft();
  if(id!==workspaceId||draft===null||saved!==draftReference){workspaceId=id;draftReference=saved;draft=saved?.schema===DRAFT_SCHEMA?clone(saved):model.blank();draft.pageNames??=[];preview=null;confirmed=false;lastResult=null;generation++;}
  return draft;
 }
 function save(){host.setDraft(clone(draft));draftReference=host.getDraft();}
 function invalidate(){
  preview=null;confirmed=false;lastResult=null;generation++;page=0;save();
  const panel=$('#sp-preview');if(panel)panel.hidden=true;
  const note=$('#sp-state');if(note)note.textContent='Choices changed. Preview the complete current selection before adoption.';
 }
 const opt=(rows,value)=>rows.map(([id,label])=>'<option value="'+esc(id)+'" '+(id===String(value??'')?'selected':'')+'>'+esc(label)+'</option>').join('');
 const field=(key,label,value,type='text')=>'<label>'+esc(label)+'<input data-sp-field="'+key+'" type="'+type+'" value="'+esc(value)+'" autocomplete="off"></label>';
 const select=(key,label,rows,value)=>'<label>'+esc(label)+'<select data-sp-field="'+key+'">'+opt(rows,value)+'</select></label>';
 const btn=(id,label,disabled=false)=>'<button id="'+id+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
 function previewHTML(){
  if(!preview)return'';
  const d=state(),files=preview.files,selected=files.find(f=>f.path===filePath)||files.find(f=>f.path===preview.sourcePath),s=preview.scope;
  filePath=selected.path;
  let content;
  if(selected.mimeType.startsWith('text/csv')){
   const parsed=E.parseCsv(selected.text),matches=parsed.rows.map((cells,i)=>({cells,record:i+2})).filter(r=>!query||r.cells.some(c=>c.toLowerCase().includes(query.toLowerCase())));
   const pages=Math.max(1,Math.ceil(matches.length/50));page=Math.min(page,pages-1);
   content='<p>'+matches.length+' of '+parsed.rows.length+' complete records · page '+(page+1)+' of '+pages+'. Every cell is retained; scroll the table horizontally for all '+parsed.headers.length+' columns.</p><div class="toolbar"><label>Search every original cell<input id="sp-search" value="'+esc(query)+'"></label>'+btn('sp-prev','Previous',page===0)+btn('sp-next','Next',page+1>=pages)+'</div><div class="table-wrap" tabindex="0" aria-label="Complete prepared records"><table><thead><tr><th>CSV record</th>'+parsed.headers.map((h,i)=>'<th>'+esc(h)+'<br><span class="muted">Column '+(i+1)+'</span></th>').join('')+'</tr></thead><tbody>'+matches.slice(page*50,page*50+50).map(r=>'<tr><td>'+r.record+'</td>'+r.cells.map(c=>'<td class="cell">'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }else content='<pre tabindex="0">'+esc(selected.text)+'</pre>';
  const findings=files.find(f=>f.path==='source-findings.csv'),findingRows=findings?E.parseCsv(findings.text).rows.length:0;
  const columns=preview.isMaster?{company_id:0,asset_id:1,parent_asset_id:2,class_code:3,description:4}:s.mappingColumns;
  return'<section id="sp-preview" class="panel"><h2>2. Review the complete preparation</h2><p><strong>'+esc(s.rowCount??s.rows??'?')+' prepared records · '+findingRows+' source findings.</strong> '+esc(d.role==='source'?'Original source':'Returned target')+' will be selected for '+esc(preview.isMaster?'asset mapping':'work-order costs')+'.</p><p>'+esc(s.snapshotConsistency||'Pagination alone does not establish a consistent supplier snapshot.')+'</p><p>Unresolved header links, missing amounts and source questions remain findings. Preparation is not supplier acceptance or a completed migration.</p><details><summary>Original scope and API meanings</summary><pre>'+esc(JSON.stringify(s,null,2))+'</pre></details><details><summary>Exact prepared-column mapping</summary><ul>'+Object.entries(columns).map(([name,column])=>'<li>'+esc(name)+' ← column '+(column+1)+'</li>').join('')+'</ul><p>Only the maintained canonical projection is mapped automatically. All additional native fields and original response bytes remain available below and in Exit files.</p></details><div class="toolbar"><label>Complete file<select id="sp-file">'+opt(files.map(f=>[f.path,f.path+' · '+f.bytes+' bytes']),filePath)+'</select></label>'+btn('sp-download-file','Download this complete file')+btn('sp-download-capture','Download complete capture')+'</div><p class="id">'+esc(selected.sha256)+'</p>'+content+'<label class="confirm"><input id="sp-confirm" type="checkbox" '+(confirmed?'checked':'')+'>I reviewed this source scope, the prepared rows, mappings and findings. Adopt the complete selection with unresolved findings retained.</label>'+btn('sp-adopt','Adopt originals, source and mapping',!confirmed)+'<p class="muted">This commits the complete candidate through the original workspace journal. Existing source editions and decisions remain in history; the selected '+esc(d.role)+' '+esc(preview.domain)+' mapping changes to this edition. Financial attestations may become stale after source changes.</p></section>';
 }
 function render(){
  const d=state(),c=d.capture,isMaster=masterKinds.includes(c.kind),isLine=['resourceLines','itemLines','expenseLines'].includes(c.kind),s=c.selection||{},ctx=c.companyContext;
  const pages=Array.isArray(c.pages)?c.pages:[];
  return'<section class="panel" id="source-preparation"><h2>1. Prepare retained Business Central / Dynaway source files</h2><p>Choose the complete original response files already received through your authorised supplier connection. Enter their actual request and company context. The existing converters validate the full page chain and retain every original response; no tenant connection is made here.</p><div class="toolbar"><label>Existing complete capture JSON<input type="file" id="sp-capture-file" accept=".json,application/json"></label>'+btn('sp-load-capture','Open complete capture')+btn('sp-clear','Clear preparation draft')+'</div><p class="muted">Opening another capture replaces only this unfinished preparation. Save working HTML first to retain the current draft. Adopted originals remain in the workspace.</p><div class="fields">'+select('kind','Original API dataset',[['','Choose the recorded dataset'],...kinds],c.kind)+select('role','Use in this workspace',[['','Choose the source role'],['source','Original source'],['target','Returned target']],d.role)+field('tenantId','Recorded tenant identity',c.tenantId)+field('environment','Recorded environment',c.environment)+field('companyId','Original native company GUID',c.companyId)+field('canonicalCompanyId','Company identifier used in this workspace',c.canonicalCompanyId)+field('collectionUrl','Original collection URL, without query',c.collectionUrl)+field('observedAt','Actual capture time (ISO timestamp with timezone)',c.observedAt)+(isLine?field('workOrderId','Original work-order GUID',c.workOrderId):'')+select('complete','Declared population',[['','Choose the documented population'],['false','Selected / filtered population'],['true','Complete collection population']],c.population?.complete===null||c.population?.complete===undefined?'':String(c.population.complete))+field('description','Population / filter and snapshot explanation',c.population?.description)+field('actor','Preparation reviewer',d.actor)+field('reason','Source and selection explanation',d.reason)+'</div>'+(isLine?'<p>These endpoints return individually requested lines. Retain the work-order GUID and each original line URL; they cannot establish a complete order population.</p>':'')+(!isMaster&&c.kind?'<div class="fields">'+select('quantityField','Original quantity field',[['','Choose the recorded quantity meaning'],['quantity','quantity'],...(c.kind==='postedLedger'?[]:[['qtyToConsume','qtyToConsume'],['qtyConsumed','qtyConsumed']])],s.quantityField)+(c.kind==='postedLedger'?select('expenseLineCostField','Expense amount selection',[['','Leave missing line amounts unresolved'],['expenseActualLineCostLCY','Actual expense line cost in LCY'],['expenseExpectedLineCostLCY','Expected expense line cost in LCY']],s.expenseLineCostField):'')+'</div><p>Expected unit costs are never multiplied into line amounts. Posted expense LCY selection requires the original same-company general-ledger setup response; actual and expected costs remain distinct.</p>':'')+'<h3>Ordered original responses</h3><div class="toolbar"><label>Complete response JSON files<input type="file" id="sp-page-files" multiple accept=".json,application/json"></label>'+btn('sp-add-pages','Add original response files')+'</div>'+pages.map((p,i)=>'<details '+(pages.length===1?'open':'')+'><summary>Response '+(i+1)+' · '+esc(d.pageNames?.[i]||'retained original')+' · '+(typeof p.bodyText==='string'?sha256Utf8(p.bodyText).bytes:0)+' bytes</summary><div class="fields">'+field('page:'+i+':url','Literal original requested URL',p.url)+field('page:'+i+':status','Recorded HTTP status',p.status,'number')+field('page:'+i+':requestId','Original request ID (if supplied)',p.requestId)+field('page:'+i+':etag','Original response ETag (if supplied)',p.etag)+'</div><p class="id">'+esc(typeof p.bodyText==='string'?sha256Utf8(p.bodyText).sha256:'Missing original body')+'</p><div class="toolbar"><button data-sp-page="'+i+'" data-sp-action="up" '+(i===0?'disabled':'')+'>Move earlier</button><button data-sp-page="'+i+'" data-sp-action="down" '+(i===pages.length-1?'disabled':'')+'>Move later</button><button data-sp-page="'+i+'" data-sp-action="download">Download original</button><button data-sp-page="'+i+'" data-sp-action="remove">Remove from draft</button></div><details><summary>Full original response text</summary><pre>'+esc(p.bodyText||'')+'</pre></details></details>').join('')+(c.kind==='postedLedger'?'<h3>Original company / LCY context</h3><p>Use the single original Business Central generalLedgerSetup response for this same company. Its recorded local currency is required when selecting a posted expense LCY amount.</p><div class="toolbar"><label>Original general-ledger setup JSON<input type="file" id="sp-context-file" accept=".json,application/json"></label>'+btn('sp-load-context','Attach original company context')+(ctx?btn('sp-remove-context','Remove context from draft'):'')+'</div>'+(ctx?'<div class="fields">'+field('context:url','Literal generalLedgerSetup record URL',ctx.url)+field('context:status','Recorded context HTTP status',ctx.status,'number')+field('lcyCode','Declared original local currency code',s.lcyCode)+field('lcySourceReference','Source reference for local currency',s.lcySourceReference)+'</div><details><summary>Complete original company response</summary><pre>'+esc(ctx.bodyText||'')+'</pre></details>':''):'')+'<p id="sp-state" role="status">'+(preview?'Complete current preparation is shown below.':'Original response bytes and unfinished choices are retained in Save working HTML. Preview validates all pages, quantities and source context.')+'</p>'+btn('sp-preview-button','Preview all rows and findings')+'</section>'+previewHTML()+(lastResult?'<section class="panel"><h2>Preparation adopted</h2><p>Revision '+lastResult.revision+' retains every original and the selected mapping. Continue in '+esc(lastResult.domain==='assets'?'Source files and Field mapping':'Work orders and costs')+' to review source links, corrections and actual returned-target matching.</p><p class="id">Source '+esc(lastResult.sourceId)+'</p></section>':'');
 }
 function wire(renderAgain,run){
  state();
  function action(id,fn){const node=$('#'+id);if(node)node.onclick=()=>run(fn);}
  function setField(key,value){
   const c=draft.capture;c.population??={complete:null,description:''};c.selection??={};
   if(key==='role'||key==='actor'||key==='reason'){draft[key]=value;if(key!=='role')c.selection[key]=value;}
   else if(key==='kind'){c.kind=value;c.schema=masterKinds.includes(value)?'tjlabs.business-central-master-capture.v1':'tjlabs.business-central-work-order-capture.v1';}
   else if(key==='complete')c.population.complete=value===''?null:value==='true';
   else if(key==='description')c.population.description=value;
   else if(['quantityField','lcyCode','lcySourceReference'].includes(key))c.selection[key]=value;
   else if(key==='expenseLineCostField'){if(value)c.selection[key]=value;else delete c.selection[key];}
   else if(key.startsWith('page:')){const [,index,field]=key.split(':'),p=c.pages[Number(index)];p[field]=field==='status'?(value===''?null:Number(value)):value;}
   else if(key.startsWith('context:')){const field=key.slice(8);c.companyContext[field]=field==='status'?(value===''?null:Number(value)):value;}
   else c[key]=value;
   invalidate();
  }
  document.querySelectorAll('[data-sp-field]').forEach(node=>{
   node.oninput=()=>setField(node.dataset.spField,node.value);
   if(node.tagName==='SELECT')node.onchange=()=>{setField(node.dataset.spField,node.value);renderAgain();};
  });
  async function read(file){need(file,'Choose a complete original file.');need(file.size<=E.LIMITS.supportingBytes,'The original file exceeds 32 MiB.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());}
  const current=(id,version)=>{need(host.getWorkspace().id===id&&generation===version,'The source selection changed while reading. Choose the original file again.');};
  action('sp-load-capture',async()=>{const file=$('#sp-capture-file').files[0],id=workspaceId,version=generation,text=await read(file);current(id,version);const incoming=model.receiveCapture(text,file.name);draft=incoming;invalidate();renderAgain();});
  action('sp-clear',()=>{draft=model.blank();invalidate();renderAgain();});
  action('sp-add-pages',async()=>{
   const files=[...$('#sp-page-files').files],id=workspaceId,version=generation;need(files.length,'Choose one or more complete response files.');need(draft.capture.pages.length+files.length<=E.LIMITS.supportingFiles-8,'Too many original response files for one complete preparation.');
   need(files.reduce((n,f)=>n+f.size,0)<=E.LIMITS.workspaceBytes/2,'These original files exceed the complete preparation limit.');
   const texts=[];for(const file of files)texts.push(await read(file));current(id,version);
   files.forEach((file,i)=>{draft.capture.pages.push({status:null,url:'',bodyText:texts[i],sha256:sha256Utf8(texts[i]).sha256});draft.pageNames.push(file.name);});invalidate();renderAgain();
  });
  action('sp-load-context',async()=>{const file=$('#sp-context-file').files[0],id=workspaceId,version=generation,text=await read(file);current(id,version);draft.capture.companyContext={status:null,url:'',bodyText:text,sha256:sha256Utf8(text).sha256};draft.contextName=file.name;invalidate();renderAgain();});
  action('sp-remove-context',()=>{delete draft.capture.companyContext;draft.contextName=null;invalidate();renderAgain();});
  document.querySelectorAll('[data-sp-page]').forEach(node=>node.onclick=()=>run(()=>{
   const i=Number(node.dataset.spPage),action=node.dataset.spAction,pages=draft.capture.pages;
   if(action==='download'){host.download(draft.pageNames[i]||'original-response-'+(i+1)+'.json',pages[i].bodyText,'application/json');return;}
   if(action==='remove'){pages.splice(i,1);draft.pageNames.splice(i,1);}
   else{const to=i+(action==='up'?-1:1);if(to<0||to>=pages.length)return;[pages[i],pages[to]]=[pages[to],pages[i]];[draft.pageNames[i],draft.pageNames[to]]=[draft.pageNames[to],draft.pageNames[i]];}
   invalidate();renderAgain();
  }));
  action('sp-preview-button',()=>{preview=model.prepare(draft);confirmed=false;filePath=preview.sourcePath;query='';page=0;save();renderAgain();});
  const file=$('#sp-file');if(file)file.onchange=()=>{filePath=file.value;page=0;query='';renderAgain();};
  const search=$('#sp-search');if(search)search.onchange=()=>{query=search.value;page=0;renderAgain();};
  action('sp-prev',()=>{page=Math.max(0,page-1);renderAgain();});action('sp-next',()=>{page++;renderAgain();});
  action('sp-download-file',()=>{need(preview,'Preview this current source selection.');const f=preview.files.find(f=>f.path===filePath);host.download(f.path.replaceAll('/','--'),f.text,f.mimeType);});
  action('sp-download-capture',()=>{need(preview,'Preview this current source selection.');host.download('business-central-'+draft.capture.kind+'-capture.json',JSON.stringify(draft.capture,null,2)+'\n','application/json');});
  const checkbox=$('#sp-confirm');if(checkbox)checkbox.onchange=()=>{confirmed=checkbox.checked;$('#sp-adopt').disabled=!confirmed;};
  action('sp-adopt',async()=>{
   need(confirmed&&preview,'Review and confirm the complete current preparation.');
   const selected=clone(draft),reviewed=preview;let result;
   await host.change(meta=>(result=model.adopt(host.getWorkspace(),selected,reviewed,{...meta,at:host.now(),confirmed:true})),selected);
   lastResult=result.preparation;confirmed=false;renderAgain();
  });
 }
 return Object.freeze({render,wire});
}

"""Research document receiving, embedded in the original Analysis application."""

HTML = r'''
<section id="tab-research" hidden>
<section class="panel">
<div class="section-head"><div><h2>Research documents</h2><p>Choose an existing Research dossier and a saved document or retained Pipelines output. Capture its reviewed edition as a source in this Analysis workspace, then use the existing mapping, queries, exports and workbook controls.</p></div></div>
<p id="research-config-note" class="muted"></p>
<div class="form-row"><label>Research connection<select id="research-connection"></select></label><button id="research-load-dossiers">Read dossiers</button></div>
<div class="form-row"><label>Dossier<select id="research-dossier"></select></label><button id="research-more-dossiers">More dossiers</button><label>Saved source<select id="research-family"><option value="documents">Documents</option><option value="pipelines">Managed Pipelines outputs</option></select></label><button id="research-load-sources">Read saved sources</button></div>
<p id="research-dossier-description" class="muted"></p>
<div class="table-scroll"><table class="research-sources"><thead><tr><th>Select</th><th>Saved document or output</th><th>Original state</th><th>Original identity</th></tr></thead><tbody id="research-source-rows"></tbody></table></div>
<div class="toolbar"><button id="research-more-sources">More saved sources</button><button id="research-review" class="primary">Review selected edition</button></div>
<p id="research-status" role="status" aria-live="polite"></p>
<details><summary>Local connection setup</summary><p>The local operator starts Analysis with <code>--research-connections /private/research-connections.json</code>. Each named connection refers to the original Research client connection file and pins its actual workspace ID. Credentials and local file paths remain in that configuration. See RESEARCH_INTAKE.md.</p><p>Receiving uses saved content. Document purchases and managed provider jobs remain owned by the original Research application.</p></details>
</section>
<section id="research-review-panel" class="panel" hidden>
<h2>Review the retained edition</h2><div id="research-review-facts" class="facts"></div>
<details><summary>Original source, provider and completion details</summary><pre id="research-review-json"></pre></details>
<div class="form-row"><label>Page filter<input id="research-element-page" placeholder="All pages"></label><label>Type filter<input id="research-element-type" placeholder="All types"></label><label>Find text<input id="research-element-query" maxlength="2000"></label><button id="research-read-elements">Read elements</button></div>
<p id="research-element-info" class="muted"></p><div id="research-elements"></div>
<div class="toolbar"><button id="research-elements-prev">Previous elements</button><button id="research-elements-next">Next elements</button></div>
<div class="form-row"><label>Analysis source name<input id="research-source-name" maxlength="64" placeholder="document_elements" spellcheck="false"></label><label>Source title<input id="research-source-title" maxlength="160" placeholder="Retained document elements"></label></div>
<div class="form-row"><label>Capture time (ISO 8601)<input id="research-captured-at" readonly></label></div>
<p id="research-source-revision" class="muted"></p>
<button id="research-capture" class="primary">Capture reviewed edition</button>
<p>The capture retains every original occurrence, complete text and metadata, the original source file or provider output, and the full research edition. Its default mapping includes a workbook-safe text preview alongside the complete text.</p>
</section>
<section id="research-pending-panel" class="panel" hidden>
<h2>Retained capture request</h2><p id="research-pending-status"></p><pre id="research-pending-request"></pre>
<div class="toolbar"><button id="research-reopen-pending" class="primary">Reopen this exact capture</button><button id="research-new-review">Keep in Activity and begin another review</button></div>
</section>
<section id="research-capture-panel" class="panel" hidden>
<h2 id="research-capture-heading">Capture</h2><div id="research-capture-facts" class="facts"></div>
<p id="research-capture-state"></p><div class="toolbar"><button id="research-map-source" class="primary">Open source in response mapping</button><button id="research-resume-capture">Continue the same capture</button><button id="research-cancel-capture">Cancel this local capture</button><button id="research-refresh-capture">Read current capture</button></div>
<details><summary>Exact capture request, source and receipt</summary><pre id="research-capture-json"></pre></details>
<p id="research-capture-help" class="muted"></p>
</section>
<section class="panel"><h2>Capture history</h2><p>These are original Analysis jobs. Completed sources, imported versions and their evidence remain in the portable workspace.</p><div class="table-scroll"><table><thead><tr><th>Created</th><th>Source</th><th>State</th><th>Edition</th><th></th></tr></thead><tbody id="research-captures"></tbody></table></div><button id="research-more-captures">Older captures</button></section>
</section>
'''

CSS = r'''
#tab-research pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:30rem;overflow:auto}
#tab-research .form-row label{min-width:0;flex:1}#tab-research input,#tab-research select{min-width:0;max-width:100%}
#research-status{white-space:pre-wrap;overflow-wrap:anywhere}#research-status.error{font-weight:600}
#research-elements{display:grid;gap:.7rem}#research-elements article{border:1px solid #c6c6c6;padding:.8rem;background:#fafafa}
#research-elements article p{white-space:pre-wrap;overflow-wrap:anywhere;margin:.45rem 0}
#research-elements article h3{font-size:1rem;margin:0}#research-elements article pre{font-size:.85rem}
#research-review-facts,#research-capture-facts{overflow-wrap:anywhere}
.research-sources td:last-child{font-family:ui-monospace,monospace;overflow-wrap:anywhere;max-width:28rem}
.research-sources input[type=radio]{width:auto;min-width:0}.research-sources tr.selected{background:#ececec}
#research-pending-panel{border-width:2px}#research-pending-request{max-height:16rem}
@media(max-width:640px){#tab-research .form-row{display:flex;flex-direction:column;align-items:stretch}
#tab-research .toolbar{flex-wrap:wrap}#tab-research .toolbar button{flex:1 1 12rem}
.research-sources{min-width:610px}#research-capture-facts{grid-template-columns:1fr}}
'''

JS = r'''
(()=>{
const r={config:null,dossiers:[],dossierNext:null,rows:[],sourceNext:null,selection:null,review:null,
 elements:null,elementHistory:[],pending:null,job:null,history:[],historyNext:null,loaded:false,sequence:0,savedJobId:null};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const connection=()=>r.config?.connections.find(value=>value.name===$('research-connection').value);
const dossier=()=>r.dossiers.find(value=>value.id===$('research-dossier').value);
const family=()=>$('research-family').value;
const identity=()=>{const selected=connection();if(!selected)throw Error('Choose a configured Research connection.');return {connection:selected.name,expected_workspace_id:selected.workspace_id};};
const base=()=>{const selected=dossier();if(!selected)throw Error('Read and choose the original dossier.');return {...identity(),dossier_id:selected.id,family:family()};};
const selectedRequest=()=>{if(!r.selection)throw Error('Select an existing saved document or retained output.');return {...base(),selection:structuredClone(r.selection)};};
const key=()=>s.data?'sf-analysis-research:'+s.data.workspace_id:null;
const localMessage=(value,error=false)=>{$('research-status').textContent=value;$('research-status').classList.toggle('error',error);};
function save(required=false){
 const name=key();if(!name){if(required)throw Error('Open the Analysis workspace before recording a capture.');return;}
 const value={connection:$('research-connection').value,dossier_id:$('research-dossier').value,family:family(),
   source_name:$('research-source-name').value,title:$('research-source-title').value,
   pending:r.pending,job_id:r.job?.id??r.savedJobId};
 try{const raw=JSON.stringify(value);localStorage.setItem(name,raw);if(required&&localStorage.getItem(name)!==raw)throw Error('not retained');}
 catch{if(required)throw Error('This browser could not retain the exact capture request. Enable local storage before capturing.');}
}
function invalidate({sources=false,dossiers=false}={}){
 ++r.sequence;r.review=null;r.elements=null;r.elementHistory=[];$('research-review-panel').hidden=true;
 if(sources||dossiers){r.rows=[];r.selection=null;r.sourceNext=null;renderSources();}
 if(dossiers){r.dossiers=[];r.dossierNext=null;renderDossiers();}
 renderReview();save();controls();
}
function controls(){
 const busy=s.busy||!s.data,locked=busy||!!r.pending,active=!!s.active;
 for(const name of ['research-connection','research-dossier','research-family','research-source-name','research-source-title'])$(name).disabled=locked;
 $('research-load-dossiers').disabled=locked||!connection();
 $('research-more-dossiers').disabled=locked||!r.dossierNext;
 $('research-load-sources').disabled=locked||!dossier();
 $('research-more-sources').disabled=locked||!r.sourceNext;
 $('research-review').disabled=locked||!r.selection;
 for(const radio of $('research-source-rows').querySelectorAll('input'))radio.disabled=locked;
 for(const name of ['research-element-page','research-element-type','research-element-query','research-read-elements'])$(name).disabled=locked||!r.review;
 $('research-elements-prev').disabled=locked||!r.review||!r.elementHistory.length;
 $('research-elements-next').disabled=locked||!r.review||r.elements?.nextOffset==null;
 $('research-capture').disabled=locked||active||!r.review||!r.config?.can_capture;
 $('research-reopen-pending').disabled=busy||!r.pending||active&&s.active!==r.pending.request.id;
 const terminal=r.pending&&(r.pending.phase==='NOT_STARTED'||r.pending.phase==='COMPLETE'||['FAILED','CANCELLED','INTERRUPTED'].includes(r.pending.phase));
 $('research-new-review').disabled=busy||!terminal||active&&s.active===r.pending?.request.id;
 const job=r.job,registered=job?.status==='COMPLETE'?job.result?.source:null;
 const current=registered&&s.data?.sources.find(value=>value.name===registered.name);
 $('research-map-source').disabled=busy||active||!registered||current?.revision!==registered.revision;
 $('research-resume-capture').disabled=busy||active||!job||!['INTERRUPTED','FAILED','CANCELLED'].includes(job.status)||r.pending&&r.pending.request.id!==job.id;
 $('research-cancel-capture').disabled=busy||job?.status!=='RUNNING';
 $('research-refresh-capture').disabled=busy||!job;
 $('research-more-captures').disabled=busy||!r.historyNext;
}
function renderDossiers(){
 const select=$('research-dossier'),old=select.value;select.replaceChildren();
 const blank=node('option',r.dossiers.length?'Choose a dossier':'Read dossiers from the selected connection');blank.value='';select.append(blank);
 for(const item of r.dossiers){const option=node('option',item.title+' · revision '+item.revision);option.value=item.id;select.append(option);}
 if(r.dossiers.some(value=>value.id===old))select.value=old;
 $('research-dossier-description').textContent=dossier()?.description??'';
}
function rowKey(row){return row.selection?JSON.stringify(canonical(row.selection)):'operation:'+row.operationId;}
function sourceRows(value,f){
 const rows=[];
 if(f==='documents'){
  for(const item of value.purchases??[])rows.push({selection:{purchaseId:item.id},
    label:item.profileId||item.intentId,status:[item.state,item.outputStatus,item.paymentStatus].filter(Boolean).join(' / '),
    identity:item.intentId||item.id});
  for(const item of value.editions??[])rows.push({selection:{editionId:item.id},
    label:item.label||item.document?.filename||'Retained document edition',status:'Retained edition',identity:item.id});
 }else{
  for(const item of value.operations??[]){
   const op=item.operation,outputs=op.outputs??[],label=item.plan.payload.request.label||item.plan.payload.profile.label||item.plan.id;
   if(!outputs.length)rows.push({selection:null,operationId:item.plan.id,label,status:op.phase+' / '+(op.providerStatus??'No observed provider status')+' / No retained output',identity:op.providerJobId||item.plan.id});
   for(const output of outputs)rows.push({selection:{operationId:item.plan.id,outputId:output.id},
    label:label+' · '+output.fileId+(output.nodeId?' · node '+output.nodeId:''),
    status:op.phase+' / '+(op.providerStatus??'No observed provider status')+' / '+output.bytes+' retained bytes',
    identity:output.sha256});
  }
  for(const item of value.editions??[])rows.push({selection:{editionId:item.id},label:item.label||'Retained Pipelines edition',
    status:'Retained edition · '+item.bytes+' bytes',identity:item.id});
 }
 return rows;
}
function renderSources(){
 const body=$('research-source-rows');body.replaceChildren();
 for(const item of r.rows){
  const row=node('tr');row.classList.toggle('selected',!!item.selection&&same(item.selection,r.selection));
  const selectCell=cell(row);
  if(item.selection){const radio=node('input');radio.type='radio';radio.name='research-source';radio.value=JSON.stringify(item.selection);radio.checked=same(item.selection,r.selection);
   radio.setAttribute('aria-label','Select '+item.label);radio.addEventListener('change',()=>{r.selection=structuredClone(item.selection);invalidate();renderSources();});
   selectCell.append(radio);
  }else selectCell.textContent='—';
  cell(row,item.label);cell(row,item.status);cell(row,item.identity);body.append(row);
 }
 if(!r.rows.length)empty(body,4,'Read saved sources from a dossier to choose a document or retained provider output.');
 controls();
}
function assertEnvelope(value,request){
 if(value.connection!==request.connection||value.workspace_id!==request.expected_workspace_id||
   request.dossier_id&&value.dossier_id!==request.dossier_id||request.family&&value.family!==request.family)throw Error('The Research response belongs to another reviewed selection.');
 return value.result;
}
async function loadDossiers(more=false){
 const request={...identity(),...(more?r.dossierNext:{offset:0,limit:20})},generation=++r.sequence;
 const result=assertEnvelope(await api('/api/research-dossiers',request),request);
 if(generation!==r.sequence)return;
 if(result.workspaceId!==request.expected_workspace_id||!Array.isArray(result.items))throw Error('The original dossier inventory identity changed.');
 const values=more?[...r.dossiers,...result.items]:result.items,unique=new Map(values.map(item=>[item.id,item]));
 r.dossiers=[...unique.values()];r.dossierNext=result.next;renderDossiers();
 if(!more){r.rows=[];r.selection=null;r.review=null;r.sourceNext=null;renderSources();renderReview();}
 localMessage(result.total+' dossiers in the original inventory. '+r.dossiers.length+' shown.');save();controls();
}
async function loadSources(more=false){
 const request={...base(),after:more?r.sourceNext:'',limit:20},generation=++r.sequence;
 const result=assertEnvelope(await api('/api/research-sources',request),request);
 if(generation!==r.sequence)return;
 const rows=sourceRows(result,request.family),values=more?[...r.rows,...rows]:rows;
 r.rows=[...new Map(values.map(item=>[rowKey(item),item])).values()];r.sourceNext=result.nextAfter;
 if(!r.rows.some(item=>item.selection&&same(item.selection,r.selection))){r.selection=null;r.review=null;renderReview();}
 renderSources();localMessage(r.rows.filter(item=>item.selection).length+' saved selections shown. '+(result.configured?'Original source connection is configured.':'Retained editions remain available in this dossier.'));
 save();controls();
}
function renderReview(){
 const review=r.review,box=$('research-review-facts');box.replaceChildren();
 $('research-review-panel').hidden=!review;
 if(!review){$('research-review-json').textContent='';$('research-elements').replaceChildren();return;}
 const value=review.value;
 fact(box,'Research workspace',review.request.expected_workspace_id);fact(box,'Dossier',review.request.dossier_id);
 fact(box,'Edition SHA-256',value.editionSha256);fact(box,'Saved in dossier',value.retained);
 if(review.request.family==='documents'){
  fact(box,'Document',value.document?.filename);fact(box,'Document bytes',value.document?.bytes);fact(box,'Original document SHA-256',value.document?.sha256);
  fact(box,'Native buyer state',value.native?.status??value.binding?.native?.status);
  fact(box,'Payment state',value.native?.sellerReportedSettlement??value.binding?.native?.sellerReportedSettlement);
  fact(box,'Response state',value.native?.responseStatus??value.binding?.native?.responseStatus);
 }else{
  fact(box,'Original file ID',value.output?.fileId);fact(box,'Output node',value.output?.nodeId);
  fact(box,'Retained output bytes',value.output?.bytes);fact(box,'Original output SHA-256',value.output?.sha256);
  fact(box,'Output format',value.format);fact(box,'Original items',value.itemCount);
 }
 $('research-review-json').textContent=JSON.stringify(value,null,2);revisionInfo();controls();
}
function revisionInfo(){
 const name=$('research-source-name').value.trim(),current=s.data?.sources.find(value=>value.name===name);
 $('research-source-revision').textContent=current?'This reviewed registration targets '+name+' at current revision '+current.revision+'. Prior source revisions and imported data remain retained.':'This name will create a new source registration at revision 1.';
}
async function review(){
 const request=selectedRequest(),generation=++r.sequence;
 const value=assertEnvelope(await api('/api/research-review',request),request);
 if(generation!==r.sequence)return;
 if(!/^[a-f0-9]{64}$/.test(value.editionSha256)||!same(value.selection,request.selection))throw Error('The reviewed edition does not match the selected original output.');
 r.review={request,value};r.elements=null;r.elementHistory=[];$('research-captured-at').value=new Date().toISOString();
 if(!$('research-source-name').value)$('research-source-name').value='document_elements';
 if(!$('research-source-title').value)$('research-source-title').value=(value.document?.filename||'Retained document elements').slice(0,160);
 renderReview();save();await readElements(0,false);localMessage('The exact saved edition is reviewed. Choose its Analysis source name and capture it when ready.');
}
async function readElements(offset=0,rememberPage=true){
 if(!r.review)return;
 const reviewed=r.review,request={...reviewed.request,expected_edition_sha256:reviewed.value.editionSha256,offset,limit:20,
  page:$('research-element-page').value,type:$('research-element-type').value,query:$('research-element-query').value};
 const value=assertEnvelope(await api('/api/research-elements',request),request);
 if(r.review!==reviewed)return;
 if(value.editionSha256!==reviewed.value.editionSha256)throw Error('The element page belongs to another edition.');
 if(rememberPage&&r.elements)r.elementHistory.push(r.elements.offset);
 r.elements=value;renderElements();controls();
}
function renderElements(){
 const value=r.elements,body=$('research-elements');body.replaceChildren();
 if(!value){$('research-element-info').textContent='';return;}
 $('research-element-info').textContent=value.total+' original occurrences; '+value.filtered+' match these filters. Showing '+value.items.length+' from offset '+value.offset+'. Capture retains the complete edition.';
 for(const entry of value.items){
  const item=entry.element??entry.item,article=node('article');article.dataset.researchOccurrence=String(entry.position);
  article.append(node('h3','Occurrence '+entry.position+' · '+(item.type??item.metadata?.pipeline?.type??'Content')));
  const content=item.text??(typeof item.content==='string'?item.content:JSON.stringify(item.content));
  const clipped=typeof content==='string'&&content.length>5000;
  article.append(node('p',(content??'').slice(0,5000)+(clipped?'\n[Display excerpt — complete text is retained in the source]':'')));
  const original=JSON.stringify(item,null,2),recordClipped=original.length>32000;
  const details=node('details');details.append(node('summary',recordClipped?'Original record — display excerpt':'Original metadata and record'),node('pre',original.slice(0,32000)+(recordClipped?'\n[Display excerpt — complete record and source bytes are retained by capture]':'')));article.append(details);body.append(article);
 }
 if(!value.items.length)body.append(node('p','No retained occurrences match these filters.','muted'));
}
function renderPending(){
 const pending=r.pending;$('research-pending-panel').hidden=!pending;if(!pending)return;
 $('research-pending-status').textContent=pending.phase+' · '+(pending.error||'The original request ID, edition and source revision are retained in this browser.');
 $('research-pending-request').textContent=JSON.stringify(pending.request,null,2);
 controls();
}
function matchesJob(job,request){return job.kind==='research-capture'&&job.id===request.id&&same(job.request,request);}
function accept(job,{focus=true}={}){
 if(job.kind!=='research-capture')throw Error('The selected job is not a Research capture.');
 if(r.pending?.request.id===job.id){
  if(!matchesJob(job,r.pending.request))throw Error('The saved capture request has different original inputs. Keep its ID for inspection.');
  r.pending.phase=job.status;r.pending.error=job.error;
  if(job.status==='COMPLETE')r.pending=null;
 }
 if(focus||r.job?.id===job.id||!r.job){r.job=job;r.savedJobId=job.id;}
 if(job.status!=='RUNNING'&&s.active===job.id){s.active=null;clearTimeout(s.poll);}
 if(focus){s.focusJob=job.id;if(job.status==='RUNNING'){s.active=job.id;schedulePoll();}tab('research');}
 save();renderPending();renderCapture();controls();
}
async function savedJob(request){
 try{const job=await api('/api/jobs/'+request.id);if(!matchesJob(job,request))throw Error('The capture ID is already bound to different inputs.');return job;}
 catch(error){if(error.message==='ANALYSIS_JOB_NOT_FOUND')return null;throw error;}
}
async function submitPending(){
 const pending=r.pending;if(!pending)return;
 let job=await savedJob(pending.request);
 if(job&&job.status==='COMPLETE'){accept(job);await refresh();return;}
 if(job&&job.status==='RUNNING'){accept(job);return;}
 // Interrupted/failed captures are source-only and resume through the original
 // job API with the same full request. New requests are published by that API.
 pending.phase='SUBMITTING';pending.error=null;
 try{save(true);}catch(error){pending.phase=job?.status??'NOT_STARTED';pending.error=error.message;renderPending();throw error;}
 renderPending();
 try{
  job=await api('/api/start/research-capture',pending.request);
  if(r.pending!==pending)return;
  if(!matchesJob(job,pending.request))throw Error('The returned capture differs from its retained request.');
  accept(job);if(job.status!=='RUNNING')await refresh();
 }catch(error){
  if(r.pending!==pending)throw error;
  pending.phase='RESPONSE_UNCERTAIN';pending.error=error.message;save();renderPending();
  const observed=await savedJob(pending.request).catch(()=>null);
  if(observed){accept(observed);return;}
  // Only a completed native pre-admission rejection plus the absent original
  // ID proves that no job was accepted. Network loss keeps the exact request.
  if(error.status>=400&&error.status<500&&error.message!=='ANALYSIS_REQUEST_ID_REUSED'){
   const absent=await savedJob(pending.request);
   if(absent===null){pending.phase='NOT_STARTED';save();renderPending();await refresh();}
  }
  throw error;
 }
}
async function capture(){
 if(!r.review||r.pending)throw Error('Review an edition or reopen the retained capture first.');
 const name=$('research-source-name').value.trim(),title=$('research-source-title').value;
 if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)||!title.trim()||title.length>160||/[\x00-\x1f\x7f]/.test(title))throw Error('Use an Analysis source name and a title of at most 160 characters without control characters.');
 if(!same(r.review.request,selectedRequest()))throw Error('Review the current selected edition again.');
 const current=s.data.sources.find(value=>value.name===name);
 const request={id:id(),...r.review.request,expected_edition_sha256:r.review.value.editionSha256,
  name,expected_revision:current?.revision??0,title,captured_at:$('research-captured-at').value};
 r.pending={request,phase:'PREPARED',error:null};
 try{save(true);}catch(error){r.pending.phase='NOT_STARTED';r.pending.error=error.message;renderPending();throw error;}
 renderPending();await submitPending();
}
function renderCapture(){
 const job=r.job;$('research-capture-panel').hidden=!job;if(!job)return;
 $('research-capture-heading').textContent='Capture · '+job.status;
 const box=$('research-capture-facts');box.replaceChildren();
 fact(box,'Original Analysis job',job.id);fact(box,'Source',job.request.name);fact(box,'Research workspace',job.request.expected_workspace_id);
 fact(box,'Reviewed edition',job.request.expected_edition_sha256);fact(box,'Local stage',job.progress?.phase??job.status);
 if(job.result){
  fact(box,'Registered source revision',job.result.source.revision);fact(box,'Source document ID',job.result.document_id);
  fact(box,'Every retained occurrence',job.result.receipt.rowCount);fact(box,'Original files',job.result.verification.files);
  fact(box,'Verified bytes',job.result.verification.bytes);fact(box,'Source scope complete',job.result.verification.complete);
 }
 const registered=job.result?.source,current=registered&&s.data?.sources.find(value=>value.name===registered.name);
 $('research-capture-state').textContent=job.status==='COMPLETE'?'The complete source is registered in this workspace.':job.status==='RUNNING'?'The original capture is '+(job.progress?.phase??'RUNNING')+'.':job.status+': '+(job.error??'Read the retained request before continuing.');
 $('research-capture-json').textContent=JSON.stringify(job,null,2);
 $('research-capture-help').textContent=registered&&current?.revision!==registered.revision?
  'This capture retains source revision '+registered.revision+'. The source currently selects a different revision; its existing imported versions and original capture remain available in Data and Activity.':
  job.status==='COMPLETE'?'Open the source in response mapping to review all projected records, import an immutable table and use its current SQL view. Full query exports, workbooks and workspace backups retain the original source evidence.':
  'Reopen or continue this exact Analysis job after an interruption. Cancellation stops the local capture; saved Research documents and provider jobs keep their original state.';
 controls();
}
function renderHistory(){
 const body=$('research-captures');body.replaceChildren();
 for(const job of r.history){const row=node('tr');cell(row,stamp(job.created_at));cell(row,job.request.name);cell(row,job.status+(job.error?' · '+job.error:''));const digest=cell(row,short(job.request.expected_edition_sha256));digest.title=job.request.expected_edition_sha256;cell(row).append(button('Open',()=>openById(job.id)));body.append(row);}
 if(!r.history.length)empty(body,5,'No Research capture has been started in this Analysis workspace.');controls();
}
async function loadHistory(more=false){
 const value=await api('/api/research-captures?limit=20'+(more&&r.historyNext?'&before='+r.historyNext:''));
 r.history=more?[...r.history,...value.captures]:value.captures;r.historyNext=value.next_before;renderHistory();
}
async function openById(jobId){
 const sequence=++r.sequence,job=await api('/api/jobs/'+jobId);if(sequence!==r.sequence)return;accept(job);
}
async function open(job){accept(job);tab('research');}
function progress(job){if(job.kind==='research-capture'&&(r.job?.id===job.id||r.pending?.request.id===job.id||s.focusJob===job.id))accept(job,{focus:false});}
function settled(job){if(job.kind==='research-capture')progress(job);}
async function refreshIntake(){
 try{
  const config=await api('/api/research-connections'),old=$('research-connection').value;r.config=config;
  const select=$('research-connection');select.replaceChildren();
  for(const item of config.connections){const option=node('option',item.label+' · '+short(item.workspace_id));option.value=item.name;select.append(option);}
  if(!config.connections.length){const option=node('option','No Research connection configured');option.value='';select.append(option);}
  if(config.connections.some(value=>value.name===old))select.value=old;
  $('research-config-note').textContent=config.can_capture?'Read saved sources through a named original Research connection. Captured sources remain inside this Analysis workspace.':config.configured?'Start this Analysis workspace with its matching --checkout to receive a Research edition. Previously captured sources remain usable.':'The local operator can configure a Research connection. Previously captured sources and their full document evidence remain usable without one.';
  if(!r.loaded){
   r.loaded=true;let saved;try{saved=JSON.parse(localStorage.getItem(key()));}catch{}
   if(saved){if(config.connections.some(value=>value.name===saved.connection))select.value=saved.connection;
    if(['documents','pipelines'].includes(saved.family))$('research-family').value=saved.family;
    $('research-source-name').value=typeof saved.source_name==='string'?saved.source_name:'';
    $('research-source-title').value=typeof saved.title==='string'?saved.title:'';
    if(saved.pending?.request&&/^[a-f0-9]{32}$/.test(saved.pending.request.id??''))r.pending=saved.pending;
    if(/^[a-f0-9]{32}$/.test(saved.job_id??''))r.savedJobId=saved.job_id;
   }
  }
  await loadHistory();
  if(r.pending){const job=await savedJob(r.pending.request);if(job)accept(job,{focus:false});}
  if(!r.job&&r.savedJobId){const job=await api('/api/jobs/'+r.savedJobId);if(job.kind==='research-capture')accept(job,{focus:false});}
  renderPending();renderCapture();revisionInfo();controls();
 }catch(error){localMessage(error.message,true);controls();}
}
$('research-connection').addEventListener('change',()=>invalidate({dossiers:true}));
$('research-dossier').addEventListener('change',()=>{$('research-dossier-description').textContent=dossier()?.description??'';invalidate({sources:true});});
$('research-family').addEventListener('change',()=>invalidate({sources:true}));
$('research-load-dossiers').addEventListener('click',()=>act(()=>loadDossiers()));
$('research-more-dossiers').addEventListener('click',()=>act(()=>loadDossiers(true)));
$('research-load-sources').addEventListener('click',()=>act(()=>loadSources()));
$('research-more-sources').addEventListener('click',()=>act(()=>loadSources(true)));
$('research-review').addEventListener('click',()=>act(review));
$('research-read-elements').addEventListener('click',()=>act(async()=>{r.elementHistory=[];await readElements(0,false);}));
$('research-elements-next').addEventListener('click',()=>act(()=>readElements(r.elements.nextOffset)));
$('research-elements-prev').addEventListener('click',()=>act(async()=>{const prior=r.elementHistory.at(-1);await readElements(prior,false);r.elementHistory.pop();controls();}));
for(const name of ['research-source-name','research-source-title'])$(name).addEventListener('input',()=>{revisionInfo();save();});
$('research-capture').addEventListener('click',()=>act(capture));
$('research-reopen-pending').addEventListener('click',()=>act(submitPending));
$('research-new-review').addEventListener('click',()=>act(async()=>{r.pending=null;r.review=null;save();renderPending();renderReview();localMessage('The original capture remains in Activity. Read and review the next exact source selection.');}));
$('research-resume-capture').addEventListener('click',()=>act(async()=>{
 if(!r.job||!['FAILED','CANCELLED','INTERRUPTED'].includes(r.job.status))return;
 if(r.pending&&r.pending.request.id!==r.job.id)throw Error('Reopen the other retained capture request first.');
 r.pending={request:structuredClone(r.job.request),phase:r.job.status,error:r.job.error};save(true);await submitPending();
}));
$('research-cancel-capture').addEventListener('click',()=>act(async()=>{const job=r.job;if(!job)return;const result=await api('/api/research-captures/'+job.id+'/cancel',{});if(r.job?.id===job.id)accept(result);}));
$('research-refresh-capture').addEventListener('click',()=>act(()=>openById(r.job.id)));
$('research-more-captures').addEventListener('click',()=>act(()=>loadHistory(true)));
$('research-map-source').addEventListener('click',()=>act(async()=>{
 const job=r.job;if(job?.status!=='COMPLETE')return;
 await refresh();await window.responseTables.openSource({name:job.result.source.name,revision:job.result.source.revision,mapping:job.result.mapping});
 message('Original source mapping loaded. Review every projected record before importing.');
}));
window.researchIntake={controls,refresh:refreshIntake,open,progress,settled};
})();
'''

const SCHEMA='stellar-forge.merchant-commercial-desk.v1';
const TAB_NAMES=[['overview','Overview'],['quote','Quote editor'],['review','Review'],['editions','Quote editions'],['customer','Customer response'],['export','Export and reopen']];
const money=value=>value===null||value===undefined||value===''?'—':'USD '+String(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=value=>JSON.parse(JSON.stringify(value));
const uuid=()=>crypto.randomUUID();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const emptyDraft=()=>({parentId:null,title:'',customer:{name:'',contact:''},currency:'USD',implementationSourceId:'',serviceSourceId:'',pricingSourceId:'',validThrough:'',implementation:{lines:[]},service:{period:'MONTH',lines:[]},pricing:{routes:[]},terms:{scope:'',deliverables:'',exclusions:'',payment:'',acceptance:''},notes:''});
function requireService(services,name){if(typeof services[name]!=='function')throw new Error('Commercial desk service is missing: '+name);return services[name];}
export function mountCommercialDesk({root,services}){
  if(!root||!services)throw new TypeError('root and services are required.');
  for(const name of ['read','preview','saveDraft','publish','compare','receive','receivePricing','download'])requireService(services,name);
  let epoch=0,connected=false,view=null,scope=null,tab='overview',draft=emptyDraft(),dirty=false,editSerial=0;
  let review=null,selectedQuoteId='',comparison=null,selectedBefore='',pending=null,busy=false,message='',error='',destroyed=false;
  let restoredScope=null,responseDraft={status:'ACCEPTED',observedAt:'',source:'',note:''};
  const listeners=[];
  const ownsUrl=new Set();
  const key=identity=>SCHEMA+':'+identity.workspaceId+':'+identity.caseId;
  const identity=record=>{const value=record?.scope;if(!value||typeof value.caseId!=='string'||typeof value.workspaceId!=='string'||!value.caseId||!value.workspaceId)throw new Error('The original case identity is missing.');return {caseId:value.caseId,workspaceId:value.workspaceId};};
  function storageRead(which){try{return JSON.parse(sessionStorage.getItem(key(which))||'null');}catch{return null;}}
  function storageWrite(){
    if(!scope)return;
    const retainedPending=pending?{...pending,args:{...pending.args}}:null;
    if(retainedPending?.action==='receivePricing')delete retainedPending.args.sourceText;
    const value={schema:SCHEMA,scope,draft,dirty,selectedQuoteId,tab,pending:retainedPending,responseDraft};
    try{sessionStorage.setItem(key(scope),JSON.stringify(value));}catch{}
  }
  function forget(which){if(which)try{sessionStorage.removeItem(key(which));}catch{}}
  function resetRuntime({forgetSaved=false}={}){
    epoch++;connected=false;view=null;review=null;comparison=null;busy=false;message='';error='';
    for(const url of ownsUrl)URL.revokeObjectURL(url);ownsUrl.clear();
    if(forgetSaved){forget(scope);scope=null;restoredScope=null;draft=emptyDraft();dirty=false;selectedQuoteId='';pending=null;responseDraft={status:'ACCEPTED',observedAt:'',source:'',note:''};editSerial++;}
  }
  const currentQuote=()=>view?.quotes?.find(row=>row.id===selectedQuoteId)||null;
  const sourceById=(kind,id)=>(view?.[kind]||[]).find(row=>row.id===id)||null;
  function field(id,label,value,type='text',extra=''){return '<label class="cq-field" for="'+id+'"><span>'+esc(label)+'</span><input id="'+id+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';}
  function area(id,label,value,rows=4){return '<label class="cq-field" for="'+id+'"><span>'+esc(label)+'</span><textarea id="'+id+'" rows="'+rows+'">'+esc(value)+'</textarea></label>';}
  function options(rows,value,placeholder){return '<option value="">'+esc(placeholder)+'</option>'+rows.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===value?' selected':'')+'>'+esc(row.title||row.id)+'</option>').join('');}
  function sourceSelect(id,label,kind,value,optional=false){return '<label class="cq-field" for="'+id+'"><span>'+esc(label)+'</span><select id="'+id+'">'+options(view?.[kind]||[],value,optional?'No recurring service selected':'Select a saved source')+'</select></label>';}
  function sourceCard(label,row){return '<section class="cq-source"><h4>'+esc(label)+'</h4>'+(row?'<strong>'+esc(row.title||row.id)+'</strong><p>'+esc(row.summary||'')+'</p><dl><dt>Original identity</dt><dd><code>'+esc(row.id)+'</code></dd><dt>SHA-256</dt><dd><code>'+esc(row.sha256||row.reviewSha256||'')+'</code></dd>'+(row.version?'<dt>Saved version</dt><dd><code>'+esc(row.version)+'</code></dd>':'')+'</dl>':'<p class="cq-muted">Select the original saved source in the quote editor.</p>')+'</section>';}
  function totals(value){
    const totals=value?.totals||{};
    return '<dl class="cq-totals"><div><dt>Implementation</dt><dd>'+money(totals.implementationUsd)+'</dd></div><div><dt>Service / month</dt><dd>'+money(totals.recurringServiceUsd)+'</dd></div><div><dt>Route usage / month</dt><dd>'+money(totals.routeUsageUsd)+'</dd></div><div><dt>Recurring total / month</dt><dd>'+money(totals.recurringUsd)+'</dd></div></dl>';
  }
  function issueList(issues){return (issues||[]).length?'<ul class="cq-issues">'+issues.map(issue=>'<li><strong>'+esc(issue.code)+'</strong> '+esc(issue.message)+(issue.path?' <code>'+esc(issue.path)+'</code>':'')+'</li>').join('')+'</ul>':'<p>Original pricing and source review is complete.</p>';}
  function lineTable(kind){
    const implementation=kind==='implementation',lines=draft[kind].lines;
    const quantities=implementation?['Quoted hours','hours','USD / hour','rateUsd']:['Units / month','quantity','USD / unit','unitUsd'];
    return '<div class="cq-table-wrap"><table><thead><tr><th>Quoted work</th><th>'+quantities[0]+'</th><th>'+quantities[2]+'</th><th>Original source</th><th><span class="cq-sr">Remove</span></th></tr></thead><tbody>'+
      lines.map((line,index)=>'<tr data-kind="'+kind+'" data-line="'+index+'"><td><input data-line-field="title" aria-label="Quoted work '+(index+1)+'" value="'+esc(line.title)+'"></td><td><input data-line-field="'+quantities[1]+'" inputmode="decimal" aria-label="'+quantities[0]+' '+(index+1)+'" value="'+esc(line[quantities[1]])+'"></td><td><input data-line-field="'+quantities[3]+'" inputmode="decimal" aria-label="'+quantities[2]+' '+(index+1)+'" value="'+esc(line[quantities[3]])+'"></td><td><code>'+esc(line.taskId||line.commitmentId||'Custom quoted work')+'</code></td><td><button type="button" class="cq-quiet" data-remove-line="'+index+'" data-kind="'+kind+'" aria-label="Remove quoted line '+(index+1)+'">Remove</button></td></tr>').join('')+
      (lines.length?'':'<tr><td colspan="5">No quoted lines yet. Choose original work or add an explicit line.</td></tr>')+'</tbody></table></div>';
  }
  function renderOverview(){
    const saved=view?.quotes||[];
    return '<div class="cq-section-heading"><div><h3>Implementation and service quotations</h3><p>Prepare a customer quotation from the original implementation work, service commitments and saved pricing scenario.</p></div><button type="button" data-action="edit">Open quote editor</button></div>'+
      '<div class="cq-summary"><div><span>Saved quote editions</span><strong>'+saved.length+'</strong></div><div><span>Draft</span><strong>'+esc(dirty?'Unsaved changes':view?.draft?'Saved':'New')+'</strong></div><div><span>Selected edition</span><strong>'+esc(currentQuote()?.title||'None')+'</strong></div></div>'+
      '<div class="cq-source-grid">'+sourceCard('Implementation work',sourceById('implementationSources',draft.implementationSourceId))+sourceCard('Service commitments',sourceById('serviceSources',draft.serviceSourceId))+sourceCard('Pricing scenario',sourceById('pricingSources',draft.pricingSourceId))+'</div>'+
      '<section class="cq-source"><h4>Receive a saved pricing scenario</h4><p>Choose the complete selected-source file exported from the original Merchant pricing workspace. It retains the saved scenario, seller, terms and original observation. Reopening a pending import requires this same file.</p><label class="cq-field" for="cq-pricing-source-file"><span>Original pricing source JSON</span><input id="cq-pricing-source-file" type="file" accept=".json,application/json"></label><button type="button" data-action="receive-pricing"'+(busy?' disabled':'')+'>Receive original pricing source</button></section>'+
      '<section><h4>How to complete a quote</h4><ol class="cq-steps"><li>Select the original source editions and enter the quoted work, rates, volumes and terms.</li><li>Save the draft, then review the original pricing output and every source binding.</li><li>Save a quote edition. Record the customer’s response against that exact edition.</li><li>Download the customer quote and the full original case handoff for receiving and reopening.</li></ol></section>';
  }
  function renderEditor(){
    const routes=draft.pricing.routes;
    return '<div class="cq-section-heading"><div><h3>Quote editor</h3><p>Amounts and quantities remain exact decimal text until the original pricing engine reviews them.</p></div><div class="cq-actions"><button type="button" data-action="save-draft"'+(busy?' disabled':'')+'>Save draft</button><button type="button" data-action="preview"'+(busy?' disabled':'')+'>Review quote</button></div></div>'+
      '<div class="cq-grid">'+field('cq-title','Quote title',draft.title)+field('cq-customer','Customer',draft.customer.name)+field('cq-contact','Customer contact',draft.customer.contact)+field('cq-valid-through','Valid through',draft.validThrough,'date')+'</div>'+
      '<div class="cq-grid cq-three">'+sourceSelect('cq-implementation-source','Implementation edition','implementationSources',draft.implementationSourceId)+sourceSelect('cq-service-source','Service commitments','serviceSources',draft.serviceSourceId,true)+sourceSelect('cq-pricing-source','Saved pricing scenario','pricingSources',draft.pricingSourceId)+'</div>'+
      '<section class="cq-editor-section"><div class="cq-section-heading"><h4>Implementation work</h4><div class="cq-actions"><button type="button" data-action="add-tasks">Add original tasks</button><button type="button" data-action="add-implementation">Add quoted line</button></div></div>'+lineTable('implementation')+'</section>'+
      '<section class="cq-editor-section"><div class="cq-section-heading"><h4>Recurring service</h4><div class="cq-actions"><button type="button" data-action="add-commitments">Add service commitments</button><button type="button" data-action="add-service">Add service line</button></div></div>'+lineTable('service')+'</section>'+
      '<section class="cq-editor-section"><div class="cq-section-heading"><h4>Route usage</h4><button type="button" data-action="use-routes">Use saved scenario routes</button></div><p>Monthly request volumes refer to the selected original scenario. The review retains its service quote, units and valuation basis.</p><div class="cq-table-wrap"><table><thead><tr><th>Original route</th><th>Requests / month</th></tr></thead><tbody>'+routes.map((row,index)=>'<tr><td><code>'+esc(row.routeId)+'</code></td><td><input data-route="'+index+'" inputmode="numeric" aria-label="Monthly requests for '+esc(row.routeId)+'" value="'+esc(row.monthlyRequests)+'"></td></tr>').join('')+(routes.length?'':'<tr><td colspan="2">Select a saved scenario, then choose its routes.</td></tr>')+'</tbody></table></div></section>'+
      '<div class="cq-grid">'+area('cq-scope','Scope',draft.terms.scope)+area('cq-deliverables','Deliverables',draft.terms.deliverables)+area('cq-exclusions','Customer responsibilities and exclusions',draft.terms.exclusions)+area('cq-payment','Payment terms',draft.terms.payment)+area('cq-acceptance','Receiving and acceptance',draft.terms.acceptance)+area('cq-notes','Internal preparation notes',draft.notes)+'</div>';
  }
  function renderReview(){
    if(!review)return '<h3>Review quote</h3><p>Review the current draft against its original implementation, service and pricing sources.</p><button type="button" data-action="preview"'+(busy?' disabled':'')+'>Review current draft</button>';
    return '<div class="cq-section-heading"><div><h3>Original source and pricing review</h3><p>The saved quote will retain this exact review and its source editions.</p></div><button type="button" data-action="publish"'+(busy||(review.issues||[]).some(x=>x.severity!=='info')?' disabled':'')+'>Save quote edition</button></div>'+totals(review)+issueList(review.issues)+
      '<dl><dt>Review SHA-256</dt><dd><code>'+esc(review.reviewSha256)+'</code></dd><dt>Draft SHA-256</dt><dd><code>'+esc(review.draftSha256)+'</code></dd></dl>'+
      '<h4>Quoted lines</h4>'+renderQuotedLines(review.lines)+
      '<h4>Original source bindings</h4><pre class="cq-json">'+esc(JSON.stringify(review.sourceBindings,null,2))+'</pre>'+
      '<details><summary>Customer quotation</summary><pre class="cq-document">'+esc(review.customerDocument||'')+'</pre></details>';
  }
  function renderQuotedLines(lines=[]){return '<div class="cq-table-wrap"><table><thead><tr><th>Work / route</th><th>Basis</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>'+lines.map(line=>'<tr><td>'+esc(line.title||line.routeId||line.id)+'</td><td>'+esc(line.kind||line.basis||'')+'</td><td>'+esc(line.quantity??line.hours??'')+'</td><td>'+money(line.unitUsd??line.rateUsd)+'</td><td>'+money(line.amountUsd)+'</td></tr>').join('')+'</tbody></table></div>';}
  function quoteSelect(id,label,value){return '<label class="cq-field" for="'+id+'"><span>'+esc(label)+'</span><select id="'+id+'">'+options(view?.quotes||[],value,'Choose an original quote edition')+'</select></label>';}
  function renderEditions(){
    const quote=currentQuote();
    return '<div class="cq-section-heading"><h3>Quote editions</h3><button type="button" data-action="refresh">Refresh original case</button></div>'+
      '<div class="cq-grid">'+quoteSelect('cq-selected-quote','Quote edition',selectedQuoteId)+quoteSelect('cq-before-quote','Compare with',selectedBefore)+'</div><div class="cq-actions"><button type="button" data-action="revise"'+(!quote?' disabled':'')+'>Prepare revision from selected quote</button><button type="button" data-action="compare"'+(!quote||!selectedBefore?' disabled':'')+'>Compare editions</button></div>'+
      (quote?'<h4>'+esc(quote.title)+'</h4>'+totals(quote)+'<dl><dt>Edition</dt><dd><code>'+esc(quote.id)+'</code></dd><dt>Saved</dt><dd>'+esc(quote.createdAt)+'</dd><dt>Quote SHA-256</dt><dd><code>'+esc(quote.sha256)+'</code></dd><dt>Previous edition</dt><dd><code>'+esc(quote.parentId||'—')+'</code></dd></dl>':'<p>No quote is selected.</p>')+
      (comparison?'<section><h4>Original edition comparison</h4><pre class="cq-document">'+esc(comparison.text||JSON.stringify(comparison,null,2))+'</pre></section>':'');
  }
  function renderCustomer(){
    const quote=currentQuote();
    return '<h3>Customer response</h3><p>Record the response to one exact saved quotation, with its original source and observation time.</p>'+quoteSelect('cq-response-quote','Quoted edition',selectedQuoteId)+
      (quote?'<div class="cq-customer-record"><h4>'+esc(quote.title)+'</h4><code>'+esc(quote.sha256)+'</code>'+totals(quote)+'</div>':'')+
      '<form data-form="customer"><div class="cq-grid"><label class="cq-field" for="cq-response-status"><span>Response</span><select id="cq-response-status">'+[['ACCEPTED','Accepted'],['REVISION_REQUESTED','Revision requested'],['DECLINED','Declined']].map(([value,label])=>'<option value="'+value+'"'+(responseDraft.status===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+field('cq-response-time','Observed at (UTC)',responseDraft.observedAt, 'datetime-local')+field('cq-response-source','Original message or document reference',responseDraft.source)+'</div>'+area('cq-response-note','Customer response and agreed changes',responseDraft.note)+'<button type="submit"'+(!quote||busy?' disabled':'')+'>Record response to this edition</button></form>'+
      '<h4>Retained responses</h4>'+((quote?.receiving||[]).length?'<ol class="cq-responses">'+quote.receiving.map(row=>'<li><strong>'+esc(row.status)+'</strong><span>'+esc(row.observedAt)+'</span><p>'+esc(row.note)+'</p><code>'+esc(row.source)+'</code></li>').join('')+'</ol>':'<p>No customer response is recorded for the selected edition.</p>');
  }
  function renderExport(){
    const quote=currentQuote();
    return '<h3>Export and reopen</h3>'+quoteSelect('cq-export-quote','Quote edition',selectedQuoteId)+
      (quote?'<h4>'+esc(quote.title)+'</h4>'+totals(quote)+'<div class="cq-actions"><button type="button" data-action="download-quote">Download customer quotation</button><button type="button" data-action="download-handoff">Download complete case handoff</button></div><p>The complete handoff carries this quote, its original source bindings, saved draft and customer responses through the existing case Save / Open workflow.</p><details><summary>Customer quotation text</summary><pre class="cq-document">'+esc(quote.customerDocument||'')+'</pre></details>':'<p>Save and select a quote edition to download it.</p>');
  }
  function render(){
    if(destroyed)return;
    const renderers={overview:renderOverview,quote:renderEditor,review:renderReview,editions:renderEditions,customer:renderCustomer,export:renderExport};
    root.innerHTML='<section class="commercial-desk" aria-label="Implementation and service quotations"><header class="cq-header"><div><h2>Commercial quotation</h2><p>'+esc(connected&&scope?'Case '+scope.caseId:'Open an original merchant case to begin.')+'</p></div><span class="cq-state">'+esc(busy?'Working':connected?'Connected':'Reopen case')+'</span></header>'+
      '<div class="cq-status" role="status">'+(message?'<p>'+esc(message)+'</p>':'')+(error?'<p role="alert">'+esc(error)+'</p>':'')+
      (pending&&connected?'<div class="cq-pending"><strong>Retained '+esc(pending.action)+' request</strong><code>'+esc(pending.requestId)+'</code><p>Reopen the original case or retry this exact request to recover its retained result.</p><button type="button" data-action="retry"'+(busy?' disabled':'')+'>Retry exact request</button><button type="button" data-action="refresh"'+(busy?' disabled':'')+'>Reopen original case</button></div>':'')+'</div>'+
      '<nav class="cq-tabs" aria-label="Quotation sections">'+TAB_NAMES.map(([name,label])=>'<button type="button" data-tab="'+name+'" aria-current="'+(name===tab?'page':'false')+'">'+esc(label)+'</button>').join('')+'</nav>'+
      '<main class="cq-main">'+(connected?renderers[tab]():'<p>Connect to the original case to review its saved implementation, service and pricing sources.</p><button type="button" data-action="refresh">Reopen original case</button>')+'</main></section>';
  }
  function change(mutator){mutator();dirty=true;editSerial++;review=null;comparison=null;storageWrite();}
  function setDraft(next,{saved=false}={}){draft=Object.assign(emptyDraft(),clone(next));draft.customer={name:'',contact:'',...draft.customer};draft.implementation={lines:[],...draft.implementation};draft.service={period:'MONTH',lines:[],...draft.service};draft.pricing={routes:[],...draft.pricing};draft.terms={scope:'',deliverables:'',exclusions:'',payment:'',acceptance:'',...draft.terms};dirty=!saved;review=null;editSerial++;storageWrite();}
  function consume(record,{acceptDraft=false,originalEditSerial=editSerial}={}){
    const received=identity(record);
    if(scope&&!same(scope,received)){
      storageWrite();const workspaceChanged=scope.workspaceId!==received.workspaceId;
      resetRuntime({forgetSaved:workspaceChanged});
      if(!workspaceChanged){scope=null;restoredScope=null;draft=emptyDraft();dirty=false;selectedQuoteId='';pending=null;responseDraft={status:'ACCEPTED',observedAt:'',source:'',note:''};editSerial++;}
    }
    scope=received;view=record;connected=true;
    if(!same(restoredScope,scope)){
      restoredScope=clone(scope);const saved=storageRead(scope);
      if(saved?.schema===SCHEMA&&same(saved.scope,scope)){draft=saved.draft||emptyDraft();dirty=Boolean(saved.dirty);selectedQuoteId=saved.selectedQuoteId||'';pending=saved.pending||null;responseDraft=saved.responseDraft||responseDraft;tab=TAB_NAMES.some(([name])=>name===saved.tab)?saved.tab:'overview';}
      else setDraft(record.draft||emptyDraft(),{saved:true});
    }else if(acceptDraft&&editSerial===originalEditSerial)setDraft(record.draft||draft,{saved:true});
    if(selectedQuoteId&&!record.quotes?.some(quote=>quote.id===selectedQuoteId))selectedQuoteId='';
    if(!selectedQuoteId&&record.quotes?.length)selectedQuoteId=record.quotes[0].id;
    if(pending&&record.requests?.some(row=>row.requestId===pending.requestId&&row.state==='COMPLETE')){message='Original request result reopened.';pending=null;}
    storageWrite();
  }
  async function refresh(){
    const token=epoch;try{const record=await services.read();if(destroyed||token!==epoch)return;consume(record);error='';render();}catch(err){if(token!==epoch||destroyed)return;connected=false;error=String(err.message||err);render();}
  }
  async function invoke(action,args,{mutation=false,onResult}={}){
    if(busy)throw new Error('The current original request is still awaiting its result.');
    if(!scope||!connected)throw new Error('Reopen the original case first.');
    const token=epoch,selectedScope=clone(scope),serial=editSerial;
    const request=mutation?{action,requestId:uuid(),scope:selectedScope,expectedRevision:view.revision,args:clone(args)}:null;
    if(mutation){if(pending)throw new Error('Recover the retained original request before starting another mutation.');pending=request;storageWrite();}
    busy=true;error='';message='';render();
    try{
      const result=await services[action](mutation?{...request.args,scope:request.scope,expectedRevision:request.expectedRevision,requestId:request.requestId}:{...args,scope:selectedScope,expectedRevision:view.revision});
      if(token!==epoch||destroyed)return;
      if(!same(selectedScope,scope))return;
      if(mutation){pending=null;storageWrite();}
      if(result?.view){if(!same(identity(result.view),selectedScope)){resetRuntime({forgetSaved:true});render();throw new Error('The original response belongs to another case.');}consume(result.view,{acceptDraft:action==='saveDraft',originalEditSerial:serial});}
      if(onResult)onResult(result,serial);
      message=mutation?'Original case updated.':'Original review loaded.';
    }catch(err){if(token!==epoch||destroyed)return;if(err.requestState==='REJECTED')pending=null;error=String(err.message||err);}finally{if(token===epoch&&!destroyed){busy=false;storageWrite();render();}}
  }
  async function retry(){
    if(!pending||busy)return;
    if(pending.action==='receivePricing'&&typeof pending.args.sourceText!=='string')throw new Error('Choose the same original pricing source file to continue this request.');
    const request=clone(pending),token=epoch;
    if(!same(request.scope,scope))throw new Error('The retained request belongs to another original case.');
    busy=true;error='';render();
    try{const result=await services[request.action]({...request.args,scope:request.scope,expectedRevision:request.expectedRevision,requestId:request.requestId});if(token!==epoch||destroyed)return;if(result?.view){if(!same(identity(result.view),request.scope)){resetRuntime({forgetSaved:true});render();throw new Error('The original response belongs to another case.');}consume(result.view,{acceptDraft:request.action==='saveDraft'&&same(draft,request.args.draft),originalEditSerial:editSerial});}pending=null;message='The exact original request is complete.';if(result?.quote)selectedQuoteId=result.quote.id;}catch(err){if(token===epoch){if(err.requestState==='REJECTED')pending=null;error=String(err.message||err);}}finally{if(token===epoch&&!destroyed){busy=false;storageWrite();render();}}
  }
  async function download(kind){
    const quote=currentQuote();if(!quote)throw new Error('Choose a saved quote edition.');
    const token=epoch,selectedScope=clone(scope);
    const result=await services.download({scope:selectedScope,quoteId:quote.id,quoteSha256:quote.sha256,kind});
    if(token!==epoch||destroyed)return;
    const descriptor=result.descriptor;
    if(!descriptor||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<0||!/^[a-f0-9]{64}$/.test(descriptor.sha256)||typeof descriptor.filename!=='string'||/[\\/\0]/.test(descriptor.filename))throw new Error('The original download descriptor is incomplete.');
    const response=result.response;
    if(!response?.ok)throw new Error('The original download did not complete.');
    const blob=await response.blob();
    if(blob.size!==descriptor.bytes||await digest(await blob.arrayBuffer())!==descriptor.sha256)throw new Error('The complete download differs from its original descriptor.');
    if(token!==epoch||destroyed)return;
    const url=URL.createObjectURL(blob);ownsUrl.add(url);
    const a=document.createElement('a');a.href=url;a.download=descriptor.filename;a.click();
    setTimeout(()=>{URL.revokeObjectURL(url);ownsUrl.delete(url);},1000);
    message='Downloaded '+descriptor.filename+' with its original length and SHA-256.';render();
  }
  function appendOriginalLines(kind){
    const implementation=kind==='implementation';
    const source=sourceById(implementation?'implementationSources':'serviceSources',implementation?draft.implementationSourceId:draft.serviceSourceId);
    if(!source)throw new Error('Choose the original '+(implementation?'implementation edition':'service commitments')+' first.');
    const originals=source.rows||[];
    if(!originals.length)throw new Error('The selected source has no quotable original work.');
    change(()=>{const existing=new Set(draft[kind].lines.map(row=>row.taskId||row.commitmentId));for(const row of originals)if(!existing.has(row.id)){draft[kind].lines.push(implementation?{id:uuid(),taskId:row.id,title:row.title,hours:'',rateUsd:''}:{id:uuid(),commitmentId:row.id,title:row.title,quantity:'',unitUsd:''});}});
    render();
  }
  async function action(name){
    if(name==='receive-pricing'){
      const file=root.querySelector('#cq-pricing-source-file')?.files?.[0];
      if(!file)throw new Error('Choose the original selected pricing source JSON file.');
      if(file.size>48*1024*1024)throw new Error('The selected file exceeds the original implementation material limit.');
      const bytes=new Uint8Array(await file.arrayBuffer()),sourceText=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const encoded=new TextEncoder().encode(sourceText);
      if(encoded.length!==bytes.length||await digest(encoded)!==await digest(bytes))throw new Error('Keep the original UTF-8 pricing source bytes.');
      const sourceSha256=await digest(bytes);
      if(pending){if(pending.action!=='receivePricing'||pending.args.sourceSha256!==sourceSha256)throw new Error('Choose the same source file for the retained request, or recover the other original request first.');
        pending.args.sourceText=sourceText;return retry();}
      return invoke('receivePricing',{sourceText,sourceSha256},{mutation:true,onResult:result=>{
        if(result.pricingSourceId){change(()=>{draft.pricingSourceId=result.pricingSourceId;draft.pricing.routes=[];});tab='quote';}
      }});
    }
    if(name==='refresh')return refresh();
    if(name==='retry')return retry();
    if(name==='edit'){tab='quote';storageWrite();return render();}
    if(name==='save-draft')return invoke('saveDraft',{draft:clone(draft)},{mutation:true});
    if(name==='preview'){const selected=clone(draft);return invoke('preview',{draft:selected},{onResult:(result,serial)=>{if(serial!==editSerial){message='The review is complete for an earlier draft; review your current edits before saving an edition.';return;}review=result.review||result;tab='review';}});}
    if(name==='publish'){if(!review)throw new Error('Review the current draft first.');return invoke('publish',{draft:clone(draft),reviewSha256:review.reviewSha256,parentId:draft.parentId||null},{mutation:true,onResult:result=>{selectedQuoteId=result.quote.id;tab='editions';}});}
    if(name==='compare')return invoke('compare',{beforeId:selectedBefore,afterId:selectedQuoteId},{onResult:result=>{comparison=result.comparison||result;}});
    if(name==='revise'){const quote=currentQuote();if(!quote)throw new Error('Choose a saved quote edition.');setDraft({...quote.draft,parentId:quote.id});tab='quote';message='Preparing a new edition from '+quote.title+'.';return render();}
    if(name==='add-tasks')return appendOriginalLines('implementation');
    if(name==='add-commitments')return appendOriginalLines('service');
    if(name==='add-implementation'||name==='add-service'){const kind=name==='add-implementation'?'implementation':'service';change(()=>draft[kind].lines.push(kind==='implementation'?{id:uuid(),taskId:null,title:'',hours:'',rateUsd:''}:{id:uuid(),commitmentId:null,title:'',quantity:'',unitUsd:''}));return render();}
    if(name==='use-routes'){const source=sourceById('pricingSources',draft.pricingSourceId);if(!source)throw new Error('Choose the original pricing scenario first.');change(()=>{const existing=new Map(draft.pricing.routes.map(row=>[row.routeId,row]));draft.pricing.routes=(source.rows||[]).map(row=>existing.get(row.routeId||row.id)||{routeId:row.routeId||row.id,monthlyRequests:''});});return render();}
    if(name==='download-quote')return download('QUOTE');
    if(name==='download-handoff')return download('HANDOFF');
  }
  const onClick=event=>{
    const target=event.target.closest('button');if(!target||!root.contains(target))return;
    if(target.dataset.tab){tab=target.dataset.tab;storageWrite();render();return;}
    if(target.dataset.removeLine!==undefined){const kind=target.dataset.kind,index=Number(target.dataset.removeLine);change(()=>draft[kind].lines.splice(index,1));render();return;}
    if(target.dataset.action)Promise.resolve().then(()=>action(target.dataset.action)).catch(err=>{error=String(err.message||err);render();});
  };
  const onInput=event=>{
    const target=event.target;
    const fields={'cq-title':()=>{draft.title=target.value;},'cq-customer':()=>{draft.customer.name=target.value;},'cq-contact':()=>{draft.customer.contact=target.value;},'cq-valid-through':()=>{draft.validThrough=target.value;},'cq-implementation-source':()=>{draft.implementationSourceId=target.value;},'cq-service-source':()=>{draft.serviceSourceId=target.value;},'cq-pricing-source':()=>{draft.pricingSourceId=target.value;},'cq-scope':()=>{draft.terms.scope=target.value;},'cq-deliverables':()=>{draft.terms.deliverables=target.value;},'cq-exclusions':()=>{draft.terms.exclusions=target.value;},'cq-payment':()=>{draft.terms.payment=target.value;},'cq-acceptance':()=>{draft.terms.acceptance=target.value;},'cq-notes':()=>{draft.notes=target.value;}};
    if(fields[target.id])change(fields[target.id]);
    else if({'cq-response-status':'status','cq-response-time':'observedAt','cq-response-source':'source','cq-response-note':'note'}[target.id]){responseDraft[{'cq-response-status':'status','cq-response-time':'observedAt','cq-response-source':'source','cq-response-note':'note'}[target.id]]=target.value;storageWrite();}
    else if(target.dataset.lineField){const tr=target.closest('[data-line]');change(()=>{draft[tr.dataset.kind].lines[Number(tr.dataset.line)][target.dataset.lineField]=target.value;});}
    else if(target.dataset.route!==undefined)change(()=>{draft.pricing.routes[Number(target.dataset.route)].monthlyRequests=target.value;});
  };
  const onChange=event=>{
    onInput(event);const target=event.target;
    if(['cq-selected-quote','cq-response-quote','cq-export-quote'].includes(target.id)){selectedQuoteId=target.value;comparison=null;storageWrite();render();}
    else if(target.id==='cq-before-quote'){selectedBefore=target.value;comparison=null;render();}
    else if(['cq-implementation-source','cq-service-source','cq-pricing-source'].includes(target.id))render();
  };
  const onSubmit=event=>{
    if(event.target.dataset.form!=='customer')return;
    event.preventDefault();const quote=currentQuote();if(!quote)return;
    const read=id=>root.querySelector('#'+id).value;
    const at=read('cq-response-time');
    const args={quoteId:quote.id,quoteSha256:quote.sha256,status:read('cq-response-status'),observedAt:at?new Date(at+'Z').toISOString():'',source:read('cq-response-source'),note:read('cq-response-note')};
    invoke('receive',args,{mutation:true,onResult:()=>{responseDraft={status:'ACCEPTED',observedAt:'',source:'',note:''};}}).catch(err=>{error=String(err.message||err);render();});
  };
  for(const [name,handler] of [['click',onClick],['input',onInput],['change',onChange],['submit',onSubmit]]){root.addEventListener(name,handler);listeners.push([name,handler]);}
  render();
  return {
    refresh,connect:refresh,
    clear({identityChanged=false}={}){storageWrite();resetRuntime({forgetSaved:identityChanged});render();},
    destroy(){storageWrite();resetRuntime();destroyed=true;for(const [name,handler] of listeners)root.removeEventListener(name,handler);root.replaceChildren();},
    snapshot(){return {schema:SCHEMA,scope:scope&&clone(scope),connected,dirty,tab,selectedQuoteId,pending:pending&&clone(pending)};}
  };
}

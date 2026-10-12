// MIT. Complete original tariff source, quotation and recipient workflow in the merchant case desk.
const SCHEMA='stellar-forge.merchant-commercial-tariff-desk.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const money=value=>value===null||value===undefined?'—':'USD '+String(value);
const methods={status:'tariffStatus',catalog:'tariffCatalog',selection:'tariffSelection',capture:'tariffCapture',
  inspect:'tariffInspect',attach:'tariffAttach',case:'tariffCase',restore:'tariffRestore',download:'tariffDownload'};
const labels={status:'Original requests',catalog:'Open pricing and tariff history',selection:'Review saved native selection',
  capture:'Capture full tariff receiving source',inspect:'Inspect retained source',attach:'Attach tariff, pricing and backup',
  case:'Review case tariff and volume',restore:'Restore original pricing and tariff workspace',download:'Download retained source'};
const writes=new Set(['capture','attach','restore']);
const initial=()=>({pricingDirectory:'',pricingConfig:'',observationKind:'snapshot',observationFile:'',
  selectionRequestId:'',captureDirectory:'',sourceDirectory:'',sourceSha256:'',bindingReason:'',
  sourceId:'',monthlyRequests:'',quoteId:'',archive:'',restoreDirectory:''});
export function createCommercialTariffDesk({root,services,changed,refreshCase,useTariffSource}={}){
  if(!root||!services||typeof changed!=='function'||typeof refreshCase!=='function'||typeof useTariffSource!=='function')
    throw new TypeError('Use the original case quotation shell, services and selection callback.');
  let scope=null,view=null,connected=false,epoch=0,closed=false,busy=false;
  let values=initial(),pending=null,lastRequest=null,source=null,catalog=null,selection=null,caseReview=null,restored=null;
  let active=[],message='',error='';
  const urls=new Set(),enabled=()=>Object.values(methods).every(name=>typeof services[name]==='function');
  const key=id=>SCHEMA+':'+id.workspaceId+':'+id.caseId;
  function forget(id){if(id)try{sessionStorage.removeItem(key(id));}catch{}}
  function save(){
    if(!scope)return;
    try{sessionStorage.setItem(key(scope),JSON.stringify({schema:SCHEMA,scope,values,pending,lastRequest}));}catch{}
  }
  function restoreSaved(id){
    let retained;try{retained=JSON.parse(sessionStorage.getItem(key(id))||'null');}catch{}
    if(retained?.schema===SCHEMA&&same(retained.scope,id)){
      values={...initial(),...retained.values};pending=retained.pending??null;lastRequest=retained.lastRequest??null;
    }else{values=initial();pending=null;lastRequest=null;}
  }
  function clear({identityChanged=false}={}){
    save();if(identityChanged)forget(scope);
    epoch++;connected=false;view=null;busy=false;source=null;catalog=null;selection=null;caseReview=null;restored=null;
    active=[];message='';error='';for(const url of urls)URL.revokeObjectURL(url);urls.clear();
    if(identityChanged){scope=null;values=initial();pending=null;lastRequest=null;}
  }
  function connect(record){
    const id=record?.scope;
    if(!id||!HASH.test(id.workspaceId??'')||!UUID.test(id.caseId??''))throw new Error('The original merchant workspace identity is missing.');
    const next={workspaceId:id.workspaceId,caseId:id.caseId};
    if(!same(scope,next)){
      save();if(scope&&scope.workspaceId!==next.workspaceId)forget(scope);
      clear();scope=next;restoreSaved(next);
    }
    view=record;connected=true;
    if(values.sourceId&&!record.tariffSources?.some(row=>row.id===values.sourceId)){values.sourceId='';caseReview=null;restored=null;}
    if(!values.sourceId&&record.tariffSources?.length)values.sourceId=record.tariffSources[0].id;
    if(values.quoteId&&!record.quotes?.some(row=>row.id===values.quoteId)){values.quoteId='';caseReview=null;restored=null;}
    if(!values.quoteId){
      const quote=record.quotes?.find(row=>row.sourceBindings?.tariff?.id===values.sourceId);
      if(quote)values.quoteId=quote.id;
    }
    if(caseReview&&caseReview.case?.revision!==record.revision)caseReview=null;
    save();
  }
  const currentSource=()=>view?.tariffSources?.find(row=>row.id===values.sourceId)||null;
  const currentQuote=()=>view?.quotes?.find(row=>row.id===values.quoteId)||null;
  function field(name,label,{required=false,readonly=false,placeholder=''}={}){
    return '<label class="cq-field" for="cqt-'+name+'"><span>'+esc(label)+'</span><input id="cqt-'+name+
      '" data-cqt-field="'+name+'" value="'+esc(values[name])+'" autocomplete="off"'+(required?' required':'')+
      (readonly?' readonly':'')+(placeholder?' placeholder="'+esc(placeholder)+'"':'')+'></label>';
  }
  function select(name,label,options,empty){
    return '<label class="cq-field" for="cqt-'+name+'"><span>'+esc(label)+'</span><select id="cqt-'+name+
      '" data-cqt-field="'+name+'"'+(busy?' disabled':'')+'><option value="">'+esc(empty)+'</option>'+
      options.map(row=>'<option value="'+esc(row.value)+'"'+(values[name]===row.value?' selected':'')+'>'+esc(row.label)+'</option>').join('')+'</select></label>';
  }
  const button=(label,action,disabled=false,extra='')=>'<button type="button" data-cqt-action="'+action+'"'+extra+
    (disabled?' disabled':'')+'>'+esc(label)+'</button>';
  const details=(label,value)=>value?'<details class="cqt-details"><summary>'+esc(label)+'</summary><pre>'+
    esc(JSON.stringify(value,null,2))+'</pre></details>':'';
  function files(rows){
    return '<div class="cq-table-wrap"><table><thead><tr><th>Retained file</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+
      (rows||[]).map(row=>'<tr><td>'+esc(row.name||row.filename)+'</td><td>'+esc(row.bytes)+'</td><td><code>'+
        esc(row.sha256)+'</code></td></tr>').join('')+'</tbody></table></div>';
  }
  function tariffCard(value){
    if(!value)return '<p class="cq-muted">Open a retained selection to inspect the original schedule and saved uniform rate.</p>';
    return '<div class="cqt-record"><h5>'+esc(value.planLabel||value.tariffLabel||'Selected tariff')+'</h5><dl>'+
      '<dt>Route</dt><dd>'+esc(value.routeId)+'</dd><dt>Selected request quantity</dt><dd>'+esc(value.selectedQuantity)+'</dd>'+
      '<dt>Tier schedule</dt><dd>'+esc(value.mode)+'</dd><dt>Original tariff total</dt><dd>'+esc(money(value.tariffGrossUsd))+'</dd>'+
      '<dt>Saved uniform rate</dt><dd>'+esc(money(value.uniformUnitUsd))+' / request</dd>'+
      '<dt>Uniform total at selection</dt><dd>'+esc(money(value.uniformGrossUsd))+'</dd>'+
      '<dt>Upward unit-rounding difference</dt><dd>'+esc(money(value.roundingDeltaUsd))+'</dd></dl>'+
      '<div class="cq-table-wrap"><table><thead><tr><th>Through cumulative requests</th><th>USD per request</th></tr></thead><tbody>'+
      (value.tiers||[]).map(row=>'<tr><td>'+esc(row.upTo===null?'Remaining requests':row.upTo)+'</td><td>'+esc(row.unitPriceUsd)+'</td></tr>').join('')+
      '</tbody></table></div>'+details('Original selection and pricing identities',{
        selectionRequestId:value.selectionRequestId,tariffPlanId:value.tariffPlanId,comparisonId:value.comparisonId,
        scenarioPlanId:value.scenarioPlanId,scenarioId:value.scenarioId,sourceVersion:value.sourceVersion,pricingVersion:value.pricingVersion})+'</div>';
  }
  function selectedNative(){
    if(!selection)return '';
    const item=selection.selection,comparison=selection.plan?.review?.comparisons?.find(row=>row.id===item?.intent?.selection?.comparisonId);
    const tariff=selection.plan?.review?.tariffs?.find(row=>row.id===comparison?.tariffId);
    return '<div class="cqt-record"><strong>'+esc(item?.result?.status==='TARIFF_SELECTION_SAVED'?'Original scenario and pricing are complete':'Original selection is still pending')+
      '</strong>'+tariffCard(comparison&&tariff?{planLabel:selection.plan.label,routeId:comparison.routeId,selectedQuantity:comparison.quantity,
        mode:tariff.mode,tariffGrossUsd:comparison.quote.totalUsd,uniformUnitUsd:comparison.quote.chosenUniformQuoteUsd,
        uniformGrossUsd:comparison.quote.uniformGrossUsd,roundingDeltaUsd:comparison.quote.roundingDeltaUsd,tiers:tariff.tiers,
        selectionRequestId:item.id,tariffPlanId:selection.plan.planId,comparisonId:comparison.id,
        scenarioPlanId:item.intent.scenarioRequest?.requestId,pricingVersion:item.result?.pricing?.version}:null)+
      details('Original retained requests',item)+'</div>';
  }
  function sourceCard(){
    if(!source)return '<p>Inspect the captured directory before attaching its complete source and backup.</p>';
    return tariffCard(source.tariff)+'<div class="cqt-record"><dl><dt>Complete source</dt><dd><code>'+esc(source.sourceSha256)+
      '</code></dd><dt>Pricing source</dt><dd><code>'+esc(source.pricing.sourceId)+'</code></dd><dt>Retained backup</dt><dd>'+
      esc(source.pricing.backup?.bytes)+' bytes</dd></dl>'+files(source.tariff.files)+details('Full original backup binding',source.pricing.backup)+'</div>';
  }
  function volumeCard(){
    const value=caseReview?.volumeReview;
    if(!value)return '';
    return '<div class="cqt-record"><h5>Original calculation at '+esc(value.monthlyRequests)+' requests</h5><dl>'+
      '<dt>Saved uniform rate charge</dt><dd>'+esc(money(value.savedUniformQuote?.amountUsd))+'</dd>'+
      '<dt>Tier schedule total</dt><dd>'+esc(money(value.comparison?.quote?.totalUsd))+'</dd>'+
      '<dt>Uniform rate derived at this quantity</dt><dd>'+esc(money(value.comparison?.quote?.chosenUniformQuoteUsd))+'</dd></dl>'+
      '<p>The quote retains the saved pricing rate. Select and save a new tariff comparison in the original pricing workspace to adopt a different rate.</p>'+
      details('Complete original volume review',value)+'</div>';
  }
  function render(){
    if(!enabled())return '<p>The complete tariff receiving services are unavailable in this selected listener.</p>';
    const blocked=busy||Boolean(pending),quote=currentQuote(),selected=currentSource();
    const sourceReady=source?.directory===values.sourceDirectory&&source?.sourceSha256===values.sourceSha256;
    const quoteReady=quote?.sourceBindings?.tariff?.id===selected?.id&&Boolean(selected);
    const nativeOptions=(catalog?.selections||[]).map(row=>({value:row.id,label:
      row.status+' · '+row.createdAt+' · '+row.id}));
    return '<div class="cqt-desk"><header><h3>Tariff quotation and receiving</h3><p>Carry a completed original tariff selection into the customer quote, with its matching full pricing backup and editable recipient workspace.</p></header>'+
      '<div class="cqt-status" role="status">'+(message?'<p>'+esc(message)+'</p>':'')+(error?'<p role="alert">'+esc(error)+'</p>':'')+'</div>'+
      (pending?'<section class="cqt-recovery"><h4>Retained original request</h4><p>'+esc(labels[pending.action])+
        ' has retained inputs. Reopen the same request to obtain its current native result.</p>'+details('Exact request and original UUIDs',pending)+
        button('Resume this original request','retry',busy)+'</section>':'')+
      (active.length?details('Current original listener operations',active):'')+
      '<section class="cqt-section"><h4>1. Open the original pricing and tariff history</h4><form data-cqt-form="catalog"><fieldset'+(busy?' disabled':'')+'><div class="cq-grid">'+
      field('pricingDirectory','Original pricing directory',{required:true})+field('pricingConfig','Original seller configuration',{required:true})+
      select('observationKind','Retained observation',[{value:'snapshot',label:'Saved operations snapshot'},{value:'history',label:'Saved usage history'}],'Choose original observation')+
      field('observationFile','Original snapshot or history file',{required:true})+'</div><button type="submit">Open original tariff history</button></fieldset></form>'+
      (catalog?'<p>'+esc(catalog.tariffs?.length??0)+' saved tariff plans and '+esc(catalog.selections?.length??0)+' retained selection requests.</p>'+
      details('Original pricing and tariff history',catalog):'')+
      '<p>Native tariff editing, scenario selection and repricing remain in the original Merchant pricing workspace.</p></section>'+
      '<section class="cqt-section"><h4>2. Review a saved native selection</h4><form data-cqt-form="selection"><fieldset'+(busy?' disabled':'')+'>'+
      (nativeOptions.length?select('selectionRequestId','Original selection request',nativeOptions,'Choose the original request'):field('selectionRequestId','Original saved selection UUID',{required:true}))+
      '<button type="submit">Open exact scenario and pricing result</button></fieldset></form>'+selectedNative()+'</section>'+
      '<section class="cqt-section"><h4>3. Capture the complete receiving source</h4><p>The capture keeps this exact selection, both native request results and one original full pricing backup. The backup request UUID is retained before the operation starts.</p>'+
      '<form data-cqt-form="capture"><fieldset'+(blocked?' disabled':'')+'>'+field('captureDirectory','Private receiving directory',{required:true})+
      '<button type="submit">Capture selected tariff and full backup</button></fieldset></form></section>'+
      '<section class="cqt-section"><h4>4. Inspect and attach to this case</h4><form data-cqt-form="inspect"><fieldset'+(busy?' disabled':'')+'><div class="cq-grid">'+
      field('sourceDirectory','Captured or received directory',{required:true})+field('sourceSha256','Exact receiving source SHA-256',{placeholder:'Use the captured or sender-provided SHA-256'})+
      '</div><button type="submit">Inspect source and matching backup</button></fieldset></form>'+sourceCard()+
      '<form data-cqt-form="attach"><fieldset'+(blocked||!sourceReady?' disabled':'')+'><label class="cq-field" for="cqt-bindingReason"><span>Why this merchant source belongs to the selected case</span>'+
      '<textarea id="cqt-bindingReason" data-cqt-field="bindingReason" rows="3" required>'+esc(values.bindingReason)+'</textarea></label>'+
      '<p>Attachment retains three distinct original requests: pricing source, complete backup and tariff basis. Recovery completes the same sequence.</p>'+
      '<button type="submit">Attach reviewed tariff, pricing and backup</button></fieldset></form></section>'+
      '<section class="cqt-section"><h4>5. Select the case tariff for the quote</h4>'+
      select('sourceId','Retained case tariff',(view?.tariffSources||[]).map(row=>({value:row.id,label:(row.planLabel||row.tariffLabel)+' · '+row.selectedQuantity+' requests · '+row.selectedAt})),'Choose an attached tariff')+
      tariffCard(selected)+button('Use this tariff and its pricing source','use-source',busy||!selected)+
      '<form data-cqt-form="case"><fieldset'+(busy||!selected?' disabled':'')+'>'+field('monthlyRequests','Quoted monthly requests',{required:true})+
      '<button type="submit">Compare original tariff and saved rate</button></fieldset></form>'+volumeCard()+'</section>'+
      '<section class="cqt-section"><h4>6. Reopen a saved quotation</h4>'+
      select('quoteId','Quote with a retained tariff',(view?.quotes||[]).filter(row=>row.sourceBindings?.tariff).map(row=>({value:row.id,label:row.title+' · '+row.createdAt})),'Choose the original quote edition')+
      button('Review the exact quoted source','review-quote',busy||!quoteReady)+
      (caseReview?.quote?details('Reviewed quote and original tariff',caseReview):'')+
      '<p>Save and review the quotation in Quote editor, then record the customer response against its exact edition.</p></section>'+
      '<section class="cqt-section"><h4>7. Restore the original editable workspace</h4><p>The original full pricing restore runs first. Its same native tariff portfolio is then received and reopened against the restored pricing results.</p>'+
      '<form data-cqt-form="restore"><fieldset'+(blocked||!quoteReady?' disabled':'')+'><div class="cq-grid">'+
      field('archive','Private retained archive path',{required:true})+field('restoreDirectory','Independent restored workspace directory',{required:true})+
      '</div><button type="submit">Restore and reopen pricing and tariff</button></fieldset></form>'+
      (restored?'<div class="cqt-record"><strong>Original workspace restored and reopened</strong>'+details('Normal pricing source paths and retained selection',restored)+'</div>':'')+'</section>'+
      '<section class="cqt-section"><h4>Complete customer handover</h4><p>The original case package carries the source materials, complete pricing backup, quote editions, customer responses and history. Receive that package into the customer case workspace before reopening this desk.</p>'+
      button('Download exact tariff source','download-source',busy||!selected)+button('Download original selected portfolio','download-portfolio',busy||!selected)+
      '<p><a href="/">Open the complete case package controls</a> · <a href="/commercial/TARIFFS.md">Operating guide and CLI</a></p>'+
      details('Last completed original request',lastRequest)+button('Refresh case and original operations','refresh',busy)+'</section></div>';
  }
  function authoring(){
    if(!['snapshot','history'].includes(values.observationKind))throw new Error('Choose the original saved observation type.');
    return {pricingDirectory:values.pricingDirectory,pricingConfig:values.pricingConfig,
      [values.observationKind==='history'?'pricingHistory':'pricingSnapshot']:values.observationFile};
  }
  function selectedQuote(){
    const quote=currentQuote(),tariff=currentSource();
    if(!quote||!tariff||quote.sourceBindings?.tariff?.id!==tariff.id)
      throw new Error('Choose a saved quote that uses this exact retained tariff source.');
    return {revision:view.revision,sourceId:tariff.id,quoteId:quote.id,quoteSha256:quote.sha256};
  }
  function argumentsFor(action){
    if(action==='catalog')return authoring();
    if(['selection','capture'].includes(action)){
      if(!UUID.test(values.selectionRequestId))throw new Error('Choose the original saved selection UUID.');
      return {...authoring(),selectionRequestId:values.selectionRequestId,...(action==='capture'?
        {backupRequestId:crypto.randomUUID(),directory:values.captureDirectory}:{})};
    }
    if(action==='inspect')return {directory:values.sourceDirectory,...(values.sourceSha256?{expectedSourceSha256:values.sourceSha256}:{})};
    if(action==='attach'){
      if(!source||source.directory!==values.sourceDirectory||source.sourceSha256!==values.sourceSha256)
        throw new Error('Inspect the exact receiving directory and source hash before attaching it.');
      if(!values.bindingReason.trim()||values.bindingReason.length>4000)throw new Error('Record the matching merchant and source reason in 4,000 characters or less.');
      return {directory:values.sourceDirectory,expectedSourceSha256:values.sourceSha256,bindingReason:values.bindingReason,
        pricingRequestId:crypto.randomUUID(),backupAttachmentRequestId:crypto.randomUUID(),tariffAttachmentRequestId:crypto.randomUUID(),
        actor:'Local commercial operator'};
    }
    if(action==='case'){
      if(!currentSource())throw new Error('Choose an attached original tariff source.');
      if(!/^(0|[1-9]\d*)$/.test(values.monthlyRequests))throw new Error('Enter the explicit whole monthly request quantity.');
      return {revision:view.revision,sourceId:values.sourceId,monthlyRequests:values.monthlyRequests};
    }
    if(action==='restore')return {...selectedQuote(),archive:values.archive,directory:values.restoreDirectory};
    throw new Error('Choose a complete tariff operation.');
  }
  async function run(action,args,{retry=false}={}){
    if(!connected||!scope)throw new Error('Reopen the original merchant case first.');
    if(busy)throw new Error('The current original request is still running.');
    if(pending&&writes.has(action)&&!retry)throw new Error('Resume the retained original request before starting another write.');
    const token=epoch,id=clone(scope),request=retry?clone(pending):{action,args:{...clone(args),scope:id,expectedRevision:view.revision},startedAt:new Date().toISOString()};
    if(!same(request.args.scope,id))throw new Error('The saved request belongs to another original case.');
    if(writes.has(action)){pending=request;save();}
    busy=true;error='';message=labels[action]+' is running.';changed();
    try{
      const envelope=await services[methods[action]](request.args);
      if(closed||token!==epoch)return;
      if(!same(envelope?.scope,id)){clear({identityChanged:true});error='The original response belongs to another merchant workspace.';changed();return;}
      if(action==='status'){active=envelope.active??[];message='Original listener operations refreshed.';return;}
      const result=envelope.result;
      if(!result||typeof result!=='object')throw new Error('The original tariff response is incomplete.');
      if(writes.has(action)){lastRequest={...request,completedAt:new Date().toISOString(),result};pending=null;}
      if(action==='catalog'){catalog=result;selection=null;message='Original pricing history and retained tariff requests opened.';}
      if(action==='selection'){selection=result;message=result.selection?.result?.status==='TARIFF_SELECTION_SAVED'?
        'Original scenario and pricing requests are complete.':'Reopen the pending original pricing request in Merchant pricing before capture.';}
      if(action==='capture'){
        values.sourceDirectory=result.directory;values.sourceSha256=result.sourceSha256;source=null;
        message='Complete tariff source and matching backup captured. Inspect the retained directory before attachment.';
      }
      if(action==='inspect'){source=result;values.sourceDirectory=result.directory;values.sourceSha256=result.sourceSha256;message='Exact tariff source and original full backup are verified.';}
      if(action==='attach'){
        values.sourceId=result.tariffSourceId;values.monthlyRequests=result.tariff?.selectedQuantity??values.monthlyRequests;
        message='Tariff, pricing and full backup are attached through the original case requests.';await refreshCase();
      }
      if(action==='case'){caseReview=result;message='Original tariff and quote source reviewed.';}
      if(action==='restore'){restored=result;message='Original pricing workspace and selected tariff portfolio restored and reopened.';}
    }catch(problem){
      if(closed||token!==epoch)return;
      error=String(problem.message||problem);
      if(problem.code==='COMMERCIAL_SCOPE_CHANGED'){clear({identityChanged:true});error=String(problem.message||problem);changed();}
      else if(writes.has(action)&&problem.requestState==='REJECTED'){
        lastRequest={...request,completedAt:new Date().toISOString(),error:{code:problem.code,message:error}};pending=null;
      }
    }finally{if(!closed&&token===epoch){busy=false;save();changed();}}
  }
  async function download(kind){
    if(busy||!connected||!currentSource())throw new Error('Open the selected original case tariff before downloading.');
    const token=epoch,id=clone(scope);busy=true;error='';changed();
    try{
      const received=await services.tariffDownload({scope:id,revision:view.revision,sourceId:values.sourceId,kind});
      if(closed||token!==epoch)return;
      if(!same(received?.scope,id))throw new Error('The download belongs to another original workspace or case.');
      const descriptor=received.descriptor;
      const bytes=received.bytes instanceof Uint8Array?received.bytes:new Uint8Array(await received.response.arrayBuffer());
      if(!descriptor||!HASH.test(descriptor.sha256??'')||bytes.length!==descriptor.bytes||
          !descriptor.filename||/[\\/\0]/.test(descriptor.filename)||
          Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')!==descriptor.sha256)
        throw new Error('The original downloaded file differs from its complete retained descriptor.');
      if(closed||token!==epoch)return;
      const url=URL.createObjectURL(new Blob([bytes],{type:descriptor.mediaType||'application/json'}));urls.add(url);
      const a=document.createElement('a');a.href=url;a.download=descriptor.filename;a.click();
      setTimeout(()=>{if(urls.delete(url))URL.revokeObjectURL(url);},1000);
      message='Downloaded '+descriptor.filename+' · '+descriptor.bytes+' verified bytes.';
    }catch(problem){if(token===epoch)error=String(problem.message||problem);}
    finally{if(!closed&&token===epoch){busy=false;changed();}}
  }
  async function action(name){
    if(name==='retry'){if(pending)return run(pending.action,pending.args,{retry:true});return;}
    if(name==='refresh'){await refreshCase();return run('status',{});}
    if(name==='review-quote')return run('case',selectedQuote());
    if(name==='download-source')return download('SOURCE');
    if(name==='download-portfolio')return download('PORTFOLIO');
    if(name==='use-source'){
      const tariff=currentSource();if(!tariff)throw new Error('Choose an attached tariff source.');
      useTariffSource({sourceId:tariff.id,pricingSourceId:tariff.pricingSourceId,routeId:tariff.routeId,selectedQuantity:tariff.selectedQuantity});return;
    }
  }
  const onInput=event=>{
    const name=event.target?.dataset?.cqtField;if(!name||!(name in values)||!root.contains(event.target))return;
    const before=values[name];values[name]=event.target.value;
    if(before===values[name])return;
    if(['pricingDirectory','pricingConfig','observationKind','observationFile'].includes(name)){catalog=null;selection=null;}
    if(name==='selectionRequestId')selection=null;
    if(['sourceDirectory','sourceSha256'].includes(name))source=null;
    if(name==='sourceId'){
      const selected=currentSource();values.monthlyRequests=selected?.selectedQuantity??'';
      if(currentQuote()?.sourceBindings?.tariff?.id!==values.sourceId)values.quoteId='';
    }
    if(name==='quoteId'){
      const quoted=currentQuote()?.sourceBindings?.tariff;
      if(quoted){values.sourceId=quoted.id;values.monthlyRequests=quoted.basis?.quotedQuantity??'';}
    }
    if(['sourceId','monthlyRequests','quoteId'].includes(name)){caseReview=null;restored=null;}
    if(['archive','restoreDirectory'].includes(name))restored=null;
    save();
  };
  const onChange=event=>{onInput(event);if(event.target?.dataset?.cqtField)changed();};
  const onSubmit=event=>{
    const name=event.target?.dataset?.cqtForm;if(!name)return;event.preventDefault();
    Promise.resolve().then(()=>run(name,argumentsFor(name))).catch(problem=>{error=String(problem.message||problem);changed();});
  };
  const onClick=event=>{
    const target=event.target?.closest('[data-cqt-action]');if(!target||!root.contains(target))return;
    Promise.resolve().then(()=>action(target.dataset.cqtAction)).catch(problem=>{error=String(problem.message||problem);changed();});
  };
  const listeners=[['input',onInput],['change',onChange],['submit',onSubmit],['click',onClick]];
  for(const [name,handler]of listeners)root.addEventListener(name,handler);
  return {connect,clear,render,enabled,snapshot:()=>({scope:scope&&clone(scope),connected,busy,pending:pending&&clone(pending)}),
    destroy(){clear();closed=true;for(const [name,handler]of listeners)root.removeEventListener(name,handler);}};
}

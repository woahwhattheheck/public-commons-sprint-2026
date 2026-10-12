// MIT. Complete original pricing-workspace receiving inside the saved quotation desk.
const SCHEMA='stellar-forge.commercial-receiving-desk.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initial=()=>({
  pricingDirectory:'',pricingConfig:'',observationKind:'snapshot',observationFile:'',
  planId:'',scenarioId:'',captureDirectory:'',sourceDirectory:'',sourceSha256:'',bindingReason:'',
  quoteId:'',archiveSha256:'',archiveFile:'',restoreDirectory:'',
});
const operationLabels={capture:'Capture saved plan and full backup',inspect:'Inspect retained pricing source',
  attach:'Attach pricing and backup', 'inspect-case':'Review quoted workspace',restore:'Restore original pricing workspace'};
const methods={capture:'receivingCapture',inspect:'receivingInspect',attach:'receivingAttach',
  'inspect-case':'receivingCase',restore:'receivingRestore'};
const meaningful=action=>!['inspect','inspect-case'].includes(action);
export function createCommercialReceivingDesk({root,services,changed,refreshCase,usePricingSource}={}){
  if(!root||!services||typeof changed!=='function'||typeof refreshCase!=='function')
    throw new TypeError('Original quotation desk and receiving services required.');
  let scope=null,view=null,connected=false,epoch=0,closed=false,busy=false;
  let values=initial(),pending=null,lastRequest=null,source=null,caseReview=null,restored=null,message='',error='';
  const key=value=>SCHEMA+':'+value.workspaceId+':'+value.caseId;
  const enabled=()=>Object.values(methods).every(name=>typeof services[name]==='function');
  function save(){
    if(!scope)return;
    try{sessionStorage.setItem(key(scope),JSON.stringify({schema:SCHEMA,scope,values,pending,lastRequest}));}catch{}
  }
  function forget(identity){if(identity)try{sessionStorage.removeItem(key(identity));}catch{}}
  function load(identity){
    let saved;try{saved=JSON.parse(sessionStorage.getItem(key(identity))||'null');}catch{}
    if(saved?.schema===SCHEMA&&same(saved.scope,identity)){
      values={...initial(),...saved.values};pending=saved.pending??null;lastRequest=saved.lastRequest??null;
    }else{values=initial();pending=null;lastRequest=null;}
  }
  function clear({identityChanged=false}={}){
    save();if(identityChanged)forget(scope);
    epoch++;connected=false;view=null;source=null;caseReview=null;restored=null;busy=false;message='';error='';
    if(identityChanged){scope=null;values=initial();pending=null;lastRequest=null;}
  }
  function connect(record){
    const next=record?.scope;
    if(!next||typeof next.workspaceId!=='string'||!UUID.test(next.caseId??''))throw new Error('The native quotation case identity is missing.');
    const identity={workspaceId:next.workspaceId,caseId:next.caseId};
    if(!same(scope,identity)){
      save();if(scope&&scope.workspaceId!==identity.workspaceId)forget(scope);
      epoch++;scope=identity;source=null;caseReview=null;restored=null;busy=false;message='';error='';load(identity);
    }
    view=record;connected=true;
    if(values.quoteId&&!record.quotes?.some(quote=>quote.id===values.quoteId)){values.quoteId='';values.archiveSha256='';}
    if(!values.quoteId&&record.quotes?.length)values.quoteId=record.quotes[0].id;
    save();
  }
  function field(name,label,{required=false,placeholder='',readonly=false}={}){
    return '<label class="cq-field" for="cqr-'+name+'"><span>'+esc(label)+'</span><input id="cqr-'+name+'" data-cqr-field="'+name+'" value="'+esc(values[name])+'"'+
      (required?' required':'')+(readonly?' readonly':'')+(placeholder?' placeholder="'+esc(placeholder)+'"':'')+' autocomplete="off"></label>';
  }
  function area(name,label){
    return '<label class="cq-field" for="cqr-'+name+'"><span>'+esc(label)+'</span><textarea id="cqr-'+name+'" data-cqr-field="'+name+'" rows="4">'+esc(values[name])+'</textarea></label>';
  }
  function button(label,action,disabled=false){
    return '<button type="button" data-cqr-action="'+action+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
  }
  function files(rows){
    return '<div class="cq-table-wrap"><table><thead><tr><th>Original file</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+
      (rows||[]).map(row=>'<tr><td>'+esc(row.name||row.filename)+'</td><td>'+esc(row.bytes)+'</td><td><code>'+esc(row.sha256)+'</code></td></tr>').join('')+'</tbody></table></div>';
  }
  function quotes(){
    return '<label class="cq-field" for="cqr-quoteId"><span>Saved quote edition</span><select id="cqr-quoteId" data-cqr-field="quoteId"><option value="">Choose a saved edition</option>'+
      (view?.quotes||[]).map(quote=>'<option value="'+esc(quote.id)+'"'+(quote.id===values.quoteId?' selected':'')+'>'+esc(quote.title)+' · '+esc(quote.createdAt)+'</option>').join('')+'</select></label>';
  }
  function nativeDetails(title,result){
    return result?'<details class="cqr-details"><summary>'+esc(title)+'</summary><pre>'+esc(JSON.stringify(result,null,2))+'</pre></details>':'';
  }
  function sourceSection(){
    if(!source)return '<p class="cq-muted">Inspect the retained source to review its selected plan, original files and complete backup before attachment.</p>';
    const value=source.selection||source.source?.pricing,backup=source.backupFile||source.source?.files?.find(file=>file.name==='pricing-workspace.tar');
    return '<section class="cqr-received"><h4>Verified retained source</h4><dl><dt>Receiving source</dt><dd><code>'+esc(source.sourceSha256)+'</code></dd>'+
      '<dt>Selected plan</dt><dd><code>'+esc(value?.planId)+'</code></dd><dt>Scenario</dt><dd>'+esc(value?.scenarioId)+'</dd>'+
      '<dt>Pricing version</dt><dd>'+esc(value?.version)+'</dd><dt>Complete backup</dt><dd>'+esc(backup?.bytes)+' bytes</dd></dl>'+
      files(source.files||source.source?.files)+
      (source.costOrigin?'<p>Applied supplier-cost edition <code>'+esc(source.costOrigin.edition)+'</code>; '+esc(source.costOrigin.originalSourceBindings?.length??0)+' original supplier sources retained.</p>':'')+
      nativeDetails('Original pricing and source review',source.review||source.pricing||source.source)+
      '<p>Review the original seller, route identities and cost basis, then record why this source belongs with this case.</p></section>';
  }
  function render(){
    if(!enabled())return '<h3>Pricing workspace receiving</h3><p>Open this case through the current Merchant workspace to use its installed pricing and backup receiving tools.</p>';
    const blocked=busy||Boolean(pending),quote=(view?.quotes||[]).find(row=>row.id===values.quoteId);
    const selected=source&&source.sourceSha256===values.sourceSha256&&source.directory===values.sourceDirectory;
    return '<div class="cqr-desk"><h3>Pricing workspace receiving</h3><p>Retain the saved pricing source and the full workspace that produced it. Attach both to this case, then restore the same editable source from a received quotation.</p>'+
      '<div role="status" class="cqr-status">'+(message?'<p>'+esc(message)+'</p>':'')+(error?'<p role="alert">'+esc(error)+'</p>':'')+'</div>'+
      (pending?'<section class="cq-pending"><strong>Retained original '+esc(operationLabels[pending.action])+'</strong><p>The request and its selected paths are saved for this case. Reopening uses the same native UUIDs and files.</p>'+
        button('Retry the same original request','retry',busy)+button('Reopen original case','refresh',busy)+nativeDetails('Exact retained request',pending)+'</section>':'')+
      '<section class="cqr-section"><h4>1. Capture an existing saved plan</h4><p>Choose the original private SF97 workspace, seller configuration and saved observation. The capture retains its complete native workspace backup.</p>'+
      '<form data-cqr-form="capture"><fieldset'+(blocked?' disabled':'')+'><div class="cq-grid">'+
      field('pricingDirectory','Original pricing workspace directory',{required:true})+field('pricingConfig','Original seller configuration file',{required:true})+
      '<label class="cq-field" for="cqr-observationKind"><span>Saved observation</span><select id="cqr-observationKind" data-cqr-field="observationKind"><option value="snapshot"'+(values.observationKind==='snapshot'?' selected':'')+'>Snapshot</option><option value="history"'+(values.observationKind==='history'?' selected':'')+'>History</option></select></label>'+
      field('observationFile','Original saved observation file',{required:true})+field('planId','Saved plan UUID',{required:true})+
      field('scenarioId','Scenario identity (blank keeps the saved selection)')+field('captureDirectory','Private receiving-source destination',{required:true})+
      '</div><button type="submit">Capture selected plan and complete backup</button></fieldset></form></section>'+
      '<section class="cqr-section"><h4>2. Review a retained receiving source</h4><form data-cqr-form="inspect"><fieldset'+(busy?' disabled':'')+'><div class="cq-grid">'+
      field('sourceDirectory','Retained receiving-source directory',{required:true})+field('sourceSha256','Receiving-source SHA-256 (from capture or sender)')+
      '</div><button type="submit">Inspect original source and full backup</button></fieldset></form>'+sourceSection()+'</section>'+
      '<section class="cqr-section"><h4>3. Attach the reviewed source to this case</h4><form data-cqr-form="attach"><fieldset'+(blocked||!selected?' disabled':'')+'>'+
      area('bindingReason','Merchant/source match and why this source belongs with the selected case')+
      '<p>The original pricing receive and archive attachment use two separately retained request UUIDs. Both are carried through recovery.</p><button type="submit">Attach reviewed pricing and complete backup</button></fieldset></form>'+
      button('Use this pricing source in the quote','use-source',busy||!selected)+
      '</section><section class="cqr-section"><h4>4. Review the workspace retained with a quotation</h4><form data-cqr-form="inspect-case"><fieldset'+(busy?' disabled':'')+'><div class="cq-grid">'+quotes()+field('archiveSha256','Exact backup SHA-256 (required when multiple backups are retained)')+'</div>'+
      '<button type="submit"'+(!quote?' disabled':'')+'>Review this quote and its original workspace</button></fieldset></form>'+
      (caseReview?'<div class="cqr-received"><p>Original quoted workspace is retained at case revision <code>'+esc(caseReview.case?.revision)+'</code>.</p>'+nativeDetails('Selected quote, original pricing and backup',caseReview)+'</div>':'')+'</section>'+
      '<section class="cqr-section"><h4>5. Restore and reopen the original pricing workspace</h4><p>Choose the quote and backup above. Keep the recovered archive outside the separate restore destination. The original restore verifies the same plan, pricing version, supplier-cost edition and every bound supplier source.</p>'+
      '<form data-cqr-form="restore"><fieldset'+(blocked||!quote?' disabled':'')+'><div class="cq-grid">'+
      field('archiveFile','Private retained archive file',{required:true})+field('restoreDirectory','Independent restored pricing workspace directory',{required:true})+
      '</div><button type="submit">Restore selected original pricing workspace</button></fieldset></form>'+
      (restored?'<div class="cqr-received"><strong>Original pricing workspace restored and reopened</strong>'+nativeDetails('Restored source and normal SF97 operator paths',restored)+'</div>':'')+'</section>'+
      '<section class="cqr-section"><h4>Complete case delivery</h4><p>The original full package carries case history, every source edition, original attachments, the quotation and this pricing backup. Use the case package controls in Merchant workspace, or <code>merchant-commercial receiving export</code> and <code>receiving receive</code>. Open the new receiving case here to continue with its original quotation history.</p>'+
      '<a href="/" class="cqr-link">Open Merchant workspace</a> <a href="/commercial/RECEIVING.md">Open complete receiving guide</a>'+
      nativeDetails('Last original request and returned result',lastRequest)+'</section></div>';
  }
  function quoteSelection(){
    const quote=view?.quotes?.find(item=>item.id===values.quoteId);
    if(!quote)throw new Error('Choose one original saved quotation edition.');
    return {revision:view.revision,quoteId:quote.id,quoteSha256:quote.sha256,
      ...(values.archiveSha256?{archiveSha256:values.archiveSha256}:{})};
  }
  function argumentsFor(action){
    if(action==='capture'){
      if(!UUID.test(values.planId))throw new Error('Use the original saved plan UUID.');
      return {pricingDirectory:values.pricingDirectory,pricingConfig:values.pricingConfig,
        [values.observationKind==='history'?'pricingHistory':'pricingSnapshot']:values.observationFile,
        planId:values.planId,...(values.scenarioId?{scenarioId:values.scenarioId}:{}),
        backupRequestId:crypto.randomUUID(),directory:values.captureDirectory};
    }
    if(action==='inspect')return {directory:values.sourceDirectory,...(values.sourceSha256?{expectedSourceSha256:values.sourceSha256}:{})};
    if(action==='attach'){
      if(!source||source.sourceSha256!==values.sourceSha256||source.directory!==values.sourceDirectory)
        throw new Error('Inspect the selected original receiving source before attaching it.');
      if(!values.bindingReason.trim()||new TextEncoder().encode(values.bindingReason).length>4000)
        throw new Error('Record the matching merchant/source reason in 4,000 UTF-8 bytes or less.');
      return {directory:values.sourceDirectory,expectedSourceSha256:values.sourceSha256,
        pricingRequestId:crypto.randomUUID(),attachmentRequestId:crypto.randomUUID(),
        actor:'Local commercial operator',bindingReason:values.bindingReason};
    }
    if(action==='inspect-case')return quoteSelection();
    if(action==='restore')return {...quoteSelection(),archive:values.archiveFile,directory:values.restoreDirectory};
    throw new Error('Choose an original pricing receiving action.');
  }
  async function run(action,args,{retry=false}={}){
    if(!connected||!scope)throw new Error('Reopen the original saved case first.');
    if(busy)throw new Error('The original receiving request is still running.');
    if(pending&&!retry&&meaningful(action))throw new Error('Recover the retained original receiving request first.');
    const token=epoch,identity=clone(scope);
    const request=retry?clone(pending):{action,args:{...clone(args),scope:identity,expectedRevision:view.revision},startedAt:new Date().toISOString()};
    if(!same(request.args.scope,identity))throw new Error('The saved request belongs to another original case.');
    if(meaningful(action)){pending=request;save();}
    busy=true;message=action==='capture'?'The original full workspace export is running.':operationLabels[action]+' is running.';error='';changed();
    try{
      const envelope=await services[methods[action]](request.args);
      if(closed||token!==epoch)return;
      if(!same(envelope?.scope,identity)){clear({identityChanged:true});changed();throw new Error('The receiving result belongs to another merchant workspace.');}
      const result=envelope.result;
      if(!result||typeof result!=='object')throw new Error('The original receiving result is incomplete.');
      if(meaningful(action)){lastRequest={...request,returnedAt:new Date().toISOString(),result};pending=null;}
      if(action==='capture'){
        values.sourceDirectory=result.directory;values.sourceSha256=result.sourceSha256;source=null;
        message='The complete original source and backup are retained. Inspect them below before attaching to the case.';
      }else if(action==='inspect'){
        source=result;values.sourceDirectory=result.directory;values.sourceSha256=result.sourceSha256;
        message='Original pricing source, full workspace backup and supplier bindings are verified.';
      }else if(action==='attach'){
        message='Original pricing and complete backup are attached to this case.';
        await refreshCase();
      }else if(action==='inspect-case'){
        caseReview=result;if(result.backup?.sha256)values.archiveSha256=result.backup.sha256;
        message='The selected quotation and its original pricing workspace are verified.';
      }else if(action==='restore'){
        restored=result;message='The original editable pricing workspace is restored and reopened.';
      }
    }catch(problem){
      if(closed||token!==epoch)return;
      if(problem.code==='COMMERCIAL_SCOPE_CHANGED'){clear({identityChanged:true});error=problem.message;}
      else{
        error=String(problem.message||problem);
        if(meaningful(action)&&problem.requestState==='REJECTED'){
          lastRequest={...request,returnedAt:new Date().toISOString(),error:{code:problem.code,message:error}};
          pending=null;
        }
      }
    }finally{if(!closed&&token===epoch){busy=false;save();changed();}}
  }
  async function action(name){
    if(name==='refresh'){await refreshCase();return;}
    if(name==='retry'){if(pending)return run(pending.action,pending.args,{retry:true});return;}
    if(name==='use-source'){
      if(!source)throw new Error('Inspect the original selected pricing source first.');
      const sourceId=source.selection?.sourceId||source.source?.pricing?.sourceId;
      if(!view?.pricingSources?.some(item=>item.id===sourceId))
        throw new Error('Attach this reviewed source to the current case before selecting it in a quote.');
      usePricingSource(sourceId);return;
    }
  }
  const onInput=event=>{
    const name=event.target?.dataset?.cqrField;
    if(!name||!(name in values)||!root.contains(event.target))return;
    const previous=values[name];values[name]=event.target.value;
    if(name==='quoteId'&&previous!==values[name])values.archiveSha256='';
    if(['sourceDirectory','sourceSha256'].includes(name))source=null;
    if(['quoteId','archiveSha256'].includes(name)){caseReview=null;restored=null;}
    if(['archiveFile','restoreDirectory'].includes(name))restored=null;
    save();
  };
  const onChange=event=>{onInput(event);if(event.target?.dataset?.cqrField)changed();};
  const onSubmit=event=>{
    const name=event.target?.dataset?.cqrForm;if(!name)return;
    event.preventDefault();
    Promise.resolve().then(()=>run(name,argumentsFor(name))).catch(problem=>{error=String(problem.message||problem);changed();});
  };
  const onClick=event=>{
    const target=event.target.closest('[data-cqr-action]');
    if(!target||!root.contains(target))return;
    Promise.resolve().then(()=>action(target.dataset.cqrAction)).catch(problem=>{error=String(problem.message||problem);changed();});
  };
  for(const [name,handler] of [['input',onInput],['change',onChange],['submit',onSubmit],['click',onClick]])root.addEventListener(name,handler);
  return {connect,clear,render,enabled,
    snapshot:()=>({connected,busy,pending:pending&&clone(pending),scope:scope&&clone(scope)}),
    destroy(){clear();closed=true;for(const [name,handler] of [['input',onInput],['change',onChange],['submit',onSubmit],['click',onClick]])root.removeEventListener(name,handler);}
  };
}

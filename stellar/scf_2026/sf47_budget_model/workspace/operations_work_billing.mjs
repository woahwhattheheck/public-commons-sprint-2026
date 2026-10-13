import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
const SCHEMA='sf47.customer-work-billing-desk.v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>structuredClone(v), enc=encodeURIComponent;
const today=()=>new Date().toISOString().slice(0,10);
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function styles(){if(document.querySelector('link[data-work-billing-style]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href='/operations_work_billing.css';l.dataset.workBillingStyle='true';document.head.append(l);}
export function mountWorkBilling({container,current,api,saveApi=api,session={},mutationId,recordingActor,staffContext=currentStaffContext(),isCurrent=()=>true,onSources=()=>{},onWork=()=>{}}){
  styles();
  const context=staffContext?{...staffContext}:null,key=staffDeskStorageKey('sf47.work-billing.'+current.program.id,context);
  if(!session.loaded){try{Object.assign(session,JSON.parse(sessionStorage.getItem(key)||'{}'));}catch{}session.loaded=true;}
  session.inputs||={};session.lines||=[];session.authorityRates||=[];session.pending??=null;session.lastRequest??=null;session.requestHistory||=[];
  const root=document.createElement('section');root.className='work-billing';root.setAttribute('aria-label','Customer hourly Work billing');container.replaceChildren(root);
  const path='/api/operations/'+enc(current.program.id)+'/work-billing';
  const state={catalog:null,endpoints:[],customers:[],selected:null,preview:null,issuePreview:null,busy:false,message:'',error:false};
  let active=true,hostBusy=false;
  const visible=()=>active&&root.isConnected&&isCurrent();
  const input=(name,fallback='')=>session.inputs[name]??fallback;
  const button=(label,action,extra='',disabled=false)=>'<button type="button" data-eb-action="'+action+'" '+extra+(disabled?' data-fixed="true" disabled':'')+'>'+esc(label)+'</button>';
  const field=(name,label,fallback='',options={})=>{
    const value=input(name,fallback),attrs=' name="'+esc(name)+'"'+(options.required?' required':'');
    const selected=Array.isArray(value)?value:[String(value)];
    let control;
    if(options.options)control='<select'+attrs+(options.multiple?' multiple size="5"':'')+'>'+(options.multiple?'':'<option value="">Choose…</option>')+options.options.map(([id,title])=>'<option value="'+esc(id)+'"'+(selected.includes(String(id))?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>';
    else if(options.area)control='<textarea'+attrs+' rows="3">'+esc(value)+'</textarea>';
    else control='<input'+attrs+' type="'+(options.type||'text')+'" value="'+esc(value)+'">';
    return '<label class="eb-field"><span>'+esc(label)+'</span>'+control+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
  };
  function persist(required=false){try{const raw=JSON.stringify(session);sessionStorage.setItem(key,raw);if(sessionStorage.getItem(key)!==raw)throw new Error('Saved desk readback differs.');}catch(error){if(required)throw new Error('Save the complete desk before dispatch. Browser storage did not retain its original request: '+error.message);}}
  function capture(){
    root.querySelectorAll('[name]').forEach(e=>session.inputs[e.name]=e.multiple?[...e.selectedOptions].map(x=>x.value):e.value);
    root.querySelectorAll('[data-eb-line]').forEach(card=>{const row=session.lines[Number(card.dataset.ebLine)];if(!row)return;card.querySelectorAll('[data-line-field]').forEach(e=>row[e.dataset.lineField]=e.value);});
    root.querySelectorAll('[data-hourly-rate]').forEach(card=>{const row=session.authorityRates[Number(card.dataset.hourlyRate)];if(!row)return;card.querySelectorAll('[data-rate-field]').forEach(e=>row[e.dataset.rateField]=e.multiple?[...e.selectedOptions].map(o=>o.value):e.value);});
    persist();
  }
  function busy(){
    root.setAttribute('aria-busy',String(state.busy||hostBusy));
    root.querySelectorAll('button,input,select,textarea').forEach(e=>{
      const recovery=['resume','reconcile','revise-rejected','save-desk','save-request','refresh'].includes(e.dataset.ebAction);
      e.disabled=state.busy||hostBusy||e.dataset.fixed==='true'||Boolean(session.pending&&!recovery);
    });
  }
  async function run(fn){if(!visible()||state.busy||hostBusy)return;capture();state.busy=true;state.message='';state.error=false;busy();try{await fn();}catch(e){state.message=e.message||String(e);state.error=true;}finally{state.busy=false;persist();if(visible())render();}}
  function snapshot(){return{schema:SCHEMA,caseId:current.program.id,session:clone(session)};}
  function saveDesk(){capture();download(new Blob([JSON.stringify(snapshot(),null,2)+'\n'],{type:'application/json'}),current.program.id+'-work-billing-desk.json');}
  function validateOperation(op){
    if(!op||typeof op.body!=='object'||!op.body||typeof op.body.actor!=='string')throw new Error('Retain the complete original hourly billing request.');
    const expected=op.action==='connect'?'/api/operations/commercial-connections':op.action==='authority'?path+'/authorities':op.action==='prepare'?path+'/prepare':['apply','cancel','issue'].includes(op.action)&&/^work-billing-[a-f0-9]{32}$/.test(op.chargeId||'')?path+'/'+enc(op.chargeId)+'/'+op.action:null;
    if(!expected||op.endpoint!==expected)throw new Error('The saved request belongs to another original case or action.');
    assertStaffRequestActor(op.body,context);return op;
  }
  async function sendOriginal(op){
    if(op){if(session.pending)throw new Error('Reconcile the retained original request first.');validateOperation(op);session.pending={...clone(op),preparedAt:new Date().toISOString()};}
    const original=session.pending;if(!original)throw new Error('No original request is pending.');
    validateOperation(original);persist(true);
    let result;
    try{result=await saveApi(original.endpoint,clone(original.body));}
    catch(error){
      original.error={message:error.message,status:error.status||null,code:error.code||null};
      const codes=new Set(['INVALID_PLAN','WORK_BILLING_INPUT','WORK_BILLING_CONFLICT','WORK_BILLING_AUTHORITY_REVIEW','VERSION_CONFLICT','REQUEST_CONFLICT',
        'COMMERCIAL_INPUT_INVALID','COMMERCIAL_CONNECTION_REQUIRED','COMMERCIAL_CONNECTION_NOT_FOUND',
        'COMMERCIAL_CONNECTION_INVALID','COMMERCIAL_ACTOR_REQUIRED','COMMERCIAL_ENDPOINT_INVALID',
        'COMMERCIAL_CONNECTION_RETARGETED','COMMERCIAL_IDENTITY_CHANGED','COMMERCIAL_IDENTITY_UNAVAILABLE']);
      if(['prepare','connect','authority'].includes(original.action)&&[400,404,409,413,422].includes(error.status)&&codes.has(error.code)){
        original.definitivelyRejected=true;
      }
      const actionCode={apply:'WORK_BILLING_APPLY_REVIEW',issue:'WORK_BILLING_ISSUE_REVIEW',cancel:'WORK_BILLING_CANCEL_REVIEW'}[original.action];
      if(actionCode&&error.code===actionCode&&[400,404,409,413,422].includes(error.status)){
        original.reviewRefusal={code:error.code,status:error.status,receivedAt:new Date().toISOString()};
        try{await reconcile();}catch(readError){original.reconciliationError=readError.message;}
      }
      persist();throw error;
    }
    session.lastRequest={...clone(original),receivedAt:new Date().toISOString(),resultId:result.id||null};
    session.requestHistory.push(clone(session.lastRequest));session.pending=null;
    try{persist(true);}catch(error){session.pending={...original,acknowledgedResultId:result.id||null,persistenceError:error.message};persist();throw error;}
    return result;
  }
  async function readCustomers(){const id=input('endpointId');state.customers=id?(await api('/api/operations/commercial-connections/'+enc(id)+'/customers')).customers:[];}
  async function loadSelected(id,refresh=false){
    session.chargeId=id||null;
    state.selected=id?(refresh?await saveApi(path+'/'+enc(id)+'/refresh',{}):await api(path+'/'+enc(id))):null;
    state.issuePreview=null;session.inputs.creditDecisionId='';persist();
  }
  async function refresh(){
    const [catalog,endpoints]=await Promise.all([api(path),api('/api/operations/commercial-connections')]);
    state.catalog=catalog;state.endpoints=endpoints.endpoints;
    if(!input('endpointId')&&state.endpoints[0])session.inputs.endpointId=state.endpoints[0].id;
    await readCustomers();
    if(!input('authorityId')&&catalog.authorities.find(a=>a.current))session.inputs.authorityId=catalog.authorities.find(a=>a.current).authority.id;
    if(session.chargeId)await loadSelected(session.chargeId);
  }
  async function requestId(action,body){return await mutationId('work-billing:'+current.program.id+':'+action,body);}
  function selectedAuthority(){return state.catalog?.authorities.find(a=>a.authority.id===input('authorityId'))?.authority;}
  async function authorityBody(){
    const body={actor:recordingActor(),expectedVersion:state.catalog.version,terms:{
      title:input('a.title'),authorization:input('a.authorization'),authorizedOn:input('a.authorizedOn',today()),
      sourceIds:input('a.sourceIds',[]),endpointId:input('endpointId'),customerId:input('customerId'),
      currency:{code:input('a.currency','USD'),scale:Number(input('a.scale','2'))},
      periodStart:input('a.periodStart',today()),periodEnd:input('a.periodEnd',today()),
      rates:clone(session.authorityRates),rounding:input('a.rounding','EXACT'),
      hoursCap:input('a.hoursCap').trim()||null,amountCap:input('a.amountCap').trim()||null}};
    if(session.authorityPrevious){body.previousId=session.authorityPrevious.id;body.expectedAuthoritySha256=session.authorityPrevious.sha256;}
    body.requestId=await requestId('authority',body);return body;
  }
  async function formBody(){
    const authority=selectedAuthority();if(!authority)throw new Error('Select the actual retained customer hourly authority.');
    const body={actor:recordingActor(),expectedVersion:state.catalog.version,mode:input('mode','NEW'),
      authorityId:authority.id,expectedAuthoritySha256:authority.sha256,
      reason:input('reason'),issueDate:input('issueDate',today()),dueDate:input('dueDate',today()),
      effectiveDate:input('effectiveDate',today()),resolution:input('resolution','CREDIT'),purchaseOrder:input('purchaseOrder'),note:input('note'),
      lines:session.lines.map(row=>({workId:row.workId,expectedWorkSha256:row.expectedWorkSha256,
        rateId:row.rateId,hours:row.hours,description:row.description}))};
    if(session.previousId)body.previousId=session.previousId;
    body.requestId=await requestId('prepare',body);return body;
  }
  function currentPortion(row){return state.catalog.work.find(w=>w.record.id===row.workId)||null;}
  function selectedLine(portion){
    const record=portion.record,authority=selectedAuthority();
    const rate=authority?.terms.rates.find(r=>r.contributorIds.includes(record.contributorId)&&r.costIds.includes(record.costId));
    return{workId:record.id,expectedWorkSha256:portion.workSha256,rateId:rate?.id||'',
      hours:portion.availableHours,description:record.description,costId:record.costId,contributorId:record.contributorId};
  }
  function startNew(){
    if(session.pending)throw new Error('Reconcile the retained request first.');
    session.previousId=null;session.lines=[];session.inputs={...session.inputs,mode:'NEW',reason:'',creditDecisionId:''};
    state.preview=null;state.issuePreview=null;
  }
  function correction(mode){
    const row=state.selected;if(!row?.current)throw new Error('Open the current original hourly charge.');
    const p=row.proposal;
    session.previousId=row.id;session.inputs={...session.inputs,mode,authorityId:p.authority.id,
      issueDate:p.issueDate,dueDate:p.dueDate,effectiveDate:today(),reason:'',purchaseOrder:p.purchaseOrder,note:p.note,resolution:'CREDIT',creditDecisionId:''};
    session.lines=p.lines.map(line=>({workId:line.work.id,expectedWorkSha256:line.workSha256,rateId:line.rate.id,
      hours:mode==='VOID'?'0.0000':line.hours,description:line.description,costId:line.work.costId,contributorId:line.work.contributorId}));
    state.preview=null;state.issuePreview=null;
    state.message='Review each current Work edition and the original customer authority. Enter remaining hours; a credit or void may release revoked Work at zero hours.';
  }
  function lineEditor(){
    const authority=selectedAuthority(),rates=authority?.terms.rates||[];
    const selected=session.lines.map((row,i)=>{
      const live=currentPortion(row),changed=!live||live.workSha256!==row.expectedWorkSha256;
      const rateOptions=rates.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===row.rateId?' selected':'')+'>'+esc(r.label+' · '+r.hourlyRate+' '+authority.terms.currency.code+'/hour')+'</option>').join('');
      return '<article class="eb-line" data-eb-line="'+i+'"><h4>'+esc(row.workId)+' · '+esc(row.costId)+'</h4><p>'+esc(live?'Original '+live.record.hours+' hours; reserved '+live.reservedHours+'; available for a new charge '+live.availableHours+'; state '+live.record.state:'Original Work is absent from this case.')+'</p>'+
        (changed?'<p class="eb-warning">The original Work edition changed. Inspect and select its current edition before this review.</p>':'')+
        '<div class="eb-grid"><label class="eb-field"><span>Remaining hours</span><input data-line-field="hours" inputmode="decimal" value="'+esc(row.hours)+'"></label>'+
        '<label class="eb-field"><span>Actual customer hourly rate</span><select data-line-field="rateId"><option value="">Choose…</option>'+rateOptions+'</select></label>'+
        '<label class="eb-field"><span>Invoice description</span><textarea data-line-field="description" rows="3">'+esc(row.description)+'</textarea></label></div>'+
        '<div class="eb-actions">'+button('Review current Work edition','review-line','data-index="'+i+'"',!live)+button('Remove Work portion','remove-line','data-index="'+i+'"',['CREDIT','VOID'].includes(input('mode')))+'</div>'+
        '<details><summary>Original accepted Work</summary><pre>'+esc(JSON.stringify(live?.record||row,null,2))+'</pre></details></article>';
    }).join('');
    const choices=state.catalog.work.map((p,i)=>'<tr data-work-id="'+esc(p.record.id)+'"><td>'+esc(p.record.description)+'</td><td>'+esc(p.record.costId)+'</td><td>'+esc(p.record.state)+'</td><td>'+esc(p.record.hours)+'</td><td>'+esc(p.reservedHours)+'</td><td>'+esc(p.availableHours)+'</td><td>'+button('Select','select-line','data-index="'+i+'"',!p.selectable||p.availableHours==='0.0000'||session.lines.some(l=>l.workId===p.record.id)||['CREDIT','VOID'].includes(input('mode')))+'</td></tr>').join('');
    return '<h3>Original accepted CUSTOMER Work</h3><p>Every quantity uses the original Work ledger. Customer authority is separate from Work acceptance, contributor payables and planning estimates.</p>'+
      '<div class="eb-table"><table><thead><tr><th>Work</th><th>Package</th><th>State</th><th>Hours</th><th>Reserved</th><th>Available</th><th>Selection</th></tr></thead><tbody>'+choices+'</tbody></table></div>'+
      (selected||'<p>Select an accepted CUSTOMER-funded Work record and its actual retained hourly rate.</p>');
  }
  function previewPanel(){
    const review=state.preview;if(!review)return'';
    const p=review.proposal;
    return '<section class="eb-card"><h3>Review before preparation</h3><dl><dt>Customer</dt><dd>'+esc(p.customer.name)+'</dd><dt>Remaining customer amount</dt><dd>'+esc(p.amount+' '+p.currency.code)+'</dd><dt>Action</dt><dd>'+esc(p.mode)+'</dd><dt>Invoice date / due</dt><dd>'+esc(p.issueDate+' / '+p.dueDate)+'</dd><dt>Original account</dt><dd>'+esc(p.accountingIdentity.workspaceId)+'</dd><dt>Source snapshot</dt><dd>'+esc(p.sourceSnapshotSha256)+'</dd></dl>'+
      '<h4>Customer hourly authority</h4><p>'+esc(p.authorization)+'</p><pre>'+esc(JSON.stringify(p.authority.terms,null,2))+'</pre>'+
      '<h4>Exact native operations</h4><pre>'+esc(JSON.stringify(p.steps,null,2))+'</pre><p>'+esc(p.consequences.payments)+' '+esc(p.consequences.rounding)+'</p>'+
      '<details><summary>Selected full source files</summary><ul>'+p.sources.map(s=>'<li>'+esc((s.metadata.filename||s.id)+' · '+s.metadata.bytes+' bytes · '+s.metadata.sha256)+'</li>').join('')+'</ul></details>'+
      button('Prepare this exact source and customer review','prepare')+'</section>';
  }
  function selectedPanel(){
    const row=state.selected;if(!row)return'<p>Open a retained charge to continue its original native requests or prepare a correction.</p>';
    const p=row.proposal,canIssue=row.current&&row.state==='APPLIED'&&row.commands.some(c=>c.action==='draft');
    const commands=row.commands.map(c=>'<tr><td>'+esc(c.index+1)+'</td><td>'+esc(c.action)+'</td><td>'+esc(c.state)+'</td><td>'+esc(c.requestId)+'</td><td>'+esc(c.lastError?.message||c.acknowledgedAt||'')+'</td></tr>').join('');
    return '<section class="eb-card"><h3>'+esc(p.customer.name)+' · '+esc(row.state)+'</h3><dl><dt>Charge edition</dt><dd>'+esc(row.id+' / '+row.sequence)+'</dd><dt>Native invoice</dt><dd>'+esc(row.activeInvoiceId||p.invoiceId||'Draft not created')+'</dd><dt>Customer amount</dt><dd>'+esc(p.amount+' '+p.currency.code)+'</dd><dt>Original operator</dt><dd>'+esc(p.actor)+'</dd></dl>'+
      (row.current?'':'<p class="eb-warning">A later review is retained for this original charge. This edition remains readable in history.</p>')+
      '<div class="eb-actions">'+button('Refresh native invoice and payments','refresh-charge')+
      button('Apply / resume original native operations','apply','',!row.current||row.state==='CANCELLED')+
      button('Review invoice issue','preview-issue','',!canIssue)+
      button('Download full case and customer account','export')+'</div>'+
      '<div class="eb-table"><table><thead><tr><th>Order</th><th>Native action</th><th>Outcome</th><th>Original request</th><th>Latest result</th></tr></thead><tbody>'+commands+'</tbody></table></div>'+
      '<details><summary>Customer terms, source portions and complete journal</summary><h4>Terms</h4><p>'+esc(p.authorization)+'</p><h4>Hourly authority</h4><pre>'+esc(JSON.stringify(p.authority.terms,null,2))+'</pre><pre>'+esc(JSON.stringify({lines:p.lines,history:row.history,commands:row.commands,currentNative:row.currentNative||[]},null,2))+'</pre></details>'+
      '<h4>Reviewed continuation</h4><p>Corrections preserve original invoices and payment history. Pending corrections keep original Work exposure reserved until completed.</p><div class="eb-actions">'+
      ['DRAFT_EDIT','CREDIT','VOID','REPLACE'].map(mode=>button(({DRAFT_EDIT:'Correct unissued draft',CREDIT:'Credit remaining amounts',VOID:'Void original invoice',REPLACE:'Credit / void and replace'})[mode],'correct','data-mode="'+mode+'"',!row.current||row.state==='CANCELLED')).join('')+'</div>'+
      '<details><summary>Cancel an unused preparation</summary>'+field('cancelReason','Recorded cancellation reason','',{area:true})+button('Cancel retained unused preparation','cancel','',!row.current||row.state==='APPLIED'||row.commands.some(c=>c.state!=='REJECTED'))+'</details></section>';
  }
  function issuePanel(){
    const review=state.issuePreview;if(!review)return'';
    const native=review.nativePreview;
    return '<section class="eb-card"><h3>Exact native issue review</h3><p>Invoice '+esc(review.invoiceId)+' · revision '+esc(native.revision)+'</p><pre>'+esc(JSON.stringify(native.document,null,2))+'</pre>'+
      (native.creditReviewRequired?'<p>A current native credit-control decision is required for this issue.</p>'+field('creditDecisionId','Existing native credit-control decision ID'):'')+
      (review.retainedCommand?'<p>Continue the original retained issue request and its existing decision.</p>':'')+
      button('Issue this exact native invoice','issue')+'</section>';
  }
  function editAuthority(authority=null){
    const terms=authority?.terms;
    session.authorityPrevious=authority?{id:authority.id,sha256:authority.sha256}:null;
    session.authorityRates=terms?clone(terms.rates):[];
    for(const k of Object.keys(session.inputs))if(k.startsWith('a.'))delete session.inputs[k];
    if(terms){for(const k of ['title','authorization','authorizedOn','sourceIds','periodStart','periodEnd','rounding','hoursCap','amountCap'])session.inputs['a.'+k]=terms[k]??'';
      session.inputs.endpointId=terms.endpointId;session.inputs.customerId=terms.customerId;
      session.inputs['a.currency']=terms.currency.code;session.inputs['a.scale']=String(terms.currency.scale);}
    session.authorityOpen=true;
  }
  function authorityPanel(){
    const catalog=state.catalog;
    const scoped=(fieldName,values,options)=>'<select data-rate-field="'+fieldName+'" multiple size="4">'+options.map(([id,label])=>'<option value="'+esc(id)+'"'+(values.includes(id)?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
    const rows=session.authorityRates.map((rate,i)=>'<article class="eb-line" data-hourly-rate="'+i+'"><h4>Hourly rate '+(i+1)+'</h4><div class="eb-grid">'+
      '<label class="eb-field"><span>Rate label</span><input data-rate-field="label" value="'+esc(rate.label)+'"></label>'+
      '<label class="eb-field"><span>Customer amount per hour</span><input data-rate-field="hourlyRate" inputmode="decimal" value="'+esc(rate.hourlyRate)+'"></label>'+
      '<label class="eb-field"><span>Authorized contributors</span>'+scoped('contributorIds',rate.contributorIds,catalog.contributors.map(r=>[r.id,r.name]))+'</label>'+
      '<label class="eb-field"><span>Authorized work packages</span>'+scoped('costIds',rate.costIds,catalog.costs.map(r=>[r.id,r.label||r.name||r.id]))+'</label></div>'+
      button('Remove this rate','remove-rate','data-index="'+i+'"')+'</article>').join('');
    const selected=selectedAuthority();
    return '<section class="eb-card"><h3>Customer hourly authorities</h3><p>Retain the actual customer agreement once. Revisions preserve the same customer and cumulative caps; accepted Work is a separate original source.</p>'+
      field('authorityId','Selected retained authority','',{options:catalog.authorities.map(({authority:r,current})=>[r.id,r.terms.title+' · revision '+r.revision+(current?' · current':' · historical')])})+
      (selected?'<dl><dt>Customer</dt><dd>'+esc(selected.customer.name)+'</dd><dt>Service period</dt><dd>'+esc(selected.terms.periodStart+' – '+selected.terms.periodEnd)+'</dd><dt>Hours cap</dt><dd>'+esc(selected.terms.hoursCap??'No stated cap')+'</dd><dt>Amount cap</dt><dd>'+esc((selected.terms.amountCap??'No stated cap')+' '+selected.terms.currency.code)+'</dd><dt>Rounding</dt><dd>'+esc(selected.terms.rounding)+'</dd></dl><details><summary>Complete retained customer terms</summary><pre>'+esc(JSON.stringify(selected.terms,null,2))+'</pre></details>':'')+
      '<div class="eb-actions">'+button('Record new customer authority','new-authority')+button('Revise selected authority','edit-authority','',!selected)+'</div>'+
      '<details'+(session.authorityOpen?' open':'')+'><summary>'+esc(session.authorityPrevious?'Revised original customer authority':'New original customer authority')+'</summary>'+
      '<div class="eb-grid">'+field('endpointId','Original accounting connection','',{options:state.endpoints.map(r=>[r.id,r.label])})+
      field('customerId','Native customer','',{options:state.customers.map(r=>[r.id,r.name])})+
      field('a.title','Authority title')+field('a.authorization','Actual customer terms and interpretation','',{area:true})+
      field('a.sourceIds','Original customer agreement / authorization files',[],{multiple:true,options:catalog.sources.map(r=>[r.id,r.filename||r.name||r.id])})+
      field('a.authorizedOn','Authorization date',today(),{type:'date'})+
      field('a.currency','Native currency','USD')+field('a.scale','Native decimal precision','2',{type:'number'})+
      field('a.periodStart','Service period start',today(),{type:'date'})+field('a.periodEnd','Service period end',today(),{type:'date'})+
      field('a.rounding','Hourly line rounding','EXACT',{options:[['EXACT','Require exact native minor units'],['HALF_UP','Round each line half up']]})+
      field('a.hoursCap','Whole-authority hours cap','',{help:'Leave blank only when the actual terms state no cap.'})+
      field('a.amountCap','Whole-authority customer amount cap','',{help:'Applies across all original charge chains and receiving copies.'})+'</div>'+
      rows+'<div class="eb-actions">'+button('Add explicitly scoped hourly rate','add-rate')+
      button('Retain this customer authority','save-authority','',!session.authorityRates.length)+'</div></details></section>';
  }
  function render(){
    if(!visible())return;
    const catalog=state.catalog;
    root.innerHTML='<header><h2>Customer hourly Work billing</h2><p>Choose accepted original Work, review actual customer hourly authority, then create or correct native customer invoices.</p></header>'+
      '<div class="eb-actions">'+button('Refresh original records','refresh')+button('Original Work ledger','work')+button('Original source files','sources')+
      button('Save complete working desk','save-desk')+button('Open saved desk','open-desk')+'<input type="file" data-eb-open accept=".json,application/json" hidden></div>'+
      '<p class="eb-message" role="'+(state.error?'alert':'status')+'">'+esc(state.message)+'</p>'+
      (session.pending?'<section class="eb-card eb-warning"><h3>Original request retained</h3><p>'+esc(session.pending.action+' · '+(session.pending.body.requestId||session.pending.chargeId))+'</p><p>'+esc(session.pending.error?.message||'Waiting for the original response.')+'</p><div class="eb-actions">'+
        button('Resume same original request','resume')+button('Reconcile saved native outcome','reconcile','',!session.pending.chargeId)+button('Download original request','save-request')+
        (session.pending.definitivelyRejected?button('Retain refusal and revise selection','revise-rejected'):'')+'</div></section>':'')+
      (!catalog?'<p>Loading original Work and customer records…</p>':
        '<section class="eb-card"><h3>Retained customer hourly charges</h3><div class="eb-table"><table><thead><tr><th>Customer</th><th>Edition</th><th>State</th><th>Amount</th><th>Original charge</th></tr></thead><tbody>'+
        catalog.items.map(r=>'<tr><td>'+esc(r.customerName)+'</td><td>'+esc(r.sequence+' / '+r.mode)+'</td><td>'+esc(r.state+(r.pending?' · native response pending':''))+'</td><td>'+esc(r.amount+' '+r.currency.code)+'</td><td>'+button('Open','open-charge','data-id="'+esc(r.id)+'"')+'</td></tr>').join('')+
        '</tbody></table></div>'+button('Prepare another original Work charge','new')+'</section>'+selectedPanel()+issuePanel()+
        '<details class="eb-card"'+(!state.endpoints.length?' open':'')+'><summary>Original accounting connection</summary><p>The saved native account identity remains fixed when its service URL moves.</p><div class="eb-grid">'+
        field('connect.id','Connection ID')+field('connect.label','Connection label')+field('connect.baseUrl','Running native Receivables API URL')+'</div>'+button('Save original accounting connection','connect')+'</details>'+
        authorityPanel()+'<section class="eb-card"><h3>'+esc(session.previousId?'Source-backed hourly correction':'New customer hourly charge')+'</h3>'+
        (session.previousId?'<p>Previous original charge '+esc(session.previousId)+' · '+esc(input('mode'))+'</p>':'')+
        lineEditor()+'<div class="eb-grid">'+field('reason','Charge or correction reason','',{area:true})+
        field('issueDate','Invoice date',today(),{type:'date'})+field('dueDate','Due date',today(),{type:'date'})+
        field('effectiveDate','Correction effective date',today(),{type:'date'})+
        (input('mode')==='REPLACE'?field('resolution','Original invoice disposition','CREDIT',{options:[['CREDIT','Credit original remaining amount'],['VOID','Void unallocated original invoice']]}):'')+
        field('purchaseOrder','Customer purchase order')+field('note','Native invoice note','',{area:true})+'</div>'+
        button('Preview exact Work and native financial actions','preview','',!session.lines.length||!selectedAuthority())+'</section>'+previewPanel());
    busy();
  }
  async function reconcile(){
    const op=session.pending;if(!op?.chargeId)throw new Error('Resume the original preparation to retrieve its retained identity.');
    const row=await api(path+'/'+enc(op.chargeId));state.selected=row;session.chargeId=row.id;
    let confirmed=false,rejected=false;
    if(op.action==='apply'){confirmed=row.state==='APPLIED'&&row.proposalSha256===op.body.expectedProposalSha256;rejected=row.commands.length>0&&row.commands.at(-1).state==='REJECTED';}
    else if(op.action==='issue'){const c=[...row.commands].reverse().find(c=>c.action==='issue'&&c.review?.issuePreviewSha256===op.body.expectedIssuePreviewSha256);confirmed=c?.state==='ACKNOWLEDGED';rejected=c?.state==='REJECTED';}
    else if(op.action==='cancel')confirmed=row.state==='CANCELLED'&&row.history.some(h=>h.requestId===op.body.requestId);
    const refusalCode={apply:'WORK_BILLING_APPLY_REVIEW',issue:'WORK_BILLING_ISSUE_REVIEW',cancel:'WORK_BILLING_CANCEL_REVIEW'}[op.action];
    const reviewedRefusal=op.reviewRefusal?.code===refusalCode&&Boolean(refusalCode)&&
      row.id===op.chargeId&&!row.commands.some(command=>command.state==='PENDING')&&
      (op.action==='issue'||row.proposalSha256===op.body.expectedProposalSha256);
    if(reviewedRefusal&&!confirmed)rejected=true;
    if(rejected&&row.commands.some(command=>command.state==='PENDING'))rejected=false;
    if(confirmed||rejected){session.lastRequest={...clone(op),reconciledAt:new Date().toISOString(),outcome:confirmed?'ACKNOWLEDGED':'DEFINITIVELY_REJECTED'};session.requestHistory.push(clone(session.lastRequest));session.pending=null;try{persist(true);}catch(error){session.pending={...op,persistenceError:error.message};persist();throw error;}state.message=confirmed?'The original saved result is retained.':reviewedRefusal?'The original review request was refused before a new native dispatch. Existing financial commands remain retained; correct the current review.':'The native journal records a definite refusal. Review current source or credit-control terms before a new continuation.';}
    else state.message='The original outcome remains unresolved. Resume the same saved request; its native ID is unchanged.';
  }
  root.addEventListener('input',event=>{capture();if(!['creditDecisionId','cancelReason'].includes(event.target.name)){state.preview=null;state.issuePreview=null;}});
  root.addEventListener('change',event=>{if(event.target.name==='authorityId')run(async()=>{});if(event.target.name==='endpointId')run(async()=>{session.inputs.customerId='';await readCustomers();});});
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-eb-action]');if(!target)return;
    const action=target.dataset.ebAction;
    if(action==='save-desk'){saveDesk();return;}
    if(action==='open-desk'){root.querySelector('[data-eb-open]').click();return;}
    if(action==='save-request'){download(new Blob([JSON.stringify(session.pending||session.lastRequest,null,2)+'\n'],{type:'application/json'}),'original-work-billing-request.json');return;}
    run(async()=>{
      if(action==='refresh')await refresh();
      else if(action==='sources')await onSources();
      else if(action==='work')await onWork();
      else if(action==='new')startNew();
      else if(action==='new-authority')editAuthority();
      else if(action==='edit-authority'){editAuthority(selectedAuthority());await readCustomers();}
      else if(action==='add-rate')session.authorityRates.push({id:'rate-'+crypto.randomUUID(),label:'',contributorIds:[],costIds:[],hourlyRate:''});
      else if(action==='remove-rate')session.authorityRates.splice(Number(target.dataset.index),1);
      else if(action==='save-authority'){
        const body=await authorityBody(),result=await sendOriginal({action:'authority',endpoint:path+'/authorities',body});
        session.inputs.authorityId=result.id;session.authorityOpen=false;session.authorityPrevious=null;await refresh();
        state.message='Retained the original customer hourly terms and complete source. Choose accepted Work for a separate financial review.';
      }
      else if(action==='open-charge')await loadSelected(target.dataset.id);
      else if(action==='refresh-charge')await loadSelected(state.selected.id,true);
      else if(action==='select-line'){session.lines.push(selectedLine(state.catalog.work[Number(target.dataset.index)]));state.preview=null;}
      else if(action==='remove-line'){session.lines.splice(Number(target.dataset.index),1);state.preview=null;}
      else if(action==='review-line'){
        const row=session.lines[Number(target.dataset.index)],live=currentPortion(row);if(!live)throw new Error('Receive the actual original Work record first.');
        const releasing=['CREDIT','VOID'].includes(input('mode'))&&/^0(?:[.]0{1,4})?$/.test(row.hours);
        if(!releasing&&(live.record.state!=='ACCEPTED'||live.record.fundingBasis!=='CUSTOMER'))throw new Error('Positive billing requires accepted CUSTOMER-funded Work. A credit or void can release this record at zero hours.');
        row.expectedWorkSha256=live.workSha256;row.costId=live.record.costId;row.contributorId=live.record.contributorId;
        state.preview=null;state.message='Selected the current original Work edition. Review the remaining hours and actual customer rate.';
      }else if(action==='correct')correction(target.dataset.mode);
      else if(action==='preview'){const body=await formBody();state.preview=await saveApi(path+'/preview',body);state.preview.requestBody=body;}
      else if(action==='prepare'){
        if(!state.preview)throw new Error('Preview the current exact source before preparation.');
        const review=state.preview,body={...clone(review.requestBody),expectedPreviewSha256:review.previewSha256};
        const result=await sendOriginal({action:'prepare',endpoint:path+'/prepare',body});
        state.preview=null;session.chargeId=result.id;await refresh();state.message='Retained the full customer charge review; native financial actions are ready for explicit application.';
      }else if(action==='connect'){
        const body={id:input('connect.id'),label:input('connect.label'),baseUrl:input('connect.baseUrl'),actor:recordingActor()};
        body.requestId=await requestId('connect',body);const result=await sendOriginal({action:'connect',endpoint:'/api/operations/commercial-connections',body});
        session.inputs.endpointId=result.id;await refresh();
      }else if(action==='apply'){
        const row=state.selected;await sendOriginal({action,chargeId:row.id,endpoint:path+'/'+enc(row.id)+'/apply',body:{actor:recordingActor(),expectedProposalSha256:row.proposalSha256}});
        await refresh();state.message='The original native operations are acknowledged. An unissued draft still requires its own invoice issue review.';
      }else if(action==='cancel'){
        const row=state.selected,reason=input('cancelReason');if(!reason.trim())throw new Error('Enter the reason for cancelling this original preparation.');const body={actor:recordingActor(),expectedProposalSha256:row.proposalSha256,reason};
        body.requestId=await requestId('cancel:'+row.id,body);await sendOriginal({action,chargeId:row.id,endpoint:path+'/'+enc(row.id)+'/cancel',body});await refresh();
      }else if(action==='preview-issue')state.issuePreview=await saveApi(path+'/'+enc(state.selected.id)+'/preview-issue',{});
      else if(action==='issue'){
        const review=state.issuePreview;if(!review)throw new Error('Review the exact current native invoice first.');
        const body={actor:recordingActor(),expectedIssuePreviewSha256:review.issuePreviewSha256};
        const decision=review.retainedCommand?review.retainedCommand.body.creditDecisionId:(review.nativePreview.creditReviewRequired?input('creditDecisionId'):null);if(!review.retainedCommand&&review.nativePreview.creditReviewRequired&&!String(decision||'').trim())throw new Error('Enter the current native credit-control decision before issuing this invoice.');if(decision)body.creditDecisionId=decision;
        await sendOriginal({action,chargeId:state.selected.id,endpoint:path+'/'+enc(state.selected.id)+'/issue',body});await refresh();state.message='The original invoice issue is acknowledged by native Receivables.';
      }else if(action==='resume'){
        const original=clone(session.pending),result=await sendOriginal();if(original.action==='connect')session.inputs.endpointId=result.id;else if(original.action==='authority')session.inputs.authorityId=result.id;else session.chargeId=result.id||original.chargeId;
        await refresh();state.message='Reopened the original saved result.';
      }else if(action==='reconcile')await reconcile();
      else if(action==='revise-rejected'){
        if(!session.pending?.definitivelyRejected||!['prepare','connect','authority'].includes(session.pending.action))throw new Error('Reconcile the original native journal before a changed financial request.');
        const refusal={...clone(session.pending),outcome:'DEFINITIVELY_REJECTED',revisedAt:new Date().toISOString()};
        session.requestHistory.push(refusal);session.lastRequest=refusal;session.pending=null;state.preview=null;state.issuePreview=null;
        try{persist(true);}catch(error){session.pending={...refusal,persistenceError:error.message};persist();throw error;}state.message='The original refused request and complete error are retained. Refresh current sources, correct the selection and prepare a new exact preview.';
      }
      else if(action==='export'){
        const url=path+'/'+enc(state.selected.id)+'/export.zip';
        const response=await api(url,undefined,{download:true});
        download(await response.blob(),state.selected.id+'.zip');
      }
    });
  });
  root.addEventListener('change',event=>{
    if(!event.target.matches('[data-eb-open]'))return;
    const file=event.target.files?.[0];if(!file)return;
    run(async()=>{
      if(session.pending)throw new Error('Reconcile the current original request before opening another desk.');
      if(file.size>4*1024*1024)throw new Error('Open a complete working desk within 4 MiB.');
      const saved=JSON.parse(await file.text());
      if(saved.schema!==SCHEMA||saved.caseId!==current.program.id||!saved.session?.inputs||!Array.isArray(saved.session.lines))throw new Error('Choose this original case’s complete work-billing desk.');
      if(saved.session.pending)validateOperation(saved.session.pending);
      saved.session.requestHistory||=[];saved.session.authorityRates||=[];
      saveDesk();for(const k of Object.keys(session))delete session[k];Object.assign(session,clone(saved.session),{loaded:true});
      state.preview=null;state.issuePreview=null;persist(true);await refresh();state.message='Opened the original working desk and its retained request.';
    });
  });
  render();
  const ready=refresh().then(()=>{if(visible())render();});
  return{ready,dispose(){capture();active=false;root.remove();},setHostBusy(value){hostBusy=Boolean(value);if(visible())busy();}};
}

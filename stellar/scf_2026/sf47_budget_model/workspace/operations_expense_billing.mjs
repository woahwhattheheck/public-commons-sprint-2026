import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
const SCHEMA='sf47.customer-expense-billing-desk.v1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>structuredClone(v), enc=encodeURIComponent;
const today=()=>new Date().toISOString().slice(0,10);
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function styles(){if(document.querySelector('link[data-expense-billing-style]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href='/operations_expense_billing.css';l.dataset.expenseBillingStyle='true';document.head.append(l);}
export function mountExpenseBilling({container,current,api,saveApi=api,session={},mutationId,recordingActor,staffContext=currentStaffContext(),isCurrent=()=>true,onSources=()=>{},onExpenses=()=>{}}){
  styles();
  const context=staffContext?{...staffContext}:null,key=staffDeskStorageKey('sf47.expense-billing.'+current.program.id,context);
  if(!session.loaded){try{Object.assign(session,JSON.parse(sessionStorage.getItem(key)||'{}'));}catch{}session.loaded=true;}
  session.inputs||={};session.lines||=[];session.pending??=null;session.lastRequest??=null;session.requestHistory||=[];
  const root=document.createElement('section');root.className='expense-billing';root.setAttribute('aria-label','Customer expense recovery');container.replaceChildren(root);
  const path='/api/operations/'+enc(current.program.id)+'/expense-billing';
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
  function saveDesk(){capture();download(new Blob([JSON.stringify(snapshot(),null,2)+'\n'],{type:'application/json'}),current.program.id+'-expense-billing-desk.json');}
  function validateOperation(op){
    if(!op||typeof op.body!=='object'||!op.body||typeof op.body.actor!=='string')throw new Error('Retain the complete original expense billing request.');
    const expected=op.action==='connect'?'/api/operations/commercial-connections':op.action==='prepare'?path+'/prepare':['apply','cancel','issue'].includes(op.action)&&/^expense-billing-[a-f0-9]{32}$/.test(op.chargeId||'')?path+'/'+enc(op.chargeId)+'/'+op.action:null;
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
      const codes=new Set(['INVALID_PLAN','EXPENSE_BILLING_INPUT','EXPENSE_BILLING_CONFLICT','VERSION_CONFLICT','REQUEST_CONFLICT',
        'COMMERCIAL_INPUT_INVALID','COMMERCIAL_CONNECTION_REQUIRED','COMMERCIAL_CONNECTION_NOT_FOUND',
        'COMMERCIAL_CONNECTION_INVALID','COMMERCIAL_ACTOR_REQUIRED','COMMERCIAL_ENDPOINT_INVALID',
        'COMMERCIAL_CONNECTION_RETARGETED','COMMERCIAL_IDENTITY_CHANGED','COMMERCIAL_IDENTITY_UNAVAILABLE']);
      if(['prepare','connect'].includes(original.action)&&[400,404,409,413,422].includes(error.status)&&codes.has(error.code)){
        original.definitivelyRejected=true;
      }
      const actionCode={apply:'EXPENSE_BILLING_APPLY_REVIEW',issue:'EXPENSE_BILLING_ISSUE_REVIEW',cancel:'EXPENSE_BILLING_CANCEL_REVIEW'}[original.action];
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
    if(session.chargeId)await loadSelected(session.chargeId);
  }
  async function requestId(action,body){return await mutationId('expense-billing:'+current.program.id+':'+action,body);}
  async function formBody(){
    const body={actor:recordingActor(),expectedVersion:state.catalog.version,mode:input('mode','NEW'),
      sourceIds:input('sourceIds',[]),authorization:input('authorization'),authorizedOn:input('authorizedOn',today()),
      creditReviewNote:input('creditReviewNote'),reason:input('reason'),issueDate:input('issueDate',today()),dueDate:input('dueDate',today()),
      effectiveDate:input('effectiveDate',today()),resolution:input('resolution','CREDIT'),purchaseOrder:input('purchaseOrder'),note:input('note'),
      lines:session.lines.map(row=>({attributionId:row.attributionId,expectedContentSha256:row.expectedContentSha256,
        costId:row.costId,nativeAmount:row.nativeAmount,amountBasis:row.amountBasis,amount:row.amount,description:row.description}))};
    if(session.previousId)body.previousId=session.previousId;
    else Object.assign(body,{endpointId:input('endpointId'),customerId:input('customerId'),currency:{code:input('currency','USD'),scale:Number(input('scale','2'))}});
    body.requestId=await requestId('prepare',body);return body;
  }
  function currentPortion(row){
    const found=state.catalog.portions.find(p=>p.attribution.id===row.attributionId&&p.allocation.costId===row.costId);
    if(found)return found;
    const attribution=state.catalog.attributions?.find(a=>a.id===row.attributionId);
    if(attribution&&['CREDIT','VOID'].includes(input('mode')))return{attribution,allocation:{costId:row.costId,fundingBasis:'CUSTOMER',nativeAmount:'0',usdValue:'0.00'},availableNativeAmount:'0'};
    return null;
  }
  function selectedLine(portion){
    const a=portion.attribution,p=portion.allocation;
    return{attributionId:a.id,expectedContentSha256:a.contentSha256,costId:p.costId,
      nativeAmount:portion.availableNativeAmount,amountBasis:'AGREED_AMOUNT',amount:'',
      description:'Expense recovery: '+p.costId+' / '+a.source.sourceLineId,sourceLineId:a.source.sourceLineId};
  }
  function startNew(){
    if(session.pending)throw new Error('Reconcile the retained request first.');
    session.previousId=null;session.lines=[];session.inputs={endpointId:input('endpointId'),customerId:input('customerId'),currency:'USD',scale:'2',mode:'NEW'};
    state.preview=null;state.issuePreview=null;session.inputs.creditDecisionId='';
  }
  function correction(mode){
    const row=state.selected;if(!row?.current)throw new Error('Open the current original charge review.');
    const p=row.proposal;
    session.previousId=row.id;session.inputs={...session.inputs,mode,endpointId:p.endpointId,customerId:p.customerId,currency:p.currency.code,scale:String(p.currency.scale),
      issueDate:p.issueDate,dueDate:p.dueDate,effectiveDate:today(),authorizedOn:today(),sourceIds:p.authorizationSourceIds,
      authorization:'',creditReviewNote:'',reason:'',purchaseOrder:p.purchaseOrder,note:p.note,resolution:'CREDIT'};
    session.lines=p.lines.map(line=>({attributionId:line.attribution.id,expectedContentSha256:line.attribution.contentSha256,
      costId:line.allocation.costId,nativeAmount:mode==='VOID'?'0':line.nativeAmount,amountBasis:'AGREED_AMOUNT',
      amount:mode==='VOID'?'0':line.amount,description:line.description,sourceLineId:line.attribution.source.sourceLineId}));
    state.preview=null;state.issuePreview=null;session.inputs.creditDecisionId='';
    state.message='Review the current source edition for every retained portion, enter the remaining customer amounts, and attach the actual correction terms.';
  }
  function lineEditor(){
    const selected=session.lines.map((row,i)=>{
      const live=currentPortion(row),changed=!live||live.attribution.contentSha256!==row.expectedContentSha256;
      const inputLine=(name,label,type='text')=>'<label class="eb-field"><span>'+esc(label)+'</span><input data-line-field="'+name+'" type="'+type+'" value="'+esc(row[name])+'"></label>';
      return '<article class="eb-line" data-eb-line="'+i+'"><h4>'+esc(row.costId)+' · '+esc(row.sourceLineId)+'</h4><p>'+esc(live?'Current customer allocation: '+live.allocation.nativeAmount+' native units; available for a new charge: '+live.availableNativeAmount:'The current customer allocation is absent.')+'</p>'+
        (changed?'<p class="eb-warning">The original expense review has changed. Read its current source and explicitly select the current reviewed edition.</p>':'')+
        '<div class="eb-grid">'+inputLine('nativeAmount','Native expense units reserved after this review')+
        '<label class="eb-field"><span>Customer amount basis</span><select data-line-field="amountBasis"><option value="AGREED_AMOUNT"'+(row.amountBasis==='AGREED_AMOUNT'?' selected':'')+'>Explicitly agreed amount</option><option value="REVIEWED_USD"'+(row.amountBasis==='REVIEWED_USD'?' selected':'')+'>Exact reviewed USD cost</option></select></label>'+
        inputLine('amount','Remaining customer amount ('+esc(input('currency','USD'))+')')+
        inputLine('description','Native invoice description')+'</div><div class="eb-actions">'+
        button('Review current expense edition','review-line','data-index="'+i+'"',!live)+
        button('Remove portion','remove-line','data-index="'+i+'"',['CREDIT','VOID'].includes(input('mode')))+
        '</div><details><summary>Original source and valuation</summary><pre>'+esc(JSON.stringify(live?{source:live.attribution.source,allocation:live.allocation,valuation:live.attribution.valuation,review:live.attribution.review}:row,null,2))+'</pre></details></article>';
    }).join('');
    const choices=state.catalog.portions.map((p,i)=>'<tr><td>'+esc(p.allocation.costId)+'</td><td>'+esc(p.attribution.source.sourceLineId)+'</td><td>'+esc(p.attribution.state)+'</td><td>'+esc(p.allocation.nativeAmount)+'</td><td>'+esc(p.reservedNativeAmount)+'</td><td>'+esc(p.availableNativeAmount)+'</td><td>'+button('Select','select-line','data-index="'+i+'"',!p.selectable||p.availableNativeAmount==='0'||session.lines.some(l=>l.attributionId===p.attribution.id&&l.costId===p.allocation.costId)||['CREDIT','VOID'].includes(input('mode')) )+'</td></tr>').join('');
    return '<h3>Original customer-funded expense portions</h3><p>Native units retain the issued expense quantity. Customer invoice amounts use the selected currency and the retained commercial terms. No exchange rate or markup is inferred.</p>'+
      '<div class="eb-table"><table><thead><tr><th>Work package</th><th>Original line</th><th>Review</th><th>Allocated units</th><th>Reserved units</th><th>Available units</th><th>Selection</th></tr></thead><tbody>'+choices+'</tbody></table></div>'+
      (selected||'<p>Select a current reviewed CUSTOMER portion. Receive and review original expense files in Buyer Expenses first.</p>');
  }
  function previewPanel(){
    const review=state.preview;if(!review)return'';
    const p=review.proposal;
    return '<section class="eb-card"><h3>Review before preparation</h3><dl><dt>Customer</dt><dd>'+esc(p.customer.name)+'</dd><dt>Remaining customer amount</dt><dd>'+esc(p.amount+' '+p.currency.code)+'</dd><dt>Action</dt><dd>'+esc(p.mode)+'</dd><dt>Invoice date / due</dt><dd>'+esc(p.issueDate+' / '+p.dueDate)+'</dd><dt>Original account</dt><dd>'+esc(p.accountingIdentity.workspaceId)+'</dd><dt>Source snapshot</dt><dd>'+esc(p.sourceSnapshotSha256)+'</dd></dl>'+
      '<h4>Commercial authorization</h4><p>'+esc(p.authorization)+'</p><h4>Buyer credits review</h4><p>'+esc(p.creditReviewNote)+'</p>'+
      '<h4>Exact native operations</h4><pre>'+esc(JSON.stringify(p.steps,null,2))+'</pre><p>'+esc(p.consequences.payments)+' '+esc(p.consequences.issue)+'</p>'+
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
      '<details><summary>Customer terms, source portions and complete journal</summary><h4>Terms</h4><p>'+esc(p.authorization)+'</p><h4>Buyer credits review</h4><p>'+esc(p.creditReviewNote)+'</p><pre>'+esc(JSON.stringify({lines:p.lines,history:row.history,commands:row.commands,currentNative:row.currentNative||[]},null,2))+'</pre></details>'+
      '<h4>Reviewed continuation</h4><p>Corrections preserve original invoices and payment history. Pending corrections keep original expense exposure reserved until completed.</p><div class="eb-actions">'+
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
  function render(){
    if(!visible())return;
    const catalog=state.catalog;
    root.innerHTML='<header><h2>Customer expense recovery</h2><p>Review original buyer cost portions, retain the customer’s commercial terms, then create or correct native receivables.</p></header>'+
      '<div class="eb-actions">'+button('Refresh original records','refresh')+button('Buyer Expenses','expenses')+button('Original source files','sources')+button('Save complete working desk','save-desk')+button('Open saved desk','open-desk')+'<input type="file" data-eb-open accept=".json,application/json" hidden></div>'+
      '<p class="eb-message" role="'+(state.error?'alert':'status')+'">'+esc(state.message)+'</p>'+
      (session.pending?'<section class="eb-card eb-warning"><h3>Original request retained</h3><p>'+esc(session.pending.action+' · '+(session.pending.body.requestId||session.pending.chargeId))+'</p><p>'+esc(session.pending.error?.message||'Waiting for the original response.')+'</p><div class="eb-actions">'+button('Resume same original request','resume')+button('Reconcile saved native outcome','reconcile','',!session.pending.chargeId)+button('Download original request','save-request')+(session.pending.definitivelyRejected?button('Retain refusal and revise selection','revise-rejected'):'')+'</div></section>':'')+
      (!catalog?'<p>Loading original expense and customer records…</p>':
      '<section class="eb-card"><h3>Retained customer charges</h3><div class="eb-table"><table><thead><tr><th>Customer</th><th>Edition</th><th>State</th><th>Amount</th><th>Original charge</th></tr></thead><tbody>'+catalog.items.map(r=>'<tr><td>'+esc(r.customerName)+'</td><td>'+esc(r.sequence+' / '+r.mode)+'</td><td>'+esc(r.state+(r.pending?' · native response pending':''))+'</td><td>'+esc(r.amount+' '+r.currency.code)+'</td><td>'+button('Open','open-charge','data-id="'+esc(r.id)+'"')+'</td></tr>').join('')+'</tbody></table></div>'+button('Prepare another original expense charge','new')+'</section>'+
      selectedPanel()+issuePanel()+
      '<details class="eb-card"'+(!state.endpoints.length?' open':'')+'><summary>Original accounting connection</summary><p>The saved account identity stays fixed when its local service URL changes.</p><div class="eb-grid">'+field('connect.id','Connection ID')+field('connect.label','Connection label')+field('connect.baseUrl','Running native Receivables API URL')+'</div>'+button('Save original accounting connection','connect')+'</details>'+
      '<section class="eb-card"><h3>'+esc(session.previousId?'Source-backed correction':'New customer charge')+'</h3>'+
      (session.previousId?'<p>Previous original charge: '+esc(session.previousId)+' · '+esc(input('mode'))+'</p>':'<div class="eb-grid">'+
      field('endpointId','Accounting connection','',{options:state.endpoints.map(x=>[x.id,x.label])})+
      field('customerId','Native customer','',{options:state.customers.map(x=>[x.id,x.name])})+
      field('currency','Native currency','USD')+field('scale','Currency decimal places','2',{type:'number'})+'</div>')+
      lineEditor()+'<h3>Actual customer authorization</h3><div class="eb-grid">'+
      field('sourceIds','Original customer terms / authorization files',[],{options:catalog.sources.map(s=>[s.id,s.filename||s.name||s.id]),multiple:true,required:true})+
      field('authorization','Customer charge terms and interpretation','',{area:true,required:true})+
      field('authorizedOn','Authorization date',today(),{type:'date',required:true})+
      field('reason','Charge or correction reason','',{area:true,required:true})+
      field('creditReviewNote','Review of original buyer credits and remaining customer amount','',{area:true,required:true})+
      field('issueDate','Invoice date',today(),{type:'date'})+field('dueDate','Due date',today(),{type:'date'})+
      field('effectiveDate','Correction effective date',today(),{type:'date'})+
      (input('mode')==='REPLACE'?field('resolution','Original invoice disposition','CREDIT',{options:[['CREDIT','Credit original remaining amount'],['VOID','Void unallocated original invoice']]}):'')+
      field('purchaseOrder','Customer purchase order')+field('note','Native invoice note','',{area:true})+'</div>'+
      '<details><summary>Current original buyer credits ('+catalog.buyerCredits.length+')</summary><pre>'+esc(JSON.stringify(catalog.buyerCredits,null,2))+'</pre></details>'+
      button('Preview exact source and native financial actions','preview','',!session.lines.length)+'</section>'+previewPanel());
    busy();
  }
  async function reconcile(){
    const op=session.pending;if(!op?.chargeId)throw new Error('Resume the original preparation to retrieve its retained identity.');
    const row=await api(path+'/'+enc(op.chargeId));state.selected=row;session.chargeId=row.id;
    let confirmed=false,rejected=false;
    if(op.action==='apply'){confirmed=row.state==='APPLIED'&&row.proposalSha256===op.body.expectedProposalSha256;rejected=row.commands.length>0&&row.commands.at(-1).state==='REJECTED';}
    else if(op.action==='issue'){const c=[...row.commands].reverse().find(c=>c.action==='issue'&&c.review?.issuePreviewSha256===op.body.expectedIssuePreviewSha256);confirmed=c?.state==='ACKNOWLEDGED';rejected=c?.state==='REJECTED';}
    else if(op.action==='cancel')confirmed=row.state==='CANCELLED'&&row.history.some(h=>h.requestId===op.body.requestId);
    const refusalCode={apply:'EXPENSE_BILLING_APPLY_REVIEW',issue:'EXPENSE_BILLING_ISSUE_REVIEW',cancel:'EXPENSE_BILLING_CANCEL_REVIEW'}[op.action];
    const reviewedRefusal=op.reviewRefusal?.code===refusalCode&&Boolean(refusalCode)&&
      row.id===op.chargeId&&!row.commands.some(command=>command.state==='PENDING')&&
      (op.action==='issue'||row.proposalSha256===op.body.expectedProposalSha256);
    if(reviewedRefusal&&!confirmed)rejected=true;
    if(rejected&&row.commands.some(command=>command.state==='PENDING'))rejected=false;
    if(confirmed||rejected){session.lastRequest={...clone(op),reconciledAt:new Date().toISOString(),outcome:confirmed?'ACKNOWLEDGED':'DEFINITIVELY_REJECTED'};session.requestHistory.push(clone(session.lastRequest));session.pending=null;try{persist(true);}catch(error){session.pending={...op,persistenceError:error.message};persist();throw error;}state.message=confirmed?'The original saved result is retained.':reviewedRefusal?'The original review request was refused before a new native dispatch. Existing financial commands remain retained; correct the current review.':'The native journal records a definite refusal. Review current source or credit-control terms before a new continuation.';}
    else state.message='The original outcome remains unresolved. Resume the same saved request; its native ID is unchanged.';
  }
  root.addEventListener('input',event=>{capture();if(!['creditDecisionId','cancelReason'].includes(event.target.name)){state.preview=null;state.issuePreview=null;}});
  root.addEventListener('change',event=>{if(event.target.name==='endpointId')run(async()=>{session.inputs.customerId='';await readCustomers();});});
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-eb-action]');if(!target)return;
    const action=target.dataset.ebAction;
    if(action==='save-desk'){saveDesk();return;}
    if(action==='open-desk'){root.querySelector('[data-eb-open]').click();return;}
    if(action==='save-request'){download(new Blob([JSON.stringify(session.pending||session.lastRequest,null,2)+'\n'],{type:'application/json'}),'original-expense-billing-request.json');return;}
    run(async()=>{
      if(action==='refresh')await refresh();
      else if(action==='sources')await onSources();
      else if(action==='expenses')await onExpenses();
      else if(action==='new')startNew();
      else if(action==='open-charge')await loadSelected(target.dataset.id);
      else if(action==='refresh-charge')await loadSelected(state.selected.id,true);
      else if(action==='select-line'){session.lines.push(selectedLine(state.catalog.portions[Number(target.dataset.index)]));state.preview=null;}
      else if(action==='remove-line'){session.lines.splice(Number(target.dataset.index),1);state.preview=null;}
      else if(action==='review-line'){
        const row=session.lines[Number(target.dataset.index)],live=currentPortion(row);if(!live)throw new Error('Receive and review the current original expense first.');
        if(live.attribution.state!=='REVIEWED'||live.attribution.bookkeepingChanged)throw new Error('Complete the original Buyer Expenses review before billing this edition.');
        row.expectedContentSha256=live.attribution.contentSha256;
        if(BigInt(row.nativeAmount)>BigInt(live.allocation.nativeAmount))row.nativeAmount=live.allocation.nativeAmount;
        if(row.nativeAmount==='0')row.amount='0';
        state.preview=null;state.message='Selected the current reviewed source. Verify the explicit remaining customer amount.';
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
        const original=clone(session.pending),result=await sendOriginal();if(original.action==='connect')session.inputs.endpointId=result.id;else session.chargeId=result.id||original.chargeId;
        await refresh();state.message='Reopened the original saved result.';
      }else if(action==='reconcile')await reconcile();
      else if(action==='revise-rejected'){
        if(!session.pending?.definitivelyRejected||!['prepare','connect'].includes(session.pending.action))throw new Error('Reconcile the original native journal before a changed financial request.');
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
      if(saved.schema!==SCHEMA||saved.caseId!==current.program.id||!saved.session?.inputs||!Array.isArray(saved.session.lines))throw new Error('Choose this original case’s complete expense-billing desk.');
      if(saved.session.pending)validateOperation(saved.session.pending);
      saved.session.requestHistory||=[];
      saveDesk();for(const k of Object.keys(session))delete session[k];Object.assign(session,clone(saved.session),{loaded:true});
      state.preview=null;state.issuePreview=null;persist(true);await refresh();state.message='Opened the original working desk and its retained request.';
    });
  });
  render();
  const ready=refresh().then(()=>{if(visible())render();});
  return{ready,dispose(){capture();active=false;root.remove();},setHostBusy(value){hostBusy=Boolean(value);if(visible())busy();}};
}

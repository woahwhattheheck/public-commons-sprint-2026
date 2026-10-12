// MIT. Customer operations in the original industrial STAC analyst interface.
import {mountCommissioning} from './commissioning/view.mjs';
import {mountDeploymentPolicy} from './policy-view.mjs';
const sessions=new Map();
const routes={DISCOVER:'/source/discover',BIND_EDITION:'/editions/bind',CAPTURE:'/editions/capture',
  ACQUIRE_SELECTED:'/assets/acquire',PREPARE_DELIVERY:'/delivery/review',STAGE_MERCHANT:'/merchant/stage'};
function el(tag,props={},...children) {
  const item=document.createElement(tag);
  for(const [name,value]of Object.entries(props)) {
    if(value===null||value===undefined)continue;
    if(name==='class')item.className=value;
    else if(name.startsWith('on'))item.addEventListener(name.slice(2),value);
    else if(['value','disabled','checked'].includes(name))item[name]=value;
    else item.setAttribute(name,String(value));
  }
  const append=child=>{if(Array.isArray(child))child.forEach(append);else if(child!==null&&child!==undefined)item.append(child instanceof Node?child:document.createTextNode(String(child)));};
  children.forEach(append);return item;
}
const field=(label,input,help)=>el('label',{class:'eoapi-field'},el('span',{},label),input,help?el('small',{},help):null);
const details=(label,value)=>el('details',{},el('summary',{},label),el('pre',{},JSON.stringify(value,null,2)));
const options=(rows,current,label)=>rows.map(row=>el('option',{value:row.id,selected:row.id===current?'selected':null},label(row)));
const download=(value,name)=>{const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=el('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const required=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new Error(label+' is required.');return value;};

export function mountEoapi(element,{api,workspace,editionId}={}) {
  const key=workspace.id;
  if(!sessions.has(key))sessions.set(key,{reviewer:'',editionId:editionId??'',sourceReviewId:'',deliveryReviewId:'',
    deliveryApprovalId:'',target:'upstream',maxBytes:'16777216',origin:'',payment:'',customerDirectory:'',outputDirectory:'',view:'onboarding'});
  const form=sessions.get(key);let state=null,native=workspace,closed=false,commissioningMount=null,policyMount=null,busy=false;
  const note=el('p',{class:'eoapi-message',role:'status'}),body=el('div',{class:'eoapi-body'});
  element.classList.add('eoapi-panel');element.replaceChildren(note,body);
  const input=(name,props={})=>el('input',{value:form[name]??'',...props,oninput:event=>{form[name]=event.target.value;}});
  const select=(name,rows,label)=>{const node=el('select',{onchange:event=>{form[name]=event.target.value;}} ,options(rows,form[name],label));
    if(!rows.some(row=>row.id===form[name])){form[name]=rows[0]?.id??'';node.value=form[name];}return node;};
  async function call(path,data) {return api('/api/eoapi'+path,{method:'POST',body:data});}
  async function operation(path,data) {
    const saved=JSON.stringify({path,data}),storageKey='eoapi-action:'+key;
    let journal;try{journal=JSON.parse(sessionStorage.getItem(storageKey)||'[]');}catch{journal=[];}
    let row=journal.find(item=>item.saved===saved);
    if(!row){row={saved,operationId:crypto.randomUUID()};journal.push(row);sessionStorage.setItem(storageKey,JSON.stringify(journal));
      if(sessionStorage.getItem(storageKey)!==JSON.stringify(journal))throw new Error('The browser could not save this operation for recovery.');}
    return call(path,{...data,operationId:row.operationId});
  }
  async function action(run,label) {
    if(busy)return;busy=true;note.setAttribute('role','status');note.textContent=label+'…';body.querySelectorAll('button[data-eoapi-action]').forEach(button=>button.disabled=true);
    try {
      const result=await run();
      if(closed)return;
      note.textContent=result?.status==='PARTIAL'?'The original capture has more pages. Resume the same operation below.':label+' complete.';
      if(result?.schema==='starforge.stac-eoapi-source-review.v1')form.sourceReviewId=result.id;
      if(result?.schema==='starforge.stac-eoapi-delivery-review.v1')form.deliveryReviewId=result.id;
      if(result?.id?.startsWith('eoapi-delivery-approval-'))form.deliveryApprovalId=result.id;
      if(result?.editionId&&native.editions.some(item=>item.id===result.editionId))form.editionId=result.editionId;
      form.lastResult=result;
      await reload();
    }catch(error){if(!closed){note.textContent=error.message||String(error);note.setAttribute('role','alert');await reload().catch(()=>{});}}
    finally{busy=false;if(!closed)body.querySelectorAll('button[data-eoapi-action]').forEach(button=>button.disabled=false);}
  }
  const button=(label,run,title=label)=>el('button',{type:'button','data-eoapi-action':'',disabled:busy,onclick:()=>void action(run,title)},label);
  function policyView() {
    const p=state.policies,approved=p.approvals.find(item=>item.id===p.currentApprovalId);
    const draft=p.draft?.policy;
    return el('section',{class:'panel'},el('h3',{},'1. Deployment configuration'),
      el('p',{},'Edit the deployment, identity, ordered access rules and collection rights in the complete policy workspace.'),
      draft?el('dl',{class:'summary-list'},el('dt',{},'Configuration'),el('dd',{},draft.title),
        el('dt',{},'Customer endpoint'),el('dd',{},draft.deployment.publicUrl),
        el('dt',{},'Upstream catalog'),el('dd',{},draft.upstream.url),
        el('dt',{},'Current approval'),el('dd',{},approved?.id??'Review and approve this configuration')):null,
      button('Open deployment policy',async()=>{form.view='policy';return {view:form.view};}));
  }
  async function componentDispatch(prefix,{method,path,body,signal}) {
    try{return {status:200,body:await api('/api/eoapi'+prefix+path,{method,body,signal})};}
    catch(error){return {status:error.status??500,body:{error:error.code??'EOAPI_POLICY_REQUEST_FAILED',
      ...(error.field?{field:error.field}:{})}};}
  }
  async function policySaved(value) {
    if(closed)return;
    form.reviewer=value.approval?.reviewer??form.reviewer;
    state=await api('/api/eoapi/state');
    note.textContent='Deployment approval '+value.approval.id+' is available for source review and commissioning.';
  }
  function sourceView() {
    const value=state.onboarding,p=state.policies;
    const editions=native.editions.filter(item=>item.status==='COMPLETE');
    const panel=el('section',{class:'panel'},el('h3',{},'2. Source and scene edition'),
      el('p',{},'Use the retained catalog and analyst edition, or capture an approved saved query.'),
      el('div',{class:'eoapi-grid'},field('Reviewer',input('reviewer',{placeholder:'Operator name'})),
        field('Source being reviewed',select('target',[{id:'upstream'},{id:'deployment'}],row=>row.id==='upstream'?'Upstream catalog':'Customer deployment')),
        field('Captured edition',select('editionId',editions,row=>row.id+' · '+row.itemsCount+' scenes'))),
      el('p',{class:'muted'},native.endpoint));
    const reviews=value.sourceReviews;
    panel.append(el('div',{class:'actions'},
      button('Review retained catalog',()=>call('/source/review',{approvalId:p.currentApprovalId,
        ...(form.editionId?{editionId:form.editionId}:{}),target:form.target,reviewer:required(form.reviewer,'Reviewer')})),
      button('Refresh source catalog',()=>operation('/source/discover',{approvalId:p.currentApprovalId,target:form.target}))));
    if(reviews.length) {
      panel.append(field('Saved source review',select('sourceReviewId',reviews,row=>row.id+' · '+(row.ready?'Ready':'Correction required'))));
      const reviewed=reviews.find(row=>row.id===form.sourceReviewId);
      if(reviewed)panel.append(details('Source findings',reviewed.findings));
      panel.append(el('div',{class:'actions'},
        button('Associate captured edition',()=>operation('/editions/bind',{sourceReviewId:required(form.sourceReviewId,'Source review'),editionId:required(form.editionId,'Captured edition')}))));
      if(native.queries.length) {
        const query=select('queryId',native.queries,row=>row.name);
        panel.append(field('Saved analyst query',query),button('Capture reviewed query',()=>{
          const selected=native.queries.find(row=>row.id===form.queryId);if(!selected)throw new Error('Choose a saved query.');
          return operation('/editions/capture',{sourceReviewId:required(form.sourceReviewId,'Source review'),query:selected});
        }));
      }
    }
    return panel;
  }
  function deliveryView() {
    const value=state.onboarding,edition=native.editions.find(item=>item.id===form.editionId);
    const selected=native.decisions.filter(item=>item.editionId===form.editionId&&item.status==='SELECTED');
    const panel=el('section',{class:'panel'},el('h3',{},'3. Selected files and customer delivery'),
      el('p',{},selected.length+' selected scenes in '+(edition?.id??'the chosen edition')+'. Record each intended asset in Scenes & assets before acquiring files.'),
      field('Maximum bytes per source file',input('maxBytes',{type:'number',min:1,max:2147483648})),
      el('div',{class:'actions'},
        button('Acquire selected files',()=>operation('/assets/acquire',{editionId:required(form.editionId,'Captured edition'),maxBytes:Number(form.maxBytes)})),
        button('Prepare delivery review',()=>operation('/delivery/review',{editionId:required(form.editionId,'Captured edition'),reviewer:required(form.reviewer,'Reviewer')}))));
    if(value.deliveryReviews.length) {
      panel.append(field('Immutable delivery review',select('deliveryReviewId',value.deliveryReviews,row=>row.id+' · '+row.files+' files')),
        button('Inspect reviewed files',async()=>{const review=await api('/api/eoapi/delivery/reviews/'+encodeURIComponent(form.deliveryReviewId));form.selectedReview=review;return review;}),
        button('Approve selected delivery',()=>call('/delivery/approve',{reviewId:required(form.deliveryReviewId,'Delivery review'),reviewer:required(form.reviewer,'Reviewer'),expectedRevision:value.revision})));
      if(form.selectedReview)panel.append(details('Complete reviewed file selection',form.selectedReview.edition));
    }
    if(value.deliveryApprovals.length) {
      panel.append(field('Delivery approval',select('deliveryApprovalId',value.deliveryApprovals,row=>row.id+' · '+row.reviewer)));
      const payment=el('textarea',{rows:5,value:form.payment,placeholder:'Original payment terms JSON',oninput:event=>{form.payment=event.target.value;}});
      panel.append(el('details',{},el('summary',{},'Stage the original merchant'),
        field('Public merchant origin',input('origin',{type:'url',placeholder:'https://customer-service.example'})),
        field('Agreed payment terms',payment,'Use the existing merchant terms for this customer delivery.'),
        button('Stage approved edition',()=>operation('/merchant/stage',{deliveryApprovalId:form.deliveryApprovalId,
          origin:required(form.origin,'Merchant origin'),payment:JSON.parse(required(form.payment,'Payment terms')),path:'/stac'}))));
      panel.append(el('h4',{},'Package the received customer files'),
        el('p',{},'Use the completed customer folder produced by the original merchant and Buyer workflow.'),
        el('div',{class:'eoapi-grid'},field('Original customer delivery folder',input('customerDirectory')),
          field('Customer handover folder',input('outputDirectory'))),
        el('div',{class:'actions'},
          button('Export customer handover',()=>call('/delivery/export',{deliveryApprovalId:form.deliveryApprovalId,
            customerDirectory:required(form.customerDirectory,'Original customer delivery folder'),directory:required(form.outputDirectory,'Customer handover folder')})),
          button('Reopen customer handover',()=>call('/delivery/open',{directory:required(form.outputDirectory,'Customer handover folder')}))));
    }
    if(value.deliveries.length)panel.append(details('Saved customer delivery folders',value.deliveries));
    return panel;
  }
  function operationsView() {
    const rows=Object.values(state.onboarding.operations).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const panel=el('section',{class:'panel'},el('h3',{},'Saved operations'),
      el('p',{},'Continue the same saved operation after an interrupted request or a partially received source.'));
    const table=el('table',{},el('thead',{},el('tr',{},['Operation','Phase','State','Action'].map(text=>el('th',{},text)))));
    const body=el('tbody');
    for(const row of rows)body.append(el('tr',{},el('td',{},row.kind,el('small',{},row.id)),el('td',{},row.phase),el('td',{},row.status),
      el('td',{},routes[row.kind]?button(row.status==='COMPLETE'?'Read saved result':'Resume operation',async()=>{
        const record=await api('/api/eoapi/operations/'+encodeURIComponent(row.id));
        return record.status==='COMPLETE'?record.result:call(routes[record.kind],{...record.input,operationId:record.id});
      }):null)));
    table.append(body);panel.append(el('div',{class:'table-wrap'},table));return panel;
  }
  function render() {
    if(closed)return;
    commissioningMount?.destroy?.();commissioningMount=null;policyMount?.destroy?.();policyMount=null;
    const navigation=el('nav',{class:'actions'},
      button('Customer onboarding',async()=>{form.view='onboarding';return {view:form.view};}),
      button('Deployment policy',async()=>{form.view='policy';return {view:form.view};}),
      state.commissioning?button('Deployment commissioning',async()=>{form.view='commissioning';return {view:form.view};}):null,
      button('Refresh saved workspace',()=>Promise.resolve({refreshed:true})));
    body.replaceChildren(el('h2',{},'Customer imagery operations'),navigation);
    if(form.view==='policy') {
      const panel=el('div');body.append(panel);
      policyMount=mountDeploymentPolicy(panel,{reviewer:form.reviewer,
        dispatch:request=>componentDispatch('/policy',request),onApproval:policySaved,onReceived:policySaved});
    }else if(form.view==='commissioning'&&state.commissioning) {
      const panel=el('div');body.append(panel);
      commissioningMount=mountCommissioning(panel,{principals:['anonymous',...state.source.principals.filter(row=>row.authenticated).map(row=>row.id)],
        dispatch:request=>componentDispatch('/commissioning',request)});
    }else{
      body.append(policyView(),sourceView(),deliveryView(),operationsView());
      if(form.lastResult)body.append(details('Last saved operation result',form.lastResult));
    }
  }
  async function reload() {
    const [fresh,original]=await Promise.all([api('/api/eoapi/state'),api('/api/state')]);
    if(closed)return;state=fresh;native=original.workspace;
    if(form.view==='policy'&&policyMount)await policyMount.refresh();
    else if(form.view==='commissioning'&&commissioningMount)await commissioningMount.refresh();
    else render();
  }
  void reload().catch(error=>{note.textContent=error.message;note.setAttribute('role','alert');});
  return {refresh:reload,destroy(){closed=true;commissioningMount?.destroy?.();policyMount?.destroy?.();}};
}

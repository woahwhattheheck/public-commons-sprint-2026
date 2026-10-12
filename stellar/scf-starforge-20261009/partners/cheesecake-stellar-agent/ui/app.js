/* MIT. Operator views call the selected original application; native code owns every attempt. */
'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const state={token:'',identity:null,requests:[],selected:null,tab:'review',search:'',
    reviews:new Map(),outcomes:new Map(),artifacts:new Map(),spending:new Map(),errors:new Map(),running:new Set(),
    inflight:new Set(),connected:false,generation:0,noticeTimer:null};
  function node(tag,attributes={},...children) {
    const element=document.createElement(tag);
    for(const [key,value] of Object.entries(attributes)) {
      if(value===undefined||value===null||value===false)continue;
      if(key==='class')element.className=value;
      else if(key==='text')element.textContent=value;
      else if(key.startsWith('on')&&typeof value==='function')element.addEventListener(key.slice(2),value);
      else if(['value','checked','disabled','hidden'].includes(key))element[key]=value;
      else element.setAttribute(key,value===true?'':String(value));
    }
    for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)
      element.append(child instanceof Node?child:document.createTextNode(String(child)));
    return element;
  }
  const pretty=value=>JSON.stringify(value,null,2);
  const valueText=value=>value===null||value===undefined?'—':typeof value==='object'?pretty(value):String(value);
  function button(label,action,attributes={}) {
    return node('button',{type:'button',...attributes,onclick:()=>void run(action)},label);
  }
  function kv(rows) {
    return node('dl',{class:'kv'},rows.map(([key,value,mono])=>[
      node('dt',{},key),node('dd',{},mono?node('code',{},valueText(value)):valueText(value))]));
  }
  function section(title,...children){return node('section',{class:'section'},node('h3',{},title),children);}
  function rawDetails(label,data) {
    return node('details',{},node('summary',{},label),node('pre',{class:'compact'},typeof data==='string'?data:pretty(data)));
  }
  function notice(message,code) {
    clearTimeout(state.noticeTimer);
    const area=$('notice');area.hidden=false;
    area.replaceChildren(node('div',{},message,code?node('code',{},code):null),button('Dismiss',()=>{area.hidden=true;}));
    if(!code)state.noticeTimer=setTimeout(()=>{area.hidden=true;},6000);
  }
  async function run(action) {
    try {return await action();}
    catch(error){notice(error.message??'The operation could not complete.',error.code??'APPLICATION_CLIENT_ERROR');}
  }
  function disconnect({quiet=false}={}) {
    state.generation+=1;
    for(const controller of state.inflight)controller.abort();
    state.inflight.clear();state.token='';state.identity=null;state.requests=[];state.selected=null;
    state.reviews.clear();state.outcomes.clear();state.artifacts.clear();state.spending.clear();state.errors.clear();state.running.clear();
    state.connected=false;$('access-token').value='';$('application').hidden=true;$('access').hidden=false;
    $('connection').replaceChildren(node('span',{},'Disconnected'));
    if($('execute-dialog').open)$('execute-dialog').close();
    if(!quiet)notice('Operator connection closed.');
  }
  async function api(path,payload,{binary=false}={}) {
    const controller=new AbortController();state.inflight.add(controller);
    try {
      const response=await fetch(path,{method:payload===undefined?'GET':'POST',credentials:'omit',
        headers:{Authorization:'Bearer '+state.token,...(payload===undefined?{}:{'Content-Type':'application/json'})},
        ...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:controller.signal,cache:'no-store'});
      if(!response.ok) {
        let result;try{result=await response.json();}catch{result={};}
        const problem=result.error??{};
        if(response.status===401)disconnect({quiet:true});
        throw Object.assign(new Error(problem.message??('The host returned HTTP '+response.status+'.')),
          {code:problem.code??'HTTP_'+response.status,status:response.status});
      }
      return binary?{blob:await response.blob(),sha256:response.headers.get('x-response-sha256')}:await response.json();
    } finally {state.inflight.delete(controller);}
  }
  function selected(){return state.requests.find(request=>request.intentId===state.selected);}
  const remote=request=>request.requestKind==='mcp';
  const requestName=request=>remote(request)?request.label??request.toolName:request.method;
  const amount=request=>request.acceptedTerms?.amount??request.acceptedTerms?.maxAtomic;
  const responseLimit=request=>request.responseByteLimit??1048576;
  function requestState(request) {
    const outcome=state.outcomes.get(request.intentId);
    return outcome?.operation?.state??outcome?.state??request.state?.state??'AVAILABLE';
  }
  function path(intent,action){return '/api/requests/'+encodeURIComponent(intent)+'/'+action;}
  function updateRequest(outcome,intent) {
    const request=state.requests.find(row=>row.intentId===intent);
    if(request&&outcome.operation)request.state={...request.state,...outcome.operation};
  }
  async function refreshRequests({announce=false}={}) {
    const result=await api('/api/requests');
    state.requests=result.requests;
    if(!state.requests.some(request=>request.intentId===state.selected))
      state.selected=state.requests[0]?.intentId??null;
    renderRequests();renderDetail();
    if(announce)notice('Reopened '+state.requests.length+' original request states.');
  }
  async function connect(event) {
    event.preventDefault();
    const token=$('access-token').value;
    if(token.length<24)throw Object.assign(new Error('Enter the receiving host token, at least 24 characters.'),{code:'ACCESS_TOKEN_REQUIRED'});
    const submit=$('access-form').querySelector('button');submit.disabled=true;submit.textContent='Connecting…';
    state.token=token;
    try {
      const identity=await api('/api/application');
      state.identity=identity;await refreshRequests();
      state.connected=true;$('access-token').value='';$('access').hidden=true;$('application').hidden=false;
      renderIdentity();renderIntegration();
      $('connection').replaceChildren(node('span',{},'Connected · '+identity.subject),
        button('Disconnect',()=>disconnect()));
      notice('Original application handoff opened.');
    } catch(error) {
      state.token='';throw error;
    } finally {submit.disabled=false;submit.textContent='Connect';}
  }
  function renderIdentity() {
    const identity=state.identity;if(!identity)return;
    $('identity').replaceChildren(
      node('div',{class:'identity-main'},node('p',{class:'eyebrow'},'RECEIVING APPLICATION'),
        node('strong',{},identity.applicationId),
        node('p',{class:'muted'},'Operator profile: '+(identity.operatorProfileConfigured?'selected by the host':'none selected'))),
      node('div',{class:'identity-meta'},node('p',{class:'eyebrow'},'RETAINED HANDOFF'),
        node('code',{},identity.handoffId),
        node('p',{class:'muted'},'Manifest SHA-256'),node('code',{},identity.manifestSha256)));
  }
  function renderRequests() {
    const search=state.search.trim().toLowerCase();
    const requests=state.requests.filter(request=>[request.intentId,request.method,request.toolName,request.label,request.url,requestState(request)]
      .join(' ').toLowerCase().includes(search));
    $('request-count').textContent=requests.length+' of '+state.requests.length+' selected requests';
    $('request-list').replaceChildren(...requests.map(request=>button('',()=>{
      state.selected=request.intentId;state.tab='review';renderRequests();renderDetail();
    },{class:'request-choice','aria-current':String(request.intentId===state.selected),
      'aria-label':'Open '+request.intentId})));
    [...$('request-list').children].forEach((element,index)=>{
      const request=requests[index];element.append(node('strong',{},requestName(request)),
        node('span',{class:'request-id'},request.intentId),
        node('span',{class:'request-state'},requestState(request)));
    });
    if(!requests.length)$('request-list').append(node('p',{class:'muted'},'No selected request matches this search.'));
  }
  function bodyPanel(request) {
    return section(remote(request)?'Exact MCP tool arguments':'Exact request body',
      kv([['Body bytes',request.bodyBytes],['Body SHA-256',request.bodySha256,true]]),
      node('pre',{},request.bodyText),
      node('div',{class:'actions'},button('Copy request body',async()=>{
        await navigator.clipboard.writeText(request.bodyText);notice('Exact retained request body copied.');
      })));
  }
  function termsPanel(request) {
    const terms=request.acceptedTerms??{};
    return section('Accepted payment terms',kv([
      ['Scheme',terms.scheme],['Payment network',terms.network??request.paymentNetwork],
      ['Asset',terms.asset,true],['Pay to',terms.payTo,true],['Maximum atomic amount',terms.amount??terms.maxAtomic],
      ['Maximum timeout',terms.maxTimeoutSeconds===undefined?'—':terms.maxTimeoutSeconds+' seconds']]),
      rawDetails('All retained terms',terms));
  }
  function reviewPanel(request) {
    const review=state.reviews.get(request.intentId),busy=state.running.has(request.intentId);
    return node('div',{class:'tab-content',role:'tabpanel','aria-label':'Request review'},
      section('Selected request',kv([
        ['Intent',request.intentId,true],
        ...(remote(request)?[['Protocol','Remote MCP'],['Tool',request.toolName],['Transport',request.transport],
          ['Endpoint',request.url],['Payment resource',request.paymentResourceUrl,true],
          ['Tool schema SHA-256',request.inputSchemaSha256,true]]:
          [['RPC method',request.method],['HTTP request','POST '+request.url],['Data network',request.dataNetwork],
            ['Release',request.releaseId,true],['Release digest',request.releaseDigest,true]]),
        ['Payment network',request.paymentNetwork],
        ['Source config SHA-256',request.configSha256,true]])),
      termsPanel(request),bodyPanel(request),
      section(remote(request)?'Original MCP quote and spending review':'Original buyer review',
        review?node('div',{class:'review-note'},node('strong',{},'Original review complete'),
          kv([['Reviewed at',review.review?.reviewedAt],['Native mode',review.review?.native?.mode],
            ['Body binding',review.binding?.bodySha256,true],['Operation config binding',review.binding?.configSha256,true]])):
          node('p',{class:'empty'},'Open the original review to inspect the saved native binding and current receiving configuration.'),
        review?rawDetails('Complete original review',review):null,
        review?.review?.spending?rawDetails('Original aggregate spending preview',review.review.spending):null,
        node('div',{class:'actions'},
          button(review?'Refresh original review':'Run original review',()=>perform('review'),{disabled:busy}),
          button('Execute or recover',()=>executionDialog(request),{class:'primary',disabled:busy||!review})),
        node('p',{class:'muted'},'Execution enters this original intent and the receiving operator’s current approval and signer configuration.')));
  }
  function operationPanel(request) {
    const outcome=state.outcomes.get(request.intentId),operation=outcome?.operation??request.state??{},
      result=outcome?.result,busy=state.running.has(request.intentId),
      spending=state.spending.get(request.intentId)??outcome?.spending??result?.reconciliation?.spending;
    return node('div',{class:'tab-content',role:'tabpanel','aria-label':'Original operation'},
      section('Current original operation',kv([
        ['State',requestState(request)],['Phase',outcome?.phase],['Source',outcome?.source],
        ['Native status',operation.nativeStatus],['Delivery status',operation.deliveryStatus],
        ['Result recoverable',operation.resultRecoverable===undefined?'—':String(operation.resultRecoverable)],
        ['Native attempt',operation.attemptRecorded===undefined?'See the original state below':String(operation.attemptRecorded)]]),
        node('div',{class:'actions'},button('Read current status',()=>perform('status'),{disabled:busy&&!remote(request)}),
          button('Recover original operation',()=>perform('recover'),{disabled:busy}),
          remote(request)?button('Cancel remote quote',()=>perform('cancel'),
            {disabled:!operation.quoteId&&!state.reviews.has(request.intentId)}):null),
        node('p',{class:'muted'},'Status and recovery reopen the same native operation and its saved attempt.')),
      remote(request)?section('Aggregate spending and payment',
        kv([['Original quote',operation.quoteId??state.reviews.get(request.intentId)?.binding?.quoteId,true],
          ['Signed dispatch',operation.signedRequestDispatched===undefined?'—':String(operation.signedRequestDispatched)],
          ['Ledger outcome',spending?.outcome],['Original transaction',result?.paymentResponse?.transaction,true],
          ['Transfer observation',result?.reconciliation?.outcome]]),
        node('div',{class:'actions'},button('Read aggregate spending',()=>perform('spending'),
          {disabled:!operation.quoteId&&!state.reviews.has(request.intentId)}),
          button('Reconcile original payment',()=>perform('reconcile'),
            {disabled:busy||operation.signedRequestDispatched!==true})),
        spending?rawDetails('Complete original spending record',spending):null,
        result?.reconciliation?rawDetails('Original transaction observation',result.reconciliation):null,
        node('p',{class:'muted'},'The same native quote and original SF36 ledger remain attached after restart. Reconciliation records the original transaction and finalizes its reservation.')):null,
      result?section('Returned native outcome',kv([
        ['Recorded at',result.recordedAt],['Native status',result.status],['Successful',String(result.ok)],
        ['Exit code',result.exitCode],['Runtime error',result.runtimeError],
        ['Response status',result.delivery?.status],['Response bytes',result.delivery?.bytes],
        ['Response SHA-256',result.delivery?.sha256,true]])):null,
      section('Original state record',node('pre',{},pretty(outcome??request.state??{state:'AVAILABLE'}))));
  }
  function resultPanel(request) {
    const artifact=state.artifacts.get(request.intentId),busy=state.running.has(request.intentId);
    const format=node('select',{'aria-label':'Result format',id:'result-format'},
      ['json','text','base64','file'].map(name=>node('option',{value:name},name==='file'?'Verified metadata':name.toUpperCase())));
    format.value=artifact?.format??'json';
    const limit=node('input',{id:'result-limit',type:'number',min:1,max:responseLimit(request),step:1,value:responseLimit(request),'aria-label':'Result byte limit'});
    return node('div',{class:'tab-content',role:'tabpanel','aria-label':'Retained result'},
      section('Read the retained response',
        node('p',{},'Open the saved response through the original buyer’s verification and decoding methods.'),
        node('div',{class:'result-options'},
          node('div',{},node('label',{for:'result-format'},'View format'),format),
          node('div',{},node('label',{for:'result-limit'},'Maximum bytes'),limit)),
        node('div',{class:'actions'},
          button('Read retained result',()=>perform('read',{format:format.value,limitBytes:Number(limit.value)}),{disabled:busy}),
          button('Download response',()=>downloadResult(request),{disabled:busy})),
        artifact?null:node('p',{class:'empty'},'A retained response will appear here after the original execution produces one.')),
      artifact?section('Verified response metadata',kv([
        ['Native status',artifact.result?.nativeStatus],
        ...(remote(request)?[['Representation',artifact.result?.representation]]:[['HTTP status',artifact.result?.httpStatus]]),
        ['Recorded at',artifact.result?.recordedAt],['Delivery',artifact.result?.deliveryStatus],
        ['Bytes',artifact.result?.file?.bytes],['SHA-256',artifact.result?.file?.sha256,true],
        ['Content type',artifact.result?.file?.contentType],['Format',artifact.format],
        ['Partial',String(artifact.partial)]])):null,
      artifact?section(artifact.format==='file'?'Verification result':'Response content',
        node('pre',{},artifact.format==='file'?pretty(artifact.result):
          typeof artifact.data==='string'?artifact.data:pretty(artifact.data)),
        rawDetails('Complete retained artifact',artifact)):null);
  }
  function renderDetail() {
    const request=selected(),detail=$('detail');
    if(!request){detail.replaceChildren(node('p',{class:'empty'},'Select an authorized request from the retained handoff.'));return;}
    const tabs=node('div',{class:'tabs',role:'tablist','aria-label':'Request views'},
      [['review','Review'],['operation','Operation'],['result','Result']].map(([key,label])=>
        button(label,()=>{state.tab=key;renderDetail();},{role:'tab','aria-selected':String(state.tab===key),
          id:'tab-'+key,'aria-controls':'request-tab-content'})));
    const content=state.tab==='operation'?operationPanel(request):
      state.tab==='result'?resultPanel(request):reviewPanel(request);
    content.id='request-tab-content';content.setAttribute('aria-labelledby','tab-'+state.tab);
    const error=state.errors.get(request.intentId);
    detail.replaceChildren(...[node('div',{class:'detail-head'},node('div',{},
      node('p',{class:'eyebrow'},'SELECTED ORIGINAL INTENT'),node('h2',{},requestName(request)),
      node('p',{class:'muted'},request.intentId)),node('span',{class:'status-badge'},
        state.running.has(request.intentId)?'OPERATION IN PROGRESS':requestState(request))),tabs,
      error?node('div',{class:'review-note'},node('strong',{},error.message),node('code',{class:'mono'},error.code)):null,
      content].filter(value=>value!==null));
  }
  async function perform(action,options={}) {
    const intent=state.selected,generation=state.generation;
    const background=state.running.has(intent)&&['status','cancel','spending'].includes(action);
    if(!intent||state.running.has(intent)&&!background)return;
    if(!background)state.running.add(intent);state.errors.delete(intent);
    if(action==='read')state.tab='result';
    else if(action!=='review')state.tab='operation';
    renderDetail();
    try {
      const result=await api(path(intent,action),options);
      if(generation!==state.generation)return;
      if(action==='review')state.reviews.set(intent,result);
      else if(action==='read')state.artifacts.set(intent,result);
      else {state.outcomes.set(intent,result);updateRequest(result,intent);}
      if(result.spending)state.spending.set(intent,result.spending);
      if(result.review?.spending)state.spending.set(intent,result.review.spending);
      if(result.result?.reconciliation?.spending)state.spending.set(intent,result.result.reconciliation.spending);
      await refreshRequests();
      const messages={review:'Original request review opened.',status:'Original operation status refreshed.',
        recover:'Original operation recovered.',execute:'Original execution or recovery returned.',read:'Retained response verified and opened.',
        cancel:'Original quote cancellation recorded.',spending:'Original aggregate spending refreshed.',
        reconcile:'Original payment observation and spending record refreshed.'};
      notice(messages[action]);
      return result;
    } catch(error) {
      if(generation===state.generation)state.errors.set(intent,{code:error.code??'APPLICATION_CLIENT_ERROR',message:error.message});
      throw error;
    } finally {
      if(!background)state.running.delete(intent);
      if(generation===state.generation){renderRequests();renderDetail();}
    }
  }
  function executionDialog(request) {
    const dialog=$('execute-dialog'),review=state.reviews.get(request.intentId);
    if(!review)return;
    const accept=node('input',{type:'checkbox','aria-label':'Confirm exact original request'});
    const execute=button('Continue original operation',async()=>{
      if(!accept.checked)return;
      dialog.close();await perform('execute');
    },{class:'primary',disabled:true});
    accept.addEventListener('change',()=>{execute.disabled=!accept.checked;});
    dialog.replaceChildren(node('p',{class:'eyebrow'},'ORIGINAL BUYER EXECUTION'),
      node('h2',{id:'execute-title'},'Continue '+request.intentId+'?'),
      node('p',{},'The current host authority is checked again before the receiving operator runs or recovers this same saved intent.'),
      section('Reviewed selection',kv([['Request',remote(request)?request.toolName+' · '+request.url:'POST '+request.url],
        ...(remote(request)?[['Transport',request.transport],['Payment resource',request.paymentResourceUrl,true]]:[]),
        ['Payment network',request.paymentNetwork],['Maximum atomic amount',amount(request)],
        ['Body SHA-256',request.bodySha256,true],['Native review',review.review?.reviewedAt]])),
      node('label',{class:'confirmation'},accept,
        node('span',{},'Run this exact request through the receiving operator’s current approval and signer configuration.')),
      node('div',{class:'dialog-actions'},button('Cancel',()=>dialog.close()),execute));
    dialog.showModal();
  }
  async function downloadResult(request) {
    if(state.running.has(request.intentId))return;
    state.running.add(request.intentId);renderDetail();
    try {
      const result=await api(path(request.intentId,'download'),undefined,{binary:true});
      const url=URL.createObjectURL(result.blob),anchor=node('a',{href:url,download:
        request.intentId.replaceAll(/[^A-Za-z0-9._-]/g,'_')+'.response'});
      document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notice('Original retained response downloaded.'+(result.sha256?' SHA-256 '+result.sha256.slice(0,16)+'…':''));
    } finally {state.running.delete(request.intentId);renderDetail();}
  }
  function renderIntegration() {
    const identity=state.identity,endpoint=location.origin+identity.mcp.path;
    const configuration={type:'http',url:endpoint,headers:{Authorization:'Bearer '+'$'+'{STELLAR_APP_ACCESS_TOKEN}'}};
    $('integration').replaceChildren(
      node('div',{class:'integration-row'},node('div',{},node('h2',{},'Application and MCP integration'),
        node('p',{class:'muted'},identity.mcp.tools.length+' maintained tools · protocol '+identity.mcp.protocolVersion)),
        button('Copy connection',async()=>{await navigator.clipboard.writeText(pretty(configuration));notice('Connection template copied.');})),
      rawDetails('Connection template',configuration),
      rawDetails('Available original tools',identity.mcp.tools),
      node('details',{},node('summary',{},'HTTP request contract'),
        node('pre',{},pretty({list:{method:'GET',path:'/api/requests'},
          action:{method:'POST',path:'/api/requests/{intentId}/{'+identity.actions.filter(name=>name!=='read').join('|')+'}',body:{}},
          read:{method:'POST',path:'/api/requests/{intentId}/read',body:{format:'json',limitBytes:identity.remoteMcp?2097152:1048576}},
          authentication:'Authorization: Bearer <receiving host token>',
          receivingContext:'The host selects the authenticated subject; the application checks current authority for every action.'}))));
  }
  $('access-form').addEventListener('submit',event=>void run(()=>connect(event)));
  $('request-search').addEventListener('input',event=>{state.search=event.target.value;renderRequests();});
  $('refresh').addEventListener('click',()=>void run(()=>refreshRequests({announce:true})));
  window.addEventListener('pagehide',()=>{state.token='';});
})();

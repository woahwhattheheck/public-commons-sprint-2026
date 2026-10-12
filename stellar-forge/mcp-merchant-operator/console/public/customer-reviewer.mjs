// MIT. Complete reviewer delivery in the original authenticated Merchant Console.
const PREFIX='merchant_grant_reviewer_';
const MUTATIONS=new Set(['review','review_export','receive','buyer_open','buyer_close','export']);
const MAX_PACKET_BYTES=8*1024*1024;
const canonical=value=>JSON.stringify(sort(value));
function sort(value){
  if(Array.isArray(value))return value.map(sort);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])]));
}
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');
const encode=value=>new TextEncoder().encode(value);
const b64=bytes=>{let value='';for(let at=0;at<bytes.length;at+=32768)value+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(value);};
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
export function reviewerCustomerSelection(call,result){
  if(!call.tool?.startsWith(PREFIX)||result?.schema!=='stellar-forge.grant-reviewer-merchant-result.v1'||
    result.retention?.state!=='COMPLETE'||!/^[a-f0-9]{64}$/.test(result.exportId??'')||
    !/^[a-f0-9]{64}$/.test(result.manifestSha256??''))return null;
  const args=JSON.parse(call.argumentsJson);
  return {family:'grant-reviewer',workspace:args.workspace,exportId:result.exportId,
    expectedManifestSha256:result.manifestSha256};
}
export function createReviewerCustomerPage({state,$,node,text,pretty,when,properties,action,busy,api,notice,uid,
  requireProfile,loadProfile,openCall,fillCustomer,receiveCustomer,download,setPage,useRecipe}){
  const panel=node('section',undefined,'panel');panel.id='reviewer-customer';panel.hidden=true;
  const heading=node('div',undefined,'section-heading');
  const title=node('div');title.append(node('p','Original saved purchase','eyebrow'),node('h3','Reviewer customer delivery'));
  heading.append(title);panel.append(heading,
    node('p','Inspect the original packet, use its retained Buyer results and carry the same receiving packet to another operator. Each action uses the existing saved request history.'));
  $('page-customers').insertBefore(panel,$('page-customers').children[1]??null);
  const own={identity:null,session:null,workspaces:[],workspace:'',snapshot:null,detail:null,selectionId:null,
    last:null,pending:false,actions:[],recovery:null,recipe:null,epoch:0};
  const ui={},gates=[];
  function block(title){const section=node('section',undefined,'panel');section.append(node('h4',title));panel.append(section);return section;}
  function field(parent,label,id,type='text',value=''){
    const wrap=node('div'),control=type==='select'?node('select'):node('input');
    control.id=id;control.setAttribute('aria-label',label);
    if(type!=='select')control.type=type;
    control.value=value;const lab=node('label',label);lab.htmlFor=id;wrap.append(lab,control);parent.append(wrap);ui[id]=control;return control;
  }
  function button(parent,label,id,fn,{ready=()=>true,primary=false}={}){
    const value=node('button',label,primary?'primary':undefined);value.id=id;value.type='button';parent.append(value);ui[id]=value;
    gates.push([value,ready]);action(value,()=>exclusive(fn));return value;
  }
  function details(parent,label,value){
    const d=node('details'),s=node('summary',label);d.append(s,node('pre',typeof value==='string'?value:pretty(value)));parent.append(d);return d;
  }
  function table(parent,headers,rows){
    const wrap=node('div',undefined,'table-wrap'),table=node('table'),head=node('thead'),hr=node('tr'),body=node('tbody');
    hr.append(...headers.map(value=>{const th=node('th',value);th.scope='col';return th;}));head.append(hr);
    for(const values of rows){const tr=node('tr');for(const value of values){const td=node('td');td.append(value instanceof Node?value:document.createTextNode(String(value??'—')));tr.append(td);}body.append(tr);}
    table.append(head,body);wrap.append(table);parent.append(wrap);
  }
  const setup=block('1. Select the original workbench'),bar=node('div',undefined,'actions');
  setup.append(bar);button(bar,'Load configured workbenches','reviewer-list-workspaces',()=>run('workspaces',{}));
  const alias=field(setup,'Configured reviewer workspace','reviewer-workspace','select');
  const actions=node('div',undefined,'actions');setup.append(actions);
  button(actions,'Open and inspect workbench','reviewer-open-workbench',async()=>{
    const workspace=selectedWorkspace();await run('workbench_open',{workspace});await run('state',{workspace});
  },{ready:()=>Boolean(own.workspace),primary:true});
  button(actions,'Refresh original state','reviewer-refresh-state',()=>run('state',{workspace:selectedWorkspace()}),
    {ready:()=>Boolean(own.workspace)});
  ui.workspaceInfo=node('p','','hint');setup.append(ui.workspaceInfo);
  const originalState=node('div');setup.append(originalState);ui.originalState=originalState;

  const intake=block('2. Review packet intake'),source=field(intake,'Packet source','reviewer-source','select');
  source.append(new Option('Bundled original purchase','bundled'),new Option('Host-declared original file','host'),new Option('Complete local receiving packet','upload'));
  const hostInput=field(intake,'Host input alias','reviewer-host-input','select');
  const file=field(intake,'Original reviewer packet file','reviewer-packet-file','file');file.accept='.json,application/json';
  const packetTitle=field(intake,'Review title','reviewer-packet-title','text','Original customer receiving');packetTitle.maxLength=180;
  ui.fileIdentity=node('p','','hint');intake.append(ui.fileIdentity);
  const intakeActions=node('div',undefined,'actions');intake.append(intakeActions);
  button(intakeActions,'Review original packet','reviewer-review-packet',reviewIntake,{ready:()=>Boolean(own.workspace),primary:true});
  const selections=node('div',undefined,'select-list');selections.id='reviewer-selections';intake.append(node('h4','Retained selections'),selections);ui.selections=selections;

  const selected=block('3. Original selection and results'),selectionInfo=node('dl',undefined,'properties');
  selectionInfo.id='reviewer-selection-details';selected.append(selectionInfo);ui.selectionInfo=selectionInfo;
  const selectedActions=node('div',undefined,'actions');selected.append(selectedActions);
  button(selectedActions,'Inspect selected packet','reviewer-inspect-selection',
    ()=>run('selection',{workspace:selectedWorkspace(),selectionId:requireSelection().id}),{ready:()=>Boolean(selection())});
  button(selectedActions,'Receive original packet','reviewer-receive',
    ()=>run('receive',selectedRevision()),{ready:()=>Boolean(selection()),primary:true});
  button(selectedActions,'Open original Buyer','reviewer-buyer-open',()=>run('buyer_open',selectedRevision()),
    {ready:()=>selection()?.state==='RECEIVED'});
  button(selectedActions,'Close original Buyer','reviewer-buyer-close',
    ()=>run('buyer_close',{workspace:selectedWorkspace()}),{ready:()=>Boolean(own.workspace)});
  const quote=field(selected,'Original quote','reviewer-quote','select');
  const resultActions=node('div',undefined,'actions');selected.append(resultActions);
  button(resultActions,'Read native history','reviewer-history',
    ()=>run('buyer_read',{workspace:selectedWorkspace(),tool:'bazaar_history',arguments:{limit:100}}),
    {ready:()=>selection()?.state==='RECEIVED'});
  button(resultActions,'Read native quote status','reviewer-quote-status',
    ()=>run('buyer_read',{workspace:selectedWorkspace(),tool:'bazaar_status',arguments:{quoteId:quote.value}}),
    {ready:()=>Boolean(quote.value)&&selection()?.state==='RECEIVED'});
  button(resultActions,'Retain complete saved result','reviewer-result',
    ()=>run('buyer_result',{workspace:selectedWorkspace(),quoteId:quote.value}),
    {ready:()=>Boolean(quote.value)&&selection()?.state==='RECEIVED',primary:true});
  ui.quoteDetails=node('div');selected.append(ui.quoteDetails);
  ui.documents=node('div');selected.append(node('h4','Original source documents'),ui.documents);

  const handover=block('4. Complete customer delivery'),handoverActions=node('div',undefined,'actions');
  handover.append(node('p','Export closes the original Buyer and drains its owner before reading the complete native history. The existing packet, quote identities and result bytes remain in the original receiving file.'),handoverActions);
  button(handoverActions,'Close Buyer and export original packet','reviewer-export',
    ()=>run('export',selectedRevision()),{ready:()=>selection()?.state==='RECEIVED',primary:true});
  button(handoverActions,'Receive these original files','reviewer-receive-files',async()=>{
    const entry=own.last;if(!entry?.retained)throw new Error('Select a complete original retained return.');
    const selected=reviewerCustomerSelection(entry.call,entry.retained);
    if(!selected)throw new Error('The selected native return has no complete original file manifest.');
    fillCustomer(selected);await receiveCustomer(selected);sync();
  },{ready:()=>Boolean(own.last?.retained?.retention?.state==='COMPLETE')});
  const destination=field(handover,'Receiving reviewer workspace','reviewer-destination','select');
  const receiveTitle=field(handover,'Receiving operator title','reviewer-receiving-title','text','Independent original customer');receiveTitle.maxLength=180;
  button(handover,'Review verified local receiving packet','reviewer-review-received',reviewReceived,
    {ready:()=>Boolean(localPacket()&&destination.value)});
  ui.receivingInfo=node('p','','hint');handover.append(ui.receivingInfo);

  const recipe=block('5. Reuse the whole operating procedure'),recipeActions=node('div',undefined,'actions');recipe.append(
    node('p','Prepare the original native requests, bindings and pauses in the maintained Workflow Recipes editor. Review its exact inputs and tool contracts there, then install and start its saved first edition.'),recipeActions);
  button(recipeActions,'Prepare complete delivery recipe','reviewer-delivery-recipe',()=>prepareRecipe('deliver'),
    {ready:()=>Boolean(selection()?.state==='RECEIVED'&&quote.value&&destination.value)});
  button(recipeActions,'Prepare original receiving recipe','reviewer-receiving-recipe',()=>prepareRecipe('receive'),
    {ready:()=>Boolean(own.last?.retained?.kind==='reviewer-packet'&&destination.value)});
  button(recipeActions,'Download prepared recipe','reviewer-download-recipe',()=>{
    saveJson(own.recipe.recipe,'reviewer-customer-recipe.json');saveJson(own.recipe.inputs,'reviewer-customer-inputs.json');
  },{ready:()=>Boolean(own.recipe)});
  ui.recipeInfo=node('p','','hint');recipe.append(ui.recipeInfo);

  const native=block('Original actions and complete native returns');
  ui.status=node('p','','hint');ui.status.id='reviewer-action-status';native.append(ui.status);
  ui.pending=node('div');ui.pending.id='reviewer-pending';native.append(ui.pending);
  ui.actionList=node('div',undefined,'select-list');ui.actionList.id='reviewer-action-list';native.append(ui.actionList);
  ui.returned=node('div');ui.returned.id='reviewer-return';native.append(ui.returned);

  function context(){
    const profile=requireProfile();return {session:state.sessionEpoch,profile:profile.id,profileEpoch:state.profileEpoch,
      workspaceId:state.host?.console.workspaceId,epoch:own.epoch};
  }
  function current(ctx){return ctx.session===state.sessionEpoch&&ctx.profile===state.profile?.id&&ctx.profileEpoch===state.profileEpoch&&ctx.workspaceId===state.host?.console.workspaceId&&ctx.epoch===own.epoch;}
  function check(ctx){if(!current(ctx))throw new Error('The operator profile changed. Reopen the saved original request from its profile.');}
  function selectedWorkspace(){if(!own.workspace)throw new Error('Select a configured original reviewer workspace.');return own.workspace;}
  function selection(){return own.detail?.selection??own.snapshot?.selections?.find(value=>value.id===own.selectionId)??null;}
  function requireSelection(){const value=selection();if(!value)throw new Error('Inspect an original packet selection first.');return value;}
  function selectedRevision(){const value=requireSelection();return {workspace:selectedWorkspace(),selectionId:value.id,expectedRevision:value.revision};}
  function localPacket(){
    const value=state.customer;
    if(value?.identity.family!=='grant-reviewer'||!value.localFiles||value.manifest?.kind!=='reviewer-packet')return null;
    const file=value.files?.find(file=>file.name==='grant-reviewer-packet.json');
    return file?{record:value,file}:null;
  }
  function storageKey(ctx,fingerprint){return 'starforge-reviewer-console:'+ctx.workspaceId+':'+ctx.profile+':'+fingerprint;}
  async function exclusive(fn){
    if(own.pending)throw new Error('Let the current original request return, or reopen it from Requests.');
    own.pending=true;sync();
    try{return await fn();}finally{own.pending=false;sync();}
  }
  function saveJson(value,name){
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),link=node('a');
    link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function packetBytes(selected){
    if(!selected||selected.size>MAX_PACKET_BYTES)throw new Error('Choose one complete original JSON packet up to 8 MiB.');
    const bytes=new Uint8Array(await selected.arrayBuffer()),sha256=await hash(bytes);
    return {bytes,sha256};
  }
  async function reviewIntake(){
    const ctx=context(),workspace=selectedWorkspace(),args={workspace,source:source.value,title:packetTitle.value};
    if(source.value==='host'){if(!hostInput.value)throw new Error('Choose an original declared host input.');args.hostInput=hostInput.value;}
    if(source.value==='upload'){
      const selected=file.files?.[0],saved=await packetBytes(selected);check(ctx);
      text(ui.fileIdentity,selected.name+' · '+saved.bytes.length+' bytes · SHA-256 '+saved.sha256);
      args.base64=b64(saved.bytes);args.expectedSha256=saved.sha256;
    }
    await run('review',args);
    file.value='';
  }
  async function reviewReceived(){
    const selected=localPacket();if(!selected)throw new Error('Complete the original customer packet transfer first.');
    const ctx=context(),workspace=destination.value,title=receiveTitle.value;
    const response=await api('customer-file/'+encodeURIComponent(selected.record.id)+'?'+new URLSearchParams({file:selected.file.name}),
      {raw:true,epoch:ctx.session});
    const bytes=new Uint8Array(await response.arrayBuffer());check(ctx);
    const receivedSha256=await hash(bytes);check(ctx);
    if(bytes.length!==selected.file.bytes||receivedSha256!==selected.file.sha256||bytes.length>MAX_PACKET_BYTES)
      throw new Error('The complete local packet differs from the reviewed original file.');
    await run('review',{workspace,source:'upload',title,expectedSha256:selected.file.sha256,base64:b64(bytes)});
  }
  async function originalDraft(pending,tool,args,ctx,recoveryOf){
    let existing;try{existing=(await api('draft/'+encodeURIComponent(pending.draftId),{epoch:ctx.session})).draft;}
    catch(error){if(error.status!==404)throw error;}
    check(ctx);
    if(existing){
      if(existing.profileId!==ctx.profile||existing.tool!==tool||canonical(JSON.parse(existing.argumentsJson))!==canonical(args))
        throw new Error('The saved reviewer draft identity belongs to different original input.');
      return existing;
    }
    const value=await api('drafts',{method:'POST',epoch:ctx.session,body:{id:pending.draftId,profileId:ctx.profile,
      name:'Reviewer · '+tool.slice(PREFIX.length).replaceAll('_',' '),tool,arguments:args,...(recoveryOf?{recoveryOf}:{})}});
    check(ctx);return value.draft;
  }
  async function awaitCall(id,ctx){
    const deadline=Date.now()+60000;
    while(true){
      const call=await api('call/'+encodeURIComponent(id),{epoch:ctx.session});check(ctx);
      text(ui.status,'Original call '+id+' · '+call.receiving+' · native request '+(JSON.parse(call.argumentsJson).requestId??'saved read'));
      if(call.state==='COMPLETE')return call;
      if(call.state==='FAILED')throw Object.assign(new Error(call.error?.message??'The original native call failed.'),{code:call.error?.code,callId:id});
      if(call.receiving!=='ACTIVE'||Date.now()>=deadline){
        own.recovery=call;renderPending();
        throw Object.assign(new Error('The original call remains saved. Reconcile its native action or continue its exact saved arguments from Original actions.'),{callId:id});
      }
      await new Promise(resolve=>setTimeout(resolve,350));check(ctx);
    }
  }
  async function run(actionName,values,{recoveryOf,originalRequestId}={}){
    const ctx=context(),tool=PREFIX+actionName,base={...values};
    if(originalRequestId)base.requestId=originalRequestId;
    const fingerprint=await hash(encode(canonical({tool,args:base,recoveryOf:recoveryOf??null})));check(ctx);
    const key=storageKey(ctx,fingerprint);
    let pending;try{pending=JSON.parse(sessionStorage.getItem(key));}catch{}
    if(!pending){const id=uid();pending={id,draftId:'reviewer-draft-'+id,callId:'reviewer-call-'+id,
      nativeRequestId:base.requestId??(MUTATIONS.has(actionName)?uid():null),fingerprint};}
    if(pending.fingerprint!==fingerprint)throw new Error('The retained action input changed.');
    const args={...base,...(MUTATIONS.has(actionName)?{requestId:pending.nativeRequestId}:{})};
    // The tab retains only IDs and a digest; complete input belongs to the original private draft.
    try{sessionStorage.setItem(key,JSON.stringify(pending));}catch{}
    const draft=await originalDraft(pending,tool,args,ctx,recoveryOf);check(ctx);
    text(ui.status,'Saved original draft '+draft.id+' / '+draft.revision+'.');
    await api('calls',{method:'POST',epoch:ctx.session,body:{id:pending.callId,profileId:ctx.profile,
      draftId:draft.id,draftRevision:draft.revision,expectedHostFingerprint:state.host.configurationFingerprint}});
    check(ctx);
    let call;
    try{call=await awaitCall(pending.callId,ctx);}
    finally{if(current(ctx))await loadProfile();}
    check(ctx);
    const result=await api('reviewer-value/'+encodeURIComponent(call.id),{epoch:ctx.session});check(ctx);
    adopt(actionName,args,call,result);
    try{sessionStorage.removeItem(key);}catch{}
    own.recovery=null;renderPending();render();
    notice('Retained original '+actionName.replaceAll('_',' ')+' · '+call.id+'.');
    return result;
  }
  function adopt(actionName,args,call,result){
    own.last={...result,call,action:actionName,args,observedAt:call.completedAt};
    if(args.workspace&&args.workspace!==own.workspace){
      own.workspace=args.workspace;own.snapshot=null;own.detail=null;own.selectionId=null;alias.value=args.workspace;
    }
    const value=result.native;
    if(actionName==='workspaces'){
      own.workspaces=value.workspaces??[];refreshAliases();
    }else if(actionName==='state'){
      own.snapshot=value;
      if(!value.selections?.some(item=>item.id===own.selectionId))own.selectionId=value.selected?.selectionId??value.selections?.at(-1)?.id??null;
      own.detail=null;
    }else if(actionName==='selection'){
      own.selectionId=value.selection.id;own.detail=value;
    }else if(value?.selection){
      own.selectionId=value.selection.id;own.detail={selection:value.selection,packet:value.selection.packet};
      if(own.snapshot){
        const saved=own.snapshot.selections??[];
        own.snapshot={...own.snapshot,selections:[...saved.filter(item=>item.id!==value.selection.id),value.selection]};
      }
    }
    if(actionName==='action'&&value?.operation?.result){
      const saved=value.operation.result;
      if(saved.selection){own.selectionId=saved.selection.id;own.detail={selection:saved.selection,packet:saved.selection.packet};}
    }
  }
  async function openOriginalCall(id){
    const ctx=context(),call=await api('call/'+encodeURIComponent(id),{epoch:ctx.session});check(ctx);
    own.recovery=call;renderPending();
    if(call.state==='COMPLETE'){
      const result=await api('reviewer-value/'+encodeURIComponent(id),{epoch:ctx.session});check(ctx);
      adopt(call.tool.slice(PREFIX.length),JSON.parse(call.argumentsJson),call,result);render();
    }
  }
  async function reconcileOriginal(){
    const call=own.recovery;if(!call)throw new Error('Select the original saved request.');
    const args=JSON.parse(call.argumentsJson);
    if(!args.requestId)throw new Error('This is a saved read. Continue its exact selected arguments instead.');
    await run('action',{workspace:args.workspace,requestId:args.requestId},{recoveryOf:call.id});
  }
  async function continueOriginal(){
    const call=own.recovery;if(!call)throw new Error('Select the original saved request.');
    if(call.receiving==='ACTIVE')throw new Error('The original native request is still active.');
    await run(call.tool.slice(PREFIX.length),JSON.parse(call.argumentsJson),{recoveryOf:call.id});
  }
  function renderPending(){
    ui.pending.replaceChildren();
    const value=own.recovery;if(!value)return;
    const args=JSON.parse(value.argumentsJson);
    ui.pending.append(node('p','Original '+value.tool.slice(PREFIX.length)+' · '+value.id+' · '+value.state,'hint'));
    const row=node('div',undefined,'actions');
    function local(label,fn,disabled){const b=node('button',label);b.type='button';b.disabled=disabled;action(b,()=>exclusive(fn));row.append(b);}
    local('Open original request',()=>openCall(value.id),false);
    local('Read original native action',reconcileOriginal,!args.requestId||value.receiving==='ACTIVE');
    local('Continue exact original arguments',continueOriginal,value.receiving==='ACTIVE');
    ui.pending.append(row);
  }
  function refreshAliases(){
    const previous=own.workspace||alias.value,dest=destination.value;
    alias.replaceChildren(new Option('Select original workbench',''),...own.workspaces.map(value=>new Option(value.label+' · '+value.workspace,value.workspace)));
    own.workspace=own.workspaces.some(value=>value.workspace===previous)?previous:own.workspaces[0]?.workspace??'';
    alias.value=own.workspace;
    destination.replaceChildren(new Option('Choose receiving workbench',''),...own.workspaces.map(value=>new Option(value.label+' · '+value.workspace,value.workspace)));
    destination.value=own.workspaces.some(value=>value.workspace===dest)?dest:own.workspaces.find(value=>value.workspace!==own.workspace)?.workspace??'';
    refreshInputs();
  }
  function refreshInputs(){
    const binding=own.workspaces.find(value=>value.workspace===own.workspace),previous=hostInput.value;
    hostInput.replaceChildren(new Option('Select declared original file',''),...(binding?.inputs??[]).map(value=>new Option(value.label+' · '+value.bytes+' bytes · '+value.id,value.id)));
    if([...hostInput.options].some(value=>value.value===previous))hostInput.value=previous;
    text(ui.workspaceInfo,binding?'Workbench '+binding.workbenchId+' · '+(binding.allowStart?'Native start is configured':'Borrow the existing Applications owner')+' · selected source '+binding.selectionSha256:'Load and select this host’s configured original workbenches.');
  }
  function render(){
    const value=selection(),packet=own.detail?.packet??value?.packet;
    ui.originalState.replaceChildren();
    if(own.snapshot){
      const data=node('dl',undefined,'properties');properties(data,[
        ['Workbench',own.snapshot.id??own.snapshot.workbenchId,true],['Current observation',own.last?.observedAt],
        ['Buyer at this observation',own.snapshot.buyer?.active?'Open · '+own.snapshot.buyer.selectionId:'Closed'],
        ['Original selections',own.snapshot.selections?.length??0],['Original saved actions',own.snapshot.operations?.length??0]
      ]);ui.originalState.append(data);
    }
    ui.selections.replaceChildren();
    for(const item of own.snapshot?.selections??(value?[value]:[])){
      const b=node('button',item.title+' · r'+item.revision+' · '+item.state);
      b.type='button';b.dataset.selectionId=item.id;b.setAttribute('aria-current',String(item.id===own.selectionId));
      b.append(node('p',item.id,'hint'));
      action(b,()=>exclusive(()=>run('selection',{workspace:selectedWorkspace(),selectionId:item.id})));ui.selections.append(b);
    }
    properties(ui.selectionInfo,value?[
      ['Selection',value.id,true],['Revision',value.revision],['State',value.state],['Original title',value.title],
      ['Packet',packet?.packetId,true],['Packet SHA-256',packet?.sha256,true],['Original operation',packet?.operationId,true],
      ['Quotes',packet?.quotes?.length??0],['Source documents',packet?.documents?.length??0]
    ]:[['Selection','Choose or review an original packet.']]);
    const old=quote.value;quote.replaceChildren(...(packet?.quotes??[]).map(value=>new Option(value.quoteId+' · '+value.status,value.quoteId)));
    quote.value=(packet?.quotes??[]).some(value=>value.quoteId===old)?old:packet?.primaryQuoteId??packet?.quotes?.[0]?.quoteId??'';
    renderQuote();
    ui.documents.replaceChildren();
    table(ui.documents,['Source file','Bytes','SHA-256','Retain complete file'],(packet?.documents??[]).map((file,index)=>{
      const b=node('button','Retain original file');b.type='button';
      action(b,()=>exclusive(()=>run('document',{workspace:selectedWorkspace(),selectionId:requireSelection().id,index})));
      return [file.path,file.bytes,file.sha256,b];
    }));
    renderReturn();renderSaved();sync();
  }
  function renderQuote(){
    ui.quoteDetails.replaceChildren();
    const packet=own.detail?.packet??selection()?.packet,original=packet?.quotes?.find(value=>value.quoteId===quote.value);
    if(original){details(ui.quoteDetails,'Original invocation and terms',{invocation:original.invocation,accepted:original.accepted});
      details(ui.quoteDetails,'Original transaction and result identity',{status:original.status,observation:original.observation,result:original.result,attempts:original.attempts});}
  }
  function renderReturn(){
    ui.returned.replaceChildren();const value=own.last;if(!value)return;
    const info=node('dl',undefined,'properties');properties(info,[
      ['Original call',value.call.id,true],['Tool',value.call.tool],['Returned',value.observedAt],
      ['Exact return SHA-256',value.resultSha256,true],['Retained export',value.retained?.exportId,true],
      ['Manifest SHA-256',value.retained?.manifestSha256,true]
    ]);ui.returned.append(info);
    const row=node('div',undefined,'actions'),b=node('button','Download exact tool return');b.type='button';
    action(b,()=>download('result/'+encodeURIComponent(value.call.id),value.call.id+'-result.json'));row.append(b);ui.returned.append(row);
    details(ui.returned,value.viewKind==='file'?'Original full-file identity':'Complete retained native value',value.native);
    if(value.retained)details(ui.returned,'Original file manifest selection',value.retained);
    text(ui.status,'Showing the retained '+value.action.replaceAll('_',' ')+' return from '+when(value.observedAt)+'. Refresh original state for current Buyer activity.');
  }
  function renderSaved(){
    const values=(state.details?.calls??[]).filter(value=>value.tool.startsWith(PREFIX));
    ui.actionList.replaceChildren();
    for(const value of values){
      const b=node('button');b.type='button';b.append(node('strong',value.tool.slice(PREFIX.length).replaceAll('_',' ')),
        node('p',value.id+' · '+value.receiving+' · '+when(value.startedAt),'hint'));
      action(b,()=>exclusive(()=>openOriginalCall(value.id)));ui.actionList.append(b);
    }
    if(!values.length)ui.actionList.append(node('p','Saved reviewer requests appear here and in Requests.','hint'));
  }
  async function prepareRecipe(mode){
    const ctx=context(),packet=await api('reviewer-recipe?'+new URLSearchParams({mode}),{epoch:ctx.session});check(ctx);
    const actions=Object.fromEntries(['sourceOpen','sourceClose','sourceExport','review','receive','receivingOpen','receivingClose'].map(key=>[key,uid()]));
    const inputs={sourceWorkspace:selectedWorkspace(),destinationWorkspace:destination.value,title:receiveTitle.value,actions};
    if(mode==='deliver'){
      const selected=requireSelection();Object.assign(inputs,{selectionId:selected.id,selectionRevision:selected.revision,quoteId:quote.value});
    }else{
      const retained=own.last?.retained;
      if(retained?.kind!=='reviewer-packet')throw new Error('Select the original complete receiving-packet export.');
      Object.assign(inputs,{sourceWorkspace:retained.workspace,exportId:retained.exportId,expectedManifestSha256:retained.manifestSha256});
    }
    if(!inputs.destinationWorkspace||inputs.destinationWorkspace===inputs.sourceWorkspace)
      throw new Error('Select a distinct original receiving workbench.');
    own.recipe={recipe:packet.recipe,inputs};
    text(ui.recipeInfo,packet.recipe.steps.length+' native steps · '+packet.recipe.contentSha256);
    await useRecipe(packet.recipe,inputs);check(ctx);setPage('workflows');
    notice('Prepared the complete original reviewer recipe and selected inputs. Review and install it in Workflow Recipes.');
  }
  function profileChanged(){
    const identity=state.profile&&state.host?.console.workspaceId?state.host.console.workspaceId+'/'+state.profile.id:null;
    if(identity!==own.identity||state.sessionEpoch!==own.session){
      own.identity=identity;own.session=state.sessionEpoch;own.epoch++;own.snapshot=null;own.detail=null;own.selectionId=null;
      own.last=null;own.recovery=null;own.recipe=null;own.workspaces=[];own.workspace='';
      alias.replaceChildren(new Option('Load original workbenches',''));destination.replaceChildren();hostInput.replaceChildren();
      file.value='';text(ui.fileIdentity,'');text(ui.status,'');text(ui.recipeInfo,'');
      render();
    }else{renderSaved();sync();}
  }
  function sync(){
    panel.hidden=!state.profile||!(state.host?.capabilities.families??[]).some(value=>value.name==='grantReviewers');
    panel.setAttribute('aria-busy',String(own.pending));
    const enabled=Boolean(state.profile&&state.token&&!own.pending);
    for(const [button,ready]of gates)button.disabled=!enabled||!ready();
    const packet=localPacket();
    text(ui.receivingInfo,packet?'Selected local receiving packet: '+packet.file.bytes+' bytes · '+packet.file.sha256+
      '. Review it in the independently configured receiving workbench.':
      'Select a completed reviewer-packet delivery below to review its complete verified local bytes in another workbench.');
    hostInput.parentElement.hidden=source.value!=='host';file.parentElement.hidden=source.value!=='upload';
  }
  function reset(){own.identity=null;own.session=null;own.epoch++;own.snapshot=null;own.detail=null;own.last=null;own.recovery=null;own.recipe=null;
    own.workspaces=[];own.workspace='';file.value='';ui.returned.replaceChildren();ui.actionList.replaceChildren();ui.pending.replaceChildren();panel.hidden=true;}
  alias.addEventListener('change',()=>{own.epoch++;own.workspace=alias.value;own.snapshot=null;own.detail=null;own.selectionId=null;refreshInputs();render();});
  destination.addEventListener('change',sync);source.addEventListener('change',sync);quote.addEventListener('change',()=>{renderQuote();sync();});
  file.addEventListener('change',()=>text(ui.fileIdentity,'The complete selected bytes are hashed when this original review is prepared.'));
  return {profileChanged,reset,sync,get hasActive(){return own.pending;},refresh:()=>{renderSaved();sync();}};
}

// MIT. Customer delivery over saved original gRPC workspaces in Merchant Console.
const PREFIX='merchant_grpc_',SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PAGE_SIZE=50,plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(!plain(value))return value;return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])]));}
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(value=>value.toString(16).padStart(2,'0')).join('');
function valuesOf(result){
  const queue=[result],seen=new Set(),values=[];
  while(queue.length){
    const value=queue.shift();if(!plain(value)||seen.has(value))continue;seen.add(value);values.push(value);
    for(const key of ['result','structuredContent','delivery'])if(plain(value[key]))queue.push(value[key]);
    for(const item of Array.isArray(value.content)?value.content:[])if(item?.type==='text'&&typeof item.text==='string')
      try{queue.push(JSON.parse(item.text));}catch{}
  }
  return values;
}
function nativeResult(result){
  const values=valuesOf(result),error=values.find(value=>value.isError===true);
  if(error)throw new Error(error.content?.find(item=>item.type==='text')?.text??'The original gRPC tool returned an error.');
  const value=values.find(value=>typeof value.schema==='string'||typeof value.state==='string'||
    typeof value.workspace==='string'||typeof value.revision==='string'||typeof value.id==='string'||
    typeof value.configured==='boolean'||Array.isArray(value.items));
  if(!value)throw new Error('The saved original gRPC call has no complete structured return.');
  return value;
}
export function grpcCustomerSelection(call,result){
  if(call?.state!=='COMPLETE'||!call.tool?.startsWith(PREFIX))return null;
  const values=valuesOf(result);if(values.some(value=>value.isError===true))return null;
  const retained=values.find(value=>value.state==='MANIFEST_RETAINED'&&SHA.test(value.exportId??'')&&
    SHA.test(value.manifestFile?.sha256??'')&&typeof value.workspace==='string'&&Array.isArray(value.files));
  if(!retained)return null;
  let args;try{args=JSON.parse(call.argumentsJson);}catch{return null;}
  if(args.workspace!==undefined&&args.workspace!==retained.workspace||args.exportId!==undefined&&args.exportId!==retained.exportId)return null;
  return {family:'grpc',workspace:retained.workspace,exportId:retained.exportId,
    expectedManifestSha256:retained.manifestFile.sha256};
}
export function createGrpcCustomerPage({state,$,node,text,pretty,when,properties,action,api,notice,uid,
  requireProfile,loadProfile,openCall,fillCustomer,receiveCustomer,download,setPage,useRecipe}){
  const panel=node('section',undefined,'panel');panel.id='grpc-customer';panel.hidden=true;
  panel.append(node('p','gRPC merchant','eyebrow'),node('h3','Customer workspace'),
    node('p','Deliver generated clients, captured source, retained call output, contract reviews and service-health history from the original configured workspace.'));
  $('page-customers').insertBefore(panel,$('page-customers').children[1]??null);
  const own={identity:null,session:null,epoch:0,workspaces:[],workspace:'',status:null,inventory:null,
    selected:null,detail:null,detailPage:null,health:null,eventPage:null,servicePage:null,
    last:null,delivery:null,recovery:null,recipe:null,pending:false};
  const ui={},gates=[],controls=[];
  function block(title){const section=node('section',undefined,'panel');section.append(node('h4',title));panel.append(section);return section;}
  function field(parent,label,id,type='text',value=''){
    const wrap=node('div'),control=type==='select'?node('select'):node('input');control.id=id;control.setAttribute('aria-label',label);
    if(type!=='select')control.type=type;control.value=value;const lab=node('label',label);lab.htmlFor=id;
    wrap.append(lab,control);parent.append(wrap);ui[id]=control;controls.push(control);return control;
  }
  function button(parent,label,id,fn,ready=()=>true){
    const value=node('button',label);value.type='button';value.id=id;parent.append(value);ui[id]=value;
    gates.push([value,ready]);action(value,()=>exclusive(fn));return value;
  }
  function row(parent){const value=node('div',undefined,'actions');parent.append(value);return value;}
  function details(parent,label,value){const box=node('details');box.append(node('summary',label),node('pre',pretty(value)));parent.append(box);}
  function table(parent,headers,rows){
    const wrap=node('div',undefined,'table-wrap'),table=node('table'),head=node('thead'),hr=node('tr'),body=node('tbody');
    for(const value of headers){const th=node('th',value);th.scope='col';hr.append(th);}head.append(hr);
    for(const values of rows){const tr=node('tr');for(const value of values){const td=node('td');td.append(value instanceof Node?value:document.createTextNode(String(value??'—')));tr.append(td);}body.append(tr);}
    table.append(head,body);wrap.append(table);parent.append(wrap);
  }
  function localButton(label,fn,disabled=false){
    const b=node('button',label);b.type='button';b.dataset.grpcLocal=String(disabled);b.disabled=disabled||own.pending;action(b,()=>exclusive(fn));return b;
  }
  const setup=block('1. Select the workspace'),setupActions=row(setup);
  button(setupActions,'Load configured workspaces','grpc-workspaces',()=>run('workspaces',{}));
  const alias=field(setup,'Configured gRPC workspace','grpc-workspace','select');
  button(setupActions,'Inspect workspace','grpc-status',()=>run('status',{workspace:workspace()}),()=>Boolean(own.workspace));
  ui.workspaceInfo=node('p','','hint');ui.workspaceState=node('dl',undefined,'properties');setup.append(ui.workspaceInfo,ui.workspaceState);

  const inventory=block('2. Browse retained work');
  const kind=field(inventory,'Original inventory','grpc-inventory-kind','select');
  for(const [value,label]of [['prepared','Prepared merchants'],['revisions','Captured source revisions'],['attempts','Retained calls'],
    ['exports','Customer exports'],['upgrades','Contract reviews'],['health','Service-health observations'],
    ['reflections','Descriptor captures'],['intents','Preparation intents']])kind.append(new Option(label,value));
  const inventoryActions=row(inventory);
  button(inventoryActions,'Refresh inventory','grpc-inventory-refresh',()=>inventoryAt(0,false),()=>Boolean(own.workspace));
  button(inventoryActions,'Previous page','grpc-inventory-previous',()=>inventoryAt(Math.max(0,own.inventory.offset-PAGE_SIZE),true),()=>Boolean(own.inventory?.offset));
  button(inventoryActions,'Next page','grpc-inventory-next',()=>inventoryAt(own.inventory.nextOffset,true),()=>Number.isSafeInteger(own.inventory?.nextOffset));
  ui.inventoryInfo=node('p','','hint');ui.inventoryRows=node('div',undefined,'select-list');inventory.append(ui.inventoryInfo,ui.inventoryRows);

  const selection=block('3. Inspect the selected source and operation');
  const revision=field(selection,'Original source revision','grpc-revision');revision.pattern='[a-f0-9]{64}';revision.maxLength=64;
  const preparation=field(selection,'Original merchant preparation','grpc-preparation');preparation.maxLength=36;
  const operation=field(selection,'Original retained call','grpc-operation');operation.maxLength=36;
  const upgrade=field(selection,'Original contract review','grpc-upgrade');upgrade.maxLength=36;
  const reviewSha=field(selection,'Reviewed contract SHA-256','grpc-review-sha');reviewSha.pattern='[a-f0-9]{64}';reviewSha.maxLength=64;
  const selectionActions=row(selection);
  button(selectionActions,'Inspect source revision','grpc-inspect-revision',()=>inspect('revision','summary'),()=>validRevision());
  button(selectionActions,'Read saved call','grpc-inspect-attempt',()=>run('attempt',{workspace:workspace(),operationId:operation.value}),()=>validOperation(operation));
  button(selectionActions,'Inspect contract review','grpc-inspect-upgrade',()=>inspect('upgrade','summary'),()=>validOperation(upgrade));
  const section=field(selection,'Source or review section','grpc-detail-section','select');
  function sectionOptions(){
    const selected=own.selected?.kind==='upgrades',previous=section.value;
    const available=selected?['summary','full','plan','source','adoption','changes','methods','routes']:['summary','source','plan','methods','routes'];
    section.replaceChildren(...available.map(value=>new Option(value.replaceAll('_',' '),value)));
    section.value=available.includes(previous)?previous:'summary';
  }
  const detailActions=row(selection);
  button(detailActions,'Read selected section','grpc-detail-read',()=>inspect(own.selected?.kind==='upgrades'?'upgrade':'revision',section.value),()=>own.selected?.kind==='upgrades'?validOperation(upgrade):validRevision());
  button(detailActions,'Previous rows','grpc-detail-previous',()=>detailAt(Math.max(0,own.detailPage.offset-PAGE_SIZE),true),()=>Boolean(own.detailPage?.offset));
  button(detailActions,'Next rows','grpc-detail-next',()=>detailAt(own.detailPage.nextOffset,true),()=>Number.isSafeInteger(own.detailPage?.nextOffset));
  ui.selectionInfo=node('dl',undefined,'properties');ui.details=node('div');selection.append(ui.selectionInfo,ui.details);
  sectionOptions();

  const health=block('4. Review retained service health');
  const healthId=field(health,'Original health observation','grpc-health-operation');healthId.maxLength=36;
  const healthActions=row(health);
  button(healthActions,'Read observation and latest events','grpc-health-read',async()=>{
    await run('health_read',{workspace:workspace(),operationId:healthId.value,section:'summary'});await healthAt('events',0,false);
  },()=>validOperation(healthId));
  button(healthActions,'Previous events','grpc-health-previous',()=>healthAt('events',Math.max(0,own.eventPage.afterSequence-PAGE_SIZE),true),()=>Boolean(own.eventPage?.afterSequence));
  button(healthActions,'Next events','grpc-health-next',()=>healthAt('events',own.eventPage.nextAfterSequence,true),()=>Number.isSafeInteger(own.eventPage?.nextAfterSequence));
  ui.healthInfo=node('dl',undefined,'properties');ui.healthEvents=node('div');health.append(ui.healthInfo,ui.healthEvents);
  const filter=field(health,'Find a reported List service','grpc-health-service-filter','search');filter.maxLength=512;
  const serviceActions=row(health);
  button(serviceActions,'Read List services','grpc-services-read',()=>healthAt('services',0,false),()=>own.health?.operation?.kind==='list');
  button(serviceActions,'Previous services','grpc-services-previous',()=>healthAt('services',Math.max(0,own.servicePage.afterSequence-PAGE_SIZE),true),()=>Boolean(own.servicePage?.afterSequence));
  button(serviceActions,'Next services','grpc-services-next',()=>healthAt('services',own.servicePage.nextAfterSequence,true),()=>Number.isSafeInteger(own.servicePage?.nextAfterSequence));
  ui.healthServices=node('div');health.append(ui.healthServices);
  ui.healthSnapshot=node('p','','hint');health.append(ui.healthSnapshot);

  const delivery=block('5. Receive the complete customer files'),deliveryActions=row(delivery);
  button(deliveryActions,'Export generated client','grpc-export-customer',()=>run('export',{workspace:workspace(),kind:'customer',preparation:preparation.value}),()=>validOperation(preparation));
  button(deliveryActions,'Export complete source','grpc-export-revision',()=>run('export',{workspace:workspace(),kind:'revision',revision:revision.value}),()=>validRevision());
  button(deliveryActions,'Export retained call and stream','grpc-export-attempt',()=>run('export',{workspace:workspace(),kind:'attempt',operationId:operation.value}),()=>validOperation(operation));
  button(deliveryActions,'Export reviewed contract','grpc-export-upgrade',()=>run('upgrade_export',{workspace:workspace(),operationId:upgrade.value,expectedReviewSha256:reviewSha.value}),()=>validOperation(upgrade)&&SHA.test(reviewSha.value));
  button(deliveryActions,'Export selected health history','grpc-export-health',()=>run('health_export',frozenHealth()),()=>validHealth());
  const exportId=field(delivery,'Retained export ID','grpc-export-id');exportId.maxLength=64;exportId.pattern='[a-f0-9]{64}';
  const receivingActions=row(delivery);
  button(receivingActions,'Inspect original manifest','grpc-manifest',()=>run('export_manifest',{exportId:exportId.value}),()=>SHA.test(exportId.value));
  button(receivingActions,'Receive complete files','grpc-receive-files',async()=>{
    const selected=own.delivery?.selection;if(!selected)throw new Error('Inspect the original export manifest first.');
    const ctx=context();fillCustomer(selected);await receiveCustomer(selected);check(ctx);sync();
  },()=>Boolean(own.delivery));
  button(receivingActions,'Open received customer','grpc-open-customer',()=>{
    const received=localCustomer();if(!received)throw new Error('Select this completed customer in the receiving list.');
    fillCustomer(received.identity);setPage('customers');$('customer-detail').scrollIntoView({block:'start'});
  },()=>Boolean(localCustomer()));
  button(receivingActions,'Download complete gRPC archive','grpc-download-archive',()=>{
    const received=localCustomer();if(!received)throw new Error('Complete the original receiving transfer first.');
    return download('customer-archive/'+encodeURIComponent(received.id),received.identity.exportId+'.tar.gz',{stream:true,maximumBytes:(received.files??[]).reduce((sum,file)=>sum+file.bytes,0)+1048576});
  },()=>Boolean(localCustomer()?.localFiles));
  ui.deliveryInfo=node('dl',undefined,'properties');ui.deliveryFiles=node('div');delivery.append(ui.deliveryInfo,ui.deliveryFiles,
    node('p','The archive restores grpc/client/ and the other original paths. The receiving record keeps the complete manifest, file hashes and original operation. Large streams are copied through the original download owner.','hint'));

  const recipe=block('6. Save the complete operating procedure'),recipeActions=row(recipe);
  for(const [mode,label,ready]of [
    ['customer','Prepare client and source recipe',()=>validOperation(preparation)],
    ['upgrade','Prepare contract review recipe',()=>validOperation(upgrade)&&SHA.test(reviewSha.value)],
    ['health','Prepare frozen health recipe',()=>validHealth()],
    ['attempt','Prepare retained call recipe',()=>validOperation(operation)]
  ])button(recipeActions,label,'grpc-recipe-'+mode,()=>prepareRecipe(mode),ready);
  button(recipeActions,'Download prepared recipe and inputs','grpc-download-recipe',()=>{
    saveJson(own.recipe.recipe,'grpc-'+own.recipe.mode+'-recipe.json');saveJson(own.recipe.inputs,'grpc-'+own.recipe.mode+'-inputs.json');
  },()=>Boolean(own.recipe));
  ui.recipeInfo=node('p','','hint');recipe.append(ui.recipeInfo,
    node('p','Review the prepared procedure in Workflow Recipes, then install and start its saved edition. Manifest pauses expose every original file for receiving. Reopen the saved workflow to continue the same procedure.','hint'));

  const history=block('Saved original requests');
  ui.actionStatus=node('p','','hint');ui.actionStatus.setAttribute('role','status');
  ui.pending=node('div');ui.history=node('div',undefined,'select-list');ui.returned=node('div');history.append(ui.actionStatus,ui.pending,ui.history,ui.returned);

  function binding(){return canonical({host:state.host?.configurationFingerprint??null,
    profile:state.profile?.hostFingerprint??null,composition:state.host?.composition?.fingerprint??null,
    boundComposition:state.profile?.compositionFingerprint??state.profile?.host?.composition?.fingerprint??null});}
  function context(){
    const profile=requireProfile();return {session:state.sessionEpoch,profile:profile.id,profileEpoch:state.profileEpoch,
      consoleId:state.host?.console.workspaceId,epoch:own.epoch,binding:binding(),
      expectedHostFingerprint:state.host?.configurationFingerprint};
  }
  function current(ctx){return ctx.session===state.sessionEpoch&&ctx.profile===state.profile?.id&&
    ctx.profileEpoch===state.profileEpoch&&ctx.consoleId===state.host?.console.workspaceId&&ctx.epoch===own.epoch&&
    ctx.binding===binding();}
  function check(ctx){if(!current(ctx))throw new Error('The selected operator profile or gRPC workspace changed. Reopen its saved request from the original profile.');}
  function workspace(){if(!own.workspace)throw new Error('Select a configured original gRPC workspace.');return own.workspace;}
  const validRevision=()=>Boolean(own.workspace&&SHA.test(revision.value));
  const validOperation=control=>Boolean(own.workspace&&UUID.test(control.value));
  function validHealth(){return validOperation(healthId)&&own.health?.operation?.id===healthId.value&&
    Number.isSafeInteger(own.eventPage?.throughSequence)&&SHA.test(own.eventPage?.snapshot??'');}
  function frozenHealth(){
    if(!validHealth())throw new Error('Read an event page for this original observation before freezing its history.');
    return {workspace:workspace(),operationId:healthId.value,throughSequence:own.eventPage.throughSequence,expectedSnapshot:own.eventPage.snapshot};
  }
  function localCustomer(){
    const value=state.customer,selection=own.delivery?.selection;
    return value?.identity?.family==='grpc'&&value.identity.workspace===own.workspace&&selection&&
      value.identity.exportId===selection.exportId&&value.identity.expectedManifestSha256===selection.expectedManifestSha256?value:null;
  }
  async function exclusive(fn){
    if(own.pending)throw new Error('Let the saved original request return, or reopen it from Requests.');
    own.pending=true;sync();try{return await fn();}finally{own.pending=false;sync();}
  }
  function saveJson(value,name){
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),link=node('a');
    link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function originalDraft(pending,tool,args,ctx,recoveryOf){
    let draft;try{draft=(await api('draft/'+encodeURIComponent(pending.draftId),{epoch:ctx.session})).draft;}catch(error){if(error.status!==404)throw error;}
    check(ctx);
    if(draft){
      if(draft.profileId!==ctx.profile||draft.tool!==tool||canonical(JSON.parse(draft.argumentsJson))!==canonical(args))
        throw new Error('This saved gRPC draft belongs to different original input.');
      return draft;
    }
    const value=await api('drafts',{method:'POST',epoch:ctx.session,body:{id:pending.draftId,profileId:ctx.profile,
      name:'gRPC · '+tool.slice(PREFIX.length).replaceAll('_',' '),tool,arguments:args,...(recoveryOf?{recoveryOf}:{})}});
    check(ctx);return value.draft;
  }
  async function awaitCall(id,ctx){
    const deadline=Date.now()+60000;
    while(true){
      const call=await api('call/'+encodeURIComponent(id),{epoch:ctx.session});check(ctx);
      text(ui.actionStatus,'Saved gRPC request '+id+' · '+call.receiving);
      if(call.state==='COMPLETE')return call;
      if(call.state==='FAILED'){own.recovery=call;renderRecovery();throw Object.assign(new Error(call.error?.message??'The original gRPC request failed.'),{callId:id});}
      if(call.receiving!=='ACTIVE'||Date.now()>=deadline){
        own.recovery=call;renderRecovery();throw Object.assign(new Error('The request remains saved. Read its original native operation or reopen the request to continue.'),{callId:id});
      }
      await new Promise(resolve=>setTimeout(resolve,350));check(ctx);
    }
  }
  async function run(name,args,{recoveryOf}={}){
    const ctx=context(),tool=PREFIX+name,fingerprint=await hash(canonical({tool,args,binding:ctx.binding,recoveryOf:recoveryOf??null}));check(ctx);
    const key='starforge-grpc-console:'+ctx.consoleId+':'+ctx.profile+':'+fingerprint;
    let pending;try{pending=JSON.parse(sessionStorage.getItem(key));}catch{}
    if(!pending){const id=uid();pending={draftId:'grpc-draft-'+id,callId:'grpc-call-'+id,fingerprint};}
    if(pending.fingerprint!==fingerprint)throw new Error('The saved original gRPC selection changed.');
    // Complete arguments remain in the existing private Store. Only IDs and a digest enter sessionStorage.
    try{sessionStorage.setItem(key,JSON.stringify(pending));}catch{}
    const draft=await originalDraft(pending,tool,args,ctx,recoveryOf);check(ctx);
    await api('calls',{method:'POST',epoch:ctx.session,body:{id:pending.callId,profileId:ctx.profile,
      draftId:draft.id,draftRevision:draft.revision,expectedHostFingerprint:ctx.expectedHostFingerprint}});
    check(ctx);let call;
    try{call=await awaitCall(pending.callId,ctx);}finally{if(current(ctx))await loadProfile();}
    check(ctx);
    const result=JSON.parse(call.resultJson),value=nativeResult(result);
    adopt(name,args,call,result,value);
    try{sessionStorage.removeItem(key);}catch{}
    own.recovery=null;renderRecovery();render();
    notice('Saved '+name.replaceAll('_',' ')+' · '+call.id+'.');return value;
  }
  async function inventoryAt(offset=0,pinned=false){
    const args={workspace:workspace(),offset,limit:PAGE_SIZE};
    if(pinned){if(!own.inventory?.snapshot)throw new Error('Refresh the original inventory first.');args.expectedSnapshot=own.inventory.snapshot;}
    if(kind.value==='upgrades')return run('upgrade_reviews',args);
    if(kind.value==='health')return run('health_observations',args);
    return run('inventory',{...args,kind:kind.value});
  }
  async function choose(item,selectedKind){
    own.selected={kind:selectedKind,item};own.detail=null;own.detailPage=null;sectionOptions();
    if(selectedKind==='prepared'){
      preparation.value=item.id??'';revision.value=item.revision??'';sectionOptions();render();
      if(SHA.test(revision.value))await inspect('revision','summary');
    }else if(selectedKind==='revisions'){
      revision.value=item.id??item.revision??'';sectionOptions();await inspect('revision','summary');
    }else if(selectedKind==='attempts'){
      operation.value=item.id??item.operationId??'';revision.value=item.revision??revision.value;render();
      await run('attempt',{workspace:workspace(),operationId:operation.value});
    }else if(selectedKind==='upgrades'){
      upgrade.value=item.id??'';reviewSha.value=item.reviewSha256??'';sectionOptions();await inspect('upgrade','summary');
    }else if(selectedKind==='health'){
      selectHealth(item.id);render();await run('health_read',{workspace:workspace(),operationId:healthId.value,section:'summary'});await healthAt('events',0,false);
    }else if(selectedKind==='exports'){
      exportId.value=item.exportId??'';await run('export_manifest',{exportId:exportId.value});
    }else{render();details(ui.details,'Complete selected original inventory row',item);}
  }
  async function inspect(family,selectedSection){
    section.value=selectedSection;own.detailPage=null;
    const args={workspace:workspace(),section:selectedSection};
    if(['changes','methods','routes'].includes(selectedSection))Object.assign(args,{offset:0,limit:PAGE_SIZE});
    if(family==='upgrade'){own.selected={kind:'upgrades',item:{id:upgrade.value}};sectionOptions();section.value=selectedSection;args.operationId=upgrade.value;}
    else{if(own.selected?.kind==='upgrades')own.selected={kind:'revisions',item:{id:revision.value}};sectionOptions();section.value=selectedSection;args.revision=revision.value;}
    return run(family==='upgrade'?'upgrade_open':'revision',args);
  }
  async function detailAt(offset,pinned){
    const detail=own.detail;if(!detail||!own.detailPage)throw new Error('Inspect a paged original source section.');
    const args={...detail.args,offset,limit:PAGE_SIZE};
    if(pinned)args.expectedSnapshot=own.detailPage.snapshot;
    return run(detail.action,args);
  }
  function selectHealth(id){
    if(healthId.value!==id||own.health?.operation?.id!==id){own.health=null;own.eventPage=null;own.servicePage=null;ui.healthEvents.replaceChildren();ui.healthServices.replaceChildren();}
    healthId.value=id;
  }
  async function healthAt(selectedSection,afterSequence=0,pinned=false){
    if(!validOperation(healthId))throw new Error('Choose an original retained health operation.');
    const page=selectedSection==='events'?own.eventPage:own.servicePage;
    const args={workspace:workspace(),operationId:healthId.value,section:selectedSection,afterSequence,limit:PAGE_SIZE};
    if(selectedSection==='services')args.serviceFilter=filter.value;
    if(pinned){if(!page)throw new Error('Read the first original page.');args.throughSequence=page.throughSequence;args.expectedSnapshot=page.snapshot;}
    return run('health_read',args);
  }
  function adopt(name,args,call,result,value){
    const selected=grpcCustomerSelection(call,result),selectedWorkspace=args.workspace??selected?.workspace;
    if(selectedWorkspace&&selectedWorkspace!==own.workspace)changeWorkspace(selectedWorkspace);
    own.last={name,args,call,result,value,selection:selected};
    if(selected){
      const manifest=valuesOf(result).find(value=>value.state==='MANIFEST_RETAINED'&&value.exportId===selected.exportId);
      own.delivery={selection:selected,manifest};exportId.value=selected.exportId;
      if(manifest.original?.revision)revision.value=manifest.original.revision;
      if(manifest.original?.preparation)preparation.value=manifest.original.preparation;
    }
    if(name==='workspaces'){own.workspaces=value.workspaces??[];refreshAliases();}
    else if(name==='status'){own.status=value;if(!revision.value&&SHA.test(value.currentRevision??''))revision.value=value.currentRevision;}
    else if(['inventory','upgrade_reviews','health_observations'].includes(name)&&Array.isArray(value.items)){
      const inventoryKind=name==='upgrade_reviews'?'upgrades':name==='health_observations'?'health':args.kind;
      kind.value=inventoryKind;own.inventory={...value,kind:inventoryKind};
    }else if(name==='revision'||name==='upgrade_open'){
      own.detail={action:name,args,value};own.detailPage=Array.isArray(value.items)?value:null;
      if(name==='upgrade_open'&&value.reviewSha256){upgrade.value=value.id;reviewSha.value=value.reviewSha256;}
      if(name==='revision'&&value.revision)revision.value=value.revision;
    }else if(name==='attempt'){own.detail={action:name,args,value};operation.value=args.operationId;}
    else if(name==='health_read'&&value.operation){
      if(own.health?.operation?.id!==value.operation.id)selectHealth(value.operation.id);
      own.health=value;healthId.value=value.operation.id;
      if(args.section==='events'&&value.page){own.eventPage=value.page;renderEvents(value);}
      if(args.section==='services'&&value.page){own.servicePage=value.page;renderServices(value);}
    }
  }
  async function openOriginalCall(id){
    const ctx=context(),call=await api('call/'+encodeURIComponent(id),{epoch:ctx.session});check(ctx);
    if(!call.tool.startsWith(PREFIX))throw new Error('Choose an original saved gRPC request.');
    own.recovery=call;renderRecovery();
    if(call.state==='COMPLETE'){
      const result=JSON.parse(call.resultJson),value=nativeResult(result);
      adopt(call.tool.slice(PREFIX.length),JSON.parse(call.argumentsJson),call,result,value);render();
    }
  }
  function recoverSelection(call){
    const args=JSON.parse(call.argumentsJson),name=call.tool.slice(PREFIX.length);
    if(name==='export_manifest')return {name,args};
    if(name.startsWith('health_')&&args.operationId)return {name:'health_read',args:{workspace:args.workspace,operationId:args.operationId,section:'summary'}};
    if(name.startsWith('upgrade_')&&args.operationId)return {name:'upgrade_open',args:{workspace:args.workspace,operationId:args.operationId,section:'summary'}};
    if(['attempt','call','cancel_call'].includes(name)&&args.operationId)return {name:'attempt',args:{workspace:args.workspace,operationId:args.operationId}};
    if(args.workspace)return {name:'inventory',args:{workspace:args.workspace,kind:name==='prepare'?'prepared':'exports',offset:0,limit:PAGE_SIZE}};
    return null;
  }
  function renderRecovery(){
    ui.pending.replaceChildren();const call=own.recovery;if(!call)return;
    ui.pending.append(node('p',call.id+' · '+call.tool+' · '+call.receiving,'hint'));
    const actions=row(ui.pending),recover=recoverSelection(call);
    actions.append(localButton('Open saved request',()=>openCall(call.id)));
    actions.append(localButton('Read original operation',()=>run(recover.name,recover.args,{recoveryOf:call.id}),!recover||call.receiving==='ACTIVE'));
    actions.append(localButton('Continue exact saved arguments',()=>{
      if(call.receiving==='ACTIVE')throw new Error('This original call is still receiving.');
      return run(call.tool.slice(PREFIX.length),JSON.parse(call.argumentsJson),{recoveryOf:call.id});
    },call.receiving==='ACTIVE'||call.state==='COMPLETE'));
  }
  function refreshAliases(){
    const previous=own.workspace;alias.replaceChildren(new Option('Select configured workspace',''),
      ...own.workspaces.map(value=>new Option(value.label+' · '+value.workspace,value.workspace)));
    const selected=own.workspaces.some(value=>value.workspace===previous)?previous:own.workspaces[0]?.workspace??'';
    if(selected!==previous)changeWorkspace(selected);else alias.value=selected;
  }
  function changeWorkspace(value){
    own.epoch++;own.workspace=value;own.status=null;own.inventory=null;own.selected=null;own.detail=null;own.detailPage=null;
    own.health=null;own.eventPage=null;own.servicePage=null;own.delivery=null;own.recipe=null;
    for(const control of [revision,preparation,operation,upgrade,reviewSha,healthId,exportId])control.value='';
    ui.healthEvents.replaceChildren();ui.healthServices.replaceChildren();ui.recipeInfo.replaceChildren();alias.value=value;sectionOptions();
  }
  function render(){
    const binding=own.workspaces.find(value=>value.workspace===own.workspace);
    text(ui.workspaceInfo,binding?'Workspace '+binding.workspace+' · '+binding.ownership+' · '+(binding.captures?.length??0)+' captures · '+(binding.reflections?.length??0)+' reflection profiles':'Load the configured original workspaces.');
    properties(ui.workspaceState,own.status?[
      ['Current source revision',own.status.currentRevision,true],['Selection generation',own.status.generation],
      ['Source revisions',own.status.counts?.revisions],['Prepared merchants',own.status.counts?.prepared],
      ['Retained calls',own.status.counts?.attempts],['Contract reviews',own.status.counts?.upgrades],
      ['Health observations',own.status.counts?.health]
    ]:[['Workspace','Inspect the current original selection.']]);
    renderInventory();renderDetail();renderHealth();renderDelivery();renderHistory();renderReturn();sync();
  }
  function renderInventory(){
    const value=own.inventory;ui.inventoryRows.replaceChildren();
    text(ui.inventoryInfo,value?(value.total?String(value.offset+1)+'–'+(value.offset+value.items.length)+' of '+value.total:'0 records')+
      ' · '+value.kind+' · snapshot '+value.snapshot:'Refresh an original inventory to select its saved work.');
    for(const item of value?.items??[]){
      const id=item.exportId??item.id??item.revision??item.operationId??'Saved record';
      const label=item.title??item.kind??item.phase??item.state??value.kind;
      const b=localButton(label+' · '+id,()=>choose(item,value.kind));b.dataset.originalId=id;
      b.append(node('p',[(item.createdAt?when(item.createdAt):null),item.revision, item.reviewSha256].filter(Boolean).join(' · '),'hint'));ui.inventoryRows.append(b);
    }
  }
  function renderDetail(){
    properties(ui.selectionInfo,[
      ['Source revision',revision.value||'Choose a captured revision.',true],
      ['Merchant preparation',preparation.value||'Choose a prepared merchant.',true],
      ['Retained call',operation.value||'Choose an original call.',true],
      ['Contract review',upgrade.value||'Choose a reviewed contract.',true]
    ]);
    ui.details.replaceChildren();const detail=own.detail;if(!detail)return;
    if(own.detailPage){const page=own.detailPage;ui.details.append(node('p',(page.total?String(page.offset+1)+'–'+(page.offset+page.items.length)+' of '+page.total:'0 rows')+' · snapshot '+page.snapshot,'hint'));}
    details(ui.details,'Complete '+detail.action.replaceAll('_',' ')+' return',detail.value);
  }
  function renderHealth(){
    const value=own.health?.operation;properties(ui.healthInfo,value?[
      ['Observation',value.id,true],['Kind',value.kind],['Native state',value.phase],
      ['Reported status',value.reportedStatus??(value.kind==='list'?String(value.services??0)+' services':'No status observed')],
      ['Saved revision',value.revision,true],['Target',value.target],['Last observed',value.lastObservedAt],
      ['Original deadline',value.deadlineAt],['Version',value.version]
    ]:[['Health history','Choose an original Check, List or Watch observation.']]);
    text(ui.healthSnapshot,validHealth()?'Frozen delivery: events 1–'+own.eventPage.throughSequence+' · '+own.eventPage.snapshot:
      'Read an events page to select the exact complete history for delivery.');
  }
  function renderEvents(value){
    ui.healthEvents.replaceChildren();const page=value.page;
    ui.healthEvents.append(node('p',(page.total?String(page.afterSequence+1)+'–'+(page.afterSequence+value.events.length)+' of '+page.total:'0 events')+' · selected through '+page.throughSequence,'hint'));
    table(ui.healthEvents,['Sequence','Observed','Event','Original data'],value.events.map(event=>[
      event.sequence,event.at??event.observedAt,event.type??event.kind,node('pre',pretty(event))
    ]));
  }
  function renderServices(value){
    ui.healthServices.replaceChildren();const page=value.page;
    ui.healthServices.append(node('p',(page.total?String(page.afterSequence+1)+'–'+(page.afterSequence+value.services.length)+' of '+page.total:'0 matching services')+
      ' · '+value.sourceServices+' reported services · filter '+JSON.stringify(value.serviceFilter),'hint'));
    table(ui.healthServices,['Service','Reported status'],value.services.map(value=>[value.service,value.status]));
  }
  function renderDelivery(){
    const value=own.delivery;ui.deliveryFiles.replaceChildren();properties(ui.deliveryInfo,value?[
      ['Original export',value.selection.exportId,true],['Workspace',value.selection.workspace],['Delivery kind',value.manifest.kind],
      ['Original manifest SHA-256',value.selection.expectedManifestSha256,true],['Files',value.manifest.files.length],
      ['Bytes',value.manifest.files.reduce((sum,file)=>sum+file.bytes,0)],['Received customer',localCustomer()?.state??'Ready to receive']
    ]:[['Customer delivery','Export retained work or inspect an existing manifest.']]);
    if(value){table(ui.deliveryFiles,['Original path','Bytes','SHA-256'],value.manifest.files.map(file=>[file.path,file.bytes,file.sha256]));
      details(ui.deliveryFiles,'Original revision and operation identities',value.manifest.original);
      details(ui.deliveryFiles,'Resumable native receiving command',
        'starforge grpc-product receive --dir /ABSOLUTE/PRODUCT_DIRECTORY --export-id '+value.selection.exportId+
        ' --manifest-sha256 '+value.selection.expectedManifestSha256+' --out /ABSOLUTE/NEW_RECEIVING_DIRECTORY');
    }
  }
  function renderHistory(){
    ui.history.replaceChildren();
    const calls=(state.details?.calls??[]).filter(call=>call.tool.startsWith(PREFIX));
    for(const call of calls){const b=localButton(call.tool.slice(PREFIX.length).replaceAll('_',' '),()=>openOriginalCall(call.id));
      b.append(node('p',call.id+' · '+call.receiving+' · '+when(call.startedAt),'hint'));ui.history.append(b);}
    if(!calls.length)ui.history.append(node('p','gRPC requests are retained here and in Requests.','hint'));
  }
  function renderReturn(){
    ui.returned.replaceChildren();const value=own.last;if(!value)return;
    const info=node('dl',undefined,'properties');properties(info,[['Saved request',value.call.id,true],
      ['Tool',value.call.tool],['Completed',value.call.completedAt],['Exact return SHA-256',value.call.resultSha256,true]]);ui.returned.append(info);
    ui.returned.append(localButton('Download exact tool return',()=>download('result/'+encodeURIComponent(value.call.id),value.call.id+'-result.json')));
    details(ui.returned,value.value.state==='COMPLETE_RESULT_RETAINED'?'Complete result file selection':'Complete original return',value.value);
    text(ui.actionStatus,'Showing saved '+value.name.replaceAll('_',' ')+' from '+when(value.call.completedAt)+'.');
  }
  async function prepareRecipe(mode){
    const ctx=context(),packet=await api('grpc-recipe?'+new URLSearchParams({mode}),{epoch:ctx.session});check(ctx);
    const inputs={workspace:workspace()};
    if(mode==='customer')inputs.preparation=preparation.value;
    else if(mode==='upgrade')Object.assign(inputs,{operationId:upgrade.value,expectedReviewSha256:reviewSha.value});
    else if(mode==='health'){const original=frozenHealth();Object.assign(inputs,{operationId:original.operationId,throughSequence:original.throughSequence,expectedSnapshot:original.expectedSnapshot});}
    else inputs.operationId=operation.value;
    own.recipe={mode,recipe:packet.recipe,inputs};
    text(ui.recipeInfo,packet.recipe.steps.length+' original steps · '+packet.recipe.contentSha256);
    await useRecipe(packet.recipe,inputs);check(ctx);setPage('workflows');
    notice('Prepared the complete gRPC '+mode+' procedure with the selected original inputs.');
  }
  function profileChanged(){
    const identity=state.profile&&state.host?.console.workspaceId?state.host.console.workspaceId+'/'+state.profile.id+'/'+binding():null;
    if(identity!==own.identity||own.session!==state.sessionEpoch){
      own.identity=identity;own.session=state.sessionEpoch;own.workspaces=[];own.last=null;own.recovery=null;
      changeWorkspace('');alias.replaceChildren(new Option('Load configured workspaces',''));renderRecovery();render();
    }else{renderHistory();sync();}
  }
  function sync(){
    panel.hidden=!state.profile||!(state.host?.capabilities.families??[]).some(value=>value.name==='grpcWorkspaces');
    panel.setAttribute('aria-busy',String(own.pending));const enabled=Boolean(state.profile&&state.token&&!own.pending);
    for(const [b,ready]of gates)b.disabled=!enabled||!ready();
    for(const control of controls)control.disabled=!enabled;
    for(const b of panel.querySelectorAll('[data-grpc-local]'))b.disabled=!enabled||b.dataset.grpcLocal==='true';
  }
  function reset(){own.identity=null;own.session=null;own.last=null;own.recovery=null;own.workspaces=[];changeWorkspace('');
    ui.returned.replaceChildren();ui.history.replaceChildren();ui.pending.replaceChildren();panel.hidden=true;}
  alias.addEventListener('change',()=>{own.last=null;own.recovery=null;changeWorkspace(alias.value);renderRecovery();render();});
  kind.addEventListener('change',()=>{own.inventory=null;renderInventory();sync();});
  section.addEventListener('change',()=>{own.detail=null;own.detailPage=null;renderDetail();sync();});
  healthId.addEventListener('change',()=>{selectHealth(healthId.value);renderHealth();sync();});
  filter.addEventListener('change',()=>{own.servicePage=null;ui.healthServices.replaceChildren();sync();});
  for(const control of [revision,preparation,operation,upgrade,reviewSha,healthId,exportId])control.addEventListener('input',()=>{
    if(control===healthId&&(own.health?.operation?.id??'')!==healthId.value){own.eventPage=null;own.servicePage=null;}
    if(control===revision||control===upgrade){own.detail=null;own.detailPage=null;if(control===upgrade)reviewSha.value='';renderDetail();}
    if(control===exportId&&own.delivery?.selection.exportId!==exportId.value){own.delivery=null;renderDelivery();}
    sync();
  });
  return {profileChanged,reset,sync,refresh:()=>{renderHistory();sync();},get hasActive(){return own.pending;}};
}

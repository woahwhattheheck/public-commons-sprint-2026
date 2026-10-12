// MIT. Native catalogue receiving in the original authenticated STAC application.
const ACTIONS=new Set(['configure','connect','receive','review','publish-source','harvest','inspect-records','record-action','export-handover','receive-handover']);
const HASH=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)?value:[];
const clone=value=>JSON.parse(JSON.stringify(value));
const stamp=value=>value?String(value):'Not recorded';
const short=value=>value?String(value).slice(0,16)+'…':'Not recorded';
const pretty=value=>JSON.stringify(value??null,null,2);
function element(tag,props={},...children){
  const node=document.createElement(tag);let value;
  for(const [key,item]of Object.entries(props)){
    if(item===undefined||item===null)continue;
    if(key==='class')node.className=item;
    else if(key==='text')node.textContent=item;
    else if(key==='value')value=item;
    else if(['checked','disabled','selected','multiple'].includes(key))node[key]=Boolean(item);
    else if(key.startsWith('on')&&typeof item==='function')node.addEventListener(key.slice(2),item);
    else if(item!==false)node.setAttribute(key,item===true?'':String(item));
  }
  const append=item=>{if(item===undefined||item===null||item===false)return;if(Array.isArray(item))item.forEach(append);else node.append(item instanceof Node?item:document.createTextNode(String(item)));};
  children.forEach(append);if(value!==undefined)node.value=value;return node;
}
const text=value=>value===undefined||value===null?'Not recorded':typeof value==='object'?pretty(value):String(value);
const entry=(label,value)=>[element('dt',{},label),element('dd',{},value instanceof Node?value:text(value))];
const pill=value=>element('span',{class:'catalogue-status'},String(value??'Not observed').replaceAll('_',' '));
const filePath=value=>typeof value==='string'?value:typeof value?.path==='string'?value.path:null;
const unwrap=value=>plain(value)&&Object.hasOwn(value,'value')?value.value:value;
function absolutePath(value,label){
  if(typeof value!=='string'||!value.length||!(/^(?:\/|[A-Za-z]:[\\/])/.test(value))||/[\u0000-\u001f]/.test(value))throw new Error('Choose the absolute '+label+'.');
  return value;
}
function jsonObject(value,label){
  let parsed;try{parsed=JSON.parse(value);}catch{throw new Error(label+' must be valid JSON.');}
  if(!plain(parsed))throw new Error(label+' must be a JSON object.');return parsed;
}
function numeric(value,label,{min=0,max=Number.MAX_SAFE_INTEGER}={}){
  const result=Number(value);if(value===''||!Number.isSafeInteger(result)||result<min||result>max)throw new Error('Enter a valid '+label+'.');return result;
}
function validateRequest(row){
  return plain(row)&&typeof row.id==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(row.id)&&
    ACTIONS.has(row.action)&&plain(row.input)&&!Object.hasOwn(row.input,'operationId');
}
export async function mountCatalogueView({root,api,context}={}){
  if(!(root instanceof Element)||typeof api!=='function'||!context?.workspace?.id)throw new TypeError('The original STAC application context is required.');
  const owner=context.workspace.id,storageKey='stac-catalogue:'+owner+':requests';
  let disposed=false,timer=null,refreshing=null,requests=[],selectedSource=null,source=null,sourceLoading=null;
  let state=null,jobs=[],inspection=null,recordsResult=null,selectedRecord=null,activeTab='connection',notice=null;
  let connectionDraft=null,connectionDirty=false,deliveryDirectory='',sourceTitle='Catalogue receiving',sourceUrls='{}';
  let chosenCollections=new Set(),planDraft=null,planSource=null,selectedPlan=null,recordDraft=null;
  let exportDirectory='',importSource='',importDirectory='',working=0,observedRevision=null;
  const network=new Set(),openDetails=new Set();
  try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))requests=saved.filter(validateRequest);}catch{}
  function persist(){
    const native=state?.operations??{};
    const pending=requests.filter(row=>native[row.id]?.status!=='COMPLETE');
    const complete=requests.filter(row=>native[row.id]?.status==='COMPLETE').slice(-30);
    const value=JSON.stringify([...complete,...pending]);
    if(value.length>2*1024*1024)throw new Error('The retained browser request history is full. Reopen the saved native operation or use its original CLI request before adding another action.');
    localStorage.setItem(storageKey,value);
  }
  async function request(path,options={}){
    if(disposed)throw new Error('This catalogue view is closed.');
    const controller=new AbortController();network.add(controller);
    try{return await api(path,{...options,signal:controller.signal});}
    finally{network.delete(controller);}
  }
  function report(message,error=false){if(disposed)return;notice={message:String(message),error};render();}
  async function safe(work){
    try{return await work();}catch(error){if(!disposed&&error.name!=='AbortError')report(error.message||String(error),true);}
  }
  const button=(label,work,props={})=>element('button',{type:'button',class:'catalogue-button',onclick:()=>void safe(work),...props},label);
  function input(label,value,set,{name=label,type='text',help='',required=false,min,max,placeholder='',options}={}){
    const id='catalogue-'+name.replace(/[^a-z0-9_-]/gi,'-').toLowerCase();
    const props={id,'data-focus':name,value,type,required,min,max,placeholder,autocomplete:'off',oninput:event=>set(event.target.value)};
    const control=options?element('select',{...props,onchange:event=>set(event.target.value)},options.map(([v,l])=>element('option',{value:v},l))):element('input',props);
    return element('label',{class:'catalogue-field',for:id},element('span',{},label),control,help?element('small',{},help):null);
  }
  function area(label,value,set,{name=label,rows=4,help=''}={}){
    const id='catalogue-'+name.replace(/[^a-z0-9_-]/gi,'-').toLowerCase();
    return element('label',{class:'catalogue-field',for:id},element('span',{},label),
      element('textarea',{id,'data-focus':name,value,rows,spellcheck:false,oninput:event=>set(event.target.value)}),
      help?element('small',{},help):null);
  }
  function check(label,checked,set,{disabled=false,name=label}={}){
    return element('label',{class:'catalogue-check'},element('input',{type:'checkbox','data-focus':name,checked,disabled,onchange:event=>set(event.target.checked)}),element('span',{},label));
  }
  function details(key,label,value){
    const box=element('details',{'data-detail':key,open:openDetails.has(key)},element('summary',{},label),value instanceof Node?value:element('pre',{},pretty(value)));
    box.addEventListener('toggle',()=>{if(box.open)openDetails.add(key);else openDetails.delete(key);});return box;
  }
  function section(title,description,...children){
    return element('section',{class:'catalogue-section'},element('div',{class:'catalogue-section-heading'},element('h3',{},title),description?element('p',{},description):null),children);
  }
  function table(headings,rows){
    return element('div',{class:'catalogue-table-scroll'},element('table',{},element('thead',{},element('tr',{},headings.map(label=>element('th',{scope:'col'},label)))),
      element('tbody',{},rows.length?rows:element('tr',{},element('td',{colspan:headings.length,class:'catalogue-empty'},'No saved entries.')))));
  }
  function download(path,label){
    if(!path||!['sources/','operations/','archives/'].some(prefix=>path.startsWith(prefix)))return null;
    return element('a',{class:'catalogue-link',href:'/api/catalogue/files?path='+encodeURIComponent(path),download:''},label||path.split('/').at(-1));
  }
  function knownRequest(id){
    const local=requests.find(row=>row.id===id);if(local)return local;
    const operation=state?.operations?.[id],saved=operation?.request;
    const mapping={configure:'configure',connect:'connect',receive:'receive',review:'review',publishSource:'publish-source',harvest:'harvest',inspectRecords:'inspect-records',recordAction:'record-action',exportHandover:'export-handover',receiveHandover:'receive-handover'};
    if(saved&&Object.hasOwn(mapping,saved.action)&&plain(saved.input)&&saved.input.operationId===id){
      const input=clone(saved.input);delete input.operationId;
      const row={id,action:mapping[saved.action],input,createdAt:operation.startedAt};
      if(validateRequest(row))return row;
    }
    return null;
  }
  async function dispatch(row,reconcile=false){
    working++;row.delivery='DISPATCHING';row.updatedAt=new Date().toISOString();persist();render();
    try{
      const job=await request('/api/catalogue/actions/'+row.action,{method:'POST',body:{operationId:row.id,input:row.input,reconcile}});
      row.delivery='ACKNOWLEDGED';row.updatedAt=new Date().toISOString();persist();
      jobs=[...jobs.filter(value=>value.id!==job.id),job];
      notice={message:'Saved operation '+row.id+'. Its native outcome appears in Operations.',error:false};
      await refresh(true);return job;
    }catch(error){
      row.delivery='ACKNOWLEDGEMENT_UNAVAILABLE';row.updatedAt=new Date().toISOString();try{persist();}catch{}
      throw new Error((error.message||String(error))+' The saved operation is '+row.id+'. Refresh its state and use Continue saved operation.');
    }finally{working--;render();schedule();}
  }
  async function perform(action,input){
    const row={id:'catalogue-'+crypto.randomUUID(),action,input:clone(input),createdAt:new Date().toISOString(),delivery:'PREPARED'};
    if(!validateRequest(row))throw new Error('This catalogue request is invalid.');
    requests.push(row);try{persist();}catch(error){requests.pop();throw new Error('Save the original operation identity before dispatch. '+error.message);}
    activeTab='operations';render();return dispatch(row);
  }
  async function continueOperation(id){
    const original=knownRequest(id);if(!original)throw new Error('This operation has no saved public request envelope. Use the original CLI input and ID.');
    if(!requests.some(row=>row.id===id))requests.push(original);
    persist();return dispatch(original,true);
  }
  function selectedNativePlan(){return list(state?.plans).find(value=>value.sha256===selectedPlan)??null;}
  function nativeRecord(){return list(recordsResult?.records??state?.records).find(value=>value.uuid===selectedRecord)??null;}
  function snapshotRequestBodies(){
    for(const op of Object.values(state?.operations??{})){
      if(requests.some(row=>row.id===op.id))continue;
      const original=knownRequest(op.id);
      if(original)requests.push(original);
    }
    try{persist();}catch{}
  }
  async function loadSource(sha){
    if(!HASH.test(sha??''))return;
    if(source?.sha256===sha)return;
    if(sourceLoading?.sha===sha)return sourceLoading.promise;
    const chosen=sha,promise=request('/api/catalogue/sources/'+sha).then(value=>{
      if(selectedSource===chosen){source=value;render();}
    }).finally(()=>{if(sourceLoading?.sha===chosen)sourceLoading=null;});
    sourceLoading={sha,promise};return promise;
  }
  function schedule(){
    if(disposed)return;clearTimeout(timer);
    timer=setTimeout(()=>{if(root.isConnected&&document.visibilityState==='visible')void safe(()=>refresh());else schedule();},working||jobs.some(job=>job.status==='RUNNING')?1500:5000);
  }
  async function refresh(force=false){
    if(disposed)return;if(refreshing)return refreshing;
    refreshing=(async()=>{
      const [current,recent]=await Promise.all([request('/api/catalogue/state'),request('/api/jobs')]);
      if(current.schema!=='starforge.stac-geonetwork.v1'||current.stacWorkspaceId&&current.stacWorkspaceId!==owner)throw new Error('The active catalogue belongs to a different imagery workspace.');
      state=current;jobs=list(recent.jobs).filter(row=>String(row.kind).startsWith('catalogue-'));
      snapshotRequestBodies();
      if(!selectedSource||!state.sources.some(row=>row.sourceSha256===selectedSource)){selectedSource=state.sources.at(-1)?.sourceSha256??null;source=null;}
      if(!selectedPlan||!state.plans.some(row=>row.sha256===selectedPlan))selectedPlan=state.plans.at(-1)?.sha256??null;
      const observations=Object.values(state.operations).filter(op=>Array.isArray(op.result?.records)).sort((a,b)=>String(a.updatedAt).localeCompare(String(b.updatedAt)));
      if(observations.length)recordsResult=observations.at(-1).result;
      if(!selectedRecord||!list(recordsResult?.records??state.records).some(row=>row.uuid===selectedRecord)){selectedRecord=list(recordsResult?.records??state.records)[0]?.uuid??null;recordDraft=null;}
      if(!connectionDraft)connectionDraft=clone(state.connection??{baseUrl:'',portal:'srv',language:'eng',expectedVersion:'',
        auth:{usernameEnv:'GEONETWORK_USERNAME',passwordEnv:'GEONETWORK_PASSWORD'},allowHttp:false,timeoutMs:30000,maxResponseBytes:8388608,maxMefBytes:67108864});
      if(force||observedRevision!==state.revision||jobs.some(row=>row.status==='RUNNING'))render();
      observedRevision=state.revision;
      if(selectedSource&&!source)await loadSource(selectedSource);
    })().finally(()=>{refreshing=null;schedule();});
    return refreshing;
  }
  function renderConnection(){
    const d=connectionDraft;
    if(!d)return section('Installation','Reading the saved connection…');
    const set=(key,value)=>{d[key]=value;connectionDirty=true;};
    const auth=(key,value)=>{d.auth??={};if(value)d.auth[key]=value;else delete d.auth[key];connectionDirty=true;};
    const cap=state.capabilities?.value??state.capabilities;
    return [
      section('GeoNetwork installation','Use the existing installation context and local environment variable names. The browser never accepts password or cookie values.',
        element('div',{class:'catalogue-grid'},
          input('Installation URL',d.baseUrl,v=>set('baseUrl',v),{name:'connection-url',required:true,placeholder:'https://catalogue.example/geonetwork'}),
          input('Portal',d.portal,v=>set('portal',v),{name:'portal'}),
          input('Language',d.language,v=>set('language',v),{name:'language'}),
          input('Expected installed version',d.expectedVersion??'',v=>set('expectedVersion',v),{name:'expected-version',help:'Optional exact version from the selected installation.'}),
          input('Username variable',d.auth?.usernameEnv??'',v=>auth('usernameEnv',v),{name:'username-env'}),
          input('Password variable',d.auth?.passwordEnv??'',v=>auth('passwordEnv',v),{name:'password-env'}),
          input('Cookie variable',d.auth?.cookieEnv??'',v=>auth('cookieEnv',v),{name:'cookie-env'}),
          input('CSRF variable',d.auth?.csrfEnv??'',v=>auth('csrfEnv',v),{name:'csrf-env'})),
        check('Allow HTTP on the selected catalogue network',d.allowHttp,v=>set('allowHttp',v),{name:'allow-http'}),
        details('connection-limits','Transport limits',element('div',{class:'catalogue-grid'},
          input('Timeout in milliseconds',d.timeoutMs,v=>set('timeoutMs',v),{name:'timeout',type:'number',min:1000,max:300000}),
          input('Maximum response bytes',d.maxResponseBytes,v=>set('maxResponseBytes',v),{name:'response-limit',type:'number',min:1024,max:67108864}),
          input('Maximum full MEF bytes',d.maxMefBytes,v=>set('maxMefBytes',v),{name:'mef-limit',type:'number',min:1024,max:536870912}))),
        element('div',{class:'catalogue-actions'},
          button('Save reviewed connection',()=>{
            const connection={...clone(d),expectedVersion:d.expectedVersion||null,
              timeoutMs:numeric(d.timeoutMs,'timeout',{min:1000,max:300000}),
              maxResponseBytes:numeric(d.maxResponseBytes,'response limit',{min:1024,max:67108864}),
              maxMefBytes:numeric(d.maxMefBytes,'MEF limit',{min:1024,max:536870912})};
            return perform('configure',{connection,expectedRevision:state.revision});
          },{disabled:working>0}),
          button('Read native identity and capabilities',()=>perform('connect',{}),{disabled:!state.connection||working>0}),
          state.connection?button('Use saved connection',()=>{connectionDraft=clone(state.connection);connectionDirty=false;render();},{class:'catalogue-button secondary'}):null),
        connectionDirty?element('p',{class:'catalogue-note'},'The form has unsaved changes. Connecting uses the last saved connection.'):null),
      section('Native identity and available operations',cap?'These values were returned by the selected installation.':'Connect to read the installed version, actor, groups and native operation catalogue.',
        cap?element('dl',{class:'catalogue-facts'},entry('Authenticated',cap.authenticated),entry('Actor',cap.actor),
          entry('Installed version',cap.version),entry('Expected version matches',cap.versionMatches)):null,
        table(['Group ID','Actor profiles'],list(cap?.groups).map(row=>element('tr',{},element('td',{},row.id),element('td',{},list(row.profiles).join(', '))))),
        cap?details('native-options','Native options and discovery result',cap.options):null)
    ];
  }
  function renderSources(){
    const incoming=list(inspection?.collections);
    return [
      section('Original customer delivery','Inspect a completed StacDelivery and choose the complete set of collections for this native harvester.',
        element('div',{class:'catalogue-grid'},
          input('Received delivery directory',deliveryDirectory,v=>{deliveryDirectory=v;},{name:'delivery-directory',required:true}),
          input('Source title',sourceTitle,v=>{sourceTitle=v;},{name:'source-title'})),
        button('Inspect original delivery',async()=>{
          inspection=await request('/api/catalogue/inspect-delivery',{method:'POST',body:{deliveryDirectory:absolutePath(deliveryDirectory,'received delivery directory')}});
          chosenCollections=new Set();render();
        },{disabled:working>0}),
        inspection?element('div',{},details('delivery-manifest','Verified delivery manifest',inspection.manifest),
          table(['Select','Collection','Title and rights'],incoming.map(collection=>element('tr',{},
            element('td',{},check('Select '+collection.id,chosenCollections.has(collection.id),checked=>{if(checked)chosenCollections.add(collection.id);else chosenCollections.delete(collection.id);},{name:'collection-'+collection.id})),
            element('td',{},element('code',{},collection.id)),element('td',{},element('strong',{},collection.title??collection.id),
              element('p',{},collection.license??'No licence supplied'),details('collection-'+collection.id,'Original collection metadata',collection))))),
          area('Original document URL overrides',sourceUrls,v=>{sourceUrls=v;},{name:'source-urls',help:'Only needed when original relative links lack an absolute source document URL. Map collection ID to its actual original URL.'}),
          button('Receive selected collections',()=>{
            if(!chosenCollections.size)throw new Error('Select at least one original collection.');
            return perform('receive',{deliveryDirectory:inspection.directory,collectionIds:[...chosenCollections],sourceUrls:jsonObject(sourceUrls,'Source URL map'),sourceTitle});
          },{disabled:working>0})):null),
      section('Saved complete sources','Every source retains original collection IDs, their native UUID mapping, metadata and complete content-addressed collection JSON.',
        table(['Source','Collections','Received','Open'],list(state.sources).map(row=>element('tr',{},
          element('td',{},element('strong',{},row.title),element('code',{},short(row.sourceSha256))),
          element('td',{},row.collectionIds.length),element('td',{},stamp(row.receivedAt)),
          element('td',{},button(selectedSource===row.sourceSha256?'Selected':'Open',async()=>{selectedSource=row.sourceSha256;source=null;planDraft=null;await loadSource(selectedSource);render();}))))),
        source?element('div',{},
          element('dl',{class:'catalogue-facts'},entry('Source SHA256',source.sha256),entry('Document SHA256',source.documentSha256),entry('Original delivery',source.sourceIdentity)),
          table(['Collection ID','Native UUID'],list(source.nativeRecords).map(row=>element('tr',{},element('td',{},row.collectionId),element('td',{},row.uuid)))),
          source.issues?.length?details('source-issues','Source input issues',source.issues):element('p',{class:'catalogue-note'},'No unresolved source input issues.'),
          element('div',{class:'catalogue-actions'},
            element('a',{class:'catalogue-link',href:'/api/catalogue/documents/'+source.documentSha256,download:''},'Download complete collection JSON'),
            button('Publish in configured source directory',()=>perform('publish-source',{sourceSha256:source.sha256}),{disabled:working>0}),
            button('Review native harvest plan',()=>{activeTab='plan';render();})),
          element('p',{class:'catalogue-note'},'Use an existing source publication directory or serve the downloaded JSON at a URL containing its document SHA256. GeoNetwork must be able to read those exact bytes.')):null)
    ];
  }
  function ensurePlan(){
    if(!source)return null;
    if(planDraft&&planSource===source.sha256)return planDraft;
    const latest=list(state.plans).filter(row=>row.sourceSha256===source.sha256).at(-1);
    const cap=state.capabilities?.value??state.capabilities;
    planSource=source.sha256;
    planDraft={title:latest?.title??state.title,ownerId:latest?.ownerId??cap?.actor?.id??'',ownerGroupId:latest?.ownerGroupId??'',
      sourceUrl:latest?.sourceUrl??Object.values(state.operations).filter(op=>op.status==='COMPLETE'&&op.result?.sourceSha256===source.sha256&&typeof op.result?.sourceUrl==='string').at(-1)?.result.sourceUrl??'',validation:latest?.validation??'NOVALIDATION',reviewNote:'',
      postHarvestValidation:latest?.postHarvestValidation!==false,privileges:clone(latest?.privileges??[]),acknowledgedRemovals:[]};
    return planDraft;
  }
  function sourceRemovals(){
    const previous=list(state.sources).find(row=>row.sourceSha256===state.lastVerifiedSourceSha256);
    return list(previous?.collectionIds).filter(id=>!list(source?.collectionIds).includes(id));
  }
  function renderPlan(){
    const d=ensurePlan(),cap=state.capabilities?.value??state.capabilities;
    if(!d)return section('Native harvest plan','Select a saved complete source in the Source tab first.');
    const chosen=selectedNativePlan(),removals=sourceRemovals();
    const groups=[...new Map([{id:'-1',profiles:['Guest']},{id:'0',profiles:['Intranet']},{id:'1',profiles:['All users']},...list(cap?.groups)].map(row=>[String(row.id),row])).values()];
    const privilegeOps=['view','download','notify','dynamic','featured'];
    const rowFor=id=>{let row=d.privileges.find(value=>String(value.groupId)===id);if(!row){row={groupId:id,operations:[]};d.privileges.push(row);}return row;};
    return [
      section('Review this complete source','This plan uses GeoNetwork’s native STAC transform and one inactive, one-run-only SimpleURL harvester.',
        element('dl',{class:'catalogue-facts'},entry('Selected source',source.sha256),entry('Collections',source.collectionIds)),
        element('div',{class:'catalogue-grid'},
          input('Harvester title',d.title,v=>{d.title=v;},{name:'harvester-title'}),
          input('Owner user ID',d.ownerId,v=>{d.ownerId=v;},{name:'owner-id',help:'Use the actual native owner account.'}),
          input('Owner group ID',d.ownerGroupId,v=>{d.ownerGroupId=v;},{name:'owner-group',help:'Use the actual non-reserved owning group.'}),
          input('Complete document URL',d.sourceUrl,v=>{d.sourceUrl=v;},{name:'source-url',help:'The reachable URL must contain '+source.documentSha256+'.'}),
          input('Native validation mode',d.validation,v=>{d.validation=v;},{name:'validation-mode',options:[
            ['NOVALIDATION','No import validation'],['XSDVALIDATION','XSD validation'],['SCHEMATRONVALIDATION','Schematron validation']]})),
        check('Validate each retained record after the completed harvest',d.postHarvestValidation,v=>{d.postHarvestValidation=v;},{name:'post-validation'}),
        details('plan-privileges','Initial native sharing',table(['Group',...privilegeOps],groups.map(group=>{
          const id=String(group.id);return element('tr',{},element('th',{scope:'row'},id+' · '+list(group.profiles).join(', ')),
            privilegeOps.map(op=>element('td',{},check(op,list(d.privileges.find(row=>String(row.groupId)===id)?.operations).includes(op),checked=>{
              const row=rowFor(id);row.operations=checked?[...new Set([...row.operations,op])]:row.operations.filter(v=>v!==op);
            },{name:'harvest-share-'+id+'-'+op}))));
        }))),
        removals.length?element('div',{class:'catalogue-review'},element('h4',{},'Review removed collections'),element('p',{},'The original harvester will remove these previously owned records. Review each selected removal.'),
          removals.map(id=>check(id,d.acknowledgedRemovals.includes(id),checked=>{d.acknowledgedRemovals=checked?[...new Set([...d.acknowledgedRemovals,id])]:d.acknowledgedRemovals.filter(v=>v!==id);},{name:'remove-'+id}))):null,
        area('Review note',d.reviewNote,v=>{d.reviewNote=v;},{name:'review-note',help:'Record why this complete source, ownership, sharing and removal selection is ready.'}),
        button('Save reviewed plan',()=>perform('review',{sourceSha256:source.sha256,plan:{...clone(d),privileges:d.privileges.filter(row=>row.operations.length)}}),{disabled:working>0})),
      section('Saved harvest plans','Run only the selected reviewed plan. Continue an interrupted harvest from its original operation in Operations.',
        table(['Title','Plan SHA256','Collections','Select'],list(state.plans).map(row=>element('tr',{},
          element('td',{},row.title),element('td',{},element('code',{},short(row.sha256))),
          element('td',{},list(row.expectedCollectionIds).length),element('td',{},button(selectedPlan===row.sha256?'Selected':'Select',()=>{selectedPlan=row.sha256;render();}))))),
        chosen?element('div',{},details('selected-plan','Complete reviewed native plan',chosen),
          button('Run selected native harvest',()=>perform('harvest',{planSha256:chosen.sha256,pollMs:1000,maxPollMs:60000}),{disabled:working>0})):null,
        state.harvester?details('current-harvester','Current native harvester and final readback',state.harvester):null)
    ];
  }
  function ensureRecordDraft(record){
    if(recordDraft?.uuid===record.uuid)return recordDraft;
    const sharing=unwrap(record.sharing);
    recordDraft={uuid:record.uuid,metadataSha256:record.metadataSha256,sharingSha256:record.sharingSha256,
      draftSha256:record.draft?.metadataSha256??null,clear:false,
      privileges:clone(list(sharing?.privileges).map(row=>({group:row.group,operations:row.operations??{},restricted:row.restricted===true}))),
      message:'',directApproval:false,approved:true,publicationType:''};
    return recordDraft;
  }
  function renderRecords(){
    const records=list(recordsResult?.records??state.records),record=nativeRecord();
    const options=list(recordsResult?.publicationOptions?.value??recordsResult?.publicationOptions);
    const d=record?ensureRecordDraft(record):null;
    const operationNames=[...new Set(list(d?.privileges).flatMap(row=>Object.keys(row.operations)))].sort();
    return [
      section('Native records and harvest history','Read current ownership, metadata, sharing, persisted validation and workflow from the selected native installation.',
        button('Read native records and history',()=>perform('inspect-records',{}),{disabled:!state.connection||working>0}),
        recordsResult?.observedAt?element('p',{class:'catalogue-note'},'Observed '+recordsResult.observedAt):null,
        table(['Record UUID','Owner / source','Validation','Review'],records.map(row=>element('tr',{},
          element('td',{},element('code',{},row.uuid)),element('td',{},text(row.info?.ownerId??row.ownerId)+' / '+text(row.info?.source)),
          element('td',{},text(row.validation?.valid??row.info?.valid)),
          element('td',{},button(selectedRecord===row.uuid?'Selected':'Review',()=>{selectedRecord=row.uuid;recordDraft=null;render();}))))),
        recordsResult?.history?details('harvest-history','Native harvest history',recordsResult.history):null),
      record?section('Review selected record','Every mutation uses the metadata and sharing hashes of this explicit review. Reopen the current record after a change.',
        element('dl',{class:'catalogue-facts'},entry('UUID',record.uuid),entry('Approved metadata SHA256',d.metadataSha256),
          entry('Sharing SHA256',d.sharingSha256),entry('Native source and owner',record.info),entry('Workflow',record.workflow)),
        element('div',{class:'catalogue-actions'},download(filePath(record.xmlFile),'Download approved native XML'),
          record.draft?download(filePath(record.draft.xmlFile),'Download current draft XML'):null,
          button('Use current observed record',()=>{recordDraft=null;render();},{class:'catalogue-button secondary'})),
        record.draft?element('p',{class:'catalogue-note'},'Draft metadata SHA256: '+record.draft.metadataSha256+'. Submission and approval use this reviewed draft.'):null,
        details('record-validation','Persisted native validation',record.validation??record.info?.validationDetails),
        check('Validate the approved version',d.approved,v=>{d.approved=v;},{name:'validation-approved'}),
        button('Run native validation',()=>perform('record-action',{uuid:record.uuid,action:'validate',payload:{approved:d.approved},
          expectedMetadataSha256:d.approved?d.metadataSha256:d.draftSha256??d.metadataSha256}),{disabled:working>0}),
        details('record-sharing','Edit reviewed native sharing',element('div',{},
          check('Clear existing sharing before applying this complete selection',d.clear,v=>{d.clear=v;},{name:'sharing-clear'}),
          table(['Group',...operationNames],d.privileges.map(row=>element('tr',{},element('th',{scope:'row'},row.group),
            operationNames.map(op=>element('td',{},check(op,row.operations[op]===true,value=>{row.operations[op]=value;},{disabled:row.restricted,name:'share-'+row.group+'-'+op})))))),
          button('Apply reviewed sharing',()=>perform('record-action',{uuid:record.uuid,action:'sharing',
            expectedMetadataSha256:d.metadataSha256,expectedSharingSha256:d.sharingSha256,
            payload:{clear:d.clear,privileges:d.privileges.map(({group,operations})=>({group,operations}))}}),{disabled:!d.sharingSha256||working>0}))),
        area('Workflow message',d.message,v=>{d.message=v;},{name:'workflow-message'}),
        check('Use native direct approval',d.directApproval,v=>{d.directApproval=v;},{name:'direct-approval'}),
        element('div',{class:'catalogue-actions'},
          button('Submit reviewed draft',()=>perform('record-action',{uuid:record.uuid,action:'submit',payload:{message:d.message},
            expectedMetadataSha256:d.draftSha256??d.metadataSha256}),{disabled:working>0}),
          button('Approve reviewed draft',()=>perform('record-action',{uuid:record.uuid,action:'approve',payload:{message:d.message,directApproval:d.directApproval},
            expectedMetadataSha256:d.draftSha256??d.metadataSha256}),{disabled:working>0})),
        options.length?element('div',{},input('Native publication option',d.publicationType,v=>{d.publicationType=v;},{name:'publication-option',
          options:[['','Select an actual native publication option'],...options.map(option=>[option.name,option.name])]}),
          details('publication-options','Exact native publication configurations',options),
          button('Publish with reviewed option',()=>{
            if(!options.some(option=>option.name===d.publicationType))throw new Error('Select a returned native publication option.');
            return perform('record-action',{uuid:record.uuid,action:'publish',payload:{publicationType:d.publicationType},
              expectedMetadataSha256:d.metadataSha256,expectedSharingSha256:d.sharingSha256});
          },{disabled:working>0})):element('p',{class:'catalogue-note'},'Read native records to discover actual publication options.'),
        details('record-native','Complete retained native record',record)):null
    ];
  }
  function renderHandovers(){
    const exports=Object.values(state.operations).filter(row=>row.kind==='EXPORT_HANDOVER'||row.request?.action==='exportHandover');
    const imports=Object.values(state.operations).filter(row=>row.kind==='RECEIVE_HANDOVER'||row.request?.action==='receiveHandover');
    for(const job of jobs.filter(row=>row.kind==='catalogue-receive-handover')){
      if(!imports.some(row=>row.id===job.id))imports.push({...job,status:job.result?.receipt?'RECEIVED':job.status});
    }
    return [
      section('Complete operator handover','Copy original delivery bytes, source documents, reviewed plans, native operation files and full archives to one new private directory.',
        input('Handover output directory',exportDirectory,v=>{exportDirectory=v;},{name:'handover-output',help:'Select a separate directory with enough space for the complete original delivery and native files.'}),
        button('Create complete handover',()=>perform('export-handover',{outputDirectory:absolutePath(exportDirectory,'handover output directory')}),{disabled:working>0}),
        table(['Operation','Native status','Saved result'],exports.map(op=>element('tr',{},element('td',{},op.id),element('td',{},pill(op.status)),element('td',{},details('export-'+op.id,'Handover directory and manifest',op.result??op.error)))))),
      section('Receive on this host','Validate and receive an existing handover into a new private workspace. The current STAC host keeps its selected catalogue workspace.',
        element('div',{class:'catalogue-grid'},
          input('Source handover directory',importSource,v=>{importSource=v;},{name:'handover-source'}),
          input('New receiving workspace directory',importDirectory,v=>{importDirectory=v;},{name:'handover-receive'})),
        button('Receive complete handover',()=>perform('receive-handover',{sourceDirectory:absolutePath(importSource,'source handover directory'),directory:absolutePath(importDirectory,'new receiving directory')}),{disabled:working>0}),
        element('p',{class:'catalogue-note'},'After receiving, review the new catalogue directory in this same STAC Applications card and start that selection. Original native installation and ownership bindings remain in the received state.'),
        table(['Operation','Native status','Receiving result'],imports.map(op=>element('tr',{},element('td',{},op.id),element('td',{},pill(op.status)),element('td',{},details('import-'+op.id,'Received workspace and receipt',op.result??op.error)))))),
      section('Native archives','Full MEF attachment and record verification is recorded separately from external STAC asset URLs. Reopen the exact saved archive result before recovery.',
        table(['Archive','Saved native result'],list(state.archives).map((row,index)=>element('tr',{},
          element('td',{},download(filePath(row.path??row.file),'Download native archive')??String(row.id??index+1)),
          element('td',{},details('archive-'+index,'Archive identity and inventory',row))))))
    ];
  }
  function renderOperations(){
    const combined=new Map(Object.values(state.operations).map(row=>[row.id,row]));
    for(const request of requests)if(!combined.has(request.id))combined.set(request.id,{id:request.id,kind:request.action,status:'AWAITING_NATIVE_OBSERVATION',startedAt:request.createdAt});
    const rows=[...combined.values()].sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));
    return section('Saved operations','Native status is authoritative. A completed HTTP job can still leave a native harvest RUNNING, PARTIAL or RECONCILE. Continue the exact saved request after reviewing its current state.',
      table(['Operation','Action / native status','Current exchange','Details and continuation'],rows.map(op=>{
        const local=knownRequest(op.id),job=jobs.find(row=>row.id===op.id);
        return element('tr',{},element('td',{},element('code',{},op.id),element('small',{},stamp(op.startedAt))),
          element('td',{},op.kind,pill(op.status)),element('td',{},job?pill('HTTP job '+job.status):requests.find(row=>row.id===op.id)?.delivery??'Saved native operation'),
          element('td',{},details('operation-'+op.id,'Request, steps and native outcome',{request:local??op.request??null,operation:op,job:job??null}),
            local&&op.status!=='COMPLETE'?button(job?.status==='RUNNING'?'Native work is active':'Continue saved operation',()=>continueOperation(op.id),
              {disabled:working>0||job?.status==='RUNNING'}):null));
      })));
  }
  function render(){
    if(disposed)return;
    const active=root.contains(document.activeElement)?document.activeElement:null;
    const focus=active?.dataset?.focus,selection=active&&typeof active.selectionStart==='number'?{start:active.selectionStart,end:active.selectionEnd}:null;
    if(!state){root.replaceChildren(element('p',{class:'catalogue-note'},notice?.message??'Reading the saved catalogue workspace…'));return;}
    const navigation=element('nav',{class:'catalogue-nav','aria-label':'Catalogue workflow'});
    for(const [key,label]of [['connection','Installation'],['source','Collection source'],['plan','Harvest plan'],['records','Record review'],['handover','Handover'],['operations','Operations']])
      navigation.append(button(label,()=>{activeTab=key;render();},{role:'tab','aria-selected':activeTab===key}));
    const content=activeTab==='connection'?renderConnection():activeTab==='source'?renderSources():activeTab==='plan'?renderPlan():
      activeTab==='records'?renderRecords():activeTab==='handover'?renderHandovers():renderOperations();
    root.replaceChildren(element('div',{class:'catalogue'},
      element('header',{class:'catalogue-header'},element('div',{},element('h2',{},state.title??'Catalogue receiving'),
        element('p',{},'Native GeoNetwork · '+state.id+' · revision '+state.revision)),
        button('Refresh saved state',()=>refresh(true),{disabled:working>0})),
      notice?element('p',{class:'catalogue-notice'+(notice.error?' error':''),role:notice.error?'alert':'status'},notice.message):null,
      navigation,element('div',{class:'catalogue-content'},content)));
    if(focus){const target=[...root.querySelectorAll('[data-focus]')].find(node=>node.dataset.focus===focus);
      if(target){target.focus({preventScroll:true});if(selection&&typeof target.setSelectionRange==='function')try{target.setSelectionRange(selection.start,selection.end);}catch{}}}
  }
  const onVisibility=()=>{if(document.visibilityState==='visible'&&root.isConnected)void safe(()=>refresh());};
  document.addEventListener('visibilitychange',onVisibility);
  try{await refresh(true);}catch(error){
    disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',onVisibility);
    for(const controller of network)controller.abort();network.clear();throw error;
  }
  return {
    async update(next){
      if(next?.workspace?.id!==owner)throw new Error('The catalogue view cannot switch original workspace identity.');
      context=next;
      if(!disposed&&root.isConnected&&document.visibilityState==='visible'&&!refreshing&&
        (next?.jobs??[]).some(job=>String(job.kind).startsWith('catalogue-')&&job.status==='RUNNING'))await refresh();
    },
    async dispose(){
      if(disposed)return;disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',onVisibility);
      for(const controller of network)controller.abort();network.clear();
      await refreshing?.catch(()=>{});
    }
  };
}


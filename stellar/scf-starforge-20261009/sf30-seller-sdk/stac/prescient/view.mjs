// MIT. Industrial Prescient operator view in the original STAC browser session.
const node=(tag,props={},...children)=>{
  const value=document.createElement(tag);let selected;
  for(const [key,item]of Object.entries(props)){
    if(item===undefined||item===null||item===false)continue;
    if(key==='class')value.className=item;
    else if(key==='value')selected=item;
    else if(key==='checked'||key==='disabled')value[key]=Boolean(item);
    else if(key.startsWith('on')&&typeof item==='function')value.addEventListener(key.slice(2).toLowerCase(),item);
    else value.setAttribute(key,item===true?'':String(item));
  }
  const add=item=>{if(item===undefined||item===null||item===false)return;if(Array.isArray(item))return item.forEach(add);value.append(item instanceof Node?item:document.createTextNode(String(item)));};
  children.forEach(add);if(selected!==undefined)value.value=selected;return value;
};
const short=value=>String(value??'').slice(0,16);
const bytes=value=>Number(value??0).toLocaleString()+' bytes';
const terms=value=>String(value??'').replaceAll('_',' ').toLowerCase();
const details=(label,value)=>node('details',{},node('summary',{},label),node('pre',{},JSON.stringify(value,null,2)));
const field=(label,input,help)=>node('label',{class:'prescient-field'},node('span',{},label),input,help?node('small',{},help):null);
const id=()=>crypto.randomUUID();
const list=value=>Array.isArray(value)?value:[];
const jsonDownload=(value,name)=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const anchor=node('a',{href:url,download:name});document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const message=error=>{
  const code=error?.code;
  const known={
    PRESCIENT_APPROVED_PROFILE_REQUIRED:'Review and approve the selected access profile before connecting.',
    PRESCIENT_APPROVED_PROFILE_RESTART_REQUIRED:'The approved profile changed. Restart this operator to use it; retained scenes and deliveries remain available.',
    PRESCIENT_CONFIGURATION_REVISION_CHANGED:'Another operator action changed the saved configuration. Refresh, inspect the current version, and apply your retained draft.',
    PRESCIENT_RUNTIME_DEPENDENCIES_MISSING:'The configured Python environment is missing the original Prescient SDK dependencies. Use the supplied SDK runtime installation guide.',
    PRESCIENT_LOCAL_BINDING_REQUIRED:'Select a credential binding configured by the host operator.',
    PRESCIENT_API_KEY_UPDATE_REQUIRED:'Update the private API-key binding and reopen the operator. No key is stored in this view.',
    PRESCIENT_RECEIVER_PROFILE_REVIEW_REQUIRED:'The receiving folder has a different reviewed profile. Import its nonsecret profile with a local binding in a matching workspace.',
    PRESCIENT_DELIVERY_ROOT_NOT_APPROVED:'Choose a customer delivery folder inside one of the host-configured receiving roots.',
    PRESCIENT_PORTABLE_ASSETS_NOT_APPROVED:'The reviewed rights do not allow portable asset copies.',
    ROUTESCAN_RECORD_BUSY:'The same operation is already active. Its original saved outcome will remain in the operation history.'
  };
  return known[code]??(code?terms(code):error?.message??'The operator action could not finish.');
};
export async function mountPrescientView({root,api,context={},intentStore}={}){
  let disposed=false,loading=false,refreshAgain=false,busy=false,saved=null,selectedReview=null,draft=null,selectedProfile=null;
  let currentContext=context,intents=null,storageKey=null;
  let storage=intentStore;
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}

  const heading=node('div',{class:'prescient-heading'},node('div',{},node('h3',{},'Prescient customer access'),
    node('p',{class:'muted'},'Review the source connection, retain native scene and file selections, and reopen the same customer delivery.')));
  const notice=node('p',{class:'prescient-notice',role:'status','aria-live':'polite'});
  const actorInput=node('input',{type:'text',autocomplete:'name',placeholder:'Operator name'});
  const summary=node('section',{class:'panel prescient-summary','aria-label':'Prescient connection status'});
  const profiles=node('section',{class:'panel','aria-label':'Saved Prescient profiles'});
  const editor=node('section',{class:'panel','aria-label':'Prescient profile editor'});
  const reviewPanel=node('section',{class:'panel','aria-label':'Exact Prescient profile review'});
  const customer=node('section',{class:'panel','aria-label':'Portable customer delivery'});
  const history=node('section',{class:'panel','aria-label':'Prescient operation history'});
  const retainedActions=node('section',{class:'panel','aria-label':'Retained Prescient actions'});
  const bindingImport=node('section',{class:'panel','aria-label':'Receive a Prescient profile'});
  root.classList.add('prescient-view');
  root.replaceChildren(heading,notice,field('Operator',actorInput,'Recorded with each profile review, approval and delivery action.'),
    summary,retainedActions,node('div',{class:'prescient-columns'},node('div',{},profiles,editor,reviewPanel,bindingImport),node('div',{},customer,history)));
  const button=(label,run,props={})=>node('button',{type:'button',onclick:()=>void action(run),...props},label);
  function report(text,error=false){notice.textContent=text;notice.setAttribute('role',error?'alert':'status');}
  function reviewer(){const value=actorInput.value.trim();if(!value)throw Object.assign(new Error('Enter the operator name.'),{code:'PRESCIENT_REVIEWER_REQUIRED'});return value;}
  async function action(run){
    if(busy||disposed)return;busy=true;root.setAttribute('aria-busy','true');
    try{await run();if(!disposed)await refresh();}
    catch(error){if(!disposed)report(message(error),true);}
    finally{busy=false;if(!disposed)root.removeAttribute('aria-busy');}
  }
  const commandKinds={
    '/profiles':'PROFILE_SAVE','/profiles/import':'PROFILE_SAVE','/profiles/review':'PROFILE_REVIEW',
    '/profiles/approve':'PROFILE_APPROVE','/connect':'CONNECT','/session':'SESSION_REVIEW',
    '/deliveries/review':'DELIVERY_REVIEW','/deliveries/export':'PORTABLE_EXPORT','/deliveries/open':'PORTABLE_OPEN'
  };
  const canonical=value=>JSON.stringify((function sort(item){
    if(Array.isArray(item))return item.map(sort);
    if(item&&typeof item==='object')return Object.fromEntries(Object.keys(item).sort().map(key=>[key,sort(item[key])]));
    return item;
  })(value));
  const fingerprint=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
  const ownFields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
  const actionStatuses=['PREPARED','DISPATCHING','RESPONSE_UNKNOWN','REJECTED_BEFORE_ACTION','COMPLETE'];
  const actionFile=node('input',{type:'file',accept:'.json,application/json'});
  async function withIntentLock(run,workspaceId=saved?.workspaceId){
    const locks=globalThis.navigator?.locks;
    if(locks?.request)return locks.request('prescient:operator-intents:'+workspaceId,{mode:'exclusive'},run);
    if(intentStore!==undefined)return run(); // Injected stores own their serialization contract.
    throw new Error('Use a browser with local workspace locks to retain and coordinate the original action.');
  }
  function requestFields(path,input){
    const fields={
      '/profiles':['profile'],'/profiles/import':['profile','bindingId'],'/profiles/review':['profileSha256'],
      '/profiles/approve':['reviewId','reviewSha256'],'/connect':['refresh'],'/session':['refresh'],
      '/deliveries/review':['directory'],'/deliveries/export':['reviewId','reviewSha256'],
      '/deliveries/open':['directory','manifestSha256']
    };
    if(!Object.hasOwn(fields,path)||!ownFields(input,fields[path]))throw new Error('The saved action contains an undeclared request field.');
    for(const [key,value]of Object.entries(input)){
      if(key==='profile')continue;
      if(key==='refresh'?typeof value!=='boolean':typeof value!=='string')throw new Error('The saved action has an invalid request value.');
    }
    // Only the nonsecret profile contract can enter browser intent storage.
    if(path==='/profiles'||path==='/profiles/import'){
      const portable=path==='/profiles/import',value=portable?input.profile?.configuration:input.profile;
      const profileFields=['schema','name','endpoint','authMode','identityProvider','allowedOrigins','collections','allowedS3','maxAssetBytes','rights','refreshSkewSeconds',...(portable?[]:['bindingId'])];
      if(!ownFields(value,profileFields)||!ownFields(value.rights,['basis','reference','purpose','allowPortableAssets'])||
        !['name','endpoint','authMode',...(portable?[]:['bindingId'])].every(key=>typeof value[key]==='string')||
        ![undefined,null,'microsoft','google'].includes(value.identityProvider)||
        !Array.isArray(value.collections)||!value.collections.every(item=>typeof item==='string')||
        !Number.isSafeInteger(value.maxAssetBytes)||value.maxAssetBytes<=0||
        (value.refreshSkewSeconds!==undefined&&!Number.isSafeInteger(value.refreshSkewSeconds))||
        !['basis','reference','purpose'].every(key=>typeof value.rights[key]==='string')||
        typeof value.rights.allowPortableAssets!=='boolean'||
        !Array.isArray(value.allowedS3)||!value.allowedS3.every(row=>
          ownFields(row,['bucket','prefix','region','expectedBucketOwner','requesterPays'])&&
          ['bucket','prefix','region'].every(key=>typeof row[key]==='string')&&
          (row.expectedBucketOwner===undefined||typeof row.expectedBucketOwner==='string')&&typeof row.requesterPays==='boolean'))
        throw new Error('Use the declared nonsecret profile fields. Private credentials stay in the host binding.');
      const endpoint=new URL(value.endpoint);
      if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.protocol!=='https:')
        throw new Error('A saved profile needs its exact HTTPS endpoint without credentials or a query.');
      if(!Array.isArray(value.allowedOrigins)||value.allowedOrigins.some(origin=>
        typeof origin!=='string'||new URL(origin).protocol!=='https:'||new URL(origin).origin!==origin))
        throw new Error('Saved source origins must contain only their exact HTTPS origin.');
      if(portable&&(!ownFields(input.profile,['schema','configuration','sdk','sha256'])||
        !ownFields(input.profile.sdk,['package','version','repository','commit'])||
        !['package','version','repository','commit'].every(key=>typeof input.profile.sdk[key]==='string')||
        typeof input.profile.sha256!=='string'))
        throw new Error('Choose the original nonsecret portable profile.');
    }
  }
  function retainIntents(){
    if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')
      throw new Error('This browser must retain the exact operator request before dispatch.');
    const value=JSON.stringify(intents);
    if(value.length>2*1024*1024)throw new Error('The retained browser history is full. Download its exact record before changing browser storage.');
    storage.setItem(storageKey,value);
    if(storage.getItem(storageKey)!==value)throw new Error('The exact operator request was not retained. Retry its original action.');
  }
  async function decodeIntents(raw,{importing=false}={}){
    if(typeof raw!=='string'||raw.length>2*1024*1024)throw new Error('The action record exceeds its declared size.');
    const next=JSON.parse(raw);
    if(!ownFields(next,['schema','workspaceId','rows','ui'])||next.schema!=='starforge.prescient-browser-intents/v1'||
      next.workspaceId!==saved.workspaceId||!Array.isArray(next.rows)||!ownFields(next.ui,['actor'])||
      (next.ui.actor!==undefined&&typeof next.ui.actor!=='string'))
      throw new Error('The retained action history belongs to a different workspace or format.');
    const seen=new Set();
    for(const row of next.rows){
      if(!row||!Object.hasOwn(commandKinds,row.path)||!actionStatuses.includes(row.status)||
        !ownFields(row.body,['actor','operationId','expectedRevision',...Object.keys(row.input??{})])||
        typeof row.body.actor!=='string'||!row.body.actor.trim()||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.body.operationId)||
        !Number.isSafeInteger(row.body.expectedRevision)||row.body.expectedRevision<0||
        !Number.isSafeInteger(row.attempts)||row.attempts<0||typeof row.createdAt!=='string'||
        !Number.isFinite(Date.parse(row.createdAt))||seen.has(row.body.operationId))
        throw new Error('An original saved action is invalid. Keep the history for recovery.');
      requestFields(row.path,row.input);
      if(canonical(row.body)!==canonical({...row.input,actor:row.body.actor,operationId:row.body.operationId,expectedRevision:row.body.expectedRevision})||
        row.key!==await fingerprint({path:row.path,input:row.input,actor:row.body.actor})||
        row.bodySha256!==await fingerprint(row.body))
        throw new Error('An original saved action changed. Keep the exact history for recovery.');
      if(!importing&&row.status==='COMPLETE'&&(row.result===undefined||row.resultSha256!==await fingerprint(row.result)))
        throw new Error('The retained original response changed. Reopen its downloaded action record through the native handler.');
      seen.add(row.body.operationId);
    }
    return next;
  }
  async function loadIntents({reload=false}={}){
    if(!reload&&intents?.workspaceId===saved.workspaceId)return;
    if(!storage||typeof storage.getItem!=='function')throw new Error('Browser action storage is unavailable.');
    storageKey='prescient:operator-intents:v1:'+saved.workspaceId;
    const raw=storage.getItem(storageKey);
    intents=raw?await decodeIntents(raw):{schema:'starforge.prescient-browser-intents/v1',workspaceId:saved.workspaceId,rows:[],ui:{}};
    if(!actorInput.value&&typeof intents.ui.actor==='string')actorInput.value=intents.ui.actor;
  }
  function nativeOperation(operationId){
    const operations=saved.configuration.operations;
    return Object.hasOwn(operations,operationId)?operations[operationId]:null;
  }
  function reconcileIntents(){
    let changed=false;
    for(const row of intents.rows){
      const observed=nativeOperation(row.body.operationId);
      if(observed&&observed.kind!==commandKinds[row.path])throw new Error('The saved operation identity belongs to another native action.');
      if(!observed||observed.status!=='COMPLETE'){
        if(row.status==='COMPLETE'){row.status='RESPONSE_UNKNOWN';changed=true;}
      }
      const next=observed?{status:observed.status,inputSha256:observed.inputSha256,completedAt:observed.completedAt??null}:null;
      if(canonical(row.serverOutcome)!==canonical(next)){row.serverOutcome=next;changed=true;}
      // An observed completion still replays the exact body once to verify the
      // original engine's input fingerprint after a lost browser response.
    }
    if(changed)retainIntents();
  }
  async function prepareIntent(path,input,{fresh=false,actor=reviewer()}={}){
    requestFields(path,input);await loadIntents();
    const key=await fingerprint({path,input,actor});
    let row=fresh?null:intents.rows.filter(value=>value.key===key).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).at(-1);
    if(!row){
      const body={...structuredClone(input),actor,operationId:id(),expectedRevision:saved.configuration.revision};
      row={key,path,input:structuredClone(input),body,bodySha256:await fingerprint(body),status:'PREPARED',createdAt:new Date().toISOString(),attempts:0};
      intents.rows.push(row);
    }
    intents.ui.actor=actor;retainIntents();renderIntents();return row;
  }
  function useResult(row,result){
    if(row.path==='/profiles'||row.path==='/profiles/import')showProfile(result);
    if(row.path==='/profiles/review')selectedReview=result;
    if(row.path==='/deliveries/export'){incomingDirectory.value=result.directory;incomingHash.value=result.manifestSha256;}
  }
  async function dispatchIntent(row){
    if(row.status==='COMPLETE'){useResult(row,row.result);return structuredClone(row.result);}
    if(row.bodySha256!==await fingerprint(row.body))throw new Error('The exact admitted request changed.');
    row.status='DISPATCHING';row.attempts++;row.lastDispatchAt=new Date().toISOString();retainIntents();renderIntents();
    try{
      const result=await api('/api/prescient'+row.path,{method:'POST',body:structuredClone(row.body)});
      row.result=structuredClone(result);row.resultSha256=await fingerprint(result);
      row.status='COMPLETE';row.completedAt=new Date().toISOString();delete row.lastError;
      useResult(row,result);retainIntents();return result;
    }catch(error){
      if(row.status!=='COMPLETE')row.status='RESPONSE_UNKNOWN';
      row.lastError={code:error?.code??'BROWSER_RESPONSE_NOT_RETAINED',status:error?.status??null};
      try{
        saved=await api('/api/prescient/state');
        const observed=nativeOperation(row.body.operationId);
        const rejected=['PRESCIENT_CONFIGURATION_REVISION_CHANGED','PRESCIENT_APPROVED_PROFILE_REQUIRED',
          'PRESCIENT_APPROVED_PROFILE_RESTART_REQUIRED','PRESCIENT_DELIVERY_ROOT_NOT_APPROVED','PRESCIENT_EXACT_DELIVERY_REVIEW_REQUIRED'];
        if(!observed&&rejected.includes(error?.code)&&Number.isInteger(error?.status)&&error.status>=400&&error.status<500)row.status='REJECTED_BEFORE_ACTION';
        reconcileIntents();
      }catch(recoveryError){row.reconciliationError={code:recoveryError?.code??'STATE_READ_NOT_RETAINED'};}
      retainIntents();throw error;
    }finally{renderIntents();}
  }
  async function command(path,input){
    return withIntentLock(async()=>{await loadIntents({reload:true});return dispatchIntent(await prepareIntent(path,input));});
  }
  async function sendSaved(operationId){
    return withIntentLock(async()=>{
      await loadIntents({reload:true});
      const original=intents.rows.find(row=>row.body.operationId===operationId);
      if(!original)throw new Error('The original action is absent from this browser. Reopen its exact downloaded record.');
      return dispatchIntent(original);
    });
  }
  function restoreInput(row){
    actorInput.value=row.body.actor;
    if(row.path==='/profiles')showProfile(row.input.profile);
    if(row.path==='/profiles/import')showProfile({...row.input.profile.configuration,bindingId:row.input.bindingId});
    if(row.path==='/deliveries/review')deliveryDirectory.value=row.input.directory;
    if(row.path==='/deliveries/open'){incomingDirectory.value=row.input.directory;incomingHash.value=row.input.manifestSha256;}
    if(row.status==='COMPLETE')useResult(row,row.result);
    report('Restored the saved inputs. Retrying preserves the original action identity and revision.');
  }
  async function importIntents(){
    const file=actionFile.files?.[0];if(!file)throw new Error('Choose the retained action record for this original workspace.');
    if(file.size>2*1024*1024)throw new Error('The action record exceeds its declared size.');
    const imported=await decodeIntents(await file.text(),{importing:true});
    await withIntentLock(async()=>{
      await loadIntents({reload:true});
      const additions=[];
      for(const row of imported.rows){
        const existing=intents.rows.find(item=>item.body.operationId===row.body.operationId);
        if(existing){
          if(existing.bodySha256!==row.bodySha256||existing.path!==row.path)throw new Error('An imported action conflicts with the exact retained native request.');
          continue;
        }
        // Imported completion text is never authority. The operator explicitly
        // replays this original body through the same native record.
        additions.push({key:row.key,path:row.path,input:structuredClone(row.input),body:structuredClone(row.body),bodySha256:row.bodySha256,
          status:row.attempts===0&&row.status==='PREPARED'?'PREPARED':'RESPONSE_UNKNOWN',
          createdAt:row.createdAt,attempts:row.attempts,importedAt:new Date().toISOString()});
      }
      intents.rows.push(...additions);retainIntents();reconcileIntents();
      if(!actorInput.value&&imported.ui.actor)actorInput.value=imported.ui.actor;
    });
    report('Reopened the exact action record in its original workspace. Review and retry an original action to reconcile its result.');
  }
  function renderIntents(){
    retainedActions.replaceChildren(node('h4',{},'Retained browser actions'),
      node('p',{class:'muted'},'Requests are saved in this browser before dispatch. Retry keeps the exact actor, body, revision and action identity; a deliberate new action is separate.'));
    const rows=[...(intents?.rows??[])].reverse(),recent=new Set(rows.filter(row=>row.status==='COMPLETE').slice(0,12));
    for(const row of rows.filter(row=>row.status!=='COMPLETE'||recent.has(row))){
      const status=row.status==='RESPONSE_UNKNOWN'&&row.serverOutcome?.status==='COMPLETE'?'Native completion found; verify original response':terms(row.status);
      const canNew=row.status==='COMPLETE'||row.status==='REJECTED_BEFORE_ACTION';
      retainedActions.append(node('article',{class:'prescient-record'},node('strong',{},terms(commandKinds[row.path])+' · '+status),
        node('p',{class:'muted'},row.body.operationId+' · '+row.body.actor),
        details('Exact saved request and outcome',row),
        node('div',{class:'prescient-actions'},
          button(row.status==='PREPARED'?'Send saved action':row.status==='COMPLETE'?'Read original result':'Retry original action',async()=>{
            await sendSaved(row.body.operationId);report('The original saved action is reconciled.');
          }),
          button('Restore saved inputs',async()=>restoreInput(row)),
          button('Prepare new action',async()=>{
            await withIntentLock(async()=>{
              await loadIntents({reload:true});
              const current=intents.rows.find(item=>item.body.operationId===row.body.operationId);
              if(!current||!['COMPLETE','REJECTED_BEFORE_ACTION'].includes(current.status))throw new Error('Reconcile the original action before preparing another with the same inputs.');
              await prepareIntent(current.path,current.input,{fresh:true,actor:current.body.actor});
            });
            report('A new action is retained for review. Send saved action starts it.');
          },{disabled:!canNew}))));
    }
    if(!intents?.rows.length)retainedActions.append(node('p',{},'No browser action has been dispatched from this workspace.'));
    if(intents?.rows.length)retainedActions.append(button('Download retained actions',async()=>{
      await withIntentLock(async()=>{await loadIntents({reload:true});jsonDownload(intents,'prescient-browser-actions.json');});
    }));
    retainedActions.append(field('Original workspace action record',actionFile,'Reopen this record after the local service address changes. It cannot select a different receiving workspace.'),
      button('Reopen saved action record',importIntents));
  }

  function showProfile(value){
    draft=structuredClone(value.profile??value);selectedProfile=value.sha256??null;renderEditor();
  }
  function input(name,type='text'){
    return node('input',{type,value:draft[name]??'',oninput:event=>{draft[name]=type==='number'?Number(event.target.value):event.target.value;}});
  }
  function select(name,choices){
    return node('select',{value:draft[name]??'',onchange:event=>{draft[name]=event.target.value;
      if(name==='authMode'){draft.identityProvider=draft.authMode==='oauth'?'microsoft':null;renderEditor();}}},
      choices.map(([value,label])=>node('option',{value},label)));
  }
  function renderEditor(){
    if(!draft){editor.replaceChildren(node('h4',{},'Profile editor'),node('p',{},'Open a saved profile to create a reviewed revision.'));return;}
    const originInput=node('textarea',{rows:3,value:list(draft.allowedOrigins).join('\n'),oninput:event=>{draft.allowedOrigins=event.target.value.split('\n').map(v=>v.trim()).filter(Boolean);}});
    const collectionsInput=node('textarea',{rows:3,value:list(draft.collections).join('\n'),oninput:event=>{draft.collections=event.target.value.split('\n').map(v=>v.trim()).filter(Boolean);}});
    const rights=draft.rights;
    const form=node('div',{class:'prescient-form'},
      field('Profile name',input('name')),
      field('Prescient endpoint',input('endpoint','url'),'Use the original SDK endpoint exactly, including its trailing slash.'),
      field('Authentication',select('authMode',[['api-key','API key'],['oauth','Microsoft or Google identity']])),
      draft.authMode==='oauth'?field('Identity provider',select('identityProvider',[['microsoft','Microsoft'],['google','Google']])):null,
      field('Private host binding',select('bindingId',saved.bindingChoices.map(row=>[row.id,row.label])),'This selects the host-owned credential file; no credential is entered here.'),
      field('Exact permitted source origins',originInput,'One HTTPS origin per line. Credentials remain confined to these origins.'),
      field('Selected collection IDs',collectionsInput,'One native collection ID per line.'),
      field('Maximum bytes per asset',input('maxAssetBytes','number')),
      field('Session refresh margin, seconds',input('refreshSkewSeconds','number')));
    const scopes=node('div',{class:'prescient-scopes'});
    const drawScopes=()=>{
      scopes.replaceChildren(node('h5',{},'Approved S3 scopes'));
      draft.allowedS3.forEach((scope,index)=>{
        const row=node('fieldset',{},node('legend',{},'S3 scope '+(index+1)));
        for(const [key,label]of [['bucket','Bucket'],['prefix','Key prefix'],['region','Region'],['expectedBucketOwner','Expected bucket owner, optional']])
          row.append(field(label,node('input',{value:scope[key]??'',oninput:event=>{
            if(key==='expectedBucketOwner'&&!event.target.value)delete scope[key];else scope[key]=event.target.value;
          }})));
        row.append(field('Requester pays approved',node('input',{type:'checkbox',checked:scope.requesterPays,onchange:event=>{scope.requesterPays=event.target.checked;}})),
          button('Remove scope',async()=>{draft.allowedS3.splice(index,1);drawScopes();}));
        scopes.append(row);
      });
      scopes.append(button('Add S3 scope',async()=>{draft.allowedS3.push({bucket:'',prefix:'',region:'',requesterPays:false});drawScopes();}));
    };drawScopes();
    const rightsBox=node('fieldset',{},node('legend',{},'Customer rights and permitted use'),
      field('Rights basis',node('select',{value:rights.basis,onchange:event=>{rights.basis=event.target.value;}},
        node('option',{value:'customer-licensed'},'Customer licensed'),node('option',{value:'public-data'},'Public data'))),
      field('Rights / agreement reference',node('textarea',{rows:2,value:rights.reference,oninput:event=>{rights.reference=event.target.value;}})),
      field('Permitted purpose',node('textarea',{rows:2,value:rights.purpose,oninput:event=>{rights.purpose=event.target.value;}})),
      field('Portable asset copies permitted',node('input',{type:'checkbox',checked:rights.allowPortableAssets,onchange:event=>{rights.allowPortableAssets=event.target.checked;}})));
    editor.replaceChildren(node('h4',{},'Edit a profile revision'),form,scopes,rightsBox,
      node('div',{class:'prescient-actions'},button('Save profile for review',async()=>{
        const result=await command('/profiles',{profile:draft});selectedProfile=result.sha256;report('Saved profile '+short(result.sha256)+'. Review it before approval.');
      }),button('Reload selected profile',async()=>showProfile(saved.configuration.profiles.find(row=>row.sha256===selectedProfile)??saved.selectedProfile))));
  }
  function renderSummary(){
    const connection=saved.connection;
    summary.replaceChildren(node('h4',{},connection.active?'Original SDK connected':'Source connection is not active'),
      node('dl',{},node('dt',{},'Catalog'),node('dd',{},saved.selectedProfile.endpoint),
        node('dt',{},'Authentication'),node('dd',{},saved.selectedProfile.authMode==='api-key'?'API key':saved.selectedProfile.identityProvider),
        node('dt',{},'Access profile'),node('dd',{},short(saved.selectedProfileSha256)),
        node('dt',{},'Approval'),node('dd',{},connection.approved?'Selected profile approved':connection.restartRequired?'New profile approved — restart required':'Review required'),
        node('dt',{},'Original workspace'),node('dd',{},saved.workspaceId)),
      connection.restartRequired?node('p',{},'Restart the local operator to activate the newly approved profile. Original scenes, files and operations remain in this workspace.'):null,
      connection.session?node('p',{},'File session generation '+connection.session.generation+'; expires '+connection.session.expiresAt):null,
      node('div',{class:'prescient-actions'},
        button('Connect original SDK',async()=>{await command('/connect',{});report('The selected original SDK connection is ready.');},{disabled:!connection.approved}),
        button('Inspect file session',async()=>{await command('/session',{refresh:false});report('Read the original SDK file session.');},{disabled:!connection.approved}),
        button('Refresh file session',async()=>{await command('/session',{refresh:true});report('The original SDK file session was refreshed.');},{disabled:!connection.approved})),
      node('p',{class:'muted'},'Catalog search and scene/asset operations use the existing workspace tabs. New source dispatch uses the approved profile; previously received data remains retained.'),
      connection.metadata?details('Original SDK source identity',connection.metadata):null);
  }
  function renderProfiles(){
    profiles.replaceChildren(node('h4',{},'Saved access profiles'));
    for(const row of [...saved.configuration.profiles].reverse()){
      const approved=row.sha256===saved.configuration.approvedProfileSha256;
      profiles.append(node('article',{class:'prescient-record'},node('strong',{},row.profile.name),
        node('p',{},row.profile.authMode+' · '+row.profile.collections.join(', ')),
        node('p',{class:'muted'},short(row.sha256)+(approved?' · approved':'')),
        node('div',{class:'prescient-actions'},
          button('Edit revision',async()=>showProfile(row)),
          button('Review exact profile',async()=>{selectedReview=await command('/profiles/review',{profileSha256:row.sha256});report('Review the exact source scope and rights below.');}),
          button('Save portable profile',async()=>{
            // Export the canonical profile through the saved review representation.
            const result=await api('/api/prescient/profiles/'+encodeURIComponent(row.sha256)+'/export');
            jsonDownload(result,'prescient-profile.json');
          }))));
    }
    if(!selectedReview)selectedReview=[...saved.configuration.reviews].reverse().find(row=>row.profileSha256===saved.selectedProfileSha256)??null;
    renderReview();
  }
  function renderReview(){
    if(!selectedReview){reviewPanel.replaceChildren(node('h4',{},'Exact profile review'),node('p',{},'Choose Review exact profile for a saved revision.'));return;}
    const row=selectedReview,profile=row.profile;
    reviewPanel.replaceChildren(node('h4',{},'Review '+short(row.sha256)),
      node('dl',{},node('dt',{},'Endpoint'),node('dd',{},profile.endpoint),
        node('dt',{},'Origin scope'),node('dd',{},profile.allowedOrigins.join(', ')),
        node('dt',{},'Collections'),node('dd',{},profile.collections.join(', ')),
        node('dt',{},'File limit'),node('dd',{},bytes(profile.maxAssetBytes)),
        node('dt',{},'Rights'),node('dd',{},profile.rights.reference),
        node('dt',{},'Portable files'),node('dd',{},profile.rights.allowPortableAssets?'Permitted by this review':'Not permitted')),
      profile.allowedS3.length?details('Exact S3 scopes',profile.allowedS3):node('p',{},'No SDK S3 scopes selected.'),
      node('p',{class:'muted'},'Reviewed by '+row.actor+' · '+row.createdAt),
      button('Approve reviewed profile',async()=>{
        await command('/profiles/approve',{reviewId:row.id,reviewSha256:row.sha256});
        report('Approved the exact reviewed profile. The connection status shows whether a restart is required.');
      }));
  }
  const importFile=node('input',{type:'file',accept:'.json,application/json'});
  const importBinding=node('select');
  bindingImport.append(node('h4',{},'Receive a nonsecret profile'),field('Portable profile JSON',importFile),
    field('Receiver-local private binding',importBinding),
    button('Import for review',async()=>{
      const file=importFile.files?.[0];if(!file||file.size>1024*1024)throw new Error('Choose a profile JSON file no larger than1MiB.');
      const portable=JSON.parse(await file.text());const row=await command('/profiles/import',{profile:portable,bindingId:importBinding.value});
      showProfile(row);report('Imported the source profile with your local binding. Review and approve it before connecting.');
    }));
  const deliveryDirectory=node('input',{type:'text',placeholder:'Absolute original customer delivery folder'});
  const incomingDirectory=node('input',{type:'text',placeholder:'Absolute copied receiving folder'});
  const incomingHash=node('input',{type:'text',placeholder:'Exact receiving manifest SHA256'});
  const deliveryReviews=node('div'),deliveries=node('div');
  customer.append(node('h4',{},'Portable customer handover'),
    node('p',{},'Use a completed original STAC customer delivery. The export retains its original native bindings, files, source edition and offline GIS view.'),
    field('Original customer delivery folder',deliveryDirectory),
    button('Review original customer delivery',async()=>{
      await command('/deliveries/review',{directory:deliveryDirectory.value.trim()});report('The original customer delivery and current permitted scope were read and retained for review.');
    }),deliveryReviews,node('hr'),node('h5',{},'Independent receiving'),
    field('Copied receiving folder',incomingDirectory),field('Expected receiving manifest hash',incomingHash),
    button('Verify and open received delivery',async()=>{
      await command('/deliveries/open',{directory:incomingDirectory.value.trim(),manifestSha256:incomingHash.value.trim()});
      report('The original customer delivery, portable GIS files and reviewed profile reopened offline.');
    }),deliveries);
  function renderReceiving(){
    deliveryReviews.replaceChildren();
    for(const row of [...list(saved.configuration.deliveryReviews)].reverse().slice(0,8)){
      deliveryReviews.append(node('article',{class:'prescient-record'},node('h5',{},'Delivery review '+short(row.sha256)),
        node('p',{},row.summary.scenes+' scenes · '+row.summary.assets+' selected assets · '+bytes(row.summary.assetBytes)),
        node('p',{},row.summary.collections.join(', ')),
        node('p',{},'Original catalog: '+row.source.catalogEndpoint),node('p',{class:'muted'},row.sourceDirectory),
        details('Original selection and source binding',row.source),
        button('Approve and export this delivery',async()=>{
          const result=await command('/deliveries/export',{reviewId:row.id,reviewSha256:row.sha256});
          incomingDirectory.value=result.directory;incomingHash.value=result.manifestSha256;
          report('The complete portable delivery is retained at '+result.directory+'. Copy that folder for independent receiving.');
        },{disabled:row.profileSha256!==saved.selectedProfileSha256||!saved.connection.approved})));
    }
    deliveries.replaceChildren(node('h5',{},'Retained deliveries'));
    for(const row of [...saved.configuration.deliveries].reverse()){
      deliveries.append(node('article',{class:'prescient-record'},node('strong',{},terms(row.kind)),
        node('p',{},row.summary.scenes+' scenes · '+row.summary.assets+' assets'),node('p',{class:'prescient-path'},row.directory),
        node('p',{class:'muted'},'Edition '+row.source.editionId),
        node('div',{class:'prescient-actions'},
          button('Select for receiving',async()=>{incomingDirectory.value=row.directory;incomingHash.value=row.manifestSha256;}),
          button('Download receiving record',async()=>jsonDownload(row,'prescient-receiving-record.json'))),
        details('Receiving identities',row)));
    }
    if(!saved.configuration.deliveries.length)deliveries.append(node('p',{class:'muted'},'No portable export or receiving record yet.'));
  }
  async function continueOriginal(operationId,row){
    const browserIntent=intents?.rows.find(item=>item.body.operationId===operationId);
    if(browserIntent)return sendSaved(operationId);
    const routes={
      CONNECT:['/connect',['actor','refresh']],
      SESSION_REVIEW:['/session',['actor','refresh']],
      DELIVERY_REVIEW:['/deliveries/review',['directory','actor']],
      PORTABLE_EXPORT:['/deliveries/export',['reviewId','reviewSha256','actor']],
      PORTABLE_OPEN:['/deliveries/open',['directory','manifestSha256','actor']]
    };
    const selected=Object.hasOwn(routes,row.kind)?routes[row.kind]:null;if(!selected||!row.input)throw new Error('This saved action has no resumable original request.');
    const body={operationId,expectedRevision:saved.configuration.revision};
    for(const key of selected[1])if(Object.hasOwn(row.input,key))body[key]=row.input[key];
    const result=await api('/api/prescient'+selected[0],{method:'POST',body});
    if(row.kind==='PORTABLE_EXPORT'){incomingDirectory.value=result.directory;incomingHash.value=result.manifestSha256;}
    report('Continued the original saved action with its retained identity and inputs.');
    return result;
  }
  function renderHistory(){
    history.replaceChildren(node('h4',{},'Saved operation outcomes'));
    const table=node('table',{},node('thead',{},node('tr',{},['Operation','Outcome','Time'].map(value=>node('th',{scope:'col'},value)))));
    const body=node('tbody');
    for(const [operationId,row]of Object.entries(saved.configuration.operations).slice(-25).reverse()){
      const resumable=['CONNECT','SESSION_REVIEW','DELIVERY_REVIEW','PORTABLE_EXPORT','PORTABLE_OPEN'].includes(row.kind)&&row.input&&['RUNNING','INTERRUPTED'].includes(row.status);
      body.append(node('tr',{},node('td',{},terms(row.kind),node('small',{},short(operationId)),details('Original action',{operationId,...row})),node('td',{},terms(row.status),row.error?node('small',{},message(row.error)):null,
        resumable?button('Continue original action',async()=>continueOriginal(operationId,row)):null),
        node('td',{},row.completedAt??row.updatedAt??row.startedAt)));
    }
    table.append(body);history.append(table);
    for(const row of saved.receivingProgress??[])history.append(node('p',{class:'muted'},row.phase??'S3 receiving',' · ',
      bytes(row.completedBytes??row.receivedBytes),' / ',bytes(row.totalBytes)));
  }
  async function refresh(){
    if(disposed)return;if(loading){refreshAgain=true;return;}loading=true;
    try{
      const initial=saved?null:await api('/api/prescient/state');if(disposed)return;
      await withIntentLock(async()=>{
        const value=initial??await api('/api/prescient/state');if(disposed)return;
        saved=value;await loadIntents({reload:true});reconcileIntents();
      },(initial??saved).workspaceId);
      if(disposed)return;
      renderSummary();renderProfiles();renderReceiving();renderHistory();renderIntents();
      const previous=importBinding.value;importBinding.replaceChildren(saved.bindingChoices.map(row=>node('option',{value:row.id},row.label)));
      if(previous&&saved.bindingChoices.some(row=>row.id===previous))importBinding.value=previous;
      if(!draft)showProfile(saved.configuration.profiles.find(row=>row.sha256===saved.selectedProfileSha256)??saved.selectedProfile);
    }catch(error){if(!disposed)report(message(error),true);}
    finally{loading=false;if(refreshAgain&&!disposed){refreshAgain=false;void refresh();}}
  }
  await refresh();
  return Object.freeze({
    update(context){currentContext=context;return refresh();},
    dispose(){disposed=true;root.replaceChildren();}
  });
}

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
export async function mountPrescientView({root,api,context={}}={}){
  let disposed=false,loading=false,refreshAgain=false,busy=false,saved=null,selectedReview=null,draft=null,selectedProfile=null;
  let currentContext=context;
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
  const bindingImport=node('section',{class:'panel','aria-label':'Receive a Prescient profile'});
  root.classList.add('prescient-view');
  root.replaceChildren(heading,notice,field('Operator',actorInput,'Recorded with each profile review, approval and delivery action.'),
    summary,node('div',{class:'prescient-columns'},node('div',{},profiles,editor,reviewPanel,bindingImport),node('div',{},customer,history)));
  const button=(label,run,props={})=>node('button',{type:'button',onclick:()=>void action(run),...props},label);
  function report(text,error=false){notice.textContent=text;notice.setAttribute('role',error?'alert':'status');}
  function reviewer(){const value=actorInput.value.trim();if(!value)throw Object.assign(new Error('Enter the operator name.'),{code:'PRESCIENT_REVIEWER_REQUIRED'});return value;}
  async function action(run){
    if(busy||disposed)return;busy=true;root.setAttribute('aria-busy','true');
    try{await run();if(!disposed)await refresh();}
    catch(error){if(!disposed)report(message(error),true);}
    finally{busy=false;if(!disposed)root.removeAttribute('aria-busy');}
  }
  async function command(path,input){
    return api('/api/prescient'+path,{method:'POST',body:{...input,actor:reviewer(),
      operationId:id(),expectedRevision:saved.configuration.revision}});
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
  function renderHistory(){
    history.replaceChildren(node('h4',{},'Saved operation outcomes'));
    const table=node('table',{},node('thead',{},node('tr',{},['Operation','Outcome','Time'].map(value=>node('th',{scope:'col'},value)))));
    const body=node('tbody');
    for(const [operationId,row]of Object.entries(saved.configuration.operations).slice(-25).reverse())
      body.append(node('tr',{},node('td',{},terms(row.kind),node('small',{},short(operationId))),node('td',{},terms(row.status),row.error?node('small',{},message(row.error)):null),
        node('td',{},row.completedAt??row.updatedAt??row.startedAt)));
    table.append(body);history.append(table);
    for(const row of saved.receivingProgress??[])history.append(node('p',{class:'muted'},row.phase??'S3 receiving',' · ',
      bytes(row.completedBytes??row.receivedBytes),' / ',bytes(row.totalBytes)));
  }
  async function refresh(){
    if(disposed)return;if(loading){refreshAgain=true;return;}loading=true;
    try{
      const value=await api('/api/prescient/state');if(disposed)return;saved=value;
      renderSummary();renderProfiles();renderReceiving();renderHistory();
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

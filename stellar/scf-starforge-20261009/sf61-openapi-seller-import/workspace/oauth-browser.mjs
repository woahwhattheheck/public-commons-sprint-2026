// MIT. Authorization and grant review inside the original API merchant workspace.
const displayDate=value=>value?new Date(value).toLocaleString():'Not supplied';
const grantKey=value=>value?[value.profileSha256,value.grant?.id,value.grant?.state].join(':'):'';
const copy=value=>JSON.parse(JSON.stringify(value));
const stored=(key,fallback)=>{try{return JSON.parse(sessionStorage.getItem(key))??fallback;}catch{return fallback;}};
const remember=(key,value)=>{try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}};
const chosenFields=value=>({oauthAlias:value.oauthAlias,oauthProfile:copy(value.oauthProfile),oauthConnection:copy(value.oauthConnection)});

export function createOAuthConnections({container,make,field,selectField,api,act,notice,onChanged}) {
  const prefix='stellar.api-merchant.oauth.public.v1';
  const flows=stored(prefix+'.flows',{}),authorizationUrls=new Map();
  let pending=stored(prefix+'.pending',null),values=[],current=null,callbackOrigin=location.origin;
  let hostBusy=false,loading=0,readVersion=0,refreshVersion=0,currentReadError='';
  const intrinsicDisabled=new WeakMap();
  const selection=selectField('Configured provider connection',[],'');
  selection.input.id='oauth-connection-alias';
  const refreshButton=make('button','Refresh connections');refreshButton.type='button';refreshButton.id='oauth-refresh';
  const toolbar=make('div',undefined,'inline'),detail=make('div'),recovery=make('div');
  toolbar.append(selection.container,refreshButton);
  container.append(make('h2','Provider authorization connections'),
    make('p','Authorize a configured API provider, review its returned scopes, and keep the grant on this host. Route controls select the exact reviewed grant for a compiled package.','hint'),toolbar,recovery,detail);
  const button=(label,action,disabled=false)=>{
    const value=make('button',label);value.type='button';intrinsicDisabled.set(value,disabled);value.disabled=disabled||hostBusy||loading>0;
    value.addEventListener('click',()=>act(action));return value;
  };
  const setPending=value=>{pending=value;remember(prefix+'.pending',value);renderRecovery();};
  function flowId(alias){return typeof flows[alias]?.flowId==='string'?flows[alias].flowId:undefined;}
  function rememberFlow(alias,result) {
    if(result?.flowId){flows[alias]={flowId:result.flowId,profileSha256:result.profileSha256};remember(prefix+'.flows',flows);}
    if(result?.authorizationUrl)authorizationUrls.set(alias,result.authorizationUrl);
  }
  function available(value=hostBusy) {
    hostBusy=value;
    for(const control of container.querySelectorAll('input,select,textarea,button'))
      control.disabled=hostBusy||loading>0||(control===selection.input?!values.length:Boolean(intrinsicDisabled.get(control)));
  }
  async function readCurrent() {
    const alias=selection.input.value,version=++readVersion;
    loading++;currentReadError='';if(current?.alias!==alias){current=null;render();}available();
    try {
      const received=alias?await api('oauth/connection?alias='+encodeURIComponent(alias)+(flowId(alias)?'&flowId='+encodeURIComponent(flowId(alias)):'')):null;
      if(version!==readVersion||selection.input.value!==alias)return current;
      current=received;
      if(current){const index=values.findIndex(value=>value.alias===alias);if(index>=0)values[index]=current;}
      render();return current;
    } catch(error) {
      if(version===readVersion&&selection.input.value===alias){current=null;currentReadError='The selected connection could not be read. Refresh connections to retry.';render();}
      throw error;
    } finally {loading--;available();}
  }
  async function refresh() {
    const version=++refreshVersion,before=new Map(values.map(value=>[value.alias,grantKey(value)])),selected=selection.input.value;
    loading++;available();
    try {
      const result=await api('oauth/connections');if(version!==refreshVersion)return values;
      values=result.connections;callbackOrigin=result.callbackOrigin;
      selection.input.replaceChildren();
      for(const value of values){const option=make('option',value.profile.label+' · '+value.alias);option.value=value.alias;selection.input.append(option);}
      if(values.some(value=>value.alias===selected))selection.input.value=selected;
      await readCurrent();if(version!==refreshVersion)return values;
      const after=new Map(values.map(value=>[value.alias,grantKey(value)]));
      const changed=[...before.keys()].filter(alias=>!after.has(alias)||before.get(alias)!==after.get(alias));
      onChanged?.(values,changed);return values;
    } finally {loading--;available();}
  }
  async function dispatch(body) {
    // Only public request metadata is retained. Codes, state, verifier and
    // token values never enter this command body or browser storage.
    setPending(copy(body));
    try {
      const result=await api('oauth/command',body);
      rememberFlow(body.alias,result);
      setPending(null);
      await refresh();
      notice(body.action==='approve'?'Authorization grant reviewed and kept privately. Select it in the route controls before saving a new package.':
        body.action==='begin'?'Authorization prepared. Continue at the provider in a separate tab, then return here to review the result.':
        body.action==='disconnect'?'Local authorization disconnected. Inspect the remote revocation status shown here.':
        'Connection operation completed. Its actual status is shown below.');
      return result;
    } catch(error) {
      // A known validation/conflict result did not silently complete a second
      // mutation. Transport failure and unknown native outcomes retain identity.
      if(error.status&&error.status<500&&error.status!==401&&error.status!==403&&!error.outcomeUnknown)setPending(null);
      render();
      throw error;
    }
  }
  async function command(action,args={}) {
    if(pending)throw new Error('Resolve the retained connection request before creating another mutation.');
    if(loading||!current||current.alias!==selection.input.value)throw new Error('Wait for the selected provider connection to finish loading before changing its authorization.');
    const durable=action!=='discard';
    const body={alias:current.alias,action,args:{...args,...(durable?{expectedRevision:current.revision,requestId:crypto.randomUUID()}:{} )}};
    return dispatch(body);
  }
  function renderRecovery() {
    recovery.replaceChildren();
    if(!pending)return;
    const box=make('div',undefined,'oauth-warning');
    box.append(make('h3','Retained connection request'),
      make('p',pending.action+' · '+pending.alias+' · '+(pending.args?.requestId??'authorization flow'),'wrap'),
      make('p','The response was not confirmed. Refresh to inspect current status, then retry this same request. A retry preserves its original operation identity.','hint'),
      button('Retry exact retained request',()=>dispatch(copy(pending))));
    recovery.append(box);
  }
  function definition(label,value) {
    const row=make('div',undefined,'oauth-definition');row.append(make('strong',label),make('span',value??'—','wrap'));return row;
  }
  function render() {
    detail.replaceChildren();renderRecovery();
    if(!current) {
      detail.append(make('p',currentReadError||(values.length?'Reading the selected provider connection…':'No provider connections are configured for this host. Use the existing launcher’s --oauth-connections FILE option with approved alias and environment references. The setup guide describes registration and private storage.'),currentReadError?'oauth-warning':'hint'));
      available();return;
    }
    const profile=current.profile,grant=current.grant,flow=current.flow,blocked=Boolean(pending);
    const summary=make('div',undefined,'oauth-summary');
    summary.append(make('h3',profile.label),make('p','Grant state: '+grant.state+' · revision '+current.revision,'small'));
    const facts=make('div',undefined,'oauth-definitions');
    for(const [label,value] of [
      ['Declared source scheme',profile.source.scheme],['Original source SHA256',profile.source.sha256],
      ['Registered public client ID',profile.clientId],['Client authentication',profile.authMethod+' · '+(profile.pkceMethod==='none'?'Intuit confidential client flow':'PKCE S256')],
      ['Authorization endpoint',profile.authorizationEndpoint],['Token endpoint',profile.tokenEndpoint],
      ['Register this callback',(profile.callbackOrigin??callbackOrigin)+current.callbackPath],['Approved resource origins',profile.resourceOrigins.join(', ')],
      ['Profile scopes',profile.scopes.join(', ')||'No explicit scopes'],['Private directory environment reference',current.directoryEnv],
      ['Current grant',grant.id??'No reviewed grant'],['Actual granted scopes',grant.scopes.join(', ')||'None supplied'],
      ['Access expiry',displayDate(grant.expiresAt)],['Refresh support',grant.hasRefreshToken?'Provider returned a refresh token':'No refresh token retained'],
      ['Remote revocation',grant.remoteRevocation??'not_requested'],
      ['Grant review',grant.review?grant.review.actor+' · '+grant.review.reference+' · '+displayDate(grant.review.at):'Not reviewed']
    ])facts.append(definition(label,value));
    if(profile.provider?.kind==='intuit-quickbooks') {
      facts.append(definition('QuickBooks environment',profile.provider.environment),
        definition('Reviewed QuickBooks company ID',grant.realmId??'Authorize and review a company'));
      if(grant.refreshHardExpiresAt)facts.append(definition('Refresh authorization ends',displayDate(grant.refreshHardExpiresAt)));
    }
    if(profile.clientSecretEnv)facts.append(definition('Client secret environment reference',profile.clientSecretEnv));
    if(grant.refreshExpiresAt)facts.append(definition('Refresh expiry',displayDate(grant.refreshExpiresAt)));
    if(grant.retryAfter)facts.append(definition('Provider retry boundary',String(grant.retryAfter)));
    if(grant.lastError)summary.append(make('p',typeof grant.lastError==='string'?grant.lastError:grant.lastError.message??grant.lastError.code,'oauth-warning'));
    const technical=make('details');technical.append(make('summary','Connection, source and grant details'),facts);
    summary.append(technical);
    const controls=make('div',undefined,'inline');
    const activeFlow=flow&&['awaiting_authorization','exchanging','review_grant','approving','committing'].includes(flow.phase);
    const begin=button(grant.id?'Authorize a replacement grant':'Begin provider authorization',()=>command('begin'),blocked||Boolean(activeFlow));
    begin.id='oauth-begin';
    controls.append(begin,
      button('Refresh authorization',async()=>{await refresh();notice('Connection status refreshed from the same private host state.');}),
      button('Renew current grant',()=>command('refresh',{expectedGrantId:grant.id}),blocked||!grant.id||!grant.hasRefreshToken||grant.state!=='connected'));
    summary.append(controls);
    if(grant.id) {
      const revoke=make('input');revoke.type='checkbox';intrinsicDisabled.set(revoke,blocked||!profile.revocationEndpoint);revoke.disabled=blocked||!profile.revocationEndpoint;
      const label=make('label',undefined,'check');label.append(revoke,make('span','Also request remote revocation at the configured provider endpoint'));
      const disconnect=button('Disconnect local grant',()=>command('disconnect',{expectedGrantId:grant.id,revoke:revoke.checked}),blocked);
      disconnect.id='oauth-disconnect';
      summary.append(label,disconnect,make('p','Disconnect stops local use first. A remote failure remains visible for an explicit retry; it does not restore local authorization.','hint'));
    }
    if(Array.isArray(current.revocations)&&current.revocations.length) {
      const section=make('div',undefined,'oauth-flow');section.append(make('h3','Retained remote cleanup'));
      const table=make('table'),head=make('tr'),thead=make('thead'),tbody=make('tbody');
      for(const text of ['Original grant','Remote state','Last attempt','Action'])head.append(make('th',text));
      thead.append(head);table.append(thead,tbody);
      for(const cleanup of current.revocations) {
        const row=make('tr');row.append(make('td',cleanup.grantId,'wrap'),make('td',cleanup.state),make('td',displayDate(cleanup.lastAttemptAt??cleanup.requestedAt)));
        const cell=make('td'),retry=button('Retry this grant’s revocation',()=>command('revoke',{expectedRevocationGrantId:cleanup.grantId}),
          blocked||grant.state!=='disconnected'||cleanup.state==='confirmed');
        retry.setAttribute('aria-label','Retry revocation for '+cleanup.grantId);cell.append(retry);row.append(cell);tbody.append(row);
        if(cleanup.lastError){const errorRow=make('tr'),error=make('td',typeof cleanup.lastError==='string'?cleanup.lastError:cleanup.lastError.code,'hint');error.colSpan=4;errorRow.append(error);tbody.append(errorRow);}
      }
      const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Retained remote revocations');wrap.append(table);
      section.append(wrap,make('p','Each cleanup retains its original grant identity across reconnect. Disconnect current local use before retrying remote cleanup, because a provider may revoke a token family.','hint'));summary.append(section);
    }
    if(flow) {
      const flowBox=make('div',undefined,'oauth-flow');
      flowBox.append(make('h3','Current authorization flow'),make('p',flow.phase+' · expires '+displayDate(flow.expiresAt),'small'));
      if(flow.lastError)flowBox.append(make('p',flow.lastError.message??flow.lastError.code,'oauth-warning'));
      const authUrl=authorizationUrls.get(current.alias);
      if(flow.phase==='awaiting_authorization') {
        if(authUrl) {
          const link=make('a','Continue at provider');link.href=authUrl;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.id='oauth-authorize-link';
          flowBox.append(link);
        }
        flowBox.append(make('p',authUrl?'Complete the provider’s normal authorization in that tab. Then return here and refresh authorization.':
          'The retained authorization window may still be open. Return from it and refresh, or discard this expired/unused attempt before beginning another.','hint'));
      }
      if(flow.phase==='review_grant') {
        flowBox.append(definition('Returned scopes',(flow.scopes??[]).join(', ')||'No explicit scopes'),
          definition('Access expiry',displayDate(flow.tokenExpiresAt)),definition('Refresh token returned',flow.refreshable?'Yes':'No'),
          make('p','Review the actual provider consent and intended use. These OAuth scopes do not establish an independently verified personal account identity.','hint'));
        if(profile.provider?.kind==='intuit-quickbooks') {
          flowBox.append(definition('QuickBooks company ID returned with this authorization',flow.realmId),
            definition('QuickBooks environment',profile.provider.environment),
            definition('Refresh expiry',displayDate(flow.refreshExpiresAt)),
            definition('Refresh authorization ends',displayDate(flow.refreshHardExpiresAt)),
            make('p','Review the company selected at Intuit. This company ID and the environment remain bound to the saved grant and accounting workspace.','hint'));
        }
        const actor=field('Reviewer name',''),reference=field('Nonsecret review reference','');
        actor.input.maxLength=128;reference.input.maxLength=1000;actor.input.id='oauth-review-actor';reference.input.id='oauth-review-reference';
        const confirmation=make('input');confirmation.type='checkbox';confirmation.id='oauth-review-confirm';
        const label=make('label',undefined,'check');label.append(confirmation,make('span',profile.provider?.kind==='intuit-quickbooks'?'I reviewed this QuickBooks company, environment, grant and accounting scope':'I reviewed this provider grant, its scopes, and the declared API use'));
        const approve=button('Approve and keep private grant',async()=>{
          if(!confirmation.checked||!actor.input.value.trim()||!reference.input.value.trim())throw new Error('Enter a reviewer and review reference, then confirm the grant review.');
          return command('approve',{flowId:flow.flowId,reviewId:flow.reviewId,review:{actor:actor.input.value.trim(),reference:reference.input.value.trim()}});
        },blocked);approve.id='oauth-approve';
        const fields=make('div',undefined,'fields');fields.append(actor.container,reference.container);
        flowBox.append(fields,label,approve);
      }
      if(['awaiting_authorization','review_grant','failed','declined','expired'].includes(flow.phase))
        flowBox.append(button('Discard this authorization attempt',()=>command('discard',{flowId:flow.flowId}),blocked));
      summary.append(flowBox);
    }
    detail.append(summary);available();
  }
  selection.input.addEventListener('change',()=>act(async()=>{await readCurrent();}));
  refreshButton.addEventListener('click',()=>act(async()=>{await refresh();notice('Provider connections refreshed.');}));
  return {refresh,available,list:()=>values,get:alias=>values.find(value=>value.alias===alias),selectedAlias:()=>selection.input.value,
    binding:async(alias,specText,selection)=>api('oauth/binding',{alias,specText,selection}),
    pending:()=>Boolean(pending)};
}

export function createOAuthRouteSelection({operation,previous,server,security,make,selectField,connections,sourceText,act,notice,onChanged}) {
  const element=make('div',undefined,'oauth-route'),aliases=selectField('Reviewed provider connection',[],previous?.oauthAlias??'');
  const status=make('p',undefined,'hint'),details=make('div'),use=make('button','Use reviewed grant for this route');
  aliases.input.setAttribute('aria-label','Provider connection for '+operation.method+' '+operation.path);
  use.type='button';use.setAttribute('aria-label','Use reviewed grant for '+operation.method+' '+operation.path);
  element.append(aliases.container,use,status,details);
  let enabled=false,selected=previous?.oauthConnection&&previous?.oauthProfile&&previous?.oauthAlias?chosenFields(previous):null,flow='clientCredentials';
  function selectOriginal(){return {method:operation.method,path:operation.path,serverIndex:Number(server.value),securityAlternative:Number(security.value)};}
  function staleReason() {
    if(!selected)return 'No authorization grant is selected for this route.';
    const current=connections.get(selected.oauthAlias);
    if(!current)return 'This saved alias is not configured on the current host.';
    if(current.profileSha256!==selected.oauthConnection.profileSha256||current.grant.id!==selected.oauthConnection.grantId)
      return 'The configured grant changed. Explicitly select the current reviewed grant and save a new package.';
    if(current.grant.state!=='connected')return 'This grant requires connection recovery before it can serve the route.';
    const definition=current.profile,alternative=operation.authentication?.find(value=>Number(value.index)===Number(security.value));
    const scheme=alternative?.schemes.find(value=>value.name===definition.source.scheme);
    if(!scheme?.flows?.includes('authorizationCode'))return 'This security alternative does not use the selected authorization profile.';
    const target=operation.servers.find(value=>String(value.index)===server.value)?.url;
    let origin;try{origin=new URL(target).origin;}catch{return 'Select a declared backend server.';}
    if(!definition.resourceOrigins.includes(origin))return 'This connection does not approve the selected backend origin.';
    if(scheme.requiredScopes.some(scope=>!current.grant.scopes.includes(scope)))return 'The reviewed grant is missing a scope required by this operation.';
    return '';
  }
  function refresh() {
    const prior=aliases.input.value||selected?.oauthAlias||connections.selectedAlias();
    aliases.input.replaceChildren();
    const empty=make('option','Select a configured connection');empty.value='';aliases.input.append(empty);
    for(const value of connections.list()) {
      const option=make('option',value.profile.label+' · '+value.alias+' · '+value.grant.state);option.value=value.alias;aliases.input.append(option);
    }
    if(connections.list().some(value=>value.alias===prior))aliases.input.value=prior;
    const reason=staleReason();
    status.textContent=reason||'This route retains the exact reviewed grant shown below.';
    status.className=selected&&reason?'oauth-warning':'hint';
    details.replaceChildren();
    if(selected) {
      details.append(make('p','Grant '+selected.oauthConnection.grantId,'small wrap'),
        make('p','Required scopes: '+(selected.oauthConnection.requiredScopes.join(', ')||'none'),'hint'),
        make('p','Source scheme: '+selected.oauthProfile.source.scheme+' · '+selected.oauthProfile.label,'hint'));
    }
    aliases.input.disabled=!enabled||flow!=='authorizationCode'||connections.pending();
    use.disabled=!enabled||flow!=='authorizationCode'||!aliases.input.value||connections.pending();
    element.hidden=flow!=='authorizationCode';
  }
  aliases.input.addEventListener('change',()=>{refresh();});
  use.addEventListener('click',()=>act(async()=>{
    if(!aliases.input.value)throw new Error('Choose a configured provider connection.');
    const result=await connections.binding(aliases.input.value,sourceText(),selectOriginal());
    selected=chosenFields(result);refresh();onChanged?.();
    notice('Reviewed grant selected for '+operation.method+' '+operation.path+'. Validate and save a new package to retain this binding.');
  }));
  return {element,refresh,setEnabled(value,selectedFlow){enabled=value;flow=selectedFlow;refresh();},
    invalidateSelection(){selected=null;refresh();},
    usesAlias(alias){return selected?.oauthAlias===alias;},
    toPlan(){const reason=staleReason();if(reason)throw new Error(operation.method+' '+operation.path+': '+reason);return chosenFields(selected);}};
}

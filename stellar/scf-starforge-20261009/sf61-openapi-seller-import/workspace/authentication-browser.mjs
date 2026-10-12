// MIT. Declared OAuth flows and reviewed grants in the original merchant workspace.
import { createOAuthRouteSelection } from './oauth-browser.mjs';

export function createAuthenticationPanel({operation,definitions,previous,server,security,make,field,selectField,connections,sourceText,act,notice,onChanged}) {
  const byName=new Map(definitions.map(value=>[value.name,value]));
  const panel=make('details'),message=make('p',undefined,'hint'),fields=make('div');
  panel.append(make('summary','Backend OAuth authorization'),message,fields);
  const flowChoice=selectField('Declared OAuth flow',[],'');
  const clientFields=make('div',undefined,'fields');
  const endpoint=field('Declared token endpoint','');endpoint.container.className='wide';endpoint.input.readOnly=true;
  endpoint.container.append(make('span','Resolved against the selected original backend server. The saved package retains this exact endpoint.','hint'));
  const clientId=field('Client ID environment variable',previous?.oauth2?.clientIdEnv??'UPSTREAM_CLIENT_ID');
  const clientSecret=field('Client secret environment variable',previous?.oauth2?.clientSecretEnv??'UPSTREAM_CLIENT_SECRET');
  for(const entry of [clientId,clientSecret]){entry.input.autocomplete='off';entry.input.spellcheck=false;}
  const auth=selectField('Token endpoint authentication',[
    ['client_secret_basic','HTTP Basic client credentials'],['client_secret_post','Client credentials in form body']],previous?.oauth2?.authMethod??'client_secret_basic');
  const audience=field('Audience, if required by this provider',previous?.oauth2?.audience??'');
  audience.container.append(make('span','Use the provider’s documented audience. This is a public configuration value.','hint'));
  const scopeList=make('div',undefined,'wide');
  clientFields.append(endpoint.container,clientId.container,clientSecret.container,auth.container,audience.container,scopeList);
  const limits=make('details'),limitFields=make('div',undefined,'fields'),numbers={};
  const policies=[['timeoutMs','Token request timeout, milliseconds',10000],['refreshSkewMs','Renewal margin, milliseconds',30000],
    ['failureCooldownMs','Retry delay after token failure, milliseconds',1000],['maxWaiters','Maximum waiting requests',256],
    ['defaultExpiresInSeconds','Fallback lifetime when expires_in is absent, seconds','']];
  for(const [name,label,fallback] of policies){const entry=field(label,previous?.oauth2?.[name]??fallback,'number');
    entry.input.min=name==='refreshSkewMs'?'0':'1';numbers[name]=entry.input;limitFields.append(entry.container);}
  limits.append(make('summary','Token lifecycle limits'),limitFields,
    make('p','Leave the fallback lifetime empty when the provider returns expires_in. Choose a fallback only from the provider’s documented policy.','hint'));
  clientFields.append(limits);
  const connection=createOAuthRouteSelection({operation,previous,server,security,make,selectField,connections,sourceText,act,notice,onChanged});
  fields.append(flowChoice.container,clientFields,connection.element);
  let selected=null,required=[],scopeInputs=[],enabled=false,flow=null;
  const retainedScopes=new Set(previous?.oauth2?.scope?.split(' ')??[]);
  const controls=[endpoint.input,clientId.input,clientSecret.input,auth.input,audience.input,...Object.values(numbers)];
  function toggle(value){
    enabled=value;const client=flow?.flow==='clientCredentials';
    flowChoice.input.disabled=!enabled||!selected;
    for(const input of controls)input.disabled=!enabled||!selected||!client;
    for(const entry of scopeInputs)entry.input.disabled=!enabled||entry.required||!client;
    connection.setEnabled(enabled,flow?.flow??'');
  }
  function updateEndpoint(){
    if(!flow)return;
    const target=operation.servers.find(value=>String(value.index)===server.value)?.url;
    try{endpoint.input.value=new URL(flow.tokenUrl,target).href;}
    catch{endpoint.input.value='';message.textContent='Choose a declared backend server with expanded variables to resolve its token endpoint.';}
  }
  function updateFlow(){
    for(const entry of scopeInputs)if(entry.input.checked)retainedScopes.add(entry.name);else retainedScopes.delete(entry.name);
    flow=selected?.flows.find(value=>value.flow===flowChoice.input.value)??null;
    const client=flow?.flow==='clientCredentials';scopeInputs=[];scopeList.replaceChildren();clientFields.hidden=!client;
    if(selected&&flow){
      message.textContent=client?'The original seller obtains and renews the backend token. Enter environment-variable names; set their values before launching the workspace.':
        'Use Provider authorization connections above to authorize and review this API. Select the exact grant for this route; its private credentials stay on the host.';
      if(client){
        scopeList.append(make('p','Token scopes','small'));
        if(!flow.scopes.length)scopeList.append(make('p','This flow declares no explicit scopes. The token request omits scope.','hint'));
        for(const scope of flow.scopes){
          const label=make('label',undefined,'check wide'),input=make('input');input.type='checkbox';
          const mandatory=required.includes(scope.name);input.checked=mandatory||retainedScopes.has(scope.name);
          input.setAttribute('aria-label','OAuth scope '+scope.name);
          const text=make('span',scope.name+(mandatory?' (required)':''),'wrap');
          if(scope.description)text.append(make('span',' — '+scope.description,'hint'));
          label.append(input,text);scopeList.append(label);scopeInputs.push({name:scope.name,input,required:mandatory});
        }
      }
      updateEndpoint();
    }
    toggle(enabled);
  }
  function updateChoice(initial=false){
    const prior=initial?(previous?.oauthConnection?'authorizationCode':'clientCredentials'):flowChoice.input.value;
    const alternative=operation.authentication?.find(value=>String(value.index)===security.value);
    const selection=alternative?.schemes.find(value=>byName.get(value.name)?.type==='oauth2');
    selected=alternative?.supported&&selection?byName.get(selection.name):null;required=selection?.requiredScopes??[];
    panel.hidden=!selection&&alternative?.supported!==false;fields.hidden=!selected;flowChoice.input.replaceChildren();
    if(selected){
      for(const value of selected.flows.filter(value=>selection.flows.includes(value.flow))){
        const option=make('option',value.flow==='clientCredentials'?'Client credentials':'Authorization code with reviewed grant');
        option.value=value.flow;flowChoice.input.append(option);
      }
      if([...flowChoice.input.options].some(value=>value.value===prior))flowChoice.input.value=prior;
      flowChoice.container.hidden=flowChoice.input.options.length<2;
    }
    if(alternative?.supported===false)message.textContent=alternative.error;
    updateFlow();
  }
  security.addEventListener('change',()=>{connection.invalidateSelection();updateChoice();});
  server.addEventListener('change',()=>{connection.invalidateSelection();updateEndpoint();});
  flowChoice.input.addEventListener('change',updateFlow);updateChoice(true);
  return {element:panel,toggle,refreshConnections:connection.refresh,usesAlias:connection.usesAlias,toPlan(){
    if(!selected)return {};
    if(flow?.flow==='authorizationCode')return connection.toPlan();
    const scopes=scopeInputs.filter(value=>value.input.checked).map(value=>value.name);
    return {oauth2:{tokenEndpoint:endpoint.input.value,clientIdEnv:clientId.input.value.trim(),clientSecretEnv:clientSecret.input.value.trim(),
      authMethod:auth.input.value,...(scopes.length?{scope:scopes.join(' ')}:{}),
      ...(audience.input.value.trim()?{audience:audience.input.value.trim()}:{}),
      ...Object.fromEntries(Object.entries(numbers).filter(([,input])=>input.value.trim()!=='').map(([name,input])=>[name,Number(input.value)]))}};
  }};
}

export function appendAuthenticationReview(target,routes,{make}) {
  const authenticated=routes.filter(route=>route.backendAuthentication?.length);
  if(!authenticated.length)return;
  const section=make('div');section.append(make('h3','Backend authentication'));
  for(const route of authenticated){
    const entry=make('div');entry.append(make('p',route.method+' '+route.path,'small'));
    for(const auth of route.backendAuthentication){
      if(auth.type==='oauth2'&&auth.flow==='authorizationCode'){
        entry.append(make('p',auth.scheme+' · authorization code · '+auth.alias,'hint'),
          make('p','Reviewed grant: '+auth.grantId,'wrap'),
          make('p','Required scopes: '+(auth.requiredScopes.join(', ')||'none'),'wrap'),
          make('p','Authorization endpoint: '+auth.authorizationEndpoint,'wrap'),
          make('p','Token endpoint: '+auth.tokenEndpoint,'wrap'),
          make('p','Profile SHA256: '+auth.profileSha256,'hint wrap'),
          make('p','Environment references: '+[auth.directoryEnv,auth.clientSecretEnv].filter(Boolean).join(', '),'hint'));
      }else if(auth.type==='oauth2'){
        entry.append(make('p',auth.scheme+' · client credentials · '+auth.authMethod,'hint'),
          make('p','Token endpoint: '+auth.tokenEndpoint,'wrap'),
          make('p','Scopes: '+(auth.scopes.join(', ')||'provider default'),'wrap'),
          make('p','Environment references: '+auth.clientIdEnv+' and '+auth.clientSecretEnv,'hint'));
      }else entry.append(make('p',auth.scheme+': '+auth.header+' from '+auth.environment,'hint'));
    }
    section.append(entry);
  }
  target.append(section);
}

export function renderCredentialRuntime(target,credentials,{make}) {
  target.replaceChildren();
  if(!credentials?.length)return;
  const table=make('table'),head=make('tr'),body=make('tbody'),thead=make('thead');
  for(const text of ['Backend route','Token state','Lifecycle','Activity'])head.append(make('th',text));
  thead.append(head);table.append(thead,body);
  const seconds=value=>Number.isFinite(value)?Math.max(0,Math.ceil(value/1000))+'s':'unknown';
  for(const entry of credentials){
    const connected=Boolean(entry.oauthConnection),state=entry.oauthConnection??entry.oauth2??{},row=make('tr');
    const label=entry.routes?.map(route=>route.path).join(', ')||entry.binding;
    const lifecycle=connected?(state.grantId?'Grant '+state.grantId+' · expires in '+seconds(state.expiresInMs):'No reviewed grant'):
      state.state==='cooldown'?'Retry in '+seconds(state.retryInMs):
      state.hasToken?'Renew in '+seconds(state.refreshInMs)+' · expires in '+seconds(state.expiresInMs):'No cached token';
    const activity=connected?(state.tokenRequests??0)+' acquisitions · '+(state.renewals??0)+' renewals · '+(state.failures??0)+' failures':
      (state.tokenRequests??0)+' token requests · '+(state.renewals??0)+' tokens obtained · '+(state.waiters??0)+' waiting · '+(state.failures??0)+' failures';
    for(const text of [entry.method+' '+label,state.state??'unknown',lifecycle,activity])row.append(make('td',text));
    body.append(row);
    if(state.lastError){const errorRow=make('tr'),cell=make('td',entry.binding+': '+state.lastError,'hint');cell.colSpan=4;errorRow.append(cell);body.append(errorRow);}
  }
  const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Backend OAuth lifecycle');wrap.append(table);
  target.append(make('h3','Backend OAuth lifecycle'),wrap,
    make('p','State and counters come from the running seller. An unpaid challenge does not acquire a token. Connection grant review and revocation remain in the provider controls.','hint'));
}

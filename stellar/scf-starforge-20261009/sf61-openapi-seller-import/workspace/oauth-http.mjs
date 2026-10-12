// MIT. Same-origin adapter around the original trusted host connection registry.
import { normalizeOAuthProfile, oauthProfileIdentity, compileOAuthConnection, oauthRedirectOrigin } from '../../sf30-seller-sdk/oauth-connections/profile.mjs';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{const error=new TypeError(message);error.code='OAUTH_WORKSPACE_SELECTION_INVALID';throw error;};
const exact=(value,keys,label)=>{
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('Use the expected '+label+' fields.');
};
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const actions={
  begin:['expectedRevision','requestId'],
  approve:['flowId','reviewId','expectedRevision','requestId','review'],
  discard:['flowId'],
  refresh:['expectedRevision','expectedGrantId','requestId'],
  disconnect:['expectedRevision','expectedGrantId','requestId','revoke'],
  revoke:['expectedRevision','requestId','expectedRevocationGrantId'],
};

function assertProfile(profile,selection,{allowLoopback}) {
  const normalized=normalizeOAuthProfile(profile,{allowLoopback});
  if(normalized.source.sha256!==selection.sourceSha256||normalized.source.scheme!==selection.scheme)
    fail('The configured connection belongs to another OpenAPI source or security scheme.');
  if(normalized.authorizationEndpoint!==selection.authorizationEndpoint||normalized.tokenEndpoint!==selection.tokenEndpoint)
    fail('The configured endpoints differ from this declared authorizationCode flow.');
  if(!normalized.resourceOrigins.includes(selection.resourceOrigin))fail('This connection does not approve the selected backend origin.');
  if(normalized.scopes.some(scope=>!selection.declaredScopes.includes(scope))||selection.requiredScopes.some(scope=>!normalized.scopes.includes(scope)))
    fail('The connection profile must use declared scopes and include this operation’s required scopes.');
  return normalized;
}

/** No request body can create aliases, select a host path, or set a callback URL. */
export function createOAuthWorkspaceAdapter({registry,origin,allowLoopback=false}) {
  const callbacks=new Map(),begins=new Map(),active=new Set();let closing=false;
  async function call(method,...args) {
    try{return await registry[method](...args);}
    catch(error){
      if(/^OAUTH_[A-Z0-9_]{1,100}$/.test(error?.code??''))throw error;
      const failure=new Error('The private connection operation could not complete. Inspect host setup before retrying the retained request.');
      failure.code='OAUTH_WORKSPACE_HOST_FAILURE';failure.status=502;throw failure;
    }
  }
  async function tracked(work) {
    if(closing)fail('The connection workspace is stopping.');
    const pending=Promise.resolve().then(work);active.add(pending);
    try{return await pending;}finally{active.delete(pending);}
  }
  function prune() {
    const now=Date.now();
    for(const [state,value] of callbacks)if(value.retainUntil<now){callbacks.delete(state);begins.delete(value.requestKey);}
  }
  async function select(alias,specText,row) {
    if(typeof alias!=='string'||!alias||alias.length>128)fail('Select one configured connection alias.');
    const {merchantOAuthSelection}=await import('./model.mjs');
    const selection=merchantOAuthSelection(specText,row),status=await call('status',alias);
    const profile=assertProfile(status.profile,selection,{allowLoopback});
    const binding=await call('binding',alias,{sourceSha256:selection.sourceSha256,scheme:selection.scheme,
      resourceOrigin:selection.resourceOrigin,requiredScopes:selection.requiredScopes});
    return {oauthAlias:alias,oauthProfile:profile,oauthConnection:binding,
      grant:{id:status.grant.id,state:status.grant.state,scopes:[...status.grant.scopes],review:status.grant.review},selection};
  }
  return {
    async list() {return {connections:await call('list'),callbackOrigin:origin()};},
    async status(alias,flowId) {
      if(flowId!==null&&flowId!==undefined&&(typeof flowId!=='string'||flowId.length>128))fail('Select the retained authorization flow.');
      return call('status',alias,flowId?{flowId}:{});
    },
    async binding(body) {
      exact(body,['alias','specText','selection'],'connection selection');
      exact(body.selection,['method','path','serverIndex','securityAlternative'],'original operation selection');
      return select(body.alias,body.specText,body.selection);
    },
    async validatePlan(specText,plan) {
      if(!plain(plan)||!Array.isArray(plan.operations))fail('Select a merchant plan.');
      for(const row of plan.operations) {
        if(!plain(row))fail('Select a declared operation.');
        if(!['oauthAlias','oauthProfile','oauthConnection'].some(key=>row[key]!==undefined))continue;
        const actual=await select(row.oauthAlias,specText,row);
        const declared=compileOAuthConnection(row.oauthConnection,{resourceOrigin:actual.selection.resourceOrigin,allowLoopback});
        const profile=normalizeOAuthProfile(row.oauthProfile,{allowLoopback});
        if(!same(declared,compileOAuthConnection(actual.oauthConnection,{resourceOrigin:actual.selection.resourceOrigin,allowLoopback}))||
          oauthProfileIdentity(profile)!==oauthProfileIdentity(actual.oauthProfile))
          fail('The configured authorization grant changed. Reselect the current reviewed grant and save a new package.');
      }
    },
    command(body) {return tracked(async()=>{
      exact(body,['alias','action','args'],'connection command');
      if(!Object.hasOwn(actions,body.action))fail('Choose a supported connection action.');
      exact(body.args,actions[body.action],body.action+' command');
      if(body.action==='begin') {
        prune();
        const requestKey=JSON.stringify([body.alias,body.args.requestId]);
        if(callbacks.size>=128&&!begins.has(requestKey))fail('Finish or let existing authorization flows expire before starting another.');
        const status=await call('status',body.alias);
        const callbackOrigin=oauthRedirectOrigin(status.profile,origin());
        const result=await call('begin',body.alias,{...body.args,redirectUri:callbackOrigin+status.callbackPath});
        const authorization=new URL(result.authorizationUrl),states=authorization.searchParams.getAll('state');
        if(states.length!==1||!states[0]||result.callbackPath!==status.callbackPath)
          fail('The connection did not return its source-bound authorization route.');
        const retained=callbacks.get(states[0]);
        if(retained&&(retained.alias!==body.alias||retained.flowId!==result.flowId))fail('Authorization flow identity conflicts with another retained flow.');
        callbacks.set(states[0],{alias:body.alias,flowId:result.flowId,path:status.callbackPath,callbackOrigin,requestKey,retainUntil:Date.now()+12*60*1000});
        begins.set(requestKey,states[0]);
        return result;
      }
      return call(body.action,body.alias,body.args);
    });},
    // Only an active, source-bound authorization may use its separately
    // registered callback host. Workspace APIs keep the original local origin.
    acceptCallbackRequest(req,url) {
      if(req.method!=='GET')return false;
      prune();
      const permitted=record=>req.headers.host===new URL(record.callbackOrigin).host &&
        (!req.headers.origin||req.headers.origin===record.callbackOrigin);
      if(url.pathname.startsWith('/oauth/callback/')){
        const states=url.searchParams.getAll('state'),record=states.length===1?callbacks.get(states[0]):null;
        return Boolean(record&&record.path===url.pathname&&permitted(record));
      }
      if(!['/oauth-return','/style.css'].includes(url.pathname))return false;
      return [...callbacks.values()].some(permitted);
    },
    async callback(req,res,url) {
      if(!url.pathname.startsWith('/oauth/callback/'))return false;
      // Even failed callbacks leave a URL with no code or state. The private
      // workspace capability is never put into a provider redirect response.
      let outcome='failed';
      if(req.method==='GET'&&url.search.length<=16384) {
        prune();const states=url.searchParams.getAll('state');
        const retained=states.length===1?callbacks.get(states[0]):null;
        if(retained&&retained.path===url.pathname) {
          try {
            const result=await tracked(()=>call('complete',retained.alias,{flowId:retained.flowId,parameters:url.searchParams}));
            outcome=result.phase==='review_grant'||result.phase==='connected'?'received':'returned';
          } catch {outcome='failed';}
        }
      }
      res.writeHead(303,{Location:'/oauth-return?result='+outcome});res.end();return true;
    },
    returned(res,url) {
      if(url.pathname!=='/oauth-return')return false;
      const received=url.searchParams.get('result')==='received';
      const title=received?'Authorization returned':'Authorization needs review';
      const message=received?'The provider response was received. Return to the original API workspace tab, refresh this connection, and review the grant before saving it.':
        'Return to the original API workspace tab and refresh this connection to inspect its current status. Start a new authorization only when the retained flow is no longer usable.';
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><link rel="stylesheet" href="/style.css"><main><section><h1>'+title+'</h1><p>'+message+'</p><p>The workspace keeps authorization credentials private. This response does not authorize a provider account identity or approve an application release.</p></section></main></html>');
      return true;
    },
    async close() {closing=true;await Promise.allSettled([...active]);callbacks.clear();begins.clear();await call('close');},
  };
}

// MIT. An embedded interface over the existing merchant owner and authorization.
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { merchantToolFamily } from '../catalog.mjs';
import { compareHostProfiles } from '../host-profile.mjs';
import { createConsoleCustomers, customerManifestAccess } from './customers.mjs';
import { createMerchantWorkflows } from './workflows.mjs';
import { createMerchantWorkflowRecipes, MAX_WORKFLOW_RECIPE_REQUEST_BYTES } from './workflow-recipes.mjs';
import { MerchantConsoleStore, CONSOLE_SCHEMA, canonical, digest, fail } from './store.mjs';

const ROOT = new URL('./public/', import.meta.url);
const assets = new Map([
  ['/operator/', ['index.html', 'text/html; charset=utf-8']],
  ['/operator/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/operator/workflows.mjs', ['workflows.mjs', 'text/javascript; charset=utf-8']],
  ['/operator/workflow-recipes.mjs', ['workflow-recipes.mjs', 'text/javascript; charset=utf-8']],
  ['/operator/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json = value => Buffer.from(JSON.stringify(value));
const cleanError = error => ({code:error.code ?? 'CONSOLE_ERROR',message:error.message ?? String(error)});
async function body(req, maximum) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw fail('CONSOLE_BODY_TOO_LARGE', 'This request exceeds the displayed byte capacity.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size))); }
  catch { throw fail('CONSOLE_JSON', 'Supply complete UTF-8 JSON.', 400); }
}
function headers(type) {
  return {'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"};
}
function send(res, status, value) {
  const bytes = json(value);
  res.writeHead(status,{...headers('application/json; charset=utf-8'),'content-length':bytes.length});
  res.end(bytes);
}
function attachment(res, name, bytes, type='application/json; charset=utf-8') {
  res.writeHead(200,{...headers(type),'content-length':bytes.length,
    'content-disposition':'attachment; filename="' + name.replace(/[^A-Za-z0-9_.-]/g,'_') + '"',
    'x-content-sha256':digest(bytes)});
  res.end(bytes);
}
export async function createMerchantConsole({operator,configPath,directory,authorization,bearerToken,binding}={}) {
  if (!operator || typeof operator.inspectHost !== 'function' || typeof operator.call !== 'function')
    throw fail('CONSOLE_OPERATOR', 'Attach the original configured merchant operator.');
  if (authorization === undefined && (typeof bearerToken !== 'string' || bearerToken.length < 24))
    throw fail('CONSOLE_AUTH', 'Use the original merchant authorization.');
  let launchBinding;
  if (binding !== undefined) {
    try {
      const encoded=JSON.stringify(binding);
      if (!encoded || Buffer.byteLength(encoded)>16384) throw new TypeError('binding');
      launchBinding=JSON.parse(encoded);
      if (!launchBinding || typeof launchBinding!=='object' || Array.isArray(launchBinding)) throw new TypeError('binding');
    } catch { throw fail('CONSOLE_BINDING','Use a complete managed console binding up to 16 KiB.',400); }
  }
  configPath = resolve(configPath);
  const configurationBytes = await readFile(configPath);
  const configuration = {name:basename(configPath),bytes:configurationBytes.length,sha256:digest(configurationBytes)};
  const store = new MerchantConsoleStore(directory ?? configPath + '.console');
  const definitions = new Map(operator.tools.map(value=>[value.name,value]));
  const index = [...definitions].map(([name, value])=>({name,description:value.description,
    family:merchantToolFamily(name) ?? 'core',annotations:value.annotations ?? {},
    required:value.inputSchema.required ?? [],schemaSha256:digest(canonical(value))}));
  const active = new Map(), requests = new Set(); let closing=false,closed;
  const requireOpen = () => { if(closing)throw fail('CONSOLE_CLOSING','The operator interface is closing.',503); };
  function respondError(error,res) {
    if(res.destroyed||res.writableEnded)return;
    if(res.headersSent){res.destroy();return;}
    if(authorization&&error.merchantConsoleAuthorization)authorization.respondError(error,res);
    else send(res,error.status??400,{error:cleanError(error)});
  }
  function beginClose() {
    closing=true;workflows.beginClose();customers.beginClose();
    for(const entry of requests)if(entry.reading&&!entry.req.destroyed)
      entry.req.destroy(fail('CONSOLE_CLOSING','The host is closing this incomplete request body.',503));
  }
  const snapshot = () => ({...operator.inspectHost(),configuration,
    console:{schema:CONSOLE_SCHEMA,workspaceId:store.id,activeCalls:active.size,activeRequests:requests.size,
      pendingBodies:[...requests].filter(value=>value.reading).length,closing,customers:customers.summary,workflows:workflows.summary,
      ...(launchBinding===undefined?{}:{binding:JSON.parse(JSON.stringify(launchBinding))})}});
  const callView = value => {
    const {resultJson,...rest}=value;
    return {...rest,resultBytes:resultJson===null?0:Buffer.byteLength(resultJson),
      receiving:active.has(value.id)?'ACTIVE':value.state==='RUNNING'?'RETURN_PENDING':'RETAINED',
      custody:value.workspaceId===store.id?'LOCAL':'IMPORTED'};
  };
  async function allowed(context,name,args) {
    if (!authorization) return true;
    try { await authorization.authorizeTool(context,name,args); return true; }
    catch { return false; }
  }
  async function requireTool(context,name,args) {
    if (authorization) try { await authorization.authorizeTool(context,name,args); }
    catch(error){error.merchantConsoleAuthorization=true;throw error;}
  }
  const deliveryAccess = value => customerManifestAccess(value.identity);
  const bindingView = value => {
    const {host,...rest}=value;
    return {...rest,merchant:host.merchant,toolCount:host.capabilities?.tools??null,
      compositionFingerprint:host.composition?.fingerprint??null,sourceCommit:host.composition?.sourceCommit??null};
  };
  async function visibleProfile(profileId,context) {
    const profile=store.profile(profileId), drafts=[],calls=[];
    for(const value of store.drafts(profileId))
      if(await allowed(context,value.tool,JSON.parse(value.argumentsJson))) drafts.push(value);
    for(const value of store.calls(profileId))
      if(await allowed(context,value.tool,JSON.parse(value.argumentsJson))) calls.push(callView(value));
    const deliveries=[];
    for(const value of store.deliveries(profileId)) {
      const access=deliveryAccess(value);
      if(await allowed(context,access.name,access.args)) deliveries.push(customers.view(value));
    }
    return {profile,drafts,calls,deliveries,bindings:store.hostBindings(profileId).map(bindingView),
      hostBound:profile.hostFingerprint===snapshot().configurationFingerprint,
      compositionBound:profile.host.composition?.fingerprint?profile.host.composition.fingerprint===operator.inspectHost().composition?.fingerprint:null};
  }
  async function startCall(input,context,workflowGuard) {
    if (closing) throw fail('CONSOLE_CLOSING','The operator interface is closing.',503);
    const draft=store.draft(input.draftId,input.draftRevision), definition=definitions.get(draft.tool);
    if(!definition) throw fail('CONSOLE_TOOL_UNAVAILABLE','This host does not advertise the saved native tool.',400);
    const args=JSON.parse(draft.argumentsJson);
    await requireTool(context,draft.tool,args);
    requireOpen();
    const packet=json({jsonrpc:'2.0',id:input.id,method:'tools/call',params:{name:draft.tool,arguments:args}});
    if(packet.length>operator.maxRequestBytes)
      throw fail('CONSOLE_NATIVE_BODY_TOO_LARGE','The exact native MCP request exceeds this host’s ' + operator.maxRequestBytes + '-byte capacity.',413);
    const reserved=store.reserve(input,draft,snapshot(),definition,workflowGuard);
    if(reserved.existing)return {call:callView(reserved.value),reused:true};
    const task=(async()=>{
      try { const result=await operator.call(draft.tool,args,authorization?{authorization:context}:undefined); return store.finish(input.id,result); }
      catch(error){ return store.finish(input.id,null,error); }
      finally { active.delete(input.id);try{store.noteWorkflowCallSettled(input.id);}catch{} }
    })();
    active.set(input.id,task); task.catch(()=>{});
    return {call:callView(store.call(input.id)),reused:false};
  }
  async function authorizeRequest(req,name,args) {
    let context;
    if(authorization){
      try{context=await authorization.authenticate(req);await authorization.authorizeTool(context,name,args);}
      catch(error){error.merchantConsoleAuthorization=true;throw error;}
    }else if(!equal(req.headers.authorization,'Bearer '+bearerToken))
      throw fail('UNAUTHORIZED','Use the original operator access token.',401);
    return context;
  }
  const sourceConfiguration=JSON.parse(configurationBytes);
  const customers=createConsoleCustomers({operator,store,definitions,getHost:snapshot,authorize:authorizeRequest,
    releaseStore:resolve(dirname(configPath),sourceConfiguration.releaseStore)});
  const workflows=createMerchantWorkflows({store,definitions,getHost:snapshot,startCall,requireTool,
    isCallActive:id=>active.has(id),waitCall:async id=>{await active.get(id);return store.call(id);}});
  const recipes=createMerchantWorkflowRecipes({store,definitions,getHost:snapshot,requireTool,requireOpen});
  function handler(req,res) {
    let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{return Promise.resolve(false);}
    if(url.pathname!=='/operator'&&!url.pathname.startsWith('/operator/'))return Promise.resolve(false);
    if(closing){respondError(fail('CONSOLE_CLOSING','The operator interface is closing.',503),res);return Promise.resolve(true);}
    const entry={req,reading:false,task:null};requests.add(entry);
    entry.task=handle(req,res,entry).catch(error=>{respondError(error,res);return true;})
      .finally(()=>requests.delete(entry));
    return entry.task;
  }
  async function handle(req,res,entry) {
    let url; try { url=new URL(req.url,'http://127.0.0.1'); } catch { return false; }
    if(url.pathname==='/operator' && req.method==='GET'){res.writeHead(302,{location:'/operator/','cache-control':'no-store'});res.end();return true;}
    if(!url.pathname.startsWith('/operator/'))return false;
    const explicit='127.0.0.1:' + req.socket.localPort;
    const origin=new URL('http://'+explicit).origin;
    const hosts=new Set([explicit,new URL(origin).host]);
    if(!hosts.has(req.headers.host)){send(res,403,{error:{code:'CONSOLE_HOST',message:'Use this operator’s original loopback address.'}});return true;}
    if(assets.has(url.pathname) && req.method==='GET'){
      const [file,type]=assets.get(url.pathname),bytes=await readFile(new URL(file,ROOT));
      res.writeHead(200,{...headers(type),'content-length':bytes.length});res.end(bytes);return true;
    }
    if(!url.pathname.startsWith('/operator/api/')){send(res,404,{error:{code:'CONSOLE_ROUTE',message:'Choose an operator page.'}});return true;}
    if(req.headers.origin && req.headers.origin!==origin && req.headers.origin!=='http://'+explicit){
      send(res,403,{error:{code:'CONSOLE_ORIGIN',message:'Use the original operator page.'}});return true;
    }
    let context;
    if(authorization){
      try{context=await authorization.authenticate(req);await authorization.authorizeTool(context,null,{});}
      catch(error){error.merchantConsoleAuthorization=true;respondError(error,res);return true;}
    }else if(!equal(req.headers.authorization,'Bearer '+bearerToken)){
      send(res,401,{error:{code:'UNAUTHORIZED',message:'Connect with the original operator access token.'}});return true;
    }
    const route=url.pathname.slice('/operator/api/'.length);
    try{
      requireOpen();
      if(req.method==='GET'&&route.startsWith('customer-file/')){
        const value=await customers.file(decodeURIComponent(route.slice(14)),url.searchParams.get('file'),req);
        attachment(res,value.file.name,value.bytes,'application/octet-stream');return true;
      }
      if(req.method==='GET'&&route.startsWith('customer-archive/')){
        await customers.archive(decodeURIComponent(route.slice(17)),req,res);return true;
      }
      if(req.method==='GET'&&route==='host'){send(res,200,snapshot());return true;}
      if(req.method==='GET'&&route==='tools'){
        const family=url.searchParams.get('family'),query=(url.searchParams.get('q')??'').toLowerCase();
        const favoriteProfile=url.searchParams.get('favorites');
        const favorites=favoriteProfile?new Set(store.profile(favoriteProfile).favorites):null;
        const start=Number(url.searchParams.get('offset')??0);
        if(!Number.isSafeInteger(start)||start<0)throw fail('CONSOLE_PAGE','Use a nonnegative page offset.',400);
        const values=index.filter(value=>(!favorites||favorites.has(value.name))&&(!family||value.family===family)&&(!query||(value.name+' '+value.description).toLowerCase().includes(query)));
        send(res,200,{items:values.slice(start,start+75),total:values.length,offset:start,nextOffset:start+75<values.length?start+75:null});return true;
      }
      if(req.method==='GET'&&route.startsWith('tool/')){
        const value=definitions.get(decodeURIComponent(route.slice(5)));
        if(!value)throw fail('CONSOLE_TOOL_UNAVAILABLE','Choose a configured native tool.',404);
        send(res,200,{definition:value,family:merchantToolFamily(value.name)??'core',schemaSha256:digest(canonical(value))});return true;
      }
      if(req.method==='GET'&&route==='workflow-recipes'){
        send(res,200,await recipes.list(url.searchParams.get('profile'),context));return true;
      }
      if(req.method==='GET'&&route.startsWith('workflow-recipe-install/')){
        send(res,200,await recipes.installation(decodeURIComponent(route.slice('workflow-recipe-install/'.length)),context));return true;
      }
      if(req.method==='GET'&&route==='workflows'){
        send(res,200,await workflows.list(url.searchParams.get('profile'),context));return true;
      }
      if(req.method==='GET'&&route.startsWith('workflow/')){
        const revision=url.searchParams.get('revision');
        send(res,200,{definition:await workflows.definition(decodeURIComponent(route.slice(9)),revision===null?undefined:Number(revision),context)});return true;
      }
      if(req.method==='GET'&&route.startsWith('workflow-run/')){
        send(res,200,{run:await workflows.run(decodeURIComponent(route.slice(13)),context)});return true;
      }
      if(req.method==='GET'&&route==='profiles'){send(res,200,{profiles:store.profiles(),host:snapshot()});return true;}
      if(req.method==='GET'&&route.startsWith('host-review/')){
        const profile=store.profile(decodeURIComponent(route.slice(12))),selected=url.searchParams.get('revision');
        const binding=selected===null?null:store.hostBinding(profile.id,Number(selected));
        const comparison=compareHostProfiles(binding?.host??profile.host,snapshot());
        const review={...comparison,recordedAt:new Date().toISOString(),
          profile:{id:profile.id,name:profile.name,revision:profile.revision,bindingRevision:profile.bindingRevision??null},
          baselineBinding:binding?bindingView(binding):null};
        const packet={...review,contentSha256:digest(canonical(review))};
        if(url.searchParams.get('download')==='1')attachment(res,profile.id+'-host-review.json',json(packet));
        else send(res,200,packet);
        return true;
      }
      if(req.method==='GET'&&route.startsWith('host-binding/')){
        const profileId=decodeURIComponent(route.slice(13));
        send(res,200,{binding:store.hostBinding(profileId,Number(url.searchParams.get('revision')))});return true;
      }
      if(req.method==='GET'&&route.startsWith('profile/')){
        send(res,200,await visibleProfile(decodeURIComponent(route.slice(8)),context));return true;
      }
      if(req.method==='GET'&&route.startsWith('draft/')){
        const selected=url.searchParams.get('revision');
        const value=store.draft(decodeURIComponent(route.slice(6)),selected===null?undefined:Number(selected));
        await requireTool(context,value.tool,JSON.parse(value.argumentsJson));
        send(res,200,{draft:value});return true;
      }
      if(req.method==='GET'&&route.startsWith('recovery/')){
        const original=store.call(decodeURIComponent(route.slice(9))),args=JSON.parse(original.argumentsJson);
        await requireTool(context,original.tool,args);
        const family=merchantToolFamily(original.tool)??'core',items=[],controls=[];
        const returned=original.resultJson===null?null:JSON.parse(original.resultJson);
        const known={...(returned&&typeof returned==='object'&&!Array.isArray(returned)?returned:{}),...args};
        for(const definition of definitions.values()){
          if((merchantToolFamily(definition.name)??'core')!==family)continue;
          const reading=definition.annotations?.readOnlyHint&&/(?:operation|status|result|inspect|job|request|capture|selection|client)/.test(definition.name);
          const controlling=/(?:cancel|stop|drain|resume|reconcile)$/.test(definition.name);
          if(!reading&&!controlling)continue;
          const schema=definition.inputSchema,values={};
          for(const name of Object.keys(schema.properties??{}))if(Object.hasOwn(known,name))values[name]=known[name];
          if((schema.required??[]).every(name=>Object.hasOwn(values,name))&&await allowed(context,definition.name,values))
            (reading?items:controls).push({definition,arguments:values});
        }
        send(res,200,{callId:original.id,items,controls});return true;
      }
      if(req.method==='GET'&&route.startsWith('call/')){
        const value=store.call(decodeURIComponent(route.slice(5)));
        await requireTool(context,value.tool,JSON.parse(value.argumentsJson));
        send(res,200,{...callView(value),resultJson:value.resultJson});return true;
      }
      if(req.method==='GET'&&route.startsWith('result/')){
        const value=store.call(decodeURIComponent(route.slice(7)));
        await requireTool(context,value.tool,JSON.parse(value.argumentsJson));
        if(value.state!=='COMPLETE')throw fail('CONSOLE_RESULT_PENDING','Open the original request and its recovery tools.');
        attachment(res,value.id+'-result.json',Buffer.from(value.resultJson));return true;
      }
      if(req.method==='GET'&&route.startsWith('export/')){
        const packet=store.archive(decodeURIComponent(route.slice(7)));
        for(const value of [...packet.drafts,...packet.calls])
          await requireTool(context,value.tool,JSON.parse(value.argumentsJson));
        for(const value of packet.deliveries) {const access=deliveryAccess(value);await requireTool(context,access.name,access.args);}
        attachment(res,packet.profile.id+'-operator-profile.json',json(packet));return true;
      }
      if(req.method!=='POST')throw fail('CONSOLE_METHOD','Use the displayed operator action.',405);
      if(!String(req.headers['content-type']??'').toLowerCase().startsWith('application/json'))
        throw fail('CONSOLE_CONTENT_TYPE','Use application/json.',415);
      // The console's draft metadata must fit around a full original native packet.
      // Dispatch still checks the exact original MCP envelope against maxRequestBytes.
      let input;entry.reading=true;
      try{input=await body(req,route==='import'?128*1024*1024:route.startsWith('workflow-recipe-')?MAX_WORKFLOW_RECIPE_REQUEST_BYTES:operator.maxRequestBytes+8192);}
      finally{entry.reading=false;}
      requireOpen();
      if(!input||typeof input!=='object'||Array.isArray(input))throw fail('CONSOLE_JSON','Supply an operator request object.',400);
      if(route==='customers'){send(res,202,{delivery:await customers.start(input,req)});return true;}
      if(route==='customer-pause'){
        const record=store.delivery(input.id),access=deliveryAccess(record);
        await requireTool(context,access.name,access.args);
        requireOpen();
        send(res,200,{delivery:customers.pause(input.id)});return true;
      }
      if(route==='workflow-recipe-export'){send(res,200,await recipes.export(input,context));return true;}
      if(route==='workflow-recipe-review'){send(res,200,await recipes.review(input,context));return true;}
      if(route==='workflow-recipe-install'){send(res,200,await recipes.install(input,context));return true;}
      if(route==='workflows'){send(res,200,await workflows.save(input,context));return true;}
      if(route==='workflow-runs'){send(res,202,await workflows.start(input,context));return true;}
      if(route==='workflow-resume'){send(res,202,await workflows.resume(input,context));return true;}
      if(route==='workflow-pause'){send(res,200,await workflows.pause(input,context));return true;}
      if(route==='workflow-resolve'){send(res,200,await workflows.resolve(input,context));return true;}
      if(route==='workflow-handover'){send(res,200,await workflows.handover(input,context));return true;}
      if(route==='profiles'){send(res,200,{profile:store.saveProfile(input,snapshot())});return true;}
      if(route==='bind'){send(res,200,{profile:store.bindProfile(input,snapshot())});return true;}
      if(route==='drafts'){
        await requireTool(context,input.tool,input.arguments??{});
        requireOpen();
        send(res,200,{draft:store.saveDraft(input,definitions.get(input.tool))});return true;
      }
      if(route==='calls'){send(res,202,await startCall(input,context));return true;}
      if(route==='import'){
        const packet=input.archive;
        if(!packet||input.expectedContentSha256!==packet.contentSha256)
          throw fail('CONSOLE_IMPORT_REVIEW','Use the selected archive’s displayed content digest.',400);
        for(const value of [...(packet.drafts??[]),...(packet.calls??[])])
          await requireTool(context,value.tool,JSON.parse(value.argumentsJson));
        for(const value of packet.deliveries??[]) {const access=deliveryAccess(value);await requireTool(context,access.name,access.args);}
        requireOpen();
        send(res,200,store.import(packet,{isActiveCall:call=>active.has(call.id)}));return true;
      }
      throw fail('CONSOLE_ROUTE','Choose a configured operator action.',404);
    }catch(error){
      respondError(error,res);
      return true;
    }
  }
  return {
    store,handler,snapshot,startCall,workflows,recipes,
    beginClose,
    close(){
      if(!closed){
        beginClose();
        closed=(async()=>{
          const results=await Promise.allSettled([...active.values(),...[...requests].map(value=>value.task),customers.close(),workflows.close()]);
          const errors=results.filter(value=>value.status==='rejected').map(value=>value.reason);
          if(errors.length)throw Object.assign(new AggregateError(errors,'Original console shutdown is incomplete; retry this owner.'),{code:'CONSOLE_CLOSE_INCOMPLETE'});
          store.close();
        })().catch(error=>{closed=undefined;throw error;});
      }
      return closed;
    }
  };
}

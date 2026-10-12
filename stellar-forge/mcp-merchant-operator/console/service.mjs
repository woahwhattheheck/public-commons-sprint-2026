// MIT. An embedded interface over the existing merchant owner and authorization.
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { merchantToolFamily } from '../catalog.mjs';
import { createConsoleCustomers } from './customers.mjs';
import { MerchantConsoleStore, CONSOLE_SCHEMA, canonical, digest, fail } from './store.mjs';

const ROOT = new URL('./public/', import.meta.url);
const assets = new Map([
  ['/operator/', ['index.html', 'text/html; charset=utf-8']],
  ['/operator/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
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
export async function createMerchantConsole({operator,configPath,directory,authorization,bearerToken}={}) {
  if (!operator || typeof operator.inspectHost !== 'function' || typeof operator.call !== 'function')
    throw fail('CONSOLE_OPERATOR', 'Attach the original configured merchant operator.');
  if (authorization === undefined && (typeof bearerToken !== 'string' || bearerToken.length < 24))
    throw fail('CONSOLE_AUTH', 'Use the original merchant authorization.');
  configPath = resolve(configPath);
  const configurationBytes = await readFile(configPath);
  const configuration = {name:basename(configPath),bytes:configurationBytes.length,sha256:digest(configurationBytes)};
  const store = new MerchantConsoleStore(directory ?? configPath + '.console');
  const definitions = new Map(operator.tools.map(value=>[value.name,value]));
  const index = [...definitions].map(([name, value])=>({name,description:value.description,
    family:merchantToolFamily(name) ?? 'core',annotations:value.annotations ?? {},
    required:value.inputSchema.required ?? [],schemaSha256:digest(canonical(value))}));
  const active = new Map(); let closing=false,closed;
  const snapshot = () => ({...operator.inspectHost(),configuration,
    console:{schema:CONSOLE_SCHEMA,workspaceId:store.id,activeCalls:active.size,closing}});
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
  const deliveryAccess = value => {
    const selection=value.identity;
    return {name:(selection.family==='core'?'merchant_client_export':'merchant_opensearch_deployment')+'_manifest',
      args:{exportId:selection.exportId,...(selection.workspace?{workspace:selection.workspace}:{})}};
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
    return {profile,drafts,calls,deliveries,hostBound:profile.hostFingerprint===snapshot().configurationFingerprint};
  }
  async function startCall(input,context) {
    if (closing) throw fail('CONSOLE_CLOSING','The operator interface is closing.',503);
    const draft=store.draft(input.draftId,input.draftRevision), definition=definitions.get(draft.tool);
    if(!definition) throw fail('CONSOLE_TOOL_UNAVAILABLE','This host does not advertise the saved native tool.',400);
    const args=JSON.parse(draft.argumentsJson);
    await requireTool(context,draft.tool,args);
    const packet=json({jsonrpc:'2.0',id:input.id,method:'tools/call',params:{name:draft.tool,arguments:args}});
    if(packet.length>operator.maxRequestBytes)
      throw fail('CONSOLE_NATIVE_BODY_TOO_LARGE','The exact native MCP request exceeds this host’s ' + operator.maxRequestBytes + '-byte capacity.',413);
    const reserved=store.reserve(input,draft,snapshot(),definition);
    if(reserved.existing)return {call:callView(reserved.value),reused:true};
    const task=(async()=>{
      try { const result=await operator.call(draft.tool,args,authorization?{authorization:context}:undefined); return store.finish(input.id,result); }
      catch(error){ return store.finish(input.id,null,error); }
      finally { active.delete(input.id); }
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
  async function handler(req,res) {
    let url; try { url=new URL(req.url,'http://127.0.0.1'); } catch { return false; }
    if(url.pathname==='/operator' && req.method==='GET'){res.writeHead(302,{location:'/operator/','cache-control':'no-store'});res.end();return true;}
    if(!url.pathname.startsWith('/operator/'))return false;
    const expected='127.0.0.1:' + req.socket.localPort;
    if(req.headers.host!==expected){send(res,403,{error:{code:'CONSOLE_HOST',message:'Use this operator’s original loopback address.'}});return true;}
    if(assets.has(url.pathname) && req.method==='GET'){
      const [file,type]=assets.get(url.pathname),bytes=await readFile(new URL(file,ROOT));
      res.writeHead(200,{...headers(type),'content-length':bytes.length});res.end(bytes);return true;
    }
    if(!url.pathname.startsWith('/operator/api/')){send(res,404,{error:{code:'CONSOLE_ROUTE',message:'Choose an operator page.'}});return true;}
    if(req.headers.origin && req.headers.origin!=='http://'+expected){
      send(res,403,{error:{code:'CONSOLE_ORIGIN',message:'Use the original operator page.'}});return true;
    }
    let context;
    if(authorization){
      try{context=await authorization.authenticate(req);await authorization.authorizeTool(context,null,{});}
      catch(error){authorization.respondError(error,res);return true;}
    }else if(!equal(req.headers.authorization,'Bearer '+bearerToken)){
      send(res,401,{error:{code:'UNAUTHORIZED',message:'Connect with the original operator access token.'}});return true;
    }
    const route=url.pathname.slice('/operator/api/'.length);
    try{
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
      if(req.method==='GET'&&route==='profiles'){send(res,200,{profiles:store.profiles(),host:snapshot()});return true;}
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
      const input=await body(req,route==='import'?128*1024*1024:operator.maxRequestBytes+8192);
      if(!input||typeof input!=='object'||Array.isArray(input))throw fail('CONSOLE_JSON','Supply an operator request object.',400);
      if(route==='customers'){send(res,202,{delivery:await customers.start(input,req)});return true;}
      if(route==='customer-pause'){
        const record=store.delivery(input.id),selection=record.identity;
        await requireTool(context,(selection.family==='core'?'merchant_client_export':'merchant_opensearch_deployment')+'_manifest',
          {exportId:selection.exportId,...(selection.workspace?{workspace:selection.workspace}:{})});
        send(res,200,{delivery:customers.pause(input.id)});return true;
      }
      if(route==='profiles'){send(res,200,{profile:store.saveProfile(input,snapshot())});return true;}
      if(route==='bind'){send(res,200,{profile:store.bindProfile(input,snapshot())});return true;}
      if(route==='drafts'){
        await requireTool(context,input.tool,input.arguments??{});
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
        send(res,200,store.import(packet));return true;
      }
      throw fail('CONSOLE_ROUTE','Choose a configured operator action.',404);
    }catch(error){
      if(authorization&&error.merchantConsoleAuthorization)authorization.respondError(error,res);
      else send(res,error.status??400,{error:cleanError(error)});
      return true;
    }
  }
  return {
    store,handler,snapshot,startCall,
    beginClose(){closing=true;customers.beginClose();},
    close(){if(!closed){closing=true;customers.beginClose();closed=(async()=>{await Promise.allSettled([...active.values(),customers.close()]);store.close();})();}return closed;}
  };
}

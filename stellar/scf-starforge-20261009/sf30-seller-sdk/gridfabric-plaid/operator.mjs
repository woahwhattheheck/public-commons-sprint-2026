// MIT. Original Plaid domain owner and explicitly dispatched external operations.
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {TextDecoder} from 'node:util';
import {openGridFabricStore} from './sqlite-store.mjs';
import {createGridFabricFiles,sha256Utf8} from './files.mjs';

const require=createRequire(import.meta.url);
const {createEngine,TABLES,ACTIONS}=require('./core.cjs');
const publicContract=JSON.parse(readFileSync(new URL('./contracts/plaid-public-contract.json',import.meta.url),'utf8'));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))]))
  :Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):value);
const fail=(code,message,detail={})=>Object.assign(new Error(message),{code,...detail});
const errorView=error=>({code:error.code||'GRIDFABRIC_TRANSPORT_ERROR',message:String(error.message||error)});
const now=()=>new Date().toISOString();
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const recordOf=detail=>detail?.record??null;
const dispatchKinds={
  management:{table:'management_operations',begin:'begin_management',finish:'finish_management',id:'operation_id'},
  device:{table:'device_actions',begin:'begin_device_action',finish:'finish_device_action',id:'device_action_id'}
};
export function publicTables(){return Array.isArray(TABLES)?TABLES.filter(x=>x!=='meta'):Object.keys(TABLES).filter(x=>x!=='meta');}
export function publicActions(){return Array.isArray(ACTIONS)?[...ACTIONS]:Object.keys(ACTIONS);}
function validateRequest(request_id,expected_revision) {
  if(typeof request_id!=='string'||!UUID.test(request_id))throw fail('GRIDFABRIC_REQUEST_ID','Use a canonical UUID for this original operation.');
  if(!Number.isSafeInteger(expected_revision)||expected_revision<0)throw fail('GRIDFABRIC_REVISION','Supply the original workspace revision.');
}
function endpointAndHeaders(captured,environment) {
  const url=new URL(captured.endpoint);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)
    throw fail('GRIDFABRIC_DISPATCH_ENDPOINT','Use the exact configured HTTP or HTTPS endpoint without URL credentials or a fragment.');
  if(captured.method!=='POST')throw fail('GRIDFABRIC_DISPATCH_METHOD','The captured original operation must use POST.');
  if(typeof captured.request_body_utf8!=='string')throw fail('GRIDFABRIC_DISPATCH_BODY','Retain the complete original request body.');
  const identity=sha256Utf8(captured.request_body_utf8);
  if(identity.sha256!==captured.request_body_sha256||identity.bytes!==captured.request_body_bytes)
    throw fail('GRIDFABRIC_DISPATCH_BODY_CHANGED','The captured native request bytes differ.');
  const headers={};
  for(const [name,reference] of Object.entries(captured.header_env||{})) {
    if(!/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(name)||typeof reference!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference))
      throw fail('GRIDFABRIC_HEADER_REFERENCE','Use original header names and environment variable references.');
    if(['host','content-length','transfer-encoding','connection'].includes(name.toLowerCase()))
      throw fail('GRIDFABRIC_HEADER_REFERENCE','Transport framing headers are set by the native HTTP owner.');
    const value=environment[reference];
    if(typeof value!=='string'||!value||/[\r\n\0]/.test(value))
      throw fail('GRIDFABRIC_HEADER_UNAVAILABLE','The configured environment header is not available.',{reference});
    headers[name]=value;
  }
  for(const name of Object.keys(headers))if(name.toLowerCase()==='content-type')delete headers[name];
  headers['Content-Type']='application/json';
  headers['Content-Length']=String(identity.bytes);
  return {url,headers,body:Buffer.from(captured.request_body_utf8,'utf8')};
}
function performRequest(captured,environment,{timeoutMilliseconds,maximumResponseBytes}) {
  return new Promise(resolve=>{
    let settled=false,req,responseStatus=null,responseHeaders={},rawHeaders=[],complete=false;
    let timer,received=0;const chunks=[];
    const finish=transportError=>{
      if(settled)return;settled=true;clearTimeout(timer);
      const bytes=Buffer.concat(chunks),rawIdentity={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
      let bodyUtf8=null;
      try{bodyUtf8=decoder.decode(bytes);}catch{transportError=transportError||{code:'GRIDFABRIC_RESPONSE_ENCODING',message:'The original response is not valid UTF-8.'};}
      resolve({http_status:responseStatus,headers:responseHeaders,raw_headers:rawHeaders,
        body_utf8:bodyUtf8,body_base64:bodyUtf8===null?bytes.toString('base64'):null,
        body_sha256:rawIdentity.sha256,body_bytes:rawIdentity.bytes,received_bytes:received,
        complete,transport_error:transportError||null,received_at:now()});
    };
    try {
      const prepared=endpointAndHeaders(captured,environment);
      req=(prepared.url.protocol==='https:'?httpsRequest:httpRequest)(prepared.url,
        {method:'POST',headers:prepared.headers,agent:false},res=>{
          responseStatus=res.statusCode;responseHeaders={...res.headers};rawHeaders=[...res.rawHeaders];
          res.on('data',chunk=>{
            received+=chunk.length;
            if(received>maximumResponseBytes){
              finish({code:'GRIDFABRIC_RESPONSE_LIMIT',message:'The original response exceeds this owner’s selected complete-response allowance.'});
              res.destroy();req.destroy();return;
            }
            chunks.push(Buffer.from(chunk));
          });
          res.on('end',()=>{complete=res.complete===true;finish(complete?null:{code:'GRIDFABRIC_RESPONSE_INTERRUPTED',message:'The original HTTP response did not complete.'});});
          res.on('aborted',()=>finish({code:'GRIDFABRIC_RESPONSE_INTERRUPTED',message:'The original HTTP response ended before completion.'}));
          res.on('error',error=>finish(errorView(error)));
        });
      req.on('error',error=>finish(errorView(error)));
      timer=setTimeout(()=>{
        finish({code:'GRIDFABRIC_DISPATCH_TIMEOUT',message:'The original dispatch did not return within its selected time allowance.'});
        req.destroy();
      },timeoutMilliseconds);
      req.end(prepared.body);
    } catch(error) {finish({...errorView(error),phase:'BEFORE_TRANSPORT'});}
  });
}
export async function openGridFabricWorkspace({directory,create=false,name='GridFabric Plaid workspace',
  environment=process.env,timeoutMilliseconds=120000,maximumResponseBytes=64*1024*1024}={}) {
  if(!Number.isSafeInteger(timeoutMilliseconds)||timeoutMilliseconds<1000||timeoutMilliseconds>600000||
     !Number.isSafeInteger(maximumResponseBytes)||maximumResponseBytes<1024||maximumResponseBytes>256*1024*1024)
    throw fail('GRIDFABRIC_TRANSPORT_CONFIGURATION','Use a 1–600 second timeout and a complete-response allowance from 1 KiB to 256 MiB.');
  if(existsSync(join(directory,'.gridfabric-restore.json')))throw fail('GRIDFABRIC_RESTORE_IN_PROGRESS','Resume the original portable restoration before opening this workspace.');
  const store=await openGridFabricStore({directory,create});
  let closing=false,closed=false;const active=new Set();
  try {
    const vault=createGridFabricFiles({directory:store.directory,assertHeld:store.assertHeld});
    const files={...vault,put(text,metadata={}){
      const result=vault.put(text,metadata),prior=store.get('host_files',result.sha256);
      const names=prior?.names||[];
      if(!names.some(item=>item.name===result.name&&item.mime_type===result.mime_type))
        names.push({name:result.name,mime_type:result.mime_type});
      store.put('host_files',result.sha256,{...result,names,created_at:prior?.created_at||now()},
        {scope:'',sort:prior?.created_at||now(),tag:'UTF8'});
      return result;
    }};
    const engine=createEngine({store,files,sha256Utf8,now,newId:randomUUID,publicContract});
    if(create)engine.initialize({name});
    const initial=engine.state();
    if(!initial?.workspace_id)throw fail('GRIDFABRIC_WORKSPACE_ID','The original workspace has no logical identity.');
    const assertOpen=()=>{if(closing||closed)throw fail('GRIDFABRIC_WORKSPACE_CLOSING','The original owner is draining.');store.assertHeld();};
    const state=()=>{assertOpen();return engine.state();};
    const dispatchCurrent=(kind,id)=>recordOf(engine.detail(dispatchKinds[kind].table,id));
    const dispatch=async(kind,input,{request_id,expected_revision,beforeDispatch=async()=>{}}={})=>{
      assertOpen();validateRequest(request_id,expected_revision);
      const spec=dispatchKinds[kind];if(!spec)throw fail('GRIDFABRIC_DISPATCH_KIND','Choose the original management or device operation.');
      const id=input?.[spec.id];
      if(typeof id!=='string'||!id)throw fail('GRIDFABRIC_DISPATCH_ID','Select the original operation identity.');
      const fingerprint=digest({kind,input:{[spec.id]:id},expected_revision});
      const previous=store.get('host_dispatches',request_id);
      if(previous&&previous.fingerprint!==fingerprint)
        throw fail('GRIDFABRIC_REQUEST_CONFLICT','This request UUID already names a different original dispatch.');
      if(previous?.status==='COMPLETE')return {...previous.result,host_dispatch:previous,replayed:true};
      const finishRetained=entry=>{
        if(!entry.receipt)return {workspace_id:engine.state().workspace_id,revision:engine.state().revision,
          request_id,replayed:true,dispatch_status:entry.status,operation:dispatchCurrent(kind,id),host_dispatch:entry};
        return store.transaction(()=>{
          const current=store.get('host_dispatches',request_id);
          if(current.status==='COMPLETE')return {...current.result,host_dispatch:current,replayed:true};
          const receipt=JSON.parse(files.read(current.receipt.sha256));
          const payload={[spec.id]:id,attempt_id:current.captured.attempt_id,
            http_status:receipt.http_status,headers:receipt.headers,body_utf8:receipt.body_utf8??'',
            ...(receipt.transport_error?{transport_error:receipt.transport_error}:{})};
          const result=engine.execute(spec.finish,payload,
            {request_id:current.finish_request_id,expected_revision:engine.state().revision});
          const completed={...current,status:'COMPLETE',completed_at:now(),result};
          store.put('host_dispatches',request_id,completed,{scope:id,sort:completed.created_at,tag:completed.status});
          return {...result,host_dispatch:completed};
        });
      };
      if(previous)return finishRetained(previous);
      // Plaid serializes callbacks. Never call its management listener from a callback transaction or before its response drains.
      await beforeDispatch();assertOpen();
      let captured,entry;
      const replayResult=store.transaction(()=>{
        const raced=store.get('host_dispatches',request_id);
        if(raced)throw fail('GRIDFABRIC_DISPATCH_IN_PROGRESS','The same original dispatch is already in progress.');
        captured=engine.execute(spec.begin,{[spec.id]:id},{request_id,expected_revision});
        if(captured.replayed===true)
          return {workspace_id:engine.state().workspace_id,revision:engine.state().revision,request_id,
            replayed:true,dispatch_status:'ORIGINAL_BEGIN_REPLAYED',operation:dispatchCurrent(kind,id)};
        entry={schema:'stellar-forge.gridfabric-host-dispatch.v1',request_id,kind,operation_id:id,fingerprint,
          expected_revision,created_at:now(),status:'CAPTURED',captured,finish_request_id:randomUUID(),receipt:null};
        store.put('host_dispatches',request_id,entry,{scope:id,sort:entry.created_at,tag:entry.status});
        return null;
      });
      if(replayResult)return replayResult;
      // Only this invocation's fresh begin may cross the network boundary.
      entry={...entry,status:'DISPATCHING',dispatch_started_at:now()};
      store.transaction(()=>store.put('host_dispatches',request_id,entry,{scope:id,sort:entry.created_at,tag:entry.status}));
      const receipt=await performRequest(captured,environment,{timeoutMilliseconds,maximumResponseBytes});
      const saved=store.transaction(()=>{
        const original=store.get('host_dispatches',request_id);
        if(original.status!=='DISPATCHING'||original.captured.attempt_id!==captured.attempt_id)
          throw fail('GRIDFABRIC_DISPATCH_CHANGED','The original in-flight attempt changed.');
        const receiptFile=files.put(JSON.stringify({...receipt,operation_id:id,attempt_id:captured.attempt_id,
          request_body_sha256:captured.request_body_sha256},null,2)+'\n',
          {name:'dispatch-'+captured.attempt_id+'.json',mime_type:'application/json'});
        const received={...original,status:'RECEIVED',receipt:receiptFile,received_at:receipt.received_at};
        store.put('host_dispatches',request_id,received,{scope:id,sort:received.created_at,tag:received.status});
        return received;
      });
      return finishRetained(saved);
    };
    const trackedDispatch=(kind,input,options)=>{
      assertOpen();const promise=dispatch(kind,input,options);active.add(promise);
      promise.then(()=>active.delete(promise),()=>active.delete(promise));return promise;
    };
    return {
      directory:store.directory,workspace_id:initial.workspace_id,store,files,engine,publicContract,
      state,
      page(collection,options={}){assertOpen();return engine.page(collection,options);},
      detail(collection,id){assertOpen();return engine.detail(collection,id);},
      execute(action,input,options){assertOpen();return engine.execute(action,input,options);},
      upload(text,metadata){assertOpen();return store.transaction(()=>files.put(text,metadata));},
      handleCallback(instanceId,rawUtf8,options){assertOpen();return engine.handleCallback(instanceId,rawUtf8,options);},
      dispatchManagement:(input,options)=>trackedDispatch('management',input,options),
      dispatchDevice:(input,options)=>trackedDispatch('device',input,options),
      hostOperation(requestId){assertOpen();return store.get('host_dispatches',requestId);},
      fileMetadata(id){assertOpen();return store.get('host_files',id);},
      hostPage(table,options={}) {
        assertOpen();if(!['host_files','host_dispatches'].includes(table))throw fail('GRIDFABRIC_HOST_COLLECTION','Select an original host collection.');
        const offset=options.offset??0,limit=options.limit??100,total=store.count(table,options);
        return {collection:table,total,offset,limit,next_offset:offset+limit<total?offset+limit:null,
          rows:store.scan(table,options).map(row=>({id:row.id,...row.data}))};
      },
      async close(){
        if(closed)return;closing=true;await Promise.allSettled([...active]);await store.close();closed=true;
      }
    };
  } catch(error) {await store.close();throw error;}
}

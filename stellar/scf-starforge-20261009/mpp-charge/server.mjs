// MIT. Private industrial operator workspace and a separate loopback merchant listener.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDirectory } from '../distribution/runtime-workspace/storage.mjs';
import { openWorkspace, requireValue, now, json } from './storage.mjs';
import { merchantConfig, buyerConfig, MAX_BODY, absolute, envName } from './config.mjs';
import { createMerchant, storedResponse } from './merchant.mjs';
import { preparePurchase, executePurchase, finalizePurchase, purchaseView } from './buyer.mjs';
import { versions } from './runtime.mjs';
import { merchantContract, contractOpenAPI } from './customer/contract.mjs';
import { createCustomerBundle } from './customer/export.mjs';
import { createCustomerWorkbench, customerWorkbenchProfile } from './customer/workbench.mjs';

const uiRoot=new URL('./public/',import.meta.url);
// A full native customer bundle is up to 2 MiB; control requests include its JSON envelope.
const MAX_CONSOLE_BODY=3*1024*1024;
function portNumber(value) {
  requireValue(Number.isInteger(value) && value>=0 && value<=65535,'MPP_PORT_INVALID'); return value;
}
async function readBody(request,maximum=MAX_BODY) {
  const chunks=[];let length=0;
  for await(const chunk of request) {
    length+=chunk.length;requireValue(length<=maximum,'MPP_REQUEST_TOO_LARGE',413);chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function send(response,output) {
  response.statusCode=output.status;
  for(const [name,value] of output.headers) response.setHeader(name,value);
  if(output.body) {
    const reader=output.body.getReader();
    try {
      while(true) {
        const chunk=await reader.read();if(chunk.done) break;
        if(!response.write(Buffer.from(chunk.value))) await new Promise(resolve=>response.once('drain',resolve));
      }
    } finally {reader.releaseLock();}
  }
  response.end();
}
function errorResponse(error) {
  return Response.json({error:error.code??'MPP_OPERATION_FAILED'},{
    status:Number.isInteger(error.status)?error.status:500,headers:{'cache-control':'no-store'}});
}
export async function serveMerchant({workspace,profile,port=8788,environment=process.env}) {
  const merchant=await createMerchant({workspace,profile,environment});
  let listeningPort=portNumber(port);
  const server=createServer({maxHeaderSize:65536},async(request,response)=>{
    try {
      requireValue(typeof request.url==='string' && request.url.startsWith('/') && !request.url.startsWith('//') &&
        ['127.0.0.1:'+listeningPort,new URL(merchant.config.publicOrigin).host].includes(request.headers.host),
        'MPP_MERCHANT_HOST_INVALID');
      const url=new URL(request.url,merchant.config.publicOrigin);
      requireValue(url.origin===merchant.config.publicOrigin,'MPP_MERCHANT_ORIGIN_INVALID');
      if(request.method==='GET' && url.pathname==='/_mpp/health') {
        await send(response,Response.json({status:'ready',title:merchant.config.title,profileId:merchant.profileId}));return;
      }
      if(request.method==='GET' && ['/_mpp/contract','/_mpp/openapi.json'].includes(url.pathname)) {
        const contract=merchantContract(merchant.config);
        const document=url.pathname==='/_mpp/contract'?contract:contractOpenAPI(contract);
        await send(response,Response.json(document,{headers:{'etag':'"'+contract.sha256+'"',
          'cache-control':'public, max-age=0, must-revalidate','x-content-type-options':'nosniff'}}));return;
      }
      if(request.method==='GET' && url.pathname==='/_mpp/offers') {
        await send(response,Response.json({schema:'stellar-forge.mpp-offers.v1',title:merchant.config.title,
          offers:merchant.config.routes.map(route=>({id:route.id,method:route.method,
            url:merchant.config.publicOrigin+route.path,description:route.description,payment:route.payment}))}));return;
      }
      const body=await readBody(request);
      const headers=new Headers();
      for(const [name,value] of Object.entries(request.headers)) if(typeof value==='string') headers.set(name,value);
      const nativeRequest=new Request(url,{method:request.method,headers,
        ...(!['GET','HEAD'].includes(request.method) && (body.length || request.headers['content-length']==='0')?{body}:{})});
      await send(response,await merchant.handle(nativeRequest));
    } catch(error){if(!response.headersSent) await send(response,errorResponse(error));else response.destroy();}
  });
  server.requestTimeout=360000;server.headersTimeout=30000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(listeningPort,'127.0.0.1',resolve);});
  listeningPort=server.address().port;
  return {merchant,port:listeningPort,close:async()=>{
    await new Promise(resolve=>server.close(resolve));await merchant.drain();
  }};
}
function deliveryView(row) {
  return {id:row.id,state:row.state,routeId:row.routeId,profileId:row.profileId,url:row.url,method:row.method,
    createdAt:row.createdAt,updatedAt:row.updatedAt,payer:row.payer,transaction:row.transaction,receipt:row.receipt,
    failure:row.failure,response:row.response?{status:row.response.status,bytes:row.response.bytes,sha256:row.response.sha256}:null};
}
export async function exportResponse({workspace,group='purchases',recordId,destination}) {
  requireValue(['purchases','deliveries'].includes(group),'MPP_EXPORT_GROUP_INVALID');
  const record=await workspace.read(group,recordId);
  requireValue(record?.response,'MPP_RESPONSE_UNAVAILABLE',404);
  const response=storedResponse(record.response),bytes=Buffer.from(await response.arrayBuffer());
  absolute(destination);await privateDirectory(dirname(destination));
  const handle=await open(destination,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  return {path:destination,bytes:bytes.length,sha256:record.response.sha256,status:record.response.status};
}
export async function serveWorkspace({directory,port=8787,environment=process.env,tokenEnv}) {
  const token=tokenEnv===undefined?randomBytes(32).toString('hex'):environment[envName(tokenEnv)];
  requireValue(typeof token==='string' && /^[a-f0-9]{64}$/.test(token),'MPP_WORKSPACE_TOKEN_INVALID');
  const workspace=await openWorkspace(directory);
  const customerWorkbench=createCustomerWorkbench({workspace,environment});
  const tokenBytes=Buffer.from(token);
  const jobs=new Map();let merchantServer=null,merchantTransition=false,origin,closePromise;
  function authorized(request) {
    requireValue(request.headers.authorization?.startsWith('Bearer '),'MPP_WORKSPACE_AUTH_REQUIRED',401);
    const candidate=Buffer.from(request.headers.authorization.slice(7));
    requireValue(candidate.length===tokenBytes.length && timingSafeEqual(candidate,tokenBytes),'MPP_WORKSPACE_AUTH_REQUIRED',401);
    requireValue(!request.headers.origin || request.headers.origin===origin,'MPP_WORKSPACE_ORIGIN_INVALID',403);
  }
  async function identity() {
    const metadata=await workspace.metadata();
    return {schema:'stellar-forge.mpp-console-identity.v1',pid:process.pid,ppid:process.ppid,origin,
      workspace:workspace.root,createdAt:metadata.createdAt,versions};
  }
  async function snapshot() {
    return {schema:'stellar-forge.mpp-console.v1',metadata:await workspace.metadata(),versions,
      profiles:{merchant:await workspace.profile('merchant'),buyer:await workspace.profile('buyer'),
        customer:await workspace.profile('customer')},
      customerWorkbench:await customerWorkbench.snapshot(),
      merchant:merchantServer?{port:merchantServer.port,profileId:merchantServer.merchant.profileId,
        active:merchantServer.merchant.active()}:null,
      purchases:(await workspace.list('purchases')).map(purchaseView),
      deliveries:(await workspace.list('deliveries')).map(deliveryView),
      jobs:[...jobs.values()].map(({promise,...job})=>job)};
  }
  function startJob(kind,work) {
    requireValue([...jobs.values()].filter(job=>job.state==='RUNNING').length<8,'MPP_OPERATOR_QUEUE_FULL',409);
    const job={id:randomUUID(),kind,state:'RUNNING',createdAt:now()};
    jobs.set(job.id,job);
    job.promise=Promise.resolve().then(work).then(
      result=>{job.state='COMPLETE';job.result=result;job.updatedAt=now();},
      error=>{job.state='FAILED';job.error=error.code??'MPP_OPERATION_FAILED';job.updatedAt=now();}
    );
    return {id:job.id,state:job.state};
  }
  const server=createServer({maxHeaderSize:16384},async(request,response)=>{
    try {
      requireValue(request.headers.host===new URL(origin).host,'MPP_WORKSPACE_HOST_INVALID',403);
      const url=new URL(request.url,origin);
      requireValue(url.origin===origin,'MPP_WORKSPACE_ORIGIN_INVALID',403);
      if(request.method==='GET' && ['/','/app.js','/customer-workbench.js','/style.css'].includes(url.pathname)) {
        const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
        const body=await readFile(new URL(name,uiRoot));
        await send(response,new Response(body,{headers:{
          'content-type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store'
        }}));return;
      }
      authorized(request);
      if(request.method==='GET' && url.pathname==='/api/identity') {
        await send(response,Response.json(await identity(),{headers:{'cache-control':'no-store'}}));return;
      }
      const jobPath=/^\/api\/jobs\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(request.method==='GET' && jobPath) {
        const job=jobs.get(jobPath[1]);requireValue(job,'MPP_JOB_NOT_FOUND',404);
        const {promise,...observation}=job;
        await send(response,Response.json(observation,{headers:{'cache-control':'no-store'}}));return;
      }
      if(request.method==='GET' && url.pathname==='/api/state') {await send(response,Response.json(await snapshot()));return;}
      if(request.method==='GET' && ['/api/customer','/api/customer/contract','/api/customer/openapi','/api/customer/package'].includes(url.pathname)) {
        requireValue([...url.searchParams.keys()].every(key=>key==='profileId') &&
          url.searchParams.getAll('profileId').length<=1,'MPP_CUSTOMER_SELECTION_INVALID');
        const profile=merchantServer?.merchant.config??await workspace.profile('merchant');
        requireValue(profile,'MPP_MERCHANT_PROFILE_REQUIRED',409);
        const contract=merchantContract(profile),selected=url.searchParams.get('profileId');
        requireValue(!selected || selected===contract.profileId,'MPP_CUSTOMER_PROFILE_CHANGED',409);
        const profileSource=merchantServer?'active':'saved';
        if(url.pathname==='/api/customer') {
          await send(response,Response.json({profileSource,contract,publicContract:contract.origin+'/_mpp/contract',
            publicOpenAPI:contract.origin+'/_mpp/openapi.json'},{headers:{'cache-control':'no-store'}}));return;
        }
        const kind=url.pathname.split('/').at(-1);
        const document=kind==='contract'?contract:kind==='openapi'?contractOpenAPI(contract):
          await createCustomerBundle({contract});
        const name='mpp-'+kind+'-'+contract.sha256.slice(0,12)+'.json';
        await send(response,new Response(json(document),{headers:{'content-type':'application/json; charset=utf-8',
          'content-disposition':'attachment; filename="'+name+'"','cache-control':'private, no-store',
          'x-content-type-options':'nosniff'}}));return;
      }
      if(request.method==='GET' && url.pathname==='/api/customer-workbench') {
        requireValue([...url.searchParams.keys()].every(key=>['offset','limit'].includes(key)) &&
          [...url.searchParams.keys()].every(key=>url.searchParams.getAll(key).length===1),
          'MPP_CUSTOMER_LIST_OPTIONS_INVALID');
        await send(response,Response.json(await customerWorkbench.snapshot({
          offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??50)
        }),{headers:{'cache-control':'no-store'}}));return;
      }
      const customerPurchasePath=/^\/api\/customer-workbench\/purchases\/([^/]+)$/.exec(url.pathname);
      if(request.method==='GET' && customerPurchasePath) {
        await send(response,Response.json(await customerWorkbench.inspect(decodeURIComponent(customerPurchasePath[1])),
          {headers:{'cache-control':'no-store'}}));return;
      }
      const customerResourcePath=/^\/api\/customer-workbench\/purchases\/([^/]+)\/(preview|response|file)$/.exec(url.pathname);
      if(request.method==='GET' && customerResourcePath) {
        const purchaseId=decodeURIComponent(customerResourcePath[1]);
        if(customerResourcePath[2]==='file') {
          requireValue([...url.searchParams.keys()].every(key=>['expectedSha256','offset','limit'].includes(key)) &&
            [...url.searchParams.keys()].every(key=>url.searchParams.getAll(key).length===1),
            'MPP_CUSTOMER_RESPONSE_RANGE_INVALID');
          await send(response,Response.json(await customerWorkbench.resourceChunk({
            purchaseId,expectedSha256:url.searchParams.get('expectedSha256'),
            offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??49152)
          }),{headers:{'cache-control':'private, no-store'}}));return;
        }
        if(customerResourcePath[2]==='preview') {
          await send(response,Response.json(await customerWorkbench.resourcePreview(purchaseId),
            {headers:{'cache-control':'no-store'}}));return;
        }
        const resource=await customerWorkbench.resource(purchaseId);
        await send(response,new Response(resource.response.body,{headers:{
          'content-type':'application/octet-stream',
          'content-disposition':'attachment; filename="mpp-'+purchaseId+'.bin"',
          'x-content-type-options':'nosniff','cache-control':'private, no-store',
          'x-mpp-resource-sha256':resource.sha256,'x-mpp-transaction':resource.transaction
        }}));return;
      }
      const download=/^\/api\/(purchases|deliveries)\/([^/]+)\/response$/.exec(url.pathname);
      if(request.method==='GET' && download) {
        const recordId=decodeURIComponent(download[2]);
        let output;
        if(download[1]==='purchases' && await customerWorkbench.isCustomerPurchase(recordId)) {
          output=(await customerWorkbench.resource(recordId)).response;
        } else {
          const record=await workspace.read(download[1],recordId);
          requireValue(record?.response,'MPP_RESPONSE_UNAVAILABLE',404);
          output=storedResponse(record.response);
        }
        await send(response,new Response(output.body,{headers:{
          'content-type':'application/octet-stream','content-disposition':'attachment; filename="response.bin"',
          'x-content-type-options':'nosniff','cache-control':'no-store'
        }}));return;
      }
      requireValue(request.method==='POST' && request.headers['content-type']?.split(';')[0]==='application/json',
        'MPP_JSON_POST_REQUIRED',405);
      const body=JSON.parse((await readBody(request,MAX_CONSOLE_BODY)).toString('utf8'));
      let result;
      if(url.pathname==='/api/customer-workbench/intake') {
        result=await customerWorkbench.intake(body.document);
      } else if(url.pathname==='/api/customer-workbench/fetch') {
        result=await customerWorkbench.fetch(body);
      } else if(url.pathname==='/api/customer-workbench/review') {
        result=await customerWorkbench.review(body);
      } else if(url.pathname==='/api/customer-workbench/configure') {
        result=await customerWorkbench.configure(body);
      } else if(url.pathname==='/api/customer-workbench/preview') {
        result=await customerWorkbench.preview(body);
      } else if(url.pathname==='/api/customer-workbench/refresh') {
        result=await customerWorkbench.refresh(body);
      } else if(url.pathname==='/api/customer-workbench/prepare') {
        result=startJob('Prepare customer purchase',()=>customerWorkbench.prepare(body));
      } else if(url.pathname==='/api/customer-workbench/retry-prepare') {
        result=startJob('Retry original customer preparation',()=>customerWorkbench.retryPreparation(body.id));
      } else if(['/api/customer-workbench/execute','/api/customer-workbench/resume',
        '/api/customer-workbench/finalize'].includes(url.pathname)) {
        const operation=url.pathname.split('/').at(-1);
        result=startJob(operation==='execute'?'Execute customer purchase':operation==='resume'?
          'Recover customer purchase':'Reconcile customer purchase',
          ()=>customerWorkbench.action(body.id,operation));
      } else if(url.pathname==='/api/profile') {
        requireValue(!(merchantServer || merchantTransition) || body.kind!=='merchant','MPP_STOP_MERCHANT_TO_EDIT',409);
        const profile=body.kind==='merchant'?merchantConfig(body.profile):body.kind==='customer'?
          customerWorkbenchProfile(body.profile,workspace.root):buyerConfig(body.profile);
        result=await workspace.configure(body.kind,profile,body.revision);
      } else if(url.pathname==='/api/merchant/start') {
        requireValue(!merchantServer && !merchantTransition,'MPP_MERCHANT_ALREADY_RUNNING',409);
        merchantTransition=true;
        try {
          const profile=await workspace.profile('merchant');requireValue(profile,'MPP_MERCHANT_PROFILE_REQUIRED');
          merchantServer=await serveMerchant({workspace,profile,port:portNumber(body.port??8788),environment});
          result={port:merchantServer.port,profileId:merchantServer.merchant.profileId};
        } finally {merchantTransition=false;}
      } else if(url.pathname==='/api/merchant/stop') {
        requireValue(merchantServer && !merchantTransition,'MPP_MERCHANT_NOT_RUNNING',409);
        merchantTransition=true;
        try {await merchantServer.close();merchantServer=null;result={status:'STOPPED'};}
        finally {merchantTransition=false;}
      } else if(url.pathname==='/api/purchase/prepare') {
        const profile=await workspace.profile('buyer');requireValue(profile,'MPP_BUYER_PROFILE_REQUIRED');
        result=startJob('Prepare purchase',()=>preparePurchase({workspace,profile,challengeId:body.challengeId}));
      } else if(url.pathname==='/api/purchase/execute') {
        result=startJob('Execute purchase',async()=>await customerWorkbench.isCustomerPurchase(body.id)?
          customerWorkbench.action(body.id,'execute'):executePurchase({workspace,purchaseId:body.id,environment,resume:false}));
      } else if(url.pathname==='/api/purchase/resume') {
        result=startJob('Recover purchase',async()=>await customerWorkbench.isCustomerPurchase(body.id)?
          customerWorkbench.action(body.id,'resume'):executePurchase({workspace,purchaseId:body.id,environment,resume:true}));
      } else if(url.pathname==='/api/purchase/finalize') {
        result=startJob('Reconcile transfer',async()=>await customerWorkbench.isCustomerPurchase(body.id)?
          customerWorkbench.action(body.id,'finalize'):finalizePurchase({workspace,purchaseId:body.id,environment}));
      } else if(url.pathname==='/api/delivery/recover') {
        result=startJob('Recover delivery',async()=>{
          const row=await workspace.read('deliveries',body.id);
          requireValue(row,'MPP_DELIVERY_NOT_FOUND',404);
          const profile=await workspace.read('profiles',row.profileId);
          requireValue(profile,'MPP_ORIGINAL_MERCHANT_PROFILE_REQUIRED',409);
          const merchant=await createMerchant({workspace,profile,environment});
          return deliveryView(await merchant.recover(body.id));
        });
      } else requireValue(false,'MPP_WORKSPACE_ROUTE_NOT_FOUND',404);
      await send(response,Response.json(result,{status:202,headers:{'cache-control':'no-store'}}));
    } catch(error){if(!response.headersSent) await send(response,errorResponse(error));else response.destroy();}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(portNumber(port),'127.0.0.1',resolve);});
    origin='http://127.0.0.1:'+server.address().port;
    const initialIdentity=await identity(),privateUrl=origin+'/#'+token;
    const readiness=Object.freeze({schema:'stellar-forge.mpp-console-ready.v1',
      pid:process.pid,ppid:process.ppid,origin,privateUrl,workspace:workspace.root,createdAt:initialIdentity.createdAt,
      versions,tokenEnv:tokenEnv??null});
    return {workspace,url:privateUrl,origin,snapshot,identity,readiness,close:()=>{
      if(!closePromise)closePromise=(async()=>{
        await new Promise(resolve=>server.close(resolve));
        await Promise.allSettled([...jobs.values()].map(job=>job.promise));
        try{await merchantServer?.close();}finally{await workspace.close();}
      })();
      return closePromise;
    }};
  } catch(error){
    await new Promise(resolve=>server.close(()=>resolve()));
    await workspace.close();throw error;
  }
}

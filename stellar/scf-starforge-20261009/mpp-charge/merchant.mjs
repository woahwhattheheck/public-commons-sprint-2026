// MIT. Native Stellar MPP merchant, immutable scope, paid-response recovery.
import { AsyncLocalStorage } from 'node:async_hooks';
import { pathToFileURL } from 'node:url';
import { regular } from '../distribution/runtime-workspace/storage.mjs';
import { merchantConfig, bindingFacts, humanAmount, MAX_BODY } from './config.mjs';
import { hash, stable, now, requireValue } from './storage.mjs';
import { loadNative } from './runtime.mjs';
import { transactionIdentity, observeTransfer } from './transfer.mjs';

const workspaceOperations=new WeakMap();

export async function responseRecord(response,limit=MAX_BODY) {
  requireValue(response instanceof Response,'MPP_RESPONSE_REQUIRED');
  const reader=response.body?.getReader(), chunks=[]; let length=0;
  try {
    if(reader) while(true) {
      const part=await reader.read(); if(part.done) break;
      length+=part.value.byteLength;
      requireValue(length<=limit,'MPP_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(part.value));
    }
  } catch(error) { await reader?.cancel().catch(()=>{}); throw error; }
  const body=Buffer.concat(chunks);
  const headers=Object.fromEntries([...response.headers].filter(([name])=>
    ['content-type','content-disposition','payment-receipt','cache-control','www-authenticate'].includes(name)));
  return {status:response.status,headers,bodyBase64:body.toString('base64'),bytes:length,sha256:hash(body)};
}
export function storedResponse(saved) {
  const bytes=Buffer.from(saved.bodyBase64,'base64');
  requireValue(bytes.length===saved.bytes && hash(bytes)===saved.sha256,'MPP_RETAINED_RESPONSE_CHANGED',500);
  return new Response([204,205,304].includes(saved.status)?null:bytes,{status:saved.status,headers:saved.headers});
}
export async function createMerchant({workspace,profile,environment=process.env}) {
  const config=merchantConfig(profile), profileId=hash(stable(config));
  const secret=environment[config.secretEnv];
  requireValue(typeof secret === 'string' && Buffer.byteLength(secret)>=32,'MPP_MERCHANT_HMAC_SECRET_REQUIRED');
  const native=await loadNative(config.dependencyRoot);
  const paymentContext=new AsyncLocalStorage();
  const associate=(key,value,current) => {
    if(!key.startsWith('stellar:charge:')) return value;
    const deliveryId=paymentContext.getStore();
    requireValue(typeof deliveryId==='string' &&
      (!current?.merchantDeliveryId || current.merchantDeliveryId===deliveryId),
      'MPP_NATIVE_CLAIM_OWNER_MISMATCH',409);
    return {...value,merchantDeliveryId:deliveryId};
  };
  // Attach delivery ownership INSIDE each native atomic claim. The SDK still
  // owns replay/settlement state; recovery cannot borrow another request's hash.
  const nativeStore={
    get:workspace.sdkStore.get,delete:workspace.sdkStore.delete,
    put:(key,value)=>workspace.sdkStore.update(key,current=>({
      op:'set',value:associate(key,value,current),result:undefined
    })),
    update:(key,fn)=>workspace.sdkStore.update(key,current=>{
      const change=fn(current);
      return change.op==='set'?{...change,value:associate(key,change.value,current)}:change;
    })
  };
  const handlers=config.handlersModule ? await import(pathToFileURL(config.handlersModule).href) : {};
  const routes=new Map(config.routes.map(route=>{
    if(route.resource.kind==='handler') requireValue(typeof handlers[route.resource.export]==='function','MPP_HANDLER_UNAVAILABLE');
    const method=native.stellarServer.stellar.charge({
      currency:route.payment.currency,recipient:route.payment.recipient,network:route.payment.network,
      decimals:route.payment.decimals,store:nativeStore,
      challengeLifetimeSeconds:config.lifetimeSeconds,...(config.rpcUrl?{rpcUrl:config.rpcUrl}:{})
    });
    const mpp=native.server.Mppx.create({realm:new URL(config.publicOrigin).hostname,secretKey:secret,methods:[method]});
    return [route.method+' '+route.path,{route,mpp}];
  }));
  if(!workspaceOperations.has(workspace)) workspaceOperations.set(workspace,{running:new Map(),scopes:new Map()});
  const {running,scopes:runningScopes}=workspaceOperations.get(workspace);
  if(!await workspace.read('profiles',profileId)) await workspace.put('profiles',profileId,config);
  async function resource(row) {
    const route=config.routes.find(r=>r.id===row.routeId);
    requireValue(route && row.profileId===profileId,'MPP_DELIVERY_PROFILE_CHANGED',409);
    let result;
    if(route.resource.kind==='json') result=Response.json(route.resource.value);
    else if(route.resource.kind==='json-file') {
      const bytes=await regular(route.resource.path,MAX_BODY);
      JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
      result=new Response(bytes,{headers:{'content-type':'application/json; charset=utf-8'}});
    } else result=await handlers[route.resource.export]({
      operationId:row.id,request:new Request(row.url,{method:row.method,
        ...(row.bodyPresent?{body:Buffer.from(row.requestBodyBase64,'base64')}:{})}),
      payment:{receipt:row.receipt,transaction:row.transaction,payer:row.payer,
        challenge:structuredClone(row.challenge)},signal:AbortSignal.timeout(120000)
    });
    if(!(result instanceof Response)) result=Response.json(result);
    requireValue(result.status>=200 && result.status<300,'MPP_RESOURCE_HANDLER_FAILED',502);
    const headers=new Headers(result.headers);
    headers.set('payment-receipt',row.receiptHeader); headers.set('cache-control','private, no-store');
    return new Response(result.body,{status:result.status,headers});
  }
  async function deliver(row) {
    const delivering={...row,state:'DELIVERING',updatedAt:now()};
    await workspace.put('deliveries',row.id,delivering);
    try {
      const saved=await responseRecord(await resource(delivering));
      const complete={...delivering,state:'COMPLETE',response:saved,updatedAt:now()};
      await workspace.put('deliveries',row.id,complete);
      return storedResponse(saved);
    } catch(error) {
      await workspace.put('deliveries',row.id,{...delivering,state:'DELIVERY_FAILED',
        failure:error.code??'MPP_RESOURCE_EXECUTION_FAILED',updatedAt:now()});
      return Response.json({operationId:row.id,status:'DELIVERY_FAILED'},{
        status:503,headers:{'payment-receipt':row.receiptHeader,'cache-control':'private, no-store'}});
    }
  }
  async function execute(request,bytes,selected,key,credential) {
    const facts=bindingFacts({url:request.url,method:request.method},bytes);
    const scope=hash(stable({schema:'stellar-forge.mpp-scope.v1',profileId,route:selected.route.id,...facts}));
    const old=key?await workspace.read('deliveries',key):null;
    if(old) {
      requireValue(old.scope===scope,'MPP_DELIVERY_SCOPE_MISMATCH',409);
      if(old.state==='COMPLETE') return storedResponse(old.response);
      return Response.json({operationId:key,status:old.state,transaction:old.transaction},
        {status:202,headers:{'cache-control':'private, no-store',...(old.receiptHeader?{'payment-receipt':old.receiptHeader}:{})}});
    }
    let row;
    if(credential) {
      requireValue(native.Challenge.verify(credential.challenge,{secretKey:secret}),'MPP_CHALLENGE_SIGNATURE_INVALID',402);
      const meta=credential.challenge.opaque
        ? JSON.parse(Buffer.from(credential.challenge.opaque,'base64url').toString('utf8'))
        : credential.challenge.meta;
      requireValue(meta?._mppx_scope===scope,'MPP_DELIVERY_SCOPE_MISMATCH',402);
      const identity=transactionIdentity(native,credential);
      row={schema:'stellar-forge.mpp-delivery.v1',id:key,state:'VERIFYING',profileId,routeId:selected.route.id,
        scope,...facts,requestBodyBase64:bytes?.toString('base64')??null,
        challenge:credential.challenge,credentialHeader:request.headers.get('authorization'),
        ...identity,createdAt:now(),updatedAt:now()};
      await workspace.put('deliveries',key,row);
    }
    const result=await selected.mpp.charge({
      amount:humanAmount(selected.route.payment.amountAtomic,selected.route.payment.decimals),
      description:selected.route.description,externalId:scope,scope,
      expires:new Date(Date.now()+config.lifetimeSeconds*1000).toISOString()
    })(request);
    if(result.status===402) {
      if(row) await workspace.put('deliveries',key,{...row,state:'VERIFICATION_FAILED',updatedAt:now(),
        nativeChallengeState:await workspace.sdkStore.get('stellar:charge:challenge:'+credential.challenge.id)});
      return result.challenge;
    }
    requireValue(row,'MPP_AUTHENTICATED_DELIVERY_REQUIRED',500);
    const receiptResponse=await result.withReceipt(new Response(null));
    const receipt=native.Receipt.fromResponse(receiptResponse);
    requireValue(receipt?.method==='stellar' && receipt.status==='success' &&
      receipt.reference?.toLowerCase()===row.transaction,'MPP_NATIVE_RECEIPT_IDENTITY_MISMATCH',502);
    row={...row,state:'SETTLED',receipt,receiptHeader:receiptResponse.headers.get('payment-receipt'),updatedAt:now()};
    await workspace.put('deliveries',key,row);
    return deliver(row);
  }
  async function handle(request) {
    requireValue(request instanceof Request && new URL(request.url).origin===config.publicOrigin,'MPP_PUBLIC_ORIGIN_MISMATCH');
    const url=new URL(request.url);
    const raw=await request.clone().arrayBuffer();
    requireValue(raw.byteLength<=MAX_BODY,'MPP_REQUEST_TOO_LARGE',413);
    const bytes=request.body===null?null:Buffer.from(raw);
    const authorization=request.headers.get('authorization');
    requireValue(!authorization || authorization.length<=65536 && /^Payment [A-Za-z0-9_-]+$/.test(authorization),
      'MPP_PAYMENT_CREDENTIAL_INVALID');
    let credential=null,key=null;
    if(authorization) {
      credential=native.Credential.deserialize(authorization);
      key=hash(authorization);
      const historical=await workspace.read('deliveries',key);
      if(historical) {
        const scope=hash(stable({schema:'stellar-forge.mpp-scope.v1',profileId:historical.profileId,route:historical.routeId,
          ...bindingFacts({url:request.url,method:request.method},bytes)}));
        requireValue(historical.scope===scope,'MPP_DELIVERY_SCOPE_MISMATCH',409);
        if(running.has(key)) return storedResponse(await running.get(key));
        if(historical.state==='COMPLETE') return storedResponse(historical.response);
        return Response.json({operationId:key,status:historical.state,transaction:historical.transaction},{
          status:202,headers:{'cache-control':'private, no-store',
            ...(historical.receiptHeader?{'payment-receipt':historical.receiptHeader}:{})}});
      }
    }
    const selected=routes.get(request.method+' '+url.pathname);
    if(!selected) return Response.json({error:'MPP_ROUTE_NOT_FOUND'},{status:404});
    if(key) {
      if(running.has(key)) {
        const scope=hash(stable({schema:'stellar-forge.mpp-scope.v1',profileId,route:selected.route.id,
          ...bindingFacts({url:request.url,method:request.method},bytes)}));
        const activeScope=runningScopes.get(key)??(await workspace.read('deliveries',key))?.scope;
        requireValue(activeScope===scope,'MPP_DELIVERY_SCOPE_MISMATCH',409);
        return storedResponse(await running.get(key));
      }
    }
    const operation=paymentContext.run(key,()=>execute(request,bytes,selected,key,credential));
    if(!key) return operation;
    const retained=operation.then(response=>responseRecord(response));
    running.set(key,retained);
    runningScopes.set(key,hash(stable({schema:'stellar-forge.mpp-scope.v1',profileId,route:selected.route.id,
      ...bindingFacts({url:request.url,method:request.method},bytes)})));
    try { return storedResponse(await retained); }
    finally { running.delete(key); runningScopes.delete(key); }
  }
  function recover(deliveryId) {
    requireValue(!running.has(deliveryId),'MPP_DELIVERY_RUNNING',409);
    const operation=Promise.resolve().then(async()=>{
      const row=await workspace.read('deliveries',deliveryId);
      requireValue(row && row.profileId===profileId,'MPP_DELIVERY_PROFILE_CHANGED',409);
      runningScopes.set(deliveryId,row.scope);
      if(row.state==='COMPLETE') return row.response;
      if(!row.receipt) {
        const nativeClaim=await workspace.sdkStore.get('stellar:charge:challenge:'+row.challenge.id);
        const hashClaim=await workspace.sdkStore.get('stellar:charge:hash:'+row.transaction);
        requireValue(nativeClaim?.merchantDeliveryId===row.id && hashClaim?.merchantDeliveryId===row.id &&
          (!nativeClaim.hash || nativeClaim.hash.toLowerCase()===row.transaction),
          'MPP_NATIVE_TRANSACTION_CLAIM_REQUIRED',409);
        const observation=await observeTransfer({native,challenge:row.challenge,intentId:row.id,payer:row.payer,
          transaction:row.transaction,rpcEndpoint:config.rpcUrl});
        requireValue(observation.outcome==='TRANSFER_MATCHED','MPP_TRANSFER_NOT_FINAL',409);
        const receipt=native.Receipt.from({method:'stellar',status:'success',reference:row.transaction,
          timestamp:now(),externalId:row.scope});
        row.receipt=receipt;row.receiptHeader=native.Receipt.serialize(receipt);
        row.recoveryObservation=observation;row.state='SETTLED';
        await workspace.put('deliveries',deliveryId,{...row,updatedAt:now()});
      }
      return responseRecord(await deliver(row));
    });
    // Claim synchronously before observation or file IO. Normal replay joins
    // this same promise after checking the original request's scope.
    running.set(deliveryId,operation);runningScopes.set(deliveryId,null);
    return operation.then(()=>workspace.read('deliveries',deliveryId)).finally(()=>{
      running.delete(deliveryId);runningScopes.delete(deliveryId);
    });
  }
  return {handle,recover,config,profileId,native,
    active:()=>running.size,drain:()=>Promise.allSettled([...running.values()])};
}

import { dependencyRootFor, inputPathFor } from './runtime.mjs';
import { assertOperating } from './receiving.mjs';
// MIT. Native commitment acceptance and useful response recovery in the original leased workspace.
import { AsyncLocalStorage } from 'node:async_hooks';
import { pathToFileURL } from 'node:url';
import { regular } from '../distribution/runtime-workspace/storage.mjs';
import { bindingFacts } from '../mpp-charge/config.mjs';
import { responseRecord, storedResponse } from '../mpp-charge/merchant.mjs';
import { requireValue as need, hash, stable, now } from '../mpp-charge/storage.mjs';
import { merchantConfig, profileKey, humanAmount, MAX_BODY, streamKey } from './config.mjs';
import { loadChannelNative, observeChannel, assertFreshCommitment, outstandingAtomic, nativeStore, merchantCumulativeKey, settlingKey, closedKey } from './runtime.mjs';
import { groups, serialChannel, deliveryView } from './state.mjs';
export function merchantContract(config) {
  return {schema:'stellar-forge.mpp-channel-contract.v1',title:config.title,origin:config.publicOrigin,
    profileId:profileKey(config),channel:config.channel,
    offers:config.routes.map(route=>({id:route.id,request:{method:route.method,url:config.publicOrigin+route.path},
      description:route.description,pricedUnit:route.pricedUnit,amountAtomic:route.amountAtomic,source:route.source}))};
}
export async function createMerchant({workspace,profile,environment=process.env}) {
  const config=merchantConfig(profile), profileId=profileKey(config);
  const secret=environment[config.secretEnv];
  need(typeof secret==='string' && Buffer.byteLength(secret)>=32, 'MPP_CHANNEL_MERCHANT_SECRET_REQUIRED');
  const native=await loadChannelNative(await dependencyRootFor(workspace,config)), store=nativeStore(workspace,config.channel);
  const context=new AsyncLocalStorage(), running=new Set();
  const cumulativeKey=merchantCumulativeKey(config.channel);
  const owns=(key,value,current)=>{
    const row=context.getStore();
    need(row, 'MPP_CHANNEL_NATIVE_DELIVERY_CONTEXT_REQUIRED');
    if(key.startsWith('stellar:channel:challenge:'))
      need(!current?.merchantDeliveryId || current.merchantDeliveryId===row.id,
        'MPP_CHANNEL_NATIVE_CLAIM_OWNER_CHANGED',409);
    return {...value,merchantDeliveryId:row.id,credentialSha256:hash(row.credentialHeader),
      challengeId:row.challenge.id,scope:row.scope};
  };
  const sdkStore={
    get:store.get,delete:store.delete,
    put:(key,value)=>store.update(key,current=>({op:'set',value:owns(key,value,current),result:undefined})),
    update:async(key,fn)=>{
      let observation,delivery;
      if(key===cumulativeKey) {
        // The SDK reaches this atomic acceptance only after native signature and replay checks.
        delivery=context.getStore();
        need(delivery, 'MPP_CHANNEL_NATIVE_DELIVERY_CONTEXT_REQUIRED');
        observation=await observeChannel(native,config.channel);
        Object.assign(delivery,{observation,outstandingAtomic:outstandingAtomic(observation,delivery.amountAtomic),updatedAt:now()});
        await workspace.put(groups.deliveries,delivery.id,delivery);
      }
      return store.update(key,current=>{
        if(key===cumulativeKey)assertFreshCommitment(observation,delivery.amountAtomic,delivery.challenge.request.amount);
        // The native callback checks the current stored cumulative plus this same authenticated price.
        const change=fn(current); return change.op==='set'?{...change,value:owns(key,change.value,current)}:change;
      });
    }
  };
  const handlers=config.handlersModule?await import(pathToFileURL(await inputPathFor(workspace,config,config.handlersModule)).href):{};
  const routes=new Map(config.routes.map(route=>{
    if(route.resource.kind==='handler') need(typeof handlers[route.resource.export]==='function', 'MPP_CHANNEL_HANDLER_UNAVAILABLE');
    const method=native.channelServer.stellar.channel({channel:config.channel.address,
      commitmentKey:config.channel.commitmentKey,network:config.channel.network,
      recipient:config.channel.recipient,currency:config.channel.token,decimals:config.channel.decimals,
      // The mandatory coherent observation at atomic acceptance validates cumulative minus withdrawn.
      // Native SDK signature, challenge claim, replay and atomic cumulative acceptance remain enabled.
      rpcUrl:config.channel.rpcUrl,store:sdkStore,checkOnChainState:false});
    const mpp=native.server.Mppx.create({realm:new URL(config.publicOrigin).hostname,secretKey:secret,methods:[method]});
    return [route.method+' '+route.path,{route,mpp}];
  }));
  await workspace.put('profiles',profileId,config);
  const scopeFor=(row,facts)=>hash(stable({schema:'stellar-forge.mpp-channel-scope.v1',
    profileId:row.profileId ?? profileId,route:row.routeId ?? row.id,
    sourceSha256:row.source?.sha256,...facts}));
  function receiptFor(row) {
    return native.Receipt.from({method:'stellar',status:'success',
      reference:row.challenge.request.methodDetails?.reference ?? row.challenge.id,
      timestamp:now(),externalId:row.scope});
  }
  async function acceptance(row) {
    if(row.receipt) return row;
    const claim=await store.get('stellar:channel:challenge:'+row.challenge.id);
    const cumulative=await store.get(cumulativeKey);
    const ownedClaim=claim?.merchantDeliveryId===row.id && claim.credentialSha256===hash(row.credentialHeader);
    const ownedCumulative=cumulative?.merchantDeliveryId===row.id &&
      cumulative.credentialSha256===hash(row.credentialHeader) && cumulative.amount===row.amountAtomic;
    if(ownedClaim && claim.state==='used' || ownedCumulative) {
      const receipt=receiptFor(row);
      const next={...row,state:'ACCEPTED',receipt,receiptHeader:native.Receipt.serialize(receipt),
        nativeAcceptance:{challenge:claim,cumulative:ownedCumulative?cumulative:null},updatedAt:now()};
      await workspace.put(groups.deliveries,row.id,next);
      if(ownedClaim && claim.state!=='used') await store.put('stellar:channel:challenge:'+row.challenge.id,
        {...claim,state:'used',usedAt:now()});
      return next;
    }
    return null;
  }
  async function clearUnacceptedClaim(row) {
    const cumulative=await store.get(cumulativeKey);
    need(cumulative?.merchantDeliveryId!==row.id, 'MPP_CHANNEL_ORIGINAL_ACCEPTANCE_MUST_BE_RECOVERED',409);
    await store.update('stellar:channel:challenge:'+row.challenge.id,current=>{
      if(!current) return {op:'noop',result:undefined};
      need(current.state==='pending' && current.merchantDeliveryId===row.id &&
        current.credentialSha256===hash(row.credentialHeader), 'MPP_CHANNEL_NATIVE_CLAIM_OWNER_CHANGED',409);
      return {op:'delete',result:undefined};
    });
  }
  async function resource(row) {
    const route=config.routes.find(item=>item.id===row.routeId);
    need(route && row.profileId===profileId, 'MPP_CHANNEL_ORIGINAL_RESOURCE_PROFILE_REQUIRED',409);
    let response;
    if(route.resource.kind==='json') response=Response.json(route.resource.value);
    else if(route.resource.kind==='json-file') {
      const bytes=await regular(await inputPathFor(workspace,config,route.resource.path),MAX_BODY);
      JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
      response=new Response(bytes,{headers:{'content-type':'application/json; charset=utf-8'}});
    } else response=await handlers[route.resource.export]({
      operationId:row.id,request:new Request(row.url,{method:row.method,
        ...(row.bodyPresent?{body:Buffer.from(row.requestBodyBase64,'base64')}:{})}),
      source:structuredClone(route.source),payment:{model:'channel-commitment',channel:config.channel,
        cumulativeAtomic:row.amountAtomic,unitAtomic:row.challenge.request.amount,
        receipt:row.receipt,challenge:structuredClone(row.challenge)},
      signal:AbortSignal.timeout(120000)
    });
    if(!(response instanceof Response)) response=Response.json(response);
    need(response.status>=200 && response.status<300 && response.status!==202, 'MPP_CHANNEL_RESOURCE_FAILED',502);
    const headers=new Headers(response.headers);
    headers.set('payment-receipt',row.receiptHeader);headers.set('cache-control','private, no-store');
    return new Response(response.body,{status:response.status,headers});
  }
  async function deliver(row) {
    if(row.state==='COMPLETE') return storedResponse(row.response);
    need(row.receipt, 'MPP_CHANNEL_NATIVE_ACCEPTANCE_REQUIRED',409);
    row={...row,state:'DELIVERING',updatedAt:now()}; await workspace.put(groups.deliveries,row.id,row);
    try {
      const response=await responseRecord(await resource(row));
      await workspace.put(groups.deliveries,row.id,{...row,state:'COMPLETE',response,completedAt:now(),updatedAt:now()});
      return storedResponse(response);
    } catch(error) {
      await workspace.put(groups.deliveries,row.id,{...row,state:'DELIVERY_FAILED',
        failure:error.code ?? 'MPP_CHANNEL_RESOURCE_FAILED',updatedAt:now()});
      return Response.json({operationId:row.id,status:'DELIVERY_FAILED'},
        {status:503,headers:{'payment-receipt':row.receiptHeader,'cache-control':'private, no-store'}});
    }
  }
  async function execute(request,selected,bytes,credential,key) {
    const facts=bindingFacts({url:request.url,method:request.method},bytes);
    const scope=scopeFor(selected.route,facts);
    let row=key?await workspace.read(groups.deliveries,key):null;
    if(row) {
      need(row.scope===scope, 'MPP_CHANNEL_DELIVERY_SCOPE_CHANGED',409);
      if(row.state==='COMPLETE') return storedResponse(row.response);
      const accepted=await acceptance(row);
      if(accepted) return deliver(accepted);
      await clearUnacceptedClaim(row);
    }
    if(credential) {
      need(credential.challenge.method==='stellar' && credential.challenge.intent==='channel' &&
        credential.payload.action==='voucher' &&
        native.Challenge.verify(credential.challenge,{secretKey:secret}), 'MPP_CHANNEL_CREDENTIAL_INVALID',402);
      const meta=credential.challenge.opaque?
        JSON.parse(Buffer.from(credential.challenge.opaque,'base64url').toString('utf8')):credential.challenge.meta;
      need(meta?._mppx_scope===scope && credential.challenge.request.externalId===scope &&
        credential.challenge.request.channel===config.channel.address &&
        credential.challenge.request.methodDetails?.network===config.channel.network &&
        credential.challenge.request.amount===selected.route.amountAtomic,
        'MPP_CHANNEL_DELIVERY_SCOPE_CHANGED',402);
      row={schema:'stellar-forge.mpp-channel-delivery.v1',id:key,state:'VERIFYING',
        profileId,streamKey:streamKey(config.channel),routeId:selected.route.id,source:selected.route.source,
        channel:config.channel,scope,...facts,requestBodyBase64:bytes?.toString('base64') ?? null,
        challenge:credential.challenge,credentialHeader:request.headers.get('authorization'),
        signature:credential.payload.signature,amountAtomic:credential.payload.amount,
        createdAt:row?.createdAt ?? now(),updatedAt:now()};
      await workspace.put(groups.deliveries,key,row);
    }
    try {
      const invoke=()=>selected.mpp.channel({amount:humanAmount(selected.route.amountAtomic,config.channel.decimals),
        description:selected.route.description,externalId:scope,scope,
        expires:new Date(Date.now()+config.lifetimeSeconds*1000).toISOString()})(request);
      const result=credential?await context.run(row,invoke):await invoke();
      if(result.status===402) {
        if(row) {
          const accepted=await acceptance(row); if(accepted) return deliver(accepted);
          await clearUnacceptedClaim(row);
          await workspace.put(groups.deliveries,key,{...row,state:'VERIFICATION_FAILED',updatedAt:now()});
        }
        return result.challenge;
      }
      need(row, 'MPP_CHANNEL_AUTHENTICATED_DELIVERY_REQUIRED');
      const receiptResponse=await result.withReceipt(new Response(null));
      const receipt=native.Receipt.fromResponse(receiptResponse);
      need(receipt?.method==='stellar' && receipt.status==='success' &&
        receipt.reference===(row.challenge.request.methodDetails?.reference ?? row.challenge.id),
        'MPP_CHANNEL_NATIVE_RECEIPT_CHANGED');
      row={...row,state:'ACCEPTED',receipt,receiptHeader:receiptResponse.headers.get('payment-receipt'),updatedAt:now()};
      await workspace.put(groups.deliveries,key,row); return deliver(row);
    } catch(error) {
      if(row) {
        const accepted=await acceptance(row); if(accepted) return deliver(accepted);
        await clearUnacceptedClaim(row);
        await workspace.put(groups.deliveries,key,{...row,state:'VERIFICATION_FAILED',
          failure:error.code ?? error.name,updatedAt:now()});
      }
      throw error;
    }
  }
  async function handle(request) {
    need(request instanceof Request && new URL(request.url).origin===config.publicOrigin, 'MPP_CHANNEL_PUBLIC_ORIGIN_MISMATCH');
    const raw=await request.clone().arrayBuffer(); need(raw.byteLength<=MAX_BODY, 'MPP_CHANNEL_REQUEST_TOO_LARGE',413);
    const bytes=request.body===null?null:Buffer.from(raw), url=new URL(request.url);
    const header=request.headers.get('authorization');
    need(!header || header.length<=65536 && /^Payment [A-Za-z0-9_-]+$/.test(header), 'MPP_CHANNEL_CREDENTIAL_INVALID');
    const credential=header?native.Credential.deserialize(header):null, key=header?hash(header):null;
    return serialChannel(workspace,config.channel,async()=>{
      if(key) {
        const old=await workspace.read(groups.deliveries,key);
        if(old) {
          const facts=bindingFacts({url:request.url,method:request.method},bytes);
          need(old.scope===scopeFor(old,facts), 'MPP_CHANNEL_DELIVERY_SCOPE_CHANGED',409);
          if(old.state==='COMPLETE') return storedResponse(old.response);
          need(old.profileId===profileId, 'MPP_CHANNEL_REOPEN_ORIGINAL_MERCHANT_PROFILE',409);
        }
      }
      await assertOperating(workspace,config.channel);
      const selected=routes.get(request.method+' '+url.pathname);
      if(!selected) return Response.json({error:'MPP_CHANNEL_ROUTE_NOT_FOUND'},{status:404});
      if(key) running.add(key);
      try { return await execute(request,selected,bytes,credential,key); }
      finally { if(key) running.delete(key); }
    });
  }
  async function recover(deliveryId) {
    return serialChannel(workspace,config.channel,async()=>{
      await assertOperating(workspace,config.channel);
      const row=await workspace.read(groups.deliveries,deliveryId);
      need(row && row.profileId===profileId, 'MPP_CHANNEL_ORIGINAL_MERCHANT_PROFILE_REQUIRED',409);
      if(row.state==='COMPLETE') return deliveryView(row);
      const accepted=await acceptance(row);
      if(accepted) { await deliver(accepted); return deliveryView(await workspace.read(groups.deliveries,deliveryId)); }
      const request=new Request(row.url,{method:row.method,headers:{authorization:row.credentialHeader,
        ...(row.bodyPresent?{'content-type':'application/json'}:{})},
        ...(row.bodyPresent?{body:Buffer.from(row.requestBodyBase64,'base64')}:{})});
      const route=routes.get(row.method+' '+new URL(row.url).pathname);
      need(route, 'MPP_CHANNEL_ORIGINAL_ROUTE_REQUIRED');
      await execute(request,route,row.bodyPresent?Buffer.from(row.requestBodyBase64,'base64'):null,
        native.Credential.deserialize(row.credentialHeader),row.id);
      return deliveryView(await workspace.read(groups.deliveries,row.id));
    });
  }
  // Finish native acceptance joins before any later voucher can advance the same cumulative.
  await serialChannel(workspace,config.channel,async()=>{
    for(const row of await workspace.list(groups.deliveries)) {
      if(row.streamKey!==streamKey(config.channel) || row.state!=='VERIFYING') continue;
      const accepted=await acceptance(row);
      if(!accepted) await clearUnacceptedClaim(row);
    }
  });
  return {config,profileId,handle,recover,native,contract:merchantContract(config),
    active:()=>running.size,drain:async()=>{},store};
}

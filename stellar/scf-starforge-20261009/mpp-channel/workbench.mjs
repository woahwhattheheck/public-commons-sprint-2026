// MIT. Channel work is operated through the original authenticated MPP console and its jobs.
import { createServer } from 'node:http';
import { regular } from '../distribution/runtime-workspace/storage.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';
import { requireValue as need, hash, stable, now } from '../mpp-charge/storage.mjs';
import { responseRecord, storedResponse } from '../mpp-charge/merchant.mjs';
import { publicURL, merchantConfig, profileKey, streamKey, channel, draftTask, funderConfig, draftFunder, MAX_BODY } from './config.mjs';
import { saveTask, authorizeTask, resumeTaskAuthority, stopTask } from './authority.mjs';
import { preparePurchase, executePurchase, refreshChallenge, responseFor, cancelPurchase } from './buyer.mjs';
import { createMerchant, merchantContract } from './merchant.mjs';
import { registerLocalMerchant } from './transport.mjs';
import { prepareClose, executeClose, reconcileClose, cancelUnsignedClose,
  prepareCollection, executeCollection, reconcileCollection, cancelUnsignedCollection, closeView } from './settlement.mjs';
import { prepareFunding, executeFunding, reconcileFunding, cancelUnsignedFunding, fundingView } from './funding.mjs';
import { loadChannelNative, dependencyRootFor, observeChannel } from './runtime.mjs';
import { exportChannel, receiveChannel, parseBundle, assertOperating } from './receiving.mjs';
import { groups, snapshot, drainChannels, serialChannel, readTask, purchaseView, rememberObservation } from './state.mjs';
const portValue=value=>{
  need(Number.isInteger(value) && value>=0 && value<=65535, 'MPP_CHANNEL_PORT_INVALID'); return value;
};
async function send(response,output) {
  response.statusCode=output.status;
  for(const [key,value] of output.headers) response.setHeader(key,value);
  if(output.body) {
    const reader=output.body.getReader();
    try { while(true) {
      const value=await reader.read(); if(value.done) break;
      if(!response.write(Buffer.from(value.value))) await new Promise(done=>response.once('drain',done));
    }} finally {reader.releaseLock();}
  }
  response.end();
}
async function serveMerchant({workspace,profile,port,environment}) {
  const merchant=await createMerchant({workspace,profile,environment});
  let actualPort=portValue(port);
  const server=createServer({maxHeaderSize:65536},async(request,response)=>{
    try {
      need(typeof request.url==='string' && request.url.startsWith('/') && !request.url.startsWith('//') &&
        ['127.0.0.1:'+actualPort,new URL(profile.publicOrigin).host].includes(request.headers.host),
        'MPP_CHANNEL_MERCHANT_HOST_INVALID');
      const url=new URL(request.url,profile.publicOrigin);
      need(url.origin===profile.publicOrigin, 'MPP_CHANNEL_MERCHANT_ORIGIN_INVALID');
      if(request.method==='GET' && url.pathname==='/_mpp/channel-contract') {
        await send(response,Response.json(merchant.contract,{headers:{'cache-control':'public, max-age=0, must-revalidate',
          etag:'"'+merchant.profileId+'"','x-content-type-options':'nosniff'}}));return;
      }
      if(request.method==='GET' && url.pathname==='/_mpp/channel-health') {
        await send(response,Response.json({status:'ready',profileId:merchant.profileId,channel:profile.channel.address}));return;
      }
      let size=0;const pieces=[];
      for await(const piece of request) {size+=piece.length;need(size<=MAX_BODY,'MPP_CHANNEL_REQUEST_TOO_LARGE',413);pieces.push(piece);}
      const bytes=Buffer.concat(pieces),headers=new Headers();
      for(const [key,value] of Object.entries(request.headers)) if(typeof value==='string') headers.set(key,value);
      const body=!['GET','HEAD'].includes(request.method) && (bytes.length || request.headers['content-length']==='0');
      await send(response,await merchant.handle(new Request(url,{method:request.method,headers,...(body?{body:bytes}:{})})));
    } catch(error) {
      if(!response.headersSent) await send(response,Response.json({error:error.code ?? 'MPP_CHANNEL_MERCHANT_FAILED'},
        {status:error.status ?? 500,headers:{'cache-control':'no-store'}})); else response.destroy();
    }
  });
  server.requestTimeout=360000;server.headersTimeout=30000;
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(actualPort,'127.0.0.1',done);});
  actualPort=server.address().port;
  let unregister;
  try{unregister=registerLocalMerchant(workspace,merchant);}catch(error){await new Promise(done=>server.close(done));throw error;}
  return {merchant,port:actualPort,close:async()=>{
    unregister();await new Promise(done=>server.close(done));await merchant.drain();await drainChannels(workspace);
  }};
}
export function taskFromOffer(contract,offerId) {
  need(contract?.schema==='stellar-forge.mpp-channel-contract.v1' &&
    /^[a-f0-9]{64}$/.test(contract.profileId) && Array.isArray(contract.offers),
    'MPP_CHANNEL_ORIGINAL_MERCHANT_CONTRACT_REQUIRED');
  const terms=channel(contract.channel),offer=contract.offers.find(row=>row.id===offerId);
  need(offer, 'MPP_CHANNEL_SELECTED_OFFER_REQUIRED');
  const selected=draftTask();
  return {...selected,title:offer.description,usefulTask:offer.description,source:offer.source,channel:terms,
    merchantProfileSha256:contract.profileId,offerId:offer.id,realm:new URL(contract.origin).hostname,
    request:{...offer.request,queryKeys:[]},pricedUnit:offer.pricedUnit,
    budget:{...selected.budget,maximumUnitAtomic:offer.amountAtomic}};
}
export function createChannelWorkbench({workspace,environment=process.env}) {
  const merchants=new Map(),transitions=new Set();
  async function merchantProfile(key) {
    const setting=await workspace.read(groups.settings,key);
    need(setting?.profileId, 'MPP_CHANNEL_MERCHANT_SELECTION_REQUIRED',404);
    const profile=await workspace.read('profiles',setting.profileId);
    need(profile && profileKey(profile)===setting.profileId, 'MPP_CHANNEL_ORIGINAL_MERCHANT_PROFILE_REQUIRED');
    return {setting,profile};
  }
  async function state() {
    const selected=await snapshot(workspace),profiles=await workspace.list(groups.settings);
    const channels=new Map([...selected.streams,...profiles,...selected.funderProfiles,...selected.observations].map(row=>[streamKey(row.channel),{streamKey:streamKey(row.channel),channel:row.channel}]));
    return {...selected,streams:selected.streams.map(row=>({...row,streamKey:streamKey(row.channel)})),channels:[...channels.values()],
      merchantProfiles:profiles.map(row=>({...row,streamKey:streamKey(row.channel)})),
      funderProfiles:selected.funderProfiles.map(row=>({...row,streamKey:streamKey(row.channel)})),
      merchants:[...merchants.entries()].map(([key,value])=>({stream:key,port:value.port,
        profileId:value.merchant.profileId,publicOrigin:value.merchant.config.publicOrigin,
        active:value.merchant.active()})),
      receiving:await workspace.list(groups.receiving)};
  }
  async function configureMerchant(body) {
    const config=merchantConfig(body.profile), key=streamKey(config.channel), profileId=profileKey(config);
    return serialChannel(workspace,config.channel,async()=>{
      await assertOperating(workspace,config.channel);
      await workspace.put('profiles',profileId,config);
      return workspace.update(groups.settings,key,current=>{
        need((current?.revision ?? 0)===(body.expectedRevision ?? 0), 'MPP_CHANNEL_MERCHANT_REVISION_CHANGED',409);
        const setting={schema:'stellar-forge.mpp-channel-merchant-selection.v1',channel:config.channel,profileId,
          revision:(current?.revision ?? 0)+1,updatedAt:now(),title:config.title};
        return {op:'set',value:setting,result:setting};
      });
    });
  }
  async function funderProfile(key) {
    const setting=await workspace.read(groups.funders,key);
    need(setting?.profileId,'MPP_CHANNEL_FUNDER_SELECTION_REQUIRED',404);
    const profile=await workspace.read('profiles',setting.profileId);
    need(profile && profileKey(funderConfig(profile))===setting.profileId,'MPP_CHANNEL_ORIGINAL_FUNDER_PROFILE_REQUIRED');
    return {setting,profile};
  }
  async function selectedChannelProfile(key) {
    if(await workspace.read(groups.funders,key))return (await funderProfile(key)).profile;
    if(await workspace.read(groups.settings,key))return (await merchantProfile(key)).profile;
    const task=(await workspace.list(groups.tasks)).find(row=>streamKey(row.config.channel)===key);
    need(task,'MPP_CHANNEL_SELECTED_PROFILE_REQUIRED',404);
    return (await readTask(workspace,task.config.taskId)).config;
  }
  async function configureFunder(body) {
    const config=funderConfig(body.profile),key=streamKey(config.channel),profileId=profileKey(config);
    return serialChannel(workspace,config.channel,async()=>{
      await assertOperating(workspace,config.channel);await workspace.put('profiles',profileId,config);
      return workspace.update(groups.funders,key,current=>{
        need((current?.revision ?? 0)===(body.expectedRevision ?? 0),'MPP_CHANNEL_FUNDER_REVISION_CHANGED',409);
        const setting={schema:'stellar-forge.mpp-channel-funder-selection.v1',channel:config.channel,profileId,
          title:config.title,revision:(current?.revision ?? 0)+1,updatedAt:now()};
        return {op:'set',value:setting,result:setting};
      });
    });
  }
  async function refreshChannel(body) {
    const config=await selectedChannelProfile(body.stream);
    return serialChannel(workspace,config.channel,async()=>{
      await assertOperating(workspace,config.channel);
      const native=await loadChannelNative(await dependencyRootFor(workspace,config));
      const observation=await observeChannel(native,config.channel);
      return rememberObservation(workspace,config.channel,observation,{operation:'channel-observe'});
    });
  }
  async function startMerchant(body) {
    need(!merchants.has(body.stream) && !transitions.has(body.stream), 'MPP_CHANNEL_MERCHANT_ALREADY_RUNNING',409);
    transitions.add(body.stream);
    try {
      const {profile}=await merchantProfile(body.stream);
      const active=await serveMerchant({workspace,profile,port:portValue(body.port ?? 8789),environment});
      merchants.set(body.stream,active);return {stream:body.stream,port:active.port,profileId:active.merchant.profileId};
    } finally {transitions.delete(body.stream);}
  }
  async function stopMerchant(body) {
    const active=merchants.get(body.stream);
    need(active && !transitions.has(body.stream), 'MPP_CHANNEL_MERCHANT_NOT_RUNNING',409);
    transitions.add(body.stream);
    try {await active.close();merchants.delete(body.stream);return {stream:body.stream,status:'STOPPED'};}
    finally {transitions.delete(body.stream);}
  }
  async function action(name,body) {
    need(body && typeof body==='object' && !Array.isArray(body), 'MPP_CHANNEL_OPERATION_INPUT_REQUIRED');
    if(name==='funder-template') {
      const selected=body.stream?await selectedChannelProfile(body.stream):null;
      return {...draftFunder(selected?.channel ?? body.channel),
        ...(selected?{dependencyRoot:await dependencyRootFor(workspace,selected)}:{})};
    }
    if(name==='funder-save')return configureFunder(body);
    if(name==='channel-observe')return refreshChannel(body);
    if(name==='funding-prepare') {
      const {profile}=await funderProfile(body.stream);
      return prepareFunding({workspace,profile,fundingId:body.fundingId,action:body.action,amountAtomic:body.amountAtomic});
    }
    if(name==='funding-execute' || name==='funding-resume')return executeFunding({...body,workspace,environment});
    if(name==='funding-reconcile')return reconcileFunding({...body,workspace});
    if(name==='funding-cancel')return cancelUnsignedFunding({...body,workspace});
    if(name==='collection-prepare') {
      const {profile}=await merchantProfile(body.stream);return prepareCollection({workspace,profile,settlementId:body.settlementId});
    }
    if(name==='collection-execute' || name==='collection-resume')return executeCollection({...body,workspace,environment});
    if(name==='collection-reconcile')return reconcileCollection({...body,workspace});
    if(name==='collection-cancel')return cancelUnsignedCollection({...body,workspace});
    if(name==='task-template') return body.contract?taskFromOffer(body.contract,body.offerId):draftTask();
    if(name==='task-save') return saveTask({...body,workspace});
    if(name==='task-authorize') return authorizeTask({...body,workspace});
    if(name==='task-authority-resume') return resumeTaskAuthority({...body,workspace});
    if(name==='task-stop') return stopTask({...body,workspace});
    if(name==='purchase-prepare') return preparePurchase({...body,workspace});
    if(name==='purchase-execute' || name==='purchase-resume') return executePurchase({
      workspace,purchaseId:body.purchaseId,environment,resume:name==='purchase-resume'});
    if(name==='purchase-refresh') return refreshChallenge({...body,workspace});
    if(name==='purchase-cancel') return cancelPurchase({...body,workspace});
    if(name==='merchant-save') return configureMerchant(body);
    if(name==='merchant-start') return startMerchant(body);
    if(name==='merchant-stop') return stopMerchant(body);
    if(name==='delivery-recover') {
      const row=await workspace.read(groups.deliveries,body.deliveryId);
      need(row, 'MPP_CHANNEL_DELIVERY_NOT_FOUND',404);
      const profile=await workspace.read('profiles',row.profileId),merchant=await createMerchant({workspace,profile,environment});
      return merchant.recover(body.deliveryId);
    }
    if(name==='close-prepare') {
      const {profile}=await merchantProfile(body.stream); return prepareClose({workspace,profile,settlementId:body.settlementId});
    }
    if(name==='close-execute' || name==='close-resume') return executeClose({...body,workspace,environment});
    if(name==='close-reconcile') return reconcileClose({...body,workspace});
    if(name==='close-cancel') return cancelUnsignedClose({...body,workspace});
    if(name==='contract-fetch') {
      const origin=publicURL(body.origin+'/').origin;need(origin===body.origin, 'MPP_CHANNEL_PUBLIC_ORIGIN_INVALID');
      const response=await createPublicHttpsFetch({timeoutMs:30000,paymentAuthorization:false,trustedProxy:body.transport ?? null})(
        origin+'/_mpp/channel-contract',{method:'GET',headers:{accept:'application/json'},redirect:'manual'});
      need(response.status===200, 'MPP_CHANNEL_MERCHANT_CONTRACT_UNAVAILABLE');
      const captured=await responseRecord(response),contract=JSON.parse(Buffer.from(captured.bodyBase64,'base64').toString('utf8'));
      need(contract.origin===origin, 'MPP_CHANNEL_MERCHANT_CONTRACT_ORIGIN_CHANGED');
      return {contract,source:{url:origin+'/_mpp/channel-contract',sha256:captured.sha256,bytes:captured.bytes,retrievedAt:now()}};
    }
    if(name==='export') {
      const bundle=await exportChannel({workspace,terms:body.channel,handoverId:body.handoverId});
      return {id:bundle.id,sha256:bundle.sha256,records:bundle.records.length,
        download:'/api/channel/handovers/'+bundle.sha256,sourceFiles:bundle.sourceFiles.length,inputFiles:bundle.inputFiles.length};
    }
    if(name==='receive') {
      const document=body.bundle ?? JSON.parse((await regular(body.file,128*1024*1024)).toString('utf8'));
      return receiveChannel({workspace,bundle:parseBundle(document),dependencyRoot:body.dependencyRoot});
    }
    need(false, 'MPP_CHANNEL_OPERATION_NOT_FOUND',404);
  }
  async function read(kind,key) {
    if(kind==='tasks') return readTask(workspace,key);
    if(kind==='purchases') {
      const row=await workspace.read(groups.purchases,key);need(row,'MPP_CHANNEL_PURCHASE_NOT_FOUND',404);return purchaseView(row);
    }
    if(kind==='funders')return funderProfile(key);
    if(kind==='funding' || kind==='settlements') {
      const row=await workspace.read(groups[kind],key);need(row,'MPP_CHANNEL_FINANCIAL_OPERATION_NOT_FOUND',404);
      return kind==='funding'?fundingView(row):closeView(row);
    }
    if(kind==='observations') {
      const row=await workspace.read(groups.observations,key);need(row,'MPP_CHANNEL_OBSERVATION_NOT_FOUND',404);return row;
    }
    if(kind==='contracts') return merchantContract((await merchantProfile(key)).profile);
    need(false, 'MPP_CHANNEL_READ_NOT_FOUND',404);
  }
  async function handoverFile(sha256) {
    need(/^[a-f0-9]{64}$/.test(sha256),'MPP_CHANNEL_HANDOVER_ID_INVALID');
    const row=(await workspace.list(groups.receiving)).find(item=>item.sha256===sha256 && (item.path || item.root));
    need(row,'MPP_CHANNEL_HANDOVER_NOT_FOUND',404);
    const path=row.path ?? row.root+'/HANDOVER.json';
    need(path.startsWith(workspace.root+'/channel-handover/'),'MPP_CHANNEL_HANDOVER_PATH_CHANGED');
    let bytes=row.fileBytes,fileSha256=row.fileSha256;
    if(bytes===undefined || !fileSha256) {
      const data=await regular(path,128*1024*1024);parseBundle(data.toString('utf8'));
      bytes=data.length;fileSha256=hash(data);
    }
    return {schema:'stellar-forge.mpp-channel-handover-file.v1',path,bytes,
      sha256:fileSha256,bundleSha256:sha256,name:'channel-handover-'+sha256.slice(0,12)+'.json'};
  }
  async function handover(sha256) {
    need(/^[a-f0-9]{64}$/.test(sha256),'MPP_CHANNEL_HANDOVER_ID_INVALID');
    const row=(await workspace.list(groups.receiving)).find(item=>item.sha256===sha256 && (item.path || item.root));
    need(row,'MPP_CHANNEL_HANDOVER_NOT_FOUND',404);
    const path=row.path ?? row.root+'/HANDOVER.json';
    const bytes=await regular(path,128*1024*1024);parseBundle(bytes.toString('utf8'));
    return new Response(bytes,{headers:{'content-type':'application/json','cache-control':'private, no-store',
      'content-disposition':'attachment; filename="channel-handover-'+sha256.slice(0,12)+'.json"'}});
  }
  return {state,action,read,handover,handoverFile,response:purchaseId=>responseFor({workspace,purchaseId}),
    close:async()=>{for(const active of merchants.values())await active.close();merchants.clear();await drainChannels(workspace);}};
}

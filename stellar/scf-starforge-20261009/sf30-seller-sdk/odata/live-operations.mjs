// MIT. The retained operator composes the original live merchant and SF88 buyer.
import { mkdir,open,readFile,readdir,rename,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireReleaseLease } from '../../sf82-seller-pilot/release-process.mjs';
import { templateFromWorkspace,prepareFromWorkspace,writePackage,readPackage,prepareBuyerHandoff,receivePage } from './live/client.mjs';
import { startODataMerchant } from './live/merchant.mjs';
import { atomic,readJson,writeNew,formatted,digest,stable,identifier,fault,now } from './state.mjs';

const packageFiles=['catalog.json','plan.json','seller-service.json','offers.json','openapi.json','customer-query.json','request.json','package.json'];
const buyerFiles=['request.json','offers.json','buyer.json','handoff.json'];
const receivedFiles=['original-response.json','rows.jsonl','receiving.json','next-request.json'];
const port=value=>{if(!Number.isInteger(value)||value<0||value>65535)throw fault('ODATA_LIVE_PORT','Choose a valid listener port.');return value;};
function facilitator(value){if(!value)return null;const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw fault('ODATA_LIVE_FACILITATOR','Use the existing facilitator HTTPS URL.');return url.href;}
async function syncDirectory(directory){const file=await open(directory,'r');try{await file.sync();}finally{await file.close();}}
async function syncTree(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);if(entry.isDirectory())await syncTree(path);else{const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}}
  await syncDirectory(directory);}

export async function openODataLiveOperations({workspace,nativeFactoryFor,env=process.env,navigationOrigin=null}={}){
  const root=join(workspace.directory,'live'),products=join(root,'products'),running=new Map();
  await mkdir(products,{recursive:true,mode:0o700});let tail=Promise.resolve(),closing=false;
  function sequence(operation){const task=tail.then(async()=>{if(closing)throw fault('ODATA_LIVE_CLOSED','Reopen live operations.');
    const lease=await acquireReleaseLease(root,'state.lock');try{return await operation();}finally{await lease.close();}});
    tail=task.catch(()=>{});return task;}
  async function profile(id){id=identifier(id,'live service ID');const value=await readJson(join(products,id,'profile.json'));
    if(value.schema!=='stellar-forge.odata-live-profile.v1'||value.id!==id)throw fault('ODATA_LIVE_PROFILE','The retained live service identity differs.',409);return value;}
  const publicRun=run=>run?{state:'RUNNING',mode:run.merchant.mode,url:run.merchant.url,operationsUrl:run.merchant.operations.url,
    startedAt:run.startedAt,snapshot:run.merchant.application.snapshot()}:null;
  const preparedProfile=record=>readPackage(join(products,record.id,'package'),{allowLoopback:record.settings.allowLoopback});
  async function status(){const records=(await workspace.state()).liveProducts;
    return {products:await Promise.all(records.map(async record=>({...record,runtime:publicRun(running.get(record.id)),
      lastRuntime:await readJson(join(products,record.id,'last-runtime.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;})}))) };}
  async function prepare(input){return sequence(async()=>{
    const id=identifier(input.id,'live service ID'),state=await workspace.state(),saved=state.plans.find(value=>value.id===input.planId);
    if(!saved?.reviewedAt)throw fault('ODATA_LIVE_QUERY','Choose a reviewed saved query.');
    const connection=state.connections.find(value=>value.id===saved.connectionId);
    const plan=await templateFromWorkspace(workspace,{planId:saved.id,publicOrigin:input.origin,payment:input.payment,amountAtomic:input.amount});
    const operation=plan.operations[0],operationId=input.operation||operation.id;
    plan.title=input.name||saved.name;operation.id=operationId;
    if(input.path)operation.path=input.path;
    if(input.maxPageRows!==undefined)operation.maxPageRows=input.maxPageRows;
    if(input.maxTotalRows!==undefined)operation.maxTotalRows=input.maxTotalRows;
    if(saved.query.plan.top!==undefined&&saved.query.plan.top!==null&&operation.maxTotalRows>saved.query.plan.top)
      throw fault('ODATA_LIVE_QUERY_LIMIT','The live query ceiling exceeds the reviewed source row limit.');
    const prepared=await prepareFromWorkspace(workspace,{planId:saved.id,plan,operation:operationId},{allowLoopback:connection.allowLoopback});
    const settings={port:port(input.port??0),operationsPort:port(input.operationsPort??0),facilitator:facilitator(input.facilitator),allowLoopback:connection.allowLoopback===true};
    const directory=join(products,id),record={schema:'stellar-forge.odata-live-profile.v1',id,name:prepared.plan.title,
      planId:saved.id,operation:operationId,sourceBinding:prepared.sourceBinding,createdAt:now(),settings,
      files:['profile.json',...packageFiles.map(name=>'package/'+name)]};
    try{const existing=await profile(id);if(existing.sourceBinding!==record.sourceBinding||stable(existing.settings)!==stable(settings))
        throw fault('ODATA_LIVE_EXISTS','Use a new service ID for changed source or runtime settings.',409);
      await preparedProfile(existing);await workspace.recordLiveProduct(existing);return existing;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    const stage=join(products,'.stage-'+id+'-'+randomUUID());await mkdir(stage,{mode:0o700});
    try{await writePackage(prepared,join(stage,'package'));await writeNew(join(stage,'profile.json'),formatted(record));
      await syncTree(stage);await rename(stage,directory);await syncDirectory(products);
    }finally{await rm(stage,{recursive:true,force:true});}
    await workspace.recordLiveProduct(record);return record;
  });}
  async function start({id}){return sequence(async()=>{
    const record=await profile(id);if(running.has(id))return publicRun(running.get(id));
    const directory=join(products,id),prepared=await preparedProfile(record);
    const lease=await acquireReleaseLease(directory,'run.lock');let merchant;
    try{
      let nativeFactory=null;
      if(record.settings.facilitator){
        if(nativeFactoryFor)nativeFactory=await nativeFactoryFor(record.settings.facilitator);
        else{const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),import('../native-factory.mjs')]);
          const facilitatorClient=new HTTPFacilitatorClient({url:record.settings.facilitator});nativeFactory=compiled=>createNativeSellerServer(compiled,{facilitatorClient});}
      }
      merchant=await startODataMerchant({plan:prepared.plan,catalog:prepared.catalog,directory:join(directory,'runtime'),env,
        port:record.settings.port,operationsPort:record.settings.operationsPort,nativeFactory,allowLoopback:record.settings.allowLoopback,navigationOrigin});
      const run={merchant,lease,startedAt:now()};running.set(id,run);
      const result=publicRun(run);await atomic(join(directory,'last-runtime.json'),result);return result;
    }catch(error){running.delete(id);try{await merchant?.close();}finally{await lease.close();}throw error;}
  });}
  async function stopOne(id){const run=running.get(id);if(!run)throw fault('ODATA_LIVE_OWNER','This operator does not have that live service open.',409);
    try{await run.merchant.close();await atomic(join(products,id,'last-runtime.json'),{state:'STOPPED',mode:run.merchant.mode,
      startedAt:run.startedAt,stoppedAt:now(),snapshot:run.merchant.application.snapshot()});}
    finally{running.delete(id);await run.lease.close();}
    return {id,state:'STOPPED'};}
  const stop=({id})=>sequence(()=>stopOne(identifier(id)));
  async function buyer({id,intentId,receivedId}){return sequence(async()=>{
    const record=await profile(id),directory=join(products,id),prepared=await preparedProfile(record);
    const request=receivedId?await readJson(join(directory,'receiving',identifier(receivedId),'next-request.json')):prepared.selection.request;
    if(typeof intentId!=='string'||!intentId.trim())throw fault('ODATA_LIVE_INTENT','Choose the original stable purchase intent.');
    const key=digest(stable({intentId,sourceBinding:record.sourceBinding})),parent=join(directory,'buyers'),target=join(parent,key);
    try{const existing=await readJson(join(target,'handoff.json'));
      if(existing.requestSha256!==digest(formatted(request)))throw fault('ODATA_LIVE_INTENT_CHANGED','That purchase intent already has a different request.',409);
      return {...existing,id:key,files:buyerFiles};}catch(error){if(error.code!=='ENOENT')throw error;}
    await mkdir(parent,{recursive:true,mode:0o700});const stage=join(parent,'.stage-'+key+'-'+randomUUID());
    try{const result=await prepareBuyerHandoff(prepared,{operation:record.operation,request,intentId,directory:stage,requestDirectory:target});
      await syncTree(stage);await rename(stage,target);await syncDirectory(parent);return {...result,id:key,files:buyerFiles};
    }finally{await rm(stage,{recursive:true,force:true});}
  });}
  async function receive({id,bodyBase64}){return sequence(async()=>{
    const record=await profile(id),directory=join(products,id),prepared=await preparedProfile(record);
    if(typeof bodyBase64!=='string'||!bodyBase64.length)throw fault('ODATA_LIVE_RESPONSE','Choose the original saved buyer response.');
    const bytes=Buffer.from(bodyBase64,'base64');if(bytes.toString('base64')!==bodyBase64)throw fault('ODATA_LIVE_RESPONSE','Send the original response as complete base64 bytes.');
    if(bytes.length>16*1024*1024)throw fault('ODATA_LIVE_RESPONSE_SIZE','The original response exceeds 16 MiB.',413);
    const key=digest(bytes),parent=join(directory,'receiving'),target=join(parent,key);
    try{const result=await readJson(join(target,'receiving.json'));return {...result,id:key,files:receivedFiles.filter(name=>name!=='next-request.json'||result.nextRequest)};}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await mkdir(parent,{recursive:true,mode:0o700});const source=join(parent,'.response-'+key+'-'+randomUUID()),stage=join(parent,'.stage-'+key+'-'+randomUUID());
    try{await writeNew(source,bytes);const result=await receivePage(prepared,{operation:record.operation,responsePath:source,directory:stage});
      await syncTree(stage);await rename(stage,target);await syncDirectory(parent);return {...result,directory:target,id:key,files:receivedFiles.filter(name=>name!=='next-request.json'||result.nextRequest)};
    }catch(error){if(error instanceof SyntaxError)throw fault('ODATA_LIVE_RESPONSE_JSON','Choose the original merchant JSON response.',422);throw error;}
    finally{await rm(source,{force:true});await rm(stage,{recursive:true,force:true});}
  });}
  async function file({id,kind='package',recordId,name}){await profile(id);
    const allowed=kind==='package'?packageFiles:kind==='buyer'?[...buyerFiles,'response.json']:kind==='receiving'?receivedFiles:null;
    if(!allowed?.includes(name))throw fault('ODATA_LIVE_FILE','Live service file not found.',404);
    const directory=kind==='package'?join(products,id,'package'):join(products,id,kind==='buyer'?'buyers':'receiving',identifier(recordId));
    return {bytes:await readFile(join(directory,name)),name};}
  async function detail(id){const record=await profile(id),prepared=await preparedProfile(record);
    const list=async(kind,manifest)=>{const directory=join(products,id,kind);let entries;
      try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
      const result=[];for(const entry of entries){if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
        try{result.push({id:entry.name,...await readJson(join(directory,entry.name,manifest))});}catch(error){if(error.code!=='ENOENT')throw error;}}
      return result;};
    return {...record,plan:prepared.plan,selection:prepared.selection,runtime:publicRun(running.get(id)),
      buyers:await list('buyers','handoff.json'),received:await list('receiving','receiving.json')};}
  async function close(){closing=true;await tail;let failure;for(const id of [...running.keys()])try{await stopOne(id);}catch(error){failure??=error;}if(failure)throw failure;}
  return {root,status,prepare,start,stop,buyer,receive,file,detail,close};
}

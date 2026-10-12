// MIT. Research retrieval through the original OpenAlex source or original SF88 buyer.
import {readdir,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {Buyer} from '../node/client.mjs';
import {readSuccessorRuntimeSource,verifySuccessorRuntimeSource,createRuntimeBoundBuyer} from '../node/runtime-source.mjs';
import {normalizeNativeFileReservation} from '../node/file-reservation.mjs';
import {privateDirectory,readBytes,readJson,writeBytes,writeJson,jsonBytes,digest,exists} from '../node/store.mjs';
import {readOpenAlexMerchant,requestFor,validateQuery,ENTITIES} from '../../sf30-seller-sdk/openalex/config.mjs';
import {createOpenAlexSource} from '../../sf30-seller-sdk/openalex/source.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {inspectSellerClientExport,readSellerClientFile} from '../../sf30-seller-sdk/developer/client-export.mjs';
import {createBuyerPageFetcher,canonical,ResearchError,MAX_PAGE_BYTES} from './workspace.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const check=(condition,code,message=code,status=400)=>{if(!condition)throw new ResearchError(code,message,status);};
const BINDING='stellar-forge.research-retrieval-binding.v1';
const copy=value=>JSON.parse(JSON.stringify(value));
async function exact(path,bytes){
  try{const previous=await readBytes(path,bytes.length);check(previous.equals(bytes),'RETRIEVAL_IDENTITY_CHANGED','Resume with the original request and retrieval configuration.',409);return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;check((await readBytes(path,bytes.length)).equals(bytes),'RETRIEVAL_IDENTITY_CHANGED',undefined,409);}
}
function validatePageRequest(request,entity){
  check(object(request)&&request.entity===entity&&object(request.parameters),'RETRIEVAL_ENTITY_MISMATCH');
  const {query}=validateQuery(entity,request.parameters,{kind:'list',requireFilter:true});
  check(typeof query.cursor==='string'&&query.cursor.length>0&&!query.page&&!query.group_by,'RESEARCH_CURSOR_REQUEST_REQUIRED');
  return query;
}
function tracked(work,closing){
  const pending=new Set();
  const fetchPage=input=>{
    check(!closing.value,'RETRIEVAL_CLOSED',undefined,503);
    const task=Promise.resolve().then(()=>work(input));pending.add(task);
    task.finally(()=>pending.delete(task)).catch(()=>{});return task;
  };
  return {fetchPage,async finish(){closing.value=true;await Promise.allSettled([...pending]);}};
}
function bind(fetchPage,binding){
  Object.defineProperty(fetchPage,'retrievalBinding',{value:Object.freeze(copy(binding)),enumerable:false});
}
function responseError(receipt,body){
  let code='OPENALEX_RESPONSE_FAILED',message='OpenAlex did not return a complete research page.';
  if(receipt.bodyKind==='SF30_FAILURE_PROJECTION')try{
    const value=JSON.parse(body.toString('utf8'));if(typeof value.error==='string')code=value.error;
    if(typeof value.message==='string')message=value.message;
  }catch{}
  return Object.assign(new ResearchError(code,message,receipt.status),{responseReceipt:receipt,
    ...(receipt.headers?.['retry-after']?{retryAfter:receipt.headers['retry-after']}:{})});
}
async function openDirect({merchantConfig,budgetDirectory,productId,env}){
  check(typeof merchantConfig==='string'&&typeof budgetDirectory==='string','DIRECT_CONFIGURATION_REQUIRED');
  const compiled=await readOpenAlexMerchant(merchantConfig),product=compiled.products.find(p=>p.id===productId);
  check(product&&product.kind==='list','RESEARCH_LIST_PRODUCT_REQUIRED','Choose one configured OpenAlex list product.');
  const source=await createOpenAlexSource(compiled,{budgetDirectory:resolve(budgetDirectory),env});
  try{
    const cache=await privateDirectory(join(source.budget.root,'research-received')),closing={value:false};
    const binding={schema:BINDING,mode:'OPENALEX_API',account:compiled.config.provider.account,
      budgetDirectory:await realpath(source.budget.root),entity:product.entity,productId,
      apiKeyEnv:compiled.config.provider.apiKeyEnv??null,providerOrigin:'https://api.openalex.org'};
    const operation=tracked(async({request,intentId,signal})=>{
      check(typeof intentId==='string'&&intentId.length>0&&intentId.length<=160,'RETRIEVAL_INTENT_REQUIRED');
      signal?.throwIfAborted();
      const query=validatePageRequest(request,product.entity),selected=requestFor(compiled,productId,query);
      const directory=await privateDirectory(join(cache,digest(intentId)));
      return withPrivateLock(directory,'received.lock',async()=>{
        const identity={schema:'stellar-forge.research-direct-intent.v1',intentId,binding,request,
          sourceUrl:selected.sourceUrl,requestSha256:digest(canonical(request))};
        await exact(join(directory,'request.json'),jsonBytes(identity));
        const names=(await readdir(directory,{withFileTypes:true})).filter(v=>v.isDirectory()&&/^attempt-[0-9a-f-]{36}$/.test(v.name)).map(v=>v.name).sort();
        for(const name of names){
          const folder=join(directory,name);
          let receipt;try{receipt=await readJson(join(folder,'response.json'),1048576);}catch(error){if(error.code==='ENOENT')continue;throw error;}
          check(receipt.schema==='stellar-forge.research-direct-response.v1'&&receipt.intentId===intentId&&
            receipt.requestSha256===identity.requestSha256,'RETRIEVAL_RECEIPT_CHANGED',undefined,409);
          let bytes;try{bytes=await readBytes(join(folder,'body.bin'),MAX_PAGE_BYTES);}catch(error){if(error.code==='ENOENT')continue;throw error;}
          check(bytes.length===receipt.bytes&&digest(bytes)===receipt.sha256,'RETRIEVAL_BYTES_CHANGED',undefined,409);
          if(receipt.status===200&&receipt.bodyKind==='ORIGINAL_PROVIDER_RESPONSE')
            return {bytes,source:receipt.source,reused:true,receipt:{path:join(folder,'response.json'),...receipt}};
        }
        let budget=await source.budget.snapshot(selected.estimatedCredits);
        while(!budget.allowed&&budget.retryAfterSeconds<=1){
          await pause(1000,undefined,{signal});budget=await source.budget.snapshot(selected.estimatedCredits);
        }
        if(!budget.allowed)throw Object.assign(new ResearchError('OPENALEX_BUDGET_EXHAUSTED',
          'The shared provider account is waiting for its reported capacity to reset.',429),{retryAfter:budget.retryAfterSeconds,budget});
        signal?.throwIfAborted();
        const folder=await privateDirectory(join(directory,'attempt-'+randomUUID()));
        await writeJson(join(folder,'request.json'),{...identity,startedAt:new Date().toISOString()},{exclusive:true});
        let response;
        try{response=await source.request(productId,query,{signal});}
        catch(error){
          await writeJson(join(folder,'failure.json'),{schema:'stellar-forge.research-direct-failure.v1',intentId,
            code:error.code??'SOURCE_CALL_FAILED',message:error.message,recordedAt:new Date().toISOString()},{exclusive:true}).catch(()=>{});
          throw error;
        }
        const original=Buffer.isBuffer(response.body),bytes=original?response.body:jsonBytes(response.body);
        const pageSource={kind:'OPENALEX_API',url:response.source?.url??selected.sourceUrl,
          retrievedAt:response.source?.retrievedAt??new Date().toISOString(),headers:response.headers??{}};
        const receipt={schema:'stellar-forge.research-direct-response.v1',intentId,
          requestSha256:identity.requestSha256,status:response.status,headers:response.headers??{},
          bodyKind:original?'ORIGINAL_PROVIDER_RESPONSE':'SF30_FAILURE_PROJECTION',
          sha256:digest(bytes),bytes:bytes.length,source:pageSource,
          providerObservation:response.source??null,recordedAt:new Date().toISOString()};
        // The complete returned response and its source identity survive before
        // the workspace starts publishing its own page. An interrupted receive
        // reuses these exact bytes instead of querying a moving cursor again.
        await writeJson(join(folder,'response.json'),receipt,{exclusive:true});
        await writeBytes(join(folder,'body.bin'),bytes,{exclusive:true});
        if(response.status!==200||!original)throw responseError(receipt,bytes);
        return {bytes,source:pageSource,receipt:{path:join(folder,'response.json'),...receipt}};
      });
    },closing);
    bind(operation.fetchPage,binding);
    return {mode:'OPENALEX_API',description:'OpenAlex direct API · '+product.entity+' · shared account '+compiled.config.provider.account,
      fetchPage:operation.fetchPage,acceptsEntity:entity=>entity===product.entity,
      async snapshot(){return {mode:'OPENALEX_API',entity:product.entity,productId,cacheDirectory:cache,...await source.snapshot()};},
      async close(){await operation.finish();await source.close();}};
  }catch(error){await source.close();throw error;}
}
const RUNTIME_SELECTION='stellar-forge.research-native-runtime-selection.v1';
async function openRuntimeSelection({stateDirectory,runtimeDirectory,binding,nativeRuntimeSource,nativeFileReservation}){
  const chosenSource=nativeRuntimeSource===undefined?undefined:copy(nativeRuntimeSource);
  const chosenReservation=normalizeNativeFileReservation(nativeFileReservation);
  const root=join(stateDirectory,'research-runtime-selections'),path=join(root,digest(canonical(binding))+'.json');
  let previous;try{previous=await readJson(path,1048576);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous!==undefined){
    check(object(previous)&&previous.schema===RUNTIME_SELECTION&&
      previous.originalRuntimeDirectory===runtimeDirectory&&canonical(previous.retrievalBinding)===canonical(binding)&&
      object(previous.runtimeSource)&&previous.runtimeSource.directory!==runtimeDirectory&&
      typeof previous.createdAt==='string','RESEARCH_RUNTIME_SELECTION_CHANGED',undefined,409);
    const checked=await verifySuccessorRuntimeSource(previous.runtimeSource);
    const savedReservation=normalizeNativeFileReservation(previous.nativeFileReservation);
    if(chosenSource!==undefined){
      const requested=await readSuccessorRuntimeSource(chosenSource);
      check(canonical(requested)===canonical(checked),'RESEARCH_RUNTIME_ALREADY_SELECTED',undefined,409);
    }
    if(chosenReservation!==undefined)
      check(canonical(chosenReservation)===canonical(savedReservation??null),'RESEARCH_RUNTIME_ALREADY_SELECTED',undefined,409);
    return{...previous,runtimeSource:checked,...(savedReservation===undefined?{}:{nativeFileReservation:savedReservation}),path};
  }
  if(chosenSource===undefined){
    check(chosenReservation===undefined,'RESEARCH_RUNTIME_SOURCE_REQUIRED',
      'Select the complete native source before enabling its file reservation provider.');
    return null;
  }
  const runtimeSource=await readSuccessorRuntimeSource(chosenSource);
  check(runtimeSource.directory!==runtimeDirectory,'RESEARCH_RUNTIME_MUST_BE_DISTINCT');
  await privateDirectory(root);
  const value={schema:RUNTIME_SELECTION,originalRuntimeDirectory:runtimeDirectory,
    retrievalBinding:copy(binding),runtimeSource,
    ...(chosenReservation===undefined?{}:{nativeFileReservation:chosenReservation}),
    createdAt:new Date().toISOString()};
  try{await writeJson(path,value,{exclusive:true});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    // A concurrent receiver may have chosen the same source. Reopen that exact
    // first published selection; neither caller replaces it or creates a page.
    return openRuntimeSelection({stateDirectory,runtimeDirectory,binding,
      nativeRuntimeSource:chosenSource,nativeFileReservation:chosenReservation});
  }
  return{...value,path};
}
async function routedNativeBuyer(original,selection){
  if(selection===null)return original;
  const selected=await createRuntimeBoundBuyer(original,selection.runtimeSource);
  return{
    operation(intentId){return original.operation(intentId);},
    async openOperation(intentId,options={}){
      const operation=original.operation(intentId);
      const saved=await readJson(join(operation.directory,'operation.json'));
      if(saved.runtimeDirectory===selected.runtime.directory){
        await verifySuccessorRuntimeSource(selection.runtimeSource,{signal:options.signal});
        return selected.openOperation(intentId,options);
      }
      // The original opener follows only the exact runtime choice bound to
      // this operation's parent. It does not prepare or follow another intent.
      return original.openOperation(intentId,options);
    },
    async fromRequest(request,options){
      await verifySuccessorRuntimeSource(selection.runtimeSource,{signal:request.signal});
      return selected.fromRequest(request,options);
    },
  };
}
async function openNative({buyerProfile,clientFile,clientOrigin,productId,env,nativeRuntimeSource,nativeFileReservation}){
  check(typeof buyerProfile==='string'&&typeof clientFile==='string','NATIVE_CONFIGURATION_REQUIRED');
  const profile=await readJson(resolve(buyerProfile),1048576);
  check(object(profile)&&typeof profile.runtimeDirectory==='string'&&typeof profile.stateDirectory==='string'&&
    Object.hasOwn(ENTITIES,profile.entity)&&profile.operatorProfile!==undefined,'NATIVE_PROFILE_INVALID',
    'Supply the original runtime, stable buyer state directory, original operator profile and selected entity.');
  check(object(profile.authorization)&&Object.keys(profile.authorization).every(k=>['acceptIndex','maxAtomic','paymentFlow'].includes(k))&&
    Number.isSafeInteger(profile.authorization.acceptIndex)&&profile.authorization.acceptIndex>=0&&
    typeof profile.authorization.maxAtomic==='string'&&/^(0|[1-9][0-9]*)$/.test(profile.authorization.maxAtomic)&&
    ['authorization','upfront'].includes(profile.authorization.paymentFlow),'NATIVE_AUTHORIZATION_REQUIRED',
    'Select the original payment option, per-page atomic ceiling and payment flow explicitly.');
  const file=resolve(clientFile);check(basename(file)==='seller-client.mjs','ORIGINAL_SELLER_CLIENT_REQUIRED');
  const inspected=await inspectSellerClientExport({directory:dirname(file),includeOffers:true});
  check(inspected.state==='COMPLETE','SELLER_CLIENT_EXPORT_INCOMPLETE','Complete or recover the original seller client export first.',409);
  check(clientOrigin===undefined||clientOrigin===inspected.origin,'SELLER_CLIENT_ORIGIN_CHANGED','Use the original generated client origin.',409);
  const selected=inspected.snapshot.operations.find(row=>row.id===productId);
  check(selected&&selected.method==='GET'&&selected.pathNames.length===0,'RESEARCH_LIST_PRODUCT_REQUIRED',
    'Choose a generated GET list operation without dynamic entity IDs.');
  const retained=await readSellerClientFile({directory:dirname(file),file:'seller-client.mjs',
    expectedManifestSha256:inspected.manifestFile.sha256});
  const generated=await import('data:text/javascript;base64,'+retained.bytes.toString('base64'));
  check(typeof generated.buildRequest==='function','ORIGINAL_SELLER_CLIENT_REQUIRED');
  const runtimeDirectory=await realpath(resolve(profile.runtimeDirectory));
  const stateDirectory=await privateDirectory(resolve(profile.stateDirectory));
  const runtimeOptions={environment:env};
  for(const key of ['node','timeoutMs','cleanupGraceMs','outputLimit'])if(profile[key]!==undefined)runtimeOptions[key]=profile[key];
  const operatorProfile=typeof profile.operatorProfile==='string'?await readJson(resolve(profile.operatorProfile),65536):copy(profile.operatorProfile);
  const binding={schema:BINDING,mode:'NATIVE_BUYER',entity:profile.entity,productId,
    buyerStateDirectory:await realpath(stateDirectory),operatorProfileSha256:digest(canonical(operatorProfile)),origin:inspected.origin,
    clientSourceSha256:inspected.sourceSha256,clientFilesSha256:inspected.filesSha256,
    authorization:copy(profile.authorization)};
  const runtimeSelection=await openRuntimeSelection({stateDirectory,runtimeDirectory,binding,nativeRuntimeSource,nativeFileReservation});
  const originalBuyer=new Buyer({runtimeDirectory,stateDirectory,operatorProfile,...runtimeOptions,
    ...(runtimeSelection?.nativeFileReservation===undefined?{}:{nativeFileReservation:runtimeSelection.nativeFileReservation})});
  await originalBuyer.ready();
  const buyer=await routedNativeBuyer(originalBuyer,runtimeSelection);
  const buyerOptions={};
  for(const key of ['responseFile','requestTimeoutMs'])if(profile[key]!==undefined)buyerOptions[key]=profile[key];
  const nativeFetch=createBuyerPageFetcher({buyer,buyerOptions,requestForPage:(request,{intentId,signal})=>{
    const query=validatePageRequest(request,profile.entity);
    return generated.buildRequest(productId,{query},{...profile.authorization,intentId,signal});
  }});
  const closing={value:false},operation=tracked(nativeFetch,closing);bind(operation.fetchPage,binding);
  return {mode:'NATIVE_BUYER',description:'Original native buyer · '+profile.entity+' · '+inspected.origin,
    fetchPage:operation.fetchPage,acceptsEntity:entity=>entity===profile.entity,
    openOperation(intentId,options){return buyer.openOperation(intentId,options);},
    async snapshot(){return {mode:'NATIVE_BUYER',entity:profile.entity,productId,origin:inspected.origin,
      buyerStateDirectory:binding.buyerStateDirectory,clientSourceSha256:inspected.sourceSha256,
      clientFilesSha256:inspected.filesSha256,authorization:copy(profile.authorization),
      runtimeSelection:runtimeSelection===null?null:{path:runtimeSelection.path,runtimeSource:runtimeSelection.runtimeSource,
        nativeFileReservation:runtimeSelection.nativeFileReservation??null}};},
    async close(){await operation.finish();}};
}

/** No signing, provider HTTP or payment engine is reimplemented here. */
export async function openResearchRetrieval(options={}){
  const {merchantConfig,budgetDirectory,productId,buyerProfile,clientFile,clientOrigin,
    nativeRuntimeSource,nativeFileReservation,env=process.env}=options;
  check(typeof productId==='string'&&productId.length>0,'RETRIEVAL_PRODUCT_REQUIRED');
  const selectedRuntime=nativeRuntimeSource===undefined?undefined:copy(nativeRuntimeSource);
  const selectedReservation=normalizeNativeFileReservation(nativeFileReservation);
  const direct=merchantConfig!==undefined,native=buyerProfile!==undefined;
  check(direct!==native,'RETRIEVAL_MODE_REQUIRED','Choose either a direct merchant configuration or an original native buyer profile.');
  if(direct){
    check(clientFile===undefined&&clientOrigin===undefined&&nativeRuntimeSource===undefined&&
      nativeFileReservation===undefined,'RETRIEVAL_MODE_CONFLICT');
    return openDirect({merchantConfig,budgetDirectory,productId,env});
  }
  check(budgetDirectory===undefined,'RETRIEVAL_MODE_CONFLICT','The native merchant owns its shared provider budget.');
  return openNative({buyerProfile,clientFile,clientOrigin,productId,env,
    nativeRuntimeSource:selectedRuntime,nativeFileReservation:selectedReservation});
}

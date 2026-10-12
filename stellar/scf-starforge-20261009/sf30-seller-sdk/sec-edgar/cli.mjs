#!/usr/bin/env node
// MIT. Import, query, export and operate original SEC editions and SF30 services.
import {parseArgs} from 'node:util';
import {readFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readEdgarMerchant,merchantReview,merchantOpenApi,buyerHandoff,sourceUrl,json,sha256,fail} from './config.mjs';
import {openEdgarStore,acquireEdgarCapture} from './source.mjs';
import {startEdgarMerchant,edgarNativeFactory} from './merchant.mjs';
import {generateSellerClient} from '../developer/client-generator.mjs';
import {privateDirectory,readBytes,writeBytes,exists} from '../../sf88-operator-buyer-cli/node/store.mjs';

export {buyerHandoff};
export async function exportEdgarMerchant(compiled,destination,{storeDirectory}={}){
  if(!storeDirectory)fail('Choose the existing source store to export complete selected editions.');
  const out=await privateDirectory(resolve(destination)),source=await openEdgarStore(storeDirectory);
  let receiving;
  const files={};
  async function exact(name,value){
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
    const path=join(out,name);
    await privateDirectory(resolve(path,'..'));
    if(await exists(path)){if(!(await readBytes(path,Math.max(bytes.length,1))).equals(bytes))fail('This export already contains another revision.',409,'EDGAR_EXPORT_CONFLICT');}
    else await writeBytes(path,bytes,{exclusive:true});
    files[name]={bytes:bytes.length,sha256:sha256(bytes)};
  }
  try{
    await exact('export-plan.json',json({schema:'stellar-forge.sec-edgar-export-plan.v1',inputSha256:compiled.inputSha256}));
    // Validate the real selected editions before producing their customer package.
    const editions=new Map();
    for(const product of compiled.products){
      await source.query(product.editionId,product,product.example);
      if(!editions.has(product.editionId))editions.set(product.editionId,(await source.getEdition(product.editionId)).record);
    }
    const openapi=Buffer.from(json(merchantOpenApi(compiled,'NATIVE_X402'))),generated=generateSellerClient(openapi);
    await exact('merchant.json',json(compiled.config));
    await exact('review.json',json(merchantReview(compiled)));
    await exact('seller-openapi.json',openapi);
    await exact('buyer-handoff.json',json(buyerHandoff(compiled)));
    for(const [name,value] of Object.entries({'seller-client.mjs':generated.javascript,'seller-client.d.mts':generated.declarations,
      'seller-openapi.json':openapi,'package.json':generated.packageJson,'README.md':generated.readme}))await exact('client/'+name,value);
    receiving=await openEdgarStore(join(out,'source-store'));
    for(const record of editions.values()){
      await receiving.importCapture({id:record.id,kind:record.kind,cik:record.cik,sourceUrl:record.sourceUrl,
        capturedAt:record.capturedAt,bytes:await source.readRaw(record.id)});
    }
    const manifest={schema:'stellar-forge.sec-edgar-merchant-export.v1',inputSha256:compiled.inputSha256,files,
      editions:[...editions.values()].map(r=>({id:r.id,kind:r.kind,cik:r.cik,sourceSha256:r.sourceSha256,
        sourceBytes:r.sourceBytes,capturedAt:r.capturedAt,sourceUrl:r.sourceUrl})),
      sourceStore:'source-store',client:'client/seller-client.mjs'};
    // The manifest describes the complete preceding files, not its own digest.
    const manifestBytes=json(manifest);await exact('manifest.json',manifestBytes);
    return {directory:out,merchant:join(out,'merchant.json'),sourceStore:join(out,'source-store'),
      clientDirectory:join(out,'client'),manifestSha256:sha256(manifestBytes),editions:manifest.editions};
  }finally{await receiving?.close();await source.close();}
}
const HELP='sec-edgar import|acquire|editions|query|review|export|serve|workspace\n'+
  'import --store DIR --id ID --kind facts|filings --cik CIK --input FILE [--source-url URL --captured-at TIME --source-sha256 SHA]\n'+
  'acquire --store DIR --id ID --kind facts|filings --cik CIK --quota-dir DIR [--history-file NAME]\n'+
  'editions --store DIR\nquery --store DIR --config FILE --product ID [--query JSON]\n'+
  'review --config FILE\nexport --store DIR --config FILE --out DIR\n'+
  'serve --store DIR --config FILE [--port N --operations-port N --facilitator URL --allow-local-facilitator]\n'+
  'workspace --store DIR --workspace DIR [--port N]\n';
function numeric(value,fallback,max=65535){
  if(value===undefined)return fallback;
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)fail('Use an integer command option.');
  return Number(value);
}
async function bytes(file){
  const path=resolve(file),s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>33554432)fail('Choose a regular SEC JSON file up to 32 MiB.');
  return readFile(path);
}
function handleSignals(service){
  let closing=false;
  const stop=async()=>{if(closing)return;closing=true;try{await service.close();}catch(error){process.stderr.write(json({error:error.code??'EDGAR_CLOSE_FAILED'}));process.exitCode=1;}};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
export async function main(args=process.argv.slice(2)){
  const {values:v,positionals}=parseArgs({args,allowPositionals:true,strict:true,options:{
    config:{type:'string'},store:{type:'string'},input:{type:'string'},id:{type:'string'},kind:{type:'string'},cik:{type:'string'},
    'source-url':{type:'string'},'captured-at':{type:'string'},'source-sha256':{type:'string'},
    'quota-dir':{type:'string'},'history-file':{type:'string'},'requests-per-second':{type:'string'},'calls-per-day':{type:'string'},
    product:{type:'string'},query:{type:'string'},out:{type:'string'},port:{type:'string'},'operations-port':{type:'string'},
    facilitator:{type:'string'},'allow-local-facilitator':{type:'boolean'},workspace:{type:'string'},
    'availability-dir':{type:'string'},'history-dir':{type:'string'},help:{type:'boolean'}
  }});
  const command=positionals[0];
  if(v.help||!command){process.stdout.write(HELP);return;}
  if(positionals.length!==1||!['import','acquire','editions','query','review','export','serve','workspace'].includes(command))fail(HELP);
  if(command==='review'){if(!v.config)fail('Use --config FILE.');process.stdout.write(json(merchantReview(await readEdgarMerchant(v.config))));return;}
  if(!v.store)fail('Use --store DIR for the selected original editions.');
  if(command==='workspace'){
    if(!v.workspace)fail('Use --workspace DIR for the retained operator drafts.');
    const {startEdgarWorkspace}=await import('./server.mjs');
    const service=await startEdgarWorkspace({directory:resolve(v.workspace),storeDirectory:resolve(v.store),port:numeric(v.port,0)});
    process.stdout.write(json({url:service.url,workspace:resolve(v.workspace)}));handleSignals(service);return service;
  }
  if(['export','serve','query'].includes(command)){
    if(!v.config)fail('Use --config FILE.');
    const compiled=await readEdgarMerchant(v.config);
    if(command==='export'){if(!v.out)fail('Use --out DIR.');process.stdout.write(json(await exportEdgarMerchant(compiled,v.out,{storeDirectory:resolve(v.store)})));return;}
    if(command==='serve'){
      const nativeFactory=await edgarNativeFactory(v.facilitator,{allowLocalFacilitator:v['allow-local-facilitator']??false});
      const service=await startEdgarMerchant(compiled,{storeDirectory:resolve(v.store),nativeFactory,port:numeric(v.port,0),
        operationsPort:v['operations-port']===undefined?undefined:numeric(v['operations-port']),
        availabilityDirectory:v['availability-dir']?resolve(v['availability-dir']):undefined,
        historyDirectory:v['history-dir']?resolve(v['history-dir']):undefined});
      process.stdout.write(json(await service.snapshot()));handleSignals(service);return service;
    }
    if(!v.product)fail('Use --product ID.');
    const product=compiled.products.find(p=>p.id===v.product);if(!product)fail('Choose a configured product.');
    let query;try{query=JSON.parse(v.query??'{}');}catch{fail('Use a JSON object for --query.');}
    const store=await openEdgarStore(resolve(v.store));
    try{process.stdout.write(json((await store.query(product.editionId,product,query)).body));}finally{await store.close();}
    return;
  }
  const store=await openEdgarStore(resolve(v.store));
  try{
    if(command==='editions'){process.stdout.write(json(await store.listEditions()));return;}
    if(!v.id||!v.kind||!v.cik)fail('Use --id, --kind and --cik.');
    let result;
    if(command==='import'){
      if(!v.input)fail('Use --input FILE.');const raw=await bytes(v.input);
      if(v['source-sha256']&&sha256(raw)!==v['source-sha256'])fail('The selected source does not match its original digest.',409,'EDGAR_SOURCE_CHANGED');
      result=await store.importCapture({id:v.id,kind:v.kind,cik:v.cik,
        sourceUrl:v['source-url']??sourceUrl(v.kind,v.cik),capturedAt:v['captured-at'],bytes:raw});
    }else result=await acquireEdgarCapture({store,id:v.id,kind:v.kind,cik:v.cik,
      userAgent:process.env.SEC_EDGAR_USER_AGENT,quotaDirectory:v['quota-dir']?resolve(v['quota-dir']):undefined,
      historyFile:v['history-file'],requestsPerSecond:numeric(v['requests-per-second'],2,10),
      callsPerDay:numeric(v['calls-per-day'],1000,1000000)});
    process.stdout.write(json(result));
  }finally{await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(json({error:error.code??'EDGAR_COMMAND_FAILED',message:error.message}));process.exitCode=1;});
}


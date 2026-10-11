// One joined original Census publisher, version-store, SF88/SF100 and consumer journey.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, rename, lstat, realpath, open } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const options={};
for(let i=2;i<process.argv.length;i+=2){
 const key=process.argv[i],value=process.argv[i+1];
 if(!['--checkout','--inputs','--run','--python','--peoria-source'].includes(key)||
    Object.hasOwn(options,key)||!value||value.startsWith('--'))throw Error('Invalid or duplicate option: '+key);
 options[key]=value;
}
for(const key of ['--checkout','--inputs','--run','--python','--peoria-source'])
 if(!options[key])throw Error('Required option: '+key);
const OPERATION='CENSUS-ACS-NATIVE-4BF5-20261011';
const SOURCE_COMMIT='8716f9b6774330330b1937b4bfba6428a65c83db';
const SOURCE=resolve(options['--checkout']);
const NATIVE=join(SOURCE,'stellar/scf-starforge-20261009');
const RUN=resolve(options['--run']);
const ROOT=RUN;
const INPUTS=resolve(options['--inputs']);
const PYTHON=resolve(options['--python']);
const PEORIA=resolve(options['--peoria-source']);
const HERE=dirname(fileURLToPath(import.meta.url));
const EXPECTED_INPUTS={
 2023:{archive:'d41ab05d13a7e11e4e62a25ec33d9847dc8d9f22e0f50913006726f6ab988fd7',native:'23115cea68ed5d0e8250b717f8c9789713f9a8b39288b670451eb69fd1cb65e0',workbook:'c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807'},
 2024:{archive:'18b31bd329276cbf1e3288d49d023ae45fe99c8d05880570748d86a3f53b62d7',native:'0d06d7db2d45c0003424515f00e8017a54428194c29d95f41ef8d509b2cff054',workbook:'14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5'}
};
const HASHES={2023:'830ca9e4a8c2f386d66b1be4ef2b4877ff2e6a1b6f1bd72b9b0db79dd25c3598',2024:'fd511a0887a4be43cfa5265beb48224ff68f995cda3e1dcc1d3c9cc12cf19fd6'};
const MANIFEST='_census/capture-manifest.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
const native=path=>import(pathToFileURL(join(NATIVE,path)).href);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function exact(path,data){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 if(await exists(path)){assert.deepEqual(await readFile(path),Buffer.from(data),'retained file changed: '+path);return;}
 await writeFile(path,data,{mode:0o600,flag:'wx'});
}
async function atomic(path,value){
 const temp=path+'.'+randomUUID()+'.tmp';
 const file=await open(temp,'wx',0o600);
 try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}
 await rename(temp,path);
 const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
}
async function command(program,args,{parse=true}={}){
 const child=spawn(program,args,{cwd:ROOT,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',NODE_OPTIONS:'--max-old-space-size=128'},stdio:['ignore','pipe','pipe']});
 let output='',error='';
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);
 child.on('error',e=>{error+=e.stack;});
 const [code]=await once(child,'close');
 if(code!==0)throw Object.assign(new Error('Native companion failed: '+error+'\n'+output),{code:'NATIVE_COMPANION_FAILED'});
 return parse?JSON.parse(output):output.trim();
}
await mkdir(RUN,{recursive:true,mode:0o700});
assert.equal(await realpath(RUN),RUN,'Run directory must be an original absolute directory');
assert.equal((await lstat(RUN)).mode&0o077,0,'Run directory must be private');
assert.equal(await realpath(SOURCE),SOURCE,'Checkout must resolve to its original source directory');
assert.equal(await command('git',['-C',SOURCE,'rev-parse','--show-toplevel'],{parse:false}),SOURCE);
await command('git',['-C',SOURCE,'merge-base','--is-ancestor',SOURCE_COMMIT,'HEAD'],{parse:false});
await command('git',['-C',SOURCE,'diff','--exit-code',SOURCE_COMMIT,'--','stellar/scf-starforge-20261009','stellar-forge'],{parse:false});
const inputBytes=await readFile(INPUTS);
const inputs=JSON.parse(inputBytes);
assert.equal(inputs.schema,'stellar-forge.census-native-inputs.v1');
const binding={sourceCommit:SOURCE_COMMIT,source:SOURCE,inputsSha256:hash(inputBytes),run:RUN,peoriaSource:PEORIA,python:PYTHON};
const statePath=join(RUN,'journey-state.json');
const state=await exists(statePath)?await json(statePath):{schema:'census-original-native-journey.v1',startedAt:new Date().toISOString(),candidates:{},sessions:{},boundaries:{buyer:'Original SF88 trusted executePage seam with original X402BuyerClient, SF31 writer and SF82 evidence; free HTTP transport to the original version store.',merchant:'Original SF30 CHALLENGE_ONLY seller exposes actual offers, snapshot metadata and private publication control.'}};
if(state.binding)assert.deepEqual(state.binding,binding,'Reopen this operation with its original source, inputs and directories');
else state.binding=binding;
const save=()=>atomic(statePath,state);
async function progress(phase,details={}){
 state.phase={phase,at:new Date().toISOString(),...details};await save();
 console.log(JSON.stringify({operation:OPERATION,pid:process.pid,host:hostname(),...state.phase}));
}
if(state.complete){console.log(JSON.stringify(state.result));process.exit(0);}
let publisher,seller,versions,preview;
let requests=0,signatures=0;
try{
 await progress('STARTED',{node:process.version,sourceCommit:SOURCE_COMMIT,run:RUN});
 for(const year of [2023,2024]){
  const input=inputs.releases?.[year];assert(input,'Original input release missing: '+year);
  const paths={};
  for(const [kind,key] of [['archive','archive'],['native','nativePackage'],['workbook','workbook']]){
   paths[kind]=resolve(dirname(INPUTS),input[key]);
   assert.equal(hash(await readFile(paths[kind])),EXPECTED_INPUTS[year][kind],kind+' input changed for '+year);
  }
  assert.equal(basename(paths.workbook),year+'_Jam_Values.xlsx');
  const receipt=resolve(dirname(INPUTS),input.receipt);
  await readFile(receipt);
  const annotation=join(RUN,'annotation-'+year+'.json');
  await exact(annotation,Buffer.from(JSON.stringify({year,file:paths.workbook,receipt,
   source_url:'https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/'+year+'_Jam_Values.xlsx'},null,2)+'\n'));
  const dest=join(RUN,'capture-'+year);
  if(!await exists(dest)){
   const imported=await command(PYTHON,[join(NATIVE,'sf30-seller-sdk/census-acs/capture.py'),'import',
    '--archive',paths.archive,'--native-package',paths.native,'--annotation',annotation,'--out',dest]);
   assert.equal(imported.capture_id,HASHES[year]);
  }
  const manifestBytes=await readFile(join(dest,MANIFEST));assert.equal(hash(manifestBytes),HASHES[year]);
  const manifest=JSON.parse(manifestBytes);
  for(const file of manifest.files){
   const data=await readFile(join(dest,file.path));assert.equal(data.length,file.bytes);assert.equal(hash(data),file.sha256);
  }
  await progress('CAPTURE_READY',{year,captureId:HASHES[year],files:manifest.files.length});
 }
 const sourceFile=join(RUN,'source.json'),workspace=join(RUN,'publisher'),target=join(RUN,'version-store');
 async function activate(year){
  const args=[join(NATIVE,'sf30-seller-sdk/census-acs/capture.py'),'activate','--capture',join(RUN,'capture-'+year),'--source',sourceFile];
  args.push(...((await exists(sourceFile))?['--expect-source-sha',hash(await readFile(sourceFile))]:['--create']));
  const result=await command(PYTHON,args);assert.equal(result.capture_id,HASHES[year]);return result;
 }
 if(!await exists(sourceFile))await activate(2023);
 const {openCensusPublisher}=await native('sf30-seller-sdk/census-acs/publisher/model.mjs');
 const {censusPlanTemplate}=await native('sf30-seller-sdk/census-acs/publisher/plan.mjs');
 const {openDatasetVersions,DATASET_SNAPSHOT_PARAMETER}=await native('sf30-seller-sdk/dataset-refresh/versions.mjs');
 const {startVersionedDatasetSeller}=await native('sf30-seller-sdk/dataset-refresh/service.mjs');
 const {buildDatasetSellerConfig}=await native('sf30-seller-sdk/dataset-cli.mjs');
 publisher=await openCensusPublisher({directory:workspace,create:!await exists(join(workspace,'workspace.json')),sourceFile,targetDirectory:target});
 async function candidate(year){
  const key=String(year);
  if(state.candidates[key]?.run){
   const saved=publisher.run(state.candidates[key].run);
   assert(saved.data.candidate,'Saved candidate unavailable: '+saved.state);
   return saved;
  }
  await activate(year);
  const template=await censusPlanTemplate(sourceFile,'source_files','ACS original source files');
  const prior=publisher.status({limit:100}).plans.find(p=>p.data.captureHash===HASHES[year]&&p.data.query==='source_files');
  const plan=prior??await publisher.savePlan(template);
  const id=state.candidates[key]?.runIntent??randomUUID();
  state.candidates[key]={plan:plan.id,runIntent:id,captureHash:HASHES[year]};await save();
  const old=publisher.status({limit:100}).runs.find(r=>r.id===id);
  const saved=old??await publisher.startExtraction(plan.id,{id}).completion;
  assert.equal(saved.state,'READY',JSON.stringify(saved));
  state.candidates[key]={...state.candidates[key],run:id,snapshot:saved.data.candidate.dataset.snapshot,rows:saved.data.candidate.dataset.rowCount};await save();
  return saved;
 }
 async function publish(year,initialize){
  const saved=await candidate(year);
  if(saved.state==='PUBLISHED')return saved;
  const observed=await publisher.target();
  const review=await publisher.review(saved.id,{reviewer:'ASTRA-4BF5',note:'Original captured ACS '+year+' source-file inventory, native package, original year-matched annotation and byte digests reviewed together.',initialize,expectedSnapshot:observed.versions?.current,expectedRevision:observed.versions?.revision});
  const result=await publisher.publish(saved.id,review.data.review.id);assert.equal(result.state,'PUBLISHED',JSON.stringify(result));return result;
 }
 await publish(2023,true);
 await progress('PUBLISHED_2023',{snapshot:state.candidates[2023].snapshot});
 versions=await openDatasetVersions({directory:target});
 const payment={scheme:'exact',network:'stellar:testnet',asset:'C'+'A'.repeat(55),payTo:'G'+'A'.repeat(55),amount:'100',maxTimeoutSeconds:60};
 const config=await buildDatasetSellerConfig(versions,{payment,origin:'https://census-native.example',path:'/data'});
 config.routes[0].definition.queryParameters.push(DATASET_SNAPSHOT_PARAMETER);
 seller=await startVersionedDatasetSeller({versions,config,port:0,controlTransport:'loopback'});
 await publisher.close();
 publisher=await openCensusPublisher({directory:workspace,seller:seller.url,resource:'https://census-native.example/data'});
 preview=createServer(versions.wrapRequest(async(req,res)=>{
  requests++;
  const controller=new AbortController();
  res.once('close',()=>{if(!res.writableFinished)controller.abort();});
  try{
   const url=new URL(req.url,'https://census-native.example');
   if(req.method!=='GET'||url.pathname!=='/data'){res.writeHead(404);res.end();return;}
   const context={url,query:url.searchParams,signal:controller.signal};
   const admitted=await versions.admit(context,{allowSnapshot:true});
   const response=admitted===true?await versions.handle(context,{allowSnapshot:true}):admitted;
   res.writeHead(response.status,response.headers);res.end(JSON.stringify(response.body));
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.code??error.message}));}
 }));
 preview.listen(0,'127.0.0.1');await once(preview,'listening');
 const local='http://127.0.0.1:'+preview.address().port;
 const {X402BuyerClient}=await native('sf31-buyer-client/buyer.mjs');
 const {prepareBuyerResponseFile}=await native('sf31-buyer-client/response-file.mjs');
 const {executeWithEvidence}=await native('sf82-checkout-evidence/evidence.mjs');
 const {createDatasetSession,runDatasetSession,inspectDatasetSession,recoverDatasetSession}=await native('sf88-operator-buyer-cli/dataset-session.mjs');
 const buyer=new X402BuyerClient({fetchImpl:(url,options)=>{
  const requested=new URL(url);assert.equal(requested.origin,'https://census-native.example');
  return fetch(local+requested.pathname+requested.search,options);
 }});
 async function executeFreePage(cfg,{signal}={}){
  const writer=await prepareBuyerResponseFile(cfg.responseFile);let saved,evidence;
  try{
   evidence=await executeWithEvidence({buyer:{async call(options){
    const result=await buyer.call({...options,approve:async()=>{throw Error('Unexpected paid response on original free transport');},sign:async()=>{signatures++;throw Error('Unexpected signing request');}});
    saved=await writer.save(result,{signal});return result;
   }},call:{...cfg.operation,signal},outputDir:cfg.evidenceDir,captureBody:false});
  }finally{await writer.abort();}
  assert.equal(evidence.error,null);
  assert.equal(evidence.result.status,'NO_PAYMENT_REQUIRED');
  return{mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId:cfg.operation.intentId,status:evidence.result.status,httpStatus:evidence.result.response.status,sellerReportedSettlement:evidence.result.settlement,evidencePath:evidence.evidencePath,originalOutcomeReport:evidence.report,operatorReservation:null,responseFile:{status:'SAVED',...saved},interrupted:false,retry:'NO_AUTOMATIC_RETRY'};
 }
 async function session(year){
  const dir=join(RUN,'acquisition-'+year);
  if(!await exists(join(dir,'session.json'))){
   const offer=await publisher.buyerOffer(state.candidates[year].run,'limit=10');
   const prepared=await publisher.prepareBuyer(state.candidates[year].run,{query:'limit=10',intentId:'census-source-files-'+year+'-4bf5',acceptIndex:0,offerSha256:offer.offerSha256});
   const cfg=prepared.config;
   cfg.operator={python:PYTHON,actor:'census-native-4bf5',service:'census-original-acquisition',policy:join(RUN,'unused-free-policy.json'),ledger:join(RUN,'unused-free-ledger.sqlite')};
   cfg.signerModule=join(RUN,'unused-free-signer.mjs');cfg.evidenceDir=RUN;cfg.captureBody=false;
   const configPath=join(RUN,'buyer-'+year+'.json');await exact(configPath,Buffer.from(JSON.stringify(cfg,null,2)+'\n'));
   await createDatasetSession({directory:dir,configPath,maxPages:200,maxTotalAtomic:'20000',maxRows:100000,maxPageBytes:1048576,expectedSnapshot:state.candidates[year].snapshot});
   state.sessions[year]={directory:dir,offerSha256:offer.offerSha256,preparedConfigSha256:prepared.configSha256};await save();
  }
  return dir;
 }
 const firstSession=await session(2023);
 let first=await inspectDatasetSession(firstSession);
 if(first.status==='READY'&&first.completedPages===0){
  const controller=new AbortController();
  first=await runDatasetSession(firstSession,{executePage:executeFreePage,signal:controller.signal,emitPageSummaries:false,onPage:()=>controller.abort()});
  assert.equal(first.completedPages,1);state.paused2023={pages:first.completedPages,rows:first.acquiredRows,snapshot:first.expectedSnapshot,firstResponseSha256:hash(await readFile(first.pages[0].responsePath))};await save();
 }
 if(!state.paused2023&&first.completedPages===1){
  state.paused2023={pages:1,rows:first.acquiredRows,snapshot:first.expectedSnapshot,
   firstResponseSha256:hash(await readFile(first.pages[0].responsePath))};await save();
 }
 assert(state.paused2023,'Retained first-page pause receipt is required');
 await progress('ACQUISITION_2023_PAUSED',state.paused2023);
 await publish(2024,false);
 await progress('PUBLISHED_2024',{snapshot:state.candidates[2024].snapshot});
 const afterRefresh=versions.status();
 const resumed=await runDatasetSession(firstSession,{executePage:executeFreePage,emitPageSummaries:false});
 assert.equal(resumed.status,'COMPLETE',JSON.stringify(resumed));
 assert.equal(hash(await readFile(resumed.pages[0].responsePath)),state.paused2023.firstResponseSha256);
 const secondSession=await session(2024);
 const second=await runDatasetSession(secondSession,{executePage:executeFreePage,emitPageSummaries:false});
 assert.equal(second.status,'COMPLETE',JSON.stringify(second));
 const beforeReplay=requests;
 await runDatasetSession(firstSession,{executePage:executeFreePage,emitPageSummaries:false});
 await runDatasetSession(secondSession,{executePage:executeFreePage,emitPageSummaries:false});
 assert.equal(requests,beforeReplay);
 const last=join(firstSession,'pages',String(resumed.completedPages).padStart(6,'0'),'result.json');
 const retained=last+'.retained-original';
 if(!await exists(retained))await rename(last,retained);
 const recovered=await recoverDatasetSession(firstSession);
 assert.equal(recovered.status,'COMPLETE');assert.equal(recovered.pages.at(-1).recoveredFromOriginalFiles,true);
 assert.equal(requests,beforeReplay);
 await progress('ACQUIRED_BOTH_RELEASES',{pages2023:resumed.completedPages,pages2024:second.completedPages,nativeRequests:requests});
 const consumer=await command(PYTHON,[join(HERE,'receive_and_assemble.py'),'--checkout',SOURCE,'--run',RUN,'--node',process.execPath,'--peoria-source',PEORIA]);
 assert.equal(requests,beforeReplay);
 assert.equal(signatures,0);
 state.result={status:'PASS',operation:OPERATION,sourceCommit:SOURCE_COMMIT,host:hostname(),pid:process.pid,source2023:HASHES[2023],source2024:HASHES[2024],snapshots:{2023:state.candidates[2023].snapshot,2024:state.candidates[2024].snapshot},current:afterRefresh.current,pages:{2023:resumed.completedPages,2024:second.completedPages},rows:{2023:resumed.acquiredRows,2024:second.acquiredRows},nativeRequests:requests,signatures,recoveredOriginalPage:true,consumer};
 state.complete=true;state.completedAt=new Date().toISOString();await save();
 await atomic(join(RUN,'journey-result.json'),state.result);console.log(JSON.stringify(state.result));
}catch(error){
 state.failure={at:new Date().toISOString(),code:error.code??null,message:error.message,stack:error.stack};try{await save();}catch{}
 console.error(error.stack);process.exitCode=1;
}finally{
 try{await publisher?.close();}finally{
  if(preview){preview.closeAllConnections?.();await new Promise(done=>preview.close(done));}
  if(seller)await seller.close();else await versions?.close();
 }
}

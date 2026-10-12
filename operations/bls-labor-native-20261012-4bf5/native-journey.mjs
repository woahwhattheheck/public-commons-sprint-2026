#!/usr/bin/env node
// Original publisher, SF88 pages, SF100 delivery and application receiving journey.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir, lstat, realpath, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const opt = {}, allowed = new Set(['--checkout','--source-file','--capture-id','--run','--python','--vitality-source']);
for (let i=2; i<process.argv.length; i+=2) {
  assert(allowed.has(process.argv[i]) && !Object.hasOwn(opt,process.argv[i]) && process.argv[i+1], 'Invalid or repeated option');
  opt[process.argv[i]] = process.argv[i+1];
}
for (const key of allowed) assert(opt[key], key+' is required');
assert(/^[a-f0-9]{64}$/.test(opt['--capture-id']));
const SOURCE_COMMIT='b4696a15f790d7a6c1653b90117a6ba8e63eb002';
const OPERATION='BLS-LABOR-NATIVE-4BF5-20261011';
const SOURCE=resolve(opt['--checkout']), INPUT=resolve(opt['--source-file']);
const ROOT=resolve(opt['--run']), PYTHON=resolve(opt['--python']), VITALITY=resolve(opt['--vitality-source']);
const NATIVE=join(SOURCE,'stellar/scf-starforge-20261009');
const HERE=dirname(fileURLToPath(import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
const native=p=>import(pathToFileURL(join(NATIVE,p)).href);
async function exists(path) { try { await lstat(path); return true; } catch(e) { if(e.code==='ENOENT')return false; throw e; } }
async function exact(path,bytes) {
  if(await exists(path)) { assert.deepEqual(await readFile(path),bytes,'Retained original file changed: '+path); return; }
  await writeFile(path,bytes,{flag:'wx',mode:0o600});
}
async function save(path,value) {
  const temporary=path+'.new'; await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(temporary,path);
}
async function runPython(args) {
  return await new Promise((resolve,reject)=>{
    const child=spawn(PYTHON,args,{cwd:ROOT,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
    let out='',error='';
    child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>{error+=b;process.stderr.write(b);});
    child.once('error',reject); child.once('exit',(code,signal)=>{
      if(code===0){try{resolve(JSON.parse(out));}catch(e){reject(e);}}
      else reject(Object.assign(Error('Original Python receiving failed'),{code,signal,stderr:error}));
    });
  });
}
for(const p of [SOURCE,INPUT,PYTHON,VITALITY]) assert.equal(await realpath(p),p,'Canonical original path required: '+p);
await mkdir(ROOT,{recursive:true,mode:0o700}); assert.equal(await realpath(ROOT),ROOT);
assert.equal((await lstat(ROOT)).mode & 0o077,0,'Use a private native run directory');
const sourceIndex=await readJSON(join(HERE,'source-index.json'));
assert.equal(sourceIndex.sourceCommit,SOURCE_COMMIT);
let checked=0;
for(const entry of sourceIndex.files) {
  const path=join(SOURCE,entry.path);
  if(!await exists(path)){assert(!entry.required,'Missing original entrypoint: '+entry.path);continue;}
  const data=await readFile(path);
  assert.equal(blob(data),entry.sha,'Source differs from selected original Git object: '+entry.path);
  checked++;
}
const inputHash=hash(await readFile(INPUT)), statePath=join(ROOT,'native-operation.json');
const binding={operation:OPERATION,sourceCommit:SOURCE_COMMIT,source:SOURCE,input:INPUT,inputHash,
  captureId:opt['--capture-id'],run:ROOT,python:PYTHON,vitality:VITALITY};
const state=await exists(statePath)?await readJSON(statePath):{schema:'bls-original-native-journey.v1',binding,runId:randomUUID()};
assert.deepEqual(state.binding,binding,'Use the retained operation with the same original input');
await save(statePath,state);
async function progress(phase,fields={}) {
  state.phase={phase,at:new Date().toISOString(),host:hostname(),pid:process.pid,...fields};
  await save(statePath,state); console.log(JSON.stringify({operation:OPERATION,...state.phase}));
}
if(state.result){console.log(JSON.stringify(state.result));process.exit(0);}
let publisher,versions,seller,preview;
let requests=0,signatures=0;
try {
  await progress('SOURCE_READY',{sourceCommit:SOURCE_COMMIT,sourceFilesChecked:checked,node:process.version,execArgv:process.execArgv});
  const {readBlsSource}=await native('sf30-seller-sdk/bls-labor/source.mjs');
  const source=await readBlsSource(INPUT);
  assert.equal(source.captureHash,binding.captureId);
  const {openBlsPublisher}=await native('sf30-seller-sdk/bls-labor/publisher/model.mjs');
  const {blsPlanTemplate}=await native('sf30-seller-sdk/bls-labor/publisher/plan.mjs');
  const {openDatasetVersions,DATASET_SNAPSHOT_PARAMETER}=await native('sf30-seller-sdk/dataset-refresh/versions.mjs');
  const {startVersionedDatasetSeller}=await native('sf30-seller-sdk/dataset-refresh/service.mjs');
  const {buildDatasetSellerConfig}=await native('sf30-seller-sdk/dataset-cli.mjs');
  const workspace=join(ROOT,'publisher'), target=join(ROOT,'versions');
  publisher=await openBlsPublisher({directory:workspace,create:!await exists(join(workspace,'workspace.json')),
    sourceFile:INPUT,targetDirectory:target});
  let candidate=publisher.status({limit:100}).runs.find(row=>row.id===state.runId);
  if(!candidate) {
    const plans=publisher.status({limit:100}).plans.filter(row=>row.data.captureHash===binding.captureId&&row.data.query==='source_files');
    assert(plans.length<=1,'Choose the existing original publication plan');
    const plan=plans[0]??await publisher.savePlan(await blsPlanTemplate(INPUT,'source_files','Original BLS source capture'));
    candidate=await publisher.startExtraction(plan.id,{id:state.runId}).completion;
  }
  assert(['READY','PUBLISHED'].includes(candidate.state),'Inspect or recover the retained original extraction: '+candidate.state);
  state.snapshot=candidate.data.candidate.dataset.snapshot;
  state.rows=candidate.data.candidate.dataset.rowCount; await save(statePath,state);
  if(candidate.state==='READY') {
    const observed=await publisher.target();
    const review=await publisher.review(candidate.id,{reviewer:'ASTRA-4BF5',
      note:'Complete original LAUS/QCEW source files, dictionary sources and adjacent capture receipts.',
      initialize:true,expectedSnapshot:observed.versions?.current,expectedRevision:observed.versions?.revision});
    candidate=await publisher.publish(candidate.id,review.data.review.id);
    assert.equal(candidate.state,'PUBLISHED');
  }
  await progress('PUBLISHED',{snapshot:state.snapshot,rows:state.rows,captureId:binding.captureId});
  versions=await openDatasetVersions({directory:target});
  const origin='https://bls-native.example',resource=origin+'/data';
  const payment={scheme:'exact',network:'stellar:testnet',asset:'C'+'A'.repeat(55),
    payTo:'G'+'A'.repeat(55),amount:'100',maxTimeoutSeconds:60};
  const config=await buildDatasetSellerConfig(versions,{payment,origin,path:'/data'});
  config.routes[0].definition.queryParameters.push(DATASET_SNAPSHOT_PARAMETER);
  seller=await startVersionedDatasetSeller({versions,config,port:0,controlTransport:'loopback'});
  await publisher.close(); publisher=await openBlsPublisher({directory:workspace,seller:seller.url,resource});
  // Original data admission and query handlers serve actual HTTP pages to the
  // native buyer's documented free-response execution seam.
  preview=createServer(versions.wrapRequest(async(req,res)=>{
    requests++;
    const controller=new AbortController();
    res.once('close',()=>{if(!res.writableFinished)controller.abort();});
    try {
      const url=new URL(req.url,origin);
      if(req.method!=='GET'||url.pathname!=='/data'){res.writeHead(404);res.end();return;}
      const context={url,query:url.searchParams,signal:controller.signal};
      const admitted=await versions.admit(context,{allowSnapshot:true});
      const result=admitted===true?await versions.handle(context,{allowSnapshot:true}):admitted;
      res.writeHead(result.status,result.headers);res.end(JSON.stringify(result.body));
    } catch(error) {res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.code??error.message}));}
  }));
  preview.listen(0,'127.0.0.1'); await once(preview,'listening');
  const local='http://127.0.0.1:'+preview.address().port;
  const {X402BuyerClient}=await native('sf31-buyer-client/buyer.mjs');
  const {prepareBuyerResponseFile}=await native('sf31-buyer-client/response-file.mjs');
  const {executeWithEvidence}=await native('sf82-checkout-evidence/evidence.mjs');
  const {createDatasetSession,runDatasetSession,inspectDatasetSession,recoverDatasetSession}=await native('sf88-operator-buyer-cli/dataset-session.mjs');
  const buyer=new X402BuyerClient({fetchImpl:(url,options)=>{
    const wanted=new URL(url);assert.equal(wanted.origin,origin);
    return fetch(local+wanted.pathname+wanted.search,options);
  }});
  async function executePage(cfg,{signal}={}) {
    const writer=await prepareBuyerResponseFile(cfg.responseFile);let retained,evidence;
    try {
      evidence=await executeWithEvidence({buyer:{async call(options) {
        const result=await buyer.call({...options,
          approve:async()=>{throw Error('Unexpected paid response on the native free-response path');},
          sign:async()=>{signatures++;throw Error('Unexpected signing request');}});
        retained=await writer.save(result,{signal});return result;
      }},call:{...cfg.operation,signal},outputDir:cfg.evidenceDir,captureBody:false});
    } finally {await writer.abort();}
    assert.equal(evidence.error,null);assert.equal(evidence.result.status,'NO_PAYMENT_REQUIRED');
    return {mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId:cfg.operation.intentId,
      status:evidence.result.status,httpStatus:evidence.result.response.status,
      sellerReportedSettlement:evidence.result.settlement,evidencePath:evidence.evidencePath,
      originalOutcomeReport:evidence.report,operatorReservation:null,responseFile:{status:'SAVED',...retained},
      interrupted:false,retry:'NO_AUTOMATIC_RETRY'};
  }
  const session=join(ROOT,'acquisition');
  if(!await exists(join(session,'session.json'))) {
    const offer=await publisher.buyerOffer(state.runId,'limit=10');
    const prepared=await publisher.prepareBuyer(state.runId,{query:'limit=10',
      intentId:'bls-source-files-4bf5',acceptIndex:0,offerSha256:offer.offerSha256});
    const cfg=prepared.config;
    cfg.operator={python:PYTHON,actor:'ASTRA-4BF5',service:'bls-source-files-native',
      policy:join(ROOT,'unused-free-policy.json'),ledger:join(ROOT,'unused-free-ledger.sqlite')};
    cfg.signerModule=join(ROOT,'unused-free-signer.mjs');cfg.evidenceDir=ROOT;cfg.captureBody=false;
    const configPath=join(ROOT,'buyer.json');
    await exact(configPath,Buffer.from(JSON.stringify(cfg,null,2)+'\n'));
    await createDatasetSession({directory:session,configPath,maxPages:1000,maxTotalAtomic:'100000',
      maxRows:1000000,maxPageBytes:1048576,expectedSnapshot:state.snapshot});
    state.offerSha256=offer.offerSha256; await save(statePath,state);
  }
  let report=await inspectDatasetSession(session);
  if(!report.completedPages) {
    const controller=new AbortController();
    report=await runDatasetSession(session,{executePage,signal:controller.signal,
      emitPageSummaries:false,onPage:()=>controller.abort()});
    assert.equal(report.completedPages,1);
    await progress('FIRST_PAGE_RETAINED',{rows:report.acquiredRows,pages:report.completedPages});
  }
  report=await runDatasetSession(session,{executePage,emitPageSummaries:false});
  assert.equal(report.status,'COMPLETE');assert.equal(report.acquiredRows,state.rows);
  const requestCount=requests;
  const repeated=await runDatasetSession(session,{executePage,emitPageSummaries:false});
  assert.equal(repeated.status,'COMPLETE');assert.equal(requests,requestCount);
  await progress('ACQUIRED',{pages:report.completedPages,rows:report.acquiredRows,nativeRequests:requests});
  // Recover one original retained result without asking the seller for another page.
  if(!state.recoveredOriginalPage) {
    const resultPath=join(session,'pages',String(report.completedPages).padStart(6,'0'),'result.json');
    const retainedPath=resultPath+'.retained-original';
    if(!await exists(retainedPath)) await rename(resultPath,retainedPath);
    const recovered=await recoverDatasetSession(session);
    assert.equal(recovered.status,'COMPLETE');
    assert.equal(recovered.pages.at(-1).recoveredFromOriginalFiles,true);
    assert.equal(requests,requestCount);
    state.recoveredOriginalPage=true; await save(statePath,state);
  }
  // Close original serving and publication work before the receiving process.
  await publisher.close(); publisher=null;
  preview.closeAllConnections?.(); await new Promise(resolve=>preview.close(resolve)); preview=null;
  await seller.close(); seller=null; versions=null;
  global.gc?.();
  await progress('READY_FOR_RECEIVING',{pages:report.completedPages,rows:report.acquiredRows});
  const consumer=await runPython([join(HERE,'receive_and_reopen.py'),'--checkout',SOURCE,
    '--run',ROOT,'--node',process.execPath,'--capture-id',binding.captureId,'--vitality-source',VITALITY]);
  assert.equal(signatures,0);
  state.result={status:'PASS',operation:OPERATION,sourceCommit:SOURCE_COMMIT,
    host:hostname(),pid:process.pid,captureId:binding.captureId,snapshot:state.snapshot,
    nativeRows:report.acquiredRows,nativePages:report.completedPages,nativeRequests:requests,
    nativePaymentStatus:'NO_PAYMENT_REQUIRED',consumer};
  await save(statePath,state);console.log(JSON.stringify(state.result));
} catch(error) {
  state.failure={at:new Date().toISOString(),name:error.name,code:error.code,message:error.message,
    stack:error.stack};await save(statePath,state);throw error;
} finally {
  try { if(publisher) await publisher.close(); } finally {
    if(preview) { preview.closeAllConnections?.(); await new Promise(resolve=>preview.close(resolve)); }
    if(seller) await seller.close(); else if(versions) await versions.close();
  }
}

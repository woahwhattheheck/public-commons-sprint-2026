#!/usr/bin/env node
// MIT. Portable continuation of the original Service, adjustment and buyer cases.
import {constants} from 'node:fs';
import {open,mkdir,lstat,readdir,rename,unlink,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';

const OPERATION='SCF-SERVICE-ADJUSTMENT-HANDOVER-24EA-20261012';
const ORIGINAL='SCF-WOO-REFUNDS-NATIVE-20261011-7737';
const FIXTURE='stellar-forge.service-adjustment-native-inputs.v1';
const SCHEMA='stellar-forge.service-adjustment-native-operation.v1';
const EVENT='3e859a849ee5b3c5b41f9154b6e9d55d081c1f5c996b28518b7a4d282577a30f';
const PAYMENT='dd081bfc50ee076e8b3d373255c8255f06d10ea29b8e50bbc24ffaca384aaf3d';
const RETURN='242279081e65073a320775c2be9cd90d79ebe55755d0c2bfe7d43bf4bc85fc14';
const PRODUCER_SHA='76bd1d3b818c21699cfd3d568b14d4622ff4a3d6ddaff84cd6857c7a37da8ac5';
const MAX_BYTES=32*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const copy=value=>structuredClone(value);
const need=(value,message)=>{if(!value)throw Object.assign(new Error(message),{code:'SERVICE_NATIVE_SELECTION'});};
const now=()=>new Date().toISOString();
function absolute(value,label){
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/',label+' must be an absolute original path.');return value;
}
function safeName(value){
  need(typeof value==='string'&&value.length>0&&value.length<1024&&!value.includes('\\')&&!value.includes('\0')&&
    !isAbsolute(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Use original contained input filenames.');return value;
}
async function privateDirectory(path){
  absolute(path,'Private directory');await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);need(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||!(stat.mode&0o077))&&(!process.getuid||stat.uid===process.getuid()),
    'Use an owned private directory with mode 0700.');return realpath(path);
}
async function bytes(path,maximum=MAX_BYTES){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await handle.stat({bigint:true});need(before.isFile()&&before.size<=BigInt(maximum),'Select the complete original regular file within its size limit.');
    const raw=await handle.readFile(),after=await handle.stat({bigint:true});
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&
      before.ctimeNs===after.ctimeNs&&BigInt(raw.length)===after.size,'The original file changed during capture.');return raw;
  }finally{await handle.close();}
}
async function optional(path,maximum=MAX_BYTES){
  try{return await bytes(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function object(path){const raw=await optional(path);return raw?JSON.parse(decode(raw)):null;}
async function syncDirectory(path){const handle=await open(path,constants.O_RDONLY);try{await handle.sync();}finally{await handle.close();}}
async function atomicJSON(path,value){
  const temporary=join(dirname(path),'.'+randomUUID()+'.tmp');
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(json(value));await handle.sync();}finally{await handle.close();}
  try{await rename(temporary,path);await syncDirectory(dirname(path));}
  catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
let retain;
async function keep(path,raw){
  retain??=(await import('./case-store.mjs')).retainCaseArtifact;
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  await retain(path,raw);return {path,bytes:raw.length,sha256:hash(raw)};
}
async function walk(directory,prefix){
  const stat=await lstat(directory);need(stat.isDirectory()&&!stat.isSymbolicLink(),'Read the original input directory.');
  const found=[];
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=join(directory,entry.name),name=prefix+'/'+entry.name;
    need(!entry.isSymbolicLink(),'The original input packet cannot replace symbolic links with inferred bytes.');
    if(entry.isDirectory())found.push(...await walk(path,name));
    else{need(entry.isFile(),'Use original regular input files.');found.push({name:safeName(name),path});}
  }
  return found;
}
function fileValue(file){
  need(file&&typeof file==='object'&&HASH.test(file.sha256??'')&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&typeof file.base64==='string',
    'Retain the complete original input descriptor.');
  safeName(file.name);const raw=Buffer.from(file.base64,'base64');
  need(raw.toString('base64')===file.base64&&raw.length===file.bytes&&hash(raw)===file.sha256,'An original input file differs from its retained bytes.');return raw;
}
function validateFixture(packet){
  need(packet?.schema===FIXTURE&&packet.sourceOperation===ORIGINAL&&packet.dataContext==='development'&&
    Array.isArray(packet.files)&&packet.files.length>0&&packet.files.length<=2000,'Select the original 7737 native input packet.');
  const files=new Map();let total=0;
  for(const file of packet.files){const raw=fileValue(file);need(!files.has(file.name),'The original packet repeats an input filename.');
    total+=raw.length;need(total<=MAX_BYTES,'The original input packet exceeds its source limit.');files.set(file.name,raw);}
  for(const name of ['producer/accounting.mjs','producer/accounting-journey.json','review.json','terms.json','proofs/original-order18-proof.json'])
    need(files.has(name),'The complete original input packet is missing '+name+'.');
  need(hash(files.get('producer/accounting.mjs'))===PRODUCER_SHA,'The selected original producer changed.');
  const log=JSON.parse(decode(files.get('producer/accounting-journey.json'))),review=JSON.parse(decode(files.get('review.json')));
  const proof=JSON.parse(decode(files.get('proofs/original-order18-proof.json'))),terms=JSON.parse(decode(files.get('terms.json')));
  need(log.operation===ORIGINAL&&typeof log.label==='string'&&log.label.startsWith('DEVELOPMENT:')&&log.completedAt,
    'Use the completed original development producer and its complete context.');
  need(review.orderReference==='18'&&review.binding?.eventId===EVENT&&proof.transaction===PAYMENT&&proof.atomicAmount==='2500000'&&
    same(review.chain,proof),'The original order, payment and proof no longer agree.');
  need(log.original?.reviewSha256===hash(files.get('review.json'))&&log.original.proofSha256===hash(files.get('proofs/original-order18-proof.json')),
    'The original producer input hashes differ from these received bytes.');
  need(terms.schema==='stellar-forge.merchant-accounting-terms.v1'&&terms.routes.some(row=>row.routeId===review.binding.routeId&&
    row.method===review.binding.method&&row.network===proof.network&&row.asset===proof.asset&&row.payTo===proof.recipient&&
    row.amountAtomic===proof.atomicAmount),'The original monetary basis differs from its payment.');
  const partial=log.adjustments?.find(row=>row.name==='partial'&&row.amountAtomic==='1000000'&&row.transaction===RETURN);
  need(partial&&partial.ledger===7100021&&partial.proofSha256&&Array.isArray(log.rpc)&&log.rpc.length,
    'Retain the selected original verified partial return and its native read transcript.');
  const rpc=new Map();
  for(const row of log.rpc){
    need(row.request&&['getNetwork','getTransaction','getEvents'].includes(row.request.method)&&row.result&&
      row.resultSha256===hash(Buffer.from(JSON.stringify(row.result))),'The original native RPC result differs from its retained digest.');
    const key=JSON.stringify(canonical({method:row.request.method,params:row.request.params??null}));
    const previous=rpc.get(key);need(!previous||same(previous.result,row.result),'The original transcript contains different results for one exact read.');
    if(!previous)rpc.set(key,row);
  }
  need([...rpc.values()].some(row=>row.request.method==='getTransaction'&&row.request.params?.hash===RETURN)&&
    [...rpc.values()].some(row=>row.request.method==='getEvents'&&row.request.params?.startLedger===partial.ledger)&&
    [...rpc.values()].some(row=>row.request.method==='getNetwork'),'The selected returned transfer has no complete original native read transcript.');
  need([...files.keys()].some(name=>name.startsWith('outbox/')),'Retain the original seller outbox input files.');
  const descriptor=packet.files.map(({base64,...file})=>file).sort((a,b)=>a.name.localeCompare(b.name));
  need(packet.inputSha256===hash(json(descriptor)),'The full original input manifest changed.');
  return {files,log,review,proof,terms,partial,rpc,descriptor,totalBytes:total};
}

/** Read only the existing completed producer, original outbox and their full
 * byte manifests. The resulting private packet can be received on another host. */
export async function captureOriginalServiceAdjustmentInputs({sourceDirectory,outboxDirectory,packetFile}={}){
  absolute(sourceDirectory,'Original producer directory');absolute(outboxDirectory,'Original outbox directory');absolute(packetFile,'Private packet file');
  const originals=[
    {name:'producer/accounting.mjs',path:join(sourceDirectory,'accounting.mjs')},
    {name:'producer/accounting-journey.json',path:join(sourceDirectory,'accounting-journey.json')},
    {name:'review.json',path:join(sourceDirectory,'original-order18-review.json')},
    {name:'terms.json',path:join(sourceDirectory,'terms.json')},
    ...await walk(join(sourceDirectory,'proofs'),'proofs'),...await walk(outboxDirectory,'outbox')
  ];
  const exportPath=join(sourceDirectory,'adjustments.json'),exportBytes=await optional(exportPath);
  if(exportBytes)originals.push({name:'producer/adjustments.json',path:exportPath});
  const files=[];let total=0;
  for(const file of originals.sort((a,b)=>a.name.localeCompare(b.name))){
    const raw=await bytes(file.path);total+=raw.length;need(total<=MAX_BYTES,'The original source exceeds its complete input limit.');
    files.push({name:file.name,bytes:raw.length,sha256:hash(raw),base64:raw.toString('base64')});
  }
  const descriptors=files.map(({base64,...file})=>file);
  const packet={schema:FIXTURE,sourceOperation:ORIGINAL,dataContext:'development',
    provenance:{producer:sourceDirectory,outbox:outboxDirectory,producerSha256:PRODUCER_SHA},
    inputSha256:hash(json(descriptors)),files};
  validateFixture(packet);
  await privateDirectory(dirname(packetFile));const result=await keep(packetFile,json(packet));
  return {schema:FIXTURE,sourceOperation:ORIGINAL,inputSha256:packet.inputSha256,files:files.length,...result};
}
async function receiveInputs(packet,directory){
  const validated=validateFixture(packet);await privateDirectory(directory);
  for(const [name,raw] of validated.files)await keep(join(directory,safeName(name)),raw);
  await keep(join(directory,'original-inputs.json'),json(packet));
  return {...validated,directory};
}
function fixtureSelection(fixture,actor){
  const date=fixture.log.startedAt.slice(0,10),parsed=new Date(date+'T00:00:00Z');
  need(Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date,'The original native date is invalid.');
  const first=date.slice(0,8)+'01',last=new Date(Date.UTC(parsed.getUTCFullYear(),parsed.getUTCMonth()+1,0)).toISOString().slice(0,10);
  return {
    actor,
    accountingAlias:'service-native',buyerAlias:'service-buyer',
    original:{operation:ORIGINAL,inputSha256:fixture.packet?.inputSha256??null,eventId:EVENT,payment:PAYMENT,transaction:RETURN},
    buyer:{dataContext:'development',recognitionDate:date,
      period:{name:'Original Service receiving '+date.slice(0,7),from_day:first,through_day:last},
      center:{code:'SERVICE',name:'Service operations',active:true},project:'Original Service adjustment receiving',
      accountantNote:'Reviewed original Service report, retained native purchase and verified partial return.'}
  };
}
async function listen(server,port=0){
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
  return 'http://127.0.0.1:'+server.address().port+'/';
}
async function stopServer(server){
  if(!server)return;await server.closeSourceDelivery?.();
  if(!server.listening)return;
  server.closeIdleConnections?.();await new Promise((done,reject)=>{server.close(error=>error?reject(error):done());server.closeAllConnections?.();});
}
async function verifyFiles(files){
  for(const file of files){need(typeof file.path==='string'&&HASH.test(file.sha256??''),'Retain the complete native artifact reference.');
    const raw=await bytes(file.path,256*1024*1024);need(raw.length===file.bytes&&hash(raw)===file.sha256,'A retained complete native artifact changed.');}
}

/** One original Service baseline, one native accounting owner and one buyer
 * owner. Existing state is reopened; all fixture reads use the unchanged
 * original transcript and the original official event decoder. */
export async function receiveServiceAdjustmentOperation({
  directory,serviceDirectory,fixturePacket,sourceCommit,chromiumPath,playwrightModule,
  python='python3',selectionFile=null,originalDirectory=null,outboxDirectory=null
}={}){
  directory=await privateDirectory(absolute(directory,'Adjustment operation directory'));
  serviceDirectory=absolute(serviceDirectory,'Original Service operation directory');
  absolute(fixturePacket,'Original input packet');absolute(chromiumPath,'Original Chromium executable');
  need(typeof playwrightModule==='string'&&playwrightModule&&/^[a-f0-9]{40}$/.test(sourceCommit??''),'Select the complete product source and original browser module.');
  need(directory!==serviceDirectory,'Keep the two original operation directories distinct.');
  let packetRaw=await optional(fixturePacket,MAX_BYTES*2);
  if(!packetRaw){
    absolute(originalDirectory,'Original 7737 producer directory');absolute(outboxDirectory,'Original seller outbox directory');
    await captureOriginalServiceAdjustmentInputs({sourceDirectory:originalDirectory,outboxDirectory,packetFile:fixturePacket});
    packetRaw=await bytes(fixturePacket,MAX_BYTES*2);
  }
  need(packetRaw.length<=MAX_BYTES*2,'The original complete input packet exceeds its encoded limit.');
  const packet=JSON.parse(decode(packetRaw)),fixture=validateFixture(packet);
  fixture.packet=packet;
  const selection=selectionFile?JSON.parse(decode(await bytes(absolute(selectionFile,'Original operator selection'),1024*1024))):
    fixtureSelection(fixture,'24EA native Service operator');
  need(selection&&typeof selection.actor==='string'&&selection.actor.trim()&&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(selection.accountingAlias??'')&&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(selection.buyerAlias??'')&&
    selection.buyer?.dataContext==='development','Use the original explicit operator and receiving context.');
  const {acquireStateLease}=await import('../merchant-fleet-gateway/state-lease.mjs');
  const leaseDirectory=await privateDirectory(join(directory,'operation-owner')),lease=await acquireStateLease(leaseDirectory);
  const checkpointPath=join(directory,'service-adjustment-operation.json'),completedPath=join(directory,'service-adjustment-native-result.json');
  let state;
  const identity={operationId:OPERATION,directory,serviceDirectory,inputSha256:packet.inputSha256,
    packetSha256:hash(packetRaw),selectionSha256:hash(json(selection))};
  try{
    state=await object(checkpointPath);
    if(state)need(state.schema===SCHEMA&&same(state.identity,identity),'Continue this exact original input, operator selection and saved case operation.');
    else state={schema:SCHEMA,identity,createdAt:now(),sourceCommits:[],phases:{},rpcReads:[],artifacts:[],ports:{},captureAttempts:[]};
  }catch(error){await lease.close();throw error;}
  let saveChain=Promise.resolve();
  const save=()=>{const selected=copy(state);saveChain=saveChain.then(()=>{lease.assertHeld();return atomicJSON(checkpointPath,selected);});return saveChain;};
  const event=async(name,result)=>{
    state.phases[name]={at:now(),result:copy(result)};await save();
    process.stdout.write(JSON.stringify({event:'service-adjustment-native-phase',operationId:OPERATION,name,result})+'\n');
  };
  let connections,context,sourceServer,receivingServer,sourceDesk,receivingDesk;
  try{
    const cachedResult=await object(completedPath);
    if(cachedResult?.result==='PASS'){
      need(same(cachedResult.identity,identity),'The complete original result belongs to another input selection.');
      await verifyFiles(cachedResult.artifacts);return {...cachedResult,reused:true};
    }
    if(!state.sourceCommits.includes(sourceCommit))state.sourceCommits.push(sourceCommit);
    state.result='RUNNING';delete state.error;await save();
    await keep(join(directory,'operator-selection.json'),json(selection));
    const received=await receiveInputs(packet,join(directory,'original-inputs'));
    await event('original-inputs-received',{sourceOperation:ORIGINAL,inputSha256:packet.inputSha256,
      files:received.files.size,bytes:received.totalBytes,originalLabel:received.log.label});
    // The baseline's own completed result verifies its complete original files
    // without recreating its case. An unfinished baseline resumes in this same
    // selected directory before later commercial work changes that case.
    const {receiveServiceCase}=await import('./service-journey.mjs');
    const baseline=await receiveServiceCase({directory:serviceDirectory,sourceCommit,chromiumPath,playwrightModule});
    need(baseline.result==='PASS'&&baseline.caseId&&baseline.reportId,'Complete the original Service case and retained monthly report first.');
    if(state.caseId)need(state.caseId===baseline.caseId&&state.reportId===baseline.reportId,'The original baseline selected a different saved case.');
    state.caseId=baseline.caseId;state.reportId=baseline.reportId;
    await event('original-service-case-reopened',{caseId:baseline.caseId,reportId:baseline.reportId,reused:baseline.reused===true});
    const [{openCaseStore},{parseWorkspace},{openServiceConnections},{openCaseServiceAdjustments},{createConsoleServer},
      {receiveServiceAdjustments},{createServiceBuyerReceiving},{serviceAdjustmentCli}]=await Promise.all([
      import('./case-store.mjs'),import('./workspace-file.mjs'),import('./service-connections.mjs'),
      import('./case-service-adjustments.mjs'),import('./server.mjs'),import('./service-adjustment-journey.mjs'),
      import('./service-buyer-receiving.mjs'),import('./service-adjustments-cli.mjs')
    ]);
    const sourceStore=await openCaseStore(join(serviceDirectory,'cases')),receivingStore=await openCaseStore(join(serviceDirectory,'receiving-cases'));
    const original=await sourceStore.read(state.caseId),originalWorkspace=await parseWorkspace(original.workspaceText);
    need(originalWorkspace.service.reports.some(row=>row.id===state.reportId),'The original selected Service report is absent from its case.');
    const accountingConfig=join(directory,'accounting-connection.json'),buyerConfig=join(directory,'buyer-connection.json');
    const accountingDirectory=join(directory,'accounting'),buyerDirectory=join(directory,'buyer');
    for(const path of [accountingDirectory,buyerDirectory])await privateDirectory(path);
    await keep(accountingConfig,json({workspaces:{[selection.accountingAlias]:{
      label:'Original Service native accounting',directory:accountingDirectory,outboxDir:join(received.directory,'outbox'),
      proofDir:join(received.directory,'proofs'),termsFile:join(received.directory,'terms.json')
    }}}));
    await keep(buyerConfig,json({schema:'stellar-forge.buyer-expense-connection.v1',
      workspaces:{[selection.buyerAlias]:{directory:buyerDirectory,python}}}));
    connections=await openServiceConnections({accountingConfig,buyerExpenseConnection:buyerConfig,
      directory:join(directory,'connections'),environment:process.env});
    const accounting=connections.accounting,buyer=connections.buyer;
    await accounting.call('merchant_accounting_open',{workspace:selection.accountingAlias});
    const {createOfficialEventDecoder}=await import('../sf43-agent-commerce/verify.mjs');
    const officialDecoder=await createOfficialEventDecoder(),session=randomUUID();let rpcNumber=0;
    await privateDirectory(join(directory,'rpc-reads'));
    const native=await accounting.withServiceAdjustments(selection.accountingAlias,async controller=>{
      controller.options.decodeContractEvent=officialDecoder;
      controller.options.fetchImpl=async(url,options)=>{
        need(String(url)==='https://soroban-testnet.stellar.org','The retained original transcript selects its exact native RPC endpoint.');
        const request=JSON.parse(options.body),key=JSON.stringify(canonical({method:request.method,params:request.params??null})),retained=received.rpc.get(key);
        need(retained,'The original transcript has no result for this exact native RPC read: '+request.method+'.');
        const record={schema:'stellar-forge.service-adjustment-original-rpc-read.v1',at:now(),session,
          originalOperation:ORIGINAL,inputSha256:packet.inputSha256,request:copy(request),
          originalRequest:copy(retained.request),result:copy(retained.result),resultSha256:retained.resultSha256};
        const path=join(directory,'rpc-reads',session+'-'+String(++rpcNumber).padStart(4,'0')+'.json'),raw=json(record);
        await keep(path,raw);state.rpcReads.push({path,bytes:raw.length,sha256:hash(raw)});await save();
        return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:copy(retained.result)}),
          {status:200,headers:{'content-type':'application/json'}});
      };
      const workspace=controller.workspace;need(workspace&&typeof workspace.begin==='function','Use the original admitted accounting workspace.');
      let attempt=state.captureAttempts.at(-1),run;
      while(true){
        if(!attempt){attempt={id:randomUUID(),name:'Service original order18 '+OPERATION+' / '+(state.captureAttempts.length+1)};
          state.captureAttempts.push(attempt);await save();}
        run=attempt.runId?workspace.state.runs.find(row=>row.id===attempt.runId):null;
        if(!run){const matches=workspace.state.runs.filter(row=>row.name===attempt.name);need(matches.length<=1,'The original native capture name is ambiguous.');run=matches[0];}
        if(!run){const result=await workspace.begin({revision:workspace.state.revision,name:attempt.name,actor:selection.actor});run=result.run;}
        attempt.runId=run.id;await save();await Promise.all([...workspace.tasks]);
        run=workspace.state.runs.find(row=>row.id===attempt.runId);need(run,'The original accounting capture disappeared.');
        attempt.status=run.status;await save();
        if(run.status==='complete')break;
        if(['interrupted','INTERRUPTED'].includes(run.status)){attempt=null;continue;}
        throw Object.assign(new Error('Original accounting capture ended '+run.status+': '+JSON.stringify(run.error??run)),{code:'SERVICE_NATIVE_CAPTURE'});
      }
      const detail=await controller.event(run.id,EVENT);
      need(detail.event.transfer==='OFFICIAL_TRANSFER_MATCHED'&&detail.originalProof?.transaction===PAYMENT&&
        detail.event.amountAtomic==='2500000'&&detail.refundTerms?.asset===received.proof.asset&&
        detail.refundTerms.from===received.proof.recipient&&detail.refundTerms.to===received.proof.payer,
        'The received original native accounting run differs from its payment and refund terms.');
      const value={runId:run.id,eventId:EVENT,amountAtomic:received.partial.amountAtomic,effectiveAt:received.log.startedAt,
        reason:'Original Service report and retained Woo order18 partial-return receiving',reference:ORIGINAL+':partial',actor:selection.actor,
        basis:{amountAtomic:received.proof.atomicAmount,reference:'Original Woo order18 / '+PAYMENT,
          description:'Original retained order18 monetary basis; asset and native units come from its selected payment.'},
        verification:{transaction:received.partial.transaction,rpcEndpoint:'https://soroban-testnet.stellar.org'},
        source:{operationId:ORIGINAL,dataContext:'development',inputSha256:packet.inputSha256,producerSha256:PRODUCER_SHA,
          originalAccountingRunId:received.log.accountingRunId,originalLabel:received.log.label,sourcePin:received.log.sourcePin,
          originalProofSha256:received.log.original.proofSha256}};
      if(state.nativeSelection)need(same(state.nativeSelection,value),'The retained native Service selection changed.');
      else state.nativeSelection=value;
      await save();return value;
    });
    await buyer.call('merchant_buyer_expense_open',{workspace:selection.buyerAlias});
    await event('original-native-owners-open',{accountingAlias:selection.accountingAlias,buyerAlias:selection.buyerAlias,
      runId:native.runId,eventId:native.eventId,amountAtomic:native.amountAtomic,network:received.proof.network,asset:received.proof.asset});
    sourceDesk=openCaseServiceAdjustments({store:sourceStore,accounting,buyer,directory:join(directory,'source-actions')});
    receivingDesk=openCaseServiceAdjustments({store:receivingStore,accounting,buyer,directory:join(directory,'receiving-actions')});
    sourceServer=createConsoleServer({caseStore:sourceStore,adjustmentDesk:sourceDesk,allowLoopback:true});
    receivingServer=createConsoleServer({caseStore:receivingStore,adjustmentDesk:receivingDesk,allowLoopback:true});
    const sourceUrl=await listen(sourceServer,state.ports.source??0),receivingUrl=await listen(receivingServer,state.ports.receiver??0);
    state.ports={source:Number(new URL(sourceUrl).port),receiver:Number(new URL(receivingUrl).port)};await save();
    const {chromium}=createRequire(import.meta.url)(playwrightModule);
    context=await chromium.launchPersistentContext(join(directory,'browser'),{headless:true,executablePath:chromiumPath,
      args:['--no-sandbox','--disable-dev-shm-usage','--renderer-process-limit=1'],acceptDownloads:true,viewport:{width:1440,height:1000}});
    const transfer=async()=>{
      const saved=await sourceStore.read(state.caseId),prior=await receivingStore.read(state.caseId)
        .catch(error=>{if(error.code!=='CASE_NOT_FOUND')throw error;return null;});
      if(!prior||prior.workspaceText!==saved.workspaceText||prior.supportText!==saved.supportText||!same(prior.metadata,saved.metadata))
        await receivingStore.save({id:state.caseId,expectedRevision:prior?.currentRevision??null,
          workspaceText:saved.workspaceText,supportText:saved.supportText,metadata:saved.metadata});
      const fresh=await receivingStore.read(state.caseId);
      need(fresh.workspaceText===saved.workspaceText&&fresh.supportText===saved.supportText&&same(fresh.metadata,saved.metadata),
        'The named receiving store changed the original case.');
      return {caseId:state.caseId,revision:fresh.currentRevision};
    };
    const buyerReceive=createServiceBuyerReceiving({buyer,accounting,buyerId:selection.buyerAlias,accountingId:selection.accountingAlias,
      readCase:id=>sourceStore.read(id),saveCase:value=>sourceStore.save(value),selection:selection.buyer,actor:selection.actor,python,node:process.execPath});
    const args={directory:join(directory,'receiving'),store:sourceStore,accounting,accountingId:selection.accountingAlias,
      caseId:state.caseId,reportId:state.reportId,selection:native,context,sourceUrl,receivingStore,receivingUrl,transfer,buyerReceive,sourceCommit};
    let result;
    try{result=await receiveServiceAdjustments(args);}
    catch(error){
      if(error.code!=='RECEIVING_RESPONSE_LOST')throw error;
      // The factory deliberately retained this actual accepted reply loss.
      // Re-enter the same case/intent to recover it through the native request.
      await event('original-buyer-response-reentry',{code:error.code});
      result=await receiveServiceAdjustments(args);
    }
    need(result.result==='PASS','The complete original Service adjustment receiving did not finish.');
    const sourceCase=await sourceStore.read(state.caseId),cliRequestPath=join(directory,'service-adjustment-cli-request.json');
    const retainedCli=await object(cliRequestPath);
    if(retainedCli)need(retainedCli.method==='delivery'&&retainedCli.args?.id===state.caseId&&
      retainedCli.args.proposalId===result.proposalId&&HASH.test(retainedCli.args.revision??''),
      'Continue the original retained CLI case revision and proposal.');
    else await keep(cliRequestPath,json({method:'delivery',args:{id:state.caseId,revision:sourceCase.currentRevision,proposalId:result.proposalId}}));
    const cliOut=join(directory,'cli-delivery'),cli=await serviceAdjustmentCli({url:sourceUrl,requestFile:cliRequestPath,out:cliOut});
    const replay=await serviceAdjustmentCli({url:sourceUrl,requestFile:cliRequestPath,out:cliOut});
    need(cli.state==='COMPLETE'&&replay.state==='COMPLETE'&&replay.reused===true&&same(cli.files,replay.files),
      'The original CLI delivery did not reopen its exact selected files.');
    await event('complete-cli-delivery-reopened',{caseId:state.caseId,proposalId:result.proposalId,files:cli.files.length,reused:replay.reused});
    const artifacts=[...result.artifacts,...state.rpcReads];
    const add=async(path,type='application/json')=>{
      const raw=await bytes(path,256*1024*1024);if(!artifacts.some(file=>file.path===path))
        artifacts.push({path,name:relative(directory,path),type,bytes:raw.length,sha256:hash(raw)});
    };
    for(const name of ['original-inputs/original-inputs.json','operator-selection.json','service-adjustment-cli-request.json',
      'receiving/service-adjustment-result.json','cli-delivery/service-adjustment-delivery-request.json','cli-delivery/service-adjustment-delivery.json'])
      await add(join(directory,name));
    for(const file of cli.files)await add(join(cliOut,file.name),file.type);
    for(const file of baseline.artifacts)await add(join(serviceDirectory,file.name));
    await verifyFiles(artifacts);
    await context.close();context=null;await stopServer(sourceServer);sourceServer=null;await stopServer(receivingServer);receivingServer=null;
    await sourceDesk.close();sourceDesk=null;await receivingDesk.close();receivingDesk=null;await connections.close();connections=null;
    state.result='PASS';state.completedAt=now();state.artifacts=artifacts;await save();
    const completed={schema:SCHEMA,identity:copy(identity),result:'PASS',completedAt:state.completedAt,
      sourceCommits:copy(state.sourceCommits),caseId:state.caseId,reportId:state.reportId,
      proposalId:result.proposalId,captureOutcomeId:result.captureOutcomeId,
      original:{operationId:ORIGINAL,inputSha256:packet.inputSha256,label:received.log.label,
        payment:PAYMENT,eventId:EVENT,returnedTransaction:RETURN,amountAtomic:native.amountAtomic,
        network:received.proof.network,asset:received.proof.asset},
      nativeResult:join(directory,'receiving','service-adjustment-result.json'),phases:copy(state.phases),
      captureAttempts:copy(state.captureAttempts),artifacts};
    await atomicJSON(completedPath,completed);return completed;
  }catch(error){state.result='INTERRUPTED';state.error={at:now(),code:error.code??null,message:error.message};await save().catch(()=>{});throw error;}
  finally{
    await context?.close().catch(()=>{});await stopServer(sourceServer).catch(()=>{});await stopServer(receivingServer).catch(()=>{});
    await sourceDesk?.close().catch(()=>{});await receivingDesk?.close().catch(()=>{});await connections?.close().catch(()=>{});
    await saveChain.catch(()=>{});await lease.close();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{
      directory:{type:'string'},'service-directory':{type:'string'},'fixture-packet':{type:'string'},
      'source-commit':{type:'string'},chromium:{type:'string'},'playwright-module':{type:'string'},
      python:{type:'string'},'selection-file':{type:'string'},
      'capture-original-fixture':{type:'boolean'},'original-directory':{type:'string'},'outbox-directory':{type:'string'},help:{type:'boolean'}
    },strict:true});
    if(values.help)process.stdout.write(
      'Capture the original private input packet:\n'+
      'node service-adjustment-native.mjs --capture-original-fixture --original-directory ABS --outbox-directory ABS --fixture-packet ABS\n'+
      'Continue the complete original Service, native adjustment and buyer operation:\n'+
      'node service-adjustment-native.mjs --directory ABS --service-directory ORIGINAL_SERVICE_ABS --fixture-packet ABS --source-commit COMMIT --chromium ABS --playwright-module MODULE [--python ABS] [--selection-file ABS] [--original-directory ABS --outbox-directory ABS]\n'+
      'When the input packet is absent, the original-directory/outbox-directory selections capture it before receiving.\n'+
      'Repeat the same directory, input packet and explicit operator selection after interruption.\n');
    else{
      const result=values['capture-original-fixture']?await captureOriginalServiceAdjustmentInputs({
        sourceDirectory:values['original-directory'],outboxDirectory:values['outbox-directory'],packetFile:values['fixture-packet']
      }):await receiveServiceAdjustmentOperation({
        directory:values.directory,serviceDirectory:values['service-directory'],fixturePacket:values['fixture-packet'],
        sourceCommit:values['source-commit'],chromiumPath:values.chromium??process.env.STARFORGE_CHROMIUM,
        playwrightModule:values['playwright-module']??process.env.STARFORGE_PLAYWRIGHT_MODULE,
        python:values.python??'python3',selectionFile:values['selection-file']??null,
        originalDirectory:values['original-directory']??null,outboxDirectory:values['outbox-directory']??null
      });
      process.stdout.write(JSON.stringify(result,null,2)+'\n');
    }
  }catch(error){process.stderr.write(JSON.stringify({error:error.code??'SERVICE_NATIVE_FAILED',detail:error.message})+'\n');process.exitCode=1;}
}

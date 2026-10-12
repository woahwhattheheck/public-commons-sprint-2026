// MIT. One installed-product continuation of the original Flowable native journey.
import { constants as C } from 'node:fs';
import { mkdir, realpath, open, readFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

const SCHEMA = 'stellar-forge.flowable-installed-native-journey.v1';
const PRODUCT = 'products/flowable-merchant/';
const SDK = 'stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/';
const RUNTIME = 'stellar/scf-starforge-20261009/distribution/runtime-workspace/';
const MCP = 'stellar-forge/mcp-merchant-operator/';
const CORE_KINDS = ['connection','portfolio','release','process','task','migration'];
const HASH = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const ref = record => ({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
const fail = (message, data={}) => Object.assign(new Error(message), {code:'FLOWABLE_INSTALLED_JOURNEY_FAILED',...data});
const need = (condition, message) => { if (!condition) throw fail(message); };
function uuid(operation, step) {
  const text = hash(operation + '\n' + step);
  return text.slice(0,8)+'-'+text.slice(8,12)+'-4'+text.slice(13,16)+'-a'+text.slice(17,20)+'-'+text.slice(20,32);
}
async function checkedFile(path, expected) {
  const file = await open(path,C.O_RDONLY|C.O_NOFOLLOW);
  try {
    const first = await file.stat(), digest = createHash('sha256'), buffer = Buffer.alloc(65536);
    need(first.isFile() && Number.isSafeInteger(first.size), 'Read the complete original regular file.');
    let offset=0;
    while (offset < first.size) {
      const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,first.size-offset),offset);
      need(bytesRead>0,'The original file was truncated.'); digest.update(buffer.subarray(0,bytesRead)); offset+=bytesRead;
    }
    const last=await file.stat(), result={path,bytes:offset,sha256:digest.digest('hex')};
    need(first.dev===last.dev && first.ino===last.ino && first.size===last.size &&
      first.mtimeMs===last.mtimeMs && first.ctimeMs===last.ctimeMs,'The original file changed during receiving.');
    if (expected) need(result.bytes===expected.bytes && result.sha256===expected.sha256,'Full original file bytes must match.');
    return result;
  } finally { await file.close(); }
}
async function waitFor(read, accept, {signal, timeout=180000, describe='the original owner'}={}) {
  const end=Date.now()+timeout;
  for (;;) {
    signal?.throwIfAborted();
    const value=await read();
    if (accept(value)) return value;
    if (Date.now()>=end) throw fail('Timed out waiting for '+describe+'.');
    await delay(250,undefined,{signal});
  }
}
async function runCLI(sourceRoot, args, signal) {
  const child=spawn(process.execPath,[join(sourceRoot,PRODUCT+'cli.mjs'),...args],
    {cwd:sourceRoot,env:process.env,stdio:['ignore','pipe','pipe'],shell:false,signal});
  const out=[],err=[];let size=0,tooLarge=false;
  for (const [stream,target] of [[child.stdout,out],[child.stderr,err]]) stream.on('data',chunk=>{
    size+=chunk.length;
    if (size>8*1024*1024) {tooLarge=true;child.kill('SIGTERM');return;} target.push(chunk);
  });
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  need(!tooLarge && code.code===0 && !code.signal,'The installed original CLI must exit successfully: '+args[0]);
  const bytes=Buffer.concat(out), text=bytes.toString('utf8');
  let value;try{value=JSON.parse(text);}catch{throw fail('The installed CLI must return its full original JSON.');}
  return {value,receipt:{command:'flowable-product',arguments:args,exitCode:code.code,
    outputBytes:bytes.length,outputSha256:hash(bytes),stderrBytes:Buffer.concat(err).length}};
}
async function allRecords(client, kind) {
  const rows=[];let offset=0,snapshot;
  for (;;) {
    const page=await client.listRecords({kind,offset,limit:2,...(snapshot?{snapshot}:{})});
    need(Array.isArray(page.items) && page.offset===offset && (!snapshot||snapshot===page.snapshot),'Read the original complete record page.');
    snapshot=page.snapshot;rows.push(...page.items);
    if (page.nextOffset===null) {need(rows.length===page.total,'Read every saved record.');return rows;}
    need(page.nextOffset>offset,'Record paging must advance.');offset=page.nextOffset;
  }
}
async function compareCore(sender, receiver, expected) {
  const result={};
  for (const kind of CORE_KINDS) {
    const source=expected?.[kind]??await allRecords(sender,kind),received=new Map((await allRecords(receiver,kind)).map(item=>[item.id,item]));
    for (const item of source) {
      const selected=received.get(item.id);
      need(selected && selected.revision===item.revision && selected.sha256===item.sha256,'Receiving preserves exact '+kind+' record '+item.id+'.');
      for (let revision=1;revision<=item.revision;revision++) {
        const [a,b]=await Promise.all([sender.getRecord({kind,id:item.id,revision}),receiver.getRecord({kind,id:item.id,revision})]);
        need(a.sha256===b.sha256 && a.parentSha256===b.parentSha256,'Receiving preserves every native record revision.');
      }
    }
    result[kind]={records:source.length,revisions:source.reduce((sum,item)=>sum+item.revision,0)};
  }
  return result;
}
function mcpConnection(url, token, signal, protocolVersion) {
  need(/^\d{4}-\d{2}-\d{2}$/.test(protocolVersion), 'Use the original installed MCP protocol version.');
  let sequence=0,session;
  async function rpc(method,params,notification=false) {
    const id=notification?undefined:++sequence;
    const response=await fetch(url,{method:'POST',redirect:'error',signal,
      headers:{Authorization:'Bearer '+token,Accept:'application/json, text/event-stream','Content-Type':'application/json',
        'MCP-Protocol-Version':protocolVersion,...(session?{'Mcp-Session-Id':session}:{})},
      body:JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params})});
    if (response.headers.get('mcp-session-id')) session=response.headers.get('mcp-session-id');
    const chunks=[];let size=0;
    for await(const chunk of response.body??[]) {size+=chunk.length;need(size<=16*1024*1024,'Use complete retained MCP file delivery for a large result.');chunks.push(chunk);}
    const text=Buffer.concat(chunks).toString('utf8');
    if(!response.ok) {
      let original;try{const parsed=JSON.parse(text);original=parsed.error??parsed;}catch{}
      throw Object.assign(new Error(original?.message??'The original merchant MCP HTTP request failed.'),
        original&&typeof original==='object'?original:{}, {status:response.status});
    }
    if(notification)return;
    let messages;
    if((response.headers.get('content-type')??'').includes('text/event-stream')) {
      messages=text.split(/\r?\n\r?\n/).map(block=>block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')).filter(Boolean).map(item=>JSON.parse(item));
    } else messages=[JSON.parse(text)];
    const message=messages.find(item=>item.id===id);need(message,'The original MCP protocol response is missing.');
    if(message.error)throw Object.assign(new Error(message.error.message??'The original MCP protocol request failed.'),
      message.error.data&&typeof message.error.data==='object'?message.error.data:message.error);
    return message.result;
  }
  return {
    rpc,
    async initialize(){
      const initialized=await rpc('initialize',{protocolVersion,capabilities:{},clientInfo:{name:'flowable-installed-native-journey',version:'1'}});
      need(initialized.protocolVersion===protocolVersion,'The original installed MCP protocol negotiation must agree.');
      await rpc('notifications/initialized',{},true);
    },
    async tool(name,args) {
      const result=await rpc('tools/call',{name,arguments:args});
      if(result?.isError) {
        let original;
        for(const item of result.content??[])if(item.type==='text'){try{original=JSON.parse(item.text);break;}catch{}}
        const error=original?.error??original;
        throw Object.assign(new Error(error?.message??'The original MCP tool failed: '+name),
          error&&typeof error==='object'?error:{code:'FLOWABLE_INSTALLED_MCP_ERROR'}, {tool:name});
      }
      if(result?.structuredContent!==undefined)return result.structuredContent;
      for(const item of result?.content??[])if(item.type==='text'){try{return JSON.parse(item.text);}catch{}}
      throw fail('The MCP tool must return its complete native JSON: '+name);
    },
  };
}

/** The parent closes its sender/receiver first. Every engine operation remains with that same native Flowable runtime. */
export async function runInstalledFlowableJourney({
  directory, configuration, sourceWorkspaceDirectory, sourceDelivery, reviewerUserId, signal,
}) {
  need(configuration && configuration.installedVersion==='8.0.0' && /^[a-f0-9]{40}$/.test(configuration.sourceRevision??''),
    'Select the complete original installed Flowable release.');
  need(typeof configuration.runtimeDirectory==='string' && typeof configuration.environmentFile==='string',
    'Use the original READY runtime and host-owned private Applications environment.');
  directory=resolve(directory);sourceWorkspaceDirectory=resolve(sourceWorkspaceDirectory);
  const sourceRoot=await realpath(configuration.installedSourceRoot??join(configuration.runtimeDirectory,'package','source'));
  need(sourceRoot===resolve(dirname(fileURLToPath(import.meta.url)),'../..'),'Execute this hook from the original installed source.');
  const load=path=>import(pathToFileURL(join(sourceRoot,path)).href);
  const [{inspectMerchantRuntime},product,managed,common,{FlowableProductClient},runtime,{retainFlowableResponse}]=await Promise.all([
    load('stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs'),load(PRODUCT+'workspace.mjs'),
    load(PRODUCT+'managed.mjs'),load(PRODUCT+'common.mjs'),load(PRODUCT+'client.mjs'),
    load(RUNTIME+'model.mjs'),load(SDK+'workspace/http-client.mjs'),
  ]);
  const installed=await inspectMerchantRuntime(configuration.runtimeDirectory,{load:false});
  need(installed.state==='READY' && installed.sourceCommit===configuration.sourceRevision && installed.sourceRoot===sourceRoot,
    'Applications must use the exact READY installed runtime.');
  await mkdir(directory,{mode:0o700,recursive:true});await common.privateDirectory(directory);
  const privateRoot=join(dirname(configuration.environmentFile),'installed-product-owners');
  need(privateRoot!==directory && !privateRoot.startsWith(directory+'/') && !directory.startsWith(privateRoot+'/'),
    'Keep private listener owners outside the shareable journey.');
  await common.privateDirectory(privateRoot,true);
  const lease=await common.leaseProduct(privateRoot);
  const statePath=join(privateRoot,'installed-journey.json');
  let state,identity;
  try {
    const old=await common.privateBytes(statePath,true,16*1024*1024);
    identity={schema:SCHEMA,operation:configuration.operation,sourceRevision:configuration.sourceRevision,
      runtimeDirectory:configuration.runtimeDirectory,sourceWorkspaceDirectory,
      originalDelivery:{...ref(sourceDelivery.record),bytes:sourceDelivery.bytes,sha256:sourceDelivery.sha256},
      environmentFile:configuration.environmentFile,outputDirectory:directory};
    state=old?JSON.parse(old):{identity,createdAt:new Date().toISOString(),steps:{},runs:[]};
    need(canonical(state.identity)===canonical(identity),'Continue the same installed journey, original workspace and delivery.');
  } catch(error) {
    try {await lease.close();}
    catch(closeError) {throw new AggregateError([error,closeError],'The original installed journey state and owner could not be opened.');}
    throw error;
  }
  const save=()=>common.publish(statePath,state,{replace:true,lease});
  const publish=(name,value)=>common.publish(join(directory,name),value,{replace:true,lease});
  async function memo(name,input,fn) {
    const previous=state.steps[name];
    if(previous)need(canonical(previous.input)===canonical(input),'Continue the original saved '+name+' request.');
    else {state.steps[name]={input};await save();}
    if(Object.hasOwn(state.steps[name],'output'))return state.steps[name].output;
    const output=await fn();state.steps[name].output=output;await save();return output;
  }
  const request=step=>uuid(configuration.operation,'installed:'+step);
  const senderDirectory=join(privateRoot,'sender-product'),receiverDirectory=join(privateRoot,'receiver-product');
  const appsDirectory=join(privateRoot,'applications'),merchantDirectory=join(privateRoot,'merchant');
  let apps,sender,receiver,receiverOwner,merchant,activeRun,preparedReport;
  const errors=[];const report={schema:SCHEMA,state:'RUNNING',operation:configuration.operation,
    sourceRevision:configuration.sourceRevision,installed:{state:installed.state,installationId:installed.installationId,
      profileId:installed.profileId,sourceManifestSha256:installed.sourceManifestSha256,sourceRoot},
    startedAt:new Date().toISOString(),checks:[],files:[],cli:[]};
  const mark=(name,evidence)=>report.checks.push({name,...evidence});
  async function stopApplication() {
    if(!apps||!activeRun)return;
    const selected=activeRun;
    await apps.applicationsStop({applicationId:selected.applicationId,operationId:selected.operationId});
    const ended=await waitFor(async()=> (await apps.applicationsState()).applications.find(item=>item.id===selected.applicationId),
      item=>item && !item.current?.active && item.phase==='STOPPED',{timeout:60000,describe:'the original Applications owner to stop'});
    selected.closed=true;selected.final={phase:ended.phase,operationId:ended.current.id,
      resultState:ended.current.result?.state??null};await save();activeRun=undefined;
    return selected.final;
  }
  async function openReceiver() {
    const review=await managed.inspectFlowableProductLaunch({directory:receiverDirectory,port:0});
    receiverOwner=await product.openFlowableProduct({directory:receiverDirectory,port:0,expectedBindingSha256:review.bindingSha256},
      {environment:process.env,signal});
    receiver=new FlowableProductClient({directory:receiverDirectory,signal,expectedWorkspaceId:receiverOwner.workspaceId});
  }
  try {
    await save();
    need(HASH.test(sourceDelivery.sha256) && sourceDelivery.record.kind==='delivery','Select the original complete parent delivery.');
    await checkedFile(sourceDelivery.path,sourceDelivery);
    await product.initializeFlowableProduct({directory:senderDirectory,workspaceDirectory:sourceWorkspaceDirectory,
      name:'Native Flowable sender',connections:[configuration.connection]});
    await product.initializeFlowableProduct({directory:receiverDirectory,name:'Native Flowable installed receiver',connections:[]});
    if(!await common.exists(join(appsDirectory,'workspace.json')))await runtime.createRuntimeWorkspace({directory:appsDirectory});
    apps=await runtime.openRuntimeWorkspace({directory:appsDirectory});
    const attached=await apps.attach({directory:configuration.runtimeDirectory,label:'Original selected Flowable runtime'});
    need(attached.status==='READY','The Applications runtime attachment must be READY.');
    const application=await memo('application-save',{runtimeId:attached.runtimeId,kind:'flowable-product',settings:{
      workspaceDirectory:senderDirectory,port:0,environmentFile:configuration.environmentFile}},async()=>{
      const review=await apps.applicationsReview({runtimeId:attached.runtimeId,kind:'flowable-product',
        settings:{workspaceDirectory:senderDirectory,port:0,environmentFile:configuration.environmentFile},
        label:'Flowable native process operations'});
      const saved=await apps.applicationsSave({requestId:request('application-save'),reviewId:review.id});
      need(saved.saved && !saved.connectionError,'Save the original reviewed Applications entry and adoption request.');
      return {applicationId:saved.applicationId,revision:saved.revision,reviewId:review.id,
        adoptionOperationId:saved.connection?.operationId??null};
    });
    await apps.applicationsConnect({applicationId:application.applicationId});
    const connected=await waitFor(async()=> (await apps.applicationsState()).applications.find(item=>item.id===application.applicationId),
      value=>Boolean(value?.release),{signal,describe:'the original managed runtime adoption'});
    need(connected.release.sourceCommit===configuration.sourceRevision,'The adopted managed release retains the exact source commit.');
    let last=state.runs.at(-1);
    if(last&&!last.closed) {
      const current=(await apps.applicationsState()).applications.find(item=>item.id===application.applicationId)?.current;
      if(current?.id===last.operationId && current.active)activeRun=last;
      else if(current?.id===last.operationId && ['SUCCEEDED','CANCELLED'].includes(current.phase)) {
        last.closed=true;await save();
      } else {
        if(current?.id===last.operationId)
          await apps.applicationsRecover({applicationId:application.applicationId,operationId:last.operationId});
        else
          await apps.applicationsStart({applicationId:last.applicationId,requestId:last.operationId,reviewId:last.reviewId});
        activeRun=last;
      }
    }
    if(!activeRun) {
      const review=await apps.applicationsStartReview({applicationId:application.applicationId});
      activeRun={applicationId:application.applicationId,operationId:request('application-run-'+state.runs.length),reviewId:review.id,closed:false};
      state.runs.push(activeRun);await save();
      await apps.applicationsStart({applicationId:application.applicationId,requestId:activeRun.operationId,reviewId:activeRun.reviewId});
    }
    const running=await waitFor(async()=> (await apps.applicationsState()).applications.find(item=>item.id===application.applicationId),
      value=>value?.phase==='RUNNING' && value.current?.id===activeRun.operationId && value.current.active && value.current.privateUrl,
      {signal,describe:'the original Applications startup observer'});
    sender=new FlowableProductClient({directory:senderDirectory,signal});
    const senderStatus=await sender.status();
    need(senderStatus.directory===sourceWorkspaceDirectory,'Applications must open the original sender workspace.');
    const liveSession=(await sender.connection()).record;
    need(running.current.url?.original?.workspaceId===senderStatus.workspaceId || running.current.privateUrl===liveSession.browserUrl,
      'Applications startup and the installed SDK select the same native owner.');
    mark('Applications review, managed adoption and observed start',{applicationId:application.applicationId,
      operationId:activeRun.operationId,release:connected.release,workspaceId:senderStatus.workspaceId,
      instanceId:liveSession.instanceId,sourceSha256:liveSession.sourceSha256});
    const originalHeads=await memo('original-heads',{deliverySha256:sourceDelivery.sha256},async()=>{
      const result={};for(const kind of CORE_KINDS)result[kind]=(await allRecords(sender,kind)).map(ref);return result;
    });
    await openReceiver();
    const downloaded=await sender.downloadDelivery({id:sourceDelivery.record.id,
      path:join(directory,'original-workspace.ndjson'),expectedSha256:sourceDelivery.sha256});
    await checkedFile(downloaded.path,sourceDelivery);report.files.push(downloaded);
    const received=await receiver.inspectDeliveryFile({requestId:request('receive-original'),path:downloaded.path,
      label:'Original complete Flowable native workspace',expectedSha256:downloaded.sha256});
    const adoptInput={requestId:request('adopt-original'),id:received.id,
      expectedRevision:received.revision,manifestSha256:received.value.manifestSha256};
    const frozenAdopt=await memo('original-adoption-input',{requestId:adoptInput.requestId,id:adoptInput.id,manifestSha256:adoptInput.manifestSha256},async()=>adoptInput);
    const adopted=await receiver.adoptDelivery(frozenAdopt);
    need(adopted.value.state==='ADOPTED','The original complete native handover must be adopted.');
    const replayed=await receiver.adoptDelivery(frozenAdopt);
    need(replayed.id===adopted.id && replayed.sha256===adopted.sha256,'Exact adoption replay reopens the same native record.');
    mark('Full original SDK file receiving and same-request adoption',{delivery:ref(sourceDelivery.record),receiving:ref(adopted),
      file:{bytes:downloaded.bytes,sha256:downloaded.sha256},records:await compareCore(sender,receiver,originalHeads)});

    const releases=await allRecords(sender,'release');need(releases.length>0,'The original native journey must retain deployment releases.');
    let selectedRelease;
    for(const item of releases) {
      const record=await sender.getRecord({kind:'release',id:item.id});
      if(record.value.sourceResource?.reference){selectedRelease=record;break;}
    }
    need(selectedRelease,'The deployment retains its exact original BPMN or archive.');
    const sourceReference=selectedRelease.value.sourceResource.reference;
    const originalSource=await sender.downloadSource({reference:sourceReference,path:join(directory,'original-deployment.source')});
    await checkedFile(originalSource.path,sourceReference);report.files.push(originalSource);
    const originalReview=await sender.readReview({kind:'release',id:selectedRelease.id,revision:selectedRelease.revision});
    need(originalReview.schema==='stellar-forge.flowable-operation-review.v1' &&
      originalReview.originals.some(item=>item.reference.sha256===sourceReference.sha256),'The installed review exposes the actual original deployment bytes.');
    const cliInputPath=join(directory,'cli-review-input.json');
    await common.publish(cliInputPath,{kind:'release',id:selectedRelease.id,revision:selectedRelease.revision},{lease});
    const reviewFile=join(directory,'complete-installed-review.json');
    const cliCalls=[
      ['actions'],
      ['inspect','--dir',senderDirectory],
      ['status','--dir',senderDirectory],
      ['record','--dir',senderDirectory,'--kind','release','--id',selectedRelease.id,'--revision',String(selectedRelease.revision)],
      ['call','--dir',senderDirectory,'--method','readReview','--input',cliInputPath,'--out',reviewFile],
    ];
    for(const args of cliCalls) {
      const result=await runCLI(sourceRoot,args,signal);report.cli.push(result.receipt);
      if(args[0]==='actions')need(result.value.length===21,'The installed CLI exposes every original workspace action.');
      if(args[0]==='status')need(result.value.workspaceId===senderStatus.workspaceId,'CLI and SDK use the same native workspace.');
      if(args[0]==='record')need(result.value.sha256===selectedRelease.sha256,'CLI reads the same immutable native record.');
    }
    const reviewBytes=await readFile(reviewFile), reviewValue=JSON.parse(reviewBytes);
    need(canonical(reviewValue)===canonical(originalReview),'The CLI receives the complete original field review.');
    report.files.push(await checkedFile(reviewFile));
    mark('Installed SDK, original CLI and exact deployment source',{release:ref(selectedRelease),source:sourceReference,
      actions:21,reviewSha256:hash(reviewBytes)});
    const laterInput={requestId:request('later-portfolio'),connectionId:senderStatus.connections.find(item=>item.connection.id===configuration.connection.id)?.id,
      label:'Installed operator continuation of original native portfolio'};
    need(laterInput.connectionId,'Select the original saved native engine.');
    const later=await sender.capturePortfolio(laterInput);
    need(later.value.state==='CAPTURED','The installed SDK captures all original native collections.');
    const laterReplay=await sender.capturePortfolio(laterInput);
    need(laterReplay.id===later.id && laterReplay.sha256===later.sha256,'Same-request capture reopens the original observation.');
    const collections={};
    for(const collection of ['deployments','definitions','processes','tasks','historicProcesses','historicTasks','historicActivities','historicVariables']) {
      let offset=0,count=0;const ids=[];
      for(;;) {
        const page=await sender.readPortfolio({id:later.id,revision:later.revision,collection,offset,limit:2});
        need(page.complete && page.offset===offset,'The original captured native collection is complete.');
        count+=page.items.length;ids.push(...page.items.map(item=>item.id??null));
        if(page.nextOffset===null){need(count===page.total,'Read the whole saved collection.');break;}
        need(page.nextOffset>offset,'Native collection paging advances.');offset=page.nextOffset;
      }
      collections[collection]={count,identitiesSha256:hash(canonical(ids))};
    }
    const definitions=await sender.readPortfolio({id:later.id,revision:later.revision,collection:'definitions',limit:500});
    need(definitions.items.length>0,'The original engine retains deployed process definitions.');
    const nativeDefinition=await sender.readDefinition({portfolioId:later.id,revision:later.revision,definitionId:definitions.items[0].id});
    need(nativeDefinition.resources.length>0,'Definition source URLs resolve to the original retained deployment resources.');
    for(const resource of nativeDefinition.resources) {
      const bytes=Buffer.from(resource.contentBase64,'base64');
      need(bytes.length===resource.bytes && hash(bytes)===resource.sha256,'Retain exact original native resource bytes.');
    }
    const laterDelivery=await sender.exportWorkspace({requestId:request('export-later'),label:'Complete installed Flowable continuation'});
    need(laterDelivery.value.state==='EXPORTED','Export the complete later native workspace.');
    const laterFile=await sender.downloadDelivery({id:laterDelivery.id,path:join(directory,'later-workspace.ndjson'),
      expectedSha256:laterDelivery.value.file.sha256});
    report.files.push(laterFile);
    const receivedLater=await receiver.inspectDeliveryFile({requestId:request('receive-later'),path:laterFile.path,
      label:'Later original native workspace edition',expectedSha256:laterFile.sha256});
    const laterAdopt=await memo('later-adoption-input',{requestId:request('adopt-later'),id:receivedLater.id,
      manifestSha256:receivedLater.value.manifestSha256},async()=>({requestId:request('adopt-later'),id:receivedLater.id,
        expectedRevision:receivedLater.revision,manifestSha256:receivedLater.value.manifestSha256}));
    const adoptedLater=await receiver.adoptDelivery(laterAdopt);
    need(adoptedLater.value.state==='ADOPTED','Receive the complete later native edition.');
    const receiverId=(await receiver.status()).workspaceId,receiverInstance=receiverOwner.instanceId;
    await receiver.close();receiver=undefined;await receiverOwner.close();receiverOwner=undefined;
    await openReceiver();
    need((await receiver.status()).workspaceId===receiverId && receiverOwner.instanceId!==receiverInstance,
      'Cold product reopen preserves the original receiving workspace and creates a new actual listener owner.');
    const recovered=await receiver.adoptDelivery(laterAdopt);
    need(recovered.id===adoptedLater.id && recovered.sha256===adoptedLater.sha256,'Cold same-request adoption reopens its exact original receipt.');
    mark('Later edition, complete collection paging and cold installed receiving',{portfolio:ref(later),collections,
      delivery:ref(laterDelivery),receiving:ref(recovered),workspaceId:receiverId,records:await compareCore(sender,receiver)});
    const {initializeFlowableWorkspaceMerchant}=await load(MCP+'flowable-setup.mjs');
    const {startMerchantMcp}=await load(MCP+'serve.mjs');
    const {MCP_VERSION}=await load('stellar-forge/mcp-paid-agent/http-tools.mjs');
    const connectionFile=join(privateRoot,'merchant-flowable-workspaces.json');
    await common.publish(connectionFile,{schema:'stellar-forge.flowable-workspace-connection.v1',workspaces:{
      sender:{label:'Original Flowable engine operations',workspaceId:senderStatus.workspaceId,
        consoleUrlFile:join(senderDirectory,'browser-url.txt'),files:{}},
      receiver:{label:'Installed Flowable receiving workspace',workspaceId:receiverId,
        consoleUrlFile:join(receiverDirectory,'browser-url.txt'),files:{
          handover:{label:'Complete later native workspace',path:laterFile.path,sha256:laterFile.sha256}}},
    }},{lease});
    const profile=await initializeFlowableWorkspaceMerchant({directory:merchantDirectory,connection:connectionFile,
      name:'Native installed Flowable merchant'});
    const token=randomBytes(32).toString('hex'),tokenEnv='FLOWABLE_INSTALLED_NATIVE_MCP_TOKEN';
    merchant=await startMerchantMcp({configPath:profile.configuration,port:0,tokenEnv,oauthConfigPath:'',
      environment:{...process.env,[tokenEnv]:token}});
    const mcp=mcpConnection(merchant.url,token,signal,MCP_VERSION);await mcp.initialize();
    const advertised=[];let cursor;
    for(;;) {
      const result=await mcp.rpc('tools/list',cursor?{cursor}:{});
      need(Array.isArray(result.tools),'The original merchant advertises its actual installed tools.');
      advertised.push(...result.tools.map(item=>item.name));
      if(!result.nextCursor)break;need(result.nextCursor!==cursor,'MCP tool pagination advances.');cursor=result.nextCursor;
    }
    const names=advertised.filter(name=>name.startsWith('merchant_flowable_'));
    need(names.length===27 && new Set(names).size===27,'The selected installed merchant exposes all 27 original Flowable tools.');
    const remoteStatus=await mcp.tool('merchant_flowable_status',{workspace:'sender'});
    need(remoteStatus.workspaceId===senderStatus.workspaceId,'Authenticated MCP and Applications use the same original workspace.');
    let chunksRead=0,reopenedReader=false;
    async function retainedFile(delivery,output,{interrupt=false}={}) {
      const manifest=await mcp.tool('merchant_flowable_export_manifest',{exportId:delivery.exportId});
      need(manifest.manifestSha256===delivery.manifestSha256 && manifest.workspaceId===delivery.workspaceId &&
        manifest.files.length===1,'Read the complete original retained export manifest.');
      const selected=manifest.files[0],{manifestSha256,...originalManifest}=manifest;
      const manifestBytes=Buffer.from(JSON.stringify(originalManifest,null,2)+'\n');
      need(hash(manifestBytes)===manifestSha256,'The complete original manifest text and hash agree.');
      let readId,offset=0,released=false,ended=false;
      async function* chunks() {
        try {
          for(;;) {
            const value=await mcp.tool('merchant_flowable_export_file',{exportId:delivery.exportId,file:'original',
              expectedManifestSha256:manifestSha256,expectedSha256:selected.sha256,
              ...(readId?{readId}:{}),offset,limit:65536});
            const bytes=Buffer.from(value.data,'base64');
            need(value.exportId===delivery.exportId && value.manifestSha256===manifestSha256 &&
              value.file.sha256===selected.sha256 && value.file.bytes===selected.bytes &&
              value.offset===offset && value.bytesRead===bytes.length && value.encoding==='base64' &&
              value.data===bytes.toString('base64'),'Every native MCP range must retain exact original identity and bytes.');
            need(value.nextOffset===null ? offset+bytes.length===selected.bytes : value.nextOffset===offset+bytes.length,
              'Read all bytes without a gap or overlap.');
            chunksRead++;readId=value.readId;yield bytes;
            if(value.nextOffset===null){ended=true;break;}
            offset=value.nextOffset;
            if(interrupt&&!released) {
              await mcp.tool('merchant_flowable_export_file_release',{exportId:delivery.exportId,readId});
              released=true;readId=undefined;reopenedReader=true;
            }
          }
        } finally {
          if(readId&&!ended)await mcp.tool('merchant_flowable_export_file_release',{exportId:delivery.exportId,readId});
        }
      }
      const response=new Response(Readable.toWeb(Readable.from(chunks())),{headers:{
        'Content-Type':selected.mediaType??'application/octet-stream','Content-Length':String(selected.bytes),'x-content-sha256':selected.sha256}});
      const file=await retainFlowableResponse(response,output,{expectedSha256:selected.sha256,expectedBytes:selected.bytes,signal});
      await checkedFile(file.path,selected);
      return {file,manifest:{exportId:manifest.exportId,sha256:manifestSha256,workspaceId:manifest.workspaceId,kind:manifest.kind}};
    }
    const exported=await mcp.tool('merchant_flowable_download',{workspace:'sender',kind:'delivery',id:laterDelivery.id});
    need(exported.state==='COMPLETE_RESULT_RETAINED' && exported.original.deliveryId===laterDelivery.id &&
      exported.files[0].bytes>65536,'Receive the real full native handover across multiple original MCP ranges.');
    const mcpReceived=await retainedFile(exported,join(directory,'mcp-complete-workspace.ndjson'),{interrupt:true});
    need(mcpReceived.file.sha256===laterFile.sha256 && mcpReceived.file.bytes===laterFile.bytes && reopenedReader,
      'Interrupted MCP reader resumes the same complete original file.');
    report.files.push(mcpReceived.file);
    const remoteInspection=await mcp.tool('merchant_flowable_inspect_delivery',{workspace:'receiver',file:'handover',
      requestId:request('mcp-inspect'),label:'Native MCP complete declared handover'});
    const remoteAdopt=await memo('mcp-adoption-input',{workspace:'receiver',requestId:request('mcp-adopt'),
      id:remoteInspection.id,manifestSha256:remoteInspection.value.manifestSha256},async()=>({
        workspace:'receiver',requestId:request('mcp-adopt'),id:remoteInspection.id,
        expectedRevision:remoteInspection.revision,manifestSha256:remoteInspection.value.manifestSha256}));
    const remoteAdopted=await mcp.tool('merchant_flowable_adopt_delivery',remoteAdopt);
    need(remoteAdopted.value.state==='ADOPTED','MCP invokes the original native receiving authority.');
    const remoteReplay=await mcp.tool('merchant_flowable_adopt_delivery',remoteAdopt);
    need(remoteReplay.sha256===remoteAdopted.sha256,'MCP same-request receiving returns its original completed record.');
    const nativeSourceExport=await mcp.tool('merchant_flowable_download',{workspace:'sender',kind:'source',reference:sourceReference});
    const mcpSource=await retainedFile(nativeSourceExport,join(directory,'mcp-original-deployment.source'));
    need(mcpSource.file.sha256===sourceReference.sha256 && mcpSource.file.bytes===sourceReference.bytes,
      'MCP delivers the complete native source blob.');
    report.files.push(mcpSource.file);
    mark('Authenticated installed MCP and original range receiving',{toolCount:names.length,
      toolNamesSha256:hash(canonical(names)),manifest:mcpReceived.manifest,receiving:ref(remoteAdopted),
      chunksRead,reopenedReader,sourceManifest:mcpSource.manifest});
    if(configuration.playwrightModule && configuration.chromiumExecutable) {
      const imported=await import(pathToFileURL(configuration.playwrightModule).href);
      const playwright=imported.chromium?imported:imported.default;
      const browser=await playwright.chromium.launch({headless:true,executablePath:configuration.chromiumExecutable,args:['--no-sandbox','--disable-dev-shm-usage']});
      try {
        const page=await browser.newPage({viewport:{width:1440,height:1000}});
        await page.goto(liveSession.browserUrl,{waitUntil:'networkidle'});
        await page.waitForSelector('body');
        await page.getByRole('button',{name:'Definitions',exact:true}).click();
        await page.waitForSelector('#definitions-table table');
        const screenshot=join(directory,'installed-definitions.png');
        await page.screenshot({path:screenshot,fullPage:true});
        report.files.push(await checkedFile(screenshot));
        mark('Actual installed product browser',{screenshot:'installed-definitions.png',workspaceId:senderStatus.workspaceId});
      } finally {await browser.close();}
    }
    preparedReport=report;
  } catch(error) {errors.push(error);}
  finally {
    for(const [name,close] of [
      ['merchant',()=>merchant?.close()],['receiver-client',()=>receiver?.close()],
      ['receiver-owner',()=>receiverOwner?.close()],['sender-client',()=>sender?.close()],
      ['Applications',()=>stopApplication()],['runtime-workspace',()=>apps?.close()],
    ]) {
      try {const receipt=await close();if(receipt)mark('Original '+name+' owner closed',receipt);}
      catch(error){errors.push(Object.assign(error,{owner:name}));}
    }
    try {
    if(errors.length) {
      const failureReport={schema:SCHEMA,state:'FAILED',operation:configuration.operation,
        sourceRevision:configuration.sourceRevision,completedAt:new Date().toISOString(),
        checks:report.checks,files:report.files,errors:errors.map(error=>({code:error.code??'FLOWABLE_INSTALLED_FAILURE',
          owner:error.owner??null,message:String(error.message).slice(0,2000)}))};
      try{await publish('installed-result.json',failureReport);state.failure=failureReport.errors;await save();}
      catch(error){errors.push(error);}
    } else {
      preparedReport.state='PASSED';preparedReport.completedAt=new Date().toISOString();
      preparedReport.privateOwnerState='OUTSIDE_HANDOVER';preparedReport.credentialReferences={
        usernameEnv:configuration.connection.usernameEnv,passwordEnv:configuration.connection.passwordEnv};
      await publish('installed-result.json',preparedReport);
      state.completedAt=preparedReport.completedAt;state.resultSha256=hash(JSON.stringify(preparedReport,null,2)+'\n');await save();
    }
    } finally {await lease.close();}
  }
  if(errors.length)throw new AggregateError(errors,'The original installed Flowable continuation did not complete.');
  return preparedReport;
}

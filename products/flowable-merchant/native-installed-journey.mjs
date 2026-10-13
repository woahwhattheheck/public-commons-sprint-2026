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
const CORE_KINDS = ['connection','portfolio','release','process','task','migration','decisionPortfolio','decisionRelease','decisionEvaluation',
  'casePortfolio','caseRelease','caseInstance','casePlanItem','caseTask','programme'];
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
  directory, configuration, sourceWorkspaceDirectory, sourceDelivery, reviewerUserId, caseContinuation, signal,
}) {
  need(configuration && configuration.installedVersion==='8.0.0' && /^[a-f0-9]{40}$/.test(configuration.sourceRevision??''),
    'Select the complete original installed Flowable release.');
  need(typeof configuration.runtimeDirectory==='string' && typeof configuration.environmentFile==='string',
    'Use the original READY runtime and host-owned private Applications environment.');
  directory=resolve(directory);sourceWorkspaceDirectory=resolve(sourceWorkspaceDirectory);
  const sourceRoot=await realpath(configuration.installedSourceRoot??join(configuration.runtimeDirectory,'package','source'));
  need(sourceRoot===resolve(dirname(fileURLToPath(import.meta.url)),'../..'),'Execute this hook from the original installed source.');
  const load=path=>import(pathToFileURL(join(sourceRoot,path)).href);
  const [{FLOWABLE_WORKSPACE_ACTIONS:declaredActions},{flowableWorkspaceTools:declaredTools}]=await Promise.all([
    load(SDK+'workspace/actions.mjs'),load(MCP+'catalog/flowable-workspace.mjs')]);
  const expectedActionNames=Object.keys(declaredActions).sort();
  const expectedToolNames=declaredTools(name=>({name})).map(tool=>tool.name).sort();
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
      environmentFile:configuration.environmentFile,outputDirectory:directory,caseContinuation};
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
      name:'Native Flowable sender',connections:[configuration.connection,configuration.dmnConnection,configuration.cmmnConnection]});
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
      if(args[0]==='actions')need(canonical(result.value.map(item=>item.name).sort())===canonical(expectedActionNames),'The installed CLI exposes every declared original workspace action.');
      if(args[0]==='status')need(result.value.workspaceId===senderStatus.workspaceId,'CLI and SDK use the same native workspace.');
      if(args[0]==='record')need(result.value.sha256===selectedRelease.sha256,'CLI reads the same immutable native record.');
    }
    const reviewBytes=await readFile(reviewFile), reviewValue=JSON.parse(reviewBytes);
    need(canonical(reviewValue)===canonical(originalReview),'The CLI receives the complete original field review.');
    report.files.push(await checkedFile(reviewFile));
    mark('Installed SDK, original CLI and exact deployment source',{release:ref(selectedRelease),source:sourceReference,
      actions:expectedActionNames.length,reviewSha256:hash(reviewBytes)});
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

    const decisionConnectionId=senderStatus.connections.find(item=>item.connection.id===configuration.dmnConnection?.id)?.id;
    need(decisionConnectionId,'Continue the original saved DMN engine connection.');
    const decisionSeed=await memo('original-decision-continuation',{deliverySha256:sourceDelivery.sha256},async()=>{
      const records=(await allRecords(sender,'decisionEvaluation')).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
      for(const item of records) {
        const record=await sender.getRecord({kind:'decisionEvaluation',id:item.id});
        if(!record.value.response || !['CONFIRMED','ACCEPTED','OBSERVED'].includes(record.value.state))continue;
        const response=(await sender.readSource({reference:record.value.response})).value;
        const selection=(await sender.readSource({reference:record.value.selection})).value;
        if(response.status===201 && Array.isArray(response.json?.resultVariables) && selection?.bodyText) {
          return {record:ref(record),selection,resultVariables:response.json.resultVariables,
            responseSha256:response.bodySha256,planSha256:record.value.planSha256};
        }
      }
      throw fail('Continue an actual successful native decision evaluation from the complete original handover.');
    });
    async function decisionOutcome(record,surface,reconcile) {
      record=await sender.getRecord({kind:'decisionEvaluation',id:record.id});
      if(record.value.dispatchedAt && ['UNKNOWN','DISPATCHED','READBACK'].includes(record.value.state)) {
        // Continue the saved native dispatch through this surface's stable readback request.
        record=await reconcile(record);
        record=await sender.getRecord({kind:'decisionEvaluation',id:record.id});
      }
      need(['CONFIRMED','ACCEPTED','OBSERVED'].includes(record.value.state) && record.value.response,
        surface+' must retain an accepted native decision evaluation.');
      const response=(await sender.readSource({reference:record.value.response})).value;
      need(response.status===201 && canonical(response.json?.resultVariables)===canonical(decisionSeed.resultVariables),
        surface+' must return the current original native decision result variables.');
      const review=await sender.readReview({kind:'decisionEvaluation',id:record.id,revision:record.revision});
      const reviewPath=join(directory,surface.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-decision-review.json');
      await common.publish(reviewPath,review,{replace:true,lease});
      report.files.push(await checkedFile(reviewPath));
      return {record:ref(record),response:{status:response.status,bytes:response.bodyBytes,sha256:response.bodySha256},
        resultVariables:response.json.resultVariables};
    }
    // Preparation is a resumable native read. Ask for the current saved record instead of
    // memoizing an interrupted result; a dispatched decision continues through readback.
    const decisionPrepared=await sender.prepareDecisionEvaluation({
      requestId:request('sdk-decision-prepare'),connectionId:decisionConnectionId,
      label:'Installed SDK native decision continuation',selection:decisionSeed.selection});
    const decisionSdk=decisionPrepared.value.dispatchedAt?decisionPrepared:await sender.dispatchDecisionEvaluation({
      requestId:request('sdk-decision-dispatch:review:'+decisionPrepared.revision),
      id:decisionPrepared.id,expectedRevision:decisionPrepared.revision,planSha256:decisionPrepared.value.planSha256});
    const decisionSdkResult=await decisionOutcome(decisionSdk,'Installed SDK',record=>sender.reconcileOperation({
      requestId:request('sdk-decision-reconcile'),kind:'decisionEvaluation',id:record.id}));
    const decisionSelectionPath=join(directory,'original-native-decision-selection.json');
    await common.publish(decisionSelectionPath,decisionSeed.selection,{replace:true,lease});
    const decisionCliPrepared=await runCLI(sourceRoot,[
      'prepare','--dir',senderDirectory,'--kind','decisionEvaluation','--request',request('cli-decision-prepare'),
      '--connection',decisionConnectionId,'--selection',decisionSelectionPath,
      '--label','Installed CLI native decision continuation'],signal);
    report.cli.push(decisionCliPrepared.receipt);
    const cliPrepared=decisionCliPrepared.value;
    let decisionCliValue=cliPrepared;
    if(!cliPrepared.value.dispatchedAt){
      const decisionCli=await runCLI(sourceRoot,['dispatch','--dir',senderDirectory,'--kind','decisionEvaluation',
        '--request',request('cli-decision-dispatch:review:'+cliPrepared.revision),'--id',cliPrepared.id,'--revision',String(cliPrepared.revision),
        '--plan-sha256',cliPrepared.value.planSha256],signal);
      report.cli.push(decisionCli.receipt);decisionCliValue=decisionCli.value;
    }
    const decisionCliResult=await decisionOutcome(decisionCliValue,'Installed CLI',async record=>{
      const continued=await runCLI(sourceRoot,['reconcile','--dir',senderDirectory,'--kind','decisionEvaluation',
        '--request',request('cli-decision-reconcile'),'--id',record.id],signal);
      report.cli.push(continued.receipt);return continued.value;
    });
    const decisionPortfolio=await sender.captureDecisionPortfolio({requestId:request('installed-decision-portfolio'),
      connectionId:decisionConnectionId,label:'Complete installed native decision history'});
    need(decisionPortfolio.value.state==='CAPTURED','The installed SDK captures the whole native decision portfolio.');
    const decisionCollections={},decisionItems={};
    for(const collection of ['deployments','definitions','historicExecutions']) {
      const items=[];let offset=0;
      for(;;) {
        const page=await sender.readDecisionPortfolio({id:decisionPortfolio.id,revision:decisionPortfolio.revision,collection,offset,limit:2});
        need(page.complete && page.offset===offset,'The installed decision capture keeps each original complete native collection.');
        items.push(...page.items);
        if(page.nextOffset===null){need(items.length===page.total,'Read every captured native decision record.');break;}
        need(page.nextOffset>offset,'Native decision paging advances.');offset=page.nextOffset;
      }
      decisionItems[collection]=items;
      decisionCollections[collection]={count:items.length,identitiesSha256:hash(canonical(items.map(item=>item.id)))};
    }
    need(decisionItems.definitions.length>=6 && decisionItems.historicExecutions.length>0,
      'The installed product continues all three native decision families and both source editions.');
    const decisionKey=JSON.parse(decisionSeed.selection.bodyText).decisionKey;
    const selectedDecision=decisionItems.definitions.filter(item=>item.key===decisionKey)
      .sort((a,b)=>Number(b.version)-Number(a.version))[0];
    need(selectedDecision,'The original evaluated native definition remains in the complete capture.');
    const installedDefinition=await sender.readDecisionDefinition({portfolioId:decisionPortfolio.id,
      revision:decisionPortfolio.revision,definitionId:selectedDecision.id});
    need(installedDefinition.resources.some(item=>item.kind==='dmn-definition-resource'),
      'Installed decision definition opens its complete original DMN resource.');
    const selectedExecution=decisionItems.historicExecutions.find(item=>
      item.decisionDefinitionId===selectedDecision.id || item.decisionKey===decisionKey || item.decisionDefinitionKey===decisionKey)
      ?? decisionItems.historicExecutions[0];
    const installedAudit=await sender.readDecisionExecution({portfolioId:decisionPortfolio.id,
      revision:decisionPortfolio.revision,executionId:selectedExecution.id});
    need(installedAudit.resources.some(item=>item.kind==='dmn-execution-audit'),
      'Installed history opens the original selected execution audit.');
    for(const [prefix,resources] of [['decision',installedDefinition.resources],['audit',installedAudit.resources]]) {
      for(const resource of resources)if(resource.originalResource) {
        const received=await sender.downloadSource({reference:resource.originalResource,
          path:join(directory,prefix+'-'+resource.sha256+'.source')});
        await checkedFile(received.path,resource.originalResource);report.files.push(received);
      }
    }
    for(const args of [
      ['decision-portfolio','--dir',senderDirectory,'--id',decisionPortfolio.id,'--revision',String(decisionPortfolio.revision),
        '--collection','historicExecutions','--limit','2'],
      ['decision-definition','--dir',senderDirectory,'--portfolio',decisionPortfolio.id,'--definition',selectedDecision.id,
        '--revision',String(decisionPortfolio.revision)],
      ['decision-execution','--dir',senderDirectory,'--portfolio',decisionPortfolio.id,'--execution',selectedExecution.id,
        '--revision',String(decisionPortfolio.revision)],
    ]) {
      const result=await runCLI(sourceRoot,args,signal);report.cli.push(result.receipt);
      need(result.value.portfolio?.id===decisionPortfolio.id && result.value.portfolio.revision===decisionPortfolio.revision,
        'The installed decision CLI reads the selected original portfolio and revision.');
    }
    mark('Native installed decision evaluation, source and audit',{source:decisionSeed.record,
      sdk:decisionSdkResult,cli:decisionCliResult,portfolio:ref(decisionPortfolio),collections:decisionCollections,
      definitionId:selectedDecision.id,executionId:selectedExecution.id});


    const caseConnectionId=senderStatus.connections.find(item=>item.connection.id===configuration.cmmnConnection?.id)?.id;
    need(caseConnectionId && caseContinuation?.connectionId===caseConnectionId &&
      caseContinuation.portfolio?.kind==='casePortfolio' && typeof caseContinuation.caseInstanceId==='string' &&
      typeof caseContinuation.definitionId==='string' && typeof caseContinuation.taskId==='string' &&
      typeof caseContinuation.taskCompletionBodyText==='string',
      'Continue the original commissioner case, definition, portfolio and exact active human task.');
    need(JSON.parse(caseContinuation.taskCompletionBodyText).action==='complete',
      'Keep the original native completion body for this case task.');
    const {FLOWABLE_CMMN_COLLECTIONS}=await load(SDK+'cmmn-native.mjs');
    const {flowableCaseInstanceId}=await load(SDK+'workspace/actions.mjs');
    const caseSeed=await memo('original-case-continuation',{deliverySha256:sourceDelivery.sha256,
      continuation:caseContinuation},async()=>{
      const original=await sender.getRecord({kind:'casePortfolio',id:caseContinuation.portfolio.id,
        revision:caseContinuation.portfolio.revision});
      need(original.sha256===caseContinuation.portfolio.sha256 && original.value.connectionId===caseConnectionId,
        'The active case continuation belongs to the exact original exported CMMN portfolio.');
      const selected=await sender.readCaseInstance({portfolioId:original.id,revision:original.revision,
        caseInstanceId:caseContinuation.caseInstanceId});
      const task=selected.related.tasks.find(item=>item.id===caseContinuation.taskId);
      need(selected.caseInstance?.id===caseContinuation.caseInstanceId &&
        selected.caseInstance.caseDefinitionId===caseContinuation.definitionId &&
        task && flowableCaseInstanceId(task)===caseContinuation.caseInstanceId,
        'The original captured task is active on the selected original case and definition.');
      if(caseContinuation.taskDefinitionKey)need(task.taskDefinitionKey===caseContinuation.taskDefinitionKey,
        'Retain the original human-task definition key.');
      const definition=await sender.readCaseDefinition({portfolioId:original.id,revision:original.revision,
        definitionId:caseContinuation.definitionId});
      need(definition.resources.some(item=>item.kind==='cmmn-definition-resource'),
        'The selected case definition retains the complete original CMMN deployment source.');
      return {...caseContinuation,portfolio:ref(original),originalTask:task,definition,originalCase:selected};
    });
    const caseSelections={
      claim:{action:'claim',caseInstanceId:caseSeed.caseInstanceId,taskId:caseSeed.taskId,
        bodyText:JSON.stringify({action:'claim',assignee:reviewerUserId})},
      unclaim:{action:'unclaim',caseInstanceId:caseSeed.caseInstanceId,taskId:caseSeed.taskId,
        bodyText:'{"action":"claim","assignee":null}'},
      complete:{action:'complete',caseInstanceId:caseSeed.caseInstanceId,taskId:caseSeed.taskId,
        bodyText:caseSeed.taskCompletionBodyText},
    };
    async function retainCaseOutcome(record,kind,selection,surface,reconcile) {
      record=await sender.getRecord({kind,id:record.id});
      if(record.value.dispatchedAt && ['UNKNOWN','DISPATCHED','READBACK'].includes(record.value.state)) {
        await reconcile(record);
        record=await sender.getRecord({kind,id:record.id});
      }
      need(record.value.state==='CONFIRMED' && record.value.after,
        surface+' must retain the original native CMMN outcome; an uncertain dispatch is never sent again.');
      const savedSelection=(await sender.readSource({reference:record.value.selection})).value;
      need(canonical(savedSelection)===canonical(selection),'Retain the exact original '+surface+' case selection.');
      const after=(await sender.readSource({reference:record.value.after})).value;
      let native;
      if(kind==='caseTask') {
        const current=after.tasks.find(item=>item.id===selection.taskId),
          historic=after.historicTasks.find(item=>item.id===selection.taskId);
        native=current??historic;
        need(native && flowableCaseInstanceId(native)===caseSeed.caseInstanceId,
          surface+' must resolve the original task to the selected CMMN case.');
        if(selection.action==='complete')need(!current && historic?.endTime &&
          [null,undefined,'completed'].includes(historic.deleteReason),
          'The completed original case task must be absent from runtime and retained in native history.');
        else if(selection.action==='claim'||selection.action==='unclaim')
          need(current && (current.assignee??null)===JSON.parse(selection.bodyText).assignee,
            'The original native task assignment must match the reviewed request.');
      } else {
        native=after.planItems.find(item=>item.id===selection.planItemInstanceId)??
          after.historicPlanItems.find(item=>item.id===selection.planItemInstanceId);
        need(native && flowableCaseInstanceId(native)===caseSeed.caseInstanceId,
          'The original native plan item belongs to the selected case.');
      }
      let response=null;
      if(record.value.response) {
        const original=(await sender.readSource({reference:record.value.response})).value;
        need(original.complete && original.ok,'Retain the complete successful original CMMN response.');
        response={status:original.status,bytes:original.bodyBytes,sha256:original.bodySha256};
      }
      const review=await sender.readReview({kind,id:record.id,revision:record.revision});
      const prefix=surface.toLowerCase().replace(/[^a-z0-9]+/g,'-'),path=join(directory,prefix+'-case-review.json');
      await common.publish(path,review,{replace:true,lease});const file=await checkedFile(path);
      report.files.push(file);
      for(const original of review.originals??[]) {
        const received=await sender.downloadSource({reference:original.reference,
          path:join(directory,'case-original-'+original.reference.sha256+'.source')});
        await checkedFile(received.path,original.reference);report.files.push(received);
      }
      return {record:ref(record),selection,response,after:record.value.after,native,review:file};
    }
    const sdkCase=await memo('sdk-case-task',{connectionId:caseConnectionId,selection:caseSelections.claim},async()=>{
      const prepared=await sender.prepareCaseTask({requestId:request('sdk-case-task-prepare'),connectionId:caseConnectionId,
        label:'Installed SDK claim of original CMMN task',selection:caseSelections.claim});
      const record=prepared.value.dispatchedAt?prepared:await sender.dispatchCaseTask({
        requestId:request('sdk-case-task-dispatch:review:'+prepared.revision),id:prepared.id,
        expectedRevision:prepared.revision,planSha256:prepared.value.planSha256});
      return retainCaseOutcome(record,'caseTask',caseSelections.claim,'Installed SDK claim',record=>sender.reconcileOperation({
        requestId:request('sdk-case-task-reconcile:'+record.revision),kind:'caseTask',id:record.id}));
    });
    const caseSelectionPath=join(directory,'original-case-unclaim-selection.json');
    await common.publish(caseSelectionPath,caseSelections.unclaim,{replace:true,lease});
    const cliCase=await memo('cli-case-task',{connectionId:caseConnectionId,selection:caseSelections.unclaim},async()=>{
      const prepared=await runCLI(sourceRoot,['prepare','--dir',senderDirectory,'--kind','caseTask',
        '--request',request('cli-case-task-prepare'),'--connection',caseConnectionId,'--selection',caseSelectionPath,
        '--label','Installed CLI release of original CMMN task claim'],signal);
      report.cli.push(prepared.receipt);let record=prepared.value;
      if(!record.value.dispatchedAt) {
        const dispatched=await runCLI(sourceRoot,['dispatch','--dir',senderDirectory,'--kind','caseTask',
          '--request',request('cli-case-task-dispatch:review:'+record.revision),'--id',record.id,
          '--revision',String(record.revision),'--plan-sha256',record.value.planSha256],signal);
        report.cli.push(dispatched.receipt);record=dispatched.value;
      }
      return retainCaseOutcome(record,'caseTask',caseSelections.unclaim,'Installed CLI unclaim',async record=>{
        const result=await runCLI(sourceRoot,['reconcile','--dir',senderDirectory,'--kind','caseTask',
          '--request',request('cli-case-task-reconcile:'+record.revision),'--id',record.id],signal);
        report.cli.push(result.receipt);return result.value;
      });
    });
    async function allCaseCollections(portfolio,read) {
      const summaries={},items={};
      for(const collection of FLOWABLE_CMMN_COLLECTIONS) {
        let offset=0;const rows=[];
        for(;;) {
          const page=await read({id:portfolio.id,revision:portfolio.revision,collection,offset,limit:17});
          need(page.portfolio?.id===portfolio.id && page.portfolio.revision===portfolio.revision &&
            page.complete && page.offset===offset,'Read the exact complete saved CMMN collection and revision.');
          rows.push(...page.items);
          if(page.nextOffset===null){need(rows.length===page.total,'Read every original native CMMN record.');break;}
          need(page.nextOffset>offset,'Original CMMN collection paging must advance.');offset=page.nextOffset;
        }
        items[collection]=rows;
        summaries[collection]={count:rows.length,sha256:hash(canonical(rows))};
      }
      return {items,summaries};
    }
    const casePortfolio=await sender.captureCasePortfolio({requestId:request('installed-case-portfolio'),
      connectionId:caseConnectionId,label:'Complete installed native case work and history'});
    need(casePortfolio.value.state==='CAPTURED','Capture every original native CMMN collection.');
    const caseCollections=await allCaseCollections(casePortfolio,input=>sender.readCasePortfolio(input));
    need(caseCollections.items.definitions.length>=6 && caseCollections.items.historicCases.length>0,
      'Retain both native editions of all three original case families and their completed history.');
    const installedCaseDefinition=await sender.readCaseDefinition({portfolioId:casePortfolio.id,
      revision:casePortfolio.revision,definitionId:caseSeed.definitionId});
    const installedCase=await sender.readCaseInstance({portfolioId:casePortfolio.id,revision:casePortfolio.revision,
      caseInstanceId:caseSeed.caseInstanceId});
    need(installedCase.caseInstance?.id===caseSeed.caseInstanceId &&
      installedCase.related.tasks.some(item=>item.id===caseSeed.taskId && flowableCaseInstanceId(item)===caseSeed.caseInstanceId),
      'Installed case work remains bound to the same original active task.');
    for(const resource of [...installedCaseDefinition.resources,...installedCase.resources]) {
      const bytes=Buffer.from(resource.contentBase64,'base64');
      need(bytes.length===resource.bytes && hash(bytes)===resource.sha256,
        'The original case source and native binary variable bytes must be complete.');
      if(resource.originalResource) {
        const received=await sender.downloadSource({reference:resource.originalResource,
          path:join(directory,'case-resource-'+resource.sha256+'.source')});
        await checkedFile(received.path,resource.originalResource);report.files.push(received);
      }
    }
    for(const args of [
      ['case-portfolio','--dir',senderDirectory,'--id',casePortfolio.id,'--revision',String(casePortfolio.revision),
        '--collection','historicPlanItems','--limit','2'],
      ['case-definition','--dir',senderDirectory,'--portfolio',casePortfolio.id,'--definition',caseSeed.definitionId,
        '--revision',String(casePortfolio.revision)],
      ['case-instance','--dir',senderDirectory,'--portfolio',casePortfolio.id,'--case',caseSeed.caseInstanceId,
        '--revision',String(casePortfolio.revision)],
    ]) {
      const result=await runCLI(sourceRoot,args,signal);report.cli.push(result.receipt);
      need(result.value.portfolio?.id===casePortfolio.id && result.value.portfolio.revision===casePortfolio.revision,
        'CLI reads the exact original case portfolio edition.');
      if(args[0]==='case-definition')need(canonical(result.value)===canonical(installedCaseDefinition),
        'CLI and SDK return the same complete CMMN definition and resources.');
      if(args[0]==='case-instance')need(canonical(result.value)===canonical(installedCase),
        'CLI and SDK return the same original case work, variables and history.');
    }
    mark('Installed CMMN SDK, CLI and complete saved work',{portfolio:ref(casePortfolio),
      original:caseSeed.portfolio,caseInstanceId:caseSeed.caseInstanceId,definitionId:caseSeed.definitionId,
      taskId:caseSeed.taskId,sdk:sdkCase,cli:cliCase,collections:caseCollections.summaries});

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
    need(new Set(names).size===names.length&&canonical([...names].sort())===canonical(expectedToolNames),'The selected installed merchant exposes every source-declared Flowable tool.');
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

    const remoteDecision=await mcp.tool('merchant_flowable_decision_definition',{workspace:'sender',
      portfolioId:decisionPortfolio.id,revision:decisionPortfolio.revision,definitionId:selectedDecision.id});
    const remoteAudit=await mcp.tool('merchant_flowable_decision_execution',{workspace:'sender',
      portfolioId:decisionPortfolio.id,revision:decisionPortfolio.revision,executionId:selectedExecution.id});
    need(canonical(remoteDecision)===canonical(installedDefinition) && canonical(remoteAudit)===canonical(installedAudit),
      'MCP, SDK and CLI open the same complete native definition and audit resources.');
    const mcpDecisionPrepared=await mcp.tool(
      'merchant_flowable_prepare_decision_evaluation',{workspace:'sender',requestId:request('mcp-decision-prepare'),
        connectionId:decisionConnectionId,label:'Installed MCP native decision continuation',selection:decisionSeed.selection});
    const mcpDecision=mcpDecisionPrepared.value.dispatchedAt?mcpDecisionPrepared:
      await mcp.tool('merchant_flowable_dispatch_decision_evaluation',{workspace:'sender',
        requestId:request('mcp-decision-dispatch:review:'+mcpDecisionPrepared.revision),id:mcpDecisionPrepared.id,
        expectedRevision:mcpDecisionPrepared.revision,planSha256:mcpDecisionPrepared.value.planSha256});
    const mcpDecisionResult=await decisionOutcome(mcpDecision,'Installed MCP',record=>mcp.tool('merchant_flowable_reconcile',{
      workspace:'sender',requestId:request('mcp-decision-reconcile'),kind:'decisionEvaluation',id:record.id}));
    const mcpDecisionPortfolio=await mcp.tool('merchant_flowable_capture_decisions',{workspace:'sender',
      requestId:request('mcp-decision-portfolio'),connectionId:decisionConnectionId,label:'Complete MCP decision continuation'});
    need(mcpDecisionPortfolio.value.state==='CAPTURED','MCP captures the original completed native decision continuation.');
    const remoteHistory=await mcp.tool('merchant_flowable_decision_portfolio',{workspace:'sender',
      id:mcpDecisionPortfolio.id,revision:mcpDecisionPortfolio.revision,collection:'historicExecutions',offset:0,limit:2});
    need(remoteHistory.complete && remoteHistory.total>=decisionItems.historicExecutions.length,
      'MCP exposes the original full native execution history after its decision operation.');

    const remoteCaseDefinition=await mcp.tool('merchant_flowable_case_definition',{workspace:'sender',
      portfolioId:casePortfolio.id,revision:casePortfolio.revision,definitionId:caseSeed.definitionId});
    const remoteCase=await mcp.tool('merchant_flowable_case_instance',{workspace:'sender',
      portfolioId:casePortfolio.id,revision:casePortfolio.revision,caseInstanceId:caseSeed.caseInstanceId});
    need(canonical(remoteCaseDefinition)===canonical(installedCaseDefinition) &&
      canonical(remoteCase)===canonical(installedCase),
      'MCP, SDK and CLI open the exact same CMMN definition, binary resources, case work and history.');
    const caseResource=installedCaseDefinition.resources.find(item=>item.kind==='cmmn-definition-resource'&&item.originalResource);
    need(caseResource,'Retain the complete original CMMN resource for browser and agent receiving.');
    const caseSourceExport=await mcp.tool('merchant_flowable_download',{workspace:'sender',kind:'source',
      reference:caseResource.originalResource});
    const caseSourceReceived=await retainedFile(caseSourceExport,join(directory,'mcp-original-case-definition.source'));
    need(caseSourceReceived.file.bytes===caseResource.bytes && caseSourceReceived.file.sha256===caseResource.sha256,
      'The installed MCP receives every byte of the original case definition.');
    report.files.push(caseSourceReceived.file);
    async function mcpCaseOperation(label,kind,selection) {
      return memo('mcp-cmmn:'+label,{kind,connectionId:caseConnectionId,selection},async()=>{
        const suffix={caseTask:'case_task',casePlanItem:'case_plan_item'}[kind];
        need(suffix,'Select one original installed CMMN operation family.');
        const prepared=await mcp.tool('merchant_flowable_prepare_'+suffix,{workspace:'sender',
          requestId:request('mcp-cmmn:'+label+':prepare'),connectionId:caseConnectionId,
          label:configuration.operation+' installed '+label,selection});
        const record=prepared.value.dispatchedAt?prepared:await mcp.tool('merchant_flowable_dispatch_'+suffix,{
          workspace:'sender',requestId:request('mcp-cmmn:'+label+':dispatch:review:'+prepared.revision),
          id:prepared.id,expectedRevision:prepared.revision,planSha256:prepared.value.planSha256});
        return retainCaseOutcome(record,kind,selection,'Installed MCP '+label,record=>mcp.tool('merchant_flowable_reconcile',{
          workspace:'sender',requestId:request('mcp-cmmn:'+label+':reconcile:'+record.revision),kind,id:record.id}));
      });
    }
    async function mcpCaseCapture(label) {
      const portfolio=await mcp.tool('merchant_flowable_capture_cases',{workspace:'sender',
        requestId:request('mcp-cmmn:'+label+':capture'),connectionId:caseConnectionId,
        label:configuration.operation+' '+label});
      need(portfolio.value.state==='CAPTURED','Complete the original native case capture for '+label+'.');
      const work=await mcp.tool('merchant_flowable_case_instance',{workspace:'sender',portfolioId:portfolio.id,
        revision:portfolio.revision,caseInstanceId:caseSeed.caseInstanceId});
      return {portfolio:ref(portfolio),work};
    }
    function oneCaseWork(items,key,value,label) {
      const selected=items.filter(item=>flowableCaseInstanceId(item)===caseSeed.caseInstanceId && item[key]===value);
      need(selected.length===1,'Select exactly one original '+label+' from the saved case work.');
      return selected[0];
    }
    const mcpCaseClaim=await mcpCaseOperation('original task claim','caseTask',caseSelections.claim);
    let completedInstalledCase;
    // All browser and MCP case writes precede the final complete workspace export.
    need(configuration.playwrightModule && configuration.chromiumExecutable,
      'Run the actual installed operator browser using the original selected Chromium runtime.');
    {
      const imported=await import(pathToFileURL(configuration.playwrightModule).href);
      const playwright=imported.chromium?imported:imported.default;
      const browser=await playwright.chromium.launch({headless:true,executablePath:configuration.chromiumExecutable,
        args:['--no-sandbox','--disable-dev-shm-usage']});
      try {
        const page=await browser.newPage({viewport:{width:1440,height:1000}}),browserErrors=[];
        page.on('pageerror',error=>browserErrors.push(String(error)));
        const idle=async()=>{await page.locator('#busy').waitFor({state:'hidden'});
          need((await page.locator('#notice').getAttribute('data-level'))!=='error',
            'The original installed browser action must complete without an error.');};
        async function findRow(container,text) {
          const table=page.locator(container);
          const previous=table.getByRole('button',{name:'Previous',exact:true});
          while(await previous.count() && await previous.isEnabled())await previous.click();
          for(;;) {
            const rows=table.locator('tbody tr').filter({hasText:text});
            if(await rows.count()){need(await rows.count()===1,'Select one original browser row.');return rows;}
            const next=table.getByRole('button',{name:'Next',exact:true});
            need(await next.count() && await next.isEnabled(),'The original saved browser row is absent: '+text);
            await next.click();
          }
        }
        async function browserAction(method,match,click) {
          const response=page.waitForResponse(value=>{
            if(new URL(value.url()).pathname!=='/api/action')return false;
            try{const input=value.request().postDataJSON();return input.method===method&&match(input.args);}
            catch{return false;}
          },{timeout:180000});
          await click();const actual=await response;
          need(actual.ok(),'The actual browser request must return its original successful response.');
          const input=actual.request().postDataJSON(),record=await actual.json();await idle();
          return {input,record};
        }
        await page.goto(liveSession.browserUrl,{waitUntil:'networkidle'});await idle();
        await page.locator('#engine-select').selectOption(laterInput.connectionId);await idle();
        await page.getByRole('button',{name:'Definitions',exact:true}).click();
        await page.waitForSelector('#definitions-table table');
        const screenshot=join(directory,'installed-definitions.png');
        await page.screenshot({path:screenshot,fullPage:true});report.files.push(await checkedFile(screenshot));
        await page.locator('#engine-select').selectOption(decisionConnectionId);await idle();
        await page.getByRole('button',{name:'Decisions',exact:true}).click();
        await page.waitForSelector('#decisions-table table');
        const decisionScreenshot=join(directory,'installed-decisions.png');
        await page.screenshot({path:decisionScreenshot,fullPage:true});report.files.push(await checkedFile(decisionScreenshot));
        await page.locator('#engine-select').selectOption(caseConnectionId);await idle();
        await page.getByRole('button',{name:'Cases',exact:true}).click();
        await page.locator('#case-portfolio-select').selectOption(casePortfolio.id);await idle();
        const definitionRow=await findRow('#case-definitions-table',installedCaseDefinition.definition.deploymentId);
        await definitionRow.getByRole('button',{name:'Source and start',exact:true}).click();await idle();
        need((await page.locator('#detail-content').innerText()).includes(caseSeed.definitionId),
          'The browser opens the exact selected original CMMN definition.');
        const sourceLink=page.locator('#detail-content').getByRole('link',{name:'Download '+caseResource.filename,exact:true});
        need(await sourceLink.count()===1,'Open the complete original case source download in the browser.');
        const sourceDownloadPromise=page.waitForEvent('download');
        await sourceLink.click();const sourceDownload=await sourceDownloadPromise;
        const browserSourcePath=join(directory,'browser-original-case-definition.source');
        await sourceDownload.saveAs(browserSourcePath);
        const browserSource=await checkedFile(browserSourcePath,caseResource.originalResource);
        report.files.push(browserSource);
        const caseSourceScreenshot=join(directory,'installed-case-source.png');
        await page.screenshot({path:caseSourceScreenshot,fullPage:true});report.files.push(await checkedFile(caseSourceScreenshot));
        await page.locator('#close-detail').click();
        const browserCompletion=await memo('browser-case-task',{caseInstanceId:caseSeed.caseInstanceId,
          taskId:caseSeed.taskId,selection:caseSelections.complete},async()=>{
          const label=configuration.operation+' installed browser case completion';
          const existing=(await allRecords(sender,'caseTask')).filter(item=>item.label===label);
          need(existing.length<=1,'One original browser case operation owns this completion.');
          let record,preparedInput,dispatchedInput;
          if(existing.length) {
            record=await sender.getRecord({kind:'caseTask',id:existing[0].id});
            const selection=(await sender.readSource({reference:record.value.selection})).value;
            need(record.value.connectionId===caseConnectionId && canonical(selection)===canonical(caseSelections.complete),
              'Reopen the original browser completion with its exact target and native body.');
            const row=await findRow('#caseTask-records',label);
            await row.getByRole('button',{name:'Review',exact:true}).click();await idle();
            if(!record.value.dispatchedAt && ['INTERRUPTED','PREPARE_FAILED'].includes(record.value.phase)) {
              const resumed=await browserAction('prepareCaseTask',input=>input.label===label,
                ()=>page.locator('#detail-content').getByRole('button',{name:'Resume original preparation',exact:true}).click());
              record=resumed.record;preparedInput=resumed.input;
            }
          } else {
            const form=page.locator('#caseTask-form');
            await form.locator('[name="taskId"]').fill(caseSeed.taskId);
            await form.locator('[name="caseInstanceId"]').fill(caseSeed.caseInstanceId);
            await form.locator('[name="action"]').selectOption('complete');
            await form.locator('[name="label"]').fill(label);
            await form.locator('[name="bodyText"]').fill(caseSeed.taskCompletionBodyText);
            const prepared=await browserAction('prepareCaseTask',input=>input.label===label&&
              canonical(input.selection)===canonical(caseSelections.complete),()=>form.locator('button[type="submit"]').click());
            record=prepared.record;preparedInput=prepared.input;
          }
          record=await sender.getRecord({kind:'caseTask',id:record.id});
          if(!record.value.dispatchedAt) {
            need(record.value.phase==='PREPARED','Complete the original browser preparation before its native task dispatch.');
            const originalId=record.id;
            const dispatched=await browserAction('dispatchCaseTask',input=>input.id===originalId,
              ()=>page.locator('#detail-content').getByRole('button',{name:'Execute case task action',exact:true}).click());
            record=dispatched.record;dispatchedInput=dispatched.input;
          }
          const outcome=await retainCaseOutcome(record,'caseTask',caseSelections.complete,'Installed browser completion',
            record=>sender.reconcileOperation({requestId:request('browser-case-task-reconcile:'+record.revision),
              kind:'caseTask',id:record.id}));
          const after=(await sender.readSource({reference:outcome.after})).value;
          need(after.cases.find(item=>item.id===caseSeed.caseInstanceId)?.state===caseSeed.expectedCaseStateAfterTask &&
            after.planItems.some(item=>item.id===caseSeed.followingPlanItemId &&
              item.planItemDefinitionId===caseSeed.followingPlanItemDefinitionId &&
              item.state===caseSeed.followingPlanItemStateAfterTask &&
              flowableCaseInstanceId(item)===caseSeed.caseInstanceId),
            'The browser completion must activate the original authored source-confirmation work on this case.');
          return {...outcome,...(preparedInput?{preparedInput}:{}),...(dispatchedInput?{dispatchedInput}:{})};
        });
        const caseTaskScreenshot=join(directory,'installed-case-task-completion.png');
        await page.screenshot({path:caseTaskScreenshot,fullPage:true});report.files.push(await checkedFile(caseTaskScreenshot));
        // Continue the authored onboarding v2 model from that same completed review.
        // IDs come from its original native capture; no replacement case is started.
        const sourceConfirmation=await mcpCaseOperation('source confirmation','casePlanItem',{
          action:'triggerPlanItem',caseInstanceId:caseSeed.caseInstanceId,
          planItemInstanceId:caseSeed.followingPlanItemId,bodyText:'{"action":"trigger"}'});
        const exceptionReady=await mcpCaseCapture('source confirmation complete');
        const exceptionItem=oneCaseWork(exceptionReady.work.related.planItems,'planItemDefinitionId','exceptionReview',
          'enabled exception-review plan item');
        need(exceptionItem.state==='enabled','The original source-confirmation sentry enables the selected manual exception review.');
        const exceptionStarted=await mcpCaseOperation('start exception review','casePlanItem',{
          action:'startPlanItem',caseInstanceId:caseSeed.caseInstanceId,planItemInstanceId:exceptionItem.id,bodyText:'{"action":"start"}'});
        const exceptionActive=await mcpCaseCapture('exception review active');
        const exceptionTask=oneCaseWork(exceptionActive.work.related.tasks,'taskDefinitionKey','exceptionReview','exception-review task');
        const exceptionClaim=await mcpCaseOperation('claim exception review','caseTask',{
          action:'claim',caseInstanceId:caseSeed.caseInstanceId,taskId:exceptionTask.id,
          bodyText:'{"action":"claim","assignee":"case-specialist"}'});
        const exceptionComplete=await mcpCaseOperation('complete exception review','caseTask',{
          action:'complete',caseInstanceId:caseSeed.caseInstanceId,taskId:exceptionTask.id,
          bodyText:'{"action":"complete","variables":[{"name":"exceptionResolved","type":"boolean","value":true}]}'});
        const finalReady=await mcpCaseCapture('final case approval active');
        const finalTask=oneCaseWork(finalReady.work.related.tasks,'taskDefinitionKey','finalApproval','final approval task');
        const finalClaim=await mcpCaseOperation('claim final approval','caseTask',{
          action:'claim',caseInstanceId:caseSeed.caseInstanceId,taskId:finalTask.id,
          bodyText:'{"action":"claim","assignee":"case-approver"}'});
        const finalComplete=await mcpCaseOperation('complete final approval','caseTask',{
          action:'complete',caseInstanceId:caseSeed.caseInstanceId,taskId:finalTask.id,
          bodyText:'{"action":"complete","variables":[{"name":"handoverApproved","type":"boolean","value":true}]}'});
        const completed=await mcpCaseCapture('complete installed CMMN history');
        need(!completed.work.caseInstance && completed.work.historicCase?.id===caseSeed.caseInstanceId &&
          completed.work.historicCase.state==='completed' && completed.work.historicCase.endTime &&
          completed.work.related.milestones.length>=2 &&
          completed.work.related.milestones.every(item=>flowableCaseInstanceId(item)===caseSeed.caseInstanceId),
          'The original installed case must complete with its native history and both authored milestones.');
        const finalCollections=await allCaseCollections(completed.portfolio,input=>mcp.tool('merchant_flowable_case_portfolio',
          {workspace:'sender',...input}));
        need(finalCollections.items.historicTasks.some(item=>item.id===caseSeed.taskId&&item.endTime) &&
          !finalCollections.items.tasks.some(item=>flowableCaseInstanceId(item)===caseSeed.caseInstanceId),
          'The final complete capture retains the browser task history and no unfinished native case task.');
        completedInstalledCase={original:caseSeed.portfolio,caseInstanceId:caseSeed.caseInstanceId,definitionId:caseSeed.definitionId,
          taskId:caseSeed.taskId,sdk:sdkCase,cli:cliCase,mcpClaim:mcpCaseClaim,browser:browserCompletion,
          sourceConfirmation,exceptionStarted,exceptionClaim,exceptionComplete,finalClaim,finalComplete,
          portfolio:completed.portfolio,work:completed.work,collections:finalCollections.summaries};
        await page.reload({waitUntil:'networkidle'});await idle();
        await page.locator('#engine-select').selectOption(caseConnectionId);await idle();
        await page.getByRole('button',{name:'Cases',exact:true}).click();
        await page.locator('#case-portfolio-select').selectOption(completed.portfolio.id);await idle();
        await page.locator('#case-collection-select').selectOption('historicCases');await idle();
        const historyRow=await findRow('#case-collection-table',caseSeed.caseInstanceId);
        await historyRow.getByRole('button',{name:'Inspect',exact:true}).click();await idle();
        const historyText=await page.locator('#detail-content').innerText();
        need(historyText.includes(caseSeed.caseInstanceId)&&historyText.includes('completed'),
          'The browser reopens the completed original case and its captured work history.');
        const caseHistoryScreenshot=join(directory,'installed-case-history.png');
        await page.screenshot({path:caseHistoryScreenshot,fullPage:true});report.files.push(await checkedFile(caseHistoryScreenshot));
        need(browserErrors.length===0,'The complete installed browser produced a script error: '+browserErrors.join('\n'));
        mark('Actual installed product browser',{screenshots:['installed-definitions.png','installed-decisions.png',
          'installed-case-source.png','installed-case-task-completion.png','installed-case-history.png'],
          workspaceId:senderStatus.workspaceId,decisionConnectionId,caseConnectionId,browserSource,caseCompletion:browserCompletion.record});
      } finally {await browser.close();}
    }
    mark('Native installed CMMN customer continuation',completedInstalledCase);

    // Continue the complete authored process programme on these same original installed owners.
    const [{buildFlowableProcessProgramme},{receiveFlowableProgramme}]=await Promise.all([
      load(SDK+'workspace/process-programme.mjs'),load(SDK+'workspace/native-programme-receiving.mjs')]);
    const programmeReferencePath=join(sourceRoot,SDK+'workspace/examples/process-commissioning.programme.json');
    const programmeReferenceFile=await checkedFile(programmeReferencePath);
    const programmeReferenceBytes=await readFile(programmeReferencePath);
    need(programmeReferenceBytes.length===programmeReferenceFile.bytes&&hash(programmeReferenceBytes)===programmeReferenceFile.sha256,
      'Read the same complete installed process programme reference.');
    const programmeReference=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(programmeReferenceBytes));
    need(programmeReference.schema==='stellar-forge.flowable-programme.v1'&&programmeReference.steps.length===29&&
      programmeReference.sources.length===10,'Use all twenty-nine original operations and ten complete source members.');
    const programmeMembers=Object.create(null),programmeInputs=Object.create(null);
    for(const member of programmeReference.sources){
      need(typeof member.name==='string'&&!Object.hasOwn(programmeMembers,member.name),
        'Every original programme member has one complete retained source.');
      const inputMatch=/^inputs\/(sf_grant_review|sf_customer_onboarding|sf_vendor_approval)\.json$/.exec(member.name);
      need(inputMatch||/^(?:process-catalog\.json|(?:grant-review|customer-onboarding|vendor-approval)-v[12]\.bpmn20\.xml)$/.test(member.name),
        'Receive only the original authored catalogue, six BPMN files and three typed inputs.');
      const path=join(sourceRoot,SDK+(inputMatch?'workspace/examples/process-inputs/'+inputMatch[1]+'.json':'examples/'+member.name));
      await checkedFile(path,member);
      const bytes=await readFile(path);
      need(bytes.length===member.bytes&&hash(bytes)===member.sha256&&bytes.toString('base64')===member.contentBase64,
        'The installed original member differs from the complete programme: '+member.name);
      programmeMembers[member.name]={...member,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
      if(inputMatch)programmeInputs[inputMatch[1]]=member.name;
    }
    need(typeof configuration.adminUserId==='string'&&configuration.adminUserId&&
      typeof reviewerUserId==='string'&&reviewerUserId&&reviewerUserId===configuration.reviewerUserId,
      'Select the existing native administrator and reviewer created by the original host.');
    const processProgrammeConnection=senderStatus.connections.find(item=>item.connection.id===configuration.connection.id);
    need(processProgrammeConnection&&processProgrammeConnection.connection.baseUrl===configuration.connection.baseUrl,
      'The programme uses the original saved process REST connection.');
    const processProgramme=buildFlowableProcessProgramme({
      catalogText:programmeMembers['process-catalog.json'].text,members:programmeMembers,inputs:programmeInputs,
      operation:'NATIVE-PROCESS-PROGRAMME-'+hash(configuration.operation).slice(0,24),
      roles:{operator:configuration.adminUserId,reviewer:reviewerUserId},
      familyKeys:['sf_grant_review','sf_customer_onboarding','sf_vendor_approval'],
      migrateKeys:['sf_grant_review','sf_vendor_approval'],delegationKey:'sf_customer_onboarding'});
    need(processProgramme.steps.length===29&&processProgramme.sources.length===10,
      'The same native source selection must retain the complete three-family process course.');
    const programmeText=JSON.stringify(processProgramme,null,2)+'\n';
    const programmeInput=await memo('process-programme-input',{
      requestId:request('process-programme'),connectionId:processProgrammeConnection.id,
      referenceSha256:programmeReferenceFile.sha256,programmeSha256:hash(programmeText)},
      async()=>({requestId:request('process-programme'),connectionId:processProgrammeConnection.id,programmeText}));
    await publish('process-commissioning.programme.json',processProgramme);
    report.files.push(await checkedFile(join(directory,'process-commissioning.programme.json'),
      {bytes:Buffer.byteLength(programmeText),sha256:hash(programmeText)}));
    if(!state.processProgrammeReceiving){state.processProgrammeReceiving={};await save();}
    const programmeReceiving=await receiveFlowableProgramme({
      client:sender,receiver,programmeInput,archivePath:join(directory,'complete-process-programme-workspace.ndjson'),
      state:state.processProgrammeReceiving,retain:async value=>{state.processProgrammeReceiving=value;await save();},signal});
    const completedProgramme=await sender.readProgramme({id:programmeReceiving.programme});
    need(programmeReceiving.steps===29&&completedProgramme.connectionId===processProgrammeConnection.id&&
      completedProgramme.progress.state==='COMPLETED'&&completedProgramme.progress.total===29&&
      completedProgramme.progress.confirmed===29&&completedProgramme.progress.rows.every(row=>row.state==='CONFIRMED')&&
      completedProgramme.programmeSha256===hash(programmeText)&&
      completedProgramme.basisSha256===programmeReceiving.basisSha256,
      'Every original programme operation must be confirmed on the same native process connection.');
    report.files.push(await checkedFile(programmeReceiving.download.path,programmeReceiving.download));
    report.processProgramme={...programmeReceiving,record:completedProgramme.record,
      sourceReference:programmeReferenceFile,connectionId:processProgrammeConnection.id,
      nativeRoles:{operator:configuration.adminUserId,reviewer:reviewerUserId},sources:completedProgramme.sources};
    mark('Complete original BPMN programme and independent receiving',report.processProgramme);


    // Commission the complete authored DMN course on the same installed native engine.
    const [{describeFlowableDecisionProgramme},{verifyFlowableDecisionProgrammeOperation}]=await Promise.all([
      load(SDK+'workspace/decision-programme.mjs'),load(SDK+'workspace/decision-programme-review.mjs')]);
    const decisionProgrammeReferencePath=join(sourceRoot,SDK+'workspace/examples/decision-commissioning.programme.json');
    const decisionProgrammeReferenceFile=await checkedFile(decisionProgrammeReferencePath);
    const decisionProgrammeReferenceBytes=await readFile(decisionProgrammeReferencePath);
    need(decisionProgrammeReferenceBytes.length===decisionProgrammeReferenceFile.bytes&&
      hash(decisionProgrammeReferenceBytes)===decisionProgrammeReferenceFile.sha256,
      'Read the same complete installed decision programme reference.');
    const decisionProgrammeReference=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decisionProgrammeReferenceBytes));
    need(decisionProgrammeReference.schema==='stellar-forge.flowable-programme.v1'&&
      decisionProgrammeReference.steps.length===14&&decisionProgrammeReference.sources.length===7,
      'Use all six original decision releases, eight typed evaluations and seven complete source members.');
    const decisionProgrammeMembers=Object.create(null);
    for(const member of decisionProgrammeReference.sources){
      need(typeof member.name==='string'&&!Object.hasOwn(decisionProgrammeMembers,member.name)&&
        /^(?:decision-catalog\.json|(?:grant-eligibility|vendor-review|onboarding-route)-v[12]\.dmn)$/.test(member.name),
        'Retain the original decision catalogue and all six authored DMN source editions.');
      const path=join(sourceRoot,SDK+'fixtures/decisions/'+member.name);
      await checkedFile(path,member);
      const bytes=await readFile(path);
      need(bytes.length===member.bytes&&hash(bytes)===member.sha256&&bytes.toString('base64')===member.contentBase64,
        'The installed original decision source differs from the complete programme: '+member.name);
      decisionProgrammeMembers[member.name]={...member,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
    }
    const decisionProgrammeConnection=senderStatus.connections.find(item=>item.connection.id===configuration.dmnConnection.id);
    need(decisionProgrammeConnection?.id===decisionConnectionId&&
      decisionProgrammeConnection.connection.baseUrl===configuration.dmnConnection.baseUrl,
      'The decision programme must use this original saved native DMN REST connection.');
    const decisionDescription=describeFlowableDecisionProgramme({
      catalogText:decisionProgrammeMembers['decision-catalog.json'].text,members:decisionProgrammeMembers,
      operation:'NATIVE-DECISION-PROGRAMME-'+hash(configuration.operation).slice(0,24),
      familyKeys:['d76c_grant_eligibility','d76c_vendor_review','d76c_onboarding_route']});
    const decisionProgramme=decisionDescription.programme;
    const decisionExpectations=new Map(decisionDescription.expectations.map(item=>[item.stepKey,item]));
    need(decisionProgramme.steps.length===14&&decisionProgramme.sources.length===7&&decisionExpectations.size===14&&
      decisionDescription.expectations.filter(item=>item.kind==='decisionRelease').length===6&&
      decisionDescription.expectations.filter(item=>item.kind==='decisionEvaluation').length===8,
      'Keep the complete three-family two-edition native decision course and every typed reference result.');
    const decisionProgrammeText=JSON.stringify(decisionProgramme,null,2)+'\n';
    const decisionProgrammeInput=await memo('decision-programme-input',{
      requestId:request('decision-programme'),connectionId:decisionConnectionId,
      referenceSha256:decisionProgrammeReferenceFile.sha256,programmeSha256:hash(decisionProgrammeText)},
      async()=>({requestId:request('decision-programme'),connectionId:decisionConnectionId,programmeText:decisionProgrammeText}));
    await publish('decision-commissioning.programme.json',decisionProgramme);
    await publish('decision-commissioning.expectations.json',decisionDescription.expectations);
    report.files.push(await checkedFile(join(directory,'decision-commissioning.programme.json'),
      {bytes:Buffer.byteLength(decisionProgrammeText),sha256:hash(decisionProgrammeText)}));
    report.files.push(await checkedFile(join(directory,'decision-commissioning.expectations.json')));
    if(!state.decisionProgrammeReceiving){state.decisionProgrammeReceiving={};await save();}
    if(!state.decisionProgrammeReviews){state.decisionProgrammeReviews={};await save();}
    const reviewDecisionProgramme=async({step,operation,phase})=>{
      const expectation=decisionExpectations.get(step.key);
      need(expectation&&step.kind===expectation.kind,'Review exactly the selected original DMN programme step.');
      const reviewed=await verifyFlowableDecisionProgrammeOperation({expectation,operation,phase,
        readSource:async reference=>(await sender.readSource({reference})).value});
      const key=phase+':'+operation.id+':'+operation.revision+':'+operation.sha256;
      if(Object.hasOwn(state.decisionProgrammeReviews,key))
        need(canonical(state.decisionProgrammeReviews[key])===canonical(reviewed),
          'The same original decision review must preserve its exact selected source and native response.');
      else{state.decisionProgrammeReviews[key]=reviewed;await save();}
    };
    const decisionProgrammeReceiving=await receiveFlowableProgramme({
      client:sender,receiver,programmeInput:decisionProgrammeInput,
      archivePath:join(directory,'complete-decision-programme-workspace.ndjson'),
      state:state.decisionProgrammeReceiving,
      retain:async value=>{state.decisionProgrammeReceiving=value;await save();},
      reviewOperation:reviewDecisionProgramme,signal});
    const completedDecisionProgramme=await sender.readProgramme({id:decisionProgrammeReceiving.programme});
    need(decisionProgrammeReceiving.steps===14&&completedDecisionProgramme.connectionId===decisionConnectionId&&
      completedDecisionProgramme.progress.state==='COMPLETED'&&completedDecisionProgramme.progress.total===14&&
      completedDecisionProgramme.progress.confirmed===14&&
      completedDecisionProgramme.progress.rows.every(row=>row.state==='CONFIRMED')&&
      completedDecisionProgramme.programmeSha256===hash(decisionProgrammeText)&&
      completedDecisionProgramme.basisSha256===decisionProgrammeReceiving.basisSha256,
      'Every original decision programme operation must be source-verified and confirmed on the same native engine.');
    report.files.push(await checkedFile(decisionProgrammeReceiving.download.path,decisionProgrammeReceiving.download));
    report.decisionProgramme={...decisionProgrammeReceiving,record:completedDecisionProgramme.record,
      sourceReference:decisionProgrammeReferenceFile,connectionId:decisionConnectionId,
      sources:completedDecisionProgramme.sources,reviews:Object.values(state.decisionProgrammeReviews)};
    mark('Complete original DMN programme and independent receiving',report.decisionProgramme);


    // Operate the actual source authoring desk before the final complete export.
    // The original browser generates its save request; retain it before forwarding unchanged.
    const {compileProgrammeDraft,parseProgrammeDraft,refreshProgrammeCatalogueSources}=await load(SDK+'workspace/programme-authoring.mjs');
    let authoredProgramme;
    {
      const imported=await import(pathToFileURL(configuration.playwrightModule).href);
      const playwright=imported.chromium?imported:imported.default;
      const browser=await playwright.chromium.launch({headless:true,executablePath:configuration.chromiumExecutable,
        args:['--no-sandbox','--disable-dev-shm-usage']});
      const browserErrors=[],authoringScreenshots=[],authoringExamples=[];
      let routedError,selectedPreview;
      try {
        const page=await browser.newPage({viewport:{width:1440,height:1000}});
        page.on('pageerror',error=>browserErrors.push(String(error)));
        const authoring=page.locator('#programme-authoring');
        const idle=async({error=false}={})=>{
          await page.locator('#busy').waitFor({state:'hidden'});
          if(routedError)throw routedError;
          const level=await page.locator('#notice').getAttribute('data-level');
          need(error?level==='error':level!=='error',
            error?'The original authoring validation must show its error.':'The original authoring action must finish without an error.');
        };
        const click=async name=>{await authoring.getByRole('button',{name,exact:true}).click();await idle();};
        async function screen(name){
          const path=join(directory,name+'.png');await page.screenshot({path,fullPage:true});
          const file=await checkedFile(path);report.files.push(file);authoringScreenshots.push(file);
          return file;
        }
        async function download(name,filename){
          const pending=page.waitForEvent('download',{timeout:180000});
          await click(name);const result=await pending,path=join(directory,filename);
          await result.saveAs(path);const file=await checkedFile(path);report.files.push(file);
          return {file,bytes:await readFile(path)};
        }
        async function enter(kind,connectionId){
          await page.locator('#engine-select').selectOption(connectionId);await idle();
          await page.locator('[data-page="programmes"]').click();await idle();
          need(await page.locator('#engine-select').inputValue()===connectionId,
            'Author on the matching original saved '+kind+' native connection.');
        }
        await page.goto(liveSession.browserUrl,{waitUntil:'networkidle'});await idle();
        await enter('process',processProgrammeConnection.id);
        await screen('authoring-empty-wide');
        await click('New source programme');
        await authoring.getByRole('button',{name:'Build complete programme preview',exact:true}).click();
        await idle({error:true});
        need((await page.locator('#notice').innerText()).length>0,'Show the complete source error to the operator.');
        await screen('authoring-source-error');

        for(const [kind,connectionId,steps,sources] of [
          ['process',processProgrammeConnection.id,29,10],['case',caseConnectionId,73,10],['decision',decisionConnectionId,14,7]]) {
          await enter(kind,connectionId);
          // Retain a real pending example fetch while capturing its visible loading controls.
          if(kind==='process'){
            let release;
            const gate=new Promise(resolve=>{release=resolve;});
            const route='**/programme-process.source-draft.json';
            const requestStarted=page.waitForRequest(route,{timeout:180000});
            const handler=async request=>{await gate;await request.continue();};
            await page.route(route,handler,{times:1});
            try{
              await authoring.getByRole('button',{name:'Load process example',exact:true}).click();
              await requestStarted;await page.locator('#busy').waitFor({state:'visible'});
              await screen('authoring-loading');
            } finally {release();}
            await idle();
          } else await click('Load '+kind+' example');
          const operation='UI-'+kind.toUpperCase()+'-'+hash(configuration.operation).slice(0,24);
          const title='Installed '+kind+' source authoring '+hash(configuration.operation).slice(0,12);
          await authoring.getByLabel('Draft title',{exact:true}).fill(title);
          await authoring.getByLabel('Stable operation key',{exact:true}).fill(operation);
          if(kind==='process'){
            await authoring.getByLabel('Operator identity',{exact:true}).fill(configuration.adminUserId);
            await authoring.getByLabel('Reviewer identity',{exact:true}).fill(reviewerUserId);
          }
          if(kind==='case'){
            await authoring.getByLabel('Reviewer identity',{exact:true}).fill('case-reviewer');
            await authoring.getByLabel('Specialist identity',{exact:true}).fill('case-specialist');
            await authoring.getByLabel('Approver identity',{exact:true}).fill('case-approver');
          }
          if(kind==='decision'){
            const row=authoring.locator('tbody tr').filter({hasText:'grant-eligibility-v1.dmn'});
            need(await row.count()===1,'Select the exact original decision model source.');
            await row.getByRole('button',{name:'Open source',exact:true}).click();await idle();
            const editor=authoring.getByLabel('Complete original source text',{exact:true});
            const original=await editor.inputValue();
            await editor.fill(original+'\n<!-- Installed source authoring review: '+operation+' -->\n');
            await click('Inspect source identity');
            const member=await download('Download source member','authoring-decision-edited-source.dmn');
            need(member.bytes.toString('utf8')===await editor.inputValue(),'Download every edited original source byte.');
            await authoring.getByRole('button',{name:'Build complete programme preview',exact:true}).click();
            await idle({error:true});
            await screen('authoring-decision-stale-catalogue');
            await click('Update catalogue model identities');
          }
          await click('Build complete programme preview');
          need((await authoring.innerText()).includes(steps+' native steps · '+sources+' complete sources'),
            'Render the complete original '+kind+' programme preview.');
          const compiled=await download('Download compiled programme','authoring-'+kind+'.programme.json');
          const draftDownload=await download('Download complete draft','authoring-'+kind+'.source-draft.json');
          const draft=parseProgrammeDraft(new TextDecoder('utf-8',{fatal:true}).decode(draftDownload.bytes));
          need(draft.kind===kind&&draft.operation===operation&&draft.files.length===sources,
            'Download the complete editable '+kind+' draft with its original source inventory.');
          const expected=await compileProgrammeDraft(draft,{hash:async bytes=>hash(bytes)});
          need(expected.programmeText===new TextDecoder('utf-8',{fatal:true}).decode(compiled.bytes)&&
            expected.programme.steps.length===steps&&expected.programme.sources.length===sources,
            'The actual browser download must equal the original complete source compiler.');
          if(kind==='decision'){
            const refreshed=await refreshProgrammeCatalogueSources(draft,{hash:async bytes=>hash(bytes)});
            need(canonical(refreshed)===canonical(draft),'The saved decision catalogue names every exact edited model byte.');
          }
          await screen('authoring-'+kind+'-wide');
          await page.setViewportSize({width:390,height:844});
          await authoring.scrollIntoViewIfNeeded();
          await screen('authoring-'+kind+'-narrow');
          await page.setViewportSize({width:1440,height:1000});

          // Reopen the complete received file, then the same local IndexedDB edition after reload.
          await authoring.getByLabel('Reopen complete source-draft JSON',{exact:true}).setInputFiles(draftDownload.file.path);
          await idle();
          await click('Build complete programme preview');
          const reopened=await download('Download complete draft','authoring-'+kind+'-reopened.source-draft.json');
          const reopenedDraft=parseProgrammeDraft(new TextDecoder('utf-8',{fatal:true}).decode(reopened.bytes));
          need(reopenedDraft.id!==draft.id&&canonical({...reopenedDraft,id:draft.id})===canonical(draft),
            'Received source drafts retain all source and roles under a distinct local draft identity.');
          const persistedTitle=title+' received';
          await authoring.getByLabel('Draft title',{exact:true}).fill(persistedTitle);
          await click('Build complete programme preview'); // flush the actual local source store before reload
          await page.reload({waitUntil:'networkidle'});await idle();await enter(kind,connectionId);
          const savedRow=authoring.locator('tbody tr').filter({hasText:persistedTitle});
          need(await savedRow.count()===1,'Find the actual saved local source edition after browser reload.');
          await savedRow.getByRole('button',{name:'Reopen draft',exact:true}).click();await idle();
          await click('Build complete programme preview');
          const persisted=await download('Download complete draft','authoring-'+kind+'-persisted.source-draft.json');
          const persistedDraft=parseProgrammeDraft(new TextDecoder('utf-8',{fatal:true}).decode(persisted.bytes));
          need(persistedDraft.id===reopenedDraft.id&&canonical({...persistedDraft,title:reopenedDraft.title})===canonical(reopenedDraft),
            'The browser reopens the same complete workspace-scoped IndexedDB draft.');
          const persistedPreview=await compileProgrammeDraft(persistedDraft,{hash:async bytes=>hash(bytes)});
          need(persistedPreview.programmeText===expected.programmeText,
            'Local draft labels and receiving identities must not change original native programme source.');
          authoringExamples.push({kind,connectionId,operation,steps,sources,programme:compiled.file,
            sourceDraft:draftDownload.file,reopened:reopened.file,persisted:persisted.file,
            programmeSha256:expected.sha256,localDraftId:persistedDraft.id});
          if(kind==='decision')selectedPreview=persistedPreview;
        }
        need(selectedPreview?.programme.steps.length===14,'Select the reviewed complete decision source for the one browser intake.');
        await memo('authoring-intake-identity',{connectionId:decisionConnectionId,
          programmeSha256:selectedPreview.sha256,operation:selectedPreview.programme.key},async()=>({selected:true}));
        if(state.authoringSaveInput){
          need(state.authoringSaveInput.connectionId===decisionConnectionId&&
            state.authoringSaveInput.programmeText===selectedPreview.programmeText,
            'Recover only the original browser-generated save request for these exact complete source bytes.');
          // A lost response reuses the actual retained browser UUID in the original server journal.
          authoredProgramme=await sender.saveProgramme(state.authoringSaveInput);
          await page.locator('#refresh').click();await idle();
        } else {
          await page.route('**/api/action',async route=>{
            let input;
            try{input=route.request().postDataJSON();}catch{return route.continue();}
            if(input?.method!=='saveProgramme')return route.continue();
            try {
              need(input.args.connectionId===decisionConnectionId&&input.args.programmeText===selectedPreview.programmeText&&
                /^[a-f0-9-]{36}$/.test(input.args.requestId??''),
                'Capture the original browser request only for the exact reviewed source programme.');
              need(!state.authoringSaveInput,'Only one original authoring save is admitted in this journey.');
              state.authoringSaveInput=input.args;await save();
              await route.continue();
            } catch(error){routedError=error;await route.abort();}
          });
          const response=page.waitForResponse(value=>{
            if(new URL(value.url()).pathname!=='/api/action')return false;
            try{return value.request().postDataJSON().method==='saveProgramme';}catch{return false;}
          },{timeout:180000});
          await authoring.getByRole('button',{name:'Save programme for native review',exact:true}).click();
          const actual=await response;need(actual.ok(),'The actual browser source intake must return its original saved programme.');
          authoredProgramme=await actual.json();await idle();
        }
        need(authoredProgramme.kind==='programme'&&authoredProgramme.value.connectionId===decisionConnectionId,
          'The authoring desk saves one original programme on its selected native decision connection.');
        const authored=await sender.readProgramme({id:authoredProgramme.id});
        need(authored.programmeSha256===selectedPreview.sha256&&authored.progress.total===14&&authored.progress.confirmed===0&&
          canonical(authored.programme)===canonical(selectedPreview.programme),
          'Retain the complete authored source for native review without dispatching a second decision course.');
        state.authoringSavedProgramme=ref(authoredProgramme);await save();
        const recordTable=page.locator('#programme-records');
        const previous=recordTable.getByRole('button',{name:'Previous',exact:true});
        while(await previous.count()&&await previous.isEnabled())await previous.click();
        let recordRow;
        for(;;){
          recordRow=recordTable.locator('tbody tr').filter({hasText:selectedPreview.programme.key});
          if(await recordRow.count())break;
          const next=recordTable.getByRole('button',{name:'Next',exact:true});
          need(await next.count()&&await next.isEnabled(),'Show the original saved authoring programme in the current workspace.');
          await next.click();
        }
        need(await recordRow.count()===1,'Select exactly the one original authored programme.');
        await recordRow.getByRole('button',{name:'Open programme',exact:true}).click();await idle();
        need((await page.locator('#programme-current').innerText()).includes(selectedPreview.programme.key),
          'Open the actual saved programme and its original review controls.');
        const fullDownload=page.waitForEvent('download');
        await page.locator('#programme-current').getByRole('link',{name:'Download complete programme',exact:true}).click();
        const delivered=await fullDownload,deliveredPath=join(directory,'authoring-saved-complete.programme.json');
        await delivered.saveAs(deliveredPath);
        const deliveredFile=await checkedFile(deliveredPath);
        need(hash(await readFile(deliveredPath))===authored.programmeSha256,'Saved source downloads preserve the complete authored programme.');
        report.files.push(deliveredFile);
        await screen('authoring-saved-programme-wide');
        await page.setViewportSize({width:390,height:844});await page.locator('#programme-current').scrollIntoViewIfNeeded();
        await screen('authoring-saved-programme-narrow');
        need(browserErrors.length===0,'The actual authoring browser produced a script error: '+browserErrors.join('\n'));
        report.authoring={examples:authoringExamples,record:authored.record,connectionId:decisionConnectionId,
          programmeSha256:authored.programmeSha256,basisSha256:authored.basisSha256,sources:authored.sources,
          requestId:state.authoringSaveInput.requestId,savedDownload:deliveredFile,screenshots:authoringScreenshots,
          rendered:true,visualReview:{state:'REQUIRES_PRODUCING_OWNER_INSPECTION',
            instruction:'Open these exact wide and narrow screenshots, inspect readability and overflow, and repair defects before calling the customer-facing product ready.'}};
        mark('Actual complete source authoring, downloads and browser reopen',report.authoring);
      } finally {await browser.close();}
    }

    const finalDecisionDelivery=await sender.exportWorkspace({requestId:request('export-complete-decision-continuation'),
      label:'Complete original process and decision operating history'});
    const finalDecisionExport=await mcp.tool('merchant_flowable_download',{workspace:'sender',kind:'delivery',id:finalDecisionDelivery.id});
    const finalDecisionReceived=await retainedFile(finalDecisionExport,join(directory,'complete-process-and-decision-workspace.ndjson'));
    need(finalDecisionReceived.file.sha256===finalDecisionDelivery.value.file.sha256 &&
      finalDecisionReceived.file.bytes===finalDecisionDelivery.value.file.bytes,
      'MCP receives every byte of the complete native process and decision continuation.');
    report.files.push(finalDecisionReceived.file);
    const finalInspection=await receiver.inspectDeliveryFile({requestId:request('receive-complete-decision-continuation'),
      path:finalDecisionReceived.file.path,label:'Complete native process and decision continuation',
      expectedSha256:finalDecisionReceived.file.sha256});
    const finalAdoptInput=await memo('complete-decision-adoption-input',{requestId:request('adopt-complete-decision-continuation'),
      id:finalInspection.id,manifestSha256:finalInspection.value.manifestSha256},async()=>({
        requestId:request('adopt-complete-decision-continuation'),id:finalInspection.id,
        expectedRevision:finalInspection.revision,manifestSha256:finalInspection.value.manifestSha256}));
    const finalDecisionAdopted=await receiver.adoptDelivery(finalAdoptInput);
    need(finalDecisionAdopted.value.state==='ADOPTED','Receive the complete native decision continuation with its original process history.');
    await receiver.close();receiver=undefined;await receiverOwner.close();receiverOwner=undefined;
    await openReceiver();
    const finalDecisionReopened=await receiver.adoptDelivery(finalAdoptInput);
    need(finalDecisionReopened.sha256===finalDecisionAdopted.sha256,
      'The complete process and decision receiving survives cold installed reopen.');
    mark('Native MCP decision evaluation and complete customer receiving',{evaluation:mcpDecisionResult,
      portfolio:ref(mcpDecisionPortfolio),history:remoteHistory.total,delivery:ref(finalDecisionDelivery),
      receiving:ref(finalDecisionReopened),file:finalDecisionReceived.file,records:await compareCore(sender,receiver),
      casePortfolio:completedInstalledCase.portfolio,caseInstanceId:completedInstalledCase.caseInstanceId});


    const coldProgramme=await receiver.readProgramme({id:programmeReceiving.programme});
    need(coldProgramme.record.sha256===completedProgramme.record.sha256&&
      coldProgramme.record.revision===completedProgramme.record.revision&&
      coldProgramme.progress.state==='COMPLETED'&&coldProgramme.progress.confirmed===29&&
      coldProgramme.programmeSha256===completedProgramme.programmeSha256&&
      coldProgramme.basisSha256===completedProgramme.basisSha256,
      'Cold final receiving preserves the full original programme and every selected native outcome.');
    report.processProgramme.coldReceiving={workspaceId:(await receiver.status()).workspaceId,
      record:coldProgramme.record,basisSha256:coldProgramme.basisSha256,steps:coldProgramme.progress.total};


    const coldDecisionProgramme=await receiver.readProgramme({id:decisionProgrammeReceiving.programme});
    need(coldDecisionProgramme.record.sha256===completedDecisionProgramme.record.sha256&&
      coldDecisionProgramme.record.revision===completedDecisionProgramme.record.revision&&
      coldDecisionProgramme.connectionId===decisionConnectionId&&
      coldDecisionProgramme.progress.state==='COMPLETED'&&coldDecisionProgramme.progress.total===14&&
      coldDecisionProgramme.progress.confirmed===14&&
      coldDecisionProgramme.programmeSha256===completedDecisionProgramme.programmeSha256&&
      coldDecisionProgramme.basisSha256===completedDecisionProgramme.basisSha256,
      'Cold final receiving preserves all original DMN source editions, typed inputs and fourteen confirmed outcomes.');
    const coldDecisionReviews=[];
    for(const row of coldDecisionProgramme.progress.rows){
      need(row.state==='CONFIRMED'&&row.record,'Each received decision step retains its original confirmed operation.');
      const operation=await receiver.getRecord({kind:row.kind,id:row.record.id,revision:row.record.revision});
      need(operation.sha256===row.record.sha256,'The received native decision operation must retain its exact revision.');
      coldDecisionReviews.push(await verifyFlowableDecisionProgrammeOperation({
        expectation:decisionExpectations.get(row.key),operation,phase:'confirmed',
        readSource:async reference=>(await receiver.readSource({reference})).value}));
    }
    report.decisionProgramme.coldReceiving={workspaceId:(await receiver.status()).workspaceId,
      record:coldDecisionProgramme.record,basisSha256:coldDecisionProgramme.basisSha256,
      steps:coldDecisionProgramme.progress.total,reviews:coldDecisionReviews};


    const coldAuthored=await receiver.readProgramme({id:authoredProgramme.id});
    need(coldAuthored.record.sha256===report.authoring.record.sha256&&
      coldAuthored.record.revision===report.authoring.record.revision&&
      coldAuthored.connectionId===report.authoring.connectionId&&
      coldAuthored.programmeSha256===report.authoring.programmeSha256&&
      coldAuthored.basisSha256===report.authoring.basisSha256&&
      canonical(coldAuthored.sources)===canonical(report.authoring.sources)&&
      coldAuthored.progress.total===14&&coldAuthored.progress.confirmed===0&&
      canonical(coldAuthored.programme)===canonical(JSON.parse(state.authoringSaveInput.programmeText)),
      'Cold customer receiving preserves the exact authored source, saved review programme and original connection.');
    report.authoring.coldReceiving={workspaceId:(await receiver.status()).workspaceId,
      record:coldAuthored.record,programmeSha256:coldAuthored.programmeSha256,
      sources:coldAuthored.sources,steps:coldAuthored.progress.total};

    report.completeWorkspace={delivery:ref(finalDecisionDelivery),receiving:ref(finalDecisionReopened),
      file:finalDecisionReceived.file,workspaceId:(await receiver.status()).workspaceId};
    need(CORE_KINDS.length===15 && CORE_KINDS.includes('programme') &&
      completedInstalledCase?.work?.historicCase?.state==='completed' && coldProgramme.progress.state==='COMPLETED' &&
      coldDecisionProgramme.progress.state==='COMPLETED',
      'The final complete customer receiving includes all fifteen process, decision, case and programme record kinds.');
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

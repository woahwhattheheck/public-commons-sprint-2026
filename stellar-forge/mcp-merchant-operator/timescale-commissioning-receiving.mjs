// MIT. Receive commissioning in the SAME completed Timescale merchant operation.
// This module borrows the existing owner. It never captures, refreshes, changes a
// job, republishes a dataset, creates credentials, or starts a browser/server.
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, link, unlink, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { COMMISSIONING_MANIFEST, COMMISSIONING_REPORT_BYTES, COMMISSIONING_MANIFEST_BYTES } from './timescale-commissioning-contract.mjs';
import { inspectTimescalePackage, receiveTimescaleWorkspace } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/package.mjs';
import { selectNativeTable, compareNativeTables } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/commissioning-tables.mjs';
import { projectionContract } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/contracts.mjs';
import { loadDatasetConfig } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-handler.mjs';
import { absolute, privateDirectory, acquireWorkspace, readPrivate, readJson, hashPrivate, bytes, digest, identity,
  createFile, atomicJson, syncDirectory, fault, stamp } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';

const SCHEMA='stellar-forge.timescale-commissioning-receiving.v1';
const INPUT='stellar-forge.timescale-commissioning-receiving-input.v1';
const REQUEST='stellar-forge.timescale-commissioning-receiving-request.v1';
const NATIVE_COMMIT='c2ff3fecf7749f484dee7edb0a9583871e8e17b6';
const REQUEST_BYTES=48*1024*1024, RECORD_BYTES=32*1024*1024, SOURCE_BYTES=6291456;
const SHA=/^[0-9a-f]{64}$/, COMMIT=/^[0-9a-f]{40}$/;
const ACTIVE=new Set(['RUNNING','DISPATCHING']);
const SECTIONS=['contract','sources','comparisons','observations','acceptance','history'];
const ORIGINALS=[
  ['capture-before','before','capture'],['capture-after','after','capture'],
  ['job-change','apply-job','job-change'],['refresh','second-refresh','refresh'],
  ['verification','second-verify','verification'],['projection','select','select-aggregate'],
  ['extraction','extract','extraction']
];
const CHECKS=['source_bound','catalog_changed','catalog_matches','customer_matches',
  'native_capture_complete','native_job_change_complete','native_refresh_complete',
  'native_verification_matches','native_publication_complete'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function need(value,code,message){if(!value)throw fault('TIMESCALE_COMMISSIONING_RECEIVING_'+code,message);}
function exact(value,allowed){
  need(object(value)&&Object.keys(value).every(key=>allowed.includes(key)),'INPUT_SHAPE','Use the declared complete receiving input.');
}
function label(value,name,max=8000){
  need(typeof value==='string'&&value.trim()&&value.length<=max&&!value.includes('\0'),'INPUT_TEXT','Provide '+name+'.');return value;
}
function utf8(value){
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value);}catch{throw fault('TIMESCALE_COMMISSIONING_RECEIVING_UTF8','Retain the complete original UTF-8 bytes.');}
  need(Buffer.from(text,'utf8').equals(value),'UTF8','The original UTF-8 byte identity must survive the request.');return text;
}
function json(value){try{return JSON.parse(utf8(value).replace(/^\uFEFF/,''));}catch(error){if(error.code)throw error;throw fault('TIMESCALE_COMMISSIONING_RECEIVING_JSON','Use the complete original JSON file.');}}
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function disjoint(left,right){return left!==right&&!left.startsWith(right+'/')&&!right.startsWith(left+'/');}
function pin(value){return{commissioningId:value.item.id,revision:value.item.revision,digest:value.digest};}
function samePin(a,b){return a?.commissioningId===b?.commissioningId&&a?.revision===b?.revision&&a?.digest===b?.digest;}
function mapping(names,keys=[]){
  return {columns:names.map(name=>({name,expected:name,observed:name,key:keys.includes(name)})),ignoredExpected:[],ignoredObserved:[]};
}
async function pages(read){
  let offset=0,total;const rows=[];
  do{
    const page=await read(offset);
    need(object(page)&&page.offset===offset&&Array.isArray(page.rows)&&Number.isSafeInteger(page.total)&&page.total>=0,'PAGE','The original page is incomplete.');
    if(total!==undefined)need(page.total===total,'PAGE_CHANGED','The original paged selection changed.');
    total=page.total;rows.push(...page.rows);
    const next=Object.hasOwn(page,'next')?page.next:page.nextOffset;
    need(next===null||Number.isSafeInteger(next)&&next>offset&&page.rows.length>0,'PAGE','Keep the original next offset.');
    offset=next;
  }while(offset!==null);
  need(rows.length===total,'PAGE_INCOMPLETE','Receive every original row.');return rows;
}
function completeCustomerPage(page){
  need(page?.schema==='stellar-forge.dataset-page.v1'&&Array.isArray(page.fields)&&page.fields.length>0&&
    new Set(page.fields).size===page.fields.length&&Array.isArray(page.rows)&&
    Number.isSafeInteger(page.page?.total)&&page.page.total===page.rows.length&&page.page.returned===page.rows.length&&
    page.page.nextCursor===null,'CUSTOMER_PAGE','Use the complete original customer page, with no remaining cursor.');
  need(object(page.filters)&&Object.keys(page.filters).length===0&&(!page.ranges||page.ranges.length===0),
    'CUSTOMER_FILTER','This receiving comparison uses the complete unfiltered original published page.');
  const rows=page.rows.map(row=>{
    need(object(row)&&identity(Object.keys(row).sort())===identity([...page.fields].sort()),'CUSTOMER_FIELDS','Retain every original published field.');
    return page.fields.map(name=>{
      const value=row[name];need(value===null||typeof value==='string','CUSTOMER_TEXT','Keep native values as strings or JSON null.');return value;
    });
  });
  return selectNativeTable({columns:page.fields,rows});
}
function publicInput(method,body){
  const input=structuredClone(body);delete input.expectedVersion;
  if(method==='commissioning-command'&&['create','import-table'].includes(input.action)){
    const key=input.action==='create'?'intake':'source',file=input[key];
    input[key]={filename:file.filename,tableName:file.tableName??null,bytes:Buffer.byteLength(file.content,'utf8'),
      sha256:digest(Buffer.from(file.content,'utf8'))};
  }
  return input;
}
function receivingConfiguration(facts,actor){
  const title='Receive the completed native Timescale demonstration';
  const intake={
    format:'stellar-forge.timescale-technical-receiving-intake.v1',title,
    meaning:'Technical receiving of the original completed native demonstration. These are not customer plant inputs or commercial acceptance.',
    source_contract:{
      original_operation:{description:'The actual completed native operation and retained result identity.',value:{id:facts.nativeOperationId,sha256:facts.nativeResultSha256}},
      source:{description:'The exact retained source edition, native target and aggregate definition.',value:{
        editionId:facts.selection.editionId,editionDigest:facts.selection.editionDigest,target:facts.projection.target,
        relation:facts.projection.relation,definitionDigest:facts.projection.definitionDigest}},
      window:{description:'The original native time window, including timezone and boundary interpretation.',value:facts.projection.window},
      columns:{description:'Every originally selected publication column, in its original order.',value:facts.selection.columns},
      technical_owner:{description:'Supplied attribution for this technical receiving assessment.',value:null}
    },
    acceptance:[
      {id:'source_and_window',check:'Retained source and original window',pass:'The source binding and complete retained editions match the original completed native operation.',evidence:'Original edition files, selected projection and capture outcome.'},
      {id:'catalog_change',check:'Complete native schedule comparison',pass:'The full before/after catalog retains the actual intended job change. An all-row mismatch is expected and remains visible.',evidence:'Complete jobs tables and the original completed job-change outcome.'},
      {id:'aggregate_verification',check:'Original native aggregate verification',pass:'The original native verification completed with matches=true for the exact selected source window.',evidence:'Original completed refresh and verification records; do not execute them again.'},
      {id:'published_rows',check:'Complete published customer rows',pass:'Every original published field and row matches the current retained snapshot as native strings or JSON null.',evidence:'Original completed customer page and the same published run read back through the merchant.'}
    ]
  };
  const contract=Object.fromEntries(Object.entries(intake.source_contract).map(([key,row])=>[key,{
    value:key==='technical_owner'?actor:row.value,disposition:'PROVIDED',
    reason:key==='technical_owner'?'The operator supplies this attribution for the technical receiving operation.':'Derived from the original completed native result and exact retained source.'
  }]));
  const adoption={schema:INPUT,nativeOperationId:facts.nativeOperationId,workspaceId:facts.workspaceId,
    sourceSelection:facts.selection,title,owner:actor,contract,
    criteria:[
      {id:'source_and_window',decision:'PASS',assessment:'The complete retained editions and original source/window binding match.',
        references:['jobs-before','jobs-after','capture-before','capture-after'],checks:['source_bound','native_capture_complete']},
      {id:'catalog_change',decision:'PASS',assessment:'The complete catalogs differ as expected: the original native operation changed the selected job. The full unmatched rows remain in the report.',
        references:['catalog-comparison','job-change'],checks:['catalog_changed','native_job_change_complete']},
      {id:'aggregate_verification',decision:'PASS',assessment:'The original completed native verifier reports an exact all-row match for the selected window. This receiver did not refresh or verify the database again.',
        references:['refresh','verification'],checks:['native_refresh_complete','native_verification_matches']},
      {id:'published_rows',decision:'PASS',assessment:'All '+facts.customerRows+' originally published rows and all selected fields match the same retained snapshot; decimal and other native text remain unchanged.',
        references:['customer-comparison','customer-baseline','customer-observed','extraction'],checks:['customer_matches','native_publication_complete']}
    ],
    handover:{disposition:'ACCEPTED',statement:'Accept this technical receiving of the original completed demonstration and its exact source, complete comparisons and native outcome records. This is not production commissioning or commercial acceptance.',followUpOwner:''}
  };
  return {intake,adoption};
}
function validateAdoption(intake,adoption,facts){
  exact(adoption,['schema','nativeOperationId','workspaceId','sourceSelection','title','owner','contract','criteria','handover']);
  need(adoption.schema===INPUT&&adoption.nativeOperationId===facts.nativeOperationId&&adoption.workspaceId===facts.workspaceId&&
    identity(adoption.sourceSelection)===identity(facts.selection),'ADOPTION_BINDING','Bind the supplied mapping to this exact completed native project and original selection.');
  label(adoption.title,'the project title',128);label(adoption.owner,'the technical owner',128);
  need(object(intake.source_contract)&&object(adoption.contract)&&identity(Object.keys(intake.source_contract).sort())===identity(Object.keys(adoption.contract).sort()),
    'CONTRACT_COMPLETE','Provide a disposition and value for every original intake field.');
  for(const row of Object.values(adoption.contract)){
    exact(row,['value','disposition','reason']);
    need(Object.hasOwn(row,'value')&&['PROVIDED','PENDING','NOT_APPLICABLE'].includes(row.disposition),'CONTRACT','Use the original source-contract dispositions.');
    need(typeof row.reason==='string'&&row.reason.length<=4000,'CONTRACT','Retain the field explanation.');
    if(row.disposition==='PROVIDED')need(row.value!==null,'CONTRACT','A provided field needs an actual value.');
    if(row.disposition==='NOT_APPLICABLE')label(row.reason,'the not-applicable explanation',4000);
  }
  need(Array.isArray(intake.acceptance)&&Array.isArray(adoption.criteria)&&
    new Set(adoption.criteria.map(row=>row.id)).size===adoption.criteria.length&&
    identity(intake.acceptance.map(row=>row.id).sort())===identity(adoption.criteria.map(row=>row.id).sort()),
    'CRITERIA_COMPLETE','Map every original acceptance criterion exactly once.');
  for(const row of adoption.criteria){
    exact(row,['id','decision','assessment','owner','references','checks']);
    need(['PASS','FAIL','DEFERRED','NOT_RUN','NOT_APPLICABLE'].includes(row.decision)&&
      Array.isArray(row.references)&&row.references.length<=64&&new Set(row.references).size===row.references.length&&
      Array.isArray(row.checks)&&row.checks.every(key=>CHECKS.includes(key))&&new Set(row.checks).size===row.checks.length,
      'CRITERION','Use the declared decisions and exact retained evidence aliases.');
    label(row.assessment,'the actual technical assessment');if(row.owner!==undefined)label(row.owner,'the acceptance owner',128);
    if(row.decision==='PASS')need(row.references.length>0&&row.checks.length>0,'PASS_EVIDENCE','A mapped Pass needs retained evidence and at least one actual receiving fact.');
  }
  exact(adoption.handover,['disposition','statement','followUpOwner']);
  need(['ACCEPTED','WITH_OPEN_ITEMS'].includes(adoption.handover.disposition)&&typeof adoption.handover.followUpOwner==='string','HANDOVER','Use the original handover disposition.');
  label(adoption.handover.statement,'the actual technical handover statement');
  if(adoption.handover.disposition==='WITH_OPEN_ITEMS')label(adoption.handover.followUpOwner,'the follow-up owner',128);
}

/**
 * Call from the original native/remediation receiving owner's existing lifetime.
 *
 * owner = {client, operator, publisher, workspaceDirectory, bindingSha256}.
 * restartOriginal(transition) closes/reopens THAT owner on its retained ports,
 * configuration and account, then returns the same owner shape with its new client.
 * withReceivedWorkspace(receipt, inspect) opens the original received model,
 * awaits inspect(model), and closes that model before returning.
 *
 * An optional intakeFile AND adoptionFile supply the complete explicit intake
 * and its completed-contract/criterion mapping. Neither is public source data.
 */
export async function runTimescaleCommissioningReceiving({
  owner,nativeResult,directory,sourceAdoption,intakeFile,adoptionFile,expectedInputFiles,
  restartOriginal,withReceivedWorkspace,actor='Native Timescale receiving engineer',onPhase
}={}){
  label(actor,'the receiving actor',128);
  need(typeof restartOriginal==='function'&&typeof withReceivedWorkspace==='function','OWNER_CALLBACKS',
    'Use the existing owner restart and original portable-model lifetime.');
  absolute(nativeResult,'native result path');absolute(directory,'receiving directory');
  exact(sourceAdoption,['nativeSourceCommit','commissioningSourceCommit']);
  const adopted={nativeSourceCommit:sourceAdoption.nativeSourceCommit??NATIVE_COMMIT,
    commissioningSourceCommit:sourceAdoption.commissioningSourceCommit};
  need(adopted.nativeSourceCommit===NATIVE_COMMIT&&COMMIT.test(adopted.commissioningSourceCommit??''),'SOURCE_ADOPTION',
    'Record the explicit subsequent source adoption after the original pinned native operation.');
  need((intakeFile===undefined)===(adoptionFile===undefined),'INPUT_PAIR','Supply both the exact intake file and complete adoption mapping, or use the derived technical intake.');
  if(intakeFile!==undefined){absolute(intakeFile,'intake file');absolute(adoptionFile,'adoption mapping');}
  const pinnedInputs=expectedInputFiles===undefined?null:structuredClone(expectedInputFiles);
  if(pinnedInputs!==null){
    need(intakeFile!==undefined,'INPUT_PAIR','Expected file identities require both supplied input files.');
    exact(pinnedInputs,['intake','adoption']);
    for(const value of [pinnedInputs.intake,pinnedInputs.adoption]){
      exact(value,['bytes','sha256']);
      need(Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=1048576&&SHA.test(value.sha256??''),
        'INPUT_FILE_PIN','Use the original supplied file byte count and SHA-256.');
    }
  }
  const nativeBytes=await readPrivate(nativeResult,16777216),native=json(nativeBytes);
  need(native.schema==='stellar-forge.timescale-native-demo.v1'&&native.complete===true,'NATIVE_COMPLETE',
    'The original native demonstration must be complete before this subsequent source adoption.');
  for(const name of ['before','after','apply-job','second-refresh','second-verify','select','extract','publish','reopen-and-original-customer'])
    need(native.phases?.[name]?.state==='COMPLETE','NATIVE_PHASE','The original '+name+' phase has not completed.');
  const workspaceDirectory=join(dirname(nativeResult),'workspace');
  const settings=await readJson(join(workspaceDirectory,'workspace.json'),16384),workspaceId=settings.id;
  const stateFile=join(settings.targetDirectory,'state.json');
  const stateBytes=await readPrivate(stateFile,262144),state=json(stateBytes),snapshot=native.phases.publish.result.snapshot;
  need(SHA.test(snapshot??'')&&state.current===snapshot,'ORIGINAL_SELECTION','Keep the original published dataset selection.');
  need(disjoint(directory,workspaceDirectory)&&disjoint(directory,settings.targetDirectory),'OUTPUT_LOCATION',
    'Use a separate private receiving directory, outside the original workspace and dataset.');
  await privateDirectory(directory,true);
  for(const name of ['inputs','requests','results'])await privateDirectory(join(directory,name),true);
  const sourceBytes=await readFile(fileURLToPath(import.meta.url)),receiverSourceSha256=digest(sourceBytes);
  const release=await acquireWorkspace(directory);
  let currentOwner=owner;
  const recordPath=join(directory,'receiving.json');
  let record;
  async function ownerState(){
    const selected=currentOwner,client=selected?.client;
    need(client&&typeof client.status==='function'&&client.commissioning&&client.exports&&
      typeof selected.operator?.call==='function'&&typeof selected.publisher==='string'&&
      selected.workspaceDirectory===workspaceDirectory&&SHA.test(selected.bindingSha256??''),
      'ORIGINAL_OWNER','Borrow the original configured merchant owner and typed Timescale client.');
    const result=await client.status();
    need(result.workspaceId===workspaceId&&client.workspaceId===workspaceId&&result.workspace===client.workspace&&
      typeof client.endpoint==='string'&&typeof result.instanceId==='string'&&typeof result.publisherInstanceId==='string',
      'OWNER_IDENTITY','The current owner must retain the original workspace identity.');
    return {workspace:client.workspace,workspaceId,endpoint:client.endpoint,publisher:selected.publisher,
      bindingSha256:selected.bindingSha256,instanceId:result.instanceId,publisherInstanceId:result.publisherInstanceId,
      version:result.native.version,editionCount:result.native.editions.total,active:result.native.active??null};
  }
  const client=()=>currentOwner.client;
  const save=()=>atomicJson(directory,'receiving.json',record);
  async function retain(relative,data){
    need(/^(?:inputs|requests|results)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(relative),'OUTPUT_NAME');
    const path=join(directory,relative),body=Buffer.isBuffer(data)?data:bytes(data);
    const temporary=join(dirname(path),'.commissioning-'+randomUUID());
    try{
      await createFile(temporary,body);
      try{await link(temporary,path);}catch(error){
        if(error.code!=='EEXIST')throw error;
        need((await readPrivate(path,Math.max(body.length,1))).equals(body),'RETAINED_FILE_CHANGED',
          'Keep the exact original receiving file: '+relative+'.');
      }
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    await syncDirectory(dirname(path));
    return {path,bytes:body.length,sha256:digest(body)};
  }
  async function verifyFile(file,maximum=RECORD_BYTES){
    const value=await readPrivate(file.path,maximum);
    need(value.length===file.bytes&&digest(value)===file.sha256,'RETAINED_FILE_CHANGED','A retained receiving file no longer matches.');return value;
  }
  async function phase(name,work){
    if(record.phases[name]?.state==='COMPLETE')return record.phases[name].result;
    record.phases[name]={...record.phases[name],state:'RUNNING',startedAt:record.phases[name]?.startedAt??stamp()};await save();
    try{
      const result=await work();
      record.phases[name]={...record.phases[name],state:'COMPLETE',completedAt:stamp(),result};await save();
      await onPhase?.({phase:name,state:'COMPLETE',record:recordPath});
      return result;
    }catch(error){
      // A progress callback or later observation failure cannot erase a saved completion.
      if(record.phases[name]?.state==='COMPLETE')throw error;
      record.phases[name]={...record.phases[name],state:'INTERRUPTED',error:{
        code:typeof error.code==='string'?error.code:'RECEIVING_INTERRUPTED',at:stamp()}};
      await save();throw error;
    }
  }
  async function detail(){return client().commissioning.item({commissioningId:record.commissioningId});}
  async function fullDetail(){
    const summary=await detail(),selected=pin(summary),sections={};
    for(const section of SECTIONS)sections[section]=await pages(async offset=>
      (await client().commissioning.item({...selected,section,offset,limit:100})).page);
    const contract=Object.fromEntries(sections.contract.map(({key,...value})=>[key,value]));
    const item={...summary.item,contract,...Object.fromEntries(['sources','comparisons','observations','acceptance'].map(key=>[key,sections[key]]))};
    need(identity(item)===summary.digest&&sections.history.length===summary.historyCount,'FULL_PROJECT',
      'The complete paged project must match its original revision digest.');
    return {workspaceId,version:summary.version,item,digest:summary.digest,history:sections.history};
  }
  async function preparedRequest(name,method,make){
    let saved=record.requests[name],request;
    const path=join(directory,'requests',name+'.json');
    if(saved)request=json(await verifyFile(saved,REQUEST_BYTES));
    else if(await exists(path)){
      const raw=await readPrivate(path,REQUEST_BYTES);request=json(raw);
      saved={path,bytes:raw.length,sha256:digest(raw)};
    }else{
      const body=await make(),status=await ownerState();
      need(!status.active,'OWNER_BUSY','The original owner has another active operation; continue after its actual outcome.');
      request={schema:REQUEST,receiverId:record.id,workspaceId,name,method,
        body:{...body,requestId:randomUUID(),expectedVersion:status.version}};
      saved=await retain('requests/'+name+'.json',request);
    }
    need(request.schema===REQUEST&&request.receiverId===record.id&&request.workspaceId===workspaceId&&
      request.name===name&&request.method===method&&object(request.body),'REQUEST_BINDING',
      'Continue the original exact request file.');
    record.requests[name]=saved;
    if(method==='commissioning-command'&&request.body.action==='create'){
      if(record.commissioningId)need(record.commissioningId===request.body.requestId,'PROJECT_BINDING');
      record.commissioningId=request.body.requestId;
    }
    await save();return request.body;
  }
  function checkOperation(method,body,operation){
    const kind={'commissioning-command':'commissioning','commissioning-report':'commissioning-report',export:'export'}[method];
    const expected=publicInput(method,body);
    need(operation.id===body.requestId&&operation.kind===kind&&identity(operation.input)===identity(expected),'OPERATION_BINDING',
      'The original operation must match the exact prepared request.');
    // The export owner alone supplies its private outputDirectory; its public
    // operation view intentionally omits that field. The native export inspector
    // verifies that binding against the same configured owner before download.
    if(method!=='export')need(operation.inputDigest===identity(expected),'REQUEST_DIGEST','The original request digest differs.');
    if(record.operationDigests[body.requestId])need(operation.inputDigest===record.operationDigests[body.requestId],'REQUEST_DIGEST');
    record.operationDigests[body.requestId]=operation.inputDigest;
  }
  async function observeOperation(name,operation){
    record.nativeOutcomes??={};
    const rows=record.nativeOutcomes[name]??=[];
    if(!rows.length||identity(rows.at(-1))!==identity(operation))rows.push(structuredClone(operation));
    record.nativeOutcomes[name]=rows;await save();
  }
  async function mutate(name,method,make){
    return phase(name,async()=>{
      const body=await preparedRequest(name,method,make);
      let operation;
      try{operation=await client().operation({action:'inspect',requestId:body.requestId});}
      catch(error){if(error.code!=='TIMESCALE_OPERATION_NOT_FOUND')throw error;}
      if(operation){
        checkOperation(method,body,operation);await observeOperation(name,operation);
        if(ACTIVE.has(operation.state))operation=await client().wait(body.requestId);
        checkOperation(method,body,operation);
        need(operation.state!=='OUTCOME_UNKNOWN','ORIGINAL_OUTCOME','Resolve the same original native outcome; do not replace this request.');
      }
      if(!operation||['FAILED','INTERRUPTED'].includes(operation.state)){
        const status=await ownerState();
        need(!status.active,'OWNER_BUSY','The original owner has another active operation.');
        // expectedVersion is the original engine's admission allowance, excluded
        // from request identity. The business revision and all other bytes stay.
        const attempt={...body,expectedVersion:status.version};
        const attemptNumber=(record.attempts[name]??0)+1;
        // Reserve the local attempt number before file publication. A failed local
        // write can leave a gap, but cannot overwrite or reuse a prior envelope.
        record.attempts[name]=attemptNumber;await save();
        await retain('requests/'+name+'-attempt-'+attemptNumber+'.json',{
          schema:REQUEST,receiverId:record.id,workspaceId,name,method,body:attempt,
          originalRequestSha256:record.requests[name].sha256,preparedAt:stamp()});
        const accepted=await client().call(method,attempt);
        need(accepted.id===body.requestId&&accepted.operation?.id===body.requestId,'ACCEPTED_REQUEST');
        operation=accepted.operation;checkOperation(method,body,operation);
        if(ACTIVE.has(operation.state))operation=await client().wait(body.requestId);
      }
      checkOperation(method,body,operation);await observeOperation(name,operation);
      need(operation.state==='COMPLETE','OPERATION_INCOMPLETE',
        'The same request is '+operation.state+'; preserve it and resolve its retained native error.');
      if(method==='commissioning-command'){
        const current=await detail(),expectedRevision=body.action==='create'?1:body.expectedRevision+1;
        need(current.item.revision===expectedRevision&&current.digest===operation.result?.digest,'PROJECT_CHANGED',
          'The request completed, but the current project differs. Open its original saved result before continuing.');
        record.head=pin(current);
      }
      return {id:operation.id,kind:operation.kind,state:operation.state,inputDigest:operation.inputDigest,result:operation.result};
    });
  }
  async function command(name,action,make){
    return mutate(name,'commissioning-command',async()=>{
      const body=await make();
      if(action==='create')return {...body,action,actor,note:body.note??'Receive the complete original technical intake.'};
      const current=await detail();
      need(samePin(pin(current),record.head),'PROJECT_CHANGED','The original project changed outside this retained receiving sequence.');
      return {...body,action,actor,note:body.note??'Retain this source-bound technical receiving step.',
        commissioningId:record.commissioningId,expectedRevision:current.item.revision};
    });
  }
  try{
    const initial=await ownerState();
    const inputIdentity={nativeResult,nativeResultSha256:digest(nativeBytes),nativeOperationId:native.id,workspaceId,
      workspace:initial.workspace,publisher:initial.publisher,endpoint:initial.endpoint,bindingSha256:initial.bindingSha256,
      workspaceDirectory,datasetStateSha256:digest(stateBytes),sourceAdoption:adopted,receiverSourceSha256,actor,
      intakeFile:intakeFile??null,adoptionFile:adoptionFile??null,expectedInputFiles:pinnedInputs};
    if(await exists(recordPath)){
      record=await readJson(recordPath,RECORD_BYTES);
      need(record.schema===SCHEMA&&identity(record.binding)===identity(inputIdentity),'BINDING_CHANGED',
        'Keep the original source, owner, input paths, actor and receiving operation.');
    }else{
      need(!initial.active,'OWNER_BUSY','Finish the original owner’s existing operation before commissioning receiving.');
      record={schema:SCHEMA,id:randomUUID(),createdAt:stamp(),binding:inputIdentity,
        requests:{},operationDigests:{},attempts:{},phases:{},head:null,commissioningId:null,
        receiveId:randomUUID(),complete:false};
      await retain('inputs/native-demo.json',nativeBytes);
      await atomicJson(directory,'receiving.json',record);
    }
    const facts=await phase('original-complete-source',async()=>{
      const before=native.phases.before.result,after=native.phases.after.result;
      const originals={};
      for(const [alias,name,kind] of ORIGINALS){
        const operation=await client().operation({action:'inspect',requestId:native.requestIds[name]});
        need(operation.kind===kind&&operation.state==='COMPLETE','NATIVE_OUTCOME','Use the original completed '+name+' operation.');
        originals[alias]=operation;
      }
      const selection=structuredClone(originals.projection.input.selection);
      need(selection?.editionId===after.editionId&&selection.editionDigest===after.digest,'SOURCE_SELECTION');
      const files={},documents={};
      for(const [name,declaration] of [['before',before],['after',after]]){
        const path=join(workspaceDirectory,'editions',declaration.editionId+'.json');
        const raw=await readPrivate(path,SOURCE_BYTES),value=json(raw);
        need(raw.length===declaration.bytes&&digest(raw)===declaration.digest&&value.id===declaration.editionId&&value.complete===true,
          'EDITION_CHANGED','Keep the complete original edition file.');
        const viaClient=await client().edition({editionId:declaration.editionId});
        need(viaClient.digest===declaration.digest&&viaClient.bytes===raw.length,'EDITION_BINDING');
        files[name]={...(await retain('inputs/edition-'+name+'.json',raw)),filename:basename(path),
          editionId:declaration.editionId};documents[name]=value;
      }
      const projection=projectionContract(documents.after,selection),plan=native.phases.select.result.plan;
      for(const key of ['editionId','editionDigest','aggregateKey','definitionDigest','relation','columns','window','target'])
        need(identity(projection[key])===identity(plan[key]),'PROJECTION_CHANGED','The source selection differs from the original native plan.');
      const beforeTable=selectNativeTable(documents.before,'jobs'),afterTable=selectNativeTable(documents.after,'jobs');
      need(identity([...beforeTable.names].sort())===identity([...afterTable.names].sort()),'CATALOG_COLUMNS',
        'Explicitly reconcile any changed catalog schema before using this receiving program.');
      const jobId=String(native.phases['native-source'].result.jobId),key=beforeTable.names.indexOf('job_id');
      need(key>=0,'JOB_ID');const left=beforeTable.rows.filter(row=>row[key]===jobId);
      const rightKey=afterTable.names.indexOf('job_id'),right=afterTable.rows.filter(row=>row[rightKey]===jobId);
      need(left.length===1&&right.length===1,'ORIGINAL_JOB','Retain the single original selected job identity.');
      const jobBefore=Object.fromEntries(beforeTable.names.map((name,i)=>[name,left[0][i]]));
      const jobAfter=Object.fromEntries(afterTable.names.map((name,i)=>[name,right[0][i]]));
      need(['scheduled','schedule_interval'].some(key=>jobBefore[key]!==jobAfter[key]),'REAL_CHANGE',
        'This complete receiving requires the actual before/after native job change.');
      const originalPage=native.customer?.completeCustomerPage??native.phases['reopen-and-original-customer'].result.completeCustomerPage;
      const baseline=completeCustomerPage(originalPage);
      const inspectionPath=join(directory,'inputs','publisher-inspection.json');
      const inspection=await exists(inspectionPath)?await readJson(inspectionPath,16777216):
        await currentOwner.operator.call('merchant_publisher_inspect',{publisher:initial.publisher,runId:native.phases.extract.result.runId,query:'limit=50'});
      need(inspection.run?.id===native.phases.extract.result.runId&&inspection.run.state==='PUBLISHED'&&
        inspection.run.data.publication.snapshot===snapshot,'PUBLICATION_CHANGED');
      const observed=completeCustomerPage(inspection.preview);
      const inspectionFile=await retain('inputs/publisher-inspection.json',inspection);
      need(identity([...baseline.names].sort())===identity([...observed.names].sort()),'CUSTOMER_COLUMNS');
      const customerMapping=mapping(baseline.names,baseline.names.filter(name=>['bucket','line'].includes(name)));
      need(compareNativeTables(baseline,observed,customerMapping).matches,'CUSTOMER_CHANGED','The original published customer rows differ.');
      const baselineDocument={columns:baseline.names,rows:baseline.rows,
        provenance:{kind:'derived-complete-native-customer-table',nativeOperationId:native.id,workspaceId,
          nativeResultSha256:digest(nativeBytes),snapshot,originalCompletePage:originalPage}};
      const observedDocument={columns:observed.names,rows:observed.rows,
        provenance:{kind:'derived-complete-retained-publisher-table',nativeOperationId:native.id,workspaceId,
          originalInspectionSha256:inspectionFile.sha256,snapshot,originalCompletePage:inspection.preview}};
      files.customerBaseline={...(await retain('inputs/customer-baseline.json',baselineDocument)),filename:'customer-baseline.json'};
      files.customerObserved={...(await retain('inputs/customer-observed.json',observedDocument)),filename:'customer-observed.json'};
      need(originals.verification.result.matches===true&&native.phases['second-verify'].result.matches===true&&
        originals.verification.input.planId===native.phases['prepare-second'].result.planId&&
        originals.verification.input.planDigest===native.phases['prepare-second'].result.digest,'NATIVE_VERIFICATION');
      return {workspaceId,nativeOperationId:native.id,nativeResultSha256:digest(nativeBytes),selection,projection,
        files,inspectionFile,originals,jobBefore,jobAfter,customerRows:baseline.rows.length,
        catalogMapping:mapping(beforeTable.names,['job_id']),customerMapping,
        originalSnapshot:snapshot,originalEditionCount:initial.editionCount};
    });

    const configuration=await phase('complete-intake-and-mapping',async()=>{
      let originalIntake,originalAdoption,intakeName,adoptionName;
      if(intakeFile!==undefined){
        originalIntake=await readPrivate(intakeFile,1048576);originalAdoption=await readPrivate(adoptionFile,1048576);
        intakeName=basename(intakeFile);adoptionName=basename(adoptionFile);
      }else{
        const derived=receivingConfiguration(facts,actor);
        originalIntake=bytes(derived.intake);originalAdoption=bytes(derived.adoption);
        intakeName='intake.json';adoptionName='adoption.json';
      }
      if(pinnedInputs)for(const [key,raw] of [['intake',originalIntake],['adoption',originalAdoption]])
        need(raw.length===pinnedInputs[key].bytes&&digest(raw)===pinnedInputs[key].sha256,'INPUT_FILE_CHANGED',
          'The supplied '+key+' file changed after the original caller retained its identity.');
      validateAdoption(json(originalIntake),json(originalAdoption),facts);
      const aliases=new Set(['jobs-before','jobs-after','customer-baseline','customer-observed','catalog-comparison','customer-comparison',
        ...ORIGINALS.map(row=>row[0])]);
      for(const criterion of json(originalAdoption).criteria)
        need(criterion.references.every(alias=>aliases.has(alias)),'EVIDENCE_ALIAS','Use an original receiving evidence alias.');
      return {mode:intakeFile?'explicit-retained-intake':'derived-technical-native-intake',
        intake:{...(await retain('inputs/intake.json',originalIntake)),filename:intakeName},
        adoption:{...(await retain('inputs/adoption.json',originalAdoption)),filename:adoptionName}};
    });
    const intakeBytes=await verifyFile(configuration.intake,1048576),adoptionBytes=await verifyFile(configuration.adoption,1048576);
    if(pinnedInputs)for(const [key,raw] of [['intake',intakeBytes],['adoption',adoptionBytes]])
      need(raw.length===pinnedInputs[key].bytes&&digest(raw)===pinnedInputs[key].sha256,'INPUT_FILE_CHANGED',
        'Keep the original caller-bound '+key+' bytes through retained-input reopening.');
    const intake=json(intakeBytes),adoption=json(adoptionBytes);
    validateAdoption(intake,adoption,facts);
    const imports=[
      {name:'jobs-before',file:facts.files.before,tableName:'jobs',role:'BASELINE',title:'Complete original job catalog before the native change'},
      {name:'jobs-after',file:facts.files.after,tableName:'jobs',role:'OBSERVED',title:'Complete original job catalog after the native change'},
      {name:'customer-baseline',file:facts.files.customerBaseline,tableName:null,role:'BASELINE',title:'Complete customer page retained by the original native operation'},
      {name:'customer-observed',file:facts.files.customerObserved,tableName:null,role:'OBSERVED',title:'Complete same-snapshot page read through the current merchant'}
    ];
    const tables={};
    for(const input of imports)tables[input.name]=selectNativeTable(json(await verifyFile(input.file,SOURCE_BYTES)),input.tableName);

    // A completed continuation reopens its frozen report/package instead of
    // appending another commissioning revision or restarting a current owner.
    if(record.complete){
      const report=await verifyReport(record.phases['report-inspection'].result);
      const downloaded=record.phases['complete-project-download'].result;
      await inspectTimescalePackage(downloaded.directory,downloaded.nativeManifestSha256);
      const receipt=await receiveTimescaleWorkspace({requestId:record.receiveId,packageDirectory:downloaded.directory,
        expectedDigest:downloaded.nativeManifestSha256,directory:join(directory,'customer-project')});
      const reopened=await reopenReceived(receipt,report);
      return {complete:true,reused:true,record:recordPath,workspaceId,commissioningId:record.commissioningId,
        report:record.phases['resumed-complete-report'].result,download:downloaded,receiving:receipt,reopened,
        sourceOperations:0,nativeDatabaseMutations:0,publisherPublications:0,browserOperations:0,borrowedOwnerRemainsOpen:true};
    }

    const created=await command('create-project','create',async()=>({
      intake:{filename:configuration.intake.filename,content:utf8(intakeBytes)},title:adoption.title,owner:adoption.owner,
      note:'Receive the complete '+configuration.mode+'; original intake SHA-256 '+configuration.intake.sha256+'.'
    }));
    need(created.id===record.commissioningId,'CREATE_ID');
    await command('edit-complete-contract','edit',async()=>({
      title:adoption.title,owner:adoption.owner,contract:adoption.contract,
      note:'Apply the complete supplied contract mapping '+configuration.adoption.filename+' SHA-256 '+configuration.adoption.sha256+'.'
    }));
    await command('bind-original-source','bind-source',async()=>({
      selection:adoption.sourceSelection,note:'Bind the original retained edition, native target, exact aggregate definition and full source window.'
    }));
    const evidence={};
    for(const input of imports){
      const saved=await command('import-'+input.name,'import-table',async()=>({
        source:{filename:input.file.filename,content:utf8(await verifyFile(input.file,SOURCE_BYTES)),tableName:input.tableName},
        role:input.role,title:input.title,note:'Retain the complete original file; no row filtering, coercion or truncation. SHA-256 '+input.file.sha256+'.'
      }));
      evidence[input.name]={kind:'source',id:saved.id};
    }
    const catalog=await command('compare-complete-catalog','compare',async()=>({
      expectedSourceId:evidence['jobs-before'].id,observedSourceId:evidence['jobs-after'].id,mapping:facts.catalogMapping,
      title:'Complete native catalog change',note:'Compare every native job row and every explicitly mapped column, preserving duplicate multiplicity and nulls.'
    }));
    evidence['catalog-comparison']={kind:'comparison',id:catalog.id};
    const customer=await command('compare-complete-customer','compare',async()=>({
      expectedSourceId:evidence['customer-baseline'].id,observedSourceId:evidence['customer-observed'].id,mapping:facts.customerMapping,
      title:'Complete published customer rows',note:'Compare all original published rows and fields in the same immutable snapshot as exact native text.'
    }));
    evidence['customer-comparison']={kind:'comparison',id:customer.id};
    for(const [alias,name,kind] of ORIGINALS){
      const observed=await command('observe-'+alias,'observe',async()=>{
        const current=await detail(),selected=pin(current);
        const operations=await pages(async offset=>(await client().commissioning.context({...selected,kind,offset,limit:100})).operations);
        const operation=operations.find(row=>row.id===native.requestIds[name]),original=facts.originals[alias];
        need(operation?.state==='COMPLETE'&&operation.kind===kind&&operation.inputDigest===original.inputDigest&&
          identity(operation.result)===identity(original.result)&&SHA.test(operation.operationDigest??''),'OBSERVATION_CHANGED',
          'Use the exact full original completed operation digest from the current context.');
        return {operationId:operation.id,operationDigest:operation.operationDigest,
          relevance:'Original completed '+name+' outcome for this source/window. This continuation records it without repeating the native action.',
          note:'Retain the actual original operation and native result bytes as commissioning evidence.'};
      });
      evidence[alias]={kind:'observation',id:observed.id};
    }
    const comparisonFacts=await phase('complete-table-and-comparison-readback',async()=>{
      const selected=await fullDetail();
      for(const input of imports){
        const sourceId=evidence[input.name].id,expected=tables[input.name];let descriptor,columns,file;
        const rows=await pages(async offset=>{
          const value=await client().commissioning.source({commissioningId:record.commissioningId,kind:'source',sourceId,offset,limit:100});
          if(descriptor)need(identity(value.descriptor)===identity(descriptor),'SOURCE_CHANGED');
          descriptor=value.descriptor;columns=value.columns;file=value.file;return value.rows;
        });
        need(file.name===input.file.filename&&file.bytes===input.file.bytes&&file.sha256===input.file.sha256&&
          identity(columns)===identity(expected.names)&&identity(rows)===identity(expected.rows),'SOURCE_ROWS',
          'The complete paged source must preserve all original strings, nulls and row multiplicities.');
      }
      const outcomes={};
      for(const [alias,expectedName,observedName,declared] of [
        ['catalog-comparison','jobs-before','jobs-after',facts.catalogMapping],
        ['customer-comparison','customer-baseline','customer-observed',facts.customerMapping]
      ]){
        let first;
        const expectedOnly=await pages(async offset=>{
          const value=await client().commissioning.comparison({commissioningId:record.commissioningId,comparisonId:evidence[alias].id,offset,limit:100});
          if(first)need(identity(value.descriptor)===identity(first.descriptor),'COMPARISON_CHANGED');else first=value;
          return value.expectedOnly;
        });
        const observedOnly=await pages(async offset=>{
          const value=await client().commissioning.comparison({commissioningId:record.commissioningId,comparisonId:evidence[alias].id,offset,limit:100});
          need(identity(value.descriptor)===identity(first.descriptor),'COMPARISON_CHANGED');return value.observedOnly;
        });
        const calculated=compareNativeTables(tables[expectedName],tables[observedName],declared);
        for(const key of ['mode','mapping','counts','matches'])need(identity(first[key])===identity(calculated[key]),'COMPARISON_RESULT');
        need(identity(expectedOnly)===identity(calculated.expectedOnly)&&identity(observedOnly)===identity(calculated.observedOnly),
          'COMPARISON_ROWS','The complete difference set must preserve every unmatched row and its multiplicity.');
        outcomes[alias]={id:evidence[alias].id,digest:first.descriptor.digest,matches:first.matches,counts:first.counts,
          completeDifferenceFile:await retain('results/'+alias+'.json',{...calculated,originalDescriptor:first.descriptor})};
      }
      need(!outcomes['catalog-comparison'].matches&&outcomes['customer-comparison'].matches,'REAL_MATCH_AND_CHANGE',
        'Keep both the actual native change and the complete same-snapshot match.');
      need(identity(selected.item.source?.selection)===identity(facts.selection)&&
        identity(selected.item.source?.projection)===identity(facts.projection),'SOURCE_BINDING');
      const intakeView=await client().commissioning.source({commissioningId:record.commissioningId,kind:'intake'});
      need(intakeView.file.name===configuration.intake.filename&&intakeView.file.bytes===configuration.intake.bytes&&
        intakeView.file.sha256===configuration.intake.sha256,'INTAKE_BYTES');
      return {outcomes,checks:{
        source_bound:true,catalog_changed:!outcomes['catalog-comparison'].matches,catalog_matches:outcomes['catalog-comparison'].matches,
        customer_matches:outcomes['customer-comparison'].matches,native_capture_complete:true,native_job_change_complete:true,
        native_refresh_complete:true,native_verification_matches:facts.originals.verification.result.matches===true,native_publication_complete:true
      }};
    });
    await phase('completed-create-request-recovery',async()=>{
      const before=await detail(),request=json(await verifyFile(record.requests['create-project'],REQUEST_BYTES));
      const replay=await client().commissioning.command({...request.body,expectedVersion:(await ownerState()).version});
      checkOperation('commissioning-command',request.body,replay.operation);
      const after=await detail();
      need(replay.reused===true&&replay.id===record.commissioningId&&samePin(pin(before),pin(after))&&
        replay.operation.result.digest===created.result.digest,'COMPLETED_REPLAY',
        'A completed original request must return its original result without appending another revision.');
      return {requestId:replay.id,reused:true,current:pin(after)};
    });
    await phase('explicit-acceptance-mapping',async()=>{
      const assessments=adoption.criteria.map(row=>{
        const references=row.references.map(alias=>{need(evidence[alias],'EVIDENCE_ALIAS');return evidence[alias];});
        const checks=Object.fromEntries(row.checks.map(name=>[name,comparisonFacts.checks[name]]));
        if(row.decision==='PASS')need(Object.values(checks).every(value=>value===true),'PASS_UNSUPPORTED',
          'The supplied Pass is not supported by this original completed native operation.');
        return {...row,owner:row.owner??adoption.owner,references,checks};
      });
      return {file:await retain('results/acceptance-mapping.json',{
        schema:'stellar-forge.timescale-commissioning-receiving-assessments.v1',workspaceId,commissioningId:record.commissioningId,
        originalMappingSha256:configuration.adoption.sha256,technicalFacts:comparisonFacts.checks,assessments})};
    });
    const assessmentDocument=json(await verifyFile(record.phases['explicit-acceptance-mapping'].result.file,RECORD_BYTES));
    for(const [index,row] of assessmentDocument.assessments.entries())
      await command('decide-'+String(index+1).padStart(4,'0'),'decide',async()=>({
        criterionId:row.id,decision:row.decision,assessment:row.assessment,owner:row.owner,references:row.references,
        note:'Apply this explicitly mapped technical assessment from the complete original intake; commercial acceptance remains separate.'
      }));
    await command('initial-technical-handover','complete',async()=>({
      ...adoption.handover,note:'Retain the complete current technical assessment and its actual source-bound disposition.'
    }));
    await phase('retained-handover-readback',async()=>{
      const value=await fullDetail();
      need(value.item.status==='HANDED_OVER'&&value.item.handover?.disposition===adoption.handover.disposition,'HANDOVER_RESULT');
      return {file:await retain('results/initial-handover.json',value),selected:pin(value)};
    });
    await command('reopen-original-handover','reopen',async()=>({
      note:'Reopen the same technical handover for complete source/report/portable receiving. Preserve all prior decisions and original handover history.'
    }));
    await command('final-technical-handover','complete',async()=>({
      ...adoption.handover,note:'Retain the reopened technical handover with the same explicit source evidence and decisions; the following receiver preserves its frozen report and whole workspace.'
    }));
    const finalProject=await phase('complete-project-history',async()=>{
      const value=await fullDetail();
      need(value.item.status==='HANDED_OVER'&&value.history.some(row=>row.action==='reopen')&&
        value.history.filter(row=>row.action==='complete').length===2&&samePin(pin(value),record.head),'PROJECT_HISTORY');
      const listing=await pages(async offset=>(await client().commissioning.list({q:record.commissioningId,offset,limit:100})).items);
      need(listing.some(row=>row.id===record.commissioningId&&row.digest===value.digest),'PROJECT_LIST');
      return {selected:pin(value),historyCount:value.history.length,file:await retain('results/project.json',value)};
    });
    const reportOperation=await mutate('retain-complete-report','commissioning-report',async()=>({
      commissioningId:record.commissioningId,expectedRevision:finalProject.selected.revision,expectedDigest:finalProject.selected.digest
    }));
    const inspected=await phase('report-inspection',async()=>{
      const result=await client().commissioning.inspectReport({exportId:reportOperation.id});
      need(result.manifest.commissioningId===record.commissioningId&&result.manifest.workspaceId===workspaceId&&
        result.manifest.revision===finalProject.selected.revision&&result.manifest.digest===finalProject.selected.digest&&
        result.manifest.files.length===2,'REPORT_BINDING');
      return result;
    });
    const reportOptions={exportId:reportOperation.id,directory:join(directory,'report'),
      expectedManifestSha256:inspected.manifestSha256,chunkSize:4096};
    await phase('pause-original-report-prefix',async()=>{
      // Bind the owner before the first report chunk. If the process ends after
      // the prefix but before the restart checkpoint, the next invocation can
      // recognize that the original owner already reopened instead of closing it again.
      if(!record.reportPauseOwner){record.reportPauseOwner=await ownerState();await save();}
      if(record.reportPrefix){await verifyFile(record.reportPrefix.checkpoint,262144);return record.reportPrefix;}
      const checkpointPath=join(reportOptions.directory,'download-state','checkpoint.json');
      if(await exists(checkpointPath)){
        const raw=await readPrivate(checkpointPath,262144),checkpoint=json(raw);
        need(checkpoint.exportId===reportOperation.id&&checkpoint.manifestSha256===inspected.manifestSha256,'PREFIX_BINDING');
        const partial=inspected.manifest.files.find(file=>{
          const value=checkpoint.files?.[file.name];return value?.complete===false&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<file.bytes;
        });
        if(partial){
          const saved=checkpoint.files[partial.name];need(SHA.test(saved.sha256??''),'PREFIX_BINDING');
          record.reportPrefix={state:'PAUSED',file:partial.name,bytes:saved.bytes,total:partial.bytes,prefixSha256:saved.sha256,
            manifestSha256:inspected.manifestSha256,at:stamp(),continuation:'recovered-original-retained-prefix',
            checkpoint:await retain('results/report-prefix-checkpoint.json',raw)};
          await save();return record.reportPrefix;
        }
      }
      const first=inspected.manifest.files[0];
      need(first.bytes>1,'REPORT_PREFIX','The complete report must permit an actual partial transfer.');
      const control=new AbortController(),chunkSize=Math.min(4096,Math.max(1,Math.floor(first.bytes/2)));
      try{
        await client().commissioning.downloadReport({...reportOptions,chunkSize,signal:control.signal,onProgress:async progress=>{
          if(record.reportPrefix)return;
          const checkpointPath=join(reportOptions.directory,'download-state','checkpoint.json');
          const raw=await readPrivate(checkpointPath,262144),checkpoint=json(raw),saved=checkpoint.files?.[progress.file];
          need(checkpoint.exportId===reportOperation.id&&checkpoint.manifestSha256===inspected.manifestSha256&&
            saved?.bytes===progress.bytes&&saved.bytes>0&&saved.bytes<progress.total&&saved.complete===false&&SHA.test(saved.sha256??''),
            'PREFIX_CHECKPOINT','Pause only after the original engine retained a complete verified prefix.');
          record.reportPrefix={state:'PAUSED',file:progress.file,bytes:progress.bytes,total:progress.total,
            prefixSha256:saved.sha256,manifestSha256:inspected.manifestSha256,at:stamp(),
            checkpoint:await retain('results/report-prefix-checkpoint.json',raw)};
          await save();control.abort(fault('TIMESCALE_COMMISSIONING_RECEIVING_REQUESTED_PAUSE'));
        }});
        throw fault('TIMESCALE_COMMISSIONING_RECEIVING_PAUSE_MISSING');
      }catch(error){
        if(!control.signal.aborted||error.code==='TIMESCALE_COMMISSIONING_RECEIVING_PAUSE_MISSING')throw error;
        need(record.reportPrefix?.bytes>0,'PREFIX_MISSING');return record.reportPrefix;
      }
    });
    await phase('restart-same-original-owner',async()=>{
      let transition=record.reportRestart;
      if(!transition){
        need(record.reportPauseOwner,'PAUSE_OWNER','Keep the original pre-transfer owner identity.');
        transition={id:randomUUID(),state:'PREPARED',before:record.reportPauseOwner,preparedAt:stamp(),
          reason:'Resume the same retained commissioning report after the original owner restarts.'};
        record.reportRestart=transition;await save();
      }
      let actual=await ownerState();
      const same=actual.instanceId===transition.before.instanceId&&actual.publisherInstanceId===transition.before.publisherInstanceId;
      if(same){
        need(!actual.active,'OWNER_BUSY','Finish the original owner’s active operation before its restart.');
        currentOwner=await restartOriginal(structuredClone(transition));
        actual=await ownerState();
      }
      for(const key of ['workspace','workspaceId','endpoint','publisher','bindingSha256'])
        need(actual[key]===transition.before[key],'RESTART_BINDING','Reopen the original owner on its retained endpoint/configuration.');
      need(!actual.active,'OWNER_BUSY','The reopened original owner has another active operation.');
      need(actual.instanceId!==transition.before.instanceId&&actual.publisherInstanceId!==transition.before.publisherInstanceId,
        'RESTART_NOT_OBSERVED','The original owner restart has not been observed.');
      const current=await detail(),again=await client().commissioning.inspectReport({exportId:reportOperation.id});
      need(samePin(pin(current),finalProject.selected)&&again.manifestSha256===inspected.manifestSha256,'REOPEN_CHANGED');
      record.reportRestart={...transition,state:'COMPLETE',after:actual,completedAt:stamp(),
        continuation:same?'original-owner-callback':'observed-already-reopened-original-owner'};
      await save();return record.reportRestart;
    });
    const reportDownload=await phase('resumed-complete-report',async()=>{
      const result=await client().commissioning.downloadReport(reportOptions);
      need(result.state==='COMPLETE'&&result.resumed===true&&result.resumedBytes>=record.reportPrefix.bytes&&result.files===2,
        'REPORT_RESUME','Complete the same original report directory from its retained verified prefix.');
      const report=await verifyReport(inspected);
      return {...result,historyCount:report.project.history.length};
    });
    const exported=await mutate('complete-project-export','export',async()=>({}));
    const inspectedPackage=await phase('complete-project-manifest',async()=>{
      const result=await client().exports.inspect({exportId:exported.id});
      need(result.manifest.workspaceId===workspaceId&&result.manifest.target?.stateDigest===record.binding.datasetStateSha256,
        'PACKAGE_SOURCE','The complete package must retain the original dataset selection.');
      const report=await verifyReport(inspected),references=new Map();
      const remember=reference=>{
        if(!reference)return;
        need(reference.file===reference.sha256+'.json'&&SHA.test(reference.sha256)&&Number.isSafeInteger(reference.bytes),'RECORD_REFERENCE');
        references.set(reference.file,reference);
      };
      for(const revision of report.revisions){
        remember(revision.item.intake.original);
        for(const key of ['sources','comparisons','observations'])for(const row of revision.item[key])remember(row.original);
      }
      for(const observation of report.observations)for(const native of observation.nativeRecords)remember(native.reference);
      for(const file of reportOperation.result.files??[])remember(file.original);
      need(Array.isArray(reportOperation.result.files)&&reportOperation.result.files.length===2,'REPORT_RECORDS');
      for(const reference of references.values()){
        const declared=result.manifest.files.find(file=>file.name==='workspace/records/'+reference.file);
        need(declared?.bytes===reference.bytes&&declared.sha256===reference.sha256,'PACKAGE_RECORD_MISSING',
          'Keep every original source, comparison, native observation and frozen report record.');
      }
      for(const file of [facts.files.before,facts.files.after]){
        const declared=result.manifest.files.find(row=>row.name==='workspace/editions/'+file.editionId+'.json');
        need(declared?.bytes===file.bytes&&declared.sha256===file.sha256,'PACKAGE_EDITION_MISSING');
      }
      return result;
    });
    const downloaded=await phase('complete-project-download',async()=>{
      const result=await client().exports.download({exportId:exported.id,directory:join(directory,'download'),
        expectedManifestSha256:inspectedPackage.manifestSha256,chunkSize:65536});
      need(result.state==='COMPLETE'&&result.files===inspectedPackage.manifest.files.length,'PACKAGE_DOWNLOAD');
      const selected=await inspectTimescalePackage(result.directory,result.nativeManifestSha256);
      need(selected.workspaceId===workspaceId&&selected.target?.stateDigest===record.binding.datasetStateSha256,'PACKAGE_IDENTITY');
      return {...result,nativeManifestSha256:selected.manifestDigest};
    });
    const receipt=await phase('portable-project-receive',()=>receiveTimescaleWorkspace({
      requestId:record.receiveId,packageDirectory:downloaded.directory,expectedDigest:downloaded.nativeManifestSha256,
      directory:join(directory,'customer-project')
    }));
    const reopened=await phase('portable-original-model-reopen',async()=>reopenReceived(receipt,await verifyReport(inspected)));
    await phase('original-project-preserved',async()=>{
      const current=await detail(),status=await ownerState();
      need(samePin(pin(current),finalProject.selected)&&status.editionCount===facts.originalEditionCount,'ORIGINAL_PROJECT_CHANGED');
      for(const [alias,name] of ORIGINALS){
        const original=await client().operation({action:'inspect',requestId:native.requestIds[name]});
        need(identity(original)===identity(facts.originals[alias]),'ORIGINAL_NATIVE_CHANGED',
          'Original completed native operation records must remain unchanged.');
      }
      need(digest(await readPrivate(nativeResult,16777216))===record.binding.nativeResultSha256&&
        digest(await readPrivate(stateFile,262144))===record.binding.datasetStateSha256&&
        digest(await readFile(fileURLToPath(import.meta.url)))===receiverSourceSha256,'ORIGINAL_BYTES_CHANGED');
      return {workspaceId,selected:pin(current),editionCount:status.editionCount,originalNativeRecordsUnchanged:true,
        originalDatasetStateUnchanged:true,sourceOperations:0,nativeDatabaseMutations:0,publisherPublications:0,browserOperations:0};
    });
    record.complete=true;record.completedAt=stamp();await save();
    return {complete:true,reused:false,record:recordPath,workspaceId,commissioningId:record.commissioningId,
      selected:finalProject.selected,report:reportDownload,download:downloaded,receiving:receipt,reopened,
      sourceOperations:0,nativeDatabaseMutations:0,publisherPublications:0,browserOperations:0,
      borrowedOwnerRemainsOpen:true,meaning:'Technical receiving; the original caller retains owner cleanup and commercial acceptance remains separate.'};

    async function verifyReport(inspectedReport){
      const manifestBytes=await readPrivate(join(directory,'report',COMMISSIONING_MANIFEST),COMMISSIONING_MANIFEST_BYTES);
      need(digest(manifestBytes)===inspectedReport.manifestSha256&&identity(json(manifestBytes))===identity(inspectedReport.manifest),'REPORT_MANIFEST');
      for(const file of inspectedReport.manifest.files){
        const actual=await hashPrivate(join(directory,'report',file.name),COMMISSIONING_REPORT_BYTES);
        need(actual.bytes===file.bytes&&actual.hash===file.sha256,'REPORT_FILE','Keep the frozen original JSON and HTML bytes.');
      }
      const report=await readJson(join(directory,'report','report.json'),COMMISSIONING_REPORT_BYTES);
      const selected=json(await verifyFile(record.phases['complete-project-history'].result.file,RECORD_BYTES));
      need(report.schema==='stellar-forge.timescale-commissioning-report.v1'&&report.complete===true&&report.workspaceId===workspaceId&&
        report.commissioningId===record.commissioningId&&report.digest===selected.digest&&identity(report.project.item)===selected.digest&&
        identity(report.project.history)===identity(selected.history)&&report.revisions.length===selected.history.length,'REPORT_HISTORY');
      let previous=null;
      for(const [index,revision] of report.revisions.entries()){
        need(revision.revision===index+1&&revision.item.revision===revision.revision&&identity(revision.item)===revision.digest&&
          revision.item.previousDigest===(previous?.digest??null)&&revision.requestId===selected.history[index].requestId&&
          revision.digest===selected.history[index].digest,'REPORT_CHAIN');previous=revision;
      }
      need(report.intake.filename===configuration.intake.filename&&typeof report.intake.content==='string'&&
        Buffer.from(report.intake.content,'utf8').equals(intakeBytes),'REPORT_INTAKE');
      need(report.sources.length===imports.length&&report.comparisons.length===2&&report.observations.length===ORIGINALS.length,'REPORT_COMPLETE');
      const sourceTables=new Map();
      for(const input of imports){
        const original=report.sources.find(row=>row.descriptor.sha256===input.file.sha256&&row.descriptor.role===input.role&&row.descriptor.filename===input.file.filename);
        need(original&&original.original.filename===input.file.filename&&typeof original.original.content==='string'&&
          Buffer.from(original.original.content,'utf8').equals(await verifyFile(input.file,SOURCE_BYTES)),'REPORT_SOURCE_BYTES');
        const table=selectNativeTable(json(Buffer.from(original.original.content,'utf8')),input.tableName);
        need(identity(table)===original.descriptor.tableDigest&&table.rows.length===original.descriptor.rows,'REPORT_SOURCE_ROWS');
        sourceTables.set(original.descriptor.id,table);
      }
      for(const comparison of report.comparisons){
        const value=comparison.result;
        need(identity(value)===comparison.descriptor.digest,'REPORT_COMPARISON_DIGEST');
        const expected=compareNativeTables(sourceTables.get(value.expectedSourceId),sourceTables.get(value.observedSourceId),value.mapping);
        for(const key of Object.keys(expected))need(identity(value[key])===identity(expected[key]),'REPORT_COMPLETE_DIFFERENCES');
      }
      for(const observation of report.observations){
        const value=observation.result.operation;
        need(identity(value)===observation.descriptor.operationDigest&&value.id===observation.descriptor.operationId&&value.state==='COMPLETE',
          'REPORT_ORIGINAL_OUTCOME');
        const original=Object.values(facts.originals).find(row=>row.id===value.id);
        need(original&&value.kind===original.kind&&value.input_digest===original.inputDigest,'REPORT_ORIGINAL_BINDING');
        for(const nativeRecord of observation.nativeRecords){
          const raw=bytes(nativeRecord.data);
          need(raw.length===nativeRecord.reference.bytes&&digest(raw)===nativeRecord.reference.sha256,'REPORT_NATIVE_BYTES');
        }
      }
      return report;
    }
    async function reopenReceived(receipt,report){
      need(receipt.complete===true&&receipt.workspaceId===workspaceId&&receipt.directory===join(directory,'customer-project','workspace'),
        'RECEIVE_IDENTITY');
      let inspections=0,observed;
      await withReceivedWorkspace(receipt,async model=>{
        inspections++;
        need(inspections===1&&model?.settings?.id===workspaceId&&model.directory===receipt.directory&&model.commissioning,
          'RECEIVED_OWNER','Open the original received model at the exact receipt directory.');
        const selected=model.commissioning.item(record.commissioningId);
        need(selected.digest===report.digest&&identity(selected.item)===identity(report.project.item)&&
          identity(selected.history)===identity(report.project.history),'RECEIVED_HISTORY');
        for(const original of [facts.files.before,facts.files.after]){
          const value=await model.edition(original.editionId);
          need(value.record.digest===original.sha256&&value.record.bytes===original.bytes,'RECEIVED_EDITION');
        }
        for(const original of Object.values(facts.originals)){
          const value=model.operation(original.id);
          need(value.kind===original.kind&&value.state==='COMPLETE'&&value.input_digest===original.inputDigest,'RECEIVED_NATIVE');
          const retained=report.observations.find(row=>row.descriptor.operationId===value.id);
          need(identity(value)===retained.descriptor.operationDigest,'RECEIVED_NATIVE_BYTES');
        }
        for(const format of ['json','html']){
          const file=await model.commissioning.reportFile(record.phases['retain-complete-report'].result.id,format);
          const declared=record.phases['report-inspection'].result.manifest.files.find(row=>row.name==='report.'+format);
          need(Buffer.byteLength(file.content,'utf8')===declared.bytes&&digest(Buffer.from(file.content,'utf8'))===declared.sha256,
            'RECEIVED_REPORT');
        }
        const source=await model.commissioning.intakeFile(record.commissioningId);
        need(Buffer.from(source.original.content,'utf8').equals(intakeBytes),'RECEIVED_INTAKE');
        for(const row of report.sources){
          const selectedSource=await model.commissioning.source(record.commissioningId,row.descriptor.id);
          need(identity(selectedSource.original)===identity(row.original)&&identity(selectedSource.descriptor)===identity(row.descriptor),
            'RECEIVED_COMPLETE_SOURCE');
        }
        for(const row of report.comparisons){
          const comparison=await model.commissioning.comparisonOriginal(record.commissioningId,row.descriptor.id);
          need(identity(comparison.record)===identity(row.result),'RECEIVED_COMPLETE_COMPARISON');
        }
        const dataset=await loadDatasetConfig(join(receipt.targetDirectory,'generations',snapshot,'dataset.json'));
        const page=dataset.handle({query:new URLSearchParams('limit=50')});
        need(page.status===200&&identity(completeCustomerPage(page.body))===identity(tables['customer-baseline']),'RECEIVED_CUSTOMER');
        need(model.status().editions.total===facts.originalEditionCount,'RECEIVED_EDITION_HISTORY');
        observed={workspaceId,commissioningId:record.commissioningId,revision:selected.item.revision,digest:selected.digest,
          historyCount:selected.history.length,originalEditionCount:model.status().editions.total,
          completeCustomerPage:page.body,originalSnapshot:snapshot,reportManifestSha256:record.phases['report-inspection'].result.manifestSha256,
          sourceOperations:0,nativeDatabaseMutations:0,publisherPublications:0};
        return observed;
      });
      need(inspections===1&&observed,'RECEIVED_READBACK','The original owner must complete and close the received-model inspection.');
      return observed;
    }
  }finally{
    // Only this small receiving ledger lock belongs to this module. The caller
    // closes its current original merchant owner in its existing finally block.
    await release();
  }
}

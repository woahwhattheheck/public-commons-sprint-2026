#!/usr/bin/env node
// MIT. Complete original directory receiving through the maintained Merchant host.
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {absolute,privateDirectory,readJSON,saveJSON,digest,operationLease,need,now}
  from '../../../distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {originalDirectoryReceiving} from '../operate_browser.mjs';
import {inspectHumanServicesDirectoryApplicationWorkspace} from '../application.mjs';
import {HumanServicesDirectoryConnection,readHumanServicesDirectoryConfiguration} from './connection.mjs';
import {readSourceFile,fileIdentity} from './files.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,WORKSPACE_SCHEMA,SHA,UUID,canonical} from './contracts.mjs';
import {humanServicesDirectoryActions} from './catalog.mjs';
import {initializeHumanServicesDirectoryMerchant} from './setup.mjs';
import {openHumanServicesDirectoryMerchantClient,readHumanServicesDirectoryValue,
  downloadHumanServicesDirectoryExport,inspectHumanServicesDirectoryExport,reopenHumanServicesDirectoryExport}
  from './client.mjs';

const SCHEMA='stellar-forge.human-services-directory-connected-receiving.v1';
const OPERATION='SCF-HUMAN-SERVICES-DIRECTORY-CONNECTED-450E-20261012';
const HERE=dirname(fileURLToPath(import.meta.url)),DIRECTORY=resolve(HERE,'..'),
  REPO=resolve(HERE,'../../../../..'),CLI=join(DIRECTORY,'cli.py'),options={};
for(let i=2;i<process.argv.length;i+=2){
  const flag=process.argv[i],value=process.argv[i+1];
  need(['--receiving','--out','--workspace','--source-files','--credentials-file'].includes(flag)&&
    value&&!value.startsWith('--')&&!Object.hasOwn(options,flag),
    'DIRECTORY_CONNECTED_ARGUMENTS','Use --receiving ABS/OPERATED_HUMAN_SERVICES_DIRECTORY.json --out PRIVATE_OUTPUT [--workspace RESTORED_ORIGINAL] [--source-files ORIGINAL_FILE_LOCATIONS_JSON].');
  options[flag]=absolute(value);
}
for(const key of ['--receiving','--out'])need(options[key],'DIRECTORY_CONNECTED_ARGUMENT_REQUIRED',key);
need(Number(process.versions.node.split('.')[0])>=22,'DIRECTORY_CONNECTED_NODE_REQUIRED','Use Node 22 or newer.');
const output=options['--out'];
await mkdir(output,{recursive:true,mode:0o700});await privateDirectory(output);
const nativeBytes=await readSourceFile(options['--receiving'],{maxBytes:64*1024*1024}),
  native=originalDirectoryReceiving(JSON.parse(nativeBytes.toString('utf8')));
const binding={receiving:options['--receiving'],receivingSha256:digest(nativeBytes),
  workspace:options['--workspace']??absolute(native.workspace),originalWorkspace:absolute(native.workspace),
  workspaceId:native.workspaceId,credentialsFile:options['--credentials-file']??null,
  sourceFiles:options['--source-files']??null};
const paths={original:binding.workspace,restored:join(output,'restored-workspace'),customer:join(output,'customer-workspace')};
const journalPath=join(output,'CONNECTED_JOURNEY.json'),owners=[];
let journal,lease,merchant,client,configuration,writes=Promise.resolve();
function same(left,right){return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));}
async function checkpoint(){
  writes=writes.then(async()=>{journal.updatedAt=now();await saveJSON(journalPath,journal,true);});
  return writes;
}
async function privateJSON(name,value){
  const file=join(output,name);await mkdir(dirname(file),{recursive:true,mode:0o700});
  await saveJSON(file,value,true);const raw=await readSourceFile(file,{privateFile:true,maxBytes:64*1024*1024});
  return {file,bytes:raw.length,sha256:digest(raw)};
}
async function checkedJSON(selected){
  const raw=await readSourceFile(selected.file,{privateFile:true,maxBytes:64*1024*1024});
  need(raw.length===selected.bytes&&digest(raw)===selected.sha256,'DIRECTORY_CONNECTED_RETAINED_FILE_CHANGED',selected.file);
  return JSON.parse(raw.toString('utf8'));
}
async function sourceIdentities(){
  const files={};
  async function walk(directory,prefix=''){
    for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(item.name.startsWith('.')||item.name==='__pycache__'||item.name==='node_modules')continue;
      const relative=prefix+item.name,path=join(directory,item.name);
      need(!item.isSymbolicLink(),'DIRECTORY_CONNECTED_SOURCE_LINK_CHANGED',relative);
      if(item.isDirectory())await walk(path,relative+'/');
      else if(/\.(?:mjs|mts|py|json|md|html|css)$/.test(item.name))
        files[relative]=await fileIdentity(path,{maxBytes:32*1024*1024});
    }
  }
  await walk(DIRECTORY);
  for(const relative of ['stellar-forge/mcp-merchant-operator/serve.mjs',
    'stellar-forge/mcp-merchant-operator/retained-download.mjs',
    'stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/connected/runtime.mjs',
    'stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_referral/connected/runtime.mjs'])
    files['repository/'+relative]=await fileIdentity(join(REPO,relative),{maxBytes:4*1024*1024});
  return files;
}
async function saveConfiguration(name,inputs={}){
  const file=join(output,name),value={schema:CONNECTION_SCHEMA,workspaces:{
    original:{directory:paths.original,label:'Original Human Services Directory',allowStart:true,
      ...(options['--credentials-file']?{credentialsFile:options['--credentials-file']}:{})},
    restored:{directory:paths.restored,label:'Received complete editable directory',allowStart:true},
    customer:{directory:paths.customer,label:'Received original directory referral handoff',allowStart:true}
  }};
  for(const [alias,selected]of Object.entries(inputs))value.workspaces[alias].inputs=selected;
  try{
    const current=JSON.parse((await readSourceFile(file,{privateFile:true,maxBytes:1024*1024})).toString('utf8'));
    need(same(current,value),'DIRECTORY_CONNECTED_CONFIGURATION_CHANGED');
  }catch(error){if(error.code!=='ENOENT')throw error;await saveJSON(file,value,true);}
  return file;
}
async function operatorIdentity(alias){
  const selected=JSON.parse((await readSourceFile(join(paths[alias],'directory','operator-connection.json'),
    {privateFile:true,maxBytes:65536})).toString('utf8'));
  need(selected.schema===OPERATOR_SCHEMA&&selected.active&&selected.workspace===paths[alias],
    'DIRECTORY_CONNECTED_ORIGINAL_OPERATOR_REQUIRED');
  const response=await fetch(new URL('/api/operator',selected.url),{redirect:'error',
    headers:{Authorization:'Bearer '+selected.accessToken},signal:AbortSignal.timeout(30000)});
  need(response.ok,'DIRECTORY_CONNECTED_OPERATOR_READ_FAILED');
  const identity=await response.json();
  need(identity.instanceId===selected.instanceId&&identity.workspaceId===selected.workspaceId&&
    identity.processId===selected.processId,'DIRECTORY_CONNECTED_OPERATOR_CHANGED');
  return identity;
}
function records(state){
  need(state?.workspaceId===native.workspaceId&&state.directory?.workspaceId===native.workspaceId&&
    state.referral?.workspaceId===native.workspaceId,'DIRECTORY_CONNECTED_WORKSPACE_CHANGED');
  const families={original:{},referral:{},directory:{}};
  for(const kind of ['connections','sources','builds','plans','editions','reviewSets','assessments',
    'decisions','corrections','editionComparisons','handoffs','receivings','artifacts'])
    if(Array.isArray(state[kind]))families.original[kind]=state[kind].map(row=>row.id).sort();
  for(const family of ['referral','directory'])
    for(const [kind,value]of Object.entries(state[family]))if(Array.isArray(value))
      families[family][kind]=value.map(row=>row.id).sort();
  for(const family of Object.values(families))for(const ids of Object.values(family))
    need(ids.every(id=>typeof id==='string'&&id)&&new Set(ids).size===ids.length,
      'DIRECTORY_CONNECTED_RECORD_IDENTITY_CHANGED');
  return {workspaceId:native.workspaceId,...families};
}
function retainRecords(expected,actual){
  need(expected.workspaceId===actual.workspaceId,'DIRECTORY_CONNECTED_WORKSPACE_CHANGED');
  for(const family of ['original','referral','directory'])for(const [kind,ids]of Object.entries(expected[family])){
    const present=new Set(actual[family][kind]??[]);
    need(ids.every(id=>present.has(id)),'DIRECTORY_CONNECTED_RECEIVED_RECORD_MISSING',family+'.'+kind);
  }
}
async function sourceInputs(){
  const selected=native.connectedInputs?.sourceImports;
  need(Array.isArray(selected)&&selected.length,'DIRECTORY_CONNECTED_ORIGINAL_INPUTS_REQUIRED');
  const overrides=options['--source-files']?JSON.parse((await readSourceFile(options['--source-files'],
    {maxBytes:1024*1024})).toString('utf8')):{};
  need(overrides&&typeof overrides==='object'&&!Array.isArray(overrides)&&
    Object.keys(overrides).every(key=>selected.some(row=>row.key===key)),
    'DIRECTORY_CONNECTED_ORIGINAL_FILE_SELECTION_CHANGED');
  const keys=new Set(),inputs={},bindings=[];
  for(let index=0;index<selected.length;index++){
    const row=selected[index],alias='source-'+String(index+1).padStart(3,'0');
    need(typeof row.key==='string'&&row.key&&!keys.has(row.key)&&new RegExp(SHA).test(row.sha256??'')&&
      new RegExp(SHA).test(row.sourceId??'')&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.profile,
      'DIRECTORY_CONNECTED_ORIGINAL_SOURCE_REQUIRED');keys.add(row.key);
    const file=absolute(overrides[row.key]??row.file),identity=await fileIdentity(file,{maxBytes:256*1024*1024});
    need(identity.sha256===row.sha256&&identity.bytes===row.bytes,'DIRECTORY_CONNECTED_SOURCE_BYTES_CHANGED',row.key);
    inputs[alias]={file,sha256:row.sha256,label:row.key};
    bindings.push({...row,file,alias});
  }
  if(journal.inputBindings)need(same(journal.inputBindings,bindings),'DIRECTORY_CONNECTED_SOURCE_SELECTION_CHANGED');
  journal.inputBindings=bindings;await checkpoint();return {original:inputs};
}
async function readPages(action,args,label){
  let offset=0,total=null,count=0;const saved=[],hash=createHash('sha256');
  for(;;){
    const {value}=await call(action,{...args,offset,limit:100},label+'-'+offset,{once:true});
    need(Array.isArray(value.rows)&&Number.isSafeInteger(value.total)&&value.total>=0&&value.offset===offset&&
      (total===null||value.total===total),'DIRECTORY_CONNECTED_PAGE_CHANGED',label);
    total=value.total;count+=value.rows.length;
    for(const row of value.rows)hash.update(JSON.stringify(canonical(row))+'\n');
    const request=journal.actions[label+'-'+offset];
    saved.push({offset,rows:value.rows.length,original:request.original});
    if(value.nextOffset===null){
      need(count===total,'DIRECTORY_CONNECTED_PAGE_INCOMPLETE',label);break;
    }
    need(value.rows.length>0&&value.nextOffset===offset+value.rows.length&&value.nextOffset<total,
      'DIRECTORY_CONNECTED_PAGE_CURSOR_CHANGED',label);
    offset=value.nextOffset;
  }
  const summary={action,arguments:args,total,rows:count,rowsSha256:hash.digest('hex'),pages:saved};
  journal.pages[label]=summary;await checkpoint();return summary;
}
async function completeRecordIds(workspace,state,label){
  const selected=records(state);
  for(const [kind,meta]of Object.entries(state.directory.collections??{})){
    const ids=selected.directory[kind]??[];
    need(Number.isSafeInteger(meta.total)&&meta.total>=ids.length,'DIRECTORY_CONNECTED_COLLECTION_CHANGED',kind);
    if(meta.total===ids.length)continue;
    const collection=kind==='acquisitions'?'operations':kind,
      pages=await readPages('directory_records',{workspace,collection},label+'-'+collection),complete=[];
    need(pages.total===meta.total,'DIRECTORY_CONNECTED_COLLECTION_CHANGED',kind);
    for(const page of pages.pages)for(const row of (await checkedJSON(page.original)).value.rows)complete.push(row.id);
    need(complete.every(id=>typeof id==='string'&&id)&&new Set(complete).size===meta.total,
      'DIRECTORY_CONNECTED_COMPLETE_RECORD_IDS_REQUIRED',kind);
    selected.directory[kind]=complete.sort();
  }
  return selected;
}
async function download(key,retained){
  const directory=join(output,'downloads',key);
  await mkdir(dirname(directory),{recursive:true,mode:0o700});await privateDirectory(dirname(directory));
  const selected={client,workspace:retained.workspace,exportId:retained.exportId,
    expectedManifestSha256:retained.manifestSha256,directory};
  const received=await downloadHumanServicesDirectoryExport(selected),
    inspected=await inspectHumanServicesDirectoryExport(selected),
    reopened=await reopenHumanServicesDirectoryExport(selected),files=[];
  for(const original of retained.files){
    const file=join(directory,original.name),actual=await fileIdentity(file,{maxBytes:576*1024*1024});
    need(actual.bytes===original.bytes&&actual.sha256===original.sha256,
      'DIRECTORY_CONNECTED_RECEIVED_FILE_CHANGED',original.name);
    files.push({file,...original});
  }
  journal.downloads[key]={received,inspected,reopened,files};await checkpoint();return journal.downloads[key];
}

async function initializeWorkspace(alias){
  const directory=paths[alias],marker=join(directory,'eltss','identity.json');
  try{return JSON.parse((await readSourceFile(marker,{privateFile:true,maxBytes:4096})).toString('utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  need(alias!=='original','DIRECTORY_CONNECTED_ORIGINAL_REQUIRED');
  const python=process.env.SF30_DIRECTORY_PYTHON??process.env.SF30_XML_PYTHON??
    process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
  const child=spawn(python,['-B',CLI,'init','--workspace',directory],{
    stdio:['ignore','pipe','pipe'],env:{...process.env,SF30_DIRECTORY_NODE:process.execPath,SF30_XML_NODE:process.execPath}});
  let stdout='',stderr='',overflow=false;
  child.stdout.on('data',bytes=>{stdout+=bytes.toString('utf8');if(Buffer.byteLength(stdout)>8*1024*1024){overflow=true;child.kill('SIGTERM');}});
  child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString('utf8')).slice(-65536);});
  const timer=setTimeout(()=>child.kill('SIGTERM'),60000);let exit;
  try{exit=await new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}
  finally{clearTimeout(timer);}
  const record=await privateJSON(alias+'-native-initialization.json',{exit,stdout,stderr,overflow});
  need(exit.code===0&&!overflow,'DIRECTORY_CONNECTED_NATIVE_INIT_FAILED',record.file);
  const result=JSON.parse((await readSourceFile(marker,{privateFile:true,maxBytes:4096})).toString('utf8'));
  need(result.schema===WORKSPACE_SCHEMA&&new RegExp(UUID).test(result.workspaceId??''),'DIRECTORY_CONNECTED_TARGET_IDENTITY');
  return result;
}

async function startMerchant(){
  const token=randomBytes(32).toString('base64url'),tokenEnv='DIRECTORY_CONNECTED_RECEIVING_MCP_CODE',
    environment={...process.env,[tokenEnv]:token};
  merchant=await startMerchantMcp({configPath:configuration,port:0,tokenEnv,environment});
  client=await openHumanServicesDirectoryMerchantClient({url:merchant.url,tokenEnv,environment});
  journal.merchantRuns.push({startedAt:now(),url:merchant.url,configuration});await checkpoint();
}

async function closeMerchant(){
  if(client){await client.close();client=null;}
  if(merchant){await merchant.close();merchant=null;journal.merchantRuns.at(-1).closedAt=now();await checkpoint();}
}

async function call(action,args={},label=action,{once=false}={}){
  let request=once?journal.actions[label]:null;
  if(request){
    need(request.action===action&&same(request.arguments,args),'DIRECTORY_CONNECTED_REQUEST_CHANGED',label);
    // JSON journal reloads duplicate object references. Rebind the original call
    // by its retained identity, keeping the same ordinal and every saved attempt.
    const matches=journal.calls.map((row,index)=>({row,index})).filter(({row})=>
      row.key===request.key&&row.action===request.action&&row.startedAt===request.startedAt&&
      same(row.arguments,request.arguments));
    need(matches.length===1,'DIRECTORY_CONNECTED_ORIGINAL_CALL_REQUIRED',label);
    const sequence=matches[0].index+1;
    need(request.sequence===undefined||request.sequence===sequence,
      'DIRECTORY_CONNECTED_CALL_SEQUENCE_CHANGED',label);
    request.sequence=sequence;journal.calls[sequence-1]=request;journal.actions[label]=request;
    await checkpoint();
    if(request.state==='COMPLETE')return checkedJSON(request.original);
    // Read the actual native state before replaying the exact original
    // content-addressed input, archive hash or retained receiving UUID.
    const current=await client.state({workspace:args.workspace});
    need(current.retention?.state==='COMPLETE'&&current.native?.ok,'DIRECTORY_CONNECTED_RECOVERY_READ_REQUIRED');
    request.reconciliation=current;await checkpoint();
  }else{
    request={sequence:journal.calls.length+1,key:label,action,arguments:args,startedAt:now(),state:'REQUESTED',attempts:[]};
    if(once)journal.actions[label]=request;
    journal.calls.push(request);await checkpoint();
  }
  const attempt={startedAt:now()};request.attempts.push(attempt);await checkpoint();
  try{
    const result=await client.call(action,args,{timeoutMs:600000});
    attempt.result=result;attempt.returnedAt=now();await checkpoint();
    need(result.state==='COMPLETED'&&result.retention?.state==='COMPLETE'&&result.native?.ok,
      'DIRECTORY_CONNECTED_NATIVE_ACTION_FAILED',action+' returned '+JSON.stringify(result));
    const value=await readHumanServicesDirectoryValue({client,result});
    request.original=await privateJSON('call-'+String(request.sequence).padStart(4,'0')+'.json',{result,value});
    request.state='COMPLETE';await checkpoint();return {result,value};
  }catch(error){
    request.state='INTERRUPTED';attempt.error={code:error.code??null,message:error.message};
    await checkpoint();throw error;
  }
}

async function retainedExport(key,action,args){
  if(journal.exports[key]){
    const original=journal.exportAttempts?.[key];
    need(original&&original.action===action&&same(original.arguments,args),'DIRECTORY_CONNECTED_EXPORT_REQUEST_CHANGED',key);
    const retained=journal.exports[key],info=await client.manifest({workspace:retained.workspace,exportId:retained.exportId});
    need(info.manifestFile?.sha256===retained.manifestSha256,'DIRECTORY_CONNECTED_EXPORT_CHANGED',key);return retained;
  }
  journal.exportAttempts??={};
  let request=journal.exportAttempts[key];
  if(request)need(request.action===action&&same(request.arguments,args),
    'DIRECTORY_CONNECTED_EXPORT_REQUEST_CHANGED',key);
  else request=journal.exportAttempts[key]={key,action,arguments:args,startedAt:now(),attempts:[]};
  const attempt={startedAt:now()};request.state='REQUESTED';request.attempts.push(attempt);
  await checkpoint();
  try{
    const retained=await client.call(action,args,{timeoutMs:600000});
    // Preserve the complete original response before deciding whether its file
    // is usable. A native error or a failed file retention remains inspectable.
    attempt.result=retained;attempt.returnedAt=now();await checkpoint();
    need(retained.state==='COMPLETED'&&retained.retention?.state==='COMPLETE'&&retained.native?.ok,
      'DIRECTORY_CONNECTED_COMPLETE_EXPORT_REQUIRED',key+' '+JSON.stringify({
        state:retained.state,native:retained.native,retention:retained.retention,
        exportId:retained.exportId,manifestSha256:retained.manifestSha256}));
    request.state='COMPLETE';journal.exports[key]=retained;await checkpoint();return retained;
  }catch(error){
    request.state='INTERRUPTED';attempt.error={code:error.code??null,message:error.message};
    await checkpoint();throw error;
  }
}

async function main(){
  lease=await operationLease(join(output,'receiving.lock'));
  const current=await readJSON(journalPath,true),sourceFiles=await sourceIdentities();
  if(current){
    need(current.schema===SCHEMA&&same(current.binding,binding),'DIRECTORY_CONNECTED_ORIGINAL_JOURNEY_REQUIRED');
    journal=current;
    if(journal.completedAt){
      const result=await checkedJSON(journal.result);
      need(result.workspaceId===native.workspaceId,'DIRECTORY_CONNECTED_COMPLETED_RESULT_CHANGED');
      process.stdout.write(JSON.stringify({state:'complete',reopened:true,result:journal.result,workspaceId:native.workspaceId})+'\n');
      return;
    }
    if(!same(journal.sourceFiles,sourceFiles)){
      journal.sourceFiles=sourceFiles;journal.sourceEditions.push({at:now(),files:sourceFiles});
    }
  }else journal={schema:SCHEMA,operation:OPERATION,binding,startedAt:now(),sourceFiles,
    sourceEditions:[{at:now(),files:sourceFiles}],calls:[],actions:{},exports:{},downloads:{},
    pages:{},merchantRuns:[],operatorRuns:[],failures:[]};
  await checkpoint();
  await inspectHumanServicesDirectoryApplicationWorkspace(paths.original,native.workspaceId);
  for(const alias of ['restored','customer'])await initializeWorkspace(alias);
  const bootstrap=await saveConfiguration('native-operator-bindings.json'),
    selected=await readHumanServicesDirectoryConfiguration(bootstrap);
  need(selected.workspaces.original.workspaceId===native.workspaceId,'DIRECTORY_CONNECTED_ORIGINAL_WORKSPACE_CHANGED');
  for(const [alias,binding]of Object.entries(selected.workspaces)){
    const owner=new HumanServicesDirectoryConnection(binding);owners.push(owner);
    const opened=await owner.open();journal.operatorRuns.push({alias,at:now(),...opened});await checkpoint();
  }
  const beforeOperator=await operatorIdentity('original'),inputs=await sourceInputs(),
    connection=await saveConfiguration('directory-connections.json',inputs);
  const setup=await initializeHumanServicesDirectoryMerchant({directory:join(output,'merchant'),connection,
    name:'Human Services Directory complete receiving'});
  configuration=setup.configuration;journal.setup=setup;await checkpoint();
  await startMerchant();
  const catalogue=await client.schema(),expected=Object.values(humanServicesDirectoryActions).map(row=>row.name).sort();
  need(Array.isArray(catalogue.tools)&&same(catalogue.tools.map(row=>row.name).sort(),expected),
    'DIRECTORY_CONNECTED_COMPLETE_CATALOGUE_REQUIRED');
  journal.catalogue=await privateJSON('CONNECTED_CATALOGUE.json',catalogue);
  const before=(await call('directory_state',{workspace:'original'},'original-before',{once:true})).value;
  journal.originalRecordIds??=await completeRecordIds('original',before,'original-before-complete-records');await checkpoint();
  await call('directory_catalogue',{workspace:'original'},'original-native-catalogue',{once:true});
  await call('directory_guidance',{workspace:'original'},'complete-original-mapping-guidance',{once:true});

  // Metadata and content use the original two native import requests. The
  // immutable profile ID remains in this journal before any source bytes move.
  journal.importedSources??=[];
  for(const row of journal.inputBindings){
    const profile=await call('directory_import_profile_save',{workspace:'original',profile:row.profile},
      'source-profile-'+row.alias,{once:true});
    need(new RegExp(SHA).test(profile.value.id??''),'DIRECTORY_CONNECTED_SAVED_IMPORT_PROFILE_REQUIRED');
    const imported=await call('directory_source_import',{workspace:'original',input:row.alias,
      importProfileId:profile.value.id,expectedSha256:row.sha256},'source-content-'+row.alias,{once:true});
    need(imported.value.id===row.sourceId,'DIRECTORY_CONNECTED_ORIGINAL_SOURCE_ID_CHANGED',row.key);
    if(!journal.importedSources.some(item=>item.key===row.key))
      journal.importedSources.push({key:row.key,importProfileId:profile.value.id,sourceId:row.sourceId,
        profileExport:profile.result,sourceExport:imported.result});
    await checkpoint();
  }

  const acceptedInputs=native.connectedInputs?.replayInputs??[];
  const domainActions=new Set(['directory_mapping_save','directory_mapping_preview','directory_mapping_apply',
    'directory_selection_save','directory_referral_join','directory_handoff_prepare',
    'directory_receiving_save','directory_export_prepare']);
  const inputKeys=new Set();
  journal.operatedInputs??=[];
  for(const selected of acceptedInputs){
    need(typeof selected.key==='string'&&selected.key&&!inputKeys.has(selected.key)&&
      domainActions.has(selected.action)&&selected.args&&typeof selected.args==='object'&&!Array.isArray(selected.args)&&
      (selected.args.workspace===undefined||selected.args.workspace==='original'),
      'DIRECTORY_CONNECTED_ACCEPTED_NATIVE_INPUT_REQUIRED');
    inputKeys.add(selected.key);
    const result=await call(selected.action,{...selected.args,workspace:'original'},
      'accepted-native-input-'+selected.key,{once:true});
    if(selected.expectedRecordId!==undefined)
      need(result.value.id===selected.expectedRecordId,'DIRECTORY_CONNECTED_NATIVE_RECORD_CHANGED',selected.key);
    if(!journal.operatedInputs.some(row=>row.key===selected.key))
      journal.operatedInputs.push({key:selected.key,action:selected.action,recordId:result.value.id??null,exportId:result.result.exportId});
    await checkpoint();
  }
  const operated=(await call('directory_state',{workspace:'original'},'original-operated',{once:true})).value;
  retainRecords(journal.originalRecordIds,await completeRecordIds('original',operated,'original-operated-complete-records'));
  const directory=operated.directory,completeIds={};
  for(const collection of ['connections','discoveries','requests','importProfiles','sources','editions','comparisons',
    'operations','mappings','mappingPreviews','sourceConversions','selections','referralJoins','handoffs',
    'exports','receivingReviews','receives'])
  {
    const pageGroup=await readPages('directory_records',{workspace:'original',collection},'collection-'+collection),ids=[];
    for(const page of pageGroup.pages)for(const row of (await checkedJSON(page.original)).value.rows)ids.push(row.id);
    need(new Set(ids).size===pageGroup.total,'DIRECTORY_CONNECTED_COMPLETE_COLLECTION_CHANGED',collection);
    completeIds[collection==='operations'?'acquisitions':collection]=ids;
  }

  for(const row of completeIds.sources.map(id=>({id}))){
    const index=await retainedExport('source-index-'+row.id,'directory_index_file',
      {workspace:'original',collection:'sources',recordId:row.id});
    await download('source-index-'+row.id,index);
    const source=await retainedExport('source-input-'+row.id,'directory_source_file',
      {workspace:'original',sourceId:row.id});
    await download('source-input-'+row.id,source);
    await call('directory_source_members',{workspace:'original',sourceId:row.id},'source-members-'+row.id,{once:true});
    const pages=await readPages('directory_source_rows',{workspace:'original',sourceId:row.id},'source-rows-'+row.id);
    if(pages.rows){
      const first=(await checkedJSON(pages.pages[0].original)).value.rows[0],
        recordId=first.ref?.recordId??first.recordId;
      need(new RegExp(SHA).test(recordId??''),'DIRECTORY_CONNECTED_ORIGINAL_RECORD_REFERENCE_REQUIRED');
      const complete=await retainedExport('source-record-'+row.id+'-'+recordId,'directory_source_record_file',
        {workspace:'original',sourceId:row.id,recordId});
      await download('source-record-'+row.id+'-'+recordId,complete);
    }
  }
  for(const row of completeIds.editions.map(id=>({id}))){
    const index=await retainedExport('edition-index-'+row.id,'directory_index_file',
      {workspace:'original',collection:'editions',recordId:row.id});
    await download('edition-index-'+row.id,index);
    await readPages('directory_edition_rows',{workspace:'original',editionId:row.id},'edition-rows-'+row.id);
    const links=await readPages('directory_edition_links',{workspace:'original',editionId:row.id},'edition-links-'+row.id);
    for(const page of links.pages)for(const link of (await checkedJSON(page.original)).value.rows){
      if(!link.candidatesTruncated)continue;
      const linkId=link.linkId??link.id;
      need(new RegExp(SHA).test(linkId??'')&&new RegExp(SHA).test(link.sourceId??''),
        'DIRECTORY_CONNECTED_ORIGINAL_LINK_REFERENCE_REQUIRED');
      await readPages('directory_link_targets',{workspace:'original',editionId:row.id,sourceId:link.sourceId,linkId},
        'edition-link-targets-'+row.id+'-'+link.sourceId+'-'+linkId);
    }
  }
  for(const row of completeIds.comparisons.map(id=>({id}))){
    const index=await retainedExport('comparison-index-'+row.id,'directory_index_file',
      {workspace:'original',collection:'comparisons',recordId:row.id});
    await download('comparison-index-'+row.id,index);
    const changes=await retainedExport('comparison-changes-'+row.id,'directory_comparison_changes_file',
      {workspace:'original',comparisonId:row.id});
    await download('comparison-changes-'+row.id,changes);
    await readPages('directory_comparison_changes',{workspace:'original',comparisonId:row.id},'comparison-rows-'+row.id);
  }
  for(const row of completeIds.mappingPreviews.map(id=>({id})))for(const group of ['resources','fields','findings'])
    await readPages('directory_mapping_preview_details',{workspace:'original',mappingPreviewId:row.id,group},
      'mapping-preview-'+row.id+'-'+group);
  for(const row of completeIds.selections.map(id=>({id})))
    await readPages('directory_selection_candidates',{workspace:'original',selectionId:row.id},'selection-candidates-'+row.id);
  const acquisitions=(completeIds.acquisitions??[]).map(id=>({id}));
  for(const row of acquisitions){
    const operationId=row.id??row.operationId;
    const value=(await call('directory_operation',{workspace:'original',operationId},
      'original-acquisition-'+operationId,{once:true})).value;
    if(value.pages?.length){
      const capture=await retainedExport('acquisition-capture-'+operationId,'directory_capture_file',
        {workspace:'original',operationId});
      await download('acquisition-capture-'+operationId,capture);
    }
  }
  need(completeIds.handoffs.length>0,'DIRECTORY_CONNECTED_COMPLETE_HANDOFF_REQUIRED');
  const handoffId=native.handoffIds?.at(-1)??completeIds.handoffs.at(-1);
  const handoff=await retainedExport('complete-handoff','directory_handoff_file',{workspace:'original',handoffId});
  await download('complete-handoff',handoff);
  journal.handoffReceiving=await call('receive_export',{workspace:'customer',sourceWorkspace:'original',
    exportId:handoff.exportId,expectedManifestSha256:handoff.manifestSha256,kind:'directory-handoff'},
    'receive-complete-directory-handoff',{once:true});
  const customer=(await call('directory_state',{workspace:'customer'},'customer-complete-state',{once:true})).value;
  records(customer);
  need(customer.directory.handoffs.some(row=>row.id===handoffId),'DIRECTORY_CONNECTED_RECEIVED_HANDOFF_MISSING');
  const originalHandoff=(await call('directory_record',{workspace:'original',collection:'handoffs',recordId:handoffId},
    'complete-original-handoff-record',{once:true})).value;
  const handoffInput=originalHandoff.input??originalHandoff;
  for(const [field,collection]of [['selectionId','selections'],['conversionId','sourceConversions'],['referralJoinId','referralJoins']])
    if(handoffInput[field])need(customer.directory[collection].some(row=>row.id===handoffInput[field]),
      'DIRECTORY_CONNECTED_HANDOFF_RECORD_MISSING',collection);

  const beforeArchive=(await call('directory_state',{workspace:'original'},'original-before-workspace-file',{once:true})).value,
    expectedRecords=await completeRecordIds('original',beforeArchive,'original-archive-complete-records');
  const editable=await retainedExport('complete-editable-workspace','directory_workspace_packet',{workspace:'original'}),
    complete=await download('complete-editable-workspace',editable);
  journal.workspacePacket=complete.files.find(row=>row.name===editable.source.payloadFile);
  need(journal.workspacePacket?.file,'DIRECTORY_CONNECTED_COMPLETE_WORKSPACE_FILE_REQUIRED');
  journal.workspaceReceiving=await call('receive_export',{workspace:'restored',sourceWorkspace:'original',
    exportId:editable.exportId,expectedManifestSha256:editable.manifestSha256,kind:'workspace'},
    'receive-complete-original-workspace',{once:true});
  const restored=(await call('directory_state',{workspace:'restored'},'restored-complete-state',{once:true})).value;
  retainRecords(expectedRecords,await completeRecordIds('restored',restored,'received-complete-records'));
  const receive=restored.directory.receives.find(row=>row.workspaceId===native.workspaceId&&
    row.archiveSha256===journal.workspacePacket.sha256&&row.state==='complete');
  need(receive,'DIRECTORY_CONNECTED_COMPLETE_RECEIVING_MISSING');
  journal.completeReceiving=await privateJSON('COMPLETE_RECEIVED_STATES.json',{original:beforeArchive,restored,customer});
  await checkpoint();

  await closeMerchant();
  need((await operatorIdentity('original')).instanceId===beforeOperator.instanceId,
    'DIRECTORY_CONNECTED_ORIGINAL_OPERATOR_CHANGED');
  await startMerchant();
  const reopened=(await call('directory_state',{workspace:'original'},'original-after-merchant-reopen')).value;
  retainRecords(expectedRecords,await completeRecordIds('original',reopened,'reopened-original-complete-records'));
  need((await operatorIdentity('original')).instanceId===beforeOperator.instanceId,
    'DIRECTORY_CONNECTED_ORIGINAL_OPERATOR_RESTARTED');
  const receivedAgain=(await call('directory_state',{workspace:'restored'},'received-after-merchant-reopen')).value;
  retainRecords(expectedRecords,await completeRecordIds('restored',receivedAgain,'reopened-received-complete-records'));
  for(const [key,exported]of Object.entries(journal.exports)){
    const selection={client,workspace:exported.workspace,exportId:exported.exportId,
      expectedManifestSha256:exported.manifestSha256,directory:join(output,'downloads',key)};
    journal.downloads[key].afterMerchantReopen={manifest:await inspectHumanServicesDirectoryExport(selection),
      local:await reopenHumanServicesDirectoryExport(selection)};
  }
  await closeMerchant();
  journal.operatorClosures=[];
  for(const owner of owners)journal.operatorClosures.push(await owner.release());
  await checkpoint();
  const result={schema:SCHEMA,operation:OPERATION,completedAt:now(),nativeReceiving:binding,
    workspace:paths.original,workspaceId:native.workspaceId,configuration,sourceFiles:journal.sourceFiles,
    sourceEditions:journal.sourceEditions,originalOperator:beforeOperator,originalRecordIds:journal.originalRecordIds,
    finalRecordIds:expectedRecords,importedSources:journal.importedSources,operatedInputs:journal.operatedInputs,
    catalogue:journal.catalogue,pages:journal.pages,exports:journal.exports,downloads:journal.downloads,
    handoffReceiving:journal.handoffReceiving,workspaceReceiving:journal.workspaceReceiving,
    completeReceiving:journal.completeReceiving,workspacePacket:journal.workspacePacket,
    originalReopened:await privateJSON('ORIGINAL_REOPENED.json',reopened),
    receivedReopened:await privateJSON('RECEIVED_REOPENED.json',receivedAgain),
    merchantRuns:journal.merchantRuns,operatorRuns:journal.operatorRuns,operatorClosures:journal.operatorClosures,
    journey:journalPath};
  journal.result=await privateJSON('OPERATED_CONNECTED_HUMAN_SERVICES_DIRECTORY.json',result);
  journal.completedAt=result.completedAt;await checkpoint();
  process.stdout.write(JSON.stringify({state:'complete',operation:OPERATION,result:journal.result,
    workspaceId:native.workspaceId,completeDownloads:Object.keys(journal.downloads).length,
    completePageGroups:Object.keys(journal.pages).length,delivery:journal.workspacePacket})+'\n');
}
try{await main();}
catch(error){
  if(journal){journal.failures.push({at:now(),code:error.code??null,message:error.message});await checkpoint().catch(()=>{});}
  throw error;
}finally{
  await closeMerchant().catch(()=>{});
  for(const owner of owners.reverse())await owner.close().catch(()=>{});
  if(lease)await lease.close();
}

// SPDX-License-Identifier: MIT
// Host admission of an existing finalized room through the ORIGINAL Python receiver.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need,InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {canonical} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-page.mjs';
import {initializationDirectory as directory,initializationBytes as bytes,
 optionalInitializationBytes as optionalBytes,retainInitializationRecord as retainRecord}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {datasetFileTypes,datasetDeliveryNames,bindDatasetFiles} from './native-dataset-meaning.mjs';

const SCHEMA='stellar-forge.mcp-native-received-dataset.v1';
const HASH=/^[a-f0-9]{64}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const bridge=fileURLToPath(new URL('../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/native-dataset-receive.py',import.meta.url));
const parse=raw=>{
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
 catch{throw new InputError('MCP_DATASET_RECEIVING_JSON_INVALID');}
};

function originalReceive(python,room,session){
 return new Promise((accept,reject)=>{
  const args=['-I','-B',bridge,'--node',process.execPath,'--room',room];
  if(session!==undefined&&session!==null)args.push('--session',session);
  const child=spawn(python,args,{shell:false,env:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC'},
   stdio:['ignore','pipe','pipe']});
  const chunks=[];let size=0,stderr='',failure=null,kill;
  const stop=code=>{if(failure)return;failure=code;child.kill('SIGTERM');kill=setTimeout(()=>child.kill('SIGKILL'),1000);};
  const timeout=setTimeout(()=>stop('MCP_DATASET_RECEIVING_TIMEOUT'),360000);
  child.stdout.on('data',part=>{size+=part.length;if(size>16*1024*1024)stop('MCP_DATASET_RECEIVING_OUTPUT_LIMIT');else chunks.push(part);});
  child.stderr.on('data',part=>{stderr=(stderr+part.toString('utf8')).slice(-8192);});
  child.once('error',()=>{failure='MCP_DATASET_RECEIVING_START_FAILED';});
  child.once('close',code=>{
   clearTimeout(timeout);clearTimeout(kill);
   if(failure||code!==0){
    let original;
    try{original=JSON.parse(stderr).error;}catch{}
    reject(new InputError(failure||(/^[A-Z0-9_]{1,120}$/.test(original??'')?original:'MCP_DATASET_RECEIVING_FAILED')));
    return;
   }
   try{accept(parse(Buffer.concat(chunks,size)));}catch(error){reject(error);}
  });
 });
}

async function verifiedReceipt(receipt,acquisitionId,readSavedFile,readArchive=readSavedFile){
 need(receipt?.schema==='stellar-forge.finalized-dataset-receiving.v1'&&
  ['SF88_SESSION','SF100_SCAN'].includes(receipt.sourceFormat)&&
  HASH.test(receipt.sourceBindingSha256??'')&&HASH.test(receipt.manifestSha256??''),
  'MCP_DATASET_RECEIVING_IDENTITY_CHANGED');
 const {room,native}=receipt;await directory(room);await directory(join(room,'pages'));
 need(object(native)&&native.directory===room&&native.sourceBindingSha256===receipt.sourceBindingSha256&&
  native.nativeStatus?.complete===true&&native.nativeStatus.finalized===true&&
  Number.isInteger(native.nativeStatus.pages)&&native.nativeStatus.pages>0&&native.nativeStatus.pages<=4096,
  'MCP_DATASET_RECEIVING_NATIVE_CHANGED');
 const isDirect=receipt.sourceFormat==='SF100_SCAN';
 need(native.schema===(isDirect?'stellar-forge.sf100.dataset-delivery.v1':'stellar-forge.sf88.dataset-delivery.v1'),
  'MCP_DATASET_RECEIVING_NATIVE_CHANGED');
 if(isDirect)need(receipt.session===null&&native.sourceFormat==='SF100_SCAN'&&
  native.originalNativeScan?.out===room,'MCP_DATASET_RECEIVING_SOURCE_FORMAT_CHANGED');
 else{
  await directory(receipt.session);
  need(native.sourceDirectory===receipt.session&&native.resumed===true&&native.appendedPages===0&&
   typeof receipt.sessionId==='string'&&HASH.test(receipt.configurationSha256??''),
   'MCP_DATASET_RECEIVING_SOURCE_FORMAT_CHANGED');
 }
 const raw=await bytes(join(room,'manifest.json'),4*1024*1024),manifest=parse(raw);
 need(sha(raw)===receipt.manifestSha256&&manifest.schema==='stellar-forge.buyer-delivery-manifest.v1'&&
  manifest.dataset?.rows===native.nativeStatus.rows&&manifest.dataset.snapshot===native.nativeStatus.snapshot&&
  manifest.chainDigest===native.nativeStatus.lastRecordDigest&&same(manifest.paymentStatus,native.paymentStatus)&&
  Array.isArray(receipt.columns)&&same(receipt.columns.map(column=>column.name),manifest.dataset.projectedFields),
  'MCP_DATASET_RECEIVING_MANIFEST_CHANGED');
 const names=datasetDeliveryNames(manifest),files={};
 need(same(Object.keys(native.outputs??{}).sort(),names.slice().sort()),'MCP_DATASET_RECEIVING_FILES_CHANGED');
 for(const name of names){
  const file=native.outputs[name];
  need(file?.path===join(room,name),'MCP_DATASET_RECEIVING_PATH_CHANGED');
  files[name]={destination:file.path,contentType:datasetFileTypes[name],sha256:file.sha256,bytes:file.bytes};
 }
 need(files['manifest.json'].sha256===receipt.manifestSha256&&files['manifest.json'].bytes===raw.length,
  'MCP_DATASET_RECEIVING_MANIFEST_CHANGED');
 const record={schema:SCHEMA,acquisitionId,room,sourceBindingSha256:receipt.sourceBindingSha256,
  sourceFormat:receipt.sourceFormat,rows:manifest.dataset.rows,chainDigest:manifest.chainDigest,files};
 await bindDatasetFiles({record,room,native:manifest,readSavedFile});
 for(const file of Object.values(files))await readSavedFile(file,{maxBytes:1});
 const archiveNames=['session.json',...Array.from({length:native.nativeStatus.pages},(_,i)=>'pages/'+String(i).padStart(5,'0')+'.json')];
 need(same(Object.keys(receipt.archives??{}).sort(),archiveNames.slice().sort()),
  'MCP_DATASET_RECEIVING_ARCHIVES_CHANGED');
 for(const [index,name] of archiveNames.entries()){
  const file=receipt.archives[name];
  need(file?.path===join(room,name),'MCP_DATASET_RECEIVING_PATH_CHANGED');
  await (index===0?readSavedFile:readArchive)({destination:file.path,bytes:file.bytes,sha256:file.sha256},{maxBytes:1},index-1);
 }
 const sourceFiles=receipt.sourceFiles??{},sourceNames=isDirect?[]:['session','marker'];
 need(same(Object.keys(sourceFiles).sort(),sourceNames.slice().sort()),'MCP_DATASET_RECEIVING_SOURCE_CHANGED');
 for(const name of sourceNames){
  const expected=name==='session'?join(receipt.session,'session.json'):join(dirname(room),'.'+basename(room)+'.sf88-source.json');
  const file=sourceFiles[name];need(file?.path===expected,'MCP_DATASET_RECEIVING_PATH_CHANGED');
  await readSavedFile({destination:file.path,bytes:file.bytes,sha256:file.sha256},{maxBytes:1});
 }
 if(sha(await bytes(join(room,'manifest.json'),4*1024*1024))!==receipt.manifestSha256)
  throw new InputError('MCP_DATASET_RECEIVING_MANIFEST_CHANGED');
 return {record,native:manifest};
}

export async function registerReceivedDataset({path,acquisitionId,room,session,python,readSavedFile,readArchive}){
 await directory(room);if(session!==undefined&&session!==null)await directory(session);
 const receipt=await originalReceive(python,room,session);
 need(receipt.room===room&&receipt.session===(session??null),'MCP_DATASET_RECEIVING_PATH_CHANGED');
 const delivered=await verifiedReceipt(receipt,acquisitionId,readSavedFile,readArchive);
 const specification={acquisitionId,receipt},registration={
  schema:SCHEMA,...specification,bindingSha256:sha(canonical(specification)),registeredAt:new Date().toISOString(),
  authority:'HOST_REGISTERED_ORIGINAL_FINALIZED_DATASET',
 };
 need(Buffer.byteLength(JSON.stringify(registration,null,2)+'\n')<=16*1024*1024,'MCP_DATASET_RECEIVING_RECORD_TOO_LARGE');
 const saved=await retainRecord(join(path,'received.json'),registration,{resume:true,ignore:['registeredAt']});
 return {registration:saved,delivered};
}

export async function loadReceivedDataset({path,acquisitionId,readSavedFile,readArchive}){
 const raw=await optionalBytes(join(path,'received.json'),16*1024*1024);
 if(raw===null)return null;
 const registration=parse(raw);
 need(registration.schema===SCHEMA&&registration.acquisitionId===acquisitionId&&
  registration.bindingSha256===sha(canonical({acquisitionId,receipt:registration.receipt}))&&
  registration.authority==='HOST_REGISTERED_ORIGINAL_FINALIZED_DATASET',
  'MCP_DATASET_RECEIVING_REGISTRATION_CHANGED');
 const delivered=await verifiedReceipt(registration.receipt,acquisitionId,readSavedFile,readArchive);
 const {receipt}=registration;
 return {path,key:sha(acquisitionId),received:{registration,receipt,delivered},
  session:receipt.session,
  record:{...delivered.record,selected:{snapshot:delivered.native.dataset.snapshot,
   fields:delivered.native.dataset.projectedFields,columns:receipt.columns,
   query:{filters:delivered.native.dataset.filters,ranges:delivered.native.dataset.ranges,
    order:delivered.native.dataset.order,originalQueryHash:delivered.native.dataset.originalQueryHash}},
   specification:{sourceId:receipt.sourceId}},
  pointer:receipt.session?{sessionId:receipt.sessionId,configurationSha256:receipt.configurationSha256}:null};
}

export function receivedDatasetView(saved,{offset=0,limit=25}={}){
 const {receipt,registration}=saved.received,status=receipt.native.nativeStatus;
 return {schema:SCHEMA,acquisitionId:saved.record.acquisitionId,sourceFormat:receipt.sourceFormat,
  bindingSha256:registration.bindingSha256,sourceBindingSha256:receipt.sourceBindingSha256,
  status:'COMPLETE',readOnly:true,report:{...status,status:'COMPLETE'},
  authority:'ORIGINAL_FINALIZED_DELIVERY; NO_ACQUISITION_CREATED',
  source:{snapshot:status.snapshot,manifestSha256:receipt.manifestSha256,
   ...(receipt.sessionId?{sessionId:receipt.sessionId,configurationSha256:receipt.configurationSha256}:{})}};
}

export function receivedDatasetHandoff(saved){
 const {receipt,registration,delivered}=saved.received;
 return {acquisitionId:saved.record.acquisitionId,sourceFormat:receipt.sourceFormat,session:receipt.session,
  room:receipt.room,sourceId:receipt.sourceId,sourceBindingSha256:receipt.sourceBindingSha256,
  manifestSha256:receipt.manifestSha256,receivingBindingSha256:registration.bindingSha256,
  snapshot:delivered.native.dataset.snapshot,query:saved.record.selected.query,
  ...(receipt.sessionId?{sessionId:receipt.sessionId,configurationSha256:receipt.configurationSha256}:{}),
  files:Object.fromEntries(Object.entries(delivered.record.files).map(([name,file])=>[
   name,{path:file.destination,sha256:file.sha256,bytes:file.bytes}]))};
}

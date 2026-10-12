#!/usr/bin/env node
// MIT. Original merchant implementation through the SF74 case writer.
import {resolve,join,basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {openCaseStore} from './case-store.mjs';
import {createCaseSourceDelivery} from './case-source-delivery.mjs';
import {exportCaseSourcePackage,inspectCaseSourcePackage,receiveCaseSourcePackage,MAX_CASE_SOURCE_MANIFEST_BYTES} from './case-source-package.mjs';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';
import {inspectCaseCommissioning,prepareCaseCommissioning,operateCaseCommissioning} from './case-commissioning.mjs';
import {MAX_COMMISSIONING_BYTES,MAX_MATERIAL_BYTES,encodeCommissioningBytes} from './commissioning.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const names=['cases-dir','case','revision','implementation-revision','request-id','actor','recorded-at',
  'section','offset','limit','command-file','file','kind','description','reference','tasks','edition-id','media-type','out','export-id',
  'source-dir','from','sha256','python','generated-at'];
function absolute(value,label) {
  if(typeof value!=='string'||!isAbsolute(value))throw Error(label+' must be an absolute path');
  return resolve(value);
}
function integer(value,label) {
  if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Use a nonnegative '+label);
  return Number(value);
}
function required(values,name) {if(!values[name])throw Error('Supply --'+name);return values[name];}
async function withSourceDelivery(store,values,operation) {
  let delivery,primary;
  try {
    if(values['source-dir'])delivery=await createCaseSourceDelivery({store,
      directory:absolute(values['source-dir'],'Source delivery directory'),
      python:values.python??process.env.SCF_PYTHON??'python3'});
    return await operation(delivery);
  } catch(error){primary=error;throw error;}
  finally {
    try{await delivery?.close();}
    catch(error){if(primary){primary.closeError=error;throw primary;}throw error;}
  }
}
async function exportImplementation(store,values) {
  const output=absolute(required(values,'out'),'Output directory');
  const result=await withSourceDelivery(store,values,sourceDelivery=>exportCaseSourcePackage({store,
    casesDirectory:absolute(required(values,'cases-dir'),'Case directory'),id:required(values,'case'),
    revision:required(values,'revision'),directory:output,exportId:values['export-id']??basename(output),
    sourceDelivery,python:values.python??process.env.SCF_PYTHON??'python3',
    ...(values['generated-at']?{generatedAt:values['generated-at']}:{})}));
  // Retain the original CLI's implementation inventory shape while exposing the
  // complete native case/source package identity alongside it.
  const bytes=await readPrivateFile(join(output,'implementation-export.json'),MAX_CASE_SOURCE_MANIFEST_BYTES);
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return {...manifest,output,state:result.state,caseSource:result};
}
export async function commissioningCli(argv=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,
    options:{...Object.fromEntries(names.map(name=>[name,{type:'string'}])),help:{type:'boolean'}}});
  if(values.help){if(positionals.length||Object.keys(values).length!==1)throw Error('Use --help on its own');return {
    command:'merchant-implementation',usage:'starforge merchant-implementation read|prepare|apply|attach|export|inspect-package|receive-package [options]',
    read:'[--revision SHA256] [--section overview|tasks|materials|receiving|measurements|events|editions|files|comparisons] [--offset N] [--limit N]',
    prepare:'--revision SHA256 --implementation-revision N --request-id ID --actor NAME [--recorded-at UTC]',
    apply:'--revision SHA256 --command-file /absolute/private/original-command.json',
    attach:'--revision SHA256 --implementation-revision N --request-id ID --actor NAME --file /absolute/private/original [--tasks ID,ID] [--kind KIND] [--reference REF]',
    export:'--cases-dir /private/cases --case UUID --revision SHA256 --out /private/package [--source-dir /private/original-sources] [--export-id ID] [--generated-at UTC] [--python /absolute/python3]',
    'inspect-package':'--from /private/package [--sha256 PACKAGE_MANIFEST_SHA256] [--python /absolute/python3]',
    'receive-package':'--from /private/package --sha256 PACKAGE_MANIFEST_SHA256 --out /private/receiving --cases-dir /private/received-cases --source-dir /private/received-sources --request-id ID --actor NAME [--python /absolute/python3]',
    guide:'sf74-merchant-support-console/IMPLEMENTATION.md',packageGuide:'sf74-merchant-support-console/CASE_SOURCE_PACKAGE.md'};}
  if(positionals.length!==1||!['read','prepare','apply','attach','export','inspect-package','receive-package'].includes(positionals[0]))
    throw Error('Choose read, prepare, apply, attach, export, inspect-package or receive-package');
  const action=positionals[0];
  const allowed={
    read:['cases-dir','case','revision','section','offset','limit'],
    prepare:['cases-dir','case','revision','implementation-revision','request-id','actor','recorded-at'],
    apply:['cases-dir','case','revision','command-file'],
    attach:['cases-dir','case','revision','implementation-revision','request-id','actor','recorded-at','file','kind','description','reference','tasks','edition-id','media-type'],
    export:['cases-dir','case','revision','out','export-id','source-dir','generated-at','python'],
    'inspect-package':['from','sha256','python'],
    'receive-package':['from','sha256','out','cases-dir','source-dir','request-id','actor','python'],
  }[action];
  for(const key of Object.keys(values))if(!allowed.includes(key))throw Error('Unexpected --'+key+' for '+action);
  if(action==='inspect-package')return inspectCaseSourcePackage({
    directory:absolute(required(values,'from'),'Original package directory'),
    ...(values.sha256?{expectedManifestSha256:values.sha256}:{}),
    python:values.python??process.env.SCF_PYTHON??'python3'});
  const store=await openCaseStore(absolute(required(values,'cases-dir'),'Case directory'));
  if(action==='receive-package') {
    required(values,'source-dir');
    return withSourceDelivery(store,values,sourceDelivery=>receiveCaseSourcePackage({
      directory:absolute(required(values,'from'),'Original package directory'),
      receivingDirectory:absolute(required(values,'out'),'Receiving directory'),
      casesDirectory:absolute(required(values,'cases-dir'),'Case directory'),sourceDelivery,
      requestId:required(values,'request-id'),actor:required(values,'actor'),
      expectedManifestSha256:required(values,'sha256'),python:values.python??process.env.SCF_PYTHON??'python3'}));
  }
  const id=required(values,'case');
  if(action==='read')return inspectCaseCommissioning(store,{id,...(values.revision?{revision:values.revision}:{}),
    ...(values.section?{section:values.section}:{}),...(values.offset?{offset:integer(values.offset,'offset')}:{}),
    ...(values.limit?{limit:integer(values.limit,'limit')}:{} )});
  if(action==='export')return exportImplementation(store,values);
  const expectedRevision=required(values,'revision');
  if(action==='prepare')return prepareCaseCommissioning(store,{id,expectedRevision,
    expectedImplementationRevision:integer(required(values,'implementation-revision'),'implementation revision'),
    requestId:required(values,'request-id'),actor:required(values,'actor'),
    ...(values['recorded-at']?{recordedAt:values['recorded-at']}:{})});
  let command;
  if(action==='apply') {
    const bytes=await readPrivateFile(absolute(required(values,'command-file'),'Command file'),MAX_COMMISSIONING_BYTES);
    command=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } else {
    const path=absolute(required(values,'file'),'Original deliverable');
    const bytes=await readPrivateFile(path,MAX_MATERIAL_BYTES),requestId=required(values,'request-id');
    command={type:'add_material',requestId,expectedRevision:integer(required(values,'implementation-revision'),'implementation revision'),
      actor:required(values,'actor'),...(values['recorded-at']?{recordedAt:values['recorded-at']}:{}),
      payload:{id:'material-'+sha(requestId).slice(0,32),name:basename(path),data:encodeCommissioningBytes(bytes),
        mediaType:values['media-type']??'application/octet-stream',kind:values.kind??'deliverable',
        description:values.description??'',reference:values.reference??'',
        taskIds:values.tasks?values.tasks.split(','):[],...(values['edition-id']?{editionId:values['edition-id']}:{})}};
  }
  return operateCaseCommissioning(store,{id,expectedRevision,command});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{process.stdout.write(json(await commissioningCli()));}
  catch(error){process.stderr.write(json({error:error.code??'IMPLEMENTATION_OPERATION_FAILED',detail:error.message,
    ...(error.currentRevision?{currentRevision:error.currentRevision}:{} )}));process.exitCode=1;}
}

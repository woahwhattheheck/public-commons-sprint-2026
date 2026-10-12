#!/usr/bin/env node
// MIT. Original merchant implementation through the SF74 case writer.
import {constants} from 'node:fs';
import {mkdir,open,lstat,readFile} from 'node:fs/promises';
import {resolve,join,dirname,basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {openCaseStore} from './case-store.mjs';
import {parseWorkspace} from './workspace-file.mjs';
import {exportRuntimeHandoff} from './runtime-support.mjs';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';
import {inspectCaseCommissioning,prepareCaseCommissioning,operateCaseCommissioning} from './case-commissioning.mjs';
import {MAX_COMMISSIONING_BYTES,MAX_MATERIAL_BYTES,commissioningSummary,commissioningReport,
  commissioningTasksCsv,commissioningOriginalFiles,commissioningFileBytes,encodeCommissioningBytes} from './commissioning.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const names=['cases-dir','case','revision','implementation-revision','request-id','actor','recorded-at',
  'section','offset','limit','command-file','file','kind','description','reference','tasks','edition-id','media-type','out','export-id'];
function absolute(value,label) {
  if(typeof value!=='string'||!isAbsolute(value))throw Error(label+' must be an absolute path');
  return resolve(value);
}
function integer(value,label) {
  if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Use a nonnegative '+label);
  return Number(value);
}
function required(values,name) {if(!values[name])throw Error('Supply --'+name);return values[name];}
async function directory(path) {
  await mkdir(path,{mode:0o700,recursive:true});
  const st=await lstat(path);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==process.getuid())throw Error('Export directories must be private and must not be symbolic links');
}
async function retainFile(root,name,bytes) {
  const path=join(root,name);
  if(!path.startsWith(root+'/'))throw Error('Export filename leaves its selected directory');
  await directory(dirname(path));
  let handle;
  try {
    handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(bytes);await handle.sync();
  } catch(error) {
    if(error.code!=='EEXIST')throw error;
    const existing=await readPrivateFile(path,Math.max(bytes.length,1));
    if(!Buffer.from(existing).equals(Buffer.from(bytes)))throw Error('Retained export differs: '+name);
  } finally {await handle?.close();}
}
async function exportImplementation(store,values) {
  const id=required(values,'case'),revision=required(values,'revision'),record=await store.read(id,revision);
  const workspace=await parseWorkspace(record.workspaceText),state=workspace.commissioning;
  if(!state)throw Error('This case has no retained implementation');
  const output=absolute(required(values,'out'),'Output directory');await directory(output);
  const {workspaceText,supportText,...caseSummary}=record;
  const files=[
    {name:'case.json',body:Buffer.from(json(caseSummary))},
    {name:'merchant-workspace.json',body:Buffer.from(record.workspaceText)},
    {name:'merchant-commissioning.json',body:Buffer.from(json(state))},
    {name:'merchant-implementation.html',body:Buffer.from(commissioningReport(state))},
    {name:'merchant-implementation-tasks.csv',body:Buffer.from(commissioningTasksCsv(state))},
    ...commissioningOriginalFiles(state).map(file=>({name:'originals/'+file.name,
      body:Buffer.from(commissioningFileBytes(state,file.sha256))})),
  ];
  if(supportText!==null) {
    const handoff=await exportRuntimeHandoff({workspaceText,supportText,metadata:record.metadata});
    files.push({name:'merchant-support.json',body:Buffer.from(handoff.handoff)},
      {name:'support.html',body:Buffer.from(handoff.html)});
  }
  const exportId=values['export-id']??basename(output);
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(exportId))
    throw Error('Supply --export-id using the original lowercase support export identifier');
  const fileInventory=files.map(file=>({name:file.name,bytes:file.body.length,sha256:sha(file.body)}));
  for(const file of files)await retainFile(output,file.name,file.body);
  // The original Support manifest makes this full package directly available
  // through its existing retained-file reader and the receiving Handoffs desk.
  const supportManifest={schema:'stellar-forge.merchant-support-export.v1',exportId,
    case:{id,revision,workspaceSha256:sha(workspaceText),supportSha256:supportText===null?null:sha(supportText)},
    workorderIncluded:false,files:fileInventory.filter(file=>!file.name.startsWith('originals/'))};
  let supportManifestBytes;
  try {
    supportManifestBytes=await readPrivateFile(join(output,'support-export.json'),65000);
    const retained=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(supportManifestBytes));
    const {createdAt,...original}=retained;
    if(typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt))||
      JSON.stringify(original)!==JSON.stringify(supportManifest))throw Error('The retained Support export belongs to different case bytes');
  } catch(error) {
    if(error.code!=='ENOENT')throw error;
    supportManifestBytes=Buffer.from(json({...supportManifest,createdAt:new Date().toISOString()}));
    await retainFile(output,'support-export.json',supportManifestBytes);
  }
  fileInventory.push({name:'support-export.json',bytes:supportManifestBytes.length,sha256:sha(supportManifestBytes)});
  const manifest={schema:'stellar-forge.merchant-implementation-export.v1',case:{id,revision},
    implementationRevision:state.revision,summary:commissioningSummary(state),files:fileInventory};
  await retainFile(output,'implementation-export.json',Buffer.from(json(manifest)));
  const handle=await open(output,constants.O_RDONLY|constants.O_DIRECTORY);
  try{await handle.sync();}finally{await handle.close();}
  return {...manifest,output,state:'COMPLETE'};
}
export async function commissioningCli(argv=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,
    options:{...Object.fromEntries(names.map(name=>[name,{type:'string'}])),help:{type:'boolean'}}});
  if(values.help){if(positionals.length||Object.keys(values).length!==1)throw Error('Use --help on its own');return {
    command:'merchant-implementation',usage:'starforge merchant-implementation read|prepare|apply|attach|export --cases-dir /absolute/private/cases --case UUID [options]',
    read:'[--revision SHA256] [--section overview|tasks|materials|receiving|measurements|events|editions|files|comparisons] [--offset N] [--limit N]',
    prepare:'--revision SHA256 --implementation-revision N --request-id ID --actor NAME [--recorded-at UTC]',
    apply:'--revision SHA256 --command-file /absolute/private/original-command.json',
    attach:'--revision SHA256 --implementation-revision N --request-id ID --actor NAME --file /absolute/private/original [--tasks ID,ID] [--kind KIND] [--reference REF]',
    export:'--revision SHA256 --out /absolute/private/receiving-package [--export-id original-support-export-id]',
    guide:'sf74-merchant-support-console/IMPLEMENTATION.md'};}
  if(positionals.length!==1||!['read','prepare','apply','attach','export'].includes(positionals[0]))
    throw Error('Choose read, prepare, apply, attach or export');
  const action=positionals[0],id=required(values,'case');
  const allowed={
    read:['cases-dir','case','revision','section','offset','limit'],
    prepare:['cases-dir','case','revision','implementation-revision','request-id','actor','recorded-at'],
    apply:['cases-dir','case','revision','command-file'],
    attach:['cases-dir','case','revision','implementation-revision','request-id','actor','recorded-at','file','kind','description','reference','tasks','edition-id','media-type'],
    export:['cases-dir','case','revision','out','export-id'],
  }[action];
  for(const key of Object.keys(values))if(!allowed.includes(key))throw Error('Unexpected --'+key+' for '+action);
  const store=await openCaseStore(absolute(required(values,'cases-dir'),'Case directory'));
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

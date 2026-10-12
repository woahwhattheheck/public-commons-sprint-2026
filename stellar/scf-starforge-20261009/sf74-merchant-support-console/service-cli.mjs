#!/usr/bin/env node
// MIT. Complete service operations and report delivery through the original SF74 case.
import {mkdir,lstat} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {openCaseStore,retainCaseArtifact} from './case-store.mjs';
import {parseWorkspace} from './workspace-file.mjs';
import {MAX_HANDOFF_BYTES} from './runtime-support.mjs';
import {readServiceCase,changeServiceCase,previewServiceCase,readServiceCaseReport} from './service-cases.mjs';
import {readServiceIncidentSnapshot} from './service-source.mjs';
import {openIncidentSources} from './incident-sources.mjs';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const usage='node service-cli.mjs --cases-dir ABS --request-file ABS [--incident-sources ABS | --legacy-incidents ABS] [--out ABS]\n'+
  'Private UTF-8 request: {"method":"read|change|preview|report","args":{...original MCP arguments}}\n'+
  '--out writes one complete retained report delivery: original case/workspace/service plus report JSON/CSV/HTML and manifest.\n';
function absolute(value,label){if(typeof value!=='string'||!isAbsolute(value))throw new Error(label+' must be an absolute path.');return resolve(value);}
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform!=='win32'&&(stat.mode&0o077))
    throw new Error('Select a private real output directory with mode 0700.');
}
const retainFile=retainCaseArtifact;
const DELIVERY_SCHEMA='stellar-forge.merchant-service-report-delivery.v1';
const INTENT_SCHEMA='stellar-forge.merchant-service-report-delivery-intent.v1';
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const inputSha256=args=>sha(JSON.stringify(canonical(args)));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
async function optionalPrivateJson(path){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivateFile(path,65000)));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function deliveryPlan(value){
  if(!object(value)||value.schema!==DELIVERY_SCHEMA||!object(value.request)||
    value.request.schema!=='stellar-forge.merchant-service-report-delivery-request.v1'||
    typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||
    new Date(value.createdAt).toISOString()!==value.createdAt||!Array.isArray(value.files)||!value.files.length)
    throw new Error('The retained original service delivery plan is invalid.');
  const names=new Set();
  for(const file of value.files){
    if(!object(file)||typeof file.name!=='string'||!/^[a-zA-Z0-9_.-]+$/.test(file.name)||names.has(file.name)||
      !Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>MAX_HANDOFF_BYTES||!/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error('The original report completion manifest is invalid.');
    names.add(file.name);
  }
  return value;
}
function originalIntent(value,args){
  if(!object(value)||value.schema!==INTENT_SCHEMA||!object(value.input)||
    !/^[a-f0-9]{64}$/.test(value.inputSha256)||inputSha256(value.input)!==value.inputSha256)
    throw new Error('The retained original service delivery request is invalid.');
  const manifest=deliveryPlan(value.manifest),request=manifest.request;
  if(value.input.id!==request.id||value.input.reportId!==request.reportId||
    value.input.revision!==undefined&&value.input.revision!==request.revision)
    throw new Error('The retained service delivery input and selected case differ.');
  if(inputSha256(args)!==value.inputSha256)
    throw new Error('This output directory belongs to another original service report request.');
  return {intent:value,manifest,request};
}
async function exportReport(store,args,out){
  if(!object(args))throw new Error('Choose the original saved service report arguments.');
  const output=absolute(out,'Output directory');await privateDirectory(output);
  const completion=join(output,'service-delivery.json'),intentFile=join(output,'service-delivery-request.json');
  let retained=await optionalPrivateJson(intentFile),existing=await optionalPrivateJson(completion);
  let accepted=retained?originalIntent(retained,args):null;
  if(existing){
    deliveryPlan(existing);
    if(accepted&&!same(existing,accepted.manifest))
      throw new Error('The original completion differs from its retained delivery plan.');
    if(existing.request.id!==args.id||existing.request.reportId!==args.reportId||
      args.revision!==undefined&&existing.request.revision!==args.revision)
      throw new Error('This output directory belongs to another original service report delivery.');
  }
  // Resolve a retained original selection before reading a changing case head.
  // The request file can omit revision: the first selected revision then remains
  // the same delivery through an interruption, later case edits and replay.
  const pinned=accepted?.request??existing?.request;
  const original=await readServiceCaseReport({store,args:{...args,...(pinned?{revision:pinned.revision}:{}),format:'json'}});
  const record=await store.read(original.case.id,original.case.revision),workspace=await parseWorkspace(record.workspaceText);
  const selected={id:record.id,revision:record.revision,reportId:original.reportId};
  const request={schema:'stellar-forge.merchant-service-report-delivery-request.v1',...selected,
    workspaceSha256:sha(record.workspaceText),reportSha256:original.reportSha256};
  const {workspaceText,supportText,...summary}=record;summary.currentRevision=record.revision;
  const files=[{name:'case.json',body:json(summary)},{name:'merchant-workspace.json',body:workspaceText},
    {name:'merchant-service.json',body:json(workspace.service)}];
  if(supportText!==null)files.push({name:'merchant-runtime-support.json',body:supportText});
  for(const format of ['json','csv','html']){
    const report=await readServiceCaseReport({store,args:{...selected,format}});
    files.push({name:report.filename,body:report.text});
  }
  const expectedFiles=files.map(file=>({name:file.name,bytes:Buffer.byteLength(file.body),sha256:sha(file.body)}));
  const verifyPlan=manifest=>{
    if(!same(manifest.request,request)||!same(manifest.files,expectedFiles))
      throw new Error('The retained delivery plan differs from the original selected case and report.');
  };
  if(accepted)verifyPlan(accepted.manifest);
  if(existing){
    verifyPlan(existing);
    for(const file of existing.files){
      const bytes=await readPrivateFile(join(output,file.name),file.bytes);
      if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)
        throw new Error('The original report delivery changed: '+file.name);
    }
    return {...existing,reused:true};
  }
  const resumed=Boolean(accepted);
  if(!accepted){
    const manifest={schema:DELIVERY_SCHEMA,request,createdAt:new Date().toISOString(),files:expectedFiles};
    retained={schema:INTENT_SCHEMA,input:JSON.parse(JSON.stringify(args)),inputSha256:inputSha256(args),manifest};
    try{await retainFile(intentFile,Buffer.from(json(retained)));}
    catch(error){
      if(error.code!=='CASE_STORAGE_INVALID')throw error;
      // A concurrent same-request writer may have retained a different first
      // timestamp or selected revision. Rejoin its immutable plan exactly.
      originalIntent(await optionalPrivateJson(intentFile),args);
      return exportReport(store,args,out);
    }
    accepted={intent:retained,manifest,request};
  }
  for(const file of files)await retainFile(join(output,file.name),Buffer.from(file.body));
  await retainFile(completion,Buffer.from(json(accepted.manifest)));
  return {...accepted.manifest,reused:false,resumed};
}
export async function serviceCli(argv,{stdout=process.stdout,environment=process.env}={}){
  const {values}=parseArgs({args:argv,allowPositionals:false,strict:true,options:{
    'cases-dir':{type:'string'},'request-file':{type:'string'},'incident-sources':{type:'string'},
    'legacy-incidents':{type:'string'},out:{type:'string'},help:{type:'boolean'}}});
  if(values.help){stdout.write(usage);return {help:true};}
  const cases=absolute(values['cases-dir'],'Case directory'),input=absolute(values['request-file'],'Request file');
  if(values['incident-sources']&&values['legacy-incidents'])throw new Error('Select one original incident-source mode.');
  const bytes=await readPrivateFile(input,131072);
  const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!['method','args'].includes(key))||
    !['read','change','preview','report'].includes(request.method))throw new Error('Choose an original service request method and arguments.');
  if(values.out&&request.method!=='report')throw new Error('--out is for a complete retained report delivery.');
  const store=await openCaseStore(cases);let manager;
  const readSnapshot=async args=>{
    if(values['incident-sources']){
      manager??=await openIncidentSources({configPath:absolute(values['incident-sources'],'Incident source file'),environment});
      const sources=manager.profiles().sources,source=args.incidentSource??(sources.length===1?sources[0].id:undefined);
      if(!source)throw new Error('Select incidentSource from the original host source file.');
      return manager.serviceSnapshot(source,{merchantId:args.merchantId});
    }
    if(args.incidentSource!==undefined)throw new Error('Legacy incident mode uses the original implicit source; omit incidentSource.');
    return readServiceIncidentSnapshot({directory:absolute(values['legacy-incidents'],'Original incident directory'),
      source:{id:'legacy',label:'Original incident store'},merchantId:args.merchantId});
  };
  let result;
  try{
    if(request.method==='read')result=await readServiceCase({store,args:request.args});
    else if(request.method==='change')result=await changeServiceCase({store,args:request.args,readSnapshot});
    else if(request.method==='preview')result=await previewServiceCase({store,args:request.args});
    else if(values.out)result=await exportReport(store,request.args,values.out);
    else result=await readServiceCaseReport({store,args:request.args});
  }finally{await manager?.close();}
  stdout.write(json(result));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  serviceCli(process.argv.slice(2)).catch(error=>{
    process.stderr.write(json({error:error.code??'SERVICE_CLI_ERROR',detail:error.message}));process.exitCode=1;
  });
}

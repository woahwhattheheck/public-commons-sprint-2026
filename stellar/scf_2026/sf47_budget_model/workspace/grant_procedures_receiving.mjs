#!/usr/bin/env node
// MIT. One original Grant Operations case through procedures, native export and two receivers.
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GrantWorkspaceClient,inspectGrantAgentBinding} from './agent-client.mjs';
import {inspectOperatingPlan,saveOperatingPlanRevision} from '../../../scf-starforge-20261009/distribution/discovery/operating-plan.mjs';
import {procedureJSON,procedureCanonical,inspectGrantProcedure,GRANT_PROCEDURE_SCHEMA} from './grant_procedures.mjs';
import {readProcedureFile,retainProcedureFile,procedureDirectory,prepareGrantProcedureNative,
 saveGrantProcedureNative,reopenGrantProcedureNative,exportGrantProcedureNative,
 receiveGrantProcedureNative,inspectGrantProcedureDelivery} from './grant_procedures_native.mjs';

export const GRANT_PROCEDURE_RECEIVING_SCHEMA=GRANT_PROCEDURE_SCHEMA+'.receiving-input';
const hash=x=>createHash('sha256').update(x).digest('hex'),json=x=>Buffer.from(procedureJSON(x));
const same=(a,b)=>procedureCanonical(a)===procedureCanonical(b);
const check=(x,message)=>{if(!x)throw new Error(message);};
const utf8=x=>new TextDecoder('utf-8',{fatal:true}).decode(x);
async function maybe(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function readJSON(path){return JSON.parse(utf8(await readProcedureFile(path)));}
async function retainJSON(path,value){return retainProcedureFile(path,json(value));}
function requestId(base,phase){const value=base+'-'+phase;check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value),'Keep the explicit operation ID short enough for the original request table.');return value;}
function inspectInput(input){
 const keys=['schema','operationId','actor','caseId','expectedVersion','sourceBinding','receivingBinding','secondReceivingBinding',
  'operatingPlanFile','selectionFile','revisionTwoDraftFile','revisionTwoSelectionFile','receivingName','secondReceivingName','directory'];
 check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>keys.includes(k)),
  'Use the complete documented original-case receiving input.');
 check(input.schema===GRANT_PROCEDURE_RECEIVING_SCHEMA&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,70}$/.test(input.operationId||''),
  'Choose one explicit original programme identity.');
 check(/^operation-[a-f0-9]{32}$/.test(input.caseId||'')&&Number.isSafeInteger(input.expectedVersion)&&input.expectedVersion>0,
  'Select the actual original native case and reviewed version.');
 for(const key of ['actor','receivingName','secondReceivingName'])check(typeof input[key]==='string'&&input[key].trim()&&input[key].length<=300,'Supply '+key+'.');
 for(const key of ['operatingPlanFile','selectionFile','revisionTwoDraftFile','directory'])
  check(typeof input[key]==='string'&&input[key].startsWith('/'),'Use an absolute original '+key+'.');
 if(input.revisionTwoSelectionFile!==undefined)check(typeof input.revisionTwoSelectionFile==='string'&&input.revisionTwoSelectionFile.startsWith('/'),'Use an absolute second selection file.');
 return input;
}
function selection(value,actor){
 const keys=['actor','note','selectedRevision','sourceIds','tables','editions','stepLinks','parentSourceId'];
 check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k)),'Use only the original documented selection fields.');
 if(value.actor!==undefined)check(value.actor===actor,'The selected actor differs from the programme operator.');
 return {...value,actor};
}
export async function receiveGrantProcedureJourney(inputPath,{resume=false,emit=value=>process.stdout.write(procedureJSON(value))}={}){
 inputPath=resolve(inputPath);const originalInput=await readProcedureFile(inputPath),input=inspectInput(JSON.parse(utf8(originalInput)));
 const directory=await procedureDirectory(resolve(input.directory),{create:true});
 const names=['sourceBinding','receivingBinding','secondReceivingBinding'],bindings={};
 for(const name of names)bindings[name]=await inspectGrantAgentBinding(input[name]);
 check(new Set(names.map(n=>bindings[n].directory)).size===3,'Use three distinct original application workspace directories; preserve the source and each receiver.');
 const inputFiles={operatingPlanFile:await readProcedureFile(input.operatingPlanFile),selectionFile:await readProcedureFile(input.selectionFile),
  revisionTwoDraftFile:await readProcedureFile(input.revisionTwoDraftFile)};
 if(input.revisionTwoSelectionFile)inputFiles.revisionTwoSelectionFile=await readProcedureFile(input.revisionTwoSelectionFile);
 let firstSelection=selection(JSON.parse(utf8(inputFiles.selectionFile)),input.actor);
 // Retain complete local-table inputs before any source or receiving mutation.
 for(const [selectionName,body] of Object.entries({first:firstSelection,...(inputFiles.revisionTwoSelectionFile?
  {second:selection(JSON.parse(utf8(inputFiles.revisionTwoSelectionFile)),input.actor)}:{})})){
  for(const [index,row] of (body.tables||[]).entries()){
   if(row.origin==='local-original'){
    check(typeof row.file==='string'&&row.file.startsWith('/'),'Use a complete absolute local table file.');
    const raw=await readProcedureFile(row.file);inputFiles[selectionName+'-table-'+index]=raw;
   }
  }
 }
 const own=await readProcedureFile(fileURLToPath(import.meta.url));
 const intent={schema:GRANT_PROCEDURE_SCHEMA+'.journey',operationId:input.operationId,
  originalInput:{bytes:originalInput.length,sha256:hash(originalInput)},
  programme:{bytes:own.length,sha256:hash(own)},bindings:Object.fromEntries(names.map(n=>[n,{
   directory:bindings[n].directory,selectionSha256:bindings[n].selectionSha256}])),
  files:Object.fromEntries(Object.entries(inputFiles).map(([k,v])=>[k,{bytes:v.length,sha256:hash(v)}]))};
 await retainJSON(join(directory,'INTENT.json'),intent);await retainProcedureFile(join(directory,'original-input.json'),originalInput);
 for(const [name,raw] of Object.entries(inputFiles))await retainProcedureFile(join(directory,'input-'+name+'.json'),raw);
 const phaseDir=async name=>procedureDirectory(join(directory,name),{create:true});
 const closeRecords=[];
 async function connected(name,phase,fn){
  const client=new GrantWorkspaceClient(bindings[name]);let error=null;
  try{await client.open({expectedSelectionSha256:bindings[name].selectionSha256});return await fn(client);}
  catch(e){error=e;throw e;}
  finally{
   try{const actual=await client.close();closeRecords.push({phase,binding:name,result:actual});emit({event:'GRANT_PROCEDURE_CONNECTION_CLOSED',phase,result:actual});}
   catch(e){emit({event:'GRANT_PROCEDURE_CONNECTION_CLOSE_FAILED',phase,message:e.message});if(!error)throw e;}
  }
 }
 const localSelection=body=>({...body,tables:(body.tables||[]).map((row,index)=>row.origin==='local-original'?
  {key:row.key,origin:row.origin,originalText:utf8(inputFiles[(body._which||'first')+'-table-'+index])}:row)});
 function inheritedSelection(document){
  return {actor:input.actor,note:'Continued the received original procedure with the selected operator-authored revision.',
   sourceIds:document.sources.map(x=>x.id),
   tables:document.sourceTables.map(x=>({key:x.key,origin:'preceding-procedure'})),
   editions:document.editions.map(x=>({kind:x.kind,id:x.ref.id,revision:x.ref.revision})),
   stepLinks:document.stepLinks};
 }
 async function prepared(client,phase,config){
  const out=await phaseDir(phase),path=join(out,'grant-procedure.json');
  await retainJSON(join(out,'selection.json'),config);
  if(await maybe(path)){
   const raw=utf8(await readProcedureFile(path));await inspectGrantProcedure(raw);
   return {raw};
  }
  const value=await prepareGrantProcedureNative(client,config);
  // Exact full text is durable before any mutation can dispatch.
  await retainProcedureFile(path,Buffer.from(value.raw));
  await retainJSON(join(out,'PREPARED.json'),{bytes:value.bytes,sha256:value.sha256,verification:value.verification,
   caseReturn:value.caseReturn,afterReturn:value.afterReturn});
  return value;
 }
 const completePath=join(directory,'COMPLETE.json');
 if(await maybe(completePath)){
  const saved=await readJSON(completePath);check(same(saved.intent,intent),'This completed programme has different original inputs.');
  const first=await inspectGrantProcedureDelivery(join(directory,'delivery-1')),second=await inspectGrantProcedureDelivery(join(directory,'delivery-2'));
  check(same(first.manifest,saved.firstDelivery)&&same(second.manifest,saved.secondDelivery),'A completed delivery differs.');
  const reopened=await connected('secondReceivingBinding','completed-independent-reopen',c=>reopenGrantProcedureNative(c,{
   caseId:saved.secondReceiving.id,sourceId:saved.secondProcedureSource.id}));
  check(reopened.plan.revisions.length===saved.revisions.second&&reopened.verification.verifiedParentSources.includes(saved.firstProcedureSource.id),
   'The completed receiving history differs.');
  emit({event:'GRANT_PROCEDURE_JOURNEY_REUSED',...saved,receivingVerification:reopened.verification});return saved;
 }
 let firstSaved;
 await connected('sourceBinding','original-procedure-save-and-export',async client=>{
  const initial=(await client.read('case',{caseId:input.caseId})).value;
  const prepExists=await maybe(join(directory,'prepared-1','grant-procedure.json'));
  if(!prepExists)check(initial.program.version===input.expectedVersion,'Review the actual original case version before this programme starts.');
  const choose=localSelection(firstSelection);
  const config={...choose,caseId:input.caseId,operatingPlanText:utf8(inputFiles.operatingPlanFile)};
  const value=await prepared(client,'prepared-1',config);
  firstSaved=await saveGrantProcedureNative(client,{prepared:value,requestId:requestId(input.operationId,'source'),
   operationDirectory:join(directory,'save-1'),workspaceDirectory:bindings.sourceBinding.directory,resume},{emit});
  await exportGrantProcedureNative(client,{caseId:input.caseId,sourceId:firstSaved.complete.source.id,
   expectedVersion:firstSaved.complete.native.version,directory:join(directory,'delivery-1')});
 });
 let firstReceived;
 await connected('receivingBinding','original-case-import',async client=>{
  firstReceived=await receiveGrantProcedureNative(client,{directory:join(directory,'delivery-1'),
   operationDirectory:join(directory,'receive-1'),workspaceDirectory:bindings.receivingBinding.directory,
   requestId:requestId(input.operationId,'receive1'),name:input.receivingName,actor:input.actor,resume},{emit});
 });
 let secondSaved,firstReopened,secondPlan;
 await connected('receivingBinding','independent-reopen-edit-and-export',async client=>{
  firstReopened=await reopenGrantProcedureNative(client,{caseId:firstReceived.complete.native.id,sourceId:firstSaved.complete.source.id});
  const firstRaw=firstReopened.raw,planPath=join(directory,'revision-two-operating-plan.json');
  if(await maybe(planPath)){
   secondPlan=inspectOperatingPlan(JSON.parse(utf8(await readProcedureFile(planPath))));
   const intended=saveOperatingPlanRevision(firstReopened.plan,JSON.parse(utf8(inputFiles.revisionTwoDraftFile)),
    {savedAt:secondPlan.revisions.at(-1).savedAt});
   check(secondPlan.revisions.length===firstReopened.plan.revisions.length+1&&same(secondPlan,intended),
    'The retained second revision must match the original complete reviewed draft.');
  }
  else{
   const draft=JSON.parse(utf8(inputFiles.revisionTwoDraftFile));
   secondPlan=saveOperatingPlanRevision(firstReopened.plan,draft,{savedAt:new Date().toISOString()});
   check(secondPlan.revisions.length===firstReopened.plan.revisions.length+1,'The selected second draft must contain an actual operator-authored change.');
   await retainProcedureFile(planPath,json(secondPlan));
  }
  check(same(secondPlan.revisions.slice(0,firstReopened.plan.revisions.length),firstReopened.plan.revisions),'Revision two must preserve every complete original revision.');
  let choose=inputFiles.revisionTwoSelectionFile?selection(JSON.parse(utf8(inputFiles.revisionTwoSelectionFile)),input.actor):
   inheritedSelection(firstReopened.document);
  choose={...choose,_which:'second'};choose=localSelection(choose);delete choose._which;
  if(choose.parentSourceId!==undefined)check(choose.parentSourceId===firstSaved.complete.source.id,'Revision two must use its actual original preceding source.');
  choose.parentSourceId=firstSaved.complete.source.id;
  const value=await prepared(client,'prepared-2',{...choose,caseId:firstReceived.complete.native.id,operatingPlanText:procedureJSON(secondPlan)});
  secondSaved=await saveGrantProcedureNative(client,{prepared:value,requestId:requestId(input.operationId,'revision2'),
   operationDirectory:join(directory,'save-2'),workspaceDirectory:bindings.receivingBinding.directory,resume},{emit});
  const old=await reopenGrantProcedureNative(client,{caseId:firstReceived.complete.native.id,sourceId:firstSaved.complete.source.id});
  check(old.raw===firstRaw,'Editing the received procedure changed the original retained source.');
  await exportGrantProcedureNative(client,{caseId:firstReceived.complete.native.id,sourceId:secondSaved.complete.source.id,
   expectedVersion:secondSaved.complete.native.version,directory:join(directory,'delivery-2')});
 });
 let secondReceived;
 await connected('secondReceivingBinding','second-complete-case-import',async client=>{
  secondReceived=await receiveGrantProcedureNative(client,{directory:join(directory,'delivery-2'),
   operationDirectory:join(directory,'receive-2'),workspaceDirectory:bindings.secondReceivingBinding.directory,
   requestId:requestId(input.operationId,'receive2'),name:input.secondReceivingName,actor:input.actor,resume},{emit});
 });
 const final=await connected('secondReceivingBinding','second-independent-reopen',client=>reopenGrantProcedureNative(client,{
  caseId:secondReceived.complete.native.id,sourceId:secondSaved.complete.source.id}));
 check(same(final.plan,secondPlan)&&final.verification.verifiedParentSources.includes(firstSaved.complete.source.id),
  'The second receiver must retain the full revised plan and its original source chain.');
 const firstDelivery=(await inspectGrantProcedureDelivery(join(directory,'delivery-1'))).manifest;
 const secondDelivery=(await inspectGrantProcedureDelivery(join(directory,'delivery-2'))).manifest;
 const result={schema:GRANT_PROCEDURE_SCHEMA+'.journey-complete',intent,
  sourceCase:{id:input.caseId,reviewedVersion:input.expectedVersion,savedVersion:firstSaved.complete.native.version},
  firstProcedureSource:firstSaved.complete.source,firstReceiving:firstReceived.complete.native,
  secondProcedureSource:secondSaved.complete.source,secondReceiving:secondReceived.complete.native,
  revisions:{first:firstReopened.plan.revisions.length,second:secondPlan.revisions.length},
  firstDelivery,secondDelivery,receivingVerification:final.verification,connectionClosures:closeRecords,
  resultScope:'Actual original case source writes, two complete native exports/imports and independent reopened revision history. Browser operation and command execution are not asserted by this native programme.'};
 emit({event:'GRANT_PROCEDURE_JOURNEY_COMPLETE',...result});
 await retainJSON(completePath,result);return result;
}
export async function mainGrantProcedureReceiving(argv=process.argv.slice(2),options={}){
 if(argv.length===0||argv.includes('--help')){const help={usage:'grant-procedures-receiving --input ABSOLUTE_JSON [--resume]',
  schema:GRANT_PROCEDURE_RECEIVING_SCHEMA,guide:'GRANT_PROCEDURES_RECEIVING.md'};
  (options.emit||((x)=>process.stdout.write(procedureJSON(x))))(help);return help;}
 check(argv[0]==='--input'&&typeof argv[1]==='string'&&argv.length<4&&(argv.length===2||argv[2]==='--resume'),'Use --input FILE and optional --resume.');
 return receiveGrantProcedureJourney(argv[1],{...options,resume:argv[2]==='--resume'});
}
if(process.argv[1]&&await realpath(resolve(process.argv[1])).then(x=>pathToFileURL(x).href===import.meta.url,()=>false))
 mainGrantProcedureReceiving().catch(e=>{process.stderr.write(procedureJSON({error:{code:e.code??null,message:e.message,uncertain:e.uncertain??null}}));process.exitCode=1;});

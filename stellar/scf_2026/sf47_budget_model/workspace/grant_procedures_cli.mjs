#!/usr/bin/env node
// MIT. Complete original Grant Operations procedure prepare/save/export/receive.
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {GrantWorkspaceClient,inspectGrantAgentBinding} from './agent-client.mjs';
import {procedureJSON,procedureCandidates,inspectGrantProcedure,grantProcedureFiles} from './grant_procedures.mjs';
import {readProcedureFile,retainProcedureFile,procedureDirectory,
  prepareGrantProcedureNative,reopenGrantProcedureNative,saveGrantProcedureNative,
  exportGrantProcedureNative,receiveGrantProcedureNative,inspectGrantProcedureDelivery} from './grant_procedures_native.mjs';
export const GRANT_PROCEDURES_HELP = [
 'Grant Operations operating procedures',
 '',
 'grant-procedures list --binding PRIVATE.json --case operation-ID',
 'grant-procedures prepare --binding PRIVATE.json --case operation-ID --plan-json PLAN.json --selection SELECTION.json --out NEW_DIRECTORY',
 'grant-procedures save --binding PRIVATE.json --procedure PROCEDURE.json --request-id ID --operation PRIVATE_DIRECTORY [--resume]',
 'grant-procedures show --binding PRIVATE.json --case operation-ID --source source-ID [--out NEW_DIRECTORY]',
 'grant-procedures export --binding PRIVATE.json --case operation-ID --source source-ID --expected-version N --out NEW_DIRECTORY',
 'grant-procedures inspect --directory COMPLETE_DELIVERY_DIRECTORY',
 'grant-procedures receive --binding PRIVATE.json --directory COMPLETE_DELIVERY_DIRECTORY --request-id ID --operation PRIVATE_DIRECTORY --name NAME --actor ACTOR [--resume]',
 '',
 'The binding is the original GrantWorkspaceClient directory/scenarioFile/pythonExecutable/allowStart/label JSON.',
 'The default borrows the running managed application. Explicit allowStart:true uses its original maintained launcher.',
 'Prepare selection: actor, note?, selectedRevision?, parentSourceId?, sourceIds?, tables?, editions?, stepLinks?.',
 'Tables: {key,origin:"case-plan"} | {key,origin:"case-source",sourceId} | {key,origin:"local-original",file} | {key,origin:"preceding-procedure"}.',
 'Preceding-procedure selects that exact table key from parentSourceId, including its original plan/edition binding.',
 'Editions: {kind:"installation"|"task-outcome",id,revision}. Each chosen version is read from the original case.',
 'Step links: {stepId,sourceIds:[],tableKeys:[],editionKeys:[],note:""}; edition keys are kind:id:revision.',
 'Save and receive retain their exact original request before dispatch. Use --resume with the same inputs after interruption.',
 'A native case transaction remembers the original request ID. No replacement case is created by a same-ID retry.',
 'Edit the complete operating-plan.json through Command finder or its discover plan CLI; every revision is retained.',
].join('\n');
const fields={
 list:['binding','case'],prepare:['binding','case','plan-json','selection','out'],
 save:['binding','procedure','request-id','operation','resume'],show:['binding','case','source','out'],
 export:['binding','case','source','expected-version','out'],inspect:['directory'],
 receive:['binding','directory','request-id','operation','name','actor','resume'],
};
function options(argv){
 const action=argv[0];if(!action||['help','--help','-h'].includes(action))return {action:'help'};
 if(!fields[action])throw new Error('Choose a declared grant-procedures command.');
 const value={action};
 for(let i=1;i<argv.length;i++){
   const name=argv[i];if(!name.startsWith('--')||!fields[action].includes(name.slice(2)))throw new Error('Unknown option '+name);
   const key=name.slice(2);if(Object.hasOwn(value,key))throw new Error('Duplicate option '+name);
   if(key==='resume')value[key]=true;
   else {if(i+1>=argv.length||argv[i+1].startsWith('--'))throw new Error('Supply '+name);value[key]=argv[++i];}
 }
 for(const key of fields[action].filter(x=>x!=='resume'&&!(action==='show'&&x==='out')))if(!value[key])throw new Error('Supply --'+key);
 return value;
}
const text=raw=>new TextDecoder('utf-8',{fatal:true}).decode(raw);
const readText=async path=>text(await readProcedureFile(resolve(path)));
const readJSON=async path=>JSON.parse(await readText(path));
function exactSelection(value){
 const allowed=['actor','note','selectedRevision','parentSourceId','sourceIds','tables','editions','stepLinks'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('Use the complete documented procedure selection.');
 if(typeof value.actor!=='string'||!value.actor.trim())throw new Error('Name the recording operator.');
 return value;
}
export async function mainGrantProcedures(argv=process.argv.slice(2),{emit=value=>process.stdout.write(procedureJSON(value))}={}) {
 const o=options(argv);if(o.action==='help'){emit({help:GRANT_PROCEDURES_HELP});return;}
 if(o.action==='inspect'){const result=await inspectGrantProcedureDelivery(resolve(o.directory));emit(result);return result;}
 const binding=await inspectGrantAgentBinding(await readJSON(o.binding)),client=new GrantWorkspaceClient(binding);
 let primaryError=null;
 try{
  await client.open({expectedSelectionSha256:binding.selectionSha256});
  let result;
  if(o.action==='list'){
    const current=(await client.read('case',{caseId:o.case})).value;
    result={caseId:current.program.id,caseVersion:current.program.version,procedures:procedureCandidates(current)};
  }else if(o.action==='prepare'){
    const selection=exactSelection(await readJSON(o.selection)),tables=[];
    for(const row of selection.tables||[]){
      if(row.origin==='local-original'){
        if(Object.keys(row).some(k=>!['key','origin','file'].includes(k))||typeof row.file!=='string')throw new Error('Select the complete original local table file.');
        tables.push({key:row.key,origin:row.origin,originalText:await readText(row.file)});
      }else{
        if(Object.keys(row).some(k=>!['key','origin','sourceId'].includes(k)))throw new Error('Unknown native table selection field.');
        tables.push(row);
      }
    }
    const prepared=await prepareGrantProcedureNative(client,{...selection,tables,caseId:o.case,
      operatingPlanText:await readText(o['plan-json']),editionId:'procedure-'+randomUUID().replaceAll('-','')});
    const out=await procedureDirectory(resolve(o.out),{create:true});
    await retainProcedureFile(join(out,'grant-procedure.json'),Buffer.from(prepared.raw));
    await retainProcedureFile(join(out,'prepare-receipt.json'),Buffer.from(procedureJSON({
      schema:'stellar-forge.sf47-grant-procedure.v1.prepared',caseId:o.case,caseVersion:prepared.document.case.version,
      editionId:prepared.document.editionId,bytes:prepared.bytes,sha256:prepared.sha256,
      verification:prepared.verification,caseReturn:prepared.caseReturn,afterReturn:prepared.afterReturn})));
    result={directory:out,file:join(out,'grant-procedure.json'),caseId:o.case,caseVersion:prepared.document.case.version,
      editionId:prepared.document.editionId,sha256:prepared.sha256,summary:prepared.summary};
  }else if(o.action==='save'){
    result=await saveGrantProcedureNative(client,{prepared:await readText(o.procedure),requestId:o['request-id'],
      operationDirectory:resolve(o.operation),workspaceDirectory:binding.directory,resume:o.resume===true},{emit});
  }else if(o.action==='show'){
    const reopened=await reopenGrantProcedureNative(client,{caseId:o.case,sourceId:o.source});
    if(o.out){
      const out=await procedureDirectory(resolve(o.out),{create:true}),files=await grantProcedureFiles(reopened.raw,reopened.verification);
      for(const [name,body] of Object.entries(files))await retainProcedureFile(join(out,name),Buffer.from(body));
    }
    result={metadata:reopened.metadata,document:reopened.document,verification:reopened.verification};
  }else if(o.action==='export'){
    if(!/^[1-9][0-9]*$/.test(o['expected-version']))throw new Error('Use a positive native case version.');
    result=await exportGrantProcedureNative(client,{caseId:o.case,sourceId:o.source,expectedVersion:Number(o['expected-version']),directory:resolve(o.out)});
  }else if(o.action==='receive'){
    result=await receiveGrantProcedureNative(client,{directory:resolve(o.directory),operationDirectory:resolve(o.operation),
      workspaceDirectory:binding.directory,requestId:o['request-id'],name:o.name,actor:o.actor,resume:o.resume===true},{emit});
  }
  emit(result);return result;
 }catch(e){primaryError=e;throw e;}
 finally{
  try{const closed=await client.close();emit({event:'GRANT_PROCEDURES_CONNECTION_CLOSED',result:closed});}
  catch(e){emit({event:'GRANT_PROCEDURES_CLOSE_FAILED',code:e.code??null,message:e.message});if(!primaryError)throw e;}
 }
}
if(process.argv[1]&&await realpath(resolve(process.argv[1])).then(p=>pathToFileURL(p).href===import.meta.url,()=>false))
 mainGrantProcedures().catch(error=>{process.stderr.write(procedureJSON({error:{code:error.code??null,message:error.message,
  uncertain:error.uncertain??null,requestId:error.requestId??null}}));process.exitCode=1;});

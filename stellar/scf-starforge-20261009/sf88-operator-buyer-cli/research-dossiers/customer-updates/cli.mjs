#!/usr/bin/env node
// MIT. Complete original customer-update CLI and retained customer handover.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {readResearchHostFile} from '../workspace-files.mjs';
import {parseJson,jsonBytes,digest,writeBytes,exists} from '../../node/store.mjs';
import {CUSTOMER_UPDATE_LIMIT,requireCustomerUpdate as need} from './contracts.mjs';
import {createCustomerHandover,receiveCustomerHandover,submitCustomerUpdate,readCustomerOperation,retainCustomerExport} from './operator.mjs';
import {inspectCustomerHandover,copyCustomerFile} from './files.mjs';
export const CUSTOMER_UPDATE_COMMANDS=Object.freeze(['customer-updates-help','customer-updates','customer-updates-record',
  'customer-updates-preview','customer-updates-save','customer-updates-work','customer-updates-export',
  'customer-updates-handover','customer-updates-inspect','customer-updates-receive','customer-updates-operation',
  'customer-updates-source-plan']);
export const CUSTOMER_UPDATE_USAGE="Research customer updates\n\nUse the existing private listener:\n  research-client COMMAND --connection-file /private/research-url.json [--directory /original/research]\n\nRead and review:\n  customer-updates --id DOSSIER [--project PROJECT --cycle CYCLE --revision N]\n      [--section overview|projects|briefs|agreements|requests|intakes|work|deliveries|delivery-events|operations|records|editions|questions]\n      [--offset N --limit N --query TEXT]\n  customer-updates-record --id DOSSIER --input EXACT_RECORD_SELECTION.json\n  customer-updates-preview --id DOSSIER --input SOURCE_SELECTION.json [--out NEW_JSON]\n  customer-updates-source-plan --input ORIGINAL_EUROPE_PMC_QUERY_SELECTION.json [--out NEW_JSON]\n  customer-updates-save --id DOSSIER --input COMPLETE_REQUEST.json --run-directory /private/original-request\n  customer-updates-save --id DOSSIER --run-directory /private/original-request\n  customer-updates-work --id DOSSIER --work WORK [--revision N --section overview|changes|sources|records|intakes|editions|uncovered-plans --offset N --limit N]\n\nDownload exact saved output:\n  customer-updates-export --id DOSSIER --delivery DELIVERY --format json|md|html|csv|portable|portable.gz\n      --run-directory /private/original-export [--revision N --sha256 SHA256 --out NEW_FILE]\n  customer-updates-export --id DOSSIER --work WORK --format json --run-directory /private/original-export [--out NEW_FILE]\n\nComplete customer delivery:\n  customer-updates-handover --id DOSSIER --delivery DELIVERY --out /private/customer-handover\n      [--revision N --source-workspace ORIGINAL_EXPORT_SELECTION.json]\n  customer-updates-inspect --source-directory /private/customer-handover [--manifest-sha256 SHA256]\n  customer-updates-receive --source-directory /private/customer-handover --manifest-sha256 SHA256\n      --run-directory /private/original-receiving [--source-actor OPERATOR_NAME]\n  customer-updates-receive --run-directory /private/original-receiving\n  customer-updates-operation --run-directory /private/original-request-or-receiving\n\nThe original request JSON has exactly requestId, expectedRevision, actor:{id,name},\naction and data. Preserve the complete original request after a lost reply.\nActions: create-project, revise-brief, record-agreement, request-update,\nrevise-request, attach-intake, review-work, publish-delivery, record-delivery,\nset-project-status. CUSTOMER_UPDATES.md and client.d.mts give every action body.\n\nWork preview pins projectId, cycleId, requestEditionId and selection:{intakeIds,records}.\nNative records keep original JSON-pointer path and sha256. Copy the returned\nrevision and fingerprint into the complete review-work request. Later pages keep\nthat revision/fingerprint. Original source, eligibility, extraction, appraisal and\nsynthesis operations remain in the existing Research tools.\n\nHandover contains all four complete frozen reports, the original work review,\nand the full original portable dossier through that delivery. An optional source\nworkspace file contains {library,actor,requestId} for the original Europe PMC\nexport: its complete original query/acquisition workspace then travels alongside.\nReceiving uses the original dossier/EPMC readers, retains complete source files\nbefore writing, and continues the same project. Source-actor is required only for\nreceiving the optional original Europe PMC workspace.\n\nA saved command/result can reopen without the original connection or input file.\nAn input file that is still present must retain its original bytes. Operations\nand exports use separate private directories and never replace another selection.\nClosing this CLI drains its own client; the original Research application stays\nwith its existing owner.\n";
const fields={
  'customer-updates':['id','project','cycle','revision','section','offset','limit','query'],
  'customer-updates-record':['id','input','out'],
  'customer-updates-preview':['id','input','out'],
  'customer-updates-source-plan':['input','out'],
  'customer-updates-save':['id','input','run-directory'],
  'customer-updates-work':['id','work','revision','section','offset','limit','out'],
  'customer-updates-export':['id','delivery','work','format','revision','sha256','run-directory','out'],
  'customer-updates-handover':['id','delivery','revision','out','source-workspace'],
  'customer-updates-inspect':['source-directory','manifest-sha256'],
  'customer-updates-receive':['source-directory','manifest-sha256','run-directory','source-actor'],
  'customer-updates-operation':['run-directory'],
};
const number=value=>{if(value===undefined)return undefined;need(/^(0|[1-9][0-9]{0,8})$/.test(value),'CUSTOMER_UPDATE_NUMBER_INVALID');return Number(value);};
async function input(path){need(typeof path==='string','CUSTOMER_UPDATE_INPUT_FILE_REQUIRED');
  return parseJson(await readResearchHostFile(resolve(path),CUSTOMER_UPDATE_LIMIT));}
async function output(path,value){
  const bytes=jsonBytes(value),file=resolve(path);
  if(await exists(file)){
    const original=await readResearchHostFile(file,Math.max(bytes.length,1));
    need(original.equals(bytes),'CUSTOMER_UPDATE_OUTPUT_FILE_CHANGED');
  }else await writeBytes(file,bytes,{exclusive:true});
  return {file,bytes:bytes.length,sha256:digest(bytes)};
}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout}={}){
  const [command,...args]=argv;
  if(!command||command==='customer-updates-help'||command==='--help'){stdout.write(CUSTOMER_UPDATE_USAGE);return;}
  need(CUSTOMER_UPDATE_COMMANDS.includes(command),'CUSTOMER_UPDATE_COMMAND_INVALID');
  const allowed=[...fields[command],'connection-file','directory'];
  const {values,positionals}=parseArgs({args,strict:true,allowPositionals:false,
    options:Object.fromEntries(allowed.map(key=>[key,{type:'string'}]))});
  need(positionals.length===0,'CUSTOMER_UPDATE_ARGUMENTS_INVALID');
  let client=null;
  if(values['connection-file'])client=ResearchWorkspaceClient.fromFile(resolve(values['connection-file']),
    values.directory?{directory:resolve(values.directory)}:{});
  const requireClient=()=>{need(client,'CUSTOMER_UPDATE_CONNECTION_FILE_REQUIRED');return client;};
  const common={revision:number(values.revision),section:values.section,offset:number(values.offset),limit:number(values.limit)};
  let result;
  try{
    switch(command){
      case 'customer-updates':
        result=await requireClient().customerUpdates().list(values.id,{...common,projectId:values.project,cycleId:values.cycle,query:values.query});break;
      case 'customer-updates-record':
        result=await requireClient().customerUpdates().record(values.id,await input(values.input));break;
      case 'customer-updates-preview':
        result=await requireClient().customerUpdates().preview(values.id,await input(values.input));break;
      case 'customer-updates-source-plan':
        result=await requireClient().customerUpdates().europePmcPlan(await input(values.input));break;
      case 'customer-updates-save':
        need(values['run-directory'],'CUSTOMER_UPDATE_RUN_DIRECTORY_REQUIRED');
        result=await submitCustomerUpdate({client,directory:resolve(values['run-directory']),dossierId:values.id,inputFile:values.input});break;
      case 'customer-updates-work':
        result=await requireClient().customerUpdates().work(values.id,{...common,workId:values.work});break;
      case 'customer-updates-export':
        need(values['run-directory'],'CUSTOMER_UPDATE_RUN_DIRECTORY_REQUIRED');
        result=await retainCustomerExport({client,directory:resolve(values['run-directory']),dossierId:values.id,
          deliveryId:values.delivery,workId:values.work,revision:number(values.revision),format:values.format??'json',expectedSha256:values.sha256});
        if(values.out)result={...result,published:await copyCustomerFile(result.file.path,resolve(values.out),
          {sha256:result.file.sha256,bytes:result.file.bytes})};break;
      case 'customer-updates-handover':
        need(values.out,'CUSTOMER_UPDATE_OUTPUT_DIRECTORY_REQUIRED');
        result=await createCustomerHandover({client,directory:resolve(values.out),dossierId:values.id,deliveryId:values.delivery,
          revision:number(values.revision),sourceWorkspace:values['source-workspace']?await input(values['source-workspace']):undefined});break;
      case 'customer-updates-inspect':
        need(values['source-directory'],'CUSTOMER_UPDATE_HANDOVER_SOURCE_REQUIRED');
        result=await inspectCustomerHandover(resolve(values['source-directory']),{manifestSha256:values['manifest-sha256']});break;
      case 'customer-updates-receive':
        need(values['run-directory'],'CUSTOMER_UPDATE_RUN_DIRECTORY_REQUIRED');
        result=await receiveCustomerHandover({client,directory:resolve(values['run-directory']),sourceDirectory:values['source-directory'],
          manifestSha256:values['manifest-sha256'],sourceActor:values['source-actor']});break;
      case 'customer-updates-operation':
        need(values['run-directory'],'CUSTOMER_UPDATE_RUN_DIRECTORY_REQUIRED');
        result=await readCustomerOperation(resolve(values['run-directory']));break;
    }
    if(values.out&&['customer-updates-record','customer-updates-preview','customer-updates-source-plan','customer-updates-work'].includes(command))
      result={result,published:await output(values.out,result)};
    stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await client?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'CUSTOMER_UPDATE_COMMAND_FAILED',
    ...(error.outcomeUnknown?{outcomeUnknown:true}:{})})+'\n');process.exitCode=1;});

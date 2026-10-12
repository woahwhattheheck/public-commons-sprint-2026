#!/usr/bin/env node
// MIT. Operate complete report selection, frozen exports, receiving and original history.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { MerchantWorkflowReportClient, readWorkflowReportFile, writeWorkflowReportExports,
  reopenWorkflowReportExports } from './workflow-report-client.mjs';
import { writeOpenApiWorkflowFile } from './openapi-workflow-client.mjs';
import { fail } from './records.mjs';

const HELP=[
  'starforge merchant-workflow-reports COMMAND [options]',
  '',
  'Saved source: host, profiles, profile, list, run, history',
  'Reports: build, capture, inspect, export, review, receive, reopen',
  '',
  '--url URL             Original http://127.0.0.1:PORT/operator/ Console',
  '--token-env NAME      Existing bearer-token environment variable; default MCP_ACCESS_TOKEN',
  '--profile ID          Original profile for profile or list',
  '--run ID              Actual saved run for run, history, build or capture',
  '--baseline ID         Optional different run of the same workflow',
  '--input FILE          Complete original report JSON for inspect/export/review/receive',
  '--directory PATH      Complete private report directory',
  '--output FILE         Retain the complete result using the original atomic writer',
  '--expected-sha256 SHA Optional exact report digest for receive',
  '',
  'list shows saved workflow definitions and runs in the selected profile.',
  'build requires --output and saves the complete original report JSON.',
  'capture requires --directory and writes report.json, report.html, steps.csv and',
  'changes.csv. A retry reopens its first saved report and finishes missing formats.',
  'Use a new directory to capture later native work or a different run selection.',
  '',
  'export renders all four formats from --input into --directory offline.',
  'inspect reads the original JSON. reopen verifies all four saved formats offline.',
  'review and receive accept exactly one of --input or --directory. receive reviews',
  'the same selected packet, imports through the existing Console merge, and reads',
  'back its original profile and runs. Repeat the same packet after a lost response.',
  'history reopens the current original run records without receiving a file.',
  '',
  'Online commands use the existing Console URL and token environment. Offline',
  'inspect/export/reopen need only their original file or directory. Output files',
  'use existing private parent directories; capture/export can create a private',
  'report directory. Identical completed file retries reopen their saved bytes.',
  ''
].join('\n');
const connection=['url','token-env','output'];
const allowed={
  host:connection,profiles:connection,profile:[...connection,'profile'],list:[...connection,'profile'],
  run:[...connection,'run'],history:[...connection,'run','baseline'],build:[...connection,'run','baseline'],
  capture:[...connection,'run','baseline','directory'],inspect:['input','output'],
  export:['input','directory','output'],review:[...connection,'input','directory'],
  receive:[...connection,'input','directory','expected-sha256'],reopen:['directory','output']
};
const need=(value,message)=>{if(!value)throw fail('CONSOLE_REPORT_COMMAND',message,400);};
const selection=values=>({runId:values.run,baselineRunId:values.baseline??null});
export function workflowReportSummary(packet) {
  return {schema:packet.schema,selection:packet.selection,profile:packet.report.profile,
    current:packet.report.current,baseline:packet.report.baseline,changes:packet.report.changes,
    source:packet.report.source,contentSha256:packet.contentSha256};
}
function exportSummary(value) {
  return {state:value.state,directory:value.directory,profileId:value.profileId,
    selection:value.selection,contentSha256:value.contentSha256,archiveSha256:value.archiveSha256,
    files:value.files,report:workflowReportSummary(value.packet)};
}
function historySummary(value) {
  const run=row=>row?{id:row.id,profileId:row.profileId,workflowId:row.workflowId,
    workflowRevision:row.workflowRevision,revision:row.revision,state:row.state,
    ownerWorkspaceId:row.ownerWorkspaceId}:null;
  return {selection:value.selection,profile:value.profile.profile,run:run(value.run),baseline:run(value.baseline)};
}
async function selectedPacket(values) {
  need(Boolean(values.input)!==Boolean(values.directory),'Select exactly one --input report JSON or --directory of complete report exports.');
  return values.input?readWorkflowReportFile(values.input):(await reopenWorkflowReportExports({directory:values.directory})).packet;
}
export async function main(args=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{
    url:{type:'string'},'token-env':{type:'string'},profile:{type:'string'},run:{type:'string'},
    baseline:{type:'string'},input:{type:'string'},directory:{type:'string'},output:{type:'string'},
    'expected-sha256':{type:'string'},help:{type:'boolean',default:false}
  }});
  if(values.help){process.stdout.write(HELP);return;}
  const command=positionals[0];
  need(positionals.length===1&&Object.hasOwn(allowed,command),'Choose one report command; use --help for the complete operating flow.');
  for(const name of Object.keys(values))if(name!=='help')
    need(allowed[command].includes(name),'Option --'+name+' does not belong to '+command+'.');
  if(command==='build')need(values.output,'Retain the complete original report with --output.');
  if(['capture','export','reopen'].includes(command))need(values.directory,'Select the complete report --directory.');
  const offline=['inspect','export','reopen'].includes(command);
  const client=offline?null:new MerchantWorkflowReportClient({url:values.url,tokenEnv:values['token-env']??'MCP_ACCESS_TOKEN'});
  let result,display;
  try{
    switch(command){
      case 'host':result=await client.host();break;
      case 'profiles':result=await client.profiles();break;
      case 'profile':result=await client.profile(values.profile);break;
      case 'list':result=await client.workflows(values.profile);break;
      case 'run':result=await client.run(values.run);break;
      case 'history':result=await client.history(selection(values));display=historySummary(result);break;
      case 'build':result=await client.build(selection(values));display=workflowReportSummary(result);break;
      case 'capture':result=await client.capture({...selection(values),directory:values.directory});display=exportSummary(result);break;
      case 'inspect':result=await readWorkflowReportFile(values.input);display=workflowReportSummary(result);break;
      case 'export':result=await writeWorkflowReportExports({directory:values.directory,packet:await readWorkflowReportFile(values.input)});
        display=exportSummary(result);break;
      case 'reopen':result=await reopenWorkflowReportExports({directory:values.directory});display=exportSummary(result);break;
      case 'review':result=await client.review(await selectedPacket(values));break;
      case 'receive':{
        result=await client.receive(await selectedPacket(values),{
          ...(values['expected-sha256']===undefined?{}:{expectedContentSha256:values['expected-sha256']})
        });
        display={review:{contentSha256:result.review.contentSha256,archiveSha256:result.review.archiveSha256,
          currentWorkspaceId:result.review.currentWorkspaceId},received:result.received,history:historySummary(result.history)};
        break;
      }
    }
    if(values.output){
      const file=await writeOpenApiWorkflowFile(values.output,
        ['build','inspect'].includes(command)?JSON.stringify(result)+'\n':result);
      process.stdout.write(JSON.stringify({file,...(command==='build'?{report:display}:{})},null,2)+'\n');
    }else process.stdout.write(JSON.stringify(display??result,null,2)+'\n');
    return result;
  }finally{client?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(error=>{
    process.stderr.write(JSON.stringify({code:error.code??'CONSOLE_REPORT_ERROR',reason:error.message,
      ...(error.outcomeUnknown?{outcomeUnknown:true}:{}),
      ...(error.receivingCompleted?{receivingCompleted:true,received:error.received}:{})})+'\n');
    process.exitCode=1;
  });

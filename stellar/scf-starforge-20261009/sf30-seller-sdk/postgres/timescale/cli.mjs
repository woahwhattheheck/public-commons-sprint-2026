#!/usr/bin/env node
// MIT. Complete Timescale command line over the original retained workspace.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTimescaleWorkspace } from './model.mjs';
import { startTimescaleWorkspaceServer } from './server.mjs';
import { exportTimescaleWorkspace, inspectTimescalePackage, receiveTimescaleWorkspace } from './package.mjs';
import { readJson, identity, fault } from '../publisher/files.mjs';
const USAGE=`Timescale operations and original PostgreSQL dataset publisher
  init --directory DIR --source SOURCE.json --target TARGET [--maintenance-source ADMIN.json]
  serve --directory DIR [--port 8446] [--seller HTTPS_ORIGIN --resource ROUTE_ID]
  status --directory DIR [--offset 0 --limit 25]
  capture | review | refresh-plan | refresh | verify | job-plan | job-apply | select | extract
      --directory DIR --input REQUEST.json
  edition | operation | plan --directory DIR --id UUID
  compare --directory DIR --before UUID --after UUID
  export --directory DIR --input REQUEST.json
  work-list | work-sources --directory DIR [--offset 0 --limit 25]
  work-item | work-context | work-report --directory DIR --id UUID [--edition UUID]
  work-command --directory DIR --input REQUEST.json
  work-report --directory DIR --id UUID --format html > work-report.html
  commissioning-list --directory DIR [--offset 0 --limit 25 --query TEXT --status OPEN]
  commissioning-item | commissioning-context | commissioning-reports --directory DIR --id UUID [--kind KIND]
  commissioning-intake --directory DIR --id UUID [--format original]
  commissioning-source --directory DIR --id UUID --source-id UUID [--format original]
  commissioning-comparison --directory DIR --id UUID --comparison UUID [--offset 0 --limit 25]
  commissioning-command | commissioning-report --directory DIR --input REQUEST.json
  commissioning-report-file --directory DIR --id ORIGINAL_REPORT_REQUEST_UUID --format json|html
  inspect-package --package DIR [--digest SHA256]
  receive --input REQUEST.json

Mutation inputs retain one caller-generated requestId UUID and optional expectedVersion
from status. Repeating a UUID preserves its original input and outcome. Use --input -
for JSON on stdin. Source and maintenance declarations use the existing private
PostgreSQL environment references. Complete request shapes and receiving are in README.md.
`;
function options(argv){
  const command=argv.shift()??'help',values={};
  while(argv.length){
    const key=argv.shift();if(!/^--[a-z][a-z-]*$/.test(key)||Object.hasOwn(values,key.slice(2)))throw fault('CLI_ARGUMENT_INVALID');
    const value=argv.shift();if(value===undefined||value.startsWith('--'))throw fault('CLI_VALUE_REQUIRED');
    values[key.slice(2)]=value;
  }
  return {command,values};
}
async function input(value){
  if(!value)throw fault('CLI_INPUT_REQUIRED','Choose the complete original request JSON file.');
  if(value!=='-')return readJson(resolve(value),8388608);
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>8388608)throw fault('CLI_INPUT_TOO_LARGE');chunks.push(chunk);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
function required(options,name){if(!options[name])throw fault('CLI_ARGUMENT_REQUIRED','Provide --'+name+'.');return options[name];}
async function main(argv=process.argv.slice(2)){
  const {command,values:v}=options([...argv]);
  const allowed=['directory','source','target','maintenance-source','title','seller','resource','port','offset','limit','input','id','before','after','package','digest','edition','format','status','owner','query','source-id','comparison','kind'];
  if(Object.keys(v).some(k=>!allowed.includes(k)))throw fault('CLI_ARGUMENT_INVALID');
  if(command==='help'){process.stdout.write(USAGE);return;}
  const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
  if(command==='inspect-package'){const result=await inspectTimescalePackage(resolve(required(v,'package')),v.digest);print(result);return result;}
  if(command==='receive'){const result=await receiveTimescaleWorkspace(await input(v.input));print(result);return result;}
  const methods={capture:'startCapture',review:'saveReview','refresh-plan':'prepareRefresh',refresh:'startRefresh',verify:'startVerification',
    'job-plan':'prepareJob','job-apply':'applyJob',select:'selectAggregate',extract:'startPublicationExtraction'};
  if(!['init','serve','status','edition','operation','plan','compare','export','work-list','work-sources','work-item','work-context','work-command','work-report','commissioning-list','commissioning-item','commissioning-context','commissioning-intake',
    'commissioning-source','commissioning-comparison','commissioning-reports','commissioning-command','commissioning-report','commissioning-report-file',...Object.keys(methods)].includes(command))throw fault('CLI_COMMAND_INVALID',USAGE);
  const workspace=await openTimescaleWorkspace({directory:resolve(required(v,'directory')),create:command==='init',
    ...(v.source?{sourceFile:resolve(v.source)}:{}),...(v.target?{targetDirectory:resolve(v.target)}:{}),
    ...(v['maintenance-source']?{maintenanceSourceFile:resolve(v['maintenance-source'])}:{}),
    ...(v.title?{title:v.title}:{}),...(v.seller?{seller:v.seller}:{}),...(v.resource?{resource:v.resource}:{})});
  let listener;
  const stop=()=>{const active=workspace.status().active;if(active)workspace.cancel(active.id);};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    let result;
    if(command==='serve'){
      listener=await startTimescaleWorkspaceServer({workspace,port:v.port===undefined?8446:Number(v.port)});
      print({schema:'stellar-forge.timescale-listener.v1',url:listener.url,directory:workspace.directory});
      await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});return;
    }
    if(command==='init'||command==='status')result=workspace.status({limit:v.limit===undefined?25:Number(v.limit),offset:v.offset===undefined?0:Number(v.offset)});
    else if(command==='edition')result=await workspace.edition(required(v,'id'));
    else if(command==='operation')result=workspace.operation(required(v,'id'));
    else if(command==='plan')result=workspace.getPlan(required(v,'id'));
    else if(command==='compare'){const comparison=await workspace.comparison(required(v,'before'),required(v,'after'));result={...comparison,digest:identity(comparison)};}
    else if(command==='work-list')result=workspace.remediation.list({offset:v.offset===undefined?0:Number(v.offset),limit:v.limit===undefined?25:Number(v.limit),
      ...(v.status?{status:v.status}:{}),...(v.owner?{owner:v.owner}:{}),...(v.query?{q:v.query}:{})});
    else if(command==='work-sources')result=await workspace.remediation.sources({offset:v.offset===undefined?0:Number(v.offset),limit:v.limit===undefined?25:Number(v.limit)});
    else if(command==='work-item')result=await workspace.remediation.item(required(v,'id'));
    else if(command==='work-context')result=await workspace.remediation.context(required(v,'id'),{offset:v.offset===undefined?0:Number(v.offset),limit:v.limit===undefined?25:Number(v.limit),
      ...(v.edition?{editionId:v.edition}:{})});
    else if(command==='work-report'){
      const report=await workspace.remediation.report(required(v,'id'));
      if(v.format==='html'){process.stdout.write(report.html+'\n');return report;}
      if(v.format&&v.format!=='json')throw fault('CLI_FORMAT_INVALID','Choose json or html.');
      result=report.json;
    }else if(command==='commissioning-list')result=workspace.commissioning.list({offset:v.offset===undefined?0:Number(v.offset),limit:v.limit===undefined?25:Number(v.limit),
      ...(v.status?{status:v.status}:{}),...(v.query?{q:v.query}:{})});
    else if(command==='commissioning-reports')result=workspace.commissioning.reports(required(v,'id'),{offset:v.offset===undefined?0:Number(v.offset),limit:v.limit===undefined?25:Number(v.limit)});
    else if(command==='commissioning-item')result=workspace.commissioning.item(required(v,'id'));
    else if(command==='commissioning-context')result=await workspace.commissioning.context(required(v,'id'),{
      offset:v.offset===undefined?0:Number(v.offset),limit:v.limit===undefined?25:Number(v.limit),...(v.kind?{kind:v.kind}:{})});
    else if(command==='commissioning-source'||command==='commissioning-intake'){
      result=command==='commissioning-intake'?await workspace.commissioning.intakeFile(required(v,'id')):
        await workspace.commissioning.source(required(v,'id'),required(v,'source-id'));
      if(v.format==='original'){process.stdout.write(result.original.content);return result;}
      if(v.format&&v.format!=='json')throw fault('CLI_FORMAT_INVALID','Choose json or original.');
    }else if(command==='commissioning-comparison')result=await workspace.commissioning.comparison(required(v,'id'),required(v,'comparison'),{
      offset:v.offset===undefined?0:Number(v.offset),limit:v.limit===undefined?25:Number(v.limit)});
    else if(command==='commissioning-report-file'){
      result=await workspace.commissioning.reportFile(required(v,'id'),v.format??'json');
      process.stdout.write(result.content);return result;
    }else{
      const request=await input(v.input);
      const started=command==='export'?exportTimescaleWorkspace(workspace,request):command==='work-command'?workspace.remediation.command(request):
        command==='commissioning-command'?workspace.commissioning.command(request):command==='commissioning-report'?workspace.commissioning.publishReport(request):workspace[methods[command]](request);
      result=await started.completion;
      if(result.state!=='COMPLETE'||result.kind==='extraction'&&!['READY','REVIEWED','PUBLISHED'].includes(result.data.result?.state))process.exitCode=1;
    }
    print(result);return result;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);if(listener)await listener.close();else await workspace.close();}
}

export { main, USAGE };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(issue => { process.stderr.write(JSON.stringify({error:issue.code??'TIMESCALE_CLI_FAILED',message:issue.code?issue.message:'The original operation did not complete; reopen its saved workspace.'})+'\n'); process.exitCode=1; });
}

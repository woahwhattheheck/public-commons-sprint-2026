#!/usr/bin/env node
// MIT. WordPress source commands retain original workspace and operation identities.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openWordPressWorkspace } from './workspace.mjs';
import { start } from './server.mjs';
import { packet } from './packet.mjs';
import { inspectWordPressLaunchSource } from './managed.mjs';
import { directory, fail } from './config.mjs';
const HELP=`WordPress source operator

  node wordpress/cli.mjs serve --dir /absolute/workspace [--port 0] [--python python3]
  node wordpress/cli.mjs init --dir /absolute/new-workspace
  node wordpress/cli.mjs inspect --dir /absolute/workspace
  node wordpress/cli.mjs act --dir /absolute/workspace --action source.save --input request.json
      --operation <UUID> --expected-revision <integer> [--stay]
  node wordpress/cli.mjs operation --dir /absolute/workspace --id <UUID>
  node wordpress/cli.mjs job --dir /absolute/workspace --source-id <UUID> --id <UUID>
  node wordpress/cli.mjs records --dir /absolute/workspace --source-id <UUID> --id <UUID>
      [--offset 0] [--limit 25] [--collection type:post]
  node wordpress/cli.mjs mapping --dir /absolute/workspace --id <UUID>
  node wordpress/cli.mjs edition --dir /absolute/workspace --id <UUID>
  node wordpress/cli.mjs compare --dir /absolute/workspace --before <UUID> --after <UUID>
      [--offset 0] [--limit 50]
  node wordpress/cli.mjs preview --dir /absolute/workspace --input request.json
  node wordpress/cli.mjs dataset-preview --dir /absolute/workspace --id <UUID> [--query limit=20]
  node wordpress/cli.mjs packet-inspect --input /absolute/source.zip [--python python3]
  node wordpress/cli.mjs receive --input /absolute/source.zip --dir /absolute/new-workspace [--python python3]

Source capture actions wait for their original background job before closing.
A seller started with publisher.release.start needs --stay to retain its owner.
The local browser keeps source captures, seller runtimes and customer sessions together.
Use the same operation UUID and unchanged input to recover an uncertain action result.
`;
function options(args) {
  const values={};
  for(let index=0;index<args.length;index++){
    const key=args[index];
    if(!/^--[a-z][a-z-]*$/.test(key)||Object.hasOwn(values,key))fail('WORDPRESS_CLI_OPTION','Use each named CLI option once.');
    if(key==='--stay'||key==='--help'){values[key]=true;continue;}
    if(index+1===args.length||args[index+1].startsWith('--'))fail('WORDPRESS_CLI_VALUE','Supply the value for '+key+'.');
    values[key]=args[++index];
  }
  return values;
}
function allow(value,keys) {for(const key of Object.keys(value))if(!keys.includes(key))fail('WORDPRESS_CLI_OPTION','Unknown option '+key+'.');}
function required(value,key) {if(typeof value[key]!=='string'||!value[key])fail('WORDPRESS_CLI_REQUIRED','Supply '+key+'.');return value[key];}
function integer(value,key,fallback) {const raw=value[key]??String(fallback);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail('WORDPRESS_CLI_INTEGER','Supply an integer for '+key+'.');return Number(raw);}
async function input(value) {
  const path=resolve(required(value,'--input')),bytes=await readFile(path);
  if(bytes.length>1048576)fail('WORDPRESS_CLI_INPUT','The operator JSON input exceeds one MiB.',413);
  try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}
  catch{fail('WORDPRESS_CLI_INPUT','Use a complete UTF-8 JSON input file.');}
}
const print=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function stay(close) {
  let ending;const stop=()=>{if(!ending)ending=close().then(resolveStopped,rejectStopped);};
  let resolveStopped,rejectStopped;
  const stopped=new Promise((resolve,reject)=>{resolveStopped=resolve;rejectStopped=reject;});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await stopped;}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
export async function main(argv=process.argv.slice(2)) {
  const command=argv[0]??'help',value=options(argv.slice(1));
  if(command==='help'||value['--help']){process.stdout.write(HELP);return;}
  const common=['--dir','--python'];
  if(command==='serve') {
    allow(value,[...common,'--port','--expected-workspace-id','--expected-workspace-identity','--managed-source','--expected-source-sha256']);
    const managedKeys=['--expected-workspace-id','--expected-workspace-identity','--managed-source','--expected-source-sha256'];
    const managed=managedKeys.some(key=>value[key]!==undefined);let source;
    const launchSourceDirectory=resolve(fileURLToPath(new URL('./',import.meta.url)));
    if(managed){
      for(const key of managedKeys)required(value,key);
      source=await inspectWordPressLaunchSource(directory(value['--managed-source']),{expectedSha256:value['--expected-source-sha256']});
      await inspectWordPressLaunchSource(launchSourceDirectory,{expectedSha256:source.sha256});
    }
    const operator=await start({directory:directory(required(value,'--dir')),
      port:integer(value,'--port',0),python:value['--python']??'python3',
      ...(managed?{expectedWorkspaceId:value['--expected-workspace-id'],expectedWorkspaceIdentity:value['--expected-workspace-identity']}:{})});
    print({schema:'stellar-forge.wordpress-workspace-startup.v1',status:'WORDPRESS_OPERATOR_READY',url:operator.url,directory:operator.directory,
      workspaceId:operator.workspaceId,workspaceIdentity:operator.workspaceIdentity,createdAt:operator.createdAt,
      revision:operator.revision,pid:operator.pid,instanceId:operator.instanceId,
      ...(managed?{sourceDirectory:source.directory,launchSourceDirectory,sourceSha256:source.sha256,sourceFiles:source.files}:{})});
    await stay(operator.close);return;
  }
  if(command==='receive'||command==='packet-inspect') {
    allow(value,['--dir','--input','--python']);
    const result=await packet(command==='receive'?'restore':'inspect',{input:resolve(required(value,'--input')),
      ...(command==='receive'?{directory:directory(required(value,'--dir'))}:{}),python:value['--python']??'python3'});
    print(result);return;
  }
  const permitted={
    init:[],inspect:[],act:['--action','--input','--operation','--expected-revision','--stay'],operation:['--id'],
    source:['--id'],job:['--source-id','--id'],records:['--source-id','--id','--offset','--limit','--collection'],
    mapping:['--id'],edition:['--id'],compare:['--before','--after','--offset','--limit'],
    preview:['--input'],'dataset-preview':['--id','--query']
  };
  if(!Object.hasOwn(permitted,command))fail('WORDPRESS_CLI_COMMAND','Choose a command shown by help.');
  allow(value,[...common,...permitted[command]]);
  if(command==='act'&&value['--action']==='publisher.release.start'&&!value['--stay'])
    fail('WORDPRESS_CLI_RELEASE_OWNER','Use --stay or the browser operator to retain the original seller owner.');
  const workspace=await openWordPressWorkspace({directory:directory(required(value,'--dir')),python:value['--python']??'python3'});
  let held=false;
  try{
    let result;
    if(command==='inspect'||command==='init')result=await workspace.inspect();
    else if(command==='act') {
      const action=required(value,'--action');
      result=await workspace.act(action,{operationId:required(value,'--operation'),
        expectedRevision:integer(value,'--expected-revision',NaN),input:await input(value)});
      if(['source.discover','capture.start','capture.resume'].includes(action)&&result.result?.jobId)
        result={...result,job:await workspace.wait(result.result.sourceId,result.result.jobId),state:await workspace.inspect()};
      print(result);
      if(value['--stay']){held=true;await stay(workspace.close);}
      return;
    } else if(command==='operation')result=await workspace.operation(required(value,'--id'));
    else if(command==='source')result=await workspace.source(required(value,'--id'));
    else if(command==='job')result=await workspace.job(required(value,'--source-id'),required(value,'--id'));
    else if(command==='records')result=await workspace.records(required(value,'--source-id'),required(value,'--id'),{
      offset:integer(value,'--offset',0),limit:integer(value,'--limit',25),collection:value['--collection']??null});
    else if(command==='mapping')result=await workspace.mapping(required(value,'--id'));
    else if(command==='edition')result=await workspace.edition(required(value,'--id'));
    else if(command==='compare')result=await workspace.compare(required(value,'--before'),required(value,'--after'),{
      offset:integer(value,'--offset',0),limit:integer(value,'--limit',50)});
    else if(command==='preview')result=await workspace.preview(await input(value));
    else if(command==='dataset-preview')result=await workspace.datasetPreview({editionId:required(value,'--id'),query:value['--query']??''});
    print(result);
  }finally{if(!held)await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'WORDPRESS_CLI_FAILED',message:error.message,details:error.details??null}})+'\n');process.exitCode=1;});

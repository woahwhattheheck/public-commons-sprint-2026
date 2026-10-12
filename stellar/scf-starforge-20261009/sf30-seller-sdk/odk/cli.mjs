// MIT. One data command surface for the original Central workspace and managed listener.
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openCentralWorkspace } from './workspace.mjs';
import { restoreCentralArchive } from './archive.mjs';
import { connectCentralWorkspace, ODK_CONNECTION_FILENAME } from './connection.mjs';
import { digest, fault } from '../odata/state.mjs';

const commands=new Map([
  ['init','state'],['state','state'],['connect','connect'],['projects','projects'],['forms','forms'],
  ['plan','createPlan'],['capture','capture'],['resume','resume'],['pause','pause'],['wait','wait'],
  ['status','edition'],['rows','rows'],['row','row'],['resources','resources'],['quality','quality'],
  ['review','review'],['compare','compare'],['report','report'],['export','exportDataset'],['backup','backup'],
  ['source-file','sourceFile'],['export-file','exportFile'],['release-prepare','prepareRelease'],
  ['release-status','releaseStatus'],['release-activate','activateRelease'],['release-rollback','rollbackRelease'],
  ['publisher-capture','capturePublisher'],['publisher-receive','receivePublisher'],['publisher-transfers','publisherTransfers'],
]);
const keys=new Map([
  ['id','id'],['name','name'],['url','url'],['auth-env','authEnv'],['connection-id','connectionId'],
  ['project-id','projectId'],['form-id','formId'],['plan-id','planId'],['label','label'],['table-id','tableId'],
  ['row-id','rowId'],['after','after'],['limit','limit'],['search','search'],['kind','kind'],
  ['expected-revision','expectedRevision'],['decision','decision'],['note','note'],['reviewer','reviewer'],
  ['left-id','leftId'],['right-id','rightId'],['baseline-id','baselineId'],['report-id','reportId'],
  ['export-id','exportId'],['title','title'],['narrative','narrative'],['origin','origin'],['path','path'],
  ['default-limit','defaultLimit'],['max-limit','maxLimit'],['release-id','releaseId'],['reason','reason'],
  ['expected-generation','expectedGeneration'],['to','to'],['hash','hash'],['archive','archive'],
  ['expected-sha256','expectedSha256'],['page-size','pageSize'],['submitted-from','submittedFrom'],
  ['submitted-before','submittedBefore'],['updated-since','updatedSince'],['snapshot-id','snapshotId'],['max-resident-rows','maxResidentRows'],
]);
const numbers=new Set(['limit','expectedRevision','defaultLimit','maxLimit','expectedGeneration','pageSize','maxResidentRows']);
const collections=new Set(['forms','scope','findings','indicators','payment','runtime','fields']);
export const CENTRAL_CLI_HELP = `ODK Central Field Data

Use the single installed command:
  starforge odk-central-workspace serve --workspace /absolute/private/workspace --operator "Field operations"
  starforge odk-central-workspace <command> --workspace /absolute/private/workspace [options]

Data commands:
  init, state                         Open the original database or read its current state.
  connect --input connection.json     Verify an existing Central user and retain its connection.
  projects --connection-id ID         List accessible projects.
  forms --connection-id ID --project-id ID
  plan --input reporting-plan.json    Save selected source forms and an immutable reporting cohort.
  capture --plan-id ID [--id ID]      Receive all pages, original form generations and submission history.
  resume --id ID                      Continue the same original capture and source cursor.
  pause --id ID                       Pause that capture with its retained progress.
  wait, status, quality --id ID       Read or wait for the selected original edition.
  rows --id ID --table-id ID          Page complete captured rows; --after, --limit, --search.
  row --id ID --table-id ID --row-id ID
  resources --id ID                   Page original XML, form, spreadsheet, media and source receipts.
  review --input review.json          Record the selected edition's current revision and interpretation.
  compare --left-id ID --right-id ID --table-id ID
  report --input report.json          Prepare HTML, editable Markdown, JSON and complete comparison files.
  export --input dataset.json         Export accepted native fields through the original dataset seller.
  backup [--id ID]                    Stream the complete portable workspace to its retained archive.
  restore --archive FILE --expected-sha256 HASH --workspace NEW_DIRECTORY
  source-file --hash HASH             Read the original retained source file descriptor.
  export-file --id ID --path PATH     Read an original report, dataset or archive file descriptor.
  release-prepare --input release.json
  release-status
  release-activate --id ID --expected-generation N --reason TEXT
  release-rollback --to ID --expected-generation N --reason TEXT
  publisher-capture --id ID [--expected-generation N]
  publisher-receive --id ID --snapshot-id ORIGINAL_SNAPSHOT_ID [--max-resident-rows N]
  publisher-transfers                 Read complete original publisher source and receiving records.
  commissioning <command>             Original source agreement, two periods and full customer handover.

Inputs:
  --input FILE                       A UTF-8 JSON object, up to 16 MiB.
  --json JSON                        An explicit JSON object instead of an input file.
  --connection-file FILE             Borrow this exact Applications listener.
  --directory DIR                    Alias for --workspace.
  --id, --report-id, --export-id      Retain the original ID before a repeat or recovery.
  --no-wait                          Return after dispatch when using an existing managed listener.
  --allow-loopback                   Permit HTTP only for an explicitly local Central source.

Complex action fields (--forms, --scope, --findings, --indicators, --payment,
--runtime and --fields) accept JSON. Every original SDK action input is also
available through --input. Connection credentials remain in the named host
environment variable as the complete Authorization header.

Captures wait for completion by default. An existing Applications listener keeps
running when this command exits. A direct command owns its one workspace lease
and closes it after the operation; --no-wait requires a managed listener.
Operation identities are printed before dispatch so an uncertain response can
resume the same original input.
`;
function parseJson(text,label){let value;try{value=JSON.parse(text);}catch{throw fault('CENTRAL_CLI_JSON','Use valid JSON for '+label+'.');}return value;}
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw fault('CENTRAL_CLI_OBJECT','Use an object for '+label+'.');return value;}
function parse(argv){
  if(!Array.isArray(argv)||argv.some(value=>typeof value!=='string'))throw fault('CENTRAL_CLI_ARGUMENTS','Use an argument array.');
  if(!argv.length||argv.includes('--help')||argv[0]==='help')return {help:true};
  const [command,...args]=argv;if(!commands.has(command)&&command!=='restore')throw fault('CENTRAL_CLI_COMMAND','Choose an ODK Central data command. Use --help for the command list.');
  const result={command,input:{},directory:null,connectionFile:null,noWait:false},seen=new Set();
  for(let index=0;index<args.length;index++){
    const argument=args[index];if(!argument.startsWith('--'))throw fault('CENTRAL_CLI_ARGUMENT','Use named command options.');
    const equal=argument.indexOf('='),flag=argument.slice(2,equal<0?undefined:equal);
    if(seen.has(flag))throw fault('CENTRAL_CLI_DUPLICATE','Choose one value for --'+flag+'.');seen.add(flag);
    if(['allow-loopback','no-wait'].includes(flag)){
      if(equal>=0)throw fault('CENTRAL_CLI_FLAG','Use --'+flag+' without a value.');
      if(flag==='no-wait')result.noWait=true;else result.input.allowLoopback=true;continue;
    }
    const value=equal<0?args[++index]:argument.slice(equal+1);
    if(value===undefined||equal<0&&value.startsWith('--'))throw fault('CENTRAL_CLI_VALUE','Supply the value for --'+flag+'.');
    if(['workspace','directory'].includes(flag)){if(result.directory)throw fault('CENTRAL_CLI_DIRECTORY','Choose one original workspace directory.');result.directory=resolve(value);}
    else if(flag==='connection-file')result.connectionFile=resolve(value);
    else if(flag==='input')result.inputFile=resolve(value);
    else if(flag==='json')result.inputJson=value;
    else if(collections.has(flag))result.input[flag]=parseJson(value,'--'+flag);
    else if(keys.has(flag)){const key=keys.get(flag);result.input[key]=numbers.has(key)?Number(value):value;
      if(numbers.has(key)&&(!value.trim()||!Number.isSafeInteger(result.input[key])))throw fault('CENTRAL_CLI_INTEGER','Use an integer for --'+flag+'.');}
    else throw fault('CENTRAL_CLI_OPTION','Unknown ODK Central data option --'+flag+'.');
  }
  if(result.inputFile&&result.inputJson)throw fault('CENTRAL_CLI_INPUT','Choose an input file or inline JSON.');
  return result;
}
async function loadInput(options){
  let original={};
  if(options.inputFile){const info=await lstat(options.inputFile);if(!info.isFile()||info.size>16*1024*1024)throw fault('CENTRAL_CLI_INPUT_SIZE','Choose a regular JSON input file up to 16 MiB.');
    const bytes=await readFile(options.inputFile);if(bytes.length>16*1024*1024)throw fault('CENTRAL_CLI_INPUT_SIZE','The action input exceeds 16 MiB.');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw fault('CENTRAL_CLI_INPUT_UTF8','Use a UTF-8 action input file.');}original=object(parseJson(text,'the input file'),'the action input');}
  else if(options.inputJson)original=object(parseJson(options.inputJson,'--json'),'the action input');
  const duplicate=Object.keys(options.input).find(key=>Object.hasOwn(original,key));
  if(duplicate)throw fault('CENTRAL_CLI_INPUT_DUPLICATE','The input file and command options both supply '+duplicate+'.');
  const input={...original,...options.input};
  if(options.command==='plan'){
    if(Object.hasOwn(input,'projectId')||Object.hasOwn(input,'formId')){
      if(!input.projectId||!input.formId||input.forms)throw fault('CENTRAL_CLI_FORM','Choose one --project-id / --form-id pair or the original forms array.');
      input.forms=[{projectId:input.projectId,formId:input.formId}];delete input.projectId;delete input.formId;
    }
    const names=['pageSize','submittedFrom','submittedBefore','updatedSince'],scope={...input.scope};
    for(const name of names)if(Object.hasOwn(input,name)){if(Object.hasOwn(scope,name))throw fault('CENTRAL_CLI_SCOPE','The cohort scope repeats '+name+'.');scope[name]=input[name];delete input[name];}
    if(Object.keys(scope).length)input.scope=scope;
  }
  if(options.command==='resources'&&typeof input.after==='string'){input.after=Number(input.after);if(!Number.isSafeInteger(input.after)||input.after<0)throw fault('CENTRAL_CLI_CURSOR','Use the original numeric resource cursor.');}
  return input;
}
async function attachment(options){
  const directory=options.directory??(options.connectionFile?resolve(options.connectionFile,'..'):null);
  if(!directory)throw fault('CENTRAL_WORKSPACE_REQUIRED','Choose --workspace or the original --connection-file.');
  const path=options.connectionFile??join(directory,ODK_CONNECTION_FILENAME);
  let present=false;try{await lstat(path);present=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(present){
    try{return {client:await connectCentralWorkspace({connectionFile:path,directory}),owned:false,directory};}
    catch(error){if(options.connectionFile||error.code!=='ODK_CONNECTION_UNAVAILABLE')throw error;
      // This failed read has dispatched no mutation. The original kernel lease
      // decides whether a direct owner may reopen a stopped host.
    }
  }else if(options.connectionFile)throw fault('CENTRAL_CONNECTION_MISSING','Reopen the selected original Applications connection.',404);
  return {client:await openCentralWorkspace({directory}),owned:true,directory};
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForCapture(client,id,signal){
  while(true){
    signal.throwIfAborted();
    const value=await client.edition({id},{signal});
    if(value.status!=='CAPTURING')return value;
    await pause(1500);
  }
}
function retainIdentity(method,input){
  const key=method==='report'?'reportId':method==='exportDataset'?'exportId':['connect','createPlan','capture','backup','capturePublisher','receivePublisher'].includes(method)?'id':null;
  if(key&&!input[key])input[key]=randomUUID();
  return key?input[key]:input.releaseId??input.id??null;
}
function receipt(value){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
/** argv excludes node and script. Managed.mjs owns all hosting options and delegates here. */
export async function runCentralCli(argv=process.argv.slice(2)){
  if(argv[0]==='commissioning')return (await import('./commissioning/cli.mjs')).runCommissioningCli(argv.slice(1));
  const options=parse(argv);if(options.help){process.stdout.write(CENTRAL_CLI_HELP);return null;}
  const input=await loadInput(options);
  if(options.command==='restore'){
    const directory=options.directory??input.directory;
    const result=await restoreCentralArchive({...input,directory});receipt(result);return result;
  }
  const method=commands.get(options.command),operationId=retainIdentity(method,input),controller=new AbortController();
  const selected=await attachment(options),client=selected.client;let activeCapture=null;
  const onSignal=()=>{
    controller.abort(Object.assign(new Error('The command was interrupted; reopen its original operation.'),{code:'CENTRAL_CLI_INTERRUPTED'}));
    if(selected.owned&&activeCapture)void Promise.resolve(client.pause({id:activeCapture})).catch(()=>{});
  };
  process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  try{
    if(options.noWait&&selected.owned)throw fault('CENTRAL_CLI_MANAGED_REQUIRED','Use --no-wait with the existing managed Applications listener.');
    if(operationId)process.stderr.write(JSON.stringify({schema:'stellar-forge.odk-cli-operation.v1',method,operationId,workspace:selected.directory,inputFile:options.inputFile??null,inputSha256:digest(JSON.stringify(input))})+'\n');
    if(['capture','resume','wait'].includes(method))activeCapture=input.id;
    let result=await client[method==='wait'?'edition':method](input,{signal:controller.signal});
    if(['capture','resume','wait'].includes(method)&&!options.noWait){
      activeCapture=input.id??result.id;
      result=selected.owned?await client.wait({id:activeCapture}):await waitForCapture(client,activeCapture,controller.signal);
    }
    receipt(result);
    if(result?.status==='FAILED'){process.exitCode=1;process.stderr.write(JSON.stringify({code:result.error?.code??'CENTRAL_CAPTURE_FAILED',
      message:result.error?.message??'Resume the retained capture after correcting its source response.',operationId:result.id})+'\n');}
    if(controller.signal.aborted)process.exitCode=130;
    return result;
  }finally{process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);await client.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  runCentralCli().catch(error=>{process.stderr.write(JSON.stringify({code:error.code||'CENTRAL_CLI',message:error.message,
    ...(error.operationId?{operationId:error.operationId}:{}),...(error.details?{details:error.details}:{})})+'\n');process.exitCode=1;});

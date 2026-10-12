#!/usr/bin/env node
// MIT. Complete local field-desk operating commands, with explicit retained write intents.
import { readFileSync,openSync,writeFileSync,fsyncSync,closeSync,mkdirSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace } from './workspace.mjs';
import { serveFieldDesk } from './server.mjs';
import { parseJson,fail,MAX_PACKAGE_BYTES } from '../gis/shared.mjs';

const help=String.raw`Field desk — original dispatch → crew visit → partial return → supervisor → destination package

node cli.mjs init --workspace /absolute/new/field
node cli.mjs serve --workspace /absolute/field --port 8770
node cli.mjs status --workspace /absolute/field
node cli.mjs inspect-source --input /original/follow-through-workspace.json [--dispatch ID]
node cli.mjs import --workspace DIR --input FILE --name NAME [--dispatch ID] WRITE
node cli.mjs crew-save --workspace DIR --input crew.json WRITE
node cli.mjs visit-save --workspace DIR --input visit.json WRITE
node cli.mjs attach --workspace DIR --file photo.jpg --content-type image/jpeg WRITE
node cli.mjs package --workspace DIR --input package-selection.json WRITE
node cli.mjs return-import --workspace DIR --input returned.json [--name NAME] WRITE
node cli.mjs decide --workspace DIR --input supervisor-decisions.json WRITE
node cli.mjs review --workspace DIR --input visit-review.json WRITE
node cli.mjs update --workspace DIR --input destination-selection.json WRITE
node cli.mjs receive --workspace /absolute/new/field --input workspace.json WRITE

WRITE: --request-id STABLE-ID --expected-revision N
Reuse the same request ID and original input after an uncertain return. A stale revision
must be reviewed before preparing a different action; completed intents replay exactly.

Reads:
  source --id ID; source-rows --source ID [--q TEXT --offset N --limit N]
  crew --id ID; visit --id ID; visits [--source ID --crew ID --status STATUS --q TEXT]
  package-info --id ID; return-info --id ID; update-info --id ID
  operation --request-id ID; attachment --id ID --out /new/file

Exports:
  export --kind workspace --out /new/editable-field-workspace.json
  export --kind source --source ID --out /new/original-dispatch.json
  export --kind crew-json|crew-html --package ID --out /new/crew-file
  export --kind returned --return ID --out /new/original-return.json
  export --kind visits-csv [--source ID --crew ID --status STATUS] --out /new/visits.csv
  export --kind update-json|update-csv|update-geojson|update-report --update ID --out /new/file

Read and write JSON files use the public HTTP/core DTOs. crew-save and visit-save accept
either the bare crew/visit object or its named wrapper. Other action files contain their
named selection fields. Exact decimals are strings. Output files are created privately;
an existing output is never overwritten. A complete crew editor works without a server
and returns the original package identity plus only the selected changed visits.
`;
function args(argv){
  const options={},positionals=[];
  for(let index=0;index<argv.length;index++){
    const value=argv[index];if(!value.startsWith('--')){positionals.push(value);continue;}
    const key=value.slice(2);
    if(Object.hasOwn(options,key))fail('DUPLICATE_OPTION','Specify --'+key+' once.');
    if(key==='help'){options.help=true;continue;}
    if(index+1>=argv.length||argv[index+1].startsWith('--'))fail('OPTION_VALUE_REQUIRED','Supply a value after --'+key+'.');
    options[key]=argv[++index];
  }
  if(positionals.length>1)fail('UNEXPECTED_ARGUMENT','Use one field-desk command.');
  const allowed=new Set(['help','workspace','input','name','dispatch','request-id','expected-revision','file','content-type','id','source','crew','status','q','offset','limit','kind','package','return','update','out','port','host','expected-workspace-id','expected-binding-sha256']);
  for(const key of Object.keys(options))if(!allowed.has(key))fail('UNKNOWN_OPTION','Unknown field-desk option --'+key+'.');
  return {command:positionals[0]??'help',options};
}
function originalFile(path){
  if(!path)fail('INPUT_REQUIRED','Select the complete original file with --input or --file.');
  const bytes=readFileSync(resolve(path));if(bytes.length>MAX_PACKAGE_BYTES)fail('FILE_SIZE','The complete input exceeds 256 MiB.',413);
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8','The original JSON input is not valid UTF-8.');}
}
function jsonInput(path){return parseJson(originalFile(path),'Field action file');}
function integer(value,name){
  const result=Number(value);if(value===undefined||!Number.isSafeInteger(result)||result<0)fail('INVALID_INTEGER',name+' must be a nonnegative integer.');return result;
}
function writeControl(options,input={}){
  const requestId=options['request-id']??input.requestId,expectedRevision=options['expected-revision']===undefined?input.expectedRevision:integer(options['expected-revision'],'Expected revision');
  if(typeof requestId!=='string'||!requestId.trim()||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('WRITE_INTENT_REQUIRED','Supply a stable --request-id and the observed --expected-revision, or retain both in the action JSON.');
  return {...input,requestId,expectedRevision};
}
function saveFile(path,file){
  if(!path)fail('OUTPUT_REQUIRED','Choose a new private output file with --out.');
  const destination=resolve(path);mkdirSync(dirname(destination),{recursive:true,mode:0o700});const fd=openSync(destination,'wx',0o600);
  try{writeFileSync(fd,file.body);fsyncSync(fd);}finally{closeSync(fd);}
  return {path:destination,filename:file.filename,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256};
}
export async function runCli(argv=process.argv.slice(2)){
  const {command,options}=args(argv);
  if(command==='help'||options.help){process.stdout.write(help);return;}
  if(command==='inspect-source'){
    const {inspectSource}=await import('./source.mjs');const value=inspectSource(originalFile(options.input),options.dispatch?{dispatchId:options.dispatch}:{});process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;
  }
  if(!options.workspace)fail('WORKSPACE_REQUIRED','Choose the existing or new private workspace with --workspace.');
  if(command==='serve'){
    const running=await serveFieldDesk({directory:resolve(options.workspace),host:options.host??'127.0.0.1',port:options.port===undefined?8770:integer(options.port,'Port'),expectedWorkspaceId:options['expected-workspace-id'],expectedBindingSha256:options['expected-binding-sha256']});
    process.stdout.write(JSON.stringify(running.startup)+'\n');let stopped=false;
    const stop=async()=>{if(stopped)return;stopped=true;await running.close();};
    process.once('SIGINT',()=>{stop().then(()=>process.exit(0),error=>{process.stderr.write(error.message+'\n');process.exit(1);});});
    process.once('SIGTERM',()=>{stop().then(()=>process.exit(0),error=>{process.stderr.write(error.message+'\n');process.exit(1);});});
    return running;
  }
  const workspace=openWorkspace(resolve(options.workspace),{create:command==='init'||command==='receive'});let result;
  const paging={...(options.q!==undefined?{q:options.q}:{}),...(options.offset!==undefined?{offset:integer(options.offset,'Offset')}:{}),...(options.limit!==undefined?{limit:integer(options.limit,'Limit')}:{}),...(options.source?{sourceId:options.source}:{}),...(options.crew?{crewId:options.crew}:{}),...(options.status?{status:options.status}:{})};
  try{
    if(command==='init'||command==='status')result=workspace.state();
    else if(command==='operation')result=workspace.operation(options['request-id']);
    else if(command==='source')result=workspace.source(options.id);
    else if(command==='source-rows')result=workspace.sourceRows(paging);
    else if(command==='crew')result=workspace.crew(options.id);
    else if(command==='visit')result=workspace.visit(options.id);
    else if(command==='visits')result=workspace.visits(paging);
    else if(command==='package-info')result=workspace.package(options.id);
    else if(command==='return-info')result=workspace.returned(options.id);
    else if(command==='update-info')result=workspace.update(options.id);
    else if(command==='attachment')result=saveFile(options.out,workspace.attachment(options.id));
    else if(command==='import')result=workspace.importSource(writeControl(options,{name:options.name,originalText:originalFile(options.input),...(options.dispatch?{dispatchId:options.dispatch}:{})}));
    else if(command==='crew-save'||command==='visit-save'){
      const input=jsonInput(options.input),key=command==='crew-save'?'crew':'visit',method=command==='crew-save'?'putCrew':'putVisit';
      result=workspace[method](writeControl(options,{requestId:input.requestId,expectedRevision:input.expectedRevision,[key]:input[key]??input}));
    }else if(command==='attach'){
      if(!options.file)fail('FILE_REQUIRED','Choose the actual original field file with --file.');
      const bytes=readFileSync(resolve(options.file));const {basename}=await import('node:path');
      result=workspace.putAttachment(writeControl(options,{attachment:{filename:options.name??basename(options.file),contentType:options['content-type']??'application/octet-stream',contentBase64:bytes.toString('base64')}}));
    }else if(command==='package')result=workspace.createPackage(writeControl(options,jsonInput(options.input)));
    else if(command==='return-import')result=workspace.importReturn(writeControl(options,{originalText:originalFile(options.input),...(options.name?{name:options.name}:{})}));
    else if(command==='decide')result=workspace.applyDecisions(writeControl(options,jsonInput(options.input)));
    else if(command==='review')result=workspace.reviewVisits(writeControl(options,jsonInput(options.input)));
    else if(command==='update')result=workspace.createUpdate(writeControl(options,jsonInput(options.input)));
    else if(command==='receive')result=workspace.receive(writeControl(options,{originalText:originalFile(options.input)}));
    else if(command==='export'){
      const selection={...paging,kind:options.kind??'workspace'};
      for(const [flag,key] of [['package','packageId'],['return','returnId'],['update','updateId']])if(options[flag])selection[key]=options[flag];
      if(options['expected-revision']!==undefined)selection.expectedRevision=integer(options['expected-revision'],'Expected revision');
      result=saveFile(options.out,workspace.exportFile(selection));
    }else fail('UNKNOWN_COMMAND','Unknown field-desk command. Use --help for the complete workflow.');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runCli().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'FIELD_DESK_ERROR',message:error.message,details:error.details??null}})+'\n');process.exitCode=1;});
}

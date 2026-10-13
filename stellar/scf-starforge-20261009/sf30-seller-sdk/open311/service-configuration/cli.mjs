#!/usr/bin/env node
// MIT. Complete private agency configuration, source routing and receiving CLI.
import { readFile,open,mkdir } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace,validateWorkspacePackage } from './workspace.mjs';
import { inspectSource } from './source.mjs';
import { validateProfileDefinition } from './profile.mjs';
import { serveServiceConfiguration } from './server.mjs';
import { parseJson,fail } from '../gis/shared.mjs';
const HELP=[
'Open311 agency service configuration',
'',
'All mutable commands retain --request-id and --revision. Retry the same intent with its original request ID.',
'Use a private --workspace directory. Outputs use create-only files; choose a new path for each saved edition.',
'',
'  init --workspace DIR',
'  state --workspace DIR',
'  operation --workspace DIR --request-id ID',
'  profile-save --workspace DIR --input PROFILE.json [--profile-id ID] --request-id ID --revision N',
'  profile --workspace DIR --profile-id ID',
'  profile-validate --input PROFILE.json',
'  source-inspect --input ORIGINAL.json',
'  source-import --workspace DIR --input ORIGINAL.json --name NAME --rows-pointer POINTER --request-id ID --revision N',
'  source --workspace DIR --source-id ID',
'  source-rows --workspace DIR --source-id ID [--q WORDS --offset N --limit N]',
'  preview-create --workspace DIR --profile-id ID --profile-version ID --source-id ID --source-profile ID --name NAME',
'                 [--overrides JSON_FILE --baseline JSON_FILE] --request-id ID --revision N',
'  preview --workspace DIR --preview-id ID [--q WORDS --offset N --limit N]',
'  release-create --workspace DIR --profile-id ID --profile-version ID --preview-id ID --name NAME',
'                 --reviewer NAME [--note TEXT | --note-file FILE] --request-id ID --revision N',
'  release --workspace DIR --release-id ID',
'  export --workspace DIR --kind KIND [--profile-id ID --profile-version ID --source-id ID --preview-id ID --release-id ID]',
'         --output NEW_FILE [--revision N]',
'  receive --workspace NEW_DIR --input FULL_WORKSPACE.json --request-id ID --revision 0',
'  validate --input FULL_WORKSPACE.json',
'  serve --workspace DIR [--port N --host 127.0.0.1 --expected-workspace-id ID --expected-binding-sha256 SHA]',
'',
'Export kinds: workspace, profile, source, preview-json, preview-csv, release-json, release-report.',
'An empty --rows-pointer "" selects a root array. Field mappings are explicit RFC 6901 row-relative pointers.',
'Baseline JSON: {"profileId":"...","profileVersionId":"...","declaredBy":"...","note":"..."}.',
'The complete editable workspace preserves original source text, immutable versions, previews, handovers and operations.'
].join('\n')+'\n';
const ALL_FLAGS=new Set(['workspace','input','output','request-id','revision','profile-id','profile-version','source-id','preview-id','release-id','source-profile','name','rows-pointer','overrides','baseline','reviewer','note','note-file','port','host','q','offset','limit','kind','expected-workspace-id','expected-binding-sha256','help']);
function flags(argv){
  const result={};
  for(let index=0;index<argv.length;index++){
    const supplied=argv[index];if(!supplied.startsWith('--'))fail('CLI_ARGUMENT','Use named --options for the service configuration command.');
    const equal=supplied.indexOf('='),key=supplied.slice(2,equal<0?undefined:equal);
    if(!ALL_FLAGS.has(key)||Object.prototype.hasOwnProperty.call(result,key))fail('CLI_OPTION','Unknown or repeated --'+key+'.');
    if(key==='help'){result.help=true;continue;}
    const value=equal<0?argv[++index]:supplied.slice(equal+1);if(value===undefined)fail('CLI_OPTION_VALUE','Supply a value for --'+key+'.');result[key]=value;
  }
  return result;
}
function required(options,key,{empty=false}={}){if(typeof options[key]!=='string'||!empty&&!options[key].trim())fail('CLI_OPTION_REQUIRED','Supply --'+key+'.');return options[key];}
function number(options,key,requiredValue=false){if(options[key]===undefined){if(requiredValue)fail('CLI_OPTION_REQUIRED','Supply --'+key+'.');return undefined;}if(!/^\d+$/u.test(options[key]))fail('CLI_NUMBER','--'+key+' must be a nonnegative integer.');const value=Number(options[key]);if(!Number.isSafeInteger(value))fail('CLI_NUMBER','--'+key+' exceeds the supported integer range.');return value;}
async function original(filename){const body=await readFile(resolve(filename));try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(body);}catch{fail('INVALID_UTF8','The selected complete JSON file must be valid UTF-8.');}}
const json=async filename=>parseJson(await original(filename),'Selected complete JSON file');
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function save(filename,body){
  const path=resolve(filename);await mkdir(dirname(path),{recursive:true,mode:0o700});const handle=await open(path,'wx',0o600);
  try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}return path;
}
function permitted(options,allowed){for(const key of Object.keys(options))if(key!=='help'&&!allowed.includes(key))fail('CLI_OPTION_FOR_COMMAND','--'+key+' is not supported by this command.');}
const paging=options=>({...(options.q!==undefined?{q:options.q}:{}),...(options.offset!==undefined?{offset:number(options,'offset')}:{}),...(options.limit!==undefined?{limit:number(options,'limit')}:{})});
const intent=options=>({requestId:required(options,'request-id'),expectedRevision:number(options,'revision',true)});
export async function runCli(argv=process.argv.slice(2)){
  const command=argv[0]??'help',options=flags(argv.slice(1));
  if(command==='help'||options.help){process.stdout.write(HELP);return;}
  if(command==='source-inspect'){permitted(options,['input']);print(inspectSource(await original(required(options,'input'))));return;}
  if(command==='profile-validate'){permitted(options,['input']);const value=await json(required(options,'input'));print({definition:validateProfileDefinition(value.definition??value)});return;}
  if(command==='validate'){permitted(options,['input']);const bundle=validateWorkspacePackage(await original(required(options,'input')));print({schema:bundle.schema,workspaceId:bundle.workspaceId,revision:bundle.revision,records:bundle.records.length,sha256:bundle.sha256});return;}
  const directory=resolve(required(options,'workspace'));
  if(command==='serve'){
    permitted(options,['workspace','port','host','expected-workspace-id','expected-binding-sha256']);
    const running=await serveServiceConfiguration({directory,port:number(options,'port')??0,host:options.host??'127.0.0.1',expectedWorkspaceId:options['expected-workspace-id'],expectedBindingSha256:options['expected-binding-sha256']});
    process.stdout.write(JSON.stringify(running.startup)+'\n');await new Promise((resolve,reject)=>{const stop=()=>running.close().then(resolve,reject);process.once('SIGINT',stop);process.once('SIGTERM',stop);});return;
  }
  const workspace=openWorkspace(directory,{create:command==='init'||command==='receive'});
  try{
    let value;
    if(command==='init'||command==='state'){permitted(options,['workspace']);value=workspace.state();}
    else if(command==='operation'){permitted(options,['workspace','request-id']);value=workspace.operation(required(options,'request-id'));}
    else if(command==='profile-save'){
      permitted(options,['workspace','input','profile-id','profile-version','request-id','revision']);
      const raw=await original(required(options,'input')),parsed=parseJson(raw,'Original profile file');
      value=workspace.putProfile({...intent(options),profile:{...(options['profile-id']?{id:options['profile-id']}:{}),definition:parsed.definition??parsed},originalText:raw,...(options['profile-version']?{expectedProfileVersionId:options['profile-version']}:{})});
    }else if(command==='profile'){permitted(options,['workspace','profile-id']);value=workspace.profile(required(options,'profile-id'));}
    else if(command==='source-import'){
      permitted(options,['workspace','input','name','rows-pointer','request-id','revision']);
      value=workspace.importSource({...intent(options),name:required(options,'name'),originalText:await original(required(options,'input')),selection:{rowsPointer:required(options,'rows-pointer',{empty:true})}});
    }else if(command==='source'){permitted(options,['workspace','source-id']);value=workspace.source(required(options,'source-id'));}
    else if(command==='source-rows'){permitted(options,['workspace','source-id','q','offset','limit']);value=workspace.sourceRows({sourceId:required(options,'source-id'),...paging(options)});}
    else if(command==='preview-create'){
      permitted(options,['workspace','name','profile-id','profile-version','source-id','source-profile','overrides','baseline','request-id','revision']);
      value=workspace.createPreview({...intent(options),name:required(options,'name'),profileId:required(options,'profile-id'),expectedProfileVersionId:required(options,'profile-version'),sourceId:required(options,'source-id'),mapping:{sourceProfileId:required(options,'source-profile')},...(options.overrides?{overrides:await json(options.overrides)}:{}),...(options.baseline?{baseline:await json(options.baseline)}:{})});
    }else if(command==='preview'){permitted(options,['workspace','preview-id','q','offset','limit']);value=workspace.preview({id:required(options,'preview-id'),...paging(options)});}
    else if(command==='release-create'){
      permitted(options,['workspace','name','profile-id','profile-version','preview-id','reviewer','note','note-file','request-id','revision']);
      if(options.note!==undefined&&options['note-file']!==undefined)fail('AMBIGUOUS_NOTE','Use either --note or --note-file.');
      value=workspace.createRelease({...intent(options),name:required(options,'name'),profileId:required(options,'profile-id'),expectedProfileVersionId:required(options,'profile-version'),previewId:required(options,'preview-id'),reviewer:required(options,'reviewer'),note:options['note-file']?await original(options['note-file']):options.note??''});
    }else if(command==='release'){permitted(options,['workspace','release-id']);value=workspace.release(required(options,'release-id'));}
    else if(command==='receive'){
      permitted(options,['workspace','input','request-id','revision']);value=workspace.receive({...intent(options),originalText:await original(required(options,'input'))});
    }else if(command==='export'){
      permitted(options,['workspace','kind','profile-id','profile-version','source-id','preview-id','release-id','revision','output']);
      const selection={kind:required(options,'kind')};for(const [flag,key] of [['profile-id','profileId'],['profile-version','profileVersionId'],['source-id','sourceId'],['preview-id','previewId'],['release-id','releaseId']])if(options[flag]!==undefined)selection[key]=options[flag];
      if(options.revision!==undefined)selection.expectedRevision=number(options,'revision');
      const file=workspace.exportFile(selection),output=required(options,'output');
      if(output==='-'){process.stdout.write(file.body);return;}
      value={path:await save(output,file.body),filename:file.filename,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256};
    }else fail('UNKNOWN_COMMAND','Unknown service configuration command. Run help for the complete workflow.');
    print(value);
  }finally{workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runCli().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'SERVICE_CONFIGURATION_ERROR',message:error.message,details:error.details??null}})+'\n');process.exitCode=1;});

#!/usr/bin/env node
// MIT. Saved municipal request and work-order follow-through commands.
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openWorkspace } from './workspace.mjs';
import { startFollowThroughServer } from './server.mjs';
import { inspectSource } from './source.mjs';
import { parseJson, fail, MAX_PACKAGE_BYTES } from '../gis/shared.mjs';

export const HELP='Municipal request and work-order follow-through\n\n'+
'open311-follow-through init --workspace DIR\n'+
'open311-follow-through serve --workspace DIR [--host 127.0.0.1] [--port 0]\n'+
'open311-follow-through inspect-source --file SOURCE [--kind arcgis|geojson|csv|json] [--metadata FILE] [--capture-ids ID,ID]\n'+
'open311-follow-through import --workspace DIR --file SOURCE --role requests|orders --series SOURCE_SERIES --observed-at OFFSET_ISO [--name NAME] [--metadata FILE] [--capture-ids ID,ID]\n'+
'open311-follow-through profile|build|link|work|review-apply|dispatch --workspace DIR --file DEFINITION\n'+
'open311-follow-through review-import --workspace DIR --file REVIEWER_JSON\n'+
'open311-follow-through state --workspace DIR\n'+
'open311-follow-through source|profile|edition|work|return|dispatch --workspace DIR --id ID\n'+
'open311-follow-through source-rows --workspace DIR --id ID [--q TEXT] [--offset N] [--limit N]\n'+
'open311-follow-through requests|orders --workspace DIR --edition ID [--q TEXT] [--offset N] [--limit N]\n'+
'open311-follow-through work-queue --workspace DIR --edition ID [--approval approved] [--assignee NAME] [--status STATUS] [--offset N] [--limit N]\n'+
'open311-follow-through request --workspace DIR --edition ID --key KEY\n'+
'open311-follow-through changes --workspace DIR --before ID --after ID [--entity requests|orders] [--offset N] [--limit N]\n'+
'open311-follow-through export --workspace DIR --kind workspace|source|edition|requests-csv|review|dispatch-json|dispatch-csv|dispatch-geojson|report --out FILE [--source ID | --edition ID | --dispatch ID]\n'+
'open311-follow-through receive --workspace EMPTY_DIR --file COMPLETE_WORKSPACE\n'+
'open311-follow-through operation --workspace DIR --request-id ORIGINAL_ID\n\n'+
'Mutations accept --request-id ID and --expected-revision N. Preserve the original ID and file on retry.\n'+
'serve also accepts --expected-workspace-id UUID --expected-binding-sha256 SHA; it prints one compact LISTENING line.\n'+
'Source status and original closing dates stay separate from internal work and action approval.\n';
function argumentsOf(argv){
  const [command='help',...tokens]=argv,args={command};const allowed=new Set(['workspace','host','port','expected-workspace-id','expected-binding-sha256','file','metadata','capture-ids','kind','role','series','observed-at','name','source-url','id','q','offset','limit','edition','key','before','after','source','file-id','return','dispatch','out','request-id','expected-revision','discrepancy','assignee','work-status','approval','status','target-edition','entity']);
  for(let i=0;i<tokens.length;i++){const token=tokens[i];if(token==='--help'){args.command='help';continue;}if(!token.startsWith('--')||!allowed.has(token.slice(2)))fail('UNKNOWN_ARGUMENT','Unknown argument '+token+'.');const name=token.slice(2);if(Object.hasOwn(args,name)||i+1>=tokens.length)fail('INVALID_ARGUMENT','Supply one value for '+token+'.');args[name]=tokens[++i];}
  return args;
}
async function original(path){if(!path)fail('FILE_REQUIRED','Select the complete original file with --file.');const bytes=await readFile(resolve(path));if(bytes.length>MAX_PACKAGE_BYTES)fail('FILE_SIZE','The selected file exceeds 256 MiB.',413);try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8','The complete selected text file is not valid UTF-8.');}}
const numeric=(value,name)=>{if(value===undefined)return undefined;const number=Number(value);if(!Number.isSafeInteger(number)||number<0)fail('INVALID_ARGUMENT',name+' must be a nonnegative integer.');return number;};
function paging(args){return {q:args.q??'',...(args.offset!==undefined?{offset:numeric(args.offset,'offset')}:{ }),...(args.limit!==undefined?{limit:numeric(args.limit,'limit')}:{ })};}
async function saveFile(path,body){
  if(!path)fail('OUTPUT_REQUIRED','Choose --out for the complete export file.');const target=resolve(path),temporary=join(dirname(target),'.'+basename(target)+'.'+randomUUID()+'.tmp');
  try{await writeFile(temporary,body,{flag:'wx',mode:0o600});await rename(temporary,target);}finally{await unlink(temporary).catch(()=>{});}return target;
}
export async function run(argv=process.argv.slice(2),{stdout=process.stdout}={}){
  const args=argumentsOf(argv),command=args.command;const print=value=>stdout.write(JSON.stringify(value,null,2)+'\n');
  if(['help','--help','-h'].includes(command)){stdout.write(HELP);return;}
  const options={};for(const [arg,key]of [['kind','kind'],['name','name'],['source-url','sourceUrl']])if(args[arg]!==undefined)options[key]=args[arg];
  if(args.metadata)options.metadataText=await original(args.metadata);if(args['capture-ids'])options.captureIds=args['capture-ids'].split(',').filter(Boolean);
  if(command==='inspect-source'){const result=inspectSource(await original(args.file),{name:args.name??basename(args.file??'source.json'),...options});print(result);return result;}
  if(!args.workspace)fail('WORKSPACE_REQUIRED','Choose the private workspace with --workspace.');
  if(command==='serve'){
    const app=await startFollowThroughServer({workspace:resolve(args.workspace),host:args.host??'127.0.0.1',port:args.port===undefined?0:numeric(args.port,'port'),expectedWorkspaceId:args['expected-workspace-id'],expectedBindingSha256:args['expected-binding-sha256']});
    stdout.write(JSON.stringify(app.startup)+'\n');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;}));return app;
  }
  const workspace=openWorkspace(resolve(args.workspace),{create:['init','receive'].includes(command)});
  try{
    const control=()=>({requestId:args['request-id']??randomUUID(),expectedRevision:args['expected-revision']===undefined?workspace.state().revision:numeric(args['expected-revision'],'expected revision')});
    const input=async()=>parseJson(await original(args.file),'Action definition');let value;
    if(command==='init'||command==='state')value=workspace.state();
    else if(command==='import')value=workspace.importSource({...control(),...options,originalText:await original(args.file),name:args.name??basename(args.file),role:args.role,seriesId:args.series,observedAt:args['observed-at']});
    else if(command==='profile'&&args.file)value=workspace.putProfile({...control(),profile:await input()});
    else if(command==='build')value=workspace.build({...control(),definition:await input()});
    else if(command==='link')value=workspace.putLink({...control(),selection:await input()});
    else if(command==='work'&&args.file)value=workspace.putWork({...control(),work:await input()});
    else if(command==='review-import')value=workspace.importReview({...control(),originalText:await original(args.file)});
    else if(command==='review-apply')value=workspace.applyReview({...control(),selection:await input()});
    else if(command==='dispatch'&&args.file)value=workspace.putDispatch({...control(),definition:await input()});
    else if(command==='receive')value=workspace.receive({...control(),originalText:await original(args.file)});
    else if(command==='source')value=workspace.source(args.id);
    else if(command==='source-rows')value=workspace.sourceRows({id:args.id,...paging(args)});
    else if(command==='profile')value=workspace.profile(args.id);
    else if(command==='edition')value=workspace.edition(args.id);
    else if(command==='requests')value=workspace.requests({editionId:args.edition,...paging(args),discrepancy:args.discrepancy??'',assignee:args.assignee??'',workStatus:args['work-status']??''});
    else if(command==='orders')value=workspace.orders({editionId:args.edition,...paging(args)});
    else if(command==='request')value=workspace.request({editionId:args.edition,key:args.key});
    else if(command==='changes')value=workspace.changes({before:args.before,after:args.after,entity:args.entity??'requests',...paging(args)});
    else if(command==='work-queue')value=workspace.workQueue({editionId:args.edition,...paging(args),approval:args.approval??'',assignee:args.assignee??'',status:args.status??''});
    else if(command==='work')value=workspace.work(args.id);
    else if(command==='return')value=workspace.returned(args.id,args['target-edition']?{targetEditionId:args['target-edition']}:{});
    else if(command==='dispatch')value=workspace.dispatch(args.id);
    else if(command==='operation')value=workspace.operation(args['request-id']);
    else if(command==='export'){
      const selection={kind:args.kind??'workspace'};for(const [arg,key]of [['source','sourceId'],['edition','editionId'],['dispatch','dispatchId'],['return','returnId'],['file-id','fileId']])if(args[arg])selection[key]=args[arg];
      if(args['expected-revision']!==undefined)selection.expectedRevision=numeric(args['expected-revision'],'expected revision');
      const file=workspace.exportFile(selection),path=await saveFile(args.out,file.body);value={filename:file.filename,path,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256,workspaceId:workspace.state().workspaceId,revision:workspace.state().revision};
    }else fail('UNKNOWN_COMMAND','Unknown command '+command+'. Use help for the full workflow.');
    print(value);return value;
  }finally{workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(error=>{process.stderr.write(JSON.stringify({ok:false,error:{code:error.code??'FOLLOW_THROUGH_ERROR',message:error.message,details:error.details??null}})+'\n');process.exitCode=1;});

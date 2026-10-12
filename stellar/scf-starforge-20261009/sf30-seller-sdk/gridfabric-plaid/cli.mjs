#!/usr/bin/env node
// MIT. The original GridFabric Plaid application, owned by one native workspace lease.
import {parseArgs,TextDecoder} from 'node:util';
import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,existsSync,renameSync,unlinkSync,constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openGridFabricWorkspace} from './operator.mjs';
import {startGridFabricServer,sourceIdentity} from './server.mjs';
import {exportWorkspace,exportMetadata,restoreWorkspace,inspectPortable,artifactIdentity} from './delivery.mjs';
import {privateDirectory} from './sqlite-store.mjs';

const HELP=[
  'GridFabric Plaid operations',
  '',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY init [--label NAME]',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY serve --port 0 --connection-file PRIVATE_FILE',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY status',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY page --collection NAME [--scope ID --offset 0 --limit 100]',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY detail --collection NAME --id ID',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY action --name ACTION --input ORIGINAL_JSON [--request-id UUID --expected-revision N]',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY import --file ORIGINAL --format csv|json|original --profile PROFILE_JSON --provenance PROVENANCE_JSON',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY dispatch-management --id OPERATION_ID --request-id UUID --expected-revision N',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY dispatch-device --id ACTION_ID --request-id UUID --expected-revision N',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY host-operation --request-id UUID',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY file --id SHA256 --out NEW_FILE',
  'starforge gridfabric-plaid --workspace PRIVATE_DIRECTORY export --out NEW_FILE.jsonl.gz [--request-id UUID --expected-revision N]',
  'starforge gridfabric-plaid --workspace NEW_PRIVATE_DIRECTORY restore --file ORIGINAL.jsonl.gz [--expected-sha SHA256]',
  'starforge gridfabric-plaid inspect-portable --file ORIGINAL.jsonl.gz [--expected-sha SHA256]',
  'starforge gridfabric-plaid source',
  '',
  'Local action aliases: configure-instance, mapping-save, mapping-activate, report, opt,',
  'distribution-reconcile, management-prepare, management-reconcile, device-reconcile, recover-dispatches.',
  'Each alias takes --input ORIGINAL_JSON. Save request UUIDs before external dispatch.',
  'A replayed begin never sends again. Original SENDING/UNKNOWN operations require retained receipt or reviewed reconciliation.',
  'Callback scheduling remains owned by Plaid; this application has no event timer or automatic management/device sender.',
  'Node 22.13 or newer, Linux flock, and GNU mv with --no-clobber --no-target-directory are required. Run no hosted CI to receive a workspace.'
].join('\n')+'\n';
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const fail=(code,message)=>Object.assign(new Error(message),{code});
const readJson=path=>JSON.parse(decoder.decode(readFileSync(resolve(path))));
function integer(value,label,defaultValue){if(value===undefined)return defaultValue;if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('GRIDFABRIC_CLI_INTEGER',label+' must be a nonnegative integer.');return Number(value);}
async function exactCopy(source,target){
  const actual=await artifactIdentity(source),destination=resolve(target);privateDirectory(dirname(destination));
  if(existsSync(destination)){
    const retained=await artifactIdentity(destination);
    if(retained.bytes!==actual.bytes||retained.sha256!==actual.sha256)throw fail('GRIDFABRIC_OUTPUT_EXISTS','The selected output already contains another original file.');
    return {...retained,replayed:true};
  }
  const temporary=join(dirname(destination),'.gridfabric-copy-'+randomUUID());
  const {createReadStream,createWriteStream}=await import('node:fs'),{pipeline}=await import('node:stream/promises');
  try{
    await pipeline(createReadStream(actual.path),createWriteStream(temporary,{flags:'wx',mode:0o600}));
    const copied=await artifactIdentity(temporary);
    if(copied.bytes!==actual.bytes||copied.sha256!==actual.sha256)throw fail('GRIDFABRIC_COPY_CHANGED','The complete original copied bytes differ.');
    const fd=openSync(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}
    if(existsSync(destination))throw fail('GRIDFABRIC_OUTPUT_EXISTS','The selected output was created during the original copy.');
    renameSync(temporary,destination);
    const directory=openSync(dirname(destination),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(directory);}finally{closeSync(directory);}
    return {...actual,path:destination,name:destination.split('/').at(-1)};
  }catch(error){try{unlinkSync(temporary);}catch{}throw error;}
}
function result(value,out){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  if(out){
    const path=resolve(out);privateDirectory(dirname(path));
    const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
    process.stdout.write(JSON.stringify({status:'SAVED',path,bytes:bytes.length})+'\n');
  }else process.stdout.write(bytes);
}
export async function main(argv=process.argv.slice(2)){
  const parsed=parseArgs({args:argv,allowPositionals:true,strict:true,options:Object.fromEntries([
    'workspace','label','port','connection-file','collection','scope','tag','gte','lt','offset','limit','order',
    'id','name','input','file','format','profile','provenance','corrects-source-id','request-id','expected-revision',
    'expected-sha','out','maximum-request-bytes','maximum-response-bytes','maximum-portable-bytes','timeout-ms'
  ].map(name=>[name,{type:'string'}]).concat([['help',{type:'boolean',short:'h'}]]))});
  const options=parsed.values,command=parsed.positionals[0]||'help';
  if(options.help||command==='help'){process.stdout.write(HELP);return;}
  if(parsed.positionals.length>1)throw fail('GRIDFABRIC_CLI_COMMAND','Use one original application command.');
  if(command==='source'){result(sourceIdentity(),options.out);return;}
  if(command==='inspect-portable'){
    if(!options.file)throw fail('GRIDFABRIC_CLI_FILE','Select the complete original portable file.');
    result(await inspectPortable(resolve(options.file),{expectedSha256:options['expected-sha']}),options.out);return;
  }
  if(!options.workspace)throw fail('GRIDFABRIC_CLI_WORKSPACE','Select the original private workspace directory.');
  if(command==='restore'){
    if(!options.file)throw fail('GRIDFABRIC_CLI_FILE','Select the complete original portable file.');
    result(await restoreWorkspace({file:resolve(options.file),destination:resolve(options.workspace),expectedSha256:options['expected-sha']}),options.out);return;
  }
  const workspace=await openGridFabricWorkspace({directory:resolve(options.workspace),create:command==='init',
    name:options.label||'GridFabric Plaid operations',
    timeoutMilliseconds:integer(options['timeout-ms'],'timeout-ms',120000),
    maximumResponseBytes:integer(options['maximum-response-bytes'],'maximum-response-bytes',64*1024*1024)});
  let server;
  try{
    const operation=()=>({request_id:options['request-id']||randomUUID(),expected_revision:integer(options['expected-revision'],'expected-revision',workspace.state().revision)});
    if(command==='init'||command==='status'){result(workspace.state(),options.out);return;}
    if(command==='serve'){
      let stop;const stopped=new Promise(resolve=>{stop=resolve;});
      const signal=()=>stop();process.once('SIGINT',signal);process.once('SIGTERM',signal);
      try{
        server=await startGridFabricServer({workspace,port:integer(options.port,'port',0),connectionFile:options['connection-file'],
          maximumRequestBytes:integer(options['maximum-request-bytes'],'maximum-request-bytes',256*1024*1024),
          maximumPortableBytes:integer(options['maximum-portable-bytes'],'maximum-portable-bytes',4*1024*1024*1024)});
        result({...server.launch,...(options['connection-file']?{connection_file:resolve(options['connection-file'])}:{console_url:server.consoleUrl})});
        await stopped;await server.close();server=null;
        result({status:'CLOSED',workspace_id:workspace.workspace_id,connection_removed:Boolean(options['connection-file'])});
      }finally{process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);}
      return;
    }
    if(command==='page'){
      const selected={offset:integer(options.offset,'offset',0),limit:integer(options.limit,'limit',100)};
      for(const key of ['scope','tag','gte','lt','order'])if(options[key]!==undefined)selected[key]=options[key];
      result(workspace.page(options.collection,selected),options.out);return;
    }
    if(command==='detail'){result(workspace.detail(options.collection,options.id),options.out);return;}
    if(command==='host-operation'){result(workspace.hostOperation(options['request-id']),options.out);return;}
    if(command==='file'){
      if(!options.out)throw fail('GRIDFABRIC_CLI_OUTPUT','Choose a new complete output file.');
      const path=workspace.files.path(options.id);result(await exactCopy(path,options.out));return;
    }
    if(command==='export'){
      if(!options.out)throw fail('GRIDFABRIC_CLI_OUTPUT','Choose a complete portable output file.');
      const exported=await exportWorkspace(workspace,{...operation(),source:sourceIdentity()});
      const copied=await exactCopy(join(workspace.directory,'exports',exported.name),options.out);
      result({export:exported,file:copied});return;
    }
    if(command==='dispatch-management'||command==='dispatch-device'){
      if(!options.id||!options['request-id']||options['expected-revision']===undefined)
        throw fail('GRIDFABRIC_CLI_DISPATCH','Select the original operation, request UUID and reviewed workspace revision.');
      const envelope=operation();
      process.stderr.write(JSON.stringify({status:'DISPATCH_REQUEST_RECORDED',kind:command,original_id:options.id,...envelope})+'\n');
      result(command==='dispatch-management'?await workspace.dispatchManagement({operation_id:options.id},envelope):
        await workspace.dispatchDevice({device_action_id:options.id},envelope),options.out);return;
    }
    if(command==='import'){
      if(!options.file||!options.provenance)throw fail('GRIDFABRIC_CLI_IMPORT','Select the complete original file and explicit provenance JSON.');
      const format=options.format||'original',text=decoder.decode(readFileSync(resolve(options.file))),name=options.label||resolve(options.file).split('/').at(-1);
      const uploaded=workspace.upload(text,{name,mime_type:format==='csv'?'text/csv':format==='json'?'application/json':'text/plain'});
      const input={file_sha256:uploaded.sha256,name,format,provenance:readJson(options.provenance),
        ...(format!=='original'?{profile:options.profile?readJson(options.profile):null}:{}),
        ...(options['corrects-source-id']?{corrects_source_id:options['corrects-source-id']}:{})};
      result(workspace.execute('import_source',input,operation()),options.out);return;
    }
    const aliases={'configure-instance':'configure_instance','mapping-save':'save_mapping','mapping-activate':'activate_mapping',
      report:'build_report',opt:'record_opt_decision','distribution-reconcile':'reconcile_distribution','management-prepare':'prepare_management',
      'management-reconcile':'reconcile_management','device-reconcile':'reconcile_device_action','recover-dispatches':'recover_dispatches'};
    const action=command==='action'?options.name:aliases[command];
    if(!action||!options.input)throw fail('GRIDFABRIC_CLI_ACTION','Select a supported original action and its complete input JSON.');
    result(workspace.execute(action,readJson(options.input),operation()),options.out);
  }finally{if(server)await server.close();await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'GRIDFABRIC_CLI_ERROR',message:error.message,details:error.details||null}})+'\n');process.exitCode=1;});
}

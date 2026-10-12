#!/usr/bin/env node
// MIT. Complete local/connected operator over the same retained Zotero workspace.
import {resolve,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateDirectory,readBytes,writeBytes} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {SCHEMA,LIMIT,need,json,parse,sha256,requestId,safeCode} from './contracts.mjs';
import {startZoteroWorkspace} from './server.mjs';
import {createZoteroClient,loadZoteroConnection} from './client.mjs';
import {receiveWorkspace} from './workspace.mjs';
import {makeDocumentSet} from './source.mjs';

function options(args){
  const out={};for(let i=0;i<args.length;i++){
    const arg=args[i];need(/^--[a-z][a-z-]*$/.test(arg)&&!Object.hasOwn(out,arg.slice(2)),'ZOTERO_ARGUMENT_INVALID');
    const value=args[++i];need(typeof value==='string'&&!value.startsWith('--'),'ZOTERO_ARGUMENT_VALUE_REQUIRED');out[arg.slice(2)]=value;
  }return out;
}
function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'ZOTERO_ABSOLUTE_PATH_REQUIRED');return value;}
async function output(path,bytes){
  absolute(path);await privateDirectory(dirname(path));const body=Buffer.from(bytes);
  try{await writeBytes(path,body,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;const original=await readBytes(path,LIMIT.transfer);
    need(original.length===body.length&&sha256(original)===sha256(body),'ZOTERO_OUTPUT_ALREADY_DIFFERENT');}
  return {path,bytes:body.length,sha256:sha256(body)};
}
const usage=String.raw`Zotero library and Research operator

  starforge zotero serve --state ABS_DIRECTORY [--research-dir ABS_ORIGINAL_RESEARCH]
      [--port 0] [--connection-file ABS_PRIVATE_JSON]
  starforge zotero invoke --connection ABS_PRIVATE_JSON --method METHOD
      --input-file ABS_JSON [--request-id UUID] [--out ABS_JSON]
  starforge zotero import --connection ABS_PRIVATE_JSON --profile PROFILE_ID
      --profile-revision N --file ABS_DOCUMENT_SET --request-id UUID
  starforge zotero download --connection ABS_PRIVATE_JSON --kind edition|comparison|handoff
      --id ORIGINAL_ID [--revision N] [--role document --name ORIGINAL_FILENAME] --out ABS_FILE
  starforge zotero export --connection ABS_PRIVATE_JSON --request-id UUID --out ABS_PACKET
  starforge zotero receive --state ABS_EMPTY_RECEIVER --file ABS_PACKET --request-id UUID
  starforge zotero receive --connection ABS_PRIVATE_JSON --name RECEIVER_NAME
      --file ABS_PACKET --request-id UUID
  starforge zotero documents --library-type users|groups --library-id NUMERIC_ID
      --items ABS_ORIGINAL_ITEMS_JSON [--collections ABS_ORIGINAL_COLLECTIONS_JSON]
      --source-reference SOURCE --out ABS_DOCUMENT_SET
  starforge zotero state --connection ABS_PRIVATE_JSON
  starforge zotero shutdown --connection ABS_PRIVATE_JSON

The server prints a nonsecret readiness record and stores the private browser URL
in connection.json. API key values belong only in the selected host environment.
Document intake preserves original bytes and is distinct from a complete live capture.
`;
export async function main(args=process.argv.slice(2)){
  if(!args.length||['help','--help','-h'].includes(args[0])){process.stdout.write(usage);return;}
  const command=args[0].startsWith('--')?'serve':args.shift(),opts=options(args);
  if(command==='serve'){
    const app=await startZoteroWorkspace({directory:absolute(opts.state??opts.dir),researchDirectory:opts['research-dir']?absolute(opts['research-dir']):null,
      port:Number(opts.port??0),connectionFile:opts['connection-file']?absolute(opts['connection-file']):null});
    process.stdout.write(JSON.stringify({schema:SCHEMA.connection,mode:'ZOTERO_LIBRARY_WORKSPACE',workspaceId:app.workspace.identity.workspaceId,
      instanceId:app.instanceId,origin:app.origin,connectionFile:app.connectionFile,active:true})+'\n');
    let stopping;
    const close=()=>stopping??=(async()=>{await app.close();process.exitCode=0;})();
    process.once('SIGINT',()=>close().catch(e=>{process.stderr.write(JSON.stringify({error:safeCode(e)})+'\n');process.exitCode=1;}));
    process.once('SIGTERM',()=>close().catch(e=>{process.stderr.write(JSON.stringify({error:safeCode(e)})+'\n');process.exitCode=1;}));
    return app;
  }
  if(command==='documents'){
    const documents=[];
    for(const kind of ['items','collections'])if(opts[kind]){
      const path=absolute(opts[kind]),bytes=await readBytes(path,LIMIT.page);
      documents.push({name:kind+'.json',kind,bytes,sourceReference:opts['source-reference']??''});
    }
    need(documents.length>0,'ZOTERO_ORIGINAL_DOCUMENT_REQUIRED');
    const bytes=makeDocumentSet({library:{type:opts['library-type'],id:opts['library-id']},documents,
      sourceReference:opts['source-reference']??''});
    process.stdout.write(JSON.stringify(await output(opts.out,bytes))+'\n');return;
  }
  if(command==='receive'&&!opts.connection){
    const bytes=await readBytes(absolute(opts.file),LIMIT.transfer);
    const result=await receiveWorkspace(bytes,{directory:absolute(opts.state),requestId:requestId(opts['request-id'])});
    process.stdout.write(JSON.stringify(result)+'\n');return result;
  }
  const connection=await loadZoteroConnection(absolute(opts.connection)),client=createZoteroClient(connection);
  try{
    await client.verify();let result;
    if(command==='state')result=await client.state();
    else if(command==='invoke'){
      const input=opts['input-file']?parse(await readBytes(absolute(opts['input-file']),LIMIT.control)):{};
      result=await client.invoke(opts.method,input,opts['request-id']??null);
    }else if(command==='import')result=await client.importDocuments(await readBytes(absolute(opts.file),LIMIT.transfer),{
      profileId:opts.profile,profileRevision:Number(opts['profile-revision']),requestId:requestId(opts['request-id'])});
    else if(command==='download'){
      const file=await client.download({kind:opts.kind,id:opts.id,...(opts.revision?{revision:Number(opts.revision)}:{}),
        ...(opts.role?{role:opts.role}:{}),...(opts.name?{name:opts.name}:{})});
      result=await output(opts.out,file.bytes);
    }else if(command==='export'){
      const file=await client.exportWorkspace(requestId(opts['request-id']));result=await output(opts.out,file.bytes);
    }else if(command==='receive'){
      result=await client.receiveWorkspace(await readBytes(absolute(opts.file),LIMIT.transfer),{name:opts.name,requestId:requestId(opts['request-id'])});
      // The current child capability is useful locally, but is not printed into command logs.
      result={name:result.name,receipt:result.receipt,child:{workspaceId:result.connection.workspaceId,instanceId:result.connection.instanceId,active:true}};
    }else if(command==='shutdown')result=await client.shutdown();
    else throw Object.assign(new Error('ZOTERO_COMMAND_INVALID'),{code:'ZOTERO_COMMAND_INVALID'});
    if(opts.out&&command!=='download'&&command!=='export')process.stdout.write(JSON.stringify(await output(opts.out,json(result)))+'\n');
    else process.stdout.write(JSON.stringify(result)+'\n');
    return result;
  }finally{client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  process.stderr.write(JSON.stringify({error:safeCode(error),details:error.details??{}})+'\n');process.exitCode=1;
});

#!/usr/bin/env node
// Original OSF source → institutional review → original DSpace tools → complete receiving.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {openWorkspace} from '../workspace.mjs';

const HASH=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>JSON.stringify(value,(key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const argv=process.argv.slice(2),command=argv.shift(),o={};
for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||argv[i+1]===undefined)throw Error('Each --option requires a value.');o[argv[i].slice(2)]=argv[i+1];}
const required=k=>{if(!o[k])throw Error('--'+k+' is required.');return o[k];};
const yes=(k,fallback)=>o[k]===undefined?fallback:o[k]==='true'?true:o[k]==='false'?false:(()=>{throw Error('--'+k+' must be true or false.');})();
function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function privateDir(dir){
 if(fs.existsSync(dir)){if(!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink())throw Error('Use a real output directory.');return;}
 privateDir(path.dirname(dir));fs.mkdirSync(dir,{mode:0o700});syncDir(path.dirname(dir));
}
function originalFile(target){
 const fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
 try{const stat=fs.fstatSync(fd,{bigint:true});if(!stat.isFile())throw Error('Use a complete regular original file: '+target);return {fd,stat};}
 catch(error){fs.closeSync(fd);throw error;}
}
function unchanged(opened,target){
 const after=fs.fstatSync(opened.fd,{bigint:true}),before=opened.stat;
 if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw Error('The original file changed while reading: '+target);
}
function sameRetained(target,bytes){
 let opened;try{opened=originalFile(target);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 try{const actual=fs.readFileSync(opened.fd);unchanged(opened,target);if(!actual.equals(bytes))throw Error('A different retained file already exists: '+target);return true;}
 finally{fs.closeSync(opened.fd);}
}
function publishStage(stage,target,existingMatches){
 try{fs.linkSync(stage,target);}catch(error){if(error.code!=='EEXIST')throw error;existingMatches();}
 syncDir(path.dirname(target));
}
function retain(target,bytes){
 target=path.resolve(target);privateDir(path.dirname(target));
 if(sameRetained(target,bytes)){syncDir(path.dirname(target));return target;}
 const stage=path.join(path.dirname(target),'.'+path.basename(target)+'.stage-'+randomUUID());
 let fd;
 try{
  fd=fs.openSync(stage,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
  fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  publishStage(stage,target,()=>{if(!sameRetained(target,bytes))throw Error('The retained destination disappeared during publication.');});
  return target;
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(stage);syncDir(path.dirname(target));}catch(error){if(error.code!=='ENOENT')throw error;}}
}
async function retainFile(target,source){
 target=path.resolve(target);source=path.resolve(source);privateDir(path.dirname(target));
 const expected=await fileHash(source);
 try{const actual=await fileHash(target);if(stable(actual)!==stable(expected))throw Error('The existing destination differs from this complete export.');syncDir(path.dirname(target));return expected;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const stage=path.join(path.dirname(target),'.'+path.basename(target)+'.stage-'+randomUUID());
 try{
  fs.copyFileSync(source,stage,fs.constants.COPYFILE_EXCL);fs.chmodSync(stage,0o600);
  const fd=fs.openSync(stage,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const copied=await fileHash(stage),current=await fileHash(source);
  if(stable(copied)!==stable(expected)||stable(current)!==stable(expected))throw Error('The original export changed while its complete file was staged.');
  try{fs.linkSync(stage,target);}catch(error){if(error.code!=='EEXIST')throw error;const actual=await fileHash(target);if(stable(actual)!==stable(expected))throw Error('A different retained file already exists: '+target);}
  syncDir(path.dirname(target));return expected;
 }finally{try{fs.unlinkSync(stage);syncDir(path.dirname(target));}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function readJSON(filename){return JSON.parse(fs.readFileSync(path.resolve(filename),'utf8'));}
function localBytes(root,relative){
 if(typeof relative!=='string'||path.isAbsolute(relative))throw Error('Source member paths must be relative to the manifest.');
 const base=fs.realpathSync(root),target=fs.realpathSync(path.resolve(base,relative));
 if(!target.startsWith(base+path.sep)||!fs.statSync(target).isFile())throw Error('The source member escapes its original manifest directory.');
 return fs.readFileSync(target);
}
function sourceBytes(filename){
 const absolute=path.resolve(filename),raw=fs.readFileSync(absolute),value=JSON.parse(raw),base=path.dirname(absolute);
 if(value.schema!=='osf-project-source/v1'||!Array.isArray(value.documents)||!Array.isArray(value.files??[]))throw Error('Choose an osf-project-source/v1 original source manifest.');
 let changed=false;
 const documents=value.documents.map(row=>{
  if(!row.body_file)return row;if(row.body_text!==undefined||row.body_base64!==undefined||row.asset_id)throw Error('Choose one original response body representation.');
  const bytes=localBytes(base,row.body_file);if(row.sha256&&row.sha256!==HASH(bytes)||row.bytes!==undefined&&row.bytes!==bytes.length)throw Error('The original response body differs: '+row.body_file);
  changed=true;return {...row,body_base64:bytes.toString('base64'),sha256:HASH(bytes),bytes:bytes.length};
 });
 const files=(value.files??[]).map(row=>{
  if(!row.content_file)return row;if(row.content_b64!==undefined||row.asset_id)throw Error('Choose one original file body representation.');
  const bytes=localBytes(base,row.content_file);if(row.sha256&&row.sha256!==HASH(bytes)||row.bytes!==undefined&&row.bytes!==bytes.length)throw Error('The original file differs: '+row.content_file);
  changed=true;return {...row,content_b64:bytes.toString('base64'),sha256:HASH(bytes),bytes:bytes.length};
 });
 return changed?encode({...value,documents,files,source_manifest:{filename:path.basename(absolute),sha256:HASH(raw),body_text:raw.toString('utf8')}}):raw;
}
async function fileHash(filename){
 const opened=originalFile(filename),h=createHash('sha256'),buffer=Buffer.alloc(256*1024);let bytes=0;
 try{for(;;){const count=fs.readSync(opened.fd,buffer,0,buffer.length,null);if(!count)break;h.update(buffer.subarray(0,count));bytes+=count;}unchanged(opened,filename);if(BigInt(bytes)!==opened.stat.size)throw Error('The original file length changed: '+filename);return {sha256:h.digest('hex'),bytes};}
 finally{fs.closeSync(opened.fd);}
}
const HELP=`OSF institutional transition — Node 24, original DSpace workspace

Read and prepare:
  state --workspace DIR
  read --workspace DIR --kind KIND --id ID [--offset 0 --limit 50]
  template --workspace DIR --source-id SOURCE --output mapping.json
  assemble-source --source source-manifest.json --output original-source.json
  preview --workspace NEW_DIR --source delivery.tar.gz --output preview.json
  export --workspace DIR --kind osf_archive --id DELIVERY --output delivery.tar.gz

Retained commands (every mutation requires --request NEW_ORIGINAL_REQUEST.json):
  capture --workspace DIR --roots GUID[,GUID] --name NAME --actor STAFF
          --request request.json [--recursive true --download-files true
          --include-versions true --file-keys keys.json --token-env OSF_TOKEN]
  import --workspace DIR --source original-source.json --name NAME --actor STAFF --request request.json
  map --workspace DIR --input mapping.json --actor STAFF --request request.json
  review | prepare | adopt | compare | reconcile | handover | draft
      --workspace DIR --input complete-input.json --actor STAFF --request request.json
  action --workspace DIR --action ORIGINAL_ACTION --input input.json --actor STAFF --request request.json
  receive --workspace NEW_DIR --source delivery.tar.gz --preview preview.json --actor STAFF --request request.json
  resume --workspace ORIGINAL_DIR --request ORIGINAL_REQUEST.json [--rebase true]
  operation --workspace DIR --id ORIGINAL_OPERATION_ID

The request is saved and synced before the original dispatch. Reuse resume after a
lost response. --rebase true refreshes only the revision when no original native
operation exists; source, mapping, review, target and archive identities stay fixed.
Input formats and the records→metadata→files native sequence are in OSF_TRANSITION.md.
`;
let workspace;
try{
 if(command==='help'||!command){process.stdout.write(HELP);process.exitCode=command?0:2;}
 else if(command==='assemble-source'){const bytes=sourceBytes(required('source')),output=retain(required('output'),bytes);process.stdout.write(JSON.stringify({output,bytes:bytes.length,sha256:HASH(bytes)},null,2)+'\n');}
 else{
  workspace=await openWorkspace({directory:path.resolve(required('workspace')),...(o['upstream-root']?{upstreamRoot:path.resolve(o['upstream-root'])}:{})});
  let result;
  if(command==='state')result=workspace.state();
  else if(command==='read'||command==='operation')result=workspace.read(command==='operation'?'operations':required('kind'),required('id'),{offset:Number(o.offset||0),limit:Number(o.limit||50)});
  else if(command==='template'){result=workspace.read('osf_default_mapping',required('source-id'));if(o.output)retain(o.output,encode(result));}
  else if(command==='preview'){result=await workspace.previewFile(path.resolve(required('source')));if(o.output)retain(o.output,encode(result));}
  else if(command==='export'){
   const file=await workspace.exportFile(required('kind'),required('id')),output=path.resolve(required('output'));privateDir(path.dirname(output));
   try{
    if(file.path){
     const expected=await retainFile(output,file.path);
     result={output,...expected,content_type:file.contentType};
    }else{retain(output,file.bytes);result={output,bytes:file.bytes.length,sha256:HASH(file.bytes),content_type:file.contentType};}
   }finally{if(file.temporary){if(file.cleanup_directory)fs.rmSync(file.cleanup_directory,{recursive:true,force:true});else fs.rmSync(file.path,{force:true});}}
  }else{
   const requestPath=path.resolve(required('request'));let record;
   if(command==='resume'){record=readJSON(requestPath);}
   else{
    const aliases={capture:'osf-capture',import:'osf-import-source',map:'osf-save-mapping',review:'osf-review-mapping',prepare:'osf-prepare-native',adopt:'osf-adopt-execution',compare:'osf-compare',reconcile:'osf-reconcile',handover:'osf-freeze-delivery',draft:'osf-save-draft',receive:'restore-file'};
    const action=command==='action'?required('action'):aliases[command];if(!action)throw Error('Use help for complete OSF commands.');
    let input=o.input?readJSON(o.input):{};
    if(command==='capture')input={...input,root_ids:required('roots').split(',').map(v=>v.trim()),name:required('name'),recursive:yes('recursive',true),include_versions:yes('include-versions',true),download_files:yes('download-files',true),...(o['file-keys']?{download_file_keys:readJSON(o['file-keys'])}:{}),...(o['token-env']?{token_env:o['token-env']}:{}),...(o['previous-source-id']?{previous_source_id:o['previous-source-id']}:{})};
    if(command==='import'){const bytes=sourceBytes(required('source'));input={...input,content_b64:bytes.toString('base64'),filename:path.basename(o.source),name:o.name||path.basename(o.source)};}
    const actor=required('actor'),current=workspace.state(),existing=fs.existsSync(requestPath)?readJSON(requestPath):null;
    input={...input,actor,operationId:o['operation-id']||existing?.input.operationId||randomUUID(),revision:existing?.input.revision??current.revision};
    let archive;
    if(command==='receive'){
     const filename=path.resolve(required('source')),preview=readJSON(required('preview')),actual=await fileHash(filename);
     if(actual.sha256!==preview.sha256||actual.bytes!==preview.bytes)throw Error('Choose the complete archive shown in the original preview.');
     input={actor,operationId:input.operationId,revision:input.revision,filename:path.basename(filename),source_sha256:actual.sha256};archive={path:filename,...actual};
    }
    record={schema:'osf-transition-original-command/v1',workspace:current.workspace,action,input,...(archive?{archive}:{}),created_at:existing?.created_at||new Date().toISOString()};
    retain(requestPath,encode(record));
   }
   if(record.schema!=='osf-transition-original-command/v1'||record.workspace?.id!==workspace.state().workspace.id||record.workspace?.directory!==workspace.directory)throw Error('The retained request belongs to a different original workspace.');
   const input=structuredClone(record.input);
   if(command==='resume'&&yes('rebase',false)&&!workspace.store.maybe('operations',input.operationId))input.revision=workspace.state().revision;
   if(record.action==='restore-file'){if(!record.archive)throw Error('The retained complete archive reference is missing.');const actual=await fileHash(record.archive.path);if(stable(actual)!==stable({sha256:record.archive.sha256,bytes:record.archive.bytes}))throw Error('The retained original archive changed.');result=await workspace.restoreFile(input,record.archive.path);}
   else result=await workspace.dispatch(record.action,input);
   const receiptPath=requestPath+'.result.json';if(!fs.existsSync(receiptPath))retain(receiptPath,encode({request:record,received_at:new Date().toISOString(),result}));
   result={...result,original_request:requestPath,retained_result:receiptPath};
  }
  if(o.output&&['read','operation','state'].includes(command))retain(o.output,encode(result));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }
}catch(error){process.stderr.write(JSON.stringify({error:error.code||'OSF_CLI_FAILED',message:error.message,current_revision:error.current_revision})+'\n');process.exitCode=1;}
finally{await workspace?.close();}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openWorkspace} from '../workspace.mjs';
import {digest} from '../patch.mjs';

const args=process.argv.slice(2),command=args.shift(),options={};
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||args[i+1]===undefined)throw new Error('Each option requires a value.');options[args[i].slice(2)]=args[i+1];}
const required=key=>{if(!options[key])throw new Error('--'+key+' is required.');return options[key];};
function localFile(root,relative){
 if(typeof relative!=='string'||path.isAbsolute(relative))throw new Error('Source file paths must be relative to the manifest.');
 const base=fs.realpathSync(root),target=fs.realpathSync(path.resolve(base,relative));
 if(target!==base&&!target.startsWith(base+path.sep))throw new Error('Source file path escapes the original manifest directory.');
 return fs.readFileSync(target);
}
function hydrate(filename){
 const full=path.resolve(filename),raw=fs.readFileSync(full),source=JSON.parse(raw),root=path.dirname(full);
 if(!['dspace-source-capture/v1','dspace-public-reader-capture/v1'].includes(source.schema)||!Array.isArray(source.requests))throw new Error('Use an original DSpace source manifest.');
 const requests=source.requests.map(r=>{
  if(r.body_base64!==undefined||r.body_text!==undefined||r.body!==undefined)return r;
  const bytes=localFile(root,r.body_file);
  if(r.body_sha256&&digest(bytes)!==r.body_sha256)throw new Error('Original response digest differs: '+r.body_file);
  return {...r,body_base64:bytes.toString('base64'),status:r.status??null,received_at:r.received_at??null,source_mode:r.source_mode??(source.schema==='dspace-public-reader-capture/v1'?'provider-extracted-native-json':'original-response-bytes')};
 });
 const files=(source.files||[]).map(f=>{
  if(f.content_b64)return f;
  const bytes=localFile(root,f.path);
  if(f.sha256&&digest(bytes)!==f.sha256)throw new Error('Original file digest differs: '+f.path);
  if(f.bytes!==undefined&&bytes.length!==f.bytes)throw new Error('Original file length differs: '+f.path);
  return {...f,content_b64:bytes.toString('base64')};
 });
 if(source.schema==='dspace-source-capture/v1'&&requests.every((r,i)=>r===source.requests[i])&&files.every((f,i)=>f===source.files[i]))return raw;
 return Buffer.from(JSON.stringify({...source,schema:'dspace-source-capture/v1',requests,files,source_manifest:{filename:path.basename(full),sha256:digest(raw),text:raw.toString('utf8')}})+'\n');
}
let workspace;
try{
 let result;
 if(command==='assemble-source'){
  const bytes=hydrate(required('source')),target=path.resolve(required('output'));
  fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});result={file:target,bytes:bytes.length,sha256:digest(bytes)};
 }else{
 workspace=await openWorkspace({directory:path.resolve(required('workspace'))});
 if(command==='state')result=workspace.state();
 else if(command==='read')result=workspace.read(required('kind'),required('id'),{offset:Number(options.offset||0),limit:Number(options.limit||50)});
 else if(command==='action'){
  const input=JSON.parse(fs.readFileSync(options.input?path.resolve(options.input):0,'utf8'));
  result=await workspace.dispatch(required('action'),input);
 }else if(command==='import-source'){
  const filename=required('source'),content=hydrate(filename);
  result=await workspace.dispatch('import-capture',{actor:required('actor'),operationId:required('operation-id'),revision:workspace.state().revision,filename:path.basename(filename),content_b64:content.toString('base64')});
 }else if(command==='export'){
  const file=await workspace.exportFile(required('kind'),options.id||'current'),target=path.resolve(required('output'));
  if(file.path){try{fs.copyFileSync(file.path,target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600);}finally{if(file.temporary)fs.rmSync(file.path,{force:true});}result={file:target,bytes:fs.statSync(target).size};}
  else {fs.writeFileSync(target,file.bytes,{mode:0o600,flag:'wx'});result={file:target,bytes:file.bytes.length,sha256:digest(file.bytes)};}
 }else if(command==='restore')result=await workspace.restoreFile({actor:required('actor'),operationId:required('operation-id'),revision:workspace.state().revision,filename:path.basename(required('source'))},path.resolve(options.source));
 else throw new Error('Use state, read, action, import-source, export, or restore.');
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write(JSON.stringify({error:error.code||'CLI_FAILED',message:error.message,current_revision:error.current_revision})+'\n');process.exitCode=1;}
finally{await workspace?.close();}


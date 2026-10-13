#!/usr/bin/env node
// MIT. Read-only selected repository pickup; original output is reopened on retry.
import {readFile,open,link,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {captureAlfrescoDocument,inspectAlfrescoDocument,normalizeAlfrescoRepository} from './alfresco-document.mjs';
async function publish(destination,text){
 const bytes=Buffer.from(text),directory=path.dirname(destination);await mkdir(directory,{recursive:true});
 const temporary=path.join(directory,'.document-'+randomUUID()+'.pending');let handle;
 try{
  handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,destination);}catch(e){if(e.code!=='EEXIST'||!bytes.equals(await readFile(destination)))throw e;}
  const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
 }finally{if(handle)await handle.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 return{path:destination,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function main(args=process.argv.slice(2)){
 const values={};while(args.length){const k=args.shift();if(!['--config','--out'].includes(k)||Object.hasOwn(values,k)||!args.length)throw Error('Use --config FILE --out FILE');values[k]=args.shift();}
 if(!values['--config']||!values['--out'])throw Error('Use --config FILE --out FILE');
 const configBytes=await readFile(path.resolve(values['--config']));if(configBytes.length>65536)throw Error('Configuration exceeds 64 KiB');
 const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configBytes)),destination=path.resolve(values['--out']);
 if(Object.keys(config).some(k=>!['repository','nodeId','versionId'].includes(k)))throw Error('Unsupported selected capture configuration');
 const selected=normalizeAlfrescoRepository(config.repository);
 try{
  const original=await readFile(destination,'utf8'),view=inspectAlfrescoDocument(original);
  if(view.repository.id!==selected.id||view.repository.baseUrl!==selected.baseUrl||view.selection.nodeId!==config.nodeId||view.selection.versionId!==config.versionId)throw Error('Existing output belongs to another original selection');
  return{state:'REOPENED',path:destination,...view.capture};
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const controller=new AbortController(),stop=()=>controller.abort(Error('Original capture interrupted'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const result=await captureAlfrescoDocument({...config,signal:controller.signal});
  return{state:'CAPTURED',...await publish(destination,result.text)};
 }catch(error){
  if(error.capture)error.retainedFailure=await publish(destination+'.failed-'+randomUUID()+'.json',JSON.stringify(error.capture,null,2)+'\n');
  throw error;
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(JSON.stringify({state:'CAPTURE_REVIEW_REQUIRED',message:e.message,retainedFailure:e.retainedFailure??null})+'\n');process.exitCode=2;});
}

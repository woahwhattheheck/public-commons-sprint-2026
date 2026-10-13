#!/usr/bin/env node
// MIT. One bounded, resumable read-only cohort through the original selected-version capture.
import {constants} from 'node:fs';
import {mkdir,open,link,unlink,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseInterfaceJSON} from './interface-contract-v2.mjs';
import {operationLease} from '../../../distribution/runtime-workspace/storage.mjs';
import {captureAlfrescoDocument,inspectAlfrescoDocument,documentMember,normalizeAlfrescoRepository} from './alfresco-document.mjs';
import {DOCUMENT_COMPARISON_SCHEMA,inspectDocumentComparisonSource,createDocumentComparisonDelivery} from './document-comparison.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(v,m)=>{if(!v)throw Error(m);};
async function read(file,max){const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await h.stat();need(s.isFile()&&s.size<=max,'Select a bounded ordinary file');const b=await h.readFile();need(b.length===s.size,'Source file changed while reading');return b;}finally{await h.close();}}
async function retain(file,bytes){
 const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),pending=file+'.pending-'+randomUUID();let h;
 try{h=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await h.writeFile(b);await h.sync();await h.close();h=null;
  try{await link(pending,file);}catch(e){if(e.code!=='EEXIST')throw e;const old=await read(file,128*1024*1024);need(old.length===b.length&&sha(old)===sha(b),'Different saved source already exists: '+path.basename(file));}
  const d=await open(path.dirname(file),constants.O_RDONLY|constants.O_DIRECTORY);try{await d.sync();}finally{await d.close();}
 }finally{await h?.close();await unlink(pending).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export async function captureDocumentComparison({planFile,output,environment=process.env,fetch,signal}){
 const bytes=await read(path.resolve(planFile),512*1024),plan=parseInterfaceJSON(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),'comparison capture plan');
 need(plan.schema==='stellar-forge.document-comparison-capture-plan.v1'&&Array.isArray(plan.repositories),'Select the original cohort capture plan');
 const repositories=new Map();for(const r of plan.repositories){const c=normalizeAlfrescoRepository(r);need(!repositories.has(c.id),'Duplicate repository identity');repositories.set(c.id,c);}
 need(plan.selection&&Array.isArray(plan.selection.pairs),'Select the exact original comparison selection');
 // Validate all paths and mappings before any repository request.
 const skeleton={schema:DOCUMENT_COMPARISON_SCHEMA,selectionText:JSON.stringify({...plan.selection,pairs:plan.selection.pairs.map(p=>({...p,sourceMember:null,targetMember:null}))},null,2)+'\n',members:[]};
 inspectDocumentComparisonSource(JSON.stringify(skeleton));
 const wanted=new Map();
 for(const pair of plan.selection.pairs)for(const side of ['source','target']){
  const name=pair[side+'Member'];if(name===null)continue;
  need(typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,119}\.json$/.test(name),'Use a portable original capture filename');
  const selected=pair[side],repository=repositories.get(selected.repositoryId);
  need(repository?.baseUrl===selected.repositoryBaseUrl,'Selected capture belongs to a different configured repository');
  const identity=JSON.stringify([selected.repositoryId,selected.repositoryBaseUrl,selected.nodeId,selected.versionId]);if(wanted.has(name))need(wanted.get(name).identity===identity,'A member names different native versions');
  else wanted.set(name,{identity,selected,repository});
 }
 const out=path.resolve(output);await mkdir(out,{recursive:true,mode:0o700});need((await lstat(out)).isDirectory()&&!(await lstat(out)).isSymbolicLink(),'Select an owned ordinary output directory');
 const lease=await operationLease(path.join(out,'capture-document-comparison.lock'));let result,error;
 try{
  await retain(path.join(out,'capture-plan.json'),bytes);
  const members=[];
  for(const [name,item]of wanted){
   signal?.throwIfAborted();const file=path.join(out,name);let body;
   try{body=await read(file,16*1024*1024);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(body===undefined){
    try{const captured=await captureAlfrescoDocument({repository:item.repository,nodeId:item.selected.nodeId,versionId:item.selected.versionId,environment,fetch,signal});body=Buffer.from(captured.text);await retain(file,body);}
    catch(e){if(e.capture)await retain(path.join(out,'failed-'+randomUUID()+'.json'),JSON.stringify(e.capture,null,2)+'\n');throw e;}
   }
   const inspected=inspectAlfrescoDocument(body.toString('utf8'));
   need(JSON.stringify([inspected.repository.id,inspected.repository.baseUrl,inspected.selection.nodeId,inspected.selection.versionId])===item.identity,'Saved capture differs from its selected native identity');
   members.push(documentMember(name,body));
  }
  const sourceText=JSON.stringify({schema:DOCUMENT_COMPARISON_SCHEMA,selectionText:JSON.stringify(plan.selection,null,2)+'\n',members},null,2)+'\n';
  const delivery=createDocumentComparisonDelivery({sourceText});
  await retain(path.join(out,'comparison-source.json'),sourceText);
  await retain(path.join(out,'comparison-delivery.json'),delivery.text);
  result={schema:'stellar-forge.document-comparison-captured.v1',source:{path:path.join(out,'comparison-source.json'),bytes:Buffer.byteLength(sourceText),sha256:sha(sourceText)},delivery:{path:path.join(out,'comparison-delivery.json'),bytes:delivery.bytes,sha256:delivery.sha256},counts:delivery.report.counts};
 }catch(e){error=e;}
 try{await lease.close();}catch(e){error??=e;}
 if(error)throw error;
 await retain(path.join(out,'capture-result.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2){need(['--plan','--out'].includes(args[i])&&args[i+1],'Use --plan FILE --out OWNED_DIRECTORY');opts[args[i]]=args[i+1];}
 need(opts['--plan']&&opts['--out'],'Use --plan FILE --out OWNED_DIRECTORY');
 const abort=new AbortController(),stop=()=>abort.abort(new Error('Original read-only capture interrupted; reopen the same output to retain completed selected captures.'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{process.stdout.write(JSON.stringify(await captureDocumentComparison({planFile:opts['--plan'],output:opts['--out'],signal:abort.signal}),null,2)+'\n');}
 catch(e){process.stderr.write(JSON.stringify({error:e.code??'DOCUMENT_COMPARISON_CAPTURE_FAILED',message:e.message})+'\n');process.exitCode=1;}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}

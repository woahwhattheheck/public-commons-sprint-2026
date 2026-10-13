#!/usr/bin/env node
/** Compose complete original receiver postimages and exact customer course input. */
import fs from 'node:fs';
import {resolve,join,dirname,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const HERE=dirname(fileURLToPath(import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
function file(path){const s=fs.lstatSync(path);need(s.isFile()&&!s.isSymbolicLink(),'Choose the ordinary complete original file: '+path);return fs.readFileSync(path);}
function directory(path){const s=fs.lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink(),'Choose an ordinary complete source directory.');return fs.realpathSync(path);}
function child(root,name){need(typeof name==='string'&&name&&!isAbsolute(name)&&!name.split(/[\\/]/).some(x=>!x||x==='..')&&!/[:\u0000-\u001f]/.test(name),'Choose an original relative file name.');const path=resolve(root,name);need(path.startsWith(root+sep),'Keep the file in its original directory.');return path;}
function publish(root,name,bytes){
 const target=child(root,name),parent=dirname(target);fs.mkdirSync(parent,{recursive:true});
 const real=fs.realpathSync(parent);need(real===root||real.startsWith(root+sep),'Keep the complete output in its selected directory.');
 try{const old=file(target);need(old.equals(bytes),'Retain the existing complete output edition: '+name);return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const temporary=target+'.'+randomUUID()+'.candidate';
 try{
  const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.linkSync(temporary,target);}catch(e){if(e.code!=='EEXIST'||!file(target).equals(bytes))throw e;}
 }finally{fs.rmSync(temporary,{force:true});}
}
function parse(argv){need(argv.length%2===0,'Use --source ABS_NATIVE_SOURCE --customer-source ABS_CUSTOMER_FILES --out ABS_OVERLAY --installed-source ABS_COMPOSED_NATIVE_SOURCE.');
 const o={};for(let i=0;i<argv.length;i+=2){need(['--source','--customer-source','--out','--installed-source'].includes(argv[i])&&!o[argv[i]]&&isAbsolute(argv[i+1]||''),'Use each complete absolute source/output argument once.');o[argv[i]]=resolve(argv[i+1]);}
 for(const name of ['--source','--customer-source','--out','--installed-source'])need(o[name],'Supply '+name+'.');return o;}
export function compose(argv=process.argv.slice(2)){
 const args=parse(argv),source=directory(args['--source']),customers=directory(args['--customer-source']);
 const manifest=JSON.parse(file(join(HERE,'integration.json'))),outputs=new Map(),originals=[];
 for(const entry of manifest.sources){
  const raw=file(child(source,entry.path)),digest=sha(raw);let text=raw.toString('utf8');need(Buffer.from(text).equals(raw),'Retain full UTF-8 native source.');
  if(digest===entry.preimage){for(const [before,after]of entry.replacements){need(text.split(before).length===2,'Reconcile the changed original native source before composing: '+entry.path);text=text.replace(before,()=>after);}}
  else need(digest===entry.postimage,'The native source is another complete edition: '+entry.path);
  const body=Buffer.from(text);need(sha(body)===entry.postimage,'The composed complete native source differs.');outputs.set(entry.path,body);originals.push({path:entry.path,sha256:digest,bytes:raw.length});
 }
 for(const entry of manifest.modules){const raw=file(join(HERE,entry.source));need(sha(raw)===entry.sha256,'The complete receiving module changed: '+entry.source);outputs.set(entry.path,raw);}
 const courses=[];
 for(const spec of manifest.customers){
  const sourceDirectory=directory(child(customers,spec.directory)),recordPath=child(sourceDirectory,spec.record),recordBytes=file(recordPath),record=JSON.parse(recordBytes);
  need(record.version==='dealscout.lead-working-record.v1'&&record.pack?.id&&Array.isArray(record.customer_files),'Select the complete original customer working record.');
  const files=record.customer_files.map(item=>{const d=item.document;need(d&&typeof d.name==='string'&&Number.isSafeInteger(d.bytes)&&/^[a-f0-9]{64}$/.test(d.sha256||''),'Retain each full customer-file identity.');const raw=file(child(sourceDirectory,d.name));need(raw.length===d.bytes&&sha(raw)===d.sha256,'The original customer file differs: '+d.name);return {path:d.name,bytes:d.bytes,sha256:d.sha256};});
  const module=manifest.modules.find(row=>row.source===spec.module);
  courses.push({id:spec.id,pack_id:record.pack.id,module:resolve(args['--installed-source'],module.path),export_name:spec.export_name,sha256:module.sha256,source_directory:sourceDirectory,source_files:files,
    original_working_record:{path:recordPath,bytes:recordBytes.length,sha256:sha(recordBytes),seal:record.sha256}});
 }
 outputs.set('receiving/customer-courses.json',Buffer.from(JSON.stringify({schema:'commons.customer-working-course-selection.v1',customer_courses:courses},null,2)+'\n'));
 fs.mkdirSync(args['--out'],{recursive:true,mode:0o700});const out=directory(args['--out']);
 // Read every existing destination before publishing any complete file.
 for(const [name,body]of outputs){try{need(file(child(out,name)).equals(body),'A different complete output is already retained: '+name);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const receipt={schema:'commons.customer-working-course-composition.v1',native_source:source,installed_source:args['--installed-source'],customer_source:customers,originals,
  files:[...outputs].map(([path,b])=>({path,bytes:b.length,sha256:sha(b)})),selection:'receiving/customer-courses.json'};
 outputs.set('COMPOSITION.json',Buffer.from(JSON.stringify(receipt,null,2)+'\n'));
 for(const [name,body]of outputs)publish(out,name,body);
 return {...receipt,output_directory:out};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(compose(),null,2)+'\n');}catch(error){process.stderr.write(JSON.stringify({error:error.name,message:error.message})+'\n');process.exitCode=1;}
}

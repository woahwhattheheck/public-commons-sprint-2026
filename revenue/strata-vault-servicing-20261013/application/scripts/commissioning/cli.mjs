#!/usr/bin/env node
import * as fs from 'node:fs';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {check,hash,canonical,copy,requestFor,validateRequest,publicDeployment} from './selection.mjs';
import {capture,createStellarTransport,validateCapture} from './capture.mjs';
import {assess,renderReport,csv} from './report.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),MAX_FILE=16*1024*1024,MAX_CAPTURE=64*1024*1024;
function digest(b){return createHash('sha256').update(b).digest('hex');}
function sizeLimit(bytes,max,label){check(bytes.length<=max,label+' exceeds its complete byte bound.');}
function readExact(path,max=MAX_FILE){const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);check(stat.isFile()&&stat.size<=max,'Expected a bounded regular file: '+path);const b=fs.readFileSync(fd);sizeLimit(b,max,path);return b;}finally{fs.closeSync(fd);}}
function readJSON(path,max){return JSON.parse(readExact(path,max).toString('utf8'));}
function ensureDir(path){try{fs.mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=fs.lstatSync(path);check(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0,'Receiving directory must be a private0700 directory: '+path);}
function syncDirectory(path){const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function destination(root,name){check(typeof name==='string'&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unsafe owned output member.');const path=join(root,...name.split('/'));let d=root;for(const p of name.split('/').slice(0,-1)){d=join(d,p);ensureDir(d);}return path;}
function publish(root,name,bytes,max=MAX_FILE){
 const path=destination(root,name),body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);sizeLimit(body,max,name);
 if(fs.existsSync(path)){check(readExact(path,max).equals(body),'A different accepted artifact already owns '+name);return;}
 const temp=join(dirname(path),'.'+randomUUID()+'.part'),fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{try{fs.linkSync(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;check(readExact(path,max).equals(body),'Concurrent accepted postimage differs: '+name);}syncDirectory(dirname(path));}finally{fs.unlinkSync(temp);}
}
function json(v){return canonical(v)+'\n';}
function sourceManifest(repoRoot){
 const anchors=readJSON(join(HERE,'SOURCE_ANCHORS.json'));const root=fs.realpathSync(repoRoot);
 for(const f of anchors.files){const p=resolve(root,f.path);check(relative(root,p)!=='..'&&!relative(root,p).startsWith('..'+sep)&&fs.realpathSync(p)===p,'Source path escaped the selected repository.');const b=readExact(p);check(b.length===f.bytes&&digest(b)===f.sha256,'Current source differs from the selected commissioning adapter: '+f.path);}
 return anchors;
}
function receiverManifest(){return ['selection.mjs','capture.mjs','report.mjs','cli.mjs','SOURCE_ANCHORS.json'].map(path=>{const b=readExact(join(HERE,path));return{path,bytes:b.length,sha256:digest(b)};});}
function retainOriginalReceiver(root,mayCreate){
 const path=join(root,'.receiver-source.json');let bank;
 try{bank=readJSON(path);}catch(error){
  if(error.code!=='ENOENT')throw error;
  check(mayCreate&&!fs.existsSync(join(root,'request.json'))&&!fs.existsSync(join(root,'complete.json')),'The original receiver source is missing; preserve this existing operation and receive its actual original source, not a newer substitute.');
  const files=receiverManifest().map(m=>({...m,content:readExact(join(HERE,m.path)).toString('utf8')}));
  const body={schema:'strata.original-commissioning-receiver/v1',files};bank={...body,sha256:hash(body)};
  publish(root,'.receiver-source.json',JSON.stringify(bank,null,2)+'\n');
 }
 const{sha256,...body}=bank;check(bank.schema==='strata.original-commissioning-receiver/v1'&&hash(body)===sha256,'Original receiver envelope differs.');
 const required=['selection.mjs','capture.mjs','report.mjs','cli.mjs','SOURCE_ANCHORS.json'];
 check(Array.isArray(bank.files)&&bank.files.length===required.length&&new Set(bank.files.map(f=>f.path)).size===required.length,'Complete original receiver closure required.');
 for(const f of bank.files){check(required.includes(f.path),'Unknown original receiver member.');const b=Buffer.from(f.content);check(b.length===f.bytes&&digest(b)===f.sha256,'Original receiver body mismatch: '+f.path);publish(root,'.receiver/'+f.path,b);}
 return bank;
}
async function originalRoute(command,options,argv){
 const root=resolve(options['--output']);check(process.platform!=='win32','Use the original POSIX/Linux/WSL receiver environment.');
 check(fs.realpathSync(dirname(root))===dirname(root),'Receiving parent must be an existing real path.');ensureDir(root);check(fs.realpathSync(root)===root,'Receiving root may not be a symlink.');
 const bank=retainOriginalReceiver(root,command==='capture');
 if(HERE===join(root,'.receiver'))return null;
 const original=await import(pathToFileURL(join(root,'.receiver','cli.mjs')).href);
 return{routed:true,result:await original.main([...argv])};
}
function validateOriginalReceiver(result,io){check(canonical(result.receiverSource)===canonical(io.receiverSource),'The capture belongs to a different original receiver.');}
function openStore(root,source){
 check(process.platform!=='win32','This private-file receiver requires a POSIX Node environment; run in the original selected Linux/WSL environment.');
 const out=resolve(root);check(fs.realpathSync(dirname(out))===dirname(out),'Output parent must be a real existing path.');ensureDir(out);check(fs.realpathSync(out)===out,'Output may not resolve through symlinks.');
 return{root:out,source,receiverSource:receiverManifest(),read:async name=>{const path=destination(out,name);try{return readJSON(path,name==='complete.json'?MAX_CAPTURE:MAX_FILE);}catch(e){if(e.code==='ENOENT')return null;throw e;}},publish:async(name,value)=>publish(out,name,json(value),name==='complete.json'?MAX_CAPTURE:MAX_FILE)};
}
function expectedArtifacts(result){
 validateCapture(result);const outputs={'capture.json':JSON.stringify(result,null,2)+'\n','assessment.json':JSON.stringify(assess(result),null,2)+'\n','report.html':renderReport(result),'settings.csv':csv(result)};
 const manifest={schema:'strata.commissioning-artifacts/v1',captureSha256:result.sha256,operationId:result.request.operationId,completedAt:result.completedAt,files:[]};
 for(const[path,text]of Object.entries(outputs)){const bytes=Buffer.from(text);sizeLimit(bytes,MAX_CAPTURE,path);manifest.files.push({path,bytes:bytes.length,sha256:digest(bytes)});}
 return{outputs,manifest};
}
function verifyArtifacts(root,result){
 const{outputs,manifest}=expectedArtifacts(result),actual=readJSON(join(root,'report','ARTIFACTS.json'));
 check(canonical(actual)===canonical(manifest),'Artifact manifest differs from the original renderer output.');
 for(const[path,text]of Object.entries(outputs))check(readExact(join(root,'report',path),MAX_CAPTURE).equals(Buffer.from(text)),'Artifact differs from the complete original renderer output: '+path);
 return manifest;
}
function artifacts(root,result){
 const{outputs,manifest}=expectedArtifacts(result);
 // Freeze the complete intended member manifest before publishing any member.
 publish(root,'report/ARTIFACTS.json',JSON.stringify(manifest,null,2)+'\n');
 for(const[path,text]of Object.entries(outputs))publish(root,'report/'+path,text,MAX_CAPTURE);
 return verifyArtifacts(root,result);
}
export async function main(argv=process.argv.slice(2)){
 const originalArgs=[...argv],command=argv.shift(),options={};while(argv.length){const key=argv.shift();check(/^--[a-z-]+$/.test(key)&&argv.length,'Use named --key value arguments.');check(!Object.hasOwn(options,key),'Duplicate option.');options[key]=argv.shift();}
 if(command==='project'){check(Object.keys(options).every(k=>['--deployment','--output'].includes(k))&&options['--deployment']&&options['--output'],'project requires --deployment and --output.');const publicRecord=publicDeployment(readJSON(options['--deployment']));const output=resolve(options['--output']);ensureDir(dirname(output));publish(dirname(output),output.slice(dirname(output).length+1),JSON.stringify(publicRecord,null,2)+'\n');return{status:'PUBLIC_DEPLOYMENT_PROJECTED',output};}
 check(['capture','render','verify'].includes(command),'Commands: project, capture, render, verify.');
 check(Object.keys(options).every(k=>['--output','--selection','--operation','--repo-root'].includes(k))&&options['--output'],'An explicit --output directory is required.');
 const routed=await originalRoute(command,options,originalArgs);if(routed)return routed.result;
 if(command==='capture'){
  check(options['--selection']&&options['--operation']&&options['--repo-root'],'capture requires --selection, --operation, --repo-root and --output.');
  const io=openStore(options['--output'],null),selected=readJSON(options['--selection']);
  const old=await io.read('request.json'),request=old?validateRequest(old):requestFor(selected,options['--operation'],new Date().toISOString());
  check(request.operationId===options['--operation']&&canonical(request.selection)===canonical(selected),'Retained operation or selection differs; keep the original capture directory.');
  const done=await io.read('complete.json');let result;
  if(done){result=validateCapture(done,request);validateOriginalReceiver(result,io);}
  else{io.source=sourceManifest(options['--repo-root']);const transport=await createStellarTransport(request.selection,{moduleRoot:options['--repo-root']});result=await capture(request,transport,io,{attemptId:randomUUID});}
  const delivered=artifacts(io.root,result);return{status:'CAPTURE_AND_ARTIFACTS_RETAINED',operationId:request.operationId,captureSha256:result.sha256,assessment:assess(result).counts,manifest:delivered};
 }
 check(Object.keys(options).length===1,'render/verify accept only --output and do not use network or source files.');
 const io=openStore(options['--output'],null),result=await io.read('complete.json');check(result,'No complete accepted capture exists.');validateCapture(result);validateOriginalReceiver(result,io);
 if(command==='render')return{status:'ARTIFACTS_REOPENED',manifest:artifacts(io.root,result)};
 verifyArtifacts(io.root,result);
 return{status:'COMPLETE_CAPTURE_AND_FOUR_ARTIFACTS_VERIFIED',operationId:result.request.operationId,captureSha256:result.sha256,assessment:assess(result).counts};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(r=>console.log(JSON.stringify(r,null,2))).catch(error=>{console.error(String(error?.message||error));process.exitCode=1;});

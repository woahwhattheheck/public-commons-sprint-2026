#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as engine from './engine.mjs';
import * as workOrders from './work-orders.mjs';
import {sha256Utf8,sha256Bytes} from './sha256.mjs';
import {inflateRawSync} from 'node:zlib';
import {createIssuerAnnex} from './issuer-annex.mjs';
const A=createIssuerAnnex(engine,{sha256Utf8,sha256Bytes});

const need=(ok,message)=>{if(!ok)throw Error(message);};
const optionalText=file=>{try{return fs.readFileSync(file,'utf8').trim();}catch{return null;}};
const runtime=()=>({hostname:os.hostname(),bootId:optionalText('/proc/sys/kernel/random/boot_id'),pidNamespace:(()=>{try{return fs.readlinkSync('/proc/self/ns/pid');}catch{return null;}})()});
function regularBytes(file){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink(),'Use a complete regular file: '+file);return fs.readFileSync(file);}
function regular(file){const b=regularBytes(file),text=b.toString('utf8');need(Buffer.from(text,'utf8').equals(b),'Use complete original UTF-8 text: '+file);return text;}
function exists(file){try{return regular(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function absolute(value,label){need(typeof value==='string'&&path.isAbsolute(value),'Use an absolute '+label+'.');return path.resolve(value);}
function durableDirectory(directory){let fd;try{fd=fs.openSync(directory,'r');fs.fsyncSync(fd);}catch(e){if(!['EINVAL','EPERM','EISDIR','ENOTSUP'].includes(e.code))throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}
function publishBytes(file,bytes){
 let current;try{current=regularBytes(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(current){need(current.equals(bytes),'An existing output contains another complete edition: '+file);return;}
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.candidate';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;try{fs.linkSync(temp,file);}catch(e){if(e.code!=='EEXIST'||!regularBytes(file).equals(bytes))throw e;}durableDirectory(path.dirname(file));}
 finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temp,{force:true});}
}
function publish(file,text){publishBytes(file,Buffer.from(text,'utf8'));}
function replace(file,before,after){const temp=file+'.'+randomUUID()+'.candidate';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,after,'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;need(regular(file)===before,'The original workspace changed during this operation.');fs.renameSync(temp,file);durableDirectory(path.dirname(file));}
 finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temp,{force:true});}
}
function lockPath(workspace){return workspace+'.lock';}
function locked(workspace,fn){fs.mkdirSync(path.dirname(workspace),{recursive:true,mode:0o700});const file=lockPath(workspace),owner={schema:'tjlabs.fixed-asset-cli-lock.v1',token:randomUUID(),pid:process.pid,...runtime(),startedAt:new Date().toISOString()};let fd;
 try{fd=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('The original workspace has a saved CLI lock. Preserve its owner; inspect '+file+' and use recover-lock with its exact token only after that process has ended.');throw e;}
 const lockIdentity=fs.fstatSync(fd);
 try{fs.writeFileSync(fd,JSON.stringify(owner)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;return fn();}
 finally{if(fd!==undefined)fs.closeSync(fd);let current;try{current=fs.lstatSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}if(current&&current.dev===lockIdentity.dev&&current.ino===lockIdentity.ino)fs.unlinkSync(file);}
}
function recoverLock(workspace,token){const file=lockPath(workspace),raw=regular(file),owner=JSON.parse(raw),current=runtime();need(owner.schema==='tjlabs.fixed-asset-cli-lock.v1'&&owner.token===token,'Use the exact original lock token.');
 need(owner.hostname===current.hostname&&owner.pidNamespace===current.pidNamespace,'Recover this lock only on its original host and PID namespace.');
 if(owner.bootId===current.bootId){let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}need(!alive,'The original lock process is still present.');}
 need(regular(file)===raw,'The original lock changed.');fs.unlinkSync(file);return {state:'LOCK_RECOVERED',token,workspace};
}
function args(argv){const command=argv.shift(),options={};need(command,'Choose init, import, map, correct, policy, supporting, inspect, reconcile, handover, receive, templates issuer-import, issuer-select, issuer-review, issuer-inspect or recover-lock.');
 need(argv.length%2===0,'Supply every flag with one value.');
 for(let i=0;i<argv.length;i+=2){need(argv[i].startsWith('--')&&!Object.hasOwn(options,argv[i]),'Supply each named option once.');options[argv[i]]=argv[i+1];}
 return {command,options};
}
function output(file,value){publish(absolute(file,'output file'),JSON.stringify(value,null,2)+'\n');}
export function main(argv=process.argv.slice(2)){
 const {command,options:o}=args(argv.slice()),workspace=o['--workspace']?absolute(o['--workspace'],'workspace path'):null;
 if(command==='templates'){const root=absolute(o['--out'],'template directory');for(const domain of Object.keys(engine.DOMAINS))publish(path.join(root,domain+'.csv'),engine.templateCsv(domain));return {state:'COMPLETE',directory:root,templates:Object.keys(engine.DOMAINS)};}
 if(command==='wo-templates'){const root=absolute(o['--out'],'template directory');for(const domain of Object.keys(workOrders.FIELDS))publish(path.join(root,'work-order-'+domain+'.csv'),workOrders.templateCsv(domain));return {state:'COMPLETE',directory:root};}
 need(workspace,'Supply --workspace ABS_WORKSPACE_JSON.');
 if(command==='recover-lock')return recoverLock(workspace,o['--token']);
 if(command==='init')return locked(workspace,()=>{
  need(exists(workspace)===null,'The original workspace already exists; reopen it.');
  const value=engine.createWorkspace({id:o['--id'],title:o['--title'],createdAt:o['--at']||new Date().toISOString()});publish(workspace,engine.exportWorkspace(value));return{state:'CREATED',workspace,id:value.id,revision:0};
 });
 if(command==='receive')return locked(workspace,()=>{
  const input=absolute(o['--input'],'complete portable workspace'),raw=regular(input),incoming=engine.importWorkspace(raw),old=exists(workspace);
  if(old!==null){const current=engine.importWorkspace(old);need(current.id===incoming.id&&current.createdAt===incoming.createdAt&&current.title===incoming.title,'The destination contains another original migration.');
   need(current.revision>=incoming.revision&&JSON.stringify(current.operations.slice(0,incoming.operations.length))===JSON.stringify(incoming.operations),'The existing workspace has a different history. Select a new destination for independent review.');
   return{state:'RETAINED',workspace,id:current.id,revision:current.revision,incomingRevision:incoming.revision};
  }
  publish(workspace,engine.exportWorkspace(incoming));return{state:'RECEIVED',workspace,id:incoming.id,revision:incoming.revision};
 });
 if(['import','map','correct','policy','supporting','issuer-import','issuer-select','issuer-review'].includes(command))return locked(workspace,()=>{
  const before=regular(workspace),ws=engine.importWorkspace(before),request=JSON.parse(regular(absolute(o['--request'],'saved request JSON')));
  let result;
  if(command==='import'){const csv=absolute(o['--csv'],'original CSV');need(request.text===undefined,'Keep the original CSV in --csv, separate from the saved import request.');result=engine.importCsv(ws,{...request,filename:request.filename||path.basename(csv),text:regular(csv)});}
  else if(command==='map')result=engine.saveMapping(ws,request);
  else if(command==='correct')result=engine.saveCorrection(ws,request);
  else if(command==='policy')result=engine.saveFinancePolicy(ws,request);
  else if(command==='issuer-import'){
   const original=absolute(o['--file'],'complete issuer carrier'),raw=regular(original);let text=raw;
   if(!raw.trimStart().startsWith('{')){const blocks=[...raw.matchAll(/`{3}base64-deflate\s+([\s\S]*?)`{3}/g)];need(blocks.length===1,'Choose the one complete original Canvas source carrier.');const encoded=blocks[0][1].replace(/\s/g,'');need(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded),'The original compressed source is incomplete.');const expanded=inflateRawSync(Buffer.from(encoded,'base64'),{maxOutputLength:engine.LIMITS.supportingBytes});text=expanded.toString('utf8');need(Buffer.from(text,'utf8').equals(expanded),'Retain complete UTF-8 source.');}
   A.packet(text);result=A.attach(ws,{...request,filename:request.filename||(text===raw?path.basename(original):'Issuer_Accounting_Source.json'),text});
   if(text!==raw){const firstReplayed=result.replayed;result=engine.importSupportingFile(result.workspace,{operationId:'issuer-transport-'+sha256Utf8(request.operationId).sha256.slice(0,40),expectedRevision:request.expectedRevision+1,at:request.at,filename:path.basename(original),mimeType:'text/markdown',purpose:'Original issuer source transport; decoded complete source retained separately',base64:Buffer.from(raw,'utf8').toString('base64')});result.replayed=result.replayed&&firstReplayed;}
  }
  else if(command==='issuer-select')result=A.select(ws,request);
  else if(command==='issuer-review')result=A.review(ws,request);
  else {
   const original=absolute(o['--file'],'complete supporting file');need(request.base64===undefined,'Keep the original bytes in --file, separate from the saved supporting-file request.');
   const bytes=regularBytes(original);need(bytes.length<=engine.LIMITS.supportingBytes,'Choose a complete supporting file within32 MiB.');
   result=engine.importSupportingFile(ws,{...request,filename:request.filename||path.basename(original),base64:bytes.toString('base64')});
  }
  if(!result.replayed)replace(workspace,before,engine.exportWorkspace(result.workspace));
  return{state:result.replayed?'REPLAYED':'SAVED',workspace,id:result.workspace.id,revision:result.workspace.revision,receipt:result.receipt};
 });
 if(command.startsWith('wo-')&&!['wo-report','wo-inspect'].includes(command))return locked(workspace,()=>{
  const before=regular(workspace),ws=engine.importWorkspace(before),request=JSON.parse(regular(absolute(o['--request'],'saved work-order request JSON'))),action=command.slice(3);
  if(['import','allocate-batch','match-batch','order-match-batch'].includes(action)){need(request.text===undefined,'Keep original CSV bytes in --csv.');const csv=absolute(o['--csv'],'complete original CSV');request.filename=request.filename||path.basename(csv);request.text=regular(csv);}
  const result=workOrders.run(ws,action,request);if(!result.replayed)replace(workspace,before,engine.exportWorkspace(result.workspace));
  return{state:result.replayed?'REPLAYED':'SAVED',workspace,id:result.workspace.id,revision:result.workspace.revision,receipt:result.receipt,result:result.workOrderResult};
 });
 const ws=engine.importWorkspace(regular(workspace));
 if(command==='wo-report'){const report=workOrders.reconcile(ws);output(o['--out'],report);return {state:'RECONCILED',workspace,revision:ws.revision,ready:report.ready,accepted:report.accepted,summary:report.summary};}
 if(command==='wo-inspect')return workOrders.read(ws);
 if(command==='issuer-inspect')return A.assessment(ws);
 if(command==='inspect')return{id:ws.id,title:ws.title,revision:ws.revision,sources:ws.sources.map(({text,rows,...x})=>({...x,rowCount:rows.length})),mappings:ws.mappings,corrections:ws.corrections,financePolicies:ws.financePolicies,financePolicyHistory:ws.financePolicyHistory,supportingFiles:ws.supportingFiles.map(({base64,...f})=>f),financeBasis:engine.financeBasis(ws),operations:ws.operations};
 if(command==='reconcile'){const report=engine.reconcile(ws);output(o['--out'],report);return{state:'RECONCILED',workspace,revision:ws.revision,ready:report.ready,summary:report.summary,report:absolute(o['--out'],'report output')};}
 if(command==='handover'){
  const root=absolute(o['--out'],'handover directory'),packet=A.handover(ws,workOrders.buildHandover(ws));
  const codeRoot=path.dirname(fileURLToPath(import.meta.url)),read=name=>regular(path.join(codeRoot,name));
  const data={schema:'tjlabs.fixed-asset-finance-browser.v1',copyId:'exit-'+ws.id+'-'+ws.revision,portable:engine.exportWorkspace(ws),engineSource:read('engine.mjs'),shaSource:read('sha256.mjs'),appSource:read('app.mjs'),issuerSource:read('issuer-annex.mjs'),issuerUISource:read('issuer-ui.mjs'),workOrderSource:read('work-orders.mjs'),workOrderUISource:read('work-orders-ui.mjs')};
  const html=read('template.html').replace('__STYLES__',()=>read('styles.css')).replace('__BOOTSTRAP__',()=>JSON.stringify(data).replace(/</g,'\\u003c'));
  packet.files=packet.files.filter(f=>f.path!=='MANIFEST.json');packet.files.push({path:'Fixed_Asset_Finance_Workspace.html',type:'text/html;charset=utf-8',text:html,...sha256Utf8(html)});packet.manifest.files=packet.files.map(({text,base64,...f})=>f);const manifestText=JSON.stringify(packet.manifest,null,2)+'\n';packet.files.push({path:'MANIFEST.json',type:'application/json',text:manifestText,...sha256Utf8(manifestText)});
  fs.mkdirSync(root,{recursive:true,mode:0o700});const st=fs.lstatSync(root);need(st.isDirectory()&&!st.isSymbolicLink(),'Use an ordinary handover directory.');
  // Every complete member is immutable; interrupted publication reuses exact prior members.
  for(const f of packet.files){const target=path.resolve(root,f.path);need(target.startsWith(root+path.sep),'Retain the original handover directory.');fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const actualRoot=fs.realpathSync(root),actualParent=fs.realpathSync(path.dirname(target));need(actualParent===actualRoot||actualParent.startsWith(actualRoot+path.sep),'Keep complete handover members in their original directory.');if(f.base64!==undefined)publishBytes(target,Buffer.from(f.base64,'base64'));else publish(target,f.text);}
  return{state:'COMPLETE',workspaceId:ws.id,revision:ws.revision,ready:packet.ready,directory:root,files:packet.files.map(({text,base64,...f})=>f)};
 }
 throw Error('Unknown command: '+command);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(main(),null,2)+'\n');}
 catch(e){process.stderr.write(JSON.stringify({error:e.code||e.name,message:e.message,...(e.details?{details:e.details}:{})})+'\n');process.exitCode=1;}
}

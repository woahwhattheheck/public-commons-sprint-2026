#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as engine from './engine.mjs';
import {parseRecovery,recovery,json,RECOVERY_SCHEMA,head} from './portable.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const sha=b=>createHash('sha256').update(b).digest('hex');
function regularBytes(file){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink(),'Use a complete regular file: '+file);return fs.readFileSync(file);}
function regular(file){const b=regularBytes(file),text=b.toString('utf8');need(Buffer.from(text,'utf8').equals(b),'Use complete original UTF-8 text: '+file);return text;}
export function workingGenesis(workspace){return sha(Buffer.from(JSON.stringify([workspace.id,workspace.title,workspace.createdAt]),'utf8'));}
export function readWorking(file,{expectedGenesis,expectedHead}={}){
 const text=regular(file),record=parseRecovery(text),format=JSON.parse(text).schema===RECOVERY_SCHEMA?'recovery':'workspace';
 need(!expectedGenesis||workingGenesis(record.workspace)===expectedGenesis,'The selected file belongs to another original workspace genesis.');
 need(!expectedHead||head(record.workspace)===expectedHead,'The original workspace changed after selection.');
 return {text,record,format,genesisSha256:workingGenesis(record.workspace),headSha256:head(record.workspace)};
}
export function workingText(selected,workspace){return selected.format==='recovery'?json(recovery(workspace,selected.record.drafts,selected.record.selection,selected.record.copyId)):engine.exportWorkspace(workspace);}
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
async function kernelLease(root){
 const name='tjlabs-harbour-cli-'+sha(Buffer.from(root)).slice(0,40);
 const address=process.platform==='linux'?'\0'+name:process.platform==='win32'?'\\\\.\\pipe\\'+name:null;
 need(address,'Use the original Linux or Windows receiving runtime; this continuation requires a kernel-held local IPC lease.');
 const server=net.createServer(socket=>{socket.on('error',()=>{});socket.end('Original harbour workspace is active.\n');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,()=>{server.removeListener('error',reject);resolve();});});
 server.on('error',()=>{});let released=false;return()=>{if(released)return Promise.resolve();released=true;return new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));};
}

async function locked(workspace,fn){fs.mkdirSync(path.dirname(workspace),{recursive:true,mode:0o700});const identity=path.join(fs.realpathSync(path.dirname(workspace)),path.basename(workspace));const close=await kernelLease(process.platform==='win32'?identity.toLowerCase():identity);try{return fn();}finally{await close();}}
function args(argv){
 const command=argv.shift(),options={};need(command,'Choose init, apply, inspect, rows, analyze, assess-target, report, handover or receive.');need(argv.length%2===0,'Supply every flag with exactly one value.');
 const allowed=new Set(['--workspace','--input','--request','--out','--file','--id','--title','--at','--selection','--contract','--preparation','--return','--source','--operation-id','--expected-genesis','--expected-head']);
 for(let i=0;i<argv.length;i+=2){need(allowed.has(argv[i])&&!Object.hasOwn(options,argv[i]),'Supply each documented option once.');options[argv[i]]=argv[i+1];}return{command,options};
}
function output(file,value){publish(absolute(file,'output'),JSON.stringify(value,null,2)+'\n');}
export async function main(argv=process.argv.slice(2)){
 const {command,options:o}=args(argv.slice());
 const workspace=absolute(o['--workspace'],'workspace');
 if(command==='init')return locked(workspace,()=>{
  const value=engine.createWorkspace({id:o['--id'],title:o['--title'],createdAt:o['--at']}),old=exists(workspace);
  if(old!==null){const current=readWorking(workspace).record.workspace;need(current.id===value.id&&current.title===value.title&&current.createdAt===value.createdAt,'The original destination belongs to another workspace.');return{state:'RETAINED',workspace,id:current.id,revision:current.revision};}
  publish(workspace,engine.exportWorkspace(value));return{state:'CREATED',workspace,id:value.id,revision:0};
 });
 if(command==='receive')return locked(workspace,()=>{
  const selected=readWorking(absolute(o['--input'],'complete portable workspace'),{expectedGenesis:o['--expected-genesis'],expectedHead:o['--expected-head']}),incoming=selected.record.workspace,old=exists(workspace);
  const retainedInput=path.join(workspace+'.incoming',sha(Buffer.from(selected.text,'utf8'))+'.json');publish(retainedInput,selected.text);
  if(old!==null){const current=readWorking(workspace,{expectedGenesis:o['--expected-genesis']}).record.workspace;need(current.id===incoming.id&&current.title===incoming.title&&current.createdAt===incoming.createdAt&&current.revision>=incoming.revision&&JSON.stringify(current.operations.slice(0,incoming.revision))===JSON.stringify(incoming.operations),'The destination contains another history. Use a separate destination for an independent branch.');return{state:'RETAINED',workspace,id:current.id,revision:current.revision,incomingRevision:incoming.revision,retainedInput};}
  publish(workspace,workingText(selected,incoming));return{state:'RECEIVED',workspace,id:incoming.id,revision:incoming.revision,retainedInput};
 });
 if(command==='apply')return locked(workspace,()=>{
  const selected=readWorking(workspace,{expectedGenesis:o['--expected-genesis']}),before=selected.text,ws=selected.record.workspace;
  const methods={importFile:engine.importFile,importCsv:engine.importCsv,saveMapping:engine.saveMapping,saveCorrection:engine.saveCorrection,saveSelection:engine.saveSelection,saveReview:engine.saveReview,saveContract:engine.saveContract,prepareTarget:engine.prepareTarget,recordReturn:engine.recordReturn,saveOperatingProfile:engine.saveOperatingProfile,saveFinancialProfile:engine.saveFinancialProfile};
  const kindMethods={'import-file':'importFile','import-csv':'importCsv','save-mapping':'saveMapping','save-correction':'saveCorrection','save-selection':'saveSelection','save-review':'saveReview','save-contract':'saveContract','prepare-target':'prepareTarget','record-return':'recordReturn','save-operating-profile':'saveOperatingProfile','save-financial-profile':'saveFinancialProfile'};
  const requestPath=absolute(o['--request'],'saved complete operation JSON');let request;
  try{request=JSON.parse(regular(requestPath));}catch(error){
   if(error.code!=='ENOENT'||!o['--operation-id'])throw error;const original=ws.operations.find(x=>x.id===o['--operation-id']);need(original,'The missing staging request has no completed original operation.');request={action:kindMethods[original.kind],input:{...original.input}};if(original.contentRef&&!o['--file']){const retained=ws.files.find(f=>f.id===original.contentRef.fileId);need(retained,'Retain the complete original imported body.');request.input[original.contentRef.field]=original.contentRef.field==='text'?Buffer.from(retained.base64,'base64').toString('utf8'):retained.base64;}
  }
  need(Object.hasOwn(methods,request.action)&&request.input&&typeof request.input==='object'&&!Array.isArray(request.input),'Use a documented action and its complete saved input.');
  const input={...request.input},old=ws.operations.find(x=>x.id===input.operationId);
  need(!o['--operation-id']||o['--operation-id']===input.operationId,'The selected original operation ID differs.');
  // Exact completed request replay remains valid after later source operations.
  need(old||!o['--expected-head']||selected.headSha256===o['--expected-head'],'The original workspace changed after selection.');
  if(request.action==='importFile'||request.action==='importCsv'){
   const field=request.action==='importFile'?'base64':'text';
   if(o['--file']){
    need(input[field]===undefined,'Choose one original byte source, inline or --file.');
    const original=absolute(o['--file'],'complete original input');let bytes;
    try{bytes=regularBytes(original);}catch(error){if(error.code!=='ENOENT'||!old)throw error;const file=ws.files.find(f=>f.id===old.contentRef?.fileId);need(file&&old.contentRef.field===field,'The completed import must retain its exact complete original body.');bytes=Buffer.from(file.base64,'base64');}
    need(bytes.length<=(request.action==='importFile'?engine.LIMITS.fileBytes:engine.LIMITS.csvBytes),'The selected complete input exceeds32 MiB.');
    if(request.action==='importCsv'){const text=bytes.toString('utf8');need(Buffer.from(text,'utf8').equals(bytes),'Use complete strict UTF-8 CSV.');input.text=text;}else input.base64=bytes.toString('base64');
    need(typeof input.filename==='string','Keep the complete original filename in the saved request.');
   }
  }else need(!o['--file'],'This operation reads its complete original saved request.');
  const result=methods[request.action](ws,input);if(!result.replayed)replace(workspace,before,workingText(selected,result.workspace));
  return{state:result.replayed?'REPLAYED':'SAVED',workspace,id:result.workspace.id,revision:result.workspace.revision,receipt:result.receipt};
 });
 const selected=readWorking(workspace,{expectedGenesis:o['--expected-genesis'],expectedHead:o['--expected-head']}),ws=selected.record.workspace;
 if(command==='inspect')return{...engine.inspectWorkspace(ws),format:selected.format,copyId:selected.record.copyId??null,draftCount:Object.keys(selected.record.drafts).length,genesisSha256:selected.genesisSha256,headSha256:selected.headSha256};
 if(command==='rows'){const rows=engine.sourceRows(ws,o['--source']);output(o['--out'],rows);return{state:'COMPLETE',revision:ws.revision,sourceId:o['--source'],rows:rows.rows.length,path:o['--out']};}
 if(command==='analyze'||command==='assess-target'){const result=command==='analyze'?engine.analyse(ws,{selectionId:o['--selection']}):engine.assessContract(ws,{contractId:o['--contract']});output(o['--out'],result);return{state:'COMPLETE',revision:ws.revision,ready:result.ready,summary:result.summary,path:o['--out']};}
 if(command==='report'){publish(absolute(o['--out'],'readable report'),engine.renderReport(ws,{selectionId:o['--selection'],preparationId:o['--preparation'],returnId:o['--return']}));return{state:'COMPLETE',revision:ws.revision,path:o['--out']};}
 if(command==='handover'){
  const root=absolute(o['--out'],'complete handover directory'),packet=engine.buildHandover(ws);
  const recoveryText=selected.format==='recovery'?selected.text:json(selected.record),recoveryBytes=Buffer.from(recoveryText,'utf8');
  const recoveryIdentity={path:'Working_Recovery.json',type:'application/json',bytes:recoveryBytes.length,sha256:sha(recoveryBytes)};packet.files.push({...recoveryIdentity,text:recoveryText});packet.manifest.files.push(recoveryIdentity);const manifest=packet.files.find(f=>f.path==='MANIFEST.json');manifest.text=JSON.stringify(packet.manifest,null,2)+'\n';const manifestBytes=Buffer.from(manifest.text,'utf8');manifest.bytes=manifestBytes.length;manifest.sha256=sha(manifestBytes);
  fs.mkdirSync(root,{recursive:true,mode:0o700});const stat=fs.lstatSync(root);need(stat.isDirectory()&&!stat.isSymbolicLink(),'Use the original ordinary handover directory.');const realRoot=fs.realpathSync(root);
  for(const f of packet.files){const target=path.resolve(root,f.path);need(target.startsWith(root+path.sep),'Keep complete outputs inside the selected handover.');fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const parent=fs.realpathSync(path.dirname(target));need(parent===realRoot||parent.startsWith(realRoot+path.sep),'Keep original member parents inside this handover.');const bytes=f.base64===undefined?Buffer.from(f.text,'utf8'):Buffer.from(f.base64,'base64');need(bytes.length===f.bytes&&sha(bytes)===f.sha256,'The complete member differs from its recorded identity.');publishBytes(target,bytes);}
  return{state:'COMPLETE',workspaceId:ws.id,revision:ws.revision,directory:root,files:packet.files.map(({text,base64,...f})=>f)};
 }
 throw Error('Unknown command: '+command);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{process.stdout.write(JSON.stringify(await main(),null,2)+'\n');}catch(e){process.stderr.write(JSON.stringify({error:e.code||e.name,message:e.message,...(e.details?{details:e.details}:{})})+'\n');process.exitCode=1;}}

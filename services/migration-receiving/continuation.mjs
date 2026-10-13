import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function optional(file){try{const s=await fs.lstat(file);need(s.isFile()&&!s.isSymbolicLink(),'Keep a regular original receiving file: '+file);return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function immutable(file,body){
 const old=await optional(file);if(old){need(old.equals(body),'The original receiving file already contains another edition: '+file);return;}
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.candidate';let h;
 try{h=await fs.open(temp,'wx',0o600);await h.writeFile(body);await h.sync();await h.close();h=null;try{await fs.link(temp,file);}catch(e){if(e.code!=='EEXIST'||!(await optional(file))?.equals(body))throw e;}}
 finally{if(h)await h.close();await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function replace(file,body){const temp=file+'.'+randomUUID()+'.candidate';let h;
 try{h=await fs.open(temp,'wx',0o600);await h.writeFile(body);await h.sync();await h.close();h=null;await fs.rename(temp,file);}
 finally{if(h)await h.close();await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
const encode=value=>{
 if(Buffer.isBuffer(value)||value instanceof Uint8Array)return{$receiving_bytes:Buffer.from(value).toString('base64')};
 if(Array.isArray(value))return value.map(encode);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
 return value;
};
const decode=value=>{
 if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&typeof value.$receiving_bytes==='string')return Buffer.from(value.$receiving_bytes,'base64');
 if(Array.isArray(value))return value.map(decode);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
 return value;
};
function bootFrom(html){const match=html.match(/(<script id="bootstrap" type="application\/json">)([\s\S]*?)(<\/script>)/);need(match,'Read the complete original standalone application.');return{match,data:JSON.parse(match[2])};}
function seededHTML(html,data){const {match}=bootFrom(html);return html.replace(match[0],()=>match[1]+JSON.stringify(data).replace(/</g,'\\u003c')+match[3]);}
async function kernelLease(root){
 const name='tjlabs-migration-receiving-'+sha(Buffer.from(root)).slice(0,40);
 const address=process.platform==='linux'?'\0'+name:process.platform==='win32'?'\\\\.\\pipe\\'+name:null;
 need(address,'Use the original Linux or Windows receiving runtime; this continuation requires a kernel-held local IPC lease.');
 const server=net.createServer(socket=>{socket.on('error',()=>{});socket.end('Original migration receiving is active.\n');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,()=>{server.removeListener('error',reject);resolve();});});
 server.on('error',()=>{});let released=false;return()=>{if(released)return Promise.resolve();released=true;return new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));};
}
function contains(actual,expected){
 if(expected===null||typeof expected!=='object')return actual===expected;
 if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>contains(actual[i],v));
 return actual&&typeof actual==='object'&&Object.entries(expected).every(([k,v])=>contains(actual[k],v));
}
/** Continue one original browser workspace, its requests and complete immutable outputs. */
export async function openMigrationReceiving({page,outputDirectory,applicationPath,engine,title,resultFilename,workspaceModel,browserControls}){
 const defaultModel={id:'ordered-operations-v1',identity:ws=>({id:ws.id,title:ws.title,createdAt:ws.createdAt}),revision:ws=>ws.revision,operations:ws=>ws.operations,sequence:op=>op.revision};
 const model=workspaceModel||defaultModel;
 need(typeof model.id==='string'&&model.id&&['identity','revision','operations','sequence'].every(k=>typeof model[k]==='function'),'Supply the exact original workspace history model.');
 const identityOf=ws=>{const value=model.identity(ws);need(value&&['id','title','createdAt'].every(k=>typeof value[k]==='string'&&value[k]),'Read the original logical workspace identity.');return value;};
 const revisionOf=ws=>{const value=model.revision(ws);need(Number.isSafeInteger(value)&&value>=0,'Read the original workspace revision.');return value;};
 const operationsOf=ws=>{const value=model.operations(ws);need(Array.isArray(value)&&value.length===revisionOf(ws),'Read the complete original ordered operation history.');return value;};
 const sequenceOf=op=>{const value=model.sequence(op);need(Number.isSafeInteger(value)&&value>0,'Read the original operation sequence.');return value;};
 const controls={ready:'#top-json',workspaceDownload:'#top-json',...browserControls};
 need(typeof controls.ready==='string'&&controls.ready&&typeof controls.workspaceDownload==='string'&&controls.workspaceDownload,'Supply the actual original workspace download control.');

 need(path.isAbsolute(outputDirectory)&&path.isAbsolute(applicationPath),'Use absolute original receiving and application paths.');
 await fs.mkdir(outputDirectory,{recursive:true,mode:0o700});const root=await fs.realpath(outputDirectory),release=await kernelLease(root);
 try{
  const currentApplication=await fs.readFile(applicationPath),application={bytes:currentApplication.length,sha256:sha(currentApplication)},intentPath=path.join(root,'receiving-intent.json'),statePath=path.join(root,'receiving-state.json'),oldIntent=await optional(intentPath);
  let intent;
  if(oldIntent){intent=JSON.parse(oldIntent);need(intent.schema==='tjlabs.migration-receiving-intent.v1'&&intent.application.sha256===application.sha256&&intent.application.bytes===application.bytes&&intent.title===title&&intent.resultFilename===resultFilename&&(intent.workspaceModel||defaultModel.id)===model.id,'Continue the exact original application and receiving programme; preserve a changed application as a following original operation.');}
  else{
   const workspace=engine.createWorkspace({id:randomUUID(),title,createdAt:new Date().toISOString()}),copyId=randomUUID();
   intent={schema:'tjlabs.migration-receiving-intent.v1',id:randomUUID(),title,resultFilename,workspaceModel:model.id,application,copyId,workspaceId:identityOf(workspace).id,initialPortable:engine.exportWorkspace(workspace),createdAt:new Date().toISOString()};
   await immutable(intentPath,json(intent));
  }
  await immutable(path.join(root,'original-application.html'),currentApplication);
  const originalApp=(await optional(path.join(root,'original-application.html'))).toString('utf8'),oldState=await optional(statePath);
  const state=oldState?JSON.parse(oldState):{schema:'tjlabs.migration-receiving-state.v1',intentId:intent.id,phases:{},mutations:{},checkpoint:null};
  need(state.schema==='tjlabs.migration-receiving-state.v1'&&state.intentId===intent.id,'Reopen the original receiving state.');
  const resolveMember=relative=>{need(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.split(/[\\/]/).includes('..'),'Retain the exact original receiving member.');const file=path.resolve(root,relative);need(file.startsWith(root+path.sep),'Keep the original receiving boundary.');return file;};
  const bank=async(file)=>{
   const absolute=path.resolve(file);need(absolute.startsWith(root+path.sep),'Keep outputs in the original receiving directory.');
   const body=await optional(absolute);need(body,'The complete receiving output is absent: '+absolute);
   const digest=sha(body),relative=path.relative(root,absolute),bankFile=path.join(root,'retained-bytes',digest);
   await immutable(bankFile,body);return{path:relative,bytes:body.length,sha256:digest};
  };
  const restore=async(row)=>{
   const file=resolveMember(row.path),body=await optional(file);
   if(body){need(body.length===row.bytes&&sha(body)===row.sha256,'An original receiving output was changed: '+row.path);return file;}
   const retained=await optional(path.join(root,'retained-bytes',row.sha256));
   need(retained&&retained.length===row.bytes&&sha(retained)===row.sha256,'Recover the complete original retained output: '+row.path);
   await immutable(file,retained);return file;
  };
  const final=await optional(path.join(root,resultFilename));
  if(final){const receipt=JSON.parse(final);need(receipt.receiving?.intentId===intent.id,'Reopen the original completed receiving receipt.');for(const row of receipt.receiving.files)await restore(row);await release();return{completed:receipt};}
  const attempt=path.join(root,'attempts',randomUUID());await fs.mkdir(attempt,{recursive:true,mode:0o700});
  const save=()=>replace(statePath,json(state));
  const workspacePrefix=(current,prior)=>['id','title','createdAt'].every(k=>identityOf(current)[k]===identityOf(prior)[k])&&revisionOf(current)>=revisionOf(prior)&&JSON.stringify(operationsOf(current).slice(0,operationsOf(prior).length))===JSON.stringify(operationsOf(prior));
  let portable=intent.initialPortable;
  if(state.checkpoint){portable=(await fs.readFile(await restore(state.checkpoint.file))).toString('utf8');need(identityOf(engine.importWorkspace(portable)).id===intent.workspaceId,'The original receiving checkpoint belongs to another workspace.');}
  const start=controls.seedHTML?await controls.seedHTML(originalApp,{copyId:intent.copyId,portable}):
   seededHTML(originalApp,{...bootFrom(originalApp).data,copyId:intent.copyId,portable,drafts:{corrections:{},mappings:{},multipliers:{},policies:{}}});
  need(typeof start==='string'&&start,'Retain the complete original application with its saved receiving record.');
  const resumeFile=path.join(attempt,'continue-original.html');
  await immutable(resumeFile,Buffer.from(start));const programmeFile=path.join(root,'original-programme.html');await replace(programmeFile,Buffer.from(start));await page.goto(pathToFileURL(programmeFile).href);await page.locator(controls.ready).waitFor();
  let snapshotNumber=0;
  async function checkpoint(){
   const restoreView=controls.beforeCheckpoint?await controls.beforeCheckpoint(page):null;let file;
   try{const pending=page.waitForEvent('download');await page.locator(controls.workspaceDownload).click();const d=await pending;file=path.join(attempt,'workspace-'+(++snapshotNumber)+'.json');await d.saveAs(file);}finally{if(restoreView)await restoreView();}
   const raw=await fs.readFile(file),ws=engine.importWorkspace(raw.toString('utf8')),prior=engine.importWorkspace(portable);
   need(identityOf(ws).id===intent.workspaceId&&workspacePrefix(ws,prior),'The browser contains a different original workspace/history. Preserve its complete download.');
   const retained=await bank(file);portable=engine.exportWorkspace(ws);state.checkpoint={revision:revisionOf(ws),file:retained};await save();return ws;
  }
  const opened=await checkpoint();need(workspacePrefix(opened,engine.importWorkspace(intent.initialPortable)),'The browser did not reopen the original receiving workspace.');
  async function mutation(key,revision,expected,perform){
   const request={key,revision,expected},old=state.mutations[key];if(old)need(JSON.stringify(old.request)===JSON.stringify(request),'The saved receiving request changed: '+key);
   else{state.mutations[key]={request,state:'PREPARED'};await save();}
   let ws=await checkpoint();
   if(revisionOf(ws)<revision){need(revisionOf(ws)===revision-1,'Continue every preceding original receiving mutation.');await perform();await page.waitForFunction(n=>{const text=document.querySelector('header')?.innerText||'';return Number(text.match(/Revision (\d+)/)?.[1])>=n;},revision);ws=await checkpoint();}
   const actual=operationsOf(ws)[revision-1];need(actual&&sequenceOf(actual)===revision&&contains(actual,expected.operation||expected),'The saved browser operation differs from the original receiving request: '+key);
   if(expected.source){const source=ws.sources.find(s=>s.id===(actual.sourceInputId||actual.input.sourceId));need(source&&contains(source,expected.source),'The original source bound to this receiving request changed: '+key);if(expected.rowRecord!==undefined)need(source.rows.find(r=>r.id===actual.input.rowId)?.record===expected.rowRecord,'The original corrected receiving record changed.');}
   if(expected.supporting){const file=ws.supportingFiles?.find(f=>f.id===actual.supportingInputId);need(file&&contains(file,expected.supporting),'The original supporting bytes changed: '+key);}
   state.mutations[key]={request,state:'COMPLETE',receipt:actual};await save();return ws;
  }
  async function phase(name,fn,{outputs,screens}){
   const previous=state.phases[name];if(previous?.state==='COMPLETE'){
    for(const file of previous.files)await restore(file);
    const value=decode(previous.value);outputs.push(...decode(previous.outputs));screens.push(...previous.screens);return value;
   }
   const outputStart=outputs.length,screenStart=screens.length;state.phases[name]={state:'RUNNING',startedAt:previous?.startedAt||new Date().toISOString()};await save();
   const value=await fn(),files=[];
   for(const row of outputs.slice(outputStart))if(row.path)files.push(await bank(row.path));
   for(const file of screens.slice(screenStart))files.push(await bank(file));
   async function retainCreated(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await retainCreated(file);else{need(entry.isFile()&&!entry.isSymbolicLink(),'Keep complete regular phase outputs.');const row=await bank(file);if(!files.some(f=>f.path===row.path))files.push(row);}}}
   await retainCreated(attempt);
   await checkpoint();state.phases[name]={state:'COMPLETE',value:encode(value),outputs:encode(outputs.slice(outputStart)),screens:screens.slice(screenStart),files,completedAt:new Date().toISOString()};await save();return value;
  }
  async function finish(receipt){
   const files=[];async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else{need(entry.isFile()&&!entry.isSymbolicLink(),'Keep ordinary closed receiving outputs.');files.push(await bank(file));}}}
   await walk(path.join(root,'attempts'));files.push(await bank(intentPath),await bank(path.join(root,'original-application.html')));
   const finalReceipt={...receipt,receiving:{intentId:intent.id,workspaceId:intent.workspaceId,copyId:intent.copyId,revision:state.checkpoint?.revision??0,files}};
   await immutable(path.join(root,resultFilename),json(finalReceipt));return finalReceipt;
  }
  return{completed:null,root,attempt,intent,state,checkpoint,mutation,phase,finish,close:release};
 }catch(error){await release();throw error;}
}

#!/usr/bin/env node
/** Same-case browser receiving for the installed Delivery risks product.
 * Native business changes are made only through the original operator controls.
 * The inherited original course guard is never unlocked by this process.
 */
import fs from 'node:fs/promises';
import {constants as C, fstatSync, closeSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const SCHEMA='stellar-forge.sf47-delivery-risks-browser.v1';
const PREFIX='stellar/scf_2026/sf47_budget_model/workspace/';
const SHA=/^[a-f0-9]{64}$/;
const OWNER_NAMES=['browser','contexts','downloads','tasks','files','guard'];
const closedOwners=v=>v&&OWNER_NAMES.every(key=>v[key]===true);
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const bytes=v=>Buffer.from(canonical(v)+'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const errorValue=e=>({name:e?.name||'Error',message:e?.message||String(e)});
function relative(name){
  need(typeof name==='string'&&name&&!name.includes('\\')&&!/[\x00-\x1f]/.test(name)&&
    !path.posix.isAbsolute(name)&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Use a normalized original member path.');
  return name;
}
async function absolute(name,{directory=false,privateMode=false}={}){
  need(typeof name==='string'&&path.isAbsolute(name)&&path.normalize(name)===name,'Use a complete normalized absolute path.');
  const parts=name.split(path.sep).filter(Boolean);let current=path.parse(name).root,info;
  for(let i=0;i<parts.length;i++){
    current=path.join(current,parts[i]);info=await fs.lstat(current);
    need(!info.isSymbolicLink()&&(i===parts.length-1&&!directory||info.isDirectory()),'Keep the original nonsymlink path: '+current);
  }
  if(privateMode)need((info.mode&0o077)===0,'Keep the selected private path private.');
  return name;
}
async function sync(directory){let f,first;try{f=await fs.open(directory,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);await f.sync();}catch(e){first=e;}finally{if(f)try{await f.close();}catch(e){first??=e;}}if(first)throw first;}
async function mkdir(directory){
  await absolute(path.dirname(directory),{directory:true});try{await fs.mkdir(directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  await absolute(directory,{directory:true,privateMode:true});await sync(path.dirname(directory));return directory;
}
async function file(filename,{maximum=512*1024*1024,privateMode=false,capture=true}={}){
  await absolute(filename,{privateMode});let f,first,result;
  try{
    f=await fs.open(filename,C.O_RDONLY|C.O_NOFOLLOW);const before=await f.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(maximum),'Use a bounded complete regular file.');
    const digest=createHash('sha256'),parts=capture?[]:null,buffer=Buffer.allocUnsafe(128*1024);let length=0;
    while(true){
      const {bytesRead}=await f.read(buffer,0,buffer.length,null);if(!bytesRead)break;
      length+=bytesRead;
      need(length<=maximum&&BigInt(length)<=before.size,'The selected complete file grew: '+filename);
      const chunk=buffer.subarray(0,bytesRead);digest.update(chunk);
      if(parts)parts.push(Buffer.from(chunk));
    }
    const after=await f.stat({bigint:true}),current=await fs.lstat(filename,{bigint:true});
    const identity=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode].map(String).join(':');
    need(identity(before)===identity(after)&&identity(after)===identity(current)&&BigInt(length)===after.size,'The selected complete file changed: '+filename);
    result={...(capture?{raw:Buffer.concat(parts,length)}:{}),path:filename,bytes:length,sha256:digest.digest('hex'),mode:Number(after.mode&0o777n)};
  }catch(e){first=e;}finally{if(f)try{await f.close();}catch(e){first??=e;}}
  if(first)throw first;return result;
}
function short(row){return {path:row.path,bytes:row.bytes,sha256:row.sha256};}
async function selected(row,options={}){
  need(row&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&SHA.test(row.sha256),'Select a complete original descriptor.');
  const actual=await file(row.path,options);need(actual.bytes===row.bytes&&actual.sha256===row.sha256,'The selected full input changed: '+row.path);return actual;
}
async function executionContinuation(input,native,manifest,sourceFile){
  if(!input.executionContinuation)return null;
  const selectedFile=await selected(input.executionContinuation,{privateMode:true,maximum:1024*1024});
  const document=JSON.parse(selectedFile.raw),reference=short(selectedFile),record={reference,document};
  need(document.schema==='stellar-forge.sf47-risk-execution-continuation.v1'&&
    typeof document.reason==='string'&&document.reason.trim(),'Select the original explicit execution continuation.');
  need(document.original&&document.corrections&&same(document.original.sourceManifest,short(sourceFile)),
    'The continuation must bind the unchanged original complete source manifest.');
  const parent=path.dirname(input.outputDirectory),directory=path.join(parent,'execution-continuations',reference.sha256);
  await absolute(directory,{directory:true,privateMode:true});
  const retained=await selected({...reference,path:path.join(directory,'execution-continuation.json')},{privateMode:true,maximum:1024*1024});
  need(retained.raw.equals(selectedFile.raw),'Keep the exact parent-adopted continuation bytes.');
  const adopted=JSON.parse((await file(path.join(directory,'ADOPTED.json'),{privateMode:true,maximum:2*1024*1024})).raw);
  need(same(adopted,{schema:'stellar-forge.sf47-risk-execution-continuation-adopted.v1',executionContinuation:record}),
    'The original parent has not completed this exact continuation admission.');
  const executionInput=JSON.parse((await selected(document.original.executionInput,{privateMode:true,maximum:32*1024*1024})).raw);
  const executionSelection=JSON.parse((await selected(document.original.executionSelection,{privateMode:true,maximum:32*1024*1024})).raw);
  need(executionInput.schema==='stellar-forge.sf47-risk-execution.v1'&&
    document.operationId===executionInput.operationId&&
    same(executionSelection,{schema:'stellar-forge.sf47-risk-execution.v1',config:executionInput}),
    'Bind the original execution operation to its exact retained configuration and selection.');
  need(document.original.browserSelection.path===path.join(input.outputDirectory,'SELECTION.json')&&
    document.original.browserJournal.path===path.join(input.outputDirectory,'risk-browser-journal.json'),
    'Keep this same original browser selection and journal placement.');
  await selected(document.original.browserSelection,{privateMode:true,capture:false});
  for(const [name,snapshot] of [['browserJournal','prior-browser-journal.json'],['executionJournal','prior-execution-journal.json']]){
    const original=document.original[name];
    need(original&&path.isAbsolute(original.path),'Retain the original journal path and full descriptor.');
    await selected({...original,path:path.join(directory,snapshot)},{privateMode:true,capture:false});
  }
  for(const name of ['node','python']){
    const correction=document.corrections[name];
    need(correction&&relative(correction.repositoryPath)&&correction.original&&correction.current,
      'Keep both complete original and corrected execution source identities.');
    const row=manifest.files.find(row=>row.path===correction.repositoryPath);
    need(row&&correction.original.path===path.join(input.repositoryRoot,row.path)&&
      correction.original.bytes===row.bytes&&correction.original.sha256===row.sha256&&
      correction.current.path!==correction.original.path,'The corrected execution module must preserve its original selected repository source.');
    if(name==='node')need(correction.repositoryPath===PREFIX+'operations_risks_browser.mjs','Select only the original browser execution module.');
    for(const version of ['original','current']){
      const descriptor=correction[version],actual=await selected(descriptor,{capture:false});
      const mode=typeof descriptor.mode==='string'&&/^[0-7]{3,6}$/.test(descriptor.mode)?parseInt(descriptor.mode,8):descriptor.mode;
      need(Number.isInteger(mode)&&(mode&0o777)===actual.mode,'Keep the full exact execution-source mode.');
    }
  }
  return record;
}
function continuationFields(value){return value.executionContinuation?{executionContinuation:value.executionContinuation}:{};}
function sameContinuation(record,value){
  need(same(record.executionContinuation??null,value.executionContinuation??null),
    'Reopen the same explicit original execution continuation.');
}
async function exists(filename){try{await fs.lstat(filename);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function publish(filename,raw,{replace=false}={}){
  await absolute(path.dirname(filename),{directory:true,privateMode:true});
  if(!replace&&await exists(filename)){const prior=await file(filename);need(prior.raw.equals(raw),'Conflicting retained original publication: '+filename);await sync(path.dirname(filename));return short(prior);}
  const temporary=filename+'.'+randomUUID()+'.tmp';let f,first;
  try{
    f=await fs.open(temporary,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);await f.writeFile(raw);await f.sync();await f.close();f=null;
    if(replace)await fs.rename(temporary,filename);
    else{try{await fs.link(temporary,filename);}catch(e){if(e.code!=='EEXIST')throw e;const prior=await file(filename);need(prior.raw.equals(raw),'Conflicting original publication.');}await fs.unlink(temporary);}
    await sync(path.dirname(filename));
  }catch(e){first=e;}finally{
    if(f)try{await f.close();}catch(e){first??=e;}
    if(await exists(temporary))try{await fs.unlink(temporary);await sync(path.dirname(filename));}catch(e){first??=e;}
  }
  if(first)throw first;return {path:filename,bytes:raw.length,sha256:hash(raw)};
}
class Guard{
  constructor(value){this.value=value;this.fd=value?.fd;this.closed=false;need(Number.isInteger(this.fd)&&this.fd>=3,'Inherit the original held course guard descriptor.');}
  async check(){
    need(!this.closed,'The original guard duplicate is closed.');
    const s=fstatSync(this.fd,{bigint:true}),p=await fs.lstat(await absolute(this.value.path),{bigint:true});
    need(s.isFile()&&s.dev===p.dev&&s.ino===p.ino&&String(s.dev)===this.value.device&&String(s.ino)===this.value.inode,'The inherited course guard differs from its original owner.');
  }
  close(){
    if(this.closed)return;
    if(this.closeError)throw this.closeError;
    const fd=this.fd;this.fd=null;
    // A failed raw close may already have released its numeric descriptor.
    // Never retry that number or publish a successful close without a return.
    try{closeSync(fd);this.closed=true;}catch(error){this.closeError=error;throw error;}
  }
}
async function inputs(input){
  need(input?.schema===SCHEMA+'.input','Select the complete original risk browser input.');
  await absolute(input.repositoryRoot,{directory:true});
  const handover=await selected(input.native,{privateMode:true,maximum:32*1024*1024});
  const native=JSON.parse(handover.raw);need(native.schema==='stellar-forge.sf47-delivery-risks-course.v1.result'&&native.status==='PASS'&&native.originalCommands,'Complete the original two-edition native course first.');
  const address=new URL(native.origin);need(address.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(address.hostname)&&address.origin===native.origin&&!address.username&&!address.password,'Use the original loopback installed host.');
  const sourceFile=await selected(input.sourceManifest,{maximum:32*1024*1024}),manifest=JSON.parse(sourceFile.raw);
  need(sourceFile.bytes===native.sourceSelection.bytes&&sourceFile.sha256===native.sourceSelection.sha256,'Browser and native course must select the same complete installed source.');
  need(Array.isArray(manifest.files)&&manifest.files.length&&Array.isArray(native.installedSource),'Keep the complete source member list.');
  const actual=[],names=new Set();
  for(const row of manifest.files){
    const name=relative(row.path);need(!names.has(name),'Duplicate source member.');names.add(name);
    const got=await selected({...row,path:path.join(input.repositoryRoot,name)},{capture:false});
    const mode=typeof row.mode==='string'&&/^[0-7]{3,6}$/.test(row.mode)?parseInt(row.mode,8):row.mode;
    need(mode===undefined||(Number.isInteger(mode)&&(mode&0o777)===got.mode),'The original selected source mode changed.');
    actual.push({path:name,bytes:got.bytes,sha256:got.sha256});
  }
  need(same([...actual].sort((a,b)=>a.path.localeCompare(b.path)),[...native.installedSource].sort((a,b)=>a.path.localeCompare(b.path))),'Keep the whole same installed native/browser source.');
  need(names.has(PREFIX+'operations_risks_browser.mjs')&&names.has(PREFIX+'operations_risks_walkthrough.py')&&names.has(PREFIX+'operations_walkthrough.py'),'The complete original receiving source closure is missing.');
  const continuation=await executionContinuation(input,native,manifest,sourceFile);
  const self=actual.find(row=>row.path===PREFIX+'operations_risks_browser.mjs'),selfFile=await file(new URL(import.meta.url).pathname,{capture:false});
  const executing=continuation?continuation.document.corrections.node.current:self;
  need(selfFile.bytes===executing.bytes&&selfFile.sha256===executing.sha256&&
    (!continuation||selfFile.path===executing.path),'Run the exact selected or explicitly adopted complete browser source.');
  const node=await selected(input.node,{capture:false});need(await fs.realpath(process.execPath)===node.path,'Run the selected original Node.');
  const playwright=await file(input.browser.playwrightModule,{capture:false}),executable=await file(input.browser.executablePath,{capture:false});
  need(playwright.sha256===input.browser.playwrightSha256&&executable.sha256===input.browser.executableSha256,'The original browser runtime selection changed.');
  need(executable.mode&0o111,'Select an executable original Chromium.');
  const codesPath=path.join(path.dirname(input.native.path),relative(native.privateStaffCodes));
  const codesFile=await file(codesPath,{privateMode:true,maximum:1024*1024}),codes=JSON.parse(codesFile.raw);
  for(const role of ['lead','finance','reviewer','contributor'])need(codes[role]?.staffId===native.staff[role]&&typeof codes[role]?.accessCode==='string','Retain the original enrolled staff credentials.');
  const keyFile=await file(input.ownerKeyFile,{privateMode:true,maximum:1024*1024});need(keyFile.raw.toString('utf8').trim(),'The original owner access key is empty.');
  for(const name of ['first-edition','second-edition']){
    const original=native.originalCommands[name];need(original?.command?.action==='risk-register.save'&&original.receipt?.recordId===(name==='first-edition'?native.firstReviewId:native.secondReviewId),'Keep both exact original native commands.');
    const raw=await file(path.join(path.dirname(input.native.path),relative(original.path)));
    need(raw.sha256===original.sha256&&same(JSON.parse(raw.raw),original.command),'An original accepted command changed.');
  }
  await absolute(path.dirname(input.outputDirectory),{directory:true,privateMode:true});
  const stable={schema:SCHEMA+'.selection',operationId:native.operationId,repositoryRoot:input.repositoryRoot,
    native:short(handover),sourceManifest:short(sourceFile),installedSource:actual,
    node:short(node),browser:{playwright:short(playwright),executable:short(executable)},
    outputDirectory:input.outputDirectory,ownerKey:{path:keyFile.path,sha256:keyFile.sha256},
    staffCodes:{path:codesPath,sha256:codesFile.sha256},
    parentGuard:{path:input.parentGuard.path,device:input.parentGuard.device,inode:input.parentGuard.inode},
    origin:native.origin,installationId:native.installationId};
  if(continuation){
    const original=continuation.document.original.browserSelection;
    need(original.bytes===bytes(stable).length&&original.sha256===hash(bytes(stable)),
      'The explicit execution continuation must preserve every original browser selection field.');
  }
  return {input,native,stable,selectionSha256:hash(bytes(stable)),codes,ownerKey:keyFile.raw.toString('utf8').trim(),
    ...(continuation?{executionContinuation:continuation}:{})};
}
let namespacePromise;
function callerNamespace(){
  return namespacePromise??=(async()=>{
    const status=await fs.readFile('/proc/self/status','utf8'),line=/^NSpid:\s+(.+)$/m.exec(status);
    need(line,'The original Linux PID namespace mapping is unavailable.');
    const pids=line[1].trim().split(/\s+/).map(Number);
    need(pids.length&&pids.at(-1)===process.pid,'The current Node PID does not match its original namespace status.');
    const namespace=String((await fs.stat('/proc/self/ns/pid',{bigint:true})).ino);
    const entry=await fs.readlink('/proc/self');need(/^\d+$/.test(entry),'The original proc-view self identity is unavailable.');
    return {namespace,pids,depth:pids.length,entry:Number(entry)};
  })();
}
async function proc(pid){
  try{
    const caller=await callerNamespace();
    const raw=await fs.readFile('/proc/'+pid+'/stat','utf8'),end=raw.lastIndexOf(')'),parts=raw.slice(end+2).trim().split(/\s+/);
    const ns=(await fs.stat('/proc/'+pid+'/ns/pid',{bigint:true})).ino;
    const status=await fs.readFile('/proc/'+pid+'/status','utf8'),line=/^NSpid:\s+(.+)$/m.exec(status);
    need(line,'An original process lacks its Linux namespace identity.');
    const pids=line[1].trim().split(/\s+/).map(Number);
    const again=await fs.readFile('/proc/'+pid+'/stat','utf8'),next=again.slice(again.lastIndexOf(')')+2).trim().split(/\s+/);
    if(parts[19]!==next[19])return null;
    return {pid:Number(pid),parent:Number(parts[1]),start:parts[19],namespace:String(ns),
      pids,signalPid:pids[caller.depth-1]??null,state:next[0]};
  }catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}
}
async function originalChild(child,isClosed,selection){
  const caller=await callerNamespace(),deadline=Date.now()+5000;
  while(true){
    if(isClosed())return null;
    const matches=[];
    for(const name of await fs.readdir('/proc'))if(/^\d+$/.test(name)){
      let row;try{row=await proc(Number(name));}catch(e){if(['EACCES','EPERM'].includes(e.code))continue;throw e;}
      if(row&&row.namespace===caller.namespace&&row.signalPid===child.pid&&row.parent===caller.entry){
        try{
          const argv=(await fs.readFile('/proc/'+name+'/cmdline')).toString('utf8').split('\0');
          const executable=await fs.readlink('/proc/'+name+'/exe');
          if(executable===selection.executable&&argv.includes('--user-data-dir='+selection.profile))matches.push(row);
        }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
      }
    }
    need(matches.length<=1,'The original child namespace identity is ambiguous.');
    if(matches.length)return matches[0];
    if(isClosed())return null;
    need(Date.now()<deadline,'Retain the actual child until its namespace identity can be read.');
    await pause(25);
  }
}
const equalProc=(a,b)=>a&&b&&a.pid===b.pid&&a.start===b.start&&a.namespace===b.namespace&&same(a.pids,b.pids);
const liveProc=(a,b)=>equalProc(a,b)&&!['Z','X'].includes(b.state);
async function assertNoPriorBrowser(root){
  if(!await exists(path.join(root,'attempts')))return;
  for(const name of await fs.readdir(path.join(root,'attempts'))){
    const attempt=path.join(root,'attempts',name);await absolute(attempt,{directory:true,privateMode:true});
    const owner=path.join(attempt,'CHROMIUM_OWNER.json');
    if(await exists(owner)){
      const row=JSON.parse((await file(owner,{privateMode:true})).raw);
      need(!liveProc(row.process,await proc(row.process.pid)),'The original browser process is still live; its execution owner must finish that invocation.');
    }
  }
  for(const name of await fs.readdir('/proc'))if(/^\d+$/.test(name)){
    try{
      const command=(await fs.readFile('/proc/'+name+'/cmdline')).toString('utf8').split('\0');
      need(!command.some(arg=>arg.startsWith('--user-data-dir='+path.join(root,'attempts')+path.sep)),'An original receiving profile still has a live browser owner.');
    }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
  }
}
class BrowserOwner{
  constructor(course){this.course=course;this.contexts=new Set();this.downloads=new Set();this.tasks=new Set();this.processes=new Map();this.child=null;this.browser=null;this.logs=[];this.childClosed=false;this.fullyClosed=false;this.network=new Set();this.stopping=false;this.scanWork=Promise.resolve();}
  track(p){this.tasks.add(p);p.then(()=>this.tasks.delete(p),()=>this.tasks.delete(p));return p;}
  async scan(){
    const rows=await fs.readdir('/proc');const found=[];
    for(const row of rows)if(/^\d+$/.test(row)){let identity;try{identity=await proc(Number(row));}catch(e){if(['EACCES','EPERM'].includes(e.code))continue;throw e;}if(identity){
      found.push(identity);
      if(this.profile)try{
        const argv=(await fs.readFile('/proc/'+row+'/cmdline')).toString('utf8').split('\0');
        if(argv.includes('--user-data-dir='+this.profile)&&identity.namespace===(await callerNamespace()).namespace)this.processes.set(identity.pid,identity);
      }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
    }}
    let changed=true;while(changed){changed=false;for(const row of found)if(!this.processes.has(row.pid)&&liveProc(this.processes.get(row.parent),found.find(p=>p.pid===row.parent))){this.processes.set(row.pid,row);changed=true;}}
  }
  async launch(){
    const c=this.course,namespace=await callerNamespace();need(await proc(namespace.entry),'Read the original caller process before acquiring Chromium.');
    this.profile=await mkdir(path.join(c.attempt,'chromium-profile'));
    for(const name of ['chromium.stdout','chromium.stderr'])this.logs.push(await fs.open(path.join(c.attempt,name),C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600));
    this.child=spawn(c.value.input.browser.executablePath,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+this.profile,'about:blank'],{stdio:['ignore',this.logs[0].fd,this.logs[1].fd]});
    this.closed=new Promise(resolve=>{this.child.once('error',e=>{this.spawnError=e;});this.child.once('close',(code,signal)=>{this.childClosed=true;this.exit={code,signal};resolve(this.exit);});});
    if(this.child.pid){const p=await originalChild(this.child,()=>this.childClosed,{executable:c.value.input.browser.executablePath,profile:this.profile});if(p){this.processes.set(p.pid,p);await publish(path.join(c.attempt,'CHROMIUM_OWNER.json'),bytes({schema:SCHEMA+'.chromium-owner',profile:this.profile,nativePid:this.child.pid,process:p}));}}
    this.timer=setInterval(()=>{this.scanWork=this.scanWork.then(()=>this.scan()).catch(e=>c.fail(e));},500);this.timer.unref();
    let endpoint;const start=Date.now();
    while(!endpoint){
      c.check();need(!this.childClosed,'The original Chromium closed before CDP admission: '+(this.spawnError?.message||JSON.stringify(this.exit)));
      need(Date.now()-start<60000,'The original Chromium did not publish its local debugging endpoint.');
      const name=path.join(this.profile,'DevToolsActivePort');
      if(await exists(name)){const raw=(await file(name,{maximum:4096})).raw.toString('utf8').trim().split('\n');need(/^\d+$/.test(raw[0])&&/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(raw[1]),'Invalid original Chromium endpoint.');endpoint='http://127.0.0.1:'+raw[0];}
      if(!endpoint)await pause(100);
    }
    const runtime=await import(pathToFileURL(c.value.input.browser.playwrightModule).href);
    const chromium=runtime.chromium||runtime.default?.chromium;need(chromium,'The selected original Playwright does not export Chromium.');
    this.browser=await chromium.connectOverCDP(endpoint,{timeout:30000});await this.scan();
  }
  requestStop(){
    if(this.stopWork)return this.stopWork;
    this.stopping=true;
    this.stopWork=(async()=>{
      const outcomes=await Promise.allSettled([...this.contexts].map(async context=>{
        await context.close();this.contexts.delete(context);
      }));
      for(const row of outcomes)if(row.status==='rejected')this.course.first??=row.reason;
    })();
    return this.stopWork;
  }
  async close(){
    this.stopping=true;let first;
    if(this.stopWork)try{await this.stopWork;}catch(e){first??=e;}
    const remember=e=>{first??=e;};
    // Closing original contexts aborts incomplete network bodies. Their exact
    // observation promises are still awaited before the process owner releases.
    for(const download of [...this.downloads])try{await download.cancel();this.downloads.delete(download);}catch(e){remember(e);}
    for(const context of [...this.contexts])try{await context.close();this.contexts.delete(context);}catch(e){remember(e);}
    try{await this.scanWork;await this.scan();}catch(e){remember(e);}
    if(this.browser)try{await this.browser.close();this.browser=null;}catch(e){remember(e);}
    try{await this.scan();}catch(e){remember(e);}
    if(this.child&&!this.childClosed)try{this.child.kill('SIGTERM');}catch(e){remember(e);}
    if(this.child)await this.closed;
    if(this.timer){clearInterval(this.timer);this.timer=null;}
    let verifiedScan=false;try{await this.scanWork;}catch(e){remember(e);}
    while(true){
      // Reconcile the exact attempt profile even after Chromium reparents a
      // newly born descendant; a direct child's close is not the final census.
      try{await this.scan();verifiedScan=true;}catch(e){remember(e);verifiedScan=false;break;}
      const alive=[];
      for(const identity of this.processes.values())if(liveProc(identity,await proc(identity.pid)))alive.push(identity);
      if(!alive.length)break;
      for(const identity of alive)try{
        const current=await proc(identity.pid);
        if(liveProc(identity,current)){need(Number.isInteger(current.signalPid)&&current.signalPid>0,'Retain the original descendant until its signal namespace is available.');process.kill(current.signalPid,'SIGTERM');}
      }catch(e){if(e.code!=='ESRCH')remember(e);}
      await pause(250);
    }
    // Process closure independently proves remote contexts are gone even when
    // their transport close failed. No unrelated process is treated as owned.
    if(verifiedScan){this.contexts.clear();this.browser=null;this.downloads.clear();this.network.clear();}
    while(this.tasks.size){const rows=await Promise.allSettled([...this.tasks]);for(const r of rows)if(r.status==='rejected')remember(r.reason);}
    for(const log of [...this.logs]){
      try{await log.sync();}catch(e){remember(e);}
      try{await log.close();this.logs.splice(this.logs.indexOf(log),1);}catch(e){remember(e);}
    }
    this.fullyClosed=(!this.child||this.childClosed&&verifiedScan)&&!this.contexts.size&&!this.downloads.size&&!this.tasks.size&&!this.logs.length;
    if(first)throw first;
  }
}
class Course{
  constructor(value,guard){this.value=value;this.guard=guard;this.root=value.input.outputDirectory;this.first=null;this.observations=[];this.publicFiles=new Map();this.writeChain=Promise.resolve();this.owner=new BrowserOwner(this);this.admission=true;}
  fail(e){this.first??=e;this.admission=false;this.owner.requestStop().catch(error=>{this.first??=error;});}
  check(){if(this.first)throw this.first;need(this.admission,'The original browser course is stopping.');}
  async saveJournal(){
    this.writeChain=this.writeChain.then(()=>{
      this.journal.files=[...this.publicFiles.values()].sort((a,b)=>a.path.localeCompare(b.path));
      return publish(path.join(this.root,'risk-browser-journal.json'),bytes(this.journal),{replace:true});
    });await this.writeChain;
  }
  async artifact(name,raw){relative(name);const filename=path.join(this.root,name);const d=await publish(filename,raw);const row={path:name,bytes:d.bytes,sha256:d.sha256};this.publicFiles.set(name,row);return row;}
  async open(){
    await mkdir(this.root);await assertNoPriorBrowser(this.root);
    const selectionPath=path.join(this.root,'SELECTION.json');
    if(!await exists(selectionPath))need((await fs.readdir(this.root)).length===0,'The selected output contains another operation without its original selection.');
    await publish(selectionPath,bytes(this.value.stable));
    await mkdir(path.join(this.root,'.private'));await mkdir(path.join(this.root,'artifacts'));await mkdir(path.join(this.root,'downloads'));await mkdir(path.join(this.root,'attempts'));
    const j=path.join(this.root,'risk-browser-journal.json');
    this.journal=await exists(j)?JSON.parse((await file(j,{privateMode:true})).raw):{schema:SCHEMA+'.journal',selectionSha256:this.value.selectionSha256,steps:{},third:null,files:[]};
    need(this.journal.schema===SCHEMA+'.journal'&&this.journal.selectionSha256===this.value.selectionSha256,'Reopen the same complete browser selection.');
    if(this.value.executionContinuation&&!this.journal.executionContinuation){
      const original=this.value.executionContinuation.document.original.browserJournal,current=await file(j,{privateMode:true,capture:false});
      need(current.bytes===original.bytes&&current.sha256===original.sha256,'Adopt the continuation only from its exact retained original browser journal.');
      this.journal.executionContinuation=this.value.executionContinuation;
    }
    sameContinuation(this.journal,this.value);
    for(const row of this.journal.files||[]){await selected({...row,path:path.join(this.root,relative(row.path))});this.publicFiles.set(row.path,row);}
    await this.reconcileThird();
    this.attemptId=randomUUID();this.attempt=await mkdir(path.join(this.root,'attempts',this.attemptId));await this.saveJournal();
  }
  async step(name,work){
    this.check();if(this.journal.steps[name])return this.journal.steps[name];
    const result=await work();this.check();this.journal.steps[name]=result;this.journal.files=[...this.publicFiles.values()];await this.saveJournal();return result;
  }
  deskKey(role){
    return 'sf47.delivery-risks.v1:'+this.value.native.originalCaseId+':staff:'+this.value.native.installationId+':'+this.value.native.staff[role];
  }
  checkedDesk(state,role){
    need(state&&state.key===this.deskKey(role)&&typeof state.raw==='string','Keep the original staff-scoped desk bytes.');
    const desk=JSON.parse(state.raw),n=this.value.native;
    need(desk.schema==='stellar-forge.sf47-delivery-risk-desk.v1'&&desk.programId===n.originalCaseId&&
      desk.staffContext?.installationId===n.installationId&&desk.staffContext?.staffId===n.staff[role]&&
      desk.staffContext?.role===role,'The retained desk changed case, installation or original operator.');
    need(Array.isArray(desk.receipts),'Retain the complete original desk receipts.');
    return desk;
  }
  async captureDesk(page,role){
    const key=this.deskKey(role),raw=await page.evaluate(k=>sessionStorage.getItem(k),key);
    if(raw===null)return null;
    const state={key,raw};this.checkedDesk(state,role);return state;
  }
  async snapshot(page,role){
    const state=await this.captureDesk(page,role);
    if(state)await publish(path.join(this.root,'.private',role+'-desk.json'),bytes(state),{replace:true});
    return state;
  }
  checkThird(command,desk){
    const n=this.value.native,prior=n.originalCommands['second-edition'].receipt;
    need(command&&command.action==='risk-register.save'&&typeof command.requestId==='string'&&command.requestId&&
      command.expectedVersion===n.originalCaseVersion&&typeof command.actor==='string'&&command.actor.trim()&&
      typeof command.note==='string'&&command.note.trim()&&
      command.data?.document?.supersedes?.reviewId===n.secondReviewId&&
      command.data.document.supersedes.reviewSha256===prior.reviewSha256&&SHA.test(command.data.expectedPreviewSha256),
      'Retain the exact original third-edition request, case version and predecessor.');
    if(desk)need(command.actor===desk.staffContext.actor,'The retained command belongs to another recording operator.');
  }
  rememberThird(command,result=null){
    this.checkThird(command);
    if(this.journal.third){
      need(same(this.journal.third.command,command),'Conflicting original third-edition commands.');
      if(result&&this.journal.third.result)need(same(this.journal.third.result,result),'Conflicting original accepted risk results.');
    }else this.journal.third={command,result:null};
    if(result){
      need(result.id===this.value.native.originalCaseId&&result.action==='risk-register.save'&&
        result.kind==='review'&&typeof result.recordId==='string'&&SHA.test(result.reviewSha256)&&
        result.version===command.expectedVersion+1,'The original third-edition receipt changed.');
      this.journal.third.result=result;
    }
  }
  async reconcileThird(){
    const admissionPath=path.join(this.root,'.private','third-admission.json');
    const deskPath=path.join(this.root,'.private','lead-desk.json');
    let admission=null,state=null,desk=null;
    if(await exists(admissionPath)){
      admission=JSON.parse((await file(admissionPath,{privateMode:true})).raw);
      need(admission.schema===SCHEMA+'.third-admission'&&admission.selectionSha256===this.value.selectionSha256,
        'The original browser command admission belongs to another selection.');
      const admittedDesk=this.checkedDesk(admission.desk,'lead');
      this.checkThird(admission.command,admittedDesk);
      need(same(admittedDesk.pending?.command,admission.command),'Retain the actual desk pending command captured before dispatch.');
      this.rememberThird(admission.command);
    }
    if(this.journal.third)this.rememberThird(this.journal.third.command,this.journal.third.result);
    const observations=[];
    for(const name of await fs.readdir(path.join(this.root,'artifacts'))){
      if(!/^third-(preview|command|book|response-[a-f0-9]{64})\.json$/.test(name))continue;
      const member='artifacts/'+name,got=await file(path.join(this.root,member),{privateMode:true,maximum:32*1024*1024});
      const value=JSON.parse(got.raw);
      if(name==='third-command.json')this.rememberThird(value);
      if(name.startsWith('third-response-'))need(name==='third-response-'+got.sha256+'.json','An original response observation changed.');
      const existing=this.publicFiles.get(member);
      need(!existing||existing.bytes===got.bytes&&existing.sha256===got.sha256,'An original observed artifact changed.');
      this.publicFiles.set(member,{path:member,bytes:got.bytes,sha256:got.sha256});observations.push({name,value});
    }
    if(await exists(deskPath)){state=JSON.parse((await file(deskPath,{privateMode:true})).raw);desk=this.checkedDesk(state,'lead');}
    const entries=desk?[desk.pending,desk.accepted,...desk.receipts].filter(Boolean):[];
    for(const entry of entries){this.checkThird(entry.command,desk);this.rememberThird(entry.command,entry.result||null);}
    if(!this.journal.third)return;
    for(const {name,value} of observations){
      if(name==='third-preview.json')need(value.previewSha256===this.journal.third.command.data.expectedPreviewSha256&&
        same(value.document,this.journal.third.command.data.document),'The original command and native preview changed.');
      if(name.startsWith('third-response-')&&value.status>=200&&value.status<300)this.rememberThird(this.journal.third.command,value.body);
    }
    // Admission is one immutable publication of the real pending UI state.
    // It repairs a command/desk/journal interruption without inventing an ID.
    if(!entries.length){
      need(admission,'The original command requires its complete retained pending desk before recovery.');
      state=admission.desk;desk=this.checkedDesk(state,'lead');
      await publish(deskPath,bytes(state),{replace:true});
    }
    this.checkThird(this.journal.third.command,desk);
    await this.artifact('artifacts/third-command.json',bytes(this.journal.third.command));
  }
  async response(response,role){
    const u=new URL(response.url()),prefix='/api/operations/'+this.value.native.originalCaseId;
    if(u.origin!==this.value.native.origin||!u.pathname.startsWith(prefix))return;
    const req=response.request(),commandPath=prefix+'/command';
    if(u.pathname!==commandPath||req.method()!=='POST')return;
    const body=req.postDataJSON();if(body.action!=='risk-register.save')return;
    const raw=await response.body();const result=JSON.parse(raw);
    need(this.journal.third&&same(body,this.journal.third.command),'The accepted browser request changed.');
    if(response.ok()){this.rememberThird(body,result);await this.saveJournal();}
    const observed=bytes({status:response.status(),body:result});
    await this.artifact('artifacts/third-response-'+hash(observed)+'.json',observed);await this.saveJournal();
  }
  async route(route,role,page){
    const req=route.request(),url=new URL(req.url()),native=this.value.native;
    if(url.origin!==native.origin){if(['about:','data:','blob:'].includes(url.protocol))return route.continue();return route.abort('blockedbyclient');}
    if(req.method()==='POST'&&url.pathname.startsWith('/api/operations/')){
      const suffix=url.pathname.split('/').at(-1);
      if(suffix==='command'){
        const command=req.postDataJSON();need(role==='lead'&&url.pathname==='/api/operations/'+native.originalCaseId+'/command'&&command.action==='risk-register.save','The browser course does not admit another domain mutation.');
        const state=await this.captureDesk(page,role);need(state,'The original desk must retain its actual pending command before dispatch.');
        const desk=this.checkedDesk(state,role);this.checkThird(command,desk);
        need(same(desk.pending?.command,command),'The routed command differs from the actual original pending desk.');
        this.rememberThird(command);
        const admissionPath=path.join(this.root,'.private','third-admission.json');
        if(await exists(admissionPath)){
          const admission=JSON.parse((await file(admissionPath,{privateMode:true})).raw);
          need(admission.schema===SCHEMA+'.third-admission'&&admission.selectionSha256===this.value.selectionSha256&&same(admission.command,command),
            'Reuse the original immutable command admission.');
        }else await publish(admissionPath,bytes({schema:SCHEMA+'.third-admission',selectionSha256:this.value.selectionSha256,command,desk:state}));
        await this.artifact('artifacts/third-command.json',bytes(command));
        await publish(path.join(this.root,'.private','lead-desk.json'),bytes(state),{replace:true});await this.saveJournal();
      }else need(['risk-register-seed','risk-register-preview','risk-register-request'].includes(suffix),'Only original risk read/preview routes are selected.');
    }
    this.check();await route.continue();
  }
  async actor(role){
    this.check();const context=await this.owner.browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000},serviceWorkers:'block'});this.owner.contexts.add(context);this.check();
    const retained=path.join(this.root,'.private',role+'-desk.json');
    if(role==='lead'&&await exists(retained)){
      const state=JSON.parse((await file(retained,{privateMode:true})).raw);
      await context.addInitScript(({origin,key,raw})=>{if(location.origin===origin)sessionStorage.setItem(key,raw);},{origin:this.value.native.origin,...state});
    }
    const page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(45000);
    page.on('dialog',dialog=>{this.owner.track(dialog.type()==='beforeunload'?dialog.accept():dialog.accept()).catch(e=>this.fail(e));});
    page.on('request',r=>this.owner.network.add(r));
    page.on('requestfinished',r=>this.owner.network.delete(r));page.on('requestfailed',r=>this.owner.network.delete(r));
    page.on('response',r=>{this.owner.track(this.response(r,role)).catch(e=>this.fail(e));});
    await page.route('**/*',route=>this.owner.track(this.route(route,role,page).catch(async e=>{this.fail(e);try{await route.abort('failed');}catch{}throw e;})));
    await page.goto(this.value.native.origin+'/team',{waitUntil:'networkidle'});
    if(role==='owner'){
      await page.locator('#sign-in details summary').click();
      await page.locator('#owner-form [name=ownerKey]').fill(this.value.ownerKey);
      await page.locator('#owner-form button[type=submit]').click();
    }else{
      const code=this.value.codes[role];await page.locator('#login-form [name=staffId]').fill(code.staffId);
      await page.locator('#login-form [name=accessCode]').fill(code.accessCode);await page.locator('#login-form button[type=submit]').click();
    }
    await page.locator('#signed-in').waitFor({state:'visible'});
    const session=await this.read(page,'/api/staff/session');
    need(session.authenticated&&session.installationId===this.value.native.installationId&&session.principal.role===role&&session.principal.id===(role==='owner'?'owner':this.value.native.staff[role]),'The actual browser session differs from its selected original staff/installation.');
    return {role,page,context,identity:{installationId:session.installationId,id:session.principal.id,role,actor:session.principal.actor}};
  }
  async read(page,route,body){
    this.check();need(route.startsWith('/api/'),'Read the original installed API.');
    if(body!==undefined)need(route.endsWith('/risk-register-request'),'Browser companion writes use actual controls; only exact-request reconciliation is read here.');
    const result=await page.evaluate(async ({route,body})=>{
      const staff=await import('/staff-session.mjs');return staff.staffRequest(route,body);
    },{route,body});
    this.check();return result;
  }
  async idle(page){
    await page.waitForFunction(()=>![...document.querySelectorAll('.delivery-risk-desk')].some(x=>x.getAttribute('aria-busy')==='true'));
    const deadline=Date.now()+30000;
    while(this.owner.tasks.size||this.owner.network.size){await Promise.all([...this.owner.tasks]);this.check();need(Date.now()<deadline,'The original page still owns unfinished requests.');await pause(25);}
    const alerts=page.locator('.delivery-risk-desk [role=alert]');need(await alerts.count()===0,'The original risk desk reports: '+(await alerts.allTextContents()).join(' '));this.check();
  }
  async openCase(actor,caseId){
    const {page}=actor;await page.goto(this.value.native.origin+'/',{waitUntil:'networkidle'});
    await page.locator('#workbench').waitFor({state:'visible'});
    const tab=page.locator('#sections [data-tab=operations]');if(await tab.count())await tab.click();
    const cases=page.getByLabel('Retained case',{exact:true});await cases.selectOption(caseId);
    // Expand the original navigation group through its real summary control.
    const button=page.locator('[data-nav-section="risks"]').last();
    const group=page.locator('[data-nav-group]').filter({has:page.locator('[data-nav-section="risks"]')});
    if(await group.count()&&await group.getAttribute('open')===null)await group.locator('summary').click();
    if(!await button.isVisible()&&await page.locator('[data-nav-toggle]').isVisible())await page.locator('[data-nav-toggle]').click();
    await button.click();await page.locator('.delivery-risk-desk').waitFor();await this.idle(page);
    const selected=await cases.inputValue();need(selected===caseId,'The actual operator opened another case.');
  }
  async click(page,action,extra=''){
    this.check();await page.locator('.delivery-risk-desk [data-risk-action="'+action+'"]'+extra).first().click();await this.idle(page);
  }
  async tab(page,tab){await this.click(page,'tab','[data-risk-tab="'+tab+'"]');}
  async openEdition(actor,reviewId){
    await this.tab(actor.page,'editions');await this.click(actor.page,'open','[data-review-id="'+reviewId+'"]');
    await actor.page.locator('.risk-edition').filter({hasText:reviewId}).waitFor();
  }
  async capture(actor,name){
    const text=await actor.page.locator('main').innerText();return this.artifact('artifacts/'+name+'.txt',Buffer.from(text+'\n'));
  }
  async download(actor,name,action,expected=null){
    const filename=path.join(this.root,'downloads',name);
    const receiptFile=path.join(this.root,'.private','download-'+name+'.json');
    if(await exists(receiptFile)){
      const receipt=JSON.parse((await file(receiptFile,{privateMode:true})).raw);
      need(receipt.selectionSha256===this.value.selectionSha256&&receipt.role===actor.role&&receipt.name===name,'The original download belongs to another selected course.');
      const from=await exists(filename)?filename:receipt.temporary;
      need(from===filename||from.startsWith(path.join(this.root,'attempts')+path.sep),'The original retained download temporary changed scope.');
      const got=await selected({path:from,bytes:receipt.bytes,sha256:receipt.sha256});
      if(expected)need(got.sha256===expected,'The original source download changed.');
      const retained=await this.artifact('downloads/'+name,got.raw);
      this.journal.files=[...this.publicFiles.values()];await this.saveJournal();return retained;
    }
    need(!await exists(filename),'A download exists without its original selected download receipt.');
    let download,primary;
    const promise=this.owner.track(actor.page.waitForEvent('download',{timeout:30000}).then(value=>{download=value;this.owner.downloads.add(value);return value;}));promise.catch(()=>{});
    try{
      await action();download=await promise;
      const temp=path.join(this.attempt,randomUUID()+'.download');await download.saveAs(temp);
      need(await download.failure()===null,'The original download failed.');
      const got=await file(temp);need(got.bytes>0,'The original download is empty.');
      if(expected)need(got.sha256===expected,'The complete downloaded source SHA differs.');
      await publish(receiptFile,bytes({selectionSha256:this.value.selectionSha256,role:actor.role,name,temporary:temp,bytes:got.bytes,sha256:got.sha256}));
      const row=await this.artifact('downloads/'+name,got.raw);await fs.unlink(temp);await sync(this.attempt);
      await download.delete();this.owner.downloads.delete(download);this.journal.files=[...this.publicFiles.values()];await this.saveJournal();return row;
    }catch(e){primary=e;promise.catch(()=>{});if(download)try{await download.cancel();this.owner.downloads.delete(download);}catch{}throw primary;}
  }
  async closeActor(actor){
    await this.idle(actor.page);if(actor.role==='lead')await this.snapshot(actor.page,'lead');
    await publish(path.join(this.root,'.private',actor.role+'-storage.json'),bytes(await actor.context.storageState()),{replace:true});
    // The native sign-out control drains the admitted desk before page/context release.
    await actor.page.locator('#sign-out').click();await actor.page.waitForLoadState('networkidle');
    await actor.context.close();this.owner.contexts.delete(actor.context);
  }
  async reader(role){
    const actor=await this.actor(role);const n=this.value.native;await this.openCase(actor,n.originalCaseId);
    await this.openEdition(actor,n.firstReviewId);
    need((await actor.page.locator('.risk-edition').innerText()).includes('differs'),'The retained original edition must explain its changed linked source.');
    await this.capture(actor,role+'-first-edition');
    await this.openEdition(actor,n.secondReviewId);await this.click(actor.page,'history','[data-risk-id="'+n.riskId+'"]');
    const history=await this.read(actor.page,'/api/operations/'+n.originalCaseId+'/risk-register-history/'+n.riskId);
    need([n.firstReviewId,n.secondReviewId].every(id=>history.entries.some(row=>row.edition.id===id)),'Both immutable editions must remain in native history.');
    await this.artifact('artifacts/'+role+'-history.json',bytes(history));
    await this.tab(actor.page,'register');await this.click(actor.page,'seed');await this.click(actor.page,'preview');
    need(await actor.page.locator('[data-risk-action=save]').isDisabled(),'This reader role must not acquire a save grant.');
    await this.capture(actor,role+'-preview');await this.closeActor(actor);return {identity:actor.identity,readOnly:true,history:[n.firstReviewId,n.secondReviewId]};
  }
  async lead(){
    const actor=await this.actor('lead'),page=actor.page,n=this.value.native,base='/api/operations/'+n.originalCaseId;
    await this.openCase(actor,n.originalCaseId);
    if(this.journal.third){
      await this.tab(page,'request');
      if(await page.locator('[data-risk-action=finish]').count())await this.click(page,'finish');
      else if(await page.locator('[data-risk-action=reconcile]').count()){
        await this.click(page,'reconcile');
        if(await page.locator('[data-risk-action=retry]').count())await this.click(page,'retry');
      }
    }else{
      const current=await this.read(page,base);need(current.program.version===n.originalCaseVersion,'The original case changed after the native handover; retain this selection for its original owner.');
      const listing=await this.read(page,base+'/risk-register');need(listing.current.id===n.secondReviewId,'The original case has a newer edition; inspect it without inventing a replacement.');
      await this.openEdition(actor,n.secondReviewId);await this.click(page,'seed');
      await this.click(page,'choose-risk','[data-risk-id="'+n.riskId+'"]');
      const field=k=>page.locator('[data-risk-scope=risk][data-risk-field="'+k+'"]');
      await field('assessmentNote').fill('Browser operator reviewed the retained capacity assessment and completed action.');
      await field('review.on').fill(n.asOfDate);await field('review.by').fill(actor.identity.actor);
      await field('review.note').fill('Reviewed through the installed Delivery risks desk; original entry, action and source identities retained.');
      await page.locator('[data-risk-save-note]').fill('Browser operator receiving: explicit third edition of the original walkthrough case.');
      await this.snapshot(page,'lead');await this.click(page,'preview');
      const preview=await page.locator('[data-risk-preview] pre').last().textContent();const value=JSON.parse(preview);
      need(value.document.supersedes.reviewId===n.secondReviewId&&SHA.test(value.previewSha256),'The actual UI preview selected another predecessor.');
      await this.artifact('artifacts/third-preview.json',bytes(value));
      await this.click(page,'save');
    }
    need(this.journal.third,'The actual desk did not retain its original command.');
    const command=this.journal.third.command;
    const lookup=await this.read(page,base+'/risk-register-request',{command});
    need(lookup.found&&lookup.requestId===command.requestId,'Reconcile the exact original third-edition request before completion.');
    this.rememberThird(command,lookup.result);await this.saveJournal();
    const rid=lookup.result.recordId,book=await this.read(page,base+'/risk-register/'+rid);
    need(book.review.sha256===lookup.result.reviewSha256&&book.previewSha256===command.data.expectedPreviewSha256&&book.document.supersedes.reviewId===n.secondReviewId,'The accepted third edition differs from its original preview.');
    await this.artifact('artifacts/third-book.json',bytes(book));
    await this.openEdition(actor,rid);await this.capture(actor,'lead-third-edition');
    const archive=await this.download(actor,'lead-third-edition.zip',()=>this.click(page,'export-edition','[data-review-id="'+rid+'"]'));
    await this.click(page,'inspect-risk','[data-risk-id="'+n.riskId+'"]');
    const source=await this.download(actor,'original-source.json',()=>this.click(page,'source','[data-source-id="'+n.sourceId+'"]'),n.sourceSha256);
    await this.click(page,'history','[data-risk-id="'+n.riskId+'"]');
    const history=await this.read(page,base+'/risk-register-history/'+n.riskId);
    need(history.entries[0].edition.id===rid&&[n.firstReviewId,n.secondReviewId].every(id=>history.entries.some(row=>row.edition.id===id)),'The full original lineage was not retained.');
    await this.artifact('artifacts/lead-history.json',bytes(history));await this.capture(actor,'lead-history');
    await this.tab(page,'request');
    const desk=await this.download(actor,'lead-desk-receipts.json',()=>this.click(page,'download-desk'));
    await this.closeActor(actor);return {identity:actor.identity,requestId:command.requestId,reviewId:rid,reviewSha256:lookup.result.reviewSha256,receipt:lookup.result,archive,source,desk};
  }
  async contributor(){
    const actor=await this.actor('contributor'),n=this.value.native;
    await actor.page.locator('#contributor').waitFor({state:'visible'});await actor.page.locator('#work-case').selectOption(n.originalCaseId);
    need(await actor.page.locator('#operator-link').isHidden(),'The original contributor view must not expose operator access.');
    await this.capture(actor,'contributor-original-desk');
    const download=await this.download(actor,'contributor-records.json',()=>actor.page.locator('#download-work').click());
    await this.closeActor(actor);return {identity:actor.identity,caseId:n.originalCaseId,download};
  }
  async received(){
    const actor=await this.actor('owner'),n=this.value.native,rows=[];
    for(const [label,caseId] of [['received',n.receivedCaseId],['reordered-received',n.reorderedReceivedCaseId]]){
      await this.openCase(actor,caseId);await this.openEdition(actor,n.secondReviewId);
      const book=await this.read(actor.page,'/api/operations/'+caseId+'/risk-register/'+n.secondReviewId);
      need(book.review.sha256===n.originalCommands['second-edition'].receipt.reviewSha256,'Independent receiving changed the original second edition.');
      await this.artifact('artifacts/'+label+'-book.json',bytes(book));await this.capture(actor,label+'-edition');
      const archive=await this.download(actor,label+'.zip',()=>this.click(actor.page,'export-edition','[data-review-id="'+n.secondReviewId+'"]'));
      rows.push({caseId,reviewId:n.secondReviewId,archive});
    }
    await this.closeActor(actor);return {identity:actor.identity,cases:rows};
  }
  async candidate(){
    const native=this.value.native,steps=this.journal.steps;
    need(['finance','reviewer','contributor','lead','received'].every(name=>steps[name]),'Finish every selected original browser role.');
    for(const row of this.publicFiles.values())await selected({...row,path:path.join(this.root,row.path)});
    const exports=[steps.lead.archive,...steps.received.cases.map(row=>row.archive)].map(row=>({...row,path:path.join(this.root,row.path)}));
    const value={schema:SCHEMA+'.result',status:'COMPLETED',...continuationFields(this.value),selectionSha256:this.value.selectionSha256,operationId:native.operationId,
      originalCaseId:native.originalCaseId,receivedCaseId:native.receivedCaseId,reorderedReceivedCaseId:native.reorderedReceivedCaseId,
      firstReviewId:native.firstReviewId,secondReviewId:native.secondReviewId,thirdReviewId:steps.lead.reviewId,
      thirdRequestId:steps.lead.requestId,installationId:native.installationId,
      source:this.value.stable.sourceManifest,native:this.value.stable.native,steps,exports,
      files:[...this.publicFiles.values()].sort((a,b)=>a.path.localeCompare(b.path))};
    this.candidateValue=value;
    this.candidateFile=await publish(path.join(this.root,'risk-browser-candidate.json'),bytes(value));
  }
  async run(){
    // A fully retained business outcome is packaged locally after confirming all
    // original attempt processes are absent. No replacement browser is started.
    if(['finance','reviewer','contributor','lead','received'].every(name=>this.journal.steps[name]))return this.candidate();
    await this.owner.launch();
    await this.step('finance',()=>this.reader('finance'));
    await this.step('reviewer',()=>this.reader('reviewer'));
    await this.step('contributor',()=>this.contributor());
    await this.step('lead',()=>this.lead());
    await this.step('received',()=>this.received());
    this.journal.files=[...this.publicFiles.values()];await this.saveJournal();await this.candidate();
  }
}
async function inspect(value,{repair=false}={}){
  const root=value.input.outputDirectory,filename=path.join(root,'risk-browser-result.json');
  if(!await exists(filename)){
    if(!repair||!await exists(path.join(root,'risk-browser-candidate.json')))return null;
    await assertNoPriorBrowser(root);
    const candidate=await file(path.join(root,'risk-browser-candidate.json')),valueCandidate=JSON.parse(candidate.raw);
    for(const name of await fs.readdir(path.join(root,'attempts'))){
      const closurePath=path.join(root,'attempts',name,'BROWSER_CLOSED.json');if(!await exists(closurePath))continue;
      const closureFile=await file(closurePath),closure=JSON.parse(closureFile.raw);
      if(closure.schema!==SCHEMA+'.closed'||closure.status!=='CLOSED'||closure.outcome!=='COMPLETED'||
        closure.selectionSha256!==value.selectionSha256||!same(closure.candidate,short(candidate))||!closedOwners(closure.owners))continue;
      need(valueCandidate.selectionSha256===value.selectionSha256,'The original closed candidate selection changed.');
      sameContinuation(valueCandidate,value);sameContinuation(closure,value);
      for(const row of valueCandidate.files)await selected({...row,path:path.join(root,relative(row.path))});
      const completed={...valueCandidate,closure:{path:path.relative(root,closurePath),bytes:closureFile.bytes,sha256:closureFile.sha256},attemptId:closure.attemptId};
      await publish(filename,bytes(completed));break;
    }
    if(!await exists(filename))return null;
  }
  const raw=await file(filename),result=JSON.parse(raw.raw);
  need(result.schema===SCHEMA+'.result'&&result.status==='COMPLETED'&&result.selectionSha256===value.selectionSha256,'The original completed browser result belongs to another selection.');
  sameContinuation(result,value);
  const seen=new Set();
  for(const row of result.files){relative(row.path);need(!seen.has(row.path),'Duplicate result member.');seen.add(row.path);await selected({...row,path:path.join(root,row.path)});}
  const closure=await selected({...result.closure,path:path.join(root,relative(result.closure.path))}),closed=JSON.parse(closure.raw);
  need(closed.schema===SCHEMA+'.closed'&&closed.status==='CLOSED'&&closed.selectionSha256===value.selectionSha256&&closed.outcome==='COMPLETED'&&closedOwners(closed.owners),'The accepted browser invocation did not close its original owners.');
  sameContinuation(closed,value);
  const candidate=await selected(closed.candidate),saved=JSON.parse(candidate.raw),{closure:ignored,attemptId:ignoredAttempt,...resultBody}=result;
  need(same(saved,resultBody)&&same(result.source,value.stable.sourceManifest)&&same(result.native,value.stable.native),'The final result differs from its complete original closed candidate.');
  for(const row of result.exports){
    const name=path.relative(root,row.path);relative(name);
    const member=result.files.find(f=>f.path===name);need(member&&row.bytes===member.bytes&&row.sha256===member.sha256,'The original export is outside the manifested result.');
  }
  need(result.originalCaseId===value.native.originalCaseId&&result.firstReviewId===value.native.firstReviewId&&result.secondReviewId===value.native.secondReviewId,'A completed result changed its original case.');
  return result;
}
export async function inspectRiskBrowser(input){return inspect(await inputs(input));}
export async function receiveRiskBrowser(input){
  const guard=new Guard(input.parentGuard);let course,value,result,first,closed,local=false;
  const signal=()=>{const e=new Error('The original browser course was interrupted.');if(course)course.fail(e);else first??=e;};
  const outputError=e=>{if(course)course.fail(e);else first??=e;};
  process.on('SIGINT',signal);process.on('SIGTERM',signal);process.stdout.on('error',outputError);process.stderr.on('error',outputError);
  try{
    await guard.check();value=await inputs(input);if(first)throw first;
    result=await inspect(value,{repair:true});
    if(result){local=true;}
    else{course=new Course(value,guard);await course.open();await course.run();}
  }catch(e){first=e;}
  finally{
    if(course){
      course.admission=false;
      do{try{await course.owner.close();}catch(e){first??=e;}if(!course.owner.fullyClosed)await pause(250);}while(!course.owner.fullyClosed);
      first??=course.first;
      try{await course.writeChain;}catch(e){first??=e;}
      try{await guard.check();}catch(e){first??=e;}
    }
    try{guard.close();}catch(e){first??=e;}
    // This is written after this child's actual inherited descriptor closes.
    if(course)try{
      closed=await publish(path.join(course.attempt,'BROWSER_CLOSED.json'),bytes({
        schema:SCHEMA+'.closed',status:guard.closed?'CLOSED':'CLOSE_UNCERTAIN',...continuationFields(value),selectionSha256:value.selectionSha256,attemptId:course.attemptId,
        outcome:first?'INTERRUPTED':'COMPLETED',owners:{browser:true,contexts:true,downloads:true,tasks:true,files:true,guard:guard.closed},
        guardCloseError:guard.closeError?errorValue(guard.closeError):null,process:course.owner.exit||null,candidate:course.candidateFile||null,error:first?errorValue(first):null}));
    }catch(e){first??=e;}
    if(local&&value)try{
      const directory=await mkdir(path.join(value.input.outputDirectory,'attempts',randomUUID()));
      await publish(path.join(directory,'BROWSER_CLOSED.json'),bytes({schema:SCHEMA+'.closed',status:guard.closed?'CLOSED':'CLOSE_UNCERTAIN',...continuationFields(value),localOnly:true,
        selectionSha256:value.selectionSha256,reusedResult:short(await file(path.join(value.input.outputDirectory,'risk-browser-result.json'))),
        owners:{browser:true,contexts:true,downloads:true,tasks:true,files:true,guard:guard.closed},
        guardCloseError:guard.closeError?errorValue(guard.closeError):null}));
    }catch(e){first??=e;}
    process.off('SIGINT',signal);process.off('SIGTERM',signal);
    // The command entry retains output listeners through its final write/turn.
    process.stdout.off('error',outputError);process.stderr.off('error',outputError);
  }
  if(first)throw first;
  if(!result){
    result={...course.candidateValue,closure:{path:path.relative(course.root,closed.path),bytes:closed.bytes,sha256:closed.sha256},attemptId:course.attemptId};
    await publish(path.join(course.root,'risk-browser-result.json'),bytes(result));
  }
  return result;
}
async function main(){
  process.umask(0o077);const args=process.argv.slice(2);
  need(args.length===3&&['run','inspect'].includes(args[0])&&args[1]==='--input','Use run|inspect --input /absolute/input.json.');
  const input=JSON.parse((await file(args[2],{privateMode:true,maximum:32*1024*1024})).raw);
  let first;const onError=e=>{first??=e;};process.stdout.on('error',onError);process.stderr.on('error',onError);
  try{
    const value=args[0]==='inspect'?await inspectRiskBrowser(input):await receiveRiskBrowser(input);
    await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',e=>e?reject(e):resolve()));
    await new Promise(resolve=>setImmediate(resolve));if(first)throw first;
  }finally{process.stdout.off('error',onError);process.stderr.off('error',onError);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  main().catch(error=>{process.exitCode=1;process.stderr.write(JSON.stringify({schema:SCHEMA+'.error',error:errorValue(error)})+'\n');});
}

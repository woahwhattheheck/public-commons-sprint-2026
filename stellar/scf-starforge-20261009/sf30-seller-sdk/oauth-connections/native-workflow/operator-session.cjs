// One operator browser attached to the original local OAuth native workflow.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {setTimeout:pause}=require('node:timers/promises');
const rootOption=process.env.SCF_OAUTH_WORKSPACE_ROOT;
if(!rootOption)throw new Error('Set SCF_OAUTH_WORKSPACE_ROOT to the existing private native workflow directory.');
const ROOT=path.resolve(rootOption),DIR=path.join(ROOT,'acceptance');
const PRIVATE=path.join(ROOT,'native-private'),READY=path.join(PRIVATE,'ready.json');
const COMMANDS=path.join(DIR,'commands'),CONTROLS=path.join(DIR,'control');
const modulePath=process.env.SCF_OAUTH_PLAYWRIGHT_MODULE_PATH||
  (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]}):require.resolve('playwright'));
const {chromium}=require(modulePath);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const progressPath=path.join(DIR,'operator-progress.json');
const prior=fs.existsSync(progressPath)?JSON.parse(fs.readFileSync(progressPath,'utf8')):{};
const steps=prior.steps||[],pageErrors=prior.pageErrors||[],consoleErrors=prior.consoleErrors||[],externalRequests=prior.externalRequests||[];
const capabilities=new Set();
let ready,origin,providerOrigin,browser,context,page,closed=false,processing=false;
function check(value,message){if(!value)throw new Error(message);}
function safe(value){
 let text=JSON.stringify(value);
 for(const secret of capabilities)if(secret)text=text.split(secret).join('[workspace capability]');
 return JSON.parse(text);
}
function persist(file,value){
 const temporary=file+'.'+randomUUID()+'.tmp';
 const descriptor=fs.openSync(temporary,'wx',0o600);
 try{fs.writeFileSync(descriptor,JSON.stringify(safe(value),null,2)+'\n');fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
 fs.renameSync(temporary,file);
}
function record(label,data={}){
 const entry=safe({label,at:new Date().toISOString(),...data});steps.push(entry);
 persist(progressPath,{steps,pageErrors,consoleErrors,externalRequests});return entry;
}
function readReady(){
 const info=fs.lstatSync(READY);
 check(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'Use the original private native readiness file (mode 0600).');
 if(typeof process.getuid==='function')check(info.uid===process.getuid(),'Native readiness belongs to another operator.');
 const value=JSON.parse(fs.readFileSync(READY,'utf8'));
 const target=new URL(value.workspaceUrl),provider=new URL(value.providerOrigin);
 check(target.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(target.hostname),'The operator attaches only to the original local workspace.');
 check(provider.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(provider.hostname),'Use the original declared local protocol peer.');
 const token=value.workspaceToken||target.hash.slice(1);
 check(typeof token==='string'&&token.length>=32,'The native workspace capability is missing.');
 capabilities.add(token);value.workspaceToken=token;
 ready=value;origin=target.origin;providerOrigin=provider.origin;return value;
}
async function attach(){
 readReady();
 await page.goto(origin+'/#'+encodeURIComponent(ready.workspaceToken));
 await page.waitForFunction(()=>document.querySelector('#output')?.textContent.startsWith('Output: '),{},{timeout:60000});
 await page.locator('#oauth-connection-alias').waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('#oauth-connection-alias').disabled,{},{timeout:60000});
 return {workspaceOrigin:origin,providerOrigin};
}
async function read(route){
 check(typeof route==='string'&&route.startsWith('/api/'),'Read an original workspace API path.');
 const response=await page.request.get(origin+route,{headers:{'x-workspace-token':ready.workspaceToken}});
 const value=await response.json();check(response.ok()&&!value.error,value.error||'The original workspace read failed');return value;
}
async function settled(){
 await page.waitForFunction(()=>document.querySelector('#refresh')?.disabled===false,{},{timeout:60000});
}
async function clickApi(locator,apiPath,{allowError=false}={}){
 const response=page.waitForResponse(r=>new URL(r.url()).origin===origin&&new URL(r.url()).pathname===apiPath&&r.request().method()==='POST',{timeout:60000});
 await locator.click();const result=await response,body=await result.json();await settled();
 if(!allowError)check(result.ok()&&!body.error,body.error||'The operator command failed.');
 return {status:result.status(),body};
}
async function authorize(alias,{actor='Local workflow operator',reference='Declared local protocol consent review'}={}){
 await page.locator('#oauth-connection-alias').selectOption(alias);
 await settled();
 const begun=await clickApi(page.locator('#oauth-begin'),'/api/oauth/command');
 const popup=context.waitForEvent('page');
 await page.locator('#oauth-authorize-link').click();
 const consent=await popup;
 await consent.getByRole('button',{name:'Allow records access',exact:true}).click();
 await consent.waitForURL(url=>url.origin===origin&&url.pathname==='/oauth-return',{timeout:60000});
 check(!new URL(consent.url()).searchParams.has('code')&&!new URL(consent.url()).searchParams.has('state'),'The return URL retained authorization parameters.');
 await consent.close();
 await page.getByRole('button',{name:'Refresh authorization',exact:true}).click();await settled();
 await page.locator('#oauth-review-actor').fill(actor);
 await page.locator('#oauth-review-reference').fill(reference);
 await page.locator('#oauth-review-confirm').check();
 const approved=await clickApi(page.locator('#oauth-approve'),'/api/oauth/command');
 const current=await read('/api/oauth/connection?alias='+encodeURIComponent(alias));
 check(current.alias===alias&&current.grant.state==='connected','The reviewed grant was not retained for the selected alias.');
 return {alias,flowId:begun.body.flowId,grantId:current.grant.id,scopes:current.grant.scopes,
   profileSha256:current.profileSha256,approvalStatus:approved.status};
}
async function control(action,payload={},retainedId){
 const id=retainedId||'operator-'+randomUUID();
 check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id),'Retain the original native controller request identity.');
 const request={id,action,payload};
 fs.mkdirSync(CONTROLS,{recursive:true,mode:0o700});
 const file=path.join(CONTROLS,id+'.request.json'),result=path.join(CONTROLS,id+'.result.json');
 const requestBytes=Buffer.from(JSON.stringify(request,null,2)+'\n');
 if(fs.existsSync(file))check(hash(fs.readFileSync(file))===hash(requestBytes),'This native controller identity already retains different request bytes.');
 else persist(file,request);
 const inputHash=hash(requestBytes),start=Date.now();
 while(!fs.existsSync(result)){
  if(Date.now()-start>60000)throw new Error('The original native controller has not returned '+id+'. Retain this request before taking another action.');
  await pause(75);
 }
 const answer=JSON.parse(fs.readFileSync(result,'utf8'));
 check(answer.id===id&&answer.inputHash===inputHash,'The native controller returned another request identity.');
 check(answer.ok,answer.error?.message||answer.error||'The original native controller action failed.');
 return answer.result;
}
async function screenshot(filename){
 check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.png$/.test(filename),'Choose a local PNG filename.');
 const target=path.join(DIR,filename);await page.screenshot({path:target,fullPage:false});return target;
}
async function downloadAt(locator,filename){
 check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,140}$/.test(filename),'Choose a local download filename.');
 const event=page.waitForEvent('download');await locator.click();const download=await event;
 const target=path.join(DIR,filename);await download.saveAs(target);
 const bytes=fs.readFileSync(target);return {path:target,bytes:bytes.length,sha256:hash(bytes)};
}
async function finish(){
 if(closed)return;closed=true;
 if(browser)await browser.close();
 record('operator_browser_closed');
}
process.on('SIGTERM',()=>finish().finally(()=>process.exit(0)));
process.on('SIGINT',()=>finish().finally(()=>process.exit(0)));
(async()=>{
 fs.mkdirSync(COMMANDS,{recursive:true,mode:0o700});
 const tempRoot=path.resolve(process.env.SCF_OAUTH_BROWSER_TMPDIR||path.join(PRIVATE,'browser-temp'));
 fs.mkdirSync(tempRoot,{recursive:true,mode:0o700});
 browser=await chromium.launch({executablePath:process.env.SCF_OAUTH_BROWSER_EXECUTABLE||chromium.executablePath(),
  headless:true,env:{...process.env,TMPDIR:tempRoot},args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 context=await browser.newContext({viewport:{width:1360,height:1000},acceptDownloads:true});
 context.on('page',value=>{
  value.on('pageerror',error=>pageErrors.push(safe(String(error))));
  value.on('console',message=>{if(message.type()==='error')consoleErrors.push(safe(message.text()));});
 });
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){
   externalRequests.push({origin:url.origin,path:url.pathname,type:route.request().resourceType(),blocked:true});return route.abort();
  }
  return route.continue();
 });
 page=await context.newPage();page.setDefaultTimeout(20000);
 await attach();record('operator_attached_to_original_workspace',{origin,providerOrigin});
 persist(path.join(DIR,'operator-ready.json'),{ready:true,origin,providerOrigin,pid:process.pid,commands:COMMANDS});
 process.stdout.write(JSON.stringify({operator_ready:true,origin,pid:process.pid})+'\n');
 const timer=setInterval(async()=>{
  if(processing||closed)return;
  const names=fs.readdirSync(COMMANDS).filter(name=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}\.request\.json$/.test(name)).sort();
  if(!names.length)return;processing=true;
  const file=path.join(COMMANDS,names[0]),out=file.replace('.request.json','.response.json'),started=file.replace('.request.json','.started.json');
  let inputHash=null,mayWriteResponse=true,removeRequest=false;
  try{
   const info=fs.lstatSync(file);
   check(info.isFile()&&!info.isSymbolicLink()&&info.size<=512*1024,'Use a regular local operator request within 512 KiB.');
   check((info.mode&0o077)===0,'Operator requests must remain private (mode 0600).');
   if(typeof process.getuid==='function')check(info.uid===process.getuid(),'The operator request belongs to another local owner.');
   const bytes=fs.readFileSync(file);inputHash=hash(bytes);const command=JSON.parse(bytes);
   if(fs.existsSync(out)){
    mayWriteResponse=false;
    const existing=JSON.parse(fs.readFileSync(out,'utf8'));check(existing.inputHash===inputHash,'This operator request identity already has different retained bytes.');
    removeRequest=true;return;
   }
   if(fs.existsSync(started)){mayWriteResponse=false;throw new Error('A prior operator process began this exact request without a final response. Inspect its original state before resuming.');}
   persist(started,{inputHash,startedAt:new Date().toISOString()});
   if(command.close){
    await finish();persist(out,{inputHash,ok:true,closed:true});fs.unlinkSync(file);clearInterval(timer);process.exit(0);
   }
   check(typeof command.code==='string','Provide the trusted local operator command source.');
   // The private on-disk queue is an operator development interface, never a web endpoint.
   const result=await eval('(async()=>{'+command.code+'\n})()');
   persist(out,{inputHash,ok:true,result:result??null});removeRequest=true;
  }catch(error){
   if(mayWriteResponse&&inputHash&&!fs.existsSync(out)){
    persist(out,{inputHash,ok:false,error:String(error),stack:error.stack});removeRequest=true;
   }else{
    // Keep original requests, start markers and responses intact when identity
    // is unresolved. The existing controller owner decides how to continue.
    record('operator_request_requires_review',{request:names[0],error:String(error)});
    clearInterval(timer);await finish();process.exitCode=1;
   }
  }finally{
   if(removeRequest&&fs.existsSync(file))fs.unlinkSync(file);processing=false;
  }
 },150);
})().catch(async error=>{
 process.stdout.write(JSON.stringify(safe({startup_error:String(error)}))+'\n');
 await finish();process.exit(1);
});

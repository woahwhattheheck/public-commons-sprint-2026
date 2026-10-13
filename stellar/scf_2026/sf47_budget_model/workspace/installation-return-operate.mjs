#!/usr/bin/env node
// MIT. One original Installation continuation host; no alternate financial model.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {GrantWorkspaceClient,inspectGrantAgentBinding} from './agent-client.mjs';
import {runInstallationReturnContinuation} from './installation-return-continuation.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
async function atomic(file,value){
  const raw=Buffer.from(JSON.stringify(value,null,2)+'\n'),tmp=file+'.'+randomUUID()+'.partial';
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(raw);await h.sync();}finally{await h.close();}
  await fs.rename(tmp,file);
}
async function optional(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function processResult(child){
  return new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
}
async function native(python,args,env){
  const child=spawn(python,['-B',...args],{env,stdio:['ignore','pipe','pipe']});
  const finished=processResult(child),errors=[];
  child.stdout.on('data',raw=>process.stdout.write(raw));
  child.stderr.on('data',raw=>{errors.push(raw);process.stderr.write(raw);});
  const result=await finished;
  need(result.code===0,'The original native receiving needs correction: '+Buffer.concat(errors).toString('utf8').slice(-3000));
  return result;
}

export async function operateInstallationReturn(config){
  for(const key of ['sourceRoot','workspaceDirectory','coreReceivedDirectory','receivedDirectory','finalReceivedDirectory','outputDirectory',
    'pythonExecutable','chrome','playwrightModule'])need(path.isAbsolute(config[key]),'Select the original absolute '+key+'.');
  const nativeConfig=Object.fromEntries(['operationId','sourceRoot','workspaceDirectory','coreReceivedDirectory',
    'receivedDirectory','finalReceivedDirectory','outputDirectory'].map(k=>[k,config[k]]));
  if(Object.hasOwn(config,'completedBase'))nativeConfig.completedBase=structuredClone(config.completedBase);
  const output=config.outputDirectory,inputFile=path.join(output,'native-input.json');
  await fs.mkdir(output,{recursive:true,mode:0o700});
  const existing=await optional(inputFile);
  if(existing)need(JSON.stringify(existing)===JSON.stringify(nativeConfig),'Keep the original native selection.');
  else await atomic(inputFile,nativeConfig);
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',SF30_XML_NODE:process.execPath,SF47_SUPPORT_NODE:process.execPath};
  const coreProgram=path.join(HERE,'installation-return-continuation.py');
  await native(config.pythonExecutable,[coreProgram,'--input',inputFile,'--phase','prepare'],env);
  const browserDirectory=path.join(output,'browser'),browserResult=await optional(path.join(browserDirectory,'result.json'));
  if(browserResult?.state==='COMPLETE'){
    await native(config.pythonExecutable,[coreProgram,'--input',inputFile,'--phase','finish'],env);
    return await optional(path.join(output,'result.json'));
  }
  const hostFile=path.join(output,'host-progress.json');
  const retained=await optional(hostFile);
  const state=retained||{schema:'sf47.installation-return-host.v1',operationId:config.operationId,
    port:0,activeDirectory:config.receivedDirectory,starts:[]};
  need(state.operationId===config.operationId&&[config.receivedDirectory,config.finalReceivedDirectory].includes(state.activeDirectory),
    'Keep the original application or its declared cold receiver.');
  let child=null,closed=null,client=null,context=null,page=null,stopping=false;
  const browserProfile=path.join(path.dirname(output),'browser-profile');
  const closeServer=async()=>{
    if(client){await client.close();client=null;}
    if(child){
      const owned=child;owned.kill('SIGTERM');
      const result=await closed;need(result.code===0||result.signal==='SIGTERM','The original server did not close normally.');
      if(child===owned){child=null;closed=null;}
    }
  };
  async function start(directory){
    need(!child&&!client,'Close the single original server before reopening it.');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const binding=await inspectGrantAgentBinding({directory,scenarioFile:path.join(HERE,'..','sf10_current_candidate.json'),
      pythonExecutable:config.pythonExecutable,allowStart:false,label:'Original amended Installation receiving'});
    let resolveAnnouncement,rejectAnnouncement,buffer='',diagnostics='';
    const announcement=new Promise((resolve,reject)=>{resolveAnnouncement=resolve;rejectAnnouncement=reject;});announcement.catch(()=>{});
    child=spawn(config.pythonExecutable,['-B',path.join(HERE,'server.py'),'--workspace',directory,
      '--scenario',binding.scenarioFile,'--port',String(state.port),'--startup-format','managed',
      '--expected-selection-sha256',binding.selectionSha256,'--source-directory',HERE],{
      env,stdio:['ignore','pipe','pipe']});
    closed=processResult(child);
    child.stdout.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      if(buffer.length>131072){rejectAnnouncement(new Error('The original launch announcement exceeded its bound.'));return;}
      const newline=buffer.indexOf('\n');
      if(newline>=0){
        try{resolveAnnouncement(JSON.parse(buffer.slice(0,newline)));}
        catch(error){rejectAnnouncement(error);}
      }
    });
    child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString('utf8')).slice(-20000);});
    closed.then(result=>rejectAnnouncement(new Error('The original server closed before its announcement: '+JSON.stringify(result)+' '+diagnostics)),rejectAnnouncement);
    let timer;
    try{
      const original=await Promise.race([announcement,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('The original managed server did not announce.')),45000))]);
      need(original.selectionSha256===binding.selectionSha256,'The original announced source selection changed.');
      state.port=Number(new URL(original.url).port);state.activeDirectory=directory;
      state.starts.push({instanceId:original.instanceId,pid:original.pid,url:original.url,selectionSha256:original.selectionSha256});
      await atomic(hostFile,state);
      client=new GrantWorkspaceClient(binding);await client.open({expectedSelectionSha256:binding.selectionSha256});
      return await client.browser();
    }finally{clearTimeout(timer);}
  }
  async function openOperations(selectedPage){
    await selectedPage.locator('#workbench').waitFor({state:'visible'});
    await selectedPage.locator('#sections [data-tab="operations"]').click();
    await selectedPage.locator('.operations').waitFor({state:'visible'});
    await selectedPage.waitForFunction(()=>document.querySelector('.operations')?.getAttribute('aria-busy')==='false');
  }
  const reopen=async(directory)=>{
    await closeServer();const access=await start(directory);
    await page.goto(access.url,{waitUntil:'domcontentloaded'});
    await page.locator('#workbench').waitFor({state:'visible'});
    return{page,client};
  };
  const terminate=()=>{if(stopping)return;stopping=true;child?.kill('SIGTERM');};
  process.on('SIGINT',terminate);process.on('SIGTERM',terminate);
  try{
    const access=await start(state.activeDirectory);
    const loaded=await import(pathToFileURL(config.playwrightModule).href);
    const chromium=loaded.chromium||loaded.default?.chromium;
    need(chromium,'Use the installed original Playwright Chromium module.');
    await fs.mkdir(browserProfile,{recursive:true,mode:0o700});
    context=await chromium.launchPersistentContext(browserProfile,{
      executablePath:config.chrome,headless:true,viewport:{width:1365,height:960},
      acceptDownloads:true,downloadsPath:path.join(path.dirname(output),'browser-downloads'),
      args:['--no-sandbox','--disable-dev-shm-usage']});
    page=context.pages()[0]||await context.newPage();await page.goto(access.url,{waitUntil:'domcontentloaded'});
    await page.locator('#workbench').waitFor({state:'visible'});
    const outcome=await runInstallationReturnContinuation({page,client,
      preparedFile:path.join(output,'prepared.json'),outputDirectory:browserDirectory,openOperations,
      restart:()=>reopen(state.activeDirectory),openEmptyReceiver:()=>reopen(config.finalReceivedDirectory)});
    need(outcome.state==='COMPLETE','The original browser continuation is unfinished.');
    await context.close();context=null;await closeServer();
    await native(config.pythonExecutable,[coreProgram,'--input',inputFile,'--phase','finish'],env);
    const result=await optional(path.join(output,'result.json'));
    need(result?.state==='COMPLETE','The final complete native receiving did not finish.');
    return result;
  }catch(error){
    await atomic(path.join(output,'host-interrupted.json'),{schema:'sf47.installation-return-host-interrupted.v1',
      operationId:config.operationId,message:error.message,stack:error.stack,
      activeDirectory:state.activeDirectory,port:state.port});
    throw error;
  }finally{
    process.off('SIGINT',terminate);process.off('SIGTERM',terminate);
    if(context)await context.close();
    await closeServer();
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);need(args.length===2&&args[0]==='--input','Use --input with the original complete host JSON.');
  const result=await operateInstallationReturn(JSON.parse(await fs.readFile(args[1],'utf8')));
  process.stdout.write(JSON.stringify({status:result.status,state:result.state,operationId:result.operationId})+'\n');
}

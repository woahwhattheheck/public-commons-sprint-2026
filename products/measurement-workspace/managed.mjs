#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// A Runtime-owned transport around the unchanged original Measurements CLI.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,unlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CONFIG_SCHEMA,CONNECTION_SCHEMA,STARTUP_SCHEMA,ENGINE_ROOT,need,plain,canonical,hash,same,
 absolute,portNumber,regular,readConfiguration,inspectSource,directoryIdentity,tokenFor,saveJSON,operationLease}
 from './connection.mjs';

export function managedOptions(argv){
  const values={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    need(['--configuration','--configuration-sha256','--source-manifest-sha256','--port'].includes(key)&&!Object.hasOwn(values,key)&&typeof value==='string'&&!value.startsWith('--'),
      'MEASUREMENTS_ARGUMENT','Use each documented option once with its complete value.');
    values[key]=value;
  }
  absolute(values['--configuration']);
  need(values['--configuration-sha256']===undefined||/^[a-f0-9]{64}$/.test(values['--configuration-sha256']),
    'MEASUREMENTS_CONFIGURATION_HASH');
  need(values['--source-manifest-sha256']===undefined||/^[a-f0-9]{64}$/.test(values['--source-manifest-sha256']),'MEASUREMENTS_SOURCE_HASH');
  return {configuration:values['--configuration'],configurationSha256:values['--configuration-sha256'],sourceManifestSha256:values['--source-manifest-sha256'],port:portNumber(values['--port']??0)};
}
async function nativeJSON(origin,token,path){
  const response=await fetch(origin+path,{headers:{'x-measurement-internal-token':token},redirect:'error',signal:AbortSignal.timeout(15000)});
  need(response.ok,'MEASUREMENTS_NATIVE_START','The original scientific service did not open successfully.',502);
  const reader=response.body?.getReader(),chunks=[];let size=0;need(reader,'MEASUREMENTS_NATIVE_START');
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;need(size<=4*1024*1024,'MEASUREMENTS_NATIVE_START_SIZE');chunks.push(Buffer.from(item.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
const HOP=new Set(['connection','proxy-connection','keep-alive','transfer-encoding','te','trailer','upgrade','proxy-authorization','proxy-authenticate']);
export async function startManagedMeasurements(options,{environment=process.env,stdout=process.stdout,stderr=process.stderr}={}){
  const [major,minor]=process.versions.node.split('.').map(Number);
  need(major>22||major===22&&minor>=16,'MEASUREMENTS_NODE_VERSION','Use Node 22.16 or later with the original node:sqlite support.');
  const configuration=await readConfiguration(options.configuration),v=configuration.value;
  need(!options.configurationSha256||configuration.sha256===options.configurationSha256,'MEASUREMENTS_CONFIGURATION_CHANGED',
    'Review the changed launch configuration before starting.',409);
  const agentToken=await tokenFor(v,{environment}),source=await inspectSource();
  need(!options.sourceManifestSha256||options.sourceManifestSha256===source.manifestSha256,'MEASUREMENTS_SOURCE_CHANGED','Review the changed installed source before starting.',409);
  try{await directoryIdentity(v.workspaceDirectory);}
  catch(error){if(error.code!=='ENOENT')throw error;await mkdir(v.workspaceDirectory,{mode:0o700});}
  const physical=await directoryIdentity(v.workspaceDirectory),workspaceBinding=hash(canonical(physical));
  const instanceId=randomUUID(),internalToken=randomBytes(32).toString('hex'),browserToken=randomBytes(32).toString('hex');
  const cookieName='measurements_'+instanceId.replaceAll('-','');
  let child=null,childExit=null,server=null,connection=null,lease=null,workspaceLease=null,closing=null,closed=false,origin=null,childOrigin=null;
  const pending=new Set();
  async function close(){
    if(closed)return;if(closing)return closing;
    closing=(async()=>{
      if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      if(child){if(!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.end();await childExit;}
      if(connection){
        try{const current=await regular(v.connectionFile,{maximum:65536,privateOnly:true});if(current.sha256===connection.sha256)await unlink(v.connectionFile);}
        catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(workspaceLease)await workspaceLease.close();
      if(lease)await lease.close();closed=true;
    })();
    try{return await closing;}finally{if(!closed)closing=null;}
  }
  try{
    // The original Runtime kernel lease owns this connection name. Scientific data remains in the one native child.
    lease=await operationLease(v.connectionFile+'.lock');
    workspaceLease=await operationLease(join(v.workspaceDirectory,'.measurements-managed.lock'));
    child=spawn(process.execPath,[join(ENGINE_ROOT,'cli.mjs'),'serve','--workspace',v.workspaceDirectory,'--host','127.0.0.1','--port','0'],
      {cwd:ENGINE_ROOT,env:{...environment,MEASUREMENTS_INTERNAL_TOKEN:internalToken},stdio:['pipe','pipe','pipe']});
    childExit=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    child.stdin.on('error',()=>{});
    child.stderr.on('data',chunk=>stderr.write(chunk));
    const ready=await new Promise((resolve,reject)=>{
      let buffer='',settled=false;
      const timer=setTimeout(()=>finish(new Error('Original Measurements startup did not return its ready announcement.')),30000);
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);child.off('error',onError);child.off('exit',onExit);error?reject(error):resolve(value);};
      const onError=error=>finish(error),onExit=(code,signal)=>finish(new Error('Original Measurements exited before ready: '+String(code??signal)));
      child.once('error',onError);child.once('exit',onExit);
      child.stdout.on('data',chunk=>{
        if(settled){stdout.write(chunk);return;}
        buffer+=chunk.toString('utf8');
        if(buffer.length>65536){finish(new Error('Original Measurements startup output exceeds its bound.'));return;}
        const lines=buffer.split(/\r?\n/);buffer=lines.pop();
        for(const line of lines){let item;try{item=JSON.parse(line);}catch{stdout.write(line+'\n');continue;}
          if(item?.ready===true&&item.host==='127.0.0.1'&&Number.isInteger(item.port)&&item.port>0&&item.port<=65535&&item.pid===child.pid)
            finish(null,item);
          else stdout.write(line+'\n');
        }
      });
    });
    childOrigin='http://127.0.0.1:'+ready.port;
    const intake=await nativeJSON(childOrigin,internalToken,'/api/measurement-workspace/intake');
    need(typeof intake.workspaceId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(intake.workspaceId),
      'MEASUREMENTS_NATIVE_IDENTITY','The original intake workspace identity is unavailable.',502);
    let identity;
    function deny(res,status,message){res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(message);}
    server=http.createServer((req,res)=>{
      res.setHeader('X-Measurements-Instance-ID',instanceId);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      if(closing||closed)return deny(res,503,'The retained original owner is closing.');
      if(!connection)return deny(res,503,'The complete original connection is not yet durable.');
      const expectedHost=new URL(origin).host;
      if(req.headers.host!==expectedHost)return deny(res,403,'Use the original loopback host and port.');
      let requestURL;try{requestURL=new URL(req.url,origin);}catch{return deny(res,400,'Invalid URL.');}
      if(requestURL.origin!==origin||requestURL.username||requestURL.password)return deny(res,403,'Invalid origin.');
      if(req.headers.origin!==undefined&&req.headers.origin!==origin)return deny(res,403,'Cross-origin request rejected.');
      const nativeAuthorized=same(req.headers['x-measurement-internal-token'],agentToken);
      if(nativeAuthorized&&req.headers['x-measurements-instance-id']!==instanceId)return deny(res,409,'Use the exact retained instance identity; this request belongs to another service lifetime.');
      const cookies=typeof req.headers.cookie==='string'?req.headers.cookie.split(';').map(x=>x.trim()):[];
      let browserAuthorized=cookies.includes(cookieName+'='+browserToken);
      const site=req.headers['sec-fetch-site'];
      if(!nativeAuthorized&&site==='cross-site')return deny(res,403,'Open the original Application from its local Runtime workspace.');
      const bootstrap=req.method==='GET'&&requestURL.pathname==='/'&&!requestURL.search&&
        ['none','same-origin','same-site'].includes(site)&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
      if(!nativeAuthorized&&!browserAuthorized&&bootstrap){
        res.setHeader('Set-Cookie',cookieName+'='+browserToken+'; HttpOnly; SameSite=Strict; Path=/');
        browserAuthorized=true;
      }
      if(!nativeAuthorized&&!browserAuthorized)return deny(res,403,'Use the local browser application or the configured agent token.');
      if(requestURL.pathname==='/api/measurement-workspace/connection'){
        if(req.method!=='GET'||requestURL.search)return deny(res,405,'Read the exact connection identity using GET.');
        nativeJSON(childOrigin,internalToken,'/api/measurement-workspace/intake').then(current=>{
          if(current.workspaceId!==identity.workspaceId)return deny(res,409,'The received native workspace identity changed. Stop and review this original application before creating a new connection.');
          res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(identity));
        }).catch(()=>deny(res,502,'The exact original native identity is unavailable.'));return;
      }
      const headers={};
      for(const [key,value] of Object.entries(req.headers))if(!HOP.has(key)&&!['cookie','authorization','x-measurement-internal-token','host','origin'].includes(key)&&!key.startsWith('x-forwarded-'))headers[key]=value;
      headers.host=new URL(childOrigin).host;headers['x-measurement-internal-token']=internalToken;
      if(req.headers.origin!==undefined)headers.origin=childOrigin;
      const upstream=http.request(childOrigin+requestURL.pathname+requestURL.search,{method:req.method,headers},native=>{
        if(res.destroyed){native.destroy();return;}
        res.statusCode=native.statusCode||502;
        for(const [key,value] of Object.entries(native.headers))if(!HOP.has(key)&&key!=='set-cookie'&&key!=='x-measurements-instance-id'&&value!==undefined)res.setHeader(key,value);
        res.setHeader('X-Measurements-Instance-ID',instanceId);
        native.on('error',error=>res.destroy(error));native.pipe(res);
      });
      pending.add(upstream);
      const finished=()=>pending.delete(upstream);
      upstream.once('close',finished);
      upstream.on('error',error=>{if(res.headersSent)res.destroy(error);else deny(res,502,'The original scientific response was not completed. Reconcile its original request before retry.');});
      req.once('aborted',()=>upstream.destroy());res.once('close',()=>{if(!res.writableEnded)upstream.destroy();});
      req.pipe(upstream);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
    origin='http://127.0.0.1:'+server.address().port;
    identity={schema:CONNECTION_SCHEMA,instanceId,workspaceId:intake.workspaceId,workspaceBinding,directory:v.workspaceDirectory,origin,
      pid:process.pid,childPid:child.pid,tokenEnv:v.tokenEnv,configurationFile:configuration.path,
      configurationSha256:configuration.sha256,sourceManifestSha256:source.manifestSha256,startedAt:new Date().toISOString()};
    // Do not advertise the selected origin until the complete exact connection is durable.
    await saveJSON(v.connectionFile,identity,true);
    const saved=await regular(v.connectionFile,{maximum:65536,privateOnly:true});
    need(JSON.stringify(JSON.parse(saved.bytes.toString('utf8')))===JSON.stringify(identity),'MEASUREMENTS_CONNECTION_WRITE');
    connection={...saved,value:identity};
    childExit.then(()=>{if(!closed&&!closing)close().catch(error=>stderr.write(JSON.stringify({error:{code:error.code||'MEASUREMENTS_CLOSE_FAILED',message:error.message}})+'\n'));});
    return {configuration,source,connection,origin,close,child,server,closed:()=>closed};
  }catch(error){try{await close();}catch(closeError){error.measurementsOwner={close};error.closeError=closeError;}throw error;}
}
export function startup(owner){const c=owner.connection;return {...c.value,schema:STARTUP_SCHEMA,status:'MEASUREMENTS_READY',
  connectionFile:c.path,connectionSha256:c.sha256,url:c.value.origin+'/'};}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout,waitForClose=true}={}){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){
    stdout.write('Measurements workspace\n\nstarforge measurement-workspace-managed --configuration /private/measurements/launch.json [--port 0]\n'+
      'Use original Applications Review, Save, Start and Stop. The managed adapter keeps one original scientific child and private loopback browser/agent transport.\n');
    return {help:true};
  }
  const awaitStop=owner=>new Promise(resolve=>{
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;
      try{await owner.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);resolve();}
      catch(error){stopping=false;process.stderr.write(JSON.stringify({error:{code:error.code||'MEASUREMENTS_CLOSE_FAILED',message:'Keep this same owner and retry Stop: '+error.message}})+'\n');}};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
    if(owner.child){owner.child.once('close',()=>stop());if(owner.child.exitCode!==null||owner.child.signalCode!==null)stop();}
  });
  let owner;
  try{owner=await startManagedMeasurements(managedOptions(argv),{stdout});}
  catch(error){if(error.measurementsOwner&&waitForClose)await awaitStop(error.measurementsOwner);throw error;}
  try{stdout.write(JSON.stringify(startup(owner))+'\n');}
  catch(error){try{await owner.close();}catch(closeError){if(waitForClose)await awaitStop(owner);error.closeError=closeError;}throw error;}
  if(!waitForClose)return owner;
  await awaitStop(owner);
  return {status:'CLOSED',instanceId:owner.connection.value.instanceId};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
  process.stderr.write(JSON.stringify({error:{code:error.code||'MEASUREMENTS_MANAGED_FAILED',message:error.message}})+'\n');process.exitCode=1;});

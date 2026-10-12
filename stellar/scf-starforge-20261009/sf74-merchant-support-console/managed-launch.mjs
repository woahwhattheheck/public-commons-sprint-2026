// MIT. Native SF74 selection and listener identity for the original managed Applications runner.
import {lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,basename,isAbsolute,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';

export const SUPPORT_SELECTION_SCHEMA='stellar-forge.support-console-selection.v1';
export const SUPPORT_LAUNCH_SCHEMA='stellar-forge.support-console-launch.v1';
export const SUPPORT_LISTENER_SCHEMA='stellar-forge.support-console-listener.v1';
const HEX=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SOURCE_DIRECTORY=dirname(fileURLToPath(import.meta.url));
const fail=(code,message)=>Object.assign(new Error(message),{code,status:409});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function need(value,code,message) {if(!value)throw fail(code,message??code);}
function pathValue(value,label) {
  need(typeof value==='string'&&value.length<=4096&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value)&&isAbsolute(value),
    'SUPPORT_APPLICATION_PATH_REQUIRED','Choose an absolute '+label+'.');
  return resolve(value);
}
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function supportSelectionSha256(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
async function privateDirectory(path,{missing=false}={}) {
  need(await realpath(dirname(path))===dirname(path),'SUPPORT_APPLICATION_REAL_PARENT_REQUIRED',
    'Choose an original directory with a real parent.');
  let stat;
  try {stat=await lstat(path);}
  catch(error) {
    if(error.code!=='ENOENT'||!missing)throw error;
    const parent=await privateDirectory(dirname(path));
    return {path,exists:false,parent:{path:parent.path,dev:parent.dev,ino:parent.ino}};
  }
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||!(stat.mode&0o077))&&
    (process.getuid===undefined||stat.uid===process.getuid()),
    'SUPPORT_APPLICATION_PRIVATE_DIRECTORY_REQUIRED','Use the original private directory owned by this operator.');
  return {path,exists:true,dev:stat.dev,ino:stat.ino};
}

async function sourceIdentity() {
  const files=[];
  // Managed adoption copies this original edition into its release directory.
  // Compare the native boundary's bytes, which survive that relocation.
  for(const name of ['server.mjs','managed-launch.mjs','incident-sources.mjs']) {
    const handle=await open(join(SOURCE_DIRECTORY,name),constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    let bytes;
    try {
      const first=await handle.stat();
      need(first.isFile()&&first.size>0&&first.size<=4*1024*1024,'SUPPORT_APPLICATION_SOURCE_CHANGED');
      bytes=await handle.readFile();const after=await handle.stat();
      need(bytes.length===first.size&&first.size===after.size&&first.mtimeMs===after.mtimeMs&&
        first.ctimeMs===after.ctimeMs,'SUPPORT_APPLICATION_SOURCE_CHANGED');
    } finally {await handle.close();}
    files.push({name,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return {files};
}

/** Selection excludes incident progress and case contents so ordinary work survives reopening. */
export async function inspectSupportSelection({casesDir,incidentSources,allowLoopback=false,allowMissingCases=false,
  incidentSelection=null,sourceDir=null,packageDir=null,accountingConfig=null,buyerExpenseConnection=null,serviceConnectionSelection=null}={}) {
  need(typeof allowLoopback==='boolean'&&typeof allowMissingCases==='boolean',
    'SUPPORT_APPLICATION_SELECTION_INVALID');
  const casesPath=pathValue(casesDir,'private case directory');
  const sourceDirectory=pathValue(sourceDir??join(casesPath,'source-bundles'),'private source delivery directory');
  const packagesDirectory=pathValue(packageDir??join(dirname(casesPath),basename(casesPath)+'-packages'),'private complete-package directory');
  const incidentPath=pathValue(incidentSources,'private incident source configuration');
  const cases=await privateDirectory(casesPath,{missing:allowMissingCases});
  // start() may pass the selection captured by its already-open original desk.
  // That binds this listener to the same parsed profile document and stores.
  const original=incidentSelection??await (await import('./incident-sources.mjs'))
    .inspectIncidentSourcesConfiguration(incidentPath);
  need(plain(original)&&original.schema==='stellar-forge.support-incident-sources.v1'&&
    original.path===incidentPath&&HEX.test(original.sha256)&&Array.isArray(original.sources)&&original.sources.length<=8,
    'SUPPORT_APPLICATION_INCIDENT_SELECTION_CHANGED','Reopen the original incident source configuration.');
  const sources=[];
  for(const source of original.sources) {
    need(plain(source)&&typeof source.id==='string'&&typeof source.label==='string'&&
      plain(source.configuration)&&Number.isSafeInteger(source.configuration.revision)&&source.configuration.revision>=1&&
      HEX.test(source.configuration.sha256),'SUPPORT_APPLICATION_INCIDENT_SELECTION_CHANGED');
    const store=await privateDirectory(pathValue(source.directory,'original incident store'));
    sources.push({id:source.id,label:source.label,store,
      configuration:{revision:source.configuration.revision,sha256:source.configuration.sha256}});
  }
  const connections=serviceConnectionSelection??(accountingConfig!==null||buyerExpenseConnection!==null
    ?(await (await import('./service-connections.mjs')).inspectServiceConnections({accountingConfig,buyerExpenseConnection})).selected:null);
  return {schema:SUPPORT_SELECTION_SCHEMA,source:await sourceIdentity(),cases,sourceDirectory,packagesDirectory,
    ...(connections?.accounting||connections?.buyer?{serviceConnections:connections}:{}),
    incidents:{path:incidentPath,sha256:original.sha256,sources},allowLoopback};
}
function consoleUrl(value,port=0) {
  if(typeof value!=='string'||value.length>2048)return null;
  let url;try {url=new URL(value);}catch{return null;}
  const actual=Number(url.port||80);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.hash||
    url.username||url.password||!Number.isInteger(actual)||actual<1||actual>65535||port&&actual!==port)return null;
  return url.href;
}
export function createSupportLaunch(selection,url) {
  need(plain(selection)&&selection.schema===SUPPORT_SELECTION_SCHEMA&&consoleUrl(url),
    'SUPPORT_APPLICATION_LAUNCH_INVALID');
  return {schema:SUPPORT_LAUNCH_SCHEMA,state:'LISTENING',instanceId:randomUUID(),pid:process.pid,
    url:consoleUrl(url),selectionSha256:supportSelectionSha256(selection),
    casesDirectory:selection.cases.path,incidentSourcesFile:selection.incidents.path};
}
/** This same-origin projection contains no source paths, capture bodies or credentials. */
export function supportListenerIdentity(launch) {
  if(!launch)return null;
  return {schema:SUPPORT_LISTENER_SCHEMA,state:launch.state,instanceId:launch.instanceId,pid:launch.pid,
    url:launch.url,selectionSha256:launch.selectionSha256};
}
async function listenerIdentity(url) {
  return new Promise((accept,reject)=>{
    let settled=false,request,timer;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      if(error)reject(error);else accept(value);
    };
    const failure=()=>fail('SUPPORT_APPLICATION_LISTENER_UNCONFIRMED',
      'The original support listener did not return its matching startup identity.');
    request=httpRequest(new URL('/api/support-launch',url),{
      method:'GET',headers:{accept:'application/json',origin:new URL(url).origin},
    },response=>{
      if(response.statusCode!==200||response.headers['content-type']?.split(';')[0]!=='application/json') {
        response.destroy();finish(failure());return;
      }
      let size=0;const chunks=[];
      response.on('data',bytes=>{
        size+=bytes.length;
        if(size>4096){request.destroy();finish(failure());return;}
        chunks.push(bytes);
      });
      response.once('error',()=>finish(failure()));
      response.once('end',()=>{
        try {finish(null,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size))));}
        catch {finish(failure());}
      });
    });
    request.once('error',()=>finish(failure()));
    timer=setTimeout(()=>{request.destroy();finish(failure());},5000);
    request.end();
  });
}

/** Reconcile the original child's announcement with the actual selected local listener. */
export async function readSupportLaunch(announcement,{casesDir,incidentSources,selectionSha256,port=0}={}) {
  need(Number.isInteger(port)&&port>=0&&port<=65535&&HEX.test(selectionSha256),
    'SUPPORT_APPLICATION_STARTUP_CHANGED');
  const casesDirectory=pathValue(casesDir,'private case directory');
  const incidentSourcesFile=pathValue(incidentSources,'private incident source configuration');
  need(plain(announcement)&&announcement.schema===SUPPORT_LAUNCH_SCHEMA&&announcement.state==='LISTENING'&&
    UUID.test(announcement.instanceId)&&Number.isSafeInteger(announcement.pid)&&announcement.pid>0&&
    announcement.selectionSha256===selectionSha256&&announcement.casesDirectory===casesDirectory&&
    announcement.incidentSourcesFile===incidentSourcesFile,'SUPPORT_APPLICATION_STARTUP_CHANGED',
    'The support announcement must match the reviewed original directories and configuration.');
  const url=consoleUrl(announcement.url,port);
  need(url,'SUPPORT_APPLICATION_PORT_CHANGED','The original support listener used a different local port.');
  const actual=await listenerIdentity(url),expected=supportListenerIdentity({...announcement,url});
  need(plain(actual)&&JSON.stringify(canonical(actual))===JSON.stringify(canonical(expected)),
    'SUPPORT_APPLICATION_LISTENER_CHANGED','The local port belongs to a different support console instance.');
  return {url,original:{schema:SUPPORT_LAUNCH_SCHEMA,instanceId:announcement.instanceId,pid:announcement.pid,
    casesDirectory,incidentSourcesFile,selectionSha256}};
}

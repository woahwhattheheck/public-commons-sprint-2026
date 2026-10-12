// MIT. Run the original Grants.gov publisher through an existing testnet host.
import { readFile, open, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { runPublisherNative } from './publisher-native.mjs';
import { openExistingTestnetHost } from './testnet-host.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const requireValue=(condition,code)=>{if(!condition)fail(code);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(value=>JSON.parse(canonical(value))):
  plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const digest=value=>createHash('sha256').update(value).digest('hex');
async function readJSON(path){return JSON.parse(await readFile(path,'utf8'));}
async function existsJSON(path){try{return await readJSON(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function saveJSON(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),temp=path+'.'+randomUUID()+'.tmp';
  try{
    const file=await open(temp,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    await rename(temp,path);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {bytes:bytes.length,sha256:digest(bytes)};
}
function absolute(path){
  requireValue(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!=='/','HOST_ABSOLUTE_PATH');return path;
}

/**
 * Public settings and existing named environment credentials. This host reads
 * no key store and creates no accounts, policy allocation or scheduler.
 * All source acquisition and customer execution use the original modules.
 */
export async function runHostedPublisher({
  directory,captureFile,settings,host,operationId,phase='receive',environment=process.env,onProgress=()=>{}
}={}){
  directory=absolute(directory);captureFile=absolute(captureFile);
  requireValue(plain(settings)&&plain(host),'HOSTED_PUBLISHER_INPUT');
  requireValue(host.origin===settings.merchant?.origin,'HOSTED_ORIGIN_CHANGED');
  requireValue(typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,110}$/.test(operationId),'HOSTED_OPERATION_ID');
  requireValue(['prepare','publish','receive'].includes(phase),'HOSTED_PHASE');
  absolute(host.facilitatorConfig);absolute(host.tlsKeyFile);absolute(host.tlsCertificateFile);
  const policy=await readJSON(host.facilitatorConfig);
  requireValue(policy.network==='stellar:testnet','HOSTED_TESTNET_REQUIRED');
  const hostInput={settings,host,operationId};
  const requestDigest=digest(canonical(hostInput));
  const hostJournalPath=join(directory,'host-operation.json');
  let journal=await existsJSON(hostJournalPath);
  if(journal)requireValue(journal.schema==='stellar-forge.grantsgov-testnet-host-operation.v1'&&
    journal.operationId===operationId&&journal.requestSha256===requestDigest,'HOSTED_ORIGINAL_REQUEST_CHANGED');
  else journal={schema:'stellar-forge.grantsgov-testnet-host-operation.v1',operationId,
    requestSha256:requestDigest,createdAt:new Date().toISOString(),phase,settings,host,status:'PREPARING'};
  // Only this operation's original bound port is reused. An unavailable port or
  // active original signer owner remains the original native readiness result.
  const nativeJournal=await existsJSON(join(directory,'native-operation.json'));
  let facilitatorPort=host.facilitatorPort??0;
  const retainedUrl=nativeJournal?.settings?.runtime?.facilitator??journal.facilitatorUrl;
  if(retainedUrl){
    const url=new URL(retainedUrl);
    requireValue(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&
      url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash,'HOSTED_RETAINED_FACILITATOR');
    facilitatorPort=Number(url.port);
  }
  if(!retainedUrl){
    // Choose the original local runtime address once, before the source draft.
    // Closing this temporary listener preserves no signer or payment state.
    const listener=createServer();
    await new Promise((accept,reject)=>{listener.once('error',reject);listener.listen(facilitatorPort,'127.0.0.1',accept);});
    facilitatorPort=listener.address().port;
    await new Promise((accept,reject)=>listener.close(error=>error?reject(error):accept()));
    journal.facilitatorUrl='http://127.0.0.1:'+facilitatorPort;
  }else journal.facilitatorUrl=retainedUrl;
  const plannedSettings={...settings,runtime:{...settings.runtime,facilitator:journal.facilitatorUrl,allowLocalFacilitator:true}};
  if(nativeJournal)requireValue(canonical(nativeJournal.settings)===canonical(plannedSettings),
    'HOSTED_ORIGINAL_SETTINGS_CHANGED');
  await saveJSON(hostJournalPath,journal);
  if(phase==='prepare'){
    // Preparing the original source, dataset and draft uses no signer ownership.
    const result=await runPublisherNative({directory,captureFile,settings:plannedSettings,operationId,phase,onProgress});
    journal.status=result.status;journal.updatedAt=new Date().toISOString();
    await saveJSON(hostJournalPath,journal);return {operation:result,host:journal};
  }
  let transport,result,failure;
  try{
    transport=await openExistingTestnetHost({
      facilitatorConfig:policy,publicOrigin:host.origin,tlsKeyFile:host.tlsKeyFile,
      tlsCertificateFile:host.tlsCertificateFile,proxyEnvironment:host.proxyEnvironment,
      environment,facilitatorPort,tlsPort:host.tlsPort??0,proxyPort:host.proxyPort??0
    });
    const actualSettings={...settings,runtime:{...settings.runtime,facilitator:transport.facilitatorUrl,allowLocalFacilitator:true}};
    if(nativeJournal)requireValue(canonical(nativeJournal.settings)===canonical(actualSettings),
      'HOSTED_ORIGINAL_SETTINGS_CHANGED');
    journal.facilitatorUrl=transport.facilitatorUrl;journal.status='HOST_READY';
    journal.publicHost=transport.snapshot();journal.updatedAt=new Date().toISOString();
    await saveJSON(hostJournalPath,journal);await onProgress({operationId,stage:'hostReady',value:journal.publicHost});
    result=await runPublisherNative({directory,captureFile,settings:actualSettings,operationId,phase,
      attachTransport:transport.attachTransport,onProgress});
    journal.status=result.status;
  }catch(error){
    failure=error;journal.status='CONTINUATION_REQUIRED';
    journal.error={code:error.code??error.name??'HOSTED_NATIVE_FAILURE',message:error.message};
  }finally{
    if(transport){
      journal.publicHost=transport.snapshot();
      delete journal.shutdown;delete journal.shutdownError;
      try{journal.shutdown=await transport.close();
        requireValue(journal.shutdown.state==='CLOSED','HOSTED_DRAIN_INCOMPLETE');
      }catch(error){
        journal.shutdown??={state:'DRAIN_FAILED'};
        journal.shutdownError={code:error.code??error.name,message:error.message};
        journal.status='CONTINUATION_REQUIRED';failure??=error;
      }
    }
    journal.updatedAt=new Date().toISOString();await saveJSON(hostJournalPath,journal);
  }
  if(failure)throw failure;
  return {operation:result,host:journal};
}
function options(argv){
  const out={};for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    requireValue(['--directory','--capture','--settings','--host','--operation'].includes(key)&&value&&
      !Object.hasOwn(out,key),'HOSTED_CLI_ARGUMENT');out[key]=value;
  }
  requireValue(Object.keys(out).length===5,'HOSTED_CLI_ARGUMENT');return out;
}
export async function main(argv=process.argv.slice(2)){
  if(argv.length===0||argv.includes('--help')){
    process.stdout.write('Usage: node publisher-host.mjs prepare|publish|receive --directory ABS --capture ABS --settings ABS --host ABS --operation ID\n'+
      'Reuse an existing TESTNET facilitator config, certificate and named credential environment. Settings and host JSON contain no private key values.\n');return;
  }
  const phase=argv.shift(),args=options(argv);
  const result=await runHostedPublisher({phase,directory:args['--directory'],captureFile:args['--capture'],
    settings:await readJSON(absolute(args['--settings'])),host:await readJSON(absolute(args['--host'])),
    operationId:args['--operation'],onProgress:event=>process.stdout.write(JSON.stringify(event)+'\n')});
  process.stdout.write(JSON.stringify({operationId:result.operation.operationId,status:result.operation.status,
    journal:join(args['--directory'],'native-operation.json'),hostJournal:join(args['--directory'],'host-operation.json')})+'\n');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??error.name,message:error.message})+'\n');process.exitCode=1;});
}

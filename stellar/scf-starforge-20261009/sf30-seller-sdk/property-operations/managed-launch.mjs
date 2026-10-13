#!/usr/bin/env node
// MIT. One original Socrata owner, authenticated listener and source-bound Applications announcement.
import {open,readFile,rename,unlink,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {canonical} from './propply.mjs';
import {PROPERTY_STARTUP_SCHEMA,inspectPropertyApplicationBinding,inspectRetainedPropertyConnection,
  propertyApplicationNeed as need,propertyAbsolute,propertyOriginalFile,propertyBindingHash} from './managed-binding.mjs';
const OWN_SOURCE=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function syncDirectory(path){const h=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await h.sync();}finally{await h.close();}}
async function writeOriginal(path,raw) {
  let h;try{h=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code!=='EEXIST')throw error;
    const old=await propertyOriginalFile(path,raw.length,{privateOnly:true,bytes:true});
    need(old.raw.equals(raw),'PROPERTY_APPLICATION_STAGING_CHANGED');return;}
  try{await h.writeFile(raw);await h.sync();}finally{await h.close();}
}
async function announce(file,body,previous,instanceId) {
  const raw=json(body),stage=file+'.'+instanceId+'.pending';
  if(previous)await writeOriginal(file+'.'+previous.sha256+'.previous.json',previous.raw);
  const current=await inspectRetainedPropertyConnection(file,body,{missing:true,verifyOldSource:false});
  need(previous?current&&current.sha256===previous.sha256:current===null,'PROPERTY_APPLICATION_CONNECTION_CHANGED');
  await writeOriginal(stage,raw);
  const check=await inspectRetainedPropertyConnection(file,body,{missing:true,verifyOldSource:false});
  need(previous?check&&check.sha256===previous.sha256:check===null,'PROPERTY_APPLICATION_CONNECTION_CHANGED');
  await rename(stage,file);await syncDirectory(dirname(file));
  return {bytes:raw.length,sha256:propertyBindingHash(raw.toString('utf8')),raw};
}
async function removeOwnAnnouncement(file,original) {
  let current;try{current=await propertyOriginalFile(file,16384,{privateOnly:true,bytes:true});}
  catch(error){if(error.code==='ENOENT')return;throw error;}
  need(current.bytes===original.bytes&&current.sha256===original.sha256&&current.raw.equals(original.raw),
    'PROPERTY_APPLICATION_CONNECTION_CHANGED','Another announcement replaced this owner; preserve it.');
  await unlink(file);await syncDirectory(dirname(file));
}

/** Opening is explicit; original pending vendor requests are never automatically resumed. */
export async function startManagedPropertyApplication({directory,connectionFile,propertyHostFile=null,
  expectedCreatedAt=null,expectedBindingSha256,port=0,applicationRequestId=randomUUID(),sourceRoot=OWN_SOURCE}={}) {
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'PROPERTY_APPLICATION_PORT');
  need(HASH.test(expectedBindingSha256??'')&&UUID.test(applicationRequestId),'PROPERTY_APPLICATION_REVIEW_REQUIRED');
  sourceRoot=await realpath(propertyAbsolute(sourceRoot));
  need(sourceRoot===OWN_SOURCE,'PROPERTY_APPLICATION_EXECUTED_SOURCE_CHANGED','Launch the selected original installed source.');
  const inspected=await inspectPropertyApplicationBinding({directory,sourceRoot,connectionFile,propertyHostFile,expectedCreatedAt});
  const {binding}=inspected;
  need(binding.bindingSha256===expectedBindingSha256,'PROPERTY_APPLICATION_BINDING_CHANGED');
  connectionFile=binding.connectionFile;
  const relation=relative(sourceRoot,connectionFile);
  need(relation==='..'||relation.startsWith('..'+sep)||relation.startsWith(sep),
    'PROPERTY_APPLICATION_CONNECTION_PATH','Keep operational connection files outside installed source.');
  need(connectionFile!==join(binding.directory,'workspace.json'),'PROPERTY_APPLICATION_CONNECTION_PATH');
  const previous=await inspectRetainedPropertyConnection(connectionFile,binding);
  let host={};
  if(binding.host){
    const observed=await propertyOriginalFile(binding.host.path,1024*1024,{privateOnly:true,bytes:true});
    need(observed.bytes===binding.host.bytes&&observed.sha256===binding.host.sha256,'PROPERTY_APPLICATION_HOST_CHANGED');
    host=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(observed.raw));
  }
  const {openSocrataOperator,startSocrataWorkspace}=await import('../socrata/server.mjs');
  let owner=null,listener=null,announcement=null,announcementIdentity=null,closing=null;
  const instanceId=randomUUID();
  async function close() {
    if(!closing)closing=(async()=>{
      const errors=[];
      if(listener)try{await listener.close();}catch(error){errors.push(error);}
      if(owner)try{await owner.close();}catch(error){errors.push(error);}
      if(!errors.length&&announcementIdentity)try{await removeOwnAnnouncement(connectionFile,announcementIdentity);}catch(error){errors.push(error);}
      if(errors.length){const primary=errors[0];primary.propertyCloseErrors=errors.map(e=>({code:e.code??e.name,message:e.message}));throw primary;}
    })();
    return closing;
  }
  try {
    // This unchanged engine owns the sole native SQLite workspace and original publisher lifetimes.
    owner=await openSocrataOperator({directory:binding.directory,propertyHost:host});
    const state=await owner.state();
    need(state.createdAt===binding.createdAt,'PROPERTY_APPLICATION_WORKSPACE_CHANGED');
    listener=await startSocrataWorkspace({directory:binding.directory,operator:owner,port});
    announcement={schema:PROPERTY_STARTUP_SCHEMA,directory:binding.directory,createdAt:binding.createdAt,
      propertyId:state.property?.id??null,instanceId,applicationRequestId,pid:process.pid,
      sourceRoot,source:binding.source,node:binding.node,host:binding.host,
      bindingSha256:binding.bindingSha256,connectionFile,url:listener.url,
      observedAt:new Date().toISOString()};
    announcementIdentity=await announce(connectionFile,announcement,previous,instanceId);
    return Object.freeze({announcement,binding,sourceRoot,close});
  }catch(error){
    try{await close();}catch(cleanup){error.propertyCloseErrors=cleanup.propertyCloseErrors??[{code:cleanup.code??cleanup.name,message:cleanup.message}];}
    throw error;
  }
}
const VALUE_FLAGS=new Set(['directory','connection-file','property-host','expected-created-at','expected-binding-sha256','port','application-request-id']);
export function parsePropertyManagedArguments(argv) {
  need(Array.isArray(argv)&&argv.every(v=>typeof v==='string'),'PROPERTY_APPLICATION_ARGUMENTS');
  const command=argv[0]??'help',options={};
  need(['help','binding','serve'].includes(command),'PROPERTY_APPLICATION_COMMAND');
  for(let i=1;i<argv.length;i++){
    need(argv[i].startsWith('--'),'PROPERTY_APPLICATION_ARGUMENTS');
    const key=argv[i].slice(2);need(VALUE_FLAGS.has(key)&&!Object.hasOwn(options,key)&&typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--'),
      'PROPERTY_APPLICATION_ARGUMENTS');options[key]=argv[++i];
  }
  return {command,options};
}
export async function runPropertyManagedCLI(argv=process.argv.slice(2),streams={}) {
  const stdout=streams.stdout??process.stdout,stderr=streams.stderr??process.stderr;
  let owner,requested=false,resolveStop,primary;const stop=new Promise(resolve=>{resolveStop=resolve;});
  const requestStop=()=>{requested=true;resolveStop();};
  try{
    if(argv.includes('--help')||!argv.length)argv=['help'];
    const {command,options:o}=parsePropertyManagedArguments(argv);
    if(command==='help'){stdout.write('Property Operations managed application\n\n'+
      'property-application binding --directory ORIGINAL --connection-file PRIVATE_FILE\n'+
      'property-application serve --directory ORIGINAL --connection-file PRIVATE_FILE --expected-created-at ISO --expected-binding-sha256 SHA [--port 0]\n\n'+
      'Use the complete maintained package. Binding reads source and workspace identity. Serve opens the original Socrata/Property owner. Stop waits for its requests and publisher to close.\n');return 0;}
    const directory=propertyAbsolute(o.directory),connectionFile=o['connection-file']?propertyAbsolute(o['connection-file']):undefined;
    const selected={directory,connectionFile,propertyHostFile:o['property-host']?propertyAbsolute(o['property-host']):null,
      expectedCreatedAt:o['expected-created-at']??null,sourceRoot:OWN_SOURCE};
    if(command==='binding'){
      const {binding,observed,sourceRoot}=await inspectPropertyApplicationBinding(selected);
      stdout.write(JSON.stringify({binding,observed,sourceRoot})+'\n');return 0;
    }
    need(o['expected-created-at']&&HASH.test(o['expected-binding-sha256']??''),'PROPERTY_APPLICATION_REVIEW_REQUIRED');
    const port=o.port===undefined?0:Number(o.port);
    need(o.port===undefined||/^(0|[1-9][0-9]{0,4})$/.test(o.port),'PROPERTY_APPLICATION_PORT');
    process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);
    owner=await startManagedPropertyApplication({...selected,expectedBindingSha256:o['expected-binding-sha256'],port,
      ...(o['application-request-id']?{applicationRequestId:o['application-request-id']}:{})});
    if(!requested){stdout.write(JSON.stringify(owner.announcement)+'\n');await stop;}
    return 0;
  }catch(error){primary=error;stderr.write(JSON.stringify({error:error.code??error.name,message:error.message,
    ...(error.propertyCloseErrors?{closeErrors:error.propertyCloseErrors}:{})})+'\n');return 1;}
  finally{
    try {
      if(owner)try{await owner.close();}catch(error){
        stderr.write(JSON.stringify({error:error.code??error.name,message:error.message,closeErrors:error.propertyCloseErrors??[]})+'\n');
        if(!primary){process.exitCode=1;return 1;}
      }
    }finally{process.removeListener('SIGINT',requestStop);process.removeListener('SIGTERM',requestStop);}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const result=await runPropertyManagedCLI();if(process.exitCode!==1)process.exitCode=result;
}

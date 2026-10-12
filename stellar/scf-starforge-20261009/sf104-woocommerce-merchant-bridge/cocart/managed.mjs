#!/usr/bin/env node
// MIT. Original CoCart setup and local console, hosted by the existing Applications worker.
import {constants} from 'node:fs';
import {open, lstat, realpath, readdir, mkdir, readFile} from 'node:fs/promises';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {CartWorkspace, CartError, SOURCE, sha256, validateProfile} from './workspace.mjs';
import {serve, loadSDK} from './server.mjs';

export const COCART_MANAGED_SCHEMA = 'stellar-forge.cocart-workspace-startup.v1';
export const COCART_CONNECTION_SCHEMA = 'stellar-forge.cocart-workspace-connection.v1';
export const COCART_SOURCE_FILES = Object.freeze([
  'managed.mjs', 'server.mjs', 'workspace.mjs', 'browser-assets.json', 'index.html', 'app.js', 'app.css', '../buyer.mjs',
  '../../distribution/browser-assets.mjs',
]);
const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_MODULE = new URL('../../../../stellar-forge/mcp-merchant-operator/config.mjs', import.meta.url);
const CONNECTION_MODULE = new URL('../../../../stellar-forge/mcp-merchant-operator/cocart-workspace.mjs', import.meta.url);
const HASH = /^[a-f0-9]{64}$/;
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const need = (ok,code,message,details={},status=400) => { if (!ok) throw new CartError(code,message,details,status); };
const json = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const fingerprint = value => sha256(JSON.stringify(value));
const fullPath = value => {
  need(typeof value === 'string' && isAbsolute(value) && !/[\0\r\n]/.test(value),
    'MANAGED_PATH_INVALID','Select an absolute original host path.');
  return resolve(value);
};
const parse = bytes => {
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new CartError('MANAGED_JSON_INVALID','Select an original UTF-8 JSON file.'); }
};
async function directory(path,{create=false,empty=false,privateOnly=true}={}) {
  path=fullPath(path);
  need(await realpath(dirname(path))===dirname(path),'MANAGED_REAL_PARENT_REQUIRED','Select a real parent directory.');
  if(create) await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path,
    'MANAGED_DIRECTORY_INVALID','Select the original real directory.');
  if(privateOnly) need(!(s.mode&0o077)&&(process.getuid===undefined||s.uid===process.getuid()),
    'MANAGED_DIRECTORY_PRIVATE','Use an operator-owned mode-0700 workspace.');
  if(empty) need((await readdir(path)).length===0,'MANAGED_DIRECTORY_NOT_EMPTY','Select an empty directory for first creation.',{},409);
  return {path,dev:s.dev,ino:s.ino};
}
async function regular(path,{maximum=64*1024*1024,privateOnly=false}={}) {
  path=fullPath(path);
  need(await realpath(dirname(path))===dirname(path),'MANAGED_REAL_PARENT_REQUIRED','Select a real source parent.');
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const before=await h.stat();
    need(before.isFile()&&before.size<=maximum,'MANAGED_FILE_INVALID','Select a complete regular file within its receiving capacity.');
    if(privateOnly) need(!(before.mode&0o077)&&(process.getuid===undefined||before.uid===process.getuid()),
      'MANAGED_FILE_PRIVATE','Use an operator-owned mode-0600 private connection.');
    const bytes=await h.readFile(),after=await h.stat();
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&bytes.length===before.size,
      'MANAGED_FILE_CHANGED','Review the complete current file again.',{},409);
    return {path,bytes,sha256:sha256(bytes),size:bytes.length};
  } finally {await h.close();}
}
async function writePrivateExact(path,bytes) {
  path=fullPath(path);await directory(dirname(path));
  let h;
  try {h=await open(path,'wx',0o600);}
  catch(e) {
    if(e.code!=='EEXIST')throw e;
    const retained=await regular(path,{privateOnly:true});
    need(retained.bytes.equals(bytes),'MANAGED_OUTPUT_EXISTS','Keep the existing connection and choose a new output file.',{path},409);
    return {path,sha256:retained.sha256,bytes:retained.size,reused:true};
  }
  try {await h.writeFile(bytes);await h.sync();} finally {await h.close();}
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  return {path,sha256:sha256(bytes),bytes:bytes.length,reused:false};
}

/** Read native identity without opening a cart, contacting a store or changing a saved revision. */
export async function inspectCocartWorkspace(path,{expectedIdentity,expectedVersion}={}) {
  const selected=await directory(path);
  const workspace=new CartWorkspace({root:selected.path}),{state,version}=workspace.read();
  const body={
    schema:'stellar-forge.cocart-workspace-identity.v1',
    directory:selected.path,device:selected.dev,inode:selected.ino,
    createdAt:state.created_at,merchantOrigin:state.profile.merchant_origin,
    profileSourceSha256:state.profile_source?.sha256??null,source:state.source,
  };
  const identity=fingerprint(body);
  need(expectedIdentity===undefined||expectedIdentity===identity,
    'MANAGED_WORKSPACE_CHANGED','Review the original selected workspace again.',{},409);
  need(expectedVersion===undefined||expectedVersion===version,
    'REVISION_CHANGED','Review the current original workspace before starting.',{current_version:version},409);
  return {...body,identity,version,revision:state.revision,
    carts:state.carts.length,catalogs:state.catalogs.length,events:state.events.length};
}

/** The full installed release manifest remains the enclosing source authority. */
export async function inspectCocartLaunchSource(path=HERE,{expectedSha256}={}) {
  path=fullPath(path);await directory(path,{privateOnly:false});
  const files=[];
  for(const name of COCART_SOURCE_FILES) {
    const source=await regular(resolve(path,name),{maximum:4*1024*1024});
    files.push({name,bytes:source.size,sha256:source.sha256});
  }
  const digest=fingerprint(files);
  need(expectedSha256===undefined||digest===expectedSha256,
    'MANAGED_SOURCE_CHANGED','Use the original reviewed CoCart source.',{},409);
  return {directory:path,sha256:digest,files};
}

export async function inspectCocartSDK(specifier='@cocartheadless/sdk',{expectedSha256}={}) {
  need(typeof specifier==='string'&&specifier.length<=4096&&!/[\0\r\n]/.test(specifier),
    'MANAGED_SDK_INVALID','Select the installed original SDK or its absolute module entry.');
  const url=isAbsolute(specifier)?pathToFileURL(specifier).href:import.meta.resolve(specifier);
  need(url.startsWith('file:')&&!new URL(url).search&&!new URL(url).hash,
    'MANAGED_SDK_INVALID','Use the original local SDK entry.');
  const entry=await realpath(fileURLToPath(url)),file=await regular(entry,{maximum:8*1024*1024});
  const sdk=await loadSDK(entry);
  need(expectedSha256===undefined||expectedSha256===file.sha256,
    'MANAGED_SDK_CHANGED','Review the original SDK entry again.',{},409);
  return {entry,sha256:file.sha256,bytes:file.size,version:sdk.CoCart.VERSION,source:SOURCE.sdk};
}

export async function readCocartManagedConnection(path,{alias,directory:workspaceDirectory,expectedSha256,sdkEntry}={}) {
  if(path===undefined||path===null||path==='') {
    need(alias===undefined||alias===null||alias==='','MANAGED_CONNECTION_REQUIRED','Choose the original connection before selecting an alias.');
    return null;
  }
  const file=await regular(path,{maximum:1024*1024,privateOnly:true});
  need(expectedSha256===undefined||expectedSha256===file.sha256,
    'MANAGED_CONNECTION_CHANGED','Review the current private connection.',{},409);
  const {readCocartWorkspaceConfiguration}=await import(CONNECTION_MODULE.href);
  const connection=await readCocartWorkspaceConfiguration(file.path),names=Object.keys(connection.workspaces);
  const selected=alias||(names.length===1?names[0]:null);
  need(selected&&own(connection.workspaces,selected),'MANAGED_CONNECTION_ALIAS_REQUIRED','Select an original configured workspace alias.');
  const row=connection.workspaces[selected];
  need(row.directory===fullPath(workspaceDirectory),'MANAGED_CONNECTION_WORKSPACE_CHANGED','This alias must select the same original workspace.',{},409);
  if(sdkEntry) {
    const sdk=await inspectCocartSDK(row.sdkModule??'@cocartheadless/sdk');
    need(sdk.entry===sdkEntry,'MANAGED_CONNECTION_SDK_CHANGED','Applications and the merchant agent must use the same selected SDK.',{},409);
  }
  return {file:file.path,sha256:file.sha256,bytes:file.size,alias:selected};
}

/** A receiving/setup operation; live native cart requests remain explicit workspace actions. */
export async function setupCocartWorkspace({
  directory:root,profileFile,receivingFile,receivingTransportFile,sdkModule,
  connectionFile,alias='customer',label='CoCart customer workspace',
  handoffs={},receivingInputs={},merchantDirectory,merchantName='Starforge CoCart merchant',
}={}) {
  root=fullPath(root);
  need(!(profileFile&&receivingFile),'MANAGED_SOURCE_SELECTION','Select either an original profile or a complete receiving export.');
  need(!receivingTransportFile||profileFile,'MANAGED_TRANSPORT_CREATE_ONLY','Choose a receiving transport only with initial native profile creation.');
  need(typeof label==='string'&&label.trim()&&label.length<=160,'LABEL_INVALID','Enter a workspace label.');
  need(plain(handoffs)&&plain(receivingInputs),'MANAGED_INPUTS_INVALID','Declare named original handoff and receiving files.');
  let originalProfile=null,profileBytes=null,receivingBytes=null,receivingTransport=null;
  if(profileFile) {profileFile=fullPath(profileFile);profileBytes=(await regular(profileFile)).bytes;originalProfile=validateProfile(parse(profileBytes));}
  if(receivingFile) {receivingFile=fullPath(receivingFile);receivingBytes=(await regular(receivingFile)).bytes;}
  if(receivingTransportFile) receivingTransport=parse((await regular(receivingTransportFile)).bytes);
  let exists=true;try{await directory(root);}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}
  let workspace,operation='reopened';
  if(receivingBytes) {
    if(!exists)await directory(root,{create:true});
    workspace=CartWorkspace.receive({root,bytes:receivingBytes});operation='received';
  } else if(originalProfile) {
    let saved=false;
    if(exists) saved=(await readdir(root)).includes('workspace.json');
    if(saved) {
      workspace=new CartWorkspace({root});const current=workspace.view();
      need(current.profile_source?.sha256===sha256(profileBytes),
        'MANAGED_PROFILE_CHANGED','Reopen the existing original profile or choose a new workspace.',{},409);
      need(!receivingTransport,'MANAGED_TRANSPORT_REOPEN','Use the original explicit transport.rebind action for an existing workspace.');
    } else {
      await directory(root,{create:!exists,empty:true});
      workspace=new CartWorkspace({root,create:true,profile:parse(profileBytes),profileBytes,receivingTransport});
      operation='created';
    }
  } else {
    need(exists,'WORKSPACE_MISSING','Create from a profile or receive the original export first.',{},404);
    workspace=new CartWorkspace({root});
  }
  const native=await inspectCocartWorkspace(root);
  let connection=null,merchant=null;
  if(connectionFile) {
    connectionFile=fullPath(connectionFile);
    const row={label:label.trim(),directory:root};
    if(sdkModule) row.sdkModule=sdkModule==='@cocartheadless/sdk'?sdkModule:fullPath(sdkModule);
    if(profileFile) row.profile=profileFile;
    for(const [kind,entries] of Object.entries({handoffs,receivingInputs})) {
      if(Object.keys(entries).length) {
        row[kind]={};
        for(const [name,value] of Object.entries(entries)) {
          const file=await regular(fullPath(value));row[kind][name]=file.path;
        }
      }
    }
    if(receivingFile&&!own(row.receivingInputs??{},'original')) row.receivingInputs={original:receivingFile,...row.receivingInputs};
    if(receivingTransport) row.receivingTransport=receivingTransport;
    const body={schema:COCART_CONNECTION_SCHEMA,workspaces:{[alias]:row}};
    const {readCocartWorkspaceConfiguration}=await import(CONNECTION_MODULE.href);
    connection=await writePrivateExact(connectionFile,json(body));
    await readCocartWorkspaceConfiguration(connectionFile);
    connection={...connection,alias};
    if(merchantDirectory) {
      const target=fullPath(merchantDirectory),configuration=join(target,'merchant-mcp.json');
      const core=await import(CONFIG_MODULE.href);
      let present=false;try{await lstat(configuration);present=true;}catch(e){if(e.code!=='ENOENT')throw e;}
      if(present) {
        const raw=parse((await regular(configuration,{maximum:4*1024*1024,privateOnly:true})).bytes);
        need(typeof raw.cocartWorkspaceConnection==='string'&&resolve(target,raw.cocartWorkspaceConnection)===connectionFile,
          'MANAGED_MERCHANT_CONNECTION_CHANGED','Keep the existing merchant configuration and select its original connection.',{},409);
        await core.readMerchantConfig(configuration);
        merchant={configuration,state:'EXISTING',ownership:'ORIGINAL_COCART_WORKSPACE'};
      } else {
        merchant=await core.initializeCocartWorkspaceMerchant({directory:target,connection:connectionFile,name:merchantName});
      }
    }
  } else need(!merchantDirectory,'MANAGED_CONNECTION_REQUIRED','Choose the private connection file before creating its merchant host.');
  return {schema:'stellar-forge.cocart-managed-setup.v1',operation,workspace:native,connection,merchant};
}

export async function startManagedCocart({
  directory:root,port=0,workspaceIdentity,workspaceVersion,
  sourceDirectory=HERE,sourceSha256,sdkModule='@cocartheadless/sdk',sdkSha256,
  connectionFile,connectionAlias,connectionSha256,
}={}) {
  need(Number.isInteger(port)&&port>=0&&port<=65535,'PORT_INVALID','Use a local port from 0 through 65535.');
  const selected=await inspectCocartLaunchSource(sourceDirectory,{expectedSha256:sourceSha256});
  const launched=await inspectCocartLaunchSource(HERE,{expectedSha256:selected.sha256});
  const sdk=await inspectCocartSDK(sdkModule,{expectedSha256:sdkSha256});
  const connection=await readCocartManagedConnection(connectionFile,{
    alias:connectionAlias,directory:root,expectedSha256:connectionSha256,sdkEntry:sdk.entry,
  });
  const original=await inspectCocartWorkspace(root,{expectedIdentity:workspaceIdentity,expectedVersion:workspaceVersion});
  const workspace=new CartWorkspace({root:original.directory,...await loadSDK(sdk.entry)});
  const identity={
    schema:COCART_MANAGED_SCHEMA,status:'COCART_WORKSPACE_READY',
    directory:original.directory,workspaceIdentity:original.identity,workspaceVersion:original.version,
    workspaceRevision:original.revision,sourceDirectory:selected.directory,
    launchSourceDirectory:launched.directory,sourceSha256:selected.sha256,sourceFiles:selected.files,
    sdk,connection,instanceId:randomUUID(),pid:process.pid,
  };
  const running=await serve({workspace,port,identity});
  const startup={...identity,cocartWorkspace:running.url};
  return {...running,workspace,startup};
}

function argumentsOf(argv) {
  const out={command:argv.shift()??'help',handoffs:{},receivingInputs:{}};
  const booleans=new Set(['startup-json']);
  const keys=new Set(['directory','profile','input','receiving-transport','sdk','sdk-sha256',
    'connection','alias','label','merchant-directory','merchant-name','port',
    'workspace-identity','workspace-version','source-directory','source-sha256','connection-sha256']);
  while(argv.length) {
    const name=argv.shift();
    need(name.startsWith('--'),'ARGUMENT_INVALID','Use named --option value arguments.');
    const key=name.slice(2);
    if(booleans.has(key)) {need(!own(out,key),'ARGUMENT_REPEATED','Use each switch once.');out[key]=true;continue;}
    const value=argv.shift();
    need(typeof value==='string'&&!value.startsWith('--'),'ARGUMENT_VALUE_REQUIRED','Supply the value for '+name+'.');
    if(key==='handoff'||key==='receiving-input') {
      const split=value.indexOf('=');
      need(split>0&&split<value.length-1,'ARGUMENT_ALIAS_REQUIRED','Use '+name+' name=/absolute/file.');
      const group=key==='handoff'?out.handoffs:out.receivingInputs,alias=value.slice(0,split);
      need(!own(group,alias),'ARGUMENT_REPEATED','Use each original input alias once.');
      group[alias]=resolve(value.slice(split+1));continue;
    }
    need(keys.has(key)&&!own(out,key),'ARGUMENT_INVALID','Use one supported value for '+name+'.');out[key]=value;
  }
  return out;
}
const pathOption=(a,name)=>a[name]===undefined?undefined:resolve(a[name]);
export async function main(argv=process.argv.slice(2)) {
  const a=argumentsOf([...argv]);
  if(a.command==='help') {
    console.log('CoCart managed workspace\n\nsetup --directory DIR [--profile FILE | --input RECEIVING.json] [--receiving-transport FILE]\n  [--sdk MODULE] [--connection PRIVATE.json --alias customer --label LABEL]\n  [--handoff name=FILE] [--receiving-input name=FILE] [--merchant-directory DIR]\ninspect --directory DIR [--sdk MODULE]\nserve --directory DIR [--sdk MODULE] [--port 0] [--connection PRIVATE.json --alias customer]\n\nApplications supplies reviewed source, workspace, SDK and connection fingerprints.\nsetup retains original cart/order/source bytes; serve reopens the same native workspace.\nUse original cocart export or merchant download-cocart to deliver the complete receiving closure.');
    return;
  }
  need(['setup','inspect','serve'].includes(a.command),'COMMAND_UNKNOWN','Use setup, inspect or serve.');
  const root=pathOption(a,'directory');need(root,'ROOT_REQUIRED','Select the original private directory.');
  if(a.command==='setup') {
    const result=await setupCocartWorkspace({
      directory:root,profileFile:pathOption(a,'profile'),receivingFile:pathOption(a,'input'),
      receivingTransportFile:pathOption(a,'receiving-transport'),sdkModule:a.sdk,
      connectionFile:pathOption(a,'connection'),alias:a.alias,label:a.label,
      handoffs:a.handoffs,receivingInputs:a.receivingInputs,
      merchantDirectory:pathOption(a,'merchant-directory'),merchantName:a['merchant-name'],
    });
    console.log(JSON.stringify(result,null,2));return result;
  }
  if(a.command==='inspect') {
    const result={workspace:await inspectCocartWorkspace(root),source:await inspectCocartLaunchSource(),
      ...(a.sdk?{sdk:await inspectCocartSDK(a.sdk)}:{})};
    console.log(JSON.stringify(result,null,2));return result;
  }
  const running=await startManagedCocart({
    directory:root,port:a.port===undefined?0:Number(a.port),
    workspaceIdentity:a['workspace-identity'],workspaceVersion:a['workspace-version'],
    sourceDirectory:pathOption(a,'source-directory'),sourceSha256:a['source-sha256'],
    sdkModule:a.sdk,sdkSha256:a['sdk-sha256'],connectionFile:pathOption(a,'connection'),
    connectionAlias:a.alias,connectionSha256:a['connection-sha256'],
  });
  console.log(JSON.stringify(running.startup));
  let stopped=false;
  const stop=async()=>{if(stopped)return;stopped=true;try{await running.close();}catch(e){console.error(JSON.stringify(e.toJSON?.()??{error:e.name,message:e.message}));process.exitCode=1;}};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  return running;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error(JSON.stringify(e.toJSON?.()??{error:e.name,message:e.message}));process.exitCode=1;});

// MIT. Named Fiscal operator through the original managed runtime and MCP model.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { absolute, privateDirectory, readPrivate, readJson, identity, digest, fault, object } from '../postgres/publisher/files.mjs';
import { MerchantFiscalDataWorkspaces, readFiscalDataWorkspaceConfiguration } from '../../../../stellar-forge/mcp-merchant-operator/fiscaldata-workspace.mjs';

export const FISCAL_MANAGED_STARTUP='stellar-forge.fiscaldata-application-startup.v1';
const WORKSPACE='stellar-forge.fiscaldata-workspace.v1';
const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const PREFIX='stellar/scf-starforge-20261009/';
const FISCAL=PREFIX+'sf30-seller-sdk/fiscaldata/';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const FISCAL_MANAGED_SOURCE_FILES=Object.freeze([
 ...['managed.mjs','cli.mjs','workspace-model.mjs','capture.mjs','decimal.mjs','publishing.mjs','portable.mjs',
 'briefing.mjs','briefing-render.mjs','refresh.mjs','workspace-ui/refresh.js','workspace-server.mjs','workspace-ui/index.html','workspace-ui/app.js','workspace-ui/style.css'].map(name=>FISCAL+name),
 'stellar-forge/mcp-merchant-operator/fiscaldata-workspace.mjs',
 'stellar-forge/mcp-merchant-operator/catalog/fiscaldata-workspace.mjs',
 'stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs',
 'stellar-forge/mcp-merchant-operator/host-files.mjs',
 'stellar-forge/mcp-merchant-operator/retained-file-reads.mjs',
 'stellar-forge/mcp-paid-agent/http-tools.mjs',
 PREFIX+'sf33-failure-contract/contract.mjs',
 PREFIX+'sf30-seller-sdk/postgres/publisher/files.mjs',
]);
const changed=()=>fault('FISCAL_MANAGED_SELECTION_CHANGED',
 'Review the current original workspace, private connection and selected runtime before starting.',409);
const inode=info=>({dev:String(info.dev),ino:String(info.ino)});
const sameInode=(left,right)=>left.dev===right.dev&&left.ino===right.ino;
function expectedHash(value){if(value!==undefined&&!HASH.test(value))throw fault('FISCAL_MANAGED_HASH_REQUIRED');}
function alias(value){if(typeof value!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))throw fault('FISCAL_MANAGED_ALIAS_REQUIRED');return value;}
function inside(parent,path){const rel=relative(parent,path);return rel===''||rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('/');}

/** Immutable identity fields are pinned; routine revision and source changes remain writable. */
export async function inspectFiscalManagedWorkspace(directory,{expectedIdentity}={}){
 absolute(directory);expectedHash(expectedIdentity);await privateDirectory(directory);
 const before=await lstat(directory,{bigint:true});
 const header=await readJson(join(directory,'workspace.json'),1024**2);
 const after=await lstat(directory,{bigint:true});
 if(!sameInode(inode(before),inode(after))||header.schema!==WORKSPACE||!UUID.test(header.id??'')||
  typeof header.createdAt!=='string'||!Number.isFinite(Date.parse(header.createdAt))||
  !Number.isSafeInteger(header.revision)||header.revision<1)throw changed();
 const binding={id:header.id,createdAt:header.createdAt,directoryIdentity:inode(after)};
 const value={schema:'stellar-forge.fiscaldata-application-workspace.v1',directory,...binding};
 const sha256=identity(value);if(expectedIdentity!==undefined&&sha256!==expectedIdentity)throw changed();
 return {...value,sha256,binding};
}
async function sourceFile(path){
 if(await realpath(path)!==path)throw fault('FISCAL_MANAGED_SOURCE_INVALID','Use the exact retained runtime without symbolic source paths.');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat();if(!before.isFile()||before.size>4*1024**2)throw fault('FISCAL_MANAGED_SOURCE_INVALID');
  const data=await file.readFile(),after=await file.stat();
  if(data.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw changed();
  return {bytes:data.length,sha256:digest(data)};
 }finally{await file.close();}
}
export async function inspectFiscalManagedSource(sourceRoot,{expectedSha256}={}){
 absolute(sourceRoot);expectedHash(expectedSha256);
 if(await realpath(sourceRoot)!==sourceRoot||!(await lstat(sourceRoot)).isDirectory())throw fault('FISCAL_MANAGED_SOURCE_INVALID');
 const files=[];for(const path of FISCAL_MANAGED_SOURCE_FILES)files.push({path,...await sourceFile(join(sourceRoot,path))});
 const value={schema:'stellar-forge.fiscaldata-application-source.v1',files},sha256=identity(value);
 if(expectedSha256!==undefined&&sha256!==expectedSha256)throw changed();
 return {...value,sourceRoot,sha256};
}
/** Reads host declarations without opening a model, seller or buyer. */
export async function inspectFiscalManagedSelection({connectionFile,workspaceAlias,exportsDirectory,
 expectedConnectionSha256,expectedWorkspaceIdentity}={}){
 absolute(connectionFile);absolute(exportsDirectory);alias(workspaceAlias);
 expectedHash(expectedConnectionSha256);expectedHash(expectedWorkspaceIdentity);
 const before=await readPrivate(connectionFile,1024**2),connectionSha256=digest(before);
 if(expectedConnectionSha256!==undefined&&connectionSha256!==expectedConnectionSha256)throw changed();
 const config=await readFiscalDataWorkspaceConfiguration(connectionFile);
 if(!(await readPrivate(connectionFile,1024**2)).equals(before))throw changed();
 const entry=config.workspaces[workspaceAlias];if(!entry)throw fault('FISCAL_MANAGED_ALIAS_MISSING','Choose an original declared Fiscal workspace alias.');
 await privateDirectory(exportsDirectory);
 if(Object.values(config.workspaces).some(item=>inside(item.directory,exportsDirectory)))
  throw fault('FISCAL_MANAGED_EXPORT_DIRECTORY','Choose the existing private exports directory outside the declared source workspaces.');
 const workspace=await inspectFiscalManagedWorkspace(entry.directory,{expectedIdentity:expectedWorkspaceIdentity});
 return {schema:'stellar-forge.fiscaldata-application-selection.v1',connectionFile,connectionSha256,
  workspaceAlias,exportsDirectory,workspace,operator:config.operator,config};
}
function readyBinding(selection,source,executed,opened){
 return {schema:FISCAL_MANAGED_STARTUP,status:'FISCALDATA_APPLICATION_READY',
  instanceId:randomUUID(),modelInstanceId:opened.instanceId,pid:process.pid,
  workspaceAlias:selection.workspaceAlias,workspaceId:selection.workspace.id,
  directory:selection.workspace.directory,workspaceIdentity:selection.workspace.sha256,
  operator:selection.operator,connectionFile:selection.connectionFile,connectionSha256:selection.connectionSha256,
  exportsDirectory:selection.exportsDirectory,sourceRoot:source.sourceRoot,
  launchSourceRoot:executed.sourceRoot,sourceSha256:source.sha256,sourceFiles:source.files};
}
/** Shares the original MCP model/browser/history and drains that same adapter on Stop. */
export async function startFiscalManagedApplication({connectionFile,workspaceAlias,exportsDirectory,
 sourceRoot,expectedConnectionSha256,expectedWorkspaceIdentity,expectedSourceSha256,port=0,signal}={}){
 if(!HASH.test(expectedConnectionSha256??'')||!HASH.test(expectedWorkspaceIdentity??'')||!HASH.test(expectedSourceSha256??''))
  throw fault('FISCAL_MANAGED_REVIEW_REQUIRED','Use the complete saved Applications launch review.');
 if(!Number.isSafeInteger(port)||port<0||port>65535)throw fault('FISCAL_MANAGED_PORT_REQUIRED');
 let adapter,stopping=false,closing,resolveClosed;
 const closed=new Promise(done=>{resolveClosed=done;});
 const check=()=>{if(stopping||signal?.aborted)throw fault('FISCAL_MANAGED_START_CANCELLED','The original application was stopped before readiness.',409);};
 const close=()=>{stopping=true;return closing??=(async()=>{try{await adapter?.close();}finally{resolveClosed();signal?.removeEventListener('abort',onAbort);}})();};
 const onAbort=()=>{void close().catch(()=>{});};
 signal?.addEventListener('abort',onAbort,{once:true});
 try{
  check();
  const selection=await inspectFiscalManagedSelection({connectionFile,workspaceAlias,exportsDirectory,
   expectedConnectionSha256,expectedWorkspaceIdentity});check();
  const source=await inspectFiscalManagedSource(sourceRoot,{expectedSha256:expectedSourceSha256});check();
  const executed=await inspectFiscalManagedSource(SOURCE_ROOT,{expectedSha256:expectedSourceSha256});check();
  const entry={...selection.config.workspaces[workspaceAlias],expectedWorkspace:selection.workspace.binding};
  adapter=new MerchantFiscalDataWorkspaces({
   fiscalDataWorkspaces:{operator:selection.operator,workspaces:{[workspaceAlias]:entry}},exportsDirectory});
  const opened=await adapter.call('merchant_fiscaldata_open',{workspace:workspaceAlias});check();
  if(opened.workspaceId!==selection.workspace.id)throw changed();
  const nativeIdentity=Object.freeze(readyBinding(selection,source,executed,opened));
  entry.managedIdentity=nativeIdentity;
  const browser=await adapter.call('merchant_fiscaldata_browser',{workspace:workspaceAlias,action:'open',port});check();
  await inspectFiscalManagedSelection({connectionFile,workspaceAlias,exportsDirectory,
   expectedConnectionSha256,expectedWorkspaceIdentity});check();
  await inspectFiscalManagedSource(SOURCE_ROOT,{expectedSha256:expectedSourceSha256});check();
  return {url:browser.url,identity:{...nativeIdentity,url:browser.url},closed,close};
 }catch(error){await close().catch(()=>{});throw error;}
}


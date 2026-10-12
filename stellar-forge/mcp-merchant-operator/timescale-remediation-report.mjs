// MIT. Original renderer, original workspace writer, complete retained report bytes.
import { mkdir, mkdtemp, readdir, lstat, rename, rm, rmdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { privateDirectory, readPrivate, createFile, syncDirectory, hashPrivate, bytes, digest, fault, stamp }
  from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import { only, uuid, hash } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/contracts.mjs';
import { REMEDIATION_MANIFEST, REMEDIATION_SCHEMA, REMEDIATION_MANIFEST_BYTES, REMEDIATION_REPORT_BYTES,
  parseRemediationManifest } from './timescale-remediation-contract.mjs';
function location(workspace,id) { return join(workspace.directory,'remediation-reports',uuid(id)); }
async function exists(path) {try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function selected(input) {
  only(input,['requestId','expectedVersion','workItemId','itemRevision','itemDigest']);
  uuid(input.requestId);uuid(input.workItemId);hash(input.itemDigest);
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||
      !Number.isSafeInteger(input.itemRevision)||input.itemRevision<1)
    throw fault('TIMESCALE_REPORT_REVISION_REQUIRED','Use the current workspace version and exact selected work-item revision.');
}
function matches(value,input,workspace) {
  if(value.workspaceId!==workspace.settings.id||value.exportId!==input.requestId||
      value.workItemId!==input.workItemId||value.itemRevision!==input.itemRevision||value.itemDigest!==input.itemDigest)
    throw fault('TIMESCALE_REPORT_BINDING_CHANGED','Retain the original report request and item identity.');
}
function receipt(saved) {
  const value=saved.manifest;
  return {reportId:value.exportId,workspaceId:value.workspaceId,workItemId:value.workItemId,
    itemRevision:value.itemRevision,itemDigest:value.itemDigest,manifestSha256:saved.manifestSha256,
    files:value.files.length,bytes:value.files.reduce((sum,file)=>sum+file.bytes,0)};
}
/** Full file verification; this read never invokes the renderer or the database source. */
export async function inspectTimescaleRemediationReport(workspace,id,expectedManifestSha256) {
  uuid(id);if(expectedManifestSha256!==undefined)hash(expectedManifestSha256);
  const directory=location(workspace,id);
  await privateDirectory(dirname(directory));await privateDirectory(directory);
  const manifestBytes=await readPrivate(join(directory,REMEDIATION_MANIFEST),REMEDIATION_MANIFEST_BYTES);
  const manifestSha256=digest(manifestBytes),manifest=parseRemediationManifest(manifestBytes,id);
  if(manifest.workspaceId!==workspace.settings.id||expectedManifestSha256!==undefined&&expectedManifestSha256!==manifestSha256)
    throw fault('TIMESCALE_REPORT_BINDING_CHANGED','Use this original workspace and complete manifest digest.');
  const actual=(await readdir(directory)).sort(),expected=[REMEDIATION_MANIFEST,...manifest.files.map(file=>file.name)].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw fault('TIMESCALE_REPORT_FILES_CHANGED');
  for(const file of manifest.files) {
    const retained=await hashPrivate(join(directory,file.name),REMEDIATION_REPORT_BYTES);
    if(retained.hash!==file.sha256||retained.bytes!==file.bytes)throw fault('TIMESCALE_REPORT_FILES_CHANGED');
  }
  return {directory,manifest,manifestBytes,manifestSha256};
}
/** Synchronous input snapshot before the existing original exclusive writer. */
export function exportTimescaleRemediationReport(workspace,input) {
  input=structuredClone(input);selected(input);
  if(typeof workspace.remediation?.report!=='function')throw fault('TIMESCALE_REMEDIATION_UNAVAILABLE');
  const output=location(workspace,input.requestId),root=dirname(output);
  return workspace.exclusive('remediation-report',input,async({signal})=>{
    signal.throwIfAborted();
    await privateDirectory(root,true);
    // Only this original request's abandoned stages are eligible for collection.
    const prefix='.pending-remediation-'+input.requestId+'-';
    for(const name of await readdir(root))if(name.startsWith(prefix)&&
        /^[A-Za-z0-9]{6}$/.test(name.slice(prefix.length))) {
      const path=join(root,name);await privateDirectory(path);await rm(path,{recursive:true});
    }
    if(await exists(output)) {
      await privateDirectory(output);
      if((await readdir(output)).length===0) {
        // The original atomic-publication reservation may survive a process exit.
        await rmdir(output);await syncDirectory(root);
      } else {
        const saved=await inspectTimescaleRemediationReport(workspace,input.requestId);
        matches(saved.manifest,input,workspace);return {...receipt(saved),reused:true};
      }
    }
    const original=await workspace.remediation.report(input.workItemId);
    if(original.workspaceId!==workspace.settings.id||original.workItemId!==input.workItemId||
        original.itemRevision!==input.itemRevision||original.itemDigest!==input.itemDigest||
        original.json?.workspaceId!==workspace.settings.id||original.json?.item?.id!==input.workItemId)
      throw fault('TIMESCALE_REPORT_ITEM_CHANGED','Inspect the current original item before requesting a new report.');
    const documents=[{name:'report.json',content:bytes(original.json)},{name:'report.html',content:Buffer.from(original.html,'utf8')}];
    if(documents.some(file=>file.content.length<1||file.content.length>REMEDIATION_REPORT_BYTES))
      throw fault('TIMESCALE_REPORT_TOO_LARGE','The complete original report exceeds 256 MiB per file; use the full workspace package.');
    const manifest={schema:REMEDIATION_SCHEMA,exportId:input.requestId,workspaceId:workspace.settings.id,
      workItemId:input.workItemId,itemRevision:input.itemRevision,itemDigest:input.itemDigest,
      workspaceVersion:original.json.version,createdAt:stamp(),complete:true,
      files:documents.map(file=>({name:file.name,bytes:file.content.length,sha256:digest(file.content)}))};
    const manifestBytes=bytes(manifest);parseRemediationManifest(manifestBytes,input.requestId);
    const stage=await mkdtemp(join(root,prefix));let retained=false,reserved=false;
    try {
      for(const file of documents){signal.throwIfAborted();await createFile(join(stage,file.name),file.content);}
      await createFile(join(stage,REMEDIATION_MANIFEST),manifestBytes);await syncDirectory(stage);
      signal.throwIfAborted();await mkdir(output,{mode:0o700});reserved=true;
      await rename(stage,output);retained=true;await syncDirectory(root);
      return {...receipt({manifest,manifestSha256:digest(manifestBytes)}),reused:false};
    } finally {
      if(!retained) {
        await rm(stage,{recursive:true,force:true});
        if(reserved)await rmdir(output).catch(error=>{if(error.code!=='ENOENT'&&error.code!=='ENOTEMPTY')throw error;});
      }
    }
  });
}

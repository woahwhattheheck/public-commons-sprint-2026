// MIT. Exact original SQL Server packages through the maintained retained-file reader.
import { open, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { RetainedFileReads } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { verifyPreparedMssqlSeller } from '../prepare.mjs';
import { UUID, SHA, RELEASE_ID, exact, checked, need, digest, encoded, readBytes, readJSON,
  publish, exists, privateDirectory, syncDirectory, absolute, plain } from './operator-store.mjs';

export const MSSQL_TRANSFER_MANIFEST = 'Mssql_Transfer_Manifest.json';
export const MSSQL_TRANSFER_SCHEMA = 'stellar-forge.mssql-workspace-transfer.v1';
export const MSSQL_TRANSFER_FILE_BYTES = 16 * 1024 * 1024;
export const MSSQL_TRANSFER_MANIFEST_BYTES = 262144;
const publicNames = new Set(['openapi.json','client/seller-client.mjs','client/seller-client.d.mts',
  'client/seller-openapi.json','client/package.json','client/README.md']);
const privateNames = new Set(['workspace.json','package/manifest.json','package/source.json','package/service.json',
  'package/merchant-plan.json','package/openapi.json','package/database-ca.pem',
  ...[...publicNames].filter(name => name.startsWith('client/')).map(name => 'package/' + name)]);
export function parseMssqlTransferManifest(bytes, exportId) {
  need(bytes.length > 0 && bytes.length <= MSSQL_TRANSFER_MANIFEST_BYTES, 'MSSQL_TRANSFER_MANIFEST_INVALID');
  let value;
  try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { need(false,'MSSQL_TRANSFER_MANIFEST_INVALID'); }
  need(plain(value) && value.schema === MSSQL_TRANSFER_SCHEMA && value.exportId === checked(exportId, UUID, 'export UUID') &&
    UUID.test(value.workspaceId ?? '') && RELEASE_ID.test(value.releaseId ?? '') &&
    SHA.test(value.packageManifestSha256 ?? '') && SHA.test(value.planId ?? '') &&
    Number.isFinite(Date.parse(value.createdAt)) && ['merchant','customer'].includes(value.kind) &&
    Array.isArray(value.files) && value.files.length >= 6 && value.files.length <= 12,
    'MSSQL_TRANSFER_MANIFEST_INVALID');
  const names=new Set(), allowed=value.kind==='merchant'?privateNames:publicNames;
  for (const file of value.files) {
    need(plain(file) && allowed.has(file.name) && !names.has(file.name) && SHA.test(file.sha256 ?? '') &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MSSQL_TRANSFER_FILE_BYTES,
      'MSSQL_TRANSFER_MANIFEST_INVALID');
    names.add(file.name);
  }
  const required=value.kind==='merchant'?[...privateNames].filter(name=>name!=='package/database-ca.pem'):[...publicNames];
  need(required.every(name=>names.has(name)) && names.size===value.files.length,
    'MSSQL_TRANSFER_MANIFEST_INCOMPLETE');
  if(value.kind==='merchant') need(value.files.find(file=>file.name==='package/manifest.json').sha256===value.packageManifestSha256,
    'MSSQL_TRANSFER_NATIVE_MANIFEST_CHANGED');
  return value;
}
export function createMssqlTransfers({model,identity}) {
  const root=join(identity.directory,'exports'), stageRoot=join(identity.directory,'staging');
  const reads=new RetainedFileReads({errorPrefix:'MSSQL'});
  const scope=identity.workspaceId;
  async function nativeManifest(exportId) {
    checked(exportId,UUID,'export UUID');
    const directory=await privateDirectory(join(root,exportId));
    const bytes=await readBytes(join(directory,MSSQL_TRANSFER_MANIFEST),MSSQL_TRANSFER_MANIFEST_BYTES);
    const value=parseMssqlTransferManifest(bytes,exportId);
    need(value.workspaceId===scope,'MSSQL_TRANSFER_WORKSPACE_CHANGED',undefined,409);
    return {directory,bytes,value,sha256:digest(bytes)};
  }
  function manifestView(value) {
    return {state:'MANIFEST_RETAINED',workspaceId:scope,exportId:value.value.exportId,
      kind:value.value.kind,releaseId:value.value.releaseId,manifestSha256:value.sha256,
      packageManifestSha256:value.value.packageManifestSha256,
      manifestFile:{name:MSSQL_TRANSFER_MANIFEST,bytes:value.bytes.length,sha256:value.sha256},
      files:value.value.files.length,bytes:value.value.files.reduce((sum,file)=>sum+file.bytes,0)};
  }
  async function exportSource(input, request) {
    exact(input,['releaseId','manifestSha256','kind'],['releaseId','manifestSha256','kind']);
    checked(input.releaseId,RELEASE_ID,'release ID'); checked(input.manifestSha256,SHA,'prepared package digest');
    need(['merchant','customer'].includes(input.kind),'MSSQL_TRANSFER_KIND_INVALID');
    const exportId=request.operationId, destination=join(root,exportId);
    if(await exists(destination)) {
      const prior=await nativeManifest(exportId);
      need(prior.value.releaseId===input.releaseId && prior.value.packageManifestSha256===input.manifestSha256 &&
        prior.value.kind===input.kind,'MSSQL_TRANSFER_SELECTION_CHANGED',undefined,409);
      return manifestView(prior);
    }
    const original=await model.open(input.releaseId);
    need(original.manifestSha256===input.manifestSha256,'MSSQL_TRANSFER_RELEASE_CHANGED',undefined,409);
    const prepared=await verifyPreparedMssqlSeller(original.directory);
    need(prepared.manifestSha256===input.manifestSha256,'MSSQL_TRANSFER_RELEASE_CHANGED',undefined,409);
    const stage=join(stageRoot,exportId);
    await privateDirectory(stage,true);
    const selections=[];
    if(input.kind==='merchant') {
      selections.push({name:'workspace.json',path:join(dirname(original.directory),'workspace.json')});
      selections.push({name:'package/manifest.json',path:join(original.directory,'manifest.json'),sha256:prepared.manifestSha256});
      for(const [name,file] of Object.entries(prepared.files))
        selections.push({name:'package/'+name,path:join(original.directory,name),...file});
    } else for(const name of publicNames)
      selections.push({name,path:join(original.directory,name),...prepared.files[name]});
    const files=[];
    for(const selected of selections) {
      const bytes=await readBytes(selected.path,MSSQL_TRANSFER_FILE_BYTES,false), sha256=digest(bytes);
      need((selected.sha256===undefined || selected.sha256===sha256) &&
        (selected.bytes===undefined || selected.bytes===bytes.length),'MSSQL_TRANSFER_SOURCE_CHANGED',undefined,409);
      await privateDirectory(dirname(join(stage,selected.name)),true);
      await publish(join(stage,selected.name),bytes);
      files.push({name:selected.name,bytes:bytes.length,sha256});
    }
    files.sort((a,b)=>a.name.localeCompare(b.name));
    const value={schema:MSSQL_TRANSFER_SCHEMA,exportId,workspaceId:scope,createdAt:request.createdAt,
      releaseId:input.releaseId,kind:input.kind,planId:original.planId,
      packageManifestSha256:original.manifestSha256,files};
    const bytes=encoded(value);parseMssqlTransferManifest(bytes,exportId);
    await publish(join(stage,MSSQL_TRANSFER_MANIFEST),bytes);await syncDirectory(stage);
    await rename(stage,destination);await syncDirectory(root);
    return manifestView(await nativeManifest(exportId));
  }
  async function file(input) {
    exact(input,['exportId','file','expectedManifestSha256','expectedSha256','readId','offset','limit'],
      ['exportId','file','expectedManifestSha256','expectedSha256']);
    checked(input.expectedManifestSha256,SHA,'transfer manifest digest');checked(input.expectedSha256,SHA,'file digest');
    if(input.readId!==undefined)checked(input.readId,UUID,'file read UUID');
    const selected=await nativeManifest(input.exportId);
    need(selected.sha256===input.expectedManifestSha256,'MSSQL_TRANSFER_MANIFEST_CHANGED',undefined,409);
    const expected=input.file===MSSQL_TRANSFER_MANIFEST?
      {name:MSSQL_TRANSFER_MANIFEST,sha256:selected.sha256,bytes:selected.bytes.length}:
      selected.value.files.find(file=>file.name===input.file);
    need(expected && expected.sha256===input.expectedSha256,'MSSQL_TRANSFER_FILE_NOT_SELECTED',undefined,409);
    const result=await reads.read({scope:scope+':'+input.exportId,key:input.exportId+':'+input.file,kind:'MSSQL_TRANSFER',
      directory:identity.directory,readId:input.readId,offset:input.offset,limit:input.limit,expectedSha256:input.expectedSha256,
      async load() {
        const handle=await open(join(selected.directory,expected.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        return {readonlyFileHandle:handle,bytes:expected.bytes,sha256:expected.sha256,name:expected.name};
      }});
    return {workspaceId:scope,exportId:input.exportId,manifestSha256:selected.sha256,...result};
  }
  async function receive(input) {
    exact(input,['directory','expectedManifestSha256'],['directory','expectedManifestSha256']);
    checked(input.expectedManifestSha256,SHA,'transfer manifest digest');
    const directory=await privateDirectory(absolute(input.directory));
    const bytes=await readBytes(join(directory,MSSQL_TRANSFER_MANIFEST),MSSQL_TRANSFER_MANIFEST_BYTES);
    need(digest(bytes)===input.expectedManifestSha256,'MSSQL_TRANSFER_MANIFEST_CHANGED',undefined,409);
    const parsed=JSON.parse(bytes),manifest=parseMssqlTransferManifest(bytes,parsed.exportId);
    need(manifest.kind==='merchant','MSSQL_MERCHANT_TRANSFER_REQUIRED');
    for(const expected of manifest.files) {
      const actual=await readBytes(join(directory,expected.name),MSSQL_TRANSFER_FILE_BYTES);
      need(actual.length===expected.bytes && digest(actual)===expected.sha256,'MSSQL_TRANSFER_FILE_CHANGED',undefined,409);
    }
    const metadata=await readJSON(join(directory,'workspace.json'),1048576);
    need(metadata.releaseId===manifest.releaseId && metadata.planId===manifest.planId &&
      metadata.manifestSha256===manifest.packageManifestSha256,'MSSQL_TRANSFER_RELEASE_CHANGED',undefined,409);
    return model.adoptRelease({directory,manifestSha256:manifest.packageManifestSha256,
      workspaceSha256:manifest.files.find(file=>file.name==='workspace.json').sha256});
  }
  return {
    exportSource,receive,file,
    manifest:async exportId=>manifestView(await nativeManifest(exportId)),
    async exports({after,limit=50}={}) {
      need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100&&(after===undefined||UUID.test(after)),'MSSQL_OPERATOR_PAGE_INVALID');
      const names=(await readdir(root,{withFileTypes:true})).filter(item=>item.isDirectory()&&UUID.test(item.name))
        .map(item=>item.name).sort().filter(id=>after===undefined||id>after),selected=names.slice(0,limit),items=[];
      for(const id of selected)items.push(manifestView(await nativeManifest(id)));
      return {items,hasMore:names.length>selected.length,nextCursor:names.length>selected.length?selected.at(-1):null};
    },
    async release(input) {
      exact(input,['exportId','readId'],['exportId','readId']);
      checked(input.exportId,UUID,'export UUID');checked(input.readId,UUID,'file read UUID');
      await reads.release(scope+':'+input.exportId,input.readId);return {workspaceId:scope,exportId:input.exportId,readId:input.readId,released:true};
    },
    close:()=>reads.close()
  };
}

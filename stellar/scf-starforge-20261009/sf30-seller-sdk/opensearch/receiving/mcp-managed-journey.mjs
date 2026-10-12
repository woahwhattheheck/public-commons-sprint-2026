// MIT. One receiving workflow over the original completed managed deployment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { readOpenSearchWorkspaceConfiguration, openSearchWorkspaceTools,
  MerchantOpenSearchWorkspaces } from '../../../../../stellar-forge/mcp-merchant-operator/opensearch-workspace.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const actions = {
  open:'open',stage:'stage',activate:'activate',rollback:'rollback',run:'start',
  stop:'stop',restart:'restart','generate-client':'generate_client',
};
function toolArguments(operation,workspace) {
  const source = operation.request, action = source.action;
  const args = {workspace,requestId:source.requestId};
  for (const key of ['packageId','expectedGeneration','instanceId','reason','label','to'])
    if (Object.hasOwn(source,key)) args[key] = source[key];
  if (source.id !== undefined) args[action === 'generate-client' ? 'exportId' : 'releaseId'] = source.id;
  return args;
}
function noControllerCapability(operation) {
  const console = operation.result?.status?.console;
  assert.equal(console?.operatorUrl,undefined);
  assert.equal(console?.token,undefined);
}
function members(bytes,exportId) {
  const raw = gunzipSync(bytes), result = new Map();
  for (let at=0; at+512<=raw.length;) {
    const header = raw.subarray(at,at+512);
    if (header.every(byte=>byte===0)) break;
    const field = (start,length) => header.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'').trim();
    const name = field(0,100), size = Number.parseInt(field(124,12),8);
    assert.ok(name.startsWith(exportId+'/') && !name.slice(exportId.length+1).includes('/'),'Expected one original customer file.');
    assert.ok(Number.isSafeInteger(size) && size>=0 && at+512+size<=raw.length,'Complete original archive member.');
    assert.ok(!result.has(name),'Unique original archive member.');
    result.set(name,raw.subarray(at+512,at+512+size)); at += 512+Math.ceil(size/512)*512;
  }
  return result;
}

export async function receiveManagedOpenSearchMcp({connection,workspace,directory}) {
  const parsed = await readOpenSearchWorkspaceConfiguration(connection);
  assert.ok(parsed.workspaces[workspace],'Select a configured original workspace alias.');
  directory = resolve(directory); await mkdir(directory,{recursive:true,mode:0o700});
  const stat = await lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(directory)===directory);
  if (process.platform !== 'win32') assert.equal(stat.mode&0o077,0,'Use a private receiving directory.');
  const operator = new MerchantOpenSearchWorkspaces({opensearchWorkspaces:parsed},{environment:{}});
  const call = (name,input={}) => operator.call('merchant_opensearch_'+name,{workspace,...input});
  const report = {schema:'stellar-forge.opensearch-managed-mcp-receiving.v1',
    startedAt:new Date().toISOString(),workspace,stages:[],replayed:[],files:[]};
  const retained = async (name,bytes) => {
    assert.equal(basename(name),name);
    const path = join(directory,name);
    try { const existing = await readFile(path); assert.deepEqual(existing,bytes,'Reuse the same completed receiving artifact.'); }
    catch (error) { if (error.code!=='ENOENT') throw error; await writeFile(path,bytes,{flag:'wx',mode:0o600}); }
    return {name,bytes:bytes.length,sha256:sha(bytes)};
  };
  async function transfer(name,args) {
    const parts=[]; let readId,expectedSha256=args.expectedSha256,offset=0,first;
    for (;;) {
      const value = await call(name,{...args,...(readId?{readId}:{}),...(expectedSha256?{expectedSha256}:{}),offset,limit:4096});
      first ??= value; expectedSha256 ??= value.file.sha256;
      assert.equal(value.file.sha256,expectedSha256); assert.equal(value.offset,offset);
      const bytes = Buffer.from(value.data,'base64');
      assert.equal(bytes.length,value.bytesRead); parts.push(bytes);
      if (value.nextOffset===null) break;
      assert.equal(value.nextOffset,offset+bytes.length);
      readId=value.readId; offset=value.nextOffset;
    }
    const bytes=Buffer.concat(parts);
    assert.equal(bytes.length,first.file.bytes); assert.equal(sha(bytes),expectedSha256);
    return {bytes,file:first.file};
  }
  try {
    const names = openSearchWorkspaceTools((name)=>name);
    assert.equal(names.filter(name=>name.startsWith('merchant_opensearch_deployment_')).length,17);
    assert.equal(names.length,43);
    await call('open');
    const initial = await call('deployment_status');
    assert.equal(initial.deployment.consoleOpen,false,'Use retained receiving after the original owner has handed over its journal.');
    report.workspaceId=initial.workspaceId;
    report.selection={generation:initial.state.generation,active:initial.state.active,previous:initial.state.previous};
    const operations=[]; let cursor;
    do {
      const page=await call('list',{collection:'operations',limit:100,...(cursor?{cursor}:{})});
      operations.push(...page.items); cursor=page.nextCursor;
    } while(cursor);
    const candidates=operations.filter(value=>value.kind.startsWith('deployment-') && value.state==='COMPLETE');
    assert.ok(candidates.length,'Receive the original completed deployment journal.');
    const detailed=[];
    for(const item of candidates) detailed.push(await call('operation',{requestId:item.id,includeRequest:true}));
    const completed = new Set(detailed.map(value=>value.request.action));
    for(const action of ['stage','activate','run','restart','rollback','generate-client'])
      assert.ok(completed.has(action),'Original native owner completes '+action+' before this receiving workflow.');
    // All IDs are loaded from already COMPLETE original rows. Replaying those
    // exact actions cannot stage another release or start a provider operation.
    for(const item of detailed) {
      const action=item.request.action;
      if(!Object.hasOwn(actions,action)) continue;
      const result=await call('deployment_'+actions[action],toolArguments(item,workspace));
      assert.equal(result.id,item.id); assert.equal(result.state,'COMPLETE');
      assert.equal(result.requestSha256,item.requestSha256); noControllerCapability(result);
      report.replayed.push({requestId:item.id,action,state:result.state,requestSha256:result.requestSha256});
    }
    report.stages.push('ORIGINAL_TYPED_LIFECYCLE_RECOVERY');
    const releaseIds=initial.releases.map(value=>value.id);
    assert.ok(releaseIds.length>=2,'The original upgrade retained both releases.');
    const comparison=await call('deployment_compare',{from:releaseIds[0],to:releaseIds[1]});
    report.comparison={from:releaseIds[0],to:releaseIds[1],generation:comparison.generation};
    report.stages.push('RETAINED_RELEASE_COMPARISON');
    const exports=[]; let after;
    do {
      const page=await call('deployment_clients',{limit:1,...(after?{after}:{})});
      exports.push(...page.entries); after=page.nextAfter;
    } while(after);
    const selected=exports.find(value=>value.state==='COMPLETION_RETAINED');
    assert.ok(selected,'The original owned seller retained a customer export.');
    const exportId=selected.exportId, inspected=await call('deployment_client',{exportId});
    const manifest=await call('deployment_manifest',{exportId});
    assert.equal(inspected.exportId,exportId); report.exportId=exportId;
    report.manifestSha256=manifest.manifestFile.sha256;
    report.customerProvenance=manifest.manifest.provenance;
    const originals=[...manifest.manifest.files,manifest.manifestFile], fileBytes=new Map();
    for(const file of originals) {
      const received=await transfer('deployment_file',{exportId,file:file.name,
        expectedManifestSha256:report.manifestSha256,expectedSha256:file.sha256});
      assert.equal(received.file.bytes,file.bytes);
      fileBytes.set(exportId+'/'+file.name,received.bytes);
      report.files.push(await retained(file.name,received.bytes));
    }
    report.stages.push('ORIGINAL_CUSTOMER_MANIFEST_AND_FILES');
    const archive=await transfer('deployment_archive',{exportId,expectedManifestSha256:report.manifestSha256});
    const archiveMembers=members(archive.bytes,exportId);
    assert.equal(archiveMembers.size,fileBytes.size);
    for(const [name,bytes]of fileBytes) assert.deepEqual(archiveMembers.get(name),bytes,'Archive matches original file '+name);
    report.archive=await retained(archive.file.name,archive.bytes);
    report.stages.push('ORIGINAL_CUSTOMER_ARCHIVE');
    const releaseId=manifest.manifest.provenance?.releaseId ?? initial.state.active;
    const handover=await call('deployment_handover',{releaseId});
    assert.equal(handover.snapshot,'CURRENT_DEPLOYMENT');
    assert.equal(sha(Buffer.from(handover.text)),handover.file.sha256);
    report.handover=await retained(handover.file.name.replace(/\.md$/,'-'+handover.file.sha256.slice(0,12)+'.md'),Buffer.from(handover.text));
    const originalRun=detailed.find(item=>item.request.action==='run');
    const operation=await transfer('read',{kind:'operation',id:originalRun.id});
    noControllerCapability(JSON.parse(operation.bytes.toString('utf8')));
    report.operationExport={requestId:originalRun.id,bytes:operation.file.bytes,sha256:operation.file.sha256};
    report.stages.push('CURRENT_HANDOVER_AND_MANAGED_OPERATION_EXPORT');
    const file=originals.find(value=>value.bytes>64);
    assert.ok(file);
    const partialFile=await call('deployment_file',{exportId,file:file.name,expectedManifestSha256:report.manifestSha256,
      expectedSha256:file.sha256,offset:0,limit:32});
    const partialArchive=await call('deployment_archive',{exportId,expectedManifestSha256:report.manifestSha256,limit:32});
    assert.ok(partialFile.nextOffset && partialArchive.nextOffset);
    await call('close'); await call('open');
    const resumedFile=await call('deployment_file',{exportId,file:file.name,expectedManifestSha256:report.manifestSha256,
      expectedSha256:file.sha256,offset:partialFile.nextOffset,limit:32});
    assert.equal(resumedFile.file.sha256,file.sha256);
    assert.deepEqual(Buffer.from(resumedFile.data,'base64'),fileBytes.get(exportId+'/'+file.name).subarray(32,64));
    const resumedArchive=await call('deployment_archive',{exportId,expectedManifestSha256:report.manifestSha256,
      expectedSha256:partialArchive.file.sha256,offset:partialArchive.nextOffset,limit:32});
    assert.deepEqual(Buffer.from(resumedArchive.data,'base64'),archive.bytes.subarray(32,64));
    await call('deployment_file_release',{exportId,readId:resumedFile.readId});
    await call('read_release',{readId:resumedArchive.readId});
    const final=await call('deployment_status');
    assert.equal(final.workspaceId,report.workspaceId);
    assert.deepEqual({generation:final.state.generation,active:final.state.active,previous:final.state.previous},report.selection);
    assert.equal(final.deployment.consoleOpen,false);
    report.stages.push('SAME_WORKSPACE_REOPEN_AND_CUSTOMER_TRANSFER_RESUME');
    report.state='COMPLETE';report.completedAt=new Date().toISOString();
    return report;
  } finally { await operator.close(); }
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=parseArgs({options:{connection:{type:'string'},workspace:{type:'string'},directory:{type:'string'}}}).values;
  for(const name of ['connection','workspace','directory']) if(!args[name]) throw new Error('Supply --'+name+'.');
  const report=await receiveManagedOpenSearchMcp(args);
  const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
  await writeFile(join(resolve(args.directory),'managed-mcp-native-run.json'),bytes,{mode:0o600});
  process.stdout.write(bytes);
}

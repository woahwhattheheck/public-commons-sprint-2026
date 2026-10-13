// MIT. Receive the complete original DCAT catalogue through the maintained Applications writer.
import { constants } from 'node:fs';
import { open, link, unlink, rename, rm, lstat } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectCkanWorkspaceArchive, receiveCkanWorkspaceArchive, assertCkanWorkspaceReceived }
  from '../../sf30-seller-sdk/ckan/archive.mjs';
import { inspectDcatSemanticRuntime, writeDcatSemanticRuntimeEnvironment }
  from '../../sf30-seller-sdk/ckan/dcat-semantic-runtime.mjs';
import { inspectDcatSemanticRuntimeTransfer, receiveDcatSemanticRuntimeTransfer,
  prepareDcatSemanticRuntimeFromTransfer }
  from '../../sf30-seller-sdk/ckan/dcat-semantic-runtime-transfer.mjs';
import { inspectApplicationSetup, prepareApplicationSetup, saveApplicationSetup, applicationSetupStatus }
  from './application-setup-operations.mjs';
import { readSetupFile, setupDocumentFamily, setupConfiguration } from './public/application-setup-codec.mjs';
import { absolute, privateDirectory, makePrivate, regular, readJSON, saveJSON, operationLease,
  operationId, recordId, need, plain, digest, json, canonical, now } from './storage.mjs';

export const DCAT_APPLICATION_RECEIVING_SCHEMA = 'stellar-forge.dcat-application-receiving.v1';
export const DCAT_APPLICATION_RECEIVING_REQUEST = 'stellar-forge.dcat-application-receiving-request.v1';
export const DCAT_APPLICATION_TRANSFER_REQUEST = 'stellar-forge.dcat-application-receiving-request.v2';
const MAX = 2 * 1024 * 1024, MAX_RECORD = 32 * 1024 * 1024, SHA = /^[a-f0-9]{64}$/;
const hash = value => digest(json(canonical(value)));
const copy = value => JSON.parse(JSON.stringify(value));
const decode = raw => new TextDecoder('utf-8', { fatal: true }).decode(raw);
const files = root => join(root, 'selection');
const requiredPath = value => { absolute(value); need(value !== '/', 'DCAT_RECEIVING_PATH_INVALID'); return value; };
const overlaps = (a, b) => a === b || [relative(a, b), relative(b, a)].some(p => p && p !== '..' && !p.startsWith('../') && !isAbsolute(p));
function checkedRequest(value) {
  need(plain(value) && [DCAT_APPLICATION_RECEIVING_REQUEST,DCAT_APPLICATION_TRANSFER_REQUEST].includes(value.schema) &&
    Object.keys(value).every(k => ['schema','requestId','setup','archive','catalogueDirectory',
      'runtimeId','semanticRuntime','environmentInput','label','port'].includes(k)),
    'DCAT_RECEIVING_REQUEST_INVALID');
  operationId(value.requestId); recordId(value.runtimeId); requiredPath(value.catalogueDirectory);
  for (const key of ['setup','archive']) {
    need(plain(value[key]) && Object.keys(value[key]).every(k => ['file','sha256'].includes(k)) &&
      SHA.test(value[key].sha256 ?? ''), 'DCAT_RECEIVING_SOURCE_REQUIRED');
    requiredPath(value[key].file);
  }
  need(plain(value.semanticRuntime),'DCAT_RECEIVING_RUNTIME_REQUIRED');
  requiredPath(value.semanticRuntime.directory);
  if(value.semanticRuntime.transfer !== undefined) {
    const transfer=value.semanticRuntime.transfer;
    need(value.schema===DCAT_APPLICATION_TRANSFER_REQUEST &&
      Object.keys(value.semanticRuntime).every(k=>['directory','transfer'].includes(k)) &&
      plain(transfer) && Object.keys(transfer).every(k=>['file','sha256','directory','python'].includes(k)) &&
      SHA.test(transfer.sha256 ?? ''),'DCAT_RECEIVING_TRANSFER_REQUIRED');
    for(const key of ['file','directory','python'])requiredPath(transfer[key]);
  } else need(Object.keys(value.semanticRuntime).every(k=>['directory','sha256'].includes(k)) &&
    SHA.test(value.semanticRuntime.sha256 ?? ''),'DCAT_RECEIVING_RUNTIME_REQUIRED');
  if (value.environmentInput !== undefined) {
    need(plain(value.environmentInput) && Object.keys(value.environmentInput).every(k => ['file','sha256'].includes(k)) &&
      SHA.test(value.environmentInput.sha256 ?? ''), 'DCAT_RECEIVING_ENVIRONMENT_INVALID');
    requiredPath(value.environmentInput.file);
  }
  if (value.label !== undefined) need(typeof value.label === 'string' && value.label.trim() &&
    value.label.length <= 120, 'DCAT_RECEIVING_LABEL_INVALID');
  if (value.port !== undefined) need(Number.isInteger(value.port) && value.port >= 0 && value.port <= 65535,
    'DCAT_RECEIVING_PORT_INVALID');
  return copy(value);
}
async function privateBytes(path, maximum = MAX) {
  const handle = await open(requiredPath(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const first = await handle.stat();
    need(first.isFile() && first.nlink === 1 && !(first.mode & 0o077) &&
      (process.getuid === undefined || first.uid === process.getuid()) && first.size <= maximum,
      'DCAT_RECEIVING_PRIVATE_FILE_REQUIRED');
    const blocks=[];let length=0;
    while(length <= maximum) {
      const block=Buffer.alloc(Math.min(65536,maximum+1-length));
      const read=await handle.read(block,0,block.length,length);
      if(!read.bytesRead)break;
      length+=read.bytesRead;need(length<=maximum,'DCAT_RECEIVING_FILE_TOO_LARGE');
      blocks.push(block.subarray(0,read.bytesRead));
    }
    const raw=Buffer.concat(blocks,length), after = await handle.stat();
    need(raw.length === first.size && raw.length <= maximum && first.size === after.size &&
      first.mtimeMs === after.mtimeMs && first.ctimeMs === after.ctimeMs,
      'DCAT_RECEIVING_SOURCE_CHANGED');
    return raw;
  } finally { await handle.close(); }
}
async function retain(path, raw) {
  // Content-bound staging survives a crash between hardlink publication and
  // unlink. Only this exact selected file/inode is recovered under our lease.
  const pending = path + '.pending-' + digest(raw);
  await privateDirectory(dirname(path));
  const stat = async p => {try{return await lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  let staged=await stat(pending),published=await stat(path);
  if(staged && published && staged.dev===published.dev && staged.ino===published.ino) {
    need(staged.isFile() && !staged.isSymbolicLink() && staged.nlink===2 &&
      !(staged.mode & 0o077) && (process.getuid===undefined || staged.uid===process.getuid()),
      'DCAT_RECEIVING_STAGING_CHANGED');
    // Check complete bytes through a bounded no-follow descriptor before
    // removing the one retained staging link.
    const fd=await open(pending,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const before=await fd.stat();
      need(before.dev===staged.dev && before.ino===staged.ino && before.size===raw.length,
        'DCAT_RECEIVING_STAGING_CHANGED');
      let offset=0;
      while(offset<raw.length) {
        const block=Buffer.alloc(Math.min(65536,raw.length-offset));
        const n=(await fd.read(block,0,block.length,offset)).bytesRead;
        need(n>0 && block.subarray(0,n).equals(raw.subarray(offset,offset+n)),
          'DCAT_RECEIVING_RETAINED_INPUT_CHANGED');offset+=n;
      }
      const after=await fd.stat();
      need(after.size===before.size && after.mtimeMs===before.mtimeMs && after.ctimeMs===before.ctimeMs &&
        after.nlink===2,'DCAT_RECEIVING_STAGING_CHANGED');
    } finally {await fd.close();}
    await unlink(pending);staged=null;
    const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
    try{await parent.sync();}finally{await parent.close();}
  }
  if(published) {
    need((await privateBytes(path,Math.max(MAX,raw.length))).equals(raw),'DCAT_RECEIVING_RETAINED_INPUT_CHANGED');
    return;
  }
  let handle;
  try {handle=await open(pending,'wx',0o600);}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    handle=await open(pending,constants.O_RDWR|constants.O_NOFOLLOW);
  }
  try {
    const first=await handle.stat();
    need(first.isFile() && first.nlink===1 && !(first.mode&0o077) &&
      (process.getuid===undefined || first.uid===process.getuid()) && first.size<=raw.length,
      'DCAT_RECEIVING_STAGING_CHANGED');
    let offset=0;
    while(offset<first.size) {
      const block=Buffer.alloc(Math.min(65536,first.size-offset));
      const n=(await handle.read(block,0,block.length,offset)).bytesRead;
      need(n>0 && block.subarray(0,n).equals(raw.subarray(offset,offset+n)),
        'DCAT_RECEIVING_RETAINED_INPUT_CHANGED');offset+=n;
    }
    const checked=await handle.stat();
    need(checked.size===first.size && checked.mtimeMs===first.mtimeMs && checked.ctimeMs===first.ctimeMs,
      'DCAT_RECEIVING_STAGING_CHANGED');
    while(offset<raw.length) {
      const n=(await handle.write(raw,offset,raw.length-offset,offset)).bytesWritten;
      need(n>0,'DCAT_RECEIVING_WRITE_FAILED');offset+=n;
    }
    await handle.sync();
  } finally {await handle.close();}
  try {await link(pending,path);}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    need((await privateBytes(path,Math.max(MAX,raw.length))).equals(raw),'DCAT_RECEIVING_RETAINED_INPUT_CHANGED');
  }
  await unlink(pending);
  const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
  try {await parent.sync();} finally {await parent.close();}
}

const descriptor = (file, raw) => ({ file, bytes: raw.length, sha256: digest(raw) });
async function withOperation(directory, create, work) {
  const root = requiredPath(resolve(directory));
  if (create) {
    try { await makePrivate(root); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await privateDirectory(root);
  const lease = await operationLease(join(root, 'receiving.lock'));
  try { return await work(root); } finally { await lease.close(); }
}
function abort(signal) { need(!signal?.aborted, 'DCAT_RECEIVING_CANCELLED', 'The original receiving operation was interrupted.', 409); }
async function readSelection(root) {
  const dir = files(root); await privateDirectory(dir);
  const record = JSON.parse(decode(await privateBytes(join(dir, 'operation.json'), MAX_RECORD)));
  need(record?.schema === DCAT_APPLICATION_RECEIVING_SCHEMA && record.operationDirectory === root &&
    ['SELECTED','RUNTIME_INPUTS_RECEIVED','RUNTIME_READY','CATALOGUE_RECEIVED','REVIEWED','SAVED'].includes(record.phase),
    'DCAT_RECEIVING_OPERATION_INVALID');
  const request = checkedRequest(record.request);
  need(record.requestSha256 === hash(request) && record.id === request.requestId,
    'DCAT_RECEIVING_REQUEST_CHANGED');
  for (const [name, selected] of Object.entries(record.inputs ?? {})) {
    need(['request','setup','environment','semanticReceipt','archiveManifest','runtimeTransferManifest','runtimeTransferReceipt'].includes(name) &&
      plain(selected) && ({request:'request.json',setup:'source-setup.json',environment:'source-environment.json',semanticReceipt:'semantic-runtime.json',archiveManifest:'archive-manifest.json',runtimeTransferManifest:'runtime-transfer-manifest.json',runtimeTransferReceipt:'runtime-transfer-inputs.json'})[name] === selected.file &&
      Number.isSafeInteger(selected.bytes) && selected.bytes >= 0 &&
      selected.bytes <= ({request:MAX,setup:MAX,environment:65536,semanticReceipt:16*1024*1024,archiveManifest:MAX_RECORD,runtimeTransferManifest:16*1024*1024,runtimeTransferReceipt:16*1024*1024})[name] && SHA.test(selected.sha256 ?? ''),
      'DCAT_RECEIVING_SOURCE_INVALID');
    const raw = await privateBytes(join(dir, selected.file), Math.max(MAX, selected.bytes));
    need(raw.length === selected.bytes && digest(raw) === selected.sha256, 'DCAT_RECEIVING_SOURCE_CHANGED');
  }
  need(record.inputs?.request && record.inputs?.setup && record.inputs?.environment && record.inputs?.archiveManifest,
    'DCAT_RECEIVING_SOURCE_INCOMPLETE');
  need(record.inputs.setup.sha256 === request.setup.sha256,'DCAT_RECEIVING_SOURCE_CHANGED');
  if(request.semanticRuntime.transfer) {
    const selection=request.semanticRuntime.transfer;
    need(record.inputs.runtimeTransferManifest && plain(record.runtimeTransfer) &&
      hash(record.runtimeTransfer.selection)===hash(selection),'DCAT_RECEIVING_TRANSFER_CHANGED');
    const manifest=JSON.parse(decode(await privateBytes(join(dir,'runtime-transfer-manifest.json'),16*1024*1024)));
    need(manifest.schema==='stellar-forge.dcat-semantic-runtime-transfer.v1' &&
      manifest.sourceRuntimeReceiptSha256===record.runtimeTransfer.sourceRuntimeReceiptSha256 &&
      manifest.lockSha256===record.runtimeTransfer.lockSha256,'DCAT_RECEIVING_TRANSFER_CHANGED');
    if(record.inputs.runtimeTransferReceipt) {
      const received=JSON.parse(decode(await privateBytes(join(dir,'runtime-transfer-inputs.json'),16*1024*1024)));
      checkReceivedTransfer(record,received);
      need(record.runtimeTransfer.receiptSha256===record.inputs.runtimeTransferReceipt.sha256,
        'DCAT_RECEIVING_TRANSFER_CHANGED');
    } else need(record.phase==='SELECTED' && !record.runtime,'DCAT_RECEIVING_TRANSFER_INCOMPLETE');
    if(record.runtime) {
      need(record.runtime.directory===request.semanticRuntime.directory &&
        SHA.test(record.runtime.sha256 ?? '') && record.inputs.semanticReceipt?.sha256===record.runtime.sha256,
        'DCAT_RECEIVING_RUNTIME_CHANGED');
      const receipt=JSON.parse(decode(await privateBytes(join(dir,'semantic-runtime.json'),16*1024*1024)));
      checkPreparedTransfer(record,receipt);
    } else need(['SELECTED','RUNTIME_INPUTS_RECEIVED'].includes(record.phase) &&
      !record.inputs.semanticReceipt,'DCAT_RECEIVING_RUNTIME_INCOMPLETE');
  } else need(record.inputs.semanticReceipt?.sha256 === request.semanticRuntime.sha256,
    'DCAT_RECEIVING_SOURCE_CHANGED');
  const archiveManifest = JSON.parse(decode(await privateBytes(join(dir,'archive-manifest.json'),MAX_RECORD)));
  need(hash(archiveManifest.source) === hash(record.archive.source) &&
    record.archive.files === archiveManifest.files.length &&
    record.archive.unpackedBytes === archiveManifest.totalBytes &&
    record.archive.sha256 === request.archive.sha256, 'DCAT_RECEIVING_ARCHIVE_CHANGED');
  const originalRequest = checkedRequest(JSON.parse(decode(await privateBytes(join(dir, 'request.json')))));
  need(hash(originalRequest) === record.requestSha256, 'DCAT_RECEIVING_REQUEST_CHANGED');
  const inspected = await inspectApplicationSetup({document:join(dir, 'source-setup.json')});
  const document = inspected.document, family = setupDocumentFamily(document);
  const variant = family.entries.find(v => v.id === record.variant.id);
  need(variant && variant.kind === 'dcat-migration' && hash(variant) === record.variant.sha256,
    'DCAT_RECEIVING_SETUP_CHANGED');
  if (record.catalogue) need(record.catalogue.state === 'COMPLETE' &&
    record.catalogue.directory === request.catalogueDirectory && record.catalogue.archiveSha256 === request.archive.sha256 &&
    record.catalogue.project.projectCreatedAt === record.archive.source.projectCreatedAt &&
    record.catalogue.project.catalogOrigin === record.archive.source.catalogOrigin,
    'DCAT_RECEIVING_CATALOGUE_CHANGED');
  if (record.setup) need(record.setup.operationId === request.requestId &&
    record.setup.workspaceId === record.workspaceId && record.setup.mode === 'new' &&
    record.setup.variant.kind === 'dcat-migration', 'DCAT_RECEIVING_APPLICATION_CHANGED');
  if (record.phase === 'SAVED') need(record.setup?.phase === 'SAVED' && record.setup.result?.saved === true,
    'DCAT_RECEIVING_SAVE_INVALID');
  return {record,document,variant};
}
async function selectedWorkspace(model, record) {
  const workspace = await model.state();
  need(workspace.workspaceId === record.workspaceId && model.directory === record.workspaceDirectory,
    'DCAT_RECEIVING_WORKSPACE_CHANGED',
    'Resume on this operation’s original Runtime workspace; another host requires a new explicit receiving operation.', 409);
  return workspace;
}
async function persist(root, record) {
  record.updatedAt = now(); need(Buffer.byteLength(json(record)) <= MAX_RECORD,'DCAT_RECEIVING_RECORD_TOO_LARGE'); await saveJSON(join(files(root), 'operation.json'), record, true);
}
function report(root, record) {
  return {schema:record.schema,operationDirectory:root,operationId:record.id,phase:record.phase,
    workspaceId:record.workspaceId,workspaceDirectory:record.workspaceDirectory,
    request:record.request,inputs:record.inputs,archive:record.archive,variant:record.variant,
    runtime:record.runtime ?? (record.request.semanticRuntime.transfer ? null : record.request.semanticRuntime),
    runtimeTransfer:record.runtimeTransfer ?? null,
    catalogue:record.catalogue ?? null,environment:record.environment ?? null,
    setup:record.setup ?? null,lastError:record.lastError ?? null,
    createdAt:record.createdAt,updatedAt:record.updatedAt,
    applicationStarted:false,
    runtimePreparation:record.request.semanticRuntime.transfer ? {
      mode:'received-inputs',phase:record.runtime?'READY':record.inputs.runtimeTransferReceipt?'READY_INPUTS':'SELECTED'
    } : {mode:'selected-ready',phase:'READY'},
    // Historical API field refers to catalogue operations, not the native
    // receiving/install helpers used for the selected semantic runtime.
    nativeOperationStarted:false};
}
async function initialize(model, root, requestFile, signal) {
  const raw = await privateBytes(requiredPath(requestFile)), request = checkedRequest(JSON.parse(decode(raw)));
  const workspace = await model.state();
  need(typeof workspace.workspaceId === 'string' && workspace.workspaceId, 'DCAT_RECEIVING_WORKSPACE_REQUIRED');
  const runtime = workspace.runtimes.find(r => r.id === request.runtimeId);
  need(runtime?.phase === 'READY', 'DCAT_RECEIVING_HOST_RUNTIME_REQUIRED');
  for (const p of [root,model.directory,request.catalogueDirectory,request.semanticRuntime.directory])
    requiredPath(p);
  need(!overlaps(root,request.catalogueDirectory) && !overlaps(root,request.semanticRuntime.directory) &&
    !overlaps(model.directory,request.catalogueDirectory) && !overlaps(request.catalogueDirectory,request.semanticRuntime.directory),
    'DCAT_RECEIVING_DIRECTORIES_OVERLAP',
    'Keep the receiving operation, catalogue, Runtime workspace and prepared Python in distinct private directories.');
  const transfer=request.semanticRuntime.transfer;
  if(transfer) {
    const directories=[root,model.directory,request.catalogueDirectory,request.semanticRuntime.directory,transfer.directory];
    need(directories.every((a,i)=>directories.every((b,j)=>i===j||!overlaps(a,b))) &&
      directories.every(directory=>!overlaps(directory,transfer.file) && !overlaps(directory,transfer.python)),
      'DCAT_RECEIVING_TRANSFER_DIRECTORIES_OVERLAP',
      'Keep original incoming runtime ZIP, receiving inputs, installed runtime, catalogue and application operation separately selected.');
  }
  // A first request must select an absent destination. Subsequent resumes use
  // the original archive receiver's durable marker and retained source identity.
  try { await lstat(request.catalogueDirectory); need(false,'DCAT_RECEIVING_NEW_CATALOGUE_REQUIRED'); }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
  const setupRaw = await privateBytes(request.setup.file);
  need(digest(setupRaw) === request.setup.sha256, 'DCAT_RECEIVING_SETUP_CHANGED');
  const inspected = await inspectApplicationSetup({document:request.setup.file});
  need(inspected.source.sha256 === request.setup.sha256, 'DCAT_RECEIVING_SETUP_CHANGED');
  const document = readSetupFile(decode(setupRaw)), family = setupDocumentFamily(document);
  const candidates = family.entries.filter(v => v.kind === 'dcat-migration');
  need(candidates.length === 1, 'DCAT_RECEIVING_SETUP_VARIANT_REQUIRED',
    'Select a complete original setup containing exactly one DCAT catalogue application variant.');
  const variant = candidates[0];
  const archive = await inspectCkanWorkspaceArchive({file:request.archive.file,expectedSha256:request.archive.sha256,signal});
  need(archive.source.sourceKind === 'dcat-us' && archive.source.dcat,
    'DCAT_RECEIVING_DCAT_ARCHIVE_REQUIRED');
  const sourceConfiguration = setupConfiguration(variant.form, document.catalog);
  need(sourceConfiguration.settings.workspaceDirectory === archive.source.directory,
    'DCAT_RECEIVING_SOURCE_PROJECT_CHANGED',
    'The original setup and complete archive must select the same original catalogue path.');
  abort(signal);
  let semanticRaw=null,runtimeTransfer=null,transferManifestRaw=null;
  if(transfer) {
    const selected=await inspectDcatSemanticRuntimeTransfer(
      {file:transfer.file,expectedSha256:transfer.sha256,python:transfer.python},{signal});
    need(selected.status==='VERIFIED_BYTES' && selected.sha256===transfer.sha256 &&
      SHA.test(selected.manifestSha256 ?? '') && SHA.test(selected.manifest?.sourceRuntimeReceiptSha256 ?? '') &&
      SHA.test(selected.manifest?.lockSha256 ?? ''),'DCAT_RECEIVING_TRANSFER_INVALID');
    transferManifestRaw=Buffer.from(json(selected.manifest));
    need(transferManifestRaw.length<=16*1024*1024,'DCAT_RECEIVING_TRANSFER_TOO_LARGE');
    runtimeTransfer={selection:copy(transfer),bundleBytes:selected.bytes,manifestSha256:selected.manifestSha256,
      sourceRuntimeReceiptSha256:selected.manifest.sourceRuntimeReceiptSha256,
      lockSha256:selected.manifest.lockSha256};
  } else {
    await inspectDcatSemanticRuntime(request.semanticRuntime.directory,{expectedSha256:request.semanticRuntime.sha256});
    semanticRaw=await privateBytes(join(request.semanticRuntime.directory,'runtime.json'),16*1024*1024);
    need(digest(semanticRaw)===request.semanticRuntime.sha256,'DCAT_RECEIVING_RUNTIME_CHANGED');
  }
  const environmentRaw = request.environmentInput ? await privateBytes(request.environmentInput.file,65536) : Buffer.from('{}\n');
  if(request.environmentInput) need(digest(environmentRaw) === request.environmentInput.sha256,'DCAT_RECEIVING_ENVIRONMENT_CHANGED');
  // Values are retained only in the private original file, never stdout.
  const environment = JSON.parse(decode(environmentRaw));
  need(plain(environment) && Object.keys(environment).length <= 125 &&
    Object.entries(environment).every(([key,value]) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) &&
      typeof value === 'string' && !value.includes('\0') && Buffer.byteLength(value) <= 8192) &&
    !Object.hasOwn(environment,'HOME') && !Object.hasOwn(environment,'CODEX_HOME'),
    'DCAT_RECEIVING_ENVIRONMENT_INVALID');
  const at = now(), record = {schema:DCAT_APPLICATION_RECEIVING_SCHEMA,id:request.requestId,phase:'SELECTED',
    operationDirectory:root,workspaceId:workspace.workspaceId,workspaceDirectory:model.directory,
    request,requestSha256:hash(request),inputs:{
      request:descriptor('request.json',raw),setup:descriptor('source-setup.json',setupRaw),
      environment:descriptor('source-environment.json',environmentRaw),
      ...(semanticRaw?{semanticReceipt:descriptor('semantic-runtime.json',semanticRaw)}:{}),
      ...(transferManifestRaw?{runtimeTransferManifest:descriptor('runtime-transfer-manifest.json',transferManifestRaw)}:{}),
      archiveManifest:descriptor('archive-manifest.json',Buffer.from(json(archive.manifest)))},
    ...(runtimeTransfer?{runtimeTransfer}:{}),
    variant:{id:variant.id,kind:variant.kind,applicationId:variant.applicationId,sha256:hash(variant)},
    archive:{file:archive.file,bytes:archive.bytes,sha256:archive.sha256,manifestSha256:archive.manifestSha256,
      files:archive.files,unpackedBytes:archive.unpackedBytes,source:archive.source},
    createdAt:at,updatedAt:at};
  need(Buffer.byteLength(json(record)) <= MAX_RECORD,'DCAT_RECEIVING_RECORD_TOO_LARGE');
  const staging = join(root,'selection.pending-'+randomUUID()); await makePrivate(staging);
  try {
    for(const [name,bytes] of [['request.json',raw],['source-setup.json',setupRaw],
      ['source-environment.json',environmentRaw],
      ...(semanticRaw?[['semantic-runtime.json',semanticRaw]]:[]),
      ...(transferManifestRaw?[['runtime-transfer-manifest.json',transferManifestRaw]]:[]),
      ['archive-manifest.json',Buffer.from(json(archive.manifest))]]) await retain(join(staging,name),bytes);
    await saveJSON(join(staging,'operation.json'),record);
    await rename(staging,files(root));
    const parent=await open(root,constants.O_RDONLY|constants.O_DIRECTORY);
    try {await parent.sync();} finally {await parent.close();}
  } finally {await rm(staging,{recursive:true,force:true});}
  return {record,document,variant};
}

function checkReceivedTransfer(record,received) {
  const transfer=record.request.semanticRuntime.transfer, selected=record.runtimeTransfer;
  need(received.schema==='stellar-forge.dcat-semantic-runtime-transfer-received.v1' &&
    received.status==='READY_INPUTS' && received.directory===transfer.directory &&
    received.bundle?.sha256===transfer.sha256 && received.bundle.bytes===selected.bundleBytes &&
    received.bundle.manifestSha256===selected.manifestSha256 &&
    received.sourceRuntimeReceiptSha256===selected.sourceRuntimeReceiptSha256 &&
    received.lockSha256===selected.lockSha256,'DCAT_RECEIVING_TRANSFER_CHANGED');
}
function checkPreparedTransfer(record,receipt) {
  const selected=record.runtimeTransfer,transfer=receipt.transfer;
  need(receipt.status==='READY' && receipt.directory===record.request.semanticRuntime.directory &&
    transfer?.directory===record.request.semanticRuntime.transfer.directory &&
    transfer.receiptSha256===selected.receiptSha256 &&
    transfer.bundleSha256===record.request.semanticRuntime.transfer.sha256 &&
    transfer.sourceRuntimeReceiptSha256===selected.sourceRuntimeReceiptSha256 &&
    transfer.lockSha256===selected.lockSha256 && receipt.lockSha256===selected.lockSha256,
    'DCAT_RECEIVING_RUNTIME_TRANSFER_CHANGED');
}
async function prepareSelectedRuntime(root,record,signal) {
  const requested=record.request.semanticRuntime,transfer=requested.transfer;
  if(!transfer)return requested;
  if(record.runtime)return record.runtime;
  abort(signal);
  if(!record.inputs.runtimeTransferReceipt) {
    // The complete original operation/ZIP/path selection is already durable.
    // Lost helper replies resume the same native received-input directory.
    const received=await receiveDcatSemanticRuntimeTransfer({
      file:transfer.file,expectedSha256:transfer.sha256,directory:transfer.directory,python:transfer.python},{signal});
    checkReceivedTransfer(record,received);
    const raw=await privateBytes(join(transfer.directory,'received-transfer.json'),16*1024*1024);
    need(raw.length===received.receiptBytes && digest(raw)===received.receiptSha256,
      'DCAT_RECEIVING_TRANSFER_CHANGED');
    checkReceivedTransfer(record,JSON.parse(decode(raw)));
    await retain(join(files(root),'runtime-transfer-inputs.json'),raw);
    record.inputs.runtimeTransferReceipt=descriptor('runtime-transfer-inputs.json',raw);
    record.runtimeTransfer.receiptSha256=received.receiptSha256;
    record.runtimeTransfer.receiptBytes=received.receiptBytes;
    record.phase='RUNTIME_INPUTS_RECEIVED';await persist(root,record);
  }
  abort(signal);
  // The original API verifies the complete received source/wheels/lock before
  // resuming its final private environment. It never resolves another wheel.
  const prepared=await prepareDcatSemanticRuntimeFromTransfer({
    transferDirectory:transfer.directory,expectedTransferSha256:record.runtimeTransfer.receiptSha256,
    directory:requested.directory,python:transfer.python},{signal});
  checkPreparedTransfer(record,prepared);
  const raw=await privateBytes(join(requested.directory,'runtime.json'),16*1024*1024);
  need(raw.length===prepared.receiptBytes && digest(raw)===prepared.receiptSha256,
    'DCAT_RECEIVING_RUNTIME_CHANGED');
  checkPreparedTransfer(record,JSON.parse(decode(raw)));
  await retain(join(files(root),'semantic-runtime.json'),raw);
  record.inputs.semanticReceipt=descriptor('semantic-runtime.json',raw);
  record.runtime={directory:requested.directory,sha256:prepared.receiptSha256};
  record.phase='RUNTIME_READY';await persist(root,record);
  return record.runtime;
}

export async function dcatApplicationReceivingStatus({operation}) {
  return withOperation(operation,false,async root => {
    const {record}=await readSelection(root);
    if(record.setup) {
      const native=await applicationSetupStatus({operation:join(root,'application')});
      need(native.operationId===record.id && native.workspaceId===record.workspaceId,'DCAT_RECEIVING_APPLICATION_CHANGED');
      return {...report(root,record),currentSetup:native};
    }
    return report(root,record);
  });
}
export async function prepareDcatApplicationReceiving(model,{operation,request:requestFile,signal}={}) {
  return withOperation(operation,true,async root => {
    let selected;
    let existing=false;
    try {await lstat(join(files(root),'operation.json'));existing=true;}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    if(existing) {
      selected=await readSelection(root); await selectedWorkspace(model,selected.record);
      if(requestFile) {
        const raw=await privateBytes(requiredPath(requestFile));
        need(digest(raw)===selected.record.inputs.request.sha256,'DCAT_RECEIVING_REQUEST_CHANGED');
      }
    } else {
      need(requestFile,'DCAT_RECEIVING_REQUEST_REQUIRED','Supply the complete receiving request for a new operation.');
      selected=await initialize(model,root,requestFile,signal);
    }
    const {record,document,variant}=selected, request=record.request;
    if(['REVIEWED','SAVED'].includes(record.phase)) return report(root,record);
    try {
      const semanticRuntime=await prepareSelectedRuntime(root,record,signal);
      abort(signal);
      if(!record.catalogue) {
        record.catalogue=await receiveCkanWorkspaceArchive({file:request.archive.file,directory:request.catalogueDirectory,
          expectedSha256:request.archive.sha256,signal});
        need(record.catalogue.project.projectCreatedAt===record.archive.source.projectCreatedAt &&
          record.catalogue.project.catalogOrigin===record.archive.source.catalogOrigin,'DCAT_RECEIVING_CATALOGUE_CHANGED');
        record.phase='CATALOGUE_RECEIVED'; await persist(root,record);
      }
      await assertCkanWorkspaceReceived(request.catalogueDirectory);
      const current=JSON.parse(decode(await privateBytes(join(request.catalogueDirectory,'workbench.json'),16*1024*1024)));
      need(current.createdAt===record.archive.source.projectCreatedAt && current.catalogOrigin===record.archive.source.catalogOrigin &&
        current.sourceKind==='dcat-us','DCAT_RECEIVING_CATALOGUE_CHANGED');
      abort(signal);
      await inspectDcatSemanticRuntime(semanticRuntime.directory,{expectedSha256:semanticRuntime.sha256});
      // Let the maintained writer produce the whole environment in a private
      // staging file, then publish atomically; an interrupted source export never
      // leaves a partial file at the selected application path.
      const environmentOutput=join(files(root),'recipient-environment.json');
      const temporaryEnvironment=join(files(root),'environment.pending-'+randomUUID()+'.json');
      let environment;
      try {
        const generated=await writeDcatSemanticRuntimeEnvironment({directory:semanticRuntime.directory,
          input:join(files(root),'source-environment.json'),out:temporaryEnvironment});
        need(generated.runtimeReceiptSha256===semanticRuntime.sha256,'DCAT_RECEIVING_RUNTIME_CHANGED');
        const raw=await privateBytes(temporaryEnvironment,65536);
        need(raw.length===generated.bytes && digest(raw)===generated.sha256,'DCAT_RECEIVING_ENVIRONMENT_CHANGED');
        await retain(environmentOutput,raw);
        environment={...generated,out:environmentOutput};
      } finally {await unlink(temporaryEnvironment).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      const configuration=setupConfiguration(variant.form,document.catalog);
      const bindings={runtimeId:request.runtimeId,label:request.label ?? configuration.label,
        settings:{...configuration.settings,workspaceDirectory:request.catalogueDirectory,environmentFile:environment.out,
          ...(request.port===undefined?{}:{port:request.port})}};
      await retain(join(files(root),'host-bindings.json'),Buffer.from(json(bindings)));
      record.environment=environment; await persist(root,record);
      abort(signal);
      record.setup=await prepareApplicationSetup(model,{operation:join(root,'application'),
        document:join(files(root),'source-setup.json'),mode:'new',kind:'dcat-migration',
        bindings:join(files(root),'host-bindings.json'),requestId:request.requestId});
      need(record.setup.workspaceId===record.workspaceId && record.setup.operationId===record.id,'DCAT_RECEIVING_APPLICATION_CHANGED');
      record.phase=record.setup.phase==='SAVED'?'SAVED':'REVIEWED'; delete record.lastError;
      await persist(root,record); return report(root,record);
    } catch(error) {
      record.lastError={at:now(),code:error.code??'DCAT_RECEIVING_FAILED',message:String(error.message??error).slice(0,4000)};
      await persist(root,record); throw error;
    }
  });
}
export async function saveDcatApplicationReceiving(model,{operation}={}) {
  return withOperation(operation,false,async root => {
    const {record}=await readSelection(root); await selectedWorkspace(model,record);
    need(['REVIEWED','SAVED'].includes(record.phase),'DCAT_RECEIVING_REVIEW_REQUIRED',
      'Finish the original prepare operation and inspect its native review before saving.');
    // Native save reopens the original accepted request before its current CAS,
    // preserving a following application edit if the first reply was lost.
    try {
      record.setup=await saveApplicationSetup(model,{operation:join(root,'application')});
      need(record.setup.operationId===record.id && record.setup.workspaceId===record.workspaceId &&
        record.setup.phase==='SAVED','DCAT_RECEIVING_APPLICATION_CHANGED');
      record.phase='SAVED';delete record.lastError;await persist(root,record);
      return report(root,record);
    } catch(error) {
      record.lastError={at:now(),code:error.code??'DCAT_RECEIVING_SAVE_FAILED',message:String(error.message??error).slice(0,4000)};
      await persist(root,record);throw error;
    }
  });
}

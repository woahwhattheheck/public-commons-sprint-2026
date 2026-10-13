// MIT. Original paid-job transport joined to complete native KiWIS customer receiving.
import { realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { readBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { privateDirectory, readPrivateJson, writePrivateJson } from '../../jobs/inputs/files.mjs';
import { openWaterQualityProject } from '../project.mjs';
import { canonical } from '../kiwis/source.mjs';
import { receiveCommissioningReview, readCommissioningReview, exportCommissioningReview } from '../kiwis/workflow.mjs';
import { metadata, immutable, verifyArchive } from './receive.mjs';
import { commissioningJobInput, commissioningJobIdentity, selectCommissioningJob,
  COMMISSIONING_JOB_EXPORTS, WQX_COMMISSIONING_SOURCE_LIMIT,
  WQX_COMMISSIONING_JOB_RESULT_SCHEMA, WQX_COMMISSIONING_BUNDLE_SCHEMA } from './commissioning.mjs';

export const COMMISSIONING_CUSTOMER_SCHEMA = 'starforge.wqx-commissioning-customer-receiving.v1';
const BINDING_SCHEMA = 'starforge.wqx-commissioning-customer-binding.v1';
const HASH = /^[0-9a-f]{64}$/;
const ZIP_LIMIT = 64 * 1024 * 1024, NATIVE_LIMIT = 256 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value,null,2) + '\n';
const fail = (code,message=code) => { throw Object.assign(new Error(message),{code}); };
const equal = (a,b,message) => { if (canonical(a)!==canonical(b)) fail('KIWIS_CUSTOMER_SOURCE_CHANGED',message); };
const expectedHash = (value,label) => {
  if (!HASH.test(value??'')) fail('KIWIS_CUSTOMER_IDENTITY','Select the exact '+label+' SHA-256.');
  return value;
};
const withoutFiles = input => Object.fromEntries(Object.entries(input).filter(([key])=>key!=='$files'));
async function existing(path) {
  try { return await readPrivateJson(path); } catch(error) { if(error.code==='ENOENT')return null;throw error; }
}
async function completeJson(path,limit,expected) {
  let bytes = await readBytes(path,limit);
  if (expected) equal({bytes:bytes.length,sha256:hash(bytes)},expected,'The complete retained JSON file changed.');
  const value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));bytes=null;return value;
}

/** Read the actual complete file once; the original input controller supplies policy and sealed descriptor. */
export async function inspectCommissioningJobSource({sourceFile,expectedSourceSha256,
  signal=new AbortController().signal}={}) {
  expectedHash(expectedSourceSha256,'complete source');signal.throwIfAborted();
  sourceFile = await realpath(resolve(sourceFile));
  const source = await metadata(sourceFile);
  if(source.sha256!==expectedSourceSha256||source.bytes>WQX_COMMISSIONING_SOURCE_LIMIT)
    fail('KIWIS_CUSTOMER_SOURCE_CHANGED','Select the original complete commissioning file within 128 MiB.');
  let bundle = await completeJson(sourceFile,WQX_COMMISSIONING_SOURCE_LIMIT,source);
  const input = commissioningJobInput(bundle),commissioning = selectCommissioningJob(input,bundle);
  bundle=null;signal.throwIfAborted();
  return {sourceFile,source:{filename:basename(sourceFile),contentType:'application/json',...source},input,commissioning};
}

function verifiedManifest(manifest,source,original,input,expectedJobId,expectedDescriptor) {
  if(manifest?.schema!==WQX_COMMISSIONING_JOB_RESULT_SCHEMA||manifest.functionId!=='waterQualityReview'||
      manifest.mode!=='commissioning'||manifest.sourceSchema!==WQX_COMMISSIONING_BUNDLE_SCHEMA||
      manifest.selection!=='COMPLETE_SAVED_COMMISSIONING_EDITION'||manifest.sourceRecomputed!==true||
      typeof manifest.jobId!=='string'||!manifest.jobId)
    fail('KIWIS_CUSTOMER_RESULT','Select the complete original commissioning job result.');
  if(expectedJobId!==undefined&&manifest.jobId!==expectedJobId)
    fail('KIWIS_CUSTOMER_JOB_CHANGED','The result belongs to another original paid job.');
  equal(manifest.request,input,'The exact original commissioning request changed.');
  equal(manifest.commissioning,original,'The result changed the complete saved commissioning selection.');
  if(!Array.isArray(manifest.members)||!Array.isArray(manifest.exports)||!Array.isArray(manifest.sourceFiles)||
      manifest.sourceFiles.length!==1||manifest.sourceFiles[0].slot!=='source')
    fail('KIWIS_CUSTOMER_FILES','Retain the one exact original source slot and all native exports.');
  equal({bytes:manifest.sourceFiles[0].bytes,sha256:manifest.sourceFiles[0].sha256},source,
    'The original sealed source descriptor differs from the actual complete bytes.');
  if(expectedDescriptor)equal(manifest.sourceFiles,[{slot:'source',...expectedDescriptor}],
    'The complete original filename, media type, policy and sealed descriptor changed.');
  const required=['original/source-bundle.json','original/commissioning-selection.json','README.md',
    ...Object.values(COMMISSIONING_JOB_EXPORTS).map(name=>'commissioning/'+name)].sort();
  equal(manifest.members.map(item=>item.path).sort(),required,'The delivered commissioning member set changed.');
  const sealed=manifest.members.find(item=>item.path==='original/source-bundle.json');
  equal({bytes:sealed.bytes,sha256:sealed.sha256},source,'The exact sealed source bytes were not retained.');
}

export async function compareCommissioningJobExports({project,identity,manifest,extractionDirectory,signal}) {
  const members=new Map(manifest.members.map(item=>[item.path,item]));
  const declarations=new Map(manifest.exports.map(item=>[item.format,item]));
  if(manifest.exports.length!==Object.keys(COMMISSIONING_JOB_EXPORTS).length||
      declarations.size!==Object.keys(COMMISSIONING_JOB_EXPORTS).length)
    fail('KIWIS_CUSTOMER_EXPORTS','Retain all eight original commissioning formats exactly once.');
  const verified=[];
  for(const [format,name]of Object.entries(COMMISSIONING_JOB_EXPORTS)){
    signal?.throwIfAborted();
    const artifact=await exportCommissioningReview({project,reviewId:identity.reviewId,format});
    const path='commissioning/'+name,declared=declarations.get(format),member=members.get(path);
    if(!declared||!member||declared.path!==path||declared.filename!==artifact.filename||declared.contentType!==artifact.mime)
      fail('KIWIS_CUSTOMER_EXPORTS','The original '+format+' output declaration changed.');
    const observed={bytes:artifact.bytes.length,sha256:hash(artifact.bytes)};
    equal(observed,{bytes:declared.bytes,sha256:declared.sha256},'The declared '+format+' output changed.');
    equal(observed,{bytes:member.bytes,sha256:member.sha256},'The complete '+format+' output changed.');
    const file=join(extractionDirectory,path);
    equal(await metadata(file),observed,'The retained customer '+format+' file changed.');
    verified.push({format,path:file,filename:artifact.filename,contentType:artifact.mime,...observed});
  }
  return verified;
}

/**
 * Verify and receive one selected result; it never starts a worker, acquires source or submits payment.
 * A retained directory binds the same archive/source/job and is reopened through the original native project.
 */
export async function receiveCommissioningJobResult({archiveFile,expectedArchiveSha256,directory,python='python3',
  expectedJobId,expectedRequest,expectedSource,signal=new AbortController().signal}={}){
  expectedHash(expectedArchiveSha256,'complete result');signal.throwIfAborted();
  expectedRequest=expectedRequest===undefined?undefined:structuredClone(expectedRequest);
  expectedSource=expectedSource===undefined?undefined:structuredClone(expectedSource);
  archiveFile=await realpath(resolve(archiveFile));directory=resolve(directory);
  await privateDirectory(directory);directory=await realpath(directory);
  const archiveMetadata=await metadata(archiveFile);
  if(archiveMetadata.sha256!==expectedArchiveSha256||archiveMetadata.bytes>ZIP_LIMIT)
    fail('KIWIS_CUSTOMER_RESULT_CHANGED','The original result ZIP changed or exceeds 64 MiB.');
  if(expectedSource!==undefined&&(!Number.isSafeInteger(expectedSource.bytes)||expectedSource.bytes<0||
      expectedSource.bytes>WQX_COMMISSIONING_SOURCE_LIMIT||!HASH.test(expectedSource.sha256??'')))
    fail('KIWIS_CUSTOMER_IDENTITY','Retain the complete original source length and SHA-256.');
  let expectedDescriptor=null;
  if(expectedRequest?.$files!==undefined){
    const files=expectedRequest.$files;
    if(!files||typeof files!=='object'||Array.isArray(files)||Object.keys(files).length!==1||
        !files.source||typeof files.source!=='object'||Array.isArray(files.source))
      fail('KIWIS_CUSTOMER_FILES','Retain the original source slot descriptor exactly.');
    expectedDescriptor=files.source;
  }
  const binding={schema:BINDING_SCHEMA,archiveFile,archive:archiveMetadata,
    expectedJobId:expectedJobId??null,expectedRequest:expectedRequest?withoutFiles(expectedRequest):null,
    expectedSource:expectedSource??null,expectedDescriptor};
  const lease=await acquireStateLease(directory);
  try{
    await immutable(join(directory,'binding.json'),Buffer.from(json(binding)));
    const previous=await existing(join(directory,'result.json'));
    if(previous)equal(previous.binding,binding,'Reopen the same original customer receiving operation.');
    const extractionDirectory=join(directory,'files');
    const selected=['original/source-bundle.json','original/commissioning-selection.json',
      ...Object.values(COMMISSIONING_JOB_EXPORTS).map(name=>'commissioning/'+name)];
    const archive=await verifyArchive(archiveFile,join(directory,'archive-verification.json'),python,selected,extractionDirectory);
    signal.throwIfAborted();lease.assertHeld();
    equal({bytes:archive.bytes,sha256:archive.sha256},archiveMetadata,'The original result changed during archive receiving.');
    const originalFile=join(extractionDirectory,'original/source-bundle.json'),source=await metadata(originalFile);
    if(source.bytes>WQX_COMMISSIONING_SOURCE_LIMIT)fail('KIWIS_CUSTOMER_SOURCE_CHANGED','The sealed original exceeds 128 MiB.');
    if(expectedSource)equal(source,expectedSource,'The delivered original source differs from the selected job input.');
    let originalBundle=await completeJson(originalFile,WQX_COMMISSIONING_SOURCE_LIMIT,source);
    const input=commissioningJobInput(originalBundle),identity=selectCommissioningJob(input,originalBundle);
    if(expectedRequest)equal(input,withoutFiles(expectedRequest),'The selected original job input changed.');
    verifiedManifest(archive.manifest,source,identity,input,expectedJobId,expectedDescriptor);
    const selectedRecord=await completeJson(join(extractionDirectory,'original/commissioning-selection.json'),NATIVE_LIMIT);
    equal(selectedRecord,{schema:'starforge.wqx-commissioning-job-selection.v1',...identity,
      document:originalBundle.review.review.document},'The full saved choices differ from the original selected input.');
    originalBundle=null;
    const nativeFile=join(extractionDirectory,'commissioning/complete-commissioning.json');
    let nativeBundle=await completeJson(nativeFile,NATIVE_LIMIT);
    const actualSelection=selectCommissioningJob(input,nativeBundle);
    const {bundleSha256:incomingBundleSha,...selectedIdentity}=identity;
    const {bundleSha256:exportedBundleSha,...nativeIdentity}=actualSelection;
    equal(nativeIdentity,selectedIdentity,'The native portable result changed its exact source/input/review binding.');
    const projectDirectory=join(directory,'received-project');
    let project=await openWaterQualityProject(projectDirectory),received;
    let exports;
    try{
      received=await receiveCommissioningReview({project,bundle:nativeBundle});nativeBundle=null;
      const {inputSha256,bundleSha256,...savedIdentity}=identity;
      equal(commissioningJobIdentity(received),savedIdentity,'The customer project changed the original saved commissioning review.');
      received=null;
      exports=await compareCommissioningJobExports({project,identity,manifest:archive.manifest,extractionDirectory,signal});
    }finally{await project.close();}
    signal.throwIfAborted();lease.assertHeld();
    project=await openWaterQualityProject(projectDirectory);
    let coldExports;
    try{
      received=await readCommissioningReview({project,reviewId:identity.reviewId});
      const {inputSha256,bundleSha256,...savedIdentity}=identity;
      equal(commissioningJobIdentity(received),savedIdentity,'The cold customer project changed the saved review.');
      received=null;
      coldExports=await compareCommissioningJobExports({project,identity,manifest:archive.manifest,extractionDirectory,signal});
    }finally{await project.close();}
    const result={schema:COMMISSIONING_CUSTOMER_SCHEMA,completedAt:previous?.completedAt??new Date().toISOString(),
      binding,jobId:archive.manifest.jobId,input,original:identity,
      archive:{path:archiveFile,...archiveMetadata,logicalBytes:archive.logicalBytes,members:archive.members},
      exports,coldExports,receivedProject:{directory:projectDirectory,reviewId:identity.reviewId,
        sourceId:identity.sourceId,savedSha256:identity.savedSha256,reviewSha256:identity.reviewSha256,reopened:true}};
    if(previous)equal(result,previous,'The retained complete customer receiving result changed.');
    else await writePrivateJson(join(directory,'result.json'),result,()=>lease.assertHeld());
    return {...result,reopened:Boolean(previous)};
  }finally{await lease.close();}
}

async function receiveDownloaded(download,options){
  if(download.job.functionId!=='waterQualityReview'||download.job.state!=='COMPLETED'||
      !/^application\/zip(?:;|$)/.test(download.job.result?.contentType??''))
    fail('KIWIS_CUSTOMER_JOB','Select the completed original Water Quality ZIP job.');
  const file=name=>download.artifacts.find(item=>item.name===name);
  const result=file('result.bin'),original=file('input_source.bin'),jobFile=file('job.json');
  if(!result||!original||!jobFile||download.inputs.length!==1||download.inputs[0].slot!=='source')
    fail('KIWIS_CUSTOMER_FILES','Retain the complete original job, sealed source and result files.');
  const job=await completeJson(jobFile.path,64*1024*1024,{bytes:jobFile.bytes,sha256:jobFile.sha256});
  if(job.input?.mode!=='commissioning')fail('KIWIS_CUSTOMER_MODE','Select the explicit original commissioning job.');
  const receipt=await receiveCommissioningJobResult({archiveFile:result.path,expectedArchiveSha256:result.sha256,
    directory:options.receivingDirectory,python:options.python,signal:options.signal,
    expectedJobId:download.job.id,expectedRequest:job.input,
    expectedSource:{bytes:original.bytes,sha256:original.sha256}});
  return {transport:download,commissioning:receipt};
}

/** Complete original MCP export download, followed by the same native eight-format customer receiver. */
export async function downloadCommissioningJob(options={}){
  const {downloadPaidJobExport}=await import('../../../../../stellar-forge/mcp-merchant-operator/paid-jobs-client.mjs');
  const downloaded=await downloadPaidJobExport(options);
  return receiveDownloaded(downloaded,options);
}

/** Offline full-byte MCP export reopen and the same original native customer project. */
export async function reopenCommissioningJob(options={}){
  const {reopenPaidJobExport}=await import('../../../../../stellar-forge/mcp-merchant-operator/paid-jobs-client.mjs');
  const reopened=await reopenPaidJobExport(options);
  return receiveDownloaded(reopened,options);
}

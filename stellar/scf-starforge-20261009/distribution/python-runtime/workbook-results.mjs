// MIT. Saved Workbook files, bound to the original Applications run and Python installation.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { applicationOperation, applicationOutput } from '../runtime-workspace/applications-core.mjs';
import { absolute, canonical, digest, json, need, plain, readJSON, recordId, operationId } from '../runtime-workspace/storage.mjs';
import { preparePythonApplicationCommand } from './command-binding.mjs';
import { runWorkbookReader, workbookCommandSelection } from './workbook-application.mjs';

const hash=value=>digest(json(canonical(value)));
const schema='stellar-forge.workbook-application-view.v1';
async function selectedRun(root,input) {
  recordId(input?.applicationId);operationId(input?.operationId);
  const request=await applicationOperation(root,input);
  const descriptor=request.pythonCommand,selection=workbookCommandSelection(descriptor);
  if(!selection)return null;
  need(request.command===descriptor.command && hash(request.args)===hash(descriptor.args) &&
    request.applicationId===input.applicationId && request.requestId===input.operationId,
    'WORKBOOK_RUN_CHANGED','Keep the original application and command selection.');
  const run=await readJSON(join(root,'applications',input.applicationId,'runs',input.operationId+'.json'));
  need(run.schema==='stellar-forge.application-run.v1' && run.applicationId===input.applicationId &&
    run.id===input.operationId && run.requestHash===hash({applicationId:input.applicationId,requestId:input.operationId,reviewId:run.reviewId}),
    'WORKBOOK_RUN_CHANGED');
  recordId(run.reviewId);
  const review=await readJSON(join(root,'application-reviews',run.reviewId+'.json'));
  const {id,reviewedAt,...reviewBody}=review;
  need(review.schema==='stellar-forge.application-start-review.v1' && id===run.reviewId &&
    hash(reviewBody).slice(0,24)===id && review.applicationId===input.applicationId &&
    review.applicationRevision===run.revision && hash(review.command?.pythonCommand)===hash(descriptor),
    'WORKBOOK_REVIEW_CHANGED','Reopen the original reviewed application run.');
  const workbook=review.command.workbook;
  if(workbook){
    need(workbook.schema==='stellar-forge.workbook-application-selection.v1' &&
      workbook.action===selection.action && workbook.directory===selection.directory,
      'WORKBOOK_REVIEW_CHANGED');
    for(const key of ['operation','database','archive','source_directory','recipeFile'])
      if(selection[key]!==undefined)need(workbook[key]===selection[key],'WORKBOOK_REVIEW_CHANGED');
    for(const key of ['manifest_sha256','archive_sha256'])
      if(selection[key])need(workbook[key]===selection[key],'WORKBOOK_REVIEW_CHANGED');
    if(workbook.manifest_sha256)selection.manifest_sha256=workbook.manifest_sha256;
    if(workbook.recipeSha256)selection.recipe_sha256=workbook.recipeSha256;
  }
  const native=await readJSON(join(root,'operations',input.operationId,'request.json'),true);
  if(native){
    if(native.clientRequestHash)need(native.clientRequestHash===hash(request),'WORKBOOK_NATIVE_REQUEST_CHANGED');
    else for(const key of ['operation','homeId','releaseId','applicationId','command','args','terminal','pythonCommand'])
      if(Object.hasOwn(request,key))need(hash(native[key])===hash(request[key]),'WORKBOOK_NATIVE_REQUEST_CHANGED');
  }
  const output=await applicationOutput(root,input);
  return {request,descriptor,selection,review:workbook??null,output};
}
export async function workbookApplicationResult(root,input={}) {
  const selected=await selectedRun(root,input);
  if(!selected)return {schema,available:false,applicationId:input.applicationId,operationId:input.operationId};
  const {descriptor,selection,review,output}=selected;
  const view={schema,available:true,applicationId:input.applicationId,operationId:input.operationId,
    action:selection.action,directory:selection.directory,
    command:{phase:output.phase,active:output.active,result:output.result},
    installation:{id:descriptor.installationId,sourceId:descriptor.sourceId,
      sourceCommit:descriptor.runtime.sourceCommit,sourceManifestSha256:descriptor.runtime.sourceManifestSha256},
    reviewedSelection:review?{schema:review.schema,action:review.action,directory:review.directory,
      manifest_sha256:review.manifest_sha256??null,recipeSha256:review.recipeSha256??null}:null};
  if(output.active || ['PENDING','QUEUED'].includes(output.phase))
    return {...view,state:'RUNNING',files:[],message:'The original application is still running. Its log remains attached to this operation.'};
  const prepared=await preparePythonApplicationCommand(root,descriptor);
  const verified=await runWorkbookReader(prepared.binding,selection);
  need(['NOT_CREATED','REVIEW_REQUIRED','DELIVERY_PENDING','VERIFIED'].includes(verified.state),
    'WORKBOOK_RESULT_INVALID');
  if(verified.state==='VERIFIED'){
    need(verified.action===selection.action && verified.directory===selection.directory &&
      /^[a-f0-9]{64}$/.test(verified.manifest_sha256??'') && Array.isArray(verified.files),
      'WORKBOOK_RESULT_INVALID');
    const names=new Set();
    for(const row of verified.files){
      need(plain(row) && typeof row.name==='string' && row.name && !names.has(row.name) &&
        Number.isSafeInteger(row.bytes) && row.bytes>=0 && /^[a-f0-9]{64}$/.test(row.sha256??''),
        'WORKBOOK_FILE_IDENTITY_INVALID');
      absolute(row.path);names.add(row.name);
    }
  }
  return {...view,...verified,schema};
}
export async function workbookApplicationDownload(root,input={}) {
  const {file,manifestSha256,...selected}=input;
  need(typeof file==='string' && file && file.length<=4096 &&
    /^[a-f0-9]{64}$/.test(manifestSha256??''),'WORKBOOK_DOWNLOAD_SELECTION_REQUIRED');
  const result=await workbookApplicationResult(root,selected);
  need(result.state==='VERIFIED' && result.manifest_sha256===manifestSha256,
    'WORKBOOK_DOWNLOAD_CHANGED','Inspect this original workbook again before downloading.',409);
  const artifact=result.files.find(row=>row.name===file);
  need(artifact,'WORKBOOK_FILE_UNAVAILABLE','Choose a file from the complete verified workbook.',404);
  const path=absolute(artifact.path);
  need(await realpath(path)===path,'WORKBOOK_FILE_LOCATION_CHANGED');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();
    need(before.isFile() && before.nlink===1 && !(before.mode&0o077) &&
      (process.getuid===undefined || before.uid===process.getuid()) && before.size===artifact.bytes,'WORKBOOK_FILE_CHANGED',undefined,409);
    const checksum=createHash('sha256');
    for await(const chunk of handle.createReadStream({autoClose:false,start:0}))checksum.update(chunk);
    const after=await handle.stat();
    need(checksum.digest('hex')===artifact.sha256 && before.dev===after.dev && before.ino===after.ino &&
      before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs,
      'WORKBOOK_FILE_CHANGED','The original workbook file changed during reading.',409);
    return {handle,bytes:artifact.bytes,sha256:artifact.sha256,
      file:basename(file).replace(/[^\x20-\x7e]|["\\]/g,'_'),type:artifact.mime||'application/octet-stream'};
  }catch(error){await handle.close();throw error;}
}

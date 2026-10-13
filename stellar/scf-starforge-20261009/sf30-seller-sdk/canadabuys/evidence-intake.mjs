#!/usr/bin/env node
/** Prepare, apply and resume a native CanadaBuys document intake. */
import { readFile, writeFile, access, stat } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { CanadaBuysWorkspace } from './workspace.mjs';
const [command,workspacePath,inputPath,outputPath]=process.argv.slice(2);
const hash=body=>createHash('sha256').update(body).digest('hex');
const fail=message=>{throw new Error(message);};
if(!['prepare','apply','refresh-revision'].includes(command)||!workspacePath||!inputPath||(command!=='apply'&&!outputPath))
 fail('Usage: node evidence-intake.mjs prepare WORKSPACE MANIFEST REQUEST.json | apply WORKSPACE REQUEST.json | refresh-revision WORKSPACE REQUEST.json UPDATED.json');
const directory=resolve(workspacePath);
await access(join(directory,'workspace.sqlite'));
const workspace=new CanadaBuysWorkspace(directory,{operator:'Document intake'});
try{
 const original=JSON.parse(await readFile(resolve(inputPath),'utf8'));
 if(command==='prepare'){
  if(!original||!Array.isArray(original.documents)||!original.documents.length||original.documents.length>100)
   fail('The manifest must identify 1–100 original document files.');
  let notice;
  if(original.noticeId)notice=workspace.getNotice(original.noticeId);
  else{
   if(typeof original.solicitationNumber!=='string'||!original.solicitationNumber.trim())fail('Identify the existing notice by noticeId or exact solicitationNumber.');
   const matches=workspace.view().notices.filter(row=>row.summary.solicitationNumber.trim()===original.solicitationNumber.trim());
   if(matches.length!==1)fail('The exact solicitation number must select one retained notice.');
   notice=workspace.getNotice(matches[0].id);
  }
  const documents=[],capturedAt=new Date().toISOString();
  let total=0;
  for(const item of original.documents){
   if(!item||typeof item.path!=='string'||!item.path.trim())fail('Every document needs its original local path.');
   const {path,...metadata}=item,file=resolve(dirname(resolve(inputPath)),path);
   const size=await stat(file);if(!size.isFile()||size.size>64*1024*1024)fail('Choose original files of at most 64 MiB.');
   total+=size.size;if(total>128*1024*1024)fail('The combined document set exceeds 128 MiB.');
   const body=await readFile(file),sha256=hash(body);
   if(metadata.sha256!==undefined&&metadata.sha256!==sha256)fail('Original file differs from its supplied digest: '+path);
   if(metadata.bytes!==undefined&&metadata.bytes!==body.length)fail('Original file differs from its supplied byte length: '+path);
   documents.push({title:basename(file),kind:'OTHER',sourceUrl:original.sourceUrl||'',localOrigin:file,
    capturedAt,language:'unknown',relatedNoticeIdentifiers:[notice.summary.solicitationNumber].filter(Boolean),
    ...metadata,bodyBase64:body.toString('base64'),sha256,bytes:body.length});
  }
  const request={workspaceId:workspace.metadata().id,noticeId:notice.id,expectedRevision:workspace.metadata().revision,
   commandId:original.commandId||'document-intake-'+randomUUID(),documents};
  const body=JSON.stringify(request,null,2)+'\n';
  await writeFile(resolve(outputPath),body,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({state:'PREPARED',path:resolve(outputPath),bytes:Buffer.byteLength(body),sha256:hash(body),
   workspaceId:request.workspaceId,noticeId:request.noticeId,documents:documents.length,commandId:request.commandId}));
 }else{
  if(original?.workspaceId!==workspace.metadata().id)fail('Open this prepared request in its original workspace.');
  if(command==='refresh-revision'){
   const request={...original,applyRevision:workspace.metadata().revision},body=JSON.stringify(request,null,2)+'\n';
   await writeFile(resolve(outputPath),body,{flag:'wx',mode:0o600});
   console.log(JSON.stringify({state:'SAVE_REVISION_REFRESHED',path:resolve(outputPath),commandId:request.commandId,
    expectedRevision:request.expectedRevision,applyRevision:request.applyRevision,bytes:Buffer.byteLength(body),sha256:hash(body)}));
  }else console.log(JSON.stringify(workspace.bidderDesk.intakeEvidence(original),null,2));
 }
}finally{workspace.close();}

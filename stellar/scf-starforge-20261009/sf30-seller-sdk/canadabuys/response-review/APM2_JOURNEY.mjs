// MIT. Join the response-return workflow to the one original saved APM2 customer.
import { readFile, open, rename, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonical, failure } from '../core.mjs';
import { getResponseReview } from './workspace.mjs';
import { runResponseReviewJourney } from './OPERATING_JOURNEY.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
async function retain(path,body){
 const bytes=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body,null,2)+'\n');
 const temporary=path+'.'+randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);
 try{await file.writeFile(bytes);await file.sync();await file.close();await rename(temporary,path);}
 catch(error){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
 return {path,bytes:bytes.length,sha256:hash(bytes)};
}
async function originalFile(info){
 need(info&&typeof info.path==='string','Keep the complete original saved artifact identity.');
 const bytes=await readFile(info.path);
 need(bytes.length===info.bytes&&hash(bytes)===info.sha256,'The retained original artifact changed: '+info.path);
 return bytes;
}
export async function continueApm2ResponseReview({page,server,receiving,bidderResponse,root}){
 need(bidderResponse?.status==='completed'&&bidderResponse.binding?.operation==='SCF-CANADABUYS-PROCUREMENT-9FCD-20261012',
  'Continue the completed original source-bound APM2 bidder response.');
 const binding=bidderResponse.binding,workspace=server.workspace,receiver=receiving.workspace;
 need(workspace.metadata().id===binding.workspaceId&&receiver.metadata().id===binding.receivingWorkspaceId,
  'Use both original saved customer workspace identities.');
 const directory=join(root,'response-review-journey');await mkdir(directory,{recursive:true,mode:0o700});
 const path=join(directory,'original-customer-result.json');
 let result;
 try{result=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(result)need(canonical(result.binding)===canonical(binding),'The retained response return belongs to a different original customer.');
 else result={schema:'starforge.canadabuys.apm2-response-return-operation.v1',binding,startedAt:new Date().toISOString(),downloads:{}};
 const save=()=>retain(path,result);
 try{
  const masterInfo=bidderResponse.downloads['response-master.json'],master=JSON.parse(await originalFile(masterInfo));
  const sourceInfo=bidderResponse.downloads['response-master.md'];
  await originalFile(sourceInfo);
  need(master.binding.noticeId===binding.noticeId&&workspace.getWorkshare(binding.workshareId).noticeId===binding.noticeId,
   'Keep the original complete response master and same saved workshare.');
  const answer=master.responses.find(value=>value.id==='industry-input')||master.responses[0];
  const input={page,baseURL:server.url,outputDirectory:directory,workspaceId:binding.workspaceId,workshareId:binding.workshareId,
   masterPath:masterInfo.path,title:'APM2 complete partner response review',
   reviewer:{name:'TJLabs internal response engineering',organization:'TJLabs',role:'Internal source and response editor'},
   review:{answerId:answer.id,
    text:answer.draft+'\n\nInternal response engineering note: preserve the original notice-derived coverage register and map each selected platform assertion to the supplier\'s actual supported-edition evidence before external approval.',
    comment:'Internal operating edition. Retain the full original response master as supporting evidence; supplier product, staffing and contractual confirmation remain authored supplier inputs.'},
   attachmentPaths:[sourceInfo.path]};
  result.status='running';await save();
  result.journey=await runResponseReviewJourney(input);await save();
  need(result.journey.phase==='COMPLETE','Complete the same hosted/offline/returned browser course.');
  // Release the caller page's large browser model before the complete native package.
  await page.goto('about:blank');globalThis.gc?.();
  const selected=getResponseReview(workspace,result.journey.record.id,{revision:result.journey.record.revision});
  need(selected.record.editionSha256===result.journey.record.editionSha256,'The completed response edition differs.');
  let packet;
  if(result.downloads.package)packet=JSON.parse(await originalFile(result.downloads.package));
  else{
   packet=workspace.exportPackage({scope:'selected',noticeIds:[binding.noticeId],expectedRevision:workspace.metadata().revision});
   const exported=packet.bidderDesk.records.find(value=>value.kind==='evidence'&&value.id===selected.record.id);
   need(exported?.headRevision===selected.record.revision&&exported.editions.at(-1).editionSha256===selected.record.editionSha256,
    'The current response advanced before its selected package was frozen.');
   result.downloads.package=await retain(join(directory,'response-review-workspace.json'),packet);result.packageId=packet.packageId;await save();
  }
  need(packet.workspace.id===binding.workspaceId&&packet.packageId===result.packageId,'The retained package belongs to another original source.');
  const expectedRecords=[selected.record,result.journey.receipt.returnedRecord];
  for(const record of expectedRecords){
   const exported=packet.bidderDesk.records.find(value=>value.kind==='evidence'&&value.id===record.id);
   need(exported?.editions[record.revision-1]?.editionSha256===record.editionSha256,'The selected complete response/return edition is missing from its package.');
  }
  const received=receiver.receivePackage(packet,{expectedRevision:receiver.metadata().revision});
  result.receiving=received;await save();
  const receipt=received.receiving;
  const issues={bidderStatus:receipt.bidderDesk?.status,bidderConflicts:receipt.bidderDesk?.conflicts||[],
   reviewConflicts:(receipt.reviewConflicts||[]).filter(x=>x.noticeId===binding.noticeId),
   workshareConflicts:(receipt.workshareConflicts||[]).filter(x=>x.workshareId===binding.workshareId)};
  if(issues.bidderStatus!=='RECEIVED'||issues.bidderConflicts.length||issues.reviewConflicts.length||issues.workshareConflicts.length)
   throw failure('RESPONSE_RECEIVING_REVIEW','Reconcile the retained original receiving differences in this same package.',409,{packageId:packet.packageId,...issues});
  for(const expected of expectedRecords){
   const actual=receiver.bidderDesk.get('evidence',expected.id,{revision:expected.revision});
   need(actual.editionSha256===expected.editionSha256,'The received original response/return record differs.');
   const file=receiver.bidderDesk.evidenceFile(expected.id,{revision:expected.revision});
   need(file.body.byteLength===expected.bytes&&hash(file.body)===expected.sha256,'The complete received response/return bytes differ.');
  }
  const reopened=getResponseReview(receiver,selected.record.id,{revision:selected.record.revision});
  need(canonical(reopened.document)===canonical(selected.document),'The full received response, attachments or prior editions differ.');
  result.downloads.received=await retain(join(directory,'received-complete-response.json'),reopened);
  result.status='completed';result.completedAt=new Date().toISOString();result.sourceWorkspace=workspace.metadata();result.receivingWorkspace=receiver.metadata();
  result.producerInspection={status:'AWAITING_PRODUCER_VIEW',views:result.journey.views,
   instruction:'Open and LOOK at every actual desktop/narrow screenshot, the complete standalone editor, downloaded/reopened working files and attached originals. Repair observed presentation or control defects in this same operation.'};
  await save();return result;
 }catch(error){result.status='failed';result.error={message:error.message,code:error.code,details:error.details};await save();throw error;}
}

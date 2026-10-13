// SPDX-License-Identifier: MIT
// Bind the existing native InboxTask reader and customer package producer.
import {taskDeliveryRequest,inspectInboxTaskDelivery} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/inbox-task.mjs';
import {need,identity,SCHEMA as PACKAGE} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/format.mjs';
const HASH=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** Called only by trusted host registration; no remote argument names a path. */
export async function selectNativeInboxTask({taskPacketDirectory,expectedTaskSha256}){
 need(typeof taskPacketDirectory==='string'&&HASH.test(expectedTaskSha256??''),'MCP_DELIVERY_TASK_SELECTION');
 const inspection=await inspectInboxTaskDelivery({packetDirectory:taskPacketDirectory,expectedTaskSha256});
 need(inspection.schema===PACKAGE+'.task-inspection'&&inspection.task.taskSha256===expectedTaskSha256&&Array.isArray(inspection.intents),
  'MCP_DELIVERY_TASK_INSPECTION_CHANGED');
 return{directory:taskPacketDirectory,sha256:expectedTaskSha256,inspection};
}
export function nativeInboxTaskRequest(body,record){
 need(record.mode==='INBOX_TASK'&&record.task&&record.source,'MCP_DELIVERY_TASK_SENDER_REQUIRED');
 need(object(body)&&body.expectedTaskSha256===record.task.sha256,'MCP_DELIVERY_TASK_SELECTION_CHANGED');
 const selected=taskDeliveryRequest({...body,packetDirectory:record.task.directory,
  expectedTaskSha256:record.task.sha256,sourceRoot:record.source.root,sourceManifest:record.source.manifest});
 need(selected.intentIds.every(id=>record.task.inspection.intents.some(row=>row.intentId===id)),'MCP_DELIVERY_TASK_INTENT_NOT_REGISTERED');
 return selected;
}
export function publicNativeTaskRequest(value){
 const {packetDirectory,sourceRoot,sourceManifest,...safe}=value;
 return safe;
}
export function verifyNativeTaskPreview(value,selected,record){
 need(value?.schema===PACKAGE+'.task-preview'&&HASH.test(value.previewSha256??'')&&
  value.source?.sha256===record.source.sha256&&
  identity(value.request)===identity(publicNativeTaskRequest(selected))&&
  identity(value.task)===identity(record.task.inspection.task)&&Array.isArray(value.jobs)&&
  value.jobs.length===selected.intentIds.length&&
  value.jobs.every((row,index)=>row.intentId===selected.intentIds[index]&&row.output?.state==='VERIFIED'),
  'MCP_DELIVERY_TASK_PREVIEW_CHANGED');
 return value;
}

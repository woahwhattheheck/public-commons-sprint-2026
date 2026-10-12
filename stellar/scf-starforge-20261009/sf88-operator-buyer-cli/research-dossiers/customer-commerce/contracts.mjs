// MIT. Public Research delivery selections; native SF101 owns payment terms.
import {createHash} from 'node:crypto';
import {validateHandoff} from '../../../sf101-merchant-receiver/checkout-config.mjs';
import {customerUpdateDigest,customerUpdateSame} from '../customer-updates/context.mjs';
export const COMMERCE_SCHEMA='sf88-research-customer-commerce/v1';
export const PUBLICATION_SCHEMA='sf88-research-paid-publication/v1';
export const PAID_ARCHIVE_LIMIT=32*1024*1024;
export const PUBLICATION_LIMIT=1024*1024;
export const CONTROL_LIMIT=2*1024*1024;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const SHA=/^[a-f0-9]{64}$/;
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const copy=value=>structuredClone(value);
export const same=customerUpdateSame;
export const fingerprint=customerUpdateDigest;
export const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
export function fields(value,allowed,required=allowed){
 need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
  'RESEARCH_COMMERCE_FIELDS_INVALID');return value;
}
export function identifier(value){need(UUID.test(value??''),'RESEARCH_COMMERCE_REQUEST_ID_REQUIRED');return value;}
export function hash(value){need(SHA.test(value??''),'RESEARCH_COMMERCE_SHA256_REQUIRED');return value;}
export function alias(value){need(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),'RESEARCH_COMMERCE_ALIAS_REQUIRED');return value;}
export function text(value,maximum=240,{empty=false}={}){
 need(typeof value==='string'&&value.length<=(maximum)&&(!empty||value.length>=0)&&(empty||value.trim().length>0)&&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'RESEARCH_COMMERCE_TEXT_INVALID');return value;
}
export function revision(value){need(Number.isSafeInteger(value)&&value>=1,'RESEARCH_COMMERCE_REVISION_REQUIRED');return value;}
export function dossierId(value){need(typeof value==='string'&&/^d_[a-f0-9-]{36}$/.test(value),'DOSSIER_ID_INVALID');return value;}
export function nativeRecord(value){need(typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value),'RESEARCH_COMMERCE_NATIVE_RECORD_REQUIRED');return value;}
export function atomic(value){
 need(typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n,
  'RESEARCH_COMMERCE_BUYER_BUDGET_INVALID');return value;
}
export function environmentName(value){need(typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,64}$/.test(value),'RESEARCH_COMMERCE_ENVIRONMENT_NAME_INVALID');return value;}
export function phaseId(id,phase){
 identifier(id);text(phase,160);
 const h=createHash('sha256').update(id+'\n'+phase).digest('hex').slice(0,32).split('');
 h[12]='4';h[16]=(8+(parseInt(h[16],16)%4)).toString(16);
 const value=h.join('');return [value.slice(0,8),value.slice(8,12),value.slice(12,16),value.slice(16,20),value.slice(20)].join('-');
}
export function publicationRequest(input){
 fields(input,['requestId','merchant','dossierId','deliveryId','revision','title','summary','usage','sourceWorkspace'],
  ['requestId','merchant','dossierId','deliveryId','revision','title','summary','usage']);
 identifier(input.requestId);alias(input.merchant);dossierId(input.dossierId);nativeRecord(input.deliveryId);revision(input.revision);
 text(input.title,240);text(input.summary,8000,{empty:true});text(input.usage,8000,{empty:true});
 const source=input.sourceWorkspace??null;
 if(source!==null){
  fields(source,['library','actor','requestId']);
  need(/^(?:original|received-[a-f0-9]{64})$/.test(source.library??''),'RESEARCH_COMMERCE_SOURCE_LIBRARY_INVALID');
  text(source.actor,200);need(typeof source.requestId==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(source.requestId),
   'RESEARCH_COMMERCE_SOURCE_REQUEST_REQUIRED');
 }
 return {...copy(input),sourceWorkspace:source};
}
export function publicPublication(input){
 fields(input,['schema','publicationId','title','summary','usage','delivery','archive','handoff']);
 need(input.schema===PUBLICATION_SCHEMA,'RESEARCH_COMMERCE_PUBLICATION_REQUIRED');identifier(input.publicationId);
 text(input.title,240);text(input.summary,8000,{empty:true});text(input.usage,8000,{empty:true});
 const selected=input.delivery;
 fields(selected,['schema','dossierId','deliveryId','revision','manifestSha256','manifestBytes','files']);
 need(selected.schema==='sf88-research-customer-handover/v1','RESEARCH_COMMERCE_HANDOVER_REQUIRED');
 dossierId(selected.dossierId);nativeRecord(selected.deliveryId);revision(selected.revision);hash(selected.manifestSha256);
 need(Number.isSafeInteger(selected.manifestBytes)&&selected.manifestBytes>0&&selected.manifestBytes<=64*1024*1024,
  'RESEARCH_COMMERCE_MANIFEST_SIZE_INVALID');
 need(Array.isArray(selected.files)&&selected.files.length>=6&&selected.files.length<=7,
  'RESEARCH_COMMERCE_COMPLETE_HANDOVER_REQUIRED');
 const names=new Set();
 for(const file of selected.files){
  fields(file,['name','kind','format','bytes','sha256','contentType'],['name','kind','bytes','sha256','contentType']);
  need(typeof file.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(file.name)&&!names.has(file.name),
   'RESEARCH_COMMERCE_FILE_NAME_INVALID');names.add(file.name);hash(file.sha256);
  need(['report','work','dossier','europe-pmc'].includes(file.kind)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&
   file.bytes<=(file.kind==='dossier'?256*1024*1024:file.kind==='europe-pmc'?128*1024*1024:64*1024*1024),
   'RESEARCH_COMMERCE_FILE_SIZE_INVALID');
  text(file.contentType,240);if(file.format!==undefined)need(['json','csv','md','html'].includes(file.format),'RESEARCH_COMMERCE_REPORT_FORMAT_INVALID');
 }
 need(names.has('dossier.research.json.gz')&&names.has('work.review.json')&&
  selected.files.filter(file=>file.kind==='report').length===4&&
  new Set(selected.files.filter(file=>file.kind==='report').map(file=>file.format)).size===4&&
  selected.files.filter(file=>file.kind==='work'&&file.name==='work.review.json').length===1&&
  selected.files.filter(file=>file.kind==='dossier'&&file.name==='dossier.research.json.gz').length===1&&
  selected.files.filter(file=>file.kind==='europe-pmc').every(file=>file.name==='europe-pmc.workspace.json.gz'),
  'RESEARCH_COMMERCE_COMPLETE_HANDOVER_REQUIRED');
 const archive=input.archive;fields(archive,['name','bytes','sha256','contentType']);
 need(archive.name==='research-customer.handover.gz'&&archive.contentType==='application/gzip'&&
  Number.isSafeInteger(archive.bytes)&&archive.bytes>0&&archive.bytes<=PAID_ARCHIVE_LIMIT,
  'RESEARCH_COMMERCE_ARCHIVE_SIZE_INVALID');hash(archive.sha256);
 const handoff=validateHandoff(input.handoff);
 need(handoff.file.bytes===archive.bytes&&handoff.file.sha256===archive.sha256&&
  handoff.recipientBinding==='ORIGINAL_RECIPIENT_DIGEST','RESEARCH_COMMERCE_ORDER_FILE_CHANGED');
 return {...copy(input),handoff};
}
export function checkPublicationArchive(publication,archive){
 const offer=publicPublication(publication);
 need(archive.manifestSha256===offer.delivery.manifestSha256&&archive.manifestBytes===offer.delivery.manifestBytes&&
  archive.archive.bytes===offer.archive.bytes&&archive.archive.sha256===offer.archive.sha256&&
  archive.selection.dossierId===offer.delivery.dossierId&&archive.selection.delivery.id===offer.delivery.deliveryId&&
  archive.selection.revision===offer.delivery.revision&&same(archive.manifest?.files??archive.files,offer.delivery.files),
  'RESEARCH_COMMERCE_PURCHASED_HANDOVER_CHANGED');
 return offer;
}

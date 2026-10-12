// MIT. Complete quotation receiving through the original SF74 and SF97 models.
import {mkdir,lstat,realpath} from 'node:fs/promises';
import {join,dirname,resolve,isAbsolute,sep} from 'node:path';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {parseWorkspace,MAX_WORKSPACE_BYTES} from '../workspace-file.mjs';
import {operateCaseCommissioning} from '../case-commissioning.mjs';
import {MAX_MATERIAL_BYTES,commissioningFileBytes,encodeCommissioningBytes} from '../commissioning.mjs';
import {commercialContext} from '../commercial-quote.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {captureCommercialPricingSource,inspectCommercialPricingSource,canonical,jsonBytes,sha256,commercialError} from '../commercial-pricing.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {inspectBundle,restoreCostWorkspace} from '../../sf97-merchant-revenue-ops/economics/archive.mjs';

export const COMMERCIAL_RECEIVING_SOURCE_SCHEMA='stellar-forge.merchant-commercial-receiving-source.v1';
export const COMMERCIAL_PRICING_BACKUP_KIND='commercial-pricing-workspace-backup';
const ATTACHMENT_SCHEMA='stellar-forge.merchant-commercial-pricing-backup.v1';
const SOURCE_NAME='receiving-source.json',PRICING_NAME='pricing-source.json',BACKUP_NAME='pricing-workspace.tar',RECEIPT_NAME='backup-receipt.json';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const SOURCE_LIMIT=1024*1024;
const copy=value=>JSON.parse(JSON.stringify(value));
const utf8Length=value=>Buffer.byteLength(value,'utf8');
const fail=(code,message,status=422)=>{throw commercialError(code,message,status);};
const same=(left,right,code='COMMERCIAL_RECEIVING_CHANGED')=>{
  if(canonical(left)!==canonical(right))fail(code,'The selected original quotation, pricing or receiving bytes changed.',409);
};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
function fields(value,names,label){
  if(!plain(value)||Object.keys(value).some(key=>!names.includes(key)))
    fail('COMMERCIAL_RECEIVING_INPUT','Use the complete original '+label+' fields.');
}
function uuid(value,label){if(!UUID.test(value??''))fail('COMMERCIAL_RECEIVING_INPUT','Use the original '+label+' UUID.');return value;}
function hash(value,label){if(!HASH.test(value??''))fail('COMMERCIAL_RECEIVING_INPUT','Use the exact '+label+' SHA-256.');return value;}
function text(value,label,maximum=16000){
  if(typeof value!=='string'||!value.trim()||utf8Length(value)>maximum||/\0/.test(value))
    fail('COMMERCIAL_RECEIVING_INPUT','Supply '+label+' as complete text.');
  return value;
}
function absolute(value,label){
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/')
    fail('COMMERCIAL_RECEIVING_DIRECTORY','Use an absolute normalized private '+label+' path.');
  return value;
}
async function privateDirectory(path,{create=true}={}){
  absolute(path,'directory');
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path||
      process.platform!=='win32'&&(stat.mode&0o077||stat.uid!==process.getuid()))
    fail('COMMERCIAL_RECEIVING_DIRECTORY','Keep the selected directory private and without symbolic-link components.');
  return path;
}
async function optional(path,maximum=SOURCE_LIMIT){
  try{return await readPrivateFile(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function descriptor(name,bytes){return {name,bytes:bytes.length,sha256:sha256(bytes)};}
async function checkedFile(root,pin,maximum){
  if(!plain(pin)||typeof pin.name!=='string'||!Number.isSafeInteger(pin.bytes)||pin.bytes<1||!HASH.test(pin.sha256??''))
    fail('COMMERCIAL_RECEIVING_FILE','The original file descriptor is incomplete.');
  if(![PRICING_NAME,BACKUP_NAME,RECEIPT_NAME].includes(pin.name))
    fail('COMMERCIAL_RECEIVING_FILE','Use the original named receiving files.');
  const bytes=await readPrivateFile(join(root,pin.name),maximum);
  same(descriptor(pin.name,bytes),pin,'COMMERCIAL_RECEIVING_FILE_CHANGED');
  return bytes;
}
function requireBackup(result,pricing){
  if(result.descriptor?.schema!=='stellar-forge.merchant-cost-backup.v1'||result.descriptor.kind!=='WORKSPACE_BACKUP')
    fail('COMMERCIAL_WORKSPACE_BACKUP_REQUIRED','Receive the complete original pricing/cost workspace backup.');
  const inspected=inspectCommercialPricingSource(pricing);
  const files=new Map(result.manifest.files.map(file=>[file.name,file]));
  function member(name,expected){
    const actual=files.get(name);
    if(!actual||actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)
      fail('COMMERCIAL_PRICING_BACKUP_CHANGED','The workspace backup does not contain the complete selected original pricing source: '+name+'.',409);
  }
  for(const file of pricing.files){
    if(file.name==='plan.json'){
      // Original planning.download exposes its record; the original private
      // store retains that same record inside its hash envelope. Bind the
      // exact native envelope rather than comparing these two file formats.
      const record=JSON.parse(file.text),stored=jsonBytes({sha256:sha256(canonical(record)),record});
      member('scenario-plans/'+pricing.planId+'.json',descriptor('plan.json',stored));
    }else member('versions/'+pricing.version+'/'+file.name,file);
  }
  const manifest=JSON.parse(pricing.files.find(file=>file.name==='manifest.json').text),origin=manifest.costOrigin??null;
  if(origin){
    if(origin.schema!=='stellar-forge.merchant-cost-pricing-origin.v1'||!UUID.test(origin.edition??'')||
        !HASH.test(origin.editionRevision??'')||!Array.isArray(origin.originalSourceBindings))
      fail('COMMERCIAL_COST_ORIGIN_CHANGED','The selected pricing version has an incomplete original cost binding.');
    const native=files.get('economics/books/editions/'+origin.edition+'/manifest.json');
    if(!native||native.sha256!==origin.editionRevision)
      fail('COMMERCIAL_COST_EDITION_MISSING','The complete original cost edition is absent from the selected backup.');
    for(const name of ['supplier-cost-provenance.json','supplier-cost-input.json','supplier-cost-report.json','supplier-cost-proposal.json']){
      const pin=manifest.files?.[name];
      if(!pin)fail('COMMERCIAL_COST_ORIGIN_CHANGED','The selected pricing manifest omits its original '+name+'.');
      member('versions/'+pricing.version+'/'+name,pin);
    }
    for(const source of origin.originalSourceBindings){
      uuid(source.sourceId,'supplier source');hash(source.sha256,'supplier original');hash(source.receiptSha256,'supplier receipt');
      member('economics/sources/records/'+source.sourceId+'/original',{bytes:source.bytes,sha256:source.sha256});
      const receipt=files.get('economics/sources/records/'+source.sourceId+'/source.json');
      if(!receipt||receipt.sha256!==source.receiptSha256)
        fail('COMMERCIAL_COST_ORIGIN_CHANGED','The original supplier source receipt is absent or changed.');
    }
  }
  return {pricing:inspected,costOrigin:copy(origin),snapshot:copy(result.descriptor.snapshot)};
}
/** Read-only verification of the four immutable files written by capture below. */
export async function inspectCommercialReceivingSource({directory,expectedSourceSha256}={}){
  const root=await privateDirectory(absolute(directory,'source'),{create:false});
  const bytes=await readPrivateFile(join(root,SOURCE_NAME),SOURCE_LIMIT),value=JSON.parse(decode(bytes));
  if(expectedSourceSha256!==undefined&&sha256(bytes)!==hash(expectedSourceSha256,'receiving source'))
    fail('COMMERCIAL_RECEIVING_SOURCE_CHANGED','The original receiving selection differs from its reviewed file.',409);
  fields(value,['schema','request','pricing','files','backup','costOrigin'],'receiving source');
  if(value.schema!==COMMERCIAL_RECEIVING_SOURCE_SCHEMA)fail('COMMERCIAL_RECEIVING_SOURCE','Use the native quotation receiving source.');
  fields(value.request,['planId','scenarioId','backupRequestId'],'source request');
  uuid(value.request.planId,'plan');uuid(value.request.backupRequestId,'backup request');
  if(value.request.scenarioId!==null&&typeof value.request.scenarioId!=='string')fail('COMMERCIAL_RECEIVING_SOURCE','Keep the original scenario selection.');
  if(!Array.isArray(value.files)||value.files.length!==3||new Set(value.files.map(x=>x.name)).size!==3)
    fail('COMMERCIAL_RECEIVING_FILES','Keep all three original pricing/backup/receipt files.');
  const byName=new Map(value.files.map(file=>[file.name,file]));
  const pricingBytes=await checkedFile(root,byName.get(PRICING_NAME),MAX_MATERIAL_BYTES);
  const receiptBytes=await checkedFile(root,byName.get(RECEIPT_NAME),SOURCE_LIMIT);
  const pricing=JSON.parse(decode(pricingBytes)),receipt=JSON.parse(decode(receiptBytes));
  inspectCommercialPricingSource(pricing);
  same(value.pricing,{sourceId:pricing.id,planId:pricing.planId,scenarioId:pricing.scenarioId,version:pricing.version});
  if(value.request.planId!==pricing.planId||value.request.scenarioId!==null&&value.request.scenarioId!==pricing.scenarioId)
    fail('COMMERCIAL_RECEIVING_SOURCE_CHANGED','The retained source belongs to another selected plan or scenario.',409);
  const backupPin=byName.get(BACKUP_NAME);
  if(!backupPin||backupPin.name!==BACKUP_NAME||backupPin.bytes>MAX_MATERIAL_BYTES)
    fail('COMMERCIAL_RECEIVING_LIMIT','This inline source needs the original backup within the 48 MiB material limit. Keep larger sources in the native source-bundle workflow.');
  const archivePath=join(root,BACKUP_NAME),archiveStat=await lstat(archivePath);
  if(!archiveStat.isFile()||archiveStat.isSymbolicLink()||archiveStat.size!==backupPin.bytes||
      await realpath(archivePath)!==archivePath||process.platform!=='win32'&&(archiveStat.mode&0o077||archiveStat.uid!==process.getuid()))
    fail('COMMERCIAL_RECEIVING_FILE','Keep the selected complete backup as an owned private regular file.');
  const backup=await inspectBundle(archivePath);
  same({name:BACKUP_NAME,bytes:backup.bytes,sha256:backup.sha256},backupPin);
  if(receipt.schema!=='stellar-forge.merchant-cost-export-receipt.v1'||receipt.kind!=='WORKSPACE_BACKUP'||
      receipt.requestId!==value.request.backupRequestId||receipt.sha256!==backup.sha256||
      receipt.bytes!==backup.bytes||receipt.fileCount!==backup.fileCount||
      backup.descriptor.requestId!==receipt.requestId||backup.descriptor.requestSha256!==receipt.requestSha256)
    fail('COMMERCIAL_BACKUP_RECEIPT_CHANGED','The original workspace backup and export receipt differ.');
  const inspected=requireBackup(backup,pricing);
  same(value.backup,{requestId:receipt.requestId,bytes:backup.bytes,sha256:backup.sha256,fileCount:backup.fileCount,
    snapshot:inspected.snapshot,createdAt:receipt.createdAt});
  same(value.costOrigin,inspected.costOrigin);
  return {schema:COMMERCIAL_RECEIVING_SOURCE_SCHEMA,state:'SOURCE_READY',directory:root,
    sourceSha256:sha256(bytes),source:value,pricingSource:pricing,pricingText:decode(pricingBytes),
    pricingFile:byName.get(PRICING_NAME),backupFile:backupPin,backupReceipt:receipt,
    pricing:inspected.pricing,costOrigin:inspected.costOrigin};
}
/** Capture an existing saved plan and original full backup. No source request or pricing save occurs. */
export async function captureCommercialReceivingSource({model,planning,planId,scenarioId,backupRequestId,directory}={}){
  uuid(planId,'plan');uuid(backupRequestId,'backup request');
  const root=await privateDirectory(absolute(directory,'source'));
  const request={planId,scenarioId:scenarioId??null,backupRequestId};
  const prior=await optional(join(root,SOURCE_NAME));
  if(prior){
    same(JSON.parse(decode(prior)).request,request,'COMMERCIAL_RECEIVING_REQUEST_CHANGED');
    return {...await inspectCommercialReceivingSource({directory:root}),replayed:true};
  }
  if(!model?.economics?.bundle||!model?.economics?.exportFile)
    fail('COMMERCIAL_PRICING_WORKSPACE_REQUIRED','Open the original saved pricing and cost workspace.');
  // Retain the selected pricing file before the original backup. A later edited
  // plan or different scenario cannot replace an interrupted capture selection.
  const pricingSource=await captureCommercialPricingSource({model,planning,planId,scenarioId});
  const pricingBytes=jsonBytes(pricingSource);
  await retainCaseArtifact(join(root,PRICING_NAME),pricingBytes);
  const backupReceipt=await model.economics.bundle({kind:'WORKSPACE_BACKUP',requestId:backupRequestId});
  const selected=await model.economics.exportFile(backupRequestId);
  if(selected.bytes>MAX_MATERIAL_BYTES)
    fail('COMMERCIAL_RECEIVING_LIMIT','The original backup exceeds the inline 48 MiB material limit. Its complete native export remains available to the source-bundle workflow.');
  const inspected=await inspectBundle(selected.path),binding=requireBackup(inspected,pricingSource);
  same({bytes:inspected.bytes,sha256:inspected.sha256,fileCount:inspected.fileCount},
    {bytes:backupReceipt.bytes,sha256:backupReceipt.sha256,fileCount:backupReceipt.fileCount});
  const backupBytes=await readPrivateFile(selected.path,MAX_MATERIAL_BYTES);
  same({bytes:backupBytes.length,sha256:sha256(backupBytes)},{bytes:inspected.bytes,sha256:inspected.sha256});
  await retainCaseArtifact(join(root,BACKUP_NAME),backupBytes);
  const receiptBytes=jsonBytes(backupReceipt);await retainCaseArtifact(join(root,RECEIPT_NAME),receiptBytes);
  const source={schema:COMMERCIAL_RECEIVING_SOURCE_SCHEMA,request,
    pricing:{sourceId:pricingSource.id,planId:pricingSource.planId,scenarioId:pricingSource.scenarioId,version:pricingSource.version},
    files:[descriptor(PRICING_NAME,pricingBytes),descriptor(BACKUP_NAME,backupBytes),descriptor(RECEIPT_NAME,receiptBytes)],
    backup:{requestId:backupReceipt.requestId,bytes:inspected.bytes,sha256:inspected.sha256,fileCount:inspected.fileCount,
      snapshot:binding.snapshot,createdAt:backupReceipt.createdAt},costOrigin:binding.costOrigin};
  await retainCaseArtifact(join(root,SOURCE_NAME),jsonBytes(source));
  return {...await inspectCommercialReceivingSource({directory:root}),replayed:false};
}
async function caseContext({store,id,revision,workspaceId}){
  uuid(id,'case');if(revision!==undefined)hash(revision,'case revision');
  const record=await store.read(id,revision),workspace=await parseWorkspace(record.workspaceText);
  const context=await commercialContext(workspace,{caseId:id,workspaceId,revision:record.revision});
  return {record,workspace,context};
}
function materialBinding(material){
  if(material.kind!==COMMERCIAL_PRICING_BACKUP_KIND)return null;
  const value=JSON.parse(material.description);
  fields(value,['schema','sourceSha256','pricing','backup','costOrigin','bindingReason','pricingRequestId','attachmentRequestId'],'pricing backup');
  if(value.schema!==ATTACHMENT_SCHEMA||material.id!=='commercial-backup:'+value.attachmentRequestId||
      material.sha256!==value.backup?.sha256||material.reference!=='urn:stellar-forge:commercial-pricing:'+value.pricing?.sourceId)
    fail('COMMERCIAL_PRICING_BACKUP_CHANGED','The retained pricing backup material differs from its original binding.');
  uuid(value.attachmentRequestId,'attachment request');uuid(value.pricingRequestId,'pricing request');
  hash(value.sourceSha256,'receiving source');hash(value.pricing.sourceId,'pricing source');text(value.bindingReason,'merchant/source binding reason',4000);
  return value;
}
function backupFor(context,pricingSourceId,expectedArchiveSha256){
  const values=context.state.materials.filter(row=>row.kind===COMMERCIAL_PRICING_BACKUP_KIND)
    .map(material=>({material,binding:materialBinding(material)}))
    .filter(row=>row.binding.pricing.sourceId===pricingSourceId&&
      (expectedArchiveSha256===undefined||row.material.sha256===expectedArchiveSha256));
  if(values.length!==1)fail('COMMERCIAL_PRICING_BACKUP_SELECTION',
    values.length?'Select the exact archive SHA-256 when this original pricing source has multiple retained backups.':
      'Attach the complete original pricing/cost backup for this selected pricing source.',409);
  return values[0];
}
/** Append two native original documents with their separately retained request IDs. */
export async function attachCommercialReceivingSource({store,casesDirectory,id,expectedRevision,pricingRequestId,
  attachmentRequestId,actor,bindingReason,directory,expectedSourceSha256}={}){
  uuid(id,'case');uuid(pricingRequestId,'pricing request');uuid(attachmentRequestId,'attachment request');
  if(pricingRequestId===attachmentRequestId)fail('COMMERCIAL_RECEIVING_REQUEST','Keep distinct original pricing and attachment request UUIDs.');
  hash(expectedRevision,'reviewed case revision');hash(expectedSourceSha256,'reviewed receiving source');
  text(actor,'operator',200);text(bindingReason,'matching merchant/source review',4000);
  const cases=await privateDirectory(absolute(casesDirectory,'case'),{create:false});
  store=store??await openCaseStore(cases);
  const source=await inspectCommercialReceivingSource({directory,expectedSourceSha256});
  const commercial=openCaseCommercial({store,workspaceId:commercialWorkspaceId(cases)});
  const priced=await commercial.receivePricing({id,expectedRevision,requestId:pricingRequestId,actor,
    sourceText:source.pricingText,sourceSha256:source.pricingFile.sha256});
  const current=await caseContext({store,id,workspaceId:commercialWorkspaceId(cases)});
  if(!current.context.pricingSources.some(row=>row.id===source.source.pricing.sourceId))
    fail('COMMERCIAL_PRICING_SOURCE_MISSING','Reopen the original saved pricing receive before attaching its backup.');
  const binding={schema:ATTACHMENT_SCHEMA,sourceSha256:source.sourceSha256,pricing:source.source.pricing,
    backup:source.source.backup,costOrigin:source.costOrigin,bindingReason,pricingRequestId,attachmentRequestId};
  const retained=current.context.state.materials.find(row=>row.id==='commercial-backup:'+attachmentRequestId);
  if(retained)same(materialBinding(retained),binding,'COMMERCIAL_RECEIVING_REQUEST_CHANGED');
  const bytes=await readPrivateFile(join(source.directory,BACKUP_NAME),MAX_MATERIAL_BYTES);
  same({bytes:bytes.length,sha256:sha256(bytes)},{bytes:source.backupFile.bytes,sha256:source.backupFile.sha256});
  const command={type:'add_material',requestId:attachmentRequestId,actor,
    expectedRevision:current.context.state.revision,recordedAt:source.backupReceipt.createdAt,payload:{
      id:'commercial-backup:'+attachmentRequestId,name:'pricing-workspace-'+source.backupReceipt.requestId+'.tar',
      mediaType:'application/x-tar',data:encodeCommissioningBytes(bytes),kind:COMMERCIAL_PRICING_BACKUP_KIND,
      description:canonical(binding),taskIds:[],editionId:retained?.editionId??current.context.state.activeEditionId,
      reference:'urn:stellar-forge:commercial-pricing:'+source.source.pricing.sourceId}};
  const attached=await operateCaseCommissioning(store,{id,expectedRevision:current.record.revision,command});
  const reopened=await caseContext({store,id,workspaceId:commercialWorkspaceId(cases)});
  const selected=backupFor(reopened.context,source.source.pricing.sourceId,source.backupFile.sha256);
  same(materialBinding(selected.material),binding);
  return {schema:ATTACHMENT_SCHEMA,state:'ATTACHED',case:{id,revision:reopened.record.revision},
    pricingSourceId:source.source.pricing.sourceId,sourceSha256:source.sourceSha256,
    archiveSha256:selected.material.sha256,materialId:selected.material.id,
    pricingRequestId,attachmentRequestId,pricingReplayed:priced.replayed===true,attachmentReplayed:attached.replayed===true,
    costOrigin:copy(source.costOrigin)};
}
function selectQuote(context,quoteId,quoteSha256){
  uuid(quoteId,'quote');hash(quoteSha256,'quote');
  const quote=context.quotes.find(row=>row.id===quoteId);
  if(!quote||quote.sha256!==quoteSha256)fail('COMMERCIAL_RECEIVING_QUOTE_CHANGED','Select the exact original saved quotation edition.',409);
  return quote;
}
function selectedCommercial(context,quote,{archiveSha256,requirePricingBackup=true}={}){
  if(archiveSha256!==undefined)hash(archiveSha256,'pricing backup');
  const selected=quote.sourceBindings.pricing;
  let backup=null;
  if(selected){
    const pricing=context.pricingSources.find(row=>row.id===selected.id);
    if(!pricing)fail('COMMERCIAL_PRICING_SOURCE_MISSING','The selected quote is missing its original pricing source.');
    same(pricing.source.files.map(({name,bytes,sha256})=>({name,bytes,sha256})),selected.files);
    if(requirePricingBackup)backup=backupFor(context,selected.id,archiveSha256);
    else{
      try{backup=backupFor(context,selected.id,archiveSha256);}
      catch(error){if(error.code!=='COMMERCIAL_PRICING_BACKUP_SELECTION')throw error;}
    }
  }else if(archiveSha256!==undefined)fail('COMMERCIAL_RECEIVING_QUOTE_CHANGED','This quotation has no selected pricing scenario.');
  return {quote:{id:quote.id,sha256:quote.sha256,title:quote.title,originCaseId:quote.originCaseId,
      parentId:quote.parentId,createdAt:quote.createdAt,totals:copy(quote.totals),receiving:copy(quote.receiving)},
    pricing:selected?{sourceId:selected.id,planId:selected.planId,scenarioId:selected.scenarioId,version:selected.version}:null,
    backup:backup?{materialId:backup.material.id,sha256:backup.material.sha256,bytes:backup.binding.backup.bytes,
      requestId:backup.binding.backup.requestId,sourceSha256:backup.binding.sourceSha256,
      costOrigin:copy(backup.binding.costOrigin),bindingReason:backup.binding.bindingReason}:null};
}
export async function inspectCommercialCase({store,casesDirectory,id,revision,quoteId,quoteSha256,archiveSha256,
  requirePricingBackup=true}={}){
  const cases=await privateDirectory(absolute(casesDirectory,'case'),{create:false});
  store=store??await openCaseStore(cases);
  const selected=await caseContext({store,id,revision,workspaceId:commercialWorkspaceId(cases)});
  const quote=selectQuote(selected.context,quoteId,quoteSha256);
  return {schema:'stellar-forge.merchant-commercial-receiving-review.v1',state:'REVIEWED',
    case:{id,revision:selected.record.revision,currentRevision:selected.record.currentRevision,
      workspaceSha256:sha256(selected.record.workspaceText),supportSha256:selected.record.supportText===null?null:sha256(selected.record.supportText)},
    ...selectedCommercial(selected.context,quote,{archiveSha256,requirePricingBackup})};
}
/** Use the existing full case/history/native-source exporter. Its own request is authoritative. */
export async function exportCommercialCasePackage({store,casesDirectory,id,revision,quoteId,quoteSha256,archiveSha256,
  directory,exportId,sourceDelivery,generatedAt,python,environment,signal}={}){
  const review=await inspectCommercialCase({store,casesDirectory,id,revision,quoteId,quoteSha256,archiveSha256});
  const {exportCaseSourcePackage}=await import('../case-source-package.mjs');
  const result=await exportCaseSourcePackage({store:store??await openCaseStore(casesDirectory),casesDirectory,id,
    revision:review.case.revision,directory,exportId,sourceDelivery,generatedAt,python,environment,signal});
  same(result.case,review.case&&{id,revision:review.case.revision,workspaceSha256:review.case.workspaceSha256,supportSha256:review.case.supportSha256});
  return {schema:'stellar-forge.merchant-commercial-package.v1',state:'COMPLETE',casePackage:result,
    selection:{quoteId:review.quote.id,quoteSha256:review.quote.sha256,archiveSha256:review.backup?.sha256??null},
    review};
}
async function selectedPackage({directory,expectedManifestSha256,quoteId,quoteSha256,archiveSha256}){
  const root=await privateDirectory(absolute(directory,'package'),{create:false});
  const manifestBytes=await readPrivateFile(join(root,'case-source-package.json'),64*1024*1024);
  if(sha256(manifestBytes)!==hash(expectedManifestSha256,'complete case package'))
    fail('COMMERCIAL_CASE_PACKAGE_CHANGED','The complete original case package differs from its selected manifest.',409);
  const manifest=JSON.parse(decode(manifestBytes));
  if(manifest.schema!=='stellar-forge.merchant-case-source-package.v1'||!Array.isArray(manifest.files))
    fail('COMMERCIAL_CASE_PACKAGE_REQUIRED','Use the original complete case and source package.');
  const workspaceFile=manifest.files.find(row=>row.name==='merchant-workspace.json');
  if(!workspaceFile)fail('COMMERCIAL_CASE_PACKAGE_REQUIRED','The selected original workspace is absent.');
  const bytes=await readPrivateFile(join(root,'merchant-workspace.json'),MAX_WORKSPACE_BYTES);
  same({bytes:bytes.length,sha256:sha256(bytes)},{bytes:Number(workspaceFile.bytes),sha256:workspaceFile.sha256});
  if(sha256(bytes)!==manifest.case.workspaceSha256)fail('COMMERCIAL_CASE_PACKAGE_CHANGED','The selected workspace differs from the original case.');
  const workspace=await parseWorkspace(decode(bytes));
  const context=await commercialContext(workspace,{caseId:manifest.case.id,revision:manifest.case.revision,
    workspaceId:'received-package:'+expectedManifestSha256});
  const quote=selectQuote(context,quoteId,quoteSha256);
  return {manifest,selection:selectedCommercial(context,quote,{archiveSha256}),directory:root};
}
/** Receive once through the original complete-package importer and preserve its native local identity. */
export async function receiveCommercialCasePackage({directory,receivingDirectory,casesDirectory,sourceDelivery,
  requestId,actor,expectedManifestSha256,quoteId,quoteSha256,archiveSha256,python,environment,signal}={}){
  const receiving=await privateDirectory(absolute(receivingDirectory,'receiving'));
  const prior=await optional(join(receiving,'package','case-source-package.json'),64*1024*1024);
  const input=prior?join(receiving,'package'):directory;
  const selected=await selectedPackage({directory:input,expectedManifestSha256,quoteId,quoteSha256,archiveSha256});
  const request={schema:'stellar-forge.merchant-commercial-case-receiving.v1',requestId,actor,
    expectedManifestSha256,quoteId,quoteSha256,archiveSha256:selected.selection.backup?.sha256??null};
  text(requestId,'original case receiving request',128);text(actor,'receiving operator',200);
  await retainCaseArtifact(join(receiving,'commercial-selection.json'),jsonBytes(request));
  const {receiveCaseSourcePackage}=await import('../case-source-package.mjs');
  const result=await receiveCaseSourcePackage({directory,receivingDirectory:receiving,casesDirectory,sourceDelivery,
    requestId,actor,expectedManifestSha256,python,environment,signal});
  same(result.sourceCase,selected.manifest.case);
  const review=await inspectCommercialCase({casesDirectory,id:result.case.id,revision:result.case.importedRevision,
    quoteId,quoteSha256,archiveSha256:request.archiveSha256??undefined});
  same(review.quote,selected.selection.quote);
  same(review.pricing,selected.selection.pricing);
  same(review.backup,selected.selection.backup);
  return {schema:request.schema,state:'COMPLETE',requestId,caseReceiving:result,review,
    originalCaseHistory:result.originalCaseHistory,
    next:review.backup?{action:'restore-pricing',caseId:result.case.id,caseRevision:result.case.importedRevision,
      quoteId,quoteSha256,archiveSha256:review.backup.sha256}:null};
}
/** Restore the archive already carried by the quotation case, then reopen its same native plan and cost sources. */
export async function restoreCommercialPricingWorkspace({store,casesDirectory,id,revision,quoteId,quoteSha256,
  archiveSha256,archive,directory}={}){
  const cases=await privateDirectory(absolute(casesDirectory,'case'),{create:false});
  const target=absolute(directory,'pricing restoration'),archiveFile=absolute(archive,'archive');
  if(target===archiveFile||archiveFile.startsWith(target+sep))
    fail('COMMERCIAL_RESTORE_DIRECTORY','Keep the retained archive outside its original restore destination.');
  await privateDirectory(dirname(archiveFile));await privateDirectory(dirname(target));
  store=store??await openCaseStore(cases);
  const current=await caseContext({store,id,revision,workspaceId:commercialWorkspaceId(cases)});
  const quote=selectQuote(current.context,quoteId,quoteSha256);
  const selected=selectedCommercial(current.context,quote,{archiveSha256});
  if(!selected.pricing||!selected.backup)fail('COMMERCIAL_PRICING_BACKUP_REQUIRED','Select a quotation with its original retained pricing backup.');
  const pricing=current.context.pricingSources.find(row=>row.id===selected.pricing.sourceId);
  const item=backupFor(current.context,selected.pricing.sourceId,selected.backup.sha256);
  const bytes=Buffer.from(commissioningFileBytes(current.context.state,item.material.sha256));
  same({bytes:bytes.length,sha256:sha256(bytes)},{bytes:selected.backup.bytes,sha256:selected.backup.sha256});
  await retainCaseArtifact(archiveFile,bytes);
  const original=await inspectBundle(archiveFile);const verified=requireBackup(original,pricing.source);
  const restored=await restoreCostWorkspace({archive:archiveFile,directory:target,expectedArchiveSha256:selected.backup.sha256});
  const {openWorkspace}=await import('../../sf97-merchant-revenue-ops/workspace/model.mjs');
  const {openPlanningWorkspace}=await import('../../sf97-merchant-revenue-ops/planning/workspace.mjs');
  const manifest=JSON.parse(pricing.source.files.find(file=>file.name==='manifest.json').text);
  const sourceFile=manifest.sourceFile??'snapshot.json',versionRoot=join(target,'versions',pricing.source.version);
  const model=await openWorkspace({config:join(versionRoot,'seller.json'),directory:target,
    ...(sourceFile==='history.json'?{history:join(versionRoot,sourceFile)}:{snapshot:join(versionRoot,sourceFile)})});
  const planning=await openPlanningWorkspace({model,directory:target});
  const reopened=await captureCommercialPricingSource({model,planning,planId:pricing.source.planId,scenarioId:pricing.source.scenarioId});
  same(reopened,pricing.source,'COMMERCIAL_RESTORED_PRICING_CHANGED');
  let costEdition=null;
  if(verified.costOrigin){
    const cost=await model.economics.edition(verified.costOrigin.edition);
    if(cost.revision!==verified.costOrigin.editionRevision)fail('COMMERCIAL_RESTORED_COST_CHANGED','The restored original cost edition differs.');
    same(cost.binding.sources,verified.costOrigin.originalSourceBindings);
    for(const ref of cost.binding.sources){
      const source=await model.economics.sourceDownload(ref.sourceId);
      same({bytes:source.bytes.length,sha256:sha256(source.bytes)},{bytes:ref.bytes,sha256:ref.sha256});
    }
    costEdition={edition:cost.edition,revision:cost.revision,sourcePricingVersion:cost.pricingVersion,
      sourceCount:cost.binding.sources.length,basis:verified.costOrigin.basis};
  }
  return {schema:'stellar-forge.merchant-commercial-pricing-restored.v1',state:'COMPLETE',
    case:{id,revision:current.record.revision},quoteId,quoteSha256,pricingSourceId:reopened.id,
    planId:reopened.planId,scenarioId:reopened.scenarioId,version:reopened.version,
    archive:{path:archiveFile,bytes:original.bytes,sha256:original.sha256},restored,costEdition,
    source:{config:join(versionRoot,'seller.json'),[sourceFile==='history.json'?'history':'snapshot']:join(versionRoot,sourceFile),directory:target}};
}

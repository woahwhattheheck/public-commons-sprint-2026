// MIT. Customer-template receiving over the original merchant/accountant source.
import {randomUUID} from 'node:crypto';
import {validateHandoff,validateRevision,inspectHandoff,renderCsv,parseReturnCsv,accountantColumns} from './engine.mjs';
import {freezeAccountantAdjustments} from './adjustments.mjs';
import {validateAdjustment} from '../adjustments.mjs';
import {indexOriginalVerifications} from '../reconcile.mjs';
import {
  CryptoworthError,cwCheck as check,cwObject as object,cwHash as hash,cwCanonical as canonical,cwJson as json,cwSeal as seal,cwVerify as verify,
  cwText as text,cwId as id,cwInstant as instant,cwDecode as decode,cwUtf8 as utf8,cwColumns as columns,cwDateMapping as dateMapping,cwScale as scale,
  cwFormatDate as formatDate,cwReadDate as readDate,atomicToCryptoworth,cryptoworthToAtomic,inspectCryptoworthTemplate,readCryptoworthCsv,writeCryptoworthCsv,
} from './cryptoworth-csv.mjs';
export * from './cryptoworth-csv.mjs';
export const CRYPTOWORTH_PROFILE_SCHEMA='stellar-forge.cryptoworth-profile.v1';
export const CRYPTOWORTH_SOURCE_SCHEMA='stellar-forge.cryptoworth-source.v1';
export const CRYPTOWORTH_PLAN_SCHEMA='stellar-forge.cryptoworth-plan.v1';
export const CRYPTOWORTH_CAPTURE_SCHEMA='stellar-forge.cryptoworth-capture.v1';
export const CRYPTOWORTH_DOCS=Object.freeze([
  {name:'Native template and manual import',url:'https://help.cryptoworth.com/en/articles/10396994-how-to-bulk-import-manual-transactions'},
  {name:'Chain-specific Crypto IDs',url:'https://help.cryptoworth.com/en/articles/10426331-how-to-find-the-crypto-id'},
  {name:'Native input-format and selected-column exports',url:'https://help.cryptoworth.com/en/articles/13141713-how-to-export-transactions'},
  {name:'Rollback an original import',url:'https://help.cryptoworth.com/en/articles/10424777-how-to-roll-back-imported-transactions'},
  {name:'Historical and live migration boundary',url:'https://help.cryptoworth.com/en/articles/12327176-switching-to-cryptoworth-from-another-platform'},
]);
const copy=value=>structuredClone(value),now=()=>new Date().toISOString();
const digest=value=>hash(canonical(value)),hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const issue=(code,message,details)=>({code,message,...(details===undefined?{}:{details})});
const formatTotal=(value,scale)=>{const digits=value.toString().padStart(scale+1,'0');return scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits;};
const fileInput=value=>{const file=decode(value);return {name:file.name,dataBase64:file.bytes.toString('base64')};};
const who=value=>({id:id(value.id??randomUUID()),name:text(value.name,'name',240),actor:text(value.actor,'operator',1000),createdAt:instant(value.createdAt??now(),'creation timestamp')});
function assetKey(row){return row.network+'\n'+row.assetDigest;}
export function createCryptoworthProfile(value){
  check(object(value),'INVALID_CRYPTOWORTH_PROFILE','Provide the selected template and mapping.');
  const request={...who(value),previousProfileId:value.previousProfileId? id(value.previousProfileId):null,file:fileInput(value.file)};
  const inspection=inspectCryptoworthTemplate(request.file,{delimiter:value.delimiter}),template=inspection.template;request.delimiter=template.delimiter;
  const mapped=columns(template.headers,value.columns);
  check(!mapped.ledgerId&&!mapped.rowId,'CRYPTOWORTH_RECEIVER_ID_COLUMN','Keep receiver-generated row/ledger IDs as explicit template constants; original source IDs remain in the companion index.');
  const constants=Object.create(null);check(object(value.constants),'CRYPTOWORTH_CONSTANTS_REQUIRED','Set every otherwise unmapped template column explicitly, including empty optional columns.');
  for(const header of template.headers)if(!Object.values(mapped).includes(header)){
    check(Object.hasOwn(value.constants,header),'CRYPTOWORTH_CONSTANT_REQUIRED','Choose a value for the original optional column '+header+'.');
    constants[header]=text(value.constants[header],header,32000,true);
  }
  check(Object.keys(value.constants).every(header=>Object.hasOwn(constants,header)),'INVALID_CRYPTOWORTH_CONSTANT','Constants must belong to otherwise unmapped original columns.');
  check(object(value.target),'CRYPTOWORTH_TARGET_REQUIRED','Select the receiving entity, manual connection and merchant account.');
  const target={entityId:text(value.target.entityId,'entity ID',240),entityName:text(value.target.entityName??'','entity name',240,true),
    connectionId:text(value.target.connectionId,'manual connection ID',240),connectionName:text(value.target.connectionName??'','connection name',240,true),
    merchantAccount:text(value.target.merchantAccount,'original merchant account',240)};
  check(Array.isArray(value.assets)&&value.assets.length>0&&value.assets.length<=500,'CRYPTOWORTH_ASSET_MAPPING_REQUIRED','Map the selected native assets to their chain-specific Crypto IDs.');
  const seen=new Set(),nativeIds=new Set(),assets=value.assets.map(asset=>{
    check(object(asset)&&['stellar:testnet','stellar:pubnet'].includes(asset.network)&&hex(asset.assetDigest),'INVALID_CRYPTOWORTH_ASSET','Bind the original network and asset digest.');
    const result={network:asset.network,assetDigest:asset.assetDigest,cryptoId:text(asset.cryptoId,'native Crypto ID',240),amountType:text(asset.amountType,'native amount asset type',240),scale:scale(asset.scale)};
    check(!seen.has(assetKey(result)),'DUPLICATE_CRYPTOWORTH_ASSET','Map each native network/asset once.');seen.add(assetKey(result));
    check(!nativeIds.has(result.cryptoId),'AMBIGUOUS_CRYPTOWORTH_CRYPTO_ID','One chain-specific Crypto ID cannot identify different mapped native assets.');nativeIds.add(result.cryptoId);return result;
  });
  Object.assign(request,{target,columns:mapped,constants,date:dateMapping(value.date),assets});
  const profile=seal({schema:CRYPTOWORTH_PROFILE_SCHEMA,id:request.id,name:request.name,actor:request.actor,createdAt:request.createdAt,
    previousProfileId:request.previousProfileId,target,template,columns:mapped,constants,date:request.date,assets,docs:CRYPTOWORTH_DOCS});
  return {request,profile,previewSha256:profile.integrity.sha256};
}
export function validateCryptoworthProfile(profile){
  verify(profile,CRYPTOWORTH_PROFILE_SCHEMA);id(profile.id);
  check(Array.isArray(profile.template?.headers)&&Array.isArray(profile.assets)&&profile.assets.length>0,'INVALID_CRYPTOWORTH_PROFILE','The retained profile is incomplete.');
  columns(profile.template.headers,profile.columns);dateMapping(profile.date);
  for(const asset of profile.assets){check(hex(asset.assetDigest)&&typeof asset.cryptoId==='string','INVALID_CRYPTOWORTH_PROFILE','The retained asset mapping changed.');scale(asset.scale);}
  return profile;
}
function nativeTimestamp(value,issues){
  if(value===null||value===undefined){issues.push(issue('NATIVE_DATE_REQUIRED','Attach the actual native transfer timestamp and its source file.'));return null;}
  try{return instant(value,'native transfer timestamp');}catch{issues.push(issue('NATIVE_DATE_REQUIRED','The retained transfer date needs its complete original UTC source.'));return null;}
}
/** Frozen original handoff + original proof files, with no new network call. */
export function buildCryptoworthSource({handoff,revision=null,reportBytes,adjustmentsBytes,periodCloseBytes,proofs=[],files=[]}){
  validateHandoff(handoff);if(revision)validateRevision(handoff,revision);
  check(hash(reportBytes)===handoff.source.reportSha256,'CRYPTOWORTH_REPORT_CHANGED','Use the exact report frozen by the accountant handoff.',409);
  const report=JSON.parse(utf8(reportBytes));
  let snapshot=null;
  if(handoff.source.adjustments){
    check(adjustmentsBytes&&hash(adjustmentsBytes)===handoff.source.adjustments.sha256&&adjustmentsBytes.length===handoff.source.adjustments.bytes,'CRYPTOWORTH_ADJUSTMENTS_CHANGED','Use the selected handoff’s exact adjustment snapshot.',409);
    freezeAccountantAdjustments({adjustmentsBytes,report,source:{...handoff.source,adjustmentsSha256:handoff.source.adjustments.sha256},
      periodCloseDocument:periodCloseBytes?JSON.parse(utf8(periodCloseBytes)):undefined});
    snapshot=JSON.parse(utf8(adjustmentsBytes));
  }
  const indexed=indexOriginalVerifications(proofs.map(p=>({data:p.data,fileDigest:p.sha256}))),byDigest=new Map(proofs.map(p=>[p.sha256,p]));
  const assignments=new Map(inspectHandoff(handoff,revision).rows.map(row=>[row.rowId,Object.fromEntries(['externalStatus','externalBookRef','externalAccountCode','externalNote'].map(k=>[k,row[k]]))]));
  const adjusted=new Map((snapshot?.events??[]).map(event=>[event.original.eventId,event]));
  const rows=[];
  for(const row of handoff.rows){
    const original=row.original,issues=[],verified=original.transfer==='OFFICIAL_TRANSFER_MATCHED',retained=byDigest.get(original.transferEvidenceDigest),proof=retained?.data;
    let matched=null;
    if(verified){
      const candidates=indexed.index.get(original.network+'\n'+original.transactionFingerprint)??[];
      if(!proof||!candidates.some(p=>p.fileDigest===original.transferEvidenceDigest))issues.push(issue('ORIGINAL_PROOF_REQUIRED','Retain this payment’s original independently matched SF86 result.'));
      else{
        check(proof.network===original.network&&hash(proof.transaction)===original.transactionFingerprint&&proof.atomicAmount===original.amountAtomic&&
          hash(proof.asset)===original.assetDigest&&hash(proof.recipient)===(original.recipientDigest??original.termsRecipientDigest)&&
          hash(proof.matchingEventId)===original.matchingEventDigest,'CRYPTOWORTH_PAYMENT_PROOF_CHANGED','An original payment proof differs from its frozen event.',409);
        matched=proof;
      }
    }
    const direction=verified?'RECEIVE':null,kind=verified?'PAYMENT':'CONTEXT';
    const movementId=hash('stellar-forge.cryptoworth-movement.v1\n'+canonical(matched?
      {network:matched.network,transaction:matched.transaction,event:matched.matchingEventId,direction,asset:matched.asset,merchant:matched.recipient}:
      {network:original.network,eventId:original.eventId,kind}));
    rows.push({movementId,eventId:row.eventId,rowId:row.rowId,kind,direction,amountAtomic:original.amountAtomic,
      nativeTransferAt:matched?nativeTimestamp(matched.transferAt,issues):null,recordedAt:original.at,network:original.network,asset:matched?.asset??null,assetDigest:original.assetDigest,
      merchantAccount:matched?.recipient??null,payer:matched?.payer??null,recipient:matched?.recipient??null,transactionHash:matched?.transaction??null,
      matchingEventId:matched?.matchingEventId??null,ledger:matched?.ledger??null,adjustmentId:null,proofFile:retained?.name??null,
      issues,accountant:copy(assignments.get(row.rowId)),original:copy(original),adjustmentTotals:copy(row.adjustments??null),
      context:verified?null:{transfer:original.transfer,exception:original.exception??null}});
    for(const record of adjusted.get(row.eventId)?.adjustments??[]){
      validateAdjustment(record);const cash=record.kind==='REFUND'&&record.status==='VERIFIED',p=cash?record.verification.proof:null,problems=[];
      const key=cash?{network:p.network,transaction:p.transaction,event:p.matchingEventId,direction:'SEND',asset:p.asset,merchant:p.payer}:{adjustmentId:record.id,kind:record.kind};
      rows.push({movementId:hash('stellar-forge.cryptoworth-movement.v1\n'+canonical(key)),eventId:row.eventId,rowId:row.rowId,
        kind:cash?'REFUND':'CONTEXT',direction:cash?'SEND':null,amountAtomic:record.amountAtomic,nativeTransferAt:cash?nativeTimestamp(p.transferAt,problems):null,
        recordedAt:record.createdAt,network:original.network,asset:p?.asset??record.refundTerms?.asset??matched?.asset??null,assetDigest:original.assetDigest,
        merchantAccount:p?.payer??matched?.recipient??null,payer:p?.payer??null,recipient:p?.recipient??null,transactionHash:p?.transaction??null,
        matchingEventId:p?.matchingEventId??null,ledger:p?.ledger??null,adjustmentId:record.id,proofFile:cash?'refund-'+record.id+'.json':null,
        issues:problems,accountant:copy(assignments.get(row.rowId)),original:copy(original),adjustmentTotals:copy(row.adjustments??null),
        context:{kind:record.kind,status:record.status,effectiveAt:record.effectiveAt,reason:record.reason,reference:record.reference}});
    }
  }
  const counts=new Map();for(const row of rows)counts.set(row.movementId,(counts.get(row.movementId)??0)+1);
  for(const row of rows)row.occurrences=counts.get(row.movementId);
  // The row selector remains unambiguous even when two original delivery events
  // refer to one native movement. Import selection must choose one occurrence.
  for(const row of rows)row.selectionId=hash(row.movementId+'\n'+row.rowId+'\n'+(row.adjustmentId??'payment'));
  const groups=new Map();for(const row of rows)if(row.direction){
    const key=assetKey(row),old=groups.get(key)??{network:row.network,assetDigest:row.assetDigest,asset:row.asset,merchantAccounts:[],movements:0};
    if(row.merchantAccount&&!old.merchantAccounts.includes(row.merchantAccount))old.merchantAccounts.push(row.merchantAccount);old.movements++;groups.set(key,old);
  }
  return seal({schema:CRYPTOWORTH_SOURCE_SCHEMA,handoffId:handoff.id,handoffName:handoff.name,handoffSha256:handoff.integrity.sha256,
    accountantRevisionId:revision?.id??'initial',accountantRevisionSha256:revision?.integrity.sha256??null,
    original:copy(handoff.source),period:copy(report.period??null),dateBasis:copy(report.dateBasis??report.timeBasis??null),
    files:copy(files),assetKeys:[...groups.values()],summary:{events:handoff.rows.length,movements:rows.filter(r=>r.direction).length,
      payments:rows.filter(r=>r.kind==='PAYMENT').length,refunds:rows.filter(r=>r.kind==='REFUND').length,context:rows.filter(r=>r.kind==='CONTEXT').length,
      sourceIssues:rows.reduce((n,r)=>n+r.issues.length,0)},rows});
}
function normalizePlanRequest(value){
  const request={...who(value),profileId:id(value.profileId),handoffId:id(value.handoffId),
    accountantRevisionId:value.accountantRevisionId==='initial'?'initial':id(value.accountantRevisionId),previousPlanId:value.previousPlanId?id(value.previousPlanId):null};
  check(Array.isArray(value.decisions??[])&&(value.decisions??[]).length<=50000,'INVALID_CRYPTOWORTH_DECISIONS','Provide the selected movement decisions.');
  const seen=new Set();request.decisions=(value.decisions??[]).map(value=>{
    check(object(value)&&hex(value.movementId),'INVALID_CRYPTOWORTH_DECISION','Select an original movement.');
    const selectionId=value.selectionId??null;if(selectionId!==null)check(hex(selectionId),'INVALID_CRYPTOWORTH_SELECTION','Choose the exact source occurrence.');
    const key=selectionId??value.movementId;check(!seen.has(key),'DUPLICATE_CRYPTOWORTH_DECISION','Each source occurrence has one decision.');seen.add(key);
    check(['INCLUDE','EXCLUDE','ALREADY_IMPORTED'].includes(value.action),'INVALID_CRYPTOWORTH_DECISION','Choose Include, Exclude, or Already imported.');
    return {movementId:value.movementId,selectionId,action:value.action,reason:text(value.reason??'','decision reason',4000,value.action==='INCLUDE'),
      reference:text(value.reference??'','native history reference',2000,value.action!=='ALREADY_IMPORTED')};
  });
  check(Array.isArray(value.dateEvidence??[])&&(value.dateEvidence??[]).length<=5000,'INVALID_CRYPTOWORTH_DATE_EVIDENCE','Provide actual native date source files.');
  const dates=new Set();let bytes=0;request.dateEvidence=(value.dateEvidence??[]).map(v=>{
    check(object(v)&&hex(v.movementId)&&!dates.has(v.movementId),'INVALID_CRYPTOWORTH_DATE_EVIDENCE','Attach one date source per native movement.');dates.add(v.movementId);
    const file=fileInput(v.file);bytes+=Buffer.from(file.dataBase64,'base64').length;check(bytes<=64*1024*1024,'CRYPTOWORTH_DATE_EVIDENCE_SIZE','The complete date source selection exceeds 64 MiB.');
    return {movementId:v.movementId,transferAt:instant(v.transferAt,'source transfer timestamp'),note:text(v.note,'date source location and explanation',4000),file};
  });return request;
}
export function createCryptoworthPlan(value,{profile,source,coverage=[]}){
  validateCryptoworthProfile(profile);verify(source,CRYPTOWORTH_SOURCE_SCHEMA);const request=normalizePlanRequest(value);
  check(request.profileId===profile.id&&request.handoffId===source.handoffId&&request.accountantRevisionId===source.accountantRevisionId,'CRYPTOWORTH_SELECTION_CHANGED','Use the explicitly selected profile and original accountant revision.',409);
  const known=new Map(),bySelection=new Map();for(const row of source.rows){known.set(row.movementId,(known.get(row.movementId)??[]).concat(row));bySelection.set(row.selectionId,row);}
  for(const d of request.decisions){check(known.has(d.movementId),'UNKNOWN_CRYPTOWORTH_MOVEMENT','A decision refers to another source.');if(d.selectionId)check(bySelection.get(d.selectionId)?.movementId===d.movementId,'UNKNOWN_CRYPTOWORTH_SELECTION','A selected occurrence belongs to another movement.');else check(known.get(d.movementId).length===1,'AMBIGUOUS_CRYPTOWORTH_SELECTION','Choose the exact original source occurrence for this repeated movement.');}
  const selected=new Map(request.decisions.map(d=>[d.selectionId??known.get(d.movementId)[0].selectionId,d]));
  const evidence=new Map(request.dateEvidence.map(e=>[e.movementId,e]));for(const key of evidence.keys())check(known.has(key),'UNKNOWN_CRYPTOWORTH_DATE_SOURCE','The date evidence belongs to another movement.');
  const assetMap=new Map(profile.assets.map(a=>[assetKey(a),a])),covered=new Map(coverage.map(v=>[v.movementId,v]));
  const rows=source.rows.map(original=>{
    const row=copy(original),explicit=selected.get(row.selectionId),prior=covered.get(row.movementId);
    const decision=explicit??(prior?{movementId:row.movementId,selectionId:row.selectionId,action:'ALREADY_IMPORTED',reason:'Matched in retained native receiving history.',reference:prior.nativeImportId}:
      {movementId:row.movementId,selectionId:row.selectionId,action:'INCLUDE',reason:'',reference:''});
    const dateSource=evidence.get(row.movementId);
    if(dateSource){check(!row.nativeTransferAt||row.nativeTransferAt===dateSource.transferAt,'CRYPTOWORTH_NATIVE_DATE_CHANGED','A supplied date cannot replace the original native timestamp.',409);row.nativeTransferAt=dateSource.transferAt;row.issues=row.issues.filter(p=>p.code!=='NATIVE_DATE_REQUIRED');}
    row.dateEvidence=dateSource?{name:dateSource.file.name,sha256:hash(Buffer.from(dateSource.file.dataBase64,'base64')),note:dateSource.note}:null;
    row.decision=decision;row.coverage=prior?copy(prior):null;row.mapping=null;row.targetValues=null;row.quantity=null;row.date=null;
    if(!row.direction){row.status='CONTEXT';return row;}
    if(decision.action==='EXCLUDE'){row.status='EXCLUDED';return row;}
    if(decision.action==='ALREADY_IMPORTED'){row.status='ALREADY_IMPORTED';return row;}
    if(row.merchantAccount!==profile.target.merchantAccount)row.issues.push(issue('CRYPTOWORTH_MERCHANT_ACCOUNT','The native movement belongs to a different merchant account.'));
    const mapping=assetMap.get(assetKey(row));
    if(!mapping)row.issues.push(issue('CRYPTOWORTH_ASSET_MAPPING_REQUIRED','Choose this network/asset’s actual Crypto ID and decimal scale.'));
    if(!row.nativeTransferAt&&!row.issues.some(p=>p.code==='NATIVE_DATE_REQUIRED'))row.issues.push(issue('NATIVE_DATE_REQUIRED','Attach the actual native transfer timestamp and its source file.'));
    if(mapping&&row.nativeTransferAt){
      row.mapping=copy(mapping);row.quantity=atomicToCryptoworth(row.amountAtomic,mapping.scale);
      check(cryptoworthToAtomic(row.quantity,mapping.scale).atomic===row.amountAtomic,'CRYPTOWORTH_AMOUNT_ROUNDTRIP','The selected decimal scale changed the original atomic quantity.');
      row.date=formatDate(row.nativeTransferAt,profile.date);
      const roles={date:row.date,cryptoId:mapping.cryptoId,type:row.direction,amountOne:row.quantity,amountOneType:mapping.amountType,
        amountTwo:row.quantity,amountTwoType:mapping.amountType,transactionHash:row.transactionHash,connectionId:profile.target.connectionId,
        note:row.kind+' '+row.eventId+(row.adjustmentId?' / '+row.adjustmentId:'')};
      const values={...profile.constants};for(const [role,column]of Object.entries(profile.columns))values[column]=roles[role]??'';
      row.targetValues=values;
    }
    row.status=row.issues.length?'BLOCKED':'READY';return row;
  });
  const included=new Map();for(const row of rows)if(row.status==='READY'||row.status==='BLOCKED')included.set(row.movementId,(included.get(row.movementId)??0)+1);
  for(const row of rows)if(included.get(row.movementId)>1&&(row.status==='READY'||row.status==='BLOCKED')){row.status='BLOCKED';row.issues.push(issue('DUPLICATE_NATIVE_MOVEMENT','Choose one original occurrence of this native transfer for import.'));}
  const summary={totalRows:rows.length,ready:0,blocked:0,alreadyImported:0,excluded:0,context:0,groups:[]},totals=new Map();
  for(const row of rows){summary[({READY:'ready',BLOCKED:'blocked',ALREADY_IMPORTED:'alreadyImported',EXCLUDED:'excluded',CONTEXT:'context'})[row.status]]++;
    if(row.status==='READY'){const key=assetKey(row)+'\n'+row.direction,value=totals.get(key)??{network:row.network,assetDigest:row.assetDigest,asset:row.asset,cryptoId:row.mapping.cryptoId,direction:row.direction,scale:row.mapping.scale,rows:0,amountAtomic:0n};value.rows++;value.amountAtomic+=BigInt(row.amountAtomic);totals.set(key,value);}}
  summary.groups=[...totals.values()].map(g=>({...g,amountAtomic:g.amountAtomic.toString(),quantity:formatTotal(g.amountAtomic,g.scale)}));
  const plan=seal({schema:CRYPTOWORTH_PLAN_SCHEMA,id:request.id,name:request.name,actor:request.actor,createdAt:request.createdAt,
    previousPlanId:request.previousPlanId,profileId:profile.id,profileSha256:profile.integrity.sha256,target:copy(profile.target),handoffId:source.handoffId,
    accountantRevisionId:source.accountantRevisionId,sourceSha256:source.integrity.sha256,source:{...copy(source.original),handoffSha256:source.handoffSha256,
      accountantRevisionSha256:source.accountantRevisionSha256,period:copy(source.period),dateBasis:copy(source.dateBasis)},template:copy(profile.template),date:copy(profile.date),
    decisions:copy(request.decisions),dateEvidence:request.dateEvidence.map(r=>({movementId:r.movementId,name:r.file.name,sha256:hash(Buffer.from(r.file.dataBase64,'base64')),note:r.note,transferAt:r.transferAt})),
    coverageSha256:digest(coverage),summary,canExport:summary.ready>0&&summary.blocked===0,rows});
  return {request,plan,previewSha256:plan.integrity.sha256};
}
export function validateCryptoworthPlan(plan){
  verify(plan,CRYPTOWORTH_PLAN_SCHEMA);id(plan.id);check(Array.isArray(plan.rows)&&plan.rows.length<=50000&&hex(plan.profileSha256)&&hex(plan.sourceSha256),'INVALID_CRYPTOWORTH_PLAN','The retained plan source is incomplete.');
  check(new Set(plan.rows.map(r=>r.selectionId)).size===plan.rows.length,'DUPLICATE_CRYPTOWORTH_SOURCE','A plan repeats its original occurrence.');return plan;
}
export function cryptoworthImportCsv(plan){
  validateCryptoworthPlan(plan);check(plan.canExport,'CRYPTOWORTH_PLAN_REVIEW_REQUIRED','Resolve selected source issues before generating the native import CSV.',409);
  return writeCryptoworthCsv(plan.template.headers,plan.rows.filter(r=>r.status==='READY').map(r=>plan.template.headers.map(h=>r.targetValues[h])),plan.template);
}
export function cryptoworthSourceCsv(plan){
  validateCryptoworthPlan(plan);const headers=['selectionId','movementId','eventId','rowId','adjustmentId','kind','status','network','asset','assetDigest','merchantAccount','transactionHash',
    'matchingEventId','nativeLedger','amountAtomic','mappedQuantity','nativeTransferAt','mappedDate','recordedAt','sourcePeriod','dateBasis','decision','reason','reference','issues'];
  return writeCryptoworthCsv(headers,plan.rows.map(r=>[r.selectionId,r.movementId,r.eventId,r.rowId,r.adjustmentId,r.kind,r.status,r.network,r.asset,r.assetDigest,r.merchantAccount,r.transactionHash,
    r.matchingEventId,r.ledger,r.amountAtomic,r.quantity,r.nativeTransferAt,r.date,r.recordedAt,canonical(plan.source.period),canonical(plan.source.dateBasis),r.decision.action,r.decision.reason,r.decision.reference,r.issues.map(i=>i.code+': '+i.message).join('; ')]));
}

function normalizedLayout(value,parsed,profile){
  check(object(value)&&['INPUT_FORMAT','MAPPED_EXPORT'].includes(value.kind),'CRYPTOWORTH_EXPORT_LAYOUT_REQUIRED','Choose the actual received export layout.');
  let mapped,date;
  if(value.kind==='INPUT_FORMAT'){
    check(canonical(parsed.headers)===canonical(profile.template.headers),'CRYPTOWORTH_INPUT_HEADERS_CHANGED','The input-format export must preserve the selected template’s exact headers and order.');
    mapped=copy(profile.columns);date=copy(profile.date);
  }else{mapped=columns(parsed.headers,value.columns,{input:false});date=dateMapping(value.date);}
  const amountConvention=value.amountConvention??'UNSIGNED',amountTwoConvention=value.amountTwoConvention??'UNSIGNED',groupSeparator=value.groupSeparator??'';
  check(['UNSIGNED','SEND_NEGATIVE'].includes(amountConvention)&&['UNSIGNED','SEND_NEGATIVE'].includes(amountTwoConvention),'CRYPTOWORTH_AMOUNT_CONVENTION_REQUIRED','Choose each received amount column’s actual sign convention.');
  check(groupSeparator===''||groupSeparator===',','INVALID_CRYPTOWORTH_GROUP_SEPARATOR','Choose the actual amount grouping convention.');
  return {kind:value.kind,delimiter:parsed.delimiter,columns:mapped,date,amountConvention,amountTwoConvention,groupSeparator};
}
function normalizeCapture(value,plan,profile){
  const request={...who(value),purpose:value.purpose,file:fileInput(value.file)};
  check(['IMPORT_RETURN','BASELINE'].includes(request.purpose),'INVALID_CRYPTOWORTH_CAPTURE_PURPOSE','Choose an import return or existing native history.');
  const n=value.nativeImport;check(object(n),'CRYPTOWORTH_NATIVE_IMPORT_REQUIRED','Select the original native import and receiving target.');
  request.nativeImport={id:text(n.id,'native import/history ID',240),entityId:text(n.entityId,'received entity ID',240),connectionId:text(n.connectionId,'received connection ID',240),
    receivedAt:instant(n.receivedAt,'native capture timestamp'),reference:text(n.reference,'native history reference',2000),note:text(n.note??'','native import note',4000,true)};
  check(request.nativeImport.entityId===plan.target.entityId&&(request.purpose==='BASELINE'||request.nativeImport.connectionId===plan.target.connectionId),
    'CRYPTOWORTH_RECEIVING_TARGET_CHANGED','Select the same receiving entity and, for this import return, the selected manual connection.',409);
  const parsed=readCryptoworthCsv(Buffer.from(request.file.dataBase64,'base64'),{delimiter:value.layout?.delimiter});
  request.layout=normalizedLayout(value.layout,parsed,profile);return {request,parsed};
}
const joinKey=v=>canonical(v);
function comparableExpected(row,profile,layout,nativeImport){
  const mapping=profile.assets.find(a=>assetKey(a)===assetKey(row));
  check(mapping&&row.nativeTransferAt,'CRYPTOWORTH_EXPECTED_MAPPING_REQUIRED','This original movement needs a complete asset/date mapping before native comparison.');
  const value={date:formatDate(row.nativeTransferAt,layout.date),cryptoId:mapping.cryptoId,type:row.direction,amountAtomic:row.amountAtomic};
  if(layout.columns.amountOneType)value.amountOneType=mapping.amountType;
  if(layout.columns.amountTwo)value.amountTwoAtomic=row.amountAtomic;
  if(layout.columns.amountTwoType)value.amountTwoType=mapping.amountType;
  if(layout.columns.transactionHash)value.transactionHash=row.transactionHash;
  if(layout.columns.connectionId)value.connectionId=nativeImport.connectionId;
  return value;
}
function comparableReceived(record,parsed,profile,layout){
  check(record.values.length===parsed.headers.length,'CRYPTOWORTH_RECEIVED_ROW_LENGTH','The received row has a different number of fields from its header.');
  const raw=Object.fromEntries(parsed.headers.map((header,index)=>[header,record.values[index]])),field=role=>raw[layout.columns[role]];
  const type=field('type').toUpperCase();check(['RECEIVE','SEND','BUY','SELL'].includes(type),'CRYPTOWORTH_RECEIVED_TYPE','The received type is not a documented native transaction type.');
  check(type==='SEND'||type==='RECEIVE','CRYPTOWORTH_OTHER_MOVEMENT','A BUY or SELL is outside this selected merchant transfer mapping.');
  const cryptoId=field('cryptoId'),mapping=profile.assets.find(a=>a.cryptoId===cryptoId);check(mapping,'CRYPTOWORTH_UNKNOWN_CRYPTO_ID','The received Crypto ID has no selected chain-specific mapping.');
  const amount=cryptoworthToAtomic(field('amountOne'),mapping.scale,{groupSeparator:layout.groupSeparator,allowNegative:layout.amountConvention==='SEND_NEGATIVE'});
  check(amount.atomic!=='0'&&amount.negative===(type==='SEND'&&layout.amountConvention==='SEND_NEGATIVE'),'CRYPTOWORTH_RECEIVED_AMOUNT_SIGN','The primary received quantity differs from its selected SEND/RECEIVE sign convention.');
  const value={date:readDate(field('date'),layout.date),cryptoId,type,amountAtomic:amount.atomic};
  if(layout.columns.amountOneType)value.amountOneType=field('amountOneType');
  if(layout.columns.amountTwo){
    const second=cryptoworthToAtomic(field('amountTwo'),mapping.scale,{groupSeparator:layout.groupSeparator,allowNegative:layout.amountTwoConvention==='SEND_NEGATIVE'});
    check(second.atomic!=='0'&&second.negative===(type==='SEND'&&layout.amountTwoConvention==='SEND_NEGATIVE'),'CRYPTOWORTH_RECEIVED_SECOND_SIGN','The second received quantity differs from its selected sign convention.');value.amountTwoAtomic=second.atomic;
  }
  if(layout.columns.amountTwoType)value.amountTwoType=field('amountTwoType');
  if(layout.columns.transactionHash){const transaction=field('transactionHash');check(typeof transaction==='string'&&/^[a-fA-F0-9]{64}$/.test(transaction),'CRYPTOWORTH_RECEIVED_TRANSACTION','The mapped transaction hash must be the full native hash.');value.transactionHash=transaction.toLowerCase();}
  if(layout.columns.connectionId)value.connectionId=field('connectionId');
  const identities={ledgerId:layout.columns.ledgerId?field('ledgerId'):null,rowId:layout.columns.rowId?field('rowId'):null};
  for(const [name,idValue]of Object.entries(identities))if(idValue!==null)text(idValue,'literal native '+name,1000,true);
  return {value,raw,identities};
}
function mapGroups(items,key){
  const groups=new Map();for(const item of items){const k=key(item),values=groups.get(k)??[];values.push(item);groups.set(k,values);}return groups;
}
export function compareCryptoworthCapture(value,{profile,plan}){
  validateCryptoworthProfile(profile);validateCryptoworthPlan(plan);
  check(profile.id===plan.profileId&&profile.integrity.sha256===plan.profileSha256,'CRYPTOWORTH_PROFILE_CHANGED','Use the exact profile frozen by this plan.',409);
  const {request,parsed}=normalizeCapture(value,plan,profile),layout=request.layout,results=[],received=[],expected=[];
  const wanted=plan.rows.filter(row=>row.status==='READY'||(request.purpose==='BASELINE'&&row.status==='ALREADY_IMPORTED'));
  const base=row=>({selectionId:row.selectionId,movementId:row.movementId,eventId:row.eventId,rowId:row.rowId,kind:row.kind,direction:row.direction,amountAtomic:row.amountAtomic});
  for(const row of wanted)try{expected.push({row,value:comparableExpected(row,profile,layout,request.nativeImport)});}
    catch(error){results.push({...base(row),status:'INVALID',expected:null,received:[],changes:[],issues:[issue(error.code??'CRYPTOWORTH_EXPECTED_SOURCE',error.message)]});}
  for(const record of parsed.records){
    if(record.values.every(v=>v===''))continue;
    try{const item=comparableReceived(record,parsed,profile,layout);received.push({...item,rowNumber:record.rowNumber,lineNumber:record.lineNumber,duplicateIdentity:false});}
    catch(error){results.push({selectionId:null,movementId:null,eventId:null,rowId:null,status:'INVALID',expected:null,received:[{rowNumber:record.rowNumber,lineNumber:record.lineNumber,values:record.values}],
      changes:[],issues:[issue(error.code??'CRYPTOWORTH_RECEIVED_ROW',error.message)]});}
  }
  // Receiver IDs are opaque text. In particular ".0" and long integer strings
  // survive unchanged; no numeric coercion is used to deduplicate them.
  for(const field of ['ledgerId','rowId']){
    const groups=mapGroups(received.filter(r=>r.identities[field]),r=>request.nativeImport.connectionId+'\n'+r.identities[field]);
    for(const group of groups.values())if(group.length>1)for(const row of group)row.duplicateIdentity=true;
  }
  const exactE=mapGroups(expected,e=>joinKey(e.value)),exactR=mapGroups(received,r=>joinKey(r.value)),usedE=new Set(),usedR=new Set();
  const publicReceived=row=>({rowNumber:row.rowNumber,lineNumber:row.lineNumber,values:copy(row.raw),normalized:copy(row.value),identities:copy(row.identities)});
  const result=(e,status,rs,problems=[])=>{
    usedE.add(e.row.selectionId);for(const r of rs)usedR.add(r.rowNumber);
    const changes=status==='CHANGED'?Object.keys(e.value).filter(k=>e.value[k]!==rs[0].value[k]).map(field=>({field,expected:e.value[field],received:rs[0].value[field]})):[];
    results.push({...base(e.row),status,expected:copy(e.value),received:rs.map(publicReceived),changes,issues:problems});
  };
  for(const [key,es]of exactE){
    const rs=exactR.get(key)??[];if(!rs.length)continue;
    const status=es.length>1?'AMBIGUOUS':rs.length>1||rs.some(r=>r.duplicateIdentity)?'DUPLICATE_RECEIVED':'MATCHED';
    for(const e of es)result(e,status,rs,status==='MATCHED'?[]:[issue(status,status==='AMBIGUOUS'?'Several original native events have the same received representation. Retain event-level receiver evidence.':'The received rows repeat this movement or a native row identity.')]);
  }
  const remainingE=expected.filter(e=>!usedE.has(e.row.selectionId)),remainingR=received.filter(r=>!usedR.has(r.rowNumber));
  const anchor=v=>layout.columns.transactionHash?joinKey([v.transactionHash,v.cryptoId,v.type]):joinKey([v.date,v.cryptoId,v.type]);
  const anchorE=mapGroups(remainingE,e=>anchor(e.value)),anchorR=mapGroups(remainingR,r=>anchor(r.value));
  for(const [key,es]of anchorE){
    const rs=anchorR.get(key)??[];if(!rs.length)continue;
    if(es.length===1&&rs.length===1&&!rs[0].duplicateIdentity)result(es[0],'CHANGED',rs,[issue('CRYPTOWORTH_RECEIVED_VALUES_CHANGED','The matching native identity/date group has changed mapped values.')]);
    else for(const e of es)result(e,'AMBIGUOUS',rs,[issue('CRYPTOWORTH_RECEIVED_AMBIGUITY','Multiple received/source rows share this identity group; choose more precise native evidence.')]);
  }
  for(const e of expected)if(!usedE.has(e.row.selectionId))result(e,'MISSING',[],[issue('CRYPTOWORTH_MOVEMENT_MISSING','This selected native movement is absent from the received rows.')]);
  for(const r of received)if(!usedR.has(r.rowNumber))results.push({selectionId:null,movementId:null,eventId:null,rowId:null,status:r.duplicateIdentity?'DUPLICATE_RECEIVED':'UNEXPECTED',
    expected:null,received:[publicReceived(r)],changes:[],issues:[issue(r.duplicateIdentity?'DUPLICATE_RECEIVED':'CRYPTOWORTH_UNEXPECTED_MOVEMENT',r.duplicateIdentity?'The received native row identity repeats.':'This received movement is outside the selected import.')]});
  const counts={matched:0,changed:0,missing:0,unexpected:0,ambiguous:0,duplicateReceived:0,invalid:0};
  for(const r of results)counts[({MATCHED:'matched',CHANGED:'changed',MISSING:'missing',UNEXPECTED:'unexpected',AMBIGUOUS:'ambiguous',DUPLICATE_RECEIVED:'duplicateReceived',INVALID:'invalid'})[r.status]]++;
  const capture=seal({schema:CRYPTOWORTH_CAPTURE_SCHEMA,id:request.id,name:request.name,actor:request.actor,createdAt:request.createdAt,
    purpose:request.purpose,planId:plan.id,planSha256:plan.integrity.sha256,profileId:profile.id,profileSha256:profile.integrity.sha256,
    nativeImport:copy(request.nativeImport),layout:copy(layout),sourceFile:{name:request.file.name,sha256:parsed.sha256,bytes:parsed.bytes,headers:parsed.headers},
    checkedRoles:Object.keys(layout.columns),summary:{...counts,sourceRows:wanted.length,receivedRows:parsed.records.filter(r=>r.values.some(v=>v!=='')).length,
      blankRows:parsed.records.filter(r=>r.values.every(v=>v==='')).length,complete:Object.entries(counts).every(([k,n])=>k==='matched'||n===0)},
    rows:results});
  return {request,capture,comparison:capture,previewSha256:capture.integrity.sha256};
}
export function validateCryptoworthCapture(capture,plan){
  verify(capture,CRYPTOWORTH_CAPTURE_SCHEMA);id(capture.id);
  check(capture.planId===plan.id&&capture.planSha256===plan.integrity.sha256&&Array.isArray(capture.rows),'CRYPTOWORTH_CAPTURE_CHANGED','Use the capture frozen for this selected plan.',409);return capture;
}
export function cryptoworthComparisonCsv(capture){
  const headers=['selectionId','movementId','eventId','status','expected','receivedRowNumbers','receivedNativeIds','changedFields','issues'];
  return writeCryptoworthCsv(headers,capture.rows.map(r=>[r.selectionId,r.movementId,r.eventId,r.status,canonical(r.expected),r.received.map(x=>x.rowNumber).join(';'),
    r.received.map(x=>canonical(x.identities??{})).join(';'),canonical(r.changes),r.issues.map(i=>i.code+': '+i.message).join(';')]));
}
export function normalizeCryptoworthReturn(value){
  return {...who(value),captureId:id(value.captureId),status:value.status,bookRef:text(value.bookRef??'','external book reference',200,true),
    accountCode:value.accountCode===undefined?null:text(value.accountCode,'external account code',160,true),note:text(value.note??'','accountant note',3000,true),
    expectedParentId:value.expectedParentId? id(value.expectedParentId):null};
}
const needsEscape=value=>/^['\t\r\n]/.test(value)||/^\s*[=+\-@]/u.test(value)||(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/.test(value)&&value.replace(/\D/g,'').length>15);
const spreadsheetValue=value=>needsEscape(value)?"'"+value:value;
/** Produce the original protected return template; its own engine imports it. */
export function cryptoworthAccountantCsv({plan,capture,handoff,parent=null,request,coverage=[]}){
  validateCryptoworthPlan(plan);validateCryptoworthCapture(capture,plan);validateHandoff(handoff);if(parent)validateRevision(handoff,parent);
  check(handoff.id===plan.handoffId&&handoff.integrity.sha256===plan.source.handoffSha256,'CRYPTOWORTH_ACCOUNTANT_SOURCE_CHANGED','Open the original accountant handoff frozen by this plan.',409);
  check(['REVIEWED','BOOKED'].includes(request.status),'CRYPTOWORTH_ACCOUNTANT_STATUS_REQUIRED','Choose the accountant-reported Reviewed or Booked status.');
  check(request.status!=='BOOKED'||request.bookRef.trim().length>0,'CRYPTOWORTH_BOOK_REFERENCE_REQUIRED','A Booked return needs its actual accounting book reference.');
  const matched=new Set(capture.rows.filter(r=>r.status==='MATCHED').map(r=>r.selectionId)),covered=new Set(coverage.map(r=>r.movementId)),groups=mapGroups(plan.rows.filter(r=>r.direction),r=>r.rowId),eligible=new Set();
  for(const [rowId,rows]of groups)if(rows.length&&rows.every(r=>matched.has(r.selectionId)||(r.status==='ALREADY_IMPORTED'&&covered.has(r.movementId))))eligible.add(rowId);
  check(eligible.size>0,'CRYPTOWORTH_ACCOUNTANT_MATCH_REQUIRED','Capture all selected cash movements for at least one original source event before returning its accounting status.',409);
  const parsed=parseReturnCsv(renderCsv(handoff,parent),{columns:accountantColumns(handoff)}),assignments=new Map(inspectHandoff(handoff,parent).rows.map(r=>[r.rowId,r]));
  check(parsed.records.length===handoff.rows.length,'CRYPTOWORTH_ACCOUNTANT_TEMPLATE_CHANGED','The original accountant template row count changed.',409);
  const editNames=['externalStatus','externalBookRef','externalAccountCode','externalNote'];
  const rows=parsed.records.map((record,index)=>{
    const row=handoff.rows[index];if(!eligible.has(row.rowId))return record.values;
    const old=assignments.get(row.rowId),annotation='Cryptoworth '+capture.nativeImport.id+'; plan '+plan.id+'; capture '+capture.id;
    const note=[old.externalNote,request.note,annotation].filter(Boolean).join('\n');text(note,'combined accountant note',4000,true);
    const changes={externalStatus:request.status,externalBookRef:request.status==='BOOKED'?request.bookRef:(request.bookRef||old.externalBookRef),
      externalAccountCode:request.accountCode===null?old.externalAccountCode:request.accountCode,externalNote:note};
    return record.values.map((value,column)=>editNames.includes(parsed.headers[column])?spreadsheetValue(changes[parsed.headers[column]]):value);
  });
  return {bytes:writeCryptoworthCsv(parsed.headers,rows),summary:{eligibleEvents:eligible.size,preservedEvents:handoff.rows.length-eligible.size,selectedStatus:request.status,
    nativeImportId:capture.nativeImport.id,captureId:capture.id,planId:plan.id},eligibleRowIds:[...eligible]};
}
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function cryptoworthReviewHtml(plan,capture=null){
  validateCryptoworthPlan(plan);if(capture)validateCryptoworthCapture(capture,plan);
  const title=capture?'Cryptoworth receiving comparison':'Cryptoworth import review',body=capture?
    capture.rows.map(r=>'<tr><td>'+html(r.status)+'</td><td>'+html(r.eventId)+'</td><td>'+html(r.movementId)+'</td><td>'+html(r.received.map(x=>x.rowNumber).join(', '))+'</td><td>'+html(r.changes.map(x=>x.field+': '+x.expected+' → '+x.received).join('; ')||r.issues.map(x=>x.message).join('; '))+'</td></tr>').join(''):
    plan.rows.map(r=>'<tr><td>'+html(r.status)+'</td><td>'+html(r.kind+' / '+r.direction)+'</td><td>'+html(r.amountAtomic)+'</td><td>'+html(r.quantity)+'</td><td>'+html(r.nativeTransferAt)+'</td><td>'+html(r.date)+'</td><td>'+html(r.eventId)+'</td><td>'+html(r.issues.map(x=>x.message).join('; ')||r.decision.reason)+'</td></tr>').join('');
  return Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>body{font:14px system-ui;color:#202020;background:#fff;margin:28px;line-height:1.5}h1{font-size:24px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:9px;border:1px solid #ccc;text-align:left;vertical-align:top;overflow-wrap:anywhere}code{overflow-wrap:anywhere}section{margin:24px 0}pre{white-space:pre-wrap}</style><h1>'+title+'</h1><p>'+html(plan.name)+' · '+html(plan.target.entityName||plan.target.entityId)+' · '+html(plan.target.connectionName||plan.target.connectionId)+'</p><p>Original source handoff '+html(plan.handoffId)+' · '+html(plan.accountantRevisionId)+'<br>Plan '+html(plan.id)+' · '+html(plan.integrity.sha256)+'</p><section><h2>Selected date and source</h2><p>'+html(plan.date.format)+' · '+html(plan.date.timeZone)+' · '+html(plan.date.precision)+' precision</p><pre>'+html(JSON.stringify(plan.source,null,2))+'</pre></section><section><h2>Summary</h2><pre>'+html(JSON.stringify(capture?.summary??plan.summary,null,2))+'</pre></section><table><thead><tr>'+(capture?['Status','Original event','Native movement','Received rows','Differences / explanation']:['Status','Movement','Atomic quantity','Template quantity','Native transfer UTC','Mapped date','Original event','Decision / explanation']).map(x=>'<th>'+html(x)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table><section><h2>Native operating references</h2>'+CRYPTOWORTH_DOCS.map(d=>'<p><a href="'+html(d.url)+'">'+html(d.name)+'</a></p>').join('')+'</section></html>');
}

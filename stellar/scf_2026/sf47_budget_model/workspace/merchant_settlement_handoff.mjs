// MIT. Original merchant accounting source -> existing SF47 Grant Operations.
// The original reconciliation/accountant/refund engines remain the source readers.
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {runOriginalAccounting,indexOriginalVerifications,compileTerms} from '../../../scf-starforge-20261009/merchant-settlement-accounting/reconcile.mjs';
import {createHandoff,validateHandoff,validateRevision} from '../../../scf-starforge-20261009/merchant-settlement-accounting/accountant/engine.mjs';
import {freezeAccountantAdjustments} from '../../../scf-starforge-20261009/merchant-settlement-accounting/accountant/adjustments.mjs';
import {validateAdjustment,validateRefundProof} from '../../../scf-starforge-20261009/merchant-settlement-accounting/adjustments.mjs';

export const SETTLEMENT_READER='scf.operations.settlement-reader.v1';
export const SETTLEMENT_SOURCE='scf.operations.merchant-settlement-source.v1';
const MAX_BYTES=8*1024*1024,MAX_ROWS=5000,MAX_FILES=4096;
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const copy=x=>structuredClone(x);
const canonical=x=>JSON.stringify(x,(_,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const need=(condition,code,message)=>{if(!condition)throw Object.assign(new Error(message),{code});};
const json=(raw,name)=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{need(false,'SETTLEMENT_JSON_INVALID','The original '+name+' is not complete UTF-8 JSON.');}};
const safePath=name=>typeof name==='string'&&name.length>0&&name.length<=400&&!name.startsWith('/')&&!name.includes('\\')&&!/[\u0000-\u001f\u007f]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
const cashKey=(network,transaction,event)=>sha(canonical({schema:'scf.operations.merchant-transfer.v1',network,transaction,event}));
const externalRef=(transaction,event)=>transaction+'/event/'+sha(event);
const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const instant=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
function memberMap(input){
  need(object(input)&&input.schema==='scf.operations.settlement-reader-input.v1'&&object(input.source)&&
    HASH.test(input.source.sha256??'')&&Number.isSafeInteger(input.source.bytes)&&input.source.bytes>0&&input.source.bytes<=MAX_BYTES&&
    Array.isArray(input.files)&&input.files.length>0&&input.files.length<=MAX_FILES,
    'SETTLEMENT_SOURCE_INVALID','Use the complete original source archive selected by Grant Operations.');
  const files=new Map();let total=0;
  for(const row of input.files){
    need(object(row)&&safePath(row.path)&&!files.has(row.path)&&HASH.test(row.sha256??'')&&
      Number.isSafeInteger(row.bytes)&&row.bytes>=0&&typeof row.contentBase64==='string',
      'SETTLEMENT_MEMBER_INVALID','Every original member needs its exact unique path and bytes.');
    const raw=Buffer.from(row.contentBase64,'base64');
    need(raw.toString('base64')===row.contentBase64&&raw.length===row.bytes&&sha(raw)===row.sha256,
      'SETTLEMENT_MEMBER_CHANGED','An original archive member differs from its selected bytes.');
    total+=raw.length;need(total<=MAX_BYTES,'SETTLEMENT_SOURCE_SIZE','The expanded original source exceeds the Grant Operations source bound.');
    files.set(row.path,raw);
  }
  return files;
}
function file(files,name,required=true){
  const value=files.get(name);
  need(!required||value!==undefined,'SETTLEMENT_MEMBER_MISSING','Keep the original '+name+' in the same source archive.');
  return value;
}
function exact(files,name,descriptor){
  const raw=file(files,name);
  need(object(descriptor)&&HASH.test(descriptor.sha256??'')&&sha(raw)===descriptor.sha256&&
    (descriptor.bytes===undefined||raw.length===descriptor.bytes),
    'SETTLEMENT_MEMBER_CHANGED','The retained source identity differs for '+name+'.');
  return raw;
}
function originalPacket(files){
  const accountant=files.has('handoff.json');
  const reportName=accountant?'original-report.json':'report.json';
  const manifestName=accountant?'original-manifest.json':'manifest.json';
  const reportBytes=file(files,reportName),manifestBytes=file(files,manifestName),inputBytes=file(files,'input-manifest.json');
  const report=json(reportBytes,reportName),manifest=json(manifestBytes,manifestName),inputs=json(inputBytes,'input-manifest.json');
  need(object(manifest)&&manifest.schema==='stellar-forge.merchant-accounting-manifest.v1'&&Array.isArray(manifest.outputs)&&
    object(report)&&report.schema==='stellar-forge.merchant-reconciliation.v1'&&Array.isArray(report.ledger)&&
    report.ledger.length<=MAX_ROWS&&object(inputs)&&inputs.schema==='stellar-forge.merchant-accounting-inputs.v1'&&
    Array.isArray(inputs.files)&&inputs.files.length<=MAX_FILES&&instant(inputs.capturedAt),
    'SETTLEMENT_ORIGINAL_SOURCE_REQUIRED','Select the complete original merchant report and its input/report manifests.');
  need(isDeepStrictEqual(manifest.sourceHashes,report.hashes),'SETTLEMENT_REPORT_SOURCE_CONFLICT','The original report and manifest name different inputs.');
  const outputNames=new Set();
  for(const entry of manifest.outputs){
    need(object(entry)&&safePath(entry.name)&&!entry.name.includes('/')&&!outputNames.has(entry.name)&&
      HASH.test(entry.sha256??'')&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0,
      'SETTLEMENT_REPORT_MANIFEST_INVALID','The original report manifest is incomplete or repeats a name.');
    outputNames.add(entry.name);
    if(!accountant||entry.name==='report.json')exact(files,entry.name==='report.json'?reportName:entry.name,entry);
  }
  need(outputNames.has('report.json'),'SETTLEMENT_REPORT_MANIFEST_INVALID','The original report descriptor is required.');
  let close=null,closeBytes=file(files,'period-close.json',false),reviewBytes=file(files,'review-notes.json',false);
  if(closeBytes){
    close=json(closeBytes,'period-close.json');
    need(close.schema==='stellar-forge.merchant-period-close.v1'&&UUID.test(close.id??'')&&UUID.test(close.runId??'')&&
      close.reportSha256===sha(reportBytes)&&close.inputManifestSha256===sha(inputBytes)&&
      isDeepStrictEqual(close.scope,report.period),
      'SETTLEMENT_CLOSE_CHANGED','The original period close belongs to another report or captured input.');
    need(reviewBytes&&sha(reviewBytes)===close.reviewNotesSha256,'SETTLEMENT_CLOSE_REVIEW_MISSING','Keep the close’s complete frozen review notes.');
    const notes=json(reviewBytes,'review-notes.json');
    need(notes.runId===close.runId&&notes.workspaceRevision===close.reviewSnapshotRevision,
      'SETTLEMENT_CLOSE_REVIEW_CHANGED','The frozen exception review belongs to another close.');
  }
  const notes=reviewBytes?json(reviewBytes,'review-notes.json'):null;
  const suppliedHandoff=accountant?validateHandoff(json(file(files,'handoff.json'),'handoff.json')):null;
  const runId=close?.runId??suppliedHandoff?.source.runId??notes?.runId;
  need(UUID.test(runId??''),'SETTLEMENT_RUN_ID_REQUIRED','Keep the original workspace run identity through its review notes, close or accountant handoff.');
  if(notes)need(notes.runId===runId,'SETTLEMENT_RUN_ID_CONFLICT','The original exception review names another run.');
  const adjustmentsBytes=file(files,'adjustments.json',false);
  const source={runId,reportSha256:sha(reportBytes),manifestSha256:sha(manifestBytes),inputManifestSha256:sha(inputBytes),
    ...(close?{periodClose:{id:close.id,revision:close.revision,sha256:sha(closeBytes)}}:{}),
    ...(adjustmentsBytes?{adjustmentsSha256:sha(adjustmentsBytes)}:{})};
  const frozen=createHandoff({reportBytes,source,name:suppliedHandoff?.name??'Original merchant source',
    actor:suppliedHandoff?.actor??notes?.actor??close?.actor??'Original merchant operator',
    id:suppliedHandoff?.id??runId,createdAt:suppliedHandoff?.createdAt??close?.createdAt??inputs.capturedAt,
    labels:suppliedHandoff?.labels??[],periodCloseBytes:closeBytes,adjustmentsBytes});
  if(suppliedHandoff)need(isDeepStrictEqual(frozen,suppliedHandoff),'SETTLEMENT_HANDOFF_CHANGED','The accountant handoff differs from its complete original source.');
  let returned=null;
  if(accountant){
    const packetBytes=file(files,'packet-manifest.json');
    if(packetBytes){
      const packet=json(packetBytes,'packet-manifest.json');
      need(packet.schema==='stellar-forge.accountant-packet.v1'&&Array.isArray(packet.files),
        'SETTLEMENT_ACCOUNTANT_MANIFEST_INVALID','Use the complete original accountant packet manifest.');
      const named=new Set();
      for(const descriptor of packet.files){need(safePath(descriptor?.name)&&!named.has(descriptor.name),'SETTLEMENT_ACCOUNTANT_MANIFEST_INVALID','The accountant packet repeats a member.');named.add(descriptor.name);exact(files,descriptor.name,descriptor);}
      need([...files.keys()].every(name=>name==='packet-manifest.json'||named.has(name)||(name.startsWith('sources/')&&inputs.files.some(row=>row.path===name))),
        'SETTLEMENT_ACCOUNTANT_MANIFEST_INVALID','The original accountant archive contains an unbound member.');
    }
    const revisions=[...files.entries()].filter(([name])=>name==='return.json')
      .map(([name,raw])=>({name,value:json(raw,name)})).filter(row=>row.value.schema==='stellar-forge.merchant-accountant-return.v1');
    need(revisions.length<=1,'SETTLEMENT_ACCOUNTANT_REVISION_AMBIGUOUS','Choose one complete accountant return revision.');
    if(revisions.length)returned=validateRevision(suppliedHandoff,revisions[0].value);
  }
  let adjustments=null;
  if(adjustmentsBytes){
    freezeAccountantAdjustments({adjustmentsBytes,report,source,periodCloseDocument:close});
    adjustments=json(adjustmentsBytes,'adjustments.json');
    if(close)for(const [name,descriptor]of Object.entries(close.adjustmentFiles??{}))exact(files,name,descriptor);
  }
  const descriptors=new Map();let complete=true;const missing=[];
  for(const entry of inputs.files){
    need(object(entry),'SETTLEMENT_INPUT_MANIFEST_INVALID','The original input manifest contains an invalid member.');
    if(entry.path===null){need(entry.bytes===0&&entry.sha256===null,'SETTLEMENT_INPUT_MANIFEST_INVALID','An absent original source must keep its original empty descriptor.');continue;}
    need(safePath(entry.path)&&entry.path.startsWith('sources/')&&!descriptors.has(entry.path)&&
      HASH.test(entry.sha256??'')&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0,
      'SETTLEMENT_INPUT_MANIFEST_INVALID','The original input paths must be distinct and retained.');
    descriptors.set(entry.path,entry);
    if(files.has(entry.path))exact(files,entry.path,entry);else{complete=false;missing.push(entry.path);}
  }
  need(descriptors.has('sources/terms.json'),'SETTLEMENT_TERMS_DESCRIPTOR_MISSING','Keep the original merchant terms descriptor.');
  for(const name of files.keys())if(name.startsWith('sources/'))need(descriptors.has(name),
    'SETTLEMENT_SOURCE_UNBOUND','A source member is absent from the original input manifest.');
  if(!accountant&&close&&close.includeSources)need(complete,'SETTLEMENT_CLOSE_SOURCE_INCOMPLETE','This close says its original sources are included; retain every selected member.');
  return {report,inputs,source,close,notes,handoff:frozen,returned,adjustments,descriptors,complete,missing,kind:accountant?'ACCOUNTANT_HANDOFF':close?'PERIOD_CLOSE':'RECONCILIATION'};
}
async function originalReplay(packet,files){
  if(!packet.complete)return {available:false,reason:'ORIGINAL_INPUT_BYTES_NOT_INCLUDED',report:null,proofs:[],terms:[]};
  const root=await mkdtemp(join(tmpdir(),'sf47-merchant-source-'));
  try{
    await mkdir(join(root,'sources','outbox'),{recursive:true,mode:0o700});
    await mkdir(join(root,'sources','proofs'),{recursive:true,mode:0o700});
    if(packet.inputs.recoveredSource)await mkdir(join(root,'sources','recovered'),{recursive:true,mode:0o700});
    for(const [name]of packet.descriptors){
      const path=join(root,...name.split('/'));need(path.startsWith(root+'/'),'SETTLEMENT_SOURCE_PATH','The native source path escaped its selected directory.');
      await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});
      await writeFile(path,file(files,name),{flag:'wx',mode:0o600});
    }
    const native=await runOriginalAccounting({outboxDir:join(root,'sources','outbox'),proofDir:join(root,'sources','proofs'),
      termsFile:join(root,'sources','terms.json'),...(packet.inputs.recoveredSource?{recoveredDir:join(root,'sources','recovered')}:{ }),
      ...(packet.report.period?{period:{from:packet.report.period.from,until:packet.report.period.until}}:{})});
    const original=packet.report,hashesMatch=Object.entries(original.hashes).every(([key,value])=>isDeepStrictEqual(value,native.hashes[key]));
    const rows=new Map(native.ledger.map(row=>[row.eventId,row]));
    const ledgerMatch=rows.size===original.ledger.length&&original.ledger.every(row=>{
      const current=rows.get(row.eventId);return current&&Object.entries(row).every(([key,value])=>Object.hasOwn(current,key)&&isDeepStrictEqual(value,current[key]));
    });
    const periodMatch=isDeepStrictEqual(original.period??null,native.period??null);
    const proofFiles=[...files].filter(([name])=>name.startsWith('sources/proofs/')&&name.endsWith('.json')||
      name.startsWith('sources/recovered/')&&name.endsWith('/proof.json'));
    const proofDocs=proofFiles.map(([name,raw])=>({name,data:json(raw,name),fileDigest:sha(raw)}));
    const accepted=indexOriginalVerifications(proofDocs),proofs=[...accepted.index.values()].flat();
    const terms=[...compileTerms(json(file(files,'sources/terms.json'),'sources/terms.json')).values()]
      .map(({price,cost,...row})=>row);
    return {available:true,sourceMatches:hashesMatch&&ledgerMatch&&periodMatch,
      reason:hashesMatch&&ledgerMatch&&periodMatch?null:'ORIGINAL_RECONCILIATION_SOURCE_CONFLICT',
      report:native,proofs,terms};
  }finally{await rm(root,{recursive:true,force:true});}
}
function proofTransfer(proof,kind){
  const p=proof.data??proof;
  need(HASH.test(p.transaction??'')&&typeof p.matchingEventId==='string'&&p.matchingEventId.length>0&&
    p.matchingEventId.length<=1024&&!/[\u0000-\u001f\u007f]/.test(p.matchingEventId),
    'SETTLEMENT_TRANSFER_ID_INVALID','Retain the original transaction and selected native transfer event.');
  const transferKey=cashKey(p.network,p.transaction,p.matchingEventId);
  return {network:p.network,asset:p.asset,amountAtomic:p.atomicAmount,transaction:p.transaction,matchingEventId:p.matchingEventId,
    ledger:p.ledger,recipient:p.recipient,payer:typeof p.payer==='string'?p.payer:null,transferKey,
    externalRef:externalRef(p.transaction,p.matchingEventId),direction:kind==='REFUND'?'OUT':'IN',
    observedAt:p.observedAt??null,transferAt:p.transferAt??null,proofSha256:proof.fileDigest??sha(canonical(p)),
    proofSchema:p.schema,verificationOrigin:p.origin??null,verificationVerdict:p.verdict??null,verificationSource:p.source??null};
}
export async function inspectMerchantSettlement(input){
  const files=memberMap(input),packet=originalPacket(files);
  let replay;
  try{replay=await originalReplay(packet,files);}catch(error){
    // A host failure is retryable; it must never become a durable source finding.
    // Missing source bytes are handled before execution in originalReplay.
    const code=typeof error.code==='string'?error.code:null;
    if(code&&(/^(?:E[A-Z0-9]+|ERR_)/.test(code))){
      throw Object.assign(new Error('The original merchant reader could not complete on this runtime. Retain the same source selection.'),{code:'SETTLEMENT_READER_UNAVAILABLE',status:503});
    }
    // The complete selected source failed its original native parser. Preserve
    // that result as observation-only; it cannot authorize any payment row.
    replay={available:false,sourceMatches:false,reason:'ORIGINAL_READER_'+String(error.code??error.message??'FAILED').replace(/[^A-Z0-9_]/g,'_').slice(0,100),report:null,proofs:[],terms:[]};
  }
  const nativeRows=new Map((replay.report?.ledger??[]).map(row=>[row.eventId,row]));
  const proofByHash=new Map(replay.proofs.map(row=>[row.fileDigest,row]));
  const handoffRows=new Map(packet.handoff.rows.map(row=>[row.eventId,row]));
  const rows=[];
  for(const original of packet.report.ledger){
    const issues=[],native=nativeRows.get(original.eventId),proof=proofByHash.get(original.transferEvidenceDigest);
    const verified=packet.complete&&replay.sourceMatches&&native?.transfer==='OFFICIAL_TRANSFER_MATCHED'&&
      original.transfer==='OFFICIAL_TRANSFER_MATCHED'&&proof&&native.transferEvidenceDigest===proof.fileDigest;
    if(!packet.complete)issues.push('ORIGINAL_INPUT_BYTES_NOT_INCLUDED');
    if(replay.reason&&!issues.includes(replay.reason))issues.push(replay.reason);
    if(original.transfer!=='OFFICIAL_TRANSFER_MATCHED')issues.push(original.exception??'ORIGINAL_TRANSFER_NOT_INDEPENDENTLY_MATCHED');
    if(original.transfer==='OFFICIAL_TRANSFER_MATCHED'&&!verified)issues.push('ORIGINAL_TRANSFER_PROOF_NOT_REPRODUCED');
    let transfer=null;
    if(verified){
      transfer=proofTransfer(proof,'PAYMENT');
      need(transfer.network===original.network&&transfer.amountAtomic===original.amountAtomic&&
        sha(transfer.asset)===original.assetDigest&&sha(transfer.transaction)===original.transactionFingerprint&&
        sha(transfer.matchingEventId)===original.matchingEventDigest&&transfer.ledger===original.ledger,
        'SETTLEMENT_TRANSFER_SOURCE_CONFLICT','The original native proof differs from its merchant row.');
    }
    const label=handoffRows.get(original.eventId)?.label??{};
    const rowId=sha(canonical({schema:SETTLEMENT_SOURCE,kind:'PAYMENT',network:original.network,eventId:original.eventId}));
    rows.push({rowId,eventId:original.eventId,kind:'PAYMENT',optionId:original.optionId,original:copy(original),
      sourceRowSha256:handoffRows.get(original.eventId)?.sourceRowSha256??sha(canonical(original)),label:copy(label),
      adjustments:copy(handoffRows.get(original.eventId)?.adjustments??null),transfer,
      canRecordCash:Boolean(verified&&transfer),issues:[...new Set(issues)],sourceTime:original.at,
      sourceTimeBasis:original.timeBasis??'ORIGINAL_MERCHANT_CAPTURE_TIME',
      accountantAssignment:packet.returned?.assignments.find(row=>row.eventId===original.eventId)??null});
  }
  for(const event of packet.adjustments?.events??[])for(const adjustment of event.adjustments){
    validateAdjustment(adjustment);
    if(adjustment.kind!=='REFUND')continue;
    const verified=adjustment.status==='VERIFIED'&&validateRefundProof(adjustment.verification.proof,adjustment);
    const proof=verified?adjustment.verification.proof:null,transfer=proof?proofTransfer(proof,'REFUND'):null;
    rows.push({rowId:sha(canonical({schema:SETTLEMENT_SOURCE,kind:'REFUND',id:adjustment.id})),
      eventId:adjustment.id,parentEventId:adjustment.eventId,kind:'REFUND',optionId:event.original.optionId,
      original:copy(adjustment),sourceRowSha256:sha(canonical(adjustment)),label:copy(handoffRows.get(adjustment.eventId)?.label??{}),
      adjustments:null,transfer,canRecordCash:Boolean(verified),
      issues:verified?[]:['ORIGINAL_REFUND_'+adjustment.status],sourceTime:proof?.transferAt??proof?.observedAt??adjustment.createdAt,
      sourceTimeBasis:proof?.transferAt?'ORIGINAL_NATIVE_REFUND_TRANSFER_AT':proof?'ORIGINAL_REFUND_VERIFICATION_OBSERVED_AT':'ORIGINAL_REFUND_REQUEST_CREATED_AT',
      accountantAssignment:null});
  }
  need(rows.length<=MAX_ROWS,'SETTLEMENT_ROW_LIMIT','Select a complete original accounting period within the case row bound.');
  const transferIds=new Map();
  for(const row of rows)if(row.transfer){
    const previous=transferIds.get(row.transfer.transferKey);
    if(previous){row.canRecordCash=false;previous.canRecordCash=false;row.issues.push('DUPLICATE_NATIVE_TRANSFER_IN_SOURCE');previous.issues.push('DUPLICATE_NATIVE_TRANSFER_IN_SOURCE');}
    else transferIds.set(row.transfer.transferKey,row);
  }
  const terms=replay.terms.map(row=>({optionId:row.optionId,network:row.network,asset:row.asset,assetDigest:row.assetDigest,
    recipient:row.payTo,recipientDigest:row.recipientDigest,amountAtomic:row.amountAtomic,merchantPriceBasis:row.priceBasis,
    decimals:null,currency:null,unitBasis:'EXPLICIT_ORIGINAL_ASSET_UNIT_REVIEW_REQUIRED'}));
  const report={schema:SETTLEMENT_SOURCE,source:{...copy(input.source),kind:packet.kind,...copy(packet.source),
      capturedAt:packet.inputs.capturedAt,originalReportCreatedAt:packet.report.createdAt??null,
      ...(packet.close?{periodClose:{...copy(packet.source.periodClose),name:packet.close.name,period:copy(packet.close.period),
        scope:copy(packet.close.scope),includeSources:packet.close.includeSources,reviewCounts:copy(packet.close.reviewCounts)}}:{}),
      accountant:packet.handoff?{id:packet.handoff.id,sha256:packet.handoff.integrity.sha256,
        returnedRevisionId:packet.returned?.id??null,returnedRevisionSha256:packet.returned?.integrity.sha256??null}:null,
      completeOriginalInputs:packet.complete,missingOriginalMembers:packet.missing,
      files:[...files].map(([path,raw])=>({path,bytes:raw.length,sha256:sha(raw)}))},
    reader:{merchant:'ORIGINAL_MERCHANT_RECONCILIATION',outbox:'ORIGINAL_SF98',verification:'ORIGINAL_SF86_OR_SF43',
      accountant:'ORIGINAL_ACCOUNTANT_ENGINE',refunds:'ORIGINAL_REFUND_VALIDATOR',
      nativeSourceAvailable:replay.available,nativeSourceMatches:replay.sourceMatches===true,
      issue:replay.reason??null},
    counts:{rows:rows.length,payments:rows.filter(row=>row.kind==='PAYMENT').length,refunds:rows.filter(row=>row.kind==='REFUND').length,
      eligibleCash:rows.filter(row=>row.canRecordCash).length,observationsOnly:rows.filter(row=>!row.canRecordCash).length,
      testnet:rows.filter(row=>(row.transfer?.network??row.original.network??row.original.original?.network)==='stellar:testnet').length},
    rows,units:terms,
    interpretation:'Original merchant capture, delivery, returned books and quoted USD remain separate. A cash observation requires an eligible original transfer plus reviewed unit, date and valuation decisions. Testnet stays outside real cash totals.'};
  return {schema:SETTLEMENT_READER,report,html:renderMerchantSettlement(report)};
}
export function renderMerchantSettlement(report){
  const rows=report.rows.map(row=>'<tr><td>'+htmlEscape(row.kind)+'</td><td><code>'+htmlEscape(row.eventId)+'</code></td><td>'+
    htmlEscape(row.transfer?.network??row.original.network??row.original.original?.network)+'</td><td>'+htmlEscape(row.transfer?.amountAtomic??row.original.amountAtomic)+
    '</td><td>'+htmlEscape(row.transfer?.asset??row.original.assetDigest??row.original.original?.assetDigest)+'</td><td>'+
    htmlEscape(row.canRecordCash?'Original transfer eligible for reviewed cash':'Source observation')+'</td><td>'+htmlEscape(row.issues.join('; '))+'</td></tr>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Original merchant settlement source</title><style>body{font:14px/1.5 system-ui;background:#f5f5f5;color:#222;margin:0;padding:24px}main{max-width:1280px;margin:auto}h1{font-size:25px}table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #ccc;padding:9px;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}.scroll{overflow:auto}th{background:#eee}p{max-width:95ch}@media(max-width:500px){body{padding:12px}}</style><main>'+
    '<p>STELLAR FORGE / GRANT OPERATIONS</p><h1>Original merchant settlement source</h1><p>'+htmlEscape(report.interpretation)+'</p>'+
    '<p>Original run <code>'+htmlEscape(report.source.runId)+'</code>; source <code>'+htmlEscape(report.source.sha256)+'</code>; '+report.source.bytes+' bytes.</p>'+
    '<p>'+htmlEscape(report.source.kind)+'; native source '+htmlEscape(report.reader.nativeSourceMatches?'matches':report.reader.issue??'unavailable')+
    '; '+report.counts.rows+' original rows.</p><div class="scroll"><table><thead><tr><th>Kind</th><th>Original event</th><th>Network</th><th>Atomic amount</th><th>Asset</th><th>Review eligibility</th><th>Source findings</th></tr></thead><tbody>'+
    rows+'</tbody></table></div></main></html>';
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const parts=[];let size=0;
    for await(const part of process.stdin){size+=part.length;need(size<=Math.ceil(MAX_BYTES*4/3)+2_000_000,'SETTLEMENT_READER_SIZE','The complete native source input exceeds its supported bound.');parts.push(part);}
    const input=json(Buffer.concat(parts),'native reader input');
    process.stdout.write(JSON.stringify(await inspectMerchantSettlement(input)));
  }catch(error){
    const code=String(error.code??'SETTLEMENT_ORIGINAL_READER_FAILED').replace(/[^A-Z0-9_]/g,'_').slice(0,120);
    process.stdout.write(JSON.stringify({schema:SETTLEMENT_READER,error:{code,status:error.status===503?503:422,message:String(error.message??code).slice(0,2000)}}));process.exitCode=1;
  }
}

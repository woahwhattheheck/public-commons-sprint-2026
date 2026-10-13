// MIT. Typed ROZO period source in the existing accountant handoff/return engine.
import { randomUUID } from 'node:crypto';
import { assert, fields, id as recordId, text, iso, integer, sha, clone, canonical, jsonDigest, digest, validateAsset } from '../../sf30-seller-sdk/rozo-payments/model.mjs';
import { inspectRozoFinanceSource } from '../../sf30-seller-sdk/rozo-payments/finance-source.mjs';
import { rozoFinanceMovements } from '../../sf30-seller-sdk/rozo-payments/finance-projection.mjs';

export const ROZO_ACCOUNTANT_SOURCE_SCHEMA='stellar-forge.rozo-accountant-source.v1';
export const ROZO_HANDOFF_SCHEMA='stellar-forge.rozo-accountant-handoff.v1';
export const ROZO_RETURN_SCHEMA='stellar-forge.rozo-accountant-return.v1';
export const ROZO_PERIOD_CLOSE_SCHEMA='stellar-forge.rozo-period-close.v1';
export const isRozoHandoff=value=>value?.schema===ROZO_HANDOFF_SCHEMA;
const fail=(ok,message)=>assert(ok,'ROZO_ACCOUNTANT_SOURCE',message,409);
const MAX=64*1024*1024,HEX=/^[0-9a-f]{64}$/;
export const ROZO_LINE_FIELDS=Object.freeze([
  'sourceLineId','sourceId','captureId','sourceSha256','sourceReportId','sourceReportSha256',
  'movementId','movementBasisSha256','paymentId','movementKind','classification','recognitionDate',
  'chainId','network','tokenAddress','decimals','tokenSymbol','amount','originalMovementAmount',
  'providerStatus','evidenceClass','independentChainProof','receiptReference','providerCreatedAt','providerUpdatedAt',
  'accountCode','costCenter','project','memo','codingId','codingVersion','line','reviewedBy','reviewReason'
]);
export const ROZO_PROTECTED_COLUMNS=Object.freeze([
  'handoffId','sourceWorkspaceId','sourceCloseId','sourceCloseSequence','sourceContextSha256','sourceAccountantSha256',
  'rowId','sourceRowSha256',...ROZO_LINE_FIELDS,'assetLabel','unitLabel','accountCodeLabel','accountName'
]);
const categories=Object.freeze({source_payment:'merchant_receipt',source_fee:'provider_fee',destination_payout:'settlement_transfer'});
export const rozoMovementClassification=kind=>categories[kind]??null;
const sourceLineId=(workspaceId,closeId,line)=>jsonDigest({schema:'stellar-forge.rozo-accountant-line.v1',
  workspaceId,closeId,codingId:line.codingId,codingVersion:line.codingVersion,line:line.line});
const rowId=(handoffId,sourceSha256,lineId)=>jsonDigest({schema:'stellar-forge.rozo-accountant-row.v1',handoffId,sourceSha256,lineId});
const seal=value=>({...value,integrity:{sha256:jsonDigest(value)}});
const day=value=>{fail(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)===value,'Retain an exact recognition date.');return value;};
const units=value=>{fail(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,99})$/.test(value),'Retain an exact nonnegative native-unit amount.');return BigInt(value);};
const rawFile=file=>{
  fail(file&&typeof file==='object'&&typeof file.base64==='string'&&file.base64.length<=Math.ceil(MAX/3)*4,'Retain the complete original source file.');
  const raw=Buffer.from(file.base64,'base64');
  fail(raw.length>0&&raw.length<=MAX&&raw.length===file.bytes&&raw.toString('base64')===file.base64&&digest(raw)===file.sha256,
    'The exact original source file differs from its retained byte identity.');
  return raw;
};
export function rozoAccountingTotals(lines){
  const groups=new Map();
  for(const row of lines){
    const key=canonical([row.classification,row.chainId,row.network,row.tokenAddress,row.decimals]);
    const value=groups.get(key)??{classification:row.classification,chainId:row.chainId,network:row.network,
      tokenAddress:row.tokenAddress,decimals:row.decimals,amount:0n,lines:0};
    value.amount+=units(row.amount);value.lines++;groups.set(key,value);
  }
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>({...v,amount:v.amount.toString()}));
}

/** Validate the issued native Accounting close against every full ROZO source. */
export function inspectRozoAccountantSource(input){
  const raw=Buffer.from(input);fail(raw.length>0&&raw.length<=MAX,'Retain a complete original ROZO accountant source up to 64 MiB.');
  let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail(false,'Choose original UTF-8 ROZO accountant JSON.');}
  fields(document,['schema','workspaceId','sourceRevision','close','sources'],'ROZO accountant source');
  fail(document.schema===ROZO_ACCOUNTANT_SOURCE_SCHEMA,'Choose an original issued ROZO accountant source.');
  recordId(document.workspaceId,'accounting workspace');integer(document.sourceRevision,'original source revision');
  const close=document.close;
  fail(close?.schema===ROZO_PERIOD_CLOSE_SCHEMA&&close.status==='CLOSED'&&close.ready===true&&close.unresolved===0,
    'Retain an issued native ROZO period with its completed review.');
  const {sha256:closeSha,...closeBody}=close;sha(closeSha,'original close SHA-256');
  fail(jsonDigest(closeBody)===closeSha,'The original closed period changed.');
  recordId(close.id,'original close');integer(close.sequence,'close sequence',1);
  fail(close.workspaceId===document.workspaceId,'The close names another accounting workspace.');
  iso(close.createdAt,'original close time');text(close.actor,'close owner',1000);
  const period=close.period;recordId(period.periodId,'period');integer(period.version,'period version',1);
  text(period.name,'period name',160);iso(period.from,'period start');iso(period.until,'period end');
  fail(period.from<period.until,'Retain the original increasing period interval.');
  fail(close.review?.state==='READY'&&close.review.contextSha256===close.contextSha256&&HEX.test(close.contextSha256),
    'Retain the completed review of this exact native close basis.');
  recordId(close.review.id,'review');text(close.review.actor,'review owner',1000);text(close.review.note,'review note',6000);
  iso(close.review.at,'review time');
  fail(['development','operational'].includes(close.dataContext),'Retain the explicit source data context.');
  fail(Array.isArray(close.lines)&&close.lines.length<=22000&&Array.isArray(close.sourceCaptures)&&Array.isArray(document.sources),
    'Retain all original period allocation lines and source captures.');
  const packets=new Map(),captured=new Map(),moves=new Map();
  for(const descriptor of document.sources){
    recordId(descriptor.captureId,'original capture');fail(!packets.has(descriptor.captureId),'A source capture is repeated.');
    const bytes=rawFile(descriptor),checked=inspectRozoFinanceSource(bytes),facts=rozoFinanceMovements(checked.source);
    packets.set(descriptor.captureId,{descriptor,checked,bytes});
    moves.set(descriptor.captureId,new Map(facts.movements.map(value=>[value.id,value])));
  }
  for(const descriptor of close.sourceCaptures){
    const original=packets.get(descriptor.captureId);
    fail(original&&!captured.has(descriptor.captureId)&&descriptor.sourceId===original.checked.sourceId&&
      descriptor.sourceSha256===original.checked.sha256&&descriptor.fileSha256===digest(original.bytes)&&
      descriptor.fileBytes===original.bytes.length&&descriptor.reportSha256===original.checked.reportSha256&&
      descriptor.reportId===original.checked.reportId&&descriptor.dataContext===close.dataContext,
      'The original close source selection or exact file identity differs.');
    captured.set(descriptor.captureId,descriptor);
  }
  fail(captured.size===packets.size,'Retain exactly the sources frozen by the original close.');
  const allocations=new Map(),rows=[],seen=new Set();
  for(const original of close.lines){
    fail(original&&typeof original==='object','Retain a complete original accounting line.');
    const source=captured.get(original.captureId),movement=moves.get(original.captureId)?.get(original.movementId);
    fail(source&&movement&&source.sourceId===original.sourceId&&source.sourceSha256===original.sourceSha256&&
      source.reportId===original.sourceReportId&&source.reportSha256===original.sourceReportSha256&&
      movement.basisSha256===original.movementBasisSha256&&movement.paymentId===original.paymentId,
      'An allocation names another source, payment or reviewed movement.');
    fail(movement.kind===original.movementKind&&categories[movement.kind]===original.classification&&
      movement.amountObserved&&movement.providerConfirmed&&movement.amount?.asset,
      'Recognise an exact provider-confirmed movement under its original financial category.');
    const asset=validateAsset(movement.amount.asset);
    for(const key of ['chainId','network','tokenAddress','decimals','tokenSymbol'])
      fail(original[key]===asset[key],'An allocation changed the original asset identity or precision.');
    fail(original.originalMovementAmount===movement.amount.units&&original.providerStatus===movement.providerStatus&&
      original.evidenceClass===movement.evidenceClass&&original.independentChainProof===false&&
      original.receiptReference===(movement.receiptReference??'')&&original.providerCreatedAt===movement.providerCreatedAt&&
      original.providerUpdatedAt===movement.providerUpdatedAt,'The native amount, date or evidence classification changed.');
    const recognised=day(original.recognitionDate)+'T00:00:00.000Z';
    fail(Date.parse(recognised)>=Date.parse(period.from)&&Date.parse(recognised)<Date.parse(period.until),
      'An allocation falls outside the original period.');
    recordId(original.codingId,'coding');integer(original.codingVersion,'coding version',1);integer(original.line,'allocation line',1);
    for(const [key,max,optional] of [['accountCode',160,false],['costCenter',160,true],['project',300,true],['memo',4000,true],['reviewedBy',1000,false],['reviewReason',6000,false]])
      if(!optional||original[key]!=='')text(original[key],key,max);
    const economic=original.movementId,value=units(original.amount),previous=allocations.get(economic);
    if(previous)fail(previous.captureId===original.captureId&&previous.codingId===original.codingId&&
      previous.codingVersion===original.codingVersion&&previous.maximum===movement.amount.units,
      'One original movement has conflicting source or coding editions in this close.');
    const sum=(previous?.amount??0n)+value;fail(sum<=units(movement.amount.units),'Allocations exceed the original movement.');
    allocations.set(economic,{amount:sum,maximum:movement.amount.units,captureId:original.captureId,codingId:original.codingId,codingVersion:original.codingVersion});
    const lineId=sourceLineId(document.workspaceId,close.id,original);
    fail(!seen.has(lineId),'An original coding line is repeated.');seen.add(lineId);
    rows.push({sourceLineId:lineId,original:clone(original)});
  }
  for(const value of allocations.values())fail(value.amount===units(value.maximum),'The allocation lines do not cover their original movement exactly.');
  fail(canonical(rozoAccountingTotals(close.lines))===canonical(close.totals),'The frozen totals differ from the exact classified allocation lines.');
  fail(Array.isArray(close.excluded),'Retain the original source dispositions.');
  const sourceSha256=digest(raw);
  return {raw,document,rows,sha256:sourceSha256,closeSha256:closeSha,
    source:{kind:'rozo-settlement-period',runId:null,reportSha256:sourceSha256,reportBytes:raw.length,
      reportSchema:ROZO_ACCOUNTANT_SOURCE_SCHEMA,reportCreatedAt:close.createdAt,
      periodClose:{id:close.id,revision:close.sequence,sha256:closeSha,schema:close.schema,period:clone(period)},
      rozo:{workspaceId:document.workspaceId,sourceRevision:document.sourceRevision,contextSha256:close.contextSha256,
        dataContext:close.dataContext,review:clone(close.review),totals:clone(close.totals),
        sourceCaptures:clone(close.sourceCaptures),excluded:clone(close.excluded)}}};
}
export function createRozoHandoff({rozoSourceBytes,name,actor,id=randomUUID(),createdAt=new Date().toISOString(),labels=[]}={}){
  const inspected=inspectRozoAccountantSource(rozoSourceBytes);
  recordId(id,'handoff');text(name,'handoff name',160);text(actor,'handoff owner',1000);iso(createdAt,'handoff time');
  fail(Array.isArray(labels)&&labels.length===0,'ROZO coding and asset labels come from the reviewed original native close.');
  const rows=inspected.rows.map(row=>({...row,rowId:rowId(id,inspected.sha256,row.sourceLineId),
    sourceRowSha256:jsonDigest(row.original),label:{assetLabel:row.original.tokenSymbol,
      unitLabel:'exact native units; '+row.original.decimals+' decimals',accountCode:row.original.accountCode,accountName:''}}));
  return seal({schema:ROZO_HANDOFF_SCHEMA,id,name,actor,createdAt,source:inspected.source,
    sourceHashes:{rozoSourceSha256:inspected.sha256,originalCloseSha256:inspected.closeSha256},
    sourceAccountingStatus:'ISSUED_ROZO_PERIOD',sourceOptions:[],labels:[],rows,
    summary:{totalRows:rows.length,providerEvidenceRows:rows.length,testnetRows:0,publicNetworkRows:0,
      dataContext:inspected.source.rozo.dataContext,totals:clone(inspected.source.rozo.totals)}});
}
export function validateRozoHandoff(handoff){
  fail(isRozoHandoff(handoff)&&HEX.test(handoff.integrity?.sha256),'Choose an original ROZO accountant handoff.');
  const {integrity,...body}=handoff;fail(jsonDigest(body)===integrity.sha256,'The original ROZO handoff changed.');
  recordId(handoff.id,'handoff');
  fail(handoff.source?.kind==='rozo-settlement-period'&&HEX.test(handoff.source.reportSha256)&&
    Array.isArray(handoff.rows)&&handoff.rows.length<=22000,'Retain the full ROZO handoff source and rows.');
  const seen=new Set();
  for(const row of handoff.rows){
    const original=row.original;
    fail(original&&row.sourceLineId===sourceLineId(handoff.source.rozo.workspaceId,handoff.source.periodClose.id,original)&&
      row.rowId===rowId(handoff.id,handoff.source.reportSha256,row.sourceLineId)&&row.sourceRowSha256===jsonDigest(original)&&
      !seen.has(row.rowId),'An original ROZO handoff line changed or repeats.');
    seen.add(row.rowId);
  }
  return handoff;
}
export function rozoProtectedValues(handoff,row){
  return {handoffId:handoff.id,sourceWorkspaceId:handoff.source.rozo.workspaceId,
    sourceCloseId:handoff.source.periodClose.id,sourceCloseSequence:handoff.source.periodClose.revision,
    sourceContextSha256:handoff.source.rozo.contextSha256,sourceAccountantSha256:handoff.source.reportSha256,
    rowId:row.rowId,sourceRowSha256:row.sourceRowSha256,...row.original,sourceLineId:row.sourceLineId,
    assetLabel:row.label.assetLabel,unitLabel:row.label.unitLabel,accountCodeLabel:row.label.accountCode,accountName:row.label.accountName};
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderRozoAccountantHtml(view,revision){
  const rows=view.rows.map(row=>{const value=row.original;return '<tr><td>'+esc(value.paymentId)+'<br>'+esc(value.classification)+'<br><small>'+esc(value.movementId)+'</small></td><td>'+esc(value.recognitionDate)+'<br><small>Provider '+esc(value.providerCreatedAt)+'</small></td><td>'+esc(value.amount)+' native units<br>'+esc(value.tokenSymbol)+' · '+esc(value.decimals)+' decimals<br><small>'+esc(value.chainId)+' / '+esc(value.network)+'<br>'+esc(value.tokenAddress)+'</small></td><td>'+esc(value.accountCode)+'<br>'+esc(value.costCenter)+' / '+esc(value.project)+'</td><td>'+esc(value.evidenceClass)+'<br><small>'+esc(value.receiptReference)+'<br>'+esc(value.reviewReason)+'</small></td><td>'+esc(row.externalStatus)+'<br>'+esc(row.externalBookRef)+'<br>'+esc(row.externalAccountCode)+'<br>'+esc(row.externalNote)+'</td></tr>';}).join('');
  return Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(view.name)+'</title><style>body{font:14px/1.5 system-ui;margin:24px;color:#20272a}main{max-width:1500px;margin:auto}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;vertical-align:top;border:1px solid #bcc5c9}small,code{overflow-wrap:anywhere}h1{font-size:28px}.scroll{overflow:auto}th{background:#edf1f3}dl{display:grid;grid-template-columns:160px 1fr;gap:8px}dd{margin:0}li{margin:8px 0}@media(max-width:600px){body{margin:12px}dl{display:block}dd{margin-bottom:10px}}</style></head><body><main><h1>'+esc(view.name)+'</h1><p>Original ROZO merchant receipts, provider fees and settlement transfers are separate classified movements. Amounts retain exact asset units. Provider confirmation remains provider evidence; no exchange rate, journal posting or independent chain proof is inferred.</p><dl><dt>Handoff</dt><dd>'+esc(view.id)+'</dd><dt>Original native close</dt><dd>'+esc(view.source.periodClose.id)+' / '+esc(view.source.periodClose.revision)+'</dd><dt>Source SHA-256</dt><dd><code>'+esc(view.source.reportSha256)+'</code></dd><dt>Data context</dt><dd>'+esc(view.source.rozo.dataContext)+'</dd><dt>Accountant return</dt><dd>'+esc(revision?.id??'Initial handoff')+'</dd></dl><div class="scroll"><table><thead><tr><th>Original movement</th><th>Recognition / source date</th><th>Exact amount and asset</th><th>Reviewed account dimensions</th><th>Original evidence</th><th>Returned accountant reference</th></tr></thead><tbody>'+rows+'</tbody></table></div><h2>Return findings</h2><ul>'+((revision?.issues??[]).map(issue=>'<li>'+esc(issue.code)+' — '+esc(issue.message)+'</li>').join('')||'<li>No returned conflicts.</li>')+'</ul></main></body></html>');
}

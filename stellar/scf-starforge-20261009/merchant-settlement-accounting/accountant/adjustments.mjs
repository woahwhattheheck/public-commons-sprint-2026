// MIT. Freeze original payment adjustments beside the accountant's gross rows.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ADJUSTMENT_EXPORT_SCHEMA,compileAdjustmentExport} from '../adjustments.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>structuredClone(value);
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'ACCOUNTANT_ADJUSTMENTS_CHANGED',status:409});};
const AMOUNTS=Object.freeze(['grossAmountAtomic','refundedAmountAtomic','pendingRefundAmountAtomic',
  'remainingAmountAtomic','availableRefundAmountAtomic','cancelledAmountAtomic','overRefundedAmountAtomic']);
export const ADJUSTMENT_COLUMNS=Object.freeze(['sourceAdjustmentsSha256',...AMOUNTS,
  'refundStatus','adjustmentCount','latestRefundTransferAt','latestCancellationEffectiveAt']);
const latest=values=>values.filter(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
  .sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;

/** Validate one frozen snapshot against the exact retained original report. */
export function freezeAccountantAdjustments({adjustmentsBytes,report,source,periodCloseDocument}={}){
  if(adjustmentsBytes===undefined||adjustmentsBytes===null){
    need(!source.adjustmentsSha256&&!periodCloseDocument?.adjustmentsSha256,'The selected adjustment snapshot must accompany this handoff.');
    return null;
  }
  need(Buffer.isBuffer(adjustmentsBytes)||adjustmentsBytes instanceof Uint8Array,'Retain the original adjustment bytes.');
  const raw=Buffer.from(adjustmentsBytes);
  need(raw.length>0&&raw.length<=128_000_000,'The selected adjustment snapshot exceeds the original report size limit.');
  const digest=hash(raw);let snapshot;
  try{snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{need(false,'The original adjustment snapshot must be complete UTF-8 JSON.');}
  need(snapshot?.schema===ADJUSTMENT_EXPORT_SCHEMA&&Array.isArray(snapshot.events)&&
    Number.isSafeInteger(snapshot.workspaceRevision)&&snapshot.workspaceRevision>=0&&
    typeof snapshot.exportedAt==='string'&&Number.isFinite(Date.parse(snapshot.exportedAt)),
    'Choose a completed original adjustment export.');
  need(source.adjustmentsSha256===digest,'The selected adjustment bytes changed before this handoff.');
  for(const key of ['runId','reportSha256','manifestSha256','inputManifestSha256'])
    need(snapshot.source?.[key]===source[key],'The adjustment snapshot belongs to another original reconciliation.');
  if(periodCloseDocument)need(periodCloseDocument.adjustmentsSha256===digest,
    'Use the adjustment snapshot frozen by this original period close.');
  need(isDeepStrictEqual(snapshot.originalReport,report)&&snapshot.events.length===report.ledger.length,
    'The adjustment snapshot must retain every exact original gross event.');
  const records=snapshot.events.flatMap(item=>{need(Array.isArray(item?.adjustments),'Retain each event adjustment history.');return item.adjustments;});
  const rebuilt=compileAdjustmentExport({report,source:snapshot.source,records,
    workspaceRevision:snapshot.workspaceRevision,exportedAt:snapshot.exportedAt});
  need(isDeepStrictEqual(rebuilt.events,snapshot.events)&&isDeepStrictEqual(rebuilt.period,snapshot.period)&&
    isDeepStrictEqual(rebuilt.dateBasis,snapshot.dateBasis),'The retained adjustment totals or native payment histories changed.');
  const rows=new Map(),groups=new Map();let refundedRows=0,cancelledRows=0,adjustedRows=0;
  for(const item of rebuilt.events){
    const original=item.original,totals=copy(item.totals);
    need(!rows.has(original.eventId),'A retained adjustment event is repeated.');
    const dates={latestRefundTransferAt:latest(item.adjustments.filter(record=>record.kind==='REFUND'&&record.status==='VERIFIED')
      .map(record=>record.verification?.transferAt)),
      latestCancellationEffectiveAt:latest(item.adjustments.filter(record=>record.kind==='CANCELLATION'&&record.status==='RECORDED')
        .map(record=>record.effectiveAt))};
    rows.set(original.eventId,{...totals,...dates});
    if(BigInt(totals.refundedAmountAtomic)>0n)refundedRows++;
    if(BigInt(totals.cancelledAmountAtomic)>0n)cancelledRows++;
    if(totals.adjustmentCount)adjustedRows++;
    const key=original.network+'\n'+original.assetDigest;
    let group=groups.get(key);
    if(!group){group={network:original.network,assetDigest:original.assetDigest,eventCount:0,
      ...Object.fromEntries(AMOUNTS.map(field=>[field,0n]))};groups.set(key,group);}
    group.eventCount++;for(const field of AMOUNTS)group[field]+=BigInt(totals[field]);
  }
  return {source:{schema:snapshot.schema,sha256:digest,bytes:raw.length,workspaceRevision:snapshot.workspaceRevision,
    exportedAt:snapshot.exportedAt,dateBasis:copy(snapshot.dateBasis)},rows,
    summary:{adjustedRows,refundedRows,cancelledRows,adjustmentCount:records.length,
      groups:[...groups.values()].map(group=>({...group,...Object.fromEntries(AMOUNTS.map(field=>[field,String(group[field])]))}))}};
}

export function validateAccountantAdjustmentRow(row){
  const totals=row.adjustments;
  need(totals&&totals.grossAmountAtomic===row.original.amountAtomic,'The adjustment row must preserve its original gross amount.');
  for(const field of AMOUNTS)need(typeof totals[field]==='string'&&/^-?(?:0|[1-9][0-9]*)$/.test(totals[field])&&
    (field==='remainingAmountAtomic'||BigInt(totals[field])>=0n),'Retain exact atomic adjustment amounts.');
  const gross=BigInt(totals.grossAmountAtomic),returned=BigInt(totals.refundedAmountAtomic),remaining=gross-returned;
  need(remaining===BigInt(totals.remainingAmountAtomic)&&
    BigInt(totals.overRefundedAmountAtomic)===(remaining<0n?-remaining:0n)&&
    BigInt(totals.availableRefundAmountAtomic)===(remaining-BigInt(totals.pendingRefundAmountAtomic)>0n?
      remaining-BigInt(totals.pendingRefundAmountAtomic):0n)&&
    totals.refundStatus===(returned===0n?'NONE':returned<gross?'PARTIAL':returned===gross?'FULL':'OVER_RETURNED')&&
    Number.isSafeInteger(totals.adjustmentCount)&&totals.adjustmentCount>=0,
    'The retained return, remaining or refund status changed.');
  return totals;
}

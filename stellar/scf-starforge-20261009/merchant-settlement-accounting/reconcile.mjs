// MIT. Original SF98 outbox + original SF86 official Stellar proof -> private merchant ledger.
// Read-only. A native SDK success is not independent ledger verification or fiat revenue.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { openOutbox } from '../sf98-merchant-delivery/outbox.mjs';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';
import { RPC_NETWORKS, validStrKey } from '../sf86-rpc-transfer-reconcile/terms.mjs';

export const SCHEMA = 'stellar-forge.merchant-reconciliation.v1';
const RECOVERED = 'RECOVERED_ORIGINAL_SF31_OUTCOME';
const LOST_OUTPUT_PROOF = 'stellar-forge.sf88.lost-output-verified-transfer.v1';
const LOST_OUTPUT_ORIGIN = 'ORIGINAL_SF43_VERIFIED_TRANSFER_RECOVERY';
const LOST_OUTPUT_AUTHORITY = 'ORIGINAL_SF36_HMAC_JOURNAL_AND_SEALED_LOST_OUTPUT_RECOVERY';
const sha = x => createHash('sha256').update(x).digest('hex');
const hex64 = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const paymentDecimal = x => typeof x === 'string' && /^[1-9][0-9]{0,38}$/.test(x)&&BigInt(x)<(1n<<127n);
const routeId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
const knownNetwork = x => x === 'stellar:testnet' || x === 'stellar:pubnet';
const routeKey = x => x.routeId+'\n'+x.method;
const optionBaseKey = x => [x.routeId,x.method,x.network,x.assetDigest,x.amountAtomic].join('\n');
const optionKey = x => optionBaseKey(x)+'\n'+(x.recipientDigest ?? '?');
const optionId = x => sha('stellar-forge.merchant-option.v1\n'+optionKey(x));
const REASON = Object.freeze({
  noProof: 'NO_ORIGINAL_OFFICIAL_VERIFICATION',
  noTx: 'NATIVE_RECEIPT_HAS_NO_TRANSACTION_FINGERPRINT',
  conflict: 'CONFLICTING_OR_REUSED_VERIFICATION',
  different: 'PROOF_TERMS_DIFFER_FROM_NATIVE_SELLER',
  missingTerms: 'MERCHANT_ROUTE_TERMS_NOT_CONFIGURED',
  mappingMismatch: 'MERCHANT_TERMS_DIFFER_FROM_NATIVE_OFFER',
  ambiguousTerms: 'LEGACY_EVENT_MATCHES_MULTIPLE_RECIPIENT_OPTIONS',
  publicNetwork: 'PUBLIC_NETWORK_VERIFICATION_PENDING',
});
const microRegex = /^(0|[1-9]\d{0,11})(?:\.(\d{1,6}))?$/;
const money = x => {
  if (typeof x !== 'string') throw new TypeError('USD monetary inputs must be decimal strings');
  const m = microRegex.exec(x);
  if (!m) throw new TypeError('USD amounts: 0..999999999999 with up to six decimal places');
  return BigInt(m[1])*1_000_000n + BigInt((m[2] ?? '').padEnd(6,'0'));
};
const display = x => {
  if (x === null) return null;
  const s = (x < 0n ? -x : x).toString().padStart(7,'0');
  const whole = s.slice(0,-6);
  const fraction = s.slice(-6).replace(/0+$/,'');
  return (x < 0n ? '-' : '') + whole + (fraction ? '.'+fraction : '');
};
const toUsd = v => (v === null ? null : display(v));
const strictObject = x => x && typeof x === 'object' && !Array.isArray(x);
const readPlain = async (path,max,{allowEmpty=false}={}) => {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max || (!allowEmpty && s.size === 0))
    throw new Error('SOURCE_FILE_UNSAFE_OR_TOO_LARGE');
  const handle = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const bytes = await handle.readFile();
    if (bytes.length > max) throw new Error('SOURCE_FILE_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
};
const safeDir = async (path) => {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path)!==path || path==='/')
    throw new TypeError('ABSOLUTE_NORMALIZED_PRIVATE_DIRECTORY_REQUIRED');
  const s=await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077)!==0)
    throw new Error('DIRECTORY_MUST_BE_PRIVATE_0700');
};
const parseJson = (bytes,label) => {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('INVALID_JSON:'+label); }
};
// A reporting period selects recorded activity. Native rows use their capture
// time; recovered rows use import time, never an inferred ledger-close date.
export function compileAccountingPeriod(raw) {
  if(raw===undefined||raw===null)return null;
  if(!strictObject(raw)||Object.keys(raw).some(key=>!['from','until'].includes(key)))
    throw new Error('INVALID_ACCOUNTING_PERIOD');
  const instant=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
      throw new Error('ACCOUNTING_PERIOD_REQUIRES_UTC_INSTANTS');
    const date=new Date(value),normalized=value.includes('.')?value:value.replace('Z','.000Z');
    if(!Number.isFinite(date.getTime())||date.toISOString()!==normalized)
      throw new Error('INVALID_ACCOUNTING_PERIOD_INSTANT');
    return normalized;
  };
  const from=instant(raw.from),until=instant(raw.until);
  if(from>=until)throw new Error('ACCOUNTING_PERIOD_END_MUST_FOLLOW_START');
  return {from,until};
}
export function compileTerms(raw) {
  if (!strictObject(raw) || raw.schema !== 'stellar-forge.merchant-accounting-terms.v1' ||
      !Array.isArray(raw.routes) || raw.routes.length<1 || raw.routes.length>200)
    throw new Error('INVALID_MERCHANT_TERMS_SCHEMA');
  const terms=new Map();
  for (const r of raw.routes) {
    if (!strictObject(r) || !routeId(r.routeId) || !supportsSellerMethod(r.method) ||
        !knownNetwork(r.network) || !paymentDecimal(r.amountAtomic) ||
        !validStrKey(r.asset,'C') || !(validStrKey(r.payTo,'G')||validStrKey(r.payTo,'C')) ||
        typeof r.priceBasis!=='string' || !/^[A-Za-z0-9 _.:/-]{3,100}$/.test(r.priceBasis) ||
        r.unitPriceUsd===undefined || r.unitCostUsd===undefined)
      throw new Error('INVALID_MERCHANT_ROUTE_TERMS');
    const value={...r,assetDigest:sha(r.asset),recipientDigest:sha(r.payTo),
      price:r.unitPriceUsd===null ? null : money(r.unitPriceUsd),
      cost:r.unitCostUsd===null ? null : money(r.unitCostUsd)};
    const k=optionKey(value);
    if (terms.has(k)) throw new Error('DUPLICATE_MERCHANT_ROUTE_TERMS');
    terms.set(k,{...value,optionId:optionId(value)});
  }
  return terms;
}

function indexTerms(terms) {
  const routes=new Set(),byObservedTerms=new Map();
  for(const term of terms.values()) {
    routes.add(routeKey(term));
    const key=optionBaseKey(term),prior=byObservedTerms.get(key) ?? [];
    prior.push(term);byObservedTerms.set(key,prior);
  }
  return {routes,byObservedTerms};
}
function resolveTerms(event,terms,{routes,byObservedTerms}) {
  if(!routes.has(routeKey(event)))
    return {term:null,match:'MISSING_ROUTE_TERMS',candidateCount:0,reason:REASON.missingTerms};
  if(event.recipientDigest) {
    const term=terms.get(optionKey(event)) ?? null;
    return {term,match:term?'EXACT_OPTION':'OPTION_TERMS_MISMATCH',candidateCount:term?1:0,
      reason:term?null:REASON.mappingMismatch};
  }
  // Older journals did not record the recipient. Use only the actual remaining
  // five terms; a proof or the first configured option cannot select a payee.
  const candidates=byObservedTerms.get(optionBaseKey(event)) ?? [];
  if(candidates.length===1)
    return {term:candidates[0],match:'LEGACY_UNIQUE_OPTION',candidateCount:1,reason:null};
  return {term:null,match:candidates.length?'AMBIGUOUS_LEGACY_OPTIONS':'OPTION_TERMS_MISMATCH',
    candidateCount:candidates.length,reason:candidates.length?REASON.ambiguousTerms:REASON.mappingMismatch};
}

// This is the original SF88 export after SF36 verifies its sealed recovery and
// authenticated ledger. Its source is distinct from an SF86 RPC export; the
// merchant event remains the original native SF98 settlement capture.
function lostOutputProofCheck(p,fileDigest) {
  const originalSourceKeys=['request','sourceConfig','configuration','attempt','workspaceConfig','workspaceManifest'];
  const identifiers=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
  const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const sources=p?.sourceHashes,evidence=p?.evidenceState;
  if(!strictObject(p)||p.schema!==LOST_OUTPUT_PROOF||p.origin!==LOST_OUTPUT_ORIGIN||
    p.proof!=='RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH'||p.reservation!=='ORIGINAL_SF36_FINALIZED'||
    p.sellerReport!=='LOCAL_OUTPUT_LOST_AFTER_PAYMENT'||p.recordAuthority!==LOST_OUTPUT_AUTHORITY||
    !hex64(fileDigest)||!identifiers(p.intentId)||!identifiers(p.attemptId)||
    !hex64(p.configSha256)||!hex64(p.requestSha256)||!hex64(p.transaction)||!knownNetwork(p.network)||
    !validStrKey(p.asset,'C')||!(validStrKey(p.payer,'G')||validStrKey(p.payer,'C'))||
    !(validStrKey(p.recipient,'G')||validStrKey(p.recipient,'C'))||
    !paymentDecimal(p.atomicAmount)||
    !Number.isSafeInteger(p.ledger)||p.ledger<=0||typeof p.matchingEventId!=='string'||
    p.matchingEventId.length<1||p.matchingEventId.length>1024||/[\u0000-\u001f\u007f]/.test(p.matchingEventId)||
    !instant(p.attemptStartedAt)||!instant(p.observedAt)||!instant(p.completedAt)||Date.parse(p.completedAt)<Date.parse(p.observedAt)||
    typeof p.transactionCreatedAt!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(p.transactionCreatedAt)||
    !Number.isSafeInteger(Number(p.transactionCreatedAt))||
    Number(p.transactionCreatedAt)<Math.floor(Date.parse(p.attemptStartedAt)/1000)||
    Number(p.transactionCreatedAt)>Math.floor(Date.parse(p.observedAt)/1000)||
    !hex64(p.sealedRecoverySha256)||!strictObject(sources)||
    !originalSourceKeys.every(key=>hex64(sources[key]))||sources.configuration!==p.configSha256||
    !(sources.body===null||hex64(sources.body))||!(sources.evidence===null||hex64(sources.evidence))||
    !strictObject(evidence)||evidence.sha256!==sources.evidence||
    !Number.isSafeInteger(evidence.bytes)||evidence.bytes<0||evidence.bytes>4_000_000)return false;
  if(evidence.condition==='ABSENT')return evidence.bytes===0&&evidence.sha256===null;
  if(evidence.condition==='EMPTY')return evidence.bytes===0&&evidence.sha256===sha(Buffer.alloc(0));
  return evidence.condition==='INVALID_JSON'&&evidence.bytes>0&&hex64(evidence.sha256);
}

// Network and provider authority travel together; a transaction fingerprint on
// another ledger cannot consume or invalidate this ledger's verification.
export function indexOriginalVerifications(documents) {
  if (!Array.isArray(documents) || documents.length>2000) throw new Error('TOO_MANY_PROOF_FILES');
  const index=new Map();
  const ignored=[];
  for (const doc of documents) {
    const p=doc.data;
    if(p?.schema===LOST_OUTPUT_PROOF) {
      if(!lostOutputProofCheck(p,doc.fileDigest)) {
        ignored.push({fileDigest:doc.fileDigest,reason:'INVALID_ORIGINAL_SF43_LOST_OUTPUT_PROOF'});continue;
      }
      const fingerprint=p.network+'\n'+sha(p.transaction),prior=index.get(fingerprint)||[];
      prior.push({data:p,fileDigest:doc.fileDigest});index.set(fingerprint,prior);continue;
    }
    if (!strictObject(p) || p.schema!=='stellar-forge.sf86.rpc-reconciliation.v1') {
      ignored.push({fileDigest:doc.fileDigest,reason:'NOT_AN_ORIGINAL_SF86_RESULT'}); continue;
    }
    if (p.verdict==='NOT_RECONCILED' || p.verdict==='LOCAL_RPC_REPLAY_MATCHED') {
      ignored.push({fileDigest:doc.fileDigest,reason:p.verdict}); continue;
    }
    const profile=Object.hasOwn(RPC_NETWORKS,p.network)?RPC_NETWORKS[p.network]:null;
    const pubnetAuthority=p.network!=='stellar:pubnet' || (profile?.endpoints.includes(p.rpcEndpoint) &&
      p.networkPassphrase===profile.passphrase && hex64(p.networkResultSha256) &&
      hex64(p.transactionResultSha256) && Array.isArray(p.eventPageSha256) &&
      p.eventPageSha256.length>0 && p.eventPageSha256.every(hex64));
    const originalReservation=p.reservation==='UNCHANGED_VERIFY_SEPARATELY';
    const reportedReceipt=p.reservation==='ABSENT_NO_SF81_RECORD' && p.origin===RECOVERED;
    if (!profile || p.verdict!==profile.verdict || p.source!==profile.source || !pubnetAuthority ||
        !(originalReservation || reportedReceipt) || p.matchingTransfers!==1 ||
        p.sellerReport!=='REPORTED_SUCCESS' ||
        !hex64(p.transaction) || typeof p.intentId!=='string' || !p.intentId ||
        !Number.isSafeInteger(p.ledger) || p.ledger<=0 ||
        typeof p.matchingEventId!=='string' || !p.matchingEventId ||
        !paymentDecimal(p.atomicAmount) || typeof p.asset!=='string' ||
        typeof p.recipient!=='string') {
      ignored.push({fileDigest:doc.fileDigest,reason:'INVALID_OFFICIAL_PROOF_FIELDS'}); continue;
    }
    const fingerprint=p.network+'\n'+sha(p.transaction);
    const proof={data:p,fileDigest:doc.fileDigest};
    const prior=index.get(fingerprint) || [];
    prior.push(proof);
    index.set(fingerprint,prior);
  }
  return {index,ignored};
}
function eventCheck(e) {
  return strictObject(e) && e.schema==='stellar-forge.sf98.delivery-event.v1' &&
    hex64(e.id) && hex64(e.receiptFingerprint) &&
    (e.transactionFingerprint===null || e.transactionFingerprint===undefined || hex64(e.transactionFingerprint)) &&
    routeId(e.routeId) && supportsSellerMethod(e.method) &&
    knownNetwork(e.network) && paymentDecimal(e.amountAtomic) && hex64(e.assetDigest) &&
    (e.recipientDigest===null || e.recipientDigest===undefined || hex64(e.recipientDigest)) &&
    e.authority==='ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS' &&
    typeof e.at==='string' && !Number.isNaN(Date.parse(e.at));
}
const deliveryOf = state => state?.state==='DELIVERED'?'WEBHOOK_ACCEPTED_NOT_FULFILLED':
  state?.state==='EXHAUSTED'?'DELIVERY_EXHAUSTED':
  state?.state==='RETRY'?'DELIVERY_RETRY':state?.state==='REQUEUE'?'DELIVERY_REQUEUED':'NOT_DELIVERED';
const publicRow = (e,proof,resolution,delivery,classification,reason) => {
  const terms=resolution.term;
  return {
  eventId:e.id, at:e.at,routeId:e.routeId,method:e.method,network:e.network,
  amountAtomic:e.amountAtomic, assetDigest:e.assetDigest,
  receiptFingerprint:e.receiptFingerprint,transactionFingerprint:e.transactionFingerprint ?? null,
  orderReferenceDigest:e.orderReference?sha(e.orderReference):null,
  transferEvidenceDigest:proof?.fileDigest ?? null,
  ...(proof?.data.schema===LOST_OUTPUT_PROOF?{
    verificationOrigin:LOST_OUTPUT_ORIGIN,verificationMatchBasis:'ORIGINAL_SF43_SELECTED_TRANSFER_EVENT',
    buyerRecovery:{intentId:proof.data.intentId,attemptId:proof.data.attemptId,
      configSha256:proof.data.configSha256,requestSha256:proof.data.requestSha256,
      attemptStartedAt:proof.data.attemptStartedAt,transactionCreatedAt:proof.data.transactionCreatedAt,
      observedAt:proof.data.observedAt,completedAt:proof.data.completedAt,
      sealedRecoverySha256:proof.data.sealedRecoverySha256,recordAuthority:proof.data.recordAuthority,
      sourceHashes:{...proof.data.sourceHashes},evidenceState:{...proof.data.evidenceState}}
  }:{}),
  ledger:classification==='OFFICIAL_TRANSFER_MATCHED'?proof.data.ledger:null,
  matchingEventDigest:classification==='OFFICIAL_TRANSFER_MATCHED'?sha(proof.data.matchingEventId):null,
  transfer:classification,delivery,exception:reason,
  merchantQuoteUsd:terms?.price===null || !terms?null:toUsd(terms.price),
  merchantVariableCostUsd:terms?.cost===null || !terms?null:toUsd(terms.cost),
  // merchant-provided USD valuation ONLY for the independently verified tier;
  // even this is NOT recognized accounting revenue or a settled bank receipt.
  verifiedQuotedValueUsd:classification==='OFFICIAL_TRANSFER_MATCHED'&&terms?.price!==null?toUsd(terms.price):null,
  recipientDigest:e.recipientDigest ?? null,
  termsRecipientDigest:terms?.recipientDigest ?? null,
  optionId:optionId({...e,recipientDigest:e.recipientDigest ?? terms?.recipientDigest ?? null}),
  termsMatch:resolution.match,termsCandidateCount:resolution.candidateCount,
  merchantPriceBasis:terms?.priceBasis ?? null,
  verificationScope:e.network==='stellar:testnet'?'OFFICIAL_TESTNET_ONLY':
    classification==='OFFICIAL_TRANSFER_MATCHED'?'OFFICIAL_PUBNET_RPC':'PUBLIC_NETWORK_PENDING',
  };
};
const exceptionRow = (row,reason) => ({eventId:row.eventId,routeId:row.routeId,reason,
  method:row.method,network:row.network,optionId:row.optionId,termsMatch:row.termsMatch});
const transactionKey = row => row.network+'\n'+row.transactionFingerprint;

function summarizeOptions(results,terms) {
  const groups=new Map();
  const makeGroup=(identity,term=null)=>({optionId:optionId(identity),
    routeId:identity.routeId,method:identity.method,network:identity.network,
    assetDigest:identity.assetDigest,amountAtomic:identity.amountAtomic,
    recipientDigest:identity.recipientDigest ?? null,configuredOption:Boolean(term),
    merchantQuoteUsd:term?.price===null || !term?null:toUsd(term.price),
    merchantVariableCostUsd:term?.cost===null || !term?null:toUsd(term.cost),
    merchantPriceBasis:term?.priceBasis ?? null,
    nativeSuccessEvents:0,recoveredSettlements:0,officialTransferMatches:0,missingTransferEvidence:0,
    webhookAccepted:0,legacyRecipientEvents:0,unresolvedTermsEvents:0,
    nativeAmount:0n,recoveredAmount:0n,matchedAmount:0n,verifiedQuote:0n,withQuote:true});
  // Keep configured options visible even when they have no native events.
  for(const term of terms.values())groups.set(term.optionId,makeGroup(term,term));
  for(const row of results) {
    const identity={...row,recipientDigest:row.recipientDigest ?? row.termsRecipientDigest};
    const group=groups.get(row.optionId) ?? makeGroup(identity);
    if(row.origin===RECOVERED){group.recoveredSettlements++;group.recoveredAmount+=BigInt(row.amountAtomic);}
    else {group.nativeSuccessEvents++;group.nativeAmount+=BigInt(row.amountAtomic);}
    if(!row.recipientDigest)group.legacyRecipientEvents++;
    if(!['EXACT_OPTION','LEGACY_UNIQUE_OPTION'].includes(row.termsMatch))group.unresolvedTermsEvents++;
    if(row.transfer==='OFFICIAL_TRANSFER_MATCHED') {
      group.officialTransferMatches++;group.matchedAmount+=BigInt(row.amountAtomic);
      if(row.verifiedQuotedValueUsd===null)group.withQuote=false;
      else group.verifiedQuote+=money(row.verifiedQuotedValueUsd);
    } else group.missingTransferEvidence++;
    if(row.delivery==='WEBHOOK_ACCEPTED_NOT_FULFILLED')group.webhookAccepted++;
    groups.set(row.optionId,group);
  }
  return [...groups.values()].sort((a,b)=>routeKey(a).localeCompare(routeKey(b))||optionKey(a).localeCompare(optionKey(b)))
    .map(({nativeAmount,recoveredAmount,matchedAmount,verifiedQuote,withQuote,...group})=>({...group,
      nativeAmountAtomic:nativeAmount.toString(),recoveredAmountAtomic:recoveredAmount.toString(),
      officialMatchedAmountAtomic:matchedAmount.toString(),
      verifiedQuotedValueUsd:withQuote?toUsd(verifiedQuote):null}));
}

function recoveredRow(entry) {
  const e=entry?.data,p=entry?.proof?.data;
  if(!strictObject(e) || e.schema!=='stellar-forge.merchant-recovered-settlement.v1' ||
    e.origin!==RECOVERED || !hex64(entry.fileDigest) || !hex64(entry.proof?.fileDigest) ||
    !hex64(e.recoveryId) || !hex64(e.transaction) || !hex64(e.receiptFingerprint) ||
    e.recoveryId!==sha(e.network+'\n'+e.transaction) || !routeId(e.routeId) ||
    !supportsSellerMethod(e.method) || !knownNetwork(e.network) || !paymentDecimal(e.amountAtomic) ||
    typeof e.asset!=='string' || typeof e.recipient!=='string' || typeof e.payer!=='string' ||
    typeof e.importedAt!=='string' || Number.isNaN(Date.parse(e.importedAt)) ||
    !strictObject(p) || p.origin!==RECOVERED || p.reservation!=='ABSENT_NO_SF81_RECORD' ||
    p.transaction!==e.transaction || p.network!==e.network || p.intentId!==e.intentId ||
    p.payer!==e.payer || p.asset!==e.asset || p.recipient!==e.recipient || p.atomicAmount!==e.amountAtomic)
    throw new Error('RECOVERED_SOURCE_OR_PROOF_INVALID');
  return {event:{schema:e.schema,id:e.recoveryId,at:e.importedAt,routeId:e.routeId,
    method:e.method,network:e.network,amountAtomic:e.amountAtomic,assetDigest:sha(e.asset),
    recipientDigest:sha(e.recipient),receiptFingerprint:e.receiptFingerprint,
    transactionFingerprint:sha(e.transaction)},state:null,recovery:entry};
}

export function compileLedger(rows,termsRaw,proofDocs,{recoveredEntries=[],period:rawPeriod}={}) {
  if (!Array.isArray(rows) || rows.length>20_000) throw new Error('OUTBOX_SIZE_UNSUPPORTED');
  if(!Array.isArray(recoveredEntries) || recoveredEntries.length>2000)
    throw new Error('RECOVERED_SOURCE_SIZE_UNSUPPORTED');
  const period=compileAccountingPeriod(rawPeriod),terms=compileTerms(termsRaw);
  const termsIndex=indexTerms(terms);
  const recoveredRows=recoveredEntries.map(recoveredRow);
  const documents=[...proofDocs],proofDigests=new Set(proofDocs.map(x=>x.fileDigest));
  for(const row of recoveredRows)if(!proofDigests.has(row.recovery.proof.fileDigest)){
    documents.push(row.recovery.proof);proofDigests.add(row.recovery.proof.fileDigest);
  }
  const {index,ignored}=indexOriginalVerifications(documents);
  const seen=new Set(), refCount=new Map();let results=[],exceptions=[];
  for(const row of [...rows.map(({event,state})=>({event,state})),...recoveredRows]){
    const e=row.event;
    if (!row.recovery && !eventCheck(e)) throw new Error('ORIGINAL_OUTBOX_EVENT_INVALID');
    if(seen.has(e.id)) throw new Error('DUPLICATE_OUTBOX_EVENT_ID');
    seen.add(e.id);
    const resolution=resolveTerms(e,terms,termsIndex),term=resolution.term;
    const proofs=e.transactionFingerprint?index.get(transactionKey(e))||[]:[];
    if (e.transactionFingerprint) refCount.set(transactionKey(e),
      (refCount.get(transactionKey(e))||0)+1);
    let proof=null,reason=null,kind=row.recovery?'RECOVERED_SUCCESS_UNVERIFIED':'NATIVE_SUCCESS_UNVERIFIED';
    if (resolution.reason) reason=resolution.reason;
    else if (!e.transactionFingerprint) reason=REASON.noTx;
    else if (!proofs.length) reason=e.network==='stellar:pubnet'?REASON.publicNetwork:REASON.noProof;
    else if (proofs.length!==1) reason=REASON.conflict;
    else {
      const p=proofs[0].data;
      if (p.network!==e.network || p.atomicAmount!==e.amountAtomic ||
          p.asset!==term.asset || p.recipient!==term.payTo ||
          sha(p.asset)!==e.assetDigest ||
          (e.recipientDigest && sha(p.recipient)!==e.recipientDigest) ||
          (row.recovery && (p.payer!==row.recovery.data.payer || p.intentId!==row.recovery.data.intentId)))
        reason=REASON.different;
      else { proof=proofs[0]; kind='OFFICIAL_TRANSFER_MATCHED'; }
    }
    const delivery=row.recovery?(row.recovery.data.response?'RECOVERED_RESPONSE_SAVED':'RECOVERED_RESPONSE_NOT_RETAINED'):
      deliveryOf(row.state);
    const result=publicRow(e,proof,resolution,delivery,kind,reason);
    Object.assign(result,{origin:row.recovery?RECOVERED:'SF98_NATIVE_CAPTURE',
      timeBasis:row.recovery?'RECOVERY_IMPORTED_AT':'NATIVE_SETTLEMENT_CAPTURED_AT',
      recoveryId:row.recovery?.data.recoveryId ?? null,
      recoveredEntryDigest:row.recovery?.fileDigest ?? null,
      recoveredResponseSha256:row.recovery?.data.response?.sha256 ?? null,
      recoveredResponseBytes:row.recovery?.data.response?.bytes ?? null});
    results.push(result);
    if(reason) exceptions.push(exceptionRow(result,reason));
    if(delivery==='DELIVERY_EXHAUSTED') exceptions.push(exceptionRow(result,'WEBHOOK_DELIVERY_EXHAUSTED'));
  }
  // Existing transaction-reuse treatment applies across captured and recovered sources.
  for(const r of results) {
    if(r.transfer==='OFFICIAL_TRANSFER_MATCHED' && refCount.get(transactionKey(r))>1){
      r.transfer='REUSED_TRANSACTION_UNVERIFIED'; r.exception=REASON.conflict;
      r.verifiedQuotedValueUsd=null;r.ledger=null;r.matchingEventDigest=null;
      if(r.network==='stellar:pubnet')r.verificationScope='PUBLIC_NETWORK_PENDING';
      exceptions.push(exceptionRow(r,REASON.conflict));
    }
  }
  // Verification, conflicting evidence, and transaction reuse above always see
  // the complete captured source. An outside-period row can still invalidate a
  // reused transaction inside the period. Proof coverage also stays full-source.
  const used=new Set(results.filter(x=>x.transfer==='OFFICIAL_TRANSFER_MATCHED').map(transactionKey));
  const unmatched=[...index.entries()].filter(([digest])=>!used.has(digest));
  let periodSummary;
  if(period){
    const count=(items,issues)=>({events:items.length,
      nativeSuccessEvents:items.filter(row=>row.origin!==RECOVERED).length,
      recoveredSettlements:items.filter(row=>row.origin===RECOVERED).length,
      officialTransferMatches:items.filter(row=>row.transfer==='OFFICIAL_TRANSFER_MATCHED').length,
      requiringReconciliation:items.filter(row=>row.transfer!=='OFFICIAL_TRANSFER_MATCHED').length,
      exceptionRows:issues.length});
    const sourceCounts=count(results,exceptions),from=Date.parse(period.from),until=Date.parse(period.until);
    results=results.filter(row=>{const at=Date.parse(row.at);return at>=from&&at<until;});
    const selected=new Set(results.map(row=>row.eventId));
    exceptions=exceptions.filter(row=>selected.has(row.eventId));
    const selectedCounts=count(results,exceptions);
    periodSummary={schema:'stellar-forge.merchant-recorded-period.v1',...period,
      selection:'FROM_INCLUSIVE_UNTIL_EXCLUSIVE',verificationScope:'ALL_CAPTURED_SOURCES_BEFORE_PERIOD_SELECTION',
      proofCoverageScope:'ALL_CAPTURED_SOURCES',timeBasis:{SF98_NATIVE_CAPTURE:'NATIVE_SETTLEMENT_CAPTURED_AT',
        [RECOVERED]:'RECOVERY_IMPORTED_AT'},sourceCounts,selectedCounts,
      excludedCounts:Object.fromEntries(Object.keys(sourceCounts).map(key=>[key,sourceCounts[key]-selectedCounts[key]]))};
  }
  const byRoute=new Map();
  let totalQuote=0n,hasAllQuote=true;
  for(const r of results){
    const key=r.routeId+'\n'+r.method;
    const x=byRoute.get(key)||{routeId:r.routeId,method:r.method,nativeSuccessEvents:0,recoveredSettlements:0,
      officialTransferMatches:0,webhookAccepted:0,missingTransferEvidence:0,
      verifiedQuotedValueMicro:0n,withQuote:true};
    if(r.origin===RECOVERED)x.recoveredSettlements++;else x.nativeSuccessEvents++;
    if(r.transfer==='OFFICIAL_TRANSFER_MATCHED'){
      x.officialTransferMatches++;
      if(r.verifiedQuotedValueUsd!==null) x.verifiedQuotedValueMicro+=money(r.verifiedQuotedValueUsd);
      else x.withQuote=false;
    } else x.missingTransferEvidence++;
    if(r.delivery==='WEBHOOK_ACCEPTED_NOT_FULFILLED') x.webhookAccepted++;
    byRoute.set(key,x);
  }
  const routeSummaries=[...byRoute.values()].sort((a,b)=>a.routeId.localeCompare(b.routeId)||a.method.localeCompare(b.method))
    .map(x=>{
      if(!x.withQuote)hasAllQuote=false;
      totalQuote+=x.verifiedQuotedValueMicro;
      return {routeId:x.routeId,method:x.method,nativeSuccessEvents:x.nativeSuccessEvents,
        recoveredSettlements:x.recoveredSettlements,
        officialTransferMatches:x.officialTransferMatches,
        missingTransferEvidence:x.missingTransferEvidence,webhookAccepted:x.webhookAccepted,
        verifiedQuotedValueUsd:x.withQuote?toUsd(x.verifiedQuotedValueMicro):null};
    });
  return {
    ...(periodSummary?{period:periodSummary}:{}),
    ledger:results.sort((a,b)=>a.at.localeCompare(b.at)||a.eventId.localeCompare(b.eventId)),
    exceptions,
    ignoredProofs:ignored,
    unmatchedOfficialProofCount:unmatched.reduce((n,[,arr])=>n+arr.length,0),
    routes:routeSummaries,
    options:summarizeOptions(results,terms),
    totals:{nativeSuccessEvents:results.filter(x=>x.origin!==RECOVERED).length,
      recoveredSettlements:results.filter(x=>x.origin===RECOVERED).length,
      recoveredResponseFiles:results.filter(x=>x.recoveredResponseSha256!==null).length,
      officialTransferMatches:results.filter(x=>x.transfer==='OFFICIAL_TRANSFER_MATCHED').length,
      requiringReconciliation:results.filter(x=>x.transfer!=='OFFICIAL_TRANSFER_MATCHED').length,
      webhookAccepted:results.filter(x=>x.delivery==='WEBHOOK_ACCEPTED_NOT_FULFILLED').length,
      exhaustedDelivery:results.filter(x=>x.delivery==='DELIVERY_EXHAUSTED').length,
      verifiedQuotedValueUsd:hasAllQuote?toUsd(totalQuote):null,
      publicNetworkPending:results.filter(x=>x.network==='stellar:pubnet'&&x.transfer!=='OFFICIAL_TRANSFER_MATCHED').length,
      ambiguousLegacyEvents:results.filter(x=>x.termsMatch==='AMBIGUOUS_LEGACY_OPTIONS').length,
      unresolvedTermsEvents:results.filter(x=>!['EXACT_OPTION','LEGACY_UNIQUE_OPTION'].includes(x.termsMatch)).length},
  };
}
export async function runOriginalAccounting({outboxDir,proofDir,termsFile,recoveredDir,period}) {
  await safeDir(outboxDir);
  await safeDir(proofDir);
  const termsBytes=await readPlain(termsFile,200_000);
  const terms=parseJson(termsBytes,'merchant-terms');
  const files=(await readdir(proofDir)).sort();
  if(files.length>2000) throw new Error('PROOF_DIRECTORY_TOO_LARGE');
  const docs=[];
  for(const name of files){
    if(!/^[A-Za-z0-9._-]{1,150}\.json$/.test(name) || name==='.' || name==='..')
      throw new Error('UNEXPECTED_PROOF_DIRECTORY_ENTRY');
    const bytes=await readPlain(join(proofDir,name),80_000);
    docs.push({data:parseJson(bytes,'proof'),fileDigest:sha(bytes)});
  }
  // Reuse original SF98 journal reader and idempotency/conflicting-ID checks.
  const outbox=await openOutbox(outboxDir);
  const rows=await outbox.rows();
  const recovered=recoveredDir===undefined?{entries:[],hashes:[]}:
    await (await import('./recovery.mjs')).readRecoveredSettlements(recoveredDir);
  const ledger=compileLedger(rows,terms,docs,{recoveredEntries:recovered.entries,period});
  const hashes={termsSha256:sha(termsBytes),
    originalSf98EventsSha256:await hashOptional(join(outboxDir,'events.ndjson')),
    originalSf98DeliveriesSha256:await hashOptional(join(outboxDir,'deliveries.ndjson')),
    originalSf86ProofSha256:docs.map(x=>x.fileDigest),
    recoveredSettlementSha256:recovered.hashes,
    recoveredSf86ProofSha256:recovered.entries.map(x=>x.proof.fileDigest)};
  return {schema:SCHEMA,createdAt:new Date().toISOString(),...ledger,hashes,
    accountingStatus:'INDEPENDENT_TRANSFER_RECONCILIATION_ONLY_NOT_RECOGNIZED_REVENUE',
    policy:'No fiat exchange rate, refunds, tax, invoice, client entitlement, bank receipt or merchant cash flow inferred.'};
}
async function hashOptional(path){
  try {return sha(await readPlain(path,16_000_000,{allowEmpty:true}));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}

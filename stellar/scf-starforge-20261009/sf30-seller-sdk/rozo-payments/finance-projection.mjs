// MIT. Typed financial facts over one complete original ROZO report.
import { assert, fields, id, text, sha, iso, clone, canonical, jsonDigest, assetKey } from './model.mjs';
import { inspectRozoFinanceSource, rozoFinanceFacts } from './finance-source.mjs';

export const ROZO_MOVEMENTS_SCHEMA='stellar-forge.rozo-finance-movements.v1';
export const ROZO_PURCHASE_SELECTION_SCHEMA='stellar-forge.rozo-buyer-selection.v1';
const KINDS=Object.freeze(['source_payment','source_fee','destination_payout']);
const fail=(ok,message)=>assert(ok,'ROZO_FINANCE_SELECTION',message,409);

export function rozoFinanceMovements(input){
  const inspected=inspectRozoFinanceSource(input),facts=rozoFinanceFacts(inspected.source);
  const movements=facts.facts.flatMap(payment=>payment.movements.map(movement=>{
    const key='rozo-movement-'+jsonDigest({originId:facts.originId,profileId:payment.profileId,paymentId:payment.paymentId,kind:movement.kind});
    const financial={paymentId:payment.paymentId,kind:movement.kind,providerProfile:payment.providerProfile,
      providerStatus:payment.providerStatus,appId:payment.appId,orderId:payment.orderId,
      internalOrderId:payment.internalOrderId,amount:movement.amount,observation:movement.observation,
      merchantSettlement:payment.merchantSettlement,fulfilment:payment.fulfilment,
      unresolved:payment.unresolved,issues:payment.issues,contractLinks:payment.contractLinks};
    const amount=movement.amount;
    const observed=Boolean(amount?.asset&&typeof amount.units==='string'&&/^(?:0|[1-9][0-9]*)$/.test(amount.units));
    const confirmed=movement.observation?.state==='provider_confirmed';
    const reference=movement.observation?.txHash??null;
    const value={id:key,paymentKey:payment.id,paymentId:payment.paymentId,kind:movement.kind,
      profileId:payment.profileId,appId:payment.appId,orderId:payment.orderId,internalOrderId:payment.internalOrderId,
      providerProfile:payment.providerProfile,providerStatus:payment.providerStatus,
      amount:clone(amount),assetKey:amount?.asset?assetKey(amount.asset):null,
      observation:clone(movement.observation),providerConfirmed:confirmed,amountObserved:observed,
      evidenceClass:confirmed?'PROVIDER_CONFIRMED':'PROVIDER_'+String(movement.observation?.state??'UNOBSERVED').toUpperCase(),
      sourceDay:payment.providerCreatedAt?iso(payment.providerCreatedAt,'original provider creation time').slice(0,10):null,
      providerCreatedAt:payment.providerCreatedAt,providerUpdatedAt:payment.providerUpdatedAt,
      sourceObservationId:payment.sourceObservationId,sourceObservationSha256:payment.sourceObservationSha256,
      merchantSettlement:clone(payment.merchantSettlement),fulfilment:clone(payment.fulfilment),
      issues:clone(payment.issues),unresolved:clone(payment.unresolved),contractLinks:clone(payment.contractLinks),
      receiptReference:reference,basisSha256:jsonDigest(financial)};
    return value;
  }));
  return {schema:ROZO_MOVEMENTS_SCHEMA,sourceId:facts.sourceId,sourceSha256:facts.sourceSha256,
    originId:facts.originId,workspaceId:facts.workspaceId,profileId:inspected.profileId,
    reportId:facts.reportId,reportSha256:facts.reportSha256,movements};
}

/** A buyer explicitly identifies its own original purchase. Merchant payments
 * and destination payouts never enter this selection by inference. */
export function validateRozoBuyerSelection(input,selection){
  const facts=rozoFinanceMovements(input);
  fields(selection,['schema','sourceId','purchases'],'ROZO buyer selection');
  fail(selection.schema===ROZO_PURCHASE_SELECTION_SCHEMA&&selection.sourceId===facts.sourceId,
    'Select purchases from this exact original ROZO source.');
  fail(Array.isArray(selection.purchases)&&selection.purchases.length<=10000,
    'Select up to 10,000 original purchases; an empty selection retains the report as reference only.');
  const seen=new Set(),byId=new Map(facts.movements.map(row=>[row.id,row]));
  const purchases=selection.purchases.map(selected=>{
    fields(selected,['movementId','basisSha256','purchaseOwner','purchaseReference','reason'],'purchase selection');
    id(selected.movementId,'original movement');sha(selected.basisSha256,'reviewed movement SHA-256');
    fail(!seen.has(selected.movementId),'Each original purchase may be selected once.');seen.add(selected.movementId);
    const row=byId.get(selected.movementId);
    fail(row&&row.kind==='source_payment','Select the original source payment; fees and destination payouts retain their separate merchant meaning.');
    fail(row.basisSha256===selected.basisSha256,'This purchase changed after review; inspect the current original source.');
    for(const [field,max] of [['purchaseOwner',240],['purchaseReference',500],['reason',6000]])text(selected[field],field,max);
    return {...clone(selected),paymentId:row.paymentId,paymentKey:row.paymentKey,
      financialBasisSha256:row.basisSha256,movement:clone(row)};
  });
  purchases.sort((a,b)=>a.movementId.localeCompare(b.movementId));
  const normalized={schema:ROZO_PURCHASE_SELECTION_SCHEMA,sourceId:facts.sourceId,
    purchases:purchases.map(({movement,paymentId,paymentKey,financialBasisSha256,...value})=>value)};
  return {selection:normalized,selectionSha256:jsonDigest(normalized),facts,purchases};
}

export function rozoFinanceAssetIdentity(asset){
  fail(asset&&typeof asset==='object','Retain the exact native asset.');
  // The display symbol is never an asset identifier. Precision is retained in
  // the identifier so conflicting source contracts cannot silently combine.
  return {network:'rozo:'+canonical([asset.chainId,asset.network]),
    asset:'rozo:'+canonical([asset.tokenAddress,asset.decimals])};
}
export { KINDS as ROZO_FINANCE_MOVEMENT_KINDS };

// MIT. Unfinished tariff studies retain original source and operation identities.
import { merchantRoutes } from '../analyze.mjs';
import { createSourceWorkingCopies } from '../planning/source-working-copies.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function shape(value,keys,label) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))
    throw fail('TARIFF_STUDY_INVALID','Keep the original '+label+' fields.');
}
function raw(value){return typeof value==='string'||value===null||typeof value==='number'&&Number.isFinite(value);}
function requestIdentity(value,keys,hashes,label) {
  if(!value||typeof value!=='object'||Array.isArray(value)||keys.some(key=>!UUID.test(value[key]??''))||
      hashes.some(key=>!HASH.test(value[key]??'')))
    throw fail('TARIFF_STUDY_REQUEST_INVALID','Retain the complete original '+label+' request identity.');
}
function documentShape(document) {
  shape(document,['label','draft','pendingSave','pendingCommit','priceSaveRequest','repricing','activePlanId'],'tariff study');
  const draft=document.draft;
  shape(draft,['version','label','volumes','tariffs'],'unfinished tariff inputs');
  if(typeof document.label!=='string'||document.label.length>65536||!UUID.test(draft.version??'')||
      typeof draft.label!=='string'||typeof draft.volumes!=='string'||!Array.isArray(draft.tariffs)||draft.tariffs.length>12)
    throw fail('TARIFF_STUDY_INVALID','Keep the study name, source and original raw tariff inputs.');
  for(const row of draft.tariffs) {
    shape(row,['id','label','routeId','mode','tiers'],'unfinished tariff');
    if(!['id','label','routeId','mode'].every(key=>typeof row[key]==='string')||
        !Array.isArray(row.tiers)||row.tiers.length>1000)
      throw fail('TARIFF_STUDY_INVALID','Keep tariff fields as raw text and their original band order.');
    for(const tier of row.tiers) {
      shape(tier,['upTo','unitPriceUsd'],'unfinished band');
      if(!raw(tier.upTo)||!raw(tier.unitPriceUsd))
        throw fail('TARIFF_STUDY_INVALID','Keep unfinished band quantities and prices as their original text or explicit unlimited value.');
    }
  }
  if(document.activePlanId!==null&&!UUID.test(document.activePlanId??''))
    throw fail('TARIFF_STUDY_INVALID','Keep the original completed plan identity.');
  shape(document.repricing,['version','valuations'],'unfinished payment valuations');
  if(document.repricing.version!==null&&!UUID.test(document.repricing.version??'')||!Array.isArray(document.repricing.valuations))
    throw fail('TARIFF_STUDY_INVALID','Keep the original payment source and valuation rows.');
  const options=new Set();
  for(const row of document.repricing.valuations) {
    shape(row,['routeId','paymentIndex','expectedAmount','enabled','atomicUnits','usd','basis'],'payment valuation');
    const key=row.routeId+':'+row.paymentIndex;
    if(typeof row.routeId!=='string'||!Number.isSafeInteger(row.paymentIndex)||row.paymentIndex<0||
        typeof row.enabled!=='boolean'||!['expectedAmount','atomicUnits','usd','basis'].every(key=>typeof row[key]==='string')||
        options.has(key))
      throw fail('TARIFF_STUDY_INVALID','Keep each original payment option once, including unfinished valuation text.');
    options.add(key);
  }
  if(document.pendingSave!==null) {
    shape(document.pendingSave,['version','tariffs','volumes','requestId','label','tariffReviewSha256'],'pending tariff save');
    requestIdentity(document.pendingSave,['requestId','version'],['tariffReviewSha256'],'tariff save');
  }
  if(document.pendingCommit!==null) {
    shape(document.pendingCommit,['selection','planRequestId','pricingRequestId'],'pending quote save');
    requestIdentity(document.pendingCommit,['planRequestId','pricingRequestId'],[],'quote save');
    requestIdentity(document.pendingCommit.selection,['planId'],['selectionSha256','tariffReviewSha256'],'quote selection');
    if(!UUID.test(document.pendingCommit.selection.scenarioPlanInput?.version??''))
      throw fail('TARIFF_STUDY_REQUEST_INVALID','Retain the original quote source.');
  }
  if(document.priceSaveRequest!==null) {
    shape(document.priceSaveRequest,['version','sellerSha256','quoteValuations','requestId','expectedRevision','label','reviewSha256'],'pending native price save');
    requestIdentity(document.priceSaveRequest,['version','requestId'],['sellerSha256','reviewSha256'],'native price save');
    if(document.priceSaveRequest.expectedRevision!==null&&!HASH.test(document.priceSaveRequest.expectedRevision??''))
      throw fail('TARIFF_STUDY_REQUEST_INVALID','Retain the original native price decision revision.');
  }
  if(Buffer.byteLength(JSON.stringify(document))>4*1024*1024)
    throw fail('WORKING_COPY_TOO_LARGE','Unfinished tariff inputs support up to 4 MiB.');
  return structuredClone(document);
}
const family=createSourceWorkingCopies({
  directory:'tariff-working',
  recordSchema:'stellar-forge.merchant-tariff-working-revision.v1',
  packageSchema:'stellar-forge.merchant-tariff-working-copy.v1',
  inputsSchema:'stellar-forge.merchant-tariff-working-inputs.v1',
  listSchema:'stellar-forge.merchant-tariff-working-list.v1',
  stateSchema:'stellar-forge.merchant-tariff-working-state.v1',
  savedStatus:'TARIFF_WORKING_COPY_SAVED',documentShape,
  summary({record,revision}) {
    return {workingCopyId:record.workingCopyId,revision,label:record.document.label.trim().slice(0,160)||'Untitled tariff study',
      savedAt:record.savedAt,sourceVersion:record.source.version,tariffCount:record.document.draft.tariffs.length,
      pendingOperations:['pendingSave','pendingCommit','priceSaveRequest'].filter(key=>record.document[key]!==null),
      receivedFrom:record.receivedFrom??null};
  },
  references(document) {return [...new Set([document.activePlanId,document.pendingCommit?.selection?.planId].filter(Boolean))];},
  dependencies(document) {
    return [...new Set([document.repricing.version,document.priceSaveRequest?.version].filter(Boolean))];
  },
  async verifySource({binding,document,actual,source}) {
    if(document.draft.version!==binding.version||document.pendingSave&&document.pendingSave.version!==binding.version||
        document.pendingCommit&&document.pendingCommit.selection.scenarioPlanInput.version!==binding.version)
      throw fail('WORKING_SOURCE_CHANGED','The tariff study and its original requests must retain the same saved tariff source.',409);
    const routes=new Set(actual.routes.map(row=>row.routeId));
    if(document.draft.tariffs.some(row=>row.routeId&&!routes.has(row.routeId)))
      throw fail('WORKING_ROUTE_CHANGED','An unfinished tariff refers to a route outside its original source.');
    // A plan save retains the exact original reviewed body even if the raw editor has newer inputs.
    if(document.priceSaveRequest&&document.priceSaveRequest.version!==document.repricing.version)
      throw fail('WORKING_SOURCE_CHANGED','Retain the matching original payment source for the pending price save.',409);
    if(document.repricing.version!==null) {
      const paymentSource=await source(document.repricing.version);
      const paymentRoutes=new Map(merchantRoutes(paymentSource.seller).map(row=>[row.routeId,row]));
      for(const row of document.repricing.valuations) {
        const option=paymentRoutes.get(row.routeId)?.paymentOptions?.[row.paymentIndex];
        if(!option||String(option.atomicAmount)!==row.expectedAmount)
          throw fail('WORKING_PAYMENT_SOURCE_CHANGED','A retained valuation no longer identifies its original saved payment option.',409);
      }
      if(document.priceSaveRequest&&document.priceSaveRequest.sellerSha256!==paymentSource.provenance.seller)
        throw fail('WORKING_PAYMENT_SOURCE_CHANGED','The retained price request belongs to another saved seller.',409);
    } else if(document.repricing.valuations.length)
      throw fail('WORKING_PAYMENT_SOURCE_CHANGED','Retain the source of these unfinished payment valuations.');
  }
});
export const openTariffWorkingCopies=family.open;
export const captureTariffWorkingBackup=family.captureBackup;

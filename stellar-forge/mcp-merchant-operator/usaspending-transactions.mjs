// MIT. Compose transaction operations into the existing USAspending merchant owner.
import {failure,plain} from './config.mjs';
import {sha,integer} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/core.mjs';

export const USASPENDING_TRANSACTION_SOURCE_KINDS=Object.freeze(['transaction-pages','transactions']);
export function isUSASpendingTransactionTool(name){return name.startsWith('merchant_usaspending_transaction_');}
function transactions(entry){
  const original=entry.model.transactions;
  if(!original)throw failure('USASPENDING_TRANSACTIONS_UNAVAILABLE','Open the complete original USAspending transaction application.');
  return original;
}
function invalid(message){throw failure('INVALID_PARAMS',message);}
function sourceView(source){
  return {captureId:source.capture_id,page:source.page,request:source.request,receipt:source.receipt,
    response:{bytes:source.response.length,sha256:source.sha256}};
}
function rowSnapshot(capture,selection){
  return sha({captureId:capture.id,updatedAt:capture.updated_at,pages:capture.page_count,rows:capture.row_count,
    fingerprint:capture.fingerprint,selection});
}
export async function executeUSASpendingTransactionTool(entry,name,input,{http,paged,captureView}){
  const original=transactions(entry);
  switch(name){
    case 'merchant_usaspending_transaction_inventory':{
      if(!['captures','reviews'].includes(input.kind))invalid('Choose captures or reviews.');
      let rows=original.state()[input.kind];
      if(input.awardKey!==undefined)rows=rows.filter(row=>(input.kind==='captures'?row.award_key:row.data?.awardKey)===input.awardKey);
      if(input.kind==='captures')rows=rows.map(captureView);
      return {kind:input.kind,...paged(rows,input)};
    }
    case 'merchant_usaspending_transaction_capture':{
      if(input.captureId!==undefined){
        if(['editionId','awardKey','pageSize','maxRows'].some(key=>input[key]!==undefined))invalid('Resume only the original captureId.');
        return http('/api/transactions/resume',{captureId:input.captureId});
      }
      if(input.editionId===undefined||input.awardKey===undefined)invalid('Start with an original editionId and awardKey, or resume captureId.');
      return http('/api/transactions/capture',input);
    }
    case 'merchant_usaspending_transaction_capacity':return captureView(original.capacity(input));
    case 'merchant_usaspending_transaction_summary':{
      const {capture,analysis,review}=original.summary(input.captureId);
      const {by_fiscal_year,conflicts,duplicate_occurrences,...totals}=analysis;
      const choices={'fiscal-years':by_fiscal_year,conflicts,duplicates:duplicate_occurrences};
      const section=input.section??'fiscal-years';
      if(!Object.hasOwn(choices,section))invalid('Choose fiscal-years, conflicts or duplicates.');
      return {capture:captureView(capture),analysis:totals,review,
        counts:{fiscalYears:by_fiscal_year.length,conflicts:conflicts.length,duplicateOccurrences:duplicate_occurrences.length},
        section,records:paged(choices[section],input)};
    }
    case 'merchant_usaspending_transaction_rows':{
      const {captureId,expectedSnapshot,...filters}=input;
      const selection={search:filters.search??'',startDate:filters.startDate??'',endDate:filters.endDate??'',limit:filters.limit??100};
      const page=integer(filters.page??1,'Transaction page',1,1000000);
      const capture=original.capture(captureId),snapshot=rowSnapshot(capture,selection);
      if(page>1&&expectedSnapshot===undefined)throw failure('USASPENDING_SNAPSHOT_REQUIRED','Continue with the transaction timeline snapshot returned by page one.');
      if(expectedSnapshot!==undefined&&expectedSnapshot!==snapshot)throw failure('USASPENDING_INVENTORY_CHANGED','The original transaction capture or filters changed. Read page one and retain its new snapshot.');
      return {...original.browse(captureId,filters),snapshot,captureUpdatedAt:capture.updated_at};
    }
    case 'merchant_usaspending_transaction_compare':{
      const comparison=original.compare(input.before,input.after);
      const {added,changed,absent_in_later_capture,unresolved=[],source_conflicts,...totals}=comparison;
      const choices={added,changed,absent_in_later_capture,unresolved,'before-conflicts':source_conflicts.before,'after-conflicts':source_conflicts.after};
      const section=input.section??'changed';
      if(!Object.hasOwn(choices,section))invalid('Choose an original comparison section.');
      return {...totals,counts:Object.fromEntries(Object.entries(choices).map(([key,rows])=>[key,rows.length])),
        section,records:paged(choices[section],input)};
    }
    case 'merchant_usaspending_transaction_review_save':return original.saveReview(input);
    case 'merchant_usaspending_transaction_source':return sourceView(original.source(input.captureId,input.page));
    default:throw failure('TOOL_NOT_FOUND','Unknown USAspending transaction operation.');
  }
}
export async function importUSASpendingTransactionSource(entry,selected,input){
  const original=transactions(entry),{value}=await entry.imports.readJsonFile(selected.file,256000000);
  if(input.name!==undefined)invalid('Retain the original transaction capture identity and source name.');
  if(selected.kind==='transaction-pages'){
    if(input.editionId===undefined||input.awardKey===undefined)invalid('Select the original award editionId and awardKey for these retained transaction pages.');
    if(input.includeReview!==undefined)invalid('Retained provider pages do not contain a workshare review.');
    const pages=Array.isArray(value)?value:plain(value)?value.pages:undefined;
    return original.import({editionId:input.editionId,awardKey:input.awardKey,pages,...(input.maxRows===undefined?{}:{maxRows:input.maxRows})});
  }
  if(selected.kind!=='transactions')invalid('Choose a declared transaction source.');
  if(input.awardKey!==undefined||input.maxRows!==undefined)invalid('A complete transaction packet retains its own award key and source coverage.');
  return original.receive(value,{...(input.editionId===undefined?{}:{editionId:input.editionId}),includeReview:input.includeReview??false});
}
export function exportUSASpendingTransactions(entry,input){
  const original=transactions(entry);
  switch(input.kind){
    case 'transaction-json':return original.export(input.captureId,{includeReview:input.includeReviews??false});
    case 'transaction-csv':return original.csv(input.captureId,{spreadsheet:true});
    case 'transaction-source':return original.source(input.captureId,input.page).response;
    case 'transaction-source-receipt':return sourceView(original.source(input.captureId,input.page));
    case 'transaction-comparison':return original.compare(input.before,input.after);
    case 'transaction-brief':{
      const capture=original.capture(input.captureId);
      return original.brief(input.captureId,{awardBrief:entry.brief.workshareBrief(entry.model,capture.award_edition_id,capture.award_key)});
    }
    default:throw failure('INVALID_PARAMS','Choose a complete native transaction export.');
  }
}

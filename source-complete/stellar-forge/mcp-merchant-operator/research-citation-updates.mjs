// MIT. Preserve the original Research listener, atomic review and request recovery.
import {exact,failure} from './host-files.mjs';
import {RESEARCH_CITATION_REQUEST_FIELDS} from './catalog/research-citation-updates.mjs';
export {RESEARCH_CITATION_REVIEW_PREFIX} from './catalog/research-citation-updates.mjs';

const SCHEMA='sf88-citation-update-review.v1';
const recovery='Read the same citation notice history and replay the exact saved requestId and complete review payload. The original engine returns its saved review after a lost reply; keep its original revision and fingerprint.';
function selected(args,keys){
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(args,key)).map(key=>[key,args[key]]));
}
function view(value,args,detail=false){
  if(value?.schema!==SCHEMA||value.dossier?.id!==args.dossierId||
    !Number.isSafeInteger(value.dossier.revision)||value.dossier.revision<1||
    args.revision!==undefined&&value.dossier.revision!==args.revision||
    detail&&value.detail?.noticeId!==args.noticeId)
    throw failure('RESEARCH_CITATION_SOURCE_CHANGED','The citation response differs from the selected original dossier, notice or revision.');
  return value;
}
export async function callResearchCitationUpdates(client,name,args){
  if(name==='merchant_research_citation_updates'){
    exact(args,['workspace','dossierId','revision','offset','limit','status'],['workspace','dossierId']);
    return view(await client.citationUpdates(args.dossierId,selected(args,['revision','offset','limit','status'])),args);
  }
  if(name==='merchant_research_citation_update'){
    exact(args,['workspace','dossierId','noticeId','revision'],['workspace','dossierId','noticeId']);
    return view(await client.citationUpdates(args.dossierId,selected(args,['noticeId','revision'])),args,true);
  }
  if(name!=='merchant_research_citation_review')throw failure('TOOL_NOT_FOUND','Unknown citation-review operation.');
  exact(args,['workspace','dossierId',...RESEARCH_CITATION_REQUEST_FIELDS],
    ['workspace','dossierId','requestId','noticeId','expectedFingerprint','expectedRevision','actor','decision','reason']);
  const request=selected(args,RESEARCH_CITATION_REQUEST_FIELDS);
  let result;
  try{result=await client.reviewCitationUpdate(args.dossierId,request);}
  catch(error){
    if(error.outcomeUnknown)Object.assign(error,{requestId:args.requestId,recovery});
    throw error;
  }
  if(result?.dossier?.id!==args.dossierId||typeof result.duplicate!=='boolean'||
    result.review?.noticeId!==args.noticeId||result.review?.requestId!==args.requestId||
    result.review?.originalRevision!==args.expectedRevision||result.review?.revision!==args.expectedRevision+1||
    !Number.isSafeInteger(result.dossier?.revision)||result.dossier.revision<result.review.revision){
    throw Object.assign(failure('RESEARCH_CITATION_RECEIPT_CHANGED',
      'The original review response could not be reconciled to its selected request.'),{
      outcomeUnknown:true,dossierId:args.dossierId,requestId:args.requestId,recovery
    });
  }
  return result;
}

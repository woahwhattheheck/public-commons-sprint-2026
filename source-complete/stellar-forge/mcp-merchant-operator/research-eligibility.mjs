// MIT. Borrow the original Research listener and its retained export ledger.
import {exact,failure} from './host-files.mjs';
import {readEligibility,submitEligibility,exportEligibility,ELIGIBILITY_REQUEST_FIELDS}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/eligibility-consumer.mjs';
export {RESEARCH_ELIGIBILITY_PREFIX} from './catalog/research-eligibility.mjs';
const picked=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
export async function callResearchEligibility(client,name,args){
  if(name==='merchant_research_eligibility'){
    const fields=['revision','reviewId','workSetId','section','offset','limit'];
    exact(args,['workspace','dossierId',...fields],['workspace','dossierId']);
    return readEligibility(client,args.dossierId,picked(args,fields));
  }
  if(name==='merchant_research_eligibility_review'){
    exact(args,['workspace','dossierId',...ELIGIBILITY_REQUEST_FIELDS],
      ['workspace','dossierId','requestId','expectedRevision','actor','action','data']);
    return submitEligibility(client,args.dossierId,picked(args,ELIGIBILITY_REQUEST_FIELDS));
  }
  throw failure('TOOL_NOT_FOUND','Unknown eligibility operation.');
}
export async function exportResearchEligibility(client,args,{file,download}){
  exact(args,['workspace','dossierId','kind','revision','reviewId','workSetId','section','expectedSha256'],
    ['workspace','dossierId','kind','revision','reviewId']);
  if(!['eligibility-json','eligibility-csv'].includes(args.kind))
    throw failure('INVALID_PARAMS','Select an original eligibility report export.');
  const format=args.kind==='eligibility-json'?'json':'csv';
  const options={...picked(args,['revision','reviewId','workSetId','section','expectedSha256']),format,file};
  const result=await download(()=>exportEligibility(client,args.dossierId,options));
  return {result,selection:{dossierId:args.dossierId,revision:args.revision,
    reviewId:args.reviewId??null,workSetId:args.workSetId??null,section:args.section??'queue'}};
}

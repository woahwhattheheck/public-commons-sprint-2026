// MIT. Compose the existing ResearchWorkspaceClient.clinicalTrials() facade.
import {exact,plain,failure} from './host-files.mjs';
import {RESEARCH_CLINICALTRIALS_EXPORTS} from './catalog/research-clinicaltrials.mjs';
export {researchClinicalTrialsTools} from './catalog/research-clinicaltrials.mjs';

export const RESEARCH_CLINICALTRIALS_PREFIX='merchant_research_clinicaltrials_';
const sourceKinds=Object.freeze(['clinicaltrials-packet']);
const selected=(input,keys)=>Object.fromEntries(keys.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
const digest=value=>{
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))
    throw failure('INVALID_PARAMS','Use the complete reviewed SHA256.');
  return value;
};
function criteria(value){
  if(value===undefined)return {};
  if(!plain(value)||Object.keys(value).some(key=>!['statuses','studyTypes','phaseKeys','conditions','sponsors',
    'resultsFlags','hasResultsSections','query'].includes(key))||JSON.stringify(value).length>16384)
    throw failure('INVALID_PARAMS','Use the original retained-cohort criteria within its complete native size limit.');
  return value;
}
function facade(client){
  if(!client||typeof client.clinicalTrials!=='function')
    throw failure('RESEARCH_CLINICALTRIALS_CLIENT_REQUIRED','Use the maintained Research client with its original ClinicalTrials receiving facade.');
  return client.clinicalTrials();
}
/** Called inside the existing Research attachment's pending-operation scope. */
export async function callResearchClinicalTrials(client,name,args,{source}={}){
  const trials=facade(client),id=args.dossierId,operationId=args.operationId,editionId=args.editionId;
  switch(name){
    case 'merchant_research_clinicaltrials_inputs':return trials.inputs(id,selected(args,['after','limit']));
    case 'merchant_research_clinicaltrials_input':return trials.input(id,args.sourceId);
    case 'merchant_research_clinicaltrials_import_packet':{
      if(typeof source!=='function')throw failure('RESEARCH_SOURCE_REQUIRED','Use a host-declared original ClinicalTrials packet.');
      const input=source(args.source,sourceKinds);
      return trials.importPacket(id,{file:input.file,sha256:input.sha256});
    }
    case 'merchant_research_clinicaltrials_prepare':return trials.prepare(id,selected(args,
      ['requestId','questionId','expectedRevision','sourceId','captureId','allowPartial','label']));
    case 'merchant_research_clinicaltrials_operations':return trials.operations(id,selected(args,['after','limit']));
    case 'merchant_research_clinicaltrials_review':return trials.review(id,operationId,selected(args,['offset','limit']));
    case 'merchant_research_clinicaltrials_start':return trials.start(id,operationId,{expectedPlanSha256:args.expectedPlanSha256});
    case 'merchant_research_clinicaltrials_stop':return trials.stop(id,operationId);
    case 'merchant_research_clinicaltrials_receive':return trials.receive(id,operationId,
      selected(args,['expectedPlanSha256','expectedEditionSha256','expectedRevision']));
    case 'merchant_research_clinicaltrials_record':return trials.record(id,operationId,args.index);
    case 'merchant_research_clinicaltrials_compare':return trials.compare(id,operationId,args.beforeOperationId);
    case 'merchant_research_clinicaltrials_retained':return trials.retained(id);
    case 'merchant_research_clinicaltrials_retained_review':return trials.retainedReview(id,editionId,selected(args,['offset','limit']));
    case 'merchant_research_clinicaltrials_retained_record':return trials.retainedRecord(id,editionId,args.index);
    case 'merchant_research_clinicaltrials_compare_retained':return trials.compareRetained(id,args.beforeEditionId,args.afterEditionId);
    case 'merchant_research_clinicaltrials_analysis':return trials.analysis(id,operationId,
      {...selected(args,['offset','limit']),criteria:criteria(args.criteria)});
    case 'merchant_research_clinicaltrials_retained_analysis':return trials.retainedAnalysis(id,editionId,
      {...selected(args,['offset','limit']),criteria:criteria(args.criteria)});
    default:throw failure('TOOL_NOT_FOUND','Choose an original ClinicalTrials Research operation.');
  }
}
/** Streams native bytes through the existing Research exporter and retainer. */
export async function exportResearchClinicalTrials(client,args,{file,download=work=>work()}={}){
  const trials=facade(client),spec=RESEARCH_CLINICALTRIALS_EXPORTS[args.kind];
  if(!spec)throw failure('INVALID_PARAMS','Select an original ClinicalTrials Research export kind.');
  const common=['workspace','dossierId','kind'],base={dossierId:args.dossierId};
  let result,selection;
  const fileOptions={file,...(args.expectedSha256===undefined?{}:{expectedSha256:digest(args.expectedSha256)})};
  if(spec.clinicalFormat){
    exact(args,[...common,'operationId','editionId','criteria','expectedSha256'],common);
    if((args.operationId!==undefined)===(args.editionId!==undefined))
      throw failure('INVALID_PARAMS','Select exactly one original operation ID or retained dossier edition for this report.');
    const selectionCriteria=criteria(args.criteria),options={...fileOptions,format:spec.clinicalFormat,criteria:selectionCriteria};
    result=await download(()=>args.operationId!==undefined?trials.exportAnalysis(args.dossierId,args.operationId,options):
      trials.exportRetainedAnalysis(args.dossierId,args.editionId,options));
    selection={...base,...selected(args,['operationId','editionId']),format:spec.clinicalFormat,criteria:selectionCriteria};
  }else if(args.kind==='clinicaltrials-input-packet'){
    exact(args,[...common,'sourceId','expectedSha256'],[...common,'sourceId']);
    result=await download(()=>trials.exportInputPacket(args.dossierId,args.sourceId,fileOptions));
    selection={...base,sourceId:args.sourceId};
  }else if(args.kind==='clinicaltrials-edition'){
    exact(args,[...common,'operationId','expectedSha256'],[...common,'operationId']);
    result=await download(()=>trials.exportEdition(args.dossierId,args.operationId,fileOptions));
    selection={...base,operationId:args.operationId};
  }else{
    exact(args,[...common,'editionId','expectedSha256'],[...common,'editionId']);
    result=await download(()=>args.kind==='clinicaltrials-retained-packet'?
      trials.exportRetainedPacket(args.dossierId,args.editionId,fileOptions):
      trials.exportRetainedEdition(args.dossierId,args.editionId,fileOptions));
    selection={...base,editionId:args.editionId};
  }
  return {result,selection};
}

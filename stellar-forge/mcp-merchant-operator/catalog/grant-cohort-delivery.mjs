// MIT. Complete recorded cohort delivery on the original Merchant Grant owner.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const id=prefix=>({type:'string',pattern:'^'+prefix+'-[a-f0-9]{32}$'});
const str=(max=20000)=>({type:'string',maxLength:max});
const nonempty=(max=500)=>({type:'string',minLength:1,maxLength:max});
const object={type:'object',additionalProperties:true};
const ws={workspace:alias};
const caseSelection={caseId:id('operation'),expectedVersion:{type:'integer',minimum:1,maximum:10000000}};
const requestId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const inputRef={type:'object',additionalProperties:false,
  properties:{hostInput:alias,snapshotId:nonempty(100),transferId:nonempty(100),sourceWorkspace:alias},
  oneOf:[{required:['hostInput']},{required:['snapshotId']},{required:['transferId']}]};
const model={inputs:object,input:inputRef,expectedInputSha256:digest,inputPointer:str(4000)};
const oneInput={oneOf:[{required:['inputs'],not:{anyOf:[{required:['input']},{required:['expectedInputSha256']},{required:['inputPointer']}]}},
  {required:['input','expectedInputSha256'],not:{required:['inputs']}}]};
const sources={...caseSelection,planSourceId:id('source'),expectedPlanSha256:digest,
  reviewId:id('review'),expectedReviewBusinessSha256:digest};
const selected=['workspace','caseId','expectedVersion','planSourceId','expectedPlanSha256','reviewId'];
const changes={type:'array',minItems:1,maxItems:2000,items:{type:'object',additionalProperties:false,required:['action'],
  properties:{action:{enum:['LINK_IDENTITY','UNLINK_IDENTITY','PLACE_INTENT','CLEAR_PLACEMENT','TITLE_NOTE','START_COMMERCIAL','SET_COMMERCIAL','REMOVE_COMMERCIAL','RECEIVE_ORIGINAL_COSTS','REMOVE_ORIGINAL_COSTS']},
    kind:{enum:['buyer','merchant','operation','facilitator']},plannedId:nonempty(),observedId:nonempty(),
    intentId:nonempty(),targetId:nonempty(700),note:str(),title:str(500),commercial:object,originalCosts:object}}};
const tool=(verb,description,properties,required,readOnly=true,rules={})=>({
  name:'merchant_grant_cohort_delivery_'+verb,description,
  inputSchema:{type:'object',properties,required,additionalProperties:false,...rules},
  annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:false}
});
export const grantCohortDeliveryTools=[
  tool('seed','Acquire the whole saved adoption source and original frozen COHORT_EVALUATION review from the current native case. Verify the source bytes and selected business identity; return the complete planned-versus-recorded comparison with original identity joins, ambiguous/unmatched intents, daily/operator/target outcomes and source mode.',
    {...ws,...sources,title:str(500),note:str()},selected),
  tool('edit','Apply complete source-backed commercial choices, original Work/invoice cost intake (RECEIVE_ORIGINAL_COSTS with full selections, overlapReviews and explicit acceptSourceIds), explicit associations or original intent placements to the complete recorded delivery input. Keep both original sources, native completion/refund classifications and every unmatched record. Return the whole calculated successor and previous document; invalidated choices remain in editable input with the precise original constraint.',
    {...ws,...model,changes},['workspace','changes'],true,oneInput),
  tool('review','Review the complete recorded delivery comparison against its actual current case, exact original saved plan and frozen review. Retain the current case version and the complete original source selections.',
    {...ws,...caseSelection,...model},['workspace','caseId','expectedVersion'],true,oneInput),
  tool('refresh','Select a complete original saved plan and frozen review for the current case while carrying the previous explicit identity, intent-placement, commercial quantities/rates and original Work/invoice source witnesses. Retain the full previous document. When a choice no longer applies, return the complete editable input and exact constraint so cohort_delivery_edit can fix it.',
    {...ws,...sources,...model},selected,true,oneInput),
  tool('prepare','Prepare one complete native source edition for the reviewed recorded delivery comparison. Re-read its original saved adoption source and frozen review, retain exact source bytes and original request ID, and use the existing adoption request owner. Keep the original creation time and complete input on retries.',
    {...ws,...caseSelection,...model,requestId,actor:nonempty(300),note:str(12000),createdAt:{type:'string',format:'date-time'}},
    ['workspace','caseId','expectedVersion','requestId','actor','note','createdAt'],false,oneInput),
  tool('save','Save the exact complete prepared recorded delivery source from a verified original file/snapshot/transfer. The existing owner durably retains the accepted native response, reconciles its original case/version event and reopens every saved byte. Use the prepared SHA returned by prepare.',
    {...ws,input:inputRef,expectedInputSha256:digest,inputPointer:str(4000),expectedPreparedSha256:digest},
    ['workspace','input','expectedInputSha256','expectedPreparedSha256'],false),
  tool('request','Reopen this retained original source request and full accepted response, and inspect the original native event without sending a command. The existing adoption source request owner retains the same case ID, request ID and prepared SHA.',
    {...ws,caseId:id('operation'),requestId,expectedPreparedSha256:digest},
    ['workspace','caseId','requestId','expectedPreparedSha256']),
  tool('open','Reopen a saved complete cohort delivery source by its original source ID and SHA256. Preserve the frozen review and original adoption plan through native receiving and recalculation.',
    {...ws,caseId:id('operation'),sourceId:id('source'),expectedSourceSha256:digest},
    ['workspace','caseId','sourceId','expectedSourceSha256']),
  tool('export','Retain the whole recorded delivery document as JSON, complete original CSV or readable HTML. JSON preserves its full source wrapper and any retained predecessor; CSV/HTML use the original comparison engine. Retrieve all original bytes through merchant_grant_file_read.',
    {...ws,...model,format:{enum:['JSON','CSV','HTML']}},['workspace','format'],true,oneInput)
];

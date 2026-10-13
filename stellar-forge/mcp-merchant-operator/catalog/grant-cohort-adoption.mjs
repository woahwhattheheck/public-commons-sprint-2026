// MIT. Complete adoption workflow tools on the original Grant workspace owner.
const str=(max=12000)=>({type:'string',maxLength:max});
const nonempty=(max=300)=>({type:'string',minLength:1,maxLength:max});
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const id=prefix=>({type:'string',pattern:'^'+prefix+'-[a-f0-9]{32}$'});
const object={type:'object',additionalProperties:true};
const ws={workspace:alias};
const caseSelection={caseId:id('operation'),expectedVersion:{type:'integer',minimum:1,maximum:10000000}};
const requestId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const inputRef={type:'object',additionalProperties:false,
  properties:{hostInput:alias,snapshotId:nonempty(100),transferId:nonempty(100),sourceWorkspace:alias},
  oneOf:[{required:['hostInput']},{required:['snapshotId']},{required:['transferId']}]};
const modelInput={inputs:object,input:inputRef,expectedInputSha256:digest,inputPointer:str(4000)};
const oneInput={oneOf:[{required:['inputs'],not:{anyOf:[{required:['input']},{required:['expectedInputSha256']},{required:['inputPointer']}]}},
  {required:['input','expectedInputSha256'],not:{required:['inputs']}}]};
const installationRefs={type:'array',maxItems:1000,items:{type:'object',additionalProperties:false,
  properties:{id:id('installation'),revision:{type:'integer',minimum:1},sha256:digest},required:['id','revision','sha256']}};
const comparisonOptions={type:'object',additionalProperties:false,properties:{title:nonempty(500),note:str(12000)}};
const changes={type:'array',minItems:1,maxItems:2000,items:{type:'object',additionalProperties:false,
  properties:{action:{enum:['PLAN','UPDATE','ADD','REMOVE','FROM_RECORDED_COSTS']},
    collection:{enum:['buyers','merchants','facilitators','operations','schedules','workshares','capacityPools','fundingGroups']},
    id:nonempty(300),fields:object,value:object,beforeId:nonempty(300),recordedDocument:object,choices:object},required:['action']}};
const tool=(suffix,description,properties,required,readOnly=true,rules={})=>({
  name:'merchant_grant_'+suffix,description,
  annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  inputSchema:{type:'object',properties,required,additionalProperties:false,...rules}
});
export const grantCohortAdoptionTools=[
  tool('adoption_seed','Acquire the complete original native case or saved Calendar group and prepare its editable adoption plan, full pricing/capacity report and fixed-default scheduling choices. Retain original source, every useful row, named funding groups and unpriced terms. CASE selects tranche 2 or 3; CALENDAR selects groupId and its original saved window.',
    {...ws,...caseSelection,source:{enum:['CASE','CALENDAR']},tranche:{enum:[2,3]},installationRefs,groupId:nonempty(100),
      asOfAt:{type:'string',format:'date-time'},name:nonempty(500),draftId:nonempty(300),windowStart:{type:'string',format:'date'}},
    ['workspace','caseId','expectedVersion','source']),
  tool('adoption_review','Calculate the complete adoption document against the current original native case/seed. The result retains the entered plan and original rule, reports current-source differences, and calculates full tasks, payments, capacity, prices and proposed targets.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId','expectedVersion'],true,oneInput),
  tool('adoption_edit','Apply explicit plan or keyed row edits to the complete retained document and return the full successor, calculated report and original before/after comparison. UPDATE merges selected nested object fields, arrays remain complete replacements, and row identity/source origin stay original. FROM_RECORDED_COSTS as the only change accepts a complete recordedDocument and explicit choices, derives future service costs/hours, retains all original sources and returns a complete cost-basis successor. Measured quantities count completed useful tasks; supplier unitCost is divided by the target requestsPerTask because the original calculator charges that rate per underlying request. Derivations retain both task and request quantities; labor remains per task. New normalized choices carry quantityBasis:COMPLETED_TASKS, while complete earlier documents reopen with their original calculation. Each allocation may include measurement {schema:stellar-forge.sf47-cohort-task-measurement.v1, original:the full merchant_grant_task_outcome response, kind:INSTALLED or FOLLOWUP, observationId, serviceBasis, optional caseId for the actual selected receiving case}; its count/unit/reference are derived from that saved source when omitted, or must match when supplied. Original review/prepare checks the selected native revision; existing measurementHistory retains prior selections. PLAN edits names, dates, calendar, sensitivity, note or scheduling choices; original source/rules use adoption_rebase.',
    {...ws,...modelInput,changes,options:comparisonOptions},['workspace','changes'],true,oneInput),
  tool('adoption_rebase','Explicitly rebase the whole adoption plan on its original current case and native proposed rule. Retain every editable row and the complete predecessor comparison. This uses the same original-case operation as the browser.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId','expectedVersion'],true,oneInput),
  tool('adoption_schedule','Allocate the complete original occurrence workload with explicit flexibility, release/due dates, weekdays, spacing and priorities. Retain purchased funding, source dates and collision identities. Return the editable successor, all assignments/constraints and full original calculator result. FIRST_FIT keeps original service order; RESOLVE_CONFLICTS revisits complete competing groups and retains its method, effort and decisions for exact save/reopen. maxSearchSteps applies only to RESOLVE_CONFLICTS. Choose constraints inline or one verified constraints file; omission uses current/fixed defaults.',
    {...ws,...modelInput,constraints:object,constraintsInput:inputRef,expectedConstraintsSha256:digest,constraintsPointer:str(4000),name:nonempty(500),
      method:{enum:['FIRST_FIT','RESOLVE_CONFLICTS']},maxSearchSteps:{type:'integer',minimum:1,maximum:1000000}},
    ['workspace'],true,oneInput),
  tool('adoption_compare','Compare the complete retained baseline document with one complete candidate. Plans, reports, saved editions and full delivery allocations remain attached to the calculated comparison. Candidate may be inline or another verified file/snapshot/transfer.',
    {...ws,...modelInput,candidate:object,candidateInput:inputRef,expectedCandidateSha256:digest,candidatePointer:str(4000),options:comparisonOptions},
    ['workspace'],true,{allOf:[oneInput,{oneOf:[{required:['candidate'],not:{anyOf:[{required:['candidateInput']},{required:['expectedCandidateSha256']},{required:['candidatePointer']}]}},
      {required:['candidateInput','expectedCandidateSha256'],not:{required:['candidate']}}]}]}),
  tool('adoption_prepare','Prepare and retain the complete reviewed successor or comparison for one original source.add command. Keep the exact creation time/request ID on retries. Includes full native source, edition bytes, calculated report and comparison. A plan predecessor selects parentSourceId and expectedParentSha256 together. The case remains unchanged until adoption_save.',
    {...ws,...caseSelection,...modelInput,requestId,actor:nonempty(300),note:str(),createdAt:{type:'string',format:'date-time'},
      parentSourceId:id('source'),expectedParentSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','note','createdAt'],false,oneInput),
  tool('adoption_save','Save the exact complete prepared adoption edition from a verified retained input. The same original request, accepted native response and version event are reconciled before replay; full source bytes are reopened after commit. Returns the original receipt and complete saved document. Use the preparedSha256 returned by adoption_prepare.',
    {...ws,input:inputRef,expectedInputSha256:digest,inputPointer:str(4000),expectedPreparedSha256:digest},
    ['workspace','input','expectedInputSha256','expectedPreparedSha256'],false),
  tool('adoption_request','Reopen a retained original adoption request, complete prepared edition and any accepted response; inspect its exact native case/version event without sending a command. Use its original case ID, request ID and prepared SHA.',
    {...ws,caseId:id('operation'),requestId,expectedPreparedSha256:digest},
    ['workspace','caseId','requestId','expectedPreparedSha256']),
  tool('adoption_open','Open a saved native adoption source by its original source ID and SHA256. Verify every original byte and the complete recalculated plan, allocation or comparison. The selected case can be a complete imported receiver and keeps its own case identity.',
    {...ws,caseId:id('operation'),sourceId:id('source'),expectedSourceSha256:digest},
    ['workspace','caseId','sourceId','expectedSourceSha256']),
  tool('adoption_export','Retain complete JSON, CSV or readable HTML from the selected full adoption document. Full native case receiving uses existing merchant_grant_export kind case and case_import. Use the original file_read tool to retrieve every output byte.',
    {...ws,...modelInput,format:{enum:['JSON','CSV','HTML']}},['workspace','format'],true,oneInput)
];

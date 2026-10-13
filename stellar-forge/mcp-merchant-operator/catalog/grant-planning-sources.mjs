// MIT. Complete source-table and editable workbook operations for the existing grant owner.
const str=(maxLength=12000)=>({type:'string',maxLength});
const nonempty=(maxLength=300)=>({...str(maxLength),minLength:1});
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const revision={type:'integer',minimum:1,maximum:1000000};
const object={type:'object',additionalProperties:true};
const role={enum:['packages','milestones','contributors','assignments']};
const input={type:'object',additionalProperties:false,
  properties:{hostInput:alias,snapshotId:nonempty(80),transferId:nonempty(80),sourceWorkspace:alias},
  oneOf:[{required:['hostInput']},{required:['snapshotId']},{required:['transferId']}]};
const reference={type:'object',additionalProperties:false,
  properties:{input,expectedInputSha256:digest,inputPointer:str(4000)},
  required:['input','expectedInputSha256']};
const originalFile={type:'object',additionalProperties:false,
  properties:{input,expectedInputSha256:digest},required:['input','expectedInputSha256']};
const ws={workspace:alias};
const plan={planId:{type:'string',pattern:'^plan-[a-f0-9]{32}$'},revision,expectedContentSha256:digest};
const source={project:reference};
const profile={type:'object',additionalProperties:false,properties:{
  schema:{const:'stellar-forge.planning-workbook-export-profile.v1'},
  numberMode:{enum:['exact-text','spreadsheet-numbers']},precisionPolicy:{enum:['text','reject']},
  amountMode:{enum:['native-values','formulas']},note:str(2000),
},required:['schema','numberMode','precisionPolicy','amountMode','note']};
const returnProfile={type:'object',additionalProperties:false,properties:{
  schema:{const:'stellar-forge.planning-workbook-return-profile.v1'},
  modeByRole:{type:'object',additionalProperties:false,
    properties:Object.fromEntries(role.enum.map(name=>[name,{enum:['merge','replace']}])),required:role.enum},
  orphanPolicy:{enum:['preserve','remove-unreferenced']},includeHiddenRows:{type:'boolean'},note:nonempty(2000),
},required:['schema','modeByRole','orphanPolicy','includeHiddenRows','note']};
const requestId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
function tool(suffix,description,properties,required,readOnly=false,rules={}) {
  return {name:'merchant_grant_'+suffix,description,
    annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    inputSchema:{type:'object',properties:{...ws,...properties},required:['workspace',...required],
      additionalProperties:false,...rules}};
}
export const grantPlanningSourceTools=[
  tool('source_profiles','Read the original four planning roles, workbook export and return profiles, retained source schemas and complete operating guides.',{},[],true),
  tool('source_snapshot','Retain the complete source project for a current or exact saved native plan. Existing workbook editions, original files, selections and reviews travel into the selected saved baseline.',plan,['planId'],true),
  tool('workbook_inspect','Inspect every original XLSX sheet and a selected cell page through the maintained native reader. The complete source bytes, parser identity, original cells, formula caches, date system and hidden rows remain in the retained response.',
    {file:originalFile,preview:{type:'object',additionalProperties:false,properties:{
      sheet:nonempty(500),range:nonempty(100),offset:{type:'integer',minimum:0,maximum:10000000},
      limit:{type:'integer',minimum:1,maximum:100}}},headerRow:{anyOf:[{type:'integer',minimum:1,maximum:10000000},{type:'null'}]}},
    ['file'],true),
  tool('workbook_project','Project an explicitly reviewed original worksheet/range and all selected columns through the same native reader. Supply the full mapping inline or a verified JSON reference. Formula, date, decimal, hidden-row and original-cell meanings remain unchanged.',
    {file:originalFile,mapping:object,mappingInput:reference},['file'],true,
    {oneOf:[{required:['mapping'],not:{required:['mappingInput']}},{required:['mappingInput'],not:{required:['mapping']}}]}),
  tool('source_read','Open the complete retained planning source project, its workbook/source editions, selected reviews and bindings. Select one role to expose its complete normalized rows, original record/cell mapping and source-edition comparison.',
    {...source,role},['project'],true),
  tool('source_receive','Receive a complete original UTF-8 delimited table as a new planning collection or another retained edition. Keep its exact source text and explicit initial delimiter/header choices before reviewing its mapping.',
    {...source,role,file:originalFile,delimiter:{enum:[',',';','\t','|']},header:{type:'boolean'}},
    ['project','role','file']),
  tool('source_workbook_receive','Receive one complete native workbook projection into its selected planning role. The selection reference must retain both original workbook source and complete projection. Mapping and collection review remain explicit.',
    {...source,role,selection:reference},['project','role','selection']),
  tool('source_workbook_return','Receive all four sheets of an edited native-plan workbook into the original source project. Explicit merge/replacement, hidden-row and dependent-setting choices preserve every original workbook and cell; review each resulting collection before native calculation.',
    {...source,file:originalFile,profile:returnProfile},['project','file','profile']),
  tool('source_configure','Configure the complete original planning binding, table mapping, project settings and source-row decisions. Fields resolve selected source columns, exact constants or existing native values. Every result is a new complete retained project.',
    {...source,role,binding:{type:'object',additionalProperties:false,properties:{
      fields:object,mode:{enum:['merge','replace']},excludedRows:{type:'array',items:object,maxItems:100000}}},
      tableMapping:object,settings:{type:'object',additionalProperties:false,properties:{
        scenarioName:nonempty(500),awardRequestUsd:nonempty(40),projectEndDay:{type:'integer',minimum:0,maximum:10000000}}},
      orphanPolicy:{enum:['preserve','remove-unreferenced']},
      exclusions:{type:'array',maxItems:100000,items:{type:'object',additionalProperties:false,
        properties:{record:{type:'integer',minimum:1,maximum:10000000},excluded:{type:'boolean'},note:str(2000)},
        required:['record','excluded']}}},
    ['project']),
  tool('source_select','Select an original source edition for a role, or an exact retained workbook selection that includes its original cells and conversion choices. Preserve the complete other editions and reviews.',
    {...source,role,editionId:nonempty(100),workbookSelectionId:nonempty(100)},['project'],false,
    {oneOf:[{required:['role','editionId'],not:{required:['workbookSelectionId']}},
      {required:['workbookSelectionId'],not:{anyOf:[{required:['role']},{required:['editionId']}]}}]}),
  tool('source_review','Freeze the current complete table interpretation for each explicitly named planning role. Existing source editions, row exclusions and separate merge/replacement decisions remain retained.',
    {...source,roles:{type:'array',minItems:1,maxItems:4,uniqueItems:true,items:role}},['project','roles']),
  tool('source_rebase','Retain the complete source project and its original workbook editions while explicitly selecting a new saved native baseline. Use this after receiving a planning ZIP in another declared workspace or after reviewing a later saved revision.',
    {...source,...plan},['project','planId']),
  tool('source_preview','Run the original grant calculator on the complete reviewed source project against its current saved baseline. Retain every source row, exact scenario/planning input, native budget/cash/capacity result and complete preview for named save.',
    source,['project'],true),
  tool('source_save','Save the exact reviewed source preview through the original native plan writer. Keep the complete preview reference, note and stable request ID after a lost response. The original request recovers its saved revision even after another operator saves later work.',
    {preview:reference,note:nonempty(4000),requestId},['preview','note','requestId']),
  tool('workbook_handover','Export an exact saved revision as the complete five-sheet editable workbook handover, original planning ZIP/history, source project, all mappings/tables and manifest. A completed request reopens its same retained files after MCP restart; full downloads use existing snapshot/chunk tools.',
    {...plan,profile,requestId},['planId','revision','expectedContentSha256','profile','requestId'],true),
];

// MIT. Complete native Gravity actions plus all inherited eLTSS77 operations.
import {readFileSync} from 'node:fs';
import {eltssMerchantTools,nativeInputActions as inheritedInputs} from '../../fhir_eltss/connected/catalog.mjs';
import {TOOL_PREFIX,ALIAS,SHA,OPERATION_ID,MAX_RETAINED_CHUNK_BYTES,plain,need,canonical} from './contracts.mjs';
const source=JSON.parse(readFileSync(new URL('../referral-schema.json',import.meta.url),'utf8'));
export const gravityReferralInputSchemas=source.schemas;
export const gravityReferralNativeContract=source.native;
export const gravityReferralBodyRoutes=[
  {
    "action": "referral_configuration_save",
    "key": "configuration",
    "schema": "configuration",
    "path": "configurations",
    "description": "Save the complete selected topology, actor/server ownership, original source version and monitoring policy."
  },
  {
    "action": "referral_edition_save",
    "key": "edition",
    "schema": "edition",
    "path": "editions",
    "description": "Retain the exact Task source/graph selection, configuration and predecessor."
  },
  {
    "action": "referral_review_profile",
    "key": "profile",
    "schema": "profileAdoption",
    "path": "reviews/profile",
    "description": "Adopt every original57 requirement and24 field review into one complete immutable review."
  },
  {
    "action": "referral_review_save",
    "key": "review",
    "schema": "review",
    "path": "reviews",
    "description": "Save the full original requirement and field review with explicit applicability, source references and reviewer dispositions."
  },
  {
    "action": "referral_assessment_create",
    "key": "assessment",
    "schema": "assessment",
    "path": "assessments",
    "description": "Observe the complete selected referral edition using its original review, configuration and explicit asOf."
  },
  {
    "action": "referral_decision_save",
    "key": "decision",
    "schema": "decision",
    "path": "decisions",
    "description": "Retain a scoped consent, ownership, workflow, finding, resource-link, receiving or contact decision and its exact successor."
  },
  {
    "action": "referral_edition_comparison_create",
    "key": "comparison",
    "schema": "comparison",
    "path": "edition-comparisons",
    "description": "Compare two original referral editions using exact identities and selected reviewed relationship decisions."
  },
  {
    "action": "referral_correction_preview",
    "key": "correction",
    "schema": "correctionPreview",
    "path": "corrections/preview",
    "description": "Preview complete authored patches against exact original resource paths while retaining the predecessor."
  },
  {
    "action": "referral_correction_apply",
    "key": "apply",
    "schema": "correctionApply",
    "path": "corrections/apply",
    "description": "Apply only the original previewId and expectedRequestSha256, preserving its same-request result."
  },
  {
    "action": "referral_exchange_request_save",
    "key": "request",
    "schema": "exchangeRequest",
    "path": "exchange-requests",
    "description": "Retain a complete source-selected GET or conditional PUT request with actual discovery, role, purpose, consent and original preimage."
  },
  {
    "action": "referral_monitoring_prepare",
    "key": "monitoring",
    "schema": "monitoring",
    "path": "monitoring",
    "description": "Prepare the original Task search or history acquisition with exact _lastUpdated bounds and selected actor endpoint."
  },
  {
    "action": "referral_handoff_prepare",
    "key": "handoff",
    "schema": "handoff",
    "path": "handoffs",
    "description": "Freeze the full referral edition, assessment, review, topology, original sources and exchange custody for receiving."
  },
  {
    "action": "referral_receiving_save",
    "key": "receiving",
    "schema": "receiving",
    "path": "receivings",
    "description": "Retain the actual receiver, original result artifact/object, original operation ID and correction predecessor."
  },
  {
    "action": "referral_export_prepare",
    "key": "selection",
    "schema": "export",
    "path": "exports",
    "description": "Prepare an exact native workspace, handoff, assessment, comparison or exchange-operation file as a retained artifact."
  }
];
export const nativeInputActions=Object.freeze({...inheritedInputs,
  ...Object.fromEntries(gravityReferralBodyRoutes.map(row=>[row.action,row.key]))});
const str=(description,extra={})=>({type:'string',description,...extra});
const sha=description=>str(description,{pattern:SHA});
const alias=str('Original host-declared workspace alias.',{pattern:ALIAS});
const token=str('Keep the original native operation token across receiving and continuation.',{pattern:OPERATION_ID});
const integer=(description,minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',description,minimum,maximum});
const paging={offset:integer('Original zero-based page offset.'),limit:integer('Original page count bound.',1,250)};
const search=str('Original text query within the saved result.',{maxLength:1000});
const selected={workspace:alias};
function tool(action,description,properties={},required=[],options={}){
  return {name:TOOL_PREFIX+action,description,inputSchema:{type:'object',additionalProperties:false,
    properties:{...selected,...properties},required:['workspace',...required]},
    annotations:{readOnlyHint:!options.mutates,destructiveHint:false,idempotentHint:!options.mutates,openWorldHint:!!options.external}};
}
export const referralCollections=['configurations','editions','reviews','assessments','decisions','comparisons',
  'correctionPreviews','corrections','exchangeRequests','exchangeOperations','monitoring','handoffs','receivings','receives'];
const added=[
 tool('referral_catalogue','Read the complete original Gravity typed catalogue, source limits and57/24 profile definitions.'),
 tool('referral_state','Read complete original referral record descriptors, exchange progress and archive receiving identities.'),
 tool('referral_profile','Read the full original Gravity profile, every source requirement and field review.'),
 tool('referral_guidance','Read the exact installed original guidance member index and hashes.'),
 tool('referral_guidance_packet','Retain the complete installed original Gravity guidance envelope as an unchanged JSON file.'),
 tool('referral_guidance_file','Retain one complete exact original guidance member.',{member:str('Exact member path from referral_guidance.',{minLength:1,maxLength:4000})},['member']),
 tool('referral_records','Page a complete original referral collection; follow returned nextOffset.',{
   collection:str('Exact native collection.',{enum:referralCollections}),...paging,query:search},['collection']),
 tool('referral_record','Read one immutable content record or original mutable operation/receiving token.',{
   collection:str('Exact native collection.',{enum:referralCollections}),recordId:token},['collection','recordId']),
 ...gravityReferralBodyRoutes.map(row=>tool(row.action,row.description,{[row.key]:{
   ...gravityReferralInputSchemas[row.schema],description:'Complete native '+row.schema+' input. The native validator owns source, role and cross-record semantics.'
 }},[row.key],{mutates:true})),
 ...['tasks','findings','cells','decisions'].map(member=>tool('referral_assessment_'+member,
   'Page complete original assessment '+member+' with exact Task identities and source locators.',{
     assessmentId:sha('Original assessment content ID.'),...paging,query:search,taskId:sha('Optional exact selected Task recordId.')
   },['assessmentId'])),
 tool('referral_assessment_file','Retain the complete original referral assessment JSON, including all Tasks, cells, findings and decisions.',{
   assessmentId:sha('Original assessment ID.')},['assessmentId']),
 tool('referral_edition_changes','Page all exact original referral edition changes.',{
   comparisonId:sha('Original referral comparison ID.'),...paging},['comparisonId']),
 tool('referral_edition_changes_file','Retain the complete original referral comparison JSON with every identity and value change.',{
   comparisonId:sha('Original referral comparison ID.')},['comparisonId']),
 tool('referral_exchange_advance','Continue this exact saved exchange request and original operation. Native readback precedes any repeated conditional PUT.',{
   requestId:sha('Original saved exchange request ID.'),operationId:token},['requestId','operationId'],{mutates:true,external:true}),
 tool('referral_exchange_operation','Read the complete original exchange operation after progress or an unknown response.',{
   operationId:token},['operationId']),
 tool('referral_exchange_operation_file','Retain complete native operation.json unchanged.',{operationId:token},['operationId']),
 tool('referral_exchange_operation_packet','Retain the entire original exchange directory: exact request, complete response bodies, headers and history.',{
   operationId:token},['operationId']),
 tool('referral_handoff_packet','Retain the full original referral handoff with complete editable native and referral custody.',{
   handoffId:sha('Original frozen handoff ID.')},['handoffId']),
 tool('referral_workspace_packet','Retain the complete native plus referral workspace as one original editable archive.'),
 tool('referral_workspace_import','Receive an exact host-declared complete Gravity workspace and reconcile its original UUID.',{
   input:alias,expectedSha256:sha('Original complete archive SHA256.')},['input'],{mutates:true}),
 tool('referral_handoff_import','Receive the full original referral handoff into a fresh Gravity workspace, adopting the original UUID.',{
   input:alias,expectedSha256:sha('Original complete handoff SHA256.')},['input'],{mutates:true}),
 tool('referral_published_examples_import','Retain the exact published example ZIP and explicitly reviewed source metadata; native intake preserves every original member.',{
   input:alias,expectedSha256:sha('Original complete published archive SHA256.'),selection:gravityReferralInputSchemas.publishedExamples
 },['input','selection'],{mutates:true})
];
const inherited=eltssMerchantTools.map(original=>{
  const row=structuredClone(original),action=row.name.slice('merchant_eltss_'.length);
  row.name=TOOL_PREFIX+action;
  row.description='Inherited native eLTSS: '+row.description;
  if(action==='input_apply')row.inputSchema.properties.action.enum=Object.keys(nativeInputActions);
  if(action==='receive_export'){
    row.inputSchema.properties.kind.enum.push('referral-handoff');
    row.description='Receive a complete retained original source, dataset, eLTSS or Gravity handoff, artifact, or full Gravity workspace through its exact native route.';
  }
  if(action==='workspace_packet'||action==='workspace_import')
    row.description+=' In Gravity this selects its complete native plus referral archive and original UUID.';
  return row;
});
export const gravityReferralMerchantTools=Object.freeze([...inherited,...added]);
export const gravityReferralActions=Object.freeze(Object.fromEntries(gravityReferralMerchantTools.map(row=>[
  row.name.slice(TOOL_PREFIX.length),row
])));
function validate(value,schema,path){
  if(schema.anyOf){
    let accepted=false;
    for(const choice of schema.anyOf){try{validate(value,choice,path);accepted=true;break;}catch(error){if(error.code!=='GRAVITY_REFERRAL_INPUT_INVALID')throw error;}}
    need(accepted,'GRAVITY_REFERRAL_INPUT_INVALID',path+' must match a declared native input variant.');return;
  }
  if(Object.hasOwn(schema,'const'))need(value===schema.const,'GRAVITY_REFERRAL_INPUT_INVALID',path+' must retain its original fixed value.');
  if(schema.enum)need(schema.enum.includes(value),'GRAVITY_REFERRAL_INPUT_INVALID',path+' must use a declared native value.');
  if(schema.type==='object'){
    need(plain(value),'GRAVITY_REFERRAL_INPUT_INVALID',path+' must be an object.');
    need((schema.required??[]).every(k=>Object.hasOwn(value,k)) &&
      (schema.maxProperties===undefined||Object.keys(value).length<=schema.maxProperties),
      'GRAVITY_REFERRAL_INPUT_INVALID',path+' is incomplete.');
    for(const [key,item] of Object.entries(value)){
      const field=schema.properties?.[key];
      need(field||schema.additionalProperties!==false,'GRAVITY_REFERRAL_INPUT_INVALID','Unknown field '+path+'.'+key+'.');
      if(field)validate(item,field,path+'.'+key);
      else if(plain(schema.additionalProperties))validate(item,schema.additionalProperties,path+'.'+key);
    }
  }else if(schema.type==='array'){
    need(Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Infinity),
      'GRAVITY_REFERRAL_INPUT_INVALID',path+' must retain its complete selected array within native limits.');
    if(schema.uniqueItems)need(new Set(value.map(v=>JSON.stringify(canonical(v)))).size===value.length,
      'GRAVITY_REFERRAL_INPUT_INVALID',path+' repeats an original selection.');
    for(let i=0;i<value.length;i++)validate(value[i],schema.items??{},path+'['+i+']');
  }else if(schema.type==='integer'||schema.type==='number'){
    need(typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&
      value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity),'GRAVITY_REFERRAL_INPUT_INVALID',path+' exceeds its native numeric bounds.');
  }else if(schema.type==='string'){
    need(typeof value==='string','GRAVITY_REFERRAL_INPUT_INVALID',path+' must be text.');
    const length=Array.from(value).length;
    need(length>=(schema.minLength??0)&&length<=(schema.maxLength??Infinity)&&
      (!schema.pattern||new RegExp(schema.pattern).test(value)),
      'GRAVITY_REFERRAL_INPUT_INVALID',path+' must retain its declared original string format.');
  }else if(schema.type==='boolean')need(typeof value==='boolean','GRAVITY_REFERRAL_INPUT_INVALID',path+' must be boolean.');
  else if(schema.type==='null')need(value===null,'GRAVITY_REFERRAL_INPUT_INVALID',path+' must be null.');
}
export function validateGravityReferralArguments(name,args={}){
  const action=name.startsWith(TOOL_PREFIX)?name.slice(TOOL_PREFIX.length):name,row=gravityReferralActions[action];
  need(row,'GRAVITY_REFERRAL_TOOL_UNKNOWN','Select an original declared Gravity operation.');
  validate(args,row.inputSchema,action);return action;
}

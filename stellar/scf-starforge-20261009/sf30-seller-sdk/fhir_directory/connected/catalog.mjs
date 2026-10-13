// MIT. One catalogue over the original native directory schemas and complete Gravity actions.
import {readFileSync} from 'node:fs';
import {
  gravityReferralMerchantTools,nativeInputActions as inheritedInputs
} from '../../fhir_referral/connected/catalog.mjs';
import {TOOL_PREFIX,SHA,ALIAS,plain,need,canonical} from './contracts.mjs';

export const directoryNativeContract=JSON.parse(readFileSync(new URL('../directory-schema.json',import.meta.url),'utf8'));
export const directorySourceContract=JSON.parse(readFileSync(new URL('../directory-source-schema.json',import.meta.url),'utf8'));
export const directoryConformanceContract=JSON.parse(readFileSync(new URL('../directory-conformance-schema.json',import.meta.url),'utf8'));
export const directoryOperatingPlansContract=JSON.parse(readFileSync(new URL('../directory-operating-plans-schema.json',import.meta.url),'utf8'));
export const directoryOperatingReturnsContract=JSON.parse(readFileSync(new URL('../directory-operating-returns-schema.json',import.meta.url),'utf8'));
export const directoryWorksheetReconciliationContract=JSON.parse(readFileSync(new URL('../directory-correction-worksheet-reconciliation-schema.json',import.meta.url),'utf8'));
export const directoryCorrectionWorksheetsContract=JSON.parse(readFileSync(new URL('../directory-correction-worksheets-schema.json',import.meta.url),'utf8'));
export const directoryCorrectionsContract=JSON.parse(readFileSync(new URL('../directory-corrections-schema.json',import.meta.url),'utf8'));
export const directoryForeignKeyQueries=Object.freeze([
  {
    "key": "conformance_foreign_keys",
    "action": "directory_conformance_foreign_keys",
    "route": "foreign-keys",
    "filters": [
      "table",
      "state",
      "ruleId",
      "sourceId",
      "recordId"
    ],
    "description": "Read every original declared foreign-key outcome, keeping existence, ambiguity, physical values and selected coverage separate."
  },
  {
    "key": "conformance_foreign_key_candidates",
    "action": "directory_conformance_foreign_key_candidates",
    "route": "foreign-key-candidates",
    "filters": [
      "table",
      "state",
      "groupId",
      "sourceId",
      "recordId"
    ],
    "description": "Read every retained target candidate, including null, invalid and non-tabular original rows; do not choose an ambiguous candidate."
  },
  {
    "key": "conformance_foreign_key_matches",
    "action": "directory_conformance_foreign_key_matches",
    "route": "foreign-key-matches",
    "filters": [
      "outcomeId",
      "candidateId"
    ],
    "description": "Read every original outcome-to-candidate match with both unchanged source references and exact key identity."
  }
].map(row=>{
  const schemaValue=directoryConformanceContract.querySchemas?.[row.key];
  need(schemaValue?.type==='object'&&schemaValue.additionalProperties===false&&schemaValue.properties?.offset&&schemaValue.properties?.limit,
    'HUMAN_SERVICES_DIRECTORY_FOREIGN_KEY_CONTRACT','Install the complete source-owned foreign-key catalogue with this client.');
  return Object.freeze({...row,schemaValue});
}));
export const directoryInputSchemas=directoryNativeContract.inputSchemas;
export const directorySourceInputSchemas=directorySourceContract.inputSchemas;
const sourceRoutes=[
  {
    "action": "directory_connection_save",
    "key": "connection",
    "schema": "connection",
    "path": "connections",
    "description": "Save the complete selected HSDS or FHIR directory endpoint and existing authentication profile."
  },
  {
    "action": "directory_discover",
    "key": "discovery",
    "schema": "discover",
    "path": "discover",
    "external": true,
    "description": "Retain the actual directory root or FHIR CapabilityStatement using the original operation ID."
  },
  {
    "action": "directory_import_profile_save",
    "key": "profile",
    "schema": "import",
    "path": "imports",
    "description": "Retain the complete source import metadata before receiving the original file."
  },
  {
    "action": "directory_request_save",
    "key": "request",
    "schema": "request",
    "path": "requests",
    "description": "Save exact native GET selections, repeated parameters, source scope and complete pagination policy."
  },
  {
    "action": "directory_acquire",
    "key": "acquisition",
    "schema": "acquire",
    "path": "acquire",
    "description": "Reserve the original selected directory request and operation ID for retained acquisition."
  },
  {
    "action": "directory_edition_save",
    "key": "edition",
    "schema": "edition",
    "path": "editions",
    "description": "Freeze complete source indices and the reviewed directory edition with original reference links."
  },
  {
    "action": "directory_compare",
    "key": "comparison",
    "schema": "comparison",
    "path": "comparisons",
    "description": "Compare two original editions while preserving ambiguous identities and all reviewed links."
  }
];
export const directoryBodyRoutes=Object.freeze([
  ...sourceRoutes.map(row=>({...row,schemaValue:directorySourceInputSchemas[row.schema],target:'/api/directory/'+row.path})),
  ...directoryNativeContract.actions.map(row=>({
    action:'directory_'+row.id.replaceAll('-','_'),key:row.input,schema:row.input,
    schemaValue:directoryInputSchemas[row.input],target:row.path,readOnly:row.readOnly===true,
    description:'Apply the complete native '+row.id+' input to the selected original directory workspace.'
  }))
]);
export const nativeInputActions=Object.freeze({...inheritedInputs,
  ...Object.fromEntries(directoryBodyRoutes.map(row=>[row.action,row.key]))});
const str=(description,extra={})=>({type:'string',description,...extra});
const hash=description=>str(description,{pattern:SHA});
const alias=str('Original host-declared workspace alias.',{pattern:ALIAS});
const sourceRef=directorySourceContract.recordRef;
const page=directorySourceInputSchemas.page.properties;
const selected={workspace:alias};
export const directoryCollections=Object.freeze([
  'connections','discoveries','requests','importProfiles','sources','editions','comparisons','operations',
  'mappings','mappingPreviews','sourceConversions','selections','referralJoins','handoffs','exports','receivingReviews','receives',
  ...directoryConformanceContract.recordKinds,'operatingPlans','operatingPlanReturns',...directoryCorrectionsContract.collections,...directoryCorrectionWorksheetsContract.collections,...directoryWorksheetReconciliationContract.collections
]);
function tool(action,description,properties={},required=[],options={}){
  return {name:TOOL_PREFIX+action,description,
    inputSchema:{type:'object',additionalProperties:false,properties:{...selected,...properties},
      required:['workspace',...required]},
    annotations:{readOnlyHint:!options.mutates,destructiveHint:false,idempotentHint:!options.mutates,
      openWorldHint:!!options.external}};
}
const originalId=str('Exact original record or operation ID.',{pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'});
const added=[
  tool('directory_correction_worksheet_reconciliation_catalogue','Read the exact native three-way reconciliation input catalogue.'),
  tool('directory_correction_worksheet_reconciliation_rows','Read complete typed base, customer proposal and current comparisons or immutable operator decisions.',{
    collection:str('Exact reconciliation collection.',{enum:directoryWorksheetReconciliationContract.collections}),
    recordId:hash('Exact immutable reconciliation or review ID.'),offset:page.offset,limit:page.limit,
    rowKey:hash('Optional exact original worksheet row key.'),state:str('Exact native comparison state or review decision.',{enum:[...directoryWorksheetReconciliationContract.states,...directoryWorksheetReconciliationContract.decisions]})
  },['collection','recordId']),
  tool('directory_correction_worksheet_reconciliation_file','Receive the entire original input, row graph, comparison or decisions file, including records larger than the page budget.',{
    collection:str('Exact reconciliation collection.',{enum:directoryWorksheetReconciliationContract.collections}),
    recordId:hash('Exact immutable reconciliation or review ID.'),
    fileKind:str('Complete native file kind.',{enum:['input','rows','comparison','decisions']})
  },['collection','recordId','fileKind']),

  tool('directory_correction_worksheet_rows','Read complete selected worksheet rows, original returned differences or explicit review decisions with exact immutable row keys.',{
    collection:str('Exact worksheet collection.',{enum:directoryCorrectionWorksheetsContract.collections}),
    recordId:hash('Exact immutable worksheet record.'),offset:page.offset,limit:page.limit,
    rowKey:hash('Optional exact worksheet row key.'),state:str('Optional exact original, proposed or reviewed change state.',{enum:['original','proposed','accept','keep-original']})
  },['collection','recordId']),
  tool('directory_correction_worksheet_file','Receive the entire original worksheet, rows, returned file, changes or decisions. Full files remain available when one change exceeds the page budget.',{
    collection:str('Exact worksheet collection.',{enum:directoryCorrectionWorksheetsContract.collections}),
    recordId:hash('Exact immutable worksheet record.'),
    fileKind:str('Original complete file kind.',{enum:['input','rows','worksheet','original','changes','decisions']})
  },['collection','recordId','fileKind']),
  tool('directory_correction_worksheet_document','Read the complete immutable original worksheet document, including exact original values and physical CSV cells.',{
    worksheetId:hash('Exact prepared worksheet ID.')
  },['worksheetId']),
  tool('directory_correction_worksheet_receive','Receive the complete original customer returned file through its already saved immutable intake record.',{
    importId:hash('Exact saved worksheet import ID.'),input:alias,
    expectedSha256:hash('Complete unchanged returned-file SHA-256.')
  },['importId','input'],{mutates:true}),

  tool('directory_correction_rows','Read every retained ordered edit or original before/after change for the selected immutable correction record.',{
    collection:str('Exact native correction collection.',{enum:directoryCorrectionsContract.collections}),
    recordId:hash('Exact immutable correction record ID.'),offset:page.offset,limit:page.limit
  },['collection','recordId']),
  tool('directory_correction_file','Receive the entire original plan input, change JSONL or complete review graph with its native byte identity.',{
    collection:str('Exact native correction collection.',{enum:directoryCorrectionsContract.collections}),
    recordId:hash('Exact immutable correction record ID.'),
    fileKind:str('Plans expose input; previews and accepted corrections expose changes and review.',{enum:['input','changes','review']})
  },['collection','recordId','fileKind']),
  tool('directory_state','Read complete native state including original directory sources, reviews, selections and receiving.'),
  tool('directory_catalogue','Read the installed native directory and source input catalogues.'),
  tool('directory_guidance','Read every original published mapping and the explicit reviewed migration definitions.'),
  tool('directory_guidance_file','Retain the complete selected original guidance member.',{
    member:str('Exact sourceId/path from the original guidance index.',{minLength:1,maxLength:4096})
  },['member']),
  tool('directory_records','Read the selected complete directory collection, following native paging when returned.',{
    collection:str('Original native collection.',{enum:directoryCollections}),
    ...directoryInputSchemas.page.properties
  },['collection']),
  tool('directory_record','Read the exact original directory record or acquisition journal.',{
    collection:str('Original native collection.',{enum:directoryCollections}),recordId:originalId
  },['collection','recordId']),
  ...directoryBodyRoutes.map(row=>tool(row.action,row.description,{
    [row.key]:{...row.schemaValue,description:'Complete native '+row.schema+' input; source semantics remain with the original workspace.'}
  },[row.key],{mutates:!row.readOnly,external:!!row.external})),
  ...['advance','pause','resume'].map(action=>tool('directory_'+action,
    action==='advance'?'Continue the same directory acquisition and retain its exact provider response and pagination state.':
      action==='pause'?'Pause local progress of the same original directory acquisition.':
        'Resume the original directory acquisition and reuse any retained complete response.',
    directorySourceInputSchemas.operation.properties,['operationId'],{mutates:true,external:action==='advance'})),
  tool('directory_operation','Read the complete original acquisition journal after progress or an uncertain response.',
    directorySourceInputSchemas.operation.properties,['operationId']),
  tool('directory_source_rows','Read original indexed records with exact source locators, hashes and numeric tokens.',{
    sourceId:hash('Original source ID.'),...page
  },['sourceId']),
  tool('directory_source_row','Read one complete original indexed directory record.',sourceRef.properties,['sourceId','recordId']),
  tool('directory_source_members','Read the complete original source member index.',{sourceId:hash('Original source ID.')},['sourceId']),
  tool('directory_source_file','Retain one full original input or the complete selected archive member without rewriting its bytes.',{
    sourceId:hash('Original source ID.'),member:str('Optional exact member name returned by the source member index.',{maxLength:4096})
  },['sourceId']),
  tool('directory_source_import','Receive a complete host-declared source using its already saved native import profile.',{
    importProfileId:hash('Original saved import profile ID.'),input:alias,
    expectedSha256:hash('Original complete source SHA256.')
  },['importProfileId','input'],{mutates:true}),
  tool('directory_edition_rows','Read the complete original edition selection with native paging.',{
    editionId:hash('Original edition ID.'),...page
  },['editionId']),
  tool('directory_edition_row','Read one original source record selected by this exact edition.',{
    editionId:hash('Original edition ID.'),...sourceRef.properties
  },['editionId','sourceId','recordId']),
  tool('directory_edition_links','Read source-owned directory reference links for the exact edition.',{
    editionId:hash('Original edition ID.'),recordId:hash('Optional original record ID.'),
    offset:page.offset,limit:page.limit
  },['editionId']),
  tool('directory_link_targets','Read every original target resolved for one source-owned reference link in this edition.',{
    editionId:hash('Original edition ID.'),sourceId:hash('Original source ID.'),linkId:hash('Original link ID.'),
    offset:page.offset,limit:page.limit
  },['editionId','sourceId','linkId']),
  tool('directory_index_file','Retain the complete original SQLite source, edition or comparison index.',{
    collection:str('Original complete index collection.',{enum:['sources','editions','comparisons']}),
    recordId:hash('Original source, edition or comparison ID.')
  },['collection','recordId']),
  tool('directory_source_record_file','Retain one complete original record value as JSON with its original numeric tokens.',{
    sourceId:hash('Original source ID.'),recordId:hash('Original record ID.')
  },['sourceId','recordId']),
  tool('directory_comparison_changes_file','Retain all complete comparison changes as original JSON lines.',{
    comparisonId:hash('Original comparison ID.')
  },['comparisonId']),
  tool('directory_capture_file','Retain the complete original acquired pages, metadata and request as a reingestable capture archive.',
    directorySourceInputSchemas.operation.properties,['operationId']),
  tool('directory_capture_source','Freeze all currently received complete pages with their actual acquisition completion state.',
    directorySourceInputSchemas.operation.properties,['operationId'],{mutates:true}),
  tool('directory_comparison_changes','Read every original edition change, retaining ambiguous and unidentified identities.',{
    comparisonId:hash('Original comparison ID.'),...directorySourceInputSchemas.changes.properties
  },['comparisonId']),
  tool('directory_mapping_preview_details','Read all generated resources, source-to-field cells or findings for the selected complete mapping preview.',{
    mappingPreviewId:hash('Original mapping preview ID.'),
    group:str('Native complete preview detail group.',{enum:['resources','fields','findings']}),
    offset:directoryInputSchemas.page.properties.offset,limit:directoryInputSchemas.page.properties.limit
  },['mappingPreviewId','group']),
  tool('directory_selection_candidates','Read every candidate, its original schedule and capacity interpretation, and the retained selection disposition.',{
    selectionId:hash('Original service selection ID.'),...directoryInputSchemas.page.properties
  },['selectionId']),
  tool('directory_conformance_findings','Read complete assessment findings with exact original row and requirement references; follow every native page.',{
    assessmentId:hash('Saved immutable conformance assessment ID.'),offset:page.offset,limit:page.limit,
    severity:str('Exact finding severity.',{enum:['error','warning','not-evaluated']}),
    table:str('Exact original table or resource type.',{maxLength:128}),
    code:str('Exact retained rule code.',{maxLength:200}),
    sourceId:hash('Filter by an original source ID.'),recordId:hash('Filter by an original source record ID.')
  },['assessmentId']),
  tool('directory_conformance_finding','Read one complete immutable finding, its original value and selected requirement source.',{
    assessmentId:hash('Saved conformance assessment ID.'),findingId:hash('Exact finding ID in this assessment.')
  },['assessmentId','findingId']),
  tool('directory_conformance_rows','Read every assessed original row and its complete rule outcome counts.',{
    assessmentId:hash('Saved conformance assessment ID.'),offset:page.offset,limit:page.limit,
    table:str('Exact original table or resource type.',{maxLength:128})
  },['assessmentId']),
  ...directoryForeignKeyQueries.map(row=>tool(row.action,row.description,{
    assessmentId:hash('Exact saved immutable conformance assessment ID.'),...row.schemaValue.properties
  },['assessmentId'])),
  tool('directory_conformance_file','Retain the full selected report, finding index, original row file, rule catalogue or complete conformance package.',{
    collection:str('Original conformance file collection.',{enum:['assessments','reviews','comparisons']}),
    recordId:hash('Exact saved conformance record ID.'),
    fileKind:str('Select a file declared in this record’s files map.',{enum:directoryConformanceContract.fileKinds})
  },['collection','recordId','fileKind']),
  ...['review','comparison','input'].map(kind=>tool('directory_operating_return_'+kind,
    'Read the complete original returned-procedure '+kind+' with both saved histories and exact decisions.',
    {recordId:hash('Original immutable operatingPlanReturns record ID.')},['recordId'])),
  tool('directory_operating_return_rows','Read each complete original returned-procedure change with explicit choices, coupled work/results and contiguous paging.',{
    recordId:hash('Original immutable return record ID.'),...directoryOperatingReturnsContract.inputSchemas.operating_return_rows.properties
  },['recordId']),
  tool('directory_operating_return_file','Retain the entire original return review, comparison or accepted input without truncation.',{
    recordId:hash('Original immutable return record ID.'),
    fileKind:str('Exact original retained return file.',{enum:directoryOperatingReturnsContract.fileKinds})
  },['recordId','fileKind']),
  tool('directory_operating_catalog','Read the complete original command registration catalogue used by the selected Directory product.'),
  ...['document','draft','input','basis'].map(kind=>tool('directory_operating_'+kind,
    {document:'Read every saved revision of the complete original OperatingPlan.',
      draft:'Reopen the selected original revision as an editable draft with its native base revision.',
      input:'Read the complete accepted or prepared procedure input with its original request identity.',
      basis:'Read the exact original Directory record basis, hashes and observation time.'}[kind],
    {recordId:hash('Exact original native operatingPlans record ID.'),
      ...(kind==='draft'?{revision:{...directoryInputSchemas.operating_plan_compare.properties.revision,description:'Selected saved original revision; omission uses the current document revision.'}}:{})},
    ['recordId'])),
  tool('directory_handoff_file','Retain the full selected directory handoff with editable workspace and original source custody.',{
    handoffId:hash('Original handoff ID.')
  },['handoffId']),
  tool('directory_workspace_packet','Retain the complete original directory, Gravity and source workspace as one editable archive.'),
  tool('directory_export_file','Retain the complete original file prepared by the selected native export record.',{
    exportId:hash('Original native directory export record ID.')
  },['exportId']),
  tool('directory_workspace_import','Receive the complete original directory archive and preserve its workspace UUID.',{
    input:alias,expectedSha256:hash('Original complete workspace SHA256.')
  },['input'],{mutates:true}),
  tool('directory_handoff_import','Receive the complete original directory handoff with its editable workspace.',{
    input:alias,expectedSha256:hash('Original complete handoff SHA256.')
  },['input'],{mutates:true})
];
const inherited=gravityReferralMerchantTools.map(original=>{
  const row=structuredClone(original),action=row.name.slice('merchant_gravity_referral_'.length);
  row.name=TOOL_PREFIX+action;
  row.description='Original Gravity/eLTSS workspace: '+row.description;
  if(action==='input_apply')row.inputSchema.properties.action.enum=Object.keys(nativeInputActions);
  if(action==='receive_export'){
    row.inputSchema.properties.kind.enum.push('directory-source','directory-handoff','directory-correction-worksheet-return');
    row.inputSchema.properties.importProfileId=hash('Required saved native import profile for a directory-source receive.');
    row.inputSchema.properties.importId=hash('Required saved worksheet import for a directory-correction-worksheet-return receive.');
  }
  if(action==='workspace_packet'||action==='workspace_import')
    row.description+=' This directory provider selects its complete directory-plus-Gravity archive.';
  return row;
});
export const humanServicesDirectoryMerchantTools=Object.freeze([...inherited,...added]);
export const humanServicesDirectoryActions=Object.freeze(Object.fromEntries(humanServicesDirectoryMerchantTools.map(row=>[
  row.name.slice(TOOL_PREFIX.length),row
])));
function validate(value,schema,path){
  if(schema.oneOf){
    let matches=0;for(const choice of schema.oneOf){try{validate(value,choice,path);matches++;}catch(error){if(error.code!=='HUMAN_SERVICES_DIRECTORY_INPUT_INVALID')throw error;}}
    need(matches===1,'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' must match exactly one declared native input variant.');return;
  }
  if(schema.anyOf){
    const accepted=schema.anyOf.some(choice=>{
      try{validate(value,choice,path);return true;}
      catch(error){if(error.code!=='HUMAN_SERVICES_DIRECTORY_INPUT_INVALID')throw error;return false;}
    });
    need(accepted,'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' must match a declared native input variant.');return;
  }
  if(Object.hasOwn(schema,'const'))need(value===schema.const,'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' must keep its declared value.');
  if(schema.enum)need(schema.enum.includes(value),'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' must use a declared value.');
  if(schema.type==='object'){
    need(plain(value),'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' must be an object.');
    need((schema.required??[]).every(key=>Object.hasOwn(value,key))&&
      (schema.maxProperties===undefined||Object.keys(value).length<=schema.maxProperties),
      'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' is incomplete.');
    for(const [key,item]of Object.entries(value)){
      const field=schema.properties?.[key];
      need(field||schema.additionalProperties!==false,'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID','Unknown field '+path+'.'+key+'.');
      if(field)validate(item,field,path+'.'+key);
      else if(plain(schema.additionalProperties))validate(item,schema.additionalProperties,path+'.'+key);
    }
  }else if(schema.type==='array'){
    need(Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Infinity),
      'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' exceeds the native array limits.');
    if(schema.uniqueItems)need(new Set(value.map(v=>JSON.stringify(canonical(v)))).size===value.length,
      'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' repeats an original selection.');
    for(let index=0;index<value.length;index++)validate(value[index],schema.items??{},path+'['+index+']');
  }else if(schema.type==='integer'||schema.type==='number'){
    need(typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&
      value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity),
      'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' exceeds the native numeric limits.');
  }else if(schema.type==='string'){
    need(typeof value==='string','HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' must be text.');
    const length=Array.from(value).length;
    need(length>=(schema.minLength??0)&&length<=(schema.maxLength??Infinity)&&
      (!schema.pattern||new RegExp(schema.pattern).test(value)),
      'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' does not match its declared format.');
  }else if(schema.type==='boolean')need(typeof value==='boolean','HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' must be boolean.');
  else if(schema.type==='null')need(value===null,'HUMAN_SERVICES_DIRECTORY_INPUT_INVALID',path+' must be null.');
}
export function validateHumanServicesDirectoryArguments(name,args={}){
  const action=name.startsWith(TOOL_PREFIX)?name.slice(TOOL_PREFIX.length):name,row=humanServicesDirectoryActions[action];
  need(row,'HUMAN_SERVICES_DIRECTORY_TOOL_UNKNOWN','Select a declared directory or original Gravity operation.');
  validate(args,row.inputSchema,action);
  if(action==='receive_export'&&args.kind==='directory-source')
    validate(args.importProfileId,{type:'string',pattern:SHA},action+'.importProfileId');
  if(action==='receive_export'&&args.kind==='directory-correction-worksheet-return')
    validate(args.importId,{type:'string',pattern:SHA},action+'.importId');
  return action;
}

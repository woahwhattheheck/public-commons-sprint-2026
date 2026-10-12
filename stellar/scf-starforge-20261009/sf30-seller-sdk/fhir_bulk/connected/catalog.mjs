// MIT. Metadata-only original FHIR operation catalog. Native validators own clinical/source semantics.
import {TOOL_PREFIX,ALIAS,UUID,SHA,OPERATION_ID,SOURCE_FILE_ID,RESOURCE_TYPE,MAX_RETAINED_CHUNK_BYTES,plain,need} from './contracts.mjs';
const string=(description,extra={})=>({type:'string',description,...extra});
const alias=string('Host-declared original workspace alias.',{pattern:ALIAS});
const hash=description=>string(description,{pattern:SHA});
const uuid=description=>string(description,{pattern:UUID});
const object=description=>({type:'object',description,additionalProperties:true});
const integer=(description,minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',description,minimum,maximum});
const sourceId=hash('Original retained source SHA256.');
const buildId=hash('Original native build SHA256.');
const operationId=string('Original saved acquisition operation token. Keep this ID throughout acquisition and recovery.',{pattern:OPERATION_ID});
const resourceType=string('Exact FHIR resource type.',{pattern:RESOURCE_TYPE});
const paging={offset:integer('Original zero-based offset.'),limit:integer('Original page size.',1,250)};
const selected={workspace:alias};
function tool(action,description,properties={},required=[],{mutates=false,external=false,workspace=true}={}){
  return {name:TOOL_PREFIX+action,description,inputSchema:{type:'object',additionalProperties:false,
    properties:{...(workspace?selected:{}),...properties},required:[...(workspace?['workspace']:[]),...required]},
    annotations:{readOnlyHint:!mutates,destructiveHint:false,idempotentHint:!mutates,openWorldHint:external}};
}
const t=(...args)=>tool(...args);
export const fhirMerchantTools=[
  t('workspaces','List configured FHIR workspace aliases and original input identities.',{},[],{workspace:false}),
  t('schema','Read the complete callable FHIR catalog and the original file/recovery contract.',{},[],{workspace:false}),
  t('operator_open','Borrow the running native FHIR operator; allowStart may start the normal native serve process.',{},[],{mutates:true}),
  t('operator_release','Release this connection. Only a native process started by this provider is closed.',{},[],{mutates:true}),
  t('operator','Read the authenticated original native operator identity.'),
  t('state','Retain the complete native workspace state, including saved acquisition and receiving records.'),
  t('catalogue','Read the original source catalogue shipped with this FHIR product.'),
  t('auth_profiles','List original configured authentication-profile metadata.'),
  t('connection','Read one original saved provider connection.',{connectionId:hash('Original connection content SHA256.')},['connectionId']),
  t('connection_save','Save a complete provider connection using the native FHIR connection validator.',
    {connection:object('Native connection: label, baseUrl, protocol stu2/stu3, authProfile, origin, publisher, sourceUrl and note.')},
    ['connection'],{mutates:true}),
  t('discover','Run original CapabilityStatement discovery for the saved connection and retain its entire response.',
    {connectionId:hash('Original connection content SHA256.')},['connectionId'],{mutates:true,external:true}),
  t('groups','Read one original Group Bundle page; use the exact provider next URL for later pages.',
    {connectionId:hash('Original connection content SHA256.'),url:string('Exact next URL retained in the previous original Group Bundle.',{maxLength:16384})},
    ['connectionId'],{mutates:true,external:true}),
  t('discovery','Read the complete retained discovery record.',{discoveryId:hash('Original discovery record SHA256.')},['discoveryId']),
  t('group_page','Read one complete retained Group Bundle record.',{groupPageId:hash('Original Group page record SHA256.')},['groupPageId']),
  t('export','Read the exact original native export definition. This ID is distinct from a merchant retained-file export.',
    {exportId:hash('Original native export-definition SHA256.')},['exportId']),
  t('export_save','Save the complete native export definition and rendered request before acquisition.',
    {export:object('Native export definition: connectionId, scope, groupId, method, parameters, limits, label and note. Use original saved values.')},
    ['export'],{mutates:true}),
  t('export_advance','Continue the same saved acquisition operation. The native state machine owns polling, Retry-After, output transfer and completion.',
    {exportId:hash('Original native export-definition SHA256.'),operationId},['exportId','operationId'],{mutates:true,external:true}),
  t('operation','Read the complete saved native operation after progress, interruption or provider response.',
    {operationId},['operationId']),
  t('operation_status','Adopt an original accepted status URL into the same saved operation using the native recovery path.',
    {operationId,statusUrl:string('Exact original accepted provider status URL.',{maxLength:16384}),
      reason:string('Original status recovery reason.',{minLength:1,maxLength:4096})},['operationId','statusUrl','reason'],{mutates:true}),
  t('operation_receive_capture','Complete the same original accepted acquisition operation from a fully retained original source packet.',
    {operationId,sourceId,reason:string('Reason for receiving the complete original capture.',{minLength:1,maxLength:4096})},
    ['operationId','sourceId','reason'],{mutates:true}),
  t('operation_cancel','Cancel the original provider operation through its saved native owner.',
    {operationId,requestId:string('Original cancellation request token.',{pattern:OPERATION_ID})},['operationId','requestId'],{mutates:true,external:true}),
  t('source','Read the original complete source inventory.',{sourceId},['sourceId']),
  t('source_members','Retain all complete original member identities, including nested composition members.',{sourceId},['sourceId']),
  t('source_rows','Inspect original resource rows with native paging and search.',
    {sourceId,resourceType,kind:string('Native source stream kind.',{enum:['output','deleted','error','all']}),...paging,
      query:string('Original source search text.',{maxLength:4096})},['sourceId']),
  t('source_row','Read one complete original resource row by its original file identity and one-based line.',
    {sourceId,fileId:string('Exact fileId returned by source_rows; a nested original can have two SHA256 values separated by a colon.',{pattern:SOURCE_FILE_ID}),
      line:integer('Original one-based NDJSON line.',1)},['sourceId','fileId','line']),
  t('source_file','Retain a complete original source member as a downloadable file.',
    {sourceId,member:string('Exact member name returned by source_members.',{minLength:1,maxLength:2048})},['sourceId','member']),
  t('source_packet','Retain the whole original source ZIP.',{sourceId},['sourceId']),
  t('source_import','Import one complete host-declared source file through the native source intake.',
    {input:string('Host-declared complete source input alias.',{pattern:ALIAS}),expectedSha256:hash('Selected complete input SHA256.'),
      label:string('Source label.',{minLength:1,maxLength:160})},['input'],{mutates:true}),
  t('mapping_default','Derive a starting mapping from the original source and exact resource type.',
    {sourceId,resourceType,name:string('Mapping name.',{minLength:1,maxLength:160})},['sourceId','resourceType'],{mutates:true}),
  t('mapping_preview','Preview a complete reviewed mapping against original resource rows.',
    {sourceId,plan:object('Complete native FHIR mapping plan.'),limit:integer('Native preview page size.',1,250)},
    ['sourceId','plan'],{mutates:true}),
  t('compose','Compose original base and ordered delta captures with the native deletion/version rules and explicit conflict resolutions.',
    {composition:object('Native composition: baseSourceId, deltaSourceIds, label and resolutions.')},['composition'],{mutates:true}),
  t('plan','Read one original reviewed mapping plan.',{planId:hash('Original mapping-plan SHA256.')},['planId']),
  t('plan_save','Save a complete native reviewed mapping plan.',
    {plan:object('Complete native FHIR mapping plan, including its original schema and projection fields.')},['plan'],{mutates:true}),
  t('build','Read the original completed build and dataset review.',{buildId},['buildId']),
  t('build_create','Build a complete native dataset from one original source and saved reviewed plan.',
    {sourceId,planId:hash('Original mapping-plan SHA256.')},['sourceId','planId'],{mutates:true}),
  t('build_query','Run the original SF30 dataset query against the selected completed FHIR build.',
    {buildId,query:{type:'object',description:'Original single-value dataset query parameters; preserve exact literal strings.',
      additionalProperties:{type:'string',maxLength:8192},maxProperties:40}},['buildId']),
  t('build_dataset','Retain the complete data.csv, dataset.json and native lineage ZIP.',{buildId},['buildId']),
  t('build_packet','Retain the full customer dataset packet with its original source and reviewed mapping.',{buildId},['buildId']),
  t('comparison_create','Compare two original native dataset editions.',
    {beforeId:buildId,afterId:buildId},['beforeId','afterId'],{mutates:true}),
  t('comparison_changes','Read a page of original edition changes.',
    {comparisonId:hash('Original comparison SHA256.'),...paging},['comparisonId']),
  t('comparison_file','Retain the complete original edition-change JSONL file.',
    {comparisonId:hash('Original comparison SHA256.')},['comparisonId']),
  t('workspace_packet','Retain the complete editable native workspace ZIP, including original operation custody.'),
  t('workspace_import','Receive a complete host-declared workspace ZIP into the native fresh workspace, preserving its original UUID.',
    {input:string('Host-declared complete workspace input alias.',{pattern:ALIAS}),expectedSha256:hash('Selected complete input SHA256.')},
    ['input'],{mutates:true}),
  t('packet_import','Receive a complete host-declared customer dataset packet through the original native intake.',
    {input:string('Host-declared complete customer-packet input alias.',{pattern:ALIAS}),expectedSha256:hash('Selected complete input SHA256.')},
    ['input'],{mutates:true}),
  t('receive_export','Receive a full retained source, customer packet or workspace ZIP into another configured native workspace.',
    {sourceWorkspace:alias,exportId:hash('Merchant retained-file export SHA256.'),expectedManifestSha256:hash('Selected original manifest SHA256.'),
      kind:string('Native receiving route.',{enum:['source','packet','workspace']}),label:string('Source intake label.',{minLength:1,maxLength:160})},
    ['sourceWorkspace','exportId','expectedManifestSha256','kind'],{mutates:true}),
  t('manifest','Read the exact manifest of a complete retained merchant file export.',
    {exportId:hash('Merchant retained-file export SHA256.')},['exportId']),
  t('file','Read an exact complete-file range with SHA256 identity; resume the same offset after a released read.',
    {exportId:hash('Merchant retained-file export SHA256.'),file:string('Exact original manifest filename.',{minLength:1,maxLength:240}),
      expectedManifestSha256:hash('Original full manifest SHA256.'),expectedSha256:hash('Original full file SHA256.'),
      offset:integer('Original byte offset.'),limit:integer('Maximum complete-file range bytes.',1,MAX_RETAINED_CHUNK_BYTES),
      readId:uuid('Original process-local retained read UUID.')},
    ['exportId','file','expectedManifestSha256','expectedSha256']),
  t('file_release','Release this original retained-file read descriptor.',
    {exportId:hash('Merchant retained-file export SHA256.'),readId:uuid('Original process-local read UUID.')},
    ['exportId','readId'],{mutates:true}),
  t('json','Inspect an RFC6901-selected value from the full retained JSON file. The complete original file remains downloadable.',
    {exportId:hash('Merchant retained-file export SHA256.'),expectedManifestSha256:hash('Original full manifest SHA256.'),
      file:string('Exact retained JSON filename.',{minLength:1,maxLength:240}),pointer:string('RFC6901 pointer.',{maxLength:4000}),
      offset:integer('Original selected-array/object/string offset.'),limit:integer('Selected entries or characters per page.',1,1000)},
    ['exportId','expectedManifestSha256','file']),
];
export const fhirActions=Object.fromEntries(fhirMerchantTools.map(tool=>[tool.name.slice(TOOL_PREFIX.length),tool]));
function validate(value,schema,path){
  if(schema.enum)need(schema.enum.includes(value),'FHIR_BULK_INPUT_INVALID',path+' must use a declared value.');
  if(schema.type==='object'){
    need(plain(value),'FHIR_BULK_INPUT_INVALID',path+' must be an object.');
    need((schema.required??[]).every(key=>Object.hasOwn(value,key)) &&
      (schema.maxProperties===undefined || Object.keys(value).length<=schema.maxProperties),'FHIR_BULK_INPUT_INVALID',path+' is incomplete.');
    for(const [key,item] of Object.entries(value)){
      const field=schema.properties?.[key];
      need(field || schema.additionalProperties!==false,'FHIR_BULK_INPUT_INVALID','Unknown field '+path+'.'+key+'.');
      if(field)validate(item,field,path+'.'+key);
      else if(plain(schema.additionalProperties))validate(item,schema.additionalProperties,path+'.'+key);
    }
  }else if(schema.type==='integer'){
    need(Number.isSafeInteger(value) && value>=(schema.minimum??-Infinity) && value<=(schema.maximum??Infinity),
      'FHIR_BULK_INPUT_INVALID',path+' must be an integer within its declared range.');
  }else if(schema.type==='string'){
    need(typeof value==='string' && (schema.minLength===undefined || value.length>=schema.minLength) &&
      (schema.maxLength===undefined || value.length<=schema.maxLength) && (!schema.pattern || new RegExp(schema.pattern).test(value)),
      'FHIR_BULK_INPUT_INVALID',path+' must match its declared original string format.');
  }else if(schema.type==='boolean')need(typeof value==='boolean','FHIR_BULK_INPUT_INVALID');
}
export function validateFhirArguments(name,args={}){
  const action=name.startsWith(TOOL_PREFIX)?name.slice(TOOL_PREFIX.length):name,tool=fhirActions[action];
  need(tool,'FHIR_BULK_TOOL_UNKNOWN','Select a declared original FHIR operation.');
  validate(args,tool.inputSchema,action);return action;
}

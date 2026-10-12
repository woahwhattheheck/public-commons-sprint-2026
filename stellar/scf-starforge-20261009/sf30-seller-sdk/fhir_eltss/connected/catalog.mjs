// MIT. Metadata-only original eLTSS operation catalog. Native validators own clinical/source semantics.
import {TOOL_PREFIX,ALIAS,UUID,SHA,OPERATION_ID,RESOURCE_TYPE,MAX_RETAINED_CHUNK_BYTES,plain,need} from './contracts.mjs';
const string=(description,extra={})=>({type:'string',description,...extra});
const alias=string('Host-declared original workspace alias.',{pattern:ALIAS});
const hash=description=>string(description,{pattern:SHA});
const uuid=description=>string(description,{pattern:UUID});
const object=description=>({type:'object',description,additionalProperties:true});
const integer=(description,minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',description,minimum,maximum});
const sourceId=hash('Original retained source SHA256.');
const buildId=hash('Original native build SHA256.');
const operationId=string('Original saved acquisition operation token. Keep this ID across advance, pause, resume and recovery.',{pattern:OPERATION_ID});
const resourceType=string('Exact eLTSS resource type.',{pattern:RESOURCE_TYPE});
const paging={offset:integer('Original zero-based offset.'),limit:integer('Original page size.',1,250)};
const selected={workspace:alias};
function tool(action,description,properties={},required=[],{mutates=false,external=false,workspace=true}={}){
  return {name:TOOL_PREFIX+action,description,inputSchema:{type:'object',additionalProperties:false,
    properties:{...(workspace?selected:{}),...properties},required:[...(workspace?['workspace']:[]),...required]},
    annotations:{readOnlyHint:!mutates,destructiveHint:false,idempotentHint:!mutates,openWorldHint:external}};
}
const t=(...args)=>tool(...args);

const recordId=hash('Exact original resource recordId from the selected source graph.');
const fieldKey=string('Original published mapping field key.',{pattern:'^eltss-(00[1-9]|0[1-4][0-9]|05[0-6])$'});
const profiles=string('Original published profile ID.',{minLength:1,maxLength:160});
const record=(name,collection,key,description)=>t(name,description,{[key]:hash('Original '+collection+' content SHA256.')},[key]);
const save=(name,key,description)=>t(name,description,{[key]:object('Complete native '+key+' body. Read catalogue.schemas for its exact fields.')},[key],{mutates:true});
const input=string('Host-declared complete original input alias.',{pattern:ALIAS});
const inputFile={input,expectedSha256:hash('Selected complete original input SHA256.')};
export const nativeInputActions={
 connection_save:'connection',request_save:'request',edition_save:'edition',review_profile:'profile',
 review_save:'review',assessment_create:'assessment',decision_save:'decision',
 edition_comparison_create:'comparison',correction_preview:'correction',correction_apply:'apply',
 handoff_prepare:'handoff',receiving_save:'receiving',plan_save:'plan'
};
export const eltssMerchantTools=[
 t('workspaces','List configured eLTSS workspace aliases and complete original input identities.',{},[],{workspace:false}),
 t('schema','Read this complete callable eLTSS catalogue and retained-file contract.',{},[],{workspace:false}),
 t('operator_open','Borrow the original Applications operator, or start its normal native server when the host explicitly allows it.',{},[],{mutates:true}),
 t('operator_release','Release this connection; close only a native server started by this provider.',{},[],{mutates:true}),
 t('operator','Read the authenticated original operator identity.'),
 t('state','Retain complete native source, graph, review, correction and receiving state.'),
 t('catalogue','Read original eLTSS typed fields, source limits and available profiles.'),
 t('auth_profiles','Read configured authentication-profile metadata without credential values.'),
 record('connection','connection','connectionId','Read an original saved provider connection.'),
 save('connection_save','connection','Save the complete original provider connection.'),
 t('discover','Retain actual endpoint CapabilityStatement discovery.',{connectionId:hash('Original connection ID.')},['connectionId'],{mutates:true,external:true}),
 record('discovery','discovery','discoveryId','Read a complete retained endpoint discovery.'),
 record('request','request','requestId','Read the complete source-selected native request.'),
 save('request_save','request','Save the original Bundle, advertised CarePlan operation or REST graph request.'),
 t('request_advance','Advance this exact original saved request and acquisition operation; native code owns GETs, paging and Retry-After.',
   {requestId:hash('Original saved request ID.'),operationId},['requestId','operationId'],{mutates:true,external:true}),
 t('operation','Read the complete original acquisition operation after progress or interruption.',{operationId},['operationId']),
 t('operation_pause','Pause this original acquisition operation between native steps.',{operationId},['operationId'],{mutates:true}),
 t('operation_resume','Resume this original acquisition operation and retain its prior request and HTTP receipts.',{operationId},['operationId'],{mutates:true}),
 record('source','source','sourceId','Read the complete original source inventory.'),
 t('source_members','Read every original source member identity.',{sourceId},['sourceId']),
 t('source_rows','Page original resource identities and complete source observations.',
   {sourceId,resourceType,...paging,query:string('Original source search text.',{maxLength:1000})},['sourceId']),
 t('source_row','Read an exact original resource by its returned recordId.',{sourceId,recordId},['sourceId','recordId']),
 t('source_file','Retain a complete original source member as a downloadable file.',
   {sourceId,member:string('Exact member name from source_members.',{minLength:1,maxLength:1024})},['sourceId','member']),
 t('source_packet','Retain the complete original source file or source packet.',{sourceId},['sourceId']),
 t('source_import','Import a complete host-declared original source file.',
   {...inputFile,label:string('Original source label.',{minLength:1,maxLength:160})},['input'],{mutates:true}),
 t('graph_create','Retain an original reference graph with explicitly selected source policy and saved decisions.',
   {sourceId,policy:object('Native referencePolicy, baseUrl and decisionIds.')},['sourceId','policy'],{mutates:true}),
 record('graph','graph','graphId','Read the complete saved original graph selection and summary.'),
 t('graph_nodes','Page original nodes in the selected graph.',{graphId:hash('Original graph ID.'),resourceType,...paging,
   query:string('Original node search.',{maxLength:1000})},['graphId']),
 t('graph_edges','Page original resolved, ambiguous, logical, display or unresolved reference edges.',
   {graphId:hash('Original graph ID.'),status:string('Native edge status from the original graph summary.',{maxLength:80}),...paging,
    query:string('Original reference search.',{maxLength:1000})},['graphId']),
 t('graph_node','Read one original node with its actual incoming and outgoing reference edges.',
   {graphId:hash('Original graph ID.'),recordId},['graphId','recordId']),
 t('profile','Read all original published field definitions, locators and explicit selector drafts.',{profileId:profiles},['profileId']),
 record('edition','edition','editionId','Read a complete selected original CarePlan edition.'),
 save('edition_save','edition','Save the explicit source/CarePlan graph selection and optional predecessor.'),
 save('review_profile','profile','Adopt all56 original field selector drafts into one complete native review set.'),
 save('review_save','review','Save the complete56-field review, applicability, absence policy, selectors and conversions.'),
 record('review_set','field-review set','reviewSetId','Read the full original56-field saved review and source profile.'),
 save('assessment_create','assessment','Observe every original field value for the exact selected edition and review set.'),
 record('assessment','assessment','assessmentId','Read the complete frozen native assessment and original byte descriptor.'),
 t('assessment_cells','Page original field cells without losing their full retained file.',
   {assessmentId:hash('Original assessment ID.'),carePlanId:recordId,fieldKey,
    status:string('Original assessment cell state.',{enum:['present','absent','unresolved','not_applicable','review_pending']}),...paging},['assessmentId']),
 t('assessment_file','Retain every complete field cell and original lexical value as JSONL.',
   {assessmentId:hash('Original assessment ID.')},['assessmentId']),
 record('decision','decision','decisionId','Read a complete scoped original operator decision.'),
 save('decision_save','decision','Save a scoped source/reference/field/careplan/receiving decision and explicit successor.'),
 save('edition_comparison_create','comparison','Compare the exact original resource identities in two retained editions.'),
 record('edition_comparison','edition comparison','comparisonId','Read the saved original edition comparison.'),
 t('edition_changes','Page exact original resource changes.',{comparisonId:hash('Original edition comparison ID.'),...paging},['comparisonId']),
 t('edition_changes_file','Retain every original edition change and exact before/after value.',
   {comparisonId:hash('Original edition comparison ID.')},['comparisonId']),
 save('correction_preview','correction','Preview exact authored patches against retained original resource paths.'),
 save('correction_apply','apply','Apply only the original previewId and expectedRequestSha256; retain the unchanged source predecessor.'),
 save('handoff_prepare','handoff','Freeze the selected CarePlans, graph, all field observations, decisions and complete original sources.'),
 record('handoff','handoff','handoffId','Read a complete native human/editable handoff and exact member identities.'),
 t('handoff_packet','Retain the complete original selected handoff ZIP.',{handoffId:hash('Original handoff ID.')},['handoffId']),
 t('handoff_import','Receive a complete host-declared original handoff through native editable intake.',inputFile,['input'],{mutates:true}),
 t('artifact_import','Retain an exact complete downstream receiving artifact.',
   {...inputFile,label:string('Original artifact label.',{minLength:1,maxLength:160}),
    contentType:string('Original content type.',{minLength:1,maxLength:256})},['input'],{mutates:true}),
 t('artifact_file','Retain the exact original downstream result file.',{artifactId:hash('Original artifact ID.')},['artifactId']),
 record('receiving','receiving','receivingId','Read a complete original destination/result receiving record.'),
 save('receiving_save','receiving','Save the original receiving UUID, actual destination/result, time and correction predecessor.'),
 t('mapping_default','Derive the original native mapping from the selected source resource type.',
   {sourceId,resourceType,name:string('Mapping name.',{minLength:1,maxLength:160})},['sourceId','resourceType'],{mutates:true}),
 t('mapping_preview','Preview the complete saved or authored native mapping.',
   {sourceId,plan:object('Complete native eLTSS mapping.'),limit:integer('Preview page size.',1,250)},['sourceId','plan'],{mutates:true}),
 record('plan','mapping plan','planId','Read the original plan wrapper {id,plan}.'),
 save('plan_save','plan','Save the complete original native mapping plan.'),
 record('build','build','buildId','Read the original complete native dataset build.'),
 t('build_create','Build the native SF30 dataset from exact saved source and mapping IDs.',
   {sourceId,planId:hash('Original mapping ID.')},['sourceId','planId'],{mutates:true}),
 t('build_query','Run the original SF30 query against one exact completed build.',
   {buildId,query:{type:'object',description:'Original scalar-string query parameters, including its original cursor.',
     additionalProperties:{type:'string',maxLength:8192},maxProperties:40}},['buildId']),
 t('build_dataset','Retain the complete native CSV, configuration and lineage ZIP.',{buildId},['buildId']),
 t('build_packet','Retain the complete original source/mapping/dataset receiving packet.',{buildId},['buildId']),
 t('comparison_create','Compare two original same-mapping dataset builds.',
   {beforeId:buildId,afterId:buildId},['beforeId','afterId'],{mutates:true}),
 t('comparison_changes','Page original dataset edition changes.',
   {comparisonId:hash('Original native dataset comparison ID.'),...paging},['comparisonId']),
 t('comparison_file','Retain the complete original native dataset change file.',
   {comparisonId:hash('Original native dataset comparison ID.')},['comparisonId']),
 t('workspace_packet','Retain the entire editable native workspace, original operations and byte custody.'),
 t('workspace_import','Receive the complete host-declared workspace and reconcile its original UUID.',inputFile,['input'],{mutates:true}),
 t('packet_import','Receive the complete host-declared original dataset packet.',inputFile,['input'],{mutates:true}),
 t('input_apply','Apply one complete host-declared native JSON request. This supports full4MiB field reviews through a small MCP envelope.',
   {...inputFile,action:string('Explicit native body action.',{enum:Object.keys(nativeInputActions)})},
   ['input','action'],{mutates:true}),
 t('receive_export','Receive one complete retained original source, dataset, handoff, artifact or workspace into another configured workspace.',
   {sourceWorkspace:alias,exportId:hash('Complete retained-file export ID.'),expectedManifestSha256:hash('Original manifest SHA256.'),
    kind:string('Exact native receiving route.',{enum:['source','packet','handoff','artifact','workspace']}),
    label:string('Original receiving label.',{minLength:1,maxLength:160})},
   ['sourceWorkspace','exportId','expectedManifestSha256','kind'],{mutates:true}),
 t('manifest','Read the exact retained-file export manifest.',{exportId:hash('Original retained export ID.')},['exportId']),
 t('file','Read a complete-file byte range using original manifest/content identities.',
   {exportId:hash('Original retained export ID.'),file:string('Original manifest filename.',{minLength:1,maxLength:240}),
    expectedManifestSha256:hash('Exact original manifest SHA256.'),expectedSha256:hash('Exact original file SHA256.'),
    offset:integer('Original byte offset.'),limit:integer('Complete range byte count.',1,MAX_RETAINED_CHUNK_BYTES),
    readId:uuid('Original retained read UUID.')},['exportId','file','expectedManifestSha256','expectedSha256']),
 t('file_release','Release this original retained-file reader.',
   {exportId:hash('Original retained export ID.'),readId:uuid('Original retained read UUID.')},['exportId','readId'],{mutates:true}),
 t('json','Inspect an exact RFC6901 value from the complete retained response; full originals remain downloadable.',
   {exportId:hash('Original retained export ID.'),expectedManifestSha256:hash('Original manifest SHA256.'),
    file:string('Exact retained JSON filename.',{minLength:1,maxLength:240}),pointer:string('RFC6901 pointer.',{maxLength:4000}),
    offset:integer('Original selected-value offset.'),limit:integer('Selected entries or characters.',1,1000)},
   ['exportId','expectedManifestSha256','file'])
];
export const eltssActions=Object.fromEntries(eltssMerchantTools.map(tool=>[tool.name.slice(TOOL_PREFIX.length),tool]));
function validate(value,schema,path){
  if(schema.enum)need(schema.enum.includes(value),'ELTSS_INPUT_INVALID',path+' must use a declared value.');
  if(schema.type==='object'){
    need(plain(value),'ELTSS_INPUT_INVALID',path+' must be an object.');
    need((schema.required??[]).every(key=>Object.hasOwn(value,key)) &&
      (schema.maxProperties===undefined || Object.keys(value).length<=schema.maxProperties),'ELTSS_INPUT_INVALID',path+' is incomplete.');
    for(const [key,item] of Object.entries(value)){
      const field=schema.properties?.[key];
      need(field || schema.additionalProperties!==false,'ELTSS_INPUT_INVALID','Unknown field '+path+'.'+key+'.');
      if(field)validate(item,field,path+'.'+key);
      else if(plain(schema.additionalProperties))validate(item,schema.additionalProperties,path+'.'+key);
    }
  }else if(schema.type==='integer'){
    need(Number.isSafeInteger(value) && value>=(schema.minimum??-Infinity) && value<=(schema.maximum??Infinity),
      'ELTSS_INPUT_INVALID',path+' must be an integer within its declared range.');
  }else if(schema.type==='string'){
    need(typeof value==='string' && (schema.minLength===undefined || value.length>=schema.minLength) &&
      (schema.maxLength===undefined || value.length<=schema.maxLength) && (!schema.pattern || new RegExp(schema.pattern).test(value)),
      'ELTSS_INPUT_INVALID',path+' must match its declared original string format.');
  }else if(schema.type==='boolean')need(typeof value==='boolean','ELTSS_INPUT_INVALID');
}
export function validateEltssArguments(name,args={}){
  const action=name.startsWith(TOOL_PREFIX)?name.slice(TOOL_PREFIX.length):name,tool=eltssActions[action];
  need(tool,'ELTSS_TOOL_UNKNOWN','Select a declared original eLTSS operation.');
  validate(args,tool.inputSchema,action);return action;
}

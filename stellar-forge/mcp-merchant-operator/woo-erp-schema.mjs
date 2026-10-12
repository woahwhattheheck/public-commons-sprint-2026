// MIT. Complete original Woo ERP operations for merchant MCP and installed clients.
export const ERP_TOOL_PREFIX = 'merchant_woo_erp_';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const order={type:'string',pattern:'^[1-9][0-9]{0,17}$'};
const revision={type:'integer',minimum:1};
const reason={type:'string',minLength:1,maxLength:2000};
const expectedMap={type:'string',pattern:'^([a-f0-9]{64})?$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};
const pointer={type:'string',maxLength:2048,pattern:'^(?:|/.*)$'};
const pages={pointer,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:65536},expectedSnapshotSha256:hash};
const base={store:alias};
const operation={...base,operationId:hash};
const change={...operation,expectedRevision:revision};
const selection={...base,kind:{type:'string',enum:['mapping','project']},id:hash,exportId:alias};
const read={readOnly:true,idempotent:true};
const live={...read,openWorld:true};
const entries=[
 ['inputs','List host-declared ERP mapping/project inputs and their labels for this original Woo store. No credentials or source file contents are read.',base,['store'],read],
 ['input','Inspect a declared mapping or complete native project by exact file hash. Read every original JSON value with pointer and paged children; long strings use UTF-16 offsets. Repeat expectedSnapshotSha256 after the first page.',{...base,input:alias,...pages},['store','input'],read],
 ['status','Read the installed ERP journal, approved connection readiness and mapping selection. Mapping history is paged by its snapshot hash; full selected mappings use mapping.',{...base,offset:pages.offset,limit:{type:'integer',minimum:1,maximum:100},expectedSnapshotSha256:hash},['store'],live],
 ['mapping','Read a retained native mapping and contract-check history. Expand exact original JSON pointers and page every binding without truncating its source.',{...base,mapId:hash,...pages},['store','mapId'],live],
 ['mapping_save','Save the complete declared mapping input using its inspected SHA256 and the currently selected native map ID. An empty expectedCurrentMapId selects an initial mapping. The original PHP compiler validates all bindings and connection rules.',{...base,input:alias,expectedSha256:hash,expectedCurrentMapId:expectedMap},['store','input','expectedSha256','expectedCurrentMapId'],{openWorld:true}],
 ['mapping_select','Select an existing immutable native mapping through the original save/selection guard. Read the current map selection first.',{...base,mapId:hash,expectedCurrentMapId:expectedMap},['store','mapId','expectedCurrentMapId'],{openWorld:true}],
 ['mapping_check','Read the installed Acumatica contract and retain its original check on the selected mapping. Uses the approved server-side connection.',{...base,mapId:hash},['store','mapId'],{openWorld:true}],
 ['orders','Read one native indexed ERP queue page. Original state/search filters, totals and page count come from the existing WordPress journal.',{...base,q:{type:'string',maxLength:100},state:{type:'string',pattern:'^[A-Z_]{0,32}$'},page:{type:'integer',minimum:1,maximum:1000000},limit:{type:'integer',minimum:1,maximum:100}},['store'],live],
 ['inspect','Read the original ERP order, current source/target status, retained revision and exact journal snapshot. Returned pointers lead to the complete edition, request, receiving and decision history.',operation,['store','operationId'],live],
 ['read','Read the complete original order journal by JSON pointer and snapshot-pinned pages. Page arrays/objects with at most100 children; strings use at most65536 UTF-16 units. Larger child values retain pointers for exact expansion.',{...operation,...pages},['store','operationId'],live],
 ['prepare','Prepare or reselect one original Woo source edition with the selected immutable map and current journal revision. Use revision0 only for a new original order.',{...base,orderId:order,mapId:hash,expectedRevision:{type:'integer',minimum:0}},['store','orderId','expectedRevision'],{openWorld:true}],
 ['approve','Approve the exact current source edition and journal revision with an operating reason. Corrections select the reviewed native target baseline. The original engine rereads Woo source and the installed ERP contract.',{...change,editionId:hash,reason,targetBaselineSha256:hash},['store','operationId','expectedRevision','editionId','reason'],{openWorld:true}],
 ['deliver','Deliver the already approved exact edition through its original Woo order lock and ERP request journal. The engine resolves existing target identity before a PUT and records actual receiving. After an interrupted reply inspect/reconcile this same operation.',{...change,editionId:hash},['store','operationId','expectedRevision','editionId'],{openWorld:true}],
 ['reconcile','Read the original ERP target and resolve its pending attempt through the native receiving comparison. The original engine records this observation without issuing another ERP PUT.',change,['store','operationId','expectedRevision'],{openWorld:true}],
 ['identify_target','Identify the exact observed native target for a reviewed original-line correction. A pending write also requires its checked completed processing and provider outcome. Financial acceptance remains the original receiving comparison.',{...change,targetBaselineSha256:hash,reason,confirmOperationEnded:{type:'boolean',enum:[true]},providerOutcome:reason},['store','operationId','expectedRevision','targetBaselineSha256','reason'],{openWorld:true}],
 ['authorize_retry','Record the checked completed ERP operation and confirmed absence of a received order on the original journal. The native engine searches again and clears approval; another delivery still uses a current-edition approval.',{...change,confirmOperationEnded:{type:'boolean',enum:[true]},confirmNoOrder:{type:'boolean',enum:[true]},reason,providerOutcome:reason},['store','operationId','expectedRevision','confirmOperationEnded','confirmNoOrder','reason','providerOutcome'],{openWorld:true}],
 ['bind_import','Bind the imported complete project back to the original Woo order identity and installed ERP contract with its current revision and operating reason.',{...change,reason},['store','operationId','expectedRevision','reason'],{openWorld:true}],
 ['export','Retain the complete native project or original mapping under a stable export ID. Project exports require the exact inspected journal revision. A repeated export ID reopens its original bytes across merchant/MCP restart.',{...selection,expectedRevision:revision},['store','kind','id','exportId'],{idempotent:true,openWorld:true}],
 ['export_manifest','Inspect the original completed export and verify its retained file. Returns its complete manifest and SHA256 for receiving the same bytes.',selection,['store','kind','id','exportId'],read],
 ['export_file','Read original project/mapping/manifest bytes in verified resumable chunks. Repeat the manifest SHA, file SHA and offset after interruption; an expired read can reopen the same file with its original digest.',{...selection,file:{type:'string',enum:['manifest.json','project.json','mapping.json']},expectedManifestSha256:hash,expectedSha256:hash,readId:uuid,offset:pages.offset,limit:{type:'integer',minimum:1,maximum:196608}},['store','kind','id','exportId','file','expectedManifestSha256'],read],
 ['export_file_release','Release a temporary verified read snapshot belonging to this store and ERP export. Complete original exports remain retained.',{...selection,readId:uuid},['store','kind','id','exportId','readId'],read],
 ['import','Receive a host-declared complete original ERP project with its inspected file hash. Native project validation preserves original mapping/source/request/response/decision lineage and rejects a divergent existing journal.',{...base,input:alias,expectedSha256:hash},['store','input','expectedSha256'],{openWorld:true}],
 ['import_export','Receive a complete native project from an exact retained source-store export into the selected store. The original Woo engine validates its history and original order binding; follow with mapping selection, bind_import and reconciliation.',{...base,fromStore:alias,id:hash,exportId:alias,expectedManifestSha256:hash},['store','fromStore','id','exportId','expectedManifestSha256'],{openWorld:true}],
];
export const wooErpToolDefinitions=Object.freeze(entries.map(([suffix,description,properties,required,annotations])=>Object.freeze({
 name:ERP_TOOL_PREFIX+suffix,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations
})));
const byName=new Map(wooErpToolDefinitions.map(item=>[item.name,item]));
export const wooErpClientOperations=Object.freeze(Object.fromEntries(entries.map(([name])=>[name.replaceAll('_','-'),ERP_TOOL_PREFIX+name])));
export function wooErpTools(tool){return wooErpToolDefinitions.map(({name,description,inputSchema,annotations})=>tool(name,description,inputSchema.properties,inputSchema.required,annotations));}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function matches(schema,value){
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(schema.type==='object')return plain(value)&&(schema.required??[]).every(key=>Object.hasOwn(value,key))&&Object.entries(value).every(([key,item])=>Object.hasOwn(schema.properties,key)&&matches(schema.properties[key],item));
 if(schema.type==='integer')return Number.isSafeInteger(value)&&value>=(schema.minimum??0)&&value<=(schema.maximum??Number.MAX_SAFE_INTEGER);
 if(typeof value!==schema.type)return false;
 return schema.type!=='string'||value.length>=(schema.minLength??0)&&value.length<=(schema.maxLength??Number.MAX_SAFE_INTEGER)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
}
export function validateWooErpArguments(name,args){
 const schema=byName.get(name)?.inputSchema;
 if(!schema||!matches(schema,args))throw Object.assign(new Error('Use the published Woo ERP tool fields, original IDs and exact revisions.'),{code:'WOO_ERP_INPUT_INVALID'});
 if(name===ERP_TOOL_PREFIX+'export'&&((args.kind==='project')!==(args.expectedRevision!==undefined)))
  throw Object.assign(new Error('Project export requires the original journal revision; mapping export uses its immutable map ID.'),{code:'WOO_ERP_INPUT_INVALID'});
 if(name===ERP_TOOL_PREFIX+'identify_target'&&((args.confirmOperationEnded===true)!==(args.providerOutcome!==undefined)))
  throw Object.assign(new Error('Name the checked provider outcome together with confirmation that its original operation ended.'),{code:'WOO_ERP_INPUT_INVALID'});
 return args;
}

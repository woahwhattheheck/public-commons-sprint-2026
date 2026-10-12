// MIT. Installed merchant declarations for complete GIS handoff operations.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
import { DISPATCH_FIELDS } from './domain.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},id={type:'string',minLength:1,maxLength:200},hash={type:'string',pattern:'^[a-f0-9]{64}$'},revision={type:'integer',minimum:0};
const string=(maxLength=500)=>({type:'string',maxLength});
const array=items=>({type:'array',items,maxItems:1000,uniqueItems:true});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const workspace={workspace:alias},mutation={...workspace,requestId:id,expectedRevision:revision},paging={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const read={readOnly:true,idempotent:true},change={idempotent:true};
const operator=object({assignedTeam:string(),assetId:string(),workOrderId:string(),priority:string(),action:{type:'string',enum:['review','dispatch','defer','dismiss']},dueDate:{type:'string',pattern:'^(?:[0-9]{4}-[0-9]{2}-[0-9]{2})?$'},note:string(20000)});
const handoffDefinition=object({name:{type:'string',minLength:1,maxLength:200},sourceIds:array(id),predecessorId:id,
  filters:object({q:string(2000),statuses:array({type:['string','null']}),serviceCodes:array({type:['string','null']}),geometry:{type:'string',enum:['any','located','unlocated']}}),defaults:operator},['name','sourceIds']);
const decision=object({returnId:id,handoffId:id,reviewer:{type:'string',minLength:1,maxLength:200},note:string(20000),accept:array(id),reject:array(id)},['returnId','handoffId','reviewer']);
const dispatch=object({name:{type:'string',minLength:1,maxLength:200},handoffId:id,destination:{type:'string',minLength:1,maxLength:500},note:string(20000),keys:array(id),
  columns:{type:'array',maxItems:100,items:object({name:{type:'string',minLength:1,maxLength:100},field:{type:'string',enum:DISPATCH_FIELDS}},['name','field'])}},['name','handoffId','destination']);
export const gisFileSelection={kind:{type:'string',enum:['workspace','json','geojson','csv','gpkg','html','source','returned','operation']},
  handoffId:id,dispatchId:id,sourceId:id,returnId:id,operationId:id,expectedRevision:revision};
export function gisWorkspaceTools(tool){
  return [
    tool('merchant_open311_gis_workspaces','List the host-selected GIS desks and complete original source, analyst-return and receiving input aliases.',{},[],read),
    tool('merchant_open311_gis_status','Read the selected GIS workspace identity, revision, saved entity counts and original retained-file status.',workspace,['workspace'],read),
    tool('merchant_open311_gis_records','Page source editions, handoff editions, analyst returns, review decisions or dispatch summaries at one observed workspace revision. Follow nextOffset.',{
      ...workspace,kind:{type:'string',enum:['sources','handoffs','returns','decisions','dispatches']},expectedRevision:revision,...paging
    },['workspace','kind','expectedRevision'],read),
    tool('merchant_open311_gis_input','Inspect the complete host-selected input file identity, format, purpose, size and original SHA-256.',{...workspace,input:alias},['workspace','input'],read),
    tool('merchant_open311_gis_inspect_source','Inspect a complete original collection or report source before importing it. A reporting package with several reports returns its original report choices.',{
      ...workspace,input:alias,reportId:id,expectedSha256:hash
    },['workspace','input'],read),
    tool('merchant_open311_gis_import_source','Import an exact host-selected collection or report package, preserving original source bytes, coverage, attribution, source versions and literal coordinates.',{
      ...mutation,input:alias,expectedSha256:hash,reportId:id,name:string(200)
    },['workspace','input','expectedSha256','requestId','expectedRevision'],change),
    tool('merchant_open311_gis_handoff_create','Save a complete named GIS handoff from selected source editions, filters and analyst defaults. Refresh a current predecessor to preserve unchanged-source edits and expose changed originals.',{
      ...mutation,definition:handoffDefinition
    },['workspace','definition','requestId','expectedRevision'],change),
    tool('merchant_open311_gis_source_rows','Search and page complete imported request rows, literal source status and source geometry. The selected source file is downloadable in full.',{
      ...workspace,id,expectedRevision:revision,q:string(2000),...paging
    },['workspace','id','expectedRevision'],read),
    tool('merchant_open311_gis_handoff_info','Inspect a saved handoff definition, original coverage and paged operating rows at one revision. Every point retains its original source version and separate analyst fields.',{
      ...workspace,id,expectedRevision:revision,q:string(2000),...paging
    },['workspace','id','expectedRevision'],read),
    tool('merchant_open311_gis_row','Inspect one complete handoff request, original observation versions, analyst geometry, assignment and last accepted decision.',{
      ...workspace,handoffId:id,key:id,expectedRevision:revision
    },['workspace','handoffId','key','expectedRevision'],read),
    tool('merchant_open311_gis_return_import','Retain an exact host-selected edited GeoPackage, GeoJSON, CSV or JSON against its original handoff edition. Source changes, missing records and invalid geometry remain visible review results.',{
      ...mutation,input:alias,expectedSha256:hash,handoffId:id,analyst:{type:'string',minLength:1,maxLength:200},name:string(200)
    },['workspace','input','expectedSha256','handoffId','analyst','requestId','expectedRevision'],change),
    tool('merchant_open311_gis_return_info','Page analyst proposals, source/geometry conflicts, missing keys or saved decisions from one original returned file. Download returned for its complete unchanged bytes.',{
      ...workspace,id,expectedRevision:revision,section:{type:'string',enum:['changes','conflicts','missingKeys','decisions']},...paging
    },['workspace','id','expectedRevision'],read),
    tool('merchant_open311_gis_decision_save','Accept or reject selected proposals against the explicit current handoff. Accepted edits preserve exact source hashes; competing source or analyst changes produce concrete conflicts. Save a new immutable handoff edition.',{
      ...mutation,selection:decision
    },['workspace','selection','requestId','expectedRevision'],change),
    tool('merchant_open311_gis_dispatch_create','Save a named dispatch file edition from reviewed action=dispatch rows. Map supported fields to the receiving system columns while retaining source and handoff identity columns.',{
      ...mutation,definition:dispatch
    },['workspace','definition','requestId','expectedRevision'],change),
    tool('merchant_open311_gis_dispatch_info','Inspect the original destination, column map, source coverage, accepted decisions and paged dispatch rows.',{
      ...workspace,id,expectedRevision:revision,...paging
    },['workspace','id','expectedRevision'],read),
    tool('merchant_open311_gis_operation','Recover the saved result of the original GIS request ID. Large original input bodies are represented by file manifests and remain available in the complete operation download.',{
      ...workspace,requestId:id
    },['workspace','requestId'],read),
    tool('merchant_open311_gis_receive','Receive a complete host-selected GIS workspace into an empty selected desk, including original source files, analyst uploads, decisions, dispatches and exact operation history.',{
      ...mutation,input:alias,expectedSha256:hash
    },['workspace','input','expectedSha256','requestId','expectedRevision'],change),
    tool('merchant_open311_gis_file_read','Read complete original source/returned files, analyst or reviewed dispatch GeoPackage/GeoJSON/CSV/JSON/HTML, original operations or editable whole-workspace packages through the maintained retained reader. Preserve selection, readId, expectedSha256 and offset.',{
      ...workspace,...gisFileSelection,readId:{type:'string',minLength:1,maxLength:128},expectedSha256:hash,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}
    },['workspace','kind','expectedRevision'],read),
    tool('merchant_open311_gis_file_release','Release the selected retained GIS file reader after explicit cancellation or completed delivery.',{...workspace,readId:{type:'string',minLength:1,maxLength:128}},['workspace','readId'],change)
  ];
}

// MIT. Complete municipal crew, return, supervisor and destination workflows in the maintained merchant catalog.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},id={type:'string',minLength:1,maxLength:500},hash={type:'string',pattern:'^[a-f0-9]{64}$'},revision={type:'integer',minimum:0};
const string=(maxLength=100000)=>({type:'string',maxLength}),nullable=maxLength=>({type:['string','null'],maxLength});
const enumeration=values=>({type:'string',enum:values});
const array=(items,maxItems=1000)=>({type:'array',items,maxItems,uniqueItems:true});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const timestamp=nullable(100),fieldStatus=enumeration(['planned','assigned','in_progress','completed','unable','cancelled']);
const decimal={type:'string',pattern:'^(?:0|[1-9][0-9]{0,17})(?:\\.[0-9]{1,9})?$'};
const resource=object({id,kind:enumeration(['labor','material','equipment','other']),name:string(500),quantity:decimal,unit:string(100),
  unitCost:{...decimal,type:['string','null']},currency:{type:['string','null'],pattern:'^[A-Z]{3}$'},note:string()},['id','kind','name','quantity','unit','unitCost','currency','note']);
const note=object({id,author:string(300),text:string(),recordedAt:{type:'string',maxLength:100}},['id','author','text','recordedAt']);
const field=object({status:fieldStatus,actualStart:timestamp,actualEnd:timestamp,completionNote:string(),notes:array(note),resources:array(resource),attachmentIds:array(id)});
const crew=object({id,name:string(300),members:array(object({id,name:string(300),role:string(300),contact:string(1000)},['name'])),note:string(),active:{type:'boolean'}},['name']);
const visit=object({id,sourceId:id,sourceKey:id,crewId:nullable(500),title:string(1000),plannedStart:timestamp,plannedEnd:timestamp,dueAt:timestamp,
  priority:enumeration(['low','normal','high','urgent']),instructions:string(),field},['sourceId','sourceKey']);
const proposalDecision=object({proposalId:id,choice:enumeration(['accept','reject']),expectedVisitVersionId:id,
  fieldChoices:array(object({changeId:id,choice:enumeration(['returned','current'])},['changeId','choice'])),
  acknowledgeSourceChange:{type:'boolean'},acknowledgeAssignmentChange:{type:'boolean'},note:string()},['proposalId','choice','expectedVisitVersionId']);
const review=object({visitId:id,expectedVersionId:id,outcome:enumeration(['approve','return_to_crew']),note:string()},['visitId','expectedVersionId','outcome']);
const updateItem=object({visitId:id,expectedVersionId:id,action:enumeration(['update','request_closure']),destinationReference:string(2000),note:string()},['visitId','expectedVersionId','action']);
const destination=object({name:string(300),system:string(300),reference:string(2000)},['name','system']);
const workspace={workspace:alias},view={...workspace,expectedRevision:revision},mutation={...view,requestId:id};
const paging={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},search={q:string(2000)};
const host={input:alias,expectedSha256:hash},read={readOnly:true,idempotent:true},change={idempotent:true};
export const fieldDeskFileSelection={
  kind:enumeration(['workspace','source','crew-json','crew-html','returned','visits-csv','update-json','update-csv','update-geojson','update-report','attachment','operation']),
  sourceId:id,packageId:id,returnId:id,updateId:id,attachmentId:id,operationId:id,crewId:id,status:fieldStatus,q:string(2000),expectedRevision:revision
};
export function fieldDeskWorkspaceTools(tool){
  const make=(name,description,properties,required,annotations=read)=>tool('merchant_open311_field_desk_'+name,description,properties,required,annotations);
  return [
    make('workspaces','List host-selected field desks and their original input aliases, purposes and complete file hashes.',{},[]),
    make('status','Read the selected desk identity, revision, crew/visit/return/update counts, recent operation summaries and retained reader state.',workspace,['workspace']),
    make('records','Page original sources, current crews, issued crew packages, imported returns or destination updates at one observed revision.',{...view,kind:enumeration(['sources','crews','packages','returns','updates']),...search,...paging},['workspace','kind','expectedRevision']),
    make('input','Inspect the complete named host file and its unchanged bytes, format, declared purpose and SHA-256.',{...workspace,input:alias},['workspace','input']),
    make('inspect_source','Inspect complete approved dispatch or Follow-through workspace files and choose an actual dispatch when a workspace contains several.',{...workspace,...host,dispatchId:id},['workspace','input']),
    make('import_source','Retain the complete original approved dispatch or workspace with its selected dispatch, source requests/orders and original relationship approvals.',{...mutation,...host,name:string(300),dispatchId:id},['workspace','input','expectedSha256','name','requestId','expectedRevision'],change),
    make('source','Inspect one retained source and its original dispatch definition, totals and source coverage. Page original rows with source_rows or download the full original file.',{...view,id},['workspace','id','expectedRevision']),
    make('source_rows','Search and page complete original dispatch rows, approved work, municipal requests, orders and original geometry.',{...view,sourceId:id,...search,...paging},['workspace','sourceId','expectedRevision']),
    make('crew_save','Create a named crew or save its next version with members, contact details, notes and availability.',{...mutation,crew},['workspace','crew','requestId','expectedRevision'],change),
    make('crew','Inspect a named crew and page its complete saved membership history.',{...view,id,...paging},['workspace','id','expectedRevision']),
    make('visit_save','Create or revise a source-linked visit with a named crew, scheduling, explicit field status, original attachments and exact decimal resource quantities.',{...mutation,visit},['workspace','visit','requestId','expectedRevision'],change),
    make('visits','Search and page current visits by original source, crew and field status while preserving supervisor approval and changed-source indicators.',{...view,sourceId:id,crewId:id,status:fieldStatus,...search,...paging},['workspace','expectedRevision']),
    make('visit','Inspect one complete visit, its original dispatch row, crew, source changes and current approval; page saved visit history or attachment metadata.',{...view,id,section:enumeration(['history','attachments']),...paging},['workspace','id','expectedRevision']),
    make('attachment_save','Retain one complete host-selected original attachment by byte hash and declared media type. Repeated identical bytes keep their original identity.',{...mutation,...host,filename:string(500)},['workspace','input','expectedSha256','requestId','expectedRevision'],change),
    make('package_create','Issue an immutable complete crew package for the explicitly selected visit versions, including original source context and selected attachments.',{...mutation,name:string(300),visitIds:array(id),note:string()},['workspace','name','visitIds','requestId','expectedRevision'],change),
    make('package','Inspect an issued package and page its original visit editions or attachment metadata. Download crew-json or self-contained crew-html for the complete working package.',{...view,id,section:enumeration(['visits','attachments']),...paging},['workspace','id','expectedRevision']),
    make('return_import','Retain one complete original field return from a host file, including partial visit proposals and original attachment bytes.',{...mutation,...host,name:string(300)},['workspace','input','expectedSha256','requestId','expectedRevision'],change),
    make('return','Inspect an original field return and page its current proposed changes or saved supervisor decisions with exact conflicts and source/assignment changes.',{...view,id,section:enumeration(['proposals','decisions']),...paging},['workspace','id','expectedRevision']),
    make('decisions_apply','Accept or reject explicitly selected field proposals with their current visit preimages, named reviewer and per-field choices for overlaps.',{...mutation,returnId:id,reviewer:string(300),note:string(),decisions:array(proposalDecision)},['workspace','returnId','reviewer','decisions','requestId','expectedRevision'],change),
    make('visits_review','Approve selected exact visit versions or return them to their crew, preserving named supervisor and original source context.',{...mutation,reviewer:string(300),note:string(),selections:array(review)},['workspace','reviewer','selections','requestId','expectedRevision'],change),
    make('update_create','Save an explicit destination-system update package from current approved visit versions. Select update or request_closure per visit and retain original field notes, resources and attachments.',{...mutation,name:string(300),reviewer:string(300),destination,note:string(),items:array(updateItem)},['workspace','name','reviewer','destination','items','requestId','expectedRevision'],change),
    make('update','Inspect one reviewed destination package and page complete selected items or original attachment metadata.',{...view,id,section:enumeration(['items','attachments']),...paging},['workspace','id','expectedRevision']),
    make('operation','Recover the original request result and compact original-input identity. Large original input remains available through operation file download.',{...workspace,requestId:id},['workspace','requestId']),
    make('receive','Receive a complete editable field desk into an empty selected workspace, preserving original dispatches, visit versions, files, partial decisions and operation recovery.',{...mutation,...host},['workspace','input','expectedSha256','requestId','expectedRevision'],change),
    make('file_read','Download complete crew HTML/JSON, original attachments, sources/returns, destination JSON/CSV/GeoJSON/print report or whole editable workspaces with stable revision, selection, hash and byte offset.',{...workspace,...fieldDeskFileSelection,readId:{type:'string',minLength:1,maxLength:128},expectedSha256:hash,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','kind','expectedRevision']),
    make('file_release','Release the selected retained file reader after delivery or cancellation.',{...workspace,readId:{type:'string',minLength:1,maxLength:128}},['workspace','readId'],change)
  ];
}

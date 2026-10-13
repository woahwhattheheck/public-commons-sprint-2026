// MIT. Complete source mapping, routing, communication and implementation handover through the maintained merchant catalog.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},id={type:'string',minLength:1,maxLength:500},hash={type:'string',pattern:'^[a-f0-9]{64}$'},revision={type:'integer',minimum:0};
const string=(maxLength=100000)=>({type:'string',maxLength}),enumeration=values=>({type:'string',enum:values});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const optionalVersion={type:['string','null'],maxLength:500};
const profile=object({id,definition:{type:'object',additionalProperties:true}},['definition']);
const rowSelection=object({rowsPointer:string(8192)},['rowsPointer']);
const mapping=object({sourceProfileId:id},['sourceProfileId']);
const override={type:'object',properties:{sourceKey:id,reason:string()},required:['sourceKey','reason'],additionalProperties:true};
const baselineObject=object({profileId:id,profileVersionId:id,declaredBy:string(300),note:string()},['profileId','profileVersionId','declaredBy','note']);
const baseline={...baselineObject,type:['object','null']};
const workspace={workspace:alias},view={...workspace,expectedRevision:revision},mutation={...view,requestId:id};
const paging={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},search={q:string(2000)};
const host={input:alias,expectedSha256:hash},read={readOnly:true,idempotent:true},change={idempotent:true};
export const serviceConfigurationFileSelection={
  kind:enumeration(['workspace','profile','source','preview-json','preview-csv','release-json','release-report','operation']),
  profileId:id,profileVersionId:id,sourceId:id,previewId:id,releaseId:id,operationId:id,expectedRevision:revision
};
export function serviceConfigurationWorkspaceTools(tool){
  const make=(name,description,properties,required,annotations=read)=>tool('merchant_open311_service_configuration_'+name,description,properties,required,annotations);
  return [
    make('workspaces','List configured service workspaces and original source/profile/workspace input aliases with complete file identities.',{},[]),
    make('status','Read the selected workspace identity, revision, profile/source/preview/release counts and original operation summaries.',workspace,['workspace']),
    make('records','Search and page saved source, configuration, preview or implementation handover summaries at one observed revision.',{...view,kind:enumeration(['sources','profiles','previews','releases']),...search,...paging},['workspace','kind','expectedRevision']),
    make('input','Inspect the named original host file and its complete bytes, purpose, media type and SHA-256.',{...workspace,input:alias},['workspace','input']),
    make('inspect_source','Inspect all original arrays in the complete selected JSON file before choosing the exact request register.',{...workspace,...host},['workspace','input']),
    make('import_source','Retain the complete original JSON and the explicitly chosen request-array pointer, preserving all source attributes.',{...mutation,...host,name:string(1000),selection:rowSelection},['workspace','input','expectedSha256','name','selection','requestId','expectedRevision'],change),
    make('source','Inspect an original saved source, selected row-array identity and complete original-file metadata. Download source for exact bytes.',{...view,id},['workspace','id','expectedRevision']),
    make('source_rows','Search and page the complete original request values and their saved source keys and JSON pointers.',{...view,sourceId:id,...search,...paging},['workspace','sourceId','expectedRevision']),
    make('profile_save','Save the complete service configuration definition as a new profile or next explicit version of a selected profile.',{...mutation,profile,expectedProfileVersionId:optionalVersion},['workspace','profile','requestId','expectedRevision'],change),
    make('profile_import','Save an original host-selected configuration definition and retain its exact input identity. Supply profileId only to create a next version of that selected profile.',{...mutation,...host,profileId:id,expectedProfileVersionId:optionalVersion},['workspace','input','expectedSha256','requestId','expectedRevision'],change),
    make('profile','Inspect the current complete configuration and page its saved full version history. Download profile for an immutable selected version.',{...view,id,...paging},['workspace','id','expectedRevision']),
    make('preview_create','Route the complete original register with one exact configuration version, explicit record overrides and optional named deployed-baseline declaration.',{...mutation,name:string(1000),profileId:id,expectedProfileVersionId:id,sourceId:id,mapping,overrides:{type:'array',items:override,maxItems:100000},baseline},['workspace','name','profileId','expectedProfileVersionId','sourceId','mapping','requestId','expectedRevision'],change),
    make('preview','Search and page saved routing decisions, local due dates, public-map choices, exact resident messages and configuration diagnostics.',{...view,id,...search,...paging},['workspace','id','expectedRevision']),
    make('release_create','Review the selected complete configuration version and source-backed preview as an implementation handover with named reviewer and rollout notes.',{...mutation,name:string(1000),profileId:id,expectedProfileVersionId:id,previewId:id,reviewer:string(300),note:string()},['workspace','name','profileId','expectedProfileVersionId','previewId','reviewer','requestId','expectedRevision'],change),
    make('release','Inspect the immutable implementation handover and page its remaining requests, complete application stages or migration implications. Download release files for the complete content.',{...view,id,section:enumeration(['remaining','apply-order','implications']),...paging},['workspace','id','expectedRevision']),
    make('operation','Recover the original saved action and compact original-file identity. Download operation for its full retained input.',{...workspace,requestId:id},['workspace','requestId']),
    make('receive','Receive the complete editable configuration workspace into an empty selected directory, preserving profile versions, original files, previews, releases and replay history.',{...mutation,...host},['workspace','input','expectedSha256','requestId','expectedRevision'],change),
    make('file_read','Download complete original sources, selected configuration versions, routing JSON/CSV, implementation JSON/print report or editable workspaces with stable revision, original hash and byte offset.',{...workspace,...serviceConfigurationFileSelection,readId:{type:'string',minLength:1,maxLength:128},expectedSha256:hash,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','kind','expectedRevision']),
    make('file_release','Release the selected retained file reader after receiving or cancellation.',{...workspace,readId:{type:'string',minLength:1,maxLength:128}},['workspace','readId'],change)
  ];
}

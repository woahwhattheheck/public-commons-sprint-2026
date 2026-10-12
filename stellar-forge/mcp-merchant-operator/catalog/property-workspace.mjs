// MIT. Complete Property Operations catalog; no native workspace is opened by metadata.
import {PROPERTY_GROUPS,PROPERTY_READ_ACTIONS,PROPERTY_WRITE_ACTIONS,PROPERTY_PUBLISHER_ACTIONS,PROPERTY_FILE_KINDS}
  from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/property-operations/contract.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const selected={workspace:alias},read={readOnly:true,idempotent:true};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:250},expectedRevision:{type:'integer',minimum:0}};
const range={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608},readId:{type:'string',maxLength:64}};
const publisher={resourceId:{anyOf:[id,{type:'null'}]},kind:{type:'string',enum:[...PROPERTY_FILE_KINDS]},id:{type:'string',minLength:1,maxLength:512}};
const fileSelection={type:'object',description:'Exact native {kind:"property",file} or {kind:"source-export",exportId,name}; optional reviewed bytes and sha256.'};
export function propertyWorkspaceTools(tool) {
  return [
    tool('merchant_property_workspaces','List the host-selected original Property Operations workspaces and file aliases.',{},[],read),
    tool('merchant_property_status','Read the complete original source, property collections, request history and publisher state.',selected,['workspace'],read),
    tool('merchant_property_records','Page an original complete record collection. Retain expectedRevision for every following page.',
      {...selected,group:{type:'string',enum:[...PROPERTY_GROUPS]},...page},['workspace','group'],read),
    tool('merchant_property_record','Read a complete original saved property record and its native file identity.',
      {...selected,group:{type:'string',enum:[...PROPERTY_GROUPS]},id},['workspace','group','id'],read),
    tool('merchant_property_operation','Read the original action key, exact input hash and saved outcome before continuing.',
      {...selected,key:id},['workspace','key'],read),
    tool('merchant_property_prepare','Prepare one complete original property change with the current workspace/revision. Save this entire returned envelope before invoking it. No vendor request is made.',
      {...selected,action:{type:'string',enum:PROPERTY_WRITE_ACTIONS.filter(v=>v!=='property.file.import')},input:{type:'object'},key:id},
      ['workspace','action','input','key'],read),
    tool('merchant_property_file_import_prepare','Prepare original property.file.import from a host-declared complete file. Both bytes and SHA-256 must match the selected alias.',
      {...selected,fileAlias:alias,bytes:{type:'integer',minimum:0,maximum:67108864},sha256:hash,key:id,actor:{type:'string'},note:{type:'string'}},
      ['workspace','fileAlias','bytes','sha256','key','actor','note'],read),
    tool('merchant_property_inspect_request','Inspect a complete retained request without changing it or preparing a new key.',
      {...selected,prepared:{type:'object'}},['workspace','prepared'],read),
    tool('merchant_property_invoke','Continue one unchanged prepared native request. A saved DONE result is reused; ISSUED requires explicit same-key request.run recovery and never automatically sends again.',
      {...selected,prepared:{type:'object'},resumeIssued:{type:'boolean'}},['workspace','prepared'],{}),
    tool('merchant_property_action','Use one original read, publisher, dataset query or package export action. Preserve native publisher run/session/review inputs. Package export is an explicit new export; read state after an uncertain response.',
      {...selected,action:{type:'string',enum:[...PROPERTY_READ_ACTIONS,...PROPERTY_PUBLISHER_ACTIONS,'dataset.query','package.export']},payload:{type:'object'}},
      ['workspace','action','payload'],{}),
    tool('merchant_property_files','Page the original property file descriptors; retain the original revision through every page.',
      {...selected,...page},['workspace'],read),
    tool('merchant_property_file','Resolve an exact original property or source-export file descriptor.',
      {...selected,selection:fileSelection},['workspace','selection'],read),
    tool('merchant_property_file_read','Receive an exact complete native file through the original bounded retained-file reader; retain the SHA-256 and readId.',
      {...selected,selection:fileSelection,expectedSha256:hash,...range},['workspace','selection','expectedSha256'],read),
    tool('merchant_property_file_release','Release only this borrowed retained-file read.',
      {...selected,readId:{type:'string',maxLength:64}},['workspace','readId'],{readOnly:true,idempotent:true}),
    tool('merchant_property_publisher_file','Read the full original publisher output and return its complete byte/hash identity. This does not run a buyer request or publish another release.',
      {...selected,...publisher},['workspace','kind','id'],read),
    tool('merchant_property_publisher_file_read','Receive the exact reviewed original publisher file through the same bounded file reader.',
      {...selected,...publisher,bytes:{type:'integer',minimum:0,maximum:536870912},expectedSha256:hash,...range},
      ['workspace','kind','id','bytes','expectedSha256'],read),
    tool('merchant_property_export_prepare','Retain the complete file manifest of an ALREADY saved source export or selected customer property resource. It creates receiving metadata only.',
      {...selected,createdAt:{type:'string'},selection:{type:'object',description:'{kind:"source-export",exportId} or {kind:"property-resource",resourceId}'}},
      ['workspace','createdAt','selection'],{readOnly:true,idempotent:true}),
    tool('merchant_property_export_manifest','Read the retained complete receiving manifest identity.',
      {...selected,exportId:hash},['workspace','exportId'],read),
    tool('merchant_property_export_inventory','Page every file in the same retained receiving manifest.',
      {...selected,exportId:hash,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:250}},
      ['workspace','exportId'],read),
    tool('merchant_property_export_file','Receive every original manifest member without row projection or truncation.',
      {...selected,exportId:hash,file:{type:'string',maxLength:4096},expectedManifestSha256:hash,expectedSha256:hash,...range},
      ['workspace','exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_property_export_file_release','Release only the borrowed file read for this retained export.',
      {...selected,exportId:hash,readId:{type:'string',maxLength:64}},['workspace','exportId','readId'],read),
    tool('merchant_property_reconnect','Reconnect through the original private connection file after its owner reopens, preserving the exact outer workspace identity.',
      {...selected,createdAt:{type:'string'},propertyId:{anyOf:[id,{type:'null'}]}},['workspace','createdAt'],read),
  ];
}

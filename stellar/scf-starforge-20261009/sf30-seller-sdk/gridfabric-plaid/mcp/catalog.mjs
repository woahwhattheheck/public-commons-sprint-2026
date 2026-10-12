// MIT. Complete original GridFabric operations in the existing merchant tool catalogue.
import {gridFabricOperations,gridFabricToolName,UUID} from '../sdk/contract.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^(?:file_[a-f0-9]{64}|export_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'},text={type:'string',minLength:1};
const integer={type:'integer',minimum:0},uuid={type:'string',pattern:UUID.source};
const read={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
const write={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
export function gridFabricMerchantTools(tool) {
  const result=Object.values(gridFabricOperations).map(entry=>tool(gridFabricToolName(entry.operation),entry.description,
    {workspace:alias,...entry.inputSchema.properties},['workspace',...entry.inputSchema.required],entry.annotations));
  result.push(
    tool('merchant_gridfabric_workspaces','List host-declared original workspaces, source/archive files and sibling receiving aliases.',{},[],read),
    tool('merchant_gridfabric_status','Inspect the existing original operator and its complete native workspace counts.',{workspace:alias},['workspace'],read),
    tool('merchant_gridfabric_reopen','Reattach to the same original workspace and source after its managed operator restarts.',{workspace:alias},['workspace'],read),
    tool('merchant_gridfabric_file_info','Read the complete original source-file or portable-export identity.',
      {workspace:alias,fileId:id},['workspace','fileId'],read),
    tool('merchant_gridfabric_file_manifest','Read the deterministic full-file manifest over an original native file or portable export.',
      {workspace:alias,exportId:id,expectedSha256:sha},['workspace','exportId'],read),
    tool('merchant_gridfabric_file','Read the exact original manifest or native-file range and follow nextOffset until null.',
      {workspace:alias,exportId:id,file:text,expectedManifestSha256:sha,expectedSha256:sha,
        offset:integer,limit:{type:'integer',minimum:1,maximum:196608}},
      ['workspace','exportId','file','expectedManifestSha256','expectedSha256','offset','limit'],read),
    tool('merchant_gridfabric_upload','Stream the complete reviewed host-declared source file into the original immutable file vault.',
      {workspace:alias,file:alias,expectedSha256:sha,expectedBytes:integer},
      ['workspace','file','expectedSha256','expectedBytes'],write),
    tool('merchant_gridfabric_receive','Receive a complete original portable archive into a host-declared sibling with the retained native request UUID.',
      {workspace:alias,file:alias,destination:alias,request_id:uuid,expectedSha256:sha,expectedBytes:{type:'integer',minimum:1}},
      ['workspace','file','destination','request_id','expectedSha256','expectedBytes'],write)
  );
  return result;
}
export const gridFabricExtraToolFields=Object.freeze({
  merchant_gridfabric_workspaces:[],
  merchant_gridfabric_status:['workspace'],
  merchant_gridfabric_reopen:['workspace'],
  merchant_gridfabric_file_info:['workspace','fileId'],
  merchant_gridfabric_file_manifest:['workspace','exportId','expectedSha256'],
  merchant_gridfabric_file:['workspace','exportId','file','expectedManifestSha256','expectedSha256','offset','limit'],
  merchant_gridfabric_upload:['workspace','file','expectedSha256','expectedBytes'],
  merchant_gridfabric_receive:['workspace','file','destination','request_id','expectedSha256','expectedBytes']
});

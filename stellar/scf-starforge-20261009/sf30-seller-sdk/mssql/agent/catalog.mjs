// MIT. Native SQL Server operations; each tool keeps the original workspace owner.
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const release={type:'string',pattern:'^[A-Za-z_][A-Za-z0-9_]{0,63}$'};
const selected={workspace:alias,workspaceId:uuid};
const reviewed={...selected,reviewId:uuid,planId:sha};
const prepared={...selected,releaseId:release,manifestSha256:sha};
const exported={...selected,exportId:uuid};
const page={after:uuid,limit:{type:'integer',minimum:1,maximum:100}};
const read={readOnly:true,idempotent:true};
export function mssqlWorkspaceTools(tool){
  return [
    tool('merchant_mssql_workspaces','List original SQL Server browser owners and host-declared complete-source receiving aliases.',{},[],read),
    tool('merchant_mssql_status','Read the same native workspace, source profile and current seller owner used by the browser.',selected,['workspace','workspaceId'],read),
    tool('merchant_mssql_catalog','Read the actual native catalog or one schema-qualified table/view with exact column metadata.',{...selected,table:{type:'string',minLength:1,maxLength:512}},['workspace','workspaceId'],{...read,openWorld:true}),
    tool('merchant_mssql_reviews','Page retained original query/price reviews, including reviews saved in the browser.',{...selected,...page},['workspace','workspaceId'],read),
    tool('merchant_mssql_operations','Page original retained operations and their completion state across browser and MCP restarts.',{...selected,...page},['workspace','workspaceId'],read),
    tool('merchant_mssql_operation','Reopen an original request and its exact retained query result, review or transfer outcome.',{...selected,operationId:uuid},['workspace','workspaceId','operationId'],read),
    tool('merchant_mssql_review_load','Reopen one original typed review and its complete editable choices after process or browser restart.',{...selected,reviewId:uuid},['workspace','workspaceId','reviewId'],read),
    tool('merchant_mssql_review','Review original native columns, typed filters, ordering and merchant terms. Keep this operation UUID for exact response-loss recovery.',{...selected,choices:{type:'object'},operationId:uuid},['workspace','workspaceId','choices','operationId'],{idempotent:true,openWorld:true}),
    tool('merchant_mssql_preview','Run the selected approved native query and retain its exact result under the original operation UUID; retries reopen those captured values.',{...reviewed,endpointId:release,operationId:uuid},['workspace','workspaceId','reviewId','planId','endpointId','operationId'],{idempotent:true,openWorld:true}),
    tool('merchant_mssql_prepare','Prepare the complete original merchant package from the exact review. Recover the same release after a lost save reply.',{...reviewed,operationId:uuid},['workspace','workspaceId','reviewId','planId','operationId'],{idempotent:true}),
    tool('merchant_mssql_releases','Page complete original prepared releases and current runtime.',{...selected,page:{type:'integer',minimum:0,maximum:100000}},['workspace','workspaceId'],read),
    tool('merchant_mssql_release','Reopen and verify the selected original prepared release before starting, staging or exporting it.',{...selected,releaseId:release},['workspace','workspaceId','releaseId'],read),
    tool('merchant_mssql_stage','Stage the same prepared source through the original configured SF82 store. Continue through its existing compare, activate and run tools.',{...prepared,id:alias},['workspace','workspaceId','releaseId','manifestSha256','id'],{idempotent:true}),
    tool('merchant_mssql_start','Start the exact original prepared merchant through this browser owner. An already running matching release returns its existing run ID.',prepared,['workspace','workspaceId','releaseId','manifestSha256'],{openWorld:true}),
    tool('merchant_mssql_stop','Drain and stop the exact original run selected from current status.',{...selected,runId:uuid},['workspace','workspaceId','runId'],{destructive:true}),
    tool('merchant_mssql_export','Retain an immutable complete prepared merchant or customer-only client export. Reuse this operation UUID to reopen the same export.',{...prepared,kind:{type:'string',enum:['merchant','customer']},operationId:uuid},['workspace','workspaceId','releaseId','manifestSha256','kind','operationId'],{idempotent:true}),
    tool('merchant_mssql_exports','Page original retained exports after browser, MCP or workspace restart.',{...selected,...page},['workspace','workspaceId'],read),
    tool('merchant_mssql_export_manifest','Read the exact retained transfer manifest identity before downloading every original file.',exported,['workspace','workspaceId','exportId'],read),
    tool('merchant_mssql_export_file','Read a complete retained file in verified base64 chunks. Continue readId/nextOffset or reopen the same expected digest after restart.',{...exported,file:{type:'string',minLength:1,maxLength:128},expectedManifestSha256:sha,expectedSha256:sha,readId:uuid,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608}},['workspace','workspaceId','exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_mssql_export_file_release','Release the original download descriptor while retaining its complete export.',{...exported,readId:uuid},['workspace','workspaceId','exportId','readId'],{idempotent:true}),
    tool('merchant_mssql_receive','Receive a complete prepared merchant from a host-declared download directory. Preserve original release/package/choice identities through the native release lease.',{...selected,delivery:alias,expectedManifestSha256:sha,operationId:uuid},['workspace','workspaceId','delivery','expectedManifestSha256','operationId'],{idempotent:true})
  ];
}

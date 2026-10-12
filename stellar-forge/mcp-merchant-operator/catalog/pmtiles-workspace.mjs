// MIT. Source-owned PMTiles merchant metadata; native modules load only when selected.
const workspace = {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id = {type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'};
const digest = {type:'string',pattern:'^[a-f0-9]{64}$'};
const object = {type:'object',additionalProperties:true};
const version = {type:'integer',minimum:1};
const text = {type:'string',minLength:1};
const chunk = {offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608},readId:{type:'string'}};
const releaseOrNull = {anyOf:[id,{type:'null'}]};
const exportId = {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}:[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'};
export function pmtilesWorkspaceTools(tool) {
  const read={readOnly:true,idempotent:true}, write={idempotent:true};
  const scoped=fields=>({workspace,...fields}), durable=fields=>scoped({requestId:id,...fields});
  const row=(name,description,fields,required,flags=read)=>tool('merchant_pmtiles_'+name,description,fields,required,flags);
  return [
    row('status','List host-selected PMTiles workspaces or read the open workspace, saved editions, current release, original operations and file transfers.',scoped({offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}}),[]),
    row('open','Open the selected original PMTiles authoring server/controller on its retained browser origin. Uses the configured runtime and expected workspace identity.',scoped({}),['workspace'],write),
    row('close','Drain this provider’s accepted workspace calls and close its original browser server, owned Martin process and retained file reads. Saved work is reopened by open.',scoped({}),['workspace'],write),
    row('console','Return the original private browser console link for this open workspace. Its token fragment is intended for the operator’s local browser.',scoped({}),['workspace']),
    row('resources','Page the original captured source catalog, including exact bytes, rights and native acquisition receipts.',scoped({offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200},kind:{type:'string',enum:['pmtiles','style','sprite-json','sprite-png','glyph','document']}}),['workspace']),
    row('resource','Read one original captured source and its attribution, size, digest and acquisition identity.',scoped({resourceId:id}),['workspace','resourceId']),
    row('resource_file','Read exact original captured source bytes. Continue with nextOffset/readId and the same expectedSha256; after restart omit the expired readId.',scoped({resourceId:id,expectedSha256:digest,...chunk}),['workspace','resourceId','expectedSha256']),
    row('file_release','Release one retained resource read for this workspace.',scoped({readId:{type:'string'}}),['workspace','readId'],write),
    row('import','Capture one host-selected local source alias into the original workspace. The configured original path, rights and optional digest remain bound to requestId.',durable({source:workspace}),['workspace','requestId','source'],write),
    row('acquire','Capture a complete public HTTPS source with the original PMTiles transport and retained native response. Supply its name, kind, attribution and optional exact bytes/hash or ETag.',durable({url:text,name:text,kind:{type:'string',enum:['pmtiles','style','sprite-json','sprite-png','glyph','document']},rights:object,expected:object,maxBytes:{type:'integer',minimum:1},etag:text}),['workspace','requestId','url','name','kind','rights'],{...write,openWorld:true}),
    row('adopt_object','Import a configured complete SF88 ObjectDelivery and its original recorded receipt. Uses the host-selected report bytes/hash and the original object buyer classes.',durable({source:workspace}),['workspace','requestId','source'],write),
    row('save','Save a complete immutable map edition using original captured resource IDs. expectedVersion=0 creates an edition; otherwise use its latest saved version.',durable({editionId:id,expectedVersion:{type:'integer',minimum:0},edition:object}),['workspace','requestId','editionId','expectedVersion','edition'],write),
    row('edition','Read an exact original saved edition version.',scoped({editionId:id,version}),['workspace','editionId','version']),
    row('compare','Compare two saved original map editions, including sources, style and layer decisions.',scoped({leftId:id,leftVersion:version,rightId:id,rightVersion:version}),['workspace','leftId','leftVersion','rightId','rightVersion']),
    row('inspect','Run the original complete native archive, style and tile inspection against one saved edition and the configured immutable runtime. Reuse requestId to recover the retained result.',durable({editionId:id,version}),['workspace','requestId','editionId','version'],write),
    row('request','Reopen an original saved workspace request with its exact input, result or error. Package recovery uses package_info because its retained request lives with the original package.',scoped({requestId:id}),['workspace','requestId']),
    row('review','Record the selected saved edition and its completed original inspection, binding the current release, reviewer and exact release inputs.',durable({editionId:id,version,inspectionRequestId:id,expectedCurrentRelease:releaseOrNull,reviewer:text,note:{type:'string'}}),['workspace','requestId','editionId','version','inspectionRequestId','expectedCurrentRelease','reviewer'],write),
    row('review_status','Read the complete original retained review without repeating native inspection.',scoped({reviewId:id}),['workspace','reviewId']),
    row('prepare','Prepare immutable release files from the exact selected original review and reviewSha256.',durable({reviewId:id,reviewSha256:digest}),['workspace','requestId','reviewId','reviewSha256'],write),
    row('release','Read one original saved release and its complete file identities.',scoped({releaseId:id}),['workspace','releaseId']),
    row('publish','Publish the exact prepared release under its original current-release comparison. The original controller drains the old Martin process and checks the new native catalog, TileJSON and known tile.',durable({releaseId:id,manifestSha256:digest,expectedCurrentRelease:releaseOrNull}),['workspace','requestId','releaseId','manifestSha256','expectedCurrentRelease'],write),
    row('restore','Restore the selected currently published release’s actual saved predecessor and restart that original Martin preview.',durable({fromReleaseId:id,manifestSha256:digest}),['workspace','requestId','fromReleaseId','manifestSha256'],write),
    row('preview','Start or reopen the original selected release preview on this workspace’s browser server.',durable({releaseId:id}),['workspace','requestId','releaseId'],write),
    row('stop_preview','Stop and drain this controller’s owned Martin preview while keeping the saved workspace and release pointers.',durable({}),['workspace','requestId'],write),
    row('export','Create the original complete frozen workspace export in the host-selected private exports directory. Reuse requestId to reopen that exact export.',durable({}),['workspace','requestId'],write),
    row('package','Create the original complete source/runtime/workspace portable ZIP and retain its exact download descriptor. Reuse requestId after an interrupted result.',durable({}),['workspace','requestId'],write),
    row('package_info','Reopen the original package request and complete result, verify its selected archive, and recover the same download descriptor.',durable({}),['workspace','requestId'],write),
    row('download_manifest','Inspect the retained original package download manifest. exportId is workspace:original-package-requestId.',{exportId},['exportId']),
    row('download_file','Read the exact selected package or its download manifest through the original retained-file descriptor. Repeat both hashes and nextOffset; omit an expired readId after reopen.',{exportId,file:{type:'string',enum:['pmtiles-download.json','pmtiles-operations.zip']},expectedManifestSha256:digest,expectedSha256:digest,...chunk},['exportId','file','expectedManifestSha256','expectedSha256']),
    row('download_file_release','Release the original retained package-file read.',{exportId,readId:{type:'string'}},['exportId','readId'],write),
    row('receive','Receive the selected original package into a host-configured receiving target, with a separate installation and workspace under this requestId. Validates the source/runtime/workspace closure and reopens its exact native files.',durable({packageRequestId:id,archiveSha256:digest,target:workspace}),['workspace','requestId','packageRequestId','archiveSha256','target'],write)
  ];
}

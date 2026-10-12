// MIT. Additive retained receiving catalog for the one original Datasette provider.
const alias = {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const workspaceId = {type:'string',minLength:1,maxLength:256};
const sha = {type:'string',pattern:'^[a-f0-9]{64}$'};
const path = {type:'string',minLength:1,maxLength:4096};
const exportId = sha;
const selected = {workspace:alias};
const read = {readOnly:true,idempotent:true};
const page = {offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:250}};
const range = {offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:196608},readId:{type:'string',minLength:1,maxLength:64}};

export function datasetteReceivingTools(tool) {
  return [
    tool('merchant_datasette_reconnect',
      'Reconnect the original host-declared workspace and verify its persistent identity. Read native status and the actual operation catalog; this does not resume or replay a source, publisher or buyer action.',
      {...selected,workspaceId},['workspace','workspaceId'],read),
    tool('merchant_datasette_files',
      'Read one complete page of original retained source, edition, publisher, dataset, analysis or export file identities. Follow page.next through the original native catalog.',
      {...selected,prefix:{type:'string',maxLength:4096},...page},['workspace'],read),
    tool('merchant_datasette_file',
      'Inspect an exact original workspace-relative file and optionally verify its reviewed SHA-256.',
      {...selected,path,sha256:sha},['workspace','path'],read),
    tool('merchant_datasette_file_read',
      'Receive a bounded chunk of an exact original file through the maintained retained-file reader. The first read acquires the full hash-verified native file; later chunks and reconnects preserve the same SHA.',
      {...selected,path,expectedSha256:sha,...range},['workspace','path','expectedSha256'],read),
    tool('merchant_datasette_file_release',
      'Release only an existing merchant receiving file handle. The original Datasette workspace and publisher stay with their owner.',
      {...selected,readId:range.readId},['workspace','readId'],read),
    tool('merchant_datasette_export_prepare',
      'Save a complete receiving manifest from every original retained file matching the optional native prefix. Two complete native inventories must agree. Existing source/workspace archives travel unchanged; this action never generates another native export.',
      {...selected,workspaceId,prefix:{type:'string',maxLength:4096}},['workspace','workspaceId'],{readOnly:false,idempotent:true}),
    tool('merchant_datasette_export_inventory',
      'Read a page from the already-retained complete receiving manifest, including the full original file identities. The complete manifest is always available for download.',
      {...selected,exportId,...page},['workspace','exportId'],read),
    tool('merchant_datasette_export_manifest',
      'Read the exact byte count and SHA of the complete saved Datasette receiving manifest.',
      {...selected,exportId},['workspace','exportId'],read),
    tool('merchant_datasette_export_file',
      'Receive a manifest-declared original file using its original export, manifest and file hashes. Preserve offset and readId on continued receiving; after a reader restart use the same original hashes.',
      {...selected,exportId,file:path,expectedManifestSha256:sha,expectedSha256:sha,...range},
      ['workspace','exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_datasette_export_file_release',
      'Release this receiving export’s retained file handle without closing its original source owner.',
      {...selected,exportId,readId:range.readId},['workspace','exportId','readId'],read),
  ];
}

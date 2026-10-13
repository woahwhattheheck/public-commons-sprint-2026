// SPDX-License-Identifier: MIT
// Pure additions to the original native Analysis tool schema.
const id={type:'string',pattern:'^[a-f0-9]{32}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$',
  description:'The original launcher-declared publication connection alias.'};
const name={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const nativeId={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
  description:'The exact original native workspace UUID from dataset-configuration.'};
const integer={type:'integer',minimum:0,maximum:9007199254740991};
const limit={type:'integer',minimum:1,maximum:100,default:25};
const before={...integer,minimum:1};
const selectedSource={type:'boolean',default:false,
  description:'false selects this completed Dataset package; true selects the completed original download-export source job.'};
const sourceReads=['status','input','current','request','capture','edition','review','plan-input',
  'publisher-status','publisher-target','publisher-inspect','inspect-export'];
const sourceActions=['open','intake','edition','review-edition','select','plan','export','cancel','resume',
  'publisher-extract','publisher-review','publisher-publish','publisher-recover','publisher-cancel','download-export'];
const sourceProperties={
  connection:alias,action:{type:'string',enum:sourceActions},
  args:{type:'object',additionalProperties:true,
    description:'The complete original native action arguments with exact camelCase names, retained native UUIDs, version/source digests and explicit reviewer decisions. No arbitrary local input path is accepted; the native workbench validates this original action.'},
  package_id:{...id,description:'Completed original Dataset package job. Required with index_sha256 for actions over selected package bytes.'},
  index_sha256:{...hash,description:'Exact original package downloads.json SHA-256, not a hash of the enriched HTTP response.'},
  reviewed_endpoint:{type:'string',minLength:1,maxLength:4096,
    description:'The exact configured HTTP(S) native endpoint, including its original path. No user information, query, or fragment.'},
  expected_workspace_id:nativeId
};
const spec=(required,properties,description)=>({required,properties,description});
export const nativePublicationOperations=Object.freeze({
  'dataset-configuration':spec([],{},
    'Read existing Dataset representations, complete launcher-declared native connection identities, source actions/reads, public/private file names and limits. This operation does not create a connection or acquire a dataset.'),
  'dataset-exports':spec([],{before,limit},
    'Page the original completed query-export history as explicitly bounded metadata. Preserve next_before and the selected export/manifest identities; this does not rerun a query. Full results remain in the original Analysis job and its native saved files.'),
  'dataset-recipes':spec([],{before,limit},
    'Page saved recipe identity, revision, source and head metadata. Preserve next_before. Metadata is not a replay request; retain your complete original save body and use dataset-recipe for the selected recipe.'),
  'dataset-jobs':spec([],{before,limit},
    'Page original Dataset package jobs and their actual status/request/result metadata. Preserve next_before. Complete native results are available through dataset-job and package download files.'),
  'dataset-source-jobs':spec([],{before,limit},
    'Page original Analysis commands over the native Frictionless workbench/publisher. Parent Analysis status and nested native operation/run state are separate. Retain original IDs and next_before; do not invent a replacement action after uncertainty.'),
  'dataset-review':spec(['query_export_id'],{
    query_export_id:id,manifest_sha256:hash,sample_rows:{type:'integer',minimum:0,maximum:100,default:20}},
    'Read one completed original query export, its exact manifest/binding, typed columns and bounded SQLite-scalar sample. Oversized previews explicitly report omitted rows/columns and full native source availability. Choose all recipe representations and source rights yourself; this does not save a recipe.'),
  'dataset-save-recipe':spec(['id','name','expected_revision','recipe'],{
    id,name,expected_revision:integer,recipe:{type:'object',additionalProperties:true,
      description:'The complete reviewed native recipe: original workspace/query export/manifest, explicit selected fields and representations, package title/resource and source rights. The existing Dataset recipe validator owns all field semantics.'}},
    'Save or reopen one exact retained recipe request. Persist this id and complete body before POST. The original native backend reconciles an existing request before source availability/current head revision, normalizes the selected recipe, and returns its original digest/revision. No publisher approval is generated.'),
  'dataset-recipe':spec(['recipe_id'],{recipe_id:id},
    'Read the original saved normalized recipe, source binding, digest and current name-head metadata. Large recipes return explicit metadata with original HTTP/file locations; keep the original request for replay.'),
  'dataset-prepare':spec(['id','recipe_id','recipe_sha256'],{id,recipe_id:id,recipe_sha256:hash},
    'Prepare or explicitly continue the original Dataset package job. The helper first reads this exact id and compares its complete original request; COMPLETE returns the retained result. Only ANALYSIS_JOB_NOT_FOUND permits initial POST, and the original start/resume rules decide other states. An uncertain reply never permits a new id.'),
  'dataset-job':spec(['id'],{id},
    'Read the actual original dataset-package or dataset-source Analysis job. Complete results are returned unchanged when bounded; larger results explicitly expose metadata, native state paths and full original service/file availability. Analysis COMPLETE does not imply a nested asynchronous native run has finished.'),
  'dataset-cancel':spec(['id'],{id},
    'Read the original job kind and request cancellation through its matching existing package/source route. Returns native progress, including actual cancellation observations. Then read dataset-job for authoritative status; a prior accepted native result remains accepted.'),
  'dataset-source':spec(['id','connection','action','args','reviewed_endpoint','expected_workspace_id'],{id,...sourceProperties},
    'Execute or explicitly continue one original reviewed native source/workbench/publisher action through the existing Analysis job. Persist the complete body and id first. The helper reads and compares the same original job before POST; a completed command returns its original result, while its nested native operation can still be RUNNING. Native input aliases, UUIDs, optimistic versions, reviews and source hashes remain the caller’s exact selections.'),
  'dataset-source-read':spec(['connection','action','args','reviewed_endpoint','expected_workspace_id'],{
    ...sourceProperties,action:{type:'string',enum:sourceReads}},
    'Read an existing native workbench/publisher selection or original request through the same configured bridge. Its underlying HTTP POST is a read operation. Keep original camelCase arguments, exact endpoint/workspace and package/index when required; native asynchronous state is preserved.'),
  'dataset-package':spec(['id'],{id},
    'Read the original complete package UI view: normalized recipe, source field statistics, native projection conflicts, declared input, queries text and download index. Large responses explicitly project metadata; dataset-downloads/dataset-file retain the full native index and package files.'),
  'dataset-downloads':spec(['id'],{id,source:selectedSource,offset:integer,limit},
    'Capture or reopen the exact native download index and page its original file records. The host verifies actual downloads.json or files-index.json bytes against the enriched native HTTP index. Returns workspaceId/jobId/source/indexSha256/indexFile/fileCount/files/page/binding. Continue page.nextOffset; use indexFile for the complete unchanged raw index. No file greater than 128 MiB is hidden; use the existing Python streaming downloader for those members.'),
  'dataset-file':spec(['id','index_sha256','filename','sha256'],{
    id,source:selectedSource,index_sha256:hash,
    filename:{type:'string',minLength:1,maxLength:128,
      description:'An exact name in the selected original index, or its raw downloads.json/files-index.json. Source review files retain reviews/<original UUIDv4>.json; this is not a filesystem path supplied by the caller.'},
    sha256:hash,byteOffset:integer,maxBytes:{type:'integer',minimum:1,maximum:65536,default:65536}},
    'Read a verified original file range from the selected index, including the raw index itself. A cache miss rechecks current native index identity and verifies all exact bytes before private publication; cached older files remain readable offline. Returns unchanged SavedFileReader output under file with base64, exact offsets, digest and nextByteOffset. Continue until null. Cache ceiling is 128 MiB/member; larger outputs use original Python dataset-download streaming. No new reader lease or runtime is created.')
});

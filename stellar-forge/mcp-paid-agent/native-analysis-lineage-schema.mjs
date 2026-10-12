// SPDX-License-Identifier: MIT
// Pure schema for the original Analysis Lineage plan, publication and file operations.
const id={type:'string',pattern:'^[a-f0-9]{32}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const collector={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',
  description:'Exact original collector workspace UUID returned by lineage-configuration.'};
const alias={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const integer={type:'integer',minimum:0,maximum:9007199254740991};
const limit={type:'integer',minimum:1,maximum:100,default:25};
const page={collection:{enum:['summary','jobs','datasets','events'],default:'summary',
  description:'Bounded metadata projection of this original source; download the complete native files for full events, mappings, SQL and facets.'},
  offset:integer,limit};
const title={type:'string',minLength:1,maxLength:160,pattern:'^[^\\u0000-\\u001f\\u007f]+$'};
const note={type:'string',maxLength:4000,pattern:'^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]*$'};
const files=['events.json','plan.json','native-bindings.json','receipts.json','report.html','manifest.json','handover.zip'];
const spec=(required,properties,description)=>({required,properties,description});
export const nativeLineageOperations=Object.freeze({
  'lineage-configuration':spec([],{},
    'Read existing launcher-configured collector aliases, actual collector workspace UUIDs, availability and supported original completed Analysis job kinds. No credentials or caller-supplied endpoint are accepted.'),
  'lineage-jobs':spec([],{before:{...integer,minimum:1},limit},
    'Page completed original Analysis jobs eligible for retrospective lineage. Preserve next_before; this operation does not execute the analysis again.'),
  'lineage-review':spec(['job_id'],{job_id:id,include_sql:{type:'boolean',default:false},...page},
    'Review one original completed Analysis dependency closure and its exact snapshot/event digests. Summary is the default; page jobs, datasets or events as metadata using projection.next_offset. Full original source remains in the saved plan files. include_sql is an explicit source choice.'),
  'lineage-save-plan':spec(['id','job_id','expected_snapshot_sha256','connection','expected_workspace_id','title','note'],{
    id,job_id:id,expected_snapshot_sha256:hash,connection:alias,expected_workspace_id:collector,
    title,note,include_sql:{type:'boolean',default:false}},
    'Save or reopen the same original reviewed plan. Retain id and the complete request before dispatch. Use the review snapshot digest and the selected configured collector UUID; this saves exact event bytes without publishing them. Reuse the original request after a lost reply.'),
  'lineage-plans':spec([],{before:{...integer,minimum:1},limit},
    'Page original retained plan summaries and actual publication state. request_summary is not a complete replay request; lineage-plan returns the unchanged full request. Preserve next_before.'),
  'lineage-plan':spec(['plan_id'],{plan_id:id,...page},
    'Reopen one original plan by plan_id, including its exact request, digests, collector binding and actual publication receipt. Page selected metadata with collection/offset/limit; download full source files for complete event and native-binding content.'),
  'lineage-publish':spec(['id','plan_id','plan_sha256'],{id,plan_id:id,plan_sha256:hash},
    'Publish or explicitly continue the original Analysis lineage-publish job using its retained plan digest and same job id. Existing publication is read first; a completed job returns its original result. The original native service alone applies resume rules and retains collector idempotency. Never replace the job id after an uncertain reply.'),
  'lineage-publication':spec(['id'],{id},
    'Read the actual original lineage-publish Analysis job, request, retained receipt, progress and uncertainty. Use this after a lost publication reply or local cancellation before considering a same-request continuation.'),
  'lineage-cancel':spec(['id'],{id},
    'Request cancellation of this original local publication worker. Returns its unchanged native progress envelope (job_id/state/cancel_requested/observations). Then read lineage-publication for the actual job; accepted collector work remains accepted.'),
  'lineage-downloads':spec(['plan_id'],{plan_id:id},
    'Read and privately retain the exact seven-file native download index for a saved plan. Preserve plan_sha256/index_sha256 and each file sha256/bytes; later receipt history can create a different index. This operation does not publish lineage.'),
  'lineage-file':spec(['plan_id','plan_sha256','index_sha256','filename','sha256'],{
    plan_id:id,plan_sha256:hash,index_sha256:hash,filename:{enum:files},sha256:hash,
    byteOffset:integer,maxBytes:{type:'integer',minimum:1,maximum:65536,default:32768}},
    'Read an original verified file range from the exact selected native index. On first use the host checks the current index, downloads and verifies the complete file (up to 128 MiB), and publishes it privately with the original file helpers. Reopen reuses those exact saved bytes even after newer publication history. Returns unchanged SavedFileReader base64 range under file; continue nextByteOffset until null. The agent supplies no local path.')
});

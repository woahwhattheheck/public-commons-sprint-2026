// SPDX-License-Identifier: MIT
// Source-owned metadata. Listing tools never opens a workspace or starts native work.
import {MAX_RETAINED_CHUNK_BYTES} from '../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[A-Za-z0-9_.:-]{1,160}$'};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const launch={type:'string',pattern:'^[a-f0-9-]{36}$'};
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const text=(maxLength,minLength=0)=>({type:'string',minLength,maxLength});
const object={type:'object'};
const read={readOnly:true,idempotent:true};
const MAX_FILE=2*1024*1024*1024;
const page={offset:integer(),limit:integer(1,100)};
const selectedFile={fileId:sha,expectedSha256:sha};
const artifact={type:'object',additionalProperties:false,
  properties:{projectId:id,kind:{type:'string',enum:['source','plan','replication','comparison','observations','handoff','downstream_plan','downstream','native']},
    id,path:text(2000,1),revision:integer()},
  required:['projectId','kind','id']};

/** The original host's tool factory supplies JSON-RPC schemas and annotations. */
export function replicationTools(tool){
  const scoped=properties=>({workspace:alias,...properties});
  return[
    tool('merchant_replication_status','List declared original workspaces and complete input descriptors, or inspect one client attachment. This does not start or connect an application.',
      scoped({}),[],read),
    tool('merchant_replication_connect','Authenticate the host-declared actor against the exact original managed listener. Optionally bind the expected launch ID; Applications remains the process owner.',
      scoped({expectedLaunchId:launch}),['workspace'],{idempotent:true}),
    tool('merchant_replication_disconnect','Close only this attachment and its retained read handles for the selected launch. Keep original application, workspace, request history and retained files.',
      scoped({launchId:launch}),['workspace','launchId'],{idempotent:true}),
    tool('merchant_replication_browser','Return the original authenticated installation browser address. Its operator login remains private and is not returned as a tool argument or token.',
      scoped({}),['workspace'],read),
    tool('merchant_replication_info','Retain the complete original installation/actor/runtime response and return its SHA-bound file plus readable JSON references.',
      scoped({}),['workspace'],read),
    tool('merchant_replication_projects','Retain the complete original project list, including native state. Follow the returned JSON pointers or read the entire saved file.',
      scoped({}),['workspace'],read),
    tool('merchant_replication_project','Retain a complete current or historical original project at the selected revision, preserving original source, selected plan, native jobs/attempts, complete typed comparison, cutover, downstream edits and named handoff identities. Current reads reconcile already accepted original jobs.',
      scoped({projectId:id,revision:integer()}),['workspace','projectId'],read),
    tool('merchant_replication_create','Create the original customer project. Save and reuse the same request ID, title and notes after uncertainty; the host durably retains the exact actor-bound request before dispatch.',
      scoped({requestId:id,title:text(300,1),notes:text(20000)}),['workspace','requestId','title'],{idempotent:true}),
    tool('merchant_replication_action','Send one original application action with its full payload, project revision and stable request ID. Original source loading, plan review, replication, explicit cancellation/reconciliation, comparison, consumer cutover/rollback, downstream edits and receiving retain their application semantics; replay the identical request after uncertainty.',
      scoped({projectId:id,requestId:id,expectedRevision:integer(),action:text(80,1),payload:object}),
      ['workspace','projectId','requestId','expectedRevision','action','payload'],{idempotent:true,openWorld:true}),
    tool('merchant_replication_requests','Page complete durable original create/action request selections and their retained outcomes, including requests whose HTTP response was lost. Reconnect the same original operator before reading this private history.',
      scoped(page),['workspace'],read),
    tool('merchant_replication_upload_begin','Select an actor-bound original upload using its complete byte count and SHA-256. Exact retries keep the same upload; maximum complete upload is 2 GiB, with the original 32 MiB structured plan-source limit.',
      scoped({uploadId:id,filename:text(240,1),mediaType:text(200,1),bytes:integer(1,MAX_FILE),sha256:sha}),
      ['workspace','uploadId','filename','mediaType','bytes','sha256'],{idempotent:true}),
    tool('merchant_replication_upload_status','Read the original upload descriptor and committed byte offset before resuming the same complete input.',
      scoped({uploadId:id}),['workspace','uploadId'],read),
    tool('merchant_replication_upload_chunk','Commit one exact original upload range with canonical Base64 and SHA-256. Decoded MCP chunks are at most 196608 bytes; repeat only an identical committed range.',
      scoped({uploadId:id,start:integer(),total:integer(1,MAX_FILE),sha256:sha,
        base64:{type:'string',minLength:4,maxLength:4*Math.ceil(MAX_RETAINED_CHUNK_BYTES/3),pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'}}),
      ['workspace','uploadId','start','total','sha256','base64'],{idempotent:true}),
    tool('merchant_replication_upload_finish','Verify and finalize the same original upload against its selected complete SHA-256. Replaying a completed finish preserves the original uploaded object.',
      scoped({uploadId:id}),['workspace','uploadId'],{idempotent:true}),
    tool('merchant_replication_upload_input','Stream one complete host-declared input, verified by its selected SHA-256, into the original actor-bound upload. Uses original 8 MiB chunks and resumes only its committed offset; no model-selected filesystem path.',
      scoped({sourceInput:alias,expectedSourceSha256:sha,uploadId:id}),
      ['workspace','sourceInput','expectedSourceSha256','uploadId'],{idempotent:true}),
    tool('merchant_replication_source_connections','Inspect the original supported Airbyte connection selections from one retained complete structured source and revision. The original parser retains its actual configuration semantics.',
      scoped({projectId:id,sourceId:id,revision:integer()}),['workspace','projectId','sourceId'],read),
    tool('merchant_replication_consumer','Read an actual page from the current selected immutable SQLite consumer database through the original Python adapter. Select the original stream ID and page every row; historical views are separate retained outputs.',
      scoped({projectId:id,streamId:text(2000,1),offset:integer(),limit:integer(1,1000)}),['workspace','projectId'],read),
    tool('merchant_replication_artifact','Retain one complete original source, plan, replication, comparison, observations, named handoff, downstream plan, downstream file or native job file at its exact expected SHA and byte count. Native/downstream select their original safe relative file path. Complete NDJSON, gzip, JSON and binary files stream into custody.',
      scoped({selection:artifact,expectedSha256:sha,expectedBytes:integer(0,MAX_FILE),filename:text(240,1),mediaType:text(200,1)}),
      ['workspace','selection','expectedSha256','expectedBytes'],{idempotent:true}),
    tool('merchant_replication_files','Page the complete retained response/artifact descriptors. Saved bytes remain retained after the listener stops. Reopen and reconnect the original application so current actor and original workspace read permission can be checked before disclosure.',
      scoped(page),['workspace'],read),
    tool('merchant_replication_file','Read exact retained bytes using SHA-256, byte offset and the maintained read ID. Each page is at most 196608 bytes; reconnecting a file after host restart preserves its complete file identity.',
      scoped({...selectedFile,readId:text(200,1),offset:integer(),limit:integer(1,MAX_RETAINED_CHUNK_BYTES)}),
      ['workspace','fileId','expectedSha256'],read),
    tool('merchant_replication_file_release','Close an unfinished retained-file read while keeping the entire saved original file and descriptor.',
      scoped({readId:text(200,1)}),['workspace','readId'],{idempotent:true}),
    tool('merchant_replication_inspect','Inspect a JSON pointer or page up to 50 entries from the exact complete retained JSON response. Structured JSON inspection is bounded at the original32MiB limit; larger whole files remain available through complete byte-range reads. Nested references select the same saved file.',
      scoped({...selectedFile,pointer:text(4000),offset:integer(),limit:integer(1,50)}),
      ['workspace','fileId','expectedSha256'],read)
  ];
}

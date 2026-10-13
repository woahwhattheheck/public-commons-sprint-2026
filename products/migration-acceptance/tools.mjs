// SPDX-License-Identifier: MIT
// Source-owned metadata. Listing tools never opens a workspace or starts native work.
import {MAX_RETAINED_CHUNK_BYTES} from '../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'};
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
  properties:{projectId:id,kind:{type:'string',enum:['source','native','downstream','plan','replication','comparison','observations','handoff']},
    id,path:text(4096,1),revision:integer()},
  required:['projectId','kind','id']};

/** The original host's tool factory supplies JSON-RPC schemas and annotations. */
export function migrationTools(tool){
  const scoped=properties=>({workspace:alias,...properties});
  return[
    tool('merchant_migration_status','List declared original workspaces and complete input descriptors, or inspect one client attachment. This does not start or connect an application.',
      scoped({}),[],read),
    tool('merchant_migration_connect','Authenticate the host-declared actor against the exact original managed listener. Optionally bind the expected launch ID; Applications remains the process owner.',
      scoped({expectedLaunchId:launch}),['workspace'],{idempotent:true}),
    tool('merchant_migration_disconnect','Close only this attachment and its retained read handles for the selected launch. Keep original application, workspace, request history and retained files.',
      scoped({launchId:launch}),['workspace','launchId'],{idempotent:true}),
    tool('merchant_migration_browser','Return the original authenticated installation browser address. Its operator login remains private and is not returned as a tool argument or token.',
      scoped({}),['workspace'],read),
    tool('merchant_migration_info','Retain the complete original installation/actor/runtime response and return its SHA-bound file plus readable JSON references.',
      scoped({}),['workspace'],read),
    tool('merchant_migration_projects','Retain the complete original project list, including native state. Follow the returned JSON pointers or read the entire saved file.',
      scoped({}),['workspace'],read),
    tool('merchant_migration_project','Retain a complete current or historical original project at the selected revision, preserving all source, plan, native, comparison, acceptance, cutover and handoff identities.',
      scoped({projectId:id,revision:integer()}),['workspace','projectId'],read),
    tool('merchant_migration_create','Create the original customer project. Save and reuse the same request ID, title and notes after uncertainty; the host durably retains the exact actor-bound request before dispatch.',
      scoped({requestId:id,title:text(300,1),notes:text(20000)}),['workspace','requestId','title'],{idempotent:true}),
    tool('merchant_migration_action','Send one original application action with its full payload, project revision and stable request ID. Native jobs, acceptance decisions, cutover and receiving retain their original application semantics; replay the identical request after uncertainty.',
      scoped({projectId:id,requestId:id,expectedRevision:integer(),action:text(200,1),payload:object}),
      ['workspace','projectId','requestId','expectedRevision','action','payload'],{idempotent:true,openWorld:true}),
    tool('merchant_migration_requests','Page complete durable original create/action request selections and their retained outcomes, including requests whose HTTP response was lost. Available without a running application.',
      scoped(page),['workspace'],read),
    tool('merchant_migration_upload_begin','Select an actor-bound original upload using its complete byte count and SHA-256. Exact retries keep the same upload; maximum complete file is 2 GiB.',
      scoped({uploadId:id,filename:text(240,1),mediaType:text(200,1),bytes:integer(1,MAX_FILE),sha256:sha}),
      ['workspace','uploadId','filename','mediaType','bytes','sha256'],{idempotent:true}),
    tool('merchant_migration_upload_status','Read the original upload descriptor and committed byte offset before resuming the same complete input.',
      scoped({uploadId:id}),['workspace','uploadId'],read),
    tool('merchant_migration_upload_chunk','Commit one exact original upload range with canonical Base64 and SHA-256. Decoded MCP chunks are at most 196608 bytes; repeat only an identical committed range.',
      scoped({uploadId:id,start:integer(),total:integer(1,MAX_FILE),sha256:sha,
        base64:{type:'string',minLength:4,maxLength:4*Math.ceil(MAX_RETAINED_CHUNK_BYTES/3),pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'}}),
      ['workspace','uploadId','start','total','sha256','base64'],{idempotent:true}),
    tool('merchant_migration_upload_finish','Verify and finalize the same original upload against its selected complete SHA-256. Replaying a completed finish preserves the original uploaded object.',
      scoped({uploadId:id}),['workspace','uploadId'],{idempotent:true}),
    tool('merchant_migration_upload_input','Stream one complete host-declared input, verified by its selected SHA-256, into the original actor-bound upload. Uses original 8 MiB chunks and resumes only its committed offset; no model-selected filesystem path.',
      scoped({sourceInput:alias,expectedSourceSha256:sha,uploadId:id}),
      ['workspace','sourceInput','expectedSourceSha256','uploadId'],{idempotent:true}),
    tool('merchant_migration_consumer','Retain an exact page of the currently selected native customer relation, including its cutover/rollback binding. Preserve literal stream IDs, typed values, nulls and all rows across pages.',
      scoped({projectId:id,streamId:{anyOf:[text(4000,1),object]},offset:integer(),limit:integer(1,1000)}),
      ['workspace','projectId'],read),
    tool('merchant_migration_artifact','Retain one complete original source, native file, downstream file, plan, replication, comparison, observation or named handoff at its exact expected byte count and SHA-256. Large files stream to retained custody.',
      scoped({selection:artifact,expectedSha256:sha,expectedBytes:integer(0,MAX_FILE),filename:text(240,1),mediaType:text(200,1)}),
      ['workspace','selection','expectedSha256','expectedBytes'],{idempotent:true}),
    tool('merchant_migration_files','Page the complete retained response/artifact descriptors. Available after the original listener stops; no original byte content is discarded.',
      scoped(page),['workspace'],read),
    tool('merchant_migration_file','Read exact retained bytes using SHA-256, byte offset and the maintained read ID. Each page is at most 196608 bytes; reconnecting a file after host restart preserves its complete file identity.',
      scoped({...selectedFile,readId:text(200,1),offset:integer(),limit:integer(1,MAX_RETAINED_CHUNK_BYTES)}),
      ['workspace','fileId','expectedSha256'],read),
    tool('merchant_migration_file_release','Close an unfinished retained-file read while keeping the entire saved original file and descriptor.',
      scoped({readId:text(200,1)}),['workspace','readId'],{idempotent:true}),
    tool('merchant_migration_inspect','Inspect a JSON pointer or page up to 50 entries from the exact complete retained JSON response. Nested references point into the same saved file; full byte reads remain available.',
      scoped({...selectedFile,pointer:text(4000),offset:integer(),limit:integer(1,50)}),
      ['workspace','fileId','expectedSha256'],read)
  ];
}

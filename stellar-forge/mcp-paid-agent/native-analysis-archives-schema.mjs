// SPDX-License-Identifier: MIT
// Pure schemas for the original portable Analysis workspace operations.
const id={type:'string',pattern:'^[a-f0-9]{32}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const nonnegative={type:'integer',minimum:0};
const limit={type:'integer',minimum:1,maximum:100};
const include={type:'boolean',description:'Include earlier original SQLite backup files. Earlier portable ZIPs remain separately retained.'};
const spec=(required,properties,description)=>({required,properties,description});

export const nativeArchiveOperations=Object.freeze({
  'workspace-archive-review':spec([],{include_previous_backups:include,offset:nonnegative,limit},
    'Review the complete original workspace export selection and missing retained outputs. Output, exclusion and missing arrays are independently paged; ready describes the whole original selection. No query or acquisition.'),
  'workspace-export':spec(['id'],{id,include_previous_backups:include},
    'Export the original workspace database, completed query exports, reports and workbook history. Retain this exact request/id; replay returns completion or resumes the same interrupted original snapshot.'),
  'workspace-archives':spec([],{before:{type:'integer',minimum:1},limit},
    'Page original portable workspace export jobs and progress using their next_before sequence.'),
  'cancel-workspace-export':spec(['id'],{id},
    'Request cancellation of the original workspace export. Reopen this job; an exact later workspace-export request resumes its retained snapshot.'),
  'workspace-archive-file':spec(['id','filename','manifest_sha256','sha256'],{
    id,filename:{enum:['workspace.zip','archive-manifest.json']},manifest_sha256:hash,sha256:hash,
    byteOffset:nonnegative,maxBytes:{type:'integer',minimum:1,maximum:65536}},
    'Read a verified range from a COMPLETE original workspace archive. Pin its original manifest/file digests. The current host-selected customer database owns local paths, including after receiving; producer paths remain provenance.')
});

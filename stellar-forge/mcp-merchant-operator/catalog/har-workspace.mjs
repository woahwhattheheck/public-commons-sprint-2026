// MIT. Original tool metadata; provider runtimes load only when selected.
import { HAR_EXPORT_FILES } from '../har-export-contracts.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const SHA=/^[a-f0-9]{64}$/;

const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

const alias={type:'string',pattern:ALIAS.source};

const digest={type:'string',pattern:SHA.source};

const selection={type:'object',properties:{kind:{type:'string',enum:['capture','refresh']},id:digest,revision:digest},required:['kind','id'],additionalProperties:false};

const scope={workspace:alias};

const pick={...scope,selection};

const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},expectedSnapshot:digest};

const read={readOnly:true,idempotent:true};

const requestPlan={plan:{type:'object'},file:alias,expectedSha256:digest};

function harWorkspaceTools(tool) {
  return [
    tool('merchant_har_workspaces','List declared original HAR consoles, private file/import/receiving aliases and retained read sessions.',{},[],read),
    tool('merchant_har_status','Read the authenticated original merchant console and source-library counts; reconnect a console against its declared projects directory.',scope,['workspace'],read),
    tool('merchant_har_files','List declared capture, decision and merchant-plan files, or inspect one stable file and its exact SHA256 before intake.',{...scope,file:alias},['workspace'],read),
    tool('merchant_har_library','Page the original retained captures and refresh packets; pass the returned next cursor as after.',{...scope,after:{type:'string'},limit:page.limit},['workspace'],read),
    tool('merchant_har_inspect','Read original source identity and page immutable reviews. Use changes, groups and review for their complete paged native records.',{...pick,after:digest,limit:page.limit},['workspace','selection'],read),
    tool('merchant_har_groups','Page original decoder observations from an exact retained capture. Large original rows remain available through inventory export.',{...pick,...page},['workspace','selection'],read),
    tool('merchant_har_changes','Page the complete native refresh comparison, including dormant and ambiguous source records.',{...pick,kind:{type:'string',enum:['operations','ambiguous']},...page},['workspace','selection'],read),
    tool('merchant_har_review','Read complete review metadata and page its original operations. Without revision, returns the original new draft or refresh draft.',{...pick,...page},['workspace','selection'],read),
    tool('merchant_har_ingest','Send the exact declared HAR file to the original console. Select a previous saved review to prepare a subsequent source edition.',{...scope,file:alias,expectedSha256:digest,label:{type:'string',minLength:1,maxLength:160},previous:selection},['workspace','file','expectedSha256'],{idempotent:true}),
    tool('merchant_har_adopt','Adopt an existing host-declared native capture or whole refresh directory, preserving original source and immutable reviews.',{...scope,source:alias,label:{type:'string',minLength:1,maxLength:160}},['workspace','source'],{idempotent:true}),
    tool('merchant_har_decisions_save','Save the complete native decision document as its original immutable review. Choose one inline review or declared complete decision file and its SHA256.',{...pick,review:{type:'object'},file:alias,expectedSha256:digest},['workspace','selection'],{idempotent:true}),
    tool('merchant_har_source','Read approved source binding, lineage and paged merchant operation seeds. Retain exact complete OpenAPI through export.',{...pick,...page},['workspace','selection'],read),
    tool('merchant_har_plan','Apply the browser’s original unchanged-route carry to an existing saved merchant plan. The exact prior source/review controls which prices and transport settings carry.',{...pick,packageName:{type:'string'}},['workspace','selection','packageName'],read),
    tool('merchant_har_preview','Validate exact approved source/routes and the complete reviewed merchant plan through the original authenticated preview.',{...pick,...requestPlan},['workspace','selection'],read),
    tool('merchant_har_save','Save the reviewed source and complete merchant plan through the original HAR merchant compiler. Repeated completed identical package names reopen their original output.',{...pick,...requestPlan,name:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'}},['workspace','selection','name'],{idempotent:true}),
    tool('merchant_har_packages','Page saved original merchant packages, including results recovered after an interrupted save reply.',{...scope,...page},['workspace'],read),
    tool('merchant_har_load','Reopen a saved original merchant package and reconnect its exact retained capture/review binding.',{...scope,name:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'}},['workspace','name'],read),
    tool('merchant_har_copy','Copy the complete original source and every saved review to one declared receiving directory. A completed equal copy accepts later immutable reviews and reopens after an interrupted reply.',{...pick,destination:alias},['workspace','selection','destination'],{idempotent:true}),
    tool('merchant_har_receive','Adopt the complete original source selected in another declared workspace into this receiving console. Native copy includes both refresh editions and all immutable reviews.',{...scope,fromWorkspace:alias,selection,label:{type:'string',minLength:1,maxLength:160}},['workspace','fromWorkspace','selection'],{idempotent:true}),
    tool('merchant_har_export','Retain an original reviewer, inventory, decisions, draft, comparison or approved OpenAPI file once for resumable verified delivery.',{...pick,kind:{type:'string',enum:Object.keys(HAR_EXPORT_FILES)}},['workspace','selection','kind'],{idempotent:true}),
    tool('merchant_har_exports','Page complete retained HAR exports after console or MCP restart.',{...scope,...page},['workspace'],read),
    tool('merchant_har_export_manifest','Read the immutable completion manifest for one retained native HAR file.',{exportId:digest},['exportId'],read),
    tool('merchant_har_export_file','Read exact retained native bytes with the original snapshot reader. Repeat manifest SHA, file SHA, readId and nextOffset; reopen expired reads at the saved byte offset.',{exportId:digest,file:{type:'string'},expectedManifestSha256:digest,expectedSha256:digest,readId:{type:'string',pattern:UUID.source},offset:page.offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['exportId','file','expectedManifestSha256'],read),
    tool('merchant_har_export_file_release','Release one temporary native read while preserving its complete original export.',{exportId:digest,readId:{type:'string',pattern:UUID.source}},['exportId','readId'],{idempotent:true}),
  ];
}

export { harWorkspaceTools, read, scope, alias, page, pick, digest, selection, requestPlan, UUID, ALIAS, SHA };

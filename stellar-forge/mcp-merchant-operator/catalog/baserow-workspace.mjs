// MIT. Original tool metadata; provider runtimes load only when selected.
import { BASEROW_PUBLISHER_READ_ACTIONS, BASEROW_PUBLISHER_WRITE_ACTIONS } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/publisher-contracts.mjs';

const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;

const HASH=/^[a-f0-9]{64}$/;

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

const V4=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

const alias={type:'string',pattern:ALIAS.source};

const id={type:'string',pattern:UUID.source};

const v4={type:'string',pattern:V4.source};

const hash={type:'string',pattern:HASH.source};

const object={type:'object'};

const positive={type:'integer',minimum:1};

const revision={type:'integer',minimum:0};

const scope={workspace:alias};

const page={offset:revision,limit:{type:'integer',minimum:1,maximum:100}};

const read={readOnly:true,idempotent:true};

const write={idempotent:true,openWorld:true};

const publisherActions=['open','close',...BASEROW_PUBLISHER_READ_ACTIONS,...BASEROW_PUBLISHER_WRITE_ACTIONS];

const deploymentActions=['status','package','compare','review','prepare','stage','open','close','command'];

function baserowWorkspaceTools(tool) {
  return [
    tool('merchant_baserow_workspaces','List declared original Baserow source consoles, packet inputs and merchant/runtime profile names. Browser and agent share the same saved source and publisher.',{},[],read),
    tool('merchant_baserow_status','Read the current native source draft/revision/selection, captures, versions, discovery pages and pending requests. Private browser credentials remain on the host.',{...scope,limit:page.limit,capturesOffset:revision,versionsOffset:revision,discoveriesOffset:revision},['workspace'],read),
    tool('merchant_baserow_input','Inspect one complete host-declared source packet and its original byte count/SHA256 before importing it.',{...scope,file:alias},['workspace','file'],read),
    tool('merchant_baserow_discover','Inspect an actual public grid or authorized table through an existing Baserow connectionAlias. input retains slug/tableId/viewId/filter/search and a stable requestId. Saved discovery preserves native field IDs/types and full source selection.',{...scope,input:object},['workspace','input'],write),
    tool('merchant_baserow_discovery','Read the original saved discovery including full fields, view selection and actual source metadata.',{...scope,id},['workspace','id'],read),
    tool('merchant_baserow_capture','Capture all original pages and selected attachment bytes. input requires discoveryId, connectionAlias, explicit orderBy, queries, attachments, title, expectedDraftRevision and one requestId. Reconcile the same request after interruption.',{...scope,input:object},['workspace','input'],write),
    tool('merchant_baserow_capture_read','Read complete native record pages, file descriptors, source schema or a retained interrupted capture attempt. For a complete capture, pin expectedCaptureSha256 and continue nextOffset to null. Exact number tokens and structured values remain complete.',{...scope,id,kind:{enum:['rows','files','schema','attempt']},expectedCaptureSha256:hash,...page},['workspace','id','kind'],read),
    tool('merchant_baserow_draft','Save the complete public query/projection draft against its original expectedRevision. Keep source field IDs, explicit scalar encodings, nullable values and original requestId.',{...scope,draft:object,expectedRevision:revision,requestId:id},['workspace','draft','expectedRevision','requestId'],write),
    tool('merchant_baserow_preview','Validate every original captured row against this exact draftRevision, producing the native preview ID and complete reports.',{...scope,draftRevision:revision,requestId:id},['workspace','draftRevision','requestId'],write),
    tool('merchant_baserow_version','Read, review/save or select an original source version. Save input contains draftRevision, previewId, reviewer, note, expectedSelectedVersion and requestId; select uses versionId, expectedSelectedVersion and requestId.',{...scope,action:{enum:['read','save','select']},id:positive,input:object},['workspace','action'],write),
    tool('merchant_baserow_compare','Compare the complete schemas and retained dataset results of two original saved source versions.',{...scope,left:positive,right:positive},['workspace','left','right'],read),
    tool('merchant_baserow_publisher','Operate the same original publisher and scheduler used by the source browser. Open/close use a source requestId; reads use input; writes require current expectedSelectedVersion and requestId. Extract additionally pins planId/planDigest and an explicit runId. Native review IDs, target revisions and buyer handoff records remain authoritative.',{...scope,action:{enum:publisherActions},input:object,expectedSelectedVersion:positive,requestId:id},['workspace','action'],write),
    tool('merchant_baserow_deployment','Review and prepare the original merchant package, stage it into this source workspace SF82 store, and operate that same native release console. Review selects host termsProfile; stage selects host runtimeProfile. Other inputs preserve native review/request IDs, source hashes, console instance and release generation.',{...scope,action:{enum:deploymentActions},input:object},['workspace','action'],write),
    tool('merchant_baserow_operation','Inspect the exact source request after a lost reply; resume:true reconciles that original request. Current publisher/run state remains available through publisher reads.',{...scope,requestId:id,resume:{type:'boolean'}},['workspace','requestId'],write),
    tool('merchant_baserow_import','Receive a complete original source packet from one declared file alias or retained source export. Pin its original SHA256, title, expectedDraftRevision and requestId. Receiving reuses all captured rows/files and original source metadata.',{...scope,file:alias,exportId:v4,expectedSha256:hash,title:{type:'string',maxLength:128},expectedDraftRevision:revision,requestId:id},['workspace','expectedSha256','title','expectedDraftRevision','requestId'],write),
    tool('merchant_baserow_export','Retain an entire native capture/version packet, original five-file merchant deployment, combined handoff, or one original attachment. Choose a stable exportId and exact selection hashes. Repeating that ID recovers the same retained files.',{...scope,exportId:v4,selection:object},['workspace','exportId','selection'],write),
    tool('merchant_baserow_exports','Page original complete and preparing exports, including lost initial replies. Continue the returned expectedSnapshot with offset.',{...scope,...page,expectedSnapshot:hash},['workspace'],read),
    tool('merchant_baserow_export_manifest','Read a retained completion manifest and its SHA256. The complete original files remain available with the source browser closed.',{exportId:v4},['exportId'],read),
    tool('merchant_baserow_export_file','Read an original retained file in SHA-pinned base64 ranges. Repeat manifest/file hashes and readId; use nextOffset until null. Large source packets stream once into the shared private snapshot.',{exportId:v4,file:{type:'string',maxLength:80},expectedManifestSha256:hash,expectedSha256:hash,readId:v4,offset:revision,limit:{type:'integer',minimum:1,maximum:196608}},['exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_baserow_export_file_release','Release the temporary original download snapshot while retaining its source export for later receiving.',{exportId:v4,readId:v4},['exportId','readId'],{idempotent:true}),
  ];
}

export { baserowWorkspaceTools, read, scope, page, revision, alias, object, write, id, hash, positive, publisherActions, deploymentActions, v4, ALIAS, UUID, HASH, V4 };

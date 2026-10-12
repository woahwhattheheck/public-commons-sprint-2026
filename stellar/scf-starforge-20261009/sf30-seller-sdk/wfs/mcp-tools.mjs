// MIT. Source-owned tools for the complete WFS application and original customer engines.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const op={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'},object={type:'object'};
const workspace={workspace:alias},recorded={...workspace,id:op,expectedRevision:{type:'integer',minimum:0}};
const publication={...workspace,publicationId:hash};
const text={type:'string',maxLength:16384},name={type:'string',minLength:1,maxLength:128};
const read={readOnly:true,idempotent:true},change={idempotent:true};
const collections=['sources','schemas','queries','orders','comparisons','publications','operations'];
export const wfsFileSelection={kind:{type:'string',enum:['capabilities','schema','raw-page','features','comparison','project','customer','dataset']},
  sourceId:hash,schemaId:hash,orderId:hash,index:{type:'integer',minimum:0},comparisonId:hash,publicationId:hash,intentId:op,id:op,
  file:{type:'string',enum:['dataset.csv','dataset.jsonl','review.html','manifest.json','semantics.json']}};
export function wfsWorkspaceTools(tool){return[
  tool('merchant_wfs_workspaces','List configured WFS projects and merchant profiles.',{},[],read),
  tool('merchant_wfs_status','Read the project identity, revision, current operation, merchant and customer state.',workspace,['workspace'],read),
  tool('merchant_wfs_records','Page all original project records at a pinned revision. Follow nextOffset.',{
    ...workspace,kind:{type:'string',enum:collections},expectedRevision:{type:'integer',minimum:0},offset:{type:'integer',minimum:0},
    limit:{type:'integer',minimum:1,maximum:100}},['workspace','kind','expectedRevision'],read),
  tool('merchant_wfs_record','Read one complete original source, schema, query, order, comparison, publication or operation.',{
    ...workspace,kind:{type:'string',enum:collections},id:{type:'string',minLength:1,maxLength:96},
    expectedRevision:{type:'integer',minimum:0}},['workspace','kind','id','expectedRevision'],read),
  tool('merchant_wfs_query','Read catalog pages, feature schemas, order coverage, feature pages, export plans, comparisons, publications or original dataset previews.',{
    ...workspace,kind:{type:'string',enum:['catalog','schema','order','features','inspection','plan','comparison','publication','preview']},input:object},
    ['workspace','kind'],read),
  tool('merchant_wfs_discover','Capture the complete original GetCapabilities document under one retained operation.',{
    ...recorded,endpoint:text,name,terms:text,allowLoopback:{type:'boolean'}},['workspace','id','expectedRevision','endpoint','name'],change),
  tool('merchant_wfs_describe','Capture the original DescribeFeatureType schema for an advertised feature type.',{
    ...recorded,sourceId:hash,typeName:name},['workspace','id','expectedRevision','sourceId','typeName'],change),
  tool('merchant_wfs_save_query','Save an advertised WFS2 feature type, exact CRS spelling, explicit stable sort, page size and optional bbox/CQL filter.',{
    ...recorded,sourceId:hash,schemaId:hash,name,selection:object},['workspace','id','expectedRevision','sourceId','schemaId','name','selection'],change),
  tool('merchant_wfs_download_order','Acquire every original response page for a saved query. Continue the same operation after interruption; limits may increase while preserving its accepted prefix.',{
    ...recorded,queryId:hash,name,limits:object},['workspace','id','expectedRevision','queryId','name'],change),
  tool('merchant_wfs_compare','Compare complete editions by an explicit source key. Duplicate and missing keys remain separate; retain the exact selected CRS representation.',{
    ...recorded,before:hash,after:hash,keyPointer:text},['workspace','id','expectedRevision','before','after'],change),
  tool('merchant_wfs_export','Export a complete original order through the maintained dataset publisher and retain every original source page.',{
    ...recorded,orderId:hash,plan:object},['workspace','id','expectedRevision','orderId'],change),
  tool('merchant_wfs_publish','Publish a complete original order with a configured merchant profile. The native source product is the whole selected project at merchant staging.',{
    ...recorded,orderId:hash,plan:object,profile:alias},['workspace','id','expectedRevision','orderId','profile'],change),
  tool('merchant_wfs_abandon','Record explicit abandonment of an unfinished source operation while keeping all retained source files.',{
    ...recorded,pendingId:op,note:name},['workspace','id','expectedRevision','pendingId','note'],change),
  tool('merchant_wfs_input','Inspect the exact complete project file selected by its host alias.',{...workspace,input:alias},['workspace','input'],read),
  tool('merchant_wfs_import','Receive an exact host-selected complete project and preserve its original identities.',{
    ...workspace,input:alias,expectedSha256:hash},['workspace','input','expectedSha256'],change),
  tool('merchant_wfs_merchant','Start or stop the selected original merchant; open displays the original dataset query workspace.',{
    ...publication,action:{type:'string',enum:['start','stop','open']}},['workspace','publicationId','action'],change),
  tool('merchant_wfs_purchase','Prepare, execute or recover the same original paid request. Preserve the previous native page for cursor continuation.',{
    ...publication,action:{type:'string',enum:['prepare','buy','recover']},intentId:op,query:text,kind:{type:'string',enum:['rows','sources']},
    file:{type:'string',maxLength:128},previous:object,acceptIndex:{type:'integer',minimum:0}},['workspace','publicationId','action','intentId'],change),
  tool('merchant_wfs_dataset','Run the original complete Dataset through prepare/create/run/inspect/recover/accounting/finalize/deliver/source receive and offline WFS project reopen.',{
    ...publication,id:op,action:{type:'string',enum:['prepare','create','run','inspect','recover','accounting','finalize','deliver','receive','reopen','open']},
    kind:{type:'string',enum:['rows','sources']},query:text,maxPages:{type:'integer',minimum:1,maximum:4096},
    maxRows:{type:'integer',minimum:1,maximum:1000000},maxTotalAtomic:{type:'string',pattern:'^[1-9][0-9]{0,38}$'},
    acceptIndex:{type:'integer',minimum:0}},['workspace','publicationId','id','action'],change),
  tool('merchant_wfs_cancel','Cancel the exact running application action and retain its original recovery record.',{...workspace,id:op},['workspace','id'],change),
  tool('merchant_wfs_file_read','Read a complete original source, feature export, comparison, project or customer file in verified chunks. Retain expectedSha256 and offset across restarts.',{
    ...workspace,...wfsFileSelection,readId:{type:'string',minLength:1,maxLength:128},expectedSha256:hash,
    offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','kind'],read),
  tool('merchant_wfs_file_release','Release an existing retained read.',{...workspace,readId:{type:'string',minLength:1,maxLength:128}},['workspace','readId'],change)
];}

// MIT. Source-owned GTFS tool metadata over the maintained publisher contract.
import { publisherTools } from '../../../../stellar-forge/mcp-merchant-operator/catalog/publisher.mjs';
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const revision={type:'integer',minimum:0};
const text={type:'string',minLength:1,maxLength:128};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const selected={workspace:alias};
const paged={limit:{type:'integer',minimum:1,maximum:100},offset:revision};
const read={readOnly:true,idempotent:true};
const request={...selected,requestId:uuid,expectedRevision:revision};
const kind={enum:['feed','edition','comparison','decision','release','archive']};
const list={type:'array',items:{type:'string'},uniqueItems:true,maxItems:10000};
const authority=schema(Object.fromEntries(['sourceUrl','licenseUrl','licenseName','attribution','retrievedAt'].map(name=>
  [name,{type:'string',maxLength:4096}])));
const recipe=schema({
  schema:{const:'stellar-forge.gtfs-selection.v1'},title:text,feedSha256:hash,
  startDate:{type:'string',maxLength:10},endDate:{type:'string',maxLength:10},
  agencyIds:list,routeIds:list,tables:{...list,maxItems:64},includeSchedule:{type:'boolean'},
  authority,note:{type:'string',maxLength:4000},
},['schema','title','feedSha256']);
const fileSelector={...selected,kind,id:uuid,file:{type:'string',minLength:1,maxLength:2048},expectedSha256:hash,
  readId:uuid,offset:revision,limit:{type:'integer',minimum:1,maximum:65536}};

export function gtfsWorkspaceTools(tool) {
  const action=(name,description,payload)=>tool('merchant_gtfs_'+name,description,
    {...request,payload},['workspace','requestId','expectedRevision','payload'],{idempotent:true});
  return [
    tool('merchant_gtfs_workspaces','List original host-declared GTFS workspace aliases, canonical UUIDs, inputs and current ownership. No workspace, source parser or scheduler starts.',{},[],read),
    tool('merchant_gtfs_open','Open this original private GTFS workspace and its same publisher/scheduler/browser under the native lease. Previously enabled schedules resume. A separate CLI or Application must close first; reopening this process-owned alias returns the same instance.',selected,['workspace'],{idempotent:true}),
    tool('merchant_gtfs_close','Drain this exact owned GTFS browser/model, original publisher/scheduler and file reads; release its original lease. Saved feeds, editions, decisions, archives and publication histories remain.',
      {...selected,instanceId:uuid},['workspace','instanceId'],{destructive:true}),
    tool('merchant_gtfs_status','Read current native revision, pending request and complete paginated source/edition/comparison/decision/release/export histories. The original publisher and scheduler retain their native IDs.',
      {...selected,limit:paged.limit,...Object.fromEntries(['feedsOffset','editionsOffset','comparisonsOffset','decisionsOffset','releasesOffset','exportsOffset'].map(k=>[k,revision]))},['workspace'],read),
    tool('merchant_gtfs_inputs','List declared original ZIP inputs, or inspect one exact complete file for byte count and SHA-256 before import.',
      {...selected,input:alias},['workspace'],read),
    tool('merchant_gtfs_import','Retain the exact host-declared complete ZIP and every original member. Bind expectedSha256 and expectedBytes to the same actual read. An identical saved request recovers before requiring the host file again.',
      {...request,input:alias,title:text,expectedSha256:hash,expectedBytes:{type:'integer',minimum:1,maximum:16777216}},
      ['workspace','requestId','expectedRevision','input','title','expectedSha256','expectedBytes'],{idempotent:true}),
    tool('merchant_gtfs_feed','Reopen the complete original feed inspection, table/member hashes, calendar bounds, agencies, routes and publication limits.',
      {...selected,id:uuid},['workspace','id'],read),
    tool('merchant_gtfs_source_rows','Search/page any original source table without truncating the retained feed. Original row numbers and physical values stay unchanged; agency/route catalog limits are explicit.',
      {...selected,feedId:uuid,resource:{type:'string',maxLength:256},...paged,query:{type:'string',maxLength:1000}},
      ['workspace','feedId','resource'],read),
    action('edition_create','Compile a saved original feed into an immutable selection of complete source tables and exact dated trips/calls/frequency windows, retaining its complete ZIP and native capture. Select dates/routes within the original per-resource row ceiling.',
      schema({feedId:uuid,recipe},['feedId','recipe'])),
    tool('merchant_gtfs_edition','Reopen one exact retained edition and its original resource/source/capture hashes.',
      {...selected,id:uuid},['workspace','id'],read),
    tool('merchant_gtfs_rows','Search/page retained physical rows from an immutable edition resource with their exact original or derived values.',
      {...selected,editionId:uuid,resource:{type:'string',maxLength:256},...paged,query:{type:'string',maxLength:1000}},
      ['workspace','editionId','resource'],read),
    action('compare','Compare two immutable original editions by their exact saved hashes and declared source keys. Retain the full change stream and original package comparison; unchanged/source-only/unkeyed results remain explicit.',
      schema({beforeId:uuid,afterId:uuid,beforeSha256:hash,afterSha256:hash},['beforeId','afterId','beforeSha256','afterSha256'])),
    tool('merchant_gtfs_comparison','Reopen the retained whole comparison and its original changed-row file identity.',
      {...selected,id:uuid},['workspace','id'],read),
    action('decision','Save an operator decision on the exact inspected edition or comparison. The record retains reviewer and note; selection remains its separate explicit operation.',
      schema({subject:schema({kind:{enum:['edition','comparison']},id:uuid,sha256:hash},['kind','id','sha256']),
        verdict:{enum:['accept','reject','defer']},reviewer:{type:'string',minLength:1,maxLength:128},note:{type:'string',minLength:1,maxLength:4000}},
      ['subject','verdict','reviewer','note'])),
    action('select','Select an exact saved edition for subsequent original publisher plans. Earlier plans retain their original captures and identities; publication still uses the native review and target revision.',
      schema({editionId:uuid,editionSha256:hash},['editionId','editionSha256'])),
    tool('merchant_gtfs_operation','Read the exact saved original request, its result or pending retained input. A read does not rerun source parsing or publication.',
      {...selected,requestId:uuid},['workspace','requestId'],read),
    tool('merchant_gtfs_recover','Continue only this retained pending native request using its original payload. A completed request returns its original receipt. If the original ZIP was not fully retained, repeat import with the same UUID and inspected bytes.',
      {...selected,requestId:uuid},['workspace','requestId'],{idempotent:true}),
    tool('merchant_gtfs_plan_template','Create an editable original publisher plan in the response for the current selected GTFS resource, preserving physical types and its complete row count. Save the reviewed plan with merchant_gtfs_publisher_plan_save.',
      {...selected,query:{type:'string',minLength:1,maxLength:256}},['workspace','query'],read),
    action('release_prepare','Prepare the complete original SF82 merchant release from an actually published native run, exact payment terms and public origin. Source/capture/dataset/seller files remain in one retained package.',
      schema({runId:uuid,payment:{type:'object'},origin:{type:'string',minLength:1,maxLength:4096},path:{type:'string',maxLength:2048}},['runId','payment','origin'])),
    action('release_stage','Stage this exact retained release package through the host-declared original SF82 store. Preserve its original release ID, label and runtime settings across same-request recovery.',
      schema({releaseId:uuid,releaseSha256:hash,id:{type:'string',minLength:1,maxLength:128},label:{type:'string',maxLength:240},
        runtime:schema({port:{type:'integer',minimum:0,maximum:65535},facilitator:{type:'string'},allowLocalFacilitator:{type:'boolean'}})},
      ['releaseId','releaseSha256','id'])),
    tool('merchant_gtfs_export','Export the complete quiescent original workspace, including ZIPs/captures, plans/runs/schedules, decisions, releases and all dataset versions. The external export journal retains its request/revision before compression and recovers the same archive after a lost reply.',
      request,['workspace','requestId','expectedRevision'],{idempotent:true}),
    tool('merchant_gtfs_manifest','Page one complete retained artifact manifest. Retain its full manifest SHA-256 and original file byte counts/SHA-256 before downloading each file.',
      {...selected,kind,id:uuid,...paged,expectedManifestSha256:hash},['workspace','kind','id'],read),
    tool('merchant_gtfs_file_read','Read the exact original retained file in bounded 64 KiB chunks through the maintained file reader. Continue the same readId and offset, or resume the same file SHA/offset after read expiry. No archive is buffered wholesale.',
      fileSelector,['workspace','kind','id','file','expectedSha256'],read),
    tool('merchant_gtfs_file_release','Release this original reader identity after interrupted or completed transfer; retained source and archives remain.',
      {...selected,readId:uuid},['workspace','readId'],read),
    ...publisherTools((name,description,properties,required,annotations)=>{
      if(['merchant_publishers','merchant_publisher_open','merchant_publisher_close'].includes(name))return null;
      const {publisher,...input}=properties;
      return tool(name.replace('merchant_publisher_','merchant_gtfs_publisher_'),
        'Use this SAME open GTFS workspace publisher and scheduler. '+description,
        {...selected,...input},required.map(key=>key==='publisher'?'workspace':key),annotations);
    }).filter(Boolean),
  ];
}

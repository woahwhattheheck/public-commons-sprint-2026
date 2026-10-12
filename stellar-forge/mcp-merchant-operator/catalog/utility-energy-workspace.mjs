// MIT. Lightweight catalog for the original UtilityAPI / Green Button operator.
export const utilityEnergyActionNames = Object.freeze([
  'analysis.preview','review.save','edition.build','edition.compare','dataset.query',
  'bills.reconcile','capture.advance','capture.pause','capture.resume','merchant.configure','package.export',
  'publisher.status','publisher.prepare','publisher.preview','publisher.reviewDraft','publisher.publish',
  'publisher.activateSnapshot','publisher.collect','publisher.release.stage','publisher.release.inspect',
  'publisher.release.activate','publisher.release.rollback','publisher.release.start','publisher.release.stop',
  'publisher.buyer.review','publisher.buyer.prepare','publisher.buyer.run','publisher.buyer.recover',
  'publisher.buyer.account','publisher.buyer.export'
]);
export const utilityEnergyPublisherKinds = Object.freeze([
  'draft-csv','draft-review','buyer-config','session-manifest','session-csv','session-jsonl','session-review'
]);
export const utilityEnergyInventoryKinds = Object.freeze([
  'imports','previews','reviews','reconciliations','captures','exports','sources','plans','builds',
  'comparisons','received_export_manifests','operations'
]);
export const utilityEnergyInspectKinds = Object.freeze([
  'import','record','preview','review','reconciliation','capture','build','export'
]);
export function utilityEnergyWorkspaceTools(tool) {
  const alias = { type:'string', pattern:'^[a-z0-9][a-z0-9_-]{0,63}$' };
  const digest = { type:'string', pattern:'^[0-9a-f]{64}$' };
  const uuid = { type:'string', pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
  const integer = { type:'integer', minimum:0 };
  const workspace = { workspace:alias };
  const page = { offset:integer, limit:{type:'integer',minimum:1,maximum:250}, expectedSnapshot:digest };
  const mutation = { expectedRevision:integer, requestId:uuid };
  const read = { readOnlyHint:true, destructiveHint:false, openWorldHint:false };
  const action = { readOnlyHint:false, destructiveHint:false, openWorldHint:false };
  const file = { type:'string',minLength:1,maxLength:512 };
  const source = { type:'object',additionalProperties:false,properties:{
    kind:{enum:['delivery','workspace','export-file','original','changes','native-project','publisher']},
    exportId:digest, name:file, id:{type:'string',pattern:'^(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'}, publisherKind:{enum:utilityEnergyPublisherKinds}
  },required:['kind'] };
  return [
    tool('merchant_utility_workspaces','List declared Utility consoles, host file and capture handles, buyer workspaces and current attachment/read ownership.',{},[],read),
    tool('merchant_utility_status','Read the same original Utility state and authenticated managed launch identity, with retained delivery and request state.',workspace,['workspace'],read),
    tool('merchant_utility_reopen','Reattach this MCP client after the same original Utility console restarts; drain this borrower and preserve the reviewed workspace identity.',workspace,['workspace'],action),
    tool('merchant_utility_inventory','Page an original source, review, edition, comparison, export or action inventory. Continue with its page-zero snapshot.',{...workspace,kind:{enum:utilityEnergyInventoryKinds},...page},['workspace','kind'],read),
    tool('merchant_utility_inspect','Read a complete original import, record, reviewed selection, reconciliation, capture, native build or delivery manifest.',{...workspace,kind:{enum:utilityEnergyInspectKinds},id:digest},['workspace','kind','id'],read),
    tool('merchant_utility_records','Read original interval, meter, bill, charge or resource records with their source identities, nested values and native units.',{...workspace,kind:{enum:['interval','meter','bill','charge','resource']},imports:{type:'array',items:digest,maxItems:1000},meter:{type:'string',maxLength:512},series:{type:'string',maxLength:512},offset:integer,limit:{type:'integer',minimum:1,maximum:1000},full:{type:'boolean'}},['workspace'],read),
    tool('merchant_utility_series','Inspect the original source series and meter/channel identities before reviewing corrected intervals.',{...workspace,imports:{type:'array',items:digest,maxItems:1000}},['workspace'],read),
    tool('merchant_utility_changes','Page the original native edition comparison and exact row changes.',{...workspace,id:digest,offset:integer,limit:{type:'integer',minimum:1,maximum:1000}},['workspace','id'],read),
    tool('merchant_utility_operation','Recover the saved original result, failure or running state for one exact action UUID.',{...workspace,requestId:uuid},['workspace','requestId'],read),
    tool('merchant_utility_action','Execute a reviewed original selection, edition, bill, capture continuation, publisher or buyer action under its current revision and retained request UUID. Inspect an interrupted operation before continuing.',{...workspace,action:{enum:utilityEnergyActionNames},payload:{type:'object'},...mutation},['workspace','action','payload','expectedRevision','requestId'],action),
    tool('merchant_utility_files','Read complete byte identities for host-declared original source or portable receiving files.',{...workspace,file:alias},['workspace'],read),
    tool('merchant_utility_ingest','Receive a reviewed host-declared UtilityAPI JSON or Green Button XML file through the existing raw-byte source endpoint.',{...workspace,file:alias,expectedSha256:digest,...mutation},['workspace','file','expectedSha256','expectedRevision','requestId'],action),
    tool('merchant_utility_restore','Receive a reviewed complete original Utility packet into the declared original receiver using its native reconstruction and action journal.',{...workspace,file:alias,expectedSha256:digest,...mutation},['workspace','file','expectedSha256','expectedRevision','requestId'],action),
    tool('merchant_utility_capture_profiles','Review host-declared UtilityAPI meter, collection, time-window and environment-reference configuration with its full file SHA256.',{...workspace,profile:alias},['workspace'],read),
    tool('merchant_utility_capture_start','Start the original UtilityAPI capture from one reviewed host-declared profile, preserving native pagination, pause and recovery.',{...workspace,profile:alias,expectedSha256:digest,...mutation},['workspace','profile','expectedSha256','expectedRevision','requestId'],action),
    tool('merchant_utility_buyer_session','Bind the reviewed original publisher buyer to a host-declared buyer workspace and explicit native page, row and aggregate payment limits.',{...workspace,buyerWorkspace:alias,buyerId:uuid,maxPages:{type:'integer',minimum:1},maxTotalAtomic:{type:'string',pattern:'^[0-9]+$'},maxRows:{type:'integer',minimum:1},maxPageBytes:{type:'integer',minimum:1},...mutation},['workspace','buyerWorkspace','buyerId','maxPages','maxTotalAtomic','expectedRevision','requestId'],action),
    tool('merchant_utility_publisher_state','Open or inspect the original workspace-owned publisher and its draft, release and customer state.',workspace,['workspace'],action),
    tool('merchant_utility_file_prepare','Retain one complete original customer, workspace, source, comparison, native-project or publisher file for resumable byte delivery.',{...workspace,selection:source,expectedRevision:integer,expectedSha256:digest},['workspace','selection'],action),
    tool('merchant_utility_exports','Page completed Utility MCP file deliveries without reopening the native source workspace.',{workspace:alias,...page},[],read),
    tool('merchant_utility_manifest','Read the complete retained file manifest, source selection, workspace binding and exact SHA256.',{exportId:digest},['exportId'],read),
    tool('merchant_utility_file','Read the next verified chunk of the same retained original file; repeat manifest and file hashes and continue its readId.',{exportId:digest,file:{type:'string',minLength:1,maxLength:160},expectedManifestSha256:digest,expectedSha256:digest,offset:integer,limit:{type:'integer',minimum:1,maximum:196608},readId:uuid},['exportId','file','expectedManifestSha256','expectedSha256','offset'],read),
    tool('merchant_utility_file_release','Close this client-owned retained file handle while preserving the original file and console.',{exportId:digest,readId:uuid},['exportId','readId'],action)
  ];
}

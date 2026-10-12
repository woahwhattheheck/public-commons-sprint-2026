// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const SHA = /^[0-9a-f]{64}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const OPERATION = /^[A-Za-z0-9_-]{8,100}$/;

const SHORT_ID = /^[0-9a-f]{24}$/;

const DATASET_ID = /^dataset-[0-9a-f]{24}$/;

const RELEASE_ID = /^stellar-[0-9a-f]{24}$/;

const RECEIPT_FILES = ['dataset.csv','dataset.jsonl','review.html','delivery.json','manifest.json'];

const string = (maximum = 200) => ({ type: 'string', maxLength: maximum });

const matching = pattern => ({ type: 'string', pattern: pattern.source });

const number = (minimum, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });

const choice = values => ({ type: 'string', enum: values });

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const strings = maximum => ({ type: 'array', items: string(500), minItems: 1, maxItems: maximum });

const query = object({
  kind: choice(['assets','holders','rating','supply','directory','tags','blocked-domains','domain','ledger-time','ledger-sequence']),
  network: choice(['public','testnet']), asset: string(100), search: string(500),
  sort: choice(['rating','created','payments','trades','trustlines','volume','volume7d']), order: choice(['asc','desc']),
  limit: number(1,200), address: strings(50), tag: strings(10), domain: string(253),
  timestamp: string(100), sequence: matching(/^[1-9][0-9]*$/)
}, ['kind']);

const payment = object({
  scheme: choice(['exact']), network: choice(['stellar:testnet','stellar:pubnet']), asset: string(100),
  amount: matching(/^[1-9][0-9]*$/), payTo: string(100), maxTimeoutSeconds: number(1,86400)
}, ['scheme','network','asset','amount','payTo','maxTimeoutSeconds']);

const nativeQuery = string(8192);

const id = matching(SHORT_ID);

const edition = matching(SHA);

const dataset = matching(DATASET_ID);

const release = matching(RELEASE_ID);

const actions = [
  ['watch.add','Retain an asset watch and its operator note.', {network:choice(['public','testnet']),asset:string(100),label:string(),note:string(4000)}, ['asset']],
  ['watch.remove','Remove a watch from the current list while retaining its source history.', {watchId:id}, ['watchId'], {destructive:true}],
  ['capture.start','Start one original provider capture with its complete query and retained continuation. Save its captureId; later passes use capture_resume.', {query,label:string(),watchId:id,pageBudget:number(1,1000)}, ['query'], {openWorld:true}],
  ['capture.resume','Continue the same saved capture from its original query and next link, honoring the provider retry time.', {captureId:id,pageBudget:number(1,1000)}, ['captureId'], {openWorld:true}],
  ['edition.select','Select an existing immutable edition in the same browser workspace.', {editionId:edition}, ['editionId']],
  ['edition.compare','Retain the complete keyed comparison of two original editions, including its full downloadable changes file.', {leftId:edition,rightId:edition}, ['leftId','rightId']],
  ['annotation.save','Save source-linked review notes and preserve the original note history.', {editionId:edition,subject:string(300),note:string(12000),status:choice(['open','reviewed','follow_up'])}, ['editionId','subject','note','status']],
  ['dataset.prepare','Prepare the exact selected edition using the original SF30 dataset engine and full source-page closure.', {editionId:edition,name:string()}, ['editionId']],
  ['dataset.query','Query the retained original dataset; pass the original URL-encoded query string with schema-defined field/filter/sort/cursor parameters. The original journal records this query.', {datasetId:dataset,query:nativeQuery}, ['datasetId']],
  ['release.prepare','Prepare an original SF82 publisher release with explicitly reviewed origin, path and Stellar payment terms.', {datasetId:dataset,origin:string(2048),path:string(1024),payment}, ['datasetId','origin','payment']],
  ['release.inspect','Inspect the selected original publisher, release generation and runtime readiness; retain the resulting original journal entry.', {releaseId:release}, ['releaseId'], {openWorld:true}],
  ['release.activate','Activate the exact original prepared release with the current publisher generation.', {releaseId:release,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {destructive:true}],
  ['release.start','Start the selected original merchant with its configured payment runtime and expected publisher generation.', {releaseId:release,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {openWorld:true}],
  ['release.stop','Stop the original workspace-owned merchant while retaining its release and customer history.', {releaseId:release}, ['releaseId'], {destructive:true}],
  ['release.rollback','Restore the original prior publisher selection with the current generation.', {releaseId:release,expectedGeneration:number(0)}, ['releaseId','expectedGeneration'], {destructive:true}],
  ['buyer.inspect','Inspect ordered original SF88 intent outcomes in the host-selected inbox. The original workspace records this inspection.', {intentIds:strings(1000)}, ['intentIds']],
  ['buyer.receive','Receive the ordered original completed SF88 pages through SF100 and retain all five original customer files.', {intentIds:strings(1000)}, ['intentIds']],
  ['export.create','Retain a complete immutable original edition JSON, CSV or report with the review notes selected by this operation.', {editionId:edition,format:choice(['json','csv','report'])}, ['editionId','format']]
];

const scope = {workspace:matching(ALIAS)};

const readOnly = {readOnly:true,idempotent:true};

const selectFile = {
  kind:choice(['source','export','receipt']), id:string(100), page:number(0), file:choice(RECEIPT_FILES)
};

const chunks = {
  readId:matching(UUID), expectedSha256:matching(SHA), offset:number(0),
  limit:number(1,MAX_RETAINED_CHUNK_BYTES)
};

function stellarExpertWorkspaceTools(tool) {
  return [
    tool('merchant_stellar_expert_workspaces','List host-declared StellarExpert aliases and their original workspace UUIDs; report only this adapter’s retained download sessions.',{},[],readOnly),
    tool('merchant_stellar_expert_schema','Read the running original workspace schema, actual source contract, typed query fields, payment fields and capabilities.',scope,['workspace'],readOnly),
    tool('merchant_stellar_expert_view','Read the same browser workspace and its current revision, captures, latest editions, all releases/receipts/exports and recent operation outcomes.',scope,['workspace'],readOnly),
    tool('merchant_stellar_expert_editions','Page the complete original edition archive. Retain the returned revision for every following page; a concurrent change returns REVISION_CHANGED.',{...scope,offset:number(0),limit:number(1,500),expectedRevision:number(0)},['workspace'],readOnly),
    tool('merchant_stellar_expert_edition','Read one complete immutable original edition, including every response receipt and exact source SHA256.',{...scope,editionId:edition},['workspace','editionId'],readOnly),
    tool('merchant_stellar_expert_rows','Page normalized original rows from one immutable edition. Source numeric tokens remain exact strings; nextOffset continues the same edition.',{...scope,editionId:edition,offset:number(0),limit:number(1,500)},['workspace','editionId'],readOnly),
    tool('merchant_stellar_expert_files','Read exact file metadata and selectors for an original edition’s source responses, one retained export, or one complete five-file customer receipt.',{...scope,kind:selectFile.kind,id:selectFile.id},['workspace','kind','id'],readOnly),
    tool('merchant_stellar_expert_file_read','Read an original source/export/customer file as verified base64 byte chunks. Continue the same selector, readId, expectedSha256 and nextOffset. A retained read can finish after the console closes.',{...scope,...selectFile,...chunks},['workspace','kind','id'],readOnly),
    tool('merchant_stellar_expert_file_release','Release only the named temporary download snapshot; preserve original workspace source and customer files.',{...scope,readId:matching(UUID)},['workspace','readId'],{idempotent:true}),
    ...actions.map(([action, description, properties, required, annotations = {}]) =>
      tool('merchant_stellar_expert_' + action.replaceAll('.','_'),
        description + ' Supply the current revision and a stable operationId. Repeat the exact same request after an interrupted reply; the native journal reconciles it before checking the revision. Check ok and native state before continuing.',
        {...scope,operationId:matching(OPERATION),expectedRevision:number(0),...properties},
        ['workspace','operationId','expectedRevision',...required],{idempotent:true,...annotations}))
  ];
}

export { stellarExpertWorkspaceTools, readOnly, scope, number, edition, selectFile, chunks, matching, UUID, actions, OPERATION, ALIAS, SHA, choice, string, RECEIPT_FILES, id, query, dataset, nativeQuery, payment, release, strings, SHORT_ID, object, DATASET_ID, RELEASE_ID };

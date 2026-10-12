import { openSearchWorkspaceTools, aliasSchema, idSchema, revisionSchema, offsetSchema, limitSchema, objectSchema, caseSchema, digestSchema } from './catalog/opensearch-workspace.mjs';
export { openSearchWorkspaceTools } from './catalog/opensearch-workspace.mjs';
// MIT. Agent access to the original OpenSearch workspace, relevance journal and packages.
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { MerchantOpenSearchDeployments, openSearchDeploymentTools, openSearchRuntimeOptions,
  projectOpenSearchDeploymentOperation } from './opensearch-deployment.mjs';

export const OPENSEARCH_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.opensearch-workspace-connection.v1';








const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key)).map(key => [key,value[key]]));
const omit = (value, keys) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function canonical(value, depth = 0) {
  if (depth > 64) throw failure('INVALID_PARAMS','JSON nesting exceeds 64 levels.');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item,depth+1)).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical(value[key],depth+1)).join(',') + '}';
}
function integer(value, label, min=1, max=Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw failure('INVALID_PARAMS',label+' must be an integer from '+min+' to '+max+'.');
  return value;
}
function recordId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))
    throw failure('INVALID_PARAMS','Use the original request or saved record ID.');
  return value;
}
function caseId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value) ||
      ['__proto__','constructor','prototype'].includes(value))
    throw failure('INVALID_PARAMS','Use the original variant or case ID.');
  return value;
}
function enumValue(value, values, label) {
  if (!values.includes(value)) throw failure('INVALID_PARAMS','Choose a declared '+label+'.');
  return value;
}
function hostPath(value, base) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw failure('CONFIGURATION_ERROR','OpenSearch paths are selected in the host connection file.');
  return resolve(base,value);
}
async function connectionJson(path) {
  const file = await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1048576 || process.platform !== 'win32' &&
        ((stat.mode & 0o077) || process.getuid && stat.uid !== process.getuid()))
      throw failure('CONFIGURATION_ERROR','Use an owned private OpenSearch connection JSON file of at most one MiB.');
    const bytes = await file.readFile();
    if (bytes.length > 1048576) throw failure('CONFIGURATION_ERROR','The OpenSearch connection file exceeds one MiB.');
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
    catch { throw failure('CONFIGURATION_ERROR','The OpenSearch connection file must contain UTF-8 JSON.'); }
  } finally { await file.close(); }
}
async function declarationPath(value, base) {
  const selected = await realpath(hostPath(value,base)), stat = await lstat(selected);
  if (!stat.isFile() || stat.size > 1048576)
    throw failure('CONFIGURATION_ERROR','Select an existing source or plan JSON file of at most one MiB.');
  return selected;
}

/** Filesystem configuration only: no SQLite open, environment resolution or provider call. */
export async function readOpenSearchWorkspaceConfiguration(path) {
  path = resolve(path);
  const raw = await connectionJson(path);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if (raw.schema !== OPENSEARCH_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      !Object.keys(raw.workspaces).length || Object.keys(raw.workspaces).length > 32)
    throw failure('CONFIGURATION_ERROR','Declare 1–32 aliases in the original OpenSearch workspace connection schema.');
  const base = dirname(path), workspaces = Object.create(null), directories = new Set();
  for (const [alias,item] of Object.entries(raw.workspaces)) {
    identifier(alias,'OpenSearch workspace alias');
    exact(item,['label','directory','sourceFile','planFile','runtime'],['directory','sourceFile']);
    const directory = await realpath(hostPath(item.directory,base));
    await privateSupportDirectory(directory);
    const stat = await lstat(directory);
    if (process.platform !== 'win32' && process.getuid && stat.uid !== process.getuid())
      throw failure('CONFIGURATION_ERROR','The OpenSearch workspace directory must belong to the host user.');
    if (directories.has(directory)) throw failure('CONFIGURATION_ERROR','Give each original OpenSearch workspace directory one alias.');
    directories.add(directory);
    workspaces[alias] = { label:line(item.label ?? alias,'OpenSearch workspace label'),directory,
      sourceFile:await declarationPath(item.sourceFile,base),
      runtime:openSearchRuntimeOptions(item.runtime ?? {}),
      ...(item.planFile === undefined ? {} : {planFile:await declarationPath(item.planFile,base)}) };
  }
  return { workspaces };
}



const specifications = new Map(openSearchWorkspaceTools((name,description,properties,required,annotations) =>
  ({name,properties,required,annotations})).map(spec => [spec.name,spec]));
const COLLECTIONS = {
  drafts:{table:'drafts',column:'updated_at',view:'draft'},
  editions:{table:'editions',column:'created_at',view:'edition'},
  packages:{table:'packages',column:'created_at',view:'package'},
  operations:{table:'operations',column:'created_at',view:'operation'},
  'relevance-sets':{table:'relevance_sets',column:'updated_at',view:'set',json:'summary_json'},
  'relevance-editions':{table:'relevance_editions',column:'created_at',view:'relevance'},
};
function draftView(value) { return omit(value,['query','input','plan']); }
function packageView(value) { return omit(value,['directory','handoff']); }
function setView(value) {
  if (!Array.isArray(value.variants) || !Array.isArray(value.cases)) return {...value};
  return {...omit(value,['variants','cases']),variants:(value.variants ?? []).map(variant => pick(variant,['id','title','queryName','draft'])),
    cases:(value.cases ?? []).map(item => ({...omit(item,['documents']),documentCount:item.documents?.length ?? item.documentCount ?? 0,
      judgmentCount:item.documents?.filter(document => document.rating !== null).length ?? item.judgmentCount ?? 0}))};
}
function operationView(value, includeRequest=false) {
  value = projectOpenSearchDeploymentOperation(value);
  const result = {...pick(value,['id','kind','state','createdAt','updatedAt','requestSha256','error']),
    ...(includeRequest ? {request:value.request,...pick(value,['draft','relevanceSet','evaluation'])} : {})};
  if (value.result) {
    result.result = omit(value.result,['draft','edition','package','relevanceSet','relevanceEdition','result']);
    if (value.result.draft) result.result.draft = draftView(value.result.draft);
    if (value.result.edition) result.result.edition = omit(value.result.edition,['result','set']);
    if (value.result.package) result.result.package = packageView(value.result.package);
    if (value.result.relevanceSet) result.result.relevanceSet = setView(value.result.relevanceSet);
    if (value.result.relevanceEdition) result.result.relevanceEdition = omit(value.result.relevanceEdition,['result','set']);
  }
  return result;
}
function revision(model,kind,id,wanted) {
  recordId(id);
  if (wanted !== undefined) integer(wanted,'Revision');
  if (kind === 'relevance-set') return model.relevance.set(id,wanted);
  if (wanted === undefined) return model.draft(id);
  const row = model.store.db.prepare('SELECT record_json FROM draft_history WHERE draft_id=? AND revision=?').get(id,wanted);
  if (!row) throw failure('WORKSPACE_DRAFT_NOT_FOUND','The requested immutable draft revision was not found.');
  return JSON.parse(row.record_json);
}
function page(items,{offset=0,limit=50}={}) {
  integer(offset,'Offset',0); integer(limit,'Limit',1,100);
  const selected = items.slice(offset,offset+limit);
  return {items:selected,total:items.length,offset,nextOffset:offset+selected.length < items.length ? offset+selected.length : null};
}
function jsonPointer(value) { return String(value).replaceAll('~','~0').replaceAll('/','~1'); }

function collectionPage(model,collection,args) {
  const spec = COLLECTIONS[enumValue(collection,Object.keys(COLLECTIONS),'collection')];
  const limit = integer(args.limit ?? 50,'Page limit',1,100);
  let after = null;
  if (args.cursor !== undefined) {
    if (typeof args.cursor !== 'string' || args.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(args.cursor))
      throw failure('INVALID_PARAMS','Use nextCursor returned by this collection.');
    try { after = JSON.parse(Buffer.from(args.cursor,'base64url').toString('utf8')); }
    catch { throw failure('INVALID_PARAMS','Use the original collection cursor.'); }
    if (!Array.isArray(after) || after.length !== 5 || after[0] !== 1 || after[1] !== model.store.id ||
        after[2] !== collection || typeof after[3] !== 'string' || after[3].length > 64 ||
        typeof after[4] !== 'string' || after[4].length > 96)
      throw failure('INVALID_PARAMS','This cursor belongs to a different workspace or collection.');
  }
  if (collection === 'operations') model.store.recoverInterrupted();
  // Identifiers come exclusively from the fixed collection map; all cursor values are bound.
  const where = after ? ' WHERE ('+spec.column+' < ? OR ('+spec.column+' = ? AND id < ?))' : '';
  const rows = model.store.db.prepare('SELECT id,'+spec.column+' AS position,'+(spec.json ?? 'record_json')+
    ' AS record_json FROM '+spec.table+where+' ORDER BY '+spec.column+' DESC,id DESC LIMIT ?')
    .all(...(after ? [after[3],after[3],after[4]] : []),limit+1);
  const more = rows.length > limit, selected = rows.slice(0,limit);
  const view = value => spec.view === 'draft' ? draftView(value) : spec.view === 'package' ? packageView(value)
    : spec.view === 'operation' ? operationView(value) : spec.view === 'set' ? setView(value) : value;
  const last = selected.at(-1);
  return {collection,items:selected.map(row => view(JSON.parse(row.record_json))),
    nextCursor:more ? Buffer.from(JSON.stringify([1,model.store.id,collection,last.position,last.id])).toString('base64url') : null,
    ordering:spec.column+' descending, original ID descending',
    consistency:['drafts','relevance-sets'].includes(collection) ? 'Current saved heads; edits can move a record ahead of an existing cursor.' : 'Original creation order.'};
}
function historyPage(model,args) {
  const kind = enumValue(args.kind,['draft','relevance-set'],'history kind'), id = recordId(args.id);
  revision(model,kind,id);
  const before = args.beforeRevision === undefined ? null : integer(args.beforeRevision,'Before revision');
  const limit = integer(args.limit ?? 50,'Page limit',1,100);
  const table = kind === 'draft' ? 'draft_history' : 'relevance_history';
  const field = kind === 'draft' ? 'draft_id' : 'set_id';
  const rows = model.store.db.prepare('SELECT revision,record_json FROM '+table+' WHERE '+field+'=?'+
    (before === null ? '' : ' AND revision < ?')+' ORDER BY revision DESC LIMIT ?')
    .all(id,...(before === null ? [] : [before]),limit+1);
  const selected = rows.slice(0,limit), view = kind === 'draft' ? draftView : setView;
  return {kind,id,items:selected.map(row => view(JSON.parse(row.record_json))),
    nextBeforeRevision:rows.length > limit ? selected.at(-1).revision : null};
}
function editionView(model,kind,id) {
  if (kind === 'query') {
    const edition = model.edition(id);
    return {...omit(edition,['result']),result:omit(edition.result,['hits'])};
  }
  const edition = model.relevance.edition(id);
  return {...omit(edition,['set','result']),set:{id:edition.set.id,revision:edition.set.revision,title:edition.set.title},
    result:{...omit(edition.result,['variants']),variants:edition.result.variants.map(variant =>
      ({...omit(variant,['native','strictWindows','exactIntegerPaths','cases']),
        cases:variant.cases,nativeSuccessCaseIds:Object.keys(variant.native?.details ?? {}),
        nativeFailureCaseIds:Object.keys(variant.native?.failures ?? {})}))}};
}
function compareView(model,args) {
  const before = recordId(args.beforeId), after = recordId(args.afterId);
  if (args.kind === 'query') {
    if (args.variantId !== undefined) throw failure('INVALID_PARAMS','variantId applies to relevance comparisons.');
    const category = enumValue(args.category ?? 'changed',['added','removed','changed','rankingChanged'],'change category');
    const comparison = model.compare(before,after);
    return {...omit(comparison,['added','removed','changed','rankingChanged']),category,...page(comparison[category],args)};
  }
  if (args.category !== undefined) throw failure('INVALID_PARAMS','category applies to query comparisons.');
  const comparison = model.relevance.compare(before,after);
  if (args.variantId !== undefined) {
    const selected = comparison.variants.find(item => item.id === caseId(args.variantId));
    if (!selected) throw failure('WORKSPACE_RELEVANCE_SELECTION_REQUIRED','Choose an original compared variant.');
    return {...omit(comparison,['variants']),variant:omit(selected,['cases']),cases:page(selected.cases,args)};
  }
  return {...omit(comparison,['variants']),variants:page(comparison.variants.map(item => ({...omit(item,['cases']),caseCount:item.cases.length})),args)};
}
function setPage(model,args) {
  const set = revision(model,'relevance-set',args.id,args.revision);
  if (args.caseId !== undefined) {
    const item = set.cases.find(item => item.id === caseId(args.caseId));
    if (!item) throw failure('WORKSPACE_RELEVANCE_SELECTION_REQUIRED','Choose a case from this saved evaluation set.');
    return {set:pick(set,['id','revision','title','metric','sourceProfileSha256']),case:omit(item,['documents']),
      documents:page(item.documents,args)};
  }
  return {...omit(set,['cases']),cases:page(set.cases.map(item => ({...omit(item,['documents']),documentCount:item.documents.length,
    judgmentCount:item.documents.filter(row => row.rating !== null).length,unjudgedCount:item.documents.filter(row => row.rating === null).length})),args)};
}
function relevanceCase(model,args) {
  const edition = model.relevance.edition(recordId(args.editionId));
  const variant = edition.result.variants.find(item => item.id === caseId(args.variantId));
  const id = caseId(args.caseId);
  if (!variant || !edition.set.cases.some(item => item.id === id))
    throw failure('WORKSPACE_RELEVANCE_SELECTION_REQUIRED','Choose an original evaluated variant and case.');
  const view = enumValue(args.view ?? 'native',['native','strict'],'case view'), strict = variant.strictWindows?.[id];
  const detail = variant.native?.details?.[id], prefix = '/details/'+jsonPointer(id)+'/hits/';
  const values = view === 'native' ? detail?.hits ?? [] : strict?.hits ?? [];
  const selected = page(values,args);
  const base = {editionId:edition.id,resultSha256:edition.resultSha256,source:edition.result.source,
    metric:edition.result.metric,variant:pick(variant,['id','label','queryName','indices','concreteIndices','effectiveSort','snapshot']),
    caseId:id,view,exactIntegerPathsRelativeTo:view === 'native' ? 'variant.native' : 'strictWindow.hits',coverage:variant.cases?.find(item => item.id === id) ?? null,
    nativeFailure:variant.native?.failures?.[id] ?? null,
    strict:strict ? omit(strict,['hits','exactIntegerPaths']) : null,
    nativeDetail:detail ? omit(detail,['hits']) : null,numberEncoding:edition.result.numberEncoding};
  return {...base,...selected,items:selected.items.map((entry,position) => {
    const index = selected.offset+position;
    if (view === 'native') {
      const originalPointer = prefix+index;
      return {position:index,originalPointer,entry,exactIntegerPaths:(variant.exactIntegerPaths ?? [])
        .filter(path => path === originalPointer || path.startsWith(originalPointer+'/'))};
    }
    const originalPointer = '/'+index;
    return {position:index,originalPointer,entry,exactIntegerPaths:(strict?.exactIntegerPaths ?? [])
      .filter(path => path === originalPointer || path.startsWith(originalPointer+'/'))};
  })};
}
function previous(model,id) {
  try { return model.operation(id); }
  catch (error) { if (error.code !== 'WORKSPACE_OPERATION_NOT_FOUND') throw error; return null; }
}
function judge(model,args) {
  const request = omit(args,['workspace']);
  recordId(request.requestId); recordId(request.setId); integer(request.expectedRevision,'Expected revision'); caseId(request.caseId);
  request.mode = enumValue(request.mode ?? 'merge',['merge','replace'],'judgment mode');
  if (!Array.isArray(request.judgments) || request.judgments.length > 5000 || !request.judgments.length && request.mode !== 'replace')
    throw failure('INVALID_PARAMS','Supply up to 5,000 explicit judgments; an empty replacement clears this case.');
  const identities = new Set();
  for (const item of request.judgments) {
    exact(item,['_index','_id','rating','note'],['_index','_id','rating']);
    for (const [key,max] of [['_index',255],['_id',512]]) {
      if (typeof item[key] !== 'string' || !item[key] || item[key].includes('\0') || Buffer.byteLength(item[key]) > max)
        throw failure('INVALID_PARAMS','Retain the original nonempty document '+key+'.');
    }
    if (item.rating !== null) integer(item.rating,'Rating',0,2147483647);
    if (item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 2000))
      throw failure('INVALID_PARAMS','Judgment notes contain at most 2,000 characters.');
    const key = canonical([item._index,item._id]);
    if (identities.has(key)) throw failure('INVALID_PARAMS','Each document identity appears once in a judgment update.');
    identities.add(key);
  }
  // Store the exact patch beside the normal complete save request. Replays can
  // resolve that immutable original request after the current set has advanced.
  const prior = previous(model,request.requestId);
  if (prior) {
    if (prior.kind !== 'relevance-save' || prior.request?.mcp?.kind !== 'relevance-judge' ||
        canonical(prior.request.mcp.request) !== canonical(request))
      throw failure('WORKSPACE_REQUEST_REUSED','This request ID belongs to a different saved input.');
    return operationView(model.relevance.save(prior.request));
  }
  const set = model.relevance.set(request.setId,request.expectedRevision);
  const selected = set.cases.find(item => item.id === request.caseId);
  if (!selected) throw failure('WORKSPACE_RELEVANCE_SELECTION_REQUIRED','Choose a case in this saved evaluation set.');
  const existing = new Map(selected.documents.map(item => [canonical([item._index,item._id]),item]));
  const amended = new Map(request.mode === 'merge' ? existing : []);
  for (const item of request.judgments) {
    const key = canonical([item._index,item._id]);
    amended.set(key,{...(existing.get(key) ?? {note:''}),...item});
  }
  selected.documents = [...amended.values()];
  return operationView(model.relevance.save({requestId:request.requestId,setId:request.setId,
    expectedRevision:request.expectedRevision,set,mcp:{kind:'relevance-judge',request}}));
}
const QUERY_EXPORTS = {'query-edition':'edition.json','query-result':'result.json','query-csv':'results.csv'};
const RELEVANCE_EXPORTS = {'relevance-edition':'edition.json','relevance-native':'native.json',
  'relevance-report-json':'report.json','relevance-report-html':'report.html','relevance-csv':'cases.csv'};
async function retainedOriginal(model,args) {
  const id = recordId(args.id);
  if (args.kind === 'draft' || args.kind === 'relevance-set') {
    integer(args.revision,'Original saved revision');
    return {bytes:jsonBytes(revision(model,args.kind,id,args.revision)),name:'opensearch-'+args.kind+'-'+id+'-r'+args.revision+'.json',type:'application/json'};
  }
  if (args.kind === 'operation')
    return {bytes:jsonBytes(omit(projectOpenSearchDeploymentOperation(model.operation(id)),['owner'])),name:'opensearch-operation-'+id+'.json',type:'application/json'};
  if (args.kind === 'package-file') {
    if (typeof args.file !== 'string' || !args.file || args.file.length > 512)
      throw failure('INVALID_PARAMS','Select an original file name from this package manifest.');
    const value = await model.downloadPackage(id,args.file);
    return {bytes:Buffer.isBuffer(value.body) ? value.body : Buffer.from(value.body),name:value.filename,type:value.type};
  }
  const value = Object.hasOwn(QUERY_EXPORTS,args.kind) ? model.downloadEdition(id,QUERY_EXPORTS[args.kind])
    : Object.hasOwn(RELEVANCE_EXPORTS,args.kind) ? model.relevance.export(id,RELEVANCE_EXPORTS[args.kind]) : null;
  if (!value) throw failure('INVALID_PARAMS','Choose a declared original export kind.');
  return {bytes:Buffer.isBuffer(value.body) ? value.body : Buffer.from(value.body),name:value.filename,type:value.type};
}

export class MerchantOpenSearchWorkspaces {
  #config; #environment; #handles = new Map(); #pending = new Map(); #closingAliases = new Map();
  #files = new RetainedFileReads({errorPrefix:'OPENSEARCH'}); #deployment = new MerchantOpenSearchDeployments(); #closing = false; #close;
  constructor(config, {environment = process.env} = {}) {
    if (!plain(environment)) throw failure('CONFIGURATION_ERROR','The original source environment must be a host-selected object.');
    this.#config = config; this.#environment = environment;
  }
  get summary() {
    const aliases = this.#config.opensearchWorkspaces?.workspaces ?? {};
    return {configured:Object.keys(aliases).length > 0,count:Object.keys(aliases).length,
      opened:[...this.#handles.keys()],pending:this.#pending.size,closing:this.#closing,...this.#files.summary,
      deployment:this.#deployment.summary};
  }
  #entry(alias) {
    identifier(alias,'OpenSearch workspace alias');
    const entry = this.#config.opensearchWorkspaces?.workspaces?.[alias];
    if (!entry) throw failure('OPENSEARCH_WORKSPACE_NOT_CONFIGURED','Choose a configured alias from merchant_opensearch_status.');
    return entry;
  }
  async #status(alias) {
    if (alias === undefined) return {...this.summary,workspaces:Object.entries(this.#config.opensearchWorkspaces?.workspaces ?? {})
      .map(([workspace,entry]) => ({workspace,label:entry.label,state:this.#closingAliases.has(workspace) ? 'CLOSING' : this.#handles.has(workspace) ? 'OPEN' : 'CLOSED'}))};
    const entry = this.#entry(alias), handle = this.#handles.get(alias);
    if (!handle) return {workspace:alias,label:entry.label,state:'CLOSED'};
    const model = await handle, counts = {};
    for (const [name,spec] of Object.entries(COLLECTIONS))
      counts[name] = model.store.db.prepare('SELECT count(*) AS count FROM '+spec.table).get().count;
    return {workspace:alias,label:entry.label,state:this.#closingAliases.has(alias) ? 'CLOSING' : 'OPEN',
      workspaceId:model.store.id,sourceProfileSha256:model.store.profileHash,nativeBusy:model.nativeBusy,
      queryNames:Object.keys(model.config.queries),counts,reads:this.#files.status(alias)};
  }
  async #open(alias) {
    const entry = this.#entry(alias);
    if (!this.#handles.has(alias)) {
      const pending = (async () => {
        const {createOpenSearchWorkspace} = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/workspace/service.mjs');
        return createOpenSearchWorkspace({directory:entry.directory,sourceFile:entry.sourceFile,planFile:entry.planFile,env:this.#environment});
      })();
      this.#handles.set(alias,pending);
      try { await pending; } catch (error) { if (this.#handles.get(alias) === pending) this.#handles.delete(alias); throw error; }
    }
    return this.#status(alias);
  }
  #closeAlias(alias) {
    if (this.#closingAliases.has(alias)) return this.#closingAliases.get(alias);
    this.#entry(alias);
    const accepted = [...this.#pending].filter(([,selected]) => selected === alias).map(([pending]) => pending);
    const pending = (async () => {
      await Promise.allSettled(accepted);
      const readers = await Promise.allSettled([this.#files.closeScope(alias),this.#deployment.closeWorkspace(alias)]);
      const handle = this.#handles.get(alias);
      if (handle) {
        try { await (await handle).close(); }
        finally { if (this.#handles.get(alias) === handle) this.#handles.delete(alias); }
      }
      const failed = readers.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      return {workspace:alias,state:'CLOSED'};
    })().finally(() => this.#closingAliases.delete(alias));
    this.#closingAliases.set(alias,pending);
    return pending;
  }
  async #execute(name,args) {
    if (name === 'merchant_opensearch_status') return this.#status(args.workspace);
    if (name === 'merchant_opensearch_open') return this.#open(args.workspace);
    const entry = this.#entry(args.workspace), handle = this.#handles.get(args.workspace);
    if (!handle) throw failure('OPENSEARCH_WORKSPACE_CLOSED','Open the saved workspace with merchant_opensearch_open.');
    const model = await handle;
    try {
      if (name.startsWith('merchant_opensearch_deployment_')) {
        const value = await this.#deployment.call(name,args,{model,entry});
        return value?.kind?.startsWith('deployment-') ? operationView(value) : value;
      }
      switch (name) {
        case 'merchant_opensearch_catalog': {
          const {describeRelevanceMetrics} = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/relevance/native.mjs');
          const catalog = page(Object.entries(model.config.queries).map(([name,query]) => ({name,query})),args);
          return {...catalog,sourceSchema:model.config.schema,sourceProfileSha256:model.store.profileHash,
            templatePlan:model.templatePlan,metrics:describeRelevanceMetrics()};
        }
        case 'merchant_opensearch_list': return collectionPage(model,args.collection,args);
        case 'merchant_opensearch_history': return historyPage(model,args);
        case 'merchant_opensearch_draft': return revision(model,'draft',args.id,args.revision);
        case 'merchant_opensearch_save':
          recordId(args.requestId);
          if ((args.draftId === undefined) !== (args.expectedRevision === undefined))
            throw failure('INVALID_PARAMS','Updates require draftId and expectedRevision together.');
          if (args.draftId !== undefined) { recordId(args.draftId); integer(args.expectedRevision,'Expected revision'); }
          return operationView(model.save(omit(args,['workspace'])));
        case 'merchant_opensearch_validate': {
          enumValue(args.kind,['draft','relevance-set'],'validation kind'); recordId(args.id); integer(args.revision,'Revision');
          return args.kind === 'draft' ? model.validate(args.id,args.revision) : model.relevance.validate(args.id,args.revision);
        }
        case 'merchant_opensearch_inspect':
        case 'merchant_opensearch_capture':
        case 'merchant_opensearch_prepare':
          recordId(args.requestId); recordId(args.draftId); integer(args.expectedRevision,'Expected revision');
          return operationView(await model.run(name.slice('merchant_opensearch_'.length),omit(args,['workspace'])));
        case 'merchant_opensearch_operation':
          if (args.includeRequest !== undefined && typeof args.includeRequest !== 'boolean') throw failure('INVALID_PARAMS','includeRequest must be boolean.');
          return operationView(model.operation(recordId(args.requestId)),args.includeRequest === true);
        case 'merchant_opensearch_edition':
          return editionView(model,enumValue(args.kind,['query','relevance'],'edition kind'),recordId(args.id));
        case 'merchant_opensearch_hits': {
          const edition = model.edition(recordId(args.editionId));
          return {edition:omit(edition,['result']),result:omit(edition.result,['hits']),...page(edition.result.hits,args)};
        }
        case 'merchant_opensearch_compare':
          enumValue(args.kind,['query','relevance'],'comparison kind'); return compareView(model,args);
        case 'merchant_opensearch_package': return packageView(model.package(recordId(args.packageId)));
        case 'merchant_opensearch_relevance_set': return setPage(model,args);
        case 'merchant_opensearch_relevance_save':
          recordId(args.requestId);
          if ((args.setId === undefined) !== (args.expectedRevision === undefined))
            throw failure('INVALID_PARAMS','Updates require setId and expectedRevision together.');
          if (args.setId !== undefined) { recordId(args.setId); integer(args.expectedRevision,'Expected revision'); }
          return operationView(model.relevance.save(omit(args,['workspace'])));
        case 'merchant_opensearch_relevance_seed':
          recordId(args.editionId); caseId(args.caseId);
          return model.relevance.seed(args.editionId,pick(args,['caseId','title','limit']));
        case 'merchant_opensearch_relevance_judge': return judge(model,args);
        case 'merchant_opensearch_relevance_evaluate':
          recordId(args.requestId); recordId(args.setId); integer(args.expectedRevision,'Expected revision');
          return operationView(await model.relevance.run(omit(args,['workspace'])));
        case 'merchant_opensearch_relevance_case': return relevanceCase(model,args);
        case 'merchant_opensearch_relevance_promote':
          recordId(args.requestId); recordId(args.editionId); caseId(args.variantId); caseId(args.caseId);
          return operationView(model.relevance.promote(omit(args,['workspace'])));
        case 'merchant_opensearch_read': {
          const kind = enumValue(args.kind,['draft','operation',...Object.keys(QUERY_EXPORTS),'relevance-set',...Object.keys(RELEVANCE_EXPORTS),'package-file'],'export kind');
          recordId(args.id);
          if (['draft','relevance-set'].includes(kind)) integer(args.revision,'Original saved revision');
          else if (args.revision !== undefined) throw failure('INVALID_PARAMS','revision applies to saved drafts and evaluation sets.');
          if (kind !== 'package-file' && args.file !== undefined) throw failure('INVALID_PARAMS','file applies to prepared package files.');
          return this.#files.read({scope:args.workspace,key:canonical(pick(args,['kind','id','revision','file'])),kind,directory:entry.directory,
            load:() => retainedOriginal(model,args),...pick(args,['readId','expectedSha256','offset','limit'])});
        }
        case 'merchant_opensearch_read_release':
          if (typeof args.readId !== 'string' || !args.readId || args.readId.length > 160) throw failure('INVALID_PARAMS','Use the original retained read ID.');
          await this.#files.release(args.workspace,args.readId);
          await this.#deployment.releaseArchive(args.workspace,args.readId);
          return {released:true,readId:args.readId};
        default: throw failure('METHOD_NOT_FOUND','Unknown OpenSearch workspace tool.');
      }
    } catch (error) {
      const selected = model.failure(error);
      throw Object.assign(new Error(selected.message),selected);
    }
  }
  call(name,args={}) {
    if (this.#closing) return Promise.reject(failure('OPENSEARCH_WORKSPACE_CLOSING','The OpenSearch operator is closing.'));
    const spec = specifications.get(name);
    if (!spec) return Promise.reject(failure('METHOD_NOT_FOUND','Unknown OpenSearch workspace tool.'));
    try {
      exact(args,Object.keys(spec.properties),spec.required);
      if (args.workspace !== undefined) this.#entry(args.workspace);
      if (name !== 'merchant_opensearch_close' && args.workspace !== undefined && this.#closingAliases.has(args.workspace))
        throw failure('OPENSEARCH_WORKSPACE_CLOSING','The selected handle is closing; reopen it after close finishes.');
      const pending = name === 'merchant_opensearch_close' ? this.#closeAlias(args.workspace) : this.#execute(name,args);
      this.#pending.set(pending,args.workspace);
      void pending.finally(() => this.#pending.delete(pending)).catch(() => {});
      return pending;
    } catch (error) { return Promise.reject(error); }
  }
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    this.#close = (async () => {
      await Promise.allSettled([...this.#pending.keys()]);
      const readers = await Promise.allSettled([this.#files.close(), this.#deployment.close()]);
      const results = await Promise.allSettled([...this.#handles].map(async ([name, pending]) => {
        await (await pending).close();
        if (this.#handles.get(name) === pending) this.#handles.delete(name);
      }));
      const rejected = [...readers, ...results].find(item => item.status === 'rejected');
      if (rejected) throw rejected.reason;
    })().catch(error => { this.#close = null; throw error; });
    return this.#close;
  }
}

// MIT. Complete, hash-bound WFS project handover and original-operation receiving.
import { join, resolve, dirname } from 'node:path';
import { readdir, lstat, mkdir, realpath } from 'node:fs/promises';
import { privateDirectory, acquireWorkspace, readPrivate, readJson, atomicJson,
  identity, digest, stamp, object, fault, syncDirectory, hashPrivate } from '../postgres/publisher/files.mjs';
import { readCapture, validateSourceConfig, parseSource, pageDetails } from '../ogc/source.mjs';
import { reopenExport } from '../ogc/project.mjs';
import { readWfsProject, readWfsCatalog, getWfsOrder, getWfsPublication } from './project.mjs';
import { exactFile, reconcileRetainedFile, readWfsDocument, optionalJson } from './source.mjs';
import { endpointUrl, normalizeWfsSelection, wfsItemsUrl, wfsRequest, checkWfsCoverage } from './protocol.mjs';

import { isWfsVectorPath,wfsVectorFiles,inspectWfsVectorMembers,verifyWfsVectors,
  wfsVectorMutableReplayPath } from './vector.mjs';

export const WFS_PROJECT_BUNDLE_SCHEMA = 'stellar-forge.wfs-project-bundle.v1';
export const WFS_PROJECT_BUNDLE_DEFAULT_BYTES = 256 * 1024 * 1024;
const PROJECT = 'stellar-forge.wfs-project.v1';
const INTENT = 'stellar-forge.wfs-project-receiving-intent.v1';
const RECEIPT = 'stellar-forge.wfs-project-receiving.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const OP = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const PROJECT_KEYS = ['schema','id','name','revision','createdAt','updatedAt','sources','schemas',
  'queries','orders','publications','comparisons','operations','pending'];
const ARRAYS = ['sources','schemas','queries','orders','publications','comparisons','operations'];
const KINDS = new Set(['discover','describe','save-query','run-order','compare','export-order','abandon']);
const DOC_FILES = new Set(['request.json','pending-response.json','response.bin','model.json','document.json',
  'unreceived-response.json','last-error.json']);
const EXPORT_FILES = new Set(['export.json','preparing.json','features.csv','dataset.json','plan.json','seller.json']);
const need = (yes, code, message = code) => { if (!yes) throw fault(code,message); };
const same = (a,b) => a === undefined || b === undefined ? a === b : identity(a) === identity(b);
const clone = value => JSON.parse(JSON.stringify(value));
const withoutLimits = config => Object.fromEntries(Object.entries(config).filter(([k]) =>
  !['pageBytes','totalBytes','maxPages','requestTimeoutMs'].includes(k)));
const sorted = values => [...values].sort();
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function keys(value,names,code) {
  need(object(value) && Object.keys(value).length === names.length &&
    names.every(name => Object.hasOwn(value,name)),code);
}
function budget(maxBytes = WFS_PROJECT_BUNDLE_DEFAULT_BYTES) {
  // This is a whole JSON carrier. The limit covers its complete encoded bytes.
  need(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 512*1024*1024-1024,
    'WFS_BUNDLE_LIMIT_INVALID','Choose a complete JSON transfer limit below 512 MiB.');
  return maxBytes;
}
function cleanPath(path) {
  if(typeof path==='string'&&path.startsWith('native-vectors/')){
    need(isWfsVectorPath(path),'WFS_BUNDLE_PATH_INVALID');return path;
  }
  need(typeof path === 'string' && path.length > 0 && path.length <= 1024 &&
    path.split('/').every(p => /^[A-Za-z0-9_.-]+$/.test(p) && !['.','..'].includes(p)),
    'WFS_BUNDLE_PATH_INVALID');
  return path;
}
function pageFile(name) {
  return /^[a-f0-9]{64}\.geojson$/.test(name) || /^p[0-9]{8}\.json$/.test(name) ||
    /^wfs-rejected-[a-f0-9]{64}\.json$/.test(name);
}
function allowed(path) {
  cleanPath(path);
  if (path === 'project.json') return true;
  if(path.startsWith('native-vectors/'))return isWfsVectorPath(path);
  const p = path.split('/');
  if (['sources','schemas'].includes(p[0]) && OP.test(p[1] ?? '')) {
    return p.length === 3 && DOC_FILES.has(p[2]) ||
      p.length === 4 && p[2] === 'failed-responses' && /^[a-f0-9]{64}\.(?:bin|json)$/.test(p[3]);
  }
  if (p[0] === 'orders' && HASH.test(p[1] ?? '') && p[2] === 'capture') {
    return p.length === 4 && p[3] === 'capture.json' ||
      p.length === 5 && p[3] === 'pages' && pageFile(p[4]);
  }
  if (p[0] === 'comparisons') return p.length === 2 && /^[a-f0-9]{64}\.json$/.test(p[1]);
  if (p[0] === 'publications' && HASH.test(p[1] ?? '')) {
    return p.length === 3 && EXPORT_FILES.has(p[2]) ||
      p.length === 4 && p[2] === 'source' && p[3] === 'capture.json' ||
      p.length === 5 && p[2] === 'source' && p[3] === 'pages' && pageFile(p[4]);
  }
  return false;
}
function ignored(name) {
  return name === 'publisher.lock' || /^\.pending-[a-f0-9-]{36}$/.test(name) ||
    /^\.wfs-staged-[a-f0-9]{64}$/.test(name) || /^\.ogc-put-[a-f0-9-]{36}$/.test(name) ||
    /^\.csv-[a-f0-9-]{36}$/.test(name);
}
function decodeJson(value,path) {
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));}
  catch {throw fault('WFS_BUNDLE_JSON_INVALID','Invalid retained JSON: '+path);}
}
function projectIndex(value) {
  keys(value,PROJECT_KEYS,'WFS_BUNDLE_PROJECT_INVALID');
  need(value.schema === PROJECT && UUID.test(value.id ?? '') &&
    typeof value.name === 'string' && value.name.trim() && value.name.length <= 128 &&
    !/[\x00-\x1f]/.test(value.name) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    validDate(value.createdAt) && validDate(value.updatedAt),'WFS_BUNDLE_PROJECT_INVALID');
  for (const name of ARRAYS) {
    need(Array.isArray(value[name]),'WFS_BUNDLE_PROJECT_INVALID');
    const ids = new Set();
    for (const row of value[name]) {
      need(object(row) && (name === 'operations' ? OP : HASH).test(row.id ?? '') &&
        !ids.has(row.id),'WFS_BUNDLE_PROJECT_ID_COLLISION');ids.add(row.id);
    }
  }
  need(value.operations.length === value.revision,'WFS_BUNDLE_HISTORY_CHANGED');
  for (const [revision,op] of value.operations.entries())
    need(KINDS.has(op.kind) && HASH.test(op.payloadSha256 ?? '') && op.expectedRevision === revision &&
      validDate(op.completedAt) && object(op.result),'WFS_BUNDLE_HISTORY_CHANGED');
  if (value.pending !== null) {
    const pending = value.pending;
    need(object(pending) && OP.test(pending.id ?? '') && KINDS.has(pending.kind) &&
      pending.kind !== 'abandon' && !value.operations.some(op => op.id === pending.id) &&
      pending.expectedRevision === value.revision && object(pending.payload) &&
      pending.payloadSha256 === identity(pending.payload) && validDate(pending.startedAt),
      'WFS_BUNDLE_PENDING_CHANGED');
  }
  return value;
}
function selected(rows,id,kind) {
  const row = rows.find(item => item.id === id);
  need(row,'WFS_BUNDLE_'+kind+'_MISSING');return row;
}
function sameOrigin(href,expected) {
  const actual = new URL(href), origin = new URL(expected).origin;
  need(actual.origin === origin && !actual.username && !actual.password && !actual.hash,
    'WFS_BUNDLE_SOURCE_ORIGIN_CHANGED');return actual.href;
}
function memberView(files) {
  const map = new Map(files.map(file => [file.path,file]));
  const get = path => {
    const row = map.get(path);need(row,'WFS_BUNDLE_MEMBER_MISSING','The complete source member is missing: '+path);
    return Buffer.from(row.base64,'base64');
  };
  const json = path => decodeJson(get(path),path);
  return {map,get,json,has:path => map.has(path)};
}
function documentAt(view,base) {
  if (!view.has(base+'/document.json')) return null;
  const record = view.json(base+'/document.json');
  need(record.schema === 'stellar-forge.wfs-document.v1' && ['capabilities','schema'].includes(record.kind) &&
    HASH.test(record.sha256 ?? '') && HASH.test(record.modelSha256 ?? '') &&
    Number.isSafeInteger(record.bytes) && record.bytes >= 0 && validDate(record.fetchedAt),
    'WFS_BUNDLE_DOCUMENT_INVALID');
  need(record.id === identity({kind:record.kind,requestedUrl:record.requestedUrl,url:record.url,
    sha256:record.sha256,modelSha256:record.modelSha256,bytes:record.bytes,
    fetchedAt:record.fetchedAt,headers:record.headers}),'WFS_BUNDLE_DOCUMENT_CHANGED');
  const raw = view.map.get(base+'/response.bin'), modelBytes = view.map.get(base+'/model.json');
  need(raw && modelBytes && raw.sha256 === record.sha256 && raw.bytes === record.bytes &&
    modelBytes.sha256 === record.modelSha256,'WFS_BUNDLE_DOCUMENT_BYTES_CHANGED');
  const model = view.json(base+'/model.json');
  need(model.schema === (record.kind === 'capabilities' ? 'stellar-forge.wfs-capabilities.v1' :
    'stellar-forge.wfs-feature-schema.v1'),'WFS_BUNDLE_DOCUMENT_KIND_CHANGED');
  if (view.has(base+'/request.json')) {
    const request = view.json(base+'/request.json');
    need(request.schema === 'stellar-forge.wfs-document-request.v1' &&
      request.kind === record.kind && request.url === record.requestedUrl,'WFS_BUNDLE_DOCUMENT_REQUEST_CHANGED');
  }
  return {record,model};
}
function captureAt(view,base) {
  if (!view.has(base+'/capture.json')) return null;
  const value = view.json(base+'/capture.json'), config = validateSourceConfig(value.config);
  need(value.schema === 'stellar-forge.ogc-capture.v1' && value.pages === undefined &&
    config.kind === 'wfs2' && value.config.authorizationEnv === undefined &&
    Number.isSafeInteger(value.pageCount) && value.pageCount >= 0 && value.pageCount <= 1000000,
    'WFS_BUNDLE_CAPTURE_INVALID');
  const selection = withoutLimits(value.config);
  need(value.sourceId === identity({selection,head:value.head,pageCount:value.pageCount,rows:value.rows,
    totalBytes:value.totalBytes,next:value.next,complete:value.complete}),'WFS_BUNDLE_CAPTURE_CHANGED');
  let next = config.itemsUrl, head = identity(selection), total = 0, rows = 0;
  const pages = [], seen = new Set();
  const readPage = (number,previous,requested) => {
    const name = base+'/pages/p'+String(number).padStart(8,'0')+'.json', index = view.json(name), page = index.page;
    need(object(page) && index.previous === previous && page.requestedUrl === requested &&
      !seen.has(requested) && index.head === identity({previous,page}) &&
      page.file === page.sha256+'.geojson' && /^[a-f0-9]{64}\.geojson$/.test(page.file ?? '') &&
      Number.isSafeInteger(page.bytes) && page.bytes >= 0 && page.bytes <= config.pageBytes,
      'WFS_BUNDLE_CAPTURE_CHAIN_CHANGED');
    sameOrigin(page.url,config.itemsUrl);sameOrigin(page.requestedUrl,config.itemsUrl);
    const path = base+'/pages/'+page.file, payload = view.map.get(path);
    need(payload && payload.bytes === page.bytes && payload.sha256 === page.sha256,
      'WFS_BUNDLE_CAPTURE_BYTES_CHANGED');
    const details = pageDetails({...page,document:parseSource(view.get(path))},config);
    need(details.returned === page.returned && details.matched === page.matched && details.next === page.next,
      'WFS_BUNDLE_CAPTURE_CHAIN_CHANGED');
    checkWfsCoverage(pages,page);
    return {index,page};
  };
  for (let i=0;i<value.pageCount;i++) {
    const {index,page} = readPage(i,head,next);
    seen.add(next);pages.push(page);head=index.head;next=page.next;total+=page.bytes;rows+=page.returned;
  }
  need(value.head === head && value.next === next && value.rows === rows && value.totalBytes === total &&
    value.complete === (next === null),'WFS_BUNDLE_CAPTURE_CHAIN_CHANGED');
  // Preserve and validate the one original page saved immediately before the header commit.
  const pendingPath = base+'/pages/p'+String(value.pageCount).padStart(8,'0')+'.json';
  if (view.has(pendingPath)) {
    need(next !== null,'WFS_BUNDLE_EXTRA_CAPTURE_INDEX');
    readPage(value.pageCount,head,next);
  }
  for (const path of view.map.keys()) {
    if (path.startsWith(base+'/pages/')) {
      const name = path.slice((base+'/pages/').length);
      if (/^p[0-9]{8}\.json$/.test(name))
        need(Number(name.slice(1,9)) <= value.pageCount,'WFS_BUNDLE_EXTRA_CAPTURE_INDEX');
      if (/^[a-f0-9]{64}\.geojson$/.test(name))
        need(view.map.get(path).sha256 === name.slice(0,-8),'WFS_BUNDLE_RAW_PAGE_CHANGED');
    }
  }
  return {...value,pages};
}
function publicationAt(view,base) {
  if (!view.has(base+'/export.json')) return null;
  const result = view.json(base+'/export.json'), names = new Set();
  need(result.schema === 'stellar-forge.ogc-export.v1' && Array.isArray(result.files) &&
    HASH.test(result.operationId ?? '') && HASH.test(result.sourceId ?? '') &&
    HASH.test(result.planId ?? '') && object(result.dataset),'WFS_BUNDLE_EXPORT_INVALID');
  for (const file of result.files) {
    cleanPath(file.path);
    need(!names.has(file.path) && file.path !== 'export.json' &&
      allowed(base+'/'+file.path),'WFS_BUNDLE_EXPORT_SELECTION_INVALID');names.add(file.path);
    const actual = view.map.get(base+'/'+file.path);
    need(actual && actual.bytes === file.bytes && actual.sha256 === file.sha256,
      'WFS_BUNDLE_EXPORT_MEMBER_CHANGED','Keep the exact published member: '+base+'/'+file.path);
  }
  for (const name of ['features.csv','dataset.json','plan.json','source/capture.json'])
    need(names.has(name),'WFS_BUNDLE_EXPORT_MEMBER_MISSING');
  const dataset = view.json(base+'/dataset.json'), plan = view.json(base+'/plan.json');
  need(dataset.schema === 'stellar-forge.csv-dataset.v1' && dataset.file === 'features.csv' &&
    plan.schema === 'stellar-forge.ogc-plan.v1' && identity(plan) === result.planId &&
    plan.sourceId === result.sourceId,'WFS_BUNDLE_EXPORT_BINDING_CHANGED');
  const source = captureAt(view,base+'/source');
  need(source?.complete && source.sourceId === result.sourceId && source.rows === result.dataset.rowCount,
    'WFS_BUNDLE_EXPORT_SOURCE_CHANGED');
  return result;
}
function partialDocuments(view) {
  const folders = new Set();
  for (const path of view.map.keys()) {
    const match = /^((?:sources|schemas)\/[^/]+)\//.exec(path);
    if (match) folders.add(match[1]);
  }
  const validateMetadata = (value,request) => {
    need(object(value) && Number.isSafeInteger(value.status) && value.status >= 100 && value.status <= 599 &&
      Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= 8*1024*1024 &&
      HASH.test(value.sha256 ?? '') && validDate(value.fetchedAt) && value.requestedUrl === request.url,
      'WFS_BUNDLE_RESPONSE_BINDING_CHANGED');
    sameOrigin(value.url,request.url);
    need(value.headers === undefined || object(value.headers) &&
      Object.keys(value.headers).every(name => ['content-type','content-crs','etag','last-modified','date','retry-after'].includes(name) &&
        typeof value.headers[name] === 'string'),'WFS_BUNDLE_RESPONSE_HEADERS_CHANGED');
  };
  for (const base of folders) {
    const request=view.json(base+'/request.json');
    need(request.schema === 'stellar-forge.wfs-document-request.v1' &&
      request.kind === (base.startsWith('sources/')?'capabilities':'schema'),'WFS_BUNDLE_DOCUMENT_REQUEST_CHANGED');
    const selected=new URL(request.url);
    need(!selected.username&&!selected.password&&!selected.hash&&
      ['https:','http:'].includes(selected.protocol),'WFS_BUNDLE_DOCUMENT_REQUEST_CHANGED');
    const pending=view.has(base+'/pending-response.json')?view.json(base+'/pending-response.json'):null;
    if(pending) {
      validateMetadata(pending,request);need(pending.status===200,'WFS_BUNDLE_RESPONSE_BINDING_CHANGED');
    }
    if(view.has(base+'/response.bin')) {
      const file=view.map.get(base+'/response.bin');
      need(pending&&file.bytes===pending.bytes&&file.sha256===pending.sha256,
        'WFS_BUNDLE_RESPONSE_BYTES_CHANGED');
    }
    if(view.has(base+'/model.json'))need(view.has(base+'/response.bin'),'WFS_BUNDLE_RESPONSE_BYTES_CHANGED');
    if(view.has(base+'/unreceived-response.json'))validateMetadata(view.json(base+'/unreceived-response.json'),request);
    for(const path of view.map.keys()) {
      if(!path.startsWith(base+'/failed-responses/'))continue;
      const match=/\/([a-f0-9]{64})\.(json|bin)$/.exec(path);
      need(match,'WFS_BUNDLE_FAILURE_INVALID');
      const metadata=view.json(base+'/failed-responses/'+match[1]+'.json');
      validateMetadata(metadata,request);
      need(metadata.status!==200&&identity(metadata)===match[1],'WFS_BUNDLE_FAILURE_CHANGED');
      const raw=view.map.get(base+'/failed-responses/'+match[1]+'.bin');
      need(raw&&raw.bytes===metadata.bytes&&raw.sha256===metadata.sha256,'WFS_BUNDLE_FAILURE_BYTES_CHANGED');
    }
    if(view.has(base+'/last-error.json')) {
      const failure=view.json(base+'/last-error.json');
      need(HASH.test(failure.response??'')&&view.has(base+'/failed-responses/'+failure.response+'.json'),
        'WFS_BUNDLE_FAILURE_REFERENCE_CHANGED');
    }
  }
}
function validateBindings(index,view) {
  partialDocuments(view);
  const documents = new Map(), captures = new Map(), publications = new Map();
  for (const path of view.map.keys()) {
    if (/^(?:sources|schemas)\/[^/]+\/document\.json$/.test(path)) {
      const base = path.slice(0,-14);documents.set(base,documentAt(view,base));
    }
    if (/^orders\/[a-f0-9]{64}\/capture\/capture\.json$/.test(path)) {
      const base = path.slice(0,-13);captures.set(base,captureAt(view,base));
    }
    if (/^publications\/[a-f0-9]{64}\/export\.json$/.test(path)) {
      const base = path.slice(0,-12);publications.set(base,publicationAt(view,base));
    }
  }
  for (const source of index.sources) {
    need(/^sources\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(source.directory ?? '') &&
      typeof source.terms === 'string' && source.terms.length <= 16384,'WFS_BUNDLE_SOURCE_INVALID');
    endpointUrl(source.endpoint,{allowLoopback:source.allowLoopback === true});
    const document = documents.get(source.directory);
    need(document?.record.kind === 'capabilities' && document.record.id === source.id &&
      document.record.sha256 === source.documentSha256 && source.capturedAt === document.record.fetchedAt &&
      document.record.requestedUrl === wfsRequest(source.endpoint,'GetCapabilities',{},
        {allowLoopback:source.allowLoopback === true}) && source.title === document.model.title &&
      source.featureTypes === document.model.featureTypes.length,'WFS_BUNDLE_SOURCE_BINDING_CHANGED');
    sameOrigin(document.record.url,source.endpoint);
  }
  for (const schema of index.schemas) {
    const source = selected(index.sources,schema.sourceId,'SOURCE');
    need(/^schemas\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(schema.directory ?? ''),'WFS_BUNDLE_SCHEMA_INVALID');
    const document = documents.get(schema.directory), catalog = documents.get(source.directory)?.model;
    const parts = String(schema.typeName).split(':'), definition = document?.model.features?.find(f => f.name === parts[1]);
    need(document?.record.kind === 'schema' && document.record.id === schema.id &&
      document.record.sha256 === schema.documentSha256 && document.record.fetchedAt === schema.capturedAt &&
      catalog?.featureTypes.some(feature => feature.name === schema.typeName) &&
      catalog.namespaces[parts[0]] === document.model.targetNamespace && definition?.complexTypeResolved &&
      same(schema.properties,definition.properties) && same(schema.imports,document.model.imports) &&
      document.record.requestedUrl === wfsRequest(source.endpoint,'DescribeFeatureType',{typeNames:schema.typeName},
        {allowLoopback:source.allowLoopback === true}),'WFS_BUNDLE_SCHEMA_BINDING_CHANGED');
    sameOrigin(document.record.url,source.endpoint);
  }
  for (const query of index.queries) {
    const source = selected(index.sources,query.sourceId,'SOURCE'), schema = selected(index.schemas,query.schemaId,'SCHEMA');
    const config = validateSourceConfig(query.config), selection = normalizeWfsSelection(config.wfs);
    need(config.kind === 'wfs2' && config.authorizationEnv === undefined && schema.sourceId === source.id &&
      schema.typeName === selection.typeName && query.name === config.name &&
      query.id === identity({sourceId:source.id,schemaId:schema.id,name:query.name,selection}) &&
      config.itemsUrl === wfsItemsUrl(source.endpoint,selection,{allowLoopback:source.allowLoopback === true}) &&
      config.license === source.terms && config.collection?.sourceId === source.id &&
      config.collection.schemaId === schema.id && config.collection.endpoint === source.endpoint &&
      config.collection.capabilitiesSha256 === source.documentSha256 &&
      config.collection.describeFeatureTypeSha256 === schema.documentSha256 &&
      same(config.collection.sourceSchema,schema.properties),'WFS_BUNDLE_QUERY_BINDING_CHANGED');
  }
  for (const order of index.orders) {
    const query = selected(index.queries,order.queryId,'QUERY');
    need(order.directory === 'orders/'+order.id && order.sourceId === query.sourceId && order.schemaId === query.schemaId &&
      ['ACQUIRING','PARTIAL','READY'].includes(order.state),'WFS_BUNDLE_ORDER_INVALID');
    const capture = captures.get(order.directory+'/capture');
    if (capture) need(same(withoutLimits(validateSourceConfig(capture.config)),
      withoutLimits(validateSourceConfig(query.config))),'WFS_BUNDLE_ORDER_SELECTION_CHANGED');
    if (order.state === 'READY')
      need(capture?.complete && capture.sourceId === order.captureId && capture.rows === order.rows &&
        capture.pageCount === order.pages && capture.totalBytes === order.bytes,'WFS_BUNDLE_ORDER_CAPTURE_CHANGED');
  }
  for(const [path,capture] of captures) {
    need(index.queries.some(query=>same(withoutLimits(validateSourceConfig(query.config)),
      withoutLimits(validateSourceConfig(capture.config)))),'WFS_BUNDLE_CAPTURE_PROJECT_CHANGED',path);
  }
  for (const entry of index.comparisons) {
    need(entry.path === 'comparisons/'+entry.id+'.json','WFS_BUNDLE_COMPARISON_INVALID');
    const row = view.map.get(entry.path), value = view.json(entry.path);
    const before = selected(index.orders,entry.before,'ORDER'), after = selected(index.orders,entry.after,'ORDER');
    need(row.sha256 === entry.id && value.schema === 'stellar-forge.wfs-comparison.v1' &&
      value.before === entry.before && value.after === entry.after && same(value.counts,entry.counts) &&
      value.beforeCapture === before.captureId && value.afterCapture === after.captureId,
      'WFS_BUNDLE_COMPARISON_CHANGED');
  }
  for (const entry of index.publications) {
    need(entry.directory === 'publications/'+entry.id,'WFS_BUNDLE_PUBLICATION_INVALID');
    const order = selected(index.orders,entry.orderId,'ORDER'), publication = publications.get(entry.directory);
    need(order.state === 'READY' && publication?.sourceId === order.captureId &&
      publication.operationId === entry.operationId && publication.sourceId === entry.sourceId &&
      publication.dataset.snapshot === entry.snapshot && publication.dataset.rowCount === entry.rows,
      'WFS_BUNDLE_PUBLICATION_CHANGED');
  }
  for(const [base,publication] of publications) {
    need([...captures.values()].some(capture=>capture.complete&&capture.sourceId===publication.sourceId),
      'WFS_BUNDLE_PUBLICATION_SOURCE_MISSING');
    const selected=new Set(['export.json','preparing.json',...publication.files.map(file=>file.path)]);
    for(const path of view.map.keys())if(path.startsWith(base+'/'))
      need(selected.has(path.slice(base.length+1)),'WFS_BUNDLE_UNSELECTED_PUBLICATION_MEMBER',path);
  }
  for(const path of view.map.keys()) {
    if(!/^publications\/[a-f0-9]{64}\/preparing\.json$/.test(path))continue;
    const base=path.slice(0,-15), preparing=view.json(path);
    need(preparing.schema==='stellar-forge.ogc-export-preparing.v1'&&HASH.test(preparing.operationId??'')&&
      HASH.test(preparing.planId??'')&&[...captures.values()].some(capture=>capture.complete&&capture.sourceId===preparing.sourceId),
      'WFS_BUNDLE_PUBLICATION_PREPARATION_CHANGED');
    if(view.has(base+'/plan.json'))need(identity(view.json(base+'/plan.json'))===preparing.planId,
      'WFS_BUNDLE_PUBLICATION_PREPARATION_CHANGED');
    if(view.has(base+'/dataset.json'))need(view.json(base+'/dataset.json').file==='features.csv',
      'WFS_BUNDLE_PUBLICATION_PREPARATION_CHANGED');
  }
  return {documents:[...documents.keys()],captures:[...captures.keys()],publications:[...publications.keys()]};
}
function unpack(bundle,{maxBytes = WFS_PROJECT_BUNDLE_DEFAULT_BYTES} = {}) {
  const maximum = budget(maxBytes);
  keys(bundle,['schema','project','totalBytes','files','bundleSha256'],'WFS_BUNDLE_INVALID');
  keys(bundle.project,['id','name','revision','indexSha256','indexBytes'],'WFS_BUNDLE_PROJECT_HEADER_INVALID');
  need(bundle.schema === WFS_PROJECT_BUNDLE_SCHEMA && HASH.test(bundle.bundleSha256 ?? '') &&
    Array.isArray(bundle.files) && bundle.files.length >= 1 && bundle.files.length <= 100000 &&
    Number.isSafeInteger(bundle.totalBytes) && bundle.totalBytes > 0 && bundle.totalBytes <= maximum,
    'WFS_BUNDLE_INVALID');
  const rows = [], seen = new Set();let total = 0, previous = '';
  let encodedBytes = Buffer.byteLength(JSON.stringify({...bundle,files:[]}));
  for (const [i,file] of bundle.files.entries()) {
    keys(file,['path','bytes','sha256','base64'],'WFS_BUNDLE_MEMBER_INVALID');cleanPath(file.path);
    need(allowed(file.path) && file.path > previous && !seen.has(file.path) &&
      Number.isSafeInteger(file.bytes) && file.bytes >= 0 && HASH.test(file.sha256 ?? '') &&
      typeof file.base64 === 'string' && file.base64.length === 4*Math.ceil(file.bytes/3),
      'WFS_BUNDLE_MEMBER_INVALID');previous=file.path;seen.add(file.path);
    encodedBytes += Buffer.byteLength(JSON.stringify(file))+(i ? 1 : 0);
    need(encodedBytes <= maximum,'WFS_BUNDLE_TOO_LARGE','The complete JSON handover exceeds maxBytes; no members were omitted.');
    const payload = Buffer.from(file.base64,'base64');
    need(payload.length === file.bytes && payload.toString('base64') === file.base64 &&
      digest(payload) === file.sha256,'WFS_BUNDLE_MEMBER_CHANGED',file.path);
    total += file.bytes;need(Number.isSafeInteger(total) && total <= maximum,'WFS_BUNDLE_TOO_LARGE');
    rows.push({path:file.path,bytes:file.bytes,sha256:file.sha256});
  }
  need(total === bundle.totalBytes,'WFS_BUNDLE_SIZE_CHANGED');
  const {bundleSha256,...body} = bundle;
  need(identity(body) === bundleSha256,'WFS_BUNDLE_CHANGED');
  const view = memberView(bundle.files), original = view.map.get('project.json');
  need(original && original.bytes <= 8*1024*1024 && original.bytes === bundle.project.indexBytes &&
    original.sha256 === bundle.project.indexSha256,'WFS_BUNDLE_INDEX_CHANGED');
  const index = projectIndex(view.json('project.json'));
  need(index.id === bundle.project.id && index.name === bundle.project.name &&
    index.revision === bundle.project.revision,'WFS_BUNDLE_PROJECT_CHANGED');
  const closure = validateBindings(index,view);
  closure.vectors=inspectWfsVectorMembers(index,view);
  const counts = Object.fromEntries(ARRAYS.map(name => [name,index[name].length]));
  counts.pending = index.pending !== null;
  counts.nativeVectors=closure.vectors.operations.length;
  return {index,view,closure,inspection:{schema:bundle.schema,bundleSha256,project:clone(bundle.project),
    totalBytes:total,encodedBytes,files:rows,counts}};
}
/** Pure full-byte inspection. Page semantics use the original lossless WFS source engine. */
export function inspectWfsProjectBundle(bundle,options = {}) {
  return unpack(bundle,options).inspection;
}
async function entries(path) {
  try {await privateDirectory(path);return await readdir(path,{withFileTypes:true});}
  catch (error) {if (error.code === 'ENOENT') return [];throw error;}
}
async function selectedFiles(directory,indexBytes,maximum) {
  const names = new Set(['project.json']);
  async function visit(relative) {
    const path = join(directory,relative);
    for (const item of await entries(path)) {
      if (ignored(item.name)) continue;
      const name = relative+'/'+item.name;
      if (item.isSymbolicLink()) throw fault('WFS_BUNDLE_PRIVATE_FILE_REQUIRED',name);
      if (item.isDirectory()) {
        const parts = name.split('/');
        const accepted =
          ['sources','schemas'].includes(parts[0]) && (parts.length === 2 && OP.test(parts[1]) ||
            parts.length === 3 && parts[2] === 'failed-responses') ||
          parts[0] === 'orders' && (parts.length === 2 && HASH.test(parts[1]) ||
            parts.length === 3 && parts[2] === 'capture' || parts.length === 4 && parts[3] === 'pages') ||
          parts[0] === 'publications' && (parts.length === 2 && HASH.test(parts[1]) ||
            parts.length === 3 && parts[2] === 'source' || parts.length === 4 && parts[3] === 'pages');
        if (parts[0] === 'publications' && parts.length === 3 &&
          ['commerce','customer-datasets','customer-requests'].includes(parts[2])) continue;
        need(accepted,'WFS_BUNDLE_UNSELECTED_DIRECTORY','Select the original WFS project directory: '+name);
        await visit(name);
      } else {
        need(item.isFile() && allowed(name),'WFS_BUNDLE_UNSELECTED_FILE','Unrecognized WFS source member: '+name);
        names.add(name);
      }
    }
  }
  for (const root of ['sources','schemas','orders','comparisons','publications']) await visit(root);
  // A completed edition carries its explicit original export selection. Extra
  // application/runtime files are never acquired by walking commerce or buyers.
  for (const name of [...names]) {
    if (!/^publications\/[a-f0-9]{64}\/export\.json$/.test(name)) continue;
    const base = name.slice(0,-12), record = await readJson(join(directory,name),32*1024*1024);
    need(record.schema === 'stellar-forge.ogc-export.v1' && Array.isArray(record.files),'WFS_BUNDLE_EXPORT_INVALID');
    const selected = new Set([name,base+'/preparing.json',...record.files.map(file => base+'/'+cleanPath(file.path))]);
    for (const file of record.files) {
      const selectedPath = base+'/'+file.path;
      need(allowed(selectedPath) && names.has(selectedPath),'WFS_BUNDLE_EXPORT_MEMBER_MISSING',selectedPath);
    }
    for (const candidate of [...names])
      if (candidate.startsWith(base+'/') && !selected.has(candidate)) names.delete(candidate);
  }
  for(const name of await wfsVectorFiles(directory))names.add(name);
  const files=[];let total=0;
  for (const name of sorted(names)) {
    const value = name === 'project.json' ? indexBytes : await readPrivate(join(directory,name),maximum-total);
    total += value.length;need(total <= maximum,'WFS_BUNDLE_TOO_LARGE','The complete project exceeds maxBytes.');
    files.push({path:name,bytes:value.length,sha256:digest(value),base64:value.toString('base64')});
  }
  return {files,total};
}
async function verifyOriginal(directory,closure,options={}) {
  for (const path of closure.documents) await readWfsDocument(join(directory,path));
  for (const path of closure.captures) await readCapture(join(directory,path));
  for (const path of closure.publications) await reopenExport(join(directory,path));
  await verifyWfsVectors(directory,closure.vectors,{...options,leaseHeld:true});
}
/** Snapshot under the original project lease, without changing any source or index. */
export async function exportWfsProject({directory,maxBytes = WFS_PROJECT_BUNDLE_DEFAULT_BYTES,python,signal}) {
  const maximum=budget(maxBytes);directory=resolve(directory);await privateDirectory(directory);
  const release=await acquireWorkspace(directory);
  try {
    const index=await readWfsProject(directory), indexBytes=await readPrivate(join(directory,'project.json'),8*1024*1024);
    need(same(index,decodeJson(indexBytes,'project.json')),'WFS_BUNDLE_INDEX_CHANGED');
    const selected=await selectedFiles(directory,indexBytes,maximum);
    const body={schema:WFS_PROJECT_BUNDLE_SCHEMA,project:{id:index.id,name:index.name,revision:index.revision,
      indexSha256:digest(indexBytes),indexBytes:indexBytes.length},totalBytes:selected.total,files:selected.files};
    const bundle={...body,bundleSha256:identity(body)}, checked=unpack(bundle,{maxBytes:maximum});
    await verifyOriginal(directory,checked.closure,{python,signal});
    need((await readPrivate(join(directory,'project.json'),indexBytes.length)).equals(indexBytes),
      'WFS_BUNDLE_INDEX_CHANGED');
    return bundle;
  } finally {await release();}
}
async function exists(path) {
  try {return await lstat(path);} catch(error) {if(error.code==='ENOENT')return null;throw error;}
}
async function durableTree(path) {
  path=resolve(path);const missing=[];let cursor=path;
  while (!await exists(cursor)) {missing.push(cursor);const parent=dirname(cursor);need(parent!==cursor,'WFS_RECEIVING_PARENT_MISSING');cursor=parent;}
  const anchor=await lstat(cursor);
  need(anchor.isDirectory()&&!anchor.isSymbolicLink()&&await realpath(cursor)===cursor,'WFS_RECEIVING_PARENT_INVALID');
  // Sync the existing anchor on replay, including a previous mkdir-before-fsync interruption.
  await syncDirectory(cursor);if(dirname(cursor)!==cursor)await syncDirectory(dirname(cursor));
  for (const child of missing.reverse()) {
    try {await mkdir(child,{mode:0o700});} catch(error) {if(error.code!=='EEXIST')throw error;}
    await privateDirectory(child);await syncDirectory(child);await syncDirectory(dirname(child));
  }
  await privateDirectory(path);return path;
}
function receiveIntent(bundle,id) {
  need(OP.test(id ?? ''),'WFS_RECEIVING_ID_REQUIRED');
  return {schema:INTENT,id,bundleSha256:bundle.bundleSha256,project:clone(bundle.project),
    totalBytes:bundle.totalBytes,files:bundle.files.length};
}
function receivingState(value,intent) {
  need(value?.schema===RECEIPT && ['RECEIVING','COMPLETE'].includes(value.state) &&
    value.id===intent.id && value.bundleSha256===intent.bundleSha256 &&
    same(value.project,intent.project) && value.totalBytes===intent.totalBytes && value.files===intent.files,
    'WFS_RECEIVING_STATE_CHANGED');
  if(value.state==='COMPLETE')need(validDate(value.receivedAt),'WFS_RECEIVING_STATE_CHANGED');
  return value;
}
function receivingResult(value,directory,currentRevision,reused) {
  return {...clone(value),directory,projectId:value.project.id,revision:value.project.revision,currentRevision,reused};
}
function descendant(original,current) {
  projectIndex(current);
  need(current.id===original.id && current.name===original.name && current.createdAt===original.createdAt &&
    current.revision>=original.revision && original.operations.every((op,i)=>same(op,current.operations[i])),
    'WFS_RECEIVING_PROJECT_CHANGED','Keep the existing project and its original receiving history.');
  for(const name of ['sources','schemas','queries','publications','comparisons'])
    for(const old of original[name])need(current[name].some(row=>row.id===old.id&&same(row,old)),
      'WFS_RECEIVING_PROJECT_HISTORY_CHANGED');
  for(const old of original.orders) {
    const now=current.orders.find(row=>row.id===old.id);need(now,'WFS_RECEIVING_PROJECT_HISTORY_CHANGED');
    const fields=old.state==='READY'?Object.keys(old):['id','queryId','sourceId','schemaId','directory','createdAt'];
    need(fields.every(field=>same(now[field],old[field])),'WFS_RECEIVING_PROJECT_HISTORY_CHANGED');
  }
  if(original.pending && current.revision===original.revision)
    need(current.pending && ['id','kind','payloadSha256','expectedRevision'].every(k=>current.pending[k]===original.pending[k]),
      'WFS_RECEIVING_PENDING_CHANGED');
}
async function verifyCompletedReceive(directory,checked,current,options={}) {
  for(const file of checked.view.map.values()) {
    if(file.path==='project.json'||/\/(?:pending-response|last-error|unreceived-response)\.json$/.test(file.path)||
      wfsVectorMutableReplayPath(file.path,checked.closure.vectors))continue;
    if(/^orders\/[a-f0-9]{64}\/capture\/capture\.json$/.test(file.path)&&
      checked.view.json(file.path).complete===false)continue;
    const actual=await hashPrivate(join(directory,file.path),file.bytes);
    need(actual.bytes===file.bytes&&actual.hash===file.sha256,'WFS_RECEIVING_RETAINED_MEMBER_CHANGED',file.path);
  }
  await verifyOriginal(directory,checked.closure,options);
  for(const source of current.sources)await readWfsCatalog(directory,source.id);
  for(const schema of current.schemas) {
    const actual=await readWfsDocument(join(directory,schema.directory));
    need(actual.record.id===schema.id&&actual.record.sha256===schema.documentSha256,
      'WFS_RECEIVING_SCHEMA_CHANGED');
  }
  for(const order of current.orders) {
    if(order.state==='READY'||await exists(join(directory,order.directory,'capture','capture.json'))) {
      const actual=await getWfsOrder(directory,order.id);
      const query=selected(current.queries,order.queryId,'QUERY');
      need(same(withoutLimits(validateSourceConfig(actual.capture.config)),
        withoutLimits(validateSourceConfig(query.config))),'WFS_RECEIVING_ORDER_CHANGED');
    }
  }
  for(const publication of current.publications)await getWfsPublication(directory,publication.id);
  for(const comparison of current.comparisons) {
    const actual=await hashPrivate(join(directory,comparison.path),256*1024*1024);
    need(actual.hash===comparison.id,'WFS_RECEIVING_COMPARISON_CHANGED');
  }
}
async function requireOwnedTarget(directory,intent,view) {
  const expected=new Set([...view.map.keys(),'receiving-intent.json','receiving.json','publisher.lock']);
  const parents=new Set();
  for(const path of expected){const parts=path.split('/');for(let i=1;i<parts.length;i++)parents.add(parts.slice(0,i).join('/'));}
  async function visit(base='') {
    for(const item of await readdir(join(directory,base),{withFileTypes:true})) {
      const path=base?base+'/'+item.name:item.name;
      need(!item.isSymbolicLink(),'WFS_RECEIVING_UNRELATED_TARGET');
      if(item.isDirectory()) {
        need(parents.has(path),'WFS_RECEIVING_UNRELATED_TARGET','The target contains an unrelated directory: '+path);
        await privateDirectory(join(directory,path));await visit(path);
      } else {
        need(item.isFile()&&(expected.has(path)||ignored(item.name)),'WFS_RECEIVING_UNRELATED_TARGET',
          'The target contains an unrelated member: '+path);
      }
    }
  }
  await visit();
}
/** Receive the exact whole project. Repeating a completed receive preserves later customer work. */
export async function receiveWfsProject({directory,bundle,id,maxBytes = WFS_PROJECT_BUNDLE_DEFAULT_BYTES,signal,python}) {
  signal?.throwIfAborted();
  const maximum=budget(maxBytes), checked=unpack(bundle,{maxBytes:maximum});
  directory=resolve(directory);
  if(await exists(directory)) {
    await privateDirectory(directory);
    const entries=await readdir(directory);
    const hasIntent=entries.includes('receiving-intent.json');
    need(hasIntent || entries.every(name=>name==='publisher.lock'||/^\.pending-[a-f0-9-]{36}$/.test(name)),
      'WFS_RECEIVING_UNRELATED_TARGET','Choose an empty receiving directory or this project’s original receiving directory.');
  }
  await durableTree(directory);
  const release=await acquireWorkspace(directory);
  try {
    let previous=await optionalJson(join(directory,'receiving-intent.json'));
    const intent=receiveIntent(bundle,id??previous?.id??('receive-'+bundle.bundleSha256));
    if(previous)need(same(previous,intent),'WFS_RECEIVING_INTENT_CHANGED');
    else {
      need((await readdir(directory)).every(name=>name==='publisher.lock'||/^\.pending-[a-f0-9-]{36}$/.test(name)),
        'WFS_RECEIVING_UNRELATED_TARGET');
      // Atomic rename avoids an unreadable two-link intent at its first commit.
      // Existing committed intents are immutable and are never replaced.
      await atomicJson(directory,'receiving-intent.json',intent);previous=intent;
    }
    let state=await optionalJson(join(directory,'receiving.json'));
    if(state)receivingState(state,intent);
    const finalPath=join(directory,'project.json');
    if(state?.state==='COMPLETE'&&await exists(finalPath)) {
      await reconcileRetainedFile(finalPath,bundle.project.indexSha256);
      const current=await readWfsProject(directory);descendant(checked.index,current);
      await verifyCompletedReceive(directory,checked,current,{python,signal});
      // The complete receipt owns the transfer; later project revisions are never rewritten.
      return receivingResult(state,directory,current.revision,true);
    }
    need(!await exists(finalPath),'WFS_RECEIVING_UNRELATED_TARGET');
    await requireOwnedTarget(directory,intent,checked.view);
    if(!state) {
      state={schema:RECEIPT,state:'RECEIVING',id:intent.id,bundleSha256:intent.bundleSha256,
        project:intent.project,totalBytes:intent.totalBytes,files:intent.files,receivedAt:null};
      await atomicJson(directory,'receiving.json',state);
    }
    const directories=new Set([directory]);
    for(const file of bundle.files) {
      signal?.throwIfAborted();
      if(file.path==='project.json')continue;
      const target=join(directory,file.path), parent=dirname(target);
      await durableTree(parent);directories.add(parent);
      await exactFile(target,checked.view.get(file.path));
    }
    signal?.throwIfAborted();await verifyOriginal(directory,checked.closure,{python,signal});signal?.throwIfAborted();
    // Finish all payload parent entries before the ready marker or visible index.
    for(const path of [...directories].sort((a,b)=>b.length-a.length))await syncDirectory(path);
    await syncDirectory(dirname(directory));
    if(state.state!=='COMPLETE') {
      state={...state,state:'COMPLETE',receivedAt:stamp()};
      await atomicJson(directory,'receiving.json',state);
    } else await syncDirectory(directory);
    await exactFile(finalPath,checked.view.get('project.json'));
    await syncDirectory(directory);await syncDirectory(dirname(directory));
    const current=await readWfsProject(directory);
    need(same(current,checked.index),'WFS_RECEIVING_INDEX_CHANGED');
    return receivingResult(state,directory,current.revision,false);
  } finally {await release();}
}

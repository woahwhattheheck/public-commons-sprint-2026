// MIT. Complete WFS services, saved selections, download orders and customer editions.
import { join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readdir, lstat } from 'node:fs/promises';
import { privateDirectory, acquireWorkspace, readPrivate, readJson, atomicJson, createFile,
  identity, digest, stamp, object, fault, bytes as jsonBytes } from '../postgres/publisher/files.mjs';
import { readCapture, parseSource, sourceText, JsonNumber } from '../ogc/source.mjs';
import { inspectCapture, exportDataset, reopenExport, pointer, features } from '../ogc/project.mjs';
import { createWfsProvider, optionalJson, exactFile, readWfsDocument, durableDirectory } from './source.mjs';
import { normalizeCrs, normalizeWfsSelection, wfsItemsUrl, wfsRequest, endpointUrl } from './protocol.mjs';

const SCHEMA = 'stellar-forge.wfs-project.v1';
const HASH = /^[a-f0-9]{64}$/;
const need = (yes, code, message = code) => { if (!yes) throw fault(code,message); };
const clone = value => JSON.parse(JSON.stringify(value));
const opId = value => need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value),
  'WFS_OPERATION_ID_REQUIRED','Keep an explicit original operation ID.');
const label = value => need(typeof value === 'string' && value.trim().length > 0 &&
  value.length <= 128 && !/[\x00-\x1f]/.test(value),'WFS_NAME_REQUIRED');
const selected = (rows,id,kind) => {need(HASH.test(id ?? ''),'WFS_'+kind+'_ID_REQUIRED');
  const found = rows.find(row => row.id === id);need(found,'WFS_'+kind+'_MISSING');return found;};
export async function initializeWfsProject({directory,name}) {
  directory = resolve(directory);label(name);await durableDirectory(directory);
  const release = await acquireWorkspace(directory);
  try {
    const existing = await optionalJson(join(directory,'project.json'));
    if (existing) { const project = await readWfsProject(directory);need(project.name === name,'WFS_PROJECT_NAME_CHANGED');return project; }
    need(!await optionalJson(join(directory,'receiving-intent.json')) && !await optionalJson(join(directory,'receiving.json')),
      'WFS_RECEIVING_INCOMPLETE','Continue the original project receiving operation.');
    const project = {schema:SCHEMA,id:randomUUID(),name,revision:0,createdAt:stamp(),updatedAt:stamp(),
      sources:[],schemas:[],queries:[],orders:[],publications:[],comparisons:[],operations:[],pending:null};
    await atomicJson(directory,'project.json',project);return project;
  } finally {await release();}
}
export async function readWfsProject(directory) {
  directory = resolve(directory);await privateDirectory(directory);
  const receiving = await optionalJson(join(directory,'receiving.json'));
  need(!receiving || receiving.state === 'COMPLETE','WFS_RECEIVING_INCOMPLETE','Continue the original complete project transfer.');
  const project = await readJson(join(directory,'project.json'),8*1024*1024);
  need(project.schema === SCHEMA && /^[a-f0-9-]{36}$/.test(project.id ?? '') &&
    Number.isSafeInteger(project.revision) && project.revision >= 0 &&
    ['sources','schemas','queries','orders','publications','comparisons','operations'].every(k => Array.isArray(project[k])),
    'WFS_PROJECT_INVALID');
  return project;
}
async function mutation({directory,id,expectedRevision,kind,payload},work) {
  directory = resolve(directory);opId(id);payload = clone(payload);
  await privateDirectory(directory);const release = await acquireWorkspace(directory);
  try {
    const project = await readWfsProject(directory), payloadSha256 = identity(payload);
    const done = project.operations.find(operation => operation.id === id);
    if (done) {
      need(done.kind === kind && done.payloadSha256 === payloadSha256,'WFS_OPERATION_CHANGED');
      return {...done.result,reused:true,revision:project.revision};
    }
    if (project.pending) {
      need(project.pending.id === id && project.pending.kind === kind && project.pending.payloadSha256 === payloadSha256,
        'WFS_ORIGINAL_OPERATION_PENDING','Continue the existing project operation or reopen it explicitly from History.');
      need(expectedRevision === project.pending.expectedRevision,'WFS_OPERATION_REVISION_CHANGED');
    } else {
      need(expectedRevision === project.revision,'WFS_PROJECT_REVISION_CHANGED','Refresh the project and retain its current revision.');
      project.pending = {id,kind,payload,payloadSha256,expectedRevision,startedAt:stamp(),progress:null,lastError:null};
      await atomicJson(directory,'project.json',project);
    }
    const progress = async value => {
      project.pending.progress = value;project.pending.lastError = null;await atomicJson(directory,'project.json',project);
    };
    let result;
    try {result = clone(await work({project,directory,progress}));}
    catch (error) {
      project.pending.lastError = {code:error.code ?? error.name ?? 'WFS_OPERATION_FAILED',
        message:String(error.message).slice(0,1000),observedAt:stamp()};
      try {await atomicJson(directory,'project.json',project);}
      catch (writeError) {error.retentionCode = writeError.code ?? writeError.name;}
      throw error;
    }
    project.revision++;project.updatedAt = stamp();
    project.operations.push({id,kind,payloadSha256,expectedRevision,completedAt:stamp(),result});
    project.pending = null;
    // An interrupted final rename/fsync may already have published this result.
    // Keep that error intact; the next same-ID read reconciles the original index.
    await atomicJson(directory,'project.json',project);
    return {...result,revision:project.revision};
  } finally {await release();}
}
function providerFor(source,options = {}) {
  return createWfsProvider({...options,endpoint:source.endpoint,allowLoopback:source.allowLoopback === true});
}
export async function discoverWfsSource({directory,id,expectedRevision,endpoint,name,terms = '',allowLoopback = false,...options}) {
  endpoint = endpointUrl(endpoint,{allowLoopback});label(name);
  need(typeof terms === 'string' && terms.length <= 16384,'WFS_SOURCE_TERMS_INVALID');
  return mutation({directory,id,expectedRevision,kind:'discover',payload:{endpoint,name,terms,allowLoopback}},
    async ({project,directory}) => {
      const location = join(directory,'sources',id);await durableDirectory(join(directory,'sources'));
      const provider = providerFor({endpoint,allowLoopback},options);
      try {
        const document = await provider.captureDocument({directory:location,kind:'capabilities',
          url:wfsRequest(endpoint,'GetCapabilities',{}, {allowLoopback}),signal:options.signal});
        const source = {id:document.record.id,name,endpoint,terms,allowLoopback,directory:'sources/'+id,
          documentSha256:document.record.sha256,capturedAt:document.record.fetchedAt,title:document.model.title,
          featureTypes:document.model.featureTypes.length};
        const previous = project.sources.find(item => item.id === source.id);
        if (previous) need(identity(previous) === identity(source),'WFS_SOURCE_ID_COLLISION');else project.sources.push(source);
        return {source};
      } finally {await provider.close();}
    });
}
export async function readWfsCatalog(directory,sourceId) {
  const project = await readWfsProject(directory), source = selected(project.sources,sourceId,'SOURCE');
  const document = await readWfsDocument(join(directory,source.directory));
  need(document.record.id === source.id && document.record.sha256 === source.documentSha256,'WFS_SOURCE_BINDING_CHANGED');
  return {source,...document};
}
export async function describeWfsType({directory,id,expectedRevision,sourceId,typeName,...options}) {
  return mutation({directory,id,expectedRevision,kind:'describe',payload:{sourceId,typeName}},async ({project,directory}) => {
    const {source,model:catalog} = await readWfsCatalog(directory,sourceId);
    const feature = catalog.featureTypes.find(item => item.name === typeName);need(feature,'WFS_TYPE_NOT_ADVERTISED');
    const provider = providerFor(source,options);
    try {
      await durableDirectory(join(directory,'schemas'));
      const location = join(directory,'schemas',id), document = await provider.captureDocument({directory:location,kind:'schema',
        url:wfsRequest(source.endpoint,'DescribeFeatureType',{typeNames:typeName},{allowLoopback:source.allowLoopback}),signal:options.signal});
      const parts = typeName.split(':'), definition = document.model.features.find(item => item.name === parts[1]);
      need(catalog.namespaces[parts[0]] === document.model.targetNamespace && definition?.complexTypeResolved,
        'WFS_SCHEMA_TYPE_CHANGED','The returned schema must describe the selected source feature type.');
      const schema = {id:document.record.id,sourceId,typeName,directory:'schemas/'+id,documentSha256:document.record.sha256,
        capturedAt:document.record.fetchedAt,properties:definition.properties,imports:document.model.imports};
      const previous = project.schemas.find(item => item.id === schema.id);
      if (previous) need(identity(previous) === identity(schema),'WFS_SCHEMA_ID_COLLISION');else project.schemas.push(schema);
      return {schema};
    } finally {await provider.close();}
  });
}
export async function saveWfsQuery({directory,id,expectedRevision,sourceId,schemaId,name,selection}) {
  label(name);selection = normalizeWfsSelection(selection);
  return mutation({directory,id,expectedRevision,kind:'save-query',payload:{sourceId,schemaId,name,selection}},
    async ({project,directory}) => {
      const {source,model:catalog} = await readWfsCatalog(directory,sourceId), schema = selected(project.schemas,schemaId,'SCHEMA');
      need(schema.sourceId === sourceId && schema.typeName === selection.typeName,'WFS_QUERY_SCHEMA_CHANGED');
      const schemaDocument = await readWfsDocument(join(directory,schema.directory));
      need(schemaDocument.record.id === schema.id,'WFS_QUERY_SCHEMA_CHANGED');
      const feature = catalog.featureTypes.find(item => item.name === selection.typeName);need(feature,'WFS_TYPE_NOT_ADVERTISED');
      const formats = [...feature.outputFormats,...(catalog.operations.GetFeature.parameters.outputFormat ?? [])];
      need(formats.some(format => /^(?:application\/json|application\/geo\+json|json)(?:;|$)/i.test(format)),'WFS_JSON_NOT_ADVERTISED');
      const advertised = [feature.defaultCrs,...feature.otherCrs].filter(Boolean).map(normalizeCrs);
      need(advertised.includes(normalizeCrs(selection.srsName)) &&
        (!selection.bbox || advertised.includes(normalizeCrs(selection.bboxCrs))), 'WFS_CRS_NOT_ADVERTISED');
      need(selection.sortBy.every(sort => schema.properties.some(property => property.name === sort.property &&
        !property.geometry && property.maxOccurs === '1')),'WFS_SORT_PROPERTY_NOT_ADVERTISED');
      const config = {schema:'stellar-forge.ogc-source.v1',kind:'wfs2',name,
        itemsUrl:wfsItemsUrl(source.endpoint,selection,{allowLoopback:source.allowLoopback}),
        wfs:selection,allowLoopback:source.allowLoopback,license:source.terms,
        coordinateDescription:'Original GeoServer GeoJSON coordinates requested as '+selection.srsName+
          '. Coordinates and numeric lexemes are retained in the returned order.',
        collection:{id:selection.typeName,title:feature.title,sourceId,schemaId,
          capabilitiesSha256:source.documentSha256,describeFeatureTypeSha256:schema.documentSha256,
          endpoint:source.endpoint,sourceSchema:clone(schema.properties),accessConstraints:catalog.accessConstraints}};
      const query = {id:identity({sourceId,schemaId,name,selection}),name,sourceId,schemaId,config,createdAt:stamp()};
      const previous = project.queries.find(item => item.id === query.id);
      if (!previous) project.queries.push(query);
      return {query:previous ?? query};
    });
}
export async function runWfsOrder({directory,id,expectedRevision,queryId,name,limits = {},...options}) {
  label(name);need(object(limits) && Object.keys(limits).every(k => ['pageBytes','totalBytes','maxPages','requestTimeoutMs'].includes(k)),
    'WFS_ORDER_LIMITS_INVALID');
  return mutation({directory,id,expectedRevision,kind:'run-order',payload:{queryId,name}},
    async ({project,directory,progress}) => {
      const query = selected(project.queries,queryId,'QUERY'), source = selected(project.sources,query.sourceId,'SOURCE');
      const orderId = identity({projectId:project.id,operationId:id,queryId});
      let order = project.orders.find(item => item.id === orderId);
      if (!order) {
        order = {id:orderId,name,queryId,sourceId:query.sourceId,schemaId:query.schemaId,
          directory:'orders/'+orderId,createdAt:stamp(),state:'ACQUIRING',captureId:null};
        project.orders.push(order);
      }
      order.state = 'ACQUIRING';order.limits = {...(order.limits ?? {}),...limits};
      await durableDirectory(join(directory,'orders'));await durableDirectory(join(directory,order.directory));
      const provider = providerFor(source,options);
      try {
        const capture = await provider.captureFeatures(join(directory,order.directory,'capture'),{...query.config,...order.limits},
          {signal:options.signal,onPage:async result => {
            await progress({orderId,rows:result.rows,pages:result.pages,next:result.next});
            await options.onPage?.(result);
          }});
        Object.assign(order,{state:'READY',captureId:capture.sourceId,completedAt:stamp(),rows:capture.rows,
          pages:capture.pageCount,bytes:capture.totalBytes,firstReceivedAt:capture.pages[0]?.fetchedAt ?? null,
          lastReceivedAt:capture.pages.at(-1)?.fetchedAt ?? null});
        return {order:clone(order)};
      } catch (error) {order.state = 'PARTIAL';throw error;}
      finally {await provider.close();}
    });
}
export async function getWfsOrder(directory,orderId,{verify = true} = {}) {
  const project = await readWfsProject(directory), order = selected(project.orders,orderId,'ORDER');
  const path = join(directory,order.directory,'capture'), capture = await readCapture(path,{verify});
  if (order.state === 'READY') need(capture.complete && capture.sourceId === order.captureId,'WFS_ORDER_CAPTURE_CHANGED');
  return {project,order,capture,directory:path};
}
export async function inspectWfsOrder(directory,orderId) {
  const selected = await getWfsOrder(directory,orderId);
  return {order:selected.order,inspection:await inspectCapture(selected.directory)};
}
async function* orderFeatures(selection) {
  for await (const row of features(selection.directory,selection.capture)) yield row.feature;
}
export async function pageWfsFeatures({directory,orderId,offset = 0,limit = 100}) {
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000,'WFS_PAGE_INVALID');
  const selected = await getWfsOrder(directory,orderId), features = [];let index = 0;
  for await (const feature of orderFeatures(selected)) {
    if (index >= offset && features.length < limit) features.push(feature);index++;
    if (features.length === limit) break;
  }
  return {orderId,sourceId:selected.capture.sourceId,total:selected.capture.rows,offset,limit,
    coordinates:selected.capture.config.coordinateDescription,features};
}
function canonicalFeature(value) {
  if (value instanceof JsonNumber || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalFeature);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonicalFeature(value[key])]));
}
async function featureIndex(selection,keyPointer) {
  const result = new Map(), missing = [];
  for await (const feature of orderFeatures(selection)) {
    const key = pointer(feature,keyPointer), entry = {sha256:digest(JSON.stringify(canonicalFeature(feature))),feature};
    if (key === undefined || key === null) missing.push(entry);
    else {
      need(typeof key === 'string' || key instanceof JsonNumber,'WFS_COMPARISON_KEY_INVALID','Choose a scalar string or numeric source key.');
      const text = sourceText(key);if (!result.has(text)) result.set(text,[]);result.get(text).push(entry);
    }
  }
  return {entries:result,missing};
}
export async function compareWfsOrders({directory,id,expectedRevision,before,after,keyPointer = '/id'}) {
  need(typeof keyPointer === 'string' && keyPointer.startsWith('/') && keyPointer.length <= 4096,'WFS_COMPARISON_POINTER_INVALID');
  return mutation({directory,id,expectedRevision,kind:'compare',payload:{before,after,keyPointer}},async ({project,directory}) => {
    const a = await getWfsOrder(directory,before), b = await getWfsOrder(directory,after);
    need(a.capture.complete && b.capture.complete && a.capture.config.wfs.typeName === b.capture.config.wfs.typeName &&
      a.capture.config.collection.endpoint === b.capture.config.collection.endpoint &&
      a.capture.config.wfs.srsName === b.capture.config.wfs.srsName,
      'WFS_COMPARISON_SELECTION_CHANGED','Compare complete editions of the same feature type and coordinate representation.');
    const left = await featureIndex(a,keyPointer), right = await featureIndex(b,keyPointer);
    const added = [], removed = [], changed = [], ambiguous = [];let unchanged = 0;
    for (const key of new Set([...left.entries.keys(),...right.entries.keys()])) {
      const previous = left.entries.get(key) ?? [], current = right.entries.get(key) ?? [];
      if (previous.length > 1 || current.length > 1) {ambiguous.push({key,before:previous,after:current});continue;}
      if (!previous.length) added.push({key,after:current[0]});
      else if (!current.length) removed.push({key,before:previous[0]});
      else if (previous[0].sha256 === current[0].sha256) unchanged++;
      else changed.push({key,before:previous[0],after:current[0]});
    }
    const comparison = {schema:'stellar-forge.wfs-comparison.v1',before,after,keyPointer,
      beforeCapture:a.capture.sourceId,afterCapture:b.capture.sourceId,createdAt:project.pending.startedAt,
      sourceSelectionsEqual:identity(a.capture.config.wfs) === identity(b.capture.config.wfs),
      retrievalWindows:{before:[a.order.firstReceivedAt,a.order.lastReceivedAt],after:[b.order.firstReceivedAt,b.order.lastReceivedAt]},
      counts:{before:a.capture.rows,after:b.capture.rows,added:added.length,removed:removed.length,
        changed:changed.length,unchanged,ambiguousKeys:ambiguous.length,missingBefore:left.missing.length,missingAfter:right.missing.length},
      added,removed,changed,ambiguous,missingKeys:{before:left.missing,after:right.missing}};
    const bytes = jsonBytes(comparison), comparisonId = digest(bytes);
    need(bytes.length <= 256*1024*1024,'WFS_COMPARISON_SIZE_LIMIT');
    await durableDirectory(join(directory,'comparisons'));
    await exactFile(join(directory,'comparisons',comparisonId+'.json'),bytes);
    const entry = {id:comparisonId,path:'comparisons/'+comparisonId+'.json',before,after,counts:comparison.counts};
    if (!project.comparisons.some(item => item.id === comparisonId)) project.comparisons.push(entry);
    return {comparison:entry};
  });
}
export async function defaultWfsPlan(directory,orderId) {
  const {order,inspection} = await inspectWfsOrder(directory,orderId);
  const columns = [
    {name:'feature_id',pointer:'/id',type:'string',nullable:true,format:'scalar'},
    {name:'properties',pointer:'/properties',type:'string',nullable:true,format:'json'},
    {name:'geometry',pointer:'/geometry',type:'string',nullable:true,format:'json'}];
  const names = new Set(columns.map(c => c.name)), filters = ['feature_id'], ranges = [], sorts = ['feature_id'];
  for (const field of inspection.properties) {
    if (!field.pointer.startsWith('/properties/') || field.pointer.slice(12).includes('/') || columns.length >= 32 ||
      !Object.keys(field.types).every(type => ['string','integer','number','boolean','null'].includes(type))) continue;
    const base = 'p_'+field.pointer.slice(12).replace(/[^A-Za-z0-9_]/g,'_').toLowerCase().slice(0,40);
    let name = base, suffix = 1;while (names.has(name)) name = base+'_'+suffix++;names.add(name);
    const nonNull = Object.keys(field.types).filter(type => type !== 'null');
    const type = nonNull.length === 1 && nonNull[0] === 'boolean' ? 'boolean' :
      nonNull.length > 0 && nonNull.every(type => ['integer','number'].includes(type)) && !field.unsafeIntegers ?
        nonNull.includes('number') ? 'number' : 'integer' : 'string';
    columns.push({name,pointer:field.pointer,type,nullable:true,format:'scalar'});
    if (filters.length < 12) filters.push(name);if (sorts.length < 12) sorts.push(name);
    if (['number','integer'].includes(type) && ranges.length < 8) ranges.push(name);
  }
  return {schema:'stellar-forge.ogc-plan.v1',sourceId:inspection.sourceId,name:order.name,columns,
    filters,ranges,sorts,defaultLimit:50,maxLimit:250,maxCellChars:65536,nullEmptyPolicy:'native-empty-is-null'};
}
export async function exportWfsOrder({directory,id,expectedRevision,orderId,plan,payment,origin,path = '/features'}) {
  return mutation({directory,id,expectedRevision,kind:'export-order',payload:{orderId,plan,payment,origin,path}},
    async ({project,directory}) => {
      const order = await getWfsOrder(directory,orderId);
      need(order.capture.complete,'WFS_ORDER_INCOMPLETE');
      const selection = plan ?? await defaultWfsPlan(directory,orderId);
      const editionId = identity({orderId,plan:selection,payment,origin,path});
      await durableDirectory(join(directory,'publications'));
      const location = join(directory,'publications',editionId);
      const edition = await exportDataset(order.directory,location,selection,{payment,origin,path});
      const entry = {id:editionId,orderId,directory:'publications/'+editionId,operationId:edition.operationId,
        sourceId:edition.sourceId,snapshot:edition.dataset.snapshot,rows:edition.dataset.rowCount,
        merchantConfigured:Boolean(payment),createdAt:edition.createdAt};
      const prior = project.publications.find(item => item.id === editionId);if (!prior) project.publications.push(entry);
      return {publication:prior ?? entry,edition};
    });
}
export async function getWfsPublication(directory,publicationId) {
  const project = await readWfsProject(directory), publication = selected(project.publications,publicationId,'PUBLICATION');
  const location = join(directory,publication.directory), edition = await reopenExport(location);
  need(edition.operationId === publication.operationId && edition.dataset.snapshot === publication.snapshot,'WFS_PUBLICATION_CHANGED');
  return {publication,edition,directory:location};
}
export async function abandonWfsOperation({directory,id,expectedRevision,pendingId,note}) {
  directory = resolve(directory);opId(id);opId(pendingId);label(note);
  await privateDirectory(directory);const release = await acquireWorkspace(directory);
  try {
    const project = await readWfsProject(directory), payloadSha256 = identity({pendingId,note});
    const done = project.operations.find(item => item.id === id);
    if (done) {need(done.kind === 'abandon' && done.payloadSha256 === payloadSha256,'WFS_OPERATION_CHANGED');return done.result;}
    need(project.revision === expectedRevision && project.pending?.id === pendingId,'WFS_PENDING_OPERATION_CHANGED');
    const abandoned = clone(project.pending), result = {abandonedId:pendingId,retainedProgress:abandoned.progress};
    project.operations.push({id,kind:'abandon',payloadSha256,expectedRevision,completedAt:stamp(),result,note,abandoned});
    project.pending = null;project.revision++;project.updatedAt = stamp();await atomicJson(directory,'project.json',project);
    return {...result,revision:project.revision};
  } finally {await release();}
}

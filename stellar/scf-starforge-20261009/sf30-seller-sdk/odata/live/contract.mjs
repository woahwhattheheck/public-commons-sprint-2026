// MIT. Merchant policy around the original OData catalog, query and page model.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { compileQuery, getEntitySet, canonical, sha256, normalizeSourceUrl } from '../source.mjs';
import { plain, underlyingType } from '../schema.mjs';
export { plain, sha256 as digest };
export const PLAN_SCHEMA = 'stellar-forge.odata-live-merchant.v1';
export const PAGE_SCHEMA = 'stellar-forge.odata-live-page.v1';
export const fail = message => { throw new TypeError(message); };
export function fields(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid ' + label + ' fields');
}
export function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('Invalid ' + label);
  return value;
}
function unique(values, allowed, label, required = false) {
  if (!Array.isArray(values) || values.length > 128 || required && !values.length ||
      values.some(value => typeof value !== 'string' || !allowed.has(value)) || new Set(values).size !== values.length)
    fail('Choose distinct declared ' + label);
  return [...values];
}
export function operationFor(plan, catalog, id) {
  const operation = plan.operations.find(row => row.id === id);
  if (!operation) fail('Unknown OData merchant product');
  return { operation, entity:getEntitySet(catalog,operation.entitySet) };
}
const systemOptions = Object.freeze({ select:'$select', filter:'$filter', orderby:'$orderby',
  top:'$top', skip:'$skip', count:'$count', skiptoken:'$skiptoken' });
export function sourceTarget(catalog, operation) {
  const entity = getEntitySet(catalog,operation.entitySet), url = new URL(entity.url,catalog.serviceUrl);
  const root = new URL(catalog.serviceUrl);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || url.username || url.password || url.hash)
    fail('The selected entity leaves its captured OData service');
  const fixed = Object.create(null), mapping = { ...systemOptions };
  for (const [name,value] of url.searchParams) {
    if (name.startsWith('$') || Object.hasOwn(fixed,name) || !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(name))
      fail('Use a resource URL with distinct fixed provider parameters and no system query options');
    const source = 'provider' + Object.keys(fixed).length; fixed[name] = value; mapping[source] = name;
  }
  return { url, fixed, mapping };
}
export function validatePlan(input, catalog, { allowLoopback = false } = {}) {
  fields(input,['schema','title','publicOrigin','serviceRoot','metadataSha256','headerEnv','oauth2','payment','operations','limits'],'OData merchant plan');
  if (input.schema !== PLAN_SCHEMA || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 || /[\x00-\x1f]/.test(input.title))
    fail('Name the OData merchant');
  if (catalog?.schema !== 'stellar-forge.odata-catalog.v1' || !/^[a-f0-9]{64}$/.test(catalog.receipts?.metadata?.sha256) ||
      input.metadataSha256 !== catalog.receipts.metadata.sha256 || input.serviceRoot !== catalog.serviceUrl ||
      normalizeSourceUrl(input.serviceRoot,{allowLoopback}) !== input.serviceRoot)
    fail('Select the exact captured OData service and metadata');
  let publicUrl;
  try { publicUrl = new URL(input.publicOrigin); } catch { fail('Merchant public HTTPS origin required'); }
  if (publicUrl.protocol !== 'https:' || publicUrl.origin !== input.publicOrigin || publicUrl.username || publicUrl.password ||
      publicUrl.origin === new URL(input.serviceRoot).origin) fail('Select a merchant public HTTPS origin separate from the supplier');
  fields(input.payment,['network','asset','payTo','maxTimeoutSeconds'],'payment');
  if (!['stellar:testnet','stellar:pubnet'].includes(input.payment.network)) fail('Choose a Stellar payment network');
  if (input.limits !== undefined) fields(input.limits,['timeoutMs','maxResponseBytes','maxInFlight','cursorLifetimeSeconds'],'supplier limits');
  const limits = { timeoutMs:15000,maxResponseBytes:1048576,maxInFlight:16,cursorLifetimeSeconds:3600,...input.limits };
  integer(limits.timeoutMs,1000,60000,'supplier deadline');
  integer(limits.maxResponseBytes,1024,1048576,'supplier byte ceiling');
  integer(limits.maxInFlight,1,64,'supplier concurrency');
  integer(limits.cursorLifetimeSeconds,60,86400,'continuation lifetime');
  if (!Array.isArray(input.operations) || !input.operations.length || input.operations.length > 32) fail('Choose 1–32 merchant products');
  const ids = new Set(), paths = new Set();
  const operations = input.operations.map(row => {
    fields(row,['id','path','entitySet','fields','filterFields','orderFields','maxPageRows','maxTotalRows','amountAtomic','sourceFilters','sourceFilterMode'],'merchant product');
    if (typeof row.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(row.id) || ids.has(row.id) ||
        typeof row.path !== 'string' || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(row.path) ||
        row.path.startsWith('/_seller/') || paths.has(row.path)) fail('Choose a unique product ID and merchant route');
    ids.add(row.id); paths.add(row.path);
    const entity = getEntitySet(catalog,row.entitySet);
    if (!entity.keyFields.length) fail('Select an entity set with declared keys');
    const scalar = new Set(entity.fields.filter(field => !field.collection &&
      (['Edm.String','Edm.Boolean','Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32','Edm.Int64','Edm.Decimal','Edm.Single','Edm.Double','Edm.Guid','Edm.Date','Edm.DateTimeOffset','Edm.TimeOfDay','Edm.Duration','Edm.Binary'].includes(underlyingType(catalog,field.type)) || catalog.enumTypes[field.type])).map(field => field.path));
    const selected = unique(row.fields,scalar,'scalar output fields',true);
    const filters = unique(row.filterFields ?? [],scalar,'filter fields');
    const ordering = unique(row.orderFields ?? [],scalar,'order fields');
    if (entity.keyFields.some(key => !selected.includes(key) || !ordering.includes(key))) fail('Retain every entity key in output and ordering');
    integer(row.maxPageRows,1,100000,'hard supplier page row limit');
    integer(row.maxTotalRows,1,1000000000,'total rows per query');
    if (typeof row.amountAtomic !== 'string' || !/^[1-9][0-9]{0,38}$/.test(row.amountAtomic) || BigInt(row.amountAtomic) > (1n<<127n)-1n)
      fail('Set a positive canonical atomic price for each paid page');
    if (row.sourceFilters !== undefined && (!Array.isArray(row.sourceFilters) || row.sourceFilters.length > 16 ||
        row.sourceFilters.some(filter=>!plain(filter)||!filters.includes(filter.field)))) fail('Fixed source filters must use enabled declared fields');
    if (row.sourceFilterMode !== undefined && (row.sourceFilters === undefined || !['and','or'].includes(row.sourceFilterMode)))
      fail('A fixed source filter mode requires its retained filters');
    const operation = { ...row,entitySet:entity.container+'/'+entity.name,fields:selected,filterFields:filters,orderFields:ordering,
      ...(row.sourceFilters!==undefined?{sourceFilters:structuredClone(row.sourceFilters),sourceFilterMode:row.sourceFilterMode??'and'}:{}) };
    sourceTarget(catalog,operation);
    // Original type/query compiler supplies the key ordering and full expression rules.
    compileQuery(catalog,{entitySet:operation.entitySet,select:selected,filters:row.sourceFilters??[],filterMode:row.sourceFilterMode??'and',
      top:row.maxTotalRows,pageSize:Math.min(100,row.maxPageRows)});
    return operation;
  });
  if (input.headerEnv !== undefined) {
    fields(input.headerEnv,Object.keys(input.headerEnv),'supplier header references');
    if (Object.keys(input.headerEnv).some(key => ['accept','odata-version','odata-maxversion','prefer'].includes(key.toLowerCase())))
      fail('The OData integration supplies protocol negotiation headers');
  }
  return { ...structuredClone(input),operations,limits };
}
export function buildQuery(plan,catalog,id,input = {}) {
  fields(input,['select','filters','filterMode','orderBy','top','count','pageSize'],'customer query');
  const {operation} = operationFor(plan,catalog,id);
  if (operation.sourceFilters !== undefined) {
    if (input.filters !== undefined && canonical(input.filters)!==canonical(operation.sourceFilters) ||
        input.filterMode !== undefined && input.filterMode!==(operation.sourceFilterMode??'and'))
      fail('The merchant retains the selected source query scope');
    input={...input,filters:operation.sourceFilters,filterMode:operation.sourceFilterMode??'and'};
  }
  const selected = unique(input.select ?? operation.fields,new Set(operation.fields),'output fields',true);
  if (!Array.isArray(input.filters ?? []) || (input.filters ?? []).length > 16 ||
      (input.filters ?? []).some(filter => !plain(filter) || !operation.filterFields.includes(filter.field)))
    fail('Choose up to 16 enabled filter conditions');
  if (!Array.isArray(input.orderBy ?? []) || (input.orderBy ?? []).length > 8 ||
      (input.orderBy ?? []).some(order => !plain(order) || !operation.orderFields.includes(order.field)))
    fail('Choose up to eight enabled ordering fields');
  const top = integer(input.top ?? operation.maxTotalRows,1,operation.maxTotalRows,'total row selection');
  const pageSize = integer(input.pageSize ?? Math.min(100,operation.maxPageRows),1,operation.maxPageRows,'requested page size');
  const compiled = compileQuery(catalog,{...input,entitySet:operation.entitySet,select:selected,top,pageSize});
  const {entitySet,...query} = compiled.plan;
  if (compiled.plan.select.some(field => !operation.fields.includes(field))) fail('Original query selected an unlisted field');
  wireFromUrl(catalog,operation,compiled.url);
  return {compiled,query,url:compiled.url,seenRows:0};
}
export function wireFromUrl(catalog,operation,input) {
  const selected = sourceTarget(catalog,operation), url = new URL(input), inverse = Object.fromEntries(Object.entries(selected.mapping).map(([a,b])=>[b,a]));
  if (url.href.length > 8192) fail('The reviewed supplier query exceeds the original transport URL limit');
  if (url.origin !== selected.url.origin || url.pathname !== selected.url.pathname || url.username || url.password || url.hash)
    fail('Supplier continuation changed the selected resource');
  const wire = {};
  for (const [name,value] of url.searchParams) {
    const key = Object.hasOwn(inverse,name)?inverse[name]:null;
    if (!key || Object.hasOwn(wire,key)) fail('Supplier continuation has unsupported or duplicate query options');
    wire[key] = value;
  }
  for (const [name,value] of Object.entries(selected.fixed)) if (url.searchParams.get(name) !== value)
    fail('Supplier continuation changed its fixed company or resource scope');
  return wire;
}
export function nextUrl(catalog,operation,next,previous,initial,remaining) {
  if (typeof next !== 'string' || !next || next.length > 8192 || /[\x00-\x1f\x7f]/.test(next)) fail('Invalid supplier continuation');
  const url = new URL(next,previous).href;
  const wire = wireFromUrl(catalog,operation,url), prior = wireFromUrl(catalog,operation,previous), first = wireFromUrl(catalog,operation,initial);
  for (const name of ['select','filter','orderby','count']) {
    if (wire[name] !== undefined && wire[name] !== first[name]) fail('Supplier continuation changed the reviewed query');
    if (wire[name] === undefined && first[name] !== undefined && wire.skiptoken === undefined)
      fail('Supplier offset continuation omitted its reviewed query');
  }
  if (wire.top !== undefined && (!/^[1-9]\d*$/.test(wire.top) || Number(wire.top) > remaining)) fail('Supplier continuation exceeds the remaining total');
  if (wire.skip !== undefined && (!/^\d+$/.test(wire.skip) || !Number.isSafeInteger(Number(wire.skip)) || Number(wire.skip) > operation.maxTotalRows))
    fail('Supplier continuation offset exceeds the merchant query ceiling');
  if (wire.skiptoken !== undefined && (!wire.skiptoken || wire.skiptoken.length > 4096)) fail('Invalid supplier continuation token');
  if (url === previous || wire.skip === prior.skip && wire.skiptoken === prior.skiptoken || wire.skip === undefined && wire.skiptoken === undefined)
    fail('Supplier continuation did not advance');
  return url;
}
export function cursorCodec(key,binding,lifetimeSeconds) {
  if (!(key instanceof Uint8Array) || key.length < 32) fail('Retained merchant continuation key requires at least 32 bytes');
  const signature = encoded => createHmac('sha256',key).update(encoded).digest();
  return {
    encode(payload) {
      const encoded = Buffer.from(JSON.stringify({...payload,v:1,binding,expiresAt:Date.now()+lifetimeSeconds*1000})).toString('base64url');
      const result = encoded+'.'+signature(encoded).toString('base64url');
      if (result.length > 32768) fail('The retained supplier continuation exceeds the supported request size');
      return result;
    },
    decode(cursor) {
      if (typeof cursor !== 'string' || cursor.length > 32768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) fail('Invalid OData continuation');
      const [encoded,supplied] = cursor.split('.');
      if (!timingSafeEqual(signature(encoded),Buffer.from(supplied,'base64url'))) fail('Continuation belongs to another merchant');
      let payload; try { payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')); } catch { fail('Invalid continuation'); }
      if (payload.v !== 1 || payload.binding !== binding || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < Date.now())
        fail('Continuation expired or its merchant product changed');
      return payload;
    }
  };
}
export function projectRows(rows,query) {
  return rows.map(row => Object.fromEntries(query.select.map(path => {
    let value=row;
    for (const part of path.split('/')) {
      if (value === null) break;
      if (!plain(value) || !Object.hasOwn(value,part)) fail('Supplier omitted a selected property');
      value=value[part];
    }
    return [path,value];
  })));
}
export function validatePage(page,plan,catalog,id) {
  const {operation,entity} = operationFor(plan,catalog,id);
  if (!plain(page) || page.schema !== PAGE_SCHEMA || page.operation !== id || page.metadataSha256 !== catalog.receipts.metadata.sha256 ||
      page.entitySet !== operation.entitySet || !Array.isArray(page.items) || !plain(page.query)) fail('Response does not match this OData merchant product');
  const {query,compiled} = buildQuery(plan,catalog,id,page.query);
  if (canonical(query) !== canonical(page.query) || page.queryFingerprint !== compiled.fingerprint || page.items.length > operation.maxPageRows)
    fail('Response query or page row count is inconsistent');
  integer(page.seenRows,page.items.length,query.top,'delivered row count');
  for (const row of page.items) {
    fields(row,query.select,'result row');
    for (const name of query.select) {
      if (!Object.hasOwn(row,name) || row[name] === undefined || typeof row[name] === 'object' && row[name] !== null)
        fail('Response omitted a selected scalar field');
      const field=entity.fields.find(value=>value.path===name), type=underlyingType(catalog,field.type);
      if (row[name] === null) { if (!field.nullable || entity.keyFields.includes(name)) fail('Response omitted a required value'); continue; }
      if (['Edm.Int64','Edm.Decimal'].includes(type) && typeof row[name] !== 'string') fail('Exact numeric values must retain their source strings');
      if (typeof row[name] === 'number' && !Number.isFinite(row[name])) fail('Invalid numeric response');
    }
  }
  if (page.count !== null && !(typeof page.count==='string' && /^(?:0|[1-9]\d*)$/.test(page.count))) fail('Invalid exact source count');
  if (!['continue','provider','limit'].includes(page.completion) || (page.completion === 'continue') !== (typeof page.next === 'string') ||
      page.next !== null && (typeof page.next !== 'string' || !page.next || page.next.length>32768) ||
      page.completion === 'limit' && page.seenRows !== query.top || !/^[a-f0-9]{64}$/.test(page.supplierResponseSha256))
    fail('Invalid supplier continuation or response identity');
  return {operation,entity,query,compiled};
}

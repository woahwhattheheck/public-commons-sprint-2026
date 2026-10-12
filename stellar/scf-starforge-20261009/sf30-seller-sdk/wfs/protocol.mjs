// MIT. Explicit GeoServer WFS 2.0 KVP paging; source bodies stay unchanged.
import { object, fault } from '../postgres/publisher/files.mjs';
const need = (yes, code, message = code) => { if (!yes) throw fault(code, message); };
const fields = new Set(['version','typeName','srsName','pageSize','sortBy','bbox','bboxCrs','cqlFilter']);
export function normalizeCrs(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 1024, 'WFS_CRS_REQUIRED');
  const s = value.replace(/^<|>$/g, '');
  if (/^(?:CRS:84|OGC:CRS84)$/i.test(s) || /^urn:ogc:def:crs:OGC:[^:]*:CRS84$/i.test(s) ||
      /^https?:\/\/www\.opengis\.net\/def\/crs\/OGC\/[^/]+\/CRS84$/i.test(s)) return 'OGC:CRS84';
  const epsg = /^EPSG:(\d+)$/i.exec(s) || /^urn:ogc:def:crs:EPSG:[^:]*:(\d+)$/i.exec(s) ||
    /^https?:\/\/www\.opengis\.net\/def\/crs\/EPSG\/[^/]+\/(\d+)$/i.exec(s);
  return epsg ? 'EPSG:' + epsg[1] : s;
}
export function endpointUrl(value, {allowLoopback = false} = {}) {
  const url = new URL(value);
  need(!url.username && !url.password && !url.hash && !url.search &&
    (url.protocol === 'https:' || (allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1')),
    'WFS_ENDPOINT_INVALID', 'Select the WFS HTTPS endpoint without credentials or query parameters.');
  return url.href;
}
export function normalizeWfsSelection(value) {
  need(object(value) && Object.keys(value).every(k => fields.has(k)) && value.version === '2.0.0',
    'WFS_SELECTION_INVALID', 'Select the advertised WFS 2.0.0 service.');
  need(typeof value.typeName === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]*:[A-Za-z_][A-Za-z0-9_.-]*$/.test(value.typeName),
    'WFS_TYPE_NAME_REQUIRED', 'Choose one qualified feature type from the retained capabilities.');
  normalizeCrs(value.srsName);
  const pageSize = value.pageSize ?? 1000;
  need(Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 10000, 'WFS_PAGE_SIZE_INVALID');
  const sortBy = value.sortBy ?? [];
  need(Array.isArray(sortBy) && sortBy.length >= 1 && sortBy.length <= 16 &&
    sortBy.every(s => object(s) && Object.keys(s).every(k => ['property','direction'].includes(k)) &&
      typeof s.property === 'string' && /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(s.property) && ['A','D'].includes(s.direction)) &&
    new Set(sortBy.map(s => s.property)).size === sortBy.length,
    'WFS_SORT_REQUIRED', 'Select explicit stable sort properties, including a unique key when the service provides one.');
  const result = {version:'2.0.0', typeName:value.typeName, srsName:value.srsName, pageSize, sortBy};
  if (value.bbox !== undefined) {
    need(Array.isArray(value.bbox) && [4,6].includes(value.bbox.length) &&
      value.bbox.every(n => typeof n === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(n) && Number.isFinite(Number(n))),
      'WFS_BBOX_INVALID', 'Use four or six original numeric coordinate strings.');
    need(typeof value.bboxCrs === 'string', 'WFS_BBOX_CRS_REQUIRED');
    normalizeCrs(value.bboxCrs);
    const dims = value.bbox.length / 2;
    need(value.bbox.slice(0,dims).every((n,i) => Number(n) <= Number(value.bbox[i+dims])), 'WFS_BBOX_ORDER_INVALID');
    result.bbox = [...value.bbox]; result.bboxCrs = value.bboxCrs;
  } else need(value.bboxCrs === undefined, 'WFS_BBOX_REQUIRED');
  if (value.cqlFilter !== undefined) {
    need(typeof value.cqlFilter === 'string' && value.cqlFilter.length > 0 && value.cqlFilter.length <= 16384 &&
      !/[\x00-\x1f]/.test(value.cqlFilter), 'WFS_FILTER_INVALID');
    result.cqlFilter = value.cqlFilter;
  }
  return result;
}
export function wfsRequest(endpoint, operation, values = {}, options = {}) {
  const url = new URL(endpointUrl(endpoint, options));
  url.searchParams.set('service','WFS'); url.searchParams.set('version','2.0.0');
  url.searchParams.set('request',operation);
  for (const [key,value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(key,String(value));
  url.searchParams.sort(); return url.href;
}
export function wfsItemsUrl(endpoint, selected, options = {}) {
  const wfs = normalizeWfsSelection(selected);
  return wfsRequest(endpoint,'GetFeature',{
    typeNames:wfs.typeName,outputFormat:'application/json',srsName:wfs.srsName,count:wfs.pageSize,startIndex:'0',
    sortBy:wfs.sortBy.map(s => s.property + ' ' + s.direction).join(','),
    ...(wfs.bbox ? {bbox:[...wfs.bbox,wfs.bboxCrs].join(',')} : {}),
    ...(wfs.cqlFilter ? {cql_filter:wfs.cqlFilter} : {}),
  },options);
}
function parameters(url) {
  const result = {};
  for (const [key,value] of url.searchParams) {
    const name = key.toLowerCase(); need(!Object.hasOwn(result,name),'WFS_PARAMETER_DUPLICATE');
    result[name] = value;
  }
  return result;
}
export function validateWfsSource(config) {
  const wfs = normalizeWfsSelection(config.wfs), initial = new URL(config.itemsUrl);
  const endpoint = new URL(initial); endpoint.search = '';
  need(wfsItemsUrl(endpoint.href,wfs,config) === initial.href,'WFS_SOURCE_BINDING_CHANGED');
  return wfs;
}
function pageUrl(value, config) {
  const url = new URL(value), initial = new URL(config.itemsUrl), actual = parameters(url), expected = parameters(initial);
  need(url.origin === initial.origin && url.pathname === initial.pathname && !url.username && !url.password && !url.hash,
    'WFS_PAGE_ORIGIN_CHANGED');
  need(/^(0|[1-9]\d*)$/.test(actual.startindex ?? ''), 'WFS_START_INDEX_INVALID');
  const start = BigInt(actual.startindex); delete actual.startindex; delete expected.startindex;
  need(Object.keys(actual).length === Object.keys(expected).length &&
    Object.keys(expected).every(key => expected[key] === actual[key]),'WFS_PAGE_SELECTION_CHANGED');
  return {url,start};
}
/** count parses the original JsonNumber lexeme supplied by the OGC capture engine. */
export function wfsPageDetails(record, config, {count, linked}) {
  const doc = record.document, wfs = validateWfsSource(config);
  const {url,start} = pageUrl(record.requestedUrl,config), returned = doc.features.length;
  need(returned <= wfs.pageSize,'WFS_RETURNED_PAGE_SIZE_CHANGED');
  const nr = count(doc.numberReturned);
  need(doc.numberReturned === undefined || (nr !== null && BigInt(nr) === BigInt(returned)), 'OGC_RETURNED_COUNT_MISMATCH');
  const matched = doc.numberMatched === 'unknown' || doc.numberMatched === undefined ? null : count(doc.numberMatched);
  need(doc.numberMatched === undefined || doc.numberMatched === 'unknown' || matched !== null, 'OGC_MATCHED_COUNT_INVALID');
  const crs = normalizeCrs(wfs.srsName), declared = [];
  if (record.contentCrs) declared.push(normalizeCrs(record.contentCrs));
  if (doc.crs !== undefined && doc.crs !== null) {
    need(object(doc.crs) && doc.crs.type === 'name' && object(doc.crs.properties), 'WFS_GEOJSON_CRS_INVALID');
    declared.push(normalizeCrs(doc.crs.properties.name));
  }
  need(declared.every(value => value === crs), 'WFS_RESPONSE_CRS_CHANGED');
  need(declared.length > 0 || ['OGC:CRS84','EPSG:4326'].includes(crs),
    'WFS_RESPONSE_CRS_REQUIRED', 'Choose a representation whose response identifies the selected projected CRS.');
  const end = start + BigInt(returned);
  need(matched === null || end <= BigInt(matched), 'WFS_MATCHED_COUNT_CHANGED');
  const link = linked(doc,'next',record.url,config);
  if (link) {
    const next = pageUrl(link,config);
    need(next.start === end && next.start > start, 'WFS_NEXT_INDEX_CHANGED');
    need(matched === null || end < BigInt(matched), 'WFS_COUNT_LINK_CONFLICT');
    return {returned,matched,next:next.url.href};
  }
  if (matched !== null && end === BigInt(matched)) return {returned,matched,next:null};
  if (returned === 0) {
    need(matched === null, 'WFS_EMPTY_PAGE_BEFORE_END', 'The service returned an empty page before its declared result count.');
    return {returned,matched,next:null};
  }
  // A provider may cap a page below count. Advance by the actual returned count.
  // Unknown totals terminate only after the actual empty terminal response.
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase() === 'startindex') url.searchParams.delete(key);
  url.searchParams.set('startIndex',end.toString()); url.searchParams.sort();
  return {returned,matched,next:url.href};
}

/** All known counts in one retained WFS result set must describe the same coverage. */
export function checkWfsCoverage(pages, page) {
  const known = pages.find(item => item.matched !== null)?.matched ?? null;
  need(known === null || page.matched === null || page.matched === known,
    'WFS_MATCHED_TOTAL_CHANGED','The source result count changed during this download order. Inspect the retained response and refresh the source selection.');
  const expected = known ?? page.matched;
  if (page.next === null && expected !== null) {
    const params = parameters(new URL(page.requestedUrl));
    need(BigInt(params.startindex) + BigInt(page.returned) === BigInt(expected),
      'WFS_INCOMPLETE_COVERAGE','The terminal response differs from the original known result count.');
  }
}

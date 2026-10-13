// MIT. Complete native catalog receiving shared by the original browser and client.
const PAGE = 'stellar-forge.native-catalog-page.v1';
const EXPORT = 'stellar-forge.native-catalog-export.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const need = (value, code) => {
  if (!value) throw Object.assign(new Error(code), {code});
};

export function nextCatalogQuery(value) {
  need(plain(value) && plain(value.page?.pagination), 'FACILITATOR_CATALOG_PAGE_INVALID');
  const params = new URLSearchParams(value.query), pagination = value.page.pagination;
  if (value.mode === 'search') {
    need(pagination.cursor === null || typeof pagination.cursor === 'string' && pagination.cursor.length > 0,
      'FACILITATOR_CATALOG_PAGE_INVALID');
    if (pagination.cursor === null) return null;
    params.set('cursor', pagination.cursor);
  } else {
    need(value.mode === 'list' && ['offset','limit','total'].every(key =>
      Number.isSafeInteger(pagination[key]) && pagination[key] >= 0) && pagination.limit > 0,
    'FACILITATOR_CATALOG_PAGE_INVALID');
    const next = pagination.offset + pagination.limit;
    if (next >= pagination.total) return null;
    params.set('offset', String(next));
  }
  return params.toString();
}

/**
 * Receive every matching original page at one runtime/resource revision.
 * The first actual page supplies profile/network/journal/queue observation.
 * Await each page write before requesting the next page. The receiving owner
 * publishes its file only after this function returns the complete result.
 */
export async function streamNativeCatalogView({readPage, write, runtimeId, query = '',
  expectedVersion = null, onProgress} = {}) {
  need(typeof readPage === 'function' && typeof write === 'function' && typeof runtimeId === 'string' && runtimeId.length > 0 &&
    typeof query === 'string' && query.length <= 4096 &&
    (expectedVersion === null || Number.isSafeInteger(expectedVersion) && expectedVersion >= 0) &&
    (onProgress === undefined || typeof onProgress === 'function'),
  'FACILITATOR_CATALOG_RECEIVING_INVALID');
  const start = new URLSearchParams(query);
  need(!start.has('runtimeId') && !start.has('expectedVersion'), 'FACILITATOR_CATALOG_QUERY_INVALID');
  // A complete view begins at its first matching resource, even from a later retained page.
  start.delete('offset'); start.delete('cursor'); start.set('limit', '100');
  let selected = start.toString(), version = expectedVersion, metadata = null;
  let resourceCount = 0, pages = 0, total = null;
  const visited = new Set();
  do {
    need(!visited.has(selected), 'FACILITATOR_CATALOG_CURSOR_REPEATED');
    visited.add(selected);
    const value = copy(await readPage({runtimeId, query:selected, expectedVersion:version}));
    need(plain(value) && value.schema === PAGE && value.runtimeId === runtimeId &&
      plain(value.profile) && typeof value.profile.name === 'string' &&
      /^[a-f0-9]{64}$/.test(value.profile.sha256 ?? '') && typeof value.network === 'string' &&
      typeof value.observedAt === 'string' && plain(value.catalog) &&
      value.catalog.state === 'READY' && Number.isSafeInteger(value.catalog.version) && value.catalog.version >= 0 &&
      (value.mode === 'search' || value.mode === 'list') && typeof value.query === 'string' &&
      new URLSearchParams(value.query).toString() === selected &&
      value.mode === (new URLSearchParams(selected).has('query') ? 'search' : 'list') &&
      plain(value.page) && Array.isArray(value.page.resources),
    'FACILITATOR_CATALOG_PAGE_INVALID');
    if (version === null) version = value.catalog.version;
    need(value.catalog.version === version, 'FACILITATOR_CATALOG_VERSION_CHANGED');
    const parts = [];
    if (metadata === null) {
      metadata = {schema:EXPORT, runtimeId:value.runtimeId, profile:value.profile,
        network:value.network, observedAt:value.observedAt, catalog:value.catalog,
        mode:value.mode, query:value.query};
      parts.push(JSON.stringify(metadata).slice(0,-1) + ',"resources":[');
    } else {
      need(value.profile.name === metadata.profile.name && value.profile.sha256 === metadata.profile.sha256 &&
        value.network === metadata.network && value.mode === metadata.mode,
      'FACILITATOR_CATALOG_SELECTION_CHANGED');
    }
    const next = nextCatalogQuery(value);
    if (value.mode === 'list') {
      const pagination = value.page.pagination;
      if (total === null) total = pagination.total;
      need(pagination.total === total && pagination.offset === resourceCount &&
        value.page.resources.length === Math.min(pagination.limit, Math.max(0, total - resourceCount)),
      'FACILITATOR_CATALOG_PAGE_INCOMPLETE');
    } else {
      need(value.page.pagination.limit === value.page.resources.length &&
        value.page.partialResults === (next !== null) && (next === null || value.page.resources.length > 0),
      'FACILITATOR_CATALOG_PAGE_INCOMPLETE');
    }
    for (const resource of value.page.resources) {
      if (resourceCount++) parts.push(',');
      parts.push(JSON.stringify(resource));
    }
    if (parts.length) await write(parts.join(''));
    pages++;
    if (onProgress) await onProgress({runtimeId, version, resourceCount, pages});
    selected = next;
  } while (selected !== null);
  need(total === null || resourceCount === total, 'FACILITATOR_CATALOG_PAGE_INCOMPLETE');
  await write('],"resourceCount":' + resourceCount + ',"pages":' + pages + '}\n');
  return {metadata, resourceCount, pages};
}

/** Collect the same complete original stream for the browser or a memory receiver. */
export async function receiveNativeCatalogView(options = {}) {
  const parts = [];
  const completed = await streamNativeCatalogView({...options, write:part => {parts.push(part);}});
  return {...completed, parts};
}

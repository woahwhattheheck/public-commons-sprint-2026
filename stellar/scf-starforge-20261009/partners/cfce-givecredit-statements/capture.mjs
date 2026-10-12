// MIT. CFCE registry acquisition, pinned to the original monorepo routes.
import { createHash } from 'node:crypto';
import { need, copy, plain, parseNativeJSON, normalizeRegistryTables } from './source.mjs';
export const REGISTRY_BASE = 'https://registry.cfce.io/api';
export const CFCE_ORGANIZATION = '04340418-765d-48ab-af36-512a66c960b4';
export const REGISTRY_SOURCE_COMMIT = '3d20065447bd56c9c05a3e658ccd11e0b9cb985e';
export const REGISTRY_ROUTES = Object.freeze({
  donations: { path:'donations', organizationFilter:'orgId', auth:true, order:'created descending' },
  nfts: { path:'nft', organizationFilter:'orgId', auth:true, required:{chain:'stellar'}, order:'created descending' },
  organizations: { path:'organizations', auth:false, order:'name ascending' },
  initiatives: { path:'initiatives', organizationFilter:'orgId', auth:true, order:'title ascending' },
  credits: { path:'credits', auth:true, order:'unspecified by original source' },
  providers: { path:'providers', auth:true, order:'unspecified by original source' },
  stories: { path:'stories', organizationFilter:'orgId', auth:true, order:'created descending' },
});
const TABLES = [...Object.keys(REGISTRY_ROUTES), 'impactlinks'];
const stable = value => JSON.stringify(value, (_, v) => plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const digest = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
function baseURL(value) {
  const url = new URL(value || REGISTRY_BASE);
  need((url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)) &&
    !url.username && !url.password && !url.search && !url.hash,
    'REGISTRY_URL', 'Use the configured HTTPS registry API or a local receiver without credentials or query parameters.');
  return url.href.replace(/\/+$/,'');
}
function checkpointOf(source) { return copy(source); }
function fail(source, error) {
  source.metadata.status = 'interrupted';source.metadata.updatedAt = now();
  source.metadata.interruption = {code:error.code || 'CAPTURE_INTERRUPTED', message:error.message, retryAfter:error.retryAfter || null};
  error.checkpoint = checkpointOf(source);throw error;
}
function addRows(source, table, rows, ref, indexes) {
  for (const row of rows) {
    need(plain(row) && typeof row.id === 'string' && row.id.length > 0, 'REGISTRY_ROW_ID', table + ' requires its original native row ID.');
    const key = row.id, existing = indexes[table].get(key);
    source.metadata.rowRefs[table][key] ||= [];
    if (!source.metadata.rowRefs[table][key].includes(ref)) source.metadata.rowRefs[table][key].push(ref);
    if (existing) {
      need(stable(existing) === stable(row), 'REGISTRY_CHANGED_DURING_CAPTURE',
        table + ' row ' + key + ' changed during this edition. The retained responses contain both versions; start a new edition.');
    } else {const original = copy(row);indexes[table].set(key, original);source.tables[table].push(original);}
  }
}
/** Complete native list pages; errors carry their retained original capture checkpoint. */
export async function captureRegistry(options = {}) {
  const baseUrl = baseURL(options.baseUrl);
  const organizationId = options.organizationId === null ? null : (options.organizationId || CFCE_ORGANIZATION);
  need(organizationId === null || (typeof organizationId === 'string' && /^[a-zA-Z0-9._:-]+$/.test(organizationId)),
    'REGISTRY_ORGANIZATION', 'Use the original organization ID.');
  need(typeof options.apiKey === 'string' && options.apiKey.trim().length > 0,
    'REGISTRY_ACCESS_REQUIRED', 'Configure the existing authorized registry API key or import an original export.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  need(typeof fetchImpl === 'function', 'FETCH_UNAVAILABLE', 'Run capture in the native Node receiver.');
  const size = Number(options.pageSize ?? 200);
  need(Number.isInteger(size) && size >= 1 && size <= 200, 'REGISTRY_PAGE_SIZE', 'Use a page size from 1 to 200.');
  const selection = {baseUrl, organizationId, pageSize:String(size), sourceCommit:REGISTRY_SOURCE_COMMIT};
  const source = options.checkpoint ? copy(options.checkpoint) : {
    schema:'stellar-forge.givecredit-source.v1', kind:'registry',
    metadata:{origin:'cfce-registry-api', selection, startedAt:now(), updatedAt:now(), status:'capturing',
      sourceCommit:REGISTRY_SOURCE_COMMIT,
      dateBasis:'Original database timestamps remain on each row; reporting uses a separate half-open period.',
      consistency:'Zero-based offset traversal of a live registry; not an atomic database snapshot.',
      coverage:{}, progress:{}, rowRefs:Object.fromEntries(TABLES.map(name=>[name,{}]))},
    files:{}, responses:[], tables:Object.fromEntries(TABLES.map(name=>[name,[]])),
  };
  need(source.schema === 'stellar-forge.givecredit-source.v1' && source.kind === 'registry' &&
    stable(source.metadata.selection) === stable(selection), 'REGISTRY_CHECKPOINT_SELECTION',
    'Resume the same registry, organization and page size as the retained checkpoint.');
  source.metadata.status = 'capturing';delete source.metadata.interruption;
  const indexes = Object.fromEntries(TABLES.map(name => [name,new Map((source.tables[name] || []).map(row=>[row.id,row]))]));
  const request = async (table, page, phase = 'page') => {
    if (options.signal?.aborted) throw Object.assign(new Error('Registry capture was paused.'), {code:'CAPTURE_PAUSED'});
    const route = REGISTRY_ROUTES[table], url = new URL(baseUrl + '/' + route.path);
    url.searchParams.set('size',String(size)); url.searchParams.set('page',String(page));
    if (route.required) for (const [key,value] of Object.entries(route.required)) url.searchParams.set(key,value);
    if (organizationId && route.organizationFilter) url.searchParams.set(route.organizationFilter,organizationId);
    const headers = {Accept:'application/json'};
    if (route.auth) headers['x-api-key'] = options.apiKey;
    const timeout=AbortSignal.timeout(options.timeoutMs||45000);
    const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
    const response = await fetchImpl(url.href,{method:'GET',headers,redirect:'error',signal});
    const content = await response.text(), retrievedAt = now();
    need(Buffer.byteLength(content)<=64*1024*1024,'REGISTRY_RESPONSE_SIZE','Receive the registry through its original paged route.');
    const ref = 'registry/responses/' + String(source.responses.length+1).padStart(6,'0') + '.json';
    source.files[ref] = content;
    source.responses.push({url:url.href,method:'GET',request:{table,page:String(page),size:String(size),phase},
      retrievedAt,status:String(response.status),content,file:ref,sha256:digest(content)});
    if (!response.ok) throw Object.assign(new Error('Registry ' + table + ' returned HTTP ' + response.status + '.'), {
      code:'REGISTRY_HTTP_' + response.status, status:response.status,retryAfter:response.headers?.get?.('retry-after') || null});
    const envelope = parseNativeJSON(content);
    need(plain(envelope) && envelope.success === true && Array.isArray(envelope.data),
      'REGISTRY_RESPONSE', 'Expected the original successful list envelope for ' + table + '.');
    need(envelope.data.length <= size,'REGISTRY_PAGE_CONTRACT','Registry page exceeded the requested native page size.');
    return {rows:envelope.data,ref,signature:digest(stable(envelope.data)),retrievedAt};
  };
  try {
    for (const [table,route] of Object.entries(REGISTRY_ROUTES)) {
      let progress = source.metadata.progress[table] ||= {nextPage:'0', complete:false, firstPageSignature:null, pageSignatures:[], emptyPage:null};
      if (progress.complete) continue;
      source.metadata.coverage[table] = {status:'capturing', route:'/' + route.path,
        scope:organizationId && route.organizationFilter ? {organizationId} : {accessibleCatalog:true},ordering:route.order, dateFiltered:false};
      while (!progress.complete) {
        const page = Number(progress.nextPage);
        need(Number.isSafeInteger(page) && page >= 0, 'REGISTRY_CHECKPOINT_PAGE', 'Keep the original pagination checkpoint.');
        const result = await request(table,page);
        if (page === 0) progress.firstPageSignature = result.signature;
        if (result.rows.length) {
          need(!progress.pageSignatures.includes(result.signature),'REGISTRY_REPEATED_PAGE',
            'Registry repeated a nonempty ' + table + ' page. Its original response is retained.');
          addRows(source,table,result.rows,result.ref,indexes);
          progress.pageSignatures.push(result.signature);progress.nextPage = String(page + 1);
        } else {
          progress.emptyPage = String(page);
          if (page > 0) {
            const leading = await request(table,0,'leading-page-recheck');
            need(leading.signature === progress.firstPageSignature,'REGISTRY_CHANGED_DURING_CAPTURE',
              'The first ' + table + ' page changed during traversal. Start a new edition; the complete acquisition attempt is retained.');
          }
          progress.complete = true;
          source.metadata.coverage[table].status = 'terminal-empty-page';
          source.metadata.coverage[table].rows = String(source.tables[table].length);
          source.metadata.coverage[table].terminalPage = String(page);
          source.metadata.coverage[table].leadingPageRechecked = page > 0;
        }
        source.metadata.updatedAt = now();
        if (options.onProgress) await options.onProgress({phase:'registry',table,rows:String(source.tables[table].length),checkpoint:checkpointOf(source)});
      }
    }
    for (const donation of source.tables.donations) {
      need(Array.isArray(donation.impactlinks),'REGISTRY_IMPACT_RELATION',
        'Donation ' + donation.id + ' omitted its original impactlinks relation.');
      for (const ref of source.metadata.rowRefs.donations[donation.id])
        addRows(source,'impactlinks',donation.impactlinks,ref + '#donations/' + donation.id + '/impactlinks',indexes);
    }
    source.metadata.coverage.impactlinks = {status:'donation-relation-closure',
      scope:organizationId ? {organizationId} : {accessibleDonations:true},
      source:'GET /donations -> impactlinks[] including original story relation',standaloneRoute:null, rows:String(source.tables.impactlinks.length)};
    source.tables = normalizeRegistryTables(source.tables);
    source.metadata.status = 'complete';source.metadata.completedAt = now();source.metadata.updatedAt = source.metadata.completedAt;
    source.metadata.captureSummary = Object.fromEntries(TABLES.map(name=>[name,String(source.tables[name].length)]));
    if (options.onProgress) await options.onProgress({phase:'complete',checkpoint:checkpointOf(source)});
    return source;
  } catch (error) { return fail(source,error); }
}

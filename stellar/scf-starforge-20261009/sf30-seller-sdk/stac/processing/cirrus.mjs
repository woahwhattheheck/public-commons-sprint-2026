// MIT. Observed Cirrus State API dialect in the original processing controller.
import { need } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { canonicalJson, sha256, publicURL } from '../provider.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const packageSchema = 'scf-stac-cirrus-public-source-package/v1';
export const isCirrus = value => value?.dialect === 'cirrus-state';
const json = body => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { need(false, 'PROCESSING_CIRRUS_SOURCE_JSON_INVALID'); }
};
const sameOrigin = (value, baseUrl) => {
  const base = new URL(baseUrl), url = new URL(publicURL(value, baseUrl + '/'));
  const prefix = base.pathname.replace(/\/+$/, '');
  need(url.origin === base.origin && (url.pathname === prefix || url.pathname.startsWith(prefix + '/')),
    'PROCESSING_CIRRUS_SOURCE_ORIGIN_CHANGED');
  return url;
};
function extractedDocument(record) {
  need(object(record) && typeof record.carrierText === 'string', 'PROCESSING_CIRRUS_CARRIER_REQUIRED');
  let text = record.carrierText, extraction = 'document-json';
  const pre = text.match(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/i);
  if (pre) {
    need((text.match(/<pre(?:\s|>)/gi) ?? []).length === 1, 'PROCESSING_CIRRUS_CARRIER_AMBIGUOUS');
    text = pre[1].replace(/&(?:quot|apos|lt|gt|amp|#(\d+)|#x([a-f0-9]+));/gi, (all, decimal, hex) => {
      if (decimal || hex) {
        const code = Number.parseInt(decimal || hex, hex ? 16 : 10);
        need(code >= 0 && code <= 0x10ffff, 'PROCESSING_CIRRUS_CARRIER_ENTITY_INVALID');
        return String.fromCodePoint(code);
      }
      return ({ '&quot;':'"', '&apos;':"'", '&lt;':'<', '&gt;':'>', '&amp;':'&' })[all.toLowerCase()];
    });
    extraction = 'html-pre-json';
  }
  const body = Buffer.from(text);
  return { body, document: json(body), extraction };
}

/** Reuse the exact captured connector text while preserving its retrieval origin.
 * The absent HTTP status remains null; it is never replaced with an invented 200. */
export function readCirrusSourceDocuments(body) {
  const source = json(body);
  need(source?.schema === packageSchema && Array.isArray(source.capture?.records) &&
    source.capture.records.length > 0 && source.capture.records.length <= 1000,
    'PROCESSING_CIRRUS_SOURCE_PACKAGE_REQUIRED');
  const packageSha256 = sha256(body);
  return source.capture.records.map((record, recordIndex) => {
    const extracted = extractedDocument(record);
    const provenance = { kind:'connector-document', connector:source.capture.connector,
      packageSha256, recordIndex, carrierSha256:sha256(Buffer.from(record.carrierText)),
      extraction:extracted.extraction, sourceUrl:record.url, finalUrl:record.finalUrl ?? record.url,
      format:record.format ?? null, packagePreparedAt:source.preparedAt ?? null };
    need(typeof provenance.connector === 'string' && typeof record.url === 'string',
      'PROCESSING_CIRRUS_RETRIEVAL_IDENTITY_REQUIRED');
    return { url:record.url, body:extracted.body, document:extracted.document,
      metadata:{ method:'GET', url:record.url, status:record.status ?? null,
        capturedAt:record.capturedAt ?? null, headers:record.headers ?? {},
        bodyOrigin:'connector-document', provenance } };
  });
}

function workflowLink(link, baseUrl) {
  need(object(link) && link.rel === 'child' && typeof link.href === 'string',
    'PROCESSING_CIRRUS_WORKFLOW_LINK_INVALID');
  const url = sameOrigin(link.href, baseUrl);
  need(!url.search && !url.hash, 'PROCESSING_CIRRUS_WORKFLOW_LINK_INVALID');
  const prefix = new URL(baseUrl).pathname.replace(/\/+$/, '');
  const path = url.pathname.slice(prefix.length).replace(/^\/|\/$/g, '');
  const split = path.lastIndexOf('/workflow-');
  need(split > 0 && !path.slice(split + 10).includes('/'), 'PROCESSING_CIRRUS_WORKFLOW_PATH_INVALID');
  const collections = decodeURIComponent(path.slice(0, split));
  const workflow = decodeURIComponent(path.slice(split + 10));
  need(collections.length > 0 && workflow.length > 0, 'PROCESSING_CIRRUS_WORKFLOW_PATH_INVALID');
  const id = collections + '/workflow-' + workflow;
  return { id, collections, workflow, title:typeof link.title === 'string' ? link.title : id,
    href:url.href, itemsUrl:url.href.replace(/\/$/, '') + '/items', nativeLink:structuredClone(link) };
}

export function readCirrusContract(body, deployment, metadata = {}) {
  let document = json(body), root = document, rootUrl = metadata.url ?? deployment.baseUrl + '/';
  let sourceChain = null, sourceKind = 'cirrus-root-json', metricsUrl = deployment.metricsUrl ?? null;
  if (document?.schema === packageSchema) {
    const records = readCirrusSourceDocuments(body);
    const base = new URL(deployment.baseUrl), prefix = base.pathname.replace(/\/+$/, '');
    const selected = records.filter(record => {
      const url = new URL(record.url);
      return url.origin === base.origin && url.pathname.replace(/\/+$/, '') === prefix;
    });
    need(selected.length === 1, 'PROCESSING_CIRRUS_ROOT_DOCUMENT_REQUIRED');
    root = selected[0].document; rootUrl = selected[0].url;
    sourceChain = document.sourceChain ?? null; sourceKind = 'cirrus-public-source-package';
    if (!metricsUrl && document.deployment?.metricsUrl) metricsUrl = document.deployment.metricsUrl;
  }
  const rootEndpoint = sameOrigin(rootUrl, deployment.baseUrl);
  need(!rootEndpoint.search && object(root) && typeof root.id === 'string' && Array.isArray(root.links),
    'PROCESSING_CIRRUS_ROOT_REQUIRED');
  const workflows = root.links.filter(link => link?.rel === 'child').map(link => workflowLink(link, deployment.baseUrl));
  need(workflows.length > 0 && workflows.length <= 10000 &&
    new Set(workflows.map(workflow => workflow.id)).size === workflows.length,
    'PROCESSING_CIRRUS_WORKFLOW_IDENTITIES_INVALID');
  const routes = { instances:{ path:rootEndpoint.pathname, operationId:null, query:[] } };
  if (metricsUrl) {
    const metrics = sameOrigin(metricsUrl, deployment.baseUrl);
    need(!metrics.search && !metrics.hash, 'PROCESSING_CIRRUS_METRICS_URL_INVALID');
    routes.stats = { path:metrics.pathname, operationId:null, query:[] };
  }
  return { schema:'scf-cirrus-state-contract/v1', dialect:'cirrus-state',
    sourceSha256:sha256(body), sourceBytes:body.length, sourceUrl:metadata.url ?? rootUrl,
    sourceStatus:metadata.status ?? null, sourceCapturedAt:metadata.capturedAt ?? null,
    sourceKind, sourceChain, info:{title:root.description ?? root.id,version:null},
    baseUrl:deployment.baseUrl, routes, workflowFilter:null, nativeRootId:root.id,
    workflows, sinceValues:['1h','1d','7d','30d'] };
}

export function cirrusWorkflow(contract, id) {
  const workflow = contract.workflows.find(value => value.id === id);
  need(workflow, 'PROCESSING_CIRRUS_WORKFLOW_NOT_IN_SOURCE'); return workflow;
}
export function cirrusWorkflowRows(document, contract) {
  need(document?.id === contract.nativeRootId && Array.isArray(document.links), 'PROCESSING_CIRRUS_ROOT_CHANGED');
  const workflows = document.links.filter(link => link?.rel === 'child').map(link => workflowLink(link, contract.baseUrl));
  need(canonicalJson(workflows) === canonicalJson(contract.workflows), 'PROCESSING_CIRRUS_ROOT_CHANGED');
  return workflows;
}
export function cirrusRunIdentity(run) {
  need(object(run) && ['collections','workflow','items','payload_id'].every(key =>
    typeof run[key] === 'string' && run[key].length > 0 && run[key].length <= 16384),
    'PROCESSING_CIRRUS_RUN_IDENTITY_INVALID');
  need(run.payload_id === run.collections + '/workflow-' + run.workflow + '/' + run.items,
    'PROCESSING_CIRRUS_PAYLOAD_ID_CHANGED');
  return { collections:run.collections, workflow:run.workflow, items:run.items, payload_id:run.payload_id };
}
export const cirrusWorkflowId = run => {
  const identity = cirrusRunIdentity(run); return identity.collections + '/workflow-' + identity.workflow;
};
export const cirrusRunKey = run => sha256(canonicalJson(['cirrus-state',cirrusRunIdentity(run)]));
export function cirrusRunRequest(contract, workflowId, { since, state = null }, limit) {
  const workflow = cirrusWorkflow(contract, workflowId), url = new URL(workflow.itemsUrl);
  need(typeof since === 'string' && /^\d+(?:s|m|h|d|w)$/.test(since), 'PROCESSING_CIRRUS_SINCE_INVALID');
  need(state === null || typeof state === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(state),
    'PROCESSING_CIRRUS_STATE_INVALID');
  url.searchParams.set('since', since);
  if (state !== null) url.searchParams.set('state', state);
  url.searchParams.set('limit', String(limit));
  return { method:'GET', url:url.href, headers:{accept:'application/json'} };
}
export function cirrusSummaryRequest(contract, workflowId) {
  return { method:'GET', url:cirrusWorkflow(contract, workflowId).href, headers:{accept:'application/json'} };
}
export function nextCirrusRequest(document, current, rowsKey, contract) {
  if (rowsKey !== 'items') return null;
  need(Array.isArray(document.items), 'PROCESSING_CIRRUS_ITEMS_REQUIRED');
  if (document.nextkey === undefined || document.nextkey === null || document.nextkey === '') return null;
  need(typeof document.nextkey === 'string' && document.nextkey.length <= 16384,
    'PROCESSING_CIRRUS_NEXTKEY_INVALID');
  const url = new URL(current.url), workflow = contract.workflows.find(value => new URL(value.itemsUrl).pathname === url.pathname);
  need(workflow && document.nextkey.startsWith(workflow.id + '/'), 'PROCESSING_CIRRUS_NEXTKEY_WORKFLOW_CHANGED');
  url.searchParams.set('nextkey', document.nextkey);
  return { method:'GET', url:url.href, headers:{accept:'application/json'} };
}
export function cirrusCoverage(document, request, next) {
  const returned = document.items.length, raw = new URL(request.url).searchParams.get('limit');
  const requestedLimit = raw === null ? null : Number(raw);
  return { status:next ? 'MORE_NATIVE_PAGES' : returned ? 'NO_NATIVE_CURSOR_RETURNED' : 'EMPTY_NATIVE_PAGE',
    complete:!next && returned === 0, returned, requestedLimit,
    pageFilled:requestedLimit !== null && returned >= requestedLimit,
    continuationSource:next ? 'response-nextkey' : null };
}
export function selectCirrusContinuation(document, request) {
  need(Array.isArray(document.items) && document.items.length > 0 &&
    (document.nextkey === undefined || document.nextkey === null || document.nextkey === ''),
    'PROCESSING_CIRRUS_CONTINUATION_NOT_AVAILABLE');
  const identity = cirrusRunIdentity(document.items.at(-1)), url = new URL(request.url);
  need(decodeURIComponent(url.pathname).replace(/\/items\/?$/, '').endsWith('/' +
    identity.collections + '/workflow-' + identity.workflow), 'PROCESSING_CIRRUS_CONTINUATION_WORKFLOW_CHANGED');
  need(url.searchParams.get('nextkey') !== identity.payload_id, 'PROCESSING_CIRRUS_NATIVE_CURSOR_DID_NOT_ADVANCE');
  url.searchParams.set('nextkey', identity.payload_id);
  return { request:{method:'GET',url:url.href,headers:{accept:'application/json'}}, payloadId:identity.payload_id };
}


/** Validate native data without renaming identifiers or converting capped counts. */
export function cirrusTaskRows(document, task, contract) {
  need(object(document), 'PROCESSING_CIRRUS_DOCUMENT_INVALID');
  if (task.kind === 'instances') return cirrusWorkflowRows(document, contract);
  if (task.kind === 'stats') {
    need(object(document.state_transitions), 'PROCESSING_CIRRUS_STATISTICS_REQUIRED');
    for (const periods of Object.values(document.state_transitions)) {
      need(Array.isArray(periods), 'PROCESSING_CIRRUS_STATISTICS_PERIODS_INVALID');
      for (const period of periods) {
        need(object(period) && typeof period.period === 'string' && typeof period.interval === 'string' &&
          Array.isArray(period.states), 'PROCESSING_CIRRUS_STATISTICS_PERIOD_INVALID');
        for (const state of period.states) need(object(state) && typeof state.state === 'string' &&
          ['count','unique_count'].every(key => Number.isSafeInteger(state[key]) && state[key] >= 0),
          'PROCESSING_CIRRUS_STATISTICS_COUNT_INVALID');
      }
    }
    return [document];
  }
  const workflow = cirrusWorkflow(contract, task.scope.workflowId);
  if (task.kind === 'summary') {
    need(document.collections === workflow.collections && document.workflow === workflow.workflow &&
      object(document.counts) && Object.values(document.counts).every(value =>
        Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^\d+\+$/.test(value)),
      'PROCESSING_CIRRUS_WORKFLOW_SUMMARY_INVALID');
    return [document];
  }
  need(task.kind === 'runs' && Array.isArray(document.items), 'PROCESSING_CIRRUS_ITEMS_REQUIRED');
  for (const run of document.items) {
    need(cirrusWorkflowId(run) === workflow.id, 'PROCESSING_RUN_FILTER_NOT_APPLIED');
    need(typeof run.state === 'string', 'PROCESSING_CIRRUS_STATE_REQUIRED');
    if (task.scope.state !== null && task.scope.state !== undefined)
      need(run.state === task.scope.state, 'PROCESSING_CIRRUS_STATE_FILTER_NOT_APPLIED');
  }
  return document.items;
}

/** Bind an imported connector document to the original configured source package.
 * This is also used by the offline receiver; no caller-supplied status replaces
 * an absent transport status and no reconstructed document replaces the carrier. */
export function bindCirrusConnectorDocument(body, metadata, sourceBody, request) {
  need(Buffer.isBuffer(body) && object(metadata) && metadata.bodyOrigin === 'connector-document' &&
    object(metadata.provenance), 'PROCESSING_CIRRUS_CONNECTOR_BINDING_REQUIRED');
  const records = readCirrusSourceDocuments(sourceBody), index = metadata.provenance.recordIndex;
  const record = Number.isSafeInteger(index) ? records[index] : null;
  need(record && record.body.equals(body) && record.url === request.url &&
    canonicalJson(record.metadata.provenance) === canonicalJson(metadata.provenance) &&
    metadata.status === record.metadata.status &&
    (metadata.capturedAt ?? null) === record.metadata.capturedAt,
    'PROCESSING_CIRRUS_CONNECTOR_SOURCE_CHANGED');
  return record.metadata;
}

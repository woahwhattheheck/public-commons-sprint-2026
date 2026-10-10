// MIT. Read-only x402 Bazaar seller discoverability diagnostic. No wallet, payment or account calls.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_JSON_BYTES = 2_000_000;
const MAX_HEADER_BYTES = 64_000;
const URL_LIMIT = 2048;

export function requireEndpoint(value, {allowLoopback = false} = {}) {
  if (typeof value !== 'string' || value.length > URL_LIMIT) throw new TypeError('Invalid endpoint URL');
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new TypeError('Credentials and URL fragments are not allowed');
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) {
    throw new TypeError('HTTPS required (local loopback needs --allow-loopback)');
  }
  if (!loopback && /^(localhost|.*\.localhost)$/i.test(url.hostname)) throw new TypeError('Local host not allowed');
  return url;
}

export function resourceKey(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch { return null; }
}

export function decodeJsonHeader(value, label = 'header') {
  if (typeof value !== 'string' || value.length > MAX_HEADER_BYTES || !/^[A-Za-z0-9+/_=-]+$/.test(value)) {
    throw new TypeError(`Invalid ${label} encoding`);
  }
  const clean = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const buffer = Buffer.from(clean, 'base64');
  if (!buffer.length || buffer.length > MAX_HEADER_BYTES ||
      buffer.toString('base64').replace(/=+$/, '') !== clean.replace(/=+$/, '')) {
    throw new TypeError(`Invalid ${label} base64`);
  }
  const decoded = JSON.parse(buffer.toString('utf8'));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new TypeError(`Invalid ${label} JSON`);
  return decoded;
}

export function bazaarExtensionOutcome(headerValue) {
  if (!headerValue) return {state: 'NOT_PROVIDED'};
  try {
    const object = decodeJsonHeader(headerValue, 'EXTENSION-RESPONSES');
    const entry = object.bazaar;
    if (!entry || !['success', 'processing', 'rejected'].includes(entry.status)) {
      return {state: 'NO_VALID_BAZAAR_STATUS'};
    }
    return {state: entry.status.toUpperCase(), ...(entry.status === 'rejected' && typeof entry.rejectedReason === 'string'
      ? {reason: entry.rejectedReason.slice(0, 300)} : {})};
  } catch (error) { return {state: 'INVALID_HEADER', error: String(error.message)}; }
}

export function inspectChallenge(status, header) {
  if (status !== 402) return {httpStatus: status, state: 'NOT_HTTP_402'};
  if (!header) return {httpStatus: status, state: 'NO_PAYMENT_REQUIRED_HEADER'};
  try {
    const payment = decodeJsonHeader(header, 'PAYMENT-REQUIRED');
    const accepts = Array.isArray(payment.accepts) ? payment.accepts : [];
    const routes = accepts.filter(x => x && typeof x === 'object').slice(0, 40).map(x => ({
      network: typeof x.network === 'string' ? x.network : null,
      scheme: typeof x.scheme === 'string' ? x.scheme : null,
      asset: typeof x.asset === 'string' ? x.asset : null,
      payTo: typeof x.payTo === 'string' ? x.payTo : null,
      amount: typeof x.amount === 'string' ? x.amount : null
    }));
    return {httpStatus: status, state: routes.length ? 'X402_402' : 'INVALID_ACCEPTS',
      x402Version: payment.x402Version ?? null,
      bazaarExtension: Boolean(payment.extensions?.bazaar),
      acceptsCount: accepts.length, accepts: routes};
  } catch (error) {
    return {httpStatus: status, state: 'INVALID_PAYMENT_REQUIRED', error: String(error.message)};
  }
}

async function getBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const pieces = [];
  let total = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) throw new RangeError('HTTP response exceeds read-only byte limit');
      pieces.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(pieces, total).toString('utf8');
}

async function readEndpoint(fetchImpl, url, {json = false} = {}) {
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'error', headers: {accept: 'application/json'},
    signal: AbortSignal.timeout(15_000)
  });
  const header = response.headers;
  const body = json && response.ok ? JSON.parse(await getBody(response)) : null;
  return {status: response.status, header, body};
}

function listItems(page) {
  if (Array.isArray(page?.items)) return page.items;
  if (Array.isArray(page?.resources)) return page.resources;
  throw new TypeError('Discovery body has no items/resources array');
}

function networkSummary(item) {
  return [...new Set((Array.isArray(item?.accepts) ? item.accepts : [])
    .map(x => x?.network).filter(x => typeof x === 'string'))];
}

export async function inspectCatalog({catalogUrl, targetResource, payTo, network, allowLoopback = false,
  pageLimit = 100, maxPages = 500, fetchImpl = fetch}) {
  const endpoint = requireEndpoint(catalogUrl, {allowLoopback});
  const target = resourceKey(targetResource);
  if (!target) throw new TypeError('Invalid target resource URL');
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 200 ||
      !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 2000) {
    throw new TypeError('Invalid pagination options');
  }
  const matches = [], samePayToOtherResource = [];
  const seenKeys = new Set(), seenPageSignatures = new Set();
  let offset = 0, cursor = null, useCursor = false, knownTotal = null;
  let complete = false, pages = 0, rawRows = 0, reason = null;
  for (let i = 0; i < maxPages; i++) {
    const pageUrl = new URL(endpoint);
    pageUrl.searchParams.set('limit', String(pageLimit));
    if (useCursor) pageUrl.searchParams.set('cursor', cursor);
    else pageUrl.searchParams.set('offset', String(offset));
    let body;
    try {
      const result = await readEndpoint(fetchImpl, pageUrl, {json: true});
      if (result.status !== 200) throw new Error(`Discovery HTTP ${result.status}`);
      body = result.body;
    } catch (error) { reason = `Page ${i + 1}: ${String(error.message)}`; break; }
    let items;
    try { items = listItems(body); }
    catch (error) { reason = `Page ${i + 1}: ${String(error.message)}`; break; }
    pages++;
    rawRows += items.length;
    const pageKeys = [];
    for (const item of items) {
      const resource = resourceKey(item?.resource);
      const toolName = item?.extensions?.bazaar?.info?.input?.toolName ?? '';
      const uniqueKey = `${resource ?? '?'}\0${toolName}`;
      pageKeys.push(uniqueKey);
      seenKeys.add(uniqueKey);
      const accepts = Array.isArray(item?.accepts) ? item.accepts : [];
      const related = typeof payTo === 'string' && accepts.some(x =>
        typeof x?.payTo === 'string' && x.payTo.toLowerCase() === payTo.toLowerCase());
      if (resource === target) {
        matches.push({resource, type: item?.type ?? null, toolName: String(toolName),
          x402Version: item?.x402Version ?? null, networks: networkSummary(item),
          desiredNetworkFound: network ? networkSummary(item).includes(network) : null,
          desiredPayToFound: payTo ? related : null});
      } else if (related && samePayToOtherResource.length < 15) {
        samePayToOtherResource.push({resource, networks: networkSummary(item)});
      }
    }
    const signature = pageKeys.join('\n');
    if (items.length && seenPageSignatures.has(signature)) {
      reason = `Repeated page contents at page ${pages}; provider may ignore pagination`; break;
    }
    seenPageSignatures.add(signature);
    const pagination = body?.pagination && typeof body.pagination === 'object' ? body.pagination : {};
    if (Number.isSafeInteger(pagination.total) && pagination.total >= 0) knownTotal = pagination.total;
    if (knownTotal !== null && seenKeys.size >= knownTotal) { complete = true; break; }
    if (!items.length) {
      if (knownTotal !== null && seenKeys.size < knownTotal) reason = 'Empty page before declared total';
      else complete = true;
      break;
    }
    const nextCursor = pagination.nextCursor ?? pagination.next_cursor ?? pagination.cursor;
    if (typeof nextCursor === 'string' && nextCursor.length > 0 && nextCursor !== cursor) {
      useCursor = true;
      cursor = nextCursor;
    } else if (useCursor) {
      if (knownTotal !== null && rawRows < knownTotal) reason = 'Cursor ended before declared total';
      else complete = true;
      break;
    } else {
      // Short last pages prove completion only without a contradictory total.
      if (items.length < pageLimit && knownTotal === null) {
        // One additional empty page confirms the end when no total was advertised.
        offset += items.length;
        continue;
      }
      offset += items.length;
    }
  }
  if (!complete && !reason) reason = `Reached maxPages=${maxPages} before proving catalog exhaustiveness`;
  return {endpoint: endpoint.toString(), pages, rawRows, uniqueKeys: seenKeys.size,
    declaredTotal: knownTotal, complete, incompleteReason: reason,
    matchingResourceCount: matches.length, matches: matches.slice(0, 50),
    matchingPayToOtherResources: samePayToOtherResource};
}

export async function diagnose({resourceUrl, catalogUrl, payTo, network, extensionResponses,
  allowLoopback = false, pageLimit = 100, maxPages = 500, fetchImpl = fetch}) {
  const resource = requireEndpoint(resourceUrl, {allowLoopback});
  const catalog = requireEndpoint(catalogUrl, {allowLoopback});
  let challenge;
  try {
    const result = await readEndpoint(fetchImpl, resource);
    challenge = inspectChallenge(result.status, result.header.get('payment-required'));
  } catch (error) { challenge = {state: 'FETCH_ERROR', error: String(error.message)}; }
  const derivedPayTo = payTo || (challenge.acceptsCount === 1 ? challenge.accepts?.[0]?.payTo : null);
  const summary = await inspectCatalog({catalogUrl: catalog.toString(), targetResource: resource.toString(),
    payTo: derivedPayTo, network, allowLoopback, pageLimit, maxPages, fetchImpl});
  const extension = bazaarExtensionOutcome(extensionResponses);
  let verdict = 'INCONCLUSIVE_CATALOG';
  if (summary.matchingResourceCount) {
    verdict = network && summary.matches.every(m => !m.desiredNetworkFound)
      ? 'LISTED_WRONG_NETWORK' : 'LISTED';
  } else if (summary.complete) verdict = 'NOT_LISTED_IN_EXHAUSTED_CATALOG';
  return {
    schema: 'stellar-forge.seller-visibility.v1', mode: 'READ_ONLY_UNAUTHENTICATED',
    seller: resource.toString(), network: network ?? null, desiredPayTo: derivedPayTo ?? null,
    challenge, extensionResponse: extension, catalog: summary, verdict,
    interpretation: verdict === 'NOT_LISTED_IN_EXHAUSTED_CATALOG'
      ? 'Missing from this facilitator catalog at read time; successful payment alone does not prove catalog indexing.'
      : verdict === 'INCONCLUSIVE_CATALOG'
        ? 'Catalog coverage incomplete; do not interpret this as absence.'
        : 'Listing observed; check matching network, payment terms and seller origin separately.',
    excludes: ['No settlement or wallet verification', 'No facilitator indexing trigger', 'No payment made']
  };
}

function parseArgs(args) {
  const options = {};
  const values = new Set(['--resource','--catalog','--pay-to','--network','--extension-responses',
    '--extension-responses-file','--limit','--max-pages']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--allow-loopback') { options.allowLoopback = true; continue; }
    if (!values.has(flag) || !args[i+1] || args[i+1].startsWith('--')) throw new TypeError(`Invalid option: ${flag}`);
    const value = args[++i];
    const mapping = {'--resource':'resourceUrl','--catalog':'catalogUrl','--pay-to':'payTo',
      '--network':'network','--extension-responses':'extensionResponses',
      '--extension-responses-file':'extensionResponsesFile','--limit':'pageLimit','--max-pages':'maxPages'};
    options[mapping[flag]] = ['--limit','--max-pages'].includes(flag) ? Number(value) : value;
  }
  if (!options.resourceUrl || !options.catalogUrl) throw new TypeError('--resource and --catalog required');
  if (options.extensionResponses && options.extensionResponsesFile) throw new TypeError('Supply extension response in only one place');
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.extensionResponsesFile) {
      options.extensionResponses = (await readFile(options.extensionResponsesFile, 'utf8')).trim();
      delete options.extensionResponsesFile;
    }
    const result = await diagnose(options);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  })().catch(error => {
    process.stderr.write('SF52 diagnostic error: ' + String(error.message) + '\n');
    process.exitCode = 1;
  });
}
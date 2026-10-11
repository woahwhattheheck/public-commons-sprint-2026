// MIT. Offline, source-bound interpretation of original SF52 unpaid GET and Bazaar catalog observations.
// No HTTP client, wallet, seller invocation, or settlement path.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeSf56Capture} from './sf56_capture.mjs';

const SCHEMA = 'stellar-forge.unpaid-get-evidence.v1';
const SOURCE_SCHEMA = 'stellar-forge.seller-visibility.v1';
const MAX_SOURCE = 8_000_000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new TypeError('Expected bounded URL');
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash) {
    throw new TypeError('Invalid or credentialed source URL');
  }
  return u;
}

// Exact native SF52 identity policy: URL, stripped fragment, trailing-slash normalization.
function resourceKey(value) {
  const locator = typeof value === 'string' ? value : object(value) ? value.url : null;
  if (typeof locator !== 'string') return null;
  try {
    const u = new URL(locator);
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch { return null; }
}

function requireReport(report) {
  if (!object(report) || report.schema !== SOURCE_SCHEMA ||
      report.mode !== 'READ_ONLY_UNAUTHENTICATED' ||
      typeof report.seller !== 'string' || !object(report.catalog) ||
      typeof report.catalog.endpoint !== 'string' || !object(report.challenge) ||
      typeof report.challenge.state !== 'string') {
    throw new TypeError('Expected original native SF52 diagnostic JSON');
  }
  safeUrl(report.seller);
  safeUrl(report.catalog.endpoint);
  if (report.catalog.complete !== true && report.catalog.complete !== false) {
    throw new TypeError('SF52 catalog completeness must be explicit');
  }
  return report;
}

function captureRows(capture, catalogUrl) {
  if (!object(capture) || capture.url !== catalogUrl || !Array.isArray(capture.pages) ||
      capture.pages.length > 2000 || !capture.pages.length) {
    throw new TypeError('Original catalog snapshot requires matching url and nonempty pages array');
  }
  const rows = [];
  for (const page of capture.pages) {
    if (!object(page)) throw new TypeError('Malformed original catalog page');
    const items = Array.isArray(page.items) ? page.items : page.resources;
    if (!Array.isArray(items) || items.length > 2000) throw new TypeError('Malformed catalog items/resources page');
    rows.push(...items);
    if (rows.length > 50_000) throw new RangeError('Excessive catalog rows');
  }
  return rows;
}

function selectedOffer(row, report) {
  if (!Array.isArray(row.accepts)) return false;
  return row.accepts.some(offer => object(offer) &&
    (!report.network || offer.network === report.network) &&
    (!report.desiredPayTo || (typeof offer.payTo === 'string' &&
      offer.payTo.toLowerCase() === report.desiredPayTo.toLowerCase())));
}

function nativeHttpInput(row) {
  const input = row?.extensions?.bazaar?.info?.input;
  if (!object(input)) return null;
  // SF56's original admission contract identifies HTTP at row.type and the
  // operation at input.method. Preserve legacy envelopes that put the type
  // on input, but do not require that redundant field for native listings.
  return row.type === 'http' || input.type === 'http' ? input : null;
}

export function reconcile(reportInput, captureInput, {reportSha256 = null, captureSha256 = null} = {}) {
  const report = requireReport(reportInput);
  const native = captureInput?.source !== undefined ? normalizeSf56Capture(captureInput, report) : null;
  const rows = captureRows(native ? native.envelope : captureInput, report.catalog.endpoint);
  const target = resourceKey(report.seller);
  const rawRows = native ? native.rawRows : rows;
  const matches = rawRows.filter(row => object(row) && resourceKey(row.resource) === target);
  // Raw Vellar listings quarantined by the original SF56 inspector cannot be offers.
  const eligible = rows.filter(row => object(row) && resourceKey(row.resource) === target)
    .filter(row => selectedOffer(row, report));
  const sourceMethods = [...new Set(eligible.map(nativeHttpInput)
    .filter(object).map(input => input.method)
    .filter(m => typeof m === 'string').map(m => m.toUpperCase()))].sort();
  const getRows = eligible.filter(row =>
    String(nativeHttpInput(row)?.method).toUpperCase() === 'GET');
  const urlKeys = new Set(safeUrl(report.seller).searchParams.keys());
  const queryKeySet = new Set();
  for (const row of getRows) {
    const ex = row.extensions?.bazaar?.info?.input?.queryParams;
    if (object(ex)) for (const key of Object.keys(ex)) if (key.length <= 120) queryKeySet.add(key);
  }
  const exampleQueryKeys = [...queryKeySet].sort();
  const exampleKeysAbsentFromProbeUrl = exampleQueryKeys.filter(k => !urlKeys.has(k));
  const httpStatus = report.challenge.httpStatus;
  const state = report.challenge.state;
  let finding;
  if (state === 'CATALOG_NON_GET_ONLY') finding = 'GET_NOT_PERFORMED_BY_SF52';
  else if (state === 'FETCH_ERROR') finding = 'GET_FETCH_UNOBSERVED';
  else if (httpStatus === 400) finding = 'GET_HTTP_400_REQUEST_REJECTED';
  else if (state === 'X402_402') finding = 'GET_HTTP_402_PAYMENT_CHALLENGE_OBSERVED';
  else if (httpStatus === 402) finding = 'GET_HTTP_402_CHALLENGE_NOT_VERIFIED';
  else if (httpStatus === 200) finding = 'GET_HTTP_200_NO_UNPAID_CHALLENGE';
  else finding = 'GET_OTHER_OR_UNOBSERVED';
  const acceptedMatches = rows.filter(row => object(row) && resourceKey(row.resource) === target);
  const dataAlignment = matches.length === 0 ? 'NO_MATCH_IN_SUPPLIED_SNAPSHOT' :
    native && acceptedMatches.length === 0 ? 'MATCH_QUARANTINED_BY_SF56_SOURCE_RULES' :
    eligible.length === 0 ? 'NO_MATCHING_PAYMENT_OPTION_IN_SNAPSHOT' :
    'MATCHING_RESOURCE_AND_SINGLE_PAYMENT_OPTION';
  return {
    schema: SCHEMA,
    original: {reportSha256, captureSha256, sourceReportSchema: SOURCE_SCHEMA,
      seller: report.seller, catalogUrl: report.catalog.endpoint,
      reportCatalogComplete: report.catalog.complete,
      reportVerdict: report.verdict ?? null,
      captureObservedAt: native ? native.audit.capturedAt :
        (typeof captureInput.observedAt === 'string' ? captureInput.observedAt : null),
      captureCompletenessAttested: native ? true : captureInput.complete === true,
      captureFormat: native?.audit.captureFormat ?? 'SF71_OPERATOR_ENVELOPE',
      originalPageSha256: native?.audit.originalPageSha256 ?? [],
      originalSourceTrust: native?.audit.sourceTrust ?? 'SUPPLIED_ENVELOPE_ONLY'},
    observed: {sourceChallengeState: state, httpStatus: Number.isSafeInteger(httpStatus) ? httpStatus : null,
      classification: finding, sellerOriginGetObserved: state !== 'CATALOG_NON_GET_ONLY' &&
      state !== 'FETCH_ERROR' && Number.isSafeInteger(httpStatus)},
    sourceCatalog: {matchedUrlRows: matches.length, rowsWithPairedNetworkAndPayTo: eligible.length,
      nativeQuarantinedRows: native?.audit.quarantinedRows ?? null,
      nativeDuplicateResourceRows: native?.audit.duplicateResourceRows ?? null,
      nativeInspectorApplied: !!native,
      methods: sourceMethods, getOperationRows: getRows.length,
      dataAlignment, queryExampleKeys: exampleQueryKeys,
      exampleKeysAbsentFromProbeUrl},
    interpretation: {
      requiredQueryKeysProven: false,
      missingParameterCauseProven: false,
      checkoutFailureProven: false,
      catalogAbsenceProvenByThisTool: false,
      paidRequestPerformed: false,
      paymentOrSettlementVerified: false,
      nextAction: finding === 'GET_HTTP_400_REQUEST_REJECTED'
        ? 'Inspect seller-owned requirements and authorized request shape. Bazaar queryParams are examples, NOT JSON-Schema required fields. An empty-input GET returning 400 does not prove checkout or settlement failure.'
        : 'Interpret native SF52 origin and facilitator evidence separately. No paid call or merchant acceptance is established.'
    }
  };
}

async function jsonFile(path) {
  const bytes = await readFile(path);
  if (!bytes.length || bytes.length > MAX_SOURCE) throw new RangeError('Source JSON must be 1..8000000 bytes');
  return {source: JSON.parse(bytes.toString('utf8')), digest: sha256(bytes)};
}

export async function main(argv = process.argv.slice(2)) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--report', '--capture', '--out'].includes(argv[i]) ||
        !argv[i + 1] || argv[i + 1].startsWith('--') || opts[argv[i]]) {
      throw new TypeError('Usage: node triage.mjs --report sf52.json --capture original-pages.json [--out new.json]');
    }
    opts[argv[i]] = argv[i + 1];
  }
  if (!opts['--report'] || !opts['--capture']) throw new TypeError('--report and --capture are required');
  const [report, catalog] = await Promise.all([jsonFile(opts['--report']),jsonFile(opts['--capture'])]);
  const output = JSON.stringify(reconcile(report.source, catalog.source,
    {reportSha256: report.digest, captureSha256: catalog.digest}), null, 2) + '\n';
  if (opts['--out']) await writeFile(opts['--out'], output, {flag: 'wx',mode: 0o600});
  process.stdout.write(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {process.stderr.write('SF71 read-only triage: ' + error.message + '\n'); process.exitCode = 1;});
}


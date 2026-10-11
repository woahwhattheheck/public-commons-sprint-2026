#!/usr/bin/env node
// MIT. SF77 offline grant/merchant evidence binder. Consumes only ORIGINAL SF66+SF47 files.
// Never requests remote resources, performs payment, or writes over existing reports.
import { createHash } from 'node:crypto';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const CAPTURE_SCHEMA = 'stellar-forge.sf66.original-operator-capture/v1';
const HEX = /^[a-f0-9]{64}$/;
const SHA = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (good, message) => { if (!good) throw new Error(message); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = n => Number.isSafeInteger(n) && n >= 0;
const iso = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /Z$/.test(value);
const cleanText = (s, limit = 900) => typeof s === 'string' ? s.slice(0, limit) : '';
function cents(value) {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value), 'INVALID_USD_AMOUNT');
  const [whole, decimal = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt((decimal + '00').slice(0, 2));
}
const fmt = amount => (amount / 100n).toString() + '.' + (amount % 100n).toString().padStart(2, '0');

export function verifyOriginalCapture(capture) {
  check(object(capture) && capture.schema === CAPTURE_SCHEMA, 'NOT_ORIGINAL_SF66_FULL_CAPTURE');
  check(capture.completeness === 'COMPLETE_FOR_STABLE_NATIVE_SF60_FILTERED_LIST_AT_OBSERVATION',
    'INCOMPLETE_ORIGIN_CAPTURE');
  check(capture.readOnly === true && capture.paidRequests === 0 &&
    capture.signedRequests === 0 && capture.onchainTransactions === 0,
    'SOURCE_CAPTURE_BOUNDARY_CHANGED');
  check(iso(capture.capturedAt) && integer(capture.count) &&
    (capture.network === null || capture.network === 'stellar:testnet' ||
      capture.network === 'stellar:pubnet'), 'INVALID_SOURCE_HEADER');
  check(HEX.test(capture.initialNativeHealthSha256) &&
    capture.initialNativeHealthSha256 === capture.finalNativeHealthSha256,
    'SOURCE_HEALTH_CHANGED');
  check(object(capture.nativeSourceInfo) &&
    capture.nativeSourceInfo.mode === 'ORIGINAL_SF60_DURABLE_CATALOG' &&
    capture.nativeSourceInfo.paidRequestsEnabled === false &&
    capture.nativeSourceInfo.autoPaymentEnabled === false,
    'SOURCE_IDENTITY_OR_READ_ONLY_GATE_CHANGED');
  check(Array.isArray(capture.pages) && capture.pages.length > 0, 'NO_ORIGINAL_SOURCE_PAGES');
  let offset = 0;
  let total = null;
  const digestRows = [];
  for (const [index, page] of capture.pages.entries()) {
    check(object(page) && page.offset === offset && integer(page.count) && page.count <= 100 &&
      integer(page.total) && typeof page.originalNativeJson === 'string' &&
      typeof page.originalViewerJson === 'string', 'INVALID_ORIGINAL_PAGE_' + index);
    check(HEX.test(page.nativeSha256) && HEX.test(page.viewerSha256), 'INVALID_SOURCE_HASH_' + index);
    check(SHA(Buffer.from(page.originalNativeJson, 'utf8')) === page.nativeSha256 &&
      SHA(Buffer.from(page.originalViewerJson, 'utf8')) === page.viewerSha256,
      'SOURCE_BYTES_HASH_MISMATCH_' + index);
    let native, atlas;
    try {
      native = JSON.parse(page.originalNativeJson);
      atlas = JSON.parse(page.originalViewerJson);
    } catch { throw new Error('INVALID_ORIGINAL_JSON_' + index); }
    check(object(native) && object(atlas) && Array.isArray(native.resources) &&
      Array.isArray(atlas.resources) && object(native.pagination) && object(atlas.pagination),
      'INVALID_ORIGINAL_PAGINATION_' + index);
    check(atlas.mode === 'ORIGINAL_SF60_DURABLE_CATALOG' && atlas.view === 'list' &&
      atlas.paidRequestsEnabled === false && atlas.readOnly === true,
      'ATLAS_SOURCE_MODE_CHANGED_' + index);
    check(isDeepStrictEqual(native.resources, atlas.resources) &&
      isDeepStrictEqual(native.pagination, atlas.pagination),
      'NATIVE_ATLAS_PARITY_MISMATCH_' + index);
    check(page.count === native.resources.length &&
      native.pagination.total === page.total &&
      (!('offset' in native.pagination) || native.pagination.offset === offset),
      'ORIGINAL_PAGE_COUNTS_MISMATCH_' + index);
    if (total === null) total = page.total;
    check(total === page.total && offset + page.count <= total, 'CHANGING_OR_OVERFULL_TOTAL_' + index);
    if (offset < total) check(page.count > 0, 'PAGINATION_DID_NOT_PROGRESS_' + index);
    offset += page.count;
    digestRows.push({ offset: page.offset, entries: page.count, nativeSha256: page.nativeSha256,
      atlasSha256: page.viewerSha256 });
  }
  check(offset === total && offset === capture.count, 'UNFINISHED_ORIGINAL_PAGINATION');
  return Object.freeze({
    observedAt: capture.capturedAt, network: capture.network, observedRows: offset,
    pages: capture.pages.length, stableHealthSha256: capture.initialNativeHealthSha256,
    nativeAtlasPageDigests: digestRows,
    coverage: capture.completeness
  });
}

export function verifyOriginalScenario(scenario) {
  check(object(scenario) && scenario.schema_version === '1.0' &&
    scenario.status === 'ILLUSTRATIVE_UNSENT' &&
    scenario.team_budget_inputs_are_hypothetical === true,
    'NOT_ORIGINAL_ILLUSTRATIVE_SCENARIO');
  const award = cents(scenario.award_request_usd);
  check(award > 0n && integer(scenario.project_end_day), 'INVALID_AWARD_OR_DURATION');
  check(Array.isArray(scenario.milestones) && scenario.milestones.length === 3,
    'REQUIRES_ORIGINAL_THREE_MILESTONES');
  let lastDay = 0;
  const stages = scenario.milestones.map((m, idx) => {
    check(object(m) && m.tranche === idx + 1 && integer(m.submit_day) &&
      m.submit_day > lastDay && m.submit_day <= scenario.project_end_day &&
      integer(m.review_and_payment_lag_days), 'INVALID_MILESTONE_' + (idx + 1));
    lastDay = m.submit_day;
    return { tranche: m.tranche, plannedSubmitDay: m.submit_day,
      assumedReviewLagDays: m.review_and_payment_lag_days,
      deliverable: cleanText(m.deliverable), proposedProof: cleanText(m.measurable_proof),
      costUSD: '0.00' };
  });
  check(Array.isArray(scenario.future_costs) && scenario.future_costs.length > 0,
    'MISSING_FUTURE_COSTS');
  const totals = [0n, 0n, 0n];
  for (const [idx, cost] of scenario.future_costs.entries()) {
    check(object(cost) && integer(cost.tranche) && cost.tranche >= 1 && cost.tranche <= 3 &&
      cost.future_only === true && integer(cost.start_day) && cost.start_day > 0 &&
      integer(cost.end_day) && cost.end_day >= cost.start_day &&
      cost.end_day <= stages[cost.tranche - 1].plannedSubmitDay,
      'INVALID_FUTURE_COST_' + idx);
    const amount = cents(cost.amount_usd);
    check(amount > 0n, 'NONPOSITIVE_FUTURE_COST_' + idx);
    totals[cost.tranche - 1] += amount;
  }
  check(totals.reduce((a,b) => a + b, 0n) === award, 'FUTURE_COSTS_DO_NOT_MATCH_AWARD');
  for (let i = 0; i < stages.length; i++) stages[i].costUSD = fmt(totals[i]);
  return {
    status: scenario.status, hypothetical: true, requestedScenarioUSD: fmt(award),
    modeledProjectDays: scenario.project_end_day, proposedMilestones: stages,
    notice: 'One illustrative, unsubmitted scenario. Human rates, eligibility, seller consent, and actual review/payment timing require independent owner confirmation.'
  };
}

export function makeManifest(capture, scenario, digests) {
  const source = verifyOriginalCapture(capture);
  const budget = verifyOriginalScenario(scenario);
  return {
    schema: 'stellar-forge.sf77.operator-evidence/v1',
    generatedAt: new Date().toISOString(),
    purpose: 'Founder/merchant operator evidence handoff from existing exact original source; NOT an SCF filing or milestone acceptance.',
    inputs: {
      sf66FullCaptureSha256: digests.captureSha256,
      sf47IllustrativeScenarioSha256: digests.scenarioSha256,
      filesAreReadOnly: true
    },
    originalLocalCatalogEvidence: source,
    illustrativeFutureWork: budget,
    evidenceGates: [
      { name: 'Original local durable-catalog capture', status: 'VERIFIED_INPUT',
        meaning: 'SF66 original SF60-to-SF61 pages matched their own original SHA-256 and native-to-Atlas resource/pagination shape.' },
      { name: 'External provider freshness and actual seller authority', status: 'NOT_ESTABLISHED_BY_INPUTS' },
      { name: 'Approved participant and entity eligibility for SCF', status: 'NOT_ESTABLISHED_BY_INPUTS' },
      { name: 'Signed on-chain payment, merchant fulfillment or settlement', status: 'NOT_ESTABLISHED_BY_INPUTS' },
      { name: 'Milestone review and grant award acceptance', status: 'NOT_ESTABLISHED_BY_INPUTS' },
      { name: 'Actual human hours, staffing cost and working-capital coverage', status: 'NOT_ESTABLISHED_BY_INPUTS' }
    ],
    boundary: 'No raw seller rows, seller URLs, operator directory, identities, keys, wallet operations, payout, external fetch or new catalog records are included. Original private capture remains in operator custody.'
  };
}

const escape = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function renderHtml(manifest) {
  const e = escape, source = manifest.originalLocalCatalogEvidence;
  const budget = manifest.illustrativeFutureWork;
  const stageRows = budget.proposedMilestones.map(m => '<tr><td>' + m.tranche +
    '</td><td>' + m.plannedSubmitDay + '</td><td>' + e(m.costUSD) +
    '</td><td>' + e(m.deliverable) + '</td><td>' + e(m.proposedProof) + '</td></tr>').join('');
  const gateRows = manifest.evidenceGates.map(g => '<tr><td>' + e(g.name) +
    '</td><td>' + e(g.status) + '</td><td>' + e(g.meaning || '') + '</td></tr>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;;style-src &#39;unsafe-inline&#39;">' +
    '<title>SF77 Original-Source Operator Evidence</title>' +
    '<style>body{font:16px/1.55 system-ui,sans-serif;max-width:1100px;margin:auto;padding:2rem;color:#1d2530}' +
    'h1,h2{line-height:1.22}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #d8dde4;padding:.7rem;text-align:left;vertical-align:top}th{background:#f0f2f5}' +
    'p,li{max-width:80ch}code{overflow-wrap:anywhere}small{color:#4c5866}</style></head><body>' +
    '<h1>Stellar Forge SF77 | original-source evidence</h1><p>' + e(manifest.purpose) + '</p>' +
    '<h2>Original local catalog capture</h2>' +
    '<p>Observed UTC: <strong>' + e(source.observedAt) + '</strong> | Network filter: <strong>' +
    e(source.network || 'none') + '</strong> | Observed records: <strong>' + source.observedRows +
    '</strong> | Original pages: <strong>' + source.pages + '</strong></p>' +
    '<p>Original capture SHA-256: <code>' + e(manifest.inputs.sf66FullCaptureSha256) +
    '</code></p><p>Stable original health SHA-256: <code>' + e(source.stableHealthSha256) + '</code></p>' +
    '<h2>Founder budget planning only</h2><p>Status: <strong>' + e(budget.status) +
    '</strong> | Hypothetical USD total: <strong>$' + e(budget.requestedScenarioUSD) +
    '</strong> | Modeled duration: ' + budget.modeledProjectDays + ' days.</p><table><thead><tr>' +
    '<th>Milestone</th><th>Proposed day</th><th>Future costs (USD)</th><th>Proposed deliverable</th><th>Proof required</th>' +
    '</tr></thead><tbody>' + stageRows + '</tbody></table><p>' + e(budget.notice) + '</p>' +
    '<h2>Proof gates, not grant acceptance</h2><table><thead><tr><th>Gate</th><th>State</th><th>Basis</th>' +
    '</tr></thead><tbody>' + gateRows + '</tbody></table><p><small>' + e(manifest.boundary) +
    '</small></p><p><small>Generated ' + e(manifest.generatedAt) +
    '. This page is self-contained and performs no network calls.</small></p></body></html>\n';
}

function flags(argv) {
  const args = {};
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i+1];
    check(['--capture', '--scenario', '--out'].includes(key) &&
      typeof value === 'string' && !value.startsWith('--') && !args[key],
      'USAGE: node export.mjs --capture ORIGINAL-SF66.json --scenario SF47.json --out NEW-DIRECTORY');
    args[key] = value;
  }
  check(args['--capture'] && args['--scenario'] && args['--out'],
    'REQUIRED_CAPTURE_SCENARIO_AND_OUTPUT_DIRECTORY');
  return args;
}
async function boundedFile(path, cap) {
  const size = await stat(path);
  check(size.isFile() && size.size > 0 && size.size <= cap, 'INPUT_SIZE_OUT_OF_RANGE');
  return readFile(path);
}

export async function main(argv = process.argv.slice(2)) {
  const args = flags(argv);
  if (args.help) { console.log('node export.mjs --capture ORIGINAL-SF66.json --scenario SF47.json --out NEW-DIRECTORY'); return; }
  const [captureBytes, scenarioBytes] = await Promise.all([
    boundedFile(resolve(args['--capture']), 128 * 1024 * 1024),
    boundedFile(resolve(args['--scenario']), 2 * 1024 * 1024),
  ]);
  let capture, scenario;
  try { capture = JSON.parse(captureBytes.toString('utf8')); scenario = JSON.parse(scenarioBytes.toString('utf8')); }
  catch { throw new Error('INPUT_NOT_JSON'); }
  const manifest = makeManifest(capture, scenario, {
    captureSha256: SHA(captureBytes), scenarioSha256: SHA(scenarioBytes)
  });
  const destination = resolve(args['--out']);
  // Reject a pre-existing directory/file atomically, rather than overwriting accepted evidence.
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const manifestPath = join(destination, 'manifest.json');
  const htmlPath = join(destination, 'index.html');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {flag:'wx',mode:0o600});
  await writeFile(htmlPath, renderHtml(manifest), {flag:'wx',mode:0o600});
  console.log(JSON.stringify({ status:'WRITTEN', manifest:manifestPath, html:htmlPath,
    observedRows:manifest.originalLocalCatalogEvidence.observedRows,
    inputCaptureSha256:manifest.inputs.sf66FullCaptureSha256 }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error('SF77: ' + String(error.message ?? error)); process.exitCode = 1; });

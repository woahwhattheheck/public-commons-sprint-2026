// MIT — SF53 operator-local workbench for the existing, merged SCF source.
// Runs the original read-only proof once at startup. Never signs, pays or submits.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('./', import.meta.url);
const HOST = '127.0.0.1';
const HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});
const ASSETS = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
});
const safeNumber = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const shortError = err => String(err?.message ?? err).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 240);

/**
 * Invoke the actual accepted source modules, not reimplemented payment logic.
 * Dependency loading is lazy so this HTTP shell can be focused-tested in isolation.
 */
export async function readOriginalEvidence({
  smokeRunner, releaseRunner, wireRunner, observedAt = new Date().toISOString(),
} = {}) {
  const smokeTask = smokeRunner ? smokeRunner() :
    import('../sf51-local-commerce-smoke/smoke.mjs').then(module => module.runLocalSourceSmoke());
  const releaseTask = releaseRunner ? releaseRunner({ strictPins: false }) :
    import('../sf46-release/preflight.mjs').then(module => module.assessRelease({ strictPins: false }));
  // Run the original published SF52 seller compiler → HTTP 402 → original SF31 buyer.
  // This third proof remains independent from SF51 MCP and SF46 release health.
  const wireTask = wireRunner ? Promise.resolve().then(() => wireRunner()) :
    import('../sf52-seller-buyer-wire/acceptance.mjs').then(module => module.runSellerBuyerWire());
  const [smokeRun, releaseRun, wireRun] = await Promise.allSettled([smokeTask, releaseTask, wireTask]);
  let commerce;
  if (smokeRun.status === 'rejected') {
    commerce = { status: 'FAIL', detail: shortError(smokeRun.reason) };
  } else {
    const r = smokeRun.value;
    const correct = r?.status === 'PASS' && r?.executedPaymentCalls === 0 &&
      r?.signedRequests === 0 && r?.testnetTransactions === 0 &&
      r?.cancelledReplay === true && r?.merchantGet402 === 1 && r?.discovered === 1;
    commerce = {
      status: correct ? 'PASS_LOCAL_SOURCE_SMOKE' : 'FAIL_INVARIANT',
      discovered: safeNumber(r?.discovered), seller402: safeNumber(r?.merchantGet402),
      signedRequests: safeNumber(r?.signedRequests),
      paidCalls: safeNumber(r?.executedPaymentCalls),
      testnetTransactions: safeNumber(r?.testnetTransactions),
      cancelledReplay: r?.cancelledReplay === true,
      protocol: typeof r?.protocol === 'string' ? r.protocol.slice(0, 64) : null,
    };
  }
  let release;
  if (releaseRun.status === 'rejected') {
    release = { status: 'FAIL', detail: shortError(releaseRun.reason), sources: [] };
  } else {
    const r = releaseRun.value;
    const sources = Array.isArray(r?.sources) ? r.sources : [];
    const failures = Array.isArray(r?.failures) ? r.failures : [];
    const warnings = Array.isArray(r?.warnings) ? r.warnings : [];
    release = {
      status: r?.status === 'PASS_SOURCE_CONTRACTS_ONLY' && failures.length === 0 ?
        'PASS_SOURCE_CONTRACTS_ONLY' : 'FAIL_SOURCE_PREFLIGHT',
      matchingPins: sources.filter(x => x.status === 'PIN_MATCH').length,
      changedPins: sources.filter(x => x.status === 'SOURCE_CHANGED').length,
      missingOrUnreadable: sources.filter(x => x.status === 'MISSING' || x.status === 'READ_ERROR').length,
      warnings: warnings.map(String).slice(0, 24).map(x => x.slice(0, 240)),
      failures: failures.map(String).slice(0, 24).map(x => x.slice(0, 240)),
      sources: sources.map(x => ({
        id: typeof x.id === 'string' ? x.id.slice(0, 100) : 'unknown',
        status: ['PIN_MATCH', 'SOURCE_CHANGED', 'MISSING', 'READ_ERROR'].includes(x.status) ? x.status : 'UNKNOWN',
        expectedGitBlob: /^[0-9a-f]{40}$/.test(x.expectedGitBlob ?? '') ? x.expectedGitBlob : null,
        actualGitBlob: /^[0-9a-f]{40}$/.test(x.actualGitBlob ?? '') ? x.actualGitBlob : null,
      })),
      unverifiedGates: Array.isArray(r?.unverifiedGates) ? r.unverifiedGates.length : null,
    };
  }
  let wire;
  if (wireRun.status === 'rejected') {
    wire = { status: 'FAIL_WIRE_SOURCE', detail: shortError(wireRun.reason) };
  } else {
    const r = wireRun.value;
    const expectedDenials = [
      'PAYMENT_NOT_APPROVED', 'PAYMENT_TERMS_NOT_AUTHORIZED',
      'PAYMENT_TERMS_NOT_AUTHORIZED', 'PAYMENT_TERMS_NOT_AUTHORIZED',
      'PAYMENT_TERMS_NOT_AUTHORIZED', 'RESOURCE_MISMATCH',
    ];
    const decisions = Array.isArray(r?.quoteDecisions) ? r.quoteDecisions : [];
    const deniedCorrectly = decisions.length === 6 && decisions.every((d, i) =>
      d?.denied === expectedDenials[i] && d?.requests === 1 && d?.signatures === 0 &&
      d?.approvals === (i === 0 ? 1 : 0));
    const correct = r?.status === 'PASS' && r?.actualHttpRequests === 6 &&
      r?.signedHttpRequests === 0 && r?.signingCallbacks === 0 &&
      r?.chainTransactions === 0 && r?.sellerPayments === 0 && deniedCorrectly;
    wire = {
      status: correct ? 'PASS_DENIED_WIRE_POLICY' : 'FAIL_WIRE_INVARIANT',
      httpProbes: safeNumber(r?.actualHttpRequests),
      operatorRefusals: decisions.filter(d => d?.denied === 'PAYMENT_NOT_APPROVED').length,
      blockedBeforeApproval: decisions.filter(d => d?.approvals === 0 && d?.denied).length,
      signedRequests: safeNumber(r?.signedHttpRequests),
      signingCallbacks: safeNumber(r?.signingCallbacks),
      chainTransactions: safeNumber(r?.chainTransactions),
      decisions: decisions.slice(0, 6).map(d => ({
        label: typeof d?.label === 'string' ? d.label.slice(0, 100) : 'unknown',
        denial: typeof d?.denied === 'string' ? d.denied.slice(0, 80) : 'unknown',
        approvals: safeNumber(d?.approvals), signatures: safeNumber(d?.signatures),
      })),
    };
  }
  return Object.freeze({
    schema: 'stellar-forge.sf53.local-proof.v1', observedAt,
    source: 'Original published SF51 commerce smoke and SF46 release preflight',
    commerce, release, wire,
    restrictions: {
      browserCanTriggerPayment: false,
      browserCanTriggerAdditionalRuns: false,
      testnetSettlementProved: false,
      mainnetDeploymentProved: false,
      buyerOrMerchantAdoptionProved: false,
      scfApplicationSubmitted: false,
    },
  });
}

/** Serve only precomputed evidence, from a loopback-only listener. */
export async function startWorkbench({ report, port = 0 } = {}) {
  if (!report || report.schema !== 'stellar-forge.sf53.local-proof.v1') throw new TypeError('Original evidence report required');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid local port');
  const files = new Map(await Promise.all(Object.entries(ASSETS).map(async ([path, [file, mime]]) =>
    [path, { body: await readFile(new URL(file, ROOT)), mime }])));
  const body = Buffer.from(JSON.stringify(report));
  let origin = '';
  const server = createServer((req, res) => {
    const end = (code, data = '', mime = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { ...HEADERS, 'content-type': mime });
      res.end(req.method === 'HEAD' ? '' : data);
    };
    // Browser DNS-rebinding/cross-site access is not authorized even on loopback.
    if (req.socket.localAddress !== HOST || req.socket.remoteAddress !== HOST ||
        req.headers.host !== origin.slice('http://'.length)) return end(403, 'Local origin only');
    if (!['GET', 'HEAD'].includes(req.method)) return end(405, 'Read-only GET/HEAD');
    // No remote proxy, query-backed URI, redirects, write route or payment API.
    if (req.url === '/api/report') return end(200, body, 'application/json; charset=utf-8');
    const asset = files.get(req.url);
    if (!asset) return end(404, 'Not found');
    return end(200, asset.body, asset.mime);
  });
  try {
    await new Promise((success, fail) => { server.once('error', fail); server.listen(port, HOST, success); });
    origin = 'http://' + HOST + ':' + server.address().port;
    return { server, url: origin, close: () => new Promise(done => server.close(done)) };
  } catch (error) {
    if (server.listening) await new Promise(done => server.close(done));
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // One run, at launch. Browser reads the snapshot and can never rerun commerce.
  const report = await readOriginalEvidence();
  const session = await startWorkbench({ report });
  process.stdout.write('SF53 local proof workbench: ' + session.url + '\nCommerce: ' + report.commerce.status + '; source preflight: ' + report.release.status + '; original wire: ' + report.wire.status + '\n');
  process.stdout.write('Read-only on 127.0.0.1; Ctrl-C to stop. No wallet or external listener.\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    session.close().finally(() => { process.exitCode = 0; });
  });
}

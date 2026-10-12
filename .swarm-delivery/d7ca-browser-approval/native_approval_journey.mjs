// Scratch-only native acceptance journey. Run through native_approval_journey.py.
// Uses original modules, disposable local policy/ledger, and the original SF81
// fictional merchant/signer fixture; every fetch terminates on this loopback server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let raw = ''; for await (const part of process.stdin) raw += part;
const fixture = JSON.parse(raw);
const scf = join(fixture.source, 'stellar/scf-starforge-20261009');
const { OperatorApprovedBuyer } = await import(pathToFileURL(join(scf, 'sf81-buyer-operator-bridge/bridge.mjs')));
const { createBrowserApprovalBroker } = await import(pathToFileURL(join(scf, 'sf81-buyer-operator-bridge/browser-approval.mjs')));
const { startCommerceConsole } = await import(pathToFileURL(join(scf, 'sf66-demo-launcher/commerce-console.mjs')));
const { initializeWorkspace, openWorkspace } = await import(pathToFileURL(join(scf, 'sf88-operator-buyer-cli/workspace.mjs')));
const { workspaceExecution } = await import(pathToFileURL(join(scf, 'sf88-operator-buyer-cli/queue.mjs')));
const { readRequestBody } = await import(pathToFileURL(join(scf, 'sf88-operator-buyer-cli/request-body.mjs')));
const sha = value => createHash('sha256').update(value).digest('hex');
const limits = ['max_single', 'max_total', 'max_per_utc_day', 'max_per_actor_utc_day', 'max_per_service_utc_day'];
const body = '{"city":"Zürich"}';
const terms = { scheme: 'exact', network: 'stellar:testnet', asset: 'C' + 'A'.repeat(55),
  payTo: 'G' + 'A'.repeat(55), amount: '7', maxTimeoutSeconds: 60,
  extra: { memo: 'Original Unicode terms: café', paymentFlow: 'authorization' } };
const expect = { scheme: terms.scheme, network: terms.network, asset: terms.asset,
  payTo: terms.payTo, maxAtomic: '9', maxTimeoutSeconds: terms.maxTimeoutSeconds, paymentFlow: 'authorization' };
const signatures = [], sends = [], nativeIntents = new Map(), scenarios = [];
const brokers = new Set(), settledCalls = new Set();
const workspaceDirectory = join(fixture.directory, 'workspace');
const bodyPath = join(fixture.directory, 'body.json');
const requestPath = join(fixture.directory, 'request.json');
await writeFile(bodyPath, body, { mode: 0o600, flag: 'wx' });
await writeFile(requestPath, JSON.stringify({ operation: { intentId: 'browser-approved',
  url: 'https://merchant.example/browser-approved', method: 'POST', expect,
  bodyFile: bodyPath, bodyBytes: Buffer.byteLength(body), bodySha256: sha(body) } }),
{ mode: 0o600, flag: 'wx' });
await initializeWorkspace(['--config', requestPath, '--dir', workspaceDirectory,
  '--actor', 'fixture-actor', '--service', 'fixture-seller', '--payer', 'G' + 'A'.repeat(55),
  '--python', fixture.python, '--total-atomic', '100', '--daily-atomic', '100'], { environment: fixture.keys });
const workspace = await openWorkspace(['--dir', workspaceDirectory]);
const errorDetails = error => ({ code: error?.code ?? error?.name,
  operatorReason: error?.operatorReason, paymentSent: error?.paymentSent });
const observe = promise => {
  const settled = promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: errorDetails(error) }));
  settledCalls.add(settled); return settled;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, ready, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  do {
    latest = await read();
    if (ready(latest)) return latest;
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail(label + ': ' + JSON.stringify(latest));
}
const merchant = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const sentBody = Buffer.concat(chunks).toString('utf8');
  const signed = Boolean(req.headers['payment-signature']);
  sends.push({ path: req.url, method: req.method, body: sentBody, signed });
  if (!signed) {
    const challenge = { x402Version: 2,
      resource: { url: 'https://merchant.example' + req.url }, accepts: [terms] };
    res.writeHead(402, { 'payment-required': Buffer.from(JSON.stringify(challenge)).toString('base64') });
    res.end('payment required'); return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ delivered: true }));
});
merchant.listen(0, '127.0.0.1'); await once(merchant, 'listening');
const fetchImpl = (url, options) => {
  assert.equal(url.origin, 'https://merchant.example');
  return fetch(`http://127.0.0.1:${merchant.address().port}${url.pathname}`, options);
};
const sign = async ({ intent, challenge, accepted }) => {
  assert.ok(Object.isFrozen(intent) && Object.isFrozen(intent.acceptedTerms));
  assert.equal(intent.amount, '7'); assert.equal(intent.maxAtomic, '9');
  assert.equal(intent.bodyBytes, Buffer.byteLength(body));
  assert.equal(intent.bodySha256, sha(body));
  assert.deepEqual(intent.acceptedTerms, terms);
  nativeIntents.set(intent.intentId, structuredClone(intent)); signatures.push(intent.intentId);
  return { x402Version: 2, accepted, resource: challenge.resource, payload: { fixtureOnly: true } };
};
const call = async (hostEnvironment, intentId, signal, timeoutMs = 8000) => {
  const configuration = { ...workspace.config, operation: { ...workspace.config.operation,
    intentId, url: 'https://merchant.example/' + intentId } };
  // This original prerequisite checks presence and installed SDK availability;
  // the existing acceptance signer below supplies the disposable fixture payload.
  const selected = await workspaceExecution(configuration, workspaceDirectory, { environment: {
    ...hostEnvironment, STELLAR_SECRET: 'fixture-prerequisite-only',
  } });
  assert.deepEqual(selected.environment, { ...fixture.keys, ...hostEnvironment });
  const retainedBody = await readRequestBody(configuration.operation);
  const buyer = new OperatorApprovedBuyer({ operator: { ...configuration.operator,
    environment: selected.environment, timeoutMs }, fetchImpl });
  return buyer.call({ intentId, url: configuration.operation.url, method: configuration.operation.method,
    body: Uint8Array.from(retainedBody), expect: configuration.operation.expect, sign, signal });
};
const decision = (approval, selected = 'approve') => ({ intent: approval.intentId,
  approvalId: approval.id, requestSha256: approval.review.request_sha256, decision: selected });
const pending = (broker, intentId) => until(() => broker.snapshot(intentId),
  value => value?.state === 'AWAITING_OPERATOR', 'native review did not arrive for ' + intentId);
async function newBroker() {
  const broker = await createBrowserApprovalBroker({ directory: fixture.directory });
  brokers.add(broker); return broker;
}
async function closeBroker(broker) { await broker.close(); brokers.delete(broker); }

// Only the retained-session presentation is a fixture. The actual SF88 workspace
// loader and queue binding select the keys, policy, ledger and live host channel.
const jobs = new Map(['browser-approved', 'browser-interrupted'].map(intentId => [intentId, {
  operation: { intentId, url: 'https://merchant.example/' + intentId, method: 'POST', expect },
  merchant: { routeId: intentId, acceptIndex: 0, originalTerms: terms },
  state: 'QUEUED', configSha256: sha('fixture configuration ' + intentId),
  bodySha256: sha(body), bodyBytes: Buffer.byteLength(body),
  operator: { actor: 'fixture-actor', service: 'fixture-seller' },
  dependencies: { signer: { path: workspace.config.signerModule } },
}]));
let sessionState = 'RUNNING', selectedEnvironment, activeCall, controller, activeIntent;
const results = new Map(), setterCalls = [];
const session = {
  seller: { compiled: { routes: [...jobs.keys()].map(id => ({ id, method: 'POST', path: '/' + id })) } },
  setOperatorApprovalEnvironment(environment) {
    const names = Object.keys(environment).sort();
    if (names.length) {
      assert.deepEqual(names, ['SF81_APPROVAL_SOCKET', 'SF81_APPROVAL_TOKEN']);
      assert.match(environment.SF81_APPROVAL_TOKEN, /^[a-f0-9]{64}$/);
    }
    selectedEnvironment = { ...environment }; setterCalls.push(names);
  },
  async status() {
    return structuredClone({ state: sessionState, directory: fixture.directory,
      operations: { traffic: { sessionId: 'browser-approval-native-fixture', startedAt: new Date(0).toISOString() } },
      seller: { publicOrigin: 'https://merchant.example', url: 'http://127.0.0.1:' + merchant.address().port,
        mode: 'NATIVE_X402', docs: 'https://merchant.example/docs' }, buyers: [...jobs.values()] });
  },
  async review(intentId) {
    assert.ok(jobs.has(intentId));
    return { exitCode: 0, original: { mode: 'OFFLINE_REVIEW', intentId } };
  },
  async execute(intentId) {
    assert.ok(selectedEnvironment, 'console must attach its trusted channel before execute');
    assert.equal(activeCall, undefined);
    const job = jobs.get(intentId); assert.equal(job.state, 'QUEUED');
    job.state = 'RUNNING_OR_INTERRUPTED'; job.attempt = { startedAt: new Date().toISOString() };
    controller = new AbortController(); activeIntent = intentId;
    const nativeCall = call(selectedEnvironment, intentId, controller.signal);
    activeCall = nativeCall;
    try {
      const result = await nativeCall;
      results.set(intentId, result);
      assert.deepEqual(await result.response.json(), { delivered: true });
      job.outcome = { status: result.status, reason: result.reason, operatorReservation: result.operatorReservation };
      job.state = 'REVIEW_REQUIRED';
      return { exitCode: 2, original: job.outcome };
    } catch (error) {
      job.state = 'REVIEW_REQUIRED'; job.lastError = { code: error.code };
      throw error;
    } finally { activeCall = undefined; activeIntent = undefined; controller = undefined; }
  },
  async interrupt(intentId) {
    assert.equal(activeIntent, intentId); const original = activeCall;
    controller.abort(); await original.catch(() => {});
  },
  async cancel(intentId) { jobs.get(intentId).state = 'CANCELLED'; },
  async recover(intentId) { return { intentId, state: jobs.get(intentId).state }; },
  async close() {
    const original = activeCall; controller?.abort();
    if (original) await original.catch(() => {});
    sessionState = 'STOPPED'; return { state: 'STOPPED', drained: true };
  },
};
let consoleSession, approvedEnvelope;
try {
  consoleSession = await startCommerceConsole(session, { port: 0, approvalMode: 'BROWSER' });
  const origin = new URL(consoleSession.url).origin;
  assert.deepEqual(setterCalls.at(-1), ['SF81_APPROVAL_SOCKET', 'SF81_APPROVAL_TOKEN']);
  const api = async (path, value, options = {}) => {
    const headers = { 'x-commerce-token': consoleSession.token,
      ...(value === undefined ? {} : { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' }),
      ...options.headers };
    if (options.unauthenticated) delete headers['x-commerce-token'];
    const response = await fetch(origin + path, { method: value === undefined ? 'GET' : 'POST',
      headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    return { status: response.status, body: await response.json() };
  };
  const snapshot = async intentId => {
    const result = await api('/api/session?intent=' + intentId);
    assert.equal(result.status, 200); return result.body;
  };
  const start = async intentId => {
    const review = await api('/api/review', { intent: intentId });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    const execution = await api('/api/execute', { intent: intentId, reviewId: review.body.review.id });
    assert.equal(execution.status, 202, JSON.stringify(execution.body));
    return until(() => snapshot(intentId), value => value.approval?.state === 'AWAITING_OPERATOR',
      'browser did not receive the native review');
  };
  const initial = await snapshot('browser-approved');
  assert.equal(initial.approvalMode, 'BROWSER'); assert.equal(initial.approval, null);
  assert.equal((await api('/api/session', undefined, { unauthenticated: true })).status, 401);
  for (const [route, file] of [
    ['/approval-ui/approval-panel.mjs', 'approval-panel.mjs'], ['/approval-ui/approval.css', 'approval.css'],
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), await readFile(join(scf, 'sf81-buyer-operator-bridge/browser-ui', file), 'utf8'));
  }
  const waiting = await start('browser-approved'); approvedEnvelope = waiting.approval;
  const reviewed = approvedEnvelope.review, estimate = approvedEnvelope.current_native_budget_estimate;
  assert.equal(waiting.activeIntent, 'browser-approved'); assert.equal(waiting.attempt.state, 'RUNNING');
  assert.equal(reviewed.request_id, 'browser-approved'); assert.match(reviewed.request_sha256, /^[a-f0-9]{64}$/);
  assert.equal(reviewed.actor, 'fixture-actor'); assert.equal(reviewed.service, 'fixture-seller');
  assert.equal(reviewed.resource, 'https://merchant.example/browser-approved'); assert.equal(reviewed.method, 'POST');
  assert.equal(reviewed.network, terms.network); assert.equal(reviewed.asset, terms.asset);
  assert.equal(reviewed.pay_to, terms.payTo); assert.equal(reviewed.scheme, terms.scheme);
  assert.equal(reviewed.max_atomic_units_to_reserve, '7'); assert.equal(reviewed.max_timeout_seconds, 60);
  assert.equal(waiting.operation.expect.maxAtomic, '9'); assert.equal(reviewed.body_present, true);
  assert.equal(reviewed.body_bytes, Buffer.byteLength(body)); assert.equal(reviewed.body_sha256, sha(body));
  assert.deepEqual(reviewed.complete_original_accepted_terms, terms);
  assert.equal(estimate.approved, true); assert.equal(estimate.reserved_max_base_units, '7');
  assert.deepEqual(estimate.limit_remaining, Object.fromEntries(limits.map(key => [key, key === 'max_single' ? '9' : '100'])));
  assert.ok(Date.parse(approvedEnvelope.expiresAt) > Date.parse(approvedEnvelope.createdAt));
  const exactDecision = decision(approvedEnvelope);
  assert.equal((await api('/api/approval', exactDecision, { unauthenticated: true })).status, 401);
  assert.equal((await api('/api/approval', exactDecision, { headers: { origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await api('/api/approval', { ...exactDecision, requestSha256: '0'.repeat(64) })).status, 409);
  assert.equal((await snapshot('browser-approved')).approval.state, 'AWAITING_OPERATOR');
  assert.equal(signatures.length, 0);
  assert.equal((await api('/api/approval', { ...exactDecision, policy: '/untrusted/config' })).status, 400);
  const accepted = await api('/api/approval', exactDecision);
  assert.ok([200, 202].includes(accepted.status), JSON.stringify(accepted));
  const approved = await until(() => snapshot('browser-approved'), value =>
    value.approval?.state === 'APPROVED' && value.activeIntent === null && value.attempt?.state !== 'RUNNING',
  'approved original attempt did not complete');
  const originalResult = results.get('browser-approved');
  assert.equal(originalResult.status, 'PAYMENT_OUTCOME_UNKNOWN');
  assert.equal(originalResult.reason, 'MISSING_PAYMENT_RESPONSE');
  assert.equal(originalResult.operatorReservation.outcome, 'FRESH_RESERVATION_APPROVED');
  assert.equal(originalResult.operatorReservation.request_sha256, reviewed.request_sha256);
  assert.equal(originalResult.operatorReservation.reserved_atomic_units, '7');
  assert.equal(approved.attempt.outcome.status, originalResult.status);
  assert.deepEqual(signatures, ['browser-approved']);
  scenarios.push({ name: 'browser native approval', state: approved.approval.state,
    authenticated: true, sameOrigin: true, exactDigest: reviewed.request_sha256,
    reservedAtomic: '7', retainedConfiguredMaximum: '9', originalOutcome: originalResult.status });
  scenarios.push({ name: 'HTTP digest and configuration mismatch', state: 'REFUSED_WHILE_PENDING' });
  scenarios.push({ name: 'original queue workspace environment', state: 'NATIVE_KEYS_AND_HOST_CHANNEL_BOUND',
    keys: ['SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64', 'SF81_APPROVAL_SOCKET', 'SF81_APPROVAL_TOKEN'] });

  const interrupted = await start('browser-interrupted');
  assert.equal(interrupted.approval.current_native_budget_estimate.limit_remaining.max_total, '93');
  assert.equal(interrupted.approval.current_native_budget_estimate.limit_remaining.max_single, '9');
  const interrupt = await api('/api/interrupt', { intent: 'browser-interrupted' });
  assert.ok([200, 202].includes(interrupt.status), JSON.stringify(interrupt));
  const revoked = await until(() => snapshot('browser-interrupted'), value =>
    value.activeIntent === null && value.approval?.state === 'FAILED', 'interrupt did not revoke approval');
  assert.equal(revoked.attempt.error, 'OPERATOR_ABORTED');
  assert.equal((await api('/api/approval', decision(interrupted.approval))).status, 409);
  assert.deepEqual(signatures, ['browser-approved']);
  scenarios.push({ name: 'browser interrupt', state: revoked.approval.state, error: revoked.attempt.error });
  await consoleSession.close(); consoleSession = null;

  // A new host/broker over the same durable ledger must not turn the same intent
  // into another fresh reservation or another signer call.
  const replayBroker = await newBroker();
  const replayCall = observe(call(replayBroker.environment, 'browser-approved'));
  const replayReview = await pending(replayBroker, 'browser-approved');
  assert.equal(replayReview.review.request_sha256, reviewed.request_sha256);
  replayBroker.decide(decision(replayReview));
  const replay = await replayCall;
  assert.equal(replay.ok, false); assert.equal(replay.error.code, 'OPERATOR_NO_APPROVAL');
  assert.equal(replay.error.operatorReason, 'NO_FRESH_RESERVATION');
  assert.equal(replayBroker.snapshot('browser-approved').state, 'FAILED');
  assert.deepEqual(signatures, ['browser-approved']);
  scenarios.push({ name: 'durable replay after broker restart', state: 'FAILED', ...replay.error });
  await closeBroker(replayBroker);

  const rejectBroker = await newBroker();
  const rejectCall = observe(call(rejectBroker.environment, 'browser-rejected'));
  const rejectReview = await pending(rejectBroker, 'browser-rejected');
  rejectBroker.decide(decision(rejectReview, 'reject'));
  const rejected = await rejectCall;
  assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'OPERATOR_NO_APPROVAL');
  assert.equal(rejected.error.operatorReason, 'EXPLICIT_OPERATOR_CONSENT_NOT_GIVEN');
  assert.equal(rejectBroker.snapshot('browser-rejected').state, 'REJECTED');
  assert.throws(() => rejectBroker.decide(decision(rejectReview)), error => Boolean(error.code));
  assert.deepEqual(signatures, ['browser-approved']);
  scenarios.push({ name: 'explicit rejection', state: 'REJECTED', ...rejected.error });
  await closeBroker(rejectBroker);

  const timeoutBroker = await newBroker();
  const timeoutCall = observe(call(timeoutBroker.environment, 'browser-timeout', undefined, 2000));
  const timeoutReview = await pending(timeoutBroker, 'browser-timeout');
  const timedOut = await timeoutCall;
  assert.equal(timedOut.ok, false);
  assert.ok(['OPERATOR_TIMEOUT', 'OPERATOR_BROWSER_REVIEW_EXPIRED', 'OPERATOR_BROWSER_CHANNEL_TIMEOUT'].includes(timedOut.error.code));
  const timeoutFinal = await until(() => timeoutBroker.snapshot('browser-timeout'), value =>
    ['FAILED', 'EXPIRED'].includes(value?.state), 'timeout left a pending native approval');
  assert.throws(() => timeoutBroker.decide(decision(timeoutReview)), error => Boolean(error.code));
  assert.deepEqual(signatures, ['browser-approved']);
  scenarios.push({ name: 'native helper timeout', state: timeoutFinal.state, ...timedOut.error });
  await closeBroker(timeoutBroker);

  const disconnectedBroker = await newBroker();
  const disconnectedCall = observe(call(disconnectedBroker.environment, 'browser-disconnected'));
  const disconnectedReview = await pending(disconnectedBroker, 'browser-disconnected');
  await closeBroker(disconnectedBroker);
  const disconnected = await disconnectedCall;
  assert.equal(disconnected.ok, false);
  assert.ok(['OPERATOR_BROWSER_CHANNEL_CLOSED', 'OPERATOR_BROWSER_CHANNEL_UNAVAILABLE'].includes(disconnected.error.code));
  assert.equal(disconnectedBroker.snapshot('browser-disconnected').state, 'FAILED');
  assert.throws(() => disconnectedBroker.decide(decision(disconnectedReview)), error => Boolean(error.code));
  assert.deepEqual(signatures, ['browser-approved']);
  assert.equal(sends.filter(value => value.signed).length, 1);
  assert.ok(sends.every(value => value.method === 'POST' && value.body === body));
  scenarios.push({ name: 'host disconnect', state: 'FAILED', ...disconnected.error });
  process.stdout.write(JSON.stringify({ status: 'PASS', scenarios, signatures,
    signedRequests: sends.filter(value => value.signed).length,
    approvedEnvelope, originalIntent: nativeIntents.get('browser-approved'),
    freshReservation: originalResult.operatorReservation, sends }) + '\n');
} finally {
  if (consoleSession) await consoleSession.close().catch(() => {});
  await Promise.allSettled([...brokers].map(broker => broker.close()));
  await Promise.allSettled([...settledCalls]);
  merchant.closeAllConnections(); await new Promise(resolve => merchant.close(resolve));
}

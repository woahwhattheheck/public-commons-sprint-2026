// MIT. One native Python -> original SF30/SDK merchant lifecycle, no wallet/network spend.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { readPythonMerchant, compilePythonMerchant } from './config.mjs';
import { createPythonSource } from './source.mjs';
import { previewContext, startPythonMerchant } from './merchant.mjs';
import { createNativeSellerServer } from '../native-factory.mjs';

const execFile = promisify(execFileCallback), here = dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'sf30-python-'));
let source, challengeOnly, native;
try {
  const raw = JSON.parse(await readFile(new URL('./example-merchant.json', import.meta.url), 'utf8'));
  const application = join(directory, 'application.py');
  await writeFile(application, await readFile(new URL('./example-application.py', import.meta.url), 'utf8') +
    '\nimport time\ndef slow(input):\n    time.sleep(2)\n    return {}\n\ndef invalid_output(input):\n    return {"unrepresentable_integer": 9007199254740993}\n');
  raw.application = application;
  raw.maxPending = 4;
  for (const name of ['slow', 'invalid_output']) raw.functions[name] = {
    ...raw.functions.summarize, path: '/' + name, inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    example: {}, timeoutMs: name === 'slow' ? 250 : 10000,
  };
  const compiled = compilePythonMerchant(raw);
  const context = (name, values) => previewContext(compiled.functions[name], values);
  const input = { values: [2, 4, 6, 8], window: 2 };
  source = await createPythonSource(compiled);
  const summary = JSON.parse(await source.call('summarize', context('summarize', input)));
  assert.deepEqual(summary.rollingMean, [2, 3, 5, 7]); assert.equal(summary.mean, 5);
  const csv = (await source.call('amortize', context('amortize', { principal: 1200, annual_rate: 0, periods: 12 }))).toString();
  assert(csv.endsWith('12,100.00,100.00,0.00,0.00\n'));
  assert.equal(source.route('summarize').admit(context('summarize', { ...input, extra: 'PRIVATE' })).status, 422);
  await assert.rejects(source.call('invalid_output', context('invalid_output', {})), { code: 'PYTHON_OUTPUT_REJECTED' });
  const slow = source.call('slow', context('slow', {})).catch(failure => failure.code);
  assert.equal(JSON.parse(await source.call('summarize', context('summarize', input))).count, 4);
  assert.equal(source.stats().running, 1); assert.equal(await slow, 'PYTHON_CALL_TIMEOUT');
  assert.equal(JSON.parse(await source.call('summarize', context('summarize', input))).mean, 5);
  const abort = new AbortController();
  const interrupted = source.call('slow', context('slow', {}), { signal: abort.signal }).catch(failure => failure.code);
  setTimeout(() => abort.abort(), 30);
  assert.equal(await interrupted, 'PYTHON_CALL_ABORTED');
  const saturated = Array.from({ length: 4 }, () => source.call('slow', context('slow', {})).catch(failure => failure.code));
  assert.equal(source.route('summarize').admit(context('summarize', input)).status, 429);
  await Promise.all(saturated);
  assert(source.stats().peakProcesses <= 2);
  await source.close(); assert.equal(source.stats().processes, 0);

  challengeOnly = await startPythonMerchant(compiled, { port: 0 });
  assert.equal(challengeOnly.source, null);
  let response = await fetch(challengeOnly.seller.url + '/summary', { method: 'POST' });
  assert.equal(response.status, 402); await response.arrayBuffer();
  await challengeOnly.close();

  let verifies = 0, settlements = 0, refuse = false, failSettlement = false;
  const facilitator = {
    async getSupported() { return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }], extensions: ['bazaar'], signers: {} }; },
    async verify() { verifies++; return refuse ? { isValid: false, invalidReason: 'local_controlled_refusal' } : { isValid: true, payer: 'local-controlled-payer' }; },
    async settle() { settlements++; return { success: !failSettlement, transaction: 'local-controlled-result', network: 'stellar:testnet',
      ...(failSettlement ? { errorReason: 'local_controlled_settlement_failure' } : {}) }; },
  };
  native = await startPythonMerchant(compiled, { port: 0, operationsPort: 0,
    nativeFactory: routes => createNativeSellerServer(routes, { facilitatorClient: facilitator }) });
  const fetchRequest = (path, body, signature) => fetch(native.seller.url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(signature ? { 'payment-signature': signature } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  const signatureFor = challenge => Buffer.from(JSON.stringify({ x402Version: 2, resource: challenge.resource,
    accepted: challenge.accepts[0], payload: { transaction: 'LOCAL_CONTROLLED_NOT_A_TRANSACTION' }, extensions: challenge.extensions })).toString('base64');
  response = await fetchRequest('/summary', { window: 1 });
  assert.equal(response.status, 422); await response.arrayBuffer(); assert.equal(verifies, 0);
  response = await fetchRequest('/summary', input);
  assert.equal(response.status, 402); const challenge = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64'));
  await response.arrayBuffer(); assert.equal(native.source.stats().submitted, 0);
  const signature = signatureFor(challenge);
  response = await fetchRequest('/summary', input, signature);
  assert.equal(response.status, 200); assert.equal((await response.json()).mean, 5);
  assert(response.headers.get('payment-response')); assert.equal(verifies, 1); assert.equal(settlements, 1);
  refuse = true;
  response = await fetchRequest('/summary', input, signature);
  assert.equal(response.status, 402); await response.arrayBuffer(); assert.equal(native.source.stats().submitted, 1);
  refuse = false; failSettlement = true;
  response = await fetchRequest('/summary', input, signature);
  assert.equal(response.status, 402); assert(!(await response.text()).includes('rollingMean')); assert.equal(settlements, 2);
  failSettlement = false;
  response = await fetchRequest('/schedule?principal=1200&annual_rate=0&periods=12');
  const csvChallenge = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64')); await response.arrayBuffer();
  response = await fetchRequest('/schedule?principal=1200&annual_rate=0&periods=12', undefined, signatureFor(csvChallenge));
  assert.equal(response.status, 200); assert.equal(await response.text(), csv);
  response = await fetchRequest('/invalid_output', {});
  const errorChallenge = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64')); await response.arrayBuffer();
  const beforeFailedHandler = settlements;
  response = await fetchRequest('/invalid_output', {}, signatureFor(errorChallenge));
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'PYTHON_OUTPUT_REJECTED');
  assert.equal(settlements, beforeFailedHandler);
  response = await fetch(native.seller.url + '/_seller/docs'); assert.equal(response.status, 200); await response.arrayBuffer();
  response = await fetch(native.operations.url + '/'); assert.equal(response.status, 200); await response.arrayBuffer();
  await native.close(); assert.equal(native.source.stats().processes, 0);

  const config = join(directory, 'merchant.json'), requestInput = join(directory, 'input.json'), output = join(directory, 'preview.json');
  await writeFile(config, JSON.stringify(raw)); await writeFile(requestInput, JSON.stringify(input));
  const inspected = await execFile(process.execPath, [join(here, 'merchant.mjs'), 'inspect', '--config', config]);
  assert.equal(JSON.parse(inspected.stdout).pythonImported, false);
  const preview = await execFile(process.execPath, [join(here, 'merchant.mjs'), 'preview', '--config', config,
    '--function', 'summarize', '--input', requestInput, '--out', output]);
  assert.equal(JSON.parse(preview.stdout).status, 'LOCAL_PREVIEW_SAVED'); assert.equal(JSON.parse(await readFile(output)).mean, 5);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(execFile(process.execPath, [join(here, 'merchant.mjs'), 'preview', '--config', config,
    '--function', 'summarize', '--input', requestInput, '--out', output]));
  const original = await readPythonMerchant(join(here, 'example-merchant.json'));
  assert.equal(original.service.routes.length, 2);
  console.log(JSON.stringify({ result: 'PASS', node: process.version,
    flow: 'typed Python JSON/CSV -> concurrent worker isolation/recovery -> original SF30/schema/SDK verify-handler-settle -> operations -> private CLI preview',
    nativeSdk: '2.28.0', facilitator: 'controlled local client; no wallet or chain transaction',
    workerCount: 2, peakProcesses: source.stats().peakProcesses, verifies, settlements }));
} finally {
  await native?.close(); await challengeOnly?.close(); await source?.close(); await rm(directory, { recursive: true, force: true });
}

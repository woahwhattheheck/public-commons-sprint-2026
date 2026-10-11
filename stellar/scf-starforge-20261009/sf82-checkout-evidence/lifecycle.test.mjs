// Original SF82 + SF52 + SF43, local response fixtures only; no payment or RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeWithEvidence } from './evidence.mjs';

const result = intentId => ({ intentId, status: 'PAYMENT_OUTCOME_UNKNOWN', attempts: 2,
  httpStatus: 200, settlement: 'UNKNOWN', receipt: null,
  requirement: { scheme: 'exact', network: 'stellar:testnet', asset: 'C'+'A'.repeat(55),
    payTo: 'G'+'B'.repeat(55), amount: '5' }, response: new Response('fixture body') });
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'sf82-lifecycle-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('invalid SF52 identity, timestamp and deadline fail before the buyer is called', async t => {
  const outputDir = await directory(t);
  let calls = 0;
  const buyer = { call: async options => { calls++; return result(options.intentId); } };
  for (const options of [
    { call: { intentId: 'a'.repeat(129) } },
    { observedAt: 'invalid' }, { observedAt: '2026-10-11T00:00:00Z' },
    { bodyCaptureTimeoutMs: 0 }, { bodyCaptureTimeoutMs: 60001 },
  ]) await assert.rejects(executeWithEvidence({ buyer, call: { intentId: 'valid-intent' }, outputDir, ...options }));
  assert.equal(calls, 0); assert.deepEqual(await readdir(outputDir), []);
  const accepted = await executeWithEvidence({ buyer, call: { intentId: 'a'.repeat(128) }, outputDir });
  assert.equal(calls, 1); assert.equal(accepted.report.outcomes[0].status, 'SIGNED_RESULT_UNCERTAIN');
});

test('optional open body times out, persists unavailable status and returns the same attempt', { timeout: 2000 }, async t => {
  const outputDir = await directory(t);
  const sent = result('streaming-intent');
  let controller, calls = 0;
  sent.response = new Response(new ReadableStream({ start(value) { controller = value; } }));
  t.after(() => { try { controller.close(); } catch {} });
  const answer = await executeWithEvidence({ buyer: { call: async () => { calls++; return sent; } },
    call: { intentId: sent.intentId }, outputDir, captureBody: true, bodyCaptureTimeoutMs: 25 });
  assert.equal(answer.result, sent); assert.equal(answer.error, null); assert.equal(calls, 1);
  const persisted = JSON.parse(await readFile(answer.evidencePath, 'utf8'));
  assert.deepEqual(persisted.bodyCapture, { status: 'BODY_CAPTURE_TIMED_OUT', timeoutMs: 25 });
  assert.equal(persisted.observation.delivery, undefined);
  assert.equal(answer.report.counts.verifiedTransfers, 0);
  assert.equal(answer.report.outcomes[0].status, 'SIGNED_RESULT_UNCERTAIN');
  // Cancelling the evidence clone must not consume the original caller body.
  controller.enqueue(new TextEncoder().encode('caller still receives this')); controller.close();
  assert.equal(await sent.response.text(), 'caller still receives this');
});

test('late read rejection and noncooperative cancellation do not replace the original outcome', { timeout: 2000 }, async t => {
  const outputDir = await directory(t);
  for (const [index, cancel] of [() => new Promise(() => {}), () => Promise.reject(Error('private cancellation detail')),
    () => { throw Error('private cancellation detail'); }].entries()) {
    const sent = result('late-read-' + index);
    let rejectRead, cancelled = 0, released = 0;
    const reader = { read: () => new Promise((_resolve, reject) => { rejectRead = reject; }),
      cancel: () => { cancelled++; return cancel(); }, releaseLock: () => { released++; } };
    sent.response = { status: 200, clone: () => ({ body: { getReader: () => reader } }) };
    const answer = await executeWithEvidence({ buyer: { call: async () => sent },
      call: { intentId: sent.intentId }, outputDir, captureBody: true, bodyCaptureTimeoutMs: 5 });
    rejectRead(Error('private late read detail'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(answer.result, sent); assert.equal(cancelled, 1); assert.equal(released, 1);
    const raw = await readFile(answer.evidencePath, 'utf8');
    assert.equal(raw.includes('private'), false);
    assert.equal(JSON.parse(raw).bodyCapture.status, 'BODY_CAPTURE_TIMED_OUT');
  }
});

test('original signed error and finite body evidence retain original interpretation', async t => {
  const outputDir = await directory(t);
  const error = { paymentSent: true, code: 'PAYMENT_OUTCOME_UNKNOWN', cause: { secret: 'never-persist' } };
  const failed = await executeWithEvidence({ buyer: { call: async () => { throw error; } },
    call: { intentId: 'signed-error' }, outputDir, captureBody: true });
  assert.equal(failed.error, error); assert.equal(failed.report.outcomes[0].status, 'SIGNED_RESULT_UNCERTAIN');
  assert.equal((await readFile(failed.evidencePath, 'utf8')).includes('never-persist'), false);
  const sent = result('finite-body');
  const complete = await executeWithEvidence({ buyer: { call: async () => sent },
    call: { intentId: sent.intentId }, outputDir, captureBody: true, bodyCaptureTimeoutMs: 1000 });
  const envelope = JSON.parse(await readFile(complete.evidencePath, 'utf8'));
  assert.equal(envelope.bodyCapture.status, 'HTTP_BODY_OBSERVED');
  assert.equal(envelope.bodyCapture.bodyBytes, 12);
  assert.equal(complete.report.counts.verifiedTransfers, 0);
  assert.equal(await sent.response.text(), 'fixture body');
});

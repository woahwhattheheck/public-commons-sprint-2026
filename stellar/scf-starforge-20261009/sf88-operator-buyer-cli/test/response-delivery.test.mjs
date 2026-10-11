// Focused local composition: actual SF31 transport/writer and SF82 evidence.
// The privileged SF81 constructor and terminal probe are replaced; no signer/payment/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { X402BuyerClient } from '../../sf31-buyer-client/buyer.mjs';

test('one original buyer result becomes an exact local file; failed delivery never retries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sf88-response-'));
  const evidenceDir = join(root, 'evidence');
  await mkdir(evidenceDir, {mode:0o700});
  const signerModule = join(root, 'signer.mjs');
  await writeFile(signerModule, 'export function sign(){throw Error("SIGNER_MUST_NOT_RUN")}');
  let response, calls = 0, evidenceConflict = false, nativeFailure;
  t.mock.module('../../sf81-buyer-operator-bridge/bridge.mjs', {
    namedExports:{checkOperatorTerminal:async () => {},OperatorApprovedBuyer:class {
      async call(options) {
        calls++;
        if (evidenceConflict) await writeFile(join(evidenceDir,
          createHash('sha256').update(options.intentId).digest('hex')+'.json'),'existing');
        if (nativeFailure) throw nativeFailure;
        return new X402BuyerClient({fetchImpl:async () => response}).call({
          ...options, approve:() => { throw Error('APPROVAL_MUST_NOT_RUN'); },
        });
      }
    }},
  });
  const {execute} = await import('../execute.mjs');
  const cfg = name => ({
    operation:{intentId:name,url:'https://seller.example/resource',
      expect:{scheme:'exact',network:'stellar:testnet',asset:'example-asset',
        payTo:'example-recipient',maxAtomic:'1000'}},
    operator:{python:'/usr/bin/python3',actor:'local-fixture',service:'local-fixture',
      policy:join(root,'unused-policy'),ledger:join(root,'unused-ledger')},
    signerModule,evidenceDir,captureBody:false,
    responseFile:{destination:join(root,name+'.bin'),maxBytes:64,timeoutMs:5000},
  });
  const originalWrite = process.stdout.write;
  const originalExit = process.exitCode;
  process.stdout.write = () => true;
  try {
    const exact = Uint8Array.of(0,255,128,10,0,65);
    response = new Response(exact,{headers:{'content-type':'application/octet-stream'}});
    const saved = await execute(cfg('saved'));
    assert.equal(calls,1);
    assert.equal(saved.status,'NO_PAYMENT_REQUIRED');
    assert.equal(saved.sellerReportedSettlement,'NOT_REQUESTED');
    assert.equal(saved.responseFile.status,'SAVED');
    assert.deepEqual(await readFile(saved.responseFile.path),Buffer.from(exact));
    assert.equal(saved.responseFile.sha256,createHash('sha256').update(exact).digest('hex'));
    assert.equal((await stat(saved.responseFile.path)).mode & 0o777,0o600);
    const envelope = JSON.parse(await readFile(saved.evidencePath,'utf8'));
    assert.equal(envelope.bodyCapture.status,'NOT_REQUESTED');
    assert.deepEqual(envelope.report,saved.originalOutcomeReport);

    await assert.rejects(execute(cfg('saved')), {code:'RESPONSE_FILE_EXISTS'});
    assert.equal(calls,1,'existing destination fails before calling buyer');
    assert.deepEqual(await readFile(saved.responseFile.path),Buffer.from(exact));

    let canceled = 0, chunks = 0;
    response = new Response(new ReadableStream({
      pull(c) { c.enqueue(chunks++ === 0 ? Uint8Array.of(1,2) : new Uint8Array(65)); },
      cancel() { canceled++; },
    },{highWaterMark:0}));
    const failed = await execute(cfg('over-limit'));
    assert.equal(calls,2,'save failure does not invoke buyer again');
    assert.equal(canceled,1);
    assert.equal(failed.responseFile.status,'FAILED');
    assert.equal(failed.responseFile.code,'RESPONSE_FILE_TOO_LARGE');
    assert.equal(failed.responseFile.bytes,2);
    assert.deepEqual(await readFile(failed.responseFile.partialPath),Buffer.from([1,2]));
    await assert.rejects(stat(cfg('over-limit').responseFile.destination),{code:'ENOENT'});
    assert.equal(failed.status,'NO_PAYMENT_REQUIRED');
    assert.ok(failed.evidencePath);
    assert.equal(process.exitCode,3);

    const controller = new AbortController();
    canceled = 0; chunks = 0;
    response = new Response(new ReadableStream({
      pull(c) { if (chunks++ === 0) c.enqueue(Uint8Array.of(7)); else controller.abort(); },
      cancel() { canceled++; },
    },{highWaterMark:0}));
    const interrupted = await execute(cfg('interrupted'),{signal:controller.signal});
    assert.equal(calls,3);
    assert.equal(canceled,1);
    assert.equal(interrupted.interrupted,true);
    assert.equal(interrupted.responseFile.code,'RESPONSE_FILE_ABORTED');
    assert.deepEqual(await readFile(interrupted.responseFile.partialPath),Buffer.from([7]));
    assert.equal(interrupted.status,'NO_PAYMENT_REQUIRED');
    assert.equal(interrupted.retry,'NO_AUTOMATIC_RETRY');

    evidenceConflict = true; canceled = 0; chunks = 0;
    response = new Response(new ReadableStream({
      pull(c) { if (chunks++ === 0) c.enqueue(Uint8Array.of(9)); },
      cancel() { canceled++; },
    },{highWaterMark:0}));
    const evidenceFailed = await execute(cfg('evidence-failed'));
    assert.equal(calls,4);
    assert.equal(canceled,1,'evidence failure closes incomplete download');
    assert.equal(evidenceFailed.status,'NO_PAYMENT_REQUIRED');
    assert.equal(evidenceFailed.evidenceError.code,'EEXIST');
    assert.equal(evidenceFailed.responseFile.code,'RESPONSE_FILE_ABORTED');
    assert.equal(process.exitCode,2);

    nativeFailure = Object.assign(new Error('fixture'),{code:'PAYMENT_OUTCOME_UNKNOWN',
      paymentSent:true,operatorReservation:{request_id:'retained-original',
        outcome:'UNKNOWN',reserved_atomic_units:'9007199254740993',secret:'never-emit'}});
    const nativeFailed = await execute(cfg('native-failed'));
    assert.equal(calls,5);
    assert.equal(nativeFailed.error.code,'PAYMENT_OUTCOME_UNKNOWN');
    assert.equal(nativeFailed.error.paymentSent,true);
    assert.equal(nativeFailed.evidenceError.code,'EEXIST');
    assert.equal(nativeFailed.responseFile.status,'NOT_STARTED');
    assert.equal(nativeFailed.operatorReservation.reserved_atomic_units,'9007199254740993');
    assert.equal(Object.hasOwn(nativeFailed.operatorReservation,'secret'),false);
    assert.equal((await readdir(root)).some(name => name.endsWith('.x402-download.lock')),false);
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExit;
    await rm(root,{recursive:true,force:true});
  }
});

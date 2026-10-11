// MIT. One focused native-source exercise. Free loopback HTTP; no simulated settlement.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCsvDataset } from '../../sf30-seller-sdk/dataset-handler.mjs';
import { X402BuyerClient } from '../../sf31-buyer-client/buyer.mjs';
import { prepareBuyerResponseFile } from '../../sf31-buyer-client/response-file.mjs';
import { executeWithEvidence } from '../../sf82-checkout-evidence/evidence.mjs';
import { createDatasetSession, runDatasetSession, inspectDatasetSession,
  recoverDatasetSession, exportDatasetManifest } from '../dataset-session.mjs';
import { inspectDatasetPage, digest } from '../dataset-page.mjs';

const root = await mkdtemp(join(tmpdir(), 'sf88-dataset-native-'));
let server, requests = 0, signatures = 0;
try {
  const csv = join(root, 'source.csv');
  await writeFile(csv, 'id,region,value\n1,east,11\n2,east,22\n3,west,33\n4,east,44\n5,east,55\n6,east,66\n', {mode:0o600});
  const dataset = await loadCsvDataset({file:csv, name:'Native local acquisition exercise',
    columns:{id:'integer',region:'string',value:'number'}, filters:['region'], defaultLimit:2, maxLimit:2});
  server = createServer((request, response) => {
    requests++;
    const u = new URL(request.url, 'http://localhost');
    const result = dataset.handle({query:u.searchParams});
    response.writeHead(result.status, result.headers);
    response.end(JSON.stringify(result.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const local = 'http://127.0.0.1:' + server.address().port;
  const native = new X402BuyerClient({fetchImpl:(url, options) => {
    const u = new URL(url);
    return fetch(local + u.pathname + u.search, options);
  }});
  const source = {
    operation:{intentId:'native-dataset-acquisition-exercise',
      url:'https://dataset-merchant.example.com/data?fields=id,value&where_region=east&limit=2',
      method:'GET',expect:{scheme:'exact',network:'stellar:testnet',asset:'C'+'A'.repeat(55),
        payTo:'G'+'A'.repeat(55),maxAtomic:'100'}},
    operator:{python:'/usr/bin/python3',actor:'exercise',service:'native-dataset',
      policy:join(root,'unused-policy.json'),ledger:join(root,'unused-ledger.sqlite')},
    signerModule:join(root,'unused-signer.mjs'),evidenceDir:root,captureBody:false,
  };
  const configPath = join(root, 'buyer.json');
  await writeFile(configPath, JSON.stringify(source), {mode:0o600});
  // Compose actual existing native buyer, streaming writer and evidence capture.
  // A 402 would fail this free-source exercise rather than fabricate approval or signing.
  async function executeFreePage(cfg, {signal} = {}) {
    const writer = await prepareBuyerResponseFile(cfg.responseFile);
    let saved;
    const buyer = {async call(options) {
      const result = await native.call({...options, approve:async () => { throw Error('Unexpected paid resource'); },
        sign:async () => { signatures++; throw Error('No signer in free HTTP exercise'); }});
      saved = await writer.save(result, {signal});
      return result;
    }};
    let evidence;
    try { evidence = await executeWithEvidence({buyer,
      call:{...cfg.operation, signal},outputDir:cfg.evidenceDir,captureBody:false}); }
    finally { await writer.abort(); }
    assert.equal(evidence.error, null);
    return {mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId:cfg.operation.intentId,
      status:evidence.result.status,httpStatus:evidence.result.httpStatus,
      sellerReportedSettlement:evidence.result.settlement,evidencePath:evidence.evidencePath,
      originalOutcomeReport:evidence.report,operatorReservation:null,
      responseFile:{status:'SAVED',...saved},interrupted:false,retry:'NO_AUTOMATIC_RETRY'};
  }
  const session = join(root, 'resume');
  const created = await createDatasetSession({directory:session,configPath,maxPages:4,maxTotalAtomic:'400',
    expectedSnapshot:dataset.describe().snapshot});
  assert.equal(created.status, 'READY');
  assert.equal(requests, 0);
  const controller = new AbortController();
  const paused = await runDatasetSession(session, {executePage:executeFreePage,signal:controller.signal,
    onPage:() => controller.abort()});
  assert.equal(paused.completedPages, 1);
  assert.equal(paused.acquiredRows, 2);
  assert.equal(requests, 1);
  const first = await readFile(paused.pages[0].responsePath);
  const finished = await runDatasetSession(session, {executePage:executeFreePage});
  assert.equal(finished.status, 'COMPLETE');
  assert.equal(finished.completedPages, 3);
  assert.equal(finished.acquiredRows, 5);
  assert.equal(finished.capAllocatedAtomic, '300');
  assert.equal(requests, 3);
  assert.deepEqual(await readFile(finished.pages[0].responsePath), first);
  const rows = [];
  for (const page of finished.pages) {
    assert.equal(page.nativeBuyerStatus, 'NO_PAYMENT_REQUIRED');
    rows.push(...JSON.parse(await readFile(page.responsePath, 'utf8')).rows);
  }
  assert.deepEqual(rows.map(row => row.id), [1,2,4,5,6]);
  const manifestPath = join(root, 'manifest.json');
  await exportDatasetManifest(session, manifestPath);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')).pageFiles,
    finished.pages.map(page => page.responsePath));
  await runDatasetSession(session, {executePage:executeFreePage});
  assert.equal(requests, 3);
  // Lose only the orchestration result: native response and native evidence survive.
  await unlink(join(session, 'pages', '000003', 'result.json'));
  const recovered = await recoverDatasetSession(session);
  assert.equal(recovered.status, 'COMPLETE');
  assert.equal(recovered.pages[2].recoveredFromOriginalFiles, true);
  assert.equal(requests, 3);
  // Native response corruption must not manufacture a new page cursor.
  const corrupt = JSON.parse(first);
  const cursor = JSON.parse(Buffer.from(corrupt.page.nextCursor, 'base64url'));
  cursor.n++;
  corrupt.page.nextCursor = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  assert.throws(() => inspectDatasetPage(Buffer.from(JSON.stringify(corrupt)),
    {url:source.operation.url}), /DATASET_CURSOR_NOT_CONTIGUOUS/);
  const uncertain = join(root, 'uncertain');
  await createDatasetSession({directory:uncertain,configPath,maxPages:4,maxTotalAtomic:'400'});
  let attempts = 0;
  const lost = async () => { attempts++; throw Object.assign(Error('lost response'), {code:'EXERCISE_LOST_RESPONSE'}); };
  const stopped = await runDatasetSession(uncertain, {executePage:lost});
  assert.equal(stopped.status, 'RECONCILIATION_REQUIRED');
  await runDatasetSession(uncertain, {executePage:lost});
  await recoverDatasetSession(uncertain);
  assert.equal(attempts, 1);
  assert.equal(requests, 3);
  const capped = join(root, 'capped');
  await createDatasetSession({directory:capped,configPath,maxPages:4,maxTotalAtomic:'150'});
  const cappedReport = await runDatasetSession(capped, {executePage:executeFreePage});
  assert.equal(cappedReport.status, 'TOTAL_CAP_REACHED');
  assert.equal(cappedReport.completedPages, 2);
  assert.equal(cappedReport.pages[1].capAllocatedAtomic, '50');
  assert.equal(cappedReport.acquiredRows, 4);
  assert.equal((await inspectDatasetSession(capped)).capAllocatedAtomic, '150');
  assert.equal(signatures, 0);
  console.log(JSON.stringify({status:'PASS',nativeHttpRequests:requests,signatures,
    acquisitionPages:finished.completedPages,acquiredRows:finished.acquiredRows,
    firstPageSha256:digest(first),behaviors:['native pagination','interrupt/resume','completed-file recovery',
      'no repeated uncertain attempt','native cursor binding','atomic session ceiling','original-page export']}));
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(root, {recursive:true,force:true});
}

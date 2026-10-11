// MIT. One native no-network job lifecycle, not a payment simulation.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, unlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeRunbook, inspectRunbook, saveRunbookReport, executeRunbook, recoverRunbook } from './runbook.mjs';

const root = await mkdtemp(join(tmpdir(), 'buyer-runbook-native-'));
const envNames = ['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
try {
  await mkdir(join(root, 'evidence'), {mode:0o700});
  const body = Buffer.from('{"region":"north"}\n');
  await writeFile(join(root, 'request.json'), body, {mode:0o600});
  const imported = join(root, 'native-imports.txt');
  await writeFile(join(root, 'signer.mjs'),
    `import {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(imported)},'imported\\n');\nexport function sign(){throw new Error('SIGNER_MUST_NOT_RUN');}\n`, {mode:0o600});
  // These are local disposable construction placeholders. No approval helper
  // reads them: the original buyer rejects the URL before any network request.
  for (const name of envNames) process.env[name] = Buffer.alloc(32, 9).toString('base64');
  const operations = [];
  for (const [index, cap] of ['9007199254740993','7','11'].entries()) {
    const id = 'resource-' + index;
    const cfg = {operation:{intentId:'native-runbook-' + index, url:'https://127.0.0.1/resource-' + index,
      method:index === 0 ? 'POST' : 'GET', expect:{scheme:'exact', network:index === 2 ? 'stellar:pubnet' : 'stellar:testnet',
        asset:'C' + 'A'.repeat(55), payTo:'G' + 'A'.repeat(55), maxAtomic:cap, maxTimeoutSeconds:60,
        paymentFlow:'authorization'}, ...(index === 0 ? {bodyFile:join(root, 'request.json'), headers:{'Content-Type':'application/json'}} : {})},
      operator:{python:'/usr/bin/python3', actor:'native-check', service:'source-check',
        policy:join(root,'unopened-policy.json'), ledger:join(root,'unopened-ledger.sqlite')},
      signerModule:join(root,'signer.mjs'), evidenceDir:join(root,'evidence'), captureBody:false};
    await writeFile(join(root, id + '.json'), JSON.stringify(cfg), {mode:0o600});
    operations.push({id, label:'Original resource ' + index, config:'./' + id + '.json', saveAs:id + '.json'});
  }
  const manifest = join(root, 'manifest.json'), directory = join(root, 'run');
  await writeFile(manifest, JSON.stringify({schema:'stellar-forge.buyer-runbook.v1', id:'source-native',
    title:'Buyer <operations>', operations}), {mode:0o600});
  const plan = await initializeRunbook({manifest, output:directory});
  assert.deepEqual(plan.plannedMaximums.map(row => [row.network,row.plannedMaximumAtomic]),
    [['stellar:testnet','9007199254741000'],['stellar:pubnet','11']]);
  await writeFile(join(root,'request.json'), 'source changed');
  assert.deepEqual(await readFile(join(directory,'bodies/resource-0.bin')), body);
  const nativeCli = fileURLToPath(new URL('../sf88-operator-buyer-cli/cli.mjs', import.meta.url));
  const review = spawnSync(process.execPath, [nativeCli,'--review','--config',join(directory,'configs/resource-0.json')], {encoding:'utf8'});
  assert.equal(review.status, 0, review.stderr);
  assert.equal(JSON.parse(review.stdout).bodyBytes, body.length);
  const action = await executeRunbook(directory);
  assert.deepEqual(action.results.map(row => row.status), ['RESULT_RECORDED','RESULT_RECORDED','RESULT_RECORDED']);
  let state = await inspectRunbook(directory);
  for (const row of state.operations) {
    assert.equal(row.result.summary.error.code, 'UNSAFE_RESOURCE_HOST');
    assert.equal(row.result.summary.error.paymentSent, false);
    assert.equal(row.result.summary.responseFile.status, 'NOT_STARTED');
    assert.equal(row.result.summary.operatorReservation, null);
    assert.ok((await stat(row.result.summary.evidencePath)).isFile());
  }
  const importedOnce = await readFile(imported, 'utf8');
  assert.equal(importedOnce.split('\n').filter(Boolean).length, 3);
  await unlink(join(directory,'attempts/resource-1.result.json'));
  const recovered = await recoverRunbook(directory);
  assert.deepEqual(recovered.recovered, [{id:'resource-1',state:'RESULT_RECOVERED'}]);
  const resumed = await executeRunbook(directory);
  assert.ok(resumed.results.every(row => row.status === 'ALREADY_ATTEMPTED'));
  assert.equal(await readFile(imported, 'utf8'), importedOnce);
  const report = await saveRunbookReport(directory);
  const html = await readFile(report.reportPath,'utf8');
  assert.ok(html.includes('Buyer &lt;operations&gt;') && !html.includes('<script'));
  assert.equal((await stat(report.reportPath)).mode & 0o077, 0);
  state = report.state;
  assert.equal(state.operations[1].result.exitCode, null);
  assert.equal(state.operations[1].state, 'RESULT_RECOVERED');
  assert.equal(state.executionLock, null);
  console.log(JSON.stringify({status:'PASS', source:'original SF88/SF81/SF31/SF82', operations:3,
    nativeBuyerError:'UNSAFE_RESOURCE_HOST', signedRequests:0, reservations:0,
    originalSummaries:3, recoveredResults:1, repeatedNativeLaunches:0,
    groupedAtomicCeilings:plan.plannedMaximums.map(row=>[row.network,row.plannedMaximumAtomic]),
    requestSnapshotPreserved:true, report:'private offline HTML'}));
} finally {
  for (const name of envNames) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name];
  await rm(root,{recursive:true,force:true});
}

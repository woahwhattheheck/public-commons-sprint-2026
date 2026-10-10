import { buildDemoBundle, verifyBrowserBundle } from './core.mjs';

const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const modify = (value, path, next) => {
  const keys = path.split('.');
  let node = value;
  for (const key of keys.slice(0, -1)) node = node[key];
  const leaf = keys[keys.length - 1];
  const before = node[leaf];
  node[leaf] = typeof next === 'function' ? next(before) : next;
  return { before, after: node[leaf] };
};
const alteredHex = x => `${x[0] === 'f' ? 'e' : 'f'}${x.slice(1)}`;
const alteredSignature = s => `${s[0] === 'A' ? 'B' : 'A'}${s.slice(1)}`;

// Every hostile input is passed to the original first-party verifyBrowserBundle.
// None of these scenarios changes the retained signed original or signs a new receipt.
const scenarios = [
  { id: 'buyer-terms', title: 'Change the buyer price', stage: 'Buyer terms', path: 'task.amountAtomic', mutation: '100000000', reason: 'A worker cannot rewrite the buyer obligation after it was hashed.' },
  { id: 'worker-artifact', title: 'Swap the worker artifact', stage: 'Worker result', path: 'result.artifactDigest', mutation: alteredHex, reason: 'The receipt must still describe the submitted generation and exact artifact.' },
  { id: 'evidence-failure', title: 'Flip a successful CI step', stage: 'Source evidence', path: 'githubEvidence.jobs.0.steps.1.conclusion', mutation: 'failure', reason: 'The pinned GitHub Actions requirement must be actually satisfied.' },
  { id: 'evidence-head', title: 'Substitute another commit', stage: 'Source evidence', path: 'githubExpected.headSha', mutation: () => 'f'.repeat(40), reason: 'A passed run for a different revision cannot satisfy the agreed version.' },
  { id: 'verifier-identity', title: 'Impersonate the verifier', stage: 'Acceptance', path: 'receipt.verifierId', mutation: 'different-verifier', reason: 'The accepting signer identity must match the buyer acceptance policy.' },
  { id: 'forged-signature', title: 'Corrupt the Ed25519 signature', stage: 'Acceptance', path: 'signatureBase64', mutation: alteredSignature, reason: 'The signature must cover the exact canonical acceptance receipt.' },
  { id: 'generation-replay', title: 'Replay a different generation', stage: 'Acceptance', path: 'receipt.generation', mutation: 2, reason: 'A previous acceptance does not authorize a later result generation.' },
  { id: 'settlement-mismatch', title: 'Alter the funding amount', stage: 'Settlement intent', path: 'settlementIntent.funding.amountAtomic', mutation: '99999999', reason: 'Even an unsigned settlement plan must match the buyer funds and agreed amount.' },
  { id: 'policy-bypass', title: 'Sneak in an unsupported policy', stage: 'Buyer terms', path: 'task.acceptancePolicy.requirements.0.id', mutation: 'arbitrary-new-condition', reason: 'Browser proof supports exactly one pinned github-actions requirement.' },
];
const runButton = $('run-matrix');
const exportButton = $('download-proof');
const table = $('matrix-rows');
let lastProof = null;
let busy = false;

function setStatus(kind, message) {
  const el = $('run-status');
  el.dataset.kind = kind;
  el.textContent = message;
}
function showDetail(row) {
  $('selection').textContent = row.title;
  $('detail-description').textContent = row.reason;
  $('detail-json').textContent = JSON.stringify({
    caseId: row.id, stage: row.stage, field: row.path, change: row.change,
    verdict: row.verdict, verifierOutcome: row.verifierOutcome,
  }, null, 2);
}
function renderRow(row) {
  const tr = document.createElement('tr');
  const resultText = row.verdict === 'REJECTED' ? 'REJECTED' : 'UNEXPECTED PASS';
  const texts = [row.stage, row.title, resultText, row.verifierOutcome];
  for (let i=0;i<texts.length;i++) {
    const td = document.createElement('td');
    td.textContent = texts[i];
    if (i===2) td.dataset.verdict = row.verdict;
    tr.appendChild(td);
  }
  tr.tabIndex = 0;
  tr.setAttribute('aria-label', `${row.title}. ${resultText}. Inspect details.`);
  tr.addEventListener('click', () => showDetail(row));
  tr.addEventListener('keydown', e => { if(e.key==='Enter' || e.key===' ') { e.preventDefault(); showDetail(row); } });
  table.appendChild(tr);
}
function resetUi() {
  lastProof = null;
  exportButton.disabled = true;
  table.replaceChildren();
  $('control-verdict').textContent = 'Running…';
  $('control-verdict').dataset.verdict = '';
  $('scenario-count').textContent = `0 / ${scenarios.length}`;
  $('attack-count').textContent = '0';
  $('selection').textContent = 'Proof details';
  $('detail-description').textContent = 'Select a row after the matrix completes.';
  $('detail-json').textContent = '{}';
}

async function runProof() {
  if (busy) return;
  busy = true;
  runButton.disabled = true;
  resetUi();
  setStatus('running', 'Creating an ephemeral verifier key and checking source-native proofs…');
  try {
    const original = await buildDemoBundle();
    const control = await verifyBrowserBundle(original);
    if (control.verdict !== 'PASS' || control.writePerformed !== false || control.externalAuthorityGranted !== false) {
      throw new Error('Original baseline did not yield a local, read-only PASS');
    }
    $('control-verdict').textContent = 'PASS · source-native signed proof';
    $('control-verdict').dataset.verdict = 'PASS';
    $('task-hash').textContent = control.taskDigest;
    $('acceptance-hash').textContent = control.acceptanceDigest;
    $('settlement-hash').textContent = control.settlementIntentDigest;
    const outcomes = [];
    let rejected = 0;
    for (const scenario of scenarios) {
      const tampered = clone(original);
      const change = modify(tampered, scenario.path, scenario.mutation);
      let verdict;
      let verifierOutcome;
      try {
        const result = await verifyBrowserBundle(tampered);
        verdict = 'UNEXPECTED_PASS';
        verifierOutcome = `Verifier returned ${result.verdict}`;
      } catch (err) {
        verdict = 'REJECTED';
        verifierOutcome = `${err.code ? `${err.code}: ` : ''}${err.message}`;
        rejected += 1;
      }
      const row = { id:scenario.id, title:scenario.title, stage:scenario.stage, path:scenario.path,
        reason:scenario.reason, change, verdict, verifierOutcome };
      outcomes.push(row);
      renderRow(row);
      $('scenario-count').textContent = `${outcomes.length} / ${scenarios.length}`;
      $('attack-count').textContent = String(rejected);
    }
    showDetail(outcomes[0]);
    const complete = rejected === scenarios.length;
    lastProof = { schema:'workseal-judge-proof/v1', source:'original-workseal-web-core',
      originalSourceCommit:'02a652efdbdc22844ee277b464fb679bc0a661f5',
      coreGitBlob:'9505e1ca9aabc2a2c1ded7e4b748957776bd9eba',
      note:'Local synthetic signed bundle and hostile mutations. No live GitHub evidence or on-chain execution.',
      validOriginal: control, allHostileInputsRejected: complete, checkedScenarios:outcomes,
      publicSignedBundle: original };
    exportButton.disabled = !complete;
    setStatus(complete ? 'pass' : 'hold', complete
      ? `${rejected}/${scenarios.length} hostile inputs rejected by the source-native verifier. Original proof PASS. No chain/network writes.`
      : `HOLD: ${scenarios.length-rejected} altered case(s) were not rejected. Inspect the matrix. No export permitted.`);
  } catch (err) {
    setStatus('hold', `HOLD: ${err.message}`);
  } finally {
    busy = false;
    runButton.disabled = false;
  }
}
runButton.addEventListener('click', runProof);
exportButton.addEventListener('click', () => {
  if (busy || !lastProof || !lastProof.allHostileInputsRejected) return;
  const json = JSON.stringify(lastProof, null, 2) + '\n';
  const url = URL.createObjectURL(new Blob([json], { type:'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'workseal-judge-proof.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

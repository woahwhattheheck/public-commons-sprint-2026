import { buildDemoBundle, verifyBrowserBundle } from './core.mjs';

const $ = (id) => document.getElementById(id);
const start = $('start');
const tamper = $('tamper');
const reset = $('reset');
const validStatus = $('valid-status');
const tamperStatus = $('tamper-status');
const tamperDetails = $('tamper-details');
const tamperDescription = $('tamper-description');

let validBundle = null;
let busy = false;

function state(element, kind, message) {
  element.className = `status ${kind || ''}`;
  element.textContent = message;
}

function setBusy(value) {
  busy = value;
  start.disabled = value;
  tamper.disabled = value || validBundle === null;
  reset.disabled = value || validBundle === null;
}

function showSummary(bundle, verified) {
  $('task-digest').textContent = verified.taskDigest;
  $('result-digest').textContent = verified.resultDigest;
  $('verifier-fp').textContent = bundle.receiptAuthorityFingerprint;
  $('acceptance-digest').textContent = verified.acceptanceDigest;
  $('settlement-digest').textContent = verified.settlementIntentDigest;
  $('amount').textContent = `${bundle.task.amountAtomic} ${bundle.task.currency}`;
}

function clearTamper() {
  state(tamperStatus, '', 'Untampered — select the attack demonstration');
  tamperDetails.textContent = 'No altered proof submitted to verifier.';
  tamperDescription.textContent = 'The signed original is intact. Tamper alters the worker artifact digest without updating the signed acceptance.';
}

async function generate() {
  if (busy) return;
  setBusy(true);
  state(validStatus, '', 'Generating ephemeral signed demo proof…');
  try {
    // This fixture contains public proof and a signature, but no private key.
    const candidate = await buildDemoBundle();
    const checked = await verifyBrowserBundle(candidate);
    if (checked.verdict !== 'PASS' || checked.writePerformed !== false || checked.externalAuthorityGranted !== false) {
      throw new Error('Expected a local read-only PASS');
    }
    validBundle = candidate;
    showSummary(candidate, checked);
    state(validStatus, 'pass', 'PASS · signed task/result/acceptance/intent bindings verified locally');
    clearTamper();
  } catch (error) {
    validBundle = null;
    state(validStatus, 'hold', `HOLD · ${error.message}`);
    state(tamperStatus, '', 'No valid proof was generated');
  } finally {
    setBusy(false);
  }
}

async function showTamper() {
  if (busy || validBundle === null) return;
  setBusy(true);
  try {
    // Mutate a detached copy. The valid receipt + verifier key remain untouched.
    const changed = JSON.parse(JSON.stringify(validBundle));
    const previous = changed.result.artifactDigest;
    const replacement = (previous[0] === 'f' ? 'e' : 'f') + previous.slice(1);
    changed.result.artifactDigest = replacement;
    const delta = { field:'result.artifactDigest', before:previous, after:replacement };
    try {
      const result = await verifyBrowserBundle(changed);
      // A false PASS is a bug to show honestly, not a success to conceal.
      state(tamperStatus, 'hold', `UNEXPECTED ${result.verdict} · verification did not reject tampering`);
      tamperDetails.textContent = JSON.stringify({delta, result, warning:'The tampered proof was not rejected'}, null, 2);
    } catch (error) {
      state(tamperStatus, 'hold', 'HOLD · altered artifact is not covered by signed ACCEPT');
      tamperDetails.textContent = JSON.stringify({delta, verifierRejection:error.message}, null, 2);
    }
  } finally {
    setBusy(false);
  }
}

start.addEventListener('click', generate);
tamper.addEventListener('click', showTamper);
reset.addEventListener('click', () => {
  if (!busy && validBundle !== null) clearTamper();
});

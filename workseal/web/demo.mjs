import { buildDemoBundle, verifyBrowserBundle } from './core.mjs';

const run = document.querySelector('#run-demo');
const status = document.querySelector('#status');
const output = document.querySelector('#output');
const bundleInput = document.querySelector('#bundle');
const verify = document.querySelector('#verify-bundle');
const exportButton = document.querySelector('#export-verified-bundle');

let verifiedText = null;
let busy = false;

function render(value) { output.textContent = JSON.stringify(value, null, 2); }
function invalidateExport(message) {
  verifiedText = null;
  exportButton.disabled = true;
  if (message) status.textContent = message;
}

bundleInput.addEventListener('input', () => {
  invalidateExport('Bundle changed. Verify again before downloading.');
});

async function runAction(fn) {
  if (busy) return;
  busy = true;
  run.disabled = true;
  verify.disabled = true;
  invalidateExport();
  status.textContent = 'Verifying locally…';
  try {
    const value = await fn();
    if ((value?.verification?.verdict ?? value?.verdict) !== 'PASS') {
      throw new Error('Bundle verification did not pass');
    }
    // Bind export to the exact *verified* textarea content, not a previous run.
    verifiedText = bundleInput.value;
    exportButton.disabled = false;
    status.textContent = 'PASS — verified locally; no network or chain write performed';
    render(value);
  } catch (error) {
    invalidateExport(`HOLD — ${error.message}`);
    render({ error: error.message });
  } finally {
    busy = false;
    run.disabled = false;
    verify.disabled = false;
  }
}

run.addEventListener('click', () => runAction(async () => {
  const bundle = await buildDemoBundle();
  const verification = await verifyBrowserBundle(bundle);
  bundleInput.value = JSON.stringify(bundle, null, 2);
  return { verification, bundle };
}));

verify.addEventListener('click', () => {
  const submittedText = bundleInput.value;
  return runAction(async () => {
    const result = await verifyBrowserBundle(JSON.parse(submittedText));
    if (bundleInput.value !== submittedText) throw new Error('Bundle changed during verification');
    return result;
  });
});

exportButton.addEventListener('click', () => {
  if (busy || verifiedText === null || bundleInput.value !== verifiedText) {
    invalidateExport('Bundle is not verified or changed. Verify before downloading.');
    return;
  }
  // Exports only the signed *public* proof envelope, never ephemeral verifier
  // private keys, local credentials, or any wallet/provider transaction.
  const portableJson = JSON.stringify(JSON.parse(verifiedText), null, 2) + '\n';
  const objectUrl = URL.createObjectURL(new Blob([portableJson], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = 'workseal-verified-browser-bundle.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  status.textContent = 'Verified JSON download requested locally. No network or chain write performed.';
});

import { buildDemoBundle, verifyBrowserBundle } from './core.mjs';

const run = document.querySelector('#run-demo');
const status = document.querySelector('#status');
const output = document.querySelector('#output');
const bundleInput = document.querySelector('#bundle');
const verify = document.querySelector('#verify-bundle');

function render(value) { output.textContent = JSON.stringify(value, null, 2); }
async function runAction(fn) {
  status.textContent = 'Running locally…';
  try { const value = await fn(); status.textContent = 'PASS — no network or chain write performed'; render(value); }
  catch (error) { status.textContent = `HOLD — ${error.message}`; render({ error: error.message }); }
}
run.addEventListener('click', () => runAction(async () => { const bundle = await buildDemoBundle(); const verification = await verifyBrowserBundle(bundle); bundleInput.value = JSON.stringify(bundle, null, 2); return { verification, bundle }; }));
verify.addEventListener('click', () => runAction(async () => verifyBrowserBundle(JSON.parse(bundleInput.value))));

// MIT. Read the retained FRED example through the original site's ZIP writer.
import { zipWorkspace } from './onboarding.mjs';

const BASE = new URL('./examples/fred-briefing-20261012/', import.meta.url);
const MANIFEST = Object.freeze({"bytes":4512,"sha256":"526415a2fad4811bcaad73177c333368a67685a826a64cac7c082506dd68dd78"});
const MAX_PACKAGE_BYTES = 1024 * 1024;
export const FRED_EXAMPLE = Object.freeze({
  id: 'fred-briefing-20261012',
  filename: 'stellar-forge-economic-briefing-20261012.zip',
  reportHref: new URL("stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/briefing.html", BASE).href,
  guideHref: new URL('START_HERE.md', BASE).href,
  files: 15,
  bytes: 324723
});

function aborted(signal) {
  if (signal.aborted) throw signal.reason || new DOMException('Download cancelled.', 'AbortError');
}
function canonicalPath(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
}
async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
async function readSelected(path, selected, signal) {
  if (!canonicalPath(path) || !Number.isSafeInteger(selected.bytes) || selected.bytes < 0 ||
      selected.bytes > MAX_PACKAGE_BYTES || !/^[a-f0-9]{64}$/.test(selected.sha256))
    throw new Error('The example file selection is invalid.');
  const url = new URL(path, BASE);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname))
    throw new Error('The example file is outside its original directory.');
  const response = await fetch(url, { signal, cache: 'no-store', redirect: 'error', credentials: 'same-origin' });
  if (!response.ok || !response.body || response.url !== url.href) {
    try { await response.body?.cancel(); } catch {}
    throw new Error('The example file could not be opened: ' + path);
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(selected.bytes);
  let offset = 0, finished = false;
  try {
    while (true) {
      aborted(signal);
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      if (!(value instanceof Uint8Array) || offset + value.length > bytes.length)
        throw new Error('The example file length changed: ' + path);
      bytes.set(value, offset); offset += value.length;
    }
    if (offset !== bytes.length || await digest(bytes) !== selected.sha256)
      throw new Error('The example file no longer matches its saved edition: ' + path);
    aborted(signal);
    return bytes;
  } finally {
    if (!finished) { try { await reader.cancel(); } catch {} }
    reader.releaseLock();
  }
}

/** Explicit download only. It reads fixed static assets and sends no merchant input. */
export async function downloadFredExample({ signal, onProgress = () => {} } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason || new DOMException('Download cancelled.', 'AbortError'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('The example download timed out. Retry the same saved edition.')), 60000);
  try {
    aborted(controller.signal);
    if (!crypto.subtle) throw new Error('Open the site through HTTPS or localhost to verify the example download.');
    const rawManifest = await readSelected('package-manifest.json', MANIFEST, controller.signal);
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawManifest));
    if (manifest.schema !== 'stellar-forge.frontdoor-example.v1' || manifest.id !== FRED_EXAMPLE.id ||
        !Array.isArray(manifest.files) || manifest.files.length !== FRED_EXAMPLE.files - 1)
      throw new Error('The saved example manifest changed.');
    const paths = new Set(['package-manifest.json']);
    let total = rawManifest.length;
    for (const file of manifest.files) {
      if (!file || !canonicalPath(file.path) || paths.has(file.path) ||
          !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256))
        throw new Error('The saved example file list is invalid.');
      paths.add(file.path); total += file.bytes;
    }
    if (total !== FRED_EXAMPLE.bytes || total > MAX_PACKAGE_BYTES)
      throw new Error('The saved example exceeds its complete package limit.');
    const files = [{ path: 'package-manifest.json', content: rawManifest }];
    let received = rawManifest.length;
    onProgress({ completedFiles: 1, totalFiles: FRED_EXAMPLE.files, bytes: received, totalBytes: total });
    for (const file of manifest.files) {
      const bytes = await readSelected(file.path, file, controller.signal);
      files.push({ path: file.path, content: bytes }); received += bytes.length;
      onProgress({ completedFiles: files.length, totalFiles: FRED_EXAMPLE.files, bytes: received, totalBytes: total });
    }
    aborted(controller.signal);
    const bytes = zipWorkspace(files);
    aborted(controller.signal);
    return { bytes, filename: FRED_EXAMPLE.filename, files: files.length };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

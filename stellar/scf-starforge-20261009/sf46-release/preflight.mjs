// MIT. Offline SCF SF46 release-source preflight. Never initiates commerce.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const defaultRepoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const pathInside = (root, path) => {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new TypeError('Manifest contains an unsafe source path');
  }
  return full;
};

export function gitBlobSha(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1').update('blob ' + buffer.length + '\0').update(buffer).digest('hex');
}

export async function assessRelease({
  root = defaultRepoRoot, strictPins = false, manifestPath = new URL('./pins.json', import.meta.url)
} = {}) {
  const absoluteRoot = resolve(root);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schema !== 'stellar-forge.release-pins.v1' ||
      !Array.isArray(manifest.sources) || manifest.sources.length < 8) {
    throw new TypeError('Unrecognized or incomplete SF46 pin manifest');
  }
  const report = {
    schema: 'stellar-forge.release-preflight.v1',
    runMode: 'OFFLINE_SOURCE_ONLY',
    node: process.versions.node, repoRoot: absoluteRoot, strictPins,
    sources: [], exports: [], warnings: [], failures: [], acceptance: 'NOT_TESTED',
    unverifiedGates: manifest.gates.filter(x => x.state !== 'MEASURABLE_BY_THIS_PREFLIGHT' &&
      x.state !== 'MEASURABLE_WITH_STRICT_PINS')
  };
  if (Number(process.versions.node.split('.')[0]) < 22) {
    report.failures.push('Node 22 or newer required');
  }
  const pathsSeen = new Set();
  for (const source of manifest.sources) {
    if (typeof source.id !== 'string' || typeof source.path !== 'string' ||
        !Array.isArray(source.exports) || !/^[a-f0-9]{40}$/.test(source.sha) ||
        pathsSeen.has(source.path)) {
      throw new TypeError('Malformed or duplicate SF46 source pin');
    }
    pathsSeen.add(source.path);
    const full = pathInside(absoluteRoot, source.path);
    let actual = null;
    let status = 'MISSING';
    try {
      actual = gitBlobSha(await readFile(full));
      status = actual === source.sha ? 'PIN_MATCH' : 'SOURCE_CHANGED';
    } catch (error) {
      if (error?.code !== 'ENOENT') status = 'READ_ERROR';
    }
    const line = {id: source.id, path: source.path, expectedGitBlob: source.sha,
      actualGitBlob: actual, status};
    report.sources.push(line);
    if (status === 'MISSING' || status === 'READ_ERROR') {
      report.failures.push(source.id + ': ' + status);
    } else if (status === 'SOURCE_CHANGED') {
      const message = source.id + ': changed Git blob; review source against approved contracts';
      (strictPins ? report.failures : report.warnings).push(message);
    }
  }
  // Import exactly the locally installed facade, not a remote service.
  // This exercises actual dependency resolution and actual export contracts.
  try {
    const api = await import(pathToFileURL(pathInside(absoluteRoot,
      'stellar/scf-starforge-20261009/sf46-release/index.mjs')).href);
    for (const source of manifest.sources) {
      for (const name of source.exports) {
        const available = Object.hasOwn(api, name);
        report.exports.push({module: source.id, name, available, type: available ? typeof api[name] : null});
        if (!available) report.failures.push(source.id + ': missing ' + name + ' export');
      }
    }
    // Original pure in-memory constructors: no seller insert, signer, HTTP, RPC or wallet.
    if (typeof api.BazaarCatalog === 'function') {
      const empty = new api.BazaarCatalog().list(new URLSearchParams());
      if (!Array.isArray(empty?.resources) || empty.resources.length !== 0) {
        report.failures.push('Unexpected fresh-catalog contract');
      }
    }
    if (typeof api.McpPaidToolBroker === 'function') {
      const broker = new api.McpPaidToolBroker({
        discoveryUrl: 'http://127.0.0.1:9', allowedResourceOrigins: [],
        approve: () => false, signPayment: null
      });
      if (typeof broker.search !== 'function' || typeof broker.preview !== 'function') {
        report.failures.push('MCP broker API changed');
      }
    }
  } catch (error) {
    report.failures.push('Source facade load/constructor error: ' + String(error?.message ?? error));
  }
  report.status = report.failures.length ? 'FAIL_SOURCE_PREFLIGHT' : 'PASS_SOURCE_CONTRACTS_ONLY';
  report.acceptance = 'Live Stellar testnet receipts, seller consent, spend authorization, pubnet and SCF invitation require separate original evidence';
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(x => x !== '--strict-pins')) {
    process.stderr.write('Usage: node preflight.mjs [--strict-pins]\n');
    process.exitCode = 2;
  } else {
    assessRelease({strictPins: args.includes('--strict-pins')})
      .then(report => {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        if (report.failures.length) process.exitCode = 1;
      })
      .catch(error => {
        process.stderr.write(String(error?.stack ?? error) + '\n');
        process.exitCode = 1;
      });
  }
}

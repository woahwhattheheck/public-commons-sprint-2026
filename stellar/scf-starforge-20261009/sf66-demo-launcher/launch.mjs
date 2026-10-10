// MIT. SCF66: operator entrypoint composing the actual SF60 journal service and SF61 Atlas.
// This module never owns, rewrites, infers, or registers catalog/payment records.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USAGE = `Original SCF SF60 + SF61 single-command operator demo (Node >=22)

Run from public-commons-sprint-2026 repository root:
  node stellar/scf-starforge-20261009/sf66-demo-launcher/launch.mjs \\
    --directory /private/existing-catalog [--atlas-port 0] [--report /private/parity.json]

To intentionally create a fresh EMPTY catalog, add --create-empty and supply a
private empty directory. This option never seeds simulated sellers or payments.
--one-shot captures one original Bazaar page parity report and closes both ports.
Without --one-shot, the browser stays available until Ctrl-C or SIGTERM.
Optional --capture-full FILE --capture-network stellar:testnet --capture-limit 100\nwalks every native local SF60 list page and compares its original SF61 response\nbefore a private, no-clobber raw-response SHA capture is saved. No remote calls.\nNo hosted CI, paid provider calls, wallets, signatures, or outgoing contact.
`;

export function parseOptions(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const valKeys = new Set(['--directory', '--atlas-port', '--report', '--capture-full', '--capture-network', '--capture-limit']);
  const flags = new Set(['--create-empty', '--one-shot']);
  const values = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!(valKeys.has(token) || flags.has(token)) || token in values)
      throw new TypeError('Unknown or repeated option. Use --help.');
    if (valKeys.has(token)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--'))
        throw new TypeError(`Missing value for ${token}`);
      values[token] = argv[++i];
    } else values[token] = true;
  }
  if (typeof values['--directory'] !== 'string' || !values['--directory'].trim())
    throw new TypeError('--directory is required. Never silently create an empty catalog.');
  const rawPort = values['--atlas-port'] ?? '0';
  if (!/^(0|[1-9]\d{0,4})$/.test(rawPort) || Number(rawPort) > 65535)
    throw new RangeError('--atlas-port must be an integer from 0 to 65535');
  if (values['--report'] && !String(values['--report']).trim())
    throw new TypeError('--report requires a writable file path');
  if ((values['--capture-network'] || values['--capture-limit']) && !values['--capture-full'])
    throw new TypeError('Capture filters require --capture-full.');
  const captureNetwork = values['--capture-network'] ?? null;
  if (captureNetwork && !['stellar:testnet', 'stellar:pubnet'].includes(captureNetwork))
    throw new RangeError('Capture network must be stellar:testnet or stellar:pubnet');
  const captureLimit = values['--capture-limit'] ?? '100';
  if (!/^[1-9][0-9]?$|^100$/.test(captureLimit))
    throw new RangeError('Capture page limit must be 1..100');
  return {
    ...(values['--capture-full'] ? {
      fullCapture: resolve(values['--capture-full']), captureNetwork,
      captureLimit: Number(captureLimit),
    } : {}),
    directory: resolve(values['--directory']),
    createEmpty: Boolean(values['--create-empty']),
    atlasPort: Number(rawPort),
    report: values['--report'] ? resolve(values['--report']) : null,
    oneShot: Boolean(values['--one-shot']),
  };
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function jsonGet(url) {
  const response = await fetch(url, {
    method: 'GET', redirect: 'error',
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Original local ${new URL(url).pathname}: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 8 * 1024 * 1024)
    throw new Error('Source page too large for operator parity sample');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Source page too large for operator parity sample');
  return JSON.parse(bytes.toString('utf8'));
}

/** Actual SF60 -> actual SF61 source parity, ONE observed page only. */
export async function observeParity({ backendOrigin, atlasUrl }) {
  const query = 'limit=25&offset=0';
  const [health, source, backend, atlas] = await Promise.all([
    jsonGet(`${backendOrigin}/healthz`),
    jsonGet(`${atlasUrl}/api/source`),
    jsonGet(`${backendOrigin}/discovery/resources?${query}`),
    jsonGet(`${atlasUrl}/api/discovery?view=list&${query}`),
  ]);
  if (health.status !== 'ready' || !Array.isArray(backend.resources) ||
      !Array.isArray(atlas.resources) ||
      source.mode !== 'ORIGINAL_SF60_DURABLE_CATALOG' ||
      source.paidRequestsEnabled !== false || atlas.paidRequestsEnabled !== false ||
      atlas.mode !== 'ORIGINAL_SF60_DURABLE_CATALOG') {
    throw new Error('Original source identity, native resources, or read-only gate changed');
  }
  const nativePagination = backend.pagination ?? {};
  const observedPagination = atlas.pagination ?? {};
  const rowsMatch = JSON.stringify(backend.resources) === JSON.stringify(atlas.resources);
  const paginationMatches = JSON.stringify(nativePagination) === JSON.stringify(observedPagination);
  const parity = rowsMatch && paginationMatches;
  if (!parity) throw new Error('Original SF60/SF61 resource or pagination parity mismatch');
  return {
    schema: 'scf66-original-local-parity-v1',
    observedAt: new Date().toISOString(),
    originalModules: ['SF60/openDiscovery', 'SF61/startExplorer'],
    sourceMode: source.mode,
    readOnly: true,
    sample: { endpoint: '/discovery/resources', query, pageOnly: true,
      observedRows: backend.resources.length, nativeTotal: nativePagination.total ?? null,
      resourcesSha256: sha256(backend.resources),
      paginationSha256: sha256(nativePagination),
      byteIdenticalJsonStructures: parity },
    durable: { journalHead: health.journalHead, committedOperations: health.committedOperations,
      activeResources: health.activeResources },
    noPaymentOrLedgerProof: true,
  };
}

/** Compose original modules, cleanly closing the explorer before the original lock-owner. */
export async function openDemo(options, implementation = null) {
  let backend = null;
  let viewer = null;
  try {
    const deps = implementation ?? {
      ...await import('../sf60-durable-catalog-transaction/service.mjs'),
      ...await import('../sf61-bazaar-explorer/server.mjs'),
    };
    backend = await deps.openDiscovery({ directory: options.directory,
      port: 0, createEmpty: options.createEmpty });
    viewer = await deps.startExplorer({ localUpstream: backend.origin, port: options.atlasPort });
    const proof = await observeParity({ backendOrigin: backend.origin, atlasUrl: viewer.url });
    let fullCapture = null;
    if (options.fullCapture) {
      const { captureFullCatalog } = await import('./capture.mjs');
      fullCapture = await captureFullCatalog({ backendOrigin: backend.origin,
        atlasUrl: viewer.url, directory: options.directory, destination: options.fullCapture,
        network: options.captureNetwork ?? null, limit: options.captureLimit ?? 100 });
    }
    if (options.report) {
      // Never overwrite or silently expose operator data; only page digests,
      // counts and journal head are recorded, never raw seller rows or keys.
      await writeFile(options.report, JSON.stringify(proof, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 });
    }
    let closing;
    return {
      atlasUrl: viewer.url, sourceOrigin: backend.origin, proof, fullCapture,
      close() {
        if (!closing) closing = (async () => {
          try { await viewer.close(); } finally { await backend.close(); }
        })();
        return closing;
      },
    };
  } catch (error) {
    try { if (viewer) await viewer.close(); } finally { if (backend) await backend.close(); }
    throw error;
  }
}

async function cli() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return console.log(USAGE);
  const session = await openDemo(options);
  console.log(JSON.stringify({ status: 'READY', atlasUrl: session.atlasUrl,
    originalDurableSource: session.sourceOrigin, parity: session.proof,
    report: options.report, fullCapture: session.fullCapture,
    retainedJournalOwner: 'ORIGINAL_SF60' }, null, 2));
  if (options.oneShot) return session.close();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    session.close().catch(error => { console.error(error); process.exitCode = 1; });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  cli().catch(error => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
}
// MIT. Launch the existing SF60 durable service and SF61 Atlas together.
// This file delegates to the ORIGINAL implementations. It never ingests listings,
// creates a checkout path, signs, verifies or settles a payment.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDiscovery } from '../sf60-durable-catalog-transaction/service.mjs';
import { startExplorer } from '../sf61-bazaar-explorer/server.mjs';

const USAGE = `SF66 original-source Bazaar Atlas launcher (Node 22+)
  node run.mjs --directory EXISTING_SF60_JOURNAL [--network stellar:testnet] [--once] [--snapshot FILE]
  node run.mjs --local-upstream http://127.0.0.1:8787 [--network stellar:testnet] [--once] [--snapshot FILE]
  node run.mjs --upstream https://PUBLIC_FACILITATOR [--network stellar:testnet] [--once] [--snapshot FILE]

Options: --port 0..65535 (Atlas loopback port, 0 = choose available); --limit 1..100 (default 100).
One-shot mode performs a real native GET through the original viewer and closes both listeners.
An existing SF60 owner MUST use --local-upstream instead of --directory to avoid a second writer lock.`;

function parseArgs(args) {
  const valueArgs = new Set(['--directory', '--local-upstream', '--upstream', '--network', '--port', '--limit', '--snapshot']);
  const switches = new Set(['--once', '--help']);
  const values = new Map();
  const flags = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (switches.has(key)) {
      if (flags.has(key)) throw new Error('Repeated option: ' + key);
      flags.add(key);
    } else if (valueArgs.has(key)) {
      if (values.has(key) || !args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error('Missing or duplicate value: ' + key);
      values.set(key, args[++i]);
    } else throw new Error('Unknown option: ' + key);
  }
  if (flags.has('--help')) {
    if (flags.size !== 1 || values.size) throw new Error('--help must be used alone');
    return { help: true };
  }
  const sources = ['--directory', '--local-upstream', '--upstream'].filter(name => values.has(name));
  if (sources.length !== 1) throw new Error('Select exactly one original source: --directory, --local-upstream, or --upstream');
  const network = values.get('--network') ?? 'stellar:testnet';
  if (!['stellar:testnet', 'stellar:pubnet'].includes(network)) throw new Error('Invalid explicit Stellar network');
  const portArg = values.get('--port') ?? '0';
  if (!/^\d{1,5}$/.test(portArg) || Number(portArg) > 65535) throw new Error('Invalid port');
  const limitArg = values.get('--limit') ?? '100';
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(limitArg)) throw new Error('Invalid page limit');
  return {
    directory: values.get('--directory'),
    localUpstream: values.get('--local-upstream'),
    upstream: values.get('--upstream'),
    snapshot: values.get('--snapshot'),
    once: flags.has('--once'),
    network, port: Number(portArg), limit: Number(limitArg),
  };
}

async function jsonGet(url) {
  const response = await fetch(url, {
    method: 'GET', redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Original gateway GET returned HTTP ${response.status}: ${body.slice(0, 180)}`);
  if (Buffer.byteLength(body) > 20 * 1024 * 1024) throw new Error('Original viewer response exceeds 20 MiB');
  return { body, value: JSON.parse(body) };
}

export async function run(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  if (config.help) { console.log(USAGE); return; }
  let owner;
  let viewer;
  let closing;
  const close = () => {
    if (!closing) closing = (async () => {
      try { if (viewer) await viewer.close(); }
      finally { if (owner) await owner.close(); }
    })();
    return closing;
  };
  try {
    // SF60 alone owns the existing journal/lock; SF61 only consumes its native GETs.
    if (config.directory) owner = await openDiscovery({ directory: config.directory, port: 0 });
    viewer = await startExplorer({
      fixture: false,
      localUpstream: owner?.origin ?? config.localUpstream ?? null,
      upstream: config.upstream ?? null,
      port: config.port,
    });
    const source = (await jsonGet(viewer.url + '/api/source')).value;
    const query = new URLSearchParams({ view: 'list', network: config.network,
      limit: String(config.limit), offset: '0' });
    const request = viewer.url + '/api/discovery?' + query;
    const { body, value: page } = await jsonGet(request);
    if (!Array.isArray(page.resources) || page.view !== 'list' || page.readOnly !== true)
      throw new Error('Original Atlas response contract failed');
    // These are observed native page fields, NOT proof of complete-catalog coverage.
    const summary = {
      status: 'ORIGINAL_SOURCE_ATLAS_READY',
      sourceMode: source.mode,
      atlas: viewer.url,
      provider: source.origin,
      network: config.network,
      observedAt: page.observedAt,
      observedPageRows: page.resources.length,
      providerReportedTotal: page.pagination?.total ?? null,
      nativePagination: page.pagination ?? {},
      pageSha256: createHash('sha256').update(body, 'utf8').digest('hex'),
      readOnly: true,
      paymentEnabled: false,
      captureCoverage: 'ONE_NATIVE_PAGE_ONLY',
    };
    if (config.snapshot) {
      // Save the exact JSON *returned by the viewer*, not a claim of raw-provider
      // byte custody. Private local file mode and exclusive creation by default.
      const output = {
        schema: 'sf66-viewer-observation-v1',
        ...summary,
        originalViewerRequest: '/api/discovery?' + query,
        viewerJsonBytes: Buffer.byteLength(body),
        page,
      };
      await writeFile(config.snapshot, JSON.stringify(output, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 });
      summary.snapshot = resolve(config.snapshot);
    }
    console.log(JSON.stringify(summary, null, 2));
    if (config.once) return;
    console.log('Open Atlas on this same machine. Press Ctrl-C to stop the viewer and release any SF60 journal lock.');
    await new Promise((resolveSignal) => {
      const stop = () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        resolveSignal();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch(error => { console.error('SF66: ' + (error?.message ?? error)); process.exitCode = 1; });
}

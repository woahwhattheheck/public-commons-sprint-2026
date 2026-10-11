#!/usr/bin/env node
// MIT. Merchant configuration releases for the original SF82/SF30 service.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { open } from 'node:fs/promises';
import { initReleaseStore, stageRelease, readReleaseState, listReleases, inspectRelease,
  compareReleases, activateRelease, rollbackRelease, releaseStatus, runActiveRelease } from './releases.mjs';
import { releaseCacheStatus, invalidateReleaseCache } from './release-cache.mjs';
import { readReleaseCatalogConfig, readReleaseCatalogReview, releaseCatalogStatus,
  reviewReleaseCatalog, applyReleaseCatalog } from './release-catalog.mjs';
import { createReleaseDiscoverySetup, inspectReleaseDiscoverySetup, openReleaseDiscoverySetup } from './release-discovery-setup.mjs';

const USAGE = `Seller releases — Node 22+, original SF61 compiler and SF82 launcher

  init     --store NEW_DIRECTORY
  stage    --store DIR --id RELEASE --spec OPENAPI --config SELECTIONS --bindings BINDINGS
           [--label TEXT] [--port 8423] [--handlers TRUSTED_ESM | --upstreams BINDINGS_JSON]
           [--allow-loopback-upstream]
           [--facilitator HTTPS_URL] [--allow-local-facilitator]
  stage    --store DIR --id RELEASE --workspace SAVED_API_PACKAGE [runtime options above]
  stage    --store DIR --id RELEASE --python PYTHON_MERCHANT.json [--python-root SOURCE_DIR]
           [--label TEXT] [--port 8423] [--facilitator HTTPS_URL] [--allow-local-facilitator]
  stage    --store DIR --id RELEASE --duckdb-package PREPARED_DIRECTORY [--duckdb-python EXECUTABLE]
           [--label TEXT] [--port 8423] [--facilitator HTTPS_URL] [--allow-local-facilitator]
  list     --store DIR
  inspect  --store DIR --id RELEASE
  diff     --store DIR --to RELEASE [--from RELEASE]
  activate --store DIR --id RELEASE --expect GENERATION [--reason TEXT]
  rollback --store DIR --expect GENERATION [--to RELEASE] [--reason TEXT]
  status   --store DIR
  cache-status --store DIR
  cache-invalidate --store DIR --instance INSTANCE [--route ROUTE_ID | --all]
  catalog-init --store DIR --id RELEASE --setup NEW_DIRECTORY --seller SELLER_ID
               [--source-url HTTPS_OFFER_EXPORT]
  catalog-inspect --store DIR --setup DIRECTORY
  catalog-run --store DIR --setup DIRECTORY [--port 0] [--workspace-port 0] [--no-workspace]
  catalog-status --store DIR --catalog CONFIG_JSON --id RELEASE
  catalog-review --store DIR --catalog CONFIG_JSON --id RELEASE --out NEW_REVIEW_JSON
                 [--withdraw ROUTE_ID --reason TEXT]
  catalog-apply --store DIR --catalog CONFIG_JSON --review REVIEW_JSON
  run      --store DIR [--expect GENERATION]
  console  --store DIR [--port 8425] [--catalog CONFIG_JSON]

Run with: node release-cli.mjs COMMAND OPTIONS
Stage compiles immutable original source and response snapshots. No server starts.
Activate selects the next run. A running seller keeps its existing release until stopped.
Run starts the original foreground seller; Ctrl-C stops this process's seller.
Console opens a private loopback interface to compare, activate, start, stop and roll back.
Catalog-init creates a private identity, source-derived seller policy and existing release connection.
Catalog-run owns the original catalog writer and optional original browser until Ctrl-C.
Application entry modules are pinned; their external dependencies remain operator-managed.`;
const COMMANDS = {
  init: ['store'], stage: ['store', 'id', 'workspace', 'python', 'python-root', 'duckdb-package', 'duckdb-python', 'spec', 'config', 'bindings', 'label', 'port', 'handlers', 'upstreams', 'facilitator', 'allow-local-facilitator', 'allow-loopback-upstream'],
  list: ['store'], inspect: ['store', 'id'], diff: ['store', 'from', 'to'],
  activate: ['store', 'id', 'expect', 'reason'], rollback: ['store', 'expect', 'to', 'reason'],
  status: ['store'], run: ['store', 'expect'], console: ['store', 'port', 'catalog'],
  'cache-status': ['store'], 'cache-invalidate': ['store', 'instance', 'route', 'all'],
  'catalog-init': ['store', 'id', 'setup', 'seller', 'source-url'],
  'catalog-inspect': ['store', 'setup'],
  'catalog-run': ['store', 'setup', 'port', 'workspace-port', 'no-workspace'],
  'catalog-status': ['store', 'catalog', 'id'],
  'catalog-review': ['store', 'catalog', 'id', 'out', 'withdraw', 'reason'],
  'catalog-apply': ['store', 'catalog', 'review'],
};
function parse(args) {
  if (!args.length || args.includes('--help')) return null;
  const [command, ...rest] = args, allowed = COMMANDS[command];
  if (!allowed) throw new Error('Unknown command.\n' + USAGE);
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : '';
    if (!allowed.includes(name) || Object.hasOwn(options, name)) throw new Error('Unknown or duplicate option: ' + rest[i]);
    if (['allow-local-facilitator', 'allow-loopback-upstream', 'all', 'no-workspace'].includes(name)) { options[name] = true; continue; }
    if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Missing value for ' + rest[i]);
    options[name] = rest[++i];
  }
  if (!options.store) throw new Error('Supply --store DIRECTORY.');
  for (const name of ['port', 'workspace-port', 'expect']) {
    if (options[name] !== undefined) {
      if (!/^\d+$/.test(options[name]) || !Number.isSafeInteger(Number(options[name]))) throw new Error('--' + name + ' must be a nonnegative integer.');
      options[name] = Number(options[name]);
    }
  }
  return { command, options };
}
const print = result => process.stdout.write(JSON.stringify(result, null, 2) + '\n');
export async function main(args = process.argv.slice(2)) {
  const parsed = parse(args);
  if (!parsed) { process.stdout.write(USAGE + '\n'); return null; }
  const { command, options: o } = parsed, root = resolve(o.store);
  let result;
  switch (command) {
    case 'init': result = await initReleaseStore(root); break;
    case 'stage': {
      for (const key of o.workspace || o.python || o['duckdb-package'] ? ['id'] : ['id', 'spec', 'config', 'bindings'])
        if (!o[key]) throw new Error('Stage requires --' + key);
      const runtime = {};
      for (const key of ['port', 'handlers', 'facilitator']) if (o[key] !== undefined) runtime[key] = o[key];
      if (o['allow-local-facilitator']) runtime.allowLocalFacilitator = true;
      if (o['allow-loopback-upstream']) runtime.allowLoopbackUpstream = true;
      result = await stageRelease(root, { id: o.id, label: o.label, workspace: o.workspace, spec: o.spec, config: o.config, bindings: o.bindings,
        upstreams: o.upstreams, python: o.python, pythonRoot: o['python-root'],
        duckdbPackage: o['duckdb-package'], duckdbPython: o['duckdb-python'], runtime }); break;
    }
    case 'list': result = { state: await readReleaseState(root), ...await listReleases(root) }; break;
    case 'inspect': result = await inspectRelease(root, o.id); break;
    case 'diff': {
      const state = await readReleaseState(root);
      result = { generation: state.generation, ...await compareReleases(root, o.from ?? state.active, o.to) }; break;
    }
    case 'activate': result = await activateRelease(root, o.id, { expectedGeneration: o.expect, reason: o.reason }); break;
    case 'rollback': result = await rollbackRelease(root, { to: o.to, expectedGeneration: o.expect, reason: o.reason }); break;
    case 'status': result = await releaseStatus(root); break;
    case 'cache-status': result = await releaseCacheStatus(root); break;
    case 'cache-invalidate': {
      if (!o.instance || Boolean(o.route) === Boolean(o.all)) throw new Error('Supply --instance and exactly one of --route ROUTE_ID or --all.');
      result = await invalidateReleaseCache(root, { instanceId: o.instance, routeId: o.route }); break;
    }
    case 'catalog-init': {
      if (!o.setup || !o.id || !o.seller) throw new Error('Supply --setup NEW_DIRECTORY, --id RELEASE and --seller SELLER_ID.');
      result = await createReleaseDiscoverySetup(root, { directory: o.setup, releaseId: o.id,
        sellerId: o.seller, sourceURL: o['source-url'] }); break;
    }
    case 'catalog-inspect': {
      if (!o.setup) throw new Error('Supply --setup DIRECTORY.');
      result = await inspectReleaseDiscoverySetup(root, { directory: o.setup }); break;
    }
    case 'catalog-run': {
      if (!o.setup) throw new Error('Supply --setup DIRECTORY.');
      const session = await openReleaseDiscoverySetup(root, { directory: o.setup, port: o.port ?? 0,
        workspacePort: o['workspace-port'] ?? 0, workspace: !o['no-workspace'] });
      const { closed, close, ...view } = session;
      print({ ...view, stop: 'Ctrl-C stops this catalog workspace and its owned writer.' });
      let stopping = false;
      const stop = () => {
        if (stopping) return; stopping = true;
        close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
      };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { await closed; }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      return session;
    }
    case 'catalog-status':
    case 'catalog-review':
    case 'catalog-apply': {
      if (!o.catalog) throw new Error('Supply --catalog CONFIG_JSON.');
      const config = await readReleaseCatalogConfig(o.catalog);
      if (command === 'catalog-apply') {
        if (!o.review) throw new Error('Supply --review REVIEW_JSON.');
        result = await applyReleaseCatalog(root, { config, review: await readReleaseCatalogReview(o.review) });
      } else {
        if (!o.id) throw new Error('Supply --id RELEASE.');
        if (command === 'catalog-status') result = await releaseCatalogStatus(root, { config, releaseId: o.id });
        else {
          if (!o.out) throw new Error('Supply --out NEW_REVIEW_JSON.');
          result = await reviewReleaseCatalog(root, { config, releaseId: o.id,
            action: o.withdraw ? 'withdraw' : 'publish', routeId: o.withdraw, reason: o.reason });
          const file = await open(resolve(o.out), 'wx', 0o600);
          try { await file.writeFile(JSON.stringify(result, null, 2) + '\n'); await file.sync(); }
          finally { await file.close(); }
        }
      }
      break;
    }
    case 'run': {
      const session = await runActiveRelease(root, { expectedGeneration: o.expect });
      print({ runningRelease: session.release.id, listener: session.url, mode: session.mode,
        instanceId: session.observation.instanceId, stop: 'Ctrl-C' });
      let closing = false;
      const stop = () => { if (!closing) { closing = true; session.close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }); } };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { await session.completion; }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      return session;
    }
    case 'console': {
      const { startReleaseConsole } = await import('./release-console.mjs');
      const session = await startReleaseConsole(root, { port: o.port ?? 8425,
        ...(o.catalog ? { catalogConfig: await readReleaseCatalogConfig(o.catalog) } : {}) });
      print({ operatorConsole: session.operatorUrl, store: root, stop: 'Ctrl-C stops this console and its own seller.' });
      let stopping = false;
      const stop = () => {
        if (stopping) return; stopping = true;
        session.close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
      };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      await session.closed;
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      return session;
    }
  }
  print(result); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'RELEASE_ERROR', message: error.message,
    ...(error.reviewId ? { reviewId: error.reviewId } : {}),
    ...(typeof error.commandSent === 'boolean' ? { commandSent: error.commandSent } : {}) }) + '\n'); process.exitCode = 1; });

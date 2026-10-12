// MIT. Source Tables in the maintained Applications lifecycle.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import { readBrowserAssets } from '../../stellar/scf-starforge-20261009/distribution/browser-assets.mjs';
import {
  APPLICATION_PROVIDER_SCHEMA, applicationPrivateUrl, observeApplicationStartup,
} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';

const ROOT = 'stellar-forge/developer-site/';
const STARTUP = 'stellar-forge.source-table-listener.v1';
const ROUTES = ['/source-tables.html', '/source-tables.css', '/source-tables.mjs',
  '/source-table-workspace.mjs', '/onboarding.mjs', '/source-table-guide.md'];
const need = (value, message) => { if (!value) throw new Error(message); };

export async function prepareSourceTablesApplication(settings, { inputPath, runtimeDirectory }) {
  const runtime = await inspectMerchantRuntime(resolve(runtimeDirectory), { load: false, source: false });
  const manifestPath = join(runtime.sourceRoot, ROOT, 'browser-assets.json');
  const assets = await readBrowserAssets(pathToFileURL(manifestPath));
  const paths = new Set([manifestPath, join(runtime.sourceRoot, ROOT, 'serve.mjs'),
    join(runtime.sourceRoot, ROOT, 'dist/source-table-cli.mjs'),
    join(runtime.sourceRoot, ROOT, 'dist/source-table-workspace.d.mts')]);
  for (const route of ROUTES) {
    const asset = assets.get(route);
    need(asset, 'The installed Source Tables application is missing its declared asset: ' + route);
    paths.add(fileURLToPath(asset.url));
  }
  const inputs = [];
  for (const path of paths) inputs.push(await inputPath(path, 'file'));
  return { args: ['serve'], inputs, createDirectories: [] };
}

export async function sourceTablesStartup(request, text) {
  if (request.command !== 'source-tables' || !Array.isArray(request.args) ||
      request.args[0] !== 'serve' || typeof text !== 'string' || text.length > 16384 ||
      !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let ready; try { ready = JSON.parse(text); } catch { return null; }
  if (ready.schema !== STARTUP) return null;
  const args = request.args.slice(1);
  need(args.length === 0 || args.length === 2 && args[0] === '--port' &&
    /^(0|[1-9][0-9]{0,4})$/.test(args[1]) && Number(args[1]) <= 65535,
    'The saved Source Tables listener arguments changed.');
  const expectedPort = args.length ? Number(args[1]) : 8787;
  const address = applicationPrivateUrl(ready.url);
  need(address, 'The original Source Tables listener did not return a private local URL.');
  const url = new URL(address);
  need(url.hostname === '127.0.0.1' && url.pathname === '/source-tables.html' &&
    !url.search && !url.hash && Number.isInteger(ready.port) && ready.port > 0 &&
    Number(url.port || 80) === ready.port && (!expectedPort || ready.port === expectedPort) &&
    Number.isInteger(ready.assets) && ready.assets >= ROUTES.length,
    'The announced Source Tables listener differs from the saved application.');
  const expected = await readFile(new URL('./dist/source-tables.html', import.meta.url));
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  need(response.ok && /^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
    'The original Source Tables page did not open.');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    need(bytes <= expected.length, 'The Source Tables listener returned different application bytes.');
    chunks.push(chunk);
  }
  need(Buffer.concat(chunks).equals(expected),
    'The live Source Tables page differs from its installed application source.');
  return { url: url.href, original: ready };
}

export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'source-tables', order: 395,
  catalog({ common }) {
    return [{
      id: 'source-tables', command: 'source-tables', title: 'Source Tables',
      terminal: false, requiredSource: ROOT + 'dist/source-table-cli.mjs',
      description: 'Map complete CSV or TSV sources, retain editions, compare changes and export a native merchant workspace. Choose a fixed local port such as 8787 to reopen browser saves at the same address.',
      fields: common,
    }];
  },
  prepare(type, settings, context) { return prepareSourceTablesApplication(settings, context); },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'source-tables' && request.args?.[0] === 'serve';
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text =>
      text.startsWith('{"schema":"' + STARTUP + '",') ? () => sourceTablesStartup(request, text) : null);
  },
};

#!/usr/bin/env node
// MIT. Serve the original Starforge setup pages from their declared source assets.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBrowserAssets } from '../../stellar/scf-starforge-20261009/distribution/browser-assets.mjs';

const manifest = new URL('./browser-assets.json', import.meta.url);
const help = [
  'CoCart customer setup',
  '',
  'starforge cocart-setup [serve] [--port PORT]',
  '',
  'Open the printed local URL to import an original saved Woo product profile',
  'or a complete CoCart receiving JSON and download its customer setup package.',
  'The listener serves only the declared original setup assets.',
  'Files selected on the page are processed in your browser.',
  '',
  'Default: http://127.0.0.1:8787/cocart.html',
  'Keep the same host and port to reopen browser drafts. --port 0 selects a free port.',
  'Download a draft before moving to another browser or local origin.',
  'Ctrl+C closes this listener; the managed CoCart application has its own lifecycle.',
].join('\n');

function selectedPort(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535)
    return value;
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= 65535)
    return Number(value);
  throw new TypeError('Choose an integer local port from 0 to 65535.');
}

export async function startSetupServer({ port = 8787, entry = '/cocart.html' } = {}) {
  port = selectedPort(port);
  const assets = await readBrowserAssets(manifest);
  if (typeof entry !== 'string' || !entry.startsWith('/') || !assets.has('/') ||
      !assets.has(entry) || !assets.get(entry).type.startsWith('text/html'))
    throw new TypeError('Choose an original HTML entry declared by the setup asset manifest.');
  let actualPort;
  const server = createServer(async (request, response) => {
    const base = {
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    };
    const reply = (status, message, extra = {}) => {
      const bytes = Buffer.from(message + '\n');
      response.writeHead(status, { ...base, 'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': bytes.length, ...extra });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    };
    if (!['127.0.0.1:' + actualPort, 'localhost:' + actualPort].includes(request.headers.host ?? ''))
      return reply(421, 'Use the original local setup address printed by this listener.');
    if (!['GET', 'HEAD'].includes(request.method))
      return reply(405, 'The setup listener serves original source files.', { Allow: 'GET, HEAD' });
    let path;
    try {
      const url = new URL(request.url, 'http://127.0.0.1:' + actualPort);
      if (url.origin !== 'http://127.0.0.1:' + actualPort) return reply(400, 'Use a local asset path.');
      path = url.pathname;
    } catch { return reply(400, 'Invalid local asset path.'); }
    const asset = assets.get(path);
    if (!asset) return reply(404, 'This path is outside the declared setup source.');
    try {
      const bytes = await readFile(asset.url);
      response.writeHead(200, { ...base, 'Content-Type': asset.type, 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (response.headersSent) { response.destroy(error); return; }
      reply(error.code === 'ENOENT' ? 404 : 500,
        error.code === 'ENOENT' ? 'The selected source asset is missing. Reopen the complete installed package.'
          : 'The selected source asset could not be read.');
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      actualPort = server.address().port;
      accept();
    });
  });
  let stopping;
  const stop = () => stopping ??= new Promise((accept, reject) => {
    server.close(error => error ? reject(error) : accept());
    server.closeIdleConnections?.();
  });
  return {
    server, stop, url: 'http://127.0.0.1:' + actualPort + entry,
    port: actualPort, entry, assets: assets.size,
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) {
    console.log(help); return;
  }
  const args = [...argv];
  if (args[0] === 'serve') args.shift();
  let port = 8787;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--port')
      throw new TypeError('Use starforge cocart-setup [serve] [--port PORT].');
    port = selectedPort(args[1]);
  }
  const listener = await startSetupServer({ port });
  const close = () => listener.stop().catch(error => {
    console.error(JSON.stringify({ error: error.code ?? error.name, message: error.message }));
    process.exitCode = 1;
  });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  listener.server.once('close', () => {
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
  });
  console.log(JSON.stringify({
    schema: 'stellar-forge.cocart-setup-listener.v1',
    url: listener.url, host: '127.0.0.1', port: listener.port,
    source: 'stellar-forge/developer-site/dist/cocart.html',
    assetManifest: 'stellar-forge/developer-site/browser-assets.json',
    assets: listener.assets,
  }));
  return listener;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(JSON.stringify({ error: error.code ?? error.name, message: error.message }));
    process.exitCode = 1;
  });

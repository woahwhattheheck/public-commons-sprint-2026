#!/usr/bin/env node
// MIT. Open the reviewed SCF application through the original static source server.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSetupServer } from './serve.mjs';

const help = [
  'Stellar Discovery Trust Layer — SCF application',
  '',
  'starforge grant-application [serve] [--port PORT]',
  '',
  'Read the complete reviewed application, product and financing companion,',
  'six-package budget, source index and retained economic briefing.',
  'Prepare the same nine answers and retain complete working drafts at',
  '/grant-submission.html on this same source-selected reader.',
  'The source-selected grant-reviewer package contains these original files.',
  'The published film and editable presentation open at their original release URLs.',
  '',
  'Default: http://127.0.0.1:8787/grant.html',
  '--port 0 selects an available local port. Open the exact URL printed at startup.',
  'If a cocart-setup listener is already open, use /grant.html at that same origin.',
  'Ctrl+C closes this reader. Grant purchase workbenches retain their own lifecycle.',
].join('\n');

export function startGrantApplication({ port = 8787 } = {}) {
  return startSetupServer({ port, entry: '/grant.html' });
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
      throw new TypeError('Use starforge grant-application [serve] [--port PORT].');
    port = args[1];
  }
  const listener = await startGrantApplication({ port });
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
    schema: 'stellar-forge.grant-application-listener.v1',
    url: listener.url, host: '127.0.0.1', port: listener.port,
    source: 'stellar-forge/developer-site/dist/grant.html',
    assetManifest: 'stellar-forge/developer-site/browser-assets.json',
    submissionWorkspace: {
      url: new URL('/grant-submission.html', listener.url).href,
      draftSchema: 'stellar-forge.grant-submission-draft.v1',
    },
    downloads: [
      '/grant-data/application.md', '/grant-data/product-and-finance.md',
      '/grant-data/budget.csv', '/grant-data/source-index.json',
    ],
    assets: listener.assets,
  }));
  return listener;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(JSON.stringify({ error: error.code ?? error.name, message: error.message }));
    process.exitCode = 1;
  });

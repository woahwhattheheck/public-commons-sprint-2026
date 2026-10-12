#!/usr/bin/env node
// MIT. Local reference and credential inspection; no provider or seller request.
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUpstreamTls, upstreamTlsReferences } from './config.mjs';
import { loadUpstreamTls, UpstreamTlsError } from './profile.mjs';

const USAGE = 'Usage: node upstream-tls/cli.mjs check|inspect --upstreams BINDINGS.json [--binding NAME]\n' +
  'check reviews original TLS environment references; inspect loads and verifies the selected local material.';

export async function main(args = process.argv.slice(2), { env = process.env } = {}) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const [command, ...rest] = args, options = new Map();
  if (!['check', 'inspect'].includes(command)) throw new TypeError(USAGE);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!['--upstreams', '--binding'].includes(key) || options.has(key) || !value || value.startsWith('--'))
      throw new TypeError(USAGE);
    options.set(key, value);
  }
  if (!options.has('--upstreams')) throw new TypeError(USAGE);
  const path = resolve(options.get('--upstreams')), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new TypeError('Use an original upstream JSON file up to 1 MiB');
  const bytes = await readFile(path);
  if (bytes.length > 1048576) throw new TypeError('Upstream JSON exceeds 1 MiB');
  const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (config?.schema !== 'stellar-forge.seller-upstreams.v1' || !config.bindings ||
      typeof config.bindings !== 'object' || Array.isArray(config.bindings)) throw new TypeError('Expected original seller-upstreams.v1');
  const selected = options.get('--binding');
  if (selected !== undefined && !Object.hasOwn(config.bindings, selected)) throw new TypeError('Choose an existing binding');
  const rows = [];
  for (const [name, binding] of Object.entries(config.bindings)) {
    if (selected !== undefined && name !== selected) continue;
    const profile = compileUpstreamTls(binding.tls, { origin: binding.origin });
    if (profile === undefined) { if (selected !== undefined) rows.push({ binding: name, state: 'NODE_DEFAULT' }); continue; }
    if (command === 'check') rows.push({ binding: name, state: 'REFERENCES_VALID', profile, references: upstreamTlsReferences(profile) });
    else {
      try { rows.push({ binding: name, ...loadUpstreamTls(profile, { env, origin: binding.origin }).snapshot() }); }
      catch (error) {
        if (!(error instanceof UpstreamTlsError)) throw error;
        rows.push({ binding: name, state: 'UNAVAILABLE', error: error.code,
          ...(error.reference ? { reference: error.reference } : {}) });
      }
    }
  }
  const result = { schema: 'stellar-forge.upstream-tls-inspection.v1', command,
    inspectedAt: new Date().toISOString(), bindings: rows };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (rows.some(row => row.state === 'UNAVAILABLE')) process.exitCode = 2;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write((error instanceof TypeError ? error.message : 'UPSTREAM_TLS_INSPECTION_FAILED') + '\n'); process.exitCode = 1; });
}

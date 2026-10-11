#!/usr/bin/env node
// MIT. Inspect the selected original supplier account ledger without provider IO.
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSupplierAccounts } from './config.mjs';
import { createSupplierQuotaRegistry } from './application.mjs';

const USAGE = 'Usage: node supplier-quota/cli.mjs check|inspect --upstreams BINDINGS.json [--account ALIAS]\n' +
  'check validates local supplier declarations; inspect reads their original durable quota.\n' +
  'Both use the original seller-upstreams.v1 file. No credential values or provider request are needed.';

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE + '\n'); return null; }
  const [command, ...rest] = args;
  if (!['check', 'inspect'].includes(command)) throw new TypeError(USAGE);
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!['--upstreams', '--account'].includes(key) || options.has(key) || !value || value.startsWith('--'))
      throw new TypeError(USAGE);
    options.set(key, value);
  }
  if (!options.has('--upstreams')) throw new TypeError(USAGE);
  const path = resolve(options.get('--upstreams'));
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw new TypeError('Original upstream JSON file up to 1 MiB required');
  const bytes = await readFile(path);
  if (bytes.length > 1048576) throw new TypeError('Upstream JSON exceeds 1 MiB');
  const config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (config?.schema !== 'stellar-forge.seller-upstreams.v1') throw new TypeError('Expected original seller-upstreams.v1');
  const accounts = compileSupplierAccounts(config.supplierAccounts, config.bindings);
  const selected = options.get('--account');
  if (selected !== undefined && !Object.hasOwn(accounts, selected)) throw new TypeError('Choose an existing supplier account alias');
  if (command === 'check') {
    const result = { status: 'SUPPLIER_CONFIG_VALID', accounts: Object.values(accounts)
      .filter(row => selected === undefined || row.name === selected).map(row => ({
        name: row.name, account: row.provider.account, apiKeyEnv: row.provider.apiKeyEnv ?? null,
        policy: row.policy, bindings: row.bindings,
      })) };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }
  const registry = createSupplierQuotaRegistry(config);
  try {
    const report = selected === undefined ? await registry.snapshot() : {
      schema: 'stellar-forge.supplier-quotas.v1', capturedAt: new Date().toISOString(),
      accounts: [await registry.controller(selected).read()],
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.accounts.some(row => row.status !== 'AVAILABLE')) process.exitCode = 2;
    return report;
  } finally { await registry.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write((error instanceof TypeError ? error.message : 'SUPPLIER_QUOTA_INSPECTION_FAILED') + '\n');
    process.exitCode = 1;
  });
}

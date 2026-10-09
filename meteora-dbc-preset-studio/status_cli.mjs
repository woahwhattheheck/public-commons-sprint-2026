#!/usr/bin/env node
// Live read-only DBC status: uses official Meteora SDK + Solana RPC only.
import { summarizeSnapshot } from './status_core.mjs';

const HELP = [
  'Read-only Meteora DBC graduation status (official SDK 1.5.13)',
  '  node status_cli.mjs --pool <DBC_POOL_ADDRESS> --rpc <HTTPS_SOLANA_RPC>',
  '  (or set SOLANA_RPC_URL)',
  '',
  'This performs public RPC reads only. It does not create, sign, or send transactions.',
  'Graduated DAMM v2 status is VERIFIED only if the SDK-derived successor PDA',
  'has an actual on-chain account owned by the DAMM v2 program.',
  '',
].join('\n');

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  if (args.length === 0 || args.length % 2 !== 0) throw new TypeError(HELP);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--pool', '--rpc'].includes(args[i]) || opts[args[i]]) throw new TypeError('Unknown/duplicate argument: ' + args[i]);
    opts[args[i]] = args[i + 1];
  }
  if (!opts['--pool']) throw new TypeError('Missing --pool');
  const endpoint = opts['--rpc'] || process.env.SOLANA_RPC_URL;
  if (!endpoint) throw new TypeError('Missing --rpc / SOLANA_RPC_URL');
  let url;
  try { url = new URL(endpoint); } catch { throw new TypeError('Invalid RPC URL'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new TypeError('RPC must be HTTPS (or localhost HTTP for local development)');
  }
  if (url.username || url.password || url.hash) throw new TypeError('RPC URL credentials/fragments not supported');
  return { pool: opts['--pool'], endpoint: url.toString() };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  if (input.help) return process.stdout.write(HELP);
  const [{ Connection, PublicKey }, sdk] = await Promise.all([
    import('@solana/web3.js'),
    import('@meteora-ag/dynamic-bonding-curve-sdk'),
  ]);
  const poolAddress = new PublicKey(input.pool);
  const conn = new Connection(input.endpoint, 'confirmed');
  const client = new sdk.DynamicBondingCurveClient(conn, 'confirmed');
  const pool = await client.state.getPool(poolAddress);
  if (!pool) throw new Error('DBC pool not found; no migration status can be asserted');
  const config = await client.state.getPoolConfig(pool.poolState?.config);
  if (!config) throw new Error('DBC config not found; no migration status can be asserted');
  const [slot, poolAccount, configAccount] = await Promise.all([
    conn.getSlot('confirmed'),
    conn.getAccountInfo(poolAddress, 'confirmed'),
    conn.getAccountInfo(pool.poolState.config, 'confirmed'),
  ]);
  if (!poolAccount?.owner.equals(sdk.DYNAMIC_BONDING_CURVE_PROGRAM_ID) ||
      !configAccount?.owner.equals(sdk.DYNAMIC_BONDING_CURVE_PROGRAM_ID)) {
    throw new Error('Unexpected pool/config owner; refuse to label as Meteora DBC');
  }
  const migrationOption = config.migrationOption;
  const migrated = pool.poolState.isMigrated === 1;
  let successor;
  if (migrationOption === 1) {
    const feeConfig = sdk.DAMM_V2_MIGRATION_FEE_ADDRESS?.[config.migrationFeeOption];
    if (!feeConfig) throw new Error('Unsupported DAMM v2 migration fee configuration');
    const derived = sdk.deriveDammV2PoolAddress(
      feeConfig, pool.poolState.baseMint, config.quoteMint);
    const account = migrated ? await conn.getAccountInfo(derived, 'confirmed') : null;
    successor = {
      address: derived.toBase58(),
      accountExists: account !== null,
      ownerMatchesDammV2: Boolean(account?.owner.equals(sdk.DAMM_V2_PROGRAM_ID)),
    };
  }
  const summary = summarizeSnapshot({ poolAddress, pool, config, slot, successor });
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main().catch((error) => {
  // Don't print RPC URLs or keys in errors, including provider errors with embedded URLs.
  const text = error instanceof TypeError ? error.message :
    'Live RPC/SDK read failed or returned unverifiable state';
  process.stderr.write(text + '\n');
  process.exitCode = 1;
});

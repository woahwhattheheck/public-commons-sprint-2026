// Pure, exact-integer interpretation of SDK-decoded DBC pool and config accounts.
// There is no wallet, network, price estimate, or transaction in this module.
export const STATUS_SCHEMA = 'meteora-dbc-live-pool-status/v1';

function atomic(value, label, positive = false) {
  const raw = value?.toString?.();
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) {
    throw new TypeError(`${label} is not an unsigned atomic integer`);
  }
  const n = BigInt(raw);
  if (positive && n === 0n) throw new TypeError(`${label} must be positive`);
  return n;
}

function pubkey(value, label) {
  if (!value || typeof value.toBase58 !== 'function') throw new TypeError(`${label} must be a PublicKey`);
  const encoded = value.toBase58();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(encoded)) throw new TypeError(`Invalid ${label}`);
  return encoded;
}

function flag(value, label) {
  // Anchor u8 fields are decoded to numbers; reject unknown schema shapes.
  if (value !== 0 && value !== 1) throw new TypeError(`Unsupported ${label} value`);
  return value;
}

export function summarizeSnapshot({ poolAddress, pool, config, slot, successor }) {
  if (!pool?.poolState || !config) throw new TypeError('Missing decoded DBC pool/config state');
  if (!Number.isSafeInteger(slot) || slot < 0) throw new TypeError('Missing confirmed RPC slot');
  const p = pool.poolState;
  const migration = flag(p.isMigrated, 'isMigrated');
  const option = flag(config.migrationOption, 'migrationOption');
  const reserve = atomic(p.quoteReserve, 'quoteReserve');
  const threshold = atomic(config.migrationQuoteThreshold, 'migrationQuoteThreshold', true);
  const progress = reserve * 10000n / threshold;
  const progressBps = Number(progress > 10000n ? 10000n : progress);
  const thresholdReached = reserve >= threshold;
  const successorVerified = Boolean(successor?.accountExists && successor?.ownerMatchesDammV2);
  let status;
  if (migration === 1 && option === 1) status = successorVerified ? 'MIGRATED_DAMM_V2_VERIFIED' : 'MIGRATED_DAMM_V2_UNVERIFIED';
  else if (migration === 1) status = 'MIGRATED_LEGACY_DAMM_V1_UNVERIFIED';
  else if (thresholdReached) status = 'THRESHOLD_REACHED_AWAITING_MIGRATION';
  else status = 'TRADING_ON_DBC';
  return {
    schema: STATUS_SCHEMA,
    observedAtSlot: slot,
    poolAddress: pubkey(poolAddress, 'poolAddress'),
    configAddress: pubkey(p.config, 'configAddress'),
    baseMint: pubkey(p.baseMint, 'baseMint'),
    quoteMint: pubkey(config.quoteMint, 'quoteMint'),
    quoteReserveAtomic: reserve.toString(),
    migrationThresholdAtomic: threshold.toString(),
    quoteProgressBps: progressBps,
    thresholdReached,
    migratedFlag: migration === 1,
    migrationDestination: option === 1 ? 'DAMM_V2' : 'LEGACY_DAMM_V1',
    successor: option === 1 ? {
      expectedPoolAddress: successor?.address ?? null,
      accountExists: Boolean(successor?.accountExists),
      ownerMatchesDammV2: Boolean(successor?.ownerMatchesDammV2),
    } : null,
    status,
    onChainStateFetched: true,
    // Derived on-chain account state is not the same as a swap, migration tx, or earning money.
    walletConnected: false,
    transactionSent: false,
    payoutOrPrizeReceived: false,
  };
}

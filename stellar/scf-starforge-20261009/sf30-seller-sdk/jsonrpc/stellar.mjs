// MIT. Provider-neutral Stellar read contracts; reuse the original PR1003 inputs.
import { METHODS as existingMethods, LIMITS as existingLimits, plain,
  requestSchema as existingSchema, exampleRequest as existingExample,
  admitRequest as existingAdmission, rpcParams as existingParams,
} from '../../partners/getblock-stellar/product.mjs';

export const METHODS = Object.freeze(['getEvents', 'getFeeStats', 'getHealth',
  'getLatestLedger', 'getLedgerEntries', 'getLedgers', 'getNetwork',
  'getTransaction', 'getTransactions', 'getVersionInfo']);
export const LIMITS = Object.freeze({ ...existingLimits, maxLedgerPage: 200 });
export const NETWORKS = Object.freeze({
  'stellar:pubnet': 'Public Global Stellar Network ; September 2015',
  'stellar:testnet': 'Test SDF Network ; September 2015',
});
const emptyMethods = new Set(['getFeeStats', 'getHealth', 'getLatestLedger', 'getNetwork', 'getVersionInfo']);
const ledger = { type: 'integer', minimum: 1, maximum: 4294967295 };
const integer = { type: 'integer', minimum: 0, maximum: 4294967295 };
const text = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength });
const obj = (properties, required = [], additionalProperties = true) =>
  ({ type: 'object', properties, required, additionalProperties });
const list = maxItems => ({ type: 'array', maxItems, items: { type: 'object' } });
const ledgerLimits = limits => ({ ...limits, maxTransactionPage: limits.maxLedgerPage });
const supported = method => {
  if (!METHODS.includes(method)) throw new TypeError('Select a supported Stellar RPC read');
};

export function requestSchema(method, limits = LIMITS) {
  supported(method);
  if (existingMethods.includes(method)) return existingSchema(method, limits);
  // Stellar getLedgers uses the same startLedger/cursor/base64 input contract.
  if (method === 'getLedgers') return existingSchema('getTransactions', ledgerLimits(limits));
  return obj({}, [], false);
}
export function exampleRequest(method) {
  supported(method);
  return emptyMethods.has(method) ? {} : existingExample(method);
}
export function admitRequest(method, context, limits = LIMITS) {
  supported(method);
  if (existingMethods.includes(method)) return existingAdmission(method, context, limits);
  if (method === 'getLedgers') return existingAdmission('getTransactions', context, ledgerLimits(limits));
  return context?.method === 'POST' && plain(context.body) &&
    Object.keys(context.body).length === 0 && !context.url?.search &&
    Object.keys(context.query ?? {}).length === 0 ? true : {
      status: 422, headers: { 'content-type': 'application/json' },
      body: { error: 'STELLAR_READ_INPUT_INVALID', field: 'request' },
    };
}
export function rpcParams(method, body, limits = LIMITS) {
  supported(method);
  if (existingMethods.includes(method)) return existingParams(method, body, limits);
  if (method === 'getLedgers') return existingParams('getTransactions', body, ledgerLimits(limits));
  return undefined; // Methods with zero parameters omit params on the RPC wire.
}

/** Required stable fields, with future result fields preserved in original bytes. */
export function resultSchema(method, limits = LIMITS, network) {
  supported(method);
  if (method === 'getNetwork') return obj({
    passphrase: network ? { const: NETWORKS[network] } : text(256, 1),
    protocolVersion: integer, friendbotUrl: text(2048),
  }, ['passphrase', 'protocolVersion']);
  if (method === 'getHealth') return obj({ status: { const: 'healthy' },
    latestLedger: ledger, oldestLedger: ledger, ledgerRetentionWindow: ledger,
    latestLedgerCloseTime: text(24), oldestLedgerCloseTime: text(24),
  }, ['status', 'latestLedger', 'oldestLedger', 'ledgerRetentionWindow']);
  if (method === 'getLatestLedger') return obj({ id: text(64, 64),
    protocolVersion: integer, sequence: ledger, closeTime: text(24),
  }, ['id', 'protocolVersion', 'sequence']);
  if (method === 'getFeeStats') return obj({ latestLedger: ledger,
    inclusionFee: { type: 'object' }, sorobanInclusionFee: { type: 'object' },
  }, ['latestLedger', 'inclusionFee', 'sorobanInclusionFee']);
  if (method === 'getVersionInfo') return obj({ version: text(256, 1),
    commitHash: text(128), buildTimestamp: text(128),
    captiveCoreVersion: text(512), protocolVersion: integer,
  }, ['version']);
  if (method === 'getTransaction') return obj({ latestLedger: ledger,
    status: { enum: ['SUCCESS', 'FAILED', 'NOT_FOUND'] }, txHash: text(64, 64),
  }, ['latestLedger', 'status', 'txHash']);
  const key = { getEvents: 'events', getTransactions: 'transactions',
    getLedgers: 'ledgers', getLedgerEntries: 'entries' }[method];
  const maximum = { getEvents: limits.maxEventPage,
    getTransactions: limits.maxTransactionPage, getLedgers: limits.maxLedgerPage,
    getLedgerEntries: limits.maxLedgerKeys }[method];
  const properties = { latestLedger: ledger, [key]: list(maximum) };
  const required = ['latestLedger', key];
  if (method !== 'getLedgerEntries') {
    properties.cursor = text(512); required.push('cursor');
  }
  return obj(properties, required);
}

export const correlationId = method => 'sf30:' + method;
export function responseSchema(method, limits = LIMITS, network) {
  return obj({ jsonrpc: { const: '2.0' }, id: { const: correlationId(method) },
    result: resultSchema(method, limits, network), error: false,
  }, ['jsonrpc', 'id', 'result']);
}
export function responseContract(method, limits = LIMITS, network) {
  return { schema: 'stellar-forge.upstream-response-contract.v1', method: 'POST',
    responses: { '200': { content: { 'application/json': responseSchema(method, limits, network) } } } };
}

/** Associations not expressible in a static response contract. No data rewriting. */
export function resultMatchesRequest(method, result, params = {}) {
  if (method === 'getTransaction' && result.txHash !== params.hash) return false;
  if (method === 'getHealth' && result.oldestLedger > result.latestLedger) return false;
  if (method === 'getLatestLedger' && !/^[a-f0-9]{64}$/.test(result.id)) return false;
  const key = { getEvents: 'events', getTransactions: 'transactions',
    getLedgers: 'ledgers', getLedgerEntries: 'entries' }[method];
  if (!key) return true;
  const rows = result[key];
  if (method === 'getLedgerEntries') {
    const requested = new Set(params.keys), found = new Set();
    return rows.every(row => typeof row.key === 'string' && requested.has(row.key) &&
      !found.has(row.key) && (found.add(row.key), true));
  }
  if (rows.length > params.pagination.limit) return false;
  return rows.every(row => {
    const sequence = method === 'getLedgers' ? row.sequence : row.ledger;
    return Number.isSafeInteger(sequence) && sequence > 0 && sequence <= result.latestLedger &&
      (params.startLedger === undefined || sequence >= params.startLedger) &&
      (params.endLedger === undefined || sequence < params.endLedger);
  });
}

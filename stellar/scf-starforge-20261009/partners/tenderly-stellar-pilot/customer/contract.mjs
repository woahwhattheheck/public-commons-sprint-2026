// MIT. Tenderly identities over the original retained provider response.
// Provider contract: https://docs.tenderly.co/api-reference/simulator/simulate-transaction
import { describeResult as describeProviderResult } from '../product.mjs';
export const REQUEST_SCHEMA = 'stellar-forge.tenderly-customer-request.v1';
export const EXPORT_SCHEMA = 'stellar-forge.tenderly-customer-export.v1';
export const MAX_RESULT_BYTES = 64 * 1024 * 1024;
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export function requireValue(value, code) {
  if (!value) throw Object.assign(new Error(code), { code });
}
const integer = value => Number.isSafeInteger(value) && value >= 0;
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const calldata = value => typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);

/** Normalized comparison data; the original HTTP request bytes are never rewritten. */
export function normalizeExpected(value) {
  requireValue(plain(value) && Object.keys(value).every(key =>
    ['networkId', 'blockNumber', 'transactionIndex', 'from', 'to', 'input', 'gas', 'value'].includes(key)),
  'TENDERLY_EXPECTED_FIELDS_INVALID');
  requireValue(typeof value.networkId === 'string' && /^[1-9][0-9]{0,19}$/.test(value.networkId),
    'TENDERLY_NETWORK_ID_REQUIRED');
  requireValue(integer(value.blockNumber), 'TENDERLY_PINNED_BLOCK_REQUIRED');
  requireValue(integer(value.transactionIndex), 'TENDERLY_PINNED_TRANSACTION_INDEX_REQUIRED');
  requireValue(address(value.from) && address(value.to), 'TENDERLY_TRANSACTION_ADDRESSES_REQUIRED');
  requireValue(calldata(value.input) && value.input.length <= 2 * 1024 * 1024 + 2,
    'TENDERLY_CALLDATA_REQUIRED');
  requireValue(Number.isSafeInteger(value.gas) && value.gas > 0,
    'TENDERLY_GAS_INVALID');
  requireValue(typeof value.value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value.value) &&
    BigInt(value.value) < (1n << 256n), 'TENDERLY_EXACT_VALUE_REQUIRED');
  return { networkId: value.networkId, blockNumber: value.blockNumber,
    transactionIndex: value.transactionIndex, from: value.from.toLowerCase(),
    to: value.to.toLowerCase(), input: value.input.toLowerCase(), gas: value.gas, value: value.value };
}

/** Read the fixed REST simulation payload chosen by the original merchant. */
export function expectedFromRequest(value, networkId) {
  requireValue(plain(value) && Object.keys(value).length === 7 &&
    Object.keys(value).every(key => ['block_number', 'transaction_index', 'from', 'to', 'input', 'gas', 'value'].includes(key)),
    'TENDERLY_ORIGINAL_PUBLIC_REQUEST_REQUIRED');
  return normalizeExpected({ networkId, blockNumber: value.block_number,
    transactionIndex: value.transaction_index, from: value.from, to: value.to,
    input: value.input, gas: value.gas, value: value.value });
}

/** Explicit execution context for the original analysis consumer; public body remains a separate exact file. */
export function analysisRequest(expectedValue) {
  const expected = normalizeExpected(expectedValue);
  return { network_id: expected.networkId, block_number: expected.blockNumber,
    transaction_index: expected.transactionIndex, from: expected.from, to: expected.to,
    input: expected.input, gas: expected.gas, value: expected.value };
}

export function equalExpected(left, right) {
  return JSON.stringify(normalizeExpected(left)) === JSON.stringify(normalizeExpected(right));
}

function matchTransaction(value, expected, { simulation = false } = {}) {
  requireValue(plain(value), 'TENDERLY_RESPONSE_TRANSACTION_REQUIRED');
  const fields = simulation
    ? [['network_id', 'networkId'], ['block_number', 'blockNumber'], ['transaction_index', 'transactionIndex']]
    : [['network_id', 'networkId'], ['block_number', 'blockNumber'], ['index', 'transactionIndex']];
  for (const [field, key] of fields) {
    if (simulation || own(value, field))
      requireValue(value[field] === expected[key], 'TENDERLY_RESULT_' + key.toUpperCase() + '_MISMATCH');
  }
  for (const field of ['from', 'to', 'input']) {
    if (simulation || own(value, field))
      requireValue(typeof value[field] === 'string' && value[field].toLowerCase() === expected[field],
        'TENDERLY_RESULT_' + field.toUpperCase() + '_MISMATCH');
  }
  if (simulation || own(value, 'gas'))
    requireValue(value.gas === expected.gas, 'TENDERLY_RESULT_GAS_MISMATCH');
  if (simulation || own(value, 'value')) {
    let actual;
    try { actual = BigInt(value.value === '0x' ? '0' : value.value); }
    catch { requireValue(false, 'TENDERLY_RESULT_VALUE_INVALID'); }
    requireValue(actual === BigInt(expected.value), 'TENDERLY_RESULT_VALUE_MISMATCH');
  }
}

/** A revert is a completed simulation result. All traces and provider fields stay intact. */
export function describeResult(envelope, expectedValue) {
  const expected = normalizeExpected(expectedValue);
  requireValue(plain(envelope) && plain(envelope.simulation) && plain(envelope.transaction),
    'TENDERLY_FULL_RESULT_REQUIRED');
  requireValue(!own(envelope, 'error') || envelope.error === null, 'TENDERLY_PROVIDER_ERROR_RESPONSE');
  const provider = describeProviderResult({ status: 200, body: Buffer.from(JSON.stringify(envelope)) });
  requireValue(provider !== null, 'TENDERLY_FULL_RESULT_REQUIRED');
  const simulation = envelope.simulation, transaction = envelope.transaction;
  requireValue(typeof simulation.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(simulation.id),
    'TENDERLY_SIMULATION_ID_REQUIRED');
  requireValue(typeof simulation.status === 'boolean', 'TENDERLY_SIMULATION_STATUS_REQUIRED');
  matchTransaction(simulation, expected, { simulation: true });
  matchTransaction(transaction, expected);
  if (own(transaction, 'status')) requireValue(transaction.status === simulation.status,
    'TENDERLY_TRANSACTION_STATUS_MISMATCH');
  const transactionHash = transaction.hash ?? null;
  requireValue(transactionHash === null || typeof transactionHash === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(transactionHash), 'TENDERLY_EVM_TRANSACTION_HASH_INVALID');
  return { simulationId: simulation.id, networkId: expected.networkId,
    blockNumber: expected.blockNumber, transactionIndex: expected.transactionIndex,
    status: simulation.status, transactionHash };
}

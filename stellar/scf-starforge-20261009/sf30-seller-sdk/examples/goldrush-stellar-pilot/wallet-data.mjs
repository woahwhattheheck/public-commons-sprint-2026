import {createHash} from 'node:crypto';

/**
 * Pure interpretation of one complete, retained GoldRush HTTP response.
 * No request, purchase, queue mutation, file access or annotation happens here.
 * Numeric JSON tokens are read losslessly. Amounts and quotes in the exported
 * snapshot are decimal strings; quote values retain the provider's observation.
 *
 * Balance identity is chain + contract address, never a ticker. Transfer identity
 * uses a native log index when returned, otherwise the provider's transfer index
 * within its transaction. That fallback is explicitly not an on-chain log ID.
 * sourcePointer always locates the exact row in the retained original JSON.
 */
const SCHEMA = 'stellar-forge.goldrush-wallet-snapshot.v1';
const CHAINS = {'eth-mainnet': '1', 'base-mainnet': '8453', 'arbitrum-mainnet': '42161'};
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_DIGITS = 4096;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;
const NUMBER_TOKEN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

export class WalletDataError extends Error {
  constructor(code, message) { super(message); this.name = 'WalletDataError'; this.code = code; }
}
const fail = (code, message) => { throw new WalletDataError(code, message); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof NumericToken);
class NumericToken { constructor(value) { this.value = value; } }

// A small JSON reader keeps number lexemes before IEEE-754 can round them. The
// native JSON parser still decodes each quoted string and validates its escapes.
function losslessJson(text) {
  let at = 0;
  const bad = () => fail('GOLDRUSH_JSON_INVALID', 'The retained response is not unambiguous JSON.');
  const white = () => { while (at < text.length && /[ \t\r\n]/.test(text[at])) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') {
        try { return JSON.parse(text.slice(start, at)); } catch { return bad(); }
      }
      if (c === '\\') at++;
    }
    return bad();
  }
  function value(depth) {
    if (depth > 64) fail('GOLDRUSH_JSON_DEPTH', 'The retained response exceeds the JSON nesting limit.');
    white();
    const c = text[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; white(); const out = Object.create(null);
      if (text[at] === '}') { at++; return out; }
      for (;;) {
        if (text[at] !== '"') return bad();
        const key = string();
        if (Object.hasOwn(out, key)) return bad();
        white(); if (text[at++] !== ':') return bad();
        out[key] = value(depth + 1); white();
        if (text[at] === '}') { at++; return out; }
        if (text[at++] !== ',') return bad();
        white();
      }
    }
    if (c === '[') {
      at++; white(); const out = [];
      if (text[at] === ']') { at++; return out; }
      for (;;) {
        out.push(value(depth + 1)); white();
        if (text[at] === ']') { at++; return out; }
        if (text[at++] !== ',') return bad();
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, at)) { at += literal.length; return result; }
    }
    NUMBER_TOKEN.lastIndex = at;
    const match = NUMBER_TOKEN.exec(text);
    if (!match) return bad();
    at = NUMBER_TOKEN.lastIndex;
    if (match[0].length > MAX_DIGITS) fail('GOLDRUSH_NUMBER_LIMIT', 'A provider number exceeds the supported digit limit.');
    return new NumericToken(match[0]);
  }
  const result = value(0); white();
  if (at !== text.length) return bad();
  return result;
}

function scalar(v, field, nullable = false) {
  if (nullable && (v === null || v === undefined)) return null;
  if (typeof v === 'string') return v;
  if (v instanceof NumericToken) return v.value;
  fail('GOLDRUSH_FIELD_INVALID', `The provider field ${field} has an invalid value.`);
}
function decimal(v, field, nullable = true) {
  const raw = scalar(v, field, nullable);
  if (raw === null) return null;
  const m = DECIMAL.exec(raw);
  if (!m || raw.length > MAX_DIGITS) fail('GOLDRUSH_DECIMAL_INVALID', `The provider field ${field} is not an exact decimal.`);
  const exponent = m[4] === undefined ? 0 : Number(m[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DIGITS) fail('GOLDRUSH_NUMBER_LIMIT', `The provider field ${field} exceeds the supported decimal range.`);
  const digits = m[2] + (m[3] || '');
  const point = m[2].length + exponent;
  let out = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
    : `${digits.slice(0, point)}.${digits.slice(point)}`;
  out = out.replace(/^0+(?=[0-9])/, '');
  return m[1] && /[1-9]/.test(out) ? `-${out}` : out;
}
function integer(v, field, {nullable = true, signed = false} = {}) {
  // JSON permits an integer-valued numeric token such as 1e3 or 18.0. Expand it
  // exactly before checking its integer value; quantity strings stay explicit.
  const raw = v instanceof NumericToken ? decimal(v, field, nullable).replace(/\.0+$/, '') : scalar(v, field, nullable);
  if (raw === null) return null;
  if (!INTEGER.test(raw) || raw.length > MAX_DIGITS || (!signed && raw.startsWith('-'))) {
    fail('GOLDRUSH_INTEGER_INVALID', `The provider field ${field} is not an exact integer.`);
  }
  return BigInt(raw).toString();
}
function smallInteger(v, field, min, max, nullable = false) {
  const raw = integer(v, field, {nullable});
  if (raw === null) return null;
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail('GOLDRUSH_INTEGER_RANGE', `The provider field ${field} is outside the supported range.`);
  return number;
}
function text(v, field, nullable = true) {
  if (nullable && (v === null || v === undefined)) return null;
  if (typeof v !== 'string') fail('GOLDRUSH_FIELD_INVALID', `The provider field ${field} must be text.`);
  return v;
}
function boolean(v, field, nullable = true) {
  if (nullable && (v === null || v === undefined)) return null;
  if (typeof v !== 'boolean') fail('GOLDRUSH_FIELD_INVALID', `The provider field ${field} must be a boolean.`);
  return v;
}
function address(v, field, nullable = false) {
  const out = text(v, field, nullable);
  if (out === null) return null;
  if (!ADDRESS.test(out)) fail('GOLDRUSH_ADDRESS_INVALID', `The provider field ${field} must contain an EVM address.`);
  return out.toLowerCase();
}
function hash(v, field, nullable = false) {
  const out = text(v, field, nullable);
  if (out === null) return null;
  if (!HASH.test(out)) fail('GOLDRUSH_TRANSACTION_INVALID', `The provider field ${field} must contain a transaction or block hash.`);
  return out.toLowerCase();
}
function amount(raw, decimals) {
  if (raw === null || decimals === null) return null;
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const out = decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
  return negative ? `-${out}` : out;
}
function sourceCopy(source, body) {
  if (!object(source) || !['buyer', 'reference'].includes(source.kind) || typeof source.id !== 'string' || !source.id.trim()
      || typeof source.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(source.sha256)
      || !Number.isSafeInteger(source.bytes) || source.bytes < 0) {
    fail('GOLDRUSH_SOURCE_INVALID', 'A complete buyer or reference source identity is required.');
  }
  if (source.bytes !== Buffer.byteLength(body, 'utf8') || createHash('sha256').update(body, 'utf8').digest('hex') !== source.sha256.toLowerCase()) {
    fail('GOLDRUSH_SOURCE_MISMATCH', 'The response bytes do not match the supplied source identity.');
  }
  for (const name of ['operator', 'url', 'retrievedAt']) {
    if (source[name] !== undefined && source[name] !== null && typeof source[name] !== 'string') fail('GOLDRUSH_SOURCE_INVALID', `Source ${name} must be text or unknown.`);
  }
  // The caller owns and authenticates these source fields. Preserve its envelope
  // rather than promoting a reference to an Inbox purchase or attestation proof.
  let serialized;
  try { serialized = JSON.stringify(source); } catch { fail('GOLDRUSH_SOURCE_INVALID', 'The source identity must be JSON-safe.'); }
  return JSON.parse(serialized);
}
function queryPins(operation, input) {
  if (!object(input)) fail('GOLDRUSH_QUERY_INVALID', 'The exact original query parameters are required.');
  const allowed = operation === 'balances' ? ['quote-currency', 'no-spam']
    : ['quote-currency', 'contract-address', 'page-size', 'page-number', 'starting-block', 'ending-block'];
  const result = {};
  for (const key of Object.keys(input).sort()) {
    const value = input[key];
    if (!allowed.includes(key) || !['string', 'boolean', 'number'].includes(typeof value)
        || (typeof value === 'number' && !Number.isSafeInteger(value))) {
      fail('GOLDRUSH_QUERY_INVALID', 'Query parameters must be supported, unique scalar values.');
    }
    result[key] = String(value);
  }
  if (result['quote-currency'] !== undefined && !/^[A-Z]{3}$/.test(result['quote-currency'])) fail('GOLDRUSH_QUERY_INVALID', 'The quote-currency pin must use its original uppercase currency code.');
  if (result['no-spam'] !== undefined && !['true', 'false'].includes(result['no-spam'])) fail('GOLDRUSH_QUERY_INVALID', 'The no-spam pin must be true or false.');
  if (operation === 'transfers') {
    result['contract-address'] = address(result['contract-address'], 'query.contract-address');
    for (const key of ['page-size', 'page-number']) {
      if (!Object.hasOwn(result, key)) fail('GOLDRUSH_PAGE_PIN_REQUIRED', 'A transfer response needs the original page-size and page-number.');
      smallInteger(result[key], `query.${key}`, key === 'page-size' ? 1 : 0, key === 'page-size' ? 100 : Number.MAX_SAFE_INTEGER);
    }
    for (const key of ['starting-block', 'ending-block']) if (result[key] !== undefined) integer(result[key], `query.${key}`, {nullable: false});
    if (result['starting-block'] !== undefined && result['ending-block'] !== undefined && BigInt(result['starting-block']) > BigInt(result['ending-block'])) fail('GOLDRUSH_QUERY_INVALID', 'The starting-block pin is after the ending-block pin.');
  }
  return result;
}
function tokenFields(item, path) {
  return {
    contractAddress: address(item.contract_address, `${path}/contract_address`),
    decimals: smallInteger(item.contract_decimals, `${path}/contract_decimals`, 0, 255, true),
    name: text(item.contract_name, `${path}/contract_name`),
    symbol: text(item.contract_ticker_symbol, `${path}/contract_ticker_symbol`),
  };
}
function uniqueKey(base, seen, ambiguous) {
  const count = seen.get(base) || 0; seen.set(base, count + 1);
  if (!count) return base;
  if (count === 1) ambiguous.push(base);
  return `${base}:duplicate:${count}`;
}

/** Returns a JSON-safe snapshot; throws WalletDataError without including body text. */
export function parseWalletResponse(body, {operation, chain, wallet, query, source} = {}) {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_BYTES) fail('GOLDRUSH_RESPONSE_LIMIT', 'A complete UTF-8 response within 16 MiB is required.');
  if (!['balances', 'transfers'].includes(operation) || !Object.hasOwn(CHAINS, chain)) fail('GOLDRUSH_OPERATION_INVALID', 'The selected operation or chain is outside the original pilot.');
  const expectedWallet = address(wallet, 'request.wallet');
  const pins = queryPins(operation, query);
  const provenance = sourceCopy(source, body);
  const wire = losslessJson(body);
  // API3's documented passthrough returns the provider body unchanged. Do not
  // guess at wrappers or mistake a provider error for an empty wallet.
  if (!object(wire) || wire.error !== false || !object(wire.data) || !Array.isArray(wire.data.items)) fail('GOLDRUSH_ENVELOPE_INVALID', 'The retained body is not a successful GoldRush response envelope.');
  const data = wire.data;
  const returnedWallet = address(data.address, 'data.address');
  const returnedChain = text(data.chain_name, 'data.chain_name', false);
  const chainId = integer(data.chain_id, 'data.chain_id', {nullable: false});
  if (returnedWallet !== expectedWallet || returnedChain !== chain || chainId !== CHAINS[chain]) fail('GOLDRUSH_IDENTITY_MISMATCH', 'The provider response does not match the selected wallet and chain.');
  const quoteCurrency = text(data.quote_currency, 'data.quote_currency', false);
  if (!/^[A-Z]{3}$/.test(quoteCurrency) || (pins['quote-currency'] !== undefined && pins['quote-currency'] !== quoteCurrency)) fail('GOLDRUSH_QUOTE_MISMATCH', 'The response does not match the selected quote currency.');
  const updatedAt = text(data.updated_at, 'data.updated_at', false);
  if (!Number.isFinite(Date.parse(updatedAt))) fail('GOLDRUSH_TIMESTAMP_INVALID', 'The response does not contain a usable provider update time.');
  const rows = [], transactions = [], ambiguousKeys = [], unscaledRows = [];
  const seen = new Map(), seenTransactions = new Set();
  let pagination = null;
  if (operation === 'balances') {
    data.items.forEach((item, index) => {
      const pointer = `/data/items/${index}`;
      if (!object(item)) fail('GOLDRUSH_ROW_INVALID', 'A balance row must be an object.');
      const token = tokenFields(item, pointer);
      const balance = integer(item.balance, `${pointer}/balance`, {nullable: false});
      const balance24h = integer(item.balance_24h, `${pointer}/balance_24h`);
      const tokenKey = `${chain}:${token.contractAddress}`;
      const key = uniqueKey(`balance:${tokenKey}`, seen, ambiguousKeys);
      if (token.decimals === null) unscaledRows.push(key);
      rows.push({kind: 'token', key, tokenKey, sourcePointer: pointer, ...token,
        displayName: text(item.contract_display_name, `${pointer}/contract_display_name`),
        nativeToken: boolean(item.is_native_token, `${pointer}/is_native_token`),
        spam: boolean(item.is_spam, `${pointer}/is_spam`), type: text(item.type, `${pointer}/type`),
        balance, balance24h, amount: amount(balance, token.decimals), amount24h: amount(balance24h, token.decimals),
        quoteRate: decimal(item.quote_rate, `${pointer}/quote_rate`), quoteRate24h: decimal(item.quote_rate_24h, `${pointer}/quote_rate_24h`),
        quote: decimal(item.quote, `${pointer}/quote`), quote24h: decimal(item.quote_24h, `${pointer}/quote_24h`),
        lastTransferredAt: text(item.last_transferred_at, `${pointer}/last_transferred_at`),
        blockHeight: integer(item.block_height, `${pointer}/block_height`),
      });
    });
  } else {
    const p = data.pagination;
    if (!object(p)) fail('GOLDRUSH_PAGINATION_INVALID', 'The transfer response is missing its provider pagination.');
    const pageNumber = smallInteger(p.page_number, 'data.pagination.page_number', 0, Number.MAX_SAFE_INTEGER);
    const pageSize = smallInteger(p.page_size, 'data.pagination.page_size', 1, 100);
    const hasMore = boolean(p.has_more, 'data.pagination.has_more', false);
    if (String(pageNumber) !== pins['page-number'] || String(pageSize) !== pins['page-size']) fail('GOLDRUSH_PAGE_MISMATCH', 'The response does not match the exact requested transfer page.');
    pagination = {pageNumber, pageSize, hasMore,
      totalCount: integer(p.total_count, 'data.pagination.total_count'),
      nextPage: hasMore && pageNumber < Number.MAX_SAFE_INTEGER ? pageNumber + 1 : null};
    if (data.items.length > pageSize) fail('GOLDRUSH_PAGINATION_INVALID', 'The response contains more transactions than its declared page size.');
    data.items.forEach((item, transactionIndex) => {
      const pointer = `/data/items/${transactionIndex}`;
      if (!object(item) || !Array.isArray(item.transfers)) fail('GOLDRUSH_ROW_INVALID', 'A transfer transaction must contain its transfer array.');
      const txHash = hash(item.tx_hash, `${pointer}/tx_hash`);
      if (seenTransactions.has(txHash)) ambiguousKeys.push(`transaction:${chain}:${txHash}`);
      seenTransactions.add(txHash);
      const gas = item.gas_metadata == null ? null : item.gas_metadata;
      if (gas !== null && !object(gas)) fail('GOLDRUSH_ROW_INVALID', 'Transaction gas metadata must be an object.');
      const gasDecimals = gas ? smallInteger(gas.contract_decimals, `${pointer}/gas_metadata/contract_decimals`, 0, 255, true) : null;
      const value = integer(item.value, `${pointer}/value`);
      const feesPaid = integer(item.fees_paid, `${pointer}/fees_paid`);
      const transaction = {index: transactionIndex, txHash, sourcePointer: pointer,
        blockHash: hash(item.block_hash, `${pointer}/block_hash`, true),
        blockHeight: integer(item.block_height, `${pointer}/block_height`),
        blockSignedAt: text(item.block_signed_at, `${pointer}/block_signed_at`),
        txOffset: integer(item.tx_offset, `${pointer}/tx_offset`),
        successful: boolean(item.successful, `${pointer}/successful`),
        from: address(item.from_address, `${pointer}/from_address`, true), to: address(item.to_address, `${pointer}/to_address`, true),
        value, valueAmount: amount(value, gasDecimals), valueQuote: decimal(item.value_quote, `${pointer}/value_quote`),
        feesPaid, feesAmount: amount(feesPaid, gasDecimals),
        gasOffered: integer(item.gas_offered, `${pointer}/gas_offered`), gasSpent: integer(item.gas_spent, `${pointer}/gas_spent`),
        gasPrice: integer(item.gas_price, `${pointer}/gas_price`), gasQuote: decimal(item.gas_quote, `${pointer}/gas_quote`),
        gasQuoteRate: decimal(item.gas_quote_rate, `${pointer}/gas_quote_rate`), gasDecimals,
        gasSymbol: gas ? text(gas.contract_ticker_symbol, `${pointer}/gas_metadata/contract_ticker_symbol`) : null,
        transferCount: item.transfers.length};
      transactions.push(transaction);
      item.transfers.forEach((transfer, transferIndex) => {
        const sourcePointer = `${pointer}/transfers/${transferIndex}`;
        if (!object(transfer)) fail('GOLDRUSH_ROW_INVALID', 'A transfer row must be an object.');
        const token = tokenFields(transfer, sourcePointer);
        if (token.contractAddress !== pins['contract-address']) fail('GOLDRUSH_CONTRACT_MISMATCH', 'A returned transfer does not match the selected token contract.');
        if (transfer.tx_hash !== undefined && hash(transfer.tx_hash, `${sourcePointer}/tx_hash`) !== txHash) fail('GOLDRUSH_TRANSACTION_MISMATCH', 'A transfer row does not match its containing transaction.');
        const from = address(transfer.from_address, `${sourcePointer}/from_address`);
        const to = address(transfer.to_address, `${sourcePointer}/to_address`);
        const delta = integer(transfer.delta, `${sourcePointer}/delta`, {nullable: false, signed: true});
        const balance = integer(transfer.balance, `${sourcePointer}/balance`, {signed: true});
        const nativeLog = transfer.log_offset ?? transfer.log_index;
        const logIndex = nativeLog === undefined || nativeLog === null ? null : integer(nativeLog, `${sourcePointer}/log_index`, {nullable: false});
        const identityBasis = logIndex === null ? 'provider-transfer-index' : 'native-log-index';
        const base = `transfer:${chain}:${txHash}:${logIndex === null ? `row:${transferIndex}` : `log:${logIndex}`}`;
        const key = uniqueKey(base, seen, ambiguousKeys);
        if (token.decimals === null) unscaledRows.push(key);
        rows.push({kind: 'transfer', key, identityBasis, logIndex, sourcePointer,
          transactionIndex, transferIndex, txHash, blockSignedAt: text(transfer.block_signed_at, `${sourcePointer}/block_signed_at`) ?? transaction.blockSignedAt,
          ...token, from, to,
          direction: from === expectedWallet && to === expectedWallet ? 'self' : to === expectedWallet ? 'in' : from === expectedWallet ? 'out' : 'other',
          transferType: text(transfer.transfer_type, `${sourcePointer}/transfer_type`),
          delta, amount: amount(delta, token.decimals), balance, balanceAmount: amount(balance, token.decimals),
          quoteRate: decimal(transfer.quote_rate, `${sourcePointer}/quote_rate`),
          deltaQuote: decimal(transfer.delta_quote, `${sourcePointer}/delta_quote`), balanceQuote: decimal(transfer.balance_quote, `${sourcePointer}/balance_quote`),
        });
      });
    });
  }
  const coverage = {
    kind: operation === 'balances' ? 'returned-holdings-view' : 'single-filtered-transfer-page',
    providerItemCount: data.items.length, rowCount: rows.length,
    chainTipHeight: integer(data.chain_tip_height, 'data.chain_tip_height'),
    chainTipSignedAt: text(data.chain_tip_signed_at, 'data.chain_tip_signed_at'),
    allPagesOfThisQueryObserved: operation === 'balances' ? null : pagination.pageNumber === 0 && !pagination.hasMore,
    earlierPagesNotIncluded: operation === 'transfers' && pagination.pageNumber > 0,
    laterPagesAdvertised: operation === 'transfers' && pagination.hasMore,
    fullWalletHistory: false, missingRowsImplyZero: false,
    ambiguousKeys, unscaledRows,
    transactionsWithoutTransfers: transactions.filter(t => t.transferCount === 0).length,
    transferIdentity: operation === 'transfers' ? 'Native log index when present; otherwise the provider row within its transaction, not a chain log identity.' : null,
    interpretation: operation === 'balances'
      ? 'These are the provider holdings returned at updatedAt under the exact query filters; omitted tokens are not zero balances.'
      : 'This is one provider page for the selected contract and filters. has_more describes provider pagination, not complete wallet or chain history.',
  };
  return {schema: SCHEMA, operation, address: returnedWallet, chain, chainId, quoteCurrency, updatedAt,
    query: pins, rows, transactions, pagination, coverage, source: provenance};
}

function decimalDifference(after, before) {
  if (after === null || before === null) return null;
  const split = value => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    return {negative, whole, fraction};
  };
  const a = split(after), b = split(before), scale = Math.max(a.fraction.length, b.fraction.length);
  const scaled = n => BigInt(`${n.negative ? '-' : ''}${n.whole}${n.fraction.padEnd(scale, '0')}`);
  return amount((scaled(a) - scaled(b)).toString(), scale);
}
function significantRow(row) {
  const out = {...row};
  for (const key of ['key', 'sourcePointer', 'transactionIndex', 'transferIndex']) delete out[key];
  return out;
}

/** Compare only matching wallet/chain/operation/filter/page scopes. Never net transfers into holdings. */
export function compareWalletResponses(left, right) {
  if (left?.schema !== SCHEMA || right?.schema !== SCHEMA) fail('GOLDRUSH_SNAPSHOT_INVALID', 'Two parsed wallet snapshots are required.');
  const reasons = [];
  for (const field of ['address', 'chain', 'chainId', 'operation', 'quoteCurrency']) if (left[field] !== right[field]) reasons.push(`Different ${field}.`);
  if (JSON.stringify(left.query) !== JSON.stringify(right.query)) reasons.push('Different query filters or page pins.');
  if (left.coverage.ambiguousKeys.length || right.coverage.ambiguousKeys.length) reasons.push('A response contains ambiguous duplicate row identities.');
  if (reasons.length) return {comparable: false, reasons, leftSource: left.source, rightSource: right.source, changes: [], transactionChanges: []};
  const before = new Map(left.rows.map(r => [r.key, r]));
  const after = new Map(right.rows.map(r => [r.key, r]));
  const changes = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(key) || null, b = after.get(key) || null;
    const fields = a && b ? [...new Set([...Object.keys(significantRow(a)), ...Object.keys(significantRow(b))])]
      .filter(field => JSON.stringify(a[field]) !== JSON.stringify(b[field])) : [];
    if (a && b && fields.length === 0) continue;
    const sameUnits = a && b && a.decimals !== null && a.decimals === b.decimals;
    changes.push({key, kind: !a ? 'added-to-view' : !b ? 'removed-from-view' : 'changed',
      contractAddress: (b || a).contractAddress, name: (b || a).name, symbol: (b || a).symbol,
      before: a, after: b, changedFields: fields,
      balanceDelta: left.operation === 'balances' && sameUnits ? (BigInt(b.balance) - BigInt(a.balance)).toString() : null,
      amountDelta: left.operation === 'balances' && sameUnits ? amount((BigInt(b.balance) - BigInt(a.balance)).toString(), b.decimals) : null,
      quoteDelta: left.operation === 'balances' && a && b ? decimalDifference(b.quote, a.quote) : null,
      unitMismatch: Boolean(a && b && a.decimals !== b.decimals),
    });
  }
  const transactionChanges = [];
  if (left.operation === 'transfers') {
    const earlier = new Map(left.transactions.map(t => [t.txHash, t]));
    const later = new Map(right.transactions.map(t => [t.txHash, t]));
    for (const txHash of [...new Set([...earlier.keys(), ...later.keys()])].sort()) {
      const a = earlier.get(txHash) || null, b = later.get(txHash) || null;
      const fields = a && b ? [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter(field => !['index', 'sourcePointer'].includes(field) && JSON.stringify(a[field]) !== JSON.stringify(b[field])) : [];
      if (a && b && !fields.length) continue;
      transactionChanges.push({txHash, kind: !a ? 'added-to-view' : !b ? 'removed-from-view' : 'changed', before: a, after: b, changedFields: fields});
    }
  }
  return {comparable: true, reasons: [], operation: left.operation, address: left.address, chain: left.chain,
    quoteCurrency: left.quoteCurrency, leftSource: left.source, rightSource: right.source,
    beforeUpdatedAt: left.updatedAt, afterUpdatedAt: right.updatedAt,
    chronology: Date.parse(left.updatedAt) === Date.parse(right.updatedAt) ? 'same-update' : Date.parse(left.updatedAt) < Date.parse(right.updatedAt) ? 'forward' : 'reverse',
    beforeCoverage: left.coverage, afterCoverage: right.coverage, changes, transactionChanges,
    interpretation: left.operation === 'balances'
      ? 'Deltas use tokens present in both matching provider views. A token entering or leaving a view is not an inferred zero balance or a purchase.'
      : 'Changes describe rows reported on this same filtered page. Page turnover is not proof of a new or removed chain transaction.',
  };
}

function csvCell(value) {
  let out = value === null || value === undefined ? '' : String(value);
  // Quote alone does not stop formulas or numeric precision coercion in common
  // spreadsheets. Prefix exact numeric strings as text, including positive large
  // integers; the apostrophe is an intentional export cell-protection marker.
  if ((typeof value === 'string' && /^-?[0-9]+(?:\.[0-9]+)?$/.test(out))
      || /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/.test(out) || /^[\t\r\n]/.test(out)) out = `'${out}`;
  return `"${out.replaceAll('"', '""')}"`;
}

/** Export one parsed observation, including its source and exact request scope. */
export function walletCsv(snapshot) {
  if (snapshot?.schema !== SCHEMA) fail('GOLDRUSH_SNAPSHOT_INVALID', 'A parsed wallet snapshot is required.');
  const columns = ['row_kind', 'source_kind', 'source_id', 'source_sha256', 'source_bytes', 'source_operator', 'source_url', 'source_retrieved_at',
    'operation', 'chain', 'chain_id', 'wallet', 'quote_currency', 'updated_at', 'query_json', 'row_key', 'source_pointer',
    'contract_address', 'token_name', 'token_symbol', 'decimals', 'amount'];
  const extra = snapshot.operation === 'balances'
    ? ['balance', 'balance_24h', 'amount_24h', 'quote', 'quote_24h', 'quote_rate', 'quote_rate_24h', 'is_native_token', 'is_spam', 'token_type', 'block_height', 'last_transferred_at']
    : ['tx_hash', 'block_signed_at', 'block_height', 'successful', 'from', 'to', 'direction', 'transfer_type', 'delta', 'balance', 'balance_amount',
      'delta_quote', 'balance_quote', 'quote_rate', 'identity_basis', 'log_index', 'transaction_index', 'transfer_index',
      'transaction_value', 'transaction_value_amount', 'transaction_value_quote', 'fees_paid', 'fees_amount', 'gas_symbol', 'gas_decimals',
      'gas_offered', 'gas_spent', 'gas_price', 'gas_quote', 'gas_quote_rate', 'page_number', 'page_size', 'has_more', 'total_count'];
  const lines = [[...columns, ...extra].map(csvCell).join(',')];
  const exportRows = [...snapshot.rows];
  if (snapshot.operation === 'transfers') {
    // Preserve fees/value even when a returned transaction has no transfer rows.
    for (const transaction of snapshot.transactions.filter(t => t.transferCount === 0)) exportRows.push({
      kind: 'transaction', key: `transaction:${snapshot.chain}:${transaction.txHash}:row:${transaction.index}`,
      transactionIndex: transaction.index, txHash: transaction.txHash, sourcePointer: transaction.sourcePointer,
      blockSignedAt: transaction.blockSignedAt, from: transaction.from, to: transaction.to,
    });
  }
  for (const row of exportRows.length ? exportRows : [null]) {
    const values = [row?.kind || 'observation', snapshot.source.kind, snapshot.source.id, snapshot.source.sha256, snapshot.source.bytes,
      snapshot.source.operator, snapshot.source.url, snapshot.source.retrievedAt,
      snapshot.operation, snapshot.chain, snapshot.chainId, snapshot.address, snapshot.quoteCurrency, snapshot.updatedAt, JSON.stringify(snapshot.query),
      row?.key, row?.sourcePointer, row?.contractAddress, row?.name, row?.symbol, row?.decimals, row?.amount];
    if (snapshot.operation === 'balances') values.push(row?.balance, row?.balance24h, row?.amount24h, row?.quote, row?.quote24h, row?.quoteRate, row?.quoteRate24h,
      row?.nativeToken, row?.spam, row?.type, row?.blockHeight, row?.lastTransferredAt);
    else {
      const transaction = row ? snapshot.transactions[row.transactionIndex] : null;
      values.push(row?.txHash, row?.blockSignedAt, transaction?.blockHeight, transaction?.successful, row?.from, row?.to, row?.direction,
        row?.transferType, row?.delta, row?.balance, row?.balanceAmount, row?.deltaQuote, row?.balanceQuote, row?.quoteRate,
        row?.identityBasis, row?.logIndex, row?.transactionIndex, row?.transferIndex,
        transaction?.value, transaction?.valueAmount, transaction?.valueQuote, transaction?.feesPaid, transaction?.feesAmount,
        transaction?.gasSymbol, transaction?.gasDecimals, transaction?.gasOffered, transaction?.gasSpent, transaction?.gasPrice,
        transaction?.gasQuote, transaction?.gasQuoteRate, snapshot.pagination.pageNumber, snapshot.pagination.pageSize,
        snapshot.pagination.hasMore, snapshot.pagination.totalCount);
    }
    lines.push(values.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

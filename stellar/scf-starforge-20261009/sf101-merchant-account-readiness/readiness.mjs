// SCF SF101: read-only classic-account receiving and reserve preflight.
// MIT. Node 22+. Never signs, submits, funds, approves, or settles a payment.
import { createHash } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STROOPS = 10_000_000n;
const OFFICIAL = Object.freeze({
  testnet: 'https://horizon-testnet.stellar.org',
  public: 'https://horizon.stellar.org',
});
const MAX_RESPONSE = 262_144;

function fail(code, reason) {
  const e = new Error(reason || code);
  e.code = code;
  throw e;
}
function nonnegativeSafe(value, name, max = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail('INVALID_' + name.toUpperCase(), name);
  return value;
}
function positiveAtomicText(value, name) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,14})(?:\.\d{1,7})?$/.test(value)) {
    fail('INVALID_DECIMAL', name + ' must be canonical decimal with at most 7 places');
  }
  const [whole, decimal = ''] = value.split('.');
  const result = BigInt(whole) * STROOPS + BigInt(decimal.padEnd(7, '0'));
  if (result < 0n || result > 9_223_372_036_854_775_807n) fail('AMOUNT_OUT_OF_RANGE', name);
  return result;
}
function decimal(value, name) {
  if (typeof value !== 'string') fail('INVALID_DECIMAL', name + ' missing');
  return positiveAtomicText(value, name);
}
export function amountText(value) {
  const v = BigInt(value);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  return sign + String(abs / STROOPS) + '.' + String(abs % STROOPS).padStart(7, '0');
}
export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}
export function validateGAddress(key) {
  if (typeof key !== 'string' || !/^G[A-Z2-7]{55}$/.test(key)) fail('INVALID_G_ADDRESS', 'Expected canonical Stellar G-address');
  let buffer = 0, bits = 0;
  const out = [];
  for (const c of key) {
    const x = ALPHABET.indexOf(c);
    if (x < 0) fail('INVALID_G_ADDRESS', 'Bad base32 character');
    buffer = (buffer << 5) | x;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  if (out.length !== 35 || bits !== 0 || out[0] !== 48) fail('INVALID_G_ADDRESS', 'Wrong Stellar StrKey version/length');
  let crc = 0;
  for (const byte of out.slice(0, 33)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  if (out[33] !== (crc & 255) || out[34] !== (crc >> 8)) fail('INVALID_G_ADDRESS', 'Stellar G-address checksum invalid');
  return key;
}
function requireObject(v, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('INVALID_' + name.toUpperCase(), name + ' object required');
  return v;
}
function ledgerFromResponse(v) {
  const records = requireObject(requireObject(v, 'ledgerEnvelope')._embedded, 'embedded').records;
  if (!Array.isArray(records) || records.length !== 1) fail('INVALID_LEDGER', 'Expected one latest Horizon ledger');
  const ledger = requireObject(records[0], 'ledger');
  const seq = nonnegativeSafe(ledger.sequence, 'ledgerSequence', Number.MAX_SAFE_INTEGER);
  const reserve = nonnegativeSafe(ledger.base_reserve_in_stroops, 'baseReserve', 100_000_000_000);
  const fee = nonnegativeSafe(ledger.base_fee_in_stroops, 'baseFee', 100_000_000_000);
  if (seq < 1 || reserve < 1 || fee < 1 || !Number.isFinite(Date.parse(ledger.closed_at))) {
    fail('INVALID_LEDGER', 'Latest ledger missing sequence, reserve, fee, or close time');
  }
  return { sequence: seq, baseReserve: BigInt(reserve), baseFee: BigInt(fee), closedAt: ledger.closed_at };
}
const clamp = n => n < 0n ? 0n : n;
function lineAmount(line, name) { return decimal(line[name] ?? '0.0000000', name); }

/**
 * Evaluates exact official Horizon account + ledger objects. Does not certify SAC/SEP-41
 * contract preconditions, classic issuer policy, or future inclusion/fees.
 */
export function evaluateSnapshots({account, ledgerEnvelope, accountId, network, asset, inboundAmount, feeOperations = 10, mode = 'offline', now = new Date()}) {
  if (!(network in OFFICIAL)) fail('INVALID_NETWORK', 'Network must be testnet or public');
  validateGAddress(accountId);
  nonnegativeSafe(feeOperations, 'feeOperations', 100_000);
  if (asset !== 'native') {
    requireObject(asset, 'asset');
    if (!/^[A-Za-z0-9]{1,12}$/.test(asset.code)) fail('INVALID_ASSET', 'Asset code must be 1..12 case-sensitive ASCII alphanumeric');
    validateGAddress(asset.issuer);
  }
  const requested = positiveAtomicText(inboundAmount, 'inboundAmount');
  if (requested < 1n) fail('INVALID_INBOUND_AMOUNT', 'Requested amount must be positive');
  if (!['live', 'offline'].includes(mode)) fail('INVALID_MODE');
  const acct = requireObject(account, 'account');
  if (acct.account_id !== accountId || (acct.id && acct.id !== accountId)) fail('ACCOUNT_ID_MISMATCH', 'Horizon record is not the requested merchant account');
  const ledger = ledgerFromResponse(ledgerEnvelope);
  const numSubentries = nonnegativeSafe(acct.subentry_count, 'subentryCount');
  const numSponsoring = nonnegativeSafe(acct.num_sponsoring, 'numSponsoring');
  const numSponsored = nonnegativeSafe(acct.num_sponsored, 'numSponsored');
  const lastModified = nonnegativeSafe(acct.last_modified_ledger, 'lastModifiedLedger', Number.MAX_SAFE_INTEGER);
  if (lastModified > ledger.sequence) fail('LEDGER_ACCOUNT_ORDER', 'Account snapshot is newer than ledger snapshot');
  const reserveUnits = 2 + numSubentries + numSponsoring - numSponsored;
  if (!Number.isSafeInteger(reserveUnits) || reserveUnits < 0) fail('INVALID_SPONSORSHIP', 'Sponsorship counter inconsistent');
  if (!Array.isArray(acct.balances)) fail('INVALID_BALANCES', 'Horizon balances missing');
  const xlms = acct.balances.filter(x => x?.asset_type === 'native');
  if (xlms.length !== 1) fail('INVALID_BALANCES', 'Expected exactly one native balance');
  const xlm = xlms[0];
  const xlmBalance = lineAmount(xlm, 'balance');
  const xlmSell = lineAmount(xlm, 'selling_liabilities');
  const reserved = BigInt(reserveUnits) * ledger.baseReserve;
  const available = clamp(xlmBalance - reserved - xlmSell);
  const feeFloor = ledger.baseFee * BigInt(feeOperations);
  const reasons = [], cautions = [];
  const observedAt = now instanceof Date ? now.toISOString() : fail('INVALID_NOW');
  const ledgerAgeSeconds = Math.round((Date.parse(observedAt) - Date.parse(ledger.closedAt)) / 1000);
  if (ledgerAgeSeconds > 180 || ledgerAgeSeconds < -45) cautions.push('LEDGER_HEAD_AGE_OUT_OF_RANGE');
  if (available < feeFloor) reasons.push('XLM_FEE_FLOOR_NOT_MET');
  if (xlmBalance < reserved + xlmSell) reasons.push('XLM_BELOW_BASE_RESERVE_AND_LIABILITIES');

  let assetBalance = null, capacity = null, limit = null, authorization = null;
  let assetKind = asset === 'native' ? 'native' : 'classic_issued';
  if (asset === 'native') {
    assetBalance = xlmBalance;
    capacity = null; // XLM inbound capacity has no classic trustline limit.
    authorization = 'NO_TRUSTLINE_REQUIRED';
  } else if (accountId === asset.issuer) {
    authorization = 'ISSUER_SPECIAL_CASE';
    reasons.push('ISSUER_RECEIVE_POLICY_REVIEW_REQUIRED');
  } else {
    const matches = acct.balances.filter(x => x?.asset_code === asset.code && x?.asset_issuer === asset.issuer && /^credit_alphanum(?:4|12)$/.test(x.asset_type || ''));
    if (matches.length > 1) fail('DUPLICATE_TRUSTLINE', 'Multiple matching trustlines');
    if (!matches.length) {
      authorization = 'MISSING_TRUSTLINE';
      reasons.push('ASSET_TRUSTLINE_MISSING');
    } else {
      const line = matches[0];
      assetBalance = lineAmount(line, 'balance');
      limit = decimal(line.limit, 'trustlineLimit');
      const buying = lineAmount(line, 'buying_liabilities');
      capacity = clamp(limit - assetBalance - buying);
      authorization = line.is_authorized === true ? 'AUTHORIZED' : (line.is_authorized_to_maintain_liabilities === true ? 'MAINTAIN_LIABILITIES_ONLY' : 'NOT_AUTHORIZED');
      if (authorization !== 'AUTHORIZED') reasons.push('ASSET_TRUSTLINE_NOT_AUTHORIZED');
      if (capacity < requested) reasons.push('INSUFFICIENT_INBOUND_TRUSTLINE_CAPACITY');
    }
  }
  if (mode !== 'live') cautions.push('SAVED_SNAPSHOT_NOT_LIVE_READINESS');
  cautions.push('CLASSIC_HORIZON_STATE_NOT_A_SEP41_CONTRACT_TRANSFER_PROOF');
  cautions.push('ESTIMATED_FEE_FLOOR_NOT_AN_INCLUSION_FEE_QUOTE');
  const status = reasons.length ? 'ACTION_REQUIRED' : (mode === 'live' && !cautions.includes('LEDGER_HEAD_AGE_OUT_OF_RANGE') ? 'CLASSIC_ACCOUNT_PREFLIGHT_OK' : 'REVIEW');
  return {
    schema: 'stellar-forge.sf101.account-readiness.v1',
    network, officialHorizon: OFFICIAL[network], accountId,
    mode: mode === 'live' ? 'LIVE_OFFICIAL_HORIZON_READ' : 'SAVED_UNVERIFIED_HORIZON_SNAPSHOTS',
    observedAt, ledger: {sequence: ledger.sequence, closedAt: ledger.closedAt, ageSeconds: ledgerAgeSeconds,
      baseReserveXlm: amountText(ledger.baseReserve), baseFeeFloorXlm: amountText(ledger.baseFee)},
    account: {lastModifiedLedger: lastModified, numSubentries, numSponsoring, numSponsored,
      reserveUnits, balanceXlm: amountText(xlmBalance), nativeSellingLiabilitiesXlm: amountText(xlmSell),
      minimumReserveXlm: amountText(reserved), availableXlm: amountText(available),
      expectedOperations: feeOperations, nominalFeeFloorXlm: amountText(feeFloor)},
    recipient: {asset: asset === 'native' ? {type: 'native'} : {type: assetKind, code: asset.code, issuer: asset.issuer},
      amountRequested: amountText(requested), authorization, existingBalance: assetBalance === null ? null : amountText(assetBalance),
      trustlineLimit: limit === null ? null : amountText(limit), inboundCapacity: capacity === null ? null : amountText(capacity)},
    status, reasons, cautions,
  };
}

async function fetchBounded(url, timeoutMs, fetchImpl) {
  const ctrl = new AbortController();
  const clock = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {method:'GET',headers:{accept:'application/json'},redirect:'manual',signal:ctrl.signal});
    if (!response.ok) fail('HORIZON_HTTP_' + response.status, 'Horizon GET ' + new URL(url).pathname + ' HTTP ' + response.status);
    let size = 0, chunks = [];
    if (!response.body) fail('EMPTY_HORIZON_RESPONSE');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_RESPONSE) fail('HORIZON_RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let json;
    try { json = JSON.parse(raw); } catch { fail('INVALID_HORIZON_JSON'); }
    return {json, digest:sha256(raw), bytes:size};
  } finally { clearTimeout(clock); ctrl.abort(); }
}
export async function fetchOfficialSnapshots({network, accountId, timeoutMs = 12000, fetchImpl = globalThis.fetch}) {
  if (!(network in OFFICIAL)) fail('INVALID_NETWORK');
  validateGAddress(accountId);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) fail('INVALID_TIMEOUT');
  if (typeof fetchImpl !== 'function') fail('INVALID_FETCH_IMPLEMENTATION');
  const origin = OFFICIAL[network];
  const [account, ledger] = await Promise.all([
    fetchBounded(origin + '/accounts/' + accountId, timeoutMs, fetchImpl),
    fetchBounded(origin + '/ledgers?order=desc&limit=1', timeoutMs, fetchImpl),
  ]);
  return {account:account.json,ledgerEnvelope:ledger.json,
    source:{mode:'live', account:{url:origin+'/accounts/'+accountId,...account, json:undefined},
      ledger:{url:origin+'/ledgers?order=desc&limit=1',...ledger,json:undefined}}};
}
const esc = x => String(x).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reportHtml(report) {
  const field = (k,v) => '<tr><th>' + esc(k) + '</th><td>' + esc(v ?? 'Not established') + '</td></tr>';
  const rows = [
    ['State',report.status],['Provenance',report.mode],['Observed',report.observedAt],['Network',report.network],
    ['Account',report.accountId],['Ledger',report.ledger.sequence],['Ledger close',report.ledger.closedAt],
    ['Reserve',report.account.minimumReserveXlm+' XLM'],['Spendable',report.account.availableXlm+' XLM'],
    ['Nominal fee headroom',report.account.nominalFeeFloorXlm+' XLM / '+report.account.expectedOperations+' ops'],
    ['Requested inbound amount',report.recipient.amountRequested],['Trustline authorization',report.recipient.authorization],
    ['Inbound capacity',report.recipient.inboundCapacity],['Action required',report.reasons.join(', ') || 'None observed'],
    ['Review notes',report.cautions.join(', ')],
  ].map(([k,v])=>field(k,v)).join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SF101 Stellar Merchant Account Readiness</title>'+
   '<style>body{font:15px/1.55 system-ui,sans-serif;margin:3rem auto;max-width:1000px;padding:0 1.5rem;color:#1c2630;background:#f8f9fa}h1{font-size:1.6rem}h2{font-size:1.05rem}table{border-collapse:collapse;width:100%;background:#fff}th,td{border-bottom:1px solid #d8dee3;padding:.7rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{width:29%;color:#4a5a67}small{color:#56636c}footer{margin-top:2rem}</style>'+
   '<h1>Merchant account readiness</h1><p>Stellar classic-account receiving and reserves, read-only operator report.</p><table>'+rows+'</table><footer><small>This is not an approval, contract/SAC transfer proof, payment receipt, fee quote or grant acceptance. Exact native Horizon state only; account and trustline state can change after retrieval.</small></footer></html>';
}
export function reportCsv(report) {
  const pairs = [['status',report.status],['mode',report.mode],['network',report.network],['account',report.accountId],
    ['observed_at',report.observedAt],['ledger_sequence',report.ledger.sequence],['minimum_reserve_xlm',report.account.minimumReserveXlm],
    ['spendable_xlm',report.account.availableXlm],['nominal_fee_floor_xlm',report.account.nominalFeeFloorXlm],
    ['requested_amount',report.recipient.amountRequested],['trustline_authorization',report.recipient.authorization],
    ['inbound_capacity',report.recipient.inboundCapacity],['reason_codes',report.reasons.join(';')],['cautions',report.cautions.join(';')]];
  const cell = value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  return 'field,value\n'+pairs.map(x=>x.map(cell).join(',')).join('\n')+'\n';
}

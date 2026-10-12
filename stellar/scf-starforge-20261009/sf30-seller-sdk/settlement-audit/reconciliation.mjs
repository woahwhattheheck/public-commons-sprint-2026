import {NativeSourceError, plain, textValue, sourceHash, stableJSON, normalizeNetwork} from './native-http.mjs';

export class SettlementError extends NativeSourceError {
  constructor(code, message, details = {}) { super(code, message, details); this.name = 'SettlementError'; }
}
const SCALE = 10000000n;
const MAX_NATIVE_AMOUNT = 9223372036854775807n;
const ROLES = ['authority', 'drivers', 'platform'];
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (code, message, details = {}) => { throw new SettlementError(code, message, details); };
const idText = (value, field) => textValue(value, field, 255);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function list(value, field) { if (!Array.isArray(value)) fail('INVALID_INPUT', field + ' must be an array.'); return value; }
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function fraction(n, d) { if (d <= 0n || n < 0n) fail('INVALID_RATIONAL', 'An allocation fraction must have a nonnegative numerator and positive denominator.'); const g = gcd(n, d); return [n / g, d / g]; }
function add(a, b) { return fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]); }
function multiply(a, b) { return fraction(a[0] * b[0], a[1] * b[1]); }
function decimal(value, field, maximumDecimals = 18) {
  if (typeof value !== 'string' || value.length > 96 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) fail('INVALID_DECIMAL', field + ' must be a nonnegative exact decimal string.', {field});
  const [whole, part = ''] = value.split('.');
  if (part.length > maximumDecimals) fail('INVALID_DECIMAL', field + ' has more decimal places than supported.', {field, maximumDecimals});
  return fraction(BigInt(whole + part), 10n ** BigInt(part.length));
}
function readRational(value, field, {positive = false} = {}) {
  let result;
  if (typeof value === 'string') result = decimal(value, field);
  else {
    plain(value, field);
    for (const key of ['numerator', 'denominator']) if (typeof value[key] !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value[key]) || value[key].length > 96) fail('INVALID_RATIONAL', field + '.' + key + ' must be an exact integer string.');
    result = fraction(BigInt(value.numerator), BigInt(value.denominator));
  }
  if (positive && result[0] === 0n) fail('INVALID_RATIONAL', field + ' must be positive.');
  return result;
}
function rationalJSON(value) { return {numerator: value[0].toString(), denominator: value[1].toString()}; }
export function parseStellarAmount(value, {allowZero = true} = {}) {
  const f = decimal(value, 'amount', 7);
  const units = f[0] * SCALE / f[1];
  if ((!allowZero && units === 0n) || units > MAX_NATIVE_AMOUNT) fail('INVALID_AMOUNT', 'The amount is outside the native Stellar payment range.');
  return units;
}
export function formatStellarAmount(value) {
  const amount = BigInt(value);
  if (amount < 0n) fail('INVALID_AMOUNT', 'A planned amount cannot be negative.');
  return (amount / SCALE).toString() + '.' + (amount % SCALE).toString().padStart(7, '0');
}
function decodeAccount(value, field = 'account', issuerOnly = false) {
  const text = textValue(value, field, 69);
  if (!/^(?:G[A-Z2-7]{55}|M[A-Z2-7]{68})$/.test(text) || (issuerOnly && text[0] !== 'G')) fail('INVALID_ACCOUNT', field + ' must be an original Stellar account StrKey.', {field});
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, word = 0; const bytes = [];
  for (const character of text) {
    word = (word << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((word >> bits) & 255); word &= (1 << bits) - 1; }
  }
  if (word !== 0 || bytes.length !== (text[0] === 'G' ? 35 : 43) || bytes[0] !== (text[0] === 'G' ? 48 : 96)) fail('INVALID_ACCOUNT', field + ' has invalid native StrKey framing.', {field});
  let crc = 0;
  for (const byte of bytes.slice(0, -2)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  if (bytes.at(-2) !== (crc & 255) || bytes.at(-1) !== (crc >> 8)) fail('INVALID_ACCOUNT', field + ' has an invalid native StrKey checksum.', {field});
  return text;
}
export function normalizeSettlementAsset(input) {
  plain(input, 'asset');
  let type = input.type ?? input.asset_type;
  const code = input.code ?? input.asset_code;
  const issuer = input.issuer ?? input.asset_issuer;
  if (!type && (!issuer && (code === 'XLM' || code === 'NATIVE'))) type = 'native';
  if (!type && code && issuer) type = String(code).length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
  if (type === 'native') {
    if (issuer) fail('INVALID_ASSET', 'The native asset has no issuer.');
    return {type: 'native'};
  }
  if (!['credit_alphanum4', 'credit_alphanum12'].includes(type) || typeof code !== 'string' || !/^[A-Za-z0-9]{1,12}$/.test(code)) fail('INVALID_ASSET', 'A credit asset requires its exact native type, code and issuer.');
  if ((type === 'credit_alphanum4') !== (code.length <= 4)) fail('INVALID_ASSET', 'The native asset type does not match its code length.');
  return {type, code, issuer: decodeAccount(issuer, 'asset.issuer', true)};
}
function strictBase64(value, bytes, field) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('INVALID_MEMO', field + ' is not canonical base64.');
  const body = Buffer.from(value, 'base64');
  if (body.toString('base64') !== value || (bytes !== null && body.length !== bytes)) fail('INVALID_MEMO', field + ' has an invalid native byte length.');
  return body;
}
export function normalizeSettlementMemo(input, {nativeEncoding = null} = {}) {
  if (input === undefined || input === null) return null;
  plain(input, 'memo');
  const type = input.type;
  if (type === 'none' || type === '') return {type: 'none'};
  if (type === 'text') {
    const body = input.bytesBase64 !== undefined ? strictBase64(input.bytesBase64, null, 'memo.bytesBase64') : Buffer.from(typeof input.value === 'string' ? input.value : fail('INVALID_MEMO', 'Text memo value must be a string.'), 'utf8');
    if (body.length > 28) fail('INVALID_MEMO', 'A native text memo is at most 28 bytes.');
    return {type, value: typeof input.value === 'string' ? input.value : body.toString('utf8'), bytesBase64: body.toString('base64')};
  }
  if (type === 'id') {
    if (typeof input.value !== 'string' || !/^\d+$/.test(input.value) || input.value.length > 20 || BigInt(input.value) > 18446744073709551615n) fail('INVALID_MEMO', 'A native memo ID must be a uint64 decimal string.');
    return {type, value: BigInt(input.value).toString()};
  }
  if (type === 'hash' || type === 'return') {
    const encoding = nativeEncoding ?? input.encoding ?? (/^[0-9a-fA-F]{64}$/.test(input.value || '') ? 'hex' : 'base64');
    let body;
    if (encoding === 'hex') {
      if (typeof input.value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(input.value)) fail('INVALID_MEMO', 'A native hash memo requires 32 original bytes.');
      body = Buffer.from(input.value, 'hex');
    } else if (encoding === 'base64') body = strictBase64(input.value, 32, 'memo.value');
    else fail('INVALID_MEMO', 'Hash memo encoding must be hex or base64.');
    return {type, value: body.toString('base64'), encoding: 'base64'};
  }
  fail('INVALID_MEMO', 'Unknown native memo type.');
}
export function settlementLegKey(leg) { return stableJSON([leg.phase, leg.role, leg.participantId ?? null]); }
const assetKey = value => value ? stableJSON(value) : null;
function memoKey(value) {
  if (!value) return null;
  return value.type === 'text' ? 'text:' + value.bytesBase64 : value.type + ':' + (value.value ?? '');
}
function weightedAllocate(total, items) {
  if (!items.length) return new Map();
  const sum = items.reduce((a, item) => add(a, item.weight), [0n, 1n]);
  if (sum[0] === 0n) return new Map(items.map(item => [item.key, 0n]));
  let assigned = 0n;
  const rows = items.map((item, index) => {
    const numerator = total * item.weight[0] * sum[1], denominator = item.weight[1] * sum[0];
    const units = numerator / denominator;
    assigned += units;
    return {...item, index, units, remainder: numerator % denominator, denominator};
  });
  rows.sort((a, b) => {
    const x = a.remainder * b.denominator, y = b.remainder * a.denominator;
    return x === y ? (a.order ?? a.index) - (b.order ?? b.index) || cmp(a.key, b.key) : x > y ? -1 : 1;
  });
  const left = total - assigned;
  if (left > BigInt(rows.length)) fail('ALLOCATION_ERROR', 'The exact native rounding remainder is inconsistent.');
  for (let i = 0; i < Number(left); i++) rows[i].units++;
  return new Map(rows.map(row => [row.key, row.units]));
}

export const PATHPULSE_REFERENCE_POLICY = Object.freeze({
  name: 'PathPulse detailed revenue split',
  shares: {authority: {numerator: '1', denominator: '2'}, drivers: {numerator: '3', denominator: '10'}, platform: {numerator: '1', denominator: '5'}},
  tiers: {SCOUT1: {multiplier: {numerator: '1', denominator: '1'}}, SCOUT2: {multiplier: {numerator: '6', denominator: '5'}}, SCOUT3: {multiplier: {numerator: '3', denominator: '2'}}},
  remainderOrder: ['authority', 'drivers', 'platform'],
  provenance: [
    {url: 'https://communityfund.stellar.org/submissions/recF5sl3yx3vT971T', section: 'Revenue Model and Deliverable 6', observedAt: '2026-10-12'},
    {url: 'https://drive.google.com/file/d/19jmuAuX8keASZrlZ0I1DmZ2DUj29NrZD/view', title: 'Technical Architecture.pdf', modifiedAt: '2026-06-15'},
  ],
});
export function normalizeSettlementPolicy(input) {
  plain(input, 'policy');
  const shares = plain(input.shares, 'shares');
  if (Object.keys(shares).some(key => !ROLES.includes(key))) fail('INVALID_POLICY', 'Use explicit authority, drivers, and platform shares.');
  const selectedShares = Object.fromEntries(ROLES.map(role => [role, readRational(shares[role], 'shares.' + role)]));
  const total = ROLES.reduce((sum, role) => add(sum, selectedShares[role]), [0n, 1n]);
  if (total[0] !== total[1]) fail('INVALID_POLICY', 'The named revenue shares must sum to exactly one.');
  const tiers = {};
  for (const [name, value] of Object.entries(plain(input.tiers || {}, 'tiers'))) {
    idText(name, 'tier name'); plain(value, 'tier');
    const tier = {multiplier: rationalJSON(readRational(value.multiplier, 'tiers.' + name + '.multiplier', {positive: true}))};
    if (value.asset !== undefined) {
      const asset = normalizeSettlementAsset(value.asset);
      if (asset.type === 'native') fail('INVALID_POLICY', 'A reputation tier must name its exact issuer and asset code.');
      tier.asset = {code: asset.code, issuer: asset.issuer};
    }
    tiers[name] = tier;
  }
  const remainderOrder = input.remainderOrder === undefined ? [...ROLES] : [...list(input.remainderOrder, 'remainderOrder')];
  if (remainderOrder.length !== 3 || new Set(remainderOrder).size !== 3 || remainderOrder.some(role => !ROLES.includes(role))) fail('INVALID_POLICY', 'remainderOrder must contain each named revenue role once.');
  return {schema: 'stellar-forge.settlement-policy.v1', name: textValue(input.name, 'policy.name', 1024),
    shares: Object.fromEntries(ROLES.map(role => [role, rationalJSON(selectedShares[role])])), tiers, remainderOrder,
    splitMode: input.splitMode === undefined ? 'atomic' : ['atomic', 'independent'].includes(input.splitMode) ? input.splitMode : fail('INVALID_POLICY', 'splitMode must be atomic or independent'),
    provenance: clone(list(input.provenance || [], 'provenance'))};
}
function uniqueRows(values, field) {
  const seen = new Set();
  for (const row of values) { plain(row, field); idText(row.id, field + '.id'); if (seen.has(row.id)) fail('DUPLICATE_ID', field + ' IDs must be unique.', {id: row.id}); seen.add(row.id); }
}
function references(values) {
  const all = values.flat(Infinity).filter(value => value && typeof value === 'object');
  return [...new Map(all.map(value => [stableJSON(value), clone(value)])).values()];
}
export function planSettlement(input) {
  plain(input, 'settlement plan');
  const id = idText(input.id, 'plan.id');
  const policyRef = plain(input.policy, 'policy');
  const definition = normalizeSettlementPolicy(policyRef.definition);
  idText(policyRef.id, 'policy.id');
  if (!Number.isSafeInteger(policyRef.version) || policyRef.version < 1 || typeof policyRef.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(policyRef.sha256)) fail('INVALID_POLICY_REFERENCE', 'Select an exact retained policy ID, version and SHA256.');
  const rawRevenue = plain(input.revenue, 'revenue');
  const revenue = {...clone(rawRevenue), id: idText(rawRevenue.id, 'revenue.id'), network: normalizeNetwork(rawRevenue.network),
    asset: normalizeSettlementAsset(rawRevenue.asset), amount: formatStellarAmount(parseStellarAmount(rawRevenue.amount, {allowZero: false})),
    treasuryAccount: decodeAccount(rawRevenue.treasuryAccount, 'revenue.treasuryAccount')};
  if (rawRevenue.fromAccount !== undefined) revenue.fromAccount = decodeAccount(rawRevenue.fromAccount, 'revenue.fromAccount');
  if (rawRevenue.memo !== undefined) revenue.memo = normalizeSettlementMemo(rawRevenue.memo);
  const gross = parseStellarAmount(revenue.amount);
  const participants = clone(list(input.participants, 'participants'));
  uniqueRows(participants, 'participants');
  const participantMap = new Map();
  for (const row of participants) {
    if (!['authority', 'driver_pool', 'platform', 'driver'].includes(row.role)) fail('INVALID_PARTICIPANT', 'Unknown settlement participant role.', {participantId: row.id});
    row.account = decodeAccount(row.account, 'participant.account');
    if (row.partnerId !== undefined) idText(row.partnerId, 'participant.partnerId');
    if (row.label !== undefined) textValue(row.label, 'participant.label', 2048);
    if (row.memo !== undefined) row.memo = normalizeSettlementMemo(row.memo);
    if (row.settlement !== undefined && !['transfer', 'retain'].includes(row.settlement)) fail('INVALID_PARTICIPANT', 'Participant settlement must be transfer or retain.');
    row.settlement ??= 'transfer';
    if (row.settlement === 'retain' && (row.role !== 'platform' || row.account !== revenue.treasuryAccount)) fail('INVALID_PARTICIPANT', 'Retaining a share requires a platform participant at the selected treasury account.');
    if (row.role === 'authority' || row.role === 'platform') row.weight = rationalJSON(readRational(row.weight ?? {numerator: '1', denominator: '1'}, 'participant.weight', {positive: true}));
    participantMap.set(row.id, row);
  }
  const pools = participants.filter(row => row.role === 'driver_pool');
  if (pools.length !== 1) fail('INVALID_PARTICIPANTS', 'Select exactly one original driver reward pool account.');
  const pool = pools[0];
  if (pool.settlement !== 'transfer') fail('INVALID_PARTICIPANT', 'The driver pool share is an explicit split transfer.');
  for (const role of ['authority', 'platform']) if (readRational(definition.shares[role], role)[0] > 0n && !participants.some(row => row.role === role)) fail('INVALID_PARTICIPANTS', 'A positive share requires at least one recipient for ' + role + '.');
  const contributions = clone(list(input.contributions || [], 'contributions'));
  uniqueRows(contributions, 'contributions');
  const weights = new Map();
  const diagnostics = [];
  for (const contribution of contributions) {
    const participant = participantMap.get(contribution.participantId);
    if (!participant || participant.role !== 'driver') fail('INVALID_CONTRIBUTION', 'A contribution must select an original driver participant.', {contributionId: contribution.id});
    if (typeof contribution.approved !== 'boolean') fail('INVALID_CONTRIBUTION', 'A contribution must retain its explicit approval decision.', {contributionId: contribution.id});
    const units = decimal(contribution.units, 'contribution.units');
    const tier = definition.tiers[contribution.tier];
    if (!tier) fail('INVALID_CONTRIBUTION', 'The contribution tier is absent from the selected policy.', {contributionId: contribution.id, tier: contribution.tier});
    if (!contribution.approved) { diagnostics.push({code: 'UNAPPROVED_CONTRIBUTION', contributionId: contribution.id, participantId: participant.id}); continue; }
    const weight = multiply(units, readRational(tier.multiplier, 'tier.multiplier'));
    weights.set(participant.id, add(weights.get(participant.id) || [0n, 1n], weight));
  }
  const split = weightedAllocate(gross, definition.remainderOrder.map((role, order) => ({key: role, weight: readRational(definition.shares[role], role), order})));
  const authority = split.get('authority'), driverPool = split.get('drivers'), platform = split.get('platform');
  const sourceRefs = references([revenue.sourceRef, participants.map(row => row.sourceRef), contributions.map(row => row.sourceRef), definition.provenance]);
  const legs = [];
  function addLeg(phase, role, participant, units, fromAccount, refs, settlement = 'transfer') {
    if (units > MAX_NATIVE_AMOUNT) fail('INVALID_AMOUNT', 'A planned leg exceeds the native Stellar payment range.');
    const leg = {id: phase + ':' + role + (participant ? ':' + participant.id : ''), phase, role,
      ...(participant ? {participantId: participant.id} : {}), ...(participant?.partnerId ? {partnerId: participant.partnerId} : {}), ...(participant?.receiverId ? {receiverId: participant.receiverId} : {}),
      ...(fromAccount ? {fromAccount} : {}), toAccount: participant?.account || revenue.treasuryAccount,
      asset: clone(revenue.asset), amount: formatStellarAmount(units), provider: phase === 'payout' ? 'sdp' : 'horizon', settlement,
      sourceRefs: references(refs)};
    const memo = participant?.memo ?? (phase === 'revenue' ? revenue.memo : null);
    if (memo) leg.memo = clone(memo);
    leg.comparisonKey = settlementLegKey(leg);
    legs.push(leg);
  }
  addLeg('revenue', 'revenue', null, gross, revenue.fromAccount, [revenue.sourceRef]);
  for (const role of ['authority', 'platform']) {
    const recipients = participants.filter(row => row.role === role).sort((a, b) => cmp(a.id, b.id));
    const allocation = weightedAllocate(split.get(role), recipients.map((row, order) => ({key: row.id, weight: readRational(row.weight, 'weight'), order})));
    for (const participant of recipients) addLeg('split', role, participant, allocation.get(participant.id), revenue.treasuryAccount, [revenue.sourceRef, participant.sourceRef], participant.settlement);
  }
  addLeg('split', 'driver_pool', pool, driverPool, revenue.treasuryAccount, [revenue.sourceRef, pool.sourceRef]);
  const drivers = participants.filter(row => row.role === 'driver').sort((a, b) => cmp(a.id, b.id));
  const eligible = drivers.filter(row => (weights.get(row.id)?.[0] || 0n) > 0n);
  const payout = weightedAllocate(driverPool, eligible.map((row, order) => ({key: row.id, weight: weights.get(row.id), order})));
  let paid = 0n;
  for (const driver of drivers) {
    const units = payout.get(driver.id) || 0n; paid += units;
    addLeg('payout', 'driver', driver, units, pool.account, [pool.sourceRef, driver.sourceRef, contributions.filter(row => row.participantId === driver.id && row.approved).map(row => row.sourceRef)]);
  }
  if (!eligible.length && driverPool > 0n) diagnostics.push({code: 'UNALLOCATED_DRIVER_POOL', amount: formatStellarAmount(driverPool), message: 'The driver pool remains unallocated until original approved contribution weights are selected.'});
  const assignments = clone(list(input.assignments || [], 'assignments'));
  for (const assignment of assignments) { plain(assignment, 'assignment'); if (!legs.some(leg => leg.id === assignment.legId)) fail('INVALID_ASSIGNMENT', 'The assignment references an unknown planned leg.', {legId: assignment.legId}); }
  return {schema: 'stellar-forge.settlement-plan.v1', id, policy: {id: policyRef.id, version: policyRef.version, sha256: policyRef.sha256},
    revenue, participants, contributions, assignments, requirements: {atomicSplit: definition.splitMode === 'atomic', driverProvider: 'sdp'}, totals: {grossAmount: formatStellarAmount(gross), authorityAmount: formatStellarAmount(authority),
      driverPoolAmount: formatStellarAmount(driverPool), platformAmount: formatStellarAmount(platform), driverPayoutAmount: formatStellarAmount(paid),
      unallocatedDriverAmount: formatStellarAmount(driverPool - paid)},
    legs, sourceRefs, diagnostics};
}

function optional(read, issues, field) {
  try { return read(); } catch (error) { issues.push({code: error.code || 'INVALID_NATIVE_FIELD', field, message: error.message}); return null; }
}
function nativeTime(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null; }
function nativeHash(value) { return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null; }
function nativeLedger(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function nativeMemo(value, provider, issues) {
  const type = provider === 'sdp' ? value?.stellar_memo_type : value?.memo_type;
  if (type === undefined || type === null || type === '') return null;
  const body = provider === 'sdp' ? value.stellar_memo : value.memo;
  const input = {type, value: body ?? ''};
  if (provider === 'horizon' && type === 'text' && typeof value.memo_bytes === 'string') input.bytesBase64 = value.memo_bytes;
  return optional(() => normalizeSettlementMemo(input, {nativeEncoding: provider === 'sdp' ? 'hex' : 'base64'}), issues, 'memo');
}
function projectSDP(kind, record, network) {
  const issues = [];
  const result = {category: 'other', network, status: typeof record.status === 'string' ? record.status : null,
    updatedAt: nativeTime(record.updated_at), createdAt: nativeTime(record.created_at), issues};
  if (kind === 'payment' || kind === 'payments') {
    const wallet = record.receiver_wallet;
    Object.assign(result, {category: 'payment',
      amount: optional(() => formatStellarAmount(parseStellarAmount(record.amount)), issues, 'amount'),
      asset: optional(() => normalizeSettlementAsset(record.asset), issues, 'asset'),
      fromAccount: record.sender_address ? optional(() => decodeAccount(record.sender_address), issues, 'sender_address') : null,
      toAccount: wallet?.stellar_address ? optional(() => decodeAccount(wallet.stellar_address), issues, 'receiver_wallet.stellar_address') : null,
      memo: nativeMemo(wallet, 'sdp', issues), transactionHash: nativeHash(record.stellar_transaction_id),
      operationId: typeof record.stellar_operation_id === 'string' && /^\d+$/.test(record.stellar_operation_id) ? record.stellar_operation_id : null,
      sourceWalletId: typeof record.source_wallet_id === 'string' ? record.source_wallet_id : null,
      disbursementId: typeof record.disbursement?.id === 'string' ? record.disbursement.id : null,
      receiverId: typeof wallet?.receiver?.id === 'string' ? wallet.receiver.id : null,
      receiverWalletId: typeof wallet?.id === 'string' ? wallet.id : null,
      receiverStatus: typeof wallet?.status === 'string' ? wallet.status : null,
      externalPaymentId: typeof record.external_payment_id === 'string' ? record.external_payment_id : null,
      statusHistory: Array.isArray(record.status_history) ? clone(record.status_history) : [],
      circleTransactionId: typeof record.circle_transaction_id === 'string' ? record.circle_transaction_id : null,
      paymentType: typeof record.type === 'string' ? record.type : null, ledger: null});
    if (record.stellar_transaction_id && !result.transactionHash) issues.push({code: 'INVALID_TRANSACTION_HASH', field: 'stellar_transaction_id'});
  } else if (kind === 'disbursement' || kind === 'disbursements') {
    Object.assign(result, {category: 'disbursement', sourceWalletId: record.source_wallet_id || null,
      asset: record.asset ? optional(() => normalizeSettlementAsset(record.asset), issues, 'asset') : null,
      statusHistory: Array.isArray(record.status_history) ? clone(record.status_history) : []});
  } else if (kind === 'distributionWallet' || kind === 'distributionWallets') {
    Object.assign(result, {category: 'distributionWallet',
      account: record.distribution_account_address ? optional(() => decodeAccount(record.distribution_account_address), issues, 'distribution_account_address') : null,
      accountType: record.distribution_account_type || null, accountStatus: record.distribution_account_status || null});
  } else if (kind === 'receiver' || kind === 'receivers' || kind === 'disbursementReceivers') {
    Object.assign(result, {category: 'participant', receiverId: record.id || record.receiver?.id || null});
  } else if (kind === 'assets') {
    Object.assign(result, {category: 'asset', asset: optional(() => normalizeSettlementAsset(record), issues, 'asset')});
  }
  return result;
}
function projectHorizon(kind, record, network) {
  const issues = [];
  const transaction = record.transaction && typeof record.transaction === 'object' && !Array.isArray(record.transaction) ? record.transaction : null;
  const result = {category: 'other', network,
    status: record.transaction_successful === true || (kind === 'transaction' || kind === 'transactions') && record.successful === true ? 'SUCCESS' :
      record.transaction_successful === false || (kind === 'transaction' || kind === 'transactions') && record.successful === false ? 'FAILED' : null,
    ledger: nativeLedger(record.ledger) ?? nativeLedger(transaction?.ledger), createdAt: nativeTime(record.created_at), updatedAt: null, issues};
  if (kind === 'root') return {...result, category: 'network', network: typeof record.network_passphrase === 'string' ? record.network_passphrase : network,
    historyLatestLedger: nativeLedger(record.history_latest_ledger), historyElderLedger: nativeLedger(record.history_elder_ledger)};
  if (kind === 'account') return {...result, category: 'account', account: record.account_id || record.id || null,
    lastModifiedLedger: nativeLedger(record.last_modified_ledger), balances: Array.isArray(record.balances) ? clone(record.balances) : [], flags: clone(record.flags || {})};
  if (kind === 'ledger') return {...result, category: 'ledger', ledger: nativeLedger(record.sequence), closedAt: nativeTime(record.closed_at)};
  if (kind === 'transaction' || kind === 'transactions') {
    return {...result, category: 'transaction', transactionHash: nativeHash(record.hash ?? record.id),
      memo: nativeMemo(record, 'horizon', issues), sourceAccount: record.source_account || null,
      operationCount: Number.isSafeInteger(record.operation_count) ? record.operation_count : null};
  }
  Object.assign(result, {category: 'operation', nativeType: record.type || null,
    operationId: typeof record.id === 'string' ? record.id : null, transactionHash: nativeHash(record.transaction_hash),
    memo: transaction ? nativeMemo(transaction, 'horizon', issues) : null});
  if (transaction) {
    if (nativeHash(transaction.hash ?? transaction.id) !== result.transactionHash) issues.push({code: 'TRANSACTION_JOIN_MISMATCH', field: 'transaction.hash'});
    if (typeof transaction.successful === 'boolean' && typeof record.transaction_successful === 'boolean' && transaction.successful !== record.transaction_successful) issues.push({code: 'TRANSACTION_STATUS_MISMATCH', field: 'transaction.successful'});
  }
  if (['payment', 'path_payment_strict_receive', 'path_payment_strict_send'].includes(record.type)) {
    Object.assign(result, {category: 'payment',
      fromAccount: optional(() => decodeAccount(record.from_muxed ?? record.from ?? record.source_account_muxed ?? record.source_account), issues, 'from'),
      fromBaseAccount: typeof record.from === 'string' ? record.from : null,
      toAccount: optional(() => decodeAccount(record.to_muxed ?? record.to), issues, 'to'),
      toBaseAccount: typeof record.to === 'string' ? record.to : null,
      amount: optional(() => formatStellarAmount(parseStellarAmount(record.amount)), issues, 'amount'),
      asset: optional(() => normalizeSettlementAsset({type: record.asset_type, code: record.asset_code, issuer: record.asset_issuer}), issues, 'asset')});
    if (record.type !== 'payment') {
      result.sourceAmount = optional(() => formatStellarAmount(parseStellarAmount(record.source_amount)), issues, 'source_amount');
      result.sourceAsset = optional(() => normalizeSettlementAsset({type: record.source_asset_type, code: record.source_asset_code, issuer: record.source_asset_issuer}), issues, 'source_asset');
    }
  } else if (record.type === 'create_account') {
    Object.assign(result, {category: 'payment', nativeType: 'create_account',
      fromAccount: optional(() => decodeAccount(record.funder), issues, 'funder'),
      toAccount: optional(() => decodeAccount(record.account), issues, 'account'), asset: {type: 'native'},
      amount: optional(() => formatStellarAmount(parseStellarAmount(record.starting_balance)), issues, 'starting_balance')});
  } else if (record.type === 'clawback') {
    Object.assign(result, {category: 'clawback',
      fromAccount: optional(() => decodeAccount(record.from_muxed ?? record.from), issues, 'from'),
      amount: optional(() => formatStellarAmount(parseStellarAmount(record.amount)), issues, 'amount'),
      asset: optional(() => normalizeSettlementAsset({type: record.asset_type, code: record.asset_code, issuer: record.asset_issuer}), issues, 'asset')});
  }
  return result;
}

export function normalizeProviderRecords({provider, kind, records, sourceId, captureId = null, sourceScope = null, observedAt, network = null}) {
  if (!['sdp', 'horizon'].includes(provider)) fail('INVALID_PROVIDER', 'Select the original SDP or Horizon provider.');
  idText(kind, 'kind'); idText(sourceId, 'sourceId');
  if (captureId !== null) idText(captureId, 'captureId');
  if (sourceScope !== null) idText(sourceScope, 'sourceScope');
  if (!nativeTime(observedAt)) fail('INVALID_OBSERVATION_TIME', 'Retain the native response observation timestamp.');
  const selectedNetwork = network === null ? null : normalizeNetwork(network);
  return list(records, 'records').map((original, index) => {
    plain(original, 'native record');
    const content = clone(original);
    const sha256 = sourceHash(content);
    const id = typeof content.id === 'string' ? content.id : typeof content.hash === 'string' ? content.hash :
      kind === 'root' ? 'root' : kind === 'organization' ? 'organization' : 'source-' + sha256;
    const projection = provider === 'sdp' ? projectSDP(kind, content, selectedNetwork) : projectHorizon(kind, content, selectedNetwork);
    const recordRef = {provider, kind, recordId: id, sourceId, captureId, index, sha256};
    return {provider, kind, id, sourceId, captureId, sourceScope: sourceScope || sourceId, network: selectedNetwork,
      recordRef, observedAt, original: content, projection};
  });
}

function referenceMatches(ref, row) {
  if (!ref || typeof ref !== 'object') return false;
  const id = ref.recordId ?? ref.id;
  if (id !== undefined && id !== row.id) return false;
  for (const key of ['provider', 'kind', 'sourceId', 'captureId', 'sourceScope']) if (ref[key] !== undefined && ref[key] !== null && ref[key] !== row[key]) return false;
  if (ref.sha256 !== undefined && ref.sha256 !== row.recordRef.sha256) return false;
  if (ref.index !== undefined && ref.index !== row.recordRef.index) return false;
  return id !== undefined || ref.sourceId !== undefined || ref.sha256 !== undefined;
}
const entityReference = entity => references(entity.rows.map(row => row.recordRef));
const PAYMENT_FIELDS = ['category', 'nativeType', 'status', 'amount', 'asset', 'fromAccount', 'toAccount', 'transactionHash', 'operationId', 'memo', 'ledger', 'sourceWalletId', 'sourceAmount', 'sourceAsset'];
function financialValue(key, value) { return key === 'memo' ? memoKey(value) : key === 'asset' || key === 'sourceAsset' ? assetKey(value) : value; }
function mergeProjection(projections) {
  const merged = {}; const conflicts = [];
  for (const projection of projections) {
    for (const [key, value] of Object.entries(projection)) {
      if (value === null || value === undefined) continue;
      if (PAYMENT_FIELDS.includes(key) && merged[key] !== undefined && financialValue(key, merged[key]) !== financialValue(key, value)) conflicts.push({field: key});
      if (merged[key] === undefined || key === 'issues') merged[key] = key === 'issues' ? [...(merged[key] || []), ...value] : clone(value);
    }
  }
  return {projection: merged, conflicts};
}
function entityKey(row) {
  const p = row.projection;
  const scope = row.provider === 'horizon' ? p.network ?? row.sourceScope : row.sourceScope;
  const category = row.provider === 'horizon' && ['payments', 'operations', 'operation'].includes(row.kind) ? 'operation' : p.category;
  return stableJSON([row.provider, scope, category, row.id]);
}
function prepareEntities(records, network, asOf, exclusions) {
  const normalized = [];
  const excludedRecords = [];
  for (const row of list(records, 'records')) {
    plain(row, 'normalized record');
    const rebuilt = normalizeProviderRecords({provider: row.provider, kind: row.kind, records: [row.original],
      sourceId: row.sourceId, captureId: row.captureId ?? null, sourceScope: row.sourceScope ?? row.sourceId,
      observedAt: row.observedAt, network: row.network ?? row.projection?.network ?? null})[0];
    if (row.recordRef?.sha256 && row.recordRef.sha256 !== rebuilt.recordRef.sha256) fail('SOURCE_RECORD_CHANGED', 'A normalized record no longer matches its retained original JSON.', {sourceId: row.sourceId, recordId: row.id});
    if (row.id !== undefined && row.id !== rebuilt.id) fail('SOURCE_RECORD_CHANGED', 'A normalized record ID differs from its original native record.');
    if (Number.isSafeInteger(row.recordRef?.index) && row.recordRef.index >= 0) rebuilt.recordRef.index = row.recordRef.index;
    if (asOf && Date.parse(rebuilt.observedAt) > Date.parse(asOf)) { excludedRecords.push({recordRef: rebuilt.recordRef, reason: 'OBSERVED_AFTER_AS_OF'}); continue; }
    if (rebuilt.projection.network !== network) { excludedRecords.push({recordRef: rebuilt.recordRef, reason: rebuilt.projection.network === null ? 'NETWORK_NOT_SELECTED' : 'OTHER_NETWORK'}); continue; }
    normalized.push(rebuilt);
  }
  const groups = new Map();
  for (const row of normalized) { const key = entityKey(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  const entities = [];
  for (const [key, rows] of groups) {
    const excludedBy = exclusions.filter(correction => rows.some(row => referenceMatches(correction.recordRef, row)));
    if (excludedBy.length) { for (const row of rows) excludedRecords.push({recordRef: row.recordRef, reason: 'OPERATOR_EXCLUSION', correctionIds: excludedBy.map(x => x.id)}); continue; }
    let selected = rows;
    if (rows[0].provider === 'sdp') {
      const stamp = row => Date.parse(row.projection.updatedAt || row.observedAt);
      const latest = Math.max(...rows.map(stamp));
      selected = rows.filter(row => stamp(row) === latest);
    }
    selected = [...selected].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || cmp(a.recordRef.sha256, b.recordRef.sha256));
    const merged = mergeProjection(selected.map(row => row.projection));
    entities.push({key, provider: rows[0].provider, id: rows[0].id, sourceScope: rows[0].sourceScope,
      rows, selectedRows: selected, projection: merged.projection, conflicts: merged.conflicts});
  }
  // An original independently captured transaction can supply the ledger and
  // memo omitted from an operation page. It cannot replace contradictory bytes.
  const transactions = entities.filter(e => e.provider === 'horizon' && e.projection.category === 'transaction');
  for (const entity of entities.filter(e => e.provider === 'horizon' && e.projection.category === 'payment')) {
    const matches = transactions.filter(tx => tx.projection.transactionHash && tx.projection.transactionHash === entity.projection.transactionHash);
    for (const tx of matches) {
      for (const field of ['status', 'ledger', 'memo']) {
        const value = tx.projection[field];
        if (value === undefined || value === null) continue;
        if (entity.projection[field] !== undefined && entity.projection[field] !== null && financialValue(field, entity.projection[field]) !== financialValue(field, value)) entity.conflicts.push({field: 'transaction.' + field});
        else entity.projection[field] = clone(value);
      }
      entity.transactionRows = [...(entity.transactionRows || []), ...tx.rows];
      if (tx.conflicts.length) entity.conflicts.push({field: 'transaction'});
    }
  }
  const wallets = entities.filter(e => e.provider === 'sdp' && e.projection.category === 'distributionWallet');
  for (const entity of entities.filter(e => e.provider === 'sdp' && e.projection.category === 'payment' && !e.projection.fromAccount && e.projection.sourceWalletId)) {
    const matches = wallets.filter(wallet => wallet.sourceScope === entity.sourceScope && wallet.id === entity.projection.sourceWalletId && wallet.projection.account && !wallet.conflicts.length);
    if (matches.length === 1) {
      entity.projection.fromAccount = matches[0].projection.account;
      entity.walletRows = matches[0].rows;
    }
  }
  return {entities, excludedRecords};
}
function meaningfulReferences(entity) {
  return references([...entity.rows, ...(entity.transactionRows || []), ...(entity.walletRows || [])].map(row => row.recordRef));
}
function relationFields(leg, projection, {amount = true, native = false} = {}) {
  const mismatch = [], missing = [];
  for (const field of ['toAccount', 'asset', ...(leg.fromAccount ? ['fromAccount'] : []), ...(leg.memo ? ['memo'] : []), ...(amount ? ['amount'] : [])]) {
    const actual = projection[field], expected = leg[field];
    if (actual === undefined || actual === null) { missing.push(field); continue; }
    const same = field === 'asset' ? assetKey(actual) === assetKey(expected) :
      field === 'memo' ? memoKey(actual) === memoKey(expected) :
      field === 'fromAccount' && leg.fromAccount?.startsWith('G') && projection.fromBaseAccount === leg.fromAccount ? true : actual === expected;
    if (!same) mismatch.push(field);
  }
  if (native && leg.phase !== 'revenue') {
    if (projection.sourceAsset && assetKey(projection.sourceAsset) !== assetKey(leg.asset)) mismatch.push('sourceAsset');
    if (projection.sourceAmount && projection.sourceAmount !== projection.amount) mismatch.push('sourceAmount');
  }
  return {mismatch, missing};
}
function automaticCandidates(entities, leg, provider) {
  return entities.filter(entity => entity.provider === provider && entity.projection.category === 'payment').filter(entity => {
    const p = entity.projection;
    const fields = relationFields(leg, p);
    // A native sender missing from an older SDP version can be corroborated
    // by its exact Horizon operation; a missing receiver cannot be guessed.
    const allowedMissing = provider === 'sdp' ? ['fromAccount', 'memo'] : ['memo'];
    return !fields.mismatch.length && fields.missing.every(field => allowedMissing.includes(field));
  });
}
function findAssignment(assignment, entities, legId) {
  plain(assignment, 'assignment');
  if (assignment.legId !== legId) return null;
  if (!['sdp', 'horizon'].includes(assignment.provider)) fail('INVALID_ASSIGNMENT', 'An assignment must select its original provider.');
  idText(assignment.kind, 'assignment.kind'); idText(assignment.recordId, 'assignment.recordId');
  const found = entities.filter(entity => entity.rows.some(row => referenceMatches(assignment, row)));
  return {assignment, found};
}
function nativePairMatches(payment, operation) {
  const p = payment.projection, h = operation.projection;
  if (!p.transactionHash || h.transactionHash !== p.transactionHash) return false;
  if (p.operationId && h.operationId !== p.operationId) return false;
  for (const key of ['amount', 'asset', 'toAccount', 'fromAccount', 'memo']) {
    if (p[key] === null || p[key] === undefined) continue;
    if (key === 'fromAccount' && p.fromAccount?.startsWith('G') && h.fromBaseAccount === p.fromAccount) continue;
    if (h[key] === null || h[key] === undefined) continue;
    if (financialValue(key, p[key]) !== financialValue(key, h[key])) return false;
  }
  return true;
}
function sumAmounts(entities) {
  return entities.reduce((sum, entity) => entity.projection.amount === undefined || entity.projection.amount === null ? sum : sum + parseStellarAmount(entity.projection.amount), 0n);
}
function matchJSON(horizon, payments = []) {
  const original = horizon || payments[0];
  return {amount: original.projection.amount || null, transactionHash: horizon?.projection.transactionHash || payments[0]?.projection.transactionHash || null,
    operationId: horizon?.projection.operationId || payments[0]?.projection.operationId || null, ledger: horizon?.projection.ledger ?? null,
    nativeStatus: horizon?.projection.status || null, paymentStatuses: payments.map(p => ({paymentId: p.id, sourceScope: p.sourceScope, status: p.projection.status || null})),
    recordRefs: references([horizon ? meaningfulReferences(horizon) : [], payments.map(meaningfulReferences)])};
}

export function reconcileSettlement({plan, records, assignments = [], corrections = [], asOf = null}) {
  plain(plan, 'plan');
  if (plan.schema !== 'stellar-forge.settlement-plan.v1') fail('INVALID_PLAN', 'Use a retained native settlement plan.');
  const expectedNetwork = normalizeNetwork(plan.revenue.network);
  const originalLegs = list(plan.legs, 'plan.legs');
  uniqueRows(originalLegs, 'plan.legs');
  const expectedAsset = assetKey(normalizeSettlementAsset(plan.revenue.asset));
  for (const leg of originalLegs) {
    if (!['revenue', 'split', 'payout'].includes(leg.phase) || assetKey(normalizeSettlementAsset(leg.asset)) !== expectedAsset) fail('INVALID_PLAN', 'The plan contains an invalid phase or mismatched asset.');
    parseStellarAmount(leg.amount); decodeAccount(leg.toAccount);
    if (leg.fromAccount) decodeAccount(leg.fromAccount);
    if (leg.memo) normalizeSettlementMemo(leg.memo);
  }
  if (asOf !== null && !nativeTime(asOf)) fail('INVALID_OBSERVATION_TIME', 'asOf must be an original ISO observation time.');
  const appliedCorrections = clone(list(corrections, 'corrections'));
  uniqueRows(appliedCorrections, 'corrections');
  let effectiveAssignments = [...clone(list(plan.assignments || [], 'plan.assignments')), ...clone(list(assignments, 'assignments'))];
  for (const correction of appliedCorrections) {
    if (!['assign', 'exclude', 'note'].includes(correction.kind)) fail('INVALID_CORRECTION', 'Unknown settlement correction kind.');
    textValue(correction.reason, 'correction.reason', 8192);
    if (!nativeTime(correction.createdAt)) fail('INVALID_CORRECTION', 'Retain the correction timestamp.');
    if (correction.kind === 'assign') {
      const assignment = plain(correction.assignment, 'correction.assignment');
      if (!originalLegs.some(leg => leg.id === assignment.legId)) fail('INVALID_CORRECTION', 'The correction references an unknown planned leg.');
      // A new assignment correction replaces the selected provider side of
      // this leg. The previous assignment remains in the immutable journal.
      effectiveAssignments = effectiveAssignments.filter(item => item.legId !== assignment.legId || item.provider !== assignment.provider);
      effectiveAssignments.push(clone(assignment));
    } else if (correction.kind === 'exclude') {
      plain(correction.recordRef, 'correction.recordRef');
      if (!(correction.recordRef.recordId || correction.recordRef.id || correction.recordRef.sourceId || correction.recordRef.sha256)) fail('INVALID_CORRECTION', 'An exclusion must identify an original retained record.');
    } else if (correction.note !== undefined) textValue(correction.note, 'correction.note', 32768);
  }
  effectiveAssignments = [...new Map(effectiveAssignments.map(row => [stableJSON(row), row])).values()];
  for (const assignment of effectiveAssignments) if (!originalLegs.some(leg => leg.id === assignment.legId)) fail('INVALID_ASSIGNMENT', 'An assignment references an unknown planned leg.', {legId: assignment.legId});
  const prepared = prepareEntities(records, expectedNetwork, asOf, appliedCorrections.filter(row => row.kind === 'exclude'));
  const {entities, excludedRecords} = prepared;
  const horizon = entities.filter(entity => entity.provider === 'horizon' && entity.projection.category === 'payment');
  const payments = entities.filter(entity => entity.provider === 'sdp' && entity.projection.category === 'payment');
  const used = new Map();
  const rank = {MATCHED: 0, MISSING: 1, PENDING: 2, FAILED: 3, MISMATCH: 4, AMBIGUOUS: 5};
  const output = originalLegs.map(original => {
    const leg = {...clone(original), status: 'MATCHED', matches: [], exceptions: []};
    const mark = (code, status, message, selected = [], details = {}) => {
      if (rank[status] > rank[leg.status]) leg.status = status;
      leg.exceptions.push({code, status, message, legId: leg.id, sourceRefs: references(selected.map(meaningfulReferences)), ...details});
    };
    if (parseStellarAmount(leg.amount) === 0n) { leg.accounting = 'ZERO_ALLOCATION'; return leg; }
    if (leg.settlement === 'retain') { leg.status = 'PENDING'; leg.accounting = 'RETAINED_IN_TREASURY'; return leg; }
    const explicit = effectiveAssignments.filter(row => row.legId === leg.id);
    const selected = new Map();
    for (const assignment of explicit) {
      const found = findAssignment(assignment, entities, leg.id).found;
      if (!found.length) mark('ASSIGNED_RECORD_MISSING', 'MISSING', 'The assigned original source record is absent or excluded.', [], {assignment});
      else if (found.length > 1) mark('ASSIGNMENT_SCOPE_AMBIGUOUS', 'AMBIGUOUS', 'The assignment resolves to multiple provider scopes; select its original source or capture.', found, {assignment});
      else if (found[0].projection.category !== 'payment') mark('ASSIGNED_RECORD_NOT_PAYMENT', 'MISMATCH', 'The assigned native record is not a supported payment operation.', found, {assignment});
      else selected.set(found[0].key, found[0]);
    }
    const expectsSDP = leg.provider === 'sdp' || leg.phase === 'payout';
    let selectedSDP = [...selected.values()].filter(e => e.provider === 'sdp');
    let selectedHorizon = [...selected.values()].filter(e => e.provider === 'horizon');
    const explicitSDP = explicit.some(a => a.provider === 'sdp'), explicitHorizon = explicit.some(a => a.provider === 'horizon');
    if (expectsSDP && !explicitSDP) {
      selectedSDP = automaticCandidates(payments, leg, 'sdp');
      if (selectedSDP.length > 1) mark('MULTIPLE_SDP_PAYMENTS', 'AMBIGUOUS', 'Several original SDP payment IDs fit this allocation; select the intended payment.', selectedSDP);
    }
    if (!expectsSDP && !explicitHorizon) {
      selectedHorizon = automaticCandidates(horizon, leg, 'horizon');
      if (selectedHorizon.length > 1) mark('MULTIPLE_NATIVE_PAYMENTS', 'AMBIGUOUS', 'Several original operations fit this allocation; select the intended operation.', selectedHorizon);
    }
    if (expectsSDP && !explicitHorizon) {
      const byKey = new Map();
      for (const payment of selectedSDP) {
        const p = payment.projection;
        const exactId = p.operationId ? horizon.filter(operation => operation.projection.operationId === p.operationId && (!p.transactionHash || operation.projection.transactionHash === p.transactionHash)) : [];
        const matching = exactId.length ? exactId : horizon.filter(operation => nativePairMatches(payment, operation));
        if (matching.length === 1) byKey.set(matching[0].key, matching[0]);
        else if (matching.length > 1) mark('SDP_OPERATION_AMBIGUOUS', 'AMBIGUOUS', 'The SDP transaction contains multiple compatible original operations; assign the exact operation.', [payment, ...matching]);
        else mark('SDP_OPERATION_NOT_RETAINED', p.status === 'FAILED' || p.status === 'CANCELED' ? 'FAILED' : 'PENDING', 'Retain the original Horizon operation referenced by this SDP payment.', [payment]);
      }
      selectedHorizon = [...byKey.values()];
      if (!selectedSDP.length) {
        selectedHorizon = automaticCandidates(horizon, leg, 'horizon');
        if (selectedHorizon.length > 1) mark('MULTIPLE_NATIVE_PAYMENTS', 'AMBIGUOUS', 'Several original operations fit this driver allocation.', selectedHorizon);
      }
    }
    if (!selectedHorizon.length && !selectedSDP.length && !leg.exceptions.length) mark('PAYMENT_NOT_FOUND', 'MISSING', 'No original payment observation matches this planned leg.');
    const pairMap = new Map(selectedHorizon.map(operation => [operation.key, []]));
    for (const payment of selectedSDP) {
      const paired = selectedHorizon.filter(operation => nativePairMatches(payment, operation));
      if (paired.length === 1) pairMap.get(paired[0].key).push(payment);
      else if (paired.length > 1) mark('SDP_OPERATION_AMBIGUOUS', 'AMBIGUOUS', 'Select a unique original operation for the SDP payment.', [payment, ...paired]);
      else if (payment.projection.operationId && selectedHorizon.some(operation => operation.projection.operationId === payment.projection.operationId)) mark('SDP_LEDGER_DETAILS_DIFFER', 'MISMATCH', 'The SDP payment details differ from its original operation.', [payment, ...selectedHorizon]);
      else if (!leg.exceptions.some(e => e.code === 'SDP_OPERATION_NOT_RETAINED')) mark('SDP_OPERATION_NOT_RETAINED', ['FAILED', 'CANCELED'].includes(payment.projection.status) ? 'FAILED' : 'PENDING', 'The original SDP payment has no matching retained Horizon operation.', [payment]);
      if (payment.conflicts.length) mark('CONFLICTING_PROVIDER_OBSERVATIONS', 'AMBIGUOUS', 'Equally current native SDP observations disagree.', [payment], {fields: payment.conflicts});
      if (payment.projection.issues?.length) mark('INVALID_NATIVE_PAYMENT_FIELDS', 'MISMATCH', 'The original SDP payment contains unsupported financial fields.', [payment], {fields: payment.projection.issues});
      const check = relationFields(leg, payment.projection, {amount: false});
      if (check.mismatch.length) mark('SDP_DETAILS_DIFFER', 'MISMATCH', 'The original SDP payment does not match the selected allocation.', [payment], {fields: check.mismatch});
      if (check.missing.some(field => !['fromAccount', 'memo'].includes(field)) || check.missing.length && paired.length !== 1) mark('SDP_DETAILS_INCOMPLETE', 'PENDING', 'Retain the original receiver and sending-account details for this payment.', [payment], {fields: check.missing});
      if (payment.projection.circleTransactionId && !payment.projection.transactionHash) mark('STELLAR_OPERATION_REQUIRED', 'PENDING', 'This native payment uses a Circle reference; its Classic Stellar settlement requires the original Stellar transaction and operation.', [payment]);
    }
    for (const operation of selectedHorizon) {
      const paired = pairMap.get(operation.key) || [];
      if (operation.conflicts.length) mark('CONFLICTING_LEDGER_OBSERVATIONS', 'AMBIGUOUS', 'Retained original observations of the same native operation disagree.', [operation], {fields: operation.conflicts});
      if (operation.projection.issues?.length) mark('INVALID_NATIVE_OPERATION_FIELDS', 'MISMATCH', 'The original operation contains inconsistent financial fields.', [operation], {fields: operation.projection.issues});
      const check = relationFields(leg, operation.projection, {amount: false, native: true});
      if (check.mismatch.length) mark('NATIVE_DETAILS_DIFFER', 'MISMATCH', 'The original operation differs from the selected allocation.', [operation], {fields: check.mismatch});
      if (check.missing.length) mark('NATIVE_DETAILS_INCOMPLETE', 'PENDING', 'Retain the original operation and joined transaction details.', [operation], {fields: check.missing});
      if (!operation.projection.transactionHash || !operation.projection.operationId || !operation.projection.ledger) mark('NATIVE_TRANSACTION_DETAILS_REQUIRED', 'PENDING', 'Retain the exact original transaction hash, operation ID and ledger.', [operation]);
      if (operation.projection.status === 'FAILED') mark('NATIVE_TRANSACTION_FAILED', 'FAILED', 'The original Stellar transaction failed; its attempted payment did not settle.', [operation]);
      else if (operation.projection.status !== 'SUCCESS') mark('NATIVE_SUCCESS_UNKNOWN', 'PENDING', 'The original native operation has no successful transaction observation.', [operation]);
      if (expectsSDP && !paired.length) mark('SDP_PAYMENT_REQUIRED', 'PENDING', 'Retain the original SDP payment that dispatched this driver payout.', [operation]);
      if (paired.length > 1) mark('MULTIPLE_PROVIDER_IDS_FOR_OPERATION', 'AMBIGUOUS', 'Multiple SDP payment IDs claim one original operation.', [operation, ...paired]);
      for (const payment of paired) {
        const status = payment.projection.status;
        if (status !== 'SUCCESS') {
          if (['FAILED', 'CANCELED'].includes(status) && operation.projection.status === 'SUCCESS') mark('PROVIDER_LEDGER_STATUS_DIFFER', 'MISMATCH', 'The ledger settled the payment while its retained SDP status reports failure or cancellation.', [operation, payment]);
          else mark('SDP_STATUS_PENDING', ['FAILED', 'CANCELED'].includes(status) ? 'FAILED' : 'PENDING', 'The retained SDP payment has not reached native SUCCESS.', [payment]);
        } else if (operation.projection.status === 'FAILED') mark('PROVIDER_LEDGER_STATUS_DIFFER', 'MISMATCH', 'SDP reports success while the original Stellar transaction failed.', [operation, payment]);
      }
      leg.matches.push(matchJSON(operation, paired));
    }
    for (const payment of selectedSDP) if (![...pairMap.values()].some(pairs => pairs.includes(payment))) {
      leg.matches.push(matchJSON(null, [payment]));
      if (['FAILED', 'CANCELED'].includes(payment.projection.status)) mark('SDP_PAYMENT_FAILED', 'FAILED', 'The retained SDP payment failed or was canceled.', [payment]);
    }
    const expected = parseStellarAmount(leg.amount);
    if (selectedHorizon.length && sumAmounts(selectedHorizon) !== expected) mark('NATIVE_AMOUNT_DIFFER', 'MISMATCH', 'The selected original operations do not total the planned amount.', selectedHorizon, {expectedAmount: leg.amount, observedAmount: formatStellarAmount(sumAmounts(selectedHorizon))});
    if (expectsSDP && selectedSDP.length && sumAmounts(selectedSDP) !== expected) mark('SDP_AMOUNT_DIFFER', 'MISMATCH', 'The selected original SDP payments do not total the planned allocation.', selectedSDP, {expectedAmount: leg.amount, observedAmount: formatStellarAmount(sumAmounts(selectedSDP))});
    if (leg.status !== 'AMBIGUOUS') for (const entity of [...selectedHorizon, ...selectedSDP]) {
      if (!used.has(entity.key)) used.set(entity.key, []);
      used.get(entity.key).push(leg);
    }
    return leg;
  });
  for (const [key, legs] of used) if (new Set(legs.map(leg => leg.id)).size > 1) {
    const entity = entities.find(row => row.key === key);
    for (const leg of legs) {
      leg.status = 'AMBIGUOUS';
      leg.exceptions.push({code: 'PAYMENT_ASSIGNED_MORE_THAN_ONCE', status: 'AMBIGUOUS', legId: leg.id,
        message: 'One original payment is assigned to multiple planned legs.', otherLegIds: legs.filter(item => item.id !== leg.id).map(item => item.id), sourceRefs: meaningfulReferences(entity)});
    }
  }
  const splitTransfers = output.filter(leg => leg.phase === 'split' && leg.settlement !== 'retain' && parseStellarAmount(leg.amount) > 0n);
  if (plan.requirements?.atomicSplit !== false && splitTransfers.length && splitTransfers.every(leg => leg.status === 'MATCHED')) {
    const transactionHashes = new Set(splitTransfers.flatMap(leg => leg.matches.map(match => match.transactionHash).filter(Boolean)));
    if (transactionHashes.size !== 1) for (const leg of splitTransfers) {
      leg.status = 'MISMATCH';
      leg.exceptions.push({code: 'SPLIT_NOT_ATOMIC', status: 'MISMATCH', legId: leg.id,
        message: 'The treasury split transfers did not occur in one original successful native transaction.',
        transactionHashes: [...transactionHashes], sourceRefs: references(leg.matches.map(match => match.recordRefs))});
    }
  }
  const incoming = output.filter(leg => leg.phase === 'revenue');
  for (const leg of output.filter(row => row.settlement === 'retain' && parseStellarAmount(row.amount) > 0n)) {
    const dependencies = [...incoming, ...splitTransfers];
    if (dependencies.length && dependencies.every(row => row.status === 'MATCHED')) {
      leg.status = 'MATCHED';
      leg.matches = [{kind: 'retained-allocation', amount: leg.amount, recordRefs: references(dependencies.flatMap(row => row.matches.map(match => match.recordRefs)))}];
    } else {
      leg.status = 'PENDING';
      leg.exceptions.push({code: 'RETAINED_SHARE_DEPENDENCIES', status: 'PENDING', legId: leg.id,
        message: 'The retained treasury share is reconciled after its original revenue and outward split transfers.',
        dependencyLegIds: dependencies.filter(row => row.status !== 'MATCHED').map(row => row.id), sourceRefs: []});
    }
  }
  const matchedRefs = new Set(output.flatMap(leg => leg.matches.flatMap(match => match.recordRefs || [])).map(ref => stableJSON(ref)));
  const unmatchedRecords = entities.filter(entity => ['payment', 'clawback'].includes(entity.projection.category) && !meaningfulReferences(entity).some(ref => matchedRefs.has(stableJSON(ref)))).map(entity => ({
    provider: entity.provider, recordId: entity.id, sourceScope: entity.sourceScope, projection: clone(entity.projection), recordRefs: meaningfulReferences(entity),
  }));
  const exceptions = output.flatMap(leg => leg.exceptions);
  for (const clawback of entities.filter(e => e.projection.category === 'clawback' && e.projection.status === 'SUCCESS')) {
    const participants = plan.participants.filter(p => p.account === clawback.projection.fromAccount);
    if (participants.length && assetKey(clawback.projection.asset) === expectedAsset) exceptions.push({code: 'CLAWBACK_OBSERVED', status: 'MISMATCH',
      message: 'An original native clawback affects a selected settlement participant; retain its explicit correction interpretation.',
      participantIds: participants.map(p => p.id), amount: clawback.projection.amount, sourceRefs: meaningfulReferences(clawback)});
  }
  const counts = Object.fromEntries(Object.keys(rank).map(status => [status, output.filter(leg => leg.status === status).length]));
  const amountFor = (predicate, matched) => formatStellarAmount(output.filter(leg => predicate(leg) && (!matched || leg.status === 'MATCHED')).reduce((sum, leg) => sum + parseStellarAmount(leg.amount), 0n));
  const summary = {
    status: exceptions.some(error => ['MISMATCH', 'AMBIGUOUS', 'FAILED'].includes(error.status)) ? 'ATTENTION' : output.every(leg => leg.status === 'MATCHED') ? 'RECONCILED' : 'IN_PROGRESS',
    counts, legCount: output.length, exceptionCount: exceptions.length,
    grossExpected: amountFor(leg => leg.phase === 'revenue', false), grossMatched: amountFor(leg => leg.phase === 'revenue', true),
    authorityExpected: amountFor(leg => leg.phase === 'split' && leg.role === 'authority', false), authorityMatched: amountFor(leg => leg.phase === 'split' && leg.role === 'authority', true),
    driverPoolExpected: amountFor(leg => leg.phase === 'split' && leg.role === 'driver_pool', false), driverPoolMatched: amountFor(leg => leg.phase === 'split' && leg.role === 'driver_pool', true),
    platformExpected: amountFor(leg => leg.phase === 'split' && leg.role === 'platform', false), platformMatched: amountFor(leg => leg.phase === 'split' && leg.role === 'platform', true),
    driverPayoutExpected: amountFor(leg => leg.phase === 'payout', false), driverPayoutMatched: amountFor(leg => leg.phase === 'payout', true),
    unallocatedDriverAmount: plan.totals.unallocatedDriverAmount, unmatchedRecordCount: unmatchedRecords.length, excludedRecordCount: excludedRecords.length,
  };
  return {schema: 'stellar-forge.settlement-reconciliation.v1', planId: plan.id, asOf, summary, legs: output, exceptions, unmatchedRecords, excludedRecords,
    sourceRefs: references(output.flatMap(leg => leg.matches.map(match => match.recordRefs))),
    assignments: effectiveAssignments, corrections: appliedCorrections};
}

function scopedReport(plan, reconciliation, partnerId) {
  if (partnerId === undefined || partnerId === null) return {schema: 'stellar-forge.settlement-partner-report.v1',
    scope: {type: 'workspace', partnerId: null}, plan: clone(plan), reconciliation: clone(reconciliation)};
  idText(partnerId, 'partnerId');
  const participants = plan.participants.filter(row => row.partnerId === partnerId);
  if (!participants.length) fail('PARTNER_NOT_FOUND', 'The selected plan has no participants for this partner.', {partnerId});
  const participantIds = new Set(participants.map(row => row.id));
  const legs = reconciliation.legs.filter(leg => participantIds.has(leg.participantId) || leg.partnerId === partnerId);
  const legIds = new Set(legs.map(leg => leg.id));
  const sourceRefs = references(legs.flatMap(leg => [...(leg.sourceRefs || []), ...leg.matches.flatMap(match => match.recordRefs || [])]));
  const selectedRef = ref => sourceRefs.some(source => {
    if (ref.recordId && source.recordId !== ref.recordId) return false;
    if (ref.sourceId && source.sourceId !== ref.sourceId) return false;
    if (ref.sha256 && source.sha256 !== ref.sha256) return false;
    return Boolean(ref.recordId || ref.sourceId || ref.sha256);
  });
  const exceptions = reconciliation.exceptions.filter(exception => legIds.has(exception.legId) ||
    exception.participantIds?.some(id => participantIds.has(id))).map(exception => ({
      ...clone(exception),
      ...(exception.otherLegIds ? {otherLegIds: exception.otherLegIds.filter(id => legIds.has(id))} : {}),
      ...(exception.participantIds ? {participantIds: exception.participantIds.filter(id => participantIds.has(id))} : {}),
    }));
  const corrections = reconciliation.corrections.filter(correction =>
    correction.kind === 'assign' ? legIds.has(correction.assignment?.legId) :
      correction.kind === 'exclude' ? selectedRef(correction.recordRef) :
        correction.partnerId === partnerId || legIds.has(correction.legId) || participantIds.has(correction.participantId));
  const amount = (phase, matched) => formatStellarAmount(legs.filter(leg => leg.phase === phase && (!matched || leg.status === 'MATCHED')).reduce((sum, leg) => sum + parseStellarAmount(leg.amount), 0n));
  const summary = {
    status: legs.every(leg => leg.status === 'MATCHED') && !exceptions.some(e => ['MISMATCH', 'AMBIGUOUS', 'FAILED'].includes(e.status)) ? 'RECONCILED' :
      exceptions.some(e => ['MISMATCH', 'AMBIGUOUS', 'FAILED'].includes(e.status)) ? 'ATTENTION' : 'IN_PROGRESS',
    legCount: legs.length, exceptionCount: exceptions.length,
    phases: Object.fromEntries(['revenue', 'split', 'payout'].map(phase => [phase, {expected: amount(phase, false), matched: amount(phase, true)}])),
    counts: Object.fromEntries(['MATCHED', 'MISSING', 'PENDING', 'FAILED', 'MISMATCH', 'AMBIGUOUS'].map(status => [status, legs.filter(leg => leg.status === status).length])),
  };
  return {schema: 'stellar-forge.settlement-partner-report.v1', scope: {type: 'partner', partnerId},
    plan: {schema: plan.schema, id: plan.id, policy: clone(plan.policy), requirements: clone(plan.requirements || {}),
      revenue: {id: plan.revenue.id, network: plan.revenue.network, asset: clone(plan.revenue.asset), amount: plan.revenue.amount, treasuryAccount: plan.revenue.treasuryAccount},
      participants: participants.map(row => ({id: row.id, role: row.role, account: row.account, partnerId,
        ...(row.label ? {label: row.label} : {}), ...(row.memo ? {memo: clone(row.memo)} : {}), settlement: row.settlement || 'transfer'})),
      contributions: plan.contributions.filter(row => participantIds.has(row.participantId)).map(row => ({id: row.id, participantId: row.participantId, units: row.units, tier: row.tier, approved: row.approved, ...(row.sourceRef ? {sourceRef: clone(row.sourceRef)} : {})})),
      legs: plan.legs.filter(leg => legIds.has(leg.id)).map(clone), sourceRefs},
    reconciliation: {schema: reconciliation.schema, planId: plan.id, asOf: reconciliation.asOf, summary, legs: clone(legs), exceptions,
      assignments: reconciliation.assignments.filter(row => legIds.has(row.legId)).map(clone), corrections: clone(corrections), sourceRefs}};
}
function csvCell(value) {
  let text = value === undefined || value === null ? '' : typeof value === 'string' ? value : stableJSON(value);
  // Original free text stays unchanged in JSON. Spreadsheet formula execution
  // is disabled only in the presentation CSV.
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function buildPartnerReport({plan, reconciliation, partnerId = null, format = 'json'}) {
  plain(plan, 'plan'); plain(reconciliation, 'reconciliation');
  if (reconciliation.planId !== plan.id) fail('PLAN_MISMATCH', 'The reconciliation belongs to another immutable plan.');
  if (!['json', 'csv'].includes(format)) fail('INVALID_REPORT_FORMAT', 'Report format must be json or csv.');
  const data = scopedReport(plan, reconciliation, partnerId);
  let content;
  if (format === 'json') content = Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8');
  else {
    const columns = ['plan_id', 'policy_id', 'policy_version', 'partner_id', 'participant_id', 'phase', 'role', 'settlement',
      'from_account', 'to_account', 'asset_type', 'asset_code', 'asset_issuer', 'amount', 'status',
      'transaction_hashes', 'operation_ids', 'ledgers', 'sdp_payment_ids', 'exception_codes', 'source_references'];
    const rows = data.reconciliation.legs.map(leg => [
      plan.id, plan.policy.id, String(plan.policy.version), leg.partnerId || partnerId || '', leg.participantId || '',
      leg.phase, leg.role, leg.settlement || 'transfer', leg.fromAccount || '', leg.toAccount, leg.asset.type,
      leg.asset.code || '', leg.asset.issuer || '', leg.amount, leg.status,
      [...new Set(leg.matches.map(match => match.transactionHash).filter(Boolean))].join(';'),
      [...new Set(leg.matches.map(match => match.operationId).filter(Boolean))].join(';'),
      [...new Set(leg.matches.map(match => match.ledger).filter(value => value !== undefined && value !== null))].join(';'),
      [...new Set(leg.matches.flatMap(match => (match.paymentStatuses || []).map(payment => payment.paymentId)))].join(';'),
      [...new Set(leg.exceptions.map(error => error.code))].join(';'),
      references(leg.matches.map(match => match.recordRefs)),
    ]);
    content = Buffer.from([columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
  }
  const safe = value => String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
  return {filename: 'settlement-' + safe(plan.id) + (partnerId ? '-' + safe(partnerId) : '') + '.' + format,
    contentType: format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
    content, bytes: content.length, sha256: sourceHash(content), data};
}

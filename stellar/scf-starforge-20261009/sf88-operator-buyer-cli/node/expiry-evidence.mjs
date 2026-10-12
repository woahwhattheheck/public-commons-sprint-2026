import { open, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const SCHEMA = 'stellar-forge.sf88.authorization-expiry-evidence.v1';
const TESTNET = 'Test SDF Network ; September 2015';
const HASH = /^[a-f0-9]{64}$/;
const ACCOUNT = /^G[A-Z2-7]{55}$/;
const TOTAL_LIMIT = 32 * 1024 * 1024;
const FORMULA = Object.freeze({
  authorizationExpiry: 'currentLedger + ceil(maxTimeoutSeconds / estimatedLedgerSeconds)',
  estimatedLedgerSeconds: 'ceil((newestClosedAtSeconds - oldestClosedAtSeconds) / (recordCount - 1))',
  fallbackSeconds: 5,
  minimumFinitePositiveIntegerSeconds: 1
});
const SDK = Object.freeze({
  package: 'd28ae35183305c5fc56f7fb756a5013a9d8a8c22bf7cefce69fd18e54d0a15dc',
  client: '8ab5d52236bca84114dd38dc6f48b61e8f5a70ecbfed17144b4176db6e95af7b',
  estimator: '6b90c248d2fd0913a39d9feb665a32f7d07739220db5ca377dce6e089eb2ea5d'
});

function fail(message, code = 'AUTHORIZATION_EXPIRY_EVIDENCE_INVALID') {
  throw Object.assign(new Error(message), { code });
}
function need(value, message, code) { if (!value) fail(message, code); }
function object(value, label) {
  need(value && typeof value === 'object' && !Array.isArray(value), label + ' must be an object');
  return value;
}
function integer(value, label, minimum = 0, maximum = 0xffffffff) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, label + ' must be an integer in range');
  return value;
}
function text(value, label, maximum = 4096) {
  need(typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0'), label + ' must be a bounded string');
  return value;
}
function hash(value, label) { need(typeof value === 'string' && HASH.test(value), label + ' must be a SHA256'); return value; }
function when(value, label) {
  text(value, label, 64);
  need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), label + ' must include an explicit timezone');
  const millis = Date.parse(value);
  need(Number.isFinite(millis), label + ' must be a valid timestamp');
  return millis;
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
function equal(actual, expected, label) { need(canonical(actual) === canonical(expected), label + ' differs from its original source'); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function aborted(signal) {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('Authorization expiry evidence read aborted'), { name: 'AbortError' });
}
function within(root, file) {
  const rel = relative(root, file);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
function stamp(value) {
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String).join(':');
}
function endpoint(value, path, parameters, label, optionalEmptyCursor = false) {
  let url;
  try { url = new URL(text(value, label)); } catch { fail(label + ' must be an absolute URL'); }
  need(url.protocol === 'https:' && url.hostname === 'horizon-testnet.stellar.org' && url.port === '' && !url.username && !url.password && !url.hash, label + ' must use the original TESTNET Horizon origin');
  need(url.pathname === path, label + ' has a different source path');
  const expected = new Map(Object.entries(parameters));
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    need(!seen.has(key), label + ' contains a duplicate query key');
    seen.add(key);
    if (optionalEmptyCursor && key === 'cursor' && value === '' && !expected.has('cursor')) continue;
    need(expected.has(key) && value === String(expected.get(key)), label + ' has a different query');
    expected.delete(key);
  }
  need(expected.size === 0, label + ' is missing a query field');
  return url.href;
}

async function reader(root, signal) {
  const saved = new Map();
  let total = 0;
  function pathFor(base, name, label) {
    text(name, label);
    const result = resolve(base, name);
    need(within(root, result), label + ' escapes the original evidence directory');
    return result;
  }
  async function read(role, file, limit, expected = null, json = true) {
    aborted(signal);
    const path = pathFor(root, file, role);
    let entry = saved.get(path);
    if (!entry) {
      need(saved.size < 64, 'Too many expiry evidence files');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await handle.stat({ bigint: true });
        need(before.isFile() && before.size > 0n && before.size <= BigInt(limit), role + ' must be a nonempty regular file within its size limit');
        need(total + Number(before.size) <= TOTAL_LIMIT, 'Expiry evidence exceeds the combined size limit');
        const chunks = [];
        let size = 0;
        for (;;) {
          aborted(signal);
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit - size + 1));
          const part = await handle.read(buffer, 0, buffer.length, null);
          if (part.bytesRead === 0) break;
          size += part.bytesRead;
          need(size <= limit, role + ' grew beyond its size limit');
          chunks.push(buffer.subarray(0, part.bytesRead));
        }
        const after = await handle.stat({ bigint: true });
        const named = await stat(path, { bigint: true });
        need(stamp(before) === stamp(after) && stamp(after) === stamp(named) && size === Number(before.size), role + ' changed during its read');
        need(await realpath(path) === path, role + ' must retain its resolved original path');
        const bytes = Buffer.concat(chunks, size);
        entry = { path, bytes, sha256: sha(bytes), size, stamp: stamp(after), roles: [] };
        total += size;
        saved.set(path, entry);
      } finally { await handle.close(); }
    }
    need(entry.size <= limit, role + ' exceeds its size limit');
    if (!entry.roles.includes(role)) entry.roles.push(role);
    if (expected) {
      integer(expected.bytes, role + ' original byte count', 1, limit);
      hash(expected.sha256, role + ' original hash');
      need(expected.bytes === entry.size && expected.sha256 === entry.sha256, role + ' original byte identity changed');
    }
    if (!json) return entry.bytes.toString('utf8');
    if (!entry.value) {
      try { entry.value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes)); }
      catch { fail(role + ' must contain valid UTF-8 JSON'); }
    }
    return entry.value;
  }
  async function described(role, base, descriptor, limit, json = true) {
    object(descriptor, role + ' descriptor');
    need(!isAbsolute(text(descriptor.file, role + ' filename')), role + ' filename must be relative');
    return read(role, pathFor(base, descriptor.file, role), limit, descriptor, json);
  }
  async function finish() {
    aborted(signal);
    for (const entry of saved.values()) {
      need(stamp(await stat(entry.path, { bigint: true })) === entry.stamp && await realpath(entry.path) === entry.path, 'An expiry evidence file changed before the snapshot completed');
    }
    return [...saved.values()].map(entry => ({
      role: entry.roles.join('+'), path: entry.path, bytes: entry.size, sha256: entry.sha256
    })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }
  return { read, described, pathFor, finish };
}

/**
 * Validate retained TESTNET evidence for the original SDK 2.28.0 ledger upper-bound
 * inference. This reads files only. It performs no transaction, account, provider,
 * signer or reservation operation. The resulting observation remains scoped to
 * the configured fee account and the recorded provider-account association.
 *
 * Adjacent to boundFile, retain provider-completion-source.json, source-index.json
 * and sdk-authorization-expiry-source.json with their exact referenced originals.
 * providerSourceFile and sdkSourceIndexFile may select other retained files inside
 * the same evidence root; each descriptor resolves relative to its own index.
 */
export async function readAuthorizationExpiryEvidence({
  boundFile, observationFile, expectedIntentId, expectedRequestSha256,
  acceptedMaxTimeoutSeconds, expectedFeeAccount, expectedAttemptStartedAt,
  providerSourceFile, sdkSourceIndexFile, signal
} = {}) {
  text(expectedIntentId, 'Expected intent', 240);
  hash(expectedRequestSha256, 'Expected request hash');
  need(typeof expectedFeeAccount === 'string' && ACCOUNT.test(expectedFeeAccount), 'Expected fee account must be a Stellar account address');
  integer(acceptedMaxTimeoutSeconds, 'Accepted maximum timeout', 1);
  const attemptTime = when(expectedAttemptStartedAt, 'Original attempt start');
  const originalBound = resolve(text(boundFile, 'Bound file'));
  const root = await realpath(dirname(originalBound));
  const boundPath = resolve(root, originalBound.split(sep).at(-1));
  const originalObservation = resolve(text(observationFile, 'Observation file'));
  const observationPath = resolve(await realpath(dirname(originalObservation)), originalObservation.split(sep).at(-1));
  need(within(root, observationPath), 'Observation must belong to the same retained evidence directory');
  const io = await reader(root, signal);
  const bound = object(await io.read('bound', boundPath, 128 * 1024), 'Bound');
  const observation = object(await io.read('observation', observationPath, 128 * 1024), 'Observation');
  need(bound.schema === 'commons.native-authorization-expiry-upper-bound/v1', 'Unsupported authorization expiry bound schema');
  need(observation.schema === 'commons.native-post-expiry-chain-observation/v1', 'Unsupported post-bound observation schema');
  for (const value of [bound, observation]) {
    need(value.intent_id === expectedIntentId && value.request_digest === expectedRequestSha256, 'Evidence belongs to another original request');
  }
  need(io.pathFor(dirname(observationPath), observation.source_bound_file, 'Observed bound') === boundPath, 'Observation points to another original bound');

  const sdkPath = io.pathFor(root, sdkSourceIndexFile ?? 'sdk-authorization-expiry-source.json', 'SDK source index path');
  const sdk = object(await io.read('sdk-source', sdkPath, 128 * 1024), 'SDK source');
  need(sdk.schema === 'commons.stellar-authorization-expiry-sdk-source/v1' && sdk.package === '@x402/stellar' && sdk.version === '2.28.0', 'Unsupported authorization expiry SDK source');
  equal(sdk.formula, FORMULA, 'SDK expiry formula');
  object(sdk.files, 'SDK source files');
  const sdkHashes = {};
  for (const role of ['package', 'client', 'estimator']) {
    const descriptor = sdk.files[role];
    need(descriptor?.sha256 === SDK[role], 'SDK ' + role + ' is not the reviewed original 2.28.0 source');
    const value = await io.described('sdk-' + role, dirname(sdkPath), descriptor, 1024 * 1024, role === 'package');
    if (role === 'package') need(value.name === '@x402/stellar' && value.version === '2.28.0', 'SDK package identity changed');
    sdkHashes[role] = descriptor.sha256;
  }

  const providerPath = io.pathFor(root, providerSourceFile ?? 'provider-completion-source.json', 'Provider source path');
  const provider = object(await io.read('provider-completion', providerPath, 128 * 1024), 'Provider completion source');
  need(provider.schema === 'commons.original-provider-completion-source/v1', 'Unsupported provider-completion source schema');
  need(provider.intent_id === expectedIntentId && provider.request_digest === expectedRequestSha256, 'Provider association belongs to another request');
  const accountBudget = object(await io.described('provider-account', dirname(providerPath), provider.sources?.provider, 128 * 1024), 'Original provider account');
  const dayBudget = object(await io.described('provider-day', dirname(providerPath), provider.sources?.day, 128 * 1024), 'Original provider day');
  const association = object(provider.association, 'Provider association');
  need(association.kind === 'ORIGINAL_SERIAL_NATIVE_COHORT', 'Unsupported provider source association');
  need(provider.provider_completed_at_pointer === '/lastResponseAt', 'Provider completion must come from the retained account response timestamp');
  const completedAt = text(accountBudget.lastResponseAt, 'Provider response timestamp', 64);
  const completedTime = when(completedAt, 'Provider response timestamp');
  need(completedTime >= attemptTime, 'Provider response predates the original attempt');
  for (const value of [bound.provider_completed_at, provider.provider_completed_at, accountBudget.observedAt]) {
    need(when(value, 'Retained provider completion') === completedTime, 'Retained provider completion timestamps differ');
  }
  integer(dayBudget.calls, 'Original provider calls', 1);
  integer(dayBudget.settledCalls, 'Original settled provider calls', 1);
  integer(dayBudget.settledCredits, 'Original provider credits');
  need(dayBudget.schema === 'stellar-forge.openalex-budget.v1' && dayBudget.day === new Date(completedTime).toISOString().slice(0, 10), 'Provider day does not contain the original response');
  need(dayBudget.calls === dayBudget.settledCalls && Object.keys(object(dayBudget.reservations, 'Original provider reservations')).length === 0, 'Provider account aggregate is not fully settled');
  need(association.selected_page === association.completed_native_pages + 1 && association.selected_page === dayBudget.calls, 'Serial provider page association differs from the original day count');
  need(association.provider_calls_for_utc_day === dayBudget.calls && association.settled_credits_for_utc_day === dayBudget.settledCredits, 'Provider association aggregate differs from its original source');
  integer(accountBudget.remaining, 'Original provider remaining credits');
  need(association.provider_remaining === accountBudget.remaining && accountBudget.settledCreditsAtObservation === dayBudget.settledCredits, 'Provider response accounting differs from the retained association');
  need(accountBudget.settledCreditsDay === dayBudget.day, 'Provider response credit day differs');
  text(association.scope, 'Provider association scope');
  text(association.account, 'Provider account label');
  need(when(provider.preserved_at, 'Provider preservation timestamp') >= completedTime, 'Provider preservation predates its original response');

  const ledgerDescriptor = object(bound.ledger_source, 'Ledger source');
  const ledgerLimit = Number(new URL(ledgerDescriptor.url).searchParams.get('limit'));
  integer(ledgerLimit, 'Ledger page limit', 2, 200);
  const ledgerCursor = new URL(ledgerDescriptor.url).searchParams.get('cursor');
  need(/^\d+$/.test(ledgerCursor ?? ''), 'Original ledger cursor must be retained');
  endpoint(ledgerDescriptor.url, '/ledgers', { cursor: ledgerCursor, order: 'asc', limit: String(ledgerLimit) }, 'Original ledger URL');
  const ledgerBody = object(await io.described('ledger-page', root, ledgerDescriptor, 4 * 1024 * 1024), 'Ledger page');
  endpoint(ledgerBody._links?.self?.href, '/ledgers', { cursor: ledgerCursor, order: 'asc', limit: String(ledgerLimit) }, 'Returned ledger page');
  const ledgers = ledgerBody._embedded?.records;
  need(Array.isArray(ledgers) && ledgers.length >= 2 && ledgers.length <= ledgerLimit, 'Original ledger page has an invalid number of records');
  let previous = null;
  let before = null;
  let after = null;
  for (const record of ledgers) {
    object(record, 'Ledger record');
    const seq = integer(record.sequence, 'Ledger sequence', 1);
    const time = when(record.closed_at, 'Ledger close time');
    hash(record.hash, 'Ledger hash');
    need(/^\d+$/.test(record.paging_token) && BigInt(record.paging_token) === (BigInt(seq) << 32n), 'Ledger paging token differs from its sequence');
    if (previous) {
      need(seq === previous.sequence + 1 && time > previous.time && record.prev_hash === previous.hash, 'Original ledger page is not a consecutive ordered chain');
    } else need(BigInt(ledgerCursor) === ((BigInt(seq) - 1n) << 32n), 'Original ledger page does not continue its retained cursor');
    if (time < completedTime) before = record;
    if (!after && time > completedTime) after = record;
    previous = { sequence: seq, time, hash: record.hash };
  }
  need(before && after && after.sequence === before.sequence + 1, 'Original provider response must be bracketed by consecutive closed ledgers');
  const point = value => ({ sequence: value.sequence, closed_at: value.closed_at, hash: value.hash });
  equal(bound.last_closed_before_completion, point(before), 'Last pre-completion ledger');
  equal(bound.first_closed_after_completion, point(after), 'First post-completion ledger');
  need(bound.records === ledgers.length && bound.first_ledger === ledgers[0].sequence && bound.last_ledger === ledgers.at(-1).sequence, 'Ledger page summary differs from its original records');
  need(when(ledgerDescriptor.retrieved_at, 'Ledger retrieval time') >= when(ledgers.at(-1).closed_at, 'Last ledger close time'), 'Ledger retrieval predates its source records');
  const inference = object(bound.inference, 'Original expiry inference');
  const extraLedgers = Math.ceil(acceptedMaxTimeoutSeconds / FORMULA.minimumFinitePositiveIntegerSeconds);
  const upper = integer(after.sequence + extraLedgers, 'Authorization expiry ledger upper bound', 1);
  need(inference.accepted_max_timeout_seconds === acceptedMaxTimeoutSeconds && inference.maximum_additional_ledgers === extraLedgers, 'Expiry allowance differs from the original accepted timeout and SDK formula');
  need(inference.signing_ledger_upper_bound === after.sequence && inference.authorization_expiry_ledger_upper_bound === upper, 'Expiry ledger upper bound does not recompute from its sources');
  need(inference.exact_signed_authorization_retained === false, 'This evidence contract is the source-bound inference for an unretained authorization');
  text(inference.clock_basis, 'Original clock basis');
  need(observation.authorization_expiry_upper_bound === upper && observation.bound_passed === true, 'Post-bound observation has a different expiry bound');

  const index = object(await io.read('original-source-index', resolve(root, 'source-index.json'), 128 * 1024), 'Original source index');
  need(index.schema === 'commons.original-native-chain-observations/v1' && index.intent_id === expectedIntentId && index.request_digest === expectedRequestSha256, 'Original chain source index belongs to another request');
  need(Array.isArray(index.files) && index.files.length > 0 && index.files.length <= 12, 'Original chain source index files are missing');
  for (let i = 0; i < index.files.length; i++) await io.described('original-chain-source-' + i, root, index.files[i], 4 * 1024 * 1024);
  const sourceDescriptors = object(observation.sources, 'Post-bound original sources');
  const observedRoot = dirname(observationPath);
  const responses = {};
  const windows = [];
  const paths = {
    'horizon-status': ['/', {}, 128 * 1024],
    'fee-account': ['/accounts/' + expectedFeeAccount, {}, 1024 * 1024],
    'fee-account-transactions-01': ['/accounts/' + expectedFeeAccount + '/transactions', { order: 'desc', limit: String(observation.history?.requested_limit), include_failed: 'true' }, 16 * 1024 * 1024]
  };
  integer(observation.history?.requested_limit, 'Account history limit', 1, 200);
  for (const [role, [path, params, limit]] of Object.entries(paths)) {
    const descriptor = object(sourceDescriptors[role], role + ' original source');
    need(descriptor.status === 200, role + ' original response was not successful');
    endpoint(descriptor.url, path, params, role + ' request URL');
    const started = when(descriptor.request_started_at, role + ' request time');
    const ended = when(descriptor.retrieved_at, role + ' retrieval time');
    need(started >= completedTime && ended >= started, role + ' retrieval window is inconsistent');
    const headerDate = Date.parse(descriptor.headers?.Date ?? '');
    need(Number.isFinite(headerDate) && headerDate <= ended + 1000, role + ' original response Date is missing or outside its retrieval window');
    responses[role] = object(await io.described(role, observedRoot, descriptor, limit), role + ' response');
    endpoint(responses[role]._links?.self?.href, path, params, role + ' returned source URL', role === 'fee-account-transactions-01');
    windows.push({ role, requestStartedAt: descriptor.request_started_at, retrievedAt: descriptor.retrieved_at, responseDate: descriptor.headers.Date, headerDate, ended });
  }
  const horizon = responses['horizon-status'];
  need(horizon.network_passphrase === TESTNET, 'Original Horizon response is not TESTNET');
  for (const key of ['history_latest_ledger', 'core_latest_ledger', 'ingest_latest_ledger']) {
    integer(horizon[key], 'Horizon ' + key, 1);
    need(horizon[key] > upper, 'Original Horizon observation has not passed the authorization upper bound');
  }
  for (const [key, value] of Object.entries(observation.horizon)) equal(horizon[key], value, 'Observed Horizon ' + key);
  const headClosed = when(horizon.history_latest_ledger_closed_at, 'Observed history ledger close time');
  need(headClosed > completedTime && windows.every(window => window.headerDate >= headClosed && window.ended >= headClosed), 'Account/history response dates do not follow the observed post-bound ledger close');

  const account = responses['fee-account'];
  need(account.id === expectedFeeAccount && account.account_id === expectedFeeAccount, 'Original fee account differs from its configured identity');
  need(/^\d+$/.test(account.sequence) && BigInt(account.sequence) >= 0n, 'Original fee account sequence is invalid');
  integer(account.last_modified_ledger, 'Fee account last modified ledger', 1);
  need(account.last_modified_ledger <= horizon.history_latest_ledger && when(account.last_modified_time, 'Fee account modified time') < attemptTime, 'Fee account has a later or inconsistent modification');
  for (const [key, value] of Object.entries(observation.fee_account)) equal(account[key], value, 'Observed fee account ' + key);
  for (const [key, value] of Object.entries(index.fee_account)) equal(account[key], value, 'Earlier original fee account ' + key);

  const transactions = responses['fee-account-transactions-01']._embedded?.records;
  const historyLimit = observation.history.requested_limit;
  need(Array.isArray(transactions) && transactions.length > 0 && transactions.length < historyLimit, 'Account history must retain the complete first descending page below its limit');
  need(observation.history.complete_returned_page === true && observation.history.records === transactions.length, 'Account history page completeness differs from the original response');
  const seen = new Set();
  const afterAttempt = [];
  let previousToken = null;
  let previousTime = Infinity;
  let largestSourceSequence = null;
  for (const tx of transactions) {
    object(tx, 'Original account transaction');
    hash(tx.hash, 'Original account transaction hash');
    need(tx.id === tx.hash && !seen.has(tx.hash), 'Original account history repeats or renames a transaction');
    seen.add(tx.hash);
    need(/^\d+$/.test(tx.paging_token), 'Original transaction paging token is invalid');
    const token = BigInt(tx.paging_token);
    const time = when(tx.created_at, 'Original transaction time');
    need((previousToken === null || token < previousToken) && time <= previousTime, 'Original account history is not in descending order');
    previousToken = token;
    previousTime = time;
    integer(tx.ledger, 'Original transaction ledger', 1);
    need(tx.ledger <= horizon.history_latest_ledger, 'Account transaction lies beyond the observed history ledger');
    if (time >= attemptTime) afterAttempt.push({ hash: tx.hash, ledger: tx.ledger, createdAt: tx.created_at, successful: tx.successful });
    if (tx.source_account === expectedFeeAccount) {
      need(/^\d+$/.test(tx.source_account_sequence), 'Original fee-account transaction sequence is invalid');
      const sequence = BigInt(tx.source_account_sequence);
      if (largestSourceSequence === null || sequence > largestSourceSequence) largestSourceSequence = sequence;
    }
  }
  need(afterAttempt.length === 0, 'Original fee-account history contains activity at or after this attempt', 'AUTHORIZATION_EXPIRY_EVIDENCE_HAS_LATER_ACTIVITY');
  equal(observation.history.transactions_after_original_attempt_start, [], 'Recorded transactions after the original attempt');
  need(largestSourceSequence !== null && largestSourceSequence === BigInt(account.sequence), 'Original account sequence does not match its complete returned history');
  need(observation.history.newest_created_at === transactions[0].created_at && observation.history.oldest_created_at === transactions.at(-1).created_at, 'Account history time range differs from its records');
  const prior = index.account_history?.known_prior_payments_found;
  need(Array.isArray(prior) && prior.length === association.completed_native_pages && prior.length > 0, 'Serial provider association must retain the original completed native pages');
  need(new Set(prior).size === prior.length, 'Original completed native page identities repeat');
  for (const payment of prior) {
    hash(payment, 'Original prior payment');
    const tx = transactions.find(row => row.hash === payment);
    need(tx && tx.successful === true && tx.source_account === expectedFeeAccount && tx.fee_account === expectedFeeAccount, 'An original completed native page is missing from the configured fee-account history');
  }
  need(observation.history.known_page1_present === true && observation.history.known_page2_present === true, 'Original completed page presence is inconsistent');

  const files = await io.finish();
  const cleanWindows = windows.map(({ headerDate, ended, ...value }) => value);
  const observedAt = windows.reduce((a, b) => a.ended > b.ended ? a : b).retrievedAt;
  const snapshot = {
    schema: SCHEMA,
    kind: 'SOURCE_BOUND_LEDGER_UPPER_BOUND',
    binding: {
      intentId: expectedIntentId, requestSha256: expectedRequestSha256,
      feeAccount: expectedFeeAccount, acceptedMaxTimeoutSeconds,
      attemptStartedAt: expectedAttemptStartedAt
    },
    bound: {
      providerCompletedAt: completedAt,
      signingLedgerUpperBound: after.sequence,
      maximumAdditionalLedgers: extraLedgers,
      authorizationExpiryLedgerUpperBound: upper,
      lastClosedBeforeCompletion: point(before),
      firstClosedAfterCompletion: point(after)
    },
    observation: {
      networkPassphrase: horizon.network_passphrase,
      historyLedger: horizon.history_latest_ledger, coreLedger: horizon.core_latest_ledger,
      ingestLedger: horizon.ingest_latest_ledger, historyLedgerClosedAt: horizon.history_latest_ledger_closed_at,
      feeAccountSequence: account.sequence, lastModifiedLedger: account.last_modified_ledger,
      lastModifiedAt: account.last_modified_time, historyCount: transactions.length,
      historyLimit, completeReturnedPage: true, transactionsAfterAttemptStart: afterAttempt,
      knownPriorPayments: [...prior], observedAt, sourceWindows: cleanWindows
    },
    sdk: { package: '@x402/stellar', version: '2.28.0', formula: FORMULA, sourceHashes: sdkHashes },
    provider: {
      account: association.account, selectedPage: association.selected_page,
      completedNativePages: association.completed_native_pages,
      originalCallsForUtcDay: dayBudget.calls, originalSettledCreditsForUtcDay: dayBudget.settledCredits,
      remainingAtResponse: accountBudget.remaining, completedAtPointer: '/lastResponseAt'
    },
    scope: {
      exactSignedAuthorizationRetained: false,
      clockBasis: inference.clock_basis,
      historyScope: 'original_fee_account',
      providerAssociation: 'ORIGINAL_SERIAL_NATIVE_COHORT',
      providerAssociationScope: association.scope,
      observationConsistency: 'Separate retained Horizon responses with their original request and response windows',
      inferenceCondition: 'The original SDK signed before the associated serial provider response; its retained formula gives an inclusive ledger upper bound'
    },
    files
  };
  const fixed = JSON.parse(canonical(snapshot));
  return { ...fixed, sha256: sha(Buffer.from(canonical(fixed), 'utf8')) };
}

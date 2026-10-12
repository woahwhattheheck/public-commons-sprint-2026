/** MIT. Read the original MCP quote store for the existing buyer expense workspace.
 * No broker, operator module, wallet, signer, merchant or RPC is opened here.
 */
import {createHash} from 'node:crypto';
import {lstatSync, realpathSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SqliteQuoteStore} from './quote-store.mjs';
import {checkPaymentAttemptTerms, networkProfile, resolveRpcEndpoint} from
  '../../stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/terms.mjs';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hex = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const fail = (code, message = code) => { throw Object.assign(new Error(message), {code}); };
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ordered = v => Array.isArray(v) ? v.map(ordered) : plain(v) ?
  Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const digest = v => sha(ordered(v));
const DATE = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const matching = (value, quote, observation) => value?.intentId === quote.quoteId &&
  value.transaction === observation.transaction && value.network === quote.accepted.network &&
  value.asset === quote.accepted.asset && value.recipient === quote.accepted.payTo &&
  value.atomicAmount === quote.accepted.amount && value.payer === observation.payer;

/** Inspect the saved original SF86 report's binding; never perform verification again. */
export function inspectSavedMcpPayment(quote) {
  const observation = quote.result?.reconciliation ?? null;
  const base = {classification:quote.signedRequestDispatched ? 'UNRESOLVED' : 'NO_SIGNED_DISPATCH',
    observation:null, observationSha256:null, transferIdentity:null, problems:[]};
  if (observation === null) return base;
  const bad = code => ({...base, classification:'OBSERVATION_REVIEW_REQUIRED',
    observation:structuredClone(observation), observationSha256:digest(observation), problems:[code]});
  if (!plain(observation) || observation.schema !== 'stellar-forge.sf86.payment-attempt.v1')
    return bad('SAVED_OBSERVATION_FORMAT');
  if (!quote.signedRequestDispatched) return bad('OBSERVATION_WITHOUT_RECORDED_DISPATCH');
  try {
    const terms = checkPaymentAttemptTerms({intentId:quote.quoteId, requirement:quote.accepted,
      receipt:quote.result?.paymentResponse ?? null, transaction:observation.transaction}, observation.payer);
    const profile = networkProfile(quote.accepted.network);
    if (terms.transaction !== observation.transaction || !matching(observation, quote, observation) ||
        observation.source !== profile.rpcSource || !DATE(observation.checkedAt) ||
        !hex(observation.networkResultSha256) || !hex(observation.transactionResultSha256) ||
        observation.rpcEndpoint !== resolveRpcEndpoint(quote.accepted.network, observation.rpcEndpoint))
      return bad('SAVED_OBSERVATION_BINDING');
    if (observation.outcome === 'NOT_FOUND') {
      if (observation.rpcStatus !== 'NOT_FOUND' || observation.ledger !== null)
        return bad('SAVED_NOT_FOUND_BINDING');
      return {...base, classification:'UNRESOLVED', observation:structuredClone(observation),
        observationSha256:digest(observation)};
    }
    if (!Number.isSafeInteger(observation.ledger) || observation.ledger < 1)
      return bad('SAVED_LEDGER_BINDING');
    if (observation.outcome === 'FAILED') {
      if (observation.rpcStatus !== 'FAILED') return bad('SAVED_FAILED_BINDING');
      return {...base, classification:'FAILED_TRANSACTION', observation:structuredClone(observation),
        observationSha256:digest(observation)};
    }
    const transfer = observation.transfer;
    if (observation.outcome !== 'TRANSFER_MATCHED' || observation.rpcStatus !== 'SUCCESS' ||
        !plain(transfer) || transfer.schema !== 'stellar-forge.sf86.rpc-reconciliation.v1' ||
        !matching(transfer, quote, observation) || transfer.ledger !== observation.ledger ||
        transfer.verdict !== profile.transferVerdict || transfer.source !== profile.rpcSource ||
        transfer.rpcEndpoint !== observation.rpcEndpoint || transfer.networkPassphrase !== profile.passphrase ||
        transfer.matchingTransfers !== 1 || typeof transfer.matchingEventId !== 'string' ||
        !transfer.matchingEventId.length || transfer.matchingEventId.length > 512 ||
        !Number.isSafeInteger(transfer.eventPages) || transfer.eventPages < 1 ||
        !hex(transfer.networkResultSha256) || !hex(transfer.transactionResultSha256) ||
        !Array.isArray(transfer.eventPageSha256) || !transfer.eventPageSha256.length ||
        transfer.eventPageSha256.some(v => !hex(v)))
      return bad('SAVED_TRANSFER_BINDING');
    return {...base, classification:'TRANSFER_MATCHED', observation:structuredClone(observation),
      observationSha256:digest(observation), transferIdentity:digest({
        network:transfer.network, asset:transfer.asset, transaction:transfer.transaction,
        event:transfer.matchingEventId, payer:transfer.payer, recipient:transfer.recipient,
        amount:transfer.atomicAmount})};
  } catch (error) {
    return bad(typeof error.code === 'string' ? error.code : 'SAVED_OBSERVATION_INVALID');
  }
}

export function captureMcpExpenseSource({directory, maxBytes = 32 * 1024 * 1024, maxQuotes = 10000} = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory))
    fail('MCP_EXPENSE_SOURCE_PATH', 'Select an absolute original private MCP quote directory.');
  const selected = lstatSync(directory);
  if (selected.isSymbolicLink() || !selected.isDirectory())
    fail('MCP_EXPENSE_SOURCE_PATH', 'Select the original private quote directory itself.');
  const root = realpathSync(directory);
  const before = lstatSync(join(root, 'quotes.sqlite'), {bigint:true});
  const store = new SqliteQuoteStore({directory:root, readOnly:true, maxQuotes});
  try {
    const original = store.readSnapshot({maxBytes});
    const state = lstatSync(join(root, 'quotes.sqlite'), {bigint:true});
    if (before.dev !== state.dev || before.ino !== state.ino)
      fail('MCP_EXPENSE_SOURCE_REPLACED', 'The original quote database changed identity while it was being captured.');
    const records = original.quotes.map(quote => ({
      quote:structuredClone(quote), quoteSha256:sha(quote),
      identitySha256:digest({quoteId:quote.quoteId, resource:quote.resource, url:quote.url,
        method:quote.method, accepted:quote.accepted, invocation:quote.invocation ?? null,
        createdAt:quote.createdAt, operatorScope:quote.operatorScope}),
      payment:inspectSavedMcpPayment(quote),
    }));
    const snapshot = {schema:'stellar-forge.mcp-expense-source.v1', directory:root,
      identity:{device:String(state.dev), inode:String(state.ino)}, capturedAt:original.capturedAt,
      quoteBytes:original.quoteBytes, transitionCount:original.transitionCount,
      lastSequence:original.lastSequence, quoteCount:records.length,
      quoteProjectionSha256:sha(original.quotes), records,
      reader:'Original SqliteQuoteStore.readSnapshot; one read-only SQLite transaction',
      boundaries:{merchantCalled:false, signerLoaded:false, rpcCalled:false, sourceMutated:false,
        budgetReservationInferred:false, resultBodyCopied:false}};
    // Original payloads, bound observations and projected context remain complete.
    if (Buffer.byteLength(JSON.stringify(snapshot)) > maxBytes * 3 + 1024 * 1024)
      fail('MCP_EXPENSE_CAPTURE_CAPACITY', 'The complete source capture exceeds its retained output capacity.');
    return snapshot;
  } finally {
    store.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--state-dir')
      fail('MCP_EXPENSE_ARGUMENTS', 'Use --state-dir with the original private MCP quote directory.');
    process.stdout.write(JSON.stringify(captureMcpExpenseSource({directory:args[1]})) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({error:{code:error.code ?? 'MCP_EXPENSE_CAPTURE_FAILED',
      message:error.message ?? 'The complete original source could not be captured.'}}) + '\n');
    process.exitCode = 1;
  }
}

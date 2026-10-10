/** Safe, side-effect-free error interpretation for Stellar Forge's x402 v2 adapters.
 * Does not sign, broadcast, retry a paid request, or query a ledger.
 */
export const VERSION = 'stellar-forge.failure.v1';
export const STAGES = Object.freeze(['verify', 'settle', 'discovery', 'mcp', 'wallet']);
export const ACTIONS = Object.freeze({
  STOP: 'stop', REQUOTE_AND_REAUTHORIZE: 'requote_and_reauthorize',
  REAUTHORIZE: 'reauthorize', CHECK_ACCOUNT: 'check_account',
  CHANGE_ROUTE: 'change_route', RETRY_READ: 'retry_read',
  RECONCILE_SETTLEMENT: 'reconcile_settlement', REQUEST_APPROVAL: 'request_approval',
});

// Canonical x402 v2 codes plus local orchestration errors. Map prevents inherited
// property names (e.g. constructor, __proto__) being mistaken for known errors.
const ENTRIES = new Map([
  ['insufficient_funds', ['check_account', 'Wallet balance insufficient']],
  ['invalid_exact_evm_payload_authorization_valid_after', ['reauthorize', 'Authorization is not yet valid']],
  ['invalid_exact_evm_payload_authorization_valid_before', ['reauthorize', 'Authorization expired']],
  ['invalid_exact_evm_payload_authorization_value_mismatch', ['requote_and_reauthorize', 'Payment amount differs from terms']],
  ['invalid_exact_evm_payload_signature', ['reauthorize', 'Authorization signature invalid']],
  ['invalid_exact_evm_payload_recipient_mismatch', ['requote_and_reauthorize', 'Payment recipient differs from terms']],
  ['invalid_network', ['change_route', 'Unsupported network']],
  ['invalid_payload', ['stop', 'Invalid payment payload']],
  ['invalid_payment_requirements', ['stop', 'Invalid payment requirements']],
  ['invalid_scheme', ['change_route', 'Invalid payment scheme']],
  ['unsupported_scheme', ['change_route', 'Unsupported payment scheme']],
  ['invalid_x402_version', ['stop', 'Unsupported protocol version']],
  ['invalid_transaction_state', ['stop', 'Ledger transaction failed']],
  ['unexpected_verify_error', ['stop', 'Unexpected verification error']],
  ['unexpected_settle_error', ['reconcile_settlement', 'Settlement result uncertain']],
  ['settlement_pending', ['reconcile_settlement', 'Settlement confirmation pending']],
  ['discovery_not_found', ['stop', 'Resource is not indexed']],
  ['discovery_stale_terms', ['requote_and_reauthorize', 'Resource terms changed']],
  ['seller_identity_unverified', ['request_approval', 'Seller identity not verified']],
  ['wallet_trustline_missing', ['check_account', 'Wallet trustline missing']],
  ['budget_exceeded', ['request_approval', 'Buyer policy budget exceeded']],
  ['rpc_unavailable', ['retry_read', 'Read-only RPC unavailable']],
  ['rate_limited', ['retry_read', 'Read-only request rate limited']],
  ['timeout', ['retry_read', 'Read-only request timed out']],
  ['mcp_tool_missing', ['stop', 'MCP tool not found']],
]);
const TOKEN = /^[a-zA-Z0-9_.:-]{1,128}$/;
const clean = v => typeof v === 'string' && TOKEN.test(v) ? v : null;
const uncertainCodes = new Set(['settlement_pending', 'unexpected_settle_error', 'timeout', 'rpc_unavailable']);

/** Takes canonical verify/settle response shapes without modifying them. */
export function explainFailure({stage, reason, response = null, traceId, retryAfterMs} = {}) {
  if (!STAGES.includes(stage)) throw new TypeError('Invalid failure stage');
  if (response !== null && (typeof response !== 'object' || Array.isArray(response))) {
    throw new TypeError('response must be an object');
  }
  if (stage === 'verify' && response?.isValid === true) throw new TypeError('verify result is successful');
  if (stage === 'settle' && response?.success === true) throw new TypeError('settlement result is successful');
  const raw = stage === 'verify' ? response?.invalidReason ?? reason :
    stage === 'settle' ? response?.errorReason ?? reason : reason;
  const code = clean(raw) ?? 'unknown_upstream_error';
  const [action, text] = ENTRIES.get(code) ?? ['stop', 'Unrecognized upstream error'];
  const transaction = clean(response?.transaction);
  const network = clean(response?.network);
  const malformedPending = code === 'settlement_pending' && (!transaction || !network);
  const mayHaveSubmitted = stage === 'settle';
  const reconcile = mayHaveSubmitted && uncertainCodes.has(code);
  const recoveryAction = reconcile ? ACTIONS.RECONCILE_SETTLEMENT : action;
  const safeToAutoRetry = (stage === 'verify' || stage === 'discovery') && recoveryAction === ACTIONS.RETRY_READ;
  const result = {
    version: VERSION,
    code: malformedPending ? 'invalid_settlement_pending_response' : code,
    reason: malformedPending ? 'Pending settlement lacks transaction or network' : text,
    stage, traceId: clean(traceId) ?? 'unspecified', recoveryAction, safeToAutoRetry,
    requiresNewPaymentAuthorization: recoveryAction === ACTIONS.REAUTHORIZE ||
      recoveryAction === ACTIONS.REQUOTE_AND_REAUTHORIZE,
    settlementMayBePending: reconcile,
    settlement: mayHaveSubmitted ? Object.freeze({transaction, network, confirmed: false}) : null,
  };
  if (safeToAutoRetry && Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0 && retryAfterMs <= 3600000) {
    result.retryAfterMs = retryAfterMs;
  }
  return Object.freeze(result);
}

/** Trust only an independently obtained canonical ledger receipt, never model text.
 * All results have maySubmitPayment=false: a separate operator must authorize any payment.
 */
// Do not infer a payment transfer from transaction inclusion alone.
const PAYMENT_ATOMIC = /^[1-9][0-9]{0,77}$/;
function matchingVerifiedTransfer(receipt, expectedPayment) {
  if (receipt?.transferVerified !== true || !Array.isArray(receipt.transfers) ||
      receipt.transfers.length !== 1 || !expectedPayment) return false;
  const transfer = receipt.transfers[0];
  if (!transfer || typeof transfer !== 'object' || Array.isArray(transfer)) return false;
  if (!['from','payTo','asset'].every(k => clean(expectedPayment[k]) !== null) ||
      typeof expectedPayment.amount !== 'string' ||
      !PAYMENT_ATOMIC.test(expectedPayment.amount)) return false;
  return transfer.from === expectedPayment.from &&
    transfer.to === expectedPayment.payTo && transfer.asset === expectedPayment.asset &&
    transfer.amount === expectedPayment.amount;
}

export function gateNextAction(failure, {ledgerReceipt, expectedPayment, explicitNewAuthorization = false} = {}) {
  if (!failure || failure.version !== VERSION) throw new TypeError('unrecognized failure envelope');
  if (failure.settlementMayBePending) {
    const transaction = failure.settlement?.transaction;
    const network = failure.settlement?.network;
    const settled = Boolean(transaction && network && ledgerReceipt?.confirmed === true &&
      ledgerReceipt?.success === true && ledgerReceipt.transaction === transaction && ledgerReceipt.network === network &&
      matchingVerifiedTransfer(ledgerReceipt, expectedPayment));
    return Object.freeze({decision: settled ? 'already_settled' : 'reconcile_before_any_new_payment',
      maySubmitPayment: false, requiresManualReview: !settled});
  }
  if (failure.requiresNewPaymentAuthorization) {
    return Object.freeze({decision: explicitNewAuthorization ? 'prepare_new_authorization' : 'await_user_authorization',
      maySubmitPayment: false, requiresManualReview: !explicitNewAuthorization});
  }
  if (failure.safeToAutoRetry) {
    return Object.freeze({decision: 'retry_read_only_operation', maySubmitPayment: false, requiresManualReview: false});
  }
  return Object.freeze({decision: 'stop_or_request_user_action', maySubmitPayment: false, requiresManualReview: true});
}

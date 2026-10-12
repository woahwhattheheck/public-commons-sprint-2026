// MIT. Direct invoice payments use the original Stellar RPC catalogue and official XDR decoder.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {networkProfile, resolveRpcEndpoint, validStrKey} from '../../sf86-rpc-transfer-reconcile/terms.mjs';
import {rpc} from '../../sf86-rpc-transfer-reconcile/rpc-transport.mjs';

const HASH = /^[a-f0-9]{64}$/;
const INT64_MAX = (1n << 63n) - 1n;
const sha = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => sha(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(condition, code) {
  if (!condition) throw Object.assign(new Error(code), {code});
}
function atomic(value) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,7})?$/.test(value), 'CLASSIC_PAYMENT_AMOUNT_INVALID');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole + fraction.padEnd(7, '0'));
  need(amount > 0n && amount <= INT64_MAX, 'CLASSIC_PAYMENT_AMOUNT_INVALID');
  return amount.toString();
}
function assetValue(asset) {
  need(asset && typeof asset.isNative === 'function', 'CLASSIC_PAYMENT_ASSET_INVALID');
  if (asset.isNative()) return {kind: 'native', code: 'XLM', issuer: null};
  const code = asset.getCode(), issuer = asset.getIssuer();
  need(typeof code === 'string' && /^[a-zA-Z0-9]{1,12}$/.test(code) && validStrKey(issuer, 'G'), 'CLASSIC_PAYMENT_ASSET_INVALID');
  return {kind: 'credit', code, issuer};
}
function sameAsset(a, b) {
  return a?.kind === b?.kind && a?.code === b?.code && (a?.issuer ?? null) === (b?.issuer ?? null);
}
function switchName(value) {
  need(value && typeof value.switch === 'function', 'CLASSIC_PAYMENT_XDR_INVALID');
  return value.switch().name;
}
function memoValue(raw) {
  switch (switchName(raw)) {
    case 'memoNone': return {type: 'MEMO_NONE', value: ''};
    case 'memoText': {
      const bytes = Buffer.from(raw.text());
      const text = bytes.toString('utf8');
      need(Buffer.from(text, 'utf8').equals(bytes), 'CLASSIC_PAYMENT_MEMO_ENCODING_INVALID');
      return {type: 'MEMO_TEXT', value: text};
    }
    case 'memoId': return {type: 'MEMO_ID', value: raw.id().toString()};
    case 'memoHash': return {type: 'MEMO_HASH', value: Buffer.from(raw.hash()).toString('base64')};
    case 'memoReturn': return {type: 'MEMO_RETURN', value: Buffer.from(raw.retHash()).toString('base64')};
    default: throw Object.assign(new Error('CLASSIC_PAYMENT_MEMO_UNSUPPORTED'), {code: 'CLASSIC_PAYMENT_MEMO_UNSUPPORTED'});
  }
}

/** Resolve the same maintained SDK installation as the original SF43 decoder. */
export async function loadInvoiceStellarSdk() {
  try { return await import('@stellar/stellar-sdk/base'); }
  catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    try { return await import('@stellar/stellar-sdk'); }
    catch (rootError) {
      if (rootError.code !== 'ERR_MODULE_NOT_FOUND') throw rootError;
      const require = createRequire(new URL('../../sf88-operator-buyer-cli/package.json', import.meta.url));
      try { return require('@stellar/stellar-sdk/base'); }
      catch (localError) {
        if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(localError.code)) throw localError;
        return require('@stellar/stellar-sdk');
      }
    }
  }
}

function operationResults(sdk, rawResult, outer, inner) {
  const decoded = sdk.xdr.TransactionResult.fromXDR(rawResult, 'base64');
  let result = decoded.result();
  const bumped = outer !== inner;
  if (bumped) {
    need(switchName(result) === 'txFeeBumpInnerSuccess', 'FEE_BUMP_TRANSACTION_NOT_SUCCESS');
    const pair = result.innerResultPair();
    need(Buffer.from(pair.transactionHash()).toString('hex') === inner.hash().toString('hex'), 'FEE_BUMP_INNER_HASH_MISMATCH');
    result = pair.result().result();
  }
  need(switchName(result) === 'txSuccess', 'CLASSIC_TRANSACTION_RESULT_NOT_SUCCESS');
  const operations = result.results();
  need(Array.isArray(operations) && operations.length === inner.operations.length, 'CLASSIC_OPERATION_RESULT_COUNT_MISMATCH');
  return operations;
}

function decodedTransfer(sdk, operation, result, transactionSource, index) {
  if (!['payment', 'pathPaymentStrictReceive', 'pathPaymentStrictSend'].includes(operation.type)) return null;
  need(switchName(result) === 'opInner', 'CLASSIC_OPERATION_NOT_SUCCESS');
  const tr = result.tr();
  need(switchName(tr) === operation.type, 'CLASSIC_OPERATION_RESULT_TYPE_MISMATCH');
  const payment = tr.value();
  const expectedResult = operation.type === 'payment' ? 'paymentSuccess' :
    operation.type === 'pathPaymentStrictReceive' ? 'pathPaymentStrictReceiveSuccess' : 'pathPaymentStrictSendSuccess';
  need(switchName(payment) === expectedResult, 'CLASSIC_OPERATION_NOT_SUCCESS');
  const payer = operation.source || transactionSource;
  if (operation.type === 'payment') {
    return {operationIndex: index, operationType: operation.type, payer, recipient: operation.destination,
      asset: assetValue(operation.asset), amountAtomic: atomic(operation.amount)};
  }
  // Both successful path operations contain the actual final destination amount.
  const last = payment.success().last();
  const recipient = sdk.StrKey.encodeEd25519PublicKey(last.destination().ed25519());
  const asset = assetValue(sdk.Asset.fromOperation(last.asset()));
  const amountAtomic = last.amount().toString();
  need(/^[1-9][0-9]{0,18}$/.test(amountAtomic) && BigInt(amountAtomic) <= INT64_MAX, 'CLASSIC_PAYMENT_AMOUNT_INVALID');
  need(recipient === operation.destination && sameAsset(asset, assetValue(operation.destAsset)), 'PATH_PAYMENT_DESTINATION_RESULT_MISMATCH');
  if (operation.type === 'pathPaymentStrictReceive') {
    need(amountAtomic === atomic(operation.destAmount), 'PATH_PAYMENT_AMOUNT_RESULT_MISMATCH');
  } else {
    need(BigInt(amountAtomic) >= BigInt(atomic(operation.destMin)), 'PATH_PAYMENT_AMOUNT_RESULT_MISMATCH');
  }
  return {operationIndex: index, operationType: operation.type, payer, recipient, asset, amountAtomic};
}

/** Decode the official original envelope/result; this helper never performs a send. */
export async function decodeInvoiceStellarTransfer({request, returned, transactionResponse, sdk} = {}) {
  sdk ??= await loadInvoiceStellarSdk();
  const outer = sdk.TransactionBuilder.fromXDR(transactionResponse.envelopeXdr, request.networkPassphrase);
  const inner = outer.innerTransaction || outer;
  const envelopeHash = outer.hash().toString('hex'), innerTransactionHash = inner.hash().toString('hex');
  need(transactionResponse.txHash === returned.transaction && [envelopeHash, innerTransactionHash].includes(returned.transaction), 'CLASSIC_TRANSACTION_HASH_MISMATCH');
  const memo = memoValue(inner.tx.memo());
  need(memo.type === request.memo.type && memo.value === request.memo.value, 'CLASSIC_PAYMENT_MEMO_MISMATCH');
  const results = operationResults(sdk, transactionResponse.resultXdr, outer, inner);
  const transfers = inner.operations.map((operation, index) =>
    decodedTransfer(sdk, operation, results[index], inner.source, index)).filter(Boolean);
  const matches = transfers.filter(transfer => (returned.payer == null || transfer.payer === returned.payer) &&
    transfer.recipient === request.destination && sameAsset(transfer.asset, request.asset) &&
    transfer.amountAtomic === request.amountAtomic);
  need(matches.length === 1, matches.length ? 'CLASSIC_PAYMENT_AMBIGUOUS' : 'CLASSIC_PAYMENT_TERMS_MISMATCH');
  need(validStrKey(matches[0].payer, 'G'), 'CLASSIC_PAYMENT_PAYER_UNSUPPORTED');
  need(matches[0].payer !== matches[0].recipient, 'CLASSIC_PAYMENT_SELF_TRANSFER');
  const transactionHashes = [...new Set([envelopeHash, innerTransactionHash])];
  return {...matches[0], memo, envelopeHash, innerTransactionHash,
    transactionHashes, transactionFingerprints: transactionHashes.map(sha),
    envelopeXdrSha256: sha(Buffer.from(transactionResponse.envelopeXdr, 'base64')),
    resultXdrSha256: sha(Buffer.from(transactionResponse.resultXdr, 'base64'))};
}

/**
 * Trusted server-side invoice observer. Only catalogue HTTPS endpoints are accepted;
 * caller JSON cannot supply decoded transfer facts or replace the network response.
 */
export async function verifyInvoiceStellarTransfer({request, returned, fetchImpl = globalThis.fetch,
  rpcEndpoint, sdk, signal} = {}) {
  const observedAt = new Date().toISOString();
  need(plain(request) && plain(returned) && HASH.test(returned.transaction ?? '') && (returned.payer == null || validStrKey(returned.payer, 'G')), 'INVOICE_TRANSACTION_REFERENCE_INVALID');
  const profile = networkProfile(request.network);
  need(request.networkPassphrase === profile.passphrase && validStrKey(request.destination, 'G'), 'INVOICE_PAYMENT_NETWORK_OR_DESTINATION_INVALID');
  need(plain(request.asset) && (request.asset.kind === 'native' && request.asset.code === 'XLM' && request.asset.issuer == null ||
    request.asset.kind === 'credit' && /^[a-zA-Z0-9]{1,12}$/.test(request.asset.code ?? '') && validStrKey(request.asset.issuer, 'G')), 'INVOICE_PAYMENT_ASSET_INVALID');
  need(atomic(request.stellarAmount) === request.amountAtomic && plain(request.memo), 'INVOICE_PAYMENT_TERMS_INVALID');
  const endpoint = resolveRpcEndpoint(request.network, rpcEndpoint);
  const base = {schema: 'stellar-forge.invoice-stellar-transfer.v1', observedAt, network: request.network,
    networkPassphrase: profile.passphrase, transaction: returned.transaction, payer: returned.payer ?? null,
    transactionFingerprint: sha(returned.transaction),
    verificationScope: request.network === 'stellar:pubnet' ? 'OFFICIAL_PUBNET_RPC' : 'OFFICIAL_TESTNET_RPC'};
  const proof = {rpcEndpoint: endpoint, networkResponse: null, transactionResponse: null};
  try {
    proof.networkResponse = await rpc('getNetwork', {}, endpoint, fetchImpl, {signal});
    proof.networkResultSha256 = jsonHash(proof.networkResponse);
    need(proof.networkResponse.passphrase === profile.passphrase, 'RPC_NETWORK_PASSPHRASE_MISMATCH');
    proof.transactionResponse = await rpc('getTransaction', {hash: returned.transaction}, endpoint, fetchImpl, {signal});
    proof.transactionResultSha256 = jsonHash(proof.transactionResponse);
    const tx = proof.transactionResponse;
    if (tx.status === 'NOT_FOUND') return {...base, status: 'NOT_FOUND', reason: 'RPC_TRANSACTION_NOT_FOUND', proof};
    need(tx.status === 'SUCCESS', 'RPC_TRANSACTION_NOT_SUCCESS');
    need(tx.txHash === returned.transaction && Number.isSafeInteger(tx.ledger) && tx.ledger > 0, 'RPC_TRANSACTION_IDENTITY_INVALID');
    const seconds = typeof tx.createdAt === 'number' && Number.isSafeInteger(tx.createdAt) ? String(tx.createdAt) : tx.createdAt;
    need(typeof seconds === 'string' && /^[1-9][0-9]{0,12}$/.test(seconds) && Number.isSafeInteger(Number(seconds)), 'RPC_TRANSACTION_CLOSE_TIME_INVALID');
    const time = new Date(Number(seconds) * 1000);
    need(Number.isFinite(time.getTime()), 'RPC_TRANSACTION_CLOSE_TIME_INVALID');
    need(typeof tx.envelopeXdr === 'string' && tx.envelopeXdr.length > 0 && typeof tx.resultXdr === 'string' && tx.resultXdr.length > 0,
      'RPC_TRANSACTION_XDR_REQUIRED');
    const decoded = await decodeInvoiceStellarTransfer({request, returned, transactionResponse: tx, sdk});
    Object.assign(proof, decoded);
    return {...base, status: 'VERIFIED', payer: decoded.payer, recipient: decoded.recipient, asset: decoded.asset,
      amountAtomic: decoded.amountAtomic, memo: decoded.memo, ledger: tx.ledger, closedAt: time.toISOString(),
      operationIndex: decoded.operationIndex, operationType: decoded.operationType, proof};
  } catch (error) {
    if (signal?.aborted) throw error;
    return {...base, status: 'FAILED', reason: String(error?.code || 'INVOICE_TRANSFER_DECODE_FAILED'),
      detail: String(error?.message || error), proof};
  }
}

/** Bind trusted dependencies once at the application boundary. */
export function createInvoiceTransferVerifier(options = {}) {
  return ({request, returned}) => verifyInvoiceStellarTransfer({...options, request, returned});
}

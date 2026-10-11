// MIT. Presentation and explicit operator actions over the original commerce session.
import { createRequestView } from './request.mjs';
import { createStreamPanel } from './stream.mjs';
const byId = id => document.getElementById(id);
const tokenKey = 'stellar-forge-commerce-token';
const supplied = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(supplied)) {
  sessionStorage.setItem(tokenKey, supplied);
  history.replaceState(null, '', location.pathname);
}
const token = sessionStorage.getItem(tokenKey) ?? '';
const requestView = createRequestView({ request, notice });
let view, selectedIntent = '', previewIdentity, productIdentity, pending = false, selectionLoading = false, lastRequest = 0, refreshTimer;
const selectionPath = path => path + (selectedIntent ? '?intent=' + encodeURIComponent(selectedIntent) : '');
const readable = value => value === null || value === undefined ? '—' : String(value);
const label = value => readable(value).replaceAll('_', ' ').toLowerCase().replace(/^\w/, letter => letter.toUpperCase());
const size = value => Number.isSafeInteger(value) ? new Intl.NumberFormat().format(value) + ' bytes' : '—';
const time = value => {
  if (!value) return '—';
  const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
};
function text(id, value) { byId(id).textContent = readable(value); }
function facts(id, entries) {
  const target = byId(id); target.replaceChildren();
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    const term = document.createElement('dt'), detail = document.createElement('dd');
    term.textContent = name; detail.textContent = readable(value); target.append(term, detail);
  }
}
function notice(message, error = false) {
  const target = byId('notice'); target.hidden = !message; target.textContent = message ?? '';
  target.dataset.error = String(error);
}
async function request(path, { method = 'GET', body, raw = false, signal } = {}) {
  const headers = { 'x-commerce-token': token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, { method, headers, cache: 'no-store', signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.message ?? `Workspace request failed (${response.status}).`);
  }
  return raw ? response : response.json();
}
const streamPanel = createStreamPanel({ host:byId('stream-workspace'), request, action });
function link(container, title, value) {
  if (!value) return;
  let url;
  try { url = new URL(value); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
  const element = document.createElement('a'); element.textContent = title;
  element.href = url.href; element.target = '_blank'; element.rel = 'noopener noreferrer';
  container.append(element);
}
function operationsAddress(container, value) {
  if (!value) return;
  const field = document.createElement('input'); field.type = 'text'; field.readOnly = true;
  field.value = value; field.setAttribute('aria-label', 'Merchant operations URL');
  const button = document.createElement('button'); button.type = 'button';
  button.textContent = 'Copy merchant operations URL';
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(value); notice('Merchant operations URL copied. Paste it into a new browser tab.'); }
    catch { field.focus(); field.select(); notice('Copy the selected merchant operations URL and paste it into a new browser tab.'); }
  });
  const hint = document.createElement('span'); hint.className = 'muted';
  hint.textContent = 'Open this address directly in a new tab.';
  container.append(button, field, hint);
}
function render(next) {
  // Only a successful matching selection may unlock the selected operation.
  // An older preview/action callback or superseded refresh must not restore it.
  if (selectionLoading && next.operation?.intentId !== selectedIntent) return;
  selectionLoading = false;
  view = next;
  const { session, seller, operation: op, review, attempt, delivery, controls } = next;
  selectedIntent = op?.intentId ?? '';
  const select = byId('operation-select');
  const choices = next.operations.map(row => ({ value: row.intentId,
    text: row.method + ' · ' + row.intentId + ' · ' + (row.active ? 'Running' : label(row.state)) }));
  if (JSON.stringify(choices) !== select.dataset.choices) {
    select.replaceChildren(...choices.map(choice => new Option(choice.text, choice.value)));
    select.dataset.choices = JSON.stringify(choices);
  }
  select.value = selectedIntent; select.disabled = pending || choices.length < 2;
  const identity = selectedIntent + ':' + (delivery?.sha256 ?? '');
  if (previewIdentity !== identity) { byId('preview-area').hidden = true; previewIdentity = identity; }
  text('session-state', label(session.state)); text('session-id', session.id);
  text('seller-origin', seller.publicOrigin); text('seller-mode', label(seller.mode));
  text('intent', op?.intentId ?? 'No prepared buyer');
  text('operation-state', review ? 'Reviewed at ' + time(review.at) : label(op?.state));
  const streamResult = next.stream ? ({ COMPLETE:'Complete response', PARTIAL:'Partial response',
    FAILED:'Capture failed', CAPTURING:'Capturing response', AWAITING_RESPONSE:'Awaiting response',
    PREPARED:'Prepared request', CANCELLED:'Request cancelled', NO_CAPTURE:'Response not captured',
    RECOVERY_REQUIRED:'Original result needs recovery' }[next.stream.phase] ?? label(next.stream.phase)) +
    (next.stream.payment.settlement === 'REPORTED_SUCCESS' ? ' · payment reported settled' :
      next.stream.payment.buyerStatus === 'PAYMENT_REPORTED_FAILED' ? ' · payment reported failed' :
      next.stream.payment.buyerStatus === 'SETTLEMENT_PENDING' ? ' · payment pending' : '') : null;
  text('result-state', next.rpcRecovery?.state === 'SETTLED_RESULT_RECOVERED' ? 'Settled · result recovered' :
    next.rpcRecovery?.settlement ? 'Settled · response recovery pending' : streamResult ?? attempt?.outcome?.status ?? label(attempt?.state ?? 'NOT_RUN'));
  text('last-updated', 'Updated ' + time(next.updatedAt));
  text('method', op?.method); text('request-url', op?.url ?? 'This session has no prepared buyer operation.');
  const terms = op?.expect ?? {};
  facts('terms', [
    ['Network', terms.network], ['Asset', terms.asset], ['Recipient', terms.payTo],
    ['Quoted amount (atomic)', op?.quotedAtomic], ['Spending limit (atomic)', terms.maxAtomic],
    ['Offered timeout', op?.originalTerms?.maxTimeoutSeconds === undefined ? undefined : op.originalTerms.maxTimeoutSeconds + ' seconds'],
    ['Maximum timeout', terms.maxTimeoutSeconds === undefined ? undefined : terms.maxTimeoutSeconds + ' seconds'],
    ['Payment flow', label(terms.paymentFlow ?? 'authorization')],
    ['HTTP response deadline', next.stream?.configuration.requestTimeoutMs === undefined ? undefined : next.stream.configuration.requestTimeoutMs + ' ms'],
    ['Response destination', next.stream?.configuration.responseFile.destination],
  ]);
  facts('request-facts', [
    ['Intent', op?.intentId], ['Method', op?.method],
    ['Body', op?.bodyPresent ? size(op.bodyBytes) : 'None'],
    ['Operator', op?.operatorId], ['Service', op?.serviceId], ['Signer', op?.signerFilename],
    ['Merchant route', op?.routeId], ['Payment option index', op?.acceptIndex],
  ]);
  text('request-headers', JSON.stringify(op?.headers ?? {}, null, 2));
  byId('request-details').hidden = !op;
  requestView.render(op, controls);
  byId('review').disabled = pending || !controls.canReview;
  text('review-note', review ? 'The displayed operation is the current reviewed request.' : 'The operation comes from the prepared buyer configuration.');
  text('execution-state', attempt ? label(attempt.state) : review ? 'Ready to execute' : 'Awaiting review');
  text('execution-note', attempt?.state === 'RUNNING' ? 'The buyer is running. Answer its payment approval in the terminal that started this workspace. Interrupt this buyer retains its recorded progress; Stop session drains the merchant.' :
    next.activeIntent ? 'Another prepared operation is running: ' + next.activeIntent + '. This session runs one buyer at a time.' :
    attempt?.state === 'SETUP_FAILED' ? 'The buyer could not start. Resolve the reported setup error, then review this queued request again.' :
    op?.state === 'CANCELLED' ? 'This request was cancelled before execution and remains in the inbox.' :
    op?.state === 'RUNNING_OR_INTERRUPTED' ? 'This intent has a permanent attempt. Recover its recorded result before deciding what further work is needed.' :
    attempt?.outcome ? 'The buyer result is retained below. This attempted intent will not be executed again.' :
    seller.mode !== 'NATIVE_X402' ? 'This merchant is in challenge-only mode. Configure its native facilitator to execute a purchase.' :
    'Execution uses the configured buyer. Its payment approval appears in the terminal that started this workspace.');
  byId('execute').disabled = pending || !controls.canExecute;
  byId('cancel').disabled = pending || !controls.canCancel;
  byId('recover').hidden = !controls.canRecover;
  byId('recover').disabled = pending || !controls.canRecover;
  const outcome = attempt?.outcome;
  byId('outcome').hidden = !outcome && !attempt?.error;
  facts('outcome-facts', outcome ? [
    ['Buyer status', outcome.status ?? 'No result status'], ['HTTP status', outcome.httpStatus],
    ['Operation', outcome.intentId], ['Interrupted', outcome.interrupted ? 'Yes' : 'No'],
    ['Reservation', outcome.operatorReservation?.outcome],
    ['Error', outcome.error?.code ?? outcome.evidenceError?.code],
  ] : []);
  text('outcome-message', attempt?.error ?? outcome?.error?.operatorReason ?? outcome?.error?.code ??
    (outcome?.responseFile?.status === 'SAVED' ? 'The buyer saved the response. It is available in Delivery.' :
      outcome?.interrupted ? 'The buyer recorded an interrupted operation. Its recorded status appears above.' :
      'The recorded operation result is shown above.'));
  byId('outcome-details').hidden = !outcome;
  text('outcome-json', outcome ? JSON.stringify(outcome, null, 2) : '');
  const rpc = next.rpcRecovery, rpcAction = next.rpcAction;
  byId('rpc-recovery').hidden = !rpc;
  const transaction = byId('rpc-transaction');
  if (transaction.dataset.intent !== selectedIntent) {
    transaction.dataset.intent = selectedIntent; transaction.value = rpc?.settlement?.transaction ?? '';
  }
  byId('rpc-transaction-entry').hidden = Boolean(rpc?.settlement);
  byId('rpc-verify').hidden = !rpc?.canVerify;
  byId('rpc-verify').disabled = pending || !controls.canVerifyRpcPayment;
  byId('rpc-read').hidden = !rpc?.settlement || rpc?.responseFile?.status === 'SAVED';
  byId('rpc-read').disabled = pending || !controls.canRecoverRpcResponse;
  text('rpc-recovery-note', rpc?.responseFile?.status === 'SAVED' ?
    'The recovered response is retained with its original payment and request. Its read time is recorded separately below.' :
    rpc?.settlement ? 'The existing payment is settled. Recover paid read calls the same selected RPC method with the retained parameters and saves its current result.' :
    'Select the transaction for this original attempted request. The original ledger and Stellar transfer verifier authenticate it before a recovery read becomes available.');
  facts('rpc-recovery-facts', rpc ? [
    ['Original attempt', time(attempt?.startedAt)], ['Transaction', rpc.settlement?.transaction],
    ['Confirmed ledger', rpc.settlement?.ledger], ['Settled amount (atomic)', rpc.settlement?.amountAtomic],
    ['Recovery read started', rpc.responseFile?.recoveryReadStartedAt ? time(rpc.responseFile.recoveryReadStartedAt) : undefined],
    ['Recovery response observed', rpc.responseFile?.responseObservedAt ? time(rpc.responseFile.responseObservedAt) : undefined],
  ] : []);
  text('rpc-recovery-result', rpcAction?.state === 'RUNNING' ?
    rpcAction.operation === 'VERIFY_PAYMENT' ? 'Verifying the original reservation and transaction…' : 'Reading and saving the paid RPC result…' :
    rpcAction?.error ? label(rpcAction.error) : rpc?.settlement && !rpc.canRecover && !rpc.responseFile ?
      'Resume the product in its availability desk before requesting the recovery read.' : '');
  text('delivery-state', next.stream ? label(next.stream.phase) : delivery?.available ? 'Saved response' : label(delivery?.status ?? 'NO_SAVED_RESPONSE'));
  text('delivery-note', delivery?.source === 'SETTLED_RPC_RECOVERY_READ' ?
    'Download the exact saved recovery response. The original request time and the later provider read remain recorded together.' :
    delivery?.available ? 'Download the exact file saved by the buyer, or preview its contents.' :
    next.stream?.phase === 'PARTIAL' ? 'The original buyer retained an interrupted stream. Open its completed records below.' :
    next.stream ? 'The selected stream’s capture and original payment status appear below.' :
    'A response saved by the buyer appears here after the operation completes.');
  byId('delivery-facts').hidden = !delivery?.available;
  facts('delivery-facts', delivery?.available ? [
    ['Filename', delivery.name], ['Size', size(delivery.bytes)], ['Content type', delivery.contentType ?? 'Not supplied'],
    ['Saved location', delivery.path],
  ] : []);
  byId('preview').disabled = pending || !delivery?.available;
  byId('download').disabled = pending || !delivery?.available;
  streamPanel.render(next, { pending:pending || selectionLoading });
  const purchase = next.purchase, retrieval = next.retrieval, transfer = purchase?.transfer;
  byId('product-panel').hidden = !purchase;
  const currentProduct = selectedIntent + ':' + (purchase?.delivery?.sha256 ?? purchase?.delivery?.status ?? '');
  if (productIdentity !== currentProduct) { byId('product-preview-area').hidden = true; productIdentity = currentProduct; }
  const transferLabels = { INTERRUPTED: 'Download interrupted', REJECTED: 'Download needs restart',
    ACTIVE: 'Download in use', UNAVAILABLE: 'Download record unavailable' };
  text('product-state', retrieval?.state === 'RUNNING' ? 'Retrieving' :
    purchase?.delivery?.status === 'NOT_RETRIEVED' && transferLabels[transfer?.status]
      ? transferLabels[transfer.status] : label(purchase?.delivery?.status ?? 'NOT_RETRIEVED'));
  text('product-note', 'Retrieve uses this order’s existing entitlement and private claim token. On Linux, an interrupted download continues from its retained bytes. A completed local file is verified locally.');
  facts('product-facts', purchase ? [
    ['Order', purchase.orderReference], ['Expected size', size(purchase.file.bytes)],
    ['Expected SHA-256', purchase.file.sha256], ['Save location', purchase.destination],
    ['Merchant delivery', purchase.deliveryUrl],
    ...(Number.isSafeInteger(transfer?.retainedBytes) && transfer.retainedBytes > 0
      ? [['Retained download', size(transfer.retainedBytes) + ' of ' + size(purchase.file.bytes)]] : []),
  ] : []);
  byId('product-retrieve').disabled = pending || !controls.canRetrieve;
  text('product-retrieve', retrieval?.state === 'RUNNING' ? 'Retrieving…' :
    purchase?.delivery?.status === 'LOCAL_FILE_REQUIRES_CHECK' || purchase?.delivery?.available ? 'Check and recover local file' :
    transfer?.resumable && transfer.retainedBytes > 0
      ? transfer.retainedBytes === transfer.expectedBytes ? 'Finish saved download' : 'Resume download'
      : 'Retrieve entitled file');
  byId('product-preview').disabled = pending || !purchase?.delivery?.available;
  byId('product-download').disabled = pending || !purchase?.delivery?.available;
  const retrievalMessages = { PRIVATE_CLAIM_TOKEN_REQUIRED: 'Configure the separately supplied claim token in the environment that starts this session, then retrieve again.',
    ENTITLEMENT_NOT_AVAILABLE: 'Ask the merchant to check this order’s access and enrolled file, then resume with the current claim token. Retained bytes stay at the saved location.',
    DELIVERY_FINGERPRINT_MISMATCH: 'The returned bytes failed the promised file check. Review the merchant source before starting the download again.',
    DELIVERY_SOURCE_CHANGED: 'The merchant returned a different file version. Ask the merchant to restore the enrolled source before resuming.',
    TRANSFER_RESTART_REQUIRED: 'The retained bytes failed the promised file check. Review the merchant source, then discard this retained download to start it again.',
    FILE_TRANSFER_ACTIVE: 'Another process is using this saved download. Refresh after that process finishes or stops.',
    RESPONSE_FILE_ABORTED: 'The download was interrupted. Resume this order to continue its retained bytes.',
    RESPONSE_FILE_TIMEOUT: 'The download timed out. Resume this order to continue its retained bytes.',
    RESPONSE_FILE_READ_FAILED: 'The download connection stopped. Resume this order to continue its retained bytes.',
    RESPONSE_FILE_DIGEST_MISMATCH: 'The completed bytes failed the promised file check. Review the merchant source, then discard this retained download to start it again.' };
  text('product-result', retrieval?.error ? retrievalMessages[retrieval.error] ?? label(retrieval.error) :
    retrieval?.result?.status === 'FILE_TRANSFER_RESET' ? 'Retained download cleared. Retrieve this same entitled file to start from the beginning.' :
    retrieval?.result ? label(retrieval.result.status) + ' · ' + retrieval.result.httpRequests + ' merchant requests' +
      (retrieval.result.transfer?.resumedBytes ? ' · ' + size(retrieval.result.transfer.resumedBytes) + ' recovered locally' : '') :
    purchase?.delivery?.available ? 'The original file receipt is present. Preview and download check the current bytes against its hash.' :
    transfer?.lastError ? retrievalMessages[transfer.lastError] ?? label(transfer.lastError) :
    'The merchant handoff binds the promised product to this original order.');
  byId('product-transfer-panel').hidden = !transfer;
  facts('product-transfer-facts', transfer ? [
    ['State', label(transfer.status)],
    ['Retained bytes', Number.isSafeInteger(transfer.retainedBytes) ? size(transfer.retainedBytes) :
      transfer.status === 'ACTIVE' ? 'In use by another process' : 'Unavailable'],
    ['Expected bytes', size(transfer.expectedBytes ?? purchase.file.bytes)],
    ['Attempts', transfer.attempts ?? '—'], ['Transfer record', transfer.statePath ?? 'Unavailable'],
    ...(transfer.error ? [['Detail', retrievalMessages[transfer.error] ?? label(transfer.error)]] : []),
  ] : []);
  byId('product-reset-transfer').disabled = pending || !controls.canResetTransfer;
  byId('product-reset-transfer').hidden = !transfer?.canReset;
  text('product-transfer-note', transfer?.status === 'ACTIVE' ? 'The retained download is owned by a running process. Refresh after it releases the file.' :
    transfer?.status === 'REJECTED' ? 'Review the merchant’s original file, then discard this rejected local download and retrieve the same order again.' :
    transfer?.canReset ? 'Resume keeps these bytes. Discard retained download clears the unfinished local copy so a later Retrieve starts from the beginning.' :
    transfer?.status === 'COMPLETE' ? 'This download completed through the original file writer and its promised size and SHA-256 checks.' :
    'The original transfer record is retained with this order’s saved destination.');
  facts('product-binding', purchase ? [
    ['Original intent', purchase.request.intentId], ['Inbox job', purchase.request.inboxJobId],
    ['Frozen request SHA-256', purchase.request.configSha256], ['Attempt', purchase.request.attemptId ?? 'Not recorded'],
    ['Original evidence', purchase.evidence.path], ['Evidence status', label(purchase.evidence.status)],
    ['Evidence SHA-256', purchase.evidence.sha256], ['Handoff SHA-256', purchase.handoffSha256],
    ['Original file receipt', purchase.delivery.receiptPath], ['Receipt observed', purchase.delivery.receiptObservedAt],
  ] : []);
  text('product-evidence-note', purchase?.evidence.binding ?? 'The frozen inbox request binds this handoff and order. Original buyer evidence and the local file receipt retain their separate recorded outcomes.');
  const facilitator = next.facilitator, readiness = facilitator?.readiness;
  const readinessNotes = {
    NOT_PROBED: 'Check the configured network, node health and latest ledger before starting work.',
    READY: 'The configured network, node health and recent ledger satisfy this service’s readiness settings.',
    STALE: 'The recorded check has expired. Check payment service to refresh it.',
    NETWORK_MISMATCH: 'The node reports a different Stellar network. Correct the configured RPC address.',
    UNHEALTHY: 'The configured node reports an unhealthy state. Restore its service before continuing.',
    STALE_LEDGER: 'The reported ledger is too old or ahead of this host’s clock. Check node synchronization and host time.',
    INVALID_RESPONSE: 'The configured node returned an invalid RPC response. Check its endpoint and compatibility.',
    UNAVAILABLE: 'The configured RPC could not complete the check. Check its connection and availability.',
    DRAINING: 'This payment service is draining its accepted work.',
  };
  const serviceLabels = { EXISTING_HTTP_FACILITATOR: 'External', TRUSTED_NATIVE_EMBEDDING: 'Host managed',
    NATIVE_X402_FACILITATOR: 'Not checked', NOT_CONFIGURED: 'Not configured' };
  const nativeStopped = session.state === 'STOPPED' && facilitator?.mode === 'NATIVE_X402_FACILITATOR';
  text('facilitator-state', nativeStopped ? 'Stopped' : readiness ? label(readiness.state) : serviceLabels[facilitator?.mode] ?? 'Not configured');
  text('facilitator-note', nativeStopped ? 'This session’s payment service has stopped. Its last network observation remains below.' :
    readiness ? readinessNotes[readiness.state] ?? 'The current payment-service observation is shown below.' :
    facilitator?.mode === 'EXISTING_HTTP_FACILITATOR' ? 'This session uses its separately operated payment service.' :
    facilitator?.mode === 'TRUSTED_NATIVE_EMBEDDING' ? 'The host application operates this payment service.' :
    'Choose an embedded native facilitator in the retained commerce setup to use this network check.');
  facts('facilitator-facts', [
    ['Network', facilitator?.network], ['RPC', readiness?.rpcOrigin],
    ['Last node check', readiness?.health ? 'Healthy' : readiness?.checks?.getHealth ? label(readiness.checks.getHealth) : undefined],
    ['Latest ledger', readiness?.ledger?.sequence],
    ['Ledger closed', readiness?.ledger?.closeTime ? time(Number(readiness.ledger.closeTime) * 1000) : undefined],
    ['Observed', readiness?.checkedAt ? time(readiness.checkedAt) : undefined],
    ['Active verifications', facilitator?.activeVerify], ['Active settlements', facilitator?.activeSettle],
    ['Signer ownership', facilitator?.ownership?.mode === 'HOST_SIGNER_LEASES' ?
      facilitator.ownership.state === 'HELD' ? 'Held on this host' : label(facilitator.ownership.state) : facilitator?.ownership ? 'Process local' : undefined],
  ]);
  byId('facilitator').disabled = pending || selectionLoading || !controls.canProbeFacilitator;
  facts('seller-facts', [['Mode', label(seller.mode)], ['Listener', seller.listener],
    ['Routes', seller.routes?.length ?? 0], ['Started', time(session.startedAt)],
    ...(seller.jsonrpc ? [
      ['RPC data network', seller.jsonrpc.dataNetwork],
      ['Provider verified', time(seller.jsonrpc.networkVerifiedAt)],
      ['Read products', seller.jsonrpc.methods.join(', ')],
      ['Provider results', seller.jsonrpc.acceptedResults],
    ] : [])]);
  const links = byId('seller-links'); links.replaceChildren();
  link(links, 'Open developer workspace ↗', seller.developerUrl);
  operationsAddress(links, seller.operationsUrl);
  const routes = byId('routes'); routes.replaceChildren();
  for (const route of seller.routes ?? []) {
    const row = document.createElement('li'), method = document.createElement('span');
    method.className = 'method'; method.textContent = route.method;
    row.append(method, document.createTextNode(route.path ?? route.url ?? route.id));
    if (route.id) {
      const detail = document.createElement('span'); detail.className = 'muted'; detail.textContent = route.id; row.append(detail);
    }
    routes.append(row);
  }
  if (!seller.routes?.length) { const row = document.createElement('li'); row.textContent = 'No routes reported'; routes.append(row); }
  byId('stop').disabled = pending || !controls.canStop;
  text('stop-note', session.shutdownError ? 'Shutdown reported ' + session.shutdownError + '. The recorded drain status remains available.' :
    session.state === 'STOPPING' ? facilitator?.ownership?.mode === 'HOST_SIGNER_LEASES' ?
      'The session is draining. Signer ownership remains held while accepted payment work finishes.' :
      'The session is draining its accepted merchant and buyer work.' :
    session.state === 'STOPPED' && session.shutdown?.nativeCompletion ? 'Accepted payment work finished and signer ownership was released. The grace-period timeout remains recorded.' :
    session.state === 'STOPPED' ? 'The session has stopped. Saved results remain available in this workspace.' :
    'Stop and drain this workspace’s seller and buyer session. This interrupts its active buyer. Saved operation results remain available.');
}
async function refresh({ quiet = false } = {}) {
  if (pending) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh({ quiet: true }), 1500);
    return;
  }
  const order = ++lastRequest;
  try {
    const next = await request(selectionPath('/api/session'));
    if (order !== lastRequest) return;
    render(next);
    if (!quiet && !pending) notice(null);
  } catch (error) { if (order === lastRequest) notice(error.message, true); }
  finally {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh({ quiet: true }), view?.activeIntent || view?.retrieval?.state === 'RUNNING' || view?.rpcAction?.state === 'RUNNING' || view?.session?.state === 'STOPPING' ? 1500 : 6000);
  }
}
async function action(name, body = {}) {
  if (pending || selectionLoading && name !== 'stop') return;
  pending = true; if (view) render(view); notice(null);
  if (name === 'stop') notice('Stopping the active buyer and draining the merchant session…');
  if (name === 'interrupt') notice('Interrupting this buyer and retaining its original capture…');
  if (name === 'review') notice('Reading the prepared buyer request…');
  if (name === 'facilitator') notice('Checking the configured network, node health and latest ledger…');
  ++lastRequest;
  try {
    const next = await request('/api/' + name, { method: 'POST', body: { intent: selectedIntent, ...body } }); render(next);
    if (name === 'review') notice('Review ready. The exact prepared request and terms are shown above.');
    if (name === 'execute') notice('Operation started. Its progress and result will appear below.');
    if (name === 'interrupt') notice('This buyer finished handling the interruption. Its original result and captured bytes appear below.');
    if (name === 'cancel') notice('The queued request was cancelled and retained in the inbox.');
    if (name === 'recover') notice('The recorded result was recovered from the inbox.');
    if (name === 'retrieve') notice('File retrieval started. Its result will appear in Purchased file.');
    if (name === 'reset-transfer') notice('Retained download cleared. Use Retrieve entitled file to start this order’s download again.');
    if (name === 'verify-rpc-payment') notice('Existing-payment verification and its result are shown with this original attempt.');
    if (name === 'recover-rpc-response') notice('Recovery progress and the saved response are shown below.');
    if (name === 'facilitator') notice('Payment-service observation refreshed.');
    if (name === 'stop') notice(next.session.state === 'STOPPED' ? 'The session has stopped. Saved results remain available.' : 'The session is draining. Its progress remains visible below.');
  } catch (error) { notice(error.message, true); }
  finally { pending = false; if (view) render(view); await refresh({ quiet: true }); }
}
byId('refresh').addEventListener('click', () => refresh());
byId('operation-select').addEventListener('change', async event => {
  if (pending) return;
  selectionLoading = true;
  selectedIntent = event.target.value; ++lastRequest;
  streamPanel.reset();
  for (const id of ['review', 'execute', 'cancel', 'recover', 'preview', 'download', 'product-retrieve', 'product-reset-transfer', 'product-preview', 'product-download', 'facilitator', 'rpc-verify', 'rpc-read']) byId(id).disabled = true;
  byId('preview-area').hidden = true;
  byId('product-preview-area').hidden = true;
  await refresh();
});
byId('review').addEventListener('click', () => action('review'));
byId('facilitator').addEventListener('click', () => action('facilitator'));
byId('execute').addEventListener('click', () => action('execute', { reviewId: view?.review?.id }));
byId('cancel').addEventListener('click', () => action('cancel'));
function rpcSelection(transaction) {
  const original = view?.rpcRecovery?.original;
  return { transaction, expectedRequestSha256: original?.expectedRequestSha256,
    expectedAttemptId: original?.attemptId, expectedConfigSha256: original?.configSha256 };
}
byId('rpc-verify').addEventListener('click', () => action('verify-rpc-payment', rpcSelection(byId('rpc-transaction').value.trim())));
byId('rpc-read').addEventListener('click', () => action('recover-rpc-response', rpcSelection(view?.rpcRecovery?.settlement?.transaction)));
byId('recover').addEventListener('click', () => action('recover'));
byId('product-retrieve').addEventListener('click', () => action('retrieve', {
  configSha256: view?.purchase?.request.configSha256, handoffSha256: view?.purchase?.handoffSha256,
}));
byId('product-reset-transfer').addEventListener('click', () => action('reset-transfer', {
  configSha256: view?.purchase?.request.configSha256, handoffSha256: view?.purchase?.handoffSha256,
}));
byId('stop').addEventListener('click', () => action('stop'));
async function previewFile(prefix, path) {
  byId(prefix + 'preview').disabled = true;
  const intent = selectedIntent;
  try {
    const result = await request(selectionPath(path));
    if (selectedIntent !== intent) return;
    byId(prefix + 'preview-area').hidden = false;
    text(prefix + 'preview-text', result.text);
    text(prefix + 'preview-size', result.truncated ? 'First ' + size(result.bytes) + ' of ' + size(result.totalBytes) : size(result.totalBytes));
  } catch (error) { notice(error.message, true); }
  finally { if (view) render(view); }
}
async function downloadFile(prefix, path, delivery) {
  byId(prefix + 'download').disabled = true;
  const filename = delivery?.name ?? 'response.bin';
  try {
    const response = await request(selectionPath(path), { raw: true });
    const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { notice(error.message, true); }
  finally { if (view) render(view); }
}
byId('preview').addEventListener('click', () => previewFile('', '/api/preview'));
byId('download').addEventListener('click', () => downloadFile('', '/api/delivery', view?.delivery));
byId('product-preview').addEventListener('click', () => previewFile('product-', '/api/product-preview'));
byId('product-download').addEventListener('click', () => downloadFile('product-', '/api/product-delivery', view?.purchase?.delivery));
if (token) await refresh();
else notice('Open the complete local operator URL printed by the commerce console command.', true);

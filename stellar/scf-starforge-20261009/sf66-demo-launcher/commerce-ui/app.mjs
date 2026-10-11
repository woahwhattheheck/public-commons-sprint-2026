// MIT. Presentation and explicit operator actions over the original commerce session.
const byId = id => document.getElementById(id);
const tokenKey = 'stellar-forge-commerce-token';
const supplied = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(supplied)) {
  sessionStorage.setItem(tokenKey, supplied);
  history.replaceState(null, '', location.pathname);
}
const token = sessionStorage.getItem(tokenKey) ?? '';
let view, selectedIntent = '', previewIdentity, pending = false, selectionLoading = false, lastRequest = 0, refreshTimer;
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
async function request(path, { method = 'GET', body, raw = false } = {}) {
  const headers = { 'x-commerce-token': token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, { method, headers, cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.message ?? `Workspace request failed (${response.status}).`);
  }
  return raw ? response : response.json();
}
function link(container, title, value) {
  if (!value) return;
  let url;
  try { url = new URL(value); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
  const element = document.createElement('a'); element.textContent = title;
  element.href = url.href; element.target = '_blank'; element.rel = 'noopener noreferrer';
  container.append(element);
}
function render(next) {
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
  text('result-state', attempt?.outcome?.status ?? label(attempt?.state ?? 'NOT_RUN'));
  text('last-updated', 'Updated ' + time(next.updatedAt));
  text('method', op?.method); text('request-url', op?.url ?? 'This session has no prepared buyer operation.');
  const terms = op?.expect ?? {};
  facts('terms', [
    ['Network', terms.network], ['Asset', terms.asset], ['Recipient', terms.payTo],
    ['Quoted amount (atomic)', op?.quotedAtomic], ['Spending limit (atomic)', terms.maxAtomic],
    ['Offered timeout', op?.originalTerms?.maxTimeoutSeconds === undefined ? undefined : op.originalTerms.maxTimeoutSeconds + ' seconds'],
    ['Maximum timeout', terms.maxTimeoutSeconds === undefined ? undefined : terms.maxTimeoutSeconds + ' seconds'],
  ]);
  facts('request-facts', [
    ['Intent', op?.intentId], ['Method', op?.method],
    ['Body', op?.bodyPresent ? size(op.bodyBytes) : 'None'],
    ['Operator', op?.operatorId], ['Service', op?.serviceId], ['Signer', op?.signerFilename],
    ['Merchant route', op?.routeId], ['Payment option index', op?.acceptIndex],
  ]);
  text('request-headers', JSON.stringify(op?.headers ?? {}, null, 2));
  byId('request-details').hidden = !op;
  byId('review').disabled = pending || !controls.canReview;
  text('review-note', review ? 'The displayed operation is the current reviewed request.' : 'The operation comes from the prepared buyer configuration.');
  text('execution-state', attempt ? label(attempt.state) : review ? 'Ready to execute' : 'Awaiting review');
  text('execution-note', attempt?.state === 'RUNNING' ? 'The buyer is running. Answer its original payment approval in the terminal that started this workspace. Stop session interrupts remaining work and drains the merchant.' :
    next.activeIntent ? 'Another prepared operation is running: ' + next.activeIntent + '. This original session runs one buyer at a time.' :
    attempt?.state === 'SETUP_FAILED' ? 'The buyer could not start. Resolve the reported setup error, then review this queued request again.' :
    op?.state === 'CANCELLED' ? 'This request was cancelled before execution and remains in the inbox.' :
    op?.state === 'RUNNING_OR_INTERRUPTED' ? 'This intent has a permanent attempt. Recover its recorded result before deciding what further work is needed.' :
    attempt?.outcome ? 'The original buyer result is retained below. This attempted intent will not be executed again.' :
    seller.mode !== 'NATIVE_X402' ? 'This merchant is in challenge-only mode. Configure its original native facilitator to execute a purchase.' :
    'Execution uses the configured buyer. Its original payment approval appears in the terminal that started this workspace.');
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
  text('outcome-message', attempt?.error ?? outcome?.error?.code ??
    (outcome?.responseFile?.status === 'SAVED' ? 'The original buyer saved the response. It is available in Delivery.' :
      outcome?.interrupted ? 'The buyer recorded an interrupted operation. Its original status remains authoritative.' :
      'The original operation result is shown above.'));
  byId('outcome-details').hidden = !outcome;
  text('outcome-json', outcome ? JSON.stringify(outcome, null, 2) : '');
  text('delivery-state', delivery?.available ? 'Saved response' : label(delivery?.status ?? 'NO_SAVED_RESPONSE'));
  text('delivery-note', delivery?.available ? 'Download the exact file saved by the buyer, or preview its contents.' :
    'A response saved by the original buyer appears here after the operation completes.');
  byId('delivery-facts').hidden = !delivery?.available;
  facts('delivery-facts', delivery?.available ? [
    ['Filename', delivery.name], ['Size', size(delivery.bytes)], ['Content type', delivery.contentType ?? 'Not supplied'],
    ['Saved location', delivery.path],
  ] : []);
  byId('preview').disabled = pending || !delivery?.available;
  byId('download').disabled = pending || !delivery?.available;
  facts('seller-facts', [['Mode', label(seller.mode)], ['Listener', seller.listener],
    ['Routes', seller.routes?.length ?? 0], ['Started', time(session.startedAt)]]);
  const links = byId('seller-links'); links.replaceChildren();
  link(links, 'Open developer workspace ↗', seller.developerUrl);
  link(links, 'Open merchant operations ↗', seller.operationsUrl);
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
  text('stop-note', session.shutdownError ? 'Shutdown reported ' + session.shutdownError + '. The original result remains visible; inspect its recorded drain status.' :
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
    refreshTimer = setTimeout(() => refresh({ quiet: true }), view?.activeIntent ? 1500 : 6000);
  }
}
async function action(name, body = {}) {
  if (pending || selectionLoading) return;
  pending = true; if (view) render(view); notice(null);
  if (name === 'stop') notice('Stopping the active buyer and draining the merchant session…');
  if (name === 'review') notice('Reading the original buyer request review…');
  ++lastRequest;
  try {
    const next = await request('/api/' + name, { method: 'POST', body: { intent: selectedIntent, ...body } }); render(next);
    if (name === 'review') notice('Review ready. The exact prepared request and terms are shown above.');
    if (name === 'execute') notice('Operation started. Its progress and result will appear below.');
    if (name === 'cancel') notice('The queued request was cancelled and retained in the original inbox.');
    if (name === 'recover') notice('The original inbox recovered the recorded result without executing the request again.');
    if (name === 'stop') notice('The session has stopped. Saved results remain available.');
  } catch (error) { notice(error.message, true); }
  finally { pending = false; if (view) render(view); await refresh({ quiet: true }); }
}
byId('refresh').addEventListener('click', () => refresh());
byId('operation-select').addEventListener('change', async event => {
  if (pending) return;
  selectionLoading = true;
  selectedIntent = event.target.value; ++lastRequest;
  for (const id of ['review', 'execute', 'cancel', 'recover', 'preview', 'download']) byId(id).disabled = true;
  byId('preview-area').hidden = true;
  try { await refresh(); } finally { selectionLoading = false; if (view) render(view); }
});
byId('review').addEventListener('click', () => action('review'));
byId('execute').addEventListener('click', () => action('execute', { reviewId: view?.review?.id }));
byId('cancel').addEventListener('click', () => action('cancel'));
byId('recover').addEventListener('click', () => action('recover'));
byId('stop').addEventListener('click', () => action('stop'));
byId('preview').addEventListener('click', async () => {
  byId('preview').disabled = true;
  const intent = selectedIntent;
  try {
    const result = await request(selectionPath('/api/preview'));
    if (selectedIntent !== intent) return;
    byId('preview-area').hidden = false;
    text('preview-text', result.text);
    text('preview-size', result.truncated ? 'First ' + size(result.bytes) + ' of ' + size(result.totalBytes) : size(result.totalBytes));
  } catch (error) { notice(error.message, true); }
  finally { if (view) render(view); }
});
byId('download').addEventListener('click', async () => {
  byId('download').disabled = true;
  const filename = view?.delivery?.name ?? 'response.bin';
  try {
    const response = await request(selectionPath('/api/delivery'), { raw: true });
    const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { notice(error.message, true); }
  finally { if (view) render(view); }
});
if (token) await refresh();
else notice('Open the complete local operator URL printed by the commerce console command.', true);

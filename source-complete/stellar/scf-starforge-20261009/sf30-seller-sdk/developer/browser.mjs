// MIT. DOM-only rendering; no cookies, storage, CDN dependencies or automatic API calls.
import { buildUnpaidRequest, readLimitedResponse, decodePaymentRequired } from './request.mjs';
const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const json = value => JSON.stringify(value, null, 2);
const bodyMethods = new Set(['POST', 'PUT', 'PATCH']);
let documentSpec, operations = [], current, request, controller, revision = 0;
const setError = value => { text('input-error', value); $('input-error').hidden = !value; };
function invalidate() {
  revision++; controller?.abort(); controller = null;
  $('cancel').hidden = true; $('send').disabled = false; $('result').hidden = true;
}
function values() {
  return { path: Object.fromEntries([...$('path-fields').querySelectorAll('input')].map(input => [input.dataset.parameter, input.value])),
    query: JSON.parse($('query').value), body: $('body').value };
}
function preview() {
  invalidate();
  try {
    if (current['x-x402-payment-required'].extensions.bazaar.info.input.bodyType==='form-data') {
      request=null;setError('');$('copy').disabled=true;$('send').disabled=true;
      text('target',current['x-x402-payment-required'].resource.url);
      text('curl','Prepare and review a private file request in the API merchant workspace, or use SF88 --prepare --form-file with --form-out. The resulting body file retains its exact multipart boundary.');
      text('client-code',"// Read the retained body and Content-Type from your private buyer review.\n"+
        "const request = buildRequest("+JSON.stringify(current.operationId)+", {\n"+
        "  multipart: {body: retainedBytes, contentType: retainedContentType},\n"+
        "  // Include this operation's path and query values when declared.\n"+
        "}, {intentId: 'stable-business-operation-id', acceptIndex: 0, maxAtomic: 'YOUR_LIMIT'});\n"+
        "// Supply the original merchant ticket header when this operation requires it.\n"+
        "// Pass the request to your existing buyer approval and signer.");
      return;
    }
    request = buildUnpaidRequest(current, values(), location.origin);
    text('curl', request.curl); text('target', request.url); setError('');
    const inputs = values();
    const clientInputs = { ...(Object.keys(inputs.path).length ? { path: inputs.path } : {}),
      ...(Object.keys(inputs.query).length ? { query: inputs.query } : {}),
      ...(bodyMethods.has(current['x-seller-route'].method) ? { body: JSON.parse(inputs.body) } : {}) };
    const choice = $('client-payment-option').value;
    if (choice === '') text('client-code', 'Choose an original payment option to generate client usage.');
    else text('client-code', "import { buildRequest } from './seller-client.mjs';\n\n" +
      'const request = buildRequest(' + JSON.stringify(current.operationId) + ', ' + json(clientInputs) + ', {\n' +
      "  intentId: 'your-stable-business-operation-id',\n" +
      '  acceptIndex: ' + Number(choice) + ',\n' +
      '  maxAtomic: ' + JSON.stringify(current['x-x402-payment-required'].accepts[Number(choice)].amount) + ',\n});\n' +
      '// Pass request to your configured buyer with your approval and signer.');
    $('copy').disabled = false; $('send').disabled = false;
  } catch (error) {
    request = null; text('curl', 'Complete valid request inputs to generate a command.'); text('target', '—');
    text('client-code', 'Complete valid request inputs to generate client usage.');
    setError(error.message); $('copy').disabled = true; $('send').disabled = true;
  }
}
function renderPaymentOptions(target, accepts) {
  const container = $(target); container.replaceChildren();
  if (!Array.isArray(accepts) || !accepts.length) {
    const empty = document.createElement('p'); empty.className = 'hint';
    empty.textContent = 'No payment options were provided.'; container.append(empty); return 0;
  }
  const value = item => item === undefined ? 'Not provided' : typeof item === 'string' ? item : json(item);
  const known = new Set(['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra']);
  for (const [index, terms] of accepts.entries()) {
    const option = document.createElement('section'); option.className = 'payment-option';
    option.setAttribute('aria-label', `Payment option ${index + 1}`);
    const heading = document.createElement('div'); heading.className = 'payment-option-heading';
    const title = document.createElement('h4'); title.textContent = `Option ${index + 1}`;
    heading.append(title); option.append(heading);
    if (!terms || typeof terms !== 'object' || Array.isArray(terms)) {
      const raw = document.createElement('pre'); raw.textContent = value(terms);
      option.append(raw); container.append(option); continue;
    }
    const amount = document.createElement('strong'); amount.textContent = value(terms.amount);
    const unit = document.createElement('small');
    unit.textContent = terms.scheme === 'upto' ? 'atomic units · authorization ceiling' :
      terms.scheme === 'exact' ? 'atomic units / request' : 'atomic units · advertised amount';
    const price = document.createElement('div'); price.className = 'payment-option-price';
    price.append(amount, unit); heading.append(price);
    const fields = document.createElement('dl');
    for (const [label, content] of [
      ['Network', terms.network], ['Scheme', terms.scheme], ['Asset', terms.asset],
      ['Recipient', terms.payTo], ['Timeout (seconds)', terms.maxTimeoutSeconds],
    ]) {
      const name = document.createElement('dt'); name.textContent = label;
      const detail = document.createElement('dd'); detail.textContent = value(content);
      fields.append(name, detail);
    }
    option.append(fields);
    const additional = Object.fromEntries(Object.entries(terms).filter(([key]) => !known.has(key)));
    for (const [label, content] of [
      ['Additional terms (extra)', terms.extra],
      ['Other original fields', Object.keys(additional).length ? additional : undefined],
    ]) {
      if (content === undefined) continue;
      const name = document.createElement('p'); name.className = 'payment-option-extra-label'; name.textContent = label;
      const raw = document.createElement('pre'); raw.className = 'payment-option-extra'; raw.textContent = json(content);
      option.append(name, raw);
    }
    container.append(option);
  }
  return accepts.length;
}
function optionCount(count) { return `${count} option${count === 1 ? '' : 's'}`; }
function choose(operation) {
  current = operation; invalidate();
  const route = operation['x-seller-route'], offer = operation['x-x402-payment-required'];
  const input = offer.extensions.bazaar.info.input;
  text('method', route.method); text('path', route.path); text('description', operation.summary);
  text('payment-options-count', optionCount(renderPaymentOptions('payment-options', offer.accepts)));
  text('schema', json(offer.extensions.bazaar.schema)); text('offer', json(offer));
  text('projection-note', (documentSpec['x-schema-projection-notes'] ?? []).filter(note => note.startsWith(route.id + ':')).join('\n'));
  $('path-fields').replaceChildren();
  for (const name of route.path.split('/').filter(segment => segment.startsWith(':')).map(segment => segment.slice(1))) {
    const label = document.createElement('label'); label.textContent = name + ' · path';
    const field = document.createElement('input'); field.dataset.parameter = name;
    field.value = input.pathParams?.[name] ?? ''; field.autocomplete = 'off'; field.spellcheck = false;
    field.addEventListener('input', preview); label.append(field); $('path-fields').append(label);
  }
  $('query').value = json(input.queryParams ?? {});
  $('body').value = json(input.body ?? {}); $('body-field').hidden = !bodyMethods.has(route.method)||input.bodyType==='form-data';
  const choices = $('client-payment-option'); choices.replaceChildren();
  if (offer.accepts.length > 1) {
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a payment option';
    choices.append(placeholder);
  }
  offer.accepts.forEach((payment, index) => {
    const option = document.createElement('option'); option.value = String(index);
    option.textContent = `${index + 1}: ${payment.network} · ${payment.amount} atomic · ${payment.asset}`;
    choices.append(option);
  });
  choices.value = offer.accepts.length > 1 ? '' : '0';
  const required = (operation.parameters ?? []).filter(p => p.in === 'query' && p.required).map(p => p.name);
  text('required', required.length ? 'Required: ' + required.join(', ') : 'Omit unused optional parameters. Repeated values use JSON arrays of strings.');
  $('detail').hidden = false;
  for (const button of $('routes').children) button.setAttribute('aria-current', String(button.dataset.operation === operation.operationId));
  preview();
}
function renderRoutes() {
  const filter = $('filter').value.toLowerCase(); $('routes').replaceChildren();
  for (const operation of operations.filter(op => [op['x-seller-route'].method, op['x-seller-route'].path, op.summary].join(' ').toLowerCase().includes(filter))) {
    const button = document.createElement('button'); button.className = 'route'; button.dataset.operation = operation.operationId;
    button.setAttribute('aria-current', String(operation === current));
    const method = document.createElement('span'); method.className = 'method'; method.textContent = operation['x-seller-route'].method;
    const name = document.createElement('span'); name.className = 'route-name'; name.textContent = operation['x-seller-route'].path;
    button.append(method, name); button.addEventListener('click', () => choose(operation)); $('routes').append(button);
  }
  if (!$('routes').children.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'No matching endpoints.'; $('routes').append(empty); }
}
$('query').addEventListener('input', preview); $('body').addEventListener('input', preview);
$('client-payment-option').addEventListener('change', preview);
$('filter').addEventListener('input', renderRoutes);
const tabs = [...document.querySelectorAll('[data-tab]')];
function selectTab(button) {
  for (const tab of tabs) { const chosen = button === tab; tab.setAttribute('aria-selected', String(chosen)); tab.tabIndex = chosen ? 0 : -1; $(tab.dataset.tab + '-panel').hidden = !chosen; }
}
for (const [index, button] of tabs.entries()) {
  button.addEventListener('click', () => selectTab(button));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[target]); tabs[target].focus();
  });
}
selectTab(tabs[0]);
$('copy').addEventListener('click', async () => {
  if (!request) return;
  try { await navigator.clipboard.writeText(request.curl); $('copy').textContent = 'Copied'; }
  catch { const range = document.createRange(); range.selectNodeContents($('curl')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); $('copy').textContent = 'Select and copy'; }
  setTimeout(() => { $('copy').textContent = 'Copy curl'; }, 1800);
});
$('cancel').addEventListener('click', () => { invalidate(); setError('Request cancelled. No automatic retry.'); });
$('send').addEventListener('click', async () => {
  if (!request) return;
  invalidate(); const generation = revision, started = performance.now(); controller = new AbortController();
  const active = controller; const timer = setTimeout(() => active.abort(), 15000);
  $('send').disabled = true; $('cancel').hidden = false; setError('');
  try {
    const response = await fetch(request.url, { ...request.init, signal: active.signal });
    const body = await readLimitedResponse(response);
    if (generation !== revision) return;
    text('status', `HTTP ${response.status} · ${response.statusText}`);
    text('elapsed', `${Math.round(performance.now() - started)} ms`);
    text('headers', [...response.headers].map(([key, value]) => key + ': ' + value).join('\n'));
    text('response-body', body || '(empty response body)');
    $('response-payment-options-panel').hidden = true;
    try {
      const challenge = decodePaymentRequired(response.headers.get('payment-required'));
      text('challenge', json(challenge));
      if (Array.isArray(challenge?.accepts) && challenge.accepts.length) {
        text('response-payment-options-count', optionCount(renderPaymentOptions('response-payment-options', challenge.accepts)));
        $('response-payment-options-panel').hidden = false;
      }
    }
    catch (error) { text('challenge', error.message); }
    text('result-note', response.status === 402 ? 'Payment requirements received. No payment was signed or sent. These are the actual request-specific terms.' : 'An unpaid response was received. This does not establish successful payment or delivery; inspect the status and body.');
    $('result').hidden = false;
  } catch (error) {
    if (generation === revision) setError(active.signal.aborted ? 'Request timed out or was cancelled. No automatic retry.' : error.message);
  } finally {
    clearTimeout(timer);
    if (generation === revision) { controller = null; $('cancel').hidden = true; $('send').disabled = !request; }
  }
});
window.addEventListener('beforeunload', () => controller?.abort());
try {
  const response = await fetch('/_seller/openapi.json', { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Documentation unavailable: HTTP ${response.status}`);
  documentSpec = JSON.parse(await readLimitedResponse(response, 16 * 1024 * 1024));
  if (documentSpec.openapi !== '3.1.1' || !documentSpec.paths) throw new Error('Unsupported seller document');
  operations = Object.values(documentSpec.paths).flatMap(item => Object.values(item)).filter(op => op?.['x-seller-route']);
  if (!operations.length) throw new Error('No configured operations');
  text('title', documentSpec.info.title); document.title = documentSpec.info.title + ' · Starforge';
  text('mode', documentSpec['x-seller-runtime'] === 'NATIVE_X402' ? 'Native x402 runtime' : 'Challenge-only runtime');
  text('origin', documentSpec.servers[0].url); text('count', String(operations.length));
  renderRoutes(); choose(operations[0]);
} catch (error) { text('fatal', error.message); $('fatal').hidden = false; }

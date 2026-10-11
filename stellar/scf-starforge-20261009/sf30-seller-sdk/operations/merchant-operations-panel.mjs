// MIT. Local operator view; all state changes go through the original recover API.
const $ = id => document.getElementById(id);
const make = (tag,text,className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
let token = /^[a-f0-9]{64}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : '';
// Keep the capability in this page's memory, out of copied navigation URLs.
if (location.hash) history.replaceState(null,'',location.pathname + location.search);
const date = value => value ? new Date(value).toLocaleString() : '—';
const number = value => Number(value ?? 0).toLocaleString();
const labels = {IN_FLIGHT:'In flight',COMPLETE:'Complete',UNCERTAIN:'Uncertain outcome',RETRY_READY:'Ready for later request'};
let inventory, selected = null, nextCursor = null, nextAudit = null, busy = false;
let auditEvents = [];
const notice = (text,error=false) => { $('notice').textContent=text; $('notice').dataset.error=String(error); };
const messages = {
  OPERATION_RECOVERY_CONFLICT:'This operation changed. Its current record has been reloaded; review the new generation before another decision.',
  OPERATION_OWNER_STILL_ACTIVE:'The original worker still owns this operation. The ledger did not accept recovery while that worker can complete it.',
  OPERATION_CONTROL_TOKEN_REQUIRED:'Open the complete private operationControl URL printed by this running seller. The token may have changed after a restart.',
  OPERATION_CONTROLS_DISABLED:'Recovery controls are disabled for this listener. Start the original upstream operations launcher with --operation-controls.',
  OPERATION_INPUT_OR_RESPONSE_CONTRACT_INVALID:'The fields or recovered response do not match this binding. Check the backend record, allowed headers, response contract and reference.',
  OPERATION_STORAGE_CAPACITY:'The original ledger cannot reserve storage for this response. No recovery was recorded.',
  OPERATION_NOT_FOUND:'That exact operation is not stored in the selected binding.',
  OPERATION_STATE_UNAVAILABLE:'The original operation ledger is unavailable. Check the running seller before trying again.',
  OPERATION_INPUT_TOO_LARGE:'The backend response record exceeds the 2 MiB upload limit.',
};
async function api(path,query={},body) {
  const parameters = new URLSearchParams(Object.entries(query).filter(([,value]) => value !== undefined && value !== ''));
  const response = await fetch('/api/merchant-operations' + path + (parameters.size ? '?' + parameters : ''),{
    method:body === undefined ? 'GET' : 'POST',cache:'no-store',credentials:'same-origin',
    headers:body === undefined ? {} : {'content-type':'application/json','x-merchant-operation-token':token},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  let value;
  try { value = await response.json(); } catch { throw new Error('The local console returned an unreadable response. Refresh the stored operation before retrying a decision.'); }
  if (!response.ok) throw Object.assign(new Error(messages[value.error] ?? value.error ?? 'Operation request failed'),{code:value.error});
  return value;
}
function availability() {
  const attached = Boolean(inventory?.available);
  const eligible = Boolean(selected && ['UNCERTAIN','IN_FLIGHT'].includes(selected.state));
  $('filters').disabled = busy || !attached;
  $('refresh').disabled = busy;
  $('first-page').disabled = busy || !attached;
  $('next-page').disabled = busy || !nextCursor;
  $('more-audit').disabled = busy || !nextAudit;
  $('recovery-fields').disabled = busy || !eligible || !inventory?.controlsEnabled || !token;
  for (const button of document.querySelectorAll('[data-operation]')) button.disabled = busy;
}
async function act(work) {
  if (busy) return;
  busy = true; availability();
  try { await work(); }
  catch (error) { notice(error.message || 'The local console is unavailable. Refresh the stored operation before retrying a decision.',true); }
  finally { busy = false; availability(); }
}
function renderInventory(value) {
  inventory = value;
  $('setup').hidden = value.available;
  $('desk-content').hidden = !value.available;
  $('binding').replaceChildren(...value.bindings.map(binding => {
    const option = make('option',binding.name); option.value = binding.name; return option;
  }));
  renderControl();
}
function renderControl() {
  $('control-mode').textContent = inventory?.controlsEnabled && token ? 'Recovery enabled' : 'Read only';
  $('footer-mode').textContent = inventory?.controlsEnabled ? 'Recovery requires the private startup capability' : 'Recovery controls disabled';
  $('control-help').textContent = !inventory?.controlsEnabled ? 'Read only. Enable operation controls in the original launcher to reconcile an uncertain outcome here.' :
    !token ? 'Read only in this tab. Open the complete private operationControl URL printed at startup to enable recovery.' :
      'Recovery is enabled in this tab. The original ledger checks the exact request and generation again when you submit.';
}
// Opening the private URL from an already open read-only page can be a same-
// document fragment navigation. Adopt that capability without requiring a reload.
addEventListener('hashchange',() => {
  if (!location.hash) return;
  token = /^[a-f0-9]{64}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : '';
  history.replaceState(null,'',location.pathname + location.search);
  renderControl(); availability();
});
function renderRows(page) {
  nextCursor = page.nextCursor;
  for (const [state,total] of Object.entries(page.totals)) $('total-' + state).textContent = number(total);
  $('records').replaceChildren(...page.records.map(record => {
    const row = make('tr'); row.setAttribute('aria-selected',String(record.operationKey === selected?.operationKey));
    const heading = make('th'); heading.scope = 'row';
    const button = make('button',record.operationKey.slice(0,16) + '…','operation-select');
    button.type = 'button'; button.dataset.operation = record.operationKey; button.title = record.operationKey;
    button.setAttribute('aria-label','Open operation ' + record.operationKey);
    button.addEventListener('click',() => act(async () => { await openOperation(record.operationKey); notice('Loaded the current operation and original ledger history.'); $('detail-title').scrollIntoView({block:'start'}); }));
    heading.append(button); row.append(heading);
    for (const text of [labels[record.state],record.attempt,record.generation,date(record.updatedAt),record.status ?? '—',number(record.bodyBytes)]) row.append(make('td',String(text)));
    return row;
  }));
  $('records-empty').hidden = page.records.length !== 0;
  $('page-note').textContent = `${page.records.length} records · Updated ${date(page.capturedAt)} · Counts cover this entire binding`;
}
async function list(cursor) {
  const binding = inventory.bindings.find(value => value.name === $('binding').value);
  $('binding-note').textContent = `${binding.scope} · ${binding.method} · Stored response limit ${number(binding.maxResponseBytes)} bytes`;
  renderRows(await api('/list',{binding:binding.name,state:$('state').value,cursor}));
}
function renderAudit() {
  $('audit').replaceChildren(...auditEvents.map(event => {
    const row = make('tr'), heading = make('th',date(event.at)); heading.scope = 'row'; row.append(heading);
    for (const text of [event.generation,labels[event.state],event.reference ?? '—']) row.append(make('td',String(text)));
    return row;
  }));
  $('more-audit').hidden = !nextAudit;
}
function renderDetail() {
  $('detail').hidden = !selected;
  if (!selected) return;
  $('detail-summary').textContent = `Attempt ${selected.attempt} · Generation ${selected.generation} · Updated ${date(selected.updatedAt)}`;
  $('detail-state').textContent = labels[selected.state];
  const rows = [
    ['Operation key',selected.operationKey,true],['Backend operation key',selected.backendKey,true],
    ['Exact request hash',selected.requestHash,true],['Created',date(selected.createdAt)],
    ['Saved HTTP status',selected.status ?? '—'],['Saved response bytes',number(selected.bodyBytes)],
    ['Response SHA-256',selected.bodySha256 ?? '—',true],['Last outcome',selected.error ?? '—'],
    ['Backend reference',selected.reference ?? '—'],
  ];
  $('operation-detail').replaceChildren(...rows.flatMap(([label,value,hash]) => [make('dt',label),make('dd',String(value),hash ? 'desk-hash' : '')]));
  $('recovery-state').textContent = selected.state === 'COMPLETE' ? 'The completed backend result is durably stored for replay. There is no recovery action for this state.' :
    selected.state === 'RETRY_READY' ? 'The next original request may attempt this operation. This console has not sent a backend request.' :
    selected.state === 'IN_FLIGHT' ? 'The original worker owns this operation. Recovery is accepted only after the ledger confirms that owner is no longer active on this host.' :
      'The backend outcome is uncertain. Look up the exact backend operation key before choosing a recovery action.';
  $('recovery-form').hidden = !['UNCERTAIN','IN_FLIGHT'].includes(selected.state);
  $('confirm').checked = false;
  $('confirm-label').textContent = `I checked the merchant backend for this exact operation. Apply this decision to generation ${selected.generation}.`;
  for (const row of $('records').children) row.setAttribute('aria-selected',String(row.querySelector('button')?.dataset.operation === selected.operationKey));
  renderAudit(); renderAction();
}
async function openOperation(operationKey) {
  const detail = await api('/detail',{binding:$('binding').value,operationKey});
  if (selected?.operationKey !== operationKey) {
    $('response-file').value = ''; $('response-summary').textContent = ''; $('reference').value = '';
    $('action').value = 'complete';
  }
  selected = detail.operation; auditEvents = detail.audit.events; nextAudit = detail.audit.nextAfter;
  renderDetail();
}
function clearSelection() {
  selected = null; nextAudit = null; auditEvents = [];
  $('response-file').value = ''; $('response-summary').textContent = ''; $('reference').value = '';
  renderDetail();
}
function renderAction() {
  const complete = $('action').value === 'complete';
  $('response-input').hidden = !complete;
  $('response-file').required = complete;
  $('recover').textContent = complete ? 'Record completed result' : 'Allow later execution';
  $('action-effect').textContent = complete ? 'Save this actual backend response as COMPLETE for the selected generation. A later original request can replay these bytes.' :
    'Record RETRY_READY for the selected generation. Only a later original request can execute the backend; this action does not retry or settle a payment.';
}
$('refresh').addEventListener('click',() => act(async () => {
  const value = await api('');
  if (!inventory?.available) renderInventory(value);
  if (value.available) { await list(); if (selected) await openOperation(selected.operationKey); }
  notice('Refreshed the original merchant ledger.');
}));
$('binding').addEventListener('change',() => act(async () => { clearSelection(); $('operation-key').value = ''; await list(); notice('Loaded the selected upstream binding.'); }));
$('state').addEventListener('change',() => act(async () => { await list(); notice('Updated the stored operation filter.'); }));
$('first-page').addEventListener('click',() => act(() => list()));
$('next-page').addEventListener('click',() => act(() => list(nextCursor)));
$('filters-form').addEventListener('submit',event => { event.preventDefault(); act(async () => {
  const key = $('operation-key').value.trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Enter the complete 64-character operation key.');
  await openOperation(key); notice('Loaded the exact operation and original ledger history.');
}); });
$('more-audit').addEventListener('click',() => act(async () => {
  const detail = await api('/detail',{binding:$('binding').value,operationKey:selected.operationKey,after:nextAudit});
  selected = detail.operation; auditEvents.push(...detail.audit.events); nextAudit = detail.audit.nextAfter; renderDetail();
}));
$('action').addEventListener('change',() => { $('confirm').checked = false; renderAction(); });
$('response-file').addEventListener('change',() => {
  $('confirm').checked = false;
  const file = $('response-file').files[0];
  $('response-summary').textContent = file ? `${file.name} · ${number(file.size)} bytes` : '';
});
$('recovery-form').addEventListener('submit',event => { event.preventDefault(); act(async () => {
  if (!selected || !['UNCERTAIN','IN_FLIGHT'].includes(selected.state) || !$('confirm').checked) throw new Error('Review the current uncertain operation before recording a decision.');
  const operation = selected, action = $('action').value;
  const input = {binding:$('binding').value,operationKey:operation.operationKey,requestHash:operation.requestHash,
    expectedGeneration:operation.generation,action,reference:$('reference').value.trim()};
  if (action === 'complete') {
    const file = $('response-file').files[0];
    if (!file) throw new Error('Select the actual backend response record.');
    if (file.size > inventory.maxInputBytes) throw new Error('The backend response record exceeds the 2 MiB upload limit.');
    try { input.response = JSON.parse(await file.text()); }
    catch { throw new Error('The selected backend response record is not valid JSON.'); }
  }
  try { await api('/recover',{},input); }
  catch (error) {
    // A stale decision is never resubmitted. A lost response may already have
    // committed, so re-read the original record before the operator acts again.
    try { await openOperation(operation.operationKey); await list(); } catch {}
    if (!error.code) error.message = 'The console did not return a recovery receipt. Refresh this operation to see whether the ledger changed before recording another decision.';
    throw error;
  }
  await openOperation(operation.operationKey); await list();
  notice(action === 'complete' ? 'Recorded the backend result as COMPLETE. The saved response is available to the original handler for replay.' :
    'Recorded RETRY_READY. No backend request or payment was made by this console.');
}); });
act(async () => {
  renderInventory(await api(''));
  if (inventory.available) await list();
  notice(inventory.available ? 'Connected to the running seller’s original merchant ledger.' : 'This seller has no durable merchant operation binding.');
});

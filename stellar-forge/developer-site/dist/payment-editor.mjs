import { MAX_PAYMENT_OPTIONS, usesSharedPayment, paymentChoicesForResource, paymentDeclarationStyle } from './onboarding.mjs';

const fields = ['network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds', 'extra'];
const nativeFields = ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds', 'extra', 'extraText'];
const clone = value => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const text = (tag, value, className) => {
  const node = document.createElement(tag); node.textContent = String(value ?? '');
  if (className) node.className = className; return node;
};

/** Edit only a resource's terms; route metadata and selected data stay with setup. */
export function createPaymentEditor({ root, getInput, getResourceIndex, selectResource, onChange }) {
  let selected = 0, lastResource = null, undo = null, errors = [];
  const $ = id => root.querySelector('#' + id);
  const resource = () => getInput().resources[getResourceIndex()];
  const choices = () => paymentChoicesForResource(getInput(), resource());
  const button = (label, action, className = 'text-button') => {
    const node = text('button', label, className); node.type = 'button';
    node.addEventListener('click', action); return node;
  };
  root.innerHTML = `
    <div class="payment-heading">
      <div class="field"><label for="payment-resource">Resource payment terms</label><select id="payment-resource"></select></div>
      <label class="payment-mode"><input id="payment-shared" type="checkbox"> Use workspace defaults</label>
    </div>
    <p id="payment-mode-note" class="pane-intro"></p>
    <div class="payment-grid">
      <aside class="payment-sidebar">
        <span id="payment-count" class="small-label"></span>
        <div id="payment-list" class="payment-list" aria-label="Ordered payment choices"></div>
        <button id="payment-add" type="button" class="button small">Add payment choice +</button>
        <p class="hint">Order is retained in the original offer. Each choice needs a distinct network, asset or recipient.</p>
      </aside>
      <div class="payment-detail">
        <div class="payment-toolbar"><strong id="payment-title"></strong><div>
          <button id="payment-up" class="text-button" type="button">Move up</button>
          <button id="payment-down" class="text-button" type="button">Move down</button>
          <button id="payment-remove" class="text-button" type="button">Remove</button>
        </div></div>
        <fieldset id="payment-fields" class="payment-fields">
          <legend class="small-label">EXACT PAYMENT TERMS</legend>
          <div class="field-grid">
            <div class="field"><label for="payment-network">Network</label><select id="payment-network" aria-describedby="payment-network-error"><option value="stellar:testnet">Stellar testnet</option><option value="stellar:pubnet">Stellar public network</option></select><p id="payment-network-error" class="field-error" hidden></p></div>
            <div class="field"><label for="payment-amount">Price in atomic units</label><input id="payment-amount" inputmode="numeric" autocomplete="off" spellcheck="false" aria-describedby="payment-amount-error"><p id="payment-amount-error" class="field-error" hidden></p></div>
            <div class="field full"><label for="payment-asset">Asset contract</label><input id="payment-asset" maxlength="128" autocomplete="off" spellcheck="false" aria-describedby="payment-asset-error"><p id="payment-asset-error" class="field-error" hidden></p></div>
            <div class="field full"><label for="payment-payTo">Public recipient</label><input id="payment-payTo" maxlength="128" autocomplete="off" spellcheck="false" aria-describedby="payment-payTo-error"><p id="payment-payTo-error" class="field-error" hidden></p></div>
            <div class="field"><label for="payment-maxTimeoutSeconds">Timeout in seconds</label><input id="payment-maxTimeoutSeconds" inputmode="numeric" autocomplete="off" aria-describedby="payment-maxTimeoutSeconds-error"><p id="payment-maxTimeoutSeconds-error" class="field-error" hidden></p></div>
            <div class="field full"><label for="payment-extra">Extra JSON object <span class="hint">(optional)</span></label><textarea id="payment-extra" class="code-input payment-extra" spellcheck="false" placeholder="{}" aria-describedby="payment-extra-hint payment-extra-error"></textarea><p id="payment-extra-hint" class="hint">Original JSON metadata stays with this choice. Leave blank to omit it. Drafts retain incomplete edits; export requires a complete object within the native 8 KiB limit.</p><p id="payment-extra-error" class="field-error" hidden></p></div>
          </div>
        </fieldset>
        <div id="payment-original-fields" class="payment-original-fields" hidden></div>
        <p id="payment-selection-errors" class="field-error" hidden></p>
        <div class="payment-copy">
          <div class="field"><label for="payment-copy-source">Copy terms from another resource</label><select id="payment-copy-source"></select></div>
          <button id="payment-copy" class="button small" type="button">Replace this route's choices</button>
        </div>
        <div class="payment-bottom"><span id="payment-shape" class="hint"></span><button id="payment-undo" class="text-button" type="button" hidden>Undo last list change</button></div>
      </div>
    </div>
  `;
  function remember() {
    const current = resource();
    undo = { resource: current, values: Object.fromEntries(['paymentMode', 'paymentStyle', 'paymentOptions'].filter(key => own(current, key)).map(key => [key, clone(current[key])])), selected };
  }
  function editList(change) {
    remember(); change(); render(); onChange();
  }
  function renderList() {
    const list = choices(), shared = usesSharedPayment(resource());
    $('payment-count').textContent = 'CHOICES / ' + list.length + ' OF ' + MAX_PAYMENT_OPTIONS;
    $('payment-list').replaceChildren(...list.map((choice, index) => {
      const node = button('', () => { selected = index; render(); }, 'payment-choice');
      node.setAttribute('aria-pressed', String(index === selected));
      const term = choice && typeof choice === 'object' ? choice : {};
      node.append(text('strong', String(index + 1).padStart(2, '0') + '  ' + (term.network || 'Choose network')),
        text('code', term.amount || 'Set atomic price'), text('small', term.asset || 'Set asset'), text('small', term.payTo || 'Set recipient'));
      return node;
    }));
    $('payment-add').disabled = shared || list.length >= MAX_PAYMENT_OPTIONS;
    $('payment-up').disabled = shared || selected <= 0;
    $('payment-down').disabled = shared || selected >= list.length - 1;
    $('payment-remove').disabled = shared || list.length <= 1;
    $('payment-title').textContent = 'Choice ' + (selected + 1) + ' of ' + list.length;
    $('payment-undo').hidden = !undo || undo.resource !== resource();
    $('payment-shape').textContent = 'Native declaration: ' + paymentDeclarationStyle(getInput(), resource(), list) + '. Atomic values remain exact strings.';
  }
  function renderOriginalFields(choice) {
    const container = $('payment-original-fields');
    const extraKeys = Object.keys(choice).filter(key => !nativeFields.includes(key));
    container.hidden = extraKeys.length === 0;
    container.replaceChildren();
    if (!extraKeys.length) return;
    container.append(text('h4', 'Additional original fields'), text('p', 'Legacy singleton fields remain in seller.json. Native paymentOptions accepts only its documented term fields. Remove a field explicitly before converting this declaration to multiple choices.', 'hint'));
    for (const key of extraKeys) {
      const row = document.createElement('div');
      row.append(text('code', key + ': ' + JSON.stringify(choice[key])));
      const remove = button('Remove field', () => editList(() => { delete resource().paymentOptions[selected][key]; }));
      remove.disabled = usesSharedPayment(resource()); row.append(remove); container.append(row);
    }
  }
  function showErrors(next) {
    errors = next;
    const prefix = 'resources.' + getResourceIndex() + '.paymentOptions.' + selected + '.';
    for (const name of fields) {
      const found = errors.find(error => error.field === prefix + name);
      $('payment-' + name).setAttribute('aria-invalid', String(Boolean(found)));
      $('payment-' + name + '-error').hidden = !found;
      $('payment-' + name + '-error').textContent = found?.message || '';
    }
    const others = errors.filter(error => error.field === 'resources.' + getResourceIndex() + '.paymentOptions' || error.field === prefix + 'scheme' || error.field === prefix + 'fields' || error.field === prefix.slice(0, -1));
    $('payment-selection-errors').hidden = others.length === 0;
    $('payment-selection-errors').textContent = others.map(error => error.message).join(' ');
  }
  function render() {
    const current = resource(), shared = usesSharedPayment(current);
    if (lastResource !== current) { selected = 0; lastResource = current; }
    const list = choices();
    selected = Math.max(0, Math.min(selected, list.length - 1));
    const choice = list[selected] && typeof list[selected] === 'object' ? list[selected] : {};
    $('payment-resource').replaceChildren(...getInput().resources.map((r, index) => {
      const option = text('option', (r.serviceName || r.id || 'Resource ' + (index + 1)) + ' · GET ' + (r.path || '/…'));
      option.value = String(index); return option;
    }));
    $('payment-resource').value = String(getResourceIndex());
    $('payment-shared').checked = shared;
    $('payment-mode-note').textContent = shared
      ? 'This route uses workspace defaults and its resource price override. Clear the checkbox to keep and edit independent choices. Previously edited route choices remain in the draft.'
      : 'This resource owns its complete ordered choices. Changing workspace defaults does not change these terms. You can add, reorder or copy choices without changing the resource data.';
    $('payment-fields').disabled = shared;
    for (const name of fields) {
      const value = name === 'extra' ? own(choice, 'extraText') ? choice.extraText : own(choice, 'extra') ? JSON.stringify(choice.extra, null, 2) : '' : choice[name];
      $('payment-' + name).value = typeof value === 'string' || typeof value === 'number' ? value : '';
    }
    const copySelection = $('payment-copy-source').value;
    $('payment-copy-source').replaceChildren(...getInput().resources.flatMap((r, index) => {
      if (index === getResourceIndex()) return [];
      const option = text('option', (r.serviceName || r.id || 'Resource ' + (index + 1)) + ' · ' + paymentChoicesForResource(getInput(), r).length + ' choices');
      option.value = String(index); return [option];
    }));
    if (Array.from($('payment-copy-source').options).some(option => option.value === copySelection)) $('payment-copy-source').value = copySelection;
    $('payment-copy').disabled = getInput().resources.length < 2;
    $('payment-copy-source').disabled = getInput().resources.length < 2;
    renderList(); renderOriginalFields(choice); showErrors(errors);
  }
  $('payment-resource').addEventListener('change', event => selectResource(Number(event.target.value)));
  $('payment-shared').addEventListener('change', event => editList(() => {
    const current = resource();
    if (!event.target.checked && !Array.isArray(current.paymentOptions)) current.paymentOptions = clone(choices());
    current.paymentMode = event.target.checked ? 'shared' : 'route';
  }));
  for (const name of fields) $('payment-' + name).addEventListener('input', event => {
    if (usesSharedPayment(resource())) return;
    if (!Array.isArray(resource().paymentOptions)) resource().paymentOptions = [];
    if (!resource().paymentOptions[selected] || typeof resource().paymentOptions[selected] !== 'object') resource().paymentOptions[selected] = { scheme: 'exact' };
    const choice = resource().paymentOptions[selected];
    undo = null;
    choice[name === 'extra' ? 'extraText' : name] = event.target.value;
    renderList(); onChange();
  });
  $('payment-add').addEventListener('click', () => {
    if (usesSharedPayment(resource()) || choices().length >= MAX_PAYMENT_OPTIONS) return;
    editList(() => {
      const previous = choices()[selected] || {};
      if (!Array.isArray(resource().paymentOptions)) resource().paymentOptions = [];
      resource().paymentOptions.push({ scheme: 'exact', network: previous.network || getInput().network,
        asset: '', payTo: previous.payTo || getInput().payTo, amount: previous.amount || getInput().amount,
        maxTimeoutSeconds: previous.maxTimeoutSeconds || getInput().maxTimeoutSeconds });
      resource().paymentStyle = 'paymentOptions'; selected = resource().paymentOptions.length - 1;
    });
    $('payment-asset').focus();
  });
  for (const [id, delta] of [['payment-up', -1], ['payment-down', 1]]) $(id).addEventListener('click', () => {
    const next = selected + delta;
    if (usesSharedPayment(resource()) || next < 0 || next >= choices().length) return;
    editList(() => { const list = resource().paymentOptions; [list[selected], list[next]] = [list[next], list[selected]]; selected = next; });
  });
  $('payment-remove').addEventListener('click', () => {
    if (usesSharedPayment(resource()) || choices().length <= 1) return;
    editList(() => { resource().paymentOptions.splice(selected, 1); selected = Math.min(selected, choices().length - 1); });
  });
  $('payment-copy').addEventListener('click', () => {
    const from = Number($('payment-copy-source').value), source = getInput().resources[from];
    if (!source || from === getResourceIndex()) return;
    editList(() => {
      const current = resource(), list = clone(paymentChoicesForResource(getInput(), source));
      current.paymentOptions = list; current.paymentMode = 'route';
      current.paymentStyle = paymentDeclarationStyle(getInput(), source, list); selected = 0;
    });
  });
  $('payment-undo').addEventListener('click', () => {
    if (!undo || undo.resource !== resource()) return;
    const previous = undo;
    for (const key of ['paymentMode', 'paymentStyle', 'paymentOptions']) delete resource()[key];
    Object.assign(resource(), clone(previous.values)); selected = previous.selected; undo = null; render(); onChange();
  });
  function focus(field) {
    const match = /^resources\.(\d+)\.paymentOptions(?:\.(\d+)(?:\.(\w+))?)?$/.exec(field);
    if (!match) return false;
    selectResource(Number(match[1])); selected = Number(match[2] || 0); render();
    if (usesSharedPayment(resource())) $('payment-shared').focus();
    else $('payment-' + (fields.includes(match[3]) ? match[3] : 'asset')).focus();
    return true;
  }
  return { render, showErrors, focus };
}

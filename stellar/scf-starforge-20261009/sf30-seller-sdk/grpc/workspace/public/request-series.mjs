// MIT. A finite reviewed message sequence in the original gRPC request editor.
import { renderGrpcFields } from './fields.mjs';
const PAGE = 20, pretty = value => JSON.stringify(value, null, 2);
const encoder = new TextEncoder();
const message = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Every request message must be a JSON object.');
  return value;
};
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function sequence(value, limits) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 1 || !Object.hasOwn(value, 'messages') || !Array.isArray(value.messages))
    throw new Error('A request sequence is the closed object {"messages":[...]}.');
  if (value.messages.length > limits.maxMessages) throw new Error('This source permits at most ' + limits.maxMessages + ' messages.');
  value.messages.forEach(message);
  return structuredClone(value);
}
export function renderGrpcRequestSeries(root, schema, initial, { change, error, validate, isCurrent }) {
  const limits = schema.requestSeries;
  let value = sequence(initial, limits), selected = value.messages.length ? 0 : -1, page = 0, revision = 0;
  root.replaceChildren(); root.classList.add('request-series');
  const summary = node('p', undefined, 'hint'), actions = node('div', undefined, 'actions');
  const list = node('div', undefined, 'request-series-list');
  list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Request message sequence');
  const pages = node('div', undefined, 'actions'), pageLabel = node('span', undefined, 'hint');
  const heading = node('h3'), controls = node('div', undefined, 'actions'), fields = node('div');
  const exactLabel = node('label', 'Selected message · exact JSON'), exact = node('textarea');
  exact.rows = 7; exact.spellcheck = false; exact.className = 'field-value';
  exact.setAttribute('aria-label', 'Selected request message JSON'); exactLabel.append(exact);
  const importFile = document.createElement('input');
  importFile.type = 'file'; importFile.accept = '.json,application/json'; importFile.hidden = true;
  const handled = action => () => {
    try { if (!isCurrent() || !root.isConnected) return; validate(); action(); }
    catch (issue) { error(issue); }
  };
  function action(label, fn, parent = actions) {
    const button = node('button', label, 'secondary'); button.type = 'button';
    button.addEventListener('click', handled(fn)); parent.append(button); return button;
  }
  const add = action('Add message', () => {
    value.messages.push({}); selected = value.messages.length - 1; page = Math.floor(selected / PAGE); publish(); render();
  });
  const duplicate = action('Duplicate message', () => {
    value.messages.splice(selected + 1, 0, structuredClone(value.messages[selected]));
    selected++; page = Math.floor(selected / PAGE); publish(); render();
  });
  action('Import sequence JSON', () => importFile.click());
  action('Download sequence JSON', () => {
    const url = URL.createObjectURL(new Blob([pretty(value) + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'grpc-request-sequence.json';
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  const previous = action('Previous messages', () => { page--; renderList(); }, pages);
  pages.append(pageLabel);
  const next = action('Next messages', () => { page++; renderList(); }, pages);
  const up = action('Move earlier', () => {
    [value.messages[selected - 1], value.messages[selected]] = [value.messages[selected], value.messages[selected - 1]];
    selected--; page = Math.floor(selected / PAGE); publish(); render();
  }, controls);
  const down = action('Move later', () => {
    [value.messages[selected], value.messages[selected + 1]] = [value.messages[selected + 1], value.messages[selected]];
    selected++; page = Math.floor(selected / PAGE); publish(); render();
  }, controls);
  const remove = action('Remove message', () => {
    value.messages.splice(selected, 1); selected = Math.min(selected, value.messages.length - 1);
    page = Math.max(0, Math.floor(selected / PAGE)); publish(); render();
  }, controls);
  function publish() {
    revision++; change(structuredClone(value));
    updateSummary();
  }
  function updateSummary() {
    const bytes = encoder.encode(JSON.stringify(value)).byteLength;
    summary.textContent = value.messages.length + ' messages in send order · ' + bytes.toLocaleString() +
      ' JSON bytes · source allows ' + limits.maxMessages.toLocaleString() + ' messages, ' +
      limits.maxBytes.toLocaleString() + ' summed protobuf bytes, and ' + limits.maxJsonRequestBytes.toLocaleString() +
      ' JSON bytes. Native protobuf sizing is checked before dispatch.';
    add.disabled = value.messages.length >= limits.maxMessages;
    duplicate.disabled = selected < 0 || add.disabled;
  }
  function renderList() {
    page = Math.max(0, Math.min(page, Math.ceil(value.messages.length / PAGE) - 1));
    list.replaceChildren();
    for (let index = page * PAGE; index < Math.min((page + 1) * PAGE, value.messages.length); index++) {
      const fields = Object.keys(value.messages[index]).join(', ') || 'empty message';
      const button = action('Message ' + (index + 1) + ' · ' + fields, () => { selected = index; render(); }, list);
      button.dataset.messageIndex = String(index);
      button.setAttribute('aria-pressed', String(index === selected));
    }
    previous.disabled = page === 0; next.disabled = (page + 1) * PAGE >= value.messages.length;
    pageLabel.textContent = value.messages.length ? (page * PAGE + 1) + '–' +
      Math.min((page + 1) * PAGE, value.messages.length) + ' of ' + value.messages.length : '0 messages';
  }
  function renderMessage() {
    const present = selected >= 0;
    heading.textContent = present ? 'Message ' + (selected + 1) : 'Empty request sequence';
    controls.hidden = !present; exactLabel.hidden = !present; exact.disabled = !present;
    up.disabled = selected <= 0; down.disabled = selected < 0 || selected + 1 >= value.messages.length;
    remove.disabled = !present;
    exact.setCustomValidity(''); fields.inert = false;
    if (!present) {
      exact.value = ''; fields.replaceChildren(node('p', 'The native input is half-closed without sending a message. The endpoint decides its response.'));
      return;
    }
    exact.value = pretty(value.messages[selected]);
    renderGrpcFields(fields, schema.requestMessage, {
      value: () => value.messages[selected],
      change(next) { value.messages[selected] = next; exact.value = pretty(next); exact.setCustomValidity(''); publish(); renderList(); },
      error,
    });
  }
  function render() { updateSummary(); renderList(); renderMessage(); }
  exact.addEventListener('input', () => {
    try {
      value.messages[selected] = message(JSON.parse(exact.value));
      exact.setCustomValidity(''); fields.inert = false; publish(); renderList();
      renderGrpcFields(fields, schema.requestMessage, {
        value: () => value.messages[selected],
        change(next) { value.messages[selected] = next; exact.value = pretty(next); exact.setCustomValidity(''); publish(); renderList(); },
        error,
      });
    } catch (issue) { exact.setCustomValidity(issue.message); fields.inert = true; error(issue); }
  });
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0]; if (!file) return;
    const previousRevision = revision;
    try {
      if (file.size > limits.maxJsonRequestBytes) throw new Error('The selected JSON file exceeds this source’s complete request limit.');
      const imported = sequence(JSON.parse(await file.text()), limits);
      if (!isCurrent() || !root.isConnected || previousRevision !== revision)
        throw new Error('The request changed while the file was being read. Import again into the current message sequence.');
      validate(); value = imported; selected = value.messages.length ? 0 : -1; page = 0; publish(); render();
    } catch (issue) { error(issue); } finally { importFile.value = ''; }
  });
  root.append(summary, actions, importFile, list, pages, heading, controls, fields, exactLabel);
  render();
}

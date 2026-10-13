// MIT. Shared catalogue semantic views and original project operation dispatch.
function node(tag, attrs = {}, ...children) {
  const value = document.createElement(tag);
  for (const [key, item] of Object.entries(attrs)) {
    if (key.startsWith('on')) value.addEventListener(key.slice(2), item);
    else if (['disabled', 'selected', 'checked'].includes(key)) value[key] = Boolean(item);
    else if (item !== undefined && item !== null) value.setAttribute(key, item);
  }
  for (const item of children.flat()) if (item !== undefined && item !== null)
    value.append(item instanceof Node ? item : document.createTextNode(String(item)));
  return value;
}
const note = text => node('p', { class: 'muted' }, text);
const row = (...items) => node('div', { class: 'row' }, ...items);
const card = (...items) => node('section', { class: 'card' }, ...items);
const field = (label, input) => node('label', { class: 'grow' }, label, input);
const input = (name, value = '', attrs = {}) => node('input', { name, value, ...attrs });
const details = (label, value) => node('details', {}, node('summary', {}, label),
  node('pre', {}, JSON.stringify(value, null, 2)));
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : value || '—';
function select(name, choices, selected) {
  return node('select', { name }, choices.map(([value, label]) =>
    node('option', { value, selected: String(selected ?? '') === String(value) }, label)));
}
function bind(control, receive) {
  control.addEventListener('input', receive); control.addEventListener('change', receive); return control;
}
function table(headings, rows) {
  return node('div', { class: 'table-wrap' }, node('table', {},
    node('thead', {}, node('tr', {}, headings.map(text => node('th', {}, text)))),
    node('tbody', {}, rows.map(cells => node('tr', {}, cells.map(value => node('td', {}, value)))))));
}
function action(ctx, label, callback, disabled = false) {
  const button = node('button', { type: 'button', disabled }, label);
  button.addEventListener('click', () => ctx.protect(async () => {
    if (button.disabled || !ctx.current()) return;
    button.disabled = true;
    try { return await callback(); } finally { if (button.isConnected) button.disabled = disabled; }
  }));
  return button;
}
async function api(ctx, path, value) {
  const response = await fetch('/api/dcat/semantic/' + path, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + ctx.token,
      ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error((result.error ?? response.status) + ': ' + (result.message ?? 'Semantic operation failed.'));
  return result;
}
async function mutate(ctx, saved, path, body, receive) {
  if (saved.pending || ctx.state.active) throw new Error('Finish the current project operation first.');
  saved.pending = true;
  try {
    const result = await api(ctx, path, body); receive?.(result);
    ctx.acceptOperation(result); await ctx.refresh(); return result;
  } finally { saved.pending = false; }
}

export { node, note, row, card, field, input, details, time, select, bind, table, action, api, mutate };

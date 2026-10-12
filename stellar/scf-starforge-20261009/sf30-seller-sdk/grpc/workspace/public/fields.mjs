// MIT. The captured protobuf schema drives the original operator's message fields.
const pretty = value => JSON.stringify(value, null, 2);
const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A protobuf message must be a JSON object.');
  return value;
};
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function resolved(schema, root) {
  if (!schema || typeof schema !== 'object') return {};
  const seen = new Set(); let value = schema;
  while (typeof value.$ref === 'string' && value.$ref.startsWith('#/') && !seen.has(value.$ref)) {
    seen.add(value.$ref); let target = root;
    for (const part of value.$ref.slice(2).split('/')) target = target?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    if (!target || typeof target !== 'object') break;
    value = { ...target, ...Object.fromEntries(Object.entries(value).filter(([name]) => name !== '$ref')) };
  }
  return value;
}
export function renderGrpcFields(container, root, { value, change, error }) {
  const initial = object(value()), schema = resolved(root, root);
  container.replaceChildren();
  const properties = schema.properties ?? {}, required = new Set(schema.required ?? []);
  for (const [name, original] of Object.entries(properties)) {
    const field = resolved(original, root), row = node('div', undefined, 'field-row'), label = node('label');
    const included = document.createElement('input'); included.type = 'checkbox';
    included.checked = Object.hasOwn(initial, name); included.disabled = required.has(name);
    if (required.has(name)) included.checked = true;
    label.append(included, node('span', name + (required.has(name) ? ' · required' : ''))); row.append(label);
    const hints = [field.description, field.type, field.format, field.pattern ? 'pattern: ' + field.pattern : ''].filter(Boolean);
    row.append(node('small', hints.join(' · ')));
    let control, mode;
    if (field.type === 'boolean') {
      control = document.createElement('select'); mode = 'boolean';
      for (const boolean of [false, true]) { const option = node('option', String(boolean)); option.value = String(boolean); control.append(option); }
    } else if (field.type === 'object' || field.type === 'array' || field.properties || field.additionalProperties ||
        field.anyOf || field.oneOf || field.allOf || !['string', 'integer', 'number'].includes(field.type)) {
      control = document.createElement('textarea'); mode = 'json'; control.rows = 3; control.spellcheck = false;
    } else {
      control = document.createElement('input'); mode = field.type;
      control.type = 'text'; control.autocomplete = 'off';
      if (mode === 'number' || mode === 'integer') control.inputMode = 'decimal';
    }
    control.className = 'field-value'; control.setAttribute('aria-label', name);
    control.value = Object.hasOwn(initial, name) ? mode === 'json' ? pretty(initial[name]) : String(initial[name]) : '';
    control.disabled = !included.checked; row.dataset.included = String(included.checked);
    const update = () => {
      try {
        const request = structuredClone(object(value()));
        if (!included.checked) delete request[name];
        else {
          let next = control.value;
          if (mode === 'json') next = JSON.parse(next);
          else if (mode === 'boolean') next = next === 'true';
          else if (mode === 'integer' || mode === 'number') {
            if (!next.trim() || !Number.isFinite(Number(next))) throw new Error(name + ' needs a finite JSON number.');
            next = Number(next);
            if (mode === 'integer' && !Number.isSafeInteger(next)) throw new Error(name + ' needs an exact safe JSON integer.');
          }
          Object.defineProperty(request, name, { value: next, enumerable: true, writable: true, configurable: true });
        }
        change(request); control.setCustomValidity('');
      } catch (issue) { control.setCustomValidity(issue.message); error(issue); }
    };
    included.addEventListener('change', () => {
      control.disabled = !included.checked; row.dataset.included = String(included.checked);
      if (included.checked && !control.value && mode === 'boolean') control.value = 'false'; update();
    });
    control.addEventListener('input', update); control.addEventListener('change', update);
    row.append(control); container.append(row);
  }
  if (!Object.keys(properties).length) container.append(node('p', 'Use the exact JSON editor for this message.'));
}

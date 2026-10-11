// MIT. Field selection and retained provider previews in the original workspace.
export function createAuthoringWorkspace(ctx) {
  const { $, node, button, control, selectControl, checkControl, detail, table, api, action, notice, json } = ctx;
  let model = null, catalog = null, editingName = null, originalOperation = null, sourceText = null,
    dirty = false, result = null, history = [], currentName = null;
  const jsonDrafts = new Map(), jsonErrors = new Map();
  const operation = () => ctx.getOperation();
  function edited() {
    dirty = true; $('query-builder-status').textContent = 'Field edits are pending. Apply the selection, or save the draft to apply and retain it.';
    if (result) $('preview-status').textContent = 'Retained preview. Apply and save the changed field selection before requesting its current result.';
    ctx.buttons();
  }
  const typeName = type => type.replace(/[\[\]!]/g, '');
  function argumentHelp(arg) {
    const type = catalog.types[typeName(arg.type)];
    const values = type?.values?.map(value => value.name) ?? [];
    const inputFields = type?.kind === 'GraphQLInputObjectType' ? type.fields.map(field => field.name + ': ' + field.type) : [];
    return [arg.required ? 'Required.' : 'Optional.', arg.defaultLiteral !== null ? 'Source default: ' + arg.defaultLiteral + '.' : '',
      values.length ? 'Values: ' + values.join(', ') + '.' : '', inputFields.length ? 'Input fields: ' + inputFields.join(', ') + '.' : ''].filter(Boolean).join(' ');
  }
  function useVariable(arg, selected, path) {
    let name = (path + '_' + arg.name).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 54);
    if (!/^[A-Za-z_]/.test(name)) name = 'value_' + name;
    const base = name; let n = 2;
    while (Object.hasOwn(model.variables, name)) name = base + '_' + n++;
    const spec = { type: arg.buyerType, required: arg.type.endsWith('!') };
    if (spec.type === 'integer') { spec.min = 0; spec.max = 100000; }
    if (spec.type === 'string') { spec.min = 1; spec.max = 256; }
    model.variables[name] = { graphqlType: arg.type, native: spec };
    selected.arguments[arg.name] = '$' + name; edited(); renderBuilder();
  }
  function renderArguments(target, definition, selected, path) {
    if (!definition.arguments?.length) return;
    const argumentsBox = node('div', undefined, 'query-arguments');
    for (const arg of definition.arguments) {
      const row = node('div', undefined, 'query-argument');
      row.append(control(arg.name + ': ' + arg.type, selected.arguments[arg.name] ?? '', value => {
        if (value.trim()) selected.arguments[arg.name] = value; else delete selected.arguments[arg.name]; edited();
      }, { placeholder: arg.defaultLiteral ?? 'GraphQL literal or $variable', textarea: true, rows: 2 }));
      row.append(node('p', argumentHelp(arg), 'subtle'));
      if (arg.buyerType) row.append(button('Bind ' + arg.name + ' to a buyer variable', () => useVariable(arg, selected, path), true));
      if (arg.description) row.append(detail('Argument description', arg.description));
      argumentsBox.append(row);
    }
    target.append(argumentsBox);
  }
  function sourceFields(type) {
    const value = catalog.types[type];
    return [...(value?.fields ?? []), ...(value?.composite ? [{ name: '__typename', type: 'String!',
      namedType: 'String', composite: false, arguments: [], description: 'The concrete source type name.' }] : [])];
  }
  function renderSelection(selected, parentType, siblings, index, path) {
    const box = node('fieldset', undefined, 'query-node'), fields = sourceFields(parentType);
    box.append(node('legend', 'Selected field'));
    const row = node('div', undefined, 'query-field-row'), label = node('label', 'Source field'), select = node('select');
    select.append(node('option', 'Choose a field')); select.options[0].value = '';
    for (const field of fields) { const option = node('option', field.name + ' · ' + field.type); option.value = field.name; select.append(option); }
    select.value = selected.field;
    select.addEventListener('change', () => {
      selected.field = select.value; selected.arguments = {}; selected.selections = []; edited(); renderBuilder();
    }); label.append(select);
    row.append(label, control('Result alias (optional)', selected.alias, value => { selected.alias = value; edited(); }),
      button('Remove field', () => { siblings.splice(index, 1); edited(); renderBuilder(); }, true)); box.append(row);
    const definition = fields.find(field => field.name === selected.field);
    if (!definition) return box;
    if (definition.deprecated) box.append(node('p', 'Source deprecation: ' + definition.deprecated, 'subtle'));
    if (definition.description) box.append(detail('Field description', definition.description));
    renderArguments(box, definition, selected, path + '_' + selected.field);
    if (definition.composite) renderChildren(box, selected, definition.namedType, path + '_' + selected.field);
    return box;
  }
  function renderChildren(target, selected, parentType, path) {
    const children = node('div', undefined, 'query-children');
    selected.selections.forEach((value, index) => children.append(renderSelection(value, parentType, selected.selections, index, path)));
    if (!selected.selections.length) children.append(node('p', 'Choose fields from ' + parentType + ' for this result.', 'subtle'));
    children.append(button('Add field from ' + parentType, () => {
      selected.selections.push({ field: '', alias: '', arguments: {}, selections: [] }); edited(); renderBuilder();
    }, true)); target.append(children);
  }
  function renderVariables(target) {
    const section = node('div', undefined, 'query-variables'); section.append(node('h4', 'Bounded buyer variables'));
    if (!Object.keys(model.variables).length) section.append(node('p', 'This selection uses fixed arguments only.', 'subtle'));
    for (const [name, value] of Object.entries(model.variables)) {
      const box = node('fieldset', undefined, 'query-node'); box.append(node('legend', '$' + name + ': ' + value.graphqlType));
      const spec = value.native, fields = node('div', undefined, 'grid three');
      const base = typeName(value.graphqlType), options = base === 'Int' ? ['integer'] : base === 'Boolean' ? ['boolean'] : ['string', 'stellar-account'];
      fields.append(selectControl('Native input type', spec.type, options, type => {
        spec.type = type;
        if (type === 'stellar-account' || type === 'boolean') { delete spec.min; delete spec.max; }
        else { spec.min ??= type === 'integer' ? 0 : 1; spec.max ??= type === 'integer' ? 100000 : 256; }
        delete spec.default; jsonDrafts.delete(name + ':default'); jsonErrors.delete(name + ':default'); edited(); renderBuilder();
      }));
      if (['integer', 'string'].includes(spec.type)) for (const key of ['min', 'max']) fields.append(control(
        (key === 'min' ? 'Minimum' : 'Maximum') + (spec.type === 'string' ? ' characters' : ''), spec[key], number => {
          spec[key] = number; edited();
        }, { type: 'number' }));
      box.append(fields, checkControl('Required buyer input', spec.required, checked => { spec.required = checked; edited(); }));
      const values = node('div', undefined, 'grid two');
      for (const [label, owner, key] of [['Native default (JSON; optional)', spec, 'default'], ['Preview example (JSON)', value, 'sample']]) {
        const field = name + ':' + key;
        values.append(control(label, jsonDrafts.has(field) ? jsonDrafts.get(field) : Object.hasOwn(owner, key) ? JSON.stringify(owner[key]) : '', text => {
          jsonDrafts.set(field, text); edited();
          try { if (text.trim()) owner[key] = JSON.parse(text); else delete owner[key]; jsonErrors.delete(field); }
          catch {
            const message = 'Enter valid JSON for $' + name + ' ' + (key === 'default' ? 'default' : 'preview example') + '.';
            jsonErrors.set(field, message); throw new Error(message);
          }
        }, { placeholder: spec.type === 'integer' ? '10' : spec.type === 'boolean' ? 'true' : '"actual example"' }));
      }
      box.append(values, button('Remove variable ' + name, () => {
        delete model.variables[name];
        for (const key of ['default', 'sample']) { jsonDrafts.delete(name + ':' + key); jsonErrors.delete(name + ':' + key); }
        edited(); renderBuilder();
      }, true));
      section.append(box);
    }
    target.append(section);
  }
  function renderBuilder() {
    const target = $('query-builder'); target.replaceChildren();
    if (!model || !catalog) return;
    const roots = catalog.roots.filter(field => field.supported), selector = node('select'), label = node('label', 'Object-valued query root');
    selector.append(node('option', 'Choose a query field')); selector.options[0].value = '';
    for (const field of roots) { const option = node('option', field.name + ' · ' + field.type); option.value = field.name; selector.append(option); }
    selector.value = model.root.field; label.append(selector); target.append(label);
    selector.addEventListener('change', () => { model.root = { field: selector.value, alias: '', arguments: {}, selections: [] }; edited(); renderBuilder(); });
    const heading = node('div', undefined, 'grid three');
    for (const [key, title] of [['name', 'Operation name'], ['handler', 'Native handler name'], ['admission', 'Native admission name']])
      heading.append(control(title, model[key], value => { model[key] = value; edited(); }));
    target.append(heading, control('Maximum returned nodes', model.maxNodes, value => { model.maxNodes = value; edited(); }, { type: 'number' }),
      control('Root result alias (optional)', model.root.alias, value => { model.root.alias = value; edited(); }));
    const root = roots.find(field => field.name === model.root.field);
    if (root) {
      if (root.description) target.append(detail('Query description', root.description));
      renderArguments(target, root, model.root, model.root.field);
      renderChildren(target, model.root, root.namedType, model.root.field);
    }
    renderVariables(target); ctx.buttons();
  }
  async function openBuilder() {
    if (dirty && !confirm('Discard the unapplied field selection and reopen the saved operation text?')) return;
    const current = operation(); if (!current) throw new Error('Add or select an operation first.');
    const value = await api('/api/authoring/open', { input: ctx.input(), operation: current.name });
    model = value.model; catalog = value.catalog; editingName = current.name; jsonDrafts.clear(); jsonErrors.clear();
    originalOperation = JSON.stringify(current); sourceText = ctx.input().schemaText; dirty = false;
    $('query-builder-status').textContent = value.note || 'Editing ' + editingName + ' against the loaded source schema. The original validator reviews the complete selection when applied.';
    renderBuilder();
  }
  async function applyPending(force = false) {
    if (!model || !dirty && !force) return;
    if (jsonErrors.size) throw new Error(jsonErrors.values().next().value);
    let rawOperation;
    try { rawOperation = JSON.parse(ctx.input().queriesText).operations?.find(item => item.name === editingName); } catch { /* The compiler reports raw document errors after reopening. */ }
    if (operation()?.name !== editingName || ctx.input().schemaText !== sourceText || JSON.stringify(rawOperation) !== originalOperation)
      throw new Error('The underlying schema or operation changed. Reopen the field editor before applying its selection.');
    const compiled = await api('/api/authoring/compile', { input: ctx.input(), operation: editingName, model });
    const oldName = editingName; dirty = false; editingName = compiled.operation.name;
    const linked = ctx.applyOperation(compiled, oldName); originalOperation = JSON.stringify(operation());
    $('preview-variables').value = json(compiled.samples);
    $('query-builder-status').textContent = 'Applied ' + compiled.review.fieldCount + ' schema-validated fields to ' + editingName + '. Save the project to retain this query.';
    notice(linked.examplesRetained ? 'Original query and buyer-variable examples updated.'
      : 'Original query updated. Finish the merchant-plan JSON to retain its public variable examples.');
  }
  function download(record) {
    const bytes = Uint8Array.from(atob(record.responseBase64), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
    const anchor = node('a'); anchor.href = url; anchor.download = record.operation + '-preview-' + record.id + '.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderResult(record) {
    result = record; const target = $('preview-result'); target.replaceChildren();
    const summary = node('div', undefined, 'runtime-facts');
    summary.append(node('strong', record.operation), node('span', 'HTTP ' + record.status, 'badge'),
      node('span', record.responseBytes.toLocaleString() + ' returned bytes'), node('span', new Date(record.completedAt).toLocaleString()));
    target.append(summary, node('p', record.source.origin + record.source.path, 'code'),
      button('Download exact returned JSON', () => download(record), true));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(record.responseBase64), char => char.charCodeAt(0)));
    let value; try { value = JSON.parse(decoded); } catch { value = null; }
    const objectRows = candidate => Array.isArray(candidate) && candidate.every(row => row && typeof row === 'object' && !Array.isArray(row));
    const rows = objectRows(value?.data?.nodes) ? value.data.nodes :
      Object.values(value?.data ?? {}).find(candidate => Array.isArray(candidate) && candidate.every(row => row && typeof row === 'object' && !Array.isArray(row)));
    if (rows?.length) {
      const listing = node('div'), columns = [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 12); let page = 0;
      const show = () => {
        listing.replaceChildren(node('p', rows.length + ' returned rows. Showing ' + (page * 50 + 1) + '–' + Math.min(rows.length, (page + 1) * 50) + '.'));
        listing.append(table(columns, rows.slice(page * 50, (page + 1) * 50).map(row => columns.map(key => {
          const text = typeof row[key] === 'string' ? row[key] : JSON.stringify(row[key] ?? null);
          return text.length > 240 ? text.slice(0, 240) + '…' : text;
        }))));
        const controls = node('div', undefined, 'toolbar');
        if (page > 0) controls.append(button('Previous result rows', () => { page--; show(); }, true));
        if ((page + 1) * 50 < rows.length) controls.append(button('Next result rows', () => { page++; show(); }, true));
        listing.append(controls);
      }; show(); target.append(listing);
    }
    target.append(detail('Complete returned data', value ?? decoded), detail('Original query and bound variables', record.request),
      detail('Retained source and response identity', { project: record.project, draftRevision: record.draftRevision,
        inputDigest: record.inputDigest, source: record.source, requestSha256: record.requestSha256, responseSha256: record.responseSha256 }));
    $('preview-status').textContent = record.inputDigest === ctx.saved()?.inputDigest && !ctx.isDirty()
      ? 'Completed preview of these saved inputs.' : 'Completed preview retained from earlier saved inputs.';
  }
  function renderHistory() {
    const target = $('preview-history'); target.replaceChildren();
    const rows = history.length ? history : (ctx.saved()?.previews ?? []).map(row => ({ ...row, retained: true }));
    if (!rows.length) target.append(node('p', 'No query previews are retained for this project.', 'subtle'));
    for (const row of rows) {
      const card = node('div', undefined, 'preview-card');
      card.append(node('strong', row.operation ?? 'Unavailable preview'), node('p', row.state === 'COMPLETED'
        ? 'HTTP ' + row.status + ' · source revision ' + row.draftRevision + ' · ' + new Date(row.completedAt).toLocaleString()
        : row.error ?? 'Request started; no completed result is retained. Start a new preview explicitly if another provider request is wanted.', 'subtle'));
      if (row.state === 'COMPLETED') {
        const tools = node('div', undefined, 'toolbar');
        tools.append(button('Open returned result', () => action('Opening retained query result…', async () => {
          renderResult(await api('/api/authoring/preview?id=' + encodeURIComponent(ctx.saved().id) + '&previewId=' + row.id));
          notice('Retained result opened without a provider request.');
        }), true));
        if (!row.retained) tools.append(button('Attach completed result', () => action('Recovering completed source preview…', async () => {
          const result = await api('/api/authoring/recover', { id: ctx.saved().id, expectedRevision: ctx.revision(), previewId: row.id });
          await ctx.acceptProject(result.project); renderResult(result.preview); await refreshHistory();
          notice('Existing completed preview attached without another provider request.');
        }), true));
        card.append(tools);
      }
      target.append(card);
    }
  }
  async function refreshHistory() {
    if (!ctx.saved()) { history = []; renderHistory(); return; }
    history = (await api('/api/authoring/previews?id=' + encodeURIComponent(ctx.saved().id))).operations; renderHistory();
  }
  function reset() {
    model = catalog = editingName = originalOperation = sourceText = result = null; dirty = false; history = []; currentName = null;
    jsonDrafts.clear(); jsonErrors.clear();
    $('query-builder').replaceChildren(); $('preview-result').replaceChildren(); $('preview-status').textContent = '';
    $('query-builder-status').textContent = 'Choose an operation, then select its actual source fields and arguments.';
    operationChanged(); renderHistory();
  }
  function operationChanged() {
    const selected = operation();
    if (selected?.name !== currentName) {
      currentName = selected?.name ?? null;
      $('preview-variables').value = json(ctx.samples(currentName));
      if (model && currentName !== editingName && !dirty) { model = catalog = null; $('query-builder').replaceChildren(); }
    }
  }
  function buttons() {
    const busy = ctx.busy();
    $('open-query-builder').disabled = busy || !operation();
    $('apply-query-builder').disabled = busy || !model;
    $('close-query-builder').disabled = busy || !model;
    $('preview-operation').disabled = busy || !operation();
    $('refresh-previews').disabled = busy || !ctx.saved();
    for (const id of ['operation-select', 'add-operation', 'remove-operation']) $(id).disabled = busy || dirty;
  }
  $('capture-schema').addEventListener('click', () => action('Capturing the running query-service schema…', async () => {
    let q; try { q = JSON.parse(ctx.input().queriesText); } catch { throw new Error('Apply valid backend queries JSON first.'); }
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new Error('Apply valid backend queries JSON first.');
    if (dirty) throw new Error('Apply or close the pending field selection before replacing its schema.');
    const captured = await api('/api/authoring/capture', { endpoint: {
      schema: 'stellar-forge.subquery-schema-endpoint.v1', origin: q.origin, path: q.path,
      ...(q.authorizationEnv ? { authorizationEnv: q.authorizationEnv } : {}),
      timeoutMs: q.timeoutMs ?? 15000, maxResponseBytes: 1048576 }, allowLoopback: $('authoring-loopback').checked });
    ctx.acceptSchema(captured); model = catalog = null; $('query-builder').replaceChildren();
    jsonDrafts.clear(); jsonErrors.clear();
    notice('Captured the served schema in one original transport request. Save to retain it.');
  }));
  $('open-query-builder').addEventListener('click', () => action('Opening the actual schema fields…', openBuilder));
  $('apply-query-builder').addEventListener('click', () => action('Validating the selected operation…', () => applyPending(true)));
  $('close-query-builder').addEventListener('click', () => {
    if (dirty && !confirm('Discard the unapplied field selection?')) return;
    model = catalog = null; dirty = false; $('query-builder').replaceChildren();
    jsonDrafts.clear(); jsonErrors.clear();
    $('query-builder-status').textContent = 'Field editor closed. The original operation text is retained.'; ctx.buttons();
  });
  $('refresh-previews').addEventListener('click', () => action('Reading retained provider requests and results…', refreshHistory));
  $('preview-operation').addEventListener('click', () => action('Saving the query and requesting one source result…', async () => {
    await applyPending();
    const selected = operation()?.name, variables = JSON.parse($('preview-variables').value), allowLoopback = $('authoring-loopback').checked;
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error('Preview variables must be a JSON object.');
    await ctx.save();
    const previewId = crypto.randomUUID();
    try {
      const received = await api('/api/authoring/preview', { id: ctx.saved().id, expectedRevision: ctx.revision(),
        previewId, operation: selected, variables, allowLoopback });
      await ctx.acceptProject(received.project, selected); renderResult(received.preview); await refreshHistory();
      notice('Original handler returned HTTP ' + received.preview.status + '. The exact result and source context are retained.');
    } catch (error) { await refreshHistory().catch(() => {}); throw error; }
  }));
  return { reset, buttons, operationChanged, applyPending, pending: () => dirty,
    draftChanged: () => { if (result) $('preview-status').textContent = 'Retained preview. Review the changed draft before using it as the current result.'; } };
}

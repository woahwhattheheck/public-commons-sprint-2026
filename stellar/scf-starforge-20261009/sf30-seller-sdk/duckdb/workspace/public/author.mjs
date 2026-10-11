// MIT. Query selection UI over F11D's original native catalog and author compiler.
export function mountQueryAuthor({ root, api, perform, report, getState, updateBuilder, keepQuery, removeQuery }) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const relations = new Map();
  let nextCursor, loaded = false, sourceSha256, reviewed = null;
  const relationFor = builder => relations.get(builder?.plan?.relationId);
  const choice = (value, label, selected) => '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  function builderFor(item) {
    const scalar = item.columns.filter(column => column.parameter);
    const names = new Set(getState().entries.map(entry => entry.plan.queryName));
    let queryName = ('public_' + item.name.replace(/[^A-Za-z0-9_]/g, '_')).slice(0, 42), count = 2;
    const base = queryName;
    while (names.has(queryName) || Object.hasOwn(getState().source.queries ?? {}, queryName)) queryName = base + '_' + count++;
    return { cursor: item.cursor, plan: { relationId: item.id, relationFingerprint: item.fingerprint, queryName,
      columns: item.columns.slice(0, 6).map(column => column.name),
      orderBy: scalar.length ? [{ column: scalar[0].name, direction: 'asc' }] : [], filters: [],
      maxRows: 100, maxBytes: 524288, timeoutMs: 5000 } };
  }
  async function load(cursor) {
    const state = getState(), page = await api('/api/catalog', { sourceSha256: state.source.sourceSha256, cursor });
    acceptPage(page, cursor);
    if (!state.builder?.plan && page.relations.length) updateBuilder(builderFor(relations.get(page.relations[0].id)));
    return page;
  }
  function acceptPage(page, cursor) {
    if (sourceSha256 !== page.sourceSha256) { relations.clear(); sourceSha256 = page.sourceSha256; }
    for (const relation of page.relations) relations.set(relation.id, { ...relation, cursor });
    nextCursor = page.nextCursor; loaded = true;
  }
  function render() {
    const { source, entries, builder = {} } = getState(), item = relationFor(builder), plan = builder.plan;
    const scalar = item?.columns.filter(column => column.parameter) ?? [];
    const columnOptions = selected => scalar.map(column => choice(column.name, column.name + ' · ' + column.type, column.name === selected)).join('');
    const limit = (name, label, low, high) => '<label>' + label + '<input data-limit="' + name + '" type="number" min="' + low + '" max="' + high + '" value="' + esc(plan?.[name]) + '"></label>';
    root.innerHTML = '<div class="columns"><aside class="panel"><h3>Database &amp; Parquet relations</h3><div class="toolbar"><button type="button" data-author="catalog"' + (!source.available ? ' disabled data-disabled="true"' : '') + '>Inspect current data</button></div>' +
      (loaded ? '<label>Relation<select data-author-relation>' + [...relations.values()].map(value => choice(value.id, value.kind + ' · ' + value.name, value.id === plan?.relationId)).join('') + '</select></label>' +
        (nextCursor ? '<button type="button" data-author="next">More relations</button>' : '<p class="small muted">All returned relations loaded.</p>') : '<p class="small muted">Reads native metadata from the selected source.</p>') +
      '<h4>Queries in this draft</h4>' + entries.map((entry, index) => '<div class="review-route"><strong>' + esc(entry.plan?.queryName) + '</strong><div class="toolbar"><button type="button" data-author-edit="' + index + '">Edit</button><button type="button" data-author-remove="' + index + '">Remove query &amp; routes</button></div></div>').join('') +
      '</aside><section class="panel grow">' + (item && plan ?
        '<div class="panel-heading"><h3>' + esc(item.name) + '</h3><span class="pill">' + esc(item.kind) + '</span></div>' +
        (item.fingerprint !== plan.relationFingerprint ? '<div class="notice">The relation schema changed. Saved selections are retained below.<div class="toolbar"><button type="button" data-author="adopt-schema">Review against current columns</button></div></div>' : '') +
        (item.columnsTruncated ? '<p class="notice">This relation has additional columns. The native catalog exposes the first 256 columns for selection.</p>' : '') +
        '<label>Named query<input data-author-name value="' + esc(plan.queryName) + '" autocomplete="off"></label><h4>Buyer-visible columns</h4><div class="author-columns">' +
        item.columns.map((column, index) => '<label><input type="checkbox" data-author-column="' + index + '"' + (plan.columns.includes(column.name) ? ' checked' : '') + '><span>' + esc(column.name) + '<small>' + esc(column.type) + '</small></span></label>').join('') + '</div>' +
        '<h4>Ordering</h4>' + plan.orderBy.map((order, index) => '<div class="author-row"><label>Column<select data-order-column="' + index + '">' + columnOptions(order.column) + '</select></label><label>Direction<select data-order-direction="' + index + '">' + choice('asc', 'Ascending', order.direction === 'asc') + choice('desc', 'Descending', order.direction === 'desc') + '</select></label><button type="button" data-remove-order="' + index + '">Remove</button></div>').join('') +
        '<button type="button" data-author="add-order">Add ordering column</button><h4>Optional buyer filters</h4>' +
        plan.filters.map((filter, index) => {
          const type = scalar.find(column => column.name === filter.column)?.parameter;
          const operators = [['eq', 'Equals'], ...(type?.ordered ? [['min', 'At least'], ['max', 'At most'], ['gt', 'Greater than'], ['lt', 'Less than']] : []), ...(type?.prefix ? [['prefix', 'Starts with']] : [])];
          return '<div class="author-row filter"><label>Column<select data-filter-column="' + index + '">' + columnOptions(filter.column) + '</select></label><label>Comparison<select data-filter-operator="' + index + '">' + operators.map(([value, label]) => choice(value, label, filter.operator === value)).join('') + '</select></label><label>Input name<input data-filter-name="' + index + '" value="' + esc(filter.name) + '"></label><button type="button" data-remove-filter="' + index + '">Remove</button></div>';
        }).join('') + '<button type="button" data-author="add-filter">Add filter</button><h4>Result limits</h4><div class="fields">' +
        limit('maxRows', 'Maximum rows', 1, 1000) + limit('maxBytes', 'Maximum result bytes', 1024, 917504) + limit('timeoutMs', 'Query deadline, milliseconds', 50, 30000) + '</div>' +
        '<div class="toolbar"><button type="button" data-author="review" class="primary">Review named query</button></div>' +
        (reviewed ? '<div class="notice" data-author-review><h4>' + esc(reviewed.queryName) + '</h4><p>' + reviewed.review.columns.length + ' explicit columns · ' + reviewed.review.filters.length + ' optional filters · ' + reviewed.review.maxRows + ' row limit.</p><p class="mono">' + reviewed.review.columns.map(column => esc(column.output + ': ' + column.type)).join('<br>') + '</p><button type="button" data-author="keep">Keep query &amp; configure route</button></div>' : '') :
        '<p class="empty">Inspect the current data to choose a relation. Existing draft queries are retained across sessions.</p>') + '</section></div>';
  }
  function edited(builder, redraw = false) {
    reviewed = null; updateBuilder(builder);
    if (redraw) render(); else root.querySelector('[data-author-review]')?.remove();
  }
  root.addEventListener('input', event => {
    const target = event.target, builder = structuredClone(getState().builder), item = relationFor(builder);
    if (!builder?.plan || !item) return;
    if (target.hasAttribute('data-author-name')) builder.plan.queryName = target.value;
    else if (target.dataset.limit) builder.plan[target.dataset.limit] = Number(target.value);
    else if (target.dataset.filterName !== undefined) builder.plan.filters[Number(target.dataset.filterName)].name = target.value;
    else return;
    edited(builder);
  });
  root.addEventListener('change', event => {
    const target = event.target;
    if (target.hasAttribute('data-author-relation')) return edited(builderFor(relations.get(target.value)), true);
    const builder = structuredClone(getState().builder), item = relationFor(builder);
    if (!builder?.plan || !item) return;
    if (target.dataset.authorColumn !== undefined) {
      const name = item.columns[Number(target.dataset.authorColumn)].name;
      builder.plan.columns = target.checked ? [...builder.plan.columns, name] : builder.plan.columns.filter(value => value !== name);
    } else if (target.dataset.orderColumn !== undefined) builder.plan.orderBy[Number(target.dataset.orderColumn)].column = target.value;
    else if (target.dataset.orderDirection !== undefined) builder.plan.orderBy[Number(target.dataset.orderDirection)].direction = target.value;
    else if (target.dataset.filterColumn !== undefined) {
      builder.plan.filters[Number(target.dataset.filterColumn)].column = target.value;
      builder.plan.filters[Number(target.dataset.filterColumn)].operator = 'eq';
    } else if (target.dataset.filterOperator !== undefined) builder.plan.filters[Number(target.dataset.filterOperator)].operator = target.value;
    else return;
    edited(builder, true);
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    const action = button.dataset.author, state = getState(), builder = structuredClone(state.builder), item = relationFor(builder);
    if (action === 'catalog' || action === 'next') return perform('Inspecting actual DuckDB metadata…', async () => {
      await load(action === 'next' ? nextCursor : undefined); render(); report('Native relation metadata loaded. Choose the columns and filters buyers may request.');
    });
    if (button.dataset.authorEdit !== undefined) return perform('Reopening authored query…', async () => {
      const entry = structuredClone(state.entries[Number(button.dataset.authorEdit)]);
      const reopened = await api('/api/author/reopen', { sourceSha256: state.source.sourceSha256, entry });
      acceptPage(reopened.catalog, reopened.cursor); edited(reopened.entry, true);
      report(reopened.schemaChanged ? 'The relation schema changed. Review the retained selections against current columns before replacing the query.' :
        'Reopened the query choices against current data. Review them before replacing the draft query.');
    });
    if (button.dataset.authorRemove !== undefined) { removeQuery(Number(button.dataset.authorRemove)); reviewed = null; render(); return; }
    if (!builder?.plan || !item) return;
    const scalar = item.columns.filter(column => column.parameter);
    if (action === 'adopt-schema') {
      const current = builderFor(item), columns = new Set(item.columns.map(column => column.name));
      current.plan = { ...builder.plan, relationFingerprint: item.fingerprint,
        columns: builder.plan.columns.filter(column => columns.has(column)),
        orderBy: builder.plan.orderBy.filter(order => scalar.some(column => column.name === order.column)),
        filters: builder.plan.filters.filter(filter => scalar.some(column => column.name === filter.column)).map(filter => {
          const type = scalar.find(column => column.name === filter.column).parameter;
          return { ...filter, operator: filter.operator === 'prefix' && !type.prefix || ['min','max','gt','lt'].includes(filter.operator) && !type.ordered ? 'eq' : filter.operator };
        }) };
      edited(current, true); report('Current schema selected. Review the displayed columns, ordering and filters before keeping this query.'); return;
    } else if (action === 'add-order' && builder.plan.orderBy.length < 4) {
      const column = scalar.find(column => !builder.plan.orderBy.some(order => order.column === column.name));
      if (column) builder.plan.orderBy.push({ column: column.name, direction: 'asc' });
    } else if (action === 'add-filter' && builder.plan.filters.length < 32 && scalar.length) {
      const names = new Set(builder.plan.filters.map(filter => filter.name)); let index = 1;
      while (names.has('filter_' + index)) index++;
      builder.plan.filters.push({ column: scalar[0].name, operator: 'eq', name: 'filter_' + index });
    } else if (button.dataset.removeOrder !== undefined) builder.plan.orderBy.splice(Number(button.dataset.removeOrder), 1);
    else if (button.dataset.removeFilter !== undefined) builder.plan.filters.splice(Number(button.dataset.removeFilter), 1);
    else if (action === 'review') return perform('Compiling the selected native query…', async () => {
      reviewed = await api('/api/author/review', { sourceSha256: state.source.sourceSha256, entry: builder });
      render(); report('Query compiled from actual relation metadata. Keep it to preview rows and configure its merchant route.');
    });
    else if (action === 'keep' && reviewed) { keepQuery(builder, reviewed); reviewed = null; render(); return; }
    else return;
    edited(builder, true);
  });
  return { render };
}

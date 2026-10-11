// MIT. Public PostgreSQL release metadata; no connection secrets or query execution.
const el = (tag, value, className) => {
  const item = document.createElement(tag);
  if (value !== undefined) item.textContent = value;
  if (className) item.className = className;
  return item;
};
const literal = value => value === undefined || value === null ? '—' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function lazy(title, render) {
  const details = el('details'), summary = el('summary', title), body = el('div');
  details.append(summary, body);
  details.addEventListener('toggle', () => {
    if (details.open && !body.childNodes.length) body.append(render());
    else if (!details.open) body.replaceChildren();
  });
  return details;
}
function pairs(entries) {
  const list = el('dl', undefined, 'postgres-fields');
  for (const [label, value] of entries) list.append(el('dt', label), el('dd', literal(value)));
  return list;
}
function queryContract(query) {
  const section = el('section');
  if (!query) { section.append(el('p', 'Query is absent from this release.')); return section; }
  section.append(pairs([['Maximum rows', query.maxRows], ['Maximum response bytes', query.maxBytes],
    ['Query deadline (ms)', query.timeoutMs], ['Projected columns, in order', query.columns],
    ['Parameter order', query.parameterOrder]]));
  const scroll = el('div', undefined, 'table-scroll'), table = el('table'), head = el('tr'), body = el('tbody');
  for (const label of ['Parameter', 'Type', 'Null allowed', 'Default', 'Exact constraints']) head.append(el('th', label));
  const thead = el('thead'); thead.append(head); table.append(thead, body);
  for (const name of query.parameterOrder ?? Object.keys(query.parameters ?? {})) {
    const parameter = query.parameters?.[name] ?? {}, { type, nullable, hasDefault, ...constraints } = parameter;
    const row = el('tr');
    row.append(el('td', name), el('td', literal(type)), el('td', nullable ? 'Yes' : 'No'),
      el('td', hasDefault ? 'Configured; value private' : 'None'), el('td', Object.keys(constraints).length ? literal(constraints) : '—'));
    body.append(row);
  }
  if (!body.childNodes.length) { const row = el('tr'), cell = el('td', 'No request parameters.'); cell.colSpan = 5; row.append(cell); body.append(row); }
  scroll.append(table); section.append(scroll); return section;
}
const identityFields = {
  inputManifestSha256: 'Original package manifest', originalSourceConfigSha256: 'Original database declaration',
  originalServiceConfigSha256: 'Original seller declaration', sourceConfigSha256: 'Retained runtime declaration',
  queryDefinitionSha256: 'Query definitions', bindingsSha256: 'Named query bindings', connectionPolicySha256: 'Database connection policy',
  databaseCaSha256: 'Database CA certificate', executionSha256: 'Complete execution configuration',
};

export function renderPostgresContract(postgres, routes = []) {
  const section = el('section', undefined, 'postgres-contract');
  section.append(el('p', 'The release retains the named read queries and payment choices. Database contents remain live. Restoring an earlier release restores its configuration.'));
  section.append(pairs([['Source', postgres.inputKind], ['Credential environment names', postgres.credentialReferences],
    ['Named queries', Object.keys(postgres.queries ?? {}).length]]));
  for (const [name, query] of Object.entries(postgres.queries ?? {})) section.append(lazy('Query · ' + name, () => queryContract(query)));
  if (routes.length) section.append(lazy('Exact payment terms · ' + routes.length + ' routes', () => {
    const list = el('div');
    for (const route of routes) {
      list.append(el('h4', (route.method ?? '') + ' ' + route.path), el('p', route.resource?.url ?? route.resource ?? ''));
      for (const term of route.payment ?? []) list.append(pairs([['Amount (atomic units)', term.amount], ['Asset', term.asset],
        ['Network', term.network], ['Receiver', term.payTo], ['Scheme', term.scheme]]));
    }
    return list;
  }));
  section.append(el('p', 'PostgreSQL integer, decimal and text values remain exact text or null. Query limits and parameter choices shown here are the retained contract.', 'section-note'));
  section.append(lazy('Complete source identities', () => pairs(Object.entries(identityFields).map(([key, label]) => [label, postgres[key]]))));
  return section;
}

export function renderPostgresComparison(before, after) {
  const section = el('section', undefined, 'change postgres-contract');
  section.append(el('h3', 'PostgreSQL query configuration'), el('p', 'This comparison describes configuration changes. It does not compare database rows.'));
  const credentials = pairs([['Earlier credential environment names', before?.credentialReferences], ['Candidate credential environment names', after?.credentialReferences]]);
  section.append(credentials);
  const names = new Set([...Object.keys(before?.queries ?? {}), ...Object.keys(after?.queries ?? {})]);
  let changes = 0;
  for (const name of names) {
    const previous = before?.queries?.[name], next = after?.queries?.[name];
    if (same(previous, next)) continue;
    changes++;
    section.append(lazy((!previous ? 'Added' : !next ? 'Removed' : 'Changed') + ' query · ' + name, () => {
      const columns = el('div', undefined, 'fields');
      for (const [label, value] of [['Before', previous], ['After', next]]) {
        const column = el('div'); column.append(el('h4', label), queryContract(value)); columns.append(column);
      }
      return columns;
    }));
  }
  if (!changes) section.append(el('p', 'Public parameter, output-column and limit selections are unchanged. The source identities below also cover private defaults and SQL.'));
  for (const [key, label] of Object.entries(identityFields)) if (before?.[key] !== after?.[key])
    section.append(lazy(label + ' changed', () => pairs([['Before SHA-256', before?.[key]], ['After SHA-256', after?.[key]]])));
  return section;
}

export function postgresRuntimeInputs(prefix) {
  const field = suffix => document.getElementById(prefix + suffix), port = Number(field('-port').value);
  if (field('-port').value === '' || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Enter a seller port from 0 to 65535.');
  const facilitator = field('-facilitator').value.trim(), allowLocal = field('-local-facilitator').checked;
  if (allowLocal && !facilitator) throw new Error('Enter the explicitly selected local facilitator URL.');
  return { port, ...(facilitator ? { facilitator } : {}), ...(allowLocal ? { allowLocalFacilitator: true } : {}) };
}

export function bindPostgresStaging({ request, notice, isBusy, setBusy, onStaged }) {
  const $ = id => document.getElementById(id);
  let review = null, reviewedPath = null, pending = null;
  const buttons = blocked => {
    $('postgres-review').disabled = blocked || Boolean(pending);
    $('postgres-stage').disabled = blocked || !review;
    for (const input of $('postgres-stage-form').querySelectorAll('input')) input.disabled = blocked || Boolean(pending);
    $('postgres-stage').textContent = pending ? 'Recover same stage' : 'Stage reviewed package';
  };
  $('postgres-package').addEventListener('input', () => { review = null; reviewedPath = null; $('postgres-package-review').hidden = true; buttons(isBusy()); });
  $('postgres-stage-form').addEventListener('submit', async event => {
    event.preventDefault(); if (isBusy()) return;
    setBusy(true); notice('Reading the prepared PostgreSQL package…');
    try {
      reviewedPath = $('postgres-package').value.trim();
      review = await request('/api/postgres/review', { postgresPackage: reviewedPath });
      $('postgres-package-origin').textContent = 'Public origin · ' + review.publicOrigin;
      $('postgres-package-contract').replaceChildren(renderPostgresContract(review.postgres, review.routes));
      $('postgres-package-review').hidden = false;
      notice('Package read. Review its fixed HTTPS origin, named queries, payment terms and launch choices, then stage it.');
    } catch (cause) { review = null; reviewedPath = null; notice(cause.message, true); }
    finally { setBusy(false); }
  });
  $('postgres-stage').addEventListener('click', async () => {
    if (isBusy() || !review) return;
    try {
      pending ??= { postgresPackage: reviewedPath, id: $('postgres-id').value.trim(),
        label: $('postgres-label').value.trim() || $('postgres-id').value.trim(), runtime: postgresRuntimeInputs('postgres'),
        expectedInputManifestSha256: review.postgres.inputManifestSha256 };
    } catch (cause) { notice(cause.message, true); return; }
    setBusy(true); notice('Retaining the reviewed PostgreSQL release…');
    try {
      const result = await request('/api/postgres/stage', pending); pending = null;
      await onStaged(result);
      notice((result.replayed ? 'Recovered the existing' : 'Staged the') + ' release ' + result.release.id + '. Review its comparison, then select and start it when ready.');
    } catch (cause) {
      if (cause.status) pending = null;
      notice(cause.message + (pending ? ' Keep this request and use Recover same stage; the immutable release ID prevents a second release.' : ''), true);
    } finally { setBusy(false); }
  });
  return { buttons };
}

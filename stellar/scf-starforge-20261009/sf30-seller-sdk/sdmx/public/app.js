/* MIT. Native SDMX source, series, project and edition workflows. */
(() => {
  'use strict';
  const root = document.getElementById('app');
  const connection = document.getElementById('connection-status');
  const PAGE = 50;
  const cache = new Map();
  const S = {
    summary: null, view: 'sources', busy: false, error: '', notice: '', dirty: false,
    sourceId: null, source: null, sourceTab: 'overview', sourceQuery: '', series: null,
    observations: null, observationKey: '', metaFlow: '', metaStructure: '', metaList: '',
    codeQuery: '', codeOffset: 0, flowQuery: '', flowOffset: 0,
    upload: {file: null, label: '', origin: '', kind: 'auto'}, importFile: null,
    project: null, projectTab: 'definition', draft: null, draftSeries: null, seriesQuery: '',
    projectRevision: '', query: null, queryDraft: null, queryCursors: [],
    compareDraft: {before: '', after: '', beforeRevision: '', afterRevision: ''},
    comparison: null, pending: null
  };
  let token = '';
  const text = value => value == null ? '' : String(value);
  const exact = value => value === null ? 'null' : value === undefined ? '—' :
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  const pretty = value => JSON.stringify(value, null, 2);
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';
  const sourceRecord = value => value?.source || value || {};
  const projectRecord = () => S.project?.project || null;
  const stamp = value => {
    if (value == null) return '—';
    const date = new Date(typeof value === 'number' && value < 100000000000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString();
  };
  const bytes = value => value == null ? '—' : count(value) + ' B';
  const operationId = () => crypto.randomUUID().replace(/-/g, '');
  const sourceName = id => {
    const found = S.summary?.sources.find(source => source.id === id);
    return found ? found.label || found.name || id : id;
  };
  const projectName = id => S.summary?.projects.find(project => project.id === id)?.title || id;
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'checked' || key === 'disabled' || key === 'required' || key === 'selected') node[key] = Boolean(value);
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const note = value => el('p', {class: 'help'}, value);
  const code = value => el('code', {}, exact(value));
  const button = (label, fn, attrs = {}) => {
    const node = el('button', {type: 'button', disabled: S.busy, ...attrs}, label);
    node.addEventListener('click', () => act(fn));
    return node;
  };
  const panel = (title, ...content) => el('section', {class: 'panel stack compact'},
    title ? el('h3', {}, title) : null, ...content);
  const actions = (...content) => el('div', {class: 'actions'}, ...content);
  const tag = value => el('span', {class: 'tag'}, value);
  function details(title, value) {
    const node = el('details', {class: 'details'}, el('summary', {}, title));
    let loaded = false;
    node.addEventListener('toggle', () => {
      if (node.open && !loaded) { node.append(el('pre', {}, pretty(value))); loaded = true; }
    });
    return node;
  }
  function info(pairs) {
    const node = el('dl', {class: 'metadata'});
    for (const [label, value] of pairs) if (value !== undefined)
      node.append(el('dt', {}, label), el('dd', {}, value instanceof Node ? value : exact(value)));
    return node;
  }
  function table(headings, rows) {
    return el('div', {class: 'table-wrap'}, el('table', {},
      el('thead', {}, el('tr', {}, headings.map(value => el('th', {scope: 'col'}, value)))),
      el('tbody', {}, rows.length ? rows.map(row => el('tr', {}, row.map(value => el('td', {}, value)))) :
        el('tr', {}, el('td', {colspan: headings.length}, 'No records in this page.')))));
  }
  function field(label, value, update, options = {}) {
    const input = el(options.options ? 'select' : options.multiline ? 'textarea' : 'input', {
      type: options.options || options.multiline ? undefined : options.type || 'text',
      'aria-label': label, value: undefined, disabled: S.busy || options.disabled,
      required: options.required, min: options.min, max: options.max, maxlength: options.maxlength,
      rows: options.multiline ? options.rows || 4 : undefined
    });
    if (options.options) for (const option of options.options) {
      const pair = Array.isArray(option) ? option : [option, option];
      input.append(el('option', {value: pair[0]}, pair[1]));
    }
    input.value = value ?? '';
    input.addEventListener(options.options ? 'change' : 'input', () => update(input.value));
    return el('label', {class: 'field' + (options.span ? ' span' : '')},
      label, input, options.hint ? note(options.hint) : null);
  }
  function check(label, checked, update, disabled = false) {
    const input = el('input', {type: 'checkbox', checked, disabled: S.busy || disabled});
    input.addEventListener('change', () => update(input.checked));
    return el('label', {class: 'check'}, input, label);
  }
  function fileField(label, accept, update) {
    const input = el('input', {type: 'file', accept, disabled: S.busy, 'aria-label': label});
    input.addEventListener('change', () => update(input.files?.[0] || null));
    return el('label', {class: 'field'}, label, input);
  }
  function form(submit, ...children) {
    const node = el('form', {class: 'stack compact'}, ...children);
    node.addEventListener('submit', event => { event.preventDefault(); act(submit); });
    return node;
  }
  const submit = label => el('button', {type: 'submit', class: 'primary', disabled: S.busy}, label);
  function pagination(page, move, label) {
    if (!page) return null;
    const offset = Number(page.offset || 0), total = Number(page.total || 0);
    const returned = page.rows?.length || 0;
    return el('div', {class: 'pagination'}, note(total ? count(offset + 1) + '–' + count(offset + returned) +
      ' of ' + count(total) : '0 records'),
      actions(button('Previous ' + label, () => move(Math.max(0, offset - PAGE)),
        {class: 'small', disabled: S.busy || offset === 0}),
      button('Next ' + label, () => move(offset + returned),
        {class: 'small', disabled: S.busy || offset + returned >= total || returned === 0})));
  }
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    let body = options.body;
    if (body !== undefined && !(body instanceof Blob)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    const response = await fetch(path, {
      method: options.method || (body === undefined ? 'GET' : 'POST'), headers, body,
      cache: 'no-store', credentials: 'omit', redirect: 'error'
    });
    if (!response.ok) {
      let message = 'Local operation returned ' + response.status + '.';
      try { const result = await response.json(); message = result.error || result.message || message; } catch {}
      const error = Error(message); error.status = response.status; throw error;
    }
    if (options.download) return response.blob();
    return response.json();
  }
  function url(path, values = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    return path + (query.size ? '?' + query : '');
  }
  async function download(path, filename) {
    const blob = await api(path, {download: true});
    const objectUrl = URL.createObjectURL(blob);
    const anchor = el('a', {href: objectUrl, download: filename});
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    S.notice = filename + ' downloaded.';
  }
  async function act(fn) {
    if (S.busy) return;
    S.busy = true; S.error = ''; render();
    try { await fn(); }
    catch (error) { S.error = error.message || String(error); }
    finally { S.busy = false; render(); }
  }
  function draftFrom(project) {
    return {id: project.id, revision: project.revision, title: project.title,
      data_source_id: project.data_source_id, metadata_source_ids: [...project.metadata_source_ids],
      flow_id: project.flow_id || '', selected: new Set(project.selection?.series_keys || []),
      selectionMode: project.selection?.series_keys?.length ? 'selected' : 'all',
      datasets: new Set(project.selection?.dataset_ids || []),
      datasetMode: project.selection?.dataset_ids?.length ? 'selected' : 'all', notes: project.notes || ''};
  }
  function leaveDraft() {
    if (!S.dirty) return true;
    if (!window.confirm('Discard the unsaved project changes?')) return false;
    S.draft = projectRecord() ? draftFrom(projectRecord()) : null;
    S.draftSeries = null; S.dirty = false; return true;
  }
  function pendingKey() {
    const identity = S.summary?.workspace?.id || S.summary?.workspace?.root || S.summary?.workspace || 'workspace';
    return 'sf30-sdmx-project-request:' + (typeof identity === 'string' ? identity : JSON.stringify(identity));
  }
  function retainPending(value) {
    S.pending = value;
    try {
      if (value) localStorage.setItem(pendingKey(), JSON.stringify(value));
      else localStorage.removeItem(pendingKey());
    } catch {
      if (value) S.notice = 'This tab retains the request. Keep it open until its saved result returns.';
    }
  }
  async function refresh() {
    S.summary = await api('/api/state');
    if (!S.pending) {
      try { S.pending = JSON.parse(localStorage.getItem(pendingKey()) || 'null'); } catch {}
    }
    connection.textContent = 'Retained workspace · ' + count(S.summary.sources.length) + ' sources · ' +
      count(S.summary.projects.length) + ' projects';
  }
  async function inspectSource(id) {
    if (!cache.has(id)) cache.set(id, await api('/api/sources/' + encodeURIComponent(id)));
    return cache.get(id);
  }
  async function openSource(id) {
    if (!leaveDraft()) return;
    S.view = 'sources'; S.sourceId = id; S.source = await inspectSource(id);
    S.sourceTab = 'overview'; S.sourceQuery = ''; S.observationKey = ''; S.series = null;
    S.observations = null; S.metaFlow = ''; S.metaStructure = ''; S.metaList = ''; S.codeOffset = 0;
    S.flowOffset = 0; S.flowQuery = ''; S.codeQuery = '';
  }
  async function seriesPage(offset = 0, draft = false) {
    const id = draft ? S.draft.data_source_id : S.sourceId;
    const page = await api(url('/api/sources/' + encodeURIComponent(id) + '/series',
      {offset, limit: PAGE, query: draft ? S.seriesQuery : S.sourceQuery}));
    if (draft) S.draftSeries = page; else S.series = page;
  }
  async function observationPage(offset = 0) {
    S.observations = await api(url('/api/sources/' + encodeURIComponent(S.sourceId) + '/observations',
      {offset, limit: PAGE, series_key: S.observationKey}));
  }
  function metadataFor(ids) {
    const result = {flows: [], structures: [], codelists: [], dimensions: []};
    for (const id of ids) {
      const source = cache.get(id);
      if (!source) continue;
      for (const key of Object.keys(result)) result[key].push(...(source[key] || []));
    }
    return result;
  }
  async function draftMetadata() {
    for (const id of [S.draft.data_source_id, ...S.draft.metadata_source_ids].filter(Boolean)) await inspectSource(id);
  }
  function reference(value) {
    if (!value) return '';
    return (value.agency_id ? value.agency_id + ':' : '') + value.id +
      (value.version ? '(' + value.version + ')' : '');
  }
  function sameReference(left, right) {
    return left && right && left.id === right.id &&
      (!right.agency_id || left.agency_id === right.agency_id) &&
      (!right.version || left.version === right.version);
  }
  function codeLabel(metadata, dimension, value) {
    const dimensions = [...(metadata?.dimensions || []),
      ...(metadata?.structures || []).flatMap(structure => structure.dimensions || [])];
    const references = dimensions.filter(item => item.id === dimension && item.codelist).map(item => item.codelist);
    const labels = new Set();
    for (const ref of references) for (const list of metadata?.codelists || []) {
      if (!sameReference(list, ref)) continue;
      const item = (list.codes || []).find(code => code.id === value);
      if (item?.name) labels.add(item.name);
    }
    return labels.size === 1 ? [...labels][0] : '';
  }
  function dimensionsCell(dimensions, metadata) {
    return el('div', {class: 'cell-list'}, Object.entries(dimensions || {}).map(([key, value]) => {
      const label = codeLabel(metadata, key, value);
      return el('div', {}, code(key), ': ', code(value),
        label ? el('span', {class: 'quiet'}, ' · ' + label) : null);
    }));
  }
  function recordsTable(rows, metadata, selection = false) {
    return table([...(selection ? ['Include'] : []), 'Source dataset', 'Series key', 'Dimensions', 'Observations', 'Attributes', ''],
      rows.map(row => {
        const selected = S.draft?.selectionMode === 'all' || S.draft?.selected.has(row.series_key);
        return [...(selection ? [check('Include series ' + row.series_key, selected, value => {
          if (value) S.draft.selected.add(row.series_key); else S.draft.selected.delete(row.series_key);
          S.dirty = true;
          const label = document.getElementById('selection-count');
          if (label) label.textContent = count(S.draft.selected.size) + ' explicit series selected';
        }, S.draft.selectionMode === 'all')] : []),
        code(row.dataset_id), code(row.series_key), dimensionsCell(row.dimensions, metadata), count(row.observation_count),
        details('Original attributes', {series: row.attributes, raw: row.raw_attributes}),
        button('Observations', async () => {
          if (selection) {
            const sourceId = S.draft.data_source_id;
            if (!leaveDraft()) return;
            S.sourceId = sourceId; S.source = await inspectSource(S.sourceId); S.view = 'sources';
          }
          S.observationKey = row.series_key; S.sourceTab = 'observations'; await observationPage();
        }, {class: 'small'})];
      }));
  }
  function sourceOverview() {
    const source = sourceRecord(S.source);
    return el('div', {class: 'stack'}, panel('Retained source',
      info([['Original filename', source.name], ['Source label', source.label],
        ['Origin', source.origin || 'No origin supplied'], ['Kind', S.source.kind || source.kind],
        ['Bytes', bytes(source.bytes)], ['SHA-256', code(source.sha256 || source.id)], ['Retained', stamp(source.created_at)]]),
      el('div', {class: 'metrics'},
        el('div', {class: 'metric'}, el('strong', {}, count(S.source.series_count ?? source.series_count)), el('span', {}, 'series')),
        el('div', {class: 'metric'}, el('strong', {}, count(S.source.observation_count ?? source.observation_count)), el('span', {}, 'observations')),
        el('div', {class: 'metric'}, el('strong', {}, count((S.source.flows || []).length)), el('span', {}, 'dataflows')),
        el('div', {class: 'metric'}, el('strong', {}, count((S.source.structures || []).length)), el('span', {}, 'structures'))),
      note('The original source, literal values and metadata are retained together with each saved project.'),
      source.kind === 'data' || Number(source.series_count) > 0 ?
        actions(button('Create project from this source', () => newProject(source.id), {class: 'primary'})) : null),
      (S.source.datasets || []).length ? panel('Original source datasets',
        table(['Dataset identity', 'Action', 'Structure reference', 'Original dataset metadata'],
          S.source.datasets.map(dataset => [code(dataset.id), code(dataset.action),
            code(reference(dataset.structure_reference)), details('Dataset attributes and controls', dataset)]))) : null,
      S.source.coverage ? panel('Source coverage', details('Original coverage', S.source.coverage)) : null,
      (S.source.acquisitions || []).length ? panel('Original acquisition records',
        details('Retained source requests and receipts', S.source.acquisitions)) : null);
  }
  function metadataView(source) {
    const flows = source.flows || [], structures = source.structures || [], lists = source.codelists || [];
    const search = S.flowQuery.toLowerCase();
    const filteredFlows = flows.filter(flow => (reference(flow) + ' ' + (flow.name || '')).toLowerCase().includes(search));
    const flowPage = filteredFlows.slice(S.flowOffset, S.flowOffset + PAGE);
    const structure = structures.find(item => reference(item) === S.metaStructure) || structures[0];
    const list = lists.find(item => reference(item) === S.metaList) || lists[0];
    const codeSearch = S.codeQuery.toLowerCase();
    const filteredCodes = (list?.codes || []).filter(item => (item.id + ' ' + (item.name || '')).toLowerCase().includes(codeSearch));
    return el('div', {class: 'stack'},
      panel('Dataflows',
        form(async () => { S.flowOffset = 0; },
          field('Find a dataflow', S.flowQuery, value => S.flowQuery = value),
          actions(submit('Find dataflows'))),
        table(['Flow', 'Name', 'Referenced structure', ''], flowPage.map(flow => [
          code(reference(flow)), flow.name || '', code(reference(flow.structure)),
          details('Original flow metadata', flow)])),
        pagination({rows: flowPage, offset: S.flowOffset, total: filteredFlows.length},
          async offset => { S.flowOffset = offset; }, 'dataflows')),
      panel('Data structure',
        structures.length ? field('Data structure', structure ? reference(structure) : '', value => {
          S.metaStructure = value; render();
        }, {options: structures.map(item => [reference(item), reference(item) + (item.name ? ' · ' + item.name : '')])}) :
          note('This source supplies no data structure definition. Attach its referenced structure when creating a project.'),
        structure ? info([['Structure', code(reference(structure))], ['Name', structure.name || '']]) : null,
        structure ? table(['Position', 'Dimension', 'Role', 'Code list'],
          (structure.dimensions || []).map(dimension => [dimension.position ?? '—', code(dimension.id),
            dimension.role, code(reference(dimension.codelist))])) : null,
        structure ? note('Series key order comes from these declared dimensions. Time and measure dimensions remain distinct.') : null,
        structure?.attributes?.length ? table(['Attribute', 'Assignment', 'Relationship', 'Code list'],
          structure.attributes.map(attribute => [code(attribute.id), attribute.assignment_status || '',
            code(attribute.relationship), code(reference(attribute.codelist))])) : null,
        structure ? details('Original structure and measures', structure) : null),
      panel('Code labels',
        lists.length ? field('Code list', list ? reference(list) : '', value => {
          S.metaList = value; S.codeOffset = 0; S.codeQuery = ''; render();
        }, {options: lists.map(item => [reference(item), reference(item) + (item.name ? ' · ' + item.name : '')])}) :
          note('This source contains no embedded code lists.'),
        list ? form(async () => { S.codeOffset = 0; },
          field('Find a code or label', S.codeQuery, value => S.codeQuery = value),
          actions(submit('Find codes'))) : null,
        list ? table(['Literal code', 'Label', 'Parent'], filteredCodes.slice(S.codeOffset, S.codeOffset + PAGE)
          .map(item => [code(item.id), item.name || '', item.parent ? code(item.parent) : ''])) : null,
        list ? pagination({rows: filteredCodes.slice(S.codeOffset, S.codeOffset + PAGE),
          offset: S.codeOffset, total: filteredCodes.length}, async offset => { S.codeOffset = offset; }, 'codes') : null,
        note('A valid code label does not establish that every combination exists. Select from the actual retained series.')));
  }
  function sourcesView() {
    const sidebar = el('aside', {class: 'sidebar source-list', 'aria-label': 'Retained sources'},
      el('div', {class: 'section-title'}, el('h2', {}, 'Sources'), tag(count(S.summary.sources.length))));
    for (const source of S.summary.sources) sidebar.append(button(el('span', {class: 'stack compact'},
      el('strong', {}, source.label || source.name), el('span', {class: 'quiet'}, source.kind + ' · ' + bytes(source.bytes))),
      () => openSource(source.id), {'aria-current': source.id === S.sourceId ? 'true' : undefined}));
    const content = el('div', {class: 'stack'});
    if (!S.source) {
      content.append(panel('Retain an original SDMX file',
        form(uploadSource,
          fileField('Original SDMX file', '.xml,.csv,text/xml,application/xml,text/csv', file => {
            S.upload.file = file; if (file && !S.upload.label) S.upload.label = file.name; render();
          }),
          S.upload.file ? note('Selected: ' + S.upload.file.name + ' · ' + bytes(S.upload.file.size)) : null,
          el('div', {class: 'grid'},
            field('Source label', S.upload.label, value => S.upload.label = value, {required: true, maxlength: 160}),
            field('Source kind', S.upload.kind, value => S.upload.kind = value, {options: [
              ['auto', 'Detect from the original file'], ['catalog', 'Dataflow catalog'],
              ['structure', 'Structure and code lists'], ['data', 'Series and observations']]})),
          field('Original provider URL', S.upload.origin, value => S.upload.origin = value,
            {type: 'url', hint: 'Retain the original HTTP or HTTPS request URL, including its series key and reporting-period query.'}),
          actions(submit('Retain source'))),
        note('Upload the original catalog, referenced structure and data response. Each file keeps its original bytes and checksum.')),
        panel('Reopen a portable project',
          form(importProject,
            fileField('Portable project ZIP', '.zip,application/zip', file => { S.importFile = file; render(); }),
            S.importFile ? note('Selected: ' + S.importFile.name + ' · ' + bytes(S.importFile.size)) : null,
            actions(submit('Import retained project'))),
          note('A portable packet carries original sources, metadata and saved revisions into this retained workspace.')));
    } else {
      content.append(el('div', {class: 'toolbar'},
        el('div', {}, el('h2', {}, sourceRecord(S.source).label || sourceRecord(S.source).name),
          note('Original retained source')),
        actions(button('Add another source', async () => { if (leaveDraft()) { S.source = null; S.sourceId = null; } }))));
      content.append(tabs('Source sections', ['overview','metadata','series','observations'], S.sourceTab, async name => {
        S.sourceTab = name;
        if (name === 'series' && !S.series) await seriesPage();
        if (name === 'observations' && !S.observations) await observationPage();
      }));
      if (S.sourceTab === 'overview') content.append(sourceOverview());
      if (S.sourceTab === 'metadata') content.append(metadataView(S.source));
      if (S.sourceTab === 'series') content.append(panel('Actual series',
        form(() => seriesPage(), field('Find a series', S.sourceQuery, value => S.sourceQuery = value),
          actions(submit('Find series'))),
        S.series ? recordsTable(S.series.rows, S.source) : note('Loading the retained series…'),
        pagination(S.series, offset => seriesPage(offset), 'series')));
      if (S.sourceTab === 'observations') content.append(panel('Original observations',
        S.observationKey ? actions(code(S.observationKey),
          button('All observations', async () => { S.observationKey = ''; await observationPage(); }, {class: 'small'})) :
          note('All retained series in their original source order.'),
        S.observations ? table(['Source dataset', 'Series key', 'Period', 'Original value', 'Value presence', 'Dimensions', 'Original attributes'],
          S.observations.rows.map(row => [code(row.dataset_id), code(row.series_key), code(row.time_period),
            row.value === null ? 'Missing' : code(row.value), row.value_present ? 'Present in source' : 'Absent in source',
            dimensionsCell(row.dimensions, S.source), details('Attributes and action', {
              observation: row.attributes, series: row.series_attributes, series_raw: row.series_raw_attributes,
              dataset: row.dataset_attributes, action: row.action})])) : null,
        pagination(S.observations, offset => observationPage(offset), 'observations')));
    }
    return el('div', {class: 'layout'}, sidebar, content);
  }
  async function uploadSource() {
    const value = S.upload;
    if (!value.file) throw Error('Choose the original source file.');
    const result = await api('/api/sources/upload', {body: value.file, headers: {
      'Content-Type': value.file.type || 'application/octet-stream',
      'X-SDMX-Name': encodeURIComponent(value.file.name), 'X-SDMX-Label': encodeURIComponent(value.label),
      'X-SDMX-Origin': encodeURIComponent(value.origin), 'X-SDMX-Kind': value.kind
    }});
    const id = sourceRecord(result).id;
    await refresh(); await openSource(id);
    S.notice = 'Original source retained with its checksum.';
    S.upload = {file: null, label: '', origin: '', kind: 'auto'};
  }
  async function importProject() {
    if (!S.importFile) throw Error('Choose the original portable project ZIP.');
    const result = await api('/api/import', {body: S.importFile, headers: {'Content-Type': 'application/zip'}});
    cache.clear(); await refresh(); S.importFile = null; S.view = 'projects'; S.project = null; S.draft = null;
    S.notice = 'Portable project imported. Its sources and saved revisions are available in Projects.';
    const id = result.project?.id || result.project_id;
    if (id) await openProject(id);
  }
  function tabs(label, names, current, change) {
    return el('nav', {class: 'tabs', 'aria-label': label}, names.map(name =>
      button(name.charAt(0).toUpperCase() + name.slice(1), () => change(name),
        {'aria-current': name === current ? 'page' : undefined})));
  }
  async function newProject(dataSourceId = '') {
    if (S.pending) throw Error('Recover the retained project request before starting another project.');
    if (!leaveDraft()) return;
    S.view = 'projects'; S.project = null; S.projectTab = 'definition'; S.projectRevision = '';
    S.draft = {id: null, revision: null, title: '', data_source_id: dataSourceId,
      metadata_source_ids: [], flow_id: '', selected: new Set(), selectionMode: 'all',
      datasets: new Set(), datasetMode: 'all', notes: ''};
    S.draftSeries = null; S.seriesQuery = ''; S.query = null; S.queryDraft = null;
    if (dataSourceId) { await draftMetadata(); await seriesPage(0, true); }
  }
  async function openProject(id, revision) {
    if (!leaveDraft()) return;
    S.view = 'projects'; S.project = await api(url('/api/projects/' + encodeURIComponent(id), {revision}));
    const project = projectRecord();
    S.projectRevision = project.revision; S.projectTab = 'definition';
    S.draft = draftFrom(project);
    S.draftSeries = null; S.seriesQuery = ''; S.query = null; S.queryDraft = null; S.queryCursors = [];
    await draftMetadata(); await seriesPage(0, true);
  }
  function latestRevision(id) {
    return id === projectRecord()?.id && S.project.current_revision ? S.project.current_revision :
      S.summary.projects.find(project => project.id === id)?.revision;
  }
  function historical() {
    const project = projectRecord();
    return Boolean(project && project.revision !== latestRevision(project.id));
  }
  function pendingPanel() {
    if (!S.pending) return null;
    return panel('Retained project request',
      note('The same operation identifier and exact saved-project values remain available after a missing response.'),
      info([['Operation', code(S.pending.operation_id)], ['Project title', S.pending.title]]),
      actions(button('Retry same project save', retryProject, {class: 'primary'}),
        button('Refresh saved projects', refresh)),
      details('Exact retained project request', S.pending));
  }
  async function saveProject() {
    if (S.pending) throw Error('Recover the retained project request before saving another revision.');
    const draft = S.draft;
    if (!draft.data_source_id) throw Error('Choose a retained data source.');
    if (draft.selectionMode === 'selected' && !draft.selected.size) throw Error('Select at least one actual series.');
    if (draft.datasetMode === 'selected' && !draft.datasets.size) throw Error('Select at least one original dataset edition.');
    const body = {operation_id: operationId(), title: draft.title, data_source_id: draft.data_source_id,
      metadata_source_ids: [...draft.metadata_source_ids], flow_id: draft.flow_id || null,
      selection: {series_keys: draft.selectionMode === 'all' ? [] : [...draft.selected].sort(),
        dataset_ids: draft.datasetMode === 'all' ? [] : [...draft.datasets].sort()}, notes: draft.notes};
    if (draft.id) { body.id = draft.id; body.expected_revision = draft.revision; }
    retainPending(body); await retryProject();
  }
  async function retryProject() {
    const pending = S.pending;
    if (!pending) return;
    let result;
    try { result = await api('/api/projects', {body: pending}); }
    catch (error) {
      if (error.status >= 400 && error.status < 500 && ![408,425,429].includes(error.status)) retainPending(null);
      throw error;
    }
    retainPending(null); S.dirty = false; await refresh(); await openProject(result.project.id, result.project.revision);
    S.notice = 'Project revision ' + result.project.revision + ' saved with the original dataset snapshot.';
  }
  function datasetEditor(disabled) {
    const draft = S.draft;
    const datasets = cache.get(draft.data_source_id)?.datasets || [];
    return panel('Original dataset editions',
      field('Dataset coverage', draft.datasetMode, value => {
        draft.datasetMode = value; S.dirty = true; render();
      }, {disabled, options: [['all', 'All original datasets in this source'],
        ['selected', 'Only the explicitly checked dataset editions']]}),
      note('Select the original dataset edition when a provider response retains several observations for the same series and period. Dataset actions and attributes remain visible.'),
      table(['Include', 'Dataset identity', 'Action', 'Structure reference', 'Original metadata'],
        datasets.map(dataset => [check('Include dataset ' + dataset.id,
          draft.datasetMode === 'all' || draft.datasets.has(dataset.id), value => {
            if (value) draft.datasets.add(dataset.id); else draft.datasets.delete(dataset.id);
            S.dirty = true;
          }, disabled || draft.datasetMode === 'all'), code(dataset.id), code(dataset.action),
          code(reference(dataset.structure_reference)), details('Original dataset ' + dataset.id, dataset)])),
      draft.datasetMode === 'selected' ? details('Exact selected dataset identities', [...draft.datasets].sort()) : null);
  }
  function selectionEditor(disabled) {
    const draft = S.draft;
    const metadata = metadataFor([draft.data_source_id, ...draft.metadata_source_ids].filter(Boolean));
    return panel('Series selection',
      field('Series coverage', draft.selectionMode, value => {
        draft.selectionMode = value; S.dirty = true; render();
      }, {disabled, options: [['all', 'All series in this retained data source'], ['selected', 'Only the explicitly checked series']]}),
      el('p', {class: 'help', id: 'selection-count'}, draft.selectionMode === 'all' ?
        'All native series from the selected immutable source.' : count(draft.selected.size) + ' explicit series selected'),
      form(() => seriesPage(0, true), field('Find series to select', S.seriesQuery, value => S.seriesQuery = value),
        actions(submit('Find selectable series'))),
      draft.selectionMode === 'selected' && !disabled ? actions(
        button('Select this page', async () => {
          for (const row of S.draftSeries?.rows || []) draft.selected.add(row.series_key); S.dirty = true;
        }, {class: 'small'}),
        button('Clear selected series', async () => { draft.selected.clear(); S.dirty = true; }, {class: 'small'})) : null,
      S.draftSeries ? recordsTable(S.draftSeries.rows, metadata, !disabled) : note('Choose a retained data source to inspect its series.'),
      pagination(S.draftSeries, offset => seriesPage(offset, true), 'selectable series'),
      draft.selectionMode === 'selected' ? details('Exact selected series keys', [...draft.selected].sort()) : null);
  }
  function definitionView() {
    const draft = S.draft;
    const disabled = historical() || Boolean(S.pending);
    const metadata = metadataFor([draft.data_source_id, ...draft.metadata_source_ids].filter(Boolean));
    const flows = [...new Map(metadata.flows.map(flow => [reference(flow), flow])).values()];
    const dataSources = S.summary.sources.filter(source => source.kind === 'data' || Number(source.series_count) > 0);
    const editable = form(saveProject,
      el('div', {class: 'grid'},
        field('Project title', draft.title, value => { draft.title = value; S.dirty = true; },
          {required: true, maxlength: 128, disabled}),
        field('Retained data source', draft.data_source_id, value => act(async () => {
          draft.data_source_id = value; draft.selected.clear(); draft.datasets.clear(); draft.datasetMode = 'all';
          S.dirty = true; S.draftSeries = null;
          if (value) { await draftMetadata(); await seriesPage(0, true); }
        }), {required: true, disabled, options: [['', 'Choose a retained data source'],
          ...dataSources.map(source => [source.id, source.label || source.name])]})),
      panel('Referenced metadata',
        el('div', {class: 'checks'}, S.summary.sources.filter(source => source.id !== draft.data_source_id).map(source =>
          check((source.label || source.name) + ' · ' + source.kind,
            draft.metadata_source_ids.includes(source.id), value => act(async () => {
              if (value) draft.metadata_source_ids.push(source.id);
              else draft.metadata_source_ids = draft.metadata_source_ids.filter(id => id !== source.id);
              S.dirty = true; await draftMetadata();
            }), disabled))),
        note('Attach the provider’s original dataflow catalog, referenced data structure and code lists.'),
        field('Dataflow', draft.flow_id, value => { draft.flow_id = value; S.dirty = true; },
          {disabled, options: [['', 'No flow selected'],
            ...(draft.flow_id && !flows.some(flow => reference(flow) === draft.flow_id) ?
              [[draft.flow_id, 'Retained flow identifier · ' + draft.flow_id]] : []),
            ...flows.map(flow => [reference(flow), reference(flow) + (flow.name ? ' · ' + flow.name : '')])]})),
      field('Project notes', draft.notes, value => { draft.notes = value; S.dirty = true; },
        {multiline: true, disabled, hint: 'Retain source context, selection rationale and interpretation with this revision.'}),
      !disabled ? actions(submit(draft.id ? 'Save new revision' : 'Save project'),
        draft.id ? button('Reload saved revision', async () => { await openProject(draft.id, draft.revision); }) : null) :
        note(S.pending ? 'Resolve the retained project request to continue editing.' :
          'This retained revision is read only. Open the latest revision to edit the project.'));
    return el('div', {class: 'stack'}, panel('Project definition', editable),
      draft.data_source_id ? datasetEditor(disabled) : null,
      draft.data_source_id ? selectionEditor(disabled) : null,
      S.project ? panel('Native dataset snapshot',
        info([['Project', code(projectRecord().id)], ['Revision', projectRecord().revision],
          ['Operation', code(projectRecord().operation_id)], ['Snapshot', code(S.project.build?.snapshot)],
          ['Rows', count(S.project.build?.dataset?.rowCount)], ['Source', sourceName(projectRecord().data_source_id)]]),
        details('Original dataset schema', S.project.build?.dataset),
        actions(button('Download dataset', () => exportProject('dataset')),
          button('Download portable project', () => exportProject('packet')))) : null);
  }
  async function exportProject(kind) {
    const project = projectRecord();
    if (!project) throw Error('Save a project before exporting its retained snapshot.');
    await download(url('/api/projects/' + encodeURIComponent(project.id) + '/' + kind, {revision: project.revision}),
      kind === 'packet' ? 'sdmx-project.zip' : 'sf30-sdmx-dataset.zip');
  }
  function invalidateQuery() {
    S.query = null; S.queryCursors = [];
    const previous = document.getElementById('native-query-result');
    if (previous) previous.replaceChildren(note('Query inputs changed. Run the native query to refresh the result.'));
  }
  function initializeQuery() {
    if (S.queryDraft) return;
    const dataset = S.project.build.dataset;
    S.queryDraft = {fields: new Set(dataset.columns.map(column => column.name)),
      limit: String(dataset.defaultLimit), sort: '', filters: []};
  }
  function operators(column) {
    const values = [];
    if (column?.filterable) values.push(['where', 'equals']);
    if (column?.rangeFilterable) values.push(['gt', 'greater than'], ['gte', 'at least'], ['lt', 'less than'], ['lte', 'at most']);
    return values;
  }
  function queryParams(cursor) {
    const draft = S.queryDraft;
    if (!draft.fields.size) throw Error('Select at least one original dataset field.');
    const params = {fields: [...draft.fields].join(','), limit: draft.limit};
    if (draft.sort) params.sort = draft.sort;
    for (const row of draft.filters) {
      const key = row.operator + '_' + row.column;
      if (Object.hasOwn(params, key)) throw Error('Each native filter parameter can occur once: ' + key);
      params[key] = row.value;
    }
    if (cursor) params.cursor = cursor;
    return params;
  }
  async function queryProject(cursor, previous = false) {
    initializeQuery();
    const result = await api('/api/query', {body: {project_id: projectRecord().id,
      revision: projectRecord().revision, params: queryParams(cursor)}});
    if (result.response?.status !== 200)
      throw Error(result.response?.body?.message || result.response?.body?.error || 'The original dataset engine rejected this query.');
    if (!cursor) S.queryCursors = [null];
    else if (!previous) S.queryCursors.push(cursor);
    S.query = result;
  }
  function queryView() {
    if (!S.project) return note('Save a project to query its original dataset.');
    initializeQuery();
    const dataset = S.project.build.dataset, draft = S.queryDraft;
    const filterable = dataset.columns.filter(column => operators(column).length);
    const formNode = form(() => queryProject(),
      el('h3', {}, 'Returned fields'),
      el('div', {class: 'checks'}, dataset.columns.map(column => check(column.name + ' · ' + column.type,
        draft.fields.has(column.name), value => {
          if (value) draft.fields.add(column.name); else draft.fields.delete(column.name);
          invalidateQuery();
        }))),
      el('div', {class: 'grid'},
        field('Rows per page', draft.limit, value => { draft.limit = value; invalidateQuery(); }, {type: 'number', min: 1, max: dataset.maxLimit, required: true}),
        field('Order', draft.sort, value => { draft.sort = value; invalidateQuery(); }, {options: [['', 'Original CSV record order'],
          ...dataset.columns.filter(column => column.sortable).flatMap(column => [
            [column.name, column.name + ' · ascending'], ['-' + column.name, column.name + ' · descending']])]})),
      el('div', {class: 'stack compact'}, draft.filters.map((row, index) => {
        const column = dataset.columns.find(column => column.name === row.column);
        return el('div', {class: 'filter-row'},
          field('Filter field ' + (index + 1), row.column, value => {
            row.column = value; row.operator = operators(dataset.columns.find(column => column.name === value))[0][0];
            invalidateQuery(); render();
          }, {options: filterable.map(column => [column.name, column.name])}),
          field('Filter condition ' + (index + 1), row.operator, value => { row.operator = value; invalidateQuery(); },
            {options: operators(column)}),
          field('Filter value ' + (index + 1), row.value, value => { row.value = value; invalidateQuery(); },
            {hint: column?.nullable && row.operator === 'where' ? 'An empty value selects the native null value.' : 'Exact native ' + (column?.type || 'value')}),
          button('Remove filter ' + (index + 1), async () => { draft.filters.splice(index, 1); S.query = null; }, {class: 'small'}));
      })),
      actions(filterable.length ? button('Add filter', async () => {
        const column = filterable[0]; draft.filters.push({column: column.name, operator: operators(column)[0][0], value: ''});
      }) : null, submit('Run native query')),
      note('Fields, filters, ranges, ordering and cursors use the original saved SF30 dataset schema.'));
    const body = S.query?.response?.body;
    const output = body ? panel('Native query result',
        info([['Snapshot', code(body.dataset.snapshot)], ['Total matching rows', count(body.page.total)],
          ['Returned', count(body.page.returned)], ['Engine source', code(S.query.engineBlob)]]),
        table(body.fields, body.rows.map(row => body.fields.map(name => code(row[name])))),
        actions(button('Previous query page', async () => {
          S.queryCursors.pop();
          await queryProject(S.queryCursors[S.queryCursors.length - 1], true);
        }, {disabled: S.busy || S.queryCursors.length <= 1}),
        button('Next query page', () => queryProject(body.page.nextCursor),
          {disabled: S.busy || !body.page.nextCursor})),
        details('Original native response', S.query)) : null;
    if (output) output.id = 'native-query-result';
    return el('div', {class: 'stack'}, panel('Query saved revision ' + projectRecord().revision, formNode), output);
  }
  function historyView() {
    const project = projectRecord();
    const latest = latestRevision(project.id);
    return panel('Retained project revisions',
      note('Open an exact saved revision to inspect its original sources, selection, schema and dataset snapshot.'),
      form(() => openProject(project.id, S.projectRevision),
        field('Revision to open', S.projectRevision, value => S.projectRevision = value,
          {type: 'number', min: 1, max: latest, required: true}),
        actions(submit('Open saved revision'))),
      info([['Current view', project.revision], ['Latest saved revision', latest],
        ['Created', stamp(project.created_at)], ['Updated', stamp(project.updated_at)],
        ['Operation', code(project.operation_id)]]),
      (S.project.revisions || []).length ? table(['Revision', 'Title', 'Saved', ''],
        S.project.revisions.map(revision => [revision.revision, revision.title, stamp(revision.updated_at),
          button('Open revision ' + revision.revision, () => openProject(project.id, revision.revision), {class: 'small'})])) : null,
      details('Exact saved project definition', project),
      actions(button('Copy as a new project', async () => {
        if (!leaveDraft()) return;
        const copy = {...S.draft, id: null, revision: null, title: S.draft.title + ' copy',
          selected: new Set(S.draft.selected), datasets: new Set(S.draft.datasets),
          metadata_source_ids: [...S.draft.metadata_source_ids]};
        S.project = null; S.draft = copy; S.projectTab = 'definition'; S.dirty = true;
      }), button('Compare revisions', async () => {
        S.compareDraft = {before: project.id, after: project.id, beforeRevision: String(project.revision), afterRevision: String(latest)};
        S.view = 'comparisons'; S.comparison = null;
      })));
  }
  function projectsView() {
    const content = el('div', {class: 'stack'},
      el('div', {class: 'toolbar'}, el('h2', {}, 'Projects'),
        actions(button('New project', () => newProject(), {class: 'primary'}), button('Refresh projects', refresh))));
    if (!S.draft) {
      content.append(S.summary.projects.length ? table(['Project', 'Revision', 'Retained data source', 'Updated', ''],
        S.summary.projects.map(project => [project.title, project.revision, sourceName(project.data_source_id),
          stamp(project.updated_at), button('Open project', () => openProject(project.id), {class: 'small'})])) :
        el('div', {class: 'empty'}, el('h3', {}, 'Create a project from retained series'),
          note('Add the original data and metadata sources, then select actual series and save a native dataset.')));
      return content;
    }
    content.append(el('div', {class: 'toolbar'},
      el('div', {}, el('h2', {}, projectRecord()?.title || 'New project'), note(projectRecord() ?
        'Revision ' + projectRecord().revision + (historical() ? ' · retained historical view' : ' · latest saved revision') : 'Unsaved project')),
      actions(button('All projects', async () => { if (leaveDraft()) { S.draft = null; S.project = null; } }))));
    content.append(tabs('Project sections', S.project ? ['definition','query','history'] : ['definition'],
      S.projectTab, async name => { S.projectTab = name; }));
    if (S.projectTab === 'definition') content.append(definitionView());
    if (S.projectTab === 'query') content.append(queryView());
    if (S.projectTab === 'history') content.append(historyView());
    return content;
  }
  async function runComparison() {
    const draft = S.compareDraft;
    if (!draft.before || !draft.after) throw Error('Choose the two saved project editions.');
    const result = await api('/api/comparisons', {body: {before_project: draft.before, after_project: draft.after,
      before_revision: draft.beforeRevision ? Number(draft.beforeRevision) : null,
      after_revision: draft.afterRevision ? Number(draft.afterRevision) : null}});
    await refresh(); await openComparison(result.id);
    S.notice = 'Edition comparison retained.';
  }
  async function openComparison(id, offset = 0) {
    if (!leaveDraft()) return;
    S.view = 'comparisons';
    S.comparison = await api(url('/api/comparisons/' + encodeURIComponent(id), {offset, limit: PAGE}));
  }
  function comparisonsView() {
    const draft = S.compareDraft;
    const choices = [['', 'Choose a saved project'], ...S.summary.projects.map(project =>
      [project.id, project.title + ' · latest revision ' + project.revision])];
    const input = panel('Compare supplied editions',
      form(runComparison,
        el('div', {class: 'grid'},
          field('Before project', draft.before, value => { draft.before = value; draft.beforeRevision = ''; render(); }, {required: true, options: choices}),
          field('After project', draft.after, value => { draft.after = value; draft.afterRevision = ''; render(); }, {required: true, options: choices}),
          field('Before revision', draft.beforeRevision, value => draft.beforeRevision = value,
            {type: 'number', min: 1, max: latestRevision(draft.before), hint: 'Leave empty to use the current saved revision.'}),
          field('After revision', draft.afterRevision, value => draft.afterRevision = value,
            {type: 'number', min: 1, max: latestRevision(draft.after), hint: 'Leave empty to use the current saved revision.'})),
        actions(submit('Compare editions'))),
      note('An absent observation means it is absent from the supplied edition. It does not imply the provider deleted it.'));
    const result = S.comparison;
    const summary = result?.comparison;
    return el('div', {class: 'stack'}, el('h2', {}, 'Edition comparisons'), input,
      summary ? panel('Retained comparison',
        info([['Comparison', code(summary.id)], ['Before', projectName(summary.before.project_id) + ' · revision ' + summary.before.revision],
          ['Before snapshot', code(summary.before.snapshot)], ['After', projectName(summary.after.project_id) + ' · revision ' + summary.after.revision],
          ['After snapshot', code(summary.after.snapshot)], ['Same series selection', summary.selection_equivalent ? 'Yes' : 'No'],
          ['Metadata changed', summary.metadata_changed ? 'Yes' : 'No'], ['Created', stamp(summary.created_at)]]),
        el('div', {class: 'metrics'}, ['added','absent','changed','unchanged'].map(kind =>
          el('div', {class: 'metric'}, el('strong', {}, count(summary.counts[kind])), el('span', {}, kind)))),
        (summary.notes || []).map(note),
        table(['Change', 'Series key', 'Period', 'Changed fields', 'Before', 'After'], result.rows.map(row =>
          [tag(row.kind), code(row.series_key), code(row.time_period), code(row.changed_fields),
            details('Original before', row.before), details('Original after', row.after)])),
        pagination(result, offset => openComparison(summary.id, offset), 'changes')) : null,
      panel('Saved comparisons',
        table(['Before', 'After', 'Created', ''], S.summary.comparisons.map(comparison => [
          projectName(comparison.before.project_id) + ' · revision ' + comparison.before.revision,
          projectName(comparison.after.project_id) + ' · revision ' + comparison.after.revision,
          stamp(comparison.created_at), button('Open comparison', () => openComparison(comparison.id), {class: 'small'})]))));
  }
  function render() {
    if (!S.summary) {
      root.replaceChildren(el('div', {class: 'shell stack'},
        S.error ? el('div', {class: 'error', role: 'alert'}, S.error) : note('Loading retained workspace…')));
      return;
    }
    const shell = el('div', {class: 'shell stack', 'aria-busy': S.busy ? 'true' : 'false'});
    shell.append(el('div', {class: 'toolbar'},
      tabs('Main navigation', ['sources','projects','comparisons'], S.view, async view => {
        if (!leaveDraft()) return; S.view = view;
        if (view === 'projects' && S.draft?.data_source_id && !S.draftSeries) {
          await draftMetadata(); await seriesPage(0, true);
        }
      }), actions(button('Refresh workspace', refresh))));
    if (S.error) shell.append(el('div', {class: 'error', role: 'alert'}, S.error));
    if (S.notice) shell.append(el('div', {class: 'notice', role: 'status'}, S.notice));
    if (S.busy) shell.append(note('Working with the retained workspace…'));
    if (S.pending) shell.append(pendingPanel());
    shell.append(S.view === 'sources' ? sourcesView() : S.view === 'projects' ? projectsView() : comparisonsView());
    root.replaceChildren(shell);
  }
  window.addEventListener('beforeunload', event => {
    if (S.dirty || S.pending) { event.preventDefault(); event.returnValue = ''; }
  });
  async function start() {
    try {
      const supplied = location.hash.slice(1);
      if (supplied) {
        token = supplied;
        try { sessionStorage.setItem('sf30-sdmx-capability', token); } catch {}
        history.replaceState(null, '', location.pathname + location.search);
      } else {
        try { token = sessionStorage.getItem('sf30-sdmx-capability') || ''; } catch {}
      }
      if (!token) throw Error('Open the private console link printed by the running SDMX operator command.');
      await refresh(); render();
    } catch (error) { S.error = error.message; connection.textContent = 'Workspace unavailable'; render(); }
  }
  start();
})();

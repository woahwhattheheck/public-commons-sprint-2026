(() => {
  'use strict';
  const root = document.getElementById('operator');
  const tokenKey = 'starforge.macrobond.operator';
  let token = location.hash.slice(1);
  if (token) {
    try { sessionStorage.setItem(tokenKey, token); } catch (_) {}
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    try { token = sessionStorage.getItem(tokenKey) || ''; } catch (_) {}
  }
  const state = {data: null, view: 'sources', selected: null, draft: null, preview: null,
    pending: null, busy: false, generation: 0, memberCache: new Map(), memberJobs: new Map(), memberQueue: Promise.resolve(), seriesPage: 0,
    seriesQuery: '', detailTab: 'series', inspected: null};
  let main, notice, pendingBox, publication, navigation, shell;
  const count = value => Number(value || 0).toLocaleString();
  const short = value => String(value || '').slice(0, 14);
  const currentId = () => typeof state.data?.current === 'object' ? state.data?.current?.id || null : state.data?.current || null;
  const identifier = () => state.data?.workspace?.id || state.data?.source_state?.workspace?.id || 'local';
  const projects = () => state.data?.source_state?.projects || [];
  const editions = () => state.data?.editions || [];
  const currentEdition = () => editions().find(item => item.id === currentId());
  const pendingKey = () => 'starforge.macrobond.pending.' + identifier();
  function node(tag, attrs = {}, ...children) {
    const out = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') out.className = value;
      else if (key === 'text') out.textContent = String(value);
      else if (key.startsWith('on') && typeof value === 'function') out.addEventListener(key.slice(2), value);
      else if (key === 'value') out.value = value;
      else if (key === 'checked' || key === 'disabled' || key === 'hidden') out[key] = Boolean(value);
      else out.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child !== null && child !== undefined && child !== false)
        out.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return out;
  }
  const button = (label, fn, opts = {}) => node('button', {type: 'button', ...opts, onclick: () => action(fn)}, label);
  const field = (label, input, help, className = '') => node('label', {class: 'field ' + className},
    node('span', {}, label), input, help ? node('small', {}, help) : null);
  const details = (label, value) => node('details', {}, node('summary', {}, label),
    node('pre', {}, typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
  const metric = (value, label) => node('div', {class: 'metric'}, node('strong', {}, count(value)), node('span', {}, label));
  const option = (value, label) => node('option', {value}, label);
  const select = (items, value) => {
    const out = node('select', {}, items.map(item => option(item[0], item[1])));
    out.value = value;
    return out;
  };
  function table(headers, rows) {
    return node('div', {class: 'table-wrap'}, node('table', {},
      node('thead', {}, node('tr', {}, headers.map(label => node('th', {scope: 'col'}, label)))),
      node('tbody', {}, rows)));
  }
  function message(text, error = false) {
    if (!notice) return;
    notice.className = 'notice' + (error ? ' error' : '');
    notice.setAttribute('role', error ? 'alert' : 'status');
    notice.textContent = text || '';
  }
  async function action(fn) {
    if (state.busy) return;
    state.busy = true;
    document.body.classList.add('busy');
    shell?.setAttribute('aria-busy', 'true');
    try { return await fn(); }
    catch (error) { message(error.message || String(error), true); }
    finally {
      state.busy = false;
      document.body.classList.remove('busy');
      shell?.setAttribute('aria-busy', 'false');
    }
  }
  async function response(path, body, method) {
    const headers = {Authorization: 'Bearer ' + token};
    const options = {headers, cache: 'no-store'};
    if (body !== undefined) {
      options.method = method || 'POST';
      if (body instanceof Blob) {
        options.body = body;
        headers['Content-Type'] = 'application/zip';
      } else {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
    } else if (method) options.method = method;
    const res = await fetch(path, options);
    if (!res.ok) {
      const raw = await res.text();
      let value;
      try { value = JSON.parse(raw); } catch (_) {}
      const error = new Error(value?.error || ('Request failed (' + res.status + ')'));
      error.status = res.status; error.body = value;
      throw error;
    }
    return res;
  }
  async function json(path, body, method) {
    return (await response(path, body, method)).json();
  }
  async function download(path, fallback) {
    const res = await response(path);
    const blob = await res.blob();
    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    const name = match?.[1] || fallback;
    const url = URL.createObjectURL(blob);
    const link = node('a', {href: url, download: name});
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Downloaded ' + name + ' (' + count(blob.size) + ' bytes).');
  }
  function pageControls(offset, total, limit, go) {
    return node('div', {class: 'pagination'},
      node('small', {}, total ? count(offset + 1) + '–' + count(Math.min(offset + limit, total)) + ' of ' + count(total) : 'No matching records'),
      node('div', {class: 'actions'}, button('Previous page', () => go(Math.max(0, offset - limit)), {disabled: offset === 0}),
        button('Next page', () => go(offset + limit), {disabled: offset + limit >= total})));
  }
  function showPending() {
    pendingBox.replaceChildren();
    pendingBox.hidden = !state.pending;
    if (!state.pending) return;
    pendingBox.append(node('p', {}, 'An edition save has retained retry details. Continue with the same request to recover its saved result.'),
      node('code', {}, state.pending.request.operation_id),
      node('div', {class: 'actions'}, button('Retry exact edition save', () => saveRequest(state.pending.request), {class: 'primary'})));
  }
  function retainPending(request) {
    state.pending = {workspace: identifier(), request};
    try { localStorage.setItem(pendingKey(), JSON.stringify(state.pending)); }
    catch (_) { message('This browser could not retain retry details. Keep this view open while the save completes.'); }
    showPending();
  }
  function clearPending(operationId) {
    if (state.pending?.request?.operation_id !== operationId) return;
    state.pending = null;
    try { localStorage.removeItem(pendingKey()); } catch (_) {}
    showPending();
  }
  async function refresh() {
    state.data = await json('/api/state');
    const sameCatalog = value => value?.workspace === identifier() && typeof value?.request?.operation_id === 'string';
    state.pending = sameCatalog(state.pending) ? state.pending : null;
    try {
      const old = JSON.parse(localStorage.getItem(pendingKey()) || 'null');
      if (sameCatalog(old)) state.pending = old;
    } catch (_) {}
    const current = currentEdition();
    publication.replaceChildren(node('strong', {}, current ? current.title : 'No published edition'),
      node('span', {}, current ? count(current.series_count) + ' series · publication revision ' + count(state.data.revision) : 'Save and review an edition to start the provider.'));
    showPending();
  }
  function heading(title, description, actions) {
    return node('div', {class: 'page-heading'}, node('div', {}, node('h1', {}, title), node('p', {class: 'muted'}, description)),
      actions ? node('div', {class: 'actions compact'}, actions) : null);
  }
  async function show(view) {
    state.view = view;
    state.generation += 1;
    const generation = state.generation;
    for (const item of navigation.querySelectorAll('button[data-view]'))
      item.setAttribute('aria-current', item.dataset.view === view ? 'page' : 'false');
    main.replaceChildren();
    if (view === 'sources') renderSources();
    else if (view === 'draft') renderDraft();
    else if (view === 'editions') await renderEditions(generation);
    else if (view === 'connection') renderConnection();
  }
  function startDraft(project) {
    if (!state.draft) state.draft = {operation_id: crypto.randomUUID(), title: '', notes: '', members: [], dirty: false};
    if (project && !state.draft.members.some(item => item.project_id === project.id && item.revision === project.revision)) {
      state.draft.members.push({project_id: project.id, revision: project.revision, series_keys: [], mode: 'all', offset: 0, query: ''});
      touchDraft();
    }
  }
  function touchDraft() {
    if (state.draft) {
      state.draft.dirty = true;
      if (state.pending?.request?.operation_id === state.draft.operation_id) state.draft.operation_id = crypto.randomUUID();
    }
    state.preview = null;
    const target = main?.querySelector('[data-preview]');
    if (target) target.replaceChildren(node('p', {class: 'muted'}, 'Preview the current selection to review its source identities and provider compatibility.'));
  }
  function renderSources() {
    main.append(heading('Received source projects',
      'Import an original SDMX project packet. Its source documents, saved revisions, metadata and exact observation values remain attached to the catalog.'));
    const upload = node('input', {type: 'file', accept: '.zip,application/zip', required: true});
    const form = node('form', {class: 'panel', onsubmit: event => {
      event.preventDefault(); action(async () => {
        const file = upload.files?.[0];
        if (!file) throw new Error('Choose the original SDMX project packet.');
        const saved = await json('/api/projects/import', file);
        await refresh(); await show('sources');
        message('Retained project ' + (saved.project?.title || saved.project?.id || '') + ' is available for an edition.');
      });
    }}, node('h2', {}, 'Receive SDMX project'), field('Original project packet', upload),
    node('button', {type: 'submit', class: 'primary'}, 'Import source project'));
    main.append(form);
    const rows = projects().map(project => node('tr', {},
      node('td', {class: 'wide'}, node('strong', {}, project.title),
        node('small', {class: 'mono'}, project.id), details('Retained project details', project)),
      node('td', {}, 'Revision ' + project.revision),
      node('td', {class: 'mono'}, project.flow_id || 'Retained source selection'),
      node('td', {}, button('Use in edition', async () => { startDraft(project); await show('draft'); }))));
    main.append(node('h2', {}, 'Available projects'),
      rows.length ? table(['Project', 'Saved revision', 'Dataflow', ''], rows) : node('div', {class: 'empty'}, 'Import a source project to begin.'));
    const sources = state.data.source_state?.sources || [];
    if (sources.length) main.append(node('section', {class: 'panel'}, node('h2', {}, 'Original source documents'),
      table(['Source', 'Kind', 'Bytes', 'Source identity'], sources.map(source => node('tr', {},
        node('td', {class: 'wide'}, source.label || source.name,
          source.origin ? node('small', {}, node('a', {href: source.origin, target: '_blank', rel: 'noopener noreferrer'}, source.origin)) : null),
        node('td', {}, source.kind), node('td', {class: 'number'}, count(source.bytes)),
        node('td', {class: 'mono key'}, source.sha256 || source.id))))));
  }

  function editionRequest() {
    const draft = state.draft;
    if (!draft) throw new Error('Start an edition first.');
    const title = draft.title.trim();
    if (!title) throw new Error('Give the edition a title.');
    if (!draft.members.length) throw new Error('Add at least one retained source project.');
    return {operation_id: draft.operation_id, title, notes: draft.notes,
      members: draft.members.map(member => {
        const revision = Number(member.revision);
        const project = projects().find(item => item.id === member.project_id);
        if (!Number.isSafeInteger(revision) || revision < 1 || !project || revision > project.revision)
          throw new Error('Choose an existing positive revision for each source project.');
        if (member.mode === 'selected' && !member.series_keys.length)
          throw new Error('Choose at least one series, or select all series in that project.');
        return {project_id: member.project_id, revision, series_keys: member.mode === 'all' ? [] : [...member.series_keys]};
      })};
  }
  function issueList(issues) {
    return node('ul', {class: 'issues'}, issues.map(issue => node('li', {},
      issue.series_key ? node('code', {}, issue.series_key + ' · ') : null,
      issue.severity ? node('span', {class: 'badge'}, issue.severity) : null,
      issue.field ? node('strong', {}, ' ' + issue.field + ': ') : null,
      issue.message || JSON.stringify(issue))));
  }
  async function memberSeries(member) {
    const projectId = member.project_id, revision = Number(member.revision);
    const key = projectId + ':' + revision;
    if (state.memberCache.has(key)) return state.memberCache.get(key);
    if (state.memberJobs.has(key)) return state.memberJobs.get(key);
    const project = projects().find(item => item.id === projectId);
    if (!project) throw new Error('The selected source project is unavailable.');
    const job = state.memberQueue.then(async () => {
      const value = await json('/api/preview', {operation_id: crypto.randomUUID(),
        title: 'Inspect retained project series', notes: '',
        members: [{project_id: projectId, revision, series_keys: []}]});
      const result = {series: value.series || [], issues: value.issues || []};
      state.memberCache.set(key, result);
      return result;
    });
    state.memberJobs.set(key, job);
    state.memberQueue = job.catch(() => {});
    try { return await job; } finally { state.memberJobs.delete(key); }
  }
  function renderDraft() {
    startDraft();
    const draft = state.draft;
    main.append(heading('Prepare provider edition',
      'Choose saved source revisions and actual series. Preview the stable identifiers, dates, units and provider compatibility before retaining the edition.'));
    const title = node('input', {type: 'text', maxlength: 240, required: true, value: draft.title,
      oninput: event => { draft.title = event.target.value; touchDraft(); }});
    const notes = node('textarea', {rows: 3, maxlength: 32000, value: draft.notes,
      oninput: event => { draft.notes = event.target.value; touchDraft(); }});
    main.append(node('section', {class: 'panel'}, node('h2', {}, 'Edition details'),
      field('Edition title', title), field('Review notes', notes,
        'Retain the reason for this selection or publication change with the original sources.')));
    const members = node('section', {class: 'panel'}, node('h2', {}, 'Source project members'));
    const add = select([['', 'Choose a retained project'], ...projects().map(project =>
      [project.id, project.title + ' · revision ' + project.revision])], '');
    const memberArea = node('div');
    members.append(node('div', {class: 'inline align-end'}, field('Add source project', add),
      button('Add project', async () => {
        const project = projects().find(item => item.id === add.value);
        if (!project) throw new Error('Choose a source project.');
        startDraft(project); await show('draft');
      }, {disabled: !projects().length})), memberArea);
    const renderMembers = () => {
      memberArea.replaceChildren();
      if (!draft.members.length) {
        memberArea.append(node('div', {class: 'empty'}, 'Add a received project to choose its series.'));
        return;
      }
      for (const [index, member] of draft.members.entries()) {
        const project = projects().find(item => item.id === member.project_id);
        const revision = node('input', {type: 'number', min: 1, max: project?.revision || member.revision,
          step: 1, value: member.revision, onchange: event => {
            member.revision = Number(event.target.value); member.offset = 0; member.inspection = false; touchDraft(); renderMembers();
          }});
        const coverage = select([['all', 'All retained series'], ['selected', 'Choose specific series']], member.mode);
        const inspector = node('div', {class: 'member-inspector'});
        const memberNode = node('article', {class: 'member'}, node('div', {class: 'panel-head'},
          node('div', {}, node('h3', {}, project?.title || member.project_id), node('small', {class: 'mono'}, member.project_id)),
          button('Remove project', async () => { draft.members.splice(index, 1); touchDraft(); renderMembers(); })),
          node('div', {class: 'inline align-end'}, field('Source revision', revision, 'Latest retained: ' + (project?.revision || member.revision), 'narrow'),
            field('Series selection', coverage), button('Inspect series', async () => {
              await memberSeries(member); member.inspection = true; await renderInspector();
            })), inspector);
        coverage.addEventListener('change', () => action(async () => {
          member.mode = coverage.value;
          if (member.mode === 'selected') {
            const data = await memberSeries(member);
            if (!member.series_keys.length) member.series_keys = data.series.map(series => series.series_key);
            member.inspection = true;
          }
          touchDraft(); await renderInspector();
        }));
        async function renderInspector() {
          inspector.replaceChildren();
          if (!member.inspection && member.mode !== 'selected') return;
          const data = await memberSeries(member);
          if (!memberNode.isConnected) return;
          const search = node('input', {type: 'search', value: member.query, placeholder: 'Series identifier, original key or description'});
          const filtered = data.series.filter(series =>
            [series.id, series.series_key, series.metaData?.Description].join(' ').toLowerCase().includes(member.query.toLowerCase()));
          const page = filtered.slice(member.offset, member.offset + 50);
          const selectedCount = node('small', {}, member.mode === 'all' ? 'All ' + count(data.series.length) + ' series selected' :
            count(member.series_keys.length) + ' selected of ' + count(data.series.length));
          const updateSelection = (key, checked) => {
            const chosen = new Set(member.series_keys);
            if (checked) chosen.add(key); else chosen.delete(key);
            member.series_keys = data.series.filter(series => chosen.has(series.series_key)).map(series => series.series_key);
            touchDraft(); selectedCount.textContent = count(member.series_keys.length) + ' selected of ' + count(data.series.length);
          };
          const tools = node('form', {class: 'inline align-end', onsubmit: event => {
            event.preventDefault(); action(async () => { member.query = search.value; member.offset = 0; await renderInspector(); });
          }}, field('Find source series', search), node('button', {type: 'submit'}, 'Find series'));
          inspector.append(tools, node('div', {class: 'member-tools'}, selectedCount,
            node('div', {class: 'actions'}, button('Select this page', async () => {
              member.mode = 'selected'; coverage.value = 'selected';
              const chosen = new Set(member.series_keys); for (const series of page) chosen.add(series.series_key);
              member.series_keys = data.series.filter(series => chosen.has(series.series_key)).map(series => series.series_key);
              touchDraft(); await renderInspector();
            }), button('Clear this page', async () => {
              if (member.mode === 'all') member.series_keys = data.series.map(series => series.series_key);
              member.mode = 'selected'; coverage.value = 'selected';
              const omitted = new Set(page.map(series => series.series_key));
              member.series_keys = member.series_keys.filter(key => !omitted.has(key)); touchDraft(); await renderInspector();
            }))));
          const rows = page.map(series => {
            const choice = node('input', {type: 'checkbox', 'aria-label': 'Include ' + series.series_key,
              checked: member.mode === 'all' || member.series_keys.includes(series.series_key),
              disabled: member.mode === 'all', onchange: event => updateSelection(series.series_key, event.target.checked)});
            return node('tr', {}, node('td', {}, choice),
              node('td', {class: 'wide'}, series.metaData?.Description || series.series_key, node('small', {class: 'mono'}, series.id)),
              node('td', {class: 'mono key'}, series.series_key),
              node('td', {}, series.frequency || series.metaData?.Frequency || ''),
              node('td', {class: 'number'}, count(series.observation_count)));
          });
          inspector.append(rows.length ? table(['Include', 'Series', 'Original key', 'Provider frequency', 'Observations'], rows) :
            node('div', {class: 'empty'}, 'No series match this filter.'),
            pageControls(member.offset, filtered.length, 50, async offset => { member.offset = offset; await renderInspector(); }));
          const unknown = member.series_keys.filter(key => !data.series.some(series => series.series_key === key));
          if (unknown.length) inspector.append(node('p', {}, 'This revision does not contain selected keys: ' + unknown.join(', ')));
          if (data.issues.length) inspector.append(details('Compatibility issues in this source selection', data.issues));
        }
        memberArea.append(memberNode);
        if (member.inspection || member.mode === 'selected') renderInspector().catch(error => message(error.message, true));
      }
    };
    renderMembers(); main.append(members);
    const previewArea = node('section', {class: 'panel', 'data-preview': ''});
    const previewButton = button('Preview edition', async () => {
      const request = editionRequest();
      const fingerprint = JSON.stringify(request);
      const result = await json('/api/preview', request);
      if (!previewArea.isConnected || JSON.stringify(editionRequest()) !== fingerprint) {
        message('The selection changed while the preview was running. Preview the current selection again.');
        return;
      }
      state.preview = {result, fingerprint};
      renderPreview(previewArea);
    }, {class: 'primary'});
    main.append(node('div', {class: 'actions'}, previewButton,
      button('Discard draft', async () => {
        if (draft.dirty && !confirm('Discard the unsaved edition draft?')) return;
        state.draft = null; state.preview = null; await show('editions');
      })), previewArea);
    renderPreview(previewArea);
  }
  function renderPreview(target) {
    target.replaceChildren();
    if (!state.preview) {
      target.append(node('h2', {}, 'Compatibility review'), node('p', {class: 'muted'},
        'Preview the current selection to review its source identities and provider compatibility.'));
      return;
    }
    const result = state.preview.result;
    const issues = result.issues || [];
    const errors = issues.filter(issue => issue.severity !== 'warning');
    target.append(node('h2', {}, 'Reviewed edition'),
      node('div', {class: 'metrics'}, metric(result.series?.length, 'Series'), metric(result.row_count, 'Original observations'),
        metric(issues.length, 'Compatibility issues')));
    if (issues.length) target.append(node('p', {}, errors.length ? 'Choose compatible series before saving this edition.' :
      'Review these source and provider projection notes with the selected series.'), issueList(issues));
    const display = result.series || [];
    let offset = 0;
    const list = node('div');
    const render = () => {
      const rows = display.slice(offset, offset + 50).map(series => node('tr', {},
        node('td', {class: 'wide'}, series.metaData?.Description || series.series_key, node('small', {class: 'mono'}, series.id)),
        node('td', {class: 'mono key'}, series.series_key),
        node('td', {}, series.frequency || series.metaData?.Frequency || ''),
        node('td', {}, series.unit || series.metaData?.DisplayUnit || '', node('small', {}, 'Multiplier: ' + String(series.unit_multiplier ?? ''))),
        node('td', {}, series.start_date || '', node('small', {}, series.end_date || '')),
        node('td', {class: 'number'}, count(series.observation_count)),
        node('td', {}, details('Source and provider metadata', series))));
      list.replaceChildren(rows.length ? table(['Series and stable ID', 'Original key', 'Frequency', 'Source unit', 'Provider dates', 'Observations', 'Review'], rows) :
        node('div', {class: 'empty'}, 'This selection contains no compatible series.'),
        pageControls(offset, display.length, 50, async next => { offset = next; render(); }));
    };
    render(); target.append(list, details('Pinned project revisions', result.projects || []),
      node('p', {class: 'footer-note'}, 'Source values and statuses remain in the retained observations. Provider dates and metadata shown here come from the reviewed native projection.'),
      node('div', {class: 'actions'}, button('Save reviewed edition', async () => {
        if (!state.preview || JSON.stringify(editionRequest()) !== state.preview.fingerprint)
          throw new Error('Preview the current selection before saving.');
        await saveRequest(result.request);
      }, {class: 'primary', disabled: errors.length > 0 || !display.length})));
  }
  async function saveRequest(request) {
    if (!request || typeof request.operation_id !== 'string') throw new Error('The native preview did not return its exact save request.');
    if (state.pending && state.pending.request.operation_id !== request.operation_id) {
      const previous = state.pending.request;
      await json('/api/editions', previous);
      clearPending(previous.operation_id);
    }
    retainPending(request);
    const saved = await json('/api/editions', request);
    clearPending(request.operation_id);
    state.selected = saved.edition.id;
    const newerDraft = state.draft && state.draft.operation_id !== request.operation_id;
    if (!newerDraft) { state.draft = null; state.preview = null; }
    state.detailTab = 'series'; state.inspected = null;
    await refresh(); await show('editions');
    message('Saved edition ' + saved.edition.title + '. Its original sources and series identities are retained.' +
      (newerDraft ? ' Your newer draft remains available in Prepare edition.' : ''));
  }

  async function renderEditions(generation) {
    main.append(heading('Retained provider editions',
      'Each edition binds exact source revisions to stable series identities. The selected publication is the edition used by the configured Macrobond client.',
      button('Prepare new edition', async () => { startDraft(); await show('draft'); }, {class: 'primary'})));
    if (!editions().length) {
      main.append(node('div', {class: 'empty'}, 'Receive a source project and save its first reviewed edition.'));
      return;
    }
    if (!editions().some(item => item.id === state.selected)) state.selected = currentId() || editions()[0].id;
    const sidebar = node('aside', {class: 'sidebar', 'aria-label': 'Saved editions'}, node('h2', {}, 'Saved editions'));
    for (const edition of editions()) sidebar.append(button(edition.title, async () => {
      state.selected = edition.id; state.seriesPage = 0; state.seriesQuery = ''; state.inspected = null;
      await show('editions');
    }, {'aria-pressed': edition.id === state.selected, 'data-edition-id': edition.id}));
    const buttons = sidebar.querySelectorAll('button');
    editions().forEach((edition, index) => buttons[index].append(node('small', {},
      count(edition.series_count) + ' series · ' + count(edition.row_count) + ' observations'),
      edition.id === currentId() ? node('span', {class: 'badge current'}, 'Published') : null));
    const content = node('section', {}, node('p', {class: 'muted'}, 'Opening retained edition…'));
    main.append(node('div', {class: 'layout'}, sidebar, content));
    const selected = state.selected;
    const view = await json('/api/editions/' + encodeURIComponent(selected));
    if (generation !== state.generation || state.selected !== selected) return;
    const edition = view.edition;
    content.replaceChildren(node('div', {class: 'panel-head'},
      node('div', {}, node('h2', {}, edition.title), node('small', {class: 'mono'}, edition.id)),
      node('div', {class: 'actions compact'},
        button('Export catalog packet', () => download('/api/editions/' + encodeURIComponent(edition.id) + '/packet', 'macrobond-catalog.zip')),
        button(edition.id === currentId() ? 'Currently published' : 'Review publication', async () => {
          state.detailTab = 'publication'; await renderTab();
        }, {class: 'primary', disabled: edition.id === currentId()}))),
      node('div', {class: 'metrics'}, metric(edition.series_count, 'Series'), metric(edition.row_count, 'Original observations'),
        metric(edition.members?.length, 'Pinned source projects')),
      edition.notes ? node('p', {}, edition.notes) : null);
    const tabs = node('div', {class: 'tabs', role: 'tablist', 'aria-label': 'Edition sections'});
    const panel = node('div', {role: 'tabpanel'});
    let tabGeneration = 0;
    for (const [id, label] of [['series', 'Series and observations'], ['publication', 'Publication'], ['sources', 'Source references']])
      tabs.append(button(label, async () => { state.detailTab = id; await renderTab(); },
        {role: 'tab', 'data-tab': id}));
    content.append(tabs, panel);
    async function renderTab() {
      const revision = ++tabGeneration;
      for (const item of tabs.children) item.setAttribute('aria-selected', item.dataset.tab === state.detailTab ? 'true' : 'false');
      panel.replaceChildren();
      const live = () => panel.isConnected && revision === tabGeneration && state.selected === edition.id;
      if (state.detailTab === 'series') {
        if (state.inspected) await renderObservations(panel, edition, state.inspected, live, renderTab);
        else await renderSeries(panel, edition, live, renderTab);
      } else if (state.detailTab === 'publication') await renderPublication(panel, edition, live);
      else {
        panel.append(node('h3', {}, 'Pinned original projects'),
          table(['Project', 'Revision', 'Native snapshot'], (edition.sources || []).map(source => node('tr', {},
            node('td', {class: 'mono key'}, source.project_id), node('td', {}, source.revision),
            node('td', {class: 'mono key'}, source.snapshot)))),
          details('Exact edition definition', edition),
          node('p', {class: 'footer-note'}, 'The catalog packet includes the retained edition and its original receiving projects. The provider credentials remain in the serving host and Macrobond client.'));
      }
    }
    await renderTab();
  }
  async function renderSeries(panel, edition, live, renderTab) {
    const search = node('input', {type: 'search', value: state.seriesQuery, placeholder: 'Stable ID, original key or description'});
    panel.append(node('form', {class: 'inline align-end', onsubmit: event => {
      event.preventDefault(); action(async () => { state.seriesQuery = search.value; state.seriesPage = 0; await renderTab(); });
    }}, field('Find a retained series', search), node('button', {type: 'submit'}, 'Find series')));
    const data = await json('/api/editions/' + encodeURIComponent(edition.id) + '/series?' +
      new URLSearchParams({offset: state.seriesPage, limit: 50, query: state.seriesQuery}));
    if (!live()) return;
    const rows = data.rows.map(series => node('tr', {},
      node('td', {class: 'wide'}, series.metaData?.Description || series.series_key, node('small', {class: 'mono'}, series.id)),
      node('td', {class: 'mono key'}, series.series_key),
      node('td', {}, series.frequency || series.metaData?.Frequency || ''),
      node('td', {}, series.unit || series.metaData?.DisplayUnit || ''),
      node('td', {class: 'number'}, count(series.observation_count)),
      node('td', {}, button('Observations', async () => { state.inspected = {...series, offset: 0}; await renderTab(); }))));
    panel.append(rows.length ? table(['Series and stable ID', 'Original key', 'Frequency', 'Unit', 'Observations', ''], rows) :
      node('div', {class: 'empty'}, 'No retained series match the current filter.'),
      pageControls(data.offset, data.total, data.limit, async offset => { state.seriesPage = offset; await renderTab(); }));
  }
  function metadataList(value) {
    return node('dl', {class: 'kv'}, Object.entries(value || {}).flatMap(([key, entry]) => [
      node('dt', {}, key), node('dd', {}, entry !== null && typeof entry === 'object' ? JSON.stringify(entry) : String(entry ?? 'null'))]));
  }
  async function renderObservations(panel, edition, series, live, renderTab) {
    panel.append(button('Back to series', async () => { state.inspected = null; await renderTab(); }),
      node('div', {class: 'panel-head'}, node('div', {}, node('h3', {}, series.metaData?.Description || series.series_key),
        node('code', {}, series.id))),
      node('section', {class: 'panel'}, node('h3', {}, 'Provider metadata'), metadataList(series.metaData)),
      node('p', {class: 'muted'}, 'Review each original reporting period and value beside the date supplied to the provider. Original source states and attributes remain available for every observation.'));
    const data = await json('/api/editions/' + encodeURIComponent(edition.id) + '/observations?' +
      new URLSearchParams({series_id: series.id, offset: series.offset || 0, limit: 50}));
    if (!live()) return;
    const rows = data.rows.map(row => node('tr', {},
      node('td', {class: 'mono'}, row.time_period),
      node('td', {class: 'mono'}, row.date || ''),
      node('td', {class: 'mono key'}, row.value === '' ? '"" (empty)' : row.value === null ? 'null' : String(row.value)),
      node('td', {}, row.value_kind || (row.value_present ? 'present' : 'absent')),
      node('td', {}, details('Source status and attributes', {
        value_present: row.value_present, attributes: row.attributes, dimensions: row.dimensions, action: row.action}))));
    panel.append(rows.length ? table(['Original period', 'Provider date', 'Exact original value', 'Source value state', 'Source detail'], rows) :
      node('div', {class: 'empty'}, 'No observations are present in this retained series.'),
      pageControls(data.offset, data.total, data.limit, async offset => { series.offset = offset; await renderTab(); }),
      details('Stable series and source mapping', series));
  }
  function comparisonView(result) {
    const seriesCounts = result.series_counts;
    const observationCounts = result.observation_counts;
    const panel = node('section', {class: 'panel'}, node('h3', {}, 'Retained edition comparison'));
    if (seriesCounts && observationCounts) {
      panel.append(table(['Change in proposed edition', 'Series', 'Original observations'],
        [['added', 'Added'], ['removed', 'Absent in proposed edition'], ['changed', 'Changed'], ['unchanged', 'Unchanged']]
          .map(([key, label]) => node('tr', {}, node('td', {}, label),
            node('td', {class: 'number'}, seriesCounts[key] === undefined ? '—' : count(seriesCounts[key])),
            node('td', {class: 'number'}, observationCounts[key] === undefined ? '—' : count(observationCounts[key]))))));
    }
    const rows = result.rows || [];
    let offset = 0;
    const list = node('div');
    const render = () => {
      const visible = rows.slice(offset, offset + 50);
      list.replaceChildren(visible.length ? table(['Series', 'Change', 'Source and metadata review'], visible.map(row => node('tr', {},
        node('td', {class: 'mono key'}, row.id || row.series_id || row.series_key),
        node('td', {}, row.kind === 'removed' ? 'Absent in proposed edition' : row.kind || ''),
        node('td', {}, details('Retained changes', row))))) : node('p', {class: 'muted'}, 'No changed series rows were returned.'),
        pageControls(offset, rows.length, 50, async next => { offset = next; render(); }));
    };
    render(); panel.append(list, details('Full native comparison', result),
      node('p', {class: 'footer-note'}, 'This comparison describes the supplied customer editions. A series absent from the proposed edition remains in the older retained edition.'));
    return panel;
  }
  async function renderPublication(panel, edition, live) {
    const before = currentId();
    const expectedRevision = state.data.revision;
    const old = currentEdition();
    panel.append(node('h3', {}, before === edition.id ? 'Current provider publication' : 'Review publication change'),
      node('p', {class: 'muted'}, 'The Macrobond client reads the currently selected edition. Changing this selection preserves every saved edition and its original sources.'),
      node('div', {class: 'comparison'},
        node('div', {}, node('small', {}, 'Current publication'), node('strong', {}, old?.title || 'No published edition'),
          old ? node('small', {}, count(old.series_count) + ' series · ' + count(old.row_count) + ' observations') : null),
        node('div', {}, node('small', {}, 'Selected edition'), node('strong', {}, edition.title),
          node('small', {}, count(edition.series_count) + ' series · ' + count(edition.row_count) + ' observations'))));
    if (before === edition.id) {
      panel.append(node('span', {class: 'badge current'}, 'Currently published'),
        node('p', {class: 'footer-note'}, 'Publication revision ' + expectedRevision + '. Earlier editions can be reviewed and selected from the saved editions list.'));
      const history = state.data.publications || state.data.history;
      if (history) panel.append(details('Retained publication history', history));
      return;
    }
    if (before) {
      const loading = node('p', {class: 'muted'}, 'Comparing the exact retained source observations…');
      panel.append(loading);
      const comparison = await json('/api/editions/compare', {before, after: edition.id});
      if (!live()) return;
      loading.replaceWith(comparisonView(comparison));
    } else panel.append(details('First publication source review', {members: edition.members, sources: edition.sources}));
    const reason = node('p', {class: 'muted'}, before ?
      'Use this reviewed edition as the provider’s current selection. You can restore another retained edition through the same review.' :
      'Publish this reviewed edition to make its selected series available through the configured provider.');
    panel.append(node('section', {class: 'panel review'}, node('h3', {}, 'Apply reviewed selection'), reason,
      button('Use this edition', async () => {
        try {
          state.data = await json('/api/editions/' + encodeURIComponent(edition.id) + '/activate',
            {expected_revision: expectedRevision, expected_current: before});
        } catch (error) {
          await refresh();
          if (currentId() !== edition.id || state.data.revision !== expectedRevision + 1) throw error;
        }
        await refresh(); await show('editions');
        message('The provider now uses ' + edition.title + '. Publication revision ' + state.data.revision + '.');
      }, {class: 'primary'})));
  }

  function renderConnection() {
    const connection = state.data.connection;
    main.append(heading('Macrobond client connection',
      'Use the published provider with the existing Macrobond client. The connection file contains the host address; the client stores its own account credentials.'));
    const host = node('input', {type: 'url', required: true, value: connection.provider_url});
    const configForm = node('form', {class: 'panel', onsubmit: event => {
      event.preventDefault(); action(async () => {
        await download('/api/connection.xml?' + new URLSearchParams({host: host.value.trim()}), 'macrobond-provider.xml');
      });
    }}, node('h2', {}, 'Client configuration'),
      field('Host used by Macrobond', host, 'Use this local provider URL on the same machine, or the exact HTTPS provider address configured for the receiving host.'),
      metadataList({Authentication: connection.authentication,
        'Provider account': connection.username || 'Configure a provider account when starting the service',
        'Provider access': connection.enabled ? 'Configured' : 'Credentials have not been configured',
        'Published edition': currentEdition()?.title || 'No published edition'}),
      node('button', {type: 'submit', class: 'primary'}, 'Download Macrobond configuration'),
      node('p', {class: 'footer-note'}, 'In Macrobond, open Configure → Settings → My Series and add a Web API database. Choose its name and prefix, select this configuration file, and enter the provider account credentials. Restart the client after changing the configuration.'),
      node('a', {href: 'https://help.macrobond.com/apis-feeds-connectors/web-api-series-provider/', target: '_blank', rel: 'noopener noreferrer'}, 'Original Macrobond provider instructions'));
    main.append(configForm);
    const browserPanel = node('section', {class: 'panel'}, node('h2', {}, 'Browse the published provider'),
      node('p', {class: 'muted'}, 'Inspect the same browse and search responses that the configured client receives.'));
    const search = node('input', {type: 'search', placeholder: 'Description or stable identifier'});
    const treeArea = node('div');
    const found = node('div');
    const searchForm = node('form', {class: 'inline align-end', onsubmit: event => {
      event.preventDefault(); action(async () => {
        const values = await json('/api/provider/searchseries?' + new URLSearchParams({query: search.value}));
        renderMetadataRows(found, values, 'Search results');
      });
    }}, field('Find a published series', search), node('button', {type: 'submit'}, 'Search provider'),
      button('Browse provider tree', async () => {
        const values = await json('/api/provider/loadtree');
        treeArea.replaceChildren(node('h3', {}, 'Provider tree'));
        renderTree(treeArea, values);
      }));
    browserPanel.append(searchForm, treeArea, found); main.append(browserPanel);
    const command = select([
      ['getcapabilities', 'Capabilities'], ['loadseries', 'Series values'], ['loadmeta', 'Series metadata'],
      ['searchseries', 'Search series'], ['loadtree', 'Browse tree'], ['listseries', 'Browse series list']
    ], 'getcapabilities');
    const names = node('textarea', {rows: 3, placeholder: 'One stable series identifier per line'});
    const parameter = node('input', {type: 'text'});
    const namesField = field('Series identifiers in request order', names, 'Each identifier is sent as its own n parameter. Per-series failures remain in their original positions.');
    const parameterField = field('Query or browse reference', parameter);
    const raw = node('pre', {class: 'response', tabindex: 0}, 'Choose a provider method to inspect its exact JSON response.');
    const requestLabel = node('code');
    const responsePanel = node('section', {class: 'panel'}, node('h2', {}, 'Exact provider response'),
      node('p', {class: 'muted'}, 'This view preserves the serialized JSON text, including every emitted numeric digit. Original observation strings and statuses are available in the saved edition.'));
    const updateInputs = () => {
      namesField.hidden = !['loadseries', 'loadmeta'].includes(command.value);
      parameterField.hidden = !['searchseries', 'loadtree', 'listseries'].includes(command.value);
      parameterField.firstElementChild.textContent = command.value === 'searchseries' ? 'Search query' : 'Browse reference';
    };
    command.addEventListener('change', updateInputs); updateInputs();
    async function inspect(method, identifiers) {
      if (method) command.value = method;
      if (identifiers) names.value = identifiers.join('\n');
      updateInputs();
      const query = new URLSearchParams();
      if (['loadseries', 'loadmeta'].includes(command.value)) {
        const chosen = names.value.split(/\s+/).filter(Boolean);
        if (!chosen.length) throw new Error('Enter at least one stable series identifier.');
        chosen.forEach(name => query.append('n', name));
      } else if (command.value === 'searchseries') query.set('query', parameter.value);
      else if (parameter.value && ['loadtree', 'listseries'].includes(command.value)) query.set('reference', parameter.value);
      const suffix = query.toString() ? '?' + query : '';
      const value = await response('/api/provider/' + command.value + suffix);
      raw.textContent = await value.text();
      requestLabel.textContent = 'GET ' + connection.provider_url + command.value + suffix;
    }
    responsePanel.append(node('form', {onsubmit: event => { event.preventDefault(); action(() => inspect()); }},
      field('Provider method', command), namesField, parameterField,
      node('button', {type: 'submit'}, 'Read provider response')), requestLabel, raw);
    main.append(responsePanel);
    function renderMetadataRows(target, values, title) {
      const rows = Array.isArray(values) ? values : [];
      let offset = 0;
      const render = () => {
        target.replaceChildren(node('h3', {}, title),
          rows.length ? table(['Description', 'Stable ID', 'Frequency', 'Review'], rows.slice(offset, offset + 50).map(meta => node('tr', {},
            node('td', {class: 'wide'}, meta.Description || meta.PrimName),
            node('td', {class: 'mono key'}, meta.PrimName),
            node('td', {}, meta.Frequency || ''),
            node('td', {}, node('div', {class: 'actions'},
              button('Read values', async () => { await inspect('loadseries', [meta.PrimName]); responsePanel.scrollIntoView({block: 'start'}); }),
              button('Read metadata', async () => { await inspect('loadmeta', [meta.PrimName]); responsePanel.scrollIntoView({block: 'start'}); }),
              button('Original observations', async () => {
                const current = currentId();
                if (!current) throw new Error('Choose a published edition first.');
                const data = await json('/api/editions/' + encodeURIComponent(current) + '/series?' +
                  new URLSearchParams({query: meta.PrimName, offset: 0, limit: 200}));
                const selected = data.rows.find(series => series.id === meta.PrimName);
                if (!selected) throw new Error('This identifier is absent from the current retained edition.');
                state.selected = current; state.inspected = {...selected, offset: 0}; state.detailTab = 'series';
                await show('editions');
              })))))) : node('div', {class: 'empty'}, 'No series were returned.'),
          pageControls(offset, rows.length, 50, async next => { offset = next; render(); }));
      };
      render();
    }
    function renderTree(target, nodes) {
      if (!Array.isArray(nodes)) {
        target.append(details('Native browse response', nodes));
        return;
      }
      const list = node('ul', {class: 'list-reset'});
      for (const item of nodes) {
        const children = node('div');
        const line = node('li', {}, node('strong', {}, item.Description || 'Browse node'));
        if (Array.isArray(item.Children)) renderTree(children, item.Children);
        if (item.ChildrenReference !== undefined) line.append(node('div', {class: 'actions'},
          button('Open ' + item.Description, async () => {
            const data = await json('/api/provider/loadtree?' + new URLSearchParams({reference: item.ChildrenReference}));
            children.replaceChildren(); renderTree(children, data);
          })));
        if (item.SeriesReference !== undefined) line.append(node('div', {class: 'actions'},
          button('List ' + item.Description + ' series', async () => {
            const data = await json('/api/provider/listseries?' + new URLSearchParams({reference: item.SeriesReference}));
            const metadata = [];
            for (const group of data.groups || []) for (const row of group.series || [])
              for (const meta of row.entityMeta || []) metadata.push(meta);
            renderMetadataRows(found, metadata, item.Description);
            found.append(details('Original browse groups and aspects', data));
          })));
        line.append(children); list.append(line);
      }
      target.append(list);
    }
    const restore = node('input', {type: 'file', accept: '.zip,application/zip', required: true});
    main.append(node('section', {class: 'panel'}, node('h2', {}, 'Receive a complete catalog'),
      node('p', {class: 'muted'}, 'Import a previously exported catalog packet to retain its editions, original projects and publication references in this receiving workspace.'),
      node('form', {onsubmit: event => {
        event.preventDefault(); action(async () => {
          const file = restore.files?.[0];
          if (!file) throw new Error('Choose a complete catalog packet.');
          await json('/api/catalog/import', file);
          await refresh(); state.selected = currentId(); state.inspected = null;
          await show('editions'); message('The catalog packet has been received with its retained editions and original sources.');
        });
      }}, field('Complete catalog packet', restore), node('button', {type: 'submit'}, 'Import catalog packet'))));
  }
  async function initialize() {
    if (!token) {
      root.replaceChildren(node('main', {class: 'opening'}, node('h1', {}, 'Open the private operator link'),
        node('p', {}, 'Use the private console URL printed by the running Macrobond provider service.')));
      return;
    }
    publication = node('div', {class: 'publication-status'}, 'Reading publication…');
    navigation = node('nav', {class: 'nav', 'aria-label': 'Main navigation'});
    for (const [view, label] of [['sources', 'Source projects'], ['draft', 'Prepare edition'], ['editions', 'Saved editions'], ['connection', 'Client connection']])
      navigation.append(button(label, () => show(view), {'data-view': view}));
    navigation.append(node('span', {class: 'spacer'}),
      button('Refresh catalog', async () => { await refresh(); await show(state.view); }),
      node('span', {class: 'work-state', role: 'status'}, 'Working…'));
    notice = node('div', {class: 'notice', role: 'status', 'aria-live': 'polite'});
    pendingBox = node('section', {class: 'pending', hidden: true, 'aria-label': 'Retained edition save'});
    main = node('main', {class: 'main', id: 'main-content'});
    shell = node('div', {class: 'shell', 'aria-busy': 'false'},
      node('header', {class: 'masthead'}, node('div', {}, node('div', {class: 'brand'}, 'Starforge · Customer data'),
        node('h1', {}, 'Macrobond series provider'), node('small', {}, 'Retained SDMX sources and reviewed provider editions')), publication),
      navigation, notice, pendingBox, main);
    root.replaceChildren(shell);
    addEventListener('beforeunload', event => {
      if (state.draft?.dirty || state.pending) { event.preventDefault(); event.returnValue = ''; }
    });
    await action(async () => {
      await refresh();
      await show(editions().length ? 'editions' : 'sources');
    });
  }
  initialize().catch(error => {
    root.replaceChildren(node('main', {class: 'opening'}, node('h1', {}, 'The operator could not open'),
      node('p', {}, error.message || String(error))));
  });
})();

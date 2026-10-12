// MIT. Research dossier operator; all provider and persistence operations stay in the original server.
import {createCrossrefPanel} from './crossref.js';
import {createUnstructuredPanel} from './unstructured.js';
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 40;
  const MAX_RESEARCH_FILE_BYTES = 16 * 1024 * 1024;
  const MAX_PORTABLE_FILE_BYTES = 256 * 1024 * 1024;
  const tokenKey = 'research-dossiers-session:' + location.origin;
  const state = {token: '', dossiers: [], dossier: null, activeTab: 'sources', sourceId: null, variantDigest: null,
    page: 0, busy: false, openalexConfigured: false, openalexEditions: [], editingDossier: false, editingQuestion: null, editingFinding: null, editingSelection: null, importCompleted: new Set(), noteDrafts: new Map(), noteEditVersions: new Map()};
  const safeStorage = {
    get() { try { return sessionStorage.getItem(tokenKey) || ''; } catch { return ''; } },
    set(value) { try { sessionStorage.setItem(tokenKey, value); } catch {} }
  };
  const asArray = value => Array.isArray(value) ? value : [];
  const text = value => value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const short = (value, max = 140) => { const out = text(value); return out.length > max ? out.slice(0, max - 1) + '…' : out; };
  const count = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const draftKey = sourceId => state.dossier.id + ':' + sourceId;
  const has = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
  function node(tag, value, className) {
    const result = document.createElement(tag);
    if (value !== undefined && value !== null) result.textContent = String(value);
    if (className) result.className = className;
    return result;
  }
  function date(value, full = false) {
    if (!value) return 'Date unavailable';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined,
      full ? {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'} :
        {year: 'numeric', month: 'short', day: 'numeric'}).format(parsed);
  }
  function safeUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  }
  function host(value) {
    const url = safeUrl(value);
    return url ? new URL(url).hostname.replace(/^www\./, '') : 'Source reference';
  }
  function sourceName(source) { return source.title || source.label || source.url || 'Untitled source'; }
  function sourceText(source) {
    for (const key of ['snippet', 'abstract', 'description', 'content']) if (source[key] !== undefined && source[key] !== null && text(source[key])) return text(source[key]);
    return '';
  }
  function questionById(id) { return asArray(state.dossier?.questions).find(item => item.id === id); }
  function sourceById(id) { return asArray(state.dossier?.sources).find(item => item.id === id); }
  function sourceCitations(source) { return asArray(source.citations); }
  function questionIds(source) {
    return new Set([source.questionId, ...asArray(source.questionIds), ...sourceCitations(source).map(c => c.questionId)].filter(Boolean));
  }
  function errorMessage(error) {
    const code = error.code || error.message || 'REQUEST_FAILED';
    if (error.openAlexImport) return 'Saved ' + error.openAlexImport.pages.length + ' of ' +
      error.openAlexImport.expectedPages + ' cohort pages. The current dossier is loaded; retry this cohort to continue. ' + String(code).replaceAll('_', ' ');
    const messages = {
      REVISION_CONFLICT: 'This dossier changed in another window. Its current revision is loaded; review your edit and save it again.',
      AUTH_REQUIRED: 'The local session needs to be reopened with its complete workspace address.',
      JSON_INVALID: 'This file is not valid JSON. Choose the original saved result file.',
      UPLOAD_SIZE_LIMIT: 'The selected upload is larger than the workspace accepts.',
      VALYU_REFERENCE_REQUIRED: 'Add this research through Provider edition using its original edition reference.',
      PROVIDER_REFERENCE_REQUIRED: 'Choose Provider edition and use the reference from the original provider workspace.'
    };
    return messages[code] || (error.detail && error.detail !== code ? error.detail + ' (' + code + ')' : String(code).replaceAll('_', ' '));
  }
  function notify(message, kind = 'info') {
    $('notice').textContent = message;
    $('notice').dataset.kind = kind;
    $('notice').hidden = !message;
  }
  function setBusy(value) {
    state.busy = value;
    document.body.classList.toggle('working', value);
    $('workspace').setAttribute('aria-busy', String(value));
    document.querySelectorAll('button').forEach(button => {
      if (value) { button.dataset.wasDisabled = button.disabled ? '1' : '0'; button.disabled = true; }
      else if (button.dataset.wasDisabled !== undefined) { button.disabled = button.dataset.wasDisabled === '1'; delete button.dataset.wasDisabled; }
    });
    $('detail-selected').disabled = value;
    $('detail-classification').disabled = value;
    $('connection').textContent = value ? 'Saving / loading' : 'Local workspace';
    if (!value) renderNoteState();
    crossrefPanel.updateBusy();
    documentPanel.updateBusy();
  }
  async function api(path, {method = 'GET', body, download = false} = {}) {
    const response = await fetch(path, {method, headers: {Authorization: 'Bearer ' + state.token,
      ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), credentials: 'omit', cache: 'no-store'});
    if (!response.ok) {
      let value = {};
      try { value = await response.json(); } catch {}
      const error = Object.assign(new Error(value.error || 'HTTP_' + response.status), {
        code: value.error || 'HTTP_' + response.status, detail: value.message, status: response.status, openAlexImport: value.openAlexImport});
      if (response.status === 401 && !$('session-dialog').open) $('session-dialog').showModal();
      throw error;
    }
    return download ? response : response.json();
  }
  async function task(action, form = null) {
    if (state.busy) return;
    const errorBox = form?.querySelector('.form-error');
    if (errorBox) errorBox.hidden = true;
    setBusy(true);
    try { await action(); }
    catch (error) {
      if ((error.code === 'REVISION_CONFLICT' || error.openAlexImport) && state.dossier) {
        try { state.dossier = await api('/api/dossiers/' + encodeURIComponent(state.dossier.id)); render(); } catch {}
      }
      const message = errorMessage(error);
      if (errorBox) { errorBox.textContent = message; errorBox.hidden = false; }
      notify(message, 'error');
    } finally { setBusy(false); updatePagination(); }
  }
  function endpoint(suffix = '') { return '/api/dossiers/' + encodeURIComponent(state.dossier.id) + suffix; }
  async function mutate(suffix, body) {
    const result = await api(endpoint(suffix), {method: 'POST',
      body: {...body, expectedRevision: state.dossier.revision}});
    state.dossier = result;
    await refreshList();
    render();
    return result;
  }
  function summaryOf(view) {
    return {id: view.id, title: view.title, description: view.description, revision: view.revision,
      updatedAt: view.updatedAt, questionCount: asArray(view.questions).length,
      sourceCount: asArray(view.sources).length, editionCount: asArray(view.editions).length,
      selectedCount: asArray(view.sources).filter(source => source.selected).length};
  }
  async function refreshList() {
    const result = await api('/api/state');
    state.dossiers = asArray(result.dossiers);
    state.openalexConfigured = result.openalex?.configured === true;
    $('import-openalex-mode').hidden = !state.openalexConfigured;
    crossrefPanel.configure(result.crossref);
    documentPanel.configure(result.unstructured);
    renderList();
  }
  async function openDossier(id) {
    state.dossier = await api('/api/dossiers/' + encodeURIComponent(id));
    state.sourceId = null;
    state.page = 0;
    $('source-search').value = '';
    $('question-filter').value = '';
    $('selected-only').checked = false;
    const params = new URLSearchParams(); params.set('dossier', state.dossier.id);
    history.replaceState(null, '', '#' + params.toString());
    render();
  }
  function applyDossier(view) {
    state.dossier = view; state.page = 0; state.sourceId = null;
    const params = new URLSearchParams(); params.set('dossier', view.id);
    history.replaceState(null, '', '#' + params.toString());
    render();
  }
  function renderList() {
    const query = $('dossier-search').value.trim().toLocaleLowerCase();
    const items = state.dossiers.filter(item => [item.title, item.description].some(value => text(value).toLocaleLowerCase().includes(query)));
    $('dossier-list').replaceChildren(...items.map(item => {
      const button = node('button', null, 'dossier-item' + (item.id === state.dossier?.id ? ' active' : ''));
      if (item.id === state.dossier?.id) button.setAttribute('aria-current', 'page');
      button.append(node('strong', item.title || 'Untitled dossier'),
        node('span', 'Revision ' + (item.revision ?? '—') + ' · ' + count(item.editionCount) + ' retained editions'));
      button.addEventListener('click', () => task(() => openDossier(item.id)));
      return button;
    }));
    $('collection-empty').hidden = state.dossiers.length > 0;
    $('dossier-count').textContent = state.dossiers.length + ' saved dossier' + (state.dossiers.length === 1 ? '' : 's');
  }
  function render() {
    renderList();
    const view = state.dossier;
    $('empty-workspace').hidden = !!view;
    $('dossier-workspace').hidden = !view;
    crossrefPanel.setDossier(view);
    documentPanel.setDossier(view);
    if (!view) return;
    $('dossier-title').textContent = view.title || 'Untitled dossier';
    $('dossier-description').textContent = view.description || '';
    $('dossier-description').hidden = !view.description;
    $('dossier-eyebrow').textContent = 'Dossier · revision ' + view.revision;
    $('dossier-meta').replaceChildren(node('span', 'Updated ' + date(view.updatedAt, true)),
      node('span', 'Saved locally'));
    $('count-questions').textContent = asArray(view.questions).length;
    $('count-editions').textContent = asArray(view.editions).length;
    $('count-sources').textContent = asArray(view.sources).length;
    $('count-selected').textContent = asArray(view.sources).filter(source => source.selected).length + asArray(view.unavailableSelections).filter(item => item.selected).length;
    const selectedQuestion = $('question-filter').value;
    $('question-filter').replaceChildren(option('', 'All questions'), ...asArray(view.questions).map(q => option(q.id, short(q.text, 80))));
    $('question-filter').value = asArray(view.questions).some(q => q.id === selectedQuestion) ? selectedQuestion : '';
    renderSources(); renderQuestions(); renderFindings(); renderRevisions(); renderUnavailable(); showTab(state.activeTab);
  }
  function option(value, label) { const element = node('option', label); element.value = value; return element; }
  function filteredSources() {
    const query = $('source-search').value.trim().toLocaleLowerCase();
    const question = $('question-filter').value;
    const selectedOnly = $('selected-only').checked;
    const sources = asArray(state.dossier?.sources).filter(source =>
      (!question || questionIds(source).has(question)) && (!selectedOnly || source.selected) &&
      (!query || [sourceName(source), source.url, sourceText(source), source.note, source.classification]
        .some(value => text(value).toLocaleLowerCase().includes(query))));
    const order = $('source-sort').value;
    if (order === 'title') sources.sort((a, b) => sourceName(a).localeCompare(sourceName(b)));
    if (order === 'coverage') sources.sort((a, b) => sourceCitations(b).length - sourceCitations(a).length);
    if (order === 'newest') sources.sort((a, b) => (Date.parse(b.publishedAt || b.publication_date) || 0) - (Date.parse(a.publishedAt || a.publication_date) || 0));
    return sources;
  }
  function renderSources() {
    if (!state.dossier) return;
    const sources = filteredSources(), all = asArray(state.dossier.sources);
    state.page = Math.min(state.page, Math.max(0, Math.ceil(sources.length / PAGE_SIZE) - 1));
    $('source-count').textContent = sources.length + ' of ' + all.length + ' unique sources';
    $('sources-empty').hidden = sources.length > 0;
    $('source-table-wrap').hidden = sources.length === 0;
    $('sources-empty-title').textContent = all.length ? 'No sources match these filters' : 'Add the first result edition';
    $('sources-empty-text').textContent = all.length ? 'Change the search, question, or selected-evidence filter.' :
      'Attach a retained result file or an edition reference from the original research service.';
    $('sources-add').hidden = all.length > 0;
    $('source-rows').replaceChildren(...sources.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE).map(source => {
      const row = node('tr', null, source.id === state.sourceId ? 'focused' : '');
      const selection = node('td', null, 'select-column');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = !!source.selected;
      checkbox.setAttribute('aria-label', 'Select evidence: ' + sourceName(source));
      checkbox.addEventListener('change', () => task(async () => {
        await mutate('/evidence', {sourceId: source.id, selected: checkbox.checked, note: source.note || '',
          classification: source.classification || 'unreviewed'});
      }));
      selection.append(checkbox);
      const main = node('td');
      const title = node('button', sourceName(source), 'source-title');
      title.addEventListener('click', () => { if (!state.busy) {state.sourceId = source.id; state.variantDigest = null; renderSources();} });
      main.append(title, node('div', host(source.url), 'source-host'));
      const excerpt = sourceText(source);
      if (excerpt) main.append(node('div', short(excerpt, 700), 'source-snippet'));
      const tags = node('div', null, 'source-tags');
      if (source.selected) tags.append(node('span', 'Selected', 'tag'));
      if (source.classification && source.classification !== 'unreviewed') tags.append(node('span', source.classification, 'tag'));
      if (source.note) tags.append(node('span', 'Analyst note', 'tag'));
      if (tags.childNodes.length) main.append(tags);
      const coverage = node('td', null, 'cell-detail');
      const citations = sourceCitations(source);
      coverage.append(node('div', citations.length + ' citation' + (citations.length === 1 ? '' : 's')),
        node('div', questionIds(source).size + ' question' + (questionIds(source).size === 1 ? '' : 's')));
      const published = node('td', source.publishedAt || source.publication_date ? date(source.publishedAt || source.publication_date) : '—', 'cell-detail date-cell');
      row.append(selection, main, coverage, published); return row;
    }));
    renderDetail(); updatePagination();
  }
  function updatePagination() {
    if (!state.dossier) return;
    const sources = filteredSources(), pages = Math.max(1, Math.ceil(sources.length / PAGE_SIZE));
    $('source-pagination').hidden = sources.length === 0;
    $('page-status').textContent = 'Page ' + (state.page + 1) + ' of ' + pages;
    $('page-prev').disabled = state.busy || state.page === 0;
    $('page-next').disabled = state.busy || state.page + 1 >= pages;
  }
  function availability(item) {
    const access = item.availability || item.access || item.sourceAccess;
    const status = typeof access === 'string' ? access : access?.status || item.accessStatus || item.status;
    const until = item.availableUntil || item.validUntil || access?.availableUntil || access?.validUntil;
    const values = [];
    if (status) values.push(String(status).replaceAll('_', ' '));
    if (until) values.push('Available until ' + date(until, true));
    return values.join(' · ');
  }
  function renderDetail() {
    const source = sourceById(state.sourceId);
    $('source-detail').hidden = !source;
    document.querySelector('.source-layout').classList.toggle('has-detail', !!source);
    if (!source) return;
    $('detail-title').textContent = sourceName(source);
    const url = safeUrl(source.url);
    $('detail-link').hidden = !url;
    if (url) { $('detail-link').href = url; $('detail-link').textContent = url; }
    else { $('detail-link').removeAttribute('href'); $('detail-link').textContent = ''; }
    const metadata = [];
    if (source.provider || source.source) metadata.push(node('span', text(source.provider || source.source)));
    if (source.publishedAt || source.publication_date) metadata.push(node('span', date(source.publishedAt || source.publication_date)));
    if (asArray(source.authors).length) metadata.push(node('span', source.authors.join(', ')));
    if (source.doi) metadata.push(node('span', 'DOI ' + text(source.doi)));
    if (availability(source)) metadata.push(node('span', availability(source), 'availability'));
    $('detail-meta').replaceChildren(...metadata);
    $('detail-selected').checked = !!source.selected;
    $('detail-classification').value = source.classification || 'unreviewed';
    const variants = asArray(source.variants);
    $('detail-variant').hidden = variants.length < 2;
    const newest = variants.find(variant => text(variant.content) === text(source.content)) || variants.at(-1);
    const chosen = variants.find(variant => variant.contentDigest === state.variantDigest) || newest;
    state.variantDigest = chosen?.contentDigest || null;
    $('detail-variant').replaceChildren(...variants.map(variant => {
      const edition = asArray(state.dossier.editions).find(item => item.id === variant.editionId);
      return option(variant.contentDigest, edition?.label || edition?.id || 'Result edition');
    }));
    if (chosen) $('detail-variant').value = chosen.contentDigest;
    renderExcerpt(source, chosen);
    $('detail-citations').replaceChildren(...sourceCitations(source).map(citation => {
      const edition = asArray(state.dossier.editions).find(item => item.id === citation.editionId);
      const question = questionById(citation.questionId || edition?.questionId);
      const item = node('li');
      item.append(node('strong', question?.text || 'Research source'),
        node('span', edition?.label || citation.label || citation.editionId || 'Original result edition'));
      if (edition?.capturedAt || citation.capturedAt) item.append(node('div', date(edition?.capturedAt || citation.capturedAt, true)));
      if (citation.citation) item.append(node('div', text(citation.citation)));
      if (citation.references) item.append(node('div', 'Reference: ' + text(citation.references)));
      if (citation.original !== undefined && citation.original !== null) {
        const original = node('details', null, 'original-record');
        original.append(node('summary', 'Original result record'));
        original.addEventListener('toggle', () => {
          if (original.open && !original.querySelector('pre')) original.append(node('pre', text(citation.original)));
        });
        item.append(original);
      }
      return item;
    }));
    const draft = state.noteDrafts.get(draftKey(source.id));
    $('detail-note').value = draft === undefined ? source.note || '' : draft;
    renderNoteState();
  }
  function renderExcerpt(source, variant) {
    const content = variant?.content ?? source.content ?? source.abstract ?? source.description ?? source.snippet;
    $('detail-excerpt').textContent = content === undefined || content === null || content === '' ?
      'This source has no current excerpt. Its original reference and your saved analysis remain available.' : text(content);
    $('detail-excerpt').classList.toggle('typed-content', content !== null && typeof content === 'object');
  }
  function renderNoteState() {
    const source = sourceById(state.sourceId);
    if (!source) return;
    const value = $('detail-note').value;
    const dirty = value !== (source.note || '');
    $('note-state').textContent = dirty ? 'Unsaved note' : source.note ? 'Saved' : 'Add a note to this source';
    $('save-note').disabled = state.busy || !dirty;
  }
  async function saveEvidence({includeNote = true} = {}) {
    const source = sourceById(state.sourceId);
    if (!source) return;
    const key = draftKey(source.id), editVersion = state.noteEditVersions.get(key) || 0;
    const note = includeNote ? $('detail-note').value : source.note || '';
    const selected = $('detail-selected').checked;
    const classification = $('detail-classification').value;
    await mutate('/evidence', {sourceId: source.id, selected, note, classification});
    // A completed save may acknowledge an older draft while the user keeps typing.
    if (includeNote && (state.noteEditVersions.get(key) || 0) === editVersion)
      state.noteDrafts.delete(key);
    renderDetail();
    const draft = state.noteDrafts.get(key), saved = sourceById(source.id);
    notify(draft !== undefined && draft !== (saved?.note || '') ?
      'Evidence selection saved. Your newer note is still unsaved.' : 'Evidence selection and analysis saved.');
  }
  function renderQuestions() {
    const questions = asArray(state.dossier.questions);
    $('questions-empty').hidden = questions.length > 0;
    $('question-list').replaceChildren(...questions.map(question => {
      const editions = asArray(state.dossier.editions).filter(item => item.questionId === question.id);
      const sources = asArray(state.dossier.sources).filter(source => questionIds(source).has(question.id));
      const card = node('article', null, 'question-card');
      card.append(node('h3', question.text));
      if (question.notes) card.append(node('p', question.notes, 'question-note'));
      const meta = node('div', null, 'record-meta');
      meta.append(node('span', question.status || 'open'), node('span', editions.length + ' editions'), node('span', sources.length + ' sources'));
      const actions = node('div', null, 'button-row');
      const show = node('button', 'View sources', 'compact');
      show.addEventListener('click', () => { $('question-filter').value = question.id; state.page = 0; showTab('sources'); renderSources(); });
      const add = node('button', 'Add research', 'compact');
      add.addEventListener('click', () => showImport(question.id));
      const edit = node('button', 'Edit', 'quiet compact');
      edit.addEventListener('click', () => showQuestion(question));
      actions.append(show, add, edit); card.append(meta, actions); return card;
    }));
    const editions = asArray(state.dossier.editions);
    $('edition-list').replaceChildren(...editions.map(edition => {
      const row = node('article', null, 'edition-item');
      const main = node('div');
      main.append(node('strong', edition.label || edition.filename || 'Result edition'),
        node('p', questionById(edition.questionId)?.text || 'Research question'));
      const values = [edition.provider, availability(edition)].filter(Boolean);
      if (values.length) main.append(node('p', values.join(' · ')));
      const outcome = providerOutcome(edition);
      if (outcome) main.append(node('div', outcome, 'provider-outcome'));
      row.append(main, node('span', date(edition.capturedAt || edition.createdAt, true))); return row;
    }));
    if (!editions.length) $('edition-list').append(node('p', 'Result editions appear here after import.', 'muted small'));
    const usage = asArray(state.dossier.providerUsage);
    for (const item of usage) {
      const result = providerOutcome(item);
      if (result) $('edition-list').append(node('div', [item.provider || 'Provider', result].join(' · '), 'provider-outcome'));
    }
  }
  function providerOutcome(item) {
    const raw = item.usage || item.outcome || item;
    const values = [];
    if (raw.sourceCoverage) values.push('Original cohort coverage: ' + text(raw.sourceCoverage) +
      ' · ' + text(raw.sourceRecordsReceived) + ' records · ' + text(raw.sourcePages) + ' pages');
    if (raw.sourceDecisionsRevision !== undefined) values.push('Original review revision: ' + text(raw.sourceDecisionsRevision));
    const deduction = raw.total_deduction_dollars ?? item.total_deduction_dollars;
    if (deduction !== undefined && deduction !== null) values.push('Reported usage USD ' + text(deduction));
    if (raw.success !== undefined) values.push('Provider success: ' + text(raw.success));
    const warnings = asArray(raw.warnings || item.warnings);
    if (warnings.length) values.push('Provider notes: ' + warnings.map(text).join('; '));
    if (raw.error || item.error) values.push('Provider response: ' + text(raw.error || item.error));
    if (raw.status && raw.status !== item.status) values.push(text(raw.status));
    return values.join('\n');
  }
  function renderUnavailable() {
    const rows = asArray(state.dossier.unavailableSelections);
    $('unavailable-sources').hidden = !rows.length;
    $('unavailable-source-list').replaceChildren(...rows.map(item => {
      const card = node('article', null, 'unavailable-source-item');
      card.append(node('strong', item.label || item.title || 'Saved evidence reference'),
        node('div', item.occurrenceId || '', 'reference-code'));
      const status = [item.classification, item.selected ? 'Selected evidence' : '', availability(item)].filter(Boolean);
      if (status.length) card.append(node('div', status.join(' · '), 'record-meta'));
      if (item.questionId) card.append(node('div', questionById(item.questionId)?.text || 'Original research question', 'record-meta'));
      if (item.note) card.append(node('p', item.note));
      const actions = node('div', null, 'button-row'), edit = node('button', 'Edit analysis', 'compact');
      edit.addEventListener('click', () => showSelection(item)); actions.append(edit); card.append(actions);
      return card;
    }));
  }
  function renderFindings() {
    const findings = asArray(state.dossier.findings);
    $('findings-empty').hidden = findings.length > 0;
    $('finding-list').replaceChildren(...findings.map(finding => {
      const card = node('article', null, 'finding-card');
      const heading = node('div', null, 'finding-card-heading'), titles = node('div');
      titles.append(node('div', questionById(finding.questionId)?.text || 'Research finding', 'eyebrow'), node('h3', finding.title || 'Finding'));
      const edit = node('button', 'Edit', 'quiet compact'); edit.addEventListener('click', () => showFinding(finding));
      heading.append(titles, edit); card.append(heading, node('p', finding.text || '', 'finding-text'));
      const references = node('div', null, 'finding-source-list');
      asArray(finding.sourceIds).forEach((id, index) => {
        const source = sourceById(id), button = node('button', '[' + (index + 1) + '] ' + (source ? sourceName(source) : 'Saved source reference'), 'quiet compact');
        button.addEventListener('click', () => {
          if (!source) {notify('This source is currently unavailable. Its reference remains attached to the finding.'); return;}
          $('source-search').value = ''; $('question-filter').value = ''; $('selected-only').checked = false;
          state.sourceId = id; state.page = Math.floor(asArray(state.dossier.sources).findIndex(s => s.id === id) / PAGE_SIZE);
          showTab('sources'); renderSources(); $('source-detail').scrollIntoView({block: 'nearest'});
        });
        references.append(button);
      });
      if (!references.childNodes.length) references.append(node('span', finding.unavailableSources ? 'Original evidence references are retained below.' : 'No source references attached.', 'muted small'));
      card.append(references);
      if (finding.unavailableSources) card.append(node('p', finding.unavailableSources + ' original source reference' +
        (finding.unavailableSources === 1 ? ' is' : 's are') + ' currently unavailable. Saved analysis and reference handles are retained.', 'finding-availability'));
      return card;
    }));
  }
  function renderRevisions() {
    const revisions = [...asArray(state.dossier.revisions)];
    const before = $('compare-before').value, after = $('compare-after').value;
    const options = () => revisions.map(item => option(String(item.revision), 'Revision ' + item.revision + ' · ' + date(item.createdAt || item.updatedAt)));
    $('compare-before').replaceChildren(...options()); $('compare-after').replaceChildren(...options());
    if (revisions.length) {
      $('compare-before').value = revisions.some(r => String(r.revision) === before) ? before : String(revisions[Math.max(0, revisions.length - 2)].revision);
      $('compare-after').value = revisions.some(r => String(r.revision) === after) ? after : String(revisions[revisions.length - 1].revision);
    }
    $('compare-form').querySelector('button').disabled = revisions.length < 2;
    $('revision-list').replaceChildren(...revisions.reverse().map(item => {
      const row = node('li');
      row.append(node('span', 'Revision ' + item.revision, 'revision-number'),
        node('span', item.label || item.action || item.reason || 'Dossier updated'),
        node('time', date(item.createdAt || item.updatedAt, true)));
      return row;
    }));
  }
  function renderComparison(comparison) {
    const added = asArray(comparison.added), removed = asArray(comparison.removed), changed = asArray(comparison.changed);
    const summary = node('div', null, 'comparison-summary');
    [['Added sources', added.length], ['Removed sources', removed.length], ['Changed sources', changed.length]].forEach(([label, value]) => {
      const part = node('div'); part.append(node('strong', value), node('span', label)); summary.append(part);
    });
    const output = [summary];
    function group(title, rows) {
      if (!rows.length) return;
      const section = node('section', null, 'change-group'); section.append(node('h3', title));
      const list = node('ul', null, 'change-list');
      rows.forEach(change => {
        const value = typeof change === 'string' ? sourceById(change) || {title: change} : change.after || change.source || change.before || change;
        const row = node('li', sourceName(value));
        const details = change.fields || change.changedFields || change.changes;
        if (details) row.append(node('span', Array.isArray(details) ? details.join(', ') : text(details)));
        if (value.url) row.append(node('span', value.url));
        list.append(row);
      });
      section.append(list); output.push(section);
    }
    group('Added sources', added); group('Removed sources', removed); group('Changed sources', changed);
    const findingChanges = comparison.findings;
    if (findingChanges && !Array.isArray(findingChanges)) {
      for (const [kind, label] of [['added', 'Added findings'], ['removed', 'Removed findings'], ['changed', 'Changed findings']]) {
        const rows = asArray(findingChanges[kind]);
        if (!rows.length) continue;
        const section = node('section', null, 'change-group'); section.append(node('h3', label));
        for (const change of rows) {
          const current = change.after || change.before || change;
          const record = node('article', null, 'finding-change');
          record.append(node('h4', current.title || 'Research finding'));
          const question = questionById(current.questionId);
          if (question) record.append(node('p', question.text, 'muted small'));
          if (asArray(change.changes).length) record.append(node('p', 'Changed: ' + change.changes.join(', '), 'record-meta'));
          const versions = kind === 'changed' ? [['Before', change.before], ['After', change.after]] :
            [[kind === 'added' ? 'Added analysis' : 'Removed analysis', current]];
          const versionsNode = node('div', null, 'finding-change-versions');
          for (const [versionLabel, finding] of versions) {
            if (!finding) continue;
            const version = node('section');
            version.append(node('strong', versionLabel), node('p', finding.title || 'Research finding'),
              node('pre', finding.text || 'No analysis text.'));
            const references = asArray(finding.occurrenceIds);
            const details = node('details', null, 'original-record');
            details.append(node('summary', references.length + ' original evidence reference' + (references.length === 1 ? '' : 's')),
              node('pre', references.length ? references.join('\n') : 'No evidence references attached.'));
            version.append(details);
            if (finding.unavailableSources) version.append(node('p', finding.unavailableSources + ' currently unavailable.', 'muted small'));
            versionsNode.append(version);
          }
          record.append(versionsNode); section.append(record);
        }
        output.push(section);
      }
    }
    for (const key of ['questions', 'editions', 'availability']) {
      const value = comparison[key];
      if (!value || Array.isArray(value) && !value.length) continue;
      if (Array.isArray(value)) group(key[0].toUpperCase() + key.slice(1) + ' changed', value.map(v => ({title: v.text || v.label || v.title || v.id || text(v)})));
      else {
        const groups = ['added', 'removed', 'changed'].filter(name => asArray(value[name]).length);
        if (groups.length) {
          const section = node('section', null, 'change-group'); section.append(node('h3', key[0].toUpperCase() + key.slice(1)));
          section.append(node('p', groups.map(name => asArray(value[name]).length + ' ' + name).join(' · '), 'muted small')); output.push(section);
        }
      }
    }
    if (!added.length && !removed.length && !changed.length) output.push(node('p', 'The retained source set is unchanged between these revisions.', 'muted small'));
    $('compare-output').replaceChildren(...output);
  }
  function showTab(tab) {
    if (tab === 'crossref' && $('crossref-tab').hidden) tab = 'sources';
    state.activeTab = tab;
    ['sources', 'questions', 'findings', 'revisions', 'crossref', 'documents'].forEach(name => {
      $('view-' + name).hidden = name !== tab;
      const button = document.querySelector('[data-tab="' + name + '"]');
      button.classList.toggle('active', name === tab);
      if (name === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    crossrefPanel.show(tab === 'crossref');
    documentPanel.show(tab === 'documents');
  }
  function clearFormError(form) { const box = form.querySelector('.form-error'); if (box) {box.textContent = ''; box.hidden = true;} }
  function showDossier(edit = false) {
    if (state.busy) return;
    state.editingDossier = edit;
    $('dossier-dialog-title').textContent = edit ? 'Edit dossier details' : 'Create a dossier';
    $('dossier-submit').textContent = edit ? 'Save details' : 'Create dossier';
    $('form-title').value = edit ? state.dossier.title : '';
    $('form-description').value = edit ? state.dossier.description || '' : '';
    clearFormError($('dossier-form')); $('dossier-dialog').showModal(); $('form-title').focus();
  }
  function showQuestion(question = null) {
    if (state.busy || !state.dossier) return;
    state.editingQuestion = question?.id || null;
    $('question-dialog-title').textContent = question ? 'Edit research question' : 'Add research question';
    $('question-submit').textContent = question ? 'Save question' : 'Add question';
    $('form-question').value = question?.text || '';
    $('form-question-notes').value = question?.notes || '';
    $('form-question-status').value = question?.status || 'open';
    $('question-extra').hidden = !question;
    clearFormError($('question-form')); $('question-dialog').showModal(); $('form-question').focus();
  }
  function fillQuestionSelect(element, selected = null) {
    element.replaceChildren(...asArray(state.dossier.questions).map(question => option(question.id, question.text)));
    if (selected && asArray(state.dossier.questions).some(q => q.id === selected)) element.value = selected;
  }
  function updateImportMode() {
    const mode = $('import-form').elements.importMode.value;
    $('import-files-fields').hidden = mode !== 'files'; $('import-reference-fields').hidden = mode !== 'reference';
    $('import-openalex-fields').hidden = mode !== 'openalex';
    $('import-files').required = mode === 'files'; $('import-reference').required = mode === 'reference';
    $('import-openalex-edition').required = mode === 'openalex';
    $('import-label').maxLength = mode === 'openalex' ? 200 : 240;
    $('import-label').placeholder = mode === 'openalex' ? 'Optional; original cohort label is used when blank' : 'Optional; file name is used when blank';
    $('import-submit').textContent = mode === 'files' ? 'Import files' : mode === 'openalex' ? 'Import saved cohort' : 'Add provider edition';
  }
  function renderSavedCohort() {
    const edition = state.openalexEditions.find(item => item.record.id === $('import-openalex-edition').value);
    const target = $('import-openalex-summary'); target.replaceChildren();
    if (!edition) {target.append(node('p', 'No saved works cohorts are available in the connected research workspace.', 'muted small')); return;}
    target.append(node('p', edition.coverage.state + ' · ' + edition.coverage.recordsReceived + ' records across ' +
      edition.coverage.pages + ' pages · review revision ' + edition.decisionsRevision, 'record-meta'));
    target.append(node('p', edition.query.label, 'small'));
    target.append(node('pre', JSON.stringify(edition.query.parameters, null, 2), 'source-excerpt'));
    if (edition.coverage.warnings?.length) target.append(node('p', edition.coverage.warnings.map(text).join('; '), 'muted small'));
    if (edition.pending) target.append(node('p', 'The original workspace has a pending acquisition. This import uses its currently saved pages.', 'muted small'));
  }
  async function loadSavedCohorts() {
    const prior = $('import-openalex-edition').value;
    const result = await api('/api/openalex/editions');
    state.openalexEditions = asArray(result.editions);
    $('import-openalex-edition').replaceChildren(...state.openalexEditions.map(item =>
      option(item.record.id, item.record.label + ' · ' + item.coverage.state + ' · ' + item.coverage.recordsReceived + ' records')));
    if (state.openalexEditions.some(item => item.record.id === prior)) $('import-openalex-edition').value = prior;
    renderSavedCohort();
  }
  function showImport(questionId = null) {
    if (state.busy || !state.dossier) return;
    if (!asArray(state.dossier.questions).length) {showQuestion(); notify('Add the research question first, then attach its result edition.'); return;}
    $('import-form').reset(); state.importCompleted.clear(); fillQuestionSelect($('import-question'), questionId || $('question-filter').value);
    $('import-file-list').replaceChildren(); updateImportMode(); clearFormError($('import-form'));
    $('import-dialog').showModal();
  }
  function showFinding(finding = null) {
    if (state.busy || !state.dossier) return;
    if (!asArray(state.dossier.questions).length) {showQuestion(); notify('Add a research question before writing a finding.'); return;}
    state.editingFinding = finding;
    $('finding-form').reset();
    fillQuestionSelect($('finding-question'), finding?.questionId || $('question-filter').value);
    $('finding-question').disabled = !!finding;
    $('finding-title').value = finding?.title || '';
    $('finding-text').value = finding?.text || '';
    $('finding-dialog-title').textContent = finding ? 'Edit finding' : 'Add finding';
    $('finding-submit').textContent = finding ? 'Save analysis' : 'Save finding';
    $('replace-sources-control').hidden = !finding;
    $('preserve-finding-sources').hidden = !finding;
    renderFindingSources();
    clearFormError($('finding-form')); $('finding-dialog').showModal(); $('finding-title').focus();
  }
  function renderFindingSources() {
    const finding = state.editingFinding;
    const sources = asArray(state.dossier.sources).filter(source => questionIds(source).has($('finding-question').value));
    $('finding-sources').replaceChildren(...sources.map(source => {
      const label = node('label', null, 'source-pick'), checkbox = node('input');
      checkbox.type = 'checkbox'; checkbox.value = source.id; checkbox.name = 'findingSource';
      checkbox.checked = finding ? asArray(finding.sourceIds).includes(source.id) : !!source.selected;
      checkbox.disabled = !!finding && !$('replace-finding-sources').checked;
      const description = node('div', sourceName(source)); description.append(node('span', host(source.url)));
      label.append(checkbox, description); return label;
    }));
    if (!sources.length) $('finding-sources').append(node('p',
      'This question has no current source projection. You can save the analysis now.', 'muted small'));
  }
  function showSelection(selection) {
    if (state.busy) return;
    state.editingSelection = selection;
    $('selection-question').textContent = questionById(selection.questionId)?.text || 'Saved source reference';
    $('selection-selected').checked = !!selection.selected;
    $('selection-classification').value = selection.classification || 'unreviewed';
    $('selection-note').value = selection.note || '';
    clearFormError($('selection-form')); $('selection-dialog').showModal();
  }
  async function readOriginalFile(file, {portable = false} = {}) {
    const limit = portable ? MAX_PORTABLE_FILE_BYTES : MAX_RESEARCH_FILE_BYTES;
    if (file.size > limit) throw Object.assign(new Error('FILE_TOO_LARGE'), {detail: 'Choose a JSON file at most ' + (portable ? '256' : '16') + ' MiB.'});
    const bytes = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); }
    catch { throw Object.assign(new Error('UTF8_FILE_REQUIRED'), {detail: 'The original result must be a UTF-8 JSON file.'}); }
  }
  function parseJson(raw) {
    try { return JSON.parse(raw); } catch { throw Object.assign(new Error('JSON_INVALID'), {code: 'JSON_INVALID'}); }
  }
  const crossrefPanel = createCrossrefPanel({root:$('view-crossref'),tab:$('crossref-tab'),api,task,notify,
    getDossier:()=>state.dossier,isBusy:()=>state.busy,
    onReceived:async view=>{applyDossier(view);await refreshList();}});
  const documentPanel = createUnstructuredPanel({root:$('view-documents'),tab:$('documents-tab'),api,task,notify,
    getDossier:()=>state.dossier,isBusy:()=>state.busy,
    onReceived:async view=>{applyDossier(view);await refreshList();}});
  document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => {
    if (!state.busy) button.closest('dialog').close();
  }));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); }));
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab)));
  $('new-dossier').addEventListener('click', () => showDossier());
  $('empty-create').addEventListener('click', () => showDossier());
  $('edit-dossier').addEventListener('click', () => showDossier(true));
  $('dossier-search').addEventListener('input', renderList);
  $('refresh').addEventListener('click', () => task(async () => {
    await refreshList();
    if (state.dossier) {state.dossier = await api(endpoint()); render();}
    notify('Saved dossiers and current source availability refreshed.');
  }));
  ['source-search', 'question-filter', 'source-sort', 'selected-only'].forEach(id => {
    $(id).addEventListener(id === 'source-search' ? 'input' : 'change', () => {state.page = 0; renderSources();});
  });
  $('page-prev').addEventListener('click', () => {if (!state.busy && state.page > 0) {state.page--; renderSources();}});
  $('page-next').addEventListener('click', () => {if (!state.busy) {state.page++; renderSources();}});
  $('detail-close').addEventListener('click', () => {state.sourceId = null; renderSources();});
  $('detail-variant').addEventListener('change', () => {
    const source = sourceById(state.sourceId);
    if (!source) return;
    state.variantDigest = $('detail-variant').value;
    renderExcerpt(source, asArray(source.variants).find(variant => variant.contentDigest === state.variantDigest));
  });
  $('detail-note').addEventListener('input', () => {
    if (state.sourceId) {
      const value = $('detail-note').value, source = sourceById(state.sourceId), key = draftKey(state.sourceId);
      state.noteEditVersions.set(key, (state.noteEditVersions.get(key) || 0) + 1);
      // While a save is pending, reverting to the earlier saved text is still a new edit.
      if (!state.busy && value === (source?.note || '')) state.noteDrafts.delete(key);
      else state.noteDrafts.set(key, value);
    }
    renderNoteState();
  });
  $('save-note').addEventListener('click', () => task(() => saveEvidence()));
  $('detail-selected').addEventListener('change', () => task(() => saveEvidence()));
  $('detail-classification').addEventListener('change', () => task(() => saveEvidence()));
  ['import-results', 'sources-add'].forEach(id => $(id).addEventListener('click', () => showImport()));
  ['add-question', 'questions-add'].forEach(id => $(id).addEventListener('click', () => showQuestion()));
  ['add-finding', 'findings-add'].forEach(id => $(id).addEventListener('click', () => showFinding()));
  $('dossier-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    task(async () => {
      const payload = {title: $('form-title').value.trim(), description: $('form-description').value};
      const view = state.editingDossier ? await mutate('', payload) : await api('/api/dossiers', {method: 'POST', body: payload});
      applyDossier(view); await refreshList(); $('dossier-dialog').close();
      notify(state.editingDossier ? 'Dossier details saved.' : 'Dossier created. Add the first research question.');
    }, form);
  });
  $('question-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    task(async () => {
      const payload = {text: $('form-question').value.trim()};
      if (state.editingQuestion) Object.assign(payload, {notes: $('form-question-notes').value, status: $('form-question-status').value});
      await mutate('/questions' + (state.editingQuestion ? '/' + encodeURIComponent(state.editingQuestion) : ''), payload);
      $('question-dialog').close(); notify(state.editingQuestion ? 'Question and research notes saved.' : 'Research question added.');
    }, form);
  });
  $('import-form').querySelectorAll('[name=importMode]').forEach(input => input.addEventListener('change', () => {
    updateImportMode();
    if (input.value === 'openalex') task(loadSavedCohorts, $('import-form'));
  }));
  $('import-openalex-edition').addEventListener('change', renderSavedCohort);
  $('import-openalex-refresh').addEventListener('click', () => task(loadSavedCohorts, $('import-form')));
  $('import-retained-provider').addEventListener('change', () => {
    $('import-format-help').textContent = $('import-retained-provider').value === 'openalex' ?
      'Import the original OpenAlex response containing meta and results.' :
      'Research envelopes retain their source terms and original result entries.';
  });
  $('import-files').addEventListener('change', () => {
    state.importCompleted.clear();
    $('import-file-list').replaceChildren(...Array.from($('import-files').files || []).map(file => {
      const row = node('div'); row.append(node('span', file.name), node('span', (file.size / 1024).toFixed(1) + ' KiB')); return row;
    }));
  });
  $('import-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    task(async () => {
      const questionId = $('import-question').value, label = $('import-label').value.trim();
      if (form.elements.importMode.value === 'openalex') {
        const editionId = $('import-openalex-edition').value;
        if (!editionId) throw new Error('OPENALEX_SAVED_EDITION_REQUIRED');
        const imported = await api(endpoint('/openalex'), {method:'POST', body:{questionId,editionId,
          ...(label ? {label} : {}),expectedRevision:state.dossier.revision}});
        state.dossier = imported.dossier;
        await refreshList(); render();
        $('import-dialog').close();
        notify('Saved cohort imported: ' + imported.importedPages + ' new pages, ' + imported.reusedPages +
          ' retained pages · source coverage ' + imported.coverage.state + '.');
      } else if (form.elements.importMode.value === 'reference') {
        const reference = parseJson($('import-reference').value);
        await mutate('/reference', {questionId, label, provider: $('import-provider').value.trim(), reference});
        $('import-dialog').close(); notify('Provider edition attached to the research question.');
      } else {
        const files = Array.from($('import-files').files || []);
        if (!files.length) throw new Error('RESULT_FILE_REQUIRED');
        let completed = state.importCompleted.size;
        for (let index = 0; index < files.length; index++) {
          if (state.importCompleted.has(index)) continue;
          const file = files[index];
          const rawText = await readOriginalFile(file);
          try {
            await mutate('/receive', {questionId, label: label ? label + (files.length > 1 ? ' · ' + file.name : '') : file.name,
              provider: $('import-retained-provider').value, filename: file.name, rawText});
            state.importCompleted.add(index); completed++; notify('Imported ' + completed + ' of ' + files.length + ' files.');
          } catch (error) {
            error.detail = 'Imported ' + completed + ' of ' + files.length + ' files. ' + file.name + ': ' + errorMessage(error);
            throw error;
          }
        }
        $('import-dialog').close(); notify(completed + ' result edition' + (completed === 1 ? '' : 's') + ' imported.');
      }
    }, form);
  });
  $('finding-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    task(async () => {
      const sourceIds = Array.from(form.querySelectorAll('[name=findingSource]:checked')).map(input => input.value);
      const payload = {title: $('finding-title').value.trim(), text: $('finding-text').value};
      if (state.editingFinding) {
        if ($('replace-finding-sources').checked) payload.sourceIds = sourceIds;
        await mutate('/findings/' + encodeURIComponent(state.editingFinding.id), payload);
      } else await mutate('/findings', {...payload, questionId: $('finding-question').value, sourceIds});
      $('finding-dialog').close(); showTab('findings'); notify('Finding and source references saved.');
    }, form);
  });
  $('finding-question').addEventListener('change', renderFindingSources);
  $('replace-finding-sources').addEventListener('change', () => {
    $('preserve-finding-sources').textContent = $('replace-finding-sources').checked ? 'The new selection replaces the original source references.' : 'Current source references are kept when you edit the analysis.';
    $('finding-form').querySelectorAll('[name=findingSource]').forEach(input => {input.disabled = !$('replace-finding-sources').checked;});
  });
  $('selection-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    task(async () => {
      await mutate('/selections', {occurrenceId: state.editingSelection.occurrenceId,
        selected: $('selection-selected').checked, note: $('selection-note').value,
        classification: $('selection-classification').value});
      $('selection-dialog').close(); notify('Saved source analysis updated.');
    }, form);
  });
  $('compare-form').addEventListener('submit', event => {
    event.preventDefault();
    task(async () => {
      const before = $('compare-before').value, after = $('compare-after').value;
      if (!before || !after || before === after) throw Object.assign(new Error('DISTINCT_REVISIONS_REQUIRED'), {detail: 'Choose two different revisions.'});
      renderComparison(await api(endpoint('/compare?before=' + encodeURIComponent(before) + '&after=' + encodeURIComponent(after))));
    });
  });
  $('export-open').addEventListener('click', () => {
    if (!state.busy) {clearFormError($('export-form')); $('export-dialog').showModal();}
  });
  $('export-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    task(async () => {
      const format = $('export-format').value, response = await api(endpoint('/export?format=' + format), {download: true});
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
      const header = response.headers.get('Content-Disposition') || '';
      const match = header.match(/filename="([^"]+)"/);
      anchor.href = url; anchor.download = match?.[1] || 'research-dossier.' + format;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      $('export-dialog').close(); notify('Dossier export downloaded.');
    }, form);
  });
  ['open-portable', 'empty-open'].forEach(id => $(id).addEventListener('click', () => {if (!state.busy) {$('portable-file').value = ''; $('portable-file').click();}}));
  $('portable-file').addEventListener('change', () => task(async () => {
    const file = $('portable-file').files?.[0]; if (!file) return;
    const portable = parseJson(await readOriginalFile(file, {portable: true}));
    const view = await api('/api/reopen', {method: 'POST', body: {portable}});
    applyDossier(view); await refreshList(); notify('Portable dossier reopened.');
  }));
  $('session-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    task(async () => {
      const supplied = new URL($('session-url').value);
      if (supplied.origin !== location.origin) throw Object.assign(new Error('WORKSPACE_ADDRESS_MISMATCH'), {detail: 'Use the complete address printed by this workspace instance.'});
      const token = new URLSearchParams(supplied.hash.slice(1)).get('token');
      if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('SESSION_FRAGMENT_REQUIRED');
      state.token = token; safeStorage.set(token); await refreshList(); $('session-dialog').close();
      $('session-url').value = ''; notify('Local workspace session opened.');
    }, form);
  });
  window.addEventListener('beforeunload', event => {
    if (state.noteDrafts.size > 0) {event.preventDefault(); event.returnValue = '';}
  });
  async function start() {
    const params = new URLSearchParams(location.hash.slice(1));
    state.token = params.get('token') || safeStorage.get();
    if (state.token) safeStorage.set(state.token);
    params.delete('token');
    history.replaceState(null, '', params.toString() ? '#' + params.toString() : location.pathname);
    if (!state.token) {$('connection').textContent = 'Session needed'; $('session-dialog').showModal(); return;}
    await task(async () => {
      await refreshList();
      const requested = params.get('dossier');
      if (requested && state.dossiers.some(item => item.id === requested)) await openDossier(requested);
      else if (state.dossiers.length) await openDossier(state.dossiers[0].id);
      else render();
    });
  }
  start();
})();

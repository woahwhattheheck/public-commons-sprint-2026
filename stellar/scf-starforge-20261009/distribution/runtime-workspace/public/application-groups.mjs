// MIT. Industrial launch-group workflow over retained original Application requests.
import { createApplicationOutputReader } from './application-output.mjs';
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const query = (path, values) => path + '?' + new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== ''));
const displayTime = value => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value ?? '—') :
    parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
const facts = values => {
  const dl = make('dl', undefined, 'paths');
  for (const [label, value] of values) { const row = make('div'); row.append(make('dt', label), make('dd', String(value ?? '—'))); dl.append(row); }
  return dl;
};
const detail = (title, value) => {
  const node = make('details'); node.append(make('summary', title), make('pre', JSON.stringify(value, null, 2))); return node;
};
const observationUnavailable = operation => operation?.active === null || operation?.phase === 'OBSERVATION_UNAVAILABLE';
const groupObservationUnavailable = run => run?.phase === 'OBSERVATION_UNAVAILABLE' ||
  Boolean(run?.members?.some(member => observationUnavailable(member.operation)));
const operationLabel = phase => phase === 'OBSERVATION_UNAVAILABLE' ? 'STATUS UNAVAILABLE' : phase;
export function createApplicationGroupsView({ root, api, getState, openApplication, message, error }) {
  let scope = 0, navigation = 0, loading = false, refreshAgain = false, busy = false, workGeneration = 0;
  let workspaceId = null, selectedId = null, selectedRunId = null, data = null, applications = [], applicationsReadAt = 0;
  let review = null, cursor = null, cursorTrail = [], outputSelection = null, outputGeneration = 0, runSignature = '';
  let draft = { groupId: null, expectedRevision: null, label: '', applicationIds: [] }, dirty = false, draftRetained = true, choicePage = 0;
  root.classList.add('application-groups');
  const title = make('div', undefined, 'section-title');
  const heading = make('div'); heading.append(make('p', 'APPLICATIONS / LAUNCH GROUPS', 'eyebrow'), make('h2', 'Launch a saved group'));
  title.append(heading); root.append(title, make('p', 'Keep an ordered set of saved Applications, review its original inputs, and launch each member from the same retained group run.', 'note'));
  const pendingPanel = make('div', undefined, 'panel'), pendingText = make('p', undefined, 'note');
  const toolbar = make('div', undefined, 'actions'), selectorLabel = make('label', 'Saved group'), selector = make('select');
  selectorLabel.append(selector); root.append(selectorLabel, toolbar, pendingPanel);
  const editor = make('details'), editorSummary = make('summary', 'Create or edit a group'), editorFields = make('fieldset');
  const nameLabel = make('label', 'Group name'), name = make('input'); name.maxLength = 120; name.autocomplete = 'off'; nameLabel.append(name);
  const searchLabel = make('label', 'Find a saved Application'), search = make('input'); search.type = 'search'; search.placeholder = 'Name, kind, runtime or ID'; searchLabel.append(search);
  const choices = make('div', undefined, 'group-choices'), choiceSummary = make('p', undefined, 'note'), choiceControls = make('div', undefined, 'actions'),
    order = make('ol', undefined, 'group-order'), draftStatus = make('p', undefined, 'note'), editorActions = make('div', undefined, 'actions');
  editorFields.append(nameLabel, searchLabel, choiceSummary, choices, choiceControls, make('h3', 'Launch order'), order, draftStatus, editorActions);
  editor.append(editorSummary, editorFields); root.append(editor);
  const reviewPanel = make('section', undefined, 'panel'), reviewContent = make('div'), reviewActions = make('div', undefined, 'actions');
  reviewPanel.append(make('h3', 'Review the exact selection'), reviewContent, reviewActions); reviewPanel.hidden = true; root.append(reviewPanel);
  const runPanel = make('section', undefined, 'panel'), historyPanel = make('details'), historyContent = make('div');
  historyPanel.append(make('summary', 'Retained group runs'), historyContent); root.append(runPanel, historyPanel);
  const outputPanel = make('section', undefined, 'panel'), outputTitle = make('h3'), outputStatus = make('p', undefined, 'note'), outputText = make('pre');
  const outputReaderRoot = make('div');
  outputPanel.append(outputTitle, outputStatus, outputReaderRoot); outputPanel.hidden = true; root.append(outputPanel);
  const outputReader = createApplicationOutputReader({ root: outputReaderRoot, api,
    getWorkspaceId: () => getState()?.workspaceId, error, output: outputText });

  const stamp = () => ({ scope, workspaceId: getState()?.workspaceId, navigation });
  const current = own => scope === own.scope && getState()?.workspaceId === own.workspaceId && navigation === own.navigation;
  const key = suffix => 'starforge-application-groups-' + workspaceId + '-' + suffix;
  function read(suffix, storage = sessionStorage) { try { return JSON.parse(storage.getItem(key(suffix)) ?? 'null'); } catch { return null; } }
  function retain(suffix, value, storage = sessionStorage) {
    try { if (value === null) storage.removeItem(key(suffix)); else storage.setItem(key(suffix), JSON.stringify(value)); return true; } catch { return false; }
  }
  function preferences() { retain('selection', { selectedId, selectedRunId }, localStorage); }
  function saveDraft() { draftRetained = retain('draft', { ...draft, dirty }); return draftRetained; }
  function button(label, action, disabled = false) {
    const node = make('button', label); node.type = 'button'; node.disabled = disabled || busy;
    node.addEventListener('click', () => { if (!busy) Promise.resolve().then(action).catch(error); }); return node;
  }
  function initialize() {
    const id = getState()?.workspaceId;
    if (!id) return false;
    if (workspaceId === id) return true;
    workspaceId = id; data = null; applications = []; applicationsReadAt = 0; review = null; runSignature = '';
    const selected = read('selection', localStorage);
    selectedId = typeof selected?.selectedId === 'string' ? selected.selectedId : null;
    selectedRunId = typeof selected?.selectedRunId === 'string' ? selected.selectedRunId : null;
    const saved = read('draft');
    draft = saved && Array.isArray(saved.applicationIds) ? {
      groupId: saved.groupId ?? null, expectedRevision: saved.expectedRevision ?? null,
      label: typeof saved.label === 'string' ? saved.label : '',
      applicationIds: saved.applicationIds.filter(id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id)),
    } : { groupId: null, expectedRevision: null, label: '', applicationIds: [] };
    dirty = Boolean(saved?.dirty); draftRetained = Boolean(saved); choicePage = 0; name.value = draft.label; editor.open = dirty;
    return true;
  }
  function changed() { dirty = true; draft.label = name.value; saveDraft(); renderEditor(); }
  function renderEditor() {
    const needle = search.value.trim().toLocaleLowerCase(), selected = new Set(draft.applicationIds);
    const allMatches = applications.filter(item => [item.label, item.kind, item.runtime?.directory, item.id].join(' ').toLocaleLowerCase().includes(needle));
    const pageSize = 30, lastPage = Math.max(0, Math.ceil(allMatches.length / pageSize) - 1);
    choicePage = Math.min(choicePage, lastPage);
    const start = choicePage * pageSize, matches = allMatches.slice(start, start + pageSize);
    choiceSummary.textContent = allMatches.length ? 'Showing ' + (start + 1) + '–' + (start + matches.length) + ' of ' + allMatches.length + ' saved Applications' : '0 matching saved Applications';
    choiceControls.replaceChildren(button('Previous Applications page', () => { choicePage--; renderEditor(); }, choicePage === 0),
      button('Next Applications page', () => { choicePage++; renderEditor(); }, choicePage >= lastPage));
    choices.replaceChildren(...matches.map(item => {
      const row = make('div', undefined, 'group-choice');
      const label = make('div'); label.append(make('strong', item.label ?? item.id), make('small', (item.kind ?? 'Application') + ' · ' + item.id));
      row.append(label, button(selected.has(item.id) ? 'Added' : 'Add', () => {
        draft.applicationIds.push(item.id); changed();
      }, selected.has(item.id) || draft.applicationIds.length >= 32 || item.phase === 'UNAVAILABLE'));
      return row;
    }));
    if (!matches.length) choices.append(make('p', applications.length ? 'No saved Applications match this search.' : 'Save an Application from the Applications view before creating a group.', 'note'));
    order.replaceChildren(...draft.applicationIds.map((id, index) => {
      const row = make('li'), label = applications.find(item => item.id === id)?.label ?? id;
      const actions = make('div', undefined, 'actions');
      actions.append(button('Move up', () => { [draft.applicationIds[index - 1], draft.applicationIds[index]] = [id, draft.applicationIds[index - 1]]; changed(); }, index === 0),
        button('Move down', () => { [draft.applicationIds[index + 1], draft.applicationIds[index]] = [id, draft.applicationIds[index + 1]]; changed(); }, index === draft.applicationIds.length - 1),
        button('Remove', () => { draft.applicationIds.splice(index, 1); changed(); }));
      row.append(make('strong', label), make('small', id), actions); return row;
    }));
    draftStatus.textContent = draft.applicationIds.length + ' / 32 members' + (dirty ? draftRetained ? ' · Unsaved draft retained in this browser' : ' · Unsaved changes; browser storage is unavailable' : draft.groupId ? ' · Saved selection' : '');
    editorActions.replaceChildren(button(draft.groupId ? 'Save changes' : 'Save group', async () => {
      await mutate('/api/application-groups/save', { requestId: crypto.randomUUID(), ...draft }, 'Save group');
    }, !draft.label.trim() || !draft.applicationIds.length), button('Discard draft', () => {
      draft = { groupId: null, expectedRevision: null, label: '', applicationIds: [] }; dirty = false; name.value = ''; saveDraft(); renderEditor();
    }, !dirty && !draft.groupId && !draft.applicationIds.length), button('Refresh saved Applications', async () => { applicationsReadAt = 0; await refresh(); }));
    editorFields.disabled = busy;
  }
  function loadEditor(value = null) {
    if (dirty) { message('Save or discard the current group draft before opening another selection.'); editor.open = true; return; }
    draft = value ? { groupId: value.id, expectedRevision: value.revision, label: value.label, applicationIds: [...value.applicationIds] } :
      { groupId: null, expectedRevision: null, label: '', applicationIds: [] };
    name.value = draft.label; dirty = false; saveDraft(); editor.open = true; renderEditor(); name.focus();
  }
  name.addEventListener('input', changed); search.addEventListener('input', () => { choicePage = 0; renderEditor(); });
  selector.addEventListener('change', () => {
    selectedId = selector.value || null; selectedRunId = null; cursor = null; cursorTrail = []; navigation++; review = null;
    outputSelection = null; outputPanel.hidden = true; outputGeneration++; preferences(); refresh().catch(error);
  });
  async function work(action) {
    if (busy) return;
    const generation = ++workGeneration, ownScope = scope;
    busy = true; root.setAttribute('aria-busy', 'true'); render();
    try { return await action(); }
    finally {
      if (scope === ownScope && workGeneration === generation) {
        busy = false; root.setAttribute('aria-busy', 'false'); render();
      }
    }
  }
  async function mutate(path, body, label, recovery = false) {
    const own = stamp();
    return work(async () => {
      const pending = { path, body, label };
      if (!recovery && read('pending')) throw new Error('Recover the saved group request before starting another change.');
      if (!recovery && !retain('pending', pending)) throw new Error('This browser could not retain the exact group request. Enable session storage before starting or saving a group.');
      renderPending();
      try {
        const result = await api(path, body);
        if (!current(own)) return;
        retain('pending', null);
        if (path.endsWith('/save')) {
          selectedId = result.id; selectedRunId = null;
          draft = { groupId: result.id, expectedRevision: result.revision, label: result.label, applicationIds: [...result.applicationIds] };
          dirty = false; name.value = result.label; editor.open = false; saveDraft();
        } else if (result.groupId && result.id) { selectedId = result.groupId; selectedRunId = result.id; }
        navigation++; review = null; runSignature = ''; preferences(); message(label + ' retained.'); await refresh();
      } catch (failure) {
        if (current(own) && failure.status >= 400 && failure.status < 500) retain('pending', null);
        throw failure;
      }
    });
  }
  function renderPending() {
    const pending = read('pending'); pendingPanel.hidden = !pending;
    pendingText.textContent = pending ? 'The exact ' + pending.label.toLowerCase() + ' request is saved. Reopen it to reconcile a missing response.' : '';
    pendingPanel.replaceChildren(pendingText);
    if (pending) pendingPanel.append(button('Recover saved request', () => mutate(pending.path, pending.body, pending.label, true)));
  }
  function reviewObservationUnavailable(value = review) {
    const run = data?.selected?.run;
    if (groupObservationUnavailable(run)) return true;
    return Boolean(value?.members?.some(member => {
      const application = applications.find(item => item.id === member.applicationId);
      return application?.phase === 'UNAVAILABLE' || observationUnavailable(application?.adoption) ||
        observationUnavailable(application?.current);
    }));
  }
  function canUseReview(value = review) {
    return Boolean(value?.ready && value.id && value === review && !reviewObservationUnavailable(value) &&
      value.groupId === selectedId && (!value.runId || value.runId === data?.selected?.run?.id));
  }
  function canContinueRun(run) {
    const currentRun = data?.selected?.run;
    return Boolean(run && currentRun?.id === run.id && currentRun.version === run.version &&
      currentRun.canContinue && !groupObservationUnavailable(currentRun));
  }
  async function requestReview(forRun) {
    if (groupObservationUnavailable(data?.selected?.run))
      throw new Error('Refresh this group to observe its original operations before reviewing another launch.');
    const own = stamp();
    await work(async () => {
      const value = await api('/api/application-groups/review', { groupId: selectedId, ...(forRun ? { runId: forRun.id } : {}) });
      if (!current(own)) return;
      review = value; renderReview(); reviewPanel.scrollIntoView({ block: 'nearest' });
    });
  }
  function renderReview() {
    reviewPanel.hidden = !review;
    if (!review) return;
    reviewContent.replaceChildren(make('p', review.runId ? 'Review only the remaining members. Already launched members keep their original requests and output.' : 'This selection will start in the order below.', 'note'));
    for (const [index, member] of review.members.entries()) {
      const section = make('div', undefined, 'group-review-member');
      section.append(make('h3', (index + 1) + '. ' + (member.label ?? member.applicationId)));
      if (member.error) section.append(make('p', member.error.code + ': ' + member.error.message, 'message'));
      else {
        section.append(facts([['Application', member.applicationId], ['Saved revision', member.applicationRevision],
          ['Runtime', member.review.runtime.directory], ['Managed home', member.review.homeId], ['Release', member.review.releaseId],
          ['Release digest', member.review.releaseDigest], ['Original command', member.review.command.command ?? member.kind]]),
          detail('Exact original review, inputs and provider source', member.review));
      }
      reviewContent.append(section);
    }
    if (reviewObservationUnavailable()) reviewContent.append(make('p',
      'Process status is unavailable for this selection. The retained review is still available; refresh the group before starting or continuing it.', 'note'));
    if (review.overlaps?.length) reviewContent.append(make('p', 'Some members share an original workspace. The group waits for the earlier operation to finish before starting the next member that uses it.', 'note'));
    reviewActions.replaceChildren(button(review.runId ? 'Use reviewed remaining members' : 'Start reviewed group', () => {
      if (!canUseReview()) throw new Error('Refresh this group and confirm its process status before using the retained review.');
      if (review.runId) return mutate('/api/application-groups/apply-review', { groupId: review.groupId,
        runId: review.runId, reviewId: review.id, expectedVersion: review.runVersion }, 'Remaining review');
      return mutate('/api/application-groups/start', { groupId: review.groupId, requestId: crypto.randomUUID(), reviewId: review.id }, 'Group start');
    }, !canUseReview()), button('Close review', () => { review = null; renderReview(); }));
  }
  function renderRun() {
    const selected = data?.selected, run = selected?.run;
    const signature = JSON.stringify([selected?.id, run, busy]);
    if (signature === runSignature) return; runSignature = signature;
    runPanel.replaceChildren();
    if (!selected) { runPanel.append(make('p', 'Create a group or choose a saved group to begin.', 'note')); return; }
    runPanel.append(make('h3', selected.label), facts([['Group', selected.id], ['Saved revision', selected.revision], ['Ordered members', selected.applicationIds.length]]));
    const actions = make('div', undefined, 'actions');
    actions.append(button('Review a new run', () => requestReview(null), groupObservationUnavailable(run)),
      button('Edit selection', () => loadEditor(selected)));
    runPanel.append(actions);
    if (!run) { runPanel.append(make('p', 'Review this group to start its first retained run.', 'note')); return; }
    const runHeading = make('div', undefined, 'section-title'); runHeading.append(make('h3', 'Current selection: ' + run.label), make('span', operationLabel(run.phase), 'status')); runPanel.append(runHeading);
    runPanel.append(facts([['Group run', run.id], ['Progress', run.started + ' of ' + run.total + ' original operations retained'],
      ['Created', displayTime(run.createdAt)], ['Progress version', run.version]]),
      detail('Exact run dates', { createdAt: run.createdAt, updatedAt: run.updatedAt }));
    if (groupObservationUnavailable(run)) runPanel.append(make('p',
      'The current process status could not be observed. This group is not marked finished and Continue remains disabled. Its saved selection, original requests and retained output are still available below. Refresh group to observe it again.', 'note'));
    if (run.groupRevision !== selected.revision) runPanel.append(make('p', 'This run retains an earlier saved selection. Its member order and original operations remain available below.', 'note'));
    if (run.waitingApplicationId) runPanel.append(make('p', 'Waiting on ' + (run.members.find(item => item.applicationId === run.waitingApplicationId)?.label ?? run.waitingApplicationId) + '. Open its output, recover its original request, or accept its final result before continuing.', 'note'));
    const controls = make('div', undefined, 'actions'), next = run.members.find(item => item.applicationId === run.nextApplicationId);
    controls.append(button(next ? 'Continue: ' + next.label : 'All members retained', () => {
      if (!canContinueRun(run) || !next) throw new Error('Refresh the group before continuing its original run.');
      return mutate('/api/application-groups/continue', {
        groupId: selected.id, runId: run.id, applicationId: next.applicationId, expectedVersion: run.version,
      }, 'Group continuation');
    }, !canContinueRun(run)),
    button('Review remaining members', () => requestReview(run), !next || Boolean(run.stopRequestedAt) || groupObservationUnavailable(run)),
    button(run.stopRequestedAt ? 'Retry stopping group' : 'Stop group', () => mutate('/api/application-groups/stop', {
      groupId: selected.id, runId: run.id,
    }, 'Group stop'), run.phase === 'STOPPED'));
    runPanel.append(controls, make('p', 'Continue starts one member in order. Stop group ends this sequence and requests a stop for its retained original operations.', 'note'));
    const rows = make('ol', undefined, 'group-run-members');
    for (const member of run.members) {
      const row = make('li'), operation = member.operation;
      const phase = member.operationPhase ?? operation?.phase ?? (run.stopRequestedAt ? 'NOT STARTED' : member.error ? 'NEEDS ATTENTION' : 'REVIEWED');
      const head = make('div', undefined, 'section-title'); head.append(make('strong', member.label), make('span', operationLabel(observationUnavailable(operation) ? 'OBSERVATION_UNAVAILABLE' : phase), 'status')); row.append(head);
      row.append(facts([['Application', member.applicationId], ['Saved revision', member.applicationRevision], ['Original request', member.operationId]]));
      if (observationUnavailable(operation)) {
        row.append(make('p', 'Process status is unavailable. The saved operation and output remain accessible; it has not been treated as stopped or completed.', 'note'));
        if (operation.observation?.error) row.append(make('p',
          operation.observation.error.code + ': ' + operation.observation.error.message, 'note'));
      }
      if (member.error) row.append(make('p', member.error.code + ': ' + member.error.message, 'message'));
      if (operation?.result ?? operation?.state?.result ?? operation?.state?.error)
        row.append(detail('Original operation result', operation.result ?? operation.state?.result ?? operation.state?.error));
      if (member.stopError) row.append(make('p', member.stopError.code + ': ' + member.stopError.message, 'message'));
      if (member.acceptedOutcome) row.append(make('p', 'The operator accepted this ' + member.acceptedOutcome.phase.toLowerCase() + ' outcome before continuing.', 'note'));
      if (member.launchHomeRevision && member.launchHomeRevision !== member.approvedHomeRevision)
        row.append(make('p', 'The original home revision was refreshed at launch; the approved source, release, inputs and command were retained.', 'note'));
      const memberActions = make('div', undefined, 'actions');
      memberActions.append(button('Open Application', () => openApplication(member.applicationId)));
      if (operation) {
        memberActions.append(button('Original output', () => showOutput(member)),
          button('Recover original request', () => mutate('/api/application-groups/member', {
            groupId: selected.id, runId: run.id, applicationId: member.applicationId, action: 'recover',
          }, 'Member recovery'), Boolean(run.stopRequestedAt) || operation.active !== false || !['PENDING', 'QUEUED', 'INTERRUPTED', 'FAILED'].includes(operation.phase)),
          button('Stop member', () => mutate('/api/application-groups/member', {
            groupId: selected.id, runId: run.id, applicationId: member.applicationId, action: 'stop',
          }, 'Member stop'), !operation.active && !['PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED'].includes(operation.phase)));
        if (operation.active === false && ['FAILED', 'CANCELLED', 'RECONCILED', 'OUTCOME_UNAVAILABLE'].includes(phase) && !run.stopRequestedAt)
          memberActions.append(button('Accept result; allow next', () => mutate('/api/application-groups/member', {
            groupId: selected.id, runId: run.id, applicationId: member.applicationId, action: 'accept-result', expectedVersion: run.version,
          }, 'Accepted member result')));
      }
      row.append(memberActions, detail('Retained member review and launch reference', { approved: member.approved,
        approvedReviewId: member.approvedReviewId, launchReviewId: member.launchReviewId ?? null,
        homeRevision: member.launchHomeRevision ?? member.approvedHomeRevision }));
      rows.append(row);
    }
    runPanel.append(rows);
  }
  function renderHistory() {
    const selected = data?.selected; historyPanel.hidden = !selected;
    if (!selected) return;
    const history = selected.history;
    historyContent.replaceChildren(make('p', history.total + ' retained group runs', 'note'));
    for (const run of history.items) {
      const item = button(
        (run.id === selected.run?.id ? 'Selected · ' : '') + displayTime(run.createdAt) + ' · ' + run.label + ' · ' + run.id,
        () => {
          selectedRunId = run.id; navigation++; review = null; outputSelection = null; outputPanel.hidden = true; outputGeneration++;
          preferences(); refresh().catch(error);
        });
      item.setAttribute('data-created-at', run.createdAt);
      item.title = 'Created ' + run.createdAt;
      historyContent.append(item);
    }
    const controls = make('div', undefined, 'actions');
    controls.append(button('Previous runs page', () => { cursor = cursorTrail.pop() ?? null; navigation++; refresh().catch(error); }, !cursorTrail.length),
      button('Older runs', () => { cursorTrail.push(cursor); cursor = history.nextCursor; navigation++; refresh().catch(error); }, !history.nextCursor),
      button('Latest group run', () => { selectedRunId = null; cursor = null; cursorTrail = []; navigation++; review = null; outputSelection = null; outputGeneration++; outputPanel.hidden = true; preferences(); refresh().catch(error); }));
    historyContent.append(controls);
  }
  async function showOutput(member) {
    outputSelection = { applicationId: member.applicationId, operationId: member.operationId, label: member.label };
    outputGeneration++; await refreshOutput(); outputPanel.scrollIntoView({ block: 'nearest' });
  }
  async function refreshOutput() {
    if (!outputSelection) return;
    const selected = outputSelection, own = stamp(), generation = outputGeneration;
    const result = await api(query('/api/applications/output', { applicationId: selected.applicationId, operationId: selected.operationId }));
    if (!current(own) || generation !== outputGeneration || outputSelection !== selected) return;
    outputPanel.hidden = false; outputTitle.textContent = selected.label + ' — original output';
    const unavailable = result.output.available === false;
    outputStatus.textContent = operationLabel(result.phase) + ' · ' + selected.operationId + (unavailable
      ? result.output.state === 'NOT_CREATED' ? ' · worker output has not been created yet' : ' · retained output is currently unavailable'
      : ' · ' + result.output.offset + '–' + result.output.totalBytes + ' bytes');
    await outputReader.update({ applicationId: selected.applicationId, operationId: selected.operationId });
  }
  function render() {
    if (!workspaceId) return;
    selector.replaceChildren(new Option('Choose a saved group', ''), ...(data?.groups ?? []).map(item => new Option(item.label + ' · ' + item.applicationIds.length + ' members', item.id)));
    selector.value = selectedId ?? ''; selector.disabled = busy;
    toolbar.replaceChildren(button('Create group', () => loadEditor()), button('Refresh group', async () => { applicationsReadAt = 0; await refresh(); }));
    renderPending(); renderEditor(); renderReview(); renderRun(); renderHistory();
  }
  async function refresh() {
    if (!initialize()) return;
    if (loading) { refreshAgain = true; return; }
    loading = true; const own = stamp();
    try {
      const readApps = !applicationsReadAt || Date.now() - applicationsReadAt > 60000;
      const results = await Promise.all([api(query('/api/application-groups/state', {
        groupId: selectedId, runId: selectedRunId, limit: 10, cursor,
      })), readApps ? api('/api/applications/state?historyLimit=1') : null]);
      if (!current(own)) { refreshAgain = true; return; }
      data = results[0];
      if (results[1]) { applications = results[1].applications; applicationsReadAt = Date.now(); }
      if (!selectedId && data.groups.length) {
        selectedId = data.groups[0].id; preferences();
        data = await api(query('/api/application-groups/state', { groupId: selectedId, limit: 10 }));
        if (!current(own)) { refreshAgain = true; return; }
      }
      render(); await refreshOutput();
    } finally {
      loading = false;
      if (refreshAgain) { refreshAgain = false; await refresh(); }
    }
  }
  return {
    refresh,
    reset() {
      scope++; navigation++; workGeneration++; workspaceId = null; selectedId = selectedRunId = null; data = null; review = null;
      cursor = null; cursorTrail = []; applications = []; applicationsReadAt = 0; runSignature = '';
      outputSelection = null; outputGeneration++; outputReader.reset(); outputPanel.hidden = reviewPanel.hidden = true;
      busy = false; draft = { groupId: null, expectedRevision: null, label: '', applicationIds: [] }; dirty = false; draftRetained = true; choicePage = 0; name.value = '';
    },
  };
}

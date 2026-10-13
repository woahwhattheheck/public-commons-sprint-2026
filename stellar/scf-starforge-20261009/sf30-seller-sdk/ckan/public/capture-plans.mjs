// MIT. Fresh scheduled DataStore acquisitions through the original workbench owner.
import { parseDcatJsonText, stringifyDcatJson } from './dcat-json.mjs';
const sessions = new Map();
const pretty = value => stringifyDcatJson(value, null, 2);
const clone = value => parseDcatJsonText(stringifyDcatJson(value));
const uuid = () => crypto.randomUUID();
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (['disabled', 'selected', 'checked'].includes(key)) node[key] = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
const card = (...children) => el('div', {class: 'card'}, ...children);
const row = (...children) => el('div', {class: 'row'}, ...children);
const muted = text => el('p', {class: 'muted'}, text);
const label = (text, field) => el('label', {class: 'grow'}, text, field);
const details = (text, value) => el('details', {}, el('summary', {}, text), el('pre', {}, pretty(value)));
const input = (value = '', attrs = {}) => el('input', {value, type: 'text', ...attrs});
const select = (items, value) => el('select', {}, items.map(([key, text]) =>
  el('option', {value: key, selected: key === value}, text)));
const grid = (rows, columns) => el('div', {class: 'table-wrap'}, el('table', {},
  el('thead', {}, el('tr', {}, columns.map(([title]) => el('th', {}, title)))),
  el('tbody', {}, rows.map(item => el('tr', {}, columns.map(([, value]) => el('td', {}, value(item))))))));
function retainedSession(directory) {
  const key = 'ckan-capture-plans:' + directory;
  if (!sessions.has(key)) {
    let saved;
    try { saved = parseDcatJsonText(sessionStorage.getItem(key) ?? 'null'); } catch {}
    sessions.set(key, saved && typeof saved === 'object' && !Array.isArray(saved)
      ? saved : {selectedPlan: null, selectedRun: null, offset: 0, previousOffsets: [], editor: null, manual: null});
  }
  const draft = sessions.get(key);
  const persist = () => {
    try { sessionStorage.setItem(key, pretty(draft)); draft.storageError = null; }
    catch { draft.storageError = 'This browser could not save the working draft. Download it before closing this window.'; }
  };
  return {draft, persist};
}
function defaultConfig(state, last) {
  const selection = last?.selection ? clone(last.selection) :
    {catalogOrigin: state.catalogOrigin, packageId: '', resourceId: '', filters: {}, q: '',
      pagination: 'offset', pageSize: 1000, timeoutMs: 30000, maxResponseBytes: 16777216,
      ...(state.authTokenEnv ? {authTokenEnv: state.authTokenEnv} : {})};
  return {label: 'New upstream acquisition', enabled: true, selection,
    limits: {maxRows: last?.limits?.maxRows ?? 250000, maxBytes: last?.limits?.maxBytes ?? 268435456},
    cadence: {anchorAt: new Date().toISOString(), intervalMinutes: 1440},
    period: {kind: 'none'}, comparisonKeys: ['_id']};
}
function downloadValue(value, name) {
  const url = URL.createObjectURL(new Blob([pretty(value) + '\n'], {type: 'application/json'}));
  const link = el('a', {href: url, download: name}); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function renderCapturePlans(ctx) {
  const {view, state} = ctx, {draft, persist} = retainedSession(state.directory);
  const button = (text, action, primary = false, disabled = false) => el('button', {
    type: 'button', class: primary ? 'primary' : '', disabled,
    onclick: () => ctx.protect(action),
  }, text);
  const api = async (path, value) => {
    const response = await fetch('/api/' + path, {method: value === undefined ? 'GET' : 'POST',
      headers: {authorization: 'Bearer ' + ctx.token, ...(value === undefined ? {} : {'content-type': 'application/json'})},
      ...(value === undefined ? {} : {body: stringifyDcatJson(value)})});
    const answer = parseDcatJsonText(await response.text());
    if (!response.ok) { const error = new Error(answer.message ?? 'The original acquisition request did not complete.'); error.code = answer.error; error.status = response.status; throw error; }
    return answer;
  };
  const mutate = async (path, value) => {
    const result = await api(path, value);
    ctx.acceptOperation(result);
    if (result.planId) draft.selectedPlan = result.planId;
    if (result.runId) {
      draft.selectedRun = result.runId;
      draft.runOperation = {runId: result.runId, operationId: result.operationId};
    }
    persist();
    await ctx.refresh();
    return result;
  };
  const current = () => ctx.current();
  view.append(el('h2', {}, 'Fresh upstream capture plans'),
    muted('Receive a new complete DataStore selection for each retained period. Review and publication continue through the original saved-source workflow.'),
    row(button('Refresh plans and runs', () => ctx.refresh()),
      button('Download complete acquisition guide', () => ctx.download('capture-plans/guide', 'CAPTURE_PLANS.md')),
      button('Open complete workspace handover', () => ctx.openWorkspace())));
  if (draft.storageError) view.append(muted(draft.storageError));
  const plans = state.capturePlans?.plans ?? [];
  const due = await api('capture-plans/due');
  if (!current()) return;
  view.append(card(el('h3', {}, 'Periods due through this owner'),
    muted('Each row binds one saved plan version and one original slot. The existing host scheduler can use the same list; this page does not start a background timer.'),
    due.runs?.length ? grid(due.runs, [
      ['Plan', item => item.label],
      ['Original slot (UTC)', item => item.scheduledFor],
      ['Run identity', item => item.id],
      ['Earlier incomplete runs', item => (item.previousIncompleteRuns ?? []).map(run => run.scheduledFor + ' · ' + run.state).join('\n')],
      ['Action', item => button('Acquire this due period', async () => {
        draft.selectedPlan = item.planId; draft.selectedRun = item.id; persist();
        await mutate('capture-plans/run', {id: item.id, planId: item.planId,
          expectedPlanSha256: item.expectedPlanSha256, scheduledFor: item.scheduledFor, kind: 'scheduled'});
      }, true, !!state.active)],
    ]) : muted('No enabled plan is currently due. Paused plans and future or provider-deferred periods remain in the saved plan list.')));
  const newPlan = async () => {
    const retained = [...state.editions].reverse().find(item => item.state === 'COMPLETE');
    // Read the original typed manifest: status() deliberately clones its
    // presentation state and is not the exact-number source configuration.
    const edition = retained ? await api('editions/' + retained.id) : null;
    if (!current()) return;
    const original = edition?.source?.selection ? {selection: edition.source.selection, limits: retained.limits} : null;
    draft.editor = {id: uuid(), expectedPlanSha256: null, text: pretty(defaultConfig(state, original)),
      scheduledFor: new Date().toISOString(), preview: null};
    persist(); return ctx.render();
  };
  view.append(card(el('h3', {}, 'Saved acquisition plans'),
    button('Create a complete capture plan', newPlan, true),
    plans.length ? grid(plans, [
      ['Plan', item => item.label],
      ['Enabled', item => item.enabled ? 'Yes' : 'Paused'],
      ['Next slot (UTC)', item => item.nextDueAt ?? '—'],
      ['Provider retry after', item => item.retryNotBefore ?? '—'],
      ['Action', item => button('Open plan and complete history', async () => {
        draft.selectedPlan = item.id; draft.selectedRun = null; draft.offset = 0; draft.previousOffsets = [];
        persist(); await ctx.render();
      })],
    ]) : muted('Create a plan from a retained capture selection or enter the original catalogue, package and resource.')));
  let selected;
  if (draft.selectedPlan && plans.some(item => item.id === draft.selectedPlan)) {
    const selectedId = draft.selectedPlan, offset = draft.offset ?? 0;
    selected = await api('capture-plans/' + selectedId + '?' + new URLSearchParams({offset, limit: 25}));
    if (!current() || selectedId !== draft.selectedPlan || offset !== (draft.offset ?? 0)) return;
    if (draft.editor?.id === selected.id && draft.editor.preview?.planSha256 === selected.planSha256) {
      draft.editor.expectedPlanSha256 = selected.planSha256; persist();
    }
    view.append(card(row(el('h3', {class: 'grow'}, selected.config.label),
      el('span', {class: 'pill'}, selected.config.enabled ? 'Enabled' : 'Paused')),
      details('Complete saved source, cadence, period and capture limits', selected.config),
      details('Original configuration versions and selections', {planSha256: selected.planSha256,
        acquisitionSha256: selected.acquisitionSha256, versions: selected.versions, selections: selected.selections}),
      row(button('Edit this inspected plan version', () => {
        draft.editor = {id: selected.id, expectedPlanSha256: selected.planSha256,
          text: pretty(selected.config), scheduledFor: new Date().toISOString(), preview: null};
        persist(); return ctx.render();
      }), button('Download inspected plan version', () => ctx.download('capture-plans/' + selected.id +
        '/file?sha256=' + encodeURIComponent(selected.planSha256), 'capture-plan-' + selected.id + '.json')))));
  }
  if (draft.editor) {
    const editor = draft.editor;
    const configText = el('textarea', {rows: '18', spellcheck: 'false', 'aria-label': 'Complete capture plan configuration'}, editor.text);
    const slot = input(editor.scheduledFor, {'aria-label': 'Preview slot in UTC', required: ''});
    const previewArea = el('div');
    const showPreview = () => {
      previewArea.replaceChildren(editor.preview ? details('Exact resolved period, filters and query', editor.preview) :
        muted('Preview resolves the complete source selection for this exact slot before saving.'));
    };
    const edited = () => {
      editor.text = configText.value; editor.scheduledFor = slot.value; editor.preview = null; persist(); showPreview();
    };
    configText.addEventListener('input', edited); slot.addEventListener('input', edited);
    showPreview();
    view.append(card(el('h3', {}, editor.expectedPlanSha256 ? 'Edit saved capture plan' : 'New capture plan'),
      muted('The full selection includes the original resource, query, filters, pagination, token environment reference and response limits. A UTC-day period can replace {{period.date}}, {{period.start}} and {{period.end}} inside filter/query string values.'),
      label('Complete capture plan configuration', configText), label('Preview slot in UTC', slot),
      row(button('Preview exact upstream selection', async () => {
        const submitted = editor.text, scheduledFor = editor.scheduledFor;
        const result = await api('capture-plans/preview', {config: parseDcatJsonText(submitted), scheduledFor});
        if (!current() || draft.editor !== editor || editor.text !== submitted || editor.scheduledFor !== scheduledFor) return;
        editor.preview = result; persist(); showPreview();
      }, false, !!state.active),
      button('Save this plan version', async () => {
        if (!editor.preview) throw new Error('Preview this unchanged configuration and slot before saving.');
        const body = {id: editor.id, expectedPlanSha256: editor.expectedPlanSha256, config: parseDcatJsonText(editor.text)};
        if (draft.selectedPlan !== editor.id) { draft.selectedRun = null; draft.manual = null; }
        draft.selectedPlan = editor.id; draft.offset = 0; draft.previousOffsets = []; persist();
        await mutate('capture-plans/save', body);
      }, true, !!state.active),
      button('Download complete working draft', () => downloadValue({schema: 'stellar-forge.ckan-capture-plan-draft.v1', ...editor},
        'capture-plan-draft-' + editor.id + '.json')),
      button('Close editor', () => { draft.editor = null; persist(); return ctx.render(); })), previewArea));
  }
  if (!selected) return;
  const selectedRunId = draft.selectedRun;
  view.append(card(el('h3', {}, 'Complete acquisition history'),
    muted(selected.total + ' original runs. This page shows ' + selected.runs.length + ' from offset ' + selected.offset + '.'),
    selected.runs.length ? grid(selected.runs, [
      ['Original slot', item => item.scheduledFor],
      ['State', item => item.state],
      ['Kind', item => item.kind],
      ['Edition', item => item.editionId ?? '—'],
      ['Action', item => button('Inspect original run', () => {
        draft.selectedRun = item.id; persist(); return ctx.render();
      })],
    ]) : muted('This saved plan has no retained acquisitions yet.'),
    row(button('Previous history page', () => {
      draft.offset = draft.previousOffsets.pop() ?? 0; persist(); return ctx.render();
    }, false, !draft.previousOffsets?.length),
    button('Next history page', () => {
      draft.previousOffsets ??= []; draft.previousOffsets.push(selected.offset);
      draft.offset = selected.next; persist(); return ctx.render();
    }, false, selected.next === null || selected.next === undefined))));
  if (!draft.manual || draft.manual.planId !== selected.id || draft.manual.expectedPlanSha256 !== selected.planSha256)
    draft.manual = {id: uuid(), planId: selected.id, expectedPlanSha256: selected.planSha256,
      scheduledFor: new Date().toISOString(), kind: 'manual'};
  const manual = draft.manual, manualSlot = input(manual.scheduledFor, {'aria-label': 'Manual capture slot in UTC'});
  manualSlot.addEventListener('input', () => {
    manual.scheduledFor = manualSlot.value; manual.id = uuid(); manual.preview = null; persist();
  });
  const manualPreview = el('div');
  const showManual = () => manualPreview.replaceChildren(manual.preview ?
    details('Manual run source selection', manual.preview) : muted('Preview the exact original period before acquiring it.'));
  showManual();
  view.append(card(el('h3', {}, 'Acquire an explicit period'),
    muted('A manual run retains its own ID and selected UTC instant. Reusing it continues that same period. For a later fresh acquisition, explicitly allocate another run.'),
    label('Manual capture slot in UTC', manualSlot),
    row(button('Preview manual period', async () => {
      const scheduledFor = manual.scheduledFor, id = manual.id;
      const result = await api('capture-plans/preview', {config: selected.config, scheduledFor});
      if (!current() || draft.manual !== manual || manual.scheduledFor !== scheduledFor || manual.id !== id) return;
      manual.preview = result; persist(); showManual();
    }), button('Acquire or recover this exact manual run', async () => {
      if (!manual.preview) throw new Error('Preview this unchanged manual period before acquiring it.');
      draft.selectedRun = manual.id; persist();
      await mutate('capture-plans/run', {id: manual.id, planId: manual.planId,
        expectedPlanSha256: manual.expectedPlanSha256, scheduledFor: manual.scheduledFor, kind: 'manual'});
    }, true, !!state.active),
    button('Start a new manual acquisition', () => {
      draft.manual = null; persist(); return ctx.render();
    }, false, !!state.active)), manualPreview));
  persist();
  if (!selectedRunId) return;
  let run;
  try { run = await api('capture-plan-runs/' + selectedRunId); }
  catch (error) {
    if (error.status !== 404 || draft.runOperation?.runId !== selectedRunId ||
        state.active !== draft.runOperation.operationId) throw error;
    view.append(card(el('h3', {}, 'Acquisition accepted by the original owner'),
      muted('The original operation is retaining this run. Follow its operation status; the saved period and edition will appear here.')));
    return;
  }
  if (!current() || draft.selectedRun !== selectedRunId) return;
  if (run.intent.planId !== selected.id) { draft.selectedRun = null; persist(); return; }
  view.append(card(row(el('h3', {class: 'grow'}, 'Original acquisition ' + run.id), el('span', {class: 'pill'}, run.state)),
    details('Retained period, source selection and capture outcome', run),
    row(button('Download full original run', () => ctx.download('capture-plan-runs/' + run.id + '/file', 'capture-run-' + run.id + '.json')),
      run.editionId ? button('Open retained edition and field dictionary', () => ctx.openEdition(run.editionId)) : null,
      ['FAILED', 'INTERRUPTED', 'COLLECTING'].includes(run.state) ? button('Resume the same source acquisition', () =>
        mutate('capture-plan-runs/' + run.id + '/resume', {expectedIntentSha256: run.intentSha256}), true, !!state.active) : null)));
  if (run.state !== 'COMPLETE') return;
  const edition = state.editions.find(item => item.id === run.editionId);
  const sources = state.sources.filter(source => !source.withdrawal &&
    state.editions.find(item => item.id === source.editionId)?.resourceId === edition?.resourceId);
  if (!sources.length) {
    view.append(card(el('h3', {}, 'Select the initial source fields'),
      muted('Open the complete received edition, inspect its dictionary and save its field selection. A following acquisition can then prepare the full reviewed comparison.'),
      button('Open this complete edition', () => ctx.openEdition(run.editionId), true)));
    return;
  }
  const sourceChoice = select(sources.map(source => [source.id, source.title + ' · ' + source.id]), sources.at(-1).id);
  const previousChoice = select([['', 'No previous published version']], '');
  const keys = input(selected.config.comparisonKeys.join(', '), {'aria-label': 'Original comparison key fields'});
  const updatePrevious = () => {
    const previous = previousChoice.value;
    previousChoice.replaceChildren(el('option', {value: ''}, 'No previous published version'),
      state.publications.filter(item => item.sourceId === sourceChoice.value && item.state === 'PUBLISHED').map(item =>
        el('option', {value: item.id, selected: item.id === previous}, item.title + ' · ' + item.createdAt)));
  };
  sourceChoice.addEventListener('change', updatePrevious); updatePrevious();
  view.append(card(el('h3', {}, 'Continue into the existing reviewed refresh'),
    row(label('Original reviewed source selection', sourceChoice), label('Original comparison key fields', keys)),
    label('Previous published edition', previousChoice),
    muted('This prepares the complete comparison and original review. It leaves acceptance and publication to the existing operator decisions.'),
    button('Prepare the full source refresh', async () => {
      const source = sources.find(item => item.id === sourceChoice.value);
      await mutate('capture-plan-runs/' + run.id + '/refresh', {
        expectedIntentSha256: run.intentSha256, sourceId: source.id, expectedSourceSha256: source.sha256,
        keys: keys.value.split(',').map(item => item.trim()).filter(Boolean),
        ...(previousChoice.value ? {previousPublicationId: previousChoice.value} : {}),
      });
    }, true, !!state.active),
    ...(run.refreshes ?? []).map(item => button('Open original refresh ' + item.id + ' · ' + item.state, () => ctx.openRefresh(item.id)))));
}

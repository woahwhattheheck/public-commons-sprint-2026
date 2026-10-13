// MIT. Operated remote CKAN publication in the original local workbench.
import { parseDcatJsonText, stringifyDcatJson } from './dcat-json.mjs';
const drafts = new Map();
const pretty = value => stringifyDcatJson(value, null, 2);
const clone = value => parseDcatJsonText(stringifyDcatJson(value));
const id = () => crypto.randomUUID();
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (['disabled', 'checked', 'selected'].includes(key)) node[key] = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
const muted = text => el('p', { class: 'muted' }, text);
const card = (...children) => el('div', { class: 'card' }, ...children);
const row = (...children) => el('div', { class: 'row' }, ...children);
const detail = (title, value) => el('details', {}, el('summary', {}, title), el('pre', {}, pretty(value)));
const field = (name, value = '', type = 'text', attrs = {}) => el('input', { name, value, type, ...attrs });
const label = (text, input, grow = false) => el('label', { class: grow ? 'grow' : '' }, text, input);
function select(name, items, current) {
  return el('select', { name }, items.map(([value, title]) => el('option', { value, selected: value === current }, title)));
}
function table(rows, columns) {
  if (!rows.length) return muted('No retained items.');
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, columns.map(([key, title]) => el('th', {}, title)))),
    el('tbody', {}, rows.map(item => el('tr', {}, columns.map(([key]) => el('td', {},
      item[key] instanceof Node ? item[key] : item[key] === undefined ? '' :
        typeof item[key] === 'object' ? pretty(item[key]) : String(item[key]))))))));
}
function stateFor(project) {
  const key = 'ckan-remote-publication:' + project;
  if (!drafts.has(key)) {
    let restored = {};
    try {
      const candidate = JSON.parse(sessionStorage.getItem(key) ?? '{}');
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) &&
          typeof candidate.publicationText === 'string' && candidate.target && typeof candidate.target.id === 'string') restored = candidate;
    } catch {}
    drafts.set(key, { selectedRelease: '', selectedTarget: '', reviewer: '', reason: '',
      target: { id: id(), label: '', origin: '', authTokenEnv: '' }, publicationText: '', ...restored });
  }
  const state = drafts.get(key);
  return { state, save() {
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch {}
  } };
}
async function remoteApi(token, path, input) {
  const response = await fetch('/api/remote/' + path, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(input === undefined ? {} : { body: stringifyDcatJson(input) }),
  });
  const text = await response.text();
  let result;
  try { result = parseDcatJsonText(text); } catch { throw new Error('The catalogue operation response could not be read. Refresh this project to inspect its retained operation.'); }
  if (!response.ok) throw new Error((result.error ?? response.status) + ': ' + (result.message ?? 'The operation did not complete.'));
  return result;
}
function newPublication(target, source) {
  return { id: id(), title: source.title + ' — catalogue publication', targetId: target.id,
    sourceIds: [source.id], package: { mode: 'create', fields: {
      name: '', title: source.title, notes: '', owner_org: '', license_id: '',
    } }, resources: [{ key: 'data', mode: 'create', sourceId: source.id,
      fields: { name: source.title, url: '', format: 'CSV' } }] };
}
function successor(record) {
  const next = clone(record.input);
  next.id = id(); next.previousReleaseId = record.id;
  next.title = record.input.title + ' — following edition';
  const packageAction = record.plan.actions.find(action => action.kind === 'package');
  const packageProgress = record.progress.find(item => item.key === packageAction.key);
  const packageId = packageProgress?.observedId ?? packageAction.resolvedId;
  if (packageId) next.package = { ...next.package, mode: 'patch', id: packageId };
  for (const resource of next.resources) {
    const action = record.plan.actions.find(item => item.key === resource.key);
    const progress = record.progress.find(item => item.key === resource.key);
    const resourceId = progress?.observedId ?? action?.resolvedId;
    if (resourceId && packageId) { resource.mode = 'patch'; resource.id = resourceId; }
  }
  return next;
}
export async function renderRemotePublication(ctx) {
  const { view, state, token, protect, current, download } = ctx;
  const saved = stateFor(state.directory), ui = saved.state;
  const remote = state.remote ?? { targets: [], releases: [] };
  const targets = remote.targets ?? [], releases = remote.releases ?? [];
  const sources = state.sources.filter(source => !source.withdrawal);
  const busy = Boolean(state.active);
  const action = (text, handler, primary = false, disabled = busy) => el('button', {
    type: 'button', class: primary ? 'primary' : '', disabled, onclick: () => protect(handler),
  }, text);
  const form = (handler, ...children) => {
    const node = el('form', { onsubmit: event => {
      event.preventDefault(); protect(() => handler(new FormData(node), node));
    } }, ...children); return node;
  };
  const submit = text => el('button', { type: 'submit', class: 'primary', disabled: busy }, text);
  const perform = async (path, input, accepted) => {
    try {
      const result = await remoteApi(token, path, input);
      if (accepted) accepted(result);
      saved.save(); ctx.acceptOperation(result); await ctx.refresh(); return result;
    } catch (error) {
      // The original ID remains in the draft. Read the retained operation after
      // a lost response instead of replacing the request with a new identity.
      saved.save();
      try { await ctx.refresh(); } catch {}
      throw error;
    }
  };
  view.append(el('h2', {}, 'Catalogue publication'),
    muted('Publish reviewed source selections to a saved CKAN target. Prepare the complete mapping, review the retained target changes, then publish that exact plan.'),
    row(action('Operating guide', () => download('remote/guide', 'REMOTE_PUBLICATION.md'), false, false),
      action('Archive or receive this project', ctx.openWorkspace, false, false)));
  view.append(card(el('h3', {}, 'Saved catalogue targets'),
    table(targets.map(target => ({ label: target.label, origin: target.origin,
      credential: target.authTokenEnv, id: target.id })), [
      ['label', 'Target'], ['origin', 'Catalogue'], ['credential', 'Credential environment name'], ['id', 'Saved identity'],
    ])));
  const targetDraft = ui.target;
  const targetFields = {
    label: field('label', targetDraft.label, 'text', { required: '', maxlength: '256' }),
    origin: field('origin', targetDraft.origin, 'url', { required: '', placeholder: 'https://catalog.example' }),
    authTokenEnv: field('authTokenEnv', targetDraft.authTokenEnv, 'text', { required: '', placeholder: 'CKAN_TARGET_TOKEN', pattern: '[A-Za-z_][A-Za-z0-9_]*' }),
  };
  for (const [name, node] of Object.entries(targetFields)) node.addEventListener('input', () => {
    targetDraft[name] = node.value; saved.save();
  });
  view.append(card(el('details', { open: targets.length === 0 ? '' : undefined },
    el('summary', {}, 'Add a target configuration'),
    muted('The target stores an environment-variable name. Its API token is supplied to the existing workbench process and stays out of the project and browser. Use a new configuration when its address or credential reference changes.'),
    form(async data => {
      Object.assign(targetDraft, { label: String(data.get('label')).trim(), origin: String(data.get('origin')).trim(),
        authTokenEnv: String(data.get('authTokenEnv')).trim() });
      saved.save();
      await perform('targets', targetDraft, result => { ui.selectedTarget = result.targetId; });
    }, row(label('Target label', targetFields.label, true), label('Catalogue address', targetFields.origin, true)),
    label('Credential environment name', targetFields.authTokenEnv),
    muted('Configuration identity: ' + targetDraft.id),
    row(submit('Save target configuration'), action('Start another target configuration', async () => {
      ui.target = { id: id(), label: '', origin: '', authTokenEnv: '' }; saved.save(); await ctx.render();
    }))))));
  if (targets.length) {
    ui.selectedTarget = targets.some(target => target.id === ui.selectedTarget) ? ui.selectedTarget : targets.at(-1).id;
    const targetChoice = select('target', targets.map(target => [target.id, target.label + ' · ' + target.origin]), ui.selectedTarget);
    targetChoice.addEventListener('change', () => protect(async () => {
      ui.selectedTarget = targetChoice.value; saved.save(); await ctx.render();
    }));
    const selected = await remoteApi(token, 'targets/' + encodeURIComponent(ui.selectedTarget));
    if (!current()) return;
    view.append(card(label('Target for a new plan', targetChoice, true),
      muted(selected.credentialAvailable ? 'The configured credential is available to this running workbench.' :
        'Supply ' + selected.authTokenEnv + ' to this workbench process before preparing or publishing.'),
      detail('Retained target configuration', selected)));
  }
  view.append(card(el('h3', {}, 'Reviewed source selections'),
    table(sources.map(source => ({ title: source.title, id: source.id, edition: source.editionId,
      dictionary: source.semanticReview ? 'Retained field meanings' : 'Original source fields' })), [
      ['title', 'Source'], ['id', 'Selection identity'], ['edition', 'Retained edition'], ['dictionary', 'Dictionary'],
    ]),
    muted('The plan binds each selected source and edition by its original hashes. Distribution URLs must point to the approved output for that selection.')));
  if (targets.length && sources.length) {
    const sourceChoice = select('source', sources.map(source => [source.id, source.title + ' · ' + source.id]), sources.at(-1).id);
    view.append(card(el('h3', {}, 'Prepare a complete publication'),
      row(label('Starting source', sourceChoice, true), action('Start a new publication mapping', async () => {
        const source = sources.find(item => item.id === sourceChoice.value);
        const target = targets.find(item => item.id === ui.selectedTarget);
        ui.publicationText = pretty(newPublication(target, source)); ui.selectedRelease = ''; saved.save(); await ctx.render();
      }, true)),
      muted('The mapping covers one dataset and its related distribution resources. Edit every intended field together; retain exact source identifiers and metadata values. Existing target IDs use patch mode.')));
  } else view.append(muted('Save a target and select fields from a complete source edition to prepare a publication.'));
  if (ui.publicationText) {
    const editor = el('textarea', { name: 'mapping', rows: '20', spellcheck: 'false', class: 'mono', required: '' }, ui.publicationText);
    editor.addEventListener('input', () => { ui.publicationText = editor.value; saved.save(); });
    view.append(card(form(async () => {
      const input = parseDcatJsonText(editor.value);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter the complete publication object.');
      ui.publicationText = editor.value; saved.save();
      await perform('publications', input, result => { ui.selectedRelease = result.releaseId; });
    }, label('Complete dataset and resource mapping', editor),
    muted('Create mode needs a unique dataset name and explicit resource URLs. Patch mode needs the existing target IDs. sourceIds and each resource sourceId refer to the reviewed selections above. Extra installed-profile metadata belongs in fields.'),
    row(submit('Prepare or resume this exact plan'), action('Clear unsaved editor', async () => {
      ui.publicationText = ''; saved.save(); await ctx.render();
    })),
    muted('Preparation reads the target and saves its preimages and the complete intended changes. It does not publish them. The mapping identity remains stable when the browser response is interrupted.'))));
  }
  view.append(card(el('h3', {}, 'Retained publication history'),
    table(releases.map(item => ({ title: item.title, state: item.state,
      confirmed: String(item.confirmedActions ?? 0) + ' / ' + String(item.actionCount ?? 0),
      updated: item.updatedAt ?? '', id: item.id })), [
      ['title', 'Publication'], ['state', 'State'], ['confirmed', 'Confirmed actions'], ['updated', 'Last update'], ['id', 'Identity'],
    ])));
  if (!releases.length) return;
  ui.selectedRelease = releases.some(item => item.id === ui.selectedRelease) ? ui.selectedRelease : releases.at(-1).id;
  const chosen = select('release', releases.map(item => [item.id, item.title + ' · ' + item.state]), ui.selectedRelease);
  chosen.addEventListener('change', () => protect(async () => { ui.selectedRelease = chosen.value; saved.save(); await ctx.render(); }));
  view.append(card(label('Publication to inspect', chosen, true)));
  const record = await remoteApi(token, 'publications/' + encodeURIComponent(ui.selectedRelease));
  if (!current()) return;
  const releasePath = 'publications/' + encodeURIComponent(record.id);
  const downloads = row(
    action('Download complete publication record', () => download('remote/' + releasePath + '/files/record', 'ckan-publication-' + record.id + '.json'), false, false),
    record.plan ? action('Download exact reviewed plan', () => download('remote/' + releasePath + '/files/plan', 'ckan-publication-plan-' + record.id + '.json'), false, false) : null);
  view.append(card(row(el('h3', { class: 'grow' }, record.input.title), el('span', { class: 'pill' }, record.state)),
    muted('Target: ' + record.target.label + ' · ' + record.target.origin),
    record.error ? detail('Current target or operation issue', record.error) : null,
    downloads, detail('Original mapping', record.input),
    row(action('Copy mapping as a new plan edition', async () => {
      ui.publicationText = pretty(record.plan ? successor(record) : { ...clone(record.input), id: id(), previousReleaseId: record.id });
      saved.save(); await ctx.render();
    }), !record.plan ? action('Resume original preparation', () => perform('publications', record.input), true) : null)));
  if (!record.plan) {
    view.append(muted('Preparation has not produced a complete plan. The original input, response history and resource identities remain attached to this publication.'));
  } else {
    view.append(card(el('h3', {}, 'Source bindings and intended target changes'),
      muted('Plan identity: ' + record.planSha256),
      table(record.plan.sourceBindings, [['sourceId', 'Source selection'], ['editionId', 'Edition'], ['sourceSha256', 'Selection hash'], ['captureSha256', 'Capture hash']]),
      ...record.plan.actions.map(item => {
        const progress = record.progress.find(entry => entry.key === item.key);
        return el('details', {}, el('summary', {}, item.key + ' · ' + item.action + ' · ' + (progress?.status ?? 'PENDING')),
          muted('Target identity: ' + (progress?.observedId ?? item.resolvedId ?? item.targetId)),
          table(item.changes.map(change => ({ field: change.field,
            before: change.before.present ? pretty(change.before.value) : '(absent)',
            after: change.after.present ? pretty(change.after.value) : '(absent)' })),
          [['field', 'Field'], ['before', 'Retained target value'], ['after', 'Intended value']]),
          detail('Complete action and retained baseline', item), detail('Dispatch and confirmation state', progress));
      })));
    if (!record.review && record.state === 'READY') {
      const reviewer = field('reviewer', ui.reviewer, 'text', { required: '', maxlength: '128' });
      const reason = el('textarea', { name: 'reason', rows: '3', required: '', maxlength: '4096' }, ui.reason);
      reviewer.addEventListener('input', () => { ui.reviewer = reviewer.value; saved.save(); });
      reason.addEventListener('input', () => { ui.reason = reason.value; saved.save(); });
      view.append(card(el('h3', {}, 'Review this exact plan'),
        form(async data => {
          ui.reviewer = String(data.get('reviewer')); ui.reason = String(data.get('reason')); saved.save();
          await perform(releasePath + '/review', { expectedPlanSha256: record.planSha256,
            reviewer: ui.reviewer, decision: data.get('decision'), reason: ui.reason });
        }, row(label('Reviewer', reviewer, true), label('Decision', select('decision', [['approve', 'Approve'], ['reject', 'Reject']], 'approve'))),
        label('Source, metadata and target decision', reason),
        muted('The saved decision pins these source bindings, target preimages and intended fields. An identical retried decision retains the original approval.'),
        submit('Record plan decision'))));
    }
    if (record.review) view.append(card(el('h3', {}, 'Saved review'), detail('Plan decision', record.review)));
    if (record.review?.decision === 'approve') {
      const writable = ['APPROVED', 'PARTIAL', 'UNCERTAIN', 'FAILED'].includes(record.state);
      view.append(card(el('h3', {}, 'Operate the reviewed publication'),
        muted('Publishing performs the approved remote writes. Each action checks its retained target baseline and records the returned identity and readback. Separate CKAN actions can leave a partial target state until reconciliation finishes.'),
        row(writable ? action(record.state === 'APPROVED' ? 'Publish approved plan' : 'Continue approved publication',
          () => perform(releasePath + '/publish', { expectedPlanSha256: record.planSha256, expectedReviewId: record.review.id }), true) : null,
          action('Read and reconcile the same target', () => perform(releasePath + '/reconcile', {}))),
        record.state === 'CONFLICT' ? muted('The target changed. Inspect the retained responses and copy this mapping into a new plan edition for a fresh comparison and review.') : null,
        record.state === 'COMPLETE' ? muted('This completed record is a retained publication snapshot. Reconcile to observe the current target, or prepare a new plan edition for later changes.') : null,
        muted('Reconciliation reads provider state and updates this original record. A later write still uses the approved plan and review.')));
    }
  }
  view.append(card(el('h3', {}, 'Provider responses'),
    table(record.receipts.map(ref => ({ action: ref.receipt.action, method: ref.receipt.method,
      status: ref.receipt.status, bytes: ref.bytes, sha256: ref.sha256,
      read: action('Download response', () => download('remote/' + releasePath + '/files/receipt?' +
        new URLSearchParams({ receiptId: ref.id }), 'ckan-target-response-' + ref.id + '.json'), false, false) })),
    [['action', 'Action'], ['method', 'Method'], ['status', 'HTTP status'], ['bytes', 'Bytes'], ['sha256', 'Content hash'], ['read', 'Retained response']]),
    detail('Complete operation history', record.history)));
}

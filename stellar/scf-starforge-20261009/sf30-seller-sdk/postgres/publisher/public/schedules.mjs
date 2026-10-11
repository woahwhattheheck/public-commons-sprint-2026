// The schedule controls share the original publisher page and run selection.
export function createSchedulePanel({ api, action, notice, context, openRun }) {
  const $ = id => document.getElementById(id);
  let current = null, baseline = null, dirty = false, formRevision = null, loadedPolicy = null, offset = 0;
  let pendingRequest = null;
  const words = value => String(value ?? '').replaceAll('_', ' ').toLowerCase();
  const short = value => value ? value.slice(0, 12) + '…' : '—';
  const time = value => value === null || value === undefined ? '—' :
    new Date(value).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  const node = (tag, value = '', attrs = {}) => {
    const element = document.createElement(tag); element.textContent = value;
    for (const [key, content] of Object.entries(attrs)) element.setAttribute(key, content);
    return element;
  };
  function fill(policy) {
    const value = policy.data;
    $('schedule-interval').value = value.intervalSeconds;
    $('schedule-minimum').value = value.minimumRows;
    $('schedule-maximum').value = value.maximumRows;
    $('schedule-drop').value = value.maximumDropPercent ?? '';
    $('schedule-on-error').value = value.onError;
    $('schedule-reviewer').value = value.reviewer;
    $('schedule-note').value = value.note;
    baseline = { referenceRun: value.referenceRun, planDigest: value.planDigest,
      expectedSnapshot: current.expected.snapshot, expectedRevision: current.expected.revision };
    formRevision = current.revision; loadedPolicy = policy.id; dirty = false;
  }
  function update() {
    const { busy, detail, target, snapshot } = context();
    const working = Boolean(current?.active || current?.pending || snapshot?.active);
    $('schedule-status').textContent = !current?.policy ? 'Not configured' :
      current.active ? words(current.active.state) : current.enabled ? 'Enabled' : 'Paused';
    $('schedule-next').textContent = current?.enabled ? 'Next refresh: ' + time(current.nextAt) :
      current?.pending ? 'An unfinished original refresh is retained.' : 'Enable a saved policy to begin recurring refreshes.';
    $('schedule-binding').textContent = current?.policy ? 'Plan ' + current.policy.data.plan + ' · source plan ' +
      short(current.policy.data.planDigest) + ' · target revision ' + current.expected.revision +
      ' · ' + current.expected.rows.toLocaleString() + ' baseline rows' : 'Publish and select the first reviewed extraction above.';
    $('schedule-baseline').disabled = busy || working || detail?.run.state !== 'PUBLISHED' ||
      detail?.run.data.candidate?.dataset.snapshot !== target?.versions?.current;
    $('schedule-baseline-label').textContent = baseline ?
      'Reference extraction ' + short(baseline.referenceRun) + ' · target revision ' + baseline.expectedRevision :
      'Select a current published extraction, then use it as this policy’s baseline.';
    $('schedule-save').disabled = busy || working || !baseline;
    $('schedule-enable').disabled = busy || working || !current?.policy || current.enabled || !target?.connected;
    $('schedule-pause').disabled = busy || !current?.enabled;
    $('schedule-run').disabled = busy || working || !current?.policy;
    $('schedule-continue').disabled = busy || Boolean(current?.active || snapshot?.active) || !current?.pending;
    $('schedule-continue').hidden = !current?.pending;
    $('schedule-policy').textContent = current?.policy ? JSON.stringify(current.policy, null, 2) : 'No saved policy.';
    $('schedule-current-warning').textContent = dirty && current?.revision !== formRevision ?
      'The saved policy changed while this form was being edited. Reload the saved policy before replacing it.' : '';
  }
  function history() {
    const body = $('schedule-history'); body.replaceChildren();
    for (const item of current?.history ?? []) {
      const row = node('tr'), status = node('td', words(item.state)), result = item.data.result;
      const detail = node('td', item.data.error ? words(item.data.error) :
        result?.publication ? 'Published revision ' + result.publication.revision :
        item.state === 'UNCHANGED' ? 'Same dataset bytes; current version retained' : 'Original extraction retained');
      row.append(node('td', time(item.created)), node('td', words(item.data.trigger)), status, detail);
      const cell = node('td'), button = node('button', 'Open extraction', { type: 'button' });
      button.disabled = ['RESERVED', 'WAITING'].includes(item.state) && !item.data.candidateDigest;
      button.addEventListener('click', () => action(() => openRun(item.data.runId)));
      cell.append(button); row.append(cell); body.append(row);
    }
    if (!body.children.length) {
      const row = node('tr'); row.append(node('td', 'No scheduled refreshes yet.', { colspan: '5' })); body.append(row);
    }
    const pages = $('schedule-pages'); pages.replaceChildren();
    const page = current?.page;
    if (!page) return;
    pages.append(node('span', page.total ? (page.offset + 1) + '–' +
      (page.offset + current.history.length) + ' of ' + page.total : '0 refreshes', { class: 'muted' }));
    for (const [key, label] of [['previous', 'Newer'], ['next', 'Older']]) {
      const button = node('button', label, { type: 'button', 'aria-label': 'Scheduled refreshes ' + label.toLowerCase() });
      button.disabled = page[key] === null;
      button.addEventListener('click', () => action(async () => { offset = page[key]; await refresh(); }));
      pages.append(button);
    }
  }
  async function refresh() {
    current = await api('/api/schedule?limit=' + context().pageSize + '&offset=' + offset);
    if (current.policy && loadedPolicy !== current.policy.id && !dirty) fill(current.policy);
    if (!current.policy && formRevision === null) formRevision = current.revision;
    update(); history();
  }
  $('schedule-form').addEventListener('input', () => { dirty = true; update(); });
  $('schedule-baseline').addEventListener('click', () => action(async () => {
    if (dirty && !window.confirm('Replace the unsaved policy values with this published extraction?')) return;
    const { detail, target } = context();
    baseline = { referenceRun: detail.run.id, planDigest: detail.plan.data.digest,
      expectedSnapshot: target.versions.current, expectedRevision: target.versions.revision };
    formRevision = current.revision;
    $('schedule-minimum').value = detail.run.data.candidate.dataset.rowCount;
    $('schedule-maximum').value = detail.plan.data.extraction.maxRows;
    if (!$('schedule-reviewer').value) $('schedule-reviewer').value = detail.run.data.review?.reviewer ?? '';
    dirty = true; update();
  }));
  $('schedule-reload').addEventListener('click', () => action(async () => {
    if (dirty && !window.confirm('Discard these unsaved policy edits and reload the saved policy?')) return;
    dirty = false; loadedPolicy = null; baseline = null; await refresh();
  }));
  $('schedule-form').addEventListener('submit', event => {
    event.preventDefault(); action(async () => {
      if (!baseline) throw new Error('Use a current published extraction as the policy baseline.');
      current = await api('/api/schedule/save', { ...baseline, revision: formRevision,
        intervalSeconds: Number($('schedule-interval').value),
        minimumRows: Number($('schedule-minimum').value), maximumRows: Number($('schedule-maximum').value),
        maximumDropPercent: $('schedule-drop').value.trim() === '' ? null : Number($('schedule-drop').value),
        onError: $('schedule-on-error').value, reviewer: $('schedule-reviewer').value, note: $('schedule-note').value });
      fill(current.policy); update(); history();
      notice('Publication policy saved. Enable it to run on this cadence, or run one explicit refresh.');
    });
  });
  $('schedule-enable').addEventListener('click', () => action(async () => {
    const target = context().target;
    current = await api('/api/schedule/enable', { revision: current.revision,
      expectedSnapshot: target.versions.current, expectedRevision: target.versions.revision });
    formRevision = dirty ? formRevision : current.revision;
    update(); notice('Schedule enabled against the displayed target. The saved policy governs each original publication.');
  }));
  $('schedule-pause').addEventListener('click', () => action(async () => {
    current = await api('/api/schedule/pause', { revision: current.revision });
    formRevision = dirty ? formRevision : current.revision;
    update(); notice('Future refreshes paused. A refresh already in progress finishes under its original policy.');
  }));
  $('schedule-run').addEventListener('click', () => action(async () => {
    pendingRequest ??= crypto.randomUUID();
    const result = await api('/api/schedule/run', { revision: current.revision, requestId: pendingRequest });
    pendingRequest = null; offset = 0; await refresh();
    notice('Refresh ' + short(result.id) + ' started through the original publisher.');
  }));
  $('schedule-continue').addEventListener('click', () => action(async () => {
    const result = await api('/api/schedule/continue', { revision: current.revision });
    await refresh(); notice('Continuing the same retained refresh ' + short(result.id) + ' against its original target binding.');
  }));
  return { refresh, update, get dirty() { return dirty; } };
}

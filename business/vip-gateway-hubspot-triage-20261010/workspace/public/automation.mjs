export function createAutomationView(c) {
  const { ui, esc, uri, time, human, json, button, link, badge, empty, field, select, check, heading, metrics, kv, table,
    draft, values, mutate, openDialog, closeDialog, project, base, request, render, tell, openRun } = c;
  let digestId = '', digestDetail = null, cycleId = '', cycleDetail = null, selectedProject = '';
  const data = () => ui.data?.automation ?? null;
  const schedule = () => data()?.schedule ?? null;
  const key = action => 'monitor-' + action + ':' + ui.projectId;
  const storageKey = () => 'pipeline-monitor-pending:' + ui.projectId;
  function pendingRequest() {
    try {
      const result = JSON.parse(sessionStorage.getItem(storageKey()) ?? 'null');
      if (!result || result.projectId !== ui.projectId || result.sent?.options?.method !== 'POST') return null;
      const payload = JSON.parse(result.sent.options.body);
      if (typeof payload.actor !== 'string' || typeof payload.requestId !== 'string') return null;
      const url = result.sent.url, own = base() + '/monitor/';
      if (!(url.startsWith(own) || /^\/api\/monitor-cycles\/[^/]+\/(?:retry|abandon)$/.test(url) || /^\/api\/manager-digests\/[^/]+\/review$/.test(url))) return null;
      return result;
    } catch { return null; }
  }
  function savePending(sent) {
    const old = pendingRequest();
    if (old && (old.sent.url !== sent.url || old.sent.options.body !== sent.options.body)) throw Error('Retrieve the saved monitoring request before sending a different monitoring change.');
    sessionStorage.setItem(storageKey(), JSON.stringify(old ?? { projectId: ui.projectId, sent, preparedAt: new Date().toISOString() }));
  }
  const clearPending = () => sessionStorage.removeItem(storageKey());
  async function write(build, options = {}, frozen = null) {
    return mutate(build, {
      ...options, beforeSend: savePending, afterSaved: clearPending,
      afterRejected: error => { if (error.status >= 400 && error.status < 500 && error.status !== 408) clearPending(); },
      after: async result => {
        if (result.digest) { digestId = result.digest.id; digestDetail = null; }
        if (result.cycle) { cycleId = result.cycle.id; cycleDetail = null; }
        if (options.after) await options.after(result);
      }
    }, frozen);
  }
  async function load() {
    if (selectedProject !== ui.projectId) { selectedProject = ui.projectId; digestId = ''; cycleId = ''; digestDetail = null; cycleDetail = null; }
    const currentProject = ui.projectId;
    if (digestId) {
      const selected = digestId, value = await request('/api/manager-digests/' + uri(selected));
      if (currentProject === ui.projectId && selected === digestId && value.digest.projectId === currentProject) digestDetail = value;
    }
    if (cycleId) {
      const selected = cycleId, value = await request('/api/monitor-cycles/' + uri(selected));
      if (currentProject === ui.projectId && selected === cycleId && value.cycle.projectId === currentProject) cycleDetail = value;
    }
  }
  const count = value => value ?? 0;
  function definitionForm() {
    const current = schedule(), defaults = current?.settings ?? data()?.defaults;
    if (!defaults) return empty('Open a project to configure monitoring.');
    const d = draft(key('settings'), {
      interval: defaults.captureEveryMinutes, timeZone: defaults.timeZone,
      firstCaptureAt: current?.nextCaptureAt ?? new Date().toISOString(),
      dailyEnabled: defaults.daily.enabled, dailyTime: defaults.daily.time,
      weeklyEnabled: defaults.weekly.enabled, weeklyTime: defaults.weekly.time,
      weekday: defaults.weekly.weekday, enabled: current?.status === 'enabled', note: '', _scheduleVersion: current?.version ?? 0
    });
    return '<section class="card"><h2>Monitoring cadence</h2><p>Each capture uses the original permitted-account listing and the saved pipeline definitions. Calendar digests use the selected local reporting zone.</p>' +
      '<form data-action="monitor-settings" data-draft="' + esc(key('settings')) + '">' +
      '<div class="grid">' + field('interval', 'Capture every (minutes)', d.interval, { type: 'number', min: 1, max: 10080, required: true }) +
      field('timeZone', 'Reporting time zone', d.timeZone, { required: true, help: 'IANA zone, such as Europe/London or UTC. Capture spacing is elapsed time; reports follow the local calendar.' }) +
      field('firstCaptureAt', 'Next capture time (ISO with time zone)', d.firstCaptureAt, { required: true }) + '</div>' +
      '<div class="grid"><fieldset><legend>Daily digest</legend>' + check('dailyEnabled', 'Prepare a daily digest', d.dailyEnabled) +
      field('dailyTime', 'Daily local time', d.dailyTime, { type: 'time', required: true }) + '</fieldset><fieldset><legend>Weekly digest</legend>' +
      check('weeklyEnabled', 'Prepare a weekly digest', d.weeklyEnabled) +
      select('weekday', 'Weekly day', [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']], d.weekday) +
      field('weeklyTime', 'Weekly local time', d.weeklyTime, { type: 'time', required: true }) + '</fieldset></div>' +
      field('note', 'Operating note', d.note, { textarea: true, rows: 2 }) +
      check('enabled', 'Enable this monitoring cadence', d.enabled) +
      '<button class="primary">Save monitoring settings</button></form>' +
      '<p class="help">The monitor runs while this operator service is running. Capture failures keep their original progress and appear in scheduled status digests. Pause stops both capture and reporting; an already running read can finish into its retained job.</p></section>';
  }
  function stateCard() {
    const current = schedule();
    if (!current) return '<section class="card"><h2>Set up the operating cadence</h2><p>Save the source mappings, review a run, and choose the capture and reporting times below.</p></section>';
    const issue = current.error ? '<div class="notice"><strong>' + esc(human(current.error.code)) + '</strong><p>' + esc(current.error.message) + '</p></div>' : '';
    const pending = ['daily', 'weekly'].map(kind => {
      const value = current.pendingDigests?.[kind];
      return value ? '<p><strong>' + esc(human(kind)) + ' report: ' + esc(human(value.status)) + '</strong> · frozen cutoff ' +
        esc(time(value.request.cutoff)) + (value.error ? ' · ' + esc(value.error.message) : '') + '</p>' : '';
    }).join('');
    return '<section class="card"><div class="pagehead"><div><h2>Current operation</h2>' + badge(current.status, true) +
      '<p>Definition version ' + current.version + ' · ' + esc(current.settings.timeZone) + '</p></div><div class="actions">' +
      button('Capture now', 'monitor-trigger', current.status === 'enabled' ? '' : 'disabled', 'primary') +
      button('Pause', 'monitor-pause', current.status === 'paused' ? 'disabled' : '') +
      button('Resume / bind this host', 'monitor-resume', current.status === 'enabled' ? 'disabled' : '') + '</div></div>' + issue +
      kv({ next_capture: current.nextCaptureAt, next_daily_digest: current.nextDigest.daily?.at ?? 'Disabled / receiving review',
        next_weekly_digest: current.nextDigest.weekly?.at ?? 'Disabled / receiving review',
        provider: data().provider.origin, provider_kind: data().provider.kind, saved_definition_sha256: current.configSha256,
        current_definition_sha256: data().currentConfigSha256, last_worker_check: data().worker.lastTickAt }) + pending +
      (current.receivedFrom ? '<p class="notice">This received schedule keeps its original history. Review the current source definitions and provider, then bind it to this host before a new capture.</p>' : '') +
      (current.receivedPendingDigests && Object.values(current.receivedPendingDigests).some(Boolean) ? '<details><summary>Original unfinished reporting reservations</summary><pre>' + esc(json(current.receivedPendingDigests)) + '</pre></details>' : '') +
      '</section>';
  }
  function cyclePanel() {
    if (!cycleDetail) return '';
    const value = cycleDetail.cycle, current = schedule();
    return '<section class="card" id="monitor-cycle-detail"><div class="pagehead"><div><h2>Retained capture cycle</h2><p>' + esc(value.id) + '</p></div>' +
      badge(value.status, true) + '</div>' +
      kv({ scheduled_for: value.scheduledFor, actual_reservation: value.reservedAt, reporting_zone: value.timeZone,
        missed_capture_slots: value.missedCaptureSlots, completed_at: value.completedAt ?? 'Not completed',
        retry_at: value.retryAt ?? 'None', original_job: value.jobId ?? 'Not dispatched', original_run: value.runId ?? 'Not created' }) +
      (value.error ? '<p class="notice">' + esc(value.error.message) + '</p>' : '') +
      '<div class="actions">' + (value.runId ? button('Open original run', 'open-run', 'data-id="' + esc(value.runId) + '"') : '') +
      (value.jobId ? button('Inspect original capture', 'inspect-job', 'data-id="' + esc(value.jobId) + '"') : '') +
      (current?.activeCycleId === value.id && value.status === 'failed' ? button('Retry this original cycle', 'monitor-retry', 'data-id="' + esc(value.id) + '"') : '') +
      (current?.activeCycleId === value.id && !['completed', 'abandoned', 'received_interrupted'].includes(value.status) ? button('Abandon and retain this cycle', 'monitor-abandon', 'data-id="' + esc(value.id) + '"') : '') +
      '</div><details class="smallgap"><summary>Original progress and continuation history</summary><pre>' + esc(json({ job: cycleDetail.job, errors: value.errors, history: cycleDetail.history })) +
      '</pre></details></section>';
  }
  function digestPanel() {
    if (!digestDetail) return '';
    const { digest: value, report, review, bindings } = digestDetail;
    const activeRun = report.selected ? bindings.find(x => x.originalRunId === report.selected.runId)?.runId : null;
    const d = draft(key('digest-review:' + value.id), { status: review?.status ?? 'acknowledged', note: '' });
    let html = '<section class="card" id="monitor-digest-detail"><div class="pagehead"><div><h2>' + esc(value.name) +
      '</h2><p>' + esc(time(value.period.start.at)) + ' – ' + esc(time(value.period.end.at)) + ' · ' + esc(value.period.timeZone) +
      '</p></div><div class="actions">' + link('Readable digest', '/api/manager-digests/' + uri(value.id) + '/download?format=markdown', true) +
      link('Complete JSON', '/api/manager-digests/' + uri(value.id) + '/download?format=json', true) + '</div></div>';
    html += metrics([['Actionable emitted alerts', report.attention.total], ['Original emitted alerts', report.selected?.summary.alerts ?? 'No source'],
      ['Original suppressed alerts', report.selected?.summary.suppressedAlertCount ?? 'No source'], ['Missed capture slots', report.coverage.missedCaptureSlots]]) +
      '<p>Frozen ' + esc(time(report.frozenAt)) + '. Source and analysis cutoff ' + esc(time(report.cutoff)) +
      '. Named decisions observed ' + esc(time(report.decisions.observedAt)) + '.</p>';
    if (report.selected) html += kv({ original_source_available: report.selected.sourceAvailableAt, analysis_available: report.selected.analysisAvailableAt,
      actual_capture_start: report.selected.observedFrom, actual_capture_end: report.selected.observedThrough,
      analysis_as_of: report.selected.asOf, source_sha256: report.selected.sourceSha256, original_report_sha256: report.selected.reportSha256 }) +
      (activeRun ? '<div class="actions">' + button('Open original attention queue', 'open-attention', 'data-id="' + esc(activeRun) + '"') +
      button('Open original cohorts', 'open-cohorts', 'data-id="' + esc(activeRun) + '"') + '</div>' : '');
    else html += '<p class="notice">No completed original source and analysis were available at this cutoff. Retained operation states appear below.</p>';
    html += '<h3>Frozen manager attention</h3>' + table(report.attention.items, [
      { label: 'Deal', key: 'dealId' }, { label: 'Original reasons', render: x => esc(x.reasons.map(human).join('; ')) },
      { label: 'Owner', key: 'ownerId' }, { label: 'Decision', render: x => badge(x.review.status) },
      { label: 'Named note', render: x => esc(x.review.note) }, { label: 'Due', render: x => esc(time(x.review.dueAt)) }
    ], 'data', 'No actionable emitted alerts at this freeze.') +
      '<p class="help">Showing ' + report.attention.items.length + ' of ' + report.attention.total + ' actionable emitted alerts. Open the original run for its complete list and source rows.</p>' +
      '<h3>Capture and analysis continuity</h3>' + table(report.coverage.cycles, [
        { label: 'Scheduled time', render: x => esc(time(x.scheduledFor)) }, { label: 'State', render: x => badge(x.status) },
        { label: 'Actual reservation', render: x => esc(time(x.reservedAt)) }, { label: 'Missed slots', key: 'missedCaptureSlots' },
        { label: 'Retained issue', render: x => esc(x.error?.message ?? '') }
      ]) +
      table(report.pending, [{ label: 'Original operation', key: 'id' }, { label: 'Kind', key: 'kind' },
        { label: 'State', render: x => badge(x.status) }, { label: 'Issue', render: x => esc(x.error?.message ?? '') }], 'data', 'No incomplete original capture or analysis at the digest freeze.');
    if (report.coverage.unavailableAtCutoff.length) html += '<h3>Later available sources</h3>' + table(report.coverage.unavailableAtCutoff, [
      { label: 'Run', key: 'runId' }, { label: 'Source available', render: x => esc(time(x.sourceAvailableAt)) },
      { label: 'Analysis available', render: x => esc(time(x.analysisAvailableAt)) }
    ]);
    if (report.comparison) html += '<h3>Original comparison</h3>' + metrics([
      ['Newly emitted alerts', report.comparison.alerts.new.length], ['No longer emitted', report.comparison.alerts.resolved.length],
      ['Same definitions', report.comparison.compatibility.sameConfig ? 'Yes' : 'No'], ['Same scope', report.comparison.compatibility.sameScope ? 'Yes' : 'No']]) +
      '<p>' + esc(report.comparison.interpretation) + '</p><details><summary>Exact cohort denominators and source changes</summary><pre>' +
      esc(json({ cohorts: report.comparison.cohorts, records: report.comparison.records })) + '</pre></details>';
    html += '<details class="smallgap"><summary>All frozen manager decisions and original cohorts</summary><pre>' +
      esc(json({ decisions: report.decisions, cohorts: report.cohorts })) + '</pre></details><p class="help">' + esc(report.interpretation) + '</p>' +
      '<h3>Manager acknowledgment</h3>' + (review ? '<p>' + esc(review.actor) + ' · ' + esc(time(review.updatedAt)) + ' · ' + esc(human(review.status)) + '<br>' + esc(review.note) + '</p>' : '') +
      '<form data-action="monitor-digest-review" data-id="' + esc(value.id) + '" data-draft="' + esc(key('digest-review:' + value.id)) + '">' +
      select('status', 'Digest disposition', [['acknowledged', 'Acknowledged'], ['follow_up', 'Follow-up retained']], d.status) +
      field('note', 'Manager digest note', d.note, { textarea: true, required: true, rows: 3 }) +
      '<button class="primary">Save named digest review</button></form></section>';
    return html;
  }
  function renderPage() {
    if (!project()) return heading('Continuous monitoring', 'Open or restore the pipeline project whose capture cadence and manager digests belong together.') + empty('Create a project from Manager overview.');
    const current = data(), pending = pendingRequest();
    if (!current) return empty('Loading retained monitoring work…');
    return heading('Continuous monitoring', 'Operate the saved source cadence, inspect each original capture and read the frozen daily and weekly manager digests.') +
      (pending ? '<div class="notice"><strong>Retrieve the saved monitoring request</strong><p>Its original request identifier and body are retained in this browser tab. Retrieve the same outcome before sending a different monitoring change.</p>' +
        button('Retrieve same request', 'monitor-recover') + '</div>' : '') +
      metrics([['Retained capture cycles', current.totals.cycles], ['Retained digests', current.totals.digests],
        ['Schedule', schedule() ? human(schedule().status) : 'Not configured'], ['Service monitor', current.worker.running ? 'Running' : 'Explicit CLI / stopped']]) +
      stateCard() + definitionForm() +
      '<section class="card"><div class="pagehead"><div><h2>Saved daily and weekly digests</h2><p>Each digest retains its original cutoff, source availability, report hashes and named decision snapshot.</p></div><div class="actions">' +
      button('Prepare daily digest now', 'monitor-digest', 'data-kind="daily"') +
      button('Prepare weekly digest now', 'monitor-digest', 'data-kind="weekly"') + '</div></div>' +
      table(current.digests, [{ label: 'Digest', render: x => button(x.name, 'monitor-open-digest', 'data-id="' + esc(x.id) + '"', 'link') },
        { label: 'Cutoff', render: x => esc(time(x.cutoff)) }, { label: 'State', render: x => badge(x.status) },
        { label: 'Actionable', render: x => esc(count(x.attentionCount)) }, { label: 'Missed boundaries', key: 'coalescedDigestBoundaries' },
        { label: 'Manager disposition', render: x => esc(x.review ? human(x.review.status) : 'Awaiting review') }]) +
      (current.digests.length < current.totals.digests ? button('Load older digests', 'monitor-older', 'data-kind="automation_digest"') : '') + '</section>' +
      digestPanel() + '<section class="card"><h2>Original capture cycles</h2>' +
      table(current.cycles, [{ label: 'Scheduled time', render: x => button(time(x.scheduledFor), 'monitor-open-cycle', 'data-id="' + esc(x.id) + '"', 'link') },
        { label: 'State', render: x => badge(x.status) }, { label: 'Actual start', render: x => esc(time(x.reservedAt)) },
        { label: 'Missed slots', key: 'missedCaptureSlots' }, { label: 'Original result', render: x => x.runId ? button('Open run', 'open-run', 'data-id="' + esc(x.runId) + '"') : esc(x.error?.message ?? 'Awaiting original capture') }]) +
      (current.cycles.length < current.totals.cycles ? button('Load older cycles', 'monitor-older', 'data-kind="automation_cycle"') : '') + '</section>' + cyclePanel();
  }
  function operationDialog(action, title, cycle = null) {
    const d = draft(key(action + (cycle ? ':' + cycle : '')), { note: '', bind: false, _scheduleVersion: schedule()?.version ?? 0 });
    openDialog(title, '<form data-action="monitor-' + action + '" data-id="' + esc(cycle ?? '') + '" data-draft="' + esc(key(action + (cycle ? ':' + cycle : ''))) + '">' +
      field('note', 'Operating decision', d.note, { textarea: true, required: true }) +
      (action === 'resume' ? check('bind', 'Bind the current provider and pipeline definitions to this receiving schedule', d.bind) : '') +
      '<button class="primary">' + esc(title) + '</button></form>');
  }
  async function handleButton(control) {
    const action = control.dataset.act, identity = control.dataset.id;
    if (action === 'monitor-open-digest') { digestId = identity; await load(); render(); document.querySelector('#monitor-digest-detail')?.scrollIntoView({ block: 'start' }); }
    else if (action === 'monitor-open-cycle') { cycleId = identity; await load(); render(); document.querySelector('#monitor-cycle-detail')?.scrollIntoView({ block: 'start' }); }
    else if (action === 'monitor-pause') operationDialog('pause', 'Pause monitoring');
    else if (action === 'monitor-resume') operationDialog('resume', 'Resume monitoring');
    else if (action === 'monitor-retry') operationDialog('retry', 'Retry this original cycle', identity);
    else if (action === 'monitor-abandon') operationDialog('abandon', 'Abandon and retain this cycle', identity);
    else if (action === 'monitor-trigger') await write(() => ({ url: base() + '/monitor/trigger', data: { version: schedule().version } }),
      { projectRevision: false, message: 'Original monitoring cycle retained. Its capture and analysis will continue in this service.' });
    else if (action === 'monitor-digest') {
      const kind = control.dataset.kind, d = draft(key('digest:' + kind), { name: human(kind) + ' manager review', cutoff: new Date().toISOString() });
      openDialog('Prepare ' + kind + ' digest', '<form data-action="monitor-digest" data-kind="' + esc(kind) + '" data-draft="' + esc(key('digest:' + kind)) + '">' +
        field('name', 'Digest name', d.name, { required: true }) + field('cutoff', 'Source and analysis cutoff (ISO with zone)', d.cutoff, { required: true }) +
        '<p class="help">The digest uses sources and original analyses actually available by this cutoff. Manager decisions are frozen at preparation time.</p><button class="primary">Prepare retained digest</button></form>');
    } else if (action === 'monitor-recover') {
      const pending = pendingRequest(); if (!pending) throw Error('No retained monitoring request is present in this tab.');
      await write(() => null, { projectRevision: false, message: 'Original saved monitoring outcome retrieved.' }, pending.sent);
    } else if (action === 'monitor-older') {
      const kind = control.dataset.kind, target = kind === 'automation_cycle' ? 'cycles' : 'digests', current = data();
      const result = await request(base() + '/monitor/items?' + new URLSearchParams({ kind, offset: current[target].length, limit: 50 }));
      const ids = new Set(current[target].map(x => x.id)); current[target].push(...result.items.filter(x => !ids.has(x.id))); render();
    } else throw Error('Unknown monitoring control.');
  }
  function reapplying(draftKey) {
    return ui.pending?.kind === 'conflict' && ui.pending.inspected && ui.pending.options?.draftKey === draftKey;
  }
  function expectedScheduleVersion(draftKey, d) {
    return reapplying(draftKey) ? schedule()?.version ?? 0 : d._scheduleVersion ?? 0;
  }
  async function submitForm(form) {
    const action = form.dataset.action, draftKey = form.dataset.draft, identity = form.dataset.id;
    if (action === 'monitor-settings') return write(() => {
      const d = values(draftKey), current = schedule(), settings = current?.settings ?? data().defaults;
      const chosen = (name, latest) => reapplying(draftKey) && String(d[name] ?? '') === String(d._base?.[name] ?? '') ? latest : d[name];
      return { url: base() + '/monitor/configure', data: { version: expectedScheduleVersion(draftKey, d),
        enabled: Boolean(chosen('enabled', current?.status === 'enabled')),
        firstCaptureAt: chosen('firstCaptureAt', current?.nextCaptureAt ?? d.firstCaptureAt), note: d.note,
        settings: { captureEveryMinutes: Number(chosen('interval', settings.captureEveryMinutes)), timeZone: chosen('timeZone', settings.timeZone),
          daily: { enabled: Boolean(chosen('dailyEnabled', settings.daily.enabled)), time: chosen('dailyTime', settings.daily.time) },
          weekly: { enabled: Boolean(chosen('weeklyEnabled', settings.weekly.enabled)), weekday: Number(chosen('weekday', settings.weekly.weekday)),
            time: chosen('weeklyTime', settings.weekly.time) } } } };
    }, { draftKey, inspect: schedule, message: 'Monitoring cadence and its reporting boundaries are saved.' });
    if (['monitor-pause', 'monitor-resume', 'monitor-retry', 'monitor-abandon'].includes(action)) {
      const ending = action.slice(8), target = ['retry', 'abandon'].includes(ending)
        ? '/api/monitor-cycles/' + uri(identity) + '/' + ending : base() + '/monitor/' + ending;
      return write(() => { const d = values(draftKey); return { url: target, data: { version: expectedScheduleVersion(draftKey, d),
        note: d.note, ...(ending === 'resume' ? { bindCurrentProviderAndDefinitions: Boolean(d.bind) } : {}) } }; },
        { draftKey, projectRevision: ending === 'resume', inspect: schedule, after: () => closeDialog(), message: 'Operating decision retained with the original monitoring history.' });
    }
    if (action === 'monitor-digest') return write(() => { const d = values(draftKey); return { url: base() + '/monitor/digests', data: { kind: form.dataset.kind, name: d.name, cutoff: d.cutoff } }; },
      { draftKey, projectRevision: false, after: () => closeDialog(), message: 'Manager digest frozen with its exact source and analysis cutoff.' });
    if (action === 'monitor-digest-review') return write(() => {
      if (digestDetail?.digest.id !== identity) throw Error('Open the exact retained digest before reviewing it.');
      const d = values(draftKey); return { url: '/api/manager-digests/' + uri(identity) + '/review',
        data: { version: digestDetail.review?.version ?? 0, sha256: digestDetail.digest.sha256, status: d.status, note: d.note } };
    }, { draftKey, projectRevision: false, inspect: () => digestDetail?.review, message: 'Named digest review retained against the frozen digest bytes.' });
    throw Error('Unknown monitoring form.');
  }
  function fingerprint(value = data()) {
    return JSON.stringify([value?.schedule?.version, value?.schedule?.status, value?.schedule?.updatedAt,
      value?.totals, value?.cycles?.[0]?.updatedAt, value?.digests?.[0]?.id]);
  }
  return { load, render: renderPage, handleButton, submitForm, fingerprint,
    needsPolling: () => ['enabled', 'needs_review'].includes(schedule()?.status),
    reset() { digestId = ''; cycleId = ''; digestDetail = null; cycleDetail = null; selectedProject = ''; } };
}


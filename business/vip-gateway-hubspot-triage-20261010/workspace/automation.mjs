import { canonical, digest, id, integer, iso, jsonBytes, page, parse, portableError, requireThat, summary, text } from './common.mjs';

const MINUTE = 60000, DAY = 86400000;
const ACTIVE = new Set(['reserved', 'capturing', 'analysing', 'retry_wait']);
const formatterCache = new Map();
export const AUTOMATION_DEFAULTS = Object.freeze({
  captureEveryMinutes: 60, timeZone: 'Europe/London',
  daily: { enabled: true, time: '09:00' },
  weekly: { enabled: true, weekday: 1, time: '09:00' }
});
function parts(at, zone) {
  let f = formatterCache.get(zone);
  if (!f) { f = new Intl.DateTimeFormat('en-GB-u-ca-iso8601-nu-latn', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); formatterCache.set(zone, f); }
  return Object.fromEntries(f.formatToParts(new Date(at)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
}
const wall = p => Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
const dayKey = at => new Date(at).toISOString().slice(0, 10);
function localOccurrence(day, time, zone) {
  const [year, month, date] = day.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, date, hour, minute), offsets = new Set();
  for (let delta = -36; delta <= 36; delta += 6) { const at = target + delta * 3600000; offsets.add(wall(parts(at, zone)) - at); }
  const candidates = [...offsets].map(offset => ({ at: target - offset, local: wall(parts(target - offset, zone)) }));
  const exact = candidates.filter(x => x.local === target).sort((a, b) => a.at - b.at);
  // A fold uses its first occurrence. A gap shifts forward by the observed local offset gap.
  const chosen = exact[0] ?? candidates.filter(x => x.local > target).sort((a, b) => a.local - b.local || a.at - b.at)[0];
  requireThat(chosen, 'CALENDAR_BOUNDARY', 'This local reporting time cannot be resolved');
  return { at: new Date(chosen.at).toISOString(), localDate: day, requestedTime: time, timeZone: zone,
    adjustmentMinutes: (chosen.local - target) / MINUTE, repeatedTime: exact.length > 1 };
}
export function calendarBoundary(settings, kind, instant, direction = 'next') {
  requireThat(['daily', 'weekly'].includes(kind), 'DIGEST_KIND', 'Select daily or weekly');
  const at = Date.parse(iso(instant, 'calendar instant')), p = parts(at, settings.timeZone);
  requireThat(p.year >= 1970 && p.year <= 9998, 'CALENDAR_RANGE', 'Use a reporting year between 1970 and 9998');
  const localDay = Date.UTC(p.year, p.month - 1, p.day), candidates = [];
  for (let delta = -9; delta <= 9; delta++) {
    const day = localDay + delta * DAY;
    if (kind === 'weekly' && new Date(day).getUTCDay() !== settings.weekly.weekday) continue;
    candidates.push(localOccurrence(dayKey(day), settings[kind].time, settings.timeZone));
  }
  const matched = candidates.filter(x => direction === 'next' ? Date.parse(x.at) > at : Date.parse(x.at) <= at);
  matched.sort((a, b) => direction === 'next' ? Date.parse(a.at) - Date.parse(b.at) : Date.parse(b.at) - Date.parse(a.at));
  requireThat(matched[0], 'CALENDAR_BOUNDARY', 'No reporting boundary occurs in the selected calendar window');
  return matched[0];
}
function normalizeSettings(input) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'AUTOMATION_SETTINGS', 'Provide monitoring settings');
  const timeZone = text(input.timeZone, 'reporting time zone', 100);
  try { new Intl.DateTimeFormat('en', { timeZone }).format(new Date()); } catch { requireThat(false, 'TIME_ZONE', 'Use an IANA reporting zone such as Europe/London or UTC'); }
  const clock = (value, name) => { requireThat(typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value), 'REPORT_TIME', name + ' must use HH:MM'); return value; };
  for (const kind of ['daily', 'weekly']) requireThat(typeof input[kind]?.enabled === 'boolean', 'DIGEST_ENABLED', 'Choose whether each digest is enabled');
  return { captureEveryMinutes: integer(input.captureEveryMinutes, 'capture interval in minutes', 1, 10080), timeZone,
    daily: { enabled: input.daily.enabled, time: clock(input.daily.time, 'Daily reporting time') },
    weekly: { enabled: input.weekly.enabled, time: clock(input.weekly.time, 'Weekly reporting time'), weekday: integer(input.weekly.weekday, 'weekly day', 0, 6) } };
}
const clean = value => { if (!value) return null; const { credentialBinding, capturedConfig, steps, ...out } = value; return out; };
const md = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\|\u0060*_[\]<>]/g, '\\$&');
function markdownDigest(report) {
  const lines = ['# ' + md(report.name), '', report.kind === 'weekly' ? 'Weekly manager digest' : 'Daily manager digest', '',
    '- Reporting interval: ' + report.period.start.at + ' through ' + report.period.end.at + ' (' + report.period.timeZone + ').',
    '- Frozen at: ' + report.frozenAt + '.', '- Source selection cutoff: ' + report.cutoff + '.',
    '- Completed runs observed within this interval: ' + report.coverage.completedRunsInPeriod + '.',
    '- Missed scheduled digest boundaries coalesced: ' + report.coverage.coalescedDigestBoundaries + '.',
    '- Scheduled capture gaps: ' + report.coverage.missedCaptureSlots + '.', ''];
  if (!report.selected) lines.push('## Source status', '', 'No completed original run was available at this reporting cutoff. The retained pending and failed operations appear below.', '');
  else {
    const selected = report.selected;
    lines.push('## Original source and analysis', '',
      '- Run: ' + selected.runId + '; original report SHA-256: ' + selected.reportSha256 + '.',
      '- Source: ' + selected.snapshotId + '; source SHA-256: ' + selected.sourceSha256 + '.',
      '- Actual capture interval: ' + (selected.observedFrom ?? 'operator import') + ' through ' + (selected.observedThrough ?? 'not supplied') + '.',
      '- Analysis as of: ' + selected.asOf + '; source age at cutoff: ' + selected.sourceAgeMinutes + ' minutes.',
      '- Source available: ' + selected.sourceAvailableAt + '; analysis available: ' + selected.analysisAvailableAt + '.',
      '- Original records: ' + selected.summary.inputCount + '; emitted alerts: ' + selected.summary.alerts + '; suppressed alerts: ' + selected.summary.suppressedAlertCount + '.',
      '', '## Manager attention', '', '| Deal | Original reasons | Owner | Decision | Due |', '| --- | --- | --- | --- | --- |');
    for (const item of report.attention.items) lines.push('| ' + [item.dealId, item.reasons.join(', '), item.ownerId, item.review.status, item.review.dueAt ?? ''].map(md).join(' | ') + ' |');
    if (!report.attention.items.length) lines.push('| No currently open, confirmed or due deferred attention | | | | |');
    lines.push('', 'Showing ' + report.attention.items.length + ' of ' + report.attention.total + ' currently actionable emitted alerts. The original run retains its complete emitted list and suppression counts.', '',
      '## Named decisions at this digest freeze', '', '| Status | Count |', '| --- | --- |');
    for (const [status, count] of Object.entries(report.decisions.counts)) lines.push('| ' + md(status) + ' | ' + count + ' |');
  }
  if (report.comparison) lines.push('', '## Retained comparison', '',
    '- Baseline run: ' + report.comparison.baseline.id + '.', '- Current run: ' + report.comparison.current.id + '.',
    '- Same definitions: ' + report.comparison.compatibility.sameConfig + '; same scope: ' + report.comparison.compatibility.sameScope + '.',
    '- Newly emitted: ' + report.comparison.alerts.new.length + '; no longer emitted: ' + report.comparison.alerts.resolved.length + '; persisting: ' + report.comparison.alerts.persisting.length + '.',
    '', 'The JSON digest retains the original cohort denominators, sample suppression and exact source-member changes. ' + report.comparison.interpretation);
  lines.push('', '## Capture and analysis continuity', '', '| Scheduled cycle | State | Actual capture | Actual analysis | Retained issue |', '| --- | --- | --- | --- | --- |');
  for (const item of report.coverage.cycles) lines.push('| ' + [item.scheduledFor, item.status, item.jobId ?? '', item.runId ?? '', item.error?.message ?? ''].map(md).join(' | ') + ' |');
  if (!report.coverage.cycles.length) lines.push('| No scheduled cycle belongs to this interval | | | | |');
  for (const item of report.coverage.unavailableAtCutoff) lines.push('- Run ' + item.runId + ' became available after the cutoff: source ' + item.sourceAvailableAt + '; analysis ' + item.analysisAvailableAt + '.');
  for (const item of report.pending) lines.push('- ' + md(item.kind) + ' ' + md(item.id) + ': ' + md(item.status) + (item.error ? ' — ' + md(item.error.message) : ''));
  lines.push('', '## Interpretation', '', report.interpretation, '');
  return lines.join('\n');
}

export function installAutomation(workspace, options = {}) {
  const { store, provider, background } = workspace;
  const clock = typeof options.automationClock === 'function' ? options.automationClock : Date.now;
  const instant = () => new Date(clock()).toISOString();
  let timer = null, ticking = null, stopped = false, lastTickAt = null, lastError = null;
  const all = (projectId, kind) => store.db.prepare('SELECT value FROM objects WHERE project_id=? AND kind=? ORDER BY created_at,id').all(projectId, kind).map(x => JSON.parse(x.value));
  const scheduleFor = projectId => all(projectId, 'automation')[0] ?? null;
  const requireVersion = (value, version) => requireThat(version === (value?.version ?? 0), 'STALE_AUTOMATION', 'Monitoring settings changed; inspect and reapply the current draft', 409);
  const getCycle = cycleId => store.get(cycleId, 'automation_cycle');
  const saveCycle = value => store.put('automation_cycle', { ...value, updatedAt: instant() });
  const errorOf = (code, message) => ({ code, message, at: instant() });
  const markNeedsReview = (schedule, error) => {
    store.transaction(() => {
      store.put('automation', { ...schedule, status: 'needs_review', version: schedule.version + 1, error, updatedAt: instant() });
      store.event(schedule.projectId, schedule.id, 'automation_needs_review', { error });
    });
  };
  function assertBindings(schedule) {
    requireThat(provider.info().configured, 'PROVIDER_NOT_CONFIGURED', 'Configure the permitted HubSpot account on this operator host');
    requireThat(schedule.credentialBinding === provider.binding(), 'PROVIDER_CHANGED', 'The monitoring provider identity changed; review and bind the schedule to this receiving host');
    requireThat(schedule.configSha256 === digest(store.project(schedule.projectId).config), 'CONFIGURATION_CHANGED', 'Pipeline definitions changed; review and bind monitoring to the selected definitions');
  }
  function requestStep(cycleId, name, method, targetId, data, config = null) {
    let cycle = getCycle(cycleId), step = cycle.steps[name];
    if (!step) {
      const requestId = 'monitor-' + digest({ cycleId, name, generation: name.startsWith('resume-') ? cycle.retryGeneration ?? 0 : 0 });
      step = { request: { ...data, actor: cycle.actor, requestId }, targetId, method };
      cycle = saveCycle({ ...cycle, steps: { ...cycle.steps, [name]: step } });
    }
    const scope = method === 'startSync' ? 'sync:' + targetId : method === 'startRun' ? 'run:' + targetId
      : method === 'resumeJob' ? 'resume_job:' + targetId : 'resume_original_run:' + targetId;
    const recorded = store.db.prepare('SELECT fingerprint FROM requests WHERE scope=? AND key=?').get(scope, step.request.requestId);
    if (!recorded && Object.hasOwn(step.request, 'revision')) {
      // Uncommitted reservation revisions may advance; a committed request is replayed unchanged.
      const revision = store.project(cycle.projectId).revision;
      if (step.request.revision !== revision) {
        step = { ...step, request: { ...step.request, revision } };
        cycle = saveCycle({ ...cycle, steps: { ...cycle.steps, [name]: step } });
      }
    }
    return workspace[method](targetId, step.request, config);
  }
  function cycleValue(schedule, scheduledFor, reason, coalesced, actor) {
    const at = instant(), scheduled = reason !== 'manual';
    return { id: scheduled ? digest({ scheduleId: schedule.id, version: schedule.version, scheduledFor }) : id(),
      projectId: schedule.projectId, scheduleId: schedule.id, scheduleVersion: schedule.version,
      actor, status: 'reserved', reason, scheduledFor, reservedAt: at, createdAt: at, updatedAt: at,
      timeZone: schedule.settings.timeZone, boundaryAt: at, capturedConfig: structuredClone(schedule.capturedConfig),
      configSha256: schedule.configSha256, credentialBinding: schedule.credentialBinding,
      missedCaptureSlots: coalesced, jobId: null, snapshotId: null, runId: null, retryCount: 0, retryAt: null,
      steps: {}, error: null, errors: [] };
  }
  function reserveCycle(schedule, scheduledFor, reason, coalesced, nextCaptureAt) {
    return store.transaction(() => {
      const current = store.get(schedule.id, 'automation');
      if (current.activeCycleId) return getCycle(current.activeCycleId);
      requireThat(current.status === 'enabled', 'AUTOMATION_PAUSED', 'Resume monitoring before starting a capture', 409);
      assertBindings(current);
      const cycle = cycleValue(current, scheduledFor, reason, coalesced, current.actor);
      requireThat(!store.db.prepare('SELECT id FROM objects WHERE id=?').get(cycle.id), 'CYCLE_ALREADY_RETAINED', 'This exact scheduled cycle is already retained; inspect its completed outcome', 409);
      store.put('automation_cycle', cycle);
      store.put('automation', { ...current, activeCycleId: cycle.id, nextCaptureAt, updatedAt: instant() });
      store.event(current.projectId, cycle.id, 'automation_cycle_reserved', { scheduledFor, boundaryAt: cycle.boundaryAt, missedCaptureSlots: coalesced, reason });
      return cycle;
    });
  }
  function failCycle(cycle, error) {
    store.transaction(() => {
      const current = getCycle(cycle.id);
      saveCycle({ ...current, status: 'failed', retryAt: null, error: portableError(error), errors: [...current.errors, portableError(error)] });
      const schedule = store.get(cycle.scheduleId, 'automation');
      store.put('automation', { ...schedule, status: 'needs_review', version: schedule.version + 1, error: portableError(error), updatedAt: instant() });
      store.event(cycle.projectId, cycle.id, 'automation_cycle_stopped', { jobId: current.jobId, runId: current.runId, error: portableError(error) });
    });
  }
  function completed(cycle, run) {
    store.transaction(() => {
      const current = getCycle(cycle.id); if (current.status === 'completed') return;
      saveCycle({ ...current, status: 'completed', runId: run.id, snapshotId: run.snapshotId, completedAt: instant(), retryAt: null, error: null });
      const schedule = store.get(cycle.scheduleId, 'automation');
      store.put('automation', { ...schedule, activeCycleId: schedule.activeCycleId === cycle.id ? null : schedule.activeCycleId,
        lastCompletedCycleId: cycle.id, updatedAt: instant() });
      store.event(cycle.projectId, cycle.id, 'automation_cycle_completed', { jobId: current.jobId, snapshotId: run.snapshotId, runId: run.id,
        scheduledFor: current.scheduledFor, completedAt: instant() });
    });
  }
  function advanceCycle(cycleId) {
    let cycle = getCycle(cycleId);
    if (!ACTIVE.has(cycle.status)) return;
    try {
      requireThat(cycle.credentialBinding === provider.binding(), 'PROVIDER_CHANGED', 'This original capture belongs to a different provider binding');
      if (!cycle.jobId) {
        const occupied = [...background.keys()].some(key => { try { return store.get(key, 'job').kind === 'source_sync'; } catch { return false; } });
        if (occupied) return;
        const capture = requestStep(cycle.id, 'capture', 'startSync', cycle.projectId, {
          revision: store.project(cycle.projectId).revision, name: 'Scheduled source ' + cycle.scheduledFor,
          automationCycleId: cycle.id, configSha256: cycle.configSha256
        }, cycle.capturedConfig);
        cycle = saveCycle({ ...getCycle(cycle.id), status: 'capturing', jobId: capture.job.id, error: null });
      }
      const job = store.get(cycle.jobId, 'job');
      if (job.status !== 'completed') {
        if (background.has(job.id)) return;
        if (['failed', 'cancelled', 'interrupted'].includes(job.status)) {
          const requestedCancel = store.events(cycle.projectId, job.id, 10000).some(x => x.kind === 'capture_cancel_requested' && x.seq > (cycle.acceptedCancelSeq ?? 0));
          requireThat(!requestedCancel, 'CAPTURE_CANCELLED', 'An operator cancelled this capture. Inspect it before retrying this monitoring cycle');
          const transient = ['interrupted', 'cancelled'].includes(job.status) || /^(?:HUBSPOT_HTTP_(?:429|5\d\d)|TypeError|TimeoutError|AbortError|PROCESS_INTERRUPTED|OPERATION_FAILED)$/.test(job.error?.code ?? 'OPERATION_FAILED');
          requireThat(transient || cycle.allowNamedRetry, job.error?.code ?? 'CAPTURE_FAILED', job.error?.message ?? 'Original capture failed; inspect the retained provider/source response');
          requireThat(cycle.retryCount < 6, 'AUTOMATION_RETRY_LIMIT', 'Six retained capture continuations failed; inspect the original job before a named retry');
          if (!cycle.retryAt) {
            const delay = ['interrupted', 'cancelled'].includes(job.status) || cycle.allowNamedRetry ? 0 : Math.min(3600000, MINUTE * 2 ** cycle.retryCount);
            const retryAt = new Date(Math.max(clock() + delay, Date.parse(job.retryAt ?? '1970-01-01T00:00:00Z'))).toISOString();
            cycle = saveCycle({ ...cycle, status: 'retry_wait', retryAt, error: job.error ?? null, errors: job.error ? [...cycle.errors, job.error] : cycle.errors });
          }
          if (Date.parse(cycle.retryAt) > clock()) return;
          requestStep(cycle.id, 'resume-capture-' + cycle.retryCount, 'resumeJob', job.id, {});
          cycle = saveCycle({ ...getCycle(cycle.id), status: 'capturing', retryCount: cycle.retryCount + 1, retryAt: null, error: null, allowNamedRetry: false });
        }
        return;
      }
      if (!cycle.snapshotId) cycle = saveCycle({ ...cycle, snapshotId: job.snapshotId, status: 'analysing', error: null, retryAt: null });
      if (!cycle.runId) {
        const snapshot = store.get(cycle.snapshotId, 'snapshot');
        const result = requestStep(cycle.id, 'analysis', 'startRun', cycle.projectId, {
          revision: store.project(cycle.projectId).revision, snapshotId: snapshot.id,
          name: 'Scheduled review ' + cycle.scheduledFor, asOf: snapshot.observedThrough ?? snapshot.capturedAt,
          automationCycleId: cycle.id, configSha256: cycle.configSha256
        }, cycle.capturedConfig);
        cycle = saveCycle({ ...getCycle(cycle.id), status: 'analysing', runId: result.run.id });
      }
      const run = store.get(cycle.runId, 'run');
      if (run.status === 'completed') return completed(cycle, run);
      if ((run.status === 'interrupted' || run.status === 'failed' && cycle.allowNamedRetry) && !background.has(run.id)) {
        requestStep(cycle.id, 'resume-analysis-' + (run.continuations?.length ?? 0), 'resumeOriginalRun', run.id, { note: cycle.retryNote ?? 'Resume the retained scheduled analysis after process interruption' });
        saveCycle({ ...getCycle(cycle.id), allowNamedRetry: false });
      } else if (run.status === 'failed') requireThat(false, run.error?.code ?? 'ANALYSIS_FAILED', run.error?.message ?? 'Inspect this original analysis before continuing monitoring');
    } catch (error) { failCycle(getCycle(cycle.id), error); }
  }
  function readReview(projectId, fingerprint) {
    const row = store.db.prepare('SELECT value FROM reviews WHERE project_id=? AND fingerprint=?').get(projectId, fingerprint);
    return row ? JSON.parse(row.value) : { version: 0, status: 'open', actor: '', note: '', assignee: '', dueAt: null, updatedAt: null };
  }
  function buildDigest(projectId, input) {
    const schedule = scheduleFor(projectId), settings = input.settings ?? schedule?.settings ?? AUTOMATION_DEFAULTS;
    const end = input.period.end, start = input.period.start, cutoff = input.cutoff;
    const completedRuns = all(projectId, 'run').filter(x => x.status === 'completed' && Date.parse(x.asOf) <= Date.parse(cutoff));
    const availability = run => {
      const snapshot = store.get(run.snapshotId, 'snapshot');
      return { sourceAvailableAt: snapshot.observedThrough ?? snapshot.capturedAt, analysisAvailableAt: run.completedAt };
    };
    const eligible = run => { const value = availability(run); return Date.parse(value.sourceAvailableAt) <= Date.parse(cutoff) && Date.parse(value.analysisAvailableAt) <= Date.parse(cutoff); };
    const candidates = completedRuns.filter(eligible)
      .sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf) || Date.parse(a.completedAt) - Date.parse(b.completedAt) || a.id.localeCompare(b.id));
    const unavailableAtCutoff = completedRuns.filter(run => !eligible(run)).map(run => ({ runId: run.id, snapshotId: run.snapshotId,
      asOf: run.asOf, ...availability(run), status: 'available_after_cutoff' }));
    const current = candidates.at(-1) ?? null, selected = current ? workspace.runReport(current.id) : null;
    const inPeriod = candidates.filter(x => Date.parse(x.asOf) > Date.parse(start.at) && Date.parse(x.asOf) <= Date.parse(end.at));
    const baseline = inPeriod.length > 1 ? inPeriod[0] : candidates.filter(x => Date.parse(x.asOf) <= Date.parse(start.at)).at(-1) ?? null;
    const within = value => Date.parse(value) > Date.parse(start.at) && Date.parse(value) <= Date.parse(end.at);
    const cycles = all(projectId, 'automation_cycle').filter(x => within(x.scheduledFor) || within(x.reservedAt));
    const pending = [...all(projectId, 'job').map(x => ({ ...x, kind: 'capture' })), ...all(projectId, 'run').map(x => ({ ...x, kind: 'analysis' }))]
      .filter(x => !['completed', 'historical'].includes(x.status)).map(x => ({ id: x.id, kind: x.kind, status: x.status, error: x.error ?? null, createdAt: x.createdAt }));
    const reviews = selected ? selected.alerts.map(alert => ({ dealId: alert.dealId, fingerprint: alert.fingerprint, review: readReview(projectId, alert.fingerprint) })) : [];
    const byFingerprint = new Map(reviews.map(x => [x.fingerprint, x.review])), counts = { open: 0, confirmed: 0, dismissed: 0, resolved: 0, deferred: 0 };
    for (const item of reviews) counts[item.review.status]++;
    const actionable = selected ? selected.alerts.map(alert => ({ ...alert, review: byFingerprint.get(alert.fingerprint) })).filter(x =>
      ['open', 'confirmed'].includes(x.review.status) || x.review.status === 'deferred' && Date.parse(x.review.dueAt) <= Date.parse(cutoff)) : [];
    const snapshot = selected ? store.get(current.snapshotId, 'snapshot') : null;
    const comparison = current && baseline && current.id !== baseline.id ? workspace.compare(current.id, baseline.id) : null;
    return { schema: 'commons.hubspot.manager-digest.v1', id: id(), projectId, projectName: store.project(projectId).name,
      name: text(input.name, 'digest name', 160), kind: input.kind, mode: input.mode, frozenAt: instant(), cutoff,
      period: { ...input.period, timeZone: settings.timeZone }, scheduleId: schedule?.id ?? null, scheduleVersion: input.scheduleVersion ?? schedule?.version ?? null,
      selected: selected ? { runId: current.id, snapshotId: snapshot.id, sourceSha256: snapshot.sourceSha256,
        reportFileId: current.reportFileId, reportSha256: store.readFile(current.reportFileId).sha256,
        configSha256: current.configSha256, asOf: current.asOf, ...availability(current), observedFrom: snapshot.observedFrom ?? null,
        observedThrough: snapshot.observedThrough ?? null, sourceKind: snapshot.kind, complete: snapshot.complete,
        completeness: snapshot.completeness, sourceAgeMinutes: Math.max(0, Math.round((Date.parse(cutoff) - Date.parse(snapshot.observedThrough ?? snapshot.capturedAt)) / MINUTE)),
        summary: current.summary } : null,
      coverage: { completedRunsInPeriod: inPeriod.length, runIds: inPeriod.map(x => x.id), unavailableAtCutoff,
        coalescedDigestBoundaries: input.coalescedDigestBoundaries ?? 0, missedFrom: input.missedFrom ?? null,
        missedCaptureSlots: cycles.reduce((sum, x) => sum + x.missedCaptureSlots, 0),
        cycles: cycles.map(x => ({ id: x.id, status: x.status, scheduledFor: x.scheduledFor, reservedAt: x.reservedAt,
          completedAt: x.completedAt ?? null, missedCaptureSlots: x.missedCaptureSlots, jobId: x.jobId,
          snapshotId: x.snapshotId, runId: x.runId, error: x.error, retryAt: x.retryAt })) },
      attention: { total: actionable.length, items: actionable.slice(0, 25), limit: 25 },
      decisions: { observedAt: instant(), counts, items: reviews }, cohorts: selected?.report.cohorts ?? [], comparison, pending,
      interpretation: 'This digest freezes the original emitted alerts, current named review decisions and actual retained cohort members. Capture time, analysis cutoff and review-observation time are separate. Missed intervals have no invented CRM observations. A stale record update is not proof of no customer contact; cohort changes and no-longer-emitted alerts do not establish conversion uplift or individual performance. Native task/note creation continues through its original explicit approval workflow.' };
  }
  function retainDigest(projectId, input) {
    // All selected original run/report inputs must resolve before any output is published.
    const report = buildDigest(projectId, input), json = store.file(projectId, report.kind + '-manager-digest.json', jsonBytes(report));
    const markdown = store.file(projectId, report.kind + '-manager-digest.md', Buffer.from(markdownDigest(report)));
    const runIds = [...new Set([report.selected?.runId, report.comparison?.baseline.id, ...report.coverage.runIds].filter(Boolean))];
    const output = { id: report.id, projectId, scheduleId: report.scheduleId, scheduleVersion: report.scheduleVersion,
      name: report.name, kind: report.kind, mode: report.mode, createdAt: report.frozenAt, cutoff: report.cutoff, period: report.period,
      fileId: json.id, sha256: json.sha256, markdownFileId: markdown.id, markdownSha256: markdown.sha256,
      selectedRunId: report.selected?.runId ?? null, sourceDigestId: report.id, runIds, sourceRunIds: [...runIds],
      sourceSnapshotIds: runIds.map(runId => store.get(runId, 'run').snapshotId), snapshotIds: runIds.map(runId => store.get(runId, 'run').snapshotId),
      attentionCount: report.attention.total, emittedAlertCount: report.selected?.summary.alerts ?? null,
      pendingCount: report.pending.length, missedCaptureSlots: report.coverage.missedCaptureSlots,
      coalescedDigestBoundaries: report.coverage.coalescedDigestBoundaries, status: report.selected ? 'ready' : 'no_completed_source' };
    store.put('automation_digest', output);
    store.event(projectId, output.id, 'manager_digest_frozen', { kind: output.kind, period: output.period, cutoff: output.cutoff,
      fileId: output.fileId, sha256: output.sha256, runIds, actor: input.actor });
    return output;
  }
  function scheduledDigest(schedule, kind, boundary) {
    let pending = schedule.pendingDigests?.[kind] ?? null;
    if (!pending) {
      const latest = calendarBoundary(schedule.settings, kind, instant(), 'previous');
      const start = calendarBoundary(schedule.settings, kind, new Date(Date.parse(latest.at) - 1).toISOString(), 'previous');
      const coalesced = Math.max(0, Math.round((Date.parse(latest.localDate) - Date.parse(boundary.localDate)) / DAY / (kind === 'weekly' ? 7 : 1)));
      const request = { actor: schedule.actor, requestId: 'digest-' + digest({ scheduleId: schedule.id, kind, cutoff: latest.at }),
        kind, mode: 'scheduled', name: (kind === 'weekly' ? 'Weekly' : 'Daily') + ' manager digest ' + latest.localDate,
        cutoff: latest.at, period: { start, end: latest }, coalescedDigestBoundaries: coalesced, missedFrom: coalesced ? boundary.at : null,
        settings: structuredClone(schedule.settings), scheduleVersion: schedule.version };
      pending = { request, status: 'reserved', createdAt: instant(), error: null };
      store.transaction(() => {
        const current = store.get(schedule.id, 'automation');
        requireThat(['enabled', 'needs_review'].includes(current.status) && current.version === schedule.version &&
          canonical(current.nextDigest[kind]) === canonical(boundary) && !current.pendingDigests?.[kind],
          'DIGEST_BOUNDARY_CHANGED', 'The saved reporting boundary changed', 409);
        store.put('automation', { ...current, pendingDigests: { ...current.pendingDigests, [kind]: pending }, updatedAt: instant() });
        store.event(current.projectId, current.id, 'manager_digest_reserved', { kind, cutoff: request.cutoff, period: request.period, requestId: request.requestId });
      });
    }
    try {
      return store.mutation('scheduled_digest:' + schedule.id + ':' + kind, pending.request, () => {
        const current = store.get(schedule.id, 'automation');
        requireThat(current.pendingDigests?.[kind]?.request.requestId === pending.request.requestId,
          'DIGEST_RESERVATION_CHANGED', 'The retained reporting reservation changed', 409);
        const output = retainDigest(schedule.projectId, pending.request), end = pending.request.period.end;
        const next = current.nextDigest[kind] && Date.parse(current.nextDigest[kind].at) > Date.parse(end.at)
          ? current.nextDigest[kind] : current.settings[kind].enabled ? calendarBoundary(current.settings, kind, end.at) : null;
        store.put('automation', { ...current, pendingDigests: { ...current.pendingDigests, [kind]: null },
          nextDigest: { ...current.nextDigest, [kind]: next }, lastDigestIds: { ...current.lastDigestIds, [kind]: output.id }, updatedAt: instant() });
        return { digest: output };
      });
    } catch (error) {
      const current = store.get(schedule.id, 'automation');
      if (current.pendingDigests?.[kind]?.request.requestId === pending.request.requestId)
        store.put('automation', { ...current, pendingDigests: { ...current.pendingDigests, [kind]: { ...pending, status: 'failed', error: portableError(error), retryAt: new Date(clock() + MINUTE).toISOString() } } });
      throw error;
    }
  }
  const originalClose = workspace.close.bind(workspace);
  Object.assign(workspace, {
    automationState(projectId) {
      store.project(projectId); const schedule = scheduleFor(projectId);
      const cycles = store.list(projectId, 'automation_cycle'), digests = store.list(projectId, 'automation_digest');
      const reviews = new Map(all(projectId, 'automation_digest_review').map(x => [x.digestId, x]));
      const total = kind => store.db.prepare('SELECT count(*) AS n FROM objects WHERE project_id=? AND kind=?').get(projectId, kind).n;
      return { schedule: clean(schedule), defaults: structuredClone(AUTOMATION_DEFAULTS),
        cycles: cycles.map(clean), digests: digests.map(x => ({ ...x, review: reviews.get(x.id) ?? null })),
        totals: { cycles: total('automation_cycle'), digests: total('automation_digest') },
        worker: { running: timer !== null, lastTickAt, lastError }, provider: provider.info(),
        currentConfigSha256: digest(store.project(projectId).config) };
    },
    configureAutomation(projectId, input) {
      const settings = normalizeSettings(input.settings);
      return store.mutation('configure_automation:' + projectId, input, () => {
        const project = store.project(projectId, input.revision), old = scheduleFor(projectId); requireVersion(old, input.version);
        requireThat(typeof input.enabled === 'boolean', 'AUTOMATION_ENABLED', 'Choose whether monitoring is enabled');
        if (input.enabled) requireThat(provider.info().configured, 'PROVIDER_NOT_CONFIGURED', 'Configure the permitted provider before enabling monitoring');
        if (old?.activeCycleId) {
          const active = getCycle(old.activeCycleId);
          requireThat(active.configSha256 === digest(project.config) && active.credentialBinding === provider.binding(), 'ACTIVE_CYCLE_BINDING', 'Finish or abandon the retained capture before changing its provider or definitions');
        }
        const at = instant(), schedule = { id: old?.id ?? id(), projectId, createdAt: old?.createdAt ?? at,
          version: (old?.version ?? 0) + 1, actor: text(input.actor, 'operator'), status: input.enabled ? 'enabled' : 'paused', settings,
          capturedConfig: structuredClone(project.config), configSha256: digest(project.config), credentialBinding: provider.binding(),
          nextCaptureAt: iso(input.firstCaptureAt ?? at, 'first capture time'),
          nextDigest: Object.fromEntries(['daily', 'weekly'].map(kind => [kind, settings[kind].enabled ? calendarBoundary(settings, kind, at) : null])),
          pendingDigests: old?.pendingDigests ?? {}, activeCycleId: old?.activeCycleId ?? null,
          lastCompletedCycleId: old?.lastCompletedCycleId ?? null, lastDigestIds: old?.lastDigestIds ?? {},
          error: null, note: text(input.note ?? '', 'operating note', 5000, true), updatedAt: at, receivedFrom: old?.receivedFrom ?? null };
        store.put('automation', schedule);
        store.bump(project, input.actor, 'automation_configured', { scheduleId: schedule.id, version: schedule.version, settings, configSha256: schedule.configSha256, status: schedule.status });
        return { schedule: clean(schedule) };
      });
    },
    pauseAutomation(projectId, input) {
      return store.mutation('pause_automation:' + projectId, input, () => {
        const schedule = scheduleFor(projectId); requireThat(schedule, 'AUTOMATION_MISSING', 'Save monitoring settings first'); requireVersion(schedule, input.version);
        const updated = { ...schedule, version: schedule.version + 1, status: 'paused', note: text(input.note, 'pause note', 5000), updatedAt: instant() };
        store.put('automation', updated); store.event(projectId, schedule.id, 'automation_paused', { actor: input.actor, note: updated.note, activeCycleId: schedule.activeCycleId });
        return { schedule: clean(updated) };
      });
    },
    resumeAutomation(projectId, input) {
      return store.mutation('resume_automation:' + projectId, input, () => {
        const project = store.project(projectId, input.revision), schedule = scheduleFor(projectId);
        requireThat(schedule, 'AUTOMATION_MISSING', 'Save monitoring settings first'); requireVersion(schedule, input.version);
        const changed = schedule.credentialBinding !== provider.binding() || schedule.configSha256 !== digest(project.config) || schedule.receivedFrom;
        requireThat(provider.info().configured, 'PROVIDER_NOT_CONFIGURED', 'Configure the original provider on this host');
        requireThat(!changed || input.bindCurrentProviderAndDefinitions === true, 'AUTOMATION_REBIND', 'Review the current provider and definitions, then explicitly bind this received or changed schedule');
        if (schedule.activeCycleId) {
          const cycle = getCycle(schedule.activeCycleId);
          requireThat(ACTIVE.has(cycle.status), 'CYCLE_REVIEW_REQUIRED', 'Retry or abandon the stopped cycle before resuming the schedule');
          requireThat(cycle.credentialBinding === provider.binding() && cycle.configSha256 === digest(project.config), 'ACTIVE_CYCLE_BINDING', 'The retained capture belongs to its original provider and definitions; abandon it before rebinding');
        }
        const at = instant(), updated = { ...schedule, version: schedule.version + 1, status: 'enabled', actor: input.actor,
          capturedConfig: structuredClone(project.config), configSha256: digest(project.config), credentialBinding: provider.binding(),
          nextCaptureAt: schedule.nextCaptureAt ?? at, receivedFrom: null, error: null,
          nextDigest: changed ? Object.fromEntries(['daily', 'weekly'].map(kind => [kind, schedule.settings[kind].enabled ? calendarBoundary(schedule.settings, kind, at) : null])) : schedule.nextDigest,
          note: text(input.note, 'resume note', 5000), updatedAt: at };
        store.put('automation', updated); store.bump(project, input.actor, 'automation_resumed', { scheduleId: schedule.id, rebound: Boolean(changed), configSha256: updated.configSha256, note: updated.note });
        return { schedule: clean(updated) };
      });
    },
    triggerAutomation(projectId, input) {
      return store.mutation('trigger_automation:' + projectId, input, () => {
        const schedule = scheduleFor(projectId); requireThat(schedule, 'AUTOMATION_MISSING', 'Save monitoring settings first'); requireVersion(schedule, input.version);
        requireThat(schedule.status === 'enabled', 'AUTOMATION_PAUSED', 'Resume monitoring before requesting a capture', 409); assertBindings(schedule);
        if (schedule.activeCycleId) return { cycle: clean(getCycle(schedule.activeCycleId)), joined: true };
        const at = instant(), due = Date.parse(schedule.nextCaptureAt) <= clock();
        const scheduledFor = due ? schedule.nextCaptureAt : at, interval = schedule.settings.captureEveryMinutes * MINUTE;
        const missed = due ? Math.floor((clock() - Date.parse(scheduledFor)) / interval) : 0;
        const cycle = cycleValue(schedule, scheduledFor, due ? 'scheduled_due_manual_wake' : 'manual', missed, input.actor);
        requireThat(!store.db.prepare('SELECT id FROM objects WHERE id=?').get(cycle.id), 'CYCLE_ALREADY_RETAINED', 'This exact scheduled cycle is already retained', 409);
        store.put('automation_cycle', cycle);
        store.put('automation', { ...schedule, activeCycleId: cycle.id, nextCaptureAt: due ? new Date(Date.parse(scheduledFor) + (missed + 1) * interval).toISOString() : schedule.nextCaptureAt, updatedAt: at });
        store.event(projectId, cycle.id, 'automation_cycle_reserved', { actor: input.actor, scheduledFor, boundaryAt: at, missedCaptureSlots: missed, reason: cycle.reason });
        return { cycle: clean(cycle), joined: false };
      });
    },
    retryAutomationCycle(cycleId, input) {
      return store.mutation('retry_automation_cycle:' + cycleId, input, () => {
        const cycle = getCycle(cycleId), schedule = store.get(cycle.scheduleId, 'automation'); requireVersion(schedule, input.version);
        requireThat(cycle.status === 'failed' && schedule.activeCycleId === cycle.id, 'CYCLE_STATE', 'Select the current stopped monitoring cycle');
        requireThat(cycle.credentialBinding === provider.binding(), 'PROVIDER_CHANGED', 'Resume only against the original capture provider');
        if (cycle.jobId) requireThat(store.get(cycle.jobId, 'job').status !== 'historical', 'HISTORICAL_CAPTURE', 'A received original capture remains historical');
        const note = text(input.note, 'retry note', 5000), generation = (cycle.retryGeneration ?? 0) + 1, steps = { ...cycle.steps };
        // Preserve each earlier request receipt; a new named continuation uses its own exact request identity.
        for (const key of Object.keys(steps)) if (key.startsWith('resume-')) { steps['previous-' + generation + '-' + key] = steps[key]; delete steps[key]; }
        const acceptedCancelSeq = cycle.jobId ? Math.max(0, ...store.events(cycle.projectId, cycle.jobId, 10000).filter(x => x.kind === 'capture_cancel_requested').map(x => x.seq)) : 0;
        saveCycle({ ...cycle, status: cycle.runId ? 'analysing' : cycle.jobId ? 'capturing' : 'reserved',
          retryCount: 0, retryAt: null, error: null, steps, retryGeneration: generation, actor: input.actor,
          allowNamedRetry: true, retryNote: note, acceptedCancelSeq });
        store.put('automation', { ...schedule, status: 'enabled', version: schedule.version + 1, error: null, updatedAt: instant() });
        store.event(cycle.projectId, cycle.id, 'automation_named_retry', { actor: input.actor, note, generation });
        return { cycle: clean(getCycle(cycle.id)) };
      });
    },
    abandonAutomationCycle(cycleId, input) {
      const result = store.mutation('abandon_automation_cycle:' + cycleId, input, () => {
        const cycle = getCycle(cycleId), schedule = store.get(cycle.scheduleId, 'automation'); requireVersion(schedule, input.version);
        requireThat(schedule.activeCycleId === cycle.id && !['completed', 'abandoned', 'received_interrupted'].includes(cycle.status), 'CYCLE_STATE', 'Select the current incomplete cycle');
        const note = text(input.note, 'abandonment note', 5000);
        saveCycle({ ...cycle, status: 'abandoned', abandonedAt: instant(), error: errorOf('OPERATOR_ABANDONED', note), retryAt: null });
        store.put('automation', { ...schedule, activeCycleId: null, status: 'paused', version: schedule.version + 1, updatedAt: instant(), error: null });
        if (cycle.jobId && background.has(cycle.jobId)) store.event(cycle.projectId, cycle.jobId, 'capture_cancel_requested', { actor: input.actor, cycleId });
        store.event(cycle.projectId, cycle.id, 'automation_cycle_abandoned', { actor: input.actor, note });
        return { cycle: clean(getCycle(cycle.id)) };
      });
      if (result.cycle.jobId) background.get(result.cycle.jobId)?.controller.abort(new Error('Monitoring capture abandoned by operator'));
      return result;
    },
    automationCycle(cycleId) {
      const cycle = getCycle(cycleId);
      return { cycle: clean(cycle), job: cycle.jobId ? workspace.job(cycle.jobId).job : null,
        run: cycle.runId ? summary(store.get(cycle.runId, 'run')) : null, history: store.events(cycle.projectId, cycle.id, 1000) };
    },
    createManagerDigest(projectId, input) {
      requireThat(['daily', 'weekly'].includes(input.kind), 'DIGEST_KIND', 'Choose daily or weekly');
      return store.mutation('manager_digest:' + projectId, input, () => {
        store.project(projectId);
        const schedule = scheduleFor(projectId), settings = schedule?.settings ?? AUTOMATION_DEFAULTS, cutoff = iso(input.cutoff ?? instant(), 'digest cutoff');
        requireThat(Date.parse(cutoff) <= clock(), 'FUTURE_DIGEST', 'The reporting cutoff cannot be in the future');
        const start = calendarBoundary(settings, input.kind, new Date(Date.parse(cutoff) - 1).toISOString(), 'previous');
        const end = { at: cutoff, localDate: dayKey(wall(parts(Date.parse(cutoff), settings.timeZone))), timeZone: settings.timeZone,
          requestedTime: null, adjustmentMinutes: 0, repeatedTime: false };
        return { digest: retainDigest(projectId, { ...input, mode: 'operator', cutoff, period: { start, end },
          name: input.name ?? (input.kind === 'weekly' ? 'Weekly' : 'Daily') + ' manager review ' + cutoff.slice(0, 10) }) };
      });
    },
    managerDigest(digestId) {
      const output = store.get(digestId, 'automation_digest'), file = store.readFile(output.fileId), markdown = store.readFile(output.markdownFileId);
      requireThat(file.sha256 === output.sha256 && markdown.sha256 === output.markdownSha256, 'DIGEST_CHANGED', 'The frozen digest files changed');
      const report = parse(file.data), review = all(output.projectId, 'automation_digest_review').find(x => x.digestId === output.id) ?? null;
      return { digest: output, report, review, bindings: output.runIds.map((runId, i) => ({ runId, snapshotId: output.snapshotIds[i],
        originalRunId: (output.sourceRunIds ?? output.runIds)[i],
        originalSnapshotId: (output.sourceSnapshotIds ?? output.snapshotIds)[i] })) };
    },
    reviewManagerDigest(digestId, input) {
      return store.mutation('review_manager_digest:' + digestId, input, () => {
        const output = store.get(digestId, 'automation_digest'); requireThat(input.sha256 === output.sha256, 'DIGEST_CHANGED', 'Review the exact frozen digest');
        const old = all(output.projectId, 'automation_digest_review').find(x => x.digestId === digestId) ?? null; requireVersion(old, input.version);
        requireThat(['acknowledged', 'follow_up'].includes(input.status), 'DIGEST_REVIEW_STATUS', 'Acknowledge the digest or retain follow-up');
        const review = { id: old?.id ?? id(), projectId: output.projectId, digestId, digestSha256: output.sha256,
          version: (old?.version ?? 0) + 1, status: input.status, actor: text(input.actor, 'reviewer'),
          note: text(input.note, 'digest review note', 5000), createdAt: old?.createdAt ?? instant(), updatedAt: instant() };
        store.put('automation_digest_review', review); store.event(output.projectId, digestId, 'manager_digest_reviewed', review);
        return { review };
      });
    },
    automationItems(projectId, kind, query = {}) {
      requireThat(['automation_cycle', 'automation_digest'].includes(kind), 'ITEM_KIND', 'Choose monitoring cycles or digests');
      store.project(projectId); const { offset, limit } = page(query);
      const total = store.db.prepare('SELECT count(*) AS n FROM objects WHERE project_id=? AND kind=?').get(projectId, kind).n;
      return { items: store.list(projectId, kind, { offset, limit }).map(clean), total, offset, limit };
    },
    async tickAutomation() {
      if (stopped) return { stopped: true };
      if (ticking) return ticking;
      ticking = Promise.resolve().then(() => {
        lastTickAt = instant(); lastError = null;
        for (let schedule of store.all('automation')) {
          if (!['enabled', 'needs_review'].includes(schedule.status)) continue;
          if (schedule.status === 'enabled') {
            try {
              if (schedule.activeCycleId) advanceCycle(schedule.activeCycleId);
              schedule = store.get(schedule.id, 'automation');
              if (schedule.status === 'enabled' && !schedule.activeCycleId) {
                assertBindings(schedule);
                if (Date.parse(schedule.nextCaptureAt) <= clock()) {
                  const anotherCapture = [...background.keys()].some(key => { try { return store.get(key, 'job').kind === 'source_sync'; } catch { return false; } });
                  if (!anotherCapture) {
                    const interval = schedule.settings.captureEveryMinutes * MINUTE, missed = Math.floor((clock() - Date.parse(schedule.nextCaptureAt)) / interval);
                    const cycle = reserveCycle(schedule, schedule.nextCaptureAt, 'scheduled', missed,
                      new Date(Date.parse(schedule.nextCaptureAt) + (missed + 1) * interval).toISOString());
                    advanceCycle(cycle.id);
                  }
                }
              }
            } catch (error) { markNeedsReview(store.get(schedule.id, 'automation'), portableError(error)); }
          }
          // Capture recovery and report cadence are separate. An explicit pause stops both.
          schedule = store.get(schedule.id, 'automation');
          for (const kind of ['daily', 'weekly']) {
            if (!['enabled', 'needs_review'].includes(schedule.status)) break;
            const boundary = schedule.nextDigest[kind], pending = schedule.pendingDigests?.[kind];
            if ((!pending?.retryAt || Date.parse(pending.retryAt) <= clock()) &&
                (pending || boundary && Date.parse(boundary.at) <= clock())) {
              try { scheduledDigest(schedule, kind, boundary); }
              catch (error) { markNeedsReview(store.get(schedule.id, 'automation'), portableError(error)); }
            }
            schedule = store.get(schedule.id, 'automation');
          }
        }
        return { at: lastTickAt, schedules: store.all('automation').map(clean) };
      }).catch(error => { lastError = portableError(error); return { at: lastTickAt, error: lastError }; }).finally(() => { ticking = null; });
      return ticking;
    },
    startAutomation() {
      requireThat(!stopped, 'WORKSPACE_CLOSED', 'Reopen the workspace before starting its monitor');
      if (timer) return;
      const interval = options.automationPollMs ?? 1000;
      requireThat(Number.isSafeInteger(interval) && interval >= 100 && interval <= 60000, 'POLL_INTERVAL', 'Monitoring poll interval must be 100–60000 ms');
      timer = setInterval(() => { workspace.tickAutomation(); }, interval); timer.unref?.();
      workspace.tickAutomation();
    },
    async stopAutomation() { stopped = true; if (timer) clearInterval(timer); timer = null; if (ticking) await ticking; },
    async close() { await workspace.stopAutomation(); return originalClose(); }
  });
  return workspace;
}

export function validateAutomationArchive(data) {
  const monitored = data.objects.some(x => x.kind === 'automation' || x.kind.startsWith('automation_'));
  if (!monitored) return;
  const objects = new Map(data.objects.map(x => [x.id, x])), files = new Map(data.files.map(x => [x.id, x]));
  requireThat(objects.size === data.objects.length && files.size === data.files.length &&
    ![...objects.keys()].some(key => files.has(key)), 'RESTORE_AUTOMATION', 'Retained monitoring identities repeat or overlap');
  const object = (objectId, kind) => {
    const row = objects.get(objectId);
    requireThat(row?.kind === kind && row.project_id === data.project.id, 'RESTORE_AUTOMATION', 'A monitoring reference is missing from the selected project');
    return row.value;
  };
  const file = fileId => { const row = files.get(fileId); requireThat(row, 'RESTORE_AUTOMATION', 'A frozen monitoring file is missing'); return row; };
  const schedules = data.objects.filter(x => x.kind === 'automation');
  requireThat(schedules.length <= 1, 'RESTORE_AUTOMATION', 'A project must have one current monitoring schedule');
  for (const row of data.objects) {
    const value = row.value;
    if (row.kind === 'automation') {
      normalizeSettings(value.settings);
      requireThat(Number.isSafeInteger(value.version) && value.version > 0 && digest(value.capturedConfig) === value.configSha256,
        'RESTORE_AUTOMATION', 'Retained monitoring settings or definitions differ');
      if (value.activeCycleId) requireThat(object(value.activeCycleId, 'automation_cycle').scheduleId === value.id,
        'RESTORE_AUTOMATION', 'The active cycle belongs to another schedule');
      for (const kind of ['daily', 'weekly']) {
        if (value.nextDigest?.[kind]) iso(value.nextDigest[kind].at, 'saved reporting boundary');
        if (value.pendingDigests?.[kind]) {
          const pending = value.pendingDigests[kind].request;
          requireThat(pending.kind === kind && pending.cutoff === pending.period.end.at, 'RESTORE_AUTOMATION', 'A pending digest cutoff differs');
          normalizeSettings(pending.settings); iso(pending.cutoff, 'pending cutoff');
        }
      }
    } else if (row.kind === 'automation_cycle') {
      object(value.scheduleId, 'automation'); iso(value.scheduledFor, 'scheduled capture');
      requireThat(digest(value.capturedConfig) === value.configSha256, 'RESTORE_AUTOMATION', 'A retained cycle definition changed');
      if (value.jobId) {
        const job = object(value.jobId, 'job');
        requireThat(job.automationCycleId === value.id && job.configSha256 === value.configSha256,
          'RESTORE_AUTOMATION', 'A capture belongs to a different original cycle or monitoring definition');
        if (job.snapshotId) object(job.snapshotId, 'snapshot');
        if (value.snapshotId) requireThat(job.snapshotId === value.snapshotId,
          'RESTORE_AUTOMATION', 'The scheduled cycle names a different original capture snapshot');
        for (const fileId of job.pageFiles ?? []) file(fileId);
      }
      if (value.snapshotId) { requireThat(value.jobId, 'RESTORE_AUTOMATION', 'A scheduled snapshot must retain its original capture job'); object(value.snapshotId, 'snapshot'); }
      if (value.runId) {
        const run = object(value.runId, 'run');
        requireThat(run.automationCycleId === value.id && run.snapshotId === value.snapshotId && run.configSha256 === value.configSha256,
          'RESTORE_AUTOMATION', 'The original scheduled analysis cycle, source or definitions differ');
      }
    } else if (row.kind === 'automation_digest') {
      const original = file(value.fileId), markdown = file(value.markdownFileId), report = parse(Buffer.from(original.contentBase64, 'base64'));
      requireThat(original.sha256 === value.sha256 && markdown.sha256 === value.markdownSha256 &&
        report.schema === 'commons.hubspot.manager-digest.v1' && report.id === (value.sourceDigestId ?? value.id) &&
        report.cutoff === value.cutoff && canonical(report.period) === canonical(value.period),
        'RESTORE_AUTOMATION', 'The frozen digest identity, reporting period or bytes differ');
      requireThat(Array.isArray(value.runIds) && Array.isArray(value.snapshotIds) && value.runIds.length === value.snapshotIds.length,
        'RESTORE_AUTOMATION', 'Frozen digest source bindings are incomplete');
      const sourceIds = value.sourceRunIds ?? value.runIds, sourceSnapshots = value.sourceSnapshotIds ?? value.snapshotIds;
      requireThat(Array.isArray(sourceIds) && Array.isArray(sourceSnapshots) && sourceSnapshots.length === value.snapshotIds.length &&
        sourceIds.length === value.runIds.length && new Set(sourceIds).size === sourceIds.length,
        'RESTORE_AUTOMATION', 'Frozen digest original run identities differ');
      for (let i = 0; i < value.runIds.length; i++) {
        const run = object(value.runIds[i], 'run'), snapshot = object(value.snapshotIds[i], 'snapshot');
        requireThat(run.snapshotId === snapshot.id && run.status === 'completed', 'RESTORE_AUTOMATION', 'A frozen digest run is not the retained completed source');
        if (report.selected?.runId === sourceIds[i]) requireThat(report.selected.snapshotId === sourceSnapshots[i] && file(run.reportFileId).sha256 === report.selected.reportSha256 &&
          snapshot.sourceSha256 === report.selected.sourceSha256 && run.configSha256 === report.selected.configSha256,
          'RESTORE_AUTOMATION', 'Selected digest analysis or source hashes differ');
      }
      if (report.selected) requireThat(sourceIds.includes(report.selected.runId), 'RESTORE_AUTOMATION', 'The digest selected source binding is missing');
    } else if (row.kind === 'automation_digest_review') {
      requireThat(object(value.digestId, 'automation_digest').sha256 === value.digestSha256,
        'RESTORE_AUTOMATION', 'A named digest review refers to different frozen bytes');
    }
  }
}
export function receiveAutomationObject(kind, value, original) {
  if (kind === 'automation') {
    value.receivedFrom = { scheduleId: original.id, version: original.version, status: original.status };
    value.status = 'paused'; value.version++; value.credentialBinding = null; value.activeCycleId = null; value.nextCaptureAt = null;
    value.receivedPendingDigests = original.receivedPendingDigests ?? original.pendingDigests ?? {};
    value.pendingDigests = {}; value.nextDigest = { daily: null, weekly: null };
    value.error = { code: 'RECEIVING_BINDINGS', message: 'Review the receiving provider and pipeline definitions, then explicitly resume monitoring' };
  } else if (kind === 'automation_cycle' && !['completed', 'abandoned', 'received_interrupted'].includes(value.status)) {
    value.receivedStatus = original.status; value.status = 'received_interrupted'; value.retryAt = null;
    value.receivingNote = 'The original unfinished capture remains historical. Receiving monitoring starts its own new capture after explicit binding.';
  } else if (kind === 'job' && value.status !== 'completed') {
    value.receivedStatus = original.receivedStatus ?? original.status; value.status = 'historical'; value.retryAt = null;
  }
  if (kind === 'job' || kind === 'automation_cycle') value.credentialBinding = null;
  if (kind === 'automation_digest') {
    value.sourceDigestId = original.sourceDigestId ?? original.id;
    value.sourceRunIds = original.sourceRunIds ?? original.runIds;
    value.sourceSnapshotIds = original.sourceSnapshotIds ?? original.snapshotIds;
  }
  return value;
}


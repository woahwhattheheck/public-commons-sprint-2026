// MIT. Operator-controlled recurring work over the original native Workflow owner.
import { canonical, digest, fail } from './records.mjs';
import { workflowCallId } from './workflow-records.mjs';
import { workflowAgendaRequest, workflowAgenda, workflowAgendaCalendar } from './workflow-series-agenda.mjs';
import { SERIES_SCHEMA, CYCLE_SCHEMA, SERIES_REVIEW_SCHEMA, SERIES_MAX_BYTES, SERIES_REQUEST_BYTES,
  plain, clone, same, seal, need, identifier, revision, note, fields, sha, seriesRequest, cycleRequest,
  resolvedCycleInputs, cycleId, cycleRunId, selectPointer, assignPointer, seriesCalendar } from './workflow-series-records.mjs';

const now = () => new Date().toISOString();
const summary = value => ({ id: value.id, profileId: value.profileId, revision: value.revision, name: value.name,
  customer: value.customer, task: value.task, workflowId: value.workflowId, workflowRevision: value.workflowRevision,
  enabled: value.enabled, cadence: value.cadence, updatedAt: value.updatedAt, contentSha256: value.contentSha256 });
export function createMerchantWorkflowSeries({ store, workflows, definitions, getHost, requireTool, requireOpen = () => {} }) {
  const db = store.db;
  function series(id, selectedRevision) {
    identifier(id);
    const row = selectedRevision === undefined ?
      db.prepare('SELECT value FROM workflow_series WHERE id=? ORDER BY revision DESC LIMIT 1').get(id) :
      db.prepare('SELECT value FROM workflow_series WHERE id=? AND revision=?').get(id, revision(selectedRevision));
    if (!row) throw fail('CONSOLE_SERIES_NOT_FOUND', 'Choose a saved recurring customer task.', 404);
    return JSON.parse(row.value);
  }
  function cycle(id) {
    const row = db.prepare('SELECT value FROM workflow_cycles WHERE id=?').get(identifier(id));
    if (!row) throw fail('CONSOLE_CYCLE_NOT_FOUND', 'Choose an original saved work period.', 404);
    return JSON.parse(row.value);
  }
  function cancellation(id) {
    const row = db.prepare('SELECT value FROM workflow_cycle_cancellations WHERE cycle_id=?').get(id);
    return row ? JSON.parse(row.value) : null;
  }
  function originalRun(value) {
    try {
      const run = workflows.records.run(value.runId);
      need(run.profileId === value.profileId && run.workflowId === value.workflowId && run.workflowRevision === value.workflowRevision &&
        run.workflowSha256 === value.workflowSha256 && run.inputsJson === value.inputsJson,
        'The selected cycle has a different original native run.', 'CONSOLE_CYCLE_RUN_CONFLICT', 409);
      return run;
    } catch (error) { if (error.code === 'CONSOLE_WORKFLOW_RUN_NOT_FOUND') return null; throw error; }
  }
  function resolvedDrafts(definition, inputs, runId, getDraft = (id, revision) => store.draft(id, revision)) {
    return definition.steps.map(step => {
      const draft = getDraft(step.draftId, step.draftRevision);
      need(draft, 'Retain the complete original native requests for this series.');
      let args = JSON.parse(draft.argumentsJson);
      const issues = [];
      for (const binding of step.bindings) {
        if (binding.from === 'step') continue;
        try {
          const source = binding.from === 'run' ? { id: runId, profileId: definition.profileId,
            stepId: step.id, requestId: workflowCallId(runId, step.id) } : inputs;
          args = assignPointer(args, binding.target, selectPointer(source, binding.pointer));
        } catch (error) { issues.push({ code: error.code, message: error.message, stepId: step.id, pointer: binding.pointer }); }
      }
      return { step, draft, args, issues };
    });
  }
  async function authorize(definition, inputs, context, runId = 'series-review', getDraft) {
    for (const value of resolvedDrafts(definition, inputs, runId, getDraft))
      await requireTool(context, value.draft.tool, value.args);
  }
  async function authorizeSeries(value, context) {
    const definition = workflows.records.definition(value.workflowId, value.workflowRevision);
    await authorize(definition, value.baseInputs, context);
    return definition;
  }
  async function authorizeCycle(value, context) {
    const definition = workflows.records.definition(value.workflowId, value.workflowRevision);
    await authorize(definition, JSON.parse(value.inputsJson), context, value.runId);
    return definition;
  }
  function workflowReview(definition, inputs, runId) {
    const issues = [], tools = new Map();
    const steps = resolvedDrafts(definition, inputs, runId).map(({ step, draft, args, issues: inputIssues }) => {
      issues.push(...inputIssues);
      const toolSelection = draft.tool + ':' + draft.toolSchemaSha256;
      if (!tools.has(toolSelection)) {
        const current = definitions.get(draft.tool), currentSha256 = current ? digest(canonical(current)) : null;
        const state = currentSha256 === draft.toolSchemaSha256 ? 'MATCH' : current ? 'CHANGED' : 'MISSING';
        tools.set(toolSelection, { name: draft.tool, savedSha256: draft.toolSchemaSha256, currentSha256, state });
        if (state !== 'MATCH') issues.push({ code: 'CONSOLE_SERIES_TOOL_' + state, tool: draft.tool,
          message: 'Review ' + draft.tool + ' in the original workflow and select its new saved edition.' });
      }
      return { id: step.id, name: step.name, tool: draft.tool, draftId: draft.id, draftRevision: draft.revision,
        arguments: args, bindings: clone(step.bindings), expect: clone(step.expect), pauseAfter: step.pauseAfter };
    });
    return { issues, tools: [...tools.values()], steps };
  }
  function cycleReview(selected, request, kind = 'cycle', retainedCycle = null) {
    const definition = workflows.records.definition(selected.workflowId, selected.workflowRevision);
    const inputs = resolvedCycleInputs(selected, request), inputsJson = canonical(inputs);
    const id = cycleId(selected.id, request.key), runId = cycleRunId(selected.id, request.key);
    const profile = store.profile(selected.profileId), host = getHost(), current = series(selected.id);
    const native = workflowReview(definition, inputs, runId);
    if (!current.enabled) native.issues.push({ code: 'CONSOLE_SERIES_PAUSED', message: 'Enable the saved series before starting new work.' });
    if (profile.hostFingerprint !== host.configurationFingerprint)
      native.issues.push({ code: 'CONSOLE_HOST_CHANGED', message: 'Review and bind this profile to the current original host.' });
    if (retainedCycle && cancellation(id)) native.issues.push({ code: 'CONSOLE_CYCLE_CANCELLED', message: 'This planned period was canceled. Select a separately reviewed later cycle.' });
    if (request.previousCycleId) {
      const previous = cycle(request.previousCycleId);
      need(previous.seriesId === selected.id && previous.id !== id, 'Link another original period in this same customer series.');
    }
    const result = seal({ schema: SERIES_REVIEW_SCHEMA, kind, cycleId: id, runId, profileId: selected.profileId,
      seriesId: selected.id, seriesRevision: selected.revision, seriesSha256: selected.contentSha256,
      currentSeriesRevision: current.revision, currentSeriesSha256: current.contentSha256,
      workflowId: definition.id, workflowRevision: definition.revision, workflowSha256: definition.contentSha256,
      profileRevision: profile.revision, hostFingerprint: host.configurationFingerprint,
      requestSha256: digest(canonical(request)), inputsSha256: digest(inputsJson),
      ...(retainedCycle ? { cycleSha256: retainedCycle.contentSha256 } : {}),
      request: clone(request), inputs, ...native, canStart: native.issues.length === 0 });
    need(Buffer.byteLength(canonical(result)) <= SERIES_REQUEST_BYTES, 'The complete cycle review exceeds 32 MiB.', 'CONSOLE_SERIES_SIZE', 413);
    return result;
  }
  async function cycleView(value, context, full = false) {
    await authorizeCycle(value, context);
    const savedRun = originalRun(value), canceled = cancellation(value.id);
    const run = savedRun ? await workflows.run(value.runId, context) : null;
    const state = canceled ? 'CANCELLED' : run?.state ?? 'PLANNED';
    const basic = { id: value.id, runId: value.runId, seriesId: value.seriesId, seriesRevision: value.seriesRevision,
      key: value.request.key, label: value.request.label, period: value.request.period, dueDate: value.request.dueDate,
      sourceEdition: value.request.sourceEdition, reason: value.request.reason, previousCycleId: value.request.previousCycleId,
      state, active: run?.active ?? false, stepsComplete: run?.stepsComplete ?? 0, stepCount: run?.stepCount ?? value.review.steps.length,
      completedAt: run?.completedAt ?? null, contentSha256: value.contentSha256 };
    return full ? { cycle: value, cancellation: canceled, run, series: series(value.seriesId, value.seriesRevision),
      currentSeries: summary(series(value.seriesId)), status: basic } : basic;
  }
  function matchingCycle(request, selected) {
    const row = db.prepare('SELECT value FROM workflow_cycles WHERE id=?').get(cycleId(selected.id, request.key));
    if (!row) return null;
    const value = JSON.parse(row.value);
    need(value.requestSha256 === digest(canonical(request)) && value.seriesSha256 === selected.contentSha256,
      'This period key already names different original source or inputs. Open it or select an explicitly linked new key.', 'CONSOLE_CYCLE_CONFLICT', 409);
    return value;
  }
  const result = {
    async list(profileId, context) {
      store.profile(identifier(profileId));
      const latest = db.prepare('SELECT chosen.value FROM workflow_series AS chosen WHERE chosen.profile_id=? AND chosen.revision=(SELECT MAX(history.revision) FROM workflow_series AS history WHERE history.id=chosen.id) ORDER BY chosen.id');
      const items = [];
      for (const row of latest.iterate(profileId)) {
        const value = JSON.parse(row.value);
        try {
          await authorizeSeries(value, context);
          const originals = db.prepare('SELECT value FROM workflow_cycles WHERE series_id=?');
          let cycles = 0, complete = 0, active = 0, pending = 0, nextDue = null;
          for (const original of originals.iterate(value.id)) {
            const current = JSON.parse(original.value); cycles++;
            await authorizeCycle(current, context);
            const run = originalRun(current);
            if (cancellation(current.id)) continue;
            if (run?.state === 'COMPLETE') complete++;
            else { pending++; if (run && (await workflows.run(run.id, context)).active) active++;
              if (!nextDue || current.request.dueDate < nextDue) nextDue = current.request.dueDate; }
          }
          items.push({ ...summary(value), cycles, complete, active, pending, nextDue });
        } catch (error) { if (!error.merchantConsoleAuthorization) throw error; }
      }
      return { series: items, limits: { inputBytes: SERIES_MAX_BYTES, requestBytes: SERIES_REQUEST_BYTES, calendarPeriods: 366 } };
    },
    async get(id, selectedRevision, { offset = 0, limit = 50 } = {}, context) {
      need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'Use an original cycle page of up to 100 rows.');
      const selected = series(id, selectedRevision);
      await authorizeSeries(selected, context);
      const rows = db.prepare('SELECT value FROM workflow_cycles WHERE series_id=? ORDER BY json_extract(value,\'$.request.dueDate\'),cycle_key LIMIT ? OFFSET ?');
      const total = db.prepare('SELECT COUNT(*) AS total FROM workflow_cycles WHERE series_id=?').get(id).total;
      const cycles = [], revisions = [];
      for (const row of rows.iterate(id, limit, offset)) cycles.push(await cycleView(JSON.parse(row.value), context));
      for (const row of db.prepare('SELECT value FROM workflow_series WHERE id=? ORDER BY revision').iterate(id)) {
        const value = JSON.parse(row.value); await authorizeSeries(value, context); revisions.push(summary(value));
      }
      return { series: selected, revisions, cycles, total, offset, nextOffset: offset + limit < total ? offset + limit : null };
    },
    async save(input, context) {
      const request = seriesRequest(input), requestSha256 = digest(canonical(request));
      const previousRequest = db.prepare('SELECT value FROM workflow_series WHERE request_id=?').get(request.requestId);
      if (previousRequest) {
        const value = JSON.parse(previousRequest.value); await authorizeSeries(value, context);
        need(value.requestSha256 === requestSha256, 'This save request names a different series selection.', 'CONSOLE_SERIES_REQUEST_CONFLICT', 409);
        return { series: value, currentSeries: summary(series(value.id)), reused: true };
      }
      need(!db.prepare('SELECT 1 FROM workflow_cycle_cancellations WHERE request_id=?').get(request.requestId),
        'This request already belongs to an original cycle cancellation.', 'CONSOLE_SERIES_REQUEST_CONFLICT', 409);
      const definition = await workflows.definition(request.workflowId, request.workflowRevision, context);
      need(definition.profileId === request.profileId, 'Choose an original workflow in this profile.');
      await authorize(definition, request.baseInputs, context); requireOpen();
      return store.transaction(() => {
        requireOpen();
        const raced = db.prepare('SELECT value FROM workflow_series WHERE request_id=?').get(request.requestId);
        if (raced) {
          const value = JSON.parse(raced.value);
          need(value.requestSha256 === requestSha256, 'Retain the original series save request.', 'CONSOLE_SERIES_REQUEST_CONFLICT', 409);
          return { series: value, currentSeries: summary(series(value.id)), reused: true };
        }
        need(!db.prepare('SELECT 1 FROM workflow_cycle_cancellations WHERE request_id=?').get(request.requestId),
          'This request already belongs to an original cycle cancellation.', 'CONSOLE_SERIES_REQUEST_CONFLICT', 409);
        const row = db.prepare('SELECT value FROM workflow_series WHERE id=? ORDER BY revision DESC LIMIT 1').get(request.id);
        const old = row ? JSON.parse(row.value) : null;
        need((old?.revision ?? 0) === request.expectedRevision && (!old || old.profileId === request.profileId),
          'Reopen the current customer series before saving the next edition.', 'CONSOLE_SERIES_REVISION_CONFLICT', 409);
        const { requestId, expectedRevision, ...selection } = request;
        const at = now(), value = seal({ schema: SERIES_SCHEMA, ...selection, revision: expectedRevision + 1,
          workflowSha256: definition.contentSha256, request, requestSha256, workspaceId: store.id,
          createdAt: old?.createdAt ?? at, updatedAt: at });
        db.prepare('INSERT INTO workflow_series VALUES(?,?,?,?,?)').run(value.id, value.revision, value.profileId, requestId, JSON.stringify(value));
        return { series: value, currentSeries: summary(value), reused: false };
      });
    },
    async agenda(input, context, { calendar = false } = {}) {
      const query = workflowAgendaRequest(input);
      store.profile(query.profileId);
      const entries = [], latest = db.prepare('SELECT chosen.value FROM workflow_series AS chosen WHERE chosen.profile_id=? AND chosen.revision=(SELECT MAX(history.revision) FROM workflow_series AS history WHERE history.id=chosen.id) ORDER BY chosen.id');
      const originals = db.prepare('SELECT value FROM workflow_cycles WHERE series_id=? ORDER BY cycle_key');
      for (const row of latest.iterate(query.profileId)) {
        const current = JSON.parse(row.value);
        try { await authorizeSeries(current, context); }
        catch (error) { if (error.merchantConsoleAuthorization) continue; throw error; }
        const cycles = [], occupiedKeys = [];
        for (const original of originals.iterate(current.id)) {
          const value = JSON.parse(original.value);
          occupiedKeys.push(value.request.key);
          const due = value.request.dueDate;
          if (!(due >= query.from && due <= query.to) &&
            !(query.includeOverdue && due < query.today && due < query.from)) continue;
          try {
            const status = await cycleView(value, context);
            const selected = series(value.seriesId, value.seriesRevision);
            cycles.push({ status, series: summary(selected) });
          } catch (error) { if (!error.merchantConsoleAuthorization) throw error; }
        }
        entries.push({ series: summary(current), cycles, occupiedKeys });
      }
      const agenda = workflowAgenda({ query, entries, complete: calendar });
      return calendar ? workflowAgendaCalendar(agenda) : agenda;
    },
    async calendar(input, context) {
      fields(input, ['id', 'revision', 'from', 'to', 'limit']);
      const value = series(input.id, input.revision); await authorizeSeries(value, context);
      const calendar = seriesCalendar(value, input);
      for (const period of calendar.periods) {
        const row = db.prepare('SELECT value FROM workflow_cycles WHERE series_id=? AND cycle_key=?').get(value.id, period.key);
        period.existing = row ? await cycleView(JSON.parse(row.value), context) : null;
      }
      return { seriesId: value.id, seriesRevision: value.revision, ...calendar };
    },
    async review(input, context) {
      const selected = series(input.seriesId, input.seriesRevision), request = cycleRequest(input, selected);
      const definition = workflows.records.definition(selected.workflowId, selected.workflowRevision);
      await authorize(definition, resolvedCycleInputs(selected, request), context, cycleRunId(selected.id, request.key)); requireOpen();
      const existing = matchingCycle(request, selected);
      return { request, review: cycleReview(selected, request), ...(existing ? { existing: await cycleView(existing, context) } : {}) };
    },
    async prepare(input, context) {
      fields(input, ['request', 'expectedReviewSha256']);
      const selected = series(input.request?.seriesId, input.request?.seriesRevision), request = cycleRequest(input.request, selected);
      const previous = matchingCycle(request, selected);
      if (previous) return { ...await cycleView(previous, context, true), reused: true };
      const definition = workflows.records.definition(selected.workflowId, selected.workflowRevision);
      await authorize(definition, resolvedCycleInputs(selected, request), context, cycleRunId(selected.id, request.key)); requireOpen();
      const value = store.transaction(() => {
        requireOpen();
        const raced = matchingCycle(request, selected);
        if (raced) return { value: raced, reused: true };
        const review = cycleReview(selected, request);
        need(review.canStart && review.contentSha256 === sha(input.expectedReviewSha256), 'Review this complete current period, native contracts and inputs before saving.', 'CONSOLE_CYCLE_REVIEW_CHANGED', 409);
        const inputsJson = canonical(review.inputs);
        const value = seal({ schema: CYCLE_SCHEMA, id: review.cycleId, runId: review.runId, profileId: selected.profileId,
          seriesId: selected.id, seriesRevision: selected.revision, seriesSha256: selected.contentSha256,
          workflowId: selected.workflowId, workflowRevision: selected.workflowRevision, workflowSha256: selected.workflowSha256,
          request, requestSha256: digest(canonical(request)), inputsJson, inputsSha256: digest(inputsJson), review,
          workspaceId: store.id, createdAt: now() });
        db.prepare('INSERT INTO workflow_cycles VALUES(?,?,?,?,?)').run(value.id, value.seriesId, value.profileId, request.key, JSON.stringify(value));
        return { value, reused: false };
      });
      return { ...await cycleView(value.value, context, true), reused: value.reused };
    },
    async cycle(id, context) { return cycleView(cycle(id), context, true); },
    async startReview(input, context) {
      fields(input, ['id']);
      const value = cycle(input.id); await authorizeCycle(value, context);
      const original = originalRun(value);
      if (original) return { ...await cycleView(value, context, true), reused: true, review: null };
      return { cycle: value, review: cycleReview(series(value.seriesId, value.seriesRevision), value.request, 'start', value), reused: false };
    },
    async start(input, context) {
      fields(input, ['id', 'expectedReviewSha256']);
      const value = cycle(input.id); await authorizeCycle(value, context); requireOpen();
      if (originalRun(value)) return { ...await cycleView(value, context, true), reused: true };
      const review = cycleReview(series(value.seriesId, value.seriesRevision), value.request, 'start', value);
      need(review.canStart && review.contentSha256 === sha(input.expectedReviewSha256),
        'Review this cycle on the current original host before its first start.', 'CONSOLE_CYCLE_REVIEW_CHANGED', 409);
      const request = { id: value.runId, profileId: value.profileId, workflowId: value.workflowId, workflowRevision: value.workflowRevision,
        expectedWorkflowSha256: value.workflowSha256, expectedHostFingerprint: review.hostFingerprint, inputs: JSON.parse(value.inputsJson) };
      const run = await workflows.start(request, context, { beforeReserve() {
        requireOpen();
        const fresh = cycleReview(series(value.seriesId, value.seriesRevision), value.request, 'start', value);
        need(fresh.canStart && fresh.contentSha256 === review.contentSha256,
          'The series, host or planned cycle changed before dispatch. Reopen its current review.', 'CONSOLE_CYCLE_REVIEW_CHANGED', 409);
      } });
      return { ...await cycleView(value, context, true), reused: run.reused };
    },
    async cancel(input, context) {
      fields(input, ['id', 'requestId', 'reason']);
      const value = cycle(input.id), requestId = identifier(input.requestId), reason = note(input.reason, true);
      await authorizeCycle(value, context); requireOpen();
      const saved = store.transaction(() => {
        requireOpen();
        const old = cancellation(value.id);
        if (old) {
          need(old.requestId === requestId && old.reason === reason, 'Reopen the original cancellation for this period.', 'CONSOLE_CYCLE_CANCEL_CONFLICT', 409);
          return old;
        }
        need(!db.prepare('SELECT 1 FROM workflow_series WHERE request_id=?').get(requestId),
          'This request already belongs to a saved series edition.', 'CONSOLE_SERIES_REQUEST_CONFLICT', 409);
        need(!originalRun(value), 'Use the original run’s pause and recovery controls after it has started.', 'CONSOLE_CYCLE_STARTED', 409);
        const saved = seal({ schema: CYCLE_SCHEMA, cycleId: value.id, requestId, reason, workspaceId: store.id, createdAt: now() });
        db.prepare('INSERT INTO workflow_cycle_cancellations VALUES(?,?,?)').run(value.id, requestId, JSON.stringify(saved));
        return saved;
      });
      return { ...await cycleView(value, context, true), cancellation: saved };
    },
    async authorizeArchive(packet, context) {
      const data = packet.workflowSeriesData;
      if (data === undefined) return;
      need(plain(data) && Array.isArray(data.definitions) && Array.isArray(data.cycles), 'Receive the complete recurring customer work.');
      const defs = new Map((packet.workflowData?.definitions ?? []).map(value => [value.id + ':' + value.revision, value]));
      const drafts = new Map((packet.drafts ?? []).map(value => [value.id + ':' + value.revision, value]));
      const getDraft = (id, revision) => drafts.get(id + ':' + revision);
      for (const value of data.definitions) {
        const definition = defs.get(value.workflowId + ':' + value.workflowRevision);
        need(definition, 'Retain the original workflow in the complete profile.');
        await authorize(definition, value.baseInputs, context, 'series-review', getDraft);
      }
      for (const value of data.cycles) {
        const definition = defs.get(value.workflowId + ':' + value.workflowRevision);
        need(definition, 'Retain the original cycle workflow in the complete profile.');
        await authorize(definition, JSON.parse(value.inputsJson), context, value.runId, getDraft);
      }
    }
  };
  return result;
}

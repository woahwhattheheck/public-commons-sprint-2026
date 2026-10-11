import { digest, id, iso, jsonBytes, nativeId, now, parse, portableError, requireThat, text, WorkspaceError } from './common.mjs';
import { recordBasis, sourceProperties } from './source.mjs';

const esc = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const display = action => { const { providerBinding, ...value } = action; return value; };
export function installActions(workspace) {
  const { store, provider, launch, traceProvider, background } = workspace;
  const save = (action, changes, event, actor) => { const next = { ...action, ...changes, version: action.version + 1, updatedAt: now() }; store.put('action', next); store.event(next.projectId, next.id, event, { actor, status: next.status, version: next.version }); return next; };
  function expected(actionId, version) { const action = store.get(actionId, 'action'); requireThat(action.version === version, 'STALE_ACTION', `Action is now version ${action.version}; reload and inspect before applying`, 409); return action; }
  async function currentDeal(action, client, signal) {
    const run = store.get(action.runId, 'run'), query = new URLSearchParams({ properties: sourceProperties(run.config).join(',') });
    const response = await client.request(`/crm/v3/objects/deals/${action.dealId}?${query}`, { signal });
    requireThat(response.data.id === action.dealId && response.data.archived !== true && digest(recordBasis(response.data, run.config)) === action.basisSha256, 'SOURCE_CHANGED', 'The current deal differs from the exact reviewed source; capture and review its changed values');
    return response;
  }
  function already(scope, input) {
    text(input.actor, 'actor'); text(input.requestId, 'requestId', 120);
    const previous = store.db.prepare('SELECT fingerprint,value FROM requests WHERE scope=? AND key=?').get(scope, input.requestId);
    if (!previous) return null;
    requireThat(previous.fingerprint === digest(input), 'REQUEST_CONFLICT', 'Request ID was used with different inputs', 409); return JSON.parse(previous.value);
  }
  function preparedBody(action, associationTypeId) {
    const d = action.details;
    const body = esc(d.body).replace(/\n/g, '<br>') + `<p>${esc(action.marker)}</p>`;
    const properties = action.kind === 'note' ? { hs_timestamp: d.dueAt, hs_note_body: body } : {
      hs_timestamp: d.dueAt, hs_task_subject: d.subject, hs_task_body: body, hs_task_status: 'NOT_STARTED', hs_task_priority: d.priority, hs_task_type: 'TODO'
    };
    if (d.ownerId) properties.hubspot_owner_id = d.ownerId;
    if (action.kind !== 'note' && d.reminderAt) properties.hs_task_reminders = String(Date.parse(d.reminderAt));
    return { properties, associations: [{ to: { id: action.dealId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId }] }] };
  }
  async function inspectNative(action, client, nativeObjectId, signal) {
    nativeId(nativeObjectId, 'created CRM object ID');
    const fields = Object.keys(action.prepared.body.properties), query = new URLSearchParams({ properties: fields.join(','), associations: 'deals' });
    const response = await client.request(`/crm/v3/objects/${action.objectType}/${nativeObjectId}?${query}`, { signal });
    const value = response.data, p = value.properties ?? {}, bodyKey = action.kind === 'note' ? 'hs_note_body' : 'hs_task_body';
    requireThat(value.id === nativeObjectId && value.archived !== true && typeof p[bodyKey] === 'string' && p[bodyKey].includes(action.marker), 'NATIVE_OBJECT_MISMATCH', 'CRM object does not carry this original action marker');
    const linked = value.associations?.deals?.results ?? [];
    requireThat(linked.some(row => String(row.id) === action.dealId), 'NATIVE_ASSOCIATION_MISMATCH', 'CRM object is not associated with this exact deal');
    // HubSpot may normalize HTML, timestamps, reminder serialization and status.
    // Preserve every actual property and describe any differences; creation custody
    // is identified by the unique retained marker plus original deal association.
    const differences = [];
    for (const [key, expectedValue] of Object.entries(action.prepared.body.properties)) if (String(p[key] ?? '') !== String(expectedValue)) differences.push({ property: key, requested: expectedValue, actual: p[key] ?? null });
    return { value, differences, response };
  }
  async function performExecute(actionId, actor, signal) {
    let action = store.get(actionId, 'action'), writeStarted = false;
    try {
      requireThat(action.providerBinding === provider.binding(), 'PROVIDER_CHANGED', 'Provider environment changed since preparation; prepare and approve against this host');
      const client = traceProvider(action.projectId, action.id);
      await currentDeal(action, client, signal); signal.throwIfAborted();
      store.transaction(() => { action = save(store.get(actionId, 'action'), { writeStartedAt: now() }, 'native_create_started', actor); });
      writeStarted = true;
      const response = await client.request(action.prepared.path, { method: 'POST', body: action.prepared.body, mutating: true, signal });
      nativeId(response.data.id, 'created CRM object ID');
      store.transaction(() => { action = save(store.get(actionId, 'action'), { status: 'completed', nativeId: response.data.id, completedAt: now(), nativeResponse: response.data, error: null, reconciling: false }, 'native_create_completed', actor); });
    } catch (error) {
      action = store.get(actionId, 'action');
      const state = error.code === 'SOURCE_CHANGED' ? 'source_changed' : writeStarted && (error.mayHaveExecuted !== false) ? 'uncertain' : 'failed';
      store.transaction(() => save(action, { status: state, error: portableError(error), reconciling: false, ...(!writeStarted || error.mayHaveExecuted === false ? { writeStartedAt: null } : {}) }, 'native_create_stopped', actor));
    }
  }
  async function performReconcile(actionId, actor, nativeObjectId, signal) {
    let action = store.get(actionId, 'action');
    try {
      const client = traceProvider(action.projectId, action.id); let found = nativeObjectId ?? action.nativeId;
      let scanned = action.reconcileAfter ? action.reconcileScanned ?? 0 : 0, after = action.reconcileAfter ?? null;
      if (!found) {
        const bodyKey = action.kind === 'note' ? 'hs_note_body' : 'hs_task_body', seen = new Set();
        do {
          signal.throwIfAborted(); const query = new URLSearchParams({ limit: '100', properties: bodyKey, archived: 'false' }); if (after !== null) query.set('after', after);
          const response = await client.request(`/crm/v3/objects/${action.objectType}?${query}`, { signal });
          requireThat(Array.isArray(response.data.results), 'PROVIDER_SHAPE', 'CRM object list has no results array');
          const matches = response.data.results.filter(row => typeof row.properties?.[bodyKey] === 'string' && row.properties[bodyKey].includes(action.marker));
          requireThat(matches.length <= 1, 'MULTIPLE_NATIVE_MATCHES', 'More than one CRM object carries this marker; inspect the retained response and reconcile an exact native ID');
          if (matches.length) { found = String(matches[0].id); break; }
          scanned += response.data.results.length; requireThat(scanned <= 100000, 'RECONCILE_CAPACITY', 'Marker scan reached 100,000 records; inspect the original CRM and provide its exact object ID');
          const next = response.data.paging?.next?.after ?? null;
          requireThat(next === null || !seen.has(String(next)) && String(next).length <= 200, 'CURSOR_LOOP', 'CRM object list repeated its continuation');
          after = next === null ? null : String(next); if (after) seen.add(after);
          action = store.get(actionId, 'action'); store.put('action', { ...action, reconcileScanned: scanned, reconcileAfter: after, updatedAt: now() });
        } while (after !== null);
      }
      requireThat(found, 'NATIVE_OBJECT_NOT_FOUND', 'The retained marker was not found in this completed read. The original create remains uncertain; inspect CRM or reconcile again after its data is visible');
      const result = await inspectNative(action, client, found, signal);
      store.transaction(() => save(store.get(actionId, 'action'), { status: 'completed', nativeId: found, nativeResponse: result.value, nativeDifferences: result.differences, reconciledAt: now(), reconciling: false, reconcileAfter: null, error: null }, 'native_create_reconciled', actor));
    } catch (error) { action = store.get(actionId, 'action'); store.transaction(() => save(action, { reconciling: false, error: portableError(error), status: action.nativeId && action.status === 'completed' ? 'completed' : 'uncertain' }, 'native_reconciliation_stopped', actor)); }
  }
  workspace.createAction = (runId, input) => {
    const { run, alerts } = workspace.runReport(runId), alert = alerts.find(x => x.dealId === input.dealId);
    requireThat(alert, 'ALERT_NOT_FOUND', 'Choose a deal in this run\'s original emitted attention list');
    return store.mutation('action:' + runId, input, () => {
      const p = store.project(run.projectId, input.revision);
      requireThat(['task', 'reminder', 'escalation', 'note'].includes(input.kind), 'ACTION_KIND', 'Choose task, reminder, escalation or note');
      const details = { subject: text(input.subject ?? '', 'task title', 200, input.kind === 'note'), body: text(input.body, 'task or note content', 12000), ownerId: nativeId(input.ownerId, 'HubSpot owner ID', true), dueAt: iso(input.dueAt, input.kind === 'note' ? 'note timestamp' : 'task due time'), reminderAt: iso(input.reminderAt, 'reminder time', true), priority: input.priority ?? 'MEDIUM' };
      requireThat(['LOW', 'MEDIUM', 'HIGH'].includes(details.priority), 'TASK_PRIORITY', 'Use a native task priority');
      requireThat(!details.reminderAt || Date.parse(details.reminderAt) <= Date.parse(details.dueAt), 'REMINDER_TIME', 'Reminder time must not follow the due time');
      if (input.kind === 'reminder') requireThat(details.reminderAt, 'REMINDER_TIME', 'A reminder needs its selected reminder time');
      const actionId = id(), action = { id: actionId, projectId: p.id, runId, snapshotId: run.snapshotId, dealId: alert.dealId, name: details.subject || 'Manager note', kind: input.kind, objectType: input.kind === 'note' ? 'notes' : 'tasks', version: 1, status: 'draft', details, fingerprint: alert.fingerprint, recordSha256: alert.recordSha256, basisSha256: alert.basisSha256, marker: `VIP pipeline action ${actionId}`, prepared: null, approval: null, nativeId: null, nativeResponse: null, error: null, reconciling: false, createdAt: now(), updatedAt: now() };
      store.put('action', action); store.bump(p, input.actor, 'action_proposed', { actionId, dealId: action.dealId, kind: action.kind }); return { action: display(action) };
    });
  };
  workspace.action = actionId => { const action = store.get(actionId, 'action'), events = store.events(action.projectId, action.id, 1000); return { action: display(action), events, receipts: events.filter(x => x.kind === 'provider_response') }; };
  workspace.prepareAction = async (actionId, input) => {
    const scope = 'prepare_action:' + actionId, previous = already(scope, input); if (previous) return previous;
    const initial = expected(actionId, input.version);
    requireThat(['draft', 'prepared', 'approved', 'source_changed', 'failed'].includes(initial.status) && !initial.writeStartedAt && !background.has(actionId), 'ACTION_STATE', 'Only an unexecuted proposal can be prepared', 409);
    const client = traceProvider(initial.projectId, initial.id); await currentDeal(initial, client);
    const response = await client.request(`/crm/v3/associations/${initial.objectType}/deals/types`), name = initial.kind === 'note' ? 'note_to_deal' : 'task_to_deal';
    const matches = (response.data.results ?? []).filter(row => row.name === name && /^\d+$/.test(String(row.id)));
    requireThat(matches.length === 1 && Number.isSafeInteger(Number(matches[0].id)), 'ASSOCIATION_TYPE', 'The native default task/note-to-deal association was not uniquely returned');
    return store.mutation(scope, input, () => {
      const action = expected(actionId, input.version), request = { method: 'POST', path: `/crm/v3/objects/${action.objectType}`, body: preparedBody(action, Number(matches[0].id)) };
      const prepared = { ...request, sha256: digest(request), checkedAt: now(), associationName: name, providerOrigin: provider.info().origin, providerKind: provider.info().kind };
      return { action: display(save(action, { status: 'prepared', prepared, providerBinding: provider.binding(), approval: null, error: null }, 'action_prepared', input.actor)) };
    });
  };
  workspace.approveAction = (actionId, input) => store.mutation('approve_action:' + actionId, input, () => { const action = expected(actionId, input.version); requireThat(action.status === 'prepared' && action.prepared && !action.writeStartedAt, 'ACTION_STATE', 'Prepare and inspect the concrete request before approving', 409); return { action: display(save(action, { status: 'approved', approval: { actor: text(input.actor, 'approver'), note: text(input.note, 'approval note', 2000), requestSha256: action.prepared.sha256, approvedAt: now() } }, 'action_approved', input.actor)) }; });
  workspace.revokeAction = (actionId, input) => store.mutation('revoke_action:' + actionId, input, () => { const action = expected(actionId, input.version); requireThat(!action.writeStartedAt && !background.has(actionId) && !['completed', 'uncertain', 'executing'].includes(action.status), 'ACTION_STATE', 'An original native attempt must be reconciled; this control only withdraws unexecuted proposals', 409); return { action: display(save(action, { status: 'revoked', revocation: { actor: input.actor, note: text(input.note, 'revocation note', 2000), at: now() } }, 'action_revoked', input.actor)) }; });
  workspace.executeAction = (actionId, input) => {
    const result = store.mutation('execute_action:' + actionId, input, () => { const action = expected(actionId, input.version); requireThat(action.status === 'approved' && action.approval?.requestSha256 === action.prepared?.sha256 && !action.writeStartedAt, 'ACTION_STATE', 'Execute only this approved, unattempted request', 409); requireThat(provider.info().configured, 'PROVIDER_NOT_CONFIGURED', 'Configure the operator host provider first'); return { action: display(save(action, { status: 'executing', error: null, attemptRequestedAt: now() }, 'action_execution_requested', input.actor)) }; });
    if (store.get(actionId, 'action').status === 'executing' && !background.has(actionId)) launch(actionId, signal => performExecute(actionId, input.actor, signal)); return result;
  };
  workspace.reconcileAction = (actionId, input) => {
    const nativeObjectId = nativeId(input.nativeId, 'native CRM object ID', true);
    const result = store.mutation('reconcile_action:' + actionId, input, () => { const action = expected(actionId, input.version); requireThat(['uncertain', 'completed'].includes(action.status) && action.prepared && !background.has(actionId), 'ACTION_STATE', 'Reconcile an actual uncertain or completed native attempt', 409); requireThat(provider.info().configured, 'PROVIDER_NOT_CONFIGURED', 'Configure the original provider before reconciliation'); return { action: display(save(action, { reconciling: true, error: null }, 'action_reconciliation_requested', input.actor)) }; });
    if (store.get(actionId, 'action').reconciling && !background.has(actionId)) launch(actionId, signal => performReconcile(actionId, input.actor, nativeObjectId, signal)); return result;
  };
}

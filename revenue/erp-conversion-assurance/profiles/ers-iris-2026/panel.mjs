// MIT. Filing operations inside the maintained private comparison workspace.
export const panelTitle = 'IRIS filings';
export const applyPlan = (draft, plan) => ({ ...draft, iris: plan ? structuredClone(plan) : null });
export const decorateSpec = (spec, draft) => ({ ...spec, workspace: { ...spec.workspace, ...(draft.iris ? { iris: structuredClone(draft.iris) } : {}) } });
export const changeCohort = (fresh, previous) => ({ ...fresh, iris: previous.iris ? structuredClone(previous.iris) : null });

const el = (tag, text, attributes = {}) => {
  const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  return node;
};
const short = value => value ? value.slice(0, 16) + '…' : '—';
const jsonText = value => JSON.stringify(value, null, 2);
const encoded = value => encodeURIComponent(value);
function field(label, type = 'text', value = '', attributes = {}) {
  const labelNode = el('label', label), input = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input', null,
    { 'aria-label': label, ...(type === 'textarea' || type === 'select' ? {} : { type }), ...attributes });
  if (type !== 'file' && type !== 'select') input.value = value;
  labelNode.append(input); return { label: labelNode, input };
}
function choice(label, rows, value = '') {
  const node = field(label, 'select'); for (const [key, title] of rows) node.input.append(el('option', title, { value: key }));
  node.input.value = value; return node;
}
function table(headers, rows) {
  const wrap = el('div', null, { class: 'iris-table' }), node = el('table'), head = el('tr'), body = el('tbody');
  for (const label of headers) head.append(el('th', label, { scope: 'col' }));
  const thead = el('thead'); thead.append(head); node.append(thead, body);
  for (const row of rows) { const tr = el('tr'); for (const value of row) { const td = el('td'); td.append(value instanceof Node ? value : document.createTextNode(String(value ?? '—'))); tr.append(td); } body.append(tr); }
  wrap.append(node); return wrap;
}
async function upload(file, maximum) {
  if (!file || file.size < 1 || file.size > maximum) throw new Error('Choose a complete file within the displayed intake limit.');
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { encoding: 'base64', data: btoa(binary) };
}
const rawUpload = value => {
  const bytes = new TextEncoder().encode(value); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { encoding: 'base64', data: btoa(binary) };
};

export function mountProfilePanel({ element, api, draft, onDraftChange, onOpenJob, onOpenBundle, download }) {
  if (!document.querySelector('link[href="/iris/panel.css"]')) document.head.append(el('link', null, { rel: 'stylesheet', href: '/iris/panel.css' }));
  element.classList.add('iris-desk'); element.replaceChildren();
  let binding = draft.iris ? structuredClone(draft.iris) : null;
  const state = { filing: null, configuration: null, cursor: '', busy: false, read: 0, edits: new Map(), selectedJob: null };
  const heading = el('h2', 'IRIS filing operations');
  const intro = el('p', 'Retain a prepared transmission, project its actual XML fields, and join the original source reconciliation. Correlate IRS responses and prepare the next filing from the saved decision history.');
  const status = el('div', 'Opening the retained filing workspace…', { class: 'iris-status', role: 'status', 'aria-live': 'polite' });
  const layout = el('div', null, { class: 'iris-layout' }), left = el('aside'), right = el('div');
  const listBox = el('section', null, { class: 'iris-box' }), list = el('div', null, { class: 'iris-list' });
  listBox.append(el('h3', 'Retained filings'), list); left.append(listBox); layout.append(left, right); element.append(heading, intro, status, layout);
  const say = message => { status.textContent = message; };
  const button = (text, action, primary = false) => {
    const node = el('button', text, { type: 'button', ...(primary ? { class: 'iris-primary' } : {}) });
    node.addEventListener('click', () => void act(action)); return node;
  };
  const actions = (...nodes) => { const row = el('div', null, { class: 'iris-actions' }); row.append(...nodes); return row; };
  const box = title => { const node = el('section', null, { class: 'iris-box' }); node.append(el('h3', title)); return node; };
  const details = title => { const node = el('details'); node.append(el('summary', title)); return node; };
  async function act(action) {
    if (state.busy) return;
    state.busy = true; element.setAttribute('aria-busy', 'true');
    const disabled = [...element.querySelectorAll('button')].map(node => [node, node.disabled]);
    for (const [node] of disabled) node.disabled = true;
    try { await action(); }
    catch (error) { say(error.message ?? 'The filing operation could not finish. Refresh the retained revision.'); }
    finally { state.busy = false; element.removeAttribute('aria-busy'); for (const [node, value] of disabled) node.disabled = value; }
  }
  const edits = filingId => {
    if (!state.edits.has(filingId)) state.edits.set(filingId, { projectionId: '', mapping: jsonText({ schema: 'ers-iris.xml-map.v1', recordTag: '', submissionTag: '', fields: [] }),
      action: 'recover-receipt', selection: '', submissionIds: '', jobId: '', evidenceId: '', reason: 'pre-receipt' });
    return state.edits.get(filingId);
  };
  const remember = (control, key, current) => { control.value = current[key] ?? ''; control.addEventListener('input', () => { current[key] = control.value; }); return control; };
  const currentArgs = () => {
    if (!state.filing) throw new Error('Open a retained filing first.');
    return { filingId: state.filing.filingId, expectedRevision: state.filing.revision };
  };
  async function refreshList(after = '') {
    const result = await api('/api/iris/filings?limit=25&after=' + encoded(after)); state.cursor = after;
    list.replaceChildren();
    for (const row of result.filings) {
      const item = el('div', null, { class: 'iris-filing', 'aria-current': String(row.filingId === state.filing?.filingId) });
      item.append(button(row.filingId, () => openFiling(row.filingId)), el('p', `${row.status} · ${row.manifest.type} · ${row.recordCount} records · revision ${row.revision}`, { class: 'iris-muted' })); list.append(item);
    }
    if (!result.filings.length) list.append(el('p', 'Import a prepared XML transmission to begin.', { class: 'iris-muted' }));
    list.append(actions(button('First page', () => refreshList()), ...(result.nextCursor ? [button('Next page', () => refreshList(result.nextCursor))] : [])));
  }
  async function openFiling(filingId, message) {
    const sequence = ++state.read;
    const result = await api('/api/iris/filings/' + encoded(filingId));
    if (sequence !== state.read) return;
    state.filing = result; state.selectedJob = null; renderFiling(); await refreshList(state.cursor);
    say(message ?? `${filingId} reopened at revision ${result.revision}. Current IRS observation: ${result.summary.status}.`);
  }
  async function change(endpoint, body, message) {
    const identity = currentArgs();
    const result = await api('/api/iris/' + endpoint, { ...identity, ...body });
    if (state.filing?.filingId !== identity.filingId) return result;
    await openFiling(identity.filingId, message ?? `${identity.filingId} saved at revision ${result.revision}.`); return result;
  }

  const intake = box('Retain prepared XML'), intakeId = field('New filing ID', 'text', '', { 'data-iris': 'intake-id', maxlength: '96' });
  const intakeFile = field('Original transmission XML', 'file', '', { accept: '.xml,application/xml,text/xml', 'data-iris': 'intake-file' });
  const family = field('Existing filing family (optional)', 'text', '', { 'data-iris': 'intake-family' });
  const parent = field('Parent filing ID (for a saved decision)', 'text', '', { 'data-iris': 'parent-filing' });
  const parentDecision = field('Saved parent decision ID', 'text', '', { 'data-iris': 'parent-decision' });
  const preparedMap = field('Explicit child record renumbering JSON (optional)', 'file', '', { accept: '.json', 'data-iris': 'prepared-record-map' });
  const validation = choice('Validation', [['configured', 'Configured schema package'], ['structure', 'XML structure inspection']], 'configured');
  const successor = details('Linked correction or replacement'); successor.append(family.label, parent.label, parentDecision.label, preparedMap.label);
  intake.append(intakeId.label, intakeFile.label, validation.label, successor,
    button('Retain transmission', async () => {
      const payload = { filingId: intakeId.input.value.trim(), input: await upload(intakeFile.input.files[0], state.configuration.maxArtifactBytes),
        familyId: family.input.value.trim() || undefined, validation: validation.input.value };
      if (parent.input.value.trim() || parentDecision.input.value.trim()) payload.parent = { filingId: parent.input.value.trim(), decisionId: parentDecision.input.value.trim() };
      if (preparedMap.input.files[0]) {
        if (preparedMap.input.files[0].size > 1024 * 1024) throw new Error('The child record map must fit within 1 MiB.');
        payload.preparedRecordMap = JSON.parse(await preparedMap.input.files[0].text());
      }
      const result = await api('/api/iris/intake', payload); intakeFile.input.value = ''; await openFiling(result.filingId, `Original XML retained as ${result.filingId}, revision ${result.revision}.`);
    }, true));
  left.append(intake);

  function renderFiling() {
    const filing = state.filing; right.replaceChildren(); if (!filing) { right.append(el('p', 'Choose a retained filing or import the prepared XML.')); return; }
    const edit = edits(filing.filingId), identity = box(filing.filingId), dl = el('dl');
    for (const [label, value] of [['Revision', filing.revision], ['UTID', filing.manifest.utid], ['Transmission', `${filing.manifest.type} · tax year ${filing.manifest.taxYears.join(', ')} · schema ${filing.manifest.schemaVersion}`],
      ['Current IRS status', filing.summary.status], ['Receipt', filing.receiptId ?? 'Awaiting retained receipt'], ['Membership', `${filing.submissionCount} submissions / ${filing.recordCount} records`],
      ['Validation', filing.schemaPackage.mode === 'xsd' ? `XSD package · ${filing.schemaPackage.entry}` : 'XML structure'], ['Original XML SHA256', filing.xml.sha256], ['Family', filing.familyId]]) {
      dl.append(el('dt', label), el('dd', String(value)));
    }
    identity.append(dl, actions(button('Refresh current revision', () => openFiling(filing.filingId)), button('Original XML', () => getFile('xml'))));
    const membership = details('Browse submission and record membership'), members = el('div');
    membership.append(button('Show submissions', () => showMembers('', 0, members)), members); identity.append(membership);
    if (filing.parent) identity.append(el('p', `Linked to ${filing.parent.filingId} through decision ${filing.parent.decisionId}.`, { class: 'iris-muted' }));
    if (filing.parent) {
      const lineage = details('Retained record lineage');
      if (filing.lineageIssue) { lineage.open = true; lineage.append(el('p', filing.lineageIssue.message, { class: 'iris-selection' })); }
      lineage.append(el('p', 'Rebuild derived record links from the original prepared-child validation. The new revision retains the preceding lineage.', { class: 'iris-muted' }),
        button('Rebuild record lineage', () => change('rebuild-lineage', {}, 'Record lineage rebuilt from the retained native validation.')));
      identity.append(lineage);
    }
    if (filing.parent?.filingDateTreatment === 'new-original') identity.append(el('p', 'Filing date treatment: new original filing date.', { class: 'iris-selection' }));
    if (filing.activeScopeConflicts?.length) identity.append(el('h4', 'Overlapping native filing observations'),
      el('p', 'These retained filings have accepted or in-flight IRS observations for the same original source records.'),
      table(['Filing', 'Native status', 'Shared records', 'Open'], filing.activeScopeConflicts.map(row => [row.filingId, row.status, row.sharedRecords,
        button('Open related filing', () => openFiling(row.filingId))])));
    right.append(identity);

    const projection = box('1. Project XML fields for comparison');
    projection.append(el('p', 'Use the actual submission element, record grain and direct child paths from this filing. The retained map produces a CSV for the original source/map/run/review workflow.', { class: 'iris-muted' }));
    const projectionId = field('New projection ID', 'text', '', { 'data-iris': 'projection-id' }); remember(projectionId.input, 'projectionId', edit);
    const mapFile = field('Load an existing XML map JSON', 'file', '', { accept: '.json,application/json', 'data-iris': 'map-file' });
    const map = field('Explicit XML map', 'textarea', '', { rows: '13', spellcheck: 'false', 'data-iris': 'xml-map' }); remember(map.input, 'mapping', edit);
    mapFile.input.addEventListener('change', () => void act(async () => {
      const file = mapFile.input.files[0]; if (!file || file.size > 256 * 1024) throw new Error('Choose an XML map within 256 KiB.');
      const text = await file.text(); JSON.parse(text); edit.mapping = text; map.input.value = text; say('The exact map file is loaded. Review it before projecting.');
    }));
    projection.append(projectionId.label, mapFile.label, map.label, button('Retain map and project', async () => {
      JSON.parse(map.input.value); await change('project', { projectionId: projectionId.input.value.trim(), mapping: rawUpload(map.input.value) }, 'XML map and projected CSV retained. Select the projection for the original comparison.');
    }, true));
    if (binding) projection.append(el('p', `Selected comparison target: ${binding.filingId} / ${binding.projectionId} · ${short(binding.targetSha256)}`, { class: 'iris-selection' }));
    projection.append(table(['Projection', 'Rows / columns', 'Original target', 'Use'], filing.projections.map(row => [row.projectionId,
      `${row.recordCount} / ${row.columns.length}`, short(row.output.sha256), actions(
        button('Select for mapping', async () => {
          binding = await api('/api/iris/binding', { filingId: filing.filingId, projectionId: row.projectionId }); onDraftChange(binding);
          renderFiling(); say(`${row.projectionId} selected. Download its CSV, then select the source export and this CSV in the existing input controls. Configure the comparison fields and stage the reviewed mapping.`);
        }), button('CSV', () => getFile('projection', row.projectionId)), button('Map', () => getFile('mapping', row.projectionId)))])));
    right.append(projection);

    const responses = box('2. Retain and select the IRS observation'), responseFile = field('Original receipt or acknowledgment XML', 'file', '', { accept: '.xml', 'data-iris': 'response-file' });
    const select = field('Select this import as the current observation', 'checkbox'); select.label.classList.add('iris-check'); select.input.checked = true;
    responses.append(responseFile.label, select.label, button('Import IRS response', async () => {
      await change('response', { input: await upload(responseFile.input.files[0], state.configuration.maxArtifactBytes), select: select.input.checked }, 'Native IRS response retained and correlated to the original transmission.');
    }, true));
    const responseView = el('div');
    responses.append(table(['Received locally', 'Native status', 'Current', 'Actions'], filing.responses.map(row => [row.createdAt, `${row.kind} · ${row.status}`, row.responseId === filing.currentResponseId ? 'Selected' : 'Retained', actions(
      button('Inspect', () => showResponse(row.responseId, '', 0, responseView)),
      button('Select current', () => change('select-response', { responseId: row.responseId }, 'The selected IRS observation is saved in this filing revision.')),
      button('Original XML', () => getFile('response', row.responseId)))])), responseView);
    const failure = details('Capture an HTTP or schema failure');
    const failureFile = field('Original native failure response (XML or JSON)', 'file', '', { accept: '.xml,.json', 'data-iris': 'failure-file' });
    const httpStatus = field('Captured HTTP status', 'number', '400', { min: '200', max: '599', 'data-iris': 'failure-status' });
    const operation = choice('Native operation', [['intake', 'Intake'], ['acknowledgment', 'Acknowledgment']], 'intake');
    failure.append(failureFile.label, httpStatus.label, operation.label, button('Retain failure response', async () => change('failure', {
      input: await upload(failureFile.input.files[0], Math.min(state.configuration.maxArtifactBytes, 8 * 1024 * 1024)),
      httpStatus: Number(httpStatus.input.value), operation: operation.input.value,
    }, 'The native failure and its HTTP context are retained.')));
    if (filing.failures.length) failure.append(table(['Failure ID', 'Operation / HTTP', 'Native classification'], filing.failures.map(row => [row.failureId, `${row.operationName} / ${row.httpStatus}`, row.classification])));
    responses.append(failure); right.append(responses);

    const decisions = box('3. Plan recovery, replacement or correction');
    decisions.append(el('p', 'The planner reads this filing’s selected IRS response and the selected observations in its retained family. Each decision saves the exact native inputs and source revision.', { class: 'iris-muted' }));
    const action = choice('Operation', [['recover-receipt', 'Recover receipt by UTID'], ['resend', 'Resend after native failure'], ['replace', 'Replace rejected work'], ['refile-original', 'Refile rejected submissions as O — new filing date'], ['correct', 'Correct accepted records'], ['wrong-form', 'Correct a wrong form'], ['legacy-correction', 'Review a prior FIRE / third-party correction']], edit.action);
    remember(action.input, 'action', edit);
    const selection = field('Record selection — one SubmissionId|RecordId per line', 'textarea', '', { rows: '4', 'data-iris': 'record-selection' }); remember(selection.input, 'selection', edit);
    const submissionIds = field('Replacement submission IDs — one per line (optional)', 'textarea', '', { rows: '3', 'data-iris': 'submission-selection' }); remember(submissionIds.input, 'submissionIds', edit);
    const reason = choice('Resend reason', [['pre-receipt', 'Intake error + same-UTID Not Found'], ['xml-schema', 'XML Schema Validation Error']], edit.reason); remember(reason.input, 'reason', edit);
    const chosenFailure = choice('Retained failure for resend', [['', 'Select failure'], ...filing.failures.map(row => [row.failureId, `${row.classification} · ${row.failureId}`])]);
    const chosenEvidence = choice('Original-system evidence for legacy correction', [['', 'Select evidence'], ...filing.evidence.map(row => [row.evidenceId, row.evidenceId])]);
    decisions.append(action.label, selection.label, submissionIds.label, reason.label, chosenFailure.label, chosenEvidence.label,
      button('Save native decision', async () => {
        const selected = selection.input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(value => {
          const parts = value.split('|'); if (parts.length !== 2 || parts.some(part => !part)) throw new Error('Each record selection needs SubmissionId|RecordId.');
          return { submissionId: parts[0], recordId: parts[1] };
        });
        const submissions = submissionIds.input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        const result = await change('plan', { action: action.input.value, ...(selected.length ? { selection: selected } : {}),
          ...(submissions.length ? { submissionIds: submissions } : {}), ...(action.input.value === 'resend' ? { reason: reason.input.value } : {}),
          ...(chosenFailure.input.value ? { failureId: chosenFailure.input.value } : {}), ...(chosenEvidence.input.value ? { evidenceId: chosenEvidence.input.value } : {}) }, 'The native decision is retained with its exact response and family history.');
        const latest = result.decisions.at(-1); if (latest) await showDecision(latest.decisionId);
      }, true));
    const evidence = details('Retain prior-system filing evidence'), evidenceId = field('Evidence ID', 'text', '', { 'data-iris': 'evidence-id' });
    const evidenceFile = field('Original prior-system evidence file', 'file', '', { 'data-iris': 'evidence-file' });
    evidence.append(evidenceId.label, evidenceFile.label, button('Retain original evidence', async () => change('evidence', {
      evidenceId: evidenceId.input.value.trim(), input: await upload(evidenceFile.input.files[0], state.configuration.maxArtifactBytes),
    }, 'Original-system evidence retained for the native legacy-correction decision.'))); decisions.append(evidence);
    const decisionView = el('div', null, { 'data-iris': 'decision-view' });
    decisions.append(table(['Decision', 'Operation / type', 'Source revision', 'Actions'], filing.decisions.map(row => [row.decisionId, `${row.action} / ${row.transmissionType ?? 'lookup'}`, row.revision,
      actions(button('Inspect plan', () => showDecision(row.decisionId)), button('Decision JSON', () => getFile('decision', row.decisionId)),
        ...(row.transmissionType && row.action !== 'legacy-correction' ? [button('Prepare successor', async () => {
          successor.open = true; family.input.value = filing.familyId; parent.input.value = filing.filingId; parentDecision.input.value = row.decisionId;
          intakeId.input.focus(); say('Choose a new filing ID and the complete prepared successor XML. Its native references will be checked against this saved decision.');
        })] : []))])), decisionView); right.append(decisions);

    const comparisons = box('4. Join the original comparison and hand off');
    const jobId = field('Original completed comparison job ID', 'text', '', { 'data-iris': 'comparison-job' }); remember(jobId.input, 'jobId', edit);
    const selectedProjection = choice('Exact target projection', filing.projections.map(row => [row.projectionId, row.projectionId]), binding?.filingId === filing.filingId ? binding.projectionId : filing.projections[0]?.projectionId);
    const jobView = el('div');
    comparisons.append(jobId.label, selectedProjection.label, actions(button('Inspect original run', async () => {
      const result = await api('/api/jobs/' + encoded(jobId.input.value.trim())); state.selectedJob = result;
      jobView.replaceChildren(el('pre', jsonText({ jobId: result.job.jobId, state: result.job.state,
        result: result.job.result ? { status: result.job.result.status, reportSha256: result.job.result.report?.sha256 } : null,
        reviews: result.reviews.map(row => ({ reviewer: row.reviewer, decision: row.decision, reviewId: row.reviewId })) })));
      say('Original run loaded. Review its exact report identity before linking.');
    }), button('Link exact comparison', async () => {
      const current = state.selectedJob;
      if (!current || current.job.jobId !== jobId.input.value.trim() || current.job.state !== 'COMPLETED') throw new Error('Inspect the selected completed original run before linking it.');
      await change('bind-comparison', { projectionId: selectedProjection.input.value, jobId: current.job.jobId,
        reportSha256: current.job.result.report.sha256 }, 'The original completed report is now linked to this exact XML projection.');
    })), jobView);
    comparisons.append(table(['Original job', 'Comparator / latest review', 'Target', 'Open'], filing.comparisons.map(row => [row.jobId,
      `${row.status} / ${row.reviews.at(-1)?.decision ?? 'Review pending'}`, row.projectionId,
      actions(button('Report and review', () => onOpenJob(row.jobId)), button('Open correction mapping', () => onOpenBundle(row.bundleId, row.jobId)))])));
    comparisons.append(el('p', 'The private family handoff includes original filing artifacts, every saved revision and native operation, plus the original replay export for each linked completed comparison.', { class: 'iris-muted' }),
      button('Download filing family handoff', async () => { await download(`/api/iris/filings/${encoded(filing.filingId)}/handoff`); say('Private filing family handoff downloaded with native replay and linked original comparison exports.'); }, true));
    right.append(comparisons);

    async function showDecision(decisionId) {
      const result = await api(`/api/iris/filings/${encoded(filing.filingId)}/decision?decisionId=${encoded(decisionId)}`);
      const destination = right.querySelector('[data-iris="decision-view"]'); if (destination) destination.replaceChildren(el('h4', 'Saved native decision'), el('pre', jsonText(result)));
    }
  }
  async function showMembers(submissionId, offset, destination) {
    const filingId = state.filing.filingId;
    const result = await api(`/api/iris/filings/${encoded(filingId)}/transmission?submissionId=${encoded(submissionId)}&offset=${offset}&limit=50`);
    if (state.filing?.filingId !== filingId) return;
    destination.replaceChildren(el('p', `${submissionId ? 'Records in submission ' + submissionId : 'Submissions'}: ${offset + 1}–${Math.min(offset + result.rows.length, result.total)} of ${result.total}`, { class: 'iris-muted' }));
    const rows = submissionId ? result.rows.map(row => [row.recordId, row.form, row.corrected ? 'Corrected' : 'Original', button('Select record', async () => {
      const edit = edits(filingId), line = `${submissionId}|${row.recordId}`;
      const lines = edit.selection.split(/\r?\n/).filter(Boolean); if (!lines.includes(line)) lines.push(line); edit.selection = lines.join('\n');
      const input = right.querySelector('[data-iris="record-selection"]'); if (input) input.value = edit.selection; say('Native record added to the explicit decision selection.');
    })]) : result.rows.map(row => [row.submissionId, row.recordCount, row.originalUniqueSubmissionId ?? '—', button('Records', () => showMembers(row.submissionId, 0, destination))]);
    destination.append(table(submissionId ? ['Record', 'Native form', 'Flag', 'Selection'] : ['Submission', 'Records', 'Original reference', 'Open'], rows),
      actions(...(submissionId ? [button('All submissions', () => showMembers('', 0, destination))] : []),
        ...(offset ? [button('Previous', () => showMembers(submissionId, Math.max(0, offset - 50), destination))] : []),
        ...(result.nextOffset !== null ? [button('Next', () => showMembers(submissionId, result.nextOffset, destination))] : [])));
  }
  async function showResponse(responseId, submissionId, offset, destination) {
    const filingId = state.filing.filingId;
    const result = await api(`/api/iris/filings/${encoded(filingId)}/response?responseId=${encoded(responseId)}&submissionId=${encoded(submissionId)}&offset=${offset}&limit=50`);
    if (state.filing?.filingId !== filingId) return;
    destination.replaceChildren(el('h4', `Native observation: ${result.status}`), el('pre', jsonText(result)));
    destination.append(actions(...(submissionId ? [button('All returned submissions', () => showResponse(responseId, '', 0, destination))] : result.rows.filter(row => row.recordCount).map(row => button(`Records: ${row.submissionId}`, () => showResponse(responseId, row.submissionId, 0, destination)))),
      ...(offset ? [button('Previous response page', () => showResponse(responseId, submissionId, Math.max(0, offset - 50), destination))] : []),
      ...(result.nextOffset !== null ? [button('Next response page', () => showResponse(responseId, submissionId, result.nextOffset, destination))] : [])));
  }
  const getFile = (kind, selector = '') => download(`/api/iris/filings/${encoded(state.filing.filingId)}/download?kind=${encoded(kind)}&id=${encoded(selector)}`);
  void act(async () => {
    state.configuration = await api('/api/iris/configuration');
    validation.input.options[0].textContent = state.configuration.schemaConfigured ? 'Validate configured XSD package' : 'XML structure (schema not configured)';
    intake.append(el('p', `Native artifact limit: ${Math.floor(state.configuration.maxArtifactBytes / 1024 / 1024)} MiB.`, { class: 'iris-muted' }));
    await refreshList();
    if (binding?.filingId) await openFiling(binding.filingId);
    else { renderFiling(); say('The retained filing desk is ready.'); }
  });
  return {
    currentPlan: () => binding ? structuredClone(binding) : null,
    updateDraft(next) {
      draft = next; binding = next.iris ? structuredClone(next.iris) : null;
      if (binding?.filingId && state.configuration && !state.busy) void act(() => openFiling(binding.filingId));
      else if (state.filing) renderFiling();
    },
  };
}

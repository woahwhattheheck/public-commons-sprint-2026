// MIT. Contract-upgrade controls inside the original merchant workspace.
const pretty = value => JSON.stringify(value, null, 2);
const short = value => value ? value.slice(0, 12) : 'none';
const stable = value => value === null || typeof value !== 'object' ? JSON.stringify(value) :
  Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' :
    '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
const element = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
};
const action = (label, run, secondary = true) => {
  const node = element('button', label, secondary ? 'secondary' : '');
  node.type = 'button'; node.addEventListener('click', run); return node;
};
const field = (label, input) => {
  const node = element('label', label); node.append(input); return node;
};
const option = (value, label) => { const node = element('option', label); node.value = value; return node; };
const definition = (label, value) => {
  const node = element('div', undefined, 'item'); node.append(element('strong', label), element('p', value)); return node;
};
function detail(label, value) {
  const node = element('details'); node.append(element('summary', label), element('pre', pretty(value))); return node;
}

export function mountGrpcUpgrades({ root, json, work, notice, onAdopt, mayAdopt, storageKey }) {
  let inventory = null, base = null, report = null, draftDirty = false, requestId = null, requestKey = null;
  let page = 0, filter = '', level = '', adoptionUnconfirmed = false;
  const title = element('input'); title.type = 'text'; title.maxLength = 120; title.id = 'upgrade-title';
  const candidate = element('select'); candidate.id = 'upgrade-candidate';
  const plan = element('textarea'); plan.rows = 20; plan.spellcheck = false; plan.id = 'upgrade-plan';
  const baseline = element('p'); baseline.id = 'upgrade-base';
  const status = element('p'); status.id = 'upgrade-status'; status.setAttribute('role', 'status');
  const candidateNote = element('p'); candidateNote.id = 'upgrade-candidate-note';
  const reports = element('div'); reports.id = 'upgrade-history';
  const results = element('div'); results.id = 'upgrade-result';
  const filters = element('div', undefined, 'actions');
  const search = element('input'); search.type = 'search'; search.placeholder = 'Find a field, message or method';
  search.setAttribute('aria-label', 'Find a contract change'); search.id = 'upgrade-search';
  const levels = element('select'); levels.setAttribute('aria-label', 'Contract change level');
  levels.id = 'upgrade-level';
  for (const [value, label] of [['', 'All changes'], ['action', 'Action'], ['review', 'Review'], ['info', 'Information']])
    levels.append(option(value, label));
  const changeRows = element('div'); changeRows.id = 'upgrade-changes';
  const paging = element('div', undefined, 'actions');
  const pageLabel = element('span'); pageLabel.id = 'upgrade-page-label';
  const previous = action('Previous changes', () => { page--; renderChanges(); });
  const next = action('Next changes', () => { page++; renderChanges(); });
  paging.append(previous, pageLabel, next); filters.append(search, levels);
  const newDraft = action('Use current saved revision', () => work(async () => {
    if (!allowReplacement('Starting another upgrade')) return;
    if (!inventory?.currentRevision) throw new Error('Save a merchant revision first.');
    const selected = await json('open', { revision: inventory.currentRevision });
    base = selected; title.value = selected.title.slice(0, 112) + ' upgrade'; plan.value = pretty(selected.plan);
    report = null; draftDirty = false; requestId = null; requestKey = null; adoptionUnconfirmed = false;
    if (!candidate.value) selectFirstCandidate();
    render(); notice('Upgrade starts from saved revision ' + short(base.id) + '. Its current HTTP routes and complete payment terms are in the proposed plan.');
  }, 'Opening the current saved merchant…'));
  const review = action('Review proposed upgrade', () => work(async () => {
    const value = inputs(), key = stable(value);
    if (key !== requestKey) { requestId = crypto.randomUUID(); requestKey = key; }
    try { sessionStorage.setItem(storageKey + ':last-upgrade', requestId); } catch {}
    report = await json('upgrade-review', { id: requestId, ...value }); adoptionUnconfirmed = false;
    draftDirty = false; page = 0; render(); await refreshHistory();
    notice(report.planValidation.valid ? 'Exact upgrade retained. Review its contract, route, request-example and payment changes before using this saved plan.' :
      'Upgrade review retained. Correct the proposed plan, then review the revised input.');
  }, 'Comparing captured contracts and compiling the proposed merchant…'), false);
  review.id = 'upgrade-review';
  const adopt = action('Use reviewed upgrade', () => work(async () => {
    if (!report || !reviewMatches()) throw new Error('Review the currently visible upgrade inputs first.');
    if (!report.planValidation.valid) throw new Error('Correct the reported merchant-plan error and review again.');
    if (!mayAdopt()) return;
    const selected = { id: report.id, expectedReviewSha256: report.reviewSha256 };
    adoptionUnconfirmed = true; renderControls();
    let result;
    try { result = await json('upgrade-adopt', selected); }
    catch (issue) {
      try { await reconcileOutcome(); }
      catch (readIssue) {
        renderControls();
        throw new Error(issue.message + ' Read the retained save outcome for this same review before choosing another operation. Outcome read: ' + readIssue.message);
      }
      return;
    }
    adoptionUnconfirmed = false; report = result; draftDirty = false;
    await onAdopt(result.revision);
    render(); notice('The reviewed upgrade is saved as ' + short(result.revision.id) +
      '. Use the original channel review, Prepare and release controls for this revision.');
  }, 'Saving the exact reviewed source and merchant plan…'), false);
  adopt.id = 'upgrade-adopt';
  const reconcile = action('Read retained save outcome', () => work(reconcileOutcome, 'Reading the original retained Save result…'));
  reconcile.id = 'upgrade-reconcile';
  const download = action('Download retained review', () => {
    if (!report) return;
    const bytes = new Blob([pretty(report) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(bytes), link = element('a'); link.href = url;
    link.download = 'grpc-contract-upgrade-' + report.id + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  download.id = 'upgrade-download';
  const controls = element('div', undefined, 'actions'); controls.append(newDraft, review, adopt, reconcile, download);
  const heading = element('h2', 'Contract upgrades');
  const explanation = element('p', 'Compare the current saved merchant with a retained protobuf revision or reflection capture. Keep its routes and terms, edit the proposed plan, and use the original Save and release workflow after reviewing the exact changes.');
  root.append(heading, explanation, baseline, field('Saved candidate source', candidate), candidateNote,
    field('Title of the upgraded merchant', title), field('Proposed merchant plan JSON', plan),
    controls, status, results, filters, changeRows, paging, element('h3', 'Retained upgrade reviews'), reports);
  candidate.addEventListener('change', changed);
  title.addEventListener('input', changed);
  plan.addEventListener('input', changed);
  search.addEventListener('input', () => { filter = search.value.toLowerCase(); page = 0; renderChanges(); });
  levels.addEventListener('change', () => { level = levels.value; page = 0; renderChanges(); });

  function allowReplacement(label) {
    return !draftDirty || window.confirm(label + ' will replace the edited upgrade plan. Continue?');
  }
  function selectedCandidate() {
    const value = candidate.value;
    if (value.startsWith('revision:')) return { kind: 'revision', id: value.slice(9) };
    if (value.startsWith('reflection:')) {
      const retained = inventory?.reflections?.find(row => row.id === value.slice(11));
      if (!retained) throw new Error('Select an existing retained reflection capture.');
      return { kind: 'reflection', id: retained.id, captureSha256: retained.captureSha256 };
    }
    throw new Error('Select a saved candidate revision or reflection capture.');
  }
  function inputs() {
    if (!base?.id) throw new Error('Use the current saved revision to begin this upgrade.');
    let value;
    try { value = JSON.parse(plan.value); }
    catch { throw new Error('The proposed merchant plan contains invalid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The proposed merchant plan must be a JSON object.');
    if (!title.value.trim()) throw new Error('Enter a title for the upgraded merchant.');
    return { baseRevision: base.id, candidate: selectedCandidate(), plan: value, title: title.value.trim() };
  }
  function reviewMatches() {
    if (!report) return false;
    try {
      const { id, ...request } = report.request;
      return stable(inputs()) === stable(request);
    } catch { return false; }
  }
  function changed() {
    draftDirty = true; renderControls(); renderCandidateNote();
  }
  function selectFirstCandidate() {
    const reflected = inventory?.reflections?.[0];
    if (reflected) candidate.value = 'reflection:' + reflected.id;
    else {
      const revision = inventory?.revisions?.find(row => row.id !== base?.id);
      candidate.value = revision ? 'revision:' + revision.id : '';
    }
  }
  function renderCandidateNote() {
    try {
      const selected = selectedCandidate();
      const row = selected.kind === 'reflection' ? inventory.reflections.find(row => row.id === selected.id) :
        inventory.revisions.find(row => row.id === selected.id);
      candidateNote.textContent = selected.kind === 'reflection' ?
        'Retained reflection ' + short(selected.id) + ' · protobuf ' + short(row.protoSha256) +
          ' · ' + row.services.length + ' services · ' + row.target :
        'Saved revision ' + short(selected.id) + ' · protobuf ' + short(row?.protoSha256) + '.';
    } catch { candidateNote.textContent = 'Capture another source in Source or Reflection, or choose a retained revision.'; }
  }
  function renderControls() {
    const match = reviewMatches();
    const alreadyApplied = Boolean(report?.adoption);
    baseline.textContent = base ? 'Upgrade base ' + short(base.id) + ' · current saved revision ' +
      short(inventory?.currentRevision) + (inventory?.currentRevision !== base.id ?
        alreadyApplied ? ' · this review retains its original saved result' :
        adoptionUnconfirmed || report?.adoptionIntent ? ' · read the retained Save outcome for this review' :
          ' · compare the new current revision before a new adoption' : '') :
      'No upgrade base selected. Use the current saved revision.';
    review.disabled = !base || !candidate.value || adoptionUnconfirmed;
    const stillSelected = report?.baseSelection?.revision === inventory?.currentRevision &&
      report?.baseSelection?.generation === inventory?.generation;
    const resumeAfterSave = report?.adoptionIntent?.after?.revision === inventory?.currentRevision &&
      report?.adoptionIntent?.after?.generation === inventory?.generation;
    adopt.disabled = adoptionUnconfirmed || !match || !report?.planValidation.valid || (!alreadyApplied && !stillSelected && !resumeAfterSave);
    adopt.textContent = alreadyApplied ? 'Open saved upgrade' : 'Use reviewed upgrade';
    reconcile.disabled = !report;
    download.disabled = !report;
    newDraft.disabled = adoptionUnconfirmed;
    status.textContent = !report ? 'Review uses the captured native types and serializes examples without an application request.' :
      adoptionUnconfirmed ? 'The original Save reply is unavailable. Read retained save outcome; this keeps the same review and sends no Save.' :
      !match ? 'The visible input differs from the retained review. Review this version before adopting it.' :
      report.adoption ? 'Saved upgrade ' + short(report.adoption.revision) + ' · retained review ' + short(report.reviewSha256) :
      report.adoptionIntent ? 'An original Save was started for this review. Use reviewed upgrade to reconcile that same saved operation.' :
      report.planValidation.valid ? 'Retained review ' + short(report.reviewSha256) + ' · proposed plan compiles.' :
        'Retained review ' + short(report.reviewSha256) + ' · proposed plan needs correction.';
  }
  function renderRoutes() {
    const block = element('section'); block.append(element('h3', 'Merchant route and customer contract changes'));
    for (const route of report.routes.rows) {
      const row = element('div', undefined, 'item');
      row.append(element('strong', route.id + ' · ' + route.status));
      const facts = [];
      if (route.publicPathChanged) facts.push('public URL changed');
      if (route.methodChanged) facts.push('native method changed');
      if (route.paymentChanged) facts.push('complete payment options changed');
      if (route.requestContractChanged) facts.push('request JSON contract changed');
      if (route.responseContractChanged) facts.push('response JSON contract changed');
      row.append(element('p', facts.length ? facts.join(' · ') : 'No changed retained route terms or public schema hashes.'));
      const check = (label, value) => {
        if (!value) return;
        row.append(element('p', label + ': ' + (value.accepted ?
          'accepted by native serialization · ' + value.wireBytes + ' wire bytes · ' + short(value.wireSha256) :
          (value.error.field ? value.error.field + ': ' : '') + value.error.code + ' — ' + value.error.message)));
      };
      check('Original saved example on candidate', route.sourceExampleOnCandidate);
      check('Selected upgrade example', route.selectedExample);
      row.append(detail('Exact previous and proposed route terms', { before: route.before, after: route.after }));
      row.append(detail('Request and response contract identities', { before: route.beforeContract, after: route.afterContract }));
      if (route.after?.method) row.append(action('Inspect candidate request and response schemas', () => work(async () => {
        const value = await json('upgrade-method', { id: report.id, method: route.after.method });
        const existing = row.querySelector('[data-method-schema]'); if (existing) existing.remove();
        const node = detail('Candidate ' + route.after.method, value); node.dataset.methodSchema = 'true'; node.open = true; row.append(node);
      }, 'Opening the captured candidate schema…')));
      block.append(row);
    }
    if (report.routes.invalidIds.length) block.append(detail('Routes with invalid or repeated identifiers', report.routes.invalidIds));
    return block;
  }
  function renderReport() {
    results.replaceChildren();
    if (!report) return;
    results.append(element('h3', 'Retained comparison'));
    results.append(definition('Captured source identities', short(report.before.protoSha256) + ' → ' + short(report.candidate.protoSha256)));
    if (report.source.changed) results.append(detail('Merchant connection and limit changes', report.source));
    results.append(detail('Contract comparison summary', report.comparison.summary));
    if (!report.planValidation.valid) {
      const issue = report.planValidation.error;
      results.append(definition('Proposed plan needs correction', (issue.field ? issue.field + ': ' : '') + issue.code + ' — ' + issue.message));
    }
    results.append(renderRoutes());
    const methods = element('details'); methods.append(element('summary', 'Method and request/response reachability'));
    for (const method of report.comparison.methods) methods.append(detail(method.path, method));
    results.append(methods);
    results.append(element('p', report.interpretation));
  }
  function renderChanges() {
    changeRows.replaceChildren();
    const rows = (report?.comparison.changes ?? []).filter(row =>
      (!level || row.level === level) && (!filter || [row.path, row.kind, row.message, ...(row.impacts ?? [])].join(' ').toLowerCase().includes(filter)));
    const count = Math.max(1, Math.ceil(rows.length / 25)); page = Math.max(0, Math.min(page, count - 1));
    pageLabel.textContent = rows.length + ' changes · page ' + (page + 1) + ' of ' + count;
    previous.disabled = page === 0; next.disabled = page + 1 >= count;
    for (const row of rows.slice(page * 25, page * 25 + 25)) {
      const node = element('div', undefined, 'item');
      node.append(element('strong', row.level.toUpperCase() + ' · ' + row.path),
        element('p', row.message), element('p', (row.impacts ?? []).join(' · ')),
        detail(row.kind + ' · exact values', { before: row.before, after: row.after }));
      changeRows.append(node);
    }
    if (!rows.length) changeRows.append(element('p', report ? 'No matching contract changes.' : 'The retained comparison will appear here.'));
  }
  async function reconcileOutcome() {
    if (!report) throw new Error('Open the original retained upgrade review first.');
    const retained = await json('upgrade-open', { id: report.id });
    report = retained; adoptionUnconfirmed = false;
    render();
    await refreshHistory();
    notice(retained.adoption ? 'The original Save completed as ' + short(retained.adoption.revision) +
      '. Open saved upgrade to view that retained result.' :
      retained.adoptionIntent ? 'The original Save intent is retained. Use reviewed upgrade to reconcile this same operation; no new review is needed.' :
        'The retained review has no Save intent or result. The original review remains available; no Save was sent by this read.');
  }
  async function openReview(id) {
    if (!allowReplacement('Opening a retained review')) return;
    report = await json('upgrade-open', { id }); adoptionUnconfirmed = false;
    base = await json('open', { revision: report.request.baseRevision });
    title.value = report.request.title; plan.value = pretty(report.request.plan);
    candidate.value = report.request.candidate.kind + ':' + report.request.candidate.id;
    requestId = report.id; const { id: unused, ...value } = report.request; requestKey = stable(value);
    draftDirty = false; page = 0;
    try { sessionStorage.setItem(storageKey + ':last-upgrade', report.id); } catch {}
    render(); notice('Exact retained upgrade review opened. Its base remains ' + short(base.id) + '.');
  }
  function renderHistory() {
    reports.replaceChildren();
    for (const retained of inventory?.upgrades ?? []) {
      const node = element('div', undefined, 'item');
      node.append(element('strong', retained.title),
        element('p', retained.createdAt + ' · ' + short(retained.baseRevision) + ' → ' + short(retained.protoSha256) +
          ' · ' + retained.routeCount + ' routes'),
        action('Open retained upgrade ' + short(retained.id), () => work(() => openReview(retained.id), 'Opening retained upgrade…')));
      reports.append(node);
    }
    if (!inventory?.upgrades?.length) reports.append(element('p', 'No upgrade review has been retained yet.'));
  }
  async function refreshHistory() { update(await json('state')); }
  function update(value) {
    inventory = value;
    const selected = candidate.value; candidate.replaceChildren(option('', 'Select a captured source'));
    const revisions = element('optgroup'); revisions.label = 'Saved revisions';
    for (const row of value.revisions ?? []) revisions.append(option('revision:' + row.id, row.title + ' · ' + short(row.id)));
    const captures = element('optgroup'); captures.label = 'Retained reflection captures';
    for (const row of value.reflections ?? []) captures.append(option('reflection:' + row.id,
      row.target + ' · ' + short(row.protoSha256) + ' · ' + row.createdAt));
    candidate.append(revisions, captures); candidate.value = selected;
    renderControls(); renderCandidateNote(); renderHistory();
  }
  function render() { renderControls(); renderCandidateNote(); renderReport(); renderChanges(); renderHistory(); }
  async function resume() {
    let retained; try { retained = sessionStorage.getItem(storageKey + ':last-upgrade'); } catch {}
    if (retained) {
      try { await openReview(retained); } catch (issue) { notice('Retained upgrade ' + short(retained) + ': ' + issue.message, 'error'); }
    }
  }
  render();
  return { update, resume, hasDraft: () => draftDirty };
}

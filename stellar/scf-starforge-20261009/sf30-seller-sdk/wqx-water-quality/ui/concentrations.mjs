// MIT. Concentration preparation and full limit review inside the existing decision workspace.
const $ = id => document.getElementById(id);
const PAGE = 25;
const show = value => value === undefined || value === null ? '—' : value === '' ? '(empty)' : String(value);
const make = (tag, value, attributes = {}) => {
  const node = document.createElement(tag); if (value !== undefined && value !== null) node.textContent = String(value);
  for (const [key, item] of Object.entries(attributes)) node.setAttribute(key, String(item)); return node;
};
const option = (node, value, label) => node.append(make('option', label, {value}));
function download(value, name, mime = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'], {type:mime}));
  const link = make('a', null, {href:url, download:name}); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function mountConcentrations({api, notice, run, context, applyDocument}) {
  let catalog = null, proposal = null, draftVersion = -1, selectedSignature = '', configVersion = 0, proposalConfig = -1;
  let sourceTicket = 0, offset = 0, applied = false, reopened = false;
  function selection() {
    const state = context();
    if ($('cu-scope').value === 'unit') return catalog?.groups.find(row => row.unit === $('cu-source-unit').value)?.resultIds ?? [];
    if ($('cu-scope').value === 'limits') return catalog?.limitOnly?.resultIds ?? [];
    return state.selectedResultIds ?? [];
  }
  function signature() { return [...selection()].sort().join('\0'); }
  function current() {
    const state = context();
    return Boolean(proposal && state.document && proposal.source.sourcePlanSha256 === state.document.sourcePlanSha256 &&
      draftVersion === state.version && proposalConfig === configVersion && (reopened || selectedSignature === signature()));
  }
  function update() {
    const state = context(), active = Boolean(state.document && catalog && catalog.sourcePlanSha256 === state.document.sourcePlanSha256);
    $('cu-controls').disabled = state.busy || !active || state.saved;
    $('cu-source-unit').disabled = $('cu-scope').value !== 'unit';
    $('cu-selected').textContent = selection().length.toLocaleString() + ' result records selected for a unit change';
    $('cu-prepare').disabled = state.busy || !active || state.saved || !selection().length;
    $('cu-apply').disabled = state.busy || state.saved || !current() || proposal?.state !== 'PREPARED' || applied || reopened;
    $('cu-undo').disabled = state.busy || state.saved || !current() || !applied || !proposal?.inputDocument;
    $('cu-json').disabled = state.busy || !proposal; $('cu-csv').disabled = state.busy || !proposal;
    $('cu-prev').disabled = state.busy || !offset; $('cu-next').disabled = state.busy || !proposal || offset + PAGE >= proposal.rows.length;
    $('cu-state').textContent = !proposal ? 'Prepare a unit change' : !current() ? 'Draft or selection changed' : reopened ? 'Saved conversion choices' :
      applied ? 'Added to decision draft' : proposal.state === 'PREPARED' ? 'Ready to add' : 'Review selected quantities';
    $('cu-context').textContent = catalog ? catalog.sourceResults.toLocaleString() + ' original results are available. Select result targets, an exact source-unit group, or reported limits whose result unit is unspecified.' :
      'Open an immutable receiving plan to select original results.';
  }
  function clear() {
    catalog = null; proposal = null; applied = false; reopened = false; offset = 0; draftVersion = -1;
    $('cu-output').hidden = true; $('cu-source-unit').replaceChildren(); $('cu-target-unit').replaceChildren(); update();
  }
  async function loadSource(planId) {
    const ticket = ++sourceTicket; clear();
    const value = await api('/api/review-sheets/source/' + encodeURIComponent(planId) + '/concentrations');
    if (ticket !== sourceTicket || context().document?.sourcePlanId !== planId) return;
    if (value.sourcePlanSha256 !== context().document.sourcePlanSha256 || !Array.isArray(value.groups))
      throw new Error('The complete concentration source identity changed.');
    catalog = value; option($('cu-source-unit'), '', 'Choose an exact source unit');
    for (const row of value.groups) if (row.supported) option($('cu-source-unit'), row.unit, row.unit + ' · ' + row.count.toLocaleString() + ' results');
    for (const unit of value.profile.targetUnits) option($('cu-target-unit'), unit, unit);
    $('cu-target-unit').value = 'ug/L'; $('cu-scope').value = 'selected'; update();
  }
  function render() {
    if (!proposal) return update();
    $('cu-output').hidden = false;
    const summary = proposal.summary, original = summary.originalResults;
    $('cu-summary').textContent = summary.selectedResults.toLocaleString() + ' result records · ' +
      summary.reportedLimits.toLocaleString() + ' original reported limits · ' + summary.nativeLimits.toLocaleString() +
      ' native limit quantities. The complete source plan retains all ' + original.toLocaleString() + ' results.';
    $('cu-guidance').textContent = proposal.issues.length ?
      'Resolve the listed quantities or revise the selected result set, then prepare the complete conversion again.' :
      reopened ? 'These exact value/unit choices and their reasons reopened from the portable decision review.' :
      'Review every result and limit below, then add the paired choices to the current draft. Preview and save use the original complete receiving plan.';
    const body = $('cu-rows'); body.replaceChildren();
    for (const row of proposal.rows.slice(offset, offset + PAGE)) {
      const tr = make('tr');
      const identity = make('td', row.characteristic); identity.append(make('small', row.nativeResultId ?? row.sourceRecordId));
      identity.append(make('small', [row.sampleFraction,row.methodSpeciation,row.qualifier,row.detectionCondition].filter(Boolean).join(' · '))); tr.append(identity);
      tr.append(make('td', show(row.before.RESULT_MSR) + ' ' + show(row.before.RESULT_MSR_UNIT)),
        make('td', show(row.after.RESULT_MSR) + ' ' + show(row.after.RESULT_MSR_UNIT)));
      const limits = make('td');
      for (const item of row.reportedLimits) {
        const detail = make('details'), title = make('summary', show(item.original.type) + ' · ' +
          show(item.original.value) + ' ' + show(item.original.unit) + ' → ' +
          show(item.converted?.value) + ' ' + show(item.converted?.unit));
        detail.append(title, make('p', 'Origin: ' + show(item.original.origin) + ' · ' + show(item.original.comment)),
          make('pre', JSON.stringify(item.original.source, null, 2)));
        limits.append(detail);
      }
      if (!row.reportedLimits.length) limits.textContent = 'No reported limits';
      tr.append(limits);
      const native = make('td');
      for (const item of row.nativeLimits) native.append(make('p', item.field + ': ' + show(item.original.value) + ' ' +
        show(item.original.unit) + ' → ' + show(item.value) + ' ' + show(item.unit)));
      if (!row.nativeLimits.length) native.textContent = 'No populated native limit fields';
      tr.append(native, make('td', row.issues.map(issue => [issue.field,issue.code,issue.message].filter(Boolean).join(' · ')).join('\n') || 'Exact paired choices'));
      body.append(tr);
    }
    if (!body.children.length) { const tr = make('tr'); tr.append(make('td', 'This review has no retained concentration choices.', {colspan:6})); body.append(tr); }
    $('cu-page').textContent = proposal.rows.length ? (offset + 1) + '–' + Math.min(offset + PAGE, proposal.rows.length) + ' of ' + proposal.rows.length.toLocaleString() + ' converted results' : '0 converted results';
    update();
  }
  async function reopen(record) {
    const sourceHash = context().document?.sourcePlanSha256;
    const value = await api('/api/review-sheets/' + encodeURIComponent(record.reviewId) + '/concentrations');
    if (sourceHash !== context().document?.sourcePlanSha256) return;
    if (!value.rows.length) { discardReport(); return; }
    proposal = value; reopened = true; applied = false; offset = 0; draftVersion = context().version;
    proposalConfig = configVersion; render();
  }
  for (const id of ['cu-scope','cu-source-unit','cu-target-unit','cu-reason']) $(id).addEventListener('input', () => {
    configVersion++; update();
  });
  $('cu-form').addEventListener('submit', event => run(async () => {
    const state = context(true), ids = [...selection()];
    if (state.saved || !state.document || !ids.length) throw new Error('Choose original result records for this unit change.');
    const requestedVersion = state.version, requestedConfig = configVersion, selected = signature();
    const value = await api('/api/review-sheets/concentrations', {document:state.document, resultIds:ids,
      targetUnit:$('cu-target-unit').value, reason:$('cu-reason').value});
    if (requestedVersion !== context().version || requestedConfig !== configVersion || selected !== signature())
      throw new Error('The draft or selected quantities changed. Prepare the current selection again.');
    proposal = value; draftVersion = requestedVersion; proposalConfig = requestedConfig; selectedSignature = selected;
    applied = false; reopened = false; offset = 0; render();
    notice(value.state === 'PREPARED' ? 'Prepared the exact result and complete limit conversions. Review the full report before adding these choices.' :
      'The complete conversion report identifies the quantities needing a receiving choice.');
  }, event));
  $('cu-apply').addEventListener('click', event => run(async () => {
    if (!current() || proposal.state !== 'PREPARED' || applied || reopened) throw new Error('Prepare a current complete conversion first.');
    await applyDocument(proposal.document);
    draftVersion = context().version; applied = true; render();
    notice('Added the paired result/unit and native limit choices. All original reported limits remain available in the decision review.');
  }, event));
  $('cu-undo').addEventListener('click', event => run(async () => {
    if (!current() || !applied || !proposal?.inputDocument) throw new Error('Restore only the unchanged draft immediately preceding this conversion.');
    await applyDocument(proposal.inputDocument); draftVersion = context().version; applied = false; render();
    notice('Restored the complete preceding draft, including its original choices and reasons.');
  }, event));
  $('cu-json').addEventListener('click', () => {
    if (proposal) download(proposal, proposal.source.sourcePlanId + '-concentration-report.json');
  });
  $('cu-csv').addEventListener('click', event => run(async () => {
    if (!proposal) throw new Error('Prepare or reopen a complete concentration report.');
    const file = await api('/api/review-sheets/concentrations/csv', {report:proposal});
    download(file.text, file.filename, file.mime);
  }, event));
  $('cu-prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE); render(); });
  $('cu-next').addEventListener('click', () => { if (proposal && offset + PAGE < proposal.rows.length) offset += PAGE; render(); });
  function discardReport() { proposal = null; applied = false; reopened = false; offset = 0; $('cu-output').hidden = true; update(); }
  update(); return {update, loadSource, reopen, discardReport};
}

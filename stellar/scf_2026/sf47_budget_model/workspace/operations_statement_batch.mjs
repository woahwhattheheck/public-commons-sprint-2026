// Explicit multi-row decisions for the original statement preview and cash writer.
const categories = new Set(['OTHER', 'GRANT', 'INVOICE', 'CUSTOMER', 'CAPITAL', 'REFUND']);
const copy = value => structuredClone(value);
const exact = value => JSON.stringify(value);
const need = (value, message) => { if (!value) throw new Error(message); };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function statementMatchingRows(preview, status = 'ALL', query = '') {
  const needle = String(query).trim().toLowerCase();
  return (preview?.rows || []).filter(row =>
    (status === 'ALL' || row.status === status) &&
    (!needle || [row.reference, row.description, row.date, String(row.rowNumber)].join(' ').toLowerCase().includes(needle)));
}

export function statementSelection(preview, selected) {
  const ids = new Set((Array.isArray(selected) ? selected : []).filter(Number.isInteger));
  return (preview?.rows || []).filter(row => ids.has(row.rowNumber));
}

function sumDecimal(values) {
  const parsed = values.map(value => {
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(value));
    if (!match) return null;
    const fraction = match[3] || '';
    return {units: BigInt((match[1] === '-' ? '-' : '') + match[2] + fraction), scale: fraction.length};
  });
  if (parsed.some(value => !value)) return null;
  const scale = Math.max(0, ...parsed.map(value => value.scale));
  const total = parsed.reduce((sum, value) => sum + value.units * 10n ** BigInt(scale - value.scale), 0n);
  const negative = total < 0n, digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  return (negative ? '-' : '') + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
}

export function statementSelectionSummary(rows) {
  const groups = new Map(); let unreadable = 0, recorded = 0, excluded = 0, conflicts = 0;
  for (const row of rows) {
    if (row.status === 'EXISTING') recorded++;
    if (row.status === 'EXCLUDED') excluded++;
    if (row.status === 'CONFLICT') conflicts++;
    if (!row.currency || !['IN', 'OUT'].includes(row.direction) || !/^\d+(?:\.\d+)?$/.test(String(row.amount))) {
      unreadable++; continue;
    }
    const key = row.currency + '\0' + row.direction;
    if (!groups.has(key)) groups.set(key, {currency: row.currency, direction: row.direction, values: []});
    groups.get(key).values.push(row.amount);
  }
  return {count: rows.length, recorded, excluded, conflicts, unreadable,
    amounts: [...groups.values()].map(group => ({currency: group.currency, direction: group.direction,
      count: group.values.length, amount: sumDecimal(group.values)}))};
}

function effective(row, decision) {
  return {rowNumber: row.rowNumber, action: row.action || 'IMPORT', category: row.category,
    tranche: row.tranche ?? null, allocations: copy(row.allocations || []), reason: row.reason || '',
    ...(decision ? copy(decision) : {})};
}

export function prepareStatementBatch(preview, inputs, selected, options) {
  need(preview?.schema === 'stellar-forge.sf47-statements.v1' && Array.isArray(preview.rows), 'Preview the original statement first.');
  need(Array.isArray(inputs?.decisions), 'Use the current statement decisions.');
  need(Array.isArray(selected) && selected.length > 0 && selected.length <= 5000 &&
    selected.every(Number.isInteger) && new Set(selected).size === selected.length,
    'Select one or more distinct original source rows.');
  const rows = statementSelection(preview, selected);
  need(rows.length === selected.length, 'The selection contains a row absent from this preview. Select its current rows again.');
  const mode = options?.mode, category = options?.category || '', tranche = options?.tranche ?? 'KEEP';
  const reason = String(options?.reason || '').trim();
  need(['CLASSIFY', 'EXCLUDE', 'INCLUDE'].includes(mode), 'Choose classification, exclusion or inclusion.');
  need(reason.length > 0 && reason.length <= 4000 && !reason.includes('\0'), 'Write a review reason of 1 to 4,000 characters.');
  if (mode === 'CLASSIFY') {
    need(category === '' || categories.has(category), 'Choose an existing cash category.');
    need(['KEEP', 'CLEAR', '0', '1', '2', '3'].includes(String(tranche)), 'Keep, clear or choose a grant tranche.');
    need(category !== '' || tranche !== 'KEEP', 'Choose a category or a tranche to change.');
  }
  const decisions = new Map(inputs.decisions.map(row => [row.rowNumber, row]));
  need(decisions.size === inputs.decisions.length, 'Each source row needs one current decision.');
  const changes = [], skipped = [], problems = [];
  for (const row of rows) {
    if (mode === 'CLASSIFY' && row.status === 'EXISTING') {
      skipped.push({rowNumber: row.rowNumber, reason: 'Already recorded cash keeps its original classification.'}); continue;
    }
    const original = decisions.get(row.rowNumber), before = effective(row, original);
    const after = copy(original || {rowNumber: row.rowNumber, action: row.action || 'IMPORT'});
    if (mode === 'CLASSIFY') {
      if (category) after.category = category;
      if (tranche !== 'KEEP') after.tranche = tranche === 'CLEAR' ? null : Number(tranche);
    } else after.action = mode === 'EXCLUDE' ? 'EXCLUDE' : 'IMPORT';
    // Keep prior operator reasons. The original native review retains this same decision.
    after.reason = before.reason ? before.reason + '\n' + reason : reason;
    if (after.reason.length > 4000) problems.push({rowNumber: row.rowNumber, message: 'The combined reason exceeds 4,000 characters. Edit this row separately.'});
    const result = effective(row, after);
    if (mode === 'CLASSIFY' && result.tranche !== null && (result.category !== 'GRANT' || row.direction !== 'IN'))
      problems.push({rowNumber: row.rowNumber, message: 'A tranche needs a grant inflow. Clear the tranche or select only grant inflows.'});
    changes.push({rowNumber: row.rowNumber, reference: row.reference, description: row.description,
      date: row.date, direction: row.direction, amount: row.amount, currency: row.currency, status: row.status,
      allocationCount: (before.allocations || []).length, before, after, result});
  }
  return {schema: 'sf47.statement-batch-review.v1', caseId: preview.caseId,
    expectedVersion: preview.expectedVersion, previewSha256: preview.previewSha256,
    source: copy(preview.source), selected: rows.map(row => row.rowNumber),
    options: {mode, category, tranche: String(tranche), reason},
    decisionsBefore: copy(inputs.decisions), summary: statementSelectionSummary(rows),
    changes, skipped, problems, canApply: changes.length > 0 && problems.length === 0};
}

export function applyStatementBatch(preview, inputs, proposal) {
  need(proposal?.schema === 'sf47.statement-batch-review.v1', 'Prepare the selected-row changes first.');
  const current = prepareStatementBatch(preview, inputs, proposal.selected, proposal.options);
  need(exact(current) === exact(proposal), 'The preview or row decisions changed. Prepare the selected-row changes again.');
  need(current.canApply, 'Resolve the selected-row problems before applying the changes.');
  const byRow = new Map(current.changes.map(change => [change.rowNumber, copy(change.after)]));
  const decisions = inputs.decisions.map(row => byRow.has(row.rowNumber) ? byRow.get(row.rowNumber) : copy(row));
  const existing = new Set(inputs.decisions.map(row => row.rowNumber));
  for (const [rowNumber, decision] of byRow) if (!existing.has(rowNumber)) decisions.push(decision);
  return {decisions, undo: {previewSha256: preview.previewSha256, before: copy(inputs.decisions), after: copy(decisions)}};
}

export function undoStatementBatch(preview, inputs, undo) {
  need(undo && undo.previewSha256 === preview?.previewSha256 && exact(undo.after) === exact(inputs.decisions),
    'Later row edits or a new preview replaced this undo point.');
  return copy(undo.before);
}

export function statementBatchPanel({preview, selected, options, proposal, undo, dirty, page = 0, open = true}) {
  const rows = statementSelection(preview, selected), summary = statementSelectionSummary(rows), locked = dirty || !open;
  const attr = value => value ? ' disabled data-statement-fixed="true"' : '';
  const button = (text, action, disabled = false) => '<button type="button" data-statement-action="' + action + '"' + attr(disabled) + '>' + text + '</button>';
  const select = (title, name, choices, value) => '<label>' + title + '<select name="' + name + '"' + attr(locked) + '>' +
    choices.map(([id, text]) => '<option value="' + id + '"' + (String(id) === String(value) ? ' selected' : '') + '>' + text + '</option>').join('') + '</select></label>';
  const amounts = summary.amounts.map(row => escape(row.amount) + ' ' + escape(row.currency) + ' ' + (row.direction === 'IN' ? 'in' : 'out')).join(' · ');
  let review = '';
  if (proposal) {
    const pages = Math.max(1, Math.ceil(proposal.changes.length / 50)), current = Math.min(Math.max(0, page), pages - 1);
    const display = proposal.changes.slice(current * 50, (current + 1) * 50);
    const state = row => escape(row.action) + ' · ' + escape(row.category || 'Default') + ' · tranche ' + escape(row.tranche ?? 'unassigned');
    review = '<div class="statement-batch-proposal"><h5>Review ' + proposal.changes.length + ' row changes</h5>' +
      '<p>' + proposal.skipped.length + ' already-recorded rows keep their classification. Existing invoice allocations remain unchanged.</p>' +
      (proposal.options.mode === 'EXCLUDE' ? '<p>Exclusion omits these rows from this import. It does not void cash already recorded.</p>' : '') +
      (proposal.options.mode === 'INCLUDE' ? '<p>Inclusion returns the selected rows to native review. Source conflicts and duplicate identities still require resolution.</p>' : '') +
      '<p><strong>Appended review reason:</strong> ' + escape(proposal.options.reason) + '</p>' +
      (proposal.problems.length ? '<ul>' + proposal.problems.map(row => '<li>Row ' + row.rowNumber + ': ' + escape(row.message) + '</li>').join('') + '</ul>' : '') +
      '<div class="statement-table"><table><thead><tr><th>Source row</th><th>Before</th><th>After</th><th>Retained allocations</th></tr></thead><tbody>' +
      display.map(row => '<tr><td>' + row.rowNumber + ' · ' + escape(row.reference) + '<small>' + escape(row.description) + '</small></td><td>' +
        state(row.before) + '</td><td>' + state(row.result) + '</td><td>' + row.allocationCount + '</td></tr>').join('') +
      '</tbody></table></div><div class="statement-actions">' +
      button('Previous changes', 'batch-previous', current === 0) + '<span>Page ' + (current + 1) + ' of ' + pages + '</span>' +
      button('Next changes', 'batch-next', current + 1 >= pages) + button('Download all proposed changes', 'batch-export') +
      button('Apply these row decisions', 'batch-apply', locked || !proposal.canApply) + button('Cancel changes', 'batch-cancel') + '</div></div>';
  }
  return '<section class="statement-batch" aria-label="Review selected statement rows"><h5>Work with selected rows</h5>' +
    '<p data-statement-selection-count aria-live="polite">' + summary.count + ' selected across all pages' + (amounts ? ' · ' + amounts : '') + '.</p>' +
    '<p class="statement-batch-detail">' + summary.recorded + ' already recorded · ' + summary.excluded + ' excluded · ' + summary.conflicts +
    ' needing correction · ' + summary.unreadable + ' without a readable amount. These are source movements, not a total of new cash.</p>' +
    '<div class="statement-actions">' + button('Select rows on this page', 'batch-page', locked) +
    button('Select all matching rows', 'batch-matching', locked) + button('Clear selection', 'batch-clear', locked || !rows.length) + '</div>' +
    (dirty ? '<p>Preview the current decisions again before selecting or changing another group.</p>' : '') +
    '<div class="statement-fields">' +
    select('Change', 'batchMode', [['CLASSIFY', 'Category / grant tranche'], ['EXCLUDE', 'Exclude from this import'], ['INCLUDE', 'Include in native review']], options.mode) +
    (options.mode === 'CLASSIFY' ? select('Category', 'batchCategory', [['', 'Keep each current category'], ...[...categories].map(value => [value, value])], options.category) +
    select('Grant tranche', 'batchTranche', [['KEEP', 'Keep each current tranche'], ['CLEAR', 'Unassigned'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], options.tranche) : '') +
    '<label class="statement-wide">Reason to append to each changed row<textarea name="batchReason" rows="2" maxlength="4000"' + attr(locked) + '>' +
    escape(options.reason) + '</textarea></label></div><div class="statement-actions">' +
    button('Review selected-row changes', 'batch-prepare', locked || !rows.length) +
    button('Undo last group change', 'batch-undo', !open || !undo) + '</div>' + review + '</section>';
}

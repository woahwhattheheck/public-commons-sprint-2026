// Complete original customer periods inside the maintained Installation editor.
const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const table = (heads, rows) => '<div class="installation-table"><table><thead><tr>' +
  heads.map(value => '<th scope="col">' + esc(value) + '</th>').join('') +
  '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(value => '<td>' + value +
  '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
export const workflowBoundCheck = (document, check) =>
  !!document.workflowPeriods?.periods.some(row => row.checkId === check?.id);

export function workflowReportView(value) {
  const report = value?.report?.workflowPeriods ?? value?.workflowPeriods;
  if (!report) return '';
  return '<h4>Original customer operating periods</h4><p>' +
    report.recordedCompletePeriods + ' recorded complete native periods · ' +
    report.acceptedPeriods + ' periods accepted by their receiving operator · ' +
    report.distinctSelectedDeliveries + ' distinct selected customer deliveries.</p>' +
    table(['Customer period / source cycle','Recorded native run','Complete selected files','Actual receiving acceptance'],
      report.periods.map(row => [
        esc(row.period.start) + ' to ' + esc(row.period.end) + '<br><code>' + esc(row.cycleId) + '</code>',
        esc(row.recordedState) + ' · ' + row.completedSteps + ' / ' + row.stepCount +
          '<br><code>' + esc(row.runId) + '</code>',
        row.customerFiles + ' files · ' + row.customerBytes + ' bytes' +
          '<br>' + row.deliveryIds.map(esc).join('<br>'),
        esc(row.acceptanceState) + '<br>' + esc(row.observingOperator) + '<br>' + esc(row.observedAt)
      ])) +
    '<p class="installation-note">The attached original source keeps the complete profile, native reports and customer files. ' +
    'Each acceptance remains with this saved Installation edition.</p>';
}

export function workflowIntakePanel({ state, inventory, sources, targets, button, editable, pending, onSources }) {
  if (!state.open) return '';
  const select = (label, key, choices) => '<label><span>' + esc(label) +
    '</span><select data-workflow-period-field="' + key + '">' + choices.map(([id, name]) =>
      '<option value="' + esc(id) + '"' + (String(state[key]) === String(id) ? ' selected' : '') +
      '>' + esc(name) + '</option>').join('') + '</select></label>';
  const selected = new Set(state.cycleIds ?? []);
  const rows = inventory?.periods ?? [];
  return '<section class="installation-preview" aria-label="Original customer operating periods">' +
    '<div class="installation-heading"><div><h3>Receive customer operating periods</h3><p>' +
    'Attach the complete original recurring-work source ZIP in Sources. Read its profile, customer files and exact native periods, ' +
    'then prepare the Installation’s next operating edition.</p></div><div class="installation-actions">' +
    (onSources ? button('Open Sources','workflow-sources') : '') + button('Close','workflow-close') + '</div></div>' +
    '<div class="installation-fields">' +
    select('Complete original recurring-work source','sourceId',[['','Select the complete source ZIP'],...sources]) +
    select('Installation destination','target',targets) + '</div><div class="installation-actions">' +
    button('Read original customer periods','workflow-read','',!state.sourceId || !editable) + '</div>' +
    (inventory ? '<p><strong>' + esc(inventory.profile.name) + '</strong><br>Original profile ' +
      esc(inventory.profile.id) + ' · source workspace ' + esc(inventory.profile.sourceWorkspaceId) + '</p>' +
      table(['Select','Original task / period','Recorded native outcome','Complete customer files'],
        rows.map(row => [
          '<input type="checkbox" data-workflow-period-cycle="' + esc(row.cycleId) + '" aria-label="Select ' +
            esc(row.seriesName + ' ' + row.label) + '"' + (selected.has(row.cycleId) ? ' checked' : '') + '>',
          '<strong>' + esc(row.seriesName) + '</strong><br>' + esc(row.customer) + '<br>' +
            esc(row.period.start) + ' to ' + esc(row.period.end) + '<p>' + esc(row.label) + '</p>' +
            '<details><summary>Original task and repeat selection</summary><p>' + esc(row.task) + '</p><p>' +
            esc(row.sourceEdition) + '</p><p>' + esc(row.reason) + '</p><code>' + esc(row.cycleId) + '</code></details>',
          esc(row.state) + ' · ' + row.completedSteps + ' / ' + row.stepCount + ' steps<br>' +
            row.recoveredSteps + ' recovered steps<br><code>' + esc(row.runId) + '</code>',
          row.customerFiles + ' files · ' + row.customerBytes + ' bytes' +
            (row.files.length ? '<details><summary>Complete selected files</summary><ul>' +
              row.files.map(file => '<li>' + esc(file.name) + ' · ' + file.bytes +
                ' bytes<br><code>' + esc(file.sha256) + '</code></li>').join('') + '</ul></details>' :
              '<p>The complete original native results are retained; no separate delivery files are selected.</p>')
        ])) +
      '<p class="installation-note">Earlier selected periods remain in the saved Installation. A changed original task, run or ' +
      'delivery reopens its acceptance step for the next actual operator observation. Native payment and funded work retain their original records.</p>' +
      (inventory.otherDeliveries.length ? '<details><summary>Other original delivery records</summary>' +
        table(['Original delivery','Source state','Recorded location'],inventory.otherDeliveries.map(row =>
          [esc(row.id),esc(row.state),esc(row.reason)])) + '</details>' : '') : '') +
    '<div class="installation-actions">' +
    button('Prepare complete operating edition','workflow-prepare','',!editable || pending ||
      !rows.some(row => selected.has(row.cycleId))) + '</div></section>';
}

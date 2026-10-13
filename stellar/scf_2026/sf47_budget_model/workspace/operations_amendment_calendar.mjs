/* Complete amendment calendars; native Python owns dates and comparisons. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const human=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').toLowerCase();
const dates=(entry,award=false)=>{
  if(!entry)return 'No entry';
  if(award&&entry.kind!=='DELIVERABLE')return 'Not applicable';
  const start=entry[award?'originalStartDate':'startDate'],end=entry[award?'originalEndDate':'endDate'];
  if(!start&&!end)return 'Unassigned';
  if(start===end)return start;
  return (start||'Start unassigned')+' to '+(end||'Finish unassigned');
};
const owners=entry=>entry?(entry.ownerNames||[]).join(', ')||'Unassigned':'No entry';
const button=(label,action,scope,id)=>'<button type="button" data-amend-action="'+action+'" data-calendar-scope="'+scope+'"'
  +(id?' data-calendar-entry="'+esc(id)+'"':'')+'>'+esc(label)+'</button>';

export function calendarImpactHtml(report,scope='draft'){
  if(!report)return '';
  const s=report.source,n=report.summary;
  const rows=report.entries.map(item=>{
    const left=item.before,right=item.selected,row=right||left;
    const original=left&&['DELIVERABLE','DELIVERABLE_COMPLETED','SUBMISSION_DEADLINE','FORM_SUBMISSION','EXTENSION_CONFIRMATION','GRANT_RECEIPT'].includes(left.kind);
    const undated=[left,right].some(value=>value&&!value.startDate&&!value.endDate);
    return '<tr data-calendar-change="'+item.change+'" data-calendar-schedule="'+item.scheduleChanged+'" data-calendar-kind="'+item.kind+'" data-calendar-undated="'+undated+'">'
      +'<td><strong>'+esc(row.title)+'</strong><br>'+esc(human(item.kind))+' · tranche '+esc(item.tranche??'unassigned')+'<br><code>'+esc(item.id)+'</code>'
      +(original?'<div class="amend-actions">'+button(left.kind==='GRANT_RECEIPT'?'Current cash':'Current Completion','calendar-open',scope,item.id)+'</div>':'')+'</td>'
      +'<td>'+esc(human(item.change))+(item.changedFields.length?'<br><small>'+esc(item.changedFields.map(human).join(', '))+'</small>':'')+'</td>'
      +'<td>'+esc(dates(left))+'<br><small>'+esc(human(left?.dateBasis))+'</small></td>'
      +'<td>'+esc(dates(right))+'<br><small>'+esc(human(right?.dateBasis))+'</small></td>'
      +'<td>Before: '+esc(dates(left,true))+'<br>Selected: '+esc(dates(right,true))+'</td>'
      +'<td>Before: '+esc(owners(left))+'<br>Selected: '+esc(owners(right))
      +(item.assignmentRetained?'<br><strong>Saved assignment retained</strong>':'')+'</td></tr>';
  }).join('');
  return '<section class="amend-calendar" data-amend-calendar-scope="'+scope+'" aria-label="Amendment delivery calendar">'
    +'<h4>Delivery calendar impact</h4><p>Frozen case version '+s.caseVersionAtPreview+' · native baseline revision '+s.beforePlan.revision
    +' to selected revision '+s.selectedPlan.revision+' · comparison date '+esc(report.asOfDate)+'.</p>'
    +'<p>'+n.changedEntries+' changed entries · '+n.scheduleChanges+' date changes · '+n.retainedAssignments+' retained assignments · '
    +n.originalPaymentEntries+' original payment and form entries unchanged.</p>'
    +'<p>Before: '+n.beforeDated+' dated and '+n.beforeUndated+' undated entries. Selected: '+n.selectedDated+' dated and '+n.selectedUndated+' undated entries.</p>'
    +'<p>Saved assignments keep their actual dates and contributors. The selected award-plan dates appear alongside them. Source buttons reopen the current case with the comparison date.</p>'
    +'<div class="amend-actions">'+button('Download both calendars and complete case','calendar-export',scope)
    +'<label>Agenda entries<select data-amend-calendar-filter><option value="all">All entries</option><option value="changed">Changed entries</option>'
    +'<option value="schedule">Date changes</option><option value="assignments">Work packages</option><option value="undated">Undated entries</option></select></label></div>'
    +'<p data-amend-calendar-count role="status">'+report.entries.length+' of '+report.entries.length+' entries shown. The download contains the complete comparison.</p>'
    +'<div class="amend-scroll" tabindex="0" role="region" aria-label="Before and selected native calendar entries"><table><thead><tr>'
    +'<th>Entry / source</th><th>Change</th><th>Before dates</th><th>Selected dates</th><th>Award-plan dates</th><th>Contributors</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<details><summary>Original calendar selection</summary><p>Amendment preview <code>'+esc(s.previewSha256)
    +'</code><br>Calendar impact <code>'+esc(report.impactSha256)+'</code></p></details></section>';
}

export function filterCalendarImpact(select){
  const section=select.closest('[data-amend-calendar-scope]');
  if(!section)return;
  const rows=[...section.querySelectorAll('tbody tr')],kind=select.value;
  for(const row of rows){
    row.hidden=!(kind==='all'||kind==='changed'&&row.dataset.calendarChange!=='UNCHANGED'
      ||kind==='schedule'&&row.dataset.calendarSchedule==='true'
      ||kind==='assignments'&&row.dataset.calendarKind==='DELIVERABLE'
      ||kind==='undated'&&row.dataset.calendarUndated==='true');
  }
  section.querySelector('[data-amend-calendar-count]').textContent=rows.filter(row=>!row.hidden).length
    +' of '+rows.length+' entries shown. The download contains the complete comparison.';
}

export function calendarImpactSelection(report,id){
  const entry=report?.entries.find(row=>row.id===id)?.before;
  if(!entry)return null;
  return {tab:entry.kind==='GRANT_RECEIPT'?'cash':'completion',tranche:entry.tranche,
    context:{asOfDate:report.asOfDate,
      receiptId:entry.kind==='SUBMISSION_DEADLINE'?entry.sourceId:entry.receiptId,
      costId:entry.costId,reviewId:entry.reviewId}};
}

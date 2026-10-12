// MIT. Complete printable receiving reports from the retained receiving records.
const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const text = value => value === undefined ? '[absent]' : value === null ? 'null' :
  typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const span = value => '<span class="value">' + escape(text(value)) + '</span>';
function table(headers, rows, caption) {
  return '<div class="table-wrap"><table>' + (caption ? '<caption>' + escape(caption) + '</caption>' : '') +
    '<thead><tr>' + headers.map(value => '<th scope="col">' + escape(value) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(value => '<td>' + value + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>';
}
function description(values) {
  return '<dl>' + values.filter(([,value]) => value !== undefined).map(([name,value]) =>
    '<dt>' + escape(name) + '</dt><dd>' + span(value) + '</dd>').join('') + '</dl>';
}
function section(title, body) { return '<section><h2>' + escape(title) + '</h2>' + body + '</section>'; }
function cell(value) {
  if (!value || value.present === false) return '<span class="empty">[absent field]</span>';
  if (value.value === null || value.type === 'null') return '<span class="empty">null</span>';
  if (value.value === '' && value.text === '') return '<span class="empty">[empty string]</span>';
  return '<span class="value">' + escape(value.text ?? text(value.value)) + '</span>';
}
function issues(values) {
  if (!values?.length) return '<p>No recorded issues.</p>';
  return table(['Severity','Code','Record / column','Message'], values.map(value => [
    span(value.severity ?? ''), span(value.code ?? ''), span([value.rowId, value.header].filter(Boolean).join(' / ')), span(value.message)
  ]));
}
function summary(values) {
  return description(Object.entries(values ?? {}).map(([name,value]) => [
    name.replace(/([A-Z])/g,' $1').replace(/^./,character=>character.toUpperCase()), value
  ]));
}
function snapshot(value) {
  if (!value) return '';
  return description([
    ['Source edition',value.label ?? value.id],['Edition identity',value.id],['Edition revision',value.revision],
    ['Cycle',value.cycle],['As of',value.asOf],['Source review by',value.review?.by],
    ['Source review at',value.review?.at],['Source review reference',value.review?.reference]
  ]) + (value.sourceRefs?.length ? table(['Original source reference'],value.sourceRefs.map(reference=>[span(reference)])) : '');
}
function decisionsIndex(record) {
  return new Map((record.decisions ?? []).map(decision=>[decision.key,decision]));
}
function decisionCell(decision) {
  return decision ? '<strong>' + escape(decision.action) + '</strong><p>' + escape(decision.reason) + '</p>' :
    '<span class="empty">Awaiting receiving decision</span>';
}
function valueChange(change, side) {
  if (change[side + 'Present'] === false) return '<span class="empty">[absent field]</span>';
  return span(change[side]);
}
function handoffBody(record) {
  const profile = record.profile ?? {}, rows = record.rows ?? [];
  const headers = ['Original row','Job',...(profile.columns ?? []).map(column=>column.header)];
  let body = section('Recipient and receiving format', description([
    ['Profile',profile.label ?? profile.id],['Profile identity',profile.id],['Recipient',profile.recipient],
    ['Format',profile.format],['Line ending',profile.lineEnding],['UTF-8 byte order mark',profile.bom ? 'Included' : 'Omitted'],
    ['Source note',profile.sourceNote]
  ]));
  body += section('Reviewed source edition',snapshot(record.snapshot));
  body += section('Complete receiving rows', '<p>' + rows.length + ' retained rows' +
    (record.excludedRows?.length ? '; ' + record.excludedRows.length + ' source rows excluded by the selection' : '') + '.</p>' +
    table(headers,rows.map(row=>[
      span(row.id),span(row.jobId),...(profile.columns ?? []).map(column=>cell(row.cells?.find(value=>value.header===column.header)))
    ]),'Recipient columns in their configured order'));
  body += section('Column definitions',table(['Recipient header','Original field pointer','Required','Returned edits'],(profile.columns ?? []).map(column=>[
    span(column.header),span(column.pointer),span(column.required ? 'Yes' : 'No'),span(column.editable ? 'May be reviewed' : 'Pricing review required')
  ])));
  if (record.excludedRows?.length) body += section('Excluded source rows',table(['Row identity','Job identity','Original version'],
    record.excludedRows.map(row=>[span(row.id),span(row.jobId),span(row.version)])));
  body += section('Source and receiving issues',issues(record.issues));
  body += section('Original row versions',table(['Row identity','Job identity','Version'],rows.map(row=>[
    span(row.id),span(row.jobId),span(row.version)
  ])));
  return body;
}
function returnBody(record) {
  const index = decisionsIndex(record), entries = record.entries ?? [];
  let body = section('Returned handback',description([
    ['Original handoff',record.handoffId],['Original handoff digest',record.handoffSha256],
    ['Returned format',record.source?.format],['Original returned bytes',record.source?.bytes],['Returned source digest',record.source?.sha256]
  ]) + summary(record.summary));
  if(record.snapshot)body += section('Reviewed original pricing edition',snapshot(record.snapshot));
  if(record.source?.columnMapping&&Object.keys(record.source.columnMapping).length)
    body += section('Retained returned header assignments',table(['Expected receiving column','Original returned header'],
      Object.entries(record.source.columnMapping).map(([expected,original])=>[span(expected),span(original)])));
  body += section('Complete receiving decisions',table(['Record','Original row / job','Return status','Requested action / note','Receiving decision'],entries.map(entry=>[
    span(entry.recordNumber ?? ''),span([entry.rowId,entry.jobId].filter(value=>value!==undefined).join(' / ')),
    span(entry.status),span([entry.requestedAction,entry.note].filter(Boolean).join('\n')),decisionCell(index.get(entry.key))
  ])));
  body += section('Returned value changes',entries.filter(entry=>entry.changes?.length).map(entry=>
    '<h3>' + escape(entry.rowId ?? entry.key) + ' / ' + escape(entry.jobId ?? '') + '</h3>' +
    table(['Recipient column','Original pointer','Original value','Returned value','Column review'],entry.changes.map(change=>[
      span(change.header),span(change.pointer),span(change.before),span(change.after),span(change.editable ? 'Editable receiving field' : 'Pricing review required')
    ]))
  ).join('') || '<p>No returned value changes.</p>');
  const allIssues = [...(record.issues ?? []),...entries.flatMap(entry=>(entry.issues ?? []).map(issue=>({
    ...issue,rowId:issue.rowId ?? entry.rowId
  })))];
  body += section('Receiving issues',issues(allIssues));
  body += section('Original return rows',entries.filter(entry=>entry.returned).map(entry=>
    '<h3>Returned record ' + escape(entry.recordNumber ?? entry.key) + '</h3>' +
    table(['Original returned header','Receiving column','Returned text'],[
      ...Object.entries(entry.returned).map(([header,value])=>[span(record.source?.columnMapping?.[header]??header),span(header),span(value)]),
      ...(entry.rawCells??[]).slice(Object.keys(entry.returned).length).map((value,index)=>[
        span('[no header for cell '+(Object.keys(entry.returned).length+index+1)+']'),span('[unassigned]'),span(value)])
    ])
  ).join(''));
  return body;
}
function annualBody(record) {
  const index = decisionsIndex(record), entries = record.entries ?? [];
  let body = section('Annual edition comparison',table(['Edition','Handoff identity','Handoff digest'],[
    [span('Previous'),span(record.previous?.id),span(record.previous?.sha256)],
    [span('Current'),span(record.current?.id),span(record.current?.sha256)]
  ]) + '<h3>Previous source edition</h3>' + snapshot(record.previous?.snapshot) +
    '<h3>Current source edition</h3>' + snapshot(record.current?.snapshot) + summary(record.summary));
  body += section('Complete job review',table(['Job','Status','Previous row','Current row','Receiving decision'],entries.map(entry=>[
    span(entry.jobId),span(entry.status),span(entry.previousRowId ?? entry.previous?.id ?? ''),
    span(entry.currentRowId ?? entry.current?.id ?? ''),decisionCell(index.get(entry.key))
  ])));
  const changed = entries.filter(entry=>entry.changes?.length);
  body += section('Changed original fields',changed.length ? changed.map(entry=>
    '<h3>' + escape(entry.jobId ?? entry.rowId ?? entry.key) + '</h3>' +
    table(['Original pointer','Previous value','Current value'],entry.changes.map(change=>[
      span(change.pointer),valueChange(change,'before'),valueChange(change,'after')
    ]))
  ).join('') : '<p>No changed field values are recorded.</p>');
  if (record.metadataChanges && (Array.isArray(record.metadataChanges) ? record.metadataChanges.length : Object.keys(record.metadataChanges).length)) {
    const changes = Array.isArray(record.metadataChanges) ? record.metadataChanges : Object.entries(record.metadataChanges).map(([pointer,value])=>({pointer,...value}));
    body += section('Source and format changes',table(['Original metadata','Previous value','Current value'],changes.map(change=>[
      span(change.pointer ?? change.field ?? change.key),valueChange(change,'before'),valueChange(change,'after')
    ])));
  }
  return body;
}
/** Complete standalone HTML; all rows are retained in the report regardless of screen filters. */
export function receivingReport(record, {kind = record?.kind, title} = {}) {
  if (!record || typeof record !== 'object') throw new TypeError('Choose a retained receiving record.');
  const handoff = ['handoff','handoff-preview'].includes(kind), returned = ['return-preview','return-review'].includes(kind),
    annual = ['annual-comparison','annual-review'].includes(kind);
  if (!handoff && !returned && !annual) throw new TypeError('Choose a handoff, returned review or annual comparison.');
  const saved = ['handoff','return-review','annual-review'].includes(kind);
  const heading = title ?? (handoff ? 'Compensation receiving handback' : returned ? 'Returned correction review' : 'Annual receiving review');
  const body = handoff ? handoffBody(record) : returned ? returnBody(record) : annualBody(record);
  const style = [
    'html{font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#20272d;background:#fff}',
    'body{max-width:1500px;margin:24px auto;padding:0 24px}h1{font-size:25px;margin:0 0 8px}h2{font-size:17px;margin:25px 0 10px;border-bottom:1px solid #bcc4c9;padding-bottom:6px}h3{font-size:14px;margin:18px 0 8px}',
    'header{border-bottom:2px solid #39464e;padding-bottom:14px}section{margin:20px 0}p{margin:8px 0}.status{display:inline-block;border:1px solid #aeb8bf;padding:3px 8px;font-size:11px}.empty{color:#5d676e;font-style:italic}',
    'dl{display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,4fr);gap:5px 18px;margin:10px 0}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}',
    '.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:11px;table-layout:auto}caption{text-align:left;font-weight:650;margin:6px 0}th,td{text-align:left;vertical-align:top;padding:7px 9px;border:1px solid #d0d6da;overflow-wrap:anywhere}th{background:#eef1f3}.value,pre{white-space:pre-wrap;overflow-wrap:anywhere}pre{font:11px/1.4 ui-monospace,monospace;margin:0}',
    'footer{border-top:1px solid #b8c1c8;margin-top:28px;padding-top:12px;font-size:10px;color:#55616a}',
    '@media(max-width:700px){body{padding:0 12px;margin:15px auto}dl{display:block}dt{margin-top:8px}table{font-size:10px}}',
    '@media print{@page{size:A4 landscape;margin:12mm}body{margin:0;padding:0;max-width:none}.table-wrap{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}h2,h3{break-after:avoid}table{font-size:9px}a{color:inherit}}'
  ].join('\n');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(heading) + '</title><style>' + style + '</style></head><body><header><h1>' + escape(heading) +
    '</h1><span class="status">' + (saved ? 'Retained receiving record' : 'Review preview') + '</span>' +
    description([['Receiving identity',record.id ?? record.handoffId],['Record kind',kind],
      ['Recorded by',record.createdBy],['Recorded at',record.createdAt],['Receiving digest',record.sha256],
      ['Reviewed preview',record.previewHash]]) + '</header>' + body +
    '<footer>All records in this receiving document are included. Monetary and percentage values retain the original source text. Column definitions and recorded receiving decisions accompany the handback.</footer></body></html>';
}

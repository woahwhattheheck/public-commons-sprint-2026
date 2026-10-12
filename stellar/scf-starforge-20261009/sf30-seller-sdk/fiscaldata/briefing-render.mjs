// MIT. Presentation of the original Fiscal comparison; no financial arithmetic.
import { canonical } from '../postgres/publisher/files.mjs';

export const BRIEFING_FORMAT = 'stellar-forge.fiscaldata-briefing.v1';
export const ROWS_PER_PAGE = 200;
const h = value => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
const json = value => JSON.stringify(canonical(value));
const states = ['added', 'removed', 'changed', 'unchanged'];
const label = value => value[0].toUpperCase() + value.slice(1);
const code = value => '<code>' + h(value) + '</code>';
const paragraph = value => String(value ?? '').split(/\r?\n/).filter(Boolean)
  .map(line => '<p>' + h(line) + '</p>').join('');

/** Grouping is textual. Original precision and signed decimal values are preserved. */
export function displayDecimal(value) {
  if (typeof value !== 'string') return value === null || value === undefined ? '—' : String(value);
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  return match[1] + match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (match[3] ?? '');
}
export function csvRow(values) {
  return values.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',') + '\r\n';
}
export function datedMeasures(comparison) {
  const rows = [];
  for (const field of comparison.measureFields) {
    const measure = comparison.summary.measureTotals[field];
    for (const side of ['left', 'right']) {
      const series = measure[side + 'Observations'];
      const context = measure[side] ?? {};
      for (const group of series?.groups ?? []) rows.push({
        field, label: context.label || field, side, editionId: comparison[side].id,
        editionSha256: comparison[side].sha256, unit: context.unit ?? measure.unit ?? '',
        scale: context.scale ?? measure.scale ?? '', compatible: measure.compatible === true,
        dateField: series.dateField, groupFields: series.groupFields,
        group: group.key, rows: group.rows, first: group.first, last: group.last,
        change: group.change, incompatibleDates: series.incompatibleDates,
        notes: context.notes ?? '', nullToken: context.nullToken ?? null
      });
    }
  }
  return rows;
}
export function datedMeasuresCsv(rows) {
  let result = csvRow(['field','label','side','edition_id','edition_sha256','unit','scale',
    'compatible_units','date_field','group','observations','first_date','first_value',
    'last_date','last_value','exact_dated_change','incompatible_dates','null_token_kind','null_token','notes']);
  for (const row of rows) result += csvRow([row.field,row.label,row.side,row.editionId,row.editionSha256,
    row.unit,row.scale,String(row.compatible),row.dateField,json(row.group),row.rows,
    row.first?.date,row.first?.value,row.last?.date,row.last?.value,row.change,
    row.incompatibleDates,row.nullToken===null?'native-null':'explicit-string',row.nullToken,row.notes]);
  return result;
}
export const BRIEFING_CSS = ":root{color-scheme:light;--ink:#202124;--muted:#60636a;--line:#d7d9dc;--paper:#fff;--wash:#f4f5f6}*{box-sizing:border-box}html{font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:var(--ink);background:var(--wash)}body{margin:0}a{color:inherit;text-underline-offset:3px}.wrap{max-width:1180px;margin:auto;padding:32px 30px 60px}header{border-bottom:2px solid var(--ink);padding-bottom:25px;margin-bottom:24px}.eyebrow{font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}h1{font-size:2rem;line-height:1.15;letter-spacing:-.025em;margin:0 0 14px;font-weight:650;overflow-wrap:anywhere}h2{font-size:1.28rem;line-height:1.3;margin:0 0 12px}h3{font-size:1rem;margin:0 0 8px}p{margin:0 0 12px}p:last-child{margin-bottom:0}.muted,.sub{color:var(--muted)}.sub{font-size:.85rem}section,.panel{background:var(--paper);border:1px solid var(--line);padding:22px;margin:0 0 18px;min-width:0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.grid>.panel{margin:0}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.stat{border:1px solid var(--line);padding:14px 16px;background:var(--paper)}.stat strong{display:block;font-size:1.8rem;font-weight:600}.stat span{color:var(--muted);font-size:.85rem}.links{display:flex;flex-wrap:wrap;gap:10px 18px;margin:14px 0}.links a{display:inline-block;padding:7px 12px;border:1px solid var(--line);background:var(--paper);text-decoration:none}.links a:hover{background:var(--wash)}.table-wrap{max-width:100%;overflow:auto;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;background:var(--paper);font-size:.87rem}th{text-align:left;font-weight:600;color:var(--muted);background:var(--wash)}td,th{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}.numeric{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}code{font:.83em/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;word-break:break-word}.notice{border-left:3px solid var(--ink);padding-left:14px;margin:14px 0}.pill{font-size:.72rem;letter-spacing:.03em;text-transform:uppercase;padding:2px 7px;border:1px solid #aaa;white-space:nowrap}details{border:1px solid var(--line);background:var(--paper);margin:10px 0;padding:0}summary{cursor:pointer;list-style-position:inside;padding:13px 15px;font-weight:550;overflow-wrap:anywhere}details>.body{padding:0 15px 16px}details[open]>summary{border-bottom:1px solid var(--line);margin-bottom:14px}dl{margin:0}dt{font-size:.8rem;color:var(--muted);margin-top:12px}dd{margin:3px 0;overflow-wrap:anywhere}.value{white-space:pre-wrap;overflow-wrap:anywhere}.row-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.row-key{font-family:ui-monospace,monospace;font-size:.87rem}.pager{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:16px 0}.pager a{padding:6px 10px;border:1px solid var(--line);text-decoration:none;background:var(--paper)}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}footer{border-top:1px solid var(--line);padding-top:18px;margin-top:28px;color:var(--muted);font-size:.8rem;overflow-wrap:anywhere}@media(max-width:650px){.wrap{padding:18px 14px 35px}h1{font-size:1.65rem}section,.panel{padding:16px}.grid,.field-grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}td,th{padding:9px}code{font-size:.8em}}@media print{html{background:#fff;font-size:10pt}.wrap{max-width:none;padding:0}.links,.pager{display:none}section,.panel,details{break-inside:avoid}.table-wrap{overflow:visible}table{font-size:8pt}header{margin-bottom:15px}a{text-decoration:none}}";
function shell(title, body, report, prefix='') {
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer"><title>' + h(title) + '</title>' +
    '<style>' + BRIEFING_CSS + '</style></head><body><main class="wrap">' + body +
    '<footer>Fiscal comparison briefing · ' + h(report.createdAt) + '<br>Comparison ' +
    code(report.comparison.id) + '<br>Original comparison identity ' + code(report.comparison.sha256) +
    '<br><a href="' + prefix + 'manifest.json">Complete file manifest</a> · ' +
    '<a href="' + prefix + 'briefing.json">Machine-readable briefing</a></footer></main></body></html>\n';
}
function sourceLink(value) {
  if (typeof value !== 'string') return h(value);
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:')
      return '<a href="' + h(url.href) + '" rel="noreferrer noopener">' + h(value) + '</a>';
  } catch {}
  return h(value);
}
function rowCountText(summary) {
  return summary.leftRows + ' left observations and ' + summary.rightRows + ' right observations; ' +
    summary.added + ' added, ' + summary.removed + ' removed, ' + summary.changed +
    ' changed and ' + summary.unchanged + ' unchanged matching observations.';
}
function measureSection(report) {
  let html = '<section><h2>Dated observations</h2><p>Each line preserves the original comparison’s ' +
    'first and last dated value for one selected edition and source-key group. The change is the original exact ' +
    'last value minus first value. Units and scale remain the reviewed source annotations.</p>';
  if (!report.datedMeasures.length) return html + '<p class="notice">The selected comparison has no compatible ' +
    'dated series. Review its source fields and original measure context below.</p></section>';
  for (const field of report.comparison.measureFields) {
    const rows = report.datedMeasures.filter(row => row.field === field);
    const measure = report.comparison.summary.measureTotals[field];
    html += '<h3>' + h(measure.left?.label || measure.right?.label || field) + ' ' + code(field) + '</h3>';
    html += '<div class="table-wrap"><table><thead><tr><th>Edition / group</th><th>First observation</th>' +
      '<th class="numeric">First value</th><th>Last observation</th><th class="numeric">Last value</th>' +
      '<th class="numeric">Exact dated change</th><th>Unit / scale</th></tr></thead><tbody>';
    for (const row of rows) html += '<tr><td>' + h(label(row.side)) +
      (Object.keys(row.group).length ? '<br>' + code(json(row.group)) : '') +
      '<br><span class="sub">' + row.rows + ' observations</span></td><td>' + h(row.first?.date) +
      '</td><td class="numeric">' + h(displayDecimal(row.first?.value)) + '</td><td>' +
      h(row.last?.date) + '</td><td class="numeric">' + h(displayDecimal(row.last?.value)) +
      '</td><td class="numeric">' + h(displayDecimal(row.change)) + '</td><td>' +
      h(row.unit) + '<br><span class="sub">Scale ' + h(row.scale) + '</span></td></tr>';
    html += '</tbody></table></div><p class="sub">Date field ' + code(rows[0]?.dateField ?? 'unavailable') +
      '; ' + h(rows.reduce((sum,row) => sum + row.incompatibleDates,0)) +
      ' observations with incompatible dates across the listed editions.</p>';
  }
  return html + '<p class="notice">For stock measures such as daily debt, adding balances across dates does not ' +
    'produce a period total. The original selected-row arithmetic remains available in comparison.json with ' +
    'its participating-row counts and interpretation.</p></section>';
}
function identityPanel(side, report) {
  const value = report.comparison[side], source = report.sources[side];
  return '<div class="panel"><h3>' + h(label(side)) + ': ' + h(value.name) + '</h3><dl>' +
    '<dt>Edition</dt><dd>' + code(value.id) + '</dd><dt>Edition identity</dt><dd>' + code(value.sha256) +
    '</dd><dt>Capture identity</dt><dd>' + code(value.captureSha256) + '</dd>' +
    '<dt>Original source endpoint</dt><dd>' + sourceLink(source.endpointUrl) + '</dd>' +
    '<dt>Selected source filter</dt><dd>' + code(source.filter) + '</dd>' +
    '<dt>Capture interval</dt><dd>' + h(source.startedAt || 'See original source') + ' → ' +
    h(source.completedAt || 'See original source') + '</dd></dl>' +
    '<details><summary>Original interpretation</summary><div class="body">' + paragraph(value.notes) +
    '<p class="sub">Full original field review and responses are in source-delivery.tar.gz.</p></div></details></div>';
}
function fieldReview(report) {
  const fields = new Set([...report.comparison.left.fields,...report.comparison.right.fields].map(f=>f.name));
  let html = '<section><h2>Field meaning and comparison coverage</h2><p>Original absent values, native nulls ' +
    'and explicit null markers stay distinct. Fiscal and calendar periods retain their separate source fields.</p>';
  for (const name of fields) {
    html += '<details><summary>' + code(name) + ' · ' +
      h(report.comparison.summary.fieldChanges[name] ?? 0) + ' row changes</summary><div class="body field-grid">';
    for (const side of ['left','right']) {
      const field = report.comparison[side].fields.find(f=>f.name===name);
      html += '<div><h3>' + h(label(side)) + '</h3>';
      if (!field) html += '<p>Field absent from this edition.</p>';
      else html += '<dl><dt>Label / original source</dt><dd>' + h(field.label) + ' / ' + code(field.source) +
        '</dd><dt>Role · unit · scale</dt><dd>' + h(field.role) + ' · ' + h(field.unit || 'none') +
        ' · ' + h(field.scale) + '</dd><dt>Null representation</dt><dd>' +
        (field.nullToken === null ? 'Native null' : code(JSON.stringify(field.nullToken))) +
        '</dd><dt>Notes</dt><dd>' + paragraph(field.notes) + '</dd></dl>';
      html += '</div>';
    }
    html += '</div></details>';
  }
  return html + '</section>';
}
export function renderBriefing(report) {
  const summary = report.comparison.summary;
  let html = '<header><p class="eyebrow">Treasury Fiscal Data · Comparison briefing</p><h1>' +
    h(report.title) + '</h1><p>' + h(rowCountText(summary)) + '</p>' +
    (report.audience ? '<p class="sub">Prepared for ' + h(report.audience) + '</p>' : '') +
    '<nav class="links"><a href="briefing.md">Markdown report</a><a href="dated-measures.csv">Dated measures CSV</a>' +
    '<a href="source-delivery.tar.gz">Complete original source archive</a>' +
    (report.pages.all.length?'<a href="rows/all-0001.html">All row detail</a>':'') + '</nav></header>';
  if (report.notes) html += '<section><h2>Analyst commentary</h2>' + paragraph(report.notes) + '</section>';
  html += '<div class="stats">' + states.map(state => '<div class="stat"><strong>' + summary[state] +
    '</strong><span>' + h(label(state)) + '</span>' + (report.pages[state].length ?
      '<br><a href="rows/' + state + '-0001.html">Inspect observations</a>' : '') + '</div>').join('') + '</div>';
  html += '<section><h2>Read the comparison</h2><p>Added and removed observations describe membership in ' +
    'the two selected row sets. Changed observations compare values at the same complete key. A removed date ' +
    'alone does not mean Treasury revised or deleted a published observation.</p><p>Selected key: ' +
    report.comparison.keyFields.map(code).join(', ') + '.</p><p>' + h(report.comparison.distinction) + '</p></section>';
  html += measureSection(report);
  html += '<div class="grid">' + identityPanel('left',report) + identityPanel('right',report) + '</div>';
  html += fieldReview(report);
  html += '<section><h2>Complete handover</h2><p>The original source archive contains both reviewed editions, ' +
    'their raw Treasury responses, source filters, capture receipts and complete comparison. The report ' +
    'preserves the original numeric strings and consumes the saved comparison’s arithmetic.</p>' +
    '<div class="table-wrap"><table><thead><tr><th>File</th><th>Use</th></tr></thead><tbody>' +
    [['briefing.json','Complete briefing, original bindings, dated observations and row-page index'],
     ['comparison.json','Original complete comparison and numerical context'],
     ['dated-measures.csv','Exact first/last dated values and source units, one row per side and key group'],
     ['rows.jsonl','Every original comparison row, including unchanged rows and absent/null distinctions'],
     ['changes.csv','Original field-level change export'],
     ['source-delivery.tar.gz','Complete original comparison source delivery'],
     ['source-manifest.json','Original delivery file inventory and digests'],
     ['manifest.json','This briefing’s complete file inventory']].map(([path,use])=>
       '<tr><td><a href="' + path + '">' + h(path) + '</a></td><td>' + h(use) + '</td></tr>').join('') +
    '</tbody></table></div><dl><dt>Original source archive SHA-256</dt><dd>' +
    code(report.sourceArchive.sha256) + '</dd><dt>Comparison export</dt><dd>' + code(report.exportId) +
    '</dd></dl></section>';
  return shell(report.title,html,report);
}
function valueCell(row, side, field) {
  const record = row[side];
  if (record === null || !Object.hasOwn(record,field)) return '<span class="muted">Absent</span>';
  if (record[field] === null) return '<span class="muted">Native null</span>';
  return '<span class="value">' + h(record[field]) + '</span>';
}
export function renderRowPage(report, rows, category, pageIndex, pageCount) {
  const filename = number => category + '-' + String(number).padStart(4,'0') + '.html';
  const pager = '<nav class="pager"><span>' + (pageIndex>1 ? '<a href="' + filename(pageIndex-1) +
    '">Previous</a>' : 'First page') + '</span><span>' + pageIndex + ' of ' + pageCount +
    '</span><span>' + (pageIndex<pageCount ? '<a href="' + filename(pageIndex+1) + '">Next</a>' : 'Last page') +
    '</span></nav>';
  let body = '<header><p class="eyebrow">Original comparison row detail</p><h1>' + h(report.title) +
    '</h1><p>' + h(label(category)) + ' observations · page ' + pageIndex + ' of ' + pageCount +
    '</p><nav class="links"><a href="../index.html">Briefing</a><a href="../rows.jsonl">Complete original rows</a>' +
    ['all',...states].filter(x=>report.pages[x].length).map(x=>'<a href="' + x +
      '-0001.html">' + h(label(x)) + '</a>').join('') + '</nav></header>' + pager;
  for (const row of rows) {
    body += '<details' + (row.status==='unchanged' ? '' : ' open') +
      '><summary><span class="row-head"><span class="pill">' + h(row.status) + '</span>' +
      '<span class="row-key">' + h(json(row.key)) + '</span><span class="sub">Original row ' +
      (row.ordinal+1) + '</span></span></summary><div class="body"><p class="sub">Left row ' +
      (row.leftOrdinal===null?'absent':row.leftOrdinal+1) + ' · right row ' +
      (row.rightOrdinal===null?'absent':row.rightOrdinal+1) + '</p><div class="table-wrap">' +
      '<table><thead><tr><th>Field</th><th>Left</th><th>Right</th><th>Original exact delta</th></tr></thead><tbody>';
    const fields = new Set([...Object.keys(row.left??{}),...Object.keys(row.right??{})]);
    for (const name of fields) {
      const changed = row.changes.some(change=>change.field===name);
      body += '<tr><td>' + code(name) + (changed?'<br><span class="sub">Changed</span>':'') +
        '</td><td>' + valueCell(row,'left',name) + '</td><td>' + valueCell(row,'right',name) +
        '</td><td class="numeric">' + (Object.hasOwn(row.deltas??{},name) ?
          h(displayDecimal(row.deltas[name])) : '—') + '</td></tr>';
    }
    body += '</tbody></table></div></div></details>';
  }
  return shell(report.title+' — '+category+' page '+pageIndex,body+pager,report,'../');
}
const md = value => String(value ?? '').replace(/\\/g,'\\\\').replace(/\|/g,'\\|')
  .replace(/\r?\n/g,'<br>').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function renderBriefingMarkdown(report) {
  let text = '# '+report.title+'\n\n'+rowCountText(report.comparison.summary)+'\n\n';
  if(report.audience)text+='Prepared for '+report.audience+'.\n\n';
  if(report.notes)text+='## Analyst commentary\n\n'+report.notes+'\n\n';
  text+='## Dated observations\n\nValues and changes below come directly from the saved original comparison. ' +
    'Each line identifies one edition and source-key group. Units and scale remain source annotations.\n\n' +
    '| Measure | Side / group | First date | First value | Last date | Last value | Exact dated change | Unit / scale |\n' +
    '| --- | --- | --- | ---: | --- | ---: | ---: | --- |\n';
  for(const row of report.datedMeasures)text+='| '+[row.label,row.side+' '+json(row.group),row.first?.date,
    row.first?.value,row.last?.date,row.last?.value,row.change,row.unit+' / '+row.scale].map(md).join(' | ')+' |\n';
  if(!report.datedMeasures.length)text+='\nThe original comparison contains no compatible dated series.\n';
  text+='\nFor daily stock observations such as debt, adding balances across dates does not produce a period total. ' +
    'Original selected-row sums and participating-row counts remain in comparison.json.\n\n' +
    '## Membership and matching-key changes\n\nAdded and removed rows describe selected row-set membership; ' +
    'changed rows compare values at the same complete key. A removed date alone does not mean a source observation was revised or deleted.\n\n' +
    'Key fields: '+report.comparison.keyFields.join(', ')+'.\n\n' +
    '| Status | Rows | Detail |\n| --- | ---: | --- |\n';
  for(const status of states)text+='| '+status+' | '+report.comparison.summary[status]+' | '+
    (report.pages[status].length?'[Open original rows](rows/'+status+'-0001.html)':'No matching rows')+' |\n';
  text+='\n## Original sources and review\n\n';
  for(const side of ['left','right']){
    const entry=report.comparison[side],source=report.sources[side];
    text+='### '+label(side)+' — '+entry.name+'\n\nEdition: '+entry.id+'\n\nEdition SHA-256: '+entry.sha256+
      '\n\nCapture SHA-256: '+entry.captureSha256+'\n\nEndpoint: '+source.endpointUrl+
      '\n\nSelected filter: '+source.filter+'\n\nCapture interval: '+source.startedAt+' → '+source.completedAt+
      '\n\n'+entry.notes+'\n\n';
  }
  text+='## Complete handover\n\nOpen [index.html](index.html) for the report and every row-detail page. ' +
    'The exact numerical CSV is [dated-measures.csv](dated-measures.csv); [briefing.json](briefing.json) retains the full bindings and page index.\n\n' +
    'The original [source-delivery.tar.gz](source-delivery.tar.gz) contains both editions, source responses, receipts and full comparison. ' +
    'Its SHA-256 is '+report.sourceArchive.sha256+'. Export '+report.exportId+'.\n\n' +
    'The complete briefing file inventory is [manifest.json](manifest.json). All original comparison rows remain in rows.jsonl.\n';
  return text;
}

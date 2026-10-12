// MIT. Complete offline review of successive original FRED analyst reports.
import { csvCell, canonical, need, FRED_NOTICE, FRED_TERMS } from '../model.mjs';
import { validateFredBriefingTemplate, validateFredBriefingMaterialization, validateFredBriefingChanges, validateFredBriefingSuccessorRecord } from './templates.mjs';

export const FRED_BRIEFING_SUCCESSOR_CSV_COLUMNS = Object.freeze([
  'series', 'period', 'comparison', 'change_kind', 'changed_fields', 'source_context_fields',
  'before_title', 'after_title', 'before_value', 'after_value', 'value_revision',
  'before_missing', 'after_missing', 'before_state', 'after_state',
  'before_baseline_period', 'after_baseline_period', 'before_baseline_value', 'after_baseline_value',
  'before_baseline_missing', 'after_baseline_missing', 'before_absolute_change', 'after_absolute_change',
  'absolute_change_revision', 'before_change_units', 'after_change_units',
  'before_relative_percent', 'after_relative_percent', 'before_relative_state', 'after_relative_state',
  'before_relative_rounded', 'after_relative_rounded', 'before_units', 'after_units',
  'before_frequency', 'after_frequency', 'before_seasonal_adjustment', 'after_seasonal_adjustment',
  'before_as_of', 'after_as_of', 'before_time_basis', 'after_time_basis',
  'before_realtime_start', 'after_realtime_start', 'before_realtime_end', 'after_realtime_end',
]);
/** Every comparison row is exported with both original source values and calculation states. */
export function fredBriefingSuccessorCsv(comparison) {
  const lines = [FRED_BRIEFING_SUCCESSOR_CSV_COLUMNS.join(',')];
  for (const row of comparison.rows) {
    const a = row.before, b = row.after;
    lines.push([row.series, row.date, row.comparison, row.kind, row.reasons.join('; '), row.contextChanges.join('; '),
      a?.meaning.title, b?.meaning.title, a?.current.value, b?.current.value, row.currentValueDelta,
      a?.current.missing, b?.current.missing, a?.state, b?.state,
      a?.baselineDate, b?.baselineDate, a?.baseline?.value, b?.baseline?.value,
      a?.baseline?.missing, b?.baseline?.missing, a?.absoluteChange, b?.absoluteChange,
      row.absoluteChangeDelta, a?.changeUnits, b?.changeUnits,
      a?.relativePercent, b?.relativePercent, a?.relativeState, b?.relativeState,
      a?.relativeRounded, b?.relativeRounded, a?.meaning.units, b?.meaning.units,
      a?.meaning.frequency, b?.meaning.frequency, a?.meaning.seasonalAdjustment, b?.meaning.seasonalAdjustment,
      a?.current.as_of, b?.current.as_of, a?.current.time_basis, b?.current.time_basis,
      a?.current.realtime_start, b?.current.realtime_start, a?.current.realtime_end, b?.current.realtime_end,
    ].map(value => csvCell(value ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

const STYLE = `
:root{font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f3f3f3;color-scheme:light}
*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:1440px;margin:auto;padding:24px 32px}header{background:#fff;border-bottom:1px solid #c7c7c7}
h1{font-size:30px;line-height:1.2;font-weight:650;letter-spacing:-.02em;margin:6px 0 12px}h2{font-size:20px;margin:0 0 12px}h3{font-size:16px;margin:0 0 8px}
p{margin:8px 0 14px}.eyebrow{font-size:11px;letter-spacing:.12em;color:#555}.muted,small{color:#555}.notes{white-space:pre-wrap;max-width:110ch}
.toolbar,.controls,.pagination{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0}.controls{align-items:end}.controls label{display:grid;gap:4px;font-size:12px;flex:1 1 240px;min-width:0;max-width:100%}.controls select{width:100%;min-width:0;max-width:100%}
button,select,input{font:inherit;border:1px solid #999;border-radius:3px;padding:8px 12px;background:#fff;color:#171717}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}
button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible,.table-wrap:focus-visible{outline:3px solid #555;outline-offset:3px}a{color:#202020;text-underline-offset:3px}
.card{background:#fff;border:1px solid #ccc;padding:20px;margin-bottom:18px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}
.metric{background:#fff;border:1px solid #ccc;padding:14px}.metric strong{display:block;font-size:25px;font-weight:650;font-variant-numeric:tabular-nums}.metric span{font-size:12px;color:#555}
.table-wrap{overflow:auto;border:1px solid #ccc;background:#fff}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #ddd;white-space:nowrap}
th{background:#eee;font-size:12px;font-weight:650;position:sticky;top:0}td.wrap{white-space:normal;min-width:160px;max-width:440px;overflow-wrap:anywhere}
dl{display:grid;grid-template-columns:minmax(140px,220px) 1fr;gap:6px 16px}dt{color:#555}dd{margin:0;overflow-wrap:anywhere}pre{font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.identity{font:11px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.row-detail{margin-top:18px}.detail-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}summary{cursor:pointer;font-weight:650}
footer{font-size:12px;border-top:1px solid #ccc}.compact{font-size:12px}.count{color:#555}
@media(max-width:760px){header,main,footer{padding:18px 16px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-columns{grid-template-columns:1fr}h1{font-size:25px}dl{grid-template-columns:1fr}dd{margin-bottom:8px}select,input{max-width:100%}}
@media print{body{background:#fff}header,main,footer{max-width:none;padding:12px}.toolbar,.controls,.pagination,button{display:none}.card{break-inside:avoid}.table-wrap{overflow:visible}th{position:static}}
`;
const BROWSER = String.raw`
(() => {
  'use strict';
  const data=JSON.parse(document.getElementById('successor-data').textContent);
  const {template,materialization,comparison,successor}=data;
  const $=id=>document.getElementById(id);
  const el=(tag,value,cls)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=String(value);if(cls)node.className=cls;return node;};
  const show=value=>value===null||value===undefined||value===''?'—':typeof value==='object'?JSON.stringify(value):String(value);
  const kinds={NEW_PERIOD:'New period',EARLIER_PERIOD:'Earlier period',ADDED_COMPARISON:'Added comparison',LEFT_WINDOW:'Left window',REMOVED_COMPARISON:'Removed comparison',REVISED:'Revised',UNCHANGED:'Unchanged'};
  const methods={previous_period:'Previous period',year_earlier:'Year earlier',previous_observation:'Previous observation'};
  const statistic=(label,value)=>{const node=el('div',undefined,'metric');node.append(el('strong',value),el('span',label));$('metrics').append(node);};
  statistic('New period comparisons',comparison.totals.NEW_PERIOD);
  statistic('Revised overlap comparisons',comparison.totals.REVISED);
  statistic('Unchanged comparisons',comparison.totals.UNCHANGED);
  statistic('Comparisons leaving the window',comparison.totals.LEFT_WINDOW);
  const pair=(target,name,value)=>target.append(el('dt',name),el('dd',show(value)));
  const policy=el('dl');
  pair(policy,'Preceding report window',comparison.before.selection.start+' to '+comparison.before.selection.end);
  pair(policy,'New report window',materialization.window.start+' to '+materialization.window.end);
  pair(policy,'Calendar policy',template.window.months+' month(s), '+template.window.lagMonths+' trailing month(s) omitted');
  pair(policy,'Anchor selection',materialization.window.anchorBasis==='explicit'?'Explicit observation date':materialization.window.anchorBasis==='latest_all'?'Earliest latest recorded observation date':'Latest recorded observation date across selected series');
  pair(policy,'Anchor observation date',materialization.window.anchorDate);
  pair(policy,'Observed anchor date',materialization.window.observedAnchorDate);
  pair(policy,'Relative precision',template.briefing.decimalPlaces+' decimal places; half-even rounding');
  pair(policy,'Source context changes',comparison.contextChangedCount+' comparisons');
  $('window-policy').append(policy);
  for(const item of materialization.coverage) {
    const tr=el('tr');
    for(const value of [item.series,item.title,item.frequency,item.units,item.lastSourceDate,item.lastSourceMissing?'Missing marker':'Available',
      item.windowRows,item.windowMissing,item.firstWindowDate,item.lastWindowDate,item.rowsAfterWindow])tr.append(el('td',show(value)));
    $('coverage-body').append(tr);
  }
  const context=[...materialization.meaningChanges.map(item=>({scope:item.series??'Source',...item})),
    ...comparison.sourceChanges.map(item=>({scope:'Preceding report',...item}))];
  if(!context.length)$('context-empty').textContent='Selected source meaning and information basis are unchanged.';
  else for(const item of context) {
    const tr=el('tr');
    for(const value of [item.scope,item.field,item.before,item.after])tr.append(el('td',show(value),'wrap'));
    $('context-body').append(tr);
  }
  const seriesSelect=$('series-filter'),kindSelect=$('kind-filter');
  for(const id of [...new Set(comparison.rows.map(row=>row.series))]){const option=el('option',id);option.value=id;seriesSelect.append(option);}
  for(const [id,label] of Object.entries(kinds)){const option=el('option',label+' ('+comparison.totals[id]+')');option.value=id;kindSelect.append(option);}
  let offset=0,selected=[];
  function details(row) {
    $('detail-title').textContent=row.series+' · '+row.date+' · '+methods[row.comparison]+' · '+kinds[row.kind];
    $('detail-reasons').textContent=(row.reasons.length?'Changed fields: '+row.reasons.join(', '):'No overlapping economic or calculation fields changed.')+
      (row.contextChanges.length?' Source context: '+row.contextChanges.join(', '):'');
    $('detail-before').textContent=JSON.stringify(row.before,null,2);
    $('detail-after').textContent=JSON.stringify(row.after,null,2);
    $('detail').hidden=false;$('detail').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function render(reset=false) {
    if(reset)offset=0;
    const display=$('display-filter').value;
    selected=comparison.rows.filter(row=>(!seriesSelect.value||row.series===seriesSelect.value)&&
      (!kindSelect.value||row.kind===kindSelect.value)&&(display==='all'||display==='changed'&&row.kind!=='UNCHANGED'||
        display==='context'&&row.contextChanges.length>0));
    offset=Math.min(offset,Math.max(0,Math.floor((selected.length-1)/100)*100));
    $('changes-body').replaceChildren();
    for(const row of selected.slice(offset,offset+100)) {
      const a=row.before,b=row.after,tr=el('tr');
      for(const value of [row.series,row.date,methods[row.comparison],kinds[row.kind],a?.current.value,b?.current.value,row.currentValueDelta,
        a?.baselineDate,b?.baselineDate,a?.absoluteChange,b?.absoluteChange,b?.changeUnits??a?.changeUnits,
        a?.state,b?.state])tr.append(el('td',show(value)));
      const cell=el('td'),button=el('button','Inspect');button.setAttribute('aria-label','Inspect '+row.series+' '+row.date+' '+methods[row.comparison]);
      button.addEventListener('click',()=>details(row));cell.append(button);tr.append(cell);$('changes-body').append(tr);
    }
    $('comparison-count').textContent=selected.length?(offset+1)+'–'+Math.min(offset+100,selected.length)+' of '+selected.length+' comparisons':'No comparisons match this view.';
    $('previous').disabled=offset===0;$('next').disabled=offset+100>=selected.length;
  }
  for(const control of [seriesSelect,kindSelect,$('display-filter')])control.addEventListener('change',()=>render(true));
  $('previous').addEventListener('click',()=>{offset=Math.max(0,offset-100);render();});
  $('next').addEventListener('click',()=>{offset+=100;render();});render();
  const lineage=el('dl',undefined,'identity');
  for(const [name,value] of [['Template',template.id],['Template source review',template.origin.reviewId],
    ['Preceding review',comparison.before.reviewId],['Preceding report',comparison.before.reportId],['Preceding capture',comparison.before.captureId],
    ['Selected capture',materialization.captureId],['Saved successor',successor?.id],['New review',successor?.reviewId],['New report',successor?.reportId],
    ['Preceding successor',successor?.previousSuccessorId],['Selection identity',materialization.previewId],['Comparison identity',comparison.comparisonId]])
    pair(lineage,name,value);
  $('lineage').append(lineage);
  function download(content,type,name){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  $('download-csv').addEventListener('click',()=>download(fredBriefingSuccessorCsv(comparison),'text/csv;charset=utf-8','fred-briefing-changes.csv'));
  $('download-json').addEventListener('click',()=>download(JSON.stringify(data)+'\n','application/json','fred-briefing-successor.json'));
})();
`;

/** A self-contained source comparison; all rows and original observations remain available offline. */
export function renderFredBriefingSuccessor({ template, materialization, comparison, successor, briefing } = {}) {
  template = validateFredBriefingTemplate(template);
  materialization = validateFredBriefingMaterialization(materialization);
  validateFredBriefingChanges(comparison);
  need(materialization.templateId === template.id && comparison.after.captureId === materialization.captureId &&
    canonical(comparison.after.selection) === canonical(materialization.selection),
    'Render the comparison for the same retained template and calendar selection.');
  if (successor !== undefined) {
    successor = validateFredBriefingSuccessorRecord(successor);
    need(successor.templateId === template.id && successor.materialization.previewId === materialization.previewId &&
      successor.comparison.id === comparison.comparisonId && successor.beforeReviewId === comparison.before.reviewId &&
      successor.beforeReportId === comparison.before.reportId, 'Retain the saved successor for this original comparison.');
  }
  if (briefing !== undefined)
    need(successor && briefing?.reviewId === successor.reviewId && briefing?.reportId === successor.reportId,
      'Retain the new original report descriptor with its saved successor.');
  const payload = JSON.stringify({ template, materialization, comparison,
    ...(successor === undefined ? {} : { successor }), ...(briefing === undefined ? {} : { briefing }) })
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const script = 'const FRED_BRIEFING_SUCCESSOR_CSV_COLUMNS=' + JSON.stringify(FRED_BRIEFING_SUCCESSOR_CSV_COLUMNS) +
    ';\n' + csvCell.toString() + '\n' + fredBriefingSuccessorCsv.toString() + '\n' + BROWSER;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    '<title>', escapeHTML(template.name), ' · report changes</title><style>', STYLE, '</style></head><body>',
    '<header><p class="eyebrow">RECURRING ECONOMIC BRIEFING</p><h1>', escapeHTML(template.name), '</h1><p>',
    escapeHTML(comparison.before.selection.start), ' to ', escapeHTML(comparison.before.selection.end),
    ' → ', escapeHTML(materialization.window.start), ' to ', escapeHTML(materialization.window.end), '</p>',
    template.briefing.notes ? '<p class="notes">' + escapeHTML(template.briefing.notes) + '</p>' : '',
    '<div class="toolbar"><button id="download-csv">Download all changes</button><button id="download-json">Download complete source comparison</button></div></header>',
    '<main><div id="metrics" class="metrics"></div><section class="card" id="window-policy"><h2>Calendar window</h2>',
    '<p class="muted">The anchor uses original observation dates, including missing markers. Dates label source periods. Each comparison uses its own retained capture and the original analyst calculation.</p></section>',
    '<section class="card"><h2>Selected source coverage</h2><div class="table-wrap" role="region" aria-label="Selected source coverage" tabindex="0"><table><thead><tr>',
    '<th>Series</th><th>Title</th><th>Frequency</th><th>Units</th><th>Latest source date</th><th>Latest source state</th><th>Window rows</th><th>Missing</th>',
    '<th>First window date</th><th>Last window date</th><th>Rows after window</th></tr></thead><tbody id="coverage-body"></tbody></table></div></section>',
    '<section class="card"><h2>Source meaning and information basis</h2><p id="context-empty" class="muted"></p><div class="table-wrap" role="region" aria-label="Source meaning and information basis" tabindex="0"><table><thead><tr>',
    '<th>Scope</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody id="context-body"></tbody></table></div></section>',
    '<section class="card"><h2>Period changes</h2><div class="controls"><label>Series<select id="series-filter"><option value="">All selected series</option></select></label>',
    '<label>Change<select id="kind-filter"><option value="">All change kinds</option></select></label>',
    '<label>Display<select id="display-filter"><option value="changed">Economic and calculation changes</option><option value="context">Source context changes</option><option value="all">All comparisons</option></select></label></div>',
    '<div class="table-wrap" role="region" aria-label="Period changes" tabindex="0"><table><thead><tr><th>Series</th><th>Period</th><th>Comparison</th><th>Change</th><th>Before value</th><th>After value</th><th>Value revision</th>',
    '<th>Before baseline</th><th>After baseline</th><th>Before change</th><th>After change</th><th>Change units</th><th>Before state</th><th>After state</th><th>Source details</th>',
    '</tr></thead><tbody id="changes-body"></tbody></table></div><div class="pagination"><button id="previous">Previous</button>',
    '<span id="comparison-count" class="count"></span><button id="next">Next</button></div>',
    '<section class="row-detail" id="detail" hidden><h3 id="detail-title"></h3><p id="detail-reasons" class="compact"></p><div class="detail-columns">',
    '<div><h3>Preceding report source</h3><pre id="detail-before"></pre></div><div><h3>New report source</h3><pre id="detail-after"></pre></div></div></section></section>',
    '<section class="card" id="lineage"><h2>Original report lineage</h2></section></main>',
    '<footer><p>Calendar windows select original observations. Missing values remain explicit, and all baselines come from the same retained capture as their reported period.',
    ' Revisions are new minus preceding values in equal original units, frequencies, and seasonal adjustment.</p>',
    '<p>', escapeHTML(FRED_NOTICE), ' <a href="', escapeHTML(FRED_TERMS), '">FRED API terms</a>.</p></footer>',
    '<script id="successor-data" type="application/json">', payload, '</script><script>', script, '</script></body></html>\n',
  ].join('');
}

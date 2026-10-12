// MIT. Complete offline analyst report and exact-source CSV.
import { csvCell } from '../model.mjs';

export const BRIEFING_CSV_COLUMNS = Object.freeze(['series', 'title', 'date', 'value', 'missing', 'comparison',
  'baseline_date', 'baseline_value', 'baseline_missing', 'state', 'absolute_change', 'change_units',
  'relative_percent', 'relative_state', 'relative_rounded', 'source_units', 'frequency', 'seasonal_adjustment',
  'as_of', 'time_basis', 'realtime_start', 'realtime_end']);
export function fredBriefingCsv(report) {
  const metadata = new Map(report.series.map(item => [item.id, item]));
  return BRIEFING_CSV_COLUMNS.join(',') + '\n' + report.measures.map(item => {
    const current = report.observations[item.currentIndex], baseline = item.baselineIndex === null ? null : report.observations[item.baselineIndex];
    return [item.series, metadata.get(item.series).title, current.date, current.value, current.missing, item.comparison,
      item.baselineDate ?? '', baseline?.value ?? '', baseline?.missing ?? '', item.state, item.absoluteChange ?? '',
      item.changeUnits, item.relativePercent ?? '', item.relativeState, item.relativeRounded, current.units, current.frequency,
      current.seasonal_adjustment, current.as_of, current.time_basis, current.realtime_start, current.realtime_end].map(csvCell).join(',');
  }).join('\n') + (report.measures.length ? '\n' : '');
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
const STYLE = `
:root{font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f4f4f4;color-scheme:light}
*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:1360px;margin:auto;padding:24px 32px}header{border-bottom:1px solid #c7c7c7;background:#fff}
h1{font-size:30px;line-height:1.2;margin:6px 0 12px;font-weight:650;letter-spacing:-.02em}h2{font-size:20px;margin:0 0 12px}h3{font-size:16px;margin:0}
p{margin:8px 0 14px}.eyebrow{font-size:11px;letter-spacing:.12em;color:#555}.muted,small{color:#555}.notes{white-space:pre-wrap;max-width:100ch}
.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:18px 0 0}button,select,input{font:inherit;border:1px solid #999;border-radius:3px;padding:8px 12px;background:#fff;color:#171717}
button{cursor:pointer}button[aria-pressed=true]{background:#242424;color:#fff;border-color:#242424}button:disabled{cursor:default;opacity:.5}a{color:#202020;text-underline-offset:3px}
section[hidden]{display:none}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 22px}.metric{background:#fff;border:1px solid #ccc;padding:14px}
.metric strong{display:block;font-size:25px;font-weight:650;font-variant-numeric:tabular-nums}.metric span{font-size:12px;color:#555}.card{background:#fff;border:1px solid #ccc;padding:20px;margin:0 0 18px}
.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.series-card{background:#fff;border:1px solid #c7c7c7;padding:18px}.value{font-size:28px;line-height:1.25;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.series-card dl{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;border-top:1px solid #ddd;padding-top:12px;margin-bottom:0}.series-card dt{color:#555}.series-card dd{text-align:right;margin:0;overflow-wrap:anywhere}
.table-wrap{overflow:auto;border:1px solid #ccc;background:#fff}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #ddd;white-space:nowrap}th{background:#eee;font-size:12px;font-weight:650;position:sticky;top:0}
td.wrap{white-space:normal;min-width:150px}.controls{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:0 0 12px}.controls label{display:grid;gap:4px;font-size:12px}.pagination{display:flex;gap:10px;align-items:center;margin:12px 0}
dl.source{display:grid;grid-template-columns:minmax(130px,180px) 1fr;gap:6px 18px}dl.source dt{color:#555}dl.source dd{margin:0;overflow-wrap:anywhere}.source-notes{white-space:pre-wrap;font-size:12px;padding:12px;background:#f4f4f4}.identity{font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere}
footer{font-size:12px;border-top:1px solid #ccc}#measure-count{color:#555}button:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #555;outline-offset:3px}
@media(max-width:700px){header,main,footer{padding:18px 16px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.summary-grid{grid-template-columns:1fr}dl.source{grid-template-columns:1fr}dl.source dd{margin-bottom:8px}h1{font-size:25px}.controls>*{flex:1}select{max-width:100%}}
@media print{body{background:#fff}header,main,footer{max-width:none;padding:12px}button,.controls,.pagination{display:none}.card,.series-card{break-inside:avoid}.table-wrap{overflow:visible}th{position:static}.source-notes{background:#fff}}
`;
const BROWSER = String.raw`
(() => {
  'use strict';
  const report = JSON.parse(document.getElementById('report-data').textContent);
  const $ = id => document.getElementById(id);
  const labels = {previous_period:'Previous period',year_earlier:'Year earlier',previous_observation:'Previous observation'};
  const stateLabels = {READY:'Available',SOURCE_MISSING:'Source value missing',BASE_ABSENT:'Baseline absent',BASE_MISSING:'Baseline value missing',
    CALENDAR_DATE_ABSENT:'Calendar date absent',NUMERIC_LITERAL_UNSUPPORTED:'Numeric format unavailable',ZERO_BASE:'Zero baseline',NOT_SELECTED:'Not selected',SOURCE_UNAVAILABLE:'Source unavailable'};
  const el = (tag, text, className) => { const node=document.createElement(tag); if(text!==undefined)node.textContent=String(text); if(className)node.className=className; return node; };
  const show = value => value === null || value === undefined || value === '' ? '—' : String(value);
  function pair(root, name, value) { root.append(el('dt',name),el('dd',show(value))); }
  const statistics = [['Series',report.series.length],['Selected observations',report.selectedRows],['Source missing markers',report.missing],['Period comparisons',report.measureCount]];
  for(const [name,value] of statistics){const box=el('div',undefined,'metric');box.append(el('strong',value),el('span',name));$('metrics').append(box);}
  for(const item of report.series){
    const card=el('article',undefined,'series-card');card.append(el('p',item.id,'eyebrow'),el('h3',item.title));
    card.append(el('p',item.latest?show(item.latest.value):'No observations in this interval','value'));
    card.append(el('p',(item.latest?.date??'')+' · '+item.units+' · '+item.frequency,'muted'));
    const list=el('dl');
    for(const measure of item.latestMeasures){
      const value=measure.state==='READY'?measure.absoluteChange+' '+measure.changeUnits:stateLabels[measure.state]??measure.state;
      pair(list,labels[measure.comparison],value);
      if(item.selection.relativeChange)pair(list,labels[measure.comparison]+' relative %',measure.relativePercent===null?(stateLabels[measure.relativeState]??measure.relativeState):measure.relativePercent+'%');
    }
    if(item.latest?.missing&&item.latestAvailable)pair(list,'Latest available source value',item.latestAvailable.value+' · '+item.latestAvailable.date);
    pair(list,'Source updated',item.lastUpdated);card.append(list);$('summary-cards').append(card);
  }
  const seriesSelect=$('series-filter');for(const item of report.series){const option=el('option',item.id+' — '+item.title);option.value=item.id;seriesSelect.append(option);}
  const statusSelect=$('status-filter');for(const state of Object.keys(report.totals)){const option=el('option',stateLabels[state]??state);option.value=state;statusSelect.append(option);}
  let offset=0, selected=report.measures;
  function renderMeasures(reset=false) {
    if(reset)offset=0;
    selected=report.measures.filter(item=>(!seriesSelect.value||item.series===seriesSelect.value)&&(!statusSelect.value||item.state===statusSelect.value));
    offset=Math.min(offset,Math.max(0,Math.floor((selected.length-1)/100)*100));
    $('measure-body').replaceChildren();
    for(const item of selected.slice(offset,offset+100)){
      const current=report.observations[item.currentIndex],baseline=item.baselineIndex===null?null:report.observations[item.baselineIndex];
      const tr=el('tr');
      for(const value of [item.series,current.date,current.value,labels[item.comparison],item.baselineDate,baseline?.value,item.absoluteChange,item.changeUnits,
        item.relativePercent===null?'—':item.relativePercent+'%',stateLabels[item.state]??item.state])tr.append(el('td',show(value)));
      $('measure-body').append(tr);
    }
    $('measure-count').textContent=selected.length?(offset+1)+'–'+Math.min(offset+100,selected.length)+' of '+selected.length+' comparisons':'No comparisons match this view.';
    $('previous').disabled=offset===0;$('next').disabled=offset+100>=selected.length;
  }
  seriesSelect.addEventListener('change',()=>renderMeasures(true));statusSelect.addEventListener('change',()=>renderMeasures(true));
  $('previous').addEventListener('click',()=>{offset=Math.max(0,offset-100);renderMeasures();});
  $('next').addEventListener('click',()=>{offset+=100;renderMeasures();});renderMeasures();
  for(const item of report.series){
    const card=el('article',undefined,'card');card.append(el('h3',item.id+' — '+item.title));
    const list=el('dl',undefined,'source');
    for(const [name,value] of [['Publisher',item.publisher],['Release',item.release],['Units',item.units],['Frequency',item.frequency],
      ['Seasonal adjustment',item.seasonalAdjustment],['Source updated',item.lastUpdated],['Information date',item.asOf??report.source.selection.asOf],
      ['Date basis',item.timeBasis??report.source.timeBasis],['Retrieved at',item.retrievedAt],['Original coverage',item.observationStart+' to '+item.observationEnd],
      ['Selected observations',item.selectedRows],['Selected missing markers',item.selectedMissing]])pair(list,name,value);
    card.append(list);const anchor=el('a','Open the original publisher series');anchor.href=item.sourceUrl;anchor.target='_blank';anchor.rel='noopener noreferrer';card.append(anchor);
    if(item.notes)card.append(el('p',item.notes,'source-notes'));$('sources').append(card);
  }
  const calculation=el('dl',undefined,'source');
  for(const [name,value] of [['Absolute changes',report.calculation.absoluteChange],['Relative changes',report.calculation.relativeFormula],
    ['Relative precision',report.calculation.relativeDecimalPlaces+' decimals; '+report.calculation.relativeRounding],['Previous period',report.calculation.priorPeriod],
    ['Year earlier',report.calculation.yearEarlier],['Previous observation',report.calculation.previousObservation],['Baseline source',report.calculation.baselineSource]])pair(calculation,name,value);
  $('calculation').append(calculation);
  function download(bytes,type,name){const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  $('download-csv').addEventListener('click',()=>download(fredBriefingCsv(report),'text/csv;charset=utf-8','fred-briefing-measures.csv'));
  $('download-json').addEventListener('click',()=>download(JSON.stringify(report)+'\n','application/json','fred-briefing.json'));
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
    for(const item of document.querySelectorAll('[data-view]'))item.setAttribute('aria-pressed',String(item===button));
    for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==button.dataset.view;
  });
})();
`;
export function renderFredBriefing(report) {
  const payload = JSON.stringify(report).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const script = 'const BRIEFING_CSV_COLUMNS=' + JSON.stringify(BRIEFING_CSV_COLUMNS) + ';\n' + csvCell.toString() + '\n' + fredBriefingCsv.toString() + '\n' + BROWSER;
  return ['<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    '<title>',escapeHTML(report.title),'</title><style>',STYLE,'</style></head><body><header><p class="eyebrow">ECONOMIC BRIEFING</p><h1>',
    escapeHTML(report.title),'</h1><p>',escapeHTML(report.selection.start),' to ',escapeHTML(report.selection.end),' · ',
    escapeHTML(report.source.timeBasis),' · information through ',escapeHTML(report.source.selection.asOf),'</p>',
    report.notes ? '<p class="notes">'+escapeHTML(report.notes)+'</p>' : '',
    '<div class="toolbar" aria-label="Report views"><button data-view="summary" aria-pressed="true">Summary</button><button data-view="measures" aria-pressed="false">Measures</button><button data-view="sources" aria-pressed="false">Sources & method</button><button id="download-csv">Download all measures</button><button id="download-json">Download report data</button></div></header>',
    '<main><div id="metrics" class="metrics"></div><section data-panel="summary"><h2>Retained economic observations</h2><div id="summary-cards" class="summary-grid"></div></section>',
    '<section data-panel="measures" hidden><h2>Exact period comparisons</h2><div class="controls"><label>Series<select id="series-filter"><option value="">All selected series</option></select></label><label>State<select id="status-filter"><option value="">All source states</option></select></label></div>',
    '<div class="table-wrap"><table><thead><tr><th>Series</th><th>Period</th><th>Original value</th><th>Comparison</th><th>Baseline period</th><th>Baseline value</th><th>Change</th><th>Change units</th><th>Relative change</th><th>Source state</th></tr></thead><tbody id="measure-body"></tbody></table></div>',
    '<div class="pagination"><button id="previous">Previous</button><span id="measure-count"></span><button id="next">Next</button></div></section>',
    '<section data-panel="sources" hidden><h2>Source and calculation</h2><article class="card" id="calculation"><h3>Selected method</h3></article><div id="sources"></div></section></main><footer><p>',
    escapeHTML(report.sourceNotice),' <a href="https://fred.stlouisfed.org/docs/api/terms_of_use.html" target="_blank" rel="noopener noreferrer">FRED API terms</a>.</p>',
    '<p>Percent-change method: <a href="https://www.bls.gov/cpi/factsheets/calculating-percent-changes.htm" target="_blank" rel="noopener noreferrer">U.S. Bureau of Labor Statistics</a>.</p>',
    '<p class="identity">Report ',escapeHTML(report.reportId),' · capture ',escapeHTML(report.captureId),' · review ',escapeHTML(report.reviewId),'</p></footer>',
    '<script id="report-data" type="application/json">',payload,'</script><script>',script,'</script></body></html>\n'].join('');
}

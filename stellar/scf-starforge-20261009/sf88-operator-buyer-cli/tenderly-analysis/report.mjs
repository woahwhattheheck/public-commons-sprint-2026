// MIT. Self-contained review of retained simulation data, suitable for a private handoff.
export const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const show = value => value === null || value === undefined ? 'Unavailable' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const cell = value => '<td>' + escapeHtml(show(value)) + '</td>';
function table(columns,rows) {
  return '<div class="table"><table><thead><tr>' + columns.map(k=>'<th>'+escapeHtml(k)+'</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row=>'<tr>'+columns.map(k=>cell(row[k])).join('')+'</tr>').join('')+'</tbody></table></div>';
}
export function renderReview(review) {
  const a = review.analysis, record = review.before, comparison = review.comparison;
  const counts = Object.entries(a.counts).map(([name,value])=>({name,value:Object.hasOwn(a.availability,name)&&!a.availability[name]?'Unavailable':value}));
  const section = (title,body) => '<section><h2>'+escapeHtml(title)+'</h2>'+body+'</section>';
  let body = section('Simulation',table(['field','value'],[
    {field:'Provider simulation',value:a.simulationId},{field:'Transaction outcome',value:a.outcome.status},
    {field:'Gas used',value:a.outcome.gasUsed},...Object.entries(a.context).map(([field,value])=>({field,value}))]));
  body += section('Retained source',table(['field','value'],[{field:'Capture',value:record.id},
    {field:'Response SHA-256',value:record.binding.responseSha256},{field:'Source',value:record.sourceKind},
    {field:'Original buyer',value:record.buyer},{field:'Received',value:record.createdAt}]));
  if (review.notes) body += section('Review notes','<p class="notes">'+escapeHtml(review.notes)+'</p>');
  if (a.findings.length) body += section('Context observations','<pre>'+escapeHtml(JSON.stringify(a.findings,null,2))+'</pre>');
  body += section('Available records',table(['name','value'],counts));
  if (comparison) {
    body += section('Comparison context',table(['field','before','after','equal'],comparison.context));
    body += section('Execution comparison',table(['field','before','after'],[
      {field:'Simulation',before:comparison.beforeSimulation,after:comparison.afterSimulation},
      {field:'Outcome',before:comparison.outcome.before.status,after:comparison.outcome.after.status},
      {field:'Gas used',before:comparison.outcome.before.gasUsed,after:comparison.outcome.after.gasUsed},
      {field:'Gas difference (after − before)',before:null,after:comparison.outcome.gasUsedDelta}]));
    body += '<p>Read the execution differences together with the network, block, transaction index and input above.</p>';
    for (const [name,rows] of Object.entries(comparison.changes))
      body += section(name+' differences',comparison.comparable[name]?
        table(['change','before','after'],rows):'<p>A selected response omits this record collection; its differences are unavailable.</p>');
  } else {
    for (const [name,rows] of Object.entries(a.tables)) {
      const selected = {calls:['path','type','from','to','gasUsed','error'],state:['kind','address','slot','before','after'],
        assets:['kind','type','asset','symbol','amount','amountField'],logs:['index','address','event','topic0']}[name];
      body += section(name+(a.availability[name]?' ('+rows.length+')':''),a.availability[name]?
        table(selected,rows):'<p>The retained provider response omits this record collection.</p>');
    }
  }
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escapeHtml(review.title || 'Tenderly simulation review')+'</title><style>'+CSS+'</style></head><body><main><header><p class="eyebrow">STELLAR FORGE / SIMULATION ANALYSIS</p><h1>'+
    escapeHtml(review.title || record.label || 'Simulation review')+'</h1><p>Saved Tenderly execution results and original customer delivery.</p></header>'+body+
    '<footer>Full original response and machine-readable analysis remain in the accompanying export.</footer></main></body></html>';
}
const CSS = 'html{color-scheme:light}body{margin:0;background:#f3f3f1;color:#20211f;font:14px/1.5 system-ui,sans-serif}main{max-width:1220px;margin:auto;padding:36px}header{border-bottom:2px solid #32352f;padding-bottom:24px}h1{font-size:30px;margin:8px 0}h2{font-size:18px;margin:0 0 14px}.eyebrow{font:12px monospace;letter-spacing:.08em}section{background:#fff;border:1px solid #d0d1cc;padding:24px;margin:20px 0}.table{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:10px;overflow-wrap:anywhere}th{font-size:12px;color:#545750;background:#f6f6f4}td{max-width:500px}pre,.notes{white-space:pre-wrap;overflow-wrap:anywhere}footer{padding:24px 0;color:#62665c}@media print{body{background:white}main{padding:0}section{break-inside:avoid}.table{overflow:visible}table{font-size:9px}}';

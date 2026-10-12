// MIT. An offline index for the original Safe selection and native analysis export.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>esc(JSON.stringify(value,null,2));
const row=(name,value)=>'<tr><th scope="row">'+esc(name)+'</th><td>'+esc(value)+'</td></tr>';
export function renderHandover({selection,intentId,simulation,native,captureId,response}) {
  const r=selection,context=r.simulation;
  const title=r.label||'Safe transaction review';
  const rows=[
    ['Safe',r.safe.address],['Network',r.safe.networkId],['Safe contract version',r.safe.contractVersion],
    ['Safe transaction hash',r.transactionHash],['Safe nonce',r.nonce],
    ['Palmera operation',r.origin.operation||'Selected caller operation'],
    ['Block',context.blockNumber],['Transaction position',context.transactionIndex],
    ['Simulation caller',context.from],['Outer execution gas',context.gas],
    ['Outer execution value',context.value],['Selection',r.id],['Original buyer intent',intentId],
    ['Response bytes',response.bytes],['Response SHA-256',response.sha256],['Analysis capture',captureId]
  ];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+esc(title)+' — Safe review</title><style>'+
    ':root{color-scheme:light;--ink:#202124;--muted:#555;--line:#c8c8c8;--paper:#fff;--panel:#f3f3f3}'+
    '*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,sans-serif}'+
    'header,main,footer{max-width:1120px;margin:auto;padding:24px}header{border-bottom:1px solid var(--line)}'+
    'h1{font-size:28px;line-height:1.2;margin:10px 0}h2{font-size:19px;margin:0 0 12px}p{margin:10px 0 16px}'+
    '.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}'+
    'nav{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 0}a{color:#222;text-underline-offset:3px}'+
    'nav a{padding:9px 13px;border:1px solid #777;border-radius:3px;text-decoration:none;background:#fff}'+
    'nav a:first-child{background:#222;color:#fff}a:focus-visible,summary:focus-visible{outline:3px solid #777;outline-offset:3px}'+
    '.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px}'+
    'section{min-width:0;border:1px solid var(--line);padding:18px;margin-bottom:22px;border-radius:3px}'+
    'table{width:100%;border-collapse:collapse}th,td{padding:9px 7px;vertical-align:top;border-bottom:1px solid #ddd;text-align:left}'+
    'th{width:31%;font-weight:600}td{overflow-wrap:anywhere}tr:last-child th,tr:last-child td{border:0}'+
    'pre{padding:14px;background:var(--panel);border:1px solid #d2d2d2;white-space:pre-wrap;overflow-wrap:anywhere;max-height:520px;overflow:auto;font:12px/1.6 ui-monospace,monospace}'+
    'ul,ol{padding-left:22px}li{margin:8px 0}.meta,footer{color:var(--muted);font-size:13px}summary{cursor:pointer;font-weight:600;padding:8px 0}'+
    '@media(max-width:780px){.grid{grid-template-columns:1fr}header,main,footer{padding:16px}th{width:36%}h1{font-size:24px}}'+
    '@media print{header,main,footer{max-width:none;padding:12px}nav{display:none}.grid{display:block}section{break-inside:avoid}pre{max-height:none}}'+
    '</style></head><body><header><div class="eyebrow">Palmera / Safe · Original transaction review</div>'+
    '<h1>'+esc(title)+'</h1><p>The selected Safe transaction, its exact simulation context and its completed native buyer response are retained in this handover.</p>'+
    '<nav aria-label="Review files"><a href="analysis/review.html">Open simulation analysis</a>'+
    '<a href="selection/safe-transaction.json">Original Safe selection</a>'+
    '<a href="tenderly/response.json">Full provider response</a>'+
    '<a href="manifest.json">Handover manifest</a></nav></header><main>'+
    '<div class="grid"><section><h2>Selected transaction</h2><table><tbody>'+rows.map(([n,v])=>row(n,v)).join('')+
    '</tbody></table></section><div><section><h2>Completed simulation</h2>'+
    '<p>The summary below is the original Tenderly customer result for this request and block position.</p>'+
    '<pre>'+json(simulation)+'</pre><p><a href="analysis/review.html">Review call trace, state changes, assets and logs</a></p></section>'+
    '<section><h2>Inner Safe action</h2><table><tbody>'+
    row('Target',r.innerTransaction.to)+row('Value',r.innerTransaction.value)+
    row('Operation',r.innerTransaction.operation===0?'0 — CALL':'1 — DELEGATECALL')+
    row('Encoded signatures',r.encodedSignaturesBytes+' bytes')+
    row('Original execTransaction call',r.encodedExecutionBytes+' bytes')+
    '</tbody></table><p><a href="selection/safe-transaction.json">Open the complete original transaction data and encoded signatures</a></p>'+
    '<p class="meta">The transaction hash identifies the selected Safe transaction. The original Palmera operation and reference remain in its source record.</p></section></div></div>'+
    '<section><h2>Native purchase and retained context</h2><div class="grid"><div><ul>'+
    '<li><a href="selection/simulation.json">Exact selected public simulation body</a></li>'+
    '<li><a href="tenderly/request.body">Exact original buyer request bytes</a></li>'+
    '<li><a href="tenderly/request.json">Merchant selection and original buyer binding</a></li>'+
    '<li><a href="tenderly/buyer-result.json">Complete original native buyer result</a></li>'+
    '<li><a href="tenderly/manifest.json">Original customer export manifest</a></li>'+
    '<li><a href="analysis/manifest.json">Original analysis export manifest</a></li></ul></div><div>'+
    '<pre>'+json({mode:native.mode??null,status:native.status??null,intentId:native.intentId,
      responseFile:native.responseFile})+'</pre></div></div></section>'+
    '<section><h2>Receive and continue the review</h2><ol>'+
    '<li>Open this directory with the Safe review CLI <code>open</code> command to verify every declared member against its retained bytes.</li>'+
    '<li>Use <code>receive</code> with a private destination and analysis workspace. The original analysis library receives the exact saved response, request and native result.</li>'+
    '<li>Use <code>serve</code> to open the original local analysis workspace. A new transaction selection can be purchased under its own original intent and compared with this retained capture.</li>'+
    '</ol><p class="meta">Safe execution remains in the original Safe / Palmera application. The review preserves the selected signatures, nonce, block and caller so the operator can assess the exact intended action.</p></section>'+
    '</main><footer>Safe simulation handover · '+esc(intentId)+' · '+esc(r.id)+'</footer></body></html>';
}

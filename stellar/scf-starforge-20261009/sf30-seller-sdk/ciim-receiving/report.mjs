// MIT. A portable operator report for the actual mapped receiving edition.
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const label=value=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,char=>char.toUpperCase());
function attributes(value) {
  if(!value||!Object.keys(value).length)return '';
  return '<dl class="attributes">'+Object.entries(value).map(([key,item])=>'<dt>'+escape(key)+'</dt><dd>'+escape(item)+'</dd>').join('')+'</dl>';
}
function element(value) {
  if(value===null||value===undefined)return '<span class="muted">Absent</span>';
  if(typeof value!=='object')return '<span class="text">'+escape(value)+'</span>';
  if(Array.isArray(value))return value.length?'<ol>'+value.map(item=>'<li>'+element(item)+'</li>').join('')+'</ol>':'<span class="muted">No source values</span>';
  const parts=[];
  if(Object.prototype.hasOwnProperty.call(value,'content'))parts.push('<div class="text">'+(value.content===''?'<span class="muted">Empty source text</span>':escape(value.content))+'</div>');
  if(value.attributes)parts.push(attributes(value.attributes));
  if(value.mixed)parts.push('<details><summary>Ordered mixed content</summary><pre>'+escape(JSON.stringify(value.mixed,null,2))+'</pre></details>');
  for(const [key,item]of Object.entries(value)){
    if(['original','content','attributes','mixed'].includes(key))continue;
    if(Array.isArray(item)&&item.length===0)continue;
    parts.push('<div class="subfield"><strong>'+escape(label(key))+'</strong>'+element(item)+'</div>');
  }
  if(!parts.length)parts.push('<span class="muted">Present empty element</span>');
  return parts.join('');
}
function plainTitle(record) {
  const values=record.resources?.flatMap(resource=>resource.titles??[])??[];
  return values.map(value=>value.content).filter(value=>typeof value==='string'&&value.trim()).join(' · ')||record.identifier;
}
export function renderReport({manifest,records}) {
  const counts=manifest.counts,source=manifest.source;
  const issueByRecord=new Map();
  for(const issue of manifest.issues??[]){
    if(!issueByRecord.has(issue.observationId))issueByRecord.set(issue.observationId,[]);
    issueByRecord.get(issue.observationId).push(issue);
  }
  const rows=records.map((record,index)=>{
    const issues=issueByRecord.get(record.observation.id)??[];
    const resourceTables=(record.resources??[]).map((resource,resourceIndex)=>{
      const fields=Object.entries(resource).filter(([key])=>!['original','content','attributes','mixed'].includes(key));
      return '<h4>Metadata resource '+(resourceIndex+1)+'</h4><table><thead><tr><th>Property</th><th>Original values</th></tr></thead><tbody>'+
        fields.map(([key,value])=>'<tr><th>'+escape(label(key))+'</th><td>'+element(value)+'</td></tr>').join('')+'</tbody></table>';
    }).join('');
    return '<details class="record" data-search="'+escape((record.identifier+' '+plainTitle(record)).toLowerCase())+'">'+
      '<summary><span class="ordinal">'+(index+1)+'</span><span>'+escape(plainTitle(record))+'<small>'+escape(record.identifier)+' · '+escape(record.status)+'</small></span></summary>'+
      '<dl class="identity"><dt>Repository</dt><dd>'+escape(record.observation.repositoryId)+'</dd>'+
      '<dt>Datestamp</dt><dd>'+escape(record.datestamp)+'</dd>'+
      '<dt>Current observation</dt><dd>'+escape(record.observation.id)+'</dd>'+
      '<dt>Original page SHA-256</dt><dd>'+escape(record.observation.sourceId)+'</dd>'+
      '<dt>Request / record ordinal</dt><dd>'+escape(record.observation.requestId)+' / '+escape(record.observation.ordinal)+'</dd></dl>'+
      (issues.length?'<section class="advisories"><h4>Source review</h4><ul>'+issues.map(issue=>'<li>'+escape(issue.field??issue.code)+': '+escape(issue.message)+'</li>').join('')+'</ul></section>':'')+
      (record.status==='deleted'?'<p>This original OAI observation is explicitly deleted. Its identifier and datestamp remain in the receiving result.</p>':resourceTables)+
      (record.sourceAbout?.length?'<details><summary>Original source provenance / about records</summary><pre>'+escape(JSON.stringify(record.sourceAbout,null,2))+'</pre></details>':'')+
      '<details><summary>Original converted OAI header</summary><pre>'+escape(JSON.stringify(record.oaiHeader,null,2))+'</pre></details>'+
      '</details>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>CIIM metadata receiving — '+escape(manifest.profileFamily)+'</title><style>'+
  '*{box-sizing:border-box}body{margin:0;color:#1a1a1a;background:#f3f3f3;font:14px/1.5 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:27px;margin:0 0 8px}h2{font-size:19px}h3,h4{font-size:15px}p{max-width:86ch}.muted,small{color:#555}header,section.panel,.record{background:#fff;border:1px solid #c9c9c9;padding:20px;margin:0 0 16px}header{border-top:4px solid #333}a{color:inherit;text-decoration:underline}nav{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}nav a,button{display:inline-block;padding:7px 10px;border:1px solid #777;background:#fff}input{font:inherit;display:block;width:100%;padding:9px;border:1px solid #777;margin:8px 0 0}button{font:inherit;cursor:pointer}.stats{display:flex;flex-wrap:wrap;gap:28px}.stats strong{display:block;font-size:25px;font-variant-numeric:tabular-nums}.identity,.attributes{display:grid;grid-template-columns:minmax(110px,180px) minmax(0,1fr);gap:5px 12px}.identity dt,.attributes dt{font-weight:600}.identity dd,.attributes dd{margin:0;overflow-wrap:anywhere}.identity{font-size:12px}.attributes{font-size:12px;color:#444;margin:7px 0}.record summary{cursor:pointer;display:flex;align-items:flex-start;gap:12px;font-weight:600}.record summary small{display:block;font-weight:400;overflow-wrap:anywhere}.record>summary>span:last-child{min-width:0;overflow-wrap:anywhere}.record[open]>summary{padding-bottom:14px;border-bottom:1px solid #ddd}.ordinal{display:inline-block;min-width:30px;font-variant-numeric:tabular-nums}.record>details{margin:14px 0}.record>details summary{display:list-item}.record table{width:100%;border-collapse:collapse;table-layout:fixed;margin:14px 0}th,td{border:1px solid #d3d3d3;text-align:left;vertical-align:top;padding:9px;overflow-wrap:anywhere}th:first-child{width:175px}thead{background:#eee}.text{white-space:pre-wrap;overflow-wrap:anywhere}ol{padding-left:22px;margin:0}li+li{margin-top:10px}.subfield{margin:6px 0 12px}.subfield>strong{display:block;font-size:12px;margin-bottom:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,monospace;background:#f7f7f7;border:1px solid #ddd;padding:12px;max-height:420px;overflow:auto}.advisories{border-left:3px solid #666;padding-left:12px}code{overflow-wrap:anywhere}.controls{display:flex;gap:8px;margin:12px 0}.hidden{display:none}@media(max-width:600px){main{padding:12px}header,section.panel,.record{padding:13px}.identity,.attributes{grid-template-columns:1fr;gap:2px}.identity dd,.attributes dd{margin-bottom:6px}.record table,.record tbody,.record tr,.record td,.record th{display:block;width:100%}.record thead{display:none}.record th:first-child{width:100%;background:#eee}}@media print{body{background:#fff}main{max-width:none;padding:0}.controls,.search,nav{display:none}.record{break-inside:avoid}details:not([open])>*:not(summary){display:block}pre{max-height:none}.record summary{display:block}}'+
  '</style></head><body><main><header><h1>CIIM metadata receiving</h1><p>'+escape(manifest.profileFamily)+' · original reviewed source edition</p>'+
  '<div class="stats"><div><strong>'+counts.records+'</strong>current records</div><div><strong>'+counts.active+'</strong>active</div><div><strong>'+counts.deleted+'</strong>explicit deletions</div><div><strong>'+(manifest.issues?.length??0)+'</strong>source review observations</div></div>'+
  '<p>The complete mapped export retains repeated metadata, native converted records, source provenance, and the original OAI identity. Withdrawal follows explicit source headers. Processing-profile and institutional authority choices are recorded separately in the receiving configuration.</p>'+
  '<nav><a href="records.jsonl.gz" download>Complete mapped JSONL (gzip)</a><a href="manifest.json">Delivery manifest</a><a href="config.json">Native converter configuration</a></nav></header>'+
  '<section class="panel"><h2>Original source and native runtime</h2><dl class="identity"><dt>Repository URL</dt><dd>'+escape(source.repository.baseURL)+'</dd>'+
  '<dt>Metadata selection</dt><dd>'+escape(JSON.stringify(source.selection))+'</dd><dt>Reviewed edition</dt><dd>'+escape(source.edition.id)+'</dd>'+
  '<dt>Original review</dt><dd>'+escape(source.edition.review.reviewer)+' · '+escape(source.edition.review.recordedAt)+'</dd>'+
  '<dt>Source manifest SHA-256</dt><dd>'+escape(manifest.binding.captureSha256)+'</dd><dt>Full result SHA-256</dt><dd>'+escape(manifest.records.sha256)+'</dd>'+
  '<dt>Native engine</dt><dd>'+escape(manifest.runtime.map(runtime=>runtime.engine?.version??runtime.reference??runtime.kind).join(', '))+'</dd></dl>'+
  '<details><summary>Receiving configuration and exact engine artifacts</summary><pre>'+escape(JSON.stringify({receiving:manifest.receiving,runtime:manifest.runtime},null,2))+'</pre></details></section>'+
  '<section class="panel"><h2>Review the complete edition</h2><label class="search">Find an original identifier or title<input id="find" type="search" autocomplete="off"></label>'+
  '<div class="controls"><button id="expand" type="button">Expand visible records</button><button id="collapse" type="button">Collapse records</button><button id="print" type="button">Print review</button></div><p id="count">'+records.length+' records</p></section>'+
  rows+'</main><script>'+
  '"use strict";const records=Array.from(document.querySelectorAll(".record"));const field=document.querySelector("#find");function filter(){const q=field.value.toLowerCase();let n=0;for(const row of records){row.hidden=!row.dataset.search.includes(q);if(!row.hidden)n++;}document.querySelector("#count").textContent=n+" of "+records.length+" records";}field.addEventListener("input",filter);document.querySelector("#expand").addEventListener("click",()=>records.filter(row=>!row.hidden).forEach(row=>row.open=true));document.querySelector("#collapse").addEventListener("click",()=>records.forEach(row=>row.open=false));let printState=null;function preparePrint(){if(printState)return;printState=Array.from(document.querySelectorAll("details")).map(node=>({node,open:node.open}));for(const item of printState)if(!item.node.closest(".record[hidden]"))item.node.open=true;}function restorePrint(){if(!printState)return;for(const item of printState)item.node.open=item.open;printState=null;}window.addEventListener("beforeprint",preparePrint);window.addEventListener("afterprint",restorePrint);document.querySelector("#print").addEventListener("click",()=>{preparePrint();window.print();});'+
  '</script></body></html>\n';
}

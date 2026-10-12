// MIT. Full printable commissioning handover from the original retained project.
const h=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const json=value=>JSON.stringify(value,null,2);
const cell=value=>'<td>'+h(typeof value==='string'?value:json(value))+'</td>';
function table(head,rows){return '<div class="table"><table><thead><tr>'+head.map(x=>'<th>'+h(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell).join('')+'</tr>').join('')+'</tbody></table></div>';}
function renderCommissioningReport(report){
  if(report?.schema!=='stellar-forge.timescale-commissioning-report.v1'||report.complete!==true)throw new TypeError('Use the complete original commissioning report.');
  const item=report.project.item;
  const nativeComparisons=report.comparisons.map(({descriptor,result})=>'<section><h3>'+h(descriptor.title)+'</h3><p>'+
    h(result.matches?'All mapped native rows agree.':'The selected native sources differ.')+'</p>'+
    table(['Expected rows','Observed rows','Matching rows','Expected only','Observed only'],[Object.values(result.counts)])+
    '<p>'+h(result.interpretation)+'</p>'+table(['Field','Expected column','Observed column','Grouping key'],
      result.mapping.columns.map(row=>[row.name,row.expected,row.observed,row.key?'Yes':'No']))+
    table(['Side','Omitted column','Reason'],[
      ...result.mapping.ignoredExpected.map(row=>['Expected',row.column,row.reason]),
      ...result.mapping.ignoredObserved.map(row=>['Observed',row.column,row.reason])])+
    '<h4>Complete expected-only rows</h4>'+table(['Multiplicity',...result.mapping.columns.map(row=>row.name)],
      result.expectedOnly.map(row=>[row.count,...row.values.map(v=>JSON.stringify(v))]))+
    '<h4>Complete observed-only rows</h4>'+table(['Multiplicity',...result.mapping.columns.map(row=>row.name)],
      result.observedOnly.map(row=>[row.count,...row.values.map(v=>JSON.stringify(v))]))+'</section>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+h(item.title)+' — Commissioning handover</title><style>'+
    'body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;max-width:1280px;margin:auto;padding:32px}'+
    'h1{font-size:30px;line-height:1.2}h2{margin-top:36px;font-size:22px;border-bottom:1px solid #999;padding-bottom:8px}h3{margin-top:24px}'+
    'p,td,pre{overflow-wrap:anywhere}.table{overflow:auto}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}'+
    'th,td{text-align:left;vertical-align:top;border:1px solid #bbb;padding:8px}th{background:#eee}pre{white-space:pre-wrap;font:12px/1.45 ui-monospace,monospace}'+
    'dl{display:grid;grid-template-columns:180px minmax(0,1fr);gap:8px}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}'+
    '@media(max-width:600px){body{padding:16px}dl{grid-template-columns:1fr}dd{margin-bottom:8px}}'+
    '@media print{body{padding:0;max-width:none}.table{overflow:visible}tr{break-inside:avoid}h2,h3{break-after:avoid}a{color:inherit}}'+
    '</style></head><body><h1>'+h(item.title)+'</h1><p>Technical commissioning · Revision '+item.revision+' · '+h(item.status)+'</p>'+
    '<dl>'+[['Technical owner',item.owner],['Source contract revision',item.contractRevision],['Workspace',report.workspaceId],
      ['Commissioning project',item.id],['Generated',report.generatedAt]].map(([key,value])=>'<dt>'+h(key)+'</dt><dd>'+h(value)+'</dd>').join('')+'</dl>'+
    '<h2>Handover</h2>'+(item.handover?table(['Disposition','Operator','Time','Statement','Follow-up owner','Open criteria','Pending fields'],
      [[item.handover.disposition,item.handover.actor,item.handover.at,item.handover.statement,item.handover.followUpOwner,
        item.handover.openCriteria.join(', '),item.handover.pendingFields.join(', ')]]):'<p>The technical work remains open.</p>')+
    '<p>'+h(report.meaning)+'</p>'+
    '<h2>Source contract</h2>'+table(['Field','Description','Disposition','Native value','Explanation'],Object.entries(item.contract).map(([key,value])=>[
      key,value.description,value.disposition,json(value.value),value.reason]))+
    '<h2>Selected native projection</h2>'+(item.source?'<pre>'+h(json(item.source.projection))+'</pre>':'<p>No native aggregate projection has been selected.</p>')+
    '<h2>Acceptance decisions</h2>'+table(['Criterion','Required outcome','Decision','Observed result and assessment','Owner','Source references'],item.acceptance.map(row=>[
      row.id+' · '+row.title,row.condition,row.decision,row.assessment,row.owner,row.references.map(ref=>ref.kind+' '+ref.id).join('\n')]))+
    '<h2>Complete original source files</h2>'+table(['Title','Role','File','Bytes','Rows','Contract revision','SHA-256'],item.sources.map(row=>[
      row.title,row.role,row.filename,row.bytes,row.rows,row.contractRevision,row.sha256]))+
    '<p>The JSON report includes the complete original intake and source-file text. Native string values and explicit null remain distinct; no rows are sampled.</p>'+
    '<h2>Native baseline comparisons</h2>'+(nativeComparisons||'<p>No comparison has been recorded.</p>')+
    '<h2>Original native operating outcomes</h2>'+report.observations.map(({descriptor,result})=>'<section><h3>'+h(descriptor.kind)+' · '+h(descriptor.state)+
      '</h3><p>'+h(descriptor.relevance)+'</p><p>Observed by '+h(descriptor.actor)+' at '+h(descriptor.at)+
      ' for source contract '+descriptor.contractRevision+'.</p><pre>'+h(json(result.operation))+'</pre></section>').join('')+
    '<h2>Complete change history</h2>'+table(['Revision','Time','Operator','Action','Reason','Original request'],report.project.history.map(row=>[
      row.revision,row.at,row.actor,row.action,row.note,row.requestId]))+
    '<h2>Continue this project</h2><p>Receive the original complete Timescale project, open Commissioning, and select this project. Reopen a handed-over project before changing it. The original intake, every source file, comparison, native observation and earlier decision remain in its history.</p>'+
    '</body></html>';
}
export { renderCommissioningReport };

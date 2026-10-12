// MIT. Complete portable workflow report presentation, shared by the browser and host.
const json=value=>JSON.stringify(value,null,2);
const escape=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export const reportDuration=value=>value===null||value===undefined?'—':
  Math.abs(value)<1000?value+' ms':Math.abs(value)<60000?(value/1000).toFixed(3)+' s':(value/60000).toFixed(3)+' min';
export const reportValue=value=>value?.present?json(value.value):'〈missing〉';
export const reportFilename=packet=>(packet.report.current.name+'-'+packet.selection.runId+
  (packet.selection.baselineRunId?'-vs-'+packet.selection.baselineRunId:'')+'-r'+packet.report.current.revision)
  .replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,210);
export function reportChangeRows(report) {
  const rows=[];
  for(const field of ['inputs','context'])for(const difference of report[field])rows.push({stepId:'',field,...difference});
  for(const step of report.steps)for(const [field,differences] of Object.entries(step.differences))
    for(const difference of differences)rows.push({stepId:step.id,field,...difference});
  return rows;
}
// Quoted CSV still needs formula protection when opened by spreadsheet software.
const cell=value=>{
  let text=value===null||value===undefined?'':typeof value==='string'?value:String(value);
  if(/^[\s\uFEFF]*[=+@-]/u.test(text)||/^[\t\r\n]/u.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
};
const csv=rows=>'\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
export function workflowReportStepsCsv(packet) {
  const report=packet.report;
  const headers=['profile_id','workflow_id','current_run_id','current_revision','baseline_run_id','baseline_revision',
    'step_id','comparison','changed_fields','baseline_position','current_position','baseline_name','current_name',
    'baseline_state','current_state','baseline_outcome','current_outcome','baseline_tool','current_tool',
    'baseline_contract_sha256','current_contract_sha256','baseline_original_call_id','current_original_call_id',
    'baseline_effective_call_id','current_effective_call_id','baseline_recovery_call_id','current_recovery_call_id',
    'baseline_call_duration_ms','current_call_duration_ms','call_duration_delta_ms',
    'baseline_result_sha256','current_result_sha256','baseline_resolution_note','current_resolution_note'];
  const rows=report.steps.map(step=>{
    const a=step.baseline,b=step.current;
    return [report.profile.id,report.current.workflowId,report.current.id,report.current.revision,
      report.baseline?.id,report.baseline?.revision,step.id,step.change,step.flags.join(';'),
      a?.position,b?.position,a?.name,b?.name,a?.state,b?.state,a?.outcome,b?.outcome,a?.tool,b?.tool,
      a?.toolSchemaSha256,b?.toolSchemaSha256,a?.callId,b?.callId,a?.effectiveCallId,b?.effectiveCallId,
      a?.resolvedCallId,b?.resolvedCallId,a?.effectiveCallDurationMs,b?.effectiveCallDurationMs,
      step.effectiveCallDurationDeltaMs,a?.resultSha256,b?.resultSha256,a?.resolutionNote,b?.resolutionNote];
  });
  return csv([headers,...rows]);
}
export function workflowReportChangesCsv(packet) {
  return csv([['profile_id','current_run_id','baseline_run_id','step_id','field','json_pointer','change',
    'baseline_present','baseline_json','current_present','current_json'],
    ...reportChangeRows(packet.report).map(row=>[
      packet.report.profile.id,packet.selection.runId,packet.selection.baselineRunId,row.stepId,row.field,row.pointer,row.kind,
      row.before.present,row.before.present?JSON.stringify(row.before.value):'',
      row.after.present,row.after.present?JSON.stringify(row.after.value):''
    ])]);
}
const pre=value=>'<pre>'+escape(typeof value==='string'?value:json(value))+'</pre>';
const table=(headers,rows)=>'<div class="table"><table><thead><tr>'+headers.map(value=>'<th>'+escape(value)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function changesHtml(rows) {
  if(!rows.length)return '<p>No changed values.</p>';
  return table(['Field / JSON pointer','Change','Baseline','Current'],rows.map(row=>[
    escape((row.field?row.field+' ':'')+(row.pointer||'(root)')),escape(row.kind),
    pre(reportValue(row.before)),pre(reportValue(row.after))
  ]));
}
const details=(label,body)=>'<details><summary>'+escape(label)+'</summary>'+body+'</details>';
export function workflowReportHtml(packet) {
  const report=packet.report,current=report.current,baseline=report.baseline;
  const summaryFields=[
    ['Run','id'],['Run revision','revision'],['Workflow revision','workflowRevision'],['State','state'],
    ['Created','createdAt'],['Recorded through','recordedThrough'],['Completed','completedAt'],
    ['Completed steps','completedSteps'],['Total steps','stepCount'],['Recovered steps','recoveredSteps'],
    ['Native calls','nativeCalls'],['Completed native calls','completedNativeCalls'],['Pending native calls','pendingNativeCalls'],
    ['Failed or native-error calls','failedNativeCalls'],['Source workspace','workspaceId'],['Current owner','ownerWorkspaceId'],
    ['Original host SHA-256','hostFingerprint'],['Execution host SHA-256','executionHostFingerprint']
  ];
  const summary=summaryFields.map(([label,key])=>[escape(label),escape(baseline?.[key]??'—'),escape(current[key]??'—')]);
  summary.push(['Recorded run interval',escape(reportDuration(baseline?.recordedDurationMs)),escape(reportDuration(current.recordedDurationMs))],
    ['Sum of completed call durations',escape(reportDuration(baseline?.recordedNativeDurationMs)),escape(reportDuration(current.recordedNativeDurationMs))]);
  const steps=report.steps.map(step=>[
    escape(step.id),escape(step.change),escape(step.baseline?.name??'—'),escape(step.current?.name??'—'),
    escape(step.baseline?.state??'—'),escape(step.current?.state??'—'),
    escape(step.baseline?.outcome??'—'),escape(step.current?.outcome??'—'),
    escape(reportDuration(step.baseline?.effectiveCallDurationMs)),escape(reportDuration(step.current?.effectiveCallDurationMs)),
    escape(reportDuration(step.effectiveCallDurationDeltaMs)),escape(step.flags.join(', '))
  ]);
  const stepDetails=report.steps.map(step=>{
    const rows=Object.entries(step.differences).flatMap(([field,items])=>items.map(item=>({field,...item})));
    return '<section><h3>'+escape((step.current??step.baseline).name)+' · '+escape(step.id)+'</h3>'+
      changesHtml(rows)+details('Step outcomes, conditions and recovery attempts',pre({baseline:step.baseline,current:step.current}))+'</section>';
  }).join('');
  const rawRuns=packet.archive.workflowData.runs.map(run=>details('Original run '+run.id+' · revision '+run.revision,pre(run))).join('');
  const rawCalls=packet.archive.calls.map(call=>details('Native call '+call.id+' · '+call.state,
    '<h4>Request and result metadata</h4>'+pre(Object.fromEntries(Object.entries(call).filter(([key])=>!['argumentsJson','resultJson'].includes(key))))+
    '<h4>Complete native arguments</h4>'+pre(call.argumentsJson)+
    '<h4>Complete native result</h4>'+pre(call.resultJson===null?'Result pending':call.resultJson))).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+escape(current.name)+' — workflow report</title><style>'+
    'body{font:14px/1.5 system-ui,sans-serif;color:#202327;background:#fff;margin:0 auto;padding:32px;max-width:1440px}'+
    'h1,h2,h3,h4{line-height:1.25}h2{margin-top:32px;border-top:1px solid #bec3c9;padding-top:20px}'+
    'p,td,summary,pre{overflow-wrap:anywhere}.meta{color:#525963}.table{overflow:auto}table{border-collapse:collapse;width:100%;margin:16px 0}'+
    'th,td{border:1px solid #cdd1d6;text-align:left;vertical-align:top;padding:8px}th{background:#f2f3f5}'+
    'pre{white-space:pre-wrap;word-break:break-word;margin:0;font:12px/1.5 ui-monospace,monospace}'+
    'details{border:1px solid #cdd1d6;padding:12px;margin:12px 0}summary{cursor:pointer;font-weight:600}details[open] summary{margin-bottom:12px}'+
    '@media print{body{padding:0;max-width:none;font-size:10pt}.table{overflow:visible}tr,details{break-inside:avoid}th{background:#eee}summary{cursor:default}}'+
    '</style></head><body><header><p class="meta">Merchant operator · Workflow history</p><h1>'+escape(current.name)+'</h1>'+
    '<p>'+escape(report.profile.name)+' · '+escape(current.id)+(baseline?' compared with '+escape(baseline.id):'')+'</p>'+
    '<p class="meta">Saved report SHA-256: '+escape(packet.contentSha256)+'<br>Original archive SHA-256: '+escape(packet.archive.contentSha256)+'</p></header>'+
    '<h2>Run summary</h2>'+table(['Measure','Baseline','Current'],summary)+
    '<p>Timing uses recorded timestamps. An unfinished run ends its reported interval at its last retained update. Native duration sums completed calls, including linked recovery attempts. Current and baseline may use different inputs, hosts, owners or saved editions; those differences appear below.</p>'+
    (current.error?'<h3>Current workflow issue</h3>'+pre(current.error):'')+
    '<h2>Steps</h2>'+table(['Step','Comparison','Baseline name','Current name','Baseline state','Current state','Baseline outcome','Current outcome','Baseline call','Current call','Delta','Changed fields'],steps)+
    '<h2>Inputs and execution context</h2>'+changesHtml([...report.inputs.map(row=>({field:'inputs',...row})),...report.context.map(row=>({field:'context',...row}))])+
    '<h2>Step comparisons</h2>'+stepDetails+
    '<h2>Original workflow history</h2>'+rawRuns+
    '<h2>Original native calls and results</h2>'+rawCalls+
    '<h2>Saved workflow source</h2>'+details('Complete profile, drafts, workflow editions and recipe installations',pre({
      sourceWorkspaceId:packet.archive.sourceWorkspaceId,profile:packet.archive.profile,hostBindings:packet.archive.bindings??[],drafts:packet.archive.drafts,
      definitions:packet.archive.workflowData.definitions,recipeInstallations:packet.archive.workflowRecipeData?.installations??[]
    }))+'</body></html>\n';
}

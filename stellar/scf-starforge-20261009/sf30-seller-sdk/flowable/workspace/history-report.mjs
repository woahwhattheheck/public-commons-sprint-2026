// MIT. Plain, self-contained recipient report from the exact retained analysis.
import {inspectFlowableHistoryBundle} from './history-analysis.mjs';
const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration=ms=>ms==null?'—':(Number(ms)/3600000).toLocaleString('en-US',{maximumFractionDigits:3})+' h';
function table(headings,rows){return '<div class="table"><table><thead><tr>'+headings.map(x=>'<th scope="col">'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+
 (rows.length?rows.map(row=>'<tr>'+row.map(cell=>'<td>'+escape(cell)+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+headings.length+'">No observations in this selection.</td></tr>')+'</tbody></table></div>';}
function summaryGroups(rows,type){return table([type,'Definition','Observed','Completed','Open','Terminated','Unknown ended','Median completed','p90 completed','Oldest open','Repeated processes'],
 rows.map(g=>[g.key??g.processDefinitionId,g.processDefinitionId,g.observed,g.completed,g.open,g.terminated,g.endedCompletionUnknown,duration(g.completedDuration.medianMillis),
 duration(g.completedDuration.p90Millis),duration(g.openAge.maximumMillis),g.processesWithRepeatedOccurrences]));}
function activityGroups(rows){return table(['Activity','Definition','Observed','Ended (completion unknown)','Open','Median ended','p90 ended','Oldest open','Repeated processes'],
 rows.map(g=>[g.key,g.processDefinitionId,g.observed,g.endedCompletionUnknown,g.open,duration(g.endedDuration.medianMillis),duration(g.endedDuration.p90Millis),duration(g.openAge.maximumMillis),g.processesWithRepeatedOccurrences]));}
function renderInspectedReport(bundle){
 const r=bundle.report;
 return '<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>'+escape(r.title)+'</title>'+
 '<style>body{font:16px/1.55 system-ui,sans-serif;color:#17212b;background:#f5f6f7;margin:0}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:1.8rem;line-height:1.2}h2{margin-top:2rem;font-size:1.25rem}p,li{max-width:90ch}section,.summary{background:white;border:1px solid #cbd2d9;padding:20px;margin:16px 0}dl{display:grid;grid-template-columns:minmax(130px,1fr) 3fr;gap:8px 16px}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}.table{overflow:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d8dee4;padding:10px;overflow-wrap:anywhere}th{background:#eef1f4;white-space:nowrap}code{overflow-wrap:anywhere}small{color:#465362}@media(max-width:640px){main{padding:12px}section,.summary{padding:12px}dl{display:block}dt{margin-top:10px}h1{font-size:1.5rem}}@media print{body{background:white}main{max-width:none;padding:0}.table{overflow:visible}th,td{font-size:8pt;padding:4px}section{break-inside:auto}h2{break-after:avoid}}</style><main>'+
 '<header><p>Flowable · Workflow history analysis</p><p>'+escape(r.source.origin==='authored-reference'?'Authored demonstration data — no customer or engine outcome.':'Original saved native capture')+'</p><h1>'+escape(r.title)+'</h1><p>Start cohort and elapsed-time observations from one selected saved engine capture.</p></header>'+
 '<div class="summary"><dl><dt>Cohort start, inclusive</dt><dd>'+escape(r.selection.from)+'</dd><dt>Cohort end, exclusive</dt><dd>'+escape(r.selection.to)+
 '</dd><dt>As of</dt><dd>'+escape(r.selection.asOf)+'</dd><dt>Process observations</dt><dd>'+r.processes.length+'</dd><dt>Original capture</dt><dd>'+escape(r.source.record.id)+' · revision '+r.source.record.revision+
 '</dd><dt>Inventory SHA-256</dt><dd><code>'+escape(r.source.inventory.sha256)+'</code></dd><dt>Bundle SHA-256</dt><dd><code>'+bundle.sha256+'</code></dd></dl></div>'+
 '<section><h2>Definition editions</h2>'+table(['Native definition','Key','Version','Deployment','Tenant'],r.definitions.map(d=>[d.id,d.key,d.version,d.deploymentId,d.tenantId??'']))+'</section>'+
 '<section><h2>Process duration and open age</h2>'+summaryGroups(r.processGroups,'Process definition')+'<p>Process completion uses the native completed/cancelled state. Missing state uses labeled deletion-reason inference; unknown native states remain unknown-ended. Completion is not a business-success classification. Open, terminated and unknown-ended observations are excluded from completed-duration statistics.</p></section>'+
 '<section><h2>Task observations</h2>'+summaryGroups(r.taskGroups,'Task key')+'<p>Task lifetime is start to end; it includes waiting. Claim delay uses the retained claim timestamp and is not an assignment-history reconstruction. Parallel tasks may overlap.</p></section>'+
 '<section><h2>Activity occurrences</h2>'+activityGroups(r.activityGroups)+'<p>Ended activity duration includes every observed ending. The native REST response does not expose whether that activity completed or was cancelled. Repeated occurrences require operator interpretation: they can represent intentional repetition, parallel work, compensation or rework.</p></section>'+
 '<section><h2>Coverage and method</h2><p>'+escape(r.selection.retentionNote)+'</p><dl><dt>Capture interval</dt><dd>'+escape(r.source.startedAt)+' → '+escape(r.source.completedAt)+'</dd><dt>Atomic snapshot</dt><dd>No — original collections were read in sequence.</dd><dt>Excluded non-cohort children</dt><dd>'+r.coverage.outsideCohortTasks+' tasks; '+r.coverage.outsideCohortActivities+' activities</dd></dl>'+
 '<ul>'+Object.values(r.method).map(v=>'<li>'+escape(v)+'</li>').join('')+'</ul>'+table(['Collection','Native total','Retained','Pages'],Object.entries(r.source.collections).map(([name,c])=>[name,c.total,c.retained,c.pages]))+'</section>'+
 '<section><h2>Source-quality observations</h2>'+table(['Collection','Original ID','Observation'],r.coverage.issues.map(i=>[i.collection,i.id,i.message]))+'</section>'+
 '<section><h2>Selected process rows</h2>'+table(['Original ID','Definition','Start','End','State at as-of','Native state','Classification basis','Elapsed','Open age'],r.processes.map(p=>[p.id,p.processDefinitionId,p.startTime,p.endTime,p.state,p.sourceState,p.classificationBasis,duration(p.durationMillis),duration(p.ageMillis)]))+'</section>'+
 '<footer><p>Reopen the companion history bundle with the original analyzer to reproduce every row. Retain the complete original Flowable workspace export to reopen native response pages, model resources and saved revisions.</p></footer></main></html>\n';
}
function renderInspectedCSV(r,collection='processes'){
 if(!['processes','tasks','activities'].includes(collection))throw Error('Select processes, tasks or activities');
 const columns=collection==='processes'?['id','processDefinitionId','tenantId','startTime','endTime','state','sourceState','classificationBasis','durationMillis','ageMillis','deleteReason']:
 ['id','processInstanceId','processDefinitionId','key','name','activityType','startTime','endTime','state','classificationBasis','durationMillis','ageMillis','deleteReason','claimTime','claimDelayMillis'];
 const cell=v=>{let s=v==null?'':String(v);if(/^(?:\s*[=+\-@]|[\t\r])/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return columns.map(cell).join(',')+'\r\n'+r[collection].map(row=>columns.map(k=>cell(row[k])).join(',')).join('\r\n')+(r[collection].length?'\r\n':'');
}

export function renderFlowableHistoryReport(bundleText){return renderInspectedReport(inspectFlowableHistoryBundle(bundleText));}
export function flowableHistoryCSV(bundleText,collection='processes'){return renderInspectedCSV(inspectFlowableHistoryBundle(bundleText).report,collection);}
export function renderFlowableHistoryOutputs(bundleText){
 const original=inspectFlowableHistoryBundle(bundleText);
 return{report:original.report,bundleText,bundleBytes:original.bytes,bundleSha256:original.sha256,
  html:renderInspectedReport(original),csv:Object.fromEntries(['processes','tasks','activities'].map(kind=>[kind,renderInspectedCSV(original.report,kind)]))};
}

// MIT. Complete scientific tables and a plain operator report for reviewed reporting units.
import { WATER_QUALITY_GROUP_FIELDS } from '../analysis.mjs';
import { openWatersCanonical } from '../openwaters.mjs';
import { verifyStandardizedAnalysis, STANDARDIZED_OBSERVATION_FIELDS, standardizedFail } from './model.mjs';

const text=value=>value===null||value===undefined?'':String(value);
const esc=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value===undefined?null:value);
function cell(value,delimiter) { const s=text(value);return /["\r\n]/.test(s)||s.includes(delimiter)?'"'+s.replace(/"/g,'""')+'"':s; }
function table(fields,rows,delimiter) {
  if(![',','\t'].includes(delimiter))standardizedFail('Choose CSV or TSV.');
  return [fields,...rows.map(row=>fields.map(key=>row[key]))].map(row=>row.map(value=>cell(value,delimiter)).join(delimiter)).join('\r\n')+'\r\n';
}
function metric(value) { return value?.display??'—'; }
function fraction(value) { return value?json({decimal:value.decimal,numerator:value.numerator,denominator:value.denominator,exact:value.exact}):''; }
export function standardizedObservationsTable(input,{delimiter=','}={}) {
  const report=verifyStandardizedAnalysis(input);
  const fields=[...STANDARDIZED_OBSERVATION_FIELDS,'original_classification','reporting_value','reporting_unit','reporting_value_state',
    'reporting_classification','included','exclusion','qualifiers_json','censoring','original_limits_json','reporting_limits_json',
    'conversion_json','review_reasons_json','original_references_json','source_json','source_semantic_sha256','source_parts_json'];
  const rows=report.observations.map(row=>({...row,original_classification:row.analysis.classification,
    reporting_value:row.reporting.value,reporting_unit:row.reporting.unit,reporting_value_state:row.reporting.valueState,
    reporting_classification:row.reporting.analysis.classification,included:row.reporting.analysis.included,
    exclusion:row.reporting.analysis.exclusion,qualifiers_json:json(row.analysis.qualifiers),censoring:row.analysis.censoring,
    original_limits_json:json(row.limits),reporting_limits_json:json(row.reporting.limits),
    conversion_json:json(row.reporting.conversion),review_reasons_json:json(row.reviewReasons),
    original_references_json:json(row.originalReferences),source_json:json(row.source),
    source_semantic_sha256:row.sourceSemanticSha256,source_parts_json:json(row.sourceParts)}));
  return table(fields,rows,delimiter);
}
export function standardizedGroupsTable(input,{delimiter=','}={}) {
  const report=verifyStandardizedAnalysis(input),links=new Map(report.groups.map(row=>[row.reportingGroupId,row]));
  const fields=['representation','group_id',...WATER_QUALITY_GROUP_FIELDS,'first_date','last_date','counts_json',
    'count','min','max','mean','median','min_exact','max_exact','mean_exact','median_exact',
    'detected_summary_json','reported_estimate_summary_json','status_counts_json','qualifier_counts_json','condition_counts_json',
    'time_zone_counts_json','reported_limits_json','original_group_links_json','observation_ids_json'];
  const rows=[];
  for(const [representation,part] of [['original',report.original],['reporting',report.reviewed]])for(const group of part.groups)rows.push({
    representation,group_id:group.id,...group.dimensions,first_date:group.firstDate,last_date:group.lastDate,
    counts_json:json(group.counts),count:group.summary.count,min:metric(group.summary.min),max:metric(group.summary.max),
    mean:metric(group.summary.mean),median:metric(group.summary.median),min_exact:fraction(group.summary.min),
    max_exact:fraction(group.summary.max),mean_exact:fraction(group.summary.mean),median_exact:fraction(group.summary.median),
    detected_summary_json:json(group.detectedSummary),reported_estimate_summary_json:json(group.reportedEstimateSummary),
    status_counts_json:json(group.statusCounts),qualifier_counts_json:json(group.qualifierCounts),condition_counts_json:json(group.conditionCounts),
    time_zone_counts_json:json(group.timeZoneCounts),reported_limits_json:json(group.limits),
    original_group_links_json:json(representation==='reporting'?links.get(group.id)?.sourceGroups:[]),observation_ids_json:json(group.observationIds)});
  return table(fields,rows,delimiter);
}
export function standardizedChangesTable(comparison,{delimiter=','}={}) {
  const fields=['result_key','status','source_changed','choice_changed','choice_binding_changed','representation_changed',
    'changed_source_parts_json','previous_json','current_json','current_versions','previous_versions'];
  return table(fields,(comparison?.rows??[]).map(row=>({
    result_key:row.resultKey,status:row.status,source_changed:row.sourceChanged,choice_changed:row.choiceChanged,
    choice_binding_changed:row.choiceBindingChanged,representation_changed:row.representationChanged,
    changed_source_parts_json:json(row.changedSourceParts??[]),previous_json:json(row.previous),current_json:json(row.current),
    current_versions:row.currentVersions,previous_versions:row.previousVersions
  })),delimiter);
}
function htmlTable(headers,rows) {
  return '<div class="scroll"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function groupRows(part) {return part.groups.map(g=>[g.label,g.dimensions.unit??'',g.summary.count,metric(g.summary.min),
  metric(g.summary.max),metric(g.summary.mean),metric(g.summary.median),g.counts.censored??0,g.counts.qualified??0,g.firstDate,g.lastDate]);}
function comparisonRows(rows) {return (rows??[]).map(g=>[g.label??g.key,g.comparable?'Comparable':g.reason??'',g.currentCount,
  g.baselineCount,metric(g.change),g.changeUnit??'',metric(g.percentChange),g.relativeChangeReason??'']);}
function limits(values) {return (values??[]).map(x=>[x.type,x.value,x.unit].filter(v=>v!==null&&v!==undefined&&v!=='').join(' ')).join('; ');}
export function renderStandardizedReport(record,{title=record?.title,note=record?.note}={}) {
  const analysis=verifyStandardizedAnalysis(record?.analysis??record),inventory=analysis.inventory;
  const comparison=record?.comparison??null,previous=record?.previous??null;
  const rows=analysis.observations.map(row=>[row.date,row.locationId,row.characteristic,row.methodIdentifier,
    row.value,row.unit,row.reporting.value,row.reporting.unit,row.analysis.classification,
    row.reporting.analysis.included?'Included':row.reporting.analysis.exclusion,
    limits(row.limits),limits(row.reporting.limits),
    row.reporting.conversion?.reason??row.reviewReasons.map(x=>x.reason).join('; '),row.id]);
  const synopsis=[['Selected observations',inventory.selectedRows],['Original capture observations',inventory.inputSourceRows],
    ['Reviewed concentration representations',inventory.convertedResults],['Populated result conversions',inventory.convertedPopulatedResults],
    ['Empty result conversions through their limits',inventory.convertedEmptyResults],['Reported limit conversions',inventory.convertedReportedLimits],
    ['All selected original limits',inventory.selectedReportedLimits],['Arithmetic observations',inventory.arithmeticRows],
    ['Censored',inventory.censored],['Qualified',inventory.qualified],['Reported estimates',inventory.estimated],
    ['Original scientific groups',inventory.originalGroups],['Reporting scientific groups',inventory.reportingGroups]];
  const groupsHeader=['Scientific group','Unit','Arithmetic count','Minimum','Maximum','Mean','Median','Censored','Qualified','First sample','Last sample'];
  const periodHeader=['Scientific group','Status','Current count','Earlier count','Absolute change','Change unit','Relative % change','Relative-change note'];
  const sources=analysis.sources.filter(x=>/^https:\/\//.test(x.url??'')).map(x=>'<li><a href="'+esc(x.url)+'">'+esc(x.title)+'</a></li>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(title||'Water-quality reporting-unit review')+'</title><style>'+
    'html{font:15px/1.5 system-ui,sans-serif;color:#202326;background:#fff}body{max-width:1440px;margin:auto;padding:28px}h1{font-size:26px}h2{margin-top:32px;font-size:20px}p{max-width:100ch}.scroll{overflow:auto;border:1px solid #bbb;margin:16px 0}table{border-collapse:collapse;min-width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ddd;max-width:420px;overflow-wrap:anywhere}th{background:#f1f2f3;color:#24272a}code{overflow-wrap:anywhere}details{margin:16px 0}summary{cursor:pointer}a{color:inherit}dt{font-weight:600}dd{margin:0 0 10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ddd;padding:12px}@media print{body{padding:0}.scroll{overflow:visible}table{font-size:9px}a{text-decoration:none}}'+
    '</style></head><body><h1>'+esc(title||'Water-quality reporting-unit review')+'</h1>'+
    (note?'<p>'+esc(note)+'</p>':'')+
    '<p>Original measurements and reviewed reporting representations share the same scientific eligibility rules. The complete original sample, method, fraction, speciation, depth, qualifier, censoring and reported-limit context is retained. The native receiving choices determine which exact mass-per-volume conversions appear below.</p>'+
    htmlTable(['Population','Count'],synopsis)+
    '<h2>Selected scientific options</h2><pre>'+esc(JSON.stringify(analysis.options,null,2))+'</pre>'+
    '<h2>Reporting-unit summaries</h2><p>Groups combine only identical original scientific dimensions with a matching reviewed unit. The selected summary excludes censored values and unapproved qualifications; no reporting limit is substituted for an observation.</p>'+
    htmlTable(groupsHeader,groupRows(analysis.reviewed))+
    '<details><summary>Original-unit summaries</summary>'+htmlTable(groupsHeader,groupRows(analysis.original))+'</details>'+
    (analysis.reviewed.comparison.length?'<h2>Reporting-window comparison</h2>'+htmlTable(periodHeader,comparisonRows(analysis.reviewed.comparison)):'')+
    (comparison?'<h2>Comparison with the selected previous edition</h2><p>Previous review: <code>'+esc(previous?.reviewId??comparison.previousAnalysisSha256)+
      '</code>. Scientific options '+(comparison.optionsEquivalent?'match.':'differ; both selections are retained below.')+'</p>'+
      htmlTable(['Change category','Count'],Object.entries(comparison.counts))+
      '<pre>'+esc(JSON.stringify({current:comparison.currentOptions,previous:comparison.previousOptions},null,2))+'</pre>'+
      htmlTable(periodHeader,comparisonRows(comparison.reportingGroups))+
      '<details><summary>Source and decision changes</summary>'+htmlTable(['Original result','Status','Source changed','Choice changed','Representation changed','Source parts'],
        comparison.rows.map(x=>[x.resultKey,x.status,x.sourceChanged,x.choiceChanged,x.representationChanged,(x.changedSourceParts??[]).join(', ')]))+'</details>':'')+
    '<h2>Every selected original and reporting observation</h2>'+htmlTable(['Sample date','Site','Characteristic','Method','Original value','Original unit',
      'Reporting value','Reporting unit','Classification','Arithmetic selection','Original reported limits','Reporting limits','Review reason','Original result ID'],rows)+
    '<h2>Source and review identities</h2><pre>'+esc(JSON.stringify({reviewId:record?.reviewId??null,reviewSha256:record?.reviewSha256??null,
      analysisSha256:analysis.analysisSha256,...analysis.source},null,2))+'</pre>'+
    '<h2>Interpretation</h2><ul>'+analysis.sourceNotes.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+
    '<h2>Primary references</h2><ul>'+sources+'</ul></body></html>\n';
}

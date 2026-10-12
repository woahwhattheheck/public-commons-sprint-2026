// MIT. Complete collection reports and original-byte source export.
import { canonicalJson } from './domain.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const text = value => value == null ? '' : typeof value === 'object' ? canonicalJson(value) : String(value);
function csvCell(value) {
  let selected = text(value);
  if (/^[\u0000-\u0020]*[=+@\-]/.test(selected) || /^[\t\r\n]/.test(selected)) selected = "'" + selected;
  return '"' + selected.replace(/"/g,'""') + '"';
}
function csv(items) {
  const columns = ['serviceRequestId','serviceCode','serviceName','status','requestedAt','updatedAt',
    'expectedAt','sourceStatusNotes','agency','address','description','latitude','longitude','collectionId','captureId',
    'sourceSha256','observationCount','versionCount','reviewStatus','assignee','dueDate','reviewNote','needsReview'];
  const rows = items.map(item => ({ ...item, sourceStatusNotes:item.source?.status_notes ?? null, reviewStatus:item.review?.status ?? 'new',
    assignee:item.review?.assignee ?? '', dueDate:item.review?.dueDate ?? '',
    reviewNote:item.review?.note ?? '', needsReview:item.review?.needsReview ?? false }));
  return [columns.map(csvCell).join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n')+'\r\n';
}
function grouped(items, field, fallback) {
  const counts = new Map();
  for (const item of items) { const key = item[field] == null || item[field] === '' ? fallback : String(item[field]); counts.set(key,(counts.get(key)||0)+1); }
  return [...counts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
}
const pairs = rows => rows.map(([label,value])=>'<tr><th>'+escape(label)+'</th><td>'+escape(value)+'</td></tr>').join('');
function report({collection, projection, workspace}) {
  const summary = projection.summary, counts=summary.counts, attribution=collection.connection.attribution ?? {};
  const sources = new Map(projection.records.map(record=>[record.capture.id,record.capture]));
  const windows=collection.nodes.map(window=>{
    const capture=window.captureId?sources.get(window.captureId):null;
    return '<tr><td>'+escape(window.id)+(window.parentId?'<br><span class="meta">Parent '+escape(window.parentId)+'</span>':'')+
      '</td><td>'+escape(window.startDate)+'<br>'+escape(window.endDate)+(window.page == null ? '' : '<br>Page '+escape(window.page))+'</td><td>'+escape(window.state)+
      (window.problem?'<br>'+escape(window.problem):'')+'</td><td>'+escape(capture?.rowCount ?? '')+
      (capture?'<br><span class="meta">Limit '+escape(capture.responseLimit)+'</span>':'')+'</td><td>'+
      escape(capture?.capturedAt ?? '')+'<br><span class="mono">'+escape(capture?.sourceSha256 ?? '')+'</span></td></tr>';
  }).join('');
  const sourceRows=projection.records.map(({capture})=>'<tr><td>'+escape(capture.id)+'</td><td>'+
    escape(capture.receipt.url)+'</td><td>'+escape(capture.receipt.status ?? 'Unrecorded')+'</td><td>'+
    escape(capture.sourceBytes)+'</td><td class="mono">'+escape(capture.sourceSha256)+'</td></tr>').join('');
  const itemRows=projection.items.map(item=>'<tr><td>'+escape(item.serviceRequestId)+'<br><span class="meta">'+
    escape(item.requestedAt)+'</span></td><td>'+escape(item.status)+'<br><span class="meta">'+
    escape(item.updatedAt)+'</span>'+(item.source?.status_notes ? '<p>Source disposition: '+escape(item.source.status_notes)+'</p>' : '')+'</td><td><strong>'+escape(item.serviceName || item.serviceCode || 'Unclassified')+
    '</strong><br>'+escape(item.agency)+'<br>'+escape(item.address)+'<p>'+escape(item.description)+'</p></td><td>'+
    escape(item.review?.status ?? 'new')+'<br>'+escape(item.review?.assignee)+'<br>'+escape(item.review?.dueDate)+
    '<p>'+escape(item.review?.note)+'</p>'+(item.review?.needsReview?'<strong>Source changed since this review</strong>':'')+
    '</td><td>'+escape(item.observationCount)+' observations<br>'+escape(item.versionCount)+' original versions<br>'+
    escape(item.captureId)+'<br><span class="mono">'+escape(item.sourceSha256)+'</span></td></tr>').join('');
  const changes=[...projection.observations.entries()].filter(([,entry])=>entry.versions.size>1).map(([key,entry])=>{
    const versions=[...entry.versions.values()];
    return '<section class="case"><h3>Request '+escape(entry.row.serviceRequestId)+'</h3>'+
      versions.map(version=>'<h4 class="mono">'+escape(version.sourceSha256)+'</h4><p>'+
        version.occurrences.map(item=>escape(item.captureId)+' · '+escape(item.capturedAt)+' · '+escape(item.windowId)).join('<br>')+
        '</p><pre>'+escape(JSON.stringify(version.item.source,null,2))+'</pre>').join('')+'</section>';
  }).join('');
  const faults=collection.nodes.flatMap(window=>window.attempts.filter(attempt=>attempt.error).map(attempt=>
    '<tr><td>'+escape(window.id)+'</td><td>'+escape(attempt.requestId)+'</td><td>'+escape(attempt.error.code)+
    '<p>'+escape(attempt.error.message)+'</p></td><td>'+escape(attempt.error.receipt?.url ?? '')+
    '<br>'+escape(attempt.error.receipt?.status ?? '')+'</td></tr>')).join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escape(collection.name)+' — Open311 collection</title><style>'+
    'body{font:14px/1.5 system-ui,sans-serif;color:#181818;background:#fff;margin:32px;max-width:1500px}h1,h2,h3,h4{line-height:1.25}'+
    'h2{margin-top:32px;border-bottom:1px solid #bbb;padding-bottom:8px}table{border-collapse:collapse;width:100%;margin:16px 0}'+
    'td,th{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}th{background:#eee}p{max-width:100ch}'+
    '.meta{color:#555}.mono,pre{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.mono{word-break:break-all}'+
    'pre{white-space:pre-wrap;border:1px solid #ccc;padding:12px}.case{border-top:1px solid #aaa;padding-top:12px}'+
    '@media print{body{margin:12mm;max-width:none}thead{display:table-header-group}tr{break-inside:avoid}h2,h3,h4{break-after:avoid}pre{font-size:9px}}'+
    '</style><h1>'+escape(collection.name)+'</h1><p>'+escape(collection.connection.name)+' · '+escape(collection.state)+
    '</p><p class="meta">Workspace '+escape(workspace.workspaceId)+' · Revision '+escape(workspace.revision)+' · Collection '+escape(collection.id)+
    '</p><h2>Collected population and interpretation</h2><p>The selected provider query follows its saved time basis and declared provider filters. '+
    'Each retained response is an observation at its recorded time. The worklist uses the latest observed original version of each request within this collection; '+
    'a timestamp tie is resolved by capture identity. Repeated and changed versions remain in the original source inventory and version sections. '+
    'Internal review refers to its selected source version.</p><table>'+pairs([
      ['Date basis',collection.policy.timeBasis ?? 'created'],['Traversal',collection.policy.strategy ?? 'windows'],
      ['Selected start',collection.policy.timeBasis === 'updated' ? collection.query.updated_after : collection.query.start_date],
      ['Selected end',collection.policy.timeBasis === 'updated' ? collection.query.updated_before : collection.query.end_date],
      ['First source observation',summary.firstObservedAt],['Last source observation',summary.lastObservedAt],
      ['Collection state',summary.state],['All terminal windows below their declared cap',summary.capResolved ? 'Yes':'No'],
      ['Unique service requests',counts.uniqueRequests],['Original returned row occurrences',counts.returnedRows],
      ['Additional occurrences of an existing request',counts.duplicateObservations],['Requests with multiple original versions',counts.changedRequests],
      ['Retained successful response bodies',counts.originalCaptureCount],['Unresolved capped windows',counts.limitedWindows],
      ['Failed windows',counts.failedWindows],['Occurrences outside recorded date bounds',counts.outOfWindowRows],
      ['Occurrences without a usable selected datetime',counts.unknownDateRows],
      ['Initial window maximum, days',collection.policy.maxWindowDays],['Selected boundary quantum, milliseconds',collection.policy.queryQuantumMs],
      ['Selected minimum interval, milliseconds',collection.policy.minimumWindowMs],['Selected boundary overlap, milliseconds',collection.policy.boundaryOverlapMs]
    ])+'</table><p>Rows outside the recorded bounds and rows without a usable selected datetime remain visible. '+
    'An unresolved capped interval remains a specific selection for further operator review. The selected quantum and overlap are collection settings; '+
    'the connection supplies the documented response ceiling. Window refinement retains every capped parent; page traversal retains each full page before advancing and finishes on a short page. An updated-time feed describes changed cases in that exact provider selection. Provider data can change while pages are being collected.</p>'+
    '<h3>Original selection</h3><pre>'+escape(JSON.stringify(collection.requestedQuery,null,2))+'</pre>'+
    '<h3>Effective collection filters</h3><pre>'+escape(JSON.stringify(collection.query,null,2))+'</pre>'+
    '<h2>Source credit</h2><table>'+pairs([['Publisher',attribution.publisher],['Dataset',attribution.title],
      ['License',attribution.license],['License URL',attribution.licenseUrl],['Source catalogue',attribution.sourceUrl],
      ['API base',collection.connection.baseUrl],['Jurisdiction',collection.connection.jurisdictionId]])+'</table>'+
    '<h2>Source status and service groups</h2><table><thead><tr><th>Original status</th><th>Unique requests</th></tr></thead><tbody>'+
    grouped(projection.items,'status','Unstated').map(([label,count])=>'<tr><td>'+escape(label)+'</td><td>'+count+'</td></tr>').join('')+
    '</tbody></table><table><thead><tr><th>Service code</th><th>Unique requests</th></tr></thead><tbody>'+
    grouped(projection.items,'serviceCode','Unclassified').map(([label,count])=>'<tr><td>'+escape(label)+'</td><td>'+count+'</td></tr>').join('')+
    '</tbody></table><h2>Every planned window and source page</h2><table><thead><tr><th>Window</th><th>Start / end</th><th>Traversal state</th>'+
    '<th>Returned rows</th><th>Observed / original response SHA-256</th></tr></thead><tbody>'+windows+'</tbody></table>'+
    '<h2>Consolidated request review</h2><table><thead><tr><th>Request / created</th><th>Source status / updated</th><th>Service, location and description</th>'+
    '<th>Internal review</th><th>Selected original and history</th></tr></thead><tbody>'+itemRows+'</tbody></table>'+
    '<h2>Changed original versions</h2>'+(changes || '<p>The retained observations contain one original version per request.</p>')+
    '<h2>Complete original source inventory</h2><table><thead><tr><th>Capture</th><th>Actual redacted request URL</th><th>Recorded HTTP status</th>'+
    '<th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+sourceRows+'</tbody></table>'+
    (faults?'<h2>Retained source failures</h2><table><thead><tr><th>Window</th><th>Original request</th><th>Returned error</th><th>Source receipt</th></tr></thead><tbody>'+faults+'</tbody></table>':'')+
    '<h2>Receiving and continued operation</h2><p>The collection JSON contains the complete member responses, exact original bytes, selected observations and review history. '+
    'The full workspace export carries every saved collection, capture, source operation and decision into a new private receiving workspace for continued review and capture.</p></html>';
}
export function collectionExport({collection,projection,workspace,kind,originalOperation}) {
  const base='open311-'+collection.id;
  if(kind==='csv')return {filename:base+'.csv',contentType:'text/csv; charset=utf-8',body:csv(projection.items)};
  if(kind==='report')return {filename:base+'.html',contentType:'text/html; charset=utf-8',body:report({collection,projection,workspace})};
  if(kind!=='json') { const error=new TypeError('Choose json, csv or report for a collection, or source with a member capture.'); error.status=400;error.code='INVALID_COLLECTION_EXPORT';throw error; }
  const versions=[...projection.observations.values()].map(entry=>({key:entry.row.key,serviceRequestId:entry.row.serviceRequestId,
    selectedCaptureId:entry.captureId,occurrences:entry.occurrences,versions:[...entry.versions.values()]}));
  const operations=collection.nodes.flatMap(window=>window.attempts.map(attempt=>{
    const saved=originalOperation(attempt.requestId);
    if(!saved)return {requestId:attempt.requestId,state:'NOT_ADMITTED',intent:attempt.intent};
    const {owner,staged,...value}=saved; return value;
  }));
  return {filename:base+'.json',contentType:'application/json; charset=utf-8',body:canonicalJson({
    schema:'commons.open311.collection-export.v1',workspaceId:workspace.workspaceId,revision:workspace.revision,
    collection,summary:projection.summary,requests:projection.items,observations:versions,
    originals:projection.records,sourceOperations:operations
  })+'\n'};
}

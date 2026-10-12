// MIT. Complete follow-through tables, reviewed dispatches and portable reports.
import { canonical, copy, digest, fail } from '../gis/shared.mjs';
import { csvEncode } from './csv.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shown=value=>value===null||value===undefined?'':typeof value==='object'?canonical(value):String(value);
export function requestCsv(rows){
  const columns=['request_key','request_id','source_sha256','source_status','title','description','work_needed','source_created_at','source_updated_at','source_closed_at','discrepancies','work_status','assignee','priority','due_at','action','action_note','approval','reviewer','longitude','latitude','original_geometry','original_spatial_reference','original_attributes'];
  return csvEncode(columns,rows.map(row=>({request_key:row.key,request_id:row.serviceRequestId,source_sha256:row.sourceSha256,source_status:row.sourceStatus,title:row.title,description:row.description,work_needed:row.workNeeded,source_created_at:row.createdAt,source_updated_at:row.updatedAt,source_closed_at:row.closedAt,discrepancies:row.discrepancies,
    work_status:row.work?.status??'',assignee:row.work?.assignee??'',priority:row.work?.priority??'',due_at:row.work?.dueAt??'',action:row.work?.action??'',action_note:row.work?.actionNote??'',approval:row.work?.approval??'',reviewer:row.work?.reviewer??'',
    longitude:row.geometry?.coordinates[0]??null,latitude:row.geometry?.coordinates[1]??null,original_geometry:row.originalGeometry,original_spatial_reference:row.spatialReference,original_attributes:row.source})));
}
export function dispatchCsv(dispatch){return csvEncode(dispatch.definition.columns.map(c=>c.name),dispatch.rows.map(row=>row.mapped));}
export function dispatchGeoJson(dispatch){
  return {type:'FeatureCollection',followThrough:{schema:dispatch.schema,dispatchId:dispatch.id,dispatchSha256:dispatch.sha256,editionId:dispatch.editionId,coverage:copy(dispatch.coverage)},
    features:dispatch.rows.map(row=>({type:'Feature',id:row.key,geometry:copy(row.geometry),properties:copy(row.mapped),followThrough:{requestKey:row.key,serviceRequestId:row.serviceRequestId,sourceSha256:row.sourceSha256,
      source:copy(row.request.source),originalGeometry:copy(row.request.originalGeometry),originalSpatialReference:copy(row.request.spatialReference),work:copy(row.work),orders:copy(row.orders)}}))};
}
function table(columns,rows){
  return '<table><thead><tr>'+columns.map(c=>'<th>'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(c=>'<td>'+esc(shown(c.value(row)))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
export function htmlReport(edition,profile,rows,{sources=[],dispatches=[]}={}){
  const active=rows.filter(row=>row.work&&!['done','dismissed'].includes(row.work.status)).length,approved=rows.filter(row=>row.work?.approvalCurrent&&!['done','dismissed'].includes(row.work.status)).length;
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(edition.name)+'</title><style>'+
    'body{font:14px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0 auto;padding:32px;max-width:1500px}h1{font-size:28px}h2{font-size:20px;margin-top:32px}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:12px}th,td{text-align:left;vertical-align:top;border:1px solid #bbb;padding:7px;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;border:1px solid #bbb;padding:12px;font-size:11px}small{color:#444}.metrics{display:flex;gap:28px;flex-wrap:wrap}.metrics p{margin:8px 0}section{break-inside:avoid}@media print{body{padding:0;max-width:none}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}}'+
    '</style><h1>'+esc(edition.name)+'</h1><p>Municipal request and work-order follow-through</p><p>Saved edition '+esc(edition.id)+' · As of '+esc(edition.asOf)+' · Profile '+esc(profile.key)+'</p>'+
    '<div class="metrics"><p><b>'+rows.length+'</b> requests</p><p><b>'+edition.orders.length+'</b> source work orders</p><p><b>'+active+'</b> active follow-ups</p><p><b>'+approved+'</b> current approved actions</p><p><b>'+rows.filter(r=>!r.geometry).length+'</b> unlocated requests</p></div>'+
    '<p>'+esc(edition.definition.commentary)+'</p><h2>Source selection and relationship meaning</h2><p>'+esc(edition.coverage.populationDescription)+'</p><p>'+esc(edition.coverage.relationshipBasis)+'</p>'+
    table([{label:'Original source',value:s=>s.name},{label:'Role / observed',value:s=>s.role+' / '+s.observedAt},{label:'Selected rows',value:s=>s.rows},{label:'State',value:s=>s.state},{label:'Exact files',value:s=>s.originalFiles.map(f=>({name:f.name,bytes:f.bytes,sha256:f.sha256,sourceUrl:f.sourceUrl}))}],sources)+
    '<p>Source status and source closing dates retain their selected field meanings. Internal work status, action approval, due times and coordinate interpretation are separate saved operator decisions. An absent record belongs to the scope of the selected files.</p>'+
    '<h2>Follow-through worklist</h2>'+table([
      {label:'Request',value:r=>r.serviceRequestId},{label:'Title / original description',value:r=>r.title+'\n'+r.description},{label:'Source status / work requirement',value:r=>shown(r.sourceStatus)+' / '+r.workNeeded},
      {label:'Discrepancies',value:r=>r.discrepancies.map(d=>d.label+': '+d.detail).join('\n')},{label:'Internal work',value:r=>r.work?{status:r.work.status,assignee:r.work.assignee,priority:r.work.priority,dueAt:r.work.dueAt}:null},
      {label:'Action / review',value:r=>r.work?{action:r.work.action,note:r.work.actionNote,approval:r.work.approval,current:r.work.approvalCurrent,reviewer:r.work.reviewer}:null},
      {label:'Location',value:r=>r.geometry??{unlocated:true,original:r.originalGeometry,spatialReference:r.spatialReference}},{label:'Source version',value:r=>r.sourceSha256}
    ],rows)+
    '<h2>Explicit field and status mapping</h2><pre>'+esc(JSON.stringify(profile,null,2))+'</pre><h2>Saved dispatch editions</h2>'+
    table([{label:'Name',value:d=>d.name},{label:'Saved',value:d=>d.createdAt},{label:'Actions',value:d=>d.rows.length},{label:'SHA-256',value:d=>d.sha256}],dispatches)+
    '<h2>Coverage and original capture windows</h2><pre>'+esc(JSON.stringify(edition.coverage,null,2))+'</pre><p><small>Complete source files, reviewer decisions, prior editions and original operations travel in the editable workspace package.</small></p></html>';
}
export function fileResult(filename,contentType,body){return {filename,contentType,body,bytes:Buffer.byteLength(body),sha256:digest(body)};}

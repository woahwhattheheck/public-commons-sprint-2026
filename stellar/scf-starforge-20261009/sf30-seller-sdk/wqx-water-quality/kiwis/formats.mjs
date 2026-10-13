// MIT. Complete operator exports retain every original record and correspondence.
import {canonical,fail} from './source.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csvCell=value=>'"'+String(value===undefined||value===null?'':typeof value==='object'?canonical(value):value).replace(/"/g,'""')+'"';
const csv=(headers,rows)=>[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
export const COMMISSIONING_FORMATS=Object.freeze(['bundle','review','decisions','observations','counterparts','correspondences','series','report']);
export function commissioningFile({source,saved,format}){
  let content,mime='application/json',suffix=format+'.json';
  if(format==='review')content=JSON.stringify(saved,null,2)+'\n';
  else if(format==='decisions')content=JSON.stringify(saved.review.document,null,2)+'\n';
  else if(format==='observations'){
    mime='text/csv; charset=utf-8';suffix='observations.csv';
    content=csv(['record_id','row_sha256','series_id','ts_id','timestamp','original_value','original_quality_code','all_original_fields','original_source','original_json_types','all_original_field_types','typed_row_sha256'],
      source.kiwis.observations.map(o=>[o.recordId,o.rowSha256,o.seriesId,o.tsId,o.timestamp,o.value,o.quality,o.fields,o.sourceIdentity,o.originalTypes,o.fieldTypes,o.typedRowSha256]));
  }else if(format==='counterparts'){
    mime='text/csv; charset=utf-8';suffix='counterparts.csv';
    content=csv(['record_id','row_sha256','native_family','all_original_fields','native_source_and_review'],
      source.counterpart.records.map(r=>[r.recordId,r.rowSha256,source.counterpart.kind,r.fields,r.original]));
  }else if(format==='correspondences'){
    mime='text/csv; charset=utf-8';suffix='correspondences.csv';
    content=csv(['record_id','row_sha256','status','all_candidates','source_time_choices','selected_correspondence'],
      saved.review.records.map(r=>[r.recordId,r.rowSha256,r.status,r.candidates,r.timeChoices,r.choice]));
  }else if(format==='series'){
    mime='text/csv; charset=utf-8';suffix='series.csv';
    content=csv(['series_id','ts_id','selected_window','all_original_catalogue_metadata','returned_metadata','quality_and_coverage','original_request_coverage'],
      source.kiwis.series.map(s=>[s.seriesId,s.tsId,s.selected,s.metadata,s.returned,saved.review.series.find(r=>r.seriesId===s.seriesId),s.coverage]));
  }else if(format==='report'){
    mime='text/html; charset=utf-8';suffix='report.html';
    const counts=saved.review.counts;
    content='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(saved.title)+
      '</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:32px;max-width:1400px}h1,h2{line-height:1.2}header{border-bottom:2px solid #333;padding-bottom:18px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}section{margin:28px 0}.scroll{overflow:auto}code{overflow-wrap:anywhere}.metrics{display:flex;gap:24px;flex-wrap:wrap}.metrics strong{font-size:24px;display:block}@media(max-width:640px){body{margin:16px}td,th{padding:6px}}</style></head><body><header><p>WATER QUALITY / KIWIS COMMISSIONING</p><h1>'+
      escape(saved.title)+'</h1><p>Saved edition '+escape(saved.reviewId)+' · '+escape(source.counterpart.kind)+'</p></header><section class="metrics">'+
      Object.entries(counts).map(([name,value])=>'<div><strong>'+escape(value)+'</strong>'+escape(name)+'</div>').join('')+
      '</section><section><h2>Original programme</h2><p>Endpoint: '+escape(source.kiwis.selection.endpoint)+' · datasource '+escape(source.kiwis.selection.datasource===null?'provider default':source.kiwis.selection.datasource)+
      '</p><p>Each linked record retains the selected original observation, all competing candidates and the reviewer’s reason. The full observations, counterpart records, series metadata and editable choices accompany this report.</p><pre>'+
      escape(JSON.stringify(source.kiwis.selection.series,null,2))+'</pre></section><section><h2>Quality-code catalogue</h2><pre>'+
      escape(JSON.stringify(source.kiwis.qualityCodes,null,2))+'</pre><h3>Release classes</h3><pre>'+escape(JSON.stringify(source.kiwis.releaseStateClasses,null,2))+
      '</pre></section><section><h2>Complete correspondence</h2><div class="scroll"><table><thead><tr><th>Native record</th><th>Status</th><th>Selected observation</th><th>Reason</th><th>All candidates and source-time choices</th></tr></thead><tbody>'+
      saved.review.records.map(r=>'<tr><td><code>'+escape(r.recordId)+'</code></td><td>'+escape(r.status)+'</td><td><code>'+
        escape(r.choice?.observationId??'')+'</code></td><td>'+escape(r.choice?.reason??'')+'</td><td><pre>'+
        escape(JSON.stringify({candidates:r.candidates,times:r.timeChoices},null,2))+'</pre></td></tr>').join('')+
      '</tbody></table></div></section><section><h2>Saved mappings and decisions</h2><pre>'+escape(JSON.stringify(saved.review.document,null,2))+
      '</pre></section><section><h2>Complete source identity</h2><pre>'+escape(JSON.stringify({source:source.binding,sourceSha256:source.sourceSha256,reviewSha256:saved.review.reviewSha256,savedSha256:saved.savedSha256},null,2))+
      '</pre></section></body></html>';
  }else fail('KIWIS_FORMAT','Choose one complete commissioning export.');
  return {filename:saved.reviewId+'-'+suffix,mime,bytes:Buffer.from(content)};
}

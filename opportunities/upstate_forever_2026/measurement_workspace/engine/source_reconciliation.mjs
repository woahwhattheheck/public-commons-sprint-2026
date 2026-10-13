/** Exact original-result version review. MeasurementWorkspace owns every decision. */
import {hash, stable} from './normalise.mjs';
import {InputError, csv} from './parse.mjs';

export const RECONCILIATION_SCHEMA='upper-savannah-source-reconciliation/v1';
const id=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=(message,status=400)=>{throw new InputError(message,status);};
const text=v=>typeof v==='string'?v.trim():'';
const semanticFields=['sourceKind','organization','stationId','activityId','sourceResultId','sampledDate','sampledAt','timePrecision','characteristic','parameter','basis','fraction','medium','activityType','valueType','reportedValue','reportedUnit','value','lower','upper','censor','unit','detection','detectionLimits','qualifier','status','method','laboratory','comment','issues'];
const node=(row,key)=>Object.hasOwn(row,key)?{present:true,value:row[key]}:{present:false};
function scope(input={}){
  if(!plain(input))fail('Choose a source-review filter object');
  const sourceIds=input.source_ids??[];
  if(!Array.isArray(sourceIds)||sourceIds.length>2||sourceIds.some(x=>!id(x))||new Set(sourceIds).size!==sourceIds.length)fail('Choose up to two distinct retained source editions');
  const mode=input.mode||'conflicts';
  if(!['conflicts','unresolved','resolved','repeated','all'].includes(mode))fail('Unknown source-review group filter');
  if(input.q!==undefined&&(typeof input.q!=='string'||input.q.length>2000))fail('Enter a station, parameter or original result identifier');
  return {source_ids:[...sourceIds],mode,q:text(input.q)};
}
function revision(value){
  if(!Number.isSafeInteger(value)||value<0)fail('Review the current Measurements revision before saving',409);
  return value;
}
function checkSources(ws,selected){
  for(const key of selected.source_ids)if(!ws.db.prepare('SELECT id FROM imports WHERE id=?').get(key))fail('A selected source edition is not retained in this workspace',404);
}
function query(selected){
  const terms=[],params=[];
  if(selected.source_ids.length){
    terms.push('EXISTS (SELECT 1 FROM records sr JOIN import_records si ON si.record_id=sr.id WHERE sr.logical_key=r.logical_key AND si.import_id IN ('+selected.source_ids.map(()=>'?').join(',')+'))');
    params.push(...selected.source_ids);
  }
  if(selected.q){
    terms.push("EXISTS (SELECT 1 FROM records qr WHERE qr.logical_key=r.logical_key AND (qr.station_id LIKE ? ESCAPE '\\' OR qr.parameter LIKE ? ESCAPE '\\' OR qr.data LIKE ? ESCAPE '\\'))");
    const q='%'+selected.q.replace(/[\\%_]/g,'\\$&')+'%';params.push(q,q,q);
  }
  const having={conflicts:'COUNT(DISTINCT r.id)>1',unresolved:'COUNT(DISTINCT r.id)>1 AND MAX(s.record_id) IS NULL',resolved:'COUNT(DISTINCT r.id)>1 AND MAX(s.record_id) IS NOT NULL',repeated:'COUNT(ir.record_id)>COUNT(DISTINCT r.id)',all:'1'}[selected.mode];
  const sql='SELECT r.logical_key AS id,MIN(r.station_id) AS station_id,MIN(r.parameter) AS parameter,MIN(r.sampled_date) AS sampled_date,COUNT(DISTINCT r.id) AS variant_count,COUNT(ir.record_id) AS occurrence_count,MAX(s.record_id) AS selected_id FROM records r LEFT JOIN import_records ir ON ir.record_id=r.id LEFT JOIN selected_versions s ON s.logical_key=r.logical_key'+(terms.length?' WHERE '+terms.join(' AND '):'')+' GROUP BY r.logical_key HAVING '+having;
  return {sql,params};
}
function fieldComparison(records,raw=false){
  const keys=raw?[...new Set(records.flatMap(r=>Object.keys(r.raw||{})))].sort():semanticFields.filter(key=>records.some(r=>Object.hasOwn(r,key)));
  return keys.map(key=>{
    const cells=records.map(r=>({record_id:r.id,...node(raw?(r.raw||{}):r,key)}));
    const values=new Set(cells.map(({record_id,...value})=>stable(value)));
    return {field:key,different:values.size>1,cells};
  });
}
function group(ws,key,workspaceRevision){
  if(!id(key))fail('Select the exact retained source-result group');
  const items=ws.db.prepare(ws.selectSQL()+' WHERE r.logical_key=? ORDER BY r.id').all(key);
  if(!items.length)fail('Source-result group not found',404);
  const records=items.map(row=>ws.recordDetail(row));
  const selected=records[0].selectedVersion||null;
  const occurrences=records.flatMap(r=>r.sources.map(s=>({record_id:r.id,...s})));
  const value={id:key,station_id:records[0].stationId,parameter:records[0].parameter,sampled_date:records[0].sampledDate,variant_count:records.length,occurrence_count:occurrences.length,selected_id:selected,records,occurrences,fields:fieldComparison(records),original_fields:fieldComparison(records,true)};
  value.binding=hash(stable({revision:workspaceRevision,id:key,records:records.map(r=>({id:r.id,review:r.review,mapping:r.mapping,selected:r.selectedVersion,sources:r.sources}))}));
  return value;
}
export function reconciliationCatalog(ws){
  return ws.readConsistent(()=>({
    revision:ws.revision(),
    sources:ws.db.prepare('SELECT i.id,i.kind,i.label,i.sha,i.created_at,COUNT(ir.record_id) AS occurrence_count,COUNT(DISTINCT ir.record_id) AS record_count FROM imports i LEFT JOIN import_records ir ON ir.import_id=i.id GROUP BY i.id ORDER BY i.created_at DESC,i.id').all(),
    counts:ws.db.prepare('SELECT COUNT(*) AS groups,SUM(CASE WHEN n>1 THEN 1 ELSE 0 END) AS conflicts,SUM(CASE WHEN n>1 AND selected IS NULL THEN 1 ELSE 0 END) AS unresolved FROM (SELECT r.logical_key,COUNT(*) AS n,MAX(s.record_id) AS selected FROM records r LEFT JOIN selected_versions s ON s.logical_key=r.logical_key GROUP BY r.logical_key)').get()
  }));
}
export function reconciliationGroups(ws,input={}){
  const selected=scope(input);checkSources(ws,selected);
  const offset=Math.max(0,Math.trunc(Number(input.offset))||0),limit=Math.max(1,Math.min(200,Math.trunc(Number(input.limit))||50));
  if(!Number.isSafeInteger(offset))fail('Invalid source-review page offset');
  return ws.readConsistent(()=>{
    const {sql,params}=query(selected),total=ws.db.prepare('SELECT COUNT(*) AS n FROM ('+sql+')').get(...params).n;
    const rows=ws.db.prepare(sql+' ORDER BY sampled_date DESC,id LIMIT ? OFFSET ?').all(...params,limit,offset);
    const imports=ws.db.prepare('SELECT DISTINCT ir.import_id FROM import_records ir JOIN records r ON r.id=ir.record_id WHERE r.logical_key=? ORDER BY ir.import_id');
    for(const row of rows){
      row.source_ids=imports.all(row.id).map(x=>x.import_id);
      row.selected_source_presence=selected.source_ids.map(source_id=>({source_id,present:row.source_ids.includes(source_id)}));
    }
    return {revision:ws.revision(),scope:selected,total,offset,limit,groups:rows};
  });
}
export function reconciliationGroup(ws,key){
  ws.refreshNativeDomain();
  return ws.readConsistent(()=>{const current=ws.revision();return {revision:current,group:group(ws,key,current)};});
}
export function decideReconciliation(ws,input){
  if(!plain(input))fail('Choose a source-review decision');
  const expected=revision(input.expected_revision);
  if(!id(input.group_id)||!id(input.group_binding))fail('Reopen the exact group before deciding');
  if(!['select','unresolve'].includes(input.action))fail('Choose a source version or return its selection to unresolved');
  const reviewer=text(input.reviewer),reason=text(input.reason);
  if(!reviewer||!reason)fail('Reviewer and decision rationale are required');
  const inspected=reconciliationGroup(ws,input.group_id);
  if(inspected.revision!==expected||inspected.group.binding!==input.group_binding)fail('Measurements changed after this comparison. Refresh and review the original versions again.',409);
  const current=inspected.group;
  if(current.variant_count<2)fail('This original result has one retained version; use its existing measurement review');
  let chosen;
  if(input.action==='select'){
    chosen=current.records.find(r=>r.id===input.record_id);if(!chosen)fail('The selected record is not a version in this original result group');
  }else{
    if(!current.selected_id)fail('This group is already unresolved; no review was changed',409);
    chosen=current.records.find(r=>r.id===current.selected_id);
  }
  // This is the original review transaction, event and selected_versions writer.
  // Reset is the original pending review on the previously selected version.
  const result=ws.review(chosen.id,{state:input.action==='select'?'include':'pending',selectVersion:input.action==='select',reviewer,reason,expectedRevision:expected});
  return {revision:result.revision,decision:{action:input.action,record_id:chosen.id,reviewer,reason},...reconciliationGroup(ws,input.group_id)};
}
export function saveReconciliationReport(ws,input={}){
  const selected=scope(input);checkSources(ws,selected);
  const expected=revision(input.expected_revision);
  const reviewer=text(input.reviewer),reason=text(input.reason);
  if(!reviewer||!reason)fail('Reviewer and report purpose are required');
  ws.refreshNativeDomain();
  const report=ws.readConsistent(()=>{
    if(ws.revision()!==expected)fail('Measurements changed. Refresh the comparison before saving its report.',409);
    const {sql,params}=query(selected),keys=ws.db.prepare(sql+' ORDER BY sampled_date DESC,id').all(...params);
    const groups=keys.map(row=>group(ws,row.id,expected));
    const sourceIds=[...new Set([...selected.source_ids,...groups.flatMap(g=>g.occurrences.map(o=>o.id))])];
    const sources=sourceIds.map(key=>{const s=ws.source(key);return {id:s.id,kind:s.kind,label:s.label,sha:s.sha,created_at:s.created_at,mapping:JSON.parse(s.mapping),origin:JSON.parse(s.origin),summary:JSON.parse(s.summary),rejected:JSON.parse(s.rejected),content:s.content};});
    return {schema:RECONCILIATION_SCHEMA,workspaceRevision:expected,created_at:new Date().toISOString(),reviewer,reason,scope:selected,counts:{groups:groups.length,versions:groups.reduce((n,g)=>n+g.records.length,0),occurrences:groups.reduce((n,g)=>n+g.occurrences.length,0),unresolved:groups.filter(g=>g.variant_count>1&&!g.selected_id).length},groups,sources,
      method:'Exact original logical keys only. All retained versions and source occurrences are included, including versions outside the chosen source pair. No cross-provider identity, unit conversion, numerical substitution or preferred source is inferred. Source presence is not evidence of deletion.'};
  });
  return {...report,saved_export_id:ws.snapshot('source-reconciliation',report)};
}
export function reconciliationReports(ws){
  return {reports:ws.db.prepare("SELECT id,created_at,revision,kind FROM exports WHERE kind='source-reconciliation' ORDER BY created_at DESC,id").all()};
}
function validateRetainedReport(ws,report){
  const changed=message=>fail('Retained source-review report differs from its original evidence: '+message,409);
  if(!plain(report)||report.schema!==RECONCILIATION_SCHEMA||!Array.isArray(report.groups)||!Array.isArray(report.sources))changed('invalid report structure');
  revision(report.workspaceRevision);
  const selectedScope=scope(report.scope);
  const sourceIds=new Set();
  for(const source of report.sources){
    if(!plain(source)||!id(source.id)||sourceIds.has(source.id))changed('duplicate or invalid source edition');
    sourceIds.add(source.id);
    const original=ws.source(source.id);
    if(typeof source.content!=='string'||hash(source.content)!==source.sha||source.content!==original.content)changed('original source body '+source.id);
    const expected={id:original.id,kind:original.kind,label:original.label,sha:original.sha,created_at:original.created_at,mapping:JSON.parse(original.mapping),origin:JSON.parse(original.origin),summary:JSON.parse(original.summary),rejected:JSON.parse(original.rejected),content:original.content};
    if(stable(source)!==stable(expected))changed('original source descriptor '+source.id);
  }
  if(selectedScope.source_ids.some(key=>!sourceIds.has(key)))changed('selected source edition is absent');
  const groupIds=new Set(),recordIds=new Set(),immutable=ws.db.prepare('SELECT data,logical_key FROM records WHERE id=?');
  const originalGroup=ws.db.prepare('SELECT DISTINCT r.id,ir.import_id FROM records r JOIN import_records ir ON ir.record_id=r.id WHERE r.logical_key=?');
  for(const g of report.groups){
    if(!plain(g)||!id(g.id)||groupIds.has(g.id)||!Array.isArray(g.records)||!g.records.length)changed('duplicate or invalid result group');
    groupIds.add(g.id);
    const ids=g.records.map(r=>r?.id);
    if(ids.some(key=>!id(key))||new Set(ids).size!==ids.length||stable(ids)!==stable([...ids].sort()))changed('original version order or identity');
    const expectedIds=[...new Set(originalGroup.all(g.id).filter(row=>sourceIds.has(row.import_id)).map(row=>row.id))].sort();
    if(stable(ids)!==stable(expectedIds))changed('complete original versions within the retained report sources');
    if(g.selected_id!==null&&!ids.includes(g.selected_id))changed('selected version is outside its original group');
    for(const r of g.records){
      if(recordIds.has(r.id))changed('version appears in more than one group');
      recordIds.add(r.id);
      const original=immutable.get(r.id);
      const {id:recordId,review,mapping,variantCount,selectedVersion,eligible,sources,variants,history,...body}=r;
      if(!original||original.logical_key!==g.id||body.logicalKey!==g.id||stable(body)!==stable(JSON.parse(original.data)))changed('original normalized row '+r.id);
      if(!Array.isArray(sources)||!sources.length||sources.some(s=>!sourceIds.has(s.id)))changed('source occurrence is not bound to a retained original');
      const byIdentity=rows=>rows.map(x=>stable(x)).sort();
      const originalOccurrences=ws.recordSources(r.id).filter(s=>sourceIds.has(s.id));
      if(stable(byIdentity(sources))!==stable(byIdentity(originalOccurrences)))changed('complete original occurrences for '+r.id);
      if(variantCount!==ids.length||selectedVersion!==g.selected_id||!Array.isArray(variants)||stable([...variants].sort())!==stable([...ids].sort()))changed('historical version membership '+r.id);
      if(!plain(review)||!['pending','include','exclude'].includes(review.state)||!plain(eligible)||typeof eligible.ok!=='boolean'||!Array.isArray(eligible.reasons))changed('historical review structure '+r.id);
    }
    const first=g.records[0],occurrences=g.records.flatMap(r=>r.sources.map(s=>({record_id:r.id,...s})));
    if(g.station_id!==first.stationId||g.parameter!==first.parameter||g.sampled_date!==first.sampledDate||g.variant_count!==ids.length||g.occurrence_count!==occurrences.length)changed('original group metadata');
    if(stable(g.occurrences)!==stable(occurrences)||stable(g.fields)!==stable(fieldComparison(g.records))||stable(g.original_fields)!==stable(fieldComparison(g.records,true)))changed('original field comparison or occurrence list');
    const binding=hash(stable({revision:report.workspaceRevision,id:g.id,records:g.records.map(r=>({id:r.id,review:r.review,mapping:r.mapping,selected:r.selectedVersion,sources:r.sources}))}));
    if(g.binding!==binding)changed('historical comparison binding');
  }
  const counts={groups:report.groups.length,versions:report.groups.reduce((n,g)=>n+g.records.length,0),occurrences:report.groups.reduce((n,g)=>n+g.occurrences.length,0),unresolved:report.groups.filter(g=>g.variant_count>1&&!g.selected_id).length};
  if(stable(report.counts)!==stable(counts))changed('complete snapshot counts');
  return report;
}

export function reconciliationReport(ws,key){
  if(typeof key!=='string'||!key)fail('Select a saved source-review report');
  return ws.readConsistent(()=>{
    const row=ws.db.prepare("SELECT id,content FROM exports WHERE id=? AND kind='source-reconciliation'").get(key);
    if(!row)fail('Saved source-review report not found',404);
    const report=validateRetainedReport(ws,JSON.parse(row.content));
    return {...report,saved_export_id:row.id};
  });
}
export function reconciliationCSV(report){
  if(report?.schema!==RECONCILIATION_SCHEMA)fail('Choose a complete source-review report');
  const rows=[];
  for(const g of report.groups)for(const r of g.records)for(const s of r.sources)rows.push({group_id:g.id,record_id:r.id,selected:g.selected_id===r.id,workspace_revision:report.workspaceRevision,source_import_id:s.id,source_sha256:s.sha,source_label:s.label,source_line:s.source_line,station_id:r.stationId,original_result_id:r.sourceResultId,activity_id:r.activityId,date:r.sampledDate,characteristic:r.characteristic,fraction:r.fraction,reported_value:r.reportedValue,reported_unit:r.reportedUnit,qualifier:r.qualifier,method:r.method,review_state:r.review.state,reviewer:r.review.reviewer||'',review_reason:r.review.reason||'',eligible:r.eligible.ok,exclusion_reasons:r.eligible.reasons,original_row:JSON.stringify(r.raw)});
  return csv(rows,['group_id','record_id','selected','workspace_revision','source_import_id','source_sha256','source_label','source_line','station_id','original_result_id','activity_id','date','characteristic','fraction','reported_value','reported_unit','qualifier','method','review_state','reviewer','review_reason','eligible','exclusion_reasons','original_row']);
}
export function reconciliationOperation(ws,method,parts,query={},body={}){
  if(method==='GET'&&!parts.length)return reconciliationCatalog(ws);
  if(method==='GET'&&parts[0]==='groups'&&!parts[1]){let sourceIds=[];try{sourceIds=query.source_ids?JSON.parse(query.source_ids):[];}catch{fail('Selected source editions must be a JSON array of exact retained IDs');}return reconciliationGroups(ws,{...query,source_ids:sourceIds});}
  if(method==='GET'&&parts[0]==='groups'&&parts.length===2)return reconciliationGroup(ws,parts[1]);
  if(method==='POST'&&parts.length===1&&parts[0]==='decide')return decideReconciliation(ws,body);
  if(method==='GET'&&parts.length===1&&parts[0]==='reports')return reconciliationReports(ws);
  if(method==='POST'&&parts.length===1&&parts[0]==='reports')return saveReconciliationReport(ws,body);
  if(method==='GET'&&parts.length===2&&parts[0]==='reports')return reconciliationReport(ws,parts[1]);
  fail('Source-review operation not found',404);
}

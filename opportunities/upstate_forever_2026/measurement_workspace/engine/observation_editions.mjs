import {InputError,clean,csv} from './parse.mjs';
import {hash,stable} from './normalise.mjs';

export const OBSERVATION_EDITION_SCHEMA='upstate.observation-edition/v1';
export const OBSERVATION_CAPTURE_SCHEMA='upstate.observation-edition-capture/v1';
const KIND='observation-edition';
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const same=(a,b)=>stable(a)===stable(b);
const fail=(message,status=400)=>{throw new InputError(message,status);};
const text=(v,name,required=false,max=12000)=>{
 if(v===undefined||v===null)v='';
 if(typeof v!=='string'||v.length>max)fail(name+' must be text of at most '+max+' characters');
 const result=v.trim();if(required&&!result)fail(name+' is required');return result;
};
const identity=(v,name='Original identity')=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail(name+' must be an exact retained identity');return v;};
const revision=v=>{if(!Number.isSafeInteger(v)||v<0)fail('Choose the inspected workspace revision');return v;};
const unique=(v,name,min=0,max=1000000)=>{if(!Array.isArray(v)||v.length<min||v.length>max||v.some(x=>typeof x!=='string')||new Set(v).size!==v.length)fail(name+' must contain distinct exact identities');return [...v];};
const fieldNames=['organization','stationId','activityId','sourceResultId','sampledDate','sampledAt','sourceTime','timePrecision','timeZone','characteristic','parameter','basis','fraction','medium','activityType','method','laboratory','valueType','reportedValue','reportedUnit','value','lower','upper','censor','unit','detection','detectionLimits','qualifier','status','methodContext','methodName','speciation','solidsBasis','resultDepth','resultDepthUnit','resultDepthReference','activityDepth','activityDepthUnit','activityDepthReference','relativeDepth','timeBasis','temperatureBasis','weightBasis'];
const supportNames=['stationId','sampledDate','sampledAt','timePrecision','timeZone','characteristic','parameter','basis','fraction','medium','activityType','method','methodContext','speciation','laboratory','valueType','unit'];
const node=(record,key)=>Object.hasOwn(record,key)?{present:true,value:record[key]}:{present:false};
function date(value,name){
 if(value==='')return '';
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail(name+' must be a valid source-calendar date');
 return value;
}
export function observationScope(input){
 if(!plain(input))fail('Choose the original source editions and observation filters');
 const allowed=new Set(['source_ids','filters']);
 if(Object.keys(input).some(k=>!allowed.has(k)))fail('Unknown observation scope field');
 const source_ids=unique(input.source_ids,'Original sources',1,256).map(x=>identity(x)).sort();
 const filters=input.filters||{};
 if(!plain(filters))fail('Observation filters must be an object');
 const result={},allowedFilters=['stationId','parameter','characteristic','fraction','unit','censor','method','organization','activityId','from','to'];
 if(Object.keys(filters).some(k=>!allowedFilters.includes(k)))fail('Unknown observation filter');
 for(const key of allowedFilters){const value=text(filters[key],key,false,4000);if(value)result[key]=['from','to'].includes(key)?date(value,key):value;}
 if(result.from&&result.to&&result.from>result.to)fail('The source-date interval ends before it starts');
 return {source_ids,filters:result};
}
function matches(record,filters){
 for(const [key,value] of Object.entries(filters)){
  if(key==='from'){if(!record.sampledDate||record.sampledDate<value)return false;}
  else if(key==='to'){if(!record.sampledDate||record.sampledDate>value)return false;}
  else if(record[key]!==value)return false;
 }
 return true;
}
function descriptor(source){
 return {id:source.id,kind:source.kind,label:source.label,sha:source.sha,created_at:source.created_at,
  mapping:JSON.parse(source.mapping),origin:JSON.parse(source.origin),summary:JSON.parse(source.summary),rejected:JSON.parse(source.rejected),content:source.content};
}
function sourceRows(ws,scope){
 const placeholders=scope.source_ids.map(()=>'?').join(',');
 return ws.db.prepare(ws.selectSQL()+' WHERE EXISTS (SELECT 1 FROM import_records ir WHERE ir.record_id=r.id AND ir.import_id IN ('+placeholders+')) ORDER BY r.id').all(...scope.source_ids).map(item=>ws.recordDetail(item)).filter(row=>matches(row,scope.filters));
}
function inspectWithinRead(ws,scope){
 for(const sourceId of scope.source_ids)ws.source(sourceId);
 const records=sourceRows(ws,scope),ids=[...new Set([...scope.source_ids,...records.flatMap(r=>r.sources.map(s=>s.id))])].sort();
 const sources=ids.map(key=>descriptor(ws.source(key)));
 for(const s of sources)if(hash(s.content)!==s.sha)fail('Retained original source bytes differ: '+s.label,409);
 const capture={schema:OBSERVATION_CAPTURE_SCHEMA,workspace_revision:ws.revision(),scope,records,sources,
  counts:{records:records.length,source_editions:sources.length,selected_sources:scope.source_ids.length,occurrences:records.reduce((n,r)=>n+r.sources.length,0)},
  method:'Exact original source editions and filters. No cross-publisher identity or duplicate decision is inferred. Original row bodies, all source occurrences and the current review/eligibility snapshot are retained.'};
 return {...capture,source_binding:hash(stable(capture))};
}
export function inspectObservationEdition(ws,input={}){
 const selected=observationScope(input.scope);
 ws.refreshNativeDomain();
 return ws.readConsistent(()=>{
  if(input.expected_revision!==undefined&&revision(input.expected_revision)!==ws.revision())fail('Measurements changed. Inspect the current original sources again.',409);
  return inspectWithinRead(ws,selected);
 });
}
export function observationComparison(records){
 const result=fieldNames.map(key=>({field:key,cells:records.map(r=>({record_id:r.id,...node(r,key)}))}));
 result.push({field:'original_station',cells:records.map(r=>({record_id:r.id,...node(r,'station')}))});
 result.push({field:'original_fields',cells:records.map(r=>({record_id:r.id,...node(r,'raw')}))});
 for(const row of result)row.different=new Set(row.cells.map(({record_id,...v})=>stable(v))).size>1;
 return result;
}
function concerns(records){
 const fields=observationComparison(records),result=fields.filter(f=>f.different&&f.field!=='original_fields').map(f=>({id:'different:'+f.field,field:f.field,kind:'difference',message:'Original '+f.field+' differs between the selected records.'}));
 for(const field of supportNames)if(records.some(r=>!Object.hasOwn(r,field)||r[field]===null||r[field]===''))result.push({id:'unknown:'+field,field,kind:'unknown',message:'Original '+field+' is not supplied for every record.'});
 if(records.some(r=>!r.station||r.station.latitude===null||r.station.latitude===undefined||r.station.longitude===null||r.station.longitude===undefined))result.push({id:'unknown:coordinates',field:'original_station',kind:'unknown',message:'Original coordinates are not supplied for every record.'});
 return result;
}
function normalGroups(records,input){
 if(!Array.isArray(input))fail('Observation relationships must be an array');
 const byId=new Map(records.map(r=>[r.id,r])),used=new Set();
 return input.map(value=>{
  if(!plain(value))fail('Each observation relationship must be an object');
  const member_ids=unique(value.member_ids,'Relationship members',2,64).map(x=>identity(x)).sort();
  for(const id of member_ids){if(!byId.has(id))fail('A relationship member is outside the inspected source selection');if(used.has(id))fail('A record is in more than one relationship. Review the whole group explicitly; transitive duplicate merging is not inferred.');used.add(id);}
  const relationship=value.relationship;
  if(!['same_observation','independent_replicates','related_context','distinct_observations','unresolved'].includes(relationship))fail('Choose an explicit observation relationship');
  const rationale=text(value.rationale,'Relationship rationale',true),evidence_reference=text(value.evidence_reference,'Relationship evidence reference',true,4000);
  const rows=member_ids.map(id=>byId.get(id)),issues=concerns(rows);
  const acknowledged=unique(value.acknowledged_differences||[],'Reviewed support differences',0,100).sort();
  if(acknowledged.some(id=>!issues.some(x=>x.id===id)))fail('A reviewed difference no longer belongs to this exact comparison');
  let representative_id=null;
  if(relationship==='same_observation'){
   representative_id=identity(value.representative_id,'Representative record');
   if(!member_ids.includes(representative_id))fail('The representative must be an original member of this comparison');
   if(issues.some(x=>!acknowledged.includes(x.id)))fail('Review each original support/value difference and missing field before treating these records as one observation');
  }else if(value.representative_id!==undefined&&value.representative_id!==null&&value.representative_id!=='')fail('Only a same-observation relationship chooses a representative; independent records remain separate');
  const id=hash(stable(member_ids));
  return {id,member_ids,relationship,representative_id,rationale,evidence_reference,acknowledged_differences:acknowledged,concerns:issues,comparison:observationComparison(rows)};
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
function normalExclusions(records,input){
 if(!Array.isArray(input))fail('Explicit exclusions must be an array');
 const ids=new Set(records.map(r=>r.id)),seen=new Set();
 return input.map(value=>{
  if(!plain(value))fail('Each explicit exclusion needs its original record and reason');
  const record_id=identity(value.record_id);
  if(!ids.has(record_id)||seen.has(record_id))fail('Excluded records must occur once in the inspected selection');
  seen.add(record_id);return {record_id,reason:text(value.reason,'Exclusion reason',true)};
 }).sort((a,b)=>a.record_id.localeCompare(b.record_id));
}
export function compileObservationEdition(capture,input){
 if(!plain(capture)||capture.schema!==OBSERVATION_CAPTURE_SCHEMA||!Array.isArray(capture.records)||!Array.isArray(capture.sources))fail('Inspect complete original observations first');
 const {source_binding,...body}=capture;
 if(hash(stable(body))!==source_binding)fail('The inspected original-source binding differs',409);
 if(input.source_binding!==source_binding||revision(input.expected_revision)!==capture.workspace_revision)fail('The submitted choices do not match the inspected original observations',409);
 if(!same(observationScope(input.scope),capture.scope))fail('The source selection changed after inspection',409);
 const title=text(input.title,'Observation edition title',true,500),reviewer=text(input.reviewer,'Scientist/reviewer',true,500),purpose=text(input.purpose,'Edition purpose',true);
 const groups=normalGroups(capture.records,input.groups||[]),exclusions=normalExclusions(capture.records,input.exclusions||[]);
 const groupByRecord=new Map(groups.flatMap(g=>g.member_ids.map(id=>[id,g]))),excluded=new Map(exclusions.map(x=>[x.record_id,x.reason]));
 const rows=capture.records.map(record=>{
  const g=groupByRecord.get(record.id);let disposition='retained',reason='';
  if(excluded.has(record.id)){disposition='excluded';reason=excluded.get(record.id);}
  else if(g?.relationship==='unresolved'){disposition='unresolved';reason=g.rationale;}
  else if(g?.relationship==='same_observation'&&g.representative_id!==record.id){disposition='duplicate_representation';reason=g.rationale;}
  const native_reasons=[...(record.eligible?.reasons||[])];
  if(disposition!=='retained')native_reasons.unshift('observation-edition-'+disposition);
  return {record_id:record.id,relationship_id:g?.id||null,relationship:g?.relationship||'not_assessed',representative_id:g?.representative_id||null,disposition,reason,native_eligible:disposition==='retained'&&record.eligible?.ok===true,native_reasons};
 });
 for(const g of groups)if(g.relationship==='same_observation'&&excluded.has(g.representative_id))fail('An explicitly excluded record cannot represent a same-observation group; choose another representative or retain an unresolved relationship');
 const counts={records:rows.length,retained:rows.filter(r=>r.disposition==='retained').length,duplicate_representations:rows.filter(r=>r.disposition==='duplicate_representation').length,excluded:rows.filter(r=>r.disposition==='excluded').length,unresolved:rows.filter(r=>r.disposition==='unresolved').length,not_assessed:rows.filter(r=>r.relationship==='not_assessed').length,relationships:groups.length,native_eligible:rows.filter(r=>r.native_eligible).length,source_editions:capture.sources.length,occurrences:capture.counts.occurrences};
 return {schema:OBSERVATION_EDITION_SCHEMA,title,reviewer,purpose,workspaceRevision:capture.workspace_revision,source_binding,capture,groups,exclusions,rows,counts,
  method:'Scientist-authored relationships apply only to this immutable observation edition. Original measurements, identifiers, source occurrences, revisions and reviews remain unchanged. Same-observation groups suppress only their explicitly unselected representations; independent replicates are not averaged. Censoring, units, fractions, methods, time and coordinates retain their original meanings. Native eligibility is the retained original Measurements review snapshot, not permission to bypass a current native importer.'};
}
function requestOf(input){
 return {scope:observationScope(input.scope),title:text(input.title,'Observation edition title',true,500),reviewer:text(input.reviewer,'Scientist/reviewer',true,500),purpose:text(input.purpose,'Edition purpose',true),expected_revision:revision(input.expected_revision),source_binding:identity(input.source_binding,'Source binding'),groups:input.groups||[],exclusions:input.exclusions||[],parent_id:input.parent_id||null,parent_digest:input.parent_digest||null};
}
function validateCapture(ws,capture){
 const changed=message=>fail('The retained observation edition differs from its original evidence: '+message,409);
 if(!plain(capture)||capture.schema!==OBSERVATION_CAPTURE_SCHEMA||!Array.isArray(capture.records)||!Array.isArray(capture.sources))changed('invalid original snapshot');
 const selected=observationScope(capture.scope),sourceIds=new Set();
 for(const source of capture.sources){
  if(!plain(source)||sourceIds.has(source.id))changed('duplicate original source');
  sourceIds.add(source.id);
  const original=descriptor(ws.source(source.id));
  if(!same(source,original)||hash(source.content)!==source.sha)changed('complete original source body/descriptor '+source.id);
 }
 if(selected.source_ids.some(id=>!sourceIds.has(id)))changed('selected source omitted');
 const placeholders=selected.source_ids.map(()=>'?').join(',');
 const expected=ws.db.prepare('SELECT DISTINCT r.id,r.data FROM records r JOIN import_records ir ON ir.record_id=r.id WHERE ir.import_id IN ('+placeholders+') ORDER BY r.id').all(...selected.source_ids).filter(r=>matches(JSON.parse(r.data),selected.filters)).map(r=>r.id);
 if(!same(capture.records.map(r=>r.id),expected))changed('complete original row membership and order');
 const immutable=ws.db.prepare('SELECT data,logical_key FROM records WHERE id=?');
 for(const record of capture.records){
  const original=immutable.get(record.id);
  const {id,review,mapping,variantCount,selectedVersion,eligible,sources,variants,history,...body}=record;
  if(!original||!same(body,JSON.parse(original.data)))changed('original canonical row '+id);
  if(!Array.isArray(sources)||!sources.length||sources.some(s=>!sourceIds.has(s.id)))changed('original source occurrences '+id);
  const sort=rows=>rows.map(x=>stable(x)).sort();
  if(!same(sort(sources),sort(ws.recordSources(id).filter(s=>sourceIds.has(s.id)))))changed('complete retained occurrences '+id);
  if(!plain(review)||!['pending','include','exclude'].includes(review.state)||!plain(eligible)||typeof eligible.ok!=='boolean'||!Array.isArray(eligible.reasons)||eligible.reasons.some(v=>typeof v!=='string')||eligible.ok!==!eligible.reasons.length)changed('historical review/eligibility '+id);
  if(mapping!==null&&!plain(mapping))changed('historical station mapping '+id);
  if(!Array.isArray(variants)||variants.length!==variantCount||new Set(variants).size!==variants.length||!variants.includes(id)||selectedVersion!==null&&!variants.includes(selectedVersion))changed('historical source revisions '+id);
  for(const v of variants)if(immutable.get(v)?.logical_key!==original.logical_key)changed('historical revision membership '+id);
  if(!Array.isArray(history))changed('historical original review events '+id);
 }
 const counts={records:capture.records.length,source_editions:capture.sources.length,selected_sources:selected.source_ids.length,occurrences:capture.records.reduce((n,r)=>n+r.sources.length,0)};
 if(!same(counts,capture.counts))changed('original snapshot counts');
 const {source_binding,...body}=capture;if(hash(stable(body))!==source_binding)changed('original source binding');
 return capture;
}
function readWithin(ws,id,seen=new Set()){
 if(typeof id!=='string'||!id||id.length>200)fail('Choose a saved observation edition');
 if(seen.has(id))fail('The saved observation edition ancestry contains a cycle',409);seen.add(id);
 const row=ws.db.prepare("SELECT id,content FROM exports WHERE id=? AND kind='observation-edition'").get(id);
 if(!row)fail('Saved observation edition not found',404);
 let value;try{value=JSON.parse(row.content);}catch{fail('Saved observation edition is not complete JSON',409);}
 if(value?.schema!==OBSERVATION_EDITION_SCHEMA||value.edition_id!==id||!plain(value.request))fail('Saved observation edition identity differs',409);
 validateCapture(ws,value.capture);
 if(hash(stable(value.request))!==value.request_sha256)fail('Saved observation choices differ',409);
 const expected=compileObservationEdition(value.capture,value.request);
 const extras=['edition_id','created_at','operation_id','request','request_sha256','parent_id','parent_digest','digest'];
 const actual=Object.fromEntries(Object.entries(value).filter(([k])=>!extras.includes(k)));
 if(!same(actual,expected))fail('Saved observation selections or field comparisons differ from their original rows',409);
 if(typeof value.operation_id!=='string'||id!=='observation-edition-'+hash(value.operation_id))fail('Saved observation operation identity differs',409);
 if(value.parent_id!==value.request.parent_id||value.parent_digest!==value.request.parent_digest)fail('Saved observation ancestry differs',409);
 if(value.parent_id){
  const parent=readWithin(ws,value.parent_id,seen);
  if(parent.digest!==value.parent_digest)fail('Saved parent observation edition differs',409);
 }
 const {digest,...body}=value;if(hash(stable(body))!==digest)fail('Saved observation edition digest differs',409);
 return value;
}
export function readObservationEdition(ws,id){return ws.readConsistent(()=>readWithin(ws,id));}
export function previewObservationEdition(ws,input){
 const capture=inspectObservationEdition(ws,{scope:input.scope,expected_revision:input.expected_revision});
 return compileObservationEdition(capture,requestOf(input));
}
export function saveObservationEdition(ws,input){
 if(!plain(input))fail('Prepare an observation edition');
 const operation_id=text(input.operation_id,'Save operation identity',true,200),request=requestOf(input),request_sha256=hash(stable(request)),id='observation-edition-'+hash(operation_id);
 const previous=ws.db.prepare("SELECT id,content FROM exports WHERE id=? AND kind='observation-edition'").get(id);
 if(previous){
  const retained=readObservationEdition(ws,id);
  if(retained.request_sha256!==request_sha256)fail('This save operation already belongs to different observation choices. Retain the original request for retry.',409);
  return {...retained,reused:true,current_revision:ws.revision()};
 }
 const capture=inspectObservationEdition(ws,{scope:request.scope,expected_revision:request.expected_revision}),compiled=compileObservationEdition(capture,request);
 if(request.parent_id){const parent=readObservationEdition(ws,request.parent_id);if(parent.digest!==request.parent_digest)fail('The selected parent observation edition differs. Reopen it before revising.',409);}
 else if(request.parent_digest)fail('A parent digest needs its saved observation edition');
 const created_at=new Date().toISOString(),body={...compiled,edition_id:id,created_at,operation_id,request,request_sha256,parent_id:request.parent_id,parent_digest:request.parent_digest};
 const value={...body,digest:hash(stable(body))};
 ws.atomic(()=>{
  ws.db.prepare('INSERT INTO exports VALUES(?,?,?,?,?)').run(id,created_at,capture.workspace_revision,KIND,JSON.stringify(value));
  ws.event('observation-edition',id,{title:value.title,reviewer:value.reviewer,purpose:value.purpose,source_binding:value.source_binding,parent_id:value.parent_id,digest:value.digest});
 },capture.workspace_revision);
 return {...value,reused:false,current_revision:ws.revision()};
}
export function listObservationEditions(ws){
 return ws.readConsistent(()=>({revision:ws.revision(),editions:ws.db.prepare("SELECT id,created_at,revision,content FROM exports WHERE kind='observation-edition' ORDER BY created_at DESC,id").all().map(row=>{
  let value;try{value=JSON.parse(row.content);}catch{fail('A saved observation edition is incomplete',409);}
  return {id:row.id,created_at:row.created_at,workspace_revision:row.revision,title:value.title,reviewer:value.reviewer,counts:value.counts,parent_id:value.parent_id,digest:value.digest};
 })}));
}
export function observationEditionCatalogue(ws){
 return ws.readConsistent(()=>({revision:ws.revision(),sources:ws.db.prepare('SELECT id,kind,label,sha,created_at,summary FROM imports ORDER BY created_at,id').all().map(s=>({...s,summary:JSON.parse(s.summary)})),editions:ws.db.prepare("SELECT id,created_at,revision,content FROM exports WHERE kind='observation-edition' ORDER BY created_at DESC,id").all().map(r=>{const v=JSON.parse(r.content);return {id:r.id,title:v.title,created_at:r.created_at,reviewer:v.reviewer,counts:v.counts,parent_id:v.parent_id,digest:v.digest};})}));
}
export function observationEditionCSV(edition){
 if(edition?.schema!==OBSERVATION_EDITION_SCHEMA)fail('Choose a complete observation edition');
 const dispositions=new Map(edition.rows.map(r=>[r.record_id,r])),rows=[];
 for(const record of edition.capture.records)for(const source of record.sources){
  const selection=dispositions.get(record.id);
  rows.push({edition_id:edition.edition_id||'',title:edition.title,workspace_revision:edition.workspaceRevision,record_id:record.id,logical_key:record.logicalKey,...selection,source_import_id:source.id,source_sha256:source.sha,source_label:source.label,source_line:source.source_line,organization:record.organization,station_id:record.stationId,activity_id:record.activityId,original_result_id:record.sourceResultId,sampled_date:record.sampledDate,sampled_at:record.sampledAt,source_time:record.sourceTime,time_precision:record.timePrecision,time_zone:record.timeZone,characteristic:record.characteristic,parameter:record.parameter,basis:record.basis,fraction:record.fraction,medium:record.medium,activity_type:record.activityType,method:record.method,laboratory:record.laboratory,reported_value:record.reportedValue,reported_unit:record.reportedUnit,value:record.value,lower:record.lower,upper:record.upper,censor:record.censor,normalized_unit:record.unit,detection:record.detection,detection_limits:JSON.stringify(record.detectionLimits),qualifier:record.qualifier,status:record.status,review_state:record.review.state,original_row:JSON.stringify(record.raw)});
 }
 return csv(rows,['edition_id','title','workspace_revision','record_id','logical_key','relationship_id','relationship','representative_id','disposition','reason','native_eligible','native_reasons','source_import_id','source_sha256','source_label','source_line','organization','station_id','activity_id','original_result_id','sampled_date','sampled_at','source_time','time_precision','time_zone','characteristic','parameter','basis','fraction','medium','activity_type','method','laboratory','reported_value','reported_unit','value','lower','upper','censor','normalized_unit','detection','detection_limits','qualifier','status','review_state','original_row']);
}
export function observationCalibration(edition){
 if(edition?.schema!==OBSERVATION_EDITION_SCHEMA)fail('Choose a complete observation edition');
 const disposition=new Map(edition.rows.map(r=>[r.record_id,r])),accepted=[],excluded=[];
 for(const row of edition.capture.records){
  const choice=disposition.get(row.id),base={id:row.id,stationId:row.stationId,reachId:row.mapping?.reachId||'',sampledDate:row.sampledDate,sampledAt:row.sampledAt,timePrecision:row.timePrecision,parameter:row.parameter,unit:row.unit,value:row.value,censor:row.censor,lower:row.lower,upper:row.upper,basis:row.basis,fraction:row.fraction,method:row.method,sourceResultId:row.sourceResultId,logicalKey:row.logicalKey,sourceReferences:row.sources};
  if(choice.native_eligible)accepted.push(base);else excluded.push({...base,reasons:choice.native_reasons});
 }
 const body={format:'upper-savannah-calibration-input',version:1,createdAt:edition.created_at||null,workspaceRevision:edition.workspaceRevision,filters:edition.capture.scope.filters,accepted,excluded,counts:{accepted:accepted.length,excluded:excluded.length},observationEdition:{id:edition.edition_id||null,digest:edition.digest||null,title:edition.title,source_binding:edition.source_binding,scope:edition.capture.scope},rules:{nondetectSubstitution:'none',replicateAggregation:'none',bod5ToUltimateBod:'not-performed',timeMatching:'not-performed',fractions:'preserved',nativeAnnualLoadBinding:'explicit downstream derivation required; PO4_KG/NH4_KG/NO3_KG are not concentration aliases',reviewSnapshot:'Saved original Measurements eligibility. Current native admission remains independently responsible for source and scientific compatibility.'}};
 return {...body,sha256:hash(stable(body))};
}
export function observationEditionOperation(ws,method,parts,query={},body={}){
 if(method==='GET'&&!parts.length)return observationEditionCatalogue(ws);
 if(method==='POST'&&parts.length===1&&parts[0]==='inspect')return inspectObservationEdition(ws,body);
 if(method==='POST'&&parts.length===1&&parts[0]==='preview')return previewObservationEdition(ws,body);
 if(method==='POST'&&parts.length===1&&parts[0]==='editions')return saveObservationEdition(ws,body);
 if(method==='GET'&&parts.length===1&&parts[0]==='editions')return listObservationEditions(ws);
 if(method==='GET'&&parts.length===2&&parts[0]==='editions')return readObservationEdition(ws,parts[1]);
 fail('Observation edition operation not found',404);
}

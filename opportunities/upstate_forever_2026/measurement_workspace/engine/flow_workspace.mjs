/** Original-source daily flow studies in the existing Measurements workspace.
 * The existing exports table and portable workspace own persistence.
 */
import {normaliseDailySource,buildFlowEdition,flowPeriods,reconcileFlowEditions,joinSampleDates} from './flow_editions.mjs';
import {hash,stable} from './normalise.mjs';
import {InputError,clean,parseCSV,csv} from './parse.mjs';
const FORMAT='upstate.daily-flow-study/v1';
const INPUT='upstate.daily-flow-study-input/v1';
const KIND='daily-flow-study';
const decode=value=>typeof value==='string'?JSON.parse(value):value;
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(message){throw new InputError(message);}
function sourceList(workspace,input){
 const sources=[];
 for(const importId of input.import_ids||[]){
  const retained=workspace.source(importId);
  if(retained.kind!=='usgs-daily')fail('Select a retained daily-discharge import');
  const origin=decode(retained.origin)||{};
  const pages=origin.pages?.length?origin.pages:[{text:retained.content,sha:retained.sha,url:origin.url||'retained-import:'+importId}];
  for(let index=0;index<pages.length;index++){
   const page=pages[index];if(hash(page.text)!==page.sha)fail('The original retained discharge page changed');
   sources.push({id:importId+':'+index,format:'usgs-ogc-daily',text:page.text,sha256:page.sha,uri:page.url,import_id:importId});
  }
 }
 for(const incoming of input.sources||[]){
  if(typeof incoming.text!=='string')fail('Supply complete original daily response text');
  const sha256=hash(incoming.text);
  if(incoming.sha256!==undefined&&incoming.sha256!==sha256)fail('Original daily response checksum differs');
  const body=decode(incoming.text);
  const format=incoming.format||(body?.value?.timeSeries?'nwis-waterml-json':body?.type==='FeatureCollection'?'usgs-ogc-daily':null);
  const uri=clean(incoming.uri)||body?.value?.queryInfo?.queryURL?.replaceAll('&amp;','&');
  if(!uri)fail('Retain the original source URI');
  sources.push({id:clean(incoming.id)||sha256,format,text:incoming.text,sha256,uri,import_id:incoming.import_id||null});
 }
 if(!sources.length)fail('Select original daily response files or retained discharge imports');
 if(new Set(sources.map(s=>s.id)).size!==sources.length)fail('Choose each original daily source once');
 return sources;
}
export function inspectFlowSources(workspace,input){
 const sources=sourceList(workspace,input),groups=new Map(),excluded=[];
 for(const source of sources){
  const value=normaliseDailySource({...source,body:source.text,edition_id:'inspection'});
  excluded.push(...value.excluded);
  for(const row of value.rows){
   const key=row.monitoring_location_id+'|'+row.time_series_id;
   const g=groups.get(key)||{monitoring_location_id:row.monitoring_location_id,time_series_id:row.time_series_id,start:row.date,end:row.date,rows:0,source_ids:[],units:[]};
   g.start=g.start<row.date?g.start:row.date;g.end=g.end>row.date?g.end:row.date;g.rows++;
   if(!g.source_ids.includes(row.source_id))g.source_ids.push(row.source_id);
   if(!g.units.includes(row.source_unit))g.units.push(row.source_unit);
   groups.set(key,g);
  }
 }
 return {sources:sources.map(({text,...s})=>s),series:[...groups.values()],excluded};
}
function samplesFor(workspace,input){
 const samples=clone(input.samples||[]),sample_sources=clone(input.sample_sources||[]);
 for(const source of sample_sources){
  if(typeof source.text!=='string'||hash(source.text)!==source.sha256)fail('Original sampling source checksum differs');
  if(source.format==='nutrient-results-csv'){
   const parsed=parseCSV(source.text);if(parsed.rejected.length)fail('Resolve malformed sampling CSV rows');
   for(const row of parsed.rows)samples.push({...row.raw,sample_id:source.sha256+':'+row.line,sample_source_id:source.id,sample_source_sha256:source.sha256,sample_source_line:row.line});
  }else if(source.format!=='companion')fail('Choose nutrient-results-csv or companion for sampling sources');
 }
 const chemistry=input.chemistry;
 if(chemistry){
  if(!Array.isArray(chemistry.station_ids)||!chemistry.station_ids.length)fail('Select chemistry stations explicitly');
  const seen=new Set();
  for(const stationId of chemistry.station_ids){
   for(const row of workspace.iterate({stationId,from:input.start,to:input.end,...(chemistry.parameter?{parameter:chemistry.parameter}:{})})){
    if(row.sourceKind==='usgs-daily'||seen.has(row.id))continue;
    seen.add(row.id);samples.push({...row,sourceReferences:workspace.recordSources(row.id)});
   }
  }
 }
 return {samples,sample_sources};
}
function prepare(workspace,input){
 if(input?.schema&&input.schema!==INPUT)fail('Select a daily-flow study input');
 const title=clean(input.title);if(!title)fail('Name the new flow study');
 const sources=sourceList(workspace,input),sampled=samplesFor(workspace,input);
 const normalized={schema:INPUT,title,start:input.start,end:input.end,series_by_station:clone(input.series_by_station||{}),sources,
  samples:sampled.samples,sample_sources:sampled.sample_sources,relations:clone(input.relations||[]),notes:clean(input.notes)};
 // Do not reparse already expanded sample_sources on a portable receive.
 normalized.sample_sources=normalized.sample_sources.map(source=>({...source,format:'companion',original_format:source.original_format||source.format}));
 const id=hash(stable(normalized));
 const edition=buildFlowEdition({id,title,sources:sources.map(s=>({...s,edition_id:id,body:s.text})),start:input.start,end:input.end,series_by_station:normalized.series_by_station});
 const periods=flowPeriods(edition),sample_context=joinSampleDates(edition,normalized.samples,normalized.relations);
 return {schema:FORMAT,id,input:normalized,edition,periods,sample_context,interpretation:{
  flow:'Original agency daily mean discharge; original calendar dates and qualifiers retained.',
  volume:'Daily mean m3/s times 86400 seconds. Missing, ambiguous and unquantified days contribute no invented volume.',
  sample_pairing:'Discrete sampling-day context. Spatial relationship and temporal support remain explicit.',
  period:'Complete-calendar periods are separate from complete selected subperiods.'}};
}
export function previewFlowStudy(workspace,input){return workspace.readConsistent(()=>prepare(workspace,input));}
function save(workspace,study){
 const existing=workspace.db.prepare('SELECT content,kind FROM exports WHERE id=?').get(study.id);
 if(existing){if(existing.kind!==KIND||stable(JSON.parse(existing.content))!==stable(study))throw new InputError('Retained flow study identity differs',409);return {id:study.id,duplicate:true,study};}
 workspace.atomic(()=>{
  workspace.db.prepare('INSERT INTO exports(id,created_at,revision,kind,content) VALUES(?,?,?,?,?)').run(study.id,new Date().toISOString(),workspace.revision(),KIND,JSON.stringify(study));
  workspace.event('flow-study',study.id,{title:study.input.title,sources:study.input.sources.length,rows:study.edition.rows.length});
 });
 return {id:study.id,duplicate:false,study};
}
export function saveFlowStudy(workspace,input){const study=previewFlowStudy(workspace,input);if(input.expected_id&&input.expected_id!==study.id)throw new InputError('Flow source selection changed; inspect this edition again',409);return save(workspace,study);}
export function receiveFlowStudy(workspace,document){
 if(document?.schema!==FORMAT)fail('Choose the complete original daily-flow study');
 const rebuilt=previewFlowStudy(workspace,document.input);
 if(stable(rebuilt)!==stable(document))fail('Flow study differs from its complete original-source calculation');
 return save(workspace,rebuilt);
}
export function readFlowStudy(workspace,id){
 const row=workspace.db.prepare('SELECT content FROM exports WHERE id=? AND kind=?').get(id,KIND);
 if(!row)throw new InputError('Saved flow study not found',404);
 const value=JSON.parse(row.content);
 if(value.id!==id||hash(stable(value.input))!==id)throw new InputError('Saved original flow selection changed',409);
 return value;
}
export function flowCatalogue(workspace){
 return workspace.readConsistent(()=>({
  imports:workspace.db.prepare("SELECT id,label,sha,created_at,summary FROM imports WHERE kind='usgs-daily' ORDER BY created_at DESC").all().map(r=>({...r,summary:JSON.parse(r.summary)})),
  studies:workspace.db.prepare('SELECT id,created_at,content FROM exports WHERE kind=? ORDER BY created_at DESC').all(KIND).map(r=>{const v=JSON.parse(r.content);return{id:r.id,created_at:r.created_at,title:v.input.title,start:v.input.start,end:v.input.end,summary:v.edition.summary,samples:v.sample_context.counts};}),
  workspaceRevision:workspace.revision()
 }));
}
export function compareFlowStudies(workspace,input){
 const before=readFlowStudy(workspace,input.before_id),after=readFlowStudy(workspace,input.after_id);
 return {schema:'upstate.daily-flow-study-comparison/v1',before_id:before.id,after_id:after.id,
  comparison:reconcileFlowEditions(before.edition,after.edition),
  periods_before:before.periods,periods_after:after.periods,
  sample_context_before:before.sample_context,sample_context_after:after.sample_context};
}
export function flowCSV(study,kind='daily'){
 if(kind==='periods')return csv(study.periods,['monitoring_location_id','period_kind','period','calendar_start','calendar_end','calendar_days','start','end','expected_days','quantified_days','missing_days','ambiguous_days','unquantified_days','approved_days','provisional_days','qualified_days','complete_calendar_period','known_volume_m3','mean_discharge_m3_s']);
 if(kind==='samples')return csv(study.sample_context.rows.map(r=>({...r,discharge_m3_s:r.flow?.discharge_m3_s,approval_status:r.flow?.approval_status,source_id:r.flow?.source_id,source_sha256:r.flow?.source_sha256,source_pointer:r.flow?.source_pointer})),['sample_id','station_id','date','gauge_id','gauge_relation','flow_location_role','relationship_source','flow_status','annual_mass_spatial_support','discharge_m3_s','approval_status','source_id','source_sha256','source_pointer','sample']);
 if(kind!=='daily')fail('Choose daily, periods or samples CSV');
 return csv(study.edition.rows.map(r=>({...r,...r.flow,flow_status:r.status,selected_date:r.date,candidates:r.candidates})),['monitoring_location_id','selected_date','flow_status','discharge_m3_s','source_value','source_unit','approval_status','qualifier','time_series_id','source_id','source_sha256','source_uri','source_pointer','source_time','source_time_zone','candidates']);
}
export async function flowOperation(workspace,method,parts,input={}){
 if(method==='GET'&&parts[0]==='catalogue')return flowCatalogue(workspace);
 if(method==='GET'&&parts[0]==='studies'&&parts.length===2)return readFlowStudy(workspace,parts[1]);
 if(method==='POST'&&parts.length===1){
  if(parts[0]==='inspect')return inspectFlowSources(workspace,input);
  if(parts[0]==='preview')return previewFlowStudy(workspace,input);
  if(parts[0]==='save')return saveFlowStudy(workspace,input);
  if(parts[0]==='receive')return receiveFlowStudy(workspace,input);
  if(parts[0]==='compare')return compareFlowStudies(workspace,input);
 }
 throw new InputError('Flow-study operation not found',404);
}

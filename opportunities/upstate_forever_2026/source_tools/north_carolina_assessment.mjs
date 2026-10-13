#!/usr/bin/env node
/**
 * NCDEQ final 2022 integrated assessment, original ArcGIS response adapter.
 * Original attributes, geometries, parameter rows and sampling stations are
 * retained separately. Counts are assessment-unit and feature counts, not
 * invented station counts. No legal category or HUC is inferred from a name.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const REQUIRED_GROUPS = ['streamlines','polygons','parameters'];
const METHOD = {
  edition: '2022', publication_status: 'final',
  primary_window: {start: '2016-01-01', end: '2020-12-31'},
  newer_data_years: [2019,2020],
  older_data: 'Prior assessments carry forward when newer data do not change the decision. The methodology permits 2011–2015 data to augment current sets with fewer than ten samples.',
  basis: 'Published assessment-unit and parameter determinations; original sampling records are retained separately.',
  url: 'https://www.deq.nc.gov/water-quality/planning/tmdl/303d/2022/2022-303d-listing-methodology-final/download'
};
function fail(message) { throw new Error(message); }
function id(value, label) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return String(BigInt(value));
  fail(label + ': expected an original integer identifier');
}
function attrs(feature, label) {
  if (!feature || !feature.attributes || typeof feature.attributes !== 'object')
    fail(label + ': missing original ArcGIS attributes');
  return feature.attributes;
}
function required(value, label) {
  if (value === undefined || value === null || value === '') fail(label + ': missing original field');
  return value;
}
function equalSet(actual, expected, label) {
  if (actual.size !== expected.size || [...actual].some(x => !expected.has(x)))
    fail(label + ': returned feature IDs do not equal the original ID inventory');
}
function counts(values) {
  const result = {};
  for (const v of values) { const key = v === null || v === undefined || v === '' ? '(not supplied)' : String(v); result[key] = (result[key] || 0) + 1; }
  return Object.fromEntries(Object.entries(result).sort((a,b)=>a[0].localeCompare(b[0])));
}
function sourceText(files, filename) {
  const text = files[filename]; if (typeof text !== 'string') fail('Missing complete source file: ' + filename);
  return text;
}
function parse(files, filename) {
  const doc = JSON.parse(sourceText(files, filename)); if (doc.error) fail(filename + ': source API error ' + JSON.stringify(doc.error)); return doc;
}
function readGroup(files, config, name, sha256) {
  const group = config.groups[name]; if (!group) return null;
  if (!Array.isArray(group.pages) || !group.pages.length) fail(name + ': source pages required');
  const inventory = parse(files, group.ids_path), countDoc = parse(files, group.count_path);
  if (!Array.isArray(inventory.objectIds) || !Number.isSafeInteger(countDoc.count)) fail(name + ': original count/ID inventory required');
  const field = inventory.objectIdFieldName || group.object_id_field;
  required(field, name + '.objectIdFieldName');
  const expected = new Set(inventory.objectIds.map(x=>id(x,name+' object ID')));
  if (expected.size !== inventory.objectIds.length || expected.size !== countDoc.count) fail(name + ': count/ID inventory mismatch');
  const metadata = parse(files,group.metadata_path);
  const rows = [], seen = new Set();
  for (const filename of group.pages) {
    const doc = parse(files, filename), originalSha = sha256(sourceText(files,filename));
    if (!Array.isArray(doc.features)) fail(filename + ': missing features');
    if (doc.exceededTransferLimit === true) fail(filename + ': incomplete response; capture the remaining original page');
    for (let index=0;index<doc.features.length;index++) {
      const feature = doc.features[index], a = attrs(feature, filename), oid = id(a[field],filename+' '+field);
      if (seen.has(oid)) fail(name + ': repeated original feature ID ' + oid);
      seen.add(oid);
      rows.push({feature,attributes:a,oid,locator:{path:'original/'+filename,capture_path:filename,sha256:originalSha,json_pointer:'/features/'+index,object_id_field:field,object_id:oid,layer_id:group.layer_id,uri:group.page_uris?.[filename] || null},spatial_reference:doc.spatialReference || metadata.extent?.spatialReference || metadata.sourceSpatialReference || null});
    }
  }
  equalSet(seen,expected,name);
  return {rows,metadata,count:countDoc.count,object_id_field:field,source_selection:group.where || null};
}
export function normalizeNorthCarolina(files,config,sha256) {
  if (!config || config.schema !== 'upstate.nc-assessment-inputs/v1') fail('Expected explicit original-file bindings');
  if (typeof sha256 !== 'function') fail('Provide a SHA256 function over original UTF-8 source');
  for (const key of REQUIRED_GROUPS) if (!config.groups?.[key]) fail('Missing source group: '+key);
  const groups = Object.fromEntries(Object.keys(config.groups).map(name=>[name,readGroup(files,config,name,sha256)]));
  const units = new Map(), features = [];
  for (const name of ['streamlines','polygons']) for (const row of groups[name].rows) {
    const a=row.attributes, au=id(a.AU_ID,name+'.AU_ID');
    required(a.AU_Number,name+'.AU_Number');
    const geometry = row.feature.geometry; if (!geometry) fail(name+': missing original geometry for '+row.oid);
    const expected = name==='streamlines'?'paths':'rings';
    if (!Array.isArray(geometry[expected]) || !geometry[expected].length) fail(name+': missing original '+expected);
    let unit=units.get(au);
    if (!unit) {
      unit={native_reach_id:au,jurisdiction:'NC',cycle:'2022',publication_status:'final',native_unit_number:String(a.AU_Number),names:[],descriptions:[],publisher_huc8s:[],overall_assessments_raw:[],feature_ids:[],parameter_record_ids:[],assessed_parameters:[],categories:[],criteria_statuses:[],station_record_ids:[],geometry_huc12s:[]};
      units.set(au,unit);
    }
    if(unit.native_unit_number!==String(a.AU_Number)) fail('AU_ID '+au+' has conflicting published AU_Number values');
    const push=(key,v)=>{if(v!==null&&v!==undefined&&v!==''&&!unit[key].includes(v))unit[key].push(v);};
    push('names',a.AU_Name);push('descriptions',a.AU_Desc);push('overall_assessments_raw',a.IR2022);
    if(a.HUC8!==null&&a.HUC8!==undefined&&a.HUC8!=='') {
      const huc=id(a.HUC8,'HUC8').padStart(8,'0');if(!/^\d{8}$/.test(huc))fail('Invalid original HUC8');push('publisher_huc8s',huc);
    }
    const featureId=name+':'+row.oid;unit.feature_ids.push(featureId);
    features.push({id:featureId,native_reach_id:au,geometry_type:name==='streamlines'?'polyline':'polygon',source_locator:row.locator,geometry_locator:{...row.locator,json_pointer:row.locator.json_pointer+'/geometry'},spatial_reference:row.spatial_reference,attributes:a});
  }
  const parameterRecords=groups.parameters.rows.map(row=>{
    const a=row.attributes,au=id(a.AU_ID,'parameter.AU_ID');
    if(!units.has(au))fail('Parameter row '+row.oid+' refers to unselected AU_ID '+au);
    if(!/^\d{4}$/.test(String(a.CYCLE)))fail('Parameter row '+row.oid+' lacks a valid original assessment cycle');
    const record={id:'nc-2022-parameter:'+row.oid,native_reach_id:au,native_assessment_id:a.ASMT_ID,assessment_cycle_raw:a.CYCLE,parameter_raw:a.PARAMETER,category_raw:a.IR_CATEGORY,criteria_status_raw:a.ASMNT_CRITERIA_STATUS,reason_raw:a.REASON_FOR_RATING,assessment_date_raw:a.ASMNT_DATE,assessment_status_raw:a.ASMNT_STATUS,collection_year_raw:a.COLLECTION_YEAR,method_code_raw:a.F2022_asmnt_meth_code,first_303d_year_raw:a.F303_D_YEAR,delete_field_raw:a.DELETE_,source_locator:row.locator,raw:a};
    const unit=units.get(au);unit.parameter_record_ids.push(record.id);
    if(a.PARAMETER!==null&&a.PARAMETER!==undefined&&!unit.assessed_parameters.includes(a.PARAMETER))unit.assessed_parameters.push(a.PARAMETER);
    if(a.IR_CATEGORY!==null&&a.IR_CATEGORY!==undefined&&!unit.categories.some(c=>c.code===a.IR_CATEGORY))unit.categories.push({code:a.IR_CATEGORY});
    if(a.ASMNT_CRITERIA_STATUS!==null&&a.ASMNT_CRITERIA_STATUS!==undefined&&!unit.criteria_statuses.includes(a.ASMNT_CRITERIA_STATUS))unit.criteria_statuses.push(a.ASMNT_CRITERIA_STATUS);
    return record;
  });
  const stations=(groups.stations?.rows || []).map(row=>{
    const a=row.attributes,au=a.AU_ID===null||a.AU_ID===undefined?null:id(a.AU_ID,'station.AU_ID');
    const record={id:'nc-2022-station-feature:'+row.oid,native_station_id:a.station,agency:a.AGENCY,native_reach_id:au,matched_assessment_unit:units.has(au),data_type_raw:a.Data_Type,publisher_huc8_raw:a.HUC8,source_locator:row.locator,spatial_reference:row.spatial_reference,geometry:row.feature.geometry??null,raw:a};
    if(units.has(au))units.get(au).station_record_ids.push(record.id);return record;
  });
  const sourceFiles=Object.keys(files).sort().map(filename=>({path:'original/'+filename,capture_path:filename,sha256:sha256(files[filename]),uri:config.source_uris?.[filename] || null}));
  const assessment_units=[...units.values()].sort((a,b)=>Number(a.native_reach_id)-Number(b.native_reach_id));
  return {schema:'upstate.nc-integrated-assessment/v1',title:'North Carolina final 2022 Upper Savannah waterbody assessments',jurisdiction:'NC',edition:'2022',publication_status:'final',captured_at:config.captured_at,source:{assessment_cycle:'2022',publication_status:'final',uri:config.service_uri,captured_at:config.captured_at},method:METHOD,selection:{basis:'Original publisher HUC8 selection before exact domain-geometry intersection',groups:Object.fromEntries(Object.entries(groups).map(([key,g])=>[key,{where:g.source_selection,feature_count:g.count}]))},summary:{assessment_unit_count:units.size,stream_feature_count:groups.streamlines.count,polygon_feature_count:groups.polygons.count,parameter_record_count:parameterRecords.length,station_feature_count:stations.length,station_id_count:new Set(stations.map(s=>s.native_station_id).filter(x=>x!==null&&x!==undefined&&x!=='')).size,agency_qualified_station_id_count:new Set(stations.filter(s=>s.native_station_id!==null&&s.native_station_id!==undefined&&s.native_station_id!=='').map(s=>JSON.stringify([s.agency??null,s.native_station_id]))).size,units_without_parameter_rows:assessment_units.filter(u=>!u.parameter_record_ids.length).map(u=>u.native_reach_id),unit_overall_assessments:counts(assessment_units.map(u=>u.overall_assessments_raw.length===1?u.overall_assessments_raw[0]:JSON.stringify(u.overall_assessments_raw))),parameter_assessment_statuses:counts(parameterRecords.map(r=>r.assessment_status_raw)),parameter_cycles:counts(parameterRecords.map(r=>r.assessment_cycle_raw)),parameter_categories:counts(parameterRecords.map(r=>r.category_raw)),criteria_statuses:counts(parameterRecords.map(r=>r.criteria_status_raw)),parameters:counts(parameterRecords.map(r=>r.parameter_raw))},source_files:sourceFiles,assessment_units,parameter_records:parameterRecords,station_records:stations,source_features:features};
}
export function attachNorthCarolinaGeography(bank,relations,domainHucs) {
  if(bank.schema!=='upstate.nc-integrated-assessment/v1')fail('Wrong assessment schema');
  const allowed=new Set(domainHucs.map(String)),byUnit=new Map(bank.assessment_units.map(x=>[x.native_reach_id,new Set()]));
  for(const r of relations) {
    const au=id(r.native_reach_id,'geometry relation AU_ID');
    if(!byUnit.has(au))fail('Geometry relation refers to unknown AU_ID '+au);
    if(!allowed.has(r.huc12))fail('Geometry relation outside original domain inventory');
    if(['positive_length','positive_area'].includes(r.relation))byUnit.get(au).add(r.huc12);
  }
  const units=bank.assessment_units.map(u=>({...u,geometry_huc12s:[...byUnit.get(u.native_reach_id)].sort(),intersects_model_domain:byUnit.get(u.native_reach_id).size>0}));
  const inDomain=new Set(units.filter(u=>u.intersects_model_domain).map(u=>u.native_reach_id));
  return {...bank,assessment_units:units,geometry_relations:relations,summary:{...bank.summary,domain_huc_count:allowed.size,intersecting_assessment_unit_count:inDomain.size,intersecting_parameter_record_count:bank.parameter_records.filter(r=>inDomain.has(r.native_reach_id)).length,intersected_huc12_count:new Set(units.flatMap(u=>u.geometry_huc12s)).size},geography_basis:'Original assessment reach and lake geometries intersect original model HUC polygons with positive length or area; boundary-only contacts remain explicit relations.'};
}
export function northCarolinaReportSection(bank) {
  const s=bank.summary, byUnit=new Map(bank.assessment_units.map(u=>[u.native_reach_id,u]));
  const blocks=[
    'The final 2022 publisher selection contains '+s.assessment_unit_count+' assessment units represented by '+s.stream_feature_count+' stream features and '+s.polygon_feature_count+' polygon features, with '+s.parameter_record_count+' parameter records. Sampling-station counts ('+s.station_feature_count+' features) describe the selected records in this assessment service.',
    'The assessment methodology uses a 2016–2020 primary data window, with explicit older-data and carried-forward determinations. Each original assessment cycle, parameter, category, reason, assessment date and collection-year field remains available. The 2022 publication preserves any carried-forward rows from earlier assessment cycles.',
    bank.geography_basis || 'This is the original publisher headwater selection; model-domain membership is added by the original reach geometry intersection.',
    {kind:'table',columns:['Publisher overall unit assessment','Assessment units'],rows:Object.entries(s.unit_overall_assessments).map(([k,v])=>[k,String(v)]),widths:[3,1]},
    {kind:'table',columns:['Original row approval status','Parameter records'],rows:Object.entries(s.parameter_assessment_statuses).map(([k,v])=>[k,String(v)]),widths:[3,1]},
    'Final 2022 identifies the published service edition. The original row approval status and assessment cycle are preserved independently, including draft-status or earlier-cycle records within that edition.',
    {kind:'table',columns:['Original row cycle','Parameter records'],rows:Object.entries(s.parameter_cycles).map(([k,v])=>[k,String(v)]),widths:[3,1]},
    {kind:'table',columns:['Original category','Parameter records'],rows:Object.entries(s.parameter_categories).map(([k,v])=>[k,String(v)]),widths:[3,1]},
    {kind:'table',columns:['Publisher criteria status','Parameter records'],rows:Object.entries(s.criteria_statuses).map(([k,v])=>[k,String(v)]),widths:[3,1]},
    'The following table preserves each published parameter determination. An overall waterbody label does not replace the individual constituent and designated-use assessment.',
    {kind:'table',columns:['Assessment unit','Waterbody','Parameter','Category','Criteria status','Collection year'],rows:bank.parameter_records.map(r=>{const u=byUnit.get(r.native_reach_id);return [u.native_unit_number,u.names.join('; '),r.parameter_raw??'',r.category_raw??'',r.criteria_status_raw??'',r.collection_year_raw??''].map(String);}),widths:[1.1,2.1,2.2,.7,1.5,1]},
    'Original NCDEQ methodology: '+METHOD.url
  ];
  if(s.intersecting_assessment_unit_count!==undefined) blocks.splice(3,0,'Exact original reach/lake intersections place '+s.intersecting_assessment_unit_count+' assessment units and '+s.intersecting_parameter_record_count+' parameter records in '+s.intersected_huc12_count+' of the '+s.domain_huc_count+' model watersheds. Boundary-only contacts are retained separately.');
  return ['North Carolina waterbody assessments',blocks];
}
export function createNorthCarolinaDelivery(bank,files,config,identify) {
  const output={};
  const write=(filename,value,plain=false)=>{const text=plain?value:JSON.stringify(value,null,2)+'\n';output[filename]=text;const identity=identify(text);return {path:filename,bytes:identity.bytes,sha256:identity.sha256};};
  const assessment=write('assessments.json',bank),section=write('report-section.json',northCarolinaReportSection(bank));
  const companions=[];
  for(const [filename,text]of Object.entries(files)){
    if(filename.startsWith('/')||/^[A-Za-z]:/.test(filename)||filename.split(/[\\/]/).includes('..'))fail('Original companion path escapes output');
    companions.push(write('original/'+filename,text,true));
  }
  companions.push(write('input-configuration.json',config));
  const inputs=[assessment,section,...companions];
  const report=write('observed-report.json',{schema:'upstate.observed-report/v1',title:bank.title,edition:'nc-final-2022-'+String(config.captured_at||'retained').slice(0,10),vintage:'2022',interpretation_kind:'published_assessment_context',inputs,sections:[northCarolinaReportSection(bank)],source_links:inputs.map(item=>item.path)});
  write('sources.json',{schema:'upstate.sources/v1',title:bank.title,captured_at:config.captured_at,entries:[
    {id:'ncdeq-final-2022-savannah-assessment-context',title:bank.title,kind:'table',role:'WATER_QUALITY_ASSESSMENT_CONTEXT',format:'json',...assessment,uri:config.service_uri,vintage:'2022',publication_status:'final',companions:[...companions,section]},
    {id:'ncdeq-final-2022-savannah-scientific-report',title:'North Carolina final 2022 waterbody assessment report',kind:'document',role:'OBSERVED_CONTEXT',...report,uri:config.service_uri,vintage:'2022',publication_status:'final',metadata:{related_source_ids:['ncdeq-final-2022-savannah-assessment-context']},companions:inputs}
  ]});
  return output;
}

function sha(text){return crypto.createHash('sha256').update(text,'utf8').digest('hex');}
function args(argv){const r={};for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith('--')||!argv[i+1])fail('Expected --name value');r[argv[i].slice(2)]=argv[i+1];}return r;}
export function main(argv=process.argv.slice(2)){
  const options=args(argv),configurationPath=path.resolve(required(options.configuration,'--configuration')),config=JSON.parse(fs.readFileSync(configurationPath,'utf8'));
  const inputRoot=path.resolve(options.input||path.dirname(configurationPath)),output=path.resolve(required(options.output,'--output'));
  const sourcePaths=new Set();
  for(const g of Object.values(config.groups)){for(const p of [...g.pages,g.ids_path,g.count_path,g.metadata_path])sourcePaths.add(p);}
  for(const p of config.additional_source_paths||[])sourcePaths.add(p);
  const files={};for(const filename of sourcePaths){const full=path.resolve(inputRoot,filename);if(full!==inputRoot&&!full.startsWith(inputRoot+path.sep))fail('Source path escapes input root');files[filename]=fs.readFileSync(full,'utf8');}
  let bank=normalizeNorthCarolina(files,config,sha);
  if(options.relations||options['domain-hucs']){
    if(!options.relations||!options['domain-hucs'])fail('Both --relations and --domain-hucs required');
    const data=JSON.parse(fs.readFileSync(options.relations,'utf8')),hucs=JSON.parse(fs.readFileSync(options['domain-hucs'],'utf8'));
    bank=attachNorthCarolinaGeography(bank,Array.isArray(data)?data:data.relations,Array.isArray(hucs)?hucs:hucs.huc12s);
  }
  const delivery=createNorthCarolinaDelivery(bank,files,config,text=>({bytes:Buffer.byteLength(text,'utf8'),sha256:sha(text)}));
  for(const [filename,text]of Object.entries(delivery)){const full=path.resolve(output,filename);if(!full.startsWith(output+path.sep))fail('Delivery path escapes output');fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,text);}
  process.stdout.write(JSON.stringify({output,summary:bank.summary})+'\n');
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();

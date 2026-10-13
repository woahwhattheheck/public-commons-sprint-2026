#!/usr/bin/env node
/** Prepare one captured official WQP edition for the maintained Measurements collection API. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {parseCSV,day} from '../measurement_workspace/engine/parse.mjs';
import {parseSource,WQP_DETECTION_EDITION} from '../measurement_workspace/engine/normalise.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,message)=>{if(!value)throw Error(message);};
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const csv=(headers,rows)=>Buffer.from([headers,...rows.map(row=>headers.map(h=>row[h]))].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n');
const roles=['Station','Activity','Result','ResultDetectionQuantitationLimit'];
const get=(row,...names)=>{for(const name of names)if(Object.hasOwn(row,name))return row[name];return '';};
const org=row=>get(row,'OrganizationIdentifier','Organization_Identifier');
const station=row=>get(row,'MonitoringLocationIdentifier','Location_Identifier');
const activity=row=>get(row,'ActivityIdentifier','Activity_Identifier');
const result=row=>get(row,'ResultIdentifier','Result_Identifier');
const key=(organization,id)=>JSON.stringify([organization,id]);
const identity=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
function read(root,name,descriptor){
  need(typeof name==='string'&&name&&!path.isAbsolute(name)&&!name.includes('\\')&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Use a retained relative source path');
  const filename=path.join(root,name),parent=path.dirname(filename);
  need(fs.realpathSync(parent)===parent,'Source parent must be an ordinary directory');
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const before=fs.fstatSync(fd);need(before.isFile()&&before.size<=128*1024*1024,'Select a bounded regular original source');
    const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
    need(identity(before)===identity(after)&&identity(after)===identity(fs.lstatSync(filename)),'Source changed while reading');
    if(descriptor)need(bytes.length===descriptor.bytes&&sha(bytes)===descriptor.sha256,'Original source differs: '+name);
    return bytes;
  }finally{fs.closeSync(fd);}
}
const decode=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
function parse(bytes,label){
  const data=parseCSV(decode(bytes));
  need(!data.rejected.length,'Original '+label+' CSV has malformed rows');
  return {headers:data.headers,rows:data.rows.map(x=>x.raw)};
}
function unique(rows,field,label){
  const values=new Map();
  for(const row of rows){const id=field(row);need(id&&!values.has(id),'Original '+label+' identities are missing or repeated');values.set(id,row);}
  return values;
}
export function prepareWqpCollection({capture,captureBytes,queryBytes,files}) {
  need(capture?.schema==='upstate.wqp-source-capture/v1'&&capture.state==='complete','Select a complete original WQP capture');
  const query=capture.query,from=day(query.from),to=day(query.to);
  need(from<=to&&typeof query.station_id==='string'&&query.station_id,'Retain the captured station and original dates');
  need(JSON.stringify(JSON.parse(decode(queryBytes)))===JSON.stringify(query),'Captured query differs from its original body');
  need(Array.isArray(capture.files)&&capture.files.length===roles.length,'Retain all four original profiles');
  const tables={},descriptors={},originals={};
  for(const role of roles){
    const matches=capture.files.filter(x=>x.kind===role);need(matches.length===1,'Missing or repeated original profile: '+role);
    const descriptor=matches[0],bytes=files[role];
    need(bytes&&bytes.length===descriptor.bytes&&sha(bytes)===descriptor.sha256,'Original profile identity differs: '+role);
    const data=parse(bytes,role);
    need(data.rows.length===descriptor.rows&&JSON.stringify(data.headers)===JSON.stringify(descriptor.columns),'Original profile accounting differs: '+role);
    tables[role]=data;descriptors[role]=descriptor;originals[role]=bytes;
  }
  for(const row of tables.Station.rows)need(org(row)&&station(row),'Station lacks original organization/site identity');
  for(const row of tables.Activity.rows)need(org(row)&&activity(row),'Activity lacks original organization/activity identity');
  const stations=unique(tables.Station.rows,row=>key(org(row),station(row)),'station');
  need(stations.size>0&&tables.Result.rows.length>0,'No actual result edition is available in this completed capture');
  for(const row of tables.Station.rows)need(station(row)===query.station_id,'Station response lies outside the requested original site');
  const activities=unique(tables.Activity.rows,row=>key(org(row),activity(row)),'activity');
  const resultKeys=new Set(),limits=new Map(),joinedCounts={};
  for(let index=0;index<tables.ResultDetectionQuantitationLimit.rows.length;index++){
    const row=tables.ResultDetectionQuantitationLimit.rows[index],id=result(row);
    need(org(row)&&id,'Complete detection-limit profile lacks original organization/result identifiers');
    const k=key(org(row),id),item={
      sourceProfileRecord:index+1,organization:org(row),resultId:id,
      type:get(row,'DetectionQuantitationLimitTypeName','DetectionLimit_Type'),
      value:get(row,'DetectionQuantitationLimitMeasure/MeasureValue','DetectionQuantitationLimitMeasure.MeasureValue','DetectionLimit_Measure'),
      unit:get(row,'DetectionQuantitationLimitMeasure/MeasureUnitCode','DetectionQuantitationLimitMeasure.MeasureUnitCode','DetectionLimit_MeasureUnit'),
      raw:row,
    };
    if(!limits.has(k))limits.set(k,[]);
    limits.get(k).push(item);
  }
  const joinedColumns=['WQPDetectionLimitsJSON','WQPMonitoringLocationIdentifier','WQPActivityStartDate','WQPActivityStartTime','WQPActivityStartTimeZone','WQPActivityMediaName','WQPActivityTypeCode'];
  need(!joinedColumns.some(name=>tables.Result.headers.includes(name)),'Original result source already contains a reserved joined-source column');
  const enriched=tables.Result.rows.map(row=>{
    need(org(row)&&result(row)&&activity(row),'Result lacks its original organization/result/activity identity');
    const k=key(org(row),result(row)),a=activities.get(key(org(row),activity(row)));
    need(a&&station(a)===query.station_id&&stations.has(key(org(row),station(a))),'Result has no exact original activity/station join');
    need(!station(row)||station(row)===station(a),'Result and original activity site identifiers differ');
    const date=day(get(a,'ActivityStartDate','Activity_StartDate'));
    need(date>=from&&date<=to,'Result falls outside the captured source date range');
    for(const names of [['ActivityStartDate','Activity_StartDate'],['ActivityStartTime/Time','Activity_StartTime'],['ActivityStartTime/TimeZoneCode','Activity_StartTimeZone']]){
      const r=get(row,...names),v=get(a,...names);need(!r||r===v,'Result and original activity collection clocks differ');
    }
    resultKeys.add(k);
    const originalLimits=limits.get(k);
    joinedCounts[originalLimits?.length||0]=(joinedCounts[originalLimits?.length||0]||0)+1;
    // An empty cell retains an original inline limit when the full profile has no
    // row for this result; coverage states that separately. Never invent a limit.
    return {...row,WQPDetectionLimitsJSON:originalLimits?JSON.stringify(originalLimits):'',
      WQPMonitoringLocationIdentifier:station(a),
      WQPActivityStartDate:get(a,'ActivityStartDate','Activity_StartDate'),
      WQPActivityStartTime:get(a,'ActivityStartTime/Time','Activity_StartTime'),
      WQPActivityStartTimeZone:get(a,'ActivityStartTime/TimeZoneCode','Activity_StartTimeZone'),
      WQPActivityMediaName:get(a,'ActivityMediaName','Activity_MediaName','Activity_Media'),
      WQPActivityTypeCode:get(a,'ActivityTypeCode','Activity_Type')};
  });
  for(const k of limits.keys())need(resultKeys.has(k),'A complete limit profile row has no original result in this capture');
  const mapping={_wqp_detection:WQP_DETECTION_EDITION,station:'WQPMonitoringLocationIdentifier',date:'WQPActivityStartDate',time:'WQPActivityStartTime',zone:'WQPActivityStartTimeZone',medium:'WQPActivityMediaName',activityType:'WQPActivityTypeCode'};
  const derived=csv([...tables.Result.headers,...joinedColumns],enriched);
  const parsed=parseSource({kind:'wqp',text:decode(derived),mapping});
  need(parsed.rows.length===enriched.length&&!parsed.rejected.length,'The current native normalizer cannot retain every source row; inspect its explicit rejections before receiving');
  const issues={},conditions={},parameters={};
  for(const {row} of parsed.rows){for(const issue of row.issues)issues[issue]=(issues[issue]||0)+1;conditions[row.detection||'(blank)']=(conditions[row.detection||'(blank)']||0)+1;parameters[row.parameter]=(parameters[row.parameter]||0)+1;}
  const coverage={
    schema:'upstate.wqp-official-edition/v1',query,
    original_profiles:roles.map(role=>({role,...descriptors[role]})),
    result_rows:enriched.length,distinct_original_results:resultKeys.size,
    station_rows:tables.Station.rows.length,activity_rows:tables.Activity.rows.length,
    full_limit_profile_rows:tables.ResultDetectionQuantitationLimit.rows.length,
    result_rows_by_joined_limit_count:joinedCounts,normalisation:WQP_DETECTION_EDITION,
    parameters,detection_conditions:conditions,issues,
    transformation:'All original result cells are unchanged. Added explicitly mapped columns retain the original activity site/date/clock/timezone/media/type by organization/activity identity; one JSON column carries every matching original limit-profile row by organization/result identity. No missing source clock or timezone is invented.',
    scientific_scope:'Published observations for the exact source dates. No annual load, native modeled export, catchment assignment, sampling clock, replicate average or point value for a censored result is inferred.',
    legacy_preservation:'Existing unpinned native imports remain byte-reproducible. This edition carries an explicit corrected interpretation in its native import identity.',
  };
  const bodies={},manifestFiles=[];
  function member(name,bytes,kind,label,origin={},mapping={}){
    bodies[name]=bytes;
    manifestFiles.push({path:name,kind,label,bytes:bytes.length,sha256:sha(bytes),origin,mapping});
  }
  for(const role of roles){
    const d=descriptors[role];
    member('original/'+role.toLowerCase()+'.csv',originals[role],role==='Station'?'stations':'companion','Original WQP '+role+' CSV',{type:'provider-source',...d});
  }
  member('original/capture.json',captureBytes,'companion','Complete original capture metadata');
  member('original/query.json',queryBytes,'companion','Exact original source query');
  member('results-with-original-limits.csv',derived,'wqp','WQP results with complete original limit rows',{
    type:'derived-from-original-wqp',normalisation:WQP_DETECTION_EDITION,
    originalResult:descriptors.Result,originalLimits:descriptors.ResultDetectionQuantitationLimit,
    originalActivities:descriptors.Activity,
    join:'exact OrganizationIdentifier + ActivityIdentifier / ResultIdentifier',
  },mapping);
  member('SOURCE_COVERAGE.json',json(coverage),'companion','Original source joins and interpretation');
  const collection={format:'upper-savannah-measurement-collection/v1',title:query.station_id+' — official observations '+from+' to '+to,files:manifestFiles};
  return {collection,coverage,bodies};
}
function syncDirectory(directory){if(process.platform==='win32')return;const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(root,name,bytes){
  const filename=path.join(root,name),directory=path.dirname(filename);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  need(fs.realpathSync(directory)===directory,'Output parent must be ordinary');
  if(fs.existsSync(filename)){need(read(root,name).equals(bytes),'Existing prepared source differs: '+name);return;}
  const temp=path.join(directory,'.wqp-'+randomUUID());let fd;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    try{fs.linkSync(temp,filename);}catch(e){if(e.code!=='EEXIST'||!read(root,name).equals(bytes))throw e;}
  }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);syncDirectory(directory);}
}
function main(args){
  const options={};for(let i=0;i<args.length;i+=2){const k=args[i],v=args[i+1];need(['--source','--output'].includes(k)&&v&&!options[k],'Use --source CAPTURE_DIRECTORY --output PREPARED_DIRECTORY');options[k]=v;}
  need(options['--source']&&options['--output'],'Choose complete source and prepared directories');
  const source=fs.realpathSync(options['--source']),output=path.resolve(options['--output']);
  const inside=(a,b)=>{const r=path.relative(a,b);return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));};
  need(!inside(source,output)&&!inside(output,source),'Keep originals and prepared edition in separate directories');
  const captureBytes=read(source,'capture.json'),queryBytes=read(source,'query.json'),capture=JSON.parse(decode(captureBytes)),files={};
  for(const role of roles){const d=capture.files?.find(x=>x.kind===role);need(d,'Missing original '+role+' profile');files[role]=read(source,d.path,d);}
  const prepared=prepareWqpCollection({capture,captureBytes,queryBytes,files});
  fs.mkdirSync(output,{recursive:true,mode:0o700});need(fs.realpathSync(output)===output,'Use an ordinary prepared directory');
  const binding=json({schema:'upstate.wqp-prepared-binding/v1',capture:{bytes:captureBytes.length,sha256:sha(captureBytes)},normalisation:WQP_DETECTION_EDITION});
  need(!fs.readdirSync(output).length||fs.existsSync(path.join(output,'.source-binding.json')),'Refuse a nonempty unbound output directory');
  write(output,'.source-binding.json',binding);
  for(const[name,bytes]of Object.entries(prepared.bodies))write(output,name,bytes);
  write(output,'collection.json',json(prepared.collection));
  process.stdout.write(JSON.stringify({output,...prepared.coverage},null,2)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));

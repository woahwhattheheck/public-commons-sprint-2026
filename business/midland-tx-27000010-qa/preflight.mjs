#!/usr/bin/env node
// MIT. Preflight published City of Midland RFP 27000010 attribute tables and ArcGIS field metadata.
// Independent of ArcPy at review time. NOT a replacement for City-required ArcGIS load, geometry,
// USGS/ASPRS QL1, datum, independent accuracy, imagery, or source-provenance acceptance.
import {RFP,SUPPORTED} from './spec.mjs';
import {createReadStream} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const aliases=Object.freeze({String:'String',Text:'String',SmallInteger:'SmallInteger',Short:'SmallInteger',Integer:'Integer',Long:'Integer',Double:'Double',Date:'Date',OID:'OID',Geometry:'Geometry'});
const normType=x=>aliases[String(x)]??'UNKNOWN:'+x;
const number=x=>typeof x==='number'&&Number.isFinite(x);
const isEmpty=x=>x===null||x===undefined;
const reportError=(errors,code,where,detail)=>errors.push({code,where,detail});
const isDate=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d/.test(x)&&Number.isFinite(Date.parse(x));

export function checkMetadata(metadata,{contract=RFP}={}){
  const errors=[];
  if(!metadata||typeof metadata!=='object') return [{code:'METADATA_REQUIRED',where:'metadata',detail:'Object required'}];
  if(!SUPPORTED.has(metadata.feature_class))return [{code:'UNKNOWN_FEATURE_CLASS',where:'feature_class',detail:String(metadata.feature_class)}];
  const target=contract.classes[metadata.feature_class];
  if(metadata.geometry!==target.geometry)reportError(errors,'GEOMETRY_TYPE','geometry',`${metadata.geometry} != ${target.geometry}`);
  // CRS requires a real ArcGIS export and human source review. A missing CRS is an actionable deficiency.
  if(typeof metadata.horizontal_crs!=='string'||!metadata.horizontal_crs.trim())reportError(errors,'CRS_NOT_EXPORTED','horizontal_crs','Source projected coordinate reference not supplied');
  else { const crs=metadata.horizontal_crs.replace(/[_-]/g,' '); if(!/Texas.*Central/i.test(crs)||!/(NAD.*1983.*2011|NAD.*83.*2011)/i.test(crs))reportError(errors,'CRS_REVIEW','horizontal_crs',metadata.horizontal_crs); }
  if(target.vertical_crs&&!String(metadata.vertical_crs??'').includes(target.vertical_crs))reportError(errors,'VERTICAL_DATUM_REVIEW','vertical_crs',String(metadata.vertical_crs));
  if(!Array.isArray(metadata.fields))return [...errors,{code:'FIELDS_REQUIRED',where:'fields',detail:'Array required'}];
  const names=new Set();
  for(const f of metadata.fields){
    if(!f||typeof f.name!=='string'){reportError(errors,'INVALID_FIELD','fields','name required');continue;}
    if(names.has(f.name))reportError(errors,'DUPLICATE_FIELD',f.name,'Exact-name duplicate');
    names.add(f.name);
  }
  const fields=new Map(metadata.fields.filter(f=>typeof f?.name==='string').map(f=>[f.name,f]));
  for(const f of target.fields){
    const a=fields.get(f.name);
    if(!a){reportError(errors,'MISSING_REQUIRED_FIELD',f.name,'Exact spelling and case required');continue;}
    if(normType(a.type)!==f.type)reportError(errors,'FIELD_TYPE',f.name,`expected ${f.type}, got ${a.type}`);
    if(f.type==='String'&&(!Number.isSafeInteger(a.length)||a.length<f.length))reportError(errors,'FIELD_LENGTH',f.name,`expected >= ${f.length}, got ${a.length}`);
    if(!f.nullable&&a.nullable===true)reportError(errors,'FIELD_NULLABILITY',f.name,'RFP requires nonnullable');
    if(typeof a.nullable!=='boolean')reportError(errors,'FIELD_NULLABILITY_NOT_EXPORTED',f.name,'Original field nullability was not supplied');
  }
  for(const a of metadata.fields){
    if(typeof a?.name!=='string')continue;
    const similar=target.fields.find(f=>f.name.toLowerCase()===a.name.toLowerCase()&&f.name!==a.name);
    if(similar)reportError(errors,'CASE_MISMATCH',a.name,`required ${similar.name}`);
  }
  return errors;
}

export function checkRow(featureClass,row,index,seenParcels,{contract=RFP}={}){
  const errors=[],target=contract.classes[featureClass];
  if(!target)return [{code:'UNKNOWN_FEATURE_CLASS',where:'row',detail:featureClass}];
  if(!row||typeof row!=='object'||Array.isArray(row))return [{code:'ROW_INVALID',where:`row ${index}`,detail:'Object required'}];
  for(const f of target.fields){
    // Geometry and Esri-managed OID are validated via original exported FC metadata;
    // exporter emits only readable attribute columns, not a geometry substitute.
    if(f.type==='Geometry'||f.type==='OID')continue;
    const v=row[f.name];
    if(isEmpty(v)){
      if(!f.nullable)reportError(errors,'REQUIRED_VALUE',`row ${index}/${f.name}`,'null or absent');
      continue;
    }
    if(f.type==='String'&&(typeof v!=='string'||v.length>f.length))reportError(errors,'TEXT_VALUE',`row ${index}/${f.name}`,`text <= ${f.length}`);
    if(['Integer','SmallInteger','Double'].includes(f.type)&&(!number(v)||(f.type!=='Double'&&!Number.isSafeInteger(v))))reportError(errors,'NUMERIC_VALUE',`row ${index}/${f.name}`,String(v));
    if(number(v)&&((f.type==='Integer'&&(v<-2147483648||v>2147483647))||(f.type==='SmallInteger'&&(v<-32768||v>32767))))
      reportError(errors,'ESRI_INTEGER_RANGE',`row ${index}/${f.name}`,String(v));
    if(f.type==='Date'&&!isDate(v))reportError(errors,'DATE_VALUE',`row ${index}/${f.name}`,String(v));
    if(f.domain&&!f.domain.includes(v))reportError(errors,'CODED_DOMAIN',`row ${index}/${f.name}`,String(v));
  }
  // Approved dictionary roles bind the existing semantic checks to actual City fields.
  const value=name=>row[contract.semantic_fields?.[featureClass]?.[name]??name];
  if(featureClass==='IMP_SURFACE_PARCELS'){
    const id=value('PARCEL_ID');
    if(((typeof id==='string'&&id.length)||Number.isSafeInteger(id))&&seenParcels){
      if(seenParcels.has(id))reportError(errors,'DUPLICATE_PARCEL_ID',`row ${index}/PARCEL_ID`,String(id));
      seenParcels.add(id);
    }
    if(number(value('IMP_PCT'))&&(value('IMP_PCT')<0||value('IMP_PCT')>100))reportError(errors,'IMP_PCT_RANGE',`row ${index}/IMP_PCT`,String(value('IMP_PCT')));
    for(const name of ['PARCEL_AREA_SQFT','IMP_AREA_SQFT','PERV_AREA_SQFT'])
      if(number(value(name))&&value(name)<0)reportError(errors,'NEGATIVE_AREA',`row ${index}/${name}`,String(value(name)));
    // Proposed merchant QA heuristic, NOT a City-defined tolerance, should be reviewed by prime.
    const a=value('PARCEL_AREA_SQFT'),i=value('IMP_AREA_SQFT'),p=value('PERV_AREA_SQFT');
    if([a,i,p].every(number)&&Math.abs((i+p)-a)>Math.max(1,a*0.001))
      reportError(errors,'AREA_BALANCE_REVIEW',`row ${index}`,'impervious + pervious differs from parcel area > max(1 sqft,0.1%)');
    if(number(a)&&a>0&&number(i)&&number(value('IMP_PCT'))&&Math.abs(i/a*100-value('IMP_PCT'))>0.1)
      reportError(errors,'PERCENT_REVIEW',`row ${index}/IMP_PCT`,'observed percentage vs area > 0.1 pp');
  }
  if(featureClass==='IMP_SURFACE_AOI'&&number(value('SURF_CLASS'))&&number(value('AREA_SQFT'))&&value('AREA_SQFT')<0)
    reportError(errors,'NEGATIVE_AREA',`row ${index}/AREA_SQFT`,String(value('AREA_SQFT')));
  return errors;
}

/** The original streaming preflight, with an optional complete finding/row sink.
 * The compact CLI report remains compatible; operator consumers retain every
 * finding and bind review decisions to the actual source row and dictionary. */
export async function run({metadata,ndjson,sample=false,maxExamples=40,contract=RFP,
  onFinding,onRow,onProgress,signal}){
  if(!Number.isSafeInteger(maxExamples)||maxExamples<0||maxExamples>10000)throw Error('INVALID_MAX_EXAMPLES');
  const metadataBytes=await readFile(metadata),m=JSON.parse(metadataBytes.toString('utf8'));
  const metadataErrors=checkMetadata(m,{contract}),errors=[],seen=new Set(),freq={},hash=createHash('sha256');
  const finding=async (problem,context)=>{
    freq[problem.code]=(freq[problem.code]??0)+1;
    if(errors.length<maxExamples)errors.push(problem);
    await onFinding?.({problem,...context});
  };
  for(const problem of metadataErrors)await finding(problem,{scope:'metadata',line:0,row:null});
  let bytes=0,rowCount=0,flaggedRows=0,lineNo=0;
  const raw=createReadStream(ndjson,{signal});
  raw.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length;});
  const rl=createInterface({input:raw,crlfDelay:Infinity});
  try{
    for await(const line of rl){
      signal?.throwIfAborted();lineNo++;
      if(!line.trim())continue;
      rowCount++;
      let row;
      try{row=JSON.parse(line);}catch{
        flaggedRows++;
        await onRow?.({line:lineNo,row:null,raw:line});
        await finding({code:'JSON_PARSE',where:`line ${lineNo}`,detail:'invalid NDJSON'},
          {scope:'row',line:lineNo,row:null,raw:line});
        continue;
      }
      await onRow?.({line:lineNo,row});
      const e=checkRow(m.feature_class,row,lineNo,seen,{contract});
      if(e.length)flaggedRows++;
      for(const problem of e)await finding(problem,{scope:'row',line:lineNo,row});
      if(rowCount%1000===0)await onProgress?.({rows:rowCount,flaggedRows,bytes});
    }
  }finally{rl.close();raw.destroy();}
  if(m.feature_class==='IMP_SURFACE_PARCELS'&&!sample&&rowCount!==contract.expected_parcels)
    await finding({code:'PARCEL_POPULATION',where:'rows',detail:`${rowCount} vs required ${contract.expected_parcels}`},
      {scope:'population',line:0,row:null});
  await onProgress?.({rows:rowCount,flaggedRows,bytes});
  return {schema:'Midland27000010/offline-esri-export-preflight-v1',feature_class:m.feature_class,
    source:RFP.source,requested_rfp:'27000010',mode:sample?'sample':'full',rows:rowCount,
    flagged_rows:flaggedRows,input_sha256:hash.digest('hex'),input_bytes:bytes,
    metadata_input_sha256:createHash('sha256').update(metadataBytes).digest('hex'),
    problem_totals:freq,examples:errors,
    numeric_storage_review:{
      fields:(contract.classes[m.feature_class]?.fields??[]).filter(f=>f.precision!==undefined).map(f=>{
        const actual=m.fields?.find(a=>a?.name===f.name);
        return {field:f.name,declared_precision:f.precision,declared_scale:f.scale,
          exported_precision:actual?.precision??null,exported_scale:actual?.scale??null,
          metadata_matches:actual?.precision===f.precision&&actual?.scale===f.scale};
      }),
      meaning:'Declared precision and scale remain dictionary requirements. Compare original database metadata and City schema decisions; matching exported labels do not prove physical storage. File geodatabases ignore configured numeric precision and scale. No decimal rounding or data-value tolerance is inferred.',
      platform_source:'https://doc.esri.com/en/arcgis-pro/latest/tool-reference/data-management/add-field.html'},
    verdict:Object.keys(freq).length?'REVIEW_REQUIRED':'PRELIMINARY_SCHEMA_PREFLIGHT_ONLY',
    remaining_acceptance:'Obtain current original City bid/addenda and City-approved data dictionary, verify actual Esri geodatabase geometry, CRS, full coverage, LAS/LAZ, QL1, survey, accuracy, billing join, and City GIS load independently. This export preflight is not government acceptance or contract qualification.'};
}

async function main(args){
  const arg=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
  if(args.includes('--help')){
    process.stdout.write('node preflight.mjs --metadata exported.json --rows exported.ndjson --out review.json [--sample]\n');return;
  }
  const metadata=arg('--metadata'),ndjson=arg('--rows'),out=arg('--out');
  if(!metadata||!ndjson||!out)throw Error('REQUIRED_METADATA_ROWS_OUT');
  const report=await run({metadata,ndjson,sample:args.includes('--sample')});
  await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({out:resolve(out),verdict:report.verdict,rows:report.rows,problems:report.problem_totals})+'\n');
  if(report.verdict==='REVIEW_REQUIRED')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(e=>{process.stderr.write(String(e.stack??e)+'\n');process.exitCode=1;});

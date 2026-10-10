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

export function checkMetadata(metadata){
  const errors=[];
  if(!metadata||typeof metadata!=='object') return [{code:'METADATA_REQUIRED',where:'metadata',detail:'Object required'}];
  if(!SUPPORTED.has(metadata.feature_class))return [{code:'UNKNOWN_FEATURE_CLASS',where:'feature_class',detail:String(metadata.feature_class)}];
  const target=RFP.classes[metadata.feature_class];
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
  }
  for(const a of metadata.fields){
    if(typeof a?.name!=='string')continue;
    const similar=target.fields.find(f=>f.name.toLowerCase()===a.name.toLowerCase()&&f.name!==a.name);
    if(similar)reportError(errors,'CASE_MISMATCH',a.name,`required ${similar.name}`);
  }
  return errors;
}

export function checkRow(featureClass,row,index,seenParcels){
  const errors=[],target=RFP.classes[featureClass];
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
    if(f.type==='Date'&&!isDate(v))reportError(errors,'DATE_VALUE',`row ${index}/${f.name}`,String(v));
    if(f.domain&&!f.domain.includes(v))reportError(errors,'CODED_DOMAIN',`row ${index}/${f.name}`,String(v));
  }
  if(featureClass==='IMP_SURFACE_PARCELS'){
    const id=row.PARCEL_ID;
    if(typeof id==='string'&&id.length&&seenParcels){
      if(seenParcels.has(id))reportError(errors,'DUPLICATE_PARCEL_ID',`row ${index}/PARCEL_ID`,id);
      seenParcels.add(id);
    }
    if(number(row.IMP_PCT)&&(row.IMP_PCT<0||row.IMP_PCT>100))reportError(errors,'IMP_PCT_RANGE',`row ${index}/IMP_PCT`,String(row.IMP_PCT));
    for(const name of ['PARCEL_AREA_SQFT','IMP_AREA_SQFT','PERV_AREA_SQFT'])
      if(number(row[name])&&row[name]<0)reportError(errors,'NEGATIVE_AREA',`row ${index}/${name}`,String(row[name]));
    // Proposed merchant QA heuristic, NOT a City-defined tolerance, should be reviewed by prime.
    const a=row.PARCEL_AREA_SQFT,i=row.IMP_AREA_SQFT,p=row.PERV_AREA_SQFT;
    if([a,i,p].every(number)&&Math.abs((i+p)-a)>Math.max(1,a*0.001))
      reportError(errors,'AREA_BALANCE_REVIEW',`row ${index}`,'impervious + pervious differs from parcel area > max(1 sqft,0.1%)');
    if(number(a)&&a>0&&number(i)&&number(row.IMP_PCT)&&Math.abs(i/a*100-row.IMP_PCT)>0.1)
      reportError(errors,'PERCENT_REVIEW',`row ${index}/IMP_PCT`,'observed percentage vs area > 0.1 pp');
  }
  if(featureClass==='IMP_SURFACE_AOI'&&number(row.SURF_CLASS)&&number(row.AREA_SQFT)&&row.AREA_SQFT<0)
    reportError(errors,'NEGATIVE_AREA',`row ${index}/AREA_SQFT`,String(row.AREA_SQFT));
  return errors;
}

export async function run({metadata,ndjson,sample=false,maxExamples=40}){
  const m=JSON.parse(await readFile(metadata,'utf8'));
  const errors=checkMetadata(m),seen=new Set(),freq={},hash=createHash('sha256');
  for(const error of errors)freq[error.code]=(freq[error.code]??0)+1;
  let bytes=0;
  const raw=createReadStream(ndjson);
  raw.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length;});
  const rl=createInterface({input:raw,crlfDelay:Infinity});
  let rowCount=0,flaggedRows=0,lineNo=0;
  for await(const line of rl){
    lineNo++;
    if(!line.trim())continue;
    rowCount++;
    let row;
    try{row=JSON.parse(line);}catch{reportError(errors,'JSON_PARSE',`line ${lineNo}`,'invalid NDJSON');freq.JSON_PARSE=(freq.JSON_PARSE??0)+1;continue;}
    const e=checkRow(m.feature_class,row,lineNo,seen);
    if(e.length)flaggedRows++;
    for(const problem of e){freq[problem.code]=(freq[problem.code]??0)+1;if(errors.length<maxExamples)errors.push(problem);}
  }
  if(m.feature_class==='IMP_SURFACE_PARCELS'&&!sample&&rowCount!==RFP.expected_parcels){
    reportError(errors,'PARCEL_POPULATION',`rows`,`${rowCount} vs required ${RFP.expected_parcels}`);
    freq.PARCEL_POPULATION=(freq.PARCEL_POPULATION??0)+1;
  }
  return {schema:'Midland27000010/offline-esri-export-preflight-v1',feature_class:m.feature_class,
    source:RFP.source,requested_rfp:'27000010',mode:sample?'sample':'full',rows:rowCount,
    flagged_rows:flaggedRows,input_sha256:hash.digest('hex'),input_bytes:bytes,
    problem_totals:freq,examples:errors.slice(0,maxExamples),
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

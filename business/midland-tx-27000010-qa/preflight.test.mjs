// MIT. One focused source-transcription and attribute review contract check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RFP} from './spec.mjs';
import {checkMetadata,checkRow} from './preflight.mjs';
const clone=x=>structuredClone(x);
const parcels=RFP.classes.IMP_SURFACE_PARCELS;
const metadata={feature_class:'IMP_SURFACE_PARCELS',geometry:'Polygon',horizontal_crs:'NAD_1983_2011_StatePlane_Texas_Central_FIPS_4203_FtUS',fields:parcels.fields.map(x=>({name:x.name,type:x.type,length:x.length,nullable:x.nullable}))};
const row={PARCEL_ID:'DEMO-001',PARCEL_AREA_SQFT:1000,PARCEL_AREA_ACRES:1000/43560,IMP_AREA_SQFT:300,IMP_AREA_ACRES:300/43560,PERV_AREA_SQFT:700,PERV_AREA_ACRES:700/43560,IMP_PCT:30,IMP_ERU:null,CAPTURE_DATE:'2026-10-01',CAPTURE_YEAR:2026,METHOD:'DEMO ONLY',QA_FLAG:0,QA_NOTES:null};
test('real RFP 4-class field transcription and provisional parcel check',()=>{
  assert.deepEqual(Object.fromEntries(Object.entries(RFP.classes).map(([k,v])=>[k,v.fields.length])),{IMP_SURFACE_AOI:14,IMP_SURFACE_PARCELS:16,CONTOURS_1FT:6,LIDAR_FLIGHTLINES:10});
  assert.deepEqual(checkMetadata(metadata),[]);
  assert.deepEqual(checkRow('IMP_SURFACE_PARCELS',row,1,new Set()),[]);
  const invalid=clone(metadata);invalid.fields.find(f=>f.name==='PARCEL_ID').name='parcel_id';invalid.fields.find(f=>f.name==='METHOD').length=80;
  const codes=checkMetadata(invalid).map(x=>x.code);assert(codes.includes('MISSING_REQUIRED_FIELD'));assert(codes.includes('CASE_MISMATCH'));assert(codes.includes('FIELD_LENGTH'));
  const corrupt=clone(row);corrupt.IMP_PCT=145;corrupt.QA_FLAG=6;corrupt.IMP_AREA_SQFT=2000;
  const found=checkRow('IMP_SURFACE_PARCELS',corrupt,2,new Set()).map(x=>x.code);
  for(const code of ['CODED_DOMAIN','IMP_PCT_RANGE','AREA_BALANCE_REVIEW','PERCENT_REVIEW'])assert(found.includes(code),code);
});

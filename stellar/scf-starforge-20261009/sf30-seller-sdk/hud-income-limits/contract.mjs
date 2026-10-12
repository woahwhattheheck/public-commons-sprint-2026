// MIT. Published HUD Section 8 values and explicit locality selection.
import { object, fault, identity } from '../postgres/publisher/files.mjs';

export const HASH = /^[a-f0-9]{64}$/;
export const SCHEMA = 'stellar-forge.hud-income-limits-source.v1';
export const METRICS = Object.freeze(['median_family_income','extremely_low_income','very_low_income','low_income']);
export const TYPES = Object.freeze({
  fiscal_year:{type:'integer',nullable:false},effective_date:{type:'string',nullable:false},
  program:{type:'string',nullable:false},state_fips:{type:'string',nullable:false},
  state_abbreviation:{type:'string',nullable:false},state_name:{type:'string',nullable:false},
  county_fips:{type:'string',nullable:false},county_name:{type:'string',nullable:false},
  locality_id:{type:'string',nullable:false},locality_name:{type:'string',nullable:false},
  hud_area_code:{type:'string',nullable:false},hud_area_name:{type:'string',nullable:false},
  metro:{type:'integer',nullable:false},metric:{type:'string',nullable:false},
  family_size:{type:'integer',nullable:true},published_income_usd:{type:'integer',nullable:false},
  source_value:{type:'string',nullable:false},source_field:{type:'string',nullable:false},
  source_sheet:{type:'string',nullable:false},source_row:{type:'integer',nullable:false},
  source_cell:{type:'string',nullable:false},workbook_sha256:{type:'string',nullable:false}
});
export const COLUMNS = Object.freeze(Object.keys(TYPES));
export const ORDER = Object.freeze([{column:'source_row',direction:'asc'},{column:'metric',direction:'asc'},{column:'family_size',direction:'asc'}]);
export function only(value, keys, code='HUD_INPUT_INVALID'){
  if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))throw fault(code);
}
export function fiscalYear(value){
  if(!Number.isInteger(value)||value<2000||value>2099)throw fault('HUD_FISCAL_YEAR_REQUIRED','Choose the fiscal year printed on the original workbook.');
  return value;
}
export function releaseMetadata(value){
  only(value,['fiscalYear','effectiveDate','reviewer','note']);
  const year=fiscalYear(value.fiscalYear);
  if(typeof value.effectiveDate!=='string'||!/^20\d\d-\d\d-\d\d$/.test(value.effectiveDate)||
    !Number.isFinite(Date.parse(value.effectiveDate+'T00:00:00Z'))||
    new Date(value.effectiveDate+'T00:00:00Z').toISOString().slice(0,10)!==value.effectiveDate||
    !value.effectiveDate.startsWith(String(year)+'-'))throw fault('HUD_EFFECTIVE_DATE_REQUIRED','Enter the Section 8 effective date published for this fiscal year.');
  for(const k of ['reviewer','note'])if(typeof value[k]!=='string'||!value[k].trim()||value[k].length>(k==='reviewer'?128:2000))
    throw fault('HUD_RELEASE_REVIEW_REQUIRED','Record the reviewer and published-release note.');
  return {fiscalYear:year,effectiveDate:value.effectiveDate,reviewer:value.reviewer.trim(),note:value.note.trim()};
}
export function releaseFiles(year){
  const yy=String(fiscalYear(year)).slice(-2),root='https://www.huduser.gov/portal/datasets/il/il'+yy+'/';
  return [
    {role:'workbook',name:'Section8-FY'+yy+'.xlsx',url:root+'Section8-FY'+yy+'.xlsx',maxBytes:16777216,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
    {role:'areas',name:'area-definitions-FY'+yy+'.pdf',url:root+'area-definitions-FY'+yy+'.pdf',maxBytes:16777216,type:'application/pdf'},
    {role:'methodology',name:'IncomeLimitsMethodology-FY'+yy+'.pdf',url:root+'IncomeLimitsMethodology-FY'+yy+'.pdf',maxBytes:8388608,type:'application/pdf'},
    {role:'index',name:'hud-income-limits-index.html',url:'https://www.huduser.gov/portal/datasets/il.html',maxBytes:8388608,type:'text/html'}
  ];
}
const parts=(value,name,pattern,maximum=10000)=>{
  if(value===undefined||value==='')return [];
  const list=typeof value==='string'?value.split(',').map(x=>x.trim()).filter(Boolean):value;
  if(!Array.isArray(list)||list.length>maximum||list.some(x=>typeof x!=='string'||!pattern.test(x)))throw fault('HUD_SELECTION_INVALID','Review the '+name+' selection.');
  return [...new Set(list)].sort();
};
export function selection(input={}){
  only(input,['states','counties','localities','areas','metrics','familySizes']);
  const metrics=parts(input.metrics,'published metric',/^[a-z_]+$/,4);
  if(metrics.some(x=>!METRICS.includes(x)))throw fault('HUD_METRIC_INVALID');
  let sizes=input.familySizes;
  if(sizes===undefined||sizes==='')sizes=[1,2,3,4,5,6,7,8];
  else if(typeof sizes==='string')sizes=sizes.split(',').map(x=>Number(x.trim()));
  if(!Array.isArray(sizes)||!sizes.length||sizes.some(x=>!Number.isInteger(x)||x<1||x>8))throw fault('HUD_FAMILY_SIZE_INVALID','Published family sizes are 1 through 8.');
  return {
    states:parts(input.states,'two-digit state FIPS',/^\d{2}$/,100),
    counties:parts(input.counties,'five-digit county FIPS',/^\d{5}$/,5000),
    localities:parts(input.localities,'ten-digit HUD locality',/^\d{10}$/),
    areas:parts(input.areas,'HUD area code',/^[A-Z0-9]{1,40}$/),
    metrics:metrics.length?metrics:[...METRICS],
    familySizes:[...new Set(sizes)].sort((a,b)=>a-b)
  };
}
export function selectedLocality(row,chosen){
  return (!chosen.states.length||chosen.states.includes(row.values.state))&&
    (!chosen.counties.length||chosen.counties.includes(row.values.state+row.values.county))&&
    (!chosen.localities.length||chosen.localities.includes(row.values.fips))&&
    (!chosen.areas.length||chosen.areas.includes(row.values.hud_area_code));
}
export function observations(row,manifest,chosen){
  if(!selectedLocality(row,chosen))return [];
  const v=row.values,common={
    fiscal_year:manifest.fiscalYear,effective_date:manifest.effectiveDate,program:'HUD Section 8 Income Limits',
    state_fips:v.state,state_abbreviation:v.stusps,state_name:v.state_name,
    county_fips:v.state+v.county,county_name:v.County_Name,locality_id:v.fips,locality_name:v.county_town_name,
    hud_area_code:v.hud_area_code,hud_area_name:v.hud_area_name,metro:Number(v.metro),
    source_sheet:manifest.projection.sheet,source_row:row.row,workbook_sha256:manifest.files.workbook.sha256
  };
  const result=[];
  for(const metric of chosen.metrics){
    const sizes=metric==='median_family_income'?[null]:chosen.familySizes;
    for(const familySize of sizes){
      const field=metric==='median_family_income'?'median'+manifest.fiscalYear:
        (metric==='extremely_low_income'?'ELI_':metric==='very_low_income'?'l50_':'l80_')+familySize;
      const raw=v[field],column=manifest.projection.columns[field];
      if(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||!column)throw fault('HUD_PUBLISHED_VALUE_CHANGED');
      result.push({...common,metric,family_size:familySize,published_income_usd:Number(raw),source_value:raw,
        source_field:field,source_cell:column+row.row});
    }
  }
  return result;
}
export const selectionHash=input=>identity(selection(input));
export function datasetPlan(name='HUD Section 8 published income limits'){
  return {name,columns:structuredClone(TYPES),
    filters:['fiscal_year','state_fips','county_fips','locality_id','hud_area_code','metric','family_size'],
    ranges:['published_income_usd'],sorts:['county_fips','locality_id','metric','family_size','published_income_usd'],
    defaultLimit:50,maxLimit:250,maxCellChars:65536,maxPageBytes:921600};
}
export function queryDefinition(manifest,defaults={}){
  const selected=selection(defaults);
  return {columns:[...COLUMNS],columnTypes:Object.entries(TYPES).map(([name,spec])=>({name,...spec})),
    parameters:Object.fromEntries(['states','counties','localities','areas','metrics','familySizes'].map(name=>[name,{
      type:'string',default:selected[name].join(','),description:'Comma-separated explicit '+name
    }])),
    serviceQuery:{protocol:'HUD Section 8 published Income Limits workbook',fiscalYear:manifest.fiscalYear,
      effectiveDate:manifest.effectiveDate,program:'Section 8',sheet:manifest.projection.sheet,
      sourceHash:manifest.releaseId,workbookSha256:manifest.files.workbook.sha256,
      selectionHash:identity(selected),semantics:'Published locality-level annual USD thresholds; no geographic aggregation or recalculation',
      columns:manifest.projection.columns}
  };
}

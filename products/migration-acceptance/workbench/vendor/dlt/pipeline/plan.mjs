// SPDX-License-Identifier: MIT
import {canonical,copy,objectDigest,requireValue,verifyDocumentDigest} from '../vendor/sling/migration/common.mjs';
import {normalizeAirbyte} from '../vendor/sling/migration/intake.mjs';
import {compareObservations} from '../vendor/sling/migration/compare.mjs';
const NAME=/^[a-z][a-z0-9_]{0,62}$/,TYPES=new Set(['text','bigint','double','bool','timestamp','date','decimal','binary','json','time']);
const scalar={text:'text',bigint:'integer',double:'float64',bool:'boolean',timestamp:'timestamp',date:'date',decimal:'decimal',binary:'binary',time:'text',json:'text'};
function name(v,label){requireValue(typeof v==='string'&&NAME.test(v),'name','Use an explicit normalized lowercase '+label+'.');return v;}
function sourceId(v,label){requireValue(typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v),'source_id','Select a retained source ID for '+label+'.');return v;}
function stringArray(v,label){requireValue(Array.isArray(v)&&v.every(x=>typeof x==='string')&&new Set(v).size===v.length,'columns','Retain unique '+label+'.');return copy(v);}
export function compilePipeline(input){
  requireValue(input?.schema==='dlthub.pipeline-input.v1','input_schema','Select the complete native dlt pipeline input.');
  const issues=[],pipelineName=name(input.pipelineName,'pipeline name'),datasetName=name(input.datasetName,'dataset name');
  requireValue(Array.isArray(input.resources)&&input.resources.length>0&&input.resources.length<=50,'resources','Select one to fifty original resources.');
  const seen=new Set(),resourceNames=new Set(),resources=input.resources.map(raw=>{
    const resourceName=name(raw.name,'resource name'),tableName=name(raw.tableName??raw.name,'table name');
    requireValue(!resourceNames.has(resourceName),'resource_collision','Original native resource names must be distinct.');resourceNames.add(resourceName);
    requireValue(!seen.has(tableName),'table_collision','Native target table names must be distinct.');seen.add(tableName);
    requireValue(['csv','json','ndjson'].includes(raw.format),'format','Select CSV, original JSON array or newline JSON.');
    const columns=raw.columns??[];
    requireValue(Array.isArray(columns)&&columns.every(c=>c&&NAME.test(c.name)&&TYPES.has(c.data_type)),'columns','Declare original dlt column hints.');
    requireValue(new Set(columns.map(c=>c.name)).size===columns.length,'columns','Column hints must be unique.');
    const hints=columns.map(c=>{
      const v={name:c.name,data_type:c.data_type,nullable:c.nullable!==false};
      if(c.precision!==undefined){requireValue(Number.isSafeInteger(c.precision)&&c.precision>0&&c.precision<=38,'precision','DuckDB decimal precision must be 1..38.');v.precision=c.precision;}
      if(c.scale!==undefined){requireValue(Number.isSafeInteger(c.scale)&&c.scale>=0&&c.scale<=(c.precision??38),'scale','Select an exact decimal scale.');v.scale=c.scale;}
      if(c.timezone!==undefined)v.timezone=c.timezone===true;return v;
    });
    const primaryKey=stringArray(raw.primaryKey??[],'primary key paths');
    let disposition=copy(raw.writeDisposition??'append');
    requireValue(['append','replace','merge'].includes(typeof disposition==='string'?disposition:disposition?.disposition),'disposition','Select native append, replace or merge.');
    if(typeof disposition==='object')requireValue(['delete-insert','upsert','scd2','insert-only'].includes(disposition.strategy),'strategy','Select a supported original DuckDB merge strategy.');
    if((typeof disposition==='string'?disposition:disposition.disposition)==='merge'&&!primaryKey.length)issues.push({severity:'error',code:'PRIMARY_KEY_REQUIRED',resource:resourceName,message:'Explicit primary keys are required for this reviewed merge.'});
    const incremental=raw.incremental?copy(raw.incremental):null;
    if(incremental){
      requireValue(typeof incremental.cursor_path==='string'&&incremental.cursor_path.length>0,'cursor','Select the original native cursor JSON path.');
      requireValue(incremental.last_value_func===undefined||['max','min'].includes(incremental.last_value_func),'cursor_function','Select native max or min.');
      requireValue(incremental.on_cursor_value_missing===undefined||['raise','include','exclude'].includes(incremental.on_cursor_value_missing),'cursor_missing','Select original native missing-cursor behavior.');
      for(const k of ['range_start','range_end'])if(incremental[k]!==undefined)requireValue(['open','closed'].includes(incremental[k]),'cursor_range','Select native open or closed boundary.');
      for(const k of Object.keys(incremental))requireValue(['cursor_path','initial_value','end_value','last_value_func','row_order','on_cursor_value_missing','range_start','range_end','lag'].includes(k),'cursor_option','Retain only documented native incremental options.');
    }
    const contract=copy(raw.schemaContract??{tables:'evolve',columns:'evolve',data_type:'freeze'});
    if(typeof contract==='object')for(const [k,v]of Object.entries(contract))requireValue(['tables','columns','data_type'].includes(k)&&['evolve','freeze','discard_value','discard_row'].includes(v),'schema_contract','Select original native schema contract fields.');
    else requireValue(['evolve','freeze','discard_value','discard_row'].includes(contract),'schema_contract','Select the native schema contract.');
    requireValue(raw.maxTableNesting===undefined||Number.isSafeInteger(raw.maxTableNesting)&&raw.maxTableNesting>=0&&raw.maxTableNesting<=20,'nesting','Use an explicit original normalization depth.');
    const maps=copy(raw.fieldMap??{});for(const[k,v]of Object.entries(maps)){requireValue(typeof k==='string'&&NAME.test(v),'field_map','Use reviewed source-to-native field names.');}
    return{name:resourceName,tableName,sourceId:sourceId(raw.sourceId,'data'),format:raw.format,columns:hints,primaryKey,writeDisposition:disposition,incremental,schemaContract:contract,maxTableNesting:raw.maxTableNesting??10,fieldMap:maps,nullValues:stringArray(raw.nullValues??[],'CSV null representations'),csvDelimiter:raw.csvDelimiter??',',notes:raw.notes??''};
  });
  requireValue(Array.isArray(input.acceptance)&&input.acceptance.length>0,'acceptance','Retain complete independent expected tables for parity; native normalization output alone is not independent expected data.');
  const acceptance=input.acceptance.map(raw=>{
    const table=name(raw.table,'acceptance table'),columns=raw.columns;
    requireValue(Array.isArray(columns)&&columns.length>0,'acceptance_columns','Select every business column to compare.');
    const names=new Set();
    for(const c of columns){name(c.name,'business column');requireValue(!names.has(c.name)&&['text','integer','decimal','boolean','date','timestamp','binary','float64'].includes(c.cellType),'acceptance_columns','Use unique exact scalar columns.');names.add(c.name);}
    const keys=stringArray(raw.primaryKey??[],'acceptance keys');requireValue(keys.every(k=>names.has(k)),'acceptance_key','Acceptance keys must be selected business columns.');
    return{table,id:JSON.stringify([datasetName,table]),expectedSourceId:sourceId(raw.expectedSourceId,'independent expected full export'),columns:copy(columns),primaryKey:keys,ignoredRightColumns:stringArray(raw.ignoredRightColumns??['_dlt_load_id','_dlt_id'],'ignored native columns')};
  });
  requireValue(new Set(acceptance.map(t=>t.table)).size===acceptance.length,'acceptance_duplicate','Compare each normalized table once.');
  const limits={maxRows:input.limits?.maxRows??250000,maxBytes:input.limits?.maxBytes??536870912,workers:input.limits?.workers??1};
  requireValue(Number.isSafeInteger(limits.maxRows)&&limits.maxRows>0&&limits.maxRows<=1000000,'row_limit','Select a complete export cap up to one million.');
  requireValue(Number.isSafeInteger(limits.maxBytes)&&limits.maxBytes>0&&limits.maxBytes<=536870912,'byte_limit','Select an input/export cap up to 512 MiB.');
  requireValue(Number.isSafeInteger(limits.workers)&&limits.workers>=1&&limits.workers<=4,'workers','Select one to four original loader workers.');
  const phase=input.phase??'baseline';requireValue(['baseline','incremental','rollback'].includes(phase),'phase','Select the original acceptance phase.');
  const body={schema:'dlthub.pipeline-plan.v1',title:input.title??'Native dlt migration',pipelineName,datasetName,resources,acceptance,phase,limits,
    sourceBoundary:input.sourceBoundary??'Retained complete immutable source files.',restoreFromDestination:false,devMode:false,
    upstream:{repository:'dlt-hub/dlt',version:'1.31.0',commit:'2360d229c77f7f64692acc31a4555f4cfcd50ed3'},issues,ready:!issues.some(i=>i.severity==='error'),sourceEvidence:copy(input.sourceEvidence??[]),notes:input.notes??''};
  return{...body,planId:objectDigest(body)};
}
export function comparisonPlan(plan){
  verifyDocumentDigest(plan,'planId');requireValue(plan.schema==='dlthub.pipeline-plan.v1','plan_schema','Select the original dlt pipeline plan.');
  const body={schema:'slingdata.migration-plan.v1',ready:plan.ready,issues:plan.issues,origin:{schema:plan.schema,planId:plan.planId},selectedStreams:plan.acceptance.map(t=>({
    id:t.id,ready:plan.ready,name:t.table,namespace:plan.datasetName,mode:t.primaryKey.length?'incremental':'full-refresh',primaryKey:t.primaryKey,updateKey:null,
    businessColumns:t.columns.map(c=>c.name),ignoredLeftColumns:[],ignoredRightColumns:t.ignoredRightColumns,
    columnMaps:{left:Object.fromEntries(t.columns.map(c=>[c.name,c.left??c.name])),right:Object.fromEntries(t.columns.map(c=>[c.name,c.right??c.name]))},cellTypes:Object.fromEntries(t.columns.map(c=>[c.name,c.cellType]))}))};
  return{...body,planId:objectDigest(body)};
}
export function comparePipeline(plan,observations){
  requireValue(observations.pipelinePlanId===plan.planId,'observation_plan','The complete observations belong to another native pipeline plan.');
  const selected=comparisonPlan(plan),report=compareObservations(selected,observations);
  const result={schema:'dlthub.pipeline-comparison.v1',planId:plan.planId,comparisonPlanId:selected.planId,equal:report.equal,
    readyForCutover:report.readyForCutover&&observations.pendingPackages===false&&observations.failedJobs===false&&observations.completeTables===true,
    errors:[...report.errors,...(observations.pendingPackages===false?[]:['Native packages remain pending.']),...(observations.failedJobs===false?[]:['A retained native load package has failed jobs.']),...(observations.completeTables===true?[]:['Every normalized business table needs an explicit complete acceptance mapping.'])],nativeReport:report};
  return{...result,reportId:objectDigest(result)};
}
export function reviewAirbyte(document,options={}){
  const native=normalizeAirbyte(document,options),issues=[];
  const resources=native.streams.map(stream=>{
    const row={sourceIdentity:{namespace:stream.namespace,name:stream.name},selected:stream.selected,sourceDefinedCursor:stream.sourceDefinesCursor,
      primaryKey:copy(stream.primaryKey),cursor:copy(stream.cursor),syncMode:stream.sourceMode,destinationSyncMode:stream.destinationMode,
      original:copy(stream),adaptations:[]};
    if(stream.sourceMode==='incremental')row.adaptations.push('Bind the original native incremental cursor type, range and deduplication boundary.');
    if(stream.destinationMode?.includes('dedup'))row.adaptations.push('Review the native merge strategy and complete primary key.');
    row.adaptations.push('Bind retained data and independent expected full exports, normalized field names, nested tables and schema contracts.');
    return row;
  });
  const body={schema:'dlthub.airbyte-intake.v1',native,resources,issues,ready:false,meaning:'Original config semantics retained. Explicit dlt input is required before native effects.'};return{...body,intakeId:objectDigest(body)};
}

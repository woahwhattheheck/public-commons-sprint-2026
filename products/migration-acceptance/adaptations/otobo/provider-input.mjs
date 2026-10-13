// SPDX-License-Identifier: MIT
// Native comparison adapter. The original configuration core owns OTOBO semantics.
import {prepareConfigurationComparison} from './core.mjs';
import {canonical,textPin} from './project.mjs';
export const PREPARED_SCHEMA='otobo.prepared.v1';
export const REVIEW_SOURCE_SCHEMA='otobo.review-source.v1';
export const requireValue=(yes,message)=>{if(!yes)throw Error(message);};
export const digest=text=>textPin(text);
export const json=value=>JSON.stringify(value,null,2)+'\n';
const file=(path,content)=>({path,content,...textPin(content)});
const copy=x=>JSON.parse(JSON.stringify(x));
const columns=['family','identity_json','value_json'].map(name=>({name,type:'text',nullable:false}));
const primaryKey=['family','identity_json'];
const sourcePath='inputs/planned-configuration.json',expectedPath='expected/returned-configuration.json';
function completeRows(rows,label){
 requireValue(Array.isArray(rows),label+' must contain the complete selected rows.');
 const keys=new Set();
 for(const row of rows){
  requireValue(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===3&&columns.every(c=>typeof row[c.name]==='string'),label+' must retain exact family, identity JSON and complete tagged value JSON text.');
  const key=canonical([row.family,row.identity_json]);requireValue(!keys.has(key),label+' repeats one configuration identity.');keys.add(key);
 }
 return rows;
}
export function prepareProviderMigration({capture,mapping}){
 requireValue(capture?.schema===REVIEW_SOURCE_SCHEMA&&capture.source&&capture.before&&capture.after,'Retain the original source, original target baseline and independently returned target capture.');
 const comparison=prepareConfigurationComparison({source:capture.source,before:capture.before,plan:mapping,after:capture.after});
 const expectedRows=completeRows(comparison.expectedRows,'Planned configuration'),observedRows=completeRows(comparison.observedRows,'Independent returned configuration');
 requireValue(typeof comparison.ready==='boolean'&&Array.isArray(comparison.findings),'Retain the original configuration readiness and findings.');
 const projection={schema:'otobo.native-projection.v1',sourceCaptureId:comparison.sourceCaptureId,beforeCaptureId:comparison.beforeCaptureId,afterCaptureId:comparison.afterCaptureId,planId:comparison.planId,ready:comparison.ready,coverage:copy(comparison.coverage),findings:copy(comparison.findings),columns:copy(columns),primaryKey:[...primaryKey],expectedRows:copy(expectedRows),observedRows:copy(observedRows),
  nativeSides:{source:'Reviewed plan-selected expected configuration, materialized only in the local comparison database.',expected:'Independent returned OTOBO capture; original native field is named expectedSourceId.',scope:'Only the core-selected comparison identities. Every full capture remains retained; unselected extra target configuration is not deleted or inferred absent.'}};
 const files=[file(sourcePath,json(expectedRows)),file(expectedPath,json(observedRows)),file('capture.json',json(capture)),file('mapping.json',json(mapping)),file('projection.json',json(projection))];
 const table={name:'configuration',sourcePath,expectedPath,columns:copy(columns),primaryKey:[...primaryKey],sourceRows:expectedRows.length,expectedRows:observedRows.length};
 const manifest={schema:PREPARED_SCHEMA,operationId:comparison.planId,mappingId:comparison.planId,ready:comparison.ready,files:files.map(({path,bytes,sha256})=>({path,bytes,sha256})),tables:[table],relationships:[],consistency:{mode:'independent-configuration-exports',sourceCaptureId:comparison.sourceCaptureId,beforeCaptureId:comparison.beforeCaptureId,afterCaptureId:comparison.afterCaptureId,coverage:copy(comparison.coverage)},
  meaning:'Complete tagged scalar/tree JSON is compared as text. Known differences proceed to native parity; unknown selected coverage prevents native binding. No OTOBO import or configuration write is performed by this adapter.'};
 return {manifest,files};
}
export function bindProviderPipeline(prepared,sourceIds,options={}){
 requireValue(prepared?.manifest?.schema===PREPARED_SCHEMA&&Array.isArray(prepared.files),'Select the complete prepared OTOBO review.');
 requireValue(prepared.files.length===prepared.manifest.files.length&&new Set(prepared.files.map(x=>x.path)).size===prepared.files.length,'Prepared full file selection differs.');
 for(const descriptor of prepared.manifest.files){const f=prepared.files.find(x=>x.path===descriptor.path);requireValue(f&&textPin(f.content).bytes===descriptor.bytes&&textPin(f.content).sha256===descriptor.sha256,'Prepared original member differs: '+descriptor.path);}
 const capture=prepared.files.find(x=>x.path==='capture.json'),mapping=prepared.files.find(x=>x.path==='mapping.json');
 requireValue(capture&&mapping,'Keep complete original captures and the exact selected plan.');
 const reopened=prepareProviderMigration({capture:JSON.parse(capture.content),mapping:JSON.parse(mapping.content)});
 requireValue(canonical(reopened.manifest)===canonical(prepared.manifest),'Reopened original configuration projection differs.');
 requireValue(reopened.manifest.ready,'The original plan or selected returned coverage remains unresolved. Retain its full projection and complete the original source review before native comparison.');
 const used=new Set(),select=path=>{const id=sourceIds[path];requireValue(typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id)&&!used.has(id),'Retain distinct original planned and independently observed source IDs.');used.add(id);return id;};
 const tables=prepared.manifest.tables;
 const resources=tables.map(t=>({name:t.name,tableName:t.name,sourceId:select(t.sourcePath),format:'json',columns:t.columns.map(c=>({name:c.name,data_type:'text',nullable:false})),primaryKey:t.primaryKey,writeDisposition:'replace',schemaContract:{tables:'evolve',columns:'freeze',data_type:'freeze'},maxTableNesting:0,notes:'Exact reviewed OTOBO plan expectation; complete tagged values remain JSON text. The actual returned configuration is independently retained.'}));
 const acceptance=tables.map(t=>({table:t.name,expectedSourceId:select(t.expectedPath),columns:t.columns.map(c=>({name:c.name,cellType:'text'})),primaryKey:t.primaryKey,ignoredRightColumns:['_dlt_id','_dlt_load_id']}));
 const pipelineName=options.pipelineName??'otobo_configuration',datasetName=options.datasetName??'otobo_configuration';
 requireValue(/^[a-z][a-z0-9_]{0,62}$/.test(pipelineName)&&/^[a-z][a-z0-9_]{0,62}$/.test(datasetName),'Use explicit native pipeline and dataset identifiers.');
 return {schema:'dlthub.pipeline-input.v1',title:options.title??'OTOBO planned and independently returned configuration comparison',pipelineName,datasetName,phase:'baseline',resources,acceptance,limits:{maxRows:Math.max(1,...tables.flatMap(t=>[t.sourceRows,t.expectedRows])),maxBytes:536870912,workers:1},sourceEvidence:prepared.manifest.files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256})),sourceBoundary:'The original dlt pipeline materializes reviewed expectation rows only in the selected local DuckDB comparison workspace. Independently returned OTOBO configuration is the exact comparison side. No live OTOBO writes.',notes:'Original source, target baseline, returned capture, selected plan, complete tagged scalar values, coverage and findings remain in their original retained source files.'};
}

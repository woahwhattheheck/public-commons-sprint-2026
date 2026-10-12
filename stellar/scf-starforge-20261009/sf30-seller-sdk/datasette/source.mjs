// MIT. Original reviewed Datasette edition as a trusted native dataset source.
// Capture, exact JSON, review, comparison and receiving remain the maintained core.
import { dirname,join,resolve } from 'node:path';
import { setImmediate as yieldTask } from 'node:timers/promises';
import { object,bytes,digest,identity,readPrivate,fault } from '../postgres/publisher/files.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { datasetteMember } from './capture.mjs';
import { readDatasetteEdition,projectDatasetteRow } from './editions.mjs';
import { hasLosslessNumberRoundtrip,isSafeIntegerToken } from './json.mjs';

const HASH=/^[a-f0-9]{64}$/;
const QUERY=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export async function inspectDatasetteSource(sourceFile) {
  sourceFile=resolve(sourceFile);
  const original=await readPrivate(sourceFile,1024*1024);
  let config;try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));}catch{throw fault('DATASETTE_SOURCE_JSON_INVALID');}
  if(!object(config)||config.schema!=='stellar-forge.datasette-source.v1'||
      Object.keys(config).some(k=>!['schema','edition','editionSha256','query'].includes(k))||
      !HASH.test(config.editionSha256??'')||!QUERY.test(config.query??''))throw fault('DATASETTE_SOURCE_DECLARATION_INVALID');
  const editionFile=resolve(dirname(sourceFile),datasetteMember(config.edition));
  const selected=await readDatasetteEdition(editionFile,{expectedSha256:config.editionSha256});
  if(!selected.review.approved||!object(selected.review.projection)||!selected.review.columnTypes.length||selected.review.columnTypes.length>64)throw fault('DATASETTE_SOURCE_REVIEW_REQUIRED');
  const query={resource:selected.edition.name,columns:selected.review.columnTypes.map(field=>field.name),
    projection:structuredClone(selected.review.projection),key:structuredClone(selected.review.key),
    columnTypes:structuredClone(selected.review.columnTypes),editionSha256:selected.editionSha256,
    captureSha256:selected.captureSha256,reviewDigest:selected.review.digest,
    selectionHash:selected.capture.selectionHash};
  return {...selected,schema:'stellar-forge.datasette-source-inspection.v1',sourceName:'Datasette',sourceFile,
    hash:digest(original),bytes:original.length,config,queries:{[config.query]:query}};
}
export function checkDatasetteColumnTypes(columns,types) {
  if(!object(columns)||!Array.isArray(types))throw fault('DATASETTE_COLUMN_TYPES_INVALID');
  const seen=new Set(),byName=new Map(types.map(field=>{
    if(!object(field)||seen.has(field.name))throw fault('DATASETTE_COLUMN_TYPES_INVALID');seen.add(field.name);return [field.name,field];
  }));
  for(const [name,raw] of Object.entries(columns)){
    const spec=typeof raw==='string'?{type:raw,nullable:false}:raw,source=byName.get(name);
    if(!source||!object(spec)||spec.type!==source.type||(spec.nullable??false)!==source.nullable)
      throw fault('DATASETTE_DATASET_PROJECTION_MISMATCH','Use the original source-reviewed type and null representation for '+name+'.');
  }
}
export function encodeDatasetteRow(row,dataset) {
  if(!object(row)||!object(dataset.columns))throw fault('DATASETTE_PROJECTED_ROW_INVALID');
  return csvLine(Object.entries(dataset.columns).map(([name,spec])=>{
    const value=row[name];
    if(value===null){if(!spec.nullable)throw fault('DATASETTE_PROJECTED_NULL');return '';}
    if(typeof value!=='string'||value.length>(dataset.maxCellChars??65536))throw fault('DATASETTE_PROJECTED_CELL_LIMIT');
    if(value===''&&spec.nullable)throw fault('DATASETTE_EMPTY_NULL_CONFLICT','Select the original JSON representation to preserve null and blank for '+name+'.');
    if(spec.type==='integer'&&(!/^-?(0|[1-9][0-9]*)$/.test(value)||!isSafeIntegerToken(value)))throw fault('DATASETTE_INTEGER_REQUIRES_EXACT_TEXT');
    if(spec.type==='number'&&!hasLosslessNumberRoundtrip(value))throw fault('DATASETTE_NUMBER_REQUIRES_EXACT_TEXT');
    if(spec.type==='boolean'&&!['true','false'].includes(value))throw fault('DATASETTE_BOOLEAN_PROJECTION_INVALID');
    return value;
  }));
}
export async function openDatasetteSourceFile(sourceFile) {
  const selected=await inspectDatasetteSource(sourceFile);
  const columnTypes=Object.fromEntries(Object.entries(selected.queries).map(([name,query])=>[name,query.columnTypes]));
  let active=null,closed=false;
  const source={
    inspect(){if(closed)throw fault('DATASETTE_SOURCE_CLOSED');return {sourceName:'Datasette',queries:selected.queries,columnTypes};},
    async exportDataset(name,input={},supplied={}) {
      if(closed||active)throw fault(closed?'DATASETTE_SOURCE_CLOSED':'DATASETTE_SOURCE_BUSY');
      const query=selected.queries[name];if(!query)throw fault('QUERY_NOT_FOUND');
      if(!object(input)||Object.keys(input).length)throw fault('DATASETTE_QUERY_INPUT_NOT_SUPPORTED');
      const {onRow,signal,...limits}=supplied;
      if(typeof onRow!=='function')throw fault('DATASETTE_ROW_CALLBACK_REQUIRED');
      const options=datasetExtractionOptions(query,limits),controller=new AbortController();
      const combined=signal?AbortSignal.any([controller.signal,signal]):controller.signal;
      const operation={controller,promise:null};active=operation;
      operation.promise=(async()=>{
        const started=Date.now();let count=0,sourceTextBytes=0;
        const check=()=>{if(combined.aborted)throw combined.reason??fault('DATASETTE_EXTRACTION_CANCELLED');if(Date.now()-started>options.timeoutMs)throw fault('DATASETTE_EXTRACTION_TIMEOUT');};
        if(selected.rows.length>options.maxRows)throw fault('DATASETTE_EXTRACTION_ROW_LIMIT','The complete retained edition exceeds the reviewed row limit.',413);
        const projected=[];
        for(let index=0;index<selected.rows.length;index++){
          check();const row=projectDatasetteRow(selected.rows[index],selected.columns,query.projection);
          const size=Object.values(row).reduce((sum,value)=>sum+(value===null?0:Buffer.byteLength(value)),0);
          sourceTextBytes+=size;
          if(size>options.maxRowBytes||sourceTextBytes>options.maxBytes)throw fault('DATASETTE_EXTRACTION_BYTE_LIMIT',undefined,413);
          projected.push({index,row});
          if(index%256===255)await yieldTask();
        }
        const types=new Map(columnTypes[name].map(field=>[field.name,field]));
        projected.sort((left,right)=>{
          for(const order of options.order){
            let a=left.row[order.column],b=right.row[order.column];
            if(a===null||b===null){if(a!==b)return a===null?1:-1;continue;}
            const type=types.get(order.column)?.type;
            if(type==='integer'||type==='number'){a=Number(a);b=Number(b);}
            else if(type==='boolean'){a=a==='true';b=b==='true';}
            if(a!==b)return(a<b?-1:1)*(order.direction==='desc'?-1:1);
          }
          return left.index-right.index;
        });
        for(const item of projected){
          check();await onRow(item.row,columnTypes[name],{rowCount:++count,sourceTextBytes});
          if(count%256===0)await yieldTask();
        }
        return {schema:'stellar-forge.datasette-extraction.v1',query:name,resource:query.resource,
          rowCount:count,sourceTextBytes,columns:query.columns,columnTypes:columnTypes[name],order:options.order,
          valueEncoding:'datasette-reviewed-original-projection',nullEncoding:'reviewed-native-or-json',
          tieBreak:'original-captured-page-and-row-order',editionSha256:selected.editionSha256,captureSha256:selected.captureSha256,
          reviewDigest:selected.review.digest,selectionHash:selected.capture.selectionHash,
          consistency:structuredClone(selected.capture.consistency),sourceMetadata:structuredClone(selected.capture.selection.metadata??null)};
      })().finally(()=>{if(active===operation)active=null;});
      return operation.promise;
    },
    async close(){closed=true;if(active){active.controller.abort(fault('DATASETTE_EXTRACTION_CANCELLED'));await active.promise.catch(()=>{});}},
  };
  return {source,config:selected.config};
}
export function datasetteDatasetSemantics(selected,columns) {
  const review=selected.review,selection=selected.capture.selection;
  const physical=Object.entries(columns).map(([name,spec])=>{
    const source=review.projection[name],profile=review.columns.find(field=>field.name===source.column);
    const encoding=source.representation==='json'?'json':spec.type==='string'?'text':'native';
    return {name,type:spec.type,nullable:spec.nullable??false,sourceField:source.column,encoding,
      sourceDefinition:{column:source.column,representation:source.representation,
        sourceKinds:Object.entries(profile?.types??{}).filter(([,count])=>count>0).map(([kind])=>kind),columnSourceSha256:identity(selected.capture.columnSource??null)},
      projectedDefinition:{name,datatype:spec.type,required:!(spec.nullable??false)},issues:[]};
  });
  const projectedKey=review.key.columns.map(column=>Object.entries(review.projection).find(([alias,spec])=>spec.column===column&&Object.hasOwn(columns,alias))?.[0]).filter(Boolean);
  // The retained source key and the values actually published by the chosen
  // projection have separate identities. A label or string projection can merge
  // different original values, even when the source review found a unique key.
  const keyValues=new Set();let missingRows=0,blankRows=0,duplicateRows=0,invalidRows=0;
  const allKeyColumns=projectedKey.length>0&&projectedKey.length===review.key.columns.length;
  if(allKeyColumns)for(const originalRow of selected.rows){
    const projected=projectDatasetteRow(originalRow,selected.columns,review.projection);
    const raw=projectedKey.map(name=>projected[name]);
    if(raw.some(value=>value===null||value===undefined)){missingRows++;continue;}
    if(raw.some(value=>value==='')){blankRows++;continue;}
    let invalid=false;
    const values=raw.map((value,index)=>{
      const spec=columns[projectedKey[index]],type=typeof spec==='string'?spec:spec.type;
      if(typeof value!=='string'){invalid=true;return null;}
      if(type==='integer'||type==='number'){
        if(type==='integer'&&(!/^-?(0|[1-9][0-9]*)$/.test(value)||!isSafeIntegerToken(value))||
          type==='number'&&!hasLosslessNumberRoundtrip(value)){invalid=true;return null;}
        return [type,Number(value)];
      }
      if(type==='boolean'){if(!['true','false'].includes(value)){invalid=true;return null;}return [type,value==='true'];}
      return ['string',value];
    });
    if(invalid){invalidRows++;continue;}
    const key=JSON.stringify(values);
    if(keyValues.has(key))duplicateRows++;else keyValues.add(key);
  }
  const projectedReview={columns:projectedKey,rowCount:selected.rows.length,
    unique:allKeyColumns&&!missingRows&&!blankRows&&!duplicateRows&&!invalidRows,
    missingRows,blankRows,duplicateRows,invalidRows,distinctValues:keyValues.size,
    valueIdentity:'actual-published-native-dataset-values'};
  const sourceKeyReview={columns:review.key.columns,unique:review.key.unique,
    missingRows:review.key.missingRows,blankRows:review.key.blankRows,
    duplicateRows:review.key.duplicateRows,distinctValues:review.key.distinctValues,
    stability:review.key.stability,reviewDigest:review.digest};
  const payload={schema:'stellar-forge.datasette-semantics.v1',
    source:{provider:'datasette',captureManifestSha256:selected.captureSha256,schemaSha256:identity({columns:selected.columns,columnSource:selected.capture.columnSource??null}),
      url:selection.url,kind:selection.kind,database:selection.database??null,table:selection.table??null,query:selection.query??null,
      metadata:structuredClone(selection.metadata??null),sourceVersion:structuredClone(selected.capture.sourceVersion??null),
      consistency:structuredClone(selected.capture.consistency),editionSha256:selected.editionSha256,reviewDigest:review.digest},
    columns:physical,primaryKey:{source:review.key.columns,projected:projectedKey,
      complete:review.key.unique&&projectedReview.unique,
      stability:review.key.stability,sourceReview:sourceKeyReview,projectedReview},aboutUrl:{source:selection.metadata?.aboutUrl??selection.url},
    virtualColumns:[],issues:review.key.unique&&!projectedReview.unique?[{code:'DATASETTE_PROJECTED_KEY_INCOMPLETE',
      message:'The chosen published key projection does not preserve a complete unique key; the original source key review is retained separately.'}]:[],csvw:{tableSchema:{columns:physical.map(field=>field.projectedDefinition)}}};
  const {captureManifestSha256,schemaSha256,...meaning}=payload.source;
  const definitionSha256=identity({...payload,source:meaning});
  return {...payload,definitionSha256,sha256:identity({...payload,definitionSha256})};
}

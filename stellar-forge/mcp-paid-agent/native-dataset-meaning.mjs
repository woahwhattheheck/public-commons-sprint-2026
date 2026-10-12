// SPDX-License-Identifier: MIT
// Read the ORIGINAL SF100 dictionary and its manifest; no semantic inference.
import {join} from 'node:path';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {canonical} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-page.mjs';
import {MAX_DATASET_PAGE_BYTES} from '../../stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs';

const HASH=/^[a-f0-9]{64}$/;
const same=(a,b)=>canonical(a)===canonical(b);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
export const baseDatasetFiles=Object.freeze({
  'dataset.jsonl':'application/x-ndjson',
  'dataset.csv':'text/csv; charset=utf-8',
  'review.html':'text/html; charset=utf-8',
  'manifest.json':'application/json',
});
export const datasetFileTypes=Object.freeze({...baseDatasetFiles,'semantics.json':'application/json'});

/** Only the original manifest can add the dictionary to the four-file delivery. */
export function datasetDeliveryNames(native){
  need(object(native)&&object(native.outputs),'MCP_DATASET_NATIVE_MANIFEST_CHANGED');
  const names=Object.keys(baseDatasetFiles);
  if(native.semantics!==undefined){
    const value=native.semantics;
    need(object(value)&&['stellar-forge.ckan-semantics.v1','stellar-forge.odata-semantics.v1'].includes(value.schema)&&
      HASH.test(value.sha256??'')&&HASH.test(value.definitionSha256??'')&&
      HASH.test(value.captureManifestSha256??'')&&value.file==='semantics.json'&&
      value.scope==='PUBLISHED_DATASET'&&value.typedRowsFile==='dataset.jsonl'&&
      same(value.selectedFields,native.dataset?.projectedFields),
      'MCP_DATASET_NATIVE_SEMANTICS_CHANGED');
    names.push('semantics.json');
  }
  need(same(Object.keys(native.outputs).sort(),names.filter(name=>name!=='manifest.json').sort()),
    'MCP_DATASET_NATIVE_MANIFEST_FILES_CHANGED');
  return names;
}

/** A legacy record may predate the fifth file. Its pinned manifest still owns it.
 * The saved delivery.json bytes are never rewritten or given another identity.
 */
export async function bindDatasetFiles({record,room,native,readSavedFile}){
  const names=datasetDeliveryNames(native),keys=Object.keys(record.files??{});
  const legacy=names.includes('semantics.json')&&!keys.includes('semantics.json');
  need(same(keys.sort(),(legacy?Object.keys(baseDatasetFiles):names).slice().sort()),
    'MCP_DATASET_DELIVERY_CHANGED');
  const files={};
  for(const name of names){
    const expected=name==='manifest.json'?null:native.outputs[name];
    const file=record.files[name]??{destination:join(room,name),contentType:datasetFileTypes[name],...expected};
    need(file.destination===join(room,name)&&file.contentType===datasetFileTypes[name]&&
      integer(file.bytes,0,256*1024*1024)&&HASH.test(file.sha256??'')&&
      (expected===null||same(expected,{sha256:file.sha256,bytes:file.bytes})),
      'MCP_DATASET_NATIVE_MANIFEST_CHANGED');
    files[name]=file;
  }
  if(files['semantics.json'])await readSavedFile(files['semantics.json'],{maxBytes:1});
  return {files,legacySemantics:legacy};
}

async function originalDictionary(file,native,readSavedFile){
  need(file.bytes>0&&file.bytes<=MAX_DATASET_PAGE_BYTES,'MCP_DATASET_SEMANTICS_SIZE_INVALID');
  const blocks=[];
  for(let offset=0;offset<file.bytes;){
    const result=await readSavedFile(file,{byteOffset:offset,maxBytes:65536});
    const block=Buffer.from(result.data,'base64');
    need(block.length>0&&offset+block.length<=file.bytes,'MCP_DATASET_SEMANTICS_FILE_CHANGED');
    blocks.push(block);offset+=block.length;
  }
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(blocks,file.bytes)));}
  catch{need(false,'MCP_DATASET_SEMANTICS_JSON_INVALID');}
  // SF100 already validated the retained source bindings, CSVW, physical types
  // and canonical dictionary hashes. Rebind those exact retained bytes to its pinned manifest here.
  need(object(value)&&value.schema===native.semantics.schema&&value.sha256===native.semantics.sha256&&
    value.definitionSha256===native.semantics.definitionSha256&&
    value.source?.captureManifestSha256===native.semantics.captureManifestSha256&&
    Array.isArray(value.columns)&&value.columns.every(object)&&
    native.dataset.projectedFields.every(name=>value.columns.some(column=>column.name===name))&&
    Array.isArray(value.virtualColumns)&&Array.isArray(value.issues)&&object(value.csvw)&&
    object(value.csvw.tableSchema),'MCP_DATASET_SEMANTICS_IDENTITY_CHANGED');
  return value;
}

/** Bounded, lossless pieces of the original dictionary; exact bytes stay readable. */
export async function datasetMeaning(delivered,args,readSavedFile){
  const {record,native}=delivered,filename='semantics.json',file=record.files[filename];
  const offset=args.offset??0,limit=args.limit??25,maxBytes=args.maxBytes??32768;
  const section=args.dictionarySection??'columns';
  need(integer(offset,0,1000000)&&integer(limit,1,100)&&integer(maxBytes,1024,65536)&&
    ['columns','virtual-columns','issues','table'].includes(section),'MCP_DATASET_SEMANTICS_PAGE_INVALID');
  const base={schema:'stellar-forge.mcp-dataset-meaning.v1',acquisitionId:record.acquisitionId,
    available:Boolean(file),snapshot:native.dataset.snapshot,sourceBindingSha256:record.sourceBindingSha256,
    manifestSha256:record.files['manifest.json'].sha256,authority:'ORIGINAL_VERIFIED_SF100_SEMANTICS'};
  if(!file)return {...base,items:[],range:{offset:0,limit,total:0,nextOffset:null},
    note:'This original delivery has no semantic dictionary; physical column types do not imply units or code meanings.'};
  const value=await originalDictionary(file,native,readSavedFile);
  let all;
  if(section==='columns')all=value.columns;
  else if(section==='virtual-columns')all=value.virtualColumns;
  else if(section==='issues')all=value.issues;
  else{
    const {columns,virtualColumns,issues,csvw,...table}=value;
    const {columns:definitions,...tableSchema}=csvw.tableSchema;
    all=[{...table,csvw:{...csvw,tableSchema}}];
  }
  need(offset<=all.length,'MCP_DATASET_SEMANTICS_PAGE_INVALID');
  const readAction={action:'dataset-read',acquisitionId:record.acquisitionId,filename,maxBytes:65536};
  const result={...base,section,semantics:native.semantics,
    dictionaryFile:{filename,bytes:file.bytes,sha256:file.sha256,contentType:file.contentType},
    dictionaryReadAction:readAction,items:[],
    range:{offset,limit,total:all.length,nextOffset:offset<all.length?offset:null,maxBytes}};
  // Leave room for range/oversized metadata even at the caller's small ceiling.
  const overhead=Buffer.byteLength(JSON.stringify(result))+768;
  need(overhead<=maxBytes,'MCP_DATASET_SEMANTICS_BUDGET_BELOW_METADATA');
  let used=overhead,at=offset;
  while(at<all.length&&result.items.length<limit){
    const size=Buffer.byteLength(JSON.stringify(all[at]))+(result.items.length?1:0);
    if(used+size>maxBytes){
      result.nextItem={offset:at,bytes:size,
        reason:'ORIGINAL_DICTIONARY_ITEM_EXCEEDS_PREVIEW_BUDGET',readAction};
      break;
    }
    result.items.push(all[at]);used+=size;at++;
  }
  result.range.nextOffset=at<all.length?at:null;
  result.range.returnedItems=result.items.length;
  need(Buffer.byteLength(JSON.stringify(result))<=maxBytes,'MCP_DATASET_SEMANTICS_PREVIEW_TOO_LARGE');
  return result;
}

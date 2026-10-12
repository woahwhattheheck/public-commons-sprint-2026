// SPDX-License-Identifier: MIT
// Original SQL-edition semantic endpoints; no new dictionary or comparison engine.
import {createHash} from 'node:crypto';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
const HASH=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const sha=value=>createHash('sha256').update(value).digest('hex');
const size=value=>Buffer.byteLength(JSON.stringify(value));
const operations=['semantics','semantic-compare','semantics-file'];
const MAX_DICTIONARY=2*1024*1024;
const version=value=>{need(typeof value==='string'&&HASH.test(value),'MCP_ANALYSIS_VERSION_REQUIRED');return value;};

function page(base,all,body,readAction){
 const offset=body.offset??0,limit=body.limit??25,maxBytes=body.maxBytes??32768;
 need(Array.isArray(all)&&integer(offset,0,all.length)&&integer(limit,1,100)&&
  integer(maxBytes,1024,65536),'MCP_ANALYSIS_SEMANTIC_PAGE_INVALID');
 const result={...base,items:[],range:{offset,limit,total:all.length,nextOffset:null,maxBytes}};
 need(size(result)+768<=maxBytes,'MCP_ANALYSIS_SEMANTIC_BUDGET_BELOW_METADATA');
 let at=offset,used=size(result)+768;
 while(at<all.length&&result.items.length<limit){
  const bytes=size(all[at])+1;
  if(used+bytes>maxBytes){
   result.nextItem={offset:at,bytes,reason:'ORIGINAL_ITEM_EXCEEDS_PREVIEW_BUDGET',readAction};
   break;
  }
  result.items.push(all[at]);used+=bytes;at++;
 }
 result.range.nextOffset=at<all.length?at:null;
 need(size(result)<=maxBytes,'MCP_ANALYSIS_SEMANTIC_PREVIEW_TOO_LARGE');
 return result;
}

/** Cache at most four small immutable editions during one live service identity.
 * Reconnecting after restore/restart has a different capability/cacheScope.
 * The original SQL service owns dictionary validation and exact-byte retention.
 */
export function createNativeSemanticActions(){
 const editions=new Map(),comparisons=new Map();
 const remember=(map,key,value)=>{map.set(key,value);if(map.size>4)map.delete(map.keys().next().value);return value;};
 async function edition(versionId,cacheScope,get){
  const key=cacheScope+':'+version(versionId);
  if(editions.has(key))return editions.get(key);
  const value=await get('/api/semantics/'+versionId);
  if(value===null)return remember(editions,key,{metadata:null,bytes:null});
  need(object(value)&&value.schema==='stellar-forge.python-dataset-semantics.v1'&&
   value.version_id===versionId&&object(value.file)&&value.file.name==='semantics.json'&&
   integer(value.file.bytes,1,MAX_DICTIONARY)&&HASH.test(value.file.sha256??'')&&
   HASH.test(value.semantic_sha256??'')&&HASH.test(value.definition_sha256??'')&&
   HASH.test(value.capture_manifest_sha256??'')&&object(value.document)&&
   value.document.sha256===value.semantic_sha256&&value.document.definitionSha256===value.definition_sha256&&
   value.document.source?.captureManifestSha256===value.capture_manifest_sha256&&
   Array.isArray(value.columns)&&Array.isArray(value.document.columns)&&
   Array.isArray(value.document.virtualColumns)&&Array.isArray(value.document.issues),
   'MCP_ANALYSIS_SEMANTIC_IDENTITY_CHANGED');
  return remember(editions,key,{metadata:value,bytes:null});
 }
 async function originalBytes(entry,versionId,getBytes){
  if(entry.bytes)return entry.bytes;
  const raw=await getBytes('/api/semantics-file/'+versionId,MAX_DICTIONARY);
  need(Buffer.isBuffer(raw)&&raw.length===entry.metadata.file.bytes&&sha(raw)===entry.metadata.file.sha256,
   'MCP_ANALYSIS_SEMANTIC_FILE_CHANGED');
  entry.bytes=raw;return raw;
 }
 return {
  handles:operation=>operations.includes(operation),
  async call({operation,body,cacheScope,get,getBytes}){
   if(operation==='semantic-compare'){
    const before=version(body.before_version_id),after=version(body.after_version_id),key=cacheScope+':'+before+':'+after;
    let original=comparisons.get(key);
    if(!original){
     original=await get('/api/semantic-compare?'+new URLSearchParams({before,after}));
     need(original?.schema==='stellar-forge.python-semantic-comparison.v1'&&
      original.before_version===before&&original.after_version===after&&Array.isArray(original.columns)&&
      ['definition_changed','capture_changed','mapping_changed'].every(key=>typeof original[key]==='boolean'),
      'MCP_ANALYSIS_SEMANTIC_COMPARISON_CHANGED');
     remember(comparisons,key,original);
    }
    const {columns,before_document,after_document,...summary}=original;
    const readAction={operation:'semantics-file',versions:[before,after]};
    return page({...summary,dictionaries:{before:{operation:'semantics',version_id:before},
      after:{operation:'semantics',version_id:after}}},columns,body,readAction);
   }
   const versionId=version(body.version_id),entry=await edition(versionId,cacheScope,get);
   if(operation==='semantics-file'){
    need(entry.metadata!==null,'DATASET_SEMANTIC_DICTIONARY_UNAVAILABLE');
    if(body.sha256!==undefined)need(body.sha256===entry.metadata.file.sha256,'MCP_ANALYSIS_SEMANTIC_FILE_CHANGED');
    const offset=body.byteOffset??0,maxBytes=body.maxBytes??65536;
    need(integer(offset,0,entry.metadata.file.bytes)&&integer(maxBytes,1,65536),
     'MCP_ANALYSIS_SEMANTIC_FILE_RANGE_INVALID');
    const raw=await originalBytes(entry,versionId,getBytes),end=Math.min(raw.length,offset+maxBytes);
    return {version_id:versionId,semantic_sha256:entry.metadata.semantic_sha256,
     definition_sha256:entry.metadata.definition_sha256,file:{filename:'semantics.json',
      contentType:'application/json',bytes:raw.length,sha256:entry.metadata.file.sha256,
      byteOffset:offset,returnedBytes:end-offset,nextByteOffset:end<raw.length?end:null,
      encoding:'base64',data:raw.subarray(offset,end).toString('base64'),verified:true}};
   }
   if(entry.metadata===null)return {version_id:versionId,available:false,items:[],
    note:'This original SQL edition has no semantic dictionary.'};
   const {document,...metadata}=entry.metadata,section=body.section??'columns';
   need(['columns','virtual-columns','issues','table','mapping'].includes(section),
    'MCP_ANALYSIS_SEMANTIC_SECTION_INVALID');
   let all;
   if(section==='mapping')all=metadata.columns;
   else if(section==='columns')all=document.columns;
   else if(section==='virtual-columns')all=document.virtualColumns;
   else if(section==='issues')all=document.issues;
   else{
    const {columns,virtualColumns,issues,csvw,...table}=document;
    need(object(csvw)&&object(csvw.tableSchema),'MCP_ANALYSIS_SEMANTIC_TABLE_CHANGED');
    const {columns:definitions,...tableSchema}=csvw.tableSchema;
    all=[{...table,csvw:{...csvw,tableSchema}}];
   }
   return page({...metadata,available:true,section,
    dictionaryReadAction:{operation:'semantics-file',version_id:versionId,sha256:metadata.file.sha256}},
    all,body,{operation:'semantics-file',version_id:versionId,sha256:metadata.file.sha256});
  },
  close(){editions.clear();comparisons.clear();},
 };
}

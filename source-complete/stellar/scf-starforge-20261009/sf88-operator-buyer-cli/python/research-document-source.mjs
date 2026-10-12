// MIT. Retain original Research document editions for the existing Python Analysis importer.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,link,unlink,readdir,lstat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {BuyerError,need,parseJson,syncDirectory} from '../node/store.mjs';
import {readResearchHostFile,openResearchSource} from '../research-dossiers/workspace-files.mjs';
import {verifyPipelineResearchEdition} from '../research-dossiers/unstructured-pipelines/edition.mjs';
import {verifyPartitionResearchEnvelope} from '../node/unstructured/dossier.mjs';
import {decodePartitionBytes} from '../node/unstructured/purchase.mjs';
import {privateDirectory,withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';

const EDITION_LIMIT=64*1024*1024, ORIGINAL_LIMIT=32*1024*1024, TOTAL_LIMIT=256*1024*1024;
const ROW_LIMIT=2*1024*1024, MANIFEST_LIMIT=1024*1024;
export const RESEARCH_ANALYSIS_SCHEMA='stellar-forge.research-document-analysis.v1';
export const ANALYSIS_SOURCE_SCHEMA='stellar-forge.analysis-source-document.v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const columns=[
  'position','provider','operation_id','profile_id','document_sha256','output_sha256',
  'element_id','element_type','page_json','text','metadata_json','provider_record_json',
  'citation_json','research_row_id','edition_sha256',
  'text_preview_json','text_preview_complete','text_characters',
];
export const RESEARCH_ANALYSIS_MAPPING=Object.freeze({
  collection:'',sse_data:'text',
  columns:columns.map(name=>({name,pointer:'/'+name,type:['position','text_characters'].includes(name)?'integer':'text',missing:'error'})),
});
const cell=value=>{
  const text=String(value);need(Buffer.from(text).toString('utf8')===text,'RESEARCH_ANALYSIS_UTF8_REQUIRED');
  return '"'+text.replaceAll('"','""')+'"';
};
const scalar=value=>value===undefined||value===null?'':typeof value==='string'?value:JSON.stringify(value);
const encoded=value=>JSON.stringify(value===undefined?null:value);
function workbookText(text){
  // Full original text remains in the text column and source archive. This
  // explicitly named preview fits Excel's native 32,767 UTF-16-unit cell limit.
  let count=0,preview='';
  for(const character of text){if(count<2000)preview+=character;count++;}
  const literal=JSON.stringify(preview).replace(/[^\x20-\x7E]/g,
    character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'));
  return [literal,String(count<=2000),String(count)];
}
async function settlePublication(path){
  let file;
  try{file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
  try{
    const before=await file.stat();
    need(before.isFile()&&(before.mode&0o077)===0,'RESEARCH_ANALYSIS_FILE_CHANGED');
    // Settle only this writer's exact temporary hardlink after an interrupted
    // link/unlink publication. Other files and other in-progress copies remain.
    for(const name of await readdir(dirname(path))){
      if(!name.startsWith('.research-source-')&&!name.startsWith('.research-manifest-'))continue;
      const alias=join(dirname(path),name);let info;
      try{info=await lstat(alias);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(info.isFile()&&info.dev===before.dev&&info.ino===before.ino)
        await unlink(alias).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
    const named=await lstat(path),after=await file.stat();
    need(named.isFile()&&named.dev===before.dev&&named.ino===before.ino&&after.nlink===1&&
      after.size===before.size&&after.mtimeMs===before.mtimeMs,'RESEARCH_ANALYSIS_FILE_CHANGED');
    await file.sync();await syncDirectory(dirname(path));return true;
  }finally{await file.close();}
}
async function existing(path,maximum){
  if(!await settlePublication(path))return null;
  return readResearchHostFile(path,maximum,{privateFile:true});
}
async function verifyPublished(path,record,retainBytes=true){
  if(!retainBytes){
    need(await settlePublication(path),'RESEARCH_ANALYSIS_FILE_CHANGED');
    const source=await openResearchSource(path,record.bytes,{sha256:record.sha256});
    try{need(source.bytes===record.bytes,'RESEARCH_ANALYSIS_FILE_CHANGED');}
    finally{await source.close();}
    return;
  }
  const bytes=await readResearchHostFile(path,record.bytes,{privateFile:true,sha256:record.sha256});
  need(bytes.length===record.bytes,'RESEARCH_ANALYSIS_FILE_CHANGED');return bytes;
}
// The original importer requires complete, private content-addressed files. A
// final name is only linked after fsync; an interruption reuses exact bytes.
async function publish(root,body,extension,contentType){
  const sha256=hash(body),relative='files/'+sha256+'.'+extension,path=join(root,relative);
  const record={path:relative,bytes:body.length,sha256,contentType};
  if(await existing(path,body.length)!==null){await verifyPublished(path,record);return record;}
  const temporary=join(dirname(path),'.research-source-'+randomUUID());
  let handle;
  try{
    handle=await open(temporary,'wx',0o600);await handle.writeFile(body);await handle.sync();
    await handle.close();handle=null;
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    await unlink(temporary);await syncDirectory(dirname(path));await verifyPublished(path,record);
    return record;
  }finally{if(handle)await handle.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function publishCsv(root,rows){
  const temporary=join(root,'files','.research-source-'+randomUUID());
  const checksum=createHash('sha256');let count=0,handle;
  try{
    handle=await open(temporary,'wx',0o600);
    let rowIndex=0;
    for(const row of (function*(){yield columns;yield* rows;})()){
      if(rowIndex++){
        const mapped=Object.fromEntries(columns.map((name,index)=>[name,index===0?Number(row[index]):row[index]]));
        need(Buffer.byteLength(JSON.stringify(mapped))+1<=ROW_LIMIT,'RESEARCH_ANALYSIS_ROW_LIMIT');
      }
      const bytes=Buffer.from(row.map(cell).join(',')+'\r\n');
      // This is the existing Analysis row ceiling, not a provider truncation.
      need(bytes.length<=ROW_LIMIT,'RESEARCH_ANALYSIS_ROW_LIMIT');
      count+=bytes.length;need(count<=TOTAL_LIMIT,'RESEARCH_ANALYSIS_SOURCE_LIMIT');
      await handle.writeFile(bytes);checksum.update(bytes);
    }
    await handle.sync();await handle.close();handle=null;
    const sha256=checksum.digest('hex'),relative='files/'+sha256+'.csv',path=join(root,relative);
    const record={path:relative,bytes:count,sha256,contentType:'text/csv;charset=utf-8'};
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    await unlink(temporary);await syncDirectory(dirname(path));await verifyPublished(path,record,false);return record;
  }finally{if(handle)await handle.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function originalParts(root,body,role,contentType,extension){
  const manifestType=typeof contentType==='string'&&/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[ -~]{1,160})?$/.test(contentType)
    ?contentType:'application/octet-stream';
  need(body.length<=TOTAL_LIMIT,'RESEARCH_ANALYSIS_SOURCE_LIMIT');
  const parts=[],count=Math.max(1,Math.ceil(body.length/ORIGINAL_LIMIT));
  for(let index=0;index<count;index++){
    const piece=body.subarray(index*ORIGINAL_LIMIT,Math.min(body.length,(index+1)*ORIGINAL_LIMIT));
    const record=await publish(root,piece,count===1?extension:'bin',count===1?manifestType:'application/octet-stream');
    parts.push({...record,role:count===1?role:role+'-part-'+String(index+1).padStart(3,'0')});
  }
  return {role,bytes:body.length,sha256:hash(body),contentType,
    parts:parts.map((item,index)=>({role:item.role,offset:index*ORIGINAL_LIMIT,...item}))};
}
function* documentRows(checked,provider,editionSha256){
  if(provider==='unstructured'){
    for(let index=0;index<checked.elements.length;index++){
      const row=checked.envelope.results[index];
      const element=checked.elements[index],binding=checked.binding;
      yield [String(index+1),provider,binding.intentId,binding.profileId,binding.document.sha256,
        binding.responseSha256,scalar(element.element_id),scalar(element.type),
        encoded(element.metadata.page_number),element.text,encoded(element.metadata),encoded(element),
        encoded(row.citation),row.id,editionSha256,...workbookText(element.text)];
    }
    return;
  }
  for(let index=0;index<checked.items.length;index++){
    const row=checked.items[index];
    const metadata=row.metadata??{},pipeline=metadata.pipeline??{};
    // Text, object and binary output all keep the native projection. Binary
    // output has an empty text field plus its original binary metadata.
    yield [String(index+1),provider,checked.binding.operationId,checked.binding.profileId,'',
      checked.output.sha256,scalar(pipeline.elementId),scalar(pipeline.type),
      encoded(metadata.page_number),typeof row.content==='string'?row.content:encoded(row.content),
      encoded(metadata),encoded(row),encoded(row.citation),row.id,editionSha256,
      ...workbookText(typeof row.content==='string'?row.content:encoded(row.content))];
  }
}
async function manifestFiles(root,manifest){
  const seen=new Map();
  for(const record of [manifest.document,...manifest.originals]){
    const prior=seen.get(record.path);
    need(!prior||prior.sha256===record.sha256&&prior.bytes===record.bytes&&prior.contentType===record.contentType,
      'RESEARCH_ANALYSIS_FILE_IDENTITY_CONFLICT');
    seen.set(record.path,record);
  }
  need([...seen.values()].reduce((sum,item)=>sum+item.bytes,0)<=TOTAL_LIMIT,'RESEARCH_ANALYSIS_SOURCE_LIMIT');
  for(const item of seen.values())await verifyPublished(join(root,item.path),item,false);
}
/** Only verifies retained editions and prepares the native Analysis source contract. */
export async function createResearchDocumentSource({
  editionFile,expectedSha256,expectedEditionSha256,directory,title,capturedAt,runtimeDirectory,
}={}){
  need(hex(expectedSha256)&&hex(expectedEditionSha256),'RESEARCH_REVIEWED_EDITION_REQUIRED');
  need(typeof title==='string'&&title.trim()&&title.length<=200&&!title.includes('\0'),'RESEARCH_ANALYSIS_TITLE_INVALID');
  const timestamp=typeof capturedAt==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(capturedAt);
  const year=timestamp&&Number(timestamp[1]),month=timestamp&&Number(timestamp[2]);
  const days=year&&[31,28+(year%4===0&&(year%100!==0||year%400===0)?1:0),31,30,31,30,31,31,30,31,30,31][month-1];
  need(timestamp&&year>=1&&month>=1&&month<=12&&Number(timestamp[3])>=1&&Number(timestamp[3])<=days&&
    Number(timestamp[4])<24&&Number(timestamp[5])<60&&Number(timestamp[6])<60&&
    (timestamp[7]==='Z'||Number(timestamp[7].slice(1,3))<24&&Number(timestamp[7].slice(4))<60)&&
    Number.isFinite(Date.parse(capturedAt)),'RESEARCH_ANALYSIS_CAPTURE_TIME_REQUIRED');
  const root=resolve(directory);await privateDirectory(root);await privateDirectory(join(root,'files'));
  const raw=await readResearchHostFile(resolve(editionFile),EDITION_LIMIT,{sha256:expectedSha256});
  const value=parseJson(raw);
  need(value.provider==='unstructured'||value.provider==='unstructured-pipelines','RESEARCH_DOCUMENT_EDITION_REQUIRED');
  const provider=value.provider;
  const checked=provider==='unstructured'?await verifyPartitionResearchEnvelope(raw,{runtimeDirectory}):
    verifyPipelineResearchEdition(raw);
  const editionSha256=provider==='unstructured'?checked.editionSha256:checked.sha256;
  need(editionSha256===expectedEditionSha256,'RESEARCH_REVIEWED_EDITION_CHANGED');
  const binding=checked.binding;
  const receiptIdentity={schema:RESEARCH_ANALYSIS_SCHEMA,projection:'document-elements-with-workbook-preview-v1',provider,rawEditionSha256:hash(raw),
    editionSha256,title,capturedAt,binding};
  return withPrivateLock(root,'source.lock',async()=>{
    const old=await existing(join(root,'source.json'),MANIFEST_LIMIT);
    if(old){
      const manifest=parseJson(old),record=manifest.originals?.find(item=>item.role==='analysis-receipt');
      need(record&&manifest.schema===ANALYSIS_SOURCE_SCHEMA,'RESEARCH_ANALYSIS_SOURCE_CHANGED');
      const receipt=parseJson(await verifyPublished(join(root,record.path),record));
      need(JSON.stringify(receipt.identity)===JSON.stringify(receiptIdentity),'RESEARCH_ANALYSIS_SOURCE_CHANGED');
      await manifestFiles(root,manifest);
      return {manifestFile:join(root,'source.json'),documentId:hash(old),manifest,receipt,replayed:true};
    }
    const archives=[];
    archives.push(await originalParts(root,raw,'research-edition','application/json','json'));
    if(provider==='unstructured'){
      archives.push(await originalParts(root,checked.document,'original-document',binding.document.contentType,
        binding.document.contentType.startsWith('text/')?'txt':'bin'));
      const purchase=checked.envelope.originalPurchase;
      archives.push(await originalParts(root,decodePartitionBytes(purchase.response,EDITION_LIMIT),
        'original-response','application/json','json'));
      // The original request is also embedded unchanged in the complete edition.
    }else{
      archives.push(await originalParts(root,checked.body,'original-output',checked.output.contentType,
        checked.format==='json'?'json':checked.format==='text'?'txt':'bin'));
    }
    const rows=documentRows(checked,provider,editionSha256);
    const rowCount=provider==='unstructured'?checked.elements.length:checked.items.length;
    need(rowCount<=1000000,'RESEARCH_ANALYSIS_ROW_COUNT_LIMIT');
    const document=await publishCsv(root,rows);
    const receipt={identity:receiptIdentity,rowCount,mapping:RESEARCH_ANALYSIS_MAPPING,
      workbookTextPreview:{column:'text_preview_json',encoding:'ASCII JSON string',
        maximumCharacters:2000,completeColumn:'text_preview_complete',lengthColumn:'text_characters'},
      complete:value.status==='AVAILABLE',status:value.status,warnings:value.warnings??[],
      native:provider==='unstructured'?binding.native:null,
      inputs:provider==='unstructured'?[binding.document]:checked.inputs,
      output:provider==='unstructured'?{sha256:binding.responseSha256,bytes:binding.responseBytes}:checked.output,
      archives};
    const receiptFile=await publish(root,json(receipt),'json','application/json');
    const originals=archives.flatMap(item=>item.parts.map(({offset,...part})=>part));
    originals.push({...receiptFile,role:'analysis-receipt'});
    need(originals.length<=32,'RESEARCH_ANALYSIS_ORIGINAL_COUNT_LIMIT');
    const manifest={schema:ANALYSIS_SOURCE_SCHEMA,title,format:'csv',document,originals,
      provenance:{kind:'operator-file',publisher:'Stellar Forge Research',
        capturedAt,scope:'Original '+provider+' retained edition '+editionSha256,
        description:'One row per original output occurrence. Text and complete JSON metadata are retained without deduplication. '+
          'The source archive includes the original research edition and original document/response or job output. '+
          'Large originals are losslessly split into ordered parts described by the retained analysis receipt.'},
      complete:receipt.complete};
    await manifestFiles(root,manifest);
    const bytes=json(manifest);need(bytes.length<=MANIFEST_LIMIT,'RESEARCH_ANALYSIS_MANIFEST_LIMIT');
    const temporary=join(root,'.research-manifest-'+randomUUID());let file;
    try{
      file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
      await link(temporary,join(root,'source.json'));await unlink(temporary);await syncDirectory(root);
    }finally{if(file)await file.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    return {manifestFile:join(root,'source.json'),documentId:hash(bytes),manifest,receipt,replayed:false};
  });
}

// MIT. Bounded coastal exports; original raw responses and mapped values remain pinned.
import {open,link,unlink,lstat,readFile} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {privateDirectory,jsonBytes,stable} from '../stellar-expert/store.mjs';
import {COLUMNS,SOURCE_CONTRACT} from './schema.mjs';
import {iterateEditionRows} from './domain.mjs';
import {fault,text,hashBytes} from './provider.mjs';
const MAX=1024*1024*1024,ID=/^[a-z0-9-]{8,100}$/;
const cell=v=>{const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
export function mappingValue(input){
 const name=text(input.name,'a model-input mapping name',160),note=text(input.note,'the model-input decision and receiving convention',12000);
 if(!['observations','predictions'].includes(input.table))throw fault('COOPS_MAPPING','A model-input mapping selects observations or predictions separately.');
 if(!Array.isArray(input.columns)||input.columns.length<3||input.columns.length>64)throw fault('COOPS_MAPPING','Choose three to 64 explicit source columns.');
 const headings=new Set(),sources=new Set(),columns=input.columns.map(c=>{
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['source','heading'].includes(k))||!COLUMNS.includes(c.source))throw fault('COOPS_MAPPING','Each mapped column needs one original source field and heading.');
  const heading=text(c.heading,'a receiving column heading',100);if(/[\r\n]/.test(heading)||headings.has(heading)||sources.has(c.source))throw fault('COOPS_MAPPING','Use distinct single-line headings and source columns.');
  headings.add(heading);sources.add(c.source);return{source:c.source,heading};
 });
 for(const required of ['editionId','recordId','sourcePageSha256'])if(!sources.has(required))throw fault('COOPS_MAPPING_PROVENANCE','Keep editionId, recordId and sourcePageSha256 in the receiving mapping.');
 return{name,table:input.table,columns,note,transform:'Field selection and column renaming only. Original values, precision and empty/null distinctions remain unchanged; datum/time/unit conversion is outside this mapping.'};
}
async function identity(path){
 const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX)throw fault('COOPS_EXPORT_FILE','The retained native export is not its expected bounded regular file.',409);
 const digest=createHash('sha256');let bytes=0;for await(const part of createReadStream(path)){bytes+=part.length;digest.update(part);}
 if(bytes!==stat.size)throw fault('COOPS_EXPORT_CHANGED','The retained export changed while being read.',409);
 return{bytes,sha256:digest.digest('hex')};
}
async function same(path,expected){const found=await identity(path);if(found.bytes!==expected.bytes||found.sha256!==expected.sha256)throw fault('COOPS_EXPORT_CHANGED','The retained export bytes changed.',409);return found;}
export async function materializeExport(store,item,producer,{maximum=MAX}={}){
 if(!ID.test(item.id))throw fault('COOPS_EXPORT_ID','Use an original native export identity.');
 const directory=await privateDirectory(join(store.root,'exports'),{create:true}),target=join(directory,item.id+'.body'),receiptPath=join(directory,item.id+'.receipt.json'),
  selectionSha256=hashBytes(Buffer.from(stable(item)));
 let prior;
 try{prior=JSON.parse(await readFile(receiptPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(prior){if(prior.selectionSha256!==selectionSha256)throw fault('COOPS_EXPORT_SELECTION','The original export identity belongs to another selection.',409);await same(target,prior);return prior;}
 const temporary=join(directory,'.'+item.id+'.'+randomBytes(12).toString('hex')+'.tmp'),handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 const digest=createHash('sha256');let bytes=0,finished=false;
 try{
  for await(const value of producer()){
   const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);bytes+=chunk.length;
   if(bytes>maximum)throw fault('COOPS_EXPORT_CAPACITY','The selected export exceeds its declared byte limit. Choose a narrower source selection.',413);
   digest.update(chunk);let offset=0;while(offset<chunk.length){const written=await handle.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw fault('COOPS_EXPORT_WRITE','The export writer did not advance.',507);offset+=written.bytesWritten;}
  }
  await handle.sync();await handle.close();finished=true;
  const sha256=digest.digest('hex');
  try{await link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;await same(target,{bytes,sha256});}
  const dir=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY);try{await dir.sync();}finally{await dir.close();}
  const receipt={...item,selectionSha256,relativeFile:'exports/'+item.id+'.body',bytes,sha256,downloadUrl:'/api/exports/'+item.id};
  await store.immutable(receiptPath,jsonBytes(receipt));return receipt;
 }finally{if(!finished)await handle.close().catch(()=>{});await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export async function retainedExport(store,item){
 if(!ID.test(item.id)||item.relativeFile!=='exports/'+item.id+'.body')throw fault('COOPS_EXPORT_FILE','Use the original retained export path.',409);
 const path=join(store.root,item.relativeFile);await same(path,item);return{item,path,stream:()=>createReadStream(path)};
}
export async function writeTableExport(store,{id,editions,annotations,table,format,mapping=null,createdAt,backfill=null}){
 if(!['json','jsonl','csv'].includes(format))throw fault('COOPS_EXPORT','Choose JSON, JSONL or CSV for a streamed table.');
 if(mapping&&mapping.table!==table)throw fault('COOPS_MAPPING_TABLE','The selected model-input mapping belongs to another table.');
 const columns=mapping?mapping.columns.map(c=>c.heading):COLUMNS,fields=mapping?mapping.columns.map(c=>c.source):COLUMNS,
  metadata={schema:'stellar-forge.coops-table-export.v1',editionIds:editions.map(e=>e.id),sourceIdentities:editions.map(e=>({id:e.id,query:e.query,sourceSha256:e.sourceSha256})),table,columns,mapping,annotations,backfill,source:SOURCE_CONTRACT},
  item={id,kind:'edition',editionId:editions.length===1?editions[0].id:null,backfillId:backfill?.id??null,editionIds:metadata.editionIds,table,format,
   mappingId:mapping?.id??null,mapping:structuredClone(mapping),metadata,createdAt,name:'coops-'+(backfill?.id??editions[0].id).slice(0,20)+'.'+table+'.'+format,
   type:format==='csv'?'text/csv; charset=utf-8':format==='jsonl'?'application/x-ndjson; charset=utf-8':'application/json; charset=utf-8'};
 return materializeExport(store,item,async function*(){
  if(format==='csv')yield columns.map(cell).join(',')+'\r\n';
  if(format==='json')yield JSON.stringify(metadata).slice(0,-1)+',"rows":[';
  let first=true;
  for(const edition of editions)for await(const row of iterateEditionRows(store,edition,{table})){
   const selected=Object.fromEntries(columns.map((heading,i)=>[heading,row[fields[i]]]));
   if(format==='csv')yield columns.map(c=>cell(selected[c])).join(',')+'\r\n';
   else if(format==='jsonl')yield JSON.stringify(selected)+'\n';
   else{if(!first)yield',';yield JSON.stringify(selected);first=false;}
  }
  if(format==='json')yield']}\n';
 });
}
export async function writeSourcePackage(store,{id,edition,annotations,createdAt}){
 const item={id,kind:'edition',editionId:edition.id,table:'source',format:'source-package',createdAt,
  name:'coops-'+edition.query.stationId+'-'+edition.id.slice(0,12)+'.source.json',type:'application/json; charset=utf-8'};
 return materializeExport(store,item,async function*(){
  yield JSON.stringify({schema:'stellar-forge.coops-capture-package.v1',edition,annotations,source:SOURCE_CONTRACT}).slice(0,-1)+',"responses":[';
  for(let i=0;i<edition.pages.length;i++){if(i)yield',';const receipt=edition.pages[i];yield JSON.stringify({receipt,base64:(await store.object(receipt.sha256)).toString('base64')});}
  yield'],"failedResponses":[';
  for(let i=0;i<(edition.failedResponses?.length??0);i++){if(i)yield',';const receipt=edition.failedResponses[i];yield JSON.stringify({receipt,base64:(await store.object(receipt.sha256)).toString('base64')});}
  yield']}\n';
 },{maximum:64*1024*1024});
}

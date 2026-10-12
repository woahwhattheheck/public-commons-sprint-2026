// MIT. Retain complete originals; mappings never rewrite or discard source bytes.
import { open, readdir, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MAX_SOURCE, UUID, plain, own, canonical, encode, digest, fault, string, choice, period,
  id, privateDir, writeOnce, readPrivate, hashPrivate, syncDir, utf8, page } from './common.mjs';

export const SOURCE_KINDS=['BILL','CREDIT_NOTE','QUOTE','USAGE','ACCOUNTING','SUPPORT'];
export const CHARGE_FIELDS=['reference','supplier','kind','currency','amount','quantity','unit','description'];
export const MAX_LINES=10000;
export function sourceMetadata(input) {
  if(!plain(input))throw fault('SOURCE_METADATA_REQUIRED','Name and classify the original source.');
  const value={label:string(input.label,'Source label',160),name:string(input.name,'Original filename',180),
    kind:choice(input.kind,SOURCE_KINDS,'source kind'),supplier:string(input.supplier??'','Supplier',160,{empty:true}),
    reference:string(input.reference??'','Source reference',300,{empty:true}),
    period:input.period===null||input.period===undefined?null:period(input.period),
    note:string(input.note??'','Source note',2000,{empty:true}),url:input.url??null};
  if(value.url!==null){let url;try{url=new URL(value.url);}catch{}
    if(!url||url.protocol!=='https:'||url.username||url.password||value.url.length>2000)
      throw fault('SOURCE_URL_INVALID','Use a public HTTPS reference URL without credentials, or leave it blank.');}
  return value;
}
export async function openSources(root) {
  await privateDir(root,true);
  const pending=join(root,'pending'),records=join(root,'records');await privateDir(pending,true);await privateDir(records,true);
  async function get(sourceId,{verify=false}={}) {
    id(sourceId,'Source');const folder=join(records,sourceId);
    const bytes=await readPrivate(join(folder,'source.json')),value=JSON.parse(utf8(bytes));
    if(value.schema!=='stellar-forge.merchant-cost-source.v1'||value.sourceId!==sourceId||
        typeof value.sha256!=='string'||!Number.isSafeInteger(value.bytes))throw fault('SOURCE_CHANGED','The source receipt is invalid.');
    if(verify){const actual=await hashPrivate(join(folder,'original'),MAX_SOURCE);
      if(actual.sha256!==value.sha256||actual.bytes!==value.bytes)throw fault('SOURCE_CHANGED','The original source no longer matches its receipt.');}
    return {...value,receiptSha256:digest(bytes)};
  }
  async function bytes(sourceId){const value=await get(sourceId),raw=await readPrivate(join(records,sourceId,'original'),MAX_SOURCE);
    if(digest(raw)!==value.sha256||raw.length!==value.bytes)throw fault('SOURCE_CHANGED','The retained original has changed.');return raw;}
  async function all() {
    const rows=[];for(const item of await readdir(records,{withFileTypes:true})){
      if(!item.isDirectory()||!UUID.test(item.name))throw fault('SOURCE_DIRECTORY_CHANGED','Unexpected entry in the private source directory.');
      rows.push(await get(item.name));}
    return rows.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.sourceId.localeCompare(b.sourceId));
  }
  async function upload({requestId,metadata,body,origin='OPERATOR_UPLOAD'}) {
    id(requestId,'Upload request ID');const meta=sourceMetadata(metadata),temp=join(pending,randomUUID());
    await privateDir(temp,true);let moved=false;
    try{
      const handle=await open(join(temp,'original'),'wx',0o600),hash=createHash('sha256');let count=0;
      try{for await(const chunk of body){const data=Buffer.from(chunk);count+=data.length;
        if(count>MAX_SOURCE)throw fault('SOURCE_TOO_LARGE','Original uploads are limited to 16 MiB.',413);
        hash.update(data);await handle.writeFile(data);}await handle.sync();}
      finally{await handle.close();}
      if(!count)throw fault('EMPTY_SOURCE','Choose a nonempty original source.');
      const sha256=hash.digest('hex'),requestSha256=digest(canonical({metadata:meta,sha256,bytes:count,origin}));
      let existing=null;try{existing=await get(requestId,{verify:true});}catch(e){if(e.code!=='ENOENT')throw e;}
      if(existing){if(existing.requestSha256!==requestSha256)throw fault('REQUEST_CHANGED','Upload request ID was already used for different original bytes or metadata.',409);
        return {...existing,replayed:true};}
      const value={schema:'stellar-forge.merchant-cost-source.v1',sourceId:requestId,requestSha256,
        receivedAt:new Date().toISOString(),origin,metadata:meta,sha256,bytes:count};
      await writeOnce(join(temp,'source.json'),encode(value));await syncDir(temp);
      try{await rename(temp,join(records,requestId));moved=true;}
      catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;
        const winner=await get(requestId,{verify:true});
        if(winner.requestSha256!==requestSha256)throw fault('REQUEST_CHANGED','A different upload already owns this request ID.',409);
        return {...winner,replayed:true};}
      await syncDir(records);return {...await get(requestId),replayed:false};
    }finally{if(!moved)await rm(temp,{recursive:true,force:true}).catch(()=>{});}
  }
  async function inspect(sourceId,{delimiter=',',after=null,limit=20}={}) {
    const source=await get(sourceId),raw=await bytes(sourceId);
    let value=null,jsonError=null;try{value=JSON.parse(utf8(raw));}catch(e){jsonError=e.message;}
    if(value?.schema==='stellar-forge.supplier-quotas.v1'){
      if(!Array.isArray(value.accounts))throw fault('NATIVE_SOURCE_INVALID','Original supplier snapshot lacks its accounts.');
      return {source,format:'SUPPLIER_QUOTAS',schema:value.schema,capturedAt:value.capturedAt,accounts:value.accounts,
        semantics:'One original quota unit is one attempted provider dispatch. Account membership does not assign billed money, weighted provider credits or per-route usage.'};
    }
    if(value?.schema==='stellar-forge.seller-upstream-availability.v1'){
      if(!Array.isArray(value.bindings))throw fault('NATIVE_SOURCE_INVALID','Original upstream snapshot lacks its bindings.');
      return {source,format:'UPSTREAM_AVAILABILITY',schema:value.schema,capturedAt:value.capturedAt,bindings:value.bindings,
        semantics:'Handler started/completed can include failures before dispatch. Cache hits and replay differ from provider calls. These diagnostic totals are not supplier invoices.'};
    }
    if(value?.schema==='stellar-forge.merchant-reconciliation.v1'){
      if(!Array.isArray(value.options)||!Array.isArray(value.routes)||!Array.isArray(value.ledger))
        throw fault('NATIVE_SOURCE_INVALID','Original accounting report lacks its native ledger or option groups.');
      return {source,format:'MERCHANT_ACCOUNTING',schema:value.schema,createdAt:value.createdAt,period:value.period??null,
        hashes:value.hashes??null,totals:value.totals,routes:value.routes,options:value.options,accountingStatus:value.accountingStatus,
        ledgerCount:value.ledger.length,exceptionCount:value.exceptions?.length??0,
        semantics:'Original independent transfer reconciliation is retained as supplied. Matched atomic amounts keep their asset/network/recipient groups. Quoted USD is not cash or an FX conversion.'};
    }
    if(value!==null)return {source,format:'JSON',schema:value?.schema??null,keys:plain(value)?Object.keys(value):null};
    if(/\.(csv|tsv)$/i.test(source.metadata.name)){
      const parsed=parseDelimited(raw,delimiter);
      return {source,format:'DELIMITED',delimiter,headers:parsed.headers,rowCount:parsed.rows.length,
        ...page(parsed.rows.map((cells,index)=>({row:index+1,cells})),{after,limit})};
    }
    return {source,format:'ORIGINAL_FILE',parseableJson:false};
  }
  async function mapCharges(input) {
    const source=await get(input.sourceId);choice(source.metadata.kind,['BILL','CREDIT_NOTE','QUOTE'],'charge source kind');
    const parsed=parseDelimited(await bytes(input.sourceId),input.delimiter??',');
    const mapping=compileMapping(input.mapping,parsed.headers),lines=parsed.rows.map((cells,index)=>{
      const fields=Object.fromEntries(CHARGE_FIELDS.map(field=>[field,mapped(mapping[field],parsed.headers,cells)]));
      return {id:source.sourceId+':'+(index+1),sourceId:source.sourceId,sourceRow:index+1,
        reference:fields.reference??'',supplier:fields.supplier??source.metadata.supplier,
        kind:fields.kind??source.metadata.kind,currency:fields.currency??'',amount:fields.amount??'',
        quantity:fields.quantity===null||fields.quantity===''?null:fields.quantity,
        unit:fields.unit??'',description:fields.description??'',allocations:[]};
    });
    return {sourceId:source.sourceId,sourceSha256:source.sha256,delimiter:input.delimiter??',',mapping,
      headers:parsed.headers,rowCount:lines.length,lines};
  }
  return {root,records,get,bytes,all,upload,inspect,mapCharges};
}
export function parseDelimited(bytes,delimiter=',') {
  choice(delimiter,[',','\t',';','|'],'delimiter');
  const text=utf8(bytes).replace(/^\uFEFF/,'');let row=[],cell='',quoted=false,closed=false,rows=[];
  const addCell=()=>{if(cell.length>65536||row.length>=256)throw fault('CSV_LIMIT','CSV supports up to 256 columns and 65,536 characters per cell.');
    row.push(cell);cell='';closed=false;};
  const addRow=()=>{addCell();rows.push(row);row=[];if(rows.length>MAX_LINES+1)throw fault('CSV_LIMIT','Charge CSV supports up to 10,000 data rows.');};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c===delimiter){addCell();continue;}
    if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;addRow();continue;}
    if(closed)throw fault('CSV_SYNTAX','Unexpected data after a quoted CSV field.');
    if(c==='"'){if(cell!=='')throw fault('CSV_SYNTAX','Quote must start at the beginning of a CSV field.');quoted=true;}
    else cell+=c;
  }
  if(quoted)throw fault('CSV_SYNTAX','The original CSV has an unterminated quoted field.');
  if(cell!==''||row.length||closed)addRow();
  if(!rows.length)throw fault('CSV_HEADER','CSV requires a header row.');
  const headers=rows.shift();
  if(headers.some(h=>!h||h!==h.trim())||new Set(headers).size!==headers.length)
    throw fault('CSV_HEADER','Use distinct, nonempty, unpadded column names.');
  if(rows.some(r=>r.length!==headers.length))throw fault('CSV_WIDTH','Every original data row must have the same field count as the header.');
  if(!rows.length)throw fault('CSV_EMPTY','CSV contains no charge rows.');
  return {headers,rows};
}
export function compileMapping(input,headers) {
  if(!plain(input)||Object.keys(input).some(key=>!CHARGE_FIELDS.includes(key)))throw fault('MAPPING_INVALID','Map only the documented charge fields.');
  const result={};for(const field of CHARGE_FIELDS){
    const rule=input[field];if(rule===null||rule===undefined){result[field]=null;continue;}
    if(!plain(rule)||Object.keys(rule).some(k=>!['column','constant','trim'].includes(k))||
        own(rule,'column')===own(rule,'constant')||(rule.trim!==undefined&&typeof rule.trim!=='boolean'))
      throw fault('MAPPING_INVALID','Each mapped field needs one original column or one explicit text constant.');
    if(own(rule,'column')&&!headers.includes(rule.column))throw fault('MAPPING_COLUMN_MISSING','A selected column is absent from the original CSV.');
    if(own(rule,'constant'))string(rule.constant,'Mapping constant',2000,{empty:true});
    result[field]={...rule,trim:rule.trim===true};
  }
  return result;
}
function mapped(rule,headers,cells){if(rule===null)return null;let value=own(rule,'constant')?rule.constant:cells[headers.indexOf(rule.column)];
  return rule.trim?value.trim():value;}

/** Original workbook bytes and reversible worksheet lineage in the existing store. */
import {createHash} from 'node:crypto';
import {InputError,parseCSV} from './parse.mjs';
export const LINEAGE_SCHEMA='upper-savannah-measurement-source-lineage/v1';
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const fail=message=>{throw new InputError(message);};
const need=(condition,message)=>{if(!condition)fail(message);};
export function initialiseLineage(s){
  s.db.exec('CREATE TABLE IF NOT EXISTS intake_binary_sources(sha TEXT PRIMARY KEY,bytes INTEGER NOT NULL,content BLOB NOT NULL);');
}
export function validateOriginal(file){
  need(object(file)&&sha(file.sha256)&&integer(file.bytes)&&typeof file.data==='string','The complete original workbook identity is invalid.');
  need(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data),'The original binary encoding is invalid.');
  const raw=Buffer.from(file.data,'base64');
  need(raw.length===file.bytes&&raw.toString('base64')===file.data&&digest(raw)===file.sha256,'The complete original workbook bytes changed.');
  return raw;
}
export function originalMap(files=[]){
  need(Array.isArray(files),'Keep the complete original binary collection.');
  const map=new Map();
  for(const file of files){
    validateOriginal(file);
    need(!map.has(file.sha256),'The original binary is repeated in this packet.');
    map.set(file.sha256,file);
  }
  return map;
}
function position(value){
  need(object(value)&&integer(value.source_row)&&value.source_row>0&&
    integer(value.source_line_start)&&value.source_line_start>0&&
    integer(value.source_line_end)&&value.source_line_end>=value.source_line_start,
    'An original worksheet row or physical source-line range changed.');
}
export function validateLineage(value,text,originals){
  need(object(value)&&value.schema===LINEAGE_SCHEMA,'Unknown original worksheet lineage.');
  for(const key of ['project_id','source_id']) {
    need(typeof value[key]==='string'&&value[key].length>0,'The original source '+key+' is missing.');
  }
  need(sha(value.source_collection_id)&&sha(value.inspection_id),'The original source collection or inspection is missing.');
  const file=value.original;
  need(object(file)&&sha(file.sha256)&&integer(file.bytes)&&typeof file.filename==='string'&&file.filename.length>0,'Keep the original workbook filename and full identity.');
  if(originals){
    const original=originals.get(file.sha256);
    need(original&&original.bytes===file.bytes,'The complete selected original binary is absent from this preparation.');
  }
  need(value.sheet===null||typeof value.sheet==='string','Keep the exact original worksheet selection.');
  const reading=value.reading;
  need(object(reading)&&['utf-8-sig','utf-16','cp1252'].includes(reading.encoding)&&
    integer(reading.header_row)&&reading.header_row>=1&&reading.header_row<=10000&&
    ['formulas','cached'].includes(reading.formula_mode)&&
    (reading.delimiter===undefined||[',',';','\t','|'].includes(reading.delimiter)),
    'Keep the complete original file reading choices.');
  need(['worksheet-row','csv-record'].includes(value.source_row_kind),'Keep the original row-number meaning.');
  const derived=value.derived;
  need(object(derived)&&derived.format==='csv'&&sha(derived.sha256)&&integer(derived.bytes)&&typeof derived.filename==='string',
    'The complete derived worksheet identity is missing.');
  need(typeof text==='string'&&Buffer.byteLength(text)===derived.bytes&&digest(text)===derived.sha256,'The selected worksheet text changed.');
  const parsed=parseCSV(text);
  need(parsed.rejected.length===0,'The mechanical worksheet projection has malformed native CSV rows.');
  need(Array.isArray(value.columns)&&value.columns.length===parsed.headers.length,'The complete original column map is missing.');
  const ids=new Set();
  for(const [index,column] of value.columns.entries()){
    need(object(column)&&column.index===index&&column.column_id==='c'+index&&
      typeof column.original_label==='string'&&column.transport_column===parsed.headers[index]&&!ids.has(column.column_id),
      'A worksheet column or its retained original label changed.');
    ids.add(column.column_id);
  }
  need(integer(value.original_record_count)&&value.original_record_count>=reading.header_row&&
    Array.isArray(value.rows)&&Array.isArray(value.excluded_rows)&&value.rows.length===parsed.rows.length,
    'The original full row accounting is incomplete.');
  const covered=new Map();
  let previous=reading.header_row;
  for(const [index,row]of value.rows.entries()){
    position(row);
    need(row.line===parsed.rows[index].line&&row.source_row>previous&&!covered.has(row.source_row),
      'A native source line no longer matches its original worksheet row.');
    previous=row.source_row;covered.set(row.source_row,row);
  }
  for(const row of value.excluded_rows){
    position(row);
    need(['header','preamble','blank','empty-derived'].includes(row.reason)&&!covered.has(row.source_row),'An excluded original row has no precise retained reason.');
    need(row.reason==='header'?row.source_row===reading.header_row:
      row.reason==='preamble'?row.source_row<reading.header_row:row.source_row>reading.header_row,
      'The original header/preamble/data row boundaries changed.');
    covered.set(row.source_row,row);
  }
  need(covered.size===value.original_record_count,'The complete original row population is not retained.');
  let lastEnd=0;
  for(let row=1;row<=value.original_record_count;row++){
    const item=covered.get(row);need(item,'An original source row disappeared.');
    need(item.source_line_start===lastEnd+1,'The original physical source-line coverage has a gap.');
    if(value.source_row_kind==='worksheet-row')need(item.source_line_start===row&&item.source_line_end===row,'Worksheet positions must retain their original row numbers.');
    lastEnd=item.source_line_end;
  }
  return value;
}
export function readOriginal(s,checksum){
  need(sha(checksum),'Choose a complete original binary identity.');
  const row=s.db.prepare('SELECT * FROM intake_binary_sources WHERE sha=?').get(checksum);
  need(row,'The complete original workbook is missing.');
  const raw=Buffer.from(row.content);
  need(raw.length===row.bytes&&digest(raw)===checksum,'The stored original binary changed.');
  return {sha256:checksum,bytes:raw.length,data:raw.toString('base64')};
}
export function retainOriginals(s,files){
  // Caller owns the existing preparation/portable transaction.
  const originals=originalMap(files);
  for(const [checksum,file]of originals){
    const current=s.db.prepare('SELECT * FROM intake_binary_sources WHERE sha=?').get(checksum);
    if(current){
      need(current.bytes===file.bytes&&Buffer.from(current.content).equals(validateOriginal(file)),'The original binary identity conflicts with existing work.');
    }else s.db.prepare('INSERT INTO intake_binary_sources VALUES(?,?,?)').run(checksum,file.bytes,validateOriginal(file));
  }
  return originals;
}
export function validateStoredLineage(s,value,text){
  if(value.lineage===undefined)return;
  const file=readOriginal(s,value.lineage.original.sha256);
  validateLineage(value.lineage,text,new Map([[file.sha256,file]]));
  need(value.sourceSha===value.lineage.derived.sha256,'Preparation and original worksheet identities differ.');
}
export function exportOriginals(s,editions){
  const checksums=[...new Set(editions.filter(e=>e.value.lineage).map(e=>e.value.lineage.original.sha256))].sort();
  return checksums.map(checksum=>readOriginal(s,checksum));
}
export function validateLineagePacket(packet,sources){
  const originals=originalMap(packet.originals||[]),used=new Set();
  for(const edition of packet.editions){
    if(edition.value.lineage===undefined)continue;
    const lineage=edition.value.lineage,text=sources.get(edition.value.sourceSha);
    validateLineage(lineage,text,originals);
    need(edition.value.sourceSha===lineage.derived.sha256,'The original worksheet and preparation source differ.');
    used.add(lineage.original.sha256);
  }
  need(used.size===originals.size&&[...originals.keys()].every(key=>used.has(key)),'The packet must retain exactly its referenced original binaries.');
  return originals;
}
export function sourceLineages(s,importId){
  const rows=s.db.prepare('SELECT e.data,e.id,e.revision,r.data AS receipt FROM intake_editions e JOIN intake_receipts r ON r.id=e.id AND r.revision=e.revision ORDER BY e.id,e.revision').all(),result=[];
  for(const row of rows){
    const receipt=JSON.parse(row.receipt);
    if(receipt.importId!==importId)continue;
    const value=JSON.parse(row.data);if(!value.lineage)continue;
    validateStoredLineage(s,value,s.db.prepare('SELECT content FROM intake_sources WHERE sha=?').get(value.sourceSha)?.content);
    result.push({id:row.id,revision:row.revision,lineage:value.lineage});
  }
  return result;
}

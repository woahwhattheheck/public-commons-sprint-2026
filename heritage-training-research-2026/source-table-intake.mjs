// MIT. Retained preparation over the original document-table source and projection.
import { validateDocumentTableSource, inspectDocumentTables } from './source-document-tables.mjs';
export const DOCUMENT_INTAKE_SCHEMA = 'stellar-forge.document-table-intake.v1';
export const DOCUMENT_INTAKE_PACKET_SCHEMA = 'stellar-forge.document-table-intake-packet.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const fail = message => { throw Object.assign(new Error(message), { code: 'DOCUMENT_INTAKE_INVALID' }); };
const need = (value, message) => { if (!value) fail(message); };
const FIELD_LIMITS = Object.freeze({headerRows:1048576,dataRows:1048576,columns:16384,exclusions:4194304,mergedCells:20,whitespace:20,filename:500,target:300});
export const DOCUMENT_INTAKE_FIELDS = Object.freeze(Object.keys(FIELD_LIMITS));
export function createDocumentIntake() {
  return {schema:DOCUMENT_INTAKE_SCHEMA,selectedSourceId:null,sourceDetails:{url:'',filename:'',provider:''},sources:[]};
}
function fields(value) {
  need(object(value), 'Keep every unfinished document-selection field.');
  for (const [key, maximum] of Object.entries(FIELD_LIMITS))
    need(typeof value[key] === 'string' && value[key].length <= maximum && !value[key].includes('\u0000'),
      'The unfinished '+key+' field exceeds its supported complete size.');
  need(['anchor','repeat','reject'].includes(value.mergedCells) && ['preserve','trim','collapse'].includes(value.whitespace),
    'Keep the original merged-cell and whitespace choices.');
  return Object.fromEntries(DOCUMENT_INTAKE_FIELDS.map(key => [key,value[key]]));
}
function page(value, label) { need(Number.isSafeInteger(value) && value >= 0, 'Keep a valid '+label+' page.'); return value; }
function snapshot(value) {
  return {fields:fields(value.fields),rowPage:page(value.rowPage,'row'),columnPage:page(value.columnPage,'column')};
}
export function captureDocumentPreparation(intake, sourceId, tableIndex, value, {replace=false}={}) {
  const next = clone(intake), current = snapshot(value);
  let source = next.sources.find(row => row.sourceId === sourceId);
  if (!source) { source={sourceId,selectedTable:tableIndex,tables:[]}; next.sources.push(source); }
  let table = source.tables.find(row => row.tableIndex === tableIndex);
  if (!table) { table={tableIndex,...current,history:[]};source.tables.push(table); }
  else {
    const prior=snapshot(table);
    if (replace && !same(prior,current) && !table.history.some(row=>same(snapshot(row),prior)))
      table.history.push({...prior,retainedAt:new Date().toISOString()});
    Object.assign(table,current);
  }
  source.selectedTable=tableIndex;next.selectedSourceId=sourceId;
  return next;
}
export function documentPreparation(intake, sourceId, tableIndex) {
  const value=intake.sources.find(row=>row.sourceId===sourceId)?.tables.find(row=>row.tableIndex===tableIndex);
  return value ? clone(value) : null;
}
export function restoreDocumentPreparation(intake, sourceId, tableIndex, historyIndex) {
  const current=documentPreparation(intake,sourceId,tableIndex);
  need(current && Number.isSafeInteger(historyIndex) && current.history[historyIndex], 'Choose an original retained preparation.');
  return captureDocumentPreparation(intake,sourceId,tableIndex,current.history[historyIndex],{replace:true});
}
export async function validateDocumentIntake(input, sources) {
  need(object(input) && input.schema===DOCUMENT_INTAKE_SCHEMA && Array.isArray(input.sources), 'Choose a complete document-intake draft.');
  need(Array.isArray(sources), 'Keep the original extracted sources with their unfinished preparations.');
  const next=clone(input), originals=new Map(), seen=new Set();
  for (const source of sources) {
    need(!originals.has(source.id), 'Keep each original extracted source once.');
    originals.set(source.id,source);
  }
  need(object(next.sourceDetails), 'Keep the original new-source details.');
  for(const [key,max] of [['url',4000],['filename',500],['provider',500]])
    need(typeof next.sourceDetails[key]==='string' && next.sourceDetails[key].length<=max && !next.sourceDetails[key].includes('\u0000'),
      'Keep the complete original document '+key+'.');
  for(const source of next.sources) {
    need(object(source) && typeof source.sourceId==='string' && !seen.has(source.sourceId) && Array.isArray(source.tables),
      'Keep each prepared extraction and table once.');
    seen.add(source.sourceId);const original=originals.get(source.sourceId);
    need(original,'A prepared extraction is missing its complete original source.');
    const inspected=await inspectDocumentTables(original), tables=new Map(inspected.tables.map(row=>[row.tableIndex,row])), selected=new Set();
    for(const table of source.tables) {
      need(object(table) && tables.has(table.tableIndex) && !selected.has(table.tableIndex) && Array.isArray(table.history),
        'Keep the original prepared table and its complete earlier choices.');
      selected.add(table.tableIndex);Object.assign(table,snapshot(table));
      const native=tables.get(table.tableIndex);
      need(table.rowPage*20<native.rowCount && table.columnPage*12<native.columnCount,'The saved preview page is outside its original table.');
      for(const prior of table.history) {
        need(object(prior) && typeof prior.retainedAt==='string' && Number.isFinite(Date.parse(prior.retainedAt)), 'Keep the original preparation retention time.');
        Object.assign(prior,snapshot(prior));
        need(prior.rowPage*20<native.rowCount && prior.columnPage*12<native.columnCount,'An earlier preview page is outside its source table.');
      }
    }
    need(selected.has(source.selectedTable),'The selected preparation is absent from its retained extraction.');
  }
  need(next.selectedSourceId===null || seen.has(next.selectedSourceId),'The selected extracted source is absent.');
  return next;
}
export async function createDocumentIntakePacket(intake, originals) {
  const sourceIds=new Set(intake.sources.map(row=>row.sourceId));
  const sources=originals.filter(row=>sourceIds.has(row.id)).map(clone);
  const verified=await validateDocumentIntake(intake,sources);
  const packet={schema:DOCUMENT_INTAKE_PACKET_SCHEMA,sources,intake:verified};
  need(new TextEncoder().encode(JSON.stringify(packet)).length<=128*1024*1024,'The complete preparation file exceeds the 128 MiB project receiving limit.');
  return packet;
}
export async function receiveDocumentIntakePacket(current, originals, packet) {
  need(object(packet) && packet.schema===DOCUMENT_INTAKE_PACKET_SCHEMA && Array.isArray(packet.sources),'Choose a complete retained document-intake file.');
  const incoming=await validateDocumentIntake(packet.intake,packet.sources), sources=originals.map(clone);
  for(const source of packet.sources) {
    await validateDocumentTableSource(source);
    const found=sources.find(row=>row.id===source.id);
    need(!found || canonical(found)===canonical(source),'A retained extraction identity describes different source content.');
    if(!found)sources.push(clone(source));
  }
  let intake=clone(current);
  for(const source of incoming.sources) for(const table of source.tables) {
    const before=documentPreparation(intake,source.sourceId,table.tableIndex);
    intake=captureDocumentPreparation(intake,source.sourceId,table.tableIndex,table,{replace:true});
    const retained=intake.sources.find(row=>row.sourceId===source.sourceId).tables.find(row=>row.tableIndex===table.tableIndex);
    for(const prior of table.history)
      if(!retained.history.some(row=>same(snapshot(row),snapshot(prior))))retained.history.push(clone(prior));
    if(before && same(snapshot(before),snapshot(table)))retained.history=clone(before.history).concat(retained.history.filter(row=>!before.history.some(prior=>same(snapshot(prior),snapshot(row)))));
  }
  for(const source of incoming.sources) intake.sources.find(row=>row.sourceId===source.sourceId).selectedTable=source.selectedTable;
  intake.selectedSourceId=incoming.selectedSourceId;intake.sourceDetails=clone(incoming.sourceDetails);
  return {intake:await validateDocumentIntake(intake,sources),sources};
}

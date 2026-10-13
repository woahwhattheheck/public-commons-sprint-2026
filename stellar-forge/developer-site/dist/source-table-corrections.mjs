// MIT. Explicit reviewed decisions over complete, immutable source records.
import { parseTable, DELIMITERS, SourceTableError } from './source-delimited.mjs';
export const CORRECTIONS_SCHEMA = 'stellar-forge.source-table-corrections.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const fail = message => { throw new SourceTableError('SOURCE_CORRECTION',message); };
const required = (value,label,max=4000) => { if(typeof value!=='string'||!value.trim()||value.length>max)fail(label+' is required and must be at most '+max+' characters.');return value; };
export function correctionContext(edition,mapping) {
  return {editionId:edition.id,sourceSha256:edition.sha256,parser:{delimiter:DELIMITERS[mapping.delimiter]||mapping.delimiter||',',header:mapping.header!==false,skipEmptyRecords:!!mapping.skipEmptyRecords}};
}
export function correctionState(edition,mapping,value) {
  const context=correctionContext(edition,mapping), parsed=parseTable(edition.sourceText,context.parser);
  const records=new Map(parsed.rows.map(row=>[row.record,row])),cells=new Map(),excluded=new Map();
  if(value==null)return {parsed,cells,excluded,revision:0};
  if(value.schema!==CORRECTIONS_SCHEMA||!equal(value.context,context)||!Array.isArray(value.history)||value.revision!==value.history.length||value.history.length>100000)fail('The correction history does not match this complete source edition and parsing choices.');
  const ids=new Set();
  for(const entry of value.history){
    required(entry.id,'Decision ID',200);required(entry.actor,'Reviewer',200);required(entry.reason,'Reason');
    if(ids.has(entry.id)||!Number.isFinite(Date.parse(entry.at)))fail('A correction ID is duplicated or its timestamp is invalid.');ids.add(entry.id);
    const row=records.get(entry.record);if(!row)fail('A correction must identify an original data record under the retained parsing choices.');
    const cell=entry.action==='set-cell'||entry.action==='restore-cell';
    if(!cell&&!['exclude-row','restore-row'].includes(entry.action))fail('Unknown source correction action.');
    if(cell&&(!Number.isInteger(entry.column)||entry.column<0||entry.column>=parsed.width))fail('Choose an original source column.');
    const key=cell?entry.record+':'+entry.column:entry.record,target=cell?cells:excluded;
    const original=cell?row.cells[entry.column]:row.cells;
    if(!equal(entry.original,original)||!equal(entry.before,target.get(key)||null))fail('A correction original or prior decision does not reproduce.');
    const restore=entry.action.startsWith('restore-');
    if(restore){if(!target.has(key)||entry.after!==null)fail('Only an existing decision can be restored.');target.delete(key);}
    else{
      const after=cell?{id:entry.id,value:entry.after?.value,reason:entry.reason,actor:entry.actor,at:entry.at}:{id:entry.id,reason:entry.reason,actor:entry.actor,at:entry.at};
      if(cell&&(typeof after.value!=='string'||after.value.length>16*1024*1024))fail('A replacement must be source text within the source-size limit.');
      if(!equal(entry.after,after))fail('The recorded selected decision is incomplete.');
      target.set(key,after);
    }
  }
  return {parsed,cells,excluded,revision:value.revision};
}
export function applySourceCorrection(edition,mapping,prior,input) {
  const state=correctionState(edition,mapping,prior);
  const id=required(input.id,'Decision ID',200),actor=required(input.actor,'Reviewer',200),reason=required(input.reason,'Reason');
  const existing=prior?.history.find(entry=>entry.id===id);
  if(existing){
    if(existing.action!==input.action||existing.record!==input.record||existing.column!==input.column||existing.actor!==actor||existing.reason!==reason||(input.action==='set-cell'&&existing.after.value!==input.value))fail('This decision ID already belongs to different content.');
    return copy(prior);
  }
  if(!['set-cell','restore-cell','exclude-row','restore-row'].includes(input.action))fail('Unknown source correction action.');
  const row=state.parsed.rows.find(row=>row.record===input.record);
  if(!row)fail('Choose an original data record.');
  const cell=['set-cell','restore-cell'].includes(input.action),key=cell?input.record+':'+input.column:input.record;
  if(cell&&(!Number.isInteger(input.column)||input.column<0||input.column>=state.parsed.width))fail('Choose an original source column.');
  const at=input.at||new Date().toISOString();
  const next=prior?copy(prior):{schema:CORRECTIONS_SCHEMA,context:correctionContext(edition,mapping),revision:0,history:[]};
  const entry={id,at,actor,reason,action:input.action,record:input.record,...(cell?{column:input.column}:{}),original:copy(cell?row.cells[input.column]:row.cells),before:copy((cell?state.cells:state.excluded).get(key)||null),
    after:input.action.startsWith('restore-')?null:{id,...(cell?{value:input.value}:{}),reason,actor,at}};
  next.history.push(entry);next.revision++;
  correctionState(edition,mapping,next);return next;
}
export function correctionsCsv(value) {
  const esc=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  return [['id','at','actor','action','source_record','source_column_zero_based','original_json','before_json','after_json','reason'],
    ...(value?.history||[]).map(e=>[e.id,e.at,e.actor,e.action,e.record,e.column??'',JSON.stringify(e.original),JSON.stringify(e.before),JSON.stringify(e.after),e.reason])]
    .map(row=>row.map(esc).join(',')).join('\r\n')+'\r\n';
}

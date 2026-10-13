/** Original-shaped returns from one native Measurements snapshot. No scientific writes. */
import {InputError} from './parse.mjs';
export const HANDBACK_FORMAT='upper-savannah-source-handback/v1';
const clone=v=>JSON.parse(JSON.stringify(v));
const need=(v,m)=>{if(!v)throw new InputError(m,409);};
const parsed=v=>typeof v==='string'?JSON.parse(v):v;
const list=(v,name)=>{if(!Array.isArray(v)||v.some(x=>typeof x!=='string'||!x)||new Set(v).size!==v.length)throw new InputError('Choose distinct '+name);return v;};
/** Keep original heading strings, logical records, blank rows and physical row starts. */
export function originalCsvRows(text){
 if(typeof text!=='string')throw new InputError('An original CSV must be retained as complete text');
 const original=text;text=text.replace(/^\uFEFF/,'');
 let value='',row=[],quoted=false,closed=false,line=1,start=1;const rows=[];
 function field(){row.push(value);value='';closed=false;}
 function end(){field();rows.push({line:start,values:row});row=[];start=line+1;}
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else{value+=ch;if(ch==='\n')line++;}}
  else if(ch===',')field();
  else if(ch==='\r'||ch==='\n'){end();if(ch==='\r'&&text[i+1]==='\n')i++;line++;}
  else if(closed)throw new InputError('Unexpected original CSV text after closing quote at line '+line);
  else if(ch==='"'){if(value)throw new InputError('Invalid original CSV quote at line '+line);quoted=true;}
  else value+=ch;
 }
 if(quoted)throw new InputError('Unclosed original CSV field at line '+start);
 if(value||row.length||closed)end();
 const headerIndex=rows.findIndex(r=>r.values.some(v=>v!==''));
 need(headerIndex>=0,'Original CSV is empty');
 const headers=rows[headerIndex].values;
 return {headers,headerLine:rows[headerIndex].line,leadingBlankRows:rows.slice(0,headerIndex),rows:rows.slice(headerIndex+1),bom:original.startsWith('\uFEFF')};
}
function resultMembership(exports){
 const index=new Map();
 for(const source of exports){const doc=parsed(source.content);
  const add=(items,state,idKey)=>{for(const row of items||[]){const ids=[row[idKey],...(row.flowMeasurementId?[row.flowMeasurementId]:[])].filter(Boolean);
   for(const id of ids){const value=index.get(id)||[];value.push({exportId:source.id,kind:source.kind,revision:source.revision,state,role:id===row.flowMeasurementId?'flow':'measurement',value:clone(row)});index.set(id,value);}}};
  if(doc.format==='upper-savannah-calibration-input'){add(doc.accepted,'accepted','id');add(doc.excluded,'excluded','id');}
  else if(doc.format==='upper-savannah-paired-loads'){add(doc.paired,'paired','measurementId');add(doc.unpaired,'unpaired','measurementId');}
 }
 return index;
}
function nativeDetails(row,results){
 return {id:row.id,stationId:row.stationId,sourceResultId:row.sourceResultId,logicalKey:row.logicalKey,
  sampledDate:row.sampledDate,sampledAt:row.sampledAt,timePrecision:row.timePrecision,sourceTime:row.sourceTime,timeZone:row.timeZone,
  parameter:row.parameter,characteristic:row.characteristic,value:row.value,unit:row.unit,reportedValue:row.reportedValue,reportedUnit:row.reportedUnit,
  lower:row.lower,upper:row.upper,censor:row.censor,basis:row.basis,fraction:row.fraction,qualifier:row.qualifier,status:row.status,
  method:row.method,laboratory:row.laboratory,issues:row.issues,review:clone(row.review),mapping:clone(row.mapping||null),
  eligible:clone(row.eligible),variantCount:row.variantCount,selectedVersion:row.selectedVersion,results:clone(results.get(row.id)||[])};
}
export function buildSourceHandback(snapshot,input={}){
 need(Number.isSafeInteger(snapshot?.revision)&&snapshot.portable?.revision===snapshot.revision,'Use one complete original native snapshot');
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==snapshot.revision)throw new InputError('Measurements changed. Inspect the current complete source return.',409);
 const sourceIds=list(input.sourceIds,'original source identifiers'),exportIds=list(input.exportIds||[],'saved result identifiers');
 if(!sourceIds.length)throw new InputError('Choose at least one complete original source');
 const tables=snapshot.portable.tables,imports=new Map(tables.imports.map(x=>[x.id,x])),allRecords=new Map(snapshot.records.map(x=>[x.id,x]));
 const exports=exportIds.map(id=>{const x=tables.exports.find(r=>r.id===id);need(x,'A selected saved result is absent: '+id);return clone(x);});
 const results=resultMembership(exports),links=new Map();
 for(const link of tables.import_records){if(!sourceIds.includes(link.import_id))continue;const key=link.import_id+':'+link.source_line,values=links.get(key)||[];need(allRecords.has(link.record_id),'A native source row is missing its complete record');values.push(link.record_id);links.set(key,values);}
 const recordIds=new Set(),sources=[];
 for(const id of sourceIds){const source=imports.get(id);need(source,'An original source is absent: '+id);
  const rejections=parsed(source.rejected),rejectedByLine=new Map();
  for(const r of rejections){const items=rejectedByLine.get(r.line)||[];items.push(r);rejectedByLine.set(r.line,items);}
  let parsedSource,headers,items;
  if(source.kind==='usgs-daily'){
   const doc=JSON.parse(source.content);need(Array.isArray(doc.features),'Retain original USGS daily features');
   headers=['Original feature JSON'];items=doc.features.map((feature,i)=>({line:i+1,values:[JSON.stringify(feature)],feature:clone(feature)}));
   parsedSource={headerLine:null,leadingBlankRows:[],bom:source.content.startsWith('\uFEFF')};
  }else{parsedSource=originalCsvRows(source.content);headers=parsedSource.headers;items=parsedSource.rows;}
  const mapping=parsed(source.mapping),counts={rows:items.length,linkedRows:0,linkedRecords:0,rejectedRows:0,blankRows:0,stationRows:0,unmatchedRows:0,eligibleRecords:0};
  const consumed=new Set(),rows=items.map(item=>{
   const key=id+':'+item.line,ids=links.get(key)||[];if(ids.length)consumed.add(key);
   const records=ids.map(rid=>{recordIds.add(rid);return nativeDetails(allRecords.get(rid),results);}),rejections=rejectedByLine.get(item.line)||[];
   let status=ids.length?'measurement':rejections.length?'rejected':item.values.every(v=>v==='')?'blank':'unmatched',station=null;
   if(source.kind==='stations'&&status==='unmatched'){
    const index=headers.findIndex(h=>h.trim()===mapping.station),stationId=index>=0?item.values[index].trim():null;
    station=snapshot.summary.stations.find(s=>s.id===stationId&&s.sourceImports?.includes(id))||null;
    if(station)status='station';
   }
   if(status==='measurement')counts.linkedRows++;else if(status==='rejected')counts.rejectedRows++;else if(status==='blank')counts.blankRows++;else if(status==='station')counts.stationRows++;else counts.unmatchedRows++;
   counts.linkedRecords+=ids.length;counts.eligibleRecords+=records.filter(r=>r.eligible.ok).length;
   return {...item,recordIds:ids,status,records,station:clone(station),review:records.map(r=>r.review),eligible:records.length?records.every(r=>r.eligible.ok):null,
    issues:[...rejections.map(r=>r.reason),...records.flatMap(r=>r.eligible.reasons)],rejections:clone(rejections),results:records.flatMap(r=>r.results)};
  });
  for(const[key]of links)if(key.startsWith(id+':')&&!consumed.has(key))throw new InputError('Native row link has no original source row: '+key,409);
  const actualRejectedLines=new Set(rows.filter(r=>r.rejections.length).map(r=>r.line));
  for(const r of rejections)need(actualRejectedLines.has(r.line),'A retained rejection has no original source row');
  const summary=parsed(source.summary);
  sources.push({id,label:source.label,kind:source.kind,sha256:source.sha,createdAt:source.created_at,origin:parsed(source.origin),mapping,
   headers,headerLine:parsedSource.headerLine,leadingBlankRows:parsedSource.leadingBlankRows,bom:parsedSource.bom,rows,counts,originalSummary:summary});
 }
 return {format:HANDBACK_FORMAT,revision:snapshot.revision,sourceIds:clone(sourceIds),exportIds:clone(exportIds),sources,
  records:[...recordIds].map(id=>clone(allRecords.get(id))),results:exports.map(x=>({...x,content:parsed(x.content)})),
  counts:{sources:sources.length,sourceRows:sources.reduce((n,s)=>n+s.counts.rows,0),records:recordIds.size,
   rejectedRows:sources.reduce((n,s)=>n+s.counts.rejectedRows,0),blankRows:sources.reduce((n,s)=>n+s.counts.blankRows,0),
   unmatchedRows:sources.reduce((n,s)=>n+s.counts.unmatchedRows,0),savedResults:exports.length},
  interpretation:{sourceColumns:'Original field strings and column order; original file bytes are retained separately.',
   returnedColumns:'Current native record, review, mapping and eligibility from the stated workspace revision.',
   savedResults:'Previously retained scientific results; each result keeps its own original revision and complete values.',
   values:'Native normalized values and reported source values remain distinct. Dates, timezones, censoring and units are preserved.',
   workbook:'All returned workbook cells are literal text. Formula text in original sources is retained without execution.'}};
}
export const RETURN_COLUMNS=['Source line','Row status','Record IDs','Review','Eligible','Reasons','Station IDs','Reach IDs','Reported values','Reported units','Native values','Native units','Censor','Lower bounds','Upper bounds','Basis','Fraction','Sample dates','Sample timestamps','Source timezones','Selected versions','Saved result references','Saved result values JSON'];
const join=(row,fn)=>row.records.map(fn).map(v=>v==null?'':typeof v==='object'?JSON.stringify(v):String(v)).join('\n');
export function returnedTable(source){
 let prefix='TJLabs ';while(source.headers.some(h=>h.startsWith(prefix)))prefix='_'+prefix;
 const headers=[...source.headers,...RETURN_COLUMNS.map(x=>prefix+x)];
 const rows=source.rows.map(r=>[...r.values,...Array(Math.max(0,source.headers.length-r.values.length)).fill('')].slice(0,source.headers.length).concat([
  r.line,r.status,r.recordIds.join('\n'),join(r,x=>x.review.state),r.eligible===null?'':r.eligible?'yes':'no',r.issues.join('\n'),
  join(r,x=>x.stationId),join(r,x=>x.mapping?.reachId),join(r,x=>x.reportedValue),join(r,x=>x.reportedUnit),
  join(r,x=>x.value),join(r,x=>x.unit),join(r,x=>x.censor),join(r,x=>x.lower),join(r,x=>x.upper),join(r,x=>x.basis),join(r,x=>x.fraction),
  join(r,x=>x.sampledDate),join(r,x=>x.sampledAt),join(r,x=>x.timeZone),join(r,x=>x.selectedVersion),
  r.results.map(x=>x.exportId+' / '+x.kind+' / v'+x.revision+' / '+x.state+' / '+x.role).join('\n'),r.results.length?JSON.stringify(r.results):''
 ]));
 // Malformed rows retain surplus cells in explicit appended columns, never discarded.
 const surplus=source.rows.reduce((n,r)=>Math.max(n,r.values.length-source.headers.length),0);
 for(let i=0;i<surplus;i++){headers.push(prefix+'Original surplus field '+(i+1));for(let j=0;j<rows.length;j++)rows[j].push(source.rows[j].values[source.headers.length+i]??'');}
 return {headers,rows,prefix};
}
export function handbackCsv(table){
 const cell=v=>{let s=String(v??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return [table.headers,...table.rows].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}

// MIT. Complete editable review tables bound to the original delivery and source rows.
import { LAB_DECISIONS_SCHEMA, normalizeDecisions, canonicalJson } from './model.mjs';
import { parseDelimited, writeDelimited, labError } from './table.mjs';
const COLUMNS=['kind','source_sha256','profile_id','profile_version','record_id','row_sha256','filename','section','row','field','before','action','value','reason'];
function selection(delivery,document,options){
  const byChoice=new Map(document.decisions.map(choice=>[JSON.stringify([choice.recordId,choice.field]),choice]));
  const issueTargets=new Set(delivery.report.issues.flatMap(issue=>issue.targets.filter(target=>target.field)
    .map(target=>JSON.stringify([target.recordId,target.field]))));
  const fields=options.fields;
  if(fields!==undefined&&(!Array.isArray(fields)||fields.some(field=>typeof field!=='string')||new Set(fields).size!==fields.length))
    labError('TABLE_FIELDS','Choose distinct native field keys.');
  const scope=options.scope??'issues';
  if(!['all','issues'].includes(scope))labError('TABLE_SCOPE','Select every requested field or only issue targets.');
  const knownFields=new Set(delivery.tables.flatMap(table=>table.keys));
  for(const field of fields??[])if(!knownFields.has(field))labError('TABLE_FIELDS','A requested field is absent from this original delivery.',{field});
  const rows=[];
  for(const table of delivery.tables)for(const row of table.rows)for(const field of table.keys){
    const key=JSON.stringify([row.recordId,field]),choice=byChoice.get(key);
    if(!choice&&(fields&&!fields.includes(field)||scope==='issues'&&!issueTargets.has(key)))continue;
    rows.push({table,row,field,choice});
  }
  return rows;
}
export function reviewTable(delivery,input,options={}){
  const document=normalizeDecisions(delivery,input),format=options.format??'csv';
  if(!['csv','tsv'].includes(format))labError('TABLE_FORMAT','Choose CSV or TSV.');
  const rows=[COLUMNS,[
    'source',document.sourceSha256,document.profile.id,document.profile.version,
    '','','','','','','','','','',
  ]];
  for(const {table,row,field,choice}of selection(delivery,document,options)){
    rows.push(['cell','','','',row.recordId,row.rowSha256,table.filename,table.id,String(row.rowNumber),field,
      row.values[field],choice?.action??'keep',choice?.action==='set'?choice.value:'',choice?.reason??'']);
  }
  return {filename:'lab-edd-decisions.'+format,mime:format==='csv'?'text/csv; charset=utf-8':'text/tab-separated-values; charset=utf-8',
    text:writeDelimited(rows,format==='csv'?',':'\t'),sourceSha256:document.sourceSha256,rows:rows.length-2};
}
export function parseReviewTable(delivery,text,{format='csv'}={}){
  if(!['csv','tsv'].includes(format))labError('TABLE_FORMAT','Choose CSV or TSV.');
  const records=parseDelimited(text.startsWith('\uFEFF')?text.slice(1):text,format==='csv'?',':'\t');
  if(records.length<2||canonicalJson(records[0].fields)!==canonicalJson(COLUMNS))
    labError('REVIEW_TABLE','Retain the complete original review-table header and source-binding row.');
  const values=records[1].fields;
  if(values.length!==COLUMNS.length||values[0]!=='source'||values.slice(4).some(value=>value!==''))
    labError('REVIEW_TABLE_SOURCE','The original source-binding row is invalid.');
  const document={schema:LAB_DECISIONS_SCHEMA,sourceSha256:values[1],profile:{id:values[2],version:values[3]},decisions:[]};
  const actual=new Map(delivery.tables.flatMap(table=>table.rows.map(row=>[row.recordId,{table,row}])));
  const cells=new Set();
  for(const record of records.slice(2)){
    if(record.fields.every(value=>value===''))continue;
    if(record.fields.length!==COLUMNS.length)labError('REVIEW_TABLE_ROW','Retain every review-table column.',{row:record.rowNumber});
    const row=Object.fromEntries(COLUMNS.map((column,index)=>[column,record.fields[index]]));
    if(row.kind!=='cell'||row.source_sha256!==''||row.profile_id!==''||row.profile_version!=='')
      labError('REVIEW_TABLE_ROW','Source bindings belong only in the retained source row.',{row:record.rowNumber});
    const found=actual.get(row.record_id),key=JSON.stringify([row.record_id,row.field]);
    if(!found||found.table.filename!==row.filename||found.table.id!==row.section||String(found.row.rowNumber)!==row.row||
      found.row.rowSha256!==row.row_sha256||!found.table.keys.includes(row.field)||found.row.values[row.field]!==row.before)
      labError('REVIEW_TABLE_ROW_CHANGED','A review row no longer matches its original field and file.',{row:record.rowNumber});
    if(cells.has(key))labError('DUPLICATE_DECISION','The table repeats an original source cell.');
    cells.add(key);
    if(!['keep','set','clear'].includes(row.action))labError('DECISION','Choose keep, set or clear.',{row:record.rowNumber});
    if(row.action!=='set'&&row.value!=='')labError('DECISION_VALUE','A replacement value is used only by Set.',{row:record.rowNumber});
    if(row.action==='keep'&&row.reason==='')continue;
    document.decisions.push({recordId:row.record_id,rowSha256:row.row_sha256,field:row.field,before:row.before,
      action:row.action,...(row.action==='set'?{value:row.value}:{}),reason:row.reason});
  }
  return normalizeDecisions(delivery,document);
}
export function issueTable(delivery){
  const rows=[['code','severity','filename','section','row','record_id','field','original_value','message','reference','details_json']];
  const actual=new Map(delivery.tables.flatMap(table=>table.rows.map(row=>[row.recordId,{table,row}])));
  for(const issue of delivery.report.issues){
    const targets=issue.targets.length?issue.targets:[{}];
    for(const target of targets){
      const found=actual.get(target.recordId);
      rows.push([issue.code,issue.severity,found?.table.filename??'',found?.table.id??'',found?String(found.row.rowNumber):'',
        target.recordId??'',target.field??'',found&&target.field?found.row.values[target.field]:'',
        issue.message,issue.reference??'',issue.details===undefined?'':JSON.stringify(issue.details)]);
    }
  }
  return writeDelimited(rows);
}

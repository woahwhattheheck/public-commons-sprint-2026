// MIT. Complete editable correspondence tables using the original delimited reader/writer.
import { canonicalJson } from './model.mjs';
import { parseDelimited, writeDelimited, labError } from './table.mjs';
import { normalizeReconciliation, LAB_CROSS_DECISIONS_SCHEMA } from './reconciliation.mjs';
export const CROSS_TABLE_COLUMNS=['kind','comparison_sha256','binding_json','group_id','group_sha256','section','candidate_key_json','baseline_entities_json','current_entities_json','action','pairs_json','reason'];
const COLUMNS=CROSS_TABLE_COLUMNS;
const bound=comparison=>({mapping:{id:comparison.mapping.id,version:comparison.mapping.version},baseline:comparison.baseline,current:comparison.current});
export function reconciliationTable(comparison,input,{format='csv'}={}){
  if(!['csv','tsv'].includes(format))labError('CROSS_TABLE_FORMAT','Select a complete CSV or TSV correspondence table.');
  const document=normalizeReconciliation(comparison,input),decisions=new Map(document.decisions.map(choice=>[choice.groupId,choice]));
  const rows=[COLUMNS,['source',comparison.comparisonSha256,canonicalJson(bound(comparison)),'','','','','','','','','']];
  for(const group of comparison.groups){
    const choice=decisions.get(group.groupId);
    rows.push(['group','','',group.groupId,group.groupSha256,group.kind,canonicalJson(group.key),
      canonicalJson(group.baselineIds),canonicalJson(group.currentIds),choice?.action??'',
      choice?.action==='pair'?canonicalJson(choice.pairs):'',choice?.reason??'']);
  }
  for(const link of document.links)rows.push(['link','','','','',
    comparison.baselineProjection.entities.find(entity=>entity.entityId===link.baselineId).kind,'',
    canonicalJson([link.baselineId]),canonicalJson([link.currentId]),'pair',
    canonicalJson({baselineId:link.baselineId,baselineSha256:link.baselineSha256,currentId:link.currentId,currentSha256:link.currentSha256}),link.reason]);
  return {filename:'lab-edd-reconciliation.'+format,mime:format==='csv'?'text/csv; charset=utf-8':'text/tab-separated-values; charset=utf-8',
    text:writeDelimited(rows,format==='csv'?',':'\t'),comparisonSha256:comparison.comparisonSha256,rows:rows.length-2,groups:comparison.groups.length,links:document.links.length};
}
export function parseReconciliationTable(comparison,text,{format='csv'}={}){
  if(!['csv','tsv'].includes(format))labError('CROSS_TABLE_FORMAT','Select CSV or TSV.');
  const rows=parseDelimited(text.replace(/^\uFEFF/,''),format==='csv'?',':'\t');
  if(rows.length<2||canonicalJson(rows[0].fields)!==canonicalJson(COLUMNS))labError('CROSS_TABLE','Retain the full correspondence table header.');
  const head=rows[1].fields;
  if(head.length!==COLUMNS.length||head[0]!=='source'||head[1]!==comparison.comparisonSha256||
    head[2]!==canonicalJson(bound(comparison))||head.slice(3).some(value=>value!==''))labError('CROSS_TABLE_SOURCE','The comparison source pair or mapping changed.');
  const groups=new Map(comparison.groups.map(group=>[group.groupId,group])),seen=new Set(),decisions=[],links=[];
  for(const row of rows.slice(2)){
    if(row.fields.every(value=>value===''))continue;
    if(row.fields.length!==COLUMNS.length)labError('CROSS_TABLE_ROW','Retain every table column.',{row:row.rowNumber});
    const value=Object.fromEntries(COLUMNS.map((column,index)=>[column,row.fields[index]])),group=groups.get(value.group_id);
    if(value.kind==='link'){
      let link;try{link=JSON.parse(value.pairs_json);}catch{labError('CROSS_TABLE_LINK','Retain the complete explicit correspondence identity.');}
      const entity=comparison.baselineProjection.entities.find(item=>item.entityId===link?.baselineId);
      if(value.comparison_sha256!==''||value.binding_json!==''||value.group_id!==''||value.group_sha256!==''||
        value.candidate_key_json!==''||value.action!=='pair'||!entity||value.section!==entity.kind||
        value.baseline_entities_json!==canonicalJson([link.baselineId])||value.current_entities_json!==canonicalJson([link.currentId]))
        labError('CROSS_TABLE_LINK','The explicit correspondence no longer matches its original entity references.');
      links.push({...link,reason:value.reason});continue;
    }
    if(value.kind!=='group'||value.comparison_sha256!==''||value.binding_json!==''||!group||seen.has(value.group_id)||
      value.group_sha256!==group.groupSha256||value.section!==group.kind||value.candidate_key_json!==canonicalJson(group.key)||
      value.baseline_entities_json!==canonicalJson(group.baselineIds)||value.current_entities_json!==canonicalJson(group.currentIds))
      labError('CROSS_TABLE_GROUP','The table must preserve every exact candidate group and entity identity.',{row:row.rowNumber});
    seen.add(value.group_id);
    if(value.action===''){
      if(value.reason!==''||value.pairs_json!=='')labError('CROSS_TABLE_ACTION','A reason or selected pair needs an explicit disposition.');
      continue;
    }
    let pairs;
    if(value.action==='pair'){
      try{pairs=JSON.parse(value.pairs_json);}catch{labError('CROSS_TABLE_PAIRS','The selected correspondence list must be complete JSON.',{row:row.rowNumber});}
    }else if(value.pairs_json!=='')labError('CROSS_TABLE_PAIRS','Only a paired disposition contains selected pairs.');
    decisions.push({groupId:group.groupId,groupSha256:group.groupSha256,action:value.action,
      ...(value.action==='pair'?{pairs}:{}),reason:value.reason});
  }
  if(seen.size!==groups.size)labError('CROSS_TABLE_INCOMPLETE','Import the full exported correspondence table; retain groups with blank actions.');
  return normalizeReconciliation(comparison,{schema:LAB_CROSS_DECISIONS_SCHEMA,comparisonSha256:comparison.comparisonSha256,
    ...bound(comparison),decisions,links});
}
export function reconciliationFieldTable(comparison,{format='csv'}={}){
  if(!['csv','tsv'].includes(format))labError('CROSS_TABLE_FORMAT','Select CSV or TSV.');
  const rows=[['comparison_sha256','group_id','group_sha256','section','candidate_status','field','comparison_status','baseline_variants_json','current_variants_json']];
  for(const group of comparison.groups)for(const field of group.fields)rows.push([comparison.comparisonSha256,group.groupId,group.groupSha256,
    group.kind,group.status,field.field,field.status,canonicalJson(field.baseline),canonicalJson(field.current)]);
  return {filename:'lab-edd-cross-profile-fields.'+format,mime:format==='csv'?'text/csv; charset=utf-8':'text/tab-separated-values; charset=utf-8',
    text:writeDelimited(rows,format==='csv'?',':'\t'),rows:rows.length-1};
}

// MIT. XES serialization of observed original history timestamps, never synthetic audit events.
import {createHash} from 'node:crypto';
import {inspectFlowableHistoryBundle,historyTimestamp} from './history-analysis.mjs';
export const HISTORY_XES_SCHEMA='stellar-forge.flowable-history-xes.v1';
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_HISTORY_XES_SOURCE_REQUIRED',status:400});};
const sha=s=>createHash('sha256').update(s).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const MAX=64*1024*1024;
function xml(value){
 const s=String(value);need(s.length<=12000,'An XES attribute exceeds 12,000 characters');
 for(const c of s){const n=c.codePointAt(0);need(n===9||n===10||n===13||(n>=32&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff),'Original source contains a character outside XML 1.0');}
 return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\r/g,'&#13;').replace(/\n/g,'&#10;').replace(/\t/g,'&#9;');
}
const attr=(key,value,type='string')=>'<'+type+' key="'+xml(key)+'" value="'+xml(value)+'"/>';
function timestamp(value){try{return{value:historyTimestamp(value)};}catch(e){return{error:e.message};}}
export function exportFlowableHistoryXes({bundleText,collection='activities'}){
 need(collection==='activities'||collection==='tasks','Select activities or tasks as one event view');
 const inspected=inspectFlowableHistoryBundle(bundleText),r=inspected.report,inventory=JSON.parse(inspected.inventoryText);
 const nativeCollection=collection==='activities'?'historicActivities':'historicTasks',keyField=collection==='activities'?'activityId':'taskDefinitionKey';
 const originalRows=inventory.collections[nativeCollection].items,asOf=historyTimestamp(r.selection.asOf);
 const parents=new Map(r.processes.map(p=>[p.id,p])),traces=new Map(r.processes.map(p=>[p.id,[]]));
 const classified=new Map(r[collection].map(p=>[p.id,p])),rows=[],events=[];
 for(let index=0;index<originalRows.length;index++){
  const row=originalRows[index],parent=parents.get(row.processInstanceId);
  const review={index,id:row.id,processInstanceId:row.processInstanceId??null,events:0,observations:[]};
  rows.push(review);
  if(!parent){review.disposition='outside-selected-process-cohort';continue;}
  const key=row[keyField];
  if(typeof key!=='string'||!key){review.disposition='missing-native-element-key';continue;}
  need(key.length<=2000,'Original native element key is too long');
  const name=typeof(row.name??row.activityName)==='string'&&(row.name??row.activityName)?(row.name??row.activityName):key;
  const start=row.startTime==null?{error:'startTime absent'}:timestamp(row.startTime);
  const end=row.endTime==null?null:timestamp(row.endTime);
  if(start.error)review.observations.push(start.error);
  if(end?.error)review.observations.push(end.error);
  const reversed=!start.error&&end&&!end.error&&end.value<start.value;
  if(reversed)review.observations.push('Original end precedes start; retain both observations without repairing their times.');
  if(row.processDefinitionId!==parent.processDefinitionId)review.observations.push('Original child definition differs from the captured parent definition.');
  const selected=classified.get(row.id),state=selected?.state??'unclassified-original-row';
  for(const [boundary,time,original]of [['start',start,row.startTime],['end',end,row.endTime]]){
   if(!time||time.error)continue;
   if(time.value>asOf){review.observations.push(boundary+' timestamp follows the selected as-of and is omitted from this view.');continue;}
   const event={collection:nativeCollection,index,id:row.id,processInstanceId:parent.id,processDefinitionId:row.processDefinitionId??null,
    key,name,boundary,timestamp:new Date(time.value).toISOString(),originalTimestamp:original,millis:time.value,
    classification:state,classificationBasis:selected?.classificationBasis??'Original row was excluded from duration analysis; consult source-quality observations.',
    deleteReason:row.deleteReason??null};
   traces.get(parent.id).push(event);events.push(event);review.events++;
  }
  review.disposition=review.events?'observed-timestamps-exported':'no-observed-timestamp-at-as-of';
 }
 const ordering=(a,b)=>a.millis-b.millis||compare(a.id,b.id)||(a.boundary===b.boundary?0:a.boundary==='start'?-1:1)||a.index-b.index;
 for(const trace of traces.values())trace.sort(ordering);
 let outputBytes=0;const parts=[];const push=s=>{outputBytes+=Buffer.byteLength(s);need(outputBytes<=MAX,'XES exceeds 64 MiB; narrow the original history cohort');parts.push(s);};
 push('<?xml version="1.0" encoding="UTF-8"?>\n');
 push('<log xmlns="http://www.xes-standard.org/" xes.version="2.0" xes.features="">\n');
 push(' <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>\n');
 push(' <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>\n');
 push(' <extension name="Lifecycle" prefix="lifecycle" uri="http://www.xes-standard.org/lifecycle.xesext"/>\n');
 push(' <global scope="trace">'+attr('concept:name','')+'</global>\n');
 push(' <global scope="event">\n');
 for(const key of ['concept:name','concept:instance','flowable:definitionId','flowable:elementKey','lifecycle:transition'])push('  '+attr(key,'')+'\n');
 push(' </global>\n');
 push(' <classifier name="Native element and observed boundary" keys="flowable:definitionId flowable:elementKey lifecycle:transition"/>\n');
 for(const [key,value]of Object.entries({'concept:name':r.title,'lifecycle:model':'flowable-history-observations-v1','flowable:sourceOrigin':r.source.origin,
  'flowable:historyBundleSha256':inspected.sha256,'flowable:inventorySha256':r.source.inventory.sha256,
  'flowable:portfolioId':r.source.record.id,'flowable:portfolioRevision':String(r.source.record.revision),
  'flowable:collection':nativeCollection,'flowable:asOf':r.selection.asOf,
  'flowable:semantics':'Observed retained start/end timestamps only. observed-end never implies successful completion. Equal-time order is deterministic serialization, not proven event order.'}))push(' '+attr(key,value)+'\n');
 for(const parent of [...parents.values()].sort((a,b)=>compare(a.id,b.id))){
  push(' <trace>\n');
  for(const [key,value]of Object.entries({'concept:name':parent.id,'flowable:definitionId':parent.processDefinitionId,
   'flowable:processClassification':parent.state,'flowable:sourceState':parent.sourceState??'',
   'flowable:originalStartTime':parent.startTime,'flowable:originalEndTime':parent.endTime??''}))push('  '+attr(key,value)+'\n');
  for(const event of traces.get(parent.id)){
   push('  <event>\n');
   const attributes={'concept:name':event.name,'concept:instance':event.id,
    'lifecycle:transition':'observed-'+event.boundary,'flowable:definitionId':event.processDefinitionId??'',
    'flowable:elementKey':event.key,'flowable:originalId':event.id,'flowable:originalTimestamp':event.originalTimestamp,
    'flowable:collection':event.collection,'flowable:classification':event.classification,
    'flowable:classificationBasis':event.classificationBasis};
   for(const [key,value]of Object.entries(attributes))push('   '+attr(key,value)+'\n');
   push('   '+attr('flowable:sourceRowIndex',event.index,'int')+'\n');
   push('   '+attr('time:timestamp',event.timestamp,'date')+'\n');
   push('  </event>\n');
  }
  push(' </trace>\n');
 }
 push('</log>\n');
 const content=parts.join(''),counts={};
 for(const row of rows)counts[row.disposition]=(counts[row.disposition]??0)+1;
 const manifest={schema:HISTORY_XES_SCHEMA,selection:{collection,history:r.selection},source:{bundleSha256:inspected.sha256,bundleBytes:inspected.bytes,
   portfolio:r.source.record,inventory:r.source.inventory,origin:r.source.origin},
  file:{filename:'history-'+collection+'.xes',mediaType:'application/xml',bytes:outputBytes,sha256:sha(content)},
  counts:{traces:traces.size,events:events.length,sourceRows:originalRows.length,rowsByDisposition:counts,emptyTraces:[...traces.values()].filter(t=>!t.length).length},
  mapping:{trace:'exact native processInstanceId',eventInstance:'exact original history row id',activity:'native activityId or taskDefinitionKey',
   timestamp:'original observed start/end normalized to exact UTC milliseconds; original spelling retained',
   lifecycleModel:'flowable-history-observations-v1',transitions:['observed-start','observed-end'],
   ordering:'UTC timestamp, native row ID, start before end for an exact tie, source row index; ties carry no causal claim',
   missing:'No timestamp is invented. Every original row remains in the accompanying complete history bundle and this disposition inventory.',
   privacy:'No task assignee, business variables or business key is added to the XES projection. Original complete source bundle retains its original access sensitivity.',
   coverage:r.method.coverage,classification:r.method.classification},
  sourceQuality:r.coverage.issues,rows};
 const manifestText=json(manifest);need(Buffer.byteLength(manifestText)<=MAX,'XES source manifest exceeds 64 MiB; select a smaller original capture');
 return{xml:content,manifest,manifestText,manifestSha256:sha(manifestText),manifestBytes:Buffer.byteLength(manifestText)};
}

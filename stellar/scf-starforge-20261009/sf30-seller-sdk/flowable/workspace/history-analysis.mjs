// MIT. Deterministic analysis of an explicitly selected original Flowable process capture.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export const HISTORY_ANALYSIS_SCHEMA='stellar-forge.flowable-history-analysis.v1';
export const HISTORY_BUNDLE_SCHEMA='stellar-forge.flowable-history-analysis-bundle.v1';
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_HISTORY_SOURCE_REQUIRED',status:400});};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,name,max=2000)=>{need(typeof v==='string'&&v.trim()&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'Supply bounded '+name);return v;};
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':plain(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const reference=r=>({kind:r.kind,id:r.id,revision:r.revision,sha256:r.sha256});
const copy=v=>JSON.parse(JSON.stringify(v));
const requiredCollections=['definitions','historicProcesses','historicTasks','historicActivities'];
export function historyTimestamp(value,label='timestamp'){
 need(typeof value==='string','Missing '+label);
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
 need(m,'Invalid original '+label);
 const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),fraction=Number((m[7]??'').padEnd(3,'0'));
 need(y>=1900&&mo>=1&&mo<=12&&d>=1&&d<=31&&h<=23&&mi<=59&&s<=59,'Invalid calendar '+label);
 const utc=Date.UTC(y,mo-1,d,h,mi,s,fraction),check=new Date(utc);
 need(check.getUTCFullYear()===y&&check.getUTCMonth()===mo-1&&check.getUTCDate()===d,'Invalid calendar '+label);
 const zone=m[8];let minutes=0;
 if(zone!=='Z'){const z=zone.slice(1).replace(':',''),zh=Number(z.slice(0,2)),zm=Number(z.slice(2));need(zh<=23&&zm<=59,'Invalid offset '+label);minutes=(zh*60+zm)*(zone[0]==='-'?-1:1);}
 const result=utc-minutes*60000;need(Number.isSafeInteger(result),'Timestamp outside exact millisecond range');return result;
}
function collection(inventory,name){
 const c=inventory.collections?.[name];need(c?.complete===true&&Array.isArray(c.items)&&Number.isSafeInteger(c.total)&&c.items.length===c.total,'Require complete original '+name);
 need(c.items.length<=250000,'Select an original capture with at most 250,000 records per collection');
 const seen=new Set();for(const row of c.items){need(plain(row)&&typeof row.id==='string'&&row.id&&!seen.has(row.id),'Missing or repeated native ID in '+name);seen.add(row.id);}
 return c.items;
}
function stats(values){
 if(!values.length)return{count:0,totalMillis:'0',minimumMillis:null,medianMillis:null,p90Millis:null,maximumMillis:null,meanMillis:null};
 const a=[...values].sort((x,y)=>x-y),n=a.length,sum=a.reduce((s,v)=>s+BigInt(v),0n),twice=n%2?BigInt(a[(n-1)/2])*2n:BigInt(a[n/2-1])+BigInt(a[n/2]);
 return{count:n,totalMillis:String(sum),minimumMillis:a[0],medianMillis:Number(twice)/2,p90Millis:a[Math.ceil(n*.9)-1],maximumMillis:a[n-1],
  meanMillis:String(sum/BigInt(n))+'.'+String((sum%BigInt(n))*1000n/BigInt(n)).padStart(3,'0')};
}
function timing(row,asOf,{kind='task'}={}){
 const start=historyTimestamp(row.startTime,'startTime'),end=row.endTime==null?null:historyTimestamp(row.endTime,'endTime');
 need(end===null||end>=start,'endTime precedes startTime');
 const sourceState=kind==='process'?(row.state??null):null,reason=kind==='activity'?null:(row.deleteReason==null?null:String(row.deleteReason));
 if(start>asOf)return{state:'not-started-at-as-of',start,end,durationMillis:null,sourceState,classificationBasis:'start timestamp after as-of'};
 const ended=end!==null&&end<=asOf;let state='open-at-as-of',classificationBasis='end timestamp absent or after as-of';
 if(ended){
  if(kind==='activity'){state='ended-completion-unknown';classificationBasis='native activity REST response omits completion/cancellation state and deletion reason';}
  else if(kind==='process'&&sourceState!=null&&sourceState!==''){
   state=sourceState==='completed'?'completed-by-as-of':sourceState==='cancelled'?'terminated-by-as-of':'ended-completion-unknown';
   classificationBasis='original native process state';
  }else{
   state=reason!==null&&reason!==''&&reason!=='completed'?'terminated-by-as-of':'completed-by-as-of';
   classificationBasis=kind==='process'?'inferred from deletion reason because native process state is absent':'native task deletion reason';
  }
 }
 return{state,start,end,durationMillis:ended?end-start:null,ageMillis:ended?null:asOf-start,deleteReason:reason,sourceState,classificationBasis};
}
export function analyseFlowableHistory({inventory,record,selection}){
 need(inventory?.schema==='stellar-forge.flowable-native-portfolio.v1','Supply the original process portfolio inventory');
 need(record?.kind==='portfolio'&&record.value?.state==='CAPTURED'&&record.value?.inventory&&/^[a-f0-9]{64}$/.test(record.sha256),'Select an exact complete saved process portfolio revision');
 need(Number.isSafeInteger(record.revision)&&record.revision>0,'Select an exact portfolio revision');
 need(plain(selection)&&Array.isArray(selection.definitionIds)&&selection.definitionIds.length>0&&selection.definitionIds.length<=100,'Select from 1 to 100 exact definition IDs');
 const definitionIds=[...new Set(selection.definitionIds.map(id=>text(id,'definition ID')))].sort();
 need(definitionIds.length===selection.definitionIds.length,'Repeated selected definition');
 text(selection.title,'analysis title',300);text(selection.retentionNote,'history retention and coverage note',6000);
 for(const key of ['from','to','asOf'])need(typeof selection[key]==='string'&&selection[key].endsWith('Z'),'Use UTC timestamps for '+key);
 const from=historyTimestamp(selection.from,'cohort from'),to=historyTimestamp(selection.to,'cohort to'),asOf=historyTimestamp(selection.asOf,'as-of');
 const captureStarted=historyTimestamp(inventory.startedAt,'capture startedAt'),captureEnded=historyTimestamp(inventory.completedAt,'capture completedAt');
 need(from<to&&to<=asOf&&asOf<=captureStarted&&captureStarted<=captureEnded,'Require from < to <= asOf <= original capture start');
 need(inventory.connectionId===record.value.connection?.id&&inventory.connectionSha256===record.value.configurationSha256,'Inventory and saved connection identity disagree');
 const rows=Object.fromEntries(requiredCollections.map(name=>[name,collection(inventory,name)]));
 const definitions=new Map(rows.definitions.map(d=>[d.id,d]));
 for(const id of definitionIds)need(definitions.has(id),'Selected definition is absent from this original capture: '+id);
 const selectedIds=new Set(definitionIds),issues=[],processes=[],tasks=[],activities=[],cohort=new Map();
 const issue=(collection,row,message)=>issues.push({collection,id:row.id,message});
 for(const row of rows.historicProcesses){
  if(!selectedIds.has(row.processDefinitionId))continue;
  try{
   const t=timing(row,asOf,{kind:'process'});
   if(t.start<from||t.start>=to)continue;
   const item={id:row.id,processDefinitionId:row.processDefinitionId,tenantId:row.tenantId??null,startTime:row.startTime,endTime:row.endTime??null,
    state:t.state,sourceState:t.sourceState,classificationBasis:t.classificationBasis,durationMillis:t.durationMillis,ageMillis:t.ageMillis,deleteReason:t.deleteReason};
   if(row.durationInMillis!=null&&t.end!==null&&(!Number.isSafeInteger(row.durationInMillis)||row.durationInMillis!==t.end-t.start))issue('historicProcesses',row,'Native duration differs from elapsed timestamp duration; metrics use original start/end timestamps.');
   processes.push(item);cohort.set(row.id,item);
  }catch(error){issue('historicProcesses',row,error.message);}
 }
 let outsideCohortTasks=0,outsideCohortActivities=0;
 function selectedChildren(name,target,keyField){
  for(const row of rows[name]){
   const parent=cohort.get(row.processInstanceId);
   if(!parent){if(name==='historicTasks')outsideCohortTasks++;else outsideCohortActivities++;continue;}
   try{
    const t=timing(row,asOf,{kind:name==='historicTasks'?'task':'activity'});if(t.state==='not-started-at-as-of')continue;
    text(row[keyField],keyField);
    if(t.start<historyTimestamp(parent.startTime))issue(name,row,'Child starts before the retained parent start.');
    if(row.processDefinitionId!==parent.processDefinitionId)issue(name,row,'Child definition differs from captured parent definition; retain this edition separately (for example after migration).');
    if(row.durationInMillis!=null&&t.end!==null&&(!Number.isSafeInteger(row.durationInMillis)||row.durationInMillis!==t.end-t.start))issue(name,row,'Native duration differs from elapsed timestamp duration; metrics use original timestamps.');
    const item={id:row.id,processInstanceId:row.processInstanceId,processDefinitionId:row.processDefinitionId??null,
     key:row[keyField],name:row.name??row.activityName??row[keyField],activityType:row.activityType??null,
     startTime:row.startTime,endTime:row.endTime??null,state:t.state,classificationBasis:t.classificationBasis,durationMillis:t.durationMillis,ageMillis:t.ageMillis,deleteReason:t.deleteReason};
    if(name==='historicTasks'){
     item.claimTime=row.claimTime??null;item.claimDelayMillis=null;
     if(row.claimTime!=null){const claim=historyTimestamp(row.claimTime,'claimTime');
      if(claim<t.start||(t.end!==null&&claim>t.end))issue(name,row,'Claim timestamp is outside this task lifetime.');
      else if(claim<=asOf)item.claimDelayMillis=claim-t.start;}
    }
    target.push(item);
   }catch(error){issue(name,row,error.message);}
  }
 }
 selectedChildren('historicTasks',tasks,'taskDefinitionKey');selectedChildren('historicActivities',activities,'activityId');
 need(processes.length+tasks.length+activities.length<=100000,'The selected cohort exceeds 100,000 report rows; narrow the start-cohort window or definitions');
 function groups(items,keyFn,{activity=false}={}){
  const grouped=new Map();for(const row of items){const key=keyFn(row),id=canonical(key);if(!grouped.has(id))grouped.set(id,{...key,rows:[]});grouped.get(id).rows.push(row);}
  return [...grouped.values()].map(({rows,...key})=>{
   const counts=new Map();for(const row of rows){const id=row.processInstanceId??row.id;counts.set(id,(counts.get(id)??0)+1);}
   return{...key,observed:rows.length,completed:activity?null:rows.filter(r=>r.state==='completed-by-as-of').length,terminated:activity?null:rows.filter(r=>r.state==='terminated-by-as-of').length,
    endedCompletionUnknown:rows.filter(r=>r.state==='ended-completion-unknown').length,endedDuration:stats(rows.filter(r=>r.state==='ended-completion-unknown').map(r=>r.durationMillis)),
    open:rows.filter(r=>r.state==='open-at-as-of').length,completedDuration:activity?null:stats(rows.filter(r=>r.state==='completed-by-as-of').map(r=>r.durationMillis)),
    openAge:stats(rows.filter(r=>r.state==='open-at-as-of').map(r=>r.ageMillis)),
    claimDelay:stats(rows.filter(r=>Number.isSafeInteger(r.claimDelayMillis)).map(r=>r.claimDelayMillis)),
    distinctProcesses:counts.size,processesWithRepeatedOccurrences:[...counts.values()].filter(n=>n>1).length,
    extraOccurrences:[...counts.values()].reduce((sum,n)=>sum+Math.max(0,n-1),0)};
  }).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 }
 const report={schema:HISTORY_ANALYSIS_SCHEMA,title:selection.title,selection:{title:selection.title,definitionIds,from:selection.from,to:selection.to,asOf:selection.asOf,retentionNote:selection.retentionNote},
  source:{origin:inventory.authoredReference===true?'authored-reference':'original-native-capture',record:reference(record),inventory:copy(record.value.inventory),connectionId:record.value.connectionId,configurationSha256:record.value.configurationSha256,
   startedAt:inventory.startedAt,completedAt:inventory.completedAt,atomicSnapshot:false,
   collections:Object.fromEntries(requiredCollections.map(name=>[name,{total:inventory.collections[name].total,retained:rows[name].length,complete:true,pages:inventory.collections[name].pages?.length??0,
    exchanges:copy(inventory.collections[name].exchanges??[])}]))},
  method:{cohort:'process startTime in [from,to), grouped by the captured parent processDefinitionId',asOf:'Ends and claims after asOf are treated as future; open age is asOf minus startTime.',
   durations:'Elapsed UTC milliseconds, including nights/weekends. Completed process/task durations exclude terminated and unknown-ended rows. Activities report ended durations because the native REST response omits completion/cancellation state. Task durations overlap and are not additive process time.',
   classification:'Ended process rows use native completed/cancelled state. Missing state uses explicitly labeled deletion-reason inference; unrecognized state remains unknown. Native task deletion reasons classify task endings. Activity endings never imply successful completion or termination.',
   statistics:'Median and nearest-rank p90 over completed process/task observations and separately over ended activities with unknown completion. MeanMillis is exact decimal truncated to 3 places.',
   repetition:'Repeated occurrences of an activity or task key within a process; this does not by itself identify an avoidable loop.',
   coverage:'The engine collections were paged fully, not transactionally. History retention, permissions, history configuration, deletion and migration can limit this captured population.'},
  definitions:definitionIds.map(id=>copy(definitions.get(id))),processGroups:groups(processes,r=>({processDefinitionId:r.processDefinitionId})),
  taskGroups:groups(tasks,r=>({processDefinitionId:r.processDefinitionId,key:r.key})),
  activityGroups:groups(activities,r=>({processDefinitionId:r.processDefinitionId,key:r.key,activityType:r.activityType}),{activity:true}),
  processes:processes.sort((a,b)=>a.id.localeCompare(b.id)),tasks:tasks.sort((a,b)=>a.id.localeCompare(b.id)),activities:activities.sort((a,b)=>a.id.localeCompare(b.id)),
  coverage:{selectedProcesses:processes.length,selectedTasks:tasks.length,selectedActivities:activities.length,outsideCohortTasks,outsideCohortActivities,issues}};
 return report;
}
export async function readFlowableHistoryAnalysis({workspace,input}){
 need(input&&typeof input.portfolioId==='string'&&Number.isSafeInteger(input.revision)&&input.revision>0,'Select a saved portfolio revision');
 const record=await workspace.getRecord({kind:'portfolio',id:input.portfolioId,revision:input.revision});
 need(record.value.connectionId===input.connectionId,'Select the connection that owns this saved capture');
 const original=await workspace.readSource({reference:record.value.inventory});
 need(canonical(original.reference)===canonical(record.value.inventory),'Original inventory source reference changed');
 const report=analyseFlowableHistory({inventory:original.value,record,selection:input.selection});
 const file=await workspace.sourceFile({reference:record.value.inventory});
 const bytes=await readFile(file.path);need(bytes.length===record.value.inventory.bytes&&sha(bytes)===record.value.inventory.sha256,'Original inventory bytes changed');
 const inventoryText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 need(canonical(JSON.parse(inventoryText))===canonical(original.value),'Original inventory text differs from selected source');
 return{record,inventory:original.value,inventoryText,report};
}
export function createFlowableHistoryBundle({record,inventory,inventoryText,report}){
 need(typeof inventoryText==='string'&&Buffer.byteLength(inventoryText)===record.value.inventory.bytes&&sha(inventoryText)===record.value.inventory.sha256,'Retain exact original inventory bytes');
 need(canonical(JSON.parse(inventoryText))===canonical(inventory),'Inventory text and decoded original differ');
 const repeated=analyseFlowableHistory({record,inventory,selection:report.selection});
 need(canonical(repeated)===canonical(report),'Analysis differs from its original source');
 const body={schema:HISTORY_BUNDLE_SCHEMA,record,inventoryText,report};
 const bytes=JSON.stringify(body,null,2)+'\n';need(Buffer.byteLength(bytes)<=64*1024*1024,'History handover exceeds 64 MiB; choose a smaller original capture');
 return{text:bytes,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)};
}
export function inspectFlowableHistoryBundle(sourceText){
 need(typeof sourceText==='string'&&Buffer.byteLength(sourceText)<=64*1024*1024,'Supply a complete history bundle of at most 64 MiB');
 const bundle=JSON.parse(sourceText);need(bundle.schema===HISTORY_BUNDLE_SCHEMA,'Select an original history analysis bundle');
 need(typeof bundle.inventoryText==='string'&&Buffer.byteLength(bundle.inventoryText)===bundle.record?.value?.inventory?.bytes&&sha(bundle.inventoryText)===bundle.record.value.inventory.sha256,'The original inventory byte identity changed');
 const inventory=JSON.parse(bundle.inventoryText);
 need(canonical(analyseFlowableHistory({record:bundle.record,inventory,selection:bundle.report.selection}))===canonical(bundle.report),'The received report differs from its retained original inventory');
 return{...bundle,bytes:Buffer.byteLength(sourceText),sha256:sha(sourceText)};
}

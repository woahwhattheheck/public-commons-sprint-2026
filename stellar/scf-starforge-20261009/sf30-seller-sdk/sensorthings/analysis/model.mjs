// MIT. Source-bound scalar analysis in the original SensorThings workspace.
import {OBSERVATION_COLUMNS,graphIndex,observationRows} from '../domain.mjs';
import {JsonNumber,entityId,numericId,fields,plain,identity,stable,sourceDocument,pointer,timeCell,instant,text,integer,fault} from '../contract.mjs';

export {ANALYSIS_SCHEMA,ANALYSIS_LIMITS,ANALYSIS_ACTIONS,ANALYSIS_MEANING} from './schema.mjs';
import {ANALYSIS_SCHEMA,ANALYSIS_LIMITS,ANALYSIS_MEANING,NUMERIC_OBSERVATION_TYPES} from './schema.mjs';
const HASH=/^[a-f0-9]{64}$/;
export function hash(value,label='identity'){if(!HASH.test(value??''))throw fault('ANALYSIS_ID','Select an exact '+label+'.');return value;}
export function actor(value){return text(value,'the operator name',200);}
export function project(state,id){const p=(state.analysisProjects??[]).find(x=>x.id===id);if(!p)throw fault('ANALYSIS_PROJECT','Select an existing analysis project.',404);return p;}
export function versionRecord(state,id){const p=(state.analysisVersions??[]).find(x=>x.id===id);if(!p)throw fault('ANALYSIS_VERSION','Select an existing immutable analysis version.',404);return p;}
export async function readVersion(store,id){
  const record=versionRecord(store.read(),hash(id,'analysis version')),bytes=await store.object(record.sha256);
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fault('ANALYSIS_VERSION','The retained analysis version is invalid.',409);}
  const {id:claimed,...body}=value;
  if(claimed!==id||identity(body)!==id||value.schema!==ANALYSIS_SCHEMA||value.projectId!==record.projectId)
    throw fault('ANALYSIS_VERSION','The retained version differs from its original identity.',409);
  return value;
}
export function normalizeSelection(input,edition){
  fields(input,['streamKeys','period','view','timeBasis','viewerId'],['streamKeys','period','view']);
  if(!Array.isArray(input.streamKeys)||input.streamKeys.length<1||input.streamKeys.length>ANALYSIS_LIMITS.streams||
     new Set(input.streamKeys).size!==input.streamKeys.length)throw fault('ANALYSIS_STREAMS','Choose one to twenty distinct original scalar streams.');
  for(const key of input.streamKeys){
    const s=edition.plan.streams.find(x=>x.key===key);
    if(!s||s.kind!=='Datastreams')throw fault('ANALYSIS_STREAMS','Choose retained Datastreams. MultiDatastream component selection is not part of this scalar view.');
  }
  if(!['events','numeric','map'].includes(input.view))throw fault('ANALYSIS_VIEW','Choose events, numeric or map.');
  if(input.timeBasis!==undefined&&input.timeBasis!=='phenomenonTime')throw fault('ANALYSIS_TIME','This view uses phenomenonTime; result and valid times remain separate source fields.');
  let period=null;
  if(input.period!==null){
    fields(input.period,['start','end'],['start','end']);const a=instant(input.period.start),b=instant(input.period.end);
    if(!a.utc||!b.utc||a.utc>=b.utc)throw fault('ANALYSIS_PERIOD','Use an increasing, explicitly offset-qualified start and exclusive end.');
    period={start:input.period.start,end:input.period.end,startUtc:a.utc,endUtc:b.utc};
  }
  const viewerId=input.viewerId===undefined||input.viewerId===null?null:hash(input.viewerId,'installed viewer');
  return {streamKeys:[...input.streamKeys],period,view:input.view,viewerId,timeBasis:'phenomenonTime',
    intervalPolicy:'source-explicit-only',instantPolicy:'events-only',unresolvedTimePolicy:'retain-unplaced'};
}
function rowStreamKey(row,edition){
  return edition.plan.streams.find(x=>x.kind===row.stream_kind&&x.id.type===row.stream_id_type&&x.id.value===row.stream_id)?.key??null;
}
export function rowSelected(row,selection,edition){
  if(!selection.streamKeys.includes(rowStreamKey(row,edition)))return false;
  if(!selection.period)return true;
  const {startUtc:a,endUtc:b}=selection.period,t=row.phenomenon_start_utc,e=row.phenomenon_end_utc;
  if(!t||!['explicit_instant','explicit_interval'].includes(row.phenomenon_time_kind))return true;
  return row.phenomenon_time_kind==='explicit_interval'?t<b&&e>a:t>=a&&t<b;
}
export async function* selectedRows(store,edition,selection){
  let count=0;
  for await(const value of observationRows(store,edition)){
    if(!rowSelected(value.row,selection,edition))continue;
    if(++count>ANALYSIS_LIMITS.rows)throw fault('ANALYSIS_CAPACITY','The selected scalar view exceeds 250,000 original occurrences. Select a smaller explicit source/window.',413);
    yield {...value,streamKey:rowStreamKey(value.row,edition)};
  }
}
export function numericEligibility(row){
  if(!NUMERIC_OBSERVATION_TYPES.includes(row.observation_type))return {eligible:false,reason:'observation_type_not_declared_numeric'};
  if(row.result_state!=='value'||row.result_type!=='number')return {eligible:false,reason:'not_an_original_json_number'};
  if(row.phenomenon_time_kind!=='explicit_instant')return {eligible:false,reason:'phenomenon_time_not_an_explicit_instant'};
  let exact;try{exact=numericId(new JsonNumber(row.result));}catch{return {eligible:false,reason:'invalid_original_number'};}
  if(row.observation_type===NUMERIC_OBSERVATION_TYPES[1]&&exact!=='0'&&BigInt(exact.slice(exact.lastIndexOf('e')+1))<0n)
    return {eligible:false,reason:'count_result_not_integral'};
  const browser=Number(row.result);
  if(!Number.isFinite(browser))return {eligible:false,reason:'outside_finite_browser_range'};
  if(browser===0&&exact!=='0')return {eligible:false,reason:'nonzero_result_underflows_in_browser'};
  return {eligible:true,reason:null};
}
export function nativeEntityCompatibility(value){
  let id;try{id=entityId(value);}catch{return {compatible:false,reason:'missing_or_invalid_original_id'};}
  if(id.type==='number'){
    const n=Number(id.value);
    if(!Number.isFinite(n)||entityId(new JsonNumber(String(n))).key!==id.key)
      return {compatible:false,reason:'numeric_id_changes_in_native_browser',id};
    return {compatible:true,clientId:String(n),id};
  }
  if(!id.value||/['%/?#\\()\u0000-\u001f\u007f]/u.test(id.value))
    return {compatible:false,reason:'native_client_does_not_escape_this_string_id',id};
  return {compatible:true,clientId:id.value,id};
}
function nativeStreamProfile(item,graph){
  const issues=[],identities=[];
  function entity(x,role){
    const result=nativeEntityCompatibility(x.record['@iot.id']);identities.push({role,...result,sourceRef:x.sourceRef});
    if(!result.compatible)issues.push({code:result.reason,role,sourceRef:x.sourceRef,id:result.id??null});
  }
  entity(item,'Datastream');
  for(const role of ['Thing','Sensor','ObservedProperty']){
    const related=graph.relation(item,role);
    if(related.length!==1)issues.push({code:'native_singular_relation_unavailable_or_ambiguous',role,count:related.length,sourceRef:item.sourceRef});
    for(const x of related){
      entity(x,role);
      if(role==='Thing'){
        const locations=graph.relation(x,'Locations');
        if(!locations.length)issues.push({code:'native_expanded_view_requires_a_thing_location',role:'Thing/Locations',sourceRef:x.sourceRef});
        for(const loc of locations)entity(loc,'Thing/Locations');
      }
    }
  }
  if(!plain(item.record.unitOfMeasurement))issues.push({code:'native_expanded_view_requires_unit_object',sourceRef:item.sourceRef});
  return {metadataCompatible:issues.length===0,identities,issues,firstLocationPolicy:'Native expanded view uses the first original Thing Location; it is not inferred as an observation location.'};
}
function objectJSON(value){try{return JSON.parse(value);}catch{return null;}}
function count(map,key){map[key]=(map[key]??0)+1;}
export async function describeSelection(store,edition,selection){
  const graph=await graphIndex(store,edition),streams=selection.streamKeys.map(key=>{
    const chosen=edition.plan.streams.find(x=>x.key===key),item=graph.streams.get(key);
    if(!item)throw fault('ANALYSIS_STREAM_SOURCE','Beginning stream metadata is unavailable.',409);
    const thing=graph.relation(item,'Thing'),locations=thing.flatMap(t=>graph.relation(t,'Locations'));
    return {key,id:chosen.id,name:chosen.name.value,kind:chosen.kind,sourceRef:item.sourceRef,
      observationType:item.record.observationType??null,nativeViewer:nativeStreamProfile(item,graph),sourceJson:JSON.stringify(item.record),unit:objectJSON(JSON.stringify(item.record.unitOfMeasurement??null)),
      observedProperties:graph.relation(item,'ObservedProperty').map(x=>({entity:objectJSON(JSON.stringify(x.record)),sourceRef:x.sourceRef,sourceJson:JSON.stringify(x.record),id:nativeEntityCompatibility(x.record['@iot.id']).id??null})),
      locations:locations.map(x=>({entity:objectJSON(JSON.stringify(x.record)),sourceRef:x.sourceRef,sourceJson:JSON.stringify(x.record),id:nativeEntityCompatibility(x.record['@iot.id']).id??null})),
      rows:0,resultTypes:Object.create(null),categories:Object.create(null),timeKinds:Object.create(null),qualityStates:Object.create(null),numericEligibleRows:0,numericExcludedRows:0,numericExclusionReasons:Object.create(null),firstUtc:null,lastUtc:null};
  }),byKey=new Map(streams.map(x=>[x.key,x])),ids=new Map();let total=0,unplaced=0,intervals=0,events=0;
  for await(const {row,original,streamKey}of selectedRows(store,edition,selection)){
    const s=byKey.get(streamKey);total++;s.rows++;count(s.resultTypes,row.result_type);count(s.timeKinds,row.phenomenon_time_kind);count(s.qualityStates,row.result_quality_state);
    if(row.result_state==='value'&&row.result_type==='string')count(s.categories,row.result);
    if(row.phenomenon_time_kind==='explicit_interval')intervals++;else if(row.phenomenon_time_kind==='explicit_instant')events++;else unplaced++;
    const numeric=numericEligibility(row);if(numeric.eligible)s.numericEligibleRows++;else{s.numericExcludedRows++;count(s.numericExclusionReasons,numeric.reason);}
    if(row.phenomenon_start_utc&&['explicit_instant','explicit_interval'].includes(row.phenomenon_time_kind)){
      if(!s.firstUtc||row.phenomenon_start_utc<s.firstUtc)s.firstUtc=row.phenomenon_start_utc;
      const end=row.phenomenon_end_utc||row.phenomenon_start_utc;if(!s.lastUtc||end>s.lastUtc)s.lastUtc=end;
    }
    if(original.key){const a=ids.get(original.key)??[];a.push(original.semanticHash);ids.set(original.key,a);}
  }
  return {schema:'stellar-forge.sensorthings-analysis-summary.v1',editionId:edition.id,selection,
    sourceScope:edition.scope,sourceIssues:edition.issues,license:edition.source.license,
    totalOccurrences:total,distinctObservationKeys:ids.size,duplicateObservationKeys:[...ids.values()].filter(v=>v.length>1).length,
    changedDuplicateKeys:[...ids.values()].filter(v=>new Set(v).size>1).length,instantEvents:events,explicitIntervals:intervals,unplacedOccurrences:unplaced,
    streams,meaning:ANALYSIS_MEANING};
}
export async function rowsPage(store,edition,selection,{offset=0,limit=100}={}){
  integer(offset,'row offset',0,Number.MAX_SAFE_INTEGER);integer(limit,'page rows',1,ANALYSIS_LIMITS.pageRows);
  const rows=[];let total=0;
  for await(const v of selectedRows(store,edition,selection)){if(total>=offset&&rows.length<limit)rows.push({...v.row,stream_key:v.streamKey,source:v.original.sourceRef,numeric:numericEligibility(v.row)});total++;}
  return {editionId:edition.id,selection,columns:[...OBSERVATION_COLUMNS,'stream_key'],rows,total,offset,nextOffset:offset+rows.length<total?offset+rows.length:null};
}
export async function validateAnnotation(store,input,edition,previous=[]){
  fields(input,['id','kind','text','refs','status'],['kind','text','refs']);
  if(!['note','quality','interpretation'].includes(input.kind)||typeof input.text!=='string'||!input.text.trim()||input.text.length>8000)
    throw fault('ANALYSIS_ANNOTATION','Supply a named annotation kind and a nonempty note of at most 8,000 characters.');
  if(!Array.isArray(input.refs)||input.refs.length<1||input.refs.length>100)throw fault('ANALYSIS_CITATIONS','Cite one to one hundred retained source positions.');
  const refs=[];
  for(const r of input.refs){
    fields(r,['editionId','sha256','jsonPointer','occurrenceId'],['editionId','sha256','jsonPointer']);
    if(r.editionId!==edition.id||!edition.sourceFiles.some(x=>x.sha256===hash(r.sha256,'source SHA'))||typeof r.jsonPointer!=='string'||r.jsonPointer.length>2048)
      throw fault('ANALYSIS_CITATIONS','Bind each annotation to the selected original edition and source member.');
    const document=sourceDocument(await store.object(r.sha256));
    if(pointer(document,r.jsonPointer)===undefined)throw fault('ANALYSIS_CITATIONS','The cited JSON pointer is absent from the exact original source.',409);
    if(r.occurrenceId!==undefined){
      hash(r.occurrenceId,'original occurrence');
      // Use the exact source-domain occurrence formula against the already
      // verified original page. A citation never needs a second full-row scan.
      const found=edition.pages.some(page=>{
        if(page.kind!=='Observations'||page.receipt.sha256!==r.sha256)return false;
        const root=page.collection?/^\/value\/(?:0|[1-9]\d*)$/.test(r.jsonPointer):r.jsonPointer==='';
        return root&&plain(pointer(document,r.jsonPointer))&&
          identity({taskId:page.taskId,sha256:r.sha256,pointer:r.jsonPointer})===r.occurrenceId;
      });
      if(!found)throw fault('ANALYSIS_CITATIONS','The occurrence and source pointer do not identify the same original observation.',409);
    }
    refs.push(structuredClone(r));
  }
  const status=input.status??'active';if(!['active','withdrawn'].includes(status))throw fault('ANALYSIS_ANNOTATION','Use active or withdrawn annotation status.');
  if(input.id!==undefined&&!previous.some(x=>x.id===input.id))throw fault('ANALYSIS_ANNOTATION','An edited annotation must cite an existing annotation ID.');
  return {id:input.id??identity({kind:input.kind,text:input.text,refs}),kind:input.kind,text:input.text,refs,status};
}
function comparisonSourceContext(left,right,streamKeys){
  const refs=(edition,key,phase)=>edition.pages.filter(p=>p.streamKey===key&&p.phase===phase).map(p=>({
    taskId:p.taskId,phase:p.phase,sha256:p.receipt.sha256,bytes:p.receipt.bytes,
    requestId:p.receipt.requestId,url:p.receipt.url,jsonPointer:'',
    sourceCapturedAt:p.receipt.sourceCapturedAt??null,connectorReceivedAt:p.receipt.connectorTransfer?.receivedAt??null,
    nativeRequestStartedAt:p.receipt.startedAt,nativeRequestCompletedAt:p.receipt.completedAt,
    representation:p.receipt.representation
  }));
  const brackets=[];
  for(const streamKey of streamKeys)for(const phase of ['stream-start','stream-end']){
    const a=refs(left,streamKey,phase),b=refs(right,streamKey,phase);
    const state=a.length>1||b.length>1?'ambiguous_original_reads':!a.length&&!b.length?'unavailable_both':
      !a.length?'observed_only_right':!b.length?'observed_only_left':
      a[0].sha256===b[0].sha256?'same_original_bytes':'different_original_bytes';
    brackets.push({streamKey,phase,state,left:a,right:b});
  }
  return {
    left:{editionId:left.id,sourceId:left.source.id,serviceUrl:left.source.serviceUrl,
      query:left.plan.observationQuery,scope:left.scope,issues:left.issues},
    right:{editionId:right.id,sourceId:right.source.id,serviceUrl:right.source.serviceUrl,
      query:right.plan.observationQuery,scope:right.scope,issues:right.issues},
    brackets,
    meaning:'Opening and closing stream-response byte comparisons are separate from observation differences. Different bytes do not by themselves identify changed units, quality approval or a synchronized provider revision; inspect the cited originals.'
  };
}
export async function compareSelection(store,left,right,selection){
  const rightSelection={...selection,streamKeys:selection.streamKeys.filter(k=>right.plan.streams.some(s=>s.key===k))},
    missingStreamKeys=selection.streamKeys.filter(k=>!rightSelection.streamKeys.includes(k));
  async function collect(edition,selected){
    const values=new Map(),unkeyed=[];
    for await(const v of selectedRows(store,edition,selected)){
      const item={occurrenceId:v.original.occurrenceId,semanticHash:v.original.semanticHash,sourceRef:v.original.sourceRef,
        streamKey:v.streamKey,result:{state:v.row.result_state,type:v.row.result_type,value:v.row.result},
        phenomenonTime:v.row.phenomenon_time,resultTime:v.row.result_time,quality:v.row.result_quality,issues:objectJSON(v.row.issues)};
      if(!v.original.key){unkeyed.push(item);continue;}const rows=values.get(v.original.key)??[];rows.push(item);values.set(v.original.key,rows);
    }
    return {values,unkeyed};
  }
  const a=await collect(left,selection),b=await collect(right,rightSelection),counts={same:0,changed:0,observedOnlyLeft:0,observedOnlyRight:0,ambiguous:0},changes=[];
  for(const key of [...new Set([...a.values.keys(),...b.values.keys()])].sort()){
    const l=a.values.get(key)??[],r=b.values.get(key)??[];
    const state=l.length>1||r.length>1?'ambiguous':!l.length?'observedOnlyRight':!r.length?'observedOnlyLeft':
      l[0].semanticHash===r[0].semanticHash?'same':'changed';counts[state]++;
    if(state!=='same')changes.push({key,state,left:l,right:r});
  }
  return {schema:'stellar-forge.sensorthings-analysis-comparison.v1',leftEditionId:left.id,rightEditionId:right.id,
    selection,rightSelection,missingStreamKeys,sourceQueryCompatible:stable(left.plan.observationQuery)===stable(right.plan.observationQuery)&&left.source.serviceUrl===right.source.serviceUrl,
    counts,unkeyed:{left:a.unkeyed,right:b.unkeyed},changes,
    sourceContext:comparisonSourceContext(left,right,selection.streamKeys),meaning:ANALYSIS_MEANING.comparison};
}
export function csvCell(value){const s=value===null||value===undefined?'':typeof value==='string'?value:JSON.stringify(value);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}
export async function* selectedCSV(store,edition,selection){
  const columns=[...OBSERVATION_COLUMNS,'stream_key'];yield Buffer.from(columns.join(',')+'\r\n');
  for await(const {row,streamKey}of selectedRows(store,edition,selection))yield Buffer.from(columns.map(k=>csvCell(k==='stream_key'?streamKey:row[k])).join(',')+'\r\n');
}

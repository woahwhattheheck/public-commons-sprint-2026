// MIT. Lossless SensorThings observation/graph views and source-bound comparisons.
import {sourceDocument,valueCell,timeCell,entityId,sourceURL,linksFromEntity,plain,identity,stable,sha,fault,streamMeaning,escapePointer} from './contract.mjs';
export const OBSERVATION_COLUMNS=Object.freeze([
 'occurrence_id','observation_id','observation_id_type','stream_id','stream_id_type','stream_kind','stream_name',
 'observation_type','observed_property','unit','thing','feature_of_interest',
 'phenomenon_time','phenomenon_time_state','phenomenon_time_kind','phenomenon_start_utc','phenomenon_end_utc',
 'result_time','result_time_state','result_time_utc','valid_time','valid_time_state','valid_start_utc','valid_end_utc',
 'result','result_state','result_type','result_quality','result_quality_state','parameters','parameters_state',
 'source_page_sha256','source_pointer','source_observed_at','stream_source_sha256','stream_source_pointer','observation_json','issues'
]);
export const COMPONENT_COLUMNS=Object.freeze([...OBSERVATION_COLUMNS,'component_index','component_property','component_unit',
 'component_observation_type','component_value','component_value_state','component_value_type']);
export const ENTITY_COLUMNS=Object.freeze(['occurrence_id','entity_kind','entity_id','entity_id_type','name','description','self_link',
 'capture_phase','source_page_sha256','source_pointer','source_observed_at','entity_json']);
const SOURCE_FIELDS=new Set(['occurrence_id','source_page_sha256','source_pointer','source_observed_at','stream_source_sha256','stream_source_pointer']);
const relationshipKinds={Thing:'Things',Sensor:'Sensors',ObservedProperty:'ObservedProperties',ObservedProperties:'ObservedProperties',
 Locations:'Locations',HistoricalLocations:'HistoricalLocations',FeatureOfInterest:'FeaturesOfInterest',Datastream:'Datastreams',MultiDatastream:'MultiDatastreams'};
function rootRecords(doc,page){
  if(page.collection){
    if(!plain(doc)||!Array.isArray(doc.value))throw fault('EDITION_COLLECTION','A retained collection no longer has its original array.',409);
    return doc.value.map((record,i)=>({record,pointer:'/value/'+i}));
  }
  return [{record:doc,pointer:''}];
}
function* nestedRecords(record,kind,pointer,depth=0){
  if(!plain(record)||depth>8)return;
  yield {record,kind,pointer};
  for(const [name,nextKind]of Object.entries(relationshipKinds)){
    const child=record[name];if(Array.isArray(child)){
      for(let i=0;i<child.length;i++)yield* nestedRecords(child[i],nextKind,pointer+'/'+escapePointer(name)+'/'+i,depth+1);
    }else if(plain(child))yield* nestedRecords(child,nextKind,pointer+'/'+escapePointer(name),depth+1);
  }
}
export async function* entityOccurrences(store,edition,{includeObservations=false,includeEnd=true,includeObservationMetadata=true}={}){
  for(const page of edition.pages){
    if((page.kind==='Observations'&&!includeObservations&&!includeObservationMetadata)||(!includeEnd&&page.phase==='stream-end'))continue;
    const doc=sourceDocument(await store.object(page.receipt.sha256));
    for(const root of rootRecords(doc,page))for(const entity of nestedRecords(root.record,page.kind,root.pointer)){
      if(entity.kind==='Observations'&&!includeObservations)continue;
      const sourceRef={sha256:page.receipt.sha256,bytes:page.receipt.bytes,jsonPointer:entity.pointer,requestId:page.receipt.requestId,
        url:page.url,capturedAt:page.receipt.sourceCapturedAt??page.receipt.completedAt};
      yield {...entity,page,sourceRef,occurrenceId:identity({taskId:page.taskId,sha256:sourceRef.sha256,pointer:entity.pointer})};
    }
  }
}
export async function graphIndex(store,edition){
  const urls=new Map(),streams=new Map();
  for await(const item of entityOccurrences(store,edition,{includeEnd:false,includeObservationMetadata:false})){
    const link=item.record['@iot.selfLink'];let keys=[];
    if(typeof link==='string'){try{keys.push(sourceURL(link,edition.source,item.page.url));}catch{}}
    if(item.pointer===''||/^\/value\/\d+$/.test(item.pointer))keys.push(item.page.originUrl??item.page.url,item.page.url);
    for(const key of new Set(keys)){const values=urls.get(key)??[];values.push(item);urls.set(key,values);}
    if(item.page.phase==='stream-start'&&item.pointer==='')streams.set(item.page.streamKey,item);
  }
  function relation(item,name){
    const inline=item?.record?.[name];
    if(Array.isArray(inline))return inline.map((record,i)=>({record,kind:relationshipKinds[name],page:item.page,
      sourceRef:{...item.sourceRef,jsonPointer:item.sourceRef.jsonPointer+'/'+escapePointer(name)+'/'+i}}));
    if(plain(inline))return [{record:inline,kind:relationshipKinds[name],page:item.page,sourceRef:{...item.sourceRef,jsonPointer:item.sourceRef.jsonPointer+'/'+escapePointer(name)}}];
    const link=item?.record?.[name+'@iot.navigationLink'];
    if(typeof link!=='string')return [];
    try{return urls.get(sourceURL(link,edition.source,typeof item.record['@iot.selfLink']==='string'?sourceURL(item.record['@iot.selfLink'],edition.source,item.page.url):item.page.url))??[];}catch{return [];}
  }
  return {urls,streams,relation};
}
function represented(items){
  return JSON.stringify(items.map(x=>({entity:x.record,source:x.sourceRef})));
}
export async function* observationRows(store,edition,{table='observations',graph}={}){
  if(!['observations','components'].includes(table))throw fault('TABLE','Choose observations or components.');
  graph??=await graphIndex(store,edition);
  for(const page of edition.pages.filter(p=>p.kind==='Observations')){
    const doc=sourceDocument(await store.object(page.receipt.sha256));
    for(const {record,pointer}of rootRecords(doc,page)){
      if(!plain(record)||Array.isArray(record.dataArray))throw fault('REPRESENTATION','This operation requires original Observation entities, not an undeclared dataArray response.',422);
      const selected=edition.plan.streams.find(s=>s.key===page.streamKey),stream=graph.streams.get(page.streamKey);
      if(!selected||!stream)throw fault('STREAM_BINDING','The observation page has no retained beginning stream metadata.',409);
      let oid;try{oid=entityId(record['@iot.id']);}catch{oid={type:valueCell(record['@iot.id']).type,value:valueCell(record['@iot.id']).value,key:null};}
      const occurrence=identity({taskId:page.taskId,sha256:page.receipt.sha256,pointer});
      const p=timeCell(record.phenomenonTime),r=timeCell(record.resultTime),v=timeCell(record.validTime),
        result=valueCell(record.result),quality=valueCell(record.resultQuality),parameters=valueCell(record.parameters);
      const observed=graph.relation(stream,selected.kind==='MultiDatastreams'?'ObservedProperties':'ObservedProperty'),
        things=graph.relation(stream,'Thing');
      const observationItem={record,sourceRef:{sha256:page.receipt.sha256,bytes:page.receipt.bytes,jsonPointer:pointer,
        requestId:page.receipt.requestId,url:page.url,capturedAt:page.receipt.sourceCapturedAt??page.receipt.completedAt},page};
      const features=graph.relation(observationItem,'FeatureOfInterest'),issues=[];
      if(!oid.key)issues.push('MISSING_OR_UNSUPPORTED_OBSERVATION_ID');
      if(result.state==='missing')issues.push('MISSING_RESULT');
      if(p.state==='missing')issues.push('MISSING_PHENOMENON_TIME');
      if(p.state==='value'&&!['explicit_instant','explicit_interval'].includes(p.kind))issues.push('UNNORMALIZED_PHENOMENON_TIME');
      if(r.state==='value'&&r.kind!=='explicit_instant')issues.push('UNNORMALIZED_RESULT_TIME');
      if(v.state==='value'&&v.kind!=='explicit_interval')issues.push('UNNORMALIZED_VALID_TIME');
      if(observed.length===0)issues.push('OBSERVED_PROPERTY_UNRESOLVED');
      if(things.length!==1)issues.push('THING_RELATION_UNRESOLVED_OR_NONUNIQUE');
      if(features.length!==1)issues.push('FEATURE_OF_INTEREST_UNRESOLVED_OR_NONUNIQUE');
      const unit=selected.kind==='MultiDatastreams'?stream.record.unitOfMeasurements:stream.record.unitOfMeasurement,
        type=selected.kind==='MultiDatastreams'?stream.record.multiObservationDataTypes:stream.record.observationType;
      if(unit===undefined)issues.push('MISSING_SOURCE_UNIT_DECLARATION');
      if(type===undefined)issues.push('MISSING_OBSERVATION_TYPE');
      const row={
        occurrence_id:occurrence,observation_id:oid.value,observation_id_type:oid.type,
        stream_id:selected.id.value,stream_id_type:selected.id.type,stream_kind:selected.kind,stream_name:valueCell(stream.record.name).value,
        observation_type:valueCell(type).value,observed_property:represented(observed),unit:valueCell(unit).value,
        thing:represented(things),feature_of_interest:represented(features),
        phenomenon_time:p.value,phenomenon_time_state:p.state,phenomenon_time_kind:p.kind,
        phenomenon_start_utc:p.startUtc??'',phenomenon_end_utc:p.endUtc??'',
        result_time:r.value,result_time_state:r.state,result_time_utc:r.kind==='explicit_instant'?r.startUtc??'':'',
        valid_time:v.value,valid_time_state:v.state,valid_start_utc:v.startUtc??'',valid_end_utc:v.endUtc??'',
        result:result.value,result_state:result.state,result_type:result.type,result_quality:quality.value,result_quality_state:quality.state,
        parameters:parameters.value,parameters_state:parameters.state,
        source_page_sha256:page.receipt.sha256,source_pointer:pointer,source_observed_at:page.receipt.sourceCapturedAt??page.receipt.completedAt,
        stream_source_sha256:stream.sourceRef.sha256,stream_source_pointer:stream.sourceRef.jsonPointer,
        observation_json:JSON.stringify(record),issues:JSON.stringify(issues)
      };
      const key=oid.key?selected.key+'/'+oid.key:null,semanticHash=identity({observation:record,stream:streamMeaning(stream.record,selected.kind),
        observedProperties:observed.map(x=>x.record),things:things.map(x=>x.record),features:features.map(x=>x.record)});
      const original={key,semanticHash,sourceRef:observationItem.sourceRef,occurrenceId:occurrence};
      if(table==='observations'){yield {row,original};continue;}
      if(selected.kind!=='MultiDatastreams')continue;
      if(!Array.isArray(record.result)){yield {row:{...row,component_index:'',component_property:'',component_unit:'',
          component_observation_type:'',component_value:'',component_value_state:'unavailable',component_value_type:'unavailable',
          issues:JSON.stringify([...issues,'MULTIDATASTREAM_RESULT_NOT_ARRAY'])},original};continue;}
      const units=Array.isArray(unit)?unit:[],types=Array.isArray(type)?type:[];
      const aligned=units.length===record.result.length&&types.length===record.result.length&&observed.length===record.result.length;
      for(let i=0;i<record.result.length;i++){
        const c=valueCell(record.result[i]);
        yield {row:{...row,component_index:String(i),component_property:aligned?JSON.stringify(observed[i].record):'',
          component_unit:aligned?JSON.stringify(units[i]):'',component_observation_type:aligned?valueCell(types[i]).value:'',
          component_value:c.value,component_value_state:c.state,component_value_type:c.type,
          issues:JSON.stringify(aligned?issues:[...issues,'COMPONENT_METADATA_ALIGNMENT_UNRESOLVED'])},original:{...original,componentIndex:i}};
      }
    }
  }
}
export async function* entityRows(store,edition){
  for await(const item of entityOccurrences(store,edition,{includeObservations:false})){
    const id=valueCell(item.record['@iot.id']);
    yield {row:{occurrence_id:item.occurrenceId,entity_kind:item.kind,entity_id:id.value,entity_id_type:id.type,
      name:valueCell(item.record.name).value,description:valueCell(item.record.description).value,self_link:valueCell(item.record['@iot.selfLink']).value,
      capture_phase:item.page.phase,source_page_sha256:item.sourceRef.sha256,source_pointer:item.sourceRef.jsonPointer,
      source_observed_at:item.sourceRef.capturedAt,entity_json:JSON.stringify(item.record)},original:{sourceRef:item.sourceRef}};
  }
}
export const tableColumns=table=>table==='observations'?OBSERVATION_COLUMNS:table==='components'?COMPONENT_COLUMNS:table==='entities'?ENTITY_COLUMNS:null;
export function tableRows(store,edition,table='observations'){
  if(table==='entities')return entityRows(store,edition);
  return observationRows(store,edition,{table});
}
export async function rowsPage(store,edition,{table='observations',offset=0,limit=100}={}){
  if(!tableColumns(table)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw fault('ROW_PAGE','Use a supported table, nonnegative offset and limit 1–500.');
  const rows=[];let total=0;
  for await(const item of tableRows(store,edition,table)){if(total>=offset&&rows.length<limit)rows.push(item.row);total++;}
  return {editionId:edition.id,table,columns:tableColumns(table),offset,limit,total,rows,next:offset+rows.length<total?offset+rows.length:null};
}
export async function summarize(store,edition){
  const ids=new Map(),types={},timeKinds={},qualityStates={},resultStates={},issueCounts={};let rows=0,unkeyed=0,duplicateOccurrences=0,changedDuplicates=0;
  for await(const {row,original}of observationRows(store,edition)){
    rows++;types[row.result_type]=(types[row.result_type]??0)+1;timeKinds[row.phenomenon_time_kind]=(timeKinds[row.phenomenon_time_kind]??0)+1;
    qualityStates[row.result_quality_state]=(qualityStates[row.result_quality_state]??0)+1;resultStates[row.result_state]=(resultStates[row.result_state]??0)+1;
    for(const code of JSON.parse(row.issues))issueCounts[code]=(issueCounts[code]??0)+1;
    if(!original.key)unkeyed++;else{const before=ids.get(original.key);
      if(before){duplicateOccurrences++;if(before!==original.semanticHash)changedDuplicates++;}else ids.set(original.key,original.semanticHash);}
  }
  return {rows,uniqueObservationIds:ids.size,unkeyed,duplicateOccurrences,changedDuplicates,resultTypes:types,timeKinds,
    qualityStates,resultStates,rowIssueCounts:issueCounts,sourceIssues:edition.issues,scope:edition.scope,
    qualityInterpretation:'Original quality values are retained without inferring approval or validity.',
    intervalInterpretation:'No interpolation, fixed sample duration, coverage percentage, uptime or current station capacity is inferred.'};
}
export async function comparison(store,left,right){
  const index=async edition=>{const map=new Map(),unkeyed=[];for await(const {original}of observationRows(store,edition)){
    const compact={occurrenceId:original.occurrenceId,semanticHash:original.semanticHash,sourceRef:original.sourceRef};
    if(!original.key)unkeyed.push(compact);else{const a=map.get(original.key)??[];a.push(compact);map.set(original.key,a);}
  }return {map,unkeyed};};
  const a=await index(left),b=await index(right);
  const scope=e=>({serviceUrl:e.source.serviceUrl,streams:e.plan.streams.map(x=>({kind:x.kind,url:x.url})),query:e.plan.observationQuery});
  const report={leftId:left.id,rightId:right.id,scopeCompatible:stable(scope(left))===stable(scope(right)),
    leftScope:left.scope,rightScope:right.scope,counts:{same:0,changed:0,observedOnlyLeft:0,observedOnlyRight:0,ambiguous:0,unkeyed:a.unkeyed.length+b.unkeyed.length},
    meaning:'Observed set comparison, not proof of provider insertion, deletion or a synchronized snapshot.'};
  async function* changes(){
    const keys=new Set([...a.map.keys(),...b.map.keys()]);
    for(const key of keys){const l=a.map.get(key)??[],r=b.map.get(key)??[];
      const change=l.length>1||r.length>1?'ambiguous':!l.length?'observedOnlyRight':!r.length?'observedOnlyLeft':
        l[0].semanticHash===r[0].semanticHash?'same':'changed';
      report.counts[change]++;if(change!=='same')yield {key,change,left:l,right:r};
    }
    for(const [side,items]of [['left',a.unkeyed],['right',b.unkeyed]])for(const item of items)yield {key:null,change:'unkeyed',side,source:item};
  }
  return {report,changes:changes()};
}

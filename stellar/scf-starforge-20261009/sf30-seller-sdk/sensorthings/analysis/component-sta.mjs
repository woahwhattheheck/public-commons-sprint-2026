// MIT. Explicit component view of original retained MultiDatastream observations.
// This graph uses the existing immutable STA query, ID, paging and authentication
// machinery. It neither queries a provider nor changes a native source edition.
import {entityOccurrences,graphIndex} from '../domain.mjs';
import {sourceDocument,plain,pointer,identity,fault} from '../contract.mjs';
import {nativeEntityCompatibility} from './model.mjs';
import {selectedComponentRows,validateComponentBindings,componentNumericEligibility,COMPONENT_MEANING} from './components.mjs';

export const COMPONENT_STA_MEANING=Object.freeze({
  ...COMPONENT_MEANING,
  representation:'Derived scalar-shaped Datastreams and Observations provide one explicitly selected vector position to the pinned viewer. They are analysis objects, not original provider entities.',
  identifiers:'Derived string IDs bind the original stream and component meaning; observation IDs bind each original occurrence and reviewed position. Original typed IDs, vector, metadata, source pointers and timestamps remain alongside each object.',
  datatype:'observationType retains the original positional declaration, including non-OGC declarations. A numeric-json selection is recorded separately and does not assert source OM_Measurement conformance.',
  ordering:'Every original occurrence is retained in original iteration order. Equal phenomenonTime values remain distinct observations. Query sorting is stable and does not repair times, deduplicate events or infer coverage.',
  extent:'The client queries the selected original events. Provider-wide phenomenonTime extents are retained only as source context, not advertised as this derived selection extent.',
  quality:'Original resultQuality, parameters and all other observation fields remain unchanged except the explicitly selected result and derived identity.'
});

export async function retainedComponentGraph(store,edition,selection,{mode='map',helpers}={}){
  if(!helpers)throw fault('STA_COMPONENT_ADAPTER','Use the existing retained STA graph adapter.',409);
  if(!['map','numeric'].includes(mode))throw fault('STA_MODE','Choose the retained map or numeric projection.');
  const {types,relations,makeNode,addVariant,link,key}=helpers,
    native=await graphIndex(store,edition),
    {bound}=await validateComponentBindings(store,edition,selection,{graph:native}),
    nodes=new Map(),byKind=new Map(types.map(t=>[t,[]]));
  function add(item,kind=item.kind){
    if(!types.includes(kind)||!plain(item.record))return null;
    let k;try{k=key(kind,item.record['@iot.id']);}catch{return null;}
    let node=nodes.get(k);
    if(node)addVariant(node,item);
    else{node=makeNode(kind,item);nodes.set(k,node);byKind.get(kind).push(node);}
    return node;
  }
  // Original related entities are kept under their original typed IDs. Only the
  // selected stream positions and observation occurrences receive derived IDs.
  for await(const item of entityOccurrences(store,edition,{includeEnd:false,includeObservationMetadata:true})){
    if(!['Datastreams','MultiDatastreams','Observations'].includes(item.kind))add(item);
  }
  for(const node of nodes.values())for(const item of [...node.variants])
    for(const [name,[kind]]of Object.entries(relations[node.kind]??{})){
      if(name==='Observations'||name==='Datastreams'||node.kind==='Observations')continue;
      for(const related of native.relation(item,name))link(node,name,add(related,kind));
    }
  const streams=new Map(),bindings=new Map();
  for(const b of bound){
    const {choice,descriptor}=b,item=native.streams.get(choice.streamKey);
    if(!item)throw fault('STA_COMPONENT_STREAM','The selected beginning MultiDatastream is not retained.',409);
    const properties=native.relation(item,'ObservedProperties'),property=properties[choice.index],
      derivedId='component-stream-'+descriptor.seriesKey,
      componentContext={
        schema:'stellar-forge.sensorthings-component-sta.v1',
        derived:true,seriesKey:descriptor.seriesKey,sourceStreamKey:choice.streamKey,
        sourceKind:'MultiDatastreams',originalStreamId:item.record['@iot.id'],
        index:choice.index,bindingId:descriptor.bindingId,meaningId:descriptor.meaningId,
        interpretation:choice.interpretation,sourceDeclarationRewritten:false,
        declaredObservationType:descriptor.declaredType,
        originalUnit:descriptor.unit,originalProperty:property?.record??null,
        originalMultiDatastream:item.record,sourceRefs:[item.sourceRef,...(property?[property.sourceRef]:[])],
        declarationIssues:descriptor.issues,metadataAligned:descriptor.metadataAligned
      },
      record={
        '@iot.id':derivedId,
        name:(typeof item.record.name==='string'?item.record.name:choice.streamKey)+' — '+descriptor.name+' [position '+choice.index+']',
        description:'Retained analysis component at original zero-based position '+choice.index+'. '+(typeof item.record.description==='string'?item.record.description:''),
        unitOfMeasurement:descriptor.unit,
        ...(descriptor.declaredTypeState==='missing'?{}:{observationType:descriptor.declaredType}),
        ...(Object.hasOwn(item.record,'observedArea')?{observedArea:item.record.observedArea}:{}),
        ...(Object.hasOwn(item.record,'phenomenonTime')?{phenomenonTime:item.record.phenomenonTime}:{}),
        'analysis@component':componentContext
      },
      node=add({record,sourceRef:item.sourceRef},'Datastreams');
    if(!node)throw fault('STA_COMPONENT_ID','The derived component stream identity is invalid.',409);
    if(streams.has(descriptor.seriesKey))throw fault('STA_COMPONENT_ID','Selected component series identities collide.',409);
    node.component={choice,descriptor};node.sourceStream=item;
    streams.set(descriptor.seriesKey,node);bindings.set(descriptor.seriesKey,b);
    for(const [name,kind]of [['Thing','Things'],['Sensor','Sensors']])
      for(const related of native.relation(item,name))link(node,name,add(related,kind));
    if(property)link(node,'ObservedProperty',add(property,'ObservedProperties'));
  }
  const observations=[];let pageSha=null,page=null;
  for await(const v of selectedComponentRows(store,edition,selection)){
    const stream=streams.get(v.streamKey),b=bindings.get(v.streamKey);
    if(!stream||!b||b.descriptor.bindingId!==v.component.descriptor.bindingId)
      throw fault('STA_COMPONENT_BINDING','A component row is outside the immutable selected metadata binding.',409);
    const eligibility=componentNumericEligibility(v.row);
    if(mode==='numeric'&&!eligibility.eligible)continue;
    if(pageSha!==v.original.sourceRef.sha256){
      pageSha=v.original.sourceRef.sha256;page=sourceDocument(await store.object(pageSha));
    }
    const raw=pointer(page,v.original.sourceRef.jsonPointer);
    if(!plain(raw))throw fault('STA_COMPONENT_OBSERVATION','The retained original observation is unavailable.',409);
    const index=v.component.choice.index,hasValue=Array.isArray(raw.result)&&Object.hasOwn(raw.result,index),
      derivedId='component-observation-'+v.original.componentOccurrenceId,
      record={...raw,'@iot.id':derivedId,
        'analysis@component':{
          schema:'stellar-forge.sensorthings-component-sta.v1',derived:true,
          sourceKind:'MultiDatastreams',sourceStreamKey:v.sourceStreamKey,seriesKey:v.streamKey,
          originalStreamId:stream.sourceStream.record['@iot.id'],
          originalObservationId:raw['@iot.id'],originalObservationKey:v.original.observationKey,
          originalOccurrenceId:v.original.occurrenceId,componentOccurrenceId:v.original.componentOccurrenceId,
          index,bindingId:v.component.descriptor.bindingId,meaningId:v.component.descriptor.meaningId,
          interpretation:v.component.choice.interpretation,
          originalResultState:v.row.source_result_state,originalResultType:v.row.source_result_type,
          ...(Object.hasOwn(raw,'result')?{originalResult:raw.result}:{}),
          originalObservation:raw,
          originalObservationType:v.component.descriptor.declaredType,
          originalUnit:v.component.descriptor.unit,
          sourceDeclarationRewritten:false,componentAlignment:v.row.component_alignment,
          sourceRef:v.original.sourceRef,componentSourceRef:v.original.componentSourceRef,
          requestedComponentPointer:v.row.component_result_pointer,
          componentPointerState:v.original.componentPointerState,numericEligibility:eligibility
        }};
    if(hasValue)record.result=raw.result[index];else delete record.result;
    const node=makeNode('Observations',{record,sourceRef:v.original.sourceRef});
    node.occurrenceId=v.original.componentOccurrenceId;node.rawRow=v.row;
    node.stream=stream;node.numeric=eligibility.eligible;
    observations.push(node);link(node,'Datastream',stream);
    if(plain(raw.FeatureOfInterest))
      link(node,'FeatureOfInterest',add({record:raw.FeatureOfInterest,sourceRef:{...v.original.sourceRef,
        jsonPointer:v.original.sourceRef.jsonPointer+'/FeatureOfInterest'}},'FeaturesOfInterest'));
    else if(typeof raw['FeatureOfInterest@iot.navigationLink']==='string')
      for(const related of native.urls.get(raw['FeatureOfInterest@iot.navigationLink'])??[])
        link(node,'FeatureOfInterest',add(related,'FeaturesOfInterest'));
  }
  const selected=[...streams.values()].filter(n=>mode!=='numeric'||observations.some(o=>o.stream===n)),
    allowed=new Set(selected.map(n=>n.key));
  for(const node of selected){
    for(const [name,reverse]of [['Thing','Datastreams'],['Sensor','Datastreams'],['ObservedProperty','Datastreams']])
      for(const other of node.edges.get(name)??[])link(other,reverse,node);
    for(const thing of node.edges.get('Thing')??[])
      for(const location of thing.edges.get('Locations')??[])link(location,'Things',thing);
  }
  const used=observations.filter(o=>allowed.has(o.stream.key));
  for(const node of used){
    const current=node.stream.edges.get('Observations')??[];current.push(node);node.stream.edges.set('Observations',current);
    for(const foi of node.edges.get('FeatureOfInterest')??[]){
      const current=foi.edges.get('Observations')??[];current.push(node);foi.edges.set('Observations',current);
    }
  }
  const reachable=new Set(),queue=[...selected];
  while(queue.length){
    const node=queue.shift();if(reachable.has(node.key))continue;reachable.add(node.key);
    for(const [name,values]of node.edges){
      if(name==='Observations')continue;
      for(const other of values)if(other.kind!=='Datastreams'||allowed.has(other.key))queue.push(other);
    }
  }
  for(const [kind,list]of byKind)byKind.set(kind,list.filter(n=>reachable.has(n.key)));
  byKind.set('Datastreams',selected);byKind.set('Observations',used);
  // Exact source metadata IDs still must round-trip through the pinned viewer.
  // There is no relabeling of incompatible related entities into invented IDs.
  for(const [kind,list]of byKind){
    const clientIds=new Map();
    for(const node of list){
      const compatibility=nativeEntityCompatibility(node.rawId);
      if(!compatibility.compatible)continue;
      const old=clientIds.get(compatibility.clientId);
      if(old&&old.key!==node.key)throw fault('STA_NATIVE_ID_COLLISION',
        'Distinct typed source IDs collapse to the pinned-client request. Use the exact component tables.',
        422,{kind,ids:[old.id,node.id],sourceRefs:[...old.refs,...node.refs]});
      clientIds.set(compatibility.clientId,node);
    }
  }
  return {edition,selection,mode,byKind,meaning:COMPONENT_STA_MEANING};
}

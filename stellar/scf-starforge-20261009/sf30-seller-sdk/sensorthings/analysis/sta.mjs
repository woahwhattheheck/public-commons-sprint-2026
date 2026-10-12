// MIT. Read-only SensorThings projection over one immutable analysis version.
// Answers the documented requests made by Helgoland v2.2.3 / toolbox beta4.
// It never sends a provider request and never changes the original source bytes.
import {entityOccurrences,graphIndex} from '../domain.mjs';
import {JsonNumber,entityId,numericId,sourceDocument,stable,timeCell,identity,plain,pointer,fault} from '../contract.mjs';
import {selectedRows,numericEligibility,nativeEntityCompatibility,ANALYSIS_MEANING} from './model.mjs';

const TYPES=['Things','Locations','HistoricalLocations','Datastreams','Sensors','ObservedProperties','Observations','FeaturesOfInterest'];
const RELATIONS={
 Datastreams:{Thing:['Things',false],Sensor:['Sensors',false],ObservedProperty:['ObservedProperties',false],Observations:['Observations',true]},
 Things:{Locations:['Locations',true],HistoricalLocations:['HistoricalLocations',true],Datastreams:['Datastreams',true]},
 Locations:{Things:['Things',true],HistoricalLocations:['HistoricalLocations',true]},
 Sensors:{Datastreams:['Datastreams',true]},ObservedProperties:{Datastreams:['Datastreams',true]},
 HistoricalLocations:{Thing:['Things',false],Locations:['Locations',true]},
 FeaturesOfInterest:{Observations:['Observations',true]},
 Observations:{Datastream:['Datastreams',false],FeatureOfInterest:['FeaturesOfInterest',false]}
};
const isNumber=v=>v instanceof JsonNumber;
export function exactJSON(value){
  if(isNumber(value)){if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.text))throw fault('STA_NUMBER','The retained numeric lexeme is invalid.',409);return value.text;}
  if(value===null)return 'null';
  if(Array.isArray(value))return '['+value.map(v=>exactJSON(v===undefined?null:v)).join(',')+']';
  if(typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+exactJSON(value[k])).join(',')+'}';
  if(typeof value==='number'&&!Number.isFinite(value))throw fault('STA_NUMBER','A derived structural number is not finite.',409);
  const s=JSON.stringify(value);if(s===undefined)throw fault('STA_VALUE','An unsupported value entered the retained view.',409);return s;
}
function key(kind,id){return kind+'/'+entityId(id).key;}
function scalarRecord(record,kind){
  return Object.fromEntries(Object.entries(record).filter(([k])=>!k.startsWith('@iot.')&&!k.endsWith('@iot.navigationLink')&&
    !k.endsWith('@iot.count')&&!Object.hasOwn(RELATIONS[kind]??{},k)));
}
function sourceRef(item){return {...item.sourceRef};}
function numericIdLiteral(id){
  return id.type==='number'?id.value:"'"+id.value.replaceAll("'","''")+"'";
}
function equalId(node,literal){
  if(node.id.type==='string')return node.id.value===literal;
  if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(literal))return false;
  return node.id.key===entityId(sourceDocument(Buffer.from(literal))).key;
}
function makeNode(kind,item){
  const id=entityId(item.record['@iot.id']);
  return {kind,id,key:kind+'/'+id.key,rawId:item.record['@iot.id'],record:scalarRecord(item.record,kind),variants:[item],refs:[sourceRef(item)],edges:new Map(),conflicts:[]};
}
function addVariant(node,item){
  const fields=scalarRecord(item.record,node.kind);
  for(const [k,v]of Object.entries(fields)){
    if(!Object.hasOwn(node.record,k))node.record[k]=v;
    else if(stable(node.record[k])!==stable(v)&&!node.conflicts.includes(k))node.conflicts.push(k);
  }
  if(!node.refs.some(r=>identity(r)===identity(item.sourceRef))){node.refs.push(sourceRef(item));node.variants.push(item);}
}
function link(node,name,other){
  if(!node||!other)return;
  const list=node.edges.get(name)??[];if(!list.some(x=>x.key===other.key))list.push(other);node.edges.set(name,list);
}
export async function retainedGraph(store,edition,selection,{mode='map'}={}){
  if(!['map','numeric'].includes(mode))throw fault('STA_MODE','Choose the retained map or numeric projection.');
  const nodes=new Map(),byKind=new Map(TYPES.map(t=>[t,[]])),native=await graphIndex(store,edition);
  function add(item,kind=item.kind){
    if(!TYPES.includes(kind)||!plain(item.record))return null;
    let k;try{k=key(kind,item.record['@iot.id']);}catch{return null;}
    let node=nodes.get(k);if(node)addVariant(node,item);else{node=makeNode(kind,item);nodes.set(k,node);byKind.get(kind).push(node);}return node;
  }
  for await(const item of entityOccurrences(store,edition,{includeEnd:false,includeObservationMetadata:true}))add(item);
  for(const node of nodes.values())for(const item of [...node.variants])for(const [name,[kind]]of Object.entries(RELATIONS[node.kind]??{})){
    if(name==='Observations'||name==='Datastreams'||node.kind==='Observations')continue;
    for(const related of native.relation(item,name))link(node,name,add(related,kind));
  }
  const selected=new Map();
  for(const streamKey of selection.streamKeys){
    const item=native.streams.get(streamKey);if(!item)throw fault('STA_STREAM','The selected beginning stream metadata is missing.',409);
    const n=add(item,'Datastreams');selected.set(streamKey,n);
  }
  // The projection is limited to selected source streams. Original source pages
  // and their complete relationships remain in the edition and source file API.
  const observations=[];
  let pageSha=null,pageDocument=null;
  for await(const v of selectedRows(store,edition,selection)){
    if(pageSha!==v.original.sourceRef.sha256){pageSha=v.original.sourceRef.sha256;pageDocument=sourceDocument(await store.object(pageSha));}
    const raw=pointer(pageDocument,v.original.sourceRef.jsonPointer),stream=selected.get(v.streamKey);
    const n=makeNode('Observations',{record:raw,sourceRef:v.original.sourceRef});
    n.occurrenceId=v.original.occurrenceId;n.rawRow=v.row;n.stream=stream;
    n.numeric=numericEligibility(v.row).eligible;
    if(mode==='numeric'&&!n.numeric)continue;
    observations.push(n);link(n,'Datastream',stream);
    const foi=raw.FeatureOfInterest;
    if(plain(foi))link(n,'FeatureOfInterest',add({record:foi,sourceRef:{...v.original.sourceRef,jsonPointer:v.original.sourceRef.jsonPointer+'/FeatureOfInterest'}},'FeaturesOfInterest'));
    else{
      const originalLink=raw['FeatureOfInterest@iot.navigationLink'];
      if(typeof originalLink==='string')for(const item of native.urls.get(originalLink)??[])link(n,'FeatureOfInterest',add(item,'FeaturesOfInterest'));
    }
  }
  const allowedStreams=[...selected.values()].filter(n=>mode!=='numeric'||observations.some(o=>o.stream===n));
  const allowed=new Set(allowedStreams.map(n=>n.key));
  for(const n of allowedStreams){
    for(const [name,reverse]of [['Thing','Datastreams'],['Sensor','Datastreams'],['ObservedProperty','Datastreams']]){
      for(const other of n.edges.get(name)??[])link(other,reverse,n);
    }
    for(const thing of n.edges.get('Thing')??[])for(const loc of thing.edges.get('Locations')??[])link(loc,'Things',thing);
  }
  for(const o of observations){
    if(!allowed.has(o.stream.key))continue;
    const list=o.stream.edges.get('Observations')??[];list.push(o);o.stream.edges.set('Observations',list);
    for(const foi of o.edges.get('FeatureOfInterest')??[]){const a=foi.edges.get('Observations')??[];a.push(o);foi.edges.set('Observations',a);}
  }
  // Walk only from the reviewed stream set to avoid advertising unrelated
  // entities obtained while following the original source graph.
  const reachable=new Set(),queue=[...allowedStreams];
  while(queue.length){const n=queue.shift();if(reachable.has(n.key))continue;reachable.add(n.key);
    for(const [name,values]of n.edges){if(name==='Observations')continue;for(const other of values)if(other.kind!=='Datastreams'||allowed.has(other.key))queue.push(other);}
  }
  for(const [kind,list]of byKind)byKind.set(kind,list.filter(n=>reachable.has(n.key)));
  byKind.set('Datastreams',allowedStreams);byKind.set('Observations',observations.filter(o=>allowed.has(o.stream.key)));
  for(const [kind,list]of byKind){
    if(kind==='Observations')continue; // duplicate source occurrences remain explicit
    const clientIds=new Map();
    for(const node of list){
      const compatibility=nativeEntityCompatibility(node.rawId);
      if(!compatibility.compatible)continue;
      const old=clientIds.get(compatibility.clientId);
      if(old&&old.key!==node.key)throw fault('STA_NATIVE_ID_COLLISION','Distinct typed source IDs collapse to the same pinned-client request. Use the exact analyst tables until an explicit compatible source selection is made.',422,{kind,ids:[old.id,node.id],sourceRefs:[...old.refs,...node.refs]});
      clientIds.set(compatibility.clientId,node);
    }
  }
  return {edition,selection,mode,byKind,meaning:ANALYSIS_MEANING};
}
function parsePath(path){
  let pieces;try{pieces=path.replace(/^\/+|\/+$/g,'').split('/').filter(Boolean).map(decodeURIComponent);}catch{throw fault('STA_PATH','Use valid encoded original entity names.');}
  if(pieces.length>2)throw fault('STA_ROUTE','Use a declared retained collection, entity or direct relation.',404);
  if(!pieces.length)return null;
  const m=/^([A-Za-z]+)(?:\((.*)\))?$/.exec(pieces[0]);
  if(!m||!TYPES.includes(m[1]))throw fault('STA_ROUTE','Choose a retained SensorThings collection.',404);
  let literal=m[2];
  if(literal?.startsWith("'")){if(!/^'(?:[^']|'')*'$/.test(literal))throw fault('STA_ID','Use an original quoted string ID.');literal=literal.slice(1,-1).replaceAll("''","'");}
  if(literal!==undefined&&(literal.length>1000||/[\u0000-\u001f]/.test(literal)))throw fault('STA_ID','The source ID is invalid.');
  if(pieces[1]&&(literal===undefined||!RELATIONS[m[1]]?.[pieces[1]]))throw fault('STA_ROUTE','Choose an advertised retained relationship.',404);
  return {kind:m[1],literal,relation:pieces[1]??null};
}
function filterTerms(value){
  if(!value)return [];
  const output=[];let remaining=value.trim();
  while(remaining){
    const m=/^([A-Za-z][A-Za-z0-9/]*?)\s+(eq|ge|le|gt|lt)\s+('(?:[^']|'')*'|[^\s]+)(?:\s+and\s+|$)/.exec(remaining);
    if(!m)throw fault('STA_FILTER','This retained client adapter accepts explicit conjunctions of entity IDs or phenomenonTime bounds.',422);
    let value=m[3];if(value.startsWith("'"))value=value.slice(1,-1).replaceAll("''","'");
    output.push({path:m[1].split('/'),operator:m[2],value});remaining=remaining.slice(m[0].length);
  }
  return output;
}
function matches(node,terms){
  return terms.every(t=>{
    if(t.path.length===1&&t.path[0]==='phenomenonTime'){
      const left=timeCell(node.record.phenomenonTime),right=timeCell(t.value);
      if(right.kind!=='explicit_instant')throw fault('STA_FILTER_TIME','Use an offset-qualified source-time bound.',422);
      if(left.kind!=='explicit_instant')return t.operator==='eq'&&node.record.phenomenonTime===t.value;
      const a=left.startUtc,b=right.startUtc;return t.operator==='eq'?a===b:t.operator==='ge'?a>=b:t.operator==='le'?a<=b:t.operator==='gt'?a>b:a<b;
    }
    if(t.path.at(-1)!=='id'||t.operator!=='eq')throw fault('STA_FILTER','Only original entity ID equality and explicit phenomenonTime bounds are supported.',422);
    let current=[node];
    for(const name of t.path.slice(0,-1)){
      if(current.some(n=>!RELATIONS[n.kind]?.[name]))throw fault('STA_FILTER','The filter relationship is not supported.',422);
      current=current.flatMap(n=>n.edges.get(name)??[]);
    }
    return current.some(n=>equalId(n,t.value));
  });
}
function expandTree(value){
  const tree={};if(!value)return tree;
  for(const path of value.split(',')){
    let at=tree;
    const parts=path.split('/');if(parts.length>5||parts.some(s=>!s||!/^[A-Za-z]+$/.test(s)))throw fault('STA_EXPAND','Use the original client relationship expansion, up to five levels.',422);
    for(const p of parts){at[p]??={};at=at[p];}
  }return tree;
}
function entityURL(root,node){return root+node.kind+'('+encodeURIComponent(numericIdLiteral(node.id))+')';}
function render(node,root,expand,selected,depth=0){
  const nativeId=nativeEntityCompatibility(node.rawId);
  if(!nativeId.compatible)throw fault('STA_NATIVE_ID','The pinned native viewer cannot round-trip this exact original ID. The source and analyst tables remain available.',422,{kind:node.kind,reason:nativeId.reason,id:nativeId.id??null,sourceRefs:node.refs});
  if(node.kind==='Datastreams'&&['Thing','Sensor','ObservedProperty'].some(name=>Object.hasOwn(expand,name))){
    const missing=[];
    for(const name of ['Thing','Sensor','ObservedProperty'])if((node.edges.get(name)??[]).length!==1)missing.push(name);
    const things=node.edges.get('Thing')??[];
    if(things.length===1&&!(things[0].edges.get('Locations')??[]).length)missing.push('Thing/Locations');
    if(!plain(node.record.unitOfMeasurement))missing.push('unitOfMeasurement');
    if(missing.length)throw fault('STA_NATIVE_METADATA','The pinned viewer requires these original fields/relations for its expanded view. Review the retained source profile.',422,{id:node.id,missing,sourceRefs:node.refs});
  }
  if(node.conflicts.length)throw fault('STA_AMBIGUOUS_ENTITY','Different original values share this entity ID. Review its source variants before using the client projection.',409,{kind:node.kind,id:node.id,conflictingFields:node.conflicts,sourceRefs:node.refs});
  let out={'@iot.id':node.rawId,'@iot.selfLink':entityURL(root,node),...node.record,
    'analysis@source':{sourceRefs:node.refs,...(node.occurrenceId?{occurrenceId:node.occurrenceId}:{})}};
  // Remove provider extent from this derivative metadata view. The original
  // remains cited; the client must query the actual retained first/last rows.
  if(node.kind==='Datastreams'&&Object.hasOwn(out,'phenomenonTime')){
    out['analysis@source'].originalPhenomenonTime=out.phenomenonTime;delete out.phenomenonTime;
  }
  for(const [name,[kind,many]]of Object.entries(RELATIONS[node.kind]??{})){
    out[name+'@iot.navigationLink']=entityURL(root,node)+'/'+name;
    if(Object.hasOwn(expand,name)){
      if(depth>=5)throw fault('STA_EXPAND','The requested expansion exceeds the retained view capacity.',413);
      const values=(node.edges.get(name)??[]).map(n=>render(n,root,expand[name],null,depth+1));
      if(!many&&values.length>1)throw fault('STA_AMBIGUOUS_RELATION','The retained singular relationship has multiple original targets.',409,{kind:node.kind,id:node.id,relationship:name});
      out[name]=many?values:values[0]??null;
    }
  }
  for(const name of Object.keys(expand))if(!RELATIONS[node.kind]?.[name])throw fault('STA_EXPAND','The requested relationship is not advertised for this entity.',422);
  if(selected){const keep=new Set(['@iot.id','@iot.selfLink','analysis@source',...selected]);out=Object.fromEntries(Object.entries(out).filter(([k])=>keep.has(k)));}
  return out;
}
export function queryRetained(graph,{root,path,searchParams}){
  if(typeof root!=='string'||!root.endsWith('/')||!root.startsWith('http'))throw fault('STA_ROOT','Use the original authenticated local projection URL.');
  const accepted=new Set(['$filter','$expand','$select','$orderby','$count','$top','$skiptoken']);
  for(const [name]of searchParams)if(!accepted.has(name)||searchParams.getAll(name).length!==1)throw fault('STA_QUERY','Use one supported source-client query option.',422,{parameter:name});
  const route=parsePath(path);
  if(!route)return {value:TYPES.filter(t=>t!=='HistoricalLocations'||graph.byKind.get(t).length).map(name=>({name,url:root+name})),
    'analysis@scope':{editionId:graph.edition.id,selection:graph.selection,mode:graph.mode,meaning:graph.meaning,providerRequests:false}};
  let list=graph.byKind.get(route.kind)??[],singleton=route.literal!==undefined&&!route.relation;
  if(route.literal!==undefined){
    list=list.filter(n=>equalId(n,route.literal));
    if(list.length!==1)throw fault('STA_ENTITY',list.length?'The original ID has multiple retained occurrences. Use the paged collection and source pointers.':'The original entity is outside this retained selection.',list.length?409:404);
    if(route.relation){const n=list[0],meta=RELATIONS[n.kind][route.relation];list=n.edges.get(route.relation)??[];singleton=!meta[1];}
  }
  const expand=expandTree(searchParams.get('$expand')),selected=searchParams.has('$select')?searchParams.get('$select').split(','):null;
  if(selected&&selected.some(s=>!/^(?:@iot\.[A-Za-z]+|[A-Za-z][A-Za-z0-9_]*)$/.test(s)))throw fault('STA_SELECT','Choose original scalar field names.',422);
  const terms=filterTerms(searchParams.get('$filter'));list=list.filter(n=>matches(n,terms));
  const order=searchParams.get('$orderby');
  if(order){
    if(!/^phenomenonTime(?: (?:asc|desc))?$/.test(order))throw fault('STA_ORDER','This client view orders original phenomenonTime only.',422);
    list=[...list].sort((a,b)=>{const x=timeCell(a.record.phenomenonTime).startUtc??'',y=timeCell(b.record.phenomenonTime).startUtc??'';return (x<y?-1:x>y?1:0)*(order.endsWith(' desc')?-1:1);});
  }
  if(singleton){
    if(list.length!==1)throw fault('STA_ENTITY','The singular relation is unavailable or ambiguous in this retained edition.',list.length?409:404);
    return render(list[0],root,expand,selected);
  }
  const topLiteral=searchParams.get('$top')??'200';
  if(!/^(?:0|[1-9]\d*)$/.test(topLiteral)||Number(topLiteral)>500)throw fault('STA_TOP','Use a retained page size between zero and 500.',422);
  const top=Number(topLiteral),count=searchParams.get('$count');if(count!==null&&!['true','false'].includes(count))throw fault('STA_COUNT','Use a Boolean count option.',422);
  const options=[...searchParams].filter(([k])=>k!=='$skiptoken'),queryId=identity({editionId:graph.edition.id,selection:graph.selection,mode:graph.mode,path,options});
  let offset=0;
  if(searchParams.has('$skiptoken')){
    const t=searchParams.get('$skiptoken');
    if(!/^[A-Za-z0-9_-]{1,2048}$/.test(t))throw fault('STA_PAGE','Keep the original opaque continuation.',409);
    let p;try{p=JSON.parse(Buffer.from(t,'base64url').toString('utf8'));}catch{throw fault('STA_PAGE','The original continuation is invalid.',409);}
    if(p.queryId!==queryId||!Number.isSafeInteger(p.offset)||p.offset<0||p.offset>list.length)throw fault('STA_PAGE','This continuation belongs to another immutable query.',409);
    offset=p.offset;
  }
  const rows=list.slice(offset,offset+top),result={value:rows.map(n=>render(n,root,expand,selected)),
    'analysis@scope':{editionId:graph.edition.id,selection:graph.selection,mode:graph.mode,sourceOccurrences:true}};
  if(count==='true')result['@iot.count']=list.length;
  if(top>0&&offset+rows.length<list.length){
    const next=new URL(root+path);for(const [k,v]of options)next.searchParams.append(k,v);
    next.searchParams.set('$skiptoken',Buffer.from(JSON.stringify({queryId,offset:offset+rows.length})).toString('base64url'));result['@iot.nextLink']=next.href;
  }
  return result;
}

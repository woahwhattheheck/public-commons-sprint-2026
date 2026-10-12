// MIT. Source-bound categorical status history; no state carry-forward or occupancy estimate.
import {JsonNumber,entityId,valueCell,instant,plain,stable,sha,fault} from './contract.mjs';
import {parseExactJSON} from '../stellar-expert/exact-json.mjs';

export const STATUS_WINDOW_SCHEMA='stellar-forge.sensorthings-status-window.v1';
export const STATUS_REQUEST_SCHEMA='stellar-forge.sensorthings-status-window-request.v1';
export const STATUS_COMPARISON_SCHEMA='stellar-forge.sensorthings-status-window-comparison.v1';
const SHA=/^[a-f0-9]{64}$/, NS=1000000000n, DAY=86400000000000n;
const lexical=(a,b)=>a<b?-1:a>b?1:0;
function utf8(text){
  if(typeof text!=='string')throw fault('STATUS_TEXT','Retain complete source text.',422);
  const out=[];
  for(const c of text){const n=c.codePointAt(0);
    if(n>=0xd800&&n<=0xdfff)throw fault('STATUS_UTF8','Unpaired source surrogate.',422);
    if(n<0x80)out.push(n);else if(n<0x800)out.push(0xc0|(n>>6),0x80|(n&63));
    else if(n<0x10000)out.push(0xe0|(n>>12),0x80|((n>>6)&63),0x80|(n&63));
    else out.push(0xf0|(n>>18),0x80|((n>>12)&63),0x80|((n>>6)&63),0x80|(n&63));
  }return new Uint8Array(out);
}
const hashObject=value=>sha(utf8(stable(value)));
const copy=value=>JSON.parse(JSON.stringify(value));
function ns(utc){return BigInt(Date.parse(utc.slice(0,19)+'Z'))*1000000n+BigInt(utc.slice(20,29));}
function seconds(value){
  const negative=value<0n,absolute=negative?-value:value,whole=absolute/NS,fraction=(absolute%NS).toString().padStart(9,'0').replace(/0+$/,'');
  return (negative?'-':'')+whole.toString()+(fraction?'.'+fraction:'');
}
function percentage(a,b){
  if(b<=0n)return null;const scaled=a*100000000n/b;
  return (scaled/1000000n).toString()+'.'+(scaled%1000000n).toString().padStart(6,'0');
}
// Source analysis accepts absolute DNS/IPv4 HTTP URLs and never performs requests.
// The restricted parser keeps the calculation portable to a V8 runtime without URL globals.
function safeURL(value){
  if(typeof value!=='string'||/[\u0000-\u0020\u007f\\#]/.test(value))
    throw fault('STATUS_URL','Retain a complete explicit source URL without whitespace or a fragment.',422);
  const m=/^(https?):\/\/([A-Za-z0-9.-]+(?::[0-9]{1,5})?)(\/[^?]*)?(?:\?(.*))?$/.exec(value);
  if(!m||m[2].includes('@'))throw fault('STATUS_URL','Use an absolute DNS or IPv4 source URL without credentials.',422);
  const pathname=m[3]||'/',params=new Map();
  let path;try{path=decodeURIComponent(pathname);}catch{throw fault('STATUS_URL','The original source URL has invalid escaping.',422);}
  if(path.split('/').some(p=>p==='.'||p==='..')||/[\u0000-\u0020\u007f\\]/.test(path))
    throw fault('STATUS_URL','Retain a literal source path without traversal.',422);
  for(const item of (m[4]??'').split('&').filter(Boolean)){
    const at=item.indexOf('='),parts=at<0?[item,'']:[item.slice(0,at),item.slice(at+1)];
    let key,value;try{[key,value]=parts.map(p=>decodeURIComponent(p.replace(/\+/g,' ')));}catch{throw fault('STATUS_URL','Invalid source query escaping.',422);}
    if(params.has(key))throw fault('STATUS_URL','An original query parameter occurs more than once; retain it for manual source review.',422);
    params.set(key,value);
  }
  return {origin:m[1].toLowerCase()+'://'+m[2].toLowerCase(),pathname,searchParams:{get:key=>params.get(key)??null},href:value};
}
function resolveNext(value,base){
  if(/^https?:\/\//.test(value))return safeURL(value).href;
  const parent=safeURL(base);
  if(value.startsWith('?'))return safeURL(parent.origin+parent.pathname+value).href;
  if(value.startsWith('/')&&!value.startsWith('//'))return safeURL(parent.origin+value).href;
  throw fault('STATUS_NEXT_LINK','Retain this relative continuation for source review; the report accepts absolute, root-relative or query-relative links.',422);
}
function retainedSource(item){
  if(!plain(item)||typeof item.filename!=='string'||!item.filename||typeof item.text!=='string'||
      !Number.isSafeInteger(item.bytes)||item.bytes<0||!SHA.test(item.sha256??''))
    throw fault('STATUS_SOURCE','Each complete source text needs its exact filename, URL, bytes and SHA-256.',422);
  safeURL(item.url);
  const bytes=utf8(item.text);
  if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)
    throw fault('STATUS_SOURCE_CHANGED','Source text differs from its retained identity: '+item.filename,409);
  const r=item.receipt;
  if(!plain(r)||typeof r.text!=='string'||typeof r.filename!=='string'||!SHA.test(r.sha256??'')||
      !Number.isSafeInteger(r.bytes)||r.bytes<0)
    throw fault('STATUS_RECEIPT','Include the complete acquisition receipt and its independent file identity.',422);
  const receiptBytes=utf8(r.text);
  if(receiptBytes.length!==r.bytes||sha(receiptBytes)!==r.sha256)
    throw fault('STATUS_RECEIPT_CHANGED','An acquisition receipt changed.',409);
  let receipt;try{receipt=JSON.parse(r.text);}catch{throw fault('STATUS_RECEIPT','The retained acquisition receipt is not JSON.',422);}
  if(receipt.schema!=='stellar-forge.sensorthings-connector-source-receipt.v1'||
      receipt.sourceUrl!==item.url||receipt.receivedAt!==item.receivedAt||
      receipt.body?.filename!==item.filename||receipt.body?.bytes!==item.bytes||receipt.body?.sha256!==item.sha256||
      receipt.representation!=='COMPLETE_CONNECTOR_UTF8_TEXT'||receipt.sourceHttpStatus!==null||receipt.sourceHttpHeaders!==null)
    throw fault('STATUS_RECEIPT_BINDING','The source and complete connector acquisition receipt must agree.',409);
  const received=instant(item.receivedAt);
  if(!received.utc)throw fault('STATUS_RECEIPT_CLOCK','Retain the explicit clock after the complete connector download.',422);
  parseExactJSON(item.text);
  const document=JSON.parse(item.text,(_key,value,context)=>typeof value==='number'?new JsonNumber(context.source):value);
  return {document,ref:{filename:item.filename,url:item.url,bytes:item.bytes,sha256:item.sha256,
    receivedAt:item.receivedAt,representation:'COMPLETE_CONNECTOR_UTF8_TEXT',
    receipt:{filename:r.filename,bytes:r.bytes,sha256:r.sha256},
    httpStatus:null,httpHeaders:null,providerRequestTime:null,
    clockBasis:'Receiver clock after the complete connector download; not provider request time.'}};
}
function cellKey(cell){return stable([cell.state,cell.type,cell.value]);}
function countLiteral(value){
  if(!(value instanceof JsonNumber)||!/^(0|[1-9]\d*)$/.test(value.text))return null;
  return value.text;
}
function point(value){
  const cell=valueCell(value);if(cell.state!=='value'||cell.type!=='string')return {source:cell,state:cell.state,utc:null};
  const t=instant(value);return {source:cell,state:t.state,utc:t.utc};
}
function sourceReference(ref,pointer){return {...ref,pointer};}
function idCell(value){
  try{return {state:'value',...entityId(value)};}
  catch{return {state:'unresolved',source:valueCell(value),key:null};}
}
function sourceField(document,name){return valueCell(document?.[name]);}
function timeStats(values){
  if(!values.length)return {count:0,minSeconds:null,medianSeconds:null,maxSeconds:null};
  const sorted=[...values].sort((a,b)=>a<b?-1:a>b?1:0),n=sorted.length;
  return {count:n,minSeconds:seconds(sorted[0]),
    medianSeconds:n%2?seconds(sorted[(n-1)/2]):seconds((sorted[n/2-1]+sorted[n/2])/2n),
    maxSeconds:seconds(sorted[n-1]),
    medianRounding:'An even-count median is truncated toward zero only if it has sub-nanosecond precision.'};
}
/** Each page is complete literal source text with an independently hashed full connector receipt.
 * Counts and changes concern received point observations. No elapsed gap is assigned to a status.
 * The exact canonical fixed-window filter is intentionally required; no general OData inference.
 */
export function analyzeStatusWindow(input){
  if(!plain(input)||input.schema!==STATUS_REQUEST_SCHEMA||!Array.isArray(input.pages)||!input.pages.length||
      input.pages.length>100000||!plain(input.window)||typeof input.label!=='string'||!input.label.trim())
    throw fault('STATUS_INPUT','Use the complete retained fixed-window status request.',422);
  const a=instant(input.window.start),b=instant(input.window.endExclusive);
  if(!a.utc||!b.utc||a.utc>=b.utc)throw fault('STATUS_WINDOW','Use an increasing explicit start and exclusive end.',422);
  const start=ns(a.utc),end=ns(b.utc),duration=end-start;
  if(duration>36600n*DAY)throw fault('STATUS_WINDOW','Select at most 36,600 days for this daily operational report.',422);
  const firstURL=safeURL(input.firstUrl),expectedFilter='phenomenonTime ge '+input.window.start+' and phenomenonTime lt '+input.window.endExclusive;
  if(firstURL.searchParams.get('$filter')!==expectedFilter||
      !/^phenomenonTime asc(?:,\s*@iot.id asc)?$/.test(firstURL.searchParams.get('$orderby')??''))
    throw fault('STATUS_QUERY','The retained first query must contain the exact selected point-time filter and ascending order.',422);
  if(!plain(input.definitions)||!Array.isArray(input.definitions.codes)||input.definitions.codes.some(c=>typeof c!=='string'||!c)||
      new Set(input.definitions.codes).size!==input.definitions.codes.length||!Array.isArray(input.definitions.sourceRefs)||
      !input.definitions.sourceRefs.length)
    throw fault('STATUS_DEFINITIONS','Retain the publisher code list and exact definition source locators.',422);
  for(const ref of input.definitions.sourceRefs){if(!plain(ref)||typeof ref.url!=='string')throw fault('STATUS_DEFINITIONS','A definition locator is missing.',422);safeURL(ref.url);}
  const codes=new Set(input.definitions.codes),attentionCodes=input.attentionCodes??[];
  if(!Array.isArray(attentionCodes)||attentionCodes.some(c=>typeof c!=='string'||!codes.has(c)))
    throw fault('STATUS_ATTENTION','Select attention codes explicitly from the retained publisher list.',422);
  const stream=retainedSource(input.stream),property=retainedSource(input.observedProperty),sensor=retainedSource(input.sensor);
  if(!plain(stream.document)||!plain(property.document)||!plain(sensor.document))
    throw fault('STATUS_METADATA','Retain complete stream, ObservedProperty and Sensor objects.',422);
  const streamId=entityId(stream.document['@iot.id']),observationsURL=safeURL(stream.document['Observations@iot.navigationLink']);
  if(firstURL.origin!==observationsURL.origin||firstURL.pathname!==observationsURL.pathname||
      property.ref.url!==stream.document['ObservedProperty@iot.navigationLink']||sensor.ref.url!==stream.document['Sensor@iot.navigationLink'])
    throw fault('STATUS_STREAM_BINDING','The selected query and definition objects must follow this original Datastream.',409);
  const sources=[stream.ref,property.ref,sensor.ref],metadata={stream:{id:streamId,name:sourceField(stream.document,'name'),
      description:sourceField(stream.document,'description'),phenomenonTime:sourceField(stream.document,'phenomenonTime'),resultTime:sourceField(stream.document,'resultTime'),observationType:sourceField(stream.document,'observationType'),
      unit:sourceField(stream.document,'unitOfMeasurement'),properties:sourceField(stream.document,'properties'),sourceRef:stream.ref},
    observedProperty:{id:entityId(property.document['@iot.id']),name:sourceField(property.document,'name'),
      definition:sourceField(property.document,'definition'),description:sourceField(property.document,'description'),sourceRef:property.ref},
    sensor:{id:entityId(sensor.document['@iot.id']),name:sourceField(sensor.document,'name'),
      metadata:sourceField(sensor.document,'metadata'),description:sourceField(sensor.document,'description'),sourceRef:sensor.ref}};
  if(input.thing){
    const thing=retainedSource(input.thing);sources.push(thing.ref);
    if(!plain(thing.document)||thing.ref.url!==stream.document['Thing@iot.navigationLink'])
      throw fault('STATUS_THING','The retained Thing must follow the selected Datastream.',409);
    metadata.thing={id:entityId(thing.document['@iot.id']),name:sourceField(thing.document,'name'),
      description:sourceField(thing.document,'description'),properties:sourceField(thing.document,'properties'),
      reportedOwnerThing:valueCell(thing.document.properties?.ownerThing),
      reportedInfoLastUpdate:valueCell(thing.document.properties?.infoLastUpdate),sourceRef:thing.ref,
      ownerInterpretation:'Literal publisher ownerThing field and its reported update date; not independent verification of the current operator.'};
    if(input.locations){
      const locations=retainedSource(input.locations);sources.push(locations.ref);
      if(!plain(locations.document)||!Array.isArray(locations.document.value)||locations.ref.url!==thing.document['Locations@iot.navigationLink'])
        throw fault('STATUS_LOCATIONS','Retain the original Locations collection linked by this Thing.',409);
      metadata.locations={values:copy(locations.document.value),nextLink:valueCell(locations.document['@iot.nextLink']),sourceRef:locations.ref};
    }
  }else if(input.locations)throw fault('STATUS_LOCATIONS','Retain the linked Thing before interpreting its Locations.',422);
  let bracket=null;
  if(input.streamEnd){
    const ending=retainedSource(input.streamEnd);sources.push(ending.ref);
    if(entityId(ending.document['@iot.id']).key!==streamId.key||ending.ref.url!==stream.ref.url)
      throw fault('STATUS_BRACKET','The closing metadata must be a separate receipt for the same Datastream.',409);
    if(ending.ref.receipt.sha256===stream.ref.receipt.sha256)
      throw fault('STATUS_BRACKET','Opening and closing metadata require separate actual acquisition receipts.',409);
    bracket={opening:stream.ref,closing:ending.ref,sameOriginalBody:stream.ref.sha256===ending.ref.sha256,
      sameParsedDocument:stable(stream.document)===stable(ending.document),
      changedFields:[...new Set([...Object.keys(stream.document),...Object.keys(ending.document)])].filter(key=>stable(stream.document[key])!==stable(ending.document[key]))
        .map(key=>({field:key,opening:valueCell(stream.document[key]),closing:valueCell(ending.document[key])})),snapshot:'not_established'};
  }
  const issues=[],pages=[],rows=[],byId=new Map(),counts=[];
  if(bracket&&!bracket.sameParsedDocument)issues.push({code:'STREAM_METADATA_CHANGED_DURING_RETRIEVAL',severity:'notice',fields:bracket.changedFields.map(x=>x.field),
    message:'Opening and closing stream metadata differ. The complete original values and receipts remain in metadataBracket; this does not silently change the selected observation window.'});
  let expectedURL=input.firstUrl,chain=true,lastReceivedTime=null,sourceOrder=true,previousTime=null;
  const seenUrls=new Set();
  for(const [pageIndex,item]of input.pages.entries()){
    const original=retainedSource(item),doc=original.document; sources.push(original.ref);
    if(!plain(doc)||!Array.isArray(doc.value))throw fault('STATUS_PAGE','The complete original page must contain a value array.',422);
    if(item.url!==expectedURL||seenUrls.has(item.url)){chain=false;issues.push({code:'PAGE_CHAIN',page:pageIndex,expectedUrl:expectedURL,actualUrl:item.url});}
    seenUrls.add(item.url);
    const u=safeURL(item.url);if(u.origin!==firstURL.origin||u.pathname!==firstURL.pathname)
      throw fault('STATUS_PAGE_SCOPE','An original observation page belongs to another collection.',409);
    const rawNext=doc['@iot.nextLink'];let next=null;
    if(rawNext!==undefined&&rawNext!==null){
      if(typeof rawNext!=='string'||!rawNext){chain=false;issues.push({code:'NEXT_LINK_INVALID',page:pageIndex});}
      else{next=resolveNext(rawNext,item.url);}
    }
    expectedURL=next;
    const count=countLiteral(doc['@iot.count']);counts.push({page:pageIndex,source:valueCell(doc['@iot.count']),exactInteger:count});
    if(doc['@iot.count']!==undefined&&count===null)issues.push({code:'COUNT_UNRESOLVED',page:pageIndex});
    pages.push({page:pageIndex,url:item.url,sourceRef:original.ref,rows:doc.value.length,count,nextLink:rawNext??null,nextUrl:next});
    const received=instant(item.receivedAt).utc;
    if(lastReceivedTime&&received<lastReceivedTime)issues.push({code:'RECEIPT_CLOCK_ORDER',page:pageIndex});
    lastReceivedTime=received;
    for(const [position,record]of doc.value.entries()){
      if(!plain(record))throw fault('STATUS_ROW','The source value array contains a non-object; retain and correct its selection before this categorical report.',422);
      const ref=sourceReference(original.ref,'/value/'+position),id=idCell(record['@iot.id']),time=point(record.phenomenonTime),
        result=valueCell(record.result),resultTime=point(record.resultTime),rowIssues=[];
      let within=false;
      if(time.utc){const t=ns(time.utc);within=t>=start&&t<end;
        if(!within)rowIssues.push('OUTSIDE_SELECTED_WINDOW');
        if(previousTime&&time.utc<previousTime)sourceOrder=false;previousTime=time.utc;
      }else rowIssues.push('POINT_TIME_UNRESOLVED');
      if(id.state!=='value')rowIssues.push('ID_UNRESOLVED');
      if(result.state!=='value'||result.type!=='string')rowIssues.push('RESULT_NOT_CATEGORY');
      else if(!codes.has(result.value))rowIssues.push('UNDOCUMENTED_RESULT_CODE');
      const row={occurrence:rows.length+1,id,phenomenonTime:time,result,resultTime,
        resultTimestampMinusPhenomenonTimestampSeconds:time.utc&&resultTime.utc?seconds(ns(resultTime.utc)-ns(time.utc)):null,
        validTime:valueCell(record.validTime),resultQuality:valueCell(record.resultQuality),parameters:valueCell(record.parameters),
        featureOfInterestId:plain(record.FeatureOfInterest)?idCell(record.FeatureOfInterest['@iot.id']):{state:'unexpanded',key:null},
        recordSha256:hashObject(record),sourceRef:ref,inSelectedWindow:within,issues:rowIssues,
        analyticalDisposition:id.state==='value'?'pending':'unresolved_id'};
      rows.push(row);if(id.key){if(!byId.has(id.key))byId.set(id.key,[]);byId.get(id.key).push(row);}
    }
  }
  if(expectedURL!==null){chain=false;issues.push({code:'PAGINATION_INCOMPLETE',nextUrl:expectedURL});}
  if(!sourceOrder)issues.push({code:'SOURCE_TIME_ORDER'});
  const knownCounts=counts.filter(c=>c.exactInteger!==null).map(c=>c.exactInteger),distinctCounts=[...new Set(knownCounts)];
  const countAgreement=distinctCounts.length===1&&BigInt(distinctCounts[0])===BigInt(rows.length);
  if(distinctCounts.length>1)issues.push({code:'COUNT_CHANGED',counts:distinctCounts});
  if(knownCounts.length&&!countAgreement)issues.push({code:'COUNT_ROW_MISMATCH',counts:distinctCounts,receivedOccurrences:rows.length});
  const duplicates=[],conflicts=[],events=[],identityIndex=[];
  for(const [key,members]of byId){
    const fingerprints=[...new Set(members.map(r=>r.recordSha256))];
    identityIndex.push({key,recordSha256s:fingerprints.sort(lexical),occurrences:members.length,sourceRefs:members.map(r=>r.sourceRef)});
    if(fingerprints.length>1){
      conflicts.push({key,recordSha256s:fingerprints,sourceRefs:members.map(r=>r.sourceRef)});
      for(const row of members){row.analyticalDisposition='conflicting_id';row.issues.push('CONFLICTING_ID');if(row.inSelectedWindow&&row.phenomenonTime.utc)events.push({...row,ambiguousIdentity:true});}
      continue;
    }
    members[0].analyticalDisposition='retained_unique_id';
    if(members.length>1){
      duplicates.push({key,occurrences:members.length,sourceRefs:members.map(r=>r.sourceRef)});
      for(const row of members.slice(1))row.analyticalDisposition='identical_duplicate_occurrence';
    }
    const row=members[0];if(row.inSelectedWindow&&row.phenomenonTime.utc)events.push({...row,occurrenceRefs:members.map(r=>r.sourceRef)});
  }
  for(const row of rows.filter(r=>!r.id.key&&r.inSelectedWindow&&r.phenomenonTime.utc))events.push({...row,ambiguousIdentity:true});
  if(duplicates.length)issues.push({code:'DUPLICATE_IDS',groups:duplicates.length});
  if(conflicts.length)issues.push({code:'CONFLICTING_IDS',groups:conflicts.length});
  const excluded=rows.filter(r=>r.issues.includes('OUTSIDE_SELECTED_WINDOW')||r.issues.includes('POINT_TIME_UNRESOLVED')||r.issues.includes('ID_UNRESOLVED'));
  if(excluded.length)issues.push({code:'UNRESOLVED_OR_OUTSIDE_ROWS',occurrences:excluded.length});
  const undocumented=[...new Set(rows.filter(r=>r.issues.includes('UNDOCUMENTED_RESULT_CODE')).map(r=>r.result.value))].sort(lexical);
  if(undocumented.length)issues.push({code:'UNDOCUMENTED_RESULT_CODES',codes:undocumented});
  events.sort((x,y)=>lexical(x.phenomenonTime.utc,y.phenomenonTime.utc)||x.occurrence-y.occurrence);
  const grouped=[];
  for(const row of events){
    const t=row.phenomenonTime.utc;
    if(!grouped.length||grouped.at(-1).utc!==t)grouped.push({utc:t,rows:[]});
    grouped.at(-1).rows.push(row);
  }
  const groups=grouped.map(g=>{
    const values=[...new Set(g.rows.map(r=>cellKey(r.result)))],unambiguous=values.length===1&&
      g.rows.every(r=>!r.ambiguousIdentity&&r.result.state==='value'&&r.result.type==='string');
    return {utc:g.utc,code:unambiguous?g.rows[0].result.value:null,unambiguous,events:g.rows.length,
      ids:g.rows.map(r=>r.id),sourceRefs:g.rows.map(r=>r.sourceRef)};
  });
  const ambiguous=groups.filter(g=>!g.unambiguous);
  if(ambiguous.length)issues.push({code:'AMBIGUOUS_TIME_GROUPS',groups:ambiguous.length});
  const pairs=[],gaps=[],latencies=[],categoryCounts=new Map(),resultStates=new Map();
  const unambiguousEvents=events.filter(r=>!r.ambiguousIdentity);
  for(const row of unambiguousEvents){
    const key=cellKey(row.result);if(!resultStates.has(key))resultStates.set(key,{result:row.result,events:0});resultStates.get(key).events++;
    if(row.result.state==='value'&&row.result.type==='string')categoryCounts.set(row.result.value,(categoryCounts.get(row.result.value)??0)+1);
    if(row.phenomenonTime.utc&&row.resultTime.utc)latencies.push(ns(row.resultTime.utc)-ns(row.phenomenonTime.utc));
  }
  function gap(kind,from,to,left=null,right=null){
    return {kind,startUtc:from,endUtc:to,elapsedSeconds:seconds(ns(to)-ns(from)),stateDuringInterval:'not_established',
      leftObservation:left,rightObservation:right};
  }
  if(groups.length){
    gaps.push(gap('leading_boundary',a.utc,groups[0].utc,null,groups[0]));
    for(let i=1;i<groups.length;i++){
      const left=groups[i-1],right=groups[i],elapsed=ns(right.utc)-ns(left.utc);
      gaps.push(gap('between_observed_instants',left.utc,right.utc,left,right));
      const pair={index:i,fromUtc:left.utc,toUtc:right.utc,elapsedSeconds:seconds(elapsed),
        fromCode:left.code,toCode:right.code,fromSourceRefs:left.sourceRefs,toSourceRefs:right.sourceRefs,
        status:left.unambiguous&&right.unambiguous?'categorical_pair':'ambiguous_pair',
        observedCodeChanged:left.unambiguous&&right.unambiguous?left.code!==right.code:null,
        undocumentedCode:left.code!==null&&!codes.has(left.code)||right.code!==null&&!codes.has(right.code),
        sourceUnknownCode:left.code==='UNKNOWN'||right.code==='UNKNOWN',actualChangeTime:null,intermediateStates:'unobserved'};
      pairs.push(pair);
    }
    gaps.push(gap('trailing_boundary',groups.at(-1).utc,b.utc,groups.at(-1),null));
  }else gaps.push(gap('whole_window_without_resolved_point',a.utc,b.utc));
  const transitions=new Map();
  for(const pair of pairs.filter(p=>p.status==='categorical_pair')){
    const key=stable([pair.fromCode,pair.toCode]);
    if(!transitions.has(key))transitions.set(key,{from:pair.fromCode,to:pair.toCode,adjacentObservedPairs:0,changed:pair.observedCodeChanged,
      elapsedSecondsAssignedToEitherStatus:null});
    transitions.get(key).adjacentObservedPairs++;
  }
  const daily=[];
  for(let day=Date.parse(a.utc.slice(0,10)+'T00:00:00Z');BigInt(day)*1000000n<end;day+=86400000){
    const lo=BigInt(day)*1000000n,hi=lo+DAY,selectedLo=lo>start?lo:start,selectedHi=hi<end?hi:end,
      date=new Date(day).toISOString().slice(0,10),dayEvents=unambiguousEvents.filter(r=>r.phenomenonTime.utc.slice(0,10)===date),counts={};
    for(const row of dayEvents)if(row.result.state==='value'&&row.result.type==='string')counts[row.result.value]=(counts[row.result.value]??0)+1;
    daily.push({dateUtc:date,selectedWindowSeconds:seconds(selectedHi-selectedLo),events:dayEvents.length,codeCounts:counts,
      firstObservation:dayEvents[0]?.phenomenonTime.utc??null,lastObservation:dayEvents.at(-1)?.phenomenonTime.utc??null,
      stateDurationSeconds:null,continuousStateCoverage:'not_established'});
  }
  const attention=unambiguousEvents.filter(r=>r.result.state==='value'&&r.result.type==='string'&&attentionCodes.includes(r.result.value))
    .map(row=>{const index=groups.findIndex(g=>g.utc===row.phenomenonTime.utc);
      return {id:row.id,result:row.result,utc:row.phenomenonTime.utc,sourceRef:row.sourceRef,
        previousObserved:groups[index-1]??null,nextObserved:groups[index+1]??null,
        observedBeforeGapSeconds:index>0?seconds(ns(row.phenomenonTime.utc)-ns(groups[index-1].utc)):null,
        observedAfterGapSeconds:index+1<groups.length?seconds(ns(groups[index+1].utc)-ns(row.phenomenonTime.utc)):null,
        stateDurationSeconds:null,action:'Inspect the original observation and adjacent recorded states; no duration or incident resolution is inferred.'};});
  const sortedGaps=[...gaps.filter(g=>g.kind==='between_observed_instants')].sort((x,y)=>{
    const u=ns(x.endUtc)-ns(x.startUtc),v=ns(y.endUtc)-ns(y.startUtc);return u>v?-1:u<v?1:lexical(x.startUtc,y.startUtc);});
  const sourceInputs=sources.map(ref=>({url:ref.url,filename:ref.filename,sha256:ref.sha256,bytes:ref.bytes,
    receivedAt:ref.receivedAt,receipt:ref.receipt}));
  const settings={window:{start:input.window.start,endExclusive:input.window.endExclusive},firstUrl:input.firstUrl,
    definitions:copy(input.definitions),attentionCodes:[...attentionCodes],method:'point-observation-history-no-state-carry-forward-v1'};
  const id=hashObject({schema:STATUS_WINDOW_SCHEMA,settings,sourceInputs});
  const report={schema:STATUS_WINDOW_SCHEMA,id,label:input.label,settings,metadata,metadataBracket:bracket,sources,
    window:{startUtc:a.utc,endExclusiveUtc:b.utc,seconds:seconds(duration),closure:'start-inclusive/end-exclusive'},
    acquisition:{representation:'complete-connector-text',sourceHttpStatus:null,sourceHttpHeaders:null,providerRequestTimes:null,
      atomicSnapshot:'not_established',firstSourceReceivedAt:sources.map(r=>r.receivedAt).sort(lexical)[0],
      lastSourceReceivedAt:sources.map(r=>r.receivedAt).sort(lexical).at(-1)},
    completeness:{pageCount:pages.length,sourceOccurrences:rows.length,declaredCounts:counts,pageChainComplete:chain,
      declaredCountAgreement:knownCounts.length?countAgreement:null,sourceAscendingTimeOrder:sourceOrder,
      uniqueIds:byId.size,identicalDuplicateGroups:duplicates.length,conflictingIdGroups:conflicts.length,
      unresolvedOrOutsideOccurrences:excluded.length,allReportedOccurrencesRetained:true},
    coverage:{resolvedPointEvents:unambiguousEvents.length,distinctResolvedInstants:groups.length,
      firstObservedUtc:groups[0]?.utc??null,lastObservedUtc:groups.at(-1)?.utc??null,
      observationSpanSeconds:groups.length?seconds(ns(groups.at(-1).utc)-ns(groups[0].utc)):null,
      observationSpanPercentOfRequestedWindow:groups.length?percentage(ns(groups.at(-1).utc)-ns(groups[0].utc),duration):null,
      spanMeaning:'First-to-last observation span, not measured continuous state coverage.',
      leadingNoObservationSeconds:groups.length?seconds(ns(groups[0].utc)-start):seconds(duration),
      trailingNoObservationSeconds:groups.length?seconds(end-ns(groups.at(-1).utc)):null,
      daysWithObservations:daily.filter(d=>d.events>0).length,selectedUtcDates:daily.length,
      statusDurationSeconds:null,availabilityPercent:null,chargingUtilizationPercent:null,
      continuity:'No validity interval or state persistence is inferred between point observations.'},
    eventCounts:[...categoryCounts].sort((x,y)=>lexical(x[0],y[0])).map(([code,events])=>({code,events,documented:codes.has(code),stateDurationSeconds:null})),
    resultStates:[...resultStates.values()],transitionSummary:[...transitions.values()].sort((x,y)=>y.adjacentObservedPairs-x.adjacentObservedPairs||lexical(x.from,y.from)||lexical(x.to,y.to)),
    observedAdjacentChangePairs:pairs.filter(p=>p.observedCodeChanged===true).length,
    observedAdjacentSameCodePairs:pairs.filter(p=>p.observedCodeChanged===false).length,
    ambiguousAdjacentPairs:pairs.filter(p=>p.observedCodeChanged===null).length,
    timestampDifference:timeStats(latencies),attention,largestObservationGaps:sortedGaps.slice(0,20),
    daily,pages,history:rows,adjacentPairs:pairs,gaps,duplicates,conflicts,identityIndex:identityIndex.sort((x,y)=>lexical(x.key,y.key)),issues,
    interpretation:[
      'A row establishes its literal result at its reported phenomenonTime. All original source rows and their pointers are retained.',
      'Event counts and adjacent observed code changes are not state duration, energy, charging sessions, utilization, uptime or confirmed incident counts.',
      'Leading and trailing boundaries, all gaps, UNKNOWN results and ambiguous timestamp groups remain explicit. No prior or later state is imputed.',
      'Publisher code labels are used literally; the report does not silently translate protocol versions or infer meanings from their spelling.',
      'Matching closing metadata and a complete page chain do not prove an atomic source snapshot.'
    ]};
  report.resultSha256=hashObject(report);
  return report;
}
function verifyReport(report){
  if(!plain(report)||report.schema!==STATUS_WINDOW_SCHEMA||!SHA.test(report.id??'')||!SHA.test(report.resultSha256??''))
    throw fault('STATUS_REPORT','Select the complete calculated report with its source and result identities.',422);
  const {resultSha256,...body}=report;if(hashObject(body)!==resultSha256)
    throw fault('STATUS_REPORT_CHANGED','The calculated report changed after its result identity was retained.',409);
  return report;
}
export function compareStatusWindows(first,second){
  verifyReport(first);verifyReport(second);
  if(first.metadata.stream.id.key!==second.metadata.stream.id.key||
      stable(first.settings.window)!==stable(second.settings.window)||first.settings.firstUrl!==second.settings.firstUrl||
      stable(first.settings.definitions)!==stable(second.settings.definitions))
    throw fault('STATUS_COMPARISON_SCOPE','Compare the same stream, exact requested window and retained result definition.',409);
  const old=new Map(first.identityIndex.map(x=>[x.key,x])),current=new Map(second.identityIndex.map(x=>[x.key,x])),
    keys=[...new Set([...old.keys(),...current.keys()])].sort(lexical),changes=[];
  let same=0,occurrenceOnly=0;
  for(const key of keys){
    const a=old.get(key),b=current.get(key);
    if(!a||!b){changes.push({kind:a?'removed':'added',key,first:a??null,second:b??null});continue;}
    if(stable(a.recordSha256s)!==stable(b.recordSha256s)){changes.push({kind:'changed',key,first:a,second:b});continue;}
    same++;if(a.occurrences!==b.occurrences){occurrenceOnly++;changes.push({kind:'occurrence_count_changed',key,first:a,second:b});}
  }
  const metadata=['stream','observedProperty','sensor','thing','locations'].filter(kind=>first.metadata[kind]&&second.metadata[kind]).map(kind=>({kind,
    sameOriginalBody:first.metadata[kind].sourceRef.sha256===second.metadata[kind].sourceRef.sha256,
    first:first.metadata[kind].sourceRef,second:second.metadata[kind].sourceRef}));
  const pageBodies={samePageCount:first.pages.length===second.pages.length,
    sameOrderedBodyHashes:stable(first.pages.map(p=>p.sourceRef.sha256))===stable(second.pages.map(p=>p.sourceRef.sha256)),
    first:first.pages.map(p=>p.sourceRef),second:second.pages.map(p=>p.sourceRef)};
  const body={schema:STATUS_COMPARISON_SCHEMA,firstReportId:first.id,secondReportId:second.id,
    stream:first.metadata.stream.id,window:first.settings.window,unchangedRecordIds:same,
    added:changes.filter(c=>c.kind==='added').length,removed:changes.filter(c=>c.kind==='removed').length,
    changed:changes.filter(c=>c.kind==='changed').length,occurrenceCountChanges:occurrenceOnly,changes,metadata,pageBodies,
    firstAcquisition:first.acquisition,secondAcquisition:second.acquisition,metadataBrackets:{first:first.metadataBracket,second:second.metadataBracket},
    interpretation:'This compares two actual sequential retained editions of the same query. It does not certify an atomic snapshot or unobserved state continuity.'};
  return {...body,id:hashObject(body)};
}
function csvCell(value){
  const s=value===null||value===undefined?'':typeof value==='string'?value:JSON.stringify(value);
  // Quotes preserve structure; formula-like user/source strings are deliberately prefixed.
  const safe=/^[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';
}
const csv=(columns,rows)=>columns.map(csvCell).join(',')+'\r\n'+rows.map(row=>columns.map(c=>csvCell(row[c])).join(',')).join('\r\n')+'\r\n';
export function statusWindowTables(report){
  verifyReport(report);
  return {
    'status-history.csv':csv(['occurrence','id_type','id_literal','phenomenon_time_original','phenomenon_time_utc','result_state','result_type','result_literal','result_time_original','valid_time_state','valid_time_literal','quality_state','quality_literal','disposition','issues','source_file','source_sha256','source_pointer'],
      report.history.map(r=>({occurrence:r.occurrence,id_type:r.id.type??r.id.source?.type,id_literal:r.id.value??r.id.source?.value,
        phenomenon_time_original:r.phenomenonTime.source.value,phenomenon_time_utc:r.phenomenonTime.utc,
        result_state:r.result.state,result_type:r.result.type,result_literal:r.result.value,result_time_original:r.resultTime.source.value,
        valid_time_state:r.validTime.state,valid_time_literal:r.validTime.value,quality_state:r.resultQuality.state,quality_literal:r.resultQuality.value,
        disposition:r.analyticalDisposition,issues:r.issues,source_file:r.sourceRef.filename,source_sha256:r.sourceRef.sha256,source_pointer:r.sourceRef.pointer}))),
    'observed-status-pairs.csv':csv(['index','from_utc','to_utc','from_code','to_code','elapsed_seconds_between_observations','pair_status','observed_code_changed','actual_change_time','intermediate_states','from_source_refs','to_source_refs'],
      report.adjacentPairs.map(p=>({index:p.index,from_utc:p.fromUtc,to_utc:p.toUtc,from_code:p.fromCode,to_code:p.toCode,
        elapsed_seconds_between_observations:p.elapsedSeconds,pair_status:p.status,observed_code_changed:p.observedCodeChanged,
        actual_change_time:p.actualChangeTime,intermediate_states:p.intermediateStates,from_source_refs:p.fromSourceRefs,to_source_refs:p.toSourceRefs}))),
    'daily-observation-counts.csv':csv(['date_utc','selected_window_seconds','events','code_counts','first_observation','last_observation','state_duration_seconds','continuous_state_coverage'],
      report.daily.map(d=>({date_utc:d.dateUtc,selected_window_seconds:d.selectedWindowSeconds,events:d.events,code_counts:d.codeCounts,
        first_observation:d.firstObservation,last_observation:d.lastObservation,state_duration_seconds:d.stateDurationSeconds,continuous_state_coverage:d.continuousStateCoverage}))),
    'observation-gaps.csv':csv(['kind','start_utc','end_utc','elapsed_seconds','state_during_interval','left_source_refs','right_source_refs'],
      report.gaps.map(g=>({kind:g.kind,start_utc:g.startUtc,end_utc:g.endUtc,elapsed_seconds:g.elapsedSeconds,state_during_interval:g.stateDuringInterval,
        left_source_refs:g.leftObservation?.sourceRefs??null,right_source_refs:g.rightObservation?.sourceRefs??null}))),
    'status-transition-counts.csv':csv(['from','to','adjacent_observed_pairs','changed','elapsed_seconds_assigned_to_either_status'],
      report.transitionSummary.map(t=>({from:t.from,to:t.to,adjacent_observed_pairs:t.adjacentObservedPairs,changed:t.changed,
        elapsed_seconds_assigned_to_either_status:t.elapsedSecondsAssignedToEitherStatus})))
  };
}

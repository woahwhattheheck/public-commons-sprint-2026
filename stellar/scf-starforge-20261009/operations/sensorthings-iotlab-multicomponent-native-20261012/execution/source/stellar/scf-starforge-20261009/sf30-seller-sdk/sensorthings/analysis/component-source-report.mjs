// MIT. Read-only analysis of complete original connector files.
// This uses the maintained SensorThings decoder/domain and component model.
// It creates no native workspace, capture, source review, edition or export.
import {sourceDocument,sha,identity,entityId,selectedStream,sourceConfig,fields,plain,instant,stable,integer} from '../contract.mjs';
import {graphIndex,observationRows} from '../domain.mjs';
import {bindComponentMetadata,normalizeComponentSelection,validateComponentChoice,projectComponentRow,componentNumericEligibility,componentExactEligibility,
  createComponentStatistics,accumulateComponentStatistics,finishComponentStatistics,componentCSVHeader,componentCSVRow,COMPONENT_MEANING} from './components.mjs';

const fail=(code,message,details={})=>Object.assign(new Error(message),{code:'SENSORTHINGS_COMPONENT_SOURCE_'+code,details});
function safePath(path){if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'))throw fail('PATH','Use a declared relative original source path.');return path;}
function bodyOf(result){
  if(result?.isError||!Array.isArray(result?.content))throw fail('CONNECTOR_RECEIPT','The original connector response is not a completed successful response.');
  const blocks=result.content.filter(x=>x.type==='text');if(blocks.length!==1)throw fail('CONNECTOR_RECEIPT','The complete original connector response must have its declared text body.');
  return JSON.parse(blocks[0].text);
}
function originalCount(value){
  if(value===undefined)return null;
  let id;try{id=entityId(value);}catch{return {lexeme:JSON.stringify(value),valid:false};}
  if(id.type!=='number'||!Number.isSafeInteger(Number(id.value))||Number(id.value)<0)return {lexeme:id.value,valid:false};
  return {lexeme:id.value,valid:true,value:Number(id.value)};
}
export async function analyseComponentOriginals({manifestBytes,expectedSha256,expectedBytes,readFile,plan,calculatedAt}){
  if(typeof readFile!=='function'||sha(manifestBytes)!==expectedSha256||manifestBytes.length!==expectedBytes)
    throw fail('MANIFEST','The complete original manifest differs from its selected identity.');
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
  if(manifest.schema!=='stellar-forge.sensorthings-multicomponent-originals.v1'||!Array.isArray(manifest.sources)||!Array.isArray(manifest.files))
    throw fail('MANIFEST','Use the complete original MultiDatastream source package.');
  if(!plain(plan)||plan.schema!=='stellar-forge.sensorthings-component-original-plan.v1'||typeof plan.actor!=='string'||!plan.actor.trim()||
    typeof calculatedAt!=='string'||!instant(calculatedAt).utc)throw fail('PLAN','Retain the named source-analysis plan and actual calculation time.');
  fields(plan,['schema','actor','source','window','roles','components','sourceFindings'],['schema','actor','source','window','roles','components']);
  fields(plan.window,['start','endExclusive'],['start','endExclusive']);
  if(!instant(plan.window.start).utc||!instant(plan.window.endExclusive).utc||instant(plan.window.start).utc>=instant(plan.window.endExclusive).utc)
    throw fail('PLAN','Use an increasing explicit UTC/offset-qualified source window.');
  const normalizedSource=sourceConfig(plan.source);
  if(normalizedSource.serviceUrl!==manifest.sourceSelection?.serviceUrl||plan.window.start!==manifest.sourceSelection.start||
     plan.window.endExclusive!==manifest.sourceSelection.endExclusive||manifest.sourceSelection.kind!=='MultiDatastreams')
    throw fail('PLAN','The report selection differs from the original retained service/window.');
  const files=new Map(),manifestPaths=new Set(),sourceObjects=new Map();
  for(const record of manifest.files){
    safePath(record.path);if(manifestPaths.has(record.path))throw fail('MANIFEST','A source member is declared more than once.');manifestPaths.add(record.path);
    const bytes=await readFile(record.path);
    if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)throw fail('SOURCE_IDENTITY','A complete original source member differs from its manifest.',{path:record.path});
    files.set(record.path,bytes);
  }
  const roleMap=new Map();
  for(const original of manifest.sources){
    if(roleMap.has(original.role))throw fail('SOURCE_IDENTITY','An original acquisition role is repeated.');
    const bytes=files.get(original.body.path),receiptBytes=files.get(original.receipt.path);
    if(!bytes||!receiptBytes||bytes.length!==original.body.bytes||sha(bytes)!==original.body.sha256||
       receiptBytes.length!==original.receipt.bytes||sha(receiptBytes)!==original.receipt.sha256)
      throw fail('SOURCE_IDENTITY','The source index differs from the complete member manifest.');
    const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receiptBytes)),
      uploaded=bodyOf(receipt.uploadToolResponse),downloaded=bodyOf(receipt.downloadToolResponse);
    if(receipt.schema!=='stellar-forge.sensorthings-connector-acquisition.v1'||receipt.role!==original.role||receipt.sourceUrl!==original.sourceUrl||
      receipt.originalBody.sha256!==original.body.sha256||receipt.originalBody.bytes!==original.body.bytes||
      uploaded.status!=='uploaded'||uploaded.file_upload_id!==downloaded.file_upload_id||
      uploaded.content_length!==bytes.length||downloaded.content_length!==bytes.length||
      typeof downloaded.content!=='string'||sha(Buffer.from(downloaded.content,'utf8'))!==original.body.sha256||
      new TextDecoder('utf-8',{fatal:true}).decode(bytes)!==downloaded.content)
      throw fail('CONNECTOR_IDENTITY','The complete upload/download evidence does not bind this exact original body.',{role:original.role});
    if(receipt.originalHttp.method!==null||receipt.originalHttp.status!==null||receipt.originalHttp.headers!==null)
      throw fail('CONNECTOR_PROVENANCE','The connector did not expose original HTTP metadata.');
    roleMap.set(original.role,{...original,receipt,document:sourceDocument(bytes)});
    sourceObjects.set(original.body.sha256,bytes);
  }
  const roles=plan.roles;
  fields(roles,['opening','properties','thing','sensor','locations','closing','observations'],['opening','properties','thing','sensor','locations','closing','observations']);
  if(!plain(roles)||!Array.isArray(roles.observations)||!roles.observations.length||new Set(roles.observations).size!==roles.observations.length)
    throw fail('PLAN','Select every original observation page in its exact continuation order.');
  for(const key of ['opening','properties','thing','sensor','locations','closing'])if(typeof roles[key]!=='string'||!roleMap.has(roles[key]))
    throw fail('PLAN','Select the complete original metadata relation: '+key);
  for(const role of roles.observations)if(!roleMap.has(role))throw fail('PLAN','An original observation page is unavailable.');
  const opening=roleMap.get(roles.opening),closing=roleMap.get(roles.closing),record=opening.document,
    selected=selectedStream(record,'MultiDatastreams',normalizedSource, {sha256:opening.body.sha256,bytes:opening.body.bytes,
      jsonPointer:'',url:opening.sourceUrl,capturedAt:opening.completedAt,requestId:opening.role}),
    sourceIdentity={kind:'received-originals',manifestSha256:expectedSha256},
    sourceScope={serviceUrl:normalizedSource.serviceUrl,kind:'MultiDatastreams',id:selected.id,window:plan.window,
      sourceOperationId:manifest.operationId,representation:'complete-original-connector-files',nativeEditionId:null},
    pages=[];
  const add=(role,kind,phase)=>{const s=roleMap.get(role);pages.push({kind,phase,collection:Array.isArray(s.document.value),streamKey:selected.key,
    taskId:'original-file:'+role,url:s.sourceUrl,receipt:{requestId:role,sha256:s.body.sha256,bytes:s.body.bytes,
      completedAt:s.completedAt,sourceCapturedAt:s.completedAt,originalHttp:{method:null,status:null,headers:null}}});};
  add(roles.opening,'MultiDatastreams','stream-start');
  add(roles.properties,'ObservedProperties','metadata');add(roles.thing,'Things','metadata');add(roles.sensor,'Sensors','metadata');
  add(roles.locations,'Locations','metadata');
  for(const role of roles.observations)add(role,'Observations','observations');
  add(roles.closing,'MultiDatastreams','stream-end');
  // This read-only view adapts existing domain functions to actual retained
  // originals. It is deliberately not saved or identified as a native edition.
  const view={schema:'stellar-forge.sensorthings-original-file-view.v1',source:normalizedSource,scope:sourceScope,issues:[],
    plan:{streams:[selected]},pages},reader={object:async digest=>{const b=sourceObjects.get(digest);if(!b)throw fail('SOURCE_IDENTITY','A requested original body is not in this manifest.');return b;}},
    graph=await graphIndex(reader,view),item=graph.streams.get(selected.key),
    descriptor=bindComponentMetadata({sourceIdentity,streamKey:selected.key,streamId:selected.id,streamRecord:record,streamSourceRef:item.sourceRef,
      observedProperties:graph.relation(item,'ObservedProperties')});
  if(!Array.isArray(plan.components)||!plan.components.length)throw fail('PLAN','Choose explicit original component positions and interpretations.');
  const choices=plan.components.map(c=>{
    fields(c,['index','interpretation'],['index','interpretation']);integer(c.index,'component index',0,4095);const d=descriptor.components.find(x=>x.index===c.index);
    if(!d)throw fail('PLAN','The selected position has no retained source metadata.');
    return {streamKey:selected.key,index:c.index,bindingId:d.bindingId,interpretation:c.interpretation};
  });
  const selection=normalizeComponentSelection({streamKeys:[selected.key],componentSelections:choices,
    period:{start:plan.window.start,end:plan.window.endExclusive},view:'numeric'},view);
  const bound=selection.componentSelections.map(choice=>({choice,descriptor:validateComponentChoice(choice,descriptor.components.find(x=>x.index===choice.index)),stream:descriptor}));
  const counts=[],chain=[],findings=[];let observedRows=0;
  for(let i=0;i<roles.observations.length;i++){
    const s=roleMap.get(roles.observations[i]),doc=s.document;
    if(!plain(doc)||!Array.isArray(doc.value))throw fail('PAGE','The original observation response is not an entity collection.');
    if(i===0&&s.sourceUrl!==manifest.sourceSelection.firstUrl)throw fail('PAGE','The first retained request differs from the original source selection.');
    const next=doc['@iot.nextLink']??null;
    if(i+1<roles.observations.length&&next!==roleMap.get(roles.observations[i+1]).sourceUrl)throw fail('PAGE','The original opaque nextLink does not match the following retained request.');
    if(i===roles.observations.length-1&&next!==null)throw fail('PAGE','The selected original window still has an unreceived continuation.');
    observedRows+=doc.value.length;counts.push({role:s.role,count:originalCount(doc['@iot.count'])});
    chain.push({role:s.role,url:s.sourceUrl,body:s.body,rows:doc.value.length,nextLink:next,receivedAt:s.completedAt});
  }
  const reported=new Set(counts.filter(x=>x.count?.valid).map(x=>x.count.value));
  if(reported.size>1)findings.push({code:'SOURCE_COUNT_CHANGED_DURING_TRAVERSAL',counts});
  if(reported.size===1&&[...reported][0]!==observedRows)findings.push({code:'SOURCE_COUNT_DIFFERS_FROM_RETAINED_ROWS',reported:[...reported][0],observedRows});
  const statistics=new Map(bound.map(b=>[b.descriptor.seriesKey,createComponentStatistics()])),observations=new Map(),sourceTimes=new Map(),
    csv=[componentCSVHeader()],plotRows=new Map(bound.map(b=>[b.descriptor.seriesKey,[]]));
  let sourceRows=0,componentRows=0,outsideWindow=0,unplaced=0;
  for await(const value of observationRows(reader,view,{graph})){
    sourceRows++;
    if(value.original.key){const a=observations.get(value.original.key)??[];a.push(value.original.semanticHash);observations.set(value.original.key,a);}
    const r=value.row,t=r.phenomenon_start_utc,e=r.phenomenon_end_utc,period=selection.period;
    const placed=!!t&&['explicit_instant','explicit_interval'].includes(r.phenomenon_time_kind);
    if(!placed)unplaced++;
    if(placed&&(r.phenomenon_time_kind==='explicit_interval'?!(t<period.endUtc&&e>period.startUtc):!(t>=period.startUtc&&t<period.endUtc))){outsideWindow++;continue;}
    if(r.phenomenon_time_kind==='explicit_instant'){
      const events=sourceTimes.get(t)??[];
      events.push({observationId:r.observation_id,observationIdType:r.observation_id_type,occurrenceId:r.occurrence_id,
        phenomenonTime:r.phenomenon_time,sourceResult:r.result,sourceResultState:r.result_state,sourceResultType:r.result_type,
        resultQuality:r.result_quality,resultQualityState:r.result_quality_state,sourceRef:value.original.sourceRef});
      sourceTimes.set(t,events);
    }
    for(const b of bound){
      const projected=projectComponentRow(value,b);componentRows++;
      accumulateComponentStatistics(statistics.get(b.descriptor.seriesKey),projected);
      csv.push(componentCSVRow(projected));
      plotRows.get(b.descriptor.seriesKey).push({time:projected.row.phenomenon_start_utc,timeKind:projected.row.phenomenon_time_kind,
        timeLiteral:projected.row.phenomenon_time,timeState:projected.row.phenomenon_time_state,endTime:projected.row.phenomenon_end_utc,
        resultTime:projected.row.result_time,resultTimeState:projected.row.result_time_state,
        validTime:projected.row.valid_time,validTimeState:projected.row.valid_time_state,
        quality:projected.row.result_quality,qualityState:projected.row.result_quality_state,
        sourceResult:projected.row.source_result,sourceResultState:projected.row.source_result_state,sourceResultType:projected.row.source_result_type,
        value:projected.row.result,state:projected.row.result_state,type:projected.row.result_type,numericEligibility:componentNumericEligibility(projected.row),exactNumericEligibility:componentExactEligibility(projected.row),
        aligned:projected.row.component_alignment,sourceRef:projected.original.componentSourceRef,
        observationId:projected.row.observation_id,observationIdType:projected.row.observation_id_type,
        componentIndex:b.choice.index,occurrenceId:projected.row.component_occurrence_id});
    }
  }
  if(sourceRows!==observedRows)throw fail('ROWS','The original domain did not retain every observation entity.');
  if(outsideWindow)findings.push({code:'ORIGINAL_ROWS_OUTSIDE_REQUESTED_WINDOW',count:outsideWindow,meaning:'Retained in original files; excluded from selected-window summaries.'});
  if(unplaced)findings.push({code:'ORIGINAL_ROWS_WITH_UNPLACED_TIME',count:unplaced,meaning:'Retained as unplaced; excluded from instant-based numeric summaries.'});
  const streams=bound.map(b=>({sourceStreamKey:selected.key,seriesKey:b.descriptor.seriesKey,index:b.choice.index,name:b.descriptor.name,
    bindingId:b.descriptor.bindingId,meaningId:b.descriptor.meaningId,unit:b.descriptor.unit,property:b.descriptor.property,
    declaredType:b.descriptor.declaredType,interpretation:b.choice.interpretation,
    statistics:finishComponentStatistics(statistics.get(b.descriptor.seriesKey)),plot:plotRows.get(b.descriptor.seriesKey)}));
  const orderedTimes=[...sourceTimes.keys()].sort(),gaps=[],duplicateInstants=[];
  const ns=value=>{const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.(\d{9})Z$/.exec(value);if(!m)throw fail('TIME','The original normalized instant is outside the exact report time representation.');
    return BigInt(Date.parse(m[1]+'Z'))*1000000n+BigInt(m[2]);};
  for(const time of orderedTimes){const events=sourceTimes.get(time);if(events.length>1)duplicateInstants.push({time,events});}
  for(let i=1;i<orderedTimes.length;i++){
    const from=orderedTimes[i-1],to=orderedTimes[i],difference=ns(to)-ns(from),whole=difference/1000000000n,fraction=String(difference%1000000000n).padStart(9,'0').replace(/0+$/,'');
    gaps.push({from,to,seconds:String(whole)+(fraction?'.'+fraction:''),fromEvents:sourceTimes.get(from),toEvents:sourceTimes.get(to)});
  }
  const maximumGap=gaps.reduce((a,b)=>a===null||Number(b.seconds)>Number(a.seconds)?b:a,null);
  const timeAudit={distinctInstants:orderedTimes.length,duplicateInstants,adjacentGaps:gaps,
    maximumGapSeconds:maximumGap?.seconds??null,maximumGaps:maximumGap?gaps.filter(g=>g.seconds===maximumGap.seconds):[],
    meaning:'All original IDs and vectors remain distinct source occurrences. Duplicate times and observed separations are not repaired or imputed. Publisher cadence does not establish coverage or correctness.'};
  const report={schema:'stellar-forge.sensorthings-component-source-report.v1',sourceIdentity,sourceOperationId:manifest.operationId,
    actor:plan.actor,calculatedAt,execution:'pure read-only original-file analysis',native:{workspaceId:null,captureId:null,editionId:null,exportId:null},
    sourceManifest:{filename:'source-manifest.json',bytes:manifestBytes.length,sha256:expectedSha256},
    sourceScope,sourcePlan:plan,selection,descriptor,sourceRows,selectedComponentRows:componentRows,distinctObservationKeys:observations.size,
    duplicateObservationKeys:[...observations.values()].filter(x=>x.length>1).length,
    changedDuplicateKeys:[...observations.values()].filter(x=>new Set(x).size>1).length,
    paging:{pages:chain,reportedCounts:counts,completeRetainedContinuation:true},
    metadataBracket:{opening:{url:opening.sourceUrl,body:opening.body,receivedAt:opening.completedAt},
      closing:{url:closing.sourceUrl,body:closing.body,receivedAt:closing.completedAt},
      exactStreamBytesEqual:opening.body.sha256===closing.body.sha256,atomicProviderSnapshot:'not_established'},
    sourceFindings:plan.sourceFindings??[],findings,timeAudit,streams,
    originalClosure:{files:manifest.files,failedSourceAttempts:manifest.failedSourceAttempts},
    license:plan.source.license,meaning:COMPONENT_MEANING};
  return {report,csv:csv.join('')};
}

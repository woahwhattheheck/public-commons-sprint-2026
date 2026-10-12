// MIT. Staff-selected correspondence over complete original KiWIS and native receiving records.
import {canonical,digest,fail,same,projectCapture,explicitInstant} from './source.mjs';
export const DECISIONS_SCHEMA='starforge.kiwis-commissioning-decisions.v1';
export const REVIEW_SCHEMA='starforge.kiwis-commissioning-review.v1';
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const string=(v,label)=>{if(typeof v!=='string'||!v.trim())fail('KIWIS_DECISION','Provide '+label+'.');return v;};
export function pointer(value,path){
  if(path==='')return value;
  if(typeof path!=='string'||!path.startsWith('/'))fail('KIWIS_FIELD','Select an exact source field path.');
  for(const token of path.slice(1).split('/')){
    const key=token.replace(/~1/g,'/').replace(/~0/g,'~');
    if(value===null||typeof value!=='object'||!own(value,key))return undefined;
    value=value[key];
  }
  return value;
}
export function fieldPaths(value,prefix=''){
  if(value===null||typeof value!=='object')return [prefix];
  const result=[];
  for(const [key,item]of Object.entries(value)){
    const path=prefix+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1');
    if(item===null||typeof item!=='object')result.push(path);
    else result.push(...fieldPaths(item,path));
  }
  return result;
}
export const instant=explicitInstant;
function timestampProfile(input){
  if(!input||typeof input!=='object')fail('KIWIS_TIME_MAPPING','Select the exact source timestamp or its original date, time and UTC offset fields.');
  const validPath=value=>typeof value==='string'&&value.startsWith('/');
  if(validPath(input.path)&&Object.keys(input).length===1)return {path:input.path};
  if(!validPath(input.datePath)||!validPath(input.timePath)||Boolean(input.offsetPath)===Boolean(input.offset)||
    Object.keys(input).some(k=>!['datePath','timePath','offsetPath','offset'].includes(k))||
    input.offsetPath&&!validPath(input.offsetPath)||input.offset&&!/^(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(input.offset))
    fail('KIWIS_TIME_MAPPING','Select original date/time fields and one explicit UTC offset or original offset field.');
  return {datePath:input.datePath,timePath:input.timePath,...(input.offsetPath?{offsetPath:input.offsetPath}:{offset:input.offset})};
}
function sourceTime(target,profile,times){
  const specification=profile.timestamp,path=specification.path??specification.datePath;
  const override=times.get(canonical([target.recordId,path]));
  if(specification.path){const original=pointer(target.fields,path);
    return {path,original,selected:override?.instant??original,interpretation:override??null};}
  const original={date:pointer(target.fields,specification.datePath),time:pointer(target.fields,specification.timePath),
    offset:specification.offsetPath?pointer(target.fields,specification.offsetPath):specification.offset};
  const combined=typeof original.date==='string'&&/^\d{4}-\d\d-\d\d$/.test(original.date)&&
    typeof original.time==='string'&&/^\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(original.time)&&
    typeof original.offset==='string'&&/^(?:Z|[+-]\d\d:\d\d)$/.test(original.offset)
    ?original.date+'T'+original.time+original.offset:null;
  return {path,original,selected:override?.instant??combined,
    interpretation:override??{kind:'staff-selected-source-composition',...specification,reason:profile.reason}};
}
export function commissioningSource({capture,counterpart}){
  const kiwis=projectCapture(capture);
  if(!counterpart||!['wqx-review','wqx-scientific','lab-edd-result','kiwis-wqm'].includes(counterpart.kind)||
    !/^[0-9a-f]{64}$/.test(counterpart.sourceSha256??'')||!Array.isArray(counterpart.records))
    fail('KIWIS_COUNTERPART','Receive the complete original WQX, Laboratory or KiWIS water-quality counterpart.');
  const ids=new Set();
  for(const record of counterpart.records){
    if(typeof record.recordId!=='string'||ids.has(record.recordId)||!record.fields||
      record.rowSha256!==digest(canonical(record.fields)))
      fail('KIWIS_COUNTERPART','Keep each original counterpart record and its complete field identity.');
    ids.add(record.recordId);
  }
  const binding={kiwisEditionSha256:kiwis.editionSha256,counterpart:{kind:counterpart.kind,sourceSha256:counterpart.sourceSha256}};
  return {schema:'starforge.kiwis-commissioning-source.v1',sourceSha256:digest(canonical(binding)),binding,kiwis,counterpart};
}
export function emptyDecisions(source){
  return {schema:DECISIONS_SCHEMA,sourceSha256:source.sourceSha256,profiles:[],times:[],correspondences:[],quality:[]};
}
function unique(values,key,label){const seen=new Set();for(const v of values){const k=key(v);if(seen.has(k))fail('KIWIS_DUPLICATE','Choose one '+label+' for each original identity.');seen.add(k);}return values;}
export function normalizeDecisions(source,input=emptyDecisions(source)){
  if(input?.schema!==DECISIONS_SCHEMA||input.sourceSha256!==source.sourceSha256)fail('KIWIS_SOURCE_CHANGED','Open the decision document against its original complete source edition.');
  if(Object.keys(input).some(key=>!['schema','sourceSha256','profiles','times','correspondences','quality'].includes(key)))fail('KIWIS_DECISION','Use the supported commissioning decision fields.');
  for(const name of ['profiles','times','correspondences','quality'])if(!Array.isArray(input[name]))fail('KIWIS_DECISION','Retain the complete '+name+' array.');
  const series=new Map(source.kiwis.series.map(s=>[s.seriesId,s])),targets=new Map(source.counterpart.records.map(r=>[r.recordId,r])),
    observations=new Map(source.kiwis.observations.map(r=>[r.recordId,r]));
  const profiles=unique(input.profiles.map(p=>{
    const selected=series.get(p.seriesId);
    if(!selected||p.seriesSha256!==digest(canonical(selected)))fail('KIWIS_SERIES_CHANGED','Select the complete original series metadata.');
    for(const label of ['station','parameter']){
      if(!p[label]||typeof p[label].path!=='string'||!p[label].path.startsWith('/')||
        typeof p[label].value!=='string')fail('KIWIS_MAPPING','Select the original counterpart '+label+' field and exact value.');
    }
    const timestamp=timestampProfile(p.timestamp);
    if(!Array.isArray(p.nativeKey)||!p.nativeKey.length||p.nativeKey.some(path=>typeof path!=='string'||!path.startsWith('/'))||
      new Set(p.nativeKey).size!==p.nativeKey.length)
      fail('KIWIS_MAPPING','Select the original timestamp field and complete native identity fields.');
    if(!Number.isSafeInteger(p.windowSeconds)||p.windowSeconds<0)fail('KIWIS_WINDOW','Select an exact nonnegative time correspondence window in seconds.');
    return {seriesId:p.seriesId,seriesSha256:p.seriesSha256,station:{path:p.station.path,value:p.station.value},
      parameter:{path:p.parameter.path,value:p.parameter.value},timestamp,
      nativeKey:[...p.nativeKey],windowSeconds:p.windowSeconds,reason:string(p.reason,'the mapping reason')};
  }),p=>p.seriesId,'profile');
  const times=unique(input.times.map(t=>{
    const row=targets.get(t.recordId);
    if(!row||row.rowSha256!==t.rowSha256||typeof t.path!=='string'||!t.path.startsWith('/')||!own(t,'before')||
      pointer(row.fields,t.path)===undefined||t.before!==null&&typeof t.before==='object'||
      !same(pointer(row.fields,t.path),t.before)||instant(t.instant)===null)
      fail('KIWIS_TIME_CHANGED','Bind the selected timezone interpretation to its exact original source field.');
    return {recordId:t.recordId,rowSha256:t.rowSha256,path:t.path,before:t.before,
      instant:t.instant,reason:string(t.reason,'the source time interpretation reason')};
  }),t=>canonical([t.recordId,t.path]),'source time decision');
  const correspondences=unique(input.correspondences.map(c=>{
    const target=targets.get(c.recordId),observation=c.observationId?observations.get(c.observationId):null;
    if(!target||target.rowSha256!==c.rowSha256||!['link','separate'].includes(c.action))
      fail('KIWIS_CORRESPONDENCE','Bind each correspondence to its exact original counterpart record.');
    if(c.action==='link'&&(!observation||observation.rowSha256!==c.observationSha256))fail('KIWIS_CORRESPONDENCE','Select an observation from the complete original series edition.');
    if(c.action==='separate'&&(c.observationId!==undefined||c.observationSha256!==undefined))
      fail('KIWIS_CORRESPONDENCE','A separate record has no selected sensor observation.');
    return {recordId:c.recordId,rowSha256:c.rowSha256,action:c.action,
      ...(c.action==='link'?{observationId:c.observationId,observationSha256:c.observationSha256}:{}),
      reason:string(c.reason,'the correspondence reason')};
  }),c=>c.recordId,'correspondence');
  const quality=unique(input.quality.map(q=>{
    if(!series.has(q.seriesId)||typeof q.code!=='string'||!['retain','exclude-from-correspondence'].includes(q.action))
      fail('KIWIS_QUALITY','Select the original series, quality code and correspondence disposition.');
    if(!source.kiwis.observations.some(row=>row.seriesId===q.seriesId&&row.quality===q.code))
      fail('KIWIS_QUALITY','The selected code is not present in this original series.');
    return {seriesId:q.seriesId,code:q.code,action:q.action,reason:string(q.reason,'the quality-code decision reason')};
  }),q=>canonical([q.seriesId,q.code]),'quality-code decision');
  const sort=(list,key)=>list.sort((a,b)=>canonical(key(a)).localeCompare(canonical(key(b)),'en'));
  return {schema:DECISIONS_SCHEMA,sourceSha256:source.sourceSha256,
    profiles:sort(profiles,p=>p.seriesId),times:sort(times,t=>[t.recordId,t.path]),
    correspondences:sort(correspondences,c=>c.recordId),quality:sort(quality,q=>[q.seriesId,q.code])};
}
function lowerBound(rows,n){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].time<n)lo=mid+1;else hi=mid;}return lo;}
export function previewCommissioning(source,input){
  const document=normalizeDecisions(source,input),indices=new Map(),times=new Map(document.times.map(t=>[canonical([t.recordId,t.path]),t])),
    choices=new Map(document.correspondences.map(c=>[c.recordId,c])),
    exclusions=new Set(document.quality.filter(q=>q.action==='exclude-from-correspondence').map(q=>canonical([q.seriesId,q.code])));
  const seriesStats=[];
  for(const series of source.kiwis.series){
    const selected=source.kiwis.observations.filter(o=>o.seriesId===series.seriesId),index=[];
    let unparseableTimes=0,excluded=0,blankValues=0;
    for(const row of selected){
      if(row.value===null||row.value==='')blankValues++;
      const time=instant(row.timestamp);if(time===null){unparseableTimes++;continue;}
      if(exclusions.has(canonical([row.seriesId,row.quality]))){excluded++;continue;}
      index.push({time,row});
    }
    index.sort((a,b)=>a.time-b.time||a.row.sourceIdentity.rowIndex-b.row.sourceIdentity.rowIndex);
    indices.set(series.seriesId,index);
    const timestamps=new Map();for(const row of selected)timestamps.set(row.timestamp,(timestamps.get(row.timestamp)??0)+1);
    seriesStats.push({seriesId:series.seriesId,tsId:series.tsId,observations:selected.length,blankValues,unparseableTimes,
      excludedFromCorrespondence:excluded,coverage:series.coverage??[],
      emptyWindows:(series.coverage??[]).filter(item=>item.status==='EMPTY_TABLE').length,
      absentTableWindows:(series.coverage??[]).filter(item=>item.status==='NO_TABLE').length,duplicateTimestamps:[...timestamps].filter(([,n])=>n>1).map(([timestamp,count])=>({timestamp,count}))});
  }
  const records=[],counts={counterpartRecords:source.counterpart.records.length,observations:source.kiwis.observations.length,
    linked:0,separate:0,unresolved:0,reviewRequired:0,ambiguous:0,withoutCandidates:0};
  for(const target of source.counterpart.records){
    const candidates=[],timeChoices=[],mappedProfiles=[];
    for(const profile of document.profiles){
      if(pointer(target.fields,profile.station.path)!==profile.station.value||
        pointer(target.fields,profile.parameter.path)!==profile.parameter.value)continue;
      mappedProfiles.push(profile.seriesId);
      const selectedTime=sourceTime(target,profile,times),time=instant(selectedTime.selected);
      timeChoices.push({seriesId:profile.seriesId,...selectedTime,usableForCorrespondence:time!==null});
      if(time===null)continue;
      const index=indices.get(profile.seriesId),range=profile.windowSeconds*1000;
      if(!Number.isSafeInteger(range))fail('KIWIS_WINDOW','The selected correspondence window exceeds exact millisecond arithmetic.');
      for(let i=lowerBound(index,time-range);i<index.length&&index[i].time<=time+range;i++){
        const item=index[i];candidates.push({observationId:item.row.recordId,observationSha256:item.row.rowSha256,
          seriesId:item.row.seriesId,tsId:item.row.tsId,timestamp:item.row.timestamp,value:item.row.value,quality:item.row.quality,
          differenceSeconds:(item.time-time)/1000});
      }
    }
    const choice=choices.get(target.recordId)??null;
    const reviewRequired=choice?.action==='link'&&!candidates.some(c=>c.observationId===choice.observationId&&c.observationSha256===choice.observationSha256);
    const status=reviewRequired?'REVIEW_REQUIRED':choice?.action==='link'?'LINKED':choice?.action==='separate'?'SEPARATE':'UNRESOLVED';
    counts[reviewRequired?'reviewRequired':status.toLowerCase()]++;
    if(candidates.length>1)counts.ambiguous++;
    if(!candidates.length)counts.withoutCandidates++;
    records.push({recordId:target.recordId,rowSha256:target.rowSha256,status,mappedProfiles,timeChoices,candidates,choice,
      ...(reviewRequired?{reviewReason:'The prior selection is outside the current station, parameter, quality or time correspondence.'}:{})});
  }
  const body={schema:REVIEW_SCHEMA,source:source.binding,sourceSha256:source.sourceSha256,document,
    documentSha256:digest(canonical(document)),counts,series:seriesStats,records};
  return {...body,reviewSha256:digest(canonical(body))};
}
function group(items,key){
  const map=new Map();
  for(const item of items){const k=key(item);if(k===null)continue;const s=canonical(k);if(!map.has(s))map.set(s,[]);map.get(s).push(item);}
  return map;
}
function providerMetadata(series){
  // A window is our request bookkeeping. Every distinct provider metadata
  // object stays exact; repeating that object for another window is not a
  // provider metadata change. Missing tables have coverage, not invented metadata.
  const returned=[...new Set(series.returned.filter(item=>item.metadata!==null&&item.metadata!==undefined)
    .map(item=>canonical(item.metadata)))].sort().map(value=>JSON.parse(value));
  return {catalogue:series.metadata,returned};
}
function seriesKey(source,series){return [source.kiwis.selection.endpoint,source.kiwis.selection.datasource,series.tsId,series.tableIndex];}
function recordContext(source,row){
  const context={fieldTypes:row.original?.fieldTypes??null,scalarTypes:row.original?.scalarTypes??null};
  if(source.counterpart.kind==='lab-edd-result'){
    // Equal strings do not identify an Excel date/formula interpretation.
    context.laboratory={profile:source.counterpart.profile??null,section:row.original?.section??null,cells:row.original?.cells??null};
  }
  return context;
}
function recordChanges(current,previous,before,after){
  const reasons=[];
  if(before.rowSha256!==after.rowSha256)reasons.push('The complete original counterpart field values changed.');
  const a=recordContext(previous,before),b=recordContext(current,after);
  if(!same(a.fieldTypes,b.fieldTypes)||!same(a.scalarTypes,b.scalarTypes))
    reasons.push('The original JSON scalar or field types changed.');
  if(!same(a.laboratory??null,b.laboratory??null))
    reasons.push('The original laboratory profile, section or physical cell interpretation changed.');
  return reasons;
}
function observationChanges(before,after){
  const reasons=[];
  if(before.rowSha256!==after.rowSha256)reasons.push('The complete original observation fields changed.');
  if(!same(before.originalTypes??null,after.originalTypes??null)||!same(before.fieldTypes??null,after.fieldTypes??null))
    reasons.push('The original observation JSON scalar or field types changed.');
  return reasons;
}
export function compareCommissioningSources(current,previous,previousDocument){
  if(current.counterpart.kind!==previous.counterpart.kind)
    fail('KIWIS_EDITION_FAMILY','Compare source editions within the same native counterpart family.');
  const document=normalizeDecisions(previous,previousDocument),proposed=emptyDecisions(current),retained=[],changes=[];
  const beforeGroups=group(previous.kiwis.series,s=>seriesKey(previous,s)),afterGroups=group(current.kiwis.series,s=>seriesKey(current,s));
  const seriesMatches=new Map();
  const sameQuality=same(current.kiwis.qualityCodes,previous.kiwis.qualityCodes)&&
    same(current.kiwis.releaseStateClasses,previous.kiwis.releaseStateClasses);
  const sameProfile=same(previous.counterpart.profile??null,current.counterpart.profile??null);
  for(const key of new Set([...beforeGroups.keys(),...afterGroups.keys()])){
    const before=beforeGroups.get(key)??[],after=afterGroups.get(key)??[];
    let status,reason,metadataChanged=false,coverageChanged=false;
    if(before.length>1||after.length>1){status='AMBIGUOUS';reason='The complete selected series identity occurs more than once.';}
    else if(!before.length){status='ADDED';reason='This selected original series was added to the current programme.';}
    else if(!after.length){status='REMOVED';reason='This selected original series is absent from the current programme.';}
    else{
      const a=providerMetadata(before[0]),b=providerMetadata(after[0]),reasons=[];
      if(!same(a.catalogue,b.catalogue))reasons.push('The complete original provider catalogue metadata changed.');
      if(!same(a.returned,b.returned))reasons.push('The distinct returned provider metadata changed or is no longer available.');
      metadataChanged=Boolean(reasons.length);
      coverageChanged=!same(before[0].selected,after[0].selected)||!same(before[0].coverage??before[0].returned,after[0].coverage??after[0].returned);
      status=metadataChanged?'CHANGED':'UNCHANGED';
      reason=reasons.join(' ')||'The complete provider metadata is unchanged; request windows and response coverage remain separately visible.';
    }
    const row={kind:'series',key:JSON.parse(key),status,reason,metadataChanged,coverageChanged,
      beforeIds:before.map(item=>item.seriesId),afterIds:after.map(item=>item.seriesId)};
    changes.push(row);
    for(const item of before)seriesMatches.set(item.seriesId,{...row,before:item,candidate:after.length===1?after[0]:null});
  }
  for(const profile of document.profiles){
    const match=seriesMatches.get(profile.seriesId),unchanged=match?.status==='UNCHANGED'&&sameProfile;
    if(unchanged)proposed.profiles.push({...profile,seriesId:match.candidate.seriesId,seriesSha256:digest(canonical(match.candidate))});
    const record={kind:'profile',seriesId:profile.seriesId,status:!sameProfile?'CHANGED':match?.status??'REMOVED',
      retained:Boolean(unchanged),reason:!sameProfile?'The native counterpart profile changed; review its field mapping.':
        match?.reason??'The originally selected series is absent.',original:profile,
      ...(match?.candidate?{candidate:match.candidate.seriesId}:{})};
    retained.push(record);
  }

  const observationKey=(source,row)=>[source.kiwis.selection.endpoint,source.kiwis.selection.datasource,row.tsId,row.timestamp];
  const oldObs=group(previous.kiwis.observations,row=>observationKey(previous,row));
  const newObs=group(current.kiwis.observations,row=>observationKey(current,row));
  const beforeObservations=new Map(previous.kiwis.observations.map(row=>[row.recordId,row]));
  for(const key of new Set([...oldObs.keys(),...newObs.keys()])){
    const before=oldObs.get(key)??[],after=newObs.get(key)??[];
    const status=before.length>1||after.length>1?'AMBIGUOUS':!before.length?'ADDED':!after.length?'REMOVED':
      observationChanges(before[0],after[0]).length?'CHANGED':'UNCHANGED';
    const reason=status==='AMBIGUOUS'?'Every duplicate physical observation remains distinct; no one-to-one observation is inferred.':
      status==='ADDED'?'This original observation key appears only in the current source.':
      status==='REMOVED'?'This original observation key is absent from the current source.':
      status==='CHANGED'?observationChanges(before[0],after[0]).join(' '):'The unique original observation and every field are unchanged.';
    changes.push({kind:'observation',key:JSON.parse(key),status,reason,
      beforeIds:before.map(row=>row.recordId),afterIds:after.map(row=>row.recordId)});
  }

  const afterTargets=new Map(current.counterpart.records.map(row=>[row.recordId,row]));
  const evidence=new Map(),coveredBefore=new Set(),coveredAfter=new Set();
  function note(recordId,value){if(!evidence.has(recordId))evidence.set(recordId,[]);evidence.get(recordId).push(value);}
  function counterpartChange(profile,key,before,after,status,reason){
    const row={kind:'counterpart',...(profile?{seriesId:profile.seriesId}:{}),key,status,reason,
      beforeIds:before.map(item=>item.recordId),afterIds:after.map(item=>item.recordId)};
    changes.push(row);
    for(const item of before){coveredBefore.add(item.recordId);note(item.recordId,row);}
    for(const item of after)coveredAfter.add(item.recordId);
  }
  for(const profile of document.profiles){
    const matches=row=>pointer(row.fields,profile.station.path)===profile.station.value&&
      pointer(row.fields,profile.parameter.path)===profile.parameter.value;
    const key=row=>{
      const values=profile.nativeKey.map(path=>pointer(row.fields,path));
      return values.some(value=>value===undefined||value===null||value==='')?null:[current.counterpart.kind,...values];
    };
    const oldRows=previous.counterpart.records.filter(matches),newRows=current.counterpart.records.filter(matches);
    const a=group(oldRows,key),b=group(newRows,key);
    for(const k of new Set([...a.keys(),...b.keys()])){
      const before=a.get(k)??[],after=b.get(k)??[];
      let status,reason;
      if(before.length>1||after.length>1){status='AMBIGUOUS';reason='The staff-selected native identity has multiple physical rows; every original pointer is retained.';}
      else if(!before.length){status='ADDED';reason='The selected native identity appears only in the current source.';}
      else if(!after.length){status='REMOVED';reason='The selected native identity is absent from the current source.';}
      else{
        const reasons=recordChanges(current,previous,before[0],after[0]);status=reasons.length?'CHANGED':'UNCHANGED';
        reason=reasons.join(' ')||'The selected native identity has one unchanged full physical row in each edition.';
      }
      counterpartChange(profile,JSON.parse(k),before,after,status,reason);
    }
    for(const row of oldRows.filter(item=>key(item)===null))
      counterpartChange(profile,null,[row],[],'MISSING_KEY','The prior physical row lacks a complete staff-selected native identity; it cannot be paired implicitly.');
    for(const row of newRows.filter(item=>key(item)===null))
      counterpartChange(profile,null,[],[row],'MISSING_KEY','The current physical row lacks a complete staff-selected native identity; it remains individually visible.');
  }
  for(const before of previous.counterpart.records){
    if(coveredBefore.has(before.recordId))continue;
    const after=afterTargets.get(before.recordId);
    if(after&&!coveredAfter.has(after.recordId)){
      const reasons=recordChanges(current,previous,before,after);
      counterpartChange(null,['physical-record',before.recordId],[before],[after],reasons.length?'CHANGED':'UNCHANGED',
        reasons.join(' ')||'This unmapped row retains its exact original physical record identity and complete values.');
    }else counterpartChange(null,null,[before],[],'UNMAPPED',
      'No selected native field mapping or unclaimed identical physical record connects this prior row to the current edition.');
  }
  for(const after of current.counterpart.records)if(!coveredAfter.has(after.recordId))
    counterpartChange(null,null,[],[after],'UNMAPPED',
      'No selected native field mapping connects this current physical row to a prior record; the full row remains available.');

  const rowMatches=new Map();
  for(const before of previous.counterpart.records){
    const rows=evidence.get(before.recordId)??[],candidateIds=[...new Set(rows.flatMap(row=>row.afterIds))];
    let status,reason,candidate=null;
    if(rows.some(row=>row.status==='AMBIGUOUS')||candidateIds.length>1){
      status='AMBIGUOUS';reason='The original field mappings do not establish one unambiguous physical counterpart row.';
    }else if(rows.some(row=>row.status==='MISSING_KEY')){
      status='MISSING_KEY';reason='At least one selected native key is incomplete; review the original physical row.';
    }else if(candidateIds.length===1&&rows.every(row=>['UNCHANGED','CHANGED'].includes(row.status))){
      candidate=afterTargets.get(candidateIds[0]);const reasons=recordChanges(current,previous,before,candidate);
      status=reasons.length?'CHANGED':'UNCHANGED';reason=reasons.join(' ')||'The original physical row is uniquely matched and unchanged.';
    }else{
      status=rows.some(row=>row.status==='REMOVED')?'REMOVED':'UNMAPPED';
      reason=candidateIds.length?'The original mappings disagree about whether this physical record remains present.':
        status==='REMOVED'?'The original selected counterpart identity is absent.':'No explicit original identity mapping locates this counterpart row.';
    }
    rowMatches.set(before.recordId,{status,reason,candidate,candidateIds});
  }
  // Different selected key sets must not silently coalesce two prior physical rows.
  const reverse=group([...rowMatches].filter(([,match])=>match.candidate),([,match])=>match.candidate.recordId);
  for(const [key,rows]of reverse)if(rows.length>1){
    const recordId=JSON.parse(key),beforeIds=rows.map(([id])=>id);
    changes.push({kind:'counterpart',key:['cross-profile',recordId],status:'AMBIGUOUS',
      reason:'Different prior physical rows converge on the same current record through their selected mappings.',beforeIds,afterIds:[recordId]});
    for(const [id,match]of rows)rowMatches.set(id,{...match,status:'AMBIGUOUS',
      reason:'Another prior physical row resolves to this same current row; review the duplicate identities.'});
  }

  for(const quality of document.quality){
    const match=seriesMatches.get(quality.seriesId),candidate=match?.candidate;
    const present=candidate&&current.kiwis.observations.some(row=>row.seriesId===candidate.seriesId&&row.quality===quality.code);
    const keep=match?.status==='UNCHANGED'&&sameQuality&&present;
    let status=match?.status??'REMOVED',reason=match?.reason??'The selected series is absent.';
    if(status==='UNCHANGED'&&!sameQuality){status='CHANGED';reason='The full quality or release-state catalogue changed; review the meaning of this original code.';}
    else if(status==='UNCHANGED'&&!present){status='REMOVED';reason='This exact quality code is not present in the current selected series.';}
    if(keep)proposed.quality.push({...quality,seriesId:candidate.seriesId});
    retained.push({kind:'quality',seriesId:quality.seriesId,code:quality.code,status,retained:Boolean(keep),reason,
      original:quality,...(candidate?{candidate:candidate.seriesId}:{})});
  }
  for(const time of document.times){
    const match=rowMatches.get(time.recordId),candidate=match?.candidate;
    const keep=match?.status==='UNCHANGED'&&candidate&&pointer(candidate.fields,time.path)!==undefined&&
      same(pointer(candidate.fields,time.path),time.before);
    if(keep)proposed.times.push({...time,recordId:candidate.recordId,rowSha256:candidate.rowSha256});
    retained.push({kind:'time',recordId:time.recordId,path:time.path,status:keep?'UNCHANGED':match?.status==='UNCHANGED'?'CHANGED':match?.status??'UNMAPPED',
      retained:Boolean(keep),reason:keep?'The exact original time field, physical row and native interpretation are unchanged.':
        match?.status==='UNCHANGED'?'The selected original time field is absent or changed.':match?.reason??'No current source row is bound to this time choice.',
      original:time,...(candidate?{candidate:candidate.recordId}:{candidateIds:match?.candidateIds??[]})});
  }
  const correspondenceRecords=new Map();
  for(const choice of document.correspondences){
    const match=rowMatches.get(choice.recordId),candidate=match?.candidate;
    let status=match?.status??'UNMAPPED',reason=match?.reason??'No current counterpart identity is established.',keep=status==='UNCHANGED';
    let observation=null;
    if(keep&&choice.action==='link'){
      const original=beforeObservations.get(choice.observationId),key=canonical(observationKey(previous,original));
      const before=oldObs.get(key)??[],after=newObs.get(key)??[],series=seriesMatches.get(original.seriesId);
      if(before.length!==1||after.length!==1){
        keep=false;status=before.length>1||after.length>1?'AMBIGUOUS':'REMOVED';
        reason=status==='AMBIGUOUS'?'The linked observation key has multiple physical occurrences; no replacement is inferred.':
          'The linked original observation is absent from the current programme.';
      }else if(observationChanges(before[0],after[0]).length){
        keep=false;status='CHANGED';reason=observationChanges(before[0],after[0]).join(' ');
      }else if(!sameQuality){
        keep=false;status='CHANGED';reason='The full quality or release-state catalogue changed; review the original link.';
      }else if(series?.status!=='UNCHANGED'||after[0].seriesId!==series.candidate?.seriesId){
        keep=false;status=series?.status??'REMOVED';reason=series?.reason??'The linked original series identity is absent.';
      }else{
        observation=after[0];reason='The counterpart and linked observation retain unique unchanged original identities and provider metadata.';
      }
    }
    if(keep)proposed.correspondences.push({...choice,recordId:candidate.recordId,rowSha256:candidate.rowSha256,
      ...(observation?{observationId:observation.recordId,observationSha256:observation.rowSha256}:{})});
    const record={kind:'correspondence',recordId:choice.recordId,action:choice.action,status,retained:Boolean(keep),reason,original:choice,
      ...(candidate?{candidate:candidate.recordId}:{candidateIds:match?.candidateIds??[]}),
      ...(observation?{observationCandidate:observation.recordId}:{})};
    retained.push(record);if(keep)correspondenceRecords.set(candidate.recordId,record);
  }
  // The original planner, including explicit time/offset modes and quality
  // exclusions, decides whether a carried link still falls inside its mapping.
  const proposedPreview=previewCommissioning(current,proposed),invalid=new Set();
  for(const row of proposedPreview.records)if(row.status==='REVIEW_REQUIRED'){
    invalid.add(row.recordId);const record=correspondenceRecords.get(row.recordId);
    if(record){record.status='REVIEW_REQUIRED';record.retained=false;record.reason=row.reviewReason;}
  }
  proposed.correspondences=proposed.correspondences.filter(choice=>!invalid.has(choice.recordId));
  const content={schema:'starforge.kiwis-commissioning-edition-comparison.v1',previousSourceSha256:previous.sourceSha256,
    currentSourceSha256:current.sourceSha256,previousDocument:document,qualityCataloguesChanged:!sameQuality,
    counterpartProfileChanged:!sameProfile,metadataComparison:'Exact provider fields; repeated request-window wrappers are separate coverage.',
    changes,retainedDecisions:retained,
    counterpartMatches:[...rowMatches].map(([previousRecordId,match])=>({previousRecordId,status:match.status,reason:match.reason,
      currentRecordId:['UNCHANGED','CHANGED'].includes(match.status)?match.candidate?.recordId??null:null,candidateIds:match.candidateIds})),
    counterpartCoverage:{previousRecords:previous.counterpart.records.length,currentRecords:current.counterpart.records.length,
      representedPrevious:coveredBefore.size,representedCurrent:coveredAfter.size},
    proposedDocument:normalizeDecisions(current,proposed)};
  return {...content,comparisonSha256:digest(canonical(content))};
}


function savedReviewIdentity(source,saved){
  if(saved?.schema!=='starforge.kiwis-commissioning-saved.v1'||saved.review?.schema!==REVIEW_SCHEMA)
    fail('KIWIS_REVIEW','Compare two complete saved commissioning reviews.');
  const {savedSha256,...savedBody}=saved,{reviewSha256,...reviewBody}=saved.review,review=saved.review;
  if(digest(canonical(savedBody))!==savedSha256||digest(canonical(reviewBody))!==reviewSha256||
    review.sourceSha256!==source.sourceSha256||!same(review.source,source.binding)||
    digest(canonical(review.document))!==review.documentSha256||!same(normalizeDecisions(source,review.document),review.document))
    fail('KIWIS_REVIEW_CHANGED','Keep each complete saved review bound to its original sources and decisions.');
  const originals=new Map(source.counterpart.records.map(row=>[row.recordId,row])),seen=new Set();
  if(!Array.isArray(review.records)||review.records.length!==originals.size||review.counts.counterpartRecords!==originals.size)
    fail('KIWIS_REVIEW_CHANGED','Retain every original physical counterpart in the saved review.');
  for(const row of review.records){
    if(seen.has(row.recordId)||originals.get(row.recordId)?.rowSha256!==row.rowSha256)
      fail('KIWIS_REVIEW_CHANGED','Retain one saved review record for every exact original physical row.');
    seen.add(row.recordId);
  }
  return {reviewId:saved.reviewId,sourceId:saved.sourceId,title:saved.title,savedSha256,
    sourceSha256:review.sourceSha256,reviewSha256,documentSha256:review.documentSha256,counts:review.counts,document:review.document};
}
function decisionChanges(previous,current){
  const result={};
  const keyFor={profiles:row=>[row.seriesId],quality:row=>[row.seriesId,row.code],
    times:row=>[row.recordId,row.path],correspondences:row=>[row.recordId]};
  for(const [section,key]of Object.entries(keyFor)){
    const before=new Map(previous[section].map((value,index)=>[canonical(key(value)),{value,index}])),
      after=new Map(current[section].map((value,index)=>[canonical(key(value)),{value,index}]));
    const summary={previous:before.size,current:after.size,added:0,removed:0,changed:0,unchanged:0,entries:[]};
    for(const id of new Set([...before.keys(),...after.keys()])){
      const a=before.get(id),b=after.get(id),status=!a?'ADDED':!b?'REMOVED':same(a.value,b.value)?'UNCHANGED':'CHANGED';
      summary[status.toLowerCase()]++;
      summary.entries.push({key:JSON.parse(id),status,beforeIndex:a?.index??null,afterIndex:b?.index??null,
        changedFields:a&&b?Object.keys({...a.value,...b.value}).filter(field=>!same(a.value[field]??null,b.value[field]??null)):[]});
    }
    result[section]=summary;
  }
  return result;
}
export function compareCommissioningReviews(current,previous,currentSaved,previousSaved){
  const currentIdentity=savedReviewIdentity(current,currentSaved),previousIdentity=savedReviewIdentity(previous,previousSaved),
    sourceComparison=compareCommissioningSources(current,previous,previousSaved.review.document),
    oldRecords=new Map(previousSaved.review.records.map(row=>[row.recordId,row])),
    newRecords=new Map(currentSaved.review.records.map(row=>[row.recordId,row])),
    sameSource=current.sourceSha256===previous.sourceSha256,
    matches=new Map(sourceComparison.counterpartMatches.map(match=>[match.previousRecordId,match])),
    pairedCurrent=new Set(),records=[],transitions=new Map();
  const coverage={previousRecords:oldRecords.size,currentRecords:newRecords.size,paired:0,unchanged:0,changed:0,
    unpairedPrevious:0,unpairedCurrent:0};
  const incoming=new Map();
  for(const match of matches.values())for(const id of match.candidateIds){
    if(!incoming.has(id))incoming.set(id,[]);incoming.get(id).push(match.previousRecordId);
  }
  function append(before,after,sourceMatch){
    const changedFields=before&&after?Object.keys({...before,...after}).filter(field=>!same(before[field]??null,after[field]??null)):[],
      status=before&&after?(changedFields.length?'CHANGED':'UNCHANGED'):'UNPAIRED';
    if(before&&after){coverage.paired++;coverage[status.toLowerCase()]++;}
    else if(before)coverage.unpairedPrevious++;else coverage.unpairedCurrent++;
    const key=canonical([before?.status??null,after?.status??null]);transitions.set(key,(transitions.get(key)??0)+1);
    records.push({previousRecordId:before?.recordId??null,currentRecordId:after?.recordId??null,status,sourceMatch,changedFields,
      before:before??null,after:after??null});
  }
  for(const [id,before]of oldRecords){
    const match=sameSource?{status:'UNCHANGED',reason:'Both saved reviews retain the identical source edition and physical record.',
      currentRecordId:id,candidateIds:[id]}:matches.get(id);
    const after=match&&['UNCHANGED','CHANGED'].includes(match.status)&&match.currentRecordId?newRecords.get(match.currentRecordId):null;
    if(after){
      if(pairedCurrent.has(after.recordId))fail('KIWIS_COMPARISON','A saved-review comparison must not coalesce original physical rows.');
      pairedCurrent.add(after.recordId);
    }
    append(before,after,match??{status:'UNMAPPED',reason:'No original physical source match is established.',currentRecordId:null,candidateIds:[]});
  }
  for(const [id,after]of newRecords)if(!pairedCurrent.has(id))
    append(null,after,{status:'UNPAIRED',reason:'This current physical row has no unique paired prior review record.',
      currentRecordId:id,previousRecordIds:incoming.get(id)??[]});
  if(coverage.paired+coverage.unpairedPrevious!==oldRecords.size||coverage.paired+coverage.unpairedCurrent!==newRecords.size)
    fail('KIWIS_COMPARISON','Keep complete physical row coverage in both saved editions.');
  const countDelta={};
  for(const key of new Set([...Object.keys(previousSaved.review.counts),...Object.keys(currentSaved.review.counts)])){
    const before=previousSaved.review.counts[key],after=currentSaved.review.counts[key];
    if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after))fail('KIWIS_COMPARISON','Compare exact complete native review counts.');
    countDelta[key]=after-before;
  }
  const body={schema:'starforge.kiwis-commissioning-saved-review-comparison.v1',previous:previousIdentity,current:currentIdentity,
    sameSource,countDelta,coverage,decisionIdentity:'Exact saved decision keys; source identity matches are retained separately for each physical record.',
    decisionChanges:decisionChanges(previousSaved.review.document,currentSaved.review.document),
    statusTransitions:[...transitions].map(([key,count])=>{const [before,after]=JSON.parse(key);return {before,after,count};}),records};
  const reviewComparison={...body,reviewComparisonSha256:digest(canonical(body))};
  const {comparisonSha256,...sourceBody}=sourceComparison,content={...sourceBody,mode:'saved-reviews',sourceComparisonSha256:comparisonSha256,reviewComparison};
  return {...content,comparisonSha256:digest(canonical(content))};
}

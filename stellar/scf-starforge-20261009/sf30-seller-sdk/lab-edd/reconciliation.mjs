// MIT. Complete source-bound candidate and correspondence review across explicit EDD profiles.
import { canonicalJson, sha256 } from './model.mjs';
import { labError } from './table.mjs';
import { EQUIS_CROSS_PROFILE, projectEQuisDelivery } from './reconciliation-profile.mjs';
export const LAB_CROSS_SCHEMA='starforge.lab-edd-cross-profile.v1';
export const LAB_CROSS_DECISIONS_SCHEMA='starforge.lab-edd-cross-profile-decisions.v1';
export const LAB_CROSS_REVIEW_SCHEMA='starforge.lab-edd-cross-profile-review.v1';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const checked=(value,keys,label)=>{
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))labError('CROSS_SHAPE','Unexpected '+label+' field.');
};
export function reconciliationVariants(entities,field){
  const map=new Map();
  for(const entity of entities){
    const value=entity.fields[field]??null,key=canonicalJson(value);
    if(!map.has(key))map.set(key,{value,entityIds:[]});
    map.get(key).entityIds.push(entity.entityId);
  }
  return [...map.values()].sort((a,b)=>canonicalJson(a.value).localeCompare(canonicalJson(b.value),'en'));
}
export function compareReconciliationFields(before,after){
  const names=[...new Set([...before,...after].flatMap(entity=>Object.keys(entity.fields)))].sort();
  return names.map(field=>{
    const baseline=reconciliationVariants(before,field),current=reconciliationVariants(after,field);
    let status;
    if(!before.length||!after.length)status='UNPAIRED';
    else if(baseline.length!==1||current.length!==1)status='AMBIGUOUS';
    else if(baseline[0].value===null||current[0].value===null)status=baseline[0].value===current[0].value?'ABSENT':'UNAVAILABLE';
    else if(same(baseline[0].value,current[0].value))status='EQUAL';
    else if(baseline[0].value.kind===current[0].value.kind&&baseline[0].value.value!==null&&
      baseline[0].value.value===current[0].value.value)status='REPRESENTATION';
    else status='CHANGED';
    return {field,status,baseline,current};
  });
}
function sourceBinding(projection){return {sourceSha256:projection.source.sourceSha256,profile:projection.source.profile,reviewSha256:projection.reviewSha256};}
export function reconcileDeliveries(current,baseline,{currentReview=null,baselineReview=null}={}){
  const a=projectEQuisDelivery(baseline,{review:baselineReview}),b=projectEQuisDelivery(current,{review:currentReview});
  if(a.source.profile.id===b.source.profile.id)labError('CROSS_PROFILE_PAIR','Use the existing same-profile reissue comparison for matching profile IDs.');
  const groups=new Map();
  for(const [side,projection]of [['baseline',a],['current',b]])for(const entity of projection.entities){
    const key=canonicalJson(entity.candidate.complete?[entity.kind,entity.candidate.fields]:
      [entity.kind,'UNKEYED',side,entity.entityId]);
    if(!groups.has(key))groups.set(key,{kind:entity.kind,key:JSON.parse(key),baseline:[],current:[],completeKey:entity.candidate.complete});
    groups.get(key)[side].push(entity);
  }
  const entries=[],counts={groups:0,baselineOnly:0,currentOnly:0,ambiguous:0,candidateChanged:0,candidateEqual:0,unkeyed:0,
    changedFields:0,representationFields:0,unavailableFields:0,baselinePhysicalRows:a.physical.length,currentPhysicalRows:b.physical.length,
    baselineEntities:a.entities.length,currentEntities:b.entities.length};
  const byKind={};
  for(const [key,group]of [...groups.entries()].sort(([a],[b])=>a.localeCompare(b,'en'))){
    const fields=compareReconciliationFields(group.baseline,group.current);
    const status=!group.completeKey?'UNKEYED':!group.baseline.length?'CURRENT_ONLY':!group.current.length?'BASELINE_ONLY':
      group.baseline.length>1||group.current.length>1?'AMBIGUOUS':fields.some(field=>field.status==='CHANGED')?'CANDIDATE_CHANGED':'CANDIDATE_EQUAL';
    const countKey={UNKEYED:'unkeyed',CURRENT_ONLY:'currentOnly',BASELINE_ONLY:'baselineOnly',AMBIGUOUS:'ambiguous',CANDIDATE_CHANGED:'candidateChanged',CANDIDATE_EQUAL:'candidateEqual'}[status];
    counts.groups++;counts[countKey]++;
    for(const field of fields){
      if(field.status==='CHANGED')counts.changedFields++;
      if(field.status==='REPRESENTATION')counts.representationFields++;
      if(field.status==='UNAVAILABLE')counts.unavailableFields++;
    }
    if(!byKind[group.kind])byKind[group.kind]={groups:0,baselineEntities:0,currentEntities:0,baselinePhysicalReferences:0,currentPhysicalReferences:0,statuses:{}};
    const kind=byKind[group.kind];kind.groups++;kind.baselineEntities+=group.baseline.length;kind.currentEntities+=group.current.length;
    kind.baselinePhysicalReferences+=group.baseline.reduce((sum,item)=>sum+item.rows.length,0);
    kind.currentPhysicalReferences+=group.current.reduce((sum,item)=>sum+item.rows.length,0);
    kind.statuses[status]=(kind.statuses[status]??0)+1;
    const entry={groupId:'group-'+sha256(canonicalJson([EQUIS_CROSS_PROFILE.id,sourceBinding(a),sourceBinding(b),JSON.parse(key)])).slice(0,32),
      kind:group.kind,key:group.key,status,baselineIds:group.baseline.map(item=>item.entityId).sort(),
      currentIds:group.current.map(item=>item.entityId).sort(),fields};
    entry.groupSha256=sha256(canonicalJson(entry));entries.push(entry);
  }
  const report={schema:LAB_CROSS_SCHEMA,mapping:EQUIS_CROSS_PROFILE,baseline:sourceBinding(a),current:sourceBinding(b),
    counts,byKind,baselineProjection:a,currentProjection:b,groups:entries};
  report.comparisonSha256=sha256(canonicalJson({schema:report.schema,mapping:{id:report.mapping.id,version:report.mapping.version},
    baseline:report.baseline,current:report.current,counts,byKind,
    baselineEntities:a.entities.map(item=>item.entitySha256),currentEntities:b.entities.map(item=>item.entitySha256),
    groups:entries.map(item=>item.groupSha256)}));
  return report;
}
export function normalizeReconciliation(comparison,input){
  if(input===undefined||input===null)input={schema:LAB_CROSS_DECISIONS_SCHEMA,comparisonSha256:comparison.comparisonSha256,
    mapping:{id:comparison.mapping.id,version:comparison.mapping.version},baseline:comparison.baseline,current:comparison.current,decisions:[],links:[]};
  checked(input,['schema','comparisonSha256','mapping','baseline','current','decisions','links'],'reconciliation document');
  if(input.schema!==LAB_CROSS_DECISIONS_SCHEMA||input.comparisonSha256!==comparison.comparisonSha256||
    !same(input.mapping,{id:comparison.mapping.id,version:comparison.mapping.version})||
    !same(input.baseline,comparison.baseline)||!same(input.current,comparison.current))
    labError('CROSS_SOURCE_CHANGED','The complete reconciliation belongs to a different source pair, source review or mapping edition.');
  if(!Array.isArray(input.decisions)||input.decisions.length>comparison.groups.length)
    labError('CROSS_DECISION_COUNT','Choose at most one explicit disposition for each original candidate group.');
  const groups=new Map(comparison.groups.map(group=>[group.groupId,group])),seen=new Set(),decisions=[],allPairKeys=new Set();
  for(const choice of input.decisions){
    checked(choice,['groupId','groupSha256','action','pairs','reason'],'correspondence decision');
    const group=groups.get(choice.groupId);
    if(!group||choice.groupSha256!==group.groupSha256||seen.has(choice.groupId))
      labError('CROSS_GROUP_CHANGED','A disposition must match its exact complete candidate group.');
    seen.add(choice.groupId);
    if(!['defer','separate','pair'].includes(choice.action)||typeof (choice.reason??'')!=='string'||
      (choice.reason??'').length>24000||choice.action!=='defer'&&!(choice.reason??'').trim())
      labError('CROSS_REASON','Confirmed correspondence and separate records need an explicit reviewer reason.');
    const pairs=[];
    if(choice.action==='pair'){
      if(!Array.isArray(choice.pairs)||!choice.pairs.length||choice.pairs.length>100000)
        labError('CROSS_PAIRS','Select the actual current and baseline entities for the reviewed correspondence.');
      const pairKeys=new Set();
      for(const pair of choice.pairs){
        checked(pair,['baselineId','currentId'],'selected correspondence');
        if(!group.baselineIds.includes(pair.baselineId)||!group.currentIds.includes(pair.currentId))
          labError('CROSS_PAIR_TARGET','A selected correspondence must use entities in the same original candidate group.');
        const key=canonicalJson([pair.baselineId,pair.currentId]);
        if(pairKeys.has(key))labError('CROSS_DUPLICATE_PAIR','The same selected correspondence appears twice.');
        pairKeys.add(key);allPairKeys.add(key);pairs.push({baselineId:pair.baselineId,currentId:pair.currentId});
      }
      pairs.sort((a,b)=>a.baselineId.localeCompare(b.baselineId,'en')||a.currentId.localeCompare(b.currentId,'en'));
    }else if(Object.hasOwn(choice,'pairs'))labError('CROSS_PAIRS','Deferred or separate groups do not contain confirmed correspondences.');
    decisions.push({groupId:choice.groupId,groupSha256:choice.groupSha256,action:choice.action,
      ...(choice.action==='pair'?{pairs}:{}),reason:choice.reason??''});
  }
  if(!Array.isArray(input.links??[])||(input.links??[]).length>100000)labError('CROSS_LINKS','Use complete explicit cross-group correspondences.');
  const baselineEntities=new Map(comparison.baselineProjection.entities.map(entity=>[entity.entityId,entity]));
  const currentEntities=new Map(comparison.currentProjection.entities.map(entity=>[entity.entityId,entity]));
  const links=[];
  for(const link of input.links??[]){
    checked(link,['baselineId','baselineSha256','currentId','currentSha256','reason'],'cross-group correspondence');
    const before=baselineEntities.get(link.baselineId),after=currentEntities.get(link.currentId),key=canonicalJson([link.baselineId,link.currentId]);
    if(!before||!after||before.kind!==after.kind||link.baselineSha256!==before.entitySha256||link.currentSha256!==after.entitySha256)
      labError('CROSS_LINK_SOURCE','An explicit correspondence must bind the exact same-kind source entities and their complete field hashes.');
    if(allPairKeys.has(key))labError('CROSS_DUPLICATE_PAIR','The same correspondence is already present in this review.');
    if(typeof link.reason!=='string'||!link.reason.trim()||link.reason.length>24000)labError('CROSS_REASON','An explicit cross-group correspondence needs its reviewer reason.');
    allPairKeys.add(key);links.push({baselineId:link.baselineId,baselineSha256:link.baselineSha256,
      currentId:link.currentId,currentSha256:link.currentSha256,reason:link.reason});
  }
  links.sort((a,b)=>a.baselineId.localeCompare(b.baselineId,'en')||a.currentId.localeCompare(b.currentId,'en'));
  decisions.sort((a,b)=>a.groupId.localeCompare(b.groupId,'en'));
  return {schema:LAB_CROSS_DECISIONS_SCHEMA,comparisonSha256:comparison.comparisonSha256,
    mapping:{id:comparison.mapping.id,version:comparison.mapping.version},baseline:comparison.baseline,current:comparison.current,decisions,links};
}
export function previewReconciliation(comparison,input){
  const document=normalizeReconciliation(comparison,input),selected=new Map(document.decisions.map(choice=>[choice.groupId,choice]));
  const baseline=new Map(comparison.baselineProjection.entities.map(entity=>[entity.entityId,entity]));
  const current=new Map(comparison.currentProjection.entities.map(entity=>[entity.entityId,entity]));
  const everyPair=[...document.decisions.flatMap(choice=>choice.pairs??[]),...document.links];
  const allA=new Set(everyPair.map(pair=>pair.baselineId)),allB=new Set(everyPair.map(pair=>pair.currentId));
  const counts={groups:comparison.groups.length,unreviewed:0,deferred:0,separate:0,paired:0,partiallyPaired:0,linked:0,partiallyLinked:0,
    correspondences:everyPair.length,explicitCrossGroupLinks:document.links.length,baselineReferenced:allA.size,currentReferenced:allB.size,
    baselineUnpaired:baseline.size-allA.size,currentUnpaired:current.size-allB.size};
  const entries=[];
  for(const group of comparison.groups){
    const choice=selected.get(group.groupId),pairs=choice?.pairs??[];
    const unpairedBaseline=group.baselineIds.filter(id=>!allA.has(id)),unpairedCurrent=group.currentIds.filter(id=>!allB.has(id));
    const links=document.links.filter(link=>group.baselineIds.includes(link.baselineId)||group.currentIds.includes(link.currentId));
    let status;
    if(!choice)status=links.length?(unpairedBaseline.length||unpairedCurrent.length?'PARTIALLY_LINKED':'LINKED'):'UNREVIEWED';
    else if(choice.action==='defer')status='DEFERRED';
    else if(choice.action==='separate')status='SEPARATE';
    else status=unpairedBaseline.length||unpairedCurrent.length?'PARTIALLY_PAIRED':'PAIRED';
    counts[{UNREVIEWED:'unreviewed',DEFERRED:'deferred',SEPARATE:'separate',PARTIALLY_PAIRED:'partiallyPaired',PAIRED:'paired',LINKED:'linked',PARTIALLY_LINKED:'partiallyLinked'}[status]]++;
    entries.push({groupId:group.groupId,groupSha256:group.groupSha256,status,choice:choice??null,unpairedBaseline,unpairedCurrent,
      pairs:pairs.map(pair=>({...pair,fields:compareReconciliationFields([baseline.get(pair.baselineId)],[current.get(pair.currentId)])})),
      links:links.map(link=>({baselineId:link.baselineId,currentId:link.currentId}))});
  }
  const result={schema:LAB_CROSS_REVIEW_SCHEMA,comparisonSha256:comparison.comparisonSha256,document,
    documentSha256:sha256(canonicalJson(document)),counts,entries,
    links:document.links.map(link=>({...link,fields:compareReconciliationFields([baseline.get(link.baselineId)],[current.get(link.currentId)])}))};
  result.reviewSha256=sha256(canonicalJson(result));return result;
}

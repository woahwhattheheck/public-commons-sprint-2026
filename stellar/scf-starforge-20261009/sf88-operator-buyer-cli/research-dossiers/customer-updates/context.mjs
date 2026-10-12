// MIT. Exact original source and native-record context for a customer update.
import {digest,jsonBytes} from '../../node/store.mjs';
import {canonicalSource,hash as originalSourceHash} from '../normalize.mjs';
import {customerJson,customerObject,customerText,customerHash,customerFields,customerWorkSelection,
  requireCustomerUpdate as need} from './contracts.mjs';
export const customerUpdateDigest=value=>digest(jsonBytes(customerJson(value)));
export const customerUpdateSame=(a,b)=>customerUpdateDigest(a)===customerUpdateDigest(b);
const clone=value=>structuredClone(value);
const latest=(values,key)=>{const map=new Map();for(const value of values)map.set(key(value),value);return [...map.values()];};
export function customerUpdateRecords(state){
  const rows={projects:[],briefs:[],agreements:[],requests:[],intakes:[],work:[],deliveries:[],deliveryEvents:[],projectStatuses:[],
    operations:state.customerUpdateEvents??[]};
  for(const event of rows.operations){
    for(const [field,target]of [['project','projects'],['brief','briefs'],['agreement','agreements'],
      ['updateRequest','requests'],['intake','intakes'],['work','work'],['delivery','deliveries'],
      ['deliveryEvent','deliveryEvents'],['projectStatus','projectStatuses']])
      if(event.result?.[field])rows[target].push(event.result[field]);
  }
  return rows;
}
export function customerCurrentRequests(rows){return latest(rows.requests,value=>value.cycleId);}
export function customerCurrentBriefs(rows){return latest(rows.briefs,value=>value.projectId);}
export function customerFind(rows,id,code='CUSTOMER_UPDATE_NOT_FOUND'){
  const found=rows.find(row=>row.id===id);need(found,code);return found;
}
const pointerEscape=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
const nativeRoot=key=>['questions','editions','selections','findings','citationReviews'].includes(key)||
  /^[A-Za-z][A-Za-z0-9]*Events$/.test(key)&&key!=='customerUpdateEvents';
export function customerNativeRecord(state,selection){
  customerFields(selection,['path','sha256','label'],'CUSTOMER_UPDATE_RECORD_SELECTION_INVALID');
  const path=customerText(selection.path,'CUSTOMER_UPDATE_RECORD_PATH_REQUIRED',2048);
  need(path.startsWith('/')&&!/~(?:[^01]|$)/.test(path),'CUSTOMER_UPDATE_RECORD_PATH_INVALID');
  const keys=path.slice(1).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~'));
  need(keys.length>=2&&nativeRoot(keys[0]),'CUSTOMER_UPDATE_NATIVE_RECORD_REQUIRED');
  let value=state;
  for(const key of keys){
    need(value!==null&&typeof value==='object'&&Object.hasOwn(value,key),'CUSTOMER_UPDATE_NATIVE_RECORD_MISSING');
    if(Array.isArray(value))need(/^(?:0|[1-9][0-9]*)$/.test(key),'CUSTOMER_UPDATE_RECORD_PATH_INVALID');
    value=value[key];
  }
  need(customerObject(value)||Array.isArray(value),'CUSTOMER_UPDATE_NATIVE_RECORD_REQUIRED');
  const sha256=customerUpdateDigest(value);
  if(selection.sha256!==undefined)need(customerHash(selection.sha256)===sha256,'CUSTOMER_UPDATE_NATIVE_RECORD_CHANGED');
  return {path,sha256,label:selection.label??'',kind:keys[0],record:clone(value)};
}
export function customerNativeRecordCatalog(state){
  const rows=[];
  const add=(path,record,kind,label)=>{
    if(!customerObject(record)&&!Array.isArray(record))return;
    rows.push({path,sha256:customerUpdateDigest(record),kind,
      label:String(label??record.name??record.title??record.label??record.id??kind).slice(0,240),
      id:typeof record.id==='string'?record.id:null,bytes:jsonBytes(record).length});
  };
  for(const [key,values]of Object.entries(state)){
    if(!nativeRoot(key)||!Array.isArray(values))continue;
    for(let index=0;index<values.length;index++){
      const row=values[index],path='/'+pointerEscape(key)+'/'+index;
      add(path,row,key,row?.title??row?.name??row?.label??row?.action??row?.id);
      if(customerObject(row?.result)){
        for(const [name,value]of Object.entries(row.result)){
          const prefix=path+'/result/'+pointerEscape(name);
          if(Array.isArray(value)){
            value.forEach((item,n)=>add(prefix+'/'+n,item,key,item?.name??item?.title??name+' '+(n+1)));
          }else add(prefix,value,key,value?.name??value?.title??name);
        }
      }
    }
  }
  return rows;
}
export function customerSourceInventory(state,projected,editionIds){
  need(projected instanceof Map,'CUSTOMER_UPDATE_RETAINED_PROJECTIONS_REQUIRED');
  const selected=new Set(editionIds),selectionMap=new Map(state.selections.map(row=>[row.occurrenceId,row]));
  const groups=new Map(),editions=[];
  for(const edition of state.editions){
    if(!selected.has(edition.id))continue;
    const projection=projected.get(edition.id);
    const status=projection?.status??'UNAVAILABLE';
    editions.push({...clone(edition),projection:{status,itemCount:projection?.items?.length??0,
      query:projection?.query??null,sourceTerms:projection?.sourceTerms??edition.sourceTerms??null,
      warnings:clone(projection?.warnings??[]),error:projection?.error??null}});
    // Reference handles remain original handles; a report does not copy a live entitlement projection.
    if(edition.mode!=='retained')continue;
    for(const row of projection?.items??[]){
      const occurrenceId='o_'+originalSourceHash(edition.id+'\n'+row.key);
      const key=canonicalSource(row,occurrenceId),id='s_'+originalSourceHash(key);
      let group=groups.get(id);
      if(!group){group={id,key,title:row.title,url:row.url??'',doi:row.doi??'',occurrences:[]};groups.set(id,group);}
      const saved=selectionMap.get(occurrenceId);
      group.title=row.title;group.url=row.url??'';group.doi=row.doi??'';
      group.occurrences.push({occurrenceId,editionId:edition.id,questionId:edition.questionId,key:row.key,
        provider:edition.provider,title:row.title,url:row.url??'',doi:row.doi??'',publishedAt:row.publishedAt??'',
        originalRecordSha256:customerUpdateDigest(row.original),contentSha256:customerUpdateDigest(row.content),
        normalizedSha256:customerUpdateDigest({id:row.id,provider:row.provider,title:row.title,url:row.url,
          doi:row.doi,content:row.content,publishedAt:row.publishedAt,authors:row.authors,
          citation:row.citation,references:row.references,metadata:row.metadata,original:row.original}),
        sourceSha256:edition.raw.sha256,sourceBytes:edition.raw.bytes,
        selection:saved?clone(saved):null});
    }
  }
  const sources=[...groups.values()].map(group=>{
    const facts=group.occurrences.map(row=>({normalizedSha256:row.normalizedSha256,
      selection:row.selection?{selected:row.selection.selected,note:row.selection.note,classification:row.selection.classification}:null}));
    facts.sort((a,b)=>{const left=JSON.stringify(a),right=JSON.stringify(b);return left<right?-1:left>right?1:0;});
    return {...group,occurrenceCount:group.occurrences.length,sha256:customerUpdateDigest(facts)};
  });
  need(sources.length<=25000,'CUSTOMER_UPDATE_SOURCE_LIMIT');
  return {editions,sources,counts:{editions:editions.length,
    retainedEditions:editions.filter(row=>row.mode==='retained').length,
    referenceEditions:editions.filter(row=>row.mode!=='retained').length,
    occurrences:sources.reduce((count,row)=>count+row.occurrenceCount,0),sources:sources.length}};
}
export function compareCustomerSources(before,after){
  const left=new Map((before?.sources??[]).map(row=>[row.id,row])),right=new Map(after.sources.map(row=>[row.id,row]));
  const rows=[];
  for(const [id,current]of right){
    const previous=left.get(id);
    rows.push({id,status:!previous?'ADDED':previous.sha256===current.sha256?'UNCHANGED':'CHANGED',
      title:current.title,before:previous?clone(previous):null,after:clone(current)});
  }
  for(const [id,previous]of left)if(!right.has(id))rows.push({id,status:'REMOVED',title:previous.title,before:clone(previous),after:null});
  for(const row of rows)row.fingerprint=customerUpdateDigest({id:row.id,status:row.status,
    before:row.before?.sha256??null,after:row.after?.sha256??null});
  return {counts:Object.fromEntries(['ADDED','CHANGED','REMOVED','UNCHANGED'].map(status=>[status,rows.filter(row=>row.status===status).length])),rows};
}
export function customerUpdateContext(state,projected,{projectId,cycleId,requestEditionId,selection},baselineWork=null){
  const records=customerUpdateRecords(state),project=customerFind(records.projects,projectId,'CUSTOMER_UPDATE_PROJECT_NOT_FOUND');
  const requested=customerFind(records.requests,requestEditionId,'CUSTOMER_UPDATE_REQUEST_EDITION_NOT_FOUND');
  need(requested.projectId===projectId&&requested.cycleId===cycleId,'CUSTOMER_UPDATE_REQUEST_PROJECT_CHANGED');
  need(customerCurrentRequests(records).find(row=>row.cycleId===cycleId)?.id===requestEditionId,'CUSTOMER_UPDATE_REQUEST_EDITION_CHANGED');
  const brief=customerFind(records.briefs,requested.definition.briefId,'CUSTOMER_UPDATE_BRIEF_NOT_FOUND');
  const selected=customerWorkSelection(selection),intakes=selected.intakeIds.map(id=>customerFind(records.intakes,id,'CUSTOMER_UPDATE_INTAKE_NOT_FOUND'));
  need(intakes.every(row=>row.projectId===projectId&&row.cycleId===cycleId&&row.requestEditionId===requestEditionId),
    'CUSTOMER_UPDATE_INTAKE_REQUEST_CHANGED');
  const editionIds=[...new Set(intakes.flatMap(row=>row.editionIds))];
  const inventory=customerSourceInventory(state,projected,editionIds);
  need(inventory.editions.length===editionIds.length,'CUSTOMER_UPDATE_EDITION_MISSING');
  need(inventory.editions.every(row=>brief.definition.questionIds.includes(row.questionId)),'CUSTOMER_UPDATE_EDITION_QUESTION_CHANGED');
  if(requested.definition.previousDeliveryId){
    const delivery=customerFind(records.deliveries,requested.definition.previousDeliveryId,'CUSTOMER_UPDATE_BASELINE_NOT_FOUND');
    need(delivery.projectId===projectId&&baselineWork?.workId===delivery.workId,'CUSTOMER_UPDATE_BASELINE_CHANGED');
  }else need(baselineWork===null,'CUSTOMER_UPDATE_BASELINE_UNEXPECTED');
  const nativeRecords=selected.records.map(value=>customerNativeRecord(state,value));
  const questions=brief.definition.questionIds.map(id=>clone(customerFind(state.questions,id,'QUESTION_NOT_FOUND')));
  const comparison=compareCustomerSources(baselineWork?.context?.inventory,inventory);
  const covered=new Set(intakes.map(row=>row.planId));
  const value={schema:'sf88-research-customer-update-context/v1',dossierId:state.id,revision:state.revision,
    revisionSha256:digest(jsonBytes(state)),project:clone(project),brief:clone(brief),requested:clone(requested),questions,
    selection:selected,intakes:clone(intakes),inventory,nativeRecords,
    agreements:records.agreements.filter(row=>row.projectId===projectId&&row.briefId===brief.id).map(row=>clone(row)),
    baseline:baselineWork?{workId:baselineWork.workId,sourceRevision:baselineWork.sourceRevision,
      previousDeliveryId:requested.definition.previousDeliveryId,fingerprint:baselineWork.context.fingerprint}:null,
    comparison,uncoveredPlans:brief.definition.sourcePlans.filter(row=>!covered.has(row.id)).map(row=>clone(row)),
    currentBriefId:customerCurrentBriefs(records).find(row=>row.projectId===projectId)?.id??brief.id};
  return {...value,fingerprint:customerUpdateDigest(value)};
}

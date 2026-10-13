// MIT. Complete recorded cohort delivery using the original Grant client and comparison engine.
import {createHash} from 'node:crypto';
import {COHORT_DELIVERY_INPUT_SCHEMA,COHORT_DELIVERY_COMPARISON_SCHEMA,
  seedCohortDeliveryComparison,compareCohortDelivery,reopenCohortDeliveryComparison,seedCohortCommercialChoices,selectCohortOriginalCosts} from './cohort_delivery_comparison.mjs';
import {COHORT_ADOPTION_REVIEW_SCHEMA,COHORT_ADOPTION_PREPARED_SCHEMA,COHORT_ADOPTION_SAVED_SCHEMA,
  reviewGrantCohortAdoption,prepareGrantCohortAdoption,saveGrantCohortAdoption,
  inspectGrantCohortAdoptionRequest,openGrantCohortAdoption,exportCohortAdoption} from './cohort_planning_agent.mjs';

export const COHORT_DELIVERY_AGENT_SCHEMA='stellar-forge.sf47-cohort-delivery-agent.v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(value,code,message)=>{if(!value)throw Object.assign(new Error(message),{code});};
const text=(value,label,max=20000)=>{need(typeof value==='string'&&value.length<=max&&!value.includes('\0'),
  'GRANT_DELIVERY_INPUT',label+' must be complete text.');return value;};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>{need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
  'GRANT_DELIVERY_INPUT','Select the exact original SHA256.');return value;};
const id=(value,prefix)=>{need(typeof value==='string'&&new RegExp('^'+prefix+'-[a-f0-9]{32}$').test(value),
  'GRANT_DELIVERY_INPUT','Select the original '+prefix+' identity.');return value;};
const exact=(value,keys,required=[])=>{
  need(plain(value)&&Object.keys(value).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
    'GRANT_DELIVERY_INPUT','Use the complete supported fields: '+keys.join(', ')+'.');return value;
};
function documentOf(value){
  need(plain(value),'GRANT_DELIVERY_INPUT','Select one complete recorded delivery document.');
  for(let count=0;count<5;count++){
    if([COHORT_DELIVERY_AGENT_SCHEMA,COHORT_ADOPTION_REVIEW_SCHEMA,COHORT_ADOPTION_PREPARED_SCHEMA,
      COHORT_ADOPTION_SAVED_SCHEMA].includes(value.schema)){value=value.document;continue;}
    need(plain(value),'GRANT_DELIVERY_INPUT','Retain the complete original document.');
    return value;
  }
  throw Object.assign(new Error('Select the complete original recorded delivery input or comparison.'),{code:'GRANT_DELIVERY_INPUT'});
}
function inputOf(value,{editable=false}={}){
  const document=documentOf(value);
  if(document.schema===COHORT_DELIVERY_COMPARISON_SCHEMA)return copy(reopenCohortDeliveryComparison(document).input);
  need(document.schema===COHORT_DELIVERY_INPUT_SCHEMA,'GRANT_DELIVERY_INPUT','Choose a whole cohort delivery input or comparison.');
  // During source refresh a former association may need an explicit edit.
  // Validate both full original documents, retaining those choices until edited.
  seedCohortDeliveryComparison(document.planDocument,document.review);
  if(!editable)return copy(compareCohortDelivery(document).input);
  need(Array.isArray(document.links)&&Array.isArray(document.assignments)&&plain(document.recording),
    'GRANT_DELIVERY_INPUT','Retain the complete identity, placement and recording fields.');
  return copy(document);
}
function result(input,extra={},allowEditable=false){
  try {
    const document=compareCohortDelivery(input);
    return {schema:COHORT_DELIVERY_AGENT_SCHEMA,state:'CALCULATED',document,
      summary:copy(document.summary),source:copy(document.source),issues:copy([...document.issues,...(document.commercial?.issues||[])]),...extra};
  }catch(error){
    const codes=['DUPLICATE_IDENTITY_LINK','IDENTITY_LINK_NOTE_REQUIRED','UNKNOWN_IDENTITY_LINK',
      'DUPLICATE_INTENT_ASSIGNMENT','UNKNOWN_INTENT_ASSIGNMENT','INTENT_ASSIGNMENT_NOTE_REQUIRED','INTENT_IDENTITY_CONFLICT',
      'COMMERCIAL_ALLOCATION_CONFLICT','COMMERCIAL_COST_SOURCE_CHANGED','COMMERCIAL_REFUND_SOURCE_CHANGED','COMMERCIAL_CLOCK_CONFLICT','COMMERCIAL_ORIGINAL_SOURCE_CHANGED','COMMERCIAL_ORIGINAL_PERIOD','COMMERCIAL_ORIGINAL_QUANTITY','COMMERCIAL_ORIGINAL_VALUATION'];
    if(!allowEditable||!codes.includes(error.code))throw error;
    return {schema:COHORT_DELIVERY_AGENT_SCHEMA,state:'EDITABLE_INPUT',document:copy(input),
      summary:null,source:null,issues:[{code:error.code,message:error.message,path:error.path??''}],...extra};
  }
}
async function nativeSources(client,caseId,selection){
  exact(selection,['expectedVersion','planSourceId','expectedPlanSha256','reviewId','expectedReviewBusinessSha256'],
    ['expectedVersion','planSourceId','expectedPlanSha256','reviewId']);
  id(caseId,'operation');id(selection.planSourceId,'source');id(selection.reviewId,'review');digest(selection.expectedPlanSha256);
  need(Number.isSafeInteger(selection.expectedVersion)&&selection.expectedVersion>=1&&selection.expectedVersion<=10000000,
    'GRANT_DELIVERY_INPUT','Read the original current case version.');
  if(selection.expectedReviewBusinessSha256!==undefined)digest(selection.expectedReviewBusinessSha256);
  const current=(await client.read('case',{caseId})).value;
  need(current?.program?.id===caseId&&current.program.version===selection.expectedVersion&&Array.isArray(current.sources),
    'GRANT_DELIVERY_SOURCE_CHANGED','The original case changed; select its current version and complete source.');
  const metadata=current.sources.find(row=>row.id===selection.planSourceId);
  need(metadata?.sha256===selection.expectedPlanSha256,'GRANT_DELIVERY_SOURCE_CHANGED','The selected saved adoption source has changed.');
  const original=await client.download('source',{caseId,sourceId:metadata.id});
  need(Buffer.isBuffer(original.bytes)&&original.bytes.length===metadata.bytes&&hash(original.bytes)===metadata.sha256,
    'GRANT_DELIVERY_SOURCE_CHANGED','The complete adoption source differs from its original saved bytes.');
  const planDocument=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original.bytes));
  const response=await client.read('review',{caseId,reviewId:selection.reviewId}),review=response.value;
  need(review?.id===selection.reviewId&&review.cohort?.source?.programId===caseId&&
    (selection.expectedReviewBusinessSha256===undefined||selection.expectedReviewBusinessSha256===review.businessSha256),
    'GRANT_DELIVERY_SOURCE_CHANGED','Keep the selected original frozen cohort review and its business source identity.');
  // Use the original engine to inspect both sources and their case/tranche relationship.
  const input=seedCohortDeliveryComparison(planDocument,review,{planSourceId:metadata.id});
  compareCohortDelivery(input);
  const p=current.program;
  return {input,case:{id:p.id,createdAt:p.createdAt,version:p.version,planId:p.planId,
    planRevision:p.planRevision,state:p.state,name:p.name},
    nativeSources:{plan:copy(metadata),review:{id:review.id,version:review.version,
      businessSha256:review.businessSha256,measurementSha256:review.cohort.source.measurementSha256,
      previewSha256:review.cohort.previewSha256,
      ...(Buffer.isBuffer(response.bytes)?{responseSha256:hash(response.bytes),responseBytes:response.bytes.length}:{})}}};
}
export async function seedGrantCohortDelivery(client,caseId,options){
  exact(options,['expectedVersion','planSourceId','expectedPlanSha256','reviewId','expectedReviewBusinessSha256','title','note'],
    ['expectedVersion','planSourceId','expectedPlanSha256','reviewId']);
  const {title,note,...selection}=options,original=await nativeSources(client,caseId,selection);
  if(title!==undefined)original.input.title=text(title,'Comparison title',500);
  if(note!==undefined)original.input.note=text(note,'Comparison note');
  return result(original.input,{case:original.case,nativeSources:original.nativeSources});
}
export function editCohortDelivery(document,changes){
  const input=inputOf(document,{editable:true});
  need(Array.isArray(changes)&&changes.length>0&&changes.length<=2000,'GRANT_DELIVERY_INPUT','Supply explicit identity and placement edits.');
  for(const change of changes){
    exact(change,['action','kind','plannedId','observedId','intentId','targetId','note','title','commercial','originalCosts'],['action']);
    if(['RECEIVE_ORIGINAL_COSTS','REMOVE_ORIGINAL_COSTS'].includes(change.action)){
      exact(change,change.action==='RECEIVE_ORIGINAL_COSTS'?['action','originalCosts']:['action'],
        change.action==='RECEIVE_ORIGINAL_COSTS'?['action','originalCosts']:['action']);
      if(change.action==='REMOVE_ORIGINAL_COSTS'){if(input.commercial)delete input.commercial.originalCosts;}
      else Object.assign(input,selectCohortOriginalCosts(input,change.originalCosts));
      continue;
    }
    need(change.originalCosts===undefined,'GRANT_DELIVERY_INPUT','Original cost selections use RECEIVE_ORIGINAL_COSTS.');
    if(['START_COMMERCIAL','SET_COMMERCIAL','REMOVE_COMMERCIAL'].includes(change.action)){
      exact(change,change.action==='SET_COMMERCIAL'?['action','commercial']:['action'],change.action==='SET_COMMERCIAL'?['action','commercial']:['action']);
      if(change.action==='REMOVE_COMMERCIAL')delete input.commercial;
      else if(change.action==='START_COMMERCIAL'){need(input.commercial===undefined,'GRANT_DELIVERY_INPUT','This comparison already retains its commercial choices.');input.commercial=seedCohortCommercialChoices(input);}
      else input.commercial=copy(change.commercial);
      continue;
    }
    need(change.commercial===undefined,'GRANT_DELIVERY_INPUT','Commercial choices use the explicit SET_COMMERCIAL operation.');
    if(change.action==='TITLE_NOTE'){
      need(change.kind===undefined&&change.plannedId===undefined&&change.observedId===undefined&&
        change.intentId===undefined&&change.targetId===undefined&&(change.title!==undefined||change.note!==undefined),
        'GRANT_DELIVERY_INPUT','Edit the comparison title or note explicitly.');
      if(change.title!==undefined)input.title=text(change.title,'Comparison title',500);
      if(change.note!==undefined)input.note=text(change.note,'Comparison note');
      continue;
    }
    if(change.action==='LINK_IDENTITY'||change.action==='UNLINK_IDENTITY'){
      need(['buyer','merchant','operation','facilitator'].includes(change.kind)&&typeof change.plannedId==='string'&&change.plannedId&&
        change.intentId===undefined&&change.targetId===undefined&&change.title===undefined,
        'GRANT_DELIVERY_INPUT','Select the original identity kind and planned row.');
      const index=input.links.findIndex(row=>row.kind===change.kind&&row.plannedId===change.plannedId);
      if(change.action==='UNLINK_IDENTITY'){
        need(index>=0&&change.observedId===undefined&&change.note===undefined,'GRANT_DELIVERY_INPUT','Remove the explicit selected identity association.');
        input.links.splice(index,1);
      }else{
        const row={kind:change.kind,plannedId:text(change.plannedId,'Original planned identity',500),
          observedId:text(change.observedId,'Original recorded identity',500),note:text(change.note,'Source basis')};
        if(index<0)input.links.push(row);else input.links[index]=row;
      }
      continue;
    }
    need(['PLACE_INTENT','CLEAR_PLACEMENT'].includes(change.action)&&typeof change.intentId==='string'&&change.intentId&&
      change.kind===undefined&&change.plannedId===undefined&&change.observedId===undefined&&change.title===undefined,
      'GRANT_DELIVERY_INPUT','Select the original intent for an explicit placement edit.');
    const index=input.assignments.findIndex(row=>row.intentId===change.intentId);
    if(change.action==='CLEAR_PLACEMENT'){
      need(index>=0&&change.targetId===undefined&&change.note===undefined,'GRANT_DELIVERY_INPUT','Remove the explicitly selected original intent placement.');
      input.assignments.splice(index,1);
    }else{
      const row={intentId:text(change.intentId,'Original intent',500),targetId:text(change.targetId,'Original planned opportunity',700),
        note:text(change.note,'Source basis')};
      if(index<0)input.assignments.push(row);else input.assignments[index]=row;
    }
  }
  return result(input,{changes:copy(changes),previousDocument:copy(documentOf(document))},true);
}
export async function refreshGrantCohortDelivery(client,caseId,document,selection){
  const previous=inputOf(document,{editable:true}),original=await nativeSources(client,caseId,selection);
  const input={...original.input,links:copy(previous.links),assignments:copy(previous.assignments),
    title:previous.title,note:previous.note,...(previous.commercial===undefined?{}:{commercial:copy(previous.commercial)})};
  return result(input,{case:original.case,nativeSources:original.nativeSources,
    previousDocument:copy(documentOf(document))},true);
}
export function calculateCohortDelivery(document){
  const original=documentOf(document);
  return original.schema===COHORT_DELIVERY_COMPARISON_SCHEMA?reopenCohortDeliveryComparison(original):compareCohortDelivery(original);
}
export async function reviewGrantCohortDelivery(client,caseId,expectedVersion,document){
  const input=inputOf(document),comparison=compareCohortDelivery(input);
  const reviewed=await reviewGrantCohortAdoption(client,caseId,expectedVersion,comparison);
  return result(input,{case:reviewed.case,nativeSources:reviewed.nativeSources});
}
export async function prepareGrantCohortDelivery(client,caseId,body){
  const input=inputOf(body.document),document=compareCohortDelivery(input);
  return prepareGrantCohortAdoption(client,caseId,{...body,document});
}
export async function saveGrantCohortDelivery(client,prepared,expectedSha256,options){
  need(prepared?.document?.schema===COHORT_DELIVERY_COMPARISON_SCHEMA,'GRANT_DELIVERY_INPUT','Select the complete prepared recorded delivery comparison.');
  return saveGrantCohortAdoption(client,prepared,expectedSha256,options);
}
export async function inspectGrantCohortDeliveryRequest(client,prepared,expectedSha256,options){
  need(prepared?.document?.schema===COHORT_DELIVERY_COMPARISON_SCHEMA,'GRANT_DELIVERY_INPUT','Select the complete prepared recorded delivery comparison.');
  return inspectGrantCohortAdoptionRequest(client,prepared,expectedSha256,options);
}
export async function openGrantCohortDelivery(client,caseId,sourceId,expectedSourceSha256){
  const opened=await openGrantCohortAdoption(client,caseId,sourceId,expectedSourceSha256);
  const input=inputOf(opened);
  return result(input,{case:opened.case,savedSource:opened.source});
}
export function exportGrantCohortDelivery(document,format='JSON'){
  inputOf(document);
  return exportCohortAdoption(document,format);
}

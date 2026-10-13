// MIT. Immutable customer handovers over original OpenLineage service and quality records.
import {clone,canonical,digest,csv} from "./model.mjs";
export const CUSTOMER_REVIEW_DOCUMENT="commons.openlineage.customer-review-document.v1";
export const CUSTOMER_REVIEW_PREVIEW="commons.openlineage.customer-review-preview.v1";
export const CUSTOMER_REVIEW="commons.openlineage.customer-review.v1";
export class CustomerReviewError extends Error {
 constructor(message,status=400,details){super(message);this.status=status;this.details=details;}
}
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const same=(a,b)=>canonical(a)===canonical(b),HASH=/^[a-f0-9]{64}$/;
const need=(ok,message,status=400)=>{if(!ok)throw new CustomerReviewError(message,status);};
const text=(v,label,optional=false)=>{need(typeof v==="string"&&(optional||v.trim())&&!v.includes("\0"),label+" must be text"+(optional?"":" with a value"));return v;};
const exactKeys=(v,keys,label)=>{need(object(v)&&Object.keys(v).every(k=>keys.includes(k)),label+" has an unsupported field");};
const ids=(v,label)=>{need(Array.isArray(v)&&v.every(x=>typeof x==="string"&&x.trim())&&new Set(v).size===v.length,label+" must contain distinct original identities");return [...v];};
const date=(v,label)=>{need(typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v,label+" must be a real YYYY-MM-DD date");return v;};
const sorted=values=>[...values].sort((a,b)=>a<b?-1:a>b?1:0);
const byId=rows=>new Map(rows.map(x=>[x.id,x]));
const unique=rows=>{need(Array.isArray(rows)&&new Set(rows.map(x=>x.id)).size===rows.length,"Original record identities are not unique",409);return byId(rows);};
function selected(map,values,label){return values.map(id=>{const row=map.get(id);need(row,"The original "+label+" is absent: "+id,409);return clone(row);});}
export function normalizeCustomerReviewDocument(value){
 exactKeys(value,["schema","title","customer","periodStart","periodEnd","scope","narrative","recordedBy","assessmentIds","evaluationIds","comparisonIds","resultIds","supersedes"],"Customer review");
 need(value.schema===CUSTOMER_REVIEW_DOCUMENT,"Select the customer review document schema");
 const document={schema:CUSTOMER_REVIEW_DOCUMENT,title:text(value.title,"Title"),customer:text(value.customer,"Customer"),
  periodStart:date(value.periodStart,"Period start"),periodEnd:date(value.periodEnd,"Period end"),
  scope:text(value.scope,"Scope"),narrative:text(value.narrative??"","Narrative",true),recordedBy:text(value.recordedBy,"Recorded by"),
  assessmentIds:ids(value.assessmentIds??[],"Assessments"),evaluationIds:ids(value.evaluationIds??[],"Evaluations"),
  comparisonIds:ids(value.comparisonIds??[],"Comparisons"),resultIds:ids(value.resultIds??[],"Results"),supersedes:null};
 need(document.periodStart<=document.periodEnd,"The review period ends before it starts");
 need(document.assessmentIds.length+document.evaluationIds.length+document.comparisonIds.length+document.resultIds.length>0,"Select at least one original saved record");
 if(value.supersedes!==undefined&&value.supersedes!==null){
  exactKeys(value.supersedes,["id","contentSha256"],"Previous customer review");
  document.supersedes={id:text(value.supersedes.id,"Previous review identity"),contentSha256:value.supersedes.contentSha256};
  need(HASH.test(document.supersedes.contentSha256??""),"Retain the previous review SHA-256");
 }
 return document;
}
const collections=state=>({assessments:state.serviceLevels?.assessments??[],evaluations:state.quality?.evaluations??[],
 comparisons:state.qualityFollowup?.comparisons??[],results:state.results??[]});
function frozenVersion(current,value,label){
 need(current&&Array.isArray(current.history)&&Array.isArray(value.history),"Original "+label+" history is missing",409);
 const snapshots=[...current.history,(({history,...body})=>body)(current)],index=snapshots.findIndex(row=>row.version===value.version);
 need(index>=0&&same(snapshots[index],(({history,...body})=>body)(value))&&same(current.history.slice(0,index),value.history),"Original "+label+" version differs",409);
}
/** Reconstruct recorded decisions from their original committed receipts, never from today's mutable heads. */
function atRevision(state,revision){
 need(Number.isSafeInteger(revision)&&revision>=0&&revision<=state.revision,"Invalid original review revision",409);
 const current=collections(state),maps=Object.fromEntries(Object.entries(current).map(([k,v])=>[k,unique(v)]));
 const sources=unique(state.sources),editions=unique(state.editions),dispositions=unique(state.quality?.dispositions??[]),
  followups=unique(state.qualityFollowup?.followups??[]),liveIncidents=unique(state.serviceLevels?.incidents??[]);
 const retained={sources:new Map(),editions:new Map(),assessments:new Map(),evaluations:new Map(),comparisons:new Map(),results:new Map(),
  dispositions:new Map(),followups:new Map(),incidents:new Map()};
 let previous=0;
 function immutable(kind,row,available){if(!row)return;need(object(row)&&available.has(row.id)&&same(available.get(row.id),row),"Original "+kind+" receipt differs",409);retained[kind].set(row.id,clone(row));}
 for(const operation of state.operations){
  const result=operation.result;
  need(object(result)&&Number.isSafeInteger(result.revision)&&result.revision>previous,"Original operation ordering is incomplete",409);
  previous=result.revision;if(result.revision>revision)break;
  if(result.source)immutable("sources",result.source,sources);
  if(result.edition)immutable("editions",result.edition,editions);
  if(result.evaluation)immutable("evaluations",result.evaluation,maps.evaluations);
  if(result.comparison?.schema==="commons.openlineage.quality-comparison.v1")immutable("comparisons",result.comparison,maps.comparisons);
  if(result.result?.objectId)immutable("results",result.result,maps.results);
  if(result.disposition){frozenVersion(dispositions.get(result.disposition.id),result.disposition,"disposition");retained.dispositions.set(result.disposition.id,clone(result.disposition));}
  if(result.followup){frozenVersion(followups.get(result.followup.id),result.followup,"follow-up");retained.followups.set(result.followup.id,clone(result.followup));}
  if(result.assessment){
   immutable("assessments",result.assessment,maps.assessments);
   const saved=result.assessment,assessment=saved.assessment,id=saved.id,asOf=assessment.asOf;
   if(saved.appliedToIncidents){
    const findings=new Map(assessment.findings.map(row=>[row.id,row]));
    for(const incident of retained.incidents.values()){
     const finding=findings.get(incident.id),active=!!finding;
     if(incident.active!==active)incident.history.push({at:asOf,action:active?"observed-again":"condition-clear",assessmentId:id});
     incident.active=active;incident.lastAssessmentId=id;incident.lastEvaluatedAt=asOf;
     if(active){
      incident.lastSeenAt=asOf;incident.latestFinding=clone(finding);incident.lastObservedAssessmentId=id;
      if(incident.status==="resolved"){incident.status="open";incident.history.push({at:asOf,action:"reopened-by-observation",assessmentId:id});}
     }
     findings.delete(incident.id);
    }
    for(const finding of findings.values())retained.incidents.set(finding.id,{id:finding.id,policyId:finding.policyId,status:"open",active:true,owner:finding.owner,
     firstSeenAt:asOf,lastSeenAt:asOf,lastEvaluatedAt:asOf,firstAssessmentId:id,lastAssessmentId:id,lastObservedAssessmentId:id,
     originalFinding:clone(finding),latestFinding:clone(finding),history:[{at:asOf,action:"opened",assessmentId:id}]});
   }
  }
  if(result.incident){
   const row=result.incident,currentIncident=liveIncidents.get(row.id),prior=retained.incidents.get(row.id);
   need(prior&&currentIncident&&Array.isArray(row.history)&&row.history.length===prior.history.length+1&&
    same(row.history.slice(0,-1),prior.history),"The original incident decision receipt lacks its preceding history",409);
   const change=row.history.at(-1);
   need(["acknowledge","assign","resolve","accept","reopen"].includes(change.action)&&
    same(change.before,{status:prior.status,owner:prior.owner})&&same(change.after,{status:row.status,owner:row.owner})&&
    same(currentIncident.history.slice(0,row.history.length),row.history),"The original incident decision differs",409);
   const expected=clone(prior);expected.status=row.status;expected.owner=row.owner;expected.history=clone(row.history);
   need(same(expected,row),"The incident decision changed its original observation",409);retained.incidents.set(row.id,clone(row));
  }
 }
 // A valid historical cutoff is an actual native commit; the initial empty revision is zero.
 need(revision===0||state.operations.some(op=>op.result?.revision===revision),"The original committed revision is absent",409);
 if(revision===state.revision){
  for(const [kind,available]of [["incidents",liveIncidents],["dispositions",dispositions],["followups",followups]])
   need(same([...retained[kind].values()],[...available.values()]),"The current "+kind+" are not fully represented in the original operation history",409);
 }
 const sourceIds=new Set(retained.sources.keys());
 return {...state,revision,sources:[...retained.sources.values()],editions:[...retained.editions.values()],
  events:state.events.filter(row=>row.sources.some(source=>sourceIds.has(source.sourceId))).map(row=>({...clone(row),sources:row.sources.filter(source=>sourceIds.has(source.sourceId)).map(clone)})),
  results:[...retained.results.values()],serviceLevels:{...(state.serviceLevels??{}),assessments:[...retained.assessments.values()],incidents:[...retained.incidents.values()]},
  quality:{...(state.quality??{}),evaluations:[...retained.evaluations.values()],dispositions:[...retained.dispositions.values()]},
  qualityFollowup:{...(state.qualityFollowup??{}),comparisons:[...retained.comparisons.values()],followups:[...retained.followups.values()]},
  customerServiceReviews:(state.customerServiceReviews??[]).filter(row=>row.revision<=revision)};
}
function originals(state,document){
 const native=collections(state),evaluations=unique(native.evaluations),assessments=unique(native.assessments),
  comparisons=selected(unique(native.comparisons),document.comparisonIds,"comparison");
 const evaluationIds=new Set(document.evaluationIds);
 for(const comparison of comparisons){evaluationIds.add(comparison.before.id);evaluationIds.add(comparison.after.id);}
 const selectedEvaluations=selected(evaluations,sorted(evaluationIds),"evaluation");
 const chosenAssessments=selected(assessments,document.assessmentIds,"assessment"),incidentIds=new Set(chosenAssessments.flatMap(row=>row.assessment.findings.map(x=>x.id)));
 const incidents=(state.serviceLevels?.incidents??[]).filter(row=>incidentIds.has(row.id)).map(clone);
 const assessmentIds=new Set(document.assessmentIds);
 for(const row of incidents){
  for(const id of [row.firstAssessmentId,row.lastAssessmentId,row.lastObservedAssessmentId,...row.history.map(x=>x.assessmentId).filter(Boolean)])assessmentIds.add(id);
 }
 const selectedAssessments=selected(assessments,sorted(assessmentIds),"supporting assessment");
 const dispositions=(state.quality?.dispositions??[]).filter(row=>evaluationIds.has(row.evaluationId)).map(clone),
  comparisonIds=new Set(document.comparisonIds),followups=(state.qualityFollowup?.followups??[]).filter(row=>comparisonIds.has(row.comparisonId)).map(clone);
 const resultIds=new Set(document.resultIds);
 for(const row of followups)for(const version of [...row.history,row])for(const id of version.evidenceResultIds)resultIds.add(id);
 const results=selected(unique(state.results),sorted(resultIds),"evidence result"),editionIds=new Set();
 for(const row of selectedAssessments)if(row.assessment.editionId)editionIds.add(row.assessment.editionId);
 for(const row of selectedEvaluations)if(row.edition)editionIds.add(row.edition);
 for(const row of results)if(row.editionId)editionIds.add(row.editionId);
 const editions=selected(unique(state.editions),sorted(editionIds),"source edition"),sourceIds=new Set(),eventIds=new Set();
 for(const row of [...selectedAssessments.map(x=>x.assessment),...selectedEvaluations,...editions]){
  for(const id of row.sourceIds)sourceIds.add(id);for(const id of row.eventIds)eventIds.add(id);
 }
 const sources=selected(unique(state.sources),sorted(sourceIds),"source file"),events=selected(unique(state.events),sorted(eventIds),"source event")
  .map(row=>({...row,sources:row.sources.filter(source=>sourceIds.has(source.sourceId))}));
 need(events.every(row=>row.sources.length),"An original event has no retained selected source location",409);
 return {assessments:selectedAssessments,evaluations:selectedEvaluations,comparisons,incidents,dispositions,followups,editions,sources,events,results};
}
export function previewCustomerReview(state,input,{sourceRevision=state.revision}={}){
 const document=normalizeCustomerReviewDocument(input),basis=atRevision(state,sourceRevision);
 let prior=null;
 if(document.supersedes){
  prior=(basis.customerServiceReviews??[]).find(row=>row.id===document.supersedes.id);
  need(prior&&prior.contentSha256===document.supersedes.contentSha256,"The selected preceding customer review differs",409);
  need(!(basis.customerServiceReviews??[]).some(row=>row.preview.document.supersedes?.id===prior.id),"This customer review already has a successor; open that edition first",409);
 }
 const selected=originals(basis,document),counts=Object.fromEntries(Object.entries(selected).map(([key,rows])=>[key,rows.length]));
 const body={schema:CUSTOMER_REVIEW_PREVIEW,workspaceId:state.workspaceId,sourceRevision,document,originals:selected,counts,
  lineage:prior?{id:prior.lineageId,edition:prior.edition+1,previousId:prior.id,previousSha256:prior.contentSha256}:null,
  notice:"The period and narrative are operator-entered context. Selected dated assessments and evaluations keep their original scope and judgments. Incident, disposition and follow-up histories are frozen at the selected committed workspace revision. This review does not re-evaluate observations or change those decisions."};
 return {...body,previewSha256:digest(body)};
}
export function customerReviewSummary(row){
 const d=row.preview.document;
 return {id:row.id,lineageId:row.lineageId,edition:row.edition,title:d.title,customer:d.customer,
  periodStart:d.periodStart,periodEnd:d.periodEnd,recordedBy:d.recordedBy,createdAt:row.createdAt,
  sourceRevision:row.preview.sourceRevision,revision:row.revision,contentSha256:row.contentSha256,
  previewSha256:row.preview.previewSha256,supersedes:clone(d.supersedes),counts:clone(row.preview.counts)};
}
function headers(state){
 const native=collections(state);
 return {assessments:native.assessments.map(row=>({id:row.id,title:"Service assessment "+row.assessment.asOf,
  createdAt:row.createdAt,asOf:row.assessment.asOf,sha256:digest(row),assessmentSha256:row.assessmentSha256,
  findings:row.assessment.findings.length,sourceIds:clone(row.assessment.sourceIds),eventCount:row.assessment.eventIds.length})),
 evaluations:native.evaluations.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt,sha256:digest(row),contentSha256:row.contentSha256,
  datasetKey:row.datasetKey,runKey:row.runKey,findings:row.findings.length,sourceIds:clone(row.sourceIds)})),
 comparisons:native.comparisons.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt,sha256:digest(row),contentSha256:row.contentSha256,
  beforeEvaluationId:row.before.id,afterEvaluationId:row.after.id,rows:row.rows.length})),
 results:native.results.map(row=>({id:row.id,title:row.name,createdAt:row.attachedAt,sha256:digest(row),objectId:row.objectId,
  bytes:row.bytes,mediaType:row.mediaType,editionId:row.editionId,sourceReference:row.sourceReference}))};
}
const get=(state,id)=>{const row=(state.customerServiceReviews??[]).find(x=>x.id===id);need(row,"Unknown saved customer review",404);return row;};
export async function customerReviewAction(workspace,action,args={}){
 if(action==="customer-review.overview"){exactKeys(args,[],"Overview");const state=await workspace.read();return {workspaceId:state.workspaceId,revision:state.revision,
  reviews:(state.customerServiceReviews??[]).map(customerReviewSummary),choices:headers(state)};}
 if(action==="customer-review.original"){
  exactKeys(args,["kind","id","expectedSha256"],"Original selection");
  const kinds={assessment:"assessments",evaluation:"evaluations",comparison:"comparisons",result:"results"};
  need(Object.hasOwn(kinds,args.kind)&&HASH.test(args.expectedSha256??""),"Select an original record and exact SHA-256");
  const state=await workspace.read(),row=collections(state)[kinds[args.kind]].find(x=>x.id===args.id);
  need(row,"Unknown selected original record",404);need(digest(row)===args.expectedSha256,"The selected original record differs",409);
  return {workspaceId:state.workspaceId,revision:state.revision,kind:args.kind,sha256:digest(row),original:clone(row)};
 }
 if(action==="customer-review.preview"){exactKeys(args,["document"],"Preview");return previewCustomerReview(await workspace.read(),args.document);}
 if(action==="customer-review.get"){exactKeys(args,["id"],"Saved review selection");const state=await workspace.read();return {workspaceId:state.workspaceId,revision:state.revision,customerReview:clone(get(state,args.id))};}
 if(action==="customer-review.report"){exactKeys(args,["id","format"],"Saved report selection");const state=await workspace.read();return {...customerReviewReport(get(state,args.id),args.format??"json"),workspaceId:state.workspaceId,revision:state.revision,id:args.id};}
 need(action==="customer-review.save","Unknown customer review action",404);
 exactKeys(args,["operationId","expectedRevision","document","expectedPreviewSha256"],"Save");
 const document=normalizeCustomerReviewDocument(args.document);
 need(HASH.test(args.expectedPreviewSha256??""),"Retain the exact reviewed preview SHA-256");
 return workspace.change(args.operationId,{action,document,expectedPreviewSha256:args.expectedPreviewSha256},args.expectedRevision,state=>{
  const preview=previewCustomerReview(state,document);need(preview.previewSha256===args.expectedPreviewSha256,"The complete customer review preview changed; inspect it before saving",409);
  const id=digest([state.workspaceId,"customer-service-review",args.operationId]),body={schema:CUSTOMER_REVIEW,id,
   lineageId:preview.lineage?.id??id,edition:preview.lineage?.edition??1,operationId:args.operationId,
   revision:state.revision+1,createdAt:new Date().toISOString(),preview};
  const customerReview={...body,contentSha256:digest(body)};(state.customerServiceReviews??=[]).push(customerReview);
  return {customerReview:clone(customerReview)};
 });
}
export function validateCustomerReviews(state,{deep=false}={}){
 if(state.customerServiceReviews===undefined)return;
 const rows=state.customerServiceReviews;need(Array.isArray(rows),"Invalid customer review history",409);
 const seen=new Set(),operations=new Set(),successors=new Set();let lastRevision=0;
 for(const row of rows){
  need(object(row)&&row.schema===CUSTOMER_REVIEW&&!seen.has(row.id)&&!operations.has(row.operationId),"Invalid customer review identity",409);
  const {contentSha256,...body}=row,p=row.preview;
  need(HASH.test(contentSha256??"")&&digest(body)===contentSha256&&row.id===digest([state.workspaceId,"customer-service-review",row.operationId]),"Saved customer review bytes differ",409);
  need(Number.isSafeInteger(row.revision)&&row.revision>lastRevision&&row.revision<=state.revision&&
   Number.isFinite(Date.parse(row.createdAt))&&object(p)&&p.schema===CUSTOMER_REVIEW_PREVIEW&&p.workspaceId===state.workspaceId&&p.sourceRevision===row.revision-1,"Invalid customer review revision",409);
  const {previewSha256,...previewBody}=p;need(HASH.test(previewSha256??"")&&digest(previewBody)===previewSha256,"Saved customer preview differs",409);
  const document=normalizeCustomerReviewDocument(p.document);need(same(document,p.document),"Saved customer document differs",409);
  const prior=document.supersedes?rows.find(x=>x.id===document.supersedes.id):null;
  if(prior){need(seen.has(prior.id)&&!successors.has(prior.id)&&prior.contentSha256===document.supersedes.contentSha256&&
   row.lineageId===prior.lineageId&&row.edition===prior.edition+1,"Invalid customer review lineage",409);successors.add(prior.id);}
  else need(document.supersedes===null&&row.lineageId===row.id&&row.edition===1,"Invalid first customer review edition",409);
  const operation=state.operations.find(x=>x.id===row.operationId);
  need(operation&&operation.requestHash===digest({action:"customer-review.save",document,expectedPreviewSha256:previewSha256})&&
   operation.result?.workspaceId===state.workspaceId&&operation.result.revision===row.revision&&operation.result.operationId===row.operationId&&
   same(operation.result.customerReview,row),"The original customer review operation receipt differs",409);
  if(deep)need(same(previewCustomerReview(state,document,{sourceRevision:p.sourceRevision}),p),"Saved customer review differs from its original committed records",409);
  seen.add(row.id);operations.add(row.operationId);lastRevision=row.revision;
 }
}
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const detail=value=>"<pre>"+escape(JSON.stringify(value,null,2))+"</pre>";
export function customerReviewReport(review,format="json"){
 need(["json","csv","html"].includes(format),"Choose json, csv or html");
 if(format==="json")return {mediaType:"application/json",text:JSON.stringify(review,null,2)+"\n"};
 const d=review.preview.document,o=review.preview.originals;
 if(format==="csv"){
  const rows=[{kind:"customer-review",id:review.id,title:d.title,content:review}];
  for(const [kind,values]of Object.entries(o))for(const value of values)rows.push({kind,id:value.id,title:value.title??value.name??"",content:value});
  return {mediaType:"text/csv",text:csv(rows.map(row=>({...row,reviewId:review.id,reviewSha256:review.contentSha256,sourceRevision:review.preview.sourceRevision})),
   ["reviewId","reviewSha256","sourceRevision","kind","id","title","content"])};
 }
 const table=(rows,columns)=>"<div class='scroll'><table><thead><tr>"+columns.map(([name])=>"<th>"+escape(name)+"</th>").join("")+"</tr></thead><tbody>"+
  rows.map(row=>"<tr>"+columns.map(([,read])=>"<td>"+escape(read(row))+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
 const blocks=(rows,title)=>"<h2>"+escape(title)+"</h2>"+(rows.length?rows.map(row=>"<section class='record'><h3>"+escape(row.title??row.name??row.id)+"</h3>"+detail(row)+"</section>").join(""):"<p>No records selected.</p>");
 const html="<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"+
  "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>"+escape(d.title)+" — Customer service review</title>"+
  "<style>body{font:15px/1.55 system-ui,sans-serif;margin:32px auto;max-width:1140px;padding:0 22px;background:#fff;color:#202a32}h1{font-size:30px;line-height:1.2}h2{margin-top:34px;font-size:22px}h3{font-size:17px}p,dd{overflow-wrap:anywhere}.narrative{white-space:pre-wrap}dl{display:grid;grid-template-columns:180px 1fr;gap:8px 16px}dt{font-weight:650}dd{margin:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,monospace}.record{border:1px solid #bbc5cc;padding:16px;margin:16px 0;break-inside:avoid}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #c6cdd2;padding:9px;text-align:left;vertical-align:top}th{background:#edf1f3}td{overflow-wrap:anywhere}.note{border-left:4px solid #687d8d;padding:10px 16px;background:#f3f5f6}@media(max-width:600px){body{padding:0 14px;margin:20px auto}dl{display:block}dd{margin:0 0 12px}h1{font-size:25px}}@media print{body{max-width:none;margin:0}.scroll{overflow:visible}}</style></head><body>"+
  "<p>OPENLINEAGE · CUSTOMER SERVICE REVIEW · EDITION "+review.edition+"</p><h1>"+escape(d.title)+"</h1><dl>"+
  [["Customer",d.customer],["Review period",d.periodStart+" to "+d.periodEnd],["Recorded by",d.recordedBy],["Saved at",review.createdAt],
   ["Original workspace",review.preview.workspaceId],["Source revision",review.preview.sourceRevision],["Saved revision",review.revision],
   ["Review ID",review.id],["Complete review SHA-256",review.contentSha256],["Supersedes",d.supersedes?.id??"First edition"]].map(([label,value])=>"<dt>"+escape(label)+"</dt><dd>"+escape(value)+"</dd>").join("")+
  "</dl><h2>Scope</h2><p class='narrative'>"+escape(d.scope)+"</p><h2>Customer narrative</h2><p class='narrative'>"+escape(d.narrative)+"</p><p class='note'>"+escape(review.preview.notice)+"</p>"+
  "<h2>Frozen selection</h2>"+table(Object.entries(review.preview.counts).map(([kind,count])=>({kind,count})),[["Record group",r=>r.kind],["Complete records",r=>r.count]])+
  "<h2>Service observations and recorded incident decisions</h2>"+table(o.assessments,[["Assessment",r=>r.id],["As of",r=>r.assessment.asOf],["Findings",r=>r.assessment.findings.length],["Applied to incidents",r=>r.appliedToIncidents]])+
  table(o.incidents,[["Incident",r=>r.id],["Status",r=>r.status],["Observed active",r=>r.active],["Owner",r=>r.owner],["Last evaluated",r=>r.lastEvaluatedAt]])+
  "<h2>Original quality judgments</h2>"+table(o.evaluations,[["Evaluation",r=>r.title],["Dataset",r=>r.datasetKey??"All selected"],["Pass",r=>r.summary.pass],["Fail",r=>r.summary.fail],["Unknown",r=>r.summary.unknown]])+
  "<h2>Frozen follow-up</h2>"+table(o.followups,[["Finding",r=>r.afterFindingId],["Decision",r=>r.decision],["Owner",r=>r.owner],["Due date",r=>r.dueDate??""],["Reason",r=>r.reason]])+
  "<h2>Original source and evidence files</h2>"+table([...o.sources.map(r=>({id:r.id,name:r.name,bytes:r.bytes,role:"Source"})),...o.results.map(r=>({id:r.objectId,name:r.name,bytes:r.bytes,role:"Evidence"}))],
   [["Role",r=>r.role],["Original name",r=>r.name],["Bytes",r=>r.bytes],["SHA-256",r=>r.id]])+
  "<p>The complete workspace export carries these unchanged original file bytes, all earlier review editions and the application source. This printable report retains every selected record below.</p>"+
  Object.entries(o).map(([name,rows])=>blocks(rows,"Complete "+name)).join("")+"<h2>Complete saved review record</h2>"+detail(review)+"</body></html>";
 return {mediaType:"text/html",text:html};
}

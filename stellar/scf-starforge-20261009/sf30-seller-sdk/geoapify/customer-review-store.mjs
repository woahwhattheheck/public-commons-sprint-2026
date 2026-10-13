// MIT. Retained customer review operations on the original Geoapify writer.
import {resolve} from 'node:path';
import {hash,canonical,object,fail,parseJSON,text,integer,validateDecision} from './source.mjs';
import {createGeoapifyCustomerReview,CUSTOMER_REVIEW_SCHEMA} from './customer-review-core.mjs';
import {renderGeoapifyCustomerReview} from './customer-review-report.mjs';
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const core=()=>createGeoapifyCustomerReview({sha256:value=>hash(Buffer.from(value))});
const clone=value=>structuredClone(value),SCHEMA=CUSTOMER_REVIEW_SCHEMA+'.store',MAX=128*1024*1024;
const EMPTY=()=>({schema:SCHEMA,issues:[],returns:[],adoptions:[]});
const storeOf=s=>s.customerReviews===undefined?EMPTY():checkStore(s.customerReviews);
const same=(a,b)=>canonical(a)===canonical(b);
const requestId=value=>text(value,'Original customer operation request identity',160);
const requestBody=(action,input)=>{
 if(action==='customer.issue')return {action,requestId:requestId(input.requestId),editionId:text(input.editionId,'Frozen edition identity'),title:text(input.title,'Customer review title',500),recipient:text(input.recipient,'Intended customer reviewer',500)};
 const all=Object.hasOwn(input,'readyAll');
 if(all&&input.readyAll!==true||all&&Object.hasOwn(input,'resolutions')||!all&&!Array.isArray(input.resolutions))throw fail('CUSTOMER_RESOLUTION','Choose all READY decisions or explicit query resolutions.');
 return {action,requestId:requestId(input.requestId),returnId:text(input.returnId,'Original received return'),expectedPreviewSha256:text(input.expectedPreviewSha256,'Exact current preview identity',64),expectedIntakeSha256:text(input.expectedIntakeSha256,'Current intake identity',64),
  ...(all?{readyAll:true}:{resolutions:clone(input.resolutions)}),reviewer:text(input.reviewer,'Receiving reviewer',200),note:text(input.note,'Adoption reason')};
};
const selections=(request,preview)=>request.readyAll===true?preview.rows.filter(r=>r.status==='READY').map(r=>({queryId:r.queryId,choice:'customer',expectedCurrentSha256:r.currentSha256})):request.resolutions;

const page=(rows,input={})=>{const offset=integer(input.offset??0,'Offset',0,1000000),limit=integer(input.limit??25,'Limit',1,250);return {total:rows.length,offset,limit,rows:clone(rows.slice(offset,offset+limit))};};
const projectMeta=p=>{const {queries,invalidRows,duplicateIdentities,...rest}=p;return {...rest,queryCount:queries.length,invalidRowCount:invalidRows.length,duplicateIdentityCount:duplicateIdentities.length};};
function checkStore(value){
 if(!object(value)||value.schema!==SCHEMA||!['issues','returns','adoptions'].every(k=>Array.isArray(value[k])&&new Set(value[k].map(x=>x.id)).size===value[k].length))
  throw fail('CUSTOMER_STORE','Retain complete distinct issued reviews, received returns and adoptions.');
 return value;
}
export function createGeoapifyCustomerReviewStore({getState,getIntake,boundSource,read,readInput,readUncommitted,immutable,commit,currentReview}){
 const model=core(),issueCache=new Map();let previewCache=null;
 const chooseIssue=id=>{const r=storeOf(getState()).issues.find(x=>x.id===id);if(!r)throw fail('CUSTOMER_ISSUE','Choose an original issued customer review.',404);return r;};
 const chooseReturn=id=>{const r=storeOf(getState()).returns.find(x=>x.id===id);if(!r)throw fail('CUSTOMER_RETURN','Choose an original received customer return.',404);return r;};
 async function project(record){
  if(issueCache.has(record.project.sha256))return issueCache.get(record.project.sha256);
  const p=await model.inspectProject(parseJSON(await read(record.project)));issueCache.clear();issueCache.set(record.project.sha256,p);return p;
 }
 async function returned(record){return model.inspectReturn(parseJSON(await read(record.file)),await project(chooseIssue(record.issueId)));}
 async function recovery(action,input){
  if(action==='customer.receive'){
   const raw=await sourceBytes(input),value=parseJSON(raw),existing=storeOf(getState()).returns.find(x=>x.id===value.id);if(!existing)return null;
   await model.inspectReturn(value,await project(chooseIssue(existing.issueId)));if(existing.returnSha256!==value.returnSha256)throw fail('CUSTOMER_RETURN_CHANGED','That original return identity has different complete contents.',409);
   await read(existing.file);return {recovered:true,...clone(existing)};
  }
  if(!['customer.issue','customer.adopt'].includes(action)||!input.requestId)return null;
  const body=requestBody(action,input),records=action==='customer.issue'?storeOf(getState()).issues:storeOf(getState()).adoptions;
  const existing=records.find(x=>x.requestId===body.requestId);if(!existing)return null;
  if(hash(json(body))!==existing.requestBodySha256)throw fail('CUSTOMER_REQUEST_CHANGED','The original request identity already names a different operation.',409);
  await read(existing.request);return {recovered:true,...clone(existing)};
 }
 async function retainRequest(prefix,body,extra={}){
  const file=prefix+'/request.json',prior=await readUncommitted(file);
  if(prior){const context=parseJSON(prior);if(context.schema!==CUSTOMER_REVIEW_SCHEMA+'.request'||context.workspaceId!==getState().id||!Number.isSafeInteger(context.workspaceRevision)||context.workspaceRevision>getState().revision||typeof context.startedAt!=='string'||!Number.isFinite(Date.parse(context.startedAt))||new Date(context.startedAt).toISOString()!==context.startedAt||!same(context.payload,body))
    throw fail('CUSTOMER_REQUEST_CHANGED','The retained original request has different source inputs.',409);
   return {context,descriptor:{file,bytes:prior.length,sha256:hash(prior)}};
  }
  const context={schema:CUSTOMER_REVIEW_SCHEMA+'.request',workspaceId:getState().id,workspaceRevision:getState().revision,startedAt:new Date().toISOString(),payload:body,...extra};
  return {context,descriptor:await immutable(file,json(context))};
 }
 async function retainedHtml(file,draft){
  const prior=await readUncommitted(file);if(prior)return {file,bytes:prior.length,sha256:hash(prior)};
  return immutable(file,Buffer.from(await renderGeoapifyCustomerReview(draft)));
 }
 async function issue(input){
  const body=requestBody('customer.issue',input),s=getState(),edition=s.editions.find(x=>x.id===body.editionId);
  if(!edition)throw fail('EDITION','Choose a retained frozen edition.');
  const id='issue-'+hash(s.id+'\n'+body.requestId),prefix='customer-reviews/issues/'+id,original=await retainRequest(prefix,body,{edition:clone(edition),intakeSha256:boundSource(edition)});
  const intakeSha256=original.context.intakeSha256,intake=await getIntake(intakeSha256),review=parseJSON(await read(original.context.edition.review)),issuedAt=original.context.startedAt;
  const p=await model.issue({issueId:id,issuedAt,title:body.title,recipient:body.recipient,workspaceId:s.id,workspaceRevision:original.context.workspaceRevision,edition:original.context.edition,intakeSha256,intake,review});
  const draft=await model.createDraft(p),projectFile=await immutable(prefix+'/project.json',json(p)),workingFile=await immutable(prefix+'/working-review.json',json(draft));
  const html=await retainedHtml(prefix+'/review.html',draft);
  const record={id,requestId:body.requestId,createdAt:issuedAt,title:body.title,recipient:body.recipient,editionId:edition.id,intakeSha256,projectSha256:p.projectSha256,
   request:original.descriptor,requestBodySha256:hash(json(body)),project:projectFile,
   working:workingFile,html};
  await commit(next=>{next.customerReviews??=EMPTY();next.customerReviews.issues.push(record);});return clone(record);
 }
 async function sourceBytes(input){
  const hasText=typeof input.text==='string',hasPath=typeof input.path==='string';if(hasText===hasPath)throw fail('CUSTOMER_RETURN','Choose one complete returned JSON file or text.');
  if(hasText){const raw=Buffer.from(input.text);if(raw.length>MAX)throw fail('CUSTOMER_LIMIT','The complete return exceeds128MiB.');return raw;}
  return readInput(resolve(text(input.path,'Original returned review path')),MAX);
 }
 async function receive(input){
  const raw=await sourceBytes(input),value=parseJSON(raw),original=chooseIssue(value.issueId);await model.inspectReturn(value,await project(original));
  const existing=storeOf(getState()).returns.find(x=>x.id===value.id);
  if(existing){if(existing.returnSha256!==value.returnSha256)throw fail('CUSTOMER_RETURN_CHANGED','That original return identity has different complete contents.',409);await read(existing.file);return {recovered:true,...clone(existing)};}
  const prefix='customer-reviews/returns/'+hash(value.id),record={id:value.id,issueId:original.id,receivedAt:new Date().toISOString(),returnedAt:value.returnedAt,reviewer:value.reviewer,note:value.note,
   projectSha256:value.projectSha256,returnSha256:value.returnSha256,choiceCount:Object.keys(value.draft.choices).length,draftRevision:value.draft.revision,
   file:await immutable(prefix+'/return.json',raw)};
  await commit(next=>{next.customerReviews??=EMPTY();next.customerReviews.returns.push(record);});return clone(record);
 }
 async function fullPreview(id){
  const s=getState(),record=chooseReturn(id),key=s.revision+':'+record.returnSha256;
  if(previewCache?.key===key)return previewCache.value;
  const p=await project(chooseIssue(record.issueId)),value=await returned(record),current=await currentReview();
  const preview=await model.previewReturn({project:p,returned:value,currentReview:current,currentIntakeSha256:s.intake?.sha256??null});
  previewCache={key,value:preview};return preview;
 }
 async function preview(input){
  const value=await fullPreview(input.returnId);let rows=value.rows;if(input.status)rows=rows.filter(x=>x.status===input.status);
  const {rows:all,...meta}=value;const selected=page(rows,input);return {...clone(meta),rows:selected.rows,page:{total:selected.total,offset:selected.offset,limit:selected.limit}};
 }
 async function adopt(input){
  const body=requestBody('customer.adopt',input),preview=await fullPreview(body.returnId);
  if(body.expectedIntakeSha256!==getState().intake?.sha256)throw fail('INTAKE_CHANGED','The active original customer source changed.',409);
  if(body.expectedPreviewSha256!==preview.previewSha256)throw fail('CUSTOMER_PREVIEW_CHANGED','The current merchant review changed. Reopen the full return preview.',409);
  const resolved=await model.resolveReturn({preview,resolutions:selections(body,preview),reviewer:body.reviewer,note:body.note});
  const current=await currentReview(),byId=new Map(current.rows.map(x=>[x.id,x])),intakeSha256=getState().intake?.sha256;
  const id='adoption-'+hash(getState().id+'\n'+body.requestId),prefix='customer-reviews/adoptions/'+id,original=await retainRequest(prefix,body),at=original.context.startedAt;
  const decisions=resolved.decisions.map(d=>{
   if(d.expectedIntakeSha256!==intakeSha256)throw fail('INTAKE_CHANGED','The active original customer source changed.',409);
   const row=byId.get(d.queryId);if(!row||row.responseSha256!==d.expectedResponseSha256)throw fail('REVIEW_CHANGED','The original response changed, including a keep-source decision.',409);
   return {...validateDecision({review:{rows:[row]},...d}),at,intakeSha256,customerReview:d.customerReview};
  });
  const result={...resolved,id,requestId:body.requestId,at,intakeSha256,decisions},record={id,requestId:body.requestId,createdAt:at,issueId:resolved.issueId,returnId:resolved.returnId,projectSha256:resolved.projectSha256,
   returnSha256:resolved.returnSha256,previewSha256:resolved.previewSha256,intakeSha256,decisionCount:decisions.length,resolutionCount:resolved.resolutions.length,
   request:original.descriptor,requestBodySha256:hash(json(body)),preview:await immutable(prefix+'/preview.json',json(preview)),result:await immutable(prefix+'/adoption.json',json(result))};
  await commit(next=>{next.customerReviews??=EMPTY();next.decisions.push(...decisions);next.customerReviews.adoptions.push(record);});return clone(record);
 }
 async function exported(input){
  const issue=chooseIssue(input.issueId),p=await project(issue);let draft=await model.inspectDraft(parseJSON(await read(issue.working))),value=null;
  if(input.returnId){const record=chooseReturn(input.returnId);if(record.issueId!==issue.id)throw fail('CUSTOMER_RETURN','Choose a return from this issued review.');value=await returned(record);draft=value.draft;}
  const id='customer-'+hash(issue.id+'\n'+(value?.returnSha256??p.projectSha256)),prefix='exports/'+id,prior=getState().exports.find(x=>x.id===id);
  if(prior){for(const item of prior.files)await read({...item,file:prefix+'/'+item.name});return clone(prior);}
  let returnedHtml=null;
  if(value){const original=chooseReturn(value.id);returnedHtml=original.html??await retainedHtml('customer-reviews/returns/'+hash(value.id)+'/review.html',draft);}
  const values={'customer-review-project.json':await read(issue.project),'customer-review.json':json(draft),
   'customer-review.html':returnedHtml?await read(returnedHtml):await read(issue.html)};
  if(value)values['customer-review-return.json']=await read(chooseReturn(input.returnId).file);
  const files=[];
  for(const [name,bytes] of Object.entries(values)){const d=await immutable(prefix+'/'+name,bytes);files.push({name,bytes:d.bytes,sha256:d.sha256});}
  const record={id,createdAt:new Date().toISOString(),issueId:issue.id,returnId:value?.id??null,projectSha256:p.projectSha256,files};
  await commit(next=>{next.exports.push(record);if(value)next.customerReviews.returns.find(x=>x.id===value.id).html=returnedHtml;});return clone(record);
 }
 async function inspect(input){
  const issue=chooseIssue(input.issueId),p=await project(issue);const selected=page(p.queries,input),result={issue:clone(issue),project:{...clone(projectMeta(p)),queries:selected.rows,queriesPage:{total:selected.total,offset:selected.offset,limit:selected.limit}}};
  if(input.returnId){const record=chooseReturn(input.returnId);if(record.issueId!==issue.id)throw fail('CUSTOMER_RETURN','Choose the original issue for this return.');
   const value=await returned(record);result.return=clone(record);result.customer={reviewer:value.reviewer,note:value.note,revision:value.draft.revision,editor:clone(value.draft.editor),choiceCount:Object.keys(value.draft.choices).length,historyEvents:value.draft.history.length};
   result.project.queries=result.project.queries.map(row=>({...row,customerChoice:clone(value.draft.choices[row.queryId]??null),workingForm:clone(value.draft.forms[row.queryId]??null)}));
  }
  return result;
 }
 async function act(action,input={}){
  if(action==='customer.list'){const kind=input.kind??'issues';if(!['issues','returns','adoptions'].includes(kind))throw fail('CUSTOMER_LIST','Choose issues, returns or adoptions.');let rows=storeOf(getState())[kind];if(input.issueId)rows=rows.filter(x=>x.id===input.issueId||x.issueId===input.issueId);const selected=page(rows,input);return {kind,rows:selected.rows,page:{total:selected.total,offset:selected.offset,limit:selected.limit}};}
  if(action==='customer.inspect')return inspect(input);
  if(action==='customer.issue')return issue(input);
  if(action==='customer.receive')return receive(input);
  if(action==='customer.preview')return preview(input);
  if(action==='customer.adopt')return adopt(input);
  if(action==='customer.export')return exported(input);
  throw fail('CUSTOMER_ACTION','Choose an original customer review action.');
 }
 function descriptors(){const s=storeOf(getState());return [...s.issues.flatMap(x=>[x.request,x.project,x.working,x.html]),...s.returns.flatMap(x=>[x.file,...(x.html?[x.html]:[])]),...s.adoptions.flatMap(x=>[x.request,x.preview,x.result])];}
 function summary(){const s=storeOf(getState());return {issues:s.issues.length,returns:s.returns.length,adoptions:s.adoptions.length};}
 function reset(){issueCache.clear();previewCache=null;}
 return {act,recovery,descriptors,summary,reset};
}
export async function inspectGeoapifyCustomerReviewHistory({saved,check,sourceIntakes,boundSource}){
 if(saved.customerReviews===undefined)return;
 const data=checkStore(saved.customerReviews),model=core(),projects=new Map(),returns=new Map();
 for(const issue of data.issues){
  const p=await model.inspectProject(parseJSON(check(issue.project))),edition=saved.editions.find(e=>e.id===issue.editionId),intake=sourceIntakes.get(issue.intakeSha256);
  if(!edition||!intake||p.workspaceId!==saved.id||p.workspaceRevision>saved.revision||p.id!==issue.id||p.projectSha256!==issue.projectSha256||p.intakeSha256!==issue.intakeSha256||boundSource(edition)!==p.intakeSha256)
   throw fail('CUSTOMER_PACKAGE','The issued customer review has a different original source.');
  const old={...p.edition},current={...edition};delete old.comparisonReport;delete current.comparisonReport;
  if(!same(old,current)||p.edition.comparisonReport&&!same(p.edition.comparisonReport,edition.comparisonReport))throw fail('CUSTOMER_PACKAGE','The issued edition differs from its original frozen files.');
  const expected=await model.issue({issueId:p.id,issuedAt:p.issuedAt,title:p.title,recipient:p.recipient,workspaceId:p.workspaceId,workspaceRevision:p.workspaceRevision,edition:p.edition,intakeSha256:p.intakeSha256,intake,review:parseJSON(check(edition.review))});
  if(expected.projectSha256!==p.projectSha256)throw fail('CUSTOMER_PACKAGE','Issued query groups differ from the original frozen source and review.');
  const context=parseJSON(check(issue.request)),request=context.payload;if(context.schema!==CUSTOMER_REVIEW_SCHEMA+'.request'||context.workspaceId!==saved.id||context.startedAt!==p.issuedAt||context.workspaceRevision!==p.workspaceRevision||!same(context.edition,p.edition)||context.intakeSha256!==p.intakeSha256||hash(json(request))!==issue.requestBodySha256||request.action!=='customer.issue'||request.requestId!==issue.requestId||request.editionId!==p.edition.id||request.title!==p.title||request.recipient!==p.recipient)throw fail('CUSTOMER_PACKAGE','The original issue request differs.');
  const draft=await model.inspectDraft(parseJSON(check(issue.working)));if(!same(draft.project,p)||draft.revision!==0)throw fail('CUSTOMER_PACKAGE','The original issued working copy changed.');
  check(issue.html);projects.set(issue.id,p);
 }
 for(const record of data.returns){const p=projects.get(record.issueId);if(!p)throw fail('CUSTOMER_PACKAGE','A customer return has no original issued review.');
  const value=await model.inspectReturn(parseJSON(check(record.file)),p);if(value.id!==record.id||value.returnSha256!==record.returnSha256)throw fail('CUSTOMER_PACKAGE','The retained customer return identity differs.');if(record.html)check(record.html);returns.set(record.id,value);}
 const adopted=[];
 for(const record of data.adoptions){
  const original=returns.get(record.returnId),p=projects.get(record.issueId),context=parseJSON(check(record.request)),request=context.payload,preview=parseJSON(check(record.preview)),result=parseJSON(check(record.result));
  if(!original||!p||context.schema!==CUSTOMER_REVIEW_SCHEMA+'.request'||context.workspaceId!==saved.id||context.startedAt!==result.at||hash(json(request))!==record.requestBodySha256||request.action!=='customer.adopt'||request.requestId!==record.requestId||request.returnId!==record.returnId||request.expectedPreviewSha256!==record.previewSha256||request.expectedIntakeSha256!==preview.currentIntakeSha256||
    preview.returnSha256!==original.returnSha256||preview.projectSha256!==p.projectSha256||preview.previewSha256!==record.previewSha256||result.id!==record.id||result.requestId!==record.requestId)
   throw fail('CUSTOMER_PACKAGE','An adoption differs from its original request, issue or return.');
  const rebuilt=await model.previewReturn({project:p,returned:original,currentIntakeSha256:preview.currentIntakeSha256,currentReview:{rows:preview.rows.filter(r=>r.currentQueryPresent).map(r=>({id:r.queryId,params:r.currentParams,responseSha256:r.currentResponseSha256,candidates:r.currentCandidates,decision:r.currentDecision,decisionCurrent:r.currentDecisionCurrent}))}});
  if(!same(rebuilt,preview))throw fail('CUSTOMER_PACKAGE','The adoption preview differs from its complete original baseline and customer choices.');
  const resolution=await model.resolveReturn({preview,resolutions:selections(request,preview),reviewer:request.reviewer,note:request.note});
  if(!same(resolution.resolutions,result.resolutions)||!Array.isArray(result.decisions)||result.decisions.length!==resolution.decisions.length)throw fail('CUSTOMER_PACKAGE','An adoption has different retained resolutions.');
  for(let i=0;i<result.decisions.length;i++){const d=result.decisions[i],wanted=resolution.decisions[i];if(!same(d.customerReview,wanted.customerReview)||d.queryId!==wanted.queryId||d.action!==wanted.action||d.candidateId!==wanted.candidateId||d.coordinateChoice!==wanted.coordinateChoice||d.responseSha256!==wanted.expectedResponseSha256||d.intakeSha256!==wanted.expectedIntakeSha256||d.reviewer!==wanted.reviewer||d.note!==wanted.note)throw fail('CUSTOMER_PACKAGE','An adopted decision differs from its original resolved customer choice.');adopted.push(d);}
 }
 for(const decision of adopted)if(!saved.decisions.some(d=>same(d,decision)))throw fail('CUSTOMER_PACKAGE','A retained adoption is missing its original native decision.');
 for(const d of saved.decisions.filter(d=>d.customerReview))if(!adopted.some(a=>same(a,d)))throw fail('CUSTOMER_PACKAGE','A customer decision has no original retained adoption.');
}

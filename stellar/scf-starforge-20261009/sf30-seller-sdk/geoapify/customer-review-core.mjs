// MIT. Universal source-bound Geoapify customer review, unchanged in native and offline use.
export const CUSTOMER_REVIEW_SCHEMA='stellar-forge.geoapify-customer-review.v1';
const HEX=/^[a-f0-9]{64}$/,QUERY=/^q_[a-f0-9]{64}$/,MAX=128*1024*1024;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x)),now=()=>new Date().toISOString();
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':object(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const equal=(a,b)=>canonical(a)===canonical(b);
function fail(code,message){throw Object.assign(new Error(message),{code:'GEOAPIFY_CUSTOMER_'+code,status:code==='CONTEXT_CHANGED'||code==='PREVIEW_CHANGED'?409:422});}
function need(ok,code,message){if(!ok)fail(code,message);}
function text(v,label,max=4000){need(typeof v==='string'&&v.trim()&&v.length<=max,'SHAPE','Retain '+label+'.');return v;}
function identity(v,label){return text(v,label,160);}
function date(v){need(typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,'SHAPE','Retain an exact UTC operation time.');return v;}
function utf8Bytes(s){let n=0;for(const c of s){const p=c.codePointAt(0);n+=p<=127?1:p<=2047?2:p<=65535?3:4;}return n;}
function bounded(v,label,max=MAX){const s=JSON.stringify(v);need(typeof s==='string'&&utf8Bytes(s)<=max,'LIMIT','Retain the complete '+label+' within '+max+' UTF-8 bytes.');return v;}
function freeze(value){if((object(value)||Array.isArray(value))&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function actionShape(v){need(object(v)&&['accept','keep-source'].includes(v.action),'CHOICE','Choose accept or keep-source.');need(['preserve-source','fill-missing','use-provider'].includes(v.coordinateChoice),'CHOICE','Choose an explicit coordinate policy.');text(v.reviewer,'the attributed reviewer',200);text(v.note,'the review reason');return v;}
function semantic(d){if(!d)return null;return {action:d.action,candidateId:d.candidateId??null,responseSha256:d.responseSha256??null,coordinateChoice:d.coordinateChoice,reviewer:d.reviewer,note:d.note};}
function decisionState(d,current=true){return {decision:d??null,current:Boolean(d&&current)};}
function queryContext(q){return {queryId:q.queryId,params:q.params,responseSha256:q.responseSha256,candidates:q.candidates};}
function copyDraft(d){return {...d,project:d.project,choices:{...d.choices},forms:{...d.forms},editor:d.editor,history:[...d.history]};}
export function createGeoapifyCustomerReview({sha256}={}){
 need(typeof sha256==='function','HASH','Supply the original SHA-256 implementation.');
 const trusted=new WeakSet(),trustedDrafts=new WeakSet(),queryIndexes=new WeakMap(),draftSizes=new WeakMap();
 const size=value=>utf8Bytes(JSON.stringify(value));
 const retainDraft=(d,previous=null)=>{
  let bytes;
  if(previous&&draftSizes.has(previous)){
   bytes=draftSizes.get(previous)+size(d.choices)-size(previous.choices)+size(d.forms)-size(previous.forms)+size(d.editor)-size(previous.editor)+String(d.revision).length-String(previous.revision).length;
   for(let i=previous.history.length;i<d.history.length;i++)bytes+=size(d.history[i])+(i?1:0);
  }else bytes=size(d);
  need(bytes<=MAX-65536,'LIMIT','Retain the complete customer working review within '+MAX+' UTF-8 bytes. Save the current original before reducing optional raw form content.');draftSizes.set(d,bytes);freeze(d);trustedDrafts.add(d);return d;
 };
 async function hash(v){const r=await sha256(typeof v==='string'?v:canonical(v));need(typeof r==='string'&&HEX.test(r),'HASH','Return the full SHA-256 hex identity.');return r;}
 async function inspectProject(project){
  need(object(project)&&project.schema===CUSTOMER_REVIEW_SCHEMA+'.project','PROJECT','Open an original issued customer review.');
  if(trusted.has(project))return project;
  bounded(project,'issued review');identity(project.id,'the issued review identity');date(project.issuedAt);text(project.title,'the review title',500);text(project.recipient,'the intended customer reviewer',500);
  identity(project.workspaceId,'the original workspace');need(Number.isSafeInteger(project.workspaceRevision)&&project.workspaceRevision>=0,'PROJECT','Retain the original workspace revision.');
  need(HEX.test(project.intakeSha256)&&object(project.edition)&&typeof project.edition.id==='string'&&HEX.test(project.projectSha256),'PROJECT','Retain the frozen edition, intake and issued-review identities.');
  need(object(project.source)&&object(project.mapping)&&Array.isArray(project.queries)&&project.queries.length<=1000000&&Array.isArray(project.invalidRows)&&Array.isArray(project.duplicateIdentities),'PROJECT','Retain the complete original source and grouped rows.');
  const ids=new Set(),ordinals=new Set();
  for(const q of project.queries){
   need(object(q)&&QUERY.test(q.queryId)&&!ids.has(q.queryId)&&object(q.params)&&Array.isArray(q.sourceRows)&&q.sourceRows.length&&Array.isArray(q.candidates)&&typeof q.baselineDecisionCurrent==='boolean','PROJECT','Retain distinct complete original query groups.');ids.add(q.queryId);
   need(q.responseSha256===null||HEX.test(q.responseSha256),'PROJECT','Retain the original response identity.');
   for(const r of q.sourceRows){need(object(r)&&r.queryId===q.queryId&&Number.isSafeInteger(r.ordinal)&&r.ordinal>=0&&!ordinals.has(r.ordinal),'PROJECT','Retain every distinct original source row in its query.');ordinals.add(r.ordinal);}
   const candidates=new Set();for(const c of q.candidates){need(object(c)&&typeof c.id==='string'&&!candidates.has(c.id),'PROJECT','Retain distinct original candidates.');candidates.add(c.id);}
   need(q.baselineDecision===null||object(q.baselineDecision),'PROJECT','Retain the issued baseline decision.');
  }
  for(const r of project.invalidRows){need(object(r)&&!r.queryId&&Number.isSafeInteger(r.ordinal)&&r.ordinal>=0&&!ordinals.has(r.ordinal),'PROJECT','Retain every original invalid row.');ordinals.add(r.ordinal);}
  need(project.originalRowCount===ordinals.size,'PROJECT','Retain the complete original row count.');
  const {projectSha256,...body}=project;need(await hash(body)===projectSha256,'PROJECT_CHANGED','The issued review differs from its complete source identity.');
  freeze(project);trusted.add(project);queryIndexes.set(project,new Map(project.queries.map(q=>[q.queryId,q])));return project;
 }
 async function issue({issueId,issuedAt=now(),title,recipient,workspaceId,workspaceRevision,edition,intakeSha256,intake,review}){
  need(object(intake)&&Array.isArray(intake.rows)&&object(review)&&Array.isArray(review.rows),'PROJECT','Retain the complete original intake and frozen review.');
  const grouped=new Map();for(const r of intake.rows){if(!r.queryId)continue;const a=grouped.get(r.queryId)||[];a.push(r);grouped.set(r.queryId,a);}
  const queries=review.rows.map(r=>({queryId:r.id,params:clone(r.params),sourceRows:clone(grouped.get(r.id)||[]),responseSha256:r.responseSha256??null,
   candidates:clone(r.candidates),baselineDecision:clone(r.decision??null),baselineDecisionCurrent:Boolean(r.decisionCurrent),state:r.state,providerStatus:r.providerStatus,error:clone(r.error??null),inheritedFrom:clone(r.inheritedFrom??null)}));
  const body={schema:CUSTOMER_REVIEW_SCHEMA+'.project',id:issueId,issuedAt,title,recipient,workspaceId,workspaceRevision,intakeSha256,edition:clone(edition),
   source:clone(intake.source),mapping:clone(intake.mapping),originalRowCount:intake.rows.length,queries,invalidRows:clone(intake.rows.filter(r=>!r.queryId)),duplicateIdentities:clone(intake.duplicateIdentities??[])};
  return inspectProject({...body,projectSha256:await hash(body)});
 }
 function row(project,id){const q=queryIndexes.get(project)?.get(id);need(q,'QUERY','Choose a query from this issued review.');return q;}
 function workingShape(project,editor,forms){need(object(editor)&&object(forms),'DRAFT','Retain complete raw editor and query forms.');if(editor.queryId!=null)row(project,editor.queryId);for(const [id,value] of Object.entries(forms)){row(project,id);need(object(value),'DRAFT','Retain the complete raw query form.');}bounded({editor,forms},'working forms',16*1024*1024);}
 function validateChoice(project,v){
  actionShape(v);const q=row(project,v.queryId);
  need(v.projectSha256===project.projectSha256&&v.intakeSha256===project.intakeSha256&&v.responseSha256===q.responseSha256,'CONTEXT_CHANGED','Reopen the exact issued source and response before choosing.');
  const c=v.action==='accept'?q.candidates.find(c=>c.id===v.candidateId):null;
  need(v.action!=='accept'||c?.location,'CHOICE','Select an original candidate with usable coordinates.');
  need(v.action!=='keep-source'||v.candidateId===null&&v.coordinateChoice==='preserve-source','CHOICE','Keep-source preserves the original coordinate policy.');date(v.at);return v;
 }
 async function createDraft(project){
  project=await inspectProject(project);return retainDraft({schema:CUSTOMER_REVIEW_SCHEMA+'.draft',project,revision:0,choices:{},forms:{},editor:{queryId:null,reviewer:'',note:''},history:[]});
 }
 async function inspectDraft(draft){
  need(object(draft)&&draft.schema===CUSTOMER_REVIEW_SCHEMA+'.draft','DRAFT','Open the complete original customer working review.');if(trustedDrafts.has(draft))return draft;bounded(draft,'customer working review');
  await inspectProject(draft.project);need(Number.isSafeInteger(draft.revision)&&draft.revision>=0&&object(draft.choices)&&object(draft.forms)&&object(draft.editor)&&Array.isArray(draft.history)&&draft.history.length===draft.revision,'DRAFT','Retain complete choices, unfinished forms and original history.');
  workingShape(draft.project,draft.editor,draft.forms);
  let choices={},forms={},editor={queryId:null,reviewer:'',note:''};
  for(let i=0;i<draft.history.length;i++){
   const h=draft.history[i];need(object(h)&&h.revision===i+1&&h.projectSha256===draft.project.projectSha256,'HISTORY','Retain the complete ordered history for this issued review.');date(h.at);
   if(h.type==='working'){need(object(h.formChanges)&&(!own(h,'editor')||object(h.editor)),'HISTORY','Retain original changed working fields.');
    for(const [id,value] of Object.entries(h.formChanges)){row(draft.project,id);need(value===null||object(value),'HISTORY','Retain a complete changed form or explicit removal.');if(value===null)delete forms[id];else forms[id]=value;}
    if(own(h,'editor')){if(h.editor.queryId!=null)row(draft.project,h.editor.queryId);editor=h.editor;}
   }
   else if(h.type==='choice'){validateChoice(draft.project,h.choice);need(h.at===h.choice.at,'HISTORY','Retain the original choice time.');choices[h.choice.queryId]=h.choice;}
   else if(h.type==='clear'){row(draft.project,h.queryId);text(h.reviewer,'the reviewer clearing a choice',200);text(h.note,'the clear reason');delete choices[h.queryId];}
   else fail('HISTORY','Retain an original working, choice or clear event.');
  }
  for(const [id,v] of Object.entries(draft.choices)){need(id===v?.queryId,'DRAFT','Retain choices under their original queries.');validateChoice(draft.project,v);}
  need(equal(choices,draft.choices)&&equal(forms,draft.forms)&&equal(editor,draft.editor),'HISTORY','The working review differs from its retained action history.');return retainDraft(draft);
 }
 async function saveWorking(draft,{editor,forms,at=now()}){
  await inspectDraft(draft);workingShape(draft.project,editor,forms);date(at);
  const formChanges={};for(const id of new Set([...Object.keys(draft.forms),...Object.keys(forms)])){if(!own(forms,id))formChanges[id]=null;else if(!equal(forms[id],draft.forms[id]))formChanges[id]=clone(forms[id]);}
  const changedEditor=!equal(editor,draft.editor);if(!Object.keys(formChanges).length&&!changedEditor)return draft;
  const next=copyDraft(draft);for(const [id,v]of Object.entries(formChanges)){if(v===null)delete next.forms[id];else next.forms[id]=v;}
  if(changedEditor)next.editor=clone(editor);next.revision++;
  next.history.push({type:'working',revision:next.revision,projectSha256:next.project.projectSha256,at,formChanges,...(changedEditor?{editor:next.editor}:{})});return retainDraft(next,draft);
 }
 async function setChoice(draft,{queryId,action,candidateId=null,coordinateChoice='preserve-source',reviewer,note,at=now()}){
  await inspectDraft(draft);const q=row(draft.project,queryId),choice={queryId,action,candidateId:action==='keep-source'?null:candidateId,responseSha256:q.responseSha256,
   coordinateChoice:action==='keep-source'?'preserve-source':coordinateChoice,reviewer,note,at,projectSha256:draft.project.projectSha256,intakeSha256:draft.project.intakeSha256};
  validateChoice(draft.project,choice);const next=copyDraft(draft);next.choices[queryId]=choice;next.revision++;next.history.push({type:'choice',revision:next.revision,projectSha256:next.project.projectSha256,at,choice});return retainDraft(next,draft);
 }
 async function clearChoice(draft,{queryId,reviewer,note,at=now()}){
  await inspectDraft(draft);row(draft.project,queryId);text(reviewer,'the reviewer clearing a choice',200);text(note,'the clear reason');
  const next=copyDraft(draft);delete next.choices[queryId];next.revision++;next.history.push({type:'clear',revision:next.revision,projectSha256:next.project.projectSha256,at:date(at),queryId,reviewer,note});return retainDraft(next,draft);
 }
 async function createReturn(draft,{returnId,returnedAt=now(),reviewer,note}){
  await inspectDraft(draft);need(Object.keys(draft.choices).length>0,'RETURN_EMPTY','Choose at least one attributed query decision before returning the review.');identity(returnId,'the customer return identity');date(returnedAt);text(reviewer,'the returning reviewer',200);text(note,'the return note');
  const body={schema:CUSTOMER_REVIEW_SCHEMA+'.return',id:returnId,returnedAt,reviewer,note,projectSha256:draft.project.projectSha256,issueId:draft.project.id,draft:clone(draft)};
  bounded(body,'complete customer return');return {...body,returnSha256:await hash(body)};
 }
 async function inspectReturn(returned,project){
  need(object(returned)&&returned.schema===CUSTOMER_REVIEW_SCHEMA+'.return'&&HEX.test(returned.returnSha256),'RETURN','Receive the complete original customer return.');
  bounded(returned,'customer return');identity(returned.id,'the return identity');date(returned.returnedAt);text(returned.reviewer,'the returning reviewer',200);text(returned.note,'the return note');
  project=await inspectProject(project);await inspectDraft(returned.draft);
  need(returned.issueId===project.id&&returned.projectSha256===project.projectSha256&&returned.draft.project.projectSha256===project.projectSha256&&equal(returned.draft.project,project),'RETURN_CHANGED','The return belongs to a different issued source or review.');
  const {returnSha256,...body}=returned;need(await hash(body)===returnSha256,'RETURN_CHANGED','The returned review differs from its complete identity.');return returned;
 }
 async function previewReturn({project,returned,currentReview,currentIntakeSha256}){
  project=await inspectProject(project);await inspectReturn(returned,project);need(object(currentReview)&&Array.isArray(currentReview.rows),'REVIEW','Retain the full current native review.');
  const current=new Map(currentReview.rows.map(r=>[r.id,r])),rows=[],counts={};
  for(const q of project.queries){
   const c=current.get(q.queryId),choice=returned.draft.choices[q.queryId]??null,baseline=decisionState(q.baselineDecision,q.baselineDecisionCurrent),
    currentValue=decisionState(c?.decision??null,c?.decisionCurrent??false),context={intakeSha256:currentIntakeSha256,query:c?queryContext({queryId:c.id,...c}):null,decision:currentValue};
   const currentSha256=await hash(context);let status='NO_CUSTOMER_CHOICE';
   const sourceCurrent=currentIntakeSha256===project.intakeSha256,contextCurrent=Boolean(c&&equal(queryContext(q),queryContext({queryId:c.id,...c})));
   if(choice){if(!sourceCurrent)status='SOURCE_CHANGED';else if(!contextCurrent)status='RESPONSE_CHANGED';else if(equal(semantic(choice),semantic(c.decision))&&c.decisionCurrent)status='ALREADY_CURRENT';else if(equal(baseline,currentValue))status='READY';else status='CONFLICT';}
   counts[status]=(counts[status]??0)+1;rows.push({queryId:q.queryId,sourceRows:q.sourceRows,params:q.params,baselineDecision:q.baselineDecision,baselineDecisionCurrent:q.baselineDecisionCurrent,
    currentQueryPresent:Boolean(c),currentParams:c?.params??null,currentDecision:c?.decision??null,currentDecisionCurrent:Boolean(c?.decisionCurrent),customerChoice:choice,issuedResponseSha256:q.responseSha256,currentResponseSha256:c?.responseSha256??null,
    issuedCandidates:q.candidates,currentCandidates:c?.candidates??[],currentSha256,status,canChooseCustomer:Boolean(choice&&sourceCurrent&&contextCurrent)});
  }
  const body={schema:CUSTOMER_REVIEW_SCHEMA+'.preview',issueId:project.id,projectSha256:project.projectSha256,returnId:returned.id,returnSha256:returned.returnSha256,
   intakeSha256:project.intakeSha256,currentIntakeSha256,counts,rows};
  return {...body,previewSha256:await hash(body)};
 }
 async function resolveReturn({preview,resolutions,reviewer,note}){
  need(object(preview)&&preview.schema===CUSTOMER_REVIEW_SCHEMA+'.preview'&&HEX.test(preview.previewSha256),'PREVIEW','Use the complete current return preview.');
  const {previewSha256,...body}=preview;need(await hash(body)===previewSha256,'PREVIEW_CHANGED','The reviewed current preview changed.');
  text(reviewer,'the native receiving reviewer',200);text(note,'the adoption reason');need(Array.isArray(resolutions)&&resolutions.length>0,'RESOLUTION','Choose explicit query resolutions.');
  const byId=new Map(preview.rows.map(r=>[r.queryId,r])),seen=new Set(),decisions=[],resolved=[];
  for(const r of resolutions){need(object(r)&&QUERY.test(r.queryId)&&!seen.has(r.queryId)&&['customer','current','skip'].includes(r.choice),'RESOLUTION','Choose each original query resolution once.');seen.add(r.queryId);
   const row=byId.get(r.queryId);need(row?.customerChoice,'RESOLUTION','Resolve a query with an explicit returned customer choice.');
   need(r.expectedCurrentSha256===row.currentSha256,'CONTEXT_CHANGED','Refresh and explicitly resolve the actual current query state.');
   if(r.choice==='customer'){need(row.canChooseCustomer,'CONTEXT_CHANGED','The source or response changed; reopen the original source or issue a new exact review.');const c=row.customerChoice;
    decisions.push({queryId:c.queryId,action:c.action,candidateId:c.candidateId,coordinateChoice:c.coordinateChoice,reviewer:c.reviewer,note:c.note,expectedResponseSha256:c.responseSha256,expectedIntakeSha256:preview.intakeSha256,
     customerReview:{issueId:preview.issueId,projectSha256:preview.projectSha256,returnId:preview.returnId,returnSha256:preview.returnSha256,customerAt:c.at,receivingReviewer:reviewer,receivingNote:note}});
   }
   resolved.push({queryId:r.queryId,choice:r.choice,expectedCurrentSha256:r.expectedCurrentSha256,status:row.status,customerChoice:clone(row.customerChoice),baselineDecision:clone(row.baselineDecision),currentDecision:clone(row.currentDecision)});
  }
  return {schema:CUSTOMER_REVIEW_SCHEMA+'.resolution',issueId:preview.issueId,returnId:preview.returnId,projectSha256:preview.projectSha256,returnSha256:preview.returnSha256,previewSha256,reviewer,note,resolutions:resolved,decisions};
 }
 return Object.freeze({issue,inspectProject,createDraft,inspectDraft,saveWorking,setChoice,clearChoice,createReturn,inspectReturn,previewReturn,resolveReturn});
}

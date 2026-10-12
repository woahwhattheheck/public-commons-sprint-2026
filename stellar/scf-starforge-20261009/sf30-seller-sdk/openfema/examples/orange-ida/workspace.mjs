// MIT. Location-level source reconciliation joined to the original OpenFEMA portfolio.
import {stable,decimalMinor,formatMinor,csv} from '../../domain.mjs';
import {sha256Utf8,sha256Bytes} from './sha256.mjs';
export const SCHEMA='stellar-forge.orange-ida-review-workspace.v1';
export const STATES=['open','source_needed','engineer_review','review_recorded','completed'];
export const DISPOSITIONS=['unresolved','same_scope','changed_scope','separate_funding','completed','outside_assignment'];
const clone=v=>JSON.parse(JSON.stringify(v));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=m=>{throw new Error(m)};
const small=(v,name,max=12000)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)?v:fail('Invalid '+name);
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v))?v:fail('An actual ISO observation time is required.');
const key=(d,p)=>JSON.stringify([String(d),String(p)]);
export function bytesBase64(bytes){
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let s='';
 for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];s+=chars[a>>2]+chars[((a&3)<<4)|((b??0)>>4)]+(b===undefined?'=':chars[((b&15)<<2)|((c??0)>>6)])+(c===undefined?'=':chars[c&63]);}return s;
}
export function base64Bytes(s){
 if(typeof s!=='string'||s.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))fail('Invalid retained source bytes.');
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[];let v=0,n=-8;
 for(const c of s){if(c==='=')break;v=(v<<6)|chars.indexOf(c);n+=6;if(n>=0){out.push((v>>>n)&255);n-=8;}}return new Uint8Array(out);
}
export function validateRegister(register){
 if(register?.schema!=='stellar-forge.orange-ida-source-register.v1'||!Array.isArray(register.units)||!Array.isArray(register.sources))fail('Use the complete Orange source register.');
 const ids=new Set(),sources=new Set(register.sources.map(s=>s.id));
 for(const u of register.units){
  if(ids.has(u.id)||!u.id||!sources.has(u.sourceId)||!/^\d+$/.test(u.gmProjectId)||!/^\d+$/.test(u.disasterNumber))fail('Invalid or duplicated work-unit identity.');
  ids.add(u.id);for(const a of u.amounts){decimalMinor(a.decimal);if(a.currency!=='USD'||!a.id||!sources.has(a.reference.sourceId))fail('Invalid issued amount reference.');}
 }
 return register;
}

function engineeringContextInput(register,raw,name){
 small(name,'engineering context filename',300);
 if(typeof raw!=='string'||raw.length>2*1024*1024)fail('Select a complete engineering-context.json of at most 2 MiB.');
 let c;try{c=JSON.parse(raw.charCodeAt(0)===0xfeff?raw.slice(1):raw)}catch{fail('The engineering context is not complete JSON.');}
 if(c?.schema!=='stellar-forge.orange-ida-engineering-context.v1'||c.registerId!==register.id||!c.id||!Array.isArray(c.units)||!Array.isArray(c.sources)||!Array.isArray(c.common?.preparedWorkflow))fail('Use engineering context linked to this original issued register.');
 const units=new Set(register.units.map(u=>u.id)),seen=new Set(),sources=new Map(register.sources.map(s=>[s.id,s]));
 for(const s of c.sources)if(!sources.has(s.id)||s.url!==sources.get(s.id).url)fail('An engineering reference names a different original issued source.');
 for(const u of c.units){
  if(!units.has(u.unitId)||seen.has(u.unitId)||!Array.isArray(u.issuedFacts)||!Array.isArray(u.quantities)||!Array.isArray(u.scopeQuestions)||!Array.isArray(u.engineeringWork))fail('Engineering context must preserve each issued work-unit identity.');
  seen.add(u.unitId);
  for(const q of u.quantities)if(typeof q.value!=='string'||!/^\d+(?:\.\d+)?$/.test(q.value)||!q.unit||!q.basis)fail('An issued quantity needs its exact value, unit and source basis.');
  for(const w of u.engineeringWork)if(!w.title||!w.output||!Array.isArray(w.inputs))fail('An engineering work item needs its output and required source inputs.');
 }
 if(seen.size!==units.size)fail('The complete engineering context must cover every original work unit.');
 function references(v){
  if(!v||typeof v!=='object')return;
  if(v.sourceId&&Array.isArray(v.pages)){
   const s=sources.get(v.sourceId);if(!s||v.pages.some(p=>!Number.isSafeInteger(p)||p<1||p>s.pages))fail('An engineering page reference is outside the complete issued source.');
  }
  for(const child of Object.values(v))if(child&&typeof child==='object')references(child);
 }
 references(c);return c;
}
export function engineeringContext(state,sha=state.selectedEngineeringContextSha256??null){
 const record=(state.engineeringContexts??[]).find(c=>c.sha256===sha);
 return record?engineeringContextInput(state.register,record.raw,record.name):null;
}
export function importEngineeringContext(state,input){
 const {raw,name,receivedAt}=input,c=engineeringContextInput(state.register,raw,name),tx=begin(state,input,{type:'engineering-context.import',raw,name,receivedAt});if(tx.repeated)return state;
 const sha256=sha256Utf8(raw);tx.state.engineeringContexts??=[];
 if(!tx.state.engineeringContexts.some(x=>x.sha256===sha256))tx.state.engineeringContexts.push({sha256,name,raw,receivedAt:iso(receivedAt),contextId:c.id,registerId:c.registerId});
 tx.state.selectedEngineeringContextSha256=sha256;return finish(tx,'engineering-context.import',receivedAt,{sha256,contextId:c.id,workUnits:c.units.length});
}
export function selectEngineeringContext(state,input){
 const tx=begin(state,input,{type:'engineering-context.select',sha256:input.sha256,receivedAt:input.receivedAt});if(tx.repeated)return state;
 if(input.sha256!==null&&!(state.engineeringContexts??[]).some(c=>c.sha256===input.sha256))fail('Select a retained engineering context.');
 tx.state.selectedEngineeringContextSha256=input.sha256;return finish(tx,'engineering-context.select',input.receivedAt,{sha256:input.sha256});
}

export function createWorkspace({register,createdAt,id}){
 validateRegister(register);small(id,'workspace ID',200);if(!id)fail('Workspace ID is required.');
 return {schema:SCHEMA,id,createdAt:iso(createdAt),revision:0,register:clone(register),registerSha256:sha256Utf8(stable(register)),portfolios:[],selectedPortfolioSha256:null,engineeringContexts:[],selectedEngineeringContextSha256:null,documents:[],reviews:[],operations:[]};
}
function check(state){
 if(state?.schema!==SCHEMA||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.operations))fail('Use a complete saved review workspace.');
 validateRegister(state.register);if(sha256Utf8(stable(state.register))!==state.registerSha256)fail('The issued register differs from its retained identity.');
 if(!Array.isArray(state.portfolios)||!Array.isArray(state.documents)||!Array.isArray(state.reviews))fail('Workspace records are incomplete.');
 if(state.engineeringContexts!==undefined&&!Array.isArray(state.engineeringContexts))fail('Engineering source history is incomplete.');
 const contextIds=new Set();for(const c of state.engineeringContexts??[]){if(contextIds.has(c.sha256)||sha256Utf8(c.raw)!==c.sha256)fail('An original engineering context is duplicated or changed.');contextIds.add(c.sha256);const parsed=engineeringContextInput(state.register,c.raw,c.name);if(parsed.id!==c.contextId||parsed.registerId!==c.registerId)fail('Engineering context identity differs.');}
 if(state.selectedEngineeringContextSha256!=null&&!contextIds.has(state.selectedEngineeringContextSha256))fail('The selected engineering context is absent.');
 return state;
}
function begin(state,{operationId,expectedRevision},payload){
 check(state);small(operationId,'operation ID',200);if(!operationId)fail('Operation ID is required.');
 const requestSha256=sha256Utf8(stable(payload)),old=state.operations.find(o=>o.id===operationId);
 if(old){if(old.requestSha256!==requestSha256)fail('That operation ID already belongs to different input.');return {repeated:true,state};}
 if(state.revision!==expectedRevision)fail('The workspace changed. Reopen the current revision before saving.');
 return {repeated:false,state:clone(state),operationId,requestSha256};
}
function finish(tx,type,receivedAt,result){
 tx.state.revision++;tx.state.operations.push({id:tx.operationId,type,requestSha256:tx.requestSha256,revision:tx.state.revision,receivedAt:iso(receivedAt),result});
 return tx.state;
}
function portfolioInput(raw,name){
 small(name,'portfolio filename',300);if(typeof raw!=='string'||raw.length>32*1024*1024)fail('Select a complete UTF-8 portfolio.json of at most 32 MiB.');
 let p;try{p=JSON.parse(raw.charCodeAt(0)===0xfeff?raw.slice(1):raw)}catch{fail('The portfolio is not complete JSON.');}
 if(p?.schema!=='stellar-forge.openfema-portfolio.v1'||!Array.isArray(p.projects)||!p.editionId||!/^[a-f0-9]{64}$/.test(p.sourceSha256))fail('Select portfolio.json from the original OpenFEMA delivery ZIP.');
 for(const row of p.projects){
  if(!row.id||!row.disasterNumber||!row.original||!/^[a-f0-9]{64}$/.test(row.sourcePageSha256)||!Number.isSafeInteger(row.sourceRow)||row.sourceRow<0)fail('A portfolio project is missing its original source row.');
  if(String(row.original.gmProjectId)!==String(row.id)||String(row.original.disasterNumber)!==String(row.disasterNumber))fail('A projected identity differs from its attached original record.');
 }
 return p;
}
export function importPortfolio(state,input){
 const {raw,name,receivedAt}=input,p=portfolioInput(raw,name);
 const tx=begin(state,input,{type:'portfolio.import',raw,name,receivedAt});if(tx.repeated)return state;
 const sha256=sha256Utf8(raw),prior=tx.state.portfolios.find(x=>x.sha256===sha256);
 if(!prior)tx.state.portfolios.push({sha256,name,raw,receivedAt:iso(receivedAt),editionId:p.editionId,sourceSha256:p.sourceSha256});
 tx.state.selectedPortfolioSha256=sha256;return finish(tx,'portfolio.import',receivedAt,{sha256,editionId:p.editionId,projectCount:p.projects.length});
}
export function selectPortfolio(state,input){
 const tx=begin(state,input,{type:'portfolio.select',sha256:input.sha256,receivedAt:input.receivedAt});if(tx.repeated)return state;
 if(input.sha256!==null&&!state.portfolios.some(x=>x.sha256===input.sha256))fail('Select a retained portfolio.');
 tx.state.selectedPortfolioSha256=input.sha256;return finish(tx,'portfolio.select',input.receivedAt,{sha256:input.sha256});
}
export function attachDocument(state,input){
 const {name,mimeType,base64,sourceUrl,sourceId,receivedAt}=input;
 small(name,'source filename',300);small(mimeType,'MIME type',200);
 small(sourceId,'document source ID',200);if(!sourceId)fail('Name the source document.');
 if(sourceUrl&&!/^https:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(sourceUrl))fail('Use a complete HTTPS original source URL or leave it empty.');
 const bytes=base64Bytes(base64);if(bytes.length>16*1024*1024)fail('Source document exceeds 16 MiB.');
 const sha256=sha256Bytes(bytes),tx=begin(state,input,{type:'document.attach',name,mimeType,base64,sourceUrl,sourceId,receivedAt});if(tx.repeated)return state;
 const id=sourceId+':'+sha256;
 if(!tx.state.documents.some(d=>d.id===id))tx.state.documents.push({id,sourceId,name,mimeType,base64,bytes:bytes.length,sha256,sourceUrl:sourceUrl||null,receivedAt:iso(receivedAt)});
 return finish(tx,'document.attach',receivedAt,{id,sha256});
}
function currentReview(state,unitId){return [...state.reviews].reverse().find(x=>x.unitId===unitId)||null;}
function decisionValue(state,input){
 const unit=state.register.units.find(u=>u.id===input.unitId);if(!unit)fail('Choose an existing location work unit.');
 const reviewer=small(input.reviewer,'reviewer',200).trim(),role=small(input.role??'','reviewer role',200).trim(),note=small(input.note,'review note').trim();
 if(!reviewer||!note)fail('Record the reviewer and the actual reasoning.');
 if(!STATES.includes(input.status)||!DISPOSITIONS.includes(input.disposition))fail('Choose a declared review state and disposition.');
 const owner=small(input.owner??'','work owner',200),dueDate=input.dueDate??'';
 if(dueDate&&(!/^\d{4}-\d\d-\d\d$/.test(dueDate)||new Date(dueDate+'T00:00:00Z').toISOString().slice(0,10)!==dueDate))fail('Use a valid YYYY-MM-DD due date.');
 const sourceIds=input.sourceIds??[];if(!Array.isArray(sourceIds)||new Set(sourceIds).size!==sourceIds.length)fail('Select distinct retained document IDs.');
 for(const id of sourceIds)if(!state.documents.some(d=>d.id===id))fail('A selected source file is absent from this workspace.');
 const selectedAmountId=input.selectedAmountId??null;if(selectedAmountId!==null&&!unit.amounts.some(a=>a.id===selectedAmountId))fail('Select an original reference amount for this location.');
 const proposedAmount=input.proposedAmount===undefined||input.proposedAmount===''?null:input.proposedAmount;
 if(proposedAmount!==null){if(typeof proposedAmount!=='string')fail('Enter an exact decimal amount as text.');decimalMinor(proposedAmount);if(!sourceIds.length)fail('Attach and select the written basis for a proposed amount.');}
 return {unitId:unit.id,reviewer,role,note,status:input.status,disposition:input.disposition,owner,dueDate,sourceIds,selectedAmountId,proposedAmount};
}
export function reviewUnits(state,input){
 if(!Array.isArray(input.decisions)||!input.decisions.length)fail('Supply the selected complete review decisions.');
 if(new Set(input.decisions.map(x=>x.unitId)).size!==input.decisions.length)fail('A location can appear once in a review save.');
 const decisions=input.decisions.map(x=>decisionValue(state,x)),tx=begin(state,input,{type:'unit.review',decisions,receivedAt:input.receivedAt});if(tx.repeated)return state;
 decisions.forEach((d,i)=>tx.state.reviews.push({...d,id:input.operationId+':'+i,recordedAt:iso(input.receivedAt),registerSha256:state.registerSha256,portfolioSha256:state.selectedPortfolioSha256,engineeringContextSha256:state.selectedEngineeringContextSha256??null,previousReviewId:currentReview(state,d.unitId)?.id??null}));
 return finish(tx,'unit.review',input.receivedAt,{reviewIds:decisions.map((_,i)=>input.operationId+':'+i)});
}
function parseSavedPortfolio(state,sha){const s=state.portfolios.find(x=>x.sha256===sha);return s?portfolioInput(s.raw,s.name):null;}
function projectIndex(p){
 const map=new Map();for(const row of p?.projects??[]){const k=key(row.disasterNumber,row.id);if(!map.has(k))map.set(k,[]);map.get(k).push(row);}return map;
}
export function analyze(state,sha=state.selectedPortfolioSha256){
 check(state);const portfolio=parseSavedPortfolio(state,sha),index=projectIndex(portfolio),groups=new Map(),context=engineeringContext(state);
 const units=state.register.units.map(unit=>{
  const identity=key(unit.disasterNumber,unit.gmProjectId),matches=index.get(identity)||[],project=matches.length===1?matches[0]:null,review=currentReview(state,unit.id);
  const issues=[];let sourceStatus=!portfolio?'NO_PORTFOLIO_IMPORTED':!matches.length?'NOT_OBSERVED_IN_SELECTED_PORTFOLIO':matches.length>1||project?.conflict?'SOURCE_CONFLICT':'MATCHED';
  if(project&&String(project.projectNumber)!==unit.pwNumber)issues.push({code:'PW_DIFFERENCE',issued:unit.pwNumber,portfolio:String(project.projectNumber)});
  if(project&&project.workCategory!==unit.category)issues.push({code:'CATEGORY_DIFFERENCE',issued:unit.category,portfolio:project.workCategory});
  if(project&&!project.included)issues.push({code:'PORTFOLIO_EXCLUDED',value:project.annotation?.disposition??null});
  if(review&&review.portfolioSha256!==sha)issues.push({code:'REVIEW_USES_PREVIOUS_PORTFOLIO',reviewPortfolioSha256:review.portfolioSha256});
  if(review&&(review.engineeringContextSha256??null)!==(state.selectedEngineeringContextSha256??null))issues.push({code:'REVIEW_USES_PREVIOUS_ENGINEERING_CONTEXT',reviewEngineeringContextSha256:review.engineeringContextSha256??null});
  if(!groups.has(identity))groups.set(identity,{identity,disasterNumber:unit.disasterNumber,gmProjectId:unit.gmProjectId,pwNumber:unit.pwNumber,unitIds:[],sourceStatus,project,issues:[]});
  const g=groups.get(identity);g.unitIds.push(unit.id);g.issues.push(...issues.filter(x=>!g.issues.some(y=>stable(y)===stable(x))));
  return {...clone(unit),engineering:clone(context?.units.find(x=>x.unitId===unit.id)??null),identity,sourceStatus,issues,review,projectSource:project?{sourcePageSha256:project.sourcePageSha256,sourceRow:project.sourceRow,sourceUrl:project.sourceUrl,editionId:portfolio.editionId}:null};
 });
 const projects=[...groups.values()];
 return {workspaceId:state.id,revision:state.revision,registerSha256:state.registerSha256,engineeringContext:context,engineeringContextSha256:state.selectedEngineeringContextSha256??null,portfolioSha256:sha,editionId:portfolio?.editionId??null,sourceScope:portfolio?.sourceScope??null,criteria:portfolio?.criteria??null,units,projects,
  summary:{workUnits:units.length,uniqueProjects:projects.length,matchedProjects:projects.filter(g=>g.sourceStatus==='MATCHED').length,missingProjects:projects.filter(g=>g.sourceStatus==='NOT_OBSERVED_IN_SELECTED_PORTFOLIO').length,sourceConflicts:projects.filter(g=>g.sourceStatus==='SOURCE_CONFLICT').length,reviewedUnits:units.filter(u=>u.review).length,openUnits:units.filter(u=>!u.review||!['review_recorded','completed'].includes(u.review.status)).length,
   financials:Object.fromEntries(['projectCost','federalObligated','totalObligated','mitigation'].map(field=>{
    const eligible=projects.filter(g=>g.sourceStatus==='MATCHED'&&g.project.included),values=eligible.map(g=>g.project[field]?.minor??null);
    return[field,{minor:values.some(v=>v!==null)?values.filter(v=>v!==null).reduce((a,v)=>a+BigInt(v),0n).toString():null,contributingProjects:values.filter(v=>v!==null).length,missingValues:values.filter(v=>v===null).length,currency:'USD'}];
   }))}};
}
export function comparePortfolios(state,beforeSha,afterSha){
 const before=analyze(state,beforeSha),after=analyze(state,afterSha),fields=['projectNumber','projectTitle','workCategory','projectStatus','processStep','included','projectCost','federalObligated','totalObligated','mitigation','annotation'];
 const rows=after.projects.map(a=>{
  const b=before.projects.find(x=>x.identity===a.identity),changes=[];
  for(const field of fields){const original=b?.project?.[field],current=a.project?.[field];if(stable(original??null)!==stable(current??null))changes.push({field,before:original??null,after:current??null});}
  return{identity:a.identity,unitIds:a.unitIds,beforeState:b?.sourceStatus??null,afterState:a.sourceStatus,changes};
 });
 return{schema:'stellar-forge.orange-ida-portfolio-comparison.v1',before:{sha256:beforeSha,editionId:before.editionId,sourceScope:before.sourceScope,criteria:before.criteria},after:{sha256:afterSha,editionId:after.editionId,sourceScope:after.sourceScope,criteria:after.criteria},rows};
}
export function exportUnitCsv(state){
 const a=analyze(state),columns=['unitId','rfq','rfqProject','disasterNumber','gmProjectId','pwNumber','location','sourceStatus','referenceAmounts','reviewStatus','disposition','reviewer','role','owner','dueDate','selectedReference','proposedAmountUSD','note','sourceDocuments','portfolioSha256','projectSource','reviewPortfolioSha256','issuedFacts','issuedQuantities','scopeQuestions','engineeringOutputs','engineeringContextSha256','reviewEngineeringContextSha256'];
 const rows=a.units.map(u=>({unitId:u.id,rfq:state.register.sources.find(s=>s.id===u.sourceId).title,rfqProject:u.rfqProject,disasterNumber:u.disasterNumber,gmProjectId:u.gmProjectId,pwNumber:u.pwNumber,location:u.name+' — '+u.location,sourceStatus:u.sourceStatus,referenceAmounts:u.amounts,reviewStatus:u.review?.status??'open',disposition:u.review?.disposition??'unresolved',reviewer:u.review?.reviewer??'',role:u.review?.role??'',owner:u.review?.owner??'',dueDate:u.review?.dueDate??'',selectedReference:u.review?.selectedAmountId??'',proposedAmountUSD:u.review?.proposedAmount??'',note:u.review?.note??'',sourceDocuments:u.review?.sourceIds??[],portfolioSha256:a.portfolioSha256,projectSource:u.projectSource,reviewPortfolioSha256:u.review?.portfolioSha256??null,issuedFacts:u.engineering?.issuedFacts??[],issuedQuantities:u.engineering?.quantities??[],scopeQuestions:u.engineering?.scopeQuestions??[],engineeringOutputs:u.engineering?.engineeringWork??[],engineeringContextSha256:a.engineeringContextSha256,reviewEngineeringContextSha256:u.review?.engineeringContextSha256??null}));
 return csv(columns,rows,{spreadsheet:true});
}
export function exportProjectCsv(state){
 const a=analyze(state),columns=['disasterNumber','gmProjectId','pwNumber','unitIds','sourceStatus','projectTitle','projectCostUSD','federalObligatedUSD','totalObligatedUSD','mitigationUSD','included','sourcePageSha256','sourceRow','sourceUrl','editionId'];
 return csv(columns,a.projects.map(g=>({disasterNumber:g.disasterNumber,gmProjectId:g.gmProjectId,pwNumber:g.pwNumber,unitIds:g.unitIds,sourceStatus:g.sourceStatus,projectTitle:g.project?.projectTitle??'',projectCostUSD:g.project?.projectCost?.decimal??'',federalObligatedUSD:g.project?.federalObligated?.decimal??'',totalObligatedUSD:g.project?.totalObligated?.decimal??'',mitigationUSD:g.project?.mitigation?.decimal??'',included:g.project?.included??'',sourcePageSha256:g.project?.sourcePageSha256??'',sourceRow:g.project?.sourceRow??'',sourceUrl:g.project?.sourceUrl??'',editionId:a.editionId})),{spreadsheet:true});
}
export function saveWorkspace(state){check(state);const content=clone(state);return JSON.stringify({schema:'stellar-forge.orange-ida-handover.v1',sha256:sha256Utf8(stable(content)),workspace:content},null,2)+'\n';}
export function reopenWorkspace(raw){
 let saved;try{saved=JSON.parse(raw.charCodeAt(0)===0xfeff?raw.slice(1):raw)}catch{fail('Choose a complete JSON workspace handover.');}
 if(saved?.schema!=='stellar-forge.orange-ida-handover.v1'||sha256Utf8(stable(saved.workspace))!==saved.sha256)fail('The complete handover content does not match its recorded identity.');
 const state=check(saved.workspace),seen=new Set();
 for(const p of state.portfolios){if(seen.has(p.sha256)||sha256Utf8(p.raw)!==p.sha256)fail('Retained portfolio file is duplicated or changed.');seen.add(p.sha256);portfolioInput(p.raw,p.name);}
 for(const d of state.documents){const b=base64Bytes(d.base64);if(b.length!==d.bytes||sha256Bytes(b)!==d.sha256)fail('A retained original source document differs.');}
 if(state.selectedPortfolioSha256!==null&&!state.portfolios.some(p=>p.sha256===state.selectedPortfolioSha256))fail('The selected original portfolio is absent.');
 const unitIds=new Set(state.register.units.map(u=>u.id)),reviewIds=new Set(),operationIds=new Set();
 for(const r of state.reviews){if(!unitIds.has(r.unitId)||reviewIds.has(r.id))fail('A retained location review has an invalid identity.');reviewIds.add(r.id);decisionValue(state,r);if(r.registerSha256!==state.registerSha256)fail('A review names a different issued register.');if(r.portfolioSha256!==null&&!state.portfolios.some(p=>p.sha256===r.portfolioSha256))fail('A review source portfolio is absent.');if(r.engineeringContextSha256!=null&&!(state.engineeringContexts??[]).some(c=>c.sha256===r.engineeringContextSha256))fail('A review engineering context is absent.');}
 for(const o of state.operations){if(operationIds.has(o.id))fail('An operation is duplicated.');operationIds.add(o.id);}
 return clone(state);
}
export function sourceDocument(state,id){const d=state.documents.find(x=>x.id===id);if(!d)fail('Select a retained document.');return clone(d);}
export function htmlReport(state){
 const a=analyze(state),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

 const reference=r=>(r?.pages??[]).map(p=>{const s=state.register.sources.find(x=>x.id===r.sourceId);return '<a href="'+esc(s?.url??'')+'#page='+p+'">'+esc(s?.title??r.sourceId)+' p. '+p+'</a>';}).join(', ');
 const contextSections=a.engineeringContext?'<h2>Issued requirements and engineering work</h2><p>'+esc(a.engineeringContext.common.professionalDelivery)+'</p><p>Page references use physical PDF pages, starting at 1. Issued quantities retain their original basis; proposed measurements and professional decisions are recorded separately.</p>'+a.units.map(u=>'<section><h3>'+esc(u.name)+' · '+esc(u.id)+'</h3><ul>'+(u.engineering?.issuedFacts??[]).map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>'+((u.engineering?.quantities??[]).length?'<table><tr><th>Issued item</th><th>Quantity</th><th>Basis</th><th>Source</th></tr>'+u.engineering.quantities.map(q=>'<tr><td>'+esc(q.item)+'</td><td>'+esc((q.qualifier?q.qualifier+' ':'')+q.value+' '+q.unit)+'</td><td>'+esc(q.basis)+'</td><td>'+reference(q.reference)+'</td></tr>').join('')+'</table>':'')+'<h4>Questions for the engineering review</h4><ul>'+(u.engineering?.scopeQuestions??[]).map(q=>'<li><strong>'+esc(q.title)+'</strong>: '+esc(q.question)+(q.sourceConflict?'<br>'+esc(q.sourceConflict):'')+'<br>'+reference(q.reference)+'</li>').join('')+'</ul><h4>Required engineering outputs and inputs</h4><table><tr><th>Work</th><th>Output</th><th>Required inputs</th></tr>'+(u.engineering?.engineeringWork??[]).map(w=>'<tr><td>'+esc(w.title)+'</td><td>'+esc(w.output)+'</td><td>'+w.inputs.map(esc).join('<br>')+'</td></tr>').join('')+'</table></section>').join('')+'<h2>Shared parent scope</h2>'+a.engineeringContext.sharedParents.map(p=>'<p><strong>'+esc(p.identity+' / PW '+p.pwNumber)+'</strong><br>'+esc(p.work)+'<br>'+esc(p.output)+'</p>').join('')+'<h2>Editable engineering-output structures</h2>'+a.engineeringContext.common.preparedWorkflow.map(w=>'<h3>'+esc(w.title)+'</h3><p>'+esc(w.output)+'</p><p>Fields: '+w.capture.map(esc).join(' · ')+'</p>').join(''):'';

 const row=u=>'<tr><td>'+esc(u.name)+'</td><td>'+esc(u.disasterNumber+'/'+u.gmProjectId+' / PW '+u.pwNumber)+'</td><td>'+u.amounts.map(m=>esc(m.basis+': USD '+m.decimal)).join('<br>')+'</td><td>'+esc(u.sourceStatus)+'</td><td>'+esc(u.review?.status??'open')+'</td><td>'+esc(u.review?.reviewer??'')+'</td><td>'+esc(u.review?.note??'')+'</td></tr>';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Orange Ida source review</title><style>body{font:14px system-ui;margin:32px;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}h1{font-size:24px}small{color:#555}@media print{body{margin:0}tr{break-inside:avoid}}</style><h1>Orange Hurricane Ida source review</h1><p>'+a.summary.workUnits+' location units · '+a.summary.uniqueProjects+' distinct FEMA projects · workspace revision '+a.revision+'</p><p>Location references, official project amounts and recorded engineering decisions retain separate bases. One project may contain several locations.</p><table><thead><tr><th>Location</th><th>Project</th><th>Issued references</th><th>Portfolio join</th><th>Review</th><th>Reviewer</th><th>Decision</th></tr></thead><tbody>'+a.units.map(row).join('')+'</tbody></table>'+contextSections+'<h2>Original sources</h2><ul>'+state.register.sources.map(s=>'<li>'+esc(s.title)+' — <a href="'+esc(s.url)+'">'+esc(s.url)+'</a></li>').join('')+'</ul><p><small>Register '+esc(state.registerSha256)+'<br>Engineering context '+esc(a.engineeringContextSha256??'No context imported')+'<br>Selected portfolio '+esc(a.portfolioSha256??'No portfolio imported')+'<br>All original inputs and review history are in the accompanying complete workspace JSON.</small></p></html>';
}

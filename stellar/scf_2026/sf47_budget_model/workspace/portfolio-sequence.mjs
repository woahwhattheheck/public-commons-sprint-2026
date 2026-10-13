// MIT. Reviewed delivery constraints over the original SF47 Portfolio.
import {availabilitySignature} from './portfolio-availability.mjs';
export const SEQUENCE_SCHEMA='stellar-forge.portfolio-sequence-desk.v1';
export const SEQUENCE_PROPOSAL='stellar-forge.portfolio-sequence-proposal.v1';
export const sequenceSignature=availabilitySignature;
const clone=v=>JSON.parse(JSON.stringify(v)),obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const same=(a,b)=>sequenceSignature(a)===sequenceSignature(b),check=(v,m)=>{if(!v)throw Error(m);};
const FIELDS=['releaseDate','dueDate','minBusinessDays','priority','dependsOn','note'];
function keys(v,allowed,label){check(obj(v),'Retain complete '+label+'.');for(const k of Object.keys(v))check(allowed.includes(k),'Unexpected '+label+' field: '+k);}
function text(v,label,max=12000){check(typeof v==='string'&&v.length<=max,'Retain '+label+' within '+max+' characters.');return v;}
function ordinary(v,d=0){check(d<=64,'Retain ordinary complete sequence data.');if(Array.isArray(v)){check(v.length<=200000,'Retain the supported complete sequence population.');v.forEach(x=>ordinary(x,d+1));}else if(obj(v)){for(const[k,x]of Object.entries(v)){check(!['__proto__','prototype','constructor'].includes(k),'Use ordinary sequence fields.');ordinary(x,d+1);}}else check(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v),'Retain finite JSON values.');}
function iso(v,nullable=true){if(v===null&&nullable)return null;check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v.slice(0,4)!=='0000','Use an exact YYYY-MM-DD date, or explicit null.');const t=Date.parse(v+'T00:00:00Z');check(Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v,'Use a real calendar date.');return v;}
function integer(v,max,nullable=false){if(v===null&&nullable)return null;check(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max,'Use a whole nonnegative value within the original native bound.');return v;}
export function sequenceRowKey(taskId,phaseId=null){return JSON.stringify([taskId,phaseId]);}
function profile(inputs,id){
 check(obj(inputs)&&typeof inputs.forecastId==='string'&&typeof inputs.forecastSha256==='string'&&Array.isArray(inputs.tasks)&&Array.isArray(inputs.alternatives),'Open the complete original Portfolio draft.');
 const a=id==='base'?null:inputs.alternatives.find(x=>x.id===id);check(id==='base'||a,'Choose an original allocation alternative.');
 return {id,name:a?.name||inputs.name||'Base allocation',tasks:a?.tasks??inputs.tasks,plans:a?.installationPlans??inputs.installationPlans??[],calendar:a?.calendar??inputs.calendar,taskInherited:!!a&&!Object.hasOwn(a,'tasks'),phaseInherited:!!a&&!Object.hasOwn(a,'installationPlans')};
}
function candidateFor(candidates,g){return candidates.find(c=>c.installationId===g.installationId&&c.installationRevision===g.installationRevision&&c.installationSha256===g.installationSha256);}
function values(item,phase){return {releaseDate:item.releaseDate??null,dueDate:item.dueDate??null,minBusinessDays:Object.hasOwn(item,'minBusinessDays')?item.minBusinessDays:0,priority:Object.hasOwn(item,'priority')?item.priority:(phase?null:100),dependsOn:clone(item.dependsOn??[]),note:item.note??''};}
function checkedValues(v,row){
 keys(v,FIELDS,'delivery fields');iso(v.releaseDate);iso(v.dueDate);integer(v.minBusinessDays,1096);integer(v.priority,1000000,row.phaseId!==null);text(v.note,'work assumption');
 check(Array.isArray(v.dependsOn)&&new Set(v.dependsOn).size===v.dependsOn.length&&v.dependsOn.every(id=>typeof id==='string'&&row.dependencyOptions.some(o=>o.id===id)),'Choose distinct other original predecessors from this task or phase group.');
 check(row.fixedDependencies.every(id=>v.dependsOn.includes(id)),'Retain every fixed predecessor from the selected original Installation.');
 return clone(v);
}
function sourceIssues(row,v){
 const found=[];
 if(row.phaseId===null&&row.source.timing){const t=row.source.timing;if(t.reviewedReleaseDate&&v.releaseDate&&v.releaseDate<t.reviewedReleaseDate)found.push({key:row.key,code:'ORIGINAL_EVENT_RELEASE',message:'Work release precedes the original reviewed start trigger '+t.reviewedReleaseDate+'.'});
 if(!t.reviewedReleaseDate)found.push({key:row.key,code:'TRIGGER_UNRESOLVED',incomplete:true,message:'The original source has no reviewed start trigger: '+t.startCondition+(v.releaseDate?'. Authored work release '+v.releaseDate+' is a proposed planning anchor used by the native preview, not a recorded event.':'. Entering work dates does not record the actual triggering event.')});}
 return found;
}
export function sequenceView(inputs,sourceTasks,candidates=[],{profile:profileId='base'}={}){
 const p=profile(inputs,profileId);check(Array.isArray(sourceTasks)&&Array.isArray(candidates),'Retain complete original work and Installation sources.');
 const sm=new Map(sourceTasks.map(s=>[s.id,s]));check(sm.size===sourceTasks.length,'Retain unique original Forecast task IDs.');
 const ids=p.tasks.map(t=>t.id);check(new Set(ids).size===ids.length&&ids.length===sm.size&&ids.every(id=>sm.has(id)),'Retain every original source task once.');
 const groups=new Map;for(const g of p.plans){check(obj(g)&&ids.includes(g.taskId)&&!groups.has(g.taskId)&&Array.isArray(g.phases),'Retain unique original phase groups.');groups.set(g.taskId,g);}
 const rows=[];
 for(const t of p.tasks){
 const source=sm.get(t.id),g=groups.get(t.id),binding={forecastId:inputs.forecastId,forecastSha256:inputs.forecastSha256,taskId:t.id,source:clone(source),phaseId:null,installation:null};
 const row={key:sequenceRowKey(t.id),taskId:t.id,phaseId:null,domain:'tasks',kind:g?'AGGREGATE':'TASK',title:source.title||t.id,phaseTitle:'',source:clone(source),binding,inherited:p.taskInherited,sourceAvailable:true,fixedDependencies:[],dependencyOptions:p.tasks.filter(x=>x.id!==t.id).map(x=>({id:x.id,key:sequenceRowKey(x.id),title:sm.get(x.id).title||x.id})),values:values(t,false),phaseCount:g?.phases.length||0};checkedValues(row.values,row);rows.push(row);
 if(g){const c=candidateFor(candidates,g),phaseIds=g.phases.map(x=>x.phaseId);check(new Set(phaseIds).size===phaseIds.length,'Retain unique original phase identities.');for(const ph of g.phases){const original=c?.phases?.find(x=>x.phaseId===ph.phaseId),fixed=clone(original?.dependsOn||[]),r={key:sequenceRowKey(t.id,ph.phaseId),taskId:t.id,phaseId:ph.phaseId,domain:'phases:'+t.id,kind:'PHASE',title:source.title||t.id,phaseTitle:original?.title||ph.phaseId,source:clone(source),binding:{...binding,phaseId:ph.phaseId,installation:{installationId:g.installationId,installationRevision:g.installationRevision,installationSha256:g.installationSha256,phase:original?clone(original):null}},inherited:p.phaseInherited,sourceAvailable:!!original,fixedDependencies:fixed,dependencyOptions:g.phases.filter(x=>x.phaseId!==ph.phaseId).map(x=>({id:x.phaseId,key:sequenceRowKey(t.id,x.phaseId),title:c?.phases?.find(y=>y.phaseId===x.phaseId)?.title||x.phaseId})),values:values(ph,true),phaseCount:0,parentValues:values(t,false)};checkedValues(r.values,r);rows.push(r);}}
 }
 const issues=graphIssues(rows);
 return {schema:'stellar-forge.portfolio-sequence-view.v1',forecastId:inputs.forecastId,forecastSha256:inputs.forecastSha256,profile:profileId,name:p.name,calendar:clone(p.calendar),rows,issues,summary:{tasks:p.tasks.length,phases:rows.filter(x=>x.kind==='PHASE').length,links:rows.reduce((n,r)=>n+r.values.dependsOn.length,0),unresolvedTriggers:issues.filter(i=>i.code==='TRIGGER_UNRESOLVED').length,sourceUnavailable:rows.filter(x=>!x.sourceAvailable).length}};
}
function graphIssues(rows){
 const issues=rows.flatMap(r=>sourceIssues(r,r.values)),domains=new Map;
 for(const r of rows){if(!domains.has(r.domain))domains.set(r.domain,[]);domains.get(r.domain).push(r);}
 for(const group of domains.values()){const byId=new Map(group.map(r=>[r.phaseId??r.taskId,r])),color=new Map,path=[];
 function visit(id){if(color.get(id)===2)return;if(color.get(id)===1){const cycle=path.slice(path.indexOf(id)).concat(id);issues.push({key:byId.get(id).key,code:'DEPENDENCY_CYCLE',message:'Predecessor cycle: '+cycle.map(x=>byId.get(x)?.phaseTitle||byId.get(x)?.title||x).join(' → '),cycle});return;}
 color.set(id,1);path.push(id);for(const parent of byId.get(id).values.dependsOn){if(!byId.has(parent))issues.push({key:byId.get(id).key,code:'DEPENDENCY_MISSING',message:'A selected predecessor is no longer in this original work group.'});else visit(parent);}path.pop();color.set(id,2);}
 for(const id of byId.keys())visit(id);}
 return issues;
}
function basisFor(view,selected){const keysSet=new Set(selected);check(keysSet.size===selected.length&&selected.length>0,'Choose distinct original work rows.');const rows=selected.map(k=>view.rows.find(r=>r.key===k));check(rows.every(Boolean),'Choose current original tasks or phases.');return {forecastId:view.forecastId,forecastSha256:view.forecastSha256,profile:view.profile,rows:clone(rows)};}
export function sequenceBasis(inputs,sources,candidates,selected,{profile='base'}={}){return basisFor(sequenceView(inputs,sources,candidates,{profile}),selected);}
function verifyBasis(b){
 keys(b,['forecastId','forecastSha256','profile','rows'],'sequence basis');text(b.forecastId,'Forecast ID',200);text(b.forecastSha256,'Forecast identity',100);text(b.profile,'alternative',200);check(Array.isArray(b.rows)&&b.rows.length&&new Set(b.rows.map(r=>r.key)).size===b.rows.length,'Retain every original selected work row once.');
 for(const r of b.rows){check(r.key===sequenceRowKey(r.taskId,r.phaseId)&&r.binding?.forecastId===b.forecastId&&r.binding?.forecastSha256===b.forecastSha256&&r.binding.taskId===r.taskId&&r.binding.phaseId===r.phaseId&&same(r.binding.source,r.source),'Retain the original row/source binding.');check(Array.isArray(r.fixedDependencies)&&Array.isArray(r.dependencyOptions),'Retain original predecessor options and fixed dependencies.');if(r.phaseId!==null)check(same(r.fixedDependencies,r.binding.installation?.phase?.dependsOn||[]),'Retain original fixed Installation predecessors.');checkedValues(r.values,r);}
 return clone(b);
}
function build(basis,command,at){
 verifyBasis(basis);keys(command,['kind','rows','rowKeys','fields','field','days','dependency','mode','note'],'delivery command');text(command.note??'','review note');check(typeof at==='string'&&Number.isFinite(Date.parse(at)),'Retain the actual preparation time.');check(['EDIT','SET','SHIFT','DEPENDENCY'].includes(command.kind),'Choose a supported explicit delivery change.');
 const selected=command.kind==='EDIT'?command.rows?.map(r=>r.key):command.rowKeys;check(Array.isArray(selected)&&same([...selected].sort(),basis.rows.map(r=>r.key).sort()),'Retain the complete original selected population.');
 const patches=[],rows=[];
 for(const old of basis.rows){check(!old.inherited,'Enable the original whole task or phase override before editing this alternative.');check(old.sourceAvailable,'Receive the complete pinned Installation phase source before editing its sequence.');const next=clone(old.values);let fields;
 if(command.kind==='EDIT'){const edit=command.rows.find(r=>r.key===old.key);keys(edit,['key','fields'],'individual edit');fields=edit.fields;}
 if(command.kind==='SET')fields=command.fields;
 if(fields!==undefined){keys(fields,FIELDS,'selected delivery fields');check(Object.keys(fields).length,'Select at least one field to change.');Object.assign(next,clone(fields));}
 if(command.kind==='SHIFT'){check(['releaseDate','dueDate'].includes(command.field)&&Number.isSafeInteger(command.days)&&Math.abs(command.days)<=1096,'Choose a date field and signed whole calendar-day change within the native horizon.');const previous=old.values[command.field];if(previous!==null){const d=new Date(Date.parse(previous+'T00:00:00Z')+command.days*86400000).toISOString().slice(0,10);next[command.field]=iso(d);}}
 if(command.kind==='DEPENDENCY'){check(['add','remove'].includes(command.mode),'Choose add or remove predecessor.');text(command.dependency,'predecessor ID',1000);check(old.dependencyOptions.some(r=>r.id===command.dependency),'Choose one other original predecessor in every selected row’s group.');if(command.mode==='remove')check(!old.fixedDependencies.includes(command.dependency),'Original Installation predecessors cannot be removed.');next.dependsOn=command.mode==='add'?[...new Set([...next.dependsOn,command.dependency])]:next.dependsOn.filter(x=>x!==command.dependency);}
 checkedValues(next,old);
 for(const field of FIELDS)if(!same(old.values[field],next[field]))patches.push({key:JSON.stringify([old.key,field]),rowKey:old.key,field,before:clone(old.values[field]),after:clone(next[field])});
 rows.push({key:old.key,before:clone(old.values),after:next});}
 return {schema:SEQUENCE_PROPOSAL,createdAt:at,basis:clone(basis),command:clone(command),patches,rows};
}
export function prepareSequence(inputs,sources,candidates,command,{profile='base',at=new Date().toISOString()}={}){const selected=command.kind==='EDIT'?command.rows?.map(r=>r.key):command.rowKeys;check(Array.isArray(selected),'Select the original complete work rows.');return build(sequenceBasis(inputs,sources,candidates,selected,{profile}),command,at);}
export function prepareRetainedSequence(basis,command,{at=new Date().toISOString()}={}){return build(clone(basis),command,at);}
export function validateSequenceProposal(value){ordinary(value);keys(value,['schema','createdAt','basis','command','patches','rows'],'sequence proposal');check(value.schema===SEQUENCE_PROPOSAL,'Use the complete original delivery review.');check(same(value,build(value.basis,value.command,value.createdAt)),'The retained delivery review differs from its original source and command.');return clone(value);}
export function reviewSequence(inputs,sources,candidates,proposal,{choices={}}={}){
 const p=validateSequenceProposal(proposal),view=sequenceView(inputs,sources,candidates,{profile:p.basis.profile});check(view.forecastId===p.basis.forecastId&&view.forecastSha256===p.basis.forecastSha256,'Retain the same original Forecast edition.');check(obj(choices),'Retain complete per-field choices.');
 const rows=clone(view.rows),map=new Map(rows.map(r=>[r.key,r])),decisions=[],conflicts=[];
 for(const old of p.basis.rows){const now=map.get(old.key);check(now&&!now.inherited&&now.sourceAvailable,'Keep each selected original row editable and sourced.');check(same(now.binding,old.binding),'The original task/Installation source changed. Prepare a new review from the current source.');}
 const patchKeys=new Set(p.patches.map(x=>x.key));for(const k of Object.keys(choices))check(patchKeys.has(k),'A retained choice belongs to another delivery field.');
 for(const patch of p.patches){const row=map.get(patch.rowKey),current=clone(row.values[patch.field]),conflict=!same(current,patch.before)&&!same(current,patch.after),basis=sequenceSignature({key:patch.key,before:patch.before,current,proposed:patch.after}),choice=choices[patch.key];if(choice!==undefined){keys(choice,['take','basis'],'delivery choice');check(conflict&&choice.basis===basis&&['current','proposed'].includes(choice.take),'A saved delivery choice no longer matches these exact original/current/proposed values.');}const take=conflict?choice?.take||null:'proposed';if(take==='proposed')row.values[patch.field]=clone(patch.after);const d={...clone(patch),current,conflict,basis,take};decisions.push(d);if(take===null)conflicts.push(d);}
 const blockers=[];for(const r of rows)try{checkedValues(r.values,r);}catch(e){blockers.push({key:r.key,code:'INVALID_FIELDS',message:e.message});}
 for(const issue of graphIssues(rows))if(!issue.incomplete)blockers.push(issue);
 const incomplete=graphIssues(rows).filter(x=>x.incomplete),selectedRows=p.basis.rows.map(old=>({key:old.key,title:old.title,phaseTitle:old.phaseTitle,before:clone(view.rows.find(r=>r.key===old.key).values),after:clone(map.get(old.key).values)}));
 return {schema:'stellar-forge.portfolio-sequence-review.v1',proposal:p,currentSignature:sequenceSignature(inputs),decisions,conflicts,blockers,incomplete,rows:selectedRows,canApply:conflicts.length===0&&blockers.length===0,changedFields:decisions.filter(d=>d.take==='proposed'&&!same(d.current,d.after)).length};
}
export function applySequence(inputs,sources,candidates,proposal,{choices={},expectedSignature}={}){
 check(expectedSignature===sequenceSignature(inputs),'The complete current Portfolio draft changed; review its current sequence again.');const review=reviewSequence(inputs,sources,candidates,proposal,{choices});check(review.canApply,'Resolve the complete predecessor graph and current field decisions before applying.');
 const next=clone(inputs),p=profile(next,proposal.basis.profile);
 for(const d of review.decisions)if(d.take==='proposed'){const[taskId,phaseId]=JSON.parse(d.rowKey),row=phaseId===null?p.tasks.find(t=>t.id===taskId):p.plans.find(g=>g.taskId===taskId)?.phases.find(ph=>ph.phaseId===phaseId);check(row,'Retain the exact original work row.');row[d.field]=clone(d.after);}
 return {inputs:next,review};
}
export function sequenceCsv(view){const header=['Forecast','Alternative','Task ID','Phase ID','Work','Phase','Release','Due','Minimum working days','Priority','Predecessors','Fixed predecessors','Original start condition','Original reviewed trigger','Quoted delivery working days','Original source start','Original source end','Note'],rows=view.rows.map(r=>[view.forecastId,view.profile,r.taskId,r.phaseId,r.title,r.phaseTitle,r.values.releaseDate,r.values.dueDate,r.values.minBusinessDays,r.values.priority??'[inherit]',r.values.dependsOn.join(' | '),r.fixedDependencies.join(' | '),r.source.timing?.startCondition,r.source.timing?.reviewedReleaseDate,r.source.timing?.deliveryBusinessDays,r.source.startDate,r.source.endDate,r.values.note]);return '\ufeff'+[header,...rows].map(r=>r.map(v=>'"'+String(v??'').replace(/^[\t\r\n ]*(?=[=+@-])/u,"'").replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';}
export function emptySequenceDesk(){return {schema:SEQUENCE_SCHEMA,selected:null,drafts:{},history:[]};}
export const sequenceDeskKey=(forecastId,profile)=>JSON.stringify([forecastId,profile]);

function validateAppliedReview(h){
 keys(h,['at','proposal','choices','review'],'applied delivery review');check(typeof h.at==='string'&&Number.isFinite(Date.parse(h.at))&&obj(h.choices),'Retain the complete actual application.');
 const p=validateSequenceProposal(h.proposal),r=h.review;keys(r,['schema','proposal','currentSignature','decisions','conflicts','blockers','incomplete','rows','canApply','changedFields'],'applied review result');
 check(r.schema==='stellar-forge.portfolio-sequence-review.v1'&&same(r.proposal,p)&&typeof r.currentSignature==='string','Retain the exact applied proposal and current-draft identity.');
 check(Array.isArray(r.decisions)&&r.decisions.length===p.patches.length&&new Set(r.decisions.map(d=>d.key)).size===r.decisions.length,'Retain every actual applied field decision once.');
 check(Array.isArray(r.conflicts)&&!r.conflicts.length&&Array.isArray(r.blockers)&&!r.blockers.length&&r.canApply===true,'Only a resolved applicable review belongs in applied history.');
 check(Array.isArray(r.incomplete)&&r.incomplete.every(x=>obj(x)&&typeof x.key==='string'&&typeof x.code==='string'&&typeof x.message==='string'&&x.incomplete===true),'Retain complete original source-trigger warnings.');
 check(Array.isArray(r.rows)&&r.rows.length===p.basis.rows.length&&new Set(r.rows.map(x=>x.key)).size===r.rows.length,'Retain each complete applied work row once.');
 const expectedChoices=new Set;
 for(const d of r.decisions){keys(d,['key','rowKey','field','before','after','current','conflict','basis','take'],'applied field decision');const patch=p.patches.find(x=>x.key===d.key);check(patch&&same(patch,Object.fromEntries(['key','rowKey','field','before','after'].map(k=>[k,d[k]]))),'An applied decision must retain its exact original patch.');
 const conflict=!same(d.current,d.before)&&!same(d.current,d.after),basis=sequenceSignature({key:d.key,before:d.before,current:d.current,proposed:d.after});check(d.conflict===conflict&&d.basis===basis&&['current','proposed'].includes(d.take),'Retain actual current field values and decision basis.');
 if(conflict){expectedChoices.add(d.key);check(same(h.choices[d.key],{take:d.take,basis}),'Retain the exact accepted conflict choice.');}else check(d.take==='proposed','An unchanged field uses its reviewed proposed value.');}
 check(Object.keys(h.choices).length===expectedChoices.size&&Object.keys(h.choices).every(k=>expectedChoices.has(k)),'Applied choices belong only to their actual field conflicts.');
 for(const row of r.rows){keys(row,['key','title','phaseTitle','before','after'],'applied work row');const old=p.basis.rows.find(x=>x.key===row.key);check(old&&row.title===old.title&&row.phaseTitle===old.phaseTitle,'Keep the original applied work identity and title.');checkedValues(row.before,old);checkedValues(row.after,old);const after=clone(row.before);for(const d of r.decisions.filter(d=>d.rowKey===row.key)){check(same(d.current,row.before[d.field]),'Applied current fields must match their complete original current row.');if(d.take==='proposed')after[d.field]=clone(d.after);}check(same(after,row.after),'The applied complete row differs from its reviewed field decisions.');}
 check(r.changedFields===r.decisions.filter(d=>d.take==='proposed'&&!same(d.current,d.after)).length,'Retain the actual applied changed-field count.');
}

export function validateSequenceDesk(v){
 ordinary(v);keys(v,['schema','selected','drafts','history'],'sequence desk');check(v.schema===SEQUENCE_SCHEMA&&obj(v.drafts)&&Array.isArray(v.history),'Retain complete original delivery work.');check(v.selected===null||typeof v.selected==='string'&&Object.hasOwn(v.drafts,v.selected),'Retain the selected original preparation.');
 for(const[k,d]of Object.entries(v.drafts)){keys(d,['forecastId','profile','query','filter','page','reviewPage','openRow','selectedRows','rowDrafts','rowBases','batchField','batchValue','batchMode','shiftDays','dependency','note','proposal','choices'],'sequence draft');check(k===sequenceDeskKey(d.forecastId,d.profile),'Keep each preparation in its original Forecast/alternative.');for(const f of ['query','filter','batchField','batchValue','batchMode','shiftDays','dependency','note'])text(d[f],f,f==='note'?12000:2000);check(['all','tasks','phases','unresolved'].includes(d.filter)&&Number.isSafeInteger(d.page)&&d.page>=0&&Number.isSafeInteger(d.reviewPage)&&d.reviewPage>=0,'Retain complete filtering and pages.');check(Array.isArray(d.selectedRows)&&new Set(d.selectedRows).size===d.selectedRows.length&&d.selectedRows.every(x=>typeof x==='string')&&(d.openRow===null||typeof d.openRow==='string'),'Retain the exact row selection.');check(obj(d.rowDrafts)&&obj(d.rowBases)&&obj(d.choices),'Retain all unfinished fields and opening sources.');
 for(const[key,fields]of Object.entries(d.rowDrafts)){keys(fields,FIELDS,'unfinished delivery row');for(const f of FIELDS)if(f==='dependsOn')check(Array.isArray(fields[f])&&new Set(fields[f]).size===fields[f].length&&fields[f].every(x=>typeof x==='string'),'Retain selected predecessors.');else text(fields[f],f,f==='note'?12000:2000);const b=d.rowBases[key];verifyBasis(b);check(b.forecastId===d.forecastId&&b.profile===d.profile&&b.rows.length===1&&b.rows[0].key===key,'Retain the exact original opening row basis.');}
 check(Object.keys(d.rowBases).every(key=>Object.hasOwn(d.rowDrafts,key)),'Do not orphan original opening sources.');
 if(d.proposal!==null){const p=validateSequenceProposal(d.proposal);check(p.basis.forecastId===d.forecastId&&p.basis.profile===d.profile,'Keep the prepared review in its original selection.');}
 for(const choice of Object.values(d.choices)){keys(choice,['take','basis'],'retained delivery choice');check(['current','proposed'].includes(choice.take)&&typeof choice.basis==='string','Retain exact current conflict choices.');}}
 for(const h of v.history)validateAppliedReview(h);
 return clone(v);
}

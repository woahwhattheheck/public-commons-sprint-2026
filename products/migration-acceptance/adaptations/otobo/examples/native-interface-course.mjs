// SPDX-License-Identifier: MIT
// Complete authored configuration reference through the unchanged project and native compiler.
// The comparison observations below are authored interface inputs, not a native OTOBO export.
import {buildReference} from './build-reference.mjs';
import {prepareConfigurationComparison,canonical,hash,clone} from '../core.mjs';
import {newProject,applyMapping,requireApproval,serializeProject,openProject} from '../project.mjs';
import {prepareProviderMigration,bindProviderPipeline} from '../provider-input.mjs';
import {compilePipeline,comparisonPlan,comparePipeline} from '../../../workbench/vendor/dlt/pipeline/plan.mjs';
import {buildProviderAcceptance} from '../acceptance.mjs';
import {evaluateAcceptance} from '../../../workbench/acceptance/index.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
function rejects(operation,part){try{operation();}catch(error){need(error.message.includes(part),'Unexpected rejection: '+error.message);return error.message;}throw Error('Expected rejection: '+part);}
const same=(a,b)=>canonical(a)===canonical(b);
export function runConfigurationInterfaceCourse(){
 const reference=buildReference(),{source,before,plan,after,matchingAfter}=reference;
 const capture={schema:'otobo.review-source.v1',source,before,after};
 const project0=newProject({id:'otobo-native-reference',title:'Authored OTOBO configuration reference',capture,mapping:plan,at:'2026-10-13T12:25:00Z'});
 const rejectedUnapproved=rejects(()=>requireApproval(project0),'Record the named review');
 const request={operationId:'otobo-reference-approval',projectId:project0.id,captureSha256:project0.captureSha256,expectedRevision:0,mapping:plan,actor:'Authored reference reviewer',reason:'Review exact original source, baseline, complete plan and independently authored returned configuration.',approve:true,at:'2026-10-13T12:26:00Z'};
 const approved=applyMapping(project0,request).project;requireApproval(approved);
 const replay=applyMapping(approved,request);need(replay.replayed&&!replay.changed&&same(replay.project,approved),'Original approval replay changed complete history.');
 const changedRequest=rejects(()=>applyMapping(approved,{...request,reason:'Changed original request'}),'different complete inputs');
 const originalProjectBytes=serializeProject(approved),reopened=openProject(originalProjectBytes);
 need(serializeProject(reopened)===originalProjectBytes&&same(reopened.capture,capture),'Complete project, all original bytes and request history must reopen exactly.');
 const prepared=prepareProviderMigration(reopened),roundtrip=JSON.parse(JSON.stringify(prepared));
 need(same(prepared,roundtrip),'Prepared file roundtrip differs.');
 const sourceIds={'inputs/planned-configuration.json':'reference_plan_rows','expected/returned-configuration.json':'reference_return_rows'};
 const input=bindProviderPipeline(roundtrip,sourceIds),compiled=compilePipeline(input);
 need(compiled.ready&&compiled.resources.length===1&&compiled.resources[0].columns.every(c=>c.data_type==='text'),'Original dlt compiler must retain all-text complete configuration.');
 const acceptance=buildProviderAcceptance({pipelinePlan:compiled,prepared});
 need(acceptance.compiled.objects[0].key.join('|')==='family|identity_json','Original native composite key changed.');
 const compared=prepareConfigurationComparison({source,before,plan,after});
 need(compared.ready&&compared.expectedRows.length===11&&compared.observedRows.length===11&&compared.differences.length===2,'Retain authored queue and role-permission differences.');
 const compareSelection=comparisonPlan(compiled);
 function originalComparator(selectedPrepared,expectedRows,observedRows){
  const col=['family','identity_json','value_json'];
  const side=(path,rows)=>{const f=selectedPrepared.files.find(f=>f.path===path);return {columns:col.map(name=>({name,type:'text',nullable:false})),rows:rows.map(r=>col.map(name=>({type:'text',value:r[name]}))),source:{kind:'authored-interface-reference',path,sha256:f.sha256,recordedAt:'2026-10-13T12:27:00Z',rowCount:rows.length},complete:true};};
  const observations={schema:'slingdata.migration-observations.v1',pipelinePlanId:compiled.planId,planId:compareSelection.planId,phase:'baseline',pendingPackages:false,failedJobs:false,completeTables:true,streams:[{streamId:compiled.acceptance[0].id,left:side('inputs/planned-configuration.json',expectedRows),right:side('expected/returned-configuration.json',observedRows),native:null}]};
  const parity=comparePipeline(compiled,observations),report=evaluateAcceptance(acceptance.compiled,observations,{parity});
  need(!parity.readyForCutover&&!report.readyForCutover,'Unmeasured native execution cannot establish acceptance.');
  return {observations,parity,report};
 }
 const nonmatching=originalComparator(prepared,compared.expectedRows,compared.observedRows);
 need(!nonmatching.parity.equal&&nonmatching.parity.nativeReport.streams[0].rows.missingRows===2&&nonmatching.parity.nativeReport.streams[0].rows.additionalRows===2,'Original comparator must retain both exact unequal rows.');
 const matching=prepareConfigurationComparison({source,before,plan,after:matchingAfter});
 const matchingPrepared=prepareProviderMigration({capture:{...capture,after:matchingAfter},mapping:plan});
 const matchingInput=bindProviderPipeline(matchingPrepared,sourceIds),matchingCompiled=compilePipeline(matchingInput);
 need(matching.ready&&matching.differences.length===0&&matchingCompiled.ready,'Matching independently authored configuration must compile.');
 // Recompile its own original acceptance and observation binding; no old report identity is reused.
 const matchingAcceptance=buildProviderAcceptance({pipelinePlan:matchingCompiled,prepared:matchingPrepared});
 const matchingSelection=comparisonPlan(matchingCompiled),cols=['family','identity_json','value_json'];
 const sides=matchingPrepared.manifest.tables[0];
 function ms(path,rows){const f=matchingPrepared.files.find(x=>x.path===path);return{columns:cols.map(name=>({name,type:'text',nullable:false})),rows:rows.map(r=>cols.map(name=>({type:'text',value:r[name]}))),complete:true,source:{kind:'authored-interface-reference',path,sha256:f.sha256,recordedAt:'2026-10-13T12:28:00Z',rowCount:rows.length}};}
 const matchingObservations={schema:'slingdata.migration-observations.v1',pipelinePlanId:matchingCompiled.planId,planId:matchingSelection.planId,phase:'baseline',pendingPackages:false,failedJobs:false,completeTables:true,streams:[{streamId:matchingCompiled.acceptance[0].id,left:ms(sides.sourcePath,matching.expectedRows),right:ms(sides.expectedPath,matching.observedRows),native:null}]};
 const matchingParity=comparePipeline(matchingCompiled,matchingObservations),matchingReport=evaluateAcceptance(matchingAcceptance.compiled,matchingObservations,{parity:matchingParity});
 need(matchingParity.equal&&!matchingReport.readyForCutover,'Exact authored match cannot assert actual native completion.');
 // The same original reference, with one omitted selected family. Capture bytes remain complete.
 const missing=clone(matchingAfter);missing.files=missing.files.filter(f=>f.family!=='Queues');delete missing.captureId;missing.captureId=hash(missing);
 const known=prepareProviderMigration({capture:{...capture,after:missing},mapping:plan});
 need(known.manifest.ready,'Known absent selected object must run through original mismatch comparison.');
 bindProviderPipeline(known,sourceIds);
 const unknown=clone(missing);unknown.completeness.Queues=false;delete unknown.captureId;unknown.captureId=hash(unknown);
 const partial=prepareProviderMigration({capture:{...capture,after:unknown},mapping:plan});
 need(!partial.manifest.ready&&partial.files.length===5,'Unknown selected scope must retain all prepared inputs.');
 const unknownRejected=rejects(()=>bindProviderPipeline(partial,sourceIds),'remains unresolved');
 const changedPrepared=clone(prepared);changedPrepared.files[0].content+=' ';
 const changedPreparedRejected=rejects(()=>bindProviderPipeline(changedPrepared,sourceIds),'member differs');
 const collisionRejected=rejects(()=>bindProviderPipeline(prepared,{'inputs/planned-configuration.json':'same_id','expected/returned-configuration.json':'same_id'}),'distinct original');
 return {schema:'otobo.native-interface-course.v1',evidenceKind:'authored-reference',nativeExecuted:false,otoboImportExecuted:false,customerCaptureUsed:false,
  reference,project:reopened,projectBytes:originalProjectBytes,approvalRequest:request,prepared,input,compiled,acceptance,nonmatching,
  matching:{comparison:matching,prepared:matchingPrepared,input:matchingInput,compiled:matchingCompiled,acceptance:matchingAcceptance,observations:matchingObservations,parity:matchingParity,report:matchingReport},
  coverage:{knownMissing:known,unknown:partial},rejections:{unapproved:rejectedUnapproved,changedRequest,unknown:unknownRejected,changedPrepared:changedPreparedRejected,sourceCollision:collisionRejected},
  outcome:{status:'PASS',selectedRows:11,families:10,knownValueDifferences:2,matchingDifferences:0,approvalReplayed:true,completeProjectReopened:true,unknownNativeBindingRejected:true,actualNativeOutcome:'Not executed; native execution is unmeasured in this interface course.'}};
}

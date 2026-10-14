// SPDX-License-Identifier: MIT
// Compose into the complete current Worker text; no historical Worker is bundled.
const EDITS = [
  [
    "import { resolveOperation, metadataOperationReceipt, OperationError } from './operations.mjs';",
    "import { resolveOperation, metadataOperationReceipt, OperationError } from './operations.mjs';\nimport {projectBranchPublication,legacyBranchRecoveryCandidate,proveLegacyBranchProjection} from './branch_projection.mjs';\nimport {ensureProjectionRecoverySchema,claimBranchProjectionRecovery,ACTIVE_INCIDENT_PREDICATE} from './branch_projection_recovery.mjs';"
  ],
  [
    "  const id=input.operation_id;\n  const incidentReport=",
    "  const id=input.operation_id;\n  await ensureProjectionRecoverySchema(env.DB);\n  const incidentReport="
  ],
  [
    "    const legacyBusy=existing.state==='FAILED'",
    "    let projectionRecovered=false;\n    if(existing.state==='BLOCKED_INCIDENT' && path==='/v1/publish' && input.operation==='branch.create') {\n      const retained=await env.DB.prepare('SELECT * FROM incidents WHERE op_id=? LIMIT 2').bind(id).all();\n      const incidents=retained.results||[];\n      const incident=incidents.length===1?incidents[0]:null;\n      if(legacyBranchRecoveryCandidate({input,actor,path,row:existing,incident})) {\n        const resolved=await resolveOperation(input,providerPath=>publicationRead(token,providerPath,actor),actor,\n          (query,variables)=>github(token,'/graphql','POST',{query,variables}));\n        if(proveLegacyBranchProjection({input,actor,path,row:existing,incident,operation:resolved})) {\n          projectionRecovered=await claimBranchProjectionRecovery(env.DB,{\n            input,actor,path,row:existing,incident,operation:resolved,attemptToken:evaluationAttempt,timestamp:now()});\n          if(!projectionRecovered)return json({allow:false,operation_id:id,error:'OPERATION_IN_PROGRESS_OR_REQUIRES_RECONCILIATION'},409);\n        }\n      }\n    }\n    const legacyBusy=existing.state==='FAILED'"
  ],
  [
    "    if(recovery){\n      if(now()<recovery.not_before)",
    "    if(projectionRecovered){\n      // The same original operation now owns an audited fresh evaluation.\n    }else if(recovery){\n      if(now()<recovery.not_before)"
  ],
  [
    "AND NOT EXISTS (SELECT 1 FROM incidents WHERE op_id=?)\",evaluationAttempt",
    "AND \"+ACTIVE_INCIDENT_PREDICATE,evaluationAttempt"
  ],
  [
    "    let operation,candidate,destination,sourceContext;",
    "    let operation,candidate,destination,sourceContext,branchProjection=null;"
  ],
  [
    "      candidate={body:operation.prose.join('\\n\\n')};destination=",
    "      branchProjection=projectBranchPublication(input,operation,actor);\n      candidate=branchProjection?branchProjection.candidate:{body:operation.prose.join('\\n\\n')};destination="
  ],
  [
    "      sourceContext=sourceIncidentContext(input.operation,operation);",
    "      sourceContext=branchProjection?null:sourceIncidentContext(input.operation,operation);"
  ],
  [
    "      if(operation.metadata)metadataEvidence={metadata:operation.metadata,assessment_digest:await digest(candidate)};",
    "      if(operation.metadata)metadataEvidence={metadata:operation.metadata,assessment_digest:await digest(candidate),\n        ...(branchProjection?{content_projection:{version:branchProjection.version,kind:branchProjection.kind,binding:branchProjection.binding}}:{})};"
  ],
  [
    "    const decision=privateArchive\n",
    "    const decision=branchProjection?branchProjection.decision:privateArchive\n"
  ]
];
export function composeBranchProjectionWorker(source) {
  if(typeof source!=='string'||source.includes("from './branch_projection.mjs'"))
    throw new Error('Current uncomposed Worker source is required.');
  let output=source;
  for(const [before,after] of EDITS) {
    const at=output.indexOf(before);
    if(at<0||output.indexOf(before,at+before.length)>=0)
      throw new Error('Worker composition seam changed: '+before.slice(0,100));
    output=output.slice(0,at)+after+output.slice(at+before.length);
  }
  const version=/export const VERSION = (['"])([^'"]+)\1;/g;
  const matches=[...output.matchAll(version)];
  if(matches.length!==1)throw new Error('Worker version declaration changed.');
  const current=matches[0][2];
  output=output.replace(matches[0][0],"export const VERSION = "+JSON.stringify(current+'+branch-content-v1')+";");
  return {source:output,base_version:current,version:current+'+branch-content-v1',edits:EDITS.length};
}

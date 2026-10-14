// SPDX-License-Identifier: MIT
// Compose complete current sources; preserve unrelated installation code.
const EDITS = [
  [
    "import { resolveOperation, metadataOperationReceipt, OperationError } from './operations.mjs';",
    "import { resolveOperation, metadataOperationReceipt, OperationError } from './operations.mjs';\nimport {projectBranchPublication,legacyBranchRecoveryCandidate,proveLegacyBranchProjection} from './branch_projection.mjs';\nimport {ensureProjectionRecoverySchema,claimBranchProjectionRecovery,ACTIVE_INCIDENT_PREDICATE} from './branch_projection_recovery.mjs';\nimport {claimBranchProjectionStaleEvaluation} from './branch_projection_stale.mjs';"
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
  ],
  [
    "      const claimed=await claimStaleEvaluation(env,{operationId:id,digest:journalHash,",
    "      const claimed=await claimBranchProjectionStaleEvaluation(env,{operationId:id,digest:journalHash,"
  ]
];
const NOTICE_EDITS = [
  [
    "// Provider contracts and deployment composition: OWNER-NOTICE-DIGEST.md.",
    "// Provider contracts and deployment composition: OWNER-NOTICE-DIGEST.md.\nimport {ensureProjectionRecoverySchema} from './branch_projection_recovery.mjs';\nimport {RECOVERED_NOTICE_INCIDENT,RECOVERED_NOTICE_MEMBER,RECOVERED_INCLUDED_NOTICE,recoveredUnfrozenNotice,omitRecoveredUnfrozenMembers} from './branch_projection_notices.mjs';"
  ],
  [
    "async function ensureSchema(env) {\n  let promise",
    "async function ensureSchema(env) {\n  await ensureProjectionRecoverySchema(env.DB);\n  let promise"
  ],
  [
    "export async function queueIncidentNotice(env, incident, {forceSlack = false} = {}) {\n  await ensureSchema(env);",
    "export async function queueIncidentNotice(env, incident, {forceSlack = false} = {}) {\n  await ensureSchema(env);\n  if(await recoveredUnfrozenNotice(env.DB,incident.id))return 'projection_recovered';"
  ],
  [
    "const pending = await all(env, \"SELECT rowid AS row_number,* FROM incidents WHERE rowid<=? AND email_status IN ('pending','sending','quota_hold') ORDER BY rowid LIMIT 50\", cutoff?.row_number || 0);",
    "const pending = await all(env, \"SELECT i.rowid AS row_number,i.* FROM incidents i WHERE i.rowid<=? AND i.email_status IN ('pending','sending','quota_hold') AND NOT (\"+RECOVERED_NOTICE_INCIDENT+\") ORDER BY i.rowid LIMIT 50\", cutoff?.row_number || 0);"
  ],
  [
    "\"UPDATE owner_notice_members SET included=1 WHERE included=0 AND digest_id IN (SELECT id FROM owner_notice_digests WHERE state='prepared' AND sealed_at=? AND payload IS NULL) AND EXISTS (SELECT 1 FROM owner_notice_dispatch WHERE id='incident' AND token=? AND expires_at>?)\", at, token, at)",
    "\"UPDATE owner_notice_members SET included=1 WHERE included=0 AND digest_id IN (SELECT id FROM owner_notice_digests WHERE state='prepared' AND sealed_at=? AND payload IS NULL) AND NOT (\"+RECOVERED_NOTICE_MEMBER+\") AND EXISTS (SELECT 1 FROM owner_notice_dispatch WHERE id='incident' AND token=? AND expires_at>?)\", at, token, at)"
  ],
  [
    "async function freezePayload(env, digest) {\n  if (digest.payload) return JSON.parse(digest.payload);\n  const counts = await first(env, 'SELECT COUNT(*) AS total,SUM(CASE WHEN duplicate_of IS NULL THEN 1 ELSE 0 END) AS unique_count FROM owner_notice_members WHERE digest_id=? AND included=1', digest.id);\n  const rows = await all(env, 'SELECT i.id,i.op_id,i.reason FROM owner_notice_members m JOIN incidents i ON i.id=m.incident_id WHERE m.digest_id=? AND m.included=1 AND m.duplicate_of IS NULL ORDER BY i.id LIMIT 40', digest.id);\n  const link = ORIGIN + '/v1/notice-digests/' + digest.id;\n  const label = digest.kind === 'validation' ? 'TEST notification digest' : 'Private publication incident digest';\n  const lines = rows.map(row => 'Operation: ' + row.op_id + '\\nReason: ' + row.reason + '\\nPrivate source: ' + ORIGIN + '/v1/incidents/' + row.id);\n  const payload = {\n    member_count: Number(counts.total), unique_count: Number(counts.unique_count || 0),\n    email: {\n      from: 'TJLabs private incident notice <onboarding@resend.dev>', to: [OWNER_EMAIL],\n      subject: '[TJLabs] ' + label + ' — ' + counts.total + ' records',\n      text: 'Bryce,\\n\\n' + label + ' opened ' + new Date(digest.opened_at).toISOString() + '.\\n'\n        + counts.total + ' retained records, ' + (counts.unique_count || 0) + ' distinct proposed communications.\\n\\n'\n        + lines.join('\\n\\n') + '\\n\\nComplete private digest and original content: ' + link\n        + '\\nThis authenticated source includes all records and pagination. Existing relationship and incident decisions remain attached to their original operations.\\n'\n    },\n    slack: {\n      channel: OWNER_NOTICE_CHANNEL,\n      text: label + ': ' + counts.total + ' records retained; email capacity unavailable. Private digest ' + digest.id + ': ' + link,\n      unfurl_links: false, unfurl_media: false, mrkdwn: false\n    }\n  };\n  const encoded = JSON.stringify(payload);\n  await run(env, \"UPDATE owner_notice_digests SET payload=? WHERE id=? AND state='prepared' AND payload IS NULL\", encoded, digest.id);\n  const stored = await first(env, 'SELECT payload FROM owner_notice_digests WHERE id=?', digest.id);\n  return JSON.parse(stored.payload);\n}\n",
    "async function freezePayload(env, digest) {\n  if (digest.payload) return JSON.parse(digest.payload);\n  for(let attempt=0;attempt<3;attempt++) {\n  await omitRecoveredUnfrozenMembers(env.DB,digest.id);\n  const counts = await first(env, 'SELECT COUNT(*) AS total,SUM(CASE WHEN m.duplicate_of IS NULL OR NOT EXISTS (SELECT 1 FROM owner_notice_members p WHERE p.incident_id=m.duplicate_of AND p.digest_id=m.digest_id AND p.included=1) THEN 1 ELSE 0 END) AS unique_count FROM owner_notice_members m WHERE m.digest_id=? AND m.included=1', digest.id);\n  const rows = await all(env, 'SELECT i.id,i.op_id,i.reason FROM owner_notice_members m JOIN incidents i ON i.id=m.incident_id WHERE m.digest_id=? AND m.included=1 AND (m.duplicate_of IS NULL OR NOT EXISTS (SELECT 1 FROM owner_notice_members p WHERE p.incident_id=m.duplicate_of AND p.digest_id=m.digest_id AND p.included=1)) ORDER BY i.id LIMIT 40', digest.id);\n  const link = ORIGIN + '/v1/notice-digests/' + digest.id;\n  const label = digest.kind === 'validation' ? 'TEST notification digest' : 'Private publication incident digest';\n  const lines = rows.map(row => 'Operation: ' + row.op_id + '\\nReason: ' + row.reason + '\\nPrivate source: ' + ORIGIN + '/v1/incidents/' + row.id);\n  const payload = {\n    member_count: Number(counts.total), unique_count: Number(counts.unique_count || 0),\n    email: {\n      from: 'TJLabs private incident notice <onboarding@resend.dev>', to: [OWNER_EMAIL],\n      subject: '[TJLabs] ' + label + ' — ' + counts.total + ' records',\n      text: 'Bryce,\\n\\n' + label + ' opened ' + new Date(digest.opened_at).toISOString() + '.\\n'\n        + counts.total + ' retained records, ' + (counts.unique_count || 0) + ' distinct proposed communications.\\n\\n'\n        + lines.join('\\n\\n') + '\\n\\nComplete private digest and original content: ' + link\n        + '\\nThis authenticated source includes all records and pagination. Existing relationship and incident decisions remain attached to their original operations.\\n'\n    },\n    slack: {\n      channel: OWNER_NOTICE_CHANNEL,\n      text: label + ': ' + counts.total + ' records retained; email capacity unavailable. Private digest ' + digest.id + ': ' + link,\n      unfurl_links: false, unfurl_media: false, mrkdwn: false\n    }\n  };\n  const encoded = JSON.stringify(payload);\n  await run(env, \"UPDATE owner_notice_digests SET payload=? WHERE id=? AND state='prepared' AND payload IS NULL AND attempt_at IS NULL AND NOT (\"+RECOVERED_INCLUDED_NOTICE+\")\", encoded, digest.id);\n  const stored = await first(env, 'SELECT payload FROM owner_notice_digests WHERE id=?', digest.id);\n  if(stored?.payload)return JSON.parse(stored.payload);\n  }\n  // A recovery that races the payload CAS is recomposed on the existing drain.\n  return null;\n}\n"
  ],
  [
    "      const payload = await freezePayload(env, digest);\n      if (!payload.member_count) {",
    "      const payload = await freezePayload(env, digest);\n      if(!payload)continue;\n      if (!payload.member_count) {"
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
  output=output.replace(matches[0][0],"export const VERSION = "+JSON.stringify(current+'+branch-content-v2')+";");
  return {source:output,base_version:current,version:current+'+branch-content-v2',edits:EDITS.length};
}

export function composeBranchProjectionNotices(source) {
  if(typeof source!=='string'||source.includes("from './branch_projection_notices.mjs'"))
    throw new Error('Current uncomposed owner notice source is required.');
  let output=source;
  for(const [before,after]of NOTICE_EDITS) {
    const at=output.indexOf(before);
    if(at<0||output.indexOf(before,at+before.length)>=0)
      throw new Error('Notice composition seam changed: '+before.slice(0,100));
    output=output.slice(0,at)+after+output.slice(at+before.length);
  }
  const version=/export const OWNER_NOTICE_VERSION = (['"])([^'"]+)\1;/g;
  const matches=[...output.matchAll(version)];
  if(matches.length!==1)throw new Error('Notice version declaration changed.');
  const current=matches[0][2];
  output=output.replace(matches[0][0],"export const OWNER_NOTICE_VERSION = "+JSON.stringify(current+'+branch-content-v2')+";");
  return {source:output,base_version:current,version:current+'+branch-content-v2',edits:NOTICE_EDITS.length};
}

export function composeBranchProjectionStale(source) {
  if(typeof source!=='string'||source.includes('publication_projection_recovery'))
    throw new Error('Current uncomposed evaluation fence source is required.');
  const declaration='export async function claimStaleEvaluation(';
  const incident='AND NOT EXISTS (SELECT 1 FROM incidents WHERE op_id=?)';
  for(const seam of [declaration,incident]) {
    const at=source.indexOf(seam);
    if(at<0||source.indexOf(seam,at+seam.length)>=0)
      throw new Error('Evaluation fence composition seam changed: '+seam);
  }
  // Retain the complete module, including any helper declarations and imports.
  // A second reference would make the declaration rename ambiguous.
  if((source.match(/\bclaimStaleEvaluation\b/g)||[]).length!==1)
    throw new Error('Evaluation fence claim has additional internal references.');
  const current=source.replace(declaration,'async function claimRecoveredStaleEvaluation(')
    .replace(incident,'AND ${ACTIVE_INCIDENT_PREDICATE}');
  return {source:"// SPDX-License-Identifier: MIT\n// Generated from the complete current evaluation_fence.mjs by the composer.\nimport {claimStaleEvaluation} from './evaluation_fence.mjs';\nimport {ensureProjectionRecoverySchema,ACTIVE_INCIDENT_PREDICATE} from './branch_projection_recovery.mjs';\n\n/** Internal durable-state choice. Callers supply the original fence options. */\nexport async function claimBranchProjectionStaleEvaluation(env, options) {\n  await ensureProjectionRecoverySchema(env.DB);\n  const recovered=await env.DB.prepare(\n    \"SELECT 1 AS present FROM publication_projection_recovery p JOIN ops o ON o.op_id=p.operation_id \"+\n    \"WHERE o.op_id=? AND o.digest=? AND p.original_digest=o.digest \"+\n    \"AND p.projection_version='branch-publication-content/v1' LIMIT 1\"\n  ).bind(options.operationId,options.digest).first();\n  if(!recovered)return claimStaleEvaluation(env,options);\n  return claimRecoveredStaleEvaluation(env,options);\n}\n\n// The full current fence module follows. The recovered claim changes only its\n// name and the exact incident predicate; all other source is retained.\n"+current,edits:2};
}

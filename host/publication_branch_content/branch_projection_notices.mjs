// SPDX-License-Identifier: MIT
import {ensureProjectionRecoverySchema} from './branch_projection_recovery.mjs';

// Fixed internal aliases. No request argument controls the exclusion.
// The original incident, its digest membership and any delivered receipt remain.
export const RECOVERED_NOTICE_INCIDENT = [
  "EXISTS (SELECT 1 FROM publication_projection_recovery p JOIN ops o ON o.op_id=p.operation_id",
  "WHERE p.operation_id=i.op_id AND p.incident_id=i.id AND p.original_digest=o.digest",
  "AND p.projection_version='branch-publication-content/v1' AND i.reason='self_fault_admission'",
  "AND p.incident_content=i.content AND p.incident_destination=i.destination",
  "AND i.first_attempt IS NULL AND i.last_attempt IS NULL AND i.uncertain_since IS NULL)"
].join(' ');
export const RECOVERED_NOTICE_MEMBER = "EXISTS (SELECT 1 FROM incidents i WHERE i.id=owner_notice_members.incident_id AND "+RECOVERED_NOTICE_INCIDENT+")";
export const RECOVERED_INCLUDED_NOTICE = "EXISTS (SELECT 1 FROM owner_notice_members m JOIN incidents i ON i.id=m.incident_id WHERE m.digest_id=owner_notice_digests.id AND m.included=1 AND "+RECOVERED_NOTICE_INCIDENT+")";

/** Called after the existing notice schema initialization. */
export async function recoveredUnfrozenNotice(db,incidentId) {
  await ensureProjectionRecoverySchema(db);
  const row=await db.prepare(
    "SELECT 1 AS recovered FROM incidents i WHERE i.id=? AND "+RECOVERED_NOTICE_INCIDENT+
    " AND NOT EXISTS (SELECT 1 FROM owner_notice_members m JOIN owner_notice_digests d ON d.id=m.digest_id"+
    " WHERE m.incident_id=i.id AND (d.payload IS NOT NULL OR d.attempt_at IS NOT NULL))"
  ).bind(incidentId).first();
  return !!row;
}

/** Atomic membership exclusion ends at the first saved payload or attempt. */
export async function omitRecoveredUnfrozenMembers(db,digestId) {
  await ensureProjectionRecoverySchema(db);
  return db.prepare(
    "UPDATE owner_notice_members SET included=0 WHERE digest_id=? AND included=1 AND "+RECOVERED_NOTICE_MEMBER+
    " AND EXISTS (SELECT 1 FROM owner_notice_digests d WHERE d.id=owner_notice_members.digest_id"+
    " AND d.state IN ('collecting','prepared') AND d.payload IS NULL AND d.attempt_at IS NULL)"
  ).bind(digestId).run();
}

// One retained representative per duplicate family, including an excluded parent.
export const NOTICE_REPRESENTATIVE = "(m.duplicate_of IS NULL OR ( NOT EXISTS (SELECT 1 FROM owner_notice_members p WHERE p.incident_id=m.duplicate_of AND p.digest_id=m.digest_id AND p.included=1) AND NOT EXISTS (SELECT 1 FROM owner_notice_members s WHERE s.digest_id=m.digest_id AND s.included=1 AND s.duplicate_of=m.duplicate_of AND s.incident_id<m.incident_id) ))";

const KINDS = new Set(["verify", "update_record", "contact_authority", "schedule_review", "investigate"]);
const BANNED_CONCLUSIONS = /\b(?:compliant|non[- ]?compliant|illegal|violation|approved|denied|legal advice|must file|must pay|required by law)\b/i;

function str(v, name, max) {
  if (typeof v !== "string" || !v.trim()) throw new TypeError(`${name} must be a non-empty string`);
  if (v.length > max) throw new RangeError(`${name} too long`);
  return v.normalize("NFC").trim();
}

export function validateChecklistDraft(change, draft) {
  if (!change || typeof change.changeId !== "string") throw new TypeError("evidence change required");
  if (!Array.isArray(draft) || draft.length === 0 || draft.length > 12) throw new TypeError("draft must contain 1..12 items");
  const allowedEvidence = new Set([change.beforeDigest, change.afterDigest]);
  return draft.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError(`item ${index} must be an object`);
    const kind = str(raw.kind, `item ${index}.kind`, 40);
    if (!KINDS.has(kind)) throw new TypeError(`item ${index}.kind unsupported`);
    const title = str(raw.title, `item ${index}.title`, 180);
    const why = str(raw.why, `item ${index}.why`, 600);
    if (BANNED_CONCLUSIONS.test(`${title} ${why}`)) throw new TypeError(`item ${index} contains an unsupported compliance/legal conclusion`);
    if (!Array.isArray(raw.evidenceDigests) || raw.evidenceDigests.length === 0) throw new TypeError(`item ${index} needs evidenceDigests`);
    const evidenceDigests = [...new Set(raw.evidenceDigests.map((d) => str(d, `item ${index}.evidenceDigest`, 64)))];
    for (const digest of evidenceDigests) if (!allowedEvidence.has(digest)) throw new TypeError(`item ${index} cites unknown evidence`);
    if (!evidenceDigests.includes(change.afterDigest)) throw new TypeError(`item ${index} must cite the current snapshot`);
    return {
      checklistId: `${change.changeId}:${index + 1}`,
      sourceChangeId: change.changeId,
      kind,
      title,
      why,
      evidenceDigests,
      status: "needs_owner_review",
      authority: "advisory_workflow_only",
    };
  });
}

export function ownerApproveChecklistItem(item, { approvedBy, approvedAt }) {
  if (!item || item.status !== "needs_owner_review") throw new TypeError("item is not awaiting owner review");
  const who = str(approvedBy, "approvedBy", 200);
  const when = new Date(approvedAt);
  if (!Number.isFinite(when.valueOf())) throw new TypeError("approvedAt must be a timestamp");
  return { ...item, status: "owner_approved", approvedBy: who, approvedAt: when.toISOString() };
}

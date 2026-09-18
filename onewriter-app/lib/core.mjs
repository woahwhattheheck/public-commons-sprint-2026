import { createHash } from "node:crypto";
import tr46 from "tr46";
import { caseFold } from "unicode-case-folding";

export class ContractError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ContractError";
    this.status = status;
  }
}

export const STATES = ["CLEAR", "LEASED", "HARD_DNR", "DEAD_ROUTE", "HUMAN_EVENT_REOPEN", "HOLD"];
export const EVENT_KINDS = ["CLAIM", "SENT", "BOUNCE", "HUMAN_EVENT", "HOLD"];
export const AUTHORITY = Object.freeze({
  email_send_authorized: false,
  dm_send_authorized: false,
  form_submit_authorized: false,
  provider_mutation_authorized: false,
  contract_authorized: false,
  signature_authorized: false,
  payment_authorized: false,
  cash_or_revenue_authorized: false,
  contest_submission_authorized: false,
});
export const IDENTIFIER_MAX = 240;

const NON_C_DEFAULT_IGNORABLE = [
  [0x034f, 0x034f], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180d],
  [0x180f, 0x180f], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xffa0, 0xffa0],
  [0xe0100, 0xe01ef],
];
const CATEGORY_C = /\p{C}/u;
const NON_BASE = /[\p{C}\p{M}\p{Z}]/u;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const CANONICAL_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

export function requireCondition(ok, message, status = 400) {
  if (!ok) throw new ContractError(message, status);
}

export function requireExactKeys(value, keys, name = "input") {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  requireCondition(actual.length === expected.length && actual.every((key, i) => key === expected[i]), `${name} key set changed`);
}

export function canonicalJson(value) {
  function normalize(input) {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      requireCondition(Number.isFinite(input), "non-finite number forbidden");
      return input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    requireCondition(typeof input === "object", "non-JSON value forbidden");
    const out = {};
    for (const key of Object.keys(input).sort()) out[key] = normalize(input[key]);
    return out;
  }
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value), "utf8").digest("hex");
}

export function strictText(value, name, { max = 240, casefold = false } = {}) {
  requireCondition(typeof value === "string", `${name} must be a string`);
  const collapsed = value.trim().replace(/\s+/gu, " ");
  const normalized = casefold ? caseFold(collapsed) : collapsed;
  requireCondition(normalized.length > 0 && Array.from(normalized).length <= max, `${name} invalid`);
  return normalized;
}

function requireCollisionIdentityText(value, name) {
  const chars = Array.from(value);
  requireCondition(
    !chars.some((ch) => CATEGORY_C.test(ch)),
    `${name} contains non-visible Unicode control/format/private/unassigned codepoints`,
  );
  requireCondition(
    !chars.some(isNonCategoryCDefaultIgnorable),
    `${name} contains Unicode Default_Ignorable codepoints`,
  );
  requireCondition(
    chars.some((ch) => !NON_BASE.test(ch)),
    `${name} must contain at least one visible base codepoint`,
  );
}

export function normalizeText(value, name) {
  requireCondition(typeof value === "string", `${name} must be a string`);
  const canonical = value.normalize("NFC");
  requireCollisionIdentityText(canonical, name);
  const collapsed = canonical.trim().replace(/\s+/gu, " ");
  const normalized = caseFold(collapsed).normalize("NFC");
  requireCondition(
    normalized.length > 0 && Array.from(normalized).length <= 240,
    `${name} invalid`,
  );
  requireCollisionIdentityText(normalized, name);
  return normalized;
}

export function normalizeRoute(value) {
  return strictText(value, "route", { casefold: true });
}

export function normalizeDomain(value) {
  requireCondition(typeof value === "string", "domain must be a string");
  const raw = value.trim();
  requireCondition(raw.length > 0, "domain shape invalid");
  const withoutScheme = raw.replace(SCHEME, "");
  const authority = withoutScheme.split(/[/?#]/u, 1)[0];
  requireCondition(authority.length > 0, "domain shape invalid");
  requireCondition(!authority.includes("@"), "domain credentials forbidden");
  requireCondition(!authority.includes(":"), "domain port forbidden");
  let unicodeHost = authority.replace(/\.$/u, "");
  if (unicodeHost.toLowerCase().startsWith("www.")) unicodeHost = unicodeHost.slice(4);
  const host = tr46.toASCII(unicodeHost, {
    checkBidi: true,
    checkHyphens: true,
    checkJoiners: true,
    ignoreInvalidPunycode: false,
    transitionalProcessing: true,
    useSTD3ASCIIRules: true,
    verifyDNSLength: true,
  });
  requireCondition(typeof host === "string" && host.length > 0 && host.length <= 253 && host.includes(".") && !/\s|@/u.test(host), "domain shape invalid");
  return host.toLowerCase();
}

function isNonCategoryCDefaultIgnorable(ch) {
  const cp = ch.codePointAt(0);
  return NON_C_DEFAULT_IGNORABLE.some(([lo, hi]) => cp >= lo && cp <= hi);
}

export function validateIdentifier(value, name = "identifier") {
  requireCondition(typeof value === "string", `${name} must be a string`);
  const chars = Array.from(value);
  requireCondition(value === value.trim() && chars.length >= 1 && chars.length <= IDENTIFIER_MAX, `${name} must be trimmed nonempty text <= ${IDENTIFIER_MAX} chars`);
  requireCondition(!chars.some((ch) => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127), `${name} contains control characters`);
  requireCondition(!chars.some((ch) => ch.codePointAt(0) > 127 && CATEGORY_C.test(ch)), `${name} contains non-visible Unicode control/format/private/unassigned codepoints`);
  requireCondition(!chars.some(isNonCategoryCDefaultIgnorable), `${name} contains Unicode Default_Ignorable codepoints`);
  requireCondition(chars.some((ch) => !NON_BASE.test(ch)), `${name} must contain at least one visible base codepoint`);
  return value;
}

export function validateCanonicalId(value, name = "canonical id") {
  requireCondition(typeof value === "string" && CANONICAL_ID_RE.test(value), `${name} must be stable lowercase ASCII id text`);
  return value;
}

export function normalizeIdentity(input) {
  return {
    org: normalizeText(input.org, "org"),
    domain: normalizeDomain(input.domain),
    purpose: normalizeText(input.purpose, "purpose"),
    opportunity: normalizeText(input.opportunity, "opportunity"),
  };
}

export function collisionKeyFromCanonical(canonical) {
  requireExactKeys(
    canonical,
    ["org_id", "purpose_id", "opportunity_id"],
    "canonical lane identity",
  );
  return sha256Hex({
    org_id: validateCanonicalId(canonical.org_id, "org_id"),
    purpose_id: validateCanonicalId(canonical.purpose_id, "purpose_id"),
    opportunity_id: validateCanonicalId(canonical.opportunity_id, "opportunity_id"),
  });
}

export function validateLeaseSeconds(value) {
  requireCondition(Number.isInteger(value) && value >= 30 && value <= 1800, "lease_seconds must be an integer from 30 to 1800");
  return value;
}

export function validateActor(value) {
  return strictText(value, "actor", { max: 240, casefold: false });
}

export function validateReason(value) {
  return strictText(value, "reason", { max: 1000, casefold: false });
}

export function acceptedEvent({ eventId, atUtc, kind, actor, identity, canonicalIdentity, requestedLaneId, collisionKey: key, route, leaseSeconds = null, providerReceipt = null, humanEvidenceId = null, reason }) {
  return {
    event_id: eventId,
    at_utc: atUtc,
    kind,
    actor,
    identity,
    canonical_identity: canonicalIdentity,
    requested_lane_id: requestedLaneId,
    collision_key: key,
    event_route: route,
    lease_seconds: leaseSeconds,
    provider_receipt: providerReceipt,
    human_evidence_id: humanEvidenceId,
    reason,
  };
}

export function makeReceipt({ position = null, accepted, priorState, decision, state, laneRoute, reopenExpiryRefenced }) {
  const acceptedHash = sha256Hex(accepted);
  const semantic = {
    position,
    event_id: accepted.event_id,
    at_utc: accepted.at_utc,
    actor: accepted.actor,
    collision_key: accepted.collision_key,
    event_route: accepted.event_route,
    lane_route: laneRoute,
    prior_state: priorState,
    decision,
    state,
    reopen_expiry_refenced: Boolean(reopenExpiryRefenced),
    accepted_event: accepted,
    accepted_event_sha256: acceptedHash,
    external_send_authorized: false,
  };
  return { ...semantic, receipt_sha256: sha256Hex(semantic) };
}

export function effectiveExpiredHumanLease(lane, now) {
  if (!lane || lane.state !== "LEASED" || !lane.reopen_from_state || !lane.lease_until) return null;
  const until = lane.lease_until instanceof Date ? lane.lease_until : new Date(lane.lease_until);
  if (now < until) return null;
  return {
    ...lane,
    state: lane.reopen_from_state,
    holder: null,
    lease_until: null,
    leased_route: lane.reopen_from_route,
    reopen_from_state: null,
    reopen_from_route: null,
  };
}

export function impactFromEvents(events) {
  const metrics = {
    claim_attempts: 0,
    claims_granted: 0,
    collisions_prevented: 0,
    duplicate_touches_prevented: 0,
    stale_lanes_recovered: 0,
    sent_hard_fences: 0,
    dead_routes_recorded: 0,
    human_reopens: 0,
    holds_recorded: 0,
  };
  for (const event of events) {
    if (event.kind === "CLAIM") metrics.claim_attempts += 1;
    if (["GRANTED", "GRANTED_STALE_RECOVERY", "GRANTED_AFTER_HUMAN_EVENT"].includes(event.decision)) metrics.claims_granted += 1;
    if (event.decision === "DENIED_ACTIVE_LEASE") {
      metrics.collisions_prevented += 1;
      metrics.duplicate_touches_prevented += 1;
    }
    if (["DENIED_HARD_DNR", "DENIED_DEAD_ROUTE", "DENIED_HOLD"].includes(event.decision)) metrics.duplicate_touches_prevented += 1;
    if (event.decision === "GRANTED_STALE_RECOVERY") metrics.stale_lanes_recovered += 1;
    if (event.decision === "RECORDED_SENT") metrics.sent_hard_fences += 1;
    if (event.decision === "RECORDED_DEAD_ROUTE") metrics.dead_routes_recorded += 1;
    if (event.decision === "REOPENED_HUMAN_EVENT") metrics.human_reopens += 1;
    if (event.decision === "RECORDED_HOLD") metrics.holds_recorded += 1;
  }
  return metrics;
}

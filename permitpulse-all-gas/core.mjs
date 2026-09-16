const MAX_SOURCE_BYTES = 900_000;
const MAX_DIFF_LINES = 2_000;
const SNAPSHOT_KEYS = new Set(["sourceUrl", "jurisdiction", "title", "fetchedAt", "content", "etag"]);

function requireString(value, name, { max = 100_000, allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const normalized = value.normalize("NFC");
  if (!allowEmpty && normalized.trim().length === 0) throw new TypeError(`${name} must not be empty`);
  if (normalized.length > max) throw new RangeError(`${name} exceeds ${max} characters`);
  return normalized;
}

export function assertHttpsUrl(value, name = "url") {
  const text = requireString(value, name, { max: 2_048 });
  let parsed;
  try { parsed = new URL(text); } catch { throw new TypeError(`${name} must be an absolute URL`); }
  if (parsed.protocol !== "https:") throw new TypeError(`${name} must use https`);
  if (parsed.username || parsed.password) throw new TypeError(`${name} must not embed credentials`);
  parsed.hash = "";
  return parsed.toString();
}

export function canonicalizeContent(value) {
  const text = requireString(value, "content", { max: MAX_SOURCE_BYTES, allowEmpty: false });
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim();
}

function strictClone(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => strictClone(item, `${path}[${i}]`));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${path} must contain plain JSON values only`);
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`${path}.${key} must not be undefined`);
    out[key] = strictClone(value[key], `${path}.${key}`);
  }
  return out;
}

export function stableJson(value) { return JSON.stringify(strictClone(value)); }

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : stableJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseIsoInstant(value, name) {
  const text = requireString(value, name, { max: 64 });
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new TypeError(`${name} must be an ISO timestamp`);
  return new Date(ms).toISOString();
}

export async function normalizeOfficialSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("snapshot must be an object");
  for (const key of Object.keys(input)) if (!SNAPSHOT_KEYS.has(key)) throw new TypeError(`unknown snapshot field: ${key}`);
  const sourceUrl = assertHttpsUrl(input.sourceUrl, "sourceUrl");
  const jurisdiction = requireString(input.jurisdiction, "jurisdiction", { max: 200 });
  const title = requireString(input.title, "title", { max: 500 });
  const fetchedAt = parseIsoInstant(input.fetchedAt, "fetchedAt");
  const content = canonicalizeContent(input.content);
  const etag = input.etag === undefined ? null : requireString(input.etag, "etag", { max: 500, allowEmpty: true });
  const contentDigest = await sha256Hex(content);
  return { sourceUrl, jurisdiction, title, fetchedAt, content, etag, contentDigest };
}

function lineChanges(before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  if (left.length > MAX_DIFF_LINES || right.length > MAX_DIFF_LINES) {
    return { strategy: "digest_only", removed: [], added: [], bounded: true };
  }
  const leftCounts = new Map();
  const rightCounts = new Map();
  for (const line of left) leftCounts.set(line, (leftCounts.get(line) ?? 0) + 1);
  for (const line of right) rightCounts.set(line, (rightCounts.get(line) ?? 0) + 1);
  const removed = [];
  const added = [];
  const rightRemaining = new Map(rightCounts);
  for (const line of left) {
    const n = rightRemaining.get(line) ?? 0;
    if (n) rightRemaining.set(line, n - 1); else removed.push(line);
  }
  const leftRemaining = new Map(leftCounts);
  for (const line of right) {
    const n = leftRemaining.get(line) ?? 0;
    if (n) leftRemaining.set(line, n - 1); else added.push(line);
  }
  return { strategy: "multiset_lines", removed: removed.slice(0, 40), added: added.slice(0, 40), bounded: removed.length > 40 || added.length > 40 };
}

export async function buildEvidenceChange(previous, current) {
  if (!previous || !current) throw new TypeError("both snapshots are required");
  if (previous.sourceUrl !== current.sourceUrl) throw new TypeError("snapshot sourceUrl mismatch");
  if (previous.jurisdiction !== current.jurisdiction) throw new TypeError("snapshot jurisdiction mismatch");
  if (Date.parse(current.fetchedAt) < Date.parse(previous.fetchedAt)) throw new TypeError("snapshot chronology regressed");
  if (previous.contentDigest === current.contentDigest) return null;
  const diff = lineChanges(previous.content, current.content);
  const identity = {
    sourceUrl: current.sourceUrl,
    jurisdiction: current.jurisdiction,
    beforeDigest: previous.contentDigest,
    afterDigest: current.contentDigest,
  };
  return {
    changeId: await sha256Hex(identity),
    ...identity,
    observedAt: current.fetchedAt,
    title: current.title,
    diff,
    evidence: [
      { role: "before", digest: previous.contentDigest, fetchedAt: previous.fetchedAt, sourceUrl: previous.sourceUrl },
      { role: "after", digest: current.contentDigest, fetchedAt: current.fetchedAt, sourceUrl: current.sourceUrl },
    ],
    interpretation: "owner_review_required",
  };
}

export function publicSnapshot(snapshot) {
  return {
    sourceUrl: snapshot.sourceUrl,
    jurisdiction: snapshot.jurisdiction,
    title: snapshot.title,
    fetchedAt: snapshot.fetchedAt,
    contentDigest: snapshot.contentDigest,
  };
}

const TOP_LEVEL_KEYS = [
  "format", "operation", "source", "officialRules", "externalReceipts",
  "readyForSubmission", "truthBoundary",
];
const SOURCE_KEYS = [
  "stagingRepo", "stagingDirectory", "sourceMergeCommit", "sourceManifest", "sourceGeneration",
];
const REQUIRED_RULE_IDS = new Set([
  "public_repo", "root_hackathon_md", "convex_backend", "live_convex_or_chatgpt_url",
  "real_openai_work", "real_firecrawl_work", "real_agentmail_work", "social_build_post",
  "video_under_180_seconds", "vibeapps_submission",
]);
const RECEIPT_IDS = [
  "public_repo", "root_hackathon_md", "luma_registration", "convex_backend_live",
  "live_public_url", "firecrawl_live_work", "agentmail_live_work", "openai_live_work",
  "social_build_post", "demo_video", "vibeapps_submission",
];
const SHA256_RE = /^[0-9a-f]{64}$/;
const HTTPS_RE = /^https:\/\//;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message) { throw new Error(message); }
function exactKeys(obj, expected, label) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) fail(`${label} must be an object`);
  const actual = Object.keys(obj).sort();
  const want = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(want)) fail(`${label} keys mismatch: ${actual.join(",")}`);
}
function nonempty(value) { return typeof value === "string" && value.length > 0; }
function canonicalUtc(value, label) {
  if (!nonempty(value) || !UTC_RE.test(value) || Number.isNaN(Date.parse(value))) fail(`${label} must be canonical UTC`);
  return value;
}

export function validateReadiness(readiness, demo) {
  exactKeys(readiness, TOP_LEVEL_KEYS, "readiness");
  if (readiness.format !== "permitpulse-submission-readiness-v2") fail("unexpected readiness format");
  if (!nonempty(readiness.operation)) fail("missing operation");
  if (readiness.truthBoundary !== "SOURCE_TEST_DEMO_EXTERNAL_RECEIPTS_GATED") fail("truth boundary widened");

  exactKeys(readiness.source, SOURCE_KEYS, "source");
  if (readiness.source.stagingRepo !== "woahwhattheheck/public-commons-sprint-2026") fail("staging repo changed");
  if (readiness.source.stagingDirectory !== "permitpulse-all-gas") fail("staging directory changed");
  if (readiness.source.sourceMergeCommit !== "5da9e9d7a46e389d29afc15112e477db829ec62f") fail("source ancestry changed");
  if (readiness.source.sourceManifest !== "permitpulse-all-gas/SOURCE_MANIFEST.json") fail("source manifest path changed");
  if (!SHA256_RE.test(readiness.source.sourceGeneration)) fail("sourceGeneration must be lowercase sha256");

  if (readiness.officialRules?.url !== "https://www.convex.dev/hackathons/all-gas") fail("official rules authority changed");
  canonicalUtc(`${readiness.officialRules?.deadline ? new Date(readiness.officialRules.deadline).toISOString() : ""}`, "deadline");
  if (readiness.officialRules?.deadline !== "2026-09-22T12:00:00-07:00") fail("deadline mismatch");
  if (JSON.stringify(readiness.officialRules?.cashPrizesUsd) !== JSON.stringify([10000,5000,1500])) fail("cash prize schedule mismatch");
  const rules = readiness.officialRules?.requirements ?? [];
  if (new Set(rules).size !== REQUIRED_RULE_IDS.size || !rules.every((x) => REQUIRED_RULE_IDS.has(x))) fail("official requirement set mismatch");

  if (!Array.isArray(readiness.externalReceipts) || readiness.externalReceipts.length !== RECEIPT_IDS.length) fail("receipt ledger cardinality mismatch");
  const seen = new Set();
  for (const row of readiness.externalReceipts) {
    exactKeys(row, ["id","required","status","evidence"], `receipt ${row?.id ?? "?"}`);
    if (!RECEIPT_IDS.includes(row.id) || seen.has(row.id)) fail(`invalid/duplicate receipt id: ${row.id}`);
    seen.add(row.id);
    if (typeof row.required !== "boolean") fail(`required must be boolean: ${row.id}`);
    if (!Array.isArray(row.evidence)) fail(`evidence must be array: ${row.id}`);
    if (!["OPEN","VERIFIED"].includes(row.status)) fail(`bad receipt status: ${row.id}`);
    if (row.status === "OPEN" && row.evidence.length !== 0) fail(`OPEN receipt carries evidence: ${row.id}`);
    if (row.status === "VERIFIED") {
      if (row.evidence.length === 0) fail(`VERIFIED receipt lacks evidence: ${row.id}`);
      for (const ev of row.evidence) {
        exactKeys(ev, ["provider","url","capturedAt","sourceGeneration"], `evidence ${row.id}`);
        if (![ev.provider,ev.url,ev.capturedAt,ev.sourceGeneration].every(nonempty)) fail(`empty evidence field: ${row.id}`);
        if (!HTTPS_RE.test(ev.url)) fail(`non-https evidence URL: ${row.id}`);
        canonicalUtc(ev.capturedAt, `evidence capturedAt ${row.id}`);
        if (ev.sourceGeneration !== readiness.source.sourceGeneration) fail(`source generation mismatch: ${row.id}`);
      }
    }
  }
  if (!RECEIPT_IDS.every((id) => seen.has(id))) fail("missing receipt id");
  const computedReady = readiness.externalReceipts.filter((r) => r.required).every((r) => r.status === "VERIFIED");
  if (readiness.readyForSubmission !== computedReady) fail("readyForSubmission does not match required receipts");

  if (demo.format !== "permitpulse-demo-plan-v1") fail("unexpected demo format");
  if (!Number.isInteger(demo.targetSeconds) || demo.targetSeconds <= 0 || demo.targetSeconds >= 180) fail("demo target must be 1..179 seconds");
  if (!Array.isArray(demo.scenes) || demo.scenes.length < 5) fail("demo scenes missing");
  let previousEnd = 0;
  for (const [index, scene] of demo.scenes.entries()) {
    exactKeys(scene, ["start","end","title","proof"], `scene ${index}`);
    if (!Number.isInteger(scene.start) || !Number.isInteger(scene.end) || scene.start !== previousEnd || scene.end <= scene.start) fail(`non-contiguous demo scene ${index}`);
    if (!nonempty(scene.title) || !nonempty(scene.proof)) fail(`empty demo scene ${index}`);
    previousEnd = scene.end;
  }
  if (previousEnd !== demo.targetSeconds || previousEnd >= 180) fail("demo plan duration mismatch");

  return {
    readyForSubmission: computedReady,
    receiptCount: readiness.externalReceipts.length,
    verifiedRequired: readiness.externalReceipts.filter((r) => r.required && r.status === "VERIFIED").length,
    requiredCount: readiness.externalReceipts.filter((r) => r.required).length,
    sourceGeneration: readiness.source.sourceGeneration,
  };
}

export const receiptIds = Object.freeze([...RECEIPT_IDS]);

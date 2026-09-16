import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readinessPath = path.join(root, "submission", "READINESS.json");
const demoPlanPath = path.join(root, "submission", "DEMO_PLAN.json");
const readiness = JSON.parse(await fs.readFile(readinessPath, "utf8"));
const demo = JSON.parse(await fs.readFile(demoPlanPath, "utf8"));

function fail(message) { throw new Error(message); }
function exactKeys(obj, expected, label) {
  const actual = Object.keys(obj).sort();
  const want = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(want)) fail(`${label} keys mismatch: ${actual.join(",")}`);
}
function isString(value) { return typeof value === "string" && value.length > 0; }

exactKeys(readiness, ["format","operation","source","officialRules","externalReceipts","readyForSubmission","truthBoundary"], "readiness");
if (readiness.format !== "permitpulse-submission-readiness-v1") fail("unexpected readiness format");
if (readiness.operation !== "PERMITPULSE-LAST-MILE-SUBMISSION-CARRIER-ZSOL-20260916") fail("unexpected operation");
if (readiness.truthBoundary !== "SOURCE_TEST_DEMO_STAGING_ONLY") fail("truth boundary widened");
if (readiness.source?.sourceMergeCommit !== "5da9e9d7a46e389d29afc15112e477db829ec62f") fail("source generation changed");
if (readiness.source?.sourceManifest !== "permitpulse-all-gas/SOURCE_MANIFEST.json") fail("source manifest path changed");
if (readiness.officialRules?.url !== "https://www.convex.dev/hackathons/all-gas") fail("official rules authority changed");
if (readiness.officialRules?.deadline !== "2026-09-22T12:00:00-07:00") fail("deadline mismatch");
if (JSON.stringify(readiness.officialRules?.cashPrizesUsd) !== JSON.stringify([10000,5000,1500])) fail("cash prize schedule mismatch");

const requiredRuleIds = new Set(["public_repo","root_hackathon_md","convex_backend","live_convex_or_chatgpt_url","real_openai_work","real_firecrawl_work","real_agentmail_work","social_build_post","video_under_180_seconds","vibeapps_submission"]);
if (new Set(readiness.officialRules?.requirements ?? []).size !== requiredRuleIds.size || !(readiness.officialRules?.requirements ?? []).every((x) => requiredRuleIds.has(x))) fail("official requirement set mismatch");

const receiptIds = ["public_repo","root_hackathon_md","luma_registration","convex_backend_live","live_public_url","firecrawl_live_work","agentmail_live_work","openai_live_work","social_build_post","demo_video","vibeapps_submission"];
if (!Array.isArray(readiness.externalReceipts) || readiness.externalReceipts.length !== receiptIds.length) fail("receipt ledger cardinality mismatch");
const seen = new Set();
for (const row of readiness.externalReceipts) {
  exactKeys(row, ["id","required","status","evidence"], `receipt ${row?.id ?? "?"}`);
  if (!receiptIds.includes(row.id) || seen.has(row.id)) fail(`invalid/duplicate receipt id: ${row.id}`);
  seen.add(row.id);
  if (typeof row.required !== "boolean") fail(`required must be boolean: ${row.id}`);
  if (!Array.isArray(row.evidence)) fail(`evidence must be array: ${row.id}`);
  if (!["OPEN","VERIFIED"].includes(row.status)) fail(`bad receipt status: ${row.id}`);
  if (row.status === "OPEN" && row.evidence.length !== 0) fail(`OPEN receipt carries evidence: ${row.id}`);
  if (row.status === "VERIFIED") {
    if (row.evidence.length === 0) fail(`VERIFIED receipt lacks evidence: ${row.id}`);
    for (const ev of row.evidence) {
      exactKeys(ev, ["provider","url","capturedAt","sourceGeneration"], `evidence ${row.id}`);
      if (![ev.provider, ev.url, ev.capturedAt, ev.sourceGeneration].every(isString)) fail(`empty evidence field: ${row.id}`);
      if (!/^https:\/\//.test(ev.url)) fail(`non-https evidence URL: ${row.id}`);
    }
  }
}
if (!receiptIds.every((id) => seen.has(id))) fail("missing receipt id");
const computedReady = readiness.externalReceipts.filter((r) => r.required).every((r) => r.status === "VERIFIED");
if (readiness.readyForSubmission !== computedReady) fail("readyForSubmission does not match required receipts");
if (readiness.readyForSubmission !== false) fail("staging carrier must not claim submission readiness without external receipts");

if (demo.format !== "permitpulse-demo-plan-v1") fail("unexpected demo format");
if (!Number.isInteger(demo.targetSeconds) || demo.targetSeconds <= 0 || demo.targetSeconds >= 180) fail("demo target must be 1..179 seconds");
if (!Array.isArray(demo.scenes) || demo.scenes.length < 5) fail("demo scenes missing");
let previousEnd = 0;
for (const [index, scene] of demo.scenes.entries()) {
  exactKeys(scene, ["start","end","title","proof"], `scene ${index}`);
  if (!Number.isInteger(scene.start) || !Number.isInteger(scene.end) || scene.start !== previousEnd || scene.end <= scene.start) fail(`non-contiguous demo scene ${index}`);
  if (!isString(scene.title) || !isString(scene.proof)) fail(`empty demo scene ${index}`);
  previousEnd = scene.end;
}
if (previousEnd !== demo.targetSeconds || previousEnd >= 180) fail("demo plan duration mismatch");

for (const relative of ["submission/DEMO_SCRIPT.md","submission/SUBMISSION_COPY.md","submission/CAPABILITY_MATRIX.md"]) {
  const text = await fs.readFile(path.join(root, relative), "utf8");
  if (text.length < 300) fail(`${relative} unexpectedly short`);
  if (/\b(PAID|WINNER|SUBMITTED|LIVE)\b/.test(text) && !/\bOPEN\b/.test(text)) fail(`${relative} may overclaim provider state`);
}

console.log(`submission-readiness PASS (${readiness.externalReceipts.length} receipt lanes; demo ${demo.targetSeconds}s; ready=${readiness.readyForSubmission})`);

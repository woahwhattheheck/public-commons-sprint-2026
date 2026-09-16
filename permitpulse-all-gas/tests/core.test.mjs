import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { normalizeOfficialSnapshot, buildEvidenceChange, stableJson, assertHttpsUrl } from "../core.mjs";
import { validateChecklistDraft, ownerApproveChecklistItem } from "../checklist.mjs";
import { normalizeInboundNotice, routeNoticeToSources } from "../inbox.mjs";
import { firecrawlToSnapshot, agentMailToNotice, buildOpenAiChecklistRequest, openAiResponseToChecklist } from "../provider-contracts.mjs";

const demo = JSON.parse(await fs.readFile(new URL("../fixtures/demo.json", import.meta.url), "utf8"));
async function pipeline() {
  const before = await normalizeOfficialSnapshot(demo.before);
  const after = await normalizeOfficialSnapshot(demo.after);
  const change = await buildEvidenceChange(before, after);
  return { before, after, change };
}

test("snapshot canonicalization is deterministic", async () => {
  const a = await normalizeOfficialSnapshot({ ...demo.before, content: demo.before.content.replace(/\n/g, "\r\n") + "  \n" });
  const b = await normalizeOfficialSnapshot(demo.before);
  assert.equal(a.contentDigest, b.contentDigest);
});

test("snapshot rejects non-HTTPS and unknown fields", async () => {
  await assert.rejects(() => normalizeOfficialSnapshot({ ...demo.before, sourceUrl: "http://example.gov/x" }), /https/);
  await assert.rejects(() => normalizeOfficialSnapshot({ ...demo.before, legalStatus: "compliant" }), /unknown snapshot field/);
});

test("stable JSON rejects silent undefined/non-finite aliases", () => {
  assert.throws(() => stableJson({ a: undefined }), /undefined/);
  assert.throws(() => stableJson({ n: NaN }), /non-finite/);
  assert.equal(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("evidence change binds before and after digests", async () => {
  const { before, after, change } = await pipeline();
  assert.equal(change.beforeDigest, before.contentDigest);
  assert.equal(change.afterDigest, after.contentDigest);
  assert.equal(change.interpretation, "owner_review_required");
  assert.match(change.diff.added.join("\n"), /5 business days/);
});

test("identical snapshots do not invent changes", async () => {
  const before = await normalizeOfficialSnapshot(demo.before);
  const later = await normalizeOfficialSnapshot({ ...demo.before, fetchedAt: "2026-09-16T12:00:00Z" });
  assert.equal(await buildEvidenceChange(before, later), null);
});

test("chronology regression fails closed", async () => {
  const before = await normalizeOfficialSnapshot(demo.after);
  const older = await normalizeOfficialSnapshot(demo.before);
  await assert.rejects(() => buildEvidenceChange(before, older), /chronology regressed/);
});

test("checklist requires current evidence and human review", async () => {
  const { after, change } = await pipeline();
  const draft = demo.checklist.map((x) => ({ ...x, evidenceDigests: [after.contentDigest] }));
  const items = validateChecklistDraft(change, draft);
  assert.equal(items[0].status, "needs_owner_review");
  assert.equal(items[0].authority, "advisory_workflow_only");
  const approved = ownerApproveChecklistItem(items[0], { approvedBy: "Demo Owner", approvedAt: "2026-09-16T13:00:00Z" });
  assert.equal(approved.status, "owner_approved");
});

test("checklist rejects fabricated evidence and legal conclusions", async () => {
  const { after, change } = await pipeline();
  assert.throws(() => validateChecklistDraft(change, [{ kind: "verify", title: "Check source", why: "Review change", evidenceDigests: ["0".repeat(64)] }]), /unknown evidence/);
  assert.throws(() => validateChecklistDraft(change, [{ kind: "verify", title: "You are non-compliant", why: "AI decided", evidenceDigests: [after.contentDigest] }]), /unsupported compliance/);
});

test("inbound notice dedupes URLs and routes only by configured source host", async () => {
  const notice = await normalizeInboundNotice({ ...demo.inbox, text: demo.inbox.text + " Also https://permits.example.gov/food-service/renewals." });
  assert.equal(notice.urls.length, 1);
  const routes = routeNoticeToSources(notice, [
    { sourceId: "right", sourceUrl: demo.before.sourceUrl },
    { sourceId: "wrong", sourceUrl: "https://other.example.gov/rules" },
  ]);
  assert.deepEqual(routes.map((x) => x.sourceId), ["right"]);
  assert.equal(notice.authority, "inbound_evidence_only");
});

test("Firecrawl adapter requires content and source identity", async () => {
  const payload = { data: { markdown: demo.after.content, metadata: { sourceURL: demo.after.sourceUrl } } };
  const snap = await firecrawlToSnapshot(payload, { ...demo.after });
  assert.equal(snap.sourceUrl, assertHttpsUrl(demo.after.sourceUrl));
  await assert.rejects(() => firecrawlToSnapshot({ data: { markdown: "x", metadata: { sourceURL: "https://evil.example/x" } } }, demo.after), /does not match/);
});

test("AgentMail adapter preserves inbound-only authority", async () => {
  const notice = await agentMailToNotice({ eventId: "evt1", message: { message_id: "m1", thread_id: "t1", from: { email: "notice@example.gov" }, subject: "Update", text: "See https://permits.example.gov/x", created_at: "2026-09-16T12:00:00Z" } });
  assert.equal(notice.authority, "inbound_evidence_only");
  assert.equal(notice.urls.length, 1);
});

test("OpenAI request contains safety boundary and parsed checklist is evidence-bound", async () => {
  const { after, change } = await pipeline();
  const request = buildOpenAiChecklistRequest(change);
  assert.match(request.input[0].content, /Never decide legal compliance/);
  const response = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ items: [{ kind: "investigate", title: "Review changed scheduling text", why: "Confirm operational impact with the source owner.", evidenceDigests: [after.contentDigest] }] }) }] }] };
  const items = openAiResponseToChecklist(change, response);
  assert.equal(items[0].status, "needs_owner_review");
});

test("staging source contains no outbound AgentMail send path", async () => {
  const inbox = await fs.readFile(new URL("../convex/inbox.ts", import.meta.url), "utf8");
  const http = await fs.readFile(new URL("../convex/http.ts", import.meta.url), "utf8");
  assert.doesNotMatch(inbox + http, /\.sendMessage\(|\.replyToMessage\(|\.forwardMessage\(/);
  assert.match(http, /handleWebhook/);
});

test("Convex carrier pins the official sponsor components", async () => {
  const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["@firecrawl/firecrawl-convex"], "0.1.1");
  assert.equal(pkg.dependencies["@agentmail/convex"], "0.1.0");
  const config = await fs.readFile(new URL("../convex/convex.config.ts", import.meta.url), "utf8");
  assert.match(config, /@firecrawl\/firecrawl-convex\/convex\.config/);
  assert.match(config, /@agentmail\/convex\/convex\.config/);
});

test("browser demo has no remote executable script dependency", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
  assert.match(html, /src="\.\/app\.js"/);
});

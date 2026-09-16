import { normalizeOfficialSnapshot, buildEvidenceChange } from "../core.mjs";
import { validateChecklistDraft } from "../checklist.mjs";
import { normalizeInboundNotice, routeNoticeToSources } from "../inbox.mjs";

const demo = await fetch("../fixtures/demo.json").then((r) => { if (!r.ok) throw new Error(`fixture load ${r.status}`); return r.json(); });
const before = await normalizeOfficialSnapshot(demo.before);
const after = await normalizeOfficialSnapshot(demo.after);
const change = await buildEvidenceChange(before, after);
const checklistDraft = demo.checklist.map((item) => ({ ...item, evidenceDigests: item.evidenceDigests.map((d) => d === "__AFTER_DIGEST__" ? after.contentDigest : d) }));
const checklist = validateChecklistDraft(change, checklistDraft);
const notice = await normalizeInboundNotice(demo.inbox);
const routes = routeNoticeToSources(notice, [{ sourceId: "demo", sourceUrl: after.sourceUrl }]);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

document.querySelector("#source").innerHTML = `<strong>${esc(after.jurisdiction)}</strong><p>${esc(after.title)}</p><code>${esc(after.sourceUrl)}</code><p class="mono">digest ${after.contentDigest.slice(0, 16)}…</p>`;
document.querySelector("#change").innerHTML = `<p><span class="badge">OWNER REVIEW</span> ${esc(change.diff.added.join(" · ") || "Digest changed")}</p><p class="muted">Previous: ${change.beforeDigest.slice(0, 12)}…<br>Current: ${change.afterDigest.slice(0, 12)}…</p>`;
document.querySelector("#checklist").innerHTML = `<ol>${checklist.map((x) => `<li><strong>${esc(x.title)}</strong><p>${esc(x.why)}</p><span class="badge">${esc(x.status)}</span></li>`).join("")}</ol>`;
document.querySelector("#inbox").innerHTML = `<p><strong>${esc(notice.subject)}</strong></p><p>${esc(notice.from)}</p><p>${routes.length} configured source route matched.</p><span class="badge">INBOUND EVIDENCE ONLY</span>`;

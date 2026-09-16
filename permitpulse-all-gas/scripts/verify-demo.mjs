import fs from "node:fs/promises";
import { normalizeOfficialSnapshot, buildEvidenceChange } from "../core.mjs";
import { validateChecklistDraft } from "../checklist.mjs";
import { normalizeInboundNotice, routeNoticeToSources } from "../inbox.mjs";

const demo = JSON.parse(await fs.readFile(new URL("../fixtures/demo.json", import.meta.url), "utf8"));
const before = await normalizeOfficialSnapshot(demo.before);
const after = await normalizeOfficialSnapshot(demo.after);
const change = await buildEvidenceChange(before, after);
if (!change) throw new Error("fixture must produce a change");
const draft = demo.checklist.map((item) => ({ ...item, evidenceDigests: item.evidenceDigests.map((d) => d === "__AFTER_DIGEST__" ? after.contentDigest : d) }));
const checklist = validateChecklistDraft(change, draft);
const notice = await normalizeInboundNotice(demo.inbox);
const routes = routeNoticeToSources(notice, [{ sourceId: "demo-source", sourceUrl: after.sourceUrl }]);
if (routes.length !== 1 || checklist.length !== 2) throw new Error("demo pipeline invariant failed");
console.log(JSON.stringify({ changeId: change.changeId, afterDigest: after.contentDigest, checklistItems: checklist.length, inboxRoutes: routes.length, fixtureOnly: true }, null, 2));

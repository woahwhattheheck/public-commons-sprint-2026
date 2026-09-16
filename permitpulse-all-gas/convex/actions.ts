import { action, internalAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";

const firecrawl = new FirecrawlClient(components.firecrawl);
const allowedKinds = new Set(["verify", "update_record", "contact_authority", "schedule_review", "investigate"]);

function canonicalContent(text: string) {
  return text.normalize("NFC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim();
}
function canonicalUrl(value: string) { const u = new URL(value); u.hash = ""; return u.toString(); }
async function digest(text: string) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function openAiText(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const output of response?.output ?? []) for (const part of output?.content ?? []) if (part?.type === "output_text" && typeof part.text === "string") return part.text;
  throw new Error("OpenAI response did not contain output text");
}
function boundedText(value: unknown, name: string, max: number) {
  const text = String(value ?? "").normalize("NFC").trim();
  if (!text || text.length > max) throw new Error(`${name} invalid`);
  return text;
}

async function refresh(ctx: any, sourceId: any) {
  const source = await ctx.runQuery(internal.sources.getSourceInternal, { sourceId });
  if (!source || !source.active) throw new Error("source missing or inactive");
  const url = new URL(source.url);
  if (url.protocol !== "https:") throw new Error("official source must use https");

  const scraped: any = await firecrawl.scrape(ctx, source.url, { formats: ["markdown"], onlyMainContent: true, maxAge: 3_600_000 });
  const markdown = scraped?.data?.markdown ?? scraped?.markdown;
  if (typeof markdown !== "string" || !markdown.trim()) throw new Error("Firecrawl returned no markdown");
  const reported = scraped?.data?.metadata?.sourceURL ?? scraped?.data?.metadata?.url;
  if (reported && canonicalUrl(reported) !== canonicalUrl(source.url)) throw new Error("Firecrawl source identity mismatch");
  const content = canonicalContent(markdown);
  if (new TextEncoder().encode(content).byteLength > 900_000) throw new Error("source snapshot exceeds PermitPulse storage budget");
  const contentDigest = await digest(content);
  const fetchedAt = new Date().toISOString();
  const previous = await ctx.runQuery(internal.sources.previousSnapshotInternal, { sourceId });
  if (!previous || previous.contentDigest === contentDigest) {
    return await ctx.runMutation(internal.sources.persistRefreshInternal, { sourceId, fetchedAt, contentDigest, content, etag: scraped?.data?.metadata?.etag, checklist: [] });
  }

  const changeId = await digest(JSON.stringify({ sourceUrl: canonicalUrl(source.url), beforeDigest: previous.contentDigest, afterDigest: contentDigest }));
  const change = { changeId, observedAt: fetchedAt, beforeDigest: previous.contentDigest, afterDigest: contentDigest, diffJson: JSON.stringify({ strategy: "provider_snapshot_digest", changed: true }) };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to turn a detected change into a checklist");
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: [{ role: "user", content: `Create 1-6 operational review steps for this documented source change. Never decide compliance, legality, approval, violation, filing duty, or payment duty. Return JSON only as {"items":[{"kind":"verify|update_record|contact_authority|schedule_review|investigate","title":"...","why":"..."}]}. Current evidence digest: ${contentDigest}. Previous digest: ${previous.contentDigest}. Current source text:\n${content.slice(0, 24_000)}` }] }),
  });
  if (!response.ok) throw new Error(`OpenAI Responses API failed: ${response.status}`);
  const raw = openAiText(await response.json()).trim().replace(/^```json\s*/i, "").replace(/```$/, "");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.items) || parsed.items.length < 1 || parsed.items.length > 6) throw new Error("OpenAI checklist shape invalid");
  const checklist = parsed.items.map((item: any, index: number) => {
    const kind = boundedText(item.kind, "kind", 40);
    const title = boundedText(item.title, "title", 180);
    const why = boundedText(item.why, "why", 600);
    if (!allowedKinds.has(kind)) throw new Error("OpenAI checklist kind invalid");
    if (/\b(?:compliant|non[- ]?compliant|illegal|violation|approved|denied|legal advice|required by law|must file|must pay)\b/i.test(`${title} ${why}`)) throw new Error("OpenAI checklist crossed the legal/compliance boundary");
    return { checklistId: `${changeId}:${index + 1}`, kind, title, why, evidenceDigests: [contentDigest] };
  });
  return await ctx.runMutation(internal.sources.persistRefreshInternal, { sourceId, fetchedAt, contentDigest, content, etag: scraped?.data?.metadata?.etag, change, checklist });
}

export const refreshOfficialSource = action({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.tokenIdentifier) throw new Error("authentication required");
    const source = await ctx.runQuery(internal.sources.getSourceInternal, { sourceId });
    if (!source || source.tenantId !== String(identity.tokenIdentifier)) throw new Error("source not found");
    return refresh(ctx, sourceId);
  },
});

export const refreshOfficialSourceInternal = internalAction({
  args: { sourceId: v.id("sources") },
  handler: (ctx, { sourceId }) => refresh(ctx, sourceId),
});

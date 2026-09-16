import { normalizeOfficialSnapshot } from "./core.mjs";
import { normalizeInboundNotice } from "./inbox.mjs";
import { validateChecklistDraft } from "./checklist.mjs";

function findMarkdown(payload) {
  const candidates = [payload?.data?.markdown, payload?.markdown, payload?.data?.content, payload?.content];
  return candidates.find((v) => typeof v === "string" && v.trim()) ?? null;
}

export async function firecrawlToSnapshot(payload, context) {
  const markdown = findMarkdown(payload);
  if (!markdown) throw new TypeError("Firecrawl response did not contain markdown/content");
  const reported = payload?.data?.metadata?.sourceURL ?? payload?.data?.metadata?.url ?? payload?.metadata?.sourceURL ?? null;
  if (reported) {
    const want = new URL(context.sourceUrl); want.hash = "";
    const got = new URL(reported); got.hash = "";
    if (want.toString() !== got.toString()) throw new TypeError("Firecrawl source URL does not match requested source");
  }
  return normalizeOfficialSnapshot({
    sourceUrl: context.sourceUrl,
    jurisdiction: context.jurisdiction,
    title: context.title,
    fetchedAt: context.fetchedAt,
    content: markdown,
    etag: payload?.data?.metadata?.etag ?? undefined,
  });
}

export async function agentMailToNotice({ eventId, message }) {
  if (!message || typeof message !== "object") throw new TypeError("AgentMail message missing");
  return normalizeInboundNotice({
    eventId,
    messageId: message.message_id ?? message.id,
    threadId: message.thread_id,
    from: typeof message.from === "string" ? message.from : (message.from?.email ?? JSON.stringify(message.from ?? "unknown")),
    subject: message.subject ?? "(no subject)",
    text: message.text ?? message.extracted_text ?? "",
    receivedAt: message.timestamp ?? message.created_at ?? new Date().toISOString(),
  });
}

export function buildOpenAiChecklistRequest(change, { model = "gpt-5.6-luna" } = {}) {
  return {
    model,
    input: [{
      role: "user",
      content: `You turn a documented public-source change into a short owner-review checklist. Never decide legal compliance, approval, violation, filing duty, or payment duty. Every item must cite the current evidence digest. Return JSON only: {"items":[{"kind":"verify|update_record|contact_authority|schedule_review|investigate","title":"...","why":"...","evidenceDigests":["..."]}]}.\n\nChange:\n${JSON.stringify(change)}`,
    }],
  };
}

function responseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const output of response?.output ?? []) {
    for (const part of output?.content ?? []) if (part?.type === "output_text" && typeof part.text === "string") return part.text;
  }
  throw new TypeError("OpenAI response did not contain output text");
}

export function openAiResponseToChecklist(change, response) {
  const raw = responseText(response).trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new TypeError("OpenAI output was not valid JSON"); }
  if (!parsed || !Array.isArray(parsed.items)) throw new TypeError("OpenAI output must contain items[]");
  return validateChecklistDraft(change, parsed.items);
}

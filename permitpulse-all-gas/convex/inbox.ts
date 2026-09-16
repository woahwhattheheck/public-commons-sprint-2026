import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

function httpsUrls(text: string) {
  const out = new Set<string>();
  for (const match of text.matchAll(/https:\/\/[^\s<>()"']+/g)) {
    try { const u = new URL(match[0].replace(/[.,;:!?]+$/, "")); u.hash = ""; out.add(u.toString()); } catch { }
  }
  return [...out];
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const onMessageReceived = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  handler: async (ctx, args) => {
    const messageId = String(args.message.message_id ?? args.message.id ?? "");
    const threadId = String(args.message.thread_id ?? "");
    if (!messageId || !threadId) throw new Error("AgentMail message identity missing");
    const dedupeKey = await sha256(JSON.stringify({ eventId: args.eventId, messageId, threadId }));
    const existing = await ctx.db.query("inboxNotices").withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey)).unique();
    if (existing) return;
    const text = String(args.message.text ?? args.message.extracted_text ?? "");
    const urls = httpsUrls(text);
    const noticeId = await ctx.db.insert("inboxNotices", {
      eventId: args.eventId, messageId, threadId, dedupeKey,
      receivedAt: String(args.message.timestamp ?? args.message.created_at ?? new Date().toISOString()),
      from: typeof args.message.from === "string" ? args.message.from : JSON.stringify(args.message.from ?? "unknown"),
      subject: String(args.message.subject ?? "(no subject)"), text, urls,
    });
    const sources = (await ctx.db.query("sources").collect()).filter((source) => source.active);
    for (const source of sources) {
      const host = new URL(source.url).host;
      if (urls.some((url) => new URL(url).host === host)) {
        await ctx.db.insert("noticeRoutes", { noticeId, sourceId: source._id, routedAt: new Date().toISOString() });
        await ctx.scheduler.runAfter(0, internal.actions.refreshOfficialSourceInternal, { sourceId: source._id });
      }
    }
  },
});

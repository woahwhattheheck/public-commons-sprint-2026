import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function tenant(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.tokenIdentifier) throw new Error("authentication required");
  return String(identity.tokenIdentifier);
}

function canonicalPublicHttps(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("source must be a credential-free HTTPS URL without a fragment");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^[0-9.]+$/.test(host) || host === "[::1]") throw new Error("source host must be a public hostname");
  url.hash = "";
  return url.toString();
}

export const listDashboard = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await tenant(ctx);
    const jurisdictions = await ctx.db.query("jurisdictions").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
    const sources = await ctx.db.query("sources").withIndex("by_tenant", (q) => q.eq("tenantId", tenantId)).collect();
    const changes = await ctx.db.query("changes").withIndex("by_tenant_time", (q) => q.eq("tenantId", tenantId)).order("desc").take(30);
    const pending = await ctx.db.query("checklistItems").withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "needs_owner_review")).take(50);
    return { jurisdictions, sources, changes, pending };
  },
});

export const addSource = mutation({
  args: { jurisdiction: v.string(), url: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const tenantId = await tenant(ctx);
    const url = canonicalPublicHttps(args.url);
    const existingJurisdiction = await ctx.db.query("jurisdictions").withIndex("by_tenant_name", (q) => q.eq("tenantId", tenantId).eq("name", args.jurisdiction)).unique();
    const jurisdictionId = existingJurisdiction?._id ?? await ctx.db.insert("jurisdictions", { tenantId, name: args.jurisdiction, active: true });
    const existingSource = await ctx.db.query("sources").withIndex("by_tenant_url", (q) => q.eq("tenantId", tenantId).eq("url", url)).unique();
    if (existingSource) return existingSource._id;
    return await ctx.db.insert("sources", { tenantId, jurisdictionId, url, title: args.title, active: true });
  },
});

export const getSourceForUser = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const tenantId = await tenant(ctx);
    const source = await ctx.db.get(sourceId);
    if (!source || source.tenantId !== tenantId) throw new Error("source not found");
    return source;
  },
});

export const getSourceInternal = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: (ctx, { sourceId }) => ctx.db.get(sourceId),
});

export const listSourceDescriptorsInternal = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("sources").collect()).filter((s) => s.active).map((s) => ({ sourceId: s._id, sourceUrl: s.url })),
});

export const previousSnapshotInternal = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => ctx.db.query("snapshots").withIndex("by_source_time", (q) => q.eq("sourceId", sourceId)).order("desc").first(),
});

export const persistRefreshInternal = internalMutation({
  args: {
    sourceId: v.id("sources"), fetchedAt: v.string(), contentDigest: v.string(), content: v.string(), etag: v.optional(v.string()),
    change: v.optional(v.object({ changeId: v.string(), observedAt: v.string(), beforeDigest: v.string(), afterDigest: v.string(), diffJson: v.string() })),
    checklist: v.array(v.object({ checklistId: v.string(), kind: v.string(), title: v.string(), why: v.string(), evidenceDigests: v.array(v.string()) })),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || !source.active) throw new Error("source missing or inactive");
    await ctx.db.patch(args.sourceId, { lastCheckedAt: args.fetchedAt, lastDigest: args.contentDigest });
    if (!args.change) {
      if (!source.lastDigest) await ctx.db.insert("snapshots", { sourceId: args.sourceId, fetchedAt: args.fetchedAt, contentDigest: args.contentDigest, content: args.content, etag: args.etag });
      return { changed: false };
    }
    const priorChange = await ctx.db.query("changes").withIndex("by_change_id", (q) => q.eq("changeId", args.change!.changeId)).unique();
    if (!priorChange) {
      await ctx.db.insert("snapshots", { sourceId: args.sourceId, fetchedAt: args.fetchedAt, contentDigest: args.contentDigest, content: args.content, etag: args.etag });
      await ctx.db.insert("changes", { tenantId: source.tenantId, sourceId: args.sourceId, ...args.change, interpretation: "owner_review_required" });
      for (const item of args.checklist) await ctx.db.insert("checklistItems", { tenantId: source.tenantId, changeId: args.change.changeId, ...item, status: "needs_owner_review" });
    }
    return { changed: true, changeId: args.change.changeId };
  },
});

export const approveChecklistItem = mutation({
  args: { itemId: v.id("checklistItems"), approved: v.boolean() },
  handler: async (ctx, args) => {
    const tenantId = await tenant(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.tenantId !== tenantId) throw new Error("checklist item not found");
    if (item.status !== "needs_owner_review") throw new Error("checklist item already finalized");
    await ctx.db.patch(args.itemId, { status: args.approved ? "owner_approved" : "dismissed" });
  },
});

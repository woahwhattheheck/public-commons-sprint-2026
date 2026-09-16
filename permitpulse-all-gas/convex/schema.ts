import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  jurisdictions: defineTable({ tenantId: v.string(), name: v.string(), active: v.boolean() })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),
  sources: defineTable({
    tenantId: v.string(), jurisdictionId: v.id("jurisdictions"), url: v.string(), title: v.string(), active: v.boolean(),
    lastCheckedAt: v.optional(v.string()), lastDigest: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_url", ["tenantId", "url"])
    .index("by_jurisdiction", ["jurisdictionId"]),
  snapshots: defineTable({ sourceId: v.id("sources"), fetchedAt: v.string(), contentDigest: v.string(), content: v.string(), etag: v.optional(v.string()) })
    .index("by_source_time", ["sourceId", "fetchedAt"]),
  changes: defineTable({ tenantId: v.string(), sourceId: v.id("sources"), changeId: v.string(), observedAt: v.string(), beforeDigest: v.string(), afterDigest: v.string(), diffJson: v.string(), interpretation: v.literal("owner_review_required") })
    .index("by_change_id", ["changeId"])
    .index("by_source_time", ["sourceId", "observedAt"])
    .index("by_tenant_time", ["tenantId", "observedAt"]),
  checklistItems: defineTable({ tenantId: v.string(), changeId: v.string(), checklistId: v.string(), kind: v.string(), title: v.string(), why: v.string(), evidenceDigests: v.array(v.string()), status: v.union(v.literal("needs_owner_review"), v.literal("owner_approved"), v.literal("dismissed")) })
    .index("by_change", ["changeId"])
    .index("by_tenant_status", ["tenantId", "status"]),
  inboxNotices: defineTable({ eventId: v.string(), messageId: v.string(), threadId: v.string(), dedupeKey: v.string(), receivedAt: v.string(), from: v.string(), subject: v.string(), text: v.string(), urls: v.array(v.string()) })
    .index("by_dedupe", ["dedupeKey"]),
  noticeRoutes: defineTable({ noticeId: v.id("inboxNotices"), sourceId: v.id("sources"), routedAt: v.string() })
    .index("by_notice", ["noticeId"]),
});

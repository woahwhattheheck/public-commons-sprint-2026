# PermitPulse — All Gas build log

## 2026-09-16 · recovery generation

**Problem:** permit and inspection guidance changes are easy for small operators to miss, while generic AI summaries can erase provenance or overstate legal meaning.

**Built:** a source-first PermitPulse generation with Convex persistence, Firecrawl snapshot ingestion, AgentMail inbound-notice routing, OpenAI checklist generation, owner-review state, fixture-backed browser demo, deterministic contract tests, and source-identity / evidence-digest fail-closed boundaries.

**Stack contract:**
- Convex: schema, queries/mutations/actions, live persisted state, scheduled refresh from inbound notice routes.
- Firecrawl: official component, one-shot `scrape` from Convex action, requested URL must match provider source identity when supplied.
- AgentMail: official Convex component, webhook-backed inbox, event/message/thread dedupe, inbound-only authority.
- OpenAI: Responses API creates operational review steps only after a documented snapshot change; output remains owner-review-required.

**Fixture proof:** synthetic `example.gov` data demonstrates a scheduling-text change and a matching inbound notice. It is deliberately not represented as a live provider call or real rule.

**Current staging truth:** SOURCE/TEST/DEMO carrier only. Standalone public repo, live Convex deployment, convex.site/chatgpt.site URL, Luma registration, social post, three-minute video, vibeapps submission, judging result, and payment are all OPEN until separate provider receipts exist.

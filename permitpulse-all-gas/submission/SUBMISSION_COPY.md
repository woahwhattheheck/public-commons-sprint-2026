# PermitPulse — submission copy

## One-liner
PermitPulse watches official permit and inspection guidance, preserves source evidence, correlates inbound notices, and turns documented changes into owner-reviewed operational checklists.

## What it does
Small operators can miss a scheduling, inspection, or permit-guidance change and then spend hours reconstructing what changed. PermitPulse uses Convex as the live state spine, Firecrawl for admitted source refreshes, AgentMail for inbound notice routing, and OpenAI for bounded review-step generation. Every change stays tied to source identity and evidence digests, and generated steps remain owner-review-required.

## Why it is useful this week
A contractor, property operator, or small compliance team can keep a short list of official sources and see what materially changed without relying on a provenance-free summary. The product is intentionally not legal advice and does not autonomously file, send, or approve anything.

## Sponsor stack
- **Convex:** persisted jurisdiction/source/inbox/checklist state, queries/mutations/actions, and live updates.
- **Firecrawl:** official-page scrape inside the source-refresh path, with requested/provider identity checks.
- **AgentMail:** webhook-backed inbound notice ingestion with event/message/thread dedupe; no outbound authority.
- **OpenAI:** operational review-step generation only from documented changes; owner review remains mandatory.

## Evidence boundary
The repository includes synthetic fixture proof for deterministic development. Final submission claims about live providers must be backed by actual provider receipts recorded in `submission/READINESS.json`; fixtures are never promoted into live evidence.

## Final fields to insert only after verified receipts exist
- Public repo: `[OPEN]`
- Live app URL: `[OPEN]`
- Demo video: `[OPEN]`
- Social build post: `[OPEN]`

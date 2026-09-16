# PermitPulse — evidence before action

PermitPulse is a recovery-stage **Convex All Gas** build for small contractors and hospitality operators who need to notice public permit/inspection guidance changes without pretending software can decide legal compliance.

## Product loop

1. **Firecrawl** refreshes configured HTTPS public-source pages from a Convex action.
2. Convex persists source snapshots and compares content digests; unchanged content does not create alerts.
3. A changed snapshot is evidence-bound to the exact before/after digests.
4. **OpenAI Responses API** turns the documented change into a small operational review checklist. A strict boundary rejects legal/compliance conclusions.
5. **AgentMail** receives notice emails into Convex. URLs in a notice can route to a configured source and schedule a refresh; inbound mail never authorizes outbound contact.
6. Operators approve or dismiss checklist items in Convex. The default status is `needs_owner_review`.

## Real integration boundaries

- `convex/convex.config.ts` installs the current `@firecrawl/firecrawl-convex` and `@agentmail/convex` components.
- `convex/actions.ts` uses `FirecrawlClient.scrape` and the OpenAI Responses API. Missing credentials fail closed.
- `convex/http.ts` mounts the AgentMail webhook; `convex/inbox.ts` deduplicates inbound events and routes matching source hosts.
- `convex/schema.ts` persists tenant-bound jurisdictions, sources, snapshots, changes, owner-review checklist items, inbound notices and routes. Public dashboard/source mutations require a Convex user identity; provider-authenticated AgentMail callbacks use an internal refresh path.

The deterministic fixture and browser demo run without provider credentials and are labelled as fixtures. They are proof of the normalized product contract, **not** proof that Firecrawl, AgentMail, OpenAI or Convex were invoked live.

## Local proof

```bash
npm test
npm run test:optimized
npm run verify:demo
```

No dependency install is required for the stdlib contract tests. A live standalone deployment needs `npm install`, `npx convex dev`, and provider environment variables.

## Environment for live Convex deployment

- `FIRECRAWL_API_KEY`
- `FIRECRAWL_WEBHOOK_SECRET` (recommended)
- `AGENTMAIL_API_KEY`
- `AGENTMAIL_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- optional `OPENAI_MODEL` (defaults to `gpt-5.6-luna`)

## Safety / product boundary

PermitPulse reports **what documented source text changed** and proposes review steps. It does not decide whether a business is compliant, whether a permit is approved/denied, whether a filing/payment is legally required, or whether an operator should contact an authority. No customer data is included in the staging carrier.

See `hackathon.md` for build state and `TRANSPORT.md` for the exact standalone/deploy handoff.

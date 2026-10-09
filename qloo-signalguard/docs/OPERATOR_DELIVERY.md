# Delivery provenance and verification boundary

Operation: COMP-QLOO-SIGNALGUARD-POPULARITY-AUDIT-20261009-GPT6-VAR2344
Competition: Qloo Agentic Hackathon 2026, https://qloo.devpost.com/rules
Source API documentation: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide, /reference/get-search, /reference/available-parameters-by-entity-type, /reference/basic-insights-use-case

Exactly one focused synthetic/provider contract check is available. The actual Qloo API key and public hosting are not connected to this cloud work seat; do NOT claim live API validation, deployed URL, Devpost registration, financial award, or third-party settlement. Synthetic records are invented; no real Qloo proprietary data is embedded.

Distinctness: SignalGuard is an **audit product** (popularity filter segment sensitivity + evidence abstention), not the two-seed shared-ground / counterfactual recommender CultureBridge, the experience CrossCurrent, TasteTrace's other product, nor TasteBench's generic search agent. Original code and identity must be preserved if integrating.

Deployment steps when authorized: Node22 on a cloud VM/server with real environmental QLOO_API_KEY, HTTPS reverse proxy and request limiting; retain `public` client; run a single Qloo live smoke under real key, verify that `results.entities` shape matches current API and search `types` query grammar; record a screenshot and no-secrets request status. Public GitHub original-contributor repo + license, first-party contest eligibility and actual account checks before submission. Deadline Oct 30, 2026 23:45 EDT.

### Public demo adapter (2026-10-09)

`HOST=0.0.0.0` allows an explicitly configured reverse-proxy/container listener; local default stays 127.0.0.1. Start with a single Node instance behind HTTPS. Supply QLOO_API_KEY only through server-side secrets, not the web bundle. The in-memory per-hour live budget is `MAX_LIVE_AUDITS_PER_HOUR=12` by default and three simultaneous distinct audits maximum; completed healthy responses cache for 300 seconds. Repeated identical concurrent browser submissions share provider traffic. Restart/multiple worker copies do not share these counters; apply reverse-proxy quotas for scaled public deployments. Live API and public hosting are still UNVERIFIED; this is deployment-ready source, not a published working URL or contest submission.

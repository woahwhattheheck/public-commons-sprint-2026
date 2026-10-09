# CultureBridge — different tastes, surprising common ground

A minimal, responsive Qloo-powered agent app that finds cultural entities strongly associated with **two different** cultural influences. Each seed gets its own Qloo entity search and Insights query. The agent only recommends entities returned for BOTH seeds, and favors balanced ranks so a bridge is not one-sided. The UI shows ranking evidence for every suggestion.

## Run

Requires Node 22+; no npm dependencies.

```sh
node src/server.mjs
# http://127.0.0.1:8787
```

Preview mode is fully offline and deliberately displays **synthetic demonstration data**. It does NOT assert real Qloo affinity or public API connectivity.

For real Qloo data, set the server-only `QLOO_API_KEY` environment variable from your authorized Qloo hackathon integration and choose "Live Qloo insights" in the app. The browser never receives the key. The runtime calls `https://hackathon.api.qloo.com/search` for each seed, then separately queries `https://hackathon.api.qloo.com/v2/insights` with `filter.type`, `signal.interests.entities`, `feature.explainability`, and `take` per Qloo's public API references. API errors (including rate limits) are explicitly surfaced; live errors never silently substitute sample data.

**Real API integration is source-implemented but NOT independently authenticated or live-tested in this session.** Qloo query schema may evolve; validate the real response structure with your issued developer key before claiming live success.

## Agent steps

1. Validate two *different* cultural seeds and target domain.
2. Resolve two Qloo IDs by name, prioritizing exact match.
3. Query Qloo Insights separately for each seed, preserving both result sets.
4. Match strictly by the same non-empty canonical Qloo ID in both result sets. Display-name similarity does not establish a verified bridge.
5. Score by geometric rank strength and balanced connection; display both original ranks, method and trace.
6. Let the user alter either influence and rerun the agent as a counterfactual comparison.

## Contest status

This original CultureBridge source is published under `qloo-culturebridge-2026/` in `woahwhattheheck/public-commons-sprint-2026`, separate from TasteBench, SignalGuard and CrossCurrent. It has **not** been registered or submitted to Devpost, deployed to a public HTTPS host, or authenticated against live Qloo.

Official Qloo Agentic Hackathon: https://qloo.devpost.com/rules . Deadline October 30, 2026 at 11:45 PM EDT. Full public repository, top-level open-source LICENSE, functional **public** demo, text explanation, and working Qloo API integration are required. Contest cash prizes advertised: first $15,000, second $6,000, third $4,000. Any actual prize remains subject to eligibility, judging and identity verification.

## Security and data truth

The Qloo key is only in server memory, never rendered in HTML. Hardcoded Qloo API origin avoids server-side URL injection. Request inputs have fixed length and category validation. Upstream errors are reported clearly and not represented as observed cultural affinities. Fixture mode is watermarked and is **not valid as proof of live Qloo integration**.

## Focused check

`node test/focused.mjs` validates both (a) balanced overlap and source labels, (b) the live request-building and error-classification path through an injected fetch mock. Not a network integration, deployment or competition judging run.

## Evidence integrity and hackathon API fixes — October 9, 2026

- The server sends the `X-Api-Key` only to the fixed **hackathon** origin `https://hackathon.api.qloo.com`; production `api.qloo.com` is not an interchangeable key destination. Endpoint names remain Qloo's documented GET `/search` and `/v2/insights`. No live key is included in this packet.
- A shared bridge requires the **same non-empty Qloo entity ID** in both independently retrieved candidate sets. Two unrelated IDs with the same display name are not verified common ground, and records lacking stable IDs are not matched. Rank balance is a local heuristic, not a Qloo score.
- Unsupported successful HTTP-200 JSON envelopes now fail with a provider contract error rather than quietly returning an empty match list. Explicitly empty supported arrays remain valid no-match outcomes.
- A focused mock-provider check exercises the hackathon origin, name collision, missing IDs and unknown response contract. This is not proof of an activated account or eligibility; hosting and contest submission are still outstanding.

## Consolidated entity_id coverage (2026-10-09)

The first October 9 ID-authority package remains the base for this successor: stable Qloo IDs are mandatory on both sides, and unrecognized successful JSON response envelopes fail closed. This continuation adds Qloo `entity_id` extraction from both nested entity objects and top-level provider rows; without that a valid `/search` or `/v2/insights` collection using `entity_id` would be misclassified as unkeyed and lose real bridges. The previous weaker name-only fallback draft was explicitly discarded during source collision reconciliation. No actual Qloo network/key or public deployment was tested.

## Public source provenance

This repository copy is derived from the canonical private source archive (SHA-256 `5ff687ba1056d881b110b6c42121e267e746050ae1edb90bcede33f3275574f6`). Tests and license are retained unchanged. The README removes a stale name-only fallback description and explains the public-source status. Delivery review also corrected the browser copy-brief delimiter to an escaped newline: the original literal newline prevented the entire browser script from parsing. One focused offline check confirmed the original parse failure, successful corrected script initialization and a two-bridge clipboard export with separate lines. Internal review coordination notes remain in the private source archive.

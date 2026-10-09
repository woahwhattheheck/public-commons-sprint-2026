# CrossCurrent — an evidence-first cultural bridge agent

A complete local Node 20+ web app for the **Qloo Agentic Hackathon (deadline: October 30, 2026, 11:45 PM EDT; $25k cash prize pool)**. Independent venue organizers enter a cultural seed and optional city, then an agent seeks cross-category affinity links between artists, films, books, places, and brands. A **second-hop** Qloo call recombines the seed and discovered cultural anchor to find more grounded place matches. Outputs retain Qloo entity IDs and observable trace decisions rather than making up demand forecasts.

## Run now

    node src/server.mjs
    # browse http://127.0.0.1:8765

No dependencies, external login, API key, or network call is needed for the **fictional offline demo**. Every synthetic screen/result clearly says FICTIONAL and uses invented entity IDs/names. It is a UI/agent algorithm preview, *not* evidence of an actual Qloo response.

## Run against real Qloo (once access is approved)

1. Register/authorize an eligible Devpost competition entrant and request your Qloo hackathon key through https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide . The owner handles account actions and accepts rules; do not request or paste secrets into Slack.
2. Store QLOO_API_KEY securely **in the host environment** (not source, web UI, JSON, logs, public repository, or screenshots); run `node src/server.mjs`.
3. Select **Live Qloo Insights**. Calls use `GET https://hackathon.api.qloo.com/search?query=...` followed by `GET https://hackathon.api.qloo.com/v2/insights` with `filter.type=urn:entity:...` and `signal.interests.entities=...`, passing the key only as `X-Api-Key` header.
4. Confirm the selected entity resolves, all returned categories are supported, and the response contract with actual authorized credentials before producing a competition demo. Partial Qloo errors remain explicit; no synthetic fallback on live failure. If all insight lookups fail, or no distinct cultural anchor/verified place exists, live mode now abstains rather than inventing a venue concept; the UI shows an explicit failure reason and agent trace.
5. **Provider contract guard:** only explicit supported Qloo entity envelopes (`results`, `entities`, `data.results`, `data.entities`, `results.entities`) count as a parsed response; unknown HTTP-200 response shapes return `QLOO_RESPONSE_SHAPE_UNRECOGNIZED` without caching or fabricating a `NO_ENTITY_MATCH` result. A documented empty `results: []` remains a genuine empty lookup. This behavior is checked with a fake local responder, not a live Qloo account.
6. Deploy behind a controlled HTTPS host, publish an eligible public MIT source repository and functional demo per https://qloo.devpost.com/rules , and submit through the entrant's registered Devpost account. **None of those submission, hosting, account or award actions have been completed by this source packet.**

## Agent execution plan

- Entity search: map the human theme to a real Qloo ID. Search results are not invented when lookup fails.
- Parallel cross-domain exploratory queries: five supported Qloo types (places, artists, movies, books, brands); explainability requested; max 8 per category.
- Evaluation: choose a previously discovered cultural anchor; one bounded bridge call to find compatible places using the seed and anchor jointly. Deduplicate candidate IDs, retain Qloo's score *only when the provider supplied a finite number*.
- Concept board: assemble a creative program suggestion with traceable supporting entity IDs and clearly speculative potential venue/brand roles.
- Tool-level safeguards: exact Qloo hackathon origin; no arbitrary URL proxy; 6.5 second timeout; no automatic rate-limit retry; 5 minute private in-memory cache; bounded HTTP bodies/requests; no storage of user profiles, Qloo responses or API key in public files.
- Request metric: each `/api/plan` result reports **its own logical Qloo lookup attempts** (`qloo_request_metric=logical_plan_lookups`), not process-lifetime upstream HTTP traffic. The five-minute cache and cross-request singleflight can make fewer actual network calls; concurrent plans do not change one another's displayed count.
- **Global upstream budget:** one shared live Qloo client admits at most **48 real outbound GET attempts per 60-second reset window** in the running server instance. Configure an integer 1–120 using `QLOO_UPSTREAM_PER_MINUTE` in the private host environment; the health endpoint reports the configured limit (never the key). Cache and in-flight deduplication do not consume additional outbound slots. Failed attempted requests still count, and exhausting the local quota yields HTTP **429 `QLOO_LOCAL_BUDGET`**, never a fictional fallback or a partially verified recommendation. This is a local per-process budget, **not a distributed quota across multiple hosts**, and does not claim knowledge of Qloo's actual provider quotas. Limit concurrency/instances at deployment or add a shared distributed limiter if needed.

### Verification and limitations

A focused isolated check in `tests/agent.test.mjs` covers route composition, two-signal bridge, and evidence-free live abstention with a stub Qloo responder. It does not establish a production Qloo response shape, judge acceptance or Qloo entitlement. **A real activated Qloo hackathon key is required before the source can qualify as a live Qloo-powered submission.** The current Qloo API docs are https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide . API response data must not be placed in public source repositories per those docs.

Built October 8, 2026. Original work intended for the owner's contest entry and shared peer improvement; no external submission or rights transfer occurs from packaging this source.

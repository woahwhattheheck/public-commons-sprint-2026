# AccessLens operator guide

## Start the original application

Use Node.js 22 or newer. No package installation, build step or hosted CI is required.

```bash
node server.mjs
```

The default `fixture` mode serves the complete workspace at `http://127.0.0.1:3000`. Its six fictional venue records, IDs and ranking are labeled; evaluation is pinned to October 9, 2026. `ACCESSLENS_MODE` accepts exactly `fixture` or `live`. A misspelling fails at startup.

For live operation, supply the existing authorized Qloo hackathon key through the server environment and a catalog file outside the public repository:

```bash
export ACCESSLENS_MODE=live
export ACCESSLENS_VENUES_FILE=/secure/path/operator-venues.private.json
# Supply QLOO_API_KEY through the runtime's existing secret mechanism.
node server.mjs
```

The server catalog remains a top-level array for compatibility with existing operator scripts. It provides the records for `POST /api/plan`. The workspace can import its own local catalog and does not send it back to the server.

### Shared demo catalog or private local intake

In live mode, `GET /api/catalog` publishes configuration but returns `catalog: null` by default. The user opens **Venue catalog**, loads the permitted local JSON file, reviews it and applies it. Only the explicit artist or place-search query leaves that browser.

Set `ACCESSLENS_SHARE_VENUES=1` only when the configured catalog's normalized venue fields are intended to be visible to everyone with the application URL. This enables immediate planning in a shared judge/demo deployment. The public fields are those listed below; extra operator-file fields are discarded by the schema. Leave the option at `0` for private browser intake. Values other than `0` and `1` fail at startup.

Deploy the original application with `HOST=0.0.0.0` and the host's assigned `PORT`, behind HTTPS ingress. Serve one process to keep the existing provider budget atomic. Preserve the original entrant's deployment and Devpost record when integrating this workspace. The public source, actual working demo, original operator results and demonstration video belong to that same candidate.

## Venue catalog and independent sources

A browser import can be the original array or a named envelope:

```json
{
  "schema": "accesslens-catalog/v1",
  "kind": "operator",
  "label": "Permitted venue observations",
  "venues": []
}
```

The empty array above is a shape example; an applied catalog requires 1–80 records. A fixture server accepts `kind: "fixture"`; a live server accepts `kind: "operator"`. Importing a file cannot switch the provider mode. A raw array receives the current server's catalog kind.

| Field | Meaning and validation |
| --- | --- |
| `id` | Operator venue identity, required and unique |
| `qloo_id` | Canonical Qloo place ID, required and unique in an applied catalog |
| `name`, `city` | Independently recorded venue name and city |
| `capacity` | Recorded group capacity, integer 1–100000, or `null` when unknown |
| `cost_usd` | Recorded per-person cost, finite number 0–100000, or `null` when unknown |
| `step_free`, `low_sensory`, `accessible_toilet` | Independently recorded `true`, `false`, or `null` when unknown |
| `audit_source` | Human-readable independent source or observation description |
| `audit_date` | Actual observation date as a valid `YYYY-MM-DD` UTC calendar day |
| `record_kind` | Optional `operator_audit` or `published_information`; default display is an operator record |
| `source_url` | Optional HTTP(S) source URL without embedded credentials |

Required strings are limited to 180 characters; the catalog label is limited to 100. Source URLs are limited to 2000 characters. Catalog imports are limited to 512 KiB in UTF-8. Unknown facts remain unknown: capacity and price are always needed to qualify; an access fact is needed when its requirement is selected.

Use the **Download blank template** action to obtain a record with unknown facts and placeholders for the venue identity, independent source and observation date. Correct those fields before applying it. The review displays every invalid row and every missing Qloo identity. The current catalog remains active until the complete reviewed version can be applied; invalid rows are never silently dropped. Impossible dates such as February 30 are rejected before planning.

### Resolve a canonical place identity

A browser draft may omit `qloo_id`. Review the draft, choose **Find Qloo identity** for the unresolved row, and submit a precise venue query. Compare the returned canonical name, ID and any provider-supplied address or attributes. Select the actual venue, then review and apply the updated catalog.

That operation changes only the row's Qloo ID. Qloo place attributes are displayed for identity comparison and do not fill in accessibility, capacity, price, source or observation fields. If the response is ambiguous, refine the query or retain the unresolved row until the exact identity is available. A newer draft or file selection prevents an older asynchronous read/search result from overwriting it.

## Provider requests and browser privacy

The original adapter uses `https://hackathon.api.qloo.com` with `X-Api-Key`. Artist affinity resolves an exact artist through `GET /search` with `types=urn:entity:artist`, then requests `GET /v2/insights` with `filter.type=urn:entity:place` and the canonical artist ID in `signal.interests.entities`. Place resolution uses the same `/search` endpoint with `types=urn:entity:place`.

The browser endpoints are:

| Endpoint | Input | Behavior |
| --- | --- | --- |
| `GET /api/catalog` | None | Mode, audit policy, freshness configuration and permitted bootstrap catalog |
| `POST /api/affinity` | `{"artist":"Nina Simone"}` | Exact artist identity, ordered place IDs, mode, provider call count and capture freshness |
| `POST /api/places/search` | `{"query":"A precise venue name"}` | Canonical place candidates for an explicit identity decision |
| `POST /api/plan` | Original operator request | Original server-side catalog screening and response contract |

The artist and place endpoints reject extra fields. The browser sends no city, group size, budget, access requirements, exclusions, imported catalog or saved plan in those calls. Rendering, screening, comparisons and saved-plan handling occur locally. An explicitly searched place name is sent to Qloo as the search query.

The original operator endpoint continues to accept its full request, for example:

```json
{"artist":"Nina Simone","city":"Example City","groupSize":45,"budgetUSD":25,"required":["step_free","low_sensory","accessible_toilet"]}
```

`city` is optional and keeps the original all-catalog-cities behavior when blank. The new optional `excludedVenueIds` array excludes operator IDs; omitting it preserves the original response shape. Use `Content-Type: application/json`. Browser-origin POSTs must match the host; existing command-line requests without an `Origin` header continue to work.

Provider HTTP errors, ambiguous exact artist identities and invalid response envelopes are reported as failures. The original strict adapter does not replace a failed live retrieval with a fixture response. The browser retains the current inputs after a failure and offers an explicit retry.

## Replanning, dates and quota

Every plan screens the original independent records for city, group capacity, price and selected access features, then preserves the first occurrence of each place in Qloo's ordinal ranking. A venue absent from that returned ranking does not qualify. Ranking is built in a single pass over the returned IDs.

The city comparison uses Unicode NFC, normalized whitespace and case folding. It does not infer alternate spellings or nearby cities. Observation dates must not be in the future and must lie within `ACCESSLENS_MAX_AUDIT_AGE_DAYS`, an integer 1–365, default 180. Live browser replans use the current UTC day. Historical saved-plan validation uses the recorded evaluation day; reopening requires a new evaluation.

The UI may offer an explicit budget, group-size or city change only where those changes make the named venue qualify using the current records. It does not propose removing access requirements, treating missing facts as true, or extending date policy. Choosing **Exclude and replan** keeps the remaining requirements. These local operations make no new provider request while the artist capture is fresh.

`ACCESSLENS_AFFINITY_REUSE_SECONDS` accepts 0–300, default 120. Expiry is measured without extending the original capture deadline. A different exact trimmed artist query or an expired capture triggers another retrieval. A value of 0 requires a retrieval for each new plan. Changes to the form during a retrieval invalidate that pending plan; the user applies the current inputs through a new planning action.

The preserved server cache holds at most 16 parsed affinity responses, with a 256 KiB conservative per-entry bound. Larger valid responses serve their current request without being retained. It does not hold raw provider bodies, API keys, catalog records, group constraints or completed plans. Restarting clears it.

Default live limits are 30 Qloo calls per UTC clock hour, one in-flight provider operation, and eight API POSTs per client address per minute. A new artist retrieval reserves two calls; a place search reserves one. Failed calls consume the reservation. Set `ACCESSLENS_PROVIDER_HOURLY_BUDGET` to an authorized integer 2–500. Local replans do not consume either the browser POST allowance or provider allowance. A shared reverse proxy may collapse clients to one address, so the upstream deployment should have an appropriate request cap as well.

Responses report `providerCalls` and, for live affinity, the original `capturedAtUTC`, `ageMs`, `reuseWindowMs` and `reused` values. The browser carries that capture into a saved snapshot. The app does not promise that the returned place list exhausts all possible Qloo recommendations.

## Selected plans and recovery

Choose a qualifying venue before saving, exporting or printing. The selected summary shows recorded per-person and group cost, access requirements, rank, observation source and evaluation date. These values are planning inputs; verify current event availability, access and travel arrangements before attending.

Browser saves use `accesslens.saved.v1`, with up to 20 records. Each versioned `accesslens-workspace/v1` record includes a UUID, name, save time, mode, the normalized catalog, requirements, provider capture, selected venue and up to three comparison IDs. The exact pretty-printed UTF-8 export must fit within 512 KiB, so a saved file can be reopened under the same import limit. Exported files contain the group details and venue records visible to the user.

On import, AccessLens recomputes the selected venue from the saved catalog, constraints, ranking and recorded date policy. A selection that does not satisfy those inputs is rejected. A conflicting existing saved identity is retained rather than silently overwritten. Reopening restores the catalog and inputs, clears the current selection and provider capture, and requires **Find matching venues** before another current selection can be saved.

If local browser storage is unavailable, export the current selected plan to JSON. If existing storage is unreadable, the Saved plans view can export its original content before the user explicitly resets the list. Nothing is uploaded by the save/import/export controls.

## Original deployment and live run adoption

Update the existing application deployment from the public `qloo-accesslens-2026` source. Keep its authorized server credential and real venue inputs in their original custody. For a public judge flow, publish a catalog containing only permitted independent observations using the explicit sharing option. Exercise the actual artist search, insights response and browser planning journey against that catalog; retain retrieval times, canonical ID mappings, source commit and recoverable provider outputs with the original operator's run.

The October 11 product exercise covered the actual browser workflow with the original fictional demonstration catalog, including an imported local file, three-way comparison, explicit changes, Unicode save/reload and mobile layout. That exercise validates the implemented interaction and legacy compatibility. It did not make an external Qloo call. Use the original Muse/provider operation for current real runs and integrate its returned catalog and canonical mappings into this application.

Official references:

- https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
- https://docs.qloo.com/reference/get-search
- https://docs.qloo.com/reference/insights-api-deep-dive
- https://qloo.devpost.com/rules

# AccessLens · Group venue planning

AccessLens turns Qloo artist-to-place affinity and an independent venue catalog into a complete group outing plan. Choose an artist, destination, group size, budget and required venue features; compare qualifying options, make explicit adjustments, select a venue, and keep the plan with its source information.

**Original Qloo Agentic Hackathon candidate · MIT · Node.js 22+ · No npm dependencies.**

## Run the complete workspace

```bash
node server.mjs
# Open http://127.0.0.1:3000
```

The default demonstration works offline. Its six venue records, canonical IDs and artist affinity ranking are fictional and labeled throughout the interface. It uses the original pinned October 9, 2026 evaluation date and makes no provider requests.

Try the default 45-person group with a $25 per-person budget and all three access features. Quiet Lantern Studio qualifies. Change to 30 people and $30 to compare three options, choose Garden Stage, and inspect its $840 recorded group cost. Exclude it to replan with the remaining options. A destination absent from the catalog produces an empty result and an explicit city adjustment where that change alone would make a venue qualify. Access requirements stay selected.

### A complete planning cycle

1. **Review the venue catalog.** Load a local JSON file or paste records. Review invalid dates, duplicate identities, unresolved Qloo IDs and unknown facts before applying the whole catalog. Use an explicit place search to resolve missing canonical IDs; selecting a Qloo identity preserves the independently supplied venue facts.
2. **Set group requirements.** Music identifies the taste signal; the city, group size, per-person USD budget, and required step-free entry, low-sensory setting and accessible toilet constrain the venue decision. Blank city searches the entire catalog.
3. **Compare the qualifying options.** Inspect up to three side by side, including Qloo ordinal rank, per-person and group cost, capacity, access facts, observation date and independent source. All qualifying catalog venues remain available for selection.
4. **Replan explicitly.** Exclude an option, restore exclusions, or try a proposed budget, group-size or city change. Unknown required facts, stale records, missing canonical matches and unavailable access features never become automatic relaxations.
5. **Keep the selected plan.** Save in this browser, export a complete JSON file, or print the selected summary. A saved record includes the catalog, provider capture, requirements and selected venue. Import and reopen recover the inputs; a fresh evaluation is required before keeping a new selection.

The workspace supports up to 80 venue records and 20 local saved plans. Catalog and individual saved-plan imports have a 512 KiB UTF-8 limit. Unreadable browser storage can be exported for recovery before an explicit reset. A failed save leaves the current plan available for file export.

## Live Qloo operation

Configure the original Qloo server credential and a real venue catalog as described in [docs/OPERATOR.md](docs/OPERATOR.md). The original adapter resolves an exact artist using Qloo `/search`, then retrieves place affinity from `/v2/insights`. The new catalog resolver uses the same adapter's place search. Only canonical place IDs join the independent catalog to the returned ranking.

The browser sends **only the artist query or an explicitly submitted venue-search query** to the application server. Group requirements, catalog imports and saved plans stay in the browser. The API key remains in the server environment. A live server keeps its configured operator catalog private by default; `ACCESSLENS_SHARE_VENUES=1` explicitly publishes the permitted venue fields for a shared judge/demo catalog.

Changing city, group, access requirements, budget, exclusions or catalog recomputes the original screening engine locally. Fresh artist affinity can be reused for the configured short interval; expiry or a different artist requires a provider retrieval. Changing inputs during that retrieval cannot apply a result to the old requirements.

## How a recommendation is formed

Qloo supplies cultural affinity order. Venue access, capacity, prices and observation dates come from the separate catalog. A venue must have a canonical ID in the returned Qloo ranking, match the requested city, hold the group, meet the budget and satisfy every selected access requirement. It must also have a valid observation date within the configured UTC calendar-day window, default 180 days.

City matching normalizes Unicode NFC, surrounding/internal whitespace and letter case. It does not infer spelling aliases or nearby locations. Unknown capacity and price cannot satisfy their constraints; an unknown access fact cannot satisfy a selected requirement. A valid source URL and observation type can accompany each record. These fields describe the supplied evidence; the application does not independently inspect a venue or establish a travel route, current event availability or reservation.

The original `POST /api/plan` operator interface remains available with the same default request and response shape. The interactive workspace uses `POST /api/affinity` and the same original screening engine in the browser, keeping group details out of the server request. The original API and offline demonstration retain the existing status and reason codes.

## Source layout

| Path | Responsibility |
| --- | --- |
| `public/` | Responsive industrial workspace: catalog intake, identity resolution, planning, comparison, saved-plan recovery and print view |
| `src/catalog.mjs` | Venue schema, strict UTC calendar dates, nullable unknown facts, independent source metadata and the original fictional catalog |
| `src/engine.mjs` | Original hard constraints and Qloo ordinal ranking, shared by the browser and operator API |
| `src/workspace.mjs` | Catalog review, explicit replan proposals, complete options, versioned saved plans and historical recomputation |
| `src/qloo.mjs` | Original exact-artist/search/insights adapter plus explicit canonical place search |
| `src/affinity-cache.mjs` | Original bounded, short-lived server affinity cache |
| `server.mjs` | Dependency-free HTTP host, private/public catalog bootstrap, artist-only endpoint and shared provider limits |
| `docs/OPERATOR.md` | Live setup, catalog schema, request contracts, privacy, freshness and original deployment adoption |

The complete original browser journey was exercised on October 11, 2026: catalog file intake and identity review, three-way comparison, explicit replan, Unicode save/export/import, reload/recheck and a 390-pixel mobile viewport. Captured browser POSTs contained only artist/place queries. The unchanged legacy fixture request returned the same JSON as the original engine. This local product exercise made zero external Qloo calls; live operator runs attach their actual source pin and provider outputs separately.

The original candidate's public source and existing entry/deployment work remain the integration targets. See the [official Qloo rules](https://qloo.devpost.com/rules) for the October 30, 2026 deadline and current submission requirements.

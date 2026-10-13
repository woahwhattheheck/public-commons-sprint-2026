# Original microbial observations in the monitoring calendar

## Complete retained cohort

This source edition brings the existing utility microbial study into the maintained Monitoring design observed-context workflow. It retains all **730 original observations at 36 stations**, including 729 routine samples and the original field replicate. Original station and activity IDs, sample dates and clocks, analytical methods, values, units, reporting limits, comments and original source rows are preserved.

The source uses schema `upstate.monitoring-observed-source/v2`, which declares explicit station-specific flow scope. Its receiving implementation also supports the original nutrient v1 edition. The source is a document with role `monitoring_observed_context`. Its application-root manifest is `microbial_monitoring_context.sources.json`. Import it with the ordinary source importer, then select it under **Observed support for this network**. The existing network, saved design and campaign revision remain the selection; exact station IDs or an explicit source-to-native mapping establish the join.

## Same-station hydrologic support

The original daily series belongs to **USGS-02177000**, Chattooga River near Clayton, Georgia. This edition retains all 365 daily means in 2022, their source indices and agency qualifiers. The source's `flow_scope` explicitly limits discharge and high-flow episode comparisons to that same station. The other 35 microbial stations retain their original observation history.

The 2022 linearly interpolated daily-flow 95th percentile is approximately **1,284 ft³/s**. Nineteen original days meet or exceed it, forming nine consecutive-day episodes:

| Episode | Days | Peak daily mean, ft³/s |
| --- | ---: | ---: |
| January 3 | 1 | 1,640 |
| February 3–7 | 5 | 6,990 |
| February 18 | 1 | 1,350 |
| March 9 | 1 | 1,340 |
| March 23–25 | 3 | 2,380 |
| May 26–28 | 3 | 5,140 |
| September 3 | 1 | 1,370 |
| September 5–6 | 2 | 3,330 |
| December 15–16 | 2 | 2,620 |

None contains one of the 16 original same-station routine microbial samples. The 19 days represent approximately 19.569% of the sum of original daily means across the complete calendar year. That is a descriptive flow-volume share for this gauge and period.

For a campaign visit, original same-station/same-date activities are identified from its retained station binding. A visit at a different station has an explicit outside-flow-scope state. An unbound search area remains unbound. Dates outside the retained 2022 series have no received daily value. The existing absolute calendar is used without transplanting dates between years.

## Original coordinates and analytical qualifications

The original membership table contains 34 WGS84 and two NAD83 station coordinate pairs. They remain unchanged in this source. Exact station matching uses identifiers. The maintained receiver reports a distance diagnostic only when the original point has the required WGS84 datum; other declared datums remain visible alongside their coordinates.

Numerical observations preserve exact lower and upper values. Original below-limit and non-detected results preserve conservative [0, limit] bounds, and above-limit results preserve their lower bound with `upper_unbounded=true`. Missing values remain missing. Original result and limit unit spellings remain present beside the common physical unit. These bounds express the reported value support.

Seventy-two routine results contain original information-only comments. Three mention interrupted ECOL analysis after a power failure, and one refers to BOD. Original comments and the derived literal-comment flags accompany every observation. The complete temporal analysis retains the explicit information-only sensitivity as its own view.

The field replicate keeps its original activity type and result. Routine sampling support and same-station event counts exclude that replicate; the full observed record collection includes it.

## Existing desk and campaign workflow

1. Import `microbial_monitoring_context.sources.json` into the original Workspace.
2. Open **Monitoring design**, select the retained network and, when appropriate, its saved design or campaign.
3. Under **Observed support for this network**, select this microbial source. Inspect exact station matches, original coordinate datums and any unmatched stations.
4. Preview the source support. Inspect the original observations by station, detection status and comment, then the same-station calendar and hydrologic coverage.
5. Save the context, retaining the network, plan and exact campaign revision.
6. Export the complete context or the matching existing field package. The original source collection and complete retained observations travel with the saved selection.
7. Receive the ordinary complete Workspace and reopen the same saved context and campaign revision.

The maintained observed-context backend implements source-specific flow scope and original declared datum handling. Source family installation must include that current backend and browser edition before importing this microbial document.

## Reproduce the complete source

From the application root:

```sh
node source/ecoli_temporal_analysis/20261013/monitoring-context/build-microbial-monitoring.mjs
```

The optional first argument is the complete application directory and the second is a separate output directory. The command reads `input-manifest.json`, verifies the byte length and SHA-256 of the three original scientific inputs and maintained analysis module, recomputes the cohort, and checks all five derived output hashes before writing.

The pure `deriveMicrobialMonitoring` function consumes those same originals. It reuses `analysis.mjs` for the original parser, status and interval interpretation, routine summaries and exact gauge join. The additional transformation groups original activity identities, retains every complete observation, derives the same-station consecutive high-flow episodes and presents station/year/month sampling support.

| File | Purpose |
| --- | --- |
| `monitoring-context.json` | Complete native source document, stations, activities, observations, original daily flow and sampling support |
| `monitoring-activities.csv` | Every original station/activity identity and complete source row references |
| `monitoring-high-flow-episodes.csv` | Nine original same-station episodes and every supporting original daily record |
| `original-stations.csv` | All 36 original station coordinates, datums and utility membership |
| `context-summary.json` | Cohort, hydrologic-support counts and interpretation |
| `derive-microbial-monitoring.mjs` | Reusable pure source transformation |
| `build-microbial-monitoring.mjs` | Hash-checked reproduction command |
| `input-manifest.json` | Exact input and output byte/hash identities |

The application-root source manifest retains immutable copies of the complete original 22-file utility source family under `original-utility/`, the original USGS response under `original-usgs/` and the exact maintained analysis module under `original-analysis/`, beside the derivation and derived outputs. Original paths and commit identities remain in the input manifest. This complete local source edition remains reproducible while the wider utility application continues to evolve. Original publisher request URLs are preserved in the utility family's `source-inputs.json`.

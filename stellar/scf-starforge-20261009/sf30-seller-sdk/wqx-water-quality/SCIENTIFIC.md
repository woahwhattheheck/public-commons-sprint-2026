# Reporting-unit scientific reviews

The Water Quality workspace can retain an original scientific representation and a reviewed reporting-unit representation in one immutable edition. It uses the saved receiving decision document to select conversions, applies the original exact concentration converter independently to each measured result and each reported limit, and runs both representations through the same scientific analysis engine.

Open **Scientific editions** in the existing water-quality workspace. Select a complete receiving decision review, choose the sample-date window and optional within-source baseline, and preview the complete scientific review. A saved earlier scientific edition can be selected separately for a comparison of source, choices and reporting representations.

## Complete operator flow

1. Capture or receive the original WQX cohort and save its native review and receiving plan.
2. Use the existing concentration workflow to review the complete result/unit/limit choices. Save that receiving decision review.
3. In Scientific editions, select the complete decision review and a new scientific review name. Leave the sample-date window blank to include the complete cohort, or select explicit source calendar dates.
4. Preview the full report. Review the original and reporting group summaries, every selected observation, original limits, reporting limits, scientific inclusion and exact source identities.
5. Save that exact preview. The edition binds the original capture, source review, source and resulting receiving plans, decision document, scientific options and optional earlier edition.
6. Download the complete scientific bundle. Receive it in another private water-quality project to reproduce the current and selected previous analyses from their retained original sources.

Changing scientific settings requires a new review name and preview. The interface preserves an unsaved draft while clearly identifying any earlier displayed result. A saved edition retains its exact operation; a repeat of that same save reopens it.

## Scientific choices and interpretation

Groups retain the original provider, organization, location, characteristic, fraction, speciation, sampling context, statistical basis, analytical and collection methods, preparation methods and depth context. An explicitly reviewed reporting unit is the only changed scientific grouping dimension.

The original and reporting representations select the same observations and use the same qualification, censoring and arithmetic rules. Source-labelled estimates enter arithmetic only when selected. Other qualifications require the explicit `allowedQualifiers` selection. Every excluded or censored result remains in the complete observation table with its original source context.

A blank measured value and unspecified result unit remain blank, including when independently reported limits have valid reviewed concentration units. Detection and quantitation thresholds remain limits; they do not become measured values. Positive concentration factors preserve source inequalities. Each original limit retains its identifier, type, value, unit, origin, comment and source pointer beside its independently converted representation.

Receiving edits to names, methods, qualifications or measured values do not silently become scientific source corrections. This scientific view starts from the retained WQX source and its explicit paired concentration decisions. Source corrections can enter as a newly captured/received source edition and remain visible in the cross-edition comparison.

Arithmetic uses the existing exact decimal fractions. Display rounding does not alter the retained numerator and denominator. Converting a decimal to another reporting unit does not increase its source precision.

### Two different comparisons

A **reporting-window comparison** compares selected sample dates with a baseline window inside the same retained source and reviewed representation. Absolute changes carry the original scientific unit. Relative changes are supplied only for a recognized ratio scale with a positive baseline. pH, offset temperatures and unclassified scales retain their absolute differences and an explicit basis explanation.

A **previous-edition comparison** compares two complete saved scientific analyses. It distinguishes added and removed source result identities, changed original source parts, changed decisions, changed decision bindings, changed reporting representations and ambiguous duplicate/conflicting identities. A changed selection window can add or remove selected observations; both editions' complete options are retained. Group comparisons require matching complete scientific dimensions and reporting units.

These are descriptive comparisons. Sampling dates, methods, qualifications, detection limits and units remain available for the operator's scientific interpretation.

## Reference Potomac cohort

The retained source is the original Water Quality Portal `/wqx3/` NWIS cohort for USGS-01646580, January through March 2025. Its three original source profiles contain 1 station, 13 activities and 1,035 results, with 1,112 independently retained reported limits.

The complete source-module calculation produced:

| Measure | Complete original cohort | Reviewed representation |
| --- | ---: | ---: |
| Selected results | 1,035 | 1,035 |
| Scientific groups | 279 | 279 |
| Arithmetic results under default inclusion | 413 | 413 |
| Censored results | 452 | 452 |
| Qualified results | 146 | 146 |
| Source-labelled estimates | 10 | 10 |
| Populated results with reviewed concentration units | 298 source values | 298 |
| Blank result/unit records with independently reviewed limits | 451 source records | 451 |
| Independently converted reported limits | 1,089 original limits | 1,089 |

The complete choices select 220 mg/L results, 40 ug/L results and 38 ng/L results, plus 451 supported records with blank results and independent mass-concentration limits. A Turbidity record retains its original NTRU optical limits with an explicit Keep reason. Every original result and all 1,112 source limits remain attached.

For the original Silica observation `wqx-record-e7dcd103f470f706bc66c0589322d6de9cc4925e950981da060ab9c41c2bfbb4`, the paired representation is 4.65 mg/L and 4,650 ug/L; its independently reported 0.06 mg/L limit becomes 60 ug/L. The source result and limit retain their original strings.

March selects 418 results and January selects 140. Their default arithmetic populations are 140 and 68, and 64 complete scientific groups have comparable values in both windows. The whole original-to-reporting edition comparison retains zero source changes, 750 changed choices including the optical Keep reason, 749 changed concentration bindings and 694 changed reporting representations.

These reference calculations use the exact original source modules and retained source bytes. The maintained receiving operation records the actual native CLI, browser, MCP, complete-export and cold-reopen outcomes separately in its phase receipts.

### Source identities

- Capture: `cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7`.
- Original source review: `ba122f919127c23f701dcbf9cb88314fee46cdace3fd881b971a23b959489631`.
- Corrected source receiving plan: `893c32bd0b9729cc3504244670ecd05c34c51ddf1e44887296c7ea2cb0788e21`.
- Complete reviewed concentration document: `b7422a724dc68cc5afc57ed88fa5f49cac261ffc5ef2e548390fd1f7717f8bd8`.
- Resulting concentration plan: `5ce4586aee60335dfca474e802617942bf3a2a45bd042ae1a7ea9722d8d84e17`.

## Native CLI

Use the installed `starforge water-quality scientific` command, or the source entrypoint:

```bash
node wqx-water-quality/cli.mjs scientific preview \
  --project /srv/water/project --request /srv/water/quarter-request.json \
  --out /srv/water/quarter-preview.json

node wqx-water-quality/cli.mjs scientific save \
  --project /srv/water/project --preview /srv/water/quarter-preview.json \
  --out /srv/water/quarter-saved.json
```

A request selects the complete saved decision and optional earlier edition:

```json
{
  "reviewId": "potomac-q1-reporting-science",
  "decisionReviewId": "potomac-concentration-review-01",
  "expectedDecisionReviewSha256": "REPLACE_WITH_THE_SAVED_DECISION_REVIEW_SHA256",
  "title": "Potomac Q1 — original and reporting units",
  "note": "Complete source and reporting representations.",
  "options": {
    "window": null,
    "baselineWindow": null,
    "includeEstimated": false,
    "characteristics": [],
    "siteIds": [],
    "allowedQualifiers": []
  },
  "previousReviewId": "potomac-q1-original-science",
  "expectedPreviousReviewSha256": "REPLACE_WITH_THE_EARLIER_SCIENTIFIC_REVIEW_SHA256"
}
```

Omit both previous-edition fields, or set them to null, for an independent review. Dates use the original source calendar dates; original times and time zones stay attached.

```bash
node wqx-water-quality/cli.mjs scientific export \
  --project /srv/water/project --review potomac-q1-reporting-science \
  --format bundle --out /srv/water/complete-scientific-review.json

node wqx-water-quality/cli.mjs scientific receive \
  --project /srv/water/received-project \
  --bundle /srv/water/complete-scientific-review.json \
  --out /srv/water/received.json

node wqx-water-quality/cli.mjs scientific read \
  --project /srv/water/received-project --review potomac-q1-reporting-science
```

The CLI reserves an exclusive private output before a changing call. Reopen the original saved review after an interrupted response; existing output bytes remain retained. `list` returns small verified edition summaries.

## Complete files

| Format | Complete content |
| --- | --- |
| `json` | Saved review, original request, current and earlier analyses, comparison and all identities. |
| `observations` | CSV with every selected original and reporting observation, all limits, qualifications, reasons and source pointers. |
| `observations-tsv` | The same complete observation table as TSV. |
| `groups` | Both sets of scientific group summaries with exact fractions and source-group relationships. |
| `changes` | Complete previous-edition source, decision and representation changes. |
| `report` | Standalone HTML report with all groups, observations, comparisons and primary references. |
| `bundle` | Current scientific review, full earlier review hash preimage, and both complete native decision/source bundles. |

The outer complete bundle uses compact JSON and the existing 128 MiB transport ceiling. Each embedded original native bundle retains its exact decoded byte count and hash. No source table is truncated to fit the limit.

Receiving binds one review name, review SHA-256 and whole bundle SHA-256 before source import. It uses the original receiving engine for the current source and a separately retained private source project for the earlier edition. Both selected analyses are recomputed before publishing the complete scientific review. An interrupted import resumes that retained operation; its complete record is written after original source verification.

A small per-edition summary makes the saved list inexpensive to refresh. The summary carries its own hash and the full review identity; opening or exporting verifies the complete saved review and original decision source.

## APIs and implementation

The original authenticated private workspace provides:

| Method and path | Operation |
| --- | --- |
| GET `/api/standardized-analysis` | List saved edition summaries. |
| POST `/api/standardized-analysis/preview` | Analyze the complete selected original decision and scientific options. |
| POST `/api/standardized-analysis` | Save the exact request plus `expectedPreviewSha256`. |
| GET `/api/standardized-analysis/:id` | Reopen a complete immutable edition. |
| GET `/api/standardized-analysis/:id/:format` | Download one complete native file. |
| POST `/api/standardized-analysis/receive` | Receive `{bundle}` with both selected source editions. |

`standardized-analysis/model.mjs` owns the paired scientific model and complete cross-edition comparison. `formats.mjs` renders the full tables and report. `workflow.mjs` composes the original project and native receiving engine with immutable scientific editions. The existing scientific engine exports its original source-part semantic hash and group comparator so both representations share the same calculation.

The existing [merchant operator](../../../../stellar-forge/mcp-merchant-operator/WQX_SCIENTIFIC.md) exposes the same work through its typed client, CLI and complete resumable files.

## Full receiving operation

[standardized-analysis/RECEIVING.md](standardized-analysis/RECEIVING.md) gives the retained original Potomac source selection and the sequential native source, CLI, browser, MCP and cold-reopen command. The driver reuses the original concentration source phase, its exact retained capture, complete four-proposal chain and original source identities.

## Primary scientific references

- [EPA Detection Limits Best Practices Guide, August 2025](https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf).
- [Water Quality Portal web services](https://www.waterqualitydata.us/webservices_documentation/).
- [NIST SI Guide, Chapter 8](https://www.nist.gov/pml/special-publication-811/nist-guide-si-chapter-8).
- [NIST metric SI prefixes](https://www.nist.gov/pml/owm/metric-si-prefixes).
- [USGS pH and Water](https://www.usgs.gov/water-science-school/science/ph-and-water).

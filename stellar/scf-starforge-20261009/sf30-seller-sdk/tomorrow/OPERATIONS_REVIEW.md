# Weather operations review

This capability joins the existing Tomorrow.io weather workspace. It turns the selected forecast editions, original rule results and staff decision revisions into a work plan, review queue, assignment workload and portable report. It uses the same source and decision store as the operator UI.

## Operate the same workspace

Start the existing application from the Tomorrow source directory:

```sh
node server.mjs --workspace /absolute/weather-workspace --port 8874
```

Use the private session URL printed by the server. Select the location, work window, native fields and timesteps, and the thresholds appropriate to the planned work. The work window keeps explicit offsets; the selected timezone controls time display. The daily start hour remains explicit.

Review the original request and acquire the edition through the existing application. The operations view consumes the resulting native intervals and the existing rule results. It does not make another weather request. A map tile remains a separately captured visual resource; the analysis uses Timeline values.

For each interval, staff record an assignee, a decision and a note. The original workspace supports PROCEED, RESCHEDULE, REVIEW and CANCEL. A later correction appends another immutable revision. The operations view selects the unique highest revision bound to the same edition, interval and Timeline source hash. Earlier assignments and notes remain in decision history.

A current REVIEW choice remains in that assignee's queue. The other three choices remain recorded staff decisions. Threshold matches, missing values and changed forecasts are shown independently of that decision: reviewing a row does not remove its weather information.

Acquire a new edition to refresh the forecast. Compare the two original editions in the existing workspace. A prior decision stays with its original edition; the refreshed interval needs its own decision. The queue and assignment totals use the latest acquisition **among the selected editions** for each work plan. When two acquisition timestamps are equal, including when both are absent, the later supplied edition breaks the tie. Older selected editions remain readable in the report.

Download HTML for a readable source-linked review, CSV for filtering and work allocation, or JSON for the complete structured report. The report provides work plans, queue reasons, workload by assignee, original intervals and rules, comparisons, immutable decisions and the source register. Search works offline; the Print report control expands interval and source details and prints the full report.

## Report and source retention

The original plan remains authoritative:

| Original configuration / state | Download behavior |
| --- | --- |
| keyless-evaluation | Request and source identity, rule results and staff decisions are retained. Provider values and numeric changes are removed from JSON, CSV and HTML. |
| licensed-service with exportRaw enabled, AVAILABLE source and unexpired rawExpiresAt / license expiry | Native values and original comparison differences can be included. |
| Licensed export disabled, source unavailable or retention expired | The same report remains available as derived metadata; provider values are removed. |

The export guard evaluates expiry at download time, so an earlier live view does not keep expired values exportable. Comparing editions with different permissions redacts each side independently and removes the numeric change unless both sides may be retained.

Closing a keyless workspace clears its process-memory feed. Reopening it can still show the exact interval identities, assignments, decisions and triggered-rule IDs preserved by the original staff decision records. These rows are marked RETAINED_DECISION_ONLY. They are not reconstructed observations and are never counted as available weather values. Unreviewed feed intervals cannot be reconstructed after they expire.

The report is a point-in-time export. Follow the customer's configured usage and retention terms for copies outside the workspace. The source register carries acquisition time, response hash, actual response size/status, returned extent, source availability and the edition's raw-retention expiry.

## Source and decision meanings

- Counts describe actual returned interval rows within the selected work window. They do not assert a complete expected cadence or continuous safe conditions between samples.
- An interval startTime is its valid time. Acquisition, provider issuance and delivery/ADMS ingestion are separate events. This view does not invent those events.
- The weather workspace owns thresholds, field units, numeric evaluation and refresh comparison. This projection preserves its results without converting units, calculating replacement forecasts or re-evaluating rules.
- A threshold match is separate from missing/null data. The queue keeps both visible.
- Source references use the original edition ID, Timeline SHA-256, interval ID, timestep, valid time and field identity. If a source view supplies a JSON pointer, it is retained; otherwise the report does not manufacture one.
- Current assignment means the current immutable staff-decision revision for that source. It is not a staffing-hours or capacity estimate.
- The existing Austin Energy adapter and original weather_intake/austin_weather_acceptance engine own customer field mapping, unit conversions, source availability semantics and acceptance results. This report does not replace them.

## Integration API

The three additive files are operations-analysis.mjs, operations-report.mjs and this guide. They have no provider client, payment implementation, store or background process.

```js
import { buildOperationsReview } from './operations-analysis.mjs';
import { createOperationsReport } from './operations-report.mjs';

// Reuse the application's existing WeatherWorkspace object, including its
// current process-memory evaluation source. No source request is made here.
const editionViews = await Promise.all(
  selectedEditionIds.map(id => workspace.editionView(id))
);
const comparisons = comparisonPairs.length
  ? await Promise.all(comparisonPairs.map(([before, after]) => workspace.compare(before, after)))
  : [];
const review = buildOperationsReview({ editionViews, comparisons });
const output = createOperationsReport(review, { format: 'html' });
// output: { filename, mime, bytes: Buffer }
// The existing authenticated server sends the download. Its normal no-store
// response handling and original workspace state remain in force.
```


buildOperationsReview returns:

```text
schema, id, summary, workPlans, queue, assignments,
editions, intervals, decisions, comparisons, issues, definitions
```


Each queue row retains workId, editionId, interval id, timestep, startTime, sourceSha256, reasonCodes, needsReview, latestDecision, decisionHistory, assignee, original fields/rules and original comparison changes. Work plans contain activeEditionId and all selectedEditionIds. Decisions carry their original immutable fields plus applicability. CURRENT identifies the selected revision; other states explain why a record is historical or cannot select the current assignment.

The expected original comparison contract is exactly:

```js
{
  beforeId, afterId, comparable, reason?,
  rows: [{ timestep, startTime, field, unit,
           before, after, beforePresent, afterPresent,
           change, status }]
}
```


CHANGED, ADDED_INTERVAL, REMOVED_INTERVAL and MISSING_OR_DIFFERENT_UNIT remain separate original results. A non-comparable result and its native reason remain visible. No forecast difference is recomputed here.

createOperationsReport accepts only json, csv or html. Its JSON/HTML/CSV serialize the same freshly retention-filtered projection. CSV uses record_type for work_plan, assignment, source_edition, interval, source_field, rule_result, decision_revision, comparison and comparison_field rows. Original typed values and thresholds have JSON columns; value-state columns distinguish a source absence from a value removed by retention. Text that could be interpreted as a spreadsheet formula is escaped.

## Resume and handover

Use the existing workspace handover/import and original customer delivery APIs. Reopening does not create a new work plan, forecast edition, source request or payment intent. The operations projection can be rebuilt from the same original editions and decisions. Raw attachments require the existing licensed export permission and unexpired retention; metadata-only handovers retain decision history without pretending to restore an expired evaluation feed.

The report ID binds the selected edition metadata, source-derived view, work plans, decisions and native comparisons. A new forecast or decision revision changes that ID. It is a source-bound snapshot identifier, not a vendor delivery receipt or a claim of customer acceptance.

## Original references

- Timeline parameters and time semantics: https://docs.tomorrow.io/reference/post-timelines
- Native field units: https://docs.tomorrow.io/reference/data-layers-core
- Solar fields for the existing Austin customer mapping: https://docs.tomorrow.io/reference/solar
- Original source configuration, observation and retention implementation: config.mjs, source.mjs and workspace.mjs in this same directory.

Powered by Tomorrow.io — https://www.tomorrow.io/


# Supplied production-plan review — operator guide

Open Planning_Blank.html for real source. The separate authored example is fictitious and labelled throughout. This tool retains and reviews supplied schedules; the owning planning system produces and dispatches plans.

## Work from original source to a decision

1. **Original sources.** Retain the complete CSV, TSV or JSON files. Select an original and inspect its exact rows. Original downloads preserve its bytes. Opaque files may be retained, but calculations require exact UTF-8 tabular content.
2. **Plant and mappings.** Declare plant ID, horizon, as-of, currency and clock. Select each original table and map its fields explicitly. JSON selectors are pointers relative to a row. Declare completeness only for the actual owner's known inputs; unknown coverage stays visible.
3. **Preview.** Name the edition and preparer. Preview shows every source finding, supplied assignment, delivery consequence, capacity segment, material ledger and lag/setup check. Required minutes are lower bounds; actual supplied durations are retained. Missing rate data yields known cost and an unavailable complete total.
4. **Freeze.** Retain the complete preview as an immutable edition. Invalid received plans can be frozen for correction; they do not become review-complete candidates.
5. **Source corrections.** Inspect the currently mapped table, load an original row, edit its complete JSON with decimal values as text, and name the correction preparer and reason. Loading another row retains its unfinished text. Preview and adoption are separate. Adoption creates a new JSON source with the original body identity, original row references and before/after hashes; it keeps a prior session and changes only the draft mapping. Freeze that successor separately.
6. **Compare.** Select exact baseline and candidate editions. Every changed source row, unmatched operation, start/end movement and cost/delivery delta is retained. Changing downtime or other definitions is a scenario caveat, not an automatic better/worse claim.
7. **Decision proposals.** Name the proposal and intent, preview the full comparison, and retain it. PLANNING and OPERATIONS reviewers select the exact proposal. Each decision binds its complete comparison digest; later decisions preserve earlier history. Review-complete concerns the source package. Dispatch and physical authorization stay in the owning system.
8. **Save and reopen.** Complete working JSON contains originals, all editions/proposals/reviews, unfinished form and JSON text, correction drafts and previous sessions. Editable HTML embeds that exact working carrier plus complete source. Opening another working file first preserves current work. Failed intake leaves current work intact.
9. **Handover.** Full ZIP retains exact application source, working JSON, editable HTML and every original. The whole handover must fit128MiB/2,000members before a mutation replaces current state. The individual domain and session limits do not override that complete-package admission.

## Explicit modeling decisions

One operation is one contiguous interval on one resource. Split phases use distinct operation IDs and declared precedence. Simultaneous equipment/labor occupancy needs an agreed extension or an approved upstream representation with its synchronization rule reviewed separately; this package does not enforce a multi-resource task. Exclusive resources disallow overlap even below numeric capacity. Cumulative resources sum exact demands. Available windows declare capacity; unavailable overlays declare zero. Overlapping available windows are ambiguous.

A declared changeover policy requires exact from/to rules, including same-family and initial-family transitions. Changeover time occupies the immediate pre-start gap and must lie within availability. Cleaning that consumes other resources should be its own operation. Initial stock is an explicit supply row. Same-time supply is available before grouped demand. Unit mismatches are never silently converted.

Completed operations lock start/end/resource. In-progress operations lock start/resource, and any explicitly locked end. The scope uses ISO timestamps with seconds and offsets, or one fixed offset for all naive times. Named-zone daylight-saving transitions require upstream normalization.

Hourly costs are explicitly **per assignment hour** or **per capacity-unit hour**. Separate changeover cost is a fixed declared amount. Missing rates remain unknown. No overtime multiplier, delay penalty, carrying cost or movement cost is invented. Read the complete domain contract for all fields and limitations.

## Persistence and performance

Browser storage is best effort and can be full or changed by another opening. The status line explains the current state. Download working JSON regularly. Long calculations display a working notice after draft preservation; they can take minutes for larger source populations. Source-execution timings from the included course are not browser timings.

The application has no network dependency. The complete application-source download is a gzip+Base64 JSON envelope; the maintained Python opener accepts it directly. Private research, correspondence and commercial terms are kept outside application source.

## Native materialization and commands

Place the supplied materialize-source.py next to the complete source download:

```sh
python3 materialize-source.py Planning_Complete_Application_Source.json planning-source
cd planning-source
node native/build-desk.mjs ../Planning_Blank.html
node native/planning-cli.mjs demo --out ../authored-course
node native/planning-cli.mjs course --out ../source-course
node native/receive-operator.mjs ../operator-course
```

Create-only native publication preserves an existing output; exact reruns may resume only when the operation identity and every written member agree. The standalone builder requires a new output path. `node native/build-desk.mjs NEW.html WORKING.json` reopens the exact operator carrier. See docs/NATIVE_RECEIVING.md and docs/BROWSER_RECEIVING.md for the whole course.

## Included authored result

The baseline has3 jobs/6 phases and USD470 declared cost. A fill-line outage produces2 retained findings. The supplied recovery moves2 fill phases, keeps completed/in-progress work and maximum holds, and shows B30minutes late plus C60minutes late. Its known cost remains470. The changed availability is visible in comparison. These are calculations on fictitious source, not customer outcomes.

# Comparable-period observation desk — retained cohorts and source editions

## Deliverable

An offline, source-preserving desk and native report source for SV-833 water-quality observations. The original station record is 610 result IDs from 56 sampling activities, spanning January 20, 2021 through June 24, 2026. The desk retains the publisher responses, their original result and activity selectors, reporting limits, full-profile reconciliation inputs, calculation source and report recipe.

The new module adds common-calendar-month comparisons across every same-series year pair. It leaves the existing annual study, microbial calendar explorer and original Workspace records intact. The native source can be included alongside those studies in the existing ordered Scientific study reports control.

## Open the delivered material

Open `source/index.html` for the interactive desk, or `native-report/report.html` and `native-report/report.pdf` for the printable 2025-to-2026 comparison. Keep the entire unpacked folder together so original source downloads remain available. The desk makes no external requests and works as a local file. Browser CSV exports include every filtered record, not only the current page.

`comparisons.csv` carries every year pair. `monthly-support.csv` exposes month-by-month support. `activity-measurements.csv` maps each single-weight analytical activity to all original result IDs. `comparability.json` includes the complete exact rational endpoints and original rows. `model-sources.json` imports the complete report and all its companions into the scientific workbench.

## Calculation

The series key consists of station, source project, characteristic, unit, sample fraction, chemical specification, analytical method, method context and result value type. Within each exact series, agreeing result IDs from the same activity and date have one analytical measurement weight. Conflicting intervals are retained without a numerical summary.

An original quantified value is a point. A below-limit result keeps its original lower and open upper endpoints. An above-limit result keeps its original open lower endpoint and unbounded upper endpoint. No fitted, zero, half-limit or reporting-limit substitution is made. Exact rational arithmetic computes each activity interval, the equal-activity mean for each month, and the equal-month mean over the common set. The reported difference is later year minus earlier year, with endpoint openness propagated.

A month joins the common set only when it is present in both selected years and every recorded measurement in that exact analytical month has supported, eligible original numerical content. A month containing an original excluded or conflicting measurement remains in the support ledger but is not labelled complete. The one original out-of-range pH result is retained unchanged and excluded using the existing index's screen. No new analytical outlier screen is added.

These are descriptive arithmetic bounds for retained grab samples. They are not confidence intervals, annual mass loads, regulatory evaluations or causal trend estimates. Equal calendar-month support removes an obvious coverage mismatch, not all sampling differences. pH arithmetic describes reported pH values, not mean hydrogen-ion concentration. Source projects and chemical specifications remain separate, including the one-year SWS-2024 sample.

## Install without replacing another contributor's source

Copy only these three new files into the maintained application's `measurement_workspace/` directory:

```
observation_comparability.py
observation_comparability.html
observation_comparability_delivery.py
```

The producer requires Python 3.10 or later and the standard library. Native delivery uses the maintained `model.workspace`, `model.observed_context`, `model.scientific_report` and `model.portable` modules, plus their existing runtime dependencies. No model or simulation is launched by these commands.

Generate a source edition from the retained original application:

```sh
python -m measurement_workspace.observation_comparability \
  --application /absolute/path/to/application \
  --output /absolute/path/to/new-source-edition \
  --year-a 2025 --year-b 2026
```

Run from the application directory or add it to `PYTHONPATH`. The output must be new or empty. Every original index-to-result selector is checked against the retained source CSV and its SHA-256 before the source is generated.

To import into an owned receiving Workspace, render native PDF/HTML/Markdown, save the selection and export the complete working project:

```sh
python -m measurement_workspace.observation_comparability_delivery \
  --workspace /absolute/path/to/owned/workspace \
  --manifest /absolute/path/to/new-source-edition/model-sources.json \
  --output /absolute/path/to/new-delivery
```

This adds one immutable native Sources collection. The recipe uses `upstate.observed-report/v1` and `metadata.report_schema`, so it is available to the existing ordered scientific-report selector. The saved selection and report are retained at `workspace/observation-comparability/<recipe-sha256>/`. The portable ZIP includes the application, original project and the new report-source companions.

To use the report with another current project, import `source/model-sources.json` through that project's existing source import action. It preserves the original station/provenance and does not replace the receiving project's identity. Then add **SV-833 comparable-period water quality** to the existing Scientific study reports selection. The generated `native-selection.json` records the IDs from this operated receiving project; a different receiving project must use its own returned collection ID.

For independent reopen, restore the archive to a new directory with `model.portable.restore`. Start a fresh Python process with only the restored application first on the module path, open its restored Workspace, read the saved report selection and call `model.observed_context.bind`. The original project ID and retained source choice travel with the archive.

## Data conventions

Machine data retain the original unit string, including the publisher's `None` unit for pH. Human-visible intervals use six significant digits; `lower_exact` and `upper_exact` preserve the full rational endpoints. Empty machine endpoints denote an unbounded endpoint, not a zero. An open parenthesis excludes an endpoint. Full observed-period means in the desk use activity weighting across actual dates and are kept separate from equal-month matched means.


## Receive another retained cohort or a later source edition

The same producer accepts another maintained original-result index with
`--index`. That input must preserve the original series, interval/screen and
CSV row-selector fields documented above. It is an indexed original-source
input; an arbitrary CSV with guessed field meanings is not admitted. The producer
checks every selected result ID, source CSV SHA and original row number before
creating the report source. Keep the selected index and its complete referenced
publisher responses under the selected application/source root.

```sh
python -m measurement_workspace.observation_comparability \
  --application /absolute/path/to/retained/source/root \
  --index observations/selected-cohort/original-result-index.csv \
  --year-a 2023 --year-b 2025 \
  --title "Selected catchment — comparable-period observations" \
  --source-prefix selected-catchment-observation-comparability \
  --output /absolute/path/to/new-source-edition
```

The title and source prefix are optional. Without them, the title follows the
actual retained station identities and the source family follows the single
station, or uses a common family for a multi-station cohort. The source prefix
uses 1–80 lowercase letters, digits or hyphens, starting with a letter. Complete
input and producer hashes still identify each individual edition. Explicit
presentation choices never replace the original station, project or analytical
fields. The original default index and 2025/2026 selection remain available.

Every title, observation-period statement, source vintage, original-index link,
source-family ID and downloaded filename now follows that selected edition.
The complete original rows retain their original dates and published URI
strings; all distinct source URIs remain in the structured presentation record.
If no publisher URI is present, the native manifest identifies the actual
retained local index rather than inventing a publisher URL.

Each report row includes its analytical-series label. The full original series
table gives the complete station, project, characteristic, unit, method/context,
sample fraction, chemical specification and value type for that label, alongside
the full stable series identity. Empty original fields are displayed as empty.
The desktop/phone desk shows the same complete fields, adds station filters, and
exports every original field in its existing CSV/JSON outputs. An identically
named characteristic from a different method or station remains distinct.

## Continue an exact saved review

The offline desk retains selected years, station/project/characteristic filters,
analytical series, original-row query, page and inspection tab in browser storage.
The storage key binds the complete original-input identities, authored producer,
presentation and default comparison. A different source edition starts with its
own selection; a saved selection cannot silently carry over to changed data.
The visible status reports whether this browser retained the selection. All
source inspection and exports continue if browser storage is unavailable.

Save the entire generated folder for handover. Browser storage is convenience
state on that browser; the original source, full comparisons and defaults remain
inside the offline file and its companions. Comparison and original-row CSV
exports contain every filtered row across all pages.

## Native application and portable receiving

The additive `integration/component_fragments/observation-comparability.json`
selects the complete maintained component and its maintained observed-context
and generic scientific-report-rendering dependencies through the ordinary installer. It does not change the shared
component catalogue. The existing Sources import and ordered Scientific study
reports controls consume its original native manifest/recipe; this component
does not introduce a parallel report engine.

The native delivery command keeps its actual receiving project and selected
collection IDs. A completed or partially written export is bound to its original
project/source/recipe before any later report/export write. To deliver a changed
source edition, select a new output directory. The established default SV-833
archive filename is retained; other source families use their explicit source
prefix. Existing complete native source/report/archive artifacts remain intact.

The published original 7C31 computation and completed native receiving remain the
baseline for this reusable producer. Arithmetic, original-source screening,
activity deduplication and common-month weighting are unchanged. This edition
adds source-aware presentation, usable review continuity and complete application
publication.


A repeated delivery with its completed portable ZIP first verifies that original
archive through the maintained portable inspector, then reuses its exact saved
report selection and report bytes. It does not rerender with a later formatter
and pair that output with an older ZIP. Missing exported report members and the
final receipt can be recovered from the verified original archive after an
interruption. Different existing bytes are preserved and reported explicitly.
Per-Workspace and per-export kernel locks keep two receiving invocations from
writing this report simultaneously.

To intentionally render an existing source with newer application/formatter
code, pass `--new-rendering` and choose a new export directory. That creates a new complete snapshot while
the prior export remains available. The returned report_selection points to the
export's own native-selection.json, so later work on the Workspace does not
silently change the selection described by that completed handover.


A completed Workspace report is also resumed before an outer ZIP exists. Its
entire saved formatter and observed-source file inventory is verified against
the same original selection and binding. The native formatter is not called
again on that original report directory. This covers an interruption between
report completion, output copying and portable publication.

An explicit `--new-rendering` uses the existing
`model.observed_report_render.prepare/render` operations. The retained
preview binds the installed renderer source files, selected observations,
presentation, title, organization and Workspace. It is saved before rendering;
a retry continues that exact preview. New report bytes have a separate
`renderings/<original-operation-id>/` directory, and every prior saved
selection remains under `retained-report-selections/` before the
current selection advances. Both the original completed report and its previous
portable export remain usable.

```sh
python -m measurement_workspace.observation_comparability_delivery \
  --workspace /absolute/path/to/owned/workspace \
  --manifest /absolute/path/to/retained-source/model-sources.json \
  --output /absolute/path/to/new-rendered-edition \
  --new-rendering
```

Ordinary repeats omit this flag. A completed output directory always denotes
its captured original edition. Report member publication uses the maintained
bounded, atomic original-file retention, so a lost receiver does not leave a
new partially written PDF under its final filename.

An interrupted export freezes its own `native-selection.json` before any report
member is copied. If another output later selects a new rendering, the earlier
output resumes its saved report directory and exact bytes. Its portable archive
uses the maintained delivery-file index to retain that exact selection and
complete report inventory, so archive-only receiving chooses the same report
even if the Workspace's current report marker has advanced. Original older
archives remain readable through their original saved marker.

## Inspect the exact outgoing product

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->

## Use comparable periods inside the application

Open **Comparable observation periods** in the original operator. Choose the
installed original SV-833 cohort or any complete comparable-period source already
retained in Sources. The source reader verifies the original index, every
publisher response, result-row selectors and all retained source companions
before showing the data. It supports the original v1 SV-833 source and current
source-aware editions.

Choose an earlier and later observed year and a useful title. The page shows the
unchanged common-month comparison, full nine-field analytical identities,
month-by-month source support and complete original measurements. Station and
exact-series filters keep unlike methods, units, fractions, specifications and
projects separate. CSV downloads include every matched row across pages and
all original fields; the complete source remains available in the saved ZIP.

**Save complete comparison** uses the existing operation queue. The confirmation
retains the exact source/binding and installed producer identities together with
the years/title. A different installed producer requires reopening the source
before starting a new generation. A completed original edition remains readable
after updates; an interrupted import resumes the same fully retained output.
The original numerical calculation is the same maintained
`measurement_workspace.observation_comparability` producer.

Open the saved result from its task or the saved-comparison selector. **Open this
report only** replaces the existing composer draft with that exact retained source
and its saved title. **Add to current report** appends that source to the existing
ordered selection, preserving the existing nonempty title and source order. Both
use the maintained Scientific Reports composer; choose the intended operation
explicitly so an unrelated draft cannot silently become this comparison's report. The complete source ZIP contains the generated offline desk, all
original input responses, every comparison/support CSV, structured data, native
source manifest, calculation/desk source, store module and this guide. Extract
the whole ZIP before opening `index.html`, so its original source links resolve.
The scientific recipe's own companion inventory retains its original declared
calculation inputs; the full ZIP and ordinary Workspace archive additionally
carry the native store and operating guide.

The Workspace retains saved comparison selections and all result files under
`observation-comparability-selections/<selection-id>/`. Ordinary portable
backup/restore preserves them, and the original extension's Workspace
verification checks every saved source/result identity on reopen. Its task
downloads are regenerated through the existing verified file-ticket route.
Browser drafts are scoped to the selected Workspace, while saved native results
remain authoritative and portable.

For the existing 7C31 receiving continuation, open the populated current operator
at desktop and narrow width; select the original source and a real year pair,
inspect exact-series calendar and original rows, save through Tasks, open every
principal download, send the saved source to Scientific Reports, and reopen the
comparison in the restored Workspace. View the actual resulting screens and
native report. The original scalar/interval arithmetic and completed baseline
source remain the reference for the same cohort.


## Transfer a selected report with its saved comparison

Newly saved native comparisons bind their original project and selection ID in
the source manifest before the source ZIP and complete edition are published.
This changes neither the original observed recipe nor its numerical inputs.
A selected Scientific Report now follows that exact native origin and retains
the complete comparison receipt, build inventory, original source files, offline
desk, CSV/JSON outputs and source ZIP. If the comparison began from another
retained source, its exact input collection travels with it as well.

In Scientific Reports, transfer the completed report through the existing
selected-Study operation. Receive the archive into its original Workspace and
open **Received studies and original sources**. Its **Comparable observation
periods** card opens the exact saved comparison. From there, inspect the source
rows and support, download its original files, and choose years/title for a new
edition through the ordinary queue. The original saved edition is preserved.
The card also offers explicit replacement or append into Scientific Reports.

An original source imported from another project keeps its captured report
and source companions. Its origin remains that original project; the receiver
does not fabricate a local editor record. Older standalone or already-completed
comparison sources without a native-origin marker retain their original
source-only transfer behavior. Ordinary full Workspace backup still preserves
all their existing saved comparisons. New native source collections are distinct
per original saved comparison, so two different editor editions cannot silently
share an ambiguous report-to-editor link.

Continue the same original native/browser receiving course: export the selected
saved scientific report, receive and reopen the Study in a fresh operator, open
the comparison card, inspect its exact original year/title/source, download the
complete source ZIP and CSV, then exercise both report-composer choices. View
the actual populated desktop and narrow rendered result before presentation.


## One complete native receiving course

The maintained receiving command continues the original cohort through the actual
operator queue, saved comparison, native scientific report, selected Study
transfer and full Workspace receiving. It uses the original calculation and
scientific renderer. Install the complete current application, including this
component and the existing Study transfer component, before starting.

From the actual application directory, with the original restored Workspace:

```sh
python -B source_tools/receive_observation_comparability.py \
  --workspace /actual/received/workspace \
  --state-directory /actual/cohort-receiving/operator-state \
  --restore-directory /actual/cohort-receiving/restored \
  --output /actual/cohort-receiving/output \
  --operation-id ECO-INTEGRATE-ASTRA13-7C31

```

The path examples name the existing receiver's owned locations. Substitute its
actual paths once, then retain that exact command and output directory. The
default selects the installed original SV-833 index and its maintained default
year pair/title. To choose a retained original cohort, supply both
`--source-collection ORIGINAL_COLLECTION --source-id ORIGINAL_SOURCE`.
Explicit `--year-a`, `--year-b` and
`--title` select the same values exposed in the native desk.
The native source reader validates the complete original inventory before saving.

The command freezes its actual save request before queue admission and records
the actual accepted task and operation IDs. Ordinary retries use the same
arguments and output. Interrupted tasks resume through the maintained queue;
after repairing a failed original task, add `--resume-failed`.
The completed comparison and report remain the selected originals when installed
source advances. An unfinished report whose original renderer changed returns
the maintained renderer's exact exception for source repair; it does not silently
substitute a different preview or repeat a completed report.

A single run performs the whole receiving course:

1. Open the original installed or retained cohort through the existing catalogue
   and inputs routes; queue and reopen the exact saved comparison.
2. Preview and queue its original scientific report; consume the complete native
   report ZIP and original comparison/report download streams.
3. Export the selected scientific report as an editable Study; confirm its archive
   contains the original comparison receipt and full retained source tree.
4. Upload and restore that exact Study through the native task queue; reopen the
   original comparison and its received-source card.
5. Export, upload and restore the full original Workspace, preserving the complete
   original comparison and report files.
6. Restart the original operator task registry. Then run this same receiver from
   each actual restored application's own source in a separate Python process,
   reopening the original report and editor there.
7. Write `browser-handoff.json` with the exact selected IDs and both
   restored project paths for the already assigned visual receiving phase.

`cohort-receiving.json` retains the selected source, original requests,
accepted tasks, original downloads, source implementation history, all receiving
results and cold-reopen commands. `original-product.json` retains the
complete original output identity used by both restored applications. The output
also keeps the original selected Study ZIP, full Workspace ZIP, report ZIP and
each cold process's actual stdout/stderr. The course uses its own kernel lock and supervises the native operator inside
one owned Linux process group. `--timeout-seconds` bounds that whole invocation;
`--shutdown-seconds` bounds its separate graceful stop before terminating that
same verified process group. Actual PID/start/boot identity is recorded in
`supervision.json`. Native imports and every phase run inside the owned child,
so a queued report's blocking operator shutdown cannot trap the parent. The
native and cold children inherit the original output lease if their parent
stops; later invocations cannot publish over an active original continuation.
Retained queue requests and completed files remain the source for an ordinary
same-command retry after interruption.

The native command completes native receiving. Continue the same operation in
the actual browser using the exact handoff, under the standing owner instruction
above: open and look at the outgoing original screens and files at desktop and
390px; operate period/source/title, rows, shared-month calendar, save/reopen,
replace/append report selection, selected-Study editor reopening and complete
downloads. Exercise the populated, empty, loading and error recovery states.
Open the extracted offline desk and native PDF/HTML, view every captured image,
and repair visible or functional defects in the same source before delivery.
Retain these actual browser results beside the native handoff.


## Receive another project's original cohort and save a local comparison

A selected Study can contain a comparable-period source whose original native comparison belongs to another project. Its complete publisher responses and original measurement index remain usable in the receiving Workspace. On that received source's card, choose **Use original cohort for a local comparison**. The action carries the exact receiving Workspace, source collection, source identifier and recipe SHA256 into the existing comparable-period desk. The desk verifies every original input through the maintained source loader before enabling Save.

Choose the earlier and later years and the saved report title. **Save complete comparison** uses the ordinary native task and immutable source-bound build. It retains a comparison in the current Workspace, preserving the received source and original report. Original year-pair defaults come from the retained source; the complete series, reporting limits, activity weights and shared-month calculation are unchanged. The desk exposes the original source title, collection, recipe digest, project and native selection under **Original cohort source** both before saving and after reopening the local result. This read-only context does not alter any original saved identity, request binding or receipt.

After the task completes, open its saved comparison. **Open this report only** replaces the draft Scientific Report selection with this local result; **Add to current report** appends it. Continue through the existing report, selected Study and whole-Workspace export. The selected Study retains the local native comparison, the complete source package and its exact selected original input collection; reopening returns to that local comparison while its received original source remains separately identifiable.

On the same assigned native/browser receiving course, inspect a received external-project cohort card, open the local-comparison action, choose a distinct title or year pair, save and reopen from Tasks, then make the original report/Study/Workspace round trip. Confirm the local project and original source identifiers in the rendered views, inspect the complete original rows and downloaded inputs, and open the exported files. During asynchronous loading, choosing another source or saved edition must supersede the pending read; changing the title or year selection must keep the current edit. Inspect desktop and narrow layouts using the current application's ordinary controls. Continue the existing course and retained artifacts; do not start another model run.

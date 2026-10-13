# Open Big Creek's original chemistry in the existing study

Use the existing application and its original selected report Workspace. This source family adds the original Big Creek laboratory records to the same Scientific Reports, editable Study and cold-reopening workflow as the completed NC ambient source.

## Native command

The shared report receiver was shipped with PR3951. Keep its complete current source and the application's later native report/transfer fixes.

```sh
"$PYTHON" -B "$APPLICATION/source/nc_ambient_measurements/20261013/open_saved_report.py" \
  --workspace "$WORKSPACE" \
  --manifest "$APPLICATION/nc_big_creek_sensitivity.sources.json" \
  --source-id nc-big-creek-sensitivity-observed-report \
  --title "Big Creek: original sample roles and laboratory sensitivity" \
  --output "$OWNED_OUTPUT"
```

Use the receiving worker's actual existing Python, application and Workspace paths. Set OWNED_OUTPUT to a separate directory outside the application and Workspace. The receiver saves its progress, source choice and output identities. Repeating the same command resumes the same saved edition. An optional `--preceding-sources` JSON array can place completed original report sources before this one. It contains exact objects with `source_collection_id` and `source_id`. Keep modeled-source and observed-source identities explicit.

The normal command imports the complete source, previews and renders its saved scientific edition, copies every report member with its relative path, exports the selected editable study, restores the package, and opens it with a fresh Python interpreter using the received application. `--render-only` can first prepare the same report; repeating the same command without that flag completes the export and reopening.

## Use the source and its controls

Open `source/nc_big_creek_sensitivity/20261013/report.html` and `measurement-explorer.html`. Both are complete offline files. Retain the entire source-family directory to keep original CSV and report links usable.

The explorer starts with all 943 rows. Its original-activity-type selector must show 564 Sample-Routine, 336 Quality Control Sample-Equipment Blank, 24 Quality Control Sample-Field Blank and 19 Quality Control Sample-Field Replicate rows. Parameter and exact-group controls retain fractions and sample roles. Numeric sorting requires one exact group. Selected CSV and JSON downloads contain all matching rows, even when the screen shows only one page.

Useful normal receiving actions:

- Select Sample-Routine and Cyanide: twelve nondetect records, each with original 0.02 mg/L reporting limit, across twelve sample dates.
- Select Sample-Routine and Cadmium: 72 rows; the exact-group choices separate 48 dissolved from 24 total records. Both cohorts span 24 dates.
- Select field blanks and Mercury: 24 original records. Their values never enter the routine environmental summary.
- Search Z2 and immediately export: one Not Reported turbidity record, STORET-256221514, original blank numeric value/limit and full reliability comment.
- Select routine Mercury: nine original numeric results and fifteen nondetects. Open the 1.28 ng/L record to see the original Q2 holding-time comment.
- Open all three plotted SVGs and compare their points with plot-data.csv. Cyanide limits display in µg/L with the explicit factor 1000; original CSVs retain mg/L. Cadmium's 0.4 reference is explicitly historical. Mercury retains ng/L.

View the populated desktop and 390 px explorer/report. Operate the keyboard table, filters, row dialog, downloads, printing, original source links, selected Study export and received reopening. Open the original CSVs and downloaded JSON in their ordinary viewers; inspect the complete ZIP and its working project. View each real generated PDF page and SVG. Return actual rendered images to the source authors for immediate repair of any visible defect.

## Rebuild the source edition

From the application root:

```sh
node source/nc_big_creek_sensitivity/20261013/reproduce.mjs --check
```

The reproducible build uses the retained complete CSV/assessment originals, all source hashes, the deterministic derivation/presentation and the maintained measurement-explorer builder from the already merged ambient family. Use `--write` only when deliberately producing the corresponding regenerated source outputs. Original sources remain unchanged.

## Current owner direction

Canonical application path: `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`. This observation source is a complementary chapter of the useful, editable native model product. The original georeferenced baseline/restoration/matched-control execution keeps its current workers and Workspace. Pass the complete direction below to delegated receiving peers.

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.


## Standing product inspection instruction

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


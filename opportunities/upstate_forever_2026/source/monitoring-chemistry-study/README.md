# Monitoring and Chemistry: complete native study

This source continues RIVER13's completed Upper Savannah monitoring and compound Chemistry study. It builds the delivered offline workbench and two-page brief from original saved results and retains the independent application receiving tools. The regional monitoring plans use the original 217-catchment source geometry. The separate four-reach Chemistry example is the explicitly authored numerical-method case.

Read [CURRENT_OWNER_DIRECTION.md](CURRENT_OWNER_DIRECTION.md), version `2026-10-13.3`, and the application's [AGENTS.md](../../AGENTS.md). Continue the actual Upper Savannah 30 m native baseline, riparian alternative and matched control with the existing geographic owners; the sprint cutoff remains October 13 at 14:00 UTC. This completed complementary study joins that application without restarting its active model work.

## Open the completed work

- [Offline Monitoring and Chemistry workbench](https://chatgpt.com/api/library/files/libfile_810a4b6556e08191931d8448583584f4/download): original catchment map, search, three saved budget choices, sampling calendars, four analyses, uncertainty curves and 64 original downloads.
- [Complete editable application and Workspace](https://chatgpt.com/api/library/files/libfile_2eef9fce54dc8191934d0c96448fe56f/download): 278,380,667 bytes, 4,805 members, SHA256 `cc47720efdb57d8026fc9e7b52662ee2580dc4e53870281664ca5db35f7ebdab`.
- [Two-page study brief](https://chatgpt.com/api/library/files/libfile_2e23437134d08191905f7582570dff06/download).
- [Original completed native reports](https://chatgpt.com/api/library/files/libfile_7493df529e4c8191a765052f0144a6da/download) and [complete receiving record](https://chatgpt.com/api/library/files/libfile_a5f81b5080748191b4477a2b261207df/download).
- [Original full source delivery](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791890736518569?thread_ts=1791724121.853269).

The completed project is `b9d5d257-c6bb-4f07-b975-8e8c63705db3`. Its saved comparison `0651cf37ebe7e0500ae8b6233740e49a75c255c663d2f1a88b07bb4cfe8d9dee` retains the $4,800 / $9,000 / $13,200 plans: six / twelve / eighteen search areas and eighteen / thirty-six / fifty-four planned visits. Catchment coverage is the original area objective; source-water priority, station assignment and observed support remain explicit separate selections.

The original compound calibration, sensitivity, 512-draw parameter-prior ensemble and eight-candidate design retain their saved run IDs. The ensemble matches the weighted original component predictions exactly; fitted coefficients differ by at most 3.552713678800501e-15 in this authored case. Original numerical records, parameter draws, source bodies, report editions and editable files remain together.

## Source layout and installation

The executable report renderer is `model/reach_chemistry/reporting.py`, presentation edition `reach-chemistry-scientific-report/4`. Its complete data tables scroll on screen; wide printed tables use readable labeled panels with the original record key repeated. The same original rows, fields and ordering feed both views.

The maintained Chemistry installer and active inventory at `integration/reach_chemistry/COMPOUND_SOURCE.json` install this entire study directory with the current Chemistry component. This directory's own `COMPOUND_SOURCE.json` is the retained original producer inventory; its historical browser entries are provenance. The local `reporting.py` is the exact original renderer reference, marked retained-only for component dependency analysis. Ordinary application imports use the canonical `model.reach_chemistry.reporting` module.

The original study additionally uses Python NumPy/SciPy, ReportLab, pyproj, Shapely and Playwright with an installed permitted Chromium. Use the actual scientific environment and an ordinary independent output directory. `make_study_brief.py --browser-executable` accepts that environment's Chromium path; its original default is `/usr/bin/chromium`.

## Continue the saved study

Use the actual received application and Workspace paths. Set `STUDY` to this installed directory and `OUT` to a separate output directory. Keep output outside the application and Workspace. The original completed reports JSON and the study's four retained technical PDFs can be used directly when rebuilding the workbench.

Prepare the original saved budget comparison and its original source downloads:

```sh
python -B "$STUDY/prepare_budget_study.py" --application "$APP" --workspace "$WS" --output "$OUT/budget-study"
```

For a saved original compound course that needs the new presentation, use its actual `native-course.json`. This refresh reads completed analyses and prepares their report/source editions:

```sh
python -B "$STUDY/refresh_report_layout.py" --application "$APP" --workspace "$WS" --course "$NATIVE_COURSE" --output "$OUT/reports"
```

`refresh_report_layout.py` recognizes its exact original renderer or this installed edition. Its source guard preserves a different producer. The active current component inventory remains authoritative; the renderer's original numeric work is reused.

Build the offline workbench using the saved report JSON and the directory containing its original `calibration.pdf`, `sensitivity.pdf`, `uncertainty.pdf` and `monitoring.pdf`:

```sh
python -B "$STUDY/build_study_workbench.py" --workspace "$WS" --budget-study "$OUT/budget-study" --reports "$REPORTS_JSON" --pdfs "$PDFS" --template "$STUDY/study.html" --output "$OUT/workbench.html"
python -B "$STUDY/make_study_brief.py" --workspace "$WS" --reports "$REPORTS_JSON" --comparison "$OUT/budget-study/comparison.json" --workbench "$OUT/workbench.html" --assets "$OUT/brief-assets" --output "$OUT/study-brief.pdf" --browser-executable "$CHROMIUM"
```

Every embedded scientific download comes from its original retained file. The builder rejects report links leaving the saved report directory. Use the original technical PDFs from the completed study, or print the corresponding saved native report HTML through the permitted browser using that report's own print styles.

Capture the complete application/Workspace and open the contained application's own producers in a new interpreter:

```sh
python -B "$STUDY/capture_editable_workspace.py" --application "$APP" --workspace "$WS" --reports "$REPORTS_JSON" --comparison "$OUT/budget-study/comparison.json" --archive "$OUT/editable-workspace.zip" --receive-into "$OUT/received" --output "$OUT/receiving.json"
python -B "$STUDY/open_completed_study.py" --application "$OUT/received/application" --workspace "$OUT/received/workspace" --reports "$REPORTS_JSON" --comparison "$OUT/budget-study/comparison.json" --output "$OUT/archived-application-reopen.json" --expected-selection "$OUT/receiving.json.selection.json"
```

The maintained capture writes its original intent before capturing anything and freezes the selected native records, every selected scientific file, and the imported producer editions. It verifies the complete ZIP member inventory and archive SHA256 before accepting a saved archive. If capture published the archive before its progress write was interrupted, continuation adopts that archive only when the original project, complete selection and frozen scientific members match. A different or partial archive is an actionable error.

The existing destination is reopened through native `portable.resume_restore` with the saved archive hash; an absent destination uses native `restore`. The native resume protocol preserves later work in the receiving copy. Capture then starts an isolated Python process and imports the received application's own modules, checking their exact source identities and every selected case, run, report, source, plan and comparison against the frozen selection. This does not recalculate an analysis or create another campaign.

Preserve the actual application edition, input files, archive, receiving paths, progress JSON and its sibling selection file when continuing an accepted operation. Rerun the same capture command after interruption. A missing completed archive or receiving directory must be recovered at its original path instead of replaced by a new operation. The original opener command remains usable without `--expected-selection`; supplying the frozen selection, as above, additionally compares the complete original records and bytes. The progress JSON and sibling cold-opening record retain the actual archive and native identities.

## Original numerical course

`run_compound_native.py` retains the executed derived-input definition from the original receiving course. It requires the exact authored case and its saved original calibration, 512-draw ensemble and monitoring records. Each compound row preserves its original component records, positive weights, N basis, error-scale rule and fit/holdout role. Explicit interval endpoints remain separate from point errors.

The completed RIVER results above already supply this course. When starting a separate original-source computation on the qualified native runtime:

```sh
python -B "$STUDY/run_compound_native.py" --application "$APP" --workspace "$WS" --output "$OUT/native-course"
```

Its retained journal binds the actual original inputs and producer hashes. Continue accepted numerical work with its original application edition; use the separate presentation-refresh operation to adopt a newer report renderer afterward.

## Inspect the outgoing product

Open and use the actual outgoing HTML at desktop and 390 px widths. Exercise budget selection, catchment search, sampling rounds, Chemistry analysis and uncertainty selectors, every supplied report and the actual download links. Open every PDF page and original CSV/JSON/source/archive attachment normally; reopen the delivered working application and retained science. View the real rendered screenshots, not only capture them. Repair a concrete problem in its original source and inspect that affected result.

The original RIVER producer operated and viewed these controls and files and independently reopened its delivered application. A new outgoing edition needs the same direct attention to its changed result. Use actual original screenshots through an available image viewer when the current source seat's local renderer is unavailable. Keep implementation and the active regional native course advancing.

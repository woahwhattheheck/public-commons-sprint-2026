# Linked crash-cohort example

[Download the complete demonstration ZIP](./KEA_Linked_Crash_Cohort_Public_Example.zip?raw=true) — 809,906 bytes, 43 files. Extract the ZIP, then follow the opening instructions below. The archive includes the full application, its editable example and original source files.

SHA-256: `8b0c951fe3985b1a0da2a984c4b2ef64a85753f6acc001fb1edfc07fd7a3a4d6`.

This complete public example uses the original NHTSA FARS 2020 District of Columbia exports: 34 crashes, 50 vehicles and 83 people. It includes the original files, saved source mapping, two reviewed cohort editions, complete descriptive outputs and an editable project.

## Open the workspace

Open **software/Study_Data_Desk.html** in a current desktop browser. Select **Linked crash cohorts**, then **Open original FARS example**. The example opens its three original source files and two saved reviewed cohorts.

For a local browser address, run `node software/serve.mjs 8708` from this directory, then open http://127.0.0.1:8708/. The server uses Node's standard library.

1. Open the original person table and search for `table-3:17`. Its unknown injury code remains visible in the source and denominator review.
2. Select `crash-cohort-1` to inspect the complete 34/50/83 cohort and its independent crash, vehicle and person results.
3. Select `crash-cohort-2` to inspect the pedestrian/bicyclist-involved cohort: 11 crashes, 15 vehicles and 30 people. Every included person and vehicle remains linked to its original crash.
4. Open the saved analysis, its source definitions and named review. Download a complete summary, original-row export or frozen handover.
5. Receive `frozen/crash-handover-2.json` in the **Receive and recompute a complete handover** panel. The receiver reopens the original files and recomputes the saved cohorts and descriptive outputs.
6. Use the top-level project restore control with `editable/study-project.json` to continue the exact editable project. Save a new cohort or plan edition; earlier reviewed handovers remain available.

Browser edits stay in that browser profile. Download the complete project when transferring your work to another browser.

## Included files

| Path | Contents |
| --- | --- |
| software/Study_Data_Desk.html | Complete standalone industrial workspace with the original linked example embedded. |
| editable/study-project.json | Complete saved project at its original fourteen-command edition. |
| frozen/ | Original reviewed handovers and full descriptive reports. |
| exports/ | Complete summary and crash, vehicle and person exports for both saved analyses. |
| software/example/crash/ | All three original source files, source/hash manifest and reproducible original commands. |
| software/ | Complete application source and local standard-library server. |
| WORKSHARE.md | Proposed ten-business-day, USD 4,800 analyst workshare. |
| MANIFEST.json | Complete package inventory with original file sizes and SHA-256 values. |

The original source is a fatal-crash extract. Its descriptive counts use the selected crash, vehicle and person populations; there is no traffic-exposure denominator in these inputs. NHTSA's original source URLs and year-specific definitions are retained in the manifest and operating guide.

The separate **Source analysis** and **Observed scenarios** views use the same editable project model. This demonstration contains the linked FARS study.

See software/CRASH_COHORT_WORKSPACE.md for full mapping, unknown-code, cohort, review, history and receiving instructions.

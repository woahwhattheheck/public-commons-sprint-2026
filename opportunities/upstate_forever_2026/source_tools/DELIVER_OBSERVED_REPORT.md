# Deliver a complete observed report offline

The delivery producer turns one completed native observed-report directory into a self-contained reader, the exact scientific PDF, and a complete original-file ZIP. It does not calculate new science or change a source edition. It uses Python's standard library.

```sh
python source_tools/deliver_observed_report.py \
  --report /absolute/completed-report \
  --output /absolute/new-delivery \
  --stem Upper_Savannah_217
```

The input is the maintained report directory containing `operation.json`. Every file named by that operation is read through its normalized relative path and checked against its original byte length and SHA-256 before packaging. The HTML, PDF, structured report, source tables, figures, source code and selection remain exact downloadable originals.

## Recipient workflow

Open `Upper_Savannah_217_Offline_Reader.html` in a browser. The original scientific report and figures are immediately visible. Use its contents links to move through the study. The toolbar downloads the original PDF, complete ZIP or structured report. Existing report data links now save the exact embedded originals even when only this one HTML file has been transferred.

Expand **Browse original files** to filter the retained sources and save a selected file. An empty search explains how to recover. Original publisher links retain their normal behavior; they are not replaced with local content. In each plot, **Inspect full-size figure** opens the original SVG at a readable size. **Fit width**, **Actual size**, scrolling, closing, and **Download original SVG** work with the same retained figure. Closing returns keyboard focus to the original button.

The complete ZIP preserves all original relative paths, including source licenses. Extract it before opening its original report HTML so its ordinary file links resolve. The standalone reader is an additional portable delivery, not a replacement for the native report or editable scientific Workspace.

## Native project continuity

Use the existing model CLI's `restore` action for a whole scientific Workspace ZIP, then use its returned application and Workspace paths. Keep the application, Workspace, operator state, output report and receiving directory independent. The operator guide remains `operator/README.md` in the received application. With the original model environment active, open a retained project using:

```sh
python -B /received/application/operator/server.py \
  --workspace /received/workspace
```

Use the complete private loopback URL printed by that local process. Preserve its access capability locally. The offline reader itself requires no server, scientific runtime, account or network requests.

## Output and recovery

The producer writes an output manifest with the native operation identity, report version, complete original-file inventory and each delivered output's identity. Existing identical outputs are reused. An existing different file causes an explicit conflict instead of an overwrite. Select a new delivery directory for a changed report edition.

The complete ZIP has deterministic member ordering, timestamps and file modes. The standalone reader carries the ZIP and original member bodies, so its size is larger than the compressed ZIP. No third-party scripts, fonts, remote assets or network fetches are used by the delivery controls. Embedded source code is stored as data and is never executed by the reader.

## Current application direction

Read `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, in the maintained application. The immediate Ecosystem priority is the prepared native simulated case, its actual annual NDR/SDR outputs, editable scenarios and complete working handoff. This delivery tool packages already-completed reports alongside that work; it does not replace or delay native execution. Preserve active owners and the October 13, 2026 10:00 a.m. Eastern / 14:00 UTC cutoff. Carry the existing complete owner brief and rendered-product instruction with the current receiving handoff.

## Production use

Open the exact outgoing reader at desktop and narrow-screen widths. Operate contents links, source filtering, PDF/ZIP/source downloads and the full-size figure controls. Open the downloaded PDF, extract the downloaded ZIP and open its real contents. Reopen the original scientific Workspace with the maintained native receiver. View the actual rendered PDF pages and browser images; repair unreadable, clipped or overflowing output before handoff. Reuse the completed scientific operation and run only checks relevant to these delivery behaviors.

## Original production course

ECO-CLOUD-26A4 first used this producer on the original 217-watershed land-cover and utility report during the October 13, 2026 Ecosystem Sciences sprint. The completed source report contains 217 watershed profiles, 1,736 group balances, 197 original coordinate variants and two scientific figures. Its distribution contains 43 exact original files. Chromium operated PDF, ZIP, CSV and SVG downloads; the downloaded ZIP reopened with every member unchanged. Desktop width was 1,365 pixels and narrow width was 390 pixels. The independent native receiving preserved original project `dc92b8b9-6eda-4362-b12d-3cf2ef6c9007` and both retained field/laboratory plans.

The whole report, original inputs, producer and receiving results are retained in the same Ecosystem Sciences handoff. Presentation corrections to that older received formatter are supplied separately as guarded changes for composition into newer shared source.

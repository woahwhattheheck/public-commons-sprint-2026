# Complete rainfall handover

This adds the whole recipient package to the maintained Rainfall Release Review. It consumes the original captured public result and never starts a data request. It produces a directly usable offline reviewer, report, saved project, every interval and coverage CSV, original raw responses and acquisition history, and all runtime/editable source. Internal commercial planning is kept in the original workshare record.

## Build from actual retained captures

Use Node 20 or later from the product source directory:

```sh
node handover.mjs build --before /absolute/release.json --public-sources /absolute/public-source-packet.json --notes /absolute/reviewer-notes.txt --out /absolute/rainfall-handover
```

The output directory must be new. `--public-sources` and `--notes` are optional. Add `--after /absolute/later-release.json` for an actual later release of exactly the same sensor/time selection. The underlying reviewer checks compatibility and computes deltas only for paired valid intervals. Single-release packages contain complete coverage and interval tables.

Open `OPEN_FIRST.html` in the assembled directory, or extract `rainfall-handover.zip` and open that file. `reviewer.html` has the real saved review already loaded through the existing importer. The empty original reviewer stays at `source/index.html`. Save review project preserves the original captures and reviewer notes. Exported HTML and CSV come from the current selection. No service, installation or network request is needed for recipient use.

The ZIP contains the complete deliverable and manifest. The adjacent `BUILD.json` records the ZIP size/hash and original release fingerprints. It is a build receipt, outside the ZIP so the archive does not reference its own hash. File sizes and SHA-256 values in the manifest cover every member except the manifest itself. The package keeps the provided capture and public metadata packet text byte-for-byte as UTF-8; provider raw JSON is also directly accessible. Source includes its own builder and receiving programme so the recipient can reproduce or extend the product.

To verify an independently extracted package:

```sh
node source/handover.mjs verify --dir /absolute/extracted-handover
```

A build reserves a new output directory; it never overwrites an existing recipient package. Interrupted preparation leaves its uniquely named `.building-...` directory for diagnosis. If interruption occurs while moving a reserved output, keep that incomplete directory; repeat into a new output destination. Public capture continuation remains the original `capture.mjs` job, independently of package preparation.

## Operate the exact package before presenting it

Use the producing worker's existing Node, Python and Playwright/Chromium installation. Do not install another service or create another public rainfall query. The output directory below must be new.

```sh
node receive_handover.mjs --dir /absolute/rainfall-handover --out /absolute/rainfall-receiving --playwright /absolute/existing-playwright/index.mjs --chromium /absolute/existing/chromium --python /absolute/existing/python
```

If normal `import("playwright")`, installed Chromium and `python3` work, omit those three optional paths. This is an actual browser course over the selected original package. It opens the empty and invalid-input states; uses the prepared reviewer, sensor/filter/pagination controls and notes; downloads the actual saved project, complete interval CSV and report; clears/removes/reopens; opens the downloaded report and initial guide; independently extracts the ZIP using Python's standard ZIP reader; checks every exact member; then opens the received reviewer in a fresh browser context and saves its original project again. It records real timestamps, browser errors, download identities and desktop/narrow PNGs. A failure retains its actual output and the failing step.

**The producing worker must open and personally look at all ten returned PNGs, the exact outgoing report and reviewer, and the actual downloaded/reopened files.** Operate any state requiring a closer look and patch concrete layout, readability, source or control problems. Do not treat a completed script, source review, HTTP result or another agent's approval as having viewed the product. The script's `receiving.json` deliberately leaves personal visual inspection to the producer. Save the corrected final deliverable and actual images through the existing handoff operation, and return ordinary accessible file IDs so another reviewer can see the same output.

All current instructions in the repository's original `AGENTS.md` remain applicable to the producing worker, including exact final artifacts, desktop/narrow usability, errors, downloads, cold reopening and complete attachment inspection. Keep the neutral industrial appearance and readable disabled controls. The original company sender, public query and shared queue remain authoritative; a favorable human reply requires Bryce's direct involvement for further sends.

## Original public selection

The retained 2026-10-13 public source packet confirms historic15 gauge availability through 2026-08-31T23:45:00-04:00. The selected original window is 2026-07-13T00:00:00Z to 2026-07-14T00:00:00Z, using active `properties.web_id` values `1` (PWSA Observatory Hill) and `2` (Alcosan). GeoJSON feature IDs differ from API query IDs. Capture continues the original POST and provider job URL; the package consumes its completed response. The packet records its observed source and any HTTP metadata actually exposed by its acquisition route.

Observed totals represent available valid readings. Missing values are not filled. Capture records the publisher's inch units; generic imported millimetre captures are converted by the original review engine. Nothing in this rainfall package changes the Ecosystem model inputs or claims a pollutant load at a utility intake.

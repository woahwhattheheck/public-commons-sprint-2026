# Boston geographic customer commissioning

This operating program takes the original Boston collection and service report through the installed GIS browser, an editable GeoPackage, reviewed dispatch, a second browser receiving desk, the installed CLI, and the merchant client. It saves the full operating workspaces and usable dispatch files.

The input is the completed original Boston collection/reporting operation in `operations/open311-boston-8e5f-20261012/`. Its four source files contain the original 84 created cases, 21 updated cases, empty updated window, and combined 104-case report. The geographic program imports every original byte and uses the original case identities and coordinates. Its three analyst assignments are explicitly labelled internal commissioning work.

## Operating sequence

1. Import all four complete original files through the geographic browser and retain their source history. Create a 104-case collection handoff and a separate 104-case handoff from the selected service report.
2. Read the map and both case pages, find a real case by its original identifier, and open its original source status note.
3. Download the complete GeoPackage. Use native SQLite to assign three actual source rows in the editable analyst fields.
4. Receive the edited package through the browser. Accept one proposal, reject one, reload the desk, and finish the remaining review. The saved decision history and pending reviewer choice survive reopening.
5. Select the two accepted dispatch cases across the 100-row page boundary. Save the destination column mapping and download complete GeoPackage, GeoJSON, CSV, JSON and HTML dispatch files.
6. Download the editable workspace. Receive it into a second initialized browser desk. Interrupt the HTTP response after the real server commit, then reload and recover the same saved operation. Continue the received handoff.
7. Close the browser and native desks, reopen the saved SQLite workspace independently, and receive the resulting complete file again through the installed CLI.
8. Open the original configured merchant integration, page all 104 cases in groups of 17, download the complete workspace and mapped dispatch file, and recover the original receiving operation.

The receiving operations keep a compact incoming-file descriptor alongside the original records and source files. The saved handover sizes show the actual change across each receiving hop.

## Direct use with a completed original Boston operation

Run with the existing Node 24 runtime and installed Playwright/Chromium. Supply a private JSON configuration with absolute paths:

```json
{
  "gisProduct": "/absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis",
  "collectionOutput": "/absolute/boston/delivery",
  "reportingOutput": "/absolute/boston/delivery/reporting",
  "output": "/absolute/new-private-geographic-delivery",
  "playwrightModule": "/absolute/node_modules/playwright/index.js",
  "chromiumExecutablePath": "/absolute/chromium",
  "edition": "3cb7d7ab61321c1ca4d73dfc2d52a8661a6d910f"
}
```

```sh
node operations/open311-gis-8e5f-20261012/commission-gis.mjs /absolute/private-gis-job.json
```

The four expected input paths are `created-collection.json`, `updated-collection.json`, `empty-updated-collection.json`, and `reporting/combined-observed-report-package.json`. If the complete reporting package has more than one report with 104 rows, select the original combined report with `reportId`. The program uses an empty private output directory.

The source directory must include the complete GIS distribution selection and the merchant integration's original host-file, retained-file, configuration and quota dependencies.

## Continue the existing whole-command receiver

The existing `open311-boston-8e5f-20261012/run_native.py` bootstrap already supports a second complete operating phase through its `reporting` command. Use that continuation to run the geographic operation after the original Boston collection and reporting program finishes. Each phase retains its own result and output, and the existing receiver returns one complete ZIP.

The continuation packet has this shape:

```json
{
  "op": "reporting",
  "requestId": "boston-geographic-8e5f-20261012-01",
  "files": [
    {
      "path": "stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/index.mjs",
      "content": "...complete original file body...",
      "bytes": 1062,
      "sha256": "...the complete file SHA-256...",
      "gitBlob": "e2afbe86e7d2690b39411160101a251c996e58fb"
    }
  ],
  "runner": "...complete continue-boston.mjs body...",
  "options": {
    "gisEdition": "3cb7d7ab61321c1ca4d73dfc2d52a8661a6d910f"
  }
}
```

Include every GIS product leaf, both operating modules and any missing original host dependencies in `files`. The illustration above shows the shape of one entry; the actual receiving packet contains the complete selected source closure. The maintained receiver's `--reporting-packet` accepts the retained packet, with `--reporting-git-blob` selecting its exact original Git identity. The whole-command launcher supports the corresponding reporting source input.

`continue-boston.mjs` resolves the GIS module from the second phase's source directory and opens the completed original Boston outputs from the first phase. It uses the existing phase timeout and the same archive return. Full source manifests, operating results and complete files stay in that archive.

## Delivered files

The private output contains the four complete original inputs; original and edited GeoPackages; five destination dispatch formats; the complete sender, receiving, reopened, CLI and merchant workspace JSON files; the independently saved SQLite workspace directories; the merchant host configuration; six browser screenshots; and `journey.json`.

`OPEN311_GIS_PHASE` reports a completed actual operating step. `OPEN311_GIS_COMPLETE` reports the final state and output directory. The program exits nonzero on a failed operation and keeps the available work and original error in the same private output.

The source is paired with the GIS product merged in public PR2453 and standalone PR404. Run results belong to the executing host and are saved with the actual source edition in `journey.json`.

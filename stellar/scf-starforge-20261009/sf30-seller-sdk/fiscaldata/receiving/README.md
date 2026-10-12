# Fiscal Data public receiving

This runner carries the complete published Treasury source workflow onto an existing Linux operator host. It acquires the exact public application revision, creates its own fresh workspace, reads the Treasury endpoints directly, and receives the resulting datasets through the real browser interface.

Application: [PR 1409](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1409), merged revision `0f6899160c46614105dfa9353ec898df37e11a0c`.

The embedded source manifest selects 337 original source, guide, license and installed-map files at that one revision (about 3.9 MB before filesystem allocation). Every downloaded or reused file must match its Git blob. The receiver’s working directory contains only its new operation, public captures, interpretations, native outputs, browser sessions and screenshots. Application source lives in a separate directory.

## Run on the equipped host

Use the host’s existing Node 24, Playwright, Chromium and GNU tar. There is no package installation step in this receiving flow. The publisher/payment adapters retain their existing lazy initialization; this workflow exercises the public source, dataset, comparison, archive and operator interfaces.

Give the entire native operation an estimated 512 MiB of memory plus 128 MiB reserve, and 32 MiB of writable growth plus 64 MiB reserve, in addition to the source files reported by acquisition. An existing native supervisor or serial VM operator owns admission and the one foreground lifetime. Keep those declarations intact when continuing a retained run.

```bash
node receive.mjs \
  --operation fiscaldata-public-7108-20261012 \
  --source /absolute/fiscaldata-public-7108-20261012/source \
  --work /absolute/fiscaldata-public-7108-20261012/run \
  --chromium /absolute/existing/chrome \
  --playwright /absolute/existing/node_modules

```

The Playwright argument may be its containing `node_modules` directory, the installed `playwright` package directory, or its actual module file. The source and work directories must be canonical absolute sibling paths. Select a new work directory for a new receiving operation.

Source acquisition uses four concurrent public raw-file reads, verifies every Git object, and preserves matching existing source files. Use the optional `--acquire-only` flag when the original operator wants to prepare source before admission. Continue the same operation with the unchanged directories and ID when running the complete workflow.

The source pin and public dates are deliberate. This is the acceptance journey for the released October 2026 component. If Treasury revises the original field contract or historical observations, the runner retains the actual response and reports the changed expectation for review.

## Whole workflow

The native model fetches Treasury’s [original metadata catalogue](https://api.fiscaldata.treasury.gov/services/dtg/metadata/) and captures the full-field [Debt to the Penny endpoint](https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny). Two source selections cover October 1–8 and October 2–8, 2026. A page size of two exercises retained pagination and complete-source reconciliation. The native source request carries the date filter and order while preserving every reported field.

The reviewer keeps the record date as the key, treats the source line number as an identifier, and explicitly classifies the original calendar/fiscal fields. The three debt fields retain their original decimal strings with USD and scale 1 annotations. Daily debt is a stock observation; the comparison identifies sums over selected rows separately from the first and last dated observations and their exact change.

The receiving operation builds the two native CSV datasets, executes an actual two-row query, compares the selected intervals, exports both complete archives and reopens the original workspace. The browser then performs an independent field review: exclude a field, save and reopen, include it again, preserve unsaved notes during navigation, build the reviewed edition and query it.

The real comparison interface shows three measure cards, complete rows, the one removed observation, and all original fields for that row. The receiver verifies the dated debt change against the actual newly built comparison, downloads the complete archive through the authenticated HTTP interface, checks its exact bytes and hash, and retains it locally. It inspects the four operator views at 1360 × 940 and 390 × 844, then closes and reopens the same workspace through the actual server.

The host operator should visually inspect the retained screenshots and report the actual rendered behavior. Screenshots remain local to that new receiving workspace.

## Progress and continuation

`operation.json` retains the receiver’s identity, immutable application revision, absolute source/work selection and stage history. It is created before source acquisition or native workspace creation. The model’s creation requests derive from that operation ID and reopen the original captures, reviewed editions, comparison and downloads on continuation.

If a foreground ends, reconcile its original process and result through the host’s existing native controller. Invoke the same command only when that controller has established that the prior lifetime has ended. The receiver checks its saved identity and resumes the same source/workspace. Source acquisition reuses verified files; completed model requests reopen their native records.

The model and HTTP server use the application’s own exclusive workspace lease. The model releases it before the browser opens the server. Browser shutdown closes Chromium and the server before the final operation result is written.

Useful retained outputs:

| File | Purpose |
|---|---|
| `operation.json` | Original receiving identity, stages and final outcome |
| `output/public-source.json` | Exact public source paths, Git blobs, bytes and revision |
| `output/model/progress.json` | Actual catalogue, captures, editions, comparison, query and native downloads |
| `output/browser-result.json` | Actual browser stages, errors, complete HTTP delivery and restart |
| `output/browser-<attempt>/` | Original screenshots for each receiving attempt |
| `output/browser-delivery-<id>.tar.gz` | Complete authenticated dataset-comparison delivery |
| `workspace/` | New retained application workspace and native originals |

A successful command exits zero and records `RECEIVING_COMPLETE`. A failure records its actual code/message and leaves the current source and application state in place. The owning operator can return the stage, original error and affected public-source/file identities so the same receiving operation can continue after a concrete correction.

The published component’s [domain contract](../DOMAIN.md) and [operator guide](../README.md) describe the full original publisher, SF82 release and SF88 buyer workflows. They keep their own configured seller/buyer state and execution ownership.

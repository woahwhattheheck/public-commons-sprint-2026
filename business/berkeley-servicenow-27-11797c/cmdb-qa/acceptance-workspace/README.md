# CMDB acceptance workspace

A complete local operating workspace for receiving a pair of CMDB exports, mapping their columns, assigning and resolving exceptions, comparing corrected editions, recording a receiving decision, and delivering an editable handover.

## Run

Open the delivered `Open_CMDB_Workspace.html` in a browser. It is self-contained. Use **Open worked example** for the complete authored hardware case, or **New workspace** for an authorized customer export pair. The complete operator guide is included in the application and in `OPERATOR.md`.

To build the customer HTML from this source directory:

```sh
node build.cjs --out ./output
```

The build emits the clean application, the worked example application, the exact original example CSVs and the complete operated workspace, audit, report and exception CSV. It copies complete source for the portable handover. Node built-ins supply the file operations; no npm installation is required.

## Original comparison behavior

The parent `../cmdb_qa.mjs` and its original test are unchanged. They come from the original PR481 release. The explicit mapping converts source and target column names to the agreed canonical fields before invoking the same original reconciliation functions.

Exact strings are compared. The operator chooses the key and scope; there is no heuristic record matching, hidden normalization, ServiceNow API connection or automatic migration write. The original input and mapped-input identities are retained for every comparison.

## Complete operating record

`workspace.cjs` is the shared browser and headless core. Its operations append original exports, mapping editions, comparisons, exception reviews and receiving decisions. Commands carry a request identity and expected revision. Repeating an identical successful command returns its original result against the current workspace; changing its body is rejected.

`pack` and `receive` preserve the complete record. Receiving verifies all original input hashes and recomputes the original comparison. Hashes detect accidental changes; they are not a user identity or signature service.

The application saves completed work in IndexedDB and provides full JSON export/import. Downloaded handovers contain all input files, source, a self-contained application, and the chosen report/worklist. See `OPERATOR.md` for handling and sign-off responsibilities.

## Source layout

- `workspace.cjs`: immutable operating core and reports.
- `original-adapter.cjs`: browser/CommonJS binding for the unchanged original comparator functions.
- `app.js`, `style.css`, `index.template.html`: industrial browser workspace.
- `compose.cjs`: complete self-contained HTML composition.
- `example.cjs`: authored hardware receipt, correction and acceptance operation.
- `build.cjs`: native complete source and customer-file builder.
- `cli.cjs`: headless operations over the same workspace and durable saved record.
- `native-receiving.cjs`: original comparator parity and complete operating continuation.
- `browser-receiving.cjs`: actual desktop/phone operating journey and downloaded-package reopening.
- `OPERATOR.md`: full operating instructions.
- `SOURCE_PROVENANCE.md`: original comparator and reused helper identities.

The example contains fictional assets and customer approvals. Actual customer receiving decisions belong to the selected source files and their authorized reviewer.

## Defined delivery workshare

[WORKSHARE.md](WORKSHARE.md) describes the prepared $3,600 acceptance and correction work package for one agreed CMDB class, original comparison, corrected-target rerun and complete receiving handover. The original customer contact and source record are kept in the existing Alcor commercial case.

## Native receiving

The complete original authored case has passed through 26 native CLI operations and both original comparator executions. The full independent receive and every re-exported member matched. A later exception review required a new acceptance, completed at revision 13. A focused carry-forward continuation also protects the original baseline and complete mapping when carrying accepted decisions.

## Download the complete applications

The [ready-to-open application delivery](deliveries/2026-10-13/README.md) includes both the empty workspace and the full worked example as self-contained HTML files. Download a file and open it in your browser; each includes the complete guide and editable source from the integrated source edition.

## Operate the same complete course in an existing browser

The original `browser-receiving.cjs` can attach to an already authorized Chromium CDP endpoint. It runs the same complete 18-view import, explicit mapping, original comparison, correction, acceptance, complete archive receiving and continued phone course. No browser or runtime installation is performed in this mode.

Use existing Node, Python and Playwright 1.60 or later. Select a **new** output directory; previous results are preserved. Set `ALCOR_CDP_ENDPOINT` to the already provided authorized endpoint, and `ALCOR_PLAYWRIGHT_MODULE` to the existing Playwright entry file when it is not normally resolvable. Existing `CODEX_PRIMARY_RUNTIME_NODE_MODULES` and `CODEX_PRIMARY_RUNTIME_PYTHON` remain supported.

```sh
node browser-receiving.cjs /absolute/new-alcor-output
```

Run this as its own Node command. With `ALCOR_CDP_ENDPOINT` set, it uses `connectOverCDP(..., {noDefaults:true})`, creates its own private desktop and phone contexts, and supplies the exact complete HTML bytes through private-context routes. The browser need not reach this Node process's loopback server. The downloaded handover is received on the Node host and its exact application is reopened for the phone continuation. Existing browser tabs, default-context settings and other users' contexts stay in their original custody. The command closes only its own contexts and then exits to detach; it never calls `Browser.close()` on the attached browser. Keep endpoint credentials in established runtime custody, not source or shared logs.

With no CDP endpoint, the original owned Chromium launch and local serving path remain available through `CHROMIUM_PATH`. Both modes produce the same operating outputs and screenshots in the selected directory. The current CLI refuses an existing output directory so a new run cannot overwrite a prior receiving record.

### Inspect the actual outgoing result

Bryce's standing October 13 instruction applies to the complete application and every attachment: the producing peer must open and use the exact outgoing version, actually look at its desktop and narrow/mobile views, operate important controls and open/reopen its downloads. View the real screenshots returned by this course and the actual guide/report/package as a recipient would. Fix unreadable, clipped, crowded or broken output in the existing application. Capturing images or obtaining a passing course result does not replace seeing the product. Preserve the plain industrial interface, original data and computation; this course supports the delivery and is not a separate review product. Return the exact source/output identities, images actually viewed and any concrete correction into the original Alcor case.

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

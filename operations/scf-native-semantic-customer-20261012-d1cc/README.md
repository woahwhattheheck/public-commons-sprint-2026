# Original semantic dataset customer continuation

This directory carries the complete executable continuation of the existing D1CC semantic dataset customer. It uses C271's finalized 32-row SVK delivery and the original Starforge dataset, Python, SQL, report, workbook and workspace receiving engines. Its purpose is to finish that customer's full analytical handoff with the original data and saved identities.

The native receiving product is merged in PR1680, and the dictionary mapping pagination correction is merged in PR1710. The first customer execution stopped during module loading: the selected queue expected `checkOperatorChannel` from the newer SF81 bridge, while the staging directory still contained the older bridge. Its retained result contains zero completed customer stages. The complete source composition then succeeded and its original 86-module MCP entry linked correctly. That same customer completed finalized-room receiving, semantic Python import, complete query exports and the published customer report. Its remaining-1 execution stopped when the continuation incorrectly read the workbook source descriptor through `item.source`; the original API returns each descriptor directly. The current entry fixes that exact interface and continues only the workbook, workspace export and receiving steps.

## Files

| File | Role |
| --- | --- |
| `compose-source.mjs` | Uses the exact original complete distribution selector, Git batch reader and browser dependency resolver to retain a consistent source tree. |
| `check-source-link.mjs` | Links the selected original MCP CLI's static module graph without evaluating application code. This checks the concrete missing-export failure before the customer starts. |
| `remaining-customer.mjs` | Reopens the four completed customer stages through original read interfaces, then finishes workbook and complete workspace receiving. |
| `source-inputs.json` | Records the exact source, predecessor and original delivery identities used by this entry. It contains no credentials or source payload. |

## Original state and source

The project directory is `/workspace/scratch/d1ccf784531e/scf-native-semantic-receiving`. The failed original result stays at `operation/results.json`, and the original database, native MCP workspace, source fingerprints and private environment remain in `operation/`. The first remaining execution and all four completed stages stay in `operation-remaining1/`; its interrupted result is 8,071 bytes with SHA256 `31f0936d55b9a61540c8ef07e2a403fd39ead0b48d0943d6c81efa78ea5ab03d`. The current remaining operation writes its new progress and files to `operation-remaining2/`. It reads the earlier native COMPLETE jobs and hash-bound files without resubmitting imports, SQL, reports or publication.

The source composer selects commit `db3d9cb3d64f2aee6c1e968606bf21eb0e6ef00e` through the original `scf-following-release/source.git` cache. It composes the full base specification and every original source-owned registration through the exact maintained `specification.mjs`, then follows the original transitive browser and module dependencies. The historical 82b6 selector found a Geocodio browser alias whose declaration was added in this later completed source cut; the continuation adopts that complete cut. It does not add a fictitious sibling file or remove the component. The selector's exact source blobs are recorded in `source-inputs.json`; the source-selection body stops before the original builder's package-creation stage. The unchanged specification helper is retained locally with its exact Git blob before import; the final closure also records each original contribution input.

The composer preserves the entire hash-bound retained Python and native MCP components, the four existing shared semantic joins, and authored paths absent from the selected upstream tree. It verifies every retained overlay against the original closure. The resulting `source-complete-db3d/` tree reuses existing identical bytes where possible and writes changed source create-only. Its `source-closure-db3d.json` records every file's bytes, mode, SHA256, Git blob and origin. Existing mismatched files cause an explicit refusal; the previous source and closure remain intact.

This is the original same-filesystem receiving entry. A different host must first receive the original source and data with their identities preserved. A newer source donor can supply only files whose selected blob, mode and size agree; substituting an arbitrary newer bridge or a partial list of imports recreates the original mismatch.

## Execute the existing continuation

Use the already installed Node 24 and Python runtime. The original native operation owner runs the customer command through the maintained foreground capacity carrier with the actual output volumes declared. These commands create no package, installation, payment engine, queue controller or acquisition.

The complete retained source already exists: 3,488 files at `source-complete-db3d/`, with closure SHA256 `717a81061275b594f5ff5993538dd85b3ccb0f1d2fe82926ce981c07de532669`. Reuse that original source. The following source-composition command is retained for receiving/reconstruction when that complete tree is absent:

```sh
node --experimental-vm-modules compose-source.mjs
```

Its final `COMPLETE_SOURCE_COMPOSED` object supplies the actual closure path and SHA256. Preserve that SHA as `CLOSURE_SHA` in the following commands. It is an independently supplied argument; the customer does not accept the current file merely because it can hash it.

The one focused link check has already succeeded for that exact closure, resolving 86 original modules. Its receiving/reconstruction command remains:

```sh
node --experimental-vm-modules check-source-link.mjs \
  /workspace/scratch/d1ccf784531e/scf-native-semantic-receiving/source-closure-db3d.json \
  CLOSURE_SHA
```

A successful response reports `STATIC_COMPONENT_LINKED` and `applicationEvaluated:false`. There is no application process, provider request or SQL job in this step.

Then the original owner creates the one linked remaining foreground operation `SCF-NATIVE-SEMANTIC-RECEIVING-20261012-D1CC-REMAINING-2` and supplies this existing command:

```sh
node remaining-customer.mjs \
  /workspace/scratch/d1ccf784531e/scf-native-semantic-receiving/operation-remaining2 \
  CLOSURE_SHA
```

`SCF_SEMANTIC_PYTHON` must be the original absolute Python executable. The command reads the original private environment locally and inherits the retained Node/Python source binding. Do not put that file or its tokens into logs, Git or handoffs.

Both prior native records, `ec4c1aaf…` and `9c13d65b…`, are dispatched terminal failures. Preserve both. The current driver independently verifies the exact preceding result bytes and completed-stage sequence before opening the original application. Use the maintained linked-remaining lifecycle instead of resuming a terminal result as an undispatched capacity request. The existing working declaration is 512 MiB memory plus 128 MiB reserve and 24 MiB output space plus 8 MiB reserve on the original overlay project; source selection is already complete. Only the current operation owner may initiate or recover the remaining foreground carrier. An explicit handoff transfers that sole mechanical role before a responding peer starts it.

## Complete customer path

The entry retains checkpoints for the full original workflow:

1. Register the finalized SF100 scan room under its saved native acquisition ID. Read original dataset status/history, every dictionary page and all 32 typed rows.
2. Attach the same completed delivery to the original Python analysis workspace, import the typed observations and confirm the original idempotent import result.
3. Use the original saved view and SQL queries. Produce complete JSONL, CSV and SQLite query exports for all original observations and the separate grouping by published zone, product, direction and price/volume units.
4. Run the original report definition, retain the selected publication and download its complete HTML, JSON and CSV archive.
5. Build the original editable workbook with Observations and Unit summary sheets. Preserve decimal price/volume text and both Swedish and UTC timestamps; retain the workbook manifest and complete receiving archive.
6. Review and export the complete original analytical workspace through its existing archive engine, then close the first customer listeners.
7. Receive the saved archive into its new directory and reopen the same workspace, dataset version, alias revision, semantic dictionary, query result, report publication and workbook. Existing receiving readers resolve files from the selected receiving database while retaining original producer provenance. The query and workbook are not rebuilt for this readback.
8. Close owned children and read back the complete original input fingerprint list. Save the actual final status and artifact identities.

Stages 1–4 are already complete. The remaining entry opens their existing `job` records and compares the exact retained results; it does not send those job-start requests again. Previously downloaded files remain at their original paths and are matched to the native result's size and SHA256. The workbook selects the original direct source descriptors by their exact ID and report section, then supplies only `kind`, `id`, `sha256` and optional `section` in its existing strict definition request. Original IDs and requests remain stable across the genuinely remaining checkpoints. Each downloaded file is checked against the original manifest's complete byte count and digest; 64 KiB reads serve full files rather than turning the preview into an export.

## Interpretation and delivery

This source is the original 2026-10-08 UTC SVK edition: 32 observations, seven finalized pages and eleven fields. It is distinct from the separate 31-row October 10 source. The code preserves `sourceFormat: SF100_SCAN`, a null session and the original payment status. Source HTTP responses and local hashes do not establish payment settlement.

The meaningful deliverables are the complete typed query files, published customer report, editable workbook, source-bearing workbook handoff and the complete workspace receiving archive. The result records their actual paths and hashes only after execution. Keep private customer outputs within their approved destination; a source-only Git publication is not permission to relay private payloads elsewhere.

The completed source and actual customer outcome should be joined back to the original Python thread `1791730510.712909`, distribution thread `1791730220.899469`, and the existing SCF application capability sections. Preserve the original owners and selected source versions of other in-flight releases.

# Source tables

Prepare a CSV or TSV resource for the existing Stellar Forge merchant. The same project opens in the browser and the native CLI. It retains the original source text, explicit field mapping, every reviewed edition, complete changes and the original merchant settings.

The workbench produces a native dataset workspace through [onboarding.mjs](dist/onboarding.mjs). Its seller configuration, workspace files, ordered payment choices and ZIP writer are the maintained implementation. The table resource adds a declared field schema and source identity around the complete mapped rows.

## Install and operate the selected product

The committed `source-tables` selection includes the complete native authoring and merchant workflow. Follow [installation, Applications, native merchant operation and customer receiving](../../products/source-tables/OPERATING.md). In the runtime workspace, use **Applications → Source Tables** and keep a fixed local port to reopen browser saves.

## Open the workbench

From an installed source distribution:

```sh
starforge source-tables serve --port 8787
```

Open the printed local URL. Keep the same host and port to reopen browser saves. The listener uses the original [asset server](serve.mjs) and [browser manifest](browser-assets.json). On the maintained developer site, choose **Source tables**, or open `/source-tables.html`.

From the original checkout, the equivalent command is:

```sh
node stellar-forge/developer-site/dist/source-table-cli.mjs serve --port 8787
```

Use Node.js 22.16 or later. The browser needs modules, Web Crypto and IndexedDB. Selected files are read in the browser; the local server serves the declared application assets.

## Prepare the first edition

1. Give the project a recognizable name. Import an existing `stellar-forge.frontdoor-starter.v1` merchant draft if it already contains the intended payment choices and route metadata.
2. Add the complete UTF-8 CSV or TSV. Comma, tab, semicolon and pipe are supported. The proposed delimiter is a suggestion; the selected delimiter, header choice and empty-record choice become part of the mapping.
3. Choose a new resource or bind the source to an existing merchant resource. Each table binds one distinct resource. Set its static route, service name and description.
4. Review every source column. Choose whether to include it, its output name, explicit type, empty-value treatment and optional trimming. Enter units and the meaning of times where relevant.
5. Select record-key columns when the source has a stable unique identifier. Compound keys retain the declared order. A key must exist in every mapped row and be distinct across the full source.
6. Choose **Retain reviewed edition**. Review processes every row, reports source record and line numbers for invalid values, and saves the complete mapped output. Correct field decisions before retaining it.
7. Save in this browser or download the complete project JSON. When every current table has a retained review, export its native merchant workspace ZIP.

Imported native route choices retain their original order and per-choice fields. Shared terms apply to resources using the shared mode. Edit complex payment choices in the original merchant editor, save that draft, then import it here with the same bound resource IDs. The workbench also retains native resources that have no source-table binding.

The source preview shows twenty rows and shortens long cells for display. The review, project, comparison downloads and native resource contain the complete selected data.

## Field meaning

Every newly mapped field starts as text with empty text retained. Types are explicit operator decisions.

| Type | Accepted value and resulting JSON |
| --- | --- |
| Text | Original field text; optional trim is the only transformation. |
| Safe JSON integer | A signed base-ten integer within JavaScript's exact integer range. No leading zeroes except zero itself. The result is a JSON number. |
| Integer text | An optional sign followed by digits, retained as a JSON string. Use this for identifiers, zero padding and integers beyond the exact JSON-number range. |
| Decimal text | An optional sign, one or more digits and an optional decimal fraction. Digits and scale remain a string, including trailing zeroes. |
| True / false | Exactly `true` or `false`, emitted as a JSON boolean. |
| Date text | A real Gregorian date in `YYYY-MM-DD` form, retained as text. |
| Timestamp text | An explicit RFC 3339 date, time and `Z` or numeric UTC offset, retained as written. Seconds run from `00` through `59`. |

Scientific notation, locale-formatted numbers and alternate boolean spellings can remain text until their conversion is deliberately handled by the originating source operation. Date and timestamp choices validate the source text; they do not shift dates or timezones.

| Empty treatment | Result for an empty field after optional trimming |
| --- | --- |
| Empty text | `""` |
| JSON null | `null` |
| Omit field | The property is absent from that row. |
| Required value | Review reports a source-field issue. |

A value such as `NULL`, `N/A`, a dash or a space remains text unless the chosen trim or type explicitly affects it. Units and time-basis notes describe meaning. They do not multiply values, convert currencies or infer timezones. Quoted newlines, escaped quotes, Unicode, a UTF-8 BOM and the original line endings remain recoverable in the retained source edition.

## Update a source and compare editions

Select the existing table and add the next complete source file as an edition. The workbench retains the old source and reviews. Identical bytes reuse the existing source identity. If the source header changes, review the new header and reset the mapping before choosing its fields again.

After retaining the new review, the prior selected review becomes the comparison baseline. Any earlier review from the same table can be selected instead. Reopening a retained review restores its original source and mapping.

When both reviews declare the same ordered record-key fields, the comparison joins their typed keys and reports additions, removals and changed rows. Each changed row includes the complete before and after values, changed field names and original source record locations. A textual key `"1"` and numeric key `1` have distinct identities.

When the key declaration changes or keys are absent, comparison uses complete rows as a multiset. Duplicate rows retain their counts. It reports additions and removals with exact row values. The comparison records both declared key lists and whether they changed. Column additions, removals and changes to types, names, units, time meaning, trimming or empty policies are recorded independently.

The screen previews the first twenty-five row changes. **Download complete comparison JSON** and **Download complete comparison CSV** contain every change. CSV puts row data inside quoted JSON cells and uses fixed column names. The JSON is the direct receiving format for typed values and missing properties.

Editing a source selection or mapping makes its selected review stale. A draft project can still be saved. Export requires every table's current source and mapping to match its selected retained review.

## Save and reopen

**Save in this browser** retains the full project, including original source editions and review outputs. Saves use an IndexedDB transaction and an expected revision. If another tab saved the same project first, the new save reports a revision conflict. Open the newer project or use **Save browser copy** to keep the current tab as a separate project.

**Download project JSON** is the portable editable copy. Open it on another machine, in a new browser, or through the native CLI. The complete source hashes and all retained outputs are recomputed when the project reopens. An unfinished mapping remains editable while its retained reviews remain reproducible.

Browser storage has the browser's capacity and retention rules. Download the complete project alongside a delivered native workspace.

## What the native ZIP contains

The original generator creates the parent `seller.json`, `workspace.json`, `data/`, `starter-input.json`, installation guide and native command instructions. Additional authoring material is kept under `source-tables/`.

| File or directory | Purpose |
| --- | --- |
| `project.json` | Complete portable authoring project and current original merchant draft. |
| `sources/<table>/<edition>.txt` | Every exact UTF-8 source edition, including BOM and line endings. |
| `reviews/<table>/<review>/output.json` | Complete mapped resource for that review. |
| `reviews/<table>/<review>/mapping.json` | Exact saved mapping decisions. |
| `reviews/<table>/<review>/review.json` | Review identity, complete source-record locations and output summary. |
| `comparisons/` | Selected baseline comparison, full JSON and CSV. |
| `materials.json` | Source and review paths, byte lengths and SHA-256 identities. |
| `files.json` | Byte length and SHA-256 for every preceding native and authoring file; this file excludes itself. |
| `OPERATING.md` | Native receiving, reopening and source-update instructions. |

Each native `data/<resource>.json` is the complete reviewed resource:

```json
{
  "schema": "stellar-forge.tabular-resource.v1",
  "source": {
    "editionId": "e-...",
    "filename": "source.csv",
    "sha256": "...",
    "bytes": 123
  },
  "fields": [
    {
      "name": "account_id",
      "sourceName": "Account ID",
      "sourceIndex": 0,
      "type": "integer-text",
      "empty": "error",
      "trim": false,
      "unit": "",
      "timeBasis": ""
    }
  ],
  "keyFields": ["account_id"],
  "rows": [{"account_id": "000123"}]
}
```

The buyer receives that declared resource object. Native installation and payment operation follow the parent README generated by the original merchant implementation. Its dataset response is a startup snapshot; use the maintained release/change operation when replacing a serving source.

## Native CLI

All saves use a new output path and exclusive file creation. The command returns JSON with absolute saved paths, byte lengths and source/review IDs. Use `show` to retrieve the real document and review IDs for subsequent commands.

```sh
starforge source-tables inspect --source /data/accounts.csv --delimiter comma
starforge source-tables init --source /data/accounts.csv --name Accounts --out /work/accounts-01.json
starforge source-tables show --project /work/accounts-01.json

starforge source-tables mapping --project /work/accounts-01.json --document TABLE_ID --out /work/mapping.json
# Edit the complete mapping: include/name/type/empty/trim/unit/timeBasis and keyColumns.
starforge source-tables map --project /work/accounts-01.json --document TABLE_ID --mapping /work/mapping.json --out /work/accounts-02.json
starforge source-tables review --project /work/accounts-02.json --document TABLE_ID --out /work/accounts-03.json
starforge source-tables export --project /work/accounts-03.json --out /work/accounts-native.zip

starforge source-tables edition --project /work/accounts-03.json --document TABLE_ID --source /data/accounts-new.csv --out /work/accounts-04.json
starforge source-tables review --project /work/accounts-04.json --document TABLE_ID --out /work/accounts-05.json
starforge source-tables compare --project /work/accounts-05.json --document TABLE_ID --baseline REVIEW_ID --out /work/accounts-changes.json
```

Use `init --merchant /path/starter-input.json --resource RESOURCE_ID` to bind an existing native resource. Use `add` for additional tables. `reset-mapping` accepts `--delimiter`, `--no-header` and `--skip-empty` for a changed source header. `compare --csv` writes the complete comparison CSV. Run `starforge source-tables help` for all commands. The same arguments work after `node stellar-forge/developer-site/dist/source-table-cli.mjs`.

## Typed programming interface

The distribution contribution exports `./source-tables` with its adjacent TypeScript declarations. In a source checkout:

```js
import {
  createProject, addDocument, replaceMapping, freezeReview,
  importProject, createTableArchive
} from './stellar-forge/developer-site/dist/source-table-workspace.mjs';

let { project, documentId } = await addDocument(
  createProject({ name: 'Account ledger', starter: originalMerchantDraft }),
  { filename: originalFilename, sourceText: originalUtf8Text, delimiter: ',' }
);

const mapping = structuredClone(project.documents[0].mapping);
mapping.columns[0].type = 'integer-text';
mapping.columns[0].empty = 'error';
mapping.keyColumns = [0];
project = replaceMapping(project, documentId, mapping);
({ project } = await freezeReview(project, documentId));

const reopened = await importProject(JSON.stringify(project));
const { workspace, bytes } = await createTableArchive(reopened);
// workspace.files includes all original native files and complete authoring material.
// bytes comes from the unchanged original zipWorkspace writer.
```

Project-changing functions return a new project. Source-edition and review IDs derive from complete source bytes and mapping/output identities. Use `addEdition`, `freezeReview` and `compareReviews` for source updates. `normalizeTable` exposes the complete conversion result before review. `SourceTableError` provides a stable code and source-field issues where applicable.

## Existing SF49 commissioning

The complete exported directory is source material for the current case owner's original commissioning operation. The existing `openSourceEditionDelivery` bridge receives the retained handoff and terms through `resolveInputs`, runs the native operation, and attaches the resulting source bundle through the original request-aware case revision operation.

Keep full source bodies in that retained bundle, with their paths, byte lengths and SHA-256 identities. The original `source-bundle-reference.v1` descriptor keeps compact bundle and file references in the case. Use the original case ID, revision, request ID, operation ID, actor, handoff and terms. Reconcile an already-committed request before a stale revision response. The receiving result stays with that original workorder.

The source-table ZIP and project supply the editable source and normalization decisions for that workflow. Its native case writer, bundle admission, commissioning revision and original generator remain the current maintained operation. See the maintained [SF49 commissioning guide](../../stellar/scf_2026/sf49_data_commissioning/SOURCE_EDITION_COMMISSIONING.md) in a complete source selection.

## Capacity and source integration

| Scope | Current limit |
| --- | --- |
| One UTF-8 source edition | 16 MiB |
| Source records | 100,000 data records |
| Source columns | 512 |
| Table documents | 64 |
| Portable project JSON | 128 MiB |
| Complete mapped native data resource | Original generator limit, currently 1 MiB |
| Native merchant resources and payment choices | Original generator limits, currently 64 resources and 16 choices per resource |

The table-authoring limits apply before native export. The original SF49 retained-bundle admission has its own current capacity. A larger source can use the maintained database or dataset workflow; export never silently cuts off rows to fit a native resource.

The source-owned registration is [source-tables.json](../../stellar/scf-starforge-20261009/distribution/contributions/source-tables.json). It declares the native command, typed interface, complete guide and original browser server/manifest pair. The static page, its three browser dependencies and this operating guide are registered in the existing asset manifest. The same-source front door links to `/source-tables.html`; the current site publisher can publish the merged source on its existing project.

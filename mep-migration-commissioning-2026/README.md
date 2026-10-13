# Customer and job migration commissioning

A complete offline workspace for preserving original customer, site and job exports, reviewing explicit mappings and row decisions, freezing target handovers, and reconciling actual receiving results. Open **[index.html](index.html)** for the complete file desk or **[mep-migration.html](mep-migration.html)** for the application.

**Needs expert review:** the receiving operator approves identity merges, status translations, relationship mapping, target fields and actual acceptance. This project preserves those decisions and their original source.

## Whole operating flow

1. Create a programme for one operator and identify its receiving system.
2. Retain exact CSV or JSON originals for customers, sites and jobs. Source editions preserve BOM, line endings, complete original text and hashes.
3. Save explicit field, type, value, source-key and relationship mappings. Public vendor marketing does not supply an import schema.
4. Review every row and explicitly create, update, link or exclude it. A reason accompanies exclusions and changed identity decisions.
5. Freeze the reviewed target CSV, JSON and readable handover. Accepted related native IDs can populate configured foreign-key fields.
6. Retain the actual target-result original and record accepted, rejected or unknown outcomes against exact delivered rows.
7. Keep corrected source editions and previous outcomes, reconcile current-revision acceptance, then export/reopen the entire editable workspace.

The standalone browser application makes no network requests and stores working changes in memory. Export working JSON before closing. Original files and the complete workspace remain available through explicit downloads.

## Included complete programme

The included operation contains six programmes, 20 source editions and 54 original data rows, 42 staged records, 20 immutable target handovers and 39 original source/result files. It reaches revision 124. The worked outcomes contain 31 accepted, five rejected and six unknown staged records; these are explicitly fictional results, not production vendor imports.

- [Editable whole programme](examples/worked-migration.json)
- [Complete walkthrough](examples/walkthrough.json)
- [Action](examples/reports/action.html), [United](examples/reports/united.html), [Dixie](examples/reports/dixie.html), [Medina](examples/reports/medina.html), [Dale](examples/reports/dale.html), [Whatley](examples/reports/whatley.html)
- All 39 original files in `examples/originals/`
- All 60 exact CSV/JSON/HTML handover files in `examples/handovers/`
- Full source/size/hash register in `manifest.json`

The example retains an excluded duplicate, customer/site/job reference chains, explicit status translations, exact decimal strings, original rejection and accepted correction, a correction still awaiting a result, and unknown outcomes. Every demonstration customer, address, job, export header and native ID is a selected fictional input. The public company information supplies workflow context only.

## Run and rebuild

Open `mep-migration.html` directly in a modern browser. The file embeds the complete core, examples, public catalogue and interface. It needs no server, credentials, dependency download or backend.

To regenerate the standalone application, complete worked programme, every original, every handover and all six reports from the source, use Node.js 20 or later:

```sh
node build.mjs --output /absolute/path/to/new-migration-output
```

The output directory must not already exist. The builder preserves source files and writes a separate complete operating edition. `mep-migration-build.cjs` exposes the same pure `createFiles` operation for another JavaScript host. The supplied generated standalone is byte-identical to that compiler output.

## Exact source and mapping behaviour

Original browser intake reads exact ArrayBuffer bytes, decodes UTF-8 with fatal errors and BOM preservation, and compares the full re-encoded bytes before acceptance. CSV mapping uses trimmed, unique headers while retaining the original headers and full source bytes. Quoted newlines and CRLF are preserved. JSON intake selects an explicit object path to a flat array. Its lossless reader keeps every numeric token as an exact string, including identifiers larger than a safe JavaScript integer and long decimals. Exponent-to-decimal transformations require explicit translations. It rejects duplicate JSON object keys instead of discarding a value.

Dates and datetimes are explicit; datetime values require a timezone. Decimal/integer mapped amounts remain strings. No monetary calculation, accounting posting, automatic name merge or target API request is performed.

Reviews bind the workspace revision, source and mapping. Exact repeated commits return their original saved edition. A subsequent correction preserves the old source, record revision, frozen handover and target result. A partial result on an older delivery retains its full historical snapshot without replacing a newer explicitly observed correction for untouched records. Acceptance totals distinguish an older accepted revision from the current record.

Source files are limited to 8 MiB and 10,000 rows each; the complete editable handover is limited to 64 MiB. The original source and history are carried together. The byte hash detects changes to the package; it is not an external identity signature.

## Source context

[MEPflow](https://www.mepflow.app/) publicly describes existing office/field functions, assistance importing customer/job data, and export on exit. Its current public page does not define machine import headers or a target acceptance API. This reusable commissioning workspace uses explicit receiving configuration.

The six public company workflows are listed in [source-catalogue.json](source-catalogue.json) and the current [source-refresh.json](source-refresh.json). They preserve Whatley’s published Jobber routes, United’s optional inquiry address, Dixie’s unresolved legal suffix, manufacturer-specific generator maintenance and the separation of estimate, approved work and job completion. Production customer exports, receiving schema and final decisions come from the authorized operator.

## Source layout

| File | Purpose |
| --- | --- |
| `mep-migration-core.cjs` | Pure browser/CommonJS state, source parsing, mapping, reviews and receiving |
| `mep-migration-examples.cjs` | Complete synchronous/asynchronous six-company programme |
| `mep-migration-ui.js` | Eight-section operator interface |
| `mep-migration.template.html` | Neutral industrial standalone shell |
| `mep-migration-build.cjs` / `build.mjs` | Complete deterministic source-to-files compiler and Node entry |
| `API.md` | Complete command and review contract |
| `GUIDE.md` | End-to-end operator instructions |
| `RECEIVING.md` / `AGENTS.md` | Actual receiving and owner-directed rendered-product instruction |

## Delivery and operating status

The actual core and UI handlers have operated the complete source programme, corrected file-selection and programme-selection paths, exported the real report/CSV/JSON files, and reopened the full 670,471-byte workspace byte-identically. The producing source operation is separate from actual graphical-browser inspection. The exact standalone, populated example, all reports and all attachments belong in the existing admitted browser course; producing peers must look at its actual screens or screenshots and fix any material defects. Read the full standing instruction in `AGENTS.md`.

Keep confidential production exports and target results in their authorized receiving workspace. This public source contains public workflow facts and fictional demonstrations. The MIT license covers the software; cited companies retain their own site content, names and marks.

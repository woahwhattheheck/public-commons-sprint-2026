# Intrinio fundamentals and filing review

This application turns complete retained Intrinio responses into an operator workspace for exact financial facts, filing context, named review, comparison and customer extracts. It uses the existing [SF30 Python workspace](../python/workspace/README.md) for immutable source revisions, private storage, asynchronous previews, release history and portable export/import. There is no additional database, service or recovery format.

The source acquisition entry point is the original `acquisition.py` supplied beside this application. It uses the maintained Intrinio Python SDK and emits `workspace.json` with schema `tj.intrinio-fundamentals-workspace.v1`. Acquisition credentials and provider operations stay there. Reviewing or reopening a captured edition does not make a provider request.

## Open the application

Use the maintained Stellar Forge installation with its existing runtime dependencies, Node 22.13 or newer and Python 3.11 or newer. Run these commands inside this installed source directory:

```sh
node cli.mjs create --workspace /private/intrinio-review --label "Fundamentals review"
node cli.mjs serve --workspace /private/intrinio-review
```

Open the private `operatorUrl` printed by the second command. It carries the original workspace token in its URL fragment. The page uses only local static assets and the original loopback server. Keep the complete URL private. The header also links to the unchanged native authoring and release interface.

If the selected Python is not the machine's normal interpreter, use `create --python /absolute/path/to/python3`. The choice is saved as an ordinary declaration revision. Native **Refresh source** remains an explicit reload of the selected original declaration and can restore that declaration's interpreter setting.

The shipped `merchant.example.json` contains the original example's **unverified demo payment terms** so it can be used for private native previews. It is not a statement of an Intrinio price or a deployed paid endpoint. Before operating a seller release, use a complete merchant declaration with your actual approved service origin, payment terms and runtime through the original native authoring/release workflow:

```sh
node cli.mjs create --workspace /private/intrinio-production --config /private/merchant.json
```

The declaration's application path must resolve to this installed `application.py` and retain the complete listed function contracts. The review application does not create a wallet, submit a transaction or start a seller automatically.

## Acquire complete original input

The source owner's collector provides two operations:

```sh
python acquisition.py collect --plan /private/acquisition-plan.json --out /private/capture
python acquisition.py import --manifest /private/retained-import.json --out /private/capture
```

Use the collector's maintained acquisition guide and customer-controlled API key for `collect`. Its `import` command works with already retained complete response files without network access. Do not serialize an SDK financial model as though it were the original response: binary floating-point conversion may already have changed numeric tokens. The original raw-body acquisition uses the SDK's supported `_preload_content=False` boundary.

The incoming directory contains `workspace.json`, content-addressed bodies under `captures/<sha256>.json` and the original acquisition ledger. Every source preserves its operation, request path/query, actual capture time, source class, byte count, SHA-256, page bindings and provenance. Company, filing and fundamental identities remain provider identities.

Choose **Sources → Acquisition workspace.json**, then select its response files or complete capture folder. Enter the operator name and choose **Import complete capture**. The application verifies each complete selected file and saves the source document and originals in one original immutable revision. The equivalent CLI operation is:

```sh
node cli.mjs import-capture --workspace /private/intrinio-review \
  --manifest /private/capture/workspace.json --actor "Operator name" \
  --operation intrinio-import-20261012
```

A repeated import of the same exact manifest reopens its existing result. An edition ID already attached to a different source scope is rejected; acquire a new explicit edition ID to retain another observation. Existing editions, review history and original bytes remain intact.

An import is a custody operation. **Inspect original data** is the visible parser operation. A provider documentation example remains labeled as such; a complete sample response is not relabeled as a customer account acquisition. A documentation excerpt is never described as a complete financial statement.

### Original HTTP entities and native limits

The original workspace allows at most 512 source files, 8 MiB per source file and 32 MiB for a source revision. The original worker output is limited to 1 MiB. Those limits are preserved.

For an identity-encoded response, `originalEntity.nativeRetainedPath` must bind the same bytes as the captured JSON. A separately retained compressed HTTP entity is copied into the same source revision when it is selected and fits the limits. If that entity is oversized or deliberately kept separately, supply the explicit custody location in the interface or through `--external-custody LOCATION`. Its path, size, hash, location and operator attribution remain visible in the source document. A portable workspace export cannot include bytes explicitly retained outside it.

An edition's `acquisition.status`, collections, issues, unpromoted originals and partition requirement are preserved. A source set exceeding native limits needs an explicitly named complete partition. The application never clips a body, silently drops a row to make an export succeed or describes an incomplete capture as full coverage.

## Inspect and review facts

Choose a response in **Statement review**, then **Inspect original data**. The original Python worker reads the exact materialized source revision and rechecks its body size and hash.

The view separates:

- Provider company ID, original fundamental ID, statement type and fiscal period.
- Capture time, provider update time, filing/acceptance time and period end.
- Reported tags and their XBRL axis/member dimensions.
- Standardized tags and the separate standardized-dimension endpoint.
- Exact numeric tokens, missing values, null, empty text, false and zero.
- The selected response's coverage and the actual retained request collection.

Search and page controls operate on the complete selected source; the displayed page is not the complete response. **Download complete original JSON** reads and hash-checks the original body. Unusually large individual preview rows produce a visible original output-size outcome; the complete source remains downloadable.

A fact's persistent row ID binds the original body SHA-256 and JSON row pointer. Review decisions additionally bind the original edition and source hash. The application does not identify a company solely by its ticker or combine different statement periods.

Enter a review title, notes and per-fact **Confirmed**, **Question** or **Excluded** decisions. Choose **Save named review**. Before saving, the original worker validates every supplied fact ID against the exact selected source and current review version. The application then uses the original `save(baseRevision, expectedHead)` operation. A concurrent source change produces a visible conflict instead of replacing another operator's work.

Review fields are locked while an original preview or source save is running, so a completed older command cannot mark newly typed text as saved. If another operator changes the review, resolve any retained original request first, then choose **Adopt current saved review** or **Carry local draft onto current review**. Adopt reads the latest source and replaces the editor. Carry reads that same current revision and carries only fields changed against the local draft's saved base; other saved decisions remain. An older draft without a comparison base is explicitly labeled before carrying all of its local fields. Both actions retain the previous draft in **Download local review draft**. Neither writes source until **Save named review** passes the original expected-head and expected-review checks.

Canonical review records retain the source ABI's `accept`, `revisit` and `exclude` dispositions, reviewer, note and creation time. Existing named decisions remain in source history. General review notes, saved extract choices and exact request identities are additive annotations in the same `workspace.json`; they are not another state system.

Unsaved text and selection are retained with the original browser draft helper, scoped separately from the native authoring editor. Browser storage failures are visible. **Download local draft** preserves the in-memory notes and exact pending request so they are not confused with a completed server save.

## Compare retained observations

Choose the reference and selected responses in **Compare editions**. Reported and standardized families remain separate. Same-period revision comparison checks the original company, statement, type, period dates, request context and coverage.

Different fundamental IDs require a named comparison binding. Enter the reason and reviewer, then choose **Validate and save named binding**. The original worker first checks that the source context permits the selected comparison. The saved binding retains both original fundamental IDs and editions. It does not rewrite either source.

Use **Explicit period comparison** only for an intentional cross-period review. Different fiscal periods are never silently treated as a same-period revision. Select the resulting saved binding before running the comparison when the fundamental IDs differ.

The comparison retains duplicate fact identities as ambiguous groups. Missing rows mean **not observed in the selected retained response**, not provider deletion or zero. Arithmetic uses exact decimal values only where the supplied units and values permit it. Unknown units, null, abstract values and values outside the calculation bound remain visible without an invented delta. Provider signatures and chronology are displayed separately from the arithmetic.

No factor, sign or currency conversion is inferred from tag metadata, and no blanket sum is made across dimensions, parents or already aggregated rows.

## Save a customer extract

Select exact facts across pages, then enter the extract title and delivery notes. The customer-column editor maps named columns to original normalized record JSON pointers, for example:

```json
{
  "Record": "/id",
  "Company": "/company/id",
  "Fundamental": "/fundamental/id",
  "Tag": "/tag/code",
  "ExactValue": "/valueText",
  "Unit": "/unit",
  "SourceSHA256": "/sourceSha256"
}
```

Choose **Save review and freeze selection**. Unsaved review changes are saved first. The original worker validates the exact selected row IDs and current review; the resulting source revision freezes those IDs, the named review, column mapping and source identity.

The **Saved extracts** page exports:

- **JSON:** exact selected values and mapped cells, including an explicit present/missing distinction.
- **CSV:** the complete selected mapped columns. Exact value text is prefixed for spreadsheet preservation; formula-like text is protected. CSV is a presentation export, while JSON and the complete original body retain the authoritative value representation.
- **HTML:** a self-contained offline report with the selected facts, review and source/coverage context.

These are customer projections, separate from the full private operator workspace. They contain the explicitly selected facts and review; the full private response set, acquisition ledger and source history belong in the original portable workspace export. A failed or oversized export retains its actual native status and does not produce a partial successful file.

## Recover, reopen and deliver

Every native preview has the original operation ID, selected source revision, status and output hash. If the browser disconnects, use **Recover original operation**. It reads the saved result or repeats the exact original request identity. It does not replace an interrupted preview with a new hidden execution. A new explicit inspection or export uses a new operation ID.

If the source advanced after an uncertain save, recovery checks the saved domain operation before attempting any write. If the original request did not commit and the expected source head changed, the local draft and newer saved source both remain available. Review the current source explicitly before making another save. **Keep saved state; clear local request** clears only the browser's pending pointer; it does not delete native history or cancel another process.

**History and receiving** opens prior source revisions and original preview results. Historical source is read-only in this interface. The native authoring interface or explicit CLI restore creates a new original revision when a prior source state should become current.

Export and reopen the full operator workspace:

```sh
node cli.mjs export-workspace --workspace /private/intrinio-review \
  --out /private/intrinio-complete.json

node cli.mjs import-workspace --workspace /private/intrinio-restored \
  --bundle /private/intrinio-complete.json

node cli.mjs serve --workspace /private/intrinio-restored
```

The output file and restore directory must be new. Export/import is the unchanged native portable format: every retained revision blob, review, extract source and native preview output travels with its exact hash and history. The original import validates all selected bytes and does not restart old processes, execute a preview or contact the provider. Explicit external original custody remains external and is identified in the manifest.

## CLI and native function contract

Run `node cli.mjs help` for the full command list. `state` returns the original revision and computed response-view IDs, which are distinct from the provider's edition and fundamental IDs.

A review command file uses the exact current values returned by `state`:

```json
{
  "editionId": "RETAINED_RESPONSE_VIEW_ID",
  "expectedReviewRevision": 0,
  "expectedHead": "ORIGINAL_SOURCE_REVISION",
  "operationId": "review-my-selected-source",
  "actor": "Operator name",
  "title": "Review title",
  "notes": "Retained interpretation",
  "decisions": {
    "EXACT_FACT_SHA256_ID": {"status": "confirmed", "note": "Named source observation"}
  }
}
```

`review --command FILE` validates and saves it through the original worker. `select --command FILE` uses the same source/review fields plus `rowIds`, `columns`, title and notes. `bind-comparison --command FILE` uses `leftId`, `rightId`, `mode`, `actor`, `note`, `operationId` and `expectedHead`. `compare --binding ID` selects that explicit binding.

The source owner's three native functions remain available:

| Function | Result |
|---|---|
| `inspect_fundamentals` | Source inventory, or one paged exact statement view when `edition_id` is supplied. |
| `build_fundamentals` | Every normalized record, retained context, coverage and review in one selected original edition. Output is complete or the original worker reports its output limit. |
| `customer_fundamentals` | A complete saved customer projection identified by `projection_id`. |

Narrow native functions support paged inspection/comparison, validation before a source mutation and CSV/HTML export. All use the original worker and limits. `preview --id ID` reads the existing outcome; `output --id ID --out NEW_FILE` downloads its exact saved output. CLI errors preserve the native status and source rather than silently retrying or replacing the workspace.

## Original contracts

This integration is based on Intrinio Python SDK 7.2.0 / API 2.135.4 at [b5918a9123f0ccbe624f559e8ab5a6c8e73c01c6](https://github.com/intrinio/python-sdk/tree/b5918a9123f0ccbe624f559e8ab5a6c8e73c01c6), including the original raw-response and operation signatures.

- [Reported financials](https://docs.intrinio.com/documentation/web_api/get_fundamental_reported_financials_v2)
- [Standardized financials](https://docs.intrinio.com/documentation/web_api/get_fundamental_standardized_financials_v2)
- [Original Intrinio MCP](https://intrinio.com/mcp)
- [Provider terms](https://about.intrinio.com/terms)

The pinned generated financial methods expose no cursor keyword even though the response model can return `next_page`. The acquisition owner preserves that seam through the original ApiClient when supported. The review application consumes the actual retained cursor chain and never invents a generated-method parameter. Use the provider's current rights and account terms for the particular acquired data and customer delivery.

# Retained web-data workspace

An operator application for retaining Diffbot extractions, reviewing article/product/list observations, comparing source editions and delivering selected customer data. It includes the original provider acquisition client, a browser workspace, exact numeric handling, recurring watchlists and a complete portable handoff.

The application uses the existing Python merchant workspace. Saved revisions, preview execution, release staging, merchant publication, customer acquisition and recovery remain their original implementations.

## Use the installed application

Node 22.13 or later and Python 3.10 or later are required. From an installed Starforge distribution:

```sh
npx --no-install starforge diffbot-workspace create \
  --dir /private/web-intelligence \
  --dataset /private/prepared/workspace.json

npx --no-install starforge diffbot-workspace serve \
  --dir /private/web-intelligence --port 8431
```

Open the complete operator URL printed by the command. The included interface reviews source editions, retained objects, article/product/list detail, explicit decisions and variant selection, mapped customer fields, recurring watchlists, history, restoration and completed downloads. Its private draft and uncertain-operation recovery use the original workspace API and draft store.

The command locates the original maintained source from its installed location. An explicit `--source-root ROOT` is supported for an operator-selected source checkout. See [WORKSPACE.md](WORKSPACE.md) for the original native commands, complete handoff paths and portable import.

Without a merchant plan, creation produces a local-preview declaration with explicit unconfigured payment values. A customer deployment uses the customer's original public origin and payment declaration supplied with `--plan PLAN.json`. The customer-only publication procedure below selects the one function intended for the merchant.

## Acquire and retain original provider results

`starforge diffbot-acquire` forwards unchanged arguments to [acquisition.py](acquisition.py). It is a command entry point, not another provider client. The Python implementation uses the standard library and reads an existing token through `--token-env` (default `DIFFBOT_TOKEN`) or `--token-file`; neither the wrapper nor the browser embeds credentials.

```sh
npx --no-install starforge diffbot-acquire --help

npx --no-install starforge diffbot-acquire \
  --store /private/diffbot-transport \
  account --id account-review --days 31

npx --no-install starforge diffbot-acquire \
  --store /private/diffbot-transport \
  estimate --urls /private/selected-urls.txt --account-operation account-review

npx --no-install starforge diffbot-acquire \
  --store /private/diffbot-transport \
  extract --id article-first --url https://customer.example/article --api analyze

npx --no-install starforge diffbot-acquire \
  --store /private/diffbot-transport \
  export --id article-first --out /private/prepared/captures/article-first.json
```

Replace the URL and paths with the reviewed customer source. `account` is an actual account request; `estimate` uses the supplied URL set and retained selected account information. Provider usage is separate from application delivery. The client does not create an account or purchase a plan.

The same client supports `bulk-create`, `bulk-status`, `bulk-download`, `reconcile`, `import` and `reopen`. Bulk creation uses the original form-encoded name/URL/API contract. An existing name is checked before a new submission, and uncertain creation is reconciled by exact job name. It never silently resubmits a request whose outcome is unknown. Full JSON downloads omit the provider's optional record bound; `--url-report` retains the separate original diagnostic CSV.

Private transport custody retains original response bytes and operation history outside the source workspace. The exported safe-capture wrapper records original byte count, SHA-256, capture time and explicit credential redactions while preserving numeric lexemes. A saved public UI result is labelled as UI-result bytes, rather than original HTTP wire bytes. Importing and reopening existing results do not request new data.

The Python executable defaults to `python3`; `DIFFBOT_PYTHON_EXECUTABLE` selects an existing different interpreter for the installed forwarding command.

## Prepared source input

`workspace.json` has schema `tj.diffbot-workspace.v1`:

```json
{
  "schema": "tj.diffbot-workspace.v1",
  "title": "Customer web intelligence",
  "selectedEdition": "edition-id",
  "editions": [],
  "reviews": [],
  "resolutions": [],
  "recurring": {
    "watchlist": [],
    "decisions": [],
    "delivery": {"title": "Reviewed web intelligence", "fields": []}
  },
  "export": {
    "mode": "accepted",
    "columns": {
      "Record": "/id",
      "Type": "/kind",
      "Title": "/fields/title",
      "Source": "/sourceUrl",
      "Decision": "/review/decision"
    }
  }
}
```

This is a schema outline; add an actual edition and captures before creating a workspace. Every edition declares its original ID, label, UTC capture time, exact selected URLs, extractor, selected fields, options and original sources. Source entries carry a local capture path, SHA-256, byte count, format, original request and provenance. All referenced captures are copied into the saved native revision; arbitrary filesystem paths and escaping symlinks are rejected.

Supported original formats are Extract/Analyze JSON, full Bulk data JSON, Bulk status JSON and the separately mapped Bulk URL-report CSV. The explicit safe-capture format carries any of these originals after credential projection. CSV outcome headers and success/failure values must be mapped to the actual captured report. A job's completed status alone does not establish that every selected URL succeeded.

A later source is a new edition. Set its `compareToEdition` to the retained earlier edition when comparing their original contents. Identical selected URL/extractor/field scope is required before a difference is described as a comparable temporal change. A missing observation is reported as not seen; it is not assumed deleted.

## Review and recurring intelligence

The table retains opaque provider identities, source URLs, field values and capture lineage. A `diffbotUri` remains its actual identity. Bulk numeric identifiers retain their original integer text and are scoped to the actual job/collection. An observation without a stable provider ID remains local to its original source edition.

Identical observations deduplicate with complete lineage. Conflicting versions retain all variants and are excluded until an explicit source/version resolution names the original record, edition, source and source index with reviewer, time and reason. No fuzzy entity match is invented.

Review records are append-only. Each names the exact record and edition, decision (`accept`, `ignore` or `revisit`), reviewer, UTC time and note. Recorded order governs the current decision; a future timestamp cannot overrule a later appended correction. Base dataset reviews are followed by recurring decisions, and both consumers use the same exact-edition order. A previous edition's acceptance is not silently carried into a new acquisition.

Export mode `accepted` includes only accepted records. Mode `all` includes unreviewed observations with their review state, while ignored records and unresolved conflicts remain excluded. Customer column mappings use explicit JSON pointers. The supported public review field is `/review/decision`; internal reviewer notes stay in the operator workspace.

Recurring watchlists select exact source URLs, kinds, source/record IDs or text. Enabled watchlists combine by OR; nonempty selectors within one watchlist combine by AND. An empty watchlist selects all observations; a configured list whose entries are all disabled selects none. The [recurring guide](recurring/README.md) describes the complete saved configuration and consumer API.

## Exact numbers and source meaning

Provider JSON is parsed without floating-point conversion. Original numeric tokens retain their exact spelling, including large integers, decimals, negative zero and exponents. Consumer fields represent those numbers as strings, and `number-tokens.json` preserves their source pointers and mapped customer-column relationship. It distinguishes an original JSON number from an original string that looks numeric.

Currency, availability, publication dates, inferred dates and capture times retain their separate meanings. Missing values remain missing. A currency symbol alone is not assigned a currency code. Provider HTML is escaped in customer displays, and spreadsheet-facing CSV protects formula interpretation; the NDJSON reading retains exact values.

The processor validates original UTF-8, declared bytes, SHA-256 and source membership before reading an edition. Duplicate JSON keys and nonfinite numbers are rejected. Original source files remain unchanged when operators adjust review, watch or column configuration.

## Customer delivery and full operator handover

Three native Python entry points share the same saved source:

| Function | Result |
| --- | --- |
| `inspect_dataset` | Complete private source, coverage, object, review and comparison report. |
| `build_dataset` | Complete operator report plus all generated customer/operator files. |
| `customer_dataset` | Selected customer delivery and customer files, without the private report or review-note history. |

Customer files are `customer.ndjson`, `customer.csv`, `customer.html`, `source-index.json`, `number-tokens.json` and `DELIVERY.md`. When recurring source is joined, `recurring-report.json` and `recurring-report.html` contain its accepted customer projection. The complete internal recurring report stays in the operator dataset report.

The original workbench `handoff` verifies the completed native preview and every file's exact digest, then creates two explicit directories. `customer/` contains the customer files and its manifest. `operator/` contains review decisions, the full dataset report, complete original preview and portable source/history/results. Each directory has its own manifest; the aggregate handoff identifies both audiences.

Reopening that portable workspace or repeating the completed handoff retrieves the saved original result. It does not acquire provider data, repeat a purchase or execute another Python preview.

### Publish only the customer function

The existing native declaration is used by both previews and merchant routes. The application therefore uses two saved revisions in the same workspace:

1. Keep the operator revision with all three functions for private inspection and build.
2. Save a derived declaration revision containing only the unchanged `customer_dataset` function definition and the same complete application/captures.
3. Stage and publish that exact retained revision through the original workspace release controls.
4. Restore the operator revision as the editable head. The immutable customer release remains attached to its original saved source.

The published merchant advertises only the customer function. Original SF30/SF82 publication and SF88 customer acquisition/reopen own their normal payment, output and recovery operations. This procedure adds no new payment implementation.

## Source and runtime limits

Every capture must fit the original 8 MiB per-file and 32 MiB source-revision limits. The original native function's serialized output limit is 1 MiB, including file bodies and metadata. The processor measures the complete result and returns an explicit limit error instead of trimming records or reporting a partial build as complete. Customer delivery is measured after its customer-only projection.

The acquisition client's separate response limit is explicit in its command options. It cannot expand the original native workspace or preview limits. Agree source batches and delivery size for the actual customer inputs; there is no blanket record-count promise.

## Original provider contract

The implementation is based on the first-party Extract/Analyze, Product, Bulk and Account contracts and the maintained Python SDK at commit `3e09ab422da189edd890ee11bf7c08a34a0ffedd`. The maintained package is `diffbot`; the old `diffbot-python` package is a separate retired distribution. The structured workflow preserves original JSON rather than relying on the SDK's default Markdown projection.

- [Analyze](https://www.diffbot.com/docs/extract/analyze)
- [Product](https://www.diffbot.com/docs/extract/product)
- [Bulk overview](https://www.diffbot.com/docs/bulk/)
- [Bulk data retrieval](https://www.diffbot.com/docs/bulk/retrieve)
- [Original Python source](https://github.com/diffbot/diffbot-python/tree/3e09ab422da189edd890ee11bf7c08a34a0ffedd)

Actual provider captures, account material, customer URLs, internal commercial scope and receiving results belong to the separately retained customer workspace. The generic package contains the maintained application and operating source.

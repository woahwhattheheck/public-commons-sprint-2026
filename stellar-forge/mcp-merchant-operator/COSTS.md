# Supplier costs through the merchant MCP

Use the merchant's existing pricing workspace to retain supplier documents, review a complete allocation book, save an immutable cost edition, apply an eligible cost proposal to an original pricing review, and receive the resulting files on another operator machine.

This guide covers the MCP and command-line receiving workflow. The [native economics guide](../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/economics/README.md) defines the cost-book fields, monetary allocation, coverage and period rules. [PRICING.md](PRICING.md) covers the original pricing review, scenario and repricing workflow.

## Connect the existing workspace

The host adds optional inputs to the selected entry in its existing pricing connection file. For example, these properties can be added under `workspaces.merchant`:

```json
{
  "costInputs": {
    "supplier-quote": {
      "label": "Supplier's original published quote",
      "path": "/private/merchant/sources/supplier-quote.csv"
    }
  },
  "costBooks": {
    "october-review": {
      "label": "October allocation book",
      "path": "/private/merchant/reviews/october-cost-book.json"
    }
  },
  "supplierUsage": "/private/merchant/context/supplier-usage.json",
  "accountingReport": "/private/merchant/context/native-accounting.json"
}
```

Keep the entry's original `config`, `directory` and observation selection: saved `snapshot`/`history`, or its original loopback `opsUrl`. Relative host paths resolve against that connection file's directory. Each input map accepts at most 64 aliases. An alias selects one host-declared file; the MCP caller supplies that alias.

Host input files must be private regular files, with no group or world permissions on POSIX. Keep operator request JSON private too. Start a working directory with `umask 077`, then save the JSON requests there. The CLI accepts an input file up to 8 MiB, while the complete MCP request still has the existing 128 KiB limit. A large book uses the host-file selection described below.

The commands use the existing authenticated MCP endpoint in `MCP_URL`. The token stays in `MCP_ACCESS_TOKEN`, or another existing environment variable selected by `--token-env NAME`.

```bash
merchant-mcp pricing cost-state --url "$MCP_URL" --workspace merchant
merchant-mcp pricing cost-inputs --url "$MCP_URL" --workspace merchant --kind SOURCE
merchant-mcp pricing cost-list --url "$MCP_URL" --workspace merchant --kind PRICING
```

Choose the original saved pricing review that corresponds to the merchant routes and observation period being allocated. Its `pricingVersion` becomes part of the book. Cost saves use the economics revision; applying costs separately uses the original pricing revision.

## Retain the original source

Inspect the selected alias before importing it:

```bash
merchant-mcp pricing cost-input --url "$MCP_URL" --workspace merchant \
  --kind SOURCE --input-alias supplier-quote
```

The response identifies the alias, label, exact `bytes` and `sha256`. Copy those values into a private request file. Generate one lowercase UUID for this source request and retain it with that file. In the following shape, replace the capitalized placeholders and `expectedBytes` with the actual inspected values:

```json
{
  "workspace": "merchant",
  "input": "supplier-quote",
  "expectedSha256": "COPY_THE_INSPECTED_64_CHARACTER_SHA256",
  "expectedBytes": 1234,
  "requestId": "RETAIN_ONE_GENERATED_LOWERCASE_UUID",
  "metadata": {
    "label": "Supplier's original published quote",
    "name": "supplier-quote.csv",
    "kind": "QUOTE",
    "supplier": "Supplier name",
    "reference": "Original document reference",
    "period": null,
    "note": "Original quote selected for the planning review"
  }
}
```

```bash
merchant-mcp pricing cost-upload --url "$MCP_URL" --input /private/review/source-upload.json
```

The retained source ID is the source request UUID. An original may be up to 16 MiB. The importer checks the inspected byte count and hash again while reading it. Source metadata supports `BILL`, `CREDIT_NOTE`, `QUOTE`, `USAGE`, `ACCOUNTING` and `SUPPORT`; select the kind that describes the original document. The example uses a quote. Metadata requires `label`, original `name` and `kind`; optional fields are supplier, reference, period, note and a credential-free source URL.

A new source version receives a new UUID. An exact retry keeps the original UUID, metadata, byte count and hash. Once committed, that source can be reopened from retained bytes even if its authoring file has moved.

For configured usage or accounting context, save a private `cost-capture` request such as:

```json
{
  "workspace": "merchant",
  "kind": "USAGE",
  "requestId": "RETAIN_ONE_GENERATED_LOWERCASE_UUID",
  "label": "Original supplier usage capture"
}
```

`cost-capture` selects the existing host's `supplierUsage` or `accountingReport` file. It retains those original units and independent accounting groups. Usage counters, quoted revenue, settled atomic amounts and supplier charges keep their native meanings.

## Map and review the complete book

Read the retained source with `cost-source`. For delimited files, choose comma, tab, semicolon or pipe and inspect its headers. Apply explicit column or constant rules through `cost-mapping`; the available fields are reference, supplier, kind, currency, amount, quantity, unit and description. Each rule is either `{"column":"Exact Header","trim":true}`, `{"constant":"USD"}`, or `null`.

For example, a private mapping request has this shape:

```json
{
  "workspace": "merchant",
  "sourceId": "COPY_RETAINED_SOURCE_UUID",
  "delimiter": ",",
  "mapping": {
    "reference": {"column": "Reference"},
    "supplier": {"constant": "Supplier name"},
    "kind": {"constant": "QUOTE"},
    "currency": {"column": "Currency"},
    "amount": {"column": "Amount"},
    "quantity": {"column": "Quantity"},
    "unit": {"column": "Unit"},
    "description": {"column": "Description"}
  },
  "offset": 0,
  "limit": 25
}
```

```bash
merchant-mcp pricing cost-mapping --url "$MCP_URL" --input /private/review/map.json
```

Mapping is a review operation. The next complete book retains the selected original, its mapping and all row dispositions. Keep the generated `sourceUUID:row` identities, and record an explicit reason for an excluded row. Do not replace native source IDs with a supplier reference or spreadsheet row index from another export.

The native book combines the selected pricing version, period, period-alignment explanation, original context IDs, imported/manual lines, allocations and each route's coverage assessment. Use `cost-weights` when allocating by explicit operator weights or the original HTTP-2xx counts; its exact signed allocation and remainder behavior is shared with the browser workspace.

Amounts remain exact six-decimal currency strings. Bill/credit costs and quoted planning costs remain separate, as do currencies and quantity units. Review unassigned money, credit signs, coverage and documented period alignment before preparing a pricing proposal. The native report preserves negative net costs, missing inputs and unsupported currency combinations.

Small complete books can be sent as `book`. An inline book is limited to 96 KiB. Larger books are selected from the host's `costBooks` map, up to 64 MiB:

```bash
merchant-mcp pricing cost-input --url "$MCP_URL" --workspace merchant \
  --kind BOOK --input-alias october-review
```

Use its inspected identity in a preview request:

```json
{
  "workspace": "merchant",
  "bookSource": {
    "input": "october-review",
    "expectedSha256": "COPY_THE_INSPECTED_64_CHARACTER_SHA256",
    "expectedBytes": 1234
  },
  "view": "issues",
  "offset": 0,
  "limit": 25
}
```

```bash
merchant-mcp pricing cost-preview --url "$MCP_URL" --input /private/review/preview.json
```

Choose exactly one of `book` or `bookSource`. Review the full book through the applicable views: routes, routeCosts, units, lines, allocations, issues, groups, coverage, imports, sources, pricingLinks and context. A saved edition retains the complete normalized native book, including content larger than an inline response.

### Follow the returned pages

| Read | Continuation |
| --- | --- |
| `cost-list` | Use its original `nextAfter` value as `after`; stop when it is null. Kinds are SOURCES, PRICING, EDITIONS and EXPORTS. |
| Source, input, mapping, weight, preview, edition, comparison and proposal views | Use `page.nextOffset` as the next `offset`; stop when it is null. |
| Every paged read | Keep the workspace and selected original IDs fixed. The row limit is at most 100; a response can return fewer rows to remain within its byte bound. |

A displayed oversized cell or row is explicitly marked. Its complete original is available in the file handover. Counts and summaries are navigation aids; the native original and complete edition files supply the full content.

## Save, correct and reopen an edition

Read `cost-state` immediately before composing the save. Retain the exact reviewed book and add a stable request UUID plus `expectedRevision` from the economics state. Use `null` only for its empty initial revision.

```json
{
  "workspace": "merchant",
  "requestId": "RETAIN_ONE_GENERATED_LOWERCASE_UUID",
  "expectedRevision": "COPY_CURRENT_ECONOMICS_REVISION_OR_USE_NULL",
  "bookSource": {
    "input": "october-review",
    "expectedSha256": "COPY_THE_REVIEWED_BOOK_SHA256",
    "expectedBytes": 1234
  }
}
```

```bash
merchant-mcp pricing cost-save --url "$MCP_URL" --input /private/review/save.json
merchant-mcp pricing cost-edition --url "$MCP_URL" --workspace merchant \
  --edition "$COST_EDITION" --view lines --offset 0 --limit 25
```

The response returns the native immutable edition identity. Reopen that edition and its complete files. Corrections are another complete book and saved edition with a new request ID and the current revision. Compare the two explicit edition IDs through `cost-compare`, using views changes, routes or groups; the original editions and input periods remain intact.

If another operator saved first, reopen the current state and compose the corrected input against that revision. Preserve an exact request for ambiguous-outcome recovery; changed content is a new request.

## Apply costs to the original pricing workflow

Prepare an explicit proposal for selected routes and either `BILLED` or `QUOTED`:

```json
{
  "workspace": "merchant",
  "edition": "COPY_RETAINED_COST_EDITION_UUID",
  "basis": "QUOTED",
  "routeIds": ["COPY_ORIGINAL_ROUTE_ID"],
  "view": "changes",
  "offset": 0,
  "limit": 25
}
```

```bash
merchant-mcp pricing cost-proposal --url "$MCP_URL" --input /private/review/proposal.json
```

The original proposal hash binds the selected edition, basis and routes. Its eligibility uses documented compatible periods, complete coverage, fully assigned money, eligible USD costs, healthy original observations and positive fulfilled HTTP-2xx counts. Explicit zero cost, negative credits and missing amounts keep their native treatment.

To save an eligible proposal, retain the reviewed edition/basis/routeIds and add `proposalSha256`, a stable `requestId`, the current original `expectedPricingRevision` and a descriptive `label`. Omit the preview-only view/offset/limit fields from this apply request.

```bash
merchant-mcp pricing cost-apply --url "$MCP_URL" --input /private/review/apply.json
```

Success returns `ORIGINAL_PRICING_REVIEW_SAVED`, the original pricing result and its cost link. The saved review carries the complete cost input, report, proposal and source provenance. Continue that review through the existing pricing/scenario/repricing lifecycle in [PRICING.md](PRICING.md). A cost apply saves a pricing review; live atomic payment terms change only through their explicit original pricing/release operation.

## Recover an interrupted request

Keep the original private request files alongside the returned IDs.

| Interrupted operation | Find the original committed result |
| --- | --- |
| Source upload or context capture | `cost-request` with `kind: "SOURCE"` and the original requestId |
| Cost save | `cost-request` with `kind: "EDITION"` and the original requestId |
| Cost export | `cost-request` with `kind: "EXPORT"` and the original requestId |
| Apply to pricing | Inspect the original PRICING history and the edition's pricingLinks. The exact apply request retains its original requestId and expectedPricingRevision. |

A committed source, edition or export is returned with `status: "COMMITTED"` and its retained record. Reopen that record before repeating work. `UNKNOWN` means no committed match is currently visible; it does not establish that an interrupted operation never ran.

An exact source-upload replay uses already-committed bytes even after the host file moved. A saved large book can be reopened by edition without its authoring file. If an uncommitted large-book request must be retried, make its same inspected original available to the configured host alias and preserve the exact selectors. Do not silently select a different file under a retained request ID.

The client preserves request IDs; it does not generate replacements during retries.

## Receive complete originals, editions and backups

`cost-export` accepts one of these native selections:

- `{"workspace":"merchant","kind":"COST_EDITION","edition":"RETAINED_UUID","requestId":"NEW_EXPORT_UUID"}`
- `{"workspace":"merchant","kind":"WORKSPACE_BACKUP","requestId":"NEW_EXPORT_UUID"}`

The backup captures the original closed pricing, repricing, scenario and economics history with the retained source files. It excludes prior export archives and live credentials. An `edition` selector belongs only to COST_EDITION.

First inspect the selected artifact's manifest:

```bash
merchant-mcp pricing cost-manifest --url "$MCP_URL" --workspace merchant \
  --kind edition --id "$COST_EDITION"
```

Then receive it into one private destination, optionally pinning the inspected `manifestFile.sha256`:

```bash
merchant-mcp pricing cost-download --url "$MCP_URL" --workspace merchant \
  --kind edition --id "$COST_EDITION" --out /private/received/cost-edition \
  --manifest-sha256 "$COST_MANIFEST_SHA256"
```

| Kind | Complete received content |
| --- | --- |
| source | Whole original file named `original`, with its source receipt metadata in the handover manifest |
| edition | Eight native edition files plus the exact `edition-manifest.json`; the MCP handover manifest is `manifest.json` |
| export | The original `UUID.tar` selected by its native export request ID, plus the handover manifest |

The retained downloader validates the selected manifest, each chunk, complete byte counts and full file hashes. Repeat the same command and destination to continue an interrupted download. It retains progress in its original download-state directory. Select a different destination when receiving a different artifact. The complete native package limit is 512 MiB; archives stream from the original verified descriptor.

For a direct MCP receiver, use `merchant_pricing_cost_manifest`, then `merchant_pricing_cost_file` with the exact workspace/kind/id/file and inspected manifest digest. Continue with the returned readId, original file digest and nextOffset. Release that temporary read with `merchant_pricing_cost_file_release`. If a temporary read expires, reopen the same immutable selection at the retained offset. Releasing a read preserves the original source and export.

### Restore the pricing and cost workspace

Use the received original backup TAR with the maintained native workspace command:

```bash
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs \
  --config /private/merchant/seller-service.json \
  --snapshot /private/merchant/original-seller-traffic.json \
  --restore-cost-workspace /private/received/cost-backup/EXPORT_UUID.tar \
  --state /private/merchant/restored-pricing-cost \
  --port 8457
```

Use a new private state directory. The original restore verifies the archive and retained files; an interrupted restore can continue with the same archive and destination. An incomplete restore cannot open as a completed workspace. Supply the merchant's original config and selected observation source as required by that workspace.

Reopen its saved pricing review, cost editions, original uploads, scenario plans and links. Point the existing MCP workspace declaration at that received native state when it becomes the selected operator workspace. An external live seller continues through its own retained release and runtime recovery.

## Tool and client surface

The existing `merchant-mcp pricing` CLI exposes the cost operations as `cost-state`, `cost-list`, `cost-inputs`, `cost-input`, `cost-upload`, `cost-capture`, `cost-source`, `cost-mapping`, `cost-weights`, `cost-preview`, `cost-save`, `cost-request`, `cost-edition`, `cost-compare`, `cost-proposal`, `cost-apply`, `cost-export`, `cost-manifest` and `cost-download`.

The first eighteen commands correspond to `merchant_pricing_cost_*` tools. The native file and file_release tools complete the 20-tool MCP surface; cost-download composes those retained file operations. JavaScript consumers use `callMerchantPricing({operation:"cost-…",args,...connection})`, `downloadMerchantCosts(...)` or `inspectMerchantCosts(...)` from [pricing-client.mjs](pricing-client.mjs).

All operations remain in the merchant's existing authenticated pricing connection and native source/cost/pricing models.

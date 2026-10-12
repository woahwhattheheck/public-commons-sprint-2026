# Europe PMC through the original Merchant Research attachment

The Europe PMC family uses the existing Research attachment, saved library, query revisions, source editions, review history and export store. It exposes the complete provider workflow to a Merchant client and retains original downloads through the same content-addressed file API as Research reports.

## Connect and select the existing library

Configure the original Research workspace using its private console URL file and workspace directory. The listener URL carries a session token; keep that file private and outside handovers. Call `merchant_research_attach` for the configured workspace alias, then `merchant_research_europe_pmc_list`. The latter returns the actual `selection.library` alongside saved queries and operations.

Every subsequent Europe PMC action requires that exact `library` value. The adapter creates one original Europe PMC client for the call, selects and verifies its library, and uses that same client for the action. A changed selected library produces `EUROPE_PMC_LIBRARY_CHANGED` before the dependent action. A library-wide operation has no fabricated dossier binding. Receiving an edition into Research still requires the original dossier/question IDs and expected revision in its native input.

## Complete tool family

All names below have the prefix `merchant_research_europe_pmc_`. All calls also take the original configured `workspace` alias.

| Suffix | Required selection/input | Result or behavior |
| --- | --- | --- |
| list | optional library; optional parameters | Actual library selection, saved queries, paginated operations |
| status | library | Current provider/workspace status |
| history | library | Complete saved library event history |
| query | library, queryId | Original query and all its saved versions |
| save_query | library, input | Complete native query request and expected revision |
| prepare | library, input | Original plan for the selected query revision and full limits |
| inspect | library, operationId | Plan SHA, operation/edition state, source and interruption information |
| start | library, operationId, input | Start the original prepared provider operation |
| stop | library, operationId | Cooperative stop of that operation |
| seal | library, operationId, input | Seal the actual captured edition using its expected plan |
| continue | library, operationId, input | Original parent-bound continuation and cursor/source history |
| chain | library, operationId | Original continuation chain |
| records | library, operationId; optional parameters | Native records, current edition-bound reviews and next offset |
| source | library, operationId, index; optional boundary | Original source descriptor with exact body hash/length and provenance |
| import | library, operationId, declared source, input | Receive an original hash-pinned document/HTTP packet |
| review | library, input | Full native decision request or exact saved-request recovery |
| receive | library, operationId, input | Receive the original edition into the selected Research question |
| comparison | library, parameters | Native comparison of explicitly selected editions |
| export_workspace | library, input | Prepare a complete original portable export and retain its request ID |
| restore | library, declared source, input | Original portable restore and library selection |

The `input` object passes the complete original API request without projecting away expected-source fields, actor, request ID or notes. Query/record/comparison `parameters` likewise retain the original pagination/filter fields. The server remains the authority for those native contracts.

A query save uses:

```json
{
  "workspace": "research",
  "library": "original",
  "input": {
    "requestId": "original-query-request",
    "actor": "analyst",
    "expectedRevision": 0,
    "title": "Agreed research question",
    "selection": {
      "query": "THE_ORIGINAL_REVIEWED_QUERY",
      "pageSize": 100,
      "maxPages": 10,
      "synonym": false
    }
  }
}
```

Keep the returned query ID/revision. Prepare with the same original request identity, actor, selected query ID/revision, label and `mode`. Starting the prepared operation is the provider-facing action; this integration does not automatically start or repeat it.

A review uses the original full request:

```json
{
  "workspace": "research",
  "library": "original",
  "input": {
    "requestId": "original-review-request",
    "actor": "analyst",
    "operationId": "epop_ORIGINAL_64_HEX",
    "editionSha256": "ORIGINAL_EDITION_SHA256",
    "recordKey": "MED:37994696",
    "expectedRevision": 0,
    "decision": "include",
    "note": "The original analyst rationale."
  }
}
```

Retain this exact object before sending. After a lost reply, read the original record/history and submit the same request bytes. The native request ledger returns the original saved result. Changing expected revision, source selection or note requires an intentional new request.

## Declared source custody

Use the original Research workspace source configuration:

```json
{
  "sources": {
    "original-pages": {
      "kind": "europe-pmc-packet",
      "file": "/private/original-source-packet.json",
      "sha256": "EXACT_PACKET_SHA256"
    },
    "saved-library": {
      "kind": "europe-pmc-portable",
      "file": "/private/Europe_PMC_Workspace.json.gz",
      "sha256": "EXACT_PORTABLE_SHA256"
    }
  }
}
```

Import selects the declared source name and only the native `expectedPlanSha256`/optional `stopReason`. The packet must identify original `documents` or original HTTP `pages`; it retains their actual source representation. Import cannot override the declared file or digest. Restore selects a portable source and the original request ID/actor. The original client verifies the host file before upload and closes its descriptor afterward. Current source-packet intake is bounded at 48 MiB; portable input and decompressed validation are bounded at 128 MiB.

## Retain complete downloads

Use the original `merchant_research_export` with the exact workspace and library:

| kind | Additional selection | Original bytes |
| --- | --- | --- |
| europe-pmc-edition | operationId | Full JSON source edition |
| europe-pmc-ris | operationId | Native RIS records |
| europe-pmc-csv | operationId | Native CSV records |
| europe-pmc-review | operationId | Full edition-bound review/history JSON |
| europe-pmc-source | operationId, index, optional boundary | Exact raw source body |
| europe-pmc-workspace | export requestId | Complete gzip JSON portable workspace |

An optional `expectedSha256` binds a known original file. Source exports additionally bind the actual descriptor's document ID, body hash and byte length. Operation exports retain plan/edition/query/pagination identity. The generic retainer preserves completed downloads even if a supplied digest disagrees and reports the mismatch with their actual retained identity.

The result is the original immutable export receipt and export ID. Read all bytes with `merchant_research_file_read`, follow its exact offsets/read ID, and finish with `merchant_research_file_release`. A lost export reply is reconciled through paginated `merchant_research_exports` and its snapshot token. Do not regenerate an already-retained artifact merely because its response was lost. Workspace files are gzip JSON portable archives, not ZIP files.

## Executable receiving inside the original customer workflow

The source-native helper is:

`stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/europe-pmc-merchant.mjs`

It exports:

```js
runEuropePmcMerchant({
  url,
  workspaceDirectory,
  runDirectory,
  workspaceId,
  library,
  selected,
  reviewRequest,
  queryId,
  dossierId
})

```

The existing native phase supplies it as the existing workflow's Merchant callback:

```js
merchant: args => runEuropePmcMerchant({
  ...args,
  workspaceDirectory: selection.workspaceDirectory
})

```

`selected.baseline` and `selected.expanded` contain the original operation ID, plan SHA, edition SHA/bytes, query ID/revision, record count and page count. The review request is the exact request already completed by the original browser phase.

The helper attaches to the same listener/workspace; reads list/status/query, both immutable selections, every record page and every original source descriptor; proves the existing review from its original history; and replays that exact saved request. It retains both editions in JSON/RIS/CSV/review form, every raw page, and the complete portable workspace. For the current one-page/three-page customer selection this is 13 complete exports. It validates the portable through the original parser and checks that library history is unchanged.

The helper uses the original Merchant export store and file reader. A partial file resumes by rechecking its existing prefix against the same immutable export before writing the remainder. Artifact hashes are journaled before exclusive publication; an accepted replay response is retained before immutable output publication. Restart reuses original request/selection/history and saved artifacts. Each attachment is drained and detached, and the parent retains the sole server/native lifetime.

Returned `nativeOutputs` contain complete file paths, lengths and hashes for the parent's final package. The private connection file and internal retained-export directory stay outside that package. This helper starts no provider acquisition, creates no extra review and launches no parallel customer process.

## Source composition and execution status

The integration consists of the separate Europe PMC adapter/catalog, the two small original Merchant registration/retainer joins, this guide, and the customer helper. Preserve the full original Research/clinical-trials/Documents/Pipelines/citation tool families when composing current shared files. The helper is part of the same original Europe PMC receiving operation; source syntax and contract review do not stand in for its actual native completion receipt.

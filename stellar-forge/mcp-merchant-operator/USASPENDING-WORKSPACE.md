# USAspending research through the merchant MCP

This adapter operates the maintained federal award research application and the
original research dossier engine. The browser and agent use the same saved
queries, immutable editions, analyst reviews, original provider jobs, prepared
merchant packages and finalized buyer deliveries.

The research application is
[USAspending Research](../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/README.md).
The complete source-receiving contract is
[USAspending Dossiers](../../stellar/scf-starforge-20261009/sf30-seller-sdk/usaspending/DOSSIER.md).

## Connect an original workspace

Use Node 22.16 or later. The complete distribution contains the native research
application, SF30 dataset merchant, SF100 delivery receiver and original SF88
dossier engine. Both authoring browsers listen on an ephemeral loopback port.

Create a private connection file and declare existing canonical private research
directories. An optional dossier directory selects an existing original dossier
store. When omitted, the adapter opens a private dossier store beneath the
research directory.

```json
{
  "schema": "stellar-forge.usaspending-workspace-connection.v1",
  "workspaces": {
    "federal": {
      "label": "Federal award research",
      "directory": "/private/award-research/research",
      "dossierDirectory": "/private/award-research/dossiers",
      "operator": "Federal research operator",
      "sources": {
        "original-cohort": {
          "kind": "collection",
          "file": "/private/source/source/recent-ai-v2-details.json"
        },
        "portable-dossier": {
          "kind": "dossier",
          "file": "/private/receiving/original-dossier.research.json"
        }
      },
      "deliveries": {
        "original-buyer": "/private/original-buyer/delivery"
      },
      "merchant": {
        "defaultLimit": 50,
        "maxLimit": 100
      }
    }
  }
}
```

Declare only source files and delivery directories that exist. A connection may
contain 1–32 workspace aliases. Each original research and dossier directory has
one alias. Source handles accept the following original formats:

| Kind | Host declaration | Native reader |
| --- | --- | --- |
| collection | file; optional SHA256 | Original capture plus retained award-detail collection |
| capture | file; optional SHA256 | Original provider request, response and receipt pages |
| detail | file and receipt; optional SHA256 | One original award-detail response and HTTP receipt |
| workspace | file; optional SHA256 | Complete research backup, restored into an empty workspace |
| dossier | file; optional SHA256 | Complete portable dossier with revision and blob validation |

The connection file uses mode 0600; private directories use mode 0700. Source
paths are host configuration. Tools select the declared aliases and original
record IDs. Source collections retain their existing sibling-file and SHA256
checks. The optional source SHA256 pins the exact declared manifest or portable
file, in addition to the original format's internal bindings.

Initialize the normal merchant MCP:

```sh
starforge merchant-mcp init-usaspending-workspaces \
  --dir /private/award-mcp \
  --connection /private/award-connection.json \
  --name "Federal research merchant"
```

An existing merchant configuration can instead add
`usaSpendingWorkspaceConnection` with the path to that connection file.
It retains its other sources, workspaces, support, accounting and seller tools.

Connect the original merchant stdio server to that configuration using the
normal [merchant MCP instructions](README.md), then call
`merchant_usaspending_workspaces` and
`merchant_usaspending_open` with the chosen workspace alias.
Opening returns the original workspace ID, a process-owned instance ID, the
research browser URL, the dossier browser URL and current saved state.

## Work from the original data

The normal retained-source journey begins with
`merchant_usaspending_source_import`. Select an existing collection
handle to import its original search pages and detailed award responses. The
native importer preserves the original requests, body bytes, observation times,
coverage and hashes. It returns the original capture and resulting edition IDs.

Use these operations to complete research:

| Operation | Result |
| --- | --- |
| inventory | Paged queries, captures, editions, analyst reviews, prepared publications or dossiers |
| edition | Immutable edition, exact-value totals, recipient groups, source coverage and warnings |
| rows | Original row filters and native row pagination |
| award | Complete selected award row, original lineage and analyst review |
| compare | Native field changes and exact amount deltas between immutable editions |
| select | New immutable edition with the chosen original award keys |
| review_save | Revision-checked fit, complete workshare, acceptance, fee, owner and next action |
| history | Original operation history or one award's review history |

Tool names use the `merchant_usaspending_` prefix. Inventory,
recipient-group, change and dossier-section pages return a SHA256 snapshot.
Continue with that snapshot as `expectedSnapshot` and the returned
`nextOffset`. If the original records change, reopen page zero. Rows use
the native application's page/limit protocol within one immutable edition.

Financial source values remain decimal strings. Obligation, exercised value,
all-options value and outlays retain their separate native fields. A null
outlay is preserved as null. Comparing editions reports the original field
deltas; absent later results retain the native "absent_in_later_results"
classification.

## Capture, enrich and recover

Save a complete original query with `query_save`. The query includes its
date semantics, selected prime-contract types, keywords, agencies, NAICS/PSC
filters, page size and explicit retained-row capacity. Editing requires the
original query ID and current revision.

Call `capture` with either:

- the saved query ID and exact query revision to begin a new native capture; or
- the existing capture ID to continue that original capture.

These selections are mutually exclusive. The tool returns the job created by the
original browser application. `job` reads its current state and complete
result. `status` reports active capture IDs and job summaries.
`capture_status` reads the durable capture, original continuation, retained
page/row counts, selected capacity and native error.

After a lost tool reply, inspect those original records before starting another
operation. The research browser and MCP share the same native job controller.
Closing the owned instance pauses its running provider work and drains its
pending writes. Job IDs belong to that process; capture IDs and accepted pages
remain in SQLite across restarts.

`pause` accepts one original job ID or active capture ID.
`capture_capacity` changes a paused capture's retained-row capacity using
the original `updated_at` value. Resuming preserves accepted source pages
and provider continuation. A provider Retry-After remains attached to the
original capture and is honored by the native capture engine.

`enrich` starts the original detail job for up to 100 selected original
award keys. The native result reports retained detail IDs, failures and the
enriched edition. `attach_details` reuses already imported detail IDs.

## Prepare and receive the merchant dataset

`merchant_prepare` creates the original SF30 immutable CSV dataset,
source manifest, dataset configuration and bundle for a selected edition. It
runs as an original browser job. Use its resulting merchant ID for
`merchant_preview`, which applies the maintained dataset's native
filters, cursor and admission and reports `mode=local_dataset_read`.

Host configuration may select public payment terms, an HTTPS merchant origin and
the native route in the `merchant` object. It supports only the original
`payment`, `origin`, `path`,
`defaultLimit` and `maxLimit` fields. Payment and origin
are supplied together and the original SF30 compiler validates them during
preparation. Agent arguments retain the selected host configuration.

The prepared source files are available as complete exports: merchant-csv,
merchant-dataset, merchant-source, merchant-bundle and, when configured,
merchant-seller. The existing seller operator retains deployment, payment and
the original customer operation.

`delivery_adopt` selects an existing finalized SF100 delivery by its
host-declared alias. The native receiver verifies all page, snapshot, cursor,
intent, chain, manifest and output bindings before adding the received award
edition. Its original response archives remain available in complete research
and dossier exports.

## Complete the cited dossier

The dossier browser and MCP use the same original private store, immutable
revision files and content-addressed source blobs. Every write follows the
original expected-revision checks.

1. Create a dossier with `dossier_create`.
2. Add questions with `dossier_question`. Retain their returned original IDs.
3. Receive a complete award edition under one question with
   `dossier_receive`, passing its current dossier revision.
4. Read the sources section with `dossier`. Each source retains its
   question citations, original response components and source identity.
5. Select supporting, contradicting or background evidence with
   `dossier_evidence`. Use an occurrence ID for a question-specific
   selection, or the original source ID for the native source selection.
6. Write the actual finding with `dossier_finding`, its question ID and
   original cited source IDs. The original engine validates the question binding.
7. Export the complete portable JSON, Markdown and HTML report.

Receiving preserves the full edition, original capture pages, detailed response
bodies and any original native buyer archives. Receiving the same edition under
a different question produces that question's native source bindings.
An interrupted multi-component receive retains its progress on the original
error, and repeating the same selection uses the bridge's original replay logic.

`dossier_update` edits the title or description.
`dossier_question` edits a saved question's text, notes and status.
`dossier_finding` edits a saved finding using its original finding ID.
`dossier_compare` compares retained revisions.
For stable historical section paging, pass the original revision returned by
the dossier read.

A portable dossier can be declared as a source handle on a receiving workspace
and reopened with `source_import`. The original engine checks every
revision, blob, question, selection and finding reference before reopening.

## Export every byte and resume later

`export` creates a complete retained file through the original serializer.
It returns the export kind, immutable SHA256 export ID, exact byte count, MIME
type and native selection. The export is atomically retained in the merchant's
private customer-export directory.

| Kind | Required selection |
| --- | --- |
| edition-json | editionId; optional includeReviews |
| edition-csv | editionId |
| workspace | None |
| source-page | captureId and page |
| brief | editionId and awardKey |
| comparison | before and after edition IDs |
| dossier-json, dossier-md, dossier-html | dossierId |
| merchant-csv, merchant-dataset, merchant-source, merchant-bundle, merchant-seller | merchantId |

The complete edition JSON includes original source bytes and source coverage.
The full workspace backup includes every original table and retained provider
response. Workspace export requires its active provider work to be finished or
paused. Analyst review inclusion is selected explicitly for edition JSON.

Use `file_read` with the same workspace alias, kind and export ID.
The shared retained-file reader returns exact base64 chunks and
`nextOffset`; continue until it is null. Its response includes the file
SHA256, total bytes and read ID. Every read checks the retained export's bytes
against its content-addressed ID.

The original complete file survives read-session expiry and application
restart. Resume with the same kind, export ID and byte offset, omitting an
expired read ID. `file_release` releases only the temporary read snapshot.

Use `close` with the current instance ID when finished. Reopening the
same configured alias retains the original research ID, dossiers, source
records, merchant packages, native delivery archives and complete exported
files.

## Source and operating validation

The adapter uses the maintained AwardWorkspace, its original research HTTP job
controller, original source importers, SF30 merchant writer, SF100 receiver,
USAspending dossier bridge, original DossierStore and shared RetainedFileReads.
It adds host configuration, tool registration, lifecycle ownership, paged
responses and complete retained exports.

A receiving run should open the original retained award collection and exercise
the same saved research and dossier records through the normal merchant MCP,
then download a complete export, close the instance and resume that exact
export after reopening. Record the real original workspace/edition/dossier IDs,
source coverage, export hash and native application outcome with the shared
delivery. Keep any existing capture, buyer intent and payment operation attached
to its original owner while joining the agent interface.

## Run the complete native receiving example

The maintained example uses the original fifteen-award AI and IT collection,
including its retained query response, all award-detail bodies and receipts.
Its known source totals are obligations USD 29,461,170.92, exercised value
USD 29,465,539.92 and all-options value USD 105,824,144.08.
All fifteen total-outlay values remain null.

Run from the complete repository or distribution source with Node 22.16 or later:

```sh
node stellar-forge/mcp-merchant-operator/examples/usaspending-native.mjs \\
  --source /private/source/source/recent-ai-v2-details.json \\
  --out /private/usaspending-native \\
  --operation federal-award-receiving
```

The example opens both original applications and calls the configured merchant
adapter's normal tools to import the collection, save a query and analyst
review, select and compare editions, and prepare the original SF30 merchant.
It reads all three original dataset pages, finalizes their SF100 delivery,
adopts it and repeats adoption against the same saved delivery.

It receives the delivered awards under two dossier questions, adds the complete
original source and writes three findings with their original source citations.
It then downloads eleven complete exports, closes and reopens the application
partway through the dossier download, and resumes the same SHA256 export at the
saved byte offset. Finally, it restores the original research workspace,
analyst review and portable dossier into receiving directories and reads them
through the same adapter.

The private output directory contains `operation.json`, both original browser
HTML responses, the original dataset pages and delivery, complete downloaded
exports, and the reopened receiving stores. The operation journal checkpoints
accepted native steps and export IDs. Continue an interrupted run with the same
source file, output directory and operation ID; it reads the saved native state
and retained bytes before continuing.

The completed original run restored all nineteen immutable editions, fifteen
award rows, the original analyst review and all three cited findings. The
1,799,497-byte portable dossier resumed at byte 65,536 and retained its complete
export hash through reopening and receiving. The native run also exercised the
receiver's page-count binding against each retained page's `payload.rows.length`.

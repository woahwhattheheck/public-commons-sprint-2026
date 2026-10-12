# Grants.gov opportunity workspace

A complete local workspace for federal grant research: save a source query, acquire the original Grants.gov search pages and notice details, qualify opportunities, preserve editions, compare revisions, prepare a dataset merchant and deliver the research to another operator.

The browser and CLI use the same private workspace. The native publisher is the existing SF30 dataset, Socrata publishing, SF82 release and SF88 customer implementation. Grants.gov source acquisition and analyst qualification live in this directory.

## Open the operator workspace

Use Node.js 22+ for research and the repository's configured native payment dependencies for publishing. On Linux the private writer uses the existing kernel file-lock helper. Run from `stellar/scf-starforge-20261009/sf30-seller-sdk`:

```sh
node dataset-cli.mjs grants serve --workspace /private/grant-research
```

The startup JSON contains a loopback URL with a random session fragment. Open that complete URL. The page removes the fragment after storing it for this browser session.

The interface has five working areas:

| Area | Operator work |
| --- | --- |
| Opportunities | Filter and page an edition, select a working cohort, inspect original notice details, and edit qualification and delivery work. |
| Search & capture | Save the full search definition, acquire its search pages and notice details, inspect progress, pause, and resume the same acquisition. |
| Compare editions | Compare two saved editions, including their source funding, deadlines, eligibility, description, packages, attachments and revision history. |
| Publishing | Prepare a merchant dataset, inspect its native pages, and operate the existing publisher, release and customer workflow. |
| Exports & receiving | Download complete source, edition, merchant, comparison, workshare and workspace files, or receive an existing original capture, edition or workspace. |

The layout uses neutral colors, ordinary form controls, readable tables, a wide detail pane and a narrow-screen arrangement. Source descriptions are rendered as text. Qualification is editable separately from the retained original notice.

## Acquire a complete source

A saved query contains `keyword`, `opportunityNumber`, `statuses`, `agencies`, `eligibilities`, `fundingCategories`, `fundingInstruments`, `aln` and `pageSize`. Lists are arrays. The default statuses are `posted` and `forecasted`; page size defaults to 25 and may be at most 100.

Save a query:

```sh
node grantsgov/cli.mjs query --workspace /private/grant-research \
  --name "Artificial intelligence opportunities" \
  --keyword "artificial intelligence" --statuses posted,forecasted \
  --request ai-query-20261012
```

For all source filters, pass a JSON definition with `--file query.json`:

```json
{
  "keyword": "artificial intelligence",
  "opportunityNumber": "",
  "statuses": ["posted", "forecasted"],
  "agencies": [],
  "eligibilities": [],
  "fundingCategories": [],
  "fundingInstruments": [],
  "aln": "",
  "pageSize": 25
}
```

Use the returned query ID for the complete acquisition:

```sh
node grantsgov/cli.mjs capture --workspace /private/grant-research \
  --query GQ-RETURNED_ID --operation grants-ai-original-20261012 \
  --request grants-ai-start-20261012
```

Acquisition writes each original page and notice detail before advancing its journal. It follows the source result count, retains every distinct opportunity, fetches its full notice record, and reports coverage including missing detail IDs, duplicate IDs, changed result counts and the next search offset. A partial or interrupted capture keeps its original operation and committed source records.

Pause a browser capture with its Pause button, or signal the original CLI process. Resume that capture ID:

```sh
node grantsgov/cli.mjs resume --workspace /private/grant-research \
  --capture GC-RETURNED_ID --request grants-ai-resume-20261012
```

The source adapter uses Grants.gov's original `search2` and `fetchOpportunity` endpoints. Source requests and actual response details are documented in [SOURCE_PROTOCOL.md](SOURCE_PROTOCOL.md), including the observed `cfda` request field for the public `aln` filter.

The original public API returns a token even for an unauthenticated search. The capture retains the exact JSON bytes for the source's `data` value, the whole-response digest, request and HTTP response metadata; the token is excluded and never reused. Receiving validates the complete retained source packet before reading its opportunities.

## Use an existing acquisition

A portable capture contains all committed original source records. Importing it requires no new provider requests:

```sh
node grantsgov/cli.mjs import --workspace /private/grant-research \
  --file original-capture.json --request receive-original-capture
```

Create an edition from the returned capture ID:

```sh
node grantsgov/cli.mjs edition --workspace /private/grant-research \
  --capture GC-RETURNED_ID --name "Original AI opportunity edition" \
  --request original-ai-edition
```

An edition freezes its complete original source packet alongside the normalized rows. Later source acquisition cannot replace that edition's source, notice fields or selected rows. Select a smaller working cohort in the browser, or use `edition.create` with `sourceEditionId` and `opportunityIds` to derive it from an existing frozen edition.

## Qualify an opportunity

Each detail view retains the original opportunity ID and number, agency, current document type, status, source URL, published dates, raw funding text, eligibility narrative, assistance listings, attachment metadata, application packages and revision history.

The adapter preserves the provider's distinctions:

- Calendar dates have a normalized date for sorting plus the original date and timezone text.
- Amount fields retain reported text such as `none`; a decimal companion is present only when the source reports a parseable amount.
- Current synopsis fields and forecast fields are separate. An old forecast can remain in a current posted notice.
- Attachment and application package manifests retain their original links and metadata.
- A record absent from a later selected edition is described as absent from that edition. Its original source status remains available.

Qualification fields are `status`, `owner`, `fit`, `eligibilityAssessment`, `partner`, `workshare`, `deliverables`, `acceptance`, `schedule`, `fee`, `nextAction` and `notes`. The available statuses are `researching`, `qualified`, `preparing`, `ready` and `passed`.

A saved review binds to the exact edition, source notice and revision. Each update keeps its prior content and source binding. Concurrent edits use the displayed revision; a stale save returns a conflict so the operator can refresh and incorporate the other edit.

Read and edit through the CLI:

```sh
node grantsgov/cli.mjs opportunity --workspace /private/grant-research \
  --edition GE-RETURNED_ID --id 363268

node grantsgov/cli.mjs review --workspace /private/grant-research \
  --edition GE-RETURNED_ID --id 363268 --revision 0 \
  --file qualification.json --request opportunity-363268-review
```

The Markdown and HTML workshare exports include the complete saved qualification, original notice facts, eligibility text and source attribution. A receiving operator gets the same saved review history.

## Compare editions and prepare a dataset

```sh
node grantsgov/cli.mjs compare --workspace /private/grant-research \
  --before GE-EARLIER_ID --after GE-LATER_ID
```

The comparison reports additions, original fields that changed, and opportunities absent from the later edition. It flags substantive deadline, eligibility, status and funding changes for review. Observation timestamps and source digests alone do not create a notice-content change.

Create a dataset from an immutable edition:

```sh
node grantsgov/cli.mjs merchant --workspace /private/grant-research \
  --edition GE-RETURNED_ID --request merchant-original-ai

node grantsgov/cli.mjs preview --workspace /private/grant-research \
  --merchant GM-RETURNED_ID
```

The retained merchant directory contains:

| File | Content |
| --- | --- |
| `dataset.csv` | Complete selected scalar columns, including original date and amount text. |
| `dataset.json` | Original SF30 string/null column schema, filters, date ranges, sorting and page limits. |
| `source.json` | Source edition, coverage, attribution and exact source-file descriptors. |
| `source/capture.json` | Complete original portable capture. |
| `source/edition.json` | Immutable edition and original normalized rows. |
| `seller.json` | Public seller configuration when the operator supplies payment terms and an origin. |
| `manifest.json` | Merchant identity and file inventory. |

The SF30 dataset engine reads this CSV and schema directly. Status, document type, agency and eligibility filters use retained source columns. ISO date range columns sort as calendar dates. Large monetary text stays a string through dataset delivery.

For a configured merchant, add `payment` and `origin` together in a JSON file passed to `merchant --file`. The payment object contains the original public `scheme`, `network`, `asset`, `amount`, `payTo` and `maxTimeoutSeconds`; `amount` is an atomic-unit string. The canonical HTTPS origin and optional route `path` identify the advertised resource. Private signing material belongs in the original buyer runtime.

## Operate the existing native publisher

The Publishing screen passes documented native operations to the existing [Socrata publisher](../socrata/publisher.mjs). The workspace resolves a merchant ID to its retained folder and a configured buyer alias to its existing private workspace. Every native draft, snapshot, release generation and customer session remains owned by that publisher.

Use the current returned IDs and revisions in sequence:

| Action | Input |
| --- | --- |
| `publisher.prepare` | `merchantId` |
| `publisher.preview` | `target` (`draft:ID` or saved snapshot), `query` |
| `publisher.reviewDraft` | `draftId`, `expectedSnapshot`, `expectedRevision` |
| `publisher.publish` | `draftId`, `expectedSnapshot`, `expectedRevision` |
| `publisher.activateSnapshot` | `snapshot`, `expectedSnapshot`, `expectedRevision` |
| `publisher.release.stage` | `draftId`, `id`, `label`, `runtime` |
| `publisher.release.inspect` | `id` |
| `publisher.release.activate` | `id`, `expectedGeneration` |
| `publisher.release.start` | `expectedGeneration` |
| `publisher.release.stop` | Empty object |
| `publisher.release.rollback` | `expectedGeneration` |
| `publisher.buyer.review` | `snapshot`, `query` |
| `publisher.buyer.prepare` | Original `review`, `intentId`, `acceptIndex`, `offerSha256` |
| `publisher.buyer.session` | `buyerId`, `workspaceId`, `maxPages`, `maxTotalAtomic`, `maxRows`, `maxPageBytes` |
| `publisher.buyer.run` | `id`, `retryUnpaid`, optional `expectedAttemptSha256` |
| `publisher.buyer.recover`, `publisher.buyer.account`, `publisher.buyer.export` | `id` |

Release runtime configuration uses the original `port`, `facilitator` and `allowLocalFacilitator` fields. The existing native runtime performs the actual payment and customer acquisition. Inspect that runtime's current state to continue an existing customer attempt.

Configure buyer aliases in a host file:

```json
[
  {"id": "grant-research-customer", "directory": "/private/existing-stellar-buyer"}
]
```

Start the operator with `--buyers buyer-bindings.json`. A browser customer session chooses `workspaceId: "grant-research-customer"`; it cannot supply an arbitrary host path.

All native actions are also available from the CLI:

```sh
node grantsgov/cli.mjs action --workspace /private/grant-research \
  --buyers buyer-bindings.json --action publisher.prepare \
  --input prepare-merchant.json
```

A CLI `publisher.release.start` stays alive to own the original running release. Signal that process to drain it. For a combined operator and running release, use the browser service so subsequent native operations share the same owner.

Publisher export kinds include `draft-csv`, `draft-review`, `buyer-config`, `session-manifest`, `session-csv`, `session-jsonl` and `session-review`. `publisher.export` retains the complete original export in this workspace and returns a download descriptor.

## Deliver and reopen the complete work

The Exports & receiving screen downloads every byte of each selected original export. Source, edition and workspace files are portable JSON; workshare files are Markdown or HTML.

Create a complete workspace backup:

```sh
node grantsgov/cli.mjs export --workspace /private/grant-research \
  --kind workspace --out grant-research-workspace.json
```

Receive it into a new private directory:

```sh
node grantsgov/cli.mjs restore --workspace /private/received-grant-research \
  --file grant-research-workspace.json --request original-workspace-receiving

node grantsgov/cli.mjs serve --workspace /private/received-grant-research
```

The complete research backup preserves the original workspace ID, query definitions, captures, immutable editions, source packets, qualification revisions and histories. Merchant folders and the live native publisher have their own retained export and customer lifecycle; the operator can recreate a merchant from its same original research edition.

For a selected edition with its review and referenced original source:

```sh
node grantsgov/cli.mjs export --workspace /private/grant-research \
  --kind edition --edition GE-RETURNED_ID --out selected-edition.json

node grantsgov/cli.mjs receive --workspace /private/received-selected-edition \
  --file selected-edition.json --request original-edition-receiving
```

An edition package includes each parent and review-referenced edition needed to interpret the saved work. Receiving into an existing research workspace accepts identical retained editions and rejects conflicting saved qualification content. It checks source-byte inventories, coverage, regenerated source rows, edition identity and review bindings before writing.

Download descriptors contain an exact byte count and SHA-256. The API supports chunked reads of the same retained export across close and reopen; a subsequent download does not generate a new source capture.

## Embed or automate

```js
import { openGrantsWorkspace } from './grantsgov/workspace.mjs';

const workspace = await openGrantsWorkspace({
  directory: '/private/grant-research',
  buyerWorkspaces: [
    { id: 'grant-research-customer', directory: '/private/existing-stellar-buyer' }
  ]
});
try {
  const state = await workspace.snapshot();
  const rows = await workspace.rows(state.editions[0].id, {
    search: 'artificial intelligence',
    closingFrom: '2026-10-12',
    sort: 'closing_date',
    offset: 0,
    limit: 50
  });
  console.log(rows.items);
} finally {
  await workspace.close();
}
```

The local HTTP surface provides authenticated `GET /api/state`, `POST /api/action` with `{action,input}`, and `GET /api/exports/EXPORT_SHA`. Success responses contain `{ok:true,result}`. Use the current bearer token returned by the server; the service checks the exact local Host and browser Origin.

Native workspace mutations require a stable `requestId`. Reusing it with identical input returns the saved original result; different input receives `REQUEST_ID_REUSED`. Named operations include:

- `query.save`, `capture.start`, `capture.status`, `capture.pause`, `capture.wait`, `capture.import`;
- `edition.create`, `edition.read`, `edition.receive`, `edition.compare`;
- `opportunity.list`, `opportunity.read`, `review.save`, `workshare.read`;
- `merchant.create`, `merchant.read`, `merchant.preview`;
- `export.create`, `export.read`, `workspace.restore`, `workspace.status`;
- the native publisher actions above.

The saved workspace uses the original repository's private directories, exclusive writer lease and atomic metadata updates. Closing drains active capture and publisher work, then releases that writer.

## Complete native research journey

[examples/research-native.mjs](examples/research-native.mjs) runs one complete source-backed operator and receiving journey over a retained acquisition. It uses the actual SF30 dataset pages, edits qualification through the live browser, downloads a complete backup, resumes an export after reopening its owner, and receives both the whole workspace and a selected edition. It also retains desktop and narrow-screen captures plus the full receiving ZIP.

Run it with an installed browser and Playwright:

```sh
node grantsgov/examples/research-native.mjs \
  --source /private/original-capture.json \
  --work /private/grants-native-work \
  --out /private/grants-native-delivery \
  --operation grants-research-native-original \
  --playwright /installed/node_modules/playwright \
  --chromium /installed/chromium
```

The operation journal retains the source digest, original identities, phase outcomes and full output files. Use the same operation and retained private workspace when continuing it. A completed invocation returns its verified existing outputs.

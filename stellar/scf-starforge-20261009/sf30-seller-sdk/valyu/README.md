# Valyu research workspace

A complete customer research application on the maintained Stellar Forge merchant and buyer.

The merchant exposes one searchable resource, `POST /research/search`. Its generated SF30 client carries the exact resource and payment selection into the original SF88 buyer. The customer workspace saves questions, receives the delivered response, adds selections and notes, freezes editions, compares deliveries, and exports JSON, Markdown, CSV or a standalone HTML report. A resumed operation reads the same original buyer record.

The operator interface uses the local browser: saved queries, the exact normalized request, native purchase review, result recovery, research notes, edition import/export and comparisons. It is deliberately a plain industrial interface.

## Run from the maintained distribution

Node 24 or later is required for the built-in SQLite store. Use the normal Starforge native installation for `@x402/core`, `@x402/stellar`, `@x402/extensions` and `@stellar/stellar-sdk`. This application adds no package dependencies.

```sh
starforge valyu-merchant --help
starforge valyu-research --help
```

From a repository checkout, the corresponding entrypoints are:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/valyu/merchant-cli.mjs --help
node stellar/scf-starforge-20261009/sf30-seller-sdk/valyu/run.mjs --help
```

[MERCHANT.md](MERCHANT.md) describes provider configuration, native merchant terms, original facilitator/operations startup and delivery profiles. [RESEARCH-EDITIONS.md](RESEARCH-EDITIONS.md) documents original result types, usage, citations, comparison and report formats.

### 1. Start the merchant and obtain its generated client

Use the merchant configuration and original native operator described in MERCHANT.md. The service publishes its original generated JavaScript client at `/_seller/client/seller-client.mjs`; retain those exact bytes as a private file. The customer initializer binds that original generated client to its SHA-256.

The API key stays on the merchant in the selected environment variable. A buyer never sends a Valyu key or arbitrary upstream URL. Payment options and the receiving account come from the original service configuration.

The provider source allowance `max_price` is denominated in CPM. The buyer's `maxAtomic` is its separate total payment ceiling, and `total_deduction_dollars` is the actual provider deduction. These values retain their original units.

### 2. Initialize a private customer workspace

Use an absolute private state directory, a retained generated seller client, and either an original operator profile or an existing original SF88 operator directory.

```sh
node run.mjs init \
  --state-root /absolute/private/valyu-customer \
  --seller-client /absolute/private/seller-client.mjs \
  --operator-profile /absolute/private/operator-profile.json \
  --provider-config /absolute/private/valyu-provider.json

node run.mjs serve \
  --settings /absolute/private/valyu-customer/settings.json
```

Run the preceding commands from this directory. Open the returned local URL including its access fragment. The desk binds to loopback and uses a session token. Settings, response captures and buyer records use private files and a local SQLite database.

An operator profile contains the existing native `operator`, `signerModule`, `trustedPayer`, `bodyCaptureTimeoutMs`, `buyerTransport` and `requestTimeoutMs` fields as needed. For adoption of an existing original operator, pass `--operator-directory` instead. It must already be inside the selected state root; the application's archive composes that original operator and customer state into one original recovery selection.

The initializer also accepts a workspace without payment files for receiving permitted research editions and provider observations. Add native purchase configuration by initializing a separate complete state root from the retained client and original operator.

### 3. Save a question and review its exact purchase

A draft file contains a title and Valyu request:

```json
{
  "title": "Stellar storage documentation",
  "input": {
    "query": "Stellar smart contract storage documentation",
    "search_type": "web",
    "max_num_results": 2,
    "included_sources": ["developers.stellar.org"],
    "url_only": true,
    "max_price": 2,
    "response_length": 200
  }
}
```

```sh
node run.mjs request --settings /absolute/private/valyu-customer/settings.json --input /absolute/private/question.json
node run.mjs query --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
node run.mjs prepare --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID --revision 1 --max-atomic ATOMIC_CAP --accept 0
node run.mjs review --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
node run.mjs execute --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
```

Replace `ATOMIC_CAP` with the chosen cap for the original merchant terms. The browser presents the same saved request, option index, cap and native review. The original buyer owns signer access, approval, payment and response capture.

Preparation records its intent before creating the native operation. Once prepared, a query's request is immutable. Duplicate a query to make a new request or edition. Interrupted execution uses the saved intent:

```sh
node run.mjs inspect --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
node run.mjs collect --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
```

`collect` consumes the original saved result. It does not submit a new provider request or payment.

### 4. Build and export research editions

Use the browser to select results, write notes and tags, then freeze the selection. Each edition contains the saved request, exact delivered response bytes and hashes, provider usage, source agreement information and the selected annotation revision. Its immutable manifest can be reopened in the same or another configured workspace.

CLI annotation input:

```json
{
  "captureId": "CAPTURE_ID",
  "rowId": "ROW_ID",
  "expectedRevision": 0,
  "selected": true,
  "note": "The research question and follow-up decision.",
  "tags": ["storage"]
}
```

```sh
node run.mjs annotation --settings /absolute/private/valyu-customer/settings.json --input /absolute/private/annotation.json
node run.mjs query --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
node run.mjs freeze --settings /absolute/private/valyu-customer/settings.json --capture CAPTURE_ID --selection-sha CURRENT_SELECTION_SHA256
node run.mjs editions --settings /absolute/private/valyu-customer/settings.json
node run.mjs export --settings /absolute/private/valyu-customer/settings.json --edition EDITION_ID --format html --out /absolute/private/research.html
node run.mjs export --settings /absolute/private/valyu-customer/settings.json --edition EDITION_ID --format json --out /absolute/private/research.json
node run.mjs import-edition --settings /absolute/private/valyu-customer/settings.json --input /absolute/private/research.json
node run.mjs compare --settings /absolute/private/valyu-customer/settings.json --left EARLIER_EDITION_ID --right LATER_EDITION_ID
```

The freeze operation checks the current selection hash. An edition import verifies the exact response bytes, request, source delivery, original provenance and annotation shape before recording it. Identical edition IDs and contents reopen idempotently; a conflicting ID cannot overwrite an existing edition. Output paths must be new files inside an existing private directory.

### 5. Receive an existing provider observation

The importer can receive an already completed original provider request without executing another. Supply the original request bytes, original response bytes, and a private provenance record with:

- `url`: `https://api.valyu.ai/v1/search`;
- actual `status` of 200 or 206 and ISO `capturedAt`;
- `requestSha256`: SHA-256 of the exact request file;
- `sha256`: SHA-256 of the exact response file.

```sh
node run.mjs import-observation \
  --settings /absolute/private/valyu-customer/settings.json \
  --id UNPURCHASED_QUERY_ID \
  --response /absolute/private/provider-response.json \
  --request /absolute/private/provider-request.json \
  --provenance /absolute/private/provider-observation.json
```

The saved query must match that original request under the configured request defaults. At first observation capture, the query binds the exact original provider request and its compact JSON hash, preserving any fields that were omitted in the actual API call. The importer projects raw results through the configured delivery profile before retaining them, or validates an already projected delivery against the same trusted profile. It keeps separate hashes for the upstream response and the delivered projection. Native purchases and external provider observations keep distinct provenance.

### 6. Recover the complete workspace

The existing SF88 recovery engine handles encryption, verification and canonical restore. Close the desk, select the complete original operator/state root, and use the archive's existing passphrase environment:

```sh
node run.mjs backup-review --settings /absolute/private/valyu-customer/settings.json
node run.mjs backup --settings /absolute/private/valyu-customer/settings.json --out /absolute/private/valyu-archive --quiesced --pass-env SF88_BACKUP_PASSPHRASE
node run.mjs verify --bundle /absolute/private/valyu-archive --record-sha ARCHIVE_RECORD_SHA256 --pass-env SF88_BACKUP_PASSPHRASE
node run.mjs restore --bundle /absolute/private/valyu-archive --record-sha ARCHIVE_RECORD_SHA256 --pass-env SF88_BACKUP_PASSPHRASE
```

Original restore semantics and destination conditions apply. Research state, original buyer operation files, settings, generated client and native operator remain in one selected recovery unit.

## Application and dossier integration

```js
import { ValyuWorkspace } from './workspace.mjs';
import { ValyuStore } from './store.mjs';
import { exportResearchEdition } from './research.mjs';

// The existing workspace supplies its normalized provider configuration.
const workspace = await ValyuWorkspace.open(settings);
const page = workspace.store.listEditions({ offset: 0, limit: 30 });
const edition = workspace.store.editionView(page.editions[0].id);
const original = workspace.store.edition(edition.id).manifest;
const report = exportResearchEdition(original, 'html');
// Write report.bytes using the caller's existing durable output path.
workspace.close();

// A dossier may consume the same private store directly.
const store = await ValyuStore.open(researchDirectory, { provider });
const retained = store.editionView(editionId);
store.close();
```

`editionView` returns `id`, `sha256`, `title`, `createdAt`, `query`, response provenance, `retentionMode`, `validUntil`, `agreementReference`, rows, summaries and annotations. Annotations are keyed by `row.id`.

Each row carries `occurrenceId`, original position, content disposition, normalized source fields, citations and a typed original `raw` result when supplied by a durable source agreement. A withheld occurrence has its opaque handle and no publisher fields. A dossier can retain its own questions and analyst findings against those stable handles. The same-source row union and export interface are documented in RESEARCH-EDITIONS.md.

## Source delivery

The merchant applies the source profile before returning bytes to SF88. The default `references-only` profile retains the customer's request, transaction/usage values, upstream hash and opaque occurrence handles. Explicit durable source agreements may add the full permitted original result. Timed or request-only provider content remains outside frozen editions and archives.

A delivery profile is trusted server configuration, and the customer configuration must agree with it when receiving licensed sources. Named web/news sources additionally use explicit returned-URL scope. Original result types, 200/206 status, source warning counts and actual provider deduction are preserved by the delivery adapter.

This product is the implementation, deployment and research workflow. Provider source access uses the customer's selected source agreement. Current official technical and delivery references are linked in MERCHANT.md and RESEARCH-EDITIONS.md.

## Files

- `config.mjs`, `adapter.mjs`, `delivery.mjs`, `application.mjs`, `merchant-cli.mjs`: native merchant and provider integration.
- `workspace.mjs`, `store.mjs`: original buyer orchestration and saved customer research.
- `research.mjs`: source analysis, comparison and four report formats.
- `server.mjs`, `static/`: private operator interface.
- `run.mjs`: customer CLI, observations and original recovery.
- `runtime.mjs`, `files.mjs`: maintained runtime resolution and original private-file helpers.

`VALYU_RUNTIME_ROOT` selects the existing `stellar/scf-starforge-20261009` root when running in an established native source overlay. The installed distribution resolves the colocated original components automatically.

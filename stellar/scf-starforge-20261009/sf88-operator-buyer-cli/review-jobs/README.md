# Review jobs: published source to retained customer delivery

This application carries a customer review assignment through the original Starforge buyer, inbox, resource library and named collections. It adds the job identity, source selection, assignment and named review that sit around those existing operations. The original native buyer remains responsible for request approval, payment, uncertain-attempt recovery, complete response files and finalization.

The application is available under the installed command `starforge inbox review-jobs`. It is also importable from `review-jobs/model.mjs`. Its browser is served by the original private resource-library service, sharing that service's authentication, collection pages and download transport.

## Source and native service are separate selections

The source intake accepts actual UseTested published search or review JSON. It stores the complete original response bytes and acquisition metadata, then binds one exact response row to a job. Published verdict, scores, nulls, quoted prices, timestamps, endpoint and methodology edition remain unchanged.

UseTested's published service listing does not establish a Stellar payment offer. The operator separately imports a current native merchant catalog, selects its resource and accepted payment terms, and explains the mapping in a retained note. Preparation uses the original `prepareReview` validator and accepts a `stellar:` network. A demonstration merchant that delivers a retained published review must be identified as that merchant's delivery; it is not evidence that UseTested deployed Stellar or performed new testing.

Only these free, first-party source reads are implemented:

| Source | Request |
| --- | --- |
| Search | `GET https://usetested.com/v1/search?q=QUERY` |
| Published review | `GET https://usetested.com/v1/review?service=SERVICE` |

The source client follows no redirects and retains the acquisition URL. The interface does not create UseTested review requests, retest quotes or paid bundle calls. Those external provider operations require their actual interfaces and quote semantics; a source import does not stand in for them.

The first-party interface reference is [sharan01x/usetested-skill](https://github.com/sharan01x/usetested-skill/tree/88340534f6dc2d7a4f5d713a5e1848258e37a708), pinned at `88340534f6dc2d7a4f5d713a5e1848258e37a708` (MIT). The original Starforge source used for this integration is [public-commons-sprint-2026](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/d07fe689e0d9af9ce61a3cd08a5e8723ba071ef1/stellar/scf-starforge-20261009). The retained runtime composes its complete COL6 collections, current Node transport, original SF81 approval bridge and the SF62/SF36/SF54/SF59 Python approval chain. The application adds no second payment or approval engine. Later cumulative repository changes should be composed into those original components.

## Open a workspace

Keep the application, buyer, inbox and original operator workspace beneath the same private canonical state root when whole-workspace backup is required. The source code can reside elsewhere.

```sh
starforge inbox review-jobs serve \
  --state /private/customer-work/review-jobs \
  --workspace /private/customer-work/operator \
  --port 0
```

The command prints a single private URL. Open that URL to load the review workspace. The browser consumes its token from the fragment and uses the same authenticated session as the original resource library and collections pages. Do not publish that URL or put it in screenshots.

The first opening records the original operator workspace, buyer state and inbox binding in the application state. Later openings may use only `--state`; conflicting bindings are refused. `--profile` can select an existing private native operator profile instead of `--workspace`, but workspace finalization and complete workspace backup require the original operator workspace. The UI does not edit payer, signer, native reservation policy or credential files.

Default buyer and inbox directories live under the application state. Existing directories can be selected at first opening with `--buyer-state` and `--inbox`. A kernel-held state lease allows one application writer per state directory. Process termination releases the lease through the original operating-system mechanism.

## Operator workflow

### 1. Retain the source and create the assignment

Use **Published source and new job** to fetch a free source or import an already captured JSON response. An imported response needs its actual source URL; the acquisition timestamp can be retained when known. The application also records the local import time and exact body hash.

Select a source snapshot and then its exact service row. One service name can occur more than once with different endpoints. The browser keeps the row index; the API accepts `sourceRow` and requires it when a name is ambiguous. A later source snapshot or different row is a new assignment, rather than an overwrite of an existing job's source.

Enter a stable external job ID, title, assigned owner and objective. Retrying the same initial identity returns the same job. Reusing an ID for a different source, row or assignment identity is refused. Later reassignment has its own named owner, note and event.

### 2. Map the native request

Import the original merchant catalog, choose its resource and accepted terms, then supply the exact request URL, method, headers and optional body. The catalog bytes, accepted terms and request body hash become part of the retained request identity. The mapping note should explain what the selected native endpoint will deliver for the published source.

For an imported body, an empty body and no body are distinct. The Node API uses strict base64 for exact binary content; the browser retains the UTF-8 bytes of the entered body. Request headers remain in private original request storage. The review display exposes their names rather than secret values.

The default native intent is stable for the application workspace and external job ID. An explicitly supplied intent must be unique within this job workspace. Once the native request is bound, the application refuses changes to the URL, body, accepted terms or source mapping under that same job. An interrupted preparation resumes the same retained identity and original operation.

### 3. Review, approve and execute

**Load native review** asks the original inbox for its current exact request review. The operator then records a named reviewer and a note. Approval binds that saved review to the retained native request.

**Execute** uses the original inbox and saved approval. The service owns the resulting background action; closing an HTTP request or browser tab does not start another action or cancel an active payment. The UI shows the native outcome and child-process outcome separately. Each execution action retains its own named approval, so a later review cannot replace the recorded approval of an earlier attempted acquisition.

Use a stable `operationId` for each intentional native action. If a browser response is lost, repeat that exact action ID and input to retrieve its retained action. A new action ID is not a recovery mechanism. The original buyer's permanent attempt marker also prevents a second execution of the same native intent.

**Stop running action** aborts the currently identified original native child and retains the attempt. A stop or disconnected process does not prove that settlement did not happen.

### 4. Reconcile and finalize the original outcome

After interruption, reopen the same application state and inspect the same job. **Recover original outcome** invokes the original inbox evidence recovery against the same intent, reservation, accepted terms and transaction evidence. The application does not infer success from a process exit or create another financial ledger.

A recovered settlement and an available complete response are distinct facts. The native recovery view reports its observation, reconciliation, evidence and binding; the resource library separately reports whether the full original result bytes are present and verified. If the original native result requires its original download summary, recovery does not fabricate it.

**Finalize original workspace** invokes the existing original operator finalization. This control is available only with an original workspace binding. It uses the same native accounting and reservations path.

### 5. Review the complete result

The resource view uses the original library's verified file, content type, byte length and SHA-256. Preview may be partial; **Download complete result** uses the original verified download transport.

A named analyst review first verifies the full native response and its exact match to the library resource. The note is saved through the original annotation history and tied to the resource hash and annotation revision. The analyst's note is separate from UseTested's published verdict and scores.

If another operator edits the resource note, the old result review remains in history, but it cannot silently select the edited note for a new delivery. Review the current annotation revision before preparing that delivery.

### 6. Select and deliver a named collection

Enter a customer-facing delivery name and note. The application saves a named collection through the original COL6 collection engine, pinning the exact full result hash and annotation revision. It records the original collection CAS request before the collection commit.

If a collection is committed but the outer job receipt is lost, retry the same delivery operation ID. The retained original expected revision is reused to reconcile that edition, including after a page reload. A different delivery request is refused while that retained selection is unresolved. A definitive original validation or revision rejection before commit is recorded separately; refresh and review the current resource, then make a new explicit selection. Unknown storage or commit completion remains pending for exact reconciliation.

**Download delivery** exports the original complete collection package at its selected revision. **Download job handoff** exports source acquisition, exact published review, native request mapping, named approvals, actual native summary and delivery identifiers. The handoff is metadata; the collection package supplies the retained complete result and selected note. Both belong to the intended private customer or operator workflow.

Use the original received-collection workflow to open that package as a retained reader. It verifies packaged files and annotations and does not make another provider call. A later collection edition does not change an earlier delivered edition.

```sh
starforge inbox library collections inspect \
  --archive /private/delivery/review-edition.ustar --sha256 EXACT_ARCHIVE_SHA256

starforge inbox library collections receive \
  --archive /private/delivery/review-edition.ustar --sha256 EXACT_ARCHIVE_SHA256 \
  --out /private/received/review-edition --state /private/received/review-library

starforge inbox library collections serve --state /private/received/review-library --port 0
```

For a lost receive reply, repeat the same original archive, destination and library state with `--resume true`; do not create another receipt identity. The archive name is operator-selected, and its format is the original complete private USTAR collection package.

## CLI and integration contract

All mutation commands read the same JSON objects as the browser API using `--input FILE`. Use current job revisions from `status --id JOB`; stale unrelated mutations are refused.

```sh
starforge inbox review-jobs source-import --state /private/customer-work/review-jobs \
  --file /private/captures/search.json --kind search \
  --url 'https://usetested.com/v1/search?q=x402' \
  --retrieved-at '2026-10-11T22:34:01.198574Z'

starforge inbox review-jobs catalog-import --state /private/customer-work/review-jobs \
  --file /private/captures/native-catalog.json

starforge inbox review-jobs create --state /private/customer-work/review-jobs --input create.json
starforge inbox review-jobs status --state /private/customer-work/review-jobs --id customer-review-001
```

The timestamp above illustrates a retained acquisition field; use the actual timestamp of the response being imported. Do not assign it to a later capture.

Core request shapes:

```js
// create
{
  externalId, title, owner, objective,
  sourceSha256, service, sourceRow // zero-based sourceRow optional for a unique service
}

// prepare
{
  externalId, revision, catalogSha256,
  rowIndex, acceptIndex, url, method, mappingNote,
  headers, bodyBase64, intentId // last three optional
}

// review
{externalId, revision}

// approve
{externalId, revision, reviewId, reviewer, note}

// assign
{externalId, revision, owner, note}

// execute, recover, finalize, cancel
{externalId, revision, operationId}

// annotate
{
  externalId, revision, operationId,
  resourceId, resourceSha256, annotationRevision,
  reviewer, note
}

// deliver
{externalId, revision, operationId, name, note}
```

Native commands wait for the original child to finish and return the current job. Browser action requests return after retaining the action, then the UI observes the original background outcome. A caller can use `app.whenIdle()` before closing a directly imported model.

```js
import {openReviewJobs} from './review-jobs/model.mjs';
import {serveReviewJobs} from './review-jobs/server.mjs';

const app = await openReviewJobs({
  state: '/private/customer-work/review-jobs',
  workspace: '/private/customer-work/operator'
});
const service = await serveReviewJobs(app, {port: 0});

// Only share service.url with the intended private operator.
// Await native work and close the original listener, library and lease.
await service.close();
```

Retained source and catalog imports are available on `app.importSource(raw, metadata)` and `app.importCatalog(raw)`. `app.inspect(externalId)` returns the job, native summary, resource list and active-action state. `app.handoff(externalId)` returns the customer handoff; `app.exportDelivery(externalId, newDestination)` invokes the original collection exporter.

The authenticated HTTP namespace is `/api/review-jobs/`. Read routes are `context`, `job?id=`, `source?sha256=` and `catalog?sha256=`. POST routes are the mutation names above plus `action`, `stop`, `source/fetch`, `source/import`, `catalog/import`, `scan`, `delivery/download` and `handoff/download`. HTTP `action` adds `kind` to the CLI action input; `stop` uses only the external ID and active operation ID. Source and catalog browser imports carry `contentBase64`, with source acquisition metadata in `metadata`.

## Complete workspace backup and reopen

Finish or stop and reconcile active native work, then close the foreground application. Its close operation drains its owned actions before releasing the original library and state lease. Quiesce other original consumers of the selected operator state as required by the existing workspace recovery engine.

```sh
starforge inbox review-jobs backup \
  --state /private/customer-work/review-jobs \
  --state-root /private/customer-work \
  --out /private/archives/review-workspace-backup \
  --quiesced true \
  --pass-env SF88_BACKUP_PASSPHRASE
```

The passphrase is supplied through that named environment variable; it is not a command-line value or browser field. The command uses the original SF88/SF101 recovery implementation and includes the application state, native buyer, inbox and original operator selection. Its native completion record and subprocess result remain separate.

Verify the returned record hash through the original `WorkspaceRecovery.verify()`, then restore with `WorkspaceRecovery.restore()` using that same expected record hash and passphrase environment. The original authenticated archive determines its canonical state root. It does not relocate an arbitrary shared reservations database, overwrite a live root or initialize a replacement ledger. Follow the original workspace recovery procedure for removing a closed source only after a complete verified backup is retained.

Reopen with the original `--state` path after restore. The same external jobs, source snapshots, native intents, actions, request reviews, annotations and selected collection editions remain available. Do not recreate jobs or run their execution again to obtain a restored result.

## Persistence and operating boundaries

| Concern | Original or retained owner |
| --- | --- |
| Customer assignment, exact source row, named approval | Review-job metadata |
| Native request, ticket, execute attempt, complete result | Original Node Buyer and Inbox |
| Reservation, settlement, recovery and finalization | Existing original native operator |
| Resource verification and note history | Original resource library |
| Named revisioned delivery and recipient package | Original COL6 collections |
| Whole private workspace backup and restore | Original SF88/SF101 recovery |
| Host private web session and download slots | Original resource-library server |

Source imports support up to 4 MiB through the Node/CLI interface and approximately 2 MiB through the browser; native catalogs are limited to 1 MiB. Request bodies are limited to 1 MiB. Full native response files are limited to 64 MiB, with advertised larger files rejected before preparation. These are application limits, not truncation: accepted source and response files are retained and verified in full.

Each job permits up to 1,000 action records and 10,000 metadata events within a 1 MiB job record. The browser pages through jobs and preserves unsent field drafts while polling or switching assignments during the current page session. A page reload does not persist unsaved drafts.

The application source is permissively licensed consistently with the original runtime. Private source captures, job state, native account material, customer correspondence and backup passphrases are runtime inputs; they do not belong in a public source commit.

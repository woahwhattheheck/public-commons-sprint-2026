# Research preservation workbench

The workbench is the local operator application for reviewing a retained research
edition, preparing an Archivematica, RODA, Preservica or LIBNOVA transfer, and continuing
the same destination after a restart or complete workspace handoff.

It combines the existing preservation application with a browser interface.
Every destination selects an exact original source manifest and saved review.
The current catalogue can then advance while that destination continues from
its original frozen source.

## Start the application

Run from the operator application root, which contains the `research/` directory:

```bash
python3 -B research/preservation/workbench.py serve \
  --workspace /absolute/path/research-preservation \
  --port 8785
```

Open the local URL printed by the command. Python 3.11 or later and its standard
library are sufficient for the workbench. The application binds to
`127.0.0.1`; it serves its own HTML and JavaScript without a build step,
CDN, database service or package installation.

An existing preservation workspace opens directly. For a new workspace, use
**Overview → Receive original edition** and supply the source directory or
complete ZIP, the edition path within a containing ZIP when applicable, and
the producer organization/contact. Intake uses the same original-edition
reader as the command-line preservation application.

Choose the path containing the original edition's manifest, catalogue and
record files. A containing delivery archive may require an edition prefix.
The source parser validates that exact edition and preserves its native files.
The original source is copied into the workspace once.

The base application requires these source files:

- `research/preservation/preservation.py`, `roda.py`, `roda_client.py`, and
  their `README.md`, `RODA.md` and `RODA_REST.md` guides.
- `research/preservation/workbench.py`, `workbench.html`, `workbench.js`,
  this guide, and `cli.mjs`.
- `research/oai/oai_feed.py`.

Preservica adds its producer, client, `PRESERVICA.md` and
`PRESERVICA_PROVIDER_CONTRACT.md`. The complete export requires all four
Preservica members when any of them is installed. The destination selector
shows whether that provider's source is available.

LIBNOVA adds `libnova.py`, `libnova_client.py`, `LIBNOVA.md`,
`LIBNOVA_PROVIDER_CONTRACT.md` and `libnova-requirements.txt`. Its S3 client
uses the dependencies declared in that retained requirements file. They are
loaded only when the LIBNOVA client runs; installing its source does not
require those dependencies to open the workbench or use the existing RODA
and Preservica operators. The complete export and managed source binding
retain all five LIBNOVA files together.

### Credentials

Destination forms contain environment-variable names. Set the corresponding
credential value in the environment of the original server process before
starting a repository operation. Use the existing repository account and
tenant selected for the work.

For example, a Preservica configuration can refer to
`PRESERVICA_ACCESS_TOKEN`; a RODA bearer configuration can refer to
`RODA_ACCESS_TOKEN`. Enter the variable name in the configuration form.
The provider client resolves its value during execution. Tokens, passwords
and authorization headers are rejected as literal destination configuration
fields.

Refreshing the browser uses the same server process. To change its inherited
credential environment, finish the current operator action, stop the server
and start it against the same workspace with the updated environment. The
saved operation ID, source selection and provider journal remain in place.

## Open through Applications

Choose **Research preservation** in the existing Applications workspace and select
the retained runtime containing this workbench. Supply the original Python 3.11
or later executable and the preservation workspace path. The path can identify an
initialized or received workspace, or a new directory below an existing private
parent for the first source intake.

Use the private environment file for the original provider credential variable
names and values. Review shows the selected workspace, parent directory, native
source files and Python executable. An existing project's original source binding,
project file and preparation are checked by the maintained preservation reader.
For a new workspace, the review binds its uncreated path and existing parent.

Save the application, review Start, then Start and Open it. The managed command
calls this same workbench and original source/store implementation. The native
process checks the reviewed binding before and after opening its original
operator lease, and announces its actual workspace, source, Python, process and
instance. Applications reads that same announcement from the live local
`/api/launch` endpoint before retaining the Open address. It supports an assigned
port, a chosen nonzero port, and the canonical local address for port 80.

The **Overview**, **Records**, **Destinations**, **Delivery** and **Activity**
screens retain their existing source intake, saved review, frozen destination and
complete handover operations. Stop closes the listener and drains the original
request threads and current operator worker before releasing its existing
workspace lock. Repeated stop signals leave that same drain in progress.
Reopening uses the saved workspace and original destination journals.

The source-owned `preservation-workspace` command exposes the same original
Node-to-Python wrapper in an installed distribution:

~~~sh
starforge preservation-workspace --python /absolute/python3 \
  workbench binding --workspace /absolute/private/research-preservation
~~~

The binding command is a read of the original selected workspace, source and
Python. To launch it directly with that review, pass its returned `sha256`:

~~~sh
starforge preservation-workspace --python /absolute/python3 \
  workbench serve --workspace /absolute/private/research-preservation \
  --expected-binding ORIGINAL_RETURNED_SHA256 --port 0
~~~

The normal native `serve` command continues to work with the original arguments.
The explicit `--python` prefix selects the given existing interpreter; the
original `STELLAR_FORGE_PYTHON` environment variable remains available for direct
CLI use. The same binding and serve implementations travel with the complete
operator application's original source inventory.

## Review the complete source

**Records** shows the original record count, current inclusion decisions and
a searchable, paginated catalogue. Search identifiers, titles or creators.
Use `id:FULL_ORIGINAL_IDENTIFIER` to select an exact identifier.
Filters show all records, included records, excluded records, reviewed records,
or records with original source field issues.

Choose a record to inspect its original and reviewed Dublin Core side by side.
The detail view keeps the original work type, original resource rights, source
information and field issues visible.

To change a record:

1. Select whether the record is included.
2. Enter the reason for an exclusion or metadata correction.
3. Add the Dublin Core fields to correct. Each field contains a JSON array of
   strings, for example `["Corrected title"]` or
   `["First creator", "Second creator"]`. An empty array clears an editable
   field when the preservation profile permits that resulting record.
4. Select **Apply to review draft**.
5. Select **Save review** to retain the new immutable revision.

**Use original record** removes that record's draft decision, includes the
record and restores the source values. **Discard record edit** restores the
record form from the current review draft.

For a group of records, select the rows, enter the shared decision reason and
use **Include selected** or **Exclude selected**. Selection persists across the
current search pages until cleared. Each selected record receives its own
decision in the complete review.

The review note describes the revision as a whole. **Complete review JSON**
supports a prepared batch of decisions. Apply that JSON to the draft before
saving. The server validates its source identity, identifiers, field values,
reasons and resulting required metadata.

The application distinguishes the open record form, complete-review JSON
edits, the review draft and the saved revision. A pending record or JSON edit
must be applied or discarded before the complete review is saved. Preparing
a new destination, building a transfer or exporting the workspace requires
the review changes to be saved.

### Saving and concurrent changes

A review save carries the revision from which the draft was loaded. The
preservation application publishes a new immutable review and then advances
the current pointer. The browser retains edits made while that save is in
flight; those edits remain available for a subsequent save.

If another operator advances the same catalogue, the browser shows the newer
saved revision and retains the local draft. A conflicting save reports the
revision difference. **Reload saved review** deliberately replaces the local
draft with the current saved review. The application asks before discarding
unsaved browser edits.

The native review history contains all retained revisions and any complete
unpublished candidates from an interrupted save. The workbench's saved-review
selector follows the current published revision's original hash chain. It
offers those published revisions for a new destination or package without
rewriting the current catalogue. The native/API preparation path checks the
same original published ancestry. A complete unpublished candidate remains
retained for recovery and cannot be selected as a committed source revision.

A frozen historical snapshot retains the complete original review files,
including files committed later in the original catalogue. Within that frozen
view, its selected revision and preceding hash chain define the published
history; other retained review files do not advance the selected snapshot.

### Metadata scope

The payloads are the original OpenAlex bibliographic JSON records. The
preservation metadata describes these payloads as datasets with JSON format
and the original metadata licence. The described publication's type and rights
remain separate source fields. Editable fields preserve the stable original
work identifier. The existing preservation profile controls required titles,
field values, reasons and other metadata rules.

## Prepare and continue a destination

**Destinations** has two distinct views: an editable new-destination draft,
and the saved original operations. Selecting an existing destination leaves
the new-destination draft available when returning to it. Different providers
have separate drafts. A response from an earlier preparation cannot select
that operation over a destination or provider chosen later, or discard
fields typed after the original request. The completed operation remains
in Saved destinations with its original ID.

For a new destination:

1. Select RODA, Preservica or LIBNOVA.
2. Choose the current saved review or a specific earlier published revision.
3. Enter a useful operator label and the original operation ID.
4. Complete the provider settings, repository configuration and, for RODA,
   the actual ingest job template.
5. Select **Prepare saved destination**.

Preparation validates the entered configuration, saves its exact request,
receives the selected source/review into a separate frozen workspace, builds
the destination package and saves the provider plan. The provider run is a
separate operator action.

An operation ID contains 1–96 letters, digits, underscores or hyphens, beginning
with a letter or digit. Its saved source, settings and configuration are
immutable. Reusing the same ID with different choices returns a conflict.
Continuing the original preparation uses the original saved choices.

A saved destination shows its source manifest, review revision, original
transfer and ingest identifiers, provider state and retained progress. The
detail sections expose the actual prepared package and configuration.

### RODA

The RODA draft includes the submission agreement, repository API configuration
and complete ingest job template. Use the current deployed RODA agreement and
job parameters; the existing RODA client validates its supported contract.

**Continue original transfer** runs the existing upload/ingest workflow.
**Check repository progress** reconciles the original operation through
provider reads. **Continue original preparation** resumes the original local
package and plan if preparation was interrupted.

When the repository accepted an original request but its response was lost,
open **Reconcile an original request** and enter the original transfer UUID
and/or job ID. The client checks those identifiers against the original
transfer and configured ingest operation. Its complete transfer, job and
report history remains in the prepared workspace.

The RODA client may hold its workspace lock while a provider call is active.
During that action, the workbench keeps the selected original operation
visible and shows its active job. Full provider details refresh when that
action returns.

See [RODA.md](RODA.md) for package preparation and [RODA_REST.md](RODA_REST.md)
for the deployed REST contract and original-request recovery.

### Preservica

The Preservica settings include the collection title, description, security
tag, source-ID namespace/policy and selected OPEX/deployment version. Its
configuration selects the tenant origin, tenant identifier, actual target
version, token environment name, optional parent reference, upload mode,
part size, request timeout, response limit and readback batch size.

The package uses the reviewed source records, complete OPEX structure and
their original fixity. Its source identities bind the original edition and
saved review. The client derives the immutable bucket/object selection from
the saved tenant and operation.

**Continue original transfer** performs the required upload and ingest
continuation. It supports single and multipart uploads and retains original
requests, upload IDs, parts, response observations and progress tokens.
When the repository is ready, the client checks every included record across
its configured readback batches within the same run. Batch size controls the
request size; it does not require an operator click for each batch.

The local progress view reads the atomically published client state while
the original operation runs. It shows upload/ingest progress and verified
record counts without issuing repository requests. **Check repository
progress** explicitly performs the provider observation.

For an uncertain original request, the reconciliation editor offers the
client's three actual evidence templates:

| Evidence | Original information required |
| --- | --- |
| Retained HTTP response | Original action, exact request SHA-256, status, retained response headers/body, observation time and source description |
| Upload progress observation | Exact original action/request, bucket/object key and originally observed progress token |
| Ingest process observation | Explicitly observed original process identifier and source description |

Select the original upload action when using a response or progress
observation, then load its template. Known values are copied from the saved
operation. Replace the remaining template values with the original response
or observation. The provider client validates the exact request binding
before continuing.

The provider's detailed source-ID/entity, parent, metadata and bitstream
checks determine complete receiving. The client preserves process
observations alongside those records. See [PRESERVICA.md](PRESERVICA.md) and
[PRESERVICA_PROVIDER_CONTRACT.md](PRESERVICA_PROVIDER_CONTRACT.md) for the
supported deployment contract and complete command-line operations.

### LIBNOVA

The LIBNOVA destination begins with the exact selected source manifest and
published review. Preparation freezes that source, builds its original
BagIt package through the existing preservation producer, and calls the
LIBNOVA producer with the entered descriptor mapping. It then saves the
client plan under the same original operation ID. These preparation steps
do not contact a tenant.

**LIBNOVA Dublin Core descriptor mapping** contains the provider's actual
mapping template:

- Each row names a reviewed Dublin Core field, an existing descriptor
  `iecode`, and one of `STRING`, `LONGSTRING`, `NUMBER`, `DATE` or `BOOL`.
- Replace the example descriptor codes and types with those from the
  agreed existing target schema.
- The mapping is normalized and validated before the saved destination
  is published. Type conversion and repeated-field rules are enforced by
  the original producer.
- Unmapped Dublin Core values remain in the unchanged BagIt package.

The receiving configuration selects the existing LIBNOVA deployment,
container, schema, storage and Function required by the actual client.
Load the provider's current configuration template, enter the agreed
identifiers and environment-variable references, and retain the same
configuration for every continuation. The workbench does not create a
tenant, container, schema, storage selection or Function.

The initial bibliographic profile permits at most 1,000 included metadata
records and 1 GiB of source/export material. These limits describe the
implemented research profile. A customer's deployment and accepted sample
still determine the scoped receiving agreement. The original 169-record
CC0 source example is available to the complete receiving workflow.

After preparation, select the saved LIBNOVA destination. Its original
source selection, mapping, configuration and package identity are shown
alongside the saved client state.

| Control | Action on the saved LIBNOVA operation |
| --- | --- |
| Continue original transfer | Execute the original client plan and continue its retained file, metadata and Function workflow |
| Check repository progress | Read the original remote objects and job, retaining the resulting observation without dispatching another Function |
| Continue original preparation | Reopen the exact frozen review, original BagIt and existing offline client plan |
| Reconcile original operation | Bind an originally returned Function response or job ID to the already-started Function and read that original job |

The browser reads the client's atomically published local state while an
action is running. That status call validates the immutable saved operation
and package binding, acquires no provider-operation lock and performs no
network request. A browser refresh therefore displays retained progress
without starting another provider observation.

For lost Function responses, open **Reconcile an original request**, choose
an evidence type and select **Load original evidence template**. The
template comes directly from the installed client.

| Evidence kind | Entered original evidence |
| --- | --- |
| `original-function-response` | The retained response containing `container_id`, `file_id`, `job_id`, `file_path` and `event_key`, plus its explanatory note |
| `original-job-id` | The original `jobId` and a note identifying that retained evidence |

The client checks the evidence against the already-started Function and
the selected container/folder, then reads the same job. Reconciliation
does not launch a replacement job. For unresolved file upload or metadata
readback, use **Check repository progress**; these observations do not
require Function evidence.

The original BagIt ZIP and prepared source review appear in **Delivery**.
Once the client publishes `VERIFIED`, the same list adds the original
receiving JSON and HTML report. The Workbench checks the JSON's saved
size, SHA-256, operation, package, job and summary before registering it.
The complete progress panel retains the provider's original state object;
the summary shows original container/schema/storage/Function IDs, current
object and record counts, original job result, verified source bytes and
mapped metadata, and the final evidence digest.

If the client finished before a local artifact-list write was interrupted,
**Continue original preparation** reopens the same offline plan and
registers its already-published receiving files. It performs no provider
request. **Check repository progress** performs a fresh read-only observation
of the original operation when that is desired.

The complete Workbench export includes the prepared LIBNOVA workspace,
saved mapping, configuration, original operation and complete retained
request/readback history, together with the actual producer, client,
dependency declaration and guides. The provider CLI also exposes its own
complete workspace export and receive commands in
[LIBNOVA.md](LIBNOVA.md). Use
[LIBNOVA_PROVIDER_CONTRACT.md](LIBNOVA_PROVIDER_CONTRACT.md) for the precise
existing-deployment API, job association and content-verification rules.

LIBNOVA `plan`, `run`, `refresh` and `reconcile` hold the prepared workspace's
original `.libnova.lock` for their full mutation or observation. The
Workbench complete exporter holds that same lock while copying the saved
prefix. Only the known runtime lock in the prepared workspace and the
provider's output-publication lock beside it are omitted from the portable
snapshot; original BagIt and journal files remain included.

## Deliver and receive the complete application

**Delivery** can build an Archivematica transfer from a chosen saved review.
The prepared RODA and Preservica transfer ZIPs appear in the same delivery
table when their original destination preparation finishes. LIBNOVA adds
its original BagIt ZIP and prepared source-review HTML to that table, then
the verified receiving report and original JSON evidence.

Every delivery row includes its package kind, original review/operation,
size and SHA-256. Downloads stream the retained original file after checking
its saved identity.

**Export complete workspace** includes:

- The original core workspace and native source records.
- All retained review history and the current saved review.
- Every saved destination selection, configuration, frozen source, prepared
  package and original provider journal.
- Retained generated packages and complete local activity history.
- The complete application source and all required provider/operator guides.
- A manifest with each included file's exact size and SHA-256.

The server and provider runtime lock files are recreated when needed.
Earlier complete-export ZIP files are recorded by identity and omitted from
the next ZIP to avoid recursively packaging prior complete snapshots. Those
earlier identities remain visible after receiving.

The export holds the core workspace lock and the prepared provider
publication locks while inventorying and copying their files. Every member
is streamed, checked against its source identity and validated again through
the resulting archive. The final ZIP is published atomically.

Receive a complete export using an installed trusted copy of the receiver:

```bash
python3 -B research/preservation/workbench.py receive \
  --source /absolute/path/Research_Preservation_Complete_JOB.zip \
  --output /absolute/path/received-research

python3 -B /absolute/path/received-research/application/research/preservation/workbench.py serve \
  --workspace /absolute/path/received-research/workspace \
  --port 8785
```

The receiver checks the full archive inventory, member types, file hashes,
application closure and original source/review before atomically publishing
the received directory. It holds the originally opened archive while
receiving and detects changes to that file. Source code from the archive is
retained for the subsequent explicit server start.

Receiving the same original ZIP into its previously received directory
checks the original receipt, source binding and application bytes, then
reuses that directory. Later saved review decisions and migration progress
in that received workspace remain in place.

A complete snapshot records the local activity at the moment of export.
An in-progress queue entry retained in the snapshot is marked interrupted
when that copy is opened. Continue the saved original destination or original
preparation from its existing journal. A newly received copy uses its own
server process, port and runtime lock.

The current receiving profile permits at most 100,000 archive members,
2 GiB per member and 8 GiB of total uncompressed data. Individual provider
profiles and a scoped commercial delivery may use smaller source limits.

## Workspace layout and operation history

For a workspace named `research-preservation`, the adjacent operator
directory is `research-preservation.operator`.

| Path | Purpose |
| --- | --- |
| Core `project.json`, `prepared.json`, `source/` | Original edition and preparation |
| Core `current.json`, `reviews/` | Current saved selection and retained revision history |
| Operator `jobs.json` | Complete local queue and outcomes |
| Operator `artifacts.json` | Retained delivery file identities |
| Operator `packages/` | Frozen saved reviews and their Archivematica packages |
| Operator `operations/ID/selection.json` | Immutable destination/source/configuration selection |
| Operator `operations/ID/source/` | Exact frozen original source/review |
| Operator `operations/ID/prepared/` | Native provider package, plan and journal |
| Operator `deliveries/` | Complete workspace export ZIPs |

One server process owns the operator workspace lock. A second server for the
same operator workspace receives an explicit ownership error. The server
allows one queued package, destination, provider or export action at a time.
Record review can advance independently of a saved destination's frozen
source. Closing the server waits for its started worker before releasing
the operator lock.

**Activity** shows the latest 100 jobs and the total retained count. Each job
has its original ID, action, arguments, timestamps and outcome. A job's error
and any problem retaining its final outcome are visible in that same entry.
The complete file remains in the exported operator workspace.

## Local API

The browser uses this same local API. A state read returns a per-process
`csrf` value; JSON mutations send it as `X-Workspace-Token`.
Host/origin checks restrict the application to its printed local origin.

| Method and route | Result or action |
| --- | --- |
| `GET /api/state` | Workspace status, saved review ancestry, provider templates, destinations, jobs and artifacts |
| `GET /api/review` | Current original source/review selection and complete saved review |
| `POST /api/preview` | Validate and preview a complete draft with query/filter/offset |
| `POST /api/review` | Save the complete review with its expected original revision |
| `POST /api/init` | Queue original edition intake |
| `POST /api/package` | Queue a package from an exact saved selection |
| `POST /api/prepare` | Save and prepare the complete original destination request |
| `GET /api/migration?id=ID` | Inspect one saved original destination |
| `POST /api/resume-preparation` | Continue its original saved package/plan |
| `POST /api/run` | Continue the same original provider operation |
| `POST /api/refresh` | Observe original repository progress |
| `POST /api/reconcile` | Reconcile original provider request evidence |
| `POST /api/export` | Export the complete current saved workspace |
| `GET /download?id=ARTIFACT_ID` | Download a retained original artifact |
| `GET /review` | Open the saved preservation review report |

Queue responses return the actual job ID. Read that job through
`/api/state` and its saved original destination through
`/api/migration` to continue after a disconnected browser. Reopening
the same workspace resumes from retained local state.

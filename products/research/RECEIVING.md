# Install and receive the complete Research workspace

This guide takes the maintained Research product from its original Git source to an installed application, reviewed source editions and citation decisions, original Documents and managed Pipelines, complete delivered files and a reopened research dossier. Use the same customer workspace, configured source directories and operation identities throughout an upgrade or restart.

The [operating guide](OPERATING.md) is the analyst-facing workflow. The [Documents and Pipelines contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_DOCUMENTS.md) gives complete SDK, command, merchant and request fields. Original provider configuration belongs to the [Documents source](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/UNSTRUCTURED.md) and [managed Pipelines source](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/UNSTRUCTURED_PIPELINES.md).

## 1. Build the complete selected source

Use the existing repository containing the full source commit. The normal builder reads the committed recipe and selected source-owned registrations, follows their static imports and browser maps, and retains the complete declared component directories.

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --ref FULL_SOURCE_COMMIT \
  --selection research-workspace \
  --out /absolute/research-release
~~~

The selection is [research-workspace.json](../../stellar/scf-starforge-20261009/distribution/selections/research-workspace.json). It keeps the existing Research application, complete dossier/source stores, Documents and managed Pipelines backends, original buyer/merchant runtime, native provider interfaces, browser assets, client, CLI, operating guides and file receivers. The package retains its own source manifest and exact recipe/contribution identities.

Use Node 22.16 or newer as required by the maintained distribution. Choose a new release output for another source commit. After an interrupted build, continue the original output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace-checkout \
  --out /absolute/research-release --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/research-release --status
~~~

An omitted selection on resume inherits the saved selection. A different explicit selection cannot reuse that output. A completed build returns its original verified archive. Use the actual archive path, digest and source identity returned by this operation for receiving; retain that result beside the release.

## 2. Install its original runtime profile

The complete Documents/buyer, Pipelines and merchant receiving edition uses the maintained native, schema, OpenAPI, MCP and operator profile:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/research-runtime \
  --archive /absolute/research-release/RETURNED_ARCHIVE.tgz \
  --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/research-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/research-runtime --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/research-runtime -- source
~~~

Substitute the actual build result for both archive fields. The selected source controls the dependency profile and original lock. Installation reuses the maintained cache, native probes, partial-install recovery and READY state. An equipped host can adopt an existing complete dependency tree with the original `--adopt-existing` option when it satisfies the selected profile and lock.

Register this READY runtime in the existing Runtime workspace. Select **Applications → Research dossiers**, review its saved configuration, start the existing application and open its returned URL. The original Applications controller owns the process and its stop/reopen lifecycle.

The installed entry is `starforge`. Inspect the included registrations and document commands:

~~~sh
starforge registrations --command research-client
starforge research-client documents-help
~~~

The [runtime installation guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) covers the installer and runtime workspace. The [source-selection guide](../../stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md) covers source acquisition, exact manifests and output recovery.

## 3. Bind the original customer and provider state

Keep customer data, provider credentials, connection files and original input documents outside the source checkout and installed release. Adopt the actual existing paths from the receiving operator.

| Original state | Research Applications field | Purpose |
| --- | --- | --- |
| Dossier directory | `workspaceDirectory` | Saved questions, editions, findings, selections and history |
| Private startup/connection record | `connectionFile` | The running application's authenticated URL and identity |
| Configured document source file | `documentSourceConfig` | Original document buyer/purchase state and source configuration |
| Configured pipeline source file | `pipelineSourceConfig` | Profiles, provider connection, retained jobs and original operation directory |
| Existing object-source directory, when used | `objectStateDirectory` | Original object-source state |
| Existing Crossref state/config, when used | `crossrefState`, `crossrefConfig` | Saved acquisition plans, source editions and transport state |
| Existing OpenAlex source, when used | `openalexWorkspaceDirectory`, `openalexModule` | The host's original source workspace and module |
| Original edition adapter, when used | `editionAdapter` | The configured source-edition integration |

The existing Applications provider checks the selected application and source workspace identities against these private files. Preserve the original provider workspace and customer dossier when choosing a new installed code release.

For a directly owned Research process, the equivalent command is:

~~~sh
starforge research-workspace \
  --dir /srv/starforge/research \
  --connection-file /srv/starforge/private/research-connection.json \
  --document-source /srv/starforge/private/document-source.json \
  --pipeline-source /srv/starforge/private/pipeline-source.json
~~~

Use this direct command only when that process is the selected operating route. An existing Applications instance continues through its original controller. The connection record contains its private bearer URL.

Attach the client to the same saved listener and directory:

~~~js
import {ResearchWorkspaceClient} from
  '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers/client';

const client = new ResearchWorkspaceClient({
  connectionFile: '/srv/starforge/private/research-connection.json',
  directory: '/srv/starforge/research',
});
try {
  const current = await client.status();
  const documents = client.documents();
  const pipelines = client.pipelines();
  // Operate the returned original workspace and the selected saved dossier.
} finally {
  await client.close();
}
~~~

The client rereads the connection file for each request and verifies the original workspace. Closing it drains that attachment while Applications continues to own the listener.

## 4. Receive an original document into its question

Open the existing dossier, read its current question and revision, then list completed purchases and received document editions:

~~~sh
starforge research-client documents-list \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id ORIGINAL_DOSSIER_ID
~~~

Continue the returned `nextAfter` cursor when present. Select one actual purchase or received edition; review the complete edition hash, original document metadata, processing parameters, warnings and native response.

| Command | Input |
| --- | --- |
| `documents-review` | A selection object with exactly one `purchaseId` or `editionId` |
| `documents-elements` | `selection`, `expectedEditionSha256` and optional `offset`, `limit`, `page`, `type`, `query` |
| `documents-receive` | `selection: {purchaseId}`, `questionId`, `label`, `expectedEditionSha256`, reviewed dossier `expectedRevision` |
| `documents-download` | Reviewed selection/digest and `kind`: document, response or edition; new destination in `--out` |

Each command uses the same connection, directory and dossier flags. Supply its exact JSON request with `--input`. Review all needed original elements through the returned `nextOffset` before receiving the edition. Repeating the original receive binding after a lost reply reopens the saved result. An already received document stays available for review and download after its former source disconnects.

## 5. Prepare and continue the same managed Pipeline

Read `pipelines-list` for configured profiles, source limits, existing operations and received editions. Select the actual profile and question. A preparation request consists of:

| Field | Retained value |
| --- | --- |
| `requestId` | The original preparation request identity |
| `profileId` | A profile returned by the configured source |
| `questionId`, `label` | The selected existing question and useful processing label |
| `expectedRevision` | The reviewed dossier revision |
| `files` | Ordered original file paths and complete lowercase SHA-256 values, with optional filename/media type |

~~~sh
starforge research-client pipelines-prepare \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id ORIGINAL_DOSSIER_ID \
  --input /srv/starforge/private/original-pipeline-preparation.json
~~~

Relative input paths resolve against that JSON file's directory. The client reads the configured limits, hashes every file, streams from those same descriptors and verifies the bytes before completing the request. The workspace's maximum is 32 files and 32 MiB of source bytes; a configured profile may use lower limits. Retain the exact preparation and files with the returned plan ID/hash and operation revision.

Read the operation before advancing it:

~~~sh
starforge research-client pipelines-operation \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id ORIGINAL_DOSSIER_ID \
  --operation ORIGINAL_OPERATION_ID
~~~

| Action | Required native request values |
| --- | --- |
| Submit | Original action request ID, current operation revision, original plan hash |
| Refresh | Observation request ID and current operation revision |
| Cancel | Action request ID, current operation revision and reason |
| Provider jobs | Optional workflow ID and status filters |
| Reconcile | Action request ID, current operation revision, original plan hash, matched provider job ID and reason |
| Retain output | Action request ID, current operation revision, advertised provider file ID and optional node ID |

Use the corresponding `pipelines-submit`, `pipelines-refresh`, `pipelines-cancel`, `pipelines-provider-jobs`, `pipelines-reconcile` and `pipelines-retain` commands with `--operation` and the original JSON in `--input`.

The request ID identifies one exact action. Preserve that ID/body after a lost response. A later observation gets its own ID and the newly reviewed operation revision. If submission is uncertain, inspect the retained operation and the actual provider inventory, match the original job and reconcile that job ID into the same operation. Its original plan and files remain the processing authority.

Retain a file from the operation's returned `outputOptions`. The native source saves the complete output and returns its original output identity, byte count and digest. Review it with `pipelines-review` using `{operationId, outputId}`; a received edition can instead be selected by `{editionId}`. Inspect its elements with the original edition digest before receiving it into the question.

The `pipelines-receive` request retains `selection`, its original `requestId`, `expectedEditionSha256`, `questionId`, `label` and the reviewed **dossier** revision. The source operation's revision belongs to lifecycle actions, starting at zero; the dossier revision belongs to preparation and receiving, starting at one.

## 6. Operate through the existing merchant

The original Research merchant provider uses the same configured listener. A private connection file can declare exact pipeline inputs:

~~~json
{
  "schema": "stellar-forge.research-workspaces.v1",
  "workspaces": {
    "research": {
      "label": "Research desk",
      "consoleUrlFile": "/srv/starforge/private/research-connection.json",
      "directory": "/srv/starforge/research",
      "sources": {
        "original-document": {
          "kind": "pipeline-input",
          "file": "/srv/starforge/customer/original.pdf",
          "sha256": "REVIEWED_COMPLETE_LOWERCASE_SHA256",
          "filename": "original.pdf",
          "contentType": "application/pdf"
        }
      }
    }
  }
}
~~~

Replace the file and digest with the actual reviewed input. Keep this configuration private. Initialize or attach the existing merchant using the maintained provider:

~~~sh
starforge merchant-mcp init-research-workspaces \
  --dir /srv/starforge/research-merchant \
  --connection /srv/starforge/private/research-workspaces.json

starforge merchant-mcp serve \
  --config /srv/starforge/research-merchant/merchant-mcp.json
~~~

An already configured merchant can keep its original `researchWorkspaceConnection`. Every Research tool selects the declared workspace alias and original dossier ID. Preparation names declared inputs in `inputSources`; the host resolves their complete original file selections.

The four Documents tools cover list, review, elements and receive. The twelve Pipelines tools cover list, prepare, operation, submit, refresh, cancel, provider jobs, reconcile, retain, review, elements and receive. The ordinary Research question, finding, Crossref, source inspection, ClinicalTrials and export operations stay on that same attachment.

## 7. Deliver complete files and reopen the dossier

The local client and merchant retain these complete file kinds:

| Original file | Merchant export kind | Client |
| --- | --- | --- |
| Document bytes | `document-file` | Documents download, document |
| Native Partition response | `document-response` | Documents download, response |
| Complete document research edition | `document-edition` | Documents download, edition |
| Original pipeline input | `pipeline-input` | Pipeline input download |
| Retained provider output | `pipeline-output` | Pipeline output download |
| Received pipeline output | `pipeline-received-output` | Pipeline received download, output |
| Complete pipeline research edition | `pipeline-edition` | Pipeline received download, edition |

Document and received-edition exports carry their reviewed selection and complete edition hash. Original pipeline input/output exports use their returned operation and input/output IDs. Each local destination is new; the receiver returns the actual published path, filename, media type, byte count and SHA-256 after the complete stream is retained.

The original merchant export ledger retains these bytes under the returned export identity. If an expected digest differs, the completed file remains with its actual digest and verification result. Read the retained receipt and inspect those bytes. A lost export reply can be recovered with `merchant_research_exports`; continue `merchant_research_file_read` with its actual read ID and next offset.

Export the readable report and complete portable dossier:

~~~sh
starforge research-client export \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id ORIGINAL_DOSSIER_ID \
  --format html --out /srv/starforge/delivery/research.html

starforge research-client export \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id ORIGINAL_DOSSIER_ID \
  --format json.gz --out /srv/starforge/delivery/research.research.json.gz
~~~

Retain both returned file receipts with the original source files, operating guide and source release identity. The portable carries the saved questions, received source editions, evidence selections, authored findings and revision history.

On the customer's selected receiving workspace:

~~~sh
starforge research-client reopen \
  --connection-file /srv/starforge/private/receiving-research-connection.json \
  --directory /srv/starforge/receiving-research \
  --source-file /srv/starforge/delivery/research.research.json.gz \
  --sha256 RETURNED_PORTABLE_SHA256
~~~

Use the actual portable digest. Inspect the returned dossier, original question, received document or pipeline edition, findings and history. Download a retained original file from that received edition and compare its complete digest to the delivered receipt. Keep the provider's retained source-operation directories in their established backup so processing can continue with its original job IDs as well as through the received research edition.

## 8. Receive the complete Python Analysis and workbook

Use the buyer Python package and Node source from this same selected release. The recipe retains the complete original buyer Python/Analysis modules; the Python bridge uses the original Node Research client and the source-owned Analysis database, export, workbook and archive implementations.

Python requires version 3.11 or newer. In the customer's selected Python environment, install the original package and its workbook extra:

~~~sh
python3 -m pip install \
  '/absolute/installed-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[workbooks]'

stellar-forge-research --help
~~~

The extra supplies the original pinned `openpyxl==3.1.5`. The installed Python command and the Node checkout are separate paths to the same release: a Python wheel contains its Python modules, while `--checkout` selects the matching complete Node/Analysis source. Preserve the existing environment when it already contains this exact package and required dependencies.

The source-owned live client exposes `ResearchWorkspace`, `ResearchDocuments`, `ResearchPipelines`, `ResearchSelection`, `ResearchInputFile` and `ResearchDocumentSource`. It keeps the original connection path, returned workspace identity, each exact request and native result in its private caller directory. Its `calls`, `call-record` and `resume` commands recover those original calls. A completed native reply received during local cancellation remains retained with its interruption metadata.

A received original edition is also sufficient for the complete analytical workflow. It requires the actual file SHA-256 and the native reviewed edition digest; those values can differ because file serialization and the verifier's canonical identity are separate bindings.

For an interactive handover, first prepare the original mapping:

~~~sh
python3 /absolute/installed-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_document_workbook.py \
  --checkout /absolute/installed-source \
  --directory /srv/starforge/customer/document-analysis \
  prepare --edition /srv/starforge/delivery/received-edition.json \
  --file-sha256 RETURNED_EDITION_FILE_SHA256 \
  --edition-sha256 REVIEWED_NATIVE_EDITION_SHA256 \
  --title "Received document elements"
~~~

Read the actual retained source, every declared column, mapping preview, sample, row count, native preview hash and any source warnings. Finish that same operation using the reviewed preview digest:

~~~sh
python3 /absolute/installed-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_document_workbook.py \
  --checkout /absolute/installed-source \
  --directory /srv/starforge/customer/document-analysis \
  finish --preview-sha256 RETURNED_NATIVE_PREVIEW_SHA256
~~~

The source's `receive` command combines these steps when the operator selects the shipped occurrence mapping in that call. An incomplete source keeps its original completeness status; `--allow-incomplete` records that explicit mapping/import choice.

The receiver runs the original source registration, mapping preview/import, immutable version activation, saved query and complete typed export. It then uses the actual completed query-export identity to produce the native workbook and workbook handoff, exports the full Analysis workspace, and cold-restores it using the original archive receiver.

| Retained path beneath the customer operation | Complete delivery |
| --- | --- |
| `operation.json`, `records/` | Source selections, native requests, decisions and receipts |
| `source/source.json`, `source/files/` | Original edition, document/response or job output, complete occurrence CSV and attribution |
| `analysis/` | Original immutable table, view choices, saved SQL, jobs and output state |
| `deliveries/query/rows.jsonl`, `rows.csv`, `rows.sqlite3` | Complete typed rows with full text and provider metadata |
| `deliveries/workbook/workbook.xlsx`, `handoff.zip` | Every occurrence, explicitly labeled text previews, typed sources and workbook definition/history |
| `deliveries/workspace/workspace.zip` | Full original Analysis workspace and registered source-document revisions |
| `restored-analysis/` | Same-archive offline receiving target |

The source CSV has eighteen columns and preserves repeated provider element IDs through a separate one-based occurrence. Full text, page value, metadata and provider record remain separate original/JSON-text columns. The workbook uses an explicit safe preview and its completeness/character-count fields; complete text and metadata remain in the typed exports and source archive.

Reopen the completed receiving operation:

~~~sh
python3 /absolute/installed-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_document_workbook.py \
  --directory /srv/starforge/customer/document-analysis reopen
~~~

Its cold reader checks the original workspace ID, immutable table row count, saved query digest, typed-row file, workbook and registered source files. Preserve the original operation directory and returned archive identity on restart. Native incomplete jobs retain their original state and IDs for their existing operator; the receiver's completed path verifies and reopens its saved deliveries.

The complete [Python operating contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_DOCUMENTS.md) includes original source limits, lossless large-file parts, reconstructed file roles, live Document/Pipeline actions, all runtime recovery states and the standalone `restore_archive` interface.

## 9. Receive the citation-review product

The same Research selection includes the full citation-review engine, browser, authenticated client, Merchant tools and portable receiver. Its installed commands also include `research-crossref-documents` and `research-citation-workflow`. The selected source contains the complete operator guides and the original five-file Crossref example. Keep the original source archive and release identity with the receiving product.

For a customer's existing dossier, open **Update review** in the original running Research workspace and follow the [analyst workflow](OPERATING.md#review-registered-citation-updates). A received source edition supplies the registered notices and their original records. The review saves explicit evidence and finding changes together; its original request and resulting revision stay in the same dossier history.

### Receive retained original Crossref documents

A complete metadata edition can be built from existing original source documents and their observed transfer provenance. The source-owned builder reads every declared input, verifies its full hash, and retains the original bodies and source URLs. The [Crossref document guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CROSSREF_DOCUMENTS.md) defines the complete provenance and source roles.

The selected release includes the original work, retraction notice, registered-updates list, provenance and source note beneath:

~~~text
stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/
  examples/crossref-retraction-1758835919874651/
~~~

Select the installed source directory and create its full edition:

~~~sh
CITATION_INPUT=/absolute/installed-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/examples/crossref-retraction-1758835919874651

starforge research-crossref-documents \
  --provenance "$CITATION_INPUT/provenance.json" \
  --source-dir "$CITATION_INPUT" \
  --query "How does the registered retraction affect this cited work?" \
  --doi 10.1177/1758835919874651 \
  --doi 10.1177/17588359211061903 \
  --updates-doi 10.1177/1758835919874651 \
  --supporting README.md \
  --output /srv/starforge/inputs/crossref-document-edition.json
~~~

Keep the returned complete file identity with the edition. The original Research receive command or declared source handle can receive these exact bytes into the selected question. Original document transfer details remain available after receiving, including fields that the upstream representation did not expose.

### Reopen selected citation reports and history

Select the saved review's original, reviewed or current revision before exporting. The same installed client accepts `--revision` for HTML, Markdown, JSON and compressed JSON. The existing Merchant export tool accepts that same revision and retains its complete file under the original export identity. Recover that identity through the existing export inventory after an interrupted reply.

Receive the selected portable with the original `research-client reopen` command in section 7 and its complete returned SHA-256. Both JSON and compressed JSON carry the original source editions and saved review history. The original importer validates the review changes against their earlier source/evidence/finding state before publishing the received dossier.

The complete prepared native journey is available through `research-citation-workflow`. It accepts the original edition file and SHA-256, a persistent customer run directory, operation identity and the actual installed Playwright/Chromium runtime. Its full [source contract and commands](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CITATION_REVIEW.md) cover two questions, browser drafts and concurrent review, interrupted-save recovery, original/reviewed/current report selection, the same Merchant attachment, complete exports and cold receiving of both portable formats.

Retain the original run directory and operation identity on restart. The workflow's completed result names the original dossier/review revisions and each complete selected output. Deliver those files with their reported identities. Original connection records, browser profiles and source/workspace directories retain their established private custody; the existing application owner controls its listener lifecycle.

## 10. Receive the complete Python citation analyst

The selected source includes all original Python/Analysis modules and the new
citation client, CLI, full draft/request editor, portable delivery and customer
receiver. Install the buyer Python package from this same source as described
in section 8. Use its existing `workbooks` extra for the full workbook path.

After the original citation-review workflow in section 9 has completed and
closed its listener, continue that same workspace:

~~~sh
starforge research-citation-python-receive \
  --existing-run /srv/starforge/customer/original-citation-review \
  --directory /srv/starforge/customer/python-citation-analyst \
  --checkout /absolute/installed-source \
  --python /absolute/existing/python3 \
  --operation-id ORIGINAL_PYTHON_CONTINUATION_ID \
  --with-workbook
~~~

Select actual original paths and a stable receiving operation ID. The command
reads the completed original result and selected review, starts the same
Research listener under its original lock, and invokes the complete Python
analyst. It verifies the original saved request before recovering it, then
retains twelve revision-specific exports, proves both portable readers, produces
the original Analysis/SQL/typed/workbook/archive outputs and cold reopens the
full customer handover.

The returned `complete.json` records source, workspace, review, request, selected
revisions and all original artifact byte counts and SHA-256 values. Its
`Citation_Analyst_Complete_Handover.zip` includes the selected reports and complete
portable history, exact received request bytes, full analytical outputs and
editable Analysis workspace ZIP. Private connection files and browser profiles
remain outside this selection.

A received customer can use `citation-unpack` with the exact whole ZIP digest,
then `citation-receive` with the matching Node source. Existing identical files
are reused; different customer files are preserved and reported. The original
portable readers validate source bodies and replay each saved review from its
original previous state.

The [full Python citation operating guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_CITATIONS.md)
also covers an ordinary live analyst: pinned notice/detail reads, complete JSON
request editing, explicit draft revisions, exact saved-request recovery and
standalone export/receive/workbook commands. A known completed receiving operation
returns its original verified receipt; an interrupted original native job stays
with its existing owner and output selection.

## 11. Receive the interactive Analysis and native agent workflow

The complete `research-workspace` selection includes the Analysis Research
intake, its original browser, all eight native MCP actions and the complete
browser/workbook receiving programme. Install the original Python workbook extra
from this same release as in step 8. Use the actual selected Node, Playwright and
Chromium installations on the receiving Linux host; the programme starts its
original Analysis service and browser together and keeps their temporary files
inside the explicitly selected private temporary root.

The source must already be a saved Documents purchase/edition or a retained
Pipelines output/edition in the existing Research workspace. Prepare the private
connection registry described in
[the operating workflow](OPERATING.md#use-the-original-analysis-browser-and-native-agent).
Select the actual source through the original review endpoint or browser and
retain a JSON selection with these exact fields:

| Field | Original value |
| --- | --- |
| `connection` | A name from the launcher-selected Research registry |
| `expected_workspace_id` | That connection's actual `research_<64 hex>` identity |
| `dossier_id` | The existing `d_<UUID>` dossier, retaining its UUID hyphens |
| `family` | `documents` or `pipelines` |
| `selection` | Documents: `{purchaseId}` or `{editionId}`; Pipelines: `{operationId,outputId}` or `{editionId}`, with the actual returned IDs |
| `expected_edition_sha256` | The complete edition digest returned by that exact source review |
| `name` | `document_elements`, the original receiving programme's source/view name |
| `title` | The reviewed source title, at most 160 characters with no control characters |

These fields are a source selection, not a provider submission. Keep the complete
selection and registry in the private receiving operation. The registry retains
only the source connection path and identity; the existing connection file owns
its capability.

Run the complete original receiving programme against that exact saved source:

~~~sh
python3 /absolute/installed-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_intake_workbook.py \
  --directory /srv/starforge/customer/research-analysis-receiving \
  --checkout /absolute/installed-source \
  --research-connections /srv/starforge/private/analysis-research-connections.json \
  --node /absolute/runtime/bin/node \
  --playwright /absolute/runtime/node_modules/playwright/index.mjs \
  --chromium /absolute/runtime/chrome-headless-shell \
  --temporary-root /dev \
  receive --selection /srv/starforge/private/reviewed-analysis-source.json
~~~

Use an existing writable process-private temporary root appropriate to that
host. The operation directory and returned customer files remain persistent.

The programme opens the original browser, chooses the exact retained source,
records the capture request before POST, observes and discards one accepted
capture reply, and reopens that same original job. It follows the actual mapping,
complete preview and immutable import. A previously interrupted preview/import
uses the original Activity continuation with its unchanged request and ID.
The underlying maintained workbook receiver then activates the imported version,
saves SQL, produces complete typed exports and workbook/handoff files, exports
the whole original workspace, and cold-restores it.

| Retained delivery | Original result |
| --- | --- |
| `operation.json`, `records/` | The actual source selection, capture/preview/import requests and subsequent query/export/workbook/archive identities |
| `analysis/` | Captured original source revisions, imported data, saved queries, jobs and complete output history |
| `browser/` | Actual capture and restored-view receipts plus their desktop/mobile images |
| `deliveries/query/` | Complete JSONL, CSV and SQLite rows, including full text and provider metadata |
| `deliveries/workbook/` | Every occurrence in the workbook and the complete typed-source handoff |
| `deliveries/workspace/workspace.zip` | Original database, source-document files and selected query/workbook outputs |
| `restored-analysis/` | Source-local receiving workspace with the original analytical identity |

Repeat the same command and operation directory after interruption. It checks the
retained selection and exact request identities before continuing. Completed
browser phases verify and reuse their original images and receipts. The
`inspect`, `finish --preview-sha256` and `reopen` actions operate that same
saved programme. A source or selection change needs a separately reviewed
operation.

The restored browser opens its original capture, source inspection, mapping and
imported rows without the earlier Research connection. The programme also
verifies the original query digest, workbook and registered source files using
the maintained archive receiver. It preserves complete/failed outcomes and
existing customer edits when reopening an already-received archive.

For agent receiving, register the same original Analysis listener under a native
workspace alias and follow
[the native Research capture programme](../../stellar-forge/mcp-paid-agent/ANALYSIS.md#saved-research-documents-and-managed-outputs).
Read complete jobs through `job`; the reviewed response digest is
`preview.result.preview_sha256`. The original native archive downloader and
portable workspace receiver retain their existing complete-file and restore
identities.

The operating result records belong to the actual selected source and receiving
host. The original managed-document and self-hosted source operations retain
their provider, job and payment custody throughout this customer continuation.

## Receive the complete Europe PMC source workspace

The selected Research product includes the original Europe PMC source adapter,
browser, authenticated client, `research-europe-pmc` command and complete
Merchant family. Its source-owned Research contribution carries the provider
component, existing shared rate-state helpers and Merchant guide into the same
installed archive. The current Research recipe also retains its direct Analysis
browser/native-agent intake and complete Python/workbook receiving.

Deliver the source workspace and the dossier together:

| File or selection | Work carried to the receiver |
| --- | --- |
| Complete Europe PMC workspace JSON/gzip | Every saved query version, original plan and page, edition, decision, continuation and dossier receiving receipt |
| Dossier portable JSON/gzip | Research questions, original received editions, evidence selections, findings, citation-review history and saved revisions |
| Readable dossier HTML or Markdown | The selected saved report revision for the recipient |
| Selected edition JSON/RIS/CSV and review JSON | Complete native source records and the associated metadata review |
| Original source-page downloads | The exact provider-response or retained-document bytes and their recorded provenance |

Create a complete workbench export through **Activity & receiving**, or use the
installed CLI with a retained request file containing an original `requestId`
and `actor`:

~~~sh
starforge research-europe-pmc backup \
  --connection /srv/starforge/private/research-connection.json \
  --input /srv/starforge/private/literature-export-request.json \
  --file /srv/starforge/delivery/Europe_PMC_Workspace.json.gz
~~~

Retain the returned byte count and SHA-256. On the receiving Research application,
use **Reopen and select received copy**, or run:

~~~sh
starforge research-europe-pmc restore \
  --connection /srv/starforge/private/receiving-research-connection.json \
  --request-id ORIGINAL_RECEIVING_REQUEST_ID --actor OPERATOR_NAME \
  --file /srv/starforge/delivery/Europe_PMC_Workspace.json.gz \
  --sha256 ORIGINAL_WORKSPACE_FILE_SHA256
~~~

The receiver verifies the complete archive and every original member, query
revision, review, source binding, continuation and receiving receipt. It selects
a separate received library. Use the existing dossier portable receiver for the
paired research project, then confirm its original questions, source editions and
chosen report revision.

Merchant receiving uses the same application attachment. Discover the current
library with `merchant_research_europe_pmc_list`; carry that exact library in
later actions. Prepare the original workspace export, retain it through
`merchant_research_export` with `kind: "europe-pmc-workspace"`, then read every
chunk through the existing immutable export file API. The
[full Merchant guide](../../stellar-forge/mcp-merchant-operator/EUROPE_PMC.md)
documents all operation/export selections and the complete native customer
receiving helper.

A lost export reply reuses its original export request and retained file. A lost
dossier receiving reply reopens its saved request and resulting edition. After a
restore, list and explicitly select the received library before making a later
change. Continue a partially acquired query from its saved parent plan and actual
next cursor. Original query and review drafts remain in their browser workspace;
commit the intended decisions before exporting the source handover.

For large programmes, agree the complete source selection against the actual
limits: 16 MiB per original page, 24 MiB raw source budget per part, 64 MiB per
normalized edition and 128 MiB per full portable. Record count alone does not
determine source size. Preserve all required original parts and inspect their
complete continuation coverage.

## 12. Receive the complete eligibility programme

The selected product includes the original eligibility engine, browser, API,
CLI, typed client, Python actions, Merchant tools and complete customer receiver.
Confirm the installed command and selected source:

~~~sh
starforge registrations --command research-eligibility-customer
starforge research-client eligibility-help
starforge research-eligibility-customer --help
~~~

Use the same running Research Applications entry and its actual private
connection file. Obtain the dossier ID, review ID and retained revision from
that original workspace. A work-set ID can narrow the delivery. The original
programme remains owned by its existing operator; the customer command receives
that saved selection.

~~~sh
starforge research-eligibility-customer \
  --checkout /absolute/installed-research/source \
  --connection /absolute/private/research-connection.json \
  --directory /absolute/private/eligibility-handover \
  --dossier-id ORIGINAL_DOSSIER --review-id ORIGINAL_REVIEW \
  --revision SELECTED_REVISION \
  --operation-id ORIGINAL_CUSTOMER_CONTINUATION \
  --python /absolute/existing/python3
~~~

`--checkout` is the installed source root containing
`stellar/` and `stellar-forge/`, not the
Python package directory. Use the existing Python and Node runtime. The command
uses Python's standard library and the original installed Node source.

The command creates one source-bound operation directory and produces:

| Output | Complete retained content |
| --- | --- |
| `delivery/selection.json` | Original workspace, dossier, review, work set, revision, full history and every selected section |
| `delivery/files/dossier.json` and `dossier.json.gz` | Full editable dossier, retained source bytes and all original revisions |
| `delivery/files/dossier.html` and `dossier.md` | Readable complete dossier reports |
| `delivery/files/eligibility.json` | Complete selected review, operations and method metadata |
| Seven `delivery/files/eligibility-*.csv` files | Queue, decisions, resolutions, studies, impact, operations and occurrences |
| `customer-workspaces/` | Original JSON and streamed/gzip portable receiving into separate editable stores |
| `Eligibility_Delivery.zip` | Exact member manifest, original selection and all twelve full files |
| `received-delivery/` and `received-customer-workspaces/` | Independent exact-ZIP reopening and the same original receiving paths |
| `complete.json` and `RECEIVING.md` | Actual source/file identities, results and operating instructions |

Each original receiver checks the selected review, complete original history,
source bindings, operations, full section rows and regenerated report hashes.
An existing compatible receiver keeps its later local revisions when the same
earlier source is received again.

### Continue a transferred customer archive

Retain the exact ZIP SHA-256 returned by the sender. On the receiving computer,
use the installed source and a private new caller directory:

~~~sh
PYTHONPATH=/absolute/installed-research/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
python3 -m stellar_forge_buyer.research_cli \
  --directory /absolute/private/receiving-client \
  eligibility-delivery-open /absolute/received/Eligibility_Delivery.zip \
  --expected-sha256 ORIGINAL_ZIP_SHA256 \
  --into /absolute/private/received-delivery

PYTHONPATH=/absolute/installed-research/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
python3 -m stellar_forge_buyer.research_cli \
  --checkout /absolute/installed-research/source \
  --directory /absolute/private/receiving-client \
  eligibility-delivery-receive \
  --delivery /absolute/private/received-delivery \
  --into /absolute/private/received-customer-workspaces
~~~

Use either returned `json-reader/workspace` or
`stream-reader/workspace` as the dossier directory of the
receiving Research application. Create its own private connection record and
Python caller directory through the existing application/startup workflow.
Select the saved dossier and review, inspect its current revision, and continue
with the original eligibility actions. The saved sender's connection file is
not needed for this receiving step.

### Recover the same customer operation

Reinvoke the customer command with the same directory, operation ID, selection
and installed source after an interrupted export or receiving step. It retains
the first selected revision and the original exported portable bytes. Existing
delivery files and native receiving receipts are inspected and reused; a
different source selection uses a new operation directory.

An optional `--replay-request ORIGINAL_REQUEST.json` can be
repeated for original requests already committed in that selected review. Before
sending, the receiver resolves each complete request through the installed
native parser and matches it to the selected immutable operation. It then
recovers that same operation through the original Python call journal. This
option supports a joined programme handover without creating another review or
source task.

The JavaScript export
`./buyer/research-dossiers/eligibility-customer` exposes
`receiveEligibilityCustomer({checkout,connection,directory,dossierId,reviewId,operationId,revision,python,node,signal})`.
An already owned native programme can await this continuation against its
actual returned selection and connection. Its caller keeps the original
listener lifecycle. The continuation retains its complete output before
returning and closes only its own Python/Node child calls.

The CLI translates SIGINT and SIGTERM into its dedicated cancellation exception.
Original runtime and workspace cleanup then join active children before the
outer command returns interrupted. A later invocation uses the same operation
directory and retained selected revision.

## 13. Receive extraction, appraisal, publications and customer updates

Use the complete current selected archive returned by the original maintained builder. The source selection includes its current `research-client` and `research-dossiers` contributions, whole Research/Python components, complete Zotero contribution and assets, original Merchant attachments and these operating guides. Keep the archive's actual source commit, selection, contribution identities and installed source manifest with the receiving record. A merged source package and a READY installed runtime are separate retained states.

This receiving continuation uses the customer's existing dossier and source operation. If another operator already owns its original source creation, full programme or installation, attach to that retained operation and its current listener. Reuse completed original captures and review stages. The maintained builder can resume its saved output, and the runtime installer can adopt its supported existing dependency tree.

### Configure the same Applications entry

After selecting the READY runtime, use **Applications → Research dossiers**. Review and save the original private Research directory and current source inputs. Optional `zoteroStateDirectory` selects the original separate library; optional `extractionPython` selects the absolute installed interpreter. The common original preparation records the interpreter target and selected environment, source paths and private directories. A replaced interpreter or changed reviewed input requires reviewing the current configuration.

With Object, Zotero or an explicit extraction interpreter, an omitted `connectionFile` uses `research-connection.json` in the Research directory. The original host writes that connection; the Applications observer checks its current workspace/instance identity and authenticated feature status before exposing Open. A configured Zotero bridge starts only after the operator selects Open Zotero.

Start, Open, Stop and reopen through that same Applications operation. On restart, use the new current connection record while retaining the same stores and source IDs. Do not copy an earlier bearer URL into a new runtime's source or handover. The host owns its optional Zotero child and drains its admitted operations before closing; client detachment leaves the host with its original owner.

The complete source-selected startup checks cover the original extraction reader, client and selected Zotero server, store, contract and all three browser assets. They establish usable original inputs and startup identity; the retained original source/review/customer operation establishes the complete workflow.

### Carry the full saved study and review

Before export, record the actual dossier and question IDs, selected source occurrences, study ID/version, form and form-edition IDs, result-set ID, independent extraction submissions, resolutions, publication identity and appraisal assessment edition. Retain the selected dossier revision and every accepted original request file. The receiving programme must use those actual returned identifiers.

Inspect all required pages at that explicit revision. The original extraction API provides form editions, result sets, drafts, submissions, results, resolutions, impacts and operations. The publication API provides tables, editions, rows, publications, comparisons, impacts, reviews and withdrawals. Appraisal pages preserve its protocol, selected assessment edition, independently submitted judgments, comparison and adjudication. Keep the complete reports and actual source pointers beside the portable export.

Export the full dossier through its original streaming client:

~~~sh
starforge research-client export \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --revision SAVED_REVISION --format json.gz \
  --out /srv/starforge/delivery/study.research.json.gz

starforge research-client reopen \
  --connection-file /srv/starforge/private/receiving-research-connection.json \
  --directory /srv/starforge/receiving-research \
  --source-file /srv/starforge/delivery/study.research.json.gz \
  --sha256 RETURNED_COMPLETE_SHA256
~~~

The explicit revision selects the complete original history through that saved point. Preserve the actual response's byte count, SHA-256 and revision rather than inferring them from the filename. The original importer validates full history and source objects before committing the received dossier.

On the existing receiving listener, inspect the same forms, result sets, submissions, resolutions, appraisal and publications at the transferred revision. Open their original browser views without replaying authoring steps. Replaying an accepted exact request through the native client/CLI/Merchant path recovers the same original operation. A new correction is a distinct reviewed operation with the current revision, and it preserves inherited history.

The original [extraction commissioning driver](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/STUDY-EXTRACTION-BROWSER.md) attaches to the listener supplied by the existing dossier/source programme. Its author mode belongs to that original creator; inspect mode reviews the received IDs and retained reports. Keep the supplied AbortSignal and programme directory for an interrupted continuation. It closes only the browser/context it owns. The [appraisal receiver](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/risk-of-bias/BROWSER.md) continues the same received study and assessment. Use the complete current programme delivered with the selected source, including its template/customer/cancellation successors.

### Receive the exact customer package

Prepare the handover from the already-frozen native customer delivery and inspect its original manifest:

~~~sh
starforge research-client customer-updates-inspect \
  --source-directory /srv/starforge/delivery/customer-handover \
  --manifest-sha256 RETURNED_HANDOVER_MANIFEST_SHA256

starforge research-client customer-updates-receive \
  --connection-file /srv/starforge/private/receiving-research-connection.json \
  --directory /srv/starforge/receiving-research \
  --source-directory /srv/starforge/delivery/customer-handover \
  --manifest-sha256 RETURNED_HANDOVER_MANIFEST_SHA256 \
  --run-directory /srv/starforge/receiving/customer-operation
~~~

The exact handover contains six content files: JSON, Markdown, HTML and CSV reports, the original `work.review.json`, and the complete `dossier.research.json.gz`. `handover.json` binds their byte counts and SHA-256 values to the selected native delivery. Optional original Europe PMC source-workspace transfer adds its declared source file and uses the required source actor. Select it only when included by the sender's original handover.

An interrupted receive continues the same source directory, manifest hash, receiving workspace and `--run-directory`. The original receiving marker and request receipts determine which work has committed. The receiving report preserves the inherited delivery and review identities. Record the actual receipt before beginning a correction; the correction references that original delivery and the actual customer's requested change.

The same complete receiving is available through original typed and Python client entrypoints and Merchant file readers. Use those installed source exports and their complete guide rather than constructing a second importer. Transfer every file returned by the original manifest, following the native resumable offsets. Check the final complete length and SHA-256 once. Preserve accepted exported bytes after a restart even if the source dossier later changes.

### Carry the complete original Zotero library when required

A dossier-only archive includes that dossier's received Zotero sources and reviews. For the complete library, project/request history and all linked Research dossiers, use the original Zotero export:

~~~sh
starforge zotero export \
  --connection /srv/starforge/private/zotero-connection.json \
  --request-id ORIGINAL_EXPORT_UUID \
  --out /srv/starforge/delivery/zotero-research.json

starforge zotero receive \
  --state /srv/starforge/receiving-zotero \
  --file /srv/starforge/delivery/zotero-research.json \
  --request-id ORIGINAL_RECEIVE_UUID
~~~

These direct Zotero CLI examples use the original Zotero connection created by its standalone serve command. When opened through Research, the original bridge returns its private child URL to that operator; retain the bridge's native API/typed-client export path or deliberately use the existing standalone serve lifecycle after its owner closes the bridge. The Research connection and Zotero connection describe different listeners and are not interchangeable.

Receive into a new private directory or resume the directory already owned by the exact same packet/request. The original import verifies source objects, native history, heads, linked dossier exports and inherited receiving bindings. Normal reopen discovers the received Research store. A later export includes subsequent edits made through that same received Research operator.

The source-owned Zotero contribution carries the native server, public assets and upstream COPYING file. Selecting it in both Research recipes makes the dynamically served UI files part of the actual package. Static ESM import discovery alone does not identify those file reads.

### Preserve the complete receiving boundary

| Boundary | Retain and continue |
| --- | --- |
| Application review/start | Selected READY runtime, configuration revision, original interpreter/source identities and current connection. |
| Source or template processing | Complete original source file, selected occurrence and request; same original process signal. |
| Reviewer save or submission | Full saved request and original actor, form/result/assessment IDs and expected revision. |
| Resolution or publication | Actual comparison/submissions, reason, table edition and accepted operation. |
| Export | Original selected revision, full file manifest, complete bytes and SHA-256. |
| Customer receiving | Source handover manifest, same receiving run directory, native receipt and inherited dossier history. |
| Zotero receiving | Same complete packet, destination, source history and receiving UUID. |
| Correction after receipt | New explicit request against the current received history, referencing the actual prior delivery. |
| Browser cancellation | Retained drafts/requests and programme directory; close only the browser owned by that continuation. |

These controls are the original application's operating behavior. The handover record should distinguish completed source preparation, package installation, browser authoring, native review, report generation and actual receiving. Preserve the original creator's completed evidence and continue only the remaining substantive stages.

## 14. Receive the complete synthesis continuation

The maintained Research selection includes the original complete Analysis and Python source, the synthesis store/engine/report/browser/SDK/CLI and its [full operating guide](SYNTHESIS.md). The source-owned [adoption map](SYNTHESIS_ADOPTION.json) retains all original synthesis leaves and complete BCG reference/programme files. Their source owner continues the one original publication-to-browser-to-SDK/CLI-to-archive receiving operation.

Select the actual Python Runtime environment and its complete buyer package with the declared `synthesis` extra; include `workbooks` when that same selected environment needs the existing workbook product. Reuse a matching installed source/dependency tree. The [exact setup](SYNTHESIS.md#receive-the-complete-synthesis-product) gives the supported package/extra command and original engine-version read. The native engine reports its actual statistics and plotting dependencies; the Research host's extraction setting does not install them.

Use the original complete reviewed publication, selected Analysis directory and retained receiving programme. The first synthesis run is created through the original operator's browser against its saved, reviewed protocol. Keep the actual publication and protocol revisions/digest and 32-hex job ID. The installed SDK and CLI then inspect and receive that same job. They do not recreate the publication, protocol or accepted calculation merely to demonstrate another entrypoint.

The full delivered manifest binds every report, figure, numerical file, source publication, protocol, complete JSON and ZIP to its filename, media type, length and SHA-256. Resume an interrupted native download at its retained Range/If-Range identity and verify the completed file. An identical completed output reopens without another download.

The ordinary Analysis archive contains the publication raw bytes, all protocol editions, the original native result and complete output BLOBs in `datasets.sqlite3`. Restore through the original Analysis archive receiver, then reopen its publication, protocol and job identities. Keep the upstream complete Research portable with its source, reviewer and publication history; the two original workspace formats serve their respective stores.

The [source-native receiving programme](../../stellar/scf-starforge-20261009/distribution/receiving/synthesis/BROWSER_RECEIVING.md) owns the complete browser-created job, its typed/installed-CLI receiving, archive/restore, cold reopen and customer files. Continue its original configuration, run directory and retained outputs after interruption. The BCG reference programme requires the complete current Research extraction/publication source as recorded in its original source map; compose that selected source with this same Research package rather than a separate producer. Its native outcome must come from the original receiving result, independently of source publication or package installation.

## 15. Receive the paid Research installation and editable customer result

Receive the same complete selected Research or Zotero installation that includes the `research-customer-commerce` and original `buyer-runbook` contributions. Its source inventory must retain the complete Research paid-delivery directory, original SF101 receiver, whole Buyer Runbook application, browser assets, agent client/storage and original retained-file helpers. Static ESM helpers are resolved by the maintained distribution builder; the explicit whole Buyer component also preserves its dynamic report and browser source. Existing extraction, appraisal, template, Zotero, source and synthesis files remain part of that same installation.

The installed managed provider is the original **Research dossiers** application. A receiving host can set `customerCommerceHost` to its own private original host configuration, select the actual merchant/Buyer aliases and review that file and its referenced native configurations. Existing startup and connection controls bind the same Research workspace and listener. Keep the actual native merchant and Buyer deployment settings supplied for this operation.

### Preserve the publication-to-receiving chain

Carry these complete selections and artifacts from the original operation:

| Selection | Complete original result |
| --- | --- |
| Research source | Dossier ID, frozen delivery and work IDs, saved revision, selected source-workspace request and actor |
| Merchant publication | Retained review SHA, publication request UUID, original SF101 order, exact public publication and merchant handoff |
| Delivery promise | Actual network/asset/recipient/atomic amount, complete archive bytes/SHA-256 and every member's identity |
| Buyer preparation | Original Buyer alias and selection digest, native paid-file revision, budgets, plan/run/operation and prepared SHA |
| Original payment and retrieval | Existing approval/execution, entitlement/receipt and whole paid-resource export from that run |
| Editable receiving | Complete original handover, received dossier/history/source IDs, saved customer work and four unchanged frozen reports |
| Customer continuation | A later correction/work record in that received dossier, with the first received delivery still identifiable |
| Recovery | Original operation/result directories and complete native workspace backups |

The paid route accepts a complete compressed archive up to 32 MiB. Its full original manifest and member order are verified before extracted files are published. The source owner’s original per-file limits also apply. A report preview or publication metadata response is not the complete purchased content.

### Receive or reopen the exact archive

The ordinary whole customer flow is `commerce-receive-dossier` in **Paid delivery** or the original CLI. It consumes the existing purchase, captures and verifies its complete native paid resource, and uses the same dossier/source receiving engines. Keep its one `--run-directory` and retained request.

For a separately transferred complete original archive, use the existing archive functions:

~~~sh
starforge research-client commerce-archive-inspect \
  --file /absolute/private/research-customer.handover.gz \
  --sha256 ACTUAL_ARCHIVE_SHA256 --bytes ACTUAL_ARCHIVE_BYTES

starforge research-client commerce-archive-receive \
  --file /absolute/private/research-customer.handover.gz \
  --sha256 ACTUAL_ARCHIVE_SHA256 --bytes ACTUAL_ARCHIVE_BYTES \
  --manifest-sha256 ACTUAL_HANDOVER_SHA256 \
  --run-directory /absolute/private/received-archive
~~~

These operate the original archive reader and create-only receiving files. After the complete input has been retained, the same receive command can omit `--file` to reopen its existing directory. The returned `handover.directory` is the complete original handover consumed by the Research receiving workflow.

A stopped or completed native acquisition retains its original payment intent. Reopen its actual state, reconcile an uncertain original request where reported, and continue that request/download. A subsequent customer correction or a moved donor does not require purchasing the original frozen package again.

### Join the existing programme once

Append the paid publication, Buyer approval/retrieval and editable receiving to the same retained NCT/source/extraction/appraisal/template/customer programme. Use its actual frozen delivery and original native merchant/Buyer configuration. The browser commissioner's inspection mode opens the receiving copy at the selected IDs; it does not recreate the independent author submissions or source acquisition.

The complete receiving result records which installation source was selected, the original programme identity, actual publication/native Buyer IDs, the entire archived handover and the later customer correction. Preserve source syntax evidence and already accepted native phases from the original programme. Installed recipe/provider publication alone is not a new native payment or a completed receiving result.

Use [Paid Research delivery](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-commerce/OPERATING.md) for the full source-owned form, CLI, typed-client, cancellation, replay and shutdown contracts. The original Buyer’s `AGENT.md`, `PAID_FILES.md`, `WORKSPACE.md` and `RECOVERY.md` remain inside the same whole component.

## 16. Receive the current protocol and Python paid interfaces

Use the same selected Research installation and original receiving programme. The current contribution closure contains the full Protocol and methods browser, `research-protocol-review` command, original capture/current-engine receiver, scientific Python paid-delivery attachment, full native commerce source, SF101 receiver and Buyer application.

The maintained contribution path is `stellar/scf-starforge-20261009/distribution/contributions/research-customer-commerce.json`. Its complete declaration carries both SF101 and Buyer components, the Python bridge, typed inputs, terminal module, original paid archive reader and operating guides. The Research contribution supplies the protocol assets and client/CLI exports. Both recipes retain their existing source families. The original builder follows actual relative ESM imports, including the Analysis bridge’s original OpenLineage client dependency; a second package is not needed for that imported consumer.

For the selected installed edition, retain its actual source manifest with the original receiving directory. Carry these complete parts into the receiving host:

| Part | Material retained for the original continuation |
|---|---|
| Source and runtime | Actual full installed source identities, original runtime profile and selected Python/Node executables. |
| Protocol capture | Complete original SourceBundle, registry/PDF, every extracted page, methods projection and acquisition/extraction provenance. |
| Protocol review | Complete `REVIEW.json`, original request, native preview, `RECEIVED.json` when committed, dossier/question selection and received source edition. |
| Seller | Original configured merchant selection, frozen delivery, complete publication request/review/enrollment and exported public publication. |
| Buyer | Original intake, preparation, atomic budgets, approval/run/action identities, retrieved archive and received editable result. |
| Python calls | Original seller/customer directories, retained request/reply files, call IDs and exact native operation identities. |
| Customer files | Complete archive, manifest, four reports, work snapshot, editable dossier and optional full source workspace. |
| Operating source | Complete protocol, paid JavaScript and paid Python guides, plus the original executable receiving programme. |

The full protocol operator can attach as a following stage to an existing source import. Inspect the retained bundle, read the original import state, recover the exact request when needed, and open the existing page links and revision reports. If that source is already received, retain its original edition and importer result. The original capture and accepted extraction/appraisal submissions are not repeated.

A source-inclusive protocol handover uses the actual complete engine selection for its chosen installed edition. Keep a previously frozen engine kit with its original programme; record an explicit following selection when the installed source changes. The complete capture/current-engine receiver and package/inspect/receive commands are documented in [the protocol operator guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/STUDY-PROTOCOL-OPERATOR.md).

For a Python paid continuation, use the two existing original Research connections and their private client directories. The [complete retained programme](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_paid_delivery.py) accepts the actual saved publication, Buyer selection, native request IDs and approval budgets. It retains publication, enrollment, intake, preparation, execution, retrieval, complete receiving and original-call reopening in that same programme directory. Carry any customer correction as a later explicit operation.

Receiving a completed archive locally needs the installed source but can omit a live connection. Supply its exact archive bytes/hash and original handover-manifest hash. Reopen through `ResearchCommerceArchive` and the original editable-dossier/source receiver; read the full reports from their retained descriptors. Reusing a completed call ID verifies and returns its saved result before needing the original donor path.

Record the actual interfaces used by the operating receiver. Browser review, typed-client actions, terminal actions and native exports each retain their real outputs; source construction or syntax parsing does not replace an unperformed native payment or receiving phase. Continue the original equipped owner’s programme rather than creating another source acquisition or customer order.

## 17. Reopen and close the original Zotero attachment

The installed Zotero shutdown continuation retains its writer until the original database has actually closed. The workspace drains admitted operations and preserves unfinished receiving children with their original parent and Research bridge. A failed close remains retryable; the connection becomes inactive only after full closure.

Keep the same Zotero state path and original Research connection when reopening. The Applications provider continues to pin its actual selected private state and authenticated listener identity. A client attachment borrows the Research listener; closing the attachment joins its work without taking ownership of that listener.

During an interrupted shutdown, inspect the original owner’s listener, writer and receiving state before continuing the same close. Do not discard its state file or create a replacement library to make a connection appear stopped. The original CLI retains its shutdown handlers through a failed close and releases them after success. Completed source captures and receiving results remain in the original store.

[Zotero native receiving](../../stellar/scf-starforge-20261009/sf30-seller-sdk/zotero/NATIVE_RECEIVING.md) carries the complete SQLite → capture → CLI → browser → Research → independent/onward receiving operation. Its source owner keeps that programme and journal. The Research installation consumes the seven current shutdown postimages while preserving its newer dossier, host, protocol and customer source.

## Continue an interrupted handover

| Interrupted step | Continue the original work |
| --- | --- |
| Source build | Resume the same output directory and saved selection/ref |
| Runtime installation | Reopen the same installer directory, profile and retained lock |
| Application restart | Use the existing Applications entry and current private connection file |
| File preparation | Repeat the exact original preparation request and file bytes |
| Provider submission | Read the saved operation, inspect actual jobs and reconcile its matched provider job |
| Output retention | Read the saved operation and original output IDs before another action |
| Dossier receiving | Repeat the exact original request ID, selection, edition digest and receiving fields |
| Local file download reply | Inspect the returned published destination/file result before choosing another output |
| Merchant export/read | Recover the original export ID and continue its retained cursor |
| Portable receiving | Reopen the same complete portable with its recorded digest and receiving workspace |
| Citation draft or concurrent edit | Reopen the retained complete draft; compare its original base with the current dossier and save the explicit resolution |
| Citation save reply | Reuse the exact original request ID and complete review payload to reopen its saved result |
| Citation report/portable delivery | Select the original saved revision and recover its retained export; reopen the same complete portable |
| Python source/workbook receiving | Reopen its original caller directory, source selection, native job IDs and saved query/workbook/archive receipts |

The completed operating handover retains the source commit/recipe, actual archive/runtime identity, original application and customer paths, dossier/question/edition IDs, original provider operation/job IDs, final file receipts and reopened dossier. The application's owner controls process shutdown; client detachment closes only its own attachment.

## Source relationship

This standalone adoption carries the original Documents/Pipelines client cohort from [public source PR2015](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2015), merged at `4358385d48f54c1391109074beb59b7ba2a8dce8`, onto the maintained original Research backends and browser already present in this repository. The source-owned Research contribution retains the standalone `products/research` operating component while adding the original client and command exports. The same product carries the complete Python Research/Analysis customer receiver from [public source PR2066](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2066), merged at `b59f7f560668d729e3bf718852d0264feb1656bb`. Its additive Python entrypoint, exports and Runtime target are composed onto this repository's current original files. The citation-review cohort comes from [public source PR2061](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2061), merged at `d9c2e3e6f6b86883d76befb74cd252caacb0e698`. It includes the original source-document intake, complete browser/client/Merchant workflow and portable review history. This adoption composes the citation report sections with the standalone product's existing report renderer and preserves its complete Documents, Pipelines and Python receiving work. The selected release manifest identifies the exact final standalone commit and all included original source objects. The eligibility programme adopts the complete original engine/browser from [public source PR2154](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2154), merged at `654162f43b11ffcf2ce53d92de049c088c0861d1`, and the complete Python/typed/Merchant customer source from [public source PR2200](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2200), merged at `af0189886fa13fa63d590d0a639e565fbc2eae75`. These are joined to the current standalone Europe PMC and Analysis sources; its selected customer command uses those same installed engines.

- [Analyst operating guide](OPERATING.md)
- [Citation browser drafts, review decisions and report selection](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CITATION-REVIEW-OPERATOR.md)
- [Complete citation source, native workflow and portable receiving](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CITATION_REVIEW.md)
- [Retained original Crossref document intake](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CROSSREF_DOCUMENTS.md)
- [Python Analysis, workbook and full workspace receiving](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_DOCUMENTS.md)
- [Complete Documents and Pipelines API, commands and merchant contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_DOCUMENTS.md)
- [Research client and file receiving](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_CLIENT.md)
- [Research source configuration](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/README.md)
- [Managed Pipeline source lifecycle](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/UNSTRUCTURED_PIPELINES.md)
- [Selected-source build and restart](../../stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md)
- [Installed dependency/runtime receiving](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)

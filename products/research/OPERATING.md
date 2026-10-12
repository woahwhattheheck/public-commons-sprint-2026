# Research questions, source review and complete delivery

Use one Research workspace for a question, its received source editions, the analyst's decisions and the final report. The browser, command line and merchant tools all operate that same saved dossier. Original source responses remain available beside the analysis, including after a source connection closes.

This product supports a complete working sequence:

1. Open the existing dossier and select its research question.
2. Review the received sources, their coverage and the saved evidence selections.
3. Bring original files and their authored findings into that question with one reviewed source bundle, or receive a retained cohort through its configured source.
4. Review a completed original Document or prepare and continue its managed processing Pipeline.
5. Prepare or resume the original Crossref request for DOI metadata and update review.
6. Receive the reviewed edition and preserve the question's earlier notes, selections and findings.
7. Review registered citation updates, save the complete evidence and finding decisions, and select the intended report revision.
8. Write the source-linked analysis, then deliver the complete report, original files and portable dossier.
9. Reopen the exported dossier on the receiving workspace with its original history.

## Open the original workspace

Use the existing Linux and Node 22.16+ runtime described in the [product README](../../README.md). The Research client uses Node's built-in modules. Its optional source connections use their existing host configuration.

The maintained distribution can install this complete product with `--selection research-workspace`. Follow [installation, original source configuration and customer receiving](RECEIVING.md) for the selected release, dependency profile, Applications entry and restart sequence. The selected package includes these operating files and the full Documents/Pipelines client contract.

From a source checkout, prefix commands with:

~~~sh
node stellar/scf-starforge-20261009/distribution/cli.mjs
~~~

The installed command is `starforge`. Inspect this product's registered client with:

~~~sh
starforge registrations --command research-client
starforge research-client help
~~~

Start the browser against a private, persistent directory:

~~~sh
starforge research-workspace \
  --dir /srv/starforge/research \
  --connection-file /srv/starforge/private/research-connection.json
~~~

Open the printed local URL. An existing managed Applications operation can supply its own private `application-url.json`; the client accepts that original startup record. Keep the connection file private because its URL contains the listener's bearer credential.

To enable Crossref acquisition, supply the existing private source state when starting the workspace:

~~~sh
starforge research-workspace \
  --dir /srv/starforge/research \
  --connection-file /srv/starforge/private/research-connection.json \
  --crossref-state /srv/starforge/crossref-source
~~~

The source retains its captures, request plans, transport settings and rate-limit state. Optional `--crossref-config`, `--openalex-workspace`, `--document-source` and `--pipeline-source` arguments attach the host's configured sources. Their complete operating contracts are in the [Research workspace guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/README.md).

## Read the saved question and evidence

Use the same directory and startup record in the client:

~~~sh
starforge research-client list \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --limit 25

starforge research-client section \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --section questions --limit 25

starforge research-client section \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --section sources --limit 25
~~~

Use the identifiers returned by the original workspace. A page returns its selected dossier revision or inventory snapshot; carry that value into the next page. Metadata and section reads let an analyst inspect large dossiers without repeatedly returning every original response.

The workspace groups matching source identities while retaining their original edition occurrences and content variants. Review the actual source and its operating assumptions before changing a finding. A publication date, deposit date and source-capture date describe different events and remain separate in retained source metadata.

Structured edits use `--input REQUEST.json`. Read the current notes, compose the full intended value, and include the reviewed `expectedRevision`. For example, the question update object has `notes`, optional `text` or `status`, and `expectedRevision`. A conflicting revision prompts another read of that original dossier.

## Receive original files with their findings

A source bundle keeps an original collection of files, its source definitions, the analyst's evidence selections and the linked findings together. Receiving saves that complete collection under the chosen question in one dossier revision.

In the browser, choose **Import source bundle** and select the original question. Open an existing bundle, or choose a source manifest and the folder containing its named files. Review the source titles, terms, selections and complete finding text in the preview. **Download bundle** preserves that prepared input; **Import into question** receives the reviewed bytes.

The [source-bundle guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/SOURCE_BUNDLES.md) includes the complete manifest format. Each source names its original files; each finding links to those source keys. The file list is explicit, so a larger working folder can hold other material without adding it to the selected bundle.

Build a bundle from the original manifest and source folder with the installed command:

~~~sh
starforge research-dossiers bundle-create \
  --manifest /srv/starforge/inputs/source-manifest.json \
  --source-directory /srv/starforge/inputs/original-files \
  --out /srv/starforge/inputs/reviewed-sources.json
~~~

Preview it against the existing running workspace, then receive it with the revision and bundle hash returned by that preview:

~~~sh
starforge research-client bundle-preview \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --question QUESTION_ID \
  --file /srv/starforge/inputs/reviewed-sources.json

starforge research-client import-bundle \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --question QUESTION_ID \
  --file /srv/starforge/inputs/reviewed-sources.json \
  --revision PREVIEW_REVISION --sha256 REVIEWED_BUNDLE_SHA256
~~~

If another analyst changes the dossier before a fresh import, preview the same bundle against the current revision. If the receive reply is lost, repeat the same file and question: the original receiver recognizes that complete bundle already saved under the question and preserves later work. Changed file bytes identify another reviewed source edition.

For merchant operation, add a source handle to the existing workspace configuration's `sources` object:

~~~json
{
  "reviewed_sources": {
    "kind": "source-bundle",
    "file": "/srv/starforge/inputs/reviewed-sources.json",
    "sha256": "REVIEWED_BUNDLE_SHA256"
  }
}
~~~

Use `merchant_research_source_bundle_preview` with the workspace, dossier, question and that source alias. Use `merchant_research_source_bundle_receive` with the same selection, preview revision and bundle hash. The attachment reads the complete host file and calls the original authenticated Research application.

After receiving, source details expose each original file. Text can be read in full, and downloads preserve the original bytes. The complete bundle remains inside the retained edition and travels with the portable dossier, including binary files and original manifest bytes. The builder and receiver verify file lengths and SHA-256 values; the current limits are 64 MiB for the complete bundle JSON and 48 MiB for decoded source files.

The installed SDK exports `createSourceBundleFromDirectory`, `createSourceBundle` and `inspectSourceBundle` through the Research dossier module and its `source-bundles` export. The existing `ResearchWorkspaceClient` supplies byte and host-file preview/receive methods, so a service can use the same reviewed input and revision controls.

## Inspect and download an original source

Source pages and revision comparisons keep titles, descriptive fields, selections and typed previews small enough to read through the installed client and merchant tools. Search still matches the complete original records. A retained file is read from its selected edition when the analyst opens or downloads it.

In the browser, choose the source and its retained variant. **Read text** opens the complete original text; **Download** keeps the original bytes. The selected citation also offers its original result record. The saved edition and member digest identify a file even when later editions use the same DOI or filename.

Use the same authenticated installed listener to inspect a retained occurrence:

~~~sh
starforge research-client source \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --edition RETAINED_EDITION_ID \
  --key ORIGINAL_OCCURRENCE_KEY --revision SAVED_REVISION
~~~

Choose the actual source-bundle citation when a DOI group also contains OpenAlex or other provider editions. The inspection returns each original file's relative name, byte length, media type and SHA-256. Download the selected member with that returned name and digest:

~~~sh
starforge research-client export-source-file \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --edition RETAINED_EDITION_ID \
  --key ORIGINAL_OCCURRENCE_KEY --revision SAVED_REVISION \
  --name "papers/original-study.pdf" --sha256 ORIGINAL_FILE_SHA256 \
  --out /srv/starforge/delivery/original-study.pdf
~~~

The client retains the complete stream and publishes a new output path exclusively. The server checks that the original edition belongs to the requested saved revision, that the member belongs to that occurrence, and that its bytes match the selected digest. Binary files and a UTF-8 byte-order mark keep their original bytes.

The same attachment exposes **merchant_research_source** and **merchant_research_export** kinds **source-file**, **source-content** and **source-record**. Its existing export receipts and resumable file reader carry the selected file through detach or restart. Complete content and parsed-record exports declare their own serialization and digest; the retained-edition export keeps the original response bytes and formatting.

The [complete source inspection contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_CLIENT.md#inspect-and-download-large-original-sources) includes SDK, CLI, merchant and HTTP selections. Full portable delivery carries the original files and saved history.

## Review completed Documents

The **Documents** view joins the original document purchase and native Partition response to the selected research question. Open a saved purchase or a received edition, inspect its parameters and warnings, then read the original elements. The complete edition digest binds that review to the original document and response bytes.

The client uses the existing listener and dossier:

~~~sh
starforge research-client documents-list \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID

starforge research-client documents-review \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --input /srv/starforge/private/document-selection.json
~~~

The selection file contains exactly one actual `purchaseId` or `editionId`. Use the returned complete edition SHA-256 as `expectedEditionSha256` in the subsequent element, receiving and file requests. Page the original elements with `offset`/`limit`; `page`, `type` and `query` select the needed part of the retained response. Continue the returned `nextOffset` to read more.

Receive the reviewed purchase into its original question with `documents-receive`. Its request names `selection: {purchaseId}`, `questionId`, `label`, `expectedEditionSha256` and the reviewed dossier `expectedRevision`. The original receiving operation reconciles an already-saved binding before adding another edition.

Download the original document, its complete Partition response and the complete research edition with `documents-download`. Its input contains the same selection/digest and `kind: "document"`, `"response"` or `"edition"`; `--out` names a new local destination. Received editions remain reviewable after the former buyer source disconnects.

## Run and retain an original managed Pipeline

The **Pipelines** view uses the host's existing configured profiles and persistent operation directory. Read those profiles and limits, select the original research question, and prepare the exact source files with their reviewed complete hashes:

~~~sh
starforge research-client pipelines-list \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID

starforge research-client pipelines-prepare \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --input /srv/starforge/private/pipeline-preparation.json
~~~

The preparation object has `requestId`, `profileId`, `questionId`, `label`, the dossier's `expectedRevision` and an ordered `files` list. Each file has `file` and its complete lowercase `sha256`, with optional `filename` and `contentType`. Relative file paths resolve against the preparation JSON's directory. The original client checks each file, streams from the same open descriptor and verifies the complete bytes before finishing the preparation.

Retain the returned plan ID, plan digest and operation revision. The preparation and all subsequent actions belong to that original operation. Inspect it before an action:

~~~sh
starforge research-client pipelines-operation \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --operation ORIGINAL_OPERATION_ID
~~~

| Work | Command and binding |
| --- | --- |
| Submit the reviewed plan | `pipelines-submit`; the action request ID, operation revision and original plan hash |
| Observe progress | `pipelines-refresh`; a retained observation request ID and current operation revision |
| Cancel processing | `pipelines-cancel`; the current operation revision and an explicit reason |
| Inspect provider jobs | `pipelines-provider-jobs`; optional workflow/status filters |
| Reconcile an interrupted submission | `pipelines-reconcile`; the matched original provider job ID, original plan hash, current operation revision and reason |
| Retain an advertised output | `pipelines-retain`; the returned provider `fileId` and optional `nodeId` |

Lifecycle commands take `--operation` and `--input`. Preserve each action's exact request ID and body through a lost reply. Refresh before selecting a later action. Reconcile the observed provider job into an interrupted submission so another operator can continue that same job.

Retention downloads the complete provider output into the original operation and returns its saved output ID, byte count and digest. Review that output with `pipelines-review`, inspect its original elements, and receive it into the selected question with `pipelines-receive`. Receiving uses `selection: {operationId, outputId}`, its own original `requestId`, the reviewed edition hash and the current dossier revision.

| Revision | Applies to |
| --- | --- |
| Dossier revision, starting at 1 | File preparation, Document receiving and Pipeline-output receiving |
| Operation revision, starting at 0 | Submit, refresh, cancel, reconcile and output retention |

The complete [Documents and Pipelines contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_DOCUMENTS.md) includes SDK requests, CLI input objects, all element filters, source limits and same-request recovery. The existing [Pipeline source guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/UNSTRUCTURED_PIPELINES.md) defines the retained provider operation and host configuration.

## Deliver original processing files

The complete input, provider output and received source edition remain separate selectable files:

| File | Client command |
| --- | --- |
| Original prepared input | `pipelines-input --operation … --file-id … --out …` |
| Complete retained provider output | `pipelines-output --operation … --file-id … --out …` |
| Received pipeline output or complete research edition | `pipelines-download --input … --out …`; kind `output` or `edition` |
| Purchased or received Document, original response or complete edition | `documents-download --input … --out …`; kind `document`, `response` or `edition` |

All commands take the original connection file, directory and dossier ID. Review an operation output with its operation/output IDs, or select an already received edition. Carry its complete edition hash into the download.

The receiver publishes the complete stream to a new output path and returns the actual bytes and SHA-256. A requested digest mismatch retains the completed file and its returned identity for inspection. The ordinary report/portable export then carries the saved research questions, received editions, authored findings and complete history together.

## Work with a retained ClinicalTrials cohort

The same Research attachment operates the original ClinicalTrials receiving workspace. Configure a `clinicaltrials-packet` source handle with the actual retained ZIP and its SHA-256, then import that packet, select its captured cohort and prepare receiving under the original question.

Its tools cover saved inputs, review, start/resume, stop, receipt into the dossier, complete study reads, cohort analysis and comparison. The original source operator owns registry acquisition. Research retains the selected packet, complete nested studies, source coverage and reviewed findings. Analysis keeps distinct studies and source occurrences separate and uses the original cohort's reported values.

The [ClinicalTrials merchant operating guide](../../stellar-forge/mcp-merchant-operator/RESEARCH_CLINICALTRIALS.md) gives the exact tool fields and complete export selections. Whole-study, selected-analysis and source-packet exports use this attachment's existing file retainer and restart recovery. Reopening the portable dossier keeps its retained clinical edition available independently of the earlier receiving operation's working directory.

## Continue the saved Crossref review

The selected question must already contain its DOI-bearing sources. Prepare a request with a stable `requestId`, `questionId`, `label`, `expectedRevision` and `selectedOnly` selection. The [complete client guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_CLIENT.md) includes the exact input objects for preparation, receiving, question updates and source imports.

~~~sh
starforge research-client crossref-prepare \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --input crossref-plan.json

starforge research-client crossref-review \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --operation ORIGINAL_OPERATION --section dois --limit 50

starforge research-client crossref-start \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --operation ORIGINAL_OPERATION \
  --plan-sha256 REVIEWED_PLAN_SHA256
~~~

Review the same operation's coverage, source differences and warnings. Start/resume and stop keep its original identity. A partial result retains its useful records and transport failures; the projected comparison preserves sources that the refresh did not return.

Receiving requires the reviewed plan SHA-256, reviewed edition SHA-256 and the current dossier revision:

~~~sh
starforge research-client crossref-receive \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --operation ORIGINAL_OPERATION \
  --input crossref-receive.json
~~~

After a lost reply, inspect the original dossier and operation. The receiver can recognize an already committed matching edition and return its original outcome. It preserves authored notes, selected evidence and findings.

Original response receiving, configured provider references and retained OpenAlex editions use the same client's `receive`, `reference` and `receive-openalex` commands. Full raw-source exports retain exact original bytes, including an original UTF-8 byte-order mark.

## Review registered citation updates

Open the saved dossier and choose **Update review**. The list connects each registered source notice to the selected evidence and affected findings across the dossier's research questions. **All notices**, **Pending and follow up**, and **Reviewed** select the current list. The source-coverage section preserves the received edition's actual coverage and missing results.

Open the notice's original assertions before editing. Each assertion keeps its DOI, registered update type, source edition and original result key. **Inspect original record**, **Download original result record** and **Download original edition** open the retained source. Original HTTP captures and retained source documents keep their own source bindings and supplied provenance.

Enter the reviewer, overall decision and reason. Edit each affected evidence occurrence's selection, classification and complete note. Review every affected finding's full title, text and citation occurrences. A finding receives one explicit disposition:

| Disposition | Complete saved change |
| --- | --- |
| Unchanged | Preserve the finding's title, text and citations and record why |
| Revised | Save an actual change to its title, text or citations |
| Affected citations removed | Remove every affected citation from that finding and retain the reason |
| Follow up | Record the additional review needed and any explicit edits made now |

**Save complete review** saves that entire selection in one dossier revision. The current revision and notice fingerprint bind the decision to the reviewed source. The saved history keeps the author, reason, finding dispositions, source bindings and exact before/after changes.

The browser saves complete draft versions in IndexedDB. A refresh restores the selected draft, and **Other retained draft versions** preserves earlier branches. If another analyst edits the dossier, **Compare draft with current revision** displays the original, current and working values. Resolve the fields changed in both versions and choose **Use resolved draft on revision …**. The earlier draft remains available. **Download draft** saves the complete editable content; the page also offers that download when browser storage cannot acknowledge a write.

A submitted save retains its exact request before transmission. After an interrupted reply, **Retry original save** reopens that original result. Keep that request while reconciling its outcome, including if the dossier has since advanced. The complete [citation review operator guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CITATION-REVIEW-OPERATOR.md) describes draft recovery, concurrent edits and saved review selection.

Use the same workflow through the installed client:

~~~sh
starforge research-client citation-updates \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --status pending --limit 30

starforge research-client citation-updates \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --revision RETURNED_REVISION --notice NOTICE_ID

starforge research-client citation-review \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --input /srv/starforge/private/original-citation-review.json
~~~

Carry the returned revision and next offset through notice pages. The original request object contains the complete evidence changes, finding changes and disposition for every affected finding. Its exact field contract is in [citation review source and receiving](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CITATION_REVIEW.md).

A saved review gives access to the original, reviewed and current dossier revisions. Choose the intended revision before exporting its report or portable:

~~~sh
starforge research-client export \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --revision SELECTED_REVISION --format html \
  --out /srv/starforge/delivery/selected-citation-review.html
~~~

The same selection supports Markdown, JSON and compressed JSON. The report includes the citation review and its source-linked decisions. The portable contains the selected revision's complete original editions and history, so the receiving workspace reopens the same evidence, findings and saved reviews.

## Python citation analyst

The same installed Research source now includes the complete Python citation
analyst. `ResearchWorkspace.citations(dossier_id)` and the installed
`stellar-forge-research` command list notices at a pinned revision, expose the
full original detail, retain editable request revisions and recover the exact
same atomic save after an interrupted reply.

The [complete Python citation guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_CITATIONS.md)
covers the original workspace handshake, full JSON editor, compare-and-set local
drafts and immutable pending request. The submitted selection includes all
evidence changes, full findings and reasoned dispositions. A stale draft remains
on its original source revision until the analyst explicitly creates a revised
selection; an uncertain save keeps its original request ID and body.

Delivery freezes the original, reviewed and current revisions and retains every
HTML, Markdown, JSON and gzip export. Both original portable readers validate
the complete history before the final ZIP is created. A partial download or
missing receipt recovers the first saved bytes, and a changed receiving file is
preserved for operator review.

For analytical handover, the original Analysis workspace imports the complete
selected audit, saves SQL and produces full JSONL, CSV and SQLite exports plus a
workbook. Text previews are explicitly labeled; full records and original source
remain in the typed exports. The same receiver archives and cold reopens the
editable workspace.

The selected runtime exposes `starforge research-citation-python-receive --help`.
It continues an already completed original citation customer run, verifies the
saved review before exact request recovery, and returns the complete analyst
handover and customer receiving receipt. Use its existing native operation or
an explicit continuation after the original listener has closed. The command
does not start another provider acquisition or create another review.

## Attach merchant and agent tools

Create a private host selection pointing at the existing Research listener:

~~~json
{
  "schema": "stellar-forge.research-workspaces.v1",
  "workspaces": {
    "research": {
      "label": "Research desk",
      "consoleUrlFile": "/srv/starforge/private/research-connection.json",
      "directory": "/srv/starforge/research"
    }
  }
}
~~~

Save that object as a private regular file and initialize the merchant:

~~~sh
starforge merchant-mcp init-research-workspaces \
  --dir /srv/starforge/research-merchant \
  --connection /srv/starforge/private/research-workspaces.json

starforge merchant-mcp serve \
  --config /srv/starforge/research-merchant/merchant-mcp.json
~~~

An existing merchant may instead add `researchWorkspaceConnection` to its original configuration. The provider loads when a configured Research tool first needs it.

The Research tool family lists the declared aliases, attaches to the original listener, reads paged dossiers and findings, operates the saved Crossref and managed Pipeline lifecycles, receives reviewed Documents and source editions, and retains complete files. Tools use the returned attachment ID and original dossier, question and operation IDs. Host-declared source handles select exact private files and hashes.

The citation tools expose `merchant_research_citation_updates`, `merchant_research_citation_update` and `merchant_research_citation_review`. They use this same attachment and the reviewed dossier revision. The ordinary `merchant_research_export` accepts the selected revision for complete reports and portable dossiers.

The Documents tools expose list, review, elements and receive. The Pipelines tools expose list, prepare, operation, submit, refresh, cancel, provider jobs, reconcile, retain, review, elements and receive. A Pipeline preparation selects `pipeline-input` handles from this same private configuration. Declare each original file path, reviewed hash and optional filename/media type under `sources`, then pass those source names as `inputSources`.

Use `merchant_research_export` for `document-file`, `document-response`, `document-edition`, `pipeline-input`, `pipeline-output`, `pipeline-received-output` and `pipeline-edition`. The existing export ledger and resumable file reader preserve the original file identity across detach/restart; the [complete contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_DOCUMENTS.md#merchant-agents) gives each selection.

The client rereads the original connection file after a managed restart. Its authenticated workspace and instance checks bind each request to the selected original application. Detaching drains the attachment's requests and temporary file readers; Applications continues to own the listener and saved acquisition.

## Use the original Analysis browser and native agent

The selected Research product also includes the complete Analysis Research intake.
An operator can select the actual saved document or retained managed output in the
Analysis browser, review its full edition identity and capture the complete source.
The browser, Python commands and native MCP actions use the same original jobs,
source revisions, mapping, database, workbook and archive.

Use the buyer Python package and the complete Node source from this release, as in
[the Python installation step](RECEIVING.md#8-receive-the-complete-python-analysis-and-workbook).
The host selects a private registry with schema
`stellar-forge.analysis-research-connections.v1`. Its `connections` array names
each allowed Research connection with `name`, `label`, absolute
`connection_file` and the actual `expected_workspace_id`. Optional
`request_timeout_ms` selects the original client deadline. Copy the workspace
identity from the original Research listener; keep its capability in the private
connection file. The complete [registry and intake contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_INTAKE.md)
includes the exact JSON shape and supported bounds.

Start the existing Analysis service with that registry:

~~~sh
python3 -m stellar_forge_buyer.analysis_workspace \
  --database /srv/starforge/customer/analysis \
  --checkout /absolute/installed-source \
  --research-connections /srv/starforge/private/analysis-research-connections.json \
  serve --port 0
~~~

Open its private local URL and select **Research**.

1. Select a named connection and load its original dossier inventory. Choose the
   intended dossier and the Documents or Pipelines family.
2. Open an actual saved purchase, retained job output or received edition. Review
   its digest, document/source metadata and original element pages. Display
   filters affect the viewed elements; capture keeps the full selected edition.
3. Choose the Analysis source name, its reviewed current revision, a title and
   the explicit capture timestamp. Capture saves the exact request before
   dispatch and retains one original `research-capture` job.
4. Open the completed capture's original source in **Responses**. Its displayed
   provenance, revision and eighteen-column mapping belong to that exact
   captured edition. Preview exhausts the mapped source; import uses the
   reviewed preview digest and returns an immutable database version.
5. Activate that version under the intended SQL view, save the useful query and
   continue through the existing full query export, workbook and whole-workspace
   archive controls.

After a lost reply, use **Refresh capture** or the saved request's reopen action.
An interrupted capture resumes its original request. A completed registration is
recovered from the local source closure before the client reconnects to Research.
In **Activity**, an interrupted response preview or import can continue with its
same original ID and request; import keeps the original completed preview and
source version. Earlier complete outcomes stay available when the source alias
advances.

The native agent operates this same running Analysis service. Register its
existing host-owned database using the selected package's original command:

~~~sh
starforge mcp-native analysis-register \
  --dir /srv/starforge/private/native-mcp-buyer \
  --name customer \
  --database /srv/starforge/customer/analysis
~~~

The original MCP tool uses `action: analysis` and the registered
`analysisWorkspace: customer`. Its eight Research operations list configured
connections, dossiers and saved sources; review the selected edition and elements;
capture the full source; page capture history; and cancel the original local
capture. The existing `job` operation reads the complete original receipt.
The [complete native Analysis guide](../../stellar-forge/mcp-paid-agent/ANALYSIS.md#saved-research-documents-and-managed-outputs)
provides the exact operation bodies, pagination, preview/import and archive
bindings. The selected installation includes the full native buyer/Analysis
component and its original `mcp-native`, `mcp-stdio`,
`mcp-client-config` and `mcp-analysis-archive` commands.

Use the [complete interactive customer receiver](RECEIVING.md#11-receive-the-interactive-analysis-and-native-agent-workflow)
to continue this actual saved source through the browser, full workbook and
independent cold restore.

## Build the analytical workbook from a received document

The same installed source also supplies the Python Research client and its complete document-to-workbook receiver. A reviewed original Document or Pipeline edition becomes one native Analysis source with every original occurrence, full text and provider metadata, source files and retained identity. The original Analysis engine then performs mapping preview/import, immutable version activation, saved query, complete typed exports, workbook delivery and full workspace restoration.

Install the existing buyer Python package with its `workbooks` extra from the same release, as described in the [receiving guide](RECEIVING.md#8-receive-the-complete-python-analysis-and-workbook). The Python runtime requires version 3.11 or newer; its original workbook dependency is `openpyxl==3.1.5`.

For a reviewed exported edition, run the original customer receiver:

~~~sh
python3 /absolute/installed-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_document_workbook.py \
  --checkout /absolute/installed-source \
  --directory /srv/starforge/customer/document-analysis \
  prepare --edition /srv/starforge/delivery/received-edition.json \
  --file-sha256 RETURNED_EDITION_FILE_SHA256 \
  --edition-sha256 REVIEWED_NATIVE_EDITION_SHA256
~~~

Review the original mapping preview, complete source, row count and warnings. Then use its actual preview digest:

~~~sh
python3 /absolute/installed-source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_document_workbook.py \
  --checkout /absolute/installed-source \
  --directory /srv/starforge/customer/document-analysis \
  finish --preview-sha256 RETURNED_NATIVE_PREVIEW_SHA256
~~~

The complete receiver keeps eighteen source columns, one row per original occurrence and the full underlying original files. JSONL, CSV and SQLite exports contain the complete selected text and metadata. The workbook indexes every occurrence with an explicitly labeled safe text preview; the full text stays in the typed exports and source archive.

The delivered workspace archive includes the original database, sources, query and workbook. Reopen the same retained customer operation with the receiver's `reopen` command. Its cold reader verifies the original workspace, immutable table rows, saved query, workbook and every registered source file.

The [complete Python Research/Analysis contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_DOCUMENTS.md) covers live Document/Pipeline control, retained request recovery, original-file source reconstruction, all delivered paths and full archive receiving.

## Run a literature update with Europe PMC

Open **Literature searches** in the Research header. It uses the running Research
application and the same private connection. The neutral workbench brings saved
search definitions, original provider pages, records, comparisons and receiving
together.

1. Save a named search with its complete Europe PMC query, page size, maximum
   pages, synonym setting and retained source terms. A later edit creates another
   saved definition while keeping the earlier source editions.
2. Select that saved revision and retain an edition through **Acquire original
   pages** or **Prepare file intake**. File intake accepts the complete original
   core JSON pages with their actual source URLs. Inspect the returned coverage.
3. Open **Records & review**. Read full metadata, abstract, licence and every
   original occurrence; retain an include, exclude, uncertain or follow-up
   decision with the operator's note. Complete drafts survive a refresh, and a
   concurrent change is resolved against the saved review revision.
4. Compare the required earlier and later editions. Inspect query-scope changes,
   added and absent records, and full native metadata differences. Download the
   complete comparison and the selected edition's JSON, RIS, CSV or review history.
5. Use **Dossier receiving** to select an existing dossier and question, review
   its current revision and append the chosen original source edition. Continue
   evidence selection, findings, citation review and reports in that dossier.
6. Export the complete Europe PMC source workspace from **Activity & receiving**
   and retain it with the dossier portable and readable report. Its separate
   received copy keeps every query, source page, decision and receiving receipt.

Large searches use explicitly linked parts. When an edition reaches its source
or normalized size limit, the exact boundary page and next cursor remain saved.
Continue from that original part; inspect the combined chain and receive each
required edition into the intended question. The operator guide specifies the
actual byte limits and complete source coverage fields.

The installed command operates the same listener:

~~~sh
starforge research-europe-pmc list \
  --connection /srv/starforge/private/research-connection.json

starforge research-europe-pmc query --id ORIGINAL_QUERY_ID \
  --connection /srv/starforge/private/research-connection.json
~~~

Use `starforge research-europe-pmc help` for all acquisition, review, comparison,
export and receiving commands. Save complete request JSON with `--input` to
preserve the query, note, original request ID and expected revision. The existing
client exposes the same operations through `client.europePmc()`.

The [complete literature operator guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/EUROPE-PMC-OPERATOR.md)
explains source intake, query history, browser recovery and receiving. The
[Merchant attachment guide](../../stellar-forge/mcp-merchant-operator/EUROPE_PMC.md)
gives all twenty tool names, declared original-file inputs and six export kinds.

## Operate a complete eligibility programme

Open the saved question in **Eligibility**. The programme retains the question,
each original source occurrence, complete protocol editions, named reviewer
decisions, resolutions, explicit study/report links and selected applications
inside that dossier. The existing source, Documents, citation, literature and
Analysis work remains available from the same application.

Begin by reading the actual retained occurrences for the question. Select the
complete reports you intend to assess; an occurrence identifies a particular
question, edition and original source row. The same DOI appearing in another
question or source edition remains a different retained occurrence.

Create the review with its complete protocol. Record stage names, eligibility
criteria, exclusion reasons, reviewer assignments and the decision counts
required by the selected method. Create a work set against that exact saved
protocol edition and its explicit occurrence IDs. The application then walks
the selected assignments through title/abstract and any full-text stages in
that protocol.

Each decision records its original actor, criterion answers, disposition, reason
and retained source basis. Open the original file or source locator while making
the decision. An unavailable full text is retained as unavailable. Correct a
decision by selecting its previous decision ID; the earlier decision remains in
history. Read all current decision IDs before resolving a disagreement, and
record the method and rationale used for that resolution.

The study workspace groups reports only through explicit retained evidence.
Add the source locators establishing that the reports concern the same study.
Use the resulting current resolutions to apply the chosen outcomes to the
original source selections. The existing supports/contradicts/background
classification and analyst note are preserved unless the application action
explicitly changes them.

After an updated search, source edition, question or protocol, use **Impact** to
review what changed. Retain the affected original occurrence and reason, create
the appropriate new work set, complete its decisions, and record the actual
impact disposition. This keeps the earlier completed review readable at its
original revision while the programme progresses.

The [eligibility operating guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/ELIGIBILITY-OPERATOR.md)
covers the complete browser flow, drafts, conflict recovery and source files.
The [native method and action contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/ELIGIBILITY_REVIEW.md)
defines each full action payload and the source-linked method.

### Work through the original CLI and Merchant attachment

The installed client exposes the same complete programme:

~~~sh
starforge research-client eligibility-help

starforge research-client eligibility-view \
  --connection-file /absolute/private/research-connection.json \
  --directory /absolute/private/research-workspace \
  --id ORIGINAL_DOSSIER --review ORIGINAL_REVIEW \
  --section queue --revision SELECTED_REVISION --offset 0 --limit 100

starforge research-client eligibility-review \
  --connection-file /absolute/private/research-connection.json \
  --directory /absolute/private/research-workspace \
  --id ORIGINAL_DOSSIER --input /absolute/private/original-request.json
~~~

Replace the uppercase selections with the actual saved identifiers. The request
file contains the original request ID, observed revision, named actor, action,
review ID when required, and complete action data. After a lost response, resend
that unchanged file. A corrected request receives a new ID after the original
outcome and current dossier revision have been reconciled.

The configured Merchant Research attachment provides
`merchant_research_eligibility` and
`merchant_research_eligibility_review`.
Read a whole section by retaining the first page's revision through every
subsequent cursor. Use `merchant_research_export` with
`eligibility-json` or `eligibility-csv`,
the original dossier revision and required review ID. Its retained file ledger,
chunk reader and original portable receiving remain the same delivery path.

### Use Python and typed clients on the saved programme

Set Python's module path to the installed release's actual `source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python`
directory. The `--checkout` argument names that release's
**source root**, the directory containing `stellar/`
and `stellar-forge/`.

~~~python
from stellar_forge_buyer.research_workspace import ResearchWorkspace

with ResearchWorkspace(
    checkout="/absolute/installed-research/source",
    connection_file="/absolute/private/research-connection.json",
    directory="/absolute/private/python-research-client",
) as workspace:
    review = workspace.eligibility(actual_dossier_id)
    queue = list(review.iter_rows(
        section="queue", review_id=actual_review_id,
        revision=selected_revision,
    ))
~~~

Prepare/save/submit, every original review action and exact-request recovery
are available on that `review` object. The client retains its
first workspace identity and call history in the same private caller directory.

The selected package exports
`./buyer/research-dossiers/eligibility` and its adjacent typed
declaration. `readEligibility`,
`iterateEligibility`, `submitEligibility`
and `exportEligibility` borrow the original authenticated
`ResearchWorkspaceClient`. Their receipt checks bind the
complete request, actor, original and resulting revisions and operation hashes.

The [complete Python and customer guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_ELIGIBILITY.md)
includes all eight action methods, selected report downloads, complete portable
receiving and every installed Python CLI command.

### Deliver the entire selected programme

Use the installed customer command after the original programme has saved the
intended review and revision:

~~~sh
starforge research-eligibility-customer \
  --checkout /absolute/installed-research/source \
  --connection /absolute/private/research-connection.json \
  --directory /absolute/private/customer-eligibility \
  --dossier-id ORIGINAL_DOSSIER --review-id ORIGINAL_REVIEW \
  --revision SELECTED_REVISION \
  --operation-id ORIGINAL_CUSTOMER_CONTINUATION \
  --python /absolute/existing/python3
~~~

The command attaches to the existing listener. It freezes the complete selected
review, every section and original revision list; exports the original dossier
JSON and gzip, HTML and Markdown, eligibility JSON and seven full CSV tables;
receives both portable formats; builds `Eligibility_Delivery.zip`;
and reopens that exact ZIP into independent editable customer workspaces.

`complete.json` names the original selection, source file
hashes, all twelve original file hashes, the exact archive and complete receiving
results. `RECEIVING.md` travels beside the archive. The ZIP
contains source and review history without the private connection file or caller
logs. The [receiving instructions](RECEIVING.md#12-receive-the-complete-eligibility-programme)
cover continued operation and a customer transfer.

## Configure the installed extraction and Zotero application

The existing **Applications → Research dossiers** form accepts the same private Research directory, original source settings, environment and port as before. It also accepts these optional settings:

| Application setting | Original launch argument | What is retained |
| --- | --- | --- |
| Original private Zotero library directory | `--zotero-state` | The selected existing library, or a new private directory in an existing private parent. Research and Zotero use their respective stores. |
| Original extraction Python executable | `--extraction-python` | The absolute executable, its resolved file identity and any selected original interpreter environment. |
| Private Research connection file | `--connection-file` | The current original listener, directory, workspace and instance identity. With Object, Zotero or an explicit extraction interpreter, an omitted path defaults to `research-connection.json` inside the Research directory. |

Review and save the application against its selected READY runtime, then Start and Open that original operation. The runtime check includes the selected extraction reader or complete Zotero source and browser assets. Before Open is exposed for either new setting, the original authenticated client checks that the announced listener belongs to the selected workspace and exposes the configured native feature. This status read leaves Zotero closed until the operator explicitly opens it.

For a source or installed CLI launch, use the equivalent original host arguments:

~~~sh
starforge research-workspace \
  --dir /srv/starforge/research \
  --connection-file /srv/starforge/private/research-connection.json \
  --extraction-python /absolute/original/python3 \
  --zotero-state /srv/starforge/zotero-library \
  --port 0
~~~

Select the actual interpreter available on this host. If omitted, the original host uses its configured default Python. A source or interpreter change requires a fresh review of that application configuration; preserve the original research and library directories. Stop through the owning Applications operation before its normal restart or runtime upgrade. The original host drains its work and closes the Zotero child it owns. Its clients detach without stopping the host.

Both maintained selections, `research-workspace` and `zotero-research`, include the original Zotero contribution, its browser assets, native metadata source and upstream notice. They also retain the full Research source, current typed/Python/Merchant contributions and original Documents, Pipelines, Analysis and eligibility workflows. Consult the selected archive's manifest for its exact edition.

## Bring an original Zotero collection into the question

Open **Zotero** from the current Research application. This starts the original local Zotero operator against its selected private library and borrows the already-open Research store. Reopening the same active bridge returns that original child. The Research workspace status and a library capture are separate operations.

Choose or create the real user/group library profile in **Libraries**. Retain its numeric library ID, collection keys, descendant policy, trash selection, source reference and reuse context. The original capture records every selected API page, library version and completeness check. API-key values remain in the configured host environment. Existing acquired item and collection files can be imported as a retained document selection, with their original coverage stated explicitly.

In **Projects**, select the original edition and collection scope, then save the intended item keys, evidence classification, notes and source-linked findings. A metadata attachment record identifies that Zotero attachment; its file contents are available only if separately acquired. A missing record in an imported selection does not establish remote deletion.

Use **Research delivery** to choose the actual dossier and question. Preparation pins the selected project revision, original source bundle and digest. Inspect that native Research preview and receive it with the original handoff and request ID. Its page custody, item JSON, classification, findings and project lineage become a saved Research source edition. Continue a lost reply with those same identities.

The [full Zotero operating and receiving guide](../zotero/OPERATING.md) covers exact capture/import, source restart, comparison, complete workspace export and receiving commands. To operate through the existing Research client:

~~~js
import {ResearchWorkspaceClient} from
  '@tokenjunkielabs/starforge-merchant/buyer/research-dossiers/client';

const research = new ResearchWorkspaceClient({
  connectionFile: '/srv/starforge/private/research-connection.json',
  directory: '/srv/starforge/research'
});
try {
  const status = await research.zoteroStatus(); // inspect; does not start a capture
  // An explicit operator action may open the original configured library.
  const library = await research.openZotero();
  // Keep library.url private and open it only on this operator's host.
} finally {
  await research.close();
}
~~~

The complete Zotero workspace export includes its native source/project/request history and all linked original Research dossiers. Receive it through the original Zotero receiving command into a new private directory, with its original packet and receiving UUID. Later edits to the received Research dossier remain part of a subsequent complete Zotero export. A Research-only dossier export remains useful when the receiver needs only that selected dossier; it does not substitute for the complete Zotero library history.

## Extract study results with independent reviewers

Select the actual question, source occurrence, study ID and study version in **Study extraction**. Read the retained source and its exact values before authoring a form. The complete original [extraction operator guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/STUDY-EXTRACTION-OPERATOR.md) defines each form, result-set, answer and review field.

Create the full form edition with its declared fields, types, allowed values and source requirements. Save the result set against the selected study/version and form edition. Retain each returned ID; a form title or a source filename cannot replace these bindings.

Each named reviewer works in their own draft. Import or enter the complete answer set, inspect the source pointers and exact decimal/status fields, save the draft, and submit it explicitly. One reviewer's submitted extraction does not silently become another reviewer's draft. The browser retains workspace-specific drafts and prepared requests through reload; the saved original request remains authoritative after an interrupted reply.

In **Review**, inspect both actual submissions for each result row. Select the original answer or author an explicit resolution with its reason and source basis. A resolved value retains the submitted disagreement and complete earlier answers. Editing the source, study version, form or result set requires the native impact review rather than rewriting a prior submission.

In **Tables**, author the complete output mapping and intended table edition. Review it against the selected results, publish the exact edition, and retain the publication identity. Later changed source/results, revised columns and withdrawals retain their own history. Publications can be compared and exported at an explicit selected revision.

Read pages and retained numeric values through the installed client:

~~~sh
starforge research-client extraction-view \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --revision SAVED_REVISION --section submissions \
  --form FORM_ID --result-set RESULT_SET_ID --offset 0 --limit 100

starforge research-client extraction-source-values \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --revision SAVED_REVISION --input /srv/starforge/work/source-selection.json
~~~

The source-selection file identifies the original `occurrenceId`, exact `pointers` and optional original `fileName`. It selects retained bytes; it does not fetch a replacement source. Follow the returned page continuation at the same revision.

Original extraction and publication writes use the five-field envelope `{requestId, expectedRevision, actor, action, data}`. The actor contains the original reviewer ID and name. Save the complete request before sending it with `extraction-review` or `extraction-publication-review`. After an uncertain reply, inspect the retained operation and resubmit the identical request when needed. Changing its content requires a different reviewed operation.

Download the full selected reports:

~~~sh
starforge research-client extraction-export \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --revision SAVED_REVISION --form FORM_ID --result-set RESULT_SET_ID \
  --format json --out /srv/starforge/delivery/extraction.json

starforge research-client extraction-publication-export \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --revision SAVED_REVISION --publication PUBLICATION_ID \
  --format csv --out /srv/starforge/delivery/published-table.csv
~~~

Extraction reports support JSON, Markdown and HTML; publication reports also support CSV. Complete source, submissions, resolutions, operations and publication history travel in the original portable dossier. A displayed page or downloaded report is a view of that history.

## Appraise the same original study and result

Use **Appraisal** on the existing dossier. Select the instrument/protocol, actual study and result version, source evidence, named independent reviewers and intended resolver. Save the complete assessment edition before authoring its answers. The original [appraisal browser and receiving guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/risk-of-bias/BROWSER.md) and [API contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/risk-of-bias/API.md) define the exact instrument, criterion and evidence shapes.

At least two distinct named reviewers save and submit their own complete drafts. Compare their actual judgments and reasons. Adjudication pins the selected submissions and comparison digest; retain a reason for each accepted resolution. A later assessment or source edition keeps its explicit impact relationship to the prior one.

Use **History** to recover a prepared request whose reply was lost. Browser drafts and requests remain tied to their workspace and dossier. An accepted submission stays immutable while subsequent corrections use a new native operation.

The same workflow is available in the installed client:

~~~sh
starforge research-client risk-help

starforge research-client risk-view \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --review REVIEW_ID --assessment ASSESSMENT_ID \
  --assessment-edition ASSESSMENT_EDITION_ID \
  --revision SAVED_REVISION --offset 0 --limit 100

starforge research-client risk-prepare \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --action NATIVE_ACTION --data /srv/starforge/work/assessment-action.json \
  --actor REVIEWER_ID --actor-name "Actual reviewer" \
  --out /srv/starforge/work/original-assessment-request.json

starforge research-client risk-review \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --input /srv/starforge/work/original-assessment-request.json
~~~

`risk-prepare` retains a complete workspace-bound request in a new file. Keep that file for recovery. `risk-export` supports the selected JSON, CSV, Markdown and HTML reports. Original typed clients and Merchant attachments use the same assessment, revision and request IDs; their complete file downloads preserve byte counts and SHA-256.

## Deliver a customer baseline, update and correction

Open **Customer updates** for the selected dossier. Save the actual customer reference and question, protocol, source plans, query terms, output requirements, acceptance and commercial scope in the brief. Prepare a baseline request, an update tied to the previous delivery, or a correction tied to the actual delivery being corrected.

Select the original source editions and period fields for that request. Inspect complete changes, coverage and acceptance against the retained native work. The work catalog provides exact JSON pointers, source hashes and the review-context fingerprint; use those original references when authoring the customer review. Save the complete review before freezing its delivery.

A delivery retains its exact report and work review at that saved revision. Record **Sent**, **Received**, **Accepted** or **Corrections requested** only when that event actually occurred, with its original correspondence or receiving reference. A prepared delivery is still available for inspection and handoff before those external events.

The installed CLI exposes the complete original lifecycle:

~~~sh
starforge research-client customer-updates-help

starforge research-client customer-updates-save \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --input /srv/starforge/work/customer-review-request.json \
  --run-directory /srv/starforge/work/customer-review-operation

starforge research-client customer-updates-handover \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research --id DOSSIER_ID \
  --delivery DELIVERY_ID --revision SAVED_REVISION \
  --out /srv/starforge/delivery/customer-handover
~~~

A saved review operation resumes from its original `--run-directory`; retain the accepted input and request identity. The handover contains the four complete report formats, `work.review.json`, the full `dossier.research.json.gz` and their `handover.json` manifest. Optional original Europe PMC source-workspace receiving uses the documented source selection and actor; credentials and live listener capabilities stay on their host.

The [complete customer updates guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-updates/CUSTOMER_UPDATES.md) gives source-plan, receiving, correction, typed-client, Python and Merchant details. Preserve each original handover and continue later updates in that same received dossier.

## Synthesize the reviewed study publication

Use the original **Analysis → Evidence synthesis** entry to continue an accepted Research publication. This is the selected Analysis workspace, its existing SQLite history and worker. Its [complete operator and installation guide](SYNTHESIS.md) remains part of the same Research package; [SYNTHESIS_ADOPTION.json](SYNTHESIS_ADOPTION.json) identifies every adopted application and reference source.

Export the complete original publication after the intended independent extraction and publication review. In Analysis, import its exact UTF-8 bytes and select the actual results array and descriptor pointers. The original BCG publication uses `/publications/0/rows` and `/result`; another publication or selected index must use its own inspected pointers.

Inspect the preserved original field values, study references and source bindings. Define the question, reviewer, rationale, population, outcome, intervention, comparator, timepoint, estimand and unit. Include or exclude each intended result with reasons and explicit comparability/independence choices. Preserve exclusions and unselected rows; choose one independent contribution per study for the selected calculation.

Map accepted original field IDs or an explicit supported field sum. Choose the compatible input kind, effect measure, model, interval/variance method and zero-cell rule. Save any prespecified subgroups and sensitivity selections against the exact result IDs. Save and reopen the complete immutable protocol edition, then choose **Review saved edition** before its original run. Later edits become another saved and reviewed edition.

The browser's **Run reviewed synthesis** creates the original native job. Retain its actual 32-hex ID, publication revision, protocol revision and digest. Refresh, cancellation and deliberate resume use that same job. Open the complete primary, subgroup, sensitivity and leave-one-study-out results and receive its original JSON, CSVs, reports, figures, publication and ZIP.

The installed Python client and CLI attach to that existing running Analysis workspace:

~~~sh
python3 -m stellar_forge_buyer.synthesis_cli \
  --database /srv/starforge/customer/analysis --live \
  result --id ORIGINAL_SYNTHESIS_JOB_ID

python3 -m stellar_forge_buyer.synthesis_cli \
  --database /srv/starforge/customer/analysis --live \
  receive --id ORIGINAL_SYNTHESIS_JOB_ID \
  --output /srv/starforge/customer/delivery/synthesis
~~~

Use the original Python Runtime's selected `synthesis` extra and actual command map; preserve a matching installed environment. This Analysis interpreter selection is independent of the Research host's optional extraction interpreter. Full input/method controls and exact package setup remain in [SYNTHESIS.md](SYNTHESIS.md#receive-the-complete-synthesis-product).

Receive every file in the original native manifest with its complete bytes and SHA-256. Interrupted downloads retain the original partial file and range identity. The full Analysis archive includes raw publications, every protocol edition, native run results and output BLOBs. Restore that ordinary archive and reopen the same job before continuing another source or protocol edition. Keep the original Research dossier/portable alongside it when the recipient needs the upstream study, submission, resolution and publication history.

## Deliver and reopen complete work

Export both an editable portable and the readable report:

~~~sh
starforge research-client export \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --format json.gz \
  --out /srv/starforge/delivery/research.research.json.gz

starforge research-client export \
  --connection-file /srv/starforge/private/research-connection.json \
  --directory /srv/starforge/research \
  --id DOSSIER_ID --format html \
  --out /srv/starforge/delivery/research.html
~~~

Choose a new output path for each delivery. The client publishes a file after the complete stream is retained and returns its actual byte count, SHA-256 and dossier revision. The portable contains the saved revision history, editions, selections and findings. Source-edition, Crossref-edition and comparison exports are available through their dedicated commands.

On the receiving workspace, use its actual connection file and directory:

~~~sh
starforge research-client reopen \
  --connection-file /srv/starforge/private/receiving-research-connection.json \
  --directory /srv/starforge/receiving-research \
  --source-file /srv/starforge/delivery/research.research.json.gz \
  --sha256 EXPORTED_SHA256
~~~

The original streaming importer validates the selected bytes and retained history before committing the received case. Reopening an exact delivery is distinct from extending its history or receiving an incompatible branch.

Merchant exports use the same complete sources. `merchant_research_exports` lists durable receipts; `merchant_research_file_read` returns resumable chunks for a selected export identity. Carry the returned offset, verify the complete decoded byte count and SHA-256, and release the temporary reader when finished. The retained delivery remains available after detachment.

## Publish and receive a paid customer delivery

The installed product includes the original SF101 merchant, Buyer Runbook and Research paid-delivery application. A frozen customer delivery remains the source for publication. Its actual merchant configuration supplies the network, asset, recipient and amount; a service quote or grant budget does not become an API transaction price.

The complete source-owned walkthrough is [Paid Research delivery](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-commerce/OPERATING.md). The Research and Zotero selections retain that guide, the whole Buyer application and its typed agent, the complete SF101 receiver, all Research customer-commerce source and the existing retained-download helpers.

### Select the existing hosts in Applications

In **Applications → Research dossiers**, set **Original paid Research host configuration** (`customerCommerceHost`) to the private JSON file that declares the existing merchant and Buyer aliases. It composes with the same Zotero, extraction Python, Object, document-pipeline and source-workspace settings. When no explicit Research connection path is selected, the existing application writes `research-connection.json` in its private Research directory.

The original host schema is:

~~~json
{
  "schema": "sf88-research-customer-commerce-host/v1",
  "merchants": {
    "research-report": {
      "label": "Research reports",
      "checkoutFile": "/absolute/private/research-checkout.json",
      "claimEnv": "SF101_CLAIM_TOKEN"
    }
  },
  "buyers": {
    "research-acquisition": {
      "label": "Research acquisition",
      "agentFile": "/absolute/private/research-buyer-agent.json",
      "workspace": "research-acquisition"
    }
  }
}
~~~

A seller-only or buyer-only host can omit the other collection. Relative configuration paths resolve from this file's directory. Keep the file private to the launching account. The original reader validates its exact schema and alias declarations. Applications review retains the complete host file's identity and the referenced checkout and Buyer agent configuration files; a changed selection is reviewed through the original application workflow.

The original Buyer agent configuration names the existing Buyer workspace, launch file, actual selection digest and distinct private agent storage. Obtain those values from that application's saved launch. Its configured whole-file/export limits must fit the actual selected archive, whose paid route supports at most 32 MiB. The complete original Buyer setup and recovery guides travel under `stellar/scf-starforge-20261009/buyer-runbook/`.

**Review**, **Save**, **Start** and **Open** remain the original managed actions. Startup checks the selected Research listener and connection identity, then uses its original authenticated client to read the paid-delivery configuration. It confirms that this listener opened the selected host file. Alias-specific merchant or Buyer setup errors remain visible through the original configuration view; startup does not invent a merchant, payer, budget or payment.

The ordinary launcher also accepts the same selection:

~~~sh
starforge research-workspace \
  --dir /absolute/private/research \
  --connection-file /absolute/private/research-connection.json \
  --customer-commerce-host /absolute/private/research-commerce.json \
  --port 8846

starforge research-client commerce-configuration \
  --connection-file /absolute/private/research-connection.json
~~~

For a new native merchant, use the existing `paid-file-checkout` command's `inspect`, `init` and `serve` actions against its actual configuration. An existing deployment preserves its checkout state, outbox, facilitator and signed notice receiver. The original `buyer-runbook` and `buyer-agent` commands operate and attach to the selected Buyer application. Paid delivery borrows those existing owners and their approval flow.

### Publish one exact frozen package

Finish the customer brief, source selection, work record and frozen delivery in **Customer updates**. In **Paid delivery → Publications**, select that dossier, saved delivery revision and declared merchant. Supply the customer-facing title, summary and usage. If the full Europe PMC source workspace belongs in the delivery, select its actual original source request and actor.

**Review publication** creates the original complete handover/archive and reads the actual checkout. Review its frozen dossier/work/reports, complete member byte counts and hashes, archive SHA-256, payment terms, source configuration and existing state/outbox identities. **Enroll this publication** uses that same review and original SF101 order. Download the complete **Publication** JSON for the customer.

Keep its one publication request UUID. The native order is `research-` plus that UUID. An interrupted enrollment inspects or reopens this original order. An already completed publication continues to identify its frozen original files after later customer work.

The installed CLI calls the same implementation:

~~~sh
starforge research-client commerce-publication-prepare \
  --connection-file /absolute/private/research-connection.json \
  --input /absolute/private/publication-request.json \
  --run-directory /absolute/private/operations/publication-review

starforge research-client commerce-publication-enroll \
  --connection-file /absolute/private/research-connection.json \
  --input /absolute/private/publication-enroll.json \
  --run-directory /absolute/private/operations/publication-enroll

starforge research-client commerce-export \
  --connection-file /absolute/private/research-connection.json \
  --kind publications --id ORIGINAL_PUBLICATION_UUID --part publication \
  --run-directory /absolute/private/exports/publication \
  --out /absolute/private/customer-publication.json
~~~

The preparation input carries the actual `requestId`, merchant alias, `dossierId`, `deliveryId`, saved `revision`, title, summary and usage. Enrollment carries that publication ID and the `reviewSha256` returned by its completed review. Use the complete original input examples in the paid-delivery guide.

### Receive through the original Buyer

In **Paid delivery → Purchases**, receive the exact publication and choose the existing Buyer alias. Refresh its original paid-file state. Enter the actual total and daily atomic-unit budgets and existing claim environment name, then **Prepare purchase** with the refreshed native revision. This creates the original reviewed plan/run against the publication and full archive.

**Execute** reaches the original Buyer approval. The existing browser or terminal operator reviews the actual payer, network, asset, amount and resource through that native application. Refresh and cancel keep the same returned run/execution identity. **Retrieve**, **Recover** and **Finalize** continue the original paid-file operation as indicated by its saved native state.

After the full file is available, **Receive editable Research dossier** verifies the complete original Buyer export and archive, reopens the full handover, and receives the dossier/history and selected source workspace into the existing Research engines. It retains the exact four frozen reports and saved customer work. Continue a customer correction in the received dossier; the acquired delivery remains frozen.

The same receiving input can be used with:

~~~sh
starforge research-client commerce-receive-dossier \
  --connection-file /absolute/private/customer-research-connection.json \
  --input /absolute/private/receive-dossier.json \
  --run-directory /absolute/private/operations/dossier-receiving
~~~

Use the actual purchase ID, a retained receiving request UUID, returned `preparedSha256` and selected `sourceActor` when the source workspace travels. Do not substitute a new purchase for an interrupted download or a later customer correction.

### Continue and recover the same operation

Every CLI write retains its complete input, request and result in the original `--run-directory`. Reopening a completed operation does not need a live connection:

~~~sh
starforge research-client commerce-receive-dossier \
  --run-directory /absolute/private/operations/dossier-receiving

starforge research-client commerce-operation \
  --run-directory /absolute/private/operations/dossier-receiving
~~~

If the original agent reports an uncertain native action, use `commerce-reconcile` with the original request ID and current native selection. Explicit `commerce-replay` uses a separate local replay directory while submitting the same native request; it preserves the first completed result. Browser **History** and **Working forms** retain the corresponding original requests, unfinished edits and imported form provenance.

**Stop** drains this same Research controller and its accepted downloads/receiving. It closes the original owners and listener. Repeating Stop retries an unfinished owner; it does not erase retained requests or native state. Restart through the same saved Applications definition and use its newly written original connection.

Keep complete backups of the Research workspace, actual merchant state/outbox, Buyer workspace, immutable publication/purchase operation directories and customer handover. The paid archive is one complete gzip-framed stream with exact member order and hashes. Larger programmes use the original complete non-paid handover or an explicitly smaller selected delivery; no member is silently truncated.

## Review the registered protocol and planned methods

The installed **Protocol and methods** view keeps the complete original capture beside the selected dossier and question. It shows the PDF, full extracted page text, the authored methods map, and the original SourceBundle preview. Source acquisition, the previewed question changes, and a reviewer’s appraisal remain separately identifiable in the same dossier.

The NCT03529110 capture retains the complete registered PDF, all 117 extracted pages, the registry selection and the original extraction provenance. **Open PDF page** and **Read complete page text** show the retained original material. The registry labels the document *Study Protocol and Statistical Analysis Plan*; the PDF is protocol DS8201-A-U302 version 6.0, dated 25 September 2020, and refers some details to a separate SAP. These are planned methods from the source. Continue the original extraction and appraisal workflow to record the analyst's decisions.

Use the capture already retained by the original programme. The maintained `research-study-protocol` command owns capture and the complete source-inclusive handover; `research-protocol-review` supplies the browser-compatible inspect, prepare, receive and reconcile workflow. Opening a completed capture reads its retained files. A fresh PDF acquisition additionally uses the installation’s original Poppler executables.

1. Open the intended dossier, then **Protocol and methods**.
2. Select the complete retained `source-bundle.json` and the existing question.
3. Choose **Inspect captured source**. Read the original PDF and complete page text at the relevant methods links.
4. Choose **Preview question changes**. Review the source terms, method observations, question selection and expected revision.
5. Choose **Save to this question**. Keep the returned source edition and original revision with the existing programme.

The original importer receives the entire source bundle. A method observation is a source finding; its presence does not record an appraisal decision. The existing appraisal view records that judgment against the actual selected study and source.

For terminal operation, use the same capture and private original connection:

~~~sh
starforge research-protocol-review inspect \
  --source /absolute/original-protocol-capture/source-bundle.json \
  --out /absolute/private-protocol-review/source-inspection.json

starforge research-protocol-review prepare \
  --source /absolute/original-protocol-capture/source-bundle.json \
  --connection /absolute/private/research-connection.json \
  --workspace-id ORIGINAL_WORKSPACE_ID \
  --dossier ORIGINAL_DOSSIER_ID \
  --question ORIGINAL_QUESTION_ID \
  --directory /absolute/private-protocol-review
~~~

The uppercase selections are the actual values returned by the existing workspace. Preparation writes a complete `REVIEW.json` containing the original source, inspection, preview and fixed request. The browser accepts that same file. Reusing its directory reopens the first saved selection.

After the original review, receive or reconcile that exact request:

~~~sh
starforge research-protocol-review reconcile \
  --review /absolute/private-protocol-review/REVIEW.json \
  --connection /absolute/private/research-connection.json

starforge research-protocol-review receive \
  --review /absolute/private-protocol-review/REVIEW.json \
  --connection /absolute/private/research-connection.json \
  --directory /absolute/private-protocol-review
~~~

Reconciliation reads whether the selected bundle is already present in that question. Its original result distinguishes `ALREADY_RECEIVED` from `NOT_RECEIVED`. Receiving retains `RECEIVED.json` with the actual metadata response and source edition. A lost reply can be recovered from the same original request even when later dossier revisions exist. A new source or question receives an explicit new review directory.

The browser commits its full request to IndexedDB before sending it. **Read original import state** and **Recover original import** use that same request after an uncertain response. **Download complete review** and **Download exact request** preserve the original recovery material. If another tab saved the draft, reopening adopts that saved draft and its storage revision together; the other local copy remains available for an explicit separate save. Keep a downloaded unsaved review if browser storage is unavailable.

For an attached SDK client, use its original `client.studyProtocol()` methods: `inspectFile`, `prepareFile`, `reconcile`, `receive` and `receiveCapture`. Await the operation and close the borrowed client when its work is complete. The attachment does not own the Research listener.

The [complete protocol operator guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/STUDY-PROTOCOL-OPERATOR.md) includes all methods, original registered-document semantics, current-engine handover commands and receiving recovery.

## Continue the paid delivery from Python

The installed Python `ResearchWorkspace.commerce()` attachment operates the same publication, Buyer and editable-customer delivery described above. Select the original installed source, private seller or receiving connection, and its existing Python client directory. These selections keep the saved calls associated with the correct native workspace.

~~~python
import json
from pathlib import Path
from stellar_forge_buyer import ResearchWorkspace

request = json.loads(
    Path("/absolute/private/original-publication-request.json").read_text()
)

with ResearchWorkspace(
    checkout="/absolute/installed/source",
    connection_file="/absolute/private/seller-research-connection.json",
    directory="/absolute/private/python-seller",
) as seller:
    commerce = seller.commerce()
    configuration = commerce.configuration()
    result = commerce.prepare_publication(
        request,
        call_id="original-publication-review",
        resume=True,
    )
    native_review = result["result"]["review"]
~~~

The request contains the original UUID, configured merchant alias, saved dossier, frozen delivery, selected revision, title, summary and usage. Its optional source-workspace selection carries the complete original source workspace. Review the returned original checkout before calling `enroll_publication` with that same publication ID and actual `reviewSha256`. Export its public publication through `commerce.export`; the returned file descriptor refers to the complete verified file.

The customer’s original Python workspace then follows the existing full delivery:

| Step | Original operation and retained selection |
|---|---|
| Receive the publication | `receive_publication_file` retains its complete original bytes, Buyer alias and intake request UUID. |
| Prepare | `purchase(..., refresh=True)` supplies the current paid-file revision; `prepare_purchase` receives that revision, original request UUID, exact atomic budget strings and configured claim environment name. |
| Execute | `execute` receives the original purchase ID, action UUID and prepared hash, and reaches the existing Buyer approval and payment process. |
| Retrieve | `retrieve` keeps the same purchase/prepared hash and its own original action UUID. |
| Receive editable work | `receive_dossier` imports the complete purchased dossier, reports and optional source workspace through the original receiver. |
| Continue the project | Use the returned actual dossier and revision with the normal customer-update, extraction, appraisal and source interfaces. |
| Preserve the complete archive | `export("purchases", id, "archive", ...)` retains the original compressed archive and exact promised identity. |

Each durable Python call has a stable local call ID as well as the native UUID contained in its original input. Resume the first complete input; changing the selected source or native UUID means an explicit new operation. Monetary amounts remain the exact original atomic strings. The claim field names an existing environment variable; its secret value stays with the native operator.

The installed module command exposes the same workflow:

~~~sh
python -m stellar_forge_buyer.research_cli \
  --checkout /absolute/installed/source \
  --connection /absolute/private/seller-research-connection.json \
  --directory /absolute/private/python-seller \
  commerce-publication-prepare \
  --input /absolute/private/original-publication-request.json \
  --call-id original-publication-review --resume \
  --output /absolute/private/original-publication-review.json
~~~

Use `commerce-list` and the complete publication/purchase views to inspect saved work. `commerce-export` saves the whole selected file. The original command help and [Python paid-delivery guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH-COMMERCE.md) contain the full input and action names, typed records, complete two-workspace programme and archive reader.

### Reopen calls, cancel and receive locally

`saved(call_id)` reads the first completed local reply and checks its files. `recover(call_id)` continues that same durable attempt or returns its retained result. `operation(call_id)` reads the underlying native records. The terminal equivalents are `commerce-saved`, `commerce-resume` and `commerce-operation`.

An explicit `replay(call_id, replay_id=...)` creates a distinct durable attempt with the unchanged native request. It preserves the original attempt and does not allocate a replacement native UUID. Use replay when the original operation requires that explicit recovery action; a completed local call can simply reopen.

For an execution still running, the original `cancel` input includes its real execution UUID, purchase ID, prepared hash and a separate cancellation request UUID. Cancellation can run through a separate Python call while the original execution is pending. Follow the native purchase/run state after interruption, and keep its original recover/finalize/reconcile selections.

A complete acquired archive can be received locally with the listener stopped:

~~~sh
python -m stellar_forge_buyer.research_cli \
  --checkout /absolute/installed/source \
  --directory /absolute/private/python-local-receiving \
  commerce-archive-receive \
  --file /absolute/private/research-customer.handover.gz \
  --sha256 ACTUAL_ARCHIVE_SHA256 --bytes ACTUAL_ARCHIVE_BYTES \
  --manifest-sha256 ACTUAL_HANDOVER_MANIFEST_SHA256 \
  --call-id original-local-archive --resume
~~~

Take all three expected values from the original publication and handover. The same native archive receiver checks the complete compressed file and publishes every original member. `ResearchCommerceArchive` exposes the complete handover, four reports, work snapshot, editable dossier and optional source workspace through the original file readers. Its compressed-file limit is the original paid-file route’s 32 MiB; all member limits remain the native contracts.

The original Python context manager joins active calls before closing its runtime. Keep the saved directory after interruption; it contains the original request and completed or uncertain outcome. The separate local receive keeps the original source identity while allowing further customer editing in its receiving workspace.

## Review original RIS source editions

Open a dossier in the running Research listener and choose **RIS sources**. Select the question, retain each complete source file with its filename, encoding and source/query provenance, and prepare the edition. The review exposes the original occurrences, repeated and unknown tags, parser diagnostics and duplicate groups. Record the selection, evidence classification, full note and duplicate decision before receiving the edition.

The browser saves the complete draft in its own storage and can download or reopen that complete draft as a recovery file. Wait for its saved status before closing a working tab. Receiving first freezes the full request, original source, reviewed plan and base dossier revision. A changed dossier revision requires review of the actual new revision. A lost response is recovered through the original saved request; retain its ID and complete body.

The installed commands use the same listener and dossier:

~~~sh
starforge research-ris ris-list \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER"

starforge research-ris ris-prepare \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER" \
  --input "$RIS_PRIVATE/files-and-review.json"

starforge research-ris ris-request \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER" \
  --request "$RIS_ORIGINAL_REQUEST"

starforge research-ris ris-export \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER" \
  --edition "$RIS_EDITION" --format source --out "$RIS_PRIVATE/original-source.json"

starforge research-ris ris-export-comparison \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER" \
  --before "$RIS_EARLIER_EDITION" --after "$RIS_LATER_EDITION" \
  --format html --out "$RIS_PRIVATE/edition-comparison.html"
~~~

Use the actual connection file and owned store directory from the original listener. Set each placeholder to the selected dossier, original request, edition or new private output. The same verbs are available through `starforge research-client`. `ris-prepare-source` operates a retained complete source declaration; `ris-preview` and `ris-receive` accept the full reviewed request file. The [full RIS operations guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/ris-source/OPERATING_GUIDE.md) gives the source/review input fields, limits, receipt recovery and export commands.

For application code, use `ResearchWorkspaceClient.risSources()`; its methods retain the original connection identity and source/revision bindings. The installed `./buyer/research-dossiers/ris/client` entry exports the original client factory. The Merchant Research attachment provides seven RIS tools and eleven export forms through its existing retained-file API. It preserves the original Research Commerce, extraction, appraisal, citation and eligibility tools.

A later review may retain or deselect earlier selections according to its explicit reviewed choice. Compare the two received editions and save JSON, HTML or Markdown comparison exports. Original document and record downloads retain their exact bytes; selected RIS is a declared derived UTF-8 representation. Export a specific dossier revision when a report must retain its before, reviewed or later state. The complete portable dossier carries these editions and review histories.

## Operating source

- [Citation update review, complete browser drafts and selected reports](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CITATION-REVIEW-OPERATOR.md)
- [Retained original Crossref documents and complete edition creation](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CROSSREF_DOCUMENTS.md)
- [Python document analysis, complete typed exports, workbook and workspace archive](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_DOCUMENTS.md)
- [Selected-product installation, Applications and complete receiving](RECEIVING.md)
- [Original Documents and managed Pipelines client, CLI and merchant workflow](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_DOCUMENTS.md)
- [Original source bundles, file manifests and atomic receiving](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/SOURCE_BUNDLES.md)
- [ClinicalTrials cohort receiving and complete merchant exports](../../stellar-forge/mcp-merchant-operator/RESEARCH_CLINICALTRIALS.md)
- [Complete Research client, SDK and merchant contract](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_CLIENT.md)
- [Research workspace and configured sources](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/README.md)
- [Crossref review, acquisition and recovery](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CROSSREF.md)
- [Original saved-case operating journey](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/examples/README.md)

Keep operating directories, source credentials and private startup records outside the source checkout. Retain the complete original case and delivery together through the customer's receiving handover.

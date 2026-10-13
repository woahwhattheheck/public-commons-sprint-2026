# Complete Flowable customer Installation

Join an actual Flowable programme to its complete commercial Workshare and the existing SF47 Customer Installation. The preparer carries the entire original Flowable workspace, selected model and input files, native work and review history, commissioning source, original customer seed, operator selections and full commercial terms. The receiving command continues through the original Flowable archive receiver and the original SF47 Installation writer, exporter and importer.

## What the customer receives

The complete private preparation contains the original workspace archive twice: its frozen input under `source/flowable-workspace.ndjson` and its delivery copy under `delivery/flowable-workspace.ndjson`. Every selected source/model/input/operation/review file is retained under `delivery/files/`. The full source report preserves the complete programme and its actual operation inventory. The native Installation input preserves the original Workshare, funded assignments, workorder, workflow periods, coordination and prospective checks. Commercial JSON, Markdown and HTML contain the selected full commercial case and phase effort.

The customer case and the Flowable workspace remain complete original applications. The native case archive and its mandatory Flowable sidecar travel together. The compact `FLOWABLE_SOURCE_SELECTION.json` identifies the full source report and archive and every selected file; all those bytes accompany it. This keeps the existing SF47 ordinary-source limits usable for large customer workflow archives.

## 1. Export and select the original programme

In the maintained Flowable workspace, save the full source and intended programme. Review and operate authorized native requests through their existing controls. Reconcile a request with an uncertain outcome using its original saved request. Retain unstarted steps, unresolved operations, human tasks, original source editions and unfinished authoring.

Export the whole original NDJSON workspace through Delivery. Record:

| Selection | Meaning |
| --- | --- |
| Archive SHA-256 | Exact complete original NDJSON bytes |
| Original workspace ID | The producing workspace inside the archive |
| Programme ID and revision | The selected immutable saved programme record |
| Programme source SHA-256 | Exact original programme JSON bytes |
| Native basis SHA-256 | The operation projection selected in this archive |

The saved record SHA, programme source SHA and observed basis SHA are separate identities. A later legitimate native operation can change the current basis while preserving the selected original record and source.

Inspect the exact retained source:

~~~sh
starforge flowable-installation inspect \
  --archive "$PRIVATE_INPUT/flowable-workspace.ndjson" \
  --archive-sha256 "$ARCHIVE_SHA256" \
  --programme "$PROGRAMME_ID" \
  --programme-revision "$PROGRAMME_REVISION" \
  --programme-sha256 "$PROGRAMME_SHA256" \
  --basis-sha256 "$BASIS_SHA256"
~~~

Direct source invocation is `node stellar/scf_2026/sf49_data_commissioning/installation-workorders/flowable-installation.mjs` with the same arguments.

The inspector imports the full archive using the maintained `inspectDelivery` and `adoptDelivery` methods in its own temporary original workspace. It reads the complete programme, selected immutable records, available original operation reviews and every referenced source blob. It closes and removes only its own temporary workspace. Engine dispatch remains in the original operating application.

## 2. Select the original commercial Workshare

Attach the complete original commissioning source and receiving packet to the existing Grant Operations case through its source controls. Use the actual retained source IDs and digests. Keep the original full commissioning JSON available as a private file.

From `stellar/scf_2026/sf47_budget_model`, use the existing commands:

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-workshares --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --source "$COMMISSIONING_SOURCE" --expected-source-sha256 "$COMMISSIONING_SHA256" \
  --packet-source "$PACKET_SOURCE" --expected-packet-sha256 "$PACKET_SHA256" \
  --output "$PRIVATE_INPUT/original-workshares.json"

python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-workshare-seed --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --source "$COMMISSIONING_SOURCE" --expected-source-sha256 "$COMMISSIONING_SHA256" \
  --packet-source "$PACKET_SOURCE" --expected-packet-sha256 "$PACKET_SHA256" \
  --workshare-case "$COMMERCIAL_CASE" --expected-revision 0 \
  --output "$PRIVATE_INPUT/original-seed.json"
~~~

This prepares a new PLANNED Installation with original OPEN checks. Later revisions use the existing saved Installation editor and ID, preserving observed checks and independent changes.

The original commissioning document is mandatory. Its selected commercial source, plan, phase count, full phase effort, total hours, fee and payment milestones must agree with the native Workshare seed. All commercial output is rebuilt from that retained original case.

## 3. Fill the actual operating selections

~~~sh
starforge flowable-installation template \
  --seed "$PRIVATE_INPUT/original-seed.json" \
  --directory "$PRIVATE_INPUT/flowable-bindings"
~~~

Edit the returned `bindings.json`. Select the actual customer source authority and case source IDs, merchant and independent buyer deployments, receiving host and operator. Where a paid resource is part of the actual customer course, select the original network, asset, recipient, atomic price, approved task budget, task units, terms and facilitators. Unselected numeric values remain null; exact atomic amounts remain strings.

The maintained `flowable-customer` profile provides the full commissioning and receiving course. Explicit customer wording is preserved. Empty source-reference and receiving-application fields gain the exact original programme/archive opening instructions.

## 4. Include complete additional working files

The whole archive already retains its saved source and history. Explicitly export additional original working documents that the receiving engineer needs.

Optional `attachments.json` binds all extra files to this exact source edition:

~~~json
{
  "schema": "stellar-forge.flowable-customer-installation.v1.attachments",
  "workspaceId": "ACTUAL_ORIGINAL_WORKSPACE_ID",
  "programmeId": "ACTUAL_PROGRAMME_ID",
  "programmeRevision": 1,
  "programmeSha256": "ACTUAL_PROGRAMME_SOURCE_SHA256",
  "basisSha256": "ACTUAL_NATIVE_BASIS_SHA256",
  "archiveSha256": "ACTUAL_FULL_ARCHIVE_SHA256",
  "files": [
    {
      "name": "customer/complete-working-document.json",
      "path": "/absolute/private/complete-working-document.json",
      "bytes": 123456,
      "sha256": "ACTUAL_WHOLE_FILE_SHA256",
      "purpose": "Complete customer-owned working document for this selected programme"
    }
  ]
}
~~~

Replace every example identity, revision and length with its actual value. The receiver permits 256 extra files, 256 MiB each and 1 GiB aggregate. The full Flowable archive limit is 256 MiB; each extracted original source file is limited to 128 MiB. Seed, bindings, profile and extra-file selection are limited to 2 MiB each, commissioning JSON to 8 MiB and each derived output to 64 MiB. The original Installation document remains within 128 KiB.

Ordinary SF47 case attachments remain subject to their original 8 MiB per-source and 24 MiB aggregate limits. Carry a large Flowable archive and full source report as mandatory whole sidecars. Preserve any case source selection using its original actual IDs.

## 5. Prepare and reopen the complete directory

Use the installed Linux Node runtime, original util-linux flock lease and owned canonical private directories outside the installed source. Parent directories must exist. The selected original source inputs are private regular files.

~~~sh
starforge flowable-installation prepare \
  --directory "$INSTALLATION_PREPARATION" \
  --archive "$PRIVATE_INPUT/flowable-workspace.ndjson" \
  --archive-sha256 "$ARCHIVE_SHA256" \
  --programme "$PROGRAMME_ID" \
  --programme-revision "$PROGRAMME_REVISION" \
  --programme-sha256 "$PROGRAMME_SHA256" \
  --basis-sha256 "$BASIS_SHA256" \
  --seed "$PRIVATE_INPUT/original-seed.json" \
  --bindings "$PRIVATE_INPUT/flowable-bindings/bindings.json" \
  --commissioning "$PRIVATE_INPUT/original-commissioning.json" \
  --attachments "$PRIVATE_INPUT/attachments.json"

starforge flowable-installation reopen \
  --directory "$INSTALLATION_PREPARATION"
~~~

Omit `--attachments` when no extra file is selected. The complete original preparation request freezes every input identity before output construction. Resume an interrupted preparation using the same directory and unchanged inputs. Completed reopen uses its retained bytes, reimports the original Flowable archive, reconstructs the native document and commercial outputs, and compares every complete selected file.

| Member | Contents |
| --- | --- |
| `prepare-request.json`, `preparation.json` | Original selection, full input/output inventory and completed preparation |
| `source/` | Full archive, seed, bindings, installed profile, commissioning JSON and extra-file selection |
| `attachments/` | Complete additional selected working files |
| `delivery/flowable-workspace.ndjson` | Entire unchanged original Flowable archive |
| `delivery/files/` | Original programme source/full views, operation records/reviews and source blobs |
| `FLOWABLE_CUSTOMER_SOURCE.json`, `.md` | Full selected source and opening instructions |
| `FLOWABLE_SOURCE_SELECTION.json` | Exact archive, full-report, programme and file identities |
| `installation-input.json`, `installation-preview-input.json` | Complete original native Installation document and preview selection |
| `WORKORDER.md` | Complete original technical commissioning workorder |
| `commercial.json`, `COMMERCIAL.md`, `commercial.html` | Full original commercial case, phase effort and terms |

## 6. Save or select the native Installation and receive both applications

Create a private `receiving.json` with absolute paths. Keep preparation, sender case, recipient case, recipient Flowable and output directories separate and outside installed source. Select the actual Python executable.

~~~json
{
  "preparationDirectory": "/absolute/private/flowable-preparation",
  "expectedPreparationSha256": "ACTUAL_PREPARATION_JSON_SHA256",
  "operationsWorkspace": "/absolute/private/original-customer-operations",
  "caseId": "ACTUAL_ORIGINAL_CASE_ID",
  "receivingOperationsDirectory": "/absolute/private/received-customer-operations",
  "receivingFlowableDirectory": "/absolute/private/received-flowable",
  "outputDirectory": "/absolute/private/complete-customer-receiving",
  "actor": "ACTUAL_RECEIVING_OPERATOR",
  "python": "/absolute/path/to/python3",
  "save": {
    "requestId": "ACTUAL_NEW_UUID",
    "note": "Actual operator instruction to save this complete customer Installation"
  }
}
~~~

The explicit `save` selection previews against the original case/version, retains its exact request before writing, and uses the existing native Installation save command. An uncertain save resumes that same request. To select an already saved historical Installation instead, remove `save` and provide its actual `installationId` and integer `installationRevision`. Its complete document must match the selected preparation.

~~~sh
starforge flowable-installation-receive \
  --input "$PRIVATE_INPUT/receiving.json"
~~~

Direct source invocation is `node stellar/scf_2026/sf49_data_commissioning/installation-workorders/flowable-installation-receiving.mjs`.

The receiver transfers every preparation input and output, exports the complete selected native case, validates it using the original SF47 archive unpacker, and restores the full Flowable archive through its original receiver. Every immutable Flowable record is compared and the receiving workspace is closed and reopened. The complete SF47 case is independently imported under the retained request, reopened, exported and compared with its original sources, selected Installation, saved editions and history prefix. Later legitimate receiving work remains in the original recipient.

The resulting `Flowable_Installation_Complete_Receiving.json` names both actual receiving workspaces, actual case and Installation IDs, all complete transferred files, both full archives and original request identities. Native command stdout/stderr and outcomes remain in `native/`. Any retry preserves the same original arguments and requests.

## 7. Operate the outgoing customer course

The producing operator opens and uses both exact outgoing applications at desktop and narrow widths, views every outgoing attachment and the usable archive contents, exercises important controls and downloads, and independently reopens the delivered customer work. Fix concrete defects in that same edition.

Use the original Installation desk to record actual commissioning, acceptance, funded work, purchases and later changes. Preserve the commercial Workshare's full scope, payment stages and maintenance obligations. Continue original native requests and customer programmes through their maintained application owners.

## Maintained implementation

The source preparer imports the existing `prepare-core.mjs`, `commercial-workshare-core.mjs`, original Flowable model/archive receiver and original initialization/lease utilities. The receiving command invokes the existing SF47 CLI and archive parser. Profile discovery uses the original installed catalogue. Both commands and all support files are distributed through the existing Flowable workspace contribution.

The new source is subject to focused original-contract review and module parsing. Native customer receiving and rendered acceptance are established by running the command and operating the actual outgoing applications with their selected original customer source.

## Producing operator instruction

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

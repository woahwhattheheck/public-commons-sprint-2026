# Geoapify customer Installation and complete receiving

Receive a selected frozen Geoapify dataset and its complete original workspace into the existing SF47 Customer installations and commercial Workshare. The preparer retains source history, actual provider responses, reviewed coordinate decisions, unfinished forms, the original commissioning seed and operator selections. It prepares the original native Installation input and full workorder for that customer case.

## Customer responsibilities and exact selections

The source owner authorizes the complete address population and downstream use. The source reviewer owns address interpretation and coordinate decisions. The merchant, independent buyer, payer and receiving engineer retain their actual service/payment/host responsibilities. Geoapify API usage stays on the selected authorized provider account. The commercial implementation fee, effort, milestones and acceptance remain in the complete original Workshare; grant-funded assignments remain in the original seed.

A provider confidence value does not establish that an address is correct. Original coordinates, provider geometry and the selected published pair remain separate. A business identity may repeat across legitimate original records. The source comparison never pairs duplicate or missing IDs by position. A retained source file or prepared Installation has its own meaning; original purchases and operated acceptance stay in their existing native operations.

## 1. Select and export the complete original source

In the [Geoapify workspace](../../../scf-starforge-20261009/sf30-seller-sdk/geoapify/README.md), save working forms, build and inspect the intended frozen dataset, and record its full edition ID. Export the complete **starforge-geoapify.json.gz** workspace through Delivery. Retain its actual whole-byte SHA-256 from the original export record.

The selected commissioning edition may differ from both the archive's active editor source and its active customer edition. The inspector keeps all three identities explicit. It receives the supplied full archive; it does not acquire the live workspace's writer lease or alter its account/jobs.

The installed Geoapify selection includes:

~~~sh
starforge geoapify-installation inspect \
  --archive "$PRIVATE_INPUT/starforge-geoapify.json.gz" \
  --archive-sha256 "$ARCHIVE_SHA256" \
  --edition "$EDITION_ID"
~~~

Direct source uses node stellar/scf_2026/sf49_data_commissioning/installation-workorders/geoapify-installation.mjs with the same arguments.

The shared package inspector is also the original workspace restore validator. It verifies full gzip/JSON limits, ordinary member paths, every original byte count and SHA-256, complete original CSV/JSON reparsing and field mapping, all job/request/input/response bindings, decision source identities, fixed source comparisons and frozen edition identities. It evaluates the original review projection and runs the actual native dataset reader against the retained CSV/config in a private temporary directory. That temporary directory is removed after validation.

The selected output contains the original dataset.csv, dataset.json, dataset.geojson, address-review.json, review.html and basis.json unchanged. A following source includes its retained source-comparison.json and, when present in the supplied archive, the original complete source-comparison.html. Current workspace exports retain that report inside the full package as an additional frozen-edition file. Earlier packages may lack that optional report; the inspector accurately lists the files they actually contain.

The preparer never invents seller.json, query.json, source.json, payment terms or another geocoding result. Configure and publish a paid resource through the original Geoapify/SF30 publisher when the actual merchant and buyer select that operation.

## 2. Receive the original customer Workshare seed

Attach the complete commissioning source and receiving packet to the original Grant Operations case using their actual source IDs and SHA-256 identities. This factory prepares a fresh PLANNED Installation. Continue an already saved Installation through its original **Use this edition as a draft** flow; keep its existing revision and observations there.

For a new Installation, use the original commands from sf47_budget_model:

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

Keep the entire actual seed. It binds the case/version, pinned plan/revision/digests and original commercial Workshare. Original checks remain OPEN. If the customer commercial case has not yet been selected, retain the complete product/archive and obtain that original selection through the existing case; do not substitute a fabricated commercial record.

## 3. Fill actual operator bindings

~~~sh
starforge geoapify-installation template \
  --seed "$PRIVATE_INPUT/original-seed.json" \
  --directory "$PRIVATE_INPUT/geoapify-bindings"
~~~

Edit the complete returned bindings.json. Select actual original source/authority IDs, merchant and independent buyer deployments, receiving host/operator, payment authority, network/asset/recipient, exact atomic unit price and whole-task budget where those values apply. Unselected numeric values stay null; atomic quantities stay strings. The original professional implementation fee stays in the Workshare.

The installed geoapify-customer profile describes the complete address-source/review/recurring-edition/customer course. The original bindingTemplate and prepareInstallation functions preserve workorder, funded assignments, checks, complete Workshare, workflow periods and coordination. A blank source reference gains the selected archive/workspace/edition/intake identity; a blank receiving application gains the maintained full-source opening instruction. Explicit original customer wording remains intact.

## 4. Retain additional unfinished work

Saved source-specific forms are already inside the full workspace archive. Selected local files not yet imported are not retained by a file picker alone. Save or explicitly export any other complete original working document/report needed by the receiving engineer.

Optional attachments.json binds those whole files to the exact source workspace and selected edition:

~~~json
{
  "schema": "stellar-forge.geoapify-customer-installation.v1.attachments",
  "workspaceId": "ACTUAL_ORIGINAL_WORKSPACE_ID",
  "editionId": "ACTUAL_RETAINED_EDITION_ID",
  "files": [
    {
      "name": "analyst/complete-working-document.json",
      "path": "/absolute/private/complete-working-document.json",
      "bytes": 123456,
      "sha256": "ACTUAL_64_CHARACTER_SHA256",
      "purpose": "Original unfinished customer preparation for this frozen source edition"
    }
  ]
}
~~~

Replace example lengths and identities with actual whole-file values. At most256 additional files,256MiB each and1GiB aggregate are received. The native compressed workspace limit is256MiB, expanded JSON512MiB. Original seed/bindings/selection/profile JSON is limited to2MiB. The original Installation document keeps its128KiB limit; complete derived metadata/workorder outputs stay within32MiB. Exceeding a limit retains the originals and reports the exact input requiring a complete supported selection.

## 5. Prepare the whole private commissioning directory

Use the installed Linux Node runtime and original util-linux flock lease. Select owned canonical private directories outside installed source/dependencies. The original parent directory must already exist. Inputs/outputs retain private modes and create-only byte identities.

~~~sh
starforge geoapify-installation prepare \
  --directory "$INSTALLATION_RECEIVING" \
  --archive "$PRIVATE_INPUT/starforge-geoapify.json.gz" \
  --archive-sha256 "$ARCHIVE_SHA256" \
  --edition "$EDITION_ID" \
  --seed "$PRIVATE_INPUT/original-seed.json" \
  --bindings "$PRIVATE_INPUT/geoapify-bindings/bindings.json" \
  --attachments "$PRIVATE_INPUT/attachments.json"
~~~

Omit --attachments when no extra original file is selected. The installed profile and attachment selection are retained before the stable preparation request, so they survive an interruption without an external source path. The original request records all remaining exact input identities and paths before receiving them.

| Retained file | Purpose |
| --- | --- |
| source/starforge-geoapify.json.gz | Complete original source workspace and all retained history |
| source/seed.json | Original case, pinned plan and commercial Workshare seed |
| source/bindings.json and source/profile.json | Actual operator selections and complete installed profile |
| source/attachments.json and attachments/ | Entire declared additional working-file selection and bytes |
| delivery/starforge-geoapify.json.gz | Unchanged whole workspace for the independent receiving operator |
| delivery/files/ | Exact selected dataset, full address review, basis and applicable source comparisons |
| GEOAPIFY_CUSTOMER_SOURCE.json and .md | Full original source, archive, selected/current identities and native Installation selection |
| derived-bindings.json | Original bindings with blank source/application references filled |
| installation-input.json | Complete original native Installation document |
| installation-preview-input.json | Original expected case/revision plus complete document |
| WORKORDER.md | Full task, responsibility, original terms, source implementation and missing selections |
| prepare-request.json and preparation.json | Original stable request, whole input/output identities and prepared outcome |

No invoice, price, funded assignment, purchase or acceptance observation is created by preparing these files.

## 6. Resume and independently reopen

Continue the same retained preparation request:

~~~sh
starforge geoapify-installation prepare --directory "$INSTALLATION_RECEIVING"
~~~

If interruption preceded prepare-request.json, repeat the same full original prepare arguments. Already received complete inputs are retained. A missing input uses its original private path, or an explicitly supplied path containing the identical selected bytes. A changed source, seed, binding or attachment belongs in a separate deliberate preparation edition.

Copy the entire completed private directory to the receiving host and reopen without the producer's original input paths:

~~~sh
starforge geoapify-installation reopen --directory "$RECEIVED_INSTALLATION"
~~~

Reopening verifies every retained original input, full archive, selected file and derived output. It reconstructs the original Installation from the retained seed/profile/bindings and compares the complete output bytes. Exact edition/archive constraints may be supplied; no live provider account call occurs.

Restore delivery/starforge-geoapify.json.gz into a distinct empty Geoapify workspace through its original package.import operation. Open the private browser, inspect every source/job/decision/form/edition and deliberately select the commissioning edition when it differs from the archive's active selection. Open every file under delivery/files/ and each additional attachment in its intended recipient application.

## 7. Preview and save the existing Customer Installation

In the same Grant Operations case, use **Customer installations → Load input file** with the complete installation-input.json. Review actual Workshare, plan, source, task, merchant/buyer, payment, receiving responsibilities, funded package assignments and OPEN checks. Fill actual missing selections through the original editor.

Preview and save using the original native case/revision writer and retain its exact request and first outcome. If the case changed, receive a fresh original seed and deliberately prepare the next edition. Recover an uncertain save through that original operation.

Record observed results only after the named operator completes the actual course. Export and independently reopen the complete original Operations case alongside the unchanged Geoapify/archive/Installation receiving directory. Preserve all original identities, current drafts and later receiving work.

## Rendered product and every outgoing attachment

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949



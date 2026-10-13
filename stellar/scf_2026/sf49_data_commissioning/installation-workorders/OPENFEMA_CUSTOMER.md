# Public Assistance customer Installation and complete receiving

Carry one complete original OpenFEMA customer delivery into the existing SF47 Customer installations workflow. The preparer retains the complete source workspace, exact native delivery, original commercial Workshare, operator selections and any explicitly selected unfinished working files. It produces the original native Installation input and preview for the existing case.

## Complete customer workflow and responsibilities

Use the maintained [Public Assistance product](../../../../products/openfema/OPERATING.md) to receive complete official source editions, select a useful portfolio, review the customer's actual target schema, issue a mapped project register and receive the customer's full return. Record deliberate analyst decisions through the original reconciliation/apply operation, then reissue and compare the next delivery.

The source analyst owns the public cohort and field interpretation; the customer reviewer owns its decisions and target-system meaning; the merchant and independent buyer retain their actual resource/payment responsibilities. The named receiving engineer restores and continues the complete application. Original commercial phases, effort, fee, payment milestones and acceptance remain in the customer's Workshare. The grant case retains its existing funded assignments and independently selected installation cohort.

Published obligated-project records are not a census of all damage or pending applications. Keep project cost, federal obligation, total obligation and mitigation as separate exact USD measures. Keep customer-only/pre-obligation rows, source changes and reviewer decisions distinguishable. A source record, download, preparation or buyer file has its own meaning; none substitutes for an actual purchase or accepted commissioning result.

## 1. Receive the exact complete source edition

From the original running OpenFEMA application, use **Data integration** to select a retained project delivery. Record its exact delivery ID and selected portfolio/version. Export **Handover → Complete workspace ZIP** after that delivery is retained. A customer project ZIP by itself is not the complete source workspace.

Keep the full workspace ZIP and its actual SHA-256, obtained from the original export/download record. The maintained merchant downloader and native workspace handover retain the same source; use their entire file, not a browser preview or a selected row sample. The original application can remain available while this archive is inspected: the preparation reads the immutable complete ZIP and does not open that live workspace as a writer.

The installed **openfema-portfolios** product includes:

~~~sh
starforge openfema-installation inspect \
  --archive "$PRIVATE_INPUT/OpenFEMA_Complete_Workspace.zip" \
  --archive-sha256 "$ARCHIVE_SHA256" \
  --delivery "$DELIVERY_ID"
~~~

The result identifies the native UUID/revision, selected delivery, portfolio version, source edition/scope, mapping review, exact financial summary and every full customer file. The inspector uses the original workspace archive parser, verifies its whole manifest and selected objects, opens the native project ZIP, and rederives the original delivery from its retained portfolio, reviewed mapping and optional customer reconciliation.

The complete issued recipient HTML/project, original target CSV, report and target definition travel unchanged. A delivery from an earlier source release may have no recipient editor. A current delivery may retain the original capacity-specific recipient availability result. In either case, preserve the whole native customer ZIP and use the original full CSV route described in that delivery; the preparer never generates a different customer result.

## 2. Obtain the customer's fresh original Workshare seed

In the original Grant Operations case, attach the full commercial commissioning source and matching complete receiving packet. Use their existing source IDs and SHA-256 values. Continue a saved Installation through **Use this edition as a draft**. This preparer creates a fresh PLANNED input, so an existing Installation's current revision/observations stay in its original editor.

For a new Installation, run the original commands from sf47_budget_model:

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

Keep the complete returned seed. It selects the same case/version, pinned plan/revision/digests and commercial Workshare. Its checks remain OPEN. The original [Installation guide](../../sf47_budget_model/workspace/INSTALLATIONS.md) and [workorder operating guide](README.md) describe the current native lifecycle.

## 3. Fill explicit operator bindings

Create a separate private directory for the editable binding template:

~~~sh
starforge openfema-installation template \
  --seed "$PRIVATE_INPUT/original-seed.json" \
  --directory "$PRIVATE_INPUT/openfema-bindings"
~~~

Edit the returned **bindings.json** as a complete file. Select the actual source authority and original source IDs, deployed merchant and independent buyer IDs, named receiving operator/host, payment authority, network/asset/recipient, exact atomic unit price, useful task count and whole-task budget where those original values apply. Keep unselected numbers null and atomic values as strings. The original Workshare carries the professional implementation fee separately.

The preparer fills a blank source reference with the selected archive, delivery, version and source identities, and supplies the maintained receiving application. Explicit customer wording stays intact. The source annex always retains the entire selection.

The template calls the same maintained bindingTemplate function as **grant-installation-workorder**. It uses the installed **openfema-customer** profile; that profile is also discovered automatically by the original workorder catalogue. The selected OpenFEMA package carries the necessary original factory and loader with this command.

## 4. Include complete unfinished work

A native workspace archive contains committed native state and source files. A browser's unfinished working copy or recipient preparation is a separate full file. Export that complete JSON or HTML through the original product before receiving it here.

An optional **attachments.json** binds every selected original file to the same workspace and delivery:

~~~json
{
  "schema": "stellar-forge.openfema-customer-installation.v1.attachments",
  "workspaceId": "ACTUAL_ORIGINAL_WORKSPACE_UUID",
  "deliveryId": "ACTUAL_RETAINED_DELIVERY_ID",
  "files": [
    {
      "name": "analyst/complete-working-copy.json",
      "path": "/absolute/private/complete-working-copy.json",
      "bytes": 123456,
      "sha256": "ACTUAL_64_CHARACTER_SHA256",
      "purpose": "Complete unfinished analyst preparation for the selected original delivery"
    }
  ]
}
~~~

Replace the example length and hash with the actual whole-file values. Select every applicable working export, document and report needed to continue the customer work; preserve original content. The receiver permits 256 files, each up to 256 MiB, with one GiB aggregate. The native archive limit is one GiB. Each original seed/bindings/selection JSON is limited to two MiB, and the native Installation document retains its existing 128 KiB limit. Exceeding a limit stops with the originals intact.

Optional attachments retain their declared role as operator-supplied preparation. The original native delivery and its source identities remain independently verified. A recipient may carry edits beyond the selected issued delivery; its full working file and history make that distinction visible.

## 5. Prepare the entire private commissioning package

The Linux runtime uses the installed Node and original util-linux flock lease. Use owned canonical private directories (0700) and full private input files (0600), outside the installed source/dependency paths. The output parent must already exist.

~~~sh
starforge openfema-installation prepare \
  --directory "$INSTALLATION_RECEIVING" \
  --archive "$PRIVATE_INPUT/OpenFEMA_Complete_Workspace.zip" \
  --archive-sha256 "$ARCHIVE_SHA256" \
  --delivery "$DELIVERY_ID" \
  --seed "$PRIVATE_INPUT/original-seed.json" \
  --bindings "$PRIVATE_INPUT/openfema-bindings/bindings.json" \
  --attachments "$PRIVATE_INPUT/attachments.json"
~~~

Omit **--attachments** when no additional working file is selected. The complete original request is retained before receiving source files. Every received input/output is create-only and byte-checked on continuation. A single native lease owns the directory.

| Full retained file or directory | Receiving purpose |
| --- | --- |
| source/OpenFEMA_Complete_Workspace.zip | Every original public response, object, source edition, customer file, review, delivery and native operation |
| source/seed.json | Exact original case, pinned plan and commercial Workshare seed |
| source/bindings.json and source/profile.json | Explicit operator selections and full installed technical profile |
| source/attachments.json and attachments/ | Entire optional working-file selection and original bytes |
| delivery/OpenFEMA_Project_Delivery.zip | Exact selected original customer ZIP |
| delivery/files/ | Every complete original customer member, including applicable recipient editor/project |
| OPENFEMA_CUSTOMER_SOURCE.json and .md | Full source/delivery/mapping identities, file inventory and original Installation selection |
| derived-bindings.json | Selected bindings with blank source/application references filled |
| installation-input.json | Complete original native Installation document |
| installation-preview-input.json | Original expected case/revision and complete document for preview |
| WORKORDER.md | Complete task, responsibilities, original terms, implementation and missing selections |
| prepare-request.json and preparation.json | Stable request, exact input/output identities and completed preparation |

The original prepareInstallation function preserves workorder, funded assignments, checks, full Workshare, workflow periods and coordination. The technical profile adds the full public-source/customer workflow. It does not choose a new fee, funded scope, deployment or acceptance observation.

## 6. Resume and independently reopen

Once **prepare-request.json** is retained, continue an interrupted preparation using its same owned directory:

~~~sh
starforge openfema-installation prepare --directory "$INSTALLATION_RECEIVING"
~~~

If receiving stopped before **prepare-request.json** was retained, repeat the same complete original prepare arguments; the already retained installed profile/attachment selection must remain exact. Already received complete inputs are reused. Any missing original input is read from its retained original private path, or from an explicitly supplied replacement path containing exactly the same selected bytes. A changed archive, seed, bindings or attachment requires a separate preparation edition. Preserve the earlier one.

After preparation, copy the entire private directory to the receiving host, preserving private modes. Reopen it without the producer's original paths:

~~~sh
starforge openfema-installation reopen \
  --directory "$RECEIVED_INSTALLATION"
~~~

The command checks every retained input, complete original archive, customer ZIP and member. It rederives all native outputs from the retained seed/profile/bindings and selected source, then verifies the completed manifest. A missing or changed file is reported without replacing customer work.

Open every applicable report and recipient editor from **delivery/files/**. Download/reopen the complete recipient preparation through its original interface; restore the native ZIP through the original **openfema restore** route into a distinct private directory, then open that workspace through Applications. Use the full [OpenFEMA receiving guide](../../../../products/openfema/RECEIVING.md) for exact native restore and ordinary browser steps. Opening the source inspector alone does not complete the customer operating course.

## 7. Preview, save and receive the original Installation

In the same Grant Operations case, open **Customer installations → Load input file** and choose the complete **installation-input.json**. Inspect the selected Workshare, plan, tasks, source, payments, receiving responsibilities, funded packages and OPEN checks. Resolve the actual missing selections listed in **preparation.json** or **WORKORDER.md**.

Preview and save through that original native writer with its current case/revision checks. Preserve its exact request and first native outcome. If the case changed, obtain a fresh original seed and deliberately compose a separate preparation edition; retain the earlier complete source. Continue an uncertain dispatched save through its existing operation instead of making another Installation.

Record actual operating observations in the existing Installation checks after the named operator completes them. Export the full original case and reopen it through the maintained original importer. Keep its returned case/plan IDs and origin with the complete OpenFEMA/commissioning files. This supports the existing commercial and grant workflow without changing the prospective grant budget or declaring customer acceptance from source preparation.

## Rendered product and every outgoing attachment

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949


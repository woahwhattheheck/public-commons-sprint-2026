# Customer installation operations

The **Customer installations** desk completes the commissioning-to-receiving workflow inside the existing SF47 operating case. An installation describes the customer's whole task, original source and commercial terms, selected merchant and buyer deployments, receiving application, maintainer and assigned funded work. Its acceptance steps select the existing work, purchase, outcome and source records.

Each save appends an immutable edition. A later source observation or installation edit leaves earlier editions readable. The complete original Operations ZIP carries every saved edition, the native planner history, the case event history and all retained attachments. **Export complete handover** also includes a selected-edition marker and a readable offline installation document. Importing that ZIP opens the selected edition in the receiving case.

## Operate the complete workflow

1. Open the existing **Grant planning and delivery** application and select its retained operating case. Use the existing Merchant support, Native buyer receiving and Sources controls to receive original files and records. The native source owner keeps the original workorder and commercial terms.
2. Open **Customer installations** and choose **New installation**. The input starts with the selected funding plan's original work packages and measurable acceptance criteria.
3. Select the original merchant and buyer deployments and complete workorder attachment. Enter the commissioning payer, implementation assignment and original terms. Describe the whole useful request, complete output, priced unit and event that makes another result useful.
4. Record the source population, keys, types, units, time meaning, rights and change procedure. Choose snapshot, live or mixed behavior and select the exact original source attachments.
5. Enter the original payment network, asset, recipient and atomic unit price. Enter the expected priced units and aggregate task budget. Retain the buyer's actual spending authority and facilitator selections. The review multiplies exact whole atomic amounts; it does not convert currencies or price a different asset.
6. Name the receiving application/version, authorized host, operator, output-acceptance rule, second-operator change or withdrawal procedure, recovery and ongoing maintenance destination.
7. Assign the original funded work packages and separate commercial reference. For each acceptance step, select original work, purchase, outcome or attachment records. An accepted step retains its criterion, actual observing operator, timestamp and result. A step marked not applicable retains its reason.
8. Choose **Review complete installation**. The review shows configuration decisions, acceptance steps, exact entered task amount, original recorded/accepted work hours by funding basis and work package, and original purchase amounts grouped by network and asset. Resolve fields by editing the complete input, then preview again.
9. Enter the reason for this saved edition and choose **Save reviewed edition**. The original case transaction appends the edition, case event and request result together. The browser reopens that exact saved edition.
10. Use **Export complete handover** for the selected edition. Another operator uses the existing **Import complete case** control, reads the offline installation document, opens the selected saved edition and continues the same original case workflow.

The desk can save an installation during planning or commissioning with open decisions. The stage, configuration completeness and accepted-step count remain separate fields, so an unfinished customer assignment can be worked and handed between operators without manufacturing acceptance.

## What an edition retains

| Area | Retained information |
| --- | --- |
| Installation | Stable installation ID, monotonically increasing edition, name, stage, original case save version, save time, operator and reason. |
| Original commissioning | Exact source attachment ID, workorder reference, payer, complete implementation assignment and original commercial terms. |
| Whole task | Task name, customer purpose, complete request, complete output, repeat trigger and merchant priced unit. |
| Source | Selected original file IDs, edition or live-operation reference, source behavior, complete population, keys/types/units/time, authority, change and withdrawal policy. |
| Payment | Original network, asset, recipient, unit price, priced-unit count, task budget, spending authority, terms files and distinct facilitator operator/endpoint selections. |
| Receiving | Application/version, authorized host, receiving operator, useful-output acceptance, independent change/withdrawal, recovery, maintenance and source files. |
| Delivery assignments | Original funded work-package IDs, separate commercial workorder reference and actual funding/effort assignment. |
| Acceptance | Stable step ID, title, criterion, tranche, requirement, state, observing operator/time, result/correction and selected original source/work/purchase/outcome IDs. |
| Frozen operating context | The selected original rows, their contributor/source closure, the pinned funding plan, the retained report and field changes from the preceding edition. |
| Identity and lineage | Complete edition SHA-256, reviewed preview SHA-256, original source case/plan identities and preceding edition ID/revision/SHA. |

Existing purchase observations remain on their original deployment. An installation cannot select a purchase belonging to an unrelated deployment. Original work keeps its original funding basis and cost package; the review identifies selected work outside the installation's assignment.

The default six SCF work-package criteria come from the case's pinned source scenario. The Installation desk does not contain a second copy of the funding schedule. A case imported from another valid selected plan uses that plan's actual work packages and criteria.

## Corrections, saved history and interrupted work

**Editing a saved edition.** Open the edition and choose **Use this edition as a draft**. Saving appends the next edition with a reason. Every earlier edition stays available in the paged saved history.

**Using a historical edition.** A historical edition can become a draft for the current installation. Its next save appends after the current saved head; the old edition and intervening edits remain available. The preview captures current selected native records while retaining the entered acceptance observations and original attached files.

**Later changes in the operating case.** Reopening a saved edition compares its selected source and original rows with the current case. The operator can inspect the frozen edition and prepare a new one from current records. The case version and installation edition are both checked before a save.

**Uncertain save response.** The browser retains the original request ID, full body and edited input before sending. **Recover original save** sends that identical request. The native request journal returns the first committed result before applying version checks. If the original save succeeded but its readback was interrupted, **Open saved result** reads the exact returned edition and verifies its retained identity.

**Typing during a save or readback.** Later form edits remain in the draft. A successful save advances that draft's base to the saved edition while preserving those edits for its next preview. Navigating away keeps the original save's result in the retained session.

**Input files.** **Download full draft** emits the complete editable document. **Load input file** validates a complete document against the selected current case before replacing the draft. If the operator typed later changes during that read, the loaded input is retained as another draft and the later edits remain open.

Drafts use the browser's existing session storage plus the retained Operations view session. If local storage fills, the desk provides a download instruction while keeping the in-memory draft. The saved native edition and request result remain in the original workspace database.

## Native API and typed client

All routes retain the existing original local application's authentication and case ownership. Read routes return original JSON; selected handovers and source files are downloads.

| Operation | Existing service route | Typed client |
| --- | --- | --- |
| List current saved heads | GET /api/operations/{case}/installations | read('installations', {caseId}) |
| Read saved edition | GET /api/operations/{case}/installations/{id}?revision=N | read('installation', {caseId, installationId, revision}) |
| Page earlier editions | GET /api/operations/{case}/installations/{id}/history?before=N&limit=25 | read('installation-history', {caseId, installationId, before, limit}) |
| Seed complete input | POST /api/operations/{case}/installation-seed | installationSeed(caseId, expectedVersion) |
| Preview complete input | POST /api/operations/{case}/installation-preview | installationPreview(caseId, body) |
| Save reviewed edition | POST /api/operations/{case}/command, action installation.save | installationSave(caseId, body) |
| Selected complete-case handover | GET /api/operations/{case}/installations/{id}/export.zip?revision=N | download('installation', {caseId, installationId, revision}) |
| Receive complete handover | POST /api/operations/import | importBundle('case', bytes, body) |

The preview body is:

~~~json
{
  "expectedVersion": 37,
  "installationId": null,
  "expectedRevision": 0,
  "document": {
    "...": "Use the complete document returned by installation-seed."
  }
}
~~~

A new installation selects installationId null and expectedRevision zero. An edit selects the retained installation ID and its current edition. The seed result contains the complete editable document at /document and its original source at /source.

The save client body adds requestId, actor, note and expectedPreviewSha256 to the same preview fields. The original command shape is:

~~~json
{
  "expectedVersion": 37,
  "requestId": "original-installation-save-01",
  "actor": "Actual recording operator",
  "note": "Reason for saving this complete installation edition",
  "action": "installation.save",
  "data": {
    "installationId": null,
    "expectedRevision": 0,
    "document": {
      "...": "The same complete reviewed installation document."
    },
    "expectedPreviewSha256": "The exact preview SHA-256"
  }
}
~~~

The documentation examples name the envelope fields; the complete input is supplied by the native seed or a downloaded actual draft. No fields are inferred from the placeholder examples.

The original case import result includes selectedInstallation with id, revision and sha256 when the imported ZIP selected an edition. The imported case receives its own case/plan IDs and retains all original installation identities, original selected source identities and case history.

## Original MCP operation

The existing grant-workspaces provider exposes:

- merchant_grant_installations
- merchant_grant_installation
- merchant_grant_installation_history
- merchant_grant_installation_seed
- merchant_grant_installation_preview
- merchant_grant_installation_save
- merchant_grant_export with kind installation and the required saved revision

Preview and save take the complete document as inputs, or through the existing verified original input/snapshot/transfer reference. inputPointer selects /document from an original seed or /preview/document from a saved edition. expectedInputSha256 identifies the full selected file before pointer selection.

Saving requires the original request ID, operator, reason, current case version, selected installation ID or null, current edition or zero, and reviewed preview SHA. The native service remains the mutation authority. Complete responses use the provider's existing immutable snapshot, pointer, array paging and original file-transfer operations.

## CLI

Use the original workspace CLI. The example directory and case/edition values are operator selections; substitute the actual original values returned by your workspace.

~~~sh
python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installation-seed --case operation-ORIGINAL --expected-version 37 \
  --output /absolute/private/output/installation-seed.json

python3 -c 'import json,pathlib; p=pathlib.Path("/absolute/private/output"); s=json.loads((p/"installation-seed.json").read_text()); (p/"installation-input.json").write_text(json.dumps(s["document"],indent=2)+"\n")'
~~~

Edit the complete installation-input.json, then:

~~~sh
python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installation-preview --case operation-ORIGINAL --expected-version 37 \
  --expected-revision 0 --document /absolute/private/output/installation-input.json \
  --output /absolute/private/output/installation-preview.json

python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installation-save --case operation-ORIGINAL --expected-version 37 \
  --expected-revision 0 --document /absolute/private/output/installation-input.json \
  --expected-preview-sha256 ORIGINAL_PREVIEW_SHA256 \
  --actor "Actual recording operator" --request-id original-installation-save-01 \
  --note "Complete commissioning assignment and original receiving design"

python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installation-show --case operation-ORIGINAL --installation installation-ORIGINAL --revision 1

python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installation-history --case operation-ORIGINAL --installation installation-ORIGINAL --limit 25

python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installation-export --case operation-ORIGINAL --installation installation-ORIGINAL --revision 1 \
  --output /absolute/private/output/complete-installation.zip

python3 workspace/cli.py operations --workspace /absolute/private/receiving-workspace \
  import --file /absolute/private/output/complete-installation.zip \
  --name "Received complete installation" --actor "Actual receiving operator" \
  --request-id original-installation-receive-01
~~~

The CLI's private output publication preserves an existing filename. Reopen a completed original output before requesting a different export destination. Original request IDs recover saves and imports; reading or exporting an edition does not replay a merchant purchase.

## Archive and source composition

Installations use the original database and request journal. One additive ops_installations table stores immutable edition rows under their original case. The current head references participate in the original business review, so closing a case against an older installation review detects a changed installation.

The original Operations document includes installations and installationRefs when the case has saved editions. Older complete cases that omit them continue to import. The selected handover adds:

- installation-selection.json: original export case/version, selected installation ID, edition SHA and readable-document byte identity.
- installation.html: a complete industrial grayscale document with the saved input, selected original observations, funding/work report, acceptance steps, changes and links to the original attachment members.

The receiver validates complete edition identities, normalized inputs, original plan, selected source and record closure, recalculated reporting, consecutive prior-edition references and original save events before importing the plan or case. It preserves the exact received readable rendition across later template changes; native operation always uses the normalized saved edition.

All source files remain in the existing sources/ members. The original planner ZIP, original case event/review history, Cohort and Completion preparations, forecasts, portfolios and every earlier Installation edition travel in the same complete case. The existing 32 MiB archive and original-source bounds apply to the complete handover.

For maintained source adoption, include operations_installations.py, operations_installations.mjs and operations_installations.css together with the composed Operations, HTTP, CLI, agent-client/catalog/provider and managed-launch joins. Reopen the selected managed application after adopting a changed native source selection, then continue the original case and its saved request IDs.

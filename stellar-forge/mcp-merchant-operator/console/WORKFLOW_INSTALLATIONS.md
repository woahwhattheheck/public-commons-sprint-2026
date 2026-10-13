# Customer periods in a saved Installation

A returning customer's complete work can now become an operating edition in the existing Grant Operations **Customer installations** desk. The input carries the original Console profile, every explicitly selected customer file and a native report for each dispatched period. The saved Installation retains the customer's actual receiving observation, its original work and payment records, and the funded implementation assignment.

This joins the maintained [recurring-work procedure](WORKFLOW_SERIES.md), native workflow reports and [Installation desk](../../../stellar/scf_2026/sf47_budget_model/workspace/INSTALLATIONS.md). Use the original series owner for execution and the existing receiving operator for acceptance. The complete source package can also be opened offline.

## Prepare the complete source

First finish or reopen the original recurring task. In the Console, retain its saved series, original cycle and native run. Receive each selected completed customer delivery through **Customers**. Capture that complete profile and its files using the existing command:

~~~sh
starforge merchant-workflow-series capture \
  --url ORIGINAL_CONSOLE_URL \
  --profile ORIGINAL_PROFILE_ID \
  --directory /absolute/private/customer-periods
~~~

Use the original repeated --delivery options when selecting particular complete customer deliveries. An interrupted capture continues from its same directory and fixed profile selection. A later profile or another period uses a new capture directory, keeping the earlier original source intact.

Create a UTF-8 selection file naming the actual cycle IDs and the actual customer deliveries that belong to the receiving assignment:

~~~json
{
  "periods": [
    {
      "cycleId": "ORIGINAL_FIRST_CYCLE_ID",
      "deliveryIds": ["ORIGINAL_FIRST_DELIVERY_ID"]
    },
    {
      "cycleId": "ORIGINAL_LATER_CYCLE_ID",
      "deliveryIds": ["ORIGINAL_LATER_DELIVERY_ID"]
    }
  ]
}
~~~

Replace the example identifiers with the IDs returned by the original Console. A period which needs no separate customer delivery uses an empty deliveryIds array. Its complete native inputs and results remain in the profile and report. The selection explicitly relates a cycle to customer deliveries because the original records do not assert that relationship automatically. A delivery selected for several periods retains its one complete file set in the package.

Package the source:

~~~sh
starforge merchant-workflow-series installation \
  --directory /absolute/private/customer-periods \
  --input /absolute/private/installation-periods.json \
  --output /absolute/private/customer-operating-source.zip \
  --python /absolute/python3
~~~

From a source checkout, replace starforge merchant-workflow-series with:

~~~sh
node stellar-forge/mcp-merchant-operator/console/workflow-series-cli.mjs
~~~

This command reopens the original complete-directory reader, validates the captured Console profile through its maintained validator, and generates each selected run's report through the original report engine. The existing Python source reader packages and independently reopens the full output. It needs the selected original Python executable and a Node release which supports the Console's native node:sqlite import, currently Node 24 in the maintained runtime.

The output filename is retained. Repeating this command with the same complete inputs reopens identical completed bytes. Different bytes require a different output filename. If the original process is interrupted, inspect and continue its same original capture and output. Packaging does not start or resume a workflow run.

### What travels in the ZIP

| Path | Retained material |
| --- | --- |
| profile.json | The complete original Console profile, source workspace, host bindings, request revisions, returns, workflow definitions and runs, recipes, series editions, cycles, cancellation records and customer metadata |
| selection.json and handover.json | The original fixed capture selection, native content identities and complete available-file inventory |
| customers/DELIVERY_ID/files/… | Every byte of each captured customer delivery, under its original relative filename |
| reports/RUN_ID.json | The original native report packet, selected complete run and original request/return closure |
| installation-workflow.json | Original profile and source identities, explicit cycle-to-delivery selection, and exact file lengths and SHA-256 values |
| index.html | A grayscale offline opening page with the customer task, periods, native recorded outcomes and complete-file links |

Keep the whole ZIP. Extraction is optional for reading the offline page; attach the complete ZIP to receive it into Grant Operations. A source package is limited to 32 MiB compressed and expanded, 4,096 members and 100 selected periods. The original Installation editor supports 100 acceptance steps in total, including the existing funded-plan steps. Select the actual complete customer assignment within those capacities. Each saved case handover also remains subject to its original total archive capacity.

The captured full profile preserves metadata for customer deliveries outside the selected file set. The receiving inventory shows those original otherDeliveries records and their original source locations/reasons. Their files can be obtained through their original receiving operation.

## Receive and operate in the browser

1. Open the original **Grant planning and delivery** application and the retained operating case.
2. In **Sources**, attach customer-operating-source.zip as an original complete source. Retain its returned source identity, exact hash, source reference and observation time.
3. Open **Customer installations** and choose **Receive customer periods**. Select the complete source ZIP and choose **Read original customer periods**.
4. Review the original profile, customer task, source edition, cycle dates, recorded native run, recovered steps and complete customer filenames. Select the periods needed for this receiving assignment.
5. Choose a destination: a new Installation, the complete open editable draft, or the next edition of an existing saved Installation. Choose **Prepare complete operating edition**.
6. Complete the Installation's original source meaning, commissioning assignment, payment selections, receiving application/host/operator, funded work allocation, recovery and maintenance. Original native funded-plan criteria remain alongside the new period criteria.
7. Open the complete native result and customer files in the intended receiving application. Record the actual receiving operator, observation time and useful result for each accepted period. Select the original native work, purchase and outcome records where they support that observation.
8. Choose **Review complete installation**. The review shows each original period's recorded native state separately from its entered acceptance. It also retains the original configuration, exact payment amounts, funded work and commercial fields.
9. Enter the reason for this operating edition and choose **Save reviewed edition**.
10. Choose **Export complete handover**. Receive that whole case ZIP through the existing **Import complete case** control on the receiving operator's workspace. It opens the selected saved edition with all original sources and prior editions.

The preparation fills only the original period binding and required acceptance steps, plus otherwise empty task/source defaults for a new assignment. The complete existing editor remains the place for actual customer, payment, deployment, funded work and receiving choices.

A complete native run makes its corresponding period eligible for complete-result acceptance. Acceptance still requires the original observing operator, timestamp and result. Planned, interrupted or incomplete native runs remain visible in the operating source and can travel in a planning edition. They retain their original execution controls.

Original workflow recovery is visible in the run and step counts. It is not counted as new revenue, paid work or another independent customer. Exact network/asset purchase amounts and actual funded work remain on the original Operations rows.

## Receive a later period or source change

Capture the updated complete profile in a new original directory and select all earlier Installation periods together with the new period. Build a new complete source ZIP, attach it as a new Sources file and prepare the next edition of the same original Installation.

The receiving operation keeps the original profile identity and every previously selected period. Its stable period acceptance identity derives from the original profile and cycle. Earlier periods with an unchanged series, cycle, native run, cancellation and explicit customer-file selection keep their entered observations. A changed original basis reopens that period's acceptance step in the prepared draft, ready for the receiving operator's new observation. The previous acceptance stays in its saved edition.

A historical saved edition can become the editable draft. Preparing a later source also carries periods which were added after that historical edition from the current saved head. It preserves the draft's existing observations for its own periods, then rechecks every selected period against the complete new source. A missing earlier period asks for the complete original capture which contains it.

Saving rechecks the current case version and current Installation edition. The original preview, request journal and immutable save transaction remain authoritative. Changing source filenames or reordering selected evidence does not make an old accepted observation apply to a changed original native result.

Typing later changes while reading or preparing a source keeps those edits. When the complete submitted draft changes during the request, the prepared receiving result is retained as a separate draft. The original editable draft remains selected, and the new received draft remains available in the draft selector.

## Native CLI and agent operation

Use the original workspace CLI. The example values below identify fields; substitute the actual case, source, versions, cycle IDs and observed timestamp from the retained operation.

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /absolute/private/grant-workspace \
  attach --case operation-ORIGINAL --expected-version CURRENT_VERSION \
  --file /absolute/private/customer-operating-source.zip \
  --kind other --media-type application/zip \
  --observed-at ORIGINAL_UTC_TIMESTAMP --source-url ORIGINAL_SOURCE_REFERENCE \
  --actor "Actual source receiver" --request-id ORIGINAL_ATTACH_REQUEST \
  --note "Complete original returning-customer source"
~~~

Read the returned current case version and attached source identity. Then:

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /absolute/private/grant-workspace \
  installation-workflows --case operation-ORIGINAL --expected-version CURRENT_VERSION \
  --source source-ORIGINAL --expected-source-sha256 ORIGINAL_SOURCE_SHA256 \
  --output /absolute/private/original-periods.json

python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /absolute/private/grant-workspace \
  installation-workflow-seed --case operation-ORIGINAL --expected-version CURRENT_VERSION \
  --source source-ORIGINAL --expected-source-sha256 ORIGINAL_SOURCE_SHA256 \
  --cycle ORIGINAL_FIRST_CYCLE_ID --cycle ORIGINAL_LATER_CYCLE_ID \
  --expected-revision 0 \
  --output /absolute/private/period-installation.json
~~~

For an existing Installation, include --installation ORIGINAL_INSTALLATION_ID and its current --expected-revision. An optional --document file supplies the complete current editable Installation. The resulting complete document is at /document. Preserve it, edit actual receiving fields, and use the original installation-preview, installation-save, installation-history, installation-export and import commands described in the Installation guide.

| Operation | Native route | Existing agent client |
| --- | --- | --- |
| Read complete original period inventory | POST /api/operations/CASE/installation-workflows | installationWorkflows(caseId, body) |
| Prepare a complete operating edition | POST /api/operations/CASE/installation-workflow-seed | installationWorkflowSeed(caseId, body) |
| Preview, save, recover, export and receive | Original Installation and Operations routes | Original Installation/complete-case methods |

The inventory body selects expectedVersion, sourceId and expectedSourceSha256. Preparation adds cycleIds, installationId, expectedRevision and an optional full document. A new Installation uses null and zero. A saved Installation selects its current ID and edition.

The maintained MCP provider exposes merchant_grant_installation_workflows and merchant_grant_installation_workflow_seed. The seed accepts the same complete original draft through the existing inputs or verified retained-input/snapshot/transfer reference. Select /document for the subsequent original preview/save. Every original file, full result and pointer remains available through the provider's existing source, snapshot and transfer operations.

The installed JavaScript export is ./merchant/console/installation-handover:

~~~js
import { exportWorkflowInstallation } from
  './stellar-forge/mcp-merchant-operator/console/workflow-installation-handover.mjs';

const result = await exportWorkflowInstallation({
  directory: '/absolute/private/customer-periods',
  input: { periods: originalPeriodSelections },
  output: '/absolute/private/customer-operating-source.zip',
  python: originalPythonPath,
  signal: originalOperationSignal
});
~~~

The adjacent TypeScript declaration retains the exact selection and output contract. The original command and package export are registered in the maintained merchant-console distribution contribution. Both managed Grant launchers retain the same three new native/UI source files.

## Full grant and customer handover

The Installation's optional workflowPeriods binding is saved inside its original immutable edition. It identifies the exact complete source ZIP, original profile, original cycles and native facts, explicit customer-file selection and each stable acceptance step. The complete case importer reopens that source, rederives those selected facts, checks the original check identities/criteria and validates the saved report and edition chain.

Exporting a selected Installation includes the original whole Operations case: pinned plan and planner history, original work and purchases, sources, customer deployment/receiving records, forecasts, prior Installations and the selected readable edition. The offline Installation page links to the complete source ZIP and presents every selected period's recorded run and actual receiving acceptance.

This provides a reusable adoption record for the funded deployment, customer receiving and ongoing source-change work already assigned by the case's pinned plan. Its criteria and funding schedule come from that original plan. New recurring-task observations can support the actual funded implementation outcome after they are performed and recorded; attaching a source or preparing a draft does not change a work or payment row.

Existing Installation documents without workflowPeriods retain their original schema and report shape. Use the source owner's current complete release when adopting these files, then reopen the same original case and request identities.


## Inspect the completed application before delivery

Before presenting the completed application or its reports as ready, open the exact outgoing version with the populated customer workspace, look at its rendered screens or real screenshots, and operate the important controls. Review the screenshare width and relevant narrow/mobile width, empty, loading and error states, downloads, exports and reopening. Fix unreadable, clipped, overflowing, unstyled or broken output in the same application. Capturing screenshots without viewing them, source review and HTTP responses do not replace this inspection.

Use plain industrial presentation: readable tables, clear hierarchy, consistent typography and spacing, restrained controls and useful labels. Keep the original workflows and computations. Continue through observed repairs and the existing receiving programme; use focused checks rather than a broad suite. Carry this requirement into delegated receiving work and any standalone application handoff. This implements the repository's owner-directed rendered-product inspection instruction, version 2026-10-13.1.

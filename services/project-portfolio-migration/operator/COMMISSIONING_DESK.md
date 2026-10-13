# Commission an existing project in the Portfolio migration desk

The Existing-plan commissioning desk completes an imported project's operating history in the same Portfolio workspace that retains its original source. It connects the original import evidence, captured native identities, reviewed differences, selected task corrections and receiving decision. The complete handover preserves that history for the next engineer.

Open the existing **Portfolio migration desk**, then choose **Existing-plan commissioning**. Its four screens follow the customer operation: **Import & evidence**, **Identity & exceptions**, **Observed corrections**, and **Acceptance & handover**. The original Source, native operation, Activity and Archive panels remain available beside them.

## Open the customer's existing workspace

Start the maintained operator from the complete product source:

```sh
python operator/serve.py \
  --workspace /absolute/customer/portfolio-workspace \
  --profiles /absolute/private/target-profiles.json \
  --entry-file /absolute/private/portfolio-entry.json \
  --port 8857
```

Open the private local URL written to the entry file. Use the same selected source installation and native runtime as the customer's existing operation. The configured target profile identifies the actual Project Operations environment and licensed user. The original delegated-token file and target configuration stay in the receiving host's private directory.

First retain or select the complete project source in **Source**. Keep the actual original file, any companion files and the resulting source edition. Commissioning refers to that saved edition throughout its comparison and review. Selecting a new source edition does not rewrite the original one.

For an operation already in progress, select its **Imported plan** at the top of the commissioning desk. Use **More saved commissioning plans** to continue through the original saved deployment history. The page opens the selected deployment, current native capture, original evidence and authored draft. It preserves the exact project, workspace and source identities.

## 1. Retain the original import and capture the existing project

In **Import & evidence**, select the configured native target and enter the existing project's complete GUID. Add a readable label and any original project URL or import time you received. The time field preserves the supplied value. **Original import settings** accepts the original JSON object, including options that explain how the source was imported.

Attach every complete file that belongs to the import and select its evidence class:

| Evidence class | Use it for |
| --- | --- |
| Native import receipt | A complete original response or report produced by the native import operation. |
| Original export | The actual source or target export supplied for the import review. |
| Original screenshot | The original image documenting what the operator saw. |
| Operator statement | A supplied account of the import's circumstances or outcome. |

The file title and optional format help the next operator identify an item. Its bytes and original hash remain available through the retained intake. A draft restored after a browser restart keeps completed upload descriptors. If a selected file had not yet been uploaded, reselect that complete original file when the desk asks.

For each reported import exception, select the evidence file, enter its original row, path or cell, and preserve the complete exception value. Choose original text or a structured JSON value. These original exceptions remain distinct from the decisions recorded during review.

Choose **Retain import and capture existing plan**. The desk retains the complete intake and invokes the existing native reader against the identified project. The completed capture includes the original project, tasks, resources, assignments and dependencies, additional project-team pages, bucket observations and source locations. The deployment reaches **CAPTURED** after those reads finish.

If the local reply is interrupted, use **Resume saved request** or the corresponding **Activity** entry. The desk records the request identity and exact arguments before sending it. A changed workspace or source selection keeps the existing draft and requires review of the new selection before another import is submitted.

Once captured, this screen presents the retained evidence table, original import settings and exceptions, plus downloads of the complete supplied files. **Prepare another imported plan** opens the next intake while retaining the current project's history.

## 2. Review identity mappings and every original exception

Open **Identity & exceptions**. Select tasks, resources, assignments or dependencies in **Original row family**. The desk pages through the complete source family in groups of 50, with the original source key and name beside each explicit native GUID selection.

Use **Inspect source row** to read the complete retained source object. Use **Inspect selected native row** to read the corresponding native object and membership evidence. The captured native inventory and original bucket observations are also available in full. The selected native name updates as you enter a GUID.

Map each selected source key to the actual GUID from the current capture. One native GUID can represent only one source row within that family. Source names and reader candidates help the operator review the association; the explicit source key and native identity determine the saved mapping. A partial map remains visible as review findings.

For every original import exception, choose a disposition and record a reason:

| Disposition | Meaning in the saved review |
| --- | --- |
| Retained difference | The operator accepts the described difference as part of this delivery. |
| Needs correction | The exception requires the identified correction work. |
| Manual follow-up | The operator records work to be handled outside the selected task correction. |
| Observed resolved | Retained evidence supports the operator's conclusion that this exception has been resolved. |

Select supporting evidence from the original import files, captured inventory, native identity read or original reader responses. An **Observed resolved** decision requires at least one retained evidence selection.

The task conversion section accepts the maintained mapping object. Its default task fields are the original name, start and finish conversions. Use explicit timezone and fold decisions where the source's dates require them. The full selected conversion appears in the proposal and field comparison.

Choose **Prepare identity and exception review**. The returned proposal contains the selected identity mappings, all required findings, original import-exception decisions, complete plan and source/intended/observed comparison. Read the proposal, acknowledge its required findings, and enter the reviewer's name and reason. **Save reviewed identities and exceptions** binds the decision to that exact proposal and deployment revision.

An already completed proposal can also be reopened from **Activity → Open saved result**. The desk reads its exact original request and named proposal. If your current draft differs, **Use this saved proposal and retain current draft** restores that original selection while keeping the authored draft available to inspect or restore. A proposal from an earlier capture remains available for inspection; saving a current review uses the current capture.

If another action changes the deployment, the desk retains your authored text and mappings and displays **Review the current saved context**. Load the current capture, inspect what changed, then use **Rebase draft onto this loaded capture**. Rebasing clears old finding and correction selections so every acknowledgement refers to a visible current item. Prepare a new proposal from that current selection before saving the review.

## 3. Correct selected differences using actual native values

The **Observed corrections** screen shows three separate values for every selected field:

| Column | Meaning |
| --- | --- |
| Source | The original typed value retained in the selected source edition. |
| Intended | The value produced by the reviewed source-to-native conversion. |
| Observed | The value present in the actual captured native record. |

A field is equal, different, unmapped or unobserved. Missing observations remain explicit. Use the filter to inspect each category and the complete comparison disclosure for the full source context.

Select the different mapped task fields that the customer wants corrected. Select the exact source edition that expresses the intended result; the original unchanged edition can be used. Choose **Prepare selected task correction**.

Preparation creates a retained child deployment and pins the complete parent snapshot. It reads and retains the actual current values for the selected native tasks before composing the correction. The prepared plan shows the native request bodies, typed before values, original native record identities and fields already current. Values that already match are preserved in the review without producing an unnecessary update.

Read **Review the prepared native correction**, acknowledge its findings and save the correction reviewer and reason. Then choose **Execute reviewed correction**. This continues the maintained native journal, operation sets and provider replies. The journal remains available directly in the desk and through **Read existing native request controls**.

Use the original saved request controls to continue an interrupted operation. **Retry an explicitly rejected native request** is for the selected recorded rejection after its cause has been addressed. The product retains earlier native attempts and reconciles their outcomes through its existing journal.

When the deployment reaches **NATIVE_COMPLETE**, choose **Open native recapture and acceptance**. The receiving capture will establish what the native project now contains. The correction history keeps its pinned parent, original source, reviewed plan and actual native before values.

## 4. Accept the receiving result and deliver the complete project

In **Acceptance & handover**, choose **Capture current native values**. The resulting comparison uses the complete returned observations and the selected source intent. If a capture is already in progress, open its original Activity entry and continue that same request.

Review the source/intended/observed fields and all identity findings. Enter the receiving reviewer's name and decision. Select every non-equal field and identity finding that is retained in the accepted delivery, and add readable retained-difference notes. **Save receiving acceptance** records the selected original comparison and commissioning comparison together. The complete saved acceptance remains visible.

Choose **Create complete commissioning handover**. The delivered JSON and HTML include the original import evidence, reviewed identities, conversion selections, source/intended/observed values, exception decisions, accepted differences and pinned correction lineage. The original operator handover remains alongside the commissioning report. Download all artifacts from the delivery section.

Choose **Export the full editable workspace** to include source bytes, editions, requests, original responses, plans, review history, native captures, acceptance and import evidence. The **Open portfolio archive** action provides the existing multi-project reporting and receiving workflow, including the owner's current timephased and companion support.

Receive the complete exported workspace into a separate destination:

```sh
python operator/cli.py receive /absolute/delivery/customer.portfolio.zip \
  --destination /absolute/receiving/customer-portfolio

python operator/serve.py \
  --workspace /absolute/receiving/customer-portfolio \
  --profiles /absolute/private/receiving-target-profiles.json \
  --entry-file /absolute/private/receiving-entry.json
```

Open the receiving desk and select the same saved commissioning deployment. The retained source, captured records, reviews, reports and accepted history are available from that received workspace. The original request identities remain the basis for recovery.

When the next operator uses a different configured principal, choose it under **Receive under another configured principal**, record the reviewer and reason, and choose **Capture the same project under this profile**. The application checks the same native organization and project, retains the earlier principal and parent snapshot, and produces a new captured adoption entry. Review its current identities and exceptions before further native correction work.

## Daily operation and recovery

Keep one original saved request as the continuation point for work already started. Refresh the desk to inspect current history; **Resume saved request** reads or resumes the selected recorded action. Browser drafts retain authored mappings, notes, uploaded evidence and selected proposals under the original workspace identity.

A newly loaded deployment revision does not silently replace a draft's review basis. The desk binds proposals to the selected workspace, source edition, native capture and revision, and requires the operator to review a changed context. Switching the local connection clears the previous workspace's displayed collections and discards late responses from that connection.

Both desktop and phone present the same four commissioning screens and original actions. On narrow screens, comparison rows become labelled cards; complete source objects remain available in expandable inspectors. Long project identities wrap within the page. The controls support keyboard navigation and visible focus.

For an existing customer operation, append the actual commissioning desktop and phone inspection to the original native receiving record. Retain the saved deployment IDs, source editions, request identities, complete handover artifacts and portable workspace from that operation.

## Source and integration

This desk uses the existing `TargetWorkspace` action dispatcher, original authenticated local API and object store. The full API contract is in [commissioning_contract.json](portfolio_target/commissioning_contract.json), and the domain workflow is described in [IMPORTED_PLAN_COMMISSIONING.md](IMPORTED_PLAN_COMMISSIONING.md). The original [operator guide](README.md) describes the target profiles and request recovery; the [archive guide](../archive/README.md) covers complete portfolio reporting and receiving.

The UI module is `portfolio_target/web/commissioning.js`, with scoped neutral styles in `commissioning.css`. Its host joins use the original application loader, drafts, workspace selection, action recovery and static routes. The existing Archive, companion and timephased source remains part of the same complete product.

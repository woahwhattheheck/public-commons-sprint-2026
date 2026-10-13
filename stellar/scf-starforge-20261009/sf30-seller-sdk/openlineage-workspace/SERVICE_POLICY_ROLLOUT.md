# Reviewed multi-job service policies

This workflow lets an operator commission or revise service policies for several observed jobs in one reviewed change. Open the existing **Service levels** page and choose **Policy rollouts** in its header. Choose the jobs and exact saved policy versions, enter the intended conditions and ownership, inspect every before/after difference, and apply the reviewed plan once.

A rollout changes policy definitions. Assessments and incident decisions remain their original saved records. Run a later explicit assessment through the existing Service levels page when you want observations evaluated under the new policies. The workflow does not run upstream jobs or generate policy values.

## Select the original workspace

Use the existing managed application, access token, workspace identity and installation instance. The rollout page calls the same action endpoint and operation journal as the original operator. Source, job and policy IDs always refer to that workspace.

A job key is the exact namespaced JSON key returned by the original projection, such as the three-element array identifying a job. Select the actual key from the workspace; matching a short display name is insufficient.

The page lists full observed jobs, saved policy histories and immutable rollouts. Each selected existing policy carries its current version. A new policy carries a null policy ID and null expected version until the native transaction assigns its permanent ID. Different policies may legitimately cover the same job. A plan may select an existing policy only once.

## Build and review a plan

Give the plan a title and a reason. Add from one to 200 rows, each with a stable unique row ID. For every row, select an observed job or an existing policy and enter the same fields supported by the original single-policy editor:

| Field | Meaning |
| --- | --- |
| Title | Operator-facing policy name |
| Job | Exact observed namespaced job key |
| Owner | Responsible person or team |
| Runbook | Optional HTTP(S) link without credentials |
| Enabled | Whether a later assessment considers this policy |
| Effective from | Explicit RFC3339 date and time with timezone |
| Maximum completion age | Optional positive whole seconds since a qualifying completion |
| Maximum duration | Optional positive whole seconds for run duration |
| Failure window | Positive whole seconds used by failure monitoring |
| Monitor failures | Whether the policy checks original failure observations |

Native validation and normalization are shared with single-policy saves. At least one condition must be selected. The engine does not infer a threshold, owner, evaluation date or business severity.

Preview returns the normalized full plan, each original before-policy including its history, the complete proposed after-fields and version, and every changed field. It also retains the original event and source ID selection and full selected observed job records. The preview checksum binds all of those values to the source workspace revision.

Rows are marked CREATE, UPDATE or UNCHANGED. Unchanged rows keep their existing version. A plan containing only unchanged rows cannot create an empty rollout.

An existing policy can retain its original job key if that job is no longer in the current projection. A new policy or a changed job binding requires an actually observed job. This preserves historical policy custody without pretending that an absent job has been observed.

### Review current baselines and common settings

Use **Add policies and jobs** to select several original records. Searching the chooser keeps the selections already made; it does not replace them with the currently visible search results. Every selected existing policy keeps its full saved version as the draft baseline.

If a policy has changed since this draft was saved, open its version comparison and inspect the selected and current records. **Use current version as baseline** is an explicit choice: it updates the expected native version while retaining the proposed fields you entered. Review the complete resulting differences and obtain a new preview before applying. Merely refreshing the page does not silently replace the draft's original versions.

For shared changes, select the intended draft rows and choose **Edit selected settings**. Mark only the fields that should change, enter their values, then choose **Use these selected settings**. This edits the selected draft rows; it does not save any policy to the workspace. Unmarked fields, unselected rows and original baseline versions remain as entered.

## Apply the exact reviewed change

The browser retains the complete apply request before dispatch, including the operation ID, original expected revision, normalized plan and preview checksum. Applying checks the current revision, every selected policy version, observed job selection and complete preview again inside the existing workspace transaction.

If anything changed after preview, refresh and inspect a new complete preview. Nothing is partially applied. A successful transaction creates one immutable rollout, advances each changed policy exactly once through the original policy-history constructor, leaves unchanged rows intact, and records the ordinary original operation receipt.

After a connection interruption, keep the original request. Reconcile it against the existing operation journal or replay its exact operation ID and body. An accepted original operation returns its original receipt even when the workspace has subsequently advanced. A different body with the same operation ID is a conflict; it is never a new rollout.

The page's raw draft and selected versions survive reloads. An unfinished accepted or uncertain apply remains associated with its original request; it must be resolved before unrelated work replaces that request. The page keeps a known accepted receipt while it retries local storage or reads the saved native rollout. A failed follow-up read does not unlock the original request for a new apply.

After verifying the full saved native rollout and receipt, the page creates a separate applied-operation draft. That draft uses the accepted policy versions as its new baseline and retains the complete original raw proposal in `appliedFrom.state`, together with the admitted draft identity and version. It leaves the original draft intact. If this follow-up draft already exists, recovery reopens that same draft and preserves edits made to it since the first successful follow-through. Local completion clears only its own pending operation; a different tab's original pending request remains retained.

## Keep and exchange complete working drafts

**New draft** starts separate local work. **Saved drafts** opens the named draft chooser, where the complete retained draft is selected explicitly. Titles, reasons, unfinished field strings, selected job and policy identities, full original policy histories and draft versions are saved locally as work proceeds. A conflicting edit from another tab preserves the current unsaved proposal and offers an explicit separate draft instead of replacing the newer saved version.

**Download working file** saves a complete JSON working file containing the raw draft and its original pending request when present. **Open working file** first inspects that file; **Open imported draft** then adopts it into the same source workspace. Receiving an unfinished request retains its exact original operation ID, expected revision, plan and preview checksum before the imported proposal becomes editable. If the incoming file claims an accepted result, the page checks that result against the original native record before completing its follow-through.

Working files retain complete histories at their actual size. The native limit remains 200 selected rows; there is no separate small-file cutoff that removes original histories or makes a valid downloaded draft impossible to reopen. Browser memory, read and storage failures are reported as failures while the current raw proposal and original request remain available for recovery or download. Keep the file private because it includes the complete policy and source selection; access tokens are not included.

A working file is an editable proposal and request handoff. To deliver the full operational workspace with original source bytes and all saved records, use the existing complete workspace export described below.

## Inspect history and reports

Open a saved rollout to see its title, reason, source and committed revisions, operation ID, checksums, complete original preview, and every full policy before and after application. Later policy edits do not change the saved rollout.

Download JSON for the complete immutable record; CSV for one row per selected policy with full original policy values; or printable HTML for the original before/after report and full source selection. CSV output uses the existing spreadsheet-safe escaping.

Reports are derived from saved records. They do not rerun assessments or reinterpret later events. Keep the full workspace export when the recipient needs original source bytes, all policy histories, assessments, incidents, operation receipts and editable application source.

## CLI

Use the existing command and actual retained workspace directory:

    openlineage policy-rollout status --workspace /absolute/workspace
    openlineage policy-rollout preview --workspace /absolute/workspace \
      --input /absolute/plan.json --out /absolute/preview.json

Inspect the entire saved preview. Prepare a private original request using its exact preview checksum and an explicitly selected operation ID:

    openlineage policy-rollout prepare --preview /absolute/preview.json \
      --expected-preview-sha256 ORIGINAL_PREVIEW_SHA256 \
      --operation-id ORIGINAL_OPERATION_ID --out /absolute/request.json

Preparation does not call the workspace or change policies. It writes the complete preview and apply arguments into a create-only private request file, synchronizes that file and its parent directory, and returns the request checksum.

Apply the reviewed request:

    openlineage policy-rollout apply --workspace /absolute/workspace \
      --request /absolute/request.json --expected-request-sha256 ORIGINAL_REQUEST_SHA256 \
      --out /absolute/receipt.json

The command first reads the original operation journal. If the request is already present with the exact normalized body, it returns that unchanged native receipt. If absent, it submits the same retained request once. The transient replay marker is not added to the immutable receipt file.

After an uncertain response, inspect before retrying:

    openlineage policy-rollout request --workspace /absolute/workspace \
      --request /absolute/request.json --expected-request-sha256 ORIGINAL_REQUEST_SHA256
    openlineage policy-rollout resume --workspace /absolute/workspace \
      --request /absolute/request.json --expected-request-sha256 ORIGINAL_REQUEST_SHA256 \
      --out /absolute/receipt.json

Request lookup is read-only. A concurrently advancing workspace can require repeating the lookup at its new observed revision. Resume preserves the original expected revision and operation ID; it does not refresh or silently substitute an accepted plan.

Read or download a saved rollout:

    openlineage policy-rollout show --workspace /absolute/workspace --id ORIGINAL_ROLLOUT_ID
    openlineage policy-rollout report --workspace /absolute/workspace \
      --id ORIGINAL_ROLLOUT_ID --format html --out /absolute/rollout.html

For HTTP, replace --workspace with --url and the existing --token-file. The client obtains the original identity and binds following requests to its workspace and instance. Optional --expected-workspace-id and --instance-id pin an already reviewed connection. Applying also checks the workspace identity from the retained preview.

Files are create-only. An identical complete output is reusable; a different existing file is never overwritten. Keep a failed or uncertain request file, rather than preparing a replacement operation ID. An incomplete output can be inspected privately and a new output pathname selected while retaining the same original request.

## Typed client and native tools

The distribution exports:

    import { PolicyRolloutClient } from
      "@tokenjunkielabs/starforge-merchant/seller/openlineage/policy-rollout";

The client extends the original LineageClient and accepts the same token, expected workspace, instance, timeout, fetch and AbortSignal options.

Methods are readPolicyRollouts(), previewPolicyRollout(plan), applyPolicyRollout(args), getPolicyRollout(id), policyRolloutReport(id, format), and findPolicyRolloutRequest(args). The last method reads complete original operation-history pages at one observed revision; it never dispatches an apply.

Keep the complete apply arguments durably before calling applyPolicyRollout. A process-local JavaScript object alone does not provide reload recovery. Preserve the native preview and rollout checksums and full source identities; do not replace them with a display summary.

The original tool catalog exposes lineage_service_policy_rollout_read, preview, apply, get and report. Apply requires operationId, expectedRevision, the whole plan and expectedPreviewSha256. It uses the existing native writer and merchant operation owner, not a separate request store.

## Complete export and receiving

The existing workspace export includes the full servicePolicyRollouts collection in the original state, every source and result object, all prior policy versions and original operation receipts. The complete current application inventory includes this domain, catalog, client, types, CLI, page, script, stylesheet and guide.

Receiving validates each record and preview checksum, exact policy-history membership, original operation fingerprint and receipt, and the original source/event selection. Deep validation reconstructs each preview from its frozen original sources and policy versions before publication. Later sources added to an existing event do not replace the original captured source selection.

Historical complete application editions remain recognized with their original inventories. An older edition cannot claim support for rollout records. Receiving uses the original full package verifier and receiver, keeps the original workspace identity, and creates the receiving installation identity through the existing path. The rollout histories can be read, reported and re-exported from the actual received application.

Do not build a second export format or copy only the report when a complete operational handover is required. Use the original complete workspace and runtime delivery already selected by the project owner.

## Operating and rendered inspection

This source changes no provider credentials, upstream producer, existing assessment or incident-decision rules. Keep current native job ownership and the original receiving course.

Before calling an outgoing application or report ready, open the exact selected version in its actual equipped receiver and inspect the rendered results. Operate the important controls with the actual retained workspace: empty and populated job lists, a saved draft, policy selection and before/after preview, accepted-request reopening, rollout history, every report download, and the independently received copy. Inspect normal desktop and narrow widths, loading and returned error states, readable long names and original IDs. Use the existing operational course and real retained data; do not create a separate test-only programme or synthetic provider responses.

If runtime access is unavailable, retain the complete source and exact opening steps with the existing receiver and label the delivery source-reviewed. Source review, syntax parsing or an HTTP response alone does not establish that the outgoing screens and reports were visually inspected.

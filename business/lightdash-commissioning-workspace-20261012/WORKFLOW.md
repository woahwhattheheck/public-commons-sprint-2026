# Complete commissioning workflow

## 1. Prepare and name the actual estate

Use a prepared dbt warehouse and a Lightdash project that the operator is authorized to commission. Retain the original source commit, complete example tree, installed Node/Lightdash/dbt versions, actual server and database image digests, warehouse profile and project UUID.

The complete original full-jaffle-shop-demo source includes dbt/, profiles/, original chart content and its Apache license. Keep all 189 files. A small generated fixture does not substitute for the complete original example.

The source Dockerfile and compose files are themselves retained original inputs. Resolve the actual selected runtime image digests; a latest tag is not a version observation. The original example entrypoint performs backend rollback, migration and seed steps. Prepare its own disposable estate before using that entrypoint.

The native receiving program uses the original dbt and Lightdash commands on the prepared estate. The workspace app can also commission an existing customer project without the example’s backend reset.

## 2. Configure and capture the source

Use the full example root as projectRoot, with projectDir = dbt and profilesDir = profiles. Keep the actual environment-variable profile unchanged. Supply a host-bound private profile instead when customer credentials live outside the source.

Example source selection:

    {
      "projectRoot": "/opt/lightdash-src/examples/full-jaffle-shop-demo",
      "label": "Original full Jaffle source",
      "note": "Original Lightdash commit 91e610898395e6659841a321a0cee31cfcac8ae8",
      "operationId": "jaffle-source-001"
    }

Source intake copies the complete selected source files. It records exclusions for .git, virtual environments, node_modules, dbt_packages, target, logs, .lightdash and .env files. Private profiles are excluded by default. The source edition records every retained path, byte count, SHA-256 and executable flag.

Intake rejects source symbolic links and a source/workspace directory overlap. These checks prevent a copied project from referring outside the selected complete source or recursively ingesting its own output.

## 3. Author an actual candidate

Create the draft from the original edition. Apply the agreed customer source changes as complete files. The receiving program should make a meaningful original metrics/content improvement appropriate to the selected example or customer problem.

A file edit uses the actual current source identity:

    {
      "path": "dbt/models/customer_metric.yml",
      "content": "COMPLETE_ORIGINAL_OR_EDITED_UTF8_FILE_CONTENTS",
      "expectedFileSha256": "OBSERVED_CURRENT_FILE_SHA256",
      "expectedDraftId": "ACTUAL_SELECTED_DRAFT_UUID"
    }

Use expectedFileSha256 = null for a new file. Removal is explicit: remove = true with the original file identity. New candidates are complete source editions; the original edition and draft remain available.

Review both complete editions. The review captures the actual reviewer and note, and may include one decision per source path:

    {
      "baselineId": "ORIGINAL_BASELINE_UUID",
      "candidateId": "ACTUAL_CANDIDATE_UUID",
      "reviewedBy": "Actual operator",
      "note": "Actual source decision and intended target",
      "decisions": [
        {"path": "dbt/models/customer_metric.yml", "decision": "REVIEWED_SOURCE"}
      ]
    }

The application records a source review. Commercial acceptance, deployment authority and a purchase order are separate facts.

## 4. Run the original dependency and build work

Prepare and execute dbt-deps followed by dbt-build. Optional select, exclude and vars are structured native inputs. The whole selected example should run without a replacement dataset or metrics calculation.

Every native operation has this root request:

    {
      "operationId": "jaffle-build-001",
      "action": "dbt-build",
      "editionId": "ACTUAL_CANDIDATE_UUID",
      "input": {}
    }

Inspect the original plan before execution. It includes the selected complete edition, connection, commands and effects. The adapter prepares its own operation directory; native generated dependencies and build outputs do not mutate the immutable source edition.

Retain original dbt results and the exact native command status. A process creation failure does not become a provider failure or completed build.

## 5. Compile and create a retained preview

Run original Lightdash compile for the candidate, then start-preview with a unique selected name:

    {
      "name": "commissioning-jaffle",
      "expiresInHours": 24,
      "skipCopyContent": false
    }

The native adapter selects the actual upstream project via LIGHTDASH_PROJECT. It verifies the actual owned preview project and retains its UUID. The interactive preview command is unsuitable for a retained unattended preview because it has an interactive cleanup lifetime.

The original CLI’s --no-warehouse-credentials path also skips dbt compile and warehouse catalog work. The native integration handles that original behavior explicitly. Where the full receiving program selects the profile-credential path, it uses the original source/profile and original warehouse compilation.

A zero CLI exit by itself does not establish preview creation. Use the actual native preview identity in the next operation.

## 6. Validate the original preview

Supply the actual preview UUID returned by the original start operation:

    {
      "projectUuid": "ACTUAL_OWNED_PREVIEW_UUID",
      "startOperationId": "ORIGINAL_START_PREVIEW_OPERATION_ID",
      "severity": "error",
      "only": ["tables", "charts", "dashboards"]
    }

The native integration retains the original validation job UUID, status and result. Its inspection path reads that existing original job. It does not create another validation job merely because the parent process or response was interrupted.

Review actual native compilation/validation results and the complete source changes. Update a draft and seal another complete candidate when a real source change is needed.

### Query the reviewed chart with the original engine

Use run-chart against the actual preview or selected project. The path is relative to the complete immutable source edition:

    {
      "projectUuid": "ACTUAL_OWNED_PREVIEW_UUID",
      "startOperationId": "ORIGINAL_START_PREVIEW_OPERATION_ID",
      "chartPath": "dbt/charts/regional-sales-total-row-total-demo.yml",
      "limit": 500,
      "pageSize": 500
    }

The original query command returns its query UUID, actual rows and complete CSV. Inspection reads the retained query and result pages after a lost response; it does not submit another metric query.

The complete Jaffle receiving programme adds weighted Revenue per Unit to the original regional_sales model and its consuming chart. The metric divides total revenue by total units using NULLIF for a zero denominator. The unchanged original CSV contains 72 transactions and 18 month-and-region groups from January through June 2025. The receiving comparison identifies all 18 returned groups, checks each group's actual units and revenue, and compares its raw weighted USD-per-unit result. Its source-derived expectations are comparison inputs; the native run supplies the actual results.

## 7. Back up content and promote source/content

For validate, run-chart, download, deploy or upload against an owned preview, include both its actual projectUuid and the original startOperationId. The native integration uses that original binding whenever the destination differs from the configured source project.

Use download on the intended original target before a content change. The result contains the complete original content export and manifest:

    {
      "directory": "ACTUAL_ORIGINAL_EXPORT_DIRECTORY",
      "manifestFile": "ACTUAL_ORIGINAL_EXPORT_MANIFEST",
      "manifestSha256": "ACTUAL_ORIGINAL_EXPORT_MANIFEST_SHA256",
      "sourceProjectUuid": "ACTUAL_SOURCE_PROJECT_UUID",
      "sourceOperationId": "ORIGINAL_DOWNLOAD_OPERATION_ID"
    }

The application displays **Use for content upload** for a retained original export. It fills an upload input using those actual files and identities. Review the intended destination in the new native command plan.

Source promotion uses original deploy on the selected immutable candidate. Content promotion/restoration uses original upload:

    {
      "projectUuid": "ACTUAL_INTENDED_TARGET_UUID",
      "content": {
        "directory": "ACTUAL_ORIGINAL_EXPORT_DIRECTORY",
        "manifestFile": "ACTUAL_ORIGINAL_EXPORT_MANIFEST",
        "manifestSha256": "ACTUAL_ORIGINAL_EXPORT_MANIFEST_SHA256",
        "sourceProjectUuid": "ACTUAL_SOURCE_PROJECT_UUID",
        "sourceOperationId": "ORIGINAL_DOWNLOAD_OPERATION_ID"
      },
      "applySpaceAccess": false
    }

For original content already inside an immutable source edition, use sourceEditionId instead of sourceOperationId, with the complete original source directory and manifest. Exactly one source identity is selected.

Keep native backups, files and request history from a partial upload. The native continuation contract may use resumeOf to name the old operation after its original lease closes; that is an explicit new reviewed continuation of the same retained input.

## 8. Inspect original operations after interruption

The application records PLANNED, RUNNING, SUCCEEDED, FAILED, INTERRUPTED, NEEDS_RECONCILIATION and the native BUSY-before-dispatch observation. The native integration determines recovery from its original command and provider records.

| Original observation | Recovery |
| --- | --- |
| Successful original child exit retained | Adopt the original result |
| Existing validation job UUID | Inspect that original native job |
| Existing chart query UUID | Read that original query and its complete result pages |
| Original preview identity and creation operation | Inspect or remove that exact owned preview |
| Successful deployment finalize response retained | Adopt its actual returned status/counts/warnings |
| Deployment finalize response lost | Retain its session/request identities; use the explicit native reconciliation path |
| Partial original content upload | Preserve backup and request/file history; prepare an explicit continuation when the original lease closes |
| Original operation still owns its lease | Observe the same operation; do not start a second one |

The original deployment controller has no GET endpoint for its batched session. Successful finalization deletes the session. A missing session does not prove failure, and the adapter does not replay finalization automatically.

Root operation inspection is always attached to its original ID. The result remains in the same SQLite operation and native directory. Reading source/state or an existing operation never creates another native run. A restored workspace retains completed historical outcomes even when its original private execution journal was omitted; inspection reports that missing journal separately without replacing the retained terminal result.

## 9. Restore and finish the preview lifecycle

A source rollback is an explicit original deploy from the retained baseline edition. Content restoration is an explicit original upload from the retained backup export. Review each actual target.

Delete the temporary preview using its original binding:

    {
      "name": "ORIGINAL_PREVIEW_NAME",
      "previewProjectUuid": "ACTUAL_OWNED_PREVIEW_UUID",
      "startOperationId": "ORIGINAL_START_PREVIEW_OPERATION_ID"
    }

The native integration verifies ownership against the actual original preview before deletion. It never treats an unrelated project with a reused display name as the same preview.

## 10. Deliver and reopen the complete workspace

Export the whole workspace and selected native content. Use an explicit handover UUID when the receiving program needs to resume the same export:

    node cli.mjs package --workspace /srv/lightdash-commissioning/customer-a --id ACTUAL_HANDOVER_UUID

Private diagnostic files are opt-in:

    node cli.mjs package --workspace /srv/lightdash-commissioning/customer-a --id ACTUAL_HANDOVER_UUID --include-operator-private

The application durably selects the complete original SQLite snapshot before acknowledging a handover request. Inspect or resume an interrupted package with inspect-handover or resume-handover and its original UUID. The same accepted ID retains the original SQLite revision and complete file basis. An interrupted prepublication selection remains explicitly pending and can adopt its retained complete snapshot. Use a new UUID when deliberately selecting a new complete workspace export.

Reopen every source edition, draft and native result from the complete archive. Configure the receiving host explicitly before additional native work. The original operation records remain historical records; a newly selected target receives a new reviewed native plan.

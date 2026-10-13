# Upper Savannah Investigations — native workspace binding

TokenJunkieLabs · E258 · original INTEL13, A66A, ES26 and ECD1 composition

This complete component connects the original Investigations Engine, Store and Assistant to the existing Upper Savannah Operator and Workspace. It reads the registered source editions and native output manifests, submits native work through the original queue, and carries investigations through the original workspace backup and restore.

## Install the complete component

Receive the complete source packet and match each file's byte length and SHA-256. Keep the original component README, tests and standalone installer in this component's source directory. The native installer copies only the eco_intelligence package into the current application and adds that package to the original portable application's source inventory:

    /opt/pyvenv/bin/python /path/to/component/eco_intelligence/install_upstate.py \
      --application /mnt/data/eco12-integrated-20261012 \
      --source-root /path/to/component

The installer retains previous changed source, compares fresh preimages before publication, and parses the package and complete portable module. A file changed by another current producer needs its source composed before installation. This preserves that producer's implementation while joining the new package.

Install A66A's current operator/registry/browser overlay through its own install_intelligence_operator.py. Its original source is F0C8PV7JA3U; the original INTEL13 source is F0C8MU0G65U. ECD1 owns the cumulative application and C8EF joins its existing native receiving operation.

The package imports the HTTP-native binding without importing FastAPI. The optional ASGI install_intelligence entry point loads that dependency when selected. Both hosts use the same report implementation in eco_intelligence/report.py. A66A's HTTP feature imports report from that module.

## Construct the actual original-host binding

    from eco_intelligence.upstate import UpstateInvestigations

    operator.science_investigations = UpstateInvestigations(operator)

Then construct A66A's IntelligenceFeature(operator, fault), or pass the binding as its third argument. engine(workspace_key) and assistant(workspace_key) return the same retained Engine and Assistant for that registered workspace. Every access resolves the key through the actual Operator.ws.

ProviderConfig.env() is used by default. The host may supply provider_config and provider_transport using the maintained INTEL13 provider interfaces. The original server environment owns any endpoint and credential values.

To include ES26's complete saved scientific reports:

    from intelligence_diagnostics import DiagnosticsDatasets

    diagnostics = DiagnosticsDatasets(operator)
    integration = UpstateInvestigations(
        operator,
        dataset_providers=(
            lambda workspace_key, workspace: diagnostics.records(workspace_key, "dataset"),
        ),
    )

The diagnostic bridge is the exact source in F0C8S1U48P3. Its records preserve es26:<diagnostic ID>:<artifact key>, original SHA-256 and scientific metadata. Its optional byte-length field follows the original StoreBackedRepository contract; selected file reads verify the actual registered hash. Add diagnostics.warnings(workspace_key) to the existing catalog's per-diagnostic outcomes and use diagnostics.operator_report for the original authenticated HTML/ZIP downloads.

A dataset provider is a server callable (workspace_key, original_workspace) returning all its normalized registered rows. Each row carries a unique id, the exact workspace tenant_id, a server-controlled path within that workspace, original sha256, and scientific metadata. The host can provide the registered byte length. Providers read existing records and do not run or create a diagnostic during inventory.

## Registered sources and complete results

The dataset inventory includes every original collection entry and companion member, retained observation CSVs, original grid outputs and retained comparisons. It preserves the complete native source descriptor, source-edition digest, original URI/vintage/units and registry location.

A selected content-addressed source is opened through Workspace.source_file. This creates its original named view and companions only when needed. CSV, GeoPackage, shapefile and raster readers therefore receive the original filename and file family; browsing an inventory does not copy or hash all regional inputs. Observation originals use a named view of the same retained bytes under source-views, which the original workspace archive recreates on demand.

Jobs retain the native run ID, state, exact original selection, source profile/scenario/grid and original active run task IDs. Artifact inventory walks every declared descriptor in the native run manifest, including stage output registries, arguments and retained land-cover output. It does not scan unregistered files into the job. Duplicate references to identical bytes retain every registry location. Conflicting native descriptors are reported against that original run.

Opening a run enumerates the complete registered output population and file availability. Selecting a file for actual analysis verifies its original bytes and SHA-256; the Engine then pins source/companion identities and checks them after analysis.

## Original queue and guided native work

run_job is connected to the actual run.start action with {"run_id": <original run ID>}. The gateway returns original admission immediately, allowing the original serial operator worker to execute the admitted native run after the investigation task completes.

Both original 32-character plan IDs and A66A's deterministic 64-character plan IDs are supported. The native operation ID is eco-intelligence-<complete plan ID>, within the Operator's original 16–100-character contract. Native task IDs and request hashes use model.common.digest with the original Operator payload.

Before admission, the binding commits the exact plan-to-task relation into the same investigation SQLite database. If Operator.submit would reuse active identical work, the binding records that specific original task ID and operation ID under the investigation plan. Reopening receives that same relation; similar parameters or changed job status never identify an unrelated run.

The original queue remains the authority for native execution, resume and cancellation. Investigation plan completion records accepted submission. Native task state and the retained native run report communicate actual calculation progress and completion.

If admission was interrupted before the task record existed, the operator can explicitly continue the same plan:

    integration.continue_submission(workspace_key, plan_id)
    # Then receive the same original plan through Engine.reconcile.

The continuation reuses the frozen native payload and operation ID after checking the selected original sources. It returns an already-retained task immediately. The host exposes this through a queued intelligence action and keeps the same plan ID.

NativeAction supports complete host-specific ensemble or calibration methods:

    NativeAction(kind, actual_operator_action, exact_method_description,
                 original_validated_payload_builder, catalog=original_catalog)

The payload builder receives (original_workspace, original_Action, paired_payload_or_none, retained_context). It calls the existing validated selection builder and returns its original payload without starting native work. An ensemble catalog enumerates the complete original programme records, with original IDs and baseline job_id. Register a method when that original action is installed; the UI receives the actual method list. The native scientific programme supplies its own references, parameter semantics, selected cohort and execution behavior.

## Workspace restore and task history

Default state is workspace/intelligence/investigations.sqlite3. Its storage namespace is project:<original project ID>. Public session/plan reads use the current registered workspace key, while the underlying namespace and all saved IDs remain stable after restoring that same project into another directory. ProjectStore.storage_tenant is the exact seam used by A66A's deterministic OperationStore inserts.

Every SQLite connection holds a shared lock on the original .workspace.lock until commit and connection close. The original portable backup already takes that lock exclusively. This makes the database quiescent while the original workspace inventory captures it. Session state, source analyses, plans, requests, exact native bindings and captured native task records travel together in the same archive.

The native binding retains observed original task records in SQLite with their full source digest and observation time. native_task(workspace_key, task_id) returns either the actual original operator record or its retained snapshot. The returned _intelligence_origin identifies that source. A restored task keeps its original ID and original workspace field; the native run link uses the newly registered workspace key.

A66A's task decorator should use this native_task fallback when the original operator-state directory is absent after restoration. Display the retained original task as history and open its current original run through the restored workspace. A native continuation is selected from the existing native controls, preserving the original run and stage identities.

snapshot_state(workspace_key, new_server_destination) provides an online SQLite snapshot for the existing complete delivery assembly. It captures the selected project's database and the task roster from that same captured database. A supplied state_directory is a host-owned external state option; that host must include the returned snapshot in its full workspace transfer.

## Receiving the joined product

Use the existing current ECD1 application and actual retained scientific workspace. Carry the same whole journey through A66A's authenticated operator:

1. Create a named investigation through the original queued action. Reopen it and inspect the complete native inventory.
2. Select one original table/raster and an already-retained native run; compare appropriate registered outputs with their original units and source identities.
3. Execute the originally selected prepared run or connected scientific programme. Reopen its exact original task and receive the completed native outputs.
4. Export both the full investigation JSON and readable report; reopen the retained files and verify their manifest identity.
5. Use the existing original workspace backup and new-directory restore. Register the restored workspace, reopen the same session and plans, and inspect retained task history and current native run artifacts.
6. Capture the completed desktop and 390-pixel Investigations views as part of the existing full application gallery.

Use the original native receiving owner and dataset. This binding joins that receiving operation with complete application source and persistent history.


## Saved original scenario experiments

Enable the installed original ExperimentOperator when constructing the same host binding:

    operator.science_investigations = UpstateInvestigations(
        operator,
        native_experiments=True,
        dataset_providers=(
            lambda workspace_key, workspace: diagnostics.records(workspace_key, "dataset"),
        ),
    )

The installed source is the original ES-EXP-2319 package in F0C8HGL4X6X, with the current indexed model/experiments.py in F0C8TFEQZUL. Its actual operation is experiment.run with a saved experiment_id. Its model programme retains the selected original grid, unchanged baseline, land-cover alternatives, parameter profiles, numeric values and references. The native source continues every original case and reuses completed stages.

In the existing intelligence.prepare operation, choose the complete saved experiment:

    {
      "session_id": "<retained investigation ID>",
      "action": {
        "kind": "ensemble",
        "native_experiment_id": "<original saved experiment ID>"
      }
    }

A66A's existing action form selects from inventory.ensembles. Each row now contains the original experiment ID, baseline job ID, full selection, profile/case counts, progress and native metadata. Show the saved title and actual counts beside the selection. The user edits the scientific design in the original Scenario experiments view; the investigation action retains that exact design.

The bound UpstateEngine prepares this same Action through OriginalExperiments. It verifies the original immutable plan and native preview, retains every parameter reference and source selection, pins the original plan file and native job, and puts the complete source plan into the original Store. max_members in that retained action records the full native case count selected by the saved experiment. No implicit 64-case subset is made. A case is one profile/scenario selection using the original NDR and SDR models; every alternative has its own same-profile baseline.

The native gateway commits the same plan-to-task relation before dispatching experiment.run. Operator admission returns immediately. The original ExperimentOperator creates its existing report and registered downloads after the same native programme completes. Reopening the investigation returns the actual native experiment state, complete counts and progress, registered result identities and the original experiment ID.

Use the existing result page without truncating its population:

    integration.experiment_results(
        workspace_key, original_experiment_id, offset=0, limit=100
    )

This delegates to the installed ExperimentOperator.read("inspect") and returns its original cases, total_cases, next_offset and authenticated downloads. Continue with each non-null next_offset; the original indexed engine supplies the requested ordinal slice. The complete native summary/CSV/HTML and workspace backup remain the original programme's outputs.

The investigation dataset inventory also includes each immutable experiment plan, all registered native results and the current HTML report when its recorded summary identity matches. Selecting one of those outputs uses the same original file verification as other science datasets. The source metadata keeps the original experiment, selection and baseline.

For the existing complete receiving journey, save a meaningful full experiment in Scenario experiments; choose it in an investigation; review its actual native profile/case counts; dispatch and reopen the original native task; inspect later case pages and original reports; then back up, restore into a new directory and reopen the same investigation, experiment and results.

## Portable pending-plan identity

The original workspace project ID is a canonical UUID. A registered workspace key is the directory-derived 64-character ID used by its current operator. They have separate roles.

New native plan source identities pin the original project UUID and the complete public native record after removing only its current transport tenant_id. This permits a ready plan to reopen after the same untouched project is restored into another directory. The actual native record, status, selected profile/scenario/grid, registered source identity and active task information remain part of the pinned record. A real change to that source still requires a fresh guided plan.

Completed or admitted plans retain their exact original native task binding and captured history. All original source selections and native calculation ownership continue through the same backup and restore.

### Retained partial-model programmes

The current original experiment producer validates its immutable plan and may add resolved model and legacy case fields in memory when reopening a retained partial-model programme. The binding verifies the exact original plan.json against its original experiment ID and project UUID, retains that source beside the producer's resolved native view, and uses the installed producer's actual view for preparation and execution. Existing plan bytes, scientific selections and case IDs remain the source of the same original programme. The current source interfaces were received from model/experiments.py blob 9afcb226af371301eb4c15deccee88d0f191ec4f and operator/experiment_operator.py blob e75b12a2dbe140a930813532cf27f24736b6ceb0.

# Saved diagnostics and original investigations

Authored by TokenJunkieLabs for the Ecosystem Sciences watershed application.

This component attaches a saved scientific analysis to the maintained A66A/E258 Investigations desk. It uses the original authenticated HTTP operator, extension registry, action queue, Engine, project Store, repository callbacks, Assistant, and file tickets. Scientific results are read from their retained original reports.

## Install into the maintained application

Use the complete maintained application source. Its current Investigations host composes the original E258 factory, A66A native transport, ECO264B source collections, ECD1 replay guards and the ES26 revision entry. The current collection base is F0C8NL04VQW. The original controller and navigation manifest are F0C89E0T5EK; the native designer bridge composes its retained source with the maintained registered Scenario experiments controller and its existing openExtension entry. The controller includes native saved-programme selection, paged case metrics, retained native task history, original submission continuation and immutable diagnostic conversations.

When installing this component into another existing application, first receive the maintained native package with its original eco_intelligence/install_upstate.py installer. Then run the delivered install_intelligence_operator.py against that same application and source root. Its FILES inventory includes intelligence_diagnostic_entry.py, the selected-study helper, the narrow installer and its exact source patch declaration. Run operator/install_diagnostic_investigations.py for the guarded factory/backend joins after those maintained host files are present. Preserve existing registry, source catalogue, provider configuration and native experiments support. Each installer checks the current original source and retains its predecessor before applying a change. The complete assembled application already contains these postimages.

The required scientific diagnostics retain the original model.experiment_diagnostics module. The dependency declaration is also kept at operator/requirements-intelligence.txt, so the maintained portable application captures it with the operator source.

The current A66A factory detects the installed intelligence_diagnostics module and registers DiagnosticsDatasets.records(workspace_key, "dataset") once through its existing provider callback. It also retains its scientific catalogue provider and detects the original native experiments methods. Reuse that configured factory:

~~~python
integration = operator.science_investigations
datasets = operator.science_investigation_diagnostics
~~~

If the original registry supplied a configured integration directly, retrieve the same instance from operator.extensions._extensions["investigations"]["provider"].integration. Reuse its provider/Store configuration. E258 caches the provider callables and evaluates their records on each repository read, so newly retained report revisions become available through the same Engine. Registering the same dataset IDs twice is an error.

The public namespace for all Engine, Assistant, repository, and transport calls is the current registered workspace key. The actual ProjectStore maps that key to its internal stable SQL namespace, `project:<original-project-UUID>`, through storage_tenant. Restoring a workspace preserves its project UUID and SQL namespace while receiving a new public workspace key and root.

For another existing factory that uses the optional bind_saved_diagnostics helper, pass the exact namespace used by its public Engine calls. In this A66A/E258 host that argument is workspace_key. Keep E258's internal SQL namespace mapping inside ProjectStore.

## Connect the existing desks

The maintained extension host already exposes openExtension. After the original extension registry has loaded and confirms the Investigations view, connect the diagnostic component:

~~~javascript
experimentDiagnostics.setInvestigationHandler(selection =>
  extensions.openExtension("investigations", "openForDiagnostic", selection)
);
~~~

The selection contains workspace_key, diagnostic_id, title, dataset_id, and report_sha256. The navigation dataset is `es26:<diagnostic-id>:report_json`; report_sha256 comes from the currently displayed committed report descriptor.

The controller uses the original navigation and queues `intelligence.diagnostic.open` through POST /api/actions with the existing operation_id recovery. Its payload is:

~~~json
{
  "diagnostic_id": "<original 64-character diagnostic ID>",
  "dataset_id": "es26:<diagnostic ID>:report_json",
  "title": "The retained scientific analysis title",
  "report_sha256": "<the displayed report descriptor SHA-256>"
}
~~~

An interrupted HTTP response retains the same original operation ID. Another workspace cannot reuse that selection. Existing investigation operations remain visible in their original task status; the controller never substitutes an unrelated operation.

The queued entry verifies the original report through the current Workspace and Engine repository. It captures its exact bytes, creates or reopens the associated original session, and profiles that captured report through the existing Engine.inspect method. The desk opens the normal Assistant composer, where the user enters their question. The original question action invokes the unchanged Assistant and evidence tools.

## Report revisions and scientific interpretation

A diagnostic ID fixes its declared inputs and calculation identity. A partial result can legitimately finish later under that same ID. The committed report bytes can therefore acquire a new SHA-256.

Each captured revision is retained at:

~~~text
intelligence/diagnostic-revisions/<diagnostic-id>/<sha256>/report.json
intelligence/diagnostic-revisions/<diagnostic-id>/<sha256>/manifest.json
intelligence/diagnostic-sessions/<diagnostic-id>/<sha256>.json
~~~

Its immutable dataset is `es26:<diagnostic-id>:report_revision_<sha256>`. The manifest records the original project, diagnostic and dataset identities, exact report descriptor, and original source metadata. The session association records its original session, evidence, task and operation IDs.

Opening the same bytes reopens the same conversation. A newly completed report revision receives a separate association and conversation, retaining the prior session. The project Store's shared workspace guard and the per-revision association lock keep the original session and association consistent across operators.

The session also retains a diagnostic_context event with its immutable dataset reference, source SHA and evidence ID. On every question, the existing intelligence.ask action verifies that context and the registered immutable source before passing the question to the original Assistant. Reopening a session through its saved-session menu or another browser retains the same report revision. The visible attached-analysis panel is derived from original session history, rather than transient browser state.

The ordinary profile tool returns the complete saved JSON, with source identity. evidence_page retrieves later portions of large retained evidence. These operations read the original result. Scenario deltas retain the report's alternative-minus-baseline convention; positive export reduction has the opposite sign. Interpret design spread and top-k design fractions as recorded sensitivity measures. Keep the original pollutant, units, model applicability, common spatial support, expected observation roster, and shared-cohort coverage attached to every comparison.

## Capture investigations in a selected study

The workspace-native entry point supports the original CLI without constructing an Operator:

~~~python
from eco_intelligence.study_transfer import prepare_workspace_study_snapshot

capture = prepare_workspace_study_snapshot(workspace)
~~~

It returns None when the scientific workspace has no investigation database. It does not create an empty Store.

The bound operator can use its configured original Store, including a configured external database path:

~~~python
integration = operator.science_investigations
capture = integration.prepare_study_snapshot(workspace_key)
~~~

Preparation of the callback runs before acquiring the original exclusive .workspace.lock. It resolves the existing context and, for the bound factory, records the available original task receipts. Inside the selected-study export's existing exclusive Workspace guard, prepare the fixed investigation cohort from the original scientific selection:

~~~python
prepared = capture.prepare(original_plan) if capture else None
~~~

The preparation result has schema upstate.selected-study-investigations/v1/science-dependencies, the original project_id, sorted session_ids, and scientific_dependencies containing exact kind/id/reason/required records. The original scientific dependency walker validates and visits those records, acquires their existing native locks and stages their immutable source objects. It then calls:

~~~python
receipt = capture(staged_workspace, expanded_plan) if capture else None
~~~

The expanded plan keeps the original project and selection. The callback retains the session cohort selected by the first prepare call; adding a referenced run or dataset does not recursively select more conversations. Repeated preparation of the same selection returns the frozen dependency result. A changed selection requires its own prepared capture.

These dependencies include native runs and programmes, retained source collections and observations, grids, native comparisons, observation comparisons, and saved diagnostic sources referenced by the selected sessions. A conversation can therefore continue to inspect its original scientific inputs and reopen a prepared action after receiving the study. An empty cohort yields an empty preparation result and no history receipt.

The plan is the original upstate.study-transfer-plan/v1 object. Diagnostic IDs come from nodes of kind experiment-diagnostics; native run IDs from runs; programme IDs from experiments. Session selection follows exact retained source/operation references and the original diagnostic-session associations. Once selected, a session travels in full, including its original events, evidence, plans, requests and dependent native bindings/task receipts. Typed immutable report references in those sessions bring their report and manifest members into the staged study.

The implementation reuses the original SQLite.backup snapshot routine. Under the caller's existing exclusive guard it opens the already bound database read-only, avoiding another shared-lock acquisition. It filters only the private copy, checks the known original schema, preserves dependent rows, removes discarded free pages with VACUUM, checks integrity, and publishes a self-contained snapshot by the original fsync/link sequence. Original live history stays in its existing Store.

Default state is `intelligence/investigations.sqlite3`. Relevant operator receipts, complete investigation exports, report revision files and diagnostic-session associations retain their original relative members. The original portable backup captures the staged Workspace and the maintained eco_intelligence/operator application source. Existing complete-workspace backup still captures the full project's history through its ordinary exclusive lock.

The callback returns null when no relevant session exists, or a receipt with:

- schema, original project_id and project_sha256, and storage_namespace;
- members containing relative path, byte count and SHA-256 for every staged investigation member;
- session_ids, evidence_ids, plan_ids and native_task_ids;
- full selected session titles/reasons, evidence/session pairs, plan states, native task summaries, table counts and immutable report revisions;
- scientific_dependencies matching the prepared original history's source closure.

The exporter validates these members, includes the receipt in its transfer identity, and compares their hashes with the original portable archive manifest. Preview remains the scientific dependency footprint; the relevant conversation history is captured at export. A restored live Store can grow through later conversations. Receiving validation checks preservation of the original required identities and schema, while immutable report revision files retain their exact hashes.

Use `eco_intelligence.study_transfer.verify_received_investigations(workspace, receipt)` for that continued receiving check. An explicitly configured integration can pass its bound Store path as `database_path`. It verifies the original project namespace, required session/evidence/plan/task bindings and association identities, while allowing appended rows and completion of a previously pending association. Members marked `mutable: true` are the live database and association indexes; their initial archive hashes remain in the receipt, but later live bytes can advance. Report revision files, source manifests, original operation receipts and completed exports retain their immutable member hashes.

## Work with saved native programmes

In Guided actions, choose the native programme operation and select an existing saved programme. The selector uses the original retained catalog, including its title, current native state and complete case design. Prepare and execute retain the programme's baseline, scenario and parameter choices through the existing native action.

Design native programme opens the original Scenario experiment designer in the same workspace. Select the retained baseline, alternatives and profiles, enter the explicit parameter values and references, and use its original preview. This entry starts with Save design selected; Save and run remains available in the same form. The original operator admits the save or run, and Investigations retains that exact task ID, request and originating conversation. On completion it uses the programme ID returned by that task. A different currently selected conversation stays selected until Use in its original investigation is chosen.

Refresh originals reconciles the retained operation, conversation, evidence and programme independently of the catalogue and source-file inventory. A temporary failure in either inventory remains visible by name while the original task and saved results continue to load. A later refresh clears each resolved error. Concurrent refreshes in the same workspace share one read sequence, and completed operations keep their original task and result identities when an optional follow-up read fails.

The native task display survives browser reopen. Open original task exposes the maintained task recovery and logs; Refresh task status reconciles that same operation. Completed results are read from the native programme and kept out of browser recovery storage. Select the returned programme, then Analyze programme in this investigation to retain its evidence for subsequent questions. Other configured gateways can keep their explicit parameter-grid workflow; the original native binding uses saved programmes.

Read programme results retrieves an existing page through the authenticated original experiment route. The view shows native models, complete/failed/pending counts, profile and scenario names, each retained output's units, baseline and alternative mass, paired support, and execution stages. Previous/Next cases read the original pagination. A reduction is baseline minus alternative; alternative-minus-baseline remains the canonical change column. A pending case's declared design is separate from its retained metrics.

Inspect retained task reads the project's original native task or restored task receipt. Continue original submission appears only when the original plan marks that continuation available. This uses the maintained intelligence.continue action. Opening a programme or task reads its retained state; executing a prepared action stays on the original queue.

## Receive through the original operator

Use the installed application, real retained Workspace and original native run roster.

1. Reopen a saved scientific diagnostic. Select Investigate this analysis and confirm the attached title, report revision, original session and evidence match that saved result. Repeat from another currently selected conversation and confirm the original queued action selects the returned diagnostic session.
2. Ask a question about scenario effects, profile-dependent ranking, shared support, or observation coverage. Compare its source-cited values with the original report. Reopen the same investigation in another browser session.
3. When a partial diagnostic finishes, open its new report revision. Confirm the newer revision has its own immutable source and conversation; reopen the earlier conversation and inspect its original revision.
4. Export a selected study through the original CLI and operator paths. Restore it into a new directory. Reopen the diagnostic and its relevant investigation through the newly registered workspace key, preserving original project/session/evidence identities.
5. Append a new question after restore and reopen the study. The live conversation can advance while its captured original report revision and earlier evidence remain available. Open original JSON/HTML investigation exports through fresh authenticated file tickets.
6. From Guided actions, choose Design native programme, preview its original cases and save. Confirm the exact task is retained and its returned programme is selected when complete. Repeat while switching to another conversation; Use in its original investigation must restore the originating conversation explicitly. Reopen the browser while a task is pending and refresh that same task. Read the returned native case page, then Analyze programme in this investigation to attach its retained evidence.

The JavaScript entry has been checked against the actual A66A controller/queue contract, including completed-session persistence and rejecting a mismatched workspace selection. The receiving application supplies native Python, SQLite and browser execution for the integrated journey.

# Scientific setup review

## Product behavior

Scientific setup captures a named question and its actual selected working project before model output is needed. It preserves the original grid, parameter profile, baseline, selected alternatives, observations and complete selected source editions. The resulting specification is an ordinary retained source collection. The existing customer review owns every review decision, correction, response revision and export.

The operator opens Scientific setup, selects its existing project objects, previews the specification, then captures it. The same task opens the original customer-review record and provides the readable setup, machine-readable specification, source inventory, prepared-input inventory and scenario-change table. The original Returned responses desk handles external response intake and reconciliation.

There is no additional execution permission or approval state. Requested scientific criteria appear as review findings. Models retain their existing operation and validation.

## Captured content

The readable index.html and specification.json cover:

1. Scientific question; source-bound reporting area and model domain; actual context buffer and explanation for the chosen domain.
2. Original selected source collections, URIs, editions, declared coverage, units, intended uses, conversions, derivations, resampling and all original companion relationships.
3. Complete grid definition, including CRS, bounds, actual cell size, affine transform, width, height, cell area and original alignment method. Capture reads the actual prepared raster headers, including actual NoData and data types, and compares each with the selected grid.
4. Current native InVEST version/source, selected models, original profile, original coefficient table, parameters and references.
5. Actual baseline and selected alternative objects, each patch's mask source, layer, typed original-field selection, from/to codes and reason.
6. Original observation records and CSV, original measurement metadata, admitted annual-load row counts and contextual row counts, with the stated validation method, intended comparison and limitations.
7. Assigned reviewer and receiving operator. Empty names remain unassigned; the application never invents a person or a decision.
8. Exact native selections and retained files for a second operator to reopen after ordinary Workspace transfer.

All selected collection entries are retained, including context entries. Full original metadata stays in the machine-readable inventory even where the human sheet summarizes it. A missing declared source attribute remains null/Not declared. The captured source companion tree keeps each original view_path below its collection and source namespace, so sidecars remain together.

## Selection contract

Schema: upstate.scientific-setup-selection/v1.

Required text fields: title, question, domain_rationale. The title is limited to 300 characters; the question and each note use the original review core's 20,000-character limit. Independent domain/validation descriptions permit 40,000 characters. NUL characters are rejected. Required original 64-hex Workspace IDs: grid_id, profile_id, baseline_scenario_id. alternative_scenario_ids, source_collection_ids and observation_ids are arrays of unique existing IDs; absent arrays become empty.

The grid must already be complete. The baseline must be an existing baseline with no patches; each alternative must be an existing landcover scenario with real patches. This workflow captures those objects; it does not create a grid or invent scenario changes.

validation is an object with required method and optional intended_comparison/limitations strings. roles contains scientific_reviewer and receiving_operator objects, each with name, role and organization strings. Unassigned roles are valid and shown as such.

Optional expected_resolution_m is a positive numeric metre value. Optional expected_alternative_count is a nonnegative integer. These are comparison requests, not global model defaults. For the current Ecosystem Sciences setup, use the requested 30m and two alternatives when making the actual selection. Other projects can retain their own resolution and number of alternatives. notes is an optional list of strings.

Selected source collections are closed over the grid inputs and area selections, profile coefficient table and all selected scenario mask editions, plus explicit additional source_collection_ids. Observation CSVs are included separately through the actual observation record.

## APIs

model.setup_review.normalize(selection) validates structural selection.

model.setup_review.preview(workspace, selection) returns:
- selection
- specification
- checks
- source_inventory
- requirements

Preview uses retained metadata. Raster header is null until capture; capture reads the actual files with rasterio.

model.setup_review.create(workspace, selection, operation_id=None, created_at=None) returns retained detail with setup_id, source_collection_id, review_id, specification, checks, setup, review and files.

Operation IDs are existing 64-hex task IDs or a deterministic project/selection digest for direct callers. The operation retains its original creation time. Repeating the same operation and selection resumes interrupted capture or returns its original completed setup. Capture and source import share the existing Workspace lock with portable backup; that lock is released before the original review operation acquires it and reacquired for final setup publication. Reusing an operation ID for another selection is rejected. A deliberately new capture can use a new operation ID.

model.setup_review.detail(workspace, setup_id), catalog(workspace) and verify_all(workspace) read the retained project and original review state.

The immutable setup object is saved under scientific-setups/<id>.json using the ordinary Workspace content identity. It binds the imported source collection, actual review ID, selected originals and captured specification hash. It stores no duplicate review decision.

### Operator registration

Provider: operator/scientific_setup.py, ScientificSetup(operator, fault).

Action: scientific.setup.create. Task payload is the complete selection. invoke(task) binds task.id and task.created_at; result returns setup_id, source_collection_id, review_id, specification and checks.

Routes:
- GET /api/scientific-setup/catalog -> read(workspace_key, "catalog", payload)
- POST /api/scientific-setup/preview -> read(workspace_key, "preview", payload)
- GET /api/scientific-setup/detail?setup_id=ID -> read(workspace_key, "detail", payload)

State hook: overview(workspace_key). Task decoration hook: decorate_task(task). Optional verifier: model.setup_review.verify_all(workspace).

The parent integration adds operator/web/scientific-setup.mjs and its ordinary operator/extensions descriptor. No edit to model/reviews.py, operator/customer_reviews.py, existing client core or server static routing is required.

Catalog lists original grids, profiles, scenarios, source_collections, observations and retained setups. Detail includes native operator file tickets in _downloads. Completed tasks carry _review.review_id and _scientific_setup {view:"scientific-setup",setup_id,review_id}.

## Normal source and review package

The snapshot is written under setup-packages/<operation_id>/ with exact native object JSON, original sources, prepared grid files, observation CSVs and readable sheets. Originals use hard links when possible, with file-copy fallback, then the ordinary importer retains them by content hash.

sources.json is an ordinary upstate.sources/v1 manifest. Its primary is specification.json; all readable sheets, exact native object JSON and captured original/prepared files are companions. Source ID is scientific-setup-specification. Source metadata provides guide_file, source_inventory_file, prepared_inputs_file and scenario_changes_file.

The original customer review selects this source collection and eight setup requirements. Every primary/companion becomes a normal review artifact with its original bytes and identity. Existing create_review, response_template, import_response, export_review, compare_reviews and review_reconciliation retain their APIs and response history.

The readable setup links to originals within its preserved companion tree. The review packet supplies the specification and those captured materials. The full ordinary portable Workspace transfer supplies the working native project, application and original object IDs.

## Native receiving command

First list actual available selections from a prepared receiving Workspace:

    python -B -m source_tools.receive_scientific_setup \
      --workspace /owned/existing-workspace \
      --catalog --output-dir /owned/setup-catalog

Use actual values from that catalog and the scientific request to retain a selection JSON, then:

    python -B -m source_tools.receive_scientific_setup \
      --workspace /owned/existing-workspace \
      --selection /owned/scientific-setup-selection.json \
      --output-dir /owned/scientific-setup-receiving

The output directory must be outside the Workspace and application source. The command retains original selection bytes, invokes normal setup capture/review creation, exports the exact current review generation, builds a complete Workspace transfer, restores it and reopens it through Workspace. It compares exact grid definition, prepared file hashes, profile, scenario objects, source editions/companions, observations, captured specification and review response head.

Its outputs include invocation.json, original-selection.json, captured-setup.json, specification.json, response-template.json, customer-review/, review-export.json, workspace-transfer.zip, workspace-transfer.json, reopened/, restore.json, reopened-review.json and receiving-result.json. Invocation and result record the accepting hostname, interpreter, Python version and actual paths. The request is decoded, hashed and retained from one original byte read. A reused Workspace archive must match its retained size/hash receipt; an interrupted receipt is reconstructed only after complete ordinary archive verification.

The command never writes an invented reviewer response. Actual customer or internal reviewer responses are entered through the existing customer-review/Returned responses flow; later exports bind that actual head. If a saved output already contains an older response generation, choose a new output directory to retain both review generations.

On interruption, the stable invocation resumes the same setup operation and selected IDs. Existing original archive/export bytes are inspected, not overwritten. A failed invocation retains its error type/message in the owned output directory for the same receiving operation to continue.

## Current ownership and integration

This backend is additive to the scientific application at opportunities/upstate_forever_2026. Original review/reconciliation/Workspace interfaces were read at cumulative e0ebf7f2611b7b4f5672923e8eb3c5330db20f4f; current main extension registry supplies provider/action/client routing. Original scientific setup lane 9333 and current source/application owners were addressed in main Eco 1791861581.087459.

The setup is reusable. The current first-order commercial acceptance provides its requested scientific content; commercial pricing and schedules are not model defaults or software gates.

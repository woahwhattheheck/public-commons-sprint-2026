# Retained point-source observation context

## Operator workflow

The registered **Point-source context** desk opens original reported discharge sources that are already retained in the current study. It removes the need to reconstruct a separate filesystem source tree for this binding operation.

Select the original reported-period table, routed annual-quantity table, outfall-to-gauge relationship table and gauge-cohort table. Each choice identifies its actual source collection, original source entry, vintage and body hash. The catalog recognizes the authored original paths; it never combines sources solely because their display titles look similar.

**Review source coverage** reads and verifies the actual retained bytes through Workspace.source_file. It validates all source table fields; every annual series against the original network relation; the reported-period calendar against the annual quantities; and all cohort membership, species units and exact Decimal totals against the original annual and relationship sources. An incompatible set of source editions produces a specific error before creating observation context.

The review displays the original facility/state-outfall identities, actual upstream/downstream relation, complete annual and quantified-period quantities for each original species, monthly quantified-day coverage, and original source hashes. Complete facility shares appear only for a fully quantified cohort year. The whole-basin cohort remains visible separately from actual network membership.

**Create observation context** submits the existing operator's queued operation. The task retains two ordinary observation editions: complete reported annual quantities and quantities over actual quantified periods. Both carry the exact dated source calendar and all four original source bindings. Operators open these editions directly in the existing Observations desk; the task completion also exposes those links.

## Current actual source family

The current adapter consumes the original Eighteenmile 2023 DMR/routing processor format. Its original period quantity field is explicitly named amount_in_2023. The source reader therefore requires the matching 2023 annual edition rather than silently treating that column as another year.

Required original source paths:

- derived/period_loads.csv
- routing/derived/annual_quantities_with_routing.csv
- routing/derived/outfall_gauge_relations.csv
- routing/derived/reported_quantities_by_gauge_relation.csv

These tables come from the retained original DMR and routing manifests under observations/eighteenmile_2023/npdes. The existing source intake imports those manifests with their complete original EPA and network companions. This desk binds the retained source entries; it does not reacquire or regenerate those scientific originals.

At USGS-02186702, the actual network relation places Milliken and the two Pickens plants upstream. Pendleton-Clemson is downstream on the same original NHD reach. The unsplit whole-basin polygon contains all four facilities. The upstream complete phosphorus source total is 949.31580872 kg; the whole-basin four-facility quantity is 1119.47500782 kg. The review preserves this distinction, as well as partial total-N coverage and separately reported nitrate/ammonia species.

## Native semantics

Reported outfall discharge quantities remain point_source_discharge context. Their source amount is distinct from modeled landscape catchment export and from delivered downstream mass. Original species, EPA reporting feature, monitoring location, represented days and source-record IDs remain on each observation. The existing model/observation_support.py admission rules continue to keep these quantities outside native catchment residuals.

The calendar uses the existing exact Decimal source transformer. Each selected reported mean rate is multiplied by its actual monthly overlap days. Those allocations must reconcile to every retained annual quantified series. This represented-period averaging assumption is inherited from the original source processor; the desk does not infer daily discharge variability.

The binding is immutable and content-addressed. The source signature includes the component version, four actual source selections and their retained lineage. A queued operation requires the signature returned by the preview. A repeated completed operation reopens its exact binding and observation IDs. If execution stops between the first and second observation imports, repeating the operation resolves those same content-addressed observations before completing the binding.

## Component and API

The source module source/retained_point_sources.py provides:

- catalog(workspace): original retained choices and compact existing binding summaries.
- preview(workspace, selection): exact source coverage and lineage with source_signature.
- bind(workspace, selection, expected_signature=...): the two observation editions and immutable binding.
- summaries(workspace): small state records for the existing operator poll.

Each selection has periods, annual, relations and cohorts members, each containing source_collection_id and source_id. No local path is accepted by the registered binding action.

The registered provider exposes action observations.point_sources.bind and authenticated catalog/preview/binding routes through the maintained extension registry. The browser uses the shared workspace and task APIs. It aborts superseded requests, ignores stale workspace/mount results, keeps the user's source choices per study, and refreshes its catalog only when retained source collections change or the operator requests it. It does not add a second polling loop.

## Install

First install the maintained registered operator and observation-support 1.1, including its exact source calendar and physical-support ingestion changes.

```sh
python operator/install_point_source_context.py --application CURRENT_APP --source-root RECEIVED_COMPONENT
```

Restart the existing operator process using its current workspace and authentication configuration. The installer copies seven additive files and registers the descriptor last. Every changed preimage and the pending installation intent are retained. Identical repeat installation returns the same current receipt. Independently edited component files require a real source merge.

The component does not replace app.mjs, the existing observation-series viewer, the original source intake, or native model/calibration modules. It supplies an additive operator entry point into the retained source and observation interfaces.

## Verification

The actual retained 17 gauge-cohort rows were checked against all 20 original annual series and all four actual network relations. Original member identities, quantified sums and complete annual sums match using exact decimal integer arithmetic. The existing calendar transformation had already been reconciled against all 20 retained source series. Browser module grammar was checked in V8. Native application execution uses the maintained Workspace/source/observation interfaces and is to be exercised by the equipped receiving application with its actual retained source collections.

Original sources and methods:

- Source bank: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8J1E75FV
- Original DMR packet SHA256: bee7c5125750f822eb8fd8876f8e601b0fe908925087095136ef5adf4131960a
- Routing packet SHA256: 6f393a1c97b786f4e91d3a11b92b7ccdcb72a8ee9abe2c9299eac3e69ca8accd
- EPA reporting field definitions: https://echo.epa.gov/help/reports/effluent-charts-help
- Gauge reference: https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702?f=json
- Native model physical context: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html

## Installer ownership in edition1.0.2

The component now owns the exclusive flock on its existing installation lock. It acquires that lock before preflight, preimage retention and publication. The exact earlier source-context-composed lock repair is recognized as an authored predecessor so standalone reinstalls and cumulative source==application installs both remain resumable. Other independent file changes still require a maintained source merge. Observation binding identities, source signatures, original quantities and browser actions are unchanged.


## Receiving and portable capture (component 1.1.0)

The bind operation holds the original workspace lock while publishing both observation editions and their final source binding. Portable capture takes the same lock, so a capture cannot inventory an unfinished binding. Original content identities remain the same as component 1.0: the source method version and exact retained quantities are unchanged.

Both the registered operator receiver and the original portable restore now verify retained point-source bindings against the actual source tables. Verification reconciles the 230 original periods, 20 annual series and 17 upstream/downstream/whole-basin cohort rows, the exact monthly source calendar, both observation metadata contracts and every retained observation's original annual row and quantity. It verifies the annual source body and keeps every outfall quantity outside native catchment fit statistics. The check reads records and retained source views; it does not create observation editions or rerun a native model.

The installer composes one guarded verification block into the current model/portable.py, beside existing programme and Scenario source-context receiving checks. It retains the live shared file and all peer additions. It accepts its exact previous 1.0.2 source and recorded prior/pending versions, preserves changed preimages, and installs the registry descriptor last.

### Use the original retained sources directly

List the actual available source collection/source IDs:

    python -m source.retained_point_sources_cli --workspace ACTUAL_WS --catalog --output catalog.json

Save the four selected entries as an object with periods, annual, relations and cohorts keys. Each value contains source_collection_id and source_id. Use those retained identifiers unchanged:

    python -m source.retained_point_sources_cli --workspace ACTUAL_WS --selection selection.json --output review.json

Create the same two observation editions as the operator action, retaining the complete preview alongside the result:

    python -m source.retained_point_sources_cli --workspace ACTUAL_WS --selection selection.json --retain --output binding.json

An earlier source_signature can be supplied with --expected-signature to require exactly that reviewed source. Repeating an identical bind reopens and verifies the same retained binding.

Verify a restored workspace's original source closure:

    python -m source.retained_point_sources_cli --workspace RESTORED_WS --verify-workspace --output verification.json

These commands consume source manifests already retained by the scientific workspace. The original source-root intake remains available through source.import_observation_support.

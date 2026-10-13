# Saved Economic comparison lineage in a Scientific Study

This additive resolver carries the actual saved comparison selected as an Economic comparison report source. It uses the original Scientific Reports and Study transfer workflow. It does not run a model, calculate a cost, render another report, import a source collection or create source-view links.

## Selection and original identity

The source metadata and its retained observed-report recipe must both declare `report_context_kind="economic-comparison"` and the identical `economic_comparison_identity`. The source identity retains its producer edition, original project, comparison and ordered first/second Economic edition IDs, comparison digest, exact complete member roster, and original adapter digest. The imported source ID must still equal the digest-derived source key from the original identity plus complete recipe.

Every recipe input must be the corresponding original comparison member under `comparison/<path>`; the imported original byte length and SHA256 must match. No source is joined by title, run label or a guessed path.

## Same-project native records

When the source project is the current original Workspace project, capture and validate:

- `economic-comparisons/<comparison_id>/`: complete original comparison record, manifest, readable output, JSON, CSV, source code, both original Economic packages, and retained native recovery files;
- `economic-editions/<first_id>/` and `economic-editions/<second_id>/`: exact original edition records and their full delivery manifests, selections, reports, physical-input packets, native scenario-source companion, application source and ZIPs;
- each **existing** `scenario-decisions/<producer_report_id>/`: the original decision/report directory used by EconomicWorkbench to prepare a new reviewed cost edition.

Comparison records are validated using the original input/producer digest. Both original saved edition records and reports must equal the copies inside that comparison; their canonical digests must equal the comparison's retained hashes. Every economic delivery file uses its original declared byte/hash. Physical support, original quantities, currency, horizon, discount rate, criteria and selected costs are preserved unchanged.

Native physical producer selection follows the maintained EconomicWorkbench source path: prefer its existing `decision.json`, otherwise `report.json`. A completed summary resolves only its exact declared JSON descriptor. The full report must have the original producer ID, source SHA256 and selected reporting zone. The full existing producer directory is included without recomputation or reconstruction. This enables new reviewed cost calculations after restoration when that source was present.

If that original producer directory is absent, both complete Economic editions and comparison remain transferable and reopenable. The adapter does not manufacture a replacement producer or claim that new cost calculation is available. Actual retained directories are visible in the Study file inventory. The declared producer binding is stable; restoring a previously absent genuine producer later does not alter the original comparison lineage.

## Imported reports from another project

For a report source whose original project differs from the current Workspace project, retain its original recipe, complete source companions and exact foreign origin. Do not look up the same IDs in the receiving Workspace. The source is recorded as `external_project`, with no fabricated local native comparison or editable producer.

## Receiving and concurrency

The resolver uses `closure.read`, `add_file` and `tree`, preserving existing contained-path, symlink, byte/hash, file-identity, staging and unchanged-directory checks. It records its original source lineage in the same `closure.report_source_records` used by existing Scientific Study exports and receiving verification. It imports no operator package or numerical solver.

The existing resolver's `report_source_keys` gate remains before this new call. Thus older Study archives keep the source dependency semantics actually captured at export; adding this module does not silently require a new native dependency on their restoration.

Retained producer hashes identify original output sources. They are not required to equal today's installed comparison or rendering code. Reopening a saved edition never silently re-renders it.

## Integration owned by the Scientific Reports producer

Add the following inside the existing `scientific_report_study_transfer._source`, after the current observation-comparability include and before the returned observed binding:

```python
    from . import economic_comparison_study_transfer
    economic_comparison_study_transfer.include_source(closure, collection_id, entry)
```

Keep that call after the existing captured-source gate. No new root Study selection kind, generic renderer, economic action, provider or desk is introduced. The owned additions are `model/economic_comparison_study_transfer.py` and `operator/web/economic_received_comparisons.mjs`; preserve concurrent edits to the shared resolver, native receiver and browser.

## Open the received comparison

In the existing Received Studies view, the **Saved Economic comparisons** card offers **Open saved comparison**, **Open this report only**, **Add to current report**, and **Open retained source files**. The local comparison action opens its exact original comparison ID in the existing Economic desk. The original receiving Workspace must still be selected; the action does not silently switch projects or change the Economic input draft.

The first and second saved edition details show their original titles, IDs, native producer report, source hash and selected zone. Current source availability is shown separately from the immutable historical lineage. A new cost edition is described as available only when the resolver has read and verified the original full native producer report with the expected source SHA and reporting zone, and the actual native directory is present in the current Workspace. This status does not assert when the files arrived, does not require a model run, and does not imply that a field cost ledger or engineering estimate has been supplied.

For another project's source, the card offers only the original report and retained source files. It never substitutes matching IDs from the current project. Full comparison and both original Economic packages remain accessible through their retained source collection.

The card retains the existing parent's Workspace, detail and selection guards before every action. Pending-parent state disables its controls. Original titles and IDs are escaped; long hashes wrap on narrow screens. The Scientific Reports controls pass the actual original collection/source pair to the maintained composer with explicit replace or append selection mode.

### Native receiver joins

In `model/study_receiving.py`, add the maintained adapter import:

```python
from . import economic_comparison_study_transfer as economic_comparison_transfer
```

After the existing comparable-period expansion in `_summary`, add:

```python
        **economic_comparison_transfer.summary(identity),
```

After the existing comparable-period augmentation in `detail`, before its final unchanged check, add:

```python
    economic_comparison_transfer.augment(closure, retained, result)
```

The catalogue additions are `economic_comparison_source_count` and `saved_economic_comparison_count`. Detail adds `economic_comparison_sources`, containing the unchanged captured original record plus `native_source_availability` for each local edition. Availability does not enter the original Study identity.

### Existing browser joins

In `operator/web/received_studies.mjs`, import:

```javascript
import {receivedEconomicComparisonsHTML,openReceivedEconomicComparison} from './economic_received_comparisons.mjs';
```

After the existing comparable-period HTML, add:

```javascript
    html+=receivedEconomicComparisonsHTML(value,!!disabled);
```

Add this dispatch branch alongside the original cohort branch:

```javascript
    if(action?.startsWith('economic-comparison-')){
      const ws=workspace,e=epoch,value=opened;
      if(!value||value.id!==selected||value.workspace_key!==ws)throw Error('Reopen the original received Study.');
      return await openReceivedEconomicComparison(host,value,target,{
        workspace_key:ws,current:()=>current(ws,e)&&opened===value&&selected===value.id,
      });
    }
```

The helper uses `host.openDesk('economic-desk','openSavedComparison',{workspace_key,id})`, the Economic desk's maintained public opener. That opener must retain its active-Workspace check and await native mounting/recovery before opening the exact saved detail. It uses `host.openScientificReport` for original report composition and `host.openItem('sources', collection_id)` for retained source files.

The Scientific Reports owner composes these small joins into its current shared source. Register the owned model, helper and this guide in the existing installed application source closure; include the existing Economic opener dependency. No separate extension, screen, queue or generic report producer is introduced.

## Validation boundary

The source was reviewed against actual retained current `EconomicWorkbench._edition/_source`, `EconomicComparison._inspect/invoke`, the complete Economic comparison report-source adapter, original decision export, and selected-Study closure/receiving contracts. The actual browser helper functions were parsed and exercised in V8 for exact openers, escaped titles, local/external availability, source actions and stale selection rejection. This is not a native browser or Python execution claim. The producing worker must use the completed original Workspace for selected Scientific Report export/restore, reopen the exact resulting reports and application, and LOOK at actual desktop/narrow screens and outgoing attachments before client-ready. Preserve original saved editions and source data during that existing receiving course; no duplicate model run is required.

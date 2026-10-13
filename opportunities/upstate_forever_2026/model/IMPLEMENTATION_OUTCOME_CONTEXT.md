# Add a saved outcome evaluation to a scientific or client report

The existing Implementation desk produces a saved outcome edition from the selected original plan revision. The report-context adapter registers that exact edition as an `OBSERVED_CONTEXT` document. A current map-release draft can then include it alongside its already selected studies. Scientific and client reports show the saved comparison and retain the underlying files in the complete package.

## Operator flow

1. In Implementation, open the saved outcome evaluation you want to use. Its title, original plan revision, selected sites, measurement groups, inclusive periods and result support remain visible.
2. Preview report context. The preview shows the exact outcome edition, retained member count, original local attachments and previously selected observed studies. If a map-release draft is open, including an unfinished cohort, the preview is bound to that complete draft. A preview without an open draft registers only the original source.
3. Register the selected outcome source. The existing queued action imports its original files and returns the actual source collection and document IDs.
4. Open the prepared report selection explicitly. The existing atlas accepts it only while the original captured draft is still current. A later edit or different workspace keeps that newer draft intact; preview again against the desired draft.
5. Build the map release through the existing atlas. The original scientific and client report files, source files, maps and working archive remain part of the same release.

A source-only registration returns the source choice for later selection and a null delivery selection. It does not create a native model cohort. To add that source to a later draft, preview and register again against the actual draft; the source is reused and the ordered observed binding is recomputed by the existing collector.

## What the source retains

All 17 members of the original outcome report bank remain under `outcome/`, unchanged. They include the selected `plan.json`, original Implementation report, new outcome HTML, complete calculation JSON, all four outcome CSVs and the original report manifest. Their internal relative links stay usable.

The adapter also reads local source links from that selected saved plan. It uses the existing FIELD12 attachment inventory, retaining local files only through their declared original size and SHA-256. Available original lab CSVs, mapping and audit files are copied under `original/attachments/<sha256>/`. Declared references without complete file descriptors or with unavailable original files remain explicit in `original/attachment-inventory.json`. Changed bytes fail verification.

The source root contains:

- `observed-report.json`: the existing `upstate.observed-report/v1` recipe;
- `model-sources.json`: an importable `upstate.sources/v1` manifest;
- `context-identity.json`: the original outcome, plan binding, analysis selection, member hashes and attachment inventory;
- `source-receipt.json`: actual imported collection/document identities, observed binding and retained-file descriptors;
- `handoffs/<operation_id>/handoff.json`: the exact original report selection and resulting binding;
- `handoffs/<operation_id>/delivery-selection.json` when a report selection was supplied.

The imported document role is `OBSERVED_CONTEXT`. Its recipe lists the exact retained companions as inputs. Existing source import and portable restore preserve those relative paths.

## Quantities and interpretation

Report sections consume the saved outcome JSON directly. They include full-period mean bounds, explicitly separate complete-date and quantified-only subsets, before/after date and result counts, unresolved support, direct after-minus-before changes, fixed-reference same-date differences, monthly comparisons and common-month balanced changes. Unpaired dates retain their original reasons.

Censored bounds, open endpoints and unavailable intervals pass through the existing outcome formatter. The adapter does not average again, substitute a detection-limit fraction, combine incompatible method groups, infer an intervention date or relabel a descriptive comparison as a causal estimate.

The complete original group support and units accompany each site comparison. Period support remains distinct from sampled site–group–date bins and unique site–date combinations. The source record CSV and complete calculation JSON retain the original decisions and identifiers.

The existing scientific renderer consumes the recipe's typed tables and links. The client bridge converts those same blocks into the existing client report structure, preserves the observed binding in its quantity provenance, and links any retained scientific SVG with its original caption. Source figures continue to render in the scientific report. Current client outputs keep their distinct `client-report` stems, briefing and index; scientific outputs keep their original stems.

## Existing observed studies and concurrency

The adapter calls the current `observed_context.source_choices` and `bind` functions. Existing ordered `observed_context_sources` remain in their original order. The new source is appended once. A legacy single `source_roles.OBSERVED_CONTEXT` choice becomes the first ordered source; its actual body and member bindings remain independent.

Only the ordered observed source list, the corresponding primary observed role and the recomputed observed binding are changed in the supplied report selection. Native grid and run cohort, source/report and economic edition hashes, native-study metadata, layout, contacts and other source roles retain their original values.

The preview operation ID binds the immutable outcome edition and files, the source attachments, the current collector edition, the complete supplied report selection and its actual existing observed binding. The queued import rereads these inputs before proceeding. A different selection requires a fresh preview.

Registration is idempotent for the same original source identity. Repeating the same handoff verifies its retained files and actual imported binding, then returns the same source and selection file. Importing the same source into a different current draft produces a distinct handoff while reusing the source collection.

## Native API

```python
from model.implementation_outcome_context import (
    preview_outcome_context, import_outcome_context,
)

preview = preview_outcome_context(
    workspace, plan_id, outcome_id,
    existing_report_selection=current_delivery_selection,
)
result = import_outcome_context(
    workspace, plan_id, outcome_id,
    existing_report_selection=current_delivery_selection,
    expected_operation_id=preview["operation_id"],
)
```

The preview includes `operation_id`, `title`, `plan_binding`, `source_identity`, the saved analysis `selection` and `summary`, original attachment inventory, member counts, prior observed choices/binding and whether a delivery selection was supplied.

The import returns actual `source_collection_id`, `source_id`, `source_role`, original `source_binding`, complete ordered `binding`, `delivery_selection`, `delivery_selection_path`, `directory`, verified Workspace-relative `files` and `reused`. The provider creates fresh download tickets from those real descriptors.

Without `existing_report_selection`, both delivery-selection fields are null. The imported source and its binding are still returned.

## CLI

Run from the maintained project's root with the same native interpreter and Workspace as the saved outcome:

```bash
python -B -m model.implementation_outcome_context \
  --workspace "$WORKSPACE" --plan-id "$PLAN_ID" --outcome-id "$OUTCOME_ID" \
  --delivery-selection "$CURRENT_SELECTION" --preview

python -B -m model.implementation_outcome_context \
  --workspace "$WORKSPACE" --plan-id "$PLAN_ID" --outcome-id "$OUTCOME_ID" \
  --delivery-selection "$CURRENT_SELECTION" --expected-operation-id "$PREVIEW_OPERATION_ID"
```

Omit `--delivery-selection` for source-only registration. Use the actual saved outcome ID and operator selection; the source-native receiving run supplies its real plan revision.

## Receiving the original three-lake case

The maintained WQP receiver creates or reopens the original 88-result case and returns its actual applied plan revision. The saved descriptive comparison uses explicitly selected SV-838 and SV-840, original analytical-method groups, April–June and July–October periods, Final QA, UTC and an explicitly selected zero lower bound in the original unit. Its outcome contains 57 selected results, 31 distinct site–date combinations and 27 site–group–date reference pairs. The exact expected bounds and method-specific support remain in `IMPLEMENTATION_OUTCOMES_METHOD.md`.

After the original outcome is built, preview and import that returned outcome ID. Reopen its original HTML and CSVs from the registered source; build the existing report selection and inspect the same observed sections in both scientific and client outputs. Reopen or restore the complete release with the original source attachments and confirm its actual source and plan bindings.

# Source-profile comparison

This component connects original biophysical tables to the existing native study workflow. It is part of the Upper Savannah scientific application and uses its existing Workspace, selected-model validator, source receiver, extension host and task queue.

## Use in the operator

Open **Source profiles**. Choose an original reference profile, one or more candidate profiles and, when available, the actual prepared grid. Name the comparison and choose **Compare sources**.

The comparison retains:

- Each original profile, its selected native models, original table SHA256, references and source-body/companion metadata.
- Original land-cover codes and descriptions side by side. Codes are matched by their actual integer values.
- Every available NDR/SDR biophysical coefficient, separate native routing parameters and source-supported derived coefficient steps.
- Original prepared-grid land-cover counts and missing-code coverage for each source profile.
- A snapshot of retained runs using these exact profiles and, when selected, the same grid. Native artifacts carry their actual units and valid cells.

Choose **Save comparison and report** to retain the immutable comparison and its complete report through the existing queue. It produces HTML, coefficient CSV, parameter CSV, complete JSON, the exact original CSV tables, original source bodies and companions, and a deterministic ZIP. It preserves the saved comparison when the browser closes or the Workspace is backed up and reopened.

Select the desired candidate rows, then choose **Use selected source profiles in a native study**. This opens the existing Scenario sensitivity form with the same reference-first profile order, original grid, title, purpose and common native-model scope. Choose actual baseline/alternative scenarios and a supported source-catalogued study, then use the existing preview/create/run/export path. This handoff shares the original scientific queue.

## Interpret the comparison

### Coefficients and model parameters

Coefficient changes describe the original biophysical source tables. Native parameter changes are shown separately. A profile pair with identical CSV bytes may still use different routing or retention parameters.

The **Show changes only**, model, candidate, field and original-code filters operate on the complete retained rows. Source descriptions remain visible for both profiles; different descriptions are not silently treated as a new crosswalk.

A numeric change is candidate minus reference. A relative change uses the absolute reference magnitude and is unavailable when the reference is zero. Missing values retain their missing side. Model-inactive fields stay in the original source record and can be displayed by clearing the shared-scope filter.

### Nutrient load definitions

The version-pinned InVEST NDR documentation distinguishes application rates from measured runoff. The comparison shows the corresponding load before runoff adjustment: application rate multiplied by one minus retention efficiency, or the measured-runoff value directly. Raw loads with different definitions retain both values and their definition change; no raw percentage difference is assigned across these bases.

Native execution subsequently applies the runoff index and delivery ratios. Completed native runs and same-support study contrasts supply the routed annual quantities.

Primary method reference: [InVEST 3.20.0 NDR, Data Needs and Nutrient Loads](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html).

### Sediment coefficients

The derived C×P column multiplies the original dimensionless USLE cover and practice factors. The sediment model also uses terrain, rainfall erosivity, soil erodibility and sediment delivery.

Primary method reference: [InVEST 3.20.0 SDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html).

### Prepared input support

Counts come from the original completed grid's inputs.NLCD.class_counts. They include all valid cells in the aligned rectangular preparation grid. The reporting mask has not been applied to these counts. The actual grid CRS, resolution and dimensions remain attached.

These counts explain which original land-cover classes each profile supplies and how many prepared input cells have changed coefficients. Native run coverage remains attached separately to each completed output; no difference between unpaired aggregate totals is inferred here.

Profiles with missing selected-grid codes remain reviewable. Their coverage identifies exactly which codes and cell counts need source entries before the native study can use that profile. The study handoff accepts the common native models supported by every selected profile and the selected grid.

### Saved native-run snapshot

A saved comparison retains the native run records that existed when it was created. Creating the comparison again after additional runs finish retains the updated snapshot under its content-derived identity. The original saved record and reports continue to describe their own retained edition.

## Headless use

Run from the original application root with its existing Python:

    python -B -m model.profile_comparison_cli --workspace ACTUAL_WORKSPACE catalog

Write a selection using IDs returned by that catalogue:

    {
      "title": "Compare the retained regional biophysical sources",
      "reference_profile_id": "ACTUAL_REFERENCE_PROFILE_ID",
      "candidate_profile_ids": ["ACTUAL_CANDIDATE_PROFILE_ID"],
      "grid_id": "ACTUAL_PREPARED_GRID_ID"
    }

Omit grid_id or set it to null for source-table comparison before grid preparation.

    python -B -m model.profile_comparison_cli --workspace ACTUAL_WORKSPACE preview --selection profile-selection.json
    python -B -m model.profile_comparison_cli --workspace ACTUAL_WORKSPACE create --selection profile-selection.json
    python -B -m model.profile_comparison_cli --workspace ACTUAL_WORKSPACE inspect ACTUAL_COMPARISON_ID
    python -B -m model.profile_comparison_cli --workspace ACTUAL_WORKSPACE export ACTUAL_COMPARISON_ID
    python -B -m model.profile_comparison_cli --workspace ACTUAL_WORKSPACE study-selection ACTUAL_COMPARISON_ID

The final command emits original grid/profile IDs and common model scope for the existing ensemble workflow. Native commands remain documented in model/ENSEMBLE_OPERATIONS.md.

## Public Python API

    from model.profile_comparison import ProfileComparisons
    manager = ProfileComparisons(workspace)
    catalogue = manager.catalog()
    preview = manager.preview(selection)
    comparison = manager.create(selection)
    retained = manager.inspect(comparison["id"])
    study = manager.study_selection(comparison["id"], candidate_ids=None)
    release = manager.export(comparison["id"])

The manager reads profiles through Workspace._get and sources through Workspace.source_file; it uses the current original inspect_table validator. It calls no alternative model executor.

The original CSV bytes and each source companion are verified against their retained identities before export. JSON preserves original source values; spreadsheet-facing CSV text is escaped to prevent formula evaluation.

## Installation and shared host

Receive the complete source-bank component over the current cumulative application. Its new owned files are:

- model/profile_comparison.py
- model/profile_comparison_cli.py
- model/PROFILE_COMPARISON.md
- operator/profile_comparison_service.py
- operator/extensions/profile-comparison.json
- operator/web/profile_comparison.mjs
- operator/web/profile_comparison.css

The component also includes the maintained operator/web/ensembles.mjs postimage that exposes prepare(selection) and filters catalogued studies against every selected profile, grid and explicit model scope. Preserve later compatible versions of that shared client.

The existing typed extension host discovers the profile-comparison descriptor. Restart the original operator after receiving. It registers profile_comparison.create and profile_comparison.export on the existing task queue, the profile_comparisons item/state kind, and authenticated comparison/report routes. No server.py or app.mjs replacement is required.

Retained data live in Workspace/profile-comparisons/<id>.json; generated reports live in Workspace/profile-comparison-reports/<id>/. Original Workspace portable inventory retains both directories and the application source. The extension's verify_workspace binding confirms original profile/grid relationships on receiving.

Existing source families—including retained Duke, regional Georgia/Upstate and Upper Flint tables—are selected from actual imported profile IDs. This component adds no coefficient values or invented crosswalk.

## Native receiving continuation

This component joins UPSTATE-SOIL-ENSEMBLES-A74F-20261012 and the existing native study/paired receiving at Sales1791854610.917799 and1791857208.632589.

On that already-equipped application, open the actual catalogue, compare the retained source profiles and grid, save the full report, then pass the selected profiles into the original source-catalogued study. Continue the original model programme and its real run IDs. In the existing browser inspect the longest coefficient/source table, open the retained HTML, download the complete ZIP, and reopen the Workspace through the existing portable flow. Return the first concrete Python, source-binding, browser or report exception to the same operation for repair.

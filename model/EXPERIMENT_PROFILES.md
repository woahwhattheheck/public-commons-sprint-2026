# Source-backed experiment profiles

This component adds biophysical table choices to the existing ES-EXP experiment workflow. It uses the original Workspace source importer, profile validator, and run preparation. The original experiment engine owns native NDR/SDR execution, paired catchment comparisons, progress, and reports.

## Files and integration

- `model/experiment_profiles.py` provides the source catalogue, pure profile preview, materialization, and selection composition.
- `model/experiment_programme_bridge.py` exposes original case definitions and prepares their original native run identities for the compute programme.
- `source/run_profile_source_workflow.py` exercises the retained 15-row regional table through native Workspace import, preview, materialization, repeat use, and reconstruction of a removed derived profile inside the isolated workflow workspace.

The operator supplies a sibling `profile_factors` object to its existing experiment action. It fills the complete profile specification below using the selected baseline run's profile ID and the experiment title/reason. Keep the original experiment selection schema unchanged.

## Profile specification

```json
{
  "title": "Cropland source choices",
  "reason": "Compare explicitly attributed input choices on the same study grid.",
  "baseline_profile_id": "<retained baseline profile ID>",
  "design": "factorial",
  "factors": [
    {
      "name": "Cropland C",
      "target": "table.usle_c",
      "lucodes": [82],
      "levels": [
        {
          "label": "Retained Duke crop C",
          "value": 0.2,
          "references": ["https://dukespace.lib.duke.edu/bitstreams/57c6d8cb-9ce3-4740-b1d5-39c92bda284c/download"],
          "reason": "Retain the agricultural coefficient in the imported Table 4 source."
        },
        {
          "label": "Cape Fear corn C",
          "value": 0.25,
          "references": ["https://repository.library.noaa.gov/view/noaa/57797/noaa_57797_DS1.pdf"],
          "reason": "Compare the separately published Cape Fear corn coefficient as a working source choice."
        }
      ]
    }
  ]
}
```

The two C values come from different source contexts. Their rationale remains attached to the changed cells and profiles. Choosing a level constructs a working profile; its actual native run uses the retained study grid, source objects, and scenario.

Every level supplies its own value, references, and scientific reason. Scalar targets use `ndr.*` or `sdr.*`; table targets use `table.<original-column>` and explicit existing integer lucodes. Disjoint lucode selections may vary the same column independently. Overlapping factor cells are rejected because their order would otherwise determine the result.

Supported table columns are `load_n`, `load_p`, `load_type_n`, `load_type_p`, `eff_n`, `eff_p`, `crit_len_n`, `crit_len_p`, `proportion_subsurface_n`, `usle_c`, and `usle_p`. The catalogue also exposes all twelve native scalar or routing choices. A null `ndr.runoff_proxy_av` removes the explicit normalization override.

## API

```python
from model import experiment_profiles as profiles
from model import experiments
from model.experiment_programme_bridge import expanded_cases, materialize_cases

catalogue = profiles.catalog(workspace, baseline_profile_id)
proposed = profiles.preview(workspace, profile_spec)
prepared_profiles = profiles.materialize(workspace, profile_spec)
composed = profiles.selection_with_profiles(
    workspace, original_experiment_selection, profile_spec)
experiment = experiments.prepare(workspace, composed["selection"])
page = expanded_cases(workspace, experiment["id"], offset=0, limit=100)
prepared_cases = materialize_cases(workspace, experiment["id"])
```

`catalog` returns `parameters`, units, native physical constraints, choices where relevant, and source references. With a baseline profile it also returns original lucodes, table rows, table hash, and native parameters.

`preview` performs reads only. It returns a profile-set ID, configurations, `profile_count`, `derived_profile_count`, and the original source-table identity. It deduplicates scientifically equivalent and unchanged levels. The original profile is always included. Native profile IDs become available after materialization.

`materialize` returns a complete or failed retained state. On completion `profiles` contains every configuration, native profile ID, changed parameters, and table identity; `profile_ids` contains derived IDs, while `all_profile_ids` also includes the original baseline. Repeated calls reuse the retained profile IDs. If a derived profile file is missing, materialization reconstructs it from the immutable selection and checks the same native ID.

`selection_with_profiles` merges those derived IDs into the existing engine's `selection.profile_ids`. Put all combined scalar/table factors in the profile specification and leave `selection.axes` empty, so the requested one-at-a-time or factorial design is expanded coherently. Existing additional profile IDs remain selected.

`expanded_cases` returns original case IDs, ordinals, kind, baseline run IDs, selection, and current materialization/native state. It uses the current engine's indexed design helpers for deep page seeking and remains compatible with the original streaming engine.

`materialize_cases` saves any original engine-derived scalar profiles and calls Workspace.prepare_run for each case. It verifies the original profile ID, run ID, and run selection. Preparation shares the original experiment lock. It retains preparation progress and per-case receipts without altering engine case metrics. The compute programme or existing experiment execution action then owns calculation.

## Retained files and recovery

Each profile set uses `workspace/sourced-profiles/<id>/`:

- `selection.json`: immutable normalized choices and original source identity.
- `state.json`: progress, completed profile IDs, and recovery state.
- `tables/<configuration-id>/biophysical.csv`: selected cells applied to the original column and row ordering.
- `tables/<configuration-id>/lineage.json`: original and selected cell values, units, references, rationale, and parent/source identities.
- `tables/<configuration-id>/source-manifest.json`: native source import manifest including the lineage companion.

Untouched cell text and descriptive label columns are preserved. The original source and baseline profile retain their original IDs. Derived profiles carry their lineage and working scientific status.

Programme preparation retains `experiments/<id>/programme-materialization.json`, immutable `prepared-cases/<case-id>.json`, and failures under `preparation-errors/`. Repeating preparation reuses existing native runs, including completed outputs.

The original portable export captures these workspace and model files recursively.

## Native units and sources

| Setting | Units | Primary definition |
| --- | --- | --- |
| Nitrogen/phosphorus load | kg/ha/year | InVEST 3.20.0 NDR Data Needs |
| Retention efficiencies and subsurface proportion | Ratio from 0 to 1 | InVEST 3.20.0 NDR Data Needs |
| Critical retention lengths | m | InVEST 3.20.0 NDR Data Needs |
| C and P erosion factors | Dimensionless | InVEST 3.20.0 SDR Data Needs |
| `sdr.l_max` | Dimensionless maximum RUSLE L factor | InVEST 3.20.0 SDR Maximum L Value argument |
| Flow accumulation thresholds | Upstream pixels | InVEST 3.20.0 model arguments |

- NDR: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- SDR: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
- Original regional table: `source/biophysical-regional-20261012/regional-biophysical.csv`, with its retained Georgia 2019 and Duke 2022 provenance.
- Cape Fear corn C choice: Hamel et al., “Sediment delivery modeling in practice: Comparing the effects of watershed characteristics and data resolution across hydroclimatic regions,” DOI 10.1016/j.scitotenv.2016.12.103, printed page 14.

## Commands

Run from the assembled application root:

```sh
python -m model.experiment_profiles --workspace /path/to/workspace catalog --baseline-profile PROFILE_ID
python -m model.experiment_profiles --workspace /path/to/workspace preview --spec profile-spec.json
python -m model.experiment_profiles --workspace /path/to/workspace materialize --spec profile-spec.json
python -m model.experiment_profiles --workspace /path/to/workspace compose --selection experiment-selection.json --spec profile-spec.json --output composed-selection.json
python -m model.experiment_programme_bridge --workspace /path/to/workspace --experiment EXPERIMENT_ID expanded --offset 0 --limit 100
python -m model.experiment_programme_bridge --workspace /path/to/workspace --experiment EXPERIMENT_ID materialize
```

The script accepts --application, --component, --workspace, and --source-manifest for an active shared host. The retained source-workflow script uses the actual regional manifest and writes its exact resulting native IDs and verification receipt to `/dev/shm/upstate-85e65/profile-source-workflow/profile-workflow-receipt.json`. Its two-factor design is expected to produce four unique profiles, including the unchanged original, and three derived profiles.

# Biophysical coefficient evidence and selected endpoint profiles

The existing Profile Workbench can retain the original basis for each coefficient and prepare explicit endpoint choices through the maintained sourced-profile engine. The evidence record is bound to an exact saved profile ID, its complete biophysical table body, and an imported evidence CSV. Original profiles, scientific reviews and customer review captures retain their existing identities.

## Scientific meaning

Nutrient loads in the source table are in kg/ha/year. Their load_type_n or load_type_p field must distinguish application-rate from measured-runoff. InVEST 3.20.0 applies load × (1 − efficiency) to application-rate inputs inside the native model; measured-runoff inputs enter directly. This workflow never pre-reduces a load or changes its type. A documented evidence row must retain the same original numeric value and load type.

Efficiencies and the subsurface nitrogen proportion use the existing native parameter catalogue's unit token ratio. Critical lengths use m. USLE C and P use dimensionless. The original model constraints apply to all values and endpoints.

Lower and upper identify the endpoints of sourced coefficient ranges. They do not imply confidence intervals, an uncertainty distribution, or best/worst pollution outcomes. For example, moving a load and moving an efficiency in the same numeric direction need not move modeled export in the same direction. Select the actual scientific question and coefficient cells deliberately.

The method references are the pinned [InVEST 3.20.0 NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html), particularly Data Needs / Biophysical Table, and the [InVEST 3.20.0 SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html). The general model guides establish units and computation. Local coefficient values and their ranges need their own original sources.

## Evidence CSV

Generate the template from an existing saved profile. It contains every numeric coefficient in that profile's selected native model scope, the original value text, units and load type. General profile references stay visible separately. They do not automatically become per-cell attribution.

The columns are:

| Column | Meaning |
| --- | --- |
| lucode | Original integer land-cover code |
| parameter | Existing coefficient column: load_n, load_p, eff_n, eff_p, crit_len_n, crit_len_p, proportion_subsurface_n, usle_c or usle_p |
| value | Original central numeric value; must equal the saved table |
| units | Exact native catalogue token: kg/ha/year, ratio, m or dimensionless |
| load_type | Original application-rate or measured-runoff for load_n/load_p; blank for other coefficients |
| source_title | Title of the actual parameter source |
| source_uri | Original URL, citation or stable source identifier |
| source_locator | Optional page, table, row, section or other precise locator |
| source_period | Optional original represented period or edition |
| lower | Optional sourced lower endpoint |
| upper | Optional sourced upper endpoint |
| range_basis | Meaning and source basis of the supplied interval |
| notes | Optional source interpretation |

The seven columns lucode, parameter, value, units, load_type, source_title and source_uri are required headers. Other headers may be omitted. Header names and lucode/parameter pairs must be unique.

A source title and citation are both required for a documented cell. Unattributed cells may remain in the template with all citation/detail/range columns blank, or may be omitted. They remain unknown in the coverage summary. Source locator, period, notes and ranges require the actual source title and citation.

A range needs both endpoints and range_basis. Each endpoint must satisfy the same native coefficient constraints as the original table, and lower ≤ central ≤ upper. A single-point interval is retained as a documented range but is not offered as a varying coefficient. No range is manufactured for a missing cell.

Import this CSV through the existing Original sources workflow as a table with its actual title, URI and vintage. The evidence record retains that source edition ID and body hash as well as the original coefficient table hash.

## Existing Profile Workbench flow

1. Open the exact saved profile.
2. Download its evidence template. Supply only available original parameter references and ranges.
3. Import the completed evidence CSV as an ordinary source table.
4. Preview the source binding and inspect documented/unknown coverage, load types and ranges.
5. Save the immutable evidence record.
6. Select the exact lucode/parameter cells to move and state the scientific purpose.
7. Preview the lower and upper endpoint configurations, then prepare the ordinary native-compatible profiles.
8. Select an actual original baseline run using the central profile and prepare the existing Scenario Experiment. Choose any actual land-cover alternatives there and execute through its normal queue and run controls.

Manual profile revisions and customer scientific reviews keep their established behavior. Evidence records attach to one exact profile edition; a later profile revision can receive its own independently validated evidence record.

## Materialization and reuse

The adapter delegates each endpoint to model.experiment_profiles.preview/materialize using a factorial design with exactly one explicit level for each chosen cell. That produces at most one changed profile per endpoint and preserves the engine's original source lineage, validation, native parameters and resumable materialization.

The central profile is reused directly. Its profile ID and original biophysical CSV bytes are never rewritten or cloned by this operation. Unselected coefficient values, load types and untouched cell text stay unchanged. The existing materializer normalizes the text of changed numeric cells through its normal numeric serialization; the original evidence CSV retains the source's endpoint text.

If an endpoint equals the original central values for every selected cell, the original profile is reused for that endpoint. The native experiment receives distinct endpoint profile IDs only. Native model execution, stage reuse, paired scenario baselines and quantitative reports stay with the existing experiment engine.

Saved endpoint records include the source evidence ID, selected cells, original table hash, existing source-profile-set IDs, and central/lower/upper profile IDs and table hashes. Inspection rereads the original sources and validates every selected and unchanged numeric coefficient.

## Backend interface

All functions are in model.biophysical_evidence.

| Function | Input | Result |
| --- | --- | --- |
| catalog(workspace, profile_id) | Exact saved profile | Original profile/table, coefficient cells, evidence/range catalogue, methods and CSV fields |
| template(workspace, profile_id) | Exact saved profile | filename, csv_text, columns, rows, original table hash and instructions |
| preview_evidence(workspace, selection) | profile_id, source_collection_id, source_id | Proposed immutable evidence record |
| save_evidence(workspace, selection) | Same evidence selection | Saved evidence record |
| inspect_evidence(workspace, evidence_id) | Saved evidence ID | Record after validating original profile/table/evidence sources |
| preview_ranges(workspace, selection) | evidence_id, title, reason, parameters | Central binding, selected cells, actual existing-engine endpoint previews |
| prepare_ranges(workspace, selection) | Same range selection | Saved original/endpoint profile bindings |
| inspect_ranges(workspace, range_id) | Saved range ID | Validated endpoint set and original central profile |
| prepare_experiment(workspace, selection) | range_id, baseline_run_id, optional scenario_ids/source_run_ids | Ordinary model.experiments.prepare result |
| verify_all(workspace) | Original Workspace | Validates both immutable record families and returns their counts |

Each item in parameters is an object containing lucode (integer) and parameter (original column name). Selection never implicitly expands to other codes or coefficients.

Evidence records expose cells and coverage. Each cell contains lucode, parameter, units, value, table_value_text, load_type, source_status, source, range and range_eligible. A source object contains title, uri, locator, period and notes. A range contains lower, upper, their original text and basis. Coverage counts total, documented, unknown, ranged, range_eligible and load-specific cells; these are coefficient counts, not geographic coverage percentages.

Range previews expose central, selected_cells and endpoints. Each endpoint contains position, source_profile_spec and the complete existing sourced-profile preview under proposed. Saved range records contain profiles.central, profiles.lower and profiles.upper, each with profile_id, title, table_sha256 and table_bytes; profile_ids is the deduplicated noncentral list for native experiments.

Records use existing Workspace immutable storage:
- biophysical-evidence/<id>.json
- biophysical-ranges/<id>.json

These directories and the existing sourced-profiles/source collections travel through the normal recursive portable workspace capture. Receiving semantically validates both record families before promoting the restored directory. No separate application, native runner or model version is introduced.

## Direct receiving commands

From the existing application directory, replace paths and IDs with the receiver's actual retained selections.

    python -B -m model.biophysical_evidence --workspace /actual/workspace catalog --profile ORIGINAL_PROFILE_ID
    python -B -m model.biophysical_evidence --workspace /actual/workspace template --profile ORIGINAL_PROFILE_ID
    python -B -m model.biophysical_evidence --workspace /actual/workspace preview-evidence --selection evidence-selection.json
    python -B -m model.biophysical_evidence --workspace /actual/workspace save-evidence --selection evidence-selection.json
    python -B -m model.biophysical_evidence --workspace /actual/workspace preview-ranges --selection range-selection.json
    python -B -m model.biophysical_evidence --workspace /actual/workspace prepare-ranges --selection range-selection.json
    python -B -m model.biophysical_evidence --workspace /actual/workspace prepare-experiment --selection experiment-selection.json

The template command returns JSON with csv_text; write that exact string to the CSV, fill original source facts, then use the normal source import. Source validation and endpoint preparation need the retained Workspace and CSVs. They do not need to launch InVEST.

The first useful receiving check is an actual existing profile: template values and types must match its source rows, unattributed cells remain unknown, and an already supplied sourced range changes only its explicitly selected original cells. Actual endpoint native results are produced by the normal saved experiment.

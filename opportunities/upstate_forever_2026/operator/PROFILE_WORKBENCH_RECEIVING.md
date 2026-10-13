# Profile workbench: native receiving and operated opening

Operation ECO-PROFILES-DD6B · Upper Savannah application

## Application contribution

The desk opens a saved scientific profile before its first native run. An operator can revise native NDR/SDR parameters and coefficient cells, retain source references and the reason for a change, inspect exact differences, save a named working profile, compare saved revisions and attach an actual review record. Original row identities, order and descriptive source columns remain attached to the coefficient table.

The desk delegates scientific profile materialization to the existing 85E65 model.experiment_profiles module. It uses the original operator queue, authenticated transport, file tickets and Workspace. The included installer composes current source, retains the existing guided journey and other desks, and includes both opening scripts in ordinary application backup.

## Receive the complete component

On current public application source, the complete component is already present.
Run python -B install_profile_workbench.py --application . to compose it into a
retained receiving application. The installer recognizes the maintained native
selected-model catalogue and preserves its filtering. It takes the shared
extension-install lock before reading, preparing or replacing source, including
the original launcher list used by complete project archives.


Retain the four Canvas documents as local Markdown files. Stage them in this order: UI base F0C8K3ZCYFP, UI R2 F0C9JT49N8G, backend R2 F0C8NF1E4H4, and final receiving source F0C8NMAGZ6J. Later files replace earlier versions only inside the fresh staging directory. The installer composes the existing application afterward.

Run the following with the current application on PYTHONPATH, substituting the actual local carrier paths and a fresh staging directory:

```sh
cd /actual/current/Upper-Savannah-application
python - /actual/profile-workbench-staging /actual/ui-base.md /actual/ui-r2.md /actual/backend-r2.md /actual/final-receiving.md <<'PY'
from pathlib import Path
import sys
from source_tools.application_assembly import read_layer
target = Path(sys.argv[1]).resolve()
if target.exists() and any(target.iterdir()):
    raise ValueError('Use a fresh empty profile staging directory')
files = {}
for source_path in sys.argv[2:]:
    layer = read_layer(Path(source_path))
    files.update(layer.files)
target.mkdir(parents=True, exist_ok=True)
for name, content in files.items():
    path = target / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content.encode('utf-8'))
print({'files': len(files), 'source_bytes': sum(len(s.encode('utf-8')) for s in files.values())})
PY
```

The original receiver checks every member's declared byte count and SHA-256 before staging. The four carriers provide all ten component-owned files. The backend carrier also retains a full original source-engine postimage for reference; the installer composes the current model/experiment_profiles.py narrowly instead of copying that older full module.

The current operator must have the maintained extension registry and the sourced profile component installed. On a source tree where they are absent, use the original install_extensions.py from the cumulative application and install_experiment_workbench.py from original 85E65 source F0C8HR43RS7, each with --application CURRENT_APP and --source-root ITS_SOURCE_DIRECTORY. Current integrated operator F0C9JNCF2JC already includes the registry. Its native-model iterators and maximum RUSLE L-factor caption are retained by this installer.

```sh
python -B /actual/profile-workbench-staging/install_profile_workbench.py --application /actual/current/Upper-Savannah-application --source-root /actual/profile-workbench-staging
```

The installer retains prior changed files beside the application and composes the current portable application's root-file list. Its selected-model fixes apply to the existing source-profile catalogue and table-inspection sites. The source module remains the producer of coefficient lineage and native profile identities.

## Open with retained regional coefficients

```sh
python -B /actual/current/Upper-Savannah-application/open_profile_desk.py --workspace /actual/profile-study
```

The launcher imports the retained fifteen-class regional coefficient table from source/biophysical-regional-20261012/source-manifest.json, saves its explicit working parameter choices using the original Workspace, writes profile-desk-opening.json, and launches the original operator. Its first receipt contains the scientific workspace ID, the original operator's directory-bound operator_workspace_key, and the baseline profile ID. The server then prints its actual operator_url. Open that local URL and choose Profile workbench.

Use --profile-id EXISTING_PROFILE_ID to reopen an existing saved profile. Use --prepare-only to retain the opening selection without starting the server. An explicit --parameters JSON file can supply the original native ndr/sdr parameter dictionaries and optional model selection before the initial profile is saved.

## Operate and record the browser journey

Write only the server receipt's operator_url value into a private local text file. Run the supplied driver with the installed Node Playwright runtime:

```sh
node source/run_profile_workbench_browser.mjs --url-file /actual/private-operator-url.txt --profile BASELINE_PROFILE_ID --workspace OPERATOR_WORKSPACE_KEY --output /actual/profile-workbench-journey --video
```

The optional workspace argument uses operator_workspace_key from the opening receipt; when it is omitted, the driver uses the actual operator workspace choices to find the supplied baseline. The driver exercises actual page controls and observes the original API responses. It captures five screens, optional video and journey.json with the saved profile, source and task identities. The operator capability URL stays out of those artifacts.

The operated scientific choice is explicit: retain the original fifteen land-cover rows, locate code 82, correct one invalid coefficient, then change its usle_c from 0.20 to 0.25 as a working Cape Fear corn alternative. Keep the regional nutrient and remaining sediment values. The driver records the actual published reference and rationale, previews, saves, reloads and compares against the retained baseline. The comparison checks that exactly this one coefficient changed and that the saved edition is working.

Original alternative reference: Hamel et al. (2017), DOI 10.1016/j.scitotenv.2016.12.103, https://repository.library.noaa.gov/view/noaa/57797/noaa_57797_DS1.pdf (the Cape Fear agricultural corn C value appears on PDF page 13, printed page 14). The original regional table uses the separately retained Duke Forest 2022 Table 4 crop value 0.20. Native NDR and SDR field meanings are defined by the pinned InVEST 3.20 user guides retained in the profile.

## Save, transfer and reopen the actual workspace

Use the original operator's workspace backup and restore flow after saving the new profile. The original archive carries profiles, original and derived coefficient bytes, profile editions, operation recovery records, review events and heads, sourced-profile selection/cell lineage and the application. Reopen the restored workspace in the original operator and select the saved profile ID. Inspect the same comparison and original file tickets. The installer includes open_profile_desk.py and install_profile_workbench.py in the application archive; source/ and operator/ already carry the browser driver and guides.

Record a review through Record review when its actual reviewer and reference are available. Working and changes-requested records retain their own supplied context; a reviewed record requires its review reference. Review records remain attached to their exact saved profile/table, and a later scientific edit becomes a separate working edition.

## Current source composition

Maintained cumulative source: ECD1 F0C8JNZTURK; current cumulative successor F0C8J16HPGT; current operator F0C9JNCF2JC. Original sourced profile engine: F0C8HR43RS7. Profile backend R2: F0C8NF1E4H4. Interface base: F0C8K3ZCYFP with R2 F0C9JT49N8G. Browser journey: F0C895G8PQF. The four ordered carriers above provide all profile-owned postimages and the opening/installation route. Final receiving source F0C8NMAGZ6J supersedes the earlier individual launcher, installer and browser journey carriers.

## Coefficient evidence in the actual populated product

This is the maintained receiving course for the coefficient evidence, original-table population and delivery-report controls. Use the complete current application containing PR3703 (evidence and selected ranges), PR3760 (original-source population) and the current coefficient-report continuation. The older four-carrier staging route above describes the original desk; it does not supply these later components. The current `install_profile_workbench.py` includes the evidence backend, browser controller, source population receiver and all four matching citation CSVs. Keep the receiving worker on its already accepted project and operation.

### Producing worker: operate and inspect the outgoing version

Owner instruction of October 13, 2026, repository version `2026-10-13.1`, applies to this course. Before calling the application, report or export ready, the producing worker must open/run/render the exact outgoing populated version, LOOK at its actual screen or real screenshots, and operate its important controls. Check the actual screenshare width and a narrow/mobile width where relevant; populated, empty, loading and error states; downloads, exports and reopening. Capturing screenshots without viewing them does not complete this work. Fix unstyled, cramped, clipped, overflowing, unreadable or otherwise broken output in the authorized source and reopen the corrected output. Code review, source parsing, HTTP success, DOM counts or another worker's approval do not replace seeing the product.

Use the existing industrial presentation: readable tables, plain controls, clear hierarchy, consistent typography and spacing. Review the actual saved scientific workspace and completed reports. Preserve current engineering ownership and the original operation rather than launching a second native study. Include this instruction in every delegated receiving assignment. It does not extend the Ecosystem sprint beyond October 13, 2026, 10:00 America/Kentucky/Louisville (14:00 UTC).

### Bind to the actual saved profile

Open the existing operator and choose the exact project and Profile workbench profile already used by the native run. Retain the actual project ID, operator workspace key, profile ID and original coefficient-table SHA-256 from its saved records. Compare the displayed model selection and coefficient values with that table before attaching evidence. A different profile or table requires its own evidence record.

For the simulated headwaters operation, use `profile_id` and `source_collection_id` from its actual `demo-receiving.json`. The original `--prepare-only` command already creates that saved profile. The same accepted native worker proceeds through `--field-only` and then the original full command; evidence population does not require an additional native run.

The retained `source_tools/simulated_headwaters.py` defines these explicit demonstration assumptions:

| Original code | load_n (kg/ha/year) | load_p (kg/ha/year) | eff_n (ratio) | eff_p (ratio) | usle_c (dimensionless) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 21 | 8 | 0.9 | 0.05 | 0.05 | 0.05 |
| 41 | 2 | 0.12 | 0.8 | 0.8 | 0.003 |
| 81 | 10 | 0.7 | 0.35 | 0.35 | 0.025 |
| 82 | 22 | 1.8 | 0.15 | 0.15 | 0.18 |

For every row, `crit_len_n` and `crit_len_p` are 100 m, `proportion_subsurface_n` is 0 (ratio), and `usle_p` is 1 (dimensionless). Both load types are `measured-runoff`. Its four rows and nine numeric coefficient columns produce **36 cells** in the both-model evidence template. The native input grid is 120 by 120 cells at 30 m in EPSG:26917. These values remain labeled **SIMULATED DEMONSTRATION INPUTS** in the original source and reports. Cite that supplied assumption table; the regional Albright and Upper Flint CSVs below belong to their own matching original profiles.

Use the current saved table and selected model scope for any other project. For example, a single-model profile has fewer eligible cells than its both-model counterpart. Never replace actual record counts with a fixed expected total from another study.

### Populate the original table and inspect its provenance

1. In the saved profile's coefficient evidence pane, choose **Cite original table**. Keep the same queued operation if the transport response is delayed. Open the saved evidence returned by the completed task.
2. Read the populated coefficient table. Check the original code, parameter, numeric value, exact unit and load type, along with the supplied table's title, URI, row/column locator and date or source period where available. Confirm that the original profile ID and table SHA-256 are unchanged.
3. Download the evidence CSV through the original file ticket and open the downloaded file. Compare its rows with the displayed saved evidence and the exact original table. Unsupported lower/upper/range-basis cells stay blank. A supplied table documents where the number came from; it does not make a local measurement, a calibrated parameter or an uncertainty interval.
4. Leave and reopen the profile and saved evidence. Confirm that the same record and source are shown, including after a page reload. The saved evidence is an immutable sidecar; an ordinary later profile revision remains a separate profile.

The maintained command is useful to the same receiving worker when operating a saved profile before opening the browser:

```sh
cd /actual/current/Upper-Savannah-application
/actual/equipped/python -B source_tools/receive_biophysical_evidence.py \
  --workspace /actual/retained-workspace \
  --profile ACTUAL_SAVED_PROFILE_ID \
  --output /actual/receiving/original-profile-evidence
```

The output contains `biophysical-evidence.csv`, `source-manifest.json`, `evidence-selection.json` and `operation-result.json`. Read the actual saved evidence ID and attribution counts from the result. Resume that same selection and output with `--resume`; the receiver validates its retained selection before continuing. The equivalent operator action is `profile.biophysical.evidence.populate`, using the selected profile and an optional retained citation-source collection/source pair.

### Add published citations only to matching original profiles

Use the original source-profile materialization and its actual saved profile ID. The matching CSV overlays the supplied-table provenance without changing central coefficient bytes. The receiver validates every original value, unit and load type; it also rejects duplicate cell identities. Fully unattributed rows may use original-table provenance, while partial citation or range details require a complete actual citation.

| Retained original profile/source | Matching CSV under the application | Published-source cells | Remaining original-table cells for a fifteen-row both-model profile |
| --- | --- | ---: | ---: |
| Albright et al. (2023), Appendix 1 | `source/regional-studies-20261013/albright-2023-biophysical-evidence.csv` | 120 | 15 |
| Upper Flint 2024 combined source profile | `source/upper-flint-2024/biophysical-evidence-combined.csv` | 81 | 54 |
| Upper Flint NDR source profile | `source/upper-flint-2024/biophysical-evidence-ndr.csv` | 63 in the NDR coefficient scope | Read the actual saved scope |
| Upper Flint SDR source profile | `source/upper-flint-2024/biophysical-evidence-sdr.csv` | 18 in the SDR coefficient scope | Read the actual saved scope |

Albright's original paper is [Patterns of land use change, land governance, and the supply of ecosystem services in a multifunctional landscape: A case study from Upstate SC, USA](https://doi.org/10.1080/1747423X.2023.2234903). Appendix 1 supplies eight columns for fifteen land-cover codes. Its original study used InVEST 3.9; preserving those supplied loads under the 3.20 `measured-runoff` entry convention does not assert that the two complete model versions have identical outputs. The remaining subsurface fractions retain their supplied-table source. Native 3.20 handles the distinct `application-rate` transformation internally; this workflow never pre-reduces a load or changes its load type.

The [Upper Flint 2024 source](https://doi.org/10.3390/land13060893) uses the retained original supplement transcription, Tables S2 and S3, plus the explicit nine-code NLCD mapping in `source/upper-flint-2024/nlcd-mapping.json`. Its unmatched water/developed rows remain from the original baseline table. Source title and notes preserve that transcription and mapping context. Neither published CSV supplies uncertainty ranges.

Import the matching CSV through the existing source flow and preview it in the selected profile's evidence pane. Inspect the supplied citations and any still-unattributed cells. Choose **Fill remaining table provenance** to save complete source coverage using the original table for those remaining cells. Open the actual returned saved record and inspect its two attribution counts; “documented” is source coverage, not confidence in the modeled result.

The equivalent continuation adds the original matching CSV to the receiver:

```sh
/actual/equipped/python -B source_tools/receive_biophysical_evidence.py \
  --workspace /actual/retained-workspace \
  --profile ACTUAL_MATCHING_SOURCE_PROFILE_ID \
  --evidence-csv source/regional-studies-20261013/albright-2023-biophysical-evidence.csv \
  --output /actual/receiving/albright-profile-evidence
```

For genuine sourced ranges, choose only the intended code/parameter cells and inspect the existing native materializer's lower and upper endpoint previews. Unselected cells stay central. Endpoint profiles are parameter choices; they are not confidence limits or automatically the best/worst pollutant outcomes. The existing experiment uses every selected profile with every selected scenario and compares each alternative with its matching-profile baseline.

### Carry the saved sources into the real delivery

In **Map atlas and delivery**, keep the actual native baseline and ordered alternatives. Use their existing delivery mode, geography, source selections and maps. Proceed to **Review and build**, then **Coefficient sources and selected ranges**.

1. Choose **Refresh coefficient choices**. Confirm the displayed native profile is the baseline run's saved profile.
2. Select the intended **Saved coefficient citations** and any actual **Selected coefficient ranges**. Read their cell coverage, source title and saved ID. A selected range carries its original central-profile citations. Retained selections remain visible when a source is unavailable; restore the original matching record or explicitly remove the selection.
3. Use **Download selection**, open the JSON, and confirm `selection.coefficient_evidence.evidence_ids` and `range_ids` contain those exact saved IDs alongside the original baseline and scenario IDs.
4. Choose **Build atlas and complete GIS delivery**. Continue its original `delivery.build` task. Open the completed delivery's scientific report (`report.html` / `report.pdf`), customer report (`client-report.html` / `client-report.pdf`) and coefficient-source downloads. Inspect the actual original coefficients, source references, coverage and any explicitly selected endpoint interpretation. The retained `coefficient-evidence/` directory carries `coefficient-evidence.json`, `selected-coefficient-evidence.csv`, original `sources/<sha>.csv` bodies and exact profile/evidence/range record JSON files. The ordinary delivery file registry carries these assets into the working archive.
5. Open the exported HTML locally and the actual PDF pages. Inspect their tables, citations, links and source labels. In the restored project, reopen the same delivery and confirm its saved evidence/range selection and original profile/table binding.

Selection and citation controls use the existing authenticated operator and queue. If the workspace or baseline changes while choices are loading, reopen that original selection and refresh its matching catalog. Do not attach another profile's citations to make an empty catalog appear populated.

### Inspect the complete outgoing journey

Operate the populated desk and release at the intended screenshare width and a narrow viewport. View the real screenshots yourself. Check that long profile names, source URLs, IDs, all coefficient rows, coverage text and unit/load-type labels remain readable; horizontal table scrolling must remain usable without clipping the surrounding controls. Exercise the refresh/loading state, a genuinely unavailable saved choice or transport error when encountered, selected checkboxes, back/forward steps, download/import selection, queued build and reopening. Preserve the actual saved scientific choices while doing this.

Inspect the complete scientific and customer HTML/PDF outputs, coefficient CSVs and restored workspace, not only the original five-screen edition driver. Retain the actual workspace/profile/evidence/range/delivery IDs, outgoing artifact paths, rendered screenshots and any repaired source edition with the existing receiving operation. Keep capability URLs and credentials out of screenshots and shareable notes. If a worker discovers a visible defect, patch the responsible current source and inspect the corrected outgoing product before declaring that product ready.

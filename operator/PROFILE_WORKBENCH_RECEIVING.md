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

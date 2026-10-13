# First original Gura case — complete receiving command

Operation: **GURA-NATIVE-01**. This is the existing original InVEST example operation, separate from the Upper Savannah regional GIS project.

The receiver uses the maintained application to create the first source collection, grid, coefficient profile, baseline and scientific programme from the original Gura inputs. It then captures the setup, runs the baseline and two explicitly authored alternatives, produces the original comparison and economic reports, and returns the complete Workspace archive.

## Execute on the actual accepting host

Install the cumulative Upper Savannah application and its current scientific setup family first. The application root contains `model/`, `operator/`, `source_tools/`, and `source/`. Use the existing compatible GIS/InVEST interpreter.

```sh
/actual/gis/python -B /actual/upper-savannah-application/source_tools/receive_first_gura_case.py \
  --application /actual/upper-savannah-application \
  --operation-root /actual/original-gura-operation \
  --python /actual/gis/python
```

For a new case, the operation root retains `workspace/`, `source/`, `original-archives/`, `scientific-setup/` and `first-receiving/`. To continue an existing case with different directory names, explicitly add `--workspace /actual/retained-workspace --source-directory /actual/retained-gura-source`. Those resolved paths are bound in the first receiving record and must match on continuation. Keep the application separate from both data directories, and keep the operation reports/archive outside the Workspace. If the original two release archives are already retained elsewhere, add `--archives /actual/retained-original-archives`.

A new intake needs only the two release ZIPs, totaling 1,428,322 bytes. The receiver downloads them directly from the publisher's immutable Google Cloud Storage generations. It validates every byte against the retained sizes and SHA256 values before publishing a new local archive. An existing source manifest or receiving record remains with its original source edition.

The installed original CSVs are validated before any command begins. They are already part of the maintained application under `source/gura-original-tables-3.20/`.

## Exact original inputs

| Original input | Bytes | SHA256 |
| --- | ---: | --- |
| NDR.zip, generation1781204725169434 | 701,988 | df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d |
| SDR.zip, generation1781204725769073 | 726,334 | 34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779 |
| NDR/biophysical_table_gura.csv | 848 | e3f503cb1c82fb1035225eb68eb84303de8de7842b1bda6e94f4754fe538c42c |
| SDR/biophysical_table_Gura.csv | 535 | b27b1549a41c4929f161e3b18962d6bc8627c10ed7ed27e504203c175a0f5f69 |

The two archive URLs are the existing `SOURCES` definitions in `source_tools/gura_workflow.py`:
- https://storage.googleapis.com/download/storage/v1/b/releases.naturalcapitalproject.org/o/invest%2F3.20.0%2Fdata%2FNDR.zip?generation=1781204725169434&alt=media
- https://storage.googleapis.com/download/storage/v1/b/releases.naturalcapitalproject.org/o/invest%2F3.20.0%2Fdata%2FSDR.zip?generation=1781204725769073&alt=media

The separate table source revision is `098183806c0c715e6422d4d0570db91321c0f4e8`. Nutrient coefficients come from the original NDR table; sediment factors come from the SDR table, joined by original integer `lucode`.

The original release source is a 15m projected grid. The maintained receiver reads and retains its actual affine transform, CRS, cell area, raster masks and watershed sidecars. New workflow intake reads the original source cell size and uses zero added context buffer. A pre-existing prepared source edition retains its own grid and independently selected buffer.

## Actual application phases

1. **Prepare.** Existing `source_tools.gura_workflow prepare` imports the original inputs, creates the aligned grid and original profile, counts the source classes inside the reporting watershed, and writes the actual `source/receiving.json`. The explicit alternatives are `5:8` and `5:19`.
2. **Scientific setup.** Existing `source_tools.gura_setup_review` consumes that exact receiving record and retained plan, selecting `class-5-to-8` and `class-5-to-19`. It saves the ordinary native scenarios, captures the complete setup and original source companions, creates the existing customer review, exports it, and backs up/restores/reopens its saved selections.
3. **Native calculation.** Existing `source_tools.gura_workflow run` executes the original baseline plus the two selected alternatives with InVEST3.20.0. It produces the native watershed comparison, economic editing records where common support permits them, and `gura-complete.zip`.
4. **Completed catalog.** Existing `source_tools.receive_scientific_setup --catalog` returns the actual prepared project inventory from the now completed Workspace.

The proposed analytical alternatives replace original class5/general agriculture with class8/forest and class19/agroforestry, separately, inside the original reporting watershed. Original coefficient rows and the baseline remain shared. These choices are retained in the authored `source/gura-scientific-setup-request.json`; scientific reviewer identity remains unassigned until an actual reviewer is selected.

## Runtime and current sources

The maintained `environment.yml` specifies Python3.12, InVEST3.20.0, GDAL, rasterio, Fiona, pyproj, shapely, NumPy, matplotlib, reportlab and Pillow. Prefer the actual already installed compatible interpreter. Any environment preparation belongs to this same receiving operation and uses an owned prefix.

Current receiver contract inspected for this handoff:
- `source_tools/gura_workflow.py`: Git blob9bef7d4867f054b1dfd1f7c2e470855f4ae59214.
- `source_tools/receive_gura.py`: Git blob6ea76f17e47d2cdd378033d684a15ac43430fe69.
- Scientific setup and Gura setup are merged in PR2996/334c35b62d2555cc61a90863a0cf238b800f22a9 and PR3082/f71d21b0eb204e5ef5306d069418ec0277eca670.
- The maintained family source index is https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9KMLM34G . The current index supplies the complete family source identity and receiving instructions; install this family into the cumulative whole application.

Native work uses the existing programme/run coordinator and its retained child-process locks. This helper adds no model engine. Each issued command writes directly to its own retained log, so loss of the orchestration caller does not close the native child's stdout. The same operation-lock file descriptor is inherited by every issued child, preserving admission while that child remains alive after caller loss. The original workflow also owns any already running native child and its resume semantics. Start a continuation against the same operation root after reconciling the retained phase/PID.

If an existing source plan selects a different cohort, the maintained workflow reports that exact mismatch. Preserve that plan and original Workspace; the source owner can return the compatible continuation for the selected existing programme.

## Return from the accepting host

Return the actual hostname, Python path, application root and operation root plus:

- `first-receiving/first-receiving.json`, with each original command, actual child PID, log path, exit code and final saved records.
- Every issued `first-receiving/*.log`.
- `source/receiving.json`, `source/gura-source-catalog.json`, `source/gura-comparison-plan.json`, `source/gura-workflow.json`, and `source/gura-comparison-result.json`.
- `scientific-setup/gura-setup-result.json` and its existing `review-receiving/receiving-result.json`, review packet and reopened Workspace.
- `gura-complete.zip` and its actual bytes/SHA256.

The first prepared receipt immediately supplies the source collection, grid, profile, baseline scenario and programme IDs. The native completion supplies actual baseline/alternative run IDs, report directories and the complete archive. Any first exception remains with the same command and its retained log for source repair.

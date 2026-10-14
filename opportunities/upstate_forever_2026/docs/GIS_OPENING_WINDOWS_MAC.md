# Open and continue an editable GIS project

## Open the delivered project

Extract the entire GIS ZIP into a writable folder. Keep `project.qgz`, `project.qgs`, `project.json`, `inventory.json`, and the accompanying folders together. Open `project.qgz` with QGIS Desktop. On Windows or macOS, double-click it when QGIS is the associated application; otherwise choose **Open Project** in QGIS and select that file.

The working layers, retained originals, source documents, legends and provenance travel with this folder. Do not move just the QGZ file, open it directly inside a ZIP, or replace the retained originals while editing. After saving and closing QGIS, the entire extracted folder can be moved to a different writable location and opened again. Project data-source references remain relative to that folder.

The workbench's scientific Python and QGIS Desktop's Python have different jobs. Ordinary project opening needs QGIS Desktop, not an interpreter command. The workbench does not assume that its own scientific Python can import PyQGIS.

## Continue a working edition

Open the project, make the intended changes, and save `project.qgz` in the same folder. Reopening an ordinary edited working copy is supported before creating a new handoff edition. The retained inventory deliberately continues to describe the last sealed edition until the edits are sealed.

Close QGIS before sealing, moving or packing the working folder. Sealing records the intentional changes as a new edition and synchronizes the editable QGS and compressed QGZ. It does not authorize silent changes to the retained originals or change the scientific meaning of the selected layers.

Use the existing workbench GIS workflow to prepare or receive an edition. The equivalent application commands below are provided for operators. Run them from the application directory with its prepared scientific Python. In these examples, `python` denotes that interpreter; on an installation that names it `python3`, use `python3` instead. Paths such as `../GIS working` are example working locations, not installed defaults.

```text
python -B -m model.gis_project_cli open "../GIS working"
python -B -m model.gis_project_cli seal "../GIS working" --reason "Updated the working layer presentation" --project-file project.qgz
python -B -m model.gis_project_cli pack "../GIS working" "../GIS returned.zip"
python -B -m model.gis_project_cli receive "../GIS returned.zip" "../GIS received"
python -B -m model.gis_project_cli open "../GIS received"
```

Choose a new receiving directory. Write the ZIP outside the inventoried working folder. A different existing ZIP or receiving directory is preserved rather than replaced. Packing returns the original verification fields, including the uncompressed inventory byte count, plus `archive_bytes` and `archive_sha256` for the ZIP itself.

Newly built GIS exports include the complete helper source under `tools/model/`. Their equivalent standalone entrypoint is `python -B tools/model/gis_project_cli.py`, followed by the same command and explicit folder arguments. Full verification, sealing and packing use the prepared scientific dependencies, including Fiona and Rasterio. Do not assume an unrelated system Python provides them. The included tools suppress bytecode creation so invoking them does not add untracked cache files to the inventoried package.

For an older retained GIS package, use the updated application's commands against that original package. Do not replace its inventoried helper files merely to obtain the current receiver; that would alter the original edition.

## Native QGIS receiving

The native receiver creates an independent copy, opens the original selected layers in QGIS, renders the map, saves a relative-path QGZ, releases the original providers, and reopens the saved project with fresh providers. The original sender stays unchanged. The final destination appears only after the receiving operation completes.

```text
python -B -m model.gis_project_cli qgis-runtime
python -B -m model.gis_project_cli native-receive "../GIS original" "../GIS native received"
```

`qgis-runtime` reports the actual executable and QGIS version selected by a successful PyQGIS import. Windows installer wrappers such as `python-qgis.bat` or `python-qgis-ltr.bat` are supported. macOS QGIS application bundles and Linux system QGIS Python are searched by the same helper. An explicit override is one executable or installer-wrapper path, not a shell command. For example, from PowerShell:

```text
python -B -m model.gis_project_cli qgis-runtime --qgis-python "C:\Program Files\QGIS\bin\python-qgis.bat"
python -B -m model.gis_project_cli native-receive "..\GIS original" "..\GIS native received" --qgis-python "C:\Program Files\QGIS\bin\python-qgis.bat"
```

Substitute the actual QGIS installation directory. `--qgis-prefix` is available for a nonstandard QGIS resource prefix. The helper applies that configuration only to the compatible receiving child. `ECO_QGIS_PYTHON` is an optional equivalent executable override.

A native receiving copy includes `qgis-native.png` and `native-receiving.json` alongside its normal editable project and inventory. These describe that actual receiving operation. Opening the project through the desktop association alone returns an opening request, not a completed native-render result.

## Filesystem behavior and recovery

Original member names are checked as a complete Windows/macOS namespace before extraction. Case, Unicode-normalization and file-versus-directory collisions, Windows-reserved names, traversal, encrypted members and nonregular files produce an error naming the incompatible member. They are not silently renamed. Native path handling supports the shared Windows long-path implementation while project and ZIP references retain forward-slash relative names.

File and directory publication use the application's shared portable filesystem. File publication falls back to a verified independent copy where hard links are unavailable. Writable files are flushed and closed before publication; QGIS providers are released before their containing directory is published. Existing different editions are never overwritten by a receive or pack operation.

A failed ordinary ZIP receive removes its unpublished temporary extraction. A failed native QGIS receive retains its hidden `.gis-native-receiving-*` working copy and reports that path for diagnosis; the requested final destination remains absent. Resolve the reported native dependency or data issue and run again to a new receiving destination. Keep the original sender intact throughout recovery.

The portable storage layer preserves the existing selected layer identities, original bytes, project CRS, units, styles, scientific inspection, rendering and edition rules. It does not rerun the scientific model or substitute a newly calculated result for a retained run.

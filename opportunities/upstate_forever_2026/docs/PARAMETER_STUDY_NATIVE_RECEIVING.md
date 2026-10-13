# Receive complete native parameter studies

Run this course from the fixed cumulative application after the selected scientific operation has retained its current output. It works with complete, partial and prepared original studies. Native state remains explicit throughout the receiving result.

```sh
python -B source_tools/receive_parameter_studies.py \
  --workspace ACTUAL_NATIVE_WORKSPACE \
  --operation NEW_OWNED_DIRECTORY/parameter-receiving \
  --study-id ORIGINAL_SAVED_STUDY_ID
```

Repeat --study-id for several original studies. Omitting it selects every saved study present at the first invocation and durably retains that list. Later arrivals remain part of the whole Workspace archive; the selected receiving list stays fixed.

## Whole course

The command uses the maintained native Project transfer APIs to capture the complete original Workspace and application, including intermediates, retained reports, fieldwork, source acquisitions, native runs and parameter results. Its archive and incremental blocks retain original scientific files. Existing experiment/run locks control capture.

The native receiver restores that complete edition into the operation's fresh received directory. Original archive-byte checks and parameter-study semantic checks verify the selected case grid, scenario, profile, model scope, baseline, original specification and captured exports. The command then opens each selected study through the original parameter_studies.inspect API and emits its original case/run identities and actual current completion state.

Original GeoTIFFs, GIS metadata, report files and study archives are listed with their captured descriptors, archive members, exact received-file paths and current byte identities. A partial study may have missing or changed exports; its original declaration and the captured-file status both remain available. A receiving operation completing does not change the study's scientific completion state.

Open the received Workspace in the maintained operator, choose Parameters, and select the original saved study. Receiving JSON supplies its exact Workspace path and study ID. Snapshots created through the operator's own Transfer and restore desk also expose Open received study through that desk.

## Durable outputs and restart

- selection.json retains the original Workspace/project and the first selected study IDs.
- state.json records native phases, code editions and capture attempts.
- captured-studies.json retains the frozen snapshot's original study/specification/case/export summaries.
- receiving.json gives the restored Workspace, original full archive, original studies, reopened native state and exact file locations.
- transfer/ contains the native archive, transfer blocks and original capture/restore operation records.
- received/ contains the complete independently editable original application and Workspace.

Run the same command with the same operation directory to resume. The existing receiving lock prevents two copies from advancing that operation at once. Interrupted capture files are retained and a new capture attempt is recorded; completed capture reuses its immutable original snapshot. Native restore reconciles its own lost reply. New selections use a new operation directory.

Later work in the received Workspace remains intact. Reopening the course validates original study/specification identity and reports current native case state and file differences alongside the frozen captured edition. It never replaces the receiving Workspace with an earlier edition.

The receiving operation directory must be outside both the scientific Workspace and the application. It requires space for the original complete native archive, transfer data and full restored project. Use the existing equipped native host and its available disk for the actual course.

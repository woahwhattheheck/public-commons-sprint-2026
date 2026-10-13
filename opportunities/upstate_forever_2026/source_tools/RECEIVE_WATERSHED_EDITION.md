# Receive and reopen the completed regional watershed study

This command imports the complete retained water-context edition into the original scientific Workspace, adopts the already completed original watershed run through the maintained receiver, exports the chosen watersheds through the existing operator provider, and backs up and reopens the working project.

## Required application and data

Use the current original Upper Savannah application with:

- The maintained `operator/receive_watershed_context.py` receiver and its compatible watershed provider.
- The ordinary Workspace source importer and portable backup/restore engine.
- The complete v1.0.2 source edition under `source/water_context/20261013`. Its context entry retains the original completed ZIP, source and run receipts, original native source snapshots, all seven completed outputs, and the source inputs and publisher companions.
- `source_tools/receive_watershed_edition.py` from this component.

The complete edition's context source ID is `upper-savannah-water-context-domain217-20261013`. The original run is `watershed-4592eb077b7164d59ba4`; the retained selection is Lower Tugaloo `030601020507`. The original ZIP is 121,182 bytes, SHA256 `716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5`.

The receiver uses the original completed outputs. Its model-input fingerprint must follow the maintained loader: sorted basename/SHA256 pairs for `full-domain-water-context.json`, `scdes-domain217-source-coverage.json`, and an explicitly supplied `native-network.json`. Native code snapshots and supporting publisher originals retain their separate provenance.

## Run

From the application root, using the existing Python environment:

```bash
python -B source_tools/receive_watershed_edition.py \
  --application "$PWD" \
  --manifest "$PWD/source/water_context/20261013/complete-sources.json" \
  --output /actual/writable/receiving-directory
```

The command creates its scientific Workspace at `OUTPUT/workspace`. An explicit `--workspace /actual/existing/workspace` imports the edition into an existing project instead. Choose an output directory outside the application source and any existing Workspace, with space for the project's original portable archive and reopened copy.

The original binary ZIP is read from the reconstructed context companion `received/watershed-context-20261013/eco-watershed13-received.zip`. If the receiving installation holds that same original archive separately, supply `--archive /actual/eco-watershed13-received.zip`. Its declared archive hash is checked in both the workflow and maintained receiver.

Without `--huc12`, export uses the original saved selection. Repeat `--huc12 030601020507` for each selected original HUC12 when a different selection is required. The existing operator rejects identifiers outside the saved report.

## What the command performs

1. Imports the ordinary complete source manifest. Original entry identities, metadata, primary files, companion paths and object hashes remain managed by Workspace.
2. Resolves every imported entry through `Workspace.source_file`, including its nested completed-result, source snapshot and archive companions. It reads and verifies those actual reconstructed files.
3. Calls the maintained original receiver's `adopt` function with the actual application, Workspace, ZIP, original archive hash and original native run operation ID. The receiving command retains its own continuation identity separately. The receiver owns registration of the ordinary saved operator report.
4. Opens that saved report through `WatershedContextActions.read` and verifies that every generated output still matches the original run receipt. The model-input fingerprint remains compatible with the existing loader.
5. Opens each selected watershed through the same provider, then invokes its existing selection export. The current CSV serializer and immutable export identity stay with the maintained provider.
6. Uses the original portable backup and restore functions. It reopens the source collection, every companion, the original report, the selection export and selected watershed detail through the restored Workspace and provider.
7. Compares the original file identities, selected records and retained application source before recording completion.

`NativeWorkspaceHost` is the command's filesystem adapter for the provider's Workspace/download protocol. It returns an actual Workspace and verified file descriptors for native callers. The same report and selection methods used by the operator perform the work.

## Outputs and continuation

The command prints phase progress and writes `receiving-result.json` after each completed phase. That record includes the actual source collection and project IDs, receiving result, report ID, selected HUC12s, export ID, original output hashes, local download paths, archive identity and reopened project location.

- `workspace/`: the new original scientific project when no existing Workspace was supplied.
- `watershed-workspace.zip`: the original complete portable archive.
- `reopened/workspace/`: the independently restored project.
- `reopened/application/`: its retained application source.
- `receiving-result.json`: the actual receiving and reopening result.

Repeat the exact command with the same output directory to continue. The command checks its retained request identity, reuses the imported source collection, lets the original receiver reuse the saved report, and lets the provider reuse the same selection export. It keeps the archive and reopens the same project. A changed source manifest or different selection requires a new output directory.

The result record has a `complete` phase only after source files, completed outputs, selected records and application source have survived the original backup and restore. Any exception is returned with its type and native message so the source owner can repair the concrete operation.

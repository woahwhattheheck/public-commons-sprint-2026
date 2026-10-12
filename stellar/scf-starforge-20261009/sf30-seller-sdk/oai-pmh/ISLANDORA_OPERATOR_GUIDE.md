# Islandora migration desk

Use the Islandora desk to turn a reviewed OAI dataset into an operated migration: map metadata, resolve each record, associate original files and parents, run the installed Islandora Workbench, receive the resulting target records, and retain the complete handover.

The desk opens inside the existing Repository metadata console. The source requests, XML responses, reviewed editions, and projected dataset remain in the same private workspace.

## Open the workspace

Run the existing console from the `oai-pmh` source directory:

```bash
python3 cli.py --workspace /absolute/path/to/workspace serve
```

An installed package opens the same console from **Applications → Repository metadata and migration**. For native migration commands, use:

```bash
starforge islandora --python /absolute/path/to/python --workspace /absolute/path/to/workspace state
```

`node islandora_cli.mjs` is the direct source entry point. Both launchers retain the selected Python environment and the original Node dataset engine; use `--help` for all native commands. The Workbench environment is selected separately when running a saved batch.

Open the loopback URL printed by that command and select **Islandora**. Keep the console process running while a native operation is active. Browser and native commands operate on the same workspace, so finish or stop an active native operation before opening that workspace in another process.

In **Projection**, select the reviewed source edition and create its complete dataset. The dataset must include the exact OAI `identifier`. Preserve repeated source values when projecting metadata; the migration crosswalk decides how each list belongs in the target.

## 1. Select a migration and map its fields

Choose **New migration**, select the reviewed dataset, and enter a descriptive label and the actual target base URL. Use the target's content type, username, and multivalue delimiter. A completed migration at the same host can be selected as the baseline for the next source edition.

For an existing job, **Save target settings** updates its runtime configuration. Before any native target change, a first migration can be moved from a reference host to its actual installation. After native writes, the host, content type, and delimiter stay fixed; operational settings such as the username remain editable. A migration with a completed baseline keeps that baseline's host. Settings are merged into the saved configuration, and a new review is required after changes.

The source inventory displays every projected column and the first three original rows. The starter crosswalk uses familiar Dublin Core columns when they exist. Edit it to match the target's real Drupal field machine names and cardinality.

| Handling | Use |
| --- | --- |
| Single value | Require at most one source value. Repeated values are sent to review. |
| First value | Deliberately retain the first source value. Use this only when that is the intended field rule. |
| Join as text | Keep all values in one text field using the chosen separator. |
| Repeated field | Keep the values as separate target field items using the Workbench delimiter. |
| Controlled value lookup | Map each original value to the target's configured term or entity value. Unmapped values require review. |

Mark required target fields explicitly. Set the actual target title length. An optional **Exact source identifier field** keeps the full OAI identity in a separate target field; the native node ID is received after creation.

Use **Constant target values** for shared field values that are part of the migration's actual mapping. Additional Workbench settings can be entered as a JSON object. The desk accepts supported operational settings and keeps its generated input, output, and identifier-map paths together.

### Rights and access

Map each source concept independently:

| Source concept | Mapping decision |
| --- | --- |
| Rights or license statement | Preserve the original statement or URI in its rights field. |
| Access scope | Preserve public, restricted, campus, or other access values in the target's access field. |
| Embargo date | Preserve the release date in the target's date field with its required representation. |
| Resource type | Map the original object type to its configured target value. |
| File media type and use | Select the actual media bundle and use for each original file in its manifest. |

The presence of a rights statement does not supply an access value or an embargo date. A file extension does not establish the object's access policy.

Save the crosswalk, then open **Records**. Source projection and migration mapping remain separately inspectable. Existing staff overrides and selected files and parents stay attached when a saved crosswalk is revised. After a target-changing native run, create the next migration edition from its completed baseline when the crosswalk must change.

## 2. Review every record

The record list is paged and can be filtered by state or exact identifier text. Use **Previous** and **Next** to cover the complete selection. Open a record to compare its projected source, mapped values, saved baseline, and current target values.

| Record state | Operator action |
| --- | --- |
| Create | Review the mapped metadata and selected files for a new object. |
| Needs review | Resolve required values, cardinality problems, or source/target conflicts. |
| Receive target records | Receive the existing target fields before deciding its changes. |
| Update | Inspect the exact replacement or field deletion to be applied. |
| Current | Review the retained matching state and any remaining file or parent receiving. |

To correct a value, enable its **Staff override**, enter the complete target value, and save the record. Clear the override selection to return that field to its mapped source value.

For a field changed independently in both the source and target, choose the source value or keep the target value. An explicit source withdrawal offers a separate keep-or-unpublish decision. A record absent from a later source page is handled through the reviewed source edition; it is not automatically treated as a withdrawal.

The record view retains the full source identifier and original projected metadata. Use that exact identifier in file and parent manifests.

## 3. Attach original files and parent relationships

### Original-file manifest

Choose a complete UTF-8 JSON or CSV manifest and the absolute directory containing the original files. Manifest paths are relative to that directory. The server must be able to read the files at those paths.

The browser previews the full manifest in pages. **Attach original files** reads each actual local file, checks a supplied SHA-256 when present, and retains its bytes in the migration.

Required columns are `identifier` and `path`. Optional columns are `sha256`, `mediaType`, `mediaUse`, `role`, and `sourceURL`.

Example format; replace these identifiers and paths with the actual source records and files:

```csv
identifier,path,mediaType,mediaUse,role,sourceURL
oai:repository:collection-1,collection/cover.jpg,image,http://pcdm.org/use#OriginalFile,primary,https://repository.example.org/files/cover.jpg
oai:repository:item-1,documents/item-1.pdf,document,http://pcdm.org/use#OriginalFile,primary,https://repository.example.org/files/item-1.pdf
oai:repository:item-1,documents/item-1-transcript.txt,file,http://pcdm.org/use#OriginalFile,supplemental,https://repository.example.org/files/item-1-transcript.txt
```

Use actual media bundle machine names from the target. Select at most one primary file for an object; additional files can be supplemental. The desk groups creation by media type and retains each selected file's size, digest, use, role, and original URL.

### Parent manifest

A parent manifest contains `child` and `parent` columns, each using the complete source identifier:

```csv
child,parent
oai:repository:item-1,oai:repository:collection-1
```

Both records must exist in the migration. The desk rejects self-parenting and cycles. Parent links are prepared using the actual returned target node IDs. On a source refresh, the saved baseline distinguishes source-managed memberships from later staff changes. Source additions and removals update only those memberships; independent staff additions and removals survive. Native replacement or clearing batches preserve the resulting complete set, and target inspection receives that set before handover.

### Correct a saved selection

Select the record in **Records**, then open **Files and parents**. Check the retained files to keep and enter its complete parent list. Saving associations replaces those selections for that record. An empty list removes the corresponding selection. The original retained files remain available in the saved job; the corrected selection governs its subsequent migration work.

JSON manifests use an array of the same row objects. CSV supports quoted cells and embedded newlines. Browser uploads accept files up to 32 MiB; use the native commands for larger manifests or target returns.

## 4. Receive the current target

In **Target returns**, upload the unchanged CSV produced by the actual Workbench or repository export and confirm its target host.

A source-to-node map links `id` or `identifier` to `node_id`. Target metadata returns must include the actual node IDs and the mapped fields. The desk matches returned rows to this migration and retains the original CSV bytes.

**Import original native map** reads the Workbench identifier map already retained with this job. It is useful when creation succeeded but the browser or process ended before the result was displayed.

**Inspect current target** reads the actual nodes and their identities, publication state, parents, media identifiers, and original-file digests. Inspection uses the existing native worker and appears in the running status. It can recover interrupted file receiving from the current target before the next write.

Creation output supplies the actual identifier-to-node map. Workbench can copy source values into that output, so creation output is used for identity receiving. Run the separate generated **read-target** batch to receive typed current metadata through Workbench. After creation, updates, files, or parent work, inspect the target and refresh the prepared batches. Continue from the saved receiving state.

## 5. Operate the installed Workbench

Enter the absolute path to the installed original `workbench` script and the Python executable for that installation. Keep its dependencies and target permissions configured in that environment.

The console inherits its authentication environment. Supply `ISLANDORA_WORKBENCH_PASSWORD` through the process environment and enter the Workbench username in the migration configuration. Passwords are excluded from saved migration configuration and generated packages.

The original Workbench documentation describes [configuration and authentication](https://mjordan.github.io/islandora_workbench_docs/configuration/), [installation](https://mjordan.github.io/islandora_workbench_docs/installation/), and the native [configuration and input check](https://mjordan.github.io/islandora_workbench_docs/check/).

1. Resolve the complete record review.
2. In **Handover**, save the reviewing operator and migration review note.
3. In **Workbench**, prepare the current batches.
4. Inspect the generated CSV and configuration for each batch.
5. Use **Check** to run the original Workbench input check, or **Run** to execute the selected native batch. Target-changing execution also performs that native check before writing.
6. Read the actual process history, exit code, and saved log. Receive the original identifier map and current target after native changes.
7. Prepare again from the current saved state to obtain the remaining file, parent, metadata, or read-target work.

Creation batches are grouped by media type. Metadata updates are grouped by field and operation. File additions and parent relationships use received target node IDs. Before operating a saved batch, the desk receives any new IDs in that job's native SQLite map and compares preparation with the current record state and workspace location. It regenerates changed preparation while keeping the saved source, target identities, field choices, and review. If receiving makes the selected batch obsolete, choose the remaining batch shown in Workbench.

Every invocation, including the automatic native check, gets its own directory under `runs/RUN_ID/`. The process reads that invocation's saved input and configuration. Its outputs and rollback files stay in the same directory, so later preparation cannot overwrite an earlier run or make a previous output appear to be the new result.

| Retained member | Purpose |
| --- | --- |
| `input.csv` | The complete CSV read by this native process. |
| `config.yml` | The exact configuration passed to Workbench, with this run's input and output paths. |
| `prepared.yml` | The complete batch configuration immediately before binding it to this invocation. |
| `invocation.json` | The command, saved review, input hashes, and original node-map snapshot reference. |
| `native.log`, `workbench.log` | The captured process output and Workbench's own log, when produced. |
| `created-nodes.csv`, `current-target.csv` | This invocation's native create or metadata export result, when produced. |
| `rollback.yml`, `rollback.csv` | This invocation's native rollback files, when produced. |
| `result.json` | The saved process result and the resulting node-map snapshot reference. |

The active ID map remains in `batches/native-node-map.sqlite` for subsequent batches. Coherent copies from before and after native execution are retained in `native-maps/`; runs that have identical map contents share one saved copy. The complete migration package and workspace backup include these files.

**Stop native work** requests cancellation of the active worker. Wait for its process result, then inspect the current target and continue from the retained state. The CLI also stops its attached native worker when interrupted.

Native execution history includes downloads of each run's complete CSV, executed configuration, and original prepared configuration. Native logs are displayed in byte pages, with a separate download for the complete original file. A nonzero exit remains visible with that run's log.

## 6. Finish and reopen

In **Handover**, finish after the complete migration has matching metadata, real target node identities, verified original files, and received parent relationships. Enter the receiving operator and a handover note.

**Download complete migration package** retains the selected source capture and its original responses, crosswalk and record decisions, files, generated batches, native maps and logs, and the migration's current receiving state. This package can be saved at intermediate stages as well.

For a workspace that can be reopened and operated, use the original **Exports → Complete workspace backup**. It contains the database and retained workspace files, including migration jobs. Restore into a new directory:

```bash
python3 cli.py --workspace /absolute/path/to/restored-workspace restore --archive /absolute/path/to/oai-workspace.zip
python3 cli.py --workspace /absolute/path/to/restored-workspace serve
```

The migration package is the handover of a particular job. The complete workspace backup is the reopening artifact. Keep both with the installed application source.

Open the restored migration and enter the receiving machine's actual Workbench script and Python executable. **Prepare**, **Check**, and **Run** bind the current batches to the restored workspace. Input files, copied originals, inherited originals from baseline jobs, native maps, read-target exports, and rollback paths then resolve inside the receiving workspace. Original file names, hashes, roles, source identifiers, native IDs, and saved field choices are retained.

A native writer may have saved node IDs before its console ended. On the next operation, those IDs are received from the restored map before preparing the remaining batches. The desk retains the same migration; use its current Records and Workbench views to continue.

Historical run inputs keep the exact paths used for their original execution. Use the restored job's current **Prepare**, **Check**, or **Run** command to continue. If operating Workbench directly outside the desk, prepare and download the current batch configuration on the receiving machine first.

## Native command line

Run commands from the `oai-pmh` source directory. The examples below use placeholders for values returned by your actual workspace. Replace `BUILD_ID`, `MIGRATION_ID`, `RUN_ID`, and record identifiers with their complete saved values.

### Create and review

```bash
python3 islandora_cli.py --workspace /absolute/path/to/workspace state
python3 islandora_cli.py --workspace /absolute/path/to/workspace inventory --build BUILD_ID
python3 islandora_cli.py --workspace /absolute/path/to/workspace default-plan --build BUILD_ID > crosswalk.json
```

Edit the complete crosswalk, then create its migration with the actual host and configuration:

```bash
python3 islandora_cli.py --workspace /absolute/path/to/workspace create --build BUILD_ID --label "Repository migration" --host https://target.example.org --plan crosswalk.json --config target.json
python3 islandora_cli.py --workspace /absolute/path/to/workspace records --id MIGRATION_ID --offset 0 --limit 100
python3 islandora_cli.py --workspace /absolute/path/to/workspace records --id MIGRATION_ID --offset 100 --limit 100
python3 islandora_cli.py --workspace /absolute/path/to/workspace record --id MIGRATION_ID --identifier oai:repository:item-1
python3 islandora_cli.py --workspace /absolute/path/to/workspace edit --id MIGRATION_ID --identifier oai:repository:item-1 --overrides overrides.json --choices choices.json
```

An overrides document is a complete object mapping target field names to replacement strings. A choices document maps conflicting field names to `"source"` or `"target"`; a withdrawal choice uses `"$withdrawal": "unpublish"` or `"keep"`. An empty object clears the corresponding saved selections.

To assign or update the actual installation before operating the saved plan:

```bash
python3 islandora_cli.py --workspace /absolute/path/to/workspace configure --id MIGRATION_ID --host https://target.example.org --config target.json
```

### Attach, receive, and prepare

```bash
python3 islandora_cli.py --workspace /absolute/path/to/workspace attach --id MIGRATION_ID --manifest files.csv --asset-root /absolute/path/to/original-files
python3 islandora_cli.py --workspace /absolute/path/to/workspace relationships --id MIGRATION_ID --manifest parents.csv
python3 islandora_cli.py --workspace /absolute/path/to/workspace associations --id MIGRATION_ID --identifier oai:repository:item-1 --assets retained-asset-paths.json --parents parent-identifiers.json
python3 islandora_cli.py --workspace /absolute/path/to/workspace receive --id MIGRATION_ID --file original-target.csv --kind target --host https://target.example.org
python3 islandora_cli.py --workspace /absolute/path/to/workspace import-native-map --id MIGRATION_ID
python3 islandora_cli.py --workspace /absolute/path/to/workspace inspect-target --id MIGRATION_ID
python3 islandora_cli.py --workspace /absolute/path/to/workspace review --id MIGRATION_ID --operator "Reviewing operator" --note "The complete mapped records, original files, parents, and target changes have been reviewed."
python3 islandora_cli.py --workspace /absolute/path/to/workspace prepare --id MIGRATION_ID
```

Use the exact batch name returned by `prepare`:

```bash
python3 islandora_cli.py --workspace /absolute/path/to/workspace run --id MIGRATION_ID --batch create-document --workbench /absolute/path/to/islandora_workbench/workbench --python /absolute/path/to/workbench-environment/bin/python --check
python3 islandora_cli.py --workspace /absolute/path/to/workspace run --id MIGRATION_ID --batch create-document --workbench /absolute/path/to/islandora_workbench/workbench --python /absolute/path/to/workbench-environment/bin/python
python3 islandora_cli.py --workspace /absolute/path/to/workspace log --id MIGRATION_ID --run RUN_ID --offset 0 --limit 65536
```

The native run command stays attached until its original worker returns. It prints the actual saved run and exits nonzero on native failure. Use `job` and `records` to inspect the saved state between operations.

### Save and continue

```bash
python3 islandora_cli.py --workspace /absolute/path/to/workspace finish --id MIGRATION_ID --operator "Receiving operator" --note "The complete target metadata, nodes, original files, and parents have been received."
python3 islandora_cli.py --workspace /absolute/path/to/workspace export --id MIGRATION_ID --out /absolute/path/to/new-migration-package.zip
python3 cli.py --workspace /absolute/path/to/workspace backup --out /absolute/path/to/new-workspace-backup.zip
```

Export and backup destinations must be new files. For a later source edition, create a new migration using the new reviewed build and `--baseline MIGRATION_ID` from its completed predecessor.

## Command reference

| Command | Purpose |
| --- | --- |
| `state`, `job` | List migrations or inspect one complete saved job. |
| `inventory`, `default-plan` | Inspect the original dataset and starter crosswalk. |
| `create`, `configure`, `rebuild` | Create a migration, configure its target, or revise its crosswalk before target changes. |
| `records`, `record`, `edit` | Review all records and save field decisions. |
| `attach`, `relationships`, `associations` | Receive original manifests and correct saved selections. |
| `receive`, `import-native-map`, `inspect-target` | Receive actual target metadata, native IDs, files, and parents. |
| `review`, `prepare` | Save the operator review and produce current native batches. |
| `run`, `log` | Operate the original Workbench and read its retained result. |
| `finish`, `export` | Complete the receiving record and save the migration package. |

Each command has native `--help`. JSON document inputs accept a filename or `-` for stdin; use one stdin document per command.

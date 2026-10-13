# Receive the complete original Studies in one workbench

`receive_study_set.py` adds multi-Study receiving to the maintained local operator. It selects complete original scientific Workspace archives, streams their original bytes to the existing upload endpoint, queues the existing `workspace.restore` action, and retains each resulting project as a separately selectable Workspace in the same application. It does not replace the launcher, operator, source registry, science engine or native task queue.

## What travels and what remains separate

Each input is an original `upstate.scientific-workspace-archive/v1` ZIP containing `ARCHIVE.json`, `workspace/workspace.json`, the full selected Workspace and its application. The archive's project and retained run IDs are checked against the received catalogue. A report-only ZIP cannot stand in for a runnable Study. Teaching examples, regional models, input-response studies and receiving/review workspaces keep their own explicit family labels, project identities, cases and source classifications.

Two archive editions of the same project can be selected independently. They are identified by their complete archive hashes, not silently merged by title or project ID. The server's original portable receiver owns restoration and member verification. Application source inside each original archive remains with that received Study; the running operator's current source and active peer changes are not overwritten.

## Select the original archives

Keep the selected originals inside one directory, with the selection JSON at its root. Archive subdirectories are supported. Use ordinary local Python; planning and HTTP receiving do not themselves import InVEST.

```sh
python application/source_tools/receive_study_set.py plan \
  --study teaching=studies/Teaching_Original_Workspace.zip \
  --study regional=studies/Regional_Original_Workspace.zip \
  --study input-response=studies/Input_Response_Original_Workspace.zip \
  --output study-set.json
```

The command reads each original archive and saves its exact bytes, SHA-256, embedded project, retained run IDs and relative path. It performs no extraction and changes no Workspace. Keep an existing selection; choose a new selection filename for new or changed originals. The same directory can move to another machine without changing the relative selections.

An outer handoff containing several nested ZIPs is not itself a native Workspace archive. Select the complete original Workspace ZIP from that handoff. Compact result companions are useful source/result attachments but do not supply missing source rasters, profiles or runnable cases.

## Receive through the running original operator

Start or reopen the workbench with the maintained `source_tools/open_received_study.py` and the selected compatible interpreter. The existing native-runtime invocation remains the route for actual NDR/SDR execution. Use the launcher's private local-session JSON containing its original `url` or `operator_url`; keep that file in the receiver's private state directory.

```sh
python application/source_tools/receive_study_set.py receive study-set.json \
  --session-file /private/actual-local-session.json \
  --checkpoint /private/study-set-receiving.json \
  --destination received-results
```

The client accepts only the existing 127.0.0.1 HTTP operator session. It does not follow redirects, use a proxy, change browser policies, open an external access route, or write a credential to the selection, checkpoint or result files. The checkpoint is outside the scientific archives by default.

Receiving uses only original contracts:

1. `POST /api/upload` with original filename, content length and `X-Workspace`.
2. `POST /api/actions` with `action=workspace.restore`, the returned `upload_id` and a stable archive-derived `operation_id`.
3. `GET /api/task?id=...` and the existing `/api/task/resume` for an interrupted restore.
4. `GET /api/state?workspace=...`, `/api/item?kind=runs&id=...` and original file tickets for joined results.

The existing operator owns its serial queue, private registry, restore destinations, authentication and scientific state. The receiver starts no new server or native model worker. Its local checkpoint only retains the IDs needed to reconnect to the already accepted operations. Lost responses are recovered through the original stable operation identity. Closing the command does not cancel an accepted original task. A live checkpoint lock prevents two receiving clients from racing on the same checkpoint; the operating system releases that lock when its process ends.

## Compact joined results

The output directory contains `joined-studies.json`, `joined-runs.csv` and the copied original JSON/CSV/HTML run artifacts. Every copied artifact is checked against its original ticket's exact byte count and SHA-256. Original filenames, source labels and original full run records remain attached to each case. Equal filenames with different bodies cannot overwrite each other. Retained run IDs in the original archive must remain present in the received native catalogue.

The index joins identities and existing outputs, not incompatible scientific totals. It applies no new area conversion, unit reinterpretation, catchment aggregation, coefficient changes or synthetic model calculation. Original nitrogen/phosphorus/sediment units, source domains, illustrative classification and accepted results remain in the original records. Source rasters and full native GIS outputs stay in the selected complete archive and the restored Workspace.

To copy another original output type, specify the complete desired set of extensions, for example:

```sh
python application/source_tools/receive_study_set.py receive study-set.json \
  --session-file /private/actual-local-session.json \
  --destination received-results \
  --result-suffix .json --result-suffix .csv --result-suffix .html \
  --result-suffix .tif --result-suffix .gpkg
```

Existing correct result files are reused. A different file already occupying a selected result path is preserved and reported rather than overwritten. The result index contains original Workspace/item IDs, not expiring file-ticket URLs or local session credentials. Open a received project from the ordinary workbench Workspace selector, then use its original Runs, Parameter studies, source and reporting views.

## Recovery and independent inputs

Run the same receiving command again after reconnecting the original operator. It reopens the retained task IDs and resumes an interrupted restore without issuing a new scientific operation. After repairing an actual failed restore's input/runtime fault, `--retry-failed` resumes that same original task. A cancelled original task is kept visible rather than silently restarted.

A missing, changed, incompatible or unreadable archive affects its own selected Study. The receiver records that exact failure and continues the remaining independent selections. A result-download failure retains the restored Workspace and all already collected originals, so the same command can finish the remaining downloads. Exit status 0 means every selected intake and requested result collection completed; 2 means the joined index contains individual unresolved entries; 130 retains the checkpoint after keyboard interruption.

## Producing operation and receiving boundary

Read the application's `AGENTS.md` and `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.4`, together with Bryce's current post-call work order. Preserve existing active application and native-run owners. Source restoration must include the complete original runnable Studies, not a receiving-only or report-only substitute.

Use one focused end-to-end receiving course against the actual running operator: select the complete original archives; receive them; reconnect the same checkpoint; choose each populated original Workspace; open the retained cases and requested downloads; reopen the saved Study. View the exact outgoing desktop and narrow/mobile renderings and downloaded files, repairing actual defects. Existing accepted native calculations are reused; new inputs/physics use new native IDs and the original runner. No broad suite, hosted Actions, private repository, customer message or new session is part of this receiver.

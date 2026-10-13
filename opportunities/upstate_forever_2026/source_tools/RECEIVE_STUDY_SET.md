# Receive complete original Studies in one workbench

`receive_study_set.py` receives a selection of original scientific Workspace archives into the maintained local operator. It streams original archives through the existing upload and `workspace.restore` actions, reconnects their retained operations and collects original run artifacts. Each project remains separately selectable in the same application. The launcher, operator, source registry, science engine, active scientific work and native task queue remain authoritative.

## Select the originals

Use complete `upstate.scientific-workspace-archive/v1` ZIPs with `ARCHIVE.json`, `workspace/workspace.json`, the selected Workspace and its application. A report-only ZIP or an outer handoff containing nested archives is not a runnable Study. Select the complete original Workspace archive inside that handoff. Teaching, regional, input-response and receiving/review families keep their own explicit labels, original project IDs, source classifications and accepted cases.

Keep the selected originals in one directory, with the selection JSON at its root. Subdirectories are supported. These commands use Python's standard library; actual native calculations continue to use the existing selected-interpreter invocation and InVEST environment.

```sh
python application/source_tools/receive_study_set.py plan \
  --study teaching=studies/Teaching_Original_Workspace.zip \
  --study regional=studies/Regional_Original_Workspace.zip \
  --study input-response=studies/Input_Response_Original_Workspace.zip \
  --output study-set.json
```

The saved selection includes each available archive's actual byte count, SHA-256, embedded project, retained run IDs and relative path. Planning performs no extraction and changes no Workspace. A missing, unreadable or incompatible individual archive is recorded in `unavailable`; the other originals remain selected and can be received immediately. Exit 2 indicates those individual unresolved requests. Their exact file/project identities are not invented. Receive newly acquired or changed originals with a new selection filename, retaining the previous one. A completely unavailable selection can be recorded, but cannot return successful receiving.

## Reopen the maintained operator

Use `source_tools/open_received_study.py` and its original private local-session JSON. The complete opening/reopening guide is [OPEN_RECEIVED_WORKBENCH.md](OPEN_RECEIVED_WORKBENCH.md). Existing native invocation, saved launch profiles and live-session adoption stay with that launcher. Do not restart another person's active server or calculations to receive source changes.

```sh
python application/source_tools/receive_study_set.py receive study-set.json \
  --session-file /private/actual-local-session.json \
  --checkpoint /private/study-set-receiving.json \
  --destination received-results
```

The session file must contain the original `url` or `operator_url`. It stays in the receiving machine's private state, outside the application and scientific Workspace. The client uses only the existing 127.0.0.1 HTTP operator. It follows no redirects, uses no proxy and changes no browser policy, network binding or external access route. Credentials are not written into the selection, checkpoint, result index or copied artifacts.

## Original Workspace reuse and stable restoration

Before creating a new restore, the receiver looks for an available registered Workspace carrying the exact original archive SHA and project ID. A single exact match is reused, including its subsequent local edits and accepted scientific work. Different archive editions are not silently merged by title or project ID. When more than one existing copy has that exact origin, choose the desired original registry key explicitly:

```sh
python application/source_tools/receive_study_set.py receive study-set.json \
  --session-file /private/actual-local-session.json \
  --destination received-results \
  --use-workspace ACTUAL_64_CHARACTER_ARCHIVE_SHA=ACTUAL_64_CHARACTER_WORKSPACE_KEY
```

The actual SHA is in the saved selection; the available matching keys are returned in the receiving error. A checkpoint's previously selected exact Workspace is preferred. Choosing a different original copy is a receiving selection, not authority to overwrite or cancel the retained original restore task. Use a separate checkpoint for that separate receiving selection.

New receiving calls the maintained contracts: `POST /api/upload`, `POST /api/actions` with `action=workspace.restore`, `GET /api/task`, and the existing `/api/task/resume`. The operation ID is stable for the original archive. The server's original portable receiver performs full member verification, restores into its own retained destination and registers the Workspace. The running application's current source is not replaced by archived source.

The local checkpoint contains accepted upload/task/Workspace identities, not another queue or scientific database. Repeating the command reopens the original task. Lost responses reconnect through the same operation identity. Interrupting the client does not cancel the server's accepted work. A live operating-system lock prevents two clients from writing the same checkpoint or output directory; process exit releases it automatically.

An already accepted restore or existing exact registered Workspace can be reconnected even after the transport ZIP is no longer present. Original archive bytes are needed only when performing a new upload/restore. A missing transport file therefore does not block access to cases already received in the original application.

## Joined cases and original artifacts

`received-results/joined-studies.json` retains each original project, Workspace, native run record and file identity. `joined-runs.csv` is the compact case index. It joins actual identities and existing outputs; it performs no unit reinterpretation, coefficient changes, catchment aggregation or new model calculation. Original nitrogen/phosphorus/sediment units, source domains, illustrative classifications and accepted results remain in their original records.

By default, every file ticket published by each original run is copied. The receiver preserves its original run-relative path under:

```text
results/<archive-sha>/workspace/runs/<original-run-id>/<original-artifact-path>
```

It does not prefix report/image names with hashes or flatten directories. Original reports and their declared companion paths therefore retain their relative organization. Duplicate bodies can retain distinct original paths. Every downloaded body is checked against its original ticket's exact size and SHA. Different bytes already occupying an output path are preserved and reported instead of overwritten. Source data or dependencies outside the original run's published artifact set remain in the complete restored Workspace/archive; the result index is not a replacement application.

An explicit extension filter makes a smaller result selection:

```sh
python application/source_tools/receive_study_set.py receive study-set.json \
  --session-file /private/actual-local-session.json \
  --destination received-results \
  --result-suffix .json --result-suffix .csv
```

The index records this filter and omitted original tickets. A filtered selection can exclude report dependencies; use the unfiltered receiving command for the published run artifact set. The index uses original Workspace/item IDs and local relative file paths, not expiring file-ticket URLs.

Open each received project through the ordinary workbench Workspace selector, then use its original Runs, Parameter studies, source and reporting views. All original retained run IDs from the archive must remain in the received catalogue. Cases added to the live Workspace remain visible, with their original IDs, state and record. The catalogue is an observation of the live application, not a frozen archive of a running calculation.

## Independent failures and continuation

A failed archive or individual result download is recorded with its actual error while the other selected Studies and run files continue. Already restored Workspaces and copied correct originals are reused. After repairing a failed restore's actual input/runtime fault, `--retry-failed` resumes that same task. An interrupted task is resumed once per invocation; a cancelled task is not silently restarted. Reconnect the same selection and checkpoint after a client interruption.

Exit 0 means all selected receiving operations and requested artifact downloads completed, with no unavailable selection requests. Exit 2 means the joined index includes unresolved selections or results. Exit 130 retains accepted operations after keyboard interruption. These statuses describe receiving, not independent scientific/model validation or client-facing visual acceptance.

## Producing operation

Read the application's `AGENTS.md`, `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4`, and Bryce's current post-call work orders. Preserve actual active application and scientific writers. Complete original runnable Studies must travel; a receiving-only project or result-only companion cannot substitute for them.

Use one focused end-to-end course on the actual existing operator: receive the original archives; repeat the same checkpoint; choose each populated original Workspace; open retained cases and downloads; reopen the saved Study. Inspect the exact outgoing desktop and narrow/mobile renderings and downloaded attachments in their normal viewers, repairing actual defects. Reuse accepted native calculations; new inputs or physics get new original IDs and use the original engine. Keep actual execution/result receipts in the original build thread. This receiver adds no hosted Actions, broad suite, external message or new session.

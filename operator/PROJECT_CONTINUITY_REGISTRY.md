# Project continuity in the shared operator

The installed descriptor joins the existing scientific archive, original incremental handover and operator task queue. The **Project continuity** view saves selected scientific operation history and the original inputs needed to continue unfinished work.

## Maintained source

| Path | Responsibility |
| --- | --- |
| `operator/project_continuity.py` | `ProjectContinuity`: snapshot history and inputs, receive and reconcile tasks, resume selections |
| `operator/extension_modules/project_continuity.py` | Shared-registry adapter and initialized action set |
| `operator/extensions/project-continuity.json` | Three task actions, authenticated reads, state, task decoration and workspace receiving verification |
| `operator/web/project_continuity.mjs` | Registered complete-project, receiving, incremental and resumption controls |
| `operator/project_continuity_cli.py` | The same complete-project workflow from the command line |
| `operator/project_transfer.py` | Original incremental provider, registered once by `project-transfer.json` |

The service and browser paths above are part of the current application. Preserve the maintained transport provider at its original path when composing earlier source editions.

## Runtime binding

The registry constructs the adapter with the current operator and its Fault class. Reads, task invocation, state and task decoration obtain the initialized builtin and extension action set. A received task uses the handlers actually installed in the receiving application.

The original queue executes `workspace.snapshot`, `workspace.receive` and `workspace.recovery.resume`. Authenticated reads under `/api/extensions/project-continuity/` are `plan`, `list`, `inspect` and `transport`. The plan includes the current saved `operator_session` so the form freezes the selected view and its revision with the transfer request.

The registry publishes `data.project_continuity.transfers` and `data.project_continuity.accepted_actions`. The browser uses the existing host's forms, uploads, queue, task details and file downloads. Its `selectWorkspace` capability opens the completed receiving result; `navigate` returns to the saved Guided journey. Stale reads from another workspace or an earlier panel request are discarded.

The original incremental descriptor is the sole owner of its transport actions. Its provider also supplies `operator.project_transfers` for continuity. Capture enters the optional saved-view context only when creating a new native archive; completed archive and capture replay retain their original edition.

## Operate the handoff

Choose **Save view and transfer project** in Guided journey, then **Create complete project**. Review the saved view, selected history and intermediate-file choice. Download the completed ZIP, or use the original incremental manifest and missing-part exchange.

Receive the edition, choose **Open received project**, and inspect the retained operations. **Save or continue the selected analysis** opens the saved guide. **Resume unfinished work** explicitly selects the remaining work for the original queue. Reopening uses the same receiving workspace and operator-state directory. The complete instructions and command-line examples are in [PROJECT_CONTINUITY.md](PROJECT_CONTINUITY.md).

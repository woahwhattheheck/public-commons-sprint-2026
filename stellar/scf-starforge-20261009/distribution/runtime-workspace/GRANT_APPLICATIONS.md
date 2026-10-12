# Grant planning and delivery in Applications

The **Grant planning and delivery** application opens the original SF47 workspace through the maintained runtime. Saved plans, staffing alternatives, contributor work, invoices, disputes, cash observations and allocations stay in that workspace. Applications supplies its usual Review, Save, Start, Open, Stop and Reopen controls.

The selected runtime must contain `stellar/scf_2026/sf47_budget_model/workspace/launch.mjs`. The application catalog exposes this entry for that source closure. The original `grant-workspace` command and its existing planning and operations commands remain available.

## Choose the original workspace

| Field | Selection |
| --- | --- |
| Private grant workspace | The absolute path of the retained SF47 directory, or one new folder in an existing private parent. |
| Original planning scenario | Optional original SF47 JSON for an empty workspace. The default is the scenario shipped beside the selected original budget model. Existing saved plans retain their own source and revision history. |
| Python executable | An absolute Python executable. The default is `/usr/bin/python3`. A selected virtual environment keeps its executable path. |
| Local port | `0` selects an available loopback port. A fixed port must be available on the same host. |
| Private environment JSON | The existing optional Applications environment file. Explicit selected Python takes precedence over `SF47_PYTHON`. |

The workspace and its receiving parent are private directories owned by the operator. Use an ordinary real path. A workspace may already contain its original `planning.sqlite3`, plan history and operations records; select that directory to continue those records.

Review resolves the selected installed source and Python, reads the scenario, and pins the original launch source files. It records the original directory identity without freezing mutable plan or case revisions. Creating a saved application does not create a second grant plan.

## Review, save and open

1. Select the maintained READY runtime and **Grant planning and delivery**.
2. Choose the original workspace, Python and optional scenario.
3. Review the original command and selected paths, then save the application.
4. Start the saved application. The managed worker launches the original `grant-workspace` command.
5. Open the application after its original listener is available.

Before opening SQLite, the original Python process compares the reviewed source, scenario, workspace and selected interpreter with its own launch. Managed adoption executes a copied original release, so the launch preserves the reviewed runtime source path and separately verifies the executed release's original launch files against that same source map. A changed selection or copied source returns a concrete error and asks for another review. The original workspace lock prevents a second process from opening the same planning database.

Startup is a single compact announcement from the original service. The Applications reader compares it with the private `managed-launch.json` retained in the workspace, including the source selection, launch instance, process identifier and actual port. It then calls the original authenticated `/api/access` endpoint and requires the same launch identity. This uses the service itself across managed worker process namespaces.

The access key remains in the original private workspace. The public launch announcement contains no key. The Open URL places the original key in its browser fragment; keep that URL and the workspace's `open-workspace.html` private.

## Work in the same grant product

The planning interface supports the original imported scenario, staffing and capacity alternatives, dated cash model, estimates, saved revisions, history, clone and restore. Select the saved plan and revision that belong to the current application work.

Delivery operations use the same original workspace. Continue the existing case, pinned plan, contributor packages, invoice review, disputes and partial allocations. Actual cash observations and purchase records retain their original source attachments and identifiers. A restart does not create a replacement case.

Detailed product operations are described in the original guides:

- [Planning workspace and browser](../../../scf_2026/sf47_budget_model/workspace/README.md)
- [Planning and operations CLI](../../../scf_2026/sf47_budget_model/workspace/CLI.md)
- [Delivery operations](../../../scf_2026/sf47_budget_model/workspace/OPERATIONS.md)
- [Original delivery API](../../../scf_2026/sf47_budget_model/workspace/OPERATIONS-API.md)

Use the original export controls to retain a plan, the complete planning collection or an operating case with its exact attachments. Export destinations are independent of the installed runtime. Reopening uses the original workspace and history; receiving an export uses the original import command or browser action.

## Stop and reopen

Use **Stop** on the saved application. The maintained worker signals the original Node launcher, which forwards the signal to the selected Python process. The original server stops accepting requests, waits for its existing request threads to finish, records the launch as `STOPPED`, and closes SQLite and its workspace lock.

The directory keeps the saved planning and delivery records, private access key and latest launch record. Applications retains the earlier operation history. Reopen the same saved application and Start it again. The new process gets a fresh launch instance and, with port `0`, may get a new local port. Open is derived from that new original listener.

Applications retains its normal operation history and recovery controls. If a worker reply is lost, use the existing saved operation and recovery path. The original database lock remains authoritative when another owner still has the workspace open.

## Original command line

Installed native use continues through the maintained alias. The explicit executable flag comes before the original command:

```sh
starforge grant-workspace --python /usr/bin/python3 serve \
  --workspace /srv/stellar/private-grant --port 0
```

Existing commands also accept that leading selection:

```sh
starforge grant-workspace --python /usr/bin/python3 list \
  --workspace /srv/stellar/private-grant
```

Without the leading flag, the original launcher uses `SF47_PYTHON` or `python3`. It passes Python's `-B` option to avoid creating bytecode inside the selected source.

Managed Applications adds `--startup-format managed`, `--source-directory` and `--expected-selection-sha256` to the original `serve` invocation. The review generates those values from the selected original `launch.mjs`; manual native use can continue with the default legacy startup format.

## Resolve a changed selection

| Reported condition | Recovery |
| --- | --- |
| The installed runtime lacks the original managed launch reader | Select the following maintained edition containing the SF47 managed launch files. |
| `GRANT_LAUNCH_SELECTION_CHANGED` | Review the current workspace path, scenario, selected Python and source again, then start the reviewed application. |
| `GRANT_SOURCE_SELECTION_CHANGED` | Select the original source closure belonging to the chosen runtime. |
| `GRANT_EXECUTED_SOURCE_CHANGED` | Reconcile the adopted release with the selected original runtime, then review that source again. |
| `GRANT_PRIVATE_WORKSPACE_REQUIRED` | Select the owned private original directory or an owned private receiving parent. |
| Original `WORKSPACE_OPEN` | Stop or recover the existing owner of that workspace through its original application operation. |
| Port already in use | Select port `0` or another available local port, then review and start. |
| `GRANT_STARTUP_LISTENER_CHANGED` or `GRANT_PRIVATE_LAUNCH_CHANGED` | Read the saved operation and original service result; recover that operation and reopen the same selected workspace. |
| Python cannot start | Select an existing absolute Python executable on the worker host. |

## Source integration

The complete SF47 component contains the original budget model, planning and delivery engines, browser assets, CLI and the managed startup reader. The distribution already forwards `grant-workspace` to the original launcher. The managed Applications entry uses the additive `application-grant.mjs` helper through the maintained shared catalog and output observer.

The source selection hashes the original budget, CLI, server, model and launch modules alongside the scenario. It does not pin the mutable planning database or case records. The private listener readback preserves the original source selection in the saved Applications launch receipt, allowing the operator to identify which installed source opened the retained product.

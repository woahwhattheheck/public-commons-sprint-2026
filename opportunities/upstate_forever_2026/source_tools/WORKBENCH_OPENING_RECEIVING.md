# Prepare and reopen the complete scientific workbench

These maintained opening files belong to a complete received application and its original scientific Workspace. They use the existing workbench launcher, authentication, saved selection and operator lifecycle. Opening the application starts no scientific model.

## Required layout

Keep these original directories together in the receiving project:

- `application/`: complete current application, including the startup guide, original launcher and native invocation helpers.
- `workspace/`: the original Workspace with its `workspace.json`, retained sources, database and completed results.
- `runtime/`: the supplied Linux x86_64 runtime, when using the Linux or optional WSL route.

Use the runtime's original instructions for the one-time relocation of a newly extracted runtime. Preserve any existing running runtime and operator. Neither the preparer nor the opening file installs or relocates a runtime.

## Prepare the Linux opening file

Run the preparer from the received project's own application:

```sh
python3 -B /received/project/application/source_tools/prepare_recipient_opening.py /received/project
```

It checks the original Workspace identity, verifies the required application members and copies the exact maintained `Open_Workbench.sh` beside `application/` and `workspace/`. Publication is create-only: identical existing files are reused and different files are preserved as conflicts. It changes no Workspace content, creates no profile and starts no server.

Include this opening file with the original complete working project when delivering the archive. The supplied runtime must still be present; the opener is not a runtime download.

## Open on Linux

Use the prepared opening file:

```sh
sh /received/project/Open_Workbench.sh
```

The wrapper selects the supplied `runtime/bin/python`, its actual PROJ/GDAL directories and the original `source_tools/open_received_study.py`. It accepts spaces in paths and clears conflicting inherited Python path settings. Keep the owning terminal open while using the workbench.

On first opening, the maintained launcher saves the ordinary portable `workbench.json` selection. Later openings preserve that selection and reuse its authenticated active session. The launcher owns readiness, normal shutdown and task draining. Never close a different worker's existing process to install these files.

`--status` is read-only: it creates no profile and starts no server. `--no-browser` keeps browser opening manual and prints the private address for that same machine. A different VM's loopback address is not a remotely accessible recipient URL.

If the native-library inspection fails, the wrapper prints the actual failure and the original one-time relocation command when present. Apply that command only to a freshly extracted runtime, then reopen the same project. Preserve the already-running workbench.

## Optional existing WSL route

Only for a recipient with a verified, already-running Linux x86_64 WSL distribution, prepare the optional Windows shortcut:

```sh
python3 -B /received/project/application/source_tools/prepare_recipient_opening.py /received/project --include-wsl
```

`Open_Workbench_WSL.cmd` delegates to the same Linux opening file through the existing distribution. The small `open_workbench_wsl.sh` bridge preserves the translated project path; `open_windows_browser.py` validates the launcher's original loopback URL before opening it in the Windows host browser. The shortcut installs nothing and starts no separate listener or public tunnel.

This optional WSL file is not the native Windows opener. Keep any separately delivered `Open_Workbench.cmd`, native Windows runtime choice and current primary-platform source with their existing receiving edition. Do not rename the WSL shortcut to the primary Windows name or imply that a Linux scientific runtime executes in ordinary Windows Python.

Operate the optional shortcut on its actual receiving Windows host before calling that route complete, including browser opening and loopback reachability. If browser integration is unavailable, use the same-machine private address displayed by the original launcher.

## Compose advancing source

The `workbench-startup-guide` component retains the complete opening sources alongside its browser, style and guide. It requires both the original `recipient-workbench-opening` dependency closure and the current `windows-workspace-receiving` component. The existing cumulative installer requires the opening templates, browser helper and preparer to remain explicit component members; retain these declarations when composing a newer UI or platform edition.

Use the current cumulative source installer with complete source packets and exact predecessor guards. Preserve newer source-intake, Measurements, platform, primary Windows opener and scientific-family changes. Applying application files does not combine separate Workspace databases, reclassify received runs or repeat completed numerical calculations.

## Continue actual recipient use

Use the existing producing and receiving operation. Open the exact assembled, populated application at the presentation width and 390 px; personally view the rendered result. Operate the four-card guidance and its dismiss/replay controls, source import and saved choices, actual task status and results, exports, full backup/restore and normal close/cold reopening.

Open every outgoing attachment in its normal viewer and extract/open the delivered project. Confirm a second opening reuses the original session and a later cold opening retains the selected project and saved edits. Fix the actual observed failure in the maintained source. Source compilation, source closure or a successful file copy is not recipient operation.

Carry the current `CURRENT_OWNER_DIRECTION.md` and `AGENTS.md` with the complete application. Current direction is version `2026-10-13.4`; preserve completed work, active process ownership and the requirement to open, look at and use the exact outgoing product and every attachment.

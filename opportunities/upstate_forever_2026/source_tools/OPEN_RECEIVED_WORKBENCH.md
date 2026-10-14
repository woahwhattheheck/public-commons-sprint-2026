# Open and reopen the scientific workbench

TokenJunkieLabs · 14 October 2026 · owner direction 2026-10-14.1

The delivered collection opens the same maintained scientific application, with
**Tim — Own data** as its receiving workspace and the six retained reference
workspaces available in the chooser. The seven original project identities and
82 saved scientific runs remain with their projects.

## Open the complete collection

Extract the whole delivered ZIP into a writable directory. Keep its application,
study payloads, runtime descriptors and bundled platform runtimes together.

| Receiving system | Collection opening file |
|---|---|
| Windows x64 | Open_Workbench.cmd |
| macOS Intel or Apple Silicon | Open_Workbench.command |
| Qualified Linux receiving environment | Open_Native_Collection.sh |

The root opening files select the supplied interpreter and scientific runtime
for that machine, complete their maintained first receiving step, and enter the
same application. The Windows and Mac package includes its Python and native
dependencies; a separate Python, Node, compiler or GIS installation is not a
recipient setup step. These instructions apply to the complete platform package,
whose runtime descriptors and actual binaries are assembled together.

First receiving can take longer than a later opening. Keep the opening terminal
visible while it prepares the included runtime and study payloads. Existing
completed workspaces reopen as their current mutable projects. The launcher
authenticates the original server before opening its browser.

Open the same shortcut again to reuse the running application. Concurrent
openings wait for the first opener's private launch lock, for up to three minutes,
then check the resulting original session. They do not create another operator
for that state. A mismatch reports the concrete selection that needs attention;
it does not replace an active application.

Keep the owning terminal open while working. Close normally with **Ctrl+C** in
that terminal. The original operator drains its active task before it exits.
On Windows, the launcher retains the actual server PID and sends its normal
CTRL_BREAK shutdown only after that child acknowledges its launcher nonce.
Reopen the same shortcut after the close finishes.

## When the browser does not open automatically

A browser failure leaves the running operator available. The terminal prints its
current private session address. Open that exact address in a browser on the
same computer. An earlier bookmark can contain an expired port or session.

The current application also provides the maintained workbench-link recovery
page and its downloadable offline opening page. Use its current-link control
with the newly opened session address when returning from an older report.
See [WORKBENCH_LINKS.md](../WORKBENCH_LINKS.md).

Keep the complete address private: its fragment contains the session credential.
A cloud computer's loopback address belongs to that computer. Use the receiving
platform's existing authorized browser route or open the delivered collection on
your own machine.

## Advanced single-project opening

The collection shortcuts are the ordinary receiving path. The maintained CLI
also opens a single complete application and workspace, or an existing portable
launch profile.

POSIX shell:

```sh
"/actual/native-runtime/bin/python" -B \
  "/received/project/application/source_tools/open_received_study.py" \
  --workspace "/received/project/workspace" \
  --python "/actual/native-runtime/bin/python" --native \
  --save-profile "/received/project/workbench.json"
```

Windows PowerShell:

```powershell
& "C:\received\runtime\python.exe" -B `
  "C:\received\project\application\source_tools\open_received_study.py" `
  --workspace "C:\received\project\workspace" `
  --python "C:\received\runtime\python.exe" --native `
  --save-profile "C:\received\project\workbench.json"
```

Replace the example paths with the actual received paths. The startup summary
reports the selected application, workspace, Python and private operator-state
directory without printing a credential.

Native opening uses the maintained invocation's `prepare` function and then
starts the actual scientific server as the launcher's owned child. The selected
runtime loads its original native modules before entering the server. A different
`--application` uses that application's own one-shot preparation, followed by
the same owned server process. UTF-8 and unbuffered output are applied after
native environment selection, so Unicode paths and startup receipts retain their
encoding on Windows as well as Mac and Linux.

`--plain` remains available for an explicitly selected existing plain operator;
the full platform collection selects `--native`. There is no silent fallback
from scientific startup to a different engine.

## Reuse and inspect an existing selection

```sh
"/actual/python" -B application/source_tools/open_received_study.py \
  --profile workbench.json
```

The launcher checks the original authenticated `/api/whoami` response, workspace
path identity, project ID, application/runtime/source selection and advertised
origin. It reopens the matching process and returns, leaving the original owning
terminal, native jobs and queue in place.

Use `--status` with that same profile to inspect without starting a server or
opening a browser. Exit 0 means a matching authenticated session; exit 3 means no
verified retained session; exit 1 reports a configuration or connection error.
Only a refused connection permits an ordinary restart of a retained session.
An authentication or identity failure does not authorize another process.

The public startup/status object includes `operator_state`. Its default location
is under LOCALAPPDATA/ecosystem-workbench on Windows,
Library/Application Support/ecosystem-workbench on macOS, and
XDG_STATE_HOME/ecosystem-workbench or ~/.local/state/ecosystem-workbench on Linux.
An existing earlier private state directory is retained on upgrade, including
the earlier macOS ~/.local/state location. An explicit `--operator-state` stays
authoritative and must be outside the application and scientific workspace.

## Export the existing session for the API client

Open the workbench normally first. Use the exact private `operator_state` and
Python paths from its startup summary. This export authenticates that existing
selection and writes a new private connection file; it starts no operator and
does not change its runtime or workspace.

POSIX shell:

```sh
"/actual/python" -B application/source_tools/open_received_study.py \
  --operator-state "/actual/private/ecosystem-workbench/selection" \
  --export-connection api-connection.private.json
```

Windows PowerShell:

```powershell
& "C:\actual\python.exe" -B `
  "C:\received\application\source_tools\open_received_study.py" `
  --operator-state "C:\Users\you\AppData\Local\ecosystem-workbench\selection" `
  --export-connection api-connection.private.json
```

A relative export filename is resolved **inside that private operator-state
directory**. An absolute output path must also be outside the portable project.
An existing file is preserved; choose a new filename for a new session. The
command prints only the complete connection filename and the selected Python
path. The Python path is the retained API-client interpreter choice; an adopted
server retains its owner's independent runtime.

Use the existing client with that returned connection path:

```sh
"/returned/python" -B application/operator/workbench_client.py \
  --connection "/returned/private/api-connection.private.json" state
```

The local connection contains the original loopback origin, private operator URL
and workspace key. The API client sends that credential only to the original
loopback service. The existing HTTPS recipient connection uses its separate
maintained schema and configuration; exporting this local file does not convert
it into a remote credential. Keep connection files with machine-private state
and out of workspaces, project ZIPs, shared source, email and Slack.

## Portable profiles and moved projects

A saved `workbench.json` contains the project identity, application/workspace and
interpreter selections, native/plain choice, port, and optional source manifests,
source roots and advertised origin. It contains no session credential.

Paths inside its directory are stored relative to that directory. External
dependencies remain explicit machine paths. Move the whole project, then
override the receiving interpreter when needed:

```sh
"/this/machine/python" -B /new/project/application/source_tools/open_received_study.py \
  --profile /new/project/workbench.json \
  --python /this/machine/runtime/bin/python --native
```

Command-line application, workspace, Python, native/plain, port and repeated
source manifest/root options override their saved selections. Relative command
paths belong to the current shell; relative saved paths belong to the profile.
ECOSYSTEMS_PYTHON remains an explicit interpreter override. Virtual-environment
executables retain their symlink path.

Saving a profile is create-only. Use `--save-profile NEW_PATH --configure-only`
to save without starting a process. A different scientific project receives its
own profile. Private session state stays on the receiving machine.

## Adopt an independently started original operator

Use its retained original startup receipt with its original project and state:

```sh
"/actual/python" -B application/source_tools/open_received_study.py \
  --workspace "/original/workspace" --python "/actual/python" --plain \
  --operator-state "/original/private/state" \
  --adopt-session "/private/original-startup.json" --no-browser
```

The original receipt must contain its operator_url, workspace_key and project.id.
The launcher authenticates those exact identities. Adoption does not infer the
server's scientific runtime or source arguments, so it uses `--plain` without
new source selections and leaves the original owner's configuration in place.
Its public summary labels the adopted origin and leaves server-runtime claims
unset. A later reopen never terminates an adopted or reused process.

## Continue scientific work and transfer

Use the existing parameter-study, native-job, source, map and report controls.
Select explicit new inputs and profiles before starting a new calculation.
Completed reference runs retain their original IDs, values and sources. Opening
a project does not rerun them.

Keep original source manifests and companions with their received editions.
For a new source selection, use the original operator's normal close/open
boundary. Complete backup/restore stays with the maintained portable receiver,
which restores into a new destination and preserves existing work.

## Source integration and the existing receiving operation

The recipient-workbench-opening component includes open_received_study.py,
workbench_session.py and this guide, plus the current core and native-runtime-
invocation dependencies. Compose the complete selected source cohort, including
the current root collection opener, receiver, capsule, platform backend and
source admissions. Do not replace newer peer files with an earlier whole bank.

Apply CURRENT_OWNER_DIRECTION.md version 2026-10-14.1 and AGENTS.md. The existing
Windows owner operates the affected native startup, double-open reuse, browser
failure/manual opening, ordinary close/reopen and private API export against the
qualified seven-workspace collection. The existing Mac receiving owner uses the
same selected source with its actual native runtime. Preserve the original
82 saved runs and current job identities.

Open and LOOK at the actual outgoing application and its exported files, use its
important controls at desktop and 390-pixel widths, and fix concrete defects.
The current source/receiving operation carries that work; no new controller,
scheduler or separate review product is introduced.

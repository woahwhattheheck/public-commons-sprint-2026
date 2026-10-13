# Open and reopen the original scientific workbench

This is the maintained recipient launcher for the complete original application.
It opens `operator/server.py`, retains that server's queue and source/project
identities, and reopens a verified existing local session. It does not run a
model while opening, acquire a runtime, or publish a cloud address.

## First opening on the receiving machine

Extract the complete delivered project. Keep its `application/` and
`workspace/` together. Select an actually installed Python, not a path copied
from another worker.

```sh
python3 -B /received/project/application/source_tools/open_received_study.py \
  --workspace /received/project/workspace \
  --python /actual/native-runtime/bin/python \
  --native \
  --save-profile /received/project/workbench.json
```

`--native` enters the original server through the maintained
[native invocation](NATIVE_INVOCATION.md). That component selects the chosen
interpreter's own PROJ/GDAL data and checks the original application's native
source immediately before entering the server. Missing InVEST or incompatible
native source is a real startup error; there is no silent alternate engine.

The original plain opening remains available. Omit `--native`, or pass
`--plain` to override a saved native choice. This opens the full original
operator using the selected Python without claiming that native model
dependencies are installed. It preserves the prior launcher's interpreter/GIS
path behavior. This is useful for an existing receiver such as C426 whose
application opens while InVEST is still being transferred. It is not a promise
that **Run all cases** can execute without its required scientific libraries.

Keep the owning terminal open. The launcher opens the original local session in
the default browser. `--no-browser` instead prints the private URL for the
recipient to open on the **same machine**. The printed JSON summary contains no
credential and labels the route `owning-machine-loopback`.

A cloud container's `127.0.0.1` address is not a route on another person's device.
Use the original receiving platform's already-authorized browser/forwarding
route, or restore the complete project on the recipient's machine. This launcher
does not change host binding, create a tunnel, expose a public service, or infer
an external address.

## Reopen without starting a second operator

Use the same saved selection:

```sh
python3 -B /received/project/application/source_tools/open_received_study.py \
  --profile /received/project/workbench.json
```

The launcher reads a private local session record and authenticates against the
actual original `/api/whoami` endpoint. Its Workspace path digest and original
project ID must match. It then opens that same session and returns, leaving the
original owning terminal, task queue and native processes unchanged.

A second launcher never terminates a reused or adopted process. Concurrent
opening is serialized by a private launch lock; the original server also retains
its own operator-state lock. An authenticated mismatch, unexpected response or
timeout is reported rather than treated as permission to start a replacement.
Only a refused connection makes a retained session eligible for ordinary
restart. Unknown earlier sessions still retain the server's original lock.

To check the actual session without starting a process, opening a browser or
printing its credential:

```sh
python3 -B /received/project/application/source_tools/open_received_study.py \
  --profile /received/project/workbench.json --status
```

Exit status 0 means an authenticated matching session; 3 means no verified
retained session (an older unrecorded operator may still be running); 1 reports a configuration/identity/connection error. A status
result is not scientific completion or browser acceptance.

Ctrl+C in the **owning** launcher requests the original server's normal
shutdown. The original `Operator.close()` drains its active task. The launcher
waits and never applies the previous ten-second forced-kill fallback. Do not
close another worker's owning terminal to update source.

## Adopt an already-running original server

Do not restart an active older launcher merely to use this helper. If its
original single-line startup JSON was retained privately, select that file:

```sh
python3 -B /received/project/application/source_tools/open_received_study.py \
  --workspace /received/project/workspace \
  --python /actual/receiving/python \
  --plain \
  --operator-state /actual/existing-private-operator-state \
  --adopt-session /private/original-server-startup.json \
  --no-browser
```

The file must contain the exact original `operator_url`, `workspace_key` and
`project.id`. The URL is accepted only as the original literal loopback address,
and the server must authenticate and report the selected original Workspace.
The helper retains that private session without starting or owning its process.

Adoption does **not** infer the running interpreter, native source or registered
source arguments. Its public summary leaves `python` and `native_invocation`
null and labels `launch_origin=adopted-original-operator`. Therefore adopt with
`--plain` and no new source-root/manifest arguments. The original owner's runtime
and source configuration remain authoritative. Native changes belong to its next
normal shutdown/start boundary.

Never paste the startup receipt or token-bearing session URL into shared Slack,
a public repository, a source bank, a customer archive or the portable profile.
The default private state is under the receiving user's local state directory,
keyed by the actual Workspace path. An explicit `--operator-state` must remain
outside both application and scientific Workspace. Symlinked state roots resolve
to their actual destination before this check; private session files cannot be
symlinks. POSIX private directories/files use 0700/0600.

## Portable configuration and independent restored projects

`workbench.json` contains only:
- original project ID;
- application, Workspace and Python selections;
- plain/native choice and requested local port;
- optional original source manifest/directory selections.

Paths **inside** its directory are stored relative to that directory. External
dependencies remain explicit receiving-machine paths; they are not secretly
included in the project. Move the whole project directory, then reselect an
external runtime when necessary:

```sh
python3 -B /new/location/project/application/source_tools/open_received_study.py \
  --profile /new/location/project/workbench.json \
  --python /this/machine/native-runtime/bin/python --native
```

Command-line `--application`, `--workspace`, `--python`, `--native/--plain`,
`--port`, `--source-manifest` and `--source-root` override the corresponding
saved choice. Relative command-line paths belong to the current shell; saved
relative paths belong to the profile. `ECOSYSTEMS_PYTHON` is another explicit
receiving-machine interpreter override. A virtual-environment executable keeps
its symlink path so its environment is not replaced by the base Python.

The project ID still must agree. To select a different scientific project,
create a new profile instead of rewriting that original binding. Saving is
create-only:

```sh
python3 -B application/source_tools/open_received_study.py \
  --workspace workspace --python /actual/python --plain \
  --save-profile workbench-new.json --configure-only
```

`--configure-only` creates the selection without starting any server.
`--save-profile` never replaces an existing file. Private operator state and
credentials are never written into the profile. Keep an intentionally selected
external state directory separate when copying a project.

The original restore operation remains in [NATIVE_INVOCATION.md](NATIVE_INVOCATION.md):
restore the complete native ZIP into a **new** project directory, then launch its
actual `application/` and `workspace/`. Original completed teaching, regional,
input-response, observation and Community editions retain their different project
and source identities. This helper never substitutes one for another.

## Continue the real model-running workflow

Open the existing Parameter studies view in the original operator. Inspect the
retained baseline and completed cases, choose explicit new input/profile values,
preview and save a new selection, and use **Run all cases** on the existing queue.
Inspect real progress, results, maps, source assumptions and difference GIS;
download and reopen the complete working project. Original completed runs remain
retained and reusable. Source inspection, an authenticated HTTP response and an
open static report are not a native model run.

For sources offered by receiving desks, preserve the original complete manifests
and companions. `--source-manifest PATH` and `--source-root DIRECTORY` repeat
normally and are passed unchanged to the original server. They are remembered
in a saved profile. Changing them while another matching private state is active
requires that owner's normal source boundary; no live process is replaced.

## Installation and exact dependency closure

Use the complete `recipient-workbench-opening` component. It carries:
`source_tools/open_received_study.py`, `source_tools/workbench_session.py`,
this guide, and the original `native-runtime-invocation` dependency with its
complete capsule/probe/transport source. The original server/model source stays
in `core`. Taking only a new launcher without its helper is incomplete.

For an active old operator, stage the complete new source without modifying its
running scientific state. Reopen/adopt its private original receipt as above, or
use the successor after its normal close. Preserve newer peer source while
composing the component; do not overlay an old application-wide source bank.

A focused standard-library course is retained at
`tests/test_workbench_session.py`. It exercises this exact launcher helper
against a clearly authored small original-protocol HTTP fixture: real process
startup, authenticated reuse/adoption, rejection of another project, create-only
profile and copied-directory relocation. It is not an InVEST calculation,
full-application acceptance, browser operation or scientific result.

## Current owner direction and actual receiving

The October 13 post-call campaign (original Eco reply
[1791909259.200039](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791909259200039?thread_ts=1791724121.853269))
renews the broad build: finish a genuinely runnable original workbench and actual
recipient opening route, expand explicit native scientific case/source families,
join richer observations and physics comparisons, and provide one editable
complete handover for Bryce to select. The earlier 14UTC checkpoint is historical.
Preserve accepted teaching12, regional12 and later 38F0 studies; new assumptions
receive new identities. A missing dataset blocks only its dependent calculation.
Use the actual session's advertised execution tools and real runtime, not an
imagined connection to another worker's hostname. Keep the existing owners and
active processes. No external Tim send is authorized.

The actual receiving course remains original 7072/7680, launcher owners
7E42/38F0/ASTRA13 and C426's already-restored application. Original C426
1791910109.836009 reports a running operator while native InVEST acquisition is
unfinished. A later runtime/browser failure does not authorize replacing that
process or claiming a reachable recipient route. Return the precise actual
exception through the same operation and continue independent source work.

Apply [AGENTS.md](../AGENTS.md), the complete maintained
[owner direction](../CURRENT_OWNER_DIRECTION.md), and the post-call renewal:
the producing worker opens and actually LOOKS at the outgoing application and
all attachments, operates the real controls at desktop and narrow widths, fixes
actual defects, downloads and reopens the working files, and records the precise
source and observed outcome. Source review, adapter checks or HTTP200 do not
substitute for that use. Preserve lab attribution, source licenses, no private
GitHub/Actions, no llama.cpp, scientific distinctions and contact/meeting holds.
Browser operation remains subject to the actual current owner controls on that
receiving session. Cloud workers use their own permitted isolated browsers and
VMs; this guide does not grant or change browser access.

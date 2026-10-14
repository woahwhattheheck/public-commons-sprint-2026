# Collection opening and local API guides

ECO-OPENING-GUIDANCE-D42 / 1.1.0. This completes the recipient guidance and live-session
API entry of approved portability items 57 and 59. Read CURRENT_OWNER_DIRECTION.md
version 2026-10-14.1 and the project AGENTS.md. Retain all seven original Workspace
entries and 82 completed scientific runs in the final release.

## Assemble the existing collection

Join the complete application and the maintained Windows/Mac root opening component
first. Retain its `STUDIES.json`, original Workspace identities and selected runtimes.
Then use the assembler's Python from the application directory:

```sh
python -B source_tools/collection_opening/build_guides.py /path/to/complete-collection \
  --output /path/to/new-opening-guides
```

The output contains START_HERE.html, API_QUICKSTART.html and OPENING.txt. GUIDES.json
binds their exact hashes to the input collection manifest. The destination must be
new, including when it is an empty directory. The generator preserves input data,
source, private state and existing output directories. A completed GUIDES.json is
written last. Regenerate against a new output directory after changing STUDIES.json.

The existing final assembler places the three generated guides at the collection
root beside Open_Workbench.cmd and Open_Workbench.command. Preserve any advancing
root-guide edits through normal source composition. Do not copy generated guidance
from another collection: included titles, study families and own-data selection are
read from the actual input. The original studies may have different counts during
intermediate assembly; this tool does not invent missing entries or results.

The current receiving layout may keep original Workspaces inside native archives.
The generator follows STUDY_PAYLOADS.json and reads their original metadata through
model.portable.inspect_archive without extracting or re-running them. It supports
the retained own-data row in studies as well as receiving_workspace. Distinct
original directories may keep the same project ID across retained editions.
The API reader uses the maintained session.state_directory and its existing Mac
state migration; older R5/Linux source retains its original fallback location.

The documents use local relative navigation and no network assets or live/development
addresses. OS switches and troubleshooting panels are usable offline. They explain
that opening a static guide does not execute a launcher or start a local server.

## Use the live read-only API

Open the complete collection through its existing root launcher. Run this with the
same received native Python (or a compatible existing development Python):

```sh
RECEIVED_PYTHON -B application/source_tools/collection_opening/session_api.py /api/whoami
RECEIVED_PYTHON -B application/source_tools/collection_opening/session_api.py /api/state --query compact=1
```

RECEIVED_PYTHON stands for the interpreter's path. Quote paths containing spaces.
The helper uses the collection's own application, original selection, private session
record and maintained workbench_session.existing_session/_request functions. It does
not start a server, modify a study, execute a native model or expose its capability.
A closed session gives the actual root-opening recovery instruction. An explicit
--operator-state selects the same private folder used by a custom launcher invocation.

The supported routes are the current whoami/state/extensions/runtime/task/native-job/
run-log GET routes. Use a Workspace id returned by whoami, not a hard-coded directory
hash or another machine's selection. Run-log uses id and optional byte offset. Mutating
operations stay with the maintained application controls and their existing policy.

## Integration and recipient use

This additive component does not alter the maintained root launcher, runtime builder,
scientific source, workbench_session or central installer. Its component fragment
keeps all source files and this guide together. The application-level START_HERE.md
leads with the delivered native collection and retains all developer/method sections.
The existing installer owner can admit this complete source cohort into its cumulative
packet; final assembly generates the three root guides after the exact collection join.

Open the generated files in the browser at desktop and narrow widths, use OS switches,
troubleshooting panels and all local navigation, and exercise the helper against the
running original application. Keep that work focused. Native Windows/Mac application
opening remains part of the existing complete release course; no replacement server,
new runtime, broad suite, hosted Actions job or recipient contact is introduced.

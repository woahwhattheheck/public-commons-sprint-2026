# Forms workspace — retained upload and complete source continuation

This edition repairs the original prepared browser upload and narrow inspector layout, and supports updating the same workspace while retaining complete original and maintained source editions. The full product remains 42 files.

| Current artifact | Identity |
| --- | --- |
| Source files | 42 files; 1300320 bytes |
| Forms_Workspace_Source.zip | 343864 bytes; SHA256 5edb57e1efed1edb3179c33faf1d57bca3cc510c73bb220e3c1ee126ce85643e |
| SOURCE_SELECTION.json | 11304 bytes; SHA256 aa8796fd761f75d7c53107c4360c7c7f08c73b1c36c7f4066f2d327acea929e6 |
| Complete source commit | 1e501124c7ed9d766a3f009d4830f64336817a3c |
| Changed source members | forms_workspace.py, forms_workspace_server.py, forms_server.py, forms_report.py, forms_workspace_report.py, FORMS_WORKSPACE.md |
| Previous complete release | 8489255dad91a05ac2bd69f3ce650b6c5ed28195 |

Read the updated FORMS_WORKSPACE.md section **Continue an existing workspace after a maintained source update** before operating an existing workspace. Extract this complete ZIP into a separate source directory. The supported adopt-source command preserves its original metadata, source, data and HTTP origin, then retains the complete maintained runtime. Resume the original native/browser operation from its original inputs and profile. Existing completed native A/B/C runs stay selected.

The same prepared upload ID receives404 only if both valid body and receipt are absent, then streams its complete original PUT. One retained regular body or valid receipt returns typed409 UPLOAD_INCOMPLETE: the browser then permits only the same-ID original PUT, and the server compares full byte identity before restoring its missing member. Old inspectors verify their own original selected program and display the retained calculation through the maintained renderer. Full workspace export carries both complete source editions plus continue_workspace.py, which selects the maintained runtime after independent extraction.

The original receiver operates Python and the complete upload→mapping→run→handover course. Open and LOOK at the final desktop and390-pixel screens, every produced image and PDF page, all complete JSON, both ZIPs and their member inventories. The source package below contains complete runnable files and fixtures.

## Previous release guide — retained in full

The remainder preserves the predecessor's complete guide and original release identities. Its original42-file source/ZIP references describe the previous edition; use the current identities above and the updated product guide for same-workspace source adoption.

# Forms source and mapping workspace — complete source and receiving

TokenJunkieLabs

This complete application brings retained form definitions, settings, responses, uploads, workflow records and downstream receipts into a private mapping workspace. Operators inspect original files, save complete unfinished mapping text, compare exact source and target records, reconcile attachment bodies and parents, calculate immutable editions, and hand over the whole source, history and program.

The new authoring workflow includes explicit following-capture review, historical draft selection, concurrent-tab recovery, original request replay, complete workspace export and independent receiving. Its Customer Installation bridge selects an actual completed run and prepares the original native Installation preview without writing a separate commercial or acceptance outcome.

## Complete selected source

| Artifact | Identity |
| --- | --- |
| Product members | 42 complete files; 1,280,112 uncompressed bytes |
| Forms_Workspace_Source.zip | 283,607 bytes |
| ZIP SHA256 | d14139ceeccdd718bab35cad7e7fc3192dee2fe90d29bf417d31d2da0e9ff38a |
| SOURCE_SELECTION.json | 11,013 bytes |
| Manifest SHA256 | d9a00450383c4c8d5dc9afd7c477c1e30dfaf523bcd990696058763a881c2fda |
| Original unchanged product | All 33 files from public Forms release b32bbb8ff11067f41203194c6e2aa8fde06e18e9 |
| New source | Workspace core/API/guide, server/interface/browser course, native receiving course, Installation adapter/guide |
| License | Original MIT LICENSE, included once |

SOURCE_SELECTION.json declares every member's complete path, regular-file mode, UTF-8 size, SHA256 and Git blob identity. It also names the five exact reviewed source selections. source-package.json binds the ordinary artifacts and records the actual source-packaging state.

The maintained source path is tools/forms-migration-e258-20261013. These four new receiving artifacts belong to operations/forms-workspace-receiving-e258-20261013. The earlier operations/forms-migration-receiving-e258-20261013/Forms_Source.zip remains its original 33-file edition. A source-selected earlier queued operation must not silently receive a different program.

All eleven original discovery source, documentation, receiving and fixture files remain byte-for-byte intact. The generic invented demonstrations contain no private prospect correspondence, tenant credentials or customer commercial terms. Keep actual customer captures and resulting workspaces in their original authorized private custody.

## Read the operating guides

Start with FORMS_WORKSPACE.md for the whole authoring workflow. FORMS_INSTALLATION.md explains the selected-run source and original Operations preview/save boundary. FORMS_CAPTURE.md and FORMS_CAPTURE_API.json define original acquisition and explicit source limitations. FORMS_WORKBENCH.md explains the complete native reconciliation, per-asset coverage and attachment-parent semantics.

The source ZIP's README.md and OPERATOR_GUIDE.md preserve the original discovery program's documentation. This outer README opens the complete current workspace. All documents travel with the selected program.

## Verify and receive the whole software

Save Forms_Workspace_Source.zip, SOURCE_SELECTION.json, source-package.json and this README together. Use a new source directory. The following Python standard-library receiver verifies the ZIP, full member inventory, regular-file modes, byte counts, SHA256 and Git identities before publishing the source directory.

```bash
python - /absolute/release /absolute/new-forms-workspace-source <<'PY'
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import shutil
import stat
import sys
import tempfile
import zipfile

release, output = map(Path, sys.argv[1:])
release, output = release.resolve(), output.resolve()
archive = release / "Forms_Workspace_Source.zip"
manifest_path = release / "SOURCE_SELECTION.json"
assert not output.exists(), "Select a new complete source directory"
assert hashlib.sha256(archive.read_bytes()).hexdigest() == "d14139ceeccdd718bab35cad7e7fc3192dee2fe90d29bf417d31d2da0e9ff38a"
assert hashlib.sha256(manifest_path.read_bytes()).hexdigest() == "d9a00450383c4c8d5dc9afd7c477c1e30dfaf523bcd990696058763a881c2fda"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
expected = {row["path"]: row for row in manifest["files"]}
assert len(expected) == len(manifest["files"]) == 42
output.parent.mkdir(parents=True, exist_ok=True)
stage = Path(tempfile.mkdtemp(prefix="." + output.name + "-", dir=output.parent))
try:
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        assert len(entries) == len(expected)
        assert {item.filename for item in entries} == set(expected)
        for item in entries:
            rel = PurePosixPath(item.filename)
            assert not rel.is_absolute() and "\\" not in item.filename
            assert all(part not in ("", ".", "..") for part in item.filename.split("/"))
            mode = item.external_attr >> 16
            assert not item.is_dir() and stat.S_ISREG(mode)
            row = expected[item.filename]
            body = z.read(item)
            assert len(body) == row["bytes"]
            assert hashlib.sha256(body).hexdigest() == row["sha256"]
            git_body = b"blob " + str(len(body)).encode("ascii") + b"\x00" + body
            assert hashlib.sha1(git_body).hexdigest() == row["git_blob_sha"]
            target = stage.joinpath(*rel.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
    os.rename(stage, output)
finally:
    shutil.rmtree(stage, ignore_errors=True)
print("Received all 42 selected source members:", output)
PY
```


The result is a verified software selection. Actual native calculation, browser operation and visual inspection have their own retained outputs.

## Runtime and ownership

Use a Linux host with an existing Python 3.11 or later interpreter and SQLite. The native application, collector, calculation and archive receiving use the standard library. Process recovery reads the original host's Linux process identities and boot identity.

For browser receiving, supply the actual existing Node runtime, installed Playwright module and compatible Chromium binary. The source does not install software or contact a tenant during the invented receiving course.

The original authoring receiving operation is FORMS-AUTHORING-WORKSPACE-RECEIVING-E258-20261013. Keep it distinct from the earlier FORMS-WORKBENCH-RECEIVING-E258-20261013 engine course, the Water course and WATER-MIGRATION-RECONCILIATION-E258-20261013. Preserve every earlier input, selected source and accepted owner.

Choose one coordinated equipped receiver and preserve one private native operation directory. Keep generated data and process receipts outside the software directory. The workspace uses an exclusive native writer lease; close its real server before a separate mutating CLI opens that same workspace. The server and CLI are operating surfaces for the same native owner. An equipped owner may accept this self-contained native Python course in a separate directory while its unrelated browser work continues, when host resources permit. It must not share another operation's data, browser profile or listener ownership.

Preserve private loopback capabilities and original browser profiles. The service retains its original local port/token so ordinary restarts reopen the same browser state. A port collision is reported rather than silently creating another origin.

## Run the complete authoring course

Use the complete verified source, a new private operation directory and the existing interpreter:

```bash
export PYTHONDONTWRITEBYTECODE=1
python /absolute/forms-workspace-source/receiving_forms_workspace.py \
  --directory /absolute/new-private-forms-workspace-operation \
  --keep-server
```

This is the existing source-native receiving workflow extended through the full authoring workspace. It materializes all three complete invented Forms editions from the unchanged FORMS_EXAMPLES.json, performs actual local-only capture and full capture archive receiving, and imports those originals into one native workspace.

The course operates:

- The original mapping-required worksheet, full CSV scanning/paging and complete unfinished raw text.
- Exact saved draft revisions, native validation and stale-save rejection.
- Explicit following-capture review and preservation of original source bindings.
- Complete native calculation, source/project verification, full project ZIP and independent project receiving for A, B and C.
- The actual Installation adapter selection and full saved JSON for every completed run.
- Reopening A's selected-run source after later drafts, preserving the same immutable completion binding.
- Whole workspace export, independent receiving, and actual execution of the program received inside that workspace.
- A complete received-program draft continuation, full successor export and a second independent receive.
- Actual original HTTP metadata, run/request phases and full project archive downloads.

| Edition | Selected invented meaning |
| --- | --- |
| A | Row differences, ambiguous identities, unavailable/redacted bodies, attachment-parent failures and unassessed or partial coverage |
| B | Corrected response/attachment population with explicit remaining workflow/downstream coverage dispositions |
| C | Matching supplied comparisons and complete declared demonstration coverage |

The course does not create a vendor staging environment, call a tenant, create a priced Workshare, save an Operations Installation or mark a human acceptance accepted. Those outcomes require their real selected sources and original native owners.

A successful receiving.json records NATIVE_COMPLETE, exact source and archive identities, the actual A/B/C runs and retained Installation selections, whole-workspace independent/cold receiving, and its actual server receipt. With --keep-server, that original server remains available to the browser course.

## Resume the original operation after interruption

Keep the entire original directory, input receipt, database, captures, logs, artifacts and process records. Repeat the same native command against that directory and the identical selected software. The native helper has no separate --resume flag.

It verifies already published archives and restores missing external receipts from their actual complete contents. Before HTTP admission it retains native-before-http.json, so an interrupted HTTP opening does not rerun the native calculations.

Server admission has one retained opening, exact argument vector and unique receipt path. Recovery checks the same host and boot, actual process start identity and complete command. One matching live original process is adopted and its original receipt is awaited. Multiple matches stop with the existing evidence intact. An observed absence is retained before another listener is admitted. This protects a process launched immediately before its parent's reply was lost.

An original receipt is checked against the full selected source, actual native workspace and real HTTP identity. No unrelated process is signalled. A surviving original listener continues the same operation. A completed kept-server receipt is never described as live merely because its JSON exists.

If a completed course's kept server has subsequently stopped, preserve its completed receiving.json and use the documented original server reopening command with a new receipt. Do not edit an old completed receipt or invent a new native completion. The browser helper binds the exact supplied native receiving and server record.

The workspace itself retains original mutation IDs and full bodies. An uncertain request is recovered through that same identity. A deterministic failed request remains recorded; a corrected deliberate action is a new request with its previous history preserved.

## Operate and view the actual browser product

The authoring browser helper consumes the completed native receiving.json and its actual kept server. It does not own another native case or start a replacement authoring server.

```bash
node /absolute/forms-workspace-source/receiving_forms_workspace_browser.mjs \
  --receiving /absolute/new-private-forms-workspace-operation/receiving.json \
  --directory /absolute/new-private-forms-workspace-browser \
  --playwright /absolute/installed/playwright/index.mjs \
  --chromium /absolute/installed/chromium
```

After an interruption, use the identical browser command, selected runtime paths and output directory with --resume. Keep its persistent browser profile, original input identity, completed steps, full downloads, earlier attempts and failures.

The browser course operates the actual workspace's capture/source inventory, original CSV controls and records, saved mappings, native draft/history and original requests. It opens the original calculated-project inspector, retains browser alternatives, downloads complete working-copy and project/workspace files, and reopens imported working copies in its persistent browser. The native course separately performs independent project/workspace receiving. In Calculated editions, use Open received inspector to inspect that independently received project as well. The course captures the real desktop and narrow layouts.

The operator must open the exact produced PNGs and inspect their pixels, open every outgoing PDF page, use important controls and keyboard navigation, and reopen the full downloaded JSON/ZIP contents and native history. Observe unresolved and corrected states from the original A/B/C editions. Source syntax checks, successful HTTP responses and merely creating screenshots do not establish visual completion.

Keep the complete standing producing-peer instruction in FORMS_WORKSPACE.md active. It applies to every outgoing attachment and to final audio/video playback where present. Preserve user tabs, current local/cloud browser ownership and original process custody. Repair actual clipped, broken, unreadable or incomplete output before presenting it.

## Operate a real authorized source

Actual source capture begins with its explicit authority and reviewed population, not the invented examples. Use the existing collector selection and documented GET-only routes or exact local originals. Retain all six classes, original raw pages, returned ZIP-pointer response, complete actual ZIP bodies, unavailable declarations and failed attempts.

Repeated CSV rows do not prove API response count or pagination completeness. Earlier field versions and workflow history remain explicit source questions. No field/parent mapping is inferred from a filename or ZIP member name. Keep tokens in their existing authorized environment variable, never in provenance or a portable URL.

Create the native workspace and import a complete verified capture:

```bash
export PYTHONDONTWRITEBYTECODE=1
python /absolute/forms-workspace-source/forms_workspace.py init \
  --workspace /absolute/private/forms-workspace \
  --label "Selected forms migration"
python /absolute/forms-workspace-source/forms_workspace.py import-capture \
  --workspace /absolute/private/forms-workspace \
  --archive /absolute/private/Complete_Capture.zip \
  --request-id original-capture-request
python /absolute/forms-workspace-source/forms_workspace_server.py \
  --workspace /absolute/private/forms-workspace \
  --receipt /absolute/private/controls/forms-server-first.json \
  --port 0
```

Use the complete private origin from that actual receipt. The browser upload route streams large complete archives and retains an original upload identity. The existing default upload/expanded receiving selection is 20 GiB; an adequately sized full-workspace receive can select a larger explicit --max-bytes where appropriate.

Inspect the actual CSV encoding, delimiter and quote character before assigning ordered columns, keys, types and null interpretation. Retain complete raw intake text and extra interpretation fields. Save unfinished text as a native revision; native structured validation and full calculation remain separate operations.

Every following capture and source/target mapping change is explicit. The native original scope, per-asset content coverage, class/side bindings, row identities, exact decimals, and attachment body/parent checks remain authoritative. Filters change the displayed view, not the full population.

## Export, independently receive and continue

Use the server's complete handover control while it owns the workspace, or close it and use the original CLI:

```bash
python /absolute/forms-workspace-source/forms_workspace.py export \
  --workspace /absolute/private/forms-workspace \
  --output /absolute/private/delivery/Forms_Workspace.zip
python /absolute/forms-workspace-source/forms_workspace.py receive \
  --archive /absolute/private/delivery/Forms_Workspace.zip \
  --output /absolute/private/received-workspace \
  --max-bytes 21474836480
python /absolute/private/received-workspace/software/forms_workspace_server.py \
  --workspace /absolute/private/received-workspace \
  --receipt /absolute/private/controls/received-server.json \
  --port 0
```

The received program retains the same workspace identity, every complete native raw revision, original capture, computed/independently received project, request/result/phase, archive and all 42 source files. Its actual host controls and browser origin are local to that receiving host.

The inner calculated Forms project still carries its original 26-file application selection. The outer authoring workspace carries all 42 files and full multi-edition history. Neither a compact source selection nor a project summary substitutes for those complete original archives.

## Original Customer Installation integration

Read FORMS_INSTALLATION.md before calling the adapter. Through the already-owned native Workspace, inspect_workspace(workspace, run_id) verifies the original completed request, exact historical draft/capture, full project and complete source-bearing ZIP. source_bytes(selection) emits the complete compact selection. Retain its exact bytes and source SHA together with the separately retained full original project archive.

The original Operations engine is a separately selected installed application; this standalone package does not duplicate it. Supply its actual original instance and case/source/version to prepare_operations. The adapter recomputes the real selected run, matches the attached exact source and returns the original native Installation preview and save inputs.

Preserve real commercial/Workshare/payment/deployment fields and OPEN receiving/acceptance checks. The adapter does not create a case, attach source, commit an Installation or mark customer acceptance. The original native writer performs any actual authorized save after the operator reviews that exact preview.

## Delivery state

All 42 selected source bodies and the ordinary ZIP are fully retained and independently checked. The source review covers the complete workspace, capture, mapping, source-rebinding, native/portable receiving, Installation source, browser and process-recovery joins.

Native receiving, browser operation and actual visual observations remain the existing coordinated receiver's work until its real receipts and viewed artifacts return. Preserve those evidence distinctions in the original operation. Do not send a customer attachment or infer a migration/acceptance outcome from this source package.

# Complete forms migration workbench — source and receiving

TokenJunkieLabs

This is the complete generic application for retaining selected form definitions, settings, responses, uploads, workflow records and downstream receipts; applying explicit source/target mappings; reconciling returned records and attachment parents/bodies; and handing over the whole editable project with its original evidence.

The ordinary Forms_Source.zip contains 33 full product files, including the unchanged original discovery-engine source and demonstrations, the maintained migration calculator and inspector, the complete forms collector/workbench/server, the forms inspector, operator guides, API contracts, native/browser receiving helpers, all three complete authored forms editions, and the original MIT LICENSE.

Read FORMS_WORKBENCH.md first for the six-class operating flow. FORMS_CAPTURE.md covers original-source selection and documented API export limitations. FORMS_RECEIVING.md carries the full native and browser course. README.md and OPERATOR_GUIDE.md inside the source ZIP deliberately preserve the original discovery program's documentation unchanged.

## Exact selected release

- Product source members: 33.
- Complete source bytes: 1006907.
- Ordinary source ZIP: Forms_Source.zip, 202855 bytes.
- ZIP SHA256: 8c5630af47d80a198b26175251fa621a0c1ac04be562668d6c50110528680e32.
- SOURCE_SELECTION.json: complete path/size/SHA256/Git-blob inventory.
- SOURCE_SELECTION.json SHA256: 897e021a00c597b81914ff0fa907024e43ead2682a814784cc2e0db1d15a67c5.
- source-package.json: source/artifact identity and actual source-review versus runtime status.

The complete source inventory preserves the 20 selected original members from public migration release bdea4b5b7f08b3ed3a4ecf43ba8a947cd2444046. All eleven original discovery source/guide/receiving/fixture members remain byte-for-byte intact. The new generic source contains invented demonstrations and public API knowledge, without any original prospect files, credentials or customer commercial terms.

The 33-file public source ZIP is distinct from a later private capture archive or complete forms project archive. Those later archives carry the actual selected original data and source identities. Preserve them under the original authorized case.

## Open and verify every selected source member

Save this README, SOURCE_SELECTION.json, source-package.json and Forms_Source.zip together. Choose a new source directory and preserve the ZIP and manifest. This standard-library receiver checks the complete ZIP and every declared member before publishing that directory:

```bash
python - /absolute/release /absolute/new-forms-source <<'PY'
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
archive = release / "Forms_Source.zip"
manifest_path = release / "SOURCE_SELECTION.json"
assert not output.exists(), "Select a new complete source directory"
assert hashlib.sha256(archive.read_bytes()).hexdigest() == "8c5630af47d80a198b26175251fa621a0c1ac04be562668d6c50110528680e32"
assert hashlib.sha256(manifest_path.read_bytes()).hexdigest() == "897e021a00c597b81914ff0fa907024e43ead2682a814784cc2e0db1d15a67c5"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
expected = {row["path"]: row for row in manifest["files"]}
assert len(expected) == len(manifest["files"]) == 33
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
print("Received all 33 selected source members:", output)
PY
```

This verifies software receipt. It is not a native application, API export, browser or visual result.

## Run the complete original demonstration course

Use an existing Python 3.11 or later interpreter with SQLite. The application and capture/native course use the Python standard library. No database server, tenant credentials, subscription, account creation or package installation is required for the invented course.

Choose one coordinated equipped receiver and one preserved private operation directory. Keep source and operation outputs separate. The native course itself creates its original local process lock and source-bound input receipt.

```bash
export PYTHONDONTWRITEBYTECODE=1
python /absolute/forms-source/receiving_forms.py \
  --directory /absolute/new-private-forms-receiving \
  --keep-server
```

The actual course materializes the full FORMS_EXAMPLES.json members, receives all selected local originals with requests:[], verifies and packs each capture, receives each capture independently, runs all three mapped forms projects, packs and independently receives each full project, then reruns the final received software against its original retained files. It exercises every forms page API, all original bodies and full exports, and parent-record drilldown. No real tenant request is made.

The three authored editions carry different useful operating states:

| Edition | Meaning |
| --- | --- |
| A | Source/target row differences, ambiguities, missing/redacted bodies, exact attachment-parent failures, partial history and unassessed content |
| B | Corrected returned response/attachment population with explicit partial workflow and deferred downstream coverage |
| C | Complete supplied demonstration coverage and matching selected comparisons |

These labels describe invented selected inputs. They do not establish a supported customer historical importer, actual staging outcome, human acceptance or production authorization.

On successful native completion, receiving.json contains actual project/capture/archive/source identities and both A/C server receipts. It reports NATIVE_COMPLETE while visual review remains pending. Do not substitute a source-review result or a prepared command for that receipt.

If interrupted, retain the entire operation directory, logs, captures and outputs. Resolve the original process ownership before continuing the same directory. The course reuses and verifies existing original artifacts. It does not create a second company case or relaunch tenant work.

## Operate the real inspector and actual exported files

Read receiving.json and select each actual A/C server receipt. Each has its real private origin, workspace URL, project identity, selected archive identity and owned PID. Do not invent a port or access token.

Use the receiver's actual installed Node Playwright module and compatible Chromium binary. The browser helper consumes the already-running original server; it does not start or stop it or install dependencies.

```bash
node /absolute/forms-source/receiving_forms_browser.mjs \
  --server-receipt /absolute/actual-server-a-receipt.json \
  --directory /absolute/new-private-browser-a \
  --playwright /absolute/installed/playwright/index.mjs \
  --chromium /absolute/installed/chromium
```

Repeat with the actual C receipt and a distinct browser-C output directory. The same application must be operated across unresolved and corrected views. A C-only run does not cover A's missing, partial, redacted and ambiguous cases.

The browser course operates the six-class overview, full originals, attachments and their exact parent rows, findings and per-asset coverage, source/migration inspector, named working copies and revision history, complete editor text, import alternatives, concurrent-tab recovery, full downloads, narrow layout and cold reopen. It retains actual screenshots, PDF, receipts and complete downloaded files.

Open the actual resulting images and PDF and inspect their rendered pixels. Open every outgoing attachment, full source export and archive, and inspect the full member inventory. Reopen the exact downloaded working archive and source-selected project. Use keyboard controls and narrow-screen views. Play any outgoing audio/video present in an actual authorized project. Preserve existing user tabs and current owner browser instructions.

Actual visual observations are a separate receiving step. Record focused defects and repairs from the exact outgoing edition. Source parse/checks or creation of an image file alone cannot close that step.

## Open a real selected case or a received project

Actual customer use begins with explicit authority and a complete source selection. Keep tenant tokens only in the authorized existing environment variable. The collector exposes documented GET routes and no mutation/account setup route. Individual pages, original ZIP-pointer responses, exact attachment archive members and failed attempts remain intact.

CSV repeat rows cannot be used as response-count or pagination-completion evidence. Earlier field versions, workflow history, redactions and supported historical import routes remain explicit source questions. Preserve authoritative response/attachment membership and supported routes as original evidence. The collector never guesses CSV mappings or attachment parent identities.

Read FORMS_CAPTURE.md for the full selection contract. Run a local or authorized GET capture and build a new explicit intake from mapping-worksheet.json plus original mapping decisions. Bind every selected CSV table to its original asset and every upload to its exact parent row, canonical form/response/field and repeat ordinal. Keep opaque originals across all six classes alongside the projected comparison tables.

```bash
python /absolute/forms-source/forms_workbench.py run \
  --intake /absolute/private/intake.json \
  --input-root /absolute/private/capture \
  --output /absolute/new-private-project
python /absolute/forms-source/forms_workbench.py verify \
  --project /absolute/new-private-project
python /absolute/forms-source/forms_workbench.py pack \
  --project /absolute/new-private-project \
  --output /absolute/private/Complete_Forms_Project.zip
python /absolute/forms-source/forms_workbench.py receive \
  --archive /absolute/private/Complete_Forms_Project.zip \
  --output /absolute/new-private-recipient
```

The complete project contains its selected application, original files, intact intake, editable receiving intake, original migration case, indexed forms findings and full exports. Reopen it through its actual received software:

```bash
export PYTHONDONTWRITEBYTECODE=1
python /absolute/new-private-recipient/workbench/forms_server.py \
  --project /absolute/new-private-recipient \
  --archive /absolute/private/Complete_Forms_Project.zip \
  --receipt /absolute/new-private-server.json \
  --port 0
```

The receipt is outside the immutable project. Use its exact private workspace URL. The server is read-only; browser edits are local named intake copies that can be downloaded and computed as a new immutable project. Keep earlier projects and full unfinished drafts rather than rewriting their source identity.

Project coverage, computed differences, human acceptance and vendor migration remain distinct. The original account/form owner controls any live source changes. Any contractual signature or further warm customer message remains with the original authorized sender and its exact approval process.

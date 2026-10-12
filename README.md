# Original NCT03529110 Research source edition

This checkout contains the complete original 634-file Research programme and all three retained study inputs for `DBC61-SCF-STUDY-EXTRACTION-20261012`. Every source member is an ordinary file under `source-complete/`, including the original 518,660-byte BCG reference PDF. The source contributes 9,893,988 bytes and the inputs contribute 123,479 bytes.

F99A owns the original native execution and its existing private programme directory. This source edition gives that operation a direct Git receiving route. The complete installed source selection, original study, request history and programme identity continue together.

## Receive the complete source

Select a new checkout directory as `NCT_PACKAGE`. Keep `NCT_ROOT` set to the original private operation directory retained by F99A, and keep its `programme/` directory. The accepted owner's original operation record supplies that path.

```bash
git clone --depth 1 --single-branch \
  --branch delivery/research-nct03529110-dbc61-20261012 \
  https://github.com/woahwhattheheck/public-commons-sprint-2026.git \
  "$NCT_PACKAGE"

NCT_SOURCE="$NCT_PACKAGE/source-complete"
```

Record the checked-out commit with `git -C "$NCT_PACKAGE" rev-parse HEAD` alongside the original operation. `NCT-SOURCE.json` names all 637 source and input members with their original path, mode, byte count, SHA256 and Git blob identity. The manifest also names the source commits, original installation and execution thread.

The accepting runtime can check the complete received files with its existing Python executable:

```bash
"$NCT_PYTHON" - "$NCT_PACKAGE" <<'PY'
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
manifest = json.loads((root / "NCT-SOURCE.json").read_text(encoding="utf-8"))
for member in manifest["files"]:
    path = root / member["path"]
    data = path.read_bytes()
    if len(data) != member["bytes"] or hashlib.sha256(data).hexdigest() != member["sha256"]:
        raise SystemExit("Source identity changed: " + member["path"])
print(json.dumps({"operation": manifest["operation"], "files": len(manifest["files"]),
                  "sourceFiles": manifest["sourceFiles"], "inputFiles": manifest["inputFiles"]}))
PY
```

The Git checkout has already installed the ordinary source files; the prior multipart join and materializer remain available in the original installation delivery for runtimes using that transport.

## Equipped runtime

Use the accepting owner's existing Linux runtime with Node24 or later, Python3.11 or later, openpyxl3.1.5, util-linux flock, Playwright, an actual permitted Chromium executable and the original `@oai/artifact-tool` installation. Preserve `CODEX_PRIMARY_RUNTIME_NODE_MODULES` and the runtime's other actual primary-runtime paths when supplied.

Set `NCT_NODE`, `NCT_PYTHON`, `NCT_PLAYWRIGHT` and `NCT_CHROMIUM` to the observed executable and module paths. `NCT_SOURCE` is this checkout's complete source directory. `NCT_ROOT/programme` remains the original private execution directory, so recovered work keeps its actual requests and checkpoints.

## Run the complete original programme

Dispatch the original entry through F99A's existing native controller under the same operation and original request `research-nct03529110-dbc61-20261012-01`:

```bash
"$NCT_NODE" "$NCT_SOURCE/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/study-extraction-workflow.mjs" \
  --operation DBC61-SCF-STUDY-EXTRACTION-20261012 \
  --run-directory "$NCT_ROOT/programme" \
  --study-file "$NCT_SOURCE/native-inputs/nct03529110/registry-study.json" \
  --provenance-file "$NCT_SOURCE/native-inputs/nct03529110/registry-provenance.json" \
  --projection-file "$NCT_SOURCE/native-inputs/nct03529110/extraction-projection.json" \
  --playwright-module "$NCT_PLAYWRIGHT" \
  --chromium "$NCT_CHROMIUM" \
  --python "$NCT_PYTHON"
```

The entry owns the original application locks, persisted requests, checkpoints, listeners and child cancellation. It binds the saved operation to the retained registry source bundle, resumes its completed stages and verifies saved final artifacts before reusing a completed result.

## Whole customer workflow

The programme loads the retained registry study, provenance and fourteen-row extraction projection. It creates the original questions and eligibility study, records both independent reviews, resolves their discrepancy and publishes the complete first table. All 182 extraction answers and both reviewer histories remain linked to the original occurrence.

It then completes source-bound appraisal through the browser, typed client, installed CLI and Merchant interfaces; creates the Python eligibility customer bundle; reopens complete JSON and gzip packages; continues review and publication in the receiving workspace; and records received appraisal clarification and superseding adjudication.

The workbook continuation exports and receives the complete client workbook, handles reordered headers and user notes, produces the assigned review draft and next template edition, and inspects the actual desktop and mobile browser. Final reports, portable exports, appraisal equality and recurring customer delivery use the actual post-workbook revision in that same receiving workspace.

The source includes the original Research, Developer, Zotero, Python, eligibility and Routescan dependencies and the complete BCG source reference. The original operating and receiving guides remain at their original paths under `source-complete/`.

## Preserve and deliver the result

A completed programme writes `programme/result.json` with state `COMPLETE` and prints the same full result. That result names the dossier and question, original and receiving selections, row lineage, Merchant deliveries, Python customer bundle, workbook exchange, customer updates, appraisal history and complete artifact paths relative to the programme directory.

Preserve the whole programme directory through the existing private delivery route, including customer exports, workbooks, browser images, portable dossiers and requests. Review the actual workbook and browser images, then deliver the complete result and customer files to the [original Research thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791730288879869). Native coordination stays in the [original accepted Muse request](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791821839495009).

The complete source edition derives from canonical product commit `48005bd19bb02b132c282b213294d991891f9651`, product merge `550bcb80a96652459f61b01737ed3ec489da9a7a` and original complete-installation merge `10f0034b738e458269067c303ff8769e5f31125f`. The frozen base envelope is 9,793,396 bytes / SHA256 `2db679fe90edc0f251a62536ec2fd94f5ccd07174b1f3628fcddc50b51ffeab3`; its original twelve-file supplement is 867,421 bytes / SHA256 `9ccc11c1c5ab48cf73c835180ce4b9d2dc4f1591042e6fc4d9e91c6f4b22d691`.

The following Research/Buyer source edition is published separately at [cf46a817](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/cf46a8178bc1f7a34a11f5bd5534891c9cc970b9). Use this original 634-file edition for the accepted NCT phase and the maintained following edition for its next product continuation.

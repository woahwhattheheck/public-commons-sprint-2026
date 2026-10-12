# Project Portfolio: complete native input delivery

This is the complete input selection for `PROJECT-PORTFOLIO-NATIVE-B9D2-20261012`. It contains all 53 application files and the five original MPXJ fixtures in one file. The same existing source and target receiving commands operate on the received files.

## Receive the original selection

Download the adjacent `native-inputs.json` and `receive-native-inputs.py`. From an equipped existing Linux host, run:

```sh
python3 receive-native-inputs.py \
  --input native-inputs.json \
  --sha256 c99e531f129ae6eac3af4a667202223dbba7e5feebb883fdc88ebcc52125edad \
  --directory /ABS/original-portfolio-operation \
  --zip
```

The original directory is the one already selected for this operation. The receiver places this immutable input under `received-inputs/c99e531f129ae6eac3af4a667202223dbba7e5feebb883fdc88ebcc52125edad/` and prints its exact `source_directory`, `upstream_directory`, manifest, receipt and portable input ZIP. Repeating the same command reopens the same files and archive. A later complete source selection uses its own input hash inside the same original operation directory.

All selected file bytes are checked before receiving. All 53 application files, the two binary MPPs and three MSPDI/XML files are also checked against their original Git blob IDs. An existing member with different bytes is reported by path. Source receiving preserves previous operation output.

## Original engine and source

The complete selected application source is `woahwhattheheck/public-commons-sprint-2026` product tree `ee3ea2b28fda07e53106edf9c33c8e1b575f0f45`, built on retained source/input commit `60912c6870ef768c66809857dc457238a4dbaaa9`. The input manifest identifies every original source blob. Selected companion uploads retain their original filename, label and profile as native intake descriptors. Edition responses expose `companion_captures` with a stable `capture_id`, original ordinal and exact profile; a mapping can select the intended capture even when one original file was read through several profiles. Existing saved model bytes and unambiguous source-only mappings retain their original behavior.

Runtime remains MPXJ **16.10.0**, JPype1 **1.6.0**, Java, and the existing Node/Playwright/Chromium installation. The inputs come from unchanged `joniles/mpxj` commit `7ef9e72813d33378c55ec6ceb148cc831ed22033`. The application contains the original MPXJ license and upstream Python setup source. Select the existing runtime paths in the product guides. Source receiving itself uses only the Python standard library.

## Complete existing native workflow

Change to the printed `source_directory` and use the printed `upstream_directory` below. Replace the absolute path arguments with those actual received paths and the original operation directory:

```sh
python3 native_receiving.py \
  --upstream /ABS/received-inputs/HASH/upstream \
  --directory /ABS/original-portfolio-operation/source-native

python3 operator/native/receive.py \
  --workspace /ABS/original-portfolio-operation/target-workspace \
  --source /ABS/received-inputs/HASH/upstream/junit/data/generated/assignment-assignments/assignment-assignments-project2019-mspdi.xml \
  --output /ABS/original-portfolio-operation/target-output \
  --operation-id SENSEI-PORTFOLIO-TARGET-RECEIVING-20261012-B9D2-V1 \
  --node /ABS/existing/node \
  --playwright /ABS/existing/playwright/index.mjs \
  --chromium /ABS/existing/chromium
```

The first command uses the actual engine for original file intake, repeated request recovery, typed native capture, MSPDI writing/readback, task correction and full independent archive receiving. The target command completes the original operator/browser workflow, lost accepted reply recovery, reviewed file target, comparison and acceptance, HTML/JSON handover, desktop and 390-pixel browser views, then archive receiving and cold reopen.

The accepted native operation owns its original workspaces and request IDs. An existing failed step continues through the corresponding original receiver's recovery controls. Complete the same run with the existing source and target output directories, reports, original workspaces, logs and browser artifacts.

## Complete archive and reporting phase

The selected product includes the entire Archive desk, exact cost/work/number measures, original companion capture mapping, relational database and CSVs, full query export, Power Query, Azure SQL, printable reporting and portable source receiving. Use the actual editions returned by the first command for the archive phase. The five inputs below are distinct original native fixture cases; the corrected edition stays in its original comparison flow.

From the same printed `source_directory`, this command reads the actual source result and continues this existing operation. Replace the operation and installed runtime paths:

```sh
python3 - /ABS/original-portfolio-operation /ABS/existing/node /ABS/existing/playwright/index.mjs /ABS/existing/chromium <<'PY'
import json
from pathlib import Path
import subprocess
import sys

operation = Path(sys.argv[1]).absolute()
source_result = json.loads((operation / "source-native" / "result.json").read_text(encoding="utf-8"))
command = [sys.executable, "archive/native/receive.py",
    "--workspace", source_result["source_workspace"],
    "--output", str(operation / "archive-native"),
    "--operation-id", "PROJECT-PORTFOLIO-NATIVE-B9D2-20261012",
    "--node", sys.argv[2], "--playwright", sys.argv[3], "--chromium", sys.argv[4]]
for original in source_result["sources"]:
    command.extend(["--edition", original["edition_id"]])
subprocess.run(command, check=True)
PY
```

The existing browser helper saves and reviews the actual native cohort, publishes all tables and sources, exports a complete SQL result, receives the archive through a fresh desk, rejoins a deliberately lost completed reply, reopens without the intake filename and finally cold reopens the saved reporting workspace. It retains 1440- and 390-pixel views and the complete returned files. The resulting `archive-native/result.json` belongs to the same original Portfolio operation. `archive/native/README.md` documents the saved phase state and continued receiving.

## Exact original inputs

| Original MPXJ path | Bytes | SHA-256 |
|---|---:|---|
| `junit/data/timephased-budget-baseline.mpp` | 354304 | `d5fbe9af23eef3a0c406fc998c9e2593dff153f0c36530fc4ebd540f9c3196f6` |
| `junit/data/calendar-exception-precedence-daily.mpp` | 240640 | `80c9e5106e7d051162231e18a52d49f750b00e092e68e1f23d88671a43b7219c` |
| `junit/data/generated/assignment-assignments/assignment-assignments-project2019-mspdi.xml` | 38478 | `7dd6168f9207c2fb208f67d558c28e781bce67c829035f58dc3b189f2b8ffa3f` |
| `junit/data/baselines.xml` | 24522 | `9c632454fcd628d3adac2706b6424202ebbc06b1eba220a2ef0a709c26c3bcbe` |
| `junit/data/enterprise.xml` | 46339 | `e42a2070396138c8e67d628ec3d0d24ac4c1eebb49d74f95e89ae3e9a003c28f` |

The input JSON is 1731663 UTF-8 bytes. Its exact SHA-256 is `c99e531f129ae6eac3af4a667202223dbba7e5feebb883fdc88ebcc52125edad`. It carries 58 original files totaling 1441036 decoded bytes. Every file's encoding, byte count and SHA-256 is retained in its source manifest.

## Return to the existing workstream

Project and commercial source owner thread: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791809124432919

Existing complete native receiving request: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791818242058689?thread_ts=1791809124.432919

Original Muse routing: https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791818288864899

Return the actual native result and complete files into that existing operation. The archive/reporting continuation consumes the same captured original project editions.

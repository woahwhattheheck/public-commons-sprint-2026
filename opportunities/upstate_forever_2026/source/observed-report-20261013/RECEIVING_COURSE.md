# Continue the accepted scientific report courses together

The existing `receive_operator.py` accepts `--course` to advance an explicit ordered list of original report selections. Every item calls the same single-report receiver, keeps its original output directory and uses its existing source/render/export/backup/restore operation IDs. A completed item reopens the same queue results and files. A missing source receipt or one failed report is recorded while the other independent ready items continue.

This is a native invocation over an explicit course file. Source preparation stays with the original scientific producer. Each completed item contains the complete PDF, HTML, Markdown, report data, report ZIP, original Workspace archive, independent restore and its selected-study receiving result when requested.

## Current original project and three accepted selections

`regional-report-course.example.json` contains the actual source references and original output paths for project **b9d5d257-c6bb-4f07-b975-8e8c63705db3**.

| Course item | Original accepted operation | Original source dependency | Retained output |
| --- | --- | --- | --- |
| Eighteenmile observed report | ASTRA13 0669 and ES26 6537 | `observations/eighteenmile_2023/report_context/model-sources.json` in the current complete application | `astra13-observed-report/operator-receiving` |
| Original source-water geography | Source-water 6180, continuing 2164/3548 | Completed preparation `10e3fd4f…143f26`; the original producer's complete `source_choice` | `source-water-scientific-report/operator-<original report source ID>` |
| Saved receiving-water plan | WATERLINK 4072/7322 | Completed plan `c42b411f…f28a6`; the original CLI's complete `source` | `public-water-scientific-receiving` |

All paths in that example use the actual `/mnt/data/eco-cohort-resume` receiving tree. The original application is `received/application`, Workspace `received/workspace`, and interpreter `/opt/pyvenv/bin/python`. An independently received copy must use its own actual application, Workspace and original operation outputs. Keep its project identity.

The example selects editable study transfer for each report, as specified before the first native launch. If an item already began without that option, use the **false** value from its existing `receiving-selection.json`. Retain all existing title, contact, source order and source paths exactly. Its original single receiver verifies that binding before continuing.

The original standalone CLI output under `observed-report-eighteenmile` remains a distinct completed or continuing output of 0669. This course joins the already-requested saved operator edition; it preserves that standalone report's original directory and version.

## Complete the original source preparations

Receive the current full application family, including the receiving-course fragment and each scientific producer. Keep the current renderer fixes, original source files and selected-study resolvers together. The source preparation commands below reopen existing saved scientific objects.

### Source-water geography

The original source-water command builds or reopens the source of the saved 217 graph and 4/32 prepared areas. Save that complete original result outside the Workspace so the course can consume its exact source selector:

~~~python
from pathlib import Path
from model.common import atomic_json
from model.workspace import Workspace
from model import receptor_report_source

workspace = Workspace("/mnt/data/eco-cohort-resume/received/workspace")
prepared = "10e3fd4fb59c10dfcd4bb3e3b32aacaed003bac941144e9b6985ff9bf6143f26"
product = receptor_report_source.build(workspace, {"preparation_id": prepared})
verified = receptor_report_source.inspect(workspace, product["id"])
assert verified["source_choice"] == product["source_choice"]
output = Path("/mnt/data/eco-cohort-resume/source-water-scientific-report")
output.mkdir(parents=True, exist_ok=True)
atomic_json(output / "source-preparation.json", verified, immutable=True)
~~~

Run this through the existing application's Python context. It is the same maintained producer used by 6180. The course checks the completed state, original project and preparation ID, then derives the same `operator-<product["id"]>` receiving directory used by that accepted course. No report-source ID is fabricated or guessed.

### Saved receiving-water plan

The existing WATERLINK preparation writes its actual result to the path already named by 4072/7322:

~~~sh
/opt/pyvenv/bin/python -B model/receiving_water_report_cli.py \
  --workspace /mnt/data/eco-cohort-resume/received/workspace \
  --output /mnt/data/eco-cohort-resume/public-water-report-source.json \
  prepare \
  --plan-id c42b411feba8fb3df0d4f4e5c9a8a02c0c7885cbf91ddcda4a9d539ccc7f28a6
~~~

If that result is already present, retain it and continue its existing verified source. The course reads its original `source` and title, checks its complete state, original project and exact saved plan, and preserves the accepted report output.

The Eighteenmile typed manifest is imported through the original source queue. It retains its full original source collection and reading order.

## Run the existing receiver once

From the complete application:

~~~sh
/opt/pyvenv/bin/python -B source/observed-report-20261013/receive_operator.py \
  --workspace /mnt/data/eco-cohort-resume/received/workspace \
  --course source/observed-report-20261013/regional-report-course.example.json \
  --output /mnt/data/eco-cohort-resume/scientific-report-course-20261013
~~~

After interruption, repeat the exact command with `--resume`. The course checkpoint directory remains separate from every original report output. Existing original report outputs are resumed automatically, including those created by the earlier individual commands. The course does not move or replace their operator state.

A missing source dependency produces an explicit item result and the next independent report proceeds. After its original producer supplies the missing file, resume this same course. Optional `depends_on` lists can name earlier items when an actual source relationship requires ordering; the supplied three selections are independent.

The command returns 0 when every selected item completes, and 2 when at least one item still needs its original input or a repair. Interruptions propagate after their checkpoint is saved. There is no unattended retry loop.

## Preserved identity and receiving records

The course retains:

- `course-selection.json`: the complete original course, its source file identity and original Workspace.
- `bindings/<item>.json`: exact source-receipt/manifest identities, resolved output, ordered selection, title/contact and selected-study choice.
- `selections/<item>.json`: the immutable original selection passed into the single-report receiver.
- `scientific-report-course.json`: every item's actual state, original operation/edition/task IDs, complete receipt identity and current exception.

The original per-report `scientific-report-receiving.json`, `receiving-selection.json`, progress, operator-state, files and archives stay in their original directories. A result for a different project or Workspace is rejected.

A new or extended explicit course uses a separate course checkpoint directory and may point at the same original report outputs. Those completed operations are still reused. Editing a frozen source selection does not silently repurpose its original operation.

Relative paths are resolved beside the course JSON. An item chooses exactly one of `manifest` (ordered path list), `selection` (original JSON), `selection_file`, or `source_receipt`. A receipt selector is an ordered list of original object keys; its `checks` compare exact retained values. `output_from_receipt` preserves the original producer-ID naming convention using an ordinary filename component. No command or Python import is accepted from the manifest.

## Source and browser ownership

This course joins the current ASTRA13, source-water and WATERLINK scientific-report continuations. Monitoring's existing campaign receiving, the transferred station/assessment/RL/hydrology courses, original native model operations and source assembly keep their current receivers. It adds no competing source preparation or native solve.

Each completed report receipt remains valid input to the maintained `receive_browser.mjs`. The existing authorized browser owner can open that original edition, all original downloads, reordered-source preview and its received selected study. Browser capabilities stay local. Keep the current host's actual browser access policy.

Sources: the accepted native instructions are retained in the example's `origin` values; producer contracts are `model/receptor_report_source.py`, `model/receiving_water_report_cli.py` and `model/receiving_water_report_source.py`; queue/receiving contracts are the maintained `receive_operator.py` and `operator/server.py`.

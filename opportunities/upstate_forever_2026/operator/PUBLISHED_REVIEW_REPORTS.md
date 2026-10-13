# A saved observation review in the scientific report

## Operator course

1. Open **Published studies**, choose an original study edition, and select its stations, parameters, strata, year and months. The source tables retain their original sampling calendars and applicable filters.
2. Enter a review title and notes, then choose **Save review**. You can also open an existing named review or use **Station geography → Open matching observations** to select its exact original station identifiers first.
3. In the saved review's **Scientific report** section, choose **Prepare saved review source**. The queued operation binds that immutable review, its original study source and the maintained selected interpretation.
4. Choose the resulting prepared source edition and **Open scientific composer**. The existing Sources composer receives its exact source collection and source identifier. Add other original reports in the desired order and use the ordinary render, save and download controls.
5. Use the saved scientific edition's existing **Study transfer** when sending the original editable study and report together. The ordinary complete Workspace archive remains available for the whole project.

Save changes before preparing or opening a source. Preparing a source does not silently save a new review. Earlier prepared editions stay available in the picker, with their original review and source binding. Refresh reads those retained sources, including a preparation completed while this desk was closed.

## Source scope

The scientific source follows the saved review's station and sampling selections. It preserves original quantity units, methods, censor conditions, source comments and coverage. Review notes are authored context.

The complete original saved-review ZIP travels with the source. It retains the selected readable report and the complete original study, including its full-scope figures and source hierarchy. Those original full-study products retain their stated scope; selecting a station in a review does not recalculate an authored scientific figure.

The prepared source records both the saved coverage/sampling snapshot and its maintained interpretation. If those differ, the report explains the difference while preserving the original study edition and exact saved selection. Sources prepared under an earlier implementation remain distinct retained editions.

## Task and navigation behavior

Preparation uses the existing Published studies queue. An accepted operation remains in Tasks after navigation. Reopen the same saved review and refresh prepared sources to continue it.

A newer review edit, a different saved review, a Workspace change, or navigation supersedes an in-flight source opening. The scientific composer receives the exact original source only after its retained edition has been verified and the original Workspace remains selected.

The existing source-only review export remains useful independently: **Export saved review ZIP → Import a complete review ZIP** preserves its original study edition, filters, table, title and notes.

## Continue the existing native review operation

Use the actual saved review produced by the existing geographic-review receiver or saved through the normal review API. Its identifier is the `review_id` in `geographic-study-review-receiving.json`. Keep the accepted complete application, original Workspace and receiving directory.

From that application root, with the same native interpreter:

```python
import json
from pathlib import Path
from model.workspace import Workspace
from model.common import atomic_json, held
from model import published_review_report_source

workspace = Workspace(ACTUAL_WORKSPACE)
review_id = json.loads(Path(ACTUAL_REVIEW_RECEIVING_JSON).read_text())["review_id"]
preview = published_review_report_source.preview(workspace, review_id)
with held(workspace.root / ".workspace.lock", blocking=False):
    result = published_review_report_source.prepare(
        workspace, review_id, expected_preview_id=preview["id"])
output = Path(ACTUAL_OWNED_OUTPUT) / result["id"]
output.mkdir(parents=True, exist_ok=True)
atomic_json(output / "review-source.json", result, immutable=True)
atomic_json(output / "scientific-selection.json",
            {"title": result["title"], "sources": [result["source_choice"]]},
            immutable=True)
print(output / "scientific-selection.json")
```

Supply the returned selection file to the already maintained native scientific-report course:

```sh
"$PYTHON" -B "$APPLICATION/source/observed-report-20261013/receive_operator.py" \
  --workspace "$WORKSPACE" \
  --selection "$EXACT_SELECTION_FILE" \
  --output "$OWNED_REPORT_RECEIVING" \
  --selected-study
```

Choose selected-study mode before this output's first launch. Resume an interrupted run with the same selections and the existing `--resume` option. The receiver uses the native operator's queued render/export, preserves original report task identities, downloads the full report products, restores the complete Workspace and reopens the selected editable Study.

For the current regional course, use the original project `b9d5d257-c6bb-4f07-b975-8e8c63705db3` in `/mnt/data/eco-cohort-resume/received/workspace` and its existing Published studies operation `1791875233.324399`. The geographic review is derived from the already completed `3bf6c45056785bedd914d0dc6dd201cbd9cc8222431e4ba7dbf1a7a99b0144a7` station edition. The original 36 station identifiers and 730 E. coli records remain the same underlying sources.

## Complete application

Receive the source producer, its typed Study-transfer adapter and the current Published studies provider, two client modules, descriptor, access-route policy, installer and source family together. The normal component resolver checks their complete dependency closure. The optional host callback is supplied by the maintained scientific composer; an older host can retain the prepared source through its Sources desk until that callback is installed.

The standalone installer validates its shared transfer composition before copying source. It adds the saved-review resolver beside the installed native-process resolver, preserves all other current report handlers, and backs up any changed shared source. Receiving the same edition again reuses the existing registration. An older application must first receive the maintained native scientific composer and its transfer dispatcher.

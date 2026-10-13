# Upper Savannah regional report: authored scientific review

This is the review request for the completed **Upper Savannah land cover, utility
geography and observation context** report. Use the existing saved-capture and
S1 receiving operation to carry this request into the original Customer reviews
workflow.

## Original report

- Project: `dc92b8b9-6eda-4362-b12d-3cf2ef6c9007`.
- Completed capture: `358596b0262c49afbde125293ee699e43374857d07d01e238bad24eae2b46e42`.
- Original render operation: `observed-report-16a897c91483a2c23ee5`.
- Retained source: `upstate-landcover-observation-report-c18ec10b060c`, role
  `OBSERVED_CONTEXT`.
- Read report: `Upper_Savannah_217_Scientific_Report_20261013.pdf`, nine pages,
  49,471 bytes. Original delivered file:
  `file_0000000050308243863ad87de9915dc1`.

The complete authored request is
[`upper_savannah_217_review_selection.json`](upper_savannah_217_review_selection.json).
It uses the existing scientific-review draft schema: title, purpose, eight
requirements and notes. Each requirement names the relevant report section,
original quantity or source file and the decision that needs review.

The questions cover classified spatial support, original class transitions,
unique utility upstream unions, dated point inventories, geographic identifier
differences, scientific interpretation, usable working files and continuation
after receiving. The classified-area denominator in this report is the native
common-cell footprint. Preserve its distinction from vector polygon area and
from differently dated report editions.

## Continue the original completed-capture operation

Use the same actual application, Workspace and interpreter from the completed
native course. Keep its point-basin and modeled scenario work with their current
owners. At the next ordinary completed source boundary, the following invocation
derives the exact edition and capture hash from the retained native preview, then
calls the original S1 consumer with this authored request.

Run from the actual application directory. `ECO_PYTHON` is that application's
working Python, `ECO_WORKSPACE` is its actual retained project, and
`ECO_REVIEW_OUTPUT` is the original owned receiving directory outside the
application and Workspace. Reuse that output on retry.

```sh
"$ECO_PYTHON" -B - "$ECO_WORKSPACE" "$ECO_REVIEW_OUTPUT" <<'PY'
import json
from pathlib import Path
import subprocess
import sys

from model.workspace import Workspace
from model import scientific_report_capture

application = Path.cwd().resolve()
workspace = Workspace(Path(sys.argv[1]).resolve())
output = Path(sys.argv[2]).resolve()
capture_id = "358596b0262c49afbde125293ee699e43374857d07d01e238bad24eae2b46e42"
if workspace.project["id"] != "dc92b8b9-6eda-4362-b12d-3cf2ef6c9007":
    raise ValueError("Continue the original completed regional report project")
preview = scientific_report_capture.preview(workspace, capture_id)
if preview["operation_id"] != "observed-report-16a897c91483a2c23ee5":
    raise ValueError("The selected capture identifies another report operation")
request = application / "source_tools/review_requests/upper_savannah_217_review_selection.json"
command = [
    sys.executable, "-B",
    str(application / "source_tools/receive_scientific_report_review.py"),
    "--workspace", str(workspace.root),
    "--capture-id", capture_id,
    "--capture-sha256", preview["capture_sha256"],
    "--edition-id", preview["edition_id"],
    "--review-selection", str(request),
    "--output", str(output),
    "--selected-study",
]
print(json.dumps({"preview": preview, "argv": command}, indent=2), flush=True)
subprocess.run(command, check=True)
PY
```

The original consumer adopts the completed report, retains the authored review,
exports its complete offline review, carries out its full Workspace receiving
course and continues through selected editable Study receiving. Its output
retains the actual review, source, edition, archive and restore identities.
Continue that same receipt when the first course has already completed:

```sh
"$ECO_PYTHON" -B source_tools/receive_scientific_report_review.py \
  --workspace "$ECO_WORKSPACE" --continue-receipt "$ECO_REVIEW_RECEIPT"
```

Use the actual returned receipt path for `ECO_REVIEW_RECEIPT`. If actual reviewer
feedback has returned, pass that original response with the existing
`--response` option. The original importer owns its review identity,
predecessor and response history.

## Operate the received scientific work

Open the adopted edition in **Sources**, the same request in **Customer
reviews**, its complete files and the eight requirements. Open the retained
review after selected Study restoration, follow **Open original report**, and
continue the same history and corrections. Use the original offline review
export to read the report and retained source tree.

When the same project has two actual saved editions and an original comparison,
**Report changes → Prepare customer review** supports a distinct authored review
of that complete pair. It keeps the recorded matching plan and both report
trees. Transfer that review to carry its pair and feedback together.

Open and use the actual outgoing PDF, HTML, figures, source downloads, review
archive and received project. Read desktop and narrow layouts and the exported
PDF pages, and correct observed defects in the producing source. Keep actual
run, review and source identifiers with the same operation.

## Current owner direction

The complete unchanged brief below accompanies this report-specific review.
The 30 m simulated baseline, riparian alternative and matched-control native
work remains active under its existing owners.

---

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.


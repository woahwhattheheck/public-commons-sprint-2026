"""Rebuild one explicitly selected retained delivery with its selected client renderer."""
from pathlib import Path
import argparse
import hashlib
import json
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--application", type=Path, required=True)
parser.add_argument("--workspace", type=Path, required=True)
selection_args = parser.add_mutually_exclusive_group(required=True)
selection_args.add_argument("--delivery-id", help="Original complete delivery or received snapshot ID")
selection_args.add_argument("--native-study-record", type=Path,
                            help="Completed gura-native-study-state.json from this same Workspace")
parser.add_argument("--expect-project-id")
parser.add_argument("--expected-report-edition", required=True)
parser.add_argument("--expected-compiler-sha256", required=True)
args = parser.parse_args()
application = args.application.resolve(strict=True)
workspace_path = args.workspace.resolve(strict=True)
compiler_path = application / "model" / "client_report.py"
expected_compiler = args.expected_compiler_sha256
if hashlib.sha256(compiler_path.read_bytes()).hexdigest() != expected_compiler:
    raise ValueError("Install the exact compiler selected for this receiving operation")
sys.path.insert(0, str(application))
from model import client_report, portable
from model.common import digest, verify_file
from model.delivery import build
from model.workspace import Workspace

if Path(client_report.__file__).resolve() != compiler_path.resolve():
    raise ValueError("The selected application's compiler must be imported")
if client_report.REPORT_EDITION != args.expected_report_edition:
    raise ValueError("The installed report edition differs from the explicitly selected edition")
workspace = Workspace(workspace_path)
if args.expect_project_id and args.expect_project_id not in {
        workspace.project.get("id"), workspace.project.get("uuid")}:
    raise ValueError("The retained project differs from the explicitly selected project")
key = args.delivery_id
native_record = None
if args.native_study_record is not None:
    record_path = args.native_study_record.resolve(strict=True)
    record_bytes = record_path.read_bytes()
    native_record = json.loads(record_bytes)
    if (native_record.get("schema") != "upstate.gura-native-study-operation/v1"
            or native_record.get("state") != "complete"):
        raise ValueError("Use the completed original Gura study checkpoint")
    key = native_record.get("delivery_id")
if not isinstance(key, str) or Path(key).name != key or key in ("", ".", ".."):
    raise ValueError("Use the selected delivery's original identifier")
if native_record is not None:
    original_output = native_record.get("output_directory")
    if (not isinstance(original_output, str)
            or Path(original_output).resolve(strict=True) !=
            (workspace.root / "deliveries" / key).resolve(strict=True)):
        raise ValueError("The Gura checkpoint belongs to a different retained Workspace delivery")
selected_path = workspace.root / "deliveries" / key / "delivery-state.json"
selected = json.loads(selected_path.read_text(encoding="utf-8"))
if selected.get("id") != key or selected.get("state") not in {"complete", "received_snapshot"}:
    raise ValueError("Choose the retained complete delivery or its received snapshot")
selection = dict(selected["selection"])
baseline = selection["baseline_run_id"]
alternatives = list(selection.get("scenario_run_ids", []))
if native_record is not None:
    if (native_record.get("baseline_run_id") != baseline
            or native_record.get("scenario_run_ids") != alternatives
            or native_record.get("source_report_id") != selection.get("source_report_id")):
        raise ValueError("The Gura checkpoint differs from its retained report and ordered native cohort")
delivered = build(workspace, selection)
if delivered.get("state") != "complete":
    raise ValueError("The rebuilt delivery did not complete")
if (delivered["selection"]["baseline_run_id"] != baseline or
        list(delivered["selection"].get("scenario_run_ids", [])) != alternatives):
    raise ValueError("The report rebuild changed the selected native run identities")
if delivered["selection"].get("client_companion_edition") != client_report.REPORT_EDITION:
    raise ValueError("The delivery selection must bind the current companion edition")
directory = workspace.root / "deliveries" / delivered["id"]
keys = ("client_report", "client_report_html", "client_report_markdown", "client_report_model",
        "client_report_briefing", "client_report_briefing_index")
retained = {name: delivered["files"][name] for name in (*keys, "native_execution")}
for descriptor in retained.values():
    verify_file(directory, descriptor)
manifest = json.loads((directory / "delivery.json").read_text(encoding="utf-8"))
assets = set(manifest["project_assets"])
if any(item["path"] not in assets for item in retained.values()):
    raise ValueError("The portable package manifest omits a client companion")
report = json.loads((directory / retained["client_report_model"]["path"]).read_text(encoding="utf-8"))
if report["report_edition"] != client_report.REPORT_EDITION:
    raise ValueError("The editable report is from another renderer edition")
if (report.get("delivery_id") != delivered["id"] or report["baseline_run_id"] != baseline
        or report["alternative_run_ids"] != alternatives):
    raise ValueError("The report changed the original delivery or ordered native run identities")

# Read original generated bindings; meeting notes remain an interactive export,
# not a seventh generated report role.
briefing = json.loads((directory / retained["client_report_briefing_index"]["path"]).read_text(
    encoding="utf-8"))
binding = briefing.get("binding") or {}
if (briefing.get("schema") != "upstate.client-briefing/v1"
        or binding.get("schema") != "upstate.client-briefing/v1"
        or binding.get("report_digest_method") != "sha256-original-report-model-bytes"
        or binding.get("report_sha256") != retained["client_report_model"]["sha256"]
        or binding.get("report_edition") != report["report_edition"]
        or binding.get("delivery_id") != delivered["id"]
        or binding.get("baseline_run_id") != baseline
        or binding.get("alternative_run_ids") != alternatives):
    raise ValueError("The briefing must bind the exact original report bytes and ordered cohort")
# The inline model is the original rendered briefing's active navigation/binding.
from html.parser import HTMLParser

class BriefingModel(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.models = []
        self.active = None

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("id") == "briefing-data":
            self.active = []

    def handle_data(self, data):
        if self.active is not None:
            self.active.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.active is not None:
            self.models.append(json.loads("".join(self.active)))
            self.active = None

parsed = BriefingModel()
with (directory / retained["client_report_briefing"]["path"]).open(encoding="utf-8") as source:
    for block in iter(lambda: source.read(1024 * 1024), ""):
        parsed.feed(block)
parsed.close()
if parsed.models != [briefing]:
    raise ValueError("The rendered briefing navigation differs from its retained report-bound index")

execution_descriptor = retained["native_execution"]
execution = json.loads((directory / execution_descriptor["path"]).read_text(encoding="utf-8"))
ordered_runs = [baseline, *alternatives]
if (execution.get("schema") != "upstate.native-execution/v1"
        or execution.get("run_order") != ordered_runs
        or set(execution.get("runs", {})) != set(ordered_runs)
        or digest(execution) != delivered["selection"].get("native_execution_digest")):
    raise ValueError("Native execution records must retain the selected delivery's frozen cohort and digest")
client_execution = report.get("native_execution") or {}
if (client_execution.get("run_order") != ordered_runs
        or client_execution.get("models") != execution.get("models")
        or client_execution.get("runs") != {
            run_id: execution["runs"][run_id]["model_versions"] for run_id in ordered_runs}):
    raise ValueError("The client report differs from the frozen producing-model versions")
manifest_execution = (manifest.get("model") or {}).get("execution_provenance") or {}
if any(manifest_execution.get(field) != execution_descriptor[field]
       for field in ("path", "bytes", "sha256")):
    raise ValueError("The portable manifest must bind the original native execution companion")
companion = manifest.get("client_companion") or {}
if (companion.get("edition") != report["report_edition"]
        or any(companion.get(name) != retained[name]["path"] for name in keys)):
    raise ValueError("The portable manifest must name all six original client companions")
evidence = next((section for section in report["sections"]
                 if section["id"] == "scientific-evidence"), {})
if not any(item.get("path") == execution_descriptor["path"]
           for item in evidence.get("assets", [])):
    raise ValueError("The client report must link its retained native execution records")
map_files = sum(len(family["files"]) for family in report["maps"])
index = next((section for section in report["sections"] if section["id"] == "atlas-files"), None)
if map_files and (index is None or len(index["tables"][0]["rows"]) != map_files):
    raise ValueError("The map index must contain one row per retained map file")
# The builder already verified and hashed the archive. Read only its small
# inventory here to check all six companions and native execution survived snapshot collection.
working = directory / delivered["files"]["working_archive"]["path"]
archive = portable.inspect_archive(working, verify=False)
captured_delivery = archive.get("delivery") or {}
if (archive.get("project") != workspace.project
        or captured_delivery.get("id") != delivered["id"]
        or (captured_delivery.get("record") or {}).get("selection") != delivered["selection"]):
    raise ValueError("The working archive differs from this original project and selected delivery")
snapshot = captured_delivery.get("files", {})
for name, descriptor in retained.items():
    captured = snapshot.get(name)
    if (not captured or captured.get("path") != "delivery/" + descriptor["path"]
            or any(captured.get(field) != descriptor[field] for field in ("bytes", "sha256"))):
        raise ValueError("The working archive omits or changes companion " + name)
receipt = {
    "project": workspace.project,
    "selected_delivery_id": key,
    "delivery_id": delivered["id"],
    "baseline_run_id": baseline,
    "scenario_run_ids": alternatives,
    "report_edition": report["report_edition"],
    "actual_grid": report["grid_context"],
    "map_file_count": map_files,
    "client_files": {name: {**retained[name], "absolute_path": str(directory / retained[name]["path"])}
                     for name in keys},
    "briefing_binding": binding,
    "briefing_page_count": len(briefing["slides"]),
    "native_execution": {**execution_descriptor,
                         "absolute_path": str(directory / execution_descriptor["path"]),
                         "digest": delivered["selection"]["native_execution_digest"],
                         "run_order": execution["run_order"], "models": execution["models"]},
    "working_archive": delivered["files"]["working_archive"],
    "delivery_archive": delivered["files"].get("delivery_archive"),
}
if native_record is not None:
    receipt["selected_native_study_record"] = {
        "path": str(record_path), "bytes": len(record_bytes),
        "sha256": hashlib.sha256(record_bytes).hexdigest(),
    }
print(json.dumps(receipt, indent=2, ensure_ascii=False, allow_nan=False))

#!/usr/bin/env python3
"""Operate authored reference through an existing trusted analyst and report bridge.

Run in a new private directory on the selected Linux/POSIX host. The native analyst
directory must already be authorized and complete. This course imports that selected
installation, never code taken from a received handover.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

from native_handover_input import (
    AdmissionError, build_input, encoded, load_handovers, private_directory,
    publish, read_handover, require, retain, sha, stable_bytes, strict_json, MAX_BYTES
)

PINNED = {
    "workspace.py": "7de061c4779d4edfedd88e5c1c4e8303ece6e89e",
    "bankregdata_native.py": "f0ef128275f5a26659d5afeba396f2c275d418be",
    "bankregdata_sources.py": "d687e07fecbef07e1eac87d9ba8f6fbff64e5199"
}


def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def run_node(node, source, complete_input, output):
    result = subprocess.run([str(node), str(source / "operate_report.mjs"),
                             "--input", str(complete_input), "--output", str(output)],
                            capture_output=True, text=True, encoding="utf-8",
                            timeout=180, check=False)
    require(result.returncode == 0, "Native report command failed: " + result.stderr[-4000:])
    return json.loads(result.stdout)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analyst-directory", required=True, type=Path)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--playwright-module", required=True, type=Path)
    parser.add_argument("--chromium", required=True, type=Path)
    args = parser.parse_args(argv)
    source = Path(__file__).resolve().parent
    analyst = args.analyst_directory.resolve()
    node = args.node.resolve()
    require(os.name == "posix", "The selected original analyst receiving course requires Linux/POSIX")
    require(node.is_file(), "Choose an installed Node executable")
    observed = {}
    for name, expected in PINNED.items():
        raw = stable_bytes(analyst / name, MAX_BYTES)
        require(git_blob(raw) == expected, "Select the reviewed native source edition: " + name)
        observed[name] = {"gitBlob": expected, "bytes": len(raw), "sha256": sha(raw)}
    out = args.output.absolute()
    require(not out.exists() or not any(out.iterdir()), "Choose a new empty private course directory")
    out = private_directory(out)
    retain(out / "source-selection.json", encoded({
        "schema": "commons.institution-native-course-source.v1",
        "analystDirectory": str(analyst), "node": str(node), "selectedSource": observed,
        "input": "Complete authored reference; no customer observations"
    }))
    sys.path.insert(0, str(analyst))
    workspace_module = importlib.import_module("workspace")
    source_module = importlib.import_module("bankregdata_sources")
    require(Path(workspace_module.__file__).resolve() == analyst / "workspace.py" and
            Path(source_module.__file__).resolve() == analyst / "bankregdata_sources.py",
            "Loaded native modules differ from the explicit selected installation")
    Workspace, Sources = workspace_module.Workspace, source_module.BankRegDataSources
    reference = strict_json(stable_bytes(source / "reference" / "input.json", MAX_BYTES), "authored reference")
    actor = "Authored receiving course"
    working = Workspace(out / "native-workspace")
    try:
        api = Sources(working)
        selected_views = []
        for original in reference["originals"]:
            raw = original["text"].encode("utf-8")
            require(sha(raw) == original["sha256"], "Authored original changed")
            received = api.receive(raw, {
                "format": "csv", "encoding": "utf-8", "delimiter": ",",
                "title": "Authored receiving reference", "filename": original["filename"],
                "source_url": "", "retrieved_at": "2026-10-15T00:00:00Z"
            }, actor)
            mapping = {
                "table_id": "table-1", "header_row": 0,
                "entity": {"column": 0}, "period": {"column": 1},
                "metrics": [
                    {"column": 2, "label": "income_ytd", "unit": "USD",
                     "basis": "year_to_date", "zero_policy": "reported",
                     "note": "Authored YTD amount"},
                    {"column": 3, "label": "assets", "unit": "USD",
                     "basis": "instant", "zero_policy": "reported",
                     "note": "Authored quarter-end amount"}
                ],
                "key_columns": [], "missing_tokens": [],
                "reporting_note": "Authored native parser-to-report receiving reference",
                "identity_kind": "provider_label"
            }
            saved = api.create_view({"source_id": received["source"]["id"],
                                    "title": original["filename"], "mapping": mapping}, actor)
            selected_views.append(saved["view"])
        require(len(selected_views) == 5, "This course expects five retained reference editions")
        comparison = api.create({
            "title": "Authored full source comparison", "request_key": "institution-native-course-comparison",
            "before": {"view_id": selected_views[0]["id"], "period": "2025-09-30"},
            "after": {"view_id": selected_views[-1]["id"], "period": "2026-09-30"},
            "entities": ["A", "B", "C"], "metrics": ["income_ytd", "assets"],
            "supporting_views": [x["id"] for x in selected_views[1:-1]]
        }, actor)
        api.review({"id": comparison["id"], "key": "", "decision": "reviewed",
                    "note": "Authored values checked for this receiving course."}, actor)
        edition = api.publish({"id": comparison["id"], "title": "Authored institution source handover",
                               "request_key": "institution-native-course-handover"}, actor)
        original_zip = api.handover(edition["id"])
        retain(out / "original-native-handover.zip", original_zip)
        retain(out / "original-native-backup.zip", working.backup())
        native_revision = working.revision
    finally:
        working.close()
    handovers = [read_handover(original_zip, "original-native-handover.zip")]
    selection = {k: v for k, v in reference.items() if k not in ("originals", "views")}
    selection["selectedViewIds"] = [x["id"] for x in selected_views]
    for item in selection["sourceSelections"]:
        item["tableId"] = "table-1"
    selection["authoredReceivingNote"] = "Unknown selection fields survive input assembly."
    selection_raw = encoded(selection)
    retain(out / "selection.json", selection_raw)
    first = publish(selection_raw, handovers, out / "assembled")
    retry = publish(selection_raw, load_handovers([out / "original-native-handover.zip"]), out / "assembled")
    require(first == retry, "Exact adapter retry differs")
    assembled_raw = stable_bytes(out / "assembled" / "input.json", MAX_BYTES)
    assembled = strict_json(assembled_raw, "assembled input")
    require(assembled["authoredReceivingNote"] == selection["authoredReceivingNote"],
            "Additional source selection was lost")
    for binding in assembled["nativeHandoverProvenance"]["bindings"]:
        document = next(x for x in assembled["views"] if x["sha256"] == binding["viewSha256"])
        require(document["text"].encode("utf-8") ==
                handovers[0]["files"]["objects/" + binding["viewSha256"]],
                "Native object text changed")
    original_input, original_manifest = assembled_raw, stable_bytes(out / "assembled" / "manifest.json", MAX_BYTES)
    changed = dict(selection)
    changed["title"] = "Changed selection must use a new output"
    try:
        publish(encoded(changed), handovers, out / "assembled")
    except AdmissionError:
        pass
    else:
        raise AdmissionError("Different input replaced an existing adapter publication")
    require(stable_bytes(out / "assembled" / "input.json", MAX_BYTES) == original_input and
            stable_bytes(out / "assembled" / "manifest.json", MAX_BYTES) == original_manifest,
            "Rejected changed selection altered the original delivery")
    delivered = run_node(node, source, out / "assembled" / "input.json", out / "report")
    report = strict_json(stable_bytes(out / "report" / "report.json", MAX_BYTES), "complete report")
    require(len(report["institutionRows"]) == 48 and len(report["peerRows"]) == 16 and
            len(report["exceptions"]) == 4, "Native reference row/coverage result differs")
    q4 = next(x for x in report["institutionRows"] if
              (x["entity"], x["period"], x["measure"]) == ("A", "2025-12-31", "income_quarter"))
    ratio = next(x for x in report["peerRows"] if
                 (x["subject"], x["period"], x["measure"]) == ("A", "2025-12-31", "income_to_assets"))
    require(q4["display"] == "30.00" and ratio["statistic"]["display"] == "2.25" and
            ratio["eligibleCount"] == 3 and ratio["observedCount"] == 2,
            "Actual native observations did not produce the approved quarter/peer result")
    receiver = Workspace(out / "independent-native-receiver")
    try:
        receiving = Sources(receiver)
        received = receiving.receive_handover(original_zip, actor)
        repeated = receiving.receive_handover(original_zip, actor)
        require(received["received"] is True and repeated["received"] is False,
                "Original native receive/replay differs")
        require(len(receiving.state()["views"]) == 5, "Independent receiver lost a source edition")
    finally:
        receiver.close()
    restored = workspace_module.restore(stable_bytes(out / "original-native-backup.zip", MAX_BYTES),
                                        out / "restored-native-workspace")
    reopened = Workspace(out / "restored-native-workspace", create=False)
    try:
        require(reopened.revision == native_revision, "Full native backup revision changed")
        require(len(Sources(reopened).state()["views"]) == 5, "Full backup lost native views")
    finally:
        reopened.close()
    second = publish(selection_raw, load_handovers([out / "assembled" / "original-handovers" /
                                                   (sha(original_zip) + ".zip")]), out / "independent-input")
    require(first["files"] == second["files"], "Independent original input rebuild differs")
    redelivered = run_node(node, source, out / "independent-input" / "input.json", out / "independent-report")
    require(delivered["files"] == redelivered["files"], "Independent full report rebuild differs")
    browser_process = subprocess.run(
        [str(node), str(source / "receive_report_browser.mjs"), "--report", str(out / "report"),
         "--output", str(out / "browser"), "--playwright-module", str(args.playwright_module.resolve()),
         "--chromium", str(args.chromium.resolve())],
        capture_output=True, text=True, encoding="utf-8", timeout=180, check=False)
    require(browser_process.returncode == 0, "Actual report browser receiving failed: " + browser_process.stderr[-4000:])
    browser_result = json.loads(browser_process.stdout)
    result = {
        "schema": "commons.institution-native-receiving-result.v1", "state": "COMPLETE",
        "runtime": {"python": sys.version, "platform": sys.platform, "node": str(node)},
        "source": observed, "nativeRevision": native_revision, "nativeViews": 5,
        "handoverSha256": sha(original_zip), "inputSha256": sha(assembled_raw),
        "institutionRows": 48, "peerRows": 16, "exceptions": 4,
        "q4Income": q4["display"], "peerRatioOfSums": ratio["statistic"]["display"],
        "exactAdapterRetry": True, "changedSelectionPreserved": True,
        "independentNativeReceiveAndReplay": True, "nativeBackupReopened": True,
        "independentInputAndReportExact": True, "reportFiles": delivered["files"],
        "browser": browser_result
    }
    retain(out / "receiving-result.json", encoded(result))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

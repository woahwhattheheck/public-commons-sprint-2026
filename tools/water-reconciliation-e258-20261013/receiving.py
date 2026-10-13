#!/usr/bin/env python3
"""One complete native operating journey for the original discovery workbench."""
import csv
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import zipfile
from discovery_engine import file_digest, read_json, write_json

ROOT = Path(__file__).resolve().parent
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=False)
report = {"schema": "commons.discovery.native-receiving.v1", "operation": "E258-AYRSHIRE-DISCOVERY-RECONCILIATION-20261013",
          "python": platform.python_version(), "phases": [], "resources": []}

def resources(label):
    row = {"label": label, "values": {}}
    for path in ("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.events",
                 "/sys/fs/cgroup/memory.stat", "/proc/meminfo"):
        try:
            row["values"][path] = Path(path).read_text()
        except OSError as error:
            row["values"][path] = {"error": type(error).__name__, "errno": error.errno}
    report["resources"].append(row)

def invoke(*args):
    result = subprocess.run([sys.executable, str(ROOT/"discovery_cli.py"), *map(str,args)],
                            capture_output=True, text=True, timeout=180)
    phase = {"command": list(map(str,args)), "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
    report["phases"].append(phase)
    write_json(OUT/"native-receiving.json", report)
    if result.returncode != 0:
        raise RuntimeError("Original CLI phase failed: " + json.dumps(phase))
    return json.loads(result.stdout)

def assert_true(value, message):
    if not value:
        raise AssertionError(message)

def derived_manifest(name, edition, mutate):
    directory = OUT/name
    directory.mkdir()
    original = read_json(ROOT/"fixtures/demo-a/manifest.json")
    original["edition"] = edition
    for table in original["tables"]:
        content = (ROOT/"fixtures/demo-a"/table["path"]).read_bytes()
        (directory/table["path"]).write_bytes(content)
    mutate(original, directory)
    write_json(directory/"manifest.json", original)
    return directory/"manifest.json"

resources("before complete source operation")
try:
    a = invoke("run", "--manifest", ROOT/"fixtures/demo-a/manifest.json", "--output", OUT/"edition-a")
    b = invoke("run", "--manifest", ROOT/"fixtures/demo-b/manifest.json", "--output", OUT/"edition-b")
    ra, rb = (read_json(OUT/name/"report.json") for name in ("edition-a","edition-b"))
    ma, mb = ra["metrics"][0], rb["metrics"][0]
    assert_true(ra["tables"][0]["rows"] == 11 and rb["tables"][0]["rows"] == 12, "Complete original record counts")
    assert_true(ma["denominator"] == 7 and [o["count"] for o in ma["outcomes"]] == [3,2,2], "First distinct cohort")
    assert_true(mb["denominator"] == 9 and [o["count"] for o in mb["outcomes"]] == [5,2,2], "Changed original cohort")
    assert_true(ra["tables"][0]["primary_key"]["extra_duplicate_rows"] == 1, "Original duplicate retained")
    assert_true(rb["tables"][0]["primary_key"]["extra_duplicate_rows"] == 0, "Corrected duplicate profile")
    assert_true(ra["foreign_keys"][0]["unmatched_child_rows"] == 1 and rb["foreign_keys"][0]["unmatched_child_rows"] == 0,
                "Original and corrected referential coverage")
    assert_true(ma["rounded_percent_total"] == "100.1" and mb["rounded_percent_total"] == "100.0",
                "Independent exact rounding retained")
    invoke("compare", "--left", OUT/"edition-a/report.json", "--right", OUT/"edition-b/report.json",
           "--output", OUT/"comparison.json")
    comparison = read_json(OUT/"comparison.json")["metrics"][0]
    assert_true(comparison["comparison"] == "SAME_DEFINITION" and comparison["denominator_change"] == 2,
                "Both edition denominators remain explicit")
    assert_true(comparison["outcome_changes"][0]["count_change"] == 2, "Original successful count movement")
    records = read_json(OUT/"comparison.json")["record_comparison"]
    enrollment = next(x for x in records["tables"] if x["table"]=="enrolments")
    assert_true([enrollment[x] for x in ("inserted","removed","changed","unchanged")] == [3,1,2,6],
                "Full canonical business-key movement")
    assert_true(enrollment["ambiguous_key_groups"]==1 and enrollment["left_ambiguous_rows"]==2 and
                enrollment["right_ambiguous_rows"]==1, "Duplicate key excludes both editions without arbitrary matching")

    handover = invoke("pack", "--run", OUT/"edition-b", "--output", OUT/"edition-b-handover.zip")
    receiving = invoke("receive", "--archive", OUT/"edition-b-handover.zip", "--output", OUT/"received")
    invoke("compare", "--left", OUT/"edition-a/report.json", "--right", OUT/"received/report.json",
           "--output", OUT/"cold-record-comparison.json")
    cold = read_json(OUT/"cold-record-comparison.json")["record_comparison"]
    assert_true(cold["right_receiving"]=="REBUILT_FROM_COMPLETE_ORIGINAL_SNAPSHOTS" and
                cold["tables"]==records["tables"], "Cold handover rebuild preserves the full keyed comparison")
    invoke("run", "--manifest", OUT/"received/manifest.receiving.json", "--output", OUT/"reproduced")
    rebuilt = read_json(OUT/"reproduced/report.json")
    assert_true(rb["tables"] == rebuilt["tables"] and rb["metrics"] == rebuilt["metrics"] and
                rb["foreign_keys"] == rebuilt["foreign_keys"], "Full independent receiving reproduces the complete operating result")
    assert_true([x["sha256"] for x in rb["lineage"]["inputs"]] == [x["sha256"] for x in rebuilt["lineage"]["inputs"]],
                "Both original files preserved byte for byte")

    def redefine(manifest, directory):
        manifest["metrics"][0]["unit"] = {"kind": "rows"}
    altered = derived_manifest("changed-definition", "demo-definition-revision", redefine)
    invoke("run", "--manifest", altered, "--output", OUT/"definition-result")
    invoke("compare", "--left", OUT/"edition-a/report.json", "--right", OUT/"definition-result/report.json",
           "--output", OUT/"definition-comparison.json")
    dc = read_json(OUT/"definition-comparison.json")["metrics"][0]
    assert_true(dc["comparison"] == "DEFINITION_CHANGED" and "outcome_changes" not in dc,
                "Changed cohort unit has no misleading rate delta")

    def invalid(manifest, directory):
        path = directory/"enrolments.csv"
        path.write_text(path.read_text().replace(",100.10,", ",incorrect-number,"), encoding="utf-8")
    invalid_manifest = derived_manifest("invalid-source", "demo-invalid-source", invalid)
    invoke("run", "--manifest", invalid_manifest, "--output", OUT/"invalid-result")
    reject = read_json(OUT/"invalid-result/report.json")["metrics"][0]
    assert_true(reject["status"] == "INVALID_INPUT" and reject["denominator"] is None and reject["invalid_input_rows"] == 1,
                "Original invalid source keeps the denominator uncomputed")
    exclude = read_json(invalid_manifest)
    exclude["edition"] = "demo-explicit-exclusion"
    exclude["metrics"][0]["invalid_rows"] = "exclude"
    write_json(invalid_manifest.parent/"exclude.json", exclude)
    invoke("run", "--manifest", invalid_manifest.parent/"exclude.json", "--output", OUT/"exclusion-result")
    excluded = read_json(OUT/"exclusion-result/report.json")["metrics"][0]
    assert_true(excluded["denominator"] == 6 and excluded["explicitly_excluded_invalid_rows"] == 1 and
                [o["count"] for o in excluded["outcomes"]] == [2,2,2], "Explicit exclusion retains original scope")

    def overlap(manifest, directory):
        path = directory/"enrolments.csv"
        text = path.read_text()
        target = "e09,L09,P02,2024,FE,full_time,partial,90,2024-08-24"
        index = text.rfind(target)
        text = text[:index] + text[index:].replace(",partial,", ",successful,", 1)
        path.write_text(text, encoding="utf-8")
    overlapping = derived_manifest("overlap-source", "demo-overlapping-outcomes", overlap)
    invoke("run", "--manifest", overlapping, "--output", OUT/"overlap-result")
    om = read_json(OUT/"overlap-result/report.json")["metrics"][0]
    assert_true(om["status"] == "PARTITION_REVIEW" and om["denominator"] == 7 and om["overlapping_outcome_units"] == 1,
                "Conflicting records retain the real overlapping unit")

    require_ref = ra["published_references"][0]
    values = require_ref["counts"]
    assert_true(values["total"] == sum(values[k] for k in ("successful","partial","non_completion")) == 2316,
                "Separate published aggregate conserves its original counts")
    report.update({"status": "COMPLETE", "handover": handover, "receiving": receiving,
                   "first": {"rows":11,"denominator":7,"outcomes":[3,2,2]},
                   "second":{"rows":12,"denominator":9,"outcomes":[5,2,2]},
                   "archive_exact":True,"record_changes":{"inserted":3,"removed":1,"changed":2,"unchanged":6,"ambiguous_groups":1},"cold_record_receiving":True,"definition_change":"DEFINITION_CHANGED",
                   "invalid_source":"INVALID_INPUT","explicit_excluded_rows":1,
                   "overlapping_units":1,"published_reference_independent":True})
except BaseException as error:
    report.update({"status":"ERROR","error_type":type(error).__name__,"error":str(error)})
    raise
finally:
    resources("after complete source operation")
    write_json(OUT/"native-receiving.json", report)
    print(json.dumps(report,ensure_ascii=False,sort_keys=True),flush=True)

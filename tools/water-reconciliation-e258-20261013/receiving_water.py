#!/usr/bin/env python3
"""One complete native source/analysis/report/handover receiving course."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from discovery_engine import read_json, write_json, compare_reports, file_digest, require
from water_reconciliation import run_water, pack_water, receive_handover

def check(condition, description):
    require(condition, "Receiving outcome differs: " + description)

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory", required=True, help="New private receiving directory")
    args = p.parse_args(argv)
    root = Path(args.directory).resolve()
    check(not root.exists(), "use a new receiving directory")
    root.mkdir(parents=True)
    here = Path(__file__).resolve().parent
    results = []
    for edition in ("a","b"):
        source = here/"examples"/edition
        result = run_water(source/"manifest.json", source/"selection.json", root/edition)
        report = read_json(root/edition/"water/result.json")
        rows = {row["period_id"]: row for row in report["results"]}
        check(report["data_class"] == "DEMONSTRATION", "original example classification")
        check(report["selected_accounts"] == 4 and report["selected_periods"] == 4, "complete selected population")
        check(rows["A-OCT"]["classification"] == "RECONCILED_WITHIN_SELECTED_TOLERANCES", "complete A source chain")
        check(rows["A-OCT"]["billing"]["amount"]["decimal_12"] == "13.800000000000", "complete two-tier water charge")
        fall = rows["B-FALL"]
        check(fall["register_gallons"]["decimal_12"] == "250.000000000000" and
              fall["ami_gallons"]["decimal_12"] == "250.000000000000", "two physical meters across25-hour day")
        day = fall["patterns"]["daily"][0]
        check(day["complete_day"] and day["actual_day_hours"]["decimal_12"] == "25.000000000000", "actual fall-back day duration")
        check(day["night_gallons"]["decimal_12"] == "70.000000000000", "both occurrences of the repeated local night hour")
        gap = rows["C-GAP"]
        if edition == "a":
            check(gap["ami_gallons"] is None and any(x["code"] == "AMI_UNCOMPUTED" for x in gap["issues"]),
                  "original missing interval remains uncomputed")
            check(any(x["code"] == "VOLUME_DIFFERENCE_OUTSIDE_TOLERANCE" for x in gap["issues"]),
                  "actual billed-volume variance appears in complete review output")
        else:
            check(gap["classification"] == "RECONCILED_WITHIN_SELECTED_TOLERANCES", "later corrected source edition")
            check(gap["billing"]["amount"]["decimal_12"] == "11.400000000000", "later corrected charge")
        negative = rows["D-NEGATIVE"]
        check(negative["billed_gallons"] is None and negative["billing"] is None,
              "uninterpreted credit cannot become calculated consumption")
        check(not any(x["from"] == "billed" or x["to"] == "billed" for x in negative["comparisons"]),
              "rejected negative quantity does not enter a comparison")
        html = (root/edition/"water/report.html").read_text(encoding="utf-8")
        check("TJLabs" in html and len(html) > 1000, "complete rendered-report artifact exists")
        results.append(result)
    left, right = read_json(root/"a/report.json"), read_json(root/"b/report.json")
    comparison = compare_reports(left, right, root/"a", root/"b")
    write_json(root/"source-comparison.json", comparison)
    archive = pack_water(root/"b", root/"Water_Case.zip")
    receiving = receive_handover(root/"Water_Case.zip", root/"received")
    # Rebuild from the original preserved CSVs with the actually received source.
    command = [sys.executable, str(root/"received/workbench/water_reconciliation.py"), "run",
               "--manifest", str(root/"received/manifest.receiving.json"),
               "--selection", str(root/"received/water/selection.original.json"),
               "--output", str(root/"cold")]
    process = subprocess.run(command, text=True, capture_output=True)
    (root/"cold.stdout.txt").write_text(process.stdout, encoding="utf-8")
    (root/"cold.stderr.txt").write_text(process.stderr, encoding="utf-8")
    check(process.returncode == 0, "received original native program completes")
    before, after = read_json(root/"b/water/result.json"), read_json(root/"cold/water/result.json")
    check(before["results"] == after["results"], "all original period, arithmetic, coverage and pattern outcomes reopen")
    check(before["selection_sha256"] == after["selection_sha256"], "complete selected interpretation preserved")
    original = {x["table"]: x["sha256"] for x in before["source_inputs"]}
    reopened = {x["table"]: x["sha256"] for x in after["source_inputs"]}
    check(original == reopened, "every complete source snapshot preserved")
    # A modified derived artifact must not be exported as that immutable edition.
    working = root/"changed-derived"
    shutil.copytree(root/"b", working)
    with open(working/"water/review-items.csv", "a", encoding="utf-8") as stream:
        stream.write("unrecorded edit\n")
    try:
        pack_water(working, root/"Changed_Case.zip")
    except ValueError:
        changed_refused = True
    else:
        changed_refused = False
    check(changed_refused and not (root/"Changed_Case.zip").exists(), "changed derived output is refused before publishing")
    shutil.rmtree(working)
    result = {"schema": "tjlabs.water-reconciliation.receiving.v1", "status": "COMPLETE",
              "data_class": "DEMONSTRATION", "runs": results, "archive": archive,
              "receiving": receiving, "cold_reopen": str(root/"cold"),
              "rendered_reports": [str(root/x/"water/report.html") for x in ("a","b","cold")],
              "next_operator_step": "Open the actual reports in desktop/narrow browser, operate filters/drilldown/source links, print or export, view resulting pages and reopen the received attachments.",
              "recipe_sha256": file_digest(here/"water_reconciliation.py")}
    write_json(root/"receiving.json", result)
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

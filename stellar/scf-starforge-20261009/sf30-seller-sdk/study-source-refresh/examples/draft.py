#!/usr/bin/env python3
"""Create unfrozen operator drafts from actual retained source identities."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model import default_mapping, dump, fail, private_directory
from workspace import Workspace

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--workspace", required=True)
parser.add_argument("--sources", nargs="+", required=True)
parser.add_argument("--family", choices=("acs", "laus", "qcew", "hud_income_limits"), required=True)
parser.add_argument("--geography", action="append", required=True)
parser.add_argument("--measure", action="append", required=True)
parser.add_argument("--unit", required=True, help="Explicit source unit for these selected measures")
parser.add_argument("--name", required=True)
parser.add_argument("--comparison-group", default="", help="Optional reviewed geography equivalence group")
parser.add_argument("--crosswalk-note", default="")
parser.add_argument("--out", required=True)
args = parser.parse_args()
workspace = Workspace(args.workspace)
try:
    geographies, measures = [], []
    offset = 0
    while True:
        page = workspace.catalog(args.sources, offset=offset, limit=500)
        for item in page["geographies"]:
            if item["family"] == args.family and item["source_geography_id"] in args.geography:
                geographies.append({key: value for key, value in item.items() if key != "rows"})
        measures = page["measures"]
        if page["next"] is None:
            break
        offset = page["next"]
    if set(args.geography) != {geo["source_geography_id"] for geo in geographies}:
        fail("SELECTED_NATIVE_GEOGRAPHY_NOT_FOUND")
    if not set(args.measure) <= {item["measure_id"] for item in measures if item["family"] == args.family}:
        fail("SELECTED_NATIVE_MEASURE_NOT_FOUND")
    for geo in geographies:
        geo.update({
            "client_geography_id": geo["source_geography_id"],
            "comparison_group": (args.comparison_group + ":" + geo["source_geography_id"]) if args.comparison_group else "",
            "crosswalk_note": args.crosswalk_note,
        })
    portfolio = {
        "schema": "stellar-forge.study-portfolio.v1", "name": args.name,
        "geographies": geographies, "measures": [{"family": args.family, "measure_id": value} for value in args.measure],
    }
    mapping = default_mapping(args.name + " export")
    mapping["units"] = [{"family": args.family, "measure_id": value, "unit": args.unit,
                         "output_unit": args.unit, "factor": "1", "decimal_places": None} for value in args.measure]
    destination = private_directory(args.out)
    dump(destination / "portfolio.json", portfolio, exclusive=True)
    dump(destination / "mapping.json", mapping, exclusive=True)
    print(json.dumps({"draft": True, "geography_definitions": len(geographies),
                      "portfolio": str(destination / "portfolio.json"),
                      "mapping": str(destination / "mapping.json")}, indent=2))
finally:
    workspace.close()

"""Compare the retained P9 mapper targets with their F7 annual-load source edition.

This command is standard-library only. It reads the two retained original JSON
inputs, compares exact decimal rates and writes a source review. Native model
runs and existing observation collections are never modified.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import os
from pathlib import Path
from decimal import Decimal, localcontext
import tempfile

SCHEMA = "upstate.annual-reference-edition-bridge/v1"
P9_SOURCE = "430f1c2185f2cf14a88c992f270b729e81d9de5cecd20ec67def1c26ff86cc03"
F7_SOURCE = "af89b23daa91db89d2abd558312ae50cf444e82c778d9832779a2ed27208f845"
ORIGINAL_TARGET_SHA256 = "d30de5b49d45028a6b3e342ed266d68af3ccc5ca31d570ba675ff8b5aca1261e"
P9_PRESET_SHA256 = "95e4b88e1ddf301da693f327c3cf9dc0fc696b0377c6bde4f1a7bde34fc3faa1"
CATCHMENT_NAMES = {"6269342": "Chattooga", "11730084": "Stevens Creek", "6280111": "Broad River"}
DOIS = {"p9": "https://doi.org/10.5066/P9A682GW", "f7": "https://doi.org/10.5066/F7DN436B"}


def _read(path, expected):
    data = Path(path).read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise ValueError("Original input differs: " + str(path))
    return json.loads(data.decode("utf-8")), {"bytes": len(data), "sha256": actual}


def _decimal(value):
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError("Annual values and uncertainty must be finite")
    return result


def _text(value):
    return format(value, "f")


def _ratio(numerator, denominator):
    if denominator <= 0:
        raise ValueError("A ratio requires a positive source denominator")
    with localcontext() as context:
        context.prec = 28
        return _text(numerator / denominator)


def build(preset_path, targets_path):
    preset, preset_receipt = _read(preset_path, P9_PRESET_SHA256)
    targets, targets_receipt = _read(targets_path, ORIGINAL_TARGET_SHA256)
    if (preset.get("schema") != "upstate.sparrow-candidate-course-preset/v1"
            or preset.get("source_id") != P9_SOURCE or len(preset.get("records", [])) != 7
            or targets.get("schema") != "upstate.usgs9072.original-target-records/v1"
            or targets.get("source", {}).get("id") != F7_SOURCE
            or len(targets.get("records", [])) != 11
            or targets.get("missing_exact_station_ids")):
        raise ValueError("Select the retained seven-target preset and complete eleven-record source")
    rows, selected = [], set()
    for old in preset["records"]:
        matching = [record for record in targets["records"]
                    if (record["station_id"], record["comid"], record["parameter"])
                    == (old["station_id"], old["comid"], old["parameter"])]
        if len(matching) != 1:
            raise ValueError("Annual source match is missing or ambiguous")
        new = matching[0]
        if new["record_id"] in selected:
            raise ValueError("Repeated annual source identity")
        selected.add(new["record_id"])
        if (new["period_start"], new["period_end"]) != (old["period_start"], old["period_end"]):
            raise ValueError("The flow/reference periods differ")
        if new.get("issues") or new["unit"] != "kg/year" or new["uncertainty"]["unit"] != "kg/year":
            raise ValueError("Review source issues and original mass-rate units")
        if old["unit"] not in ("kg/year", "metric_tonnes/year"):
            raise ValueError("Unrecognized mapper target unit")
        if old["parameter"] == "sediment" and (new["series"] != "tss" or new["parameter_code"] != "00530"):
            raise ValueError("The retained sediment targets require the original TSS series")
        factor = Decimal(1000 if old["unit"] == "metric_tonnes/year" else 1)
        value = _decimal(new["value_exact"]) / factor
        standard_error = _decimal(new["uncertainty"]["value_exact"]) / factor
        old_value = _decimal(old["value"])
        if value <= 0 or standard_error <= 0:
            raise ValueError("Expected positive retained annual targets and published standard errors")
        # Every selected retained P9 cell has four decimal places. The inclusive
        # half-quantum also covers the exact halfway Broad River TSS value.
        quantum = Decimal("0.0001")
        if old_value != old_value.quantize(quantum):
            raise ValueError("Mapper precision differs from this retained edition")
        difference = value - old_value
        within = abs(difference) <= quantum / 2
        if not within:
            raise ValueError("Matched source editions differ beyond retained mapper precision")
        code = new["parameter_code"]
        total = int(new["row"]["n_wq_obs_" + code])
        censored = int(new["row"]["n_wq_censored_" + code])
        if not 0 <= censored <= total or total <= 0:
            raise ValueError("Invalid original sampling counts")
        source_area = _decimal(new["row"]["area"])
        gauge_area = _decimal(new["row"]["flow_station_area"])
        rows.append({
            "p9_record_id": old["record_id"], "f7_record_id": new["record_id"],
            "p9_catchment_id": old["catchment_id"], "catchment_name": CATCHMENT_NAMES[old["comid"]],
            "station_id": new["station_id"], "flow_station_id": new["flow_station_id"],
            "comid": new["comid"], "parameter": new["parameter"], "series": new["series"],
            "parameter_code": code, "comparison_unit": old["unit"],
            "p9_value_exact": _text(old_value), "f7_value_exact": _text(value),
            "f7_standard_error_exact": _text(standard_error),
            "difference_exact": _text(difference),
            "mapper_half_quantum_exact": _text(quantum / 2),
            "within_mapper_precision": within,
            "difference_in_published_standard_errors": _ratio(abs(difference), standard_error),
            "relative_standard_error_percent": _ratio(100 * standard_error, value),
            "published_final_method": new["final_method"],
            "selected_load_field": new["selected_load_field"],
            "selected_standard_error_field": new["selected_standard_error_field"],
            "period_start": new["period_start"], "period_end_exclusive": new["period_end"],
            "water_quality_start": new["temporal_basis"]["water_quality_start"],
            "water_quality_end_inclusive": new["temporal_basis"]["water_quality_end"],
            "reference_base_year": new["temporal_basis"]["reference_base_year"],
            "detrended_to_reference_year": new["temporal_basis"]["detrended"],
            "water_quality_observations": total, "censored_observations": censored,
            "censored_observations_percent": _ratio(Decimal(100 * censored), Decimal(total)),
            "source_station_area_km2": _text(source_area),
            "published_flow_station_area_km2": _text(gauge_area),
            "station_area_minus_gauge_area_percent_of_gauge": _ratio(100 * (source_area - gauge_area), gauge_area),
            "source_member": new["member"]["member"], "source_member_sha256": new["member"]["sha256"],
            "source_record_number": new["record_number"], "source_ending_line": new["ending_line"],
            "p9_record": old, "f7_record": new,
        })
    return {
        "schema": SCHEMA, "title": "Upper Savannah annual reference editions",
        "original_inputs": {"p9_preset": preset_receipt, "f7_target_records": targets_receipt},
        "source_ids": {"p9": P9_SOURCE, "f7": F7_SOURCE}, "source_urls": DOIS,
        "p9_preparation_id": preset["preparation_id"], "f7_source": targets["source"],
        "interpretation": {
            "relationship": "Seven original station, reach, constituent and period matches agree within the retained P9 mapper precision. Treat these as related reference editions when interpreting model comparisons.",
            "uncertainty": "F7 supplies published standard errors for the selected final estimators. These are uncertainty on annual reference estimates; they are not confidence intervals or observations of model error.",
            "time": "The annual rates use the 1999-10-01 to 2014-10-01 exclusive flow window and 2012 reference conditions. Station-specific water-quality windows and detrending flags remain separate original fields.",
            "sampling": "Counts and censored counts describe the original source samples used in annual-load estimation. They do not establish a new independent holdout sample.",
            "geography": "The successor preparation reuses original retained reach catchments and records a new source identity. Published flow-station drainage areas remain explicit; a station name alone never changes the catchment.",
            "units": "Original F7 values and standard errors are kg/year. The two TSS comparisons divide both by exactly 1000 to match P9 metric tonnes/year.",
            "continuation": "Use the original annual importer to prepare and bind the selected F7 source edition. Review reference-error sensitivity against saved native comparisons while preserving their source edition and training/validation membership.",
        },
        "matches": rows,
        "additional_context_records": [record for record in targets["records"] if record["record_id"] not in selected],
        "summary": {
            "matched_records": len(rows), "additional_context_records": len(targets["records"]) - len(rows),
            "whole_catchment_groups": len({row["comid"] for row in rows}),
            "maximum_absolute_change_in_standard_errors": max(
                (row["difference_in_published_standard_errors"] for row in rows), key=Decimal),
            "minimum_relative_standard_error_percent": min(
                (row["relative_standard_error_percent"] for row in rows), key=Decimal),
            "maximum_relative_standard_error_percent": max(
                (row["relative_standard_error_percent"] for row in rows), key=Decimal),
        },
    }


CSV_FIELDS = (
    "catchment_name", "parameter", "series", "station_id", "flow_station_id", "comid",
    "comparison_unit", "p9_value_exact", "f7_value_exact", "f7_standard_error_exact",
    "relative_standard_error_percent", "difference_exact", "within_mapper_precision",
    "published_final_method", "selected_load_field", "selected_standard_error_field",
    "period_start", "period_end_exclusive", "water_quality_start", "water_quality_end_inclusive",
    "water_quality_observations", "censored_observations", "censored_observations_percent",
    "source_station_area_km2", "published_flow_station_area_km2",
    "p9_record_id", "f7_record_id", "p9_catchment_id",
    "source_member", "source_member_sha256", "source_record_number", "source_ending_line",
)


def csv_body(review):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(review["matches"])
    return output.getvalue()


def html_body(review):
    esc = lambda value: html.escape(str(value), quote=True)
    fmt = lambda value: format(Decimal(str(value)), ",.2f")
    first, second, originals = [], [], []
    for row in review["matches"]:
        first.append("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in (
            row["catchment_name"], row["parameter"], row["p9_value_exact"], row["f7_value_exact"],
            row["f7_standard_error_exact"], fmt(row["relative_standard_error_percent"]) + "%",
            row["comparison_unit"], row["published_final_method"])) + "</tr>")
        second.append("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in (
            row["catchment_name"], row["parameter"], row["station_id"], row["flow_station_id"],
            row["water_quality_start"] + " to " + row["water_quality_end_inclusive"],
            str(row["censored_observations"]) + " / " + str(row["water_quality_observations"]),
            row["source_station_area_km2"], row["published_flow_station_area_km2"])) + "</tr>")
    all_records = [row["f7_record"] for row in review["matches"]] + review["additional_context_records"]
    for record in all_records:
        label = record["station_id"] + " / " + record["series"].upper() + " / " + record["member"]["member"]
        originals.append("<details><summary>" + esc(label) + "</summary><pre>" +
                         esc(json.dumps(record, indent=2, ensure_ascii=False)) + "</pre></details>")
    guidance = "".join("<p>" + esc(value) + "</p>" for value in review["interpretation"].values())
    return """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upper Savannah annual reference editions</title>
<style>
body{font:15px/1.55 system-ui,sans-serif;color:#222;background:#fff;margin:0}
main{max-width:1250px;margin:0 auto;padding:28px 22px 50px}
h1{font-size:27px}h2{margin-top:32px;font-size:20px}p{max-width:95ch}
.table{overflow-x:auto;border:1px solid #ccc}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:9px 10px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
th{background:#eee}td{font-variant-numeric:tabular-nums}a{color:#222}
details{border:1px solid #ccc;margin:8px 0;padding:10px}summary{cursor:pointer;font-weight:600}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}code{overflow-wrap:anywhere}
@media print{main{padding:0}.table{overflow:visible}table{font-size:10px}details{break-inside:avoid}}
</style><main><h1>Upper Savannah annual reference editions</h1>
<p>Seven original annual targets across Chattooga, Stevens Creek and Broad River agree with the
retained mapper values at their published precision. The original annual-load release supplies
the standard errors, final estimators and station-specific sampling periods needed to interpret
reference sensitivity.</p>
<h2>Annual estimates and published standard errors</h2>
<p>Nutrient values are kg/year. TSS values and their standard errors are metric tonnes/year in this
comparison. Standard errors below remain in the same unit as their annual estimates.</p>
<div class="table"><table><thead><tr><th>Catchment</th><th>Parameter</th><th>P9 mapper</th>
<th>F7 annual source</th><th>Standard error</th><th>Relative SE</th><th>Unit</th><th>Final method</th>
</tr></thead><tbody>""" + "".join(first) + """</tbody></table></div>
<h2>Station periods and sampling</h2>
<p>Each annual estimate uses the published flow window 1 October 1999 through 30 September 2014.
The water-quality sample windows below are inclusive and station-specific.
Drainage areas are the original published source fields in km².</p>
<div class="table"><table><thead><tr><th>Catchment</th><th>Parameter</th><th>Source station</th>
<th>Flow gauge</th><th>Water-quality dates</th><th>Censored / total</th><th>Station area</th>
<th>Flow-gauge area</th></tr></thead><tbody>""" + "".join(second) + """</tbody></table></div>
<h2>Scientific interpretation</h2>""" + guidance + """
<h2>Original records</h2><p>All eleven received original records are retained below. Four additional
Savannah River nutrient records provide regional context and have their own upstream catchments.</p>""" + "".join(originals) + """
<h2>Source editions</h2><p><a href="https://doi.org/10.5066/P9A682GW">P9A682GW regional mapper release</a>
· <a href="https://doi.org/10.5066/F7DN436B">F7DN436B annual-load release</a></p>
<p><a href="reference-edition-bridge.json">Complete source review JSON</a> ·
<a href="reference-edition-bridge.csv">Seven-target comparison CSV</a></p></main></html>\n"""


def _publish(path, data):
    path = Path(path)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Retained review output differs: " + str(path))
        return
    descriptor, staging = tempfile.mkstemp(prefix="." + path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(staging, path)
        except FileExistsError:
            if path.read_bytes() != data:
                raise ValueError("Concurrent review output differs: " + str(path))
    finally:
        os.unlink(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preset", required=True)
    parser.add_argument("--targets", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    review = build(args.preset, args.targets)
    destination = Path(args.output)
    destination.mkdir(parents=True, exist_ok=True)
    bodies = {
        "reference-edition-bridge.json": json.dumps(review, indent=2, ensure_ascii=False) + "\n",
        "reference-edition-bridge.csv": csv_body(review),
        "reference-edition-bridge.html": html_body(review),
    }
    for name, body in bodies.items():
        _publish(destination / name, body.encode("utf-8"))
    print(json.dumps({"schema": SCHEMA, "output": str(destination.resolve()), "summary": review["summary"]}, indent=2))


if __name__ == "__main__":
    main()

"""Verified existing intervention quantities for the original Economic desk.

Read-only: never compiles land cover, acquires sources, or invokes a solver.
"""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re

from model import scenario_footprint
from model.common import verify_file

SCHEMA = "upstate.economic-quantity-source/v1"
CATALOGUES = (
    "source_data/sc_conservation_costs_20261013/catalogue.json",
    "source_data/forestry_gross_costs_2024/catalogue.json",
)
_SHA = re.compile(r"^[0-9a-f]{64}$")


def _id(value):
    if not isinstance(value, str) or not _SHA.fullmatch(value):
        raise ValueError("Use the original complete native identity.")
    return value


def _json(text):
    return json.loads(text, parse_constant=lambda value: (_ for _ in ()).throw(
        ValueError("Nonfinite source value: " + value)))


def _number(value, label):
    if isinstance(value, bool) or value is None:
        raise ValueError(label + " is unavailable; missing quantities are not zero.")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(label + " is not a retained decimal quantity.") from None
    if not result.is_finite() or result < 0:
        raise ValueError(label + " must be finite and nonnegative.")
    return format(result, "f")


def _catalogues():
    root = Path(__file__).resolve().parent.parent
    values, originals = [], []
    for relative in CATALOGUES:
        path = (root / relative).resolve()
        if not path.is_relative_to(root):
            raise ValueError("The cost catalogue leaves the installed application.")
        body = path.read_bytes()
        text = body.decode("utf-8")
        value = _json(text)
        if (value.get("schema") != "upstate.conservation-cost-catalogue/v1"
                or not isinstance(value.get("rows"), list)
                or not isinstance(value.get("sources"), list)):
            raise ValueError("Install the complete original cost catalogue: " + relative)
        if len({row["id"] for row in value["rows"]}) != len(value["rows"]):
            raise ValueError("The original cost catalogue repeats a row identity.")
        values.append(value)
        originals.append({"path": relative, "bytes": len(body),
                          "sha256": hashlib.sha256(body).hexdigest(), "original_text": text})
    if len({row["id"] for row in values}) != len(values):
        raise ValueError("The cost catalogue identities must remain distinct.")
    return values, originals


def quantity_source(provider, workspace, payload):
    """Resolve an explicitly selected report/alternative and existing footprint."""
    if not isinstance(payload, dict):
        raise ValueError("Choose the original report, zone and alternative.")
    _, source = provider._source(workspace, payload.get("report_id"))
    if source["source"]["sha256"] != _id(payload.get("report_sha256")):
        raise ValueError("The completed source report changed; reopen its original selection.")
    zone = next((row for row in source["zones"]
                 if row["zone_id"] == payload.get("zone_id")), None)
    if zone is None:
        raise ValueError("Choose the original reporting zone.")
    alternative = next((row for row in source["alternatives"]
                        if row["run_id"] == payload.get("run_id")), None)
    if alternative is None:
        raise ValueError("Choose an original compatible land-cover alternative.")
    run = workspace.inspect_run(_id(alternative["run_id"]))
    selection = run["selection"]
    if (selection.get("scenario_id") != alternative["scenario_id"]
            or selection.get("profile_id") != alternative["profile_id"]):
        raise ValueError("The native run differs from the completed report alternative.")
    choices = []
    for row in scenario_footprint.list_footprints(workspace):
        if row.get("run_id") == run["id"] and row.get("selection") == selection:
            choices.append({key: deepcopy(row.get(key)) for key in
                            ("id", "title", "created_at", "run_id", "selection", "summary")})
    choices.sort(key=lambda row: (str(row.get("created_at") or ""), row["id"]), reverse=True)
    common = {"schema": SCHEMA, "project": deepcopy(source["project"]),
              "report": {"id": source["producer_report_id"], "source": deepcopy(source["source"])},
              "zone": deepcopy(zone), "alternative": deepcopy(alternative),
              "footprint_choices": choices}
    if not payload.get("footprint_id"):
        return {**common, "context": None,
                "instruction": "Choose a retained footprint. If absent, use the original Scenario footprint preview for this run, then refresh; this read never creates one."}
    chosen_id = _id(payload["footprint_id"])
    if chosen_id not in {row["id"] for row in choices}:
        raise ValueError("The chosen footprint belongs to another original run or selection.")
    record = scenario_footprint.get_footprint(workspace, chosen_id, verify=True)
    descriptor = record["files"]["report"]
    report_path = verify_file(workspace.root, descriptor)
    body = Path(report_path).read_bytes()
    original_text = body.decode("utf-8")
    original = _json(original_text)
    # The saved summary must be exactly the complete verified report, not an
    # edited summary beside the retained original.
    for key in ("run_id", "selection", "request", "summary", "transitions",
                "baseline_classes", "final_classes", "patches"):
        if original.get(key) != record.get(key):
            raise ValueError("The saved footprint differs from its original " + key + ".")
    if record["run_id"] != run["id"] or record["selection"] != selection:
        raise ValueError("The selected original footprint and run differ.")
    binding = {"project_id": str(source["project"]["id"]),
               "report_id": source["producer_report_id"], "report_sha256": source["source"]["sha256"],
               "zone_id": zone["zone_id"], "run_id": run["id"],
               "scenario_id": selection["scenario_id"], "profile_id": selection["profile_id"],
               "grid_id": selection["grid_id"], "footprint_id": chosen_id,
               "footprint_sha256": descriptor["sha256"]}
    reference = {**binding, "file": deepcopy(descriptor), "selection": deepcopy(selection)}
    quantities = [{"key": "changed-area", "label": "Complete scenario net changed area",
                   "value": _number(record["summary"].get("net_changed_hectares"), "Net changed hectares"),
                   "unit": "ha", "basis": "native_changed_area", "source_ref": deepcopy(reference)}]
    seen = set()
    for row in record["transitions"]:
        if row["from_code"] == row["to_code"]:
            continue
        key = "transition:" + str(row["from_code"]) + ":" + str(row["to_code"])
        if key in seen:
            raise ValueError("The original footprint repeats a changed land-cover transition.")
        seen.add(key)
        quantities.append({"key": key,
                           "label": "Land-cover " + str(row["from_code"]) + " to " + str(row["to_code"]),
                           "value": _number(row.get("hectares"), "Transition hectares"),
                           "unit": "ha", "basis": "native_transition_area",
                           "source_ref": {**deepcopy(reference), "transition": deepcopy(row)}})
    catalogues, originals = _catalogues()
    context = {"schema": SCHEMA, "binding": binding, "quantities": quantities,
               "footprint": deepcopy(record), "footprint_original": {
                   **deepcopy(descriptor), "original_text": original_text},
               "catalogues": catalogues, "catalogue_originals": originals,
               "scope": "Whole original scenario intervention. Reporting-zone area is never a treatment quantity.",
               "read_only": True}
    return {**common, "context": context}

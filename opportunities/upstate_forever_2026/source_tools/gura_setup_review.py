"""Assemble and receive a scientific setup from the original saved Gura case.

This command composes the maintained Gura class catalog and plan with ordinary
Workspace scenarios, source import, and the scientific setup receiving workflow.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import socket
import sys

from model.common import atomic_bytes, atomic_json, digest, held, now, read_json
from model.workspace import Workspace
from model import setup_review
from source_tools import gura_comparison, receive_scientific_setup

REQUEST_SCHEMA = "upstate.gura-setup-request/v1"
ASSEMBLY_SCHEMA = "upstate.gura-setup-assembly/v1"
DESCRIPTIVE_FIELDS = {
    "title", "question", "domain_rationale", "validation", "roles",
    "source_collection_ids", "observation_ids", "expected_resolution_m",
    "expected_alternative_count", "notes",
}


def _bytes(path):
    selected = Path(path).resolve(strict=True)
    body = selected.read_bytes()
    return selected, body, hashlib.sha256(body).hexdigest(), json.loads(body)


def _retain(path, body):
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Retained original differs: " + str(path))
    else:
        atomic_bytes(path, body, immutable=True)


def _root(ws, value):
    output = Path(value).resolve()
    application = Path(__file__).resolve().parents[1]
    if output == ws.root or output.is_relative_to(ws.root):
        raise ValueError("Place Gura setup receiving outside the source Workspace")
    if output == application or output.is_relative_to(application):
        raise ValueError("Place Gura setup receiving outside the application")
    output.mkdir(parents=True, exist_ok=True)
    return output


def _request(value):
    if not isinstance(value, dict) or value.get("schema") != REQUEST_SCHEMA:
        raise ValueError("Select an " + REQUEST_SCHEMA + " document")
    if set(value) - (DESCRIPTIVE_FIELDS | {"schema"}):
        raise ValueError("Unknown Gura setup request field: " +
                         ", ".join(sorted(set(value) - (DESCRIPTIVE_FIELDS | {"schema"}))))
    return {name: value[name] for name in DESCRIPTIVE_FIELDS if name in value}


def _conversions(values):
    result = []
    for raw in values or []:
        parts = raw.split(":")
        if len(parts) != 2:
            raise ValueError("Use an explicit integer FROM:TO original-class conversion")
        try:
            left, right = (int(part) for part in parts)
        except ValueError as error:
            raise ValueError("Use an explicit integer FROM:TO original-class conversion") from error
        if str(left) != parts[0] or str(right) != parts[1]:
            raise ValueError("Write original class codes as canonical integers")
        result.append((left, right))
    return result


def _selection(ws, request, plan, alternatives, provenance_id=None):
    value = {
        **request, "schema": setup_review.SELECTION_SCHEMA,
        "grid_id": plan["grid_id"], "profile_id": plan["profile_id"],
        "baseline_scenario_id": plan["baseline_scenario_id"],
        "alternative_scenario_ids": alternatives,
    }
    sources = list(value.get("source_collection_ids", []))
    for key in [plan["source_collection_id"], provenance_id]:
        if key is not None and key not in sources:
            sources.append(key)
    value["source_collection_ids"] = sources
    return setup_review.normalize(value)


def _readable(ws, selection, plan, selected_cases, receipt_sha):
    import html
    esc = lambda value: html.escape(str(value), quote=True)
    grid = ws.get_grid(selection["grid_id"])
    profile = ws._get("profiles", selection["profile_id"])
    cases = []
    for case in selected_cases:
        source = case.get("source_class", {})
        target = case.get("target_class", {})
        changes = json.dumps(case["scenario"]["patches"], ensure_ascii=False, indent=2)
        support = ("{} cells; {} ha".format(source["reporting_cells"], source["reporting_area_ha"])
                   if "reporting_cells" in source and "reporting_area_ha" in source
                   else "See the explicit retained scenario masks and source catalog")
        cases.append("<tr><td>" + esc(case["key"]) + "</td><td>" +
                     esc(case.get("title", case["scenario"]["title"])) +
                     "</td><td>" + esc(support) + "</td><td><pre>" + esc(changes) + "</pre></td></tr>")
    rows = []
    for item in plan["inventory"]["classes"]:
        rows.append("<tr><td>" + esc(item["code"]) + "</td><td>" + esc(item["label"]) +
                    "</td><td>" + esc(item["reporting_cells"]) + "</td><td>" +
                    esc(item["reporting_area_ha"]) + "</td></tr>")
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>" + esc(selection["title"]) + "</title><style>"
            "body{font:15px/1.5 system-ui,sans-serif;color:#181818;background:#fff;max-width:1120px;margin:32px auto;padding:0 20px}"
            "h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;margin:16px 0}"
            "th,td{border:1px solid #bbb;text-align:left;padding:8px;vertical-align:top}"
            "th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}"
            "code{overflow-wrap:anywhere}a{color:#222}dd{margin-bottom:12px}</style>"
            "<h1>" + esc(selection["title"]) + "</h1><p>" + esc(selection["question"]) +
            "</p><h2>Original project and analytical scope</h2><dl><dt>Project</dt><dd>" +
            esc(ws.project["title"]) + " <code>" + esc(ws.project["id"]) +
            "</code></dd><dt>Reporting and model domain</dt><dd>" + esc(selection["domain_rationale"]) +
            "</dd><dt>Actual selected grid</dt><dd>" + esc(grid["grid"]["resolution_m"]) +
            " m; " + esc(grid["grid"].get("crs_name") or grid["grid"].get("crs")) +
            "; " + esc(plan["inventory"]["pixel_area_ha"]) +
            " ha per cell</dd><dt>Profile</dt><dd>" + esc(profile["title"]) +
            "</dd><dt>Original receiving file SHA-256</dt><dd><code>" + esc(receipt_sha) +
            "</code></dd></dl><h2>Explicit alternatives</h2><table><thead><tr><th>Key</th>"
            "<th>Scenario</th><th>Original source support</th><th>Exact patches</th></tr></thead>"
            "<tbody>" + "".join(cases) + "</tbody></table>"
            "<h2>Original reporting-mask class inventory</h2><table><thead><tr><th>Code</th>"
            "<th>Original label</th><th>Cells</th><th>Area (ha)</th></tr></thead><tbody>" +
            "".join(rows) + "</tbody></table><h2>Validation proposal</h2><p>" +
            esc(selection["validation"]["method"]) + "</p><p>" +
            esc(selection["validation"]["intended_comparison"]) + "</p><p>" +
            esc(selection["validation"]["limitations"]) +
            "</p><h2>Retained source definitions</h2><ul>"
            "<li><a href=\"original-receiving.json\">Original receiving record</a></li>"
            "<li><a href=\"original-request.json\">Original setup request</a></li>"
            "<li><a href=\"contrast-plan.json\">Verified original class plan</a></li>"
            "<li><a href=\"class-catalog.json\">Actual source-class catalog</a></li>"
            "<li><a href=\"assembly.json\">Exact assembled selection and provenance</a></li>"
            "</ul></html>")


def assemble(args):
    ws = Workspace(args.workspace)
    if not args.output_dir:
        raise ValueError("Select an owned --output-dir")
    output = _root(ws, args.output_dir)
    receipt_path, receipt_body, receipt_sha, receipt = _bytes(args.receiving)
    if args.catalog:
        if args.request or args.plan or args.convert or args.case:
            raise ValueError("Catalog mode takes only the actual receipt and source selection")
        catalog = gura_comparison.catalog(receipt_path, zone_id_field=args.zone_id_field, workspace=ws)
        value = {
            "schema": "upstate.gura-setup-catalog/v1",
            "project": ws.project, "workspace": str(ws.root),
            "original_receiving_sha256": receipt_sha,
            "catalog": catalog, "saved_setup_choices": setup_review.catalog(ws),
        }
        atomic_json(output / "gura-setup-catalog.json", value)
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return 0
    if not args.request:
        raise ValueError("Provide an explicit scientific --request")
    if bool(args.plan) == bool(args.convert):
        raise ValueError("Choose either an explicit saved --plan or one or more --convert FROM:TO values")
    if args.case and not args.plan:
        raise ValueError("Named --case selections apply only to an explicit saved --plan")
    if args.plan and args.zone_id_field:
        raise ValueError("A saved plan already retains its original zone field")
    request_path, request_body, request_sha, raw_request = _bytes(args.request)
    request = _request(raw_request)
    plan_body = None
    original_plan_sha = None
    if args.plan:
        plan_path, plan_body, original_plan_sha, original_plan = _bytes(args.plan)
        # The maintained original checker rereads the actual mask/classes and
        # verifies the plan against this exact original Workspace selection.
        checked = gura_comparison._check_plan(receipt_path, plan_path, workspace=ws)
        plan = checked[-1]
        if plan != original_plan:
            raise ValueError("The original plan changed while it was admitted")
        if plan_path.read_bytes() != plan_body:
            raise ValueError("The original plan bytes changed while it was admitted")
    else:
        pairs = _conversions(args.convert)
        plan = gura_comparison.make_plan(receipt_path, conversions=pairs,
                                         zone_id_field=args.zone_id_field, workspace=ws)
    if receipt_path.read_bytes() != receipt_body:
        raise ValueError("The original receiving record changed while it was admitted")
    available = {case["key"]: case for case in plan["cases"]}
    selected_keys = list(args.case) if args.case else [case["key"] for case in plan["cases"]]
    if (not selected_keys or len(set(selected_keys)) != len(selected_keys)
            or any(key not in available for key in selected_keys)):
        raise ValueError("Select unique existing alternative keys from the actual retained plan")
    selected_cases = [available[key] for key in selected_keys]
    # Native scenario_spec and Workspace.save_scenario retain their existing
    # validation. Validate the descriptive request before any Workspace mutation.
    _selection(ws, request, plan, [])
    for key in request.get("source_collection_ids", []):
        ws._get("sources", key)
    for key in request.get("observation_ids", []):
        ws._get("observations", key)
    identity = {
        "project_id": ws.project["id"], "workspace": str(ws.root),
        "receiving_sha256": receipt_sha, "request_sha256": request_sha,
        "plan_id": plan["id"], "original_plan_sha256": original_plan_sha,
        "selected_case_keys": selected_keys,
    }
    operation_id = digest(identity)
    with held(output / ".gura-setup.lock", blocking=False):
        admission_path = output / "assembly-admission.json"
        if admission_path.exists():
            admission = read_json(admission_path)
            if admission["identity"] != identity:
                raise ValueError("Gura setup output already belongs to another original source selection")
        else:
            admission = {
                "schema": "upstate.gura-setup-admission/v1",
                "identity": identity, "operation_id": operation_id, "started_at": now(),
                "accepting_host": socket.gethostname(), "interpreter": sys.executable,
                "python": platform.python_version(),
            }
            atomic_json(admission_path, admission, immutable=True)
        retained = output / "assembly"
        retained.mkdir(parents=True, exist_ok=True)
        _retain(retained / "original-receiving.json", receipt_body)
        _retain(retained / "original-request.json", request_body)
        if plan_body is not None:
            _retain(retained / "original-plan.json", plan_body)
        atomic_json(retained / "contrast-plan.json", plan, immutable=True)
        atomic_json(retained / "class-catalog.json", plan["inventory"], immutable=True)
        with held(ws.root / ".workspace.lock", blocking=False):
            scenarios = [ws.save_scenario(case["scenario"]) for case in selected_cases]
            ids = [scenario["id"] for scenario in scenarios]
            if len(set(ids)) != len(ids):
                raise ValueError("Selected alternatives produce duplicate native scenarios")
            selection = _selection(ws, request, plan, ids)
            record = {
                "schema": ASSEMBLY_SCHEMA, "project": ws.project,
                "created_at": admission["started_at"], "operation_id": operation_id,
                "original_receiving": {"bytes": len(receipt_body), "sha256": receipt_sha},
                "original_request": {"bytes": len(request_body), "sha256": request_sha},
                "original_plan_sha256": original_plan_sha,
                "plan_id": plan["id"], "catalog_id": plan["inventory"]["id"],
                "selected_case_keys": selected_keys,
                "grid_id": plan["grid_id"], "profile_id": plan["profile_id"],
                "baseline_scenario_id": plan["baseline_scenario_id"],
                "alternatives": [
                    {"key": case["key"], "scenario": scenario,
                     "planned_source_cells": case.get("planned_source_cells"),
                     "planned_source_area_ha": case.get("planned_source_area_ha")}
                    for case, scenario in zip(selected_cases, scenarios)
                ],
                "selection_before_provenance_import": selection,
                "original_source_collection_id": plan["source_collection_id"],
                "native_grid": plan["inventory"]["native_grid"],
                "pixel_area_ha": plan["inventory"]["pixel_area_ha"],
                "source_reference": plan.get("source_reference"),
            }
            atomic_json(retained / "assembly.json", record, immutable=True)
            _retain(retained / "index.html",
                    _readable(ws, selection, plan, selected_cases, receipt_sha).encode("utf-8"))
            members = ["original-receiving.json", "original-request.json",
                       "contrast-plan.json", "class-catalog.json", "index.html"]
            if plan_body is not None:
                members.append("original-plan.json")
            def descriptor(name):
                body = (retained / name).read_bytes()
                return {"path": name, "sha256": hashlib.sha256(body).hexdigest()}
            manifest = {
                "schema": "upstate.sources/v1", "title": selection["title"] + " | original Gura setup",
                "captured_at": admission["started_at"],
                "scope": {"project_id": ws.project["id"], "operation_id": operation_id,
                          "original_source_collection_id": plan["source_collection_id"]},
                "entries": [{
                    "id": "gura-scientific-setup-assembly", "title": selection["title"],
                    "kind": "document", "uri": "upstate:gura-setup:" + operation_id,
                    "vintage": admission["started_at"], **descriptor("assembly.json"),
                    "companions": [descriptor(name) for name in members],
                    "metadata": {"role": "GURA_SCIENTIFIC_SETUP_ASSEMBLY",
                                 "method": "Retained original Gura class plan and ordinary saved scenarios",
                                 "grid_id": plan["grid_id"], "profile_id": plan["profile_id"]},
                }],
                "notes": ["Original source definitions and explicit analytical selection retained together."],
            }
            atomic_json(retained / "sources.json", manifest, immutable=True)
            provenance = ws.import_sources(retained / "sources.json")
            selection = _selection(ws, request, plan, ids, provenance["id"])
        # The receiving workflow takes the Workspace lock within its own
        # source capture, original review, and portable backup operations.
        selection_path = output / "scientific-setup-selection.json"
        atomic_json(selection_path, selection, immutable=True)
        arguments = argparse.Namespace(
            workspace=str(ws.root), selection=str(selection_path),
            output_dir=str(output / "review-receiving"), operation_id=operation_id,
            catalog=False,
        )
        result = receive_scientific_setup.run(arguments)
        receiving = read_json(output / "review-receiving" / "receiving-result.json")
        final = {
            "schema": "upstate.gura-setup-receiving/v1",
            "operation_id": operation_id, "project": ws.project,
            "selection": selection, "assembly_source_collection_id": provenance["id"],
            "selected_case_keys": selected_keys,
            "actual_grid_resolution_m": plan["inventory"]["native_grid"]["resolution_m"],
            "actual_pixel_area_ha": plan["inventory"]["pixel_area_ha"],
            "receiving": receiving, "result": "Original Gura setup assembled, scientific review packet exported, project reopened",
        }
        atomic_json(output / "gura-setup-result.json", final)
        print(json.dumps(final, ensure_ascii=False, indent=2))
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--receiving", required=True, type=Path,
                        help="Actual original Gura receiving.json for this Workspace")
    parser.add_argument("--request", type=Path, help="Explicit upstate.gura-setup-request/v1 JSON")
    parser.add_argument("--plan", type=Path, help="Explicit retained original Gura class-contrast plan")
    parser.add_argument("--convert", action="append", help="Explicit original FROM:TO class pair; repeat for alternatives")
    parser.add_argument("--case", action="append", help="Explicit case key from the selected --plan; repeat to choose a subset")
    parser.add_argument("--zone-id-field", help="Actual original watershed field for a newly built plan")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--catalog", action="store_true",
                        help="Read the original observed classes and existing setup selections")
    args = parser.parse_args(argv)
    return assemble(args)


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Continue an admitted Web Map through original GIS export, receive and reuse."""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
import sys
import time


def receive(application, workspace, source_collection_id, state_directory, timeout=240):
    application, workspace = Path(application).resolve(), Path(workspace).resolve()
    state_directory = Path(state_directory).resolve()
    state_directory.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator
    from gis_projects import GISProjects
    from model import gis_project as gis, gis_workspace
    from model.common import atomic_json, digest
    from model.webmap_sources import CONTEXT_PARENT_SHA256
    from eco_intelligence.profiling import profile

    record_path = state_directory / "webmap-gis-receiving.json"
    report_path = state_directory / "webmap-gis-receiving-result.json"
    operator = Operator(workspace, state_directory)
    try:
        key, adapter = operator.primary, GISProjects(operator)
        native = operator.ws(key)
        collection = native._get("sources", source_collection_id)
        admission = (collection.get("scope") or {}).get("webmap_admission")
        if not admission or admission.get("parent_sha256") != CONTEXT_PARENT_SHA256:
            raise ValueError("Choose the retained original ten-county map admission.")
        entries = [entry for entry in collection["entries"] if entry.get("webmap_source")]
        vectors = [entry for entry in entries if entry["kind"] == "vector"]
        contexts = [entry for entry in entries
                    if entry["webmap_source"]["role"] == "dated_county_context"]
        if len(vectors) != 1 or len(contexts) != 1:
            raise ValueError("Receive one original ten-county vector with its dated county context.")
        identity = {"project_id": native.project["id"], "source_collection_id": collection["id"],
                    "admission_id": admission["id"], "gis_builder_version": gis.VERSION,
                    "receiving_version": "typed-context-v1"}
        if record_path.is_file():
            receipt = json.loads(record_path.read_text(encoding="utf-8"))
            if receipt.get("identity") != identity:
                raise ValueError("This receiving state belongs to another source admission or GIS version. "
                                 "Keep its original tasks and use a separate state directory for this version.")
        else:
            receipt = {"schema": "upstate.webmap-gis-receiving/v1",
                       "identity": identity, "phases": {}}
            atomic_json(record_path, receipt)

        def complete(phase, action, payload):
            retained = receipt["phases"].get(phase)
            request = {"workspace": key, "action": action, "payload": payload}
            operation = "eco264b-webmap-gis-" + digest(identity)[:16] + "-" + phase
            if retained:
                if retained["request"] != request:
                    raise ValueError("The retained native GIS operation has another selection.")
                task = operator.task(retained["task_id"])
            else:
                task = operator.submit(key, action, payload, operation)
                if any(task.get(name) != value for name, value in request.items()):
                    raise ValueError("The native queue returned a different GIS operation.")
                receipt["phases"][phase] = {
                    "request": request, "task_id": task["id"],
                    "operation_id": task["operation_id"]}
                atomic_json(record_path, receipt)
            if any(task.get(name) != value for name, value in request.items()):
                raise ValueError("The retained native GIS task changed its original request.")
            if task["operation_id"] != receipt["phases"][phase]["operation_id"]:
                raise ValueError("The native GIS operation identity changed.")
            if task["state"] in {"interrupted", "failed", "cancelled"}:
                task = operator.resume(task["id"])
            deadline = time.monotonic() + timeout
            while task["state"] in {"queued", "running"}:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Original GIS operation remains active: " + task["id"])
                time.sleep(0.1)
                task = operator.task(task["id"])
            if task["state"] != "complete":
                raise RuntimeError(json.dumps(task, ensure_ascii=False))
            receipt["phases"][phase]["result_id"] = task["result"]["id"]
            atomic_json(record_path, receipt)
            return task

        def transfer(record):
            ticket = record["archive_download"]
            stream, retained = operator.open_download(ticket["id"])
            try:
                uploaded = operator.receive_upload(
                    stream, ticket["bytes"], ticket["filename"], "application/zip")
            finally:
                stream.close()
            if (uploaded["bytes"], uploaded["sha256"]) != (ticket["bytes"], ticket["sha256"]):
                raise AssertionError("The native GIS upload differs from its original download.")
            return uploaded

        def project(kind, project_id):
            directory = native.root / ("gis-exports" if kind == "export" else "gis-received") / project_id / "project"
            checked = gis.verify(directory)
            manifest = gis.load(directory / "project.json")
            return directory, manifest, checked

        def source_browser(directory, manifest):
            html = (directory / "OPEN_GIS.html").read_text(encoding="utf-8")
            selected = re.search(r'<script type="application/json" id="project-data">([\s\S]*?)</script>', html)
            if selected is None or 'id="source-workspace"' not in html:
                raise AssertionError("The offline GIS source desk is missing.")
            embedded = json.loads(selected.group(1))
            if embedded["edition_id"] != manifest["edition_id"]:
                raise AssertionError("The offline source desk belongs to another GIS edition.")
            tables = {}
            originals = {row["id"]: row for row in manifest.get("attachments", [])}
            for row in embedded.get("attachments", []):
                original = originals[row["id"]]
                if gis.attachment_metadata(manifest, original)["kind"] != "table":
                    continue
                primary = original["files"][0]
                with gis.local(directory, primary["path"]).open("r", encoding="utf-8-sig", newline="") as stream:
                    literal = list(csv.reader(stream))
                preview = row.get("browser_table") or {}
                if (not preview.get("complete") or preview.get("columns") != literal[0]
                        or preview.get("rows") != literal[1:]
                        or preview.get("source_sha256") != primary["sha256"]
                        or preview.get("source_bytes") != primary["bytes"]):
                    raise AssertionError("The offline source desk changed or omitted original county table values.")
                tables[row["id"]] = {"rows": len(preview["rows"]), "columns": preview["columns"]}
            if len(tables) < 2:
                raise AssertionError("The offline source desk omitted an original county table.")
            return tables

        def originals(manifest):
            rows = []
            for layer in manifest["layers"]:
                rows.extend(layer["originals"])
            for attachment in manifest.get("attachments", []):
                rows.extend(attachment["files"])
            return rows

        source_specs = [gis_workspace.source_layer(native, {
            "source_collection_id": collection["id"], "source_id": entry["id"]})
            for entry in entries]
        source_expected = {row["id"]: row for row in source_specs}
        payload = {
            "title": (collection["title"] + " — editable GIS")[:240],
            "project_crs": "EPSG:4326", "source_collection_id": collection["id"],
            "sources": [{"source_collection_id": collection["id"], "source_id": entry["id"]}
                        for entry in entries],
            "scenario_run_ids": [], "comparison_ids": [], "include_grid": True,
            "notes": ["Selected admitted map layers and their retained original attributes.",
                      "The Census table describes whole counties and retains its original population date and estimate vintage."]}
        exported = complete("export", "gis.project.export", payload)
        export_view = adapter.describe(key, "export", exported["result"]["id"])
        exported_root, exported_project, exported_check = project("export", exported["result"]["id"])
        source_browser_tables = source_browser(exported_root, exported_project)
        selected = {row["id"]: (row, row["originals"]) for row in exported_project["layers"]}
        selected.update({row["id"]: (row, row["files"]) for row in exported_project.get("attachments", [])})
        if set(selected) != set(source_expected):
            raise AssertionError("The GIS project omitted or added an original admitted source.")
        for source_id, spec in source_expected.items():
            row, files = selected[source_id]
            if row["source"] != spec["source"]:
                raise AssertionError("The GIS project changed scientific source metadata.")
            expected = [(item["path"], item["bytes"], item["sha256"])
                        for item in [spec["file"], *spec["companions"]]]
            actual = [(item["source_path"], item["bytes"], item["sha256"]) for item in files]
            if actual != expected:
                raise AssertionError("The GIS project changed a primary or declared companion binding.")
        vector_entry = vectors[0]
        layer = next(row for row in exported_project["layers"]
                     if row["source"].get("id") == vector_entry["id"])
        original_path, _ = native.source_file(collection["id"], vector_entry["id"])
        county_features = json.loads(original_path.read_text(encoding="utf-8"))["features"]
        import fiona
        from pyproj import CRS
        from shapely.geometry import shape
        with fiona.open(gis.local(exported_root, layer["working_path"]),
                        layer=layer["data"]["layer"]) as data:
            county_working = [{"properties": dict(row["properties"]),
                               "geometry": shape(row["geometry"])} for row in data]
            if not CRS.from_user_input(data.crs_wkt or data.crs).equals(CRS.from_epsg(4326)):
                raise AssertionError("The native GIS working layer changed the admitted source CRS.")
        if len(county_features) != 10 or len(county_working) != 10:
            raise AssertionError("The editable GIS layer lost an original county.")
        fields = layer["data"]["source_field_map"]
        original_counties = {row["properties"]["CNTYNAME"]: row for row in county_features}
        working_counties = {row["properties"][fields["CNTYNAME"]]: row for row in county_working}
        if (len(original_counties) != 10 or len(working_counties) != 10
                or set(original_counties) != set(working_counties)):
            raise AssertionError("The editable GIS layer changed an original county identity.")
        for county, original in original_counties.items():
            working = working_counties[county]
            if any(working["properties"].get(fields[name]) != value
                   for name, value in original["properties"].items()):
                raise AssertionError("An original county attribute changed in the editable GIS layer.")
            if not working["geometry"].equals(shape(original["geometry"])):
                raise AssertionError("An original county polygon changed in the editable GIS layer: " + county)
        if layer["source"].get("provenance", {}).get("parent_sha256") != CONTEXT_PARENT_SHA256:
            raise AssertionError("The native GIS manifest omitted the original map lineage.")
        context = next(row for row in exported_project["attachments"]
                       if row["source"].get("id") == contexts[0]["id"])
        if context["source"].get("geography_basis") != "whole_county":
            raise AssertionError("The GIS context lost its original whole-county geography.")

        uploaded = transfer(export_view)
        received = complete("receive", "gis.project.receive", {"upload_id": uploaded["id"]})
        received_root, received_project, received_check = project("received", received["result"]["id"])
        if received_check["fingerprint"] != exported_check["fingerprint"]:
            raise AssertionError("The independently received GIS edition differs from its original export.")
        if received_project != exported_project:
            raise AssertionError("The independently received GIS manifest changed.")
        received_view = adapter.describe(key, "received", received["result"]["id"])
        viewer, _ = adapter.member(key, "received", received["result"]["id"], "OPEN_GIS.html")
        stream, _ = operator.open_download(viewer["id"])
        stream.close()

        adopted = complete("adopt", "gis.project.adopt-sources", {
            "receipt_id": received["result"]["id"],
            "title": "Received original county GIS sources",
            "reason": "Continue the independently received county working layer with its original map and dated context.",
            "layer_ids": [row["id"] for row in received_project["layers"]]})
        adopted_collection = native._get("sources", adopted["result"]["source_collection_id"])
        adopted_vectors = [row for row in adopted_collection["entries"] if row["kind"] == "vector"]
        if len(adopted_vectors) != 1:
            raise AssertionError("The original source importer did not retain the received county layer.")
        source_binding = adopted_vectors[0]["received_gis"]["source"]
        if (source_binding["collection_id"], source_binding["id"]) != (collection["id"], vector_entry["id"]):
            raise AssertionError("The adopted GIS layer lost its original source identity.")
        typed_tables = []
        for original in [entry for entry in entries if entry["kind"] == "table"]:
            matches = [entry for entry in adopted_collection["entries"]
                       if entry.get("received_gis", {}).get("context_role") == "attachment"
                       and entry["received_gis"].get("source", {}).get("collection_id") == collection["id"]
                       and entry["received_gis"].get("source", {}).get("id") == original["id"]]
            if len(matches) != 1 or matches[0]["kind"] != "table":
                raise AssertionError("The adopted original context is not one native typed table.")
            table = matches[0]
            spec = next(row for row in source_specs if row["source"]["id"] == original["id"])
            if table["received_gis"]["source"] != spec["source"]:
                raise AssertionError("The adopted table changed its original logical source metadata.")
            for name in (*gis_workspace.SOURCE_METADATA_FIELDS, "role", "conversion"):
                if name != "webmap_source" and name in spec["source"]:
                    if table.get(name) != spec["source"][name]:
                        raise AssertionError("The adopted table changed scientific metadata: " + name)
            if (table["uri"], table["vintage"], table.get("units")) != (
                    original["uri"], original["vintage"], spec.get("units")):
                raise AssertionError("The adopted table lost its source URI, vintage or declared units.")
            expected_files = [(body["filename"], body["bytes"], body["sha256"])
                              for body in [original["body"], *original.get("companions", [])]]
            actual_files = [(body["filename"], body["bytes"], body["sha256"])
                            for body in [table["body"], *table.get("companions", [])]]
            if actual_files != expected_files:
                raise AssertionError("The adopted table changed a primary or ordered companion identity.")
            original_table, _ = native.source_file(collection["id"], original["id"])
            adopted_table, _ = native.source_file(adopted_collection["id"], table["id"])
            original_profile, adopted_profile = profile(original_table), profile(adopted_table)
            if (adopted_profile != original_profile or adopted_profile.get("format") != "table"
                    or adopted_profile.get("population") != "complete" or adopted_profile.get("rows") != 10):
                raise AssertionError("The actual native profiler could not reopen all ten original table rows.")
            typed_tables.append({"original_source_id": original["id"], "source_id": table["id"],
                                 "bytes": table["body"]["bytes"], "sha256": table["body"]["sha256"],
                                 "profile": adopted_profile,
                                 "geography_basis": table.get("geography_basis"),
                                 "vintage": table["vintage"], "units": table.get("units")})
        reexported = complete("reexport", "gis.project.export", {
            "title": "Received county sources — complete GIS handover",
            "project_crs": "EPSG:4326",
            "source_collection_id": adopted_collection["id"],
            "sources": [{"source_collection_id": adopted_collection["id"], "source_id": row["id"]}
                        for row in adopted_vectors],
            "notes": ["Continue received county layers with their automatically retained original files and dated source context."]})
        reexport_view = adapter.describe(key, "export", reexported["result"]["id"])
        reexport_root, reexport_project, reexport_check = project("export", reexported["result"]["id"])
        reexport_browser_tables = source_browser(reexport_root, reexport_project)
        # The original adopter associates retained context with the selected working
        # layer; selecting that layer alone must include every original file.
        required = {(row["bytes"], row["sha256"]) for row in originals(exported_project)}
        carried = {(row["bytes"], row["sha256"]) for row in originals(reexport_project)}
        if not required <= carried:
            raise AssertionError("Selecting the adopted working layer omitted original source context.")
        for table in typed_tables:
            matches = [row for row in reexport_project.get("attachments", [])
                       if row.get("source", {}).get("collection_id") == adopted_collection["id"]
                       and row.get("source", {}).get("id") == table["source_id"]]
            if len(matches) != 1 or gis.attachment_metadata(reexport_project, matches[0])["kind"] != "table":
                raise AssertionError("Working-layer-only re-export lost the adopted table type.")
            row = matches[0]
            expected_spec = gis_workspace.source_layer(native, {
                "source_collection_id": adopted_collection["id"], "source_id": table["source_id"]})
            if row["source"] != expected_spec["source"]:
                raise AssertionError("Re-export changed the adopted table's full scientific source binding.")
            if [(item["source_path"], item["bytes"], item["sha256"]) for item in row["files"]] != [
                    (item["path"], item["bytes"], item["sha256"])
                    for item in [expected_spec["file"], *expected_spec["companions"]]]:
                raise AssertionError("Re-export changed an adopted table or companion binding.")
        reuploaded = transfer(reexport_view)
        received_again = complete("receive-reexport", "gis.project.receive", {"upload_id": reuploaded["id"]})
        _, _, received_again_check = project("received", received_again["result"]["id"])
        if received_again_check["fingerprint"] != reexport_check["fingerprint"]:
            raise AssertionError("The re-exported GIS handover did not receive independently.")

        outcome = {
            "status": "receiving_complete", **identity, "workspace_key": key,
            "original_counties": [row["properties"]["CNTYNAME"] for row in county_features],
            "source_files_with_companions": sum(len(files) for _, files in selected.values()),
            "export_id": exported["result"]["id"], "export": exported_check,
            "received_id": received["result"]["id"], "received": received_check,
            "adopted_source_collection_id": adopted_collection["id"],
            "reexport_id": reexported["result"]["id"], "reexport": reexport_check,
            "received_reexport_id": received_again["result"]["id"],
            "received_reexport": received_again_check,
            "retained_source_metadata": True, "original_county_attributes": True,
            "original_county_geometries": True,
            "typed_context_tables": typed_tables,
            "typed_context_profiles_reopened": True,
            "offline_source_browser_tables": source_browser_tables,
            "offline_reexport_browser_tables": reexport_browser_tables,
            "literal_original_table_values_in_offline_browser": True,
            "selected_working_layer_reexports_full_context": True,
            "native_tasks": {phase: row["task_id"] for phase, row in receipt["phases"].items()},
            "delivery": {"path": str(gis.local(native.root, reexport_view["archive"]["path"])),
                         "bytes": reexport_view["archive"]["bytes"],
                         "sha256": reexport_view["archive"]["sha256"]}}
        atomic_json(report_path, outcome)
    finally:
        operator.close()

    operator = Operator(workspace, state_directory)
    try:
        key, adapter = operator.primary, GISProjects(operator)
        for phase, retained in receipt["phases"].items():
            task = operator.task(retained["task_id"])
            if (task["state"] != "complete" or task["operation_id"] != retained["operation_id"] or
                    task["result"]["id"] != retained["result_id"]):
                raise AssertionError("Restart changed an original GIS operation.")
            if any(task.get(name) != value for name, value in retained["request"].items()):
                raise AssertionError("Restart changed an original GIS request.")
        for kind, project_id in (
                ("export", outcome["export_id"]), ("received", outcome["received_id"]),
                ("export", outcome["reexport_id"]), ("received", outcome["received_reexport_id"])):
            view = adapter.describe(key, kind, project_id)
            stream, _ = operator.open_download(view["archive_download"]["id"])
            stream.close()
        reopened_collection = operator.ws(key)._get("sources", outcome["adopted_source_collection_id"])
        for table in outcome["typed_context_tables"]:
            selected, entry = operator.ws(key).source_file(reopened_collection["id"], table["source_id"])
            if (entry["kind"] != "table" or entry["body"]["sha256"] != table["sha256"]
                    or profile(selected) != table["profile"]):
                raise AssertionError("Restart changed a retained typed table or its complete profile.")
        outcome.update(status="passed", restart_reopened=True)
        atomic_json(report_path, outcome)
        return outcome
    finally:
        operator.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--source-collection-id", required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=240)
    args = parser.parse_args()
    print(json.dumps(receive(args.application, args.workspace, args.source_collection_id,
                             args.state_directory, args.timeout), ensure_ascii=False, indent=2))

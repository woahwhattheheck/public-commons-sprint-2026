"""Operate the published scientific context through the maintained operator."""
from pathlib import Path
import argparse, json, os, sys, time
from urllib.parse import quote


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--domain-archive", type=Path)
    parser.add_argument("--domain-collection")
    parser.add_argument("--domain-source-id", default="upstate-wbd-upstream-domain-20261012")
    args = parser.parse_args()
    ROOT = args.output.resolve()
    APP = args.application.resolve()
    WORKSPACE = args.workspace.resolve()
    DOMAIN = args.domain_archive
    STATE = ROOT / "operator-state"
    MANIFEST = (args.manifest or APP / "source/annual-reference-assessment-20261013/sources.json").resolve()
    if ROOT == WORKSPACE or ROOT.is_relative_to(WORKSPACE):
        raise ValueError("Keep operation outputs outside the retained workspace.")
    sys.path[:0] = [str(APP / "operator"), str(APP)]
    from server import Operator
    from model.common import atomic_json, read_json

    ROOT.mkdir(parents=True, exist_ok=True)
    PROGRESS = ROOT / "working-project-progress.json"
    progress = read_json(PROGRESS) if PROGRESS.exists() else {"schema": "upstate.scientific-context-operation/v1", "tasks": [], "views": []}
    def write_progress():
        atomic_json(PROGRESS, progress)
    def opening():
        print(json.dumps({"stage": "opening maintained operator", "workspace": str(WORKSPACE)}), flush=True)
        return Operator(WORKSPACE, STATE, source_manifests=(MANIFEST,))
    operator = opening()
    key = operator.primary
    workspace = operator.ws(key)
    assert workspace.project["id"] == args.project_id, "Choose the stated original project."
    progress.update(workspace_key=key, project=workspace.project, host=os.uname().nodename)
    write_progress()
    print(json.dumps({"stage": "operator opened", "workspace": key, "project": workspace.project}), flush=True)

    def existing(suffix):
        operation_id = "ES9960-context-20261013-" + suffix
        matches = [task for task in operator.task_list(key) if task.get("operation_id") == operation_id]
        if len(matches) > 1:
            raise RuntimeError("Duplicate operation identity " + operation_id)
        return matches[0] if matches else None

    def queued(action, payload, suffix):
        operation_id = "ES9960-context-20261013-" + suffix
        task = operator.submit(key, action, payload, operation_id)
        if task["state"] in {"failed", "interrupted"}:
            operator.resume(task["id"])
            task = operator.task(task["id"])
        if task["action"] != action or task["workspace"] != key:
            raise RuntimeError("Operation identity belongs to another request")
        if task["id"] not in progress["tasks"]:
            progress["tasks"].append(task["id"])
            write_progress()
        end, last = time.monotonic() + 1200, 0
        while True:
            task = operator.task(task["id"])
            if task["state"] == "complete":
                print(json.dumps({"stage": "task complete", "action": action, "id": task["id"]}), flush=True)
                return task
            if task["state"] in {"failed", "cancelled", "interrupted"}:
                print(json.dumps({"stage": "task needs correction", "task": task}), flush=True)
                raise RuntimeError(action + ": " + json.dumps(task.get("error")))
            if time.monotonic() > end:
                raise RuntimeError("Original queued task remains active: " + task["id"])
            if time.monotonic() - last > 20:
                print(json.dumps({"stage": "task active", "action": action, "id": task["id"], "state": task["state"]}), flush=True)
                last = time.monotonic()
            time.sleep(1)

    try:
        known = existing("assessment-source")
        if known:
            context_task = queued("source.import", known["payload"], "assessment-source")
        else:
            registered = next(rid for rid, record in operator.registered.items()
                              if Path(record["path"]).resolve() == MANIFEST.resolve())
            preview = operator.preview_source({"registered_id": registered})
            context_task = queued("source.import", {"preview_id": preview["id"]}, "assessment-source")

        domain_collections = [collection for collection in workspace.sources()
                              if any(entry["id"] == args.domain_source_id
                                     for entry in collection["entries"])]
        if args.domain_collection:
            domain_collections = [item for item in domain_collections if item["id"] == args.domain_collection]
        if not domain_collections:
            if DOMAIN is None:
                raise ValueError("The selected existing domain source is absent; choose its original archive explicitly.")
            known = existing("domain-source")
            if known:
                domain_task = queued("source.import", known["payload"], "domain-source")
            else:
                with DOMAIN.open("rb") as stream:
                    upload = operator.receive_upload(stream, DOMAIN.stat().st_size,
                                                      quote(DOMAIN.name, safe=""), "application/zip")
                preview = operator.preview_source({"upload_id": upload["id"], "manifest_member": "sources.json"})
                domain_task = queued("source.import", {"preview_id": preview["id"]}, "domain-source")

        inventory_task = queued("annual-reference.inventory", {
            "source_edition": "southeast-sparrow-2012", "mode": "published",
            "huc8": [f"030601{i:02d}" for i in range(1, 8)]
        }, "annual-inventory")
        inventory = read_json(workspace.root / inventory_task["result"]["inventory"]["path"])
        selected = [{"record_id": row["record_id"], "catchment": "retained-source-reach"}
                    for row in inventory["records"] if not row["issues"]]
        assert len(selected) == 11, ("Unexpected original annual record selection", len(selected))
        annual_task = queued("annual-reference.import", {
            "source_edition": "southeast-sparrow-2012",
            "inventory_task_id": inventory_task["id"],
            "title": "Upper Savannah original eleven annual targets and five catchments",
            "comparability_note": (
                "Original published 2012 regional calibration targets retain their 1999-2014 "
                "source horizon. The 2024 and July 2026 assessment records are separate source "
                "editions. Jackson and Cohens Bluff are nested mainstem catchments; tributary "
                "and mainstem loads must not be summed."
            ),
            "records": selected
        }, "annual-import")
        print(json.dumps({"stage": "annual sources imported", "result": annual_task["result"]}), flush=True)

        spatial = operator.spatial_reviews[key]
        catalog = spatial.catalog()
        layers = catalog["layers"]
        def source_layer(source_id, source_collection_id):
            matches = [item for item in layers
                       if item.get("source_id") == source_id
                       and item.get("source_collection_id") == source_collection_id]
            if len(matches) != 1:
                raise RuntimeError("Expected one source layer: " + source_id + " " + str(len(matches)))
            return matches[0]
        point = source_layer("assessment-physical-geography159-20261013", context_task["result"]["id"])
        domain_candidates = [item for item in layers if item.get("source_id") == args.domain_source_id
                             and (not args.domain_collection or item.get("source_collection_id") == args.domain_collection)]
        if len(domain_candidates) != 1:
            raise ValueError("Choose one original domain collection and source ID.")
        domain = domain_candidates[0]
        catchment_binding = annual_task["result"]["binding"]["catchments"]
        basin = source_layer(catchment_binding["source_id"],
                             catchment_binding["source_collection_id"])
        progress["layers"] = {"assessment": point, "domain": domain, "annual_catchments": basin}
        write_progress()

        selections = [
            ("regional", "Upper Savannah | 159 assessment stations and original annual-reference catchments",
             {"layer_id": point["id"]}, {"layer_id": domain["id"]}, 159,
             "All 159 original station locations and 192 assessment records. Physical HUC membership "
             "uses the retained original 217-HUC geometry. Station-publisher and assessment-edition HUCs "
             "remain separate attributes. Annual-reference polygons retain their original nested extents."),
            ("prwd", "PRWD upstream | 18 physical assessment stations and 22 records",
             {"layer_id": point["id"], "where": {"PRWD_geometry": True}},
             {"layer_id": point["id"], "where": {"PRWD_geometry": True}}, 18,
             "Physical PRWD upstream membership contains 18 stations and 22 assessment records. "
             "Assessment-publisher HUC selection contains 17 stations and 21 records. RS-21014 is "
             "physically in Little Beaverdam Creek, and SV-809 is physically in Lower Tugaloo River."),
            ("huc-differences", "Six July 2026 assessment HUC differences | original coordinates retained",
             {"layer_id": point["id"], "where": {"assessment_geometry_differences": 1}},
             {"layer_id": point["id"], "where": {"assessment_geometry_differences": 1}}, 6,
             "These six July 2026 source-edition HUC values differ from physical point-in-polygon "
             "membership: RS-06190, SV-052, SV-164, SV-318, SV-353 and SV-809. Original published "
             "assessment values and native station identities remain unchanged in source attributes.")
        ]
        saved = []
        for suffix, title, selected_point, reference, expected, notes in selections:
            frame = spatial.frame({"reference": reference, "mode": "single",
                                   "size": {"width": 1200, "height": 800}})
            overlay = spatial.overlay({"selection": selected_point, "view": frame["view"],
                                       "limit": 500, "tolerance": 0})
            assert overlay["returned"] == expected and overlay.get("next_offset") is None, (
                suffix, overlay.get("returned"), overlay.get("next_offset"))
            payload = {
                "title": title, "reference": reference, "mode": "single", "view": frame["view"],
                "overlays": [
                    {"selection": {"layer_id": domain["id"]}, "label": "Original 217-HUC model domain",
                     "style": "solid", "width": 0.75, "opacity": 0.7, "visible": True},
                    {"selection": {"layer_id": basin["id"]}, "label": "Five original annual-reference catchments",
                     "style": "dash", "width": 1.25, "opacity": 0.85, "visible": True},
                    {"selection": selected_point, "label": title.split(" | ")[-1],
                     "style": "solid", "width": 3, "opacity": 1, "visible": True}
                ],
                "markers": [], "notes": notes
            }
            task = queued("spatial.review.save", payload, "map-" + suffix)
            row = {"key": suffix, "title": title, "review_id": task["result"]["id"],
                   "selected_count": expected, "selection": selected_point,
                   "source_sha256": overlay["source_sha256"], "view": frame["view"]}
            saved.append(row)
        progress["views"] = saved
        write_progress()
        operator.close()
        operator = opening()
        key = operator.primary
        workspace = operator.ws(key)
        spatial = operator.spatial_reviews[key]
        for row in saved:
            review = workspace._get("spatial-reviews", row["review_id"])
            validation = spatial.validate_saved(review)
            frame = spatial.frame({"reference": review["reference"], "mode": review["mode"],
                                   "view": review["view"], "size": {"width": 1200, "height": 800}})
            overlay = spatial.overlay({"selection": row["selection"], "view": frame["view"],
                                       "limit": 500, "tolerance": 0})
            assert overlay["returned"] == row["selected_count"] and overlay.get("next_offset") is None
            row["reopened"] = {"validation": validation, "selected_count": overlay["returned"],
                               "source_sha256": overlay["source_sha256"]}
            export_task = queued("spatial.review.export",
                                 {"review_id": row["review_id"], "paper": "letter", "dpi": 150},
                                 "export-" + row["key"])
            row["export"] = export_task["result"]
            write_progress()
        result = {"schema": "upstate.scientific-context-working-project/v1",
                  "project": workspace.project, "workspace": str(workspace.root),
                  "workspace_key": key, "operator_state": str(STATE),
                  "application": str(APP), "source_commit": "eaa20367bd7d2bc7e30046683eeda9102ee9b4ce",
                  "layers": progress["layers"], "views": saved, "task_ids": progress["tasks"],
                  "annual_reference": annual_task["result"],
                  "assessment_source": context_task["result"]}
        atomic_json(ROOT / "working-project-native-result.json", result)
        selected_task_ids = list(progress["tasks"])
        prior_capture = existing("snapshot")
        capture_payload = prior_capture["payload"] if prior_capture else {
            "transport": "archive", "task_ids": selected_task_ids}
        capture_task = queued("workspace.snapshot", capture_payload, "snapshot")
        result["capture"] = capture_task["result"]
        result["capture_task_id"] = capture_task["id"]
        result["task_ids"] = list(progress["tasks"])
        atomic_json(ROOT / "working-project-native-result.json", result)
        print(json.dumps({"stage": "scientific context maps complete", "result": result}), flush=True)
    finally:
        operator.close()


if __name__ == "__main__":
    main()

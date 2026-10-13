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
    parser.add_argument("--microbial-manifest", type=Path)
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
    MICROBIAL_MANIFEST = (args.microbial_manifest or MANIFEST.parent / "microbial-assessment-sources.json").resolve()
    if ROOT == WORKSPACE or ROOT.is_relative_to(WORKSPACE):
        raise ValueError("Keep operation outputs outside the retained workspace.")
    sys.path[:0] = [str(APP / "operator"), str(APP)]
    from server import Operator
    from model.common import atomic_json, file_digest, read_json

    ROOT.mkdir(parents=True, exist_ok=True)
    PROGRESS = ROOT / "working-project-progress.json"
    progress = read_json(PROGRESS) if PROGRESS.exists() else {"schema": "upstate.scientific-context-operation/v1", "tasks": [], "views": []}
    def write_progress():
        atomic_json(PROGRESS, progress)
    def opening():
        print(json.dumps({"stage": "opening maintained operator", "workspace": str(WORKSPACE)}), flush=True)
        return Operator(WORKSPACE, STATE, source_manifests=(MANIFEST, MICROBIAL_MANIFEST))
    operator = opening()
    receiver = None
    key = operator.primary
    workspace = operator.ws(key)
    assert workspace.project["id"] == args.project_id, "Choose the stated original project."
    progress.update(workspace_key=key, project=workspace.project, host=os.uname().nodename)
    write_progress()
    print(json.dumps({"stage": "operator opened", "workspace": key, "project": workspace.project}), flush=True)

    def existing(suffix, *, engine=None, workspace_key=None):
        engine = operator if engine is None else engine
        workspace_key = key if workspace_key is None else workspace_key
        operation_id = "ES9960-context-20261013-" + suffix
        matches = [task for task in engine.task_list(workspace_key) if task.get("operation_id") == operation_id]
        if len(matches) > 1:
            raise RuntimeError("Duplicate operation identity " + operation_id)
        return matches[0] if matches else None

    def queued(action, payload, suffix, *, engine=None, workspace_key=None, track_tasks=True):
        engine = operator if engine is None else engine
        workspace_key = key if workspace_key is None else workspace_key
        operation_id = "ES9960-context-20261013-" + suffix
        task = engine.submit(workspace_key, action, payload, operation_id)
        if task["state"] in {"failed", "interrupted"}:
            engine.resume(task["id"])
            task = engine.task(task["id"])
        if task["action"] != action or task["workspace"] != workspace_key:
            raise RuntimeError("Operation identity belongs to another request")
        if track_tasks and task["id"] not in progress["tasks"]:
            progress["tasks"].append(task["id"])
            write_progress()
        end, last = time.monotonic() + 1200, 0
        while True:
            task = engine.task(task["id"])
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

        known = existing("microbial-source")
        if known:
            microbial_task = queued("source.import", known["payload"], "microbial-source")
        else:
            registered = next(rid for rid, record in operator.registered.items()
                              if Path(record["path"]).resolve() == MICROBIAL_MANIFEST)
            preview = operator.preview_source({"registered_id": registered})
            microbial_task = queued("source.import", {"preview_id": preview["id"]}, "microbial-source")

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
        microbial_point = source_layer("assessment-microbial-geography159-20261013",
                                       microbial_task["result"]["id"])
        domain_candidates = [item for item in layers if item.get("source_id") == args.domain_source_id
                             and (not args.domain_collection or item.get("source_collection_id") == args.domain_collection)]
        if len(domain_candidates) != 1:
            raise ValueError("Choose one original domain collection and source ID.")
        domain = domain_candidates[0]
        catchment_binding = annual_task["result"]["binding"]["catchments"]
        basin = source_layer(catchment_binding["source_id"],
                             catchment_binding["source_collection_id"])
        progress["layers"] = {"assessment": point, "domain": domain, "annual_catchments": basin,
                              "microbial_assessment": microbial_point}
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
             "assessment values and native station identities remain unchanged in source attributes."),
            ("microbial-shared", "Assessment stations with E. coli observations | 4 stations and 132 routine samples",
             {"layer_id": microbial_point["id"], "where": {"has_microbial_observations": True}},
             {"layer_id": domain["id"]}, 4,
             "SV-111, SV-735, SV-833 and RS-21014 share 132 original routine samples with eight "
             "published assessment records. Samples retain their actual 2021-2025 dates, APHA9223-B "
             "method and MPN per 100 mL units. Six above-limit results retain their original lower "
             "bounds; none is substituted with its limit. The 2024 assessment covers 2018-2022; "
             "July 2026 source records do not state an assessment period. The full utility cohort "
             "has 36 stations and 730 records, including one separate field replicate. A station "
             "without this cohort's measurements may have observations in other sources."),
            ("microbial-prwd", "PRWD assessment station with E. coli observations | RS-21014 and 12 routine samples",
             {"layer_id": microbial_point["id"],
              "where": {"has_microbial_observations": True, "PRWD_geometry": True}},
             {"layer_id": domain["id"]}, 1,
             "RS-21014 is physically within Little Beaverdam Creek / PRWD upstream. Its 12 "
             "original routine samples span 2021-01-06 to 2021-12-02, with APHA9223-B results "
             "in MPN per 100 mL. The retained 2024 assessment has E. coli, dissolved oxygen and "
             "pH cause records and an assessment period of 2018-2022. Measured E. coli samples "
             "supply context for the microbial cause; they do not measure dissolved oxygen or pH. "
             "This is one of 18 physical PRWD assessment stations in the selected source editions.")
        ]
        saved = []
        for suffix, title, selected_point, reference, expected, notes in selections:
            frame = spatial.frame({"reference": reference, "mode": "single",
                                   "size": {"width": 1200, "height": 800}})
            overlay = spatial.overlay({"selection": selected_point, "view": frame["view"],
                                       "limit": 500, "tolerance": 0})
            assert overlay["returned"] == expected and overlay.get("next_offset") is None, (
                suffix, overlay.get("returned"), overlay.get("next_offset"))
            markers = []
            if suffix.startswith("microbial-"):
                # Zoom only the new measured views. Source geometry and the three
                # existing request payloads remain unchanged.
                coordinates = []
                for feature in overlay["features"]:
                    geometry = feature["geometry"]
                    if geometry["type"] != "Point":
                        raise ValueError("Measured assessment source must retain Point geometry.")
                    x, y = geometry["coordinates"][:2]
                    coordinates.append((x, y))
                    properties = feature["properties"]
                    markers.append({
                        "x": x, "y": y,
                        "label": (str(properties["station_id"]) + " | "
                                  + str(properties["microbial_routine_count"]) + " routine samples | "
                                  + properties["microbial_first_date"] + " to "
                                  + properties["microbial_last_date"])
                    })
                xs, ys = zip(*coordinates)
                original_bounds = frame["view"]["bounds"]
                width = max(max(xs) - min(xs), (original_bounds[2] - original_bounds[0]) / 50)
                height = max(max(ys) - min(ys), (original_bounds[3] - original_bounds[1]) / 50)
                cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
                measured_view = {"crs": frame["view"]["crs"],
                                 "bounds": [cx - width * .75, cy - height * .75,
                                            cx + width * .75, cy + height * .75]}
                frame = spatial.frame({"reference": reference, "mode": "single",
                                       "view": measured_view, "size": {"width": 1200, "height": 800}})
                overlay = spatial.overlay({"selection": selected_point, "view": frame["view"],
                                           "limit": 500, "tolerance": 0})
                assert overlay["returned"] == expected and overlay.get("next_offset") is None
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
                "markers": markers, "notes": notes
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
                  "assessment_source": context_task["result"],
                  "microbial_source": microbial_task["result"],
                  "microbial_source_commit": "cd4604708d689740e0486ef69a6eb541c3c14e96"}
        atomic_json(ROOT / "working-project-native-result.json", result)
        selected_task_ids = list(progress["tasks"])
        prior_capture = existing("snapshot-with-microbial")
        capture_payload = prior_capture["payload"] if prior_capture else {
            "transport": "archive", "task_ids": selected_task_ids}
        capture_task = queued("workspace.snapshot", capture_payload, "snapshot-with-microbial")
        result["capture"] = capture_task["result"]
        result["capture_task_id"] = capture_task["id"]
        result["task_ids"] = list(progress["tasks"])
        atomic_json(ROOT / "working-project-native-result.json", result)
        # Restore this exact exported edition into an independently reopened
        # operator. Stable upload/task identities let the same command continue
        # after interruption without producing another receiving project.
        receiver_directory = ROOT / "archive-receiver" / "workspace"
        receiver_state = ROOT / "archive-receiver" / "operator"
        transfer_id = capture_task["result"]["transfer_id"]
        receiving = progress.setdefault("receiving", {
            "transfer_id": transfer_id, "project_id": workspace.project["id"],
            "workspace_directory": str(receiver_directory),
            "operator_directory": str(receiver_state)
        })
        if (receiving["transfer_id"] != transfer_id
                or receiving["project_id"] != workspace.project["id"]
                or receiving["workspace_directory"] != str(receiver_directory)
                or receiving["operator_directory"] != str(receiver_state)):
            raise ValueError("The retained receiving request belongs to a different exported project edition.")
        write_progress()
        def open_receiver():
            return Operator(receiver_directory, receiver_state, create=True,
                            title="Upper Savannah complete scientific-context project receiving")
        receiver = open_receiver()
        receiver_key = receiver.primary
        archive_path = Path(capture_task["result"]["path"])
        archive_bytes, archive_sha256 = archive_path.stat().st_size, file_digest(archive_path)
        known_receive = existing("receive-with-microbial", engine=receiver, workspace_key=receiver_key)
        if known_receive:
            receive_payload = known_receive["payload"]
            if receive_payload["transfer_id"] != transfer_id:
                raise ValueError("The original receiving task selected a different snapshot.")
            upload_id = receive_payload["upload_id"]
        else:
            upload_id = receiving.get("upload_id")
            if upload_id is None:
                with archive_path.open("rb") as stream:
                    uploaded = receiver.receive_upload(
                        stream, archive_bytes, quote(archive_path.name, safe=""), "application/zip")
                upload_id = uploaded["id"]
                receiving["upload_id"] = upload_id
                write_progress()
            receive_payload = {"upload_id": upload_id, "transfer_id": transfer_id}
        uploaded = receiver.upload(upload_id)
        if uploaded["bytes"] != archive_bytes or uploaded["sha256"] != archive_sha256:
            raise ValueError("The retained receiving upload differs from the exact project archive.")
        receiving.update(upload_id=upload_id, archive_bytes=archive_bytes, archive_sha256=archive_sha256)
        write_progress()
        receive_task = queued("workspace.receive", receive_payload, "receive-with-microbial",
                              engine=receiver, workspace_key=receiver_key, track_tasks=False)
        received = receive_task["result"]
        receiving.update(task_id=receive_task["id"], received_workspace_key=received["workspace_key"],
                         result=received)
        write_progress()
        workspace_keys = sorted(receiver.workspaces)
        receiver.close()
        receiver = open_receiver()
        if sorted(receiver.workspaces) != workspace_keys:
            raise ValueError("The independently reopened receiving operator lost a registered project.")
        restored_key = received["workspace_key"]
        restored_ws = receiver.ws(restored_key)
        if restored_ws.project != workspace.project:
            raise ValueError("The receiving project identity differs from the original project.")
        restored_spatial = receiver.spatial_reviews[restored_key]
        restored_task_rows = received["recovery"]["tasks"]
        retained_tasks = []
        for source_task_id in capture_payload["task_ids"]:
            original_task = operator.task(source_task_id)
            matching = [row for row in restored_task_rows
                        if row.get("operation_id") == original_task["operation_id"]]
            if len(matching) != 1:
                raise ValueError("Receiving lacks one selected original operation: " + original_task["operation_id"])
            restored_task = receiver.task(matching[0]["id"])
            if (restored_task.get("transfer_origin", {}).get("task_id") != source_task_id
                    or restored_task["state"] != original_task["state"]):
                raise ValueError("Receiving task history differs from its original selected operation.")
            if original_task["action"] in {"source.import", "spatial.review.save"}:
                if restored_task["result"]["id"] != original_task["result"]["id"]:
                    raise ValueError("Receiving changed an original source collection or saved review identity.")
            retained_tasks.append({"source_task_id": source_task_id, "received_task_id": restored_task["id"],
                                   "operation_id": original_task["operation_id"], "state": restored_task["state"]})
        reopened_views = []
        for row in saved:
            review = restored_ws._get("spatial-reviews", row["review_id"])
            validation = restored_spatial.validate_saved(review)
            overlay = restored_spatial.overlay({"selection": row["selection"], "view": review["view"],
                                                "limit": 500, "tolerance": 0})
            if (overlay["returned"] != row["selected_count"] or overlay.get("next_offset") is not None
                    or overlay["source_sha256"] != row["source_sha256"]):
                raise ValueError("The received saved view differs from its original source selection.")
            reopened_views.append({"key": row["key"], "review_id": row["review_id"],
                                   "selected_count": overlay["returned"],
                                   "source_sha256": overlay["source_sha256"], "validation": validation})
        result["receiving"] = {
            "transfer_id": transfer_id, "task_id": receive_task["id"], "result": received,
            "workspace_key": restored_key, "workspace": str(restored_ws.root),
            "operator_state": str(receiver_state), "project": restored_ws.project,
            "archive_bytes": archive_bytes, "archive_sha256": archive_sha256,
            "restored_tasks": retained_tasks, "reopened_views": reopened_views
        }
        atomic_json(ROOT / "working-project-native-result.json", result)
        print(json.dumps({"stage": "scientific context project received and reopened", "result": result}), flush=True)
    finally:
        if receiver is not None:
            receiver.close()
        operator.close()


if __name__ == "__main__":
    main()

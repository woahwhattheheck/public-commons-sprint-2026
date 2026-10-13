"""Resolve saved Station geography cohorts into original published study editions.

This read-only bridge uses exact retained station identifiers. It does not infer
aliases, move station points, classify water quality, or change original rows.
"""
from __future__ import annotations

import json
from pathlib import Path

from model.common import digest, identifier, read_json, verify_file

SCHEMA = "upstate.geographic-study-selection/v1"
KIND = "station-geographies"


def _station_ids(value):
    if not isinstance(value, list) or not value or len(value) > 10000:
        raise ValueError("Choose between 1 and 10,000 original stations from the saved geography.")
    if any(not isinstance(item, str) or not item or len(item) > 500 for item in value):
        raise ValueError("Use the exact retained station identifiers.")
    return sorted(set(value))


def _view(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("The geographic view description must be an object.")
    allowed = {"scope", "search", "location_status", "watershed", "assessment_source",
               "assessment_edition", "cause", "use", "support", "publication"}
    if set(value) - allowed or any(not isinstance(item, str) or len(item) > 1000 for item in value.values()):
        raise ValueError("Use the original geographic view filter descriptions.")
    if len(json.dumps(value, ensure_ascii=False)) > 5000:
        raise ValueError("The original geographic view description is too long.")
    return dict(value)


def source_selection(workspace, payload):
    if not isinstance(payload, dict):
        raise ValueError("Choose a saved geography and its original station cohort.")
    geography_id = identifier(payload.get("geography_id"))
    record = workspace._get(KIND, geography_id)
    files = record.get("files", [])
    if isinstance(files, dict):
        files = list(files.values())
    candidates = [item for item in files
                  if isinstance(item, dict) and Path(item.get("path", "")).name == "analysis.json"]
    if len(candidates) != 1:
        raise ValueError("The saved geography must retain one original analysis.json.")
    descriptor = candidates[0]
    analysis = read_json(verify_file(workspace.root, descriptor))
    if (analysis.get("schema") != "upstate.station-geography-result/v1" or
            analysis.get("build_id") != record.get("build_id")):
        raise ValueError("The original geography analysis differs from its saved edition.")
    rows = analysis.get("stations")
    if not isinstance(rows, list):
        raise ValueError("The saved geography has no original station inventory.")
    by_id = {}
    for row in rows:
        station_id = row.get("station_id") if isinstance(row, dict) else None
        if not isinstance(station_id, str) or not station_id or station_id in by_id:
            raise ValueError("The original geographic station inventory has invalid or duplicate identifiers.")
        by_id[station_id] = row
    selected = _station_ids(payload.get("site_ids"))
    unknown = set(selected) - set(by_id)
    if unknown:
        raise ValueError("Station selection is outside the saved geographic edition: " +
                         ", ".join(sorted(unknown)[:20]))
    view = _view(payload.get("view"))
    received_from = (analysis.get("selection") or {}).get("received_from")
    if received_from is not None and not isinstance(received_from, dict):
        raise ValueError("The original received geography provenance is incompatible.")
    source = {
        "workspace_project_id": workspace.project["id"],
        "geography_id": geography_id, "build_id": record["build_id"],
        "geography_title": record.get("title") or analysis.get("title") or "Station geography",
        "analysis_project_id": analysis.get("project_id"),
        "original_project_id": (received_from or {}).get("project_id", analysis.get("project_id")),
        "received_from": received_from,
        "analysis": {key: descriptor[key] for key in ("path", "bytes", "sha256")},
        "site_ids": selected, "site_ids_sha256": digest(selected), "view": view,
    }
    return source


def _candidate(complete, source):
    record = complete["record"]
    known = {row["site_id"] for row in complete["available_stations"]}
    requested = set(source["site_ids"])
    matched = sorted(requested & known)
    missing = sorted(requested - known)
    chosen = set(matched)
    observed = [row for row in complete.get("observation_rows", [])
                if row.get("site_id") in chosen]
    original = [row for row in complete.get("original_measurements", [])
                if row.get("site_id") in chosen]
    dates = sorted(row["date"] for row in observed if row.get("date"))
    return {
        "study_id": record["study_id"], "version_id": record["version_id"],
        "title": record.get("title") or complete["study"]["title"],
        "source_collection_id": record["source_collection_id"],
        "source_manifest_sha256": record["source_manifest"]["sha256"],
        "matched_site_ids": matched, "missing_site_ids": missing,
        "matched_count": len(matched), "requested_count": len(requested),
        "observed_row_count": len(observed), "original_result_row_count": len(original),
        "sampling_start": dates[0] if dates else None,
        "sampling_end": dates[-1] if dates else None,
        "observation_calendar_filters": complete["study"].get("observation_calendar_filters") is True,
        "parameters": sorted({row["parameter"] for row in observed if row.get("parameter")}),
        "selection": {"site_ids": matched, "parameters": [], "strata": [],
                      "year": None, "months": []},
    }


def preview(workspace, store, payload):
    source = source_selection(workspace, payload)
    candidates, unavailable = [], []
    for record in store.list_studies()["studies"]:
        try:
            complete = store.get_study(record["study_id"], record["version_id"])
            candidate = _candidate(complete, source)
        except (KeyError, ValueError, OSError) as error:
            unavailable.append({"study_id": record["study_id"], "version_id": record["version_id"],
                                "title": record.get("title"), "message": str(error)})
            continue
        if candidate["matched_count"]:
            candidates.append(candidate)
    candidates.sort(key=lambda row: (-row["matched_count"], row["title"],
                                    row["study_id"], row["version_id"]))
    return {"schema": SCHEMA, "source": source, "candidates": candidates,
            "unavailable": unavailable, "id": digest({"source": source, "candidates": candidates})}


def resolve(workspace, store, payload):
    source = source_selection(workspace, payload)
    study_id, version_id = payload.get("study_id"), payload.get("version_id")
    if not isinstance(study_id, str) or not isinstance(version_id, str) or not version_id:
        raise ValueError("Choose the exact retained study edition from the preview.")
    complete = store.get_study(study_id, version_id)
    candidate = _candidate(complete, source)
    if not candidate["matched_count"]:
        raise ValueError("This study contains none of the selected original stations.")
    expected = payload.get("expected_source_manifest_sha256")
    if not isinstance(expected, str) or expected != candidate["source_manifest_sha256"]:
        raise ValueError("Refresh the station-cohort preview before opening this source edition.")
    context = store.context(study_id, version_id, **candidate["selection"])
    if context["selection"]["site_ids"] != candidate["matched_site_ids"]:
        raise ValueError("The original station selection changed while opening the study.")
    title = (source["geography_title"] + " — " + str(candidate["matched_count"]) +
             " station observation review")[:200]
    notes = [
        "Opened from a saved Station geography selection.",
        "Geography title: " + source["geography_title"],
        "Geography edition: " + source["geography_id"],
        "Geography build: " + source["build_id"],
        "Retained analysis project: " + str(source["analysis_project_id"]),
        "Original geography project: " + str(source["original_project_id"]),
        "Received donor archive/build/project: " + json.dumps({key: source["received_from"].get(key)
            for key in ("archive_sha256", "build_id", "project_id")} if source["received_from"] else None,
            ensure_ascii=False, sort_keys=True),
        "Original analysis SHA256: " + source["analysis"]["sha256"],
        "Requested original station count: " + str(len(source["site_ids"])),
        "Requested station-list SHA256: " + source["site_ids_sha256"],
        "Matched stations in this study: " + str(candidate["matched_count"]),
        "Requested stations absent from this study: " + str(len(candidate["missing_site_ids"])),
        "Geography view: " + json.dumps(source["view"], ensure_ascii=False, sort_keys=True),
        "The review filters retain the matched original station identifiers. Study dates, methods, "
        "qualifiers and units follow the selected original source edition. Geographic assessment "
        "filters select stations; they do not classify these sampled results.",
        "Export the saved Station geography edition separately to carry its complete maps and "
        "original spatial sources with this observation review.",
    ]
    return {"schema": SCHEMA, "source": source, "candidate": candidate,
            "study": complete, "context": context,
            "review": {"title": title, "notes": "\n".join(notes), "table": "observed",
                       "selection": candidate["selection"]}}

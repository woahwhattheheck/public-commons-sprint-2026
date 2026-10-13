"""Carry exact saved Monitoring campaigns into native Implementation fieldwork.

The Monitoring and Implementation stores remain authoritative. Each source
edition is frozen, its complete original monitoring packet is a managed plan
attachment, and subsequent imports merge only unchanged generated fields.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path

from .implementation import ImplementationStore
from .implementation_schema import make_plan, validate_plan, document_digest
from .monitoring_common import ContractError, canonical_bytes, digest, file_sha256, held
from .monitoring_sources import source_export_members
from .monitoring_packet import add_member, bytes_member, file_member, retain_packet

FORMAT = "upstate.monitoring-fieldwork/v1"
MAPPED = ("sites", "monitoring_plans", "visits", "tasks", "activities", "budget_lines")


def _id(kind, value):
    return kind + "_" + digest(value)


def _field_digest(row, key):
    return digest({"present": key in row, "value": row.get(key)})


def _selection(service, campaign_id, revision_id):
    history = service.history(campaign_id)
    selected = next((row for row in history if row["id"] == revision_id), None)
    if selected is None:
        raise ContractError("Select an original revision of this monitoring campaign")
    plan = service.get("plans", selected["plan_id"])
    network = service.get("networks", selected["network_id"])
    if plan["network_id"] != network["id"] or plan["status"] not in {"optimal", "feasible"}:
        raise ContractError("Fieldwork requires the campaign's retained feasible design")
    service.verify_sources(network)
    events = [service.get("events", key) for key in selected["event_ids"]]
    retained_history = history[:history.index(selected) + 1]
    plan_ids = {row["plan_id"] for row in retained_history + events}
    retained_plans = {key: service.get("plans", key) for key in sorted(plan_ids)}
    network_ids = {row["network_id"] for row in retained_history}
    network_ids.update(row["network_id"] for row in retained_plans.values())
    retained_networks = {key: service.get("networks", key) for key in sorted(network_ids)}
    for original in retained_networks.values():
        service.verify_sources(original)
    from .monitoring_field_return import source_binding
    returned = {event["id"]: binding for event in events
                if (binding := source_binding(service.workspace, event)) is not None}
    return {"revision": selected, "plan": plan, "network": network,
            "events": events, "fieldwork_returns": returned, "history": retained_history,
            "retained_plans": retained_plans, "retained_networks": retained_networks}


def _packet(workspace, selected):
    """Retain the complete original packet while keeping native bodies on disk."""
    files = {}
    for name in ("revision", "plan", "network", "events", "history"):
        add_member(files, name + ".json", bytes_member(canonical_bytes(selected[name])))
    for key, original in selected["retained_plans"].items():
        add_member(files, "designs/" + key + ".json", bytes_member(canonical_bytes(original)))
    for key, original in selected["retained_networks"].items():
        add_member(files, "networks/" + key + ".json", bytes_member(canonical_bytes(original)))
        for label, binding in original["source_bindings"].items():
            if binding:
                for name, member in source_export_members(workspace, label, binding):
                    add_member(files, "network_sources/" + key + "/" + name, member)
    for binding in selected.get("fieldwork_returns", {}).values():
        for name, original in binding["source_files"].items():
            original = Path(original)
            add_member(files, "fieldwork_returns/" + binding["request_id"] + "/" + name,
                       file_member(original, original.stat().st_size, file_sha256(original)))
    manifest = canonical_bytes({
        "schema": FORMAT, "campaign_id": selected["revision"]["campaign_id"],
        "source_revision_id": selected["revision"]["id"],
        "files": [{"path": name, "bytes": member["bytes"], "sha256": member["sha256"]}
                  for name, member in sorted(files.items())]})
    add_member(files, "manifest.json", bytes_member(manifest))
    packet = (workspace.root / "monitoring_fieldwork" / selected["revision"]["id"]
              / "monitoring-field-package.zip")
    return retain_packet(packet, files)

def _rows(selected, source_id):
    revision, plan, network = (selected[name] for name in ("revision", "plan", "network"))
    campaign_id = revision["campaign_id"]
    station_index = {row["id"]: row for row in network["stations"]}
    result = {name: [] for name in MAPPED}
    site_ids = {}
    def add_site(catchment, station_id):
        site_id = _id("site", [campaign_id, network["id"], catchment, station_id])
        station = station_index.get(station_id) if station_id else None
        if station_id and (station is None or station["huc_id"] != catchment):
            raise ContractError("Retain the campaign's original station assignment")
        row = {"id": site_id, "label": station_id or catchment, "source_ref": source_id,
               "monitoring_catchment_id": catchment, "monitoring_station_id": station_id,
               "geometry_role": "original_source_station" if station else "source_catchment_search_area"}
        if station is not None:
            point = station["geometry"]
            if point["type"] != "Point":
                raise ContractError("Field station coordinates need an original source point")
            row.update(longitude=point["coordinates"][0], latitude=point["coordinates"][1])
        if not any(value["id"] == site_id for value in result["sites"]):
            result["sites"].append(row)
        return site_id
    for catchment in plan["selected_ids"]:
        site_ids[catchment] = add_site(catchment, revision["site_bindings"].get(catchment))
    monitoring_id = _id("monitor", [campaign_id, plan["id"]])
    result["monitoring_plans"].append({
        "id": monitoring_id, "title": revision["title"],
        "objective": "Execute the retained monitoring campaign and its original field calendar.",
        "notes": "Source coverage mode: " + plan["coverage_mode"] + ". " +
                 plan["calendar"]["scheduling_basis"],
        "site_ids": list(site_ids.values()), "parameters": [],
        "method_ref": source_id, "frequency": "Original saved campaign rounds",
        "monitoring_design_id": plan["id"], "source_revision_id": revision["id"]})
    recent = {}
    for event in selected["events"]:
        if event["plan_id"] == plan["id"] and event["status"] != "note":
            recent[event["visit_key"]] = event
    visit_ids = {}
    for original in plan["calendar"]["visits"]:
        key = original["visit_key"]
        visit_id = visit_ids[key] = _id("visit", [campaign_id, plan["id"], key])
        event = recent.get(key)
        native_status = event["status"] if event else "planned"
        status = {"collected": "complete", "cancelled": "cancelled"}.get(native_status, "planned")
        notes = ("Original local time " + original["start_local"] + "–" + original["finish_local"] +
                 "; crew " + str(original["crew"]) + "; round " + str(original["round"]) +
                 ". Original monitoring status: " + native_status + ".")
        if event and event.get("note"):
            notes += " " + event["note"]
        actual_site = (add_site(original["site_id"], event["station_id"])
                       if event and event["status"] == "collected" else site_ids[original["site_id"]])
        visit = {"id": visit_id, "site_id": actual_site,
                 "monitoring_plan_id": monitoring_id, "planned_date": original["date"],
                 "observer": "", "notes": notes, "evidence_refs": [source_id], "status": status,
                 "monitoring_visit_key": key, "source_status": native_status,
                 "original_calendar": deepcopy(original),
                 "source_event_id": event["id"] if event else None}
        if status == "complete":
            visit["visited_at"] = event["occurred_at"]
        result["visits"].append(visit)
        result["tasks"].append({
            "id": _id("task", [campaign_id, plan["id"], key]), "title": "Monitoring visit " + key,
            "phase": "Monitoring", "assignee": "Crew " + str(original["crew"]),
            "notes": notes, "duration_days": None, "start_not_before": original["date"],
            "status": status, "progress_pct": 100 if status == "complete" else 0,
            "depends_on": [], "evidence_refs": [source_id], "monitoring_visit_id": visit_id})
    for event in selected["events"]:
        # Historic design events remain in their exact packet; the active design
        # maps only source-backed collected samples to current fieldwork visits.
        if event["plan_id"] != plan["id"] or event["status"] != "collected":
            continue
        if event["visit_key"] not in visit_ids or not event.get("sample_id"):
            raise ContractError("An original collected event needs its saved visit and sample ID")
        returned = selected.get("fieldwork_returns", {}).get(event["id"])
        activity_id = (returned["activity"]["id"] if returned and returned["activity"] is not None
                       else _id("sample", [campaign_id, event["id"]]))
        generated = {
            "id": activity_id,
            "visit_id": visit_ids[event["visit_key"]],
            "site_id": add_site(event["site_id"], event["station_id"]),
            "kind": "sample", "sample_id": event["sample_id"], "collected_at": event["occurred_at"],
            "notes": event.get("note", ""), "source_event_id": event["id"],
            "source_values": deepcopy(event.get("values", {})), "source_ref": source_id,
            "monitoring_station_id": event.get("station_id")}
        prior_activity = next((row for row in result["activities"] if row["id"] == activity_id), None)
        if prior_activity is None:
            result["activities"].append(generated)
        else:
            prior_activity.clear()
            prior_activity.update(generated)
    result["monitoring_plans"][0]["site_ids"] = [row["id"] for row in result["sites"]]
    # Activities retain the actual event station. A separate historic visit keeps
    # an earlier station binding when a later event on the same scheduled slot
    # names another point.
    visits_by_id = {row["id"]: row for row in result["visits"]}
    for activity in result["activities"]:
        visit = visits_by_id[activity["visit_id"]]
        if visit["site_id"] != activity["site_id"]:
            historical = deepcopy(visit)
            historical.update(id=_id("visit_event", activity["source_event_id"]),
                              site_id=activity["site_id"], status="complete",
                              visited_at=activity["collected_at"],
                              source_event_id=activity["source_event_id"],
                              source_status="collected", notes=activity["notes"])
            result["visits"].append(historical)
            activity["visit_id"] = historical["id"]
    if plan["cost"]["currency"] != "USD":
        raise ContractError("The Implementation planning budget requires original USD cents")
    result["budget_lines"].append({
        "id": _id("budget", campaign_id), "label": "Original monitoring design planning cost",
        "kind": "budget", "amount_minor": plan["cost"]["total_cents"],
        "reference": source_id, "monitoring_design_id": plan["id"],
        "planning_cost": deepcopy(plan["cost"])})
    return result



def _reconcile_references(document, before, previous, managed, conflicts):
    """Preserve local deletions and edits as a coherent fieldwork graph."""
    prior = {name: {row["id"]: row for row in before[name]} for name in MAPPED}
    def index(name):
        return {row["id"]: row for row in document[name]}
    def defer(name, row, reason):
        old = prior[name].get(row["id"])
        if old == row:
            return
        conflicts.append({"collection": name, "id": row["id"], "field": None,
                          "reason": reason, "incoming": deepcopy(row)})
        if old is None:
            document[name].remove(row)
            managed[name].pop(row["id"], None)
        else:
            row.clear()
            row.update(deepcopy(old))
            if row["id"] in previous.get(name, {}):
                managed[name][row["id"]] = deepcopy(previous[name][row["id"]])
    sites, monitors = index("sites"), index("monitoring_plans")
    for row in list(document["visits"]):
        monitor_id = row.get("monitoring_plan_id")
        if (row["site_id"] not in sites or (monitor_id and monitor_id not in monitors)
                or (row.get("status") == "complete" and not row.get("visited_at"))):
            defer("visits", row, "The source change depends on a parent or completion field changed in fieldwork")
        elif (monitor_id and monitor_id not in managed["monitoring_plans"]
              and row["site_id"] not in monitors[monitor_id]["site_ids"]):
            defer("visits", row, "The source change falls outside the locally selected monitoring plan")
    visits = index("visits")
    # Existing sample locations protect their visit. Restore an accepted source
    # visit update before considering its dependent incoming sample changes.
    for row in document["activities"]:
        if row["id"] in prior["activities"]:
            retained_visit = visits.get(row["visit_id"])
            if retained_visit and retained_visit["site_id"] == row["site_id"] and row["site_id"] in sites:
                continue
            old = prior["activities"][row["id"]]
            visit = visits.get(old["visit_id"])
            if visit and visit["site_id"] != old["site_id"]:
                defer("visits", visit, "Preserved the original site of an existing fieldwork activity")
    visits = index("visits")
    for row in list(document["activities"]):
        visit = visits.get(row["visit_id"])
        if not visit or row["site_id"] not in sites or visit["site_id"] != row["site_id"]:
            defer("activities", row, "The source sample depends on a visit or site changed in fieldwork")
    for row in list(document["tasks"]):
        if row.get("monitoring_visit_id") and row["monitoring_visit_id"] not in visits:
            defer("tasks", row, "The source task depends on a visit removed in fieldwork")
    # Keep user-added members while admitting the actual retained visit sites.
    # The incoming source membership remains in the conflict and frozen packet.
    for row in document["monitoring_plans"]:
        if row["id"] not in managed["monitoring_plans"]:
            continue
        fields = managed["monitoring_plans"][row["id"]]
        was_managed = _field_digest(row, "site_ids") == fields.get("site_ids")
        members = [key for key in row["site_ids"] if key in sites]
        for visit in document["visits"]:
            if visit.get("monitoring_plan_id") == row["id"] and visit["site_id"] not in members:
                members.append(visit["site_id"])
        if members != row["site_ids"]:
            conflicts.append({"collection": "monitoring_plans", "id": row["id"],
                              "field": "site_ids", "reason": "Reconciled membership with retained fieldwork visits",
                              "incoming": deepcopy(row["site_ids"])})
            row["site_ids"] = members
            if was_managed:
                fields["site_ids"] = _field_digest(row, "site_ids")


def _merge(document, incoming, source_revision_id, *, fieldwork_baselines=None):
    """Apply source changes per field only when the fieldwork value is unchanged."""
    origin = document.get("monitoring_origin", {})
    previous = origin.get("managed_fields", {})
    managed, conflicts = {}, []
    before = {name: deepcopy(document[name]) for name in MAPPED}
    for collection in MAPPED:
        rows = document[collection]
        by_id = {row["id"]: row for row in rows}
        managed[collection] = deepcopy(previous.get(collection, {}))
        for new in incoming[collection]:
            old_fields = previous.get(collection, {}).get(new["id"])
            current = by_id.get(new["id"])
            if current is None:
                if old_fields is not None:
                    conflicts.append({"collection": collection, "id": new["id"],
                                      "field": None, "reason": "Removed in fieldwork",
                                      "incoming": deepcopy(new)})
                    continue
                current = deepcopy(new)
                rows.append(current)
                by_id[current["id"]] = current
                managed[collection][current["id"]] = {
                    key: _field_digest(current, key) for key in current}
                continue
            if old_fields is None:
                returned = (fieldwork_baselines or {}).get(current["id"]) if collection == "activities" else None
                if returned is None:
                    raise ContractError("An existing fieldwork row has a different source identity")
                # Only a byte-bound original return may join its existing local
                # activity. Track generated fields; keep its other field inputs.
                old_fields = {key: _field_digest(returned, key) for key in new}
                managed[collection][current["id"]] = deepcopy(old_fields)
            saved_fields = managed[collection][current["id"]]
            for key in set(old_fields) | set(new):
                actual = _field_digest(current, key)
                proposed = _field_digest(new, key)
                if actual == proposed:
                    saved_fields[key] = proposed
                elif actual == old_fields.get(key) or (key not in old_fields and key not in current):
                    if key in new:
                        current[key] = deepcopy(new[key])
                    else:
                        current.pop(key, None)
                    saved_fields[key] = proposed
                else:
                    conflicts.append({"collection": collection, "id": new["id"], "field": key,
                                      "reason": "Edited in fieldwork", "present": key in new,
                                      "incoming": deepcopy(new.get(key))})
    _reconcile_references(document, before, previous, managed, conflicts)
    # Retire after all incoming rows have been merged. Local dependencies and
    # additional fields make a generated row retained work.
    for collection in ("tasks", "visits"):
        rows = document[collection]
        wanted = {row["id"] for row in incoming[collection]}
        if collection == "tasks":
            referenced = {key for row in document["tasks"] for key in row.get("depends_on", [])}
            referenced.update(row.get("task_id") for row in document["budget_lines"])
        else:
            referenced = {row["visit_id"] for row in document["activities"]}
            referenced.update(row.get("monitoring_visit_id") for row in document["tasks"])
        for current in list(rows):
            fields = previous.get(collection, {}).get(current["id"])
            if (fields and current["id"] not in wanted and current.get("status") == "planned"
                    and current["id"] not in referenced
                    and set(current) == {key for key, value in fields.items()
                                         if value != _field_digest({}, key)}
                    and all(_field_digest(current, key) == value for key, value in fields.items())):
                document.setdefault("monitoring_superseded_rows", []).append({
                    "collection": collection, "source_revision_id": source_revision_id,
                    "row": deepcopy(current)})
                rows.remove(current)
                managed[collection].pop(current["id"], None)
    return managed, conflicts


def _merge_calendar(document, source, previous):
    config = source["plan"]["configuration"]["calendar"]
    proposed = {"title": source["revision"]["title"], "start_date": config["start_date"],
                "target_date": config["end_date"],
                "working_days": sorted(set(day + 1 for day in config.get("weekdays", [0, 1, 2, 3, 4]))),
                "holidays": sorted(set(config.get("blackout_dates", [])))}
    fields = deepcopy(previous.get("calendar_fields", {}))
    prior_dates = {key: deepcopy(document.get(key)) for key in ("start_date", "target_date")}
    conflicts = []
    for key, value in proposed.items():
        incoming = _field_digest(proposed, key)
        actual = _field_digest(document, key)
        if not previous or actual == incoming or actual == fields.get(key):
            document[key] = deepcopy(value)
            fields[key] = incoming
        else:
            conflicts.append({"collection": "plan", "id": document["id"], "field": key,
                              "reason": "Edited in fieldwork", "incoming": deepcopy(value)})
    if document.get("target_date") and document["target_date"] < document["start_date"]:
        conflicts.append({"collection": "plan", "id": document["id"],
                          "field": "date_range", "reason": "Preserved the valid fieldwork calendar range",
                          "incoming": {key: proposed[key] for key in prior_dates}})
        for key, value in prior_dates.items():
            document[key] = value
            if key in previous.get("calendar_fields", {}):
                fields[key] = previous["calendar_fields"][key]
            else:
                fields.pop(key, None)
    return fields, conflicts


def receive(service, *, campaign_id, expected_revision_id, operation_id):
    """One queued operation; replay resumes the same source edition and attachment."""
    if not isinstance(operation_id, str) or not operation_id:
        raise ContractError("Retain the original handoff operation ID")
    with held(service.lock, blocking=False):
        selected = _selection(service, campaign_id, expected_revision_id)
        revision, source_plan = selected["revision"], selected["plan"]
        plan_id = _id("monitoring", campaign_id)
        source_id = _id("campaign", revision["id"])
        store = ImplementationStore(service.workspace)
        retained = store.history(plan_id) if (store.base / plan_id).is_dir() else []
        current = store.get(plan_id) if retained else None
        if current and current.get("monitoring_origin", {}).get("campaign_id") != campaign_id:
            raise ContractError("The selected fieldwork plan belongs to another campaign")
        existing = next((row for row in (current or {}).get("source_links", [])
                         if row["id"] == source_id), None)
        actor = "monitoring.fieldwork:" + revision["id"]
        if existing:
            packet_sha = existing["snapshot"]["packet"]["sha256"]
            packet_bytes = existing["snapshot"]["packet"]["bytes"]
        else:
            packet = _packet(service.workspace, selected)
            packet_sha, packet_bytes = packet["sha256"], packet["bytes"]
            calendar = source_plan["configuration"]["calendar"]
            document = deepcopy(current) if current else make_plan(
                plan_id, revision["title"], calendar["start_date"],
                target_date=calendar["end_date"], description="Fieldwork from the original saved monitoring campaign.",
                working_days=sorted(set(day + 1 for day in calendar.get("weekdays", [0, 1, 2, 3, 4]))),
                holidays=sorted(set(calendar.get("blackout_dates", []))))
            snapshot = {"campaign_revision": deepcopy(revision), "design_id": source_plan["id"],
                        "network_id": selected["network"]["id"],
                        "source_bindings": deepcopy(selected["network"]["source_bindings"]),
                        "packet": {"sha256": packet_sha, "bytes": packet_bytes},
                        "calendar_basis": source_plan["calendar"]["scheduling_basis"]}
            document["source_links"].append({
                "id": source_id, "kind": "monitoring_campaign", "label": revision["title"] +
                " · source revision " + str(revision["revision"]),
                "reference": "monitoring_revisions/" + revision["id"] + ".json",
                "source_id": revision["id"], "source_digest": digest(snapshot),
                "source_schema": revision["schema"], "snapshot": snapshot})
            origin = document.get("monitoring_origin", {})
            if revision["revision"] >= origin.get("campaign_revision", 0):
                returned_baselines = {binding["activity"]["id"]: binding["activity"]
                                      for binding in selected.get("fieldwork_returns", {}).values()
                                      if binding["activity"] is not None}
                managed, conflicts = _merge(document, _rows(selected, source_id), revision["id"],
                                            fieldwork_baselines=returned_baselines)
                calendar_fields, calendar_conflicts = _merge_calendar(document, selected, origin)
                conflicts.extend(calendar_conflicts)
                document["monitoring_origin"] = {
                    "schema": FORMAT, "campaign_id": campaign_id, "campaign_revision": revision["revision"],
                    "source_revision_id": revision["id"], "design_id": source_plan["id"],
                    "network_id": selected["network"]["id"],
                    "managed_fields": managed, "calendar_fields": calendar_fields,
                    "preserved_fieldwork_changes": conflicts}
            document = validate_plan(document)
            current = (store.save(document, current["revision"], actor=actor) if current else
                       store.create(document, actor=actor))
        attachment = next((row for row in current["source_links"]
                           if row.get("kind") == "local_file" and row.get("sha256") == packet_sha), None)
        if attachment is None:
            packet = service.root / "monitoring_fieldwork" / revision["id"] / "monitoring-field-package.zip"
            if not packet.is_file() or packet.stat().st_size != packet_bytes:
                raise ContractError("Resume with the original retained monitoring field package")
            if file_sha256(packet) != packet_sha:
                raise ContractError("The original monitoring field package changed")
            attached = store.attach_file(plan_id, packet, current["revision"], actor=actor,
                                         label="Original monitoring campaign revision " + str(revision["revision"]))
            current, attachment = attached["plan"], attached["source_link"]
        attached_path = (service.root / attachment["reference"]).resolve(strict=True)
        if (not attached_path.is_relative_to((store.base / plan_id / "attachments").resolve())
                or attached_path.stat().st_size != packet_bytes
                or file_sha256(attached_path) != packet_sha):
            raise ContractError("The retained fieldwork source attachment changed")
        origin = current["monitoring_origin"]
        return {"schema": FORMAT, "plan_id": plan_id, "revision": current["revision"],
                "campaign_id": campaign_id, "source_revision_id": revision["id"],
                "campaign_revision": revision["revision"],
                "active_source_revision_id": origin["source_revision_id"],
                "counts": {name: len(current[name]) for name in MAPPED},
                "preserved_fieldwork_changes": deepcopy(origin.get("preserved_fieldwork_changes", [])),
                "attachment": deepcopy(attachment), "document_digest": document_digest(current)}

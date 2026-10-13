"""Return reviewed original Implementation field evidence to its Monitoring campaign.

Uses the native field_event operation and its revision/replay semantics. Each
return retains an immutable reviewed request and the original saved field plan.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path

from .implementation import ImplementationStore, _atomic_bytes
from .implementation_schema import document_digest, validate_plan
from .monitoring_common import (
    ContractError, atomic_json, canonical_bytes, digest, file_sha256, held,
    load_json, utc_now,
)
from .monitoring_network import identifier
from .monitoring_workspace import report_html

SCHEMA = "upstate.monitoring-field-return/v1"
PREVIEW_SCHEMA = "upstate.monitoring-field-return-preview/v1"
RESERVED = {"fieldwork_return", "fieldwork_evidence"}


def _native_id(value, label):
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ContractError(label + " must be an original native SHA256 identity")
    return value


def _timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError()
    except (ValueError, TypeError, AttributeError) as error:
        raise ContractError("Record the actual ISO timestamp with its timezone") from error
    return value


def _pick(row, fields):
    return {key: deepcopy(row[key]) for key in fields if key in row}


def _original_values(activity):
    value = activity.get("source_values", {})
    if not isinstance(value, dict):
        raise ContractError("Retain the activity's original structured source values")
    nested = value.get("fieldwork_evidence")
    retained = nested.get("original_source_values") if isinstance(nested, dict) else None
    return deepcopy(retained if isinstance(retained, dict)
                    else {key: item for key, item in value.items() if key not in RESERVED})


def _saved_selection(service, campaign_id, revision_id, plan_revision):
    from .monitoring_implementation import _id
    campaign_id = _native_id(campaign_id, "campaign_id")
    revision_id = _native_id(revision_id, "expected_revision_id")
    history = service.history(campaign_id)
    revision = next((row for row in history if row["id"] == revision_id), None)
    if revision is None:
        raise ContractError("Select a saved revision of the original campaign")
    design = service.get("plans", revision["plan_id"])
    network = service.get("networks", revision["network_id"])
    if design["network_id"] != network["id"]:
        raise ContractError("The campaign's original design and network differ")
    document = ImplementationStore(service.workspace).get(_id("monitoring", campaign_id), plan_revision)
    origin = document.get("monitoring_origin", {})
    if (origin.get("campaign_id") != campaign_id or origin.get("design_id") != design["id"]
            or origin.get("network_id") != network["id"]):
        raise ContractError("Open fieldwork from this campaign's current original design")
    source = next((row for row in document["source_links"]
                   if row.get("kind") == "monitoring_campaign"
                   and row.get("source_id") == origin.get("source_revision_id")), None)
    if (source is None or source.get("source_digest") != digest(source.get("snapshot"))
            or source["snapshot"]["campaign_revision"]["campaign_id"] != campaign_id
            or source["snapshot"]["design_id"] != design["id"]
            or source["snapshot"]["network_id"] != network["id"]
            or origin["source_revision_id"] not in {row["id"] for row in history}):
        raise ContractError("Retain the field plan's exact original campaign source")
    events = [service.get("events", key) for key in revision["event_ids"]]
    return document, revision, design, network, events


def _rows(document, revision, design, network, events, event_times):
    visits = {row["id"]: row for row in document["visits"]}
    sites = {row["id"]: row for row in document["sites"]}
    monitors = {row["id"]: row for row in document["monitoring_plans"]}
    scheduled = {row["visit_key"]: row for row in design["calendar"]["visits"]}
    stations = {row["id"]: row for row in network["stations"]}
    existing_evidence = {event.get("values", {}).get("fieldwork_return", {}).get("evidence_id")
                         for event in events}
    by_event = {row["id"]: row for row in events}
    activities = {}
    observations = {}
    for row in document["activities"]:
        activities.setdefault(row["visit_id"], []).append(row)
    for row in document["observations"]:
        observations.setdefault(row["activity_id"], []).append(row)
    rows = []
    for visit in document["visits"]:
        key = visit.get("monitoring_visit_key")
        monitor = monitors.get(visit.get("monitoring_plan_id"))
        slot = scheduled.get(key)
        if slot is None or not monitor or monitor.get("monitoring_design_id") != design["id"]:
            continue
        site = sites[visit["site_id"]]
        station_id = site.get("monitoring_station_id")
        station = stations.get(station_id)
        bound = revision["site_bindings"].get(slot["site_id"])
        source_issues = []
        if site.get("monitoring_catchment_id") != slot["site_id"] or station_id != bound:
            source_issues.append("Reconcile this visit with the campaign's original catchment and station binding")
        elif bound is not None:
            if station is None or station["huc_id"] != slot["site_id"]:
                source_issues.append("Retain the campaign's original bound source station")
            elif (station["geometry"]["type"] != "Point"
                  or [site.get("longitude"), site.get("latitude")] != station["geometry"]["coordinates"][:2]):
                source_issues.append("The field site coordinates differ from the retained source station")
        # Native events retain the campaign binding, including an unbound note.
        station_id = bound
        local = activities.get(visit["id"], [])
        samples = [row for row in local if row["kind"] == "sample"]
        other = [row for row in local if row["kind"] != "sample"]
        candidates = []
        if visit["status"] == "cancelled":
            candidates.append(("visit:" + visit["id"], "cancelled", None,
                event_times.get(visit["id"], visit.get("cancelled_at")), local))
        elif visit["status"] == "complete":
            for activity in samples:
                candidates.append(("activity:" + activity["id"], "collected", activity,
                                   activity.get("collected_at"), [activity]))
            if other or not samples:
                candidates.append(("visit:" + visit["id"], "note", None,
                                   visit.get("visited_at"), other))
        else:
            rows.append({"entry_id": "visit:" + visit["id"], "visit_id": visit["id"],
                         "visit_key": key, "status": visit["status"], "sample_id": None,
                         "action": "not_completed", "available": False, "selected": False,
                         "issues": ["Complete and save the actual visit before returning its field evidence"]})
            continue
        for entry_id, status, activity, occurred_at, evidence_activities in candidates:
            issues = list(source_issues)
            if status == "collected" and not bound:
                issues.append("Bind an actual original source station before returning a collected sample")
            try:
                _timestamp(occurred_at)
                if status == "collected":
                    identifier(activity["sample_id"], "sample_id")
            except (ValueError, TypeError) as error:
                issues.append(str(error))
            if status == "cancelled" and not occurred_at:
                issues = [message for message in issues if message != "Record the actual ISO timestamp with its timezone"]
                issues.append("Record the actual cancellation timestamp including timezone")
            original_activities = []
            original_observations = []
            for item in evidence_activities:
                original_activities.append({
                    key: deepcopy(value) for key, value in item.items()
                    if key not in {"source_ref", "source_event_id", "source_values", "monitoring_station_id"}
                })
                original_observations.extend(deepcopy(observations.get(item["id"], [])))
            original_observations.sort(key=lambda row: row["id"])
            evidence = {
                "visit": _pick(visit, ("id", "site_id", "monitoring_plan_id", "planned_date",
                    "visited_at", "observer", "status", "notes", "evidence_refs")),
                "activities": original_activities, "observations": original_observations,
                "original_source_values": _original_values(activity) if activity else {},
            }
            meaningful = {
                "campaign_id": revision["campaign_id"], "design_id": design["id"],
                "entry_id": entry_id, "visit_key": key, "station_id": station_id,
                "status": status, "occurred_at": occurred_at,
                "activities": original_activities, "observations": original_observations,
                "observer": visit["observer"], "original_source_values": evidence["original_source_values"],
            }
            if activity is None:
                meaningful["visit_notes"] = visit["notes"]
            evidence_id = digest(meaningful)
            payload = {
                "visit_key": key, "status": status, "occurred_at": occurred_at,
                "sample_id": activity.get("sample_id") if activity else None,
                "note": activity["notes"] if activity else visit["notes"],
                "values": {"fieldwork_evidence": evidence},
            }
            prior = by_event.get(activity.get("source_event_id")) if activity else None
            original_sample = (
                prior is not None and prior["status"] == "collected"
                and prior["visit_key"] == key and prior["station_id"] == station_id
                and prior["sample_id"] == activity["sample_id"]
                and prior["occurred_at"] == occurred_at and prior.get("note", "") == activity["notes"]
                and not original_observations and not activity.get("method")
                and not activity.get("custody_ref") and not visit["observer"]
                and _original_values(activity) == _original_values({"source_values": prior.get("values", {})})
            )
            action = ("needs_review" if issues else "already_returned" if evidence_id in existing_evidence
                      else "original_campaign_sample" if original_sample else "return")
            rows.append({
                "entry_id": entry_id, "visit_id": visit["id"],
                "activity_id": activity["id"] if activity else None,
                "visit_key": key, "station_id": station_id, "status": status,
                "occurred_at": occurred_at, "sample_id": payload["sample_id"],
                "observation_count": len(original_observations),
                "action": action, "available": action == "return",
                "selected": False, "issues": issues, "evidence_id": evidence_id,
                "payload": payload,
            })
    return rows


def _build(service, *, campaign_id, expected_revision_id, plan_revision=None,
           selected_entry_ids=None, event_times=None):
    if plan_revision is not None and (type(plan_revision) is not int or plan_revision < 1):
        raise ContractError("Select an original positive fieldwork revision")
    event_times = {} if event_times is None else event_times
    if not isinstance(event_times, dict) or any(not isinstance(k, str) or not isinstance(v, str)
                                               for k, v in event_times.items()):
        raise ContractError("Cancellation times must identify original visits and ISO timestamps")
    document, revision, design, network, events = _saved_selection(
        service, campaign_id, expected_revision_id, plan_revision)
    rows = _rows(document, revision, design, network, events, event_times)
    available = {row["entry_id"] for row in rows if row["available"]}
    selected = sorted(available) if selected_entry_ids is None else selected_entry_ids
    if (not isinstance(selected, list) or any(not isinstance(key, str) for key in selected)
            or len(set(selected)) != len(selected) or set(selected) - available):
        raise ContractError("Select distinct reviewed original entries available for return")
    selected = sorted(selected)
    for row in rows:
        row["selected"] = row["entry_id"] in selected
    selection = {
        "schema": SCHEMA, "campaign_id": campaign_id,
        "expected_revision_id": expected_revision_id, "design_id": design["id"],
        "network_id": network["id"], "plan_id": document["id"],
        "plan_revision": document["revision"], "document_digest": document_digest(document),
        "selected_entry_ids": selected, "event_times": deepcopy(event_times),
        "entries": [deepcopy(row) for row in rows if row["selected"]],
    }
    request_id = digest(selection)
    return {
        "schema": PREVIEW_SCHEMA, "request_id": request_id,
        "selection": selection, "rows": rows, "can_return": bool(selected),
        "field_plan": document,
        "summary": {name: sum(row["action"] == name for row in rows)
                    for name in ("return", "already_returned", "original_campaign_sample",
                                 "needs_review", "not_completed")},
    }


def preview(service, **params):
    result = _build(service, **params)
    result.pop("field_plan")
    return result


def _event_payload(request, row):
    selection = request["selection"]
    payload = deepcopy(row["payload"])
    payload["values"]["fieldwork_return"] = {
        "schema": SCHEMA, "request_id": request["request_id"],
        "entry_id": row["entry_id"], "evidence_id": row["evidence_id"],
        "plan_id": selection["plan_id"], "plan_revision": selection["plan_revision"],
        "document_digest": selection["document_digest"],
    }
    return payload


def source_binding(workspace, event, cache=None):
    """Verify each event against original files; reuse reads within one operation."""
    binding = event.get("values", {}).get("fieldwork_return")
    if binding is None:
        return None
    if not isinstance(binding, dict) or binding.get("schema") != SCHEMA:
        raise ContractError("The campaign event has an invalid original fieldwork return")
    key = _native_id(binding.get("request_id"), "request_id")
    root = workspace.root / "monitoring_field_returns" / key
    cache_key = (str(workspace.root), key)
    retained = cache.get(cache_key) if cache is not None else None
    if retained is None:
        request = load_json(root / "request.json")
        if (request.get("request_id") != key or digest(request.get("selection")) != key
                or request.get("schema") != SCHEMA):
            raise ContractError("The retained fieldwork return selection changed")
        selection = request["selection"]
        document = validate_plan(load_json(root / "field-plan.json"))
        if (document["id"] != selection["plan_id"]
                or document["revision"] != selection["plan_revision"]
                or document_digest(document) != selection["document_digest"]):
            raise ContractError("The retained return differs from its original field plan")
        retained = (request, document,
                    {item["entry_id"]: item for item in selection["entries"]},
                    {item["id"]: item for item in document["activities"]})
        if cache is not None:
            cache[cache_key] = retained
    request, document, entries, activities = retained
    selection = request["selection"]
    row = entries.get(binding.get("entry_id"))
    if (row is None or event["campaign_id"] != selection["campaign_id"]
            or event["plan_id"] != selection["design_id"]
            or event["network_id"] != selection["network_id"]
            or event["station_id"] != row["station_id"]):
        raise ContractError("The campaign event differs from the reviewed fieldwork source")
    expected = _event_payload(request, row)
    if any(event.get(key) != value for key, value in expected.items()):
        raise ContractError("The campaign event changed its original returned evidence")
    original = activities.get(row.get("activity_id"))
    if row.get("activity_id") and original is None:
        raise ContractError("The returned sample is absent from its original field revision")
    return {"request_id": key, "request": request, "field_plan": document,
            "activity": deepcopy(original), "entry": row,
            "source_files": {name: str(root / name) for name in ("request.json", "field-plan.json")}}


def _report(service, revision_id, root):
    revision = service.get("revisions", revision_id)
    plan = service.get("plans", revision["plan_id"])
    network = service.get("networks", revision["network_id"])
    events = [service.get("events", key) for key in revision["event_ids"]]
    recent = {}
    for event in events:
        if event["plan_id"] == plan["id"] and event["status"] != "note":
            recent[event["visit_key"]] = event
    calendar = []
    for visit in plan["calendar"]["visits"]:
        event = recent.get(visit["visit_key"])
        station = revision["site_bindings"].get(visit["site_id"])
        calendar.append({
            **visit, "planned_station_id": station,
            "station_id": event["station_id"] if event else station,
            "status": event["status"] if event else "planned",
            "latest_event_id": event["id"] if event else None,
        })
    body = report_html(revision["title"], plan, network, calendar, events).encode("utf-8")
    target = root / "campaign-report.html"
    try:
        _atomic_bytes(target, body)
    except FileExistsError:
        if target.is_symlink() or target.read_bytes() != body:
            raise ContractError("The retained campaign report differs from its original return")
    return {"path": str(target), "filename": target.name, "bytes": target.stat().st_size,
            "sha256": file_sha256(target), "campaign_revision_id": revision_id}


def receive(service, *, campaign_id, expected_revision_id, plan_revision,
            expected_request_id, selected_entry_ids, operation_id, event_times=None):
    """Append the reviewed events, resume exact partial writes, refresh saved fieldwork."""
    operation_id = identifier(operation_id, "operation_id")
    expected_request_id = _native_id(expected_request_id, "expected_request_id")
    base = service.root / "monitoring_field_returns"
    root = base / expected_request_id
    supplied = {
        "campaign_id": campaign_id, "expected_revision_id": expected_revision_id,
        "plan_revision": plan_revision, "selected_entry_ids": sorted(selected_entry_ids)
            if isinstance(selected_entry_ids, list) else selected_entry_ids,
        "event_times": {} if event_times is None else event_times,
    }
    with held(root / ".return.lock", blocking=False):
        request_path = root / "request.json"
        if request_path.exists():
            request = load_json(request_path)
            selection = request["selection"]
            if (request.get("request_id") != expected_request_id
                    or digest(selection) != expected_request_id
                    or request.get("arguments") != supplied):
                raise ContractError("Continue the original reviewed fieldwork return")
        else:
            built = _build(service, **supplied)
            if built["request_id"] != expected_request_id or not built["can_return"]:
                raise ContractError("Preview the exact field revision and selected entries before returning")
            # Replayed native events are permitted below. A brand-new return must
            # start from both reviewed heads, before retaining any campaign write.
            if service.campaign(campaign_id)["revision"]["id"] != expected_revision_id:
                raise ContractError("The campaign advanced; preview its current revision")
            current = ImplementationStore(service.workspace).get(built["selection"]["plan_id"])
            if current["revision"] != plan_revision:
                raise ContractError("The field plan advanced; preview its current saved revision")
            request = {"schema": SCHEMA, "request_id": expected_request_id,
                       "arguments": supplied, "selection": built["selection"]}
            atomic_json(root / "field-plan.json", built["field_plan"], immutable=True)
            atomic_json(request_path, request, immutable=True)
        atomic_json(base / "operations" / (digest(operation_id) + ".json"),
                    {"operation_id": operation_id, "request_id": expected_request_id}, immutable=True)
        completed = root / "completed.json"
        if completed.exists():
            result = load_json(completed)
            if result.get("request_id") != expected_request_id:
                raise ContractError("The retained completed return names another selection")
            report = result["campaign_report"]
            path = root / "campaign-report.html"
            if path.is_symlink() or path.stat().st_size != report["bytes"] or file_sha256(path) != report["sha256"]:
                raise ContractError("The retained returned campaign report changed")
            return {**result, "reused": True}
        selection = request["selection"]
        document = validate_plan(load_json(root / "field-plan.json"))
        if document_digest(document) != selection["document_digest"]:
            raise ContractError("Retain the original reviewed field plan")
        progress = {"schema": SCHEMA, "request_id": expected_request_id,
                    "phase": "returning", "events": [], "updated_at": utc_now()}
        previous_id = expected_revision_id
        return_cache = {}
        try:
            for row in selection["entries"]:
                payload = _event_payload(request, row)
                returned = service.field_event(
                    campaign_id=campaign_id, expected_revision_id=previous_id,
                    operation_id=digest({"fieldwork_return": expected_request_id, "entry_id": row["entry_id"]}),
                    **payload)
                event_id = returned["event_ids"][-1]
                source_binding(service.workspace, service.get("events", event_id), return_cache)
                progress["events"].append({"entry_id": row["entry_id"], "event_id": event_id,
                                           "campaign_revision_id": returned["id"]})
                previous_id = returned["id"]
                progress.update(updated_at=utc_now())
                atomic_json(root / "state.json", progress)
            progress.update(phase="refreshing_fieldwork", final_campaign_revision_id=previous_id,
                            updated_at=utc_now())
            atomic_json(root / "state.json", progress)
            from .monitoring_implementation import receive as receive_fieldwork
            handoff = receive_fieldwork(service, campaign_id=campaign_id,
                expected_revision_id=previous_id, operation_id=digest({"fieldwork_refresh": expected_request_id}))
            report = _report(service, previous_id, root)
            result = {
                "schema": SCHEMA, "state": "complete", "request_id": expected_request_id,
                "campaign_id": campaign_id, "campaign_revision_id": previous_id,
                "source_plan_id": selection["plan_id"], "source_plan_revision": plan_revision,
                "source_document_digest": selection["document_digest"],
                "events": progress["events"], "fieldwork": handoff, "campaign_report": report,
                "completed_at": utc_now(), "reused": False,
            }
            atomic_json(completed, result, immutable=True)
            progress.update(phase="complete", updated_at=utc_now())
            atomic_json(root / "state.json", progress)
            return result
        except Exception as error:
            progress.update(phase="failed", updated_at=utc_now(),
                            error={"type": type(error).__name__, "message": str(error)})
            atomic_json(root / "state.json", progress)
            raise

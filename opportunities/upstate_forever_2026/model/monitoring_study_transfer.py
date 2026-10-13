"""Typed Monitoring study dependencies for the original editable archive.

Original Workspace records, campaign replay identities and source objects stay
authoritative. Selection composes model.study_transfer; it creates no parallel
store, fieldwork scheduler or archive format.
"""
from __future__ import annotations

import copy

from .common import canonical, digest, identifier, read_json

ROOT_KINDS = ("monitoring_networks", "monitoring_plans", "monitoring_frontiers",
              "monitoring_heads", "monitoring_observed_contexts")
IMMUTABLE_KINDS = ("monitoring_networks", "monitoring_plans", "monitoring_frontiers",
                   "monitoring_revisions", "monitoring_events",
                   "monitoring_observed_contexts")
MUTABLE_KINDS = ("monitoring_heads", "monitoring_frontier_jobs")
DOCUMENTS = {"monitoring-report-sources": "report.json"}
LABELS = {
    "monitoring_networks": "Monitoring networks",
    "monitoring_plans": "Monitoring designs",
    "monitoring_frontiers": "Monitoring budget comparisons",
    "monitoring_heads": "Editable monitoring campaigns",
    "monitoring_revisions": "Monitoring campaign revisions",
    "monitoring_events": "Monitoring field events",
    "monitoring_observed_contexts": "Monitoring observational context",
    "monitoring_frontier_jobs": "Monitoring budget continuation",
    "monitoring-report-sources": "Monitoring report sources",
}


def _native(closure, kind, key):
    """Read and hash an original immutable record, without changing Workspace."""
    key = identifier(key)
    value = closure.read(kind + "/" + key + ".json")
    if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
        raise ValueError("The original Monitoring record changed: " + kind + "/" + key)
    return {**value, "id": key}


def _binding(closure, binding, reason):
    if not isinstance(binding, dict):
        raise ValueError("Monitoring needs its original source binding.")
    key = binding.get("source_collection_id") or binding.get("source_record_id")
    closure.need("sources", key, reason)
    from .monitoring_sources import verify_retained_binding
    verify_retained_binding(closure.workspace, binding)


def _bindings(closure, bindings, reason):
    if not isinstance(bindings, dict):
        raise ValueError("Monitoring source bindings must retain their original mapping.")
    for binding in bindings.values():
        if binding:
            _binding(closure, binding, reason)


def _plan_network(closure, value, reason):
    plan = _native(closure, "monitoring_plans", value["plan_id"])
    if plan["network_id"] != value["network_id"]:
        raise ValueError("Monitoring history points to a different source network.")
    closure.need("monitoring_plans", plan["id"], reason)
    closure.need("monitoring_networks", value["network_id"], reason)
    return plan


def _campaign(closure, key, head):
    if (head.get("campaign_id") != key or not isinstance(head.get("operations"), dict)):
        raise ValueError("The Monitoring campaign head changed its original identity.")
    identifier(head.get("revision_id"))
    seen, records = set(), []
    current = head["revision_id"]
    expected_number = None
    while current is not None:
        if current in seen:
            raise ValueError("Monitoring campaign history contains a revision cycle.")
        seen.add(current)
        revision = _native(closure, "monitoring_revisions", current)
        number = revision.get("revision")
        if (revision.get("campaign_id") != key or type(number) is not int or number < 1
                or (expected_number is not None and number != expected_number)):
            raise ValueError("Monitoring campaign history changed its revision sequence.")
        closure.need("monitoring_revisions", current, "Complete selected campaign history")
        records.append(revision)
        expected_number = number - 1
        current = revision.get("parent_id")
        if current is None and number != 1:
            raise ValueError("Monitoring campaign history lost its first revision.")
    by_id = {record["id"]: record for record in records}
    for operation_id, operation in head["operations"].items():
        if (not isinstance(operation_id, str) or not operation_id
                or not isinstance(operation, dict)
                or set(operation) != {"fingerprint", "revision_id"}):
            raise ValueError("The original campaign replay operation is unreadable.")
        identifier(operation["fingerprint"])
        record = by_id.get(operation["revision_id"])
        if record is None or record.get("operation_id") != operation_id:
            raise ValueError("Campaign replay no longer names its original revision.")
    for record in records:
        operation = head["operations"].get(record.get("operation_id"))
        if not operation or operation["revision_id"] != record["id"]:
            raise ValueError("Campaign history lost an original replay identity.")
    closure.monitoring_records[("monitoring_heads", key)] = {
        "kind": "monitoring_heads", "id": key, "head": copy.deepcopy(head),
        "revisions": [record["id"] for record in reversed(records)],
    }
    closure.nodes[("monitoring_heads", key)].update(
        title=records[0].get("title") or key[:12], state="saved",
        revisions=len(records), revision_id=head["revision_id"])


def _frontier_job(closure, key, head):
    if (head.get("job_id") != key or not isinstance(head.get("completed"), dict)):
        raise ValueError("Monitoring budget continuation changed its original identity.")
    for budget, plan_id in head["completed"].items():
        if (not isinstance(budget, str) or not budget.isdecimal()
                or str(int(budget)) != budget):
            raise ValueError("Monitoring budget continuation needs an exact original budget.")
        plan = _native(closure, "monitoring_plans", plan_id)
        if plan.get("frontier_job_id") != key or plan.get("frontier_budget_cents") != int(budget):
            raise ValueError("Monitoring budget continuation points to another saved design.")
        closure.need("monitoring_plans", plan_id, "Retained budget-comparison continuation")
    closure.monitoring_records[("monitoring_frontier_jobs", key)] = {
        "kind": "monitoring_frontier_jobs", "id": key, "head": copy.deepcopy(head),
    }


def _report(closure, key, value):
    from .monitoring_report_source import inspect
    record = inspect(closure.workspace, key, verify=True)
    if record != value or record.get("state") != "complete":
        raise ValueError("Select a completed original Monitoring report source.")
    selection = record["selection"]
    if selection.get("plan_id"):
        closure.need("monitoring_plans", selection["plan_id"], "Saved Monitoring report design")
    if selection.get("campaign_id"):
        closure.need("monitoring_heads", selection["campaign_id"], "Editable reported Monitoring campaign")
        closure.need("monitoring_revisions", selection["expected_revision_id"],
                     "Exact reported Monitoring campaign revision")
    prefix = "monitoring-report-sources/" + key
    closure.tree(prefix)
    closure._descriptors(record["files"])
    closure._source_refs(record["source"], "Retained original Monitoring report source")
    for row in closure.read(prefix + "/history-records.json"):
        kind = {"plans": "monitoring_plans", "networks": "monitoring_networks",
                "revisions": "monitoring_revisions", "events": "monitoring_events"}.get(row.get("kind"))
        if kind is None:
            raise ValueError("A Monitoring report has an unknown original history kind.")
        closure.need(kind, row["id"], "Original reported Monitoring history")
    closure.monitoring_reports[key] = {
        "id": key, "record_sha256": record["record_sha256"],
        "source": copy.deepcopy(record["source"]),
    }


def visit(closure, kind, key, value):
    if kind not in LABELS:
        return False
    if kind == "monitoring_heads":
        _campaign(closure, key, value)
        return True
    if kind == "monitoring_frontier_jobs":
        _frontier_job(closure, key, value)
        return True
    if kind == "monitoring-report-sources":
        _report(closure, key, value)
        return True
    if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
        raise ValueError("The original Monitoring record changed: " + kind + "/" + key)
    reason = "Original " + LABELS[kind].lower()
    if kind == "monitoring_networks":
        _bindings(closure, value["source_bindings"], reason)
    elif kind == "monitoring_plans":
        closure.need("monitoring_networks", value["network_id"], reason)
        _bindings(closure, value["source_bindings"], reason)
        job_id = value.get("frontier_job_id")
        if job_id and closure.exists("monitoring_frontier_jobs", job_id):
            closure.need("monitoring_frontier_jobs", job_id, "Saved budget-comparison progress")
    elif kind == "monitoring_frontiers":
        closure.need("monitoring_networks", value["network_id"], reason)
        for plan_id in value["plan_ids"]:
            plan = _native(closure, "monitoring_plans", plan_id)
            if plan["network_id"] != value["network_id"] or plan.get("frontier_job_id") != value["job_id"]:
                raise ValueError("Monitoring comparison mixes different original budget programmes.")
            closure.need("monitoring_plans", plan_id, reason)
        if closure.exists("monitoring_frontier_jobs", value["job_id"]):
            closure.need("monitoring_frontier_jobs", value["job_id"], reason)
    elif kind == "monitoring_revisions":
        plan = _plan_network(closure, value, reason)
        parent = value.get("parent_id")
        if parent:
            previous = _native(closure, "monitoring_revisions", parent)
            if (previous["campaign_id"] != value["campaign_id"]
                    or previous["revision"] + 1 != value["revision"]
                    or not set(previous["event_ids"]).issubset(value["event_ids"])):
                raise ValueError("Monitoring revision changed its retained parent or field history.")
            closure.need("monitoring_revisions", parent, reason)
        elif value.get("revision") != 1:
            raise ValueError("Monitoring revision lost its original parent.")
        for event_id in value["event_ids"]:
            event = _native(closure, "monitoring_events", event_id)
            if event["campaign_id"] != value["campaign_id"]:
                raise ValueError("Monitoring revision contains another campaign's field event.")
            closure.need("monitoring_events", event_id, reason)
    elif kind == "monitoring_events":
        _plan_network(closure, value, reason)
        _bindings(closure, value["source_bindings"], reason)
        if value.get("expected_revision_id"):
            closure.need("monitoring_revisions", value["expected_revision_id"],
                         "Original field-event campaign revision")
    elif kind == "monitoring_observed_contexts":
        from .monitoring_observed_context import inspect
        inspected = inspect(closure.workspace, key)
        if inspected != {**value, "id": key}:
            raise ValueError("The observed Monitoring context changed while selected.")
        closure.need("monitoring_networks", value["network_id"], reason)
        closure.need("sources", value["source_binding"]["source_collection_id"], reason)
        if value.get("plan_id"):
            closure.need("monitoring_plans", value["plan_id"], reason)
        if value.get("campaign_revision_id"):
            closure.need("monitoring_revisions", value["campaign_revision_id"], reason)
        if value.get("campaign_id"):
            closure.need("monitoring_heads", value["campaign_id"], "Editable observed Monitoring campaign")
    return True


def _related_row(closure, path):
    try:
        value = read_json(path)
        if not isinstance(value, dict):
            raise ValueError("The related Monitoring record is not an original object.")
        identifier(path.stem if path.suffix == ".json" and path.name != "report.json" else path.parent.name)
        return value
    except (ValueError, OSError, TypeError) as error:
        closure.related_issues.append({"path": path.relative_to(closure.root).as_posix(),
                                       "message": str(error)})
        return None


def related(closure):
    # Use only the explicitly selected cohort as discovery seeds. A newly added
    # historical network must not pull other campaigns sharing that old source.
    roots = {(row["kind"], row["id"]) for row in closure.selection["roots"]}
    networks = {key for kind, key in roots if kind == "monitoring_networks"}
    plans = {key for kind, key in roots if kind == "monitoring_plans"}
    campaigns = {key for kind, key in closure.nodes if kind == "monitoring_heads"}
    contexts = [closure.read("monitoring_observed_contexts/" + key + ".json")
                for kind, key in roots if kind == "monitoring_observed_contexts"]
    plans.update(row["plan_id"] for row in contexts if row.get("plan_id"))
    for folder in ("monitoring_plans", "monitoring_frontiers"):
        for path in sorted((closure.root / folder).glob("*.json")):
            value = _related_row(closure, path)
            if value is not None and value.get("network_id") in networks:
                closure.need(folder, path.stem, "Saved work on the explicitly selected Monitoring network")
    # A selected design carries its editable campaigns. Comparing against the
    # retained current revision avoids matching arbitrary hashes or prose.
    if networks or plans:
        for path in sorted((closure.root / "monitoring_heads").glob("*.json")):
            head = _related_row(closure, path)
            if head is None:
                continue
            try:
                revision = read_json(closure.root / "monitoring_revisions" / (identifier(head["revision_id"]) + ".json"))
            except (KeyError, ValueError, OSError) as error:
                closure.related_issues.append({"path": path.relative_to(closure.root).as_posix(), "message": str(error)})
                continue
            if revision.get("network_id") in networks or revision.get("plan_id") in plans:
                closure.need("monitoring_heads", path.stem, "Editable campaign on the selected Monitoring design")
                campaigns.add(path.stem)
    for path in sorted((closure.root / "monitoring_observed_contexts").glob("*.json")):
        value = _related_row(closure, path)
        if value is not None and (value.get("campaign_id") in campaigns
                or value.get("plan_id") in plans or value.get("network_id") in networks):
            closure.need("monitoring_observed_contexts", path.stem, "Saved observational context for the selected Monitoring study")
    for path in sorted((closure.root / "monitoring-report-sources").glob("*/report.json")):
        value = _related_row(closure, path)
        if value is None or value.get("state") != "complete":
            continue
        selection = value.get("selection", {})
        if selection.get("campaign_id") in campaigns or selection.get("plan_id") in plans:
            closure.need("monitoring-report-sources", path.parent.name, "Completed report for the selected Monitoring study")


def lock_paths(closure):
    paths = set()
    if any(kind in LABELS for kind, _ in closure.nodes):
        paths.add("monitoring.lock")
    if any(kind == "monitoring-report-sources" for kind, _ in closure.nodes):
        paths.add(".monitoring-report-source.lock")
    for kind, key in closure.nodes:
        if kind == "monitoring_frontier_jobs":
            paths.add(kind + "/" + key + ".lock")
    return sorted(paths)


def receipt(closure):
    return {
        "campaigns": [copy.deepcopy(row) for (kind, _), row in sorted(closure.monitoring_records.items())
                      if kind == "monitoring_heads"],
        "frontiers": [copy.deepcopy(row) for (kind, _), row in sorted(closure.monitoring_records.items())
                      if kind == "monitoring_frontier_jobs"],
        "reports": [copy.deepcopy(row) for _, row in sorted(closure.monitoring_reports.items())],
    }


def verify_receipt(closure, captured):
    if captured is None:
        return None
    if not isinstance(captured, dict) or set(captured) != {"campaigns", "frontiers", "reports"}:
        raise ValueError("The transferred Monitoring history has an unreadable identity.")
    for row in captured["campaigns"]:
        current = closure.monitoring_records.get(("monitoring_heads", row["id"]))
        if current is None:
            raise ValueError("The received study lost its editable Monitoring campaign.")
        before, after = row["head"], current["head"]
        if ({k: v for k, v in before.items() if k not in {"revision_id", "operations"}}
                != {k: v for k, v in after.items() if k not in {"revision_id", "operations"}}):
            raise ValueError("The received campaign changed its original identity.")
        if current["revisions"][:len(row["revisions"])] != row["revisions"]:
            raise ValueError("The received campaign replaced its retained history.")
        for operation_id, operation in before["operations"].items():
            if after["operations"].get(operation_id) != operation:
                raise ValueError("The received campaign changed an original replay operation.")
    for row in captured["frontiers"]:
        current = closure.monitoring_records.get(("monitoring_frontier_jobs", row["id"]))
        if current is None:
            raise ValueError("The received study lost its budget-comparison continuation.")
        before, after = row["head"], current["head"]
        if ({k: v for k, v in before.items() if k != "completed"}
                != {k: v for k, v in after.items() if k != "completed"}):
            raise ValueError("The received budget comparison changed its original identity.")
        if any(after["completed"].get(key) != value for key, value in before["completed"].items()):
            raise ValueError("The received budget comparison replaced a completed original design.")
    for row in captured["reports"]:
        if closure.monitoring_reports.get(row["id"]) != row:
            raise ValueError("The received Monitoring report source changed.")
    return {"campaigns": len(captured["campaigns"]), "frontiers": len(captured["frontiers"]),
            "reports": len(captured["reports"]), "identity": "MATCH"}


def catalogue(workspace, kind):
    if kind not in ROOT_KINDS:
        raise ValueError("Choose an original Monitoring study kind.")
    rows = []
    for path in sorted((workspace.root / kind).glob("*.json")):
        key = path.stem
        try:
            identifier(key)
            value = read_json(path)
            if kind == "monitoring_heads":
                if value.get("campaign_id") != key:
                    raise ValueError("The campaign head has a different original identity.")
                record = workspace._get("monitoring_revisions", value["revision_id"])
                title, state = record.get("title"), "saved"
                selection = {"campaign_id": key, "revision_id": record["id"],
                             "plan_id": record["plan_id"], "network_id": record["network_id"]}
            else:
                record = workspace._get(kind, key)
                title, state = record.get("title"), record.get("status") or "saved"
                selection = {name: record[name] for name in
                             ("network_id", "plan_id", "campaign_id", "campaign_revision_id") if record.get(name)}
            row = {"kind": kind, "id": key, "title": title or key[:12], "state": state,
                   "updated_at": record.get("created_at") or "", "selection": selection}
        except (ValueError, KeyError, OSError, TypeError) as error:
            row = {"kind": kind, "id": key, "title": key[:12], "state": "unreadable",
                   "updated_at": "", "error": {"type": type(error).__name__, "message": str(error)}}
        rows.append(row)
    return rows

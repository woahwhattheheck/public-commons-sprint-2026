"""Carry an exact saved Sampling proposal into existing Monitoring fieldwork.

This module projects retained requirements. It performs no planning, station
substitution, laboratory qualification or evaluation of collected results.
"""
from __future__ import annotations

from copy import deepcopy
from html import escape
import json

from .monitoring_common import ContractError, canonical_bytes, digest

SCHEMA = "upstate.monitoring-sampling-protocol/v1"
VISIT_SCHEMA = "upstate.monitoring-sampling-visit/v1"


def selection(workspace, plan):
    """Resolve the one original recommendation design that produced this plan."""
    recommendation_id = plan.get("recommendation_id")
    if recommendation_id is None:
        return None
    from . import monitoring_recommendations as recommendations
    proposal = recommendations.inspect(workspace, recommendation_id)
    candidates = []
    for path in sorted((workspace.root / recommendations.DESIGNS).glob("*.json")):
        record = workspace._get(recommendations.DESIGNS, path.stem)
        if record.get("plan_id") == plan["id"]:
            candidates.append(recommendations.inspect_design(workspace, path.stem))
    if len(candidates) != 1:
        raise ContractError("Retain the exact original Sampling design for this Monitoring plan; "
                            "resume its original design operation if it was interrupted")
    native = candidates[0]
    if (native["recommendation_id"] != proposal["id"]
            or native["plan_digest"] != digest(plan)
            or native["network_id"] != plan["network_id"]):
        raise ContractError("Sampling protocol must bind its original proposal, design and network")
    originals = {row["target_id"]: row for row in proposal["targets"]}
    calendars = {row["target_id"]: row for row in native["target_calendar"]}
    requirements = []
    for target in proposal["handoff"]["requirements"]:
        original = originals[target["id"]]
        if original["target"] != target or target["id"] not in calendars:
            raise ContractError("The Sampling target differs from its saved native calendar")
        requirements.append({
            "target_id": target["id"], "target": deepcopy(target),
            "station": deepcopy(original["station"]), "cohort": deepcopy(original["cohort"]),
            "calendar": deepcopy(calendars[target["id"]]),
        })
    value = {
        "schema": SCHEMA, "recommendation_id": proposal["id"],
        "recommendation_digest": digest(proposal),
        "recommendation_design_id": native["id"],
        "recommendation_design_digest": digest(native),
        "monitoring_design_id": plan["id"], "context_id": proposal["context_id"],
        "requirements": requirements,
    }
    return {**value, "id": digest(value)}


def visit_binding(protocol, visit_key, station_id):
    """Preserve the proposed calendar relation and the actual station separately."""
    targets = []
    for row in protocol["requirements"]:
        calendar = row["calendar"]
        if visit_key not in calendar["visit_keys"]:
            continue
        expected = calendar["native_station_id"]
        targets.append({
            "target_id": row["target_id"], "expected_station_id": expected,
            "actual_station_id": station_id,
            "applicability": ("unbound_station" if station_id is None else
                              "matches_source_station" if station_id == expected else
                              "different_station"),
        })
    return {
        "schema": VISIT_SCHEMA, "protocol_id": protocol["id"],
        "recommendation_id": protocol["recommendation_id"],
        "recommendation_design_id": protocol["recommendation_design_id"],
        "visit_key": visit_key, "station_id": station_id, "targets": targets,
    }


def sampling_source(document, monitor, visit=None):
    """Resolve protected original Sampling scope without reading a native store.

    Saved fieldwork edits stay separate. Prefer its retained method source, then
    its original protocol ID; ambiguous historical visit scopes are not guessed.
    """
    design_id = monitor.get("monitoring_design_id")
    if not isinstance(design_id, str):
        return None
    actual = monitor.get("sampling_requirements")
    protocol_id = actual.get("id") if isinstance(actual, dict) else None
    if protocol_id is None and isinstance(visit, dict):
        actual_visit = visit.get("sampling_requirements")
        if isinstance(actual_visit, dict):
            protocol_id = actual_visit.get("protocol_id")
    candidates = []
    for link in document["source_links"]:
        if link.get("kind") != "monitoring_campaign":
            continue
        snapshot = link.get("snapshot")
        if not isinstance(snapshot, dict):
            continue
        protocols = snapshot.get("sampling_protocols")
        protocol = protocols.get(design_id) if isinstance(protocols, dict) else None
        if isinstance(protocol, dict):
            candidates.append((link, snapshot, protocol))
    preferred = [row for row in candidates if row[0]["id"] == monitor.get("method_ref")]
    selected = preferred or [row for row in candidates if row[2].get("id") == protocol_id]
    if not selected:
        return None
    resolved = []
    for link, snapshot, protocol in selected:
        revision = snapshot.get("campaign_revision")
        captures = snapshot.get("sampling_visit_bindings")
        if (not isinstance(revision, dict) or not isinstance(captures, dict)
                or link.get("source_digest") != digest(snapshot)
                or link.get("source_id") != revision.get("id")
                or link.get("reference") != "monitoring_revisions/" + str(revision.get("id")) + ".json"
                or protocol.get("schema") != SCHEMA
                or protocol.get("monitoring_design_id") != design_id
                or protocol.get("id") != digest({key: value for key, value in protocol.items() if key != "id"})
                or not isinstance(protocol.get("requirements"), list)
                or any(key not in link for key in
                       ("id", "source_id", "source_digest", "source_schema", "reference"))):
            raise ContractError("The original Sampling protocol source identity changed")
        for key in ("id", "recommendation_id", "recommendation_digest",
                    "recommendation_design_id", "recommendation_design_digest", "context_id"):
            value = protocol.get(key)
            if (not isinstance(value, str) or len(value) != 64
                    or any(char not in "0123456789abcdef" for char in value)):
                raise ContractError("The original Sampling protocol identity is incomplete: " + key)
        captured = captures.get(visit["id"]) if isinstance(visit, dict) else None
        if captured is not None:
            if (not isinstance(captured, dict) or captured.get("schema") != VISIT_SCHEMA
                    or not isinstance(captured.get("visit_key"), str)
                    or captured.get("station_id") is not None and not isinstance(captured["station_id"], str)):
                raise ContractError("The original Sampling visit binding is unreadable")
            try:
                expected = visit_binding(protocol, captured["visit_key"], captured["station_id"])
            except (KeyError, TypeError) as error:
                raise ContractError("The original Sampling target calendar is incomplete") from error
            if expected != captured:
                raise ContractError("The original Sampling visit differs from its protected protocol")
        resolved.append({
            "source_link": {key: deepcopy(link[key]) for key in
                           ("id", "source_id", "source_digest", "source_schema", "reference")},
            "protocol": deepcopy(protocol), "campaign_revision": deepcopy(revision),
            "visit": deepcopy(captured),
        })
    meanings = {digest({"protocol": row["protocol"],
                        "campaign_id": row["campaign_revision"].get("campaign_id"),
                        "visit": row["visit"]}) for row in resolved}
    if len(meanings) != 1:
        raise ContractError("The edited source reference leaves different original Sampling visit scopes; select its exact retained source")
    return resolved[0]


def parameter_labels(protocol):
    return list(dict.fromkeys(
        row["target_id"] + ": " + row["cohort"]["label"]
        for row in protocol["requirements"]))


def visit_note(protocol, binding):
    index = {row["target_id"]: row for row in protocol["requirements"]}
    labels = []
    states = {"matches_source_station": "matches the requested source station",
              "unbound_station": "source station is not yet bound",
              "different_station": "current source station differs from the request"}
    for selected in binding["targets"]:
        original = index[selected["target_id"]]
        labels.append(original["target_id"] + ": " + original["cohort"]["label"]
                      + " (" + states[selected["applicability"]] + ")")
    return (" Sampling requirements: " + "; ".join(labels) +
            ". Requested laboratory limits, methods and flow goals remain in the saved protocol."
            if labels else " No included Sampling target is scheduled for this visit.")


def export_members(workspace, protocol):
    """Use the original Sampling exporter, scoped to the exact producing design."""
    from . import monitoring_recommendations as recommendations
    from .monitoring_packet import add_member, bytes_member
    files = recommendations.export_members(
        workspace, protocol["recommendation_id"],
        design_ids=[protocol["recommendation_design_id"]])
    add_member(files, "field-protocol.json", bytes_member(canonical_bytes(protocol)))
    files["manifest.json"] = bytes_member(canonical_bytes({
        "schema": "upstate.monitoring-recommendation-export/v1",
        "recommendation_id": protocol["recommendation_id"],
        "files": [{"path": name, "bytes": member["bytes"], "sha256": member["sha256"]}
                  for name, member in sorted(files.items()) if name != "manifest.json"],
    }))
    return files


def _field(cohort, name):
    record = cohort["fields"].get(name)
    if record is None or not record.get("present"):
        return "Not supplied (field absent)"
    value = record.get("value")
    if value is None:
        return "Explicitly null"
    if value == "":
        return "Empty text"
    return str(value) if not isinstance(value, (dict, list)) else json.dumps(value, ensure_ascii=False)


def report_html(protocol, visits):
    """A source-preserving protocol chapter for the original Monitoring report."""
    def text(value):
        if value is None:
            return "Not supplied"
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)
    def table(headers, rows):
        return ("<div class='table'><table><thead><tr>" +
                "".join("<th>" + escape(label) + "</th>" for label in headers) +
                "</tr></thead><tbody>" +
                "".join("<tr>" + "".join("<td>" + escape(text(value)) + "</td>" for value in row) +
                        "</tr>" for row in rows) + "</tbody></table></div>")
    parts = ["<section id='sampling-requirements'><h2>Sampling field and laboratory requirements</h2>",
             "<p>These are the exact requirements of the saved Sampling proposal and its producing "
             "native design. The calendar assigns visits; a scheduled visit does not establish "
             "a flow event, laboratory suitability or achievement of a requested reporting limit.</p>"]
    for row in protocol["requirements"]:
        target, cohort = row["target"], row["cohort"]
        parts += ["<h3>" + escape(row["target_id"] + ": " + cohort["label"]) + "</h3>",
                  table(["Requirement", "Saved value"], [
                      ["Original source station", target["station_id"]],
                      ["Native source station", row["calendar"]["native_station_id"]],
                      ["Source catchment", row["calendar"]["catchment_id"]],
                      ["Requested months", target["months"]],
                      ["Proposed visits", target["proposed_visits"]],
                      ["Requested reporting limit", target["reporting_limit"]],
                      ["Original analytical unit", _field(cohort, "unit")],
                      ["Reporting-limit basis", target["reporting_limit_basis"]],
                      ["Method", _field(cohort, "method")],
                      ["Fraction", _field(cohort, "fraction")],
                      ["Flow goal", target["flow_goal"]],
                      ["Sampling rationale", target["reason"]],
                  ]),
                  "<details><summary>Complete original analytical cohort and target</summary><pre>" +
                  escape(json.dumps(row, ensure_ascii=False, indent=2)) + "</pre></details>"]
    rows = []
    for visit in visits:
        # Plan-only exports have no campaign station binding. They retain an
        # explicit unbound state instead of adopting the proposed station.
        binding = visit_binding(protocol, visit["visit_key"], visit.get("station_id"))
        for target in binding["targets"]:
            rows.append([visit["visit_key"], visit.get("date"), target["target_id"],
                         target["expected_station_id"], target["actual_station_id"],
                         target["applicability"].replace("_", " ")])
    parts += ["<h3>Visit applicability</h3>",
              table(["Visit", "Planned date", "Target", "Requested native station",
                     "Current native station", "Station scope"], rows),
              "<p>Station scope is shown independently of any collected sample or result. "
              "The original target, cohort metadata, calendar and full source companions are retained "
              "with the programme.</p></section>"]
    return "".join(parts)

"""Prepare complete field crew packets from an exact saved Implementation revision."""
from __future__ import annotations

import argparse
from collections import defaultdict
from copy import deepcopy
import csv
import datetime as dt
from html import escape
import io
import json
import os
from pathlib import Path
import re
import tempfile

from .common import atomic_bytes, atomic_json, describe_file, digest, file_digest, read_json, verify_file
from .implementation import ImplementationStore, _fsync_directory
from .implementation_schema import ImplementationError, _safe_id, document_digest, validate_plan
from .implementation_observations import _attachment_inventory
from .monitoring_packet import add_member, file_member, retain_packet

SCHEMA = "upstate.field-deployment/v1"
VERSION = "field-crew-packet/1"
HEX = re.compile(r"[0-9a-f]{64}")
APPLICATION = Path(__file__).resolve().parents[1]


def _selection(value):
    if not isinstance(value, dict) or set(value) - {"visit_ids", "title"}:
        raise ImplementationError("Choose the original visit IDs and a crew-packet title")
    ids = value.get("visit_ids")
    if not isinstance(ids, list) or not ids or any(not isinstance(key, str) for key in ids):
        raise ImplementationError("Select at least one original saved visit")
    if len(ids) != len(set(ids)):
        raise ImplementationError("Select each original visit once")
    title = value.get("title", "Field crew packet")
    if not isinstance(title, str) or not title.strip():
        raise ImplementationError("Name the field crew packet")
    return {"title": title.strip(), "visit_ids": list(ids)}


def _root(workspace, plan_id, key):
    _safe_id(plan_id, "plan_id")
    if not isinstance(key, str) or not HEX.fullmatch(key):
        raise ImplementationError("Choose a retained field deployment identity")
    root = workspace.root.resolve()
    directory = root / "implementation" / "plans" / plan_id / "deployments" / key
    if not directory.resolve().is_relative_to(root) or directory.is_symlink():
        raise ImplementationError("The field packet must remain in its original plan bank")
    return directory


def _text(value):
    return "" if value is None else json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else str(value)


def _calendar(visit):
    value = visit.get("original_calendar")
    return value if isinstance(value, dict) else {}


def _context(workspace, plan_id, revision, selection):
    selected = _selection(selection)
    store = ImplementationStore(workspace)
    plan = store.get(plan_id, revision)
    if revision != plan["revision"]:
        raise ImplementationError("Choose the exact saved native revision")
    wanted = set(selected["visit_ids"])
    available = {row["id"] for row in plan["visits"]}
    if wanted - available:
        raise ImplementationError("Selected visits are absent from this saved revision")
    # Retain declared selection order; the printable grouping preserves it within a crew/day.
    index = {row["id"]: row for row in plan["visits"]}
    visits = [deepcopy(index[key]) for key in selected["visit_ids"]]
    site_ids = {row["site_id"] for row in visits}
    monitor_ids = {row.get("monitoring_plan_id") for row in visits}
    sites = [deepcopy(row) for row in plan["sites"] if row["id"] in site_ids]
    protocols = [deepcopy(row) for row in plan["monitoring_plans"] if row["id"] in monitor_ids]
    activities = [deepcopy(row) for row in plan["activities"] if row["visit_id"] in wanted]
    activity_ids = {row["id"] for row in activities}
    observations = [deepcopy(row) for row in plan["observations"] if row["activity_id"] in activity_ids]
    attachments, files = _attachment_inventory(workspace, plan)
    from build_implementation_offline import PARTS
    offline = {name: describe_file(APPLICATION, APPLICATION / name)
               for name in ["build_implementation_offline.py", *PARTS.values()]}
    binding = {"plan_id": plan["id"], "title": plan["title"], "revision": plan["revision"],
               "document_digest": document_digest(plan)}
    revision_path = store.base / plan["id"] / "revisions" / ("%016d.json" % plan["revision"])
    identity = {"version": VERSION, "implementation_sha256": file_digest(__file__),
                "workspace_id": workspace.project["id"], "plan": binding, "selection": selected,
                "original_revision": describe_file(workspace.root, revision_path),
                "attachment_inventory": attachments, "offline_application_sources": offline}
    site_index = {row["id"]: row for row in sites}
    issues = []
    for visit in visits:
        site = site_index[visit["site_id"]]
        for code, condition, message in (
            ("planned_date", not visit.get("planned_date"), "Set the planned date to include this visit in the calendar."),
            ("observer", not visit.get("observer"), "The original observer assignment is blank."),
            ("coordinate", site.get("latitude") is None, "This original site has no point coordinate; review its retained source/search area."),
            ("protocol", not visit.get("monitoring_plan_id"), "This visit has no linked monitoring protocol."),
        ):
            if condition:
                issues.append({"visit_id": visit["id"], "code": code, "message": message})
        if _calendar(visit).get("start_local") or _calendar(visit).get("finish_local"):
            issues.append({"visit_id": visit["id"], "code": "local_clock",
                           "message": "Original local clock values are printed. Calendar events use the planned date; no time zone is assigned."})
    for activity in activities:
        if activity["kind"] == "sample" and not activity.get("custody_ref"):
            issues.append({"visit_id": activity["visit_id"], "activity_id": activity["id"],
                           "code": "custody", "message": "This retained sample has no recorded custody reference."})
    groups = defaultdict(list)
    for visit in visits:
        calendar = _calendar(visit)
        groups[(visit.get("planned_date") or "", _text(calendar.get("crew")), visit.get("observer") or "")].append(visit["id"])
    summary = {"visits": len(visits), "sites": len(sites), "protocols": len(protocols),
               "activities": len(activities), "observations": len(observations),
               "mapped_sites": sum(row.get("latitude") is not None for row in sites),
               "calendar_events": sum(bool(row.get("planned_date")) for row in visits),
               "available_attachments": len(files),
               "groups": [{"planned_date": day or None, "crew": crew or None, "observer": observer or None,
                           "visit_ids": ids} for (day, crew, observer), ids in sorted(groups.items())]}
    return {"id": digest(identity), "identity": identity, "selection": selected, "plan": binding,
            "original_plan": plan, "revision_path": revision_path,
            "visits": visits, "sites": sites, "monitoring_plans": protocols,
            "activities": activities, "observations": observations,
            "attachment_inventory": attachments, "attachment_files": files,
            "summary": summary, "issues": issues}


def preview(workspace, plan_id, revision, selection):
    value = _context(workspace, plan_id, revision, selection)
    return {"schema": SCHEMA, "state": "preview",
            **{name: value[name] for name in ("id", "plan", "selection", "summary", "issues",
                                             "visits", "sites", "monitoring_plans", "attachment_inventory")}}


def _copy_file(source, target, descriptor):
    if target.exists():
        verify_file(target.parent, {**descriptor, "path": target.name})
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".field-deployment-", dir=target.parent)
    pending = Path(temporary)
    try:
        import hashlib
        checksum, size = hashlib.sha256(), 0
        with os.fdopen(fd, "wb") as outgoing, Path(source).open("rb") as incoming:
            for body in iter(lambda: incoming.read(1024 * 1024), b""):
                outgoing.write(body); checksum.update(body); size += len(body)
            outgoing.flush(); os.fsync(outgoing.fileno())
        if size != descriptor["bytes"] or checksum.hexdigest() != descriptor["sha256"]:
            raise ImplementationError("An original field deployment source changed")
        os.replace(pending, target)
        _fsync_directory(target.parent)
    finally:
        pending.unlink(missing_ok=True)


def _csv(rows, preferred):
    fields = list(dict.fromkeys([*preferred, *(key for row in rows for key in row)]))
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(fields)
    for row in rows:
        # Preserve original strings, nested records and nulls in the complete companion JSON.
        writer.writerow([("'" + row[key] if isinstance(row.get(key), str) and row[key].lstrip().startswith(("=", "+", "-", "@"))
                          else _text(row.get(key))) for key in fields])
    return output.getvalue().encode("utf-8-sig")


def _ical_text(value):
    text = _text(value).replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(char if ord(char) >= 32 or char in "\n\t" else " " for char in text)
    return text.replace("\\", "\\\\").replace("\n", "\\n").replace(";", "\\;").replace(",", "\\,")


def _fold(value):
    lines, line, size = [], "", 0
    for char in value:
        width = len(char.encode("utf-8"))
        if size + width > 75:
            lines.append(line); line, size = " ", 1
        line += char; size += width
    return "\r\n".join([*lines, line])


def calendar_bytes(context):
    """RFC5545 date events; original local clocks remain explicit description fields."""
    plan = context["original_plan"]
    timestamp = dt.datetime.fromisoformat(plan["updated_at"].replace("Z", "+00:00")).astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Upper Savannah//Field crew packet//EN",
             "CALSCALE:GREGORIAN"]
    sites = {row["id"]: row for row in context["sites"]}
    for visit in context["visits"]:
        if not visit.get("planned_date"):
            continue
        site, original = sites[visit["site_id"]], _calendar(visit)
        uid = digest({"workspace": context["identity"]["workspace_id"], "plan": plan["id"], "visit": visit["id"]})
        description = "\n".join([
            "Plan: " + plan["title"] + "; revision " + str(plan["revision"]),
            "Original visit: " + visit["id"], "Recorded status: " + visit["status"],
            "Observer: " + visit.get("observer", ""), "Original crew: " + _text(original.get("crew")),
            "Original local start: " + _text(original.get("start_local")),
            "Original local finish: " + _text(original.get("finish_local")),
            "Original calendar: " + _text(original), "Notes: " + visit.get("notes", ""),
            "Open the retained crew packet and existing field workbench for original protocol and actual field capture.",
        ])
        lines.extend(["BEGIN:VEVENT", "UID:" + uid + "@upstate-field",
                      "DTSTAMP:" + timestamp, "LAST-MODIFIED:" + timestamp,
                      "DTSTART;VALUE=DATE:" + visit["planned_date"].replace("-", ""),
                      "SUMMARY:" + _ical_text(site["label"] + " — " + plan["title"]),
                      "LOCATION:" + _ical_text(site["label"]),
                      "DESCRIPTION:" + _ical_text(description), "TRANSP:TRANSPARENT"])
        if visit["status"] == "cancelled":
            lines.append("STATUS:CANCELLED")
        if site.get("latitude") is not None:
            lines.append("GEO:" + str(site["latitude"]) + ";" + str(site["longitude"]))
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return ("\r\n".join(_fold(line) for line in lines) + "\r\n").encode("utf-8")


def _table(headers, rows):
    return ('<div class="table"><table><thead><tr>' + "".join("<th>" + escape(_text(x)) + "</th>" for x in headers)
            + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + escape(_text(x)) + "</td>" for x in row)
                                                + "</tr>" for row in rows) + "</tbody></table></div>")


def render_html(context):
    plan = context["original_plan"]
    sites = {row["id"]: row for row in context["sites"]}
    protocols = {row["id"]: row for row in context["monitoring_plans"]}
    visits = {row["id"]: row for row in context["visits"]}
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
             "<title>" + escape(context["selection"]["title"]) + "</title>",
             "<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1120px;margin:32px auto;padding:0 20px;color:#222;background:#fff}h1,h2,h3{line-height:1.25}h2{border-top:2px solid #555;padding-top:18px}a{color:#222}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #aaa;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}.table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.sheet{border:1px solid #888;padding:18px;margin:20px 0}.line{min-height:38px;border-bottom:1px solid #aaa}.muted{color:#555}@media print{body{font-size:11px;margin:0;max-width:none}.screen{display:none}.sheet{break-before:page;border:0;padding:0}thead{display:table-header-group}tr{break-inside:avoid}.table{overflow:visible}a{color:#222;text-decoration:none}}</style>",
             "<h1>" + escape(context["selection"]["title"]) + "</h1>",
             "<p>" + escape(plan["title"]) + " · saved revision " + str(plan["revision"]) + "</p>",
             '<p class="screen"><a href="field-workbench.html">Open field workbench</a> · <a href="original-plan.json" download>Complete editable plan</a> · <a href="visits.ics" download>Calendar</a> · <a href="sites.geojson" download>Site geometry</a></p>',
             "<p>Open the field workbench, choose Open JSON and select original-plan.json. Record actual visits, samples and observations there, export the complete edited plan, and import it in the original Workspace. Review the saved revision before returning completed work to its original Monitoring campaign.</p>",
             "<p>The packet groups original visits by planned date, original crew and observer. Local clock values remain as recorded. Calendar events cover the stated day. Source search areas remain identified where no station point is available.</p>"]
    parts.append(_table(["Day", "Original crew", "Observer", "Visits"], [
        [row["planned_date"], row["crew"], row["observer"], len(row["visit_ids"])] for row in context["summary"]["groups"]]))
    parts.append("<h2>Preparation notes</h2>" + _table(["Visit / activity", "Recorded preparation detail"], [
        [row.get("activity_id") or row["visit_id"], row["message"]] for row in context["issues"]]))
    parts.append("<h2>Selected sites</h2>" + _table(["Site", "Latitude", "Longitude", "Geometry role", "Original source"], [
        [site["label"], site.get("latitude"), site.get("longitude"), site.get("geometry_role"), site.get("source_ref")]
        for site in context["sites"]]))
    for group in context["summary"]["groups"]:
        for key in group["visit_ids"]:
            visit, site = visits[key], sites[visits[key]["site_id"]]
            protocol = protocols.get(visit.get("monitoring_plan_id"))
            original = _calendar(visit)
            parts.append('<section class="sheet"><h2>' + escape(site["label"]) + "</h2>")
            parts.append(_table(["Field", "Original saved value"], [
                ["Visit ID", visit["id"]], ["Planned date", visit.get("planned_date")],
                ["Original crew", original.get("crew")], ["Observer", visit.get("observer")],
                ["Original local start / finish", _text(original.get("start_local")) + " / " + _text(original.get("finish_local"))],
                ["Recorded status", visit["status"]], ["Recorded actual visit", visit.get("visited_at")],
                ["Site ID", site["id"]], ["Latitude / longitude", _text(site.get("latitude")) + " / " + _text(site.get("longitude"))],
                ["Site geometry role", site.get("geometry_role")], ["Visit notes", visit.get("notes")],
                ["Evidence references", visit.get("evidence_refs", [])],
            ]))
            if protocol:
                parts.append("<h3>Monitoring protocol</h3>" + _table(["Field", "Original saved value"], [
                    [key.replace("_", " "), value] for key, value in protocol.items()]))
            parts.append("<h3>Original activities and sample custody</h3>" + _table(
                ["Activity", "Kind", "Sample ID", "Collected at", "Method", "Custody reference", "Notes"],
                [[row["id"], row["kind"], row.get("sample_id"), row.get("collected_at"), row.get("method"),
                  row.get("custody_ref"), row.get("notes")] for row in context["activities"] if row["visit_id"] == visit["id"]]))
            parts.append("<h3>Field entries</h3><p>Enter observations in the complete editable plan. These blank lines are available for handwritten capture.</p>"
                         '<p class="line">Actual date/time and time zone:</p><p class="line">Observer / crew:</p>'
                         '<p class="line">Activity / sample identifiers and custody:</p><p class="line">Field conditions / notes:</p>'
                         '<p class="line">Follow-up:</p><details><summary>Complete original site and visit</summary><pre>'
                         + escape(json.dumps({"site": site, "visit": visit}, ensure_ascii=False, indent=2)) + "</pre></details></section>")
    parts.append("<h2>Original sources and attachments</h2>" + _table(["Source", "Kind", "Reference"], [
        [row["label"], row["kind"], row.get("reference")] for row in plan["source_links"]]))
    parts.append(_table(["Original local attachment", "Availability"], [
        [row["label"], row["state"].replace("_", " ")] for row in context["attachment_inventory"]]))
    parts.append('<p>selected-records.json retains every original selected row field. original-plan.json contains the complete saved plan, source snapshots and result records. packet-index.json lists all retained file identities.</p></html>')
    return "".join(parts).encode("utf-8")


def prepare(workspace, plan_id, revision, selection, *, expected_id):
    selected = _selection(selection)
    store = ImplementationStore(workspace)
    # Same lock used by plan editing and whole-Workspace capture.
    with store._locked(plan_id):
        directory = _root(workspace, plan_id, expected_id)
        if (directory / "deployment.json").exists():
            result = inspect(workspace, plan_id, expected_id)
            if result["plan"]["revision"] != revision or result["selection"] != selected:
                raise ImplementationError("The retained field packet belongs to another original request")
            return dict(result, reused=True)
        context = _context(workspace, plan_id, revision, selected)
        if context["id"] != expected_id:
            raise ImplementationError("The saved field selection or source files changed after preview")
        directory.mkdir(parents=True, exist_ok=True)
        atomic_json(directory / "intent.json", context["identity"], immutable=True)
        atomic_json(directory / "original-plan.json", context["original_plan"], immutable=True)
        _copy_file(context["revision_path"], directory / "original-revision.json",
                   context["identity"]["original_revision"])
        records = {name: context[name] for name in ("visits", "sites", "monitoring_plans", "activities", "observations")}
        atomic_json(directory / "selected-records.json", records, immutable=True)
        atomic_json(directory / "selection.json", context["selection"], immutable=True)
        atomic_json(directory / "attachment-inventory.json", context["attachment_inventory"], immutable=True)
        atomic_json(directory / "preparation.json", {"summary": context["summary"], "issues": context["issues"]}, immutable=True)
        for name, headers in (
            ("visits", ["id", "planned_date", "site_id", "observer", "status", "monitoring_plan_id"]),
            ("sites", ["id", "label", "latitude", "longitude", "geometry_role"]),
            ("monitoring_plans", ["id", "title", "objective", "parameters", "method_ref"]),
            ("activities", ["id", "visit_id", "site_id", "kind", "sample_id", "collected_at", "method", "custody_ref"]),
            ("observations", ["id", "activity_id", "parameter", "result_type", "original_text", "unit"]),
        ):
            atomic_bytes(directory / (name + ".csv"), _csv(records[name], headers), immutable=True)
        features = [{"type": "Feature", "id": site["id"],
                     "geometry": {"type": "Point", "coordinates": [site["longitude"], site["latitude"]]}
                                 if site.get("latitude") is not None else None,
                     "properties": {**site, "deployment_visit_ids": [row["id"] for row in context["visits"] if row["site_id"] == site["id"]]}}
                    for site in context["sites"]]
        atomic_json(directory / "sites.geojson", {"type": "FeatureCollection", "features": features}, immutable=True)
        atomic_bytes(directory / "visits.ics", calendar_bytes(context), immutable=True)
        atomic_bytes(directory / "crew-packet.html", render_html(context), immutable=True)
        # Retain the complete existing offline editor from the exact reviewed installed sources.
        from build_implementation_offline import build
        built_path = directory / "field-workbench.html"
        built = build(APPLICATION, built_path)
        atomic_json(directory / "offline-build.json", {name: built[name] for name in ("schema", "bytes", "sha256", "inputs")}, immutable=True)
        for name, descriptor in context["identity"]["offline_application_sources"].items():
            verify_file(APPLICATION, descriptor)
        for path, descriptor in context["attachment_files"]:
            _copy_file(path, directory / descriptor["retained_path"], descriptor)
        names = ["intent.json", "original-plan.json", "original-revision.json", "selected-records.json",
                 "selection.json", "attachment-inventory.json", "preparation.json",
                 "visits.csv", "sites.csv", "monitoring_plans.csv", "activities.csv", "observations.csv",
                 "sites.geojson", "visits.ics", "crew-packet.html", "field-workbench.html", "offline-build.json"]
        names.extend(row["retained_path"] for row in context["attachment_inventory"] if row["state"] == "retained")
        members = {name: describe_file(directory, directory / name) for name in dict.fromkeys(names)}
        index = {"schema": SCHEMA, "id": context["id"], "identity": context["identity"],
                 "files": members, "summary": context["summary"], "issues": context["issues"]}
        atomic_json(directory / "packet-index.json", index, immutable=True)
        members["packet-index.json"] = describe_file(directory, directory / "packet-index.json")
        package = {}
        for name, descriptor in members.items():
            add_member(package, name, file_member(directory / name, descriptor["bytes"], descriptor["sha256"]))
        retain_packet(directory / "crew-packet.zip", package)
        members["crew-packet.zip"] = describe_file(directory, directory / "crew-packet.zip")
        result = {"schema": SCHEMA, "id": context["id"], "state": "complete",
                  "identity": context["identity"], "plan": context["plan"], "selection": context["selection"],
                  "summary": context["summary"], "issues": context["issues"], "files": members}
        result["record_sha256"] = digest(result)
        atomic_json(directory / "deployment.json", result, immutable=True)
        return result


def inspect(workspace, plan_id, key, *, verify=True):
    directory = _root(workspace, plan_id, key)
    result = read_json(directory / "deployment.json")
    if (result.get("schema") != SCHEMA or result.get("state") != "complete" or result.get("id") != key
            or digest(result["identity"]) != key or result["identity"]["workspace_id"] != workspace.project["id"]
            or result["plan"] != result["identity"]["plan"] or result["plan"]["plan_id"] != plan_id
            or result["selection"] != result["identity"]["selection"]
            or digest({k: v for k, v in result.items() if k != "record_sha256"}) != result.get("record_sha256")):
        raise ImplementationError("The retained field packet differs from its original saved selection")
    if verify:
        plan = ImplementationStore(workspace).get(plan_id, result["plan"]["revision"])
        if document_digest(plan) != result["plan"]["document_digest"]:
            raise ImplementationError("The original saved field revision changed")
        for descriptor in result["files"].values():
            verify_file(directory, descriptor)
        if validate_plan(read_json(directory / "original-plan.json")) != plan:
            raise ImplementationError("The packet's complete plan differs from the saved revision")
    return result


def catalog(workspace, plan_id):
    store = ImplementationStore(workspace)
    store.get(plan_id)
    return [{name: row[name] for name in ("id", "plan", "selection", "summary")}
            for path in sorted((store.base / plan_id / "deployments").glob("*/deployment.json"))
            for row in [inspect(workspace, plan_id, path.parent.name, verify=False)]]


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--revision", type=int)
    parser.add_argument("--visit", action="append", default=[])
    parser.add_argument("--title", default="Field crew packet")
    parser.add_argument("--expected-id")
    parser.add_argument("--inspect-id")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.inspect_id:
        result = inspect(workspace, args.plan_id, args.inspect_id)
    else:
        selection = {"title": args.title, "visit_ids": args.visit}
        result = (prepare(workspace, args.plan_id, args.revision, selection, expected_id=args.expected_id)
                  if args.expected_id else preview(workspace, args.plan_id, args.revision, selection))
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Receive complete source-backed load reviews through the original workspace actions."""
from __future__ import annotations

import base64
import copy
import io
from pathlib import PurePosixPath
import re
import zipfile

from .store import Conflict, digest, encoded, identifier
from .load_forecast_sources import MAX_BYTES, STATUSES, inspect_file, map_source, strict_json, text
from .load_forecast import assemble_review


def safe_member(value):
    if not isinstance(value, str) or not value or len(value) > 1000 or "\\" in value:
        raise ValueError("The package member name is invalid.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("The package contains an unsafe member name.")
    return value


MAX_DELIVERY_MEMBERS = 6000
MAX_DELIVERY_EXPANDED_BYTES = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 2 * 1024 * 1024


def validate_delivery_members(members):
    """The exporter and receiving inspector share one complete member envelope."""
    names = [safe_member(name) for name, _ in members]
    if len(names) != len(set(names)) or len(names) > MAX_DELIVERY_MEMBERS:
        raise ValueError("The complete package must contain unique members and at most 6,000 files; narrow the review source scope.")
    if any(not isinstance(size, int) or isinstance(size, bool) or size < 0 or size > MAX_BYTES
           for _, size in members) or sum(size for _, size in members) > MAX_DELIVERY_EXPANDED_BYTES:
        raise ValueError("The complete package supports 64 MiB per file and 256 MiB expanded; narrow the review source scope.")
    lengths = dict(members)
    if "manifest.json" not in lengths:
        raise ValueError("This ZIP has no original load-review manifest.")
    if lengths["manifest.json"] > MAX_MANIFEST_BYTES:
        raise ValueError("The complete member manifest supports 2 MiB; narrow the review source scope.")
    return names


def reference(record, kind):
    if not isinstance(record, dict) or record.get("kind") != kind:
        raise ValueError("A retained record has the wrong kind.")
    identifier(record["id"])
    if not isinstance(record.get("revision"), int) or isinstance(record["revision"], bool) or record["revision"] < 1:
        raise ValueError("A retained record must identify its exact revision.")
    return {k: record[k] for k in ("kind", "id", "revision")}


def inspect_delivery(data):
    if len(data) > MAX_BYTES:
        raise ValueError("The complete receiving ZIP may contain at most 64 MiB.")
    try:
        package = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("Select the complete load-forecast export ZIP.") from None
    with package:
        members = package.infolist()
        names = validate_delivery_members([(m.filename, m.file_size) for m in members])
        if any(m.flag_bits & 1 or m.is_dir() for m in members):
            raise ValueError("The package contains encrypted or directory members.")
        manifest = strict_json(package.read("manifest.json"))
        if not isinstance(manifest, dict) or manifest.get("schema") != "commons.load-forecast-export.v1":
            raise ValueError("Select an original commons.load-forecast-export.v1 package.")
        listed = manifest.get("files")
        if not isinstance(listed, list):
            raise ValueError("The manifest must list every original file.")
        files = {}
        for item in listed:
            name = safe_member(item.get("name"))
            if name in files or name == "manifest.json" or not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256"))):
                raise ValueError("The member manifest is ambiguous.")
            if not isinstance(item.get("bytes"), int) or isinstance(item["bytes"], bool) or item["bytes"] < 0:
                raise ValueError("A member length is invalid.")
            content = package.read(name)
            if len(content) != item["bytes"] or digest(content) != item["sha256"]:
                raise ValueError("A complete original member differs from its declared bytes: " + name)
            files[name] = content
        if set(names) != set(files) | {"manifest.json"}:
            raise ValueError("The ZIP contains an unlisted or missing member.")
    for required in ("report.json", "review.json", "Load_Forecast_Review.xlsx", "Load_Forecast_Review.html", "RECEIVING.md"):
        if required not in files:
            raise ValueError("The complete analyst delivery is missing " + required)
    review, report = strict_json(files["review.json"]), strict_json(files["report.json"])
    if reference(review, "load_review") != manifest["review"] or report.get("schema") != "commons.load-forecast-review.v1":
        raise ValueError("The delivery's saved review identity differs from its manifest.")
    p = review["payload"]
    if (p.get("state") != "FINALIZED" or p.get("report", {}).get("digest") != digest(files["report.json"]) or
            manifest.get("report_sha256") != digest(files["report.json"]) or
            p.get("review", {}).get("report_digest") != manifest["report_sha256"]):
        raise ValueError("This package does not contain the exact finalized review.")
    plan_record = report["plan"]
    if reference(plan_record, "load_plan") != p.get("plan"):
        raise ValueError("The review's selected plan differs from its original snapshot.")
    plan = plan_record["payload"]
    if (plan.get("mode") not in ("forecast_revision", "forecast_accuracy") or plan.get("baseline_signal") != "forecast" or
            plan.get("current_signal") not in (("forecast",) if plan["mode"] == "forecast_revision" else ("actual", "weather_normalized"))):
        raise ValueError("The retained comparison mode and source signals are invalid.")
    records, source_rows, seen = [], {}, set()
    for source in report["sources"]:
        source_ref = reference(source, "load_source")
        key = encoded(source_ref)
        if key in seen:
            raise ValueError("The report repeats one source edition.")
        seen.add(key)
        sp = source["payload"]
        if sp.get("state") != "ACCEPTED" or sp.get("status") not in STATUSES:
            raise ValueError("Each selected source must retain its accepted publication classification.")
        prefix = "sources/" + source["id"] + "-r" + str(source["revision"]) + "/"
        if strict_json(files[prefix + "record.json"]) != source:
            raise ValueError("A source record differs between its file and the prepared review.")
        originals = [name for name in files if name.startswith(prefix + "original/")]
        if len(originals) != 1:
            raise ValueError("Each source edition requires one complete original file.")
        raw = files[originals[0]]
        if len(raw) != sp["original"]["bytes"] or digest(raw) != sp["original"]["digest"]:
            raise ValueError("A selected original source file differs from its retained identity.")
        inspection = inspect_file(raw, sp["original"]["name"])
        if inspection != sp["inspection"]:
            raise ValueError("The retained workbook sheet inventory differs from the actual original.")
        if sp["review"].get("original_sha256") != sp["original"]["digest"]:
            raise ValueError("The source acceptance does not bind this original file.")
        if sp.get("normalised"):
            normalised = files[prefix + "normalised.json"]
            if (len(normalised) != sp["normalised"]["bytes"] or digest(normalised) != sp["normalised"]["digest"] or
                    sp["review"].get("normalised_sha256") != sp["normalised"]["digest"]):
                raise ValueError("A source's retained normalized table differs from its acceptance.")
            parsed = map_source(raw, inspection, sp.get("mappings", []))
            if strict_json(normalised) != parsed:
                raise ValueError("The original source mappings do not reproduce the received observations.")
            source_rows[key] = parsed["rows"]
        elif inspection["format"] != "reference":
            raise ValueError("A quantitative source has no retained observations.")
        records.append(source)
    selected_refs = [plan["baseline"], plan["current"], *plan["documents"], *[e["source"] for e in plan["explanations"]]]
    if {encoded(r) for r in selected_refs} != seen:
        raise ValueError("The package's selected source closure differs from its saved plan.")
    recalculated = assemble_review(plan_record, records, source_rows)
    if recalculated != report or p.get("summary") != report["summary"] or p.get("issues") != report["issues"]:
        raise ValueError("The original calculated review differs from its retained source inputs.")
    if set(p["review"].get("acknowledged", [])) != {issue["id"] for issue in report["issues"]}:
        raise ValueError("The final review omits a source or coverage issue.")
    keys, decided = {r["key"] for r in report["comparison"]}, set()
    for decision in p["review"].get("decisions", []):
        if decision.get("key") not in keys or decision["key"] in decided or decision.get("decision") not in ("reviewed", "follow_up", "excluded"):
            raise ValueError("A final row decision does not match the selected comparison.")
        text(decision.get("note"), 20000, True)
        decided.add(decision["key"])
    return {"manifest": manifest, "review": review, "report": report}, files


def adopt_delivery(model, received, request):
    """Use native source/plan actions with retained child identities; keep the delivered edition."""
    current = model.store.get("load_received", received["id"])
    if current["payload"].get("origin_package_sha256") != received["payload"]["origin_package_sha256"]:
        raise Conflict("The received package identity changed.")
    if current["payload"].get("state") == "ADOPTED":
        return current
    p = received["payload"]
    if p.get("state") != "RECEIVED":
        raise ValueError("Choose a verified received load-review package.")
    report = strict_json(model.store.bytes(p["report"]["digest"]))
    def child(action, suffix, body):
        operation = "load-receive-" + digest(encoded([received["id"], received["revision"], action, suffix]).encode())[:32]
        return model.service.dispatch(action, {**body, "operation_id": operation, "actor": received["actor"]})["record"]
    mapping = {}
    for source in report["sources"]:
        sp = source["payload"]
        old_ref = model.ref(source)
        prefix = "sources/" + source["id"] + "-r" + str(source["revision"]) + "/original/"
        entries = [value for name, value in p["retained"].items() if name.startswith(prefix)]
        if len(entries) != 1:
            raise ValueError("The selected original file is missing from the received package.")
        raw = model.store.bytes(entries[0]["digest"])
        received_source = child("load.source.upload", encoded(old_ref), {
            "filename": sp["original"]["name"], "base64": base64.b64encode(raw).decode(),
            "label": sp["label"], "publisher": sp["publisher"], "source_url": sp["source_url"],
            "vintage": sp["vintage"], "published": sp["published"], "status": sp["status"]})
        if sp.get("normalised"):
            received_source = child("load.source.map", encoded(old_ref), {
                "id": received_source["id"], "expected": received_source["revision"], "mappings": sp.get("mappings", [])})
            if received_source["payload"]["normalised"]["digest"] != sp["normalised"]["digest"]:
                raise ValueError("Native receiving changed the original normalized source.")
        received_source = child("load.source.accept", encoded(old_ref), {
            "id": received_source["id"], "expected": received_source["revision"], "acknowledge_missing": True,
            "note": sp["review"]["note"]})
        mapping[encoded(old_ref)] = model.ref(received_source)
    plan = copy.deepcopy(report["plan"]["payload"])
    plan.pop("_operation_id", None)
    plan["baseline"] = mapping[encoded(plan["baseline"])]
    plan["current"] = mapping[encoded(plan["current"])]
    plan["documents"] = [mapping[encoded(r)] for r in plan["documents"]]
    for explanation in plan["explanations"]:
        explanation["source"] = mapping[encoded(explanation["source"])]
    plan["received_from"] = model.ref(received)
    saved = child("load.plan.save", "editable-plan", {"plan": plan})
    return model.write("load_received", {**p, "state": "ADOPTED", "editable_plan": model.ref(saved),
        "source_map": [{"original": strict_json(key), "local": value} for key, value in sorted(mapping.items())]},
        {"id": received["id"], "expected": received["revision"]})

"""Receive the reviewed original source-explorer selection into native reports."""
from __future__ import annotations

import hashlib
import json
import math
import re

from .common import atomic_bytes, atomic_json, describe_file

SCHEMA = "upstate.watershed-source-review/v1"
VERSION = "2026-10-13-original-source-review-1"
SOURCE_BANK_SHA256 = "24db44e3b3896bafadbba3f50eacd5a852913baf201fd828123626a9fc45655d"
SOURCES = {
    "utility-focus-profile.json": {
        "bytes": 2169,
        "sha256": "93abaaf736c66a7ca971ca931da2a3d81d939ecdeb830c7892267153c4413da7",
        "mode": "100644"
    },
    "usgs-wbd-savannah-original-topology-20261013.json": {
        "bytes": 71787,
        "sha256": "2e57f86d1725526f00f16870b1b03d9168b41ea94de6d0016b20dfe15e89bcac",
        "mode": "100644"
    },
    "domain-huc12s.json": {
        "bytes": 3256,
        "sha256": "ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52",
        "mode": "100644"
    }
}
INITIAL = {
    "project": "Upper Savannah source-water mapping workshare",
    "reviewer": "",
    "geography": "Review ARJWS Six and Twenty anchors and PRWD Tugaloo/Choestoea anchors with the complete upstream context retained.",
    "sourceareas": "Agree how the original utility source-water protection areas and whole-HUC planning footprints enter the drinking-water map.",
    "modelchoices": "Confirm the selected 30 m analysis grid, outside-basin modeling buffer, South Carolina reporting mask and sourced nutrient/sediment profiles.",
    "alternatives": "Define the two reviewed land-cover alternatives and the real decision each should support.",
    "receiving": "Name the receiving operator and formats needed for the editable project, maps, physical data and report.",
    "firstresult": "Agree the source/grid/method setup review and its acceptance within the existing proposed workshare."
}
LABELS = {
    "project": "Project", "reviewer": "Recorded reviewer",
    "geography": "Geographic scope", "sourceareas": "Source-water areas",
    "modelchoices": "Model setup", "alternatives": "Alternatives",
    "receiving": "Receiving operator and formats", "firstresult": "First setup review",
}
SOURCE_URI = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6"


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _keys(value, label):
    if (not isinstance(value, list) or not value
            or any(not isinstance(key, str) or not re.fullmatch(r"[0-9]{12}", key) for key in value)
            or len(set(value)) != len(value)):
        raise ValueError(label + " must retain distinct original twelve-digit HUC12s")
    return sorted(value)


def receive(text, report, choices):
    """Validate the exact original edition and native network before any export."""
    if not isinstance(text, str) or len(text.encode("utf-8")) > 256 * 1024:
        raise ValueError("Choose the source explorer's JSON selection, up to 256 KiB")
    document = json.loads(text)
    if (not isinstance(document, dict) or document.get("schema") != SCHEMA
            or document.get("source_bank_sha256") != SOURCE_BANK_SHA256):
        raise ValueError("Choose the original Upper Savannah source explorer selection")
    originals = document.get("sources")
    if not isinstance(originals, dict) or set(originals) != set(SOURCES):
        raise ValueError("The selection must retain its original profile, network and domain")
    bodies, decoded = {}, {}
    for name, expected in SOURCES.items():
        value = originals[name]
        if not isinstance(value, str):
            raise ValueError("Retain the exact original text for " + name)
        body = value.encode("utf-8")
        if len(body) != expected["bytes"] or _hash(body) != expected["sha256"]:
            raise ValueError("Original source bytes changed: " + name)
        bodies["source-review-originals/" + name] = body
        decoded[name] = json.loads(value)
    domain = _keys(decoded["domain-huc12s.json"], "Original model domain")
    indexed = {row["huc12"]: row for row in report.get("hucs", [])}
    if set(indexed) != set(domain) or len(indexed) != len(report.get("hucs", [])):
        raise ValueError("Open the saved original 217-watershed regional report")
    if (report.get("network") or {}).get("status") != "complete_model_domain":
        raise ValueError("This review requires the report's complete original HUC12 / ToHUC network")
    records = {row["attributes"]["huc12"]: row["attributes"]
               for row in decoded["usgs-wbd-savannah-original-topology-20261013.json"]["features"]}
    for key in domain:
        original = str(records[key].get("tohuc") or "").strip()
        downstream = None if original in ("", "0", "000000000000") else original
        if indexed[key].get("downstream_huc12") != downstream:
            raise ValueError("The saved network differs from the reviewed original downstream link: " + key)
    selection = document.get("selection")
    if not isinstance(selection, dict):
        raise ValueError("Retain the reviewed source selection")
    choice = next((row for row in choices
                   if row.get("receptor_id") == selection.get("receptor_id")
                   and row.get("profile_source", {}).get("sha256")
                   == SOURCES["utility-focus-profile.json"]["sha256"]), None)
    if choice is None or not choice.get("available"):
        raise ValueError("This regional report has no matching original utility profile")
    requested = _keys(selection.get("huc12s"), "Reviewed selection")
    kind = selection.get("kind")
    filters = selection.get("filters")
    if (not isinstance(filters, dict) or set(filters) != {"scope", "state", "search"}
            or filters["scope"] not in ("utility", "domain")
            or filters["state"] not in ("", "SC", "NC", "GA")
            or not isinstance(filters["search"], str) or len(filters["search"]) > 1000):
        raise ValueError("Retain the source explorer's geographic and text filters")
    eligible = domain if filters["scope"] == "domain" else choice["huc12s"]
    search = filters["search"].strip().lower()
    visible = sorted(key for key in eligible if
        (not filters["state"] or filters["state"] in [
            state.strip() for state in records[key]["states"].split(",")])
        and (not search or search in " ".join(str(records[key].get(field) or "")
                                             for field in ("huc12", "name", "tohuc")).lower()))
    if kind == "utility":
        expected = choice["huc12s"]
    elif kind == "visible":
        expected = visible
    elif kind == "focused":
        focus = selection.get("focused_huc12")
        if focus not in visible:
            raise ValueError("The focused watershed is absent from the original reviewed view")
        expected = [focus]
    else:
        raise ValueError("Choose the full utility, visible watersheds or focused watershed")
    if requested != sorted(expected):
        raise ValueError("Reviewed HUC12s differ from the original utility or displayed source filters")
    notes = document.get("discussion")
    if not isinstance(notes, dict) or set(notes) != set(INITIAL):
        raise ValueError("Retain each source-discussion field")
    discussion = []
    for name, prepared in INITIAL.items():
        value = notes[name]
        if not isinstance(value, str) or len(value) > 20000:
            raise ValueError("Discussion fields must be text of at most 20000 characters")
        origin = "empty" if not value.strip() else (
            "prepared_prompt" if value == prepared else "edited_in_explorer")
        discussion.append({"field": name, "label": LABELS[name], "text": value, "origin": origin})
    context = {
        "schema": SCHEMA, "version": VERSION, "original_file_sha256": _hash(text.encode("utf-8")),
        "source_bank_sha256": SOURCE_BANK_SHA256, "selection": {
            "kind": kind, "receptor_id": choice["receptor_id"], "utility_id": choice["utility_id"],
            "utility_title": choice["title"], "huc12s": requested, "filters": filters,
            "focused_huc12": selection.get("focused_huc12"),
            "whole_utility_huc12s": choice["huc12s"],
        },
        "published_usgs_area_sqkm": math.fsum(float(records[key]["areasqkm"]) for key in requested),
        "published_usgs_area_acres": math.fsum(float(records[key]["areaacres"]) for key in requested),
        "source_area_basis": "Original USGS whole-HUC areas counted once per selected HUC12",
        "native_binding": {"report_id": report["id"], "utility_key": choice["key"],
                           "profile_sha256": choice["profile_source"]["sha256"]},
        "discussion": discussion,
        "sources": [{"name": name, **value, "path": "source-review-originals/" + name}
                    for name, value in SOURCES.items()],
        "interpretation": (
            "The review records a source selection and discussion text. Prepared prompts remain "
            "identified separately from edited text. Neither status establishes client agreement "
            "or author identity. The native report retains its own NRCS whole-HUC area fields, "
            "SC source jurisdiction, observations and model/output boundaries."
        ),
    }
    return context, bodies, choice if kind == "utility" else None


def brief_lines(selection, table, number):
    """Add reviewed source geography and text to the same original brief/briefing."""
    review = selection.get("source_review")
    if not review:
        return []
    selected = review["selection"]
    lines = ["## Reviewed explorer selection", "",
             selected["utility_title"] + " · " + selected["kind"].replace("_", " ") + " selection.", ""]
    lines.extend(table(["Original source review", "Retained value"], [
        ["Selected whole HUC12s", ", ".join(selected["huc12s"])],
        ["USGS whole-HUC area (km²)", number(review["published_usgs_area_sqkm"])],
        ["USGS whole-HUC area (acres)", number(review["published_usgs_area_acres"])],
        ["Area basis", review["source_area_basis"]],
        ["Original review SHA-256", review["original_file_sha256"]],
        ["Native source-profile SHA-256", review["native_binding"]["profile_sha256"]],
    ]))
    lines.extend(["", review["interpretation"], "", "### Source setup discussion", ""])
    origins = {"prepared_prompt": "Prepared discussion prompt",
               "edited_in_explorer": "Edited in source explorer", "empty": "No text recorded"}
    lines.extend(table(["Topic", "Text status", "Retained text"], [
        [row["label"], origins[row["origin"]], row["text"]]
        for row in review["discussion"]
    ]))
    lines.extend(["", "Original geographic source: " + SOURCE_URI + ".", ""])
    return lines


def retain(directory, text, review, bodies):
    files = {}
    original = "source-explorer-review.json"
    atomic_bytes(directory / original, text.encode("utf-8"), immutable=True)
    files[original] = describe_file(directory, directory / original)
    atomic_json(directory / "source-explorer-review-bound.json", review, immutable=True)
    files["source-explorer-review-bound.json"] = describe_file(
        directory, directory / "source-explorer-review-bound.json")
    for name, body in bodies.items():
        atomic_bytes(directory / name, body, immutable=True)
        files[name] = describe_file(directory, directory / name)
    return files

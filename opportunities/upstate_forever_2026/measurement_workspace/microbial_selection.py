"""Prepare source-bound microbial activity selections in existing Published studies.

The complete original WQP responses are validated before any row selection.
Every retained activity keeps the existing observation parser, native row index,
qualifier, activity type, original values and method dimensions.
"""
from __future__ import annotations

from collections import Counter
import csv
from html.parser import HTMLParser
import hashlib
import io
import json
from pathlib import PurePosixPath
import re

CONTEXT_SHA = "f53df7b5a31d1f1eb8e28d0b1f23158fbd0d3962ae4483fca7b2ee1cc1751b1d"
OBSERVATIONS_SHA = "72814c13c14624e4f800f9b23a40264f212a4c568d30ad5b42033eee8e9b88ba"
BINDING = CONTEXT_SHA + ":" + OBSERVATIONS_SHA
SOURCE_PREFIX = "source/ecoli_utility_context/20261013/"
MAX_BYTES = 32 * 1024 * 1024
MAX_SELECTION_BYTES = 8 * 1024 * 1024
SELECTION_PATH = "review/selection.json"
PREPARATION_VERSION = 1


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _json(body):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Original JSON repeats a member: " + key)
            result[key] = value
        return result
    def invalid(value):
        raise ValueError("Non-finite original JSON value: " + value)
    return json.loads(body.decode("utf-8-sig"), object_pairs_hook=pairs, parse_constant=invalid)


def _encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _same(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(_same(a[key], b[key]) for key in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    return a == b


def _path(name):
    if not isinstance(name, str) or not name or "\\" in name or any(ord(c) < 32 for c in name):
        raise ValueError("Retain portable original source paths")
    path = PurePosixPath(name)
    if path.is_absolute() or str(path) != name or ":" in path.parts[0] or any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError("An original source path leaves the source edition")
    return name


def _body(workspace, descriptor):
    from model.common import relative_file
    path = relative_file(workspace.root, descriptor["object"])
    with path.open("rb") as stream:
        body = stream.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES or len(body) != descriptor.get("bytes") or _sha(body) != descriptor.get("sha256"):
        raise ValueError("A retained microbial source body changed")
    return body


def _csv(body):
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig"), newline=""))
    fields = reader.fieldnames or []
    if not fields or len(fields) != len(set(fields)):
        raise ValueError("Retain the original microbial CSV columns")
    rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("Retain every original microbial CSV cell")
    return fields, rows


class _Payload(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False
        self.chunks = []
        self.value = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "script" and attrs.get("id") == "microbial-review-data":
            if self.active or self.value is not None or attrs.get("type") != "application/json":
                raise ValueError("Choose one complete original microbial report payload")
            self.active = True

    def handle_data(self, text):
        if self.active:
            self.chunks.append(text)

    def handle_endtag(self, tag):
        if tag == "script" and self.active:
            self.value = _json("".join(self.chunks).encode("utf-8"))
            self.active = False


def catalog(workspace):
    """Discover retained reports by metadata; read no source bodies or GIS layers."""
    sources = []
    for collection in workspace._list("sources"):
        for entry in collection["entries"]:
            body = entry.get("body", {})
            hashes = {row.get("sha256") for row in entry.get("companions", [])}
            if (entry.get("kind") == "document"
                    and body.get("filename", "").lower().endswith((".html", ".htm"))
                    and {CONTEXT_SHA, OBSERVATIONS_SHA} <= hashes):
                sources.append({"source_collection_id": collection["id"],
                    "source_id": entry["id"], "title": entry.get("title", entry["id"]),
                    "source_sha256": body["sha256"], "binding": BINDING})
    return {"sources": sorted(sources, key=lambda row: (row["title"], row["source_collection_id"], row["source_id"]))}


def _selection_bytes(payload):
    value = payload.get("selection_json")
    if isinstance(value, str):
        value = value.encode("utf-8")
    if not isinstance(value, bytes) or not value or len(value) > MAX_SELECTION_BYTES:
        raise ValueError("Upload the original microbial selection JSON")
    return value


def _inspect(workspace, payload):
    if not isinstance(payload, dict):
        raise ValueError("Choose an imported microbial report and its exported selection")
    collection_id, source_id = payload.get("source_collection_id"), payload.get("source_id")
    candidates = [row for row in catalog(workspace)["sources"]
                  if row["source_collection_id"] == collection_id and row["source_id"] == source_id]
    if len(candidates) != 1:
        raise ValueError("Import the complete measured native report source edition first")
    collection = workspace._get("sources", collection_id)
    entry = next(row for row in collection["entries"] if row["id"] == source_id)
    html = _body(workspace, entry["body"])
    parser = _Payload()
    parser.feed(html.decode("utf-8"))
    parser.close()
    if parser.active or not isinstance(parser.value, dict):
        raise ValueError("The retained report has no complete microbial review payload")
    companions = {row["sha256"]: row for row in entry.get("companions", [])}
    coverage = _json(_body(workspace, companions[CONTEXT_SHA]))
    unused, rows = _csv(_body(workspace, companions[OBSERVATIONS_SHA]))
    if (parser.value.get("binding") != BINDING
            or not _same(parser.value.get("coverage"), coverage)
            or not _same(parser.value.get("rows"), rows)
            or len(rows) != 730 or len({row["activity_id"] for row in rows}) != 730):
        raise ValueError("The report differs from its complete original 730-row microbial source")
    selection_body = _selection_bytes(payload)
    selection = _json(selection_body)
    if not isinstance(selection, dict) or selection.get("schema") != "upstate.microbial-source-selection/v1":
        raise ValueError("Choose an exported upstate.microbial-source-selection/v1 file")
    review = selection.get("review")
    if (selection.get("binding") != BINDING or not isinstance(review, dict)
            or review.get("schema") != "upstate.microbial-source-review/v1"
            or review.get("binding") != BINDING):
        raise ValueError("The selected activities belong to a different original report")
    ids = review.get("selected_activity_ids")
    if (not isinstance(ids, list) or not ids or len(ids) > 730
            or any(not isinstance(value, str) or not value for value in ids)
            or len(set(ids)) != len(ids)):
        raise ValueError("Choose distinct original activity identifiers")
    chosen = set(ids)
    selected = [row for row in rows if row["activity_id"] in chosen]
    if len(selected) != len(ids) or ids != [row["activity_id"] for row in selected]:
        raise ValueError("Retain the exported original activity ordering")
    if not _same(selection.get("observations"), selected):
        raise ValueError("Selected original observation cells were changed")
    station_ids = {row["station_id"] for row in selected}
    expected_station = [row for row in coverage["observed_station_context"]
                        if row["observation_station_id"] in station_ids]
    expected_assessment = [row for row in coverage["matched_assessment_records"]
                           if row["observation_station_id"] in station_ids]
    if (not _same(selection.get("station_context"), expected_station)
            or not _same(selection.get("assessment_context"), expected_assessment)
            or not _same(selection.get("original_provenance"), coverage["provenance"])
            or not _same(selection.get("method"), coverage["method"])):
        raise ValueError("The exported selection's original source context changed")
    if review.get("active_activity_id") is not None and review["active_activity_id"] not in {row["activity_id"] for row in rows}:
        raise ValueError("The active review activity is absent from the original report")
    if not isinstance(review.get("filters"), dict):
        raise ValueError("Retain the exported review filters")
    dates = sorted(row["date"] for row in selected)
    counts = Counter(row["station_id"] for row in selected)
    summary = {"activities": len(selected), "stations": len(counts),
        "routine_activities": sum(row["activity_type"] == "Sample-Routine" for row in selected),
        "field_replicates": sum(row["activity_type"] == "Quality Control Sample-Field Replicate" for row in selected),
        "first_date": dates[0], "last_date": dates[-1],
        "result_status_counts": dict(sorted(Counter(row["status"] for row in selected).items()))}
    public = {"binding": BINDING, "source": candidates[0],
        "selection_sha256": _sha(selection_body), "selected_activity_ids": ids,
        "summary": summary, "stations": [{"station_id": station, "activity_count": count}
                                       for station, count in sorted(counts.items())],
        "observations": selected}
    return public, collection, entry, selection_body


def preview(workspace, payload):
    """Validate the exact exported cells against the retained report and its sources."""
    return _inspect(workspace, payload)[0]


def _collection_members(collection):
    by_hash, by_path = {}, {}
    for entry in collection["entries"]:
        for descriptor in [entry["body"], *entry.get("companions", [])]:
            digest = descriptor["sha256"]
            if digest in by_hash and by_hash[digest]["bytes"] != descriptor["bytes"]:
                raise ValueError("Retained source identities have conflicting byte counts")
            by_hash.setdefault(digest, descriptor)
            name = descriptor.get("source_path")
            if name:
                name = _path(name)
                if name in by_path and by_path[name]["sha256"] != digest:
                    raise ValueError("The source collection assigns conflicting original paths")
                by_path[name] = descriptor
    return by_hash, by_path


def _originals(workspace, collection):
    from .utility_microbiology import RETAINED_MANIFEST_SHA256
    by_hash, by_path = _collection_members(collection)
    descriptor = by_hash.get(RETAINED_MANIFEST_SHA256)
    if descriptor is None:
        raise ValueError("Import the complete 17-source measured delivery to retain its original microbial responses")
    manifest_body = _body(workspace, descriptor)
    manifest = _json(manifest_body)
    originals = {"source-manifest.json": manifest_body}
    # The publisher manifest keeps a hash-free self companion to avoid recursion.
    declared = {"source-manifest.json": {"sha256": RETAINED_MANIFEST_SHA256,
                                          "bytes": len(manifest_body)}}
    for entry in manifest["entries"]:
        for member in [entry, *entry.get("companions", [])]:
            name = _path(member["path"])
            previous = declared.get(name)
            if previous and any(previous.get(key) is not None and member.get(key) is not None
                                and previous[key] != member[key] for key in ("sha256", "bytes")):
                raise ValueError("Original microbial member declarations conflict")
            declared[name] = {**(previous or {}), **{key: value for key, value in member.items() if value is not None}}
    for name, expected in declared.items():
        found = by_hash.get(expected.get("sha256"))
        if found is None or (expected.get("bytes") is not None and expected["bytes"] != found["bytes"]):
            raise ValueError("The original microbial response is absent from this collection: " + name)
        originals[name] = _body(workspace, found)
    return originals, by_path


def _descriptor(path, data):
    return {"path": path, "bytes": len(data), "sha256": _sha(data)}


def _retain_report(workspace, entry, files):
    descriptors = [entry["body"], *entry.get("companions", [])]
    selected = []
    for descriptor in descriptors:
        name = "review/report/" + _path(descriptor["view_path"])
        body = _body(workspace, descriptor)
        if name in files and files[name] != body:
            raise ValueError("Original report companion paths conflict")
        files[name] = body
        selected.append(_descriptor(name, body))
    primary = selected[0]
    return {"id": "selected-microbial-original-report", "kind": "document",
        "title": entry.get("title", entry["id"]), "uri": entry["uri"],
        "vintage": entry["vintage"], **primary,
        "companions": [row for row in selected[1:] if row["path"] != primary["path"]],
        "metadata": {"original_report_source_id": entry["id"],
                     "source_scope": "Complete original report; original full-source panels remain unchanged"}}


def _report_companion_entries(entry):
    """Preserve document companions without reinterpreting display coordinates."""
    members = [{key: entry[key] for key in ("path", "bytes", "sha256")},
               *entry["companions"]]
    result = []
    for member in entry["companions"]:
        if not member["path"].lower().endswith((".html", ".htm", ".geojson")):
            continue
        result.append({
            "id": "selected-microbial-report-companion-" + _sha(member["path"].encode("utf-8"))[:20],
            "kind": "document", "title": "Original report companion — " + PurePosixPath(member["path"]).name,
            "uri": "urn:sha256:" + member["sha256"], "vintage": entry["vintage"],
            **member, "companions": [row for row in members if row["path"] != member["path"]],
            "metadata": {"source_scope": "Original retained report companion; display geometry keeps its original source role"},
        })
    return result


def _retain_context(workspace, by_path, files):
    """Keep complete original temporal/report source trees with their relative links."""
    names = [name for name in by_path if name.startswith((
        SOURCE_PREFIX, "source/ecoli_temporal_analysis/20261013/",
        "observations/observed_hydrology_20261013/original/daily/"))]
    selected, entries = [], []
    for name in sorted(names):
        target = "review/original-application/" + name
        body = _body(workspace, by_path[name])
        files[target] = body
        selected.append(_descriptor(target, body))
    for row in selected:
        if row["path"].lower().endswith((".html", ".geojson")):
            entries.append({"id": "selected-microbial-context-" + row["sha256"][:20],
                "kind": "document", "title": "Original full-source context — " + PurePosixPath(row["path"]).name,
                "uri": "urn:sha256:" + row["sha256"], "vintage": "2026-10-13", **row,
                "companions": [other for other in selected if other["path"] != row["path"]],
                "metadata": {"source_scope": "Complete original source edition; selected activities do not recalculate these panels"}})
    return entries


def prepare(workspace, store, payload, *, operation_id=None):
    """Compile a new selected study through the existing original-observation parser."""
    from . import source_observations, utility_microbiology
    from .published_studies import _observation_rows

    if store.workspace is not workspace:
        raise ValueError("Prepare the selected study in the chosen Workspace")
    public, collection, entry, selection_body = _inspect(workspace, payload)
    originals, by_path = _originals(workspace, collection)
    files = utility_microbiology.build_retained_files(originals)
    # This validates every source hash, query scope and all 730 rows before selection.
    complete = source_observations.load_observations(files, _observation_rows)
    by_activity = {row["activity_id"]: row for row in complete}
    if len(complete) != 730 or len(by_activity) != 730:
        raise ValueError("Retain the full original microbial observation cohort")
    references = []
    for joined in public["observations"]:
        row = by_activity.get(joined["activity_id"])
        if row is None or row["monitoring_location_id"] != joined["station_id"]:
            raise ValueError("A selected activity differs from its original WQP identity")
        # Resolve through the existing parser by ID and verify the author's row locator.
        # The retained joined source_row uses the same header-inclusive numbering.
        if (row["original_source_path"] != "original/" + _path(joined["source_file"])
                or str(row["source_csv_row"]) != joined["source_row"]):
            raise ValueError("A selected activity differs from its original raw CSV row")
        raw = row["raw_cells"]
        native_fields = {"activity_type": "ActivityTypeCode", "date": "ActivityStartDate",
                         "result_value": "ResultMeasureValue",
                         "limit_value": "DetectionQuantitationLimitMeasure/MeasureValue",
                         "source_result_unit": "ResultMeasure/MeasureUnitCode",
                         "source_limit_unit": "DetectionQuantitationLimitMeasure/MeasureUnitCode"}
        if any(joined[key] != raw[field] for key, field in native_fields.items()):
            raise ValueError("A selected activity's original measured value, limit or support changed")
        references.append({field: row[field] for field in (
            "original_source_path", "original_source_sha256", "source_csv_row",
            "monitoring_location_id", "activity_id", "original_record_id")})
    identity = {"schema": "upstate.microbial-selected-study-binding/v1",
        "preparation_version": PREPARATION_VERSION, "report_binding": BINDING,
        "original_manifest_sha256": _sha(originals["source-manifest.json"]),
        "records": sorted(references, key=lambda row: (row["original_source_path"], row["source_csv_row"]))}
    selection_id = "microbial-selection-" + _sha(_encode(identity))[:24]
    binding = {**identity, "selection_id": selection_id,
        "source_collection_id": collection["id"], "source_id": entry["id"],
        "source_sha256": entry["body"]["sha256"],
        "selection_sha256": public["selection_sha256"],
        "selected_activity_ids": public["selected_activity_ids"],
        "summary": public["summary"]}
    retained_report_entry = _retain_report(workspace, entry, files)
    files[SELECTION_PATH] = selection_body
    selector = {"schema": source_observations.SELECTION_SCHEMA,
        "observation_index_sha256": _sha(files[source_observations.INDEX]),
        "original_record_count": len(complete), "record_count": len(references),
        "activity_count": len({row["activity_id"] for row in references}),
        "report_binding": BINDING, "selection_binding": selection_id,
        "selection_source": _descriptor(SELECTION_PATH, selection_body),
        "joined_source": {"path": "review/report/" + _path(next(row["view_path"] for row in entry["companions"] if row["sha256"] == OBSERVATIONS_SHA)),
                          "sha256": OBSERVATIONS_SHA,
                          "bytes": next(row["bytes"] for row in entry["companions"] if row["sha256"] == OBSERVATIONS_SHA)},
        "context_source": {"path": "review/report/" + _path(next(row["view_path"] for row in entry["companions"] if row["sha256"] == CONTEXT_SHA)),
                           "sha256": CONTEXT_SHA,
                           "bytes": next(row["bytes"] for row in entry["companions"] if row["sha256"] == CONTEXT_SHA)},
        "records": identity["records"]}
    files[source_observations.SELECTION_INDEX] = _encode(selector)
    files["review/selection-binding.json"] = _encode(binding)
    selected = source_observations.load_observations(files, _observation_rows)
    station_ids = {row["monitoring_location_id"] for row in selected}
    fields, station_rows = _csv(files["stations.csv"])
    files["stations.csv"] = utility_microbiology._csv_bytes(
        fields, [row for row in station_rows if row["monitoring_location_id"] in station_ids])
    study = _json(files["study.json"])
    title = payload.get("title") or "Selected microbial activities (" + str(len(selected)) + ")"
    if not isinstance(title, str) or not title.strip() or len(title) > 240 or any(ord(c) < 32 for c in title):
        raise ValueError("Give the selected study a short printable title")
    summary = public["summary"]
    study.update(study_id=selection_id, title=title.strip(),
        original_source_study_id=utility_microbiology.BUILTIN_ID,
        observation_selection=source_observations.SELECTION_INDEX,
        microbial_selection=binding,
        grab_sampling={"start": summary["first_date"], "end": summary["last_date"],
                       "frequency": "Selected original irregular sampling dates",
                       "total_visits": len(selected)},
        content_counts={"stations": len(station_ids), "original_result_rows": len(selected),
                        "original_activity_count": len(selected),
                        "quantified": sum(row["value"] is not None for row in selected),
                        "censored": sum(bool(row["censored"]) for row in selected),
                        "not_reported": sum(row["detection_condition"] == "Not Reported" for row in selected)},
        observation_scope="Selected original microbial activities; all complete source responses and original full-source context remain retained.")
    study["source_interpretation"]["selected_activities"] = summary
    study["source_interpretation"]["complete_original_source_counts"] = dict(utility_microbiology.COUNTS)
    study["observation_selection_notes"].insert(0,
        "This study computes from the retained original activity selection. The original full-source explorers and their temporal panels retain their complete source scope.")
    files["study.json"] = _encode(study)
    source_summary = _json(files["source-summary.json"])
    source_summary["selected_activities"] = summary
    source_summary["selection_binding"] = selection_id
    files["source-summary.json"] = _encode(source_summary)
    notes = _json(files["source_notes.json"])
    notes.insert(0, {"code": "SELECTED_ORIGINAL_ACTIVITIES",
        "context": "The study contains " + str(len(selected)) + " selected original activities from " +
                   str(len(station_ids)) + " stations. The full 730-row source index is verified before the retained record selector is applied.",
        "selection_path": SELECTION_PATH, "selection_sha256": public["selection_sha256"]})
    files["source_notes.json"] = _encode(notes)
    manifest = _json(files["model-sources.json"])
    manifest["title"] = title.strip()
    manifest["entries"].append(retained_report_entry)
    manifest["entries"].extend(_report_companion_entries(retained_report_entry))
    manifest["entries"].extend(_retain_context(workspace, by_path, files))
    selection_companions = [_descriptor(name, files[name]) for name in
        (source_observations.SELECTION_INDEX, "review/selection-binding.json",
         source_observations.INDEX)]
    manifest["entries"].append({"id": selection_id + "-review", "kind": "document",
        "title": "Original exported microbial activity selection",
        "uri": "urn:sha256:" + public["selection_sha256"], "vintage": entry["vintage"],
        **_descriptor(SELECTION_PATH, selection_body), "companions": selection_companions,
        "metadata": binding})
    files["model-sources.json"] = _encode(manifest)
    files["README.md"] = (
        "# Selected original microbial activities\n\n"
        "Open this saved edition in Published studies. Its station, calendar, method, qualifier "
        "and activity-type series use the selected original WQP records. Export a saved review "
        "through the existing scientific report workflow, or export and reopen the complete study.\n\n"
        "The exact exported selection is review/selection.json; observation-selection.json "
        "binds each header-inclusive original CSV row. The original observation index and all "
        "six complete response CSVs remain unchanged. Original report and temporal source "
        "explorers under review/ retain their full-source scope.\n"
    ).encode("utf-8")
    companion = _encode({"schema": "upstate.published-study-files/v1",
        "files": [{"path": name, "encoding": "utf-8", "content": body.decode("utf-8"),
                   "bytes": len(body), "sha256": _sha(body)}
                  for name, body in sorted(files.items())]})
    imported = store.import_source(companion, operation_id=operation_id, make_current=True)
    record = imported["record"]
    return {**imported, "study_id": record["study_id"], "version_id": record["version_id"],
            "selection_binding": binding, "preview": public}

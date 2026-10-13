"""Import a source-bound native coverage selection into the existing station study.

The retained native report supplies selection intent and source identities.
Station geography remains the sole location and point/polygon engine.
"""
from __future__ import annotations

import copy
import csv
import gzip
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path, PurePosixPath

from .common import atomic_bytes, atomic_json, canonical, digest, held, relative_file
from .station_study import PUBLISHED_STUDY_ID, PUBLISHED_ASSESSMENT_SHA, prepared_studies

SCHEMA = "upstate.native-assessment-selection/v1"
CONTEXT_SCHEMA = "upstate.assessment-native-huc-context/v1"
CONTEXT_SHA = "bef411c2954fc3e7deb6419b1222b55c36733957700f23ff4d460b35b2b9e360"
ANNUAL_SCHEMA = "upstate.annual-reference-assessment-context/v1"
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_RETAINED_BYTES = 128 * 1024 * 1024


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


def _same(left, right):
    """JSON equality, preserving booleans while permitting JSON numeric spelling."""
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_same(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(_same(a, b) for a, b in zip(left, right))
    return left == right


def _read(path, expected=None):
    path = Path(path)
    with path.open("rb") as stream:
        body = stream.read(MAX_FILE_BYTES + 1)
    if len(body) > MAX_FILE_BYTES:
        raise ValueError("The retained review member exceeds its supported source size")
    if expected and (len(body) != expected["bytes"] or _sha(body) != expected["sha256"]):
        raise ValueError("An original review source changed: " + str(path.name))
    return body


def _body(workspace, descriptor):
    return _read(relative_file(workspace.root, descriptor["object"]), descriptor)


def _path(name):
    if not isinstance(name, str) or not name or "\\" in name or any(ord(c) < 32 for c in name):
        raise ValueError("Retain a portable original source path")
    value = PurePosixPath(name)
    if value.is_absolute() or value.as_posix() != name or ":" in value.parts[0] or any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError("Original review source path leaves its source edition")
    return value.as_posix()


class _Payloads(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.values, self.active, self.chunks = {}, None, []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "script" and attrs.get("id") in ("native-review-data", "association-review-data"):
            name = attrs["id"]
            if self.active or name in self.values or attrs.get("type") != "application/json":
                raise ValueError("Retain one original native report data payload")
            self.active, self.chunks = name, []

    def handle_data(self, data):
        if self.active:
            self.chunks.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.active:
            self.values[self.active] = _json("".join(self.chunks).encode("utf-8"))
            self.active, self.chunks = None, []


def catalog(workspace):
    """List retained native report documents using only source metadata."""
    rows = []
    for collection in workspace._list("sources"):
        for entry in collection["entries"]:
            companions = entry.get("companions", [])
            if entry.get("kind") != "document" or not any(row.get("sha256") == CONTEXT_SHA for row in companions):
                continue
            name = entry.get("body", {}).get("filename", "")
            if not name.lower().endswith((".html", ".htm")):
                continue
            rows.append({"collection_id": collection["id"], "source_id": entry["id"],
                         "title": entry.get("title", entry["id"]),
                         "source_sha256": entry["body"]["sha256"],
                         "native_context_sha256": CONTEXT_SHA})
    return sorted(rows, key=lambda row: (row["title"], row["collection_id"], row["source_id"]))


def _report(workspace, collection_id, source_id):
    if not any(row["collection_id"] == collection_id and row["source_id"] == source_id for row in catalog(workspace)):
        raise ValueError("Choose the imported native assessment report document")
    path, entry = workspace.source_file(collection_id, source_id)
    parser = _Payloads()
    parser.feed(_read(path, entry["body"]).decode("utf-8"))
    parser.close()
    if parser.active or set(parser.values) != {"native-review-data", "association-review-data"}:
        raise ValueError("The retained report has no complete native coverage payload")
    payload = parser.values["native-review-data"]
    review = parser.values["association-review-data"]
    bodies = {row["sha256"]: row for row in entry.get("companions", [])}
    context = _json(_body(workspace, bodies[CONTEXT_SHA]))
    if context.get("schema") != CONTEXT_SCHEMA or not _same(context, payload.get("context")):
        raise ValueError("The native report and retained original context differ")
    report_sha = review.get("source_report_sha256")
    if report_sha not in bodies or not _same(_json(_body(workspace, bodies[report_sha])), review.get("result")):
        raise ValueError("The native report and retained assessment result differ")
    annual = payload.get("annual")
    if annual is not None:
        if annual.get("schema") != ANNUAL_SCHEMA or annual.get("input_sha256") != context["input_sha256"]:
            raise ValueError("The report's annual and geographic source contexts differ")
        matches = [row for row in bodies.values() if row.get("filename", "").endswith("annual-reference-assessment-summary.json")]
        if len(matches) != 1 or not _same(_json(_body(workspace, matches[0])), annual):
            raise ValueError("Retain the original annual summary with the native report")
    binding = payload.get("binding")
    if not isinstance(binding, str) or len(binding) != 64 or any(c not in "0123456789abcdef" for c in binding):
        raise ValueError("The retained native report has no original selection binding")
    return entry, context, annual, binding, bodies


def _selection(review, context, annual, binding):
    if not isinstance(review, dict) or review.get("schema") != SCHEMA or review.get("binding") != binding:
        raise ValueError("Choose a native selection exported from this retained report")
    state = review.get("review")
    if not isinstance(state, dict) or state.get("schema") != "upstate.native-assessment-review/v1" or state.get("binding") != binding:
        raise ValueError("The exported native selection lost its original review state")
    stations = context["stations"]
    source_key = json.dumps([context["input_sha256"], context["domain_zip_sha256"],
                            [[row["station_id"], row["native_location"]["source_body_sha256"],
                              row["native_location"]["native_id"]] for row in stations]],
                           ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if state.get("source_key") != source_key:
        raise ValueError("The selection belongs to another original native source cohort")
    original_native = {key: context[key] for key in ("schema", "input_sha256", "domain_zip_sha256", "domain_member", "method", "runtime")}
    expected_annual = {key: annual[key] for key in ("schema", "input_sha256", "method")} if annual is not None else None
    if not _same(review.get("native_context"), original_native) or not _same(review.get("annual_context"), expected_annual):
        raise ValueError("The exported original native source metadata differs")
    ids = state.get("selected_station_ids")
    by_id = {row["station_id"]: row for row in stations}
    if not isinstance(ids, list) or not ids or any(not isinstance(x, str) or x not in by_id for x in ids) or len(ids) != len(set(ids)):
        raise ValueError("Select at least one distinct station from the original native cohort")
    if ids != [row["station_id"] for row in stations if row["station_id"] in set(ids)]:
        raise ValueError("Preserve the original native station order in the exported selection")
    exported = review.get("stations")
    if not isinstance(exported, list) or len(exported) != len(ids):
        raise ValueError("The exported selection and complete station rows differ")
    for station_id, selected in zip(ids, exported):
        row = by_id[station_id]
        memberships = [{key: basin[key] for key in ("comid", "basin_source_uri", "basin_source_sha256", "selected_component_indices")}
                       | {"names": basin["original_target_station_names"], "original_targets": basin["targets"]}
                       for basin in (annual or {}).get("basins", []) if station_id in basin["assessment_station_ids"]]
        if not isinstance(selected, dict) or not _same(selected.get("original_native_station"), row) or not _same(selected.get("annual_reference_memberships"), memberships):
            raise ValueError("An exported station or annual membership differs from its original report")
    active = state.get("active_station_id")
    if active is not None and active not in by_id:
        raise ValueError("The active review station is outside the original native cohort")
    return ids, by_id


def _point_choices(workspace, selection, ids, by_id):
    """Resolve string-labelled native result IDs back to original typed feature IDs."""
    sources, choices = {}, {}
    references = []
    original_entries = [(collection, entry) for collection in workspace._list("sources")
                        for entry in collection["entries"]]
    needed = {(by_id[station]["native_location"]["source_id"],
               by_id[station]["native_location"]["source_body_sha256"]) for station in ids}
    for source_id, checksum in sorted(needed):
        templates = [ref for ref in selection["sources"] if ref.get("source_sha256") == checksum]
        if len(templates) != 1:
            raise ValueError("Import the selected native point source used by the original published study: " + source_id)
        reference = copy.deepcopy(templates[0])
        if reference["source_id"] != source_id:
            candidates = sorted([(collection["id"], entry) for collection, entry in original_entries
                                 if entry["id"] == source_id and entry["body"]["sha256"] == checksum],
                                key=lambda item: item[0])
            if not candidates:
                raise ValueError("Import the original native point source ID: " + source_id)
            reference.update(collection_id=candidates[0][0], source_id=source_id)
        references.append(reference)
    selection["sources"] = references
    for reference in references:
        path, entry = workspace.source_file(reference["collection_id"], reference["source_id"])
        body = _read(path, entry["body"])
        if body[:2] == b"\x1f\x8b":
            with gzip.GzipFile(fileobj=io.BytesIO(body)) as stream:
                body = stream.read(MAX_FILE_BYTES + 1)
            if len(body) > MAX_FILE_BYTES:
                raise ValueError("The original point source exceeds its decoded bound")
        document = _json(body)
        sources[(reference["source_id"], entry["body"]["sha256"])] = (reference, document)
    for station_id in ids:
        native = by_id[station_id]["native_location"]
        item = sources.get((native["source_id"], native["source_body_sha256"]))
        if item is None:
            raise ValueError("Import this selected station's exact original point source: " + station_id)
        reference, document = item
        station_field, native_field = reference["station_id_field"], reference["native_id_field"]
        matches = []
        for index, feature in enumerate(document["features"]):
            attributes = feature.get("attributes", feature.get("properties", {}))
            native_id = attributes.get(native_field)
            if attributes.get(station_field) != station_id or str(native_id) != native["native_id"]:
                continue
            geometry = feature.get("geometry") or {}
            coordinates = [geometry.get("x"), geometry.get("y")] if "attributes" in feature else geometry.get("coordinates")
            if not _same(coordinates, native["native_coordinates"]):
                raise ValueError("The selected station's original coordinates differ: " + station_id)
            matches.append({"collection_id": reference["collection_id"], "source_id": reference["source_id"],
                            "native_feature_id": native_id, "source_feature_index": index})
        if len(matches) != 1:
            raise ValueError("The selected native point is absent or ambiguous: " + station_id)
        choices[station_id] = matches[0]
    return choices


def _inventory(body, ids, by_id):
    if _sha(body) != PUBLISHED_ASSESSMENT_SHA:
        raise ValueError("Retain the complete original 192-record assessment CSV")
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig"), newline=""))
    fields = reader.fieldnames
    required = {"id", "site", "source_id", "source_sha256", "source_vintage", "huc12"}
    if not fields or len(fields) != len(set(fields)) or not required <= set(fields):
        raise ValueError("The original published inventory lost its source fields")
    all_rows = list(reader)
    if len(all_rows) != 192 or len({row["site"] for row in all_rows}) != 159 or any(None in row for row in all_rows):
        raise ValueError("The original published assessment cohort differs")
    selected = [row for row in all_rows if row["site"] in set(ids)]
    expected = {(station, row["source_id"], row["source_vintage"], row["id"]) for station in ids for row in by_id[station]["assessment_records"]}
    observed = [(row["site"], row["source_id"], row["source_vintage"], row["id"]) for row in selected]
    if len(observed) != len(set(observed)) or set(observed) != expected:
        raise ValueError("The selected assessment records differ from the retained native context")
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(selected)
    return out.getvalue().encode("utf-8"), len(selected)


def _retain_entries(workspace, folder, references):
    """Close selected report and original inventory entries without adding study rows."""
    companions, source_refs, total = {}, [], 0
    seen = set()
    for reference in references:
        key = (reference["collection_id"], reference["source_id"])
        if key in seen:
            continue
        seen.add(key)
        unused, entry = workspace.source_file(*key)
        if reference.get("source_sha256") and entry["body"]["sha256"] != reference["source_sha256"]:
            raise ValueError("An original source edition changed before selection retention")
        token = digest({"collection_id": key[0], "source_id": key[1], "sha256": entry["body"]["sha256"]})
        prefix = "originals/" + token + "/"
        original = {k: copy.deepcopy(v) for k, v in entry.items() if k not in ("body", "companions")}
        rows = []
        for index, descriptor in enumerate([entry["body"], *entry.get("companions", [])]):
            name = prefix + _path(descriptor.get("view_path") or descriptor["filename"])
            body = _body(workspace, descriptor)
            total += len(body)
            if total > MAX_RETAINED_BYTES:
                raise ValueError("The selected source closure exceeds its supported retained size")
            row = {"path": name, "bytes": len(body), "sha256": _sha(body)}
            if name in companions and companions[name] != row:
                raise ValueError("Original source paths name conflicting bytes")
            atomic_bytes(folder / name, body, immutable=True)
            companions[name] = row
            if index == 0:
                original.update(row)
            else:
                rows.append(row)
        original["companions"] = rows
        source_refs.append({"collection_id": key[0], "source_id": key[1], "source_sha256": entry["body"]["sha256"],
                            "retained_entry": original})
    manifest = {"schema": "upstate.sources/v1", "title": "Original sources for a native coverage selection",
                "entries": [row["retained_entry"] for row in source_refs]}
    # Each entry keeps its original ID; repeated IDs across original collections
    # remain separately retained source references rather than one invalid manifest.
    if len({row["id"] for row in manifest["entries"]}) == len(manifest["entries"]):
        body = canonical(manifest) + b"\n"
        atomic_bytes(folder / "original-sources.json", body, immutable=True)
        companions["original-sources.json"] = {"path": "original-sources.json", "bytes": len(body), "sha256": _sha(body)}
    return list(companions.values()), source_refs


def prepare(workspace, selection_file, source_collection_id, source_id, title=None):
    """Prepare one source-retained selection for station_geography.build()."""
    raw = _read(selection_file)
    review = _json(raw)
    entry, context, annual, binding, report_bodies = _report(workspace, source_collection_id, source_id)
    ids, by_id = _selection(review, context, annual, binding)
    studies = [row for row in prepared_studies(workspace) if row["id"] == PUBLISHED_STUDY_ID]
    if len(studies) != 1 or not studies[0]["ready"]:
        missing = studies[0].get("missing", []) if studies else ["Original published station study is absent"]
        raise ValueError("Prepare the original published 159-site study: " + "; ".join(missing))
    selection = copy.deepcopy(studies[0]["selection"])
    choices = _point_choices(workspace, selection, ids, by_id)
    inventory_descriptor = report_bodies.get(PUBLISHED_ASSESSMENT_SHA)
    if inventory_descriptor is None:
        raise ValueError("The retained native report lacks its original 192-record inventory")
    inventory, record_count = _inventory(_body(workspace, inventory_descriptor), ids, by_id)
    chosen_title = title if title is not None else "Native coverage selection — " + str(len(ids)) + " stations"
    if not isinstance(chosen_title, str) or not chosen_title.strip() or len(chosen_title) > 240:
        raise ValueError("Use a nonempty study title up to 240 characters")
    report_ref = {"collection_id": source_collection_id, "source_id": source_id, "source_sha256": entry["body"]["sha256"]}
    operation_id = digest({"schema": SCHEMA, "selection_sha256": _sha(raw), "report": report_ref,
                           "title": chosen_title, "sources": selection["sources"], "watersheds": selection["watersheds"],
                           "inventory_sources": selection["site_tables"]})
    folder = workspace.root / "native-assessment-review" / operation_id
    with held(workspace.root / "locks" / ("native-assessment-review-" + operation_id + ".lock")):
        folder.mkdir(parents=True, exist_ok=True)
        companions, source_refs = _retain_entries(workspace, folder, [report_ref, *selection["site_tables"]])
        atomic_bytes(folder / "native-selection.json", raw, immutable=True)
        companions.append({"path": "native-selection.json", "bytes": len(raw), "sha256": _sha(raw)})
        provenance = {"schema": "upstate.native-assessment-review-preparation/v1", "operation_id": operation_id,
                      "source_report": report_ref, "native_context_sha256": CONTEXT_SHA,
                      "original_native_input_sha256": context["input_sha256"], "binding": binding,
                      "selected_station_ids": ids, "assessment_record_count": record_count,
                      "original_inventory_sha256": PUBLISHED_ASSESSMENT_SHA, "original_sources": source_refs}
        provenance_body = canonical(provenance) + b"\n"
        atomic_bytes(folder / "review-provenance.json", provenance_body, immutable=True)
        companions.append({"path": "review-provenance.json", "bytes": len(provenance_body), "sha256": _sha(provenance_body)})
        atomic_bytes(folder / "selected-assessments.csv", inventory, immutable=True)
        derived_id = "native-assessment-review-" + operation_id
        manifest = {"schema": "upstate.sources/v1", "title": chosen_title,
                    "entries": [{"id": derived_id, "title": chosen_title + " — original assessment rows",
                                 "kind": "table", "role": "STUDY_STATION_INVENTORY", "station_id_field": "site",
                                 "uri": entry["uri"], "vintage": entry["vintage"],
                                 "path": "selected-assessments.csv", "bytes": len(inventory), "sha256": _sha(inventory),
                                 "companions": companions,
                                 "metadata": {"schema": provenance["schema"], "source_report": report_ref,
                                              "native_context_sha256": CONTEXT_SHA,
                                              "selected_station_ids": ids, "assessment_record_count": record_count}}]}
        manifest_path = folder / "sources.json"
        atomic_json(manifest_path, manifest, immutable=True)
        imported = workspace.import_sources(manifest_path)
        selection.update(title=chosen_title, sites=ids, choices=choices,
                         site_tables=[{"collection_id": imported["id"], "source_id": derived_id,
                                       "source_sha256": _sha(inventory), "station_id_field": "site"}],
                         native_assessment_review={"operation_id": operation_id, "source_report": report_ref,
                                                   "binding": binding, "selected_station_ids": ids})
        atomic_json(folder / "selection.json", selection, immutable=True)
    review_binding = {"source_collection_id": source_collection_id, "source_id": source_id,
                      "source_sha256": entry["body"]["sha256"], "selection_sha256": _sha(raw),
                      "native_context_sha256": CONTEXT_SHA, "binding": binding,
                      "selected_station_ids": ids, "operation_id": operation_id,
                      "selected_inventory": {"collection_id": imported["id"], "source_id": derived_id,
                                             "source_sha256": _sha(inventory)}}
    return {"schema": "upstate.native-assessment-review-preparation/v1", "operation_id": operation_id,
            "review_binding": review_binding,
            "selection": selection, "selection_path": str(folder / "selection.json"),
            "source_collection_id": imported["id"], "source_id": derived_id,
            "source_report": report_ref, "station_count": len(ids), "assessment_record_count": record_count,
            "provenance_path": str(folder / "review-provenance.json")}

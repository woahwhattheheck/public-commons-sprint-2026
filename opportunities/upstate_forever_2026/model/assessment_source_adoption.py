"""Adopt a retained assessment report's native study into the current Workspace.

The original report source stays immutable. Existing native receiving functions
register its editable station, assessment and optional parcel editions.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import zipfile

from . import assessment_context as context, observed_context, station_geography
from .common import (atomic_json, canonical, digest, held, identifier, now,
                     read_json, verify_file)

VERSION = "1.0.0"
SCHEMA = "upstate.assessment-source-adoption/v1"
KIND = "assessment_geographic_context"


def _choice(value):
    if not isinstance(value, dict):
        raise ValueError("Select the original assessment report source")
    source_id = value.get("source_id")
    if not isinstance(source_id, str) or not source_id.strip():
        raise ValueError("Select the original assessment report source ID")
    return {"source_collection_id": identifier(value.get("source_collection_id")),
            "source_id": source_id,
            "source_body_sha256": identifier(value.get("source_body_sha256"))}


def _member(source, name):
    item = source["members"].get(name)
    if item is None:
        raise ValueError("The original assessment report omits its native member: " + name)
    return item


def _json(source, name):
    value = read_json(_member(source, name)["path"])
    if not isinstance(value, dict):
        raise ValueError("The original assessment member needs an object: " + name)
    return value


def _package(source, prefix, archive_name, expected_schema, limit):
    """Join the selected loose companions to the exact native ZIP inventory."""
    package = _json(source, prefix + "package.json")
    if package.get("schema") != expected_schema or not isinstance(package.get("files"), list):
        raise ValueError("Choose a complete original assessment package")
    declared = {}
    for item in package["files"]:
        if not isinstance(item, dict):
            raise ValueError("Native package members need their original descriptors")
        name = observed_context._relative(item.get("path")).as_posix()
        if name == "package.json" or name in declared:
            raise ValueError("The native assessment package repeats a member")
        member = _member(source, prefix + name)
        if item.get("bytes") != member["bytes"] or item.get("sha256") != member["sha256"]:
            raise ValueError("Native assessment package and selected source differ: " + name)
        declared[name] = member
    declared["package.json"] = _member(source, prefix + "package.json")
    archive_path = _member(source, prefix + archive_name)["path"]
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        if (len(names) != len(set(name.casefold() for name in names))
                or set(names) != set(declared) or len(names) > 20000
                or sum(item.file_size for item in infos) > limit):
            raise ValueError("The selected native ZIP differs from its complete package")
        for item in infos:
            expected = declared[item.filename]
            if item.file_size != expected["bytes"]:
                raise ValueError("The selected native ZIP member size differs")
            checksum = hashlib.sha256()
            with archive.open(item) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(block)
            if checksum.hexdigest() != expected["sha256"]:
                raise ValueError("The selected native ZIP member differs: " + item.filename)
    return package


def _original_rows(rows):
    if not isinstance(rows, list):
        raise ValueError("Retain the original assessment record array")
    identities = {}
    for row in rows:
        key = context._row_id(row)
        if key in identities:
            raise ValueError("The retained assessment selection repeats an original record")
        identities[key] = {"station_id": row["station_id"], "original": row["original"]}
    return identities


def _source_reference(value):
    value = copy.deepcopy(value)
    if not isinstance(value, dict):
        raise ValueError("Retain the original polygon source reference")
    value.pop("collection_id", None)
    return value


def _context_identity(result, geometry, package):
    """Compare original records and polygons independently of Workspace IDs."""
    if result.get("schema") != context.SCHEMA:
        raise ValueError("Choose a saved assessment geographic context")
    selection = result["selection"]
    polygons = []
    if geometry.get("type") != "FeatureCollection":
        raise ValueError("Retain the saved assessment context geometry")
    for feature in geometry.get("features", []):
        properties = feature["properties"]
        reference = json.loads(properties["original_polygon_reference_json"])
        polygons.append({"source": _source_reference(reference),
                         "geometry": feature["geometry"]})
    if not polygons:
        raise ValueError("The saved assessment context has no retained polygons")
    return {"records": _original_rows(result["rows"]),
            "relationship_basis": result["relationship_basis"],
            "watershed_source_id": selection["watershed_source"]["source_id"],
            "watershed_source_sha256": identifier(package["watershed_source_sha256"]),
            "polygons": sorted(polygons, key=lambda value: canonical(value))}


def _selected_source(workspace, value, limit):
    choice = _choice(value)
    source = observed_context._source(workspace, {"source_roles": {
        observed_context.ROLE: {key: choice[key] for key in ("source_collection_id", "source_id")}}})
    if source["binding"]["body_sha256"] != choice["source_body_sha256"]:
        raise ValueError("The selected assessment report body changed; reopen its source")
    recipe, entry = source["recipe"], source["entry"]
    metadata = entry.get("metadata") or {}
    if (recipe.get("report_context_kind") != KIND
            or not isinstance(metadata, dict)
            or metadata.get("report_context_kind") != KIND):
        raise ValueError("Choose an original assessment geographic report source")
    if metadata.get("report_schema") not in (None, observed_context.SCHEMA):
        raise ValueError("The assessment report source uses another report schema")
    if not isinstance(recipe.get("project_id"), str) or not recipe["project_id"]:
        raise ValueError("Retain the assessment report\'s original project identity")
    context_id = identifier(recipe.get("context_id"))
    parcel_id = identifier(recipe["parcel_id"]) if recipe.get("parcel_id") else None
    if metadata.get("context_id") != context_id or metadata.get("parcel_id") != parcel_id:
        raise ValueError("The assessment report's original context identities differ")
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list):
        raise ValueError("Retain the complete assessment report input inventory")
    names = []
    for item in inputs:
        if not isinstance(item, dict):
            raise ValueError("Retain each assessment report input descriptor")
        names.append(observed_context._relative(item.get("path")).as_posix())
    if len(names) != len(set(names)):
        raise ValueError("The assessment report repeats an input member")
    body_name = observed_context._relative(
        entry["body"].get("view_path", entry["body"]["filename"])).as_posix()
    if set(names) != set(source["members"]) - {body_name}:
        raise ValueError("The assessment report and its complete companions differ")
    package = _package(source, "context/", "assessment-context.zip", context.PACKAGE, limit)
    result = _json(source, "context/context.json")
    geometry = _json(source, "context/context.geojson")
    selection = _json(source, "context/selection.json")
    if (selection != recipe.get("original_selection") or selection != result.get("selection")
            or selection != package.get("selection")
            or result.get("summary") != recipe.get("summary")
            or result.get("assessment_groups") != recipe.get("assessment_groups")):
        raise ValueError("The report differs from its original saved assessment selection")
    geography_id = identifier(selection.get("station_geography_id"))
    if result.get("original_geography_id") != geography_id:
        raise ValueError("The report's original station study identity differs")
    identity = _context_identity(result, geometry, package)
    parcel_package = parcel_result = None
    if parcel_id:
        parcel_package = _package(source, "parcels/", "parcel-context.zip",
                                  "upstate.assessment-parcel-context-package/v1", limit)
        parcel_result = _json(source, "parcels/parcel-context.json")
        provenance = recipe.get("parcel_received_from") or {}
        if not isinstance(provenance, dict):
            raise ValueError("Retain the original parcel receiving provenance")
        original_context_id = identifier(provenance.get("original_context_id", context_id))
        if (parcel_result.get("schema") != "upstate.assessment-parcel-context/v1"
                or parcel_package.get("context_id") != original_context_id
                or parcel_result.get("context_id") != original_context_id
                or parcel_package.get("study_id") != parcel_result.get("study_id")
                or _original_rows(parcel_result.get("assessment_rows")) != identity["records"]):
            raise ValueError("The parcel package belongs to another original assessment selection")
    elif any(name.startswith("parcels/") for name in names):
        raise ValueError("The report has parcel companions without its original parcel identity")
    return {"choice": choice, "source": source, "recipe": recipe, "result": result,
            "package": package, "identity": identity, "context_id": context_id,
            "station_geography_id": geography_id, "parcel_id": parcel_id,
            "parcel_package": parcel_package, "parcel_result": parcel_result}


def _native_context(workspace, key):
    edition = context.inspect(workspace, key, verify=True, include_result=True)
    package_item = next(item for item in edition["files"] if Path(item["path"]).name == "package.json")
    package = read_json(verify_file(workspace.root, package_item))
    return edition, _context_identity(edition["result"], edition["geojson"], package)


def _edition_member(edition, name):
    found = [item for item in edition["files"] if Path(item["path"]).name == name]
    if len(found) != 1:
        raise ValueError("The saved native edition needs its original member: " + name)
    return found[0]


def _matching_member(edition, name, expected):
    item = _edition_member(edition, name)
    if item["bytes"] != expected["bytes"] or item["sha256"] != expected["sha256"]:
        raise ValueError("The saved native edition differs from the selected report: " + name)


def _local(workspace, selected):
    context_id, parcel_id = selected["context_id"], selected["parcel_id"]
    if not (workspace.root / context.KIND / (context_id + ".json")).is_file():
        return None
    if not (workspace.root / station_geography.KIND / (selected["station_geography_id"] + ".json")).is_file():
        return None
    if parcel_id and not (workspace.root / context.PARCEL_KIND / (parcel_id + ".json")).is_file():
        return None
    edition, identity = _native_context(workspace, context_id)
    if identity != selected["identity"]:
        raise ValueError("The retained original context differs from this report")
    _matching_member(edition, "assessment-context.zip",
                     _member(selected["source"], "context/assessment-context.zip"))
    if edition["selection"]["station_geography_id"] != selected["station_geography_id"]:
        raise ValueError("The retained original context has another station study")
    parcel = None
    if parcel_id:
        parcel = context.inspect_parcels(workspace, parcel_id, verify=True, include_result=True)
        if parcel["context_id"] != context_id:
            raise ValueError("The retained original parcel edition has another context")
        _matching_member(parcel, "parcel-context.zip",
                         _member(selected["source"], "parcels/parcel-context.zip"))
    return edition, parcel


def _result(workspace, selected, edition, parcel, *, mode):
    geography_id = identifier(edition["selection"]["station_geography_id"])
    station_geography.inspect(workspace, geography_id, verify=True)
    parcel_id = parcel["id"] if parcel else None
    original = {"project_id": selected["recipe"].get("project_id"),
                "station_geography_id": selected["station_geography_id"],
                "context_id": selected["context_id"], "parcel_id": selected["parcel_id"]}
    received = {"project_id": workspace.project["id"],
                "station_geography_id": geography_id,
                "context_id": edition["id"], "parcel_id": parcel_id}
    return {"schema": SCHEMA, "version": VERSION, "source": selected["choice"],
            "source_binding": selected["source"]["binding"],
            "id": edition["id"], "title": edition["title"], "summary": edition["summary"],
            "station_geography_id": geography_id, "context_id": edition["id"],
            "parcel_id": parcel_id, "mode": mode,
            "mapping": {"original": original, "received": received,
                        "package_context_id": selected["parcel_package"]["context_id"]
                            if selected["parcel_package"] else selected["context_id"]},
            "archives": {"context": {key: _member(selected["source"],
                "context/assessment-context.zip")[key] for key in ("bytes", "sha256")},
                "parcels": {key: _member(selected["source"],
                    "parcels/parcel-context.zip")[key] for key in ("bytes", "sha256")} if parcel else None}}


def adopt_source(workspace, value, *, max_extracted_bytes=2 * 1024 ** 3):
    """Receive one exact retained report selection through native model APIs."""
    if not isinstance(max_extracted_bytes, int) or max_extracted_bytes <= 0:
        raise ValueError("Choose a positive native extraction limit")
    selected = _selected_source(workspace, value, max_extracted_bytes)
    operation_id = digest({"version": VERSION, "source": selected["choice"]})
    directory = workspace.root / "assessment-source-adoptions"
    with held(workspace.root / "locks" / ("assessment-source-adoption-" + operation_id + ".lock")):
        receipt_path = directory / (operation_id + ".json")
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if (receipt.get("source") != selected["choice"]
                    or receipt.get("source_binding") != selected["source"]["binding"]):
                raise ValueError("The saved adoption differs from its original report source")
            edition, identity = _native_context(workspace, identifier(receipt["context_id"]))
            if identity != selected["identity"]:
                raise ValueError("The adopted context's original assessment selection changed")
            parcel = None
            if bool(receipt.get("parcel_id")) != bool(selected["parcel_id"]):
                raise ValueError("The adoption changed its original parcel selection")
            if receipt.get("parcel_id"):
                parcel = context.inspect_parcels(workspace, identifier(receipt["parcel_id"]), verify=True)
                if parcel["context_id"] != edition["id"]:
                    raise ValueError("The adopted parcel/context link changed")
                for name in ("parcel-context.zip", "parcel-context.json"):
                    _matching_member(parcel, name, _member(selected["source"], "parcels/" + name))
            mode = receipt.get("mode")
            if mode not in ("reopened_original", "native_receive"):
                raise ValueError("The saved adoption needs its original receiving mode")
            current = _result(workspace, selected, edition, parcel, mode=mode)
            current.update(operation_id=operation_id, adopted_at=receipt.get("adopted_at"))
            if current != receipt:
                raise ValueError("The saved adoption mapping differs from its exact native editions")
            return receipt
        local = _local(workspace, selected)
        if local is not None:
            edition, parcel = local
            mode = "reopened_original"
        elif selected["parcel_id"]:
            parcel = context.receive_parcels(workspace,
                _member(selected["source"], "parcels/parcel-context.zip")["path"],
                max_extracted_bytes=max_extracted_bytes)
            edition, identity = _native_context(workspace, parcel["context_id"])
            if identity != selected["identity"]:
                raise ValueError("The received parcel package reopens a different assessment selection")
            _matching_member(parcel, "parcel-context.json",
                             _member(selected["source"], "parcels/parcel-context.json"))
            mode = "native_receive"
        else:
            received = context.receive(workspace,
                _member(selected["source"], "context/assessment-context.zip")["path"],
                max_extracted_bytes=max_extracted_bytes)
            edition, identity = _native_context(workspace, received["id"])
            if identity != selected["identity"]:
                raise ValueError("The received context differs from its selected original records and geometry")
            parcel, mode = None, "native_receive"
        result = _result(workspace, selected, edition, parcel, mode=mode)
        result.update(operation_id=operation_id, adopted_at=now())
        atomic_json(receipt_path, result, immutable=True)
        return result

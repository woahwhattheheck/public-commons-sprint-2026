"""Original source-edition intake and complete native companion export.

Native Workspace.source_file(collection_id, source_id) owns file custody. GIS
normalization creates a planning view, never a substitute original source.
"""
from __future__ import annotations
import inspect
import json
from pathlib import Path, PurePosixPath
from .monitoring_common import ContractError, canonical_bytes, file_sha256, load_json


def source_record(workspace, source_id, collection_id=None):
    parameters = inspect.signature(workspace.source_file).parameters
    if len(parameters) >= 2:
        if not collection_id:
            raise ContractError("Select the retained source edition ID as well as its named source entry")
        path, entry = workspace.source_file(collection_id, source_id)
        collection = workspace._get("sources", collection_id)
        return Path(path), entry, collection
    if collection_id:
        raise ContractError("This older Workspace uses a single source record ID, not an edition/entry pair")
    record = workspace._get("sources", source_id)
    return Path(workspace.source_file(source_id)), record, record


def vector_view(path, *, layer=None):
    """Read complete native vector features in WGS84, preserving attributes/IDs."""
    from pyproj import CRS, Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import transform
    import fiona
    # Fiona/GDAL retains ESRI multipart/hole semantics and recognizes GeoPackage,
    # Shapefile, GeoJSON and retained gzip ESRI JSON from the original source.
    native = "/vsigzip/" + str(path.resolve()) if path.suffix.lower() == ".gz" else str(path)
    kwargs = {"layer": layer} if layer is not None else {}
    with fiona.open(native, **kwargs) as original:
        if not original.crs_wkt and not original.crs:
            raise ContractError("The retained geometry needs its declared coordinate reference system")
        source_crs = CRS.from_user_input(original.crs_wkt or original.crs)
        target = CRS.from_epsg(4326)
        project = Transformer.from_crs(source_crs, target, always_xy=True)
        features = []
        for feature in original:
            if feature.geometry is None:
                raise ContractError(f"Native feature {feature.id} has no geometry")
            geometry = shape(feature.geometry)
            if source_crs != target: geometry = transform(project.transform, geometry)
            features.append({"type": "Feature", "id": str(feature.id),
                             "properties": dict(feature.properties), "geometry": mapping(geometry)})
        metadata = {"native_driver": original.driver, "native_layer": original.name,
                    "native_crs": source_crs.to_wkt(), "planning_crs": "EPSG:4326",
                    "feature_count": len(features), "native_fields": dict(original.schema["properties"])}
    # JSON round-trip makes tuples/encoder-only objects explicit before storage.
    return json.loads(canonical_bytes({"type": "FeatureCollection", "features": features})), metadata


def read_source(workspace, source_id, *, collection_id=None, layer=None):
    path, entry, collection = source_record(workspace, source_id, collection_id)
    actual = file_sha256(path)
    expected = entry.get("body", {}).get("sha256") or entry.get("sha256") or entry.get("object_sha256")
    if expected and actual != expected:
        raise ContractError(f"source {source_id}: retained object hash mismatch")
    if collection_id:
        if entry.get("kind") != "vector": raise ContractError("Monitoring geometry requires a retained vector source")
        value, native = vector_view(path, layer=layer or entry.get("layer"))
    else:
        value, native = load_json(path), {"planning_crs": "EPSG:4326", "native_driver": "legacy GeoJSON"}
    binding = {"source_id": source_id, "source_collection_id": collection_id,
               "source_record_id": collection["id"], "title": entry.get("title", ""),
               "filename": path.name, "object_sha256": actual, "bytes": path.stat().st_size,
               "layer": layer or entry.get("layer"), **native}
    return value, binding


def verify_binding(workspace, binding):
    path, _, _ = source_record(workspace, binding["source_id"], binding.get("source_collection_id"))
    if path.stat().st_size != binding["bytes"] or file_sha256(path) != binding["object_sha256"]:
        raise ContractError("Retained source differs from the monitoring network's selected source edition")
    return path



def verify_retained_binding(workspace, binding):
    """Verify original source objects without materializing a native source view."""
    collection_id = binding.get("source_collection_id")
    if not collection_id:
        return verify_binding(workspace, binding)
    from .common import relative_file
    collection = workspace._get("sources", collection_id)
    if collection["id"] != binding["source_record_id"]:
        raise ContractError("Monitoring binding names a different retained source edition")
    entries = [entry for entry in collection["entries"] if entry["id"] == binding["source_id"]]
    if len(entries) != 1:
        raise ContractError("Monitoring source entry is absent or ambiguous")
    entry = entries[0]
    if (entry.get("kind") != "vector" or entry["body"]["bytes"] != binding["bytes"]
            or entry["body"]["sha256"] != binding["object_sha256"]):
        raise ContractError("Monitoring binding differs from its retained vector source")
    original = None
    for body in [entry["body"], *entry.get("companions", []), collection["original_manifest"]]:
        path = relative_file(workspace.root, body["object"])
        if path.stat().st_size != body["bytes"] or file_sha256(path) != body["sha256"]:
            raise ContractError("Original monitoring source or companion changed")
        if original is None:
            original = path
    return original

def source_export_members(workspace, label, binding):
    """Describe exact retained members without loading original native files.

    The existing bytes-dictionary export remains available below. Packet writers
    can stream these verified source paths and keep canonical metadata in memory.
    """
    from .monitoring_packet import bytes_member, file_member
    path, entry, collection = source_record(
        workspace, binding["source_id"], binding.get("source_collection_id"))
    verify_binding(workspace, binding)
    if not binding.get("source_collection_id"):
        yield f"sources/{label}.json", file_member(
            path, binding["bytes"], binding["object_sha256"])
        yield f"sources/{label}-native-record.json", bytes_member(canonical_bytes(collection))
        return
    yield f"sources/{label}-source-edition.json", bytes_member(canonical_bytes(collection))
    for body in [entry["body"], *entry.get("companions", [])]:
        name = body.get("view_path", body["filename"])
        member = PurePosixPath(name)
        if (member.is_absolute() or ".." in member.parts or not member.parts
                or str(member) != name or "\\" in name or "\0" in name):
            raise ContractError("Native source companion has a nonportable name")
        original = (workspace.root / body["object"]).resolve(strict=True)
        if not original.is_relative_to(workspace.root.resolve()) or not original.is_file():
            raise ContractError("Native source companion must remain in the original object store")
        if original.stat().st_size != body["bytes"] or file_sha256(original) != body["sha256"]:
            raise ContractError("Original source companion changed during export")
        yield f"sources/{label}/{member}", file_member(original, body["bytes"], body["sha256"])


def export_source(workspace, label, binding):
    path, entry, collection = source_record(workspace, binding["source_id"], binding.get("source_collection_id"))
    verify_binding(workspace, binding)
    if not binding.get("source_collection_id"):
        return {f"sources/{label}.json": path.read_bytes(),
                f"sources/{label}-native-record.json": canonical_bytes(collection)}
    files = {f"sources/{label}-source-edition.json": canonical_bytes(collection)}
    for body in [entry["body"], *entry.get("companions", [])]:
        name = body.get("view_path", body["filename"])
        member = PurePosixPath(name)
        if (member.is_absolute() or ".." in member.parts or not member.parts
                or str(member) != name or "\\" in name or "\0" in name):
            raise ContractError("Native source companion has a nonportable name")
        original = (workspace.root / body["object"]).resolve(strict=True)
        if not original.is_relative_to(workspace.root.resolve()) or not original.is_file():
            raise ContractError("Native source companion must remain in the original object store")
        if original.stat().st_size != body["bytes"] or file_sha256(original) != body["sha256"]:
            raise ContractError("Original source companion changed during export")
        files[f"sources/{label}/{member}"] = original.read_bytes()
    return files

"""FGDC metadata and exact lineage for created editable vector datasets.

Copyright 2026 TokenJunkieLabs. Original source declarations remain unchanged.
No geometry, attributes, numerical model values or contact details are inferred.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import uuid
import xml.etree.ElementTree as ET

try:
    from . import fgdc_metadata as fgdc
except ImportError:
    import fgdc_metadata as fgdc

SCHEMA = "upstate.gis-vector-metadata/v1"
VERSION = "1.0.0"
CHUNK = 1024 * 1024


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _digest(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _filesystem():
    if __package__:
        from . import portable_fs
    else:
        import importlib
        import sys
        parent = str(Path(__file__).resolve().parent.parent)
        if parent not in sys.path:
            sys.path.insert(0, parent)
        portable_fs = importlib.import_module("model.portable_fs")
    return portable_fs


def _path(root, name):
    fs = _filesystem()
    fs.relative_name(name, windows=True)
    root = fs.native_path(Path(root).resolve(strict=True))
    path = root / PurePosixPath(name)
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError("Vector metadata member leaves its retained project")
    return path


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _record(root, path):
    fs = _filesystem()
    root = fs.native_path(Path(root).resolve(strict=True))
    path = fs.native_path(path)
    digest, size = hashlib.sha256(), 0
    descriptor = fs.open_file(path, os.O_RDONLY)
    with os.fdopen(descriptor, "rb") as stream:
        before = fs.fd_stat(stream.fileno())
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            digest.update(chunk)
            size += len(chunk)
        after = fs.fd_stat(stream.fileno())
    if size != before.st_size or _identity(before) != _identity(after):
        raise ValueError("Vector metadata member changed while reading: " + str(path))
    return {"path": path.relative_to(root).as_posix(),
            "bytes": size, "sha256": digest.hexdigest()}


def _checked(root, row):
    path = _path(root, row["path"])
    if not re.fullmatch(r"[0-9a-f]{64}", row.get("sha256", "")):
        raise ValueError("Vector metadata member lacks its exact SHA-256")
    if _record(root, path) != {key: row[key] for key in ("path", "bytes", "sha256")}:
        raise ValueError("Retained vector metadata member changed: " + row["path"])
    return path


def _write_once(root, name, body):
    """Publish a complete immutable edition; never write into its final name."""
    fs = _filesystem()
    target = _path(root, name)
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = {"path": name, "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest()}
    pending = target.with_name(".gis-metadata-" + uuid.uuid4().hex)
    try:
        descriptor = fs.open_file(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        with os.fdopen(descriptor, "wb") as out:
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        # Close the writable handle before Windows publication. The shared
        # publisher supplies verified-copy fallback where hard links fail.
        try:
            fs.publish_file(pending, target)
        except FileExistsError:
            if _record(root, target) != expected:
                raise ValueError("An immutable vector metadata edition changed: " + name)
        fs.sync_directory(target.parent)
        result = _record(root, target)
        if result != expected:
            raise ValueError("An immutable vector metadata edition changed: " + name)
        return result
    finally:
        pending.unlink(missing_ok=True)


def _declared_fields(layer):
    source = layer.get("source") or {}
    original = source.get("source_metadata") or source
    metadata = original.get("metadata") if isinstance(original, dict) else {}
    metadata = metadata if isinstance(metadata, dict) else {}
    value = (layer.get("field_metadata") or
             (original.get("field_metadata") if isinstance(original, dict) else None) or
             metadata.get("field_metadata") or {})
    if not isinstance(value, dict):
        raise ValueError("Original vector field metadata must be an object")
    return deepcopy(value)


def _binding(root, manifest, layer, *, dataset=None):
    data = deepcopy(layer["data"])
    if data.get("kind") != "vector":
        raise ValueError("Choose the actual created vector layer")
    contact = deepcopy((manifest.get("source_request") or {}).get("metadata_contact", {}))
    fgdc.validate_contact(contact)
    original = [deepcopy(row) for row in layer["originals"]]
    for row in original:
        _checked(root, row)
    actual = dataset or _record(root, _path(root, layer["working_path"]))
    return {"selection_id": manifest["selection_id"],
            "project_title": manifest["title"],
            "layer": {key: deepcopy(layer[key]) for key in
                      ("id", "key", "title", "purpose", "metric", "run_id",
                       "scenario_id", "profile_id") if key in layer},
            "dataset": {**actual, "layer": data["layer"]},
            "data": data, "originals": original,
            "source": deepcopy(layer.get("source", {})),
            "source_selection": {"where": deepcopy(data.get("where", {}))},
            "field_metadata": _declared_fields(layer),
            "metadata_contact": contact,
            "distribution": deepcopy((manifest.get("source_request") or {}).get("distribution", {}))}


def _geographic(data):
    from pyproj import CRS, Transformer
    crs = CRS.from_user_input(data["crs_wkt"])
    bounds = [float(value) for value in data["bounds"]]
    west, south, east, north = Transformer.from_crs(
        crs, "EPSG:4326", always_xy=True).transform_bounds(*bounds, densify_pts=21)
    if not all(math.isfinite(x) for x in (west, south, east, north)):
        raise ValueError("Created vector bounds cannot be represented in geographic metadata")
    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= north <= 90):
        raise ValueError("Created vector geographic metadata bounds are outside their declared CRS")
    return {"west": west, "south": south, "east": east, "north": north,
            "method": "Pyproj transform_bounds of actual native vector bounds, always_xy, 21 densification points.",
            "axis_units": [axis.unit_name for axis in crs.axis_info],
            "geographic": crs.is_geographic,
            "projected": crs.is_projected}


def _child(parent, name, value):
    node = ET.SubElement(parent, name)
    node.text = str(value)
    return node


def _json(value):
    return _canonical(value).decode("utf-8")


def _source_rows(document):
    primary = deepcopy(document["source"])
    primary["id"] = fgdc.text(primary.get("id")) or document["layer"]["id"]
    primary["title"] = fgdc.text(primary.get("title")) or document["layer"]["title"]
    primary["sha256"] = document["originals"][0]["sha256"]
    primary["kind"] = "vector"
    primary["derivation"] = primary.get("derivation") or "Original retained input for the editable vector copy."
    return [primary]


def _field_definition(document, name, dtype):
    data = document["data"]
    original = next((key for key, value in data.get("source_field_map", {}).items()
                     if value == name), None)
    declared = document["field_metadata"].get(original or name)
    declared = declared if isinstance(declared, dict) else (
        {"definition": declared} if isinstance(declared, str) else {})
    if name == data.get("source_identity_field"):
        definition = ("Native original row identifier captured when the selected source features were copied. "
                      "It is an identity string, not a measured quantity.")
        authority = "The retained GIS builder's original row identity mapping."
    elif original is not None:
        definition = fgdc.text(declared.get("definition")) or (
            "Original source field " + original + " retained as " + name +
            ". Its scientific definition was not supplied in the original field metadata.")
        authority = fgdc.text(declared.get("definition_source")) or (
            "Original retained source declarations; see the source citation and field mapping.")
    else:
        definition = fgdc.text(declared.get("definition")) or (
            "Field present in this working vector edition. Its original definition was not supplied; "
            "it may be a recipient-added or renamed field.")
        authority = fgdc.text(declared.get("definition_source")) or "Unknown"
    domain = ("Native attribute type: " + str(dtype) + ". " +
              (("Declared units: " + str(declared["units"]) + ". ") if declared.get("units") is not None else "") +
              ("Declared domain: " + _json(declared["domain"]) + ". " if "domain" in declared else
               "No allowable-value domain was supplied; actual values remain in the GeoPackage."))
    return definition, authority, domain


def render_xml(document):
    """Return one self-contained CSDGM record without external entities."""
    data, layer, geo = document["data"], document["layer"], document["geographic_bounds"]
    contact, date = document["metadata_contact"], document["metadata_date"]
    metadata = ET.Element("metadata")
    ident = ET.SubElement(metadata, "idinfo")
    cite = ET.SubElement(ET.SubElement(ident, "citation"), "citeinfo")
    _child(cite, "origin", "Unknown")
    _child(cite, "pubdate", "Unpublished material")
    _child(cite, "title", layer["title"] + " — editable vector dataset")
    _child(cite, "edition", document["id"])
    _child(cite, "geoform", "vector digital data")
    _child(cite, "othercit", "Created working dataset SHA256 " + document["dataset"]["sha256"] +
           "; the creator of this working data edition was not explicitly declared. "
           "The metadata contact is not assumed to be its originator. Original source authors remain separately identified in lineage.")
    dataset_link = "../../" + document["dataset"]["path"]
    _child(cite, "onlink", dataset_link)
    description = ET.SubElement(ident, "descript")
    _child(description, "abstract", "An editable copy of the explicitly selected retained vector data. " +
           str(data["feature_count"]) + " features; " + str(data["null_geometries"]) +
           " null geometries. Original CRS and native source attributes are retained; "
           "row identities and any original field renaming are recorded. Recipient edits, when present, "
           "belong only to this working edition.")
    _child(description, "purpose", layer.get("purpose") or
           "Retain an editable, independently receivable GIS layer for the selected study.")
    _child(description, "supplinf", _json({
        "dataset": document["dataset"], "native_crs": data["crs"], "native_crs_wkt": data["crs_wkt"],
        "native_bounds": data["bounds"], "axis_units": geo["axis_units"],
        "coordinate_resolution": "Unknown; not supplied by the retained vector source. No raster cell size or positional accuracy is assumed.",
        "units": data["units"], "geometry_types": data["geometry_types"],
        "source_selection": document["source_selection"],
        "source_field_map": data.get("source_field_map", {}),
        "source_identity_field": data.get("source_identity_field"),
        "source_identity_present": data.get("source_identity_field") in data["fields"],
        "original_files": document["originals"],
        "provenance_json": document["id"] + ".json"}))
    time = ET.SubElement(ident, "timeperd")
    _child(ET.SubElement(ET.SubElement(time, "timeinfo"), "sngdate"), "caldate", "Unknown")
    _child(time, "current", "Working-copy creation or sealing does not establish the source's observation date; original source periods are in lineage.")
    status = ET.SubElement(ident, "status")
    _child(status, "progress", "Complete")
    _child(status, "update", "As needed")
    bounding = ET.SubElement(ET.SubElement(ident, "spdom"), "bounding")
    for tag, key in (("westbc", "west"), ("eastbc", "east"), ("northbc", "north"), ("southbc", "south")):
        _child(bounding, tag, geo[key])
    theme = ET.SubElement(ET.SubElement(ident, "keywords"), "theme")
    _child(theme, "themekt", "None")
    _child(theme, "themekey", "editable vector GIS")
    _child(theme, "themekey", str(layer.get("purpose") or "study context"))
    _child(ident, "accconst", "Original source access conditions remain applicable; no additional permission is asserted by this metadata.")
    _child(ident, "useconst", "Read original source declarations and retained field definitions before use. "
           "Unknown accuracy, dates, units or restrictions are not replaced by assumed values.")
    fgdc.contact_information(ET.SubElement(ident, "ptcontac"), contact)
    _child(ident, "native", "GeoPackage / " + str(data["layer"]) + "; native CRS " + data["crs"])
    quality = ET.SubElement(metadata, "dataqual")
    _child(ET.SubElement(quality, "attracc"), "attraccr",
           "No independent attribute-accuracy assessment was supplied. Source values are copied without numerical conversion; "
           "the working file and field schema are bound by exact recorded identities.")
    _child(quality, "logic", "The retained source selection, original descriptors, field map, geometry types and "
           "working file bytes are recorded. This metadata does not assert an unperformed geometry/topology validation.")
    _child(quality, "complete", "All selected source rows were retained at creation. The current working edition contains " +
           str(data["feature_count"]) + " features, including " + str(data["null_geometries"]) +
           " null geometries. Where selection: " + _json(document["source_selection"]["where"]) +
           ". Recipient changes and original selection remain separately recorded.")
    _child(ET.SubElement(ET.SubElement(quality, "posacc"), "horizpa"), "horizpar",
           "Unknown. No positional-accuracy assessment was supplied or inferred from coordinate precision.")
    lineage = ET.SubElement(quality, "lineage")
    for source in _source_rows(document):
        fgdc.source_information(lineage, source)
    step = ET.SubElement(lineage, "procstep")
    _child(step, "procdesc", document["process"]["description"] +
           " Original field mapping: " + _json(data.get("source_field_map", {})) +
           ". All retained primary and companion identities: " + _json(document["originals"]) +
           ((" Recipient reason: " + document["process"]["reason"]) if document["process"].get("reason") else ""))
    for source in _source_rows(document):
        _child(step, "srcused", source["id"])
    _child(step, "procdate", date)
    _child(step, "srcprod", document["dataset"]["sha256"])
    spatial = ET.SubElement(metadata, "spdoinfo")
    _child(spatial, "direct", "Vector")
    # Coordinate resolution is absent. The optional precision-requiring spref
    # production is omitted; exact WKT, units and bounds remain in supplinf/JSON.
    entity = ET.SubElement(ET.SubElement(metadata, "eainfo"), "detailed")
    kind = ET.SubElement(entity, "enttyp")
    _child(kind, "enttypl", data["layer"])
    _child(kind, "enttypd", "GeoPackage feature table with " + str(data["feature_count"]) +
           " retained working features and geometry types " + ", ".join(data["geometry_types"]) + ".")
    _child(kind, "enttypds", "Actual inspected GeoPackage schema, bound to SHA256 " + document["dataset"]["sha256"])
    for name, dtype in sorted(data["fields"].items()):
        definition, authority, domain = _field_definition(document, name, dtype)
        attr = ET.SubElement(entity, "attr")
        _child(attr, "attrlabl", name)
        _child(attr, "attrdef", definition)
        _child(attr, "attrdefs", authority)
        _child(ET.SubElement(attr, "attrdomv"), "udom", domain)
    distribution = ET.SubElement(metadata, "distinfo")
    fgdc.contact_information(ET.SubElement(distribution, "distrib"), contact)
    _child(distribution, "resdesc", layer["title"])
    _child(distribution, "distliab", "Original source use conditions apply. The complete retained project and original files accompany this working dataset.")
    order = ET.SubElement(distribution, "stdorder")
    form = ET.SubElement(order, "digform")
    info = ET.SubElement(form, "digtinfo")
    _child(info, "formname", "GeoPackage")
    _child(info, "formcont", "One editable vector feature table; native coordinates and attribute values remain in the dataset.")
    _child(info, "transize", document["dataset"]["bytes"] / 1000000)
    online = ET.SubElement(ET.SubElement(form, "digtopt"), "onlinopt")
    _child(ET.SubElement(ET.SubElement(online, "computer"), "networka"), "networkr", dataset_link)
    _child(online, "accinstr", "Extract the complete GIS archive without changing its relative directory structure.")
    _child(order, "fees", fgdc.text(document.get("distribution", {}).get("fees")) or "Unknown")
    reference = ET.SubElement(metadata, "metainfo")
    _child(reference, "metd", date)
    fgdc.contact_information(ET.SubElement(reference, "metc"), contact)
    _child(reference, "metstdn", "FGDC Content Standard for Digital Geospatial Metadata")
    _child(reference, "metstdv", "FGDC-STD-001-1998")
    return ET.tostring(metadata, encoding="utf-8", xml_declaration=True)


def write_metadata(root, manifest, layer, *, reason=None):
    """Create immutable per-dataset metadata; prior metadata files remain."""
    root = Path(root).resolve(strict=True)
    if reason is not None and (not isinstance(reason, str) or not reason.strip()):
        raise ValueError("Describe the actual recipient edit")
    binding = _binding(root, manifest, layer)
    document = {"schema": SCHEMA, "version": VERSION, **binding,
                "geographic_bounds": _geographic(binding["data"]),
                "metadata_date": datetime.now(timezone.utc).strftime("%Y%m%d"),
                "process": {"description": (
                    "Inspected the retained working GeoPackage after the recipient's saved edit; original source files were not changed."
                    if reason else "Copied every explicitly selected source feature to an independent GeoPackage, preserving native CRS, values and original row identity."),
                    "reason": reason.strip() if reason else None}}
    document["id"] = _digest(document)
    stem = "metadata/vectors/" + document["id"]
    xml = _write_once(root, stem + ".xml", render_xml(document))
    provenance = _write_once(root, stem + ".json", _canonical(document) + b"\n")
    return {"schema": SCHEMA, "version": VERSION, "id": document["id"],
            "xml": xml, "json": provenance}


def verify_metadata(root, manifest, layer, *, check_dataset=True):
    """Verify exact metadata and binding; seal may permit edited dataset bytes."""
    descriptor = layer.get("vector_metadata")
    if not isinstance(descriptor, dict) or descriptor.get("schema") != SCHEMA or descriptor.get("version") != VERSION:
        raise ValueError("The created vector layer needs its retained metadata edition")
    ident = descriptor.get("id", "")
    if not re.fullmatch(r"[0-9a-f]{64}", ident):
        raise ValueError("The vector metadata identity is invalid")
    stem = "metadata/vectors/" + ident
    if descriptor["xml"]["path"] != stem + ".xml" or descriptor["json"]["path"] != stem + ".json":
        raise ValueError("Vector metadata paths no longer match their immutable edition")
    xml = _checked(root, descriptor["xml"]).read_bytes()
    document = json.loads(_checked(root, descriptor["json"]).read_text(encoding="utf-8"))
    if document.get("schema") != SCHEMA or document.get("version") != VERSION or document.get("id") != ident:
        raise ValueError("The vector metadata document identifies another edition")
    if _digest({key: value for key, value in document.items() if key != "id"}) != ident:
        raise ValueError("The vector metadata provenance identity changed")
    expected = _binding(root, manifest, layer,
                        dataset=None if check_dataset else document["dataset"])
    for key, value in expected.items():
        if document.get(key) != value:
            raise ValueError("Vector metadata differs from its working dataset or original source: " + key)
    if xml != render_xml(document):
        raise ValueError("FGDC XML differs from its exact retained vector provenance")
    return document

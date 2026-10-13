#!/usr/bin/env python3
"""Receive created-vector metadata using an existing complete editable GIS project.

No model is executed and no retained input is edited. An explicitly requested
annotation exercise affects only the newly built receiving copy.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib
import io
import json
from pathlib import Path
import platform
import sqlite3
import sys
import time

# Source-only receiving must not add __pycache__ to a retained application/project.
sys.dont_write_bytecode = True

SCHEMA_PINS = [
  {
    "name": "fgdc-std-001-1998.xsd",
    "bytes": 4752,
    "sha256": "222e77b9be8796539816f7a818edae01e55ab5657c5599005732c40be6b9e57b"
  },
  {
    "name": "fgdc-std-001-1998-sect01.xsd",
    "bytes": 9878,
    "sha256": "8b7e31c62de8415a7c657883187f6a73b7167960eaa24d108335d00226ad4454"
  },
  {
    "name": "fgdc-std-001-1998-sect02.xsd",
    "bytes": 7751,
    "sha256": "64e83b7ffc1f424b879ba7a7eb803746b14c44ca663a6f367b3893bbcea11d0e"
  },
  {
    "name": "fgdc-std-001-1998-sect03.xsd",
    "bytes": 5135,
    "sha256": "4826e84227807af5f71572591fd5613b0ae880bdf1f87e793b2072a2c0abd4d1"
  },
  {
    "name": "fgdc-std-001-1998-sect04.xsd",
    "bytes": 24168,
    "sha256": "98099256985727348638e2214b20ccf1fde1589056de303b8b4170dacc1076d9"
  },
  {
    "name": "fgdc-std-001-1998-sect05.xsd",
    "bytes": 6327,
    "sha256": "61f0213fe9a22eab69bb93e3224db5fe7cd395f41636efcdb6f27b9984aef458"
  },
  {
    "name": "fgdc-std-001-1998-sect06.xsd",
    "bytes": 9012,
    "sha256": "74276a3faefe03a489a24ce013541c829f0d3f99ad0b4de505ad2572e813f289"
  },
  {
    "name": "fgdc-std-001-1998-sect07.xsd",
    "bytes": 3275,
    "sha256": "e5b7f41ab1de3dcae3e63ead8aa665229e9cf1e6e451f5c211856e992c5ebbc9"
  },
  {
    "name": "fgdc-std-001-1998-sect08.xsd",
    "bytes": 3387,
    "sha256": "131df7dfb4621ede15b4bcb936897506b09a79c3f34877c6f03d52612fb3f5f3"
  },
  {
    "name": "fgdc-std-001-1998-sect09.xsd",
    "bytes": 2857,
    "sha256": "c6462e61fc86feff0bf8e688ad1fe59d7fb475366948010bcfcb5fc4bee91938"
  },
  {
    "name": "fgdc-std-001-1998-sect10.xsd",
    "bytes": 3700,
    "sha256": "ea6f813f809b4beced357c7c8f3ca65388d5e9e832c6bd5423b2152e97a5a781"
  }
]
DTD_SHA256 = "778584c89cf0f61a382900cfab7fb7171ae99894b9b54702540ca28cb4267598"
DTD_BYTES = 16377


def sha(body):
    return hashlib.sha256(body).hexdigest()


def save(path, value):
    with path.open("x", encoding="utf-8") as out:
        json.dump(value, out, ensure_ascii=False, indent=2, allow_nan=False)
        out.write("\n")


def schemas(application, directory):
    from lxml import etree
    for row in SCHEMA_PINS:
        body = (directory / row["name"]).read_bytes()
        if len(body) != row["bytes"] or sha(body) != row["sha256"]:
            raise ValueError("Original FGDC schema changed: " + row["name"])
    dtd_path = application / "source/fgdc/fgdc-std-001-1998.dtd"
    body = dtd_path.read_bytes()
    if len(body) != DTD_BYTES or sha(body) != DTD_SHA256:
        raise ValueError("Original FGDC DTD changed")
    parser = etree.XMLParser(no_network=True, load_dtd=False, resolve_entities=False)
    schema = etree.XMLSchema(etree.parse(str(directory / SCHEMA_PINS[0]["name"]), parser))
    dtd = etree.DTD(io.BytesIO(body))

    def validate(path):
        tree = etree.parse(str(path), parser)
        schema.assertValid(tree)
        dtd.assertValid(tree)
        return tree
    return validate


def request_from_original(gis, source, manifest):
    """Use original retained primary/companion bytes, never reconstruct data."""
    request = deepcopy(manifest["source_request"])
    layers = {layer["id"]: layer for layer in manifest["layers"]}
    attachments = {row["id"]: row for row in manifest.get("attachments", [])}
    if {row["id"] for row in request["layers"]} != set(layers):
        raise ValueError("Original request/layer identities disagree")

    def original(record):
        path = gis.checked(source, record)
        return gis.record(source, path)

    for row in request["layers"]:
        layer = layers[row["id"]]
        rows = [original(record) for record in layer["originals"]]
        if not rows:
            raise ValueError("Original layer has no retained primary source")
        row["file"], row["companions"] = rows[0], rows[1:]
    for row in request.get("attachments", []):
        retained = attachments[row["id"]]
        rows = [original(record) for record in retained["files"]]
        row["file"], row["companions"] = rows[0], rows[1:]
    return request


def inspect_metadata(gis, metadata, root, validate):
    manifest = gis.load(root / "project.json")
    rows = []
    for layer in manifest["layers"]:
        if layer["data"]["kind"] != "vector":
            continue
        document = metadata.verify_metadata(root, manifest, layer)
        descriptor = layer["vector_metadata"]
        path = gis.checked(root, descriptor["xml"])
        tree = validate(path)
        # Every actual distribution/citation data link must resolve to this
        # same working file inside the received directory.
        for node in tree.findall("idinfo/citation/citeinfo/onlink") + tree.findall(
                "distinfo/stdorder/digform/digtopt/onlinopt/computer/networka/networkr"):
            resolved = (path.parent / node.text).resolve(strict=True)
            if resolved != gis.local(root, layer["working_path"]).resolve(strict=True):
                raise ValueError("Vector metadata link no longer opens its exact working dataset")
        rows.append({"layer_id": layer["id"], "feature_count": layer["data"]["feature_count"],
                     "fields": layer["data"]["fields"],
                     "original_field_map": layer["data"].get("source_field_map", {}),
                     "source_identity_field": layer["data"].get("source_identity_field"),
                     "working": document["dataset"], "metadata": descriptor,
                     "official_xsd": "passed", "official_dtd": "passed"})
    if not rows:
        raise ValueError("Select an original project containing at least one vector layer")
    return rows


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def feature_identity(path, layer, omitted=()):
    """Hash original attributes/geometries, separately from GPKG containers."""
    import fiona
    from fiona.model import to_dict
    count, digest = 0, hashlib.sha256()
    with fiona.open(path, layer=layer) as source:
        for feature in source:
            values = to_dict(feature)
            values["properties"] = {key: value for key, value in values["properties"].items()
                                    if key not in omitted}
            encoded = json.dumps(values, ensure_ascii=False, sort_keys=True,
                                 separators=(",", ":"), allow_nan=False).encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
            count += 1
    return {"features": count, "sha256": digest.hexdigest()}


def annotation_exercise(gis, root):
    """Add an empty operator annotation field only to the new working copy."""
    manifest = gis.load(root / "project.json")
    layer = next(row for row in manifest["layers"] if row["data"]["kind"] == "vector")
    path = gis.local(root, layer["working_path"])
    before = feature_identity(path, layer["data"]["layer"])
    field = "receiving_metadata_note"
    while field.lower() in {name.lower() for name in layer["data"]["fields"]}:
        field = "_" + field
    table = quote_identifier(layer["data"]["layer"])
    connection = sqlite3.connect(path)
    try:
        with connection:
            connection.execute("ALTER TABLE " + table + " ADD COLUMN " + quote_identifier(field) + " TEXT")
    finally:
        connection.close()
    after = feature_identity(path, layer["data"]["layer"], omitted=(field,))
    if after != before:
        raise ValueError("The receiving annotation changed original features")
    reason = ("Controlled receiving annotation in a new project copy: added " + field +
              " as an empty nullable field. All original geometry and scientific attribute values verified unchanged.")
    sealed = gis.seal(root, reason, project_file="project.qgs")
    return {"layer_id": layer["id"], "field": field, "initial_value": None,
            "original_features_before": before, "original_features_after": after,
            "seal": sealed, "scope": "receiving exercise only; not a scientific correction"}


def workspace_adoption(gis, archive, output, validate):
    """Exercise the original source importer in a new independent Workspace."""
    from model.workspace import Workspace
    from model import gis_workspace
    root = output / "receiving-workspace"
    if root.exists():
        raise FileExistsError("The receiving Workspace must be new")
    workspace = Workspace(root, create=True, title="Created vector metadata receiving")
    received = gis_workspace.receive(workspace, archive)
    parent, _, _ = gis_workspace.received(workspace, received["id"])
    project = gis.load(parent / "project" / "project.json")
    vectors = [row for row in project["layers"] if row["data"]["kind"] == "vector"]
    adopted = gis_workspace.adopt_sources(workspace, {
        "receipt_id": received["id"], "title": "Retained vector metadata and original context",
        "reason": "Receive the selected created vectors and their exact XML/JSON/GPKG metadata context.",
        "layer_ids": [row["id"] for row in vectors],
        "attachment_ids": [row["id"] for row in project.get("attachments", [])]})
    reopened = Workspace(root)
    collection = reopened._get("sources", adopted["source_collection_id"])
    rows = []
    for entry in collection["entries"]:
        path, retained = reopened.source_file(collection["id"], entry["id"])
        if retained.get("received_gis", {}).get("context_role") != "vector_metadata":
            continue
        binding = retained["received_gis"]["source"]
        layer = next(row for row in vectors if row["id"] == binding["dataset_layer_id"])
        descriptor = layer["vector_metadata"]
        if sha(path.read_bytes()) != descriptor["xml"]["sha256"]:
            raise ValueError("Adopted metadata XML changed")
        tree = validate(path)
        provenance = path.with_suffix(".json")
        if sha(provenance.read_bytes()) != descriptor["json"]["sha256"]:
            raise ValueError("Adopted metadata JSON changed")
        document = json.loads(provenance.read_text(encoding="utf-8"))
        links = tree.findall("idinfo/citation/citeinfo/onlink")
        if len(links) != 1:
            raise ValueError("Adopted metadata needs its one actual dataset link")
        dataset = (path.parent / links[0].text).resolve(strict=True)
        if not dataset.is_relative_to((root / "source-views").resolve(strict=True)):
            raise ValueError("Adopted metadata link leaves the original source view")
        if dataset.stat().st_size != document["dataset"]["bytes"] or gis.sha256(dataset) != document["dataset"]["sha256"]:
            raise ValueError("Adopted metadata no longer links to the retained GeoPackage")
        if not retained.get("gis_required_context"):
            raise ValueError("Adopted vector metadata is not retained as required source context")
        rows.append({"layer_id": layer["id"], "source_id": entry["id"],
                     "xml": descriptor["xml"], "json": descriptor["json"],
                     "dataset": document["dataset"], "required_context": True})
    if sorted(row["layer_id"] for row in rows) != sorted(row["id"] for row in vectors):
        raise ValueError("A selected vector lost its required metadata during source adoption")
    return {"receipt": received, "adoption": adopted, "metadata": rows,
            "cold_reopened": True, "workspace": str(root)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--original-project", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--schema-directory", type=Path)
    parser.add_argument("--exercise-annotation", action="store_true",
                        help="Exercise edit/seal in the newly built copy; original input stays unchanged.")
    parser.add_argument("--exercise-workspace-adoption", action="store_true",
                        help="Receive and adopt vector metadata through the original APIs in a new Workspace.")
    args = parser.parse_args()
    application = args.application.resolve(strict=True)
    source = args.original_project.resolve(strict=True)
    output = args.output.resolve()
    if output == source or output.is_relative_to(source) or source.is_relative_to(output):
        parser.error("Choose a new output beside, not inside or above, the original project")
    if output == application or output.is_relative_to(application):
        parser.error("Choose an output outside the retained application source")
    if output.exists():
        parser.error("The receiving output must not exist")
    sys.path.insert(0, str(application))
    gis = importlib.import_module("model.gis_project")
    metadata = importlib.import_module("model.gis_vector_metadata")
    if Path(gis.__file__).resolve() != application / "model/gis_project.py":
        raise ValueError("The imported GIS builder is not the selected application")
    schema_directory = (args.schema_directory or application / "source/fgdc-metadata/schema").resolve(strict=True)
    validate = schemas(application, schema_directory)
    original_verification = gis.verify(source)
    original_manifest = gis.load(source / "project.json")
    original_inventory_bytes = (source / "inventory.json").read_bytes()
    original_project_bytes = (source / "project.json").read_bytes()
    request = request_from_original(gis, source, original_manifest)
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    receipt = {"schema": "upstate.gis-vector-metadata-receiving/v1",
               "state": "running", "started_at": datetime.now(timezone.utc).isoformat(),
               "application": str(application), "original_project": str(source),
               "output": str(output), "python": sys.version, "platform": platform.platform(),
               "source": {"builder": gis.record(application, Path(gis.__file__).resolve()),
                          "metadata": gis.record(application, Path(metadata.__file__).resolve())},
               "original": original_verification, "schema_files": SCHEMA_PINS,
               "qgis_desktop_readback": "Not performed by this command; open project.qgz with the original desktop receiver.",
               "browser_readback": "Not performed by this command; inspect OPEN_GIS.html at actual desktop/phone widths."}
    try:
        save(output / "retained-request.json", request)
        project = output / "vector-project"
        receipt["build"] = gis.build(request, source, project)
        first = inspect_metadata(gis, metadata, project, validate)
        receipt["created_vectors"] = first
        old_metadata = [record for row in first for record in (row["metadata"]["xml"], row["metadata"]["json"])]
        if args.exercise_annotation:
            receipt["annotation"] = annotation_exercise(gis, project)
            receipt["edited_vectors"] = inspect_metadata(gis, metadata, project, validate)
            for record in old_metadata:
                gis.checked(project, record)
            receipt["previous_metadata_retained"] = old_metadata
            changed = {row["layer_id"]: row["metadata"]["id"] for row in receipt["edited_vectors"]}
            if changed[receipt["annotation"]["layer_id"]] == next(
                    row["metadata"]["id"] for row in first if row["layer_id"] == receipt["annotation"]["layer_id"]):
                raise ValueError("Edited vector metadata did not advance its immutable edition")
        archive = output / "Editable_Vector_Metadata.zip"
        receipt["archive"] = gis.pack(project, archive)
        receiving = output / "received-vector-project"
        receipt["receive"] = gis.receive(archive, receiving)
        receipt["received_vectors"] = inspect_metadata(gis, metadata, receiving, validate)
        if receipt["received_vectors"] != receipt.get("edited_vectors", first):
            raise ValueError("Received vector metadata differs from its packed source edition")
        if args.exercise_workspace_adoption:
            receipt["workspace_adoption"] = workspace_adoption(gis, archive, output, validate)
        else:
            receipt["workspace_adoption"] = {"state": "not requested"}
        if (source / "inventory.json").read_bytes() != original_inventory_bytes or (
                source / "project.json").read_bytes() != original_project_bytes:
            raise ValueError("The original project documents changed during receiving")
        if gis.verify(source) != original_verification:
            raise ValueError("The retained original project changed during receiving")
        receipt["original_unchanged"] = True
        receipt["state"] = "passed"
    except BaseException as error:
        receipt["state"] = "failed"
        receipt["error"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        receipt["elapsed_seconds"] = round(time.monotonic() - started, 4)
        save(output / "vector-metadata-receipt.json", receipt)
        print(json.dumps(receipt, ensure_ascii=False))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Prepare original watershed context for the existing persistent workspace.

The native watershed model owns the scientific interpretation. This bridge
preserves source bytes, checks available original query/geometry companions,
and supplies the loader used by the Regional watersheds operator.
"""
from __future__ import annotations

import argparse
from collections import Counter
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

CONTEXT_NAME = "full-domain-water-context.json"
COVERAGE_NAME = "scdes-domain217-source-coverage.json"
NETWORK_NAME = "native-network.json"
NETWORK_GZIP_NAME = "native-network.json.gz"
NETWORK_NAMES = (NETWORK_NAME, NETWORK_GZIP_NAME)
GEOMETRY_NAME = "scdes-classified-streams.esri.json"
MANIFEST_NAME = "complete-sources.json"


def _digest(body):
    return hashlib.sha256(body).hexdigest()


def _json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       indent=2) + "\n").encode("utf-8")


def _read_json(body, name):
    def invalid(value):
        raise ValueError("Non-finite JSON number in " + name + ": " + value)
    try:
        return json.loads(body.decode("utf-8"), parse_constant=invalid)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Read original UTF-8 JSON for " + name) from exc


def _name(value):
    if (not isinstance(value, str) or not value or value in (".", "..")
            or Path(value).name != value or "\\" in value or "\0" in value):
        raise ValueError("Source companion names must be single portable filenames")
    return value


def _member(root, name):
    name = _name(name)
    selected = root / name
    path = selected.resolve(strict=True)
    if path.parent != root or not path.is_file():
        raise ValueError("Source companion must remain inside its edition: " + name)
    body = path.read_bytes()
    return ({"name": name, "path": str(path), "bytes": len(body),
             "sha256": _digest(body)}, body)


def _present(root, name):
    path = root / _name(name)
    return path.exists() or path.is_symlink()


def _expected_body(row, body, name):
    if row.get("bytes") is not None and len(body) != row["bytes"]:
        raise ValueError("Original source byte count differs: " + name)
    if row.get("sha256") and _digest(body) != row["sha256"]:
        raise ValueError("Original source SHA-256 differs: " + name)


def _original_companions(root, coverage, source_context):
    """Check original bodies when included with the retained source edition."""
    files, checks, originals = [], {}, {}
    for key in ("full_domain_id_response", "additional_huc8_response"):
        reference = coverage.get(key) or {}
        name = reference.get("path")
        if not name or not _present(root, name):
            continue
        info, body = _member(root, name)
        _expected_body(reference, body, name)
        value = _read_json(body, name)
        if not isinstance(value, dict):
            raise ValueError("Original query response must be a JSON object: " + name)
        originals[key] = value
        files.append(info)

    membership = originals.get("full_domain_id_response")
    ids = None
    if membership is not None:
        ids = membership.get("objectIds")
        if (not isinstance(ids, list)
                or any(isinstance(value, bool) or not isinstance(value, int) for value in ids)
                or len(ids) != len(set(ids))):
            raise ValueError("Original domain response must contain distinct integer objectIds")
        reference = coverage["full_domain_id_response"]
        if len(ids) != reference.get("count") or len(ids) != reference.get("unique_ids"):
            raise ValueError("Original domain object IDs differ from the retained coverage")
        checks["domain_membership"] = {"objects": len(ids), "unique_objects": len(set(ids))}

    additional = originals.get("additional_huc8_response")
    if additional is not None:
        count = additional.get("count")
        if (isinstance(count, bool) or not isinstance(count, int) or count < 0
                or count != coverage["additional_huc8_response"].get("count")):
            raise ValueError("Original additional-HUC8 count differs from retained coverage")
        checks["additional_huc8"] = {"selected_class_count": count}

    if _present(root, GEOMETRY_NAME):
        info, body = _member(root, GEOMETRY_NAME)
        expected = coverage.get("captured_geometry") or {}
        _expected_body(expected, body, GEOMETRY_NAME)
        geometry = _read_json(body, GEOMETRY_NAME)
        features = geometry.get("features") if isinstance(geometry, dict) else None
        if not isinstance(features, list) or len(features) != expected.get("features"):
            raise ValueError("Original classified geometry feature count differs")
        id_field = coverage.get("object_id_field") or "OBJECTID"
        object_ids, counts, huc_counts = [], Counter(), Counter()
        domain = set(source_context["model_domain_huc12s"])
        for feature in features:
            attributes = feature.get("attributes") if isinstance(feature, dict) else None
            if not isinstance(attributes, dict):
                raise ValueError("Original classified features need publisher attributes")
            object_id = attributes.get(id_field)
            if isinstance(object_id, bool) or not isinstance(object_id, int):
                raise ValueError("Original classified geometry needs integer object IDs")
            huc12 = str(attributes.get("HUC_12", "")).strip()
            class_code = str(attributes.get("H2OCLASS", "")).strip().upper()
            if huc12 not in domain:
                raise ValueError("Original classified geometry contains an outside-domain HUC12")
            object_ids.append(object_id)
            counts[class_code] += 1
            huc_counts[(huc12, class_code)] += 1
        if len(object_ids) != len(set(object_ids)):
            raise ValueError("Original classified geometry repeats object IDs")
        if ids is not None and set(object_ids) != set(ids):
            raise ValueError("Original classified geometry and domain query object IDs differ")
        expected_counts = (coverage.get("comparison") or {}).get("class_counts") or {}
        if dict(counts) != expected_counts:
            raise ValueError("Original classified geometry and retained class totals differ")
        native_counts = {
            (str(row["publisher_huc12"]), str(row["class_code"]).upper()): row["feature_count"]
            for row in source_context["classified_source_inventory"]["source_huc_class_counts"]
        }
        if dict(huc_counts) != native_counts:
            raise ValueError("Original classified geometry and source HUC/class rows differ")
        checks["classified_geometry"] = {
            "features": len(features), "unique_objects": len(set(object_ids)),
            "class_counts": dict(sorted(counts.items())),
            "publisher_huc_count": len({huc for huc, _ in huc_counts}),
            "domain_object_ids_matched": ids is not None,
        }
        files.append(info)
    return sorted(files, key=lambda row: row["name"]), checks


def load_source_edition(directory):
    """Return the exact interface consumed by WatershedContextActions.

    source_files contains the model's input bytes. Original publisher response
    and geometry files, when present, are separately checked and returned in
    supporting_files; the workspace manifest retains both sets. Adding such
    companions never changes the identity of an already-saved model result.
    """
    from model.watershed_context import build_watershed_context

    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Choose the retained watershed source edition directory")
    context_info, context_body = _member(root, CONTEXT_NAME)
    coverage_info, coverage_body = _member(root, COVERAGE_NAME)
    context = _read_json(context_body, CONTEXT_NAME)
    coverage = _read_json(coverage_body, COVERAGE_NAME)
    if not isinstance(context, dict) or context.get("schema") != "upstate.water-context/v1":
        raise ValueError("Expected upstate.water-context/v1 source context")
    if not isinstance(coverage, dict) or coverage.get("schema") != "upstate.classification-source-coverage/v1":
        raise ValueError("Expected upstate.classification-source-coverage/v1 companion")
    inputs = [context_info, coverage_info]
    network = None
    network_names = [name for name in NETWORK_NAMES if _present(root, name)]
    if len(network_names) > 1:
        raise ValueError("Choose one retained native network source for this edition")
    if network_names:
        network_name = network_names[0]
        network_info, network_body = _member(root, network_name)
        decoded = gzip.decompress(network_body) if network_name == NETWORK_GZIP_NAME else network_body
        network = _read_json(decoded, network_name)
        if not isinstance(network, (dict, list)):
            raise ValueError("Original native network must be a JSON object or list")
        inputs.append(network_info)

    report = build_watershed_context(context, classification_coverage=coverage, network=network)
    supporting, checks = _original_companions(root, coverage, context)
    inputs.sort(key=lambda row: row["name"])
    fingerprint = _digest(json.dumps(
        [{"id": row["name"], "sha256": row["sha256"]} for row in inputs],
        sort_keys=True, separators=(",", ":")).encode("utf-8"))
    validation = {
        "schema": "upstate.watershed-source-validation/v1",
        "validator": "model.watershed_context.build_watershed_context",
        "analysis_version": report["analysis_version"], "report_id": report["id"],
        "source_fingerprint": fingerprint, "summary": report["summary"],
        "classification_coverage": report["classification_coverage"],
        "native_network_supplied": network is not None,
        "original_source_checks": checks,
        "supporting_sources": [
            {key: row[key] for key in ("name", "bytes", "sha256")} for row in supporting
        ],
    }
    result = {
        "source_context": context, "classification_coverage": coverage,
        "source_files": inputs, "supporting_files": supporting, "validation": validation,
    }
    if network is not None:
        result["native_network"] = network
    return result


def _manifest(edition, *, source_id=None, title=None, uri=None, vintage=None):
    context, coverage = edition["source_context"], edition["classification_coverage"]
    captured = coverage.get("captured_at")
    day = str(captured or "").split(" ")[0].split("T")[0].replace("-", "")
    if not (len(day) == 8 and day.isdecimal()):
        day = edition["validation"]["source_fingerprint"][:12]
    count = edition["validation"]["summary"]["huc_count"]
    source_id = source_id or "upper-savannah-water-context-domain" + str(count) + "-" + day
    references = context.get("source_reference") or {}
    if not isinstance(references, dict):
        references = {"source": references}
    files = edition["source_files"] + edition["supporting_files"]
    main = next(row for row in files if row["name"] == CONTEXT_NAME)
    original_uri = (coverage.get("model_domain") or {}).get("source_context_canvas")
    if not original_uri:
        domain_reference = references.get("domain")
        original_uri = domain_reference.get("uri") if isinstance(domain_reference, dict) else None
    nrcs_edition = (context.get("nrcs_inventory") or {}).get("edition")
    original_vintage = "; ".join(value for value in (
        "NRCS " + str(nrcs_edition) if nrcs_edition else None,
        "SCDES captured " + str(captured) if captured else None,
    ) if value) or "Retained edition " + main["sha256"][:12]
    entry = {
        "id": source_id, "title": title or context.get("title") or "Regional watershed context",
        "uri": uri or original_uri or "urn:sha256:" + main["sha256"],
        "vintage": vintage or original_vintage, "kind": "document",
        "role": "SOURCE_WATER_CONTEXT", "path": CONTEXT_NAME, "sha256": main["sha256"],
        "companions": [
            {"path": row["name"], "sha256": row["sha256"]}
            for row in sorted(files, key=lambda row: row["name"]) if row["name"] != CONTEXT_NAME
        ],
        "source_reference": references,
        "source_fingerprint": edition["validation"]["source_fingerprint"],
    }
    return {
        "schema": "upstate.sources/v1", "title": entry["title"], "captured_at": captured,
        "entries": [entry], "scope": {
            "model_domain_huc12_count": count,
            "classification_assignment": "publisher_huc12_attribute",
            "native_network_supplied": "native_network" in edition,
        },
        "notes": [
            "Primary and companion files preserve their original bytes.",
            "The Regional watersheds desk uses the retained native context model.",
            "Workspace source views reconstruct these original companion filenames.",
        ],
    }


def _write_exact(path, body):
    """Atomically add a file, reusing an identical existing source edition."""
    if path.is_symlink():
        raise ValueError("Choose a regular source edition member: " + path.name)
    if path.exists():
        if not path.is_file() or path.read_bytes() != body:
            raise ValueError("Choose a new output directory for changed source bytes: " + path.name)
        return
    fd, pending = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            if path.is_symlink() or path.read_bytes() != body:
                raise ValueError("Source edition changed during preparation: " + path.name)
    finally:
        Path(pending).unlink(missing_ok=True)


def prepare_source_edition(source_context, classification_coverage, output_dir, *,
                           native_network=None, membership_response=None,
                           additional_huc8_response=None, classified_geometry=None,
                           source_id=None, title=None, uri=None, vintage=None):
    """Prepare complete-sources.json for the existing Workspace.import_sources."""
    bodies = {
        CONTEXT_NAME: Path(source_context).read_bytes(),
        COVERAGE_NAME: Path(classification_coverage).read_bytes(),
    }
    coverage = _read_json(bodies[COVERAGE_NAME], COVERAGE_NAME)
    if not isinstance(coverage, dict):
        raise ValueError("Choose the retained classification-coverage JSON object")
    if native_network is not None:
        network_body = Path(native_network).read_bytes()
        network_name = NETWORK_GZIP_NAME if network_body.startswith(b"\x1f\x8b") else NETWORK_NAME
        bodies[network_name] = network_body
    for selected, key in (
            (membership_response, "full_domain_id_response"),
            (additional_huc8_response, "additional_huc8_response")):
        if selected is not None:
            name = _name((coverage.get(key) or {}).get("path"))
            if name in bodies or name in (*NETWORK_NAMES, GEOMETRY_NAME, MANIFEST_NAME):
                raise ValueError("Original companion filename collides with another source")
            bodies[name] = Path(selected).read_bytes()
    if classified_geometry is not None:
        bodies[GEOMETRY_NAME] = Path(classified_geometry).read_bytes()

    target = Path(output_dir).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".watershed-source-", dir=target.parent) as folder:
        stage = Path(folder)
        for name, body in bodies.items():
            (stage / _name(name)).write_bytes(body)
        edition = load_source_edition(stage)
        manifest = _manifest(edition, source_id=source_id, title=title, uri=uri, vintage=vintage)
        bodies[MANIFEST_NAME] = _json_bytes(manifest)
        target.mkdir(parents=True, exist_ok=True)
        for network_name in NETWORK_NAMES:
            if network_name not in bodies and _present(target, network_name):
                raise ValueError("Use a new source directory when changing its native network")
        for name, body in bodies.items():
            selected = target / name
            if selected.exists() or selected.is_symlink():
                if selected.is_symlink() or not selected.is_file() or selected.read_bytes() != body:
                    raise ValueError("Choose a new output directory for changed source bytes: " + name)
        for name, body in bodies.items():
            if name != MANIFEST_NAME:
                _write_exact(target / name, body)
        _write_exact(target / MANIFEST_NAME, bodies[MANIFEST_NAME])
    result = load_source_edition(target)
    result["manifest_path"] = str(target / MANIFEST_NAME)
    result["source_id"] = manifest["entries"][0]["id"]
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Read a retained source edition and its native summary")
    inspect.add_argument("--source-dir", required=True)
    prepare = commands.add_parser("prepare", help="Prepare and optionally import original source companions")
    prepare.add_argument("--source-context", required=True)
    prepare.add_argument("--classification-coverage", required=True)
    prepare.add_argument("--output-dir", required=True)
    for name in ("native-network", "membership-response", "additional-huc8-response",
                 "classified-geometry", "source-id", "title", "uri", "vintage", "workspace"):
        prepare.add_argument("--" + name)
    prepare.add_argument("--create-workspace", action="store_true",
                         help="Create the requested workspace before importing")
    args = parser.parse_args(argv)
    if args.command == "prepare" and args.create_workspace and not args.workspace:
        parser.error("--create-workspace requires --workspace")
    if args.command == "inspect":
        edition = load_source_edition(args.source_dir)
    else:
        keys = ("source_context", "classification_coverage", "output_dir",
                "native_network", "membership_response", "additional_huc8_response",
                "classified_geometry", "source_id", "title", "uri", "vintage")
        edition = prepare_source_edition(**{key: getattr(args, key) for key in keys})
    result = {
        "validation": edition["validation"],
        "source_files": edition["source_files"],
        "supporting_files": edition["supporting_files"],
    }
    if args.command == "prepare":
        result.update(manifest_path=edition["manifest_path"], source_id=edition["source_id"])
        if args.workspace:
            from model.workspace import Workspace
            workspace = Workspace(args.workspace, create=args.create_workspace)
            collection = workspace.import_sources(edition["manifest_path"])
            context_path, _ = workspace.source_file(collection["id"], edition["source_id"])
            retained = load_source_edition(context_path.parent)
            if retained["validation"]["source_fingerprint"] != edition["validation"]["source_fingerprint"]:
                raise ValueError("Imported watershed model inputs differ from their prepared edition")
            result.update(workspace=str(workspace.root), source_collection_id=collection["id"])
            result["operator_action"] = {
                "action": "watershed.context.analyze",
                "payload": {"source_collection_id": collection["id"], "source_id": edition["source_id"]},
            }
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

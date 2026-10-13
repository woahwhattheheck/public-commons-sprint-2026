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
from pathlib import Path, PurePosixPath
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

CONTEXT_NAME = "full-domain-water-context.json"
COVERAGE_NAME = "scdes-domain217-source-coverage.json"
NETWORK_NAME = "native-network.json"
NETWORK_GZIP_NAME = "native-network.json.gz"
NETWORK_NAMES = (NETWORK_NAME, NETWORK_GZIP_NAME)
NETWORK_SOURCE_NAME = "native-network-source.json"
GEOMETRY_NAME = "scdes-classified-streams.esri.json"
MANIFEST_NAME = "complete-sources.json"
NATIVE_MANIFEST_NAME = "complete-native-sources.json"


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


def _relative_name(value):
    if (not isinstance(value, str) or not value or "\\" in value or "\0" in value):
        raise ValueError("Source companion needs a safe relative filename")
    path = PurePosixPath(value)
    if (path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/"))
            or path.as_posix() != value):
        raise ValueError("Source companion must stay inside its edition: " + value)
    return value


def _member(root, name):
    name = _relative_name(name)
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Source companion must remain inside its edition: " + name)
    body = path.read_bytes()
    return ({"name": name, "path": str(path), "bytes": len(body),
             "sha256": _digest(body)}, body)


def _present(root, name):
    path = root / _relative_name(name)
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



def load_native_network_sources(directory, network_name, *, network_path=None):
    """Load the chosen network's original companions without another source edition.

    The original network descriptor remains a model input. This function returns
    only byte-bound origin and nested original companions for supporting_files.
    network_path can identify an original publisher filename within directory;
    network_name identifies its canonical retained .json or .json.gz member.
    """
    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Choose the retained native network source directory")
    if network_name not in NETWORK_NAMES:
        raise ValueError("Choose native-network.json or native-network.json.gz")
    if network_path is None:
        native_member = network_name
    else:
        chosen = Path(network_path)
        if not chosen.is_absolute():
            chosen = root / chosen
        chosen = chosen.resolve(strict=True)
        if not chosen.is_relative_to(root) or not chosen.is_file():
            raise ValueError("Chosen native network must remain inside its source directory")
        native_member = chosen.relative_to(root).as_posix()
    network_info, network_body = _member(root, native_member)
    decoded = gzip.decompress(network_body) if network_name == NETWORK_GZIP_NAME else network_body
    network = _read_json(decoded, network_name)
    if not isinstance(network, (dict, list)):
        raise ValueError("Original native network must be a JSON object or list")
    files, checks = [], {}
    references = network.get("source_reference", {}) if isinstance(network, dict) else {}
    if _present(root, NETWORK_SOURCE_NAME):
        provenance_info, provenance_body = _member(root, NETWORK_SOURCE_NAME)
        provenance = _read_json(provenance_body, NETWORK_SOURCE_NAME)
        if not isinstance(provenance, dict) or provenance.get("schema") != "upstate.native-network-source/v1":
            raise ValueError("Expected upstate.native-network-source/v1 original provenance")
        if provenance.get("source_member") != network_name:
            raise ValueError("Native provenance must identify the retained original network filename")
        if not isinstance(provenance.get("source_uri"), str) or not provenance["source_uri"].strip():
            raise ValueError("Native provenance must retain the original source URI")
        if (not isinstance(provenance.get("body_bytes"), int)
                or isinstance(provenance["body_bytes"], bool)
                or provenance["body_bytes"] != network_info["bytes"]
                or provenance.get("body_sha256") != network_info["sha256"]):
            raise ValueError("Native provenance does not bind the original source bytes")
        files.append(provenance_info)
        references = references or provenance
        checks["native_network_source"] = {
            "status": "original_bytes_bound", "source_uri": provenance["source_uri"],
            "source_member": network_name, "bytes": network_info["bytes"],
            "sha256": network_info["sha256"], "provenance_sha256": provenance_info["sha256"],
        }
    originals = references.get("originals", {}) if isinstance(references, dict) else {}
    if not isinstance(originals, dict):
        raise ValueError("Native network original references must be keyed records")
    native_names = []
    for label, reference in originals.items():
        if not isinstance(reference, dict):
            raise ValueError("Native network original reference must be an object: " + str(label))
        name = _relative_name(reference.get("path"))
        info, body = _member(root, name)
        if (not isinstance(reference.get("sha256"), str)
                or len(reference["sha256"]) != 64
                or not isinstance(reference.get("bytes"), int)
                or isinstance(reference["bytes"], bool)):
            raise ValueError("Native network original requires exact bytes and SHA-256: " + name)
        _expected_body(reference, body, name)
        files.append(info)
        native_names.append(name)
    if native_names:
        checks["native_originals"] = {"files": sorted(native_names), "count": len(native_names)}
    return {"supporting_files": files, "validation": checks}


def _complete_originals(root, network, network_name=None):
    """Bind the complete original edition without changing model-input identity."""
    from source_tools.watershed_source_validation import load_source_edition as validate_originals
    from source_tools.watershed_source_validation import (
        DOMAIN_NAME, NRCS_NAME, CLASSIFIED_NAME, IDS_NAME, ZERO_NAME, OPTIONAL_NAMES,
    )

    files, checks = [], {}
    required = (DOMAIN_NAME, NRCS_NAME, CLASSIFIED_NAME, IDS_NAME, ZERO_NAME)
    missing = [name for name in required if not _present(root, name)]
    if not missing:
        validated = validate_originals(root, native_network_name=network_name)
        files.extend(validated["source_files"])
        checks["complete_source_edition"] = {
            "status": "original_bytes_bound", **validated["validation"],
        }
    else:
        checks["complete_source_edition"] = {
            "status": "context_inputs_retained",
            "missing_original_companions": missing,
        }
        for name in OPTIONAL_NAMES:
            if _present(root, name):
                files.append(_member(root, name)[0])

    if network_name is not None:
        native = load_native_network_sources(root, network_name)
        files.extend(native["supporting_files"])
        checks.update(native["validation"])
    elif _present(root, NETWORK_SOURCE_NAME):
        raise ValueError("Native provenance requires its retained original network")
    return files, checks


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
    complete_files, complete_checks = _complete_originals(root, network, network_names[0] if network_names else None)
    checks.update(complete_checks)
    model_names = {row["name"] for row in inputs}
    supporting_by_name = {}
    for row in supporting + complete_files:
        if row["name"] in model_names:
            continue
        previous = supporting_by_name.get(row["name"])
        if previous is not None and previous["sha256"] != row["sha256"]:
            raise ValueError("Original source name has conflicting bytes: " + row["name"])
        supporting_by_name[row["name"]] = row
    supporting = [supporting_by_name[name] for name in sorted(supporting_by_name)]
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
        "manifest_path": str(root / (
            NATIVE_MANIFEST_NAME if network is not None and _present(root, NATIVE_MANIFEST_NAME)
            else MANIFEST_NAME
        )) if (_present(root, MANIFEST_NAME)
               or (network is not None and _present(root, NATIVE_MANIFEST_NAME))) else None,
    }
    if network is not None:
        result["native_network"] = network
    return result



def _validate_import_manifest(root, edition):
    """Check every selected scientific member, including cross-date aliases."""
    root = Path(root).resolve(strict=True)
    manifest_path = Path(edition["manifest_path"]).resolve(strict=True)
    manifest_root = manifest_path.parent
    manifest = _read_json(manifest_path.read_bytes(), manifest_path.name)
    if (not isinstance(manifest, dict) or manifest.get("schema") != "upstate.sources/v1"
            or not isinstance(manifest.get("entries"), list)):
        raise ValueError("Choose an upstate.sources/v1 watershed import manifest")
    matches = [entry for entry in manifest["entries"]
               if isinstance(entry, dict) and entry.get("role") == "SOURCE_WATER_CONTEXT"]
    if len(matches) != 1:
        raise ValueError("Import requires exactly one SOURCE_WATER_CONTEXT entry")
    entry = matches[0]
    context_name = _relative_name(entry.get("path"))
    context_parent = PurePosixPath(context_name).parent
    if PurePosixPath(context_name).name != CONTEXT_NAME:
        raise ValueError("Retain the original full-domain context filename")
    companions = entry.get("companions", [])
    if not isinstance(companions, list):
        raise ValueError("The watershed context companions must be a list")
    declared = {}
    for member in [entry] + companions:
        if not isinstance(member, dict):
            raise ValueError("Retain each watershed source companion path and hash")
        name = _relative_name(member.get("path"))
        if name in declared:
            raise ValueError("The watershed manifest repeats a source member: " + name)
        info, body = _member(manifest_root, name)
        _expected_body(member, body, name)
        declared[name] = {"descriptor": member, "info": info}

    required = edition["source_files"] + edition.get("supporting_files", [])
    bindings = {}
    for row in required:
        original_name = _relative_name(row["name"])
        native_name = (context_parent / original_name).as_posix()
        candidates = [native_name] if native_name in declared else []
        if not candidates:
            original_path = Path(row["path"]).resolve(strict=True)
            candidates = [name for name, member in declared.items()
                          if Path(member["info"]["path"]) == original_path]
        if not candidates and "/" not in original_name:
            # An unchanged top-level table may already be retained in a prior
            # dated directory. Bind its complete original bytes, not its label.
            candidates = [name for name, member in declared.items()
                          if PurePosixPath(name).name == original_name
                          and member["info"]["bytes"] == row["bytes"]
                          and member["info"]["sha256"] == row["sha256"]]
        if len(candidates) != 1:
            raise ValueError("The chosen watershed manifest must retain one exact scientific member: "
                             + original_name)
        selected = candidates[0]
        member = declared[selected]
        if (member["descriptor"].get("sha256") != row["sha256"]
                or member["info"]["sha256"] != row["sha256"]
                or member["info"]["bytes"] != row["bytes"]):
            raise ValueError("The watershed manifest must bind the exact source bytes: " + original_name)
        bindings[original_name] = selected
    return {"source_id": entry.get("id"), "members": bindings}


def _model_input_inventory(edition):
    return sorted(
        ({key: row[key] for key in ("name", "bytes", "sha256")}
         for row in edition["source_files"]),
        key=lambda row: row["name"],
    )


def import_source_edition(workspace, directory, *, classified_reaches_csv=None,
                          source_manifest=None):
    """Import the selected edition and verify its reconstructed model inputs.

    source_manifest can name a parent manifest with cross-date companions.
    Omitting it uses the maintained edition manifest selection: the separate
    native manifest when present, otherwise historical complete-sources.json.
    The existing Workspace owns native companion retention and source views.
    """
    root = Path(directory).expanduser().resolve(strict=True)
    if classified_reaches_csv is not None:
        retained = (root / "classified-reaches.csv").resolve(strict=True)
        if Path(classified_reaches_csv).expanduser().resolve(strict=True) != retained:
            raise ValueError("Retain classified-reaches.csv inside the source edition before import")
    edition = load_source_edition(root)
    selected_manifest = source_manifest if source_manifest is not None else edition["manifest_path"]
    if selected_manifest is None:
        raise FileNotFoundError("Import requires " + str(root / MANIFEST_NAME)
                                + " or an explicit source_manifest")
    manifest_path = Path(selected_manifest).expanduser().resolve(strict=True)
    if not manifest_path.is_file():
        raise ValueError("Choose a retained source manifest file")
    for method in ("import_sources", "source_file"):
        if not callable(getattr(workspace, method, None)):
            raise TypeError("workspace must provide Workspace." + method)

    manifest_body = manifest_path.read_bytes()
    manifest = _read_json(manifest_body, manifest_path.name)
    if (not isinstance(manifest, dict) or manifest.get("schema") != "upstate.sources/v1"
            or not isinstance(manifest.get("entries"), list)):
        raise ValueError("Source manifest must use upstate.sources/v1 and list entries")
    context_entries = [
        row for row in manifest["entries"]
        if isinstance(row, dict) and row.get("role") == "SOURCE_WATER_CONTEXT"
    ]
    if len(context_entries) != 1:
        raise ValueError("Choose a manifest with exactly one SOURCE_WATER_CONTEXT entry")
    context_entry = context_entries[0]
    source_id = context_entry.get("id")
    if not isinstance(source_id, str) or not source_id:
        raise ValueError("The selected source-water context needs a source ID")
    context_name = _relative_name(context_entry.get("path"))
    context_parent = PurePosixPath(context_name).parent
    if PurePosixPath(context_name).name != CONTEXT_NAME:
        raise ValueError("The source-water context must retain " + CONTEXT_NAME)
    companions = context_entry.get("companions", [])
    if not isinstance(companions, list) or any(not isinstance(row, dict) for row in companions):
        raise ValueError("Source-water context companions must be a list of source descriptors")
    declared = {}
    for row in [context_entry] + companions:
        name = _relative_name(row.get("path"))
        if name in declared:
            raise ValueError("Source-water context repeats a native member: " + name)
        declared[name] = row
    selected_inputs = []
    for name in (CONTEXT_NAME, COVERAGE_NAME) + NETWORK_NAMES:
        native_name = (context_parent / name).as_posix()
        if native_name in declared:
            info, body = _member(manifest_path.parent, native_name)
            _expected_body(declared[native_name], body, native_name)
            selected_inputs.append({"name": name, "bytes": info["bytes"], "sha256": info["sha256"]})
    expected_inputs = _model_input_inventory(edition)
    if sorted(selected_inputs, key=lambda row: row["name"]) != expected_inputs:
        raise ValueError("Selected manifest model inputs differ from the registered source edition; "
                         "choose its exact source_manifest including the selected native network")

    manifest_members = _validate_import_manifest(
        root, {**edition, "manifest_path": str(manifest_path)})
    manifest_identity = {"path": str(manifest_path), "bytes": len(manifest_body),
                         "sha256": _digest(manifest_body)}
    collection = workspace.import_sources(manifest_path)
    original_manifest = collection.get("original_manifest", {})
    if any(original_manifest.get(key) != manifest_identity[key] for key in ("bytes", "sha256")):
        raise ValueError("The source manifest changed during Workspace import")
    imported_entries = [
        row for row in collection["entries"] if row.get("role") == "SOURCE_WATER_CONTEXT"
    ]
    if len(imported_entries) != 1 or imported_entries[0].get("id") != source_id:
        raise ValueError("Workspace import changed the selected source-water context entry")
    context_path, imported_entry = workspace.source_file(collection["id"], source_id)
    if imported_entry.get("role") != "SOURCE_WATER_CONTEXT":
        raise ValueError("Workspace source view does not identify the selected water context")
    retained = load_source_edition(Path(context_path).resolve(strict=True).parent)
    if (_model_input_inventory(retained) != expected_inputs
            or retained["validation"]["source_fingerprint"]
            != edition["validation"]["source_fingerprint"]):
        raise ValueError("Imported watershed model inputs differ from the registered source edition")
    return {**edition, "collection": collection, "source_id": source_id,
            "source_collection_id": collection["id"], "manifest_path": str(manifest_path),
            "source_manifest": manifest_identity, "source_manifest_members": manifest_members,
            "imported_validation": retained["validation"]}


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
        network_path = Path(native_network).resolve(strict=True)
        network_body = network_path.read_bytes()
        network_name = NETWORK_GZIP_NAME if network_body.startswith(b"\x1f\x8b") else NETWORK_NAME
        bodies[network_name] = network_body
        decoded = gzip.decompress(network_body) if network_name == NETWORK_GZIP_NAME else network_body
        native = _read_json(decoded, network_name)
        references = native.get("source_reference", {}) if isinstance(native, dict) else {}
        if _present(network_path.parent, NETWORK_SOURCE_NAME):
            _, provenance_body = _member(network_path.parent, NETWORK_SOURCE_NAME)
            provenance = _read_json(provenance_body, NETWORK_SOURCE_NAME)
            if not isinstance(provenance, dict) or provenance.get("source_member") != network_name:
                raise ValueError("Native provenance must identify the preserved canonical network member")
            bodies[NETWORK_SOURCE_NAME] = provenance_body
            references = references or provenance
        originals = references.get("originals", {}) if isinstance(references, dict) else {}
        if not isinstance(originals, dict):
            raise ValueError("Native network original references must be keyed records")
        for reference in originals.values():
            if not isinstance(reference, dict):
                raise ValueError("Native network original reference must be an object")
            name = _relative_name(reference.get("path"))
            if name in bodies or name in (*NETWORK_NAMES, NETWORK_SOURCE_NAME, GEOMETRY_NAME, MANIFEST_NAME, NATIVE_MANIFEST_NAME):
                raise ValueError("Native original filename collides with a model input: " + name)
            _, body = _member(network_path.parent, name)
            _expected_body(reference, body, name)
            bodies[name] = body
    for selected, key in (
            (membership_response, "full_domain_id_response"),
            (additional_huc8_response, "additional_huc8_response")):
        if selected is not None:
            name = _name((coverage.get(key) or {}).get("path"))
            if name in bodies or name in (*NETWORK_NAMES, GEOMETRY_NAME, MANIFEST_NAME, NATIVE_MANIFEST_NAME):
                raise ValueError("Original companion filename collides with another source")
            bodies[name] = Path(selected).read_bytes()
    if classified_geometry is not None:
        bodies[GEOMETRY_NAME] = Path(classified_geometry).read_bytes()

    # Carry known original companions already retained beside the source context.
    from source_tools.watershed_source_validation import (
        DOMAIN_NAME, NRCS_NAME, CLASSIFIED_NAME, IDS_NAME, ZERO_NAME, OPTIONAL_NAMES,
    )
    retained_root = Path(source_context).resolve(strict=True).parent
    for name in (DOMAIN_NAME, NRCS_NAME, CLASSIFIED_NAME, IDS_NAME, ZERO_NAME, *OPTIONAL_NAMES):
        if name not in bodies and _present(retained_root, name):
            bodies[name] = _member(retained_root, name)[1]

    target = Path(output_dir).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".watershed-source-", dir=target.parent) as folder:
        stage = Path(folder)
        for name, body in bodies.items():
            member = stage / _relative_name(name)
            member.parent.mkdir(parents=True, exist_ok=True)
            member.write_bytes(body)
        edition = load_source_edition(stage)
        manifest = _manifest(edition, source_id=source_id, title=title, uri=uri, vintage=vintage)
        bodies[MANIFEST_NAME] = _json_bytes(manifest)
        target.mkdir(parents=True, exist_ok=True)
        for network_name in NETWORK_NAMES:
            if network_name not in bodies and _present(target, network_name):
                raise ValueError("Use a new source directory when changing its native network")
        for name, body in bodies.items():
            selected = target / _relative_name(name)
            if not selected.resolve().is_relative_to(target):
                raise ValueError("Source output must stay inside its edition: " + name)
            if selected.exists() or selected.is_symlink():
                if selected.is_symlink() or not selected.is_file() or selected.read_bytes() != body:
                    raise ValueError("Choose a new output directory for changed source bytes: " + name)
        for name, body in bodies.items():
            if name != MANIFEST_NAME:
                (target / name).parent.mkdir(parents=True, exist_ok=True)
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

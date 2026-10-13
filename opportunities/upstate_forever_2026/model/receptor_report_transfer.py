"""Retain editable original source-water products in a selected scientific Study.

This adapter follows an explicitly selected report's captured CAS objects. It
never runs a model, creates a source view, renders figures or rebuilds a product.
Earlier source-only transfers and reports from another project retain their
original captured files without borrowing local product IDs.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

SCHEMA = "upstate.receptor-report-source/v1"
RECIPE_SCHEMA = "upstate.observed-report/v1"
NETWORK_SCHEMA = "upstate.receptor-network-product/v1"
PREPARED_SCHEMA = "upstate.receptor-scenario-areas/v1"
SCOPE = "Original watershed topology and prepared source geometry"
ROOT = "receptor-report-sources"
NETWORK_ROOT = "receptor-networks"
PREPARED_ROOT = "receptor-scenario-areas"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Source-water transfer needs an original relative member path")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("Source-water members must retain their original directories")
    return value


def _same_file(first, second):
    return all(first.get(field) == second.get(field) for field in ("bytes", "sha256"))


def _body(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _members(closure, entry):
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item.get("filename")))
        if name in members:
            raise ValueError("Source-water report repeats an original companion: " + name)
        closure.add_file(item["object"], item)
        members[name] = item
    return members


def _product(captured, key, schema):
    if (captured.get("schema") != schema or captured.get("id") != key
            or not isinstance(captured.get("identity"), dict)
            or digest(captured["identity"]) != key
            or not isinstance(captured.get("files"), dict) or not captured["files"]):
        raise ValueError("Source-water capture changed an original product identity")
    return captured


def _captured(closure, entry):
    recipe = _body(closure, entry["body"])
    metadata = entry.get("metadata") or {}
    if (entry.get("kind") != "document" or metadata.get("report_schema") != RECIPE_SCHEMA
            or metadata.get("source_scope") != SCOPE
            or recipe.get("schema") != RECIPE_SCHEMA or recipe.get("source_scope") != SCOPE):
        raise ValueError("Source-water source differs from its original report producer")
    members = _members(closure, entry)
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise ValueError("Source-water recipe lacks its captured original inputs")
    requested = set()
    for item in inputs:
        name = _relative(item["path"])
        if name in requested or name not in members or not _same_file(item, members[name]):
            raise ValueError("Source-water recipe changed an original input: " + name)
        requested.add(name)

    def original(name):
        if name not in requested:
            raise ValueError("Source-water recipe lacks its original " + name)
        return _body(closure, members[name])

    provenance = original("provenance.json")
    identity = provenance.get("identity")
    if not isinstance(identity, dict):
        raise ValueError("Source-water provenance lacks its original identity")
    key = identifier(provenance.get("report_id"))
    selection = identity.get("selection")
    project = identity.get("workspace_id")
    if (provenance.get("schema") != "upstate.receptor-report-provenance/v1"
            or identity.get("schema") != SCHEMA or digest(identity) != key
            or identity.get("version") not in (1, 2)
            or not isinstance(project, str) or not project
            or not isinstance(selection, dict)
            or recipe.get("title") != selection.get("title")
            or entry.get("id") != "source-water-geography-" + key[:24]
            or entry.get("uri") != "urn:sha256:" + key):
        raise ValueError("Source-water report changed its immutable captured identity")
    network_id = identifier(selection.get("network_id"))
    preparation_id = selection.get("preparation_id")
    if preparation_id is not None:
        preparation_id = identifier(preparation_id)
    if (provenance.get("network_id") != network_id
            or provenance.get("preparation_id") != preparation_id
            or metadata.get("network_result_id") != network_id
            or metadata.get("preparation_id") != preparation_id):
        raise ValueError("Source-water report changed its original network/preparation")
    if not _same_file(identity.get("network_result") or {}, members.get("network/result.json") or {}):
        raise ValueError("Source-water report lost its exact original network record")
    network = _product(original("network/result.json"), network_id, NETWORK_SCHEMA)
    prepared = None
    if preparation_id is not None:
        if not _same_file(identity.get("prepared_result") or {}, members.get("prepared/result.json") or {}):
            raise ValueError("Source-water report lost its exact original prepared-area record")
        prepared = _product(original("prepared/result.json"), preparation_id, PREPARED_SCHEMA)
        if (prepared.get("workspace_id") != project
                or prepared["identity"].get("workspace_id") != project
                or prepared.get("network_result_id") != network_id
                or prepared["identity"].get("network_result_id") != network_id
                or prepared.get("source_binding") != network.get("source_binding")):
            raise ValueError("Prepared source-water polygons changed their original source binding")
    elif identity.get("prepared_result") is not None:
        raise ValueError("Source-water report declares an unselected prepared product")
    if provenance.get("original_source_binding") != network.get("source_binding"):
        raise ValueError("Source-water report changed the original polygon source binding")
    expected = {"network/result.json": identity["network_result"]}
    for prefix, product in (("network", network), ("prepared", prepared)):
        if product is None:
            continue
        if prefix == "prepared":
            expected["prepared/result.json"] = identity["prepared_result"]
        for item in product["files"].values():
            name = prefix + "/" + _relative(item["path"])
            descriptor = {field: item[field] for field in ("bytes", "sha256")}
            if name in expected and expected[name] != descriptor:
                raise ValueError("Source-water product declares conflicting original members")
            expected[name] = descriptor
    if identity.get("source_members") != expected:
        raise ValueError("Source-water identity differs from its complete original product inventory")
    for name, descriptor in expected.items():
        if name not in requested or not _same_file(descriptor, members.get(name) or {}):
            raise ValueError("Source-water source lost a complete original product member: " + name)
    return key, identity, recipe, members, network, prepared


def _collection(closure, collection_id, source_id):
    key = identifier(collection_id)
    value = closure.read("sources/" + key + ".json")
    if value.get("schema") != "upstate.sources/v1" or digest(value) != key:
        raise ValueError("Source-water transfer changed an original source collection")
    entries = [entry for entry in value.get("entries", []) if entry.get("id") == source_id]
    if len(entries) != 1:
        raise ValueError("Source-water transfer needs its exact original source entry")
    closure.need("sources", key, "Editable original source-water product")
    return entries[0]


def _same_entry(closure, first, second):
    if (any(first.get(field) != second.get(field) for field in
            ("id", "kind", "title", "uri", "vintage", "metadata"))
            or not _same_file(first["body"], second["body"])):
        return False
    a, b = _members(closure, first), _members(closure, second)
    return set(a) == set(b) and all(_same_file(a[name], b[name]) for name in a)


def _local_product(closure, root, product, captured_record):
    prefix = root + "/" + identifier(product["id"]) + "/"
    closure.add_file(prefix + "result.json", captured_record)
    if closure.read(prefix + "result.json") != product:
        raise ValueError("Editable source-water product differs from its captured original")
    for item in product["files"].values():
        closure.add_file(prefix + _relative(item["path"]), item)
    closure.tree(prefix.rstrip("/"))


def _local_capture(closure, entry, key, identity, recipe, members, network, prepared):
    prefix = ROOT + "/" + key + "/"
    result = closure.read(prefix + "result.json")
    if (result.get("schema") != SCHEMA or result.get("id") != key
            or result.get("identity") != identity
            or result.get("workspace_id") != closure.workspace.project["id"]
            or result.get("selection") != identity["selection"]
            or result.get("network_result_id") != network["id"]
            or result.get("preparation_id") != (prepared["id"] if prepared else None)
            or result.get("source_binding") != network["source_binding"]
            or result.get("state") != "complete"):
        raise ValueError("Editable source-water report differs from its captured original")
    files = result.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("Editable source-water report lacks its original inventory")
    for item in files.values():
        closure.add_file(prefix + _relative(item["path"]), item)
    if (files.get("recipe", {}).get("path") != "observed-report.json"
            or not _same_file(files["recipe"], entry["body"])
            or closure.read(prefix + "observed-report.json") != recipe):
        raise ValueError("Editable source-water report changed its retained recipe")
    for name, item in members.items():
        closure.add_file(prefix + name, item)
    choice = result.get("source_choice") or {}
    collection_id = identifier(choice.get("source_collection_id"))
    if (choice.get("source_id") != entry["id"]
            or result.get("source_collection_id") != collection_id):
        raise ValueError("Editable source-water report lost its original source choice")
    original_entry = _collection(closure, collection_id, choice["source_id"])
    if not _same_entry(closure, original_entry, entry):
        raise ValueError("Editable source-water report changed its source edition or companions")
    closure.tree(prefix.rstrip("/"))
    _local_product(closure, NETWORK_ROOT, network, members["network/result.json"])
    if prepared is not None:
        _local_product(closure, PREPARED_ROOT, prepared, members["prepared/result.json"])
        for area in prepared["areas"]:
            vector = _collection(closure, prepared["source_collection_id"], area["source_id"])
            descriptor = prepared["files"][area["file_key"]]
            if vector.get("kind") != "vector" or not _same_file(vector["body"], descriptor):
                raise ValueError("Editable prepared area changed its original polygon body")
    # Explicit source collection references, when retained by the original
    # producer, remain ordinary source dependencies. Never guess a domain ID.
    closure._source_refs(network.get("source_binding"), "Original source-water polygon binding")
    closure._source_refs(network["identity"].get("receptor_spec"),
                         "Original source-water profile/source selection")
    return result


def include_source(closure, collection_id, entry):
    """Include this producer only for an explicitly selected scientific source."""
    metadata = entry.get("metadata") or {}
    if (metadata.get("source_scope") != SCOPE
            and not str(entry.get("id", "")).startswith("source-water-geography-")):
        return False
    identifier(collection_id)
    key, identity, recipe, members, network, prepared = _captured(closure, entry)
    same_project = identity["workspace_id"] == closure.workspace.project["id"]
    local_root = closure.root / ROOT / key
    editable = same_project and local_root.exists()
    if editable:
        _local_capture(closure, entry, key, identity, recipe, members, network, prepared)
    # Old selected-source archives did not retain these product directories.
    # Their complete captured original files are still usable. A new editable
    # receipt requires its exact same-project lineage on independent reopen.
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": identity["workspace_id"],
        "report_context_kind": "source_water_report",
        "source_water_report_id": key,
        "network_result_id": network["id"],
        "preparation_id": prepared["id"] if prepared else None,
        "producer_version": identity["version"],
        "selection": deepcopy(identity["selection"]),
        "original_source_binding": deepcopy(network["source_binding"]),
        "captured_product_files": deepcopy(identity["source_members"]),
        "relationship": ("same_project" if editable else
                         "source_only" if same_project else "external_project"),
        "editable_products": bool(editable),
        "required_records": ([{"kind": ROOT, "id": key},
                              {"kind": NETWORK_ROOT, "id": network["id"]}]
                             + ([{"kind": PREPARED_ROOT, "id": prepared["id"]}]
                                if prepared else [])) if editable else [],
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    if previous is not None and previous != binding:
        raise ValueError("Source-water lineage changed during selected Study capture")
    closure.report_source_records[token] = binding
    return True


def lock_paths(closure):
    """Lock only the original editable products retained by this exact source."""
    paths = set()
    for binding in closure.report_source_records.values():
        if (binding.get("report_context_kind") != "source_water_report"
                or binding.get("relationship") != "same_project"
                or not binding.get("editable_products")):
            continue
        paths.add(ROOT + "/" + identifier(binding["source_water_report_id"]) + "/.report.lock")
        paths.add(NETWORK_ROOT + "/" + identifier(binding["network_result_id"]) + "/.network.lock")
        if binding.get("preparation_id") is not None:
            paths.add(PREPARED_ROOT + "/" + identifier(binding["preparation_id"]) + "/.prepare.lock")
    return sorted(paths)


def verify_received(workspace, report_id=None):
    """Reopen retained editable products after the normal selected Study restore."""
    from .common import read_json
    from . import receptor_report_source, receptor_scenarios, study_transfer

    if report_id is not None:
        report_id = identifier(report_id)
    studies = study_transfer.verify_received_studies(workspace)
    rows = []
    seen = set()
    for study in studies:
        receipt = read_json(workspace.root / "study-transfers" / (study["id"] + ".json"))
        for binding in receipt["identity"].get("scientific_report_sources", []):
            if binding.get("report_context_kind") != "source_water_report":
                continue
            key = identifier(binding["source_water_report_id"])
            if report_id is not None and key != report_id:
                continue
            token = (study["id"], binding["source_collection_id"], binding["source_id"])
            if token in seen:
                continue
            seen.add(token)
            row = {"study_id": study["id"], "report_id": key,
                   "relationship": binding["relationship"],
                   "editable_products": binding["editable_products"],
                   "source_collection_id": binding["source_collection_id"],
                   "source_id": binding["source_id"],
                   "network_result_id": binding["network_result_id"],
                   "preparation_id": binding["preparation_id"],
                   "identity": "MATCH"}
            if binding["editable_products"]:
                result = receptor_report_source.inspect(workspace, key)
                _, network, _ = receptor_scenarios._network(workspace, binding["network_result_id"])
                preparation = (receptor_scenarios.inspect(workspace, binding["preparation_id"])
                               if binding["preparation_id"] is not None else None)
                row.update(source_choice=result["source_choice"],
                           original_source_binding=network["source_binding"],
                           prepared_source_collection_id=(preparation["source_collection_id"]
                                                          if preparation else None),
                           areas=[{"id": area["id"], "huc12_count": area["huc12_count"]}
                                  for area in (preparation or network)["areas"]])
            rows.append(row)
    if report_id is not None and not rows:
        raise ValueError("No retained typed source-water Study receipt selects that report")
    return {"schema": "upstate.source-water-study-receiving/v1",
            "project_id": workspace.project["id"], "workspace": str(workspace.root),
            "studies": studies, "source_water_reports": rows}


def main(argv=None):
    import argparse
    import json
    from .workspace import Workspace

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Normally restored selected Study Workspace")
    parser.add_argument("--report-id", help="Require this exact retained source-water report")
    args = parser.parse_args(argv)
    print(json.dumps(verify_received(Workspace(args.workspace), args.report_id),
                     indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()

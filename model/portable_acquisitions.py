"""Retain original source acquisitions through the scientific Workspace archive.

Archive extraction already verifies every byte. This module checks the original
operation relationships against that same member inventory, without importing
GIS libraries, re-querying a provider, or changing a scientific selection.
"""
from __future__ import annotations

import hashlib
from pathlib import Path, PurePosixPath
import re

from .common import canonical, read_json

ROOT = "soil-floodplain-sources"
ID = re.compile(r"[0-9a-f]{64}")


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("A source acquisition contains an invalid retained path")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts
            or any(part in ("", ".", "..") for part in path.parts)
            or path.as_posix() != value):
        raise ValueError("A source acquisition path leaves its original Workspace")
    return path


def capture_lock_paths(workspace_root):
    """Create lock paths for prepared operations as well as existing locks."""
    root = Path(workspace_root) / ROOT
    if not root.exists():
        return []
    if root.is_symlink() or not root.is_dir():
        raise ValueError("The source acquisition bank must be an ordinary directory")
    result = []
    for folder in sorted(root.iterdir()):
        if not ID.fullmatch(folder.name):
            continue
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError("A retained source acquisition must be an ordinary directory")
        result.append(folder / ".capture.lock")
    return result


def verify_acquisitions(workspace_root, members, *, source_ids=None):
    """Check captured lineage using verified archive member identities.

    Historical reuse ledgers describe bytes at transfer time. Working receipts
    may subsequently be finalized by their original HTTP client; their immutable
    original-receipt companions carry the unchanged transfer identity.
    """
    root = Path(workspace_root)
    prefix = "workspace/" + ROOT + "/"
    keys = sorted({name[len(prefix):].split("/", 1)[0]
                   for name in members if name.startswith(prefix)
                   and ID.fullmatch(name[len(prefix):].split("/", 1)[0])})
    if not keys:
        return {"schema": "upstate.source-acquisition-receiving/v1",
                "operations": [], "operation_count": 0, "continuation_count": 0}

    def member(relative, expected=None):
        path = _relative(relative)
        name = "workspace/" + path.as_posix()
        actual = members.get(name)
        if not isinstance(actual, dict):
            raise ValueError("The archive omits an original acquisition file: " + relative)
        if expected is not None and any(expected.get(field) != actual.get(field)
                                        for field in ("bytes", "sha256")):
            raise ValueError("An acquisition descriptor differs from its archived bytes: " + relative)
        return root.joinpath(*path.parts)

    def document(relative):
        value = read_json(member(relative))
        if not isinstance(value, dict):
            raise ValueError("An original acquisition record must be a JSON object: " + relative)
        return value

    def exists(relative):
        return "workspace/" + relative in members

    def descriptor(value, base=""):
        if not isinstance(value, dict):
            raise ValueError("An acquisition file must retain its original descriptor")
        relative = _relative(value.get("path")).as_posix()
        return member(base + relative, value)

    def collections(value):
        result = {}
        for field in ("source_collection_id", "original_source_collection_id"):
            key = value.get(field)
            if key is None:
                continue
            if not isinstance(key, str) or not key:
                raise ValueError("An acquisition identifies an invalid imported source edition")
            if source_ids is not None and key not in source_ids:
                raise ValueError("The received acquisition lacks its original imported edition: " + key)
            result[field] = key
        return result

    operation_members = {key: [] for key in keys}
    for name in sorted(members):
        if name.startswith(prefix):
            key = name[len(prefix):].split("/", 1)[0]
            if key in operation_members:
                operation_members[key].append(name)
    selected, states, summaries = {}, {}, {}
    for key in keys:
        base = ROOT + "/" + key + "/"
        if not exists(base + "selection.json"):
            # An older interrupted creator may have published only staging files.
            # Preserve those bytes; there is no committed operation to reinterpret.
            if exists(base + "state.json") or exists(base + "result.json"):
                raise ValueError("A retained acquisition state lacks its original selection")
            summaries[key] = {"id": key, "state": "preparing", "selection_retained": False}
            continue
        selection = document(base + "selection.json")
        if hashlib.sha256(canonical(selection)).hexdigest() != key:
            raise ValueError("The received source acquisition identity differs: " + key)
        if (selection.get("schema") != "upstate.original-soil-floodplain-acquisition/v1"
                or not isinstance(selection.get("request"), dict)
                or not isinstance(selection.get("implementation"), dict)):
            raise ValueError("The received acquisition lacks its original selection contract")
        selected[key] = selection
        if exists(base + "state.json"):
            state = document(base + "state.json")
            if state.get("id") != key:
                raise ValueError("The received source state identifies another acquisition")
        else:
            state = {"id": key, "state": "prepared"}
        states[key] = state
        editions = collections(state)
        for item in state.get("publication_history", []):
            collections(item)
        result_files = 0
        if exists(base + "result.json"):
            result = document(base + "result.json")
            if (result.get("schema") != "upstate.soil-floodplain-result/v1"
                    or result.get("id") != key):
                raise ValueError("The received source result identifies another acquisition")
            editions.update(collections(result))
            for value in result.get("files", {}).values():
                descriptor(value)
                result_files += 1
        for family in ("soils", "floodplains"):
            if exists(base + family + "-result.json"):
                family_result = document(base + family + "-result.json")
                if family_result.get("family") != family:
                    raise ValueError("The retained acquisition family identity differs")
                for value in family_result.get("files", []):
                    descriptor(value, base)
        for name in operation_members[key]:
            if not name.startswith("workspace/" + base + "publications/"):
                continue
            if not name.endswith(".json"):
                continue
            publication = document(name[len("workspace/"):])
            if publication.get("id") != key:
                raise ValueError("A source publication identifies another acquisition")
            collections(publication)
            for value in publication.get("files", {}).values():
                descriptor(value)
        summaries[key] = {
            "id": key, "state": state.get("state", "prepared"),
            "selection_retained": True, "title": state.get("title", selection["request"].get("title")),
            "families": selection["request"].get("families", []),
            "continued_from": selection.get("continued_from"),
            "resume_operation_id": key, "retained_result_files": result_files,
            **editions,
        }

    continuations = 0
    for key, selection in selected.items():
        parent_key = selection.get("continued_from")
        seen = {key}
        child = selection
        while parent_key:
            if (not isinstance(parent_key, str) or not ID.fullmatch(parent_key)
                    or parent_key not in selected or parent_key in seen):
                raise ValueError("A source continuation has a missing or cyclic original donor")
            seen.add(parent_key)
            parent = selected[parent_key]
            for field in ("schema", "version", "request", "domain", "query_domain_wkt",
                          "query_domain_sha256", "reused_sources"):
                if child.get(field) != parent.get(field):
                    raise ValueError("The source continuation changed its original " + field)
            child, parent_key = parent, parent.get("continued_from")
        parent_key = selection.get("continued_from")
        if not parent_key:
            continue
        continuations += 1
        base = ROOT + "/" + key + "/"
        if not exists(base + "continuation.json"):
            # A successor may have been selected immediately before first capture.
            if any(name.startswith("workspace/" + base + "continuation-reuse/")
                   for name in operation_members[key]):
                raise ValueError("A reused response lacks original continuation provenance")
            continue
        provenance = document(base + "continuation.json")
        parent = selected[parent_key]
        wanted = {
            "schema": "upstate.source-acquisition-continuation/v1",
            "operation_id": key, "previous_operation_id": parent_key,
            "previous_implementation": parent["implementation"],
            "current_implementation": selection["implementation"],
            "donor_directory": ROOT + "/" + parent_key,
            "request_sha256": hashlib.sha256(canonical(selection["request"])).hexdigest(),
            "query_domain_sha256": selection.get("query_domain_sha256"),
            "previous_selection_body": parent,
        }
        if any(provenance.get(field) != value for field, value in wanted.items()):
            raise ValueError("The source continuation differs from its retained original donor")
        previous = provenance.get("previous_selection")
        if not isinstance(previous, dict) or previous.get("path") != ROOT + "/" + parent_key + "/selection.json":
            raise ValueError("A continuation points to another original selection body")
        descriptor(previous)
        for name in operation_members[key]:
            if not name.startswith("workspace/" + base + "continuation-reuse/") or not name.endswith(".json"):
                continue
            transfer = document(name[len("workspace/"):])
            if (transfer.get("schema") != "upstate.source-response-reuse/v1"
                    or transfer.get("operation_id") != key
                    or transfer.get("previous_operation_id") not in seen - {key}):
                raise ValueError("An original response transfer identifies another donor chain")
            target = _relative(transfer.get("target_directory")).as_posix()
            donor = _relative(transfer.get("donor_directory")).as_posix()
            if not donor.startswith(ROOT + "/" + transfer["previous_operation_id"] + "/"):
                raise ValueError("An original response transfer leaves its retained donor")
            marker = document(base + target + "/continuation-origin.json")
            if marker != transfer:
                raise ValueError("The original response transfer marker differs from its ledger")
            original_name = transfer.get("original_receipt_file")
            original_path = _relative(original_name).as_posix()
            if "/" in original_path:
                raise ValueError("An original response receipt leaves its request directory")
            originals = [item for item in transfer.get("files", [])
                         if isinstance(item, dict) and item.get("path") == original_path]
            if len(originals) != 1:
                raise ValueError("An original response transfer lacks its immutable receipt companion")
            descriptor(originals[0], base + target + "/")
    return {
        "schema": "upstate.source-acquisition-receiving/v1",
        "operations": [summaries[key] for key in keys],
        "operation_count": len(keys), "continuation_count": continuations,
    }

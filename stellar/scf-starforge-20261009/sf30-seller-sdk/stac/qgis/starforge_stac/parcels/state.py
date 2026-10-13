# SPDX-License-Identifier: MIT
"""Parcel extension validation and complete original workspace file closure."""
from __future__ import annotations
import copy
from pathlib import Path
from ..model import require, descriptor, HASH, REQUEST

SCHEMA = "starforge.qgis-parcel-workspace.v1"
MODULES = ("__init__.py", "intake.py", "state.py", "workspace.py", "portfolio.py", "projection.py", "review.py", "operator.py", "formats.py", "capture/__init__.py", "capture/providers.py", "capture/workspace.py", "capture/__main__.py", "capture/OPERATIONS.md")

def empty_state():
    return {"schema": SCHEMA, "activeEditionId": None, "editions": [], "entities": [],
            "activeEntities": {}, "reviews": [], "portfolios": [], "successors": [], "maps": []}

def parcel_state(state):
    return state.get("parcels") or empty_state()

def _files(data):
    for edition in data["editions"]:
        yield edition["manifest"]
        yield edition["rows"]
        yield edition["index"]
        yield edition["exceptions"]
        for item in edition["inputs"]: yield item["object"]
        if edition.get("reviewIndex"): yield edition["reviewIndex"]
    for review in data["reviews"]:
        for item in review["files"]: yield item
    for portfolio in data["portfolios"]:
        for item in portfolio["files"]: yield item
    for successor in data["successors"]:
        for item in successor.get("files", []): yield item

def validate_parcels(state, *, records=None):
    data = state.get("parcels")
    if data is None: return
    require(isinstance(data, dict) and data.get("schema") == SCHEMA,
            "PARCEL_WORKSPACE_SCHEMA", "Keep the original complete parcel workspace extension.")
    for key in ("editions", "entities", "reviews", "portfolios", "successors", "maps"):
        require(isinstance(data.get(key), list) and len(data[key]) <= 100000 and
                all(isinstance(row, dict) and isinstance(row.get("id"), str) for row in data[key]) and
                len({row["id"] for row in data[key]}) == len(data[key]),
                "PARCEL_REGISTER", "Keep each complete parcel register and unique original identity.", register=key)
    editions = {row["id"]: row for row in data["editions"]}
    require(data.get("activeEditionId") is None or data["activeEditionId"] in editions,
            "PARCEL_ACTIVE_EDITION", "The selected parcel edition must belong to this workspace.")
    for identity, edition in editions.items():
        require(HASH.fullmatch(identity) and edition["manifest"]["sha256"] == identity and
                isinstance(edition.get("inputs"), list) and isinstance(edition.get("summary"), dict),
                "PARCEL_EDITION_IDENTITY", "Retain the exact original parcel source manifest and inputs.")
    entity_versions = {row["id"]: row for row in data["entities"]}
    require(isinstance(data.get("activeEntities"), dict) and
            all(version in entity_versions and entity_versions[version].get("entityId") == identity
                for identity, version in data["activeEntities"].items()),
            "PARCEL_ENTITY_IDENTITY", "Retain the selected version of every reviewed entity.")
    for review in data["reviews"]:
        require(review.get("editionId") in editions and isinstance(review.get("files"), list),
                "PARCEL_REVIEW_IDENTITY", "A saved parcel review requires its original edition and files.")
    for row in data["portfolios"]:
        require(row.get("editionId") in editions and isinstance(row.get("files"), list) and
                HASH.fullmatch(row.get("previewSha256", "")),
                "PARCEL_PORTFOLIO_IDENTITY", "A saved portfolio requires its reviewed parcel edition and exact preview.")
    for row in data["successors"]:
        require(row.get("leftEditionId") in editions and row.get("rightEditionId") in editions,
                "PARCEL_SUCCESSOR_IDENTITY", "The successor review requires both original source editions.")
    sources = {row["id"] for row in state["sources"]}
    portfolios = {row["id"] for row in data["portfolios"]}
    for row in data["maps"]:
        require(row.get("sourceId") in sources and row.get("portfolioId") in portfolios,
                "PARCEL_MAP_IDENTITY", "The parcel map requires its exact reviewed portfolio and original source.")
    seen = {}
    for raw in _files(data):
        item = descriptor(raw)
        require(item["path"].startswith("parcels/"), "PARCEL_FILE_PATH", "Keep the original parcel file namespace.")
        prior = seen.get(item["path"])
        require(prior is None or all(prior[field] == item[field] for field in ("bytes", "sha256")),
                "PARCEL_FILE_IDENTITY", "One retained parcel file has conflicting identities.", path=item["path"])
        seen[item["path"]] = item
        if records is not None:
            actual = records.get(item["path"])
            require(actual is not None and all(actual[field] == item[field] for field in ("bytes", "sha256")),
                    "PARCEL_RECEIVING_FILE", "The complete project must carry every original parcel file.",
                    path=item["path"])

def parcel_file_refs(snapshot):
    validate_parcels(snapshot["state"])
    data = snapshot["state"].get("parcels")
    if data is None: return []
    records = {item["path"]: descriptor(item) for item in _files(data)}
    return [records[name] for name in sorted(records)]

def parcel_software_files(plugin_root):
    root = Path(plugin_root).resolve(strict=True) / "parcels"
    result = {}
    for name in MODULES:
        path = root / name
        require(path.is_file() and not path.is_symlink(), "PARCEL_SOFTWARE_MISSING",
                "Keep the complete original parcel software.", path=name)
        result["starforge_stac/parcels/" + name] = path.read_bytes()
    return result

# SPDX-License-Identifier: MIT
"""Reviewed parcel GeoJSON through the original QGIS vector-source interface."""
from __future__ import annotations
import copy
from decimal import Decimal

from ..model import (require, descriptor, directory, member, file_digest, read_json,
    json_bytes, sha_bytes, value_sha, asset_key, scene_key, retain_bytes, retain_copy, utc_now)
from .intake import original_records, exact_bytes, read_exact
from .workspace import json_file
from . import portfolio

SCHEMA = "starforge.parcel-map-source.v1"
MANIFEST = "parcel-map-source.json"

def feature_properties(entry):
    return {"parcel_key": entry["parcelKey"], "review_status": entry["reviewStatus"],
            "owner_assertion": entry["owner"], "accountable_entity": entry["accountable"], "status": entry["status"],
            "ward": entry["ward"], "assessment_basis": entry["assessmentBasis"],
            "assessment_decimal": entry["assessment"],
            "assessment_value": Decimal(entry["assessment"]) if entry["assessment"] is not None else None,
            "currency": entry["currency"], "tax_year": entry["taxYear"], "assessment_as_of": entry["asOfDate"],
            "area_basis": entry["areaBasis"], "area_decimal": entry["area"],
            "area_value": Decimal(entry["area"]) if entry["area"] is not None else None,
            "area_unit": entry["areaUnit"], "decision_sha256": entry["decisionSha256"],
            "facts_sha256": entry["factsSha256"], "source_issues": "; ".join(entry["sourceIssues"])}

class ParcelMapSource:
    sourceKind = "parcel"
    manifest_name = MANIFEST

    def __init__(self, root, expected_manifest_sha256=None, progress=None, verify=True):
        self.root = directory(root)
        self.manifest, self.manifest_body = read_json(member(self.root, MANIFEST))
        self.id = self.manifest_sha256 = sha_bytes(self.manifest_body)
        require(expected_manifest_sha256 is None or expected_manifest_sha256 == self.id,
                "PARCEL_MAP_CHANGED", "The retained parcel map manifest changed.")
        value = self.manifest
        require(isinstance(value, dict) and value.get("schema") == SCHEMA and
                isinstance(value.get("files"), list) and isinstance(value.get("editionId"), str) and
                isinstance(value.get("portfolioId"), str) and isinstance(value.get("title"), str),
                "PARCEL_MAP_SCHEMA", "Use the complete reviewed parcel-map source.")
        self.files = {}
        for raw in value["files"]:
            item = descriptor(raw)
            require(item["path"] != MANIFEST and item["path"] not in self.files,
                    "PARCEL_MAP_FILE", "Retain unique original parcel map files.")
            self.files[item["path"]] = item
        require(set(self.files) == {"parcels.geojson", "portfolio.json", "lineage.json"} and
                value.get("coordinateReferenceSystem") == "EPSG:4326",
                "PARCEL_MAP_CLOSURE", "Keep the original reviewed GeoJSON, portfolio and lineage.")
        for name, record in self.files.items():
            if verify or name != "parcels.geojson":
                file_digest(member(self.root, name), expected=record, progress=progress)
        recorded_portfolio, _ = read_json(member(self.root, "portfolio.json"))
        lineage, _ = read_json(member(self.root, "lineage.json"))
        require(recorded_portfolio.get("schema") == portfolio.SCHEMA and
                recorded_portfolio.get("id") == value["portfolioId"] and
                recorded_portfolio.get("editionId") == value["editionId"] and
                recorded_portfolio.get("previewSha256") == value.get("portfolioPreviewSha256") and
                lineage.get("editionId") == value["editionId"] and
                lineage.get("portfolioId") == value["portfolioId"] and
                lineage.get("rawSourceClosure") == "original-project-package",
                "PARCEL_MAP_LINEAGE", "Retain the exact reviewed portfolio and original project source references.")
        basis = {key: item for key, item in recorded_portfolio.items()
                 if key not in ("id", "createdAt", "actor", "previewSha256")}
        require(value_sha(basis) == value["portfolioPreviewSha256"],
                "PARCEL_MAP_REVIEW", "The frozen reviewed portfolio differs from its preview identity.")
        expected = [row for row in recorded_portfolio["rows"] if row["geometryAvailable"]]
        require(type(value.get("featureCount")) is int and value["featureCount"] == len(expected),
                "PARCEL_MAP_COUNT", "The map count must match the selected original parcel geometries.")
        if verify:
            geo_body = member(self.root, "parcels.geojson").read_bytes()
            require(sha_bytes(geo_body) == self.files["parcels.geojson"]["sha256"],
                    "PARCEL_MAP_CHANGED", "The reviewed map bytes changed.")
            geo = read_exact(geo_body)
            require(isinstance(geo, dict) and geo.get("type") == "FeatureCollection" and
                    isinstance(geo.get("features"), list) and len(geo["features"]) == len(expected),
                    "PARCEL_MAP_GEOMETRY", "Keep every selected original parcel polygon.")
            for feature, row in zip(geo["features"], expected):
                require(feature.get("id") == row["parcelKey"] and
                        feature.get("properties") == feature_properties(row) and
                        sha_bytes(exact_bytes(feature.get("geometry"))) == row["geometryClaim"]["value"],
                        "PARCEL_MAP_GEOMETRY", "The displayed polygon must be the exact selected source geometry.",
                        key=row["parcelKey"])
        self.lineage = lineage
        self.edition = {"schema": SCHEMA, "id": value["editionId"], "portfolioId": value["portfolioId"]}
        self.source = {"schema": SCHEMA, "sourceKind": self.sourceKind, "title": value["title"],
            "editionId": value["editionId"], "portfolioId": value["portfolioId"],
            "selectionSha256": value["portfolioPreviewSha256"], "manifestSha256": self.id,
            "rawSourceClosure": "original-project-package"}
        self.summary = {"scenes": 1, "assets": 1, "features": value["featureCount"],
                        "selectedParcels": len(recorded_portfolio["rows"]),
                        "withoutSelectedGeometry": len(recorded_portfolio["rows"]) - value["featureCount"]}
        collection, item_id = value["editionId"], value["portfolioId"]
        scene = {"collection": collection, "id": item_id, "title": value["title"], "sourceKind": self.sourceKind}
        self.scenes = {scene_key(collection, item_id): scene}
        key = asset_key(collection, item_id, "reviewed-parcels")
        self.assets = {key: {"collection": collection, "itemId": item_id, "assetKey": "reviewed-parcels",
            "sourceKind": self.sourceKind, "file": {**self.files["parcels.geojson"], "contentType": "application/geo+json"},
            "original": {"kind": "reviewed-parcel-projection", "title": value["title"],
                         "featureCount": value["featureCount"], "portfolioId": value["portfolioId"],
                         "portfolioPreviewSha256": value["portfolioPreviewSha256"]},
            "outcome": "derived", "reason": None, "nativeLayer": None,
            "receipt": {"manifestSha256": self.id, "rawSourceClosure": "original-project-package",
                        "portfolioPreviewSha256": value["portfolioPreviewSha256"]}}}

    def validate_workspace(self, state):
        data = state.get("parcels", {})
        edition = next((row for row in data.get("editions", []) if row["id"] == self.manifest["editionId"]), None)
        original = next((row for row in data.get("portfolios", []) if row["id"] == self.manifest["portfolioId"]), None)
        require(edition is not None and original is not None and
                original["editionId"] == edition["id"] and
                original["previewSha256"] == self.manifest["portfolioPreviewSha256"],
                "PARCEL_MAP_PROJECT_REQUIRED",
                "Receive the complete original parcel project with this map's reviewed portfolio and source files.")
        file = next((row for row in original["files"] if row["path"].endswith("/portfolio.json")), None)
        require(file is not None and all(file[key] == self.files["portfolio.json"][key] for key in ("bytes", "sha256")) and
                self.lineage.get("workspaceId") == state["id"] and self.lineage.get("sourceManifest") == edition["manifest"],
                "PARCEL_MAP_LINEAGE", "The map must retain this original project's exact frozen portfolio and manifest.")
        expected = sorted((row["object"]["path"], row["object"]["bytes"], row["object"]["sha256"]) for row in edition["inputs"])
        actual = sorted((row["path"], row["bytes"], row["sha256"]) for row in self.lineage.get("originalFiles", []))
        require(actual == expected, "PARCEL_MAP_LINEAGE",
                "The map lineage must retain every exact original input in the complete parcel project.")

    def path(self, name, verify=False, progress=None):
        require(name in self.files, "PARCEL_MAP_FILE", "Select a retained file in this original parcel map.")
        path = member(self.root, name)
        if verify: file_digest(path, expected=self.files[name], progress=progress)
        return path

    def scene_rows(self):
        return [{"key": key, "sourceKind": self.sourceKind, "collection": row["collection"],
                 "itemId": row["id"], "title": row["title"], "assetCount": 1,
                 "metadataSha256": value_sha(row)} for key, row in self.scenes.items()]

    def asset_rows(self, selected_scene=None):
        result = []
        for key, value in self.assets.items():
            scene = scene_key(value["collection"], value["itemId"])
            if selected_scene is not None and selected_scene != scene: continue
            result.append({**copy.deepcopy(value), "key": key, "sceneKey": scene, "title": self.manifest["title"],
                           "kindHint": "vector", "mime": "application/geo+json", "roles": ["data"],
                           "featureCount": self.manifest["featureCount"]})
        return result

    def layer_definition(self):
        value = next(iter(self.assets.values()))
        return {"id": "parcel-" + self.id[:32], "sourceId": self.id, "kind": "vector",
                "collection": value["collection"], "itemId": value["itemId"], "assetKey": value["assetKey"],
                "vectorLayer": "", "vectorSubsetString": "", "label": self.manifest["title"],
                "visible": True, "opacity": 1}

def publish(workspace, portfolio_id, *, revision, request_id, actor, progress=None):
    payload = {"portfolioId": portfolio_id}
    previous = workspace.workspace.operation(request_id, "parcels.map.published", payload)
    if previous: return previous
    record, value = portfolio.get(workspace, portfolio_id)
    edition = workspace.edition(record["editionId"])
    index = workspace.index(edition)
    cache, features = {}, []
    for entry in value["rows"]:
        if not entry["geometryAvailable"]: continue
        row = workspace.row(edition, entry["parcelKey"], index=index)
        claim = entry["geometryClaim"]
        original = next((item for item in row["records"] if item["id"] == claim["recordId"]), None)
        require(original is not None and original["family"] == "pittsburgh-parcels-geojson",
                "PARCEL_MAP_GEOMETRY", "The reviewed geometry must retain its original provider record.")
        ref = original["references"][0]
        source_file = next(item for item in edition["inputs"]
                           if item["sha256"] == ref["fileSha256"] and item["path"] == ref["path"])
        if source_file["sha256"] not in cache:
            path = member(workspace.workspace.root, source_file["object"]["path"])
            file_digest(path, expected=source_file["object"], progress=progress)
            cache[source_file["sha256"]] = {number: geometry for number, raw, geometry in
                                             original_records(path.read_bytes(), source_file["family"])}
        geometry = cache[source_file["sha256"]][ref["row"]]
        require(sha_bytes(exact_bytes(geometry)) == claim["value"], "PARCEL_MAP_GEOMETRY",
                "The actual selected geometry differs from the frozen portfolio.", key=entry["parcelKey"])
        properties = feature_properties(entry)
        features.append({"type": "Feature", "id": entry["parcelKey"], "properties": properties, "geometry": geometry})
    require(features, "PARCEL_MAP_EMPTY", "Select at least one original geometry in the reviewed portfolio.")
    lineage = {"schema": "starforge.parcel-map-lineage.v1", "workspaceId": workspace.workspace.read()["id"],
               "editionId": edition["id"], "portfolioId": portfolio_id, "portfolioPreviewSha256": record["previewSha256"],
               "rawSourceClosure": "original-project-package", "sourceManifest": edition["manifest"],
               "originalFiles": [item["object"] for item in edition["inputs"]]}
    bodies = {"parcels.geojson": exact_bytes({"type": "FeatureCollection", "features": features}),
              "portfolio.json": json_bytes(value), "lineage.json": json_bytes(lineage)}
    files = [{"path": name, "bytes": len(body), "sha256": sha_bytes(body)} for name, body in sorted(bodies.items())]
    manifest = {"schema": SCHEMA, "editionId": edition["id"], "portfolioId": portfolio_id,
                "portfolioPreviewSha256": record["previewSha256"], "title": record["title"],
                "coordinateReferenceSystem": "EPSG:4326", "featureCount": len(features), "files": files}
    manifest_body = json_bytes(manifest); source_id = sha_bytes(manifest_body)
    base = "sources/" + source_id
    for name, body in bodies.items(): retain_bytes(workspace.workspace.root, base + "/" + name, body)
    retain_bytes(workspace.workspace.root, base + "/" + MANIFEST, manifest_body)
    source = ParcelMapSource(workspace.workspace.root / base, source_id, progress=progress)
    source_record = {"id": source_id, "path": base, "manifestSha256": source_id, "source": source.source,
                     "summary": source.summary, "importedAt": utc_now(), "actor": actor}
    map_record = {"id": "parcel-map-" + value_sha({"requestId": request_id, "sourceId": source_id}),
                  "portfolioId": portfolio_id, "editionId": edition["id"], "sourceId": source_id,
                  "at": utc_now(), "actor": actor}
    def update(state):
        data = state["parcels"]
        require(any(item["id"] == portfolio_id and item["previewSha256"] == record["previewSha256"]
                    for item in data["portfolios"]), "PARCEL_PORTFOLIO_CHANGED",
                "The original reviewed portfolio must remain present.")
        if not any(item["id"] == source_id for item in state["sources"]):
            state["sources"].append(copy.deepcopy(source_record))
        if state["activeSourceId"] is None: state["activeSourceId"] = source_id
        data["maps"].append(copy.deepcopy(map_record))
        return {"map": map_record, "source": source_record, "layer": source.layer_definition()}
    return workspace.workspace._mutate(revision, request_id, actor, "parcels.map.published", payload, update)

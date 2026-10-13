"""Read retained Esri polygon features through the original acquisition parser.

This is the source format used by the retained Upper Savannah WBD domain.
The original file stays authoritative; the index lives only in the current
SpatialReview instance and preserves original feature-array order.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path


class UnsupportedEsriGeometry(ValueError):
    """Another original Esri geometry type needs the existing GDAL reader."""


def is_esri_source(path, entry=None):
    entry = entry or {}
    declared = str(entry.get("format") or entry.get("source_format") or "").lower().replace(" ", "")
    return "esrijson" in declared or str(path).lower().endswith((".esri.json", ".esri.json.gz"))


def _crs(spatial):
    from pyproj import CRS
    if not isinstance(spatial, dict):
        raise ValueError("The original Esri source must retain its spatialReference")
    wkt = spatial.get("wkt2") or spatial.get("wkt")
    if wkt:
        return CRS.from_wkt(wkt)
    wkid = spatial.get("latestWkid") or spatial.get("wkid")
    if isinstance(wkid, bool) or not isinstance(wkid, int) or wkid <= 0:
        raise ValueError("The original Esri spatialReference must contain its actual WKT or WKID")
    try:
        return CRS.from_epsg(wkid)
    except Exception as epsg_error:
        try:
            return CRS.from_authority("ESRI", str(wkid))
        except Exception:
            raise ValueError("The retained Esri WKID cannot be resolved: " + str(wkid)) from epsg_error


class OriginalEsriFeature:
    def __init__(self, position, identity, id_basis, properties, geometry, native_geometry, operations):
        self.id = str(identity)
        self.source_feature_index = position
        self.id_basis = id_basis
        self.properties = properties
        self.source_geometry = geometry
        self.native_geometry = native_geometry
        self.geometry_operations = operations

    def __getitem__(self, key):
        if key == "properties":
            return self.properties
        if key == "geometry":
            from shapely.geometry import mapping
            return None if self.native_geometry is None else mapping(self.native_geometry)
        if key == "id":
            return self.id
        raise KeyError(key)


class OriginalEsriFeatures:
    """Current original polygon collection, its parsed geometry and native index."""

    def __init__(self, path, entry=None):
        from pyproj import CRS
        from shapely import STRtree
        from source.capture_upstream_network import esri_polygon

        path, entry = Path(path), entry or {}
        with path.open("rb") as source:
            compressed = source.read(2) == b"\x1f\x8b"
        with (gzip.open(path, "rb") if compressed else path.open("rb")) as source:
            raw = source.read()
        if entry.get("decoded_bytes") is not None and len(raw) != entry["decoded_bytes"]:
            raise ValueError("Original Esri decoded byte length differs from its retained manifest")
        decoded_sha256 = hashlib.sha256(raw).hexdigest()
        if entry.get("decoded_sha256") is not None and decoded_sha256 != entry["decoded_sha256"]:
            raise ValueError("Original Esri decoded hash differs from its retained manifest")
        document = json.loads(raw)
        if not isinstance(document, dict) or not isinstance(document.get("features"), list):
            raise ValueError("The retained Esri document must contain its original features array")
        if document.get("error"):
            raise ValueError("The retained Esri response contains a source error")
        original_features = document["features"]
        geometry_type = document.get("geometryType")
        first_geometry = next((f.get("geometry") for f in original_features
                               if isinstance(f, dict) and f.get("geometry")), None)
        if geometry_type not in (None, "esriGeometryPolygon") or first_geometry and "rings" not in first_geometry:
            raise UnsupportedEsriGeometry("This original Esri geometry type uses the existing GDAL reader")
        spatial = document.get("spatialReference")
        if spatial is None and first_geometry is not None:
            spatial = first_geometry.get("spatialReference")
        if spatial is None:
            raise ValueError("Retain the source's actual Esri spatialReference before geographic review")
        native_crs = _crs(spatial)
        declared_crs = entry.get("source_crs")
        if declared_crs and CRS.from_user_input(declared_crs) != native_crs:
            raise ValueError("The retained Esri body and source manifest declare different coordinate systems")
        self.crs_wkt = native_crs.to_wkt()
        self.crs = native_crs.to_string()
        declared_layer = entry.get("layer")
        if declared_layer is not None and (not isinstance(declared_layer, str) or not declared_layer.strip()):
            raise ValueError("The source manifest's declared Esri layer name must be text")
        self.name = declared_layer or "features"
        self.layers = [self.name]
        self.driver = "Original Esri JSON"
        self.schema = {"geometry": geometry_type or "esriGeometryPolygon", "properties": {}}
        original_fields = document.get("fields", [])
        if not isinstance(original_fields, list):
            raise ValueError("The retained Esri field declarations must remain an array")
        for field in original_fields:
            if not isinstance(field, dict) or not isinstance(field.get("name"), str):
                raise ValueError("The retained Esri field declaration has no original name")
            self.schema["properties"][field["name"]] = field.get("type") or "source scalar"
        oid = document.get("objectIdFieldName") or document.get("objectIdField")
        if not oid:
            declared_oids = [f["name"] for f in original_fields if f.get("type") == "esriFieldTypeOID"]
            if len(declared_oids) == 1:
                oid = declared_oids[0]
        if oid is not None and not isinstance(oid, str):
            raise ValueError("The retained Esri object-ID field name must be text")
        self.features = []
        indexed_geometries, self._positions = [], []
        self.bounds = None
        operation_count = 0
        for position, original in enumerate(original_features):
            if not isinstance(original, dict) or not isinstance(original.get("attributes"), dict):
                raise ValueError("Original Esri feature " + str(position) + " must retain its attributes")
            properties, raw_geometry = original["attributes"], original.get("geometry")
            for field in properties:
                self.schema["properties"].setdefault(field, "source scalar")
            if oid is not None:
                if oid not in properties or isinstance(properties[oid], bool) or not isinstance(properties[oid], (int, str)):
                    raise ValueError("Original Esri feature " + str(position) + " lacks its declared object ID")
                identity, id_basis = properties[oid], "original attribute " + oid
            elif isinstance(original.get("id"), (str, int)) and not isinstance(original.get("id"), bool):
                identity, id_basis = original["id"], "original feature id"
            else:
                identity, id_basis = position, "original zero-based features array position"
            operations, geometry = [], None
            if raw_geometry is not None:
                if not isinstance(raw_geometry, dict):
                    raise ValueError("Original Esri feature geometry must remain an object")
                feature_crs = raw_geometry.get("spatialReference")
                if feature_crs is not None and _crs(feature_crs) != native_crs:
                    raise ValueError("Original Esri feature " + str(identity) + " has a different coordinate system")
                geometry = esri_polygon(raw_geometry, operations, str(identity))
                if not geometry.is_empty:
                    if not geometry.is_valid:
                        raise ValueError("The original Esri reader returned invalid geometry for " + str(identity))
                    indexed_geometries.append(geometry)
                    self._positions.append(position)
                    b = geometry.bounds
                    self.bounds = list(b) if self.bounds is None else [
                        min(self.bounds[0], b[0]), min(self.bounds[1], b[1]),
                        max(self.bounds[2], b[2]), max(self.bounds[3], b[3])]
            operation_count += len(operations)
            self.features.append(OriginalEsriFeature(position, identity, id_basis, properties,
                                                     raw_geometry, geometry, operations))
        self._tree = STRtree(indexed_geometries) if indexed_geometries else None
        module_path = Path(esri_polygon.__code__.co_filename)
        self.reader_metadata = {
            "reader": "source/capture_upstream_network.py:esri_polygon",
            "reader_source_sha256": hashlib.sha256(module_path.read_bytes()).hexdigest(),
            "native_collection": "features",
            "declared_layer": declared_layer,
            "source_spatial_reference": spatial,
            "source_geometry_type": geometry_type,
            "source_object_id_field": oid,
            "source_fields": original_fields,
            "source_field_aliases": document.get("fieldAliases"),
            "source_has_z": document.get("hasZ"),
            "source_has_m": document.get("hasM"),
            "decoded_bytes": len(raw),
            "decoded_sha256": decoded_sha256,
            "geometry_operation_count": operation_count,
            "geometry_meaning": "Original Esri ring reader; every geometry operation is retained per feature",
            "source_order": "original zero-based features array order",
        }

    def __len__(self):
        return len(self.features)

    def __iter__(self):
        return iter(self.features)

    def filter(self, start=0, stop=None, *, bbox=None):
        if bbox is None:
            positions = range(len(self.features))
        elif self._tree is None:
            positions = []
        else:
            from shapely.geometry import box
            # STRtree supplies bbox candidates. Sorting the original positions
            # keeps continuation stable even when its native index order changes.
            positions = sorted(self._positions[int(i)] for i in self._tree.query(box(*bbox)))
        for position in positions[start:stop]:
            yield self.features[position]

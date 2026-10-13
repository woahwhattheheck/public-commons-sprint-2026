#!/usr/bin/env python3
"""Capture original WBD topology and geometry for the reviewed Upper Savannah basin."""
from __future__ import annotations
import argparse, collections, gzip, hashlib, json, os, pathlib, shutil, tempfile
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE = "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6"
HUC8 = ("03060101", "03060102", "03060103", "03060106", "03060107")
PLANNING_SHA = "133bc5369bd0d68bfdb53c61e3df24f9445f799b0d68b301f321d2c49d71eab6"
LIMIT = 64 * 1024 * 1024

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(value):
    return hashlib.sha256(value).hexdigest()

def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()

def exact_write(path, body):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Retained file has another identity: " + str(path))
        return
    with tempfile.TemporaryDirectory(prefix=".source-publish-", dir=path.parent) as temporary:
        staged = pathlib.Path(temporary) / "file"
        with staged.open("xb") as output:
            output.write(body); output.flush(); os.fsync(output.fileno())
        try:
            os.link(staged, path)
        except FileExistsError:
            if path.read_bytes() != body:
                raise
        fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)

class Capture:
    def __init__(self, root):
        self.root = pathlib.Path(root).absolute()
        self.root.mkdir(parents=True, exist_ok=True)
        self.responses = {}

    def get(self, name, parameters):
        url = BASE + "/query?" + urlencode({"f": "json", **parameters})
        folder = self.root / "responses" / name
        receipt_path = folder / "receipt.json"
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_bytes())
            if receipt["requested_url"] != url:
                raise ValueError("The retained response belongs to another exact query.")
            stored = (folder / "body.json.gz").read_bytes()
            body = gzip.decompress(stored)
            if (digest(stored) != receipt["stored_sha256"]
                    or len(stored) != receipt["stored_bytes"]
                    or digest(body) != receipt["sha256"]
                    or len(body) != receipt["bytes"]):
                raise ValueError("A retained original response changed.")
        else:
            requested_at = now()
            request = Request(url, headers={"Accept": "application/json", "Accept-Encoding": "identity",
                                          "User-Agent": "TJLabs Upper Savannah source research"})
            try:
                response = urlopen(request, timeout=60)
            except HTTPError as error:
                response = error
            with response:
                wire = response.read(LIMIT + 1)
                if len(wire) > LIMIT:
                    raise ValueError("The original response exceeds the declared 64 MiB response allowance.")
                headers = dict(response.headers.items())
                content_encoding = response.headers.get("Content-Encoding", "identity").lower()
                if content_encoding not in ("identity", "gzip"):
                    raise ValueError("The provider returned an unsupported explicit content encoding.")
                body = gzip.decompress(wire) if content_encoding == "gzip" else wire
                if len(body) > LIMIT:
                    raise ValueError("The decoded original response exceeds 64 MiB.")
                stored = gzip.compress(body, mtime=0)
                receipt = {"requested_url": url, "response_url": response.geturl(),
                           "status": response.status, "headers": headers,
                           "requested_at": requested_at, "captured_at": now(),
                           "bytes": len(body), "sha256": digest(body),
                           "stored_bytes": len(stored), "stored_sha256": digest(stored),
                           "storage_encoding": "gzip", "content_encoding": content_encoding,
                           "wire_bytes": len(wire), "wire_sha256": digest(wire)}
            parent = folder.parent
            parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="." + name + "-", dir=parent) as temporary:
                staged = pathlib.Path(temporary) / "response"
                staged.mkdir()
                exact_write(staged / "body.json.gz", stored)
                if wire != body:
                    exact_write(staged / "wire.bin", wire)
                    receipt["wire_file"] = "wire.bin"
                exact_write(staged / "receipt.json", encode(receipt))
                try:
                    os.rename(staged, folder)
                except FileExistsError:
                    raise ValueError("Another source capture published this query. Reopen its retained response.")
            print(json.dumps({"captured": name, "status": receipt["status"],
                              "bytes": receipt["bytes"], "stored_bytes": receipt["stored_bytes"]}), flush=True)
        self.responses[name] = {"folder": folder.relative_to(self.root).as_posix(), **receipt}
        if receipt["status"] != 200:
            raise ValueError("Original provider status " + str(receipt["status"]) + " retained at " + str(folder))
        value = json.loads(body)
        if "error" in value:
            raise ValueError("Original provider error retained at " + str(folder) + ": " + json.dumps(value["error"]))
        if value.get("exceededTransferLimit"):
            raise ValueError("The provider truncated this exact response; its original body is retained.")
        return value

def pages(values, size):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]

def esri_polygon(geometry, corrections, identity):
    from shapely.geometry import Polygon, GeometryCollection
    from shapely import make_valid, is_valid_reason
    if not geometry or "curveRings" in geometry or "rings" not in geometry:
        raise ValueError("Preserve and resolve the original non-linear or absent geometry for " + identity)
    combined = GeometryCollection()
    for ring in geometry["rings"]:
        polygon = Polygon(ring)
        if not polygon.is_valid:
            corrections.append({"identity": identity, "stage": "ring", "reason": is_valid_reason(polygon),
                                "analysis_operation": "Shapely make_valid; original response geometry unchanged"})
            polygon = make_valid(polygon)
        combined = combined.symmetric_difference(polygon)
    if not combined.is_valid:
        corrections.append({"identity": identity, "stage": "assembled", "reason": is_valid_reason(combined),
                            "analysis_operation": "Shapely make_valid; original response geometry unchanged"})
        combined = make_valid(combined)
    return combined

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--planning-source", required=True)
    parser.add_argument("--reference-wbd-source", required=True)
    args = parser.parse_args()
    capture = Capture(args.output)
    output = capture.root
    completed = output / "capture.json"
    if completed.exists():
        retained = json.loads(completed.read_bytes())
        if retained.get("schema") != "upstate.wbd-network-capture/v1":
            raise ValueError("This output belongs to another source capture.")
        for item in retained["files"]:
            body = (output / item["path"]).read_bytes()
            if len(body) != item["bytes"] or digest(body) != item["sha256"]:
                raise ValueError("A completed native capture member changed: " + item["path"])
        print(json.dumps({"complete": True, "reused": True, "source_root": str(output),
                          "manifest_sha256": digest(completed.read_bytes()),
                          "retained_bytes": retained["retained_bytes"]}), flush=True)
        return
    planning = pathlib.Path(args.planning_source).absolute()
    reference = pathlib.Path(args.reference_wbd_source).absolute()
    original_shp = (planning / "PlanningBasins2023.shp").read_bytes()
    if digest(original_shp) != PLANNING_SHA:
        raise ValueError("Use the retained original PlanningBasins2023 shapefile.")
    import shapefile, pyproj
    from shapely.geometry import shape
    from shapely.ops import transform
    reader = shapefile.Reader(str(planning / "PlanningBasins2023.shp"))
    selected = [(index + 1, record) for index, record in enumerate(reader.iterShapeRecords())
                if record.record.as_dict().get("Basin") == "Upper Savannah"]
    if len(selected) != 1 or selected[0][0] != 5:
        raise ValueError("The original source must select exactly Upper Savannah native record 5.")
    reporting = shape(selected[0][1].shape.__geo_interface__)
    planning_crs = pyproj.CRS.from_wkt((planning / "PlanningBasins2023.prj").read_text())
    layer_raw = gzip.decompress((reference / "layer-6.json.gz").read_bytes())
    layer = json.loads(layer_raw)
    fields = {f["name"].lower(): f["name"] for f in layer["fields"]}
    oid = next(f["name"] for f in layer["fields"] if f["type"] == "esriFieldTypeOID")
    huc, downstream = fields["huc12"], fields["tohuc"]
    source_crs = layer["extent"]["spatialReference"]
    wkid = source_crs.get("latestWkid") or source_crs["wkid"]
    projection = pyproj.Transformer.from_crs(pyproj.CRS.from_epsg(wkid), planning_crs, always_xy=True).transform
    exact_write(output / "reference" / "layer-6.json.gz", (reference / "layer-6.json.gz").read_bytes())
    reference_manifest = json.loads((reference / "capture.json").read_bytes())
    layer_receipt = next(r for r in reference_manifest["responses"] if r["file"] == "layer-6.json.gz")
    exact_write(output / "reference" / "layer-6.receipt.json", encode(layer_receipt))
    where = huc + " LIKE '030601%'"
    count = capture.get("savannah-count", {"where": where, "returnCountOnly": "true"})["count"]
    id_response = capture.get("savannah-ids", {"where": where, "returnIdsOnly": "true"})
    ids = sorted(id_response["objectIds"])
    if len(ids) != count or len(set(ids)) != len(ids):
        raise ValueError("Native count and complete unique object-ID response differ.")
    attributes, by_huc = {}, {}
    def add_attributes(requested, name):
        result = capture.get(name, {"objectIds": ",".join(map(str, requested)),
                                  "outFields": "*", "returnGeometry": "false"})
        records = result["features"]
        if {f["attributes"][oid] for f in records} != set(requested) or len(records) != len(requested):
            raise ValueError("The original attribute page does not contain its exact requested ID set.")
        for feature in records:
            row = feature["attributes"]; key = str(row[huc])
            if row[oid] in attributes and attributes[row[oid]] != row:
                raise ValueError("The same original object ID has two attribute editions in this capture.")
            if key in by_huc and by_huc[key] != row[oid]:
                raise ValueError("The native HUC12 identity is not unique.")
            attributes[row[oid]] = row; by_huc[key] = row[oid]
    for index, group in enumerate(pages(ids, 1000)):
        add_attributes(group, "savannah-attributes-%04d" % index)
    geometry_locations, projected, source_geometry = {}, {}, {}
    corrections = []
    focus_path = reference / "selected-four-huc12.json.gz"
    if focus_path.exists():
        original_focus = json.loads(gzip.decompress(focus_path.read_bytes()))
        focus_receipt = next(r for r in reference_manifest["responses"] if r["file"] == focus_path.name)
        reusable = [f for f in original_focus["features"]
                    if attributes.get(f["attributes"][oid]) == f["attributes"]]
        if reusable:
            exact_write(output / "reference" / focus_path.name, focus_path.read_bytes())
            exact_write(output / "reference" / "selected-four-huc12.receipt.json", encode(focus_receipt))
        for index, feature in enumerate(original_focus["features"]):
            row = feature["attributes"]; identity = row[oid]
            if attributes.get(identity) != row: continue
            geometry = esri_polygon(feature["geometry"], corrections, str(row[huc]))
            source_geometry[identity] = geometry
            projected[identity] = transform(projection, geometry)
            geometry_locations[identity] = {"file": "reference/" + focus_path.name,
                                            "feature_index": index, "captured_at": focus_receipt["captured_at"],
                                            "reused_original_response": True}
    def acquire_geometry(requested, label):
        missing = sorted(set(requested) - set(geometry_locations))
        for index, group in enumerate(pages(missing, 50)):
            name = label + "-%04d" % index
            result = capture.get(name, {"objectIds": ",".join(map(str, group)), "outFields": "*",
                                       "returnGeometry": "true", "returnTrueCurves": "true"})
            rows = result["features"]
            if {f["attributes"][oid] for f in rows} != set(group) or len(rows) != len(group):
                raise ValueError("The native geometry page does not contain exactly its requested IDs.")
            spatial = result.get("spatialReference", source_crs)
            if (spatial.get("latestWkid") or spatial.get("wkid")) != wkid:
                raise ValueError("The source geometry CRS changed between its native contract and response.")
            for position, feature in enumerate(rows):
                row = feature["attributes"]; identity = row[oid]
                if attributes[identity] != row:
                    raise ValueError("Original attributes changed between topology and geometry acquisition; both responses are retained.")
                geometry = esri_polygon(feature["geometry"], corrections, str(row[huc]))
                source_geometry[identity] = geometry
                projected[identity] = transform(projection, geometry)
                geometry_locations[identity] = {"file": "responses/" + name + "/body.json.gz",
                                               "feature_index": position,
                                               "captured_at": capture.responses[name]["captured_at"]}
    candidate_ids = [identity for identity, row in attributes.items() if str(row[huc])[:8] in HUC8]
    acquire_geometry(candidate_ids, "reporting-context-geometry")
    intersections = {str(attributes[i][huc]): projected[i].intersection(reporting).area
                     for i in candidate_ids if projected[i].intersects(reporting)}
    intersections = {key: value for key, value in intersections.items() if value > 0}
    if not intersections:
        raise ValueError("The reviewed basin did not intersect its published HUC12 context.")
    def closure():
        reverse = collections.defaultdict(list)
        for row in attributes.values():
            reverse[str(row[downstream])].append(str(row[huc]))
        selected, frontier = set(intersections), list(intersections)
        while frontier:
            key = frontier.pop()
            for ancestor in reverse.get(key, ()):
                if ancestor not in selected: selected.add(ancestor); frontier.append(ancestor)
        return selected
    selected_hucs, checked_external = closure(), set()
    # Retain a provider check for incoming edges outside the named Savannah HUC6.
    # New external ancestors, if present, become ordinary source rows and are followed.
    while selected_hucs - checked_external:
        frontier = sorted(selected_hucs - checked_external)
        for group in pages(frontier, 80):
            selection = downstream + " IN (" + ",".join("'" + key + "'" for key in group) + ")"
            selection += " AND " + huc + " NOT LIKE '030601%'"
            token = digest(selection.encode())[:20]
            result = capture.get("outside-incoming-ids-" + token,
                                 {"where": selection, "returnIdsOnly": "true"})
            outside = sorted(set(result.get("objectIds") or []) - set(attributes))
            for index, incoming in enumerate(pages(outside, 1000)):
                add_attributes(incoming, "outside-attributes-" + token + "-%04d" % index)
            checked_external.update(group)
        selected_hucs = closure()
    selected_ids = [by_huc[key] for key in sorted(selected_hucs)]
    acquire_geometry(selected_ids, "upstream-ancestor-geometry")
    records = []
    for key in sorted(selected_hucs):
        identity = by_huc[key]; row = attributes[identity]
        records.append({"huc12": key, "object_id": identity, "tohuc": str(row[downstream]),
                        "reporting_intersection_m2": intersections.get(key, 0),
                        "intersects_reporting_area": key in intersections,
                        "upstream_ancestor": key not in intersections,
                        "geometry": geometry_locations[identity]})
    source_rows = [{"object_id": identity, "attributes": attributes[identity]}
                   for identity in sorted(attributes)]
    exact_write(output / "topology-records.json", encode({"schema": "upstate.wbd-topology-records/v1",
                "object_id_field": oid, "huc12_field": huc, "tohuc_field": downstream,
                "records": source_rows}))
    selection = {"schema": "upstate.wbd-upstream-selection/v1",
                 "reporting_source": {"edition": "PlanningBasins2023", "shapefile_sha256": PLANNING_SHA,
                                      "field": "Basin", "value": "Upper Savannah", "native_record_number": 5,
                                      "crs": planning_crs.to_string(), "area_m2": reporting.area},
                 "source_crs": source_crs, "initial_huc8_context": list(HUC8),
                 "savannah_huc6_record_count": count,
                 "all_topology_record_count": len(attributes),
                 "reporting_intersection_count": len(intersections),
                 "model_huc12_count": len(records), "selected_huc12": records,
                 "captured_geometry_count": len(geometry_locations),
                 "area_method": "Positive GEOS polygon intersection in the original PlanningBasins2023 projected metre CRS; boundary-only touches excluded.",
                 "upstream_method": "Reverse traversal of every original ToHUC edge, starting at reporting intersections, including native incoming-edge checks outside Savannah HUC6.",
                 "analysis_geometry_corrections": corrections}
    exact_write(output / "network-selection.json", encode(selection))
    entries = []
    for name, response in capture.responses.items():
        relative = response["folder"] + "/body.json.gz"
        is_geometry = "returnGeometry=true" in response["requested_url"]
        entries.append({"id": "usgs-wbd-network-" + name, "title": "Original USGS WBD " + name,
                        "kind": "vector" if is_geometry else "document",
                        "path": relative, "sha256": response["stored_sha256"],
                        "bytes": response["stored_bytes"], "encoding": "gzip",
                        "decoded_sha256": response["sha256"], "decoded_bytes": response["bytes"],
                        "uri": response["requested_url"], "vintage": response["captured_at"],
                        "source_crs": "EPSG:" + str(wkid), "source_format": "Esri JSON",
                        "role": "HYDROLOGIC_GEOMETRY" if is_geometry else "HYDROLOGIC_TOPOLOGY",
                        "companions": [{"path": response["folder"] + "/receipt.json",
                                        "sha256": digest((output / response["folder"] / "receipt.json").read_bytes())}]})
    for name in ("network-selection.json", "topology-records.json"):
        entries.append({"id": "usgs-wbd-" + name.removesuffix(".json"),
                        "title": "Native source-derived " + name, "kind": "document", "path": name,
                        "sha256": digest((output / name).read_bytes()), "uri": BASE,
                        "vintage": max(item["captured_at"] for item in capture.responses.values())})
    reused_focus = output / "reference" / "selected-four-huc12.json.gz"
    if reused_focus.exists():
        entries.append({"id": "usgs-wbd-network-original-focus", "title": "Reused original four-focus response",
                        "kind": "vector", "path": "reference/" + reused_focus.name,
                        "sha256": digest(reused_focus.read_bytes()), "encoding": "gzip",
                        "source_crs": "EPSG:" + str(wkid), "source_format": "Esri JSON",
                        "uri": focus_receipt["requested_url"], "vintage": focus_receipt["captured_at"],
                        "role": "HYDROLOGIC_GEOMETRY",
                        "companions": [{"path": "reference/selected-four-huc12.receipt.json",
                                        "sha256": digest((output / "reference/selected-four-huc12.receipt.json").read_bytes())}]})
    exact_write(output / "sources.json", encode({"schema": "upstate.sources/v1",
                "title": "Original USGS WBD upstream network and selected native geometry",
                "captured_at": max(item["captured_at"] for item in capture.responses.values()),
                "scope": {"reporting_source_id": "planning-basins2023",
                          "reporting_filter": {"field": "Basin", "equals": "Upper Savannah"},
                          "network_selection": "network-selection.json"},
                "notes": "All original source pages remain separate. The selected model HUC12 IDs and their exact geometry locators are in network-selection.json.",
                "entries": entries}))
    files = []
    for path in sorted(output.rglob("*")):
        if path.is_file() and not any(part.startswith(".") for part in path.relative_to(output).parts):
            body = path.read_bytes()
            files.append({"path": path.relative_to(output).as_posix(), "bytes": len(body), "sha256": digest(body)})
    manifest = {"schema": "upstate.wbd-network-capture/v1", "source_url": BASE,
                "request": {"huc6_prefix": "030601", "reporting_basin": "Upper Savannah",
                            "initial_huc8_geometry": list(HUC8), "planning_sha256": PLANNING_SHA},
                "responses": list(capture.responses.values()), "files": files,
                "selection_file": "network-selection.json",
                "topology_file": "topology-records.json",
                "retained_bytes": sum(f["bytes"] for f in files),
                "python_geometry": {"shapely": __import__("shapely").__version__,
                                    "pyproj": pyproj.__version__, "pyshp": shapefile.__version__}}
    exact_write(output / "capture.json", encode(manifest))
    print(json.dumps({"complete": True, "source_root": str(output),
                      "manifest_sha256": digest((output / "capture.json").read_bytes()),
                      "files": len(files) + 1, "retained_bytes": manifest["retained_bytes"],
                      "topology_records": len(attributes), "reporting_intersections": len(intersections),
                      "model_huc12": len(records), "geometry_records": len(geometry_locations)}), flush=True)

if __name__ == "__main__":
    main()

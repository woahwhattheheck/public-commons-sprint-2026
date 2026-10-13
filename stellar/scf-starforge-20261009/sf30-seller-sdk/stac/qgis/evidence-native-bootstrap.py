#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Prepare the original Bloomington GIS workspace for the evidence receiving course.

No source downloads, provider requests, listener or browser are started here.
The accepting worker supplies the retained originals and its installed runtimes.
"""
from __future__ import annotations

import argparse
import collections
import copy
from decimal import Decimal
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import signal
import sys
import tempfile
import uuid

OPERATION = "LANDSAGE-PARCEL-EVIDENCE-OPERATOR-103D-20261013"
SCHEMA = "commons.landsage-native-bootstrap/v1"
NAMESPACE = uuid.UUID("9b5d86dd-c287-5d4f-9e15-e3effb6c7f76")
VECTOR_FILES = ("__init__.py", "common.py", "capture.py", "driver.py",
                "materialize.py", "comparison.py", "archive.py", "engine.py")
EXPECTED = {
    "parcel": (2489, "3c7b30af07053862a87ea4b1a1639364e8f983576b02a2febe7339b2b94adcbf"),
    "metadata": (16132, "c1cdce8b8834fbb83041553f6f7c67dcd0d5620a3f73141cf5384f3a91fbdf07"),
    "floodContract": (117356, "555730fb7285ec5740d88b674583ff3be4dbbdc8c1b57f8b7964e44b3204d6f2"),
    "floodContractSuperseded": (116698, "309262f21b9920285301137c883388c8148f45301ebd8bab24648fe10435b867"),
    "dnrGeometry": (4400973, None), "femaGeometry": (2840253, None),
}
LAYERS = (
    ("parcel", "state_parcel_id", "530533210083000005", 4326, "Public example parcel"),
    ("femaGeometry", "FLD_AR_ID", "18105C_607", 4269, "FEMA effective hazard source"),
    ("dnrGeometry", "fld_ar_id", "01216S3_4501", 26916, "Indiana DNR best available source"),
)


def check(value, message):
    if not value:
        raise ValueError(message)


def body(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def measured(data):
    return {"bytes":len(data), "sha256":hashlib.sha256(data).hexdigest()}


def read(path, limit=128 * 1024 * 1024):
    path = Path(path).expanduser().absolute()
    check(path.is_file() and not path.is_symlink(), "Select an ordinary original file: " + str(path))
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    named = path.stat()
    fields = lambda stat:(stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    check(fields(before) == fields(after) == fields(named) and len(data) == before.st_size
          and len(data) <= limit, "The original file changed or exceeds its bound: " + str(path))
    return data


def document(path):
    return json.loads(read(path), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def keep(root, relative, data):
    from starforge_stac.model import retain_bytes
    return retain_bytes(root, relative, data)


def descriptor(root, path):
    return {"path":Path(path).relative_to(root).as_posix(), **measured(read(path))}


def verify_files(root, records):
    for record in records:
        relative = Path(record["path"])
        check(not relative.is_absolute() and ".." not in relative.parts,
              "A retained local output has an unsafe path.")
        check(measured(read(root / relative)) == {key:record[key] for key in ("bytes", "sha256")},
              "A retained original output changed: " + record["path"])


def vector_root(app):
    for candidate in (app / "vector", app.parent / "vector"):
        if all((candidate / name).is_file() and not (candidate / name).is_symlink() for name in VECTOR_FILES):
            return candidate.resolve()
    raise ValueError("Retain the complete original stac/vector Python producer beside this QGIS source.")


def vector_api(app):
    root = vector_root(app)
    name = "_landsage_original_native_vector"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, root / "__init__.py",
                                                      submodule_search_locations=[str(root)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name], sys.modules[name + ".common"], root


def exact_decimal(value):
    check(type(value) in (int, float, Decimal) and not isinstance(value, bool),
          "Retain a finite original coordinate.")
    result = Decimal(str(value))
    check(result.is_finite(), "The original coordinate is not finite.")
    return result


def point_key(point):
    check(len(point) == 2, "This original example requires explicit two-dimensional rings.")
    return tuple(exact_decimal(value) for value in point)


def rotation(sequence):
    """Booth's linear-time least rotation; never sort or simplify geometry."""
    count = len(sequence)
    doubled = sequence + sequence
    left, right, offset = 0, 1, 0
    while left < count and right < count and offset < count:
        a, b = doubled[left + offset], doubled[right + offset]
        if a == b:
            offset += 1
            continue
        if a > b:
            left += offset + 1
            if left <= right:
                left = right + 1
        else:
            right += offset + 1
            if right <= left:
                right = left + 1
        offset = 0
    start = min(left, right)
    return sequence[start:] + sequence[:start]


def ring_key(points):
    keys = [point_key(point) for point in points]
    check(len(keys) >= 4 and keys[0] == keys[-1], "Preserve a complete closed original ring.")
    keys = keys[:-1]
    normal = min(rotation(keys), rotation(list(reversed(keys))))
    return hashlib.sha256(body([[str(x), str(y)] for x, y in normal])).hexdigest()


def native_polygon(geometry, original):
    """Use actual OGR polygon topology and replace no original coordinate value."""
    rings = original.get("rings")
    check(isinstance(rings, list) and rings and not original.get("curveRings"),
          "Use the original polygon rings; curved geometry needs its own reviewed conversion.")
    lookup, expected = {}, collections.Counter()
    for ring in rings:
        expected[ring_key(ring)] += 1
        for point in ring:
            key = point_key(point)
            for value in key:
                check(math.isfinite(float(value)) and Decimal(str(float(value))) == value,
                      "An original coordinate cannot round-trip through native GIS doubles.")
            lookup[key] = list(point)
    observed = collections.Counter()

    def polygon(poly):
        check(poly.GetGeometryName().upper() == "POLYGON", "The native EsriJSON reader changed geometry kind.")
        result = []
        for index in range(poly.GetGeometryCount()):
            ring = poly.GetGeometryRef(index)
            check(ring.GetGeometryName().upper() == "LINEARRING", "The native polygon lacks a complete ring.")
            points = []
            for at in range(ring.GetPointCount()):
                key = (Decimal(str(ring.GetX(at))), Decimal(str(ring.GetY(at))))
                check(key in lookup, "Native conversion changed an original coordinate.")
                points.append(lookup[key])
            observed[ring_key(points)] += 1
            result.append(points)
        return result

    kind = geometry.GetGeometryName().upper()
    if kind == "POLYGON":
        result = {"type":"Polygon", "coordinates":polygon(geometry)}
    else:
        check(kind == "MULTIPOLYGON", "The native reader returned an unsupported polygon topology.")
        result = {"type":"MultiPolygon", "coordinates":[polygon(geometry.GetGeometryRef(i))
                                                       for i in range(geometry.GetGeometryCount())]}
    check(observed == expected, "Native conversion dropped, duplicated, split or changed an original ring.")
    return result, sum(len(ring) for ring in rings)


def derive(app, root, request):
    from osgeo import gdal, osr
    api, common, producer = vector_api(app)
    target = root / "derivation"
    if (target / "result.json").is_file():
        saved = document(target / "result.json")
        check(saved["request"] == request, "The original derivation request changed.")
        verify_files(target, saved["files"])
        return saved
    check(not target.exists(), "An incomplete published derivation requires original-operation recovery.")
    stage = Path(tempfile.mkdtemp(prefix="derivation.receiving-", dir=root))
    os.chmod(stage, 0o700)
    originals, converted, provenance = [], [], []
    gdal.UseExceptions()
    for key, business_field, wanted, epsg, label in LAYERS:
        spec = request["sources"][key]
        original_path = root / spec["retainedPath"]
        raw_bytes = read(original_path)
        check(measured(raw_bytes) == {k:spec[k] for k in ("bytes", "sha256")},
              "The frozen original source changed before native reading.")
        raw = common.parse_json(raw_bytes)
        check(not raw.get("error") and raw.get("geometryType") == "esriGeometryPolygon",
              "Retain an actual successful Esri polygon FeatureSet.")
        check(raw.get("hasZ") is not True and raw.get("hasM") is not True,
              "This source has extra coordinate dimensions requiring an explicit conversion.")
        reference = raw.get("spatialReference", {})
        check(reference.get("latestWkid", reference.get("wkid")) == epsg,
              "The source returned another CRS; do not assign the expected CRS to it.")
        features = raw.get("features")
        check(isinstance(features, list) and 0 < len(features) <= 25,
              "Retain all rows of the bounded original query.")
        check(sum(str(row["attributes"].get(business_field)) == wanted for row in features) == 1,
              "The expected original business ID must have one unambiguous source occurrence.")
        if key == "parcel":
            check(len(features) == 1 and raw.get("exceededTransferLimit") is True,
                  "Retain the original one-parcel partial-query flag.")
        dataset = gdal.OpenEx(str(original_path), gdal.OF_VECTOR | gdal.OF_READONLY,
                             allowed_drivers=["ESRIJSON"])
        check(dataset is not None and dataset.GetLayerCount() == 1, "Open the actual EsriJSON source with GDAL.")
        layer = dataset.GetLayerByIndex(0)
        actual_crs = layer.GetSpatialRef()
        expected_crs = osr.SpatialReference()
        expected_crs.ImportFromEPSG(epsg)
        if actual_crs is not None:
            actual_crs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        expected_crs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        check(actual_crs is not None and bool(actual_crs.IsSame(expected_crs)),
              "The actual native CRS differs from the original response.")
        check(layer.GetFeatureCount() == len(features), "The native reader changed the source row count.")
        native_rows = iter(layer)
        derived, bindings = [], []
        for index, row in enumerate(features):
            native = next(native_rows, None)
            check(native is not None and str(native.GetField(business_field)) == str(row["attributes"].get(business_field)),
                  "The native feature does not match the original source row.")
            geometry = native.GetGeometryRef()
            check(geometry is not None and not geometry.IsEmpty(), "The selected original feature lacks native geometry.")
            converted_geometry, ordinates = native_polygon(geometry, row.get("geometry", {}))
            derived.append({"type":"Feature", "id":str(index), "properties":row["attributes"],
                            "geometry":converted_geometry})
            bindings.append({"sourceIndex":index, "nativeReadFeatureId":str(native.GetFID()),
                             "businessField":business_field,
                             "businessValue":row["attributes"].get(business_field),
                             "originalFeatureSha256":common.digest(row),
                             "derivedFeatureSha256":common.digest(derived[-1]),
                             "originalRingCount":len(row["geometry"]["rings"]),
                             "coordinateCountIncludingClosure":ordinates})
        check(next(native_rows, None) is None, "The native reader returned extra source rows.")
        output = {"type":"FeatureCollection", "name":key,
                  "crs":{"type":"name", "properties":{"name":"EPSG:" + str(epsg)}},
                  "features":derived}
        out_path = stage / (key + ".geojson")
        out_path.write_bytes(common.json_bytes(output))
        os.chmod(out_path, 0o600)
        record = descriptor(stage, out_path)
        converted.append({"key":key, "file":record, "crs":"EPSG:" + str(epsg),
                          "businessField":business_field, "selectedBusinessValue":wanted, "label":label,
                          "sourceFeatureCount":len(features)})
        provenance.append({"key":key, "original":spec,
                           "returnedMetadata":{k:v for k,v in raw.items() if k != "features"},
                           "nativeReader":{"driver":dataset.GetDriver().ShortName,
                                           "gdal":gdal.VersionInfo("--version"),
                                           "crsWkt":actual_crs.ExportToWkt()},
                           "derived":record, "bindings":bindings,
                           "meaning":"Format derivation only: complete original attributes and every original polygon ring/coordinate retained. OGR supplies polygon/hole topology; no clipping, simplification, CRS assignment or reprojection."})
        dataset = None
    provenance_file = stage / "derivation-provenance.json"
    provenance_file.write_bytes(common.json_bytes({"schema":SCHEMA, "operationId":OPERATION,
                                                  "derivations":provenance}))
    os.chmod(provenance_file, 0o600)
    files = [descriptor(stage, path) for path in sorted(stage.iterdir()) if path.is_file()]
    saved = {"schema":SCHEMA, "phase":"DERIVED", "request":request, "converted":converted, "files":files}
    (stage / "result.json").write_bytes(body(saved))
    for path in stage.iterdir():
        if path.is_file():
            with path.open("rb") as stream:
                os.fsync(stream.fileno())
    os.rename(stage, target)
    return saved


def style_native(app, root, request):
    from starforge_stac import model, qgis_project
    target = root / "style-native"
    if (target / "result.json").is_file():
        saved = document(target / "result.json")
        check(saved["request"] == request, "The original native style request changed.")
        verify_files(target, saved["files"])
        return saved
    check(not target.exists(), "Recover the incomplete original style output.")
    stage = Path(tempfile.mkdtemp(prefix="style-native.receiving-", dir=root))
    os.chmod(stage, 0o700)
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    core = qgis_project.native()
    if request["runtime"].get("prefix_path"):
        core.QgsApplication.setPrefixPath(request["runtime"]["prefix_path"], True)
    application = core.QgsApplication([], False)
    application.initQgis()
    try:
        workspace = model.QgisWorkspace(request["workspace"])
        saved_styles = []
        parcel_extent = None
        target_crs = core.QgsCoordinateReferenceSystem("EPSG:26916")
        for definition in request["layers"]:
            layer, _ = qgis_project.build_layer(workspace, definition)
            key = definition["collection"]
            options = {"color":"230,230,230,50", "outline_color":"90,90,90,255",
                       "outline_width":"0.45", "outline_style":"solid"}
            if key == "parcel":
                options.update(color="255,255,255,0", outline_color="20,20,20,255", outline_width="0.9")
            elif key == "dnrGeometry":
                options.update(color="190,190,190,45", outline_color="115,115,115,255", outline_style="dash")
            layer.renderer().setSymbol(core.QgsFillSymbol.createSimple(options))
            layer.triggerRepaint()
            path = stage / (key + ".qml")
            message, ok = layer.saveNamedStyle(str(path))
            check(ok and path.is_file(), "The native GIS style could not be saved: " + str(message))
            saved_styles.append({"layerId":definition["id"], "file":descriptor(stage, path)})
            if key == "parcel":
                transform = core.QgsCoordinateTransform(layer.crs(), target_crs, core.QgsProject.instance())
                rectangle = transform.transformBoundingBox(layer.extent())
                check(not rectangle.isEmpty(), "The actual parcel has no native extent.")
                # A display extent is not a buffer, clipping operation or regulatory measurement.
                rectangle.grow(max(rectangle.width(), rectangle.height(), 20.0) * 2)
                parcel_extent = [rectangle.xMinimum(), rectangle.yMinimum(),
                                 rectangle.xMaximum(), rectangle.yMaximum()]
        check(parcel_extent and all(math.isfinite(value) for value in parcel_extent),
              "Retain the native-transformed parcel-centred view extent.")
        files = [descriptor(stage, path) for path in sorted(stage.iterdir()) if path.is_file()]
        saved = {"schema":SCHEMA, "phase":"STYLED", "request":request, "files":files,
                 "styles":saved_styles, "renderExtent":parcel_extent, "projectCrs":"EPSG:26916",
                 "nativeVersion":qgis_project.native_version()}
        (stage / "result.json").write_bytes(body(saved))
        for path in stage.iterdir():
            if path.is_file():
                with path.open("rb") as stream:
                    os.fsync(stream.fileno())
        os.rename(stage, target)
        return saved
    finally:
        layer = None
        core.QgsProject.instance().clear()
        application.exitQgis()


class Bootstrap:
    def __init__(self, args):
        self.args = args
        self.root = Path(args.directory).expanduser().absolute()
        self.app = Path(args.application_root).expanduser().resolve(strict=True)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        sys.path[:0] = [str(self.app)]
        from starforge_stac import model
        from starforge_stac.analyst_state import AnalystJournal
        from analyst.actions import normalize_payload, native_runtime, NATIVE_ACTIONS
        self.model, self.Journal, self.normalize, self.native_actions = model, AnalystJournal, normalize_payload, NATIVE_ACTIONS
        spec = importlib.util.spec_from_file_location("_landsage_existing_receiving",
                                                     self.app / "evidence-native-receiving.py")
        self.receiving = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.receiving)
        self.input_bytes = read(args.inputs)
        self.inputs = json.loads(self.input_bytes, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        check(self.inputs.get("schema") == SCHEMA and self.inputs.get("operationId") == OPERATION,
              "Use the same original LandSage bootstrap input.")
        self.reviewer = self.inputs["reviewer"].strip()
        check(self.reviewer, "Name the actual operating reviewer.")
        self.runtime = native_runtime(document(self.inputs["nativeRuntimeFile"]))
        self.vector_python = Path(self.inputs.get("vectorPython", self.runtime["native_command"][0])).absolute()
        check(self.vector_python.is_file() and os.access(self.vector_python, os.X_OK),
              "Select the installed Python interpreter containing the maintained Fiona/GDAL runtime.")
        keep(self.root, "bootstrap-input.json", self.input_bytes)
        keep(self.root, "bootstrap-runtime.json", body(self.runtime))
        keep(self.root, "bootstrap-source.py", read(Path(__file__)))
        self.vector = vector_root(self.app)
        producer = [descriptor(self.vector, self.vector / name) for name in VECTOR_FILES]
        keep(self.root, "producer-source.json", body({"directory":str(self.vector), "files":producer}))
        self.sources = {}
        for key, expected in EXPECTED.items():
            selected = self.inputs[key]
            raw = read(selected["path"])
            actual = measured(raw)
            check(actual["bytes"] == expected[0] and (not expected[1] or actual["sha256"] == expected[1]),
                  "The original source identity differs: " + key)
            if selected.get("sha256"):
                check(actual["sha256"] == selected["sha256"], "The supplied original source SHA changed.")
            retained = keep(self.root, "originals/" + key + ".json", raw)
            self.sources[key] = {**copy.deepcopy(selected), **actual, "retainedPath":retained["path"]}
        keep(self.root, "measured-originals.json", body(self.sources))
        self.workspace_path = Path(self.inputs.get("workspace", self.root / "workspace")).expanduser().absolute()
        existed = (self.workspace_path / "workspace.sqlite").is_file()
        binding_file = self.root / "workspace-binding.json"
        creation_file = self.root / "workspace-creation-intent.json"
        title = "Bloomington original parcel evidence example"
        creation = {"schema":SCHEMA, "operationId":OPERATION, "mode":"CREATE_NEW",
                    "directory":str(self.workspace_path), "title":title,
                    "inputSha256":measured(self.input_bytes)["sha256"],
                    "originalSourcesSha256":measured(body(self.sources))["sha256"]}
        unbound_creation = not binding_file.exists() and not self.inputs.get("existingWorkspaceId")
        if binding_file.exists() or self.inputs.get("existingWorkspaceId"):
            check(existed, "Recover the original selected workspace; do not create a replacement UUID.")
        elif existed:
            check(creation_file.is_file() and document(creation_file) == creation,
                  "Name an existing workspace before joining it; no original creation intent was retained.")
        if unbound_creation:
            # This is durable before the first database effect. An interrupted initial creation
            # is received only when its complete state and tables are still exactly empty.
            keep(self.root, "workspace-creation-intent.json", body(creation))
        self.workspace = model.QgisWorkspace(self.workspace_path, create=not existed, title=title)
        state = self.workspace.read()
        actual_id = state["id"]
        if unbound_creation:
            initial = {"schema":model.WORKSPACE_SCHEMA, "id":actual_id, "title":title,
                       "revision":0, "createdAt":state.get("createdAt"), "activeSourceId":None,
                       "sources":[], "layers":[], "projects":[], "reviews":[]}
            check(state == initial and isinstance(actual_id, str) and actual_id.startswith("qgis-")
                  and isinstance(state.get("createdAt"), str) and state["createdAt"],
                  "An unbound creation is no longer its original empty workspace; retain it for explicit recovery.")
            with self.workspace._connect() as connection:
                tables = {row[0] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
                check(tables == {"workspace", "events", "requests"} and
                      connection.execute("SELECT count(*) FROM workspace").fetchone()[0] == 1 and
                      connection.execute("SELECT count(*) FROM events").fetchone()[0] == 0 and
                      connection.execute("SELECT count(*) FROM requests").fetchone()[0] == 0,
                      "The unbound original creation contains work; do not adopt an unrelated workspace.")
        if self.inputs.get("existingWorkspaceId"):
            check(actual_id == self.inputs["existingWorkspaceId"], "The original selected workspace changed.")
        keep(self.root, "workspace-binding.json", body({"operationId":OPERATION,
              "workspaceId":actual_id, "directory":str(self.workspace_path)}))
        self.journal = AnalystJournal(self.workspace)
        self.records = {}

    def phase(self, name, request):
        path = self.root / (name + "-request.json")
        keep(self.root, path.name, body(request))
        code = self.receiving.run_worker(
            [*self.runtime["native_command"], "-B", str(Path(__file__).resolve()),
             "--application-root", str(self.app), "--directory", str(self.root),
             "--phase", name, "--inputs", str(path)],
            self.root / "logs" / (name + ".log"), self.args.operation_timeout)
        check(code == 0, "Native phase " + name + " retained its original error; inspect its log and resume.")
        output = self.root / ("derivation" if name == "derive" else "style-native") / "result.json"
        result = document(output)
        check(result["request"] == request, "The returned native phase belongs to different input.")
        verify_files(output.parent, result["files"])
        return result

    def step(self, name, action, payload, expected_revision=None):
        request_id = "landsage-bootstrap-" + str(uuid.uuid5(NAMESPACE, OPERATION + "/" + name))
        path = self.root / "requests" / (name + ".json")
        normalized = self.normalize(action, payload, self.workspace)
        runtime = self.runtime if action in self.native_actions else {}
        if path.is_file():
            request = document(path)
            check(request["requestId"] == request_id and request["action"] == action and
                  request["payload"] == normalized and request["actor"] == self.reviewer and
                  request["nativeRuntime"] == runtime, "The original saved step changed: " + name)
        else:
            revision = self.workspace.read()["revision"] if expected_revision is None else expected_revision
            request = {"requestId":request_id, "action":action, "payload":normalized,
                       "revision":revision, "actor":self.reviewer, "nativeRuntime":runtime}
            keep(self.root, "requests/" + name + ".json", body(request))
        record = self.journal.create(request_id=request_id, action=action, payload=normalized,
            revision=request["revision"], actor=self.reviewer, native_runtime=runtime)
        if record["status"] != "COMPLETED":
            check(record["input"]["workspaceDirectory"] == str(self.workspace.root),
                  "Continue the unfinished request on its original workspace host.")
            command = runtime["native_command"] if runtime else [sys.executable]
            code = self.receiving.run_worker(
                [*command, "-B", str(self.app / "analyst" / "worker.py"),
                 "--workspace", str(self.workspace.root), "--request-id", request_id,
                 "--instance-id", "landsage-bootstrap-" + name],
                self.root / "logs" / (name + ".log"), self.args.operation_timeout)
            record = self.journal.get(request_id)
            check(record["status"] == "COMPLETED",
                  "Original native request " + request_id + " ended " + record["status"] +
                  " (worker " + str(code) + "). Receive the original journal before changing anything.")
        for item in record["files"]:
            self.model.file_digest(self.model.member(self.workspace.root, item["path"]), expected=item)
        keep(self.root, "results/" + name + ".json", body(record))
        self.records[name] = record
        print(json.dumps({"phase":name, "requestId":request_id, "status":record["status"]}), flush=True)
        return record["result"]

    def vector_call(self, name, request):
        path = self.root / "vector-requests" / (name + ".json")
        keep(self.root, "vector-requests/" + name + ".json", body(request))
        result_path = self.root / "vector-results" / (name + ".json")
        # The producer itself receives its original operation before reusing saved bytes.
        result_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        invocation_path = result_path.with_suffix(".invocation.json")
        code = self.receiving.run_worker(
            [str(self.vector_python), "-B", str(self.vector / "engine.py"), "--request", str(path),
             "--result", str(invocation_path)], self.root / "logs" / ("vector-" + name + ".log"),
            self.args.operation_timeout)
        result = document(invocation_path)
        check(code == 0 and result.get("ok") is True,
              "The maintained vector producer retained an actual error: " + json.dumps(result.get("error")))
        # Capture/export replay changes only the top-level replay indicator. Preserve first result.
        if result_path.exists():
            original = document(result_path)
            left, right = copy.deepcopy(original), copy.deepcopy(result)
            for value in (left, right):
                value.get("result", {}).pop("replayed", None)
            check(left == right, "The complete original vector result changed.")
            return original["result"]
        keep(self.root, "vector-results/" + name + ".json", body(result))
        return result["result"]

    def run(self):
        derived = self.phase("derive", {"schema":SCHEMA, "operationId":OPERATION, "sources":self.sources})
        source_root = self.root / "vector-inputs"
        source_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        selections, portable_originals = [], {}
        for item in derived["converted"]:
            key, record = item["key"], item["file"]
            main = keep(source_root, key + ".geojson", read(self.root / "derivation" / record["path"]))
            members = []
            for member_key, original in self.sources.items():
                # Retain each original once in the complete export, with its exact portable location.
                if member_key != key and not (key == "parcel" and member_key not in ("parcel", "femaGeometry", "dnrGeometry")):
                    continue
                member = keep(source_root, "originals/" + member_key + ".json",
                              read(self.root / original["retainedPath"]))
                members.append(member)
                portable_originals[member_key] = {**member, "path":"source/sources/" + key + "/" + member["path"]}
            if key == "parcel":
                members.append(keep(source_root, "derivation-provenance.json",
                                    read(self.root / "derivation" / "derivation-provenance.json")))
            selections.append({"id":key, **main, "driver":"GeoJSON",
                "identity":{"mode":"fields", "fields":[item["businessField"]]}, "members":members})
        selection = {"schema":"starforge.vector-selection.v1", "id":"landsage-bloomington-original-geometry",
            "sourceEdition":{"operationId":OPERATION, "sourcePage":self.inputs["sourcePage"],
                             "originals":self.sources, "portableOriginalMembers":portable_originals, "derivation":descriptor(self.root, self.root/"derivation/result.json"),
                             "meaning":"Complete retained query responses. Parcel coverage is explicitly partial; no statewide, jurisdiction or flood determination is implied."},
            "sources":selections}
        keep(self.root, "selection.json", body(selection))
        captured = self.vector_call("capture", {"command":"capture", "selectionFile":str(self.root/"selection.json"),
            "sourceRoot":str(source_root), "directory":str(self.root/"vector-capture")})
        inspected = self.vector_call("inspect", {"command":"inspect", "directory":str(self.root/"vector-capture"),
            "expectedManifestSha256":captured["manifestFile"]["sha256"]})
        rules = {layer["id"]:{"sourceCrs":next(x["crs"] for x in derived["converted"] if x["key"]==layer["sourceId"])}
                 for layer in inspected["inspection"]["layers"]}
        profile = {"schema":"starforge.vector-export-profile.v1", "formats":["GPKG"], "layers":rules,
                   "shapefile":{"longValues":"reference", "collections":"split"}}
        keep(self.root, "profile.json", body(profile))
        exported = self.vector_call("export", {"command":"export", "captureDirectory":str(self.root/"vector-capture"),
            "directory":str(self.root/"vector-export"), "profileFile":str(self.root/"profile.json"),
            "operationId":"landsage-original-geometry-export"})
        self.vector_call("reopen", {"command":"open", "directory":str(self.root/"vector-export"),
            "expectedManifestSha256":exported["manifestFile"]["sha256"], "native":True})
        self.step("source-inspect", "source.inspect", {"directory":str(self.root/"vector-export"),
                  "expectedManifestSha256":exported["manifestFile"]["sha256"]})
        imported = self.step("source-import", "source.import", {"directory":str(self.root/"vector-export"),
                  "expectedManifestSha256":exported["manifestFile"]["sha256"]})
        source = self.workspace.source(imported["source"]["id"], verify=True)
        inventory = source.native_inventory()
        keep(self.root, "native-source-inventory.json", body(inventory))
        selected = []
        for key, field, expected, epsg, label in LAYERS:
            matches = [row for row in inventory["layers"] if row["sourceId"] == key and row["driver"] == "GPKG"]
            check(len(matches)==1, "Select one actual maintained GeoPackage layer for " + key)
            row = matches[0]
            selected.append(source.layer_definition(row["sourceId"],row["sourceLayerId"],row["layerId"],label=label))
        plan_path = self.root / "layer-plan.json"
        if plan_path.exists():
            plan = document(plan_path)
            check(plan["selected"]==selected, "The native source selection changed.")
        else:
            state = self.workspace.read()
            check(not ({row["id"] for row in selected} & {row["id"] for row in state["layers"]}),
                  "The intended layer already exists without this original bootstrap's layer plan.")
            plan = {"selected":selected, "retainedLayers":state["layers"], "revision":state["revision"]}
            keep(self.root, "layer-plan.json", body(plan))
        styled = self.phase("style", {"schema":SCHEMA, "workspace":str(self.workspace.root),
            "runtime":self.runtime, "layers":selected})
        definitions = copy.deepcopy(plan["retainedLayers"])
        for definition in selected:
            definition = copy.deepcopy(definition)
            style = next(x["file"] for x in styled["styles"] if x["layerId"]==definition["id"])
            definition["styleFile"] = keep(self.workspace.root,
                "styles/landsage-bootstrap/" + style["sha256"] + ".qml",
                read(self.root/"style-native"/style["path"]))
            definition["styleDependencies"] = []
            definitions.append(definition)
        saved_layers = self.step("layers-save","layers.save",{"layers":definitions},plan["revision"])
        saved_map = self.step("map-save","map.save",{"projectCrs":styled["projectCrs"]},saved_layers["revision"])
        project_id = saved_map["project"]["id"]
        bindings = {}
        for key, field, expected, epsg, label in LAYERS:
            definition = next(x for x in selected if x["collection"]==key)
            page = self.step("features-"+key, "map.features",
                {"projectId":project_id,"layerId":definition["id"],"offset":0,"limit":100})
            names = [f["name"] for f in page["fields"]]
            check(field in names, "The native output no longer exposes its original business field.")
            column = names.index(field)
            matches = [row for row in page["rows"] if str(row["values"][column]) == expected]
            check(len(matches)==1 and not matches[0]["geometryEmpty"] and page["complete"],
                  "The original selected native feature must be unambiguous and the complete bounded layer read.")
            subject_id = "landsage-" + ({"femaGeometry":"fema_selected_parcel_query",
                                         "dnrGeometry":"dnr_selected_parcel_query"}.get(key,key))
            bindings[subject_id] = {"requestId":self.records["features-"+key]["requestId"],
                                    "featureId":matches[0]["featureId"], "businessField":field}
        self.step("map-render","map.render",{"projectId":project_id,"width":1440,"height":960,
                                           "extent":styled["renderExtent"]})
        native = {"subjects":bindings,
                  "spatial":[{"leftSubjectId":"landsage-parcel","rightSubjectId":"landsage-"+name,
                              "measurementCrs":"EPSG:26916",
                              "purpose":"Record native intersection predicates and intersection area/length between separately retained public source features; no regulatory determination."}
                             for name in ("fema_selected_parcel_query","dnr_selected_parcel_query")],
                  "mapRequestIds":[self.records["map-render"]["requestId"]]}
        final = {"schema":"commons.landsage-evidence-inputs/v1","operationId":OPERATION,
                 "reviewer":self.reviewer,"workspace":str(self.workspace.root),
                 "existingWorkspaceId":self.workspace.read()["id"],
                 "nativeRuntimeFile":str(self.root/"bootstrap-runtime.json"),"native":native}
        for key in ("parcel","metadata","floodContract"):
            source_record = self.sources[key]
            final[key] = {**copy.deepcopy(source_record),"path":str(self.root/source_record["retainedPath"])}
        if self.inputs.get("ordinance"):
            final["ordinance"] = copy.deepcopy(self.inputs["ordinance"])
        keep(self.root,"evidence-inputs.json",body(final))
        result = {"schema":SCHEMA,"operationId":OPERATION,"state":"NATIVE_SETUP_COMPLETE",
                  "workspaceId":self.workspace.read()["id"],"workspace":str(self.workspace.root),
                  "projectId":project_id,"vectorManifest":exported["manifestFile"],
                  "inputs":descriptor(self.root,self.root/"evidence-inputs.json"),
                  "native":native,"journal":[{"requestId":r["requestId"],"inputSha256":r["inputSha256"],
                    "action":r["input"]["action"],"status":r["status"]} for r in self.records.values()],
                  "renderedInspection":"PENDING: the named receiving owner must open/use/view the actual populated app, map, reports, exports and received project."}
        keep(self.root,"bootstrap-result.json",body(result))
        print(json.dumps(result,ensure_ascii=False),flush=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application-root", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--operation-timeout", type=int, default=1200)
    parser.add_argument("--phase", choices=("derive","style"))
    args = parser.parse_args()
    app = Path(args.application_root).expanduser().resolve(strict=True)
    root = Path(args.directory).expanduser().absolute()
    sys.path[:0] = [str(app)]
    if args.phase:
        result = (derive if args.phase=="derive" else style_native)(app,root,document(args.inputs))
        print(json.dumps({"phase":args.phase,"state":result["phase"]}),flush=True)
        return 0
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    check(args.operation_timeout > 0, "Use a positive timeout for each owned original worker.")
    lock = os.open(root/"bootstrap.lock",os.O_CREAT|os.O_RDWR|getattr(os,"O_NOFOLLOW",0),0o600)
    previous = {}
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        def interrupted(signum,frame):
            raise InterruptedError("Resume the same original bootstrap directory and input.")
        for signum in (signal.SIGTERM,signal.SIGINT):
            previous[signum]=signal.signal(signum,interrupted)
        Bootstrap(args).run()
        return 0
    finally:
        for signum,handler in previous.items():
            signal.signal(signum,handler)
        os.close(lock)


if __name__=="__main__":
    raise SystemExit(main())

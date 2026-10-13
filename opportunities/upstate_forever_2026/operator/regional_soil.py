"""Regional soil operations for the existing Upper Savannah operator.

Uses the original source queue, source object bank, USDA capture and regional
coverage methods. Acquisition precedes the land-cover reference selection.
"""
from pathlib import Path
from copy import deepcopy
import json
import stat
import zipfile

from model.common import (
    atomic_json, canonical, describe_file, digest, file_digest, held, identifier, now,
    read_json, relative_file, verify_file,
)
from source_preparation import SourcePreparation, APPLICATION, _input, _option

ACTIONS = ("regional-soil.prepare", "regional-soil.compose")
DOMAIN_ID = "upstate-wbd-upstream-domain-20261012"
DOMAIN_SHA = "6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9"
METADATA = APPLICATION / "source/soil-interpretation-20261012/soil-erodibility-rule-form.body"
METADATA_RECEIPT = APPLICATION / "source/soil-interpretation-20261012/soil-erodibility-rule-form.capture.json"
METHODS = [
    {
        "id": "regional-capture", "title": "Capture the original regional soil",
        "description": "Acquire native soil geometry and whole-soil K ratings for the retained 217-HUC upstream domain and its selected 1,000 m buffer. Land cover is selected later.",
        "inputs": [
            _input("domain_manifest", "Original 217-HUC source manifest or complete domain ZIP", required=True,
                   help="Choose the retained sources.json with its companions, or upload the original dbc61-upstate-model-domain-20261012.zip."),
        ],
        "options": [
            _option("vintage", "Source edition", "text", default="USDA-SDA-2026-10-12-native-capture", required=True),
        ],
    },
    {
        "id": "regional-continue", "title": "Continue or adopt the existing soil capture",
        "description": "Use the existing native capture directory and its retained request bodies. The original plan supplies the domain, buffer and source choices.",
        "inputs": [
            _input("capture_plan", "Existing native capture plan.json", required=True,
                   help="Use Browse host files to select plan.json in the existing regional capture. This continues the same capture directory."),
        ],
        "options": [],
    },
    {
        "id": "regional-prepare", "title": "Prepare K and regional coverage",
        "description": "Use a complete retained soil capture and numeric 30 m NLCD reference to create K, calculate per-HUC12 coverage and import both sources.",
        "inputs": [
            _input("capture_source", "Existing native plan or imported soil capture", required=False,
                   help="Choose an imported SOIL_K_NATIVE source, or browse to the existing plan.json. Leave empty when selecting a completed capture below."),
            _input("reference", "Original numeric 30 m NLCD reference", required=True, kinds=["raster"]),
            _input("reporting", "Original reporting boundary (optional)", required=False, kinds=["vector"],
                   help="A reporting polygon allows coverage inside that boundary to be tabulated separately from the upstream domain."),
        ],
        "options": [
            _option("capture_task_id", "Completed soil capture in this study", "text",
                    help="Choose a completed capture below, or supply an existing capture above."),
            _option("null_policy", "Water and unresolved soil values", "select", default="nlcd-water-zero",
                    choices=[{"value": "preserve", "label": "Preserve all unresolved values"},
                             {"value": "nlcd-water-zero", "label": "Zero unresolved open water (NLCD 11) only"}]),
            _option("tile_size", "Raster processing tile size", "integer", default=512),
            _option("reporting_layer", "Reporting polygon layer (optional)", "text"),
            _option("reporting_field", "Reporting attribute field (optional)", "text"),
            _option("reporting_value", "Reporting attribute value (optional)", "text"),
            _option("reporting_value_type", "Reporting attribute type", "select", default="text",
                    choices=[{"value": "text", "label": "Text"}, {"value": "number", "label": "Number"}]),
        ],
    },
]
BY_METHOD = {row["id"]: row for row in METHODS}


class RegionalSoil(SourcePreparation):
    @staticmethod
    def _record_path(workspace, task_id):
        return workspace.root / "regional-soil" / identifier(task_id) / "operation.json"

    def _native_root(self, workspace, task_id):
        return self.operator.root / "regional-soil" / str(workspace.project["id"]) / identifier(task_id)

    def _records(self, workspace):
        root = workspace.root / "regional-soil"
        return [read_json(path) for path in sorted(root.glob("*/operation.json"))] if root.exists() else []

    def catalog(self, workspace):
        result = super().catalog(workspace)
        methods = deepcopy(METHODS)
        completed = [
            {"value": row["task_id"], "label": row["title"] + " — " + row["task_id"]}
            for row in result["prepared"]
            if row.get("state") == "complete"
            and row.get("method") in ("regional-capture", "regional-continue")
        ]
        if completed:
            field = next(row for row in methods[2]["options"] if row["name"] == "capture_task_id")
            field.update(type="select", choices=[{"value": "", "label": "Use the selected existing capture"}, *completed])
        result.update(
            methods=methods,
            scientific_scope={
                "domain_source_id": DOMAIN_ID, "domain_source_sha256": DOMAIN_SHA,
                "upstream_huc12_count": 217, "capture_buffer_m": 1000,
                "reference_cell_size_m": 30, "k_to_si_factor": 0.1317,
                "native_attribute": "chorizon.kwfact",
                "method": "Dominant Condition / Surface Layer",
                "capture_before_reference": True,
            },
        )
        return result

    def _observed_progress(self, workspace, record):
        current = dict(record)
        capture_directory = record.get("capture_directory")
        if capture_directory:
            path = Path(capture_directory) / "progress.json"
            if path.is_file():
                try:
                    native = read_json(path)
                except (OSError, ValueError):
                    native = None
                if isinstance(native, dict):
                    current["native_progress"] = native
                    if record.get("state") == "running" and record.get("method") in ("regional-capture", "regional-continue"):
                        details = []
                        for key, label in (("completed_tiles", "tiles complete"),
                                           ("mapunits_seen", "mapunits received"),
                                           ("rated_mapunits", "mapunits rated")):
                            if key in native:
                                details.append(str(native[key]) + " " + label)
                        current["stage"] = "Native regional soil: " + str(native.get("stage", native.get("state", "capture")))
                        if details:
                            current["stage"] += "; " + "; ".join(details)
        return super()._observed_progress(workspace, current)

    def _retained_domain(self, manifest):
        value = read_json(manifest)
        if not isinstance(value, dict) or value.get("schema") != "upstate.sources/v1":
            raise ValueError("Choose the original 217-HUC domain source manifest")
        entries = [row for row in value.get("entries", []) if row.get("id") == DOMAIN_ID]
        if len(entries) != 1 or entries[0].get("sha256") != DOMAIN_SHA:
            raise ValueError("The regional soil desk requires the retained original 217-HUC domain source")
        verify_file(Path(manifest).parent, entries[0])
        return value, entries[0]

    def _domain_input(self, workspace, task, native, selector):
        resolved = self._resolve(workspace, selector)
        members = {row["path"]: row for row in resolved["members"]}
        source = Path(members[resolved["main"]]["source"])
        if zipfile.is_zipfile(source):
            archive, snapshot = self._snapshot(workspace, task["id"], "domain_archive", selector, native)
            destination = native / "original-domain"
            destination.mkdir(parents=True, exist_ok=True)
            # This is the small retained domain archive, not a national raster.
            # Count and expanded size are bounded by the configured intake limit.
            with zipfile.ZipFile(archive) as bundle:
                files = bundle.infolist()
                maximum = min(int(self.operator.extraction_limit), 256 * 1024 * 1024)
                if len(files) > 2048 or sum(item.file_size for item in files) > maximum:
                    raise ValueError("The domain archive exceeds the regional domain intake capacity")
                names = set()
                for item in files:
                    name = self._relative(item.filename.rstrip("/"))
                    if name.as_posix() in names:
                        raise ValueError("The domain archive repeats an original file name")
                    names.add(name.as_posix())
                    mode = item.external_attr >> 16
                    if stat.S_ISLNK(mode):
                        raise ValueError("The domain archive contains a symbolic link")
                    target = destination / name
                    if not target.resolve().is_relative_to(destination.resolve()) or target.is_symlink():
                        raise ValueError("An archive member leaves the retained domain directory")
                    if item.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if target.exists():
                        if target.is_symlink() or target.stat().st_size != item.file_size:
                            raise ValueError("An existing domain archive member differs from the original")
                        import zlib
                        checksum = 0
                        with target.open("rb") as retained:
                            for block in iter(lambda: retained.read(1024 * 1024), b""):
                                checksum = zlib.crc32(block, checksum)
                        if checksum & 0xffffffff != item.CRC:
                            raise ValueError("An existing domain archive member failed its original CRC")
                        continue
                    temporary = target.with_name(target.name + ".partial")
                    if temporary.is_symlink():
                        raise ValueError("A partial domain member is a symbolic link")
                    with bundle.open(item) as original, temporary.open("wb") as received:
                        for block in iter(lambda: original.read(1024 * 1024), b""):
                            received.write(block)
                    temporary.replace(target)
            candidates = []
            for path in destination.rglob("*.json"):
                try:
                    value = read_json(path)
                except (ValueError, OSError):
                    continue
                if isinstance(value, dict) and value.get("schema") == "upstate.sources/v1" and any(
                        row.get("id") == DOMAIN_ID and row.get("sha256") == DOMAIN_SHA
                        for row in value.get("entries", [])):
                    candidates.append(path)
            if len(candidates) != 1:
                raise ValueError("Choose the complete original domain ZIP with one 217-HUC source manifest")
            manifest = candidates[0]
            self._retained_domain(manifest)
            return manifest, snapshot
        self._retained_domain(source)
        manifest = self._copy_manifest(workspace, source, native / "original-domain")
        return manifest, {"selector": selector, "manifest_sha256": file_digest(manifest),
                          "domain_source_id": DOMAIN_ID, "domain_source_sha256": DOMAIN_SHA}

    def _plan_options(self, root):
        plan = read_json(root / "plan.json")
        if plan.get("schema") != "upstate.regional-soil-plan/v1":
            raise ValueError("Choose the original regional soil capture plan.json")
        domain = plan.get("domain", {})
        if domain.get("source_id") != DOMAIN_ID or domain.get("source_sha256") != DOMAIN_SHA:
            raise ValueError("The capture plan belongs to a different original domain")
        if float(plan.get("buffer_m", -1)) != 1000:
            raise ValueError("The selected regional soil edition uses the retained 1,000 m buffer")
        manifest = root / "domain" / "original-manifest.json"
        self._retained_domain(manifest)
        if file_digest(manifest) != domain.get("manifest_sha256"):
            raise ValueError("The capture's original domain manifest changed")
        return manifest, {
            "vintage": plan["vintage"], "buffer_m": plan["buffer_m"],
            "capture_crs": plan["capture_crs"], "tile_edge_m": plan["tile_edge_m"],
            "halo_m": plan["halo_m"], "page_size": plan["geometry_page_size"],
            "rating_batch": plan["rating_batch_size"],
        }, plan

    def _selected_capture(self, workspace, task, native, selector, *, resume=False):
        if selector.get("root_id"):
            selected = self._root_path(selector["root_id"], selector.get("path", ""))
            if selected.name != "plan.json":
                raise ValueError("Choose plan.json in the existing native regional soil capture")
            root = selected.parent
            self._plan_options(root)
            return root, {"selector": selector, "plan_sha256": file_digest(selected),
                          "uses_existing_native_directory": True}
        if resume:
            raise ValueError("Continue an existing capture by selecting its native plan.json with Browse host files")
        primary, snapshot = self._snapshot(workspace, task["id"], "capture_source", selector, native)
        root = primary.parent
        # Imported SOIL_K_NATIVE companions retain capture.json and plan.json
        # beside the native mapunit geometry.
        self._plan_options(root)
        return root, snapshot

    def _capture_key(self, options, manifest):
        from pyproj import CRS
        return digest({
            "domain_source_id": DOMAIN_ID, "domain_source_sha256": DOMAIN_SHA,
            "domain_manifest_sha256": file_digest(manifest),
            "vintage": options["vintage"], "buffer_m": float(options["buffer_m"]),
            "capture_crs": CRS.from_user_input(options["capture_crs"]).to_wkt(),
            "tile_edge_m": float(options["tile_edge_m"]), "halo_m": float(options["halo_m"]),
            "page_size": options["page_size"], "rating_batch": options["rating_batch"],
            "metadata_sha256": file_digest(METADATA),
        })

    def _capture_index(self, key):
        return self.operator.root / "regional-soil" / "captures" / key

    def _capture(self, workspace, task, native, record, supplied, options):
        from source_tools import soil_region
        if record["method"] == "regional-continue":
            root, snapshot = self._selected_capture(
                workspace, task, native, supplied["capture_plan"], resume=True)
            manifest, choices, plan = self._plan_options(root)
        else:
            manifest, snapshot = self._domain_input(
                workspace, task, native, supplied["domain_manifest"])
            choices = {
                "vintage": options["vintage"], "buffer_m": 1000,
                "capture_crs": "EPSG:5070", "tile_edge_m": 15000,
                "halo_m": 60, "page_size": 128, "rating_batch": 1000,
            }
            root = None
        key = self._capture_key(choices, manifest)
        index = self._capture_index(key)
        index.mkdir(parents=True, exist_ok=True)
        with held(index / ".selection.lock", blocking=False):
            pointer = index / "capture-location.json"
            if pointer.exists():
                retained = read_json(pointer)
                previous = Path(retained["directory"])
                if root is not None and root.resolve() != previous.resolve():
                    raise ValueError("This original selection already uses another retained capture directory; select that existing plan")
                root = previous
                if (root / "plan.json").is_file():
                    manifest, choices, _ = self._plan_options(root)
                    if self._capture_key(choices, manifest) != key:
                        raise ValueError("The indexed capture differs from its original scientific selection")
            else:
                root = root or index / "native"
                root.mkdir(parents=True, exist_ok=True)
                atomic_json(pointer, {"schema": "upstate.regional-soil-location/v1",
                                      "capture_key": key, "directory": str(root.resolve()),
                                      "created_at": now()}, immutable=True)
            selection = {
                "schema": "upstate.preparation-selection/v1",
                "method": record["method"], "request_sha256": task["request_sha256"],
                "project_id": workspace.project["id"], "options": choices,
                "inputs": {"domain_or_existing_capture": snapshot},
                "capture_key": key, "capture_directory": str(root.resolve()),
                "source_selection_messages": ["1791849808.106779", "1791854465.082639"],
            }
            self._save_selection(workspace, task, native, selection)
            record["capture_directory"] = str(root.resolve())
            record["capture_key"] = key
            atomic_json(self._record_path(workspace, task["id"]), record)
            self._stage(workspace, record, "Capturing original regional soil geometry and ratings",
                        lambda: soil_region.capture(
                            manifest, DOMAIN_ID, root, **choices, metadata_path=METADATA,
                            metadata_receipt=METADATA_RECEIPT, resume=True))
        captured = read_json(root / "source-manifest.json")
        return self._finish(workspace, task, native, record,
                            root / "source-manifest.json", entry=captured["entries"][0])

    def _save_selection(self, workspace, task, native, selection):
        atomic_json(native / "selection.json", selection, immutable=True)
        atomic_json(self._record_path(workspace, task["id"]).parent / "selection.json",
                    selection, immutable=True)

    def _prepare(self, workspace, task, native, record):
        value = task["payload"]
        method = BY_METHOD.get(value.get("method"))
        if method is None:
            self._fail("SOURCE_METHOD", "Choose a regional soil operation.")
        supplied = value.get("inputs", {})
        if not isinstance(supplied, dict) or set(supplied) - {row["name"] for row in method["inputs"]}:
            self._fail("SOURCE_INPUTS", "Select the original files for this soil operation.")
        for field in method["inputs"]:
            if field.get("required") and not supplied.get(field["name"]):
                self._fail("SOURCE_REQUIRED", "Choose " + field["label"].lower() + ".")
        options = self._options(method, value.get("options", {}))
        if method["id"] in ("regional-capture", "regional-continue"):
            return self._capture(workspace, task, native, record, supplied, options)
        from source_tools import soil_region, soil_coverage
        capture_task = options.get("capture_task_id")
        if bool(capture_task) == bool(supplied.get("capture_source")):
            raise ValueError("Choose one completed capture task or one existing capture source")
        if capture_task:
            path = self._record_path(workspace, identifier(capture_task))
            saved = read_json(path)
            if (saved.get("project_id") != workspace.project["id"] or saved.get("state") != "complete"
                    or saved.get("method") not in ("regional-capture", "regional-continue")):
                raise ValueError("Choose a completed regional capture in this study")
            bank = read_json(path.parent / "prepared-files.json")
            manifest = self._materialize_bank(workspace, bank, native / "retained-capture")
            root = manifest.parent
            snapshot = {"capture_task_id": capture_task, "manifest_sha256": bank["manifest_sha256"]}
        else:
            root, snapshot = self._selected_capture(workspace, task, native, supplied["capture_source"])
        capture_manifest, capture_options, plan = self._plan_options(root)
        record["capture_key"] = self._capture_key(capture_options, capture_manifest)
        soil_region.verify_capture(root)
        # A saved capture source need not retain a separately generated intake
        # manifest. Reconstructing it uses only its already verified originals.
        soil_region._finish_capture(root, read_json(root / "capture.json"), plan)
        reference, reference_snapshot = self._snapshot(
            workspace, task["id"], "reference", supplied["reference"], native)
        if reference_snapshot.get("metadata", {}).get("role") not in (None, "NLCD"):
            raise ValueError("Choose the original numeric NLCD reference grid")
        reporting = None
        reporting_snapshot = None
        if supplied.get("reporting"):
            reporting, reporting_snapshot = self._snapshot(
                workspace, task["id"], "reporting", supplied["reporting"], native)
        where = None
        if options.get("reporting_field"):
            if "reporting_value" not in options:
                raise ValueError("Enter the exact reporting attribute value")
            attribute = options["reporting_value"]
            if options.get("reporting_value_type") == "number":
                import math
                attribute = float(attribute)
                if not math.isfinite(attribute):
                    raise ValueError("The reporting attribute value must be finite")
            where = {options["reporting_field"]: attribute}
        elif "reporting_value" in options:
            raise ValueError("Choose the reporting attribute field")
        if (where or options.get("reporting_layer")) and reporting is None:
            raise ValueError("Choose the reporting polygon for its layer or attribute selection")
        selection = {
            "schema": "upstate.preparation-selection/v1", "method": method["id"],
            "request_sha256": task["request_sha256"], "project_id": workspace.project["id"],
            "options": options, "inputs": {"capture": snapshot, "reference": reference_snapshot,
                                         "reporting": reporting_snapshot},
            "capture_plan_sha256": file_digest(root / "plan.json"),
            "upstream_buffer_m": plan["buffer_m"],
        }
        self._save_selection(workspace, task, native, selection)
        record["capture_directory"] = str(root.resolve())
        atomic_json(self._record_path(workspace, task["id"]), record)
        prepared = native / "prepared"
        self._stage(workspace, record, "Preparing whole-soil K on the original 30 m reference",
                    lambda: soil_region.prepare(root, reference, prepared,
                        null_policy=options.get("null_policy", "nlcd-water-zero"),
                        tile_size=options.get("tile_size", 512)))
        domain_manifest = prepared / "capture/domain/sources.json"
        domain_value, domain_entry = self._retained_domain(domain_manifest)
        domain_file = verify_file(domain_manifest.parent, domain_entry)
        binding_record = domain_entry.get("metadata", {}).get("binding_file")
        if not binding_record:
            raise ValueError("The retained domain entry lacks its original HUC12 feature bindings")
        binding_name = binding_record.get("path") if isinstance(binding_record, dict) else binding_record
        bindings = relative_file(domain_manifest.parent, binding_name)
        coverage = native / "coverage"
        self._stage(workspace, record, "Calculating original HUC12 and reporting-domain soil coverage",
                    lambda: soil_coverage.build(
                        prepared, domain_file, bindings, reference, coverage,
                        reporting=reporting, reporting_layer=options.get("reporting_layer"),
                        reporting_where=where))
        from source_tools.compose import compose
        composed = self._stage(workspace, record, "Joining prepared K and original regional coverage",
                    lambda: compose(native / "sources.json",
                        manifests=[prepared / "source-manifest.json", coverage / "source-manifest.json"],
                        title=record["title"],
                        scope={"soil_capture_key": record.get("capture_key"),
                               "domain_source_id": DOMAIN_ID, "upstream_buffer_m": plan["buffer_m"],
                               "reference_cell_size_m": 30,
                               "reporting_boundary_selected": reporting is not None}))
        entry = read_json(prepared / "source-manifest.json")["entries"][0]
        result = self._finish(workspace, task, native, record, composed["manifest"], entry=entry)
        result["coverage"] = read_json(coverage / "source-manifest.json")["entries"][0]
        summary = read_json(coverage / "coverage-summary.json")
        result["summary"] = {
            "title": "Regional soil coverage",
            "rows": [
                ["Original HUC12 units", summary["feature_count"]],
                ["Units intersecting reporting area", summary["reporting_intersections"]],
                ["Additional upstream units", summary["upstream_ancestors"]],
                ["HUC12 units with unresolved land", len(summary["huc12_with_unresolved_land"])],
                ["HUC12 units extending outside the grid", len(summary["huc12_with_grid_omission"])],
                ["Capture buffer (m)", plan["buffer_m"]],
                ["Reference cell size (m)", 30],
            ],
            "details": {
                "Buffered model domain": summary["buffered_model_domain"],
                "Original HUC12 union": summary["unbuffered_huc12_union"],
                "Selected reporting area": summary["selected_reporting_area"],
            },
        }
        document_root = self._record_path(workspace, task["id"]).parent / "coverage"
        for name, label in (
                ("coverage-summary.json", "Regional soil coverage summary"),
                ("huc12-soil-coverage.csv", "Coverage for each original HUC12")):
            original = coverage / name
            retained = self._object(workspace, original, {})
            destination = document_root / name
            self._link_object(workspace, retained, destination)
            result["documents"].append(describe_file(workspace.root, destination, label=label))
        return result

    def read(self, workspace, operation, value=None):
        ws = self.operator.ws(workspace)
        value = value or {}
        if operation == "catalog":
            return self.catalog(workspace)
        if operation == "files":
            return {"workspace_key": workspace, **self._files(value)}
        task_id = identifier(value.get("task_id"))
        path = self._record_path(ws, task_id)
        if not path.exists():
            task = self.operator.task(task_id)
            if task.get("workspace") != workspace or task.get("action") not in ACTIONS:
                self._fail("SOURCE_PROJECT", "Choose a source operation in this workspace.", 404)
            queued = {"task_id": task_id, "state": task["state"], "stage": task["state"],
                      "elapsed_seconds": 0, "updated_at": task["created_at"],
                      "error": task.get("error"), "outputs": task.get("result"), "log_tail": []}
            if operation == "progress":
                return queued
            if operation == "result":
                return {"workspace_key": workspace, "task_id": task_id, "progress": queued,
                        "result": task.get("result"), "stages": []}
            self._fail("SOURCE_READ", "Choose a supported source preparation read.")
        record = read_json(path)
        if record.get("project_id") != ws.project["id"]:
            self._fail("SOURCE_PROJECT", "Choose a source operation in this workspace.", 404)
        progress = self._observed_progress(workspace, record)
        if operation == "progress":
            return progress
        if operation == "result":
            return {"workspace_key": workspace, "task_id": task_id,
                    "progress": progress, "result": record.get("result"), "stages": record.get("stages", []),
                    "_downloads": self._record_downloads(workspace, ws, path, record.get("result") or {})}
        self._fail("SOURCE_READ", "Choose a supported source preparation read.")

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        ws = self.operator.ws(task["workspace"])
        path = self._record_path(ws, task["id"])
        if not path.exists():
            return task
        record = read_json(path)
        task["_source_preparation"] = self._observed_progress(task["workspace"], record)
        task.setdefault("_downloads", []).extend(
            self._record_downloads(task["workspace"], ws, path, record.get("result") or {}))
        return task

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            self._fail("SOURCE_ACTION", "Choose a supported source preparation operation.")
        workspace = self.operator.ws(task["workspace"])
        task_id = identifier(task["id"])
        path = self._record_path(workspace, task_id)
        native = self._native_root(workspace, task_id)
        native.mkdir(parents=True, exist_ok=True, mode=0o700)
        with held(native / ".operation.lock", blocking=False):
            record = read_json(path) if path.exists() else {
                "schema": "upstate.regional-soil-operation/v1", "task_id": task_id,
                "project_id": workspace.project["id"], "action": task["action"],
                "request_sha256": task["request_sha256"], "method": task["payload"].get("method"),
                "title": task["payload"].get("title") or (
                    BY_METHOD.get(task["payload"].get("method"), {}).get("title", "Composed source edition")),
                "created_at": now(), "state": "queued", "updated_at": now(), "stages": [],
            }
            if record["request_sha256"] != task["request_sha256"] or record["project_id"] != workspace.project["id"]:
                raise ValueError("The source operation belongs to another original selection")
            record["attempt"] = len(task.get("attempts", [])) or 1
            if record["state"] == "complete":
                return record["result"]
            atomic_json(path, record)
            try:
                if task["action"] == "regional-soil.prepare":
                    result = self._prepare(workspace, task, native, record)
                else:
                    result = self._compose(workspace, task, native, record)
            except BaseException as error:
                if record["state"] != "failed":
                    record.update(state="failed", ended_at=now(), updated_at=now(),
                                  error={"code": type(error).__name__, "message": str(error) or type(error).__name__})
                    atomic_json(path, record)
                raise
            record.update(state="complete", stage="complete", result=result, ended_at=now(), updated_at=now())
            record.pop("error", None)
            atomic_json(path, record)
            return result


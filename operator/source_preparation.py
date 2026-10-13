"""Source preparation on the operator's existing retained native task queue.

The established source_tools modules own the scientific transformations and HTTP
contracts. This adapter supplies source selection, durable input snapshots,
progress, composition and Workspace intake; it creates no alternate model.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
from pathlib import Path, PurePosixPath
import re

from model.common import (
    atomic_json, canonical, describe_file, digest, file_digest, held, identifier,
    now, read_json, relative_file, retain_file, verify_file,
)

ACTIONS = frozenset({"source.prepare", "source.compose"})
READS = frozenset({"catalog", "files", "progress", "result"})
APPLICATION = Path(__file__).resolve().parents[1]

BUILTINS = {
    "dem-metadata": ("USGS 3DEP elevation service metadata",
                     "source/parameters/usgs-3dep-service.json.gz"),
    "nlcd-metadata": ("Annual NLCD 2025 Collection 1.2 static metadata",
                      "source/nlcd-static-2025-c1v2/source-manifest.json"),
    "soil-metadata": ("USDA whole-soil K native interpretation metadata",
                      "source/soil-interpretation-20261012/soil-erodibility-rule-form.body"),
    "soil-metadata-capture": ("Original USDA interpretation metadata receipt",
                              "source/soil-interpretation-20261012/soil-erodibility-rule-form.capture.json"),
    "erosivity-metadata": ("NOAA historical rainfall erosivity metadata",
                           "source/noaa-r-factor-conus-2013/metadata.html"),
    "erosivity-metadata-capture": ("Original NOAA metadata receipt",
                                   "source/noaa-r-factor-conus-2013/metadata.html.capture.json"),
    "erosivity-transfer": ("Completed original NOAA archive transfer",
                           "source/noaa-r-factor-conus-2013/source-transfer.json"),
}


def _file_kind(filename):
    return {".tif": "raster", ".tiff": "raster", ".bil": "raster", ".img": "raster",
            ".geojson": "vector", ".gpkg": "vector", ".shp": "vector",
            ".csv": "table", ".tsv": "table"}.get(Path(filename).suffix.lower())


def _input(name, label, *, required=False, kinds=None, default=None, help=""):
    value = {"name": name, "label": label, "required": required, "help": help}
    if kinds:
        value["kinds"] = kinds
    if default is not None:
        value["default"] = default
    return value


def _option(name, label, kind, *, default=None, required=False, choices=None, help=""):
    value = {"name": name, "label": label,
             "type": "select" if kind == "choice" else "number" if kind == "integer" else kind,
             "required": required, "default": default, "help": help}
    if kind == "integer":
        value.update(integer=True, step=1)
    if choices is not None:
        value["choices"] = choices
    return value


DOMAIN_OPTIONS = [
    _option("layer", "Domain layer", "text", help="Use the selected source's native layer, or leave blank for its default."),
    _option("filter_field", "Domain attribute", "text", help="Optional exact attribute selection; choose an original source field."),
    _option("filter_value", "Attribute value", "text", help="The exact value for the selected domain attribute."),
    _option("filter_value_type", "Attribute value type", "choice", default="text",
            choices=[{"value": "text", "label": "Text"}, {"value": "number", "label": "Number"}]),
    _option("buffer_m", "Upstream context buffer (m)", "number", default=1000,
            help="Use the same positive context buffer selected for the model grid."),
]
RECEIVE_MODE = _option(
    "source_mode", "Original source", "choice", default="received",
    choices=[{"value": "received", "label": "Use an existing complete archive"},
             {"value": "download", "label": "Acquire the published original archive"}],
    help="Existing originals are reused. Download selects the fixed published source URL.")
RECEIPT_INPUTS = [
    _input("capture", "Original HTTP capture receipt", help="For a directly downloaded archive, select its complete original capture JSON."),
    _input("transfer", "Completed original transfer", help="For a shared source archive, select its complete SourceArtifacts result. Choose this or an HTTP capture receipt."),
]
METHODS = [
    {
        "id": "dem", "title": "USGS elevation", "role": "DEM",
        "description": "Acquire and assemble original numeric USGS elevation tiles on the selected land-cover grid.",
        "inputs": [
            _input("reference", "Numeric land-cover grid", required=True, kinds=["raster"]),
            _input("domain", "Complete upstream model domain", required=True, kinds=["vector"]),
            _input("metadata", "Original elevation metadata", required=True,
                   default={"builtin_id": "dem-metadata"}),
        ],
        "options": DOMAIN_OPTIONS + [
            _option("vintage", "Source edition", "text", required=True,
                    help="Describe the actual service edition retained in the metadata."),
            _option("tile_size", "Native tile width (cells)", "integer", default=2048,
                    help="The helper also enforces the source service's advertised dimensions."),
            _option("workers", "Concurrent original elevation requests", "integer", default=1,
                    help="Select this host's receiving concurrency. The native helper preserves the grid, reuses completed tiles and records provider Retry-After."),
        ],
    },
    {
        "id": "prism", "title": "PRISM precipitation", "role": "PRECIPITATION",
        "description": "Prepare the original 1991–2020 annual precipitation normal as the NDR runoff proxy.",
        "inputs": [
            {**field, "when": {"field": "source_mode", "equals": "received"}}
            for field in [_input("archive", "Original annual-normal ZIP")] + RECEIPT_INPUTS
        ],
        "options": [RECEIVE_MODE],
    },
    {
        "id": "nlcd", "title": "Annual NLCD land cover", "role": "NLCD",
        "description": "Receive the complete 2025 national product and clip the selected upstream domain locally.",
        "inputs": [
            _input("archive", "Original Annual NLCD 2025 national ZIP", required=True),
            _input("domain", "Complete upstream model domain", required=True, kinds=["vector"]),
            _input("metadata_manifest", "Original static-product metadata", required=True,
                   default={"builtin_id": "nlcd-metadata"}),
        ] + RECEIPT_INPUTS,
        "options": DOMAIN_OPTIONS + [
            _option("read_mode", "Read national product", "choice",
                    choices=[{"value": "archive", "label": "Read the original ZIP directly"},
                             {"value": "expanded", "label": "Expand the original national TIFF"}],
                    help="Archive mode uses the native ZIP reader and retains original member hashes. Omit this option to preserve the helper's existing expanded selection."),
            _option("raster_member", "Land-cover TIFF member", "text",
                    help="Leave blank when the native archive contains one TIFF; otherwise use the exact archive member."),
            _option("expected_features", "Expected domain features", "integer",
                    help="Optional exact native feature count. The retained whole upstream domain contains 217."),
            _option("maximum_member_gib", "Maximum expanded TIFF (GiB)", "number", default=32,
                    help="A receiving capacity for the original national TIFF, within the operator's configured extraction limit."),
            _option("maximum_clip_pixels", "Maximum local clip cells", "integer", default=200000000,
                    help="The complete native domain window must fit the selected capacity."),
        ],
    },
    {
        "id": "erosivity", "title": "NOAA rainfall erosivity", "role": "R_FACTOR",
        "description": "Prepare the original NOAA R-factor raster and its explicit one-time conversion to SDR units.",
        "inputs": [
            {**field, "when": {"field": "source_mode", "equals": "received"}}
            for field in [
                _input("archive", "Original NOAA R-factor ZIP"),
                _input("transfer", "Completed original NOAA transfer",
                       default={"builtin_id": "erosivity-transfer"}),
                _input("metadata", "Original NOAA source metadata",
                       default={"builtin_id": "erosivity-metadata"}),
                _input("metadata_capture", "Original NOAA metadata receipt",
                       default={"builtin_id": "erosivity-metadata-capture"}),
            ]
        ],
        "options": [RECEIVE_MODE,
                    _option("raster_member", "R-factor TIFF member", "text",
                            help="Leave blank when the original archive has one TIFF.")],
    },
    {
        "id": "soil", "title": "USDA whole-soil erodibility", "role": "K_FACTOR",
        "description": "Acquire original mapunit geometry and the native whole-soil surface interpretation, then prepare K in SDR units.",
        "inputs": [
            _input("reference", "Numeric land-cover grid", required=True, kinds=["raster"]),
            _input("domain", "Complete upstream model domain", required=True, kinds=["vector"]),
            _input("metadata", "Original USDA interpretation metadata", required=True,
                   default={"builtin_id": "soil-metadata"}),
            _input("metadata_capture", "Original USDA metadata receipt", required=True,
                   default={"builtin_id": "soil-metadata-capture"}),
        ],
        "options": DOMAIN_OPTIONS + [
            _option("vintage", "Soil survey edition", "text", required=True),
            _option("tile_size", "Geometry tile width (cells)", "integer", default=512),
            _option("page_size", "Geometry page features", "integer", default=128),
            _option("rating_batch", "Mapunits per native interpretation", "integer", default=1000),
            _option("null_policy", "Missing soil values", "choice", default="preserve",
                    choices=[{"value": "preserve", "label": "Preserve NoData"},
                             {"value": "nlcd-water-zero", "label": "Zero only at original NLCD open water"}],
                    help="Other absent or conflicting soil ratings remain NoData."),
        ],
    },
]
from source_tools.high_quality_water_preparation import BUILTINS as WATER_BUILTINS, METHOD as WATER_METHOD

BUILTINS.update(WATER_BUILTINS)
METHODS.append(WATER_METHOD)
from source_tools.nlcd_range_preparation import method_schema as nlcd_range_method_schema
METHODS.append(nlcd_range_method_schema(_input, _option, DOMAIN_OPTIONS))
BY_METHOD = {item["id"]: item for item in METHODS}


class SourcePreparation:
    def __init__(self, operator, fault, source_roots=()):
        self.operator, self.Fault = operator, fault
        self.roots = {}
        roots = [Path(value) for value in source_roots]
        roots.extend(Path(row["path"]).parent for row in operator.registered.values())
        for supplied in roots:
            path = supplied.expanduser().resolve(strict=True)
            if not path.is_dir():
                raise ValueError("A registered source root must be a directory")
            key = digest({"source_root": str(path)})
            self.roots[key] = path

    def _fail(self, code, message, status=422):
        raise self.Fault(code, message, status)

    @staticmethod
    def _relative(value, *, empty=False):
        if empty and value in ("", None):
            return PurePosixPath(".")
        if not isinstance(value, str) or "\\" in value or "\0" in value:
            raise ValueError("Choose an ordinary relative source path")
        path = PurePosixPath(value)
        if (path.is_absolute() or not path.parts or any(part in (".", "..") for part in path.parts)
                or str(path) != value):
            raise ValueError("Choose a canonical relative path within the selected source root")
        return path

    def _team_administrator(self):
        team = getattr(self.operator, "team", None)
        context = team.current() if team else None
        return not context or context["principal"]["administrator"]

    def _root_path(self, root_id, relative, *, directory=False):
        if not self._team_administrator():
            self._fail("TEAM_ADMIN", "An installation administrator selects shared source directories.", 403)
        path = self.roots.get(root_id)
        if path is None:
            self._fail("SOURCE_ROOT", "Choose a source root registered by this operator.", 404)
        result = path.joinpath(*self._relative(relative, empty=directory).parts).resolve(strict=True)
        if not result.is_relative_to(path) or (not result.is_dir() if directory else not result.is_file()):
            self._fail("SOURCE_PATH", "The selected source is outside its registered root or has the wrong file type.")
        return result

    @staticmethod
    def _record_path(workspace, task_id):
        return workspace.root / "source-preparation" / identifier(task_id) / "operation.json"

    def _native_root(self, workspace, task_id):
        return self.operator.root / "source-preparation" / str(workspace.project["id"]) / identifier(task_id)

    def _records(self, workspace):
        return [read_json(path) for path in sorted((workspace.root / "source-preparation").glob("*/operation.json"))]

    def catalog(self, workspace):
        ws = self.operator.ws(workspace)
        sources = []
        for collection in ws.sources():
            for row in collection["entries"]:
                sources.append({
                    "collection_id": collection["id"], "collection_title": collection["title"],
                    "source_id": row["id"], "title": row["title"], "kind": row["kind"],
                    "role": row.get("role"), "vintage": row.get("vintage"), "units": row.get("units"),
                    "bytes": row["body"]["bytes"], "companion_count": len(row.get("companions", [])),
                    "companions": [
                        {"path": body.get("view_path", body.get("source_path", body["filename"])),
                         "title": body["filename"], "bytes": body["bytes"], "sha256": body["sha256"],
                         "kind": _file_kind(body["filename"]),
                         "selector": {"collection_id": collection["id"], "source_id": row["id"],
                                      "companion_path": body.get("view_path", body.get("source_path", body["filename"]))}}
                        for body in row.get("companions", [])
                    ],
                    "selector": {"collection_id": collection["id"], "source_id": row["id"]},
                })
        bundled = [
            {"id": key, "title": title, "kind": "document", "path": relative,
             "available": (APPLICATION / relative).is_file(), "selector": {"builtin_id": key}}
            for key, (title, relative) in BUILTINS.items()
        ]
        uploads = []
        for path in sorted((self.operator.root / "uploads").glob("*.json")):
            row = read_json(path)
            team = getattr(self.operator, "team", None)
            if team and not team.can_resource("upload", row["id"]):
                continue
            uploads.append({"id": row["id"], "title": row["filename"], "bytes": row["bytes"],
                            "selector": {"upload_id": row["id"]}})
        prepared = []
        for record in self._records(ws):
            result = record.get("result") or {}
            progress = self._observed_progress(workspace, record)
            prepared.append({
                "task_id": record["task_id"], "title": record["title"], "method": record.get("method"),
                "action": record["action"], "state": progress["state"], "stage": progress["stage"],
                "updated_at": progress["updated_at"], "role": result.get("role"),
                "source_id": result.get("source_id"), "source_collection_id": result.get("source_collection_id"),
                "source_count": result.get("source_count", 0), "error": progress["error"],
            })
        return {
            "workspace_key": workspace, "methods": METHODS, "sources": sources,
            "roots": [{"id": key, "label": str(path)} for key, path in self.roots.items()] if self._team_administrator() else [],
            "bundled": bundled, "uploads": uploads, "prepared": prepared,
            "registered": [{key: value for key, value in item.items() if key != "path"}
                           for item in self.operator.registered.values()] if self._team_administrator() else [],
            "limits": {"source_extraction_bytes": self.operator.extraction_limit,
                       "upload_bytes": self.operator.upload_limit},
        }

    def _files(self, value):
        root_id, relative = value.get("root_id"), value.get("path", "")
        directory = self._root_path(root_id, relative, directory=True)
        root = self.roots[root_id]
        offset = value.get("offset") if value.get("offset") is not None else 0
        if isinstance(offset, str) and re.fullmatch(r"[0-9]+", offset):
            offset = int(offset)
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            self._fail("SOURCE_PAGE", "Choose a nonnegative source directory offset.")
        limit = value.get("limit") if value.get("limit") is not None else 200
        if isinstance(limit, str) and re.fullmatch(r"[0-9]+", limit):
            limit = int(limit)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
            self._fail("SOURCE_PAGE", "Choose a source directory page size from 1 to 500.")
        members = []
        for path in directory.iterdir():
            if path.name.startswith("."):
                continue
            try:
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(root) or not (resolved.is_file() or resolved.is_dir()):
                    continue
                members.append((path, resolved))
            except OSError:
                continue
        members.sort(key=lambda item: (not item[1].is_dir(), item[0].name.casefold(), item[0].name))
        rows = []
        for path, resolved in members[offset:offset + limit]:
            rows.append({"name": path.name, "path": path.relative_to(root).as_posix(),
                         "is_dir": resolved.is_dir(), "bytes": None if resolved.is_dir() else resolved.stat().st_size})
        return {"root_id": root_id, "path": "" if directory == root else directory.relative_to(root).as_posix(),
                "entries": rows, "total_entries": len(members),
                "next_offset": offset + limit if offset + limit < len(members) else None}

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

    def _observed_progress(self, workspace, record):
        try:
            task = self.operator.task(record["task_id"])
        except FileNotFoundError:
            # A completed preparation also travels with a restored Workspace
            # whose receiving operator has a different task queue.
            task = None
        if task and (task.get("workspace") != workspace or task.get("action") != record["action"]):
            task = None
        return self._progress(record, task)

    @staticmethod
    def _progress(record, task=None):
        state, stage = record["state"], record.get("stage")
        error, updated = record.get("error"), record["updated_at"]
        end = record.get("ended_at") or now()
        if task and state != "complete":
            state = task["state"]
            if state in {"queued", "interrupted", "cancelled"}:
                stage = state
            elif state == "running" and record["state"] == "failed":
                stage = "Resuming retained source selection"
            if state in {"failed", "interrupted", "cancelled"}:
                error = task.get("error") or error
                end = task.get("ended_at") or end
                updated = task.get("ended_at") or updated
            else:
                error = None
        if state == "running":
            end = now()
        started = record.get("stage_started_at", record["created_at"])
        elapsed = 0 if state == "queued" else max(
            0, (dt.datetime.fromisoformat(end) - dt.datetime.fromisoformat(started)).total_seconds())
        events = [
            {"at": item.get("ended_at", item["started_at"]),
             "message": item["name"] + ": " + item["state"]}
            for item in record.get("stages", [])
        ] + record.get("native_events", [])
        events.sort(key=lambda item: item["at"])
        return {"task_id": record["task_id"], "state": state, "stage": stage,
                "elapsed_seconds": elapsed, "updated_at": updated,
                "error": error, "outputs": record.get("result"),
                "native_progress": record.get("native_progress"),
                "log_tail": [item["message"] for item in events[-12:]]}

    def _record_downloads(self, workspace, ws, path, result):
        files = [self.operator._ticket(workspace, path,
                 describe_file(ws.root, path), "Source preparation operation")]
        for item in result.get("documents", []):
            retained = relative_file(ws.root, item["path"])
            files.append(self.operator._ticket(workspace, retained, item, item.get("label")))
        return files

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        ws = self.operator.ws(task["workspace"])
        path = self._record_path(ws, task["id"])
        if not path.exists():
            return task
        record = read_json(path)
        task["_source_preparation"] = self._progress(record, task)
        task.setdefault("_downloads", []).extend(
            self._record_downloads(task["workspace"], ws, path, record.get("result") or {}))
        return task

    def _resolve(self, workspace, selector):
        if not isinstance(selector, dict) or not selector:
            self._fail("SOURCE_SELECTOR", "Choose an existing source file, upload or registered source path.")
        choices = [key for key in ("collection_id", "upload_id", "builtin_id", "root_id") if selector.get(key)]
        if len(choices) != 1:
            self._fail("SOURCE_SELECTOR", "Use exactly one source selection.")
        row, members = {}, []
        if choices[0] == "collection_id":
            path, row = workspace.source_file(identifier(selector["collection_id"]), selector.get("source_id"))
            view = workspace.root / "source-views" / selector["collection_id"] / digest(selector["source_id"])
            bodies = [row["body"], *row.get("companions", [])]
            chosen = row["body"]
            if selector.get("companion_path"):
                name = selector["companion_path"]
                found = []
                for key in ("view_path", "source_path", "filename"):
                    found = [body for body in bodies if name == body.get(key)]
                    if found:
                        break
                if len(found) != 1:
                    self._fail("SOURCE_COMPANION", "Choose an exact original companion path.")
                chosen = found[0]
            for body in bodies:
                name = body.get("view_path", body["filename"])
                members.append({"path": name, "source": view / self._relative(name),
                                "expected": {"bytes": body["bytes"], "sha256": body["sha256"]}})
            name = chosen.get("view_path", chosen["filename"])
            metadata = {
                key: row[key] for key in ("id", "title", "kind", "role", "layer", "units", "vintage") if key in row}
            if chosen is not row["body"]:
                metadata = {"title": chosen["filename"], "kind": _file_kind(chosen["filename"]),
                            "parent_source_id": row["id"], "companion_path": name,
                            "vintage": row.get("vintage")}
            return {"main": name, "members": members, "metadata": metadata}
        if choices[0] == "upload_id":
            upload = self.operator.upload(identifier(selector["upload_id"]))
            path, name = Path(upload["path"]), upload["filename"]
            members = [{"path": name, "source": path,
                        "expected": {"bytes": upload["bytes"], "sha256": upload["sha256"]}}]
            return {"main": name, "members": members, "metadata": {"title": name}}
        if choices[0] == "builtin_id":
            entry = BUILTINS.get(selector["builtin_id"])
            if entry is None:
                self._fail("SOURCE_BUILTIN", "Choose an available bundled source reference.")
            title, relative = entry
            path = (APPLICATION / relative).resolve(strict=True)
            if not path.is_relative_to(APPLICATION) or not path.is_file():
                self._fail("SOURCE_BUILTIN", "The selected original source reference is absent.", 404)
            row = {"title": title}
        else:
            path = self._root_path(selector["root_id"], selector.get("path"))
            row = {"title": path.name}
        name = path.name
        members = [{"path": name, "source": path, "expected": {}}]
        suffix = path.suffix.lower()
        permitted_root = APPLICATION if choices[0] == "builtin_id" else self.roots[selector["root_id"]]
        neighbours = {}
        for candidate in path.parent.iterdir():
            try:
                if candidate.is_file() and candidate.resolve(strict=True).is_relative_to(permitted_root):
                    neighbours[candidate.name.casefold()] = candidate
            except OSError:
                continue
        if suffix == ".shp":
            for extension in (".shx", ".dbf", ".prj"):
                companion = neighbours.get((path.stem + extension).casefold())
                if companion is None:
                    self._fail("SOURCE_SIDECAR", "The selected shapefile needs its original " + extension + " companion.")
                members.append({"path": companion.name, "source": companion, "expected": {}})
            extra = [path.stem + extension for extension in (".cpg", ".qpj")] + [path.name + ".xml"]
        elif suffix in {".tif", ".tiff"}:
            extra = [path.name + extension for extension in (".aux.xml", ".msk", ".ovr", ".xml")]
            extra += [path.stem + extension for extension in (".tfw", ".wld", ".prj")]
        else:
            extra = []
        for candidate in extra:
            companion = neighbours.get(candidate.casefold())
            if companion is not None:
                members.append({"path": companion.name, "source": companion, "expected": {}})
        return {"main": name, "members": members, "metadata": row}

    def _object(self, workspace, source, expected=None):
        expected = expected or {}
        source = Path(source).resolve(strict=True)
        if "bytes" in expected and source.stat().st_size != expected["bytes"]:
            raise ValueError("A selected original source differs from its declared size")
        if expected.get("sha256"):
            existing = workspace.root / "objects" / expected["sha256"]
            if existing.is_file():
                if existing.stat().st_size != source.stat().st_size or file_digest(existing) != expected["sha256"]:
                    raise ValueError("The retained source object changed")
                if not os.path.samefile(source, existing) and file_digest(source) != expected["sha256"]:
                    raise ValueError("The selected original differs from its retained source object")
                return {"object": "objects/" + expected["sha256"], "bytes": existing.stat().st_size,
                        "sha256": expected["sha256"], "filename": source.name}
        return retain_file(workspace.root, source, expected.get("sha256"))

    def _link_object(self, workspace, item, destination):
        source = relative_file(workspace.root, item["object"])
        if source.stat().st_size != item["bytes"] or file_digest(source) != item["sha256"]:
            raise ValueError("An original source snapshot changed")
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_symlink():
            raise ValueError("A native source view is not an ordinary retained file")
        if not destination.exists():
            try:
                os.link(source, destination)
            except OSError as error:
                import errno
                if error.errno != errno.EXDEV:
                    raise
                import shutil
                import tempfile
                pending = None
                try:
                    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".source-", delete=False) as out:
                        pending = Path(out.name)
                        with source.open("rb") as original:
                            shutil.copyfileobj(original, out, 1024 * 1024)
                        out.flush()
                        os.fsync(out.fileno())
                    os.link(pending, destination)
                finally:
                    if pending is not None:
                        pending.unlink(missing_ok=True)
        if destination.stat().st_size != item["bytes"] or file_digest(destination) != item["sha256"]:
            raise ValueError("A source preparation view differs from its retained original")

    def _snapshot(self, workspace, task_id, name, selector, native, *, metadata_manifest=False, reference_kind=None):
        record_path = self._record_path(workspace, task_id).parent / "inputs" / (name + ".json")
        if record_path.exists():
            record = read_json(record_path)
            if record["selector_sha256"] != digest(selector):
                raise ValueError("The same task input belongs to a different source selection")
        else:
            resolved = self._resolve(workspace, selector)
            if reference_kind:
                from source_tools.high_quality_water_preparation import retain_references
                resolved = retain_references(resolved, reference_kind,
                                             uploaded=bool(selector.get("upload_id")))
            if metadata_manifest:
                main = next(item for item in resolved["members"] if item["path"] == resolved["main"])
                manifest = read_json(main["source"])
                if manifest.get("schema") != "commons.original-source/v1":
                    raise ValueError("Select the retained original national land-cover metadata manifest")
                existing = {item["path"] for item in resolved["members"]}
                for item in manifest.get("files", []):
                    relative = self._relative(item["path"])
                    target_name = (PurePosixPath(resolved["main"]).parent / relative).as_posix()
                    if target_name not in existing:
                        resolved["members"].append({"path": target_name,
                            "source": relative_file(Path(main["source"]).parent, item["path"]), "expected": item})
                        existing.add(target_name)
            files = []
            for item in resolved["members"]:
                self._relative(item["path"])
                saved = self._object(workspace, item["source"], item["expected"])
                files.append({**saved, "path": item["path"]})
            record = {"schema": "upstate.preparation-input/v1", "selector": selector,
                      "selector_sha256": digest(selector), "main": resolved["main"],
                      "metadata": resolved["metadata"], "files": files}
            atomic_json(record_path, record, immutable=True)
        destination = native / "inputs" / name
        for item in record["files"]:
            self._link_object(workspace, item, destination / self._relative(item["path"]))
        atomic_json(destination / "input-snapshot.json", record, immutable=True)
        return destination / self._relative(record["main"]), record

    def _options(self, method, supplied):
        if not isinstance(supplied, dict):
            self._fail("SOURCE_OPTIONS", "Select the source preparation options.")
        fields = {item["name"]: item for item in method["options"]}
        if set(supplied) - set(fields):
            self._fail("SOURCE_OPTIONS", "The selected method contains an unsupported option.")
        result = {}
        for name, field in fields.items():
            value = supplied.get(name, field.get("default"))
            if value in ("", None):
                if field.get("required"):
                    self._fail("SOURCE_REQUIRED", "Enter " + field["label"].lower() + ".")
                continue
            if field["type"] in {"number", "integer"}:
                if isinstance(value, bool):
                    self._fail("SOURCE_NUMBER", field["label"] + " must be numeric.")
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    self._fail("SOURCE_NUMBER", field["label"] + " must be numeric.")
                if not math.isfinite(numeric) or numeric <= 0:
                    self._fail("SOURCE_NUMBER", field["label"] + " must be positive and finite.")
                if field.get("integer") or field["type"] == "integer":
                    if not numeric.is_integer():
                        self._fail("SOURCE_NUMBER", field["label"] + " must be a whole number.")
                    value = int(numeric)
                else:
                    value = numeric
            elif not isinstance(value, str):
                self._fail("SOURCE_TEXT", field["label"] + " must be text.")
            if field.get("choices") and value not in {choice["value"] for choice in field["choices"]}:
                self._fail("SOURCE_CHOICE", "Choose an available " + field["label"].lower() + ".")
            result[name] = value
        return result

    def _domain_options(self, options, input_record):
        layer = options.get("layer") or input_record.get("metadata", {}).get("layer")
        where = None
        if options.get("filter_field"):
            if "filter_value" not in options:
                self._fail("SOURCE_FILTER", "Enter the exact value for the selected domain attribute.")
            value = options["filter_value"]
            if options.get("filter_value_type") == "number":
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    self._fail("SOURCE_FILTER", "Enter a finite numeric attribute value.")
                if not math.isfinite(value):
                    self._fail("SOURCE_FILTER", "Enter a finite numeric attribute value.")
            where = {options["filter_field"]: value}
        elif "filter_value" in options:
            self._fail("SOURCE_FILTER", "Choose the original field for this attribute value.")
        return {"layer": layer, "where": where, "buffer_m": options.get("buffer_m", 1000)}

    def _native_progress(self, workspace, record, supplied):
        """Retain the existing helper's actual numeric progress on this task."""
        item = json.loads(canonical(supplied))
        schema = item.get("schema")
        if schema == "upstate.3dep-acquisition/v1":
            label = ("USGS elevation acquisition: " + str(item["complete_tiles"]) + " / "
                     + str(item["tile_count"]) + " tiles; " + str(item["reused_tiles"])
                     + " reused; " + str(item["failed_tiles"]) + " failed; "
                     + str(item["received_bytes"]) + " original bytes")
        elif schema == "upstate.3dep-assembly/v1":
            label = ("USGS elevation assembly: " + str(item["assembled_tiles"]) + " / "
                     + str(item["tile_count"]) + " tiles; " + str(item["valid_cells"])
                     + " valid cells; " + str(item["nodata_cells"]) + " NoData cells")
        elif schema == "upstate.original-range-progress/v1":
            label = ("Original NLCD: " + str(item["completed_ranges"]) + " retained ranges; "
                     + str(item["received_bytes_this_invocation"]) + " received bytes; "
                     + str(item["reused_bytes_this_invocation"]) + " reused bytes; "
                     + str(item["retained_bytes"]) + " / "
                     + str(item["maximum_source_bytes"]) + " retained-byte allowance")
        else:
            raise ValueError("The native source helper returned an unsupported progress record")
        label += " (" + str(item.get("state", item.get("stage", "running"))) + ")"
        if item.get("provider_deferral"):
            label += "; provider Retry-After retained in the native progress record"
        updated = item.get("updated_at") or now()
        record.update(native_progress=item, stage=label, updated_at=updated)
        events = record.setdefault("native_events", [])
        events.append({"at": updated, "message": label})
        del events[:-12]
        atomic_json(self._record_path(workspace, record["task_id"]), record)

    def _stage(self, workspace, record, name, function):
        record.update(state="running", stage=name, stage_started_at=now(), updated_at=now())
        record.pop("error", None)
        record.pop("ended_at", None)
        stage = {"name": name, "state": "running", "started_at": record["stage_started_at"],
                 "attempt": record["attempt"]}
        record.setdefault("stages", []).append(stage)
        path = self._record_path(workspace, record["task_id"])
        atomic_json(path, record)
        try:
            result = function()
        except BaseException as error:
            message = str(error) or type(error).__name__
            stage.update(state="failed", ended_at=now(), error=message)
            record.update(state="failed", error={"code": type(error).__name__, "message": message},
                          ended_at=stage["ended_at"], updated_at=stage["ended_at"])
            atomic_json(path, record)
            raise
        stage.update(state="complete", ended_at=now())
        record["updated_at"] = stage["ended_at"]
        atomic_json(path, record)
        return result

    def _bank_manifest(self, workspace, native, manifest, record):
        manifest = Path(manifest).resolve(strict=True)
        root = manifest.parent
        value = read_json(manifest)
        if value.get("schema") != "upstate.sources/v1":
            raise ValueError("The prepared source must use the existing Workspace intake format")
        selected = {manifest.name: {"path": manifest.name}}
        for row in value["entries"]:
            for item in [row, *row.get("companions", [])]:
                relative = self._relative(item["path"]).as_posix()
                if relative in selected and selected[relative].get("sha256") not in (None, item.get("sha256")):
                    raise ValueError("A source manifest supplies conflicting original file identities")
                selected[relative] = item
        bank_path = self._record_path(workspace, record["task_id"]).parent / "prepared-files.json"
        files = {}
        for name, item in sorted(selected.items()):
            source = relative_file(root, name)
            files[name] = self._object(workspace, source, item)
        bank = {"schema": "upstate.prepared-source-bank/v1", "manifest": manifest.name,
                "files": files, "manifest_sha256": files[manifest.name]["sha256"]}
        atomic_json(bank_path, bank, immutable=True)
        return bank, value, describe_file(workspace.root, bank_path, label="Prepared source files")

    def _materialize_bank(self, workspace, bank, destination):
        for relative, item in bank["files"].items():
            self._link_object(workspace, item, destination / self._relative(relative))
        return destination / self._relative(bank["manifest"])

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
                "schema": "upstate.source-preparation/v1", "task_id": task_id,
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
                if task["action"] == "source.prepare":
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

    def _prepare(self, workspace, task, native, record):
        value = task["payload"]
        method_id = value.get("method")
        method = BY_METHOD.get(method_id)
        if method is None:
            self._fail("SOURCE_METHOD", "Choose an available original source preparation method.")
        supplied = value.get("inputs", {})
        if not isinstance(supplied, dict):
            self._fail("SOURCE_INPUTS", "Select the method's original source files.")
        allowed = {item["name"] for item in method["inputs"]}
        if set(supplied) - allowed:
            self._fail("SOURCE_INPUTS", "The selected method contains an unsupported input.")
        options = self._options(method, value.get("options", {}))
        if method_id == "classified-waters":
            from source_tools.high_quality_water_preparation import prepare_workbench
            return prepare_workbench(self, workspace, task, native, record, method, options)
        mode = options.get("source_mode", "received")
        if mode == "download" and supplied.get("archive"):
            self._fail("SOURCE_MODE", "Use the existing-archive mode for selected source files.")
        files, snapshots = {}, {}

        def select_inputs():
            if mode == "download" and method_id in {"prism", "erosivity"}:
                return
            for field in method["inputs"]:
                name = field["name"]
                selected = supplied.get(name) or field.get("default")
                if not selected:
                    if field["required"]:
                        self._fail("SOURCE_REQUIRED", "Choose " + field["label"].lower() + ".")
                    continue
                path, snapshot = self._snapshot(workspace, task["id"], name, selected, native,
                                                metadata_manifest=name == "metadata_manifest")
                metadata = snapshot.get("metadata", {})
                if field.get("kinds") and metadata.get("kind") and metadata["kind"] not in field["kinds"]:
                    self._fail("SOURCE_KIND", "Choose a " + " or ".join(field["kinds"]) + " for " + field["label"].lower() + ".")
                if name == "reference" and metadata.get("role") not in (None, "NLCD"):
                    self._fail("SOURCE_REFERENCE", "The reference must be the original numeric land-cover grid.")
                files[name], snapshots[name] = path, snapshot

        self._stage(workspace, record, "Retaining selected original inputs", select_inputs)
        if method_id in {"prism", "nlcd"} and mode == "received":
            if not files.get("archive") or bool(files.get("capture")) == bool(files.get("transfer")):
                self._fail("SOURCE_RECEIPT", "Choose the complete original archive and exactly one original capture or completed transfer receipt.")
        if method_id == "erosivity" and mode == "received":
            if any(name not in files for name in ("archive", "transfer", "metadata", "metadata_capture")):
                self._fail("SOURCE_RECEIPT", "Choose the original NOAA archive, completed transfer, metadata and metadata receipt.")
        selection = {
            "schema": "upstate.preparation-selection/v1", "method": method_id,
            "request_sha256": task["request_sha256"], "options": options,
            "inputs": snapshots, "project_id": workspace.project["id"],
        }
        atomic_json(native / "selection.json", selection, immutable=True)
        atomic_json(self._record_path(workspace, task["id"]).parent / "selection.json", selection, immutable=True)
        output = native / "prepared"
        if method_id == "dem":
            from source_tools.raster_sources import prepare_dem
            domain_options = self._domain_options(options, snapshots["domain"])
            entry = self._stage(workspace, record, "Acquiring and assembling USGS elevation", lambda: prepare_dem(
                files["reference"], files["domain"], files["metadata"], output,
                vintage=options["vintage"], tile_size=options.get("tile_size", 2048),
                workers=options.get("workers", 1),
                progress=lambda item: self._native_progress(workspace, record, item), **domain_options))
        elif method_id == "prism":
            from source_tools.raster_sources import prepare_prism
            entry = self._stage(workspace, record, "Preparing original PRISM annual precipitation", lambda: prepare_prism(
                output, archive_path=files.get("archive"), capture_path=files.get("capture"),
                transfer_path=files.get("transfer")))
        elif method_id == "nlcd":
            from source_tools import nlcd_static
            member_bytes = int(options.get("maximum_member_gib", 32) * 1024 ** 3)
            if member_bytes > self.operator.extraction_limit:
                self._fail("SOURCE_CAPACITY", "The expanded national TIFF exceeds the operator's configured source extraction capacity.")
            self._stage(workspace, record, "Receiving the complete national land-cover archive", lambda: nlcd_static.receive(
                native / "capture", archive_path=files["archive"],
                metadata_manifest=files["metadata_manifest"], maximum_archive_bytes=files["archive"].stat().st_size,
                capture_path=files.get("capture"), transfer_path=files.get("transfer"),
                raster_member=options.get("raster_member"), maximum_member_bytes=member_bytes))
            entry = self._stage(workspace, record, "Preparing the local native land-cover domain", lambda: nlcd_static.prepare(
                output, capture_directory=native / "capture", domain=files["domain"],
                expected_features=options.get("expected_features"),
                maximum_clip_pixels=options.get("maximum_clip_pixels", 200000000),
                work_directory=native / "expanded-national-source",
                **({"read_mode": options["read_mode"]} if "read_mode" in options else {}),
                **self._domain_options(options, snapshots["domain"])))
        elif method_id == "nlcd-range":
            from source_tools.nlcd_range_preparation import prepare_entry
            entry = prepare_entry(self, workspace, task, native, record, files, snapshots, options)
        elif method_id == "erosivity":
            from source_tools import erosivity_sources
            capture_directory = None
            if mode == "received":
                capture_directory = native / "capture"
                self._stage(workspace, record, "Receiving the original NOAA erosivity archive", lambda: erosivity_sources.receive_original(
                    capture_directory, archive_path=files["archive"], transfer_path=files["transfer"],
                    metadata_path=files["metadata"], metadata_receipt_path=files["metadata_capture"]))
            entry = self._stage(workspace, record, "Preparing original NOAA rainfall erosivity", lambda: erosivity_sources.prepare(
                output, capture_directory=capture_directory, raster_member=options.get("raster_member")))
        else:
            from source_tools import soil_sources
            entry = self._stage(workspace, record, "Acquiring and preparing native USDA whole-soil K", lambda: soil_sources.prepare(
                files["reference"], files["domain"], files["metadata"], files["metadata_capture"], output,
                vintage=options["vintage"], tile_size=options.get("tile_size", 512),
                page_size=options.get("page_size", 128), rating_batch=options.get("rating_batch", 1000),
                null_policy=options.get("null_policy", "preserve"), resume=record["attempt"] > 1,
                **self._domain_options(options, snapshots["domain"])))

        def selected_manifest():
            original = output / "source-entry.json"
            retained_entry = read_json(original)
            if retained_entry != entry:
                raise ValueError("The native returned entry differs from its completed original source entry")
            projected = {key: item for key, item in entry.items() if key not in {"path", "bytes", "sha256", "companions"}}
            projected.update(describe_file(native, verify_file(output, entry)))
            companions = []
            for item in entry.get("companions", []):
                companions.append({**item, **describe_file(native, verify_file(output, item))})
            companions.append(describe_file(native, original, role="ORIGINAL_NATIVE_SOURCE_ENTRY"))
            companions.append(describe_file(native, native / "selection.json", role="PREPARATION_SELECTION"))
            if method_id == "nlcd-range":
                companions.append(describe_file(native, native / "range-reuse.json", role="ORIGINAL_RANGE_REUSE"))
            for name, snapshot in snapshots.items():
                folder = native / "inputs" / name
                companions.append(describe_file(native, folder / "input-snapshot.json", role="ORIGINAL_INPUT_SELECTION"))
                for item in snapshot["files"]:
                    companions.append(describe_file(native, folder / self._relative(item["path"]),
                                                    role="ORIGINAL_PREPARATION_INPUT"))
            unique = {}
            for item in companions:
                if item["path"] == projected["path"]:
                    continue
                if item["path"] in unique and unique[item["path"]]["sha256"] != item["sha256"]:
                    raise ValueError("A native preparation companion has conflicting source identities")
                unique[item["path"]] = item
            projected["companions"] = list(unique.values())
            projected["operator_preparation"] = {"method": method_id, "task_id": task["id"],
                                                "native_entry_sha256": file_digest(original)}
            adapter = native / "operator-source-entry.json"
            atomic_json(adapter, projected, immutable=True)
            from source_tools.compose import compose
            return compose(native / "sources.json", entries=[adapter], title=record["title"],
                           scope={"preparation_method": method_id,
                                  "selected_domain": snapshots.get("domain", {}).get("metadata"),
                                  "domain_options": self._domain_options(options, snapshots["domain"])
                                      if "domain" in snapshots else None})
        composed = self._stage(workspace, record, "Assembling the complete native source packet", selected_manifest)
        return self._finish(workspace, task, native, record, composed["manifest"], entry=entry)

    def _copy_manifest(self, workspace, source, destination):
        source = Path(source).resolve(strict=True)
        value = read_json(source)
        if value.get("schema") != "upstate.sources/v1" or not isinstance(value.get("entries"), list):
            self._fail("SOURCE_MANIFEST", "Choose a complete original Workspace source manifest.")
        selected = {source.name: {"path": source.name}}
        for entry in value["entries"]:
            for item in [entry, *entry.get("companions", [])]:
                relative = self._relative(item["path"]).as_posix()
                if relative in selected and selected[relative].get("sha256") not in (None, item.get("sha256")):
                    raise ValueError("A selected manifest contains conflicting native file identities")
                selected[relative] = item
        for name, item in selected.items():
            retained = self._object(workspace, relative_file(source.parent, name), item)
            self._link_object(workspace, retained, destination / self._relative(name))
        return destination / source.name

    def _collection_manifest(self, workspace, collection_id, destination):
        collection = workspace._get("sources", identifier(collection_id))
        rows = []
        for original in collection["entries"]:
            row = {key: value for key, value in original.items() if key not in {"body", "companions"}}
            folder = destination / digest(original["id"])
            members = [original["body"], *original.get("companions", [])]
            paths = []
            for body in members:
                target = folder / self._relative(body.get("view_path", body["filename"]))
                self._link_object(workspace, body, target)
                paths.append(describe_file(destination, target))
            row.update(paths[0])
            row["companions"] = paths[1:]
            rows.append(row)
        source = collection["original_manifest"]
        original_manifest = destination / "original-collection-manifest.json"
        self._link_object(workspace, source, original_manifest)
        rows.append({"id": "retained-collection-manifest-" + collection_id,
                     "title": "Original imported source manifest: " + collection["title"],
                     "uri": "urn:sha256:" + source["sha256"],
                     "vintage": collection.get("captured_at") or "Retained imported source edition",
                     "kind": "document", "role": "SOURCE_MANIFEST",
                     **describe_file(destination, original_manifest), "companions": []})
        manifest = {"schema": "upstate.sources/v1", "title": collection["title"],
                    "captured_at": collection.get("captured_at"), "scope": collection.get("scope", {}),
                    "notes": collection.get("notes", []), "entries": rows,
                    "retained_collection_id": collection_id}
        path = destination / "sources.json"
        atomic_json(path, manifest, immutable=True)
        return path

    @staticmethod
    def _ids(value, name):
        selected = value.get(name, [])
        if not isinstance(selected, list) or any(not isinstance(item, str) for item in selected):
            raise ValueError("Choose existing " + name.replace("_", " "))
        if len(set(selected)) != len(selected):
            raise ValueError("A source selection is repeated")
        return selected

    def _compose(self, workspace, task, native, record):
        value = task["payload"]
        prepared_ids = self._ids(value, "prepared_task_ids")
        collection_ids = self._ids(value, "source_collection_ids")
        registered_ids = self._ids(value, "registered_ids")
        if registered_ids and not self._team_administrator():
            self._fail("TEAM_ADMIN", "An installation administrator selects shared source manifests.", 403)
        if not (prepared_ids or collection_ids or registered_ids):
            self._fail("SOURCE_COMPOSITION", "Choose prepared sources, imported editions or registered source manifests.")
        manifests = []

        def original_selections():
            for selected in prepared_ids:
                other = read_json(self._record_path(workspace, selected))
                if other["project_id"] != workspace.project["id"] or other["state"] != "complete":
                    self._fail("SOURCE_PREPARED", "Choose a completed source preparation in this workspace.")
                bank = read_json(self._record_path(workspace, selected).parent / "prepared-files.json")
                manifests.append(self._materialize_bank(workspace, bank, native / "selected" / ("prepared-" + selected)))
            for selected in collection_ids:
                manifests.append(self._collection_manifest(
                    workspace, selected, native / "selected" / ("collection-" + identifier(selected))))
            for selected in registered_ids:
                registered = self.operator.registered.get(selected)
                if registered is None:
                    self._fail("SOURCE_REGISTERED", "Choose an available registered source manifest.", 404)
                path = Path(registered["path"])
                if file_digest(path) != registered["sha256"]:
                    self._fail("SOURCE_CHANGED", "The registered original source manifest changed; select its current edition.", 409)
                manifests.append(self._copy_manifest(workspace, path, native / "selected" / ("registered-" + identifier(selected))))
        self._stage(workspace, record, "Collecting selected original source editions", original_selections)
        selection = {"schema": "upstate.source-composition-selection/v1",
                     "prepared_task_ids": prepared_ids, "source_collection_ids": collection_ids,
                     "registered_ids": registered_ids, "request_sha256": task["request_sha256"]}
        atomic_json(native / "selection.json", selection, immutable=True)
        atomic_json(self._record_path(workspace, task["id"]).parent / "selection.json", selection, immutable=True)
        from source_tools.compose import compose
        composed = self._stage(workspace, record, "Composing the selected native source edition", lambda: compose(
            native / "sources.json", manifests=manifests, title=record["title"]))
        return self._finish(workspace, task, native, record, composed["manifest"])

    def _finish(self, workspace, task, native, record, manifest, *, entry=None):
        bank, value, bank_document = self._stage(
            workspace, record, "Retaining prepared originals for project transfer",
            lambda: self._bank_manifest(workspace, native, manifest, record))
        directory = self._record_path(workspace, task["id"]).parent
        manifest_copy = directory / "source-manifest.json"
        from model.common import atomic_bytes
        atomic_bytes(manifest_copy, Path(manifest).read_bytes(), immutable=True)
        documents = [bank_document, describe_file(workspace.root, manifest_copy, label="Original source intake manifest"),
                     describe_file(workspace.root, directory / "selection.json", label="Source preparation selection")]
        imported = None
        import_sources = task["payload"].get("import_sources", True)
        if not isinstance(import_sources, bool):
            self._fail("SOURCE_IMPORT", "Choose whether to import the completed source edition.")
        if import_sources:
            imported = self._stage(workspace, record, "Importing the prepared scientific sources",
                                   lambda: workspace.import_sources(manifest))
        result = {
            "schema": "upstate.source-preparation-result/v1", "task_id": task["id"],
            "project_id": workspace.project["id"], "title": record["title"], "method": record.get("method"),
            "source_collection_id": imported["id"] if imported else None,
            "source_count": len(value["entries"]),
            "physical_source_count": sum(row["kind"] != "document" for row in value["entries"]),
            "manifest_sha256": bank["manifest_sha256"], "manifest_path": str(manifest),
            "native_directory": str(native), "documents": documents,
            "imported": imported is not None,
        }
        if entry is not None:
            summary = {key: entry[key] for key in (
                "id", "title", "kind", "role", "units", "vintage", "resampling",
                "conversion", "unit_conversion", "source_resolution", "observed",
                "null_policy", "source_capture_id", "preparation_sha256",
            ) if key in entry}
            result.update(source_id=entry["id"], role=entry.get("role"), source_entry=summary)
            original = directory / "native-source-entry.json"
            atomic_json(original, entry, immutable=True)
            result["documents"].append(describe_file(workspace.root, original, label="Native prepared source entry"))
        return result

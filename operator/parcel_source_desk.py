"""Parcel source workflow bound to the original authenticated operator."""
from __future__ import annotations

from pathlib import Path, PurePosixPath

from model import parcel_source_desk as model
from model.common import digest, identifier, relative_file

ACTIONS = frozenset({"parcel.source.receive", "parcel.source.prepare"})
READS = frozenset({"catalog", "directories", "capture", "edition", "rows", "study-selection"})


class ParcelSourceDesk:
    def __init__(self, operator, fault, source_roots=()):
        self.operator, self.Fault = operator, fault
        roots = [Path(value) for value in source_roots]
        roots.extend(Path(row["path"]).parent for row in operator.registered.values())
        self.roots = {}
        for root in roots:
            path = root.expanduser().resolve(strict=True)
            if not path.is_dir():
                raise ValueError("Each registered parcel source root must be a directory")
            self.roots[digest({"source_root": str(path)})] = path

    def _error(self, message, code="PARCEL_SOURCE_REQUEST", status=422):
        raise self.Fault(code, message, status)

    @staticmethod
    def _one(value, field, default=None):
        value = value.get(field, default)
        if isinstance(value, list):
            if len(value) != 1:
                raise ValueError("Choose one " + field.replace("_", " "))
            value = value[0]
        return value

    def _directory(self, value):
        root_id = self._one(value, "root_id")
        root = self.roots.get(root_id)
        if root is None:
            self._error("Choose a source directory registered by this operator.", "PARCEL_SOURCE_ROOT", 404)
        name = self._one(value, "path", "")
        if not isinstance(name, str) or "\\" in name or "\0" in name:
            self._error("Choose a canonical relative source directory.")
        if name:
            member = PurePosixPath(name)
            if (member.is_absolute() or member.as_posix() != name
                    or any(part in {"", ".", ".."} for part in name.split("/"))):
                self._error("The source directory must stay within its registered root.")
            selected = (root / member).resolve(strict=True)
        else:
            selected = root
        if not selected.is_relative_to(root) or not selected.is_dir():
            self._error("Choose an existing directory within the registered source root.")
        return selected, {"root_id": root_id, "path": name}

    def _browse(self, value):
        path, locator = self._directory(value)
        offset = self._one(value, "offset", 0)
        if isinstance(offset, str) and offset.isdecimal():
            offset = int(offset)
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            self._error("Choose a nonnegative directory page.")
        root = self.roots[locator["root_id"]]
        members = []
        for child in path.iterdir():
            if child.name.startswith("."):
                continue
            try:
                selected = child.resolve(strict=True)
                if not selected.is_relative_to(root) or not selected.is_dir():
                    continue
            except OSError:
                continue
            members.append({
                "name": child.name, "path": child.relative_to(root).as_posix(),
                "has_plan": (selected / "parcel-plan.json").is_file(),
                "has_progress": (selected / "capture-progress.json").is_file(),
                "has_inventory": (selected / "parcel-inventory.json").is_file(),
            })
        members.sort(key=lambda row: (row["name"].casefold(), row["name"]))
        parent = PurePosixPath(locator["path"]).parent.as_posix() if locator["path"] else ""
        return {
            "locator": locator, "parent": "" if parent == "." else parent,
            "has_plan": (path / "parcel-plan.json").is_file(),
            "directories": members[offset:offset + 100], "offset": offset,
            "total": len(members),
            "next_offset": offset + 100 if offset + 100 < len(members) else None,
        }

    def _edition(self, workspace, edition_id):
        ws = self.operator.ws(workspace)
        value = model.get(ws, edition_id)
        result = dict(value)
        result["_downloads"] = []
        labels = {
            "gpkg": "Parcel, cadastral, county and gap GeoPackage",
            "parcel_csv": "Complete parcel inventory CSV",
            "context_csv": "Complete cadastral context CSV",
            "county_coverage_csv": "County source coverage CSV",
            "county_sources_csv": "Original county source editions CSV",
            "excluded_records_csv": "Excluded original records CSV",
            "geometry_corrections": "Original geometry corrections",
            "methods": "Parcel methods and units",
            "import_manifest": "Original source import manifest",
            "report": "Printable parcel source report",
        }
        for name, label in labels.items():
            item = value["files"].get(name)
            if not item:
                continue
            path = relative_file(ws.root, item["path"])
            result["_downloads"].append(self.operator._ticket(workspace, path, item, label))
        return result

    def read(self, workspace_key, operation, payload=None):
        self.operator.ws(workspace_key)
        value = payload or {}
        if not isinstance(value, dict):
            self._error("Choose a parcel source selection.")
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            data = model.overview(ws)
            data["roots"] = [{"id": key, "label": str(path)} for key, path in self.roots.items()]
            data["workspace_key"] = workspace_key
            return data
        if operation == "directories":
            return self._browse(value)
        if operation == "capture":
            path, locator = self._directory(value)
            return {**model.preview(path), "locator": locator}
        if operation == "edition":
            return self._edition(workspace_key, self._one(value, "edition_id", self._one(value, "id")))
        if operation == "rows":
            return model.rows(
                ws, self._one(value, "edition_id"), table=self._one(value, "table", "parcels"),
                county=self._one(value, "county", ""), query=self._one(value, "query", ""),
                offset=self._one(value, "offset", 0), limit=self._one(value, "limit", 100),
            )
        if operation == "study-selection":
            spec = value.get("spec") or {}
            if not isinstance(spec, dict):
                self._error("Supply the intended conservation inventory settings.")
            return model.study_selection(ws, self._one(value, "edition_id"), spec)
        self._error("Unknown parcel source operation.", "PARCEL_SOURCE_ROUTE", 404)

    def invoke(self, task):
        ws = self.operator.ws(task["workspace"])
        value = task.get("payload") or {}
        if not isinstance(value, dict):
            self._error("Supply the selected original parcel capture.")
        if task["action"] == "parcel.source.prepare":
            selection = model._expected(value.get("selection"))
            retained = ws.root / "parcel-source-inputs" / digest(selection) / "desk-input-snapshot.json"
            if retained.is_file():
                directory = None
                locator = {"root_id": value.get("root_id"), "path": value.get("path", "")}
            else:
                directory, locator = self._directory(value)
            return model.operate(
                ws, directory, value.get("selection"), title=value.get("title"),
                operation_id=task["id"], locator=locator,
            )
        if task["action"] == "parcel.source.receive":
            directory, locator = self._directory(value)
            from source_tools import reporting_parcels as native
            current = model.preview(directory)
            if identifier(value.get("plan_sha256")) != current["plan_sha256"]:
                self._error("The parcel acquisition plan changed. Refresh and select its current retained edition.",
                            "PARCEL_PLAN_CHANGED", 409)
            requested = value.get("providers") or None
            if requested is not None and (not isinstance(requested, list)
                    or any(not isinstance(item, str) for item in requested)):
                self._error("Choose the original county provider identifiers.")
            retry = value.get("retry_failed", False)
            if not isinstance(retry, bool):
                self._error("Choose whether to retry retained provider failures.")
            outcome = native.receive(directory, providers=requested, retry_failed=retry)
            return {"schema": model.SCHEMA, "kind": "parcel-source-acquisition",
                    "locator": locator, "outcome": outcome, "capture": model.preview(directory)}
        self._error("Unknown parcel source action.", "PARCEL_SOURCE_ACTION", 404)

    def state(self, workspace_key):
        return model.overview(self.operator.ws(workspace_key))

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        result = task.get("result")
        if not isinstance(result, dict):
            return task
        value = dict(task)
        if task["action"] == "parcel.source.prepare" and result.get("id"):
            edition = self._edition(task["workspace"], result["id"])
            value["_downloads"] = [*value.get("_downloads", []), *edition["_downloads"]]
            value["_parcel_source"] = {
                "edition_id": edition["id"],
                "source_collection_id": edition["source_collection_id"],
                "parcel_count": edition["native_inventory"]["parcel_count"],
                "capture_state": edition["native_inventory"]["capture_state"],
            }
        else:
            capture = result.get("capture") or {}
            value["_parcel_source"] = {
                "capture_state": capture.get("state"),
                "complete_counties": capture.get("complete_counties"),
                "required_counties": capture.get("required_counties"),
                "locator": result.get("locator"),
            }
        return value

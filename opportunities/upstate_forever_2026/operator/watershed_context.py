"""Regional watershed context in the original operator and verified file transport."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from model.common import atomic_bytes, atomic_json, describe_file, held, identifier, now, read_json
from model import watershed_context as context_model

ACTIONS = frozenset({"watershed.context.analyze", "watershed.context.export"})
CONTEXT_NAME = "full-domain-water-context.json"
COVERAGE_NAME = "scdes-domain217-source-coverage.json"
SCHEMA = "upstate.operator-watershed-context/v1"


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _report_identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"watershed-[0-9a-f]{20}", value):
        raise ValueError("Choose a saved regional watershed report.")
    return value


# Version participates in the export identity so older retained exports remain readable.
CSV_FORMAT = "upstate.watershed-context-csv/v2"


def _csv(rows):
    """Use the maintained native field order, JSON cells, booleans and formula protection."""
    return context_model._csv_bytes(rows, context_model.HUC_COLUMNS)


class WatershedContextActions:
    """Application source directories are registered by the original server."""

    def __init__(self, operator, fault, source_roots=()):
        self.operator = operator
        self.Fault = fault
        self.roots = {}
        for supplied in source_roots:
            root = Path(supplied).expanduser().resolve()
            if root.is_dir():
                self.roots.setdefault(_hash(str(root).encode("utf-8"))[:16], root)

    def _source_path(self, root_id, member):
        root = self.roots.get(str(root_id))
        if root is None:
            raise self.Fault("WATERSHED_SOURCE", "Choose a registered regional source directory.", 422)
        if not isinstance(member, str) or not member or "\\" in member:
            raise self.Fault("WATERSHED_SOURCE", "Choose a regional source file from this directory.", 422)
        relative = Path(member)
        if relative.is_absolute() or any(part in {".", ".."} for part in member.split("/")):
            raise self.Fault("WATERSHED_SOURCE", "Choose a regional source file from this directory.", 422)
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise self.Fault("WATERSHED_SOURCE", "The selected regional source file is unavailable.", 404)
        return path

    def _sources(self, ws):
        choices = []
        for collection in ws.sources():
            for entry in collection.get("entries", []):
                if (entry.get("role") == "SOURCE_WATER_CONTEXT"
                        or entry.get("id") == "upper-savannah-water-context-domain217-20261013"):
                    choices.append({
                        "source_collection_id": collection["id"], "source_id": entry["id"],
                        "title": entry.get("title") or collection.get("title") or "Imported regional source edition",
                        "origin": "workspace",
                    })
        seen = set()
        for root_id, root in self.roots.items():
            for found in sorted(root.rglob(CONTEXT_NAME)):
                path = found.resolve()
                if path in seen or not path.is_relative_to(root) or not path.is_file():
                    continue
                seen.add(path)
                coverage = path.with_name(COVERAGE_NAME)
                choices.append({
                    "source_root_id": root_id,
                    "member_path": str(path.relative_to(root).as_posix()),
                    "title": "Regional watershed source / " + path.parent.name,
                    "coverage_member_path": str(coverage.relative_to(root).as_posix())
                        if coverage.is_file() and coverage.resolve().is_relative_to(root) else None,
                })
        return choices

    @staticmethod
    def _summary(record):
        return {key: record.get(key) for key in (
            "id", "title", "state", "created_at", "completed_at", "summary",
            "source_fingerprint", "source_inputs",
        )}

    def export_snapshot(self, workspace):
        ws = self.operator.ws(workspace)
        rows = []
        for path in sorted((ws.root / "watershed-context-exports").glob("*/export.json")):
            record = read_json(path)
            if (record.get("schema") != "upstate.watershed-context-export/v1"
                    or record.get("id") != path.parent.name):
                raise ValueError("A saved watershed selection identity changed.")
            rows.append({key: record.get(key) for key in (
                "id", "title", "state", "created_at", "report_id", "report_sha256",
                "huc12s", "watershed_count", "summary", "source_fingerprint",
            )})
        return sorted(rows, key=lambda row: row.get("created_at") or "", reverse=True)

    def snapshot(self, workspace):
        ws = self.operator.ws(workspace)
        rows = []
        for path in sorted((ws.root / "watershed-context").glob("*/operator-report.json")):
            rows.append(self._summary(read_json(path)))
        return sorted(rows, key=lambda row: row.get("created_at") or "", reverse=True)

    def _report(self, ws, value):
        key = _report_identifier(value.get("report_id") or value.get("id"))
        directory = ws.root / "watershed-context" / key
        record = read_json(directory / "operator-report.json")
        if record.get("id") != key or record.get("schema") != SCHEMA:
            raise ValueError("The selected regional report identity changed.")
        path = directory / "watershed-context.json"
        body = path.read_bytes()
        expected = record.get("files", {}).get("watershed-context.json", {}).get("sha256")
        if not expected or _hash(body) != expected:
            raise ValueError("The saved regional report bytes changed. Rebuild from its retained source.")
        report = json.loads(body)
        if report.get("id") != key:
            raise ValueError("The regional model and operator report identities differ.")
        return directory, record, report

    def _downloads(self, workspace, directory, record, filename, title):
        downloads = self.operator._files(workspace, record, directory)
        downloads.append(self.operator._ticket(
            workspace, directory / filename, describe_file(directory, directory / filename), title,
        ))
        return downloads

    def read(self, workspace, operation, value=None):
        value = value or {}
        ws = self.operator.ws(workspace)
        if operation == "catalog":
            return {
                "workspace_key": workspace,
                "reports": self.snapshot(workspace),
                "exports": self.export_snapshot(workspace),
                "sources": self._sources(ws),
            }
        if operation == "export":
            key = identifier(value.get("export_id") or value.get("id"))
            directory = ws.root / "watershed-context-exports" / key
            result = read_json(directory / "export.json")
            if (result.get("id") != key
                    or result.get("schema") != "upstate.watershed-context-export/v1"):
                raise ValueError("The selected watershed export identity changed.")
            return {**result, "_downloads": self._downloads(
                workspace, directory, result, "export.json", "Watershed selection and source manifest",
            )}
        directory, record, report = self._report(ws, value)
        if operation == "huc":
            huc12 = str(value.get("huc12") or "")
            row = next((row for row in report["hucs"] if row["huc12"] == huc12), None)
            if row is None:
                raise self.Fault("WATERSHED_HUC", "Choose a watershed in the saved regional report.", 404)
            return {
                "report_id": record["id"], "huc": row,
                "classification_coverage": report.get("classification_coverage"),
                "sources": report.get("sources", []), "source_inputs": record.get("source_inputs", []),
                "source_supporting_inputs": record.get("source_supporting_inputs", []),
                "methods": report.get("methods"), "source_fingerprint": record["source_fingerprint"],
            }
        if operation != "report":
            raise self.Fault("WATERSHED_READ", "Choose a regional watershed view.", 404)
        return {
            **record, "report": report,
            "_downloads": self._downloads(
                workspace, directory, record, "operator-report.json", "Regional watershed source manifest",
            ),
        }

    @staticmethod
    def _retain_sources(directory, bodies, files):
        source_directory = directory / "source"
        for name, body in bodies.items():
            member = "source/" + name
            expected = files.get(member)
            path = source_directory / name
            if expected and (expected.get("path") != member
                    or expected.get("sha256") != _hash(body)
                    or expected.get("bytes") != len(body)):
                raise ValueError("A retained original source has different named bytes: " + name)
            if path.is_symlink() or (path.exists() and path.read_bytes() != body):
                raise ValueError("A retained original source has different named bytes: " + name)
        source_directory.mkdir(exist_ok=True)
        for name, body in bodies.items():
            path = source_directory / name
            atomic_bytes(path, body, immutable=True)
            files["source/" + name] = describe_file(directory, path)

    @staticmethod
    def _supporting_metadata(previous, incoming):
        indexed = {}
        for row in list(previous) + list(incoming):
            name = row["id"]
            if name in indexed and indexed[name] != row:
                raise ValueError("A retained original source has different named bytes: " + name)
            indexed[name] = row
        return [indexed[name] for name in sorted(indexed)]

    @staticmethod
    def _validation_with_supporting(previous, current, supporting):
        checks = dict(previous.get("original_source_checks", {}))
        for name, value in current.get("original_source_checks", {}).items():
            retained = checks.get(name, {})
            checks[name] = {**retained, **value}
            if "domain_object_ids_matched" in retained or "domain_object_ids_matched" in value:
                checks[name]["domain_object_ids_matched"] = (
                    retained.get("domain_object_ids_matched") is True
                    or value.get("domain_object_ids_matched") is True)
        return {
            **previous, **current, "original_source_checks": checks,
            "supporting_sources": [
                {"name": row["id"], "bytes": row["bytes"], "sha256": row["sha256"]}
                for row in supporting
            ],
        }

    def _analyze(self, task):
        ws = self.operator.ws(task["workspace"])
        value = task.get("payload") or {}
        selection = value.get("selection", value)
        root_id = selection.get("source_root_id")
        collection_id = selection.get("source_collection_id")
        source_id = selection.get("source_id")
        if collection_id or source_id:
            matches = [
                entry for collection in ws.sources() if collection.get("id") == collection_id
                for entry in collection.get("entries", []) if entry.get("id") == source_id
                and (entry.get("role") == "SOURCE_WATER_CONTEXT"
                     or entry.get("id") == "upper-savannah-water-context-domain217-20261013")
            ]
            if len(matches) != 1:
                raise ValueError("Choose the imported regional watershed source edition.")
            context_path = Path(ws.source_file(collection_id, source_id)[0]).resolve()
        else:
            context_path = self._source_path(root_id, selection.get("member_path"))
            if context_path.name != CONTEXT_NAME:
                raise ValueError("Choose the retained full-domain watershed source.")
        from source_tools.prepare_watershed_context import load_source_edition
        edition = load_source_edition(context_path.parent)
        report = context_model.build_watershed_context(
            edition["source_context"], classification_coverage=edition["classification_coverage"],
            network=edition.get("native_network"),
        )
        key = _report_identifier(report["id"])
        bodies = {}
        source_inputs = []
        supporting_inputs = []
        for rows, retained in (
                (edition["source_files"], source_inputs),
                (edition.get("supporting_files", []), supporting_inputs)):
            for row in rows:
                name = row["name"]
                if (not isinstance(name, str) or Path(name).name != name
                        or name in {"", ".", ".."} or name in bodies):
                    raise ValueError("The source edition contains an unsupported companion filename.")
                body = Path(row["path"]).read_bytes()
                if _hash(body) != row["sha256"] or len(body) != row["bytes"]:
                    raise ValueError("The regional source changed during analysis: " + name)
                bodies[name] = body
                retained.append({
                    "id": name, "member_path": name, "sha256": row["sha256"],
                    "bytes": row["bytes"], "hash_basis": "exact source bytes",
                })
        source_inputs.sort(key=lambda row: row["id"])
        supporting_inputs.sort(key=lambda row: row["id"])
        fingerprint = _hash(json.dumps(
            [{"id": row["id"], "sha256": row["sha256"]} for row in source_inputs],
            sort_keys=True, separators=(",", ":"),
        ).encode("utf-8"))
        directory = ws.root / "watershed-context" / key
        record_path = directory / "operator-report.json"
        with held(ws.root / ".workspace.lock"):
            if record_path.is_file():
                old = read_json(record_path)
                if old.get("source_fingerprint") != fingerprint:
                    raise ValueError("This report identity already belongs to different retained source bytes.")
                self._report(ws, {"report_id": key})
                supporting = self._supporting_metadata(
                    old.get("source_supporting_inputs", []), supporting_inputs)
                retained_files = dict(old["files"])
                self._retain_sources(directory, bodies, retained_files)
                updated = {
                    **old, "files": retained_files, "source_supporting_inputs": supporting,
                    "source_validation": self._validation_with_supporting(
                        old.get("source_validation", {}), edition["validation"], supporting),
                }
                if updated != old:
                    updated["sources_updated_at"] = now()
                    atomic_json(record_path, updated)
                return self._summary(updated)
            directory.mkdir(parents=True, exist_ok=True)
            files = context_model.write_watershed_context(report, directory)
            self._retain_sources(directory, bodies, files)
            record = {
                "schema": SCHEMA, "id": key,
                "title": str(value.get("title") or "Regional watershed context"),
                "state": "complete", "created_at": now(), "completed_at": now(),
                "summary": report.get("summary", {}),
                "source_root_id": root_id, "source_collection_id": collection_id, "source_id": source_id,
                "source_validation": self._validation_with_supporting(
                    {}, edition["validation"], supporting_inputs),
                "source_inputs": source_inputs, "source_supporting_inputs": supporting_inputs,
                "source_fingerprint": fingerprint, "files": files,
            }
            atomic_json(record_path, record)
        return self._summary(record)

    def _export(self, task):
        ws = self.operator.ws(task["workspace"])
        value = task.get("payload") or {}
        directory, record, report = self._report(ws, value)
        chosen = value.get("huc12s")
        if not isinstance(chosen, list) or not chosen or any(not isinstance(key, str) for key in chosen):
            raise ValueError("Choose one or more watershed records to export.")
        selected = sorted(set(chosen))
        indexed = {row["huc12"]: row for row in report["hucs"]}
        if set(selected) - indexed.keys():
            raise ValueError("The export contains a watershed outside this saved regional report.")
        report_sha = record["files"]["watershed-context.json"]["sha256"]
        identity = {
            "report_id": record["id"], "report_sha256": report_sha, "huc12s": selected,
            "csv_format": CSV_FORMAT, "csv_columns": list(context_model.HUC_COLUMNS),
        }
        key = _hash(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        target = ws.root / "watershed-context-exports" / key
        with held(ws.root / ".workspace.lock"):
            path = target / "export.json"
            if path.is_file():
                return read_json(path)
            target.mkdir(parents=True, exist_ok=True)
            rows = [indexed[huc] for huc in selected]
            selection = {
                **context_model.selected_watershed_export(report, selected),
                "export_id": key, **identity,
                "source_fingerprint": record["source_fingerprint"],
                "source_inputs": record["source_inputs"],
            }
            atomic_json(target / "selected-watersheds.json", selection)
            (target / "selected-watersheds.csv").write_bytes(_csv(rows))
            result = {
                "schema": "upstate.watershed-context-export/v1", "id": key,
                "title": "Regional watershed selection", "state": "complete", "created_at": now(),
                **identity, "watershed_count": len(rows), "summary": selection.get("summary", {}),
                "source_fingerprint": record["source_fingerprint"], "files": {
                    name: describe_file(target, target / name)
                    for name in ("selected-watersheds.json", "selected-watersheds.csv")
                },
            }
            atomic_json(path, result)
        return result

    def invoke(self, task):
        if task.get("action") == "watershed.context.analyze":
            return self._analyze(task)
        if task.get("action") == "watershed.context.export":
            return self._export(task)
        raise self.Fault("WATERSHED_ACTION", "Choose a regional watershed operation.", 422)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        kind = "export" if task["action"] == "watershed.context.export" else "report"
        result = task["result"]
        row = self.read(task["workspace"], kind, {kind + "_id": result["id"]})
        return {
            **task, "_watershed_context": {"kind": kind, "id": result["id"]},
            "_downloads": row["_downloads"],
        }

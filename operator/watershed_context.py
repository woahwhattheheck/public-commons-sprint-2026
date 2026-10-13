"""Regional watershed context in the original operator and verified file transport."""
from __future__ import annotations

import gzip
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

from model.common import atomic_bytes, atomic_json, describe_file, digest, held, identifier, now, read_json
from source_tools.watershed_source_entry import capture_source_entry, retain_source_entry
from model import watershed_context as context_model
from model.utility_watershed_context import utility_selections, PROFILE_NAME
from model import utility_observed_context as observed_model
from model import watershed_briefing as briefing_model
from model import utility_monitoring
from model.watershed_brief import (
    BRIEF_FORMAT, selection_with_contributing_context, write_selection_brief,
)

ACTIONS = frozenset({"watershed.context.analyze", "watershed.context.export",
                     "watershed.context.receive", "watershed.context.monitoring"})
CONTEXT_NAME = "full-domain-water-context.json"
COVERAGE_NAME = "scdes-domain217-source-coverage.json"
SCHEMA = "upstate.operator-watershed-context/v1"
NETWORK_NAMES = ("usgs-wbd-savannah-original-topology-20261013.json",
                 "native-network.json", "native-network.json.gz", "model-domain.esri.json.gz")
NETWORK_ROLES = {"NATIVE_HUC_NETWORK", "WBD_HUC12_NETWORK", "HUC12_NETWORK"}



def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _report_identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"watershed-[0-9a-f]{20}", value):
        raise ValueError("Choose a saved regional watershed report.")
    return value


def _source_member(value):
    """Accept canonical relative member names, including native source sidecars."""
    if (not isinstance(value, str) or not value or "\\" in value
            or any(ord(character) < 32 for character in value)):
        raise ValueError("Choose a safe relative source member.")
    member = PurePosixPath(value)
    if (member.is_absolute() or member.as_posix() != value
            or any(part in {"", ".", ".."} for part in value.split("/"))):
        raise ValueError("Choose a safe relative source member.")
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

    def _team_administrator(self):
        team = getattr(self.operator, "team", None)
        context = team.current() if team else None
        return not context or context["principal"]["administrator"]

    def _source_path(self, root_id, member):
        team = getattr(self.operator, "team", None)
        context = team.current() if team else None
        if context:
            team.require(context["principal"], administrator=True)
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
        if not self._team_administrator():
            return choices
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

    def _network_sources(self, ws):
        choices, seen = [], set()
        for collection in ws.sources():
            for entry in collection.get("entries", []):
                if entry.get("role") not in NETWORK_ROLES and str(entry.get("path") or "").rsplit("/", 1)[-1] not in NETWORK_NAMES:
                    continue
                path = Path(ws.source_file(collection["id"], entry["id"])[0]).resolve()
                body = path.read_bytes()
                identity = _hash(body)
                seen.add(identity)
                choices.append({
                    "source_collection_id": collection["id"], "source_id": entry["id"],
                    "title": entry.get("title") or "Retained native HUC12 / ToHUC network",
                    "sha256": identity, "bytes": len(body), "origin": "workspace",
                })
        if not self._team_administrator():
            return choices
        for root_id, root in self.roots.items():
            for name in NETWORK_NAMES:
                for found in sorted(root.rglob(name)):
                    path = found.resolve()
                    if not path.is_relative_to(root) or not path.is_file():
                        continue
                    body = path.read_bytes()
                    identity = _hash(body)
                    if identity in seen:
                        continue
                    seen.add(identity)
                    choices.append({
                        "source_root_id": root_id, "member_path": path.relative_to(root).as_posix(),
                        "title": "Original USGS Savannah HUC12 / ToHUC" if name == NETWORK_NAMES[0]
                                 else "Retained native network / " + path.parent.name,
                        "sha256": identity, "bytes": len(body), "origin": "registered",
                    })
        return choices

    def _selected_network(self, ws, selection):
        if not isinstance(selection, dict):
            raise ValueError("Choose an original native network from the regional source catalogue.")
        if selection.get("source_collection_id") or selection.get("source_id"):
            path = Path(ws.source_file(selection.get("source_collection_id"), selection.get("source_id"))[0]).resolve()
        else:
            path = self._source_path(selection.get("source_root_id"), selection.get("member_path"))
        body = path.read_bytes()
        if not selection.get("sha256") or _hash(body) != selection["sha256"]:
            raise ValueError("The selected original network changed. Refresh the regional source catalogue.")
        compressed = body.startswith(b"\x1f\x8b")
        value = json.loads(gzip.decompress(body) if compressed else body)
        if not isinstance(value, (dict, list)):
            raise ValueError("Select an original JSON network with HUC12 and ToHUC records.")
        from source_tools.prepare_watershed_context import load_native_network_sources
        name = "native-network.json.gz" if compressed else "native-network.json"
        companions = load_native_network_sources(path.parent, name, network_path=path)
        return value, {"name": name, "path": str(path),
                       "bytes": len(body), "sha256": _hash(body)}, companions

    @staticmethod
    def _summary(record):
        return {key: record.get(key) for key in (
            "id", "title", "state", "created_at", "completed_at", "summary",
            "source_fingerprint", "source_inputs", "source_edition_fingerprint",
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


    def _utility_choices(self, report):
        """Resolve the retained original profile once per distinct source edition."""
        profiles, seen, bodies = [], set(), {}
        application = Path(__file__).resolve().parents[1]
        roots = [application, *self.roots.values()]
        for root in roots:
            candidates = ([root / "source" / "receptor-topology" / "20261013" / PROFILE_NAME]
                          if root == application else sorted(root.rglob(PROFILE_NAME)))
            for found in candidates:
                if not found.is_file():
                    continue
                path = found.resolve()
                if not path.is_relative_to(root.resolve()):
                    raise ValueError("The utility profile leaves its registered source directory")
                body = path.read_bytes()
                source_hash = _hash(body)
                if source_hash in seen:
                    continue
                seen.add(source_hash)
                original = json.loads(body)
                identity = {"filename": PROFILE_NAME, "bytes": len(body), "sha256": source_hash,
                            "schema": original.get("schema"), "title": original.get("title")}
                profiles.extend(utility_selections(report, original, identity))
                bodies[source_hash] = body
        return profiles, bodies

    def read(self, workspace, operation, value=None):
        value = value or {}
        ws = self.operator.ws(workspace)
        if operation == "catalog":
            return {
                "workspace_key": workspace,
                "reports": self.snapshot(workspace),
                "exports": self.export_snapshot(workspace),
                "sources": self._sources(ws),
                "networks": self._network_sources(ws),
                "utility_monitoring": utility_monitoring.catalog(ws),
            }
        if operation == "monitoring":
            key = identifier(value.get("monitoring_id") or value.get("id"))
            result = utility_monitoring.inspect(ws, key)
            directory = ws.root / utility_monitoring.FOLDER / key
            return {**result, "_downloads": self._downloads(
                workspace, directory, result, "operation.json", "Utility monitoring preparation")}
        if operation == "export":
            key = identifier(value.get("export_id") or value.get("id"))
            directory = ws.root / "watershed-context-exports" / key
            result = read_json(directory / "export.json")
            if (result.get("id") != key
                    or result.get("schema") != "upstate.watershed-context-export/v1"):
                raise ValueError("The selected watershed export identity changed.")
            _, parent, _ = self._report(ws, {"report_id": result["report_id"]})
            if parent["files"]["watershed-context.json"]["sha256"] != result["report_sha256"]:
                raise ValueError("The saved selection belongs to different parent report bytes.")
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
            "_utility_selections": self._utility_choices(report)[0],
            "_observed_context": observed_model.catalog(Path(__file__).resolve().parents[1]),
            "_downloads": self._downloads(
                workspace, directory, record, "operator-report.json", "Regional watershed source manifest",
            ),
        }

    @staticmethod
    def _retain_sources(directory, bodies, files):
        source_directory = directory / "source"
        if source_directory.is_symlink():
            raise ValueError("The retained source directory must be an original workspace directory.")
        source_root = source_directory.resolve()
        for name, body in bodies.items():
            _source_member(name)
            member = "source/" + name
            expected = files.get(member)
            path = source_directory / name
            if not path.parent.resolve().is_relative_to(source_root):
                raise ValueError("The retained source member leaves its source directory: " + name)
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

    @staticmethod
    def _retain_source_entries(directory, files, closures, fingerprint, supporting, previous=None):
        """Retain whole imported entries and bind this exact source edition."""
        entries = []
        for purpose, closure in closures:
            prefix = "source/entries/" + closure["source_edition_fingerprint"]
            files.update(retain_source_entry(closure, directory, source_prefix=prefix))
            entries.append({
                "purpose": purpose,
                "source_collection_id": closure["source_collection_id"],
                "source_id": closure["source_id"],
                "source_edition_fingerprint": closure["source_edition_fingerprint"],
                "body_member_path": prefix + "/" + closure["body_view_path"],
                "manifest_path": prefix + "/_source-entry-manifest.json",
                "record_path": prefix + "/_source-entry.json",
                "member_count": len(closure["members"]),
            })
        identity = {
            "schema": "upstate.watershed-source-edition/v1",
            "report_id": directory.name, "path_basis": "report_directory",
            "model_input_fingerprint": fingerprint,
            "source_entries": sorted(entries, key=lambda row: (row["purpose"], row["source_id"])),
            "supporting_inputs": [
                {key: row[key] for key in ("id", "member_path", "bytes", "sha256")}
                for row in sorted(supporting, key=lambda row: row["id"])
            ],
        }
        edition_fingerprint = digest(identity)
        manifest = {**identity, "source_edition_fingerprint": edition_fingerprint}
        path = directory / "source" / "editions" / (edition_fingerprint + ".json")
        atomic_json(path, manifest, immutable=True)
        descriptor = describe_file(directory, path)
        files[descriptor["path"]] = descriptor
        editions = dict((previous or {}).get("source_editions", {}))
        if edition_fingerprint in editions and editions[edition_fingerprint] != manifest:
            raise ValueError("The retained complete source edition changed.")
        editions[edition_fingerprint] = manifest
        return {
            "source_edition_fingerprint": edition_fingerprint,
            "source_edition": manifest,
            "source_editions": editions,
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
        closures = []
        if collection_id:
            closure = capture_source_entry(
                ws, collection_id, source_id, model_inputs=edition["source_files"])
            if closure["model_input_fingerprint"] != edition["validation"]["source_fingerprint"]:
                raise ValueError("The complete source entry changed the original calculation inputs.")
            closures.append(("context", closure))
        chosen_native_sources = []
        if selection.get("network"):
            network_choice = selection["network"]
            network, network_source, companions = self._selected_network(ws, network_choice)
            if network_choice.get("source_collection_id"):
                closure = capture_source_entry(
                    ws, network_choice["source_collection_id"], network_choice["source_id"],
                    model_inputs=[network_source])
                closures.append(("selected_network", closure))
            chosen_native_sources = [network_source] + companions["supporting_files"]
            checks = dict(edition["validation"].get("original_source_checks", {}))
            previous_native = set(checks.get("native_originals", {}).get("files", []))
            previous_native.add("native-network-source.json")
            checks.pop("native_network_source", None)
            checks.pop("native_originals", None)
            if "complete_source_edition" in checks:
                checks["complete_source_edition"] = {
                    name: item for name, item in checks["complete_source_edition"].items()
                    if not name.startswith("native_network_")
                }
            checks.update(companions["validation"])
            supporting = {
                row["name"]: row for row in edition.get("supporting_files", [])
                if row["name"] not in previous_native
            }
            for row in companions["supporting_files"]:
                previous = supporting.get(row["name"])
                if previous is not None and (previous["sha256"], previous["bytes"]) != (row["sha256"], row["bytes"]):
                    raise ValueError("Chosen native companion conflicts with its source edition: " + row["name"])
                supporting[row["name"]] = row
            edition = {
                **edition, "native_network": network,
                "source_files": [row for row in edition["source_files"]
                                 if row["name"] not in {"native-network.json", "native-network.json.gz"}]
                                + [network_source],
                "supporting_files": [supporting[name] for name in sorted(supporting)],
                "validation": {**edition["validation"], "original_source_checks": checks},
            }
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
                name = _source_member(row["name"])
                if name in bodies:
                    raise ValueError("The source edition repeats a companion member: " + name)
                source_path = Path(row["path"]).resolve(strict=True)
                selected_native = any(row == native for native in chosen_native_sources)
                if ((not selected_native and not source_path.is_relative_to(context_path.parent))
                        or not source_path.is_file()):
                    raise ValueError("The source companion leaves its retained edition: " + name)
                body = source_path.read_bytes()
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
        edition = {**edition, "validation": {
            **edition["validation"], "report_id": report["id"],
            "analysis_version": report["analysis_version"], "summary": report["summary"],
            "classification_coverage": report["classification_coverage"],
            "source_fingerprint": fingerprint, "native_network_supplied": "native_network" in edition,
        }}
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
                source_edition = self._retain_source_entries(
                    directory, retained_files, closures, fingerprint, supporting, old)
                updated = {
                    **old, **source_edition,
                    "files": retained_files, "source_supporting_inputs": supporting,
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
            source_edition = self._retain_source_entries(
                directory, files, closures, fingerprint, supporting_inputs)
            record = {
                **source_edition,
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

    def _receive(self, task):
        from source_tools.receive_watershed_context import receive_completed
        value = task.get("payload") or {}
        upload_id = value.get("upload_id")
        if not isinstance(upload_id, str) or not upload_id:
            raise ValueError("Choose the completed regional run archive.")
        upload = self.operator.upload(upload_id)
        record = receive_completed(
            self.operator.ws(task["workspace"]), Path(upload["path"]),
            expected_sha256=upload["sha256"], title=value.get("title"),
        )
        return self._summary(record)

    @staticmethod
    def _supporting_source_references(record):
        """Expose publisher links bound by the retained source loader."""
        checks = record.get("source_validation", {}).get("original_source_checks", {})
        native = checks.get("native_network_source", {})
        if native.get("status") != "original_bytes_bound" or not native.get("source_uri"):
            return []
        return [{
            "source_id": "native_network",
            "reference": {"uri": native["source_uri"]},
            "source_member": native["source_member"],
            "sha256": native["sha256"],
            "provenance_sha256": native["provenance_sha256"],
        }]

    def _export(self, task):
        ws = self.operator.ws(task["workspace"])
        value = task.get("payload") or {}
        directory, record, report = self._report(ws, value)
        chosen = value.get("huc12s")
        utility, utility_body = None, None
        if value.get("utility_key"):
            choices, profile_bodies = self._utility_choices(report)
            utility = next((row for row in choices if row["key"] == value["utility_key"]), None)
            if utility is None or not utility["available"]:
                raise ValueError("Refresh and select an available original utility footprint")
            if chosen is not None and sorted(set(chosen)) != utility["huc12s"]:
                raise ValueError("The requested utility membership differs from its original network")
            chosen = utility["huc12s"]
            utility_body = profile_bodies[utility["profile_source"]["sha256"]]
        if not isinstance(chosen, list) or not chosen or any(not isinstance(key, str) for key in chosen):
            raise ValueError("Choose one or more watershed records to export.")
        selected = sorted(set(chosen))
        indexed = {row["huc12"]: row for row in report["hucs"]}
        if set(selected) - indexed.keys():
            raise ValueError("The export contains a watershed outside this saved regional report.")
        report_sha = record["files"]["watershed-context.json"]["sha256"]
        selection = selection_with_contributing_context(
            report, selected, report_sha,
            Path(__file__).resolve().parents[1] / "outputs" / "watershed-connectivity-20261013",
        )
        supporting_references = self._supporting_source_references(record)
        if utility is not None:
            selection["utility_selection"] = utility
            supporting_references.append({
                "source_id": "original_utility_profile", "reference": utility["reference"],
                "sha256": utility["profile_source"]["sha256"],
                "source_member": "original-utility-profile.json",
            })
        observed_context, observed_bodies = (observed_model.load_for_utility(
            Path(__file__).resolve().parents[1], utility) if utility is not None else (None, {}))
        if observed_context is not None:
            selection["observed_context"] = observed_context
        identity = {
            "report_id": record["id"], "report_sha256": report_sha, "huc12s": selected,
            "csv_format": CSV_FORMAT, "csv_columns": list(context_model.HUC_COLUMNS),
            "brief_format": BRIEF_FORMAT, "source_briefing_edition": briefing_model.EDITION,
        }
        if utility is not None:
            identity["utility_selection_sha256"] = utility["key"]
        if observed_context is not None:
            identity["observed_context_sha256"] = digest(observed_context)
        if supporting_references:
            identity["brief_source_sha256"] = _hash(json.dumps(
                supporting_references, sort_keys=True, separators=(",", ":"),
            ).encode("utf-8"))
        if record.get("source_edition_fingerprint"):
            identity["source_edition_fingerprint"] = record["source_edition_fingerprint"]
        if selection.get("contributing_context") is not None:
            identity["contributing_context_sha256"] = _hash(json.dumps(
                selection["contributing_context"], sort_keys=True, separators=(",", ":"),
                ensure_ascii=False, allow_nan=False,
            ).encode("utf-8"))
        key = _hash(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        target = ws.root / "watershed-context-exports" / key
        with held(ws.root / ".workspace.lock"):
            path = target / "export.json"
            if path.is_file():
                return read_json(path)
            target.mkdir(parents=True, exist_ok=True)
            rows = [indexed[huc] for huc in selected]
            selection = {
                **selection,
                "export_id": key, **identity,
                "source_fingerprint": record["source_fingerprint"],
                "source_inputs": record["source_inputs"],
                "source_edition": record.get("source_edition"),
                "source_edition_path_basis": "parent_report_directory",
                "source_edition_report_id": record["id"],
                "supporting_source_references": supporting_references,
            }
            if utility_body is not None:
                atomic_bytes(target / "original-utility-profile.json", utility_body, immutable=True)
            atomic_json(target / "selected-watersheds.json", selection)
            (target / "selected-watersheds.csv").write_bytes(_csv(rows))
            observed_files = (observed_model.retain(target, observed_context, observed_bodies)
                              if observed_context is not None else {})
            brief_files = write_selection_brief(target, selection)
            result = {
                "schema": "upstate.watershed-context-export/v1", "id": key,
                "title": utility["title"] if utility is not None else "Regional watershed selection",
                "state": "complete", "created_at": now(),
                **identity, "watershed_count": len(rows), "summary": selection.get("summary", {}),
                "source_fingerprint": record["source_fingerprint"], "files": {
                    name: describe_file(target, target / name)
                    for name in ("selected-watersheds.json", "selected-watersheds.csv")
                },
            }
            if selection.get("contributing_context") is not None:
                result["contributing_summary"] = selection["contributing_context"]["summary"]
            if utility is not None:
                result["utility_selection"] = utility
                result["files"]["original-utility-profile.json"] = describe_file(
                    target, target / "original-utility-profile.json")
            result["files"].update(brief_files)
            result["files"].update(briefing_model.write(target, selection))
            result["files"].update(observed_files)
            if observed_context is not None:
                result["observed_context"] = {
                    "source": observed_context["source"],
                    "summary": observed_context["utility"]["summary"],
                    "quantity": observed_context["utility"]["model_interpretation"],
                }
            result["files"]["utility-watershed-packet.zip"] = observed_model.write_packet(target, result["files"])
            atomic_json(path, result)
        return result

    def invoke(self, task):
        if task.get("action") == "watershed.context.monitoring":
            return utility_monitoring.prepare(self.operator.ws(task["workspace"]), task.get("payload") or {})
        if task.get("action") == "watershed.context.analyze":
            return self._analyze(task)
        if task.get("action") == "watershed.context.receive":
            return self._receive(task)
        if task.get("action") == "watershed.context.export":
            return self._export(task)
        raise self.Fault("WATERSHED_ACTION", "Choose a regional watershed operation.", 422)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        kind = ("monitoring" if task["action"] == "watershed.context.monitoring" else
                "export" if task["action"] == "watershed.context.export" else "report")
        result = task["result"]
        row = self.read(task["workspace"], kind, {kind + "_id": result["id"]})
        return {
            **task, "_watershed_context": {"kind": kind, "id": result["id"]},
            "_downloads": row["_downloads"],
        }

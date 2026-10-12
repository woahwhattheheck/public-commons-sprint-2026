"""MIT. Retained OECD captures, native revisions and customer briefings."""
from __future__ import annotations

import base64
import csv
import io
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import uuid
import zipfile

from bootstrap import (
    HERE, Catalog, InputError, identity, text, now, digest, json_bytes, load_json,
    private_write, regular, file_digest, sync_dir, qualified,
)
from briefing import build_briefing, render_html, render_csv

SCHEMA = "stellar-forge.oecd-workspace.v1"
CAPTURE = "stellar-forge.oecd-capture.v1"
BUNDLE = "stellar-forge.oecd-source-bundle.v1"
BRIEFING = "stellar-forge.oecd-briefing.v1"
MAX_SOURCE = 16 * 1024 * 1024
MAX_BUNDLE = 32 * 1024 * 1024
FLOW = {"agency_id": "OECD.SDD.STES", "id": "DSD_STES@DF_CLI", "version": "4.1"}
COUNTRIES = ["CAN", "DEU", "FRA", "GBR", "ITA", "JPN", "USA"]
BASIS = {"FREQ": "M", "MEASURE": "LI", "UNIT_MEASURE": "IX", "ACTIVITY": "_Z",
         "ADJUSTMENT": "AA", "TRANSFORMATION": "IX", "TIME_HORIZ": "_Z", "METHODOLOGY": "H"}


def month(value, label, empty=False):
    if empty and value in {None, ""}:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"[12][0-9]{3}-(0[1-9]|1[0-2])", value):
        raise InputError(label + " must be an original monthly YYYY-MM period")
    return value


def selected_countries(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 100:
        raise InputError("Select 1–100 distinct retained country codes")
    if any(not isinstance(v, str) or not re.fullmatch(r"[A-Z0-9_]{2,20}", v) for v in value):
        raise InputError("Country selection must use exact source codes")
    if len(value) != len(set(value)):
        raise InputError("Country selection repeats a code")
    return sorted(value)


def private_root(path, create=False):
    root = Path(path).expanduser().absolute()
    if create:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise InputError("The OECD project must be an operator-owned private directory")
    if create and any(root.iterdir()):
        raise InputError("Initialize a new empty OECD project directory")
    return root.resolve()


def stable_write(path, body):
    if path.is_symlink():
        raise InputError("A retained destination must not be a symbolic link")
    if path.exists():
        regular(path, MAX_BUNDLE)
        if path.read_bytes() != body:
            raise InputError("The retained destination already contains different bytes: " + path.name)
        return
    private_write(path, body)
    sync_dir(path.parent)


def bundle_from_manifest(path):
    path = Path(path).expanduser().resolve()
    manifest = load_json(path.read_bytes())
    if manifest.get("schema") != BUNDLE:
        raise InputError("Use an OECD source-bundle manifest")
    result = {k: v for k, v in manifest.items() if k != "files"}
    result["files"] = []
    for member in manifest.get("files", []):
        name = member.get("path", "")
        if not isinstance(name, str) or not name or "\\" in name:
            raise InputError("Source member paths must be relative POSIX paths")
        location = path.parent.joinpath(name).resolve()
        if path.parent not in location.parents:
            raise InputError("A source member escapes its manifest directory")
        raw = location.read_bytes()
        if len(raw) > MAX_SOURCE:
            raise InputError("Source member exceeds 16 MiB")
        result["files"].append({**{k: v for k, v in member.items() if k != "path"},
                                "name": Path(name).name,
                                "content_base64": base64.b64encode(raw).decode("ascii")})
    return result


class OecdWorkspace:
    def __init__(self, directory, create=False):
        self.root = private_root(directory, create)
        path = self.root / "oecd-project.json"
        if create:
            private_write(path, json_bytes({"schema": SCHEMA, "id": uuid.uuid4().hex, "created_at": now()}))
            for name in ("reports", "exports", "tmp"):
                (self.root / name).mkdir(mode=0o700)
        regular(path)
        self.config = load_json(path.read_bytes())
        if self.config.get("schema") != SCHEMA:
            raise InputError("This directory is not an OECD analyst project")
        self.catalog = Catalog(self.root / "catalog", create=create)
        self.source = self.catalog.source
        self.db, self.mutex = self.catalog.db, self.catalog.mutex
        with self.db:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS oecd_operations(
                    operation TEXT PRIMARY KEY, request_sha TEXT NOT NULL, request TEXT NOT NULL,
                    result TEXT, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS oecd_captures(
                    id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS oecd_briefings(
                    id TEXT PRIMARY KEY, operation TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
            """)

    def close(self):
        self.catalog.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def _operation(self, operation, request):
        text(operation, "Operation identity", 160)
        encoded = json_bytes(request)
        row = self.db.execute("SELECT * FROM oecd_operations WHERE operation=?", (operation,)).fetchone()
        if row:
            if row["request_sha"] != digest(encoded):
                raise InputError("This operation identity already belongs to a different request")
            return load_json(row["result"]) if row["result"] else None
        with self.db:
            self.db.execute("INSERT INTO oecd_operations VALUES(?,?,?,?,?)",
                            (operation, digest(encoded), encoded.decode(), None, now()))
        return None

    def _complete(self, operation, result):
        with self.db:
            self.db.execute("UPDATE oecd_operations SET result=? WHERE operation=?",
                            (json_bytes(result).decode(), operation))
        return result

    def state(self):
        with self.mutex:
            captures = [load_json(r[0]) for r in self.db.execute("SELECT body FROM oecd_captures ORDER BY rowid DESC")]
            briefings = [load_json(r[0]) for r in self.db.execute("SELECT body FROM oecd_briefings ORDER BY rowid DESC")]
            return {"schema": SCHEMA, "project": {**self.config, "directory": str(self.root)},
                    "captures": captures, "briefings": briefings, "catalog": self.catalog.state(),
                    "profile": {"flow": FLOW, "basis": BASIS, "default_countries": COUNTRIES}}

    def capture(self, body):
        if not isinstance(body, dict) or body.get("schema") != BUNDLE:
            raise InputError("Use the complete OECD source bundle")
        operation = text(body.get("operation_id"), "Operation identity", 140)
        label = text(body.get("label", "OECD composite leading indicators"), "Capture label", 240)
        members = body.get("files")
        if not isinstance(members, list) or not 3 <= len(members) <= 32:
            raise InputError("A capture needs the original data, dataflow, DSD and referenced codelists")
        prepared, seen, total = [], set(), 0
        for item in members:
            if not isinstance(item, dict):
                raise InputError("Every source member must be an object")
            name = text(item.get("name"), "Source filename", 256)
            if Path(name).name != name or name in seen:
                raise InputError("Use distinct source basenames")
            seen.add(name)
            try:
                raw = base64.b64decode(item.get("content_base64", ""), validate=True)
            except (ValueError, TypeError) as error:
                raise InputError("Source member has invalid base64") from error
            total += len(raw)
            if not raw or len(raw) > MAX_SOURCE or total > MAX_BUNDLE:
                raise InputError("Source bundle exceeds its member or total byte limit")
            expected = identity(item.get("sha256"))
            if digest(raw) != expected or (item.get("bytes") is not None and item["bytes"] != len(raw)):
                raise InputError("Source member bytes differ from the retained manifest")
            kind = item.get("kind", "structure")
            if kind not in {"data", "structure", "catalog"}:
                raise InputError("Source member kind must be data, structure or catalog")
            metadata = {"name": name, "label": item.get("label", name),
                        "origin": item.get("origin", ""), "kind": kind, "media_type": "application/xml",
                        "receipt": item.get("receipt", {})}
            prepared.append((raw, metadata, expected))
        if sum(m[1]["kind"] == "data" for m in prepared) != 1:
            raise InputError("A capture selects exactly one original data response")
        request = {"schema": CAPTURE, "label": label, "files": [
            {"sha256": expected, "bytes": len(raw), **metadata} for raw, metadata, expected in prepared]}
        with self.mutex:
            old = self._operation(operation, request)
            if old:
                return old
            sources = []
            for raw, metadata, expected in prepared:
                source = self.source.add_source(io.BytesIO(raw), metadata)
                if source["id"] != expected:
                    raise InputError("The original workspace returned a different source identity")
                sources.append(source)
            data = next(s for s in sources if s["kind"] == "data")
            metadata_ids = sorted(s["id"] for s in sources if s["id"] != data["id"])
            metadata = self.source._metadata(metadata_ids + [data["id"]], qualified(FLOW))
            flow = metadata["flows"][0]
            if any(flow.get(k) != FLOW[k] for k in FLOW):
                raise InputError("This application requires the explicitly selected OECD CLI dataflow version")
            available = []
            offset = 0
            while True:
                result = self.source.series(data["id"], offset, 1000)
                for row in result["rows"]:
                    dims = row["dimensions"]
                    if all(dims.get(k) == v for k, v in BASIS.items()):
                        available.append({"country": dims.get("REF_AREA", ""), "series_key": row["series_key"],
                                          "dimensions": dims, "observations": row["observation_count"]})
                offset += len(result["rows"])
                if offset >= result["total"]:
                    break
                if not result["rows"]:
                    raise InputError("Original source pagination stopped before its terminal total")
            if not available:
                raise InputError("The response has no amplitude-adjusted monthly CLI series in the selected basis")
            if len({s["country"] for s in available}) != len(available):
                raise InputError("The capture repeats a country across source datasets; retain the intended single dataset")
            result = {"schema": CAPTURE, "id": digest(json_bytes(request)), "operation_id": operation,
                      "label": label, "data_source_id": data["id"], "metadata_source_ids": metadata_ids,
                      "flow": flow, "metadata_sha256": metadata["sha256"], "sources": sources,
                      "series": sorted(available, key=lambda s: s["country"]), "created_at": now()}
            with self.db:
                existing = self.db.execute("SELECT body FROM oecd_captures WHERE id=?", (result["id"],)).fetchone()
                if existing:
                    result = load_json(existing[0])
                else:
                    self.db.execute("INSERT INTO oecd_captures VALUES(?,?)", (result["id"], json_bytes(result).decode()))
            return self._complete(operation, result)

    def captured(self, ident):
        identity(ident)
        row = self.db.execute("SELECT body FROM oecd_captures WHERE id=?", (ident,)).fetchone()
        if not row:
            raise InputError("Unknown retained OECD capture")
        result = load_json(row[0])
        for source in result["sources"]:
            self.source._source_path(source["id"])
        return result

    def preview(self, body):
        if not isinstance(body, dict) or set(body) - {"operation_id", "capture_id", "countries", "start_period",
                "end_period", "title", "notes", "project_id", "expected_revision"}:
            raise InputError("Briefing selection must contain only supported fields")
        capture = self.captured(body.get("capture_id"))
        countries = selected_countries(body.get("countries", [s["country"] for s in capture["series"]]))
        available = {s["country"]: s for s in capture["series"]}
        missing = sorted(set(countries) - set(available))
        if missing:
            raise InputError("Selected country is absent from this retained response: " + ", ".join(missing))
        start = month(body.get("start_period", "2024-01"), "Start period")
        end = month(body.get("end_period"), "End period", True)
        if end and start > end:
            raise InputError("The end period precedes the start period")
        title = text(body.get("title", "OECD leading-indicator briefing"), "Briefing title", 128)
        notes = text(body.get("notes", ""), "Analyst notes", 32000, empty=True)
        operation = text(body.get("operation_id"), "Operation identity", 130)
        project_id = body.get("project_id")
        expected = body.get("expected_revision")
        if project_id is not None:
            identity(project_id, re.compile(r"[0-9a-f]{32}\Z"))
            view = self.source.project(project_id)
            if expected != view["current_revision"]:
                raise InputError("Refresh the original project revision before saving")
        elif expected not in {None, 0}:
            raise InputError("A new project starts at revision zero")
        normalized = {"operation_id": operation, "capture_id": capture["id"], "countries": countries,
                      "start_period": start, "end_period": end, "title": title, "notes": notes,
                      "project_id": project_id, "expected_revision": expected}
        return {"request": normalized, "capture": capture,
                "selection": {"series_keys": sorted(available[c]["series_key"] for c in countries)},
                "source_observations": sum(available[c]["observations"] for c in countries)}

    def save_briefing(self, body):
        with self.mutex:
            # Compare an existing operation before checking its now-advanced revision.
            operation = text(body.get("operation_id"), "Operation identity", 130)
            prior = self.db.execute("SELECT request,result FROM oecd_operations WHERE operation=?", (operation,)).fetchone()
            if prior:
                request = load_json(prior["request"])
                candidate = dict(body)
                for name, default in (("project_id", None), ("expected_revision", None),
                                      ("end_period", None), ("notes", ""), ("start_period", "2024-01"),
                                      ("title", "OECD leading-indicator briefing")):
                    candidate.setdefault(name, default)
                candidate["countries"] = selected_countries(candidate.get("countries",
                    [s["country"] for s in self.captured(candidate.get("capture_id"))["series"]]))
                if json_bytes(request) != json_bytes(candidate):
                    raise InputError("This briefing operation already belongs to another selection")
                if prior["result"]:
                    result = load_json(prior["result"])
                    self.briefing(result["id"])
                    return result
                selection = {"series_keys": sorted(s["series_key"] for s in self.captured(request["capture_id"])["series"]
                                                   if s["country"] in request["countries"])}
                capture = self.captured(request["capture_id"])
            else:
                preview = self.preview(body)
                request, capture, selection = preview["request"], preview["capture"], preview["selection"]
                self._operation(operation, request)
            project_request = {"operation_id": operation + ":source", "title": request["title"],
                "id": request["project_id"], "expected_revision": request["expected_revision"],
                "data_source_id": capture["data_source_id"], "metadata_source_ids": capture["metadata_source_ids"],
                "flow_id": qualified(capture["flow"]), "selection": selection, "notes": request["notes"]}
            with self.catalog._native_environment():
                project = self.source.save_project(project_request)
            edition = self.catalog.save_edition({"operation_id": operation + ":catalog", "title": request["title"],
                "notes": request["notes"], "members": [{"project_id": project["project"]["id"],
                    "revision": project["project"]["revision"], "series_keys": selection["series_keys"]}]})
            report = build_briefing(self.catalog, edition, capture, request)
            ident = digest(json_bytes({"request": request, "edition_id": edition["edition"]["id"]}))
            report["id"] = ident
            directory = self.root / "reports" / ident
            directory.mkdir(mode=0o700, exist_ok=True)
            output = {"briefing.json": json_bytes(report), "briefing.html": render_html(report).encode("utf-8"),
                      "observations.csv": render_csv(report).encode("utf-8")}
            manifest = {}
            for name, raw in output.items():
                stable_write(directory / name, raw)
                manifest[name] = {"sha256": digest(raw), "bytes": len(raw)}
            result = {"schema": BRIEFING, "id": ident, "title": request["title"], "operation_id": operation,
                      "capture_id": capture["id"], "project_id": project["project"]["id"],
                      "project_revision": project["project"]["revision"], "native_snapshot": project["build"]["snapshot"],
                      "catalog_edition_id": edition["edition"]["id"], "selection": request,
                      "report": {"directory": str(directory), "files": manifest},
                      "observation_count": report["observation_count"], "series_count": len(report["series"]),
                      "common_period": report["common_period"], "created_at": edition["edition"]["created_at"]}
            with self.db:
                existing = self.db.execute("SELECT body FROM oecd_briefings WHERE id=?", (ident,)).fetchone()
                if existing:
                    result = load_json(existing[0])
                else:
                    self.db.execute("INSERT INTO oecd_briefings VALUES(?,?,?)", (ident, operation, json_bytes(result).decode()))
            return self._complete(operation, result)

    def briefing(self, ident):
        identity(ident)
        row = self.db.execute("SELECT body FROM oecd_briefings WHERE id=?", (ident,)).fetchone()
        if not row:
            raise InputError("Unknown saved OECD briefing")
        result = load_json(row[0])
        self.catalog.edition(result["catalog_edition_id"])
        for name, expected in result["report"]["files"].items():
            path = self.root / "reports" / ident / name
            if file_digest(path, MAX_BUNDLE) != expected["sha256"]:
                raise InputError("Saved briefing bytes differ from their original report")
        result["document"] = load_json((self.root / "reports" / ident / "briefing.json").read_bytes())
        return result

    def report_file(self, ident, name):
        result = self.briefing(ident)
        if name not in result["report"]["files"]:
            raise InputError("Unknown briefing file")
        return self.root / "reports" / ident / name

    def source_rows(self, ident):
        """Return the original catalog observations used by the customer edition."""
        saved = self.briefing(ident)
        edition = self.catalog.edition(saved["catalog_edition_id"])
        output = []
        for series in edition["series"]:
            offset = 0
            while True:
                result = self.catalog.observations(edition["edition"]["id"], series["id"], offset, 1000)
                output.extend(result["rows"])
                offset += len(result["rows"])
                if offset >= result["total"]:
                    break
                if not result["rows"]:
                    raise InputError("Original catalog row stream ended before its terminal total")
        return {"briefing_id": ident, "catalog_edition_id": edition["edition"]["id"],
                "snapshot": saved["native_snapshot"], "rows": output, "row_count": len(output)}

    def compare(self, before, after):
        before, after = self.briefing(before), self.briefing(after)
        original = self.catalog.compare(before["catalog_edition_id"], after["catalog_edition_id"])
        left = {(r["country"], r["time_period"]): r for s in before["document"]["series"] for r in s["observations"]}
        right = {(r["country"], r["time_period"]): r for s in after["document"]["series"] for r in s["observations"]}
        changes = []
        for key in sorted(set(left) | set(right)):
            a, b = left.get(key), right.get(key)
            if a != b:
                changes.append({"country": key[0], "time_period": key[1],
                                "kind": "added" if a is None else "removed" if b is None else "revised",
                                "before": a, "after": b})
        return {"before": before["id"], "after": after["id"], "native_catalog_comparison": original,
                "report_changes": changes, "comparison_scope": "The two retained report selections and original catalog editions"}

    def activate(self, ident, expected_revision, expected_current):
        result = self.briefing(ident)
        return self.catalog.activate(result["catalog_edition_id"], expected_revision, expected_current)

    def export_dataset(self, ident):
        result = self.briefing(ident)
        directory = self.root / "exports" / (ident + "-dataset")
        with self.catalog._native_environment():
            native = self.source.export_dataset(result["project_id"], directory, result["project_revision"])
        return {"briefing_id": ident, "directory": str(directory), "native": native,
                "project_id": result["project_id"], "revision": result["project_revision"]}

    def export_customer(self, ident):
        result = self.briefing(ident)
        path = self.root / "exports" / (ident + "-customer.zip")
        if not path.exists():
            temporary = self.root / "tmp" / (uuid.uuid4().hex + ".zip")
            self.catalog.export_packet(result["catalog_edition_id"], temporary)
            os.replace(temporary, path)
            sync_dir(path.parent)
        return {"briefing_id": ident, "path": str(path), "bytes": path.stat().st_size,
                "sha256": file_digest(path, 1024 * 1024 * 1024)}

    def export_project(self, ident):
        result = self.briefing(ident)
        destination = self.root / "exports" / (ident + "-project.zip")
        if destination.exists():
            return {"path": str(destination), "bytes": destination.stat().st_size,
                    "sha256": file_digest(destination, 1024 * 1024 * 1024)}
        customer = self.export_customer(ident)
        capture = self.captured(result["capture_id"])
        with tempfile.TemporaryDirectory(dir=self.root / "tmp") as tmp:
            staged = Path(tmp)
            members = {"customer.zip": Path(customer["path"]).read_bytes()}
            for name in result["report"]["files"]:
                members["reports/" + name] = self.report_file(ident, name).read_bytes()
            wrapper = {"schema": "stellar-forge.oecd-project-packet.v1", "project": self.config,
                       "capture": capture, "briefing": {k: v for k, v in result.items() if k != "document"},
                       "operation": load_json(self.db.execute("SELECT request FROM oecd_operations WHERE operation=?",
                                                            (result["operation_id"],)).fetchone()[0]),
                       "files": {name: {"sha256": digest(raw), "bytes": len(raw)} for name, raw in members.items()}}
            members["oecd-packet.json"] = json_bytes(wrapper)
            packet = staged / "project.zip"
            with zipfile.ZipFile(packet, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for name, raw in members.items():
                    archive.writestr(name, raw)
            os.chmod(packet, 0o600)
            os.replace(packet, destination)
            sync_dir(destination.parent)
        return {"path": str(destination), "bytes": destination.stat().st_size,
                "sha256": file_digest(destination, 1024 * 1024 * 1024)}

    def import_project(self, path):
        path = Path(path).expanduser().resolve()
        if path.stat().st_size > 1024 * 1024 * 1024:
            raise InputError("Project packet exceeds 1 GiB")
        with self.mutex, zipfile.ZipFile(path) as archive, tempfile.TemporaryDirectory(dir=self.root / "tmp") as tmp:
            names = archive.namelist()
            if len(names) != len(set(names)) or set(names) != {
                    "oecd-packet.json", "customer.zip", "reports/briefing.json",
                    "reports/briefing.html", "reports/observations.csv"}:
                raise InputError("Project packet has missing, repeated or unrecognized members")
            if sum(i.file_size for i in archive.infolist()) > 2 * 1024 * 1024 * 1024:
                raise InputError("Expanded project packet exceeds 2 GiB")
            wrapper = load_json(archive.read("oecd-packet.json"))
            if wrapper.get("schema") != "stellar-forge.oecd-project-packet.v1":
                raise InputError("Unknown OECD project packet")
            verified = {}
            for name, expected in wrapper.get("files", {}).items():
                if name not in names or name == "oecd-packet.json":
                    raise InputError("Invalid project member declaration")
                raw = archive.read(name)
                if len(raw) != expected["bytes"] or digest(raw) != expected["sha256"]:
                    raise InputError("Project member bytes differ from their retained identity")
                verified[name] = raw
            if set(verified) != set(names) - {"oecd-packet.json"}:
                raise InputError("Project packet leaves a member outside its manifest")
            customer = Path(tmp) / "customer.zip"
            private_write(customer, verified["customer.zip"])
            self.catalog.import_catalog(customer)
            capture, saved, request = wrapper["capture"], wrapper["briefing"], wrapper["operation"]
            identity(capture["id"])
            for source in capture["sources"]:
                if self.source.source(source["id"])["source"]["sha256"] != source["sha256"]:
                    raise InputError("Imported source differs from the original capture")
            with self.db:
                row = self.db.execute("SELECT body FROM oecd_captures WHERE id=?", (capture["id"],)).fetchone()
                if row and load_json(row[0]) != capture:
                    raise InputError("Existing capture identity has different retained metadata")
                self.db.execute("INSERT OR IGNORE INTO oecd_captures VALUES(?,?)",
                                (capture["id"], json_bytes(capture).decode()))
            generated = self.save_briefing(request)
            if generated["id"] != saved["id"] or generated["report"]["files"] != saved["report"]["files"]:
                raise InputError("Reopened report differs from the original customer edition")
            for name, raw in verified.items():
                if name.startswith("reports/") and self.report_file(generated["id"], name.split("/", 1)[1]).read_bytes() != raw:
                    raise InputError("Reopened report bytes differ from the original packet")
            return generated

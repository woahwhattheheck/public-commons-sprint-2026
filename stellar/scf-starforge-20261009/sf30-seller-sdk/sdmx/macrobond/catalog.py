"""MIT. Source-bound customer catalogs for the Macrobond Web API Series Provider."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import threading
import uuid
import zipfile

SDMX = Path(__file__).resolve().parent.parent
if str(SDMX) not in sys.path:
    sys.path.insert(0, str(SDMX))
from sdmx_workspace import (
    Workspace, InputError, MAX_PACKET, MAX_METADATA, HEX, PROJECT_ID,
    digest, identity, text, page, now, json_bytes, load_json,
    private_write, regular, file_digest, sync_dir,
)
from sdmx_source import period_bounds

VERSION = "stellar-forge.macrobond-catalog.v1"
EDITION = "stellar-forge.macrobond-edition.v1"
PACKET = "stellar-forge.macrobond-catalog-packet.v1"
FREQUENCIES = {"A": "annual", "Q": "quarterly", "M": "monthly", "D": "daily",
               "B": "daily", "H": "semiannual", "S": "semiannual", "W": "weekly"}
_ENV_LOCK = threading.RLock()
NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
SERIES_ID = re.compile(r"sdmx_[0-9a-f]{32}\Z")
PROVIDER_METHODS = {"getcapabilities", "loadseries", "loadmeta",
                    "searchseries", "loadtree", "listseries"}


def wire_json(value):
    """Write finite Decimal values as JSON numbers, preserving their decimal value."""
    def encode(item):
        if isinstance(item, Decimal):
            if not item.is_finite():
                raise InputError("Provider values must be finite")
            return str(item)
        if item is None or isinstance(item, (str, bool, int)):
            return json.dumps(item, ensure_ascii=False, allow_nan=False)
        if isinstance(item, float):
            if not math.isfinite(item):
                raise InputError("Provider values must be finite")
            return json.dumps(item, allow_nan=False)
        if isinstance(item, (list, tuple)):
            return "[" + ",".join(encode(v) for v in item) + "]"
        if isinstance(item, dict) and all(isinstance(k, str) for k in item):
            return "{" + ",".join(encode(k) + ":" + encode(v) for k, v in item.items()) + "}"
        raise InputError("Unsupported provider JSON value")
    return (encode(value) + "\n").encode("utf-8")


def projected_number(row):
    if row.get("action") == "Delete":
        raise InputError("A deletion record needs a selected complete source edition before publication")
    value = row.get("value")
    if not row.get("value_present") or value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > 4096 or not NUMBER.fullmatch(value):
        raise InputError("The source value is outside the supported numeric representation")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise InputError("The original source value is not a decimal number") from error
    if not number.is_finite():
        raise InputError("The original source value is not a finite decimal number")
    converted = float(number)
    if not math.isfinite(converted) or (converted == 0 and number != 0):
        raise InputError("The source number exceeds the Macrobond client's numeric range")
    return number


def projected_date(row, frequency):
    start, end = period_bounds(row["time_period"], frequency)
    if not start or not end:
        raise InputError("The source period does not match its declared supported frequency")
    anchor = date.fromisoformat(start)
    if not 1600 <= anchor.year <= 2499 or not 1600 <= date.fromisoformat(end).year <= 2499:
        raise InputError("The Macrobond provider date range is 1600 through 2499")
    return start + "T00:00:00"


def series_identity(flow, key):
    return "sdmx_" + digest(json_bytes([flow, key]))[:32]


def row_page(rows, offset, limit):
    offset, limit = page(offset, limit)
    return {"rows": rows[offset:offset + limit], "total": len(rows),
            "offset": offset, "limit": limit}


def file_record(path):
    return {"bytes": path.stat().st_size, "sha256": file_digest(path, MAX_PACKET)}


def publish_file(source, output):
    output = Path(output).expanduser().absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    expected = file_record(source)
    if output.exists() or output.is_symlink():
        if file_record(output) != expected:
            raise InputError("The existing output belongs to a different retained catalog")
        return {"path": str(output), **expected}
    fd, name = tempfile.mkstemp(prefix=".macrobond-packet-", dir=output.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, "wb") as target, source.open("rb") as origin:
            shutil.copyfileobj(origin, target, 65536)
            target.flush()
            os.fsync(target.fileno())
        try:
            os.link(staged, output)
        except FileExistsError:
            if file_record(output) != expected:
                raise InputError("The existing output belongs to a different retained catalog")
        sync_dir(output.parent)
    finally:
        staged.unlink(missing_ok=True)
    return {"path": str(output), **expected}


class Catalog:
    def __init__(self, root, create=False):
        root = Path(root).expanduser().absolute()
        if root.is_symlink():
            raise InputError("Use a real private catalog directory")
        if create:
            root.mkdir(mode=0o700, parents=True, exist_ok=False)
            private_write(root / "catalog.json", json_bytes({"schema": VERSION}))
        self.root = root.resolve(strict=True)
        regular(self.root / "catalog.json", 8192)
        if load_json((self.root / "catalog.json").read_bytes()) != {"schema": VERSION}:
            raise InputError("Unsupported Macrobond catalog schema")
        info = self.root.stat()
        if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise InputError("Use an operator-owned private catalog directory, mode 0700")
        self.source = Workspace(self.root / "source-workspace", create=create)
        self.mutex = self.source.mutex
        self.db = self.source.db
        try:
            with self.db:
                self.db.executescript("""
                    CREATE TABLE IF NOT EXISTS macrobond_info(id INTEGER PRIMARY KEY,body TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS macrobond_editions(
                        id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,
                        request_sha256 TEXT NOT NULL,request TEXT NOT NULL,body TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS macrobond_current(
                        id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,current TEXT);
                    CREATE TABLE IF NOT EXISTS macrobond_publications(revision INTEGER PRIMARY KEY,body TEXT NOT NULL);
                """)
                self.db.execute("INSERT OR IGNORE INTO macrobond_info VALUES(1,?)",
                    (json_bytes({"schema": VERSION, "id": uuid.uuid4().hex, "created_at": now()}).decode(),))
                self.db.execute("INSERT OR IGNORE INTO macrobond_current VALUES(1,0,NULL)")
            self._closed = False
        except Exception:
            self.source.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        if not getattr(self, "_closed", True):
            self._closed = True
            self.source.close()

    def scratch(self):
        return self.source.scratch()

    @contextmanager
    def _native_environment(self):
        # The original child keeps a private temporary volume for its full lifetime.
        names = ("TMPDIR", "TEMP", "TMP", "SQLITE_TMPDIR")
        with _ENV_LOCK:
            prior = {name: os.environ.get(name) for name in names}
            previous_tempdir = tempfile.tempdir
            try:
                for name in names:
                    os.environ[name] = str(self.source.root / "tmp")
                tempfile.tempdir = str(self.source.root / "tmp")
                yield
            finally:
                tempfile.tempdir = previous_tempdir
                for name, value in prior.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value

    def state(self):
        with self.mutex:
            info = load_json(self.db.execute("SELECT body FROM macrobond_info WHERE id=1").fetchone()[0])
            current = self.db.execute("SELECT revision,current FROM macrobond_current WHERE id=1").fetchone()
            editions = [load_json(row[0])["edition"] for row in
                        self.db.execute("SELECT body FROM macrobond_editions ORDER BY rowid DESC")]
            history = [load_json(row[0]) for row in
                       self.db.execute("SELECT body FROM macrobond_publications ORDER BY revision")]
            return {"schema": VERSION, "workspace": {**info, "path": str(self.root)},
                    "source_state": self.source.state(), "editions": editions,
                    "current": current["current"], "revision": current["revision"],
                    "publications": history}

    def import_packet(self, path):
        with self.mutex, self._native_environment():
            return self.source.import_packet(path)

    def _request(self, body):
        if not isinstance(body, dict) or set(body) - {"operation_id", "title", "notes", "members"}:
            raise InputError("Use operation_id, title, notes and the selected source members")
        operation = text(body.get("operation_id"), "Operation identity", 200)
        title = text(body.get("title"), "Catalog edition title", 240)
        notes = text(body.get("notes", ""), "Analyst notes", 32000, empty=True)
        members = body.get("members")
        if not isinstance(members, list) or not 1 <= len(members) <= 1000:
            raise InputError("Select from 1 to 1000 retained source projects")
        selected, seen = [], set()
        for item in members:
            if not isinstance(item, dict) or set(item) - {"project_id", "revision", "series_keys"}:
                raise InputError("Each member needs its original project, revision and series selection")
            ident = identity(item.get("project_id"), PROJECT_ID)
            revision = item.get("revision")
            if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
                raise InputError("Select an explicit positive source project revision")
            if (ident, revision) in seen:
                raise InputError("Select a project revision once and combine its series selection")
            seen.add((ident, revision))
            keys = item.get("series_keys", [])
            if not isinstance(keys, list) or len(keys) > 100000:
                raise InputError("Series selection must be an array of original series keys")
            keys = sorted(set(text(k, "Original series key", 16384) for k in keys))
            selected.append({"project_id": ident, "revision": revision, "series_keys": keys})
        return {"operation_id": operation, "title": title, "notes": notes,
                "members": sorted(selected, key=lambda m: (m["project_id"], m["revision"]))}

    @contextmanager
    def _index(self, project, revision):
        view = self.source.project(project, revision)
        path = self.source._build_file(view["build"]["id"], "rows.sqlite")
        index = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
        try:
            yield view, index
        finally:
            index.close()

    def _raw_rows(self, series, offset=None, limit=None):
        with self._index(series["source_project"], series["source_revision"]) as (_, index):
            sql = "SELECT body FROM rows WHERE series_key=? ORDER BY period,k"
            args = [series["series_key"]]
            if offset is not None:
                sql += " LIMIT ? OFFSET ?"
                args.extend([limit, offset])
            return [load_json(r[0]) for r in index.execute(sql, args)]

    @contextmanager
    def _row_stream(self, series):
        if series is None:
            yield iter(())
            return
        with self._index(series["source_project"], series["source_revision"]) as (_, index):
            cursor = index.execute(
                "SELECT body FROM rows WHERE series_key=? ORDER BY period,k", (series["series_key"],))
            yield (load_json(row[0]) for row in cursor)

    def _inspect(self, view, index, key):
        rows = index.execute("SELECT body FROM rows WHERE series_key=? ORDER BY period,k", (key,))
        first, count, first_date, last_date, has_weekend = None, 0, None, None, False
        units, multipliers, decimals, issues = set(), set(), set(), []
        lossy, sample, previous = 0, [], None
        frequencies = set()
        def issue(field, message, severity="error"):
            candidate = {"series_key": key, "field": field, "message": message, "severity": severity}
            if candidate not in issues:
                issues.append(candidate)
        for saved in rows:
            row = load_json(saved[0])
            first = first or row
            count += 1
            frequency = row["dimensions"].get("FREQ", "")
            frequencies.add(frequency)
            attrs = row["attributes"]
            units.add(attrs.get("UNIT", ""))
            multipliers.add(attrs.get("UNIT_MULT", ""))
            decimals.add(attrs.get("DECIMALS", ""))
            stamp, number = None, None
            try:
                if frequency not in FREQUENCIES:
                    raise InputError("The retained source frequency has no supported Macrobond calendar")
                stamp = projected_date(row, frequency)
                if previous is not None and stamp <= previous:
                    raise InputError("Source observations must have unique increasing calendar anchors")
                previous = stamp
                first_date = first_date or stamp
                last_date = stamp
                has_weekend = has_weekend or date.fromisoformat(stamp[:10]).weekday() >= 5
            except InputError as error:
                issue("time_period", str(error))
            try:
                number = projected_number(row)
                if number is not None and Decimal(str(float(number))) != number:
                    lossy += 1
            except InputError as error:
                issue("value", str(error))
            if len(sample) < 3:
                sample.append({"time_period": row["time_period"], "value": row["value"],
                               "value_present": row["value_present"], "value_kind": row["value_kind"],
                               "date": stamp, "wire_number": str(number) if number is not None else None,
                               "consumer_number": repr(float(number)) if number is not None else None})
        if first is None:
            raise InputError("A selected series has no retained observations")
        frequency = first["dimensions"].get("FREQ", "")
        if len(frequencies) != 1:
            issue("frequency", "A provider series must retain one source frequency")
        if len(units) != 1 or len(multipliers) != 1:
            issue("unit", "The selected series changes unit or unit multiplier across observations")
        if lossy:
            issue("value", f"{lossy} original values have more decimal precision than the client's binary64 round trip",
                  "warning")
        flow, ident = first["flow"], series_identity(first["flow"], key)
        project, build = view["project"], view["build"]
        unit, multiplier = next(iter(units), ""), next(iter(multipliers), "")
        denom = first["dimensions"].get("CURRENCY_DENOM", "")
        display_unit = unit + ("/" + denom if unit and denom else "")
        if multiplier not in {"", "0"}:
            display_unit += " (source multiplier 10^" + multiplier + ")"
        provenance = {
            "provider": "Stellar Forge retained SDMX catalog",
            "source_flow": flow, "series_key": key, "dimensions": first["dimensions"],
            "source_project": project["id"], "source_revision": project["revision"],
            "native_snapshot": build["snapshot"], "source_metadata_sha256": build["metadata"]["sha256"],
            "original_sources": [{"sha256": s["sha256"], "origin": s.get("origin", ""),
                                  "label": s.get("label", ""), "coverage": s.get("coverage", {})}
                                 for s in view["sources"]],
            "unit": unit, "unit_multiplier": multiplier, "declared_decimals": sorted(decimals),
            "values": "Original decimal values; no rescaling or rounding by SDMX DECIMALS.",
            "calendar": "Explicit source period anchors; the client may insert missing calendar periods.",
            "history": "Customer catalog publications; original source editions remain attached.",
        }
        metadata = {"PrimName": ident, "Description": flow + " / " + key,
                    "Frequency": FREQUENCIES.get(frequency, ""), "StartDate": first_date,
                    "EndDate": last_date,
                    "IHInfo": json.dumps(provenance, ensure_ascii=False, sort_keys=True, indent=2)}
        if display_unit:
            metadata["DisplayUnit"] = display_unit
        if frequency in {"D", "B"} and first_date:
            metadata["DayMask"] = 127 if has_weekend else 62
        return {
            "id": ident, "series_key": key, "flow": flow, "metaData": metadata,
            "frequency": FREQUENCIES.get(frequency, ""), "source_frequency": frequency,
            "unit": unit, "unit_multiplier": multiplier,
            "start_date": metadata["StartDate"], "end_date": metadata["EndDate"],
            "observation_count": count, "source_project": project["id"],
            "source_revision": project["revision"], "source_snapshot": build["snapshot"],
            "source_build": build["id"], "dimensions": first["dimensions"],
            "numeric_preview": sample, "lossy_consumer_values": lossy,
        }, issues

    def preview(self, body):
        request = self._request(body)
        with self.mutex:
            series, projects, issues, seen = [], [], [], set()
            for member in request["members"]:
                with self._index(member["project_id"], member["revision"]) as (view, index):
                    available = [r[0] for r in index.execute("SELECT DISTINCT series_key FROM rows ORDER BY series_key")]
                    selected = member["series_keys"] or available
                    missing = set(selected) - set(available)
                    if missing:
                        raise InputError("Selected series are absent from this source revision: " + ", ".join(sorted(missing)[:5]))
                    projects.append({"project": view["project"],
                        "build": {k: view["build"][k] for k in ("id", "snapshot", "row_count", "series_count")},
                        "sources": view["sources"]})
                    for key in selected:
                        item, found = self._inspect(view, index, key)
                        if item["id"] in seen:
                            raise InputError("The catalog selects the same source series through multiple projects; select one original edition")
                        seen.add(item["id"])
                        series.append(item)
                        issues.extend(found)
            return {"request": request, "projects": projects, "series": sorted(series, key=lambda s: s["id"]),
                    "issues": issues, "row_count": sum(s["observation_count"] for s in series)}

    def _edition_record(self, preview, created_at):
        request, series = preview["request"], preview["series"]
        sources, files = [], {}
        for member in request["members"]:
            view = self.source.project(member["project_id"], member["revision"])
            build = self.source._portable_build(view["build"])
            sources.append({"project_id": member["project_id"], "revision": member["revision"],
                            "snapshot": build["snapshot"], "build_id": build["id"],
                            "semantic_sha256": build["semantic_sha256"],
                            "source_ids": sorted(s["id"] for s in view["sources"])})
            files[member["project_id"] + "/" + str(member["revision"])] = build["files"]
        ident = digest(json_bytes({"schema": EDITION, "request": request, "series": series,
                                   "sources": sources, "files": files}))
        edition = {"schema": EDITION, "id": ident, "title": request["title"],
                   "created_at": created_at, "operation_id": request["operation_id"],
                   "members": request["members"], "notes": request["notes"],
                   "series_count": len(series), "row_count": preview["row_count"],
                   "sources": sources, "files": files}
        return {"edition": edition, "series": series}

    def save_edition(self, body):
        request = self._request(body)
        request_sha = digest(json_bytes(request))
        with self.mutex:
            previous = self.db.execute("SELECT request_sha256,body FROM macrobond_editions WHERE operation_id=?",
                                       (request["operation_id"],)).fetchone()
            if previous:
                if previous["request_sha256"] != request_sha:
                    raise InputError("This operation identity already belongs to a different saved catalog request")
                result = load_json(previous["body"])
                self._check_sources(result)
                return result
            preview = self.preview(request)
            failures = [issue for issue in preview["issues"] if issue.get("severity") == "error"]
            if failures:
                raise InputError("Review the source compatibility issues before saving: " +
                                 "; ".join(issue["series_key"] + ": " + issue["message"] for issue in failures[:5]))
            result = self._edition_record(preview, now())
            with self.db:
                self.db.execute("INSERT INTO macrobond_editions VALUES(?,?,?,?,?)",
                    (result["edition"]["id"], request["operation_id"], request_sha,
                     json_bytes(request).decode(), json_bytes(result).decode()))
            return result

    def _check_sources(self, result):
        for source in result["edition"]["sources"]:
            view = self.source.project(source["project_id"], source["revision"])
            if view["build"]["id"] != source["build_id"] or view["build"]["snapshot"] != source["snapshot"]:
                raise InputError("The saved catalog source differs from its immutable native project")

    def edition(self, ident):
        identity(ident)
        with self.mutex:
            row = self.db.execute("SELECT body FROM macrobond_editions WHERE id=?", (ident,)).fetchone()
            if row is None:
                raise InputError("Unknown saved catalog edition")
            result = load_json(row["body"])
            self._check_sources(result)
            return result

    def series(self, ident, offset=0, limit=50, query=""):
        query = text(query, "Series query", 4096, empty=True).casefold()
        with self.mutex:
            rows = self.edition(ident)["series"]
            if query:
                rows = [s for s in rows if query in
                        (s["id"] + " " + s["series_key"] + " " + s["flow"] + " " +
                         s["metaData"]["Description"]).casefold()]
            return row_page(rows, offset, limit)

    def _selected_series(self, ident, series_id):
        if not isinstance(series_id, str) or not SERIES_ID.fullmatch(series_id):
            raise InputError("Use the complete retained provider series identity")
        item = next((s for s in self.edition(ident)["series"] if s["id"] == series_id), None)
        if item is None:
            raise InputError("Unknown series in this catalog edition")
        return item

    def observations(self, ident, series_id, offset=0, limit=50):
        offset, limit = page(offset, limit)
        with self.mutex:
            selected = self._selected_series(ident, series_id)
            rows = self._raw_rows(selected, offset, limit)
            return {"rows": [{**row, "date": projected_date(row, selected["source_frequency"])}
                             for row in rows],
                    "total": selected["observation_count"], "offset": offset, "limit": limit}

    def activate(self, ident, expected_revision, expected_current):
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
            raise InputError("Publication needs the current nonnegative revision")
        if expected_current is not None:
            identity(expected_current)
        with self.mutex:
            self.edition(ident)
            current = self.db.execute("SELECT revision,current FROM macrobond_current WHERE id=1").fetchone()
            if current["current"] == ident and current["revision"] == expected_revision + 1:
                prior = self.db.execute("SELECT body FROM macrobond_publications WHERE revision=?",
                                        (current["revision"],)).fetchone()
                if prior and load_json(prior["body"])["previous"] == expected_current:
                    return self.state()
            if current["revision"] != expected_revision or current["current"] != expected_current:
                raise InputError("The selected publication changed; refresh and compare the current saved edition")
            if current["current"] == ident:
                return self.state()
            event = {"revision": expected_revision + 1, "previous": expected_current,
                     "current": ident, "activated_at": now()}
            with self.db:
                self.db.execute("INSERT INTO macrobond_publications VALUES(?,?)",
                                (event["revision"], json_bytes(event).decode()))
                self.db.execute("UPDATE macrobond_current SET revision=?,current=? WHERE id=1",
                                (event["revision"], ident))
            return self.state()

    def compare(self, before_id, after_id):
        with self.mutex:
            before, after = self.edition(before_id), self.edition(after_id)
            old = {s["id"]: s for s in before["series"]}
            new = {s["id"]: s for s in after["series"]}
            total = {k: 0 for k in ("added", "removed", "changed", "unchanged")}
            series_counts = dict(total)
            rows = []
            for ident in sorted(set(old) | set(new)):
                a, b = old.get(ident), new.get(ident)
                counts = {k: 0 for k in total}
                with self._row_stream(a) as left, self._row_stream(b) as right:
                    av, bv = next(left, None), next(right, None)
                    while av is not None or bv is not None:
                        if av is None or (bv is not None and bv["time_period"] < av["time_period"]):
                            counts["added"] += 1
                            bv = next(right, None)
                        elif bv is None or av["time_period"] < bv["time_period"]:
                            counts["removed"] += 1
                            av = next(left, None)
                        else:
                            counts["unchanged" if av == bv else "changed"] += 1
                            av, bv = next(left, None), next(right, None)
                metadata_changed = bool(a and b and a["metaData"] != b["metaData"])
                source_changed = bool(a and b and
                    (a["source_project"], a["source_revision"], a["source_snapshot"]) !=
                    (b["source_project"], b["source_revision"], b["source_snapshot"]))
                kind = ("added" if a is None else "removed" if b is None else
                        "changed" if metadata_changed or source_changed or
                        any(counts[k] for k in ("added", "removed", "changed")) else "unchanged")
                series_counts[kind] += 1
                for key in total:
                    total[key] += counts[key]
                rows.append({"id": ident, "series_key": (b or a)["series_key"], "kind": kind,
                             "metadata_changed": metadata_changed, "source_changed": source_changed,
                             "counts": counts})
            return {"before": before_id, "after": after_id, "series_counts": series_counts,
                    "observation_counts": total, "rows": rows}

    def _provider_names(self, params):
        names = params.get("n", [])
        if isinstance(names, str):
            names = [names]
        if not isinstance(names, list) or not 1 <= len(names) <= 1000:
            raise InputError("Supply one or more repeated n series parameters, up to 1000")
        if any(not isinstance(n, str) or len(n) > 256 for n in names):
            raise InputError("Provider series names must be strings within 256 characters")
        return names

    def _browse_groups(self, series):
        flows = {}
        for item in series:
            flow_id = "f_" + digest(item["flow"].encode())[:24]
            group = flows.setdefault(flow_id, {"flow": item["flow"], "series": [], "frequencies": {}})
            group["series"].append(item)
            group["frequencies"].setdefault(item["source_frequency"], []).append(item)
        return flows

    def provider(self, command, params):
        if command not in PROVIDER_METHODS:
            raise InputError("Unsupported Macrobond provider method")
        if not isinstance(params, dict):
            raise InputError("Provider parameters must be a query object")
        if command == "getcapabilities":
            return {"browse": True, "search": True, "editSeries": False,
                    "allowMultipleSeriesPerRequest": True, "meta": True,
                    "revisions": False, "revisionsRelease": False, "revisionsCompleteHistory": False}
        with self.mutex:
            current = self.db.execute("SELECT current FROM macrobond_current WHERE id=1").fetchone()[0]
            selected = self.edition(current)["series"] if current else []
            by_id = {s["id"]: s for s in selected}
            if command in {"loadseries", "loadmeta"}:
                output = []
                for name in self._provider_names(params):
                    item = by_id.get(name)
                    if item is None:
                        output.append({"error": "Unknown series in the selected catalog publication: " + name})
                        continue
                    data = {"metaData": item["metaData"]}
                    if command == "loadseries":
                        data["values"], data["dates"] = [], []
                        with self._row_stream(item) as original:
                            for row in original:
                                data["values"].append(projected_number(row))
                                data["dates"].append(projected_date(row, item["source_frequency"]))
                    output.append({"data": data})
                return output
            if command == "searchseries":
                query = text(params.get("query", ""), "Search query", 4096, empty=True).casefold()
                return [s["metaData"] for s in selected if query in
                        (s["id"] + " " + s["series_key"] + " " + s["flow"] + " " +
                         s["metaData"]["Description"]).casefold()]
            reference = text(params.get("reference", ""), "Browse reference", 256, empty=True)
            groups = self._browse_groups(selected)
            if command == "loadtree":
                if not reference:
                    return [{"Description": value["flow"], "ChildrenReference": key}
                            for key, value in sorted(groups.items(), key=lambda pair: pair[1]["flow"])]
                if reference not in groups:
                    raise InputError("Unknown catalog tree reference")
                return [{"Description": FREQUENCIES[freq], "SeriesReference": reference + "." + freq}
                        for freq in sorted(groups[reference]["frequencies"])]
            if not reference:
                rows = selected
            else:
                flow, separator, frequency = reference.partition(".")
                if flow not in groups or (separator and frequency not in groups[flow]["frequencies"]):
                    raise InputError("Unknown catalog series reference")
                rows = groups[flow]["frequencies"][frequency] if separator else groups[flow]["series"]
            return {"groups": [{"name": "Selected catalog publication", "series": [
                {"description": s["metaData"]["Description"], "names": [s["id"]],
                 "entityMeta": [s["metaData"]]} for s in rows]}]}

    def export_packet(self, ident, output):
        with self.mutex, self.scratch() as temporary:
            selected = self.edition(ident)
            records = [{"request": load_json(row["request"]), "result": load_json(row["body"])}
                       for row in self.db.execute("SELECT request,body FROM macrobond_editions ORDER BY rowid")]
            state = self.state()
            projects = {}
            for record in records:
                for member in record["request"]["members"]:
                    projects[member["project_id"]] = max(
                        projects.get(member["project_id"], 0), member["revision"])
            packet = {"schema": PACKET,
                      "catalog": {k: state["workspace"][k] for k in ("schema", "id", "created_at")},
                      "selected_edition": ident,
                      "state": {"revision": state["revision"], "current": state["current"]},
                      "editions": records, "publications": state["publications"],
                      "projects": [], "files": {}}
            retained = {}
            for project_id, revision in sorted(projects.items()):
                name = "projects/" + project_id + ".sdmx.zip"
                path = temporary / (project_id + ".sdmx.zip")
                exported = self.source.export_packet(project_id, path, revision)
                retained[name] = path
                packet["files"][name] = {"bytes": exported["bytes"], "sha256": exported["sha256"]}
                packet["projects"].append({"project_id": project_id, "revision": revision, "path": name})
            manifest = json_bytes(packet)
            if len(manifest) > MAX_METADATA:
                raise InputError("The catalog manifest exceeds 32 MiB")
            archive = temporary / "catalog.zip"
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                def entry(name):
                    item = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                    item.compress_type = zipfile.ZIP_DEFLATED
                    item.create_system = 3
                    item.external_attr = 0o100600 << 16
                    return item
                z.writestr(entry("macrobond-catalog.json"), manifest)
                for name, path in sorted(retained.items()):
                    with path.open("rb") as source, z.open(entry(name), "w") as target:
                        shutil.copyfileobj(source, target, 65536)
            os.chmod(archive, 0o600)
            return {**publish_file(archive, output), "edition": selected["edition"],
                    "edition_count": len(records), "publication_count": len(state["publications"]),
                    "source_project_count": len(projects)}

    def _preflight_catalog(self, manifest):
        if not isinstance(manifest, dict) or manifest.get("schema") != PACKET:
            raise InputError("Unsupported complete Macrobond catalog packet")
        records = manifest.get("editions")
        if not isinstance(records, list) or not records or len(records) > 100000:
            raise InputError("The packet must contain its saved catalog editions")
        ids, operations, projects = set(), set(), {}
        for record in records:
            if not isinstance(record, dict) or set(record) != {"request", "result"}:
                raise InputError("A catalog edition needs its original request and result")
            request = self._request(record["request"])
            if request != record["request"]:
                raise InputError("The catalog contains an unnormalized saved request")
            result = record["result"]
            if not isinstance(result, dict) or set(result) != {"edition", "series"}:
                raise InputError("The catalog edition result is incomplete")
            edition = result["edition"]
            if not isinstance(edition, dict) or not isinstance(result["series"], list):
                raise InputError("The catalog edition metadata or series list is invalid")
            ident = identity(edition.get("id"))
            if edition.get("schema") != EDITION or ident in ids or request["operation_id"] in operations:
                raise InputError("The catalog contains repeated or unsupported edition identities")
            ids.add(ident)
            operations.add(request["operation_id"])
            text(edition.get("created_at"), "Retained edition timestamp", 80)
            for member in request["members"]:
                projects[member["project_id"]] = max(projects.get(member["project_id"], 0), member["revision"])
            previous = self.db.execute("SELECT request,body FROM macrobond_editions WHERE operation_id=?",
                                       (request["operation_id"],)).fetchone()
            if previous and (load_json(previous["request"]) != request or load_json(previous["body"]) != result):
                raise InputError("This catalog retains a different original request or edition under that operation")
        if manifest.get("selected_edition") not in ids:
            raise InputError("The packet's selected edition is absent")
        state, history = manifest.get("state"), manifest.get("publications")
        if not isinstance(state, dict) or set(state) != {"revision", "current"} or not isinstance(history, list):
            raise InputError("The original publication state and history are required")
        if isinstance(state["revision"], bool) or state["revision"] != len(history):
            raise InputError("The publication revision differs from its complete history")
        previous = None
        for revision, event in enumerate(history, 1):
            if not isinstance(event, dict) or set(event) != {"revision", "previous", "current", "activated_at"}:
                raise InputError("Unsupported retained publication event")
            if event["revision"] != revision or event["previous"] != previous or event["current"] not in ids:
                raise InputError("The packet publication history is not a complete ordered sequence")
            text(event["activated_at"], "Publication timestamp", 80)
            previous = event["current"]
        if state["current"] != previous:
            raise InputError("The selected publication differs from the original history")
        catalog = manifest.get("catalog")
        if not isinstance(catalog, dict) or set(catalog) != {"schema", "id", "created_at"} or catalog["schema"] != VERSION:
            raise InputError("The original catalog identity is required")
        identity(catalog["id"], PROJECT_ID)
        text(catalog["created_at"], "Original catalog timestamp", 80)
        local = self.state()
        if local["editions"]:
            if catalog["id"] != local["workspace"]["id"] or catalog["created_at"] != local["workspace"]["created_at"]:
                raise InputError("Open a new receiving catalog for another catalog's complete history")
            if not {e["id"] for e in local["editions"]}.issubset(ids):
                raise InputError("This catalog has later saved editions; receive the older packet in a new workspace")
            if history[:len(local["publications"])] != local["publications"]:
                raise InputError("This catalog has a different publication continuation; receive the packet separately")
        declared_projects = manifest.get("projects")
        if not isinstance(declared_projects, list) or len(declared_projects) != len(projects):
            raise InputError("The packet must contain every selected original project history")
        expected_paths = set()
        for project in declared_projects:
            if not isinstance(project, dict) or set(project) != {"project_id", "revision", "path"}:
                raise InputError("Unsupported original project packet reference")
            pid = identity(project["project_id"], PROJECT_ID)
            expected_path = "projects/" + pid + ".sdmx.zip"
            if project["path"] != expected_path or projects.get(pid) != project["revision"] or expected_path in expected_paths:
                raise InputError("The project packet reference differs from the selected edition history")
            expected_paths.add(expected_path)
        if not isinstance(manifest.get("files"), dict) or set(manifest["files"]) != expected_paths:
            raise InputError("The catalog packet file set differs from its complete source history")
        return records

    def import_catalog(self, path):
        path = Path(path).expanduser().absolute()
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_PACKET:
            raise InputError("Select a regular complete catalog packet within 1 GiB")
        try:
            archive = zipfile.ZipFile(path)
        except (OSError, zipfile.BadZipFile) as error:
            raise InputError("Select a complete Macrobond catalog ZIP packet") from error
        with self.mutex, archive as z, self.scratch() as temporary:
            members = z.infolist()
            if len(members) > 4096 or len({item.filename for item in members}) != len(members):
                raise InputError("The catalog packet has repeated or excessive members")
            if "macrobond-catalog.json" not in z.namelist():
                raise InputError("The complete catalog manifest is missing")
            if z.getinfo("macrobond-catalog.json").file_size > MAX_METADATA:
                raise InputError("The catalog manifest exceeds 32 MiB")
            manifest = load_json(z.read("macrobond-catalog.json"))
            records = self._preflight_catalog(manifest)
            if set(z.namelist()) != set(manifest["files"]) | {"macrobond-catalog.json"}:
                raise InputError("The packet archive differs from its declared source files")
            total = 0
            for item in members:
                if (item.is_dir() or item.filename.startswith("/") or "\\" in item.filename
                        or any(part in {"", ".", ".."} for part in item.filename.split("/"))
                        or stat.S_IFMT(item.external_attr >> 16) not in {0, stat.S_IFREG}
                        or item.flag_bits & 1):
                    raise InputError("Catalog packet members must be unencrypted regular files")
                total += item.file_size
                if total > MAX_PACKET or item.file_size > MAX_PACKET:
                    raise InputError("The expanded catalog packet exceeds 1 GiB")
                if item.filename == "macrobond-catalog.json":
                    continue
                expected = manifest["files"][item.filename]
                if (not isinstance(expected, dict) or item.file_size != expected.get("bytes")
                        or not isinstance(expected.get("sha256"), str) or not HEX.fullmatch(expected["sha256"])):
                    raise InputError("The original source packet size or identity differs from its declaration")
                h = hashlib.sha256()
                with z.open(item) as source:
                    while block := source.read(65536):
                        h.update(block)
                if h.hexdigest() != expected["sha256"]:
                    raise InputError("The original source packet bytes differ from their declared identity")
            received, source_sizes = [], {}
            # Inspect all nested original manifests before invoking the maintained
            # recoverable source importer. Count shared raw sources once.
            for project in manifest["projects"]:
                target = temporary / (project["project_id"] + ".sdmx.zip")
                private_write(target, b"")
                with z.open(project["path"]) as source, target.open("wb") as destination:
                    shutil.copyfileobj(source, destination, 65536)
                    destination.flush()
                    os.fsync(destination.fileno())
                if file_record(target) != manifest["files"][project["path"]]:
                    raise InputError("The original project packet changed during receiving")
                with zipfile.ZipFile(target) as nested:
                    info = nested.getinfo("sdmx-packet.json")
                    if info.file_size > MAX_METADATA:
                        raise InputError("A source project manifest exceeds 32 MiB")
                    original = load_json(nested.read("sdmx-packet.json"))
                    if original.get("project_id") != project["project_id"] or original.get("revision") != project["revision"]:
                        raise InputError("The nested original project differs from the catalog reference")
                    for metadata in original.get("files", {}).values():
                        sid, size = metadata.get("sha256"), metadata.get("bytes")
                        if not isinstance(sid, str) or not HEX.fullmatch(sid) or isinstance(size, bool) or not isinstance(size, int) or size < 0:
                            raise InputError("Invalid original source size or identity")
                        if sid in source_sizes and source_sizes[sid] != size:
                            raise InputError("The same source has conflicting retained sizes")
                        source_sizes[sid] = size
                    if sum(source_sizes.values()) > MAX_PACKET:
                        raise InputError("The complete catalog retains more than 1 GiB of original source bytes")
                received.append((project, target))
            for project, target in received:
                imported = self.import_packet(target)
                if imported["project"]["id"] != project["project_id"] or imported["project"]["revision"] != project["revision"]:
                    raise InputError("The original source importer returned a different project edition")
            prepared = []
            for record in records:
                preview = self.preview(record["request"])
                if any(issue["severity"] == "error" for issue in preview["issues"]):
                    raise InputError("A retained catalog edition has incompatible original source observations")
                rebuilt = self._edition_record(preview, record["result"]["edition"]["created_at"])
                if rebuilt != record["result"]:
                    raise InputError("The received catalog projection differs from its original source-bound edition")
                prepared.append((record["request"], rebuilt))
            # Source imports are recoverable native operations. Publish the catalog
            # and its complete history together only after every edition matches.
            with self.db:
                for request, result in prepared:
                    self.db.execute("INSERT OR IGNORE INTO macrobond_editions VALUES(?,?,?,?,?)",
                        (result["edition"]["id"], request["operation_id"], digest(json_bytes(request)),
                         json_bytes(request).decode(), json_bytes(result).decode()))
                self.db.execute("UPDATE macrobond_info SET body=? WHERE id=1",
                                (json_bytes(manifest["catalog"]).decode(),))
                for event in manifest["publications"]:
                    self.db.execute("INSERT OR IGNORE INTO macrobond_publications VALUES(?,?)",
                                    (event["revision"], json_bytes(event).decode()))
                self.db.execute("UPDATE macrobond_current SET revision=?,current=? WHERE id=1",
                                (manifest["state"]["revision"], manifest["state"]["current"]))
            return self.state()

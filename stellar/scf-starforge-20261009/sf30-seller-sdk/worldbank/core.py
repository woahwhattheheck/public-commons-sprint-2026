#!/usr/bin/env python3
"""Retained World Bank indicator selections, acquisitions, reviews and native datasets. MIT."""
from __future__ import annotations

import argparse
import base64
import contextlib
import csv
import fcntl
import io
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import sys
import uuid
import zipfile

from source import (SourceError, NumericToken, catalog_url, digest, encode, envelope,
                    identity, normalize_observation, parse_source, request_page,
                    same_request, selection, url_for, utc)

ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
KINDS = ("sources", "countries", "indicators", "data")
MAX_ROWS = 1_000_000
COLUMNS = ("source_id", "country_id", "country_iso3", "country_name", "indicator_id",
           "indicator_name", "period", "value", "value_state", "unit", "obs_status",
           "decimal", "footnote", "region", "aggregate", "source_page", "source_row")


def fail(code, message, **details):
    raise SourceError(code, message, **details)


def identifier(value, name="id"):
    if not isinstance(value, str) or not ID.fullmatch(value):
        fail("WORKSPACE_ID", "Use a short stable " + name + " with letters, numbers, dots, dashes or underscores.")
    return value


def request_group(kind, indicator_id=None):
    if kind not in KINDS:
        fail("SOURCE_KIND", "Choose an original sources, countries, indicators or data collection.")
    if indicator_id is None:
        return kind
    if kind != "indicators":
        fail("SOURCE_GROUP", "Only indicator metadata has a selected indicator request group.")
    return "indicators:" + identifier(indicator_id, "indicator id").upper()


def page_order(page):
    if not isinstance(page, dict):
        fail("SOURCE_IMPORT", "Each original source page must be an object.")
    group = request_group(page.get("kind"), page.get("indicatorId"))
    number = page.get("page")
    if isinstance(number, bool) or not isinstance(number, int) or number < 1:
        fail("SOURCE_PAGE_ORDER", "Use the original positive integer page number within each request group.")
    return KINDS.index(page["kind"]), group, number


def text(value, name, maximum=20000):
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value:
        fail("WORKSPACE_TEXT", "Provide valid " + name + ".")
    return value


def page_window(data, default=100):
    offset, limit = data.get("offset", 0), data.get("limit", default)
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        fail("WORKSPACE_PAGE", "Offset must be a nonnegative integer.")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
        fail("WORKSPACE_PAGE", "Limit must be an integer from 1 to 1,000.")
    return offset, limit


def regular(path, root=None):
    path = Path(path)
    if root is not None:
        try:
            path.relative_to(root)
        except ValueError:
            fail("WORKSPACE_PATH", "The selected file is outside the original workspace.")
    if path.is_symlink() or path.resolve() != path.absolute() or not path.is_file():
        fail("WORKSPACE_FILE", "Use original regular files without symbolic links.")
    return path


def read_bytes(path, maximum=256 * 1024 * 1024):
    path = regular(path)
    with path.open("rb") as handle:
        before = os.fstat(handle.fileno())
        raw = handle.read(maximum + 1)
        after = os.fstat(handle.fileno())
    if len(raw) > maximum or len(raw) != before.st_size or before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
        fail("WORKSPACE_FILE_CHANGED", "The original file changed during its read or exceeds the supported file size.")
    return raw


def immutable(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent.resolve() != path.parent.absolute():
        fail("WORKSPACE_PATH", "Use canonical private source directories.")
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except FileExistsError:
        if read_bytes(path, max(len(raw), 1)) != raw:
            fail("IMMUTABLE_SOURCE", "The retained file already contains different bytes.", file=path.name)
        return
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        # This call owns the newly created, incomplete file only.
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
        raise
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def file_descriptor(root, path):
    raw = read_bytes(path)
    return {"path": Path(path).relative_to(root).as_posix(), "bytes": len(raw), "sha256": digest(raw)}


@contextlib.contextmanager
def file_lock(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        fail("WORKSPACE_LOCK", "Use the original local workspace lock.")
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("OPERATION_ACTIVE", "This original operation is already running.")
        yield
    finally:
        os.close(fd)


def held(path):
    try:
        with file_lock(path):
            return False
    except SourceError as error:
        if error.code == "OPERATION_ACTIVE":
            return True
        raise


class Workspace:
    def __init__(self, directory):
        self.root = Path(directory).absolute()
        if self.root == Path("/") or self.root.resolve() != self.root:
            fail("WORKSPACE_PATH", "Choose a canonical absolute private workspace directory.")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        for name in ("captures", "catalogs", "exports", "locks"):
            (self.root / name).mkdir(exist_ok=True, mode=0o700)
            if (self.root / name).is_symlink():
                fail("WORKSPACE_PATH", "Keep the original workspace directories without symbolic links.")
        db_path = self.root / "worldbank.sqlite3"
        if db_path.is_symlink():
            fail("WORKSPACE_PATH", "Keep the original regular workspace database.")
        self.db = sqlite3.connect(db_path, timeout=10)
        os.chmod(db_path, 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS records(
            kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
            data TEXT NOT NULL, PRIMARY KEY(kind,id));
          CREATE TABLE IF NOT EXISTS history(
            kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
            data TEXT NOT NULL, PRIMARY KEY(kind,id,revision));
          CREATE TABLE IF NOT EXISTS observations(
            capture TEXT NOT NULL, page INTEGER NOT NULL, position INTEGER NOT NULL,
            observation_key TEXT NOT NULL, data TEXT NOT NULL,
            PRIMARY KEY(capture,page,position));
          CREATE INDEX IF NOT EXISTS observation_identity ON observations(capture,observation_key);
          CREATE TABLE IF NOT EXISTS capture_pages(
            capture TEXT NOT NULL, kind TEXT NOT NULL, request_group TEXT NOT NULL,
            page INTEGER NOT NULL, data TEXT NOT NULL,
            PRIMARY KEY(capture,kind,request_group,page));
        """)
        self.db.commit()
        if "request_group" not in {row["name"] for row in self.db.execute("PRAGMA table_info(capture_pages)")}:
            # Preserve the original page data while upgrading an interrupted
            # workspace created before metadata requests acquired group identity.
            with self.db:
                self.db.execute("BEGIN IMMEDIATE")
                self.db.execute("ALTER TABLE capture_pages RENAME TO capture_pages_ungrouped")
                self.db.execute("CREATE TABLE capture_pages(capture TEXT NOT NULL, kind TEXT NOT NULL, "
                                "request_group TEXT NOT NULL, page INTEGER NOT NULL, data TEXT NOT NULL, "
                                "PRIMARY KEY(capture,kind,request_group,page))")
                for old in self.db.execute("SELECT capture,kind,page,data FROM capture_pages_ungrouped"):
                    descriptor = json.loads(old["data"])
                    self.db.execute("INSERT INTO capture_pages VALUES(?,?,?,?,?)",
                                    (old["capture"], old["kind"], request_group(old["kind"], descriptor.get("indicatorId")),
                                     old["page"], old["data"]))
                self.db.execute("DROP TABLE capture_pages_ungrouped")

    def close(self):
        self.db.close()

    def get(self, kind, record_id, required=True, *, with_pages=True):
        identifier(record_id)
        row = self.db.execute("SELECT data FROM records WHERE kind=? AND id=?", (kind, record_id)).fetchone()
        if row is None:
            if required:
                fail("RECORD_MISSING", "The selected " + kind + " is not retained in this workspace.", id=record_id)
            return None
        value = json.loads(row["data"])
        if kind == "capture" and with_pages:
            value["pages"] = [json.loads(page["data"]) for page in self.db.execute(
                "SELECT data FROM capture_pages WHERE capture=? ORDER BY CASE kind "
                "WHEN 'sources' THEN 1 WHEN 'countries' THEN 2 WHEN 'indicators' THEN 3 ELSE 4 END,request_group,page",
                (record_id,))]
        return value

    def list(self, kind):
        return [json.loads(row["data"]) for row in self.db.execute(
            "SELECT data FROM records WHERE kind=? ORDER BY rowid DESC", (kind,))]

    def put(self, kind, value, expected_revision=None, *, transaction=True):
        def save():
            old = self.get(kind, value["id"], required=False, with_pages=False)
            revision = old["revision"] if old else 0
            if expected_revision is not None and expected_revision != revision:
                fail("REVISION_CHANGED", "The saved record changed. Reopen its current revision before saving.",
                     id=value["id"], expectedRevision=expected_revision, currentRevision=revision)
            value["revision"] = revision + 1
            value["updatedAt"] = utc()
            value.setdefault("createdAt", old["createdAt"] if old else value["updatedAt"])
            stored = {key: item for key, item in value.items() if not (kind == "capture" and key == "pages")}
            raw = encode(stored).decode()
            self.db.execute("INSERT OR REPLACE INTO records VALUES(?,?,?,?)",
                            (kind, value["id"], value["revision"], raw))
            if kind in ("selection", "review"):
                self.db.execute("INSERT INTO history VALUES(?,?,?,?)",
                                (kind, value["id"], value["revision"], raw))
            return value
        if not transaction:
            return save()
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            return save()

    def state(self, _):
        captures = []
        for item in self.list("capture"):
            item = dict(item)
            item.pop("pages", None)
            if item["status"] == "RUNNING" and not held(self.root / "locks" / (item["id"] + ".lock")):
                item["status"] = "INTERRUPTED"
            captures.append(item)
        catalogs = [{key: value for key, value in item.items() if key not in ("rows", "pages")}
                    for item in self.list("catalog")]
        return {"schema": "stellar-forge.worldbank-workspace.v1",
                "directory": str(self.root), "selections": self.list("selection"),
                "captures": captures, "reviews": self.list("review"),
                "exports": self.list("export"), "catalogs": catalogs}

    def save_selection(self, data):
        record_id = identifier(data.get("id"))
        if "expectedRevision" not in data:
            fail("REVISION_REQUIRED", "Save the displayed selection revision, or zero for a new selection.")
        value = {"id": record_id, "title": text(data.get("title", record_id), "selection title", 128),
                 "spec": selection(data.get("spec")), "schema": "stellar-forge.worldbank-saved-selection.v1"}
        return self.put("selection", value, data["expectedRevision"])

    def catalog(self, data):
        kind, source_id = data.get("kind"), str(data.get("sourceId", "2"))
        key = identifier(str(kind) + ("-" + source_id if kind == "indicators" else ""))
        saved = self.get("catalog", key, required=False)
        if saved is None or data.get("refresh") is True:
            with file_lock(self.root / "locks" / ("catalog-" + key + ".lock")):
                pages, rows, expected_meta, page = [], [], None, 1
                while True:
                    url = catalog_url(kind, page, source_id)
                    raw, receipt = request_page(url)
                    meta, records = envelope(raw, page, expected_meta)
                    expected_meta = expected_meta or meta
                    path = self.root / "catalogs" / key / (f"{page:06d}-" + receipt["sha256"] + ".json")
                    immutable(path, raw)
                    pages.append({**receipt, "kind": kind, "page": page,
                                  "bodyFile": path.relative_to(self.root).as_posix(), "pagination": meta})
                    rows.extend(records)
                    if page >= max(1, meta["pages"]):
                        break
                    page += 1
                if len(rows) != expected_meta["total"]:
                    fail("SOURCE_POPULATION", "The complete catalogue row count differs from the original total.")
                saved = self.put("catalog", {"id": key, "kind": kind, "sourceId": source_id,
                                 "capturedAt": utc(), "pages": pages, "rows": rows,
                                 "total": len(rows), "pageCount": len(pages)})
        query = text(data.get("search", ""), "catalogue search", 200).casefold()
        rows = saved["rows"]
        if query:
            rows = [item for item in rows if query in json.dumps(item, ensure_ascii=False).casefold()]
        offset, limit = page_window(data, 100)
        return {"id": saved["id"], "kind": kind, "sourceId": source_id, "capturedAt": saved["capturedAt"],
                "total": len(rows), "sourceTotal": saved["total"], "offset": offset, "limit": limit,
                "rows": rows[offset:offset + limit]}

    def _capture(self, data, acquisition):
        capture_id = identifier(data.get("id"), "capture id")
        prior = self.get("capture", capture_id, required=False)
        if prior:
            if data.get("selectionId") and prior["selectionId"] != data["selectionId"]:
                fail("CAPTURE_IDENTITY", "This capture belongs to its original saved selection.")
            if prior["acquisition"] != acquisition:
                fail("CAPTURE_IDENTITY", "Continue the original source transport for this capture.")
            return prior
        selected = self.get("selection", data.get("selectionId"))
        return self.put("capture", {
            "schema": "stellar-forge.worldbank-capture.v1", "id": capture_id,
            "selectionId": selected["id"], "selectionRevision": selected["revision"],
            "selectionTitle": selected["title"], "spec": selected["spec"],
            "selectionSha256": identity(selected["spec"]), "acquisition": acquisition,
            "status": "PREPARED", "pages": [], "collections": {}, "requestGroups": {}, "summary": {},
            "startedAt": utc(), "error": None,
        }, 0)

    def _rows(self, capture_id):
        for row in self.db.execute("SELECT data FROM observations WHERE capture=? ORDER BY page,position", (capture_id,)):
            yield json.loads(row["data"])

    def _country_index(self, capture):
        countries = {}
        for descriptor in capture["pages"]:
            if descriptor["kind"] != "countries":
                continue
            _, rows = envelope(read_bytes(self.root / descriptor["bodyFile"]), descriptor["page"])
            for row in rows:
                for key in ("id", "iso2Code"):
                    value = row.get(key)
                    if isinstance(value, str) and value:
                        countries[value.upper()] = row
        return countries

    def _group_states(self, capture):
        if capture.get("requestGroups"):
            return dict(capture["requestGroups"])
        groups = {}
        for item in capture["pages"]:
            group = request_group(item["kind"], item.get("indicatorId"))
            state = groups.setdefault(group, {"kind": item["kind"], "indicatorId": item.get("indicatorId"),
                                             "requestGroup": item.get("requestGroup", group), "rows": 0})
            meta = item["pagination"]
            state.update(pages=item["page"], expectedPages=meta["pages"], total=meta["total"],
                         lastUpdated=meta["lastUpdated"], complete=item["page"] >= max(1, meta["pages"]))
            state["rows"] += item["rows"]
        return groups

    def _collections(self, capture, groups):
        collections = {kind: groups[kind] for kind in ("sources", "countries", "data") if kind in groups}
        required = [request_group("indicators", item) for item in capture["spec"]["indicators"]]
        selected = [groups[key] for key in required if key in groups]
        collections["indicators"] = {
            "pages": sum(item["pages"] for item in selected),
            "expectedPages": sum(item["expectedPages"] for item in selected),
            "rows": sum(item["rows"] for item in selected),
            "total": sum(item["total"] for item in selected),
            "lastUpdated": ", ".join(sorted({item["lastUpdated"] for item in selected if item["lastUpdated"]})),
            "requiredGroups": required,
            "complete": all(groups.get(key, {}).get("complete") for key in required),
            "retainedSupplementalPages": groups.get("indicators", {}).get("pages", 0),
        }
        return collections

    def _append(self, capture, kind, page, raw, receipt, indicator_id=None, source_group=None):
        group = request_group(kind, indicator_id)
        indicator_id = indicator_id.upper() if indicator_id is not None else None
        original_url = url_for(capture["spec"], kind, page, indicator_id)
        if not same_request(receipt.get("url"), original_url) or not same_request(
            receipt.get("finalUrl"), original_url
        ) or receipt.get("status") != 200 or (
            receipt.get("sha256") != digest(raw) or receipt.get("bytes") != len(raw)
        ):
            fail("SOURCE_RECEIPT", "The original response bytes and request receipt do not match the selected page.")
        prior_pages = [item for item in capture["pages"]
                       if request_group(item["kind"], item.get("indicatorId")) == group]
        if page != len(prior_pages) + 1:
            fail("SOURCE_PAGE_ORDER", "Append the next original page without replacing earlier pages.")
        meta, rows = envelope(raw, page, prior_pages[0]["pagination"] if prior_pages else None)
        if meta["perPage"] != capture["spec"]["perPage"]:
            fail("SOURCE_PAGE_SIZE", "The source used a different page size from this saved selection.")
        if kind == "data":
            if meta["sourceId"] and meta["sourceId"] != capture["spec"]["sourceId"]:
                fail("SOURCE_ID", "The source response identifies another source database.")
            if meta["total"] > MAX_ROWS:
                fail("DATASET_CAPACITY", "This selection exceeds the native dataset's one-million-row capacity. Choose its intended country/indicator/period population.")
            countries = self._country_index(capture)
            normalized = [normalize_observation(row, capture["spec"], page, pos, countries)
                          for pos, row in enumerate(rows, 1)]
        else:
            normalized = []
        body_root = self.root / "captures" / capture["id"] / "raw" / kind
        if kind == "indicators":
            body_root = body_root / (indicator_id or "_combined")
        body_path = body_root / (f"{page:06d}-" + digest(raw) + ".json")
        immutable(body_path, raw)
        retained = {**receipt, "kind": kind, "page": page, "pagination": meta,
                    "requestGroup": text(source_group if source_group is not None else group, "original request group", 200),
                    "bodyFile": body_path.relative_to(self.root).as_posix(), "rows": len(rows)}
        if indicator_id is not None:
            retained["indicatorId"] = indicator_id
        current = dict(capture)
        current["pages"] = [*capture["pages"], retained]
        groups = self._group_states(capture)
        row_count = sum(item["rows"] for item in prior_pages) + len(rows)
        complete = page >= max(1, meta["pages"])
        if complete and row_count != meta["total"]:
            fail("SOURCE_POPULATION", "The completed page chain differs from the source's total.")
        groups[group] = {"kind": kind, "indicatorId": indicator_id, "requestGroup": retained["requestGroup"],
                         "pages": page, "expectedPages": meta["pages"], "rows": row_count,
                         "total": meta["total"], "lastUpdated": meta["lastUpdated"], "complete": complete}
        collections = self._collections(capture, groups)
        current["requestGroups"] = groups
        current["collections"], current["status"], current["error"] = collections, "RUNNING", None
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            self.db.execute("INSERT INTO capture_pages VALUES(?,?,?,?,?)",
                            (capture["id"], kind, group, page, encode(retained).decode()))
            for row in normalized:
                self.db.execute("INSERT INTO observations VALUES(?,?,?,?,?)",
                                (capture["id"], page, row["source_row"], row["key"], encode(row).decode()))
            return self.put("capture", current, capture["revision"], transaction=False)

    def _finish(self, capture):
        groups = self._group_states(capture)
        required = ["sources", "countries", "data", *[
            request_group("indicators", item) for item in capture["spec"]["indicators"]]]
        if not all(groups.get(group, {}).get("complete") for group in required):
            return capture
        index = self._country_index(capture)
        if capture["spec"]["countries"] != ["all"]:
            absent = [code for code in capture["spec"]["countries"] if code.upper() not in index]
            if absent:
                fail("SOURCE_COUNTRY_METADATA", "The source did not return every selected country or aggregate.", codes=absent)
        indicators, sources = set(), set()
        for item in capture["pages"]:
            if item["kind"] not in ("sources", "indicators"):
                continue
            _, records = envelope(read_bytes(self.root / item["bodyFile"]), item["page"])
            for record in records:
                if item["kind"] == "sources":
                    sources.add(str(record.get("id")))
                else:
                    if str(record.get("source", {}).get("id")) != capture["spec"]["sourceId"]:
                        fail("SOURCE_INDICATOR_METADATA", "An indicator's metadata belongs to another source.")
                    indicator = str(record.get("id")).upper()
                    if item.get("indicatorId") and indicator != item["indicatorId"]:
                        fail("SOURCE_INDICATOR_METADATA", "An indicator metadata response belongs to another request group.")
                    indicators.add(indicator)
        if sources != {capture["spec"]["sourceId"]} or indicators != set(capture["spec"]["indicators"]):
            fail("SOURCE_METADATA", "The original source or indicator metadata does not cover the saved selection.")
        summary = {"observations": 0, "present": 0, "missing": 0, "aggregateObservations": 0,
                   "duplicateKeys": 0, "conflictingKeys": 0, "observationStatuses": {}}
        grouped = {}
        for row in self._rows(capture["id"]):
            summary["observations"] += 1
            summary[row["value_state"]] += 1
            summary["aggregateObservations"] += int(row["aggregate"])
            status = row["obs_status"] or "(unspecified)"
            summary["observationStatuses"][status] = summary["observationStatuses"].get(status, 0) + 1
            grouped.setdefault(row["key"], []).append(row["contentSha256"])
        for hashes in grouped.values():
            summary["duplicateKeys"] += int(len(hashes) > 1)
            summary["conflictingKeys"] += int(len(set(hashes)) > 1)
        capture["pages"] = sorted(capture["pages"], key=page_order)
        capture["requestGroups"] = groups
        capture["collections"] = self._collections(capture, groups)
        capture["summary"], capture["status"], capture["completedAt"] = summary, "COMPLETE", utc()
        capture["captureSha256"] = identity({
            "spec": capture["spec"], "acquisition": capture["acquisition"],
            "pages": [{key: item[key] for key in ("kind", "page", "indicatorId", "requestGroup", "url", "sha256", "bytes", "pagination") if key in item}
                      for item in capture["pages"]], "summary": summary,
        })
        capture = self.put("capture", capture, capture["revision"])
        immutable(self.root / "captures" / capture["id"] / "capture.json", encode(capture))
        return capture

    def capture(self, data):
        capture_id = identifier(data.get("id"), "capture id")
        with file_lock(self.root / "locks" / (capture_id + ".lock")):
            capture = self._capture(data, "ORIGINAL_HTTP")
            if capture["status"] == "COMPLETE":
                return self.capture_detail({"id": capture_id})
            retry = (capture.get("error") or {}).get("retryAt")
            if retry and retry > utc():
                fail("SOURCE_COOLDOWN", "The original source cooldown is still active.", retryAt=retry)
            capture["status"], capture["error"] = "RUNNING", None
            capture = self.put("capture", capture, capture["revision"])
            try:
                requests = [("sources", None), ("countries", None), *[
                    ("indicators", item) for item in capture["spec"]["indicators"]], ("data", None)]
                for kind, indicator_id in requests:
                    group = request_group(kind, indicator_id)
                    while not self._group_states(capture).get(group, {}).get("complete"):
                        page = self._group_states(capture).get(group, {}).get("pages", 0) + 1
                        raw, receipt = request_page(url_for(capture["spec"], kind, page, indicator_id))
                        capture = self._append(capture, kind, page, raw, receipt, indicator_id)
                return self._finish(capture)
            except BaseException as exc:
                capture = self.get("capture", capture_id)
                if capture["status"] == "COMPLETE":
                    # Completion is already committed. Reopening repairs an interrupted
                    # adjacent manifest write from this exact retained record.
                    raise
                capture["status"] = "INTERRUPTED" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "PAUSED"
                capture["error"] = exc.public() if isinstance(exc, SourceError) else {
                    "code": "CAPTURE_INTERRUPTED" if capture["status"] == "INTERRUPTED" else "CAPTURE_FAILED",
                    "message": str(exc) or "The original acquisition was interrupted."}
                self.put("capture", capture, capture["revision"])
                raise

    def import_pages(self, data):
        capture_id = identifier(data.get("id"))
        pages = data.get("pages")
        if not isinstance(pages, list) or not pages:
            fail("SOURCE_IMPORT", "Provide the original page bytes and source receipts.")
        with file_lock(self.root / "locks" / (capture_id + ".lock")):
            capture = self._capture(data, "IMPORTED_ORIGINAL_RESPONSES")
            for page in sorted(pages, key=page_order):
                kind, number = page["kind"], page["page"]
                group = request_group(kind, page.get("indicatorId"))
                try:
                    raw = base64.b64decode(page["bodyBase64"], validate=True)
                except (ValueError, TypeError, KeyError) as exc:
                    raise SourceError("SOURCE_IMPORT", "Supply one complete original Base64 response body.") from exc
                receipt = page.get("receipt")
                if not isinstance(receipt, dict) or not isinstance(receipt.get("receivedAt"), str):
                    fail("SOURCE_IMPORT", "Preserve the original source request and acquisition receipt.")
                earlier = next((item for item in capture["pages"] if item["page"] == number
                                and request_group(item["kind"], item.get("indicatorId")) == group), None)
                if earlier:
                    if earlier["sha256"] != digest(raw) or earlier["url"] != receipt.get("url"):
                        fail("SOURCE_IMPORT_CONFLICT", "The incoming source page conflicts with the retained original.")
                    continue
                if capture["status"] == "COMPLETE":
                    fail("CAPTURE_COMPLETE", "A complete original capture is immutable.")
                capture = self._append(capture, kind, number, raw, receipt,
                                       page.get("indicatorId"), page.get("requestGroup"))
            return self._finish(capture) if capture["status"] != "COMPLETE" else self.capture_detail({"id": capture_id})

    def capture_detail(self, data):
        capture_id = data.get("id") or data.get("captureId")
        capture = self.get("capture", capture_id)
        for item in capture["pages"]:
            raw = read_bytes(self.root / item["bodyFile"])
            if digest(raw) != item["sha256"] or len(raw) != item["bytes"]:
                fail("SOURCE_CHANGED", "A retained original source page changed.")
        if capture["status"] == "COMPLETE":
            path = self.root / "captures" / capture["id"] / "capture.json"
            if not path.exists():
                immutable(path, encode(capture))
            elif json.loads(read_bytes(path)) != capture:
                fail("CAPTURE_CHANGED", "The saved capture metadata differs from its completed original.")
        return capture

    def observations(self, data):
        capture = self.get("capture", data.get("captureId"))
        query = text(data.get("search", ""), "observation search", 200).casefold()
        offset, limit = page_window(data)
        result, total = [], 0
        for row in self._rows(capture["id"]):
            if query and query not in json.dumps(row, ensure_ascii=False).casefold():
                continue
            if offset <= total < offset + limit:
                result.append(row)
            total += 1
        return {"captureId": capture["id"], "status": capture["status"], "total": total,
                "offset": offset, "limit": limit, "rows": result, "summary": capture["summary"]}

    def compare(self, data):
        current = self.get("capture", data.get("captureId"))
        baseline = self.get("capture", data.get("baselineId"))
        if current["status"] != "COMPLETE" or baseline["status"] != "COMPLETE":
            fail("CAPTURE_INCOMPLETE", "Compare two complete original captures.")
        def group(capture_id):
            result = {}
            for row in self._rows(capture_id):
                result.setdefault(row["key"], []).append(row)
            return result
        before, after = group(baseline["id"]), group(current["id"])
        counts = {"added": 0, "absent": 0, "changed": 0, "unchanged": 0}
        changes = []
        for key in sorted(before.keys() | after.keys()):
            old, new = before.get(key, []), after.get(key, [])
            status = "added" if not old else "absent" if not new else (
                "unchanged" if sorted(item["contentSha256"] for item in old) == sorted(item["contentSha256"] for item in new)
                else "changed")
            counts[status] += 1
            if status != "unchanged":
                changes.append({"key": key, "status": status, "before": old, "after": new})
        fields = ("sourceId", "countries", "indicators", "date")
        same = all(current["spec"][key] == baseline["spec"][key] for key in fields)
        offset, limit = page_window(data)
        return {"captureId": current["id"], "baselineId": baseline["id"], "sameSelection": same,
                "currentSelection": current["spec"], "baselineSelection": baseline["spec"],
                "counts": counts, "total": len(changes), "offset": offset, "limit": limit,
                "rows": changes[offset:offset + limit]}

    def review(self, data):
        capture = self.capture_detail({"id": data.get("captureId")})
        if capture["status"] != "COMPLETE":
            fail("CAPTURE_INCOMPLETE", "Finish the original page chain before saving an edition review.")
        review_id = identifier(data.get("id"))
        if "expectedRevision" not in data:
            fail("REVISION_REQUIRED", "Save the displayed review revision, or zero for a new review.")
        excluded = data.get("excludedKeys", [])
        choices = data.get("choices", {})
        if not isinstance(excluded, list) or any(not isinstance(key, str) for key in excluded) or not isinstance(choices, dict):
            fail("REVIEW_SELECTION", "Choose observation identities and any explicit duplicate rows.")
        groups = {}
        for row in self._rows(capture["id"]):
            groups.setdefault(row["key"], []).append(row)
        unknown = set(excluded) - groups.keys()
        if unknown or set(choices) - groups.keys():
            fail("REVIEW_SELECTION", "The review names observations outside its original capture.")
        unresolved = []
        for key, rows in groups.items():
            if key in choices and choices[key] not in {row["rowId"] for row in rows}:
                fail("REVIEW_SELECTION", "A chosen duplicate row belongs to another observation.")
            if key not in excluded and len(rows) > 1 and key not in choices:
                unresolved.append({"key": key, "rows": [row["rowId"] for row in rows]})
        if unresolved:
            fail("DUPLICATE_REVIEW", "Choose the original row to retain for each repeated observation identity, or exclude that identity.", conflicts=unresolved[:100])
        baseline_id = data.get("baselineId") or None
        comparison = self.compare({"captureId": capture["id"], "baselineId": baseline_id, "limit": 1}) if baseline_id else None
        columns = data.get("columns", list(COLUMNS))
        if not isinstance(columns, list) or not columns or len(set(columns)) != len(columns) or set(columns) - set(COLUMNS):
            fail("REVIEW_COLUMNS", "Choose unique fields from the original observation projection.")
        mandatory = {"source_id", "country_id", "country_iso3", "indicator_id", "period", "value", "value_state"}
        if not mandatory <= set(columns):
            fail("REVIEW_COLUMNS", "Keep source, country, indicator, period and value identity in the customer dataset.")
        value = {"schema": "stellar-forge.worldbank-review.v1", "id": review_id,
                 "title": text(data.get("title", capture["selectionTitle"]), "review title", 128),
                 "note": text(data.get("note", ""), "review note", 100000),
                 "captureId": capture["id"], "captureSha256": capture["captureSha256"],
                 "baselineId": baseline_id, "comparison": {key: comparison[key] for key in
                    ("counts", "sameSelection", "baselineId", "captureId")} if comparison else None,
                 "excludedKeys": sorted(set(excluded)), "choices": choices, "columns": columns,
                 "includedObservations": len(groups) - len(set(excluded)), "summary": capture["summary"]}
        return self.put("review", value, data["expectedRevision"])

    def review_read(self, data):
        value = self.get("review", data.get("id"))
        history = self.db.execute("SELECT revision,data FROM history WHERE kind='review' AND id=? ORDER BY revision DESC",
                                  (value["id"],))
        return {**value, "history": [{"revision": row["revision"], "updatedAt": json.loads(row["data"])["updatedAt"]}
                                   for row in history]}

    def export(self, data):
        export_id = identifier(data.get("id"), "export id")
        with file_lock(self.root / "locks" / ("export-" + export_id + ".lock")):
            existing = self.get("export", export_id, required=False)
            if existing:
                if existing["reviewId"] != data.get("reviewId"):
                    fail("EXPORT_IDENTITY", "This export belongs to its original review.")
                return self.export_read({"id": export_id})
            review = self.get("review", data.get("reviewId"))
            if data.get("expectedRevision", review["revision"]) != review["revision"]:
                fail("REVISION_CHANGED", "Review the current edition revision before preparing its export.")
            capture = self.capture_detail({"id": review["captureId"]})
            if capture.get("captureSha256") != review["captureSha256"]:
                fail("REVIEW_SOURCE_CHANGED", "The review no longer matches its completed source capture.")
            output = self.root / "exports" / export_id
            output.mkdir(mode=0o700, exist_ok=True)
            intent = {"id": export_id, "reviewId": review["id"], "reviewRevision": review["revision"],
                      "captureSha256": capture["captureSha256"]}
            immutable(output / "intent.json", encode(intent))
            columns = review["columns"]
            csv_stream = io.StringIO(newline="")
            writer = csv.writer(csv_stream, lineterminator="\n")
            writer.writerow(columns)
            rows_written = 0
            for row in self._rows(capture["id"]):
                if row["key"] in review["excludedKeys"]:
                    continue
                if row["key"] in review["choices"] and review["choices"][row["key"]] != row["rowId"]:
                    continue
                values = []
                for key in columns:
                    value = row[key]
                    values.append("" if value is None else "true" if value is True else "false" if value is False else str(value))
                writer.writerow(values)
                rows_written += 1
            if rows_written != review["includedObservations"]:
                fail("REVIEW_POPULATION", "The reviewed observation population differs from the export.")
            csv_bytes = csv_stream.getvalue().encode("utf-8")
            config = {
                "schema": "stellar-forge.csv-dataset.v1", "file": "dataset.csv",
                "name": "World Bank " + capture["selectionId"][:96],
                "columns": {column: ({"type": "string", "nullable": True} if column == "value" else
                             "boolean" if column == "aggregate" else "integer" if column in ("source_page", "source_row")
                             else "string") for column in columns},
                "filters": [column for column in ("source_id", "country_id", "country_iso3", "indicator_id",
                                                 "value_state", "aggregate", "obs_status") if column in columns],
                "ranges": ["period"], "sorts": ["period", "country_id", "indicator_id"],
                "maxBytes": 256 * 1024 * 1024, "maxRows": max(1, rows_written), "maxCellChars": 1024 * 1024,
                "defaultLimit": 50, "maxLimit": 1000, "maxPageBytes": 900 * 1024,
            }
            files = []
            def add(relative, raw):
                path = output / relative
                immutable(path, raw)
                files.append(file_descriptor(output, path))
            add("dataset.csv", csv_bytes)
            add("dataset.json", encode(config))
            add("review.json", encode(review))
            add("selection.json", encode(capture["spec"]))
            add("original/capture.json", encode(capture))
            for page in capture["pages"]:
                add("original/" + page["bodyFile"], read_bytes(self.root / page["bodyFile"]))
            retained = [item for item in files if item["path"] not in ("dataset.csv", "dataset.json")]
            source = {
                "schema": "stellar-forge.worldbank-export.v1", **intent,
                "provider": "World Bank Indicators API V2", "api": "https://api.worldbank.org/v2",
                "sourceId": capture["spec"]["sourceId"], "selection": capture["spec"],
                "acquisition": capture["acquisition"], "capturedAt": capture["completedAt"],
                "collections": capture["collections"], "observations": rows_written,
                "numericRepresentation": "Original JSON number tokens retained as exact strings; source null remains nullable.",
                "periodRepresentation": "Original source period labels and observation statuses retained.",
                "attribution": "World Bank and the original source organizations retained in the indicator metadata.",
                "documentation": [
                    "https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures",
                    "https://datahelpdesk.worldbank.org/knowledgebase/articles/898599-indicator-api-queries",
                ],
                "sourceFiles": retained,
            }
            add("source.json", encode(source))
            package_manifest = {"schema": "stellar-forge.worldbank-package.v1", **intent,
                                "files": sorted(files, key=lambda item: item["path"])}
            archive_bytes = io.BytesIO()
            with zipfile.ZipFile(archive_bytes, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                def pack(name, raw):
                    member = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    member.create_system = 3
                    member.external_attr = 0o100600 << 16
                    member.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(member, raw)
                for item in package_manifest["files"]:
                    pack(item["path"], read_bytes(output / item["path"]))
                pack("package-manifest.json", encode(package_manifest))
            add("handover.zip", archive_bytes.getvalue())
            manifest = {"schema": "stellar-forge.worldbank-export-manifest.v1", **intent,
                        "observations": rows_written, "files": sorted(files, key=lambda item: item["path"])}
            immutable(output / "manifest.json", encode(manifest))
            self.put("export", {**intent, "directory": str(output), "manifestSha256": digest(encode(manifest)),
                               "observations": rows_written, "title": review["title"]}, 0)
            return self.export_read({"id": export_id})

    def export_read(self, data):
        saved = self.get("export", data.get("id"))
        root = self.root / "exports" / saved["id"]
        raw = read_bytes(root / "manifest.json")
        if digest(raw) != saved["manifestSha256"]:
            fail("EXPORT_CHANGED", "The retained export manifest changed.")
        manifest = json.loads(raw)
        for item in manifest["files"]:
            path = root / item["path"]
            regular(path, root)
            content = read_bytes(path)
            if len(content) != item["bytes"] or digest(content) != item["sha256"]:
                fail("EXPORT_CHANGED", "A retained export file changed.", file=item["path"])
        return {**saved, "directory": str(root), "manifest": manifest}

    def import_package(self, data):
        capture_id, review_id = identifier(data.get("id")), identifier(data.get("reviewId", data.get("id") + "-review"))
        try:
            raw = base64.b64decode(data["archiveBase64"], validate=True)
        except (KeyError, TypeError, ValueError) as exc:
            raise SourceError("PACKAGE_IMPORT", "Supply the complete retained handover ZIP.") from exc
        if len(raw) > 256 * 1024 * 1024:
            fail("PACKAGE_IMPORT", "The incoming handover exceeds 256 MiB.")
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if len(names) != len(set(names)) or len(names) > 10000 or sum(item.file_size for item in infos) > 512 * 1024 * 1024:
                fail("PACKAGE_IMPORT", "The handover has repeated members or exceeds the supported import capacity.")
            for item in infos:
                path = Path(item.filename)
                if path.is_absolute() or ".." in path.parts or "\\" in item.filename or item.is_dir() or (item.external_attr >> 16) & 0o170000 == 0o120000:
                    fail("PACKAGE_IMPORT", "The handover contains a non-regular or unsafe member.")
            manifest = json.loads(archive.read("package-manifest.json"))
            if manifest.get("schema") != "stellar-forge.worldbank-package.v1":
                fail("PACKAGE_IMPORT", "Use the original World Bank handover package.")
            files = manifest["files"]
            if set(names) != {item["path"] for item in files} | {"package-manifest.json"}:
                fail("PACKAGE_IMPORT", "The archive members differ from its retained manifest.")
            content = {}
            for item in files:
                value = archive.read(item["path"])
                if digest(value) != item["sha256"] or len(value) != item["bytes"]:
                    fail("PACKAGE_IMPORT", "An incoming source file differs from its original descriptor.")
                content[item["path"]] = value
            original = json.loads(content["original/capture.json"])
            selected = original["spec"]
            selection_id = identifier(data.get("selectionId", capture_id + "-selection"))
            prior = self.get("selection", selection_id, required=False)
            if prior:
                if prior["spec"] != selected:
                    fail("PACKAGE_IMPORT", "The receiving selection ID already names different source criteria.")
            else:
                self.save_selection({"id": selection_id, "title": original["selectionTitle"],
                                     "spec": selected, "expectedRevision": 0})
            pages = []
            for page in original["pages"]:
                pages.append({"kind": page["kind"], "page": page["page"],
                              **{key: page[key] for key in ("indicatorId", "requestGroup") if key in page},
                              "bodyBase64": base64.b64encode(content["original/" + page["bodyFile"]]).decode(),
                              "receipt": {key: value for key, value in page.items() if key not in
                                          ("kind", "page", "indicatorId", "requestGroup", "bodyFile", "rows", "pagination")}})
            capture = self.import_pages({"id": capture_id, "selectionId": selection_id, "pages": pages})
            original_review = json.loads(content["review.json"])
            prior_review = self.get("review", review_id, required=False)
            review = self.review({"id": review_id, "captureId": capture_id, "expectedRevision": prior_review["revision"] if prior_review else 0,
                                  "title": original_review["title"], "note": original_review["note"],
                                  "columns": original_review["columns"], "excludedKeys": original_review["excludedKeys"],
                                  "choices": original_review["choices"]})
            return {"capture": capture, "review": review, "originalPackageSha256": digest(raw),
                    "originalCaptureSha256": original["captureSha256"],
                    "originalReviewId": original_review["id"], "originalReviewRevision": original_review["revision"]}


ACTIONS = {
    "state": "state", "save-selection": "save_selection", "catalog": "catalog",
    "capture": "capture", "import-pages": "import_pages", "capture-detail": "capture_detail",
    "observations": "observations", "compare": "compare", "review": "review",
    "review-read": "review_read", "export": "export", "export-read": "export_read",
    "import-package": "import_package",
}


def run(directory, action, data):
    if action not in ACTIONS:
        fail("WORKSPACE_ACTION", "Unknown World Bank workspace action.")
    if not isinstance(data, dict):
        fail("WORKSPACE_INPUT", "Supply a JSON object for the selected action.")
    workspace = Workspace(directory)
    try:
        return getattr(workspace, ACTIONS[action])(data)
    finally:
        workspace.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--action", required=True, choices=sorted(ACTIONS))
    arguments = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt("Capture cancelled by its operator.")))
    try:
        incoming = sys.stdin.buffer.read(256 * 1024 * 1024 + 1)
        if len(incoming) > 256 * 1024 * 1024:
            fail("WORKSPACE_INPUT", "The source action exceeds its input capacity.")
        data = json.loads(incoming or b"{}")
        result = run(arguments.workspace, arguments.action, data)
        sys.stdout.buffer.write(encode(result))
    except SourceError as error:
        sys.stdout.buffer.write(encode({"error": error.public()}))
        return 1
    except (KeyboardInterrupt, SystemExit) as error:
        sys.stdout.buffer.write(encode({"error": {"code": "CAPTURE_INTERRUPTED", "message": str(error)}}))
        return 1
    except Exception as error:
        sys.stdout.buffer.write(encode({"error": {"code": "WORKSPACE_FAILED", "message": str(error)}}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


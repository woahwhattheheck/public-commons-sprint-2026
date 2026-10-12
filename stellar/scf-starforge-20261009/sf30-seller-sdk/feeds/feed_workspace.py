"""MIT. Retained feed authoring on the original XML workspace, database and dataset engine."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import io
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time
import threading
import stat
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
from xml.etree import ElementTree as ET
import zipfile

from original import (Workspace, InputError, json_bytes, load_json, digest, checked_id,
                      private_write, file_digest, regular, sync_dir)
from feed_source import parse_feed, choose_observations, proposal, MAX_FEED_BYTES

SCHEMA = "stellar-forge.feed-workspace.v1"
EDITION = "stellar-forge.feed-edition.v1"
PACKET = "stellar-forge.feed-project.v1"
IDENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")
FIELDS = ["key", "id", "title", "link", "published", "updated", "summary", "content",
          "authors", "categories", "enclosures", "feed_id", "source_url", "source_sha256"]
DEFAULT_FIELDS = ["key", "id", "title", "link", "published", "updated", "summary", "feed_id", "source_sha256"]


def validate_url(value):
    if not isinstance(value, str) or len(value) > 8192 or any(ord(x) < 33 for x in value):
        raise InputError("Use an absolute HTTP or HTTPS feed URL")
    try:
        u = urlsplit(value)
        if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password or u.fragment:
            raise ValueError()
        u.port
    except ValueError:
        raise InputError("Use an absolute HTTP or HTTPS URL without user information or fragment")
    return value


def origin(value):
    u = urlsplit(validate_url(value))
    port = u.port
    authority = u.hostname.lower()
    if ":" in authority:
        authority = "[" + authority + "]"
    if port and port != (443 if u.scheme == "https" else 80):
        authority += ":" + str(port)
    return u.scheme + "://" + authority


def identifier(value):
    if not isinstance(value, str) or not IDENT.fullmatch(value):
        raise InputError("Use an identifier of 1–80 letters, numbers, dots, underscores or hyphens")
    return value


def offset_limit(offset, limit):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 250:
        raise InputError("Use a nonnegative offset and limit from 1 to 250")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class FeedWorkspace(Workspace):
    """One original writer lease; additive feed tables share workspace.sqlite."""
    def __init__(self, root, create=False, opener=None):
        super().__init__(root, create=create)
        self.opener = opener or build_opener(NoRedirect())
        self.cancel_event = threading.Event()
        for name in ("feed-http", "feed-editions", "feed-exports"):
            path = self.root / name
            path.mkdir(mode=0o700, exist_ok=True)
            if path.is_symlink() or not path.is_dir():
                raise InputError("Feed storage must use real private directories")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS feed_sources(id TEXT PRIMARY KEY,config TEXT NOT NULL,
            revision INTEGER NOT NULL,atom_id TEXT,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_operations(id TEXT PRIMARY KEY,payload TEXT NOT NULL,
            result TEXT,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_operation_history(id TEXT PRIMARY KEY,payload TEXT NOT NULL,
            result TEXT,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_runs(id TEXT PRIMARY KEY,feed_id TEXT NOT NULL,
            state TEXT NOT NULL,body TEXT NOT NULL,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,feed_id TEXT NOT NULL,url TEXT NOT NULL,body TEXT NOT NULL,created REAL NOT NULL);
          CREATE INDEX IF NOT EXISTS feed_requests_url ON feed_requests(feed_id,url,id);
          CREATE TABLE IF NOT EXISTS feed_records(feed_id TEXT NOT NULL,identity TEXT NOT NULL,
            body TEXT NOT NULL,capture_id TEXT NOT NULL,revision INTEGER NOT NULL,
            PRIMARY KEY(feed_id,identity));
          CREATE TABLE IF NOT EXISTS feed_applications(capture_id TEXT PRIMARY KEY,feed_id TEXT NOT NULL,
            revision INTEGER NOT NULL,body TEXT NOT NULL,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_editions(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS feed_reviews(feed_id TEXT NOT NULL,identity TEXT NOT NULL,
            revision INTEGER NOT NULL,body TEXT NOT NULL,created REAL NOT NULL,
            PRIMARY KEY(feed_id,identity,revision));
        """)

    def _begin(self, operation_id, payload):
        identifier(operation_id)
        encoded = json_bytes(payload).decode()
        row = self.db.execute("SELECT * FROM feed_operations WHERE id=?", (operation_id,)).fetchone()
        if row:
            if row["payload"] != encoded:
                raise InputError("Operation ID already belongs to a different action; reopen the original operation")
            return load_json(row["result"]) if row["result"] is not None else None
        if self.db.execute("SELECT 1 FROM feed_operation_history WHERE id=?", (operation_id,)).fetchone():
            raise InputError("This operation is retained history for another edition; open the carried edition or use a new operation ID")
        with self.db:
            self.db.execute("INSERT INTO feed_operations VALUES(?,?,NULL,?)", (operation_id, encoded, time.time()))
        return None

    def _done(self, operation_id, result):
        self.db.execute("UPDATE feed_operations SET result=? WHERE id=?", (json_bytes(result).decode(), operation_id))
        return result

    def feed(self, feed_id):
        row = self.db.execute("SELECT * FROM feed_sources WHERE id=?", (identifier(feed_id),)).fetchone()
        if row is None:
            raise InputError("Unknown registered feed")
        return {"id": row["id"], "config": load_json(row["config"]), "revision": row["revision"],
                "atomId": row["atom_id"], "created": row["created"]}

    def register(self, feed_id, config, expected_revision, operation_id):
        identifier(feed_id)
        if not isinstance(config, dict) or set(config) - {"url", "label", "rssIdentity", "allowedOrigins"}:
            raise InputError("Feed configuration accepts url, label, rssIdentity and allowedOrigins")
        value = {"url": validate_url(config.get("url")), "label": config.get("label", feed_id),
                 "rssIdentity": config.get("rssIdentity", "guid-or-link")}
        if not isinstance(value["label"], str) or not 1 <= len(value["label"]) <= 160:
            raise InputError("Feed label must have 1–160 characters")
        if value["rssIdentity"] not in ("guid", "guid-or-link"):
            raise InputError("RSS identity must be guid or guid-or-link")
        choices = config.get("allowedOrigins", [origin(value["url"])])
        if not isinstance(choices, list) or not 1 <= len(choices) <= 32:
            raise InputError("Choose 1–32 origins for source paging and redirects")
        value["allowedOrigins"] = sorted(set(origin(x) for x in choices))
        if origin(value["url"]) not in value["allowedOrigins"]:
            raise InputError("The source origin must be included in allowedOrigins")
        if type(expected_revision) is not int or expected_revision < 0:
            raise InputError("Supply the current nonnegative revision")
        with self.mutex:
            saved = self._begin(operation_id, {"action": "register", "id": feed_id, "config": value, "revision": expected_revision})
            if saved is not None:
                return saved
            row = self.db.execute("SELECT revision FROM feed_sources WHERE id=?", (feed_id,)).fetchone()
            actual = row[0] if row else 0
            if actual != expected_revision:
                raise InputError(f"Feed revision changed: expected {expected_revision}, current {actual}")
            with self.db:
                if row:
                    self.db.execute("UPDATE feed_sources SET config=?,revision=? WHERE id=?",
                                    (json_bytes(value).decode(), actual + 1, feed_id))
                else:
                    self.db.execute("INSERT INTO feed_sources VALUES(?,?,1,NULL,?)",
                                    (feed_id, json_bytes(value).decode(), time.time()))
                return self._done(operation_id, self.feed(feed_id))

    def feed_state(self):
        with self.mutex:
            feeds = []
            for r in self.db.execute("SELECT id FROM feed_sources ORDER BY id"):
                item = self.feed(r["id"])
                item["records"] = self.db.execute("SELECT COUNT(*) FROM feed_records WHERE feed_id=?", (r["id"],)).fetchone()[0]
                latest = self.db.execute("SELECT id,state FROM feed_runs WHERE feed_id=? ORDER BY created DESC LIMIT 1", (r["id"],)).fetchone()
                item["latestCapture"] = dict(latest) if latest else None
                feeds.append(item)
            return {"schema": SCHEMA, "feeds": feeds, "fields": FIELDS, "defaultFields": DEFAULT_FIELDS,
                    "editions": [self.edition_summary(load_json(r[0])) for r in self.db.execute("SELECT body FROM feed_editions ORDER BY created DESC")]}

    def capture_view(self, capture_id):
        with self.mutex:
            row = self.db.execute("SELECT * FROM feed_runs WHERE id=?", (checked_id(capture_id),)).fetchone()
            if row is None:
                raise InputError("Unknown retained capture")
            return load_json(row["body"]) | {"id": row["id"], "state": row["state"], "created": row["created"]}

    def captures(self, feed_id, offset=0, limit=50):
        offset_limit(offset, limit)
        self.feed(feed_id)
        with self.mutex:
            rows = list(self.db.execute("SELECT id FROM feed_runs WHERE feed_id=? ORDER BY created DESC LIMIT ? OFFSET ?",
                                       (feed_id, limit + 1, offset)))
            return {"items": [self.capture_view(r[0]) for r in rows[:limit]],
                    "nextOffset": offset + limit if len(rows) > limit else None}

    def _save_capture(self, ident, value, state):
        self.capture_progress = {"id": ident, "state": state, "feedId": value["feedId"],
                                 "pages": len(value["pages"]), "requests": len(value["attempts"]),
                                 "nextUrl": value.get("nextUrl"), "error": value.get("error")}
        with self.db:
            self.db.execute("UPDATE feed_runs SET body=?,state=? WHERE id=?", (json_bytes(value).decode(), state, ident))

    def _cached(self, feed_id, url):
        row = self.db.execute("SELECT body FROM feed_requests WHERE feed_id=? AND url=? ORDER BY id DESC LIMIT 1",
                              (feed_id, url)).fetchone()
        latest = load_json(row[0]) if row else None
        if latest and latest.get("retryAt", 0) > time.time():
            raise InputError(f"Source requested a pause until {datetime.fromtimestamp(latest['retryAt'], timezone.utc).isoformat()}")
        # The most recent error must not discard a previously retained validator.
        for row in self.db.execute("SELECT body FROM feed_requests WHERE feed_id=? AND url=? ORDER BY id DESC", (feed_id, url)):
            value = load_json(row[0])
            if value.get("status") in (200, 304) and value.get("sourceSha256") and value.get("parsed"):
                return value
        return None

    def _raw(self, data):
        ident = digest(data)
        path = self.root / "feed-http" / (ident + ".body")
        if path.exists():
            if file_digest(path, MAX_FEED_BYTES) != ident:
                raise InputError("Retained HTTP body changed")
        else:
            private_write(path, data)
            sync_dir(path.parent)
        return {"sha256": ident, "path": str(path.relative_to(self.root)), "bytes": len(data)}

    def _request(self, run_id, feed, url, force=False):
        validate_url(url)
        config = feed["config"]
        if origin(url) not in config["allowedOrigins"]:
            raise InputError(f"Source link origin is not selected: {origin(url)}")
        cached = self._cached(feed["id"], url)
        headers = {"Accept": "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9",
                   "Accept-Encoding": "identity", "User-Agent": "StellarForgeFeed/1.0"}
        if cached and not force:
            if cached.get("etag"):
                headers["If-None-Match"] = cached["etag"]
            if cached.get("lastModified"):
                headers["If-Modified-Since"] = cached["lastModified"]
        receipt = {"url": url, "requestedAt": datetime.now(timezone.utc).isoformat(), "requestHeaders": headers,
                   "status": None, "headers": {}, "sourceSha256": None, "parsed": False}
        raw, response = b"", None
        try:
            request = Request(url, headers=headers, method="GET")
            try:
                response = self.opener.open(request, timeout=30)
            except HTTPError as e:
                response = e
            receipt["status"] = response.code
            receipt["headers"] = {k.lower(): v for k, v in response.headers.items()
                                  if k.lower() not in ("set-cookie", "proxy-authenticate", "www-authenticate")}
            if receipt["headers"].get("content-encoding", "identity").lower() not in ("", "identity"):
                raise InputError("Source ignored identity encoding; retain an uncompressed feed export")
            chunks, total = [], 0
            while True:
                if self.cancel_event.is_set():
                    raise InputError("Capture cancelled; resume the same operation to continue")
                chunk = response.read(65536)
                if not chunk:
                    break
                chunks.append(chunk); total += len(chunk)
                if total > MAX_FEED_BYTES:
                    break
            raw = b"".join(chunks)
            if len(raw) > MAX_FEED_BYTES:
                raise InputError("Feed response exceeds 32 MiB; select a smaller source page")
            receipt["bytes"] = len(raw)
            status = receipt["status"]
            if status == 304:
                if cached is None or not any(x in headers for x in ("If-None-Match", "If-Modified-Since")):
                    raise InputError("304 has no matching conditional source in this workspace")
                receipt["sourceSha256"] = cached["sourceSha256"]
                source_path = self.root / "sources" / (cached["sourceSha256"] + ".xml")
                if file_digest(source_path, MAX_FEED_BYTES) != cached["sourceSha256"]:
                    raise InputError("Conditional source bytes changed")
                raw = source_path.read_bytes()
                receipt["reusedRequestSource"] = cached["sourceSha256"]
            elif status == 200:
                source = self.add_source(io.BytesIO(raw), config["label"], "feed.xml")
                receipt["sourceSha256"] = source["id"]
            else:
                receipt["raw"] = self._raw(raw)
            receipt["etag"] = receipt["headers"].get("etag", cached.get("etag") if status == 304 and cached else None)
            receipt["lastModified"] = receipt["headers"].get("last-modified", cached.get("lastModified") if status == 304 and cached else None)
            if status in (200, 304):
                parsed = parse_feed(raw, url, config["rssIdentity"])
                receipt["parsed"] = True
                receipt["metadata"] = parsed["metadata"]
                receipt["entryCount"] = len(parsed["entries"])
            if status in (429, 503):
                retry = receipt["headers"].get("retry-after", "")
                try:
                    receipt["retryAt"] = time.time() + int(retry) if retry.isdigit() else parsedate_to_datetime(retry).timestamp()
                except (ValueError, TypeError, OverflowError):
                    pass
        except Exception as error:
            receipt["error"] = str(error)
            if raw and len(raw) <= MAX_FEED_BYTES and not receipt["sourceSha256"]:
                receipt["raw"] = self._raw(raw)
        finally:
            if response is not None:
                response.close()
        receipt["completedAt"] = datetime.now(timezone.utc).isoformat()
        with self.db:
            cursor = self.db.execute("INSERT INTO feed_requests(run_id,feed_id,url,body,created) VALUES(?,?,?,?,?)",
                                    (run_id, feed["id"], url, json_bytes(receipt).decode(), time.time()))
            receipt["requestId"] = cursor.lastrowid
        return receipt

    def capture(self, feed_id, operation_id, *, follow_pages=True, page_limit=100, force=False, from_capture=None):
        if type(page_limit) is not int or not 1 <= page_limit <= 1000 or type(follow_pages) is not bool or type(force) is not bool:
            raise InputError("Choose 1–1000 pages and explicit follow_pages/force booleans")
        with self.mutex:
            feed = self.feed(feed_id)
            payload = {"action": "capture", "feed": feed_id, "config": feed["config"], "followPages": follow_pages,
                       "pageLimit": page_limit, "force": force, "fromCapture": from_capture}
            saved = self._begin(operation_id, payload)
            if saved is not None:
                return saved
            ident = digest(json_bytes({"operationId": operation_id, "payload": payload}))
            existing = self.db.execute("SELECT id FROM feed_runs WHERE id=?", (ident,)).fetchone()
            if existing:
                value = self.capture_view(ident)
                value = {k: v for k, v in value.items() if k not in ("id", "state", "created")}
            else:
                url = feed["config"]["url"]
                if from_capture:
                    old = self.capture_view(from_capture)
                    if old["feedId"] != feed_id or not old.get("nextUrl"):
                        raise InputError("The selected capture has no next page for this feed")
                    url = old["nextUrl"]
                value = {"schema": "stellar-forge.feed-capture.v1", "feedId": feed_id, "operationId": operation_id,
                         "config": feed["config"], "pages": [], "attempts": [], "nextUrl": url, "fromCapture": from_capture}
                with self.db:
                    self.db.execute("INSERT INTO feed_runs VALUES(?,?,?,?,?)",
                                    (ident, feed_id, "RUNNING", json_bytes(value).decode(), time.time()))
            self.cancel_event.clear()
            self._save_capture(ident, value, "RUNNING")
            try:
                visited = {p["url"] for p in value["pages"]}
                while value["nextUrl"] and len(value["pages"]) < page_limit:
                    if self.cancel_event.is_set():
                        raise InputError("Capture cancelled; resume the same operation to continue")
                    url = value["nextUrl"]
                    if url in visited:
                        raise InputError("Feed paging or redirect forms a cycle; inspect retained pages")
                    request = self._request(ident, feed, url, force)
                    value["attempts"].append(request["requestId"])
                    self._save_capture(ident, value, "RUNNING")
                    if request.get("error"):
                        raise InputError(request["error"])
                    if request["status"] in (301, 302, 303, 307, 308):
                        target = urljoin(url, request["headers"].get("location", ""))
                        if not request["headers"].get("location") or len(visited) >= page_limit * 6:
                            raise InputError("Source redirect has no target or exceeds the selected run")
                        if urlsplit(url).scheme == "https" and urlsplit(target).scheme == "http":
                            raise InputError("Source redirect would downgrade HTTPS")
                        visited.add(url)
                        value["nextUrl"] = validate_url(target)
                        self._save_capture(ident, value, "RUNNING")
                        continue
                    if request["status"] not in (200, 304) or not request["parsed"]:
                        raise InputError(f"Source returned HTTP {request['status']}; request {request['requestId']} is retained")
                    visited.add(url)
                    value["pages"].append({k: request[k] for k in ("requestId", "url", "status", "sourceSha256", "metadata", "entryCount")})
                    value["nextUrl"] = request["metadata"]["next"]
                    self._save_capture(ident, value, "RUNNING")
                    if not follow_pages:
                        break
                state = "CAPTURED"
                value["pageCount"] = len(value["pages"])
                value["observations"] = sum(x["entryCount"] for x in value["pages"])
                value.pop("error", None)
                with self.db:
                    self.db.execute("UPDATE feed_runs SET state=?,body=? WHERE id=?", (state, json_bytes(value).decode(), ident))
                    return self._done(operation_id, self.capture_view(ident))
            except Exception as e:
                value["error"] = str(e)
                self._save_capture(ident, value, "FAILED")
                raise

    def resume_capture(self, capture_id):
        with self.mutex:
            capture = self.capture_view(capture_id)
            row = self.db.execute("SELECT payload FROM feed_operations WHERE id=?", (capture["operationId"],)).fetchone()
            payload = load_json(row[0]) if row else {}
            if payload.get("action") != "capture":
                raise InputError("This capture did not originate from a resumable HTTP operation")
            return self.capture(capture["feedId"], capture["operationId"], follow_pages=payload["followPages"],
                                page_limit=payload["pageLimit"], force=payload["force"], from_capture=payload["fromCapture"])

    def import_source(self, feed_id, data, operation_id, source_url=None):
        with self.mutex:
            feed = self.feed(feed_id)
            url = validate_url(source_url or feed["config"]["url"])
            if origin(url) not in feed["config"]["allowedOrigins"]:
                raise InputError("Imported source URL is outside the selected feed origins")
            if not isinstance(data, bytes) or len(data) > MAX_FEED_BYTES:
                raise InputError("Import an original feed file up to 32 MiB")
            payload = {"action": "import", "feed": feed_id, "config": feed["config"], "url": url, "sha256": digest(data)}
            saved = self._begin(operation_id, payload)
            if saved is not None:
                return saved
            source = self.add_source(io.BytesIO(data), feed["config"]["label"], "feed.xml")
            document = parse_feed(data, url, feed["config"]["rssIdentity"])
            ident = digest(json_bytes({"operationId": operation_id, "payload": payload}))
            value = {"schema": "stellar-forge.feed-capture.v1", "feedId": feed_id, "operationId": operation_id,
                     "config": feed["config"], "pages": [{"requestId": None, "url": url, "status": None,
                     "sourceSha256": source["id"], "metadata": document["metadata"], "entryCount": len(document["entries"])}],
                     "attempts": [], "nextUrl": document["metadata"]["next"], "fromCapture": None,
                     "pageCount": 1, "observations": len(document["entries"]), "kind": "FILE_IMPORT"}
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO feed_runs VALUES(?,?,?,?,?)",
                                (ident, feed_id, "CAPTURED", json_bytes(value).decode(), time.time()))
                return self._done(operation_id, self.capture_view(ident))

    def requests(self, capture_id):
        self.capture_view(capture_id)
        return [{"requestId": r["id"], **load_json(r["body"])} for r in self.db.execute(
                "SELECT id,body FROM feed_requests WHERE run_id=? ORDER BY id", (capture_id,))]

    def _documents(self, capture):
        documents = []
        for page in capture["pages"]:
            path = self.root / "sources" / (checked_id(page["sourceSha256"]) + ".xml")
            if file_digest(path, MAX_FEED_BYTES) != page["sourceSha256"]:
                raise InputError("Retained feed source changed")
            documents.append(parse_feed(path.read_bytes(), page["url"], capture["config"]["rssIdentity"]))
        return documents

    def _proposals(self, capture):
        candidates = choose_observations(self._documents(capture))
        proposals = []
        for key, entries in candidates.items():
            row = self.db.execute("SELECT body FROM feed_records WHERE feed_id=? AND identity=?", (capture["feedId"], key)).fetchone()
            current = load_json(row[0]) if row else None
            proposals.append({"identity": key, **proposal(current, entries)})
        return proposals

    def review(self, capture_id, offset=0, limit=50):
        offset_limit(offset, limit)
        with self.mutex:
            capture = self.capture_view(capture_id)
            if capture["state"] != "CAPTURED":
                raise InputError("Resume this capture before reviewing its complete acquired pages")
            items = self._proposals(capture)
            feed = self.feed(capture["feedId"])
            identities = sorted({p["metadata"]["id"] for p in capture["pages"] if p["metadata"]["format"] == "atom1"})
            changed = bool(feed["atomId"] and identities and identities != [feed["atomId"]])
            application = self.db.execute("SELECT body FROM feed_applications WHERE capture_id=?", (capture_id,)).fetchone()
            return {"capture": capture, "feed": feed, "counts": dict(Counter(x["kind"] for x in items)),
                    "total": len(items), "items": items[offset:offset + limit],
                    "nextOffset": offset + limit if offset + limit < len(items) else None,
                    "atomIdentities": identities, "feedIdentityChanged": changed,
                    "application": load_json(application[0]) if application else None}

    def apply(self, capture_id, expected_revision, operation_id, decisions=None, accept_identity=False):
        decisions = decisions or {}
        if not isinstance(decisions, dict) or type(accept_identity) is not bool:
            raise InputError("Supply explicit identity choices and accept_identity boolean")
        with self.mutex:
            saved = self._begin(operation_id, {"action": "apply", "capture": capture_id, "revision": expected_revision,
                                              "decisions": decisions, "acceptIdentity": accept_identity})
            if saved is not None:
                return saved
            capture = self.capture_view(capture_id)
            if capture["state"] != "CAPTURED":
                raise InputError("Resume this capture before applying it")
            feed = self.feed(capture["feedId"])
            if type(expected_revision) is not int or feed["revision"] != expected_revision:
                raise InputError(f"Feed revision changed; current revision is {feed['revision']}")
            previous = self.db.execute("SELECT body FROM feed_applications WHERE capture_id=?", (capture_id,)).fetchone()
            if previous:
                with self.db:
                    return self._done(operation_id, load_json(previous[0]))
            identities = sorted({p["metadata"]["id"] for p in capture["pages"] if p["metadata"]["format"] == "atom1"})
            if len(identities) > 1:
                raise InputError("Acquired pages identify different Atom feeds; select a coherent source capture")
            if feed["atomId"] and identities and identities[0] != feed["atomId"] and not accept_identity:
                raise InputError("The Atom feed identity changed; review and explicitly accept its new identity")
            proposed = self._proposals(capture)
            known = {x["identity"] for x in proposed}
            if set(decisions) - known:
                raise InputError("A selected decision is outside this capture")
            changes = []
            for item in proposed:
                choice = decisions.get(item["identity"])
                candidates = {x["contentHash"]: x for x in item["candidates"]}
                if choice == "keep":
                    selected = None
                elif choice is not None:
                    if not isinstance(choice, str) or choice not in candidates:
                        raise InputError("Choose the exact observed content hash or keep")
                    selected = candidates[choice]
                elif item["kind"] == "CONFLICT":
                    raise InputError(f"Choose a retained version for conflicting identity {item['identity']}")
                elif item["kind"] in ("UNCHANGED", "STALE"):
                    selected = None
                else:
                    selected = item["candidate"]
                changes.append({"identity": item["identity"], "kind": item["kind"], "selected": selected,
                                "previousHash": item["current"]["contentHash"] if item["current"] else None,
                                "choice": selected["contentHash"] if selected else "keep"})
            revision = feed["revision"] + 1
            result = {"schema": "stellar-forge.feed-application.v1", "captureId": capture_id, "feedId": feed["id"],
                      "revision": revision, "counts": dict(Counter(x["kind"] for x in changes)),
                      "changed": sum(x["selected"] is not None for x in changes),
                      "decisions": [{"identity": x["identity"], "kind": x["kind"], "choice": x["choice"],
                                     "previousHash": x["previousHash"]} for x in changes]}
            with self.db:
                for change in changes:
                    if change["selected"] is not None:
                        self.db.execute("INSERT INTO feed_records VALUES(?,?,?,?,?) ON CONFLICT(feed_id,identity) DO UPDATE SET "
                                        "body=excluded.body,capture_id=excluded.capture_id,revision=excluded.revision",
                                        (feed["id"], change["identity"], json_bytes(change["selected"]).decode(), capture_id, revision))
                self.db.execute("UPDATE feed_sources SET revision=?,atom_id=? WHERE id=?",
                                (revision, identities[0] if identities else feed["atomId"], feed["id"]))
                self.db.execute("INSERT INTO feed_applications VALUES(?,?,?,?,?)",
                                (capture_id, feed["id"], revision, json_bytes(result).decode(), time.time()))
                return self._done(operation_id, result)

    def records(self, feed_id, *, query="", state="active", offset=0, limit=50):
        offset_limit(offset, limit)
        if state not in ("active", "deleted", "all") or not isinstance(query, str) or len(query) > 1000:
            raise InputError("Choose active, deleted or all records and a search up to 1000 characters")
        self.feed(feed_id)
        with self.mutex:
            found = []
            for row in self.db.execute("SELECT * FROM feed_records WHERE feed_id=? ORDER BY identity", (feed_id,)):
                body = load_json(row["body"])
                if state != "all" and body["deleted"] != (state == "deleted"):
                    continue
                if query.casefold() not in (body["title"] + "\n" + body["id"] + "\n" + body["summary"]["text"]).casefold():
                    continue
                note = self.db.execute("SELECT revision,body FROM feed_reviews WHERE feed_id=? AND identity=? ORDER BY revision DESC LIMIT 1",
                                       (feed_id, row["identity"])).fetchone()
                found.append(body | {"captureId": row["capture_id"], "revision": row["revision"],
                    "review": {"revision": note[0], **load_json(note[1])} if note else {"revision": 0, "note": "", "tags": [], "starred": False}})
            return {"items": found[offset:offset + limit], "total": len(found),
                    "nextOffset": offset + limit if offset + limit < len(found) else None}

    def annotate(self, feed_id, identity, expected_revision, operation_id, *, note="", tags=None, starred=False):
        self.feed(feed_id); checked_id(identity)
        tags = tags or []
        if not isinstance(note, str) or len(note) > 20000 or not isinstance(tags, list) or len(tags) > 32 or any(
                not isinstance(x, str) or not 1 <= len(x) <= 80 for x in tags) or type(starred) is not bool:
            raise InputError("Use a note up to 20,000 characters, up to 32 short tags, and a starred boolean")
        body = {"note": note, "tags": sorted(set(tags)), "starred": starred}
        with self.mutex:
            saved = self._begin(operation_id, {"action": "annotate", "feed": feed_id, "identity": identity,
                                              "revision": expected_revision, "body": body})
            if saved is not None:
                return saved
            if not self.db.execute("SELECT 1 FROM feed_records WHERE feed_id=? AND identity=?", (feed_id, identity)).fetchone():
                raise InputError("Unknown retained feed record")
            latest = self.db.execute("SELECT MAX(revision) FROM feed_reviews WHERE feed_id=? AND identity=?", (feed_id, identity)).fetchone()[0] or 0
            if type(expected_revision) is not int or latest != expected_revision:
                raise InputError(f"Review revision changed; current revision is {latest}")
            with self.db:
                self.db.execute("INSERT INTO feed_reviews VALUES(?,?,?,?,?)",
                                (feed_id, identity, latest + 1, json_bytes(body).decode(), time.time()))
                return self._done(operation_id, {"feedId": feed_id, "identity": identity, "revision": latest + 1, **body})

    def edition(self, feed_ids, name, fields, operation_id, expected_revisions):
        if not isinstance(feed_ids, list) or not feed_ids or len(feed_ids) > 100 or len(set(feed_ids)) != len(feed_ids):
            raise InputError("Choose 1–100 distinct retained feeds")
        if not isinstance(name, str) or not 1 <= len(name) <= 128:
            raise InputError("Edition name must have 1–128 characters")
        if not isinstance(fields, list) or not fields or len(set(fields)) != len(fields) or "key" not in fields or set(fields) - set(FIELDS):
            raise InputError("Select exposed feed fields, including the stable key")
        if not isinstance(expected_revisions, dict) or set(expected_revisions) != set(feed_ids):
            raise InputError("Select the reviewed revision of every feed")
        with self.mutex:
            payload = {"action": "edition", "feeds": sorted(feed_ids), "name": name, "fields": fields, "revisions": expected_revisions}
            saved = self._begin(operation_id, payload)
            if saved is not None:
                return saved
            feed_rows = [self.feed(x) for x in sorted(feed_ids)]
            if any(type(expected_revisions[f["id"]]) is not int or f["revision"] != expected_revisions[f["id"]] for f in feed_rows):
                raise InputError("A selected feed changed; review the current revisions")
            rows, lineage = [], []
            root = ET.Element("feed-edition")
            for feed in feed_rows:
                for row in self.db.execute("SELECT * FROM feed_records WHERE feed_id=? ORDER BY identity", (feed["id"],)):
                    value = load_json(row["body"])
                    if value["deleted"]:
                        continue
                    projection = self.projection(feed["id"], value)
                    item = ET.SubElement(root, "item")
                    for field in fields:
                        ET.SubElement(item, field).text = projection[field]
                    rows.append({k: projection[k] for k in fields})
                    lineage.append({"key": projection["key"], "feedId": feed["id"], "identity": value["identity"],
                                    "contentHash": value["contentHash"], "sourceSha256": value["sourceSha256"], "captureId": row["capture_id"]})
            normalized = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            source = self.add_source(io.BytesIO(normalized), name, "feed-edition.xml")
            filter_fields = [x for x in ("key", "id", "feed_id", "source_sha256") if x in fields]
            sort_fields = [x for x in ("title", "published", "updated", "id") if x in fields]
            plan = self.save_plan({"schema": "stellar-forge.xml-mapping.v1", "name": "Retained feed edition",
                "recordPath": ["feed-edition", "item"], "columns": [{"name": x, "path": [x], "type": "string",
                    "nullable": False, "mode": "single", "missing": "empty"} for x in fields],
                "keys": ["key"], "filters": filter_fields, "sorts": sort_fields, "allowEmpty": True,
                "maxRows": 1000000, "maxBytes": 256 * 1024 * 1024, "maxCellChars": 1048576})
            built = self.build(source["id"], plan["id"])
            core = {"schema": EDITION, "name": name, "fields": fields, "feeds": feed_rows,
                    "revisions": expected_revisions, "buildId": built["id"], "sourceId": source["id"],
                    "rowCount": len(rows), "lineage": lineage}
            ident = digest(json_bytes(core))
            result = {"id": ident, **core}
            path = self.root / "feed-editions" / (ident + ".json")
            if path.exists():
                if path.read_bytes() != json_bytes(result):
                    raise InputError("Retained edition identity conflicts")
            else:
                private_write(path, json_bytes(result)); sync_dir(path.parent)
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO feed_editions VALUES(?,?,?)", (ident, json_bytes(result).decode(), time.time()))
                return self._done(operation_id, result)

    @staticmethod
    def projection(feed_id, value):
        return {"key": digest(json_bytes([feed_id, value["identity"]])), "id": value["id"],
                "title": value["title"], "link": value["link"], "published": value["published"], "updated": value["updated"],
                "summary": value["summary"]["value"], "content": value["content"]["value"],
                "authors": json_bytes(value["authors"]).decode().rstrip("\n"),
                "categories": json_bytes(value["categories"]).decode().rstrip("\n"),
                "enclosures": json_bytes(value["enclosures"]).decode().rstrip("\n"),
                "feed_id": feed_id, "source_url": value["sourceUrl"], "source_sha256": value["sourceSha256"]}

    def edition_view(self, edition_id):
        with self.mutex:
            row = self.db.execute("SELECT body FROM feed_editions WHERE id=?", (checked_id(edition_id),)).fetchone()
            if not row:
                raise InputError("Unknown retained edition")
            value = load_json(row[0])
            core = {k: v for k, v in value.items() if k != "id"}
            if digest(json_bytes(core)) != edition_id:
                raise InputError("Retained edition identity changed")
            return value

    def export_edition(self, edition_id, destination):
        with self.mutex:
            edition = self.edition_view(edition_id)
            result = self.export_dataset(edition["buildId"], destination)
            path = Path(result["directory"])
            private_write(path / "feed-lineage.json", json_bytes(self.public_lineage(edition)))
            sync_dir(path)
            return {"directory": str(path), "dataset": str(path / "dataset.json"), "editionId": edition_id,
                    "files": {p.name: {"bytes": regular(p).st_size, "sha256": file_digest(p)} for p in path.iterdir()}}

    def cancel_capture(self):
        self.cancel_event.set()
        return {"cancellationRequested": True}

    @staticmethod
    def edition_summary(value):
        return {k: value[k] for k in ("id", "schema", "name", "fields", "revisions", "buildId", "sourceId", "rowCount")}

    @staticmethod
    def public_lineage(value):
        return {"schema": "stellar-forge.feed-dataset-lineage.v1", "editionId": value["id"],
                "name": value["name"], "fields": value["fields"], "buildId": value["buildId"],
                "rowCount": value["rowCount"], "revisions": value["revisions"], "lineage": value["lineage"]}

    def export_project(self, edition_id, output):
        """Current selected-feed state, complete source history and original XML build."""
        with self.mutex, self.scratch() as temp:
            edition = self.edition_view(edition_id)
            self.export_packet(edition["buildId"], temp / "native.zip")
            feed_ids = [f["id"] for f in edition["feeds"]]
            # The edition is immutable; reopening the received workspace must
            # also preserve the selected feeds' present current records.
            feeds = [self.feed(f) for f in feed_ids]
            captures = [self.capture_view(r[0]) for f in feed_ids for r in self.db.execute(
                "SELECT id FROM feed_runs WHERE feed_id=? ORDER BY created", (f,))]
            requests = [{"originalRequestId": r["id"], "runId": r["run_id"], "feedId": r["feed_id"],
                         "url": r["url"], "body": load_json(r["body"]), "created": r["created"]}
                        for f in feed_ids for r in self.db.execute("SELECT * FROM feed_requests WHERE feed_id=? ORDER BY id", (f,))]
            records = [{"feedId": r["feed_id"], "identity": r["identity"], "body": load_json(r["body"]),
                        "captureId": r["capture_id"], "revision": r["revision"]}
                       for f in feed_ids for r in self.db.execute("SELECT * FROM feed_records WHERE feed_id=? ORDER BY identity", (f,))]
            applications = [{"captureId": r["capture_id"], "feedId": r["feed_id"], "revision": r["revision"],
                             "body": load_json(r["body"]), "created": r["created"]}
                            for f in feed_ids for r in self.db.execute("SELECT * FROM feed_applications WHERE feed_id=? ORDER BY revision", (f,))]
            reviews = [{"feedId": r["feed_id"], "identity": r["identity"], "revision": r["revision"],
                        "body": load_json(r["body"]), "created": r["created"]}
                       for f in feed_ids for r in self.db.execute("SELECT * FROM feed_reviews WHERE feed_id=? ORDER BY identity,revision", (f,))]
            operations, history = [], []
            for row in list(self.db.execute("SELECT * FROM feed_operations ORDER BY created")) + list(self.db.execute("SELECT * FROM feed_operation_history ORDER BY created")):
                payload = load_json(row["payload"])
                if (payload.get("feed") in feed_ids or payload.get("id") in feed_ids or
                    payload.get("capture") in {c["id"] for c in captures} or
                    payload.get("action") == "edition" and set(payload.get("feeds", [])) <= set(feed_ids)):
                    result = load_json(row["result"]) if row["result"] else None
                    if payload.get("action") == "edition" and (result is None or result.get("id") != edition_id):
                        history.append(dict(row))
                    else:
                        operations.append(dict(row))
            body = {"schema": PACKET, "edition": edition, "feeds": feeds, "captures": captures, "requests": requests,
                    "records": records, "applications": applications, "reviews": reviews, "operations": operations, "operationHistory": history}
            private_write(temp / "project.json", json_bytes(body))
            selected = {"project.json": temp / "project.json", "native.zip": temp / "native.zip"}
            sources = {x["sourceSha256"] for x in edition["lineage"]} | {p["sourceSha256"] for c in captures for p in c["pages"]}
            # Failed valid XML is also part of the source history.
            sources |= {r["body"]["sourceSha256"] for r in requests if r["body"].get("sourceSha256")}
            for sha in sorted(sources):
                path = self.root / "sources" / (checked_id(sha) + ".xml")
                if file_digest(path) != sha:
                    raise InputError("Original feed source changed")
                selected["sources/" + sha + ".xml"] = path
            for r in requests:
                raw = r["body"].get("raw")
                if raw:
                    sha = checked_id(raw["sha256"])
                    path = self.root / "feed-http" / (sha + ".body")
                    if file_digest(path, MAX_FEED_BYTES) != sha:
                        raise InputError("Original HTTP source changed")
                    selected["http/" + sha + ".body"] = path
            manifest = {"schema": PACKET, "editionId": edition_id,
                        "files": {name: {"bytes": regular(p, 512 * 1024 * 1024).st_size,
                                        "sha256": file_digest(p, 512 * 1024 * 1024)}
                                  for name, p in selected.items()}}
            output = Path(output)
            with os.fdopen(os.open(output, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600), "w+b") as handle:
                try:
                    with zipfile.ZipFile(handle, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                        archive.writestr("manifest.json", json_bytes(manifest))
                        for name, path in selected.items():
                            archive.write(path, name)
                    handle.flush(); os.fsync(handle.fileno())
                except Exception:
                    output.unlink(missing_ok=True); raise
            return {"file": str(output), "bytes": regular(output, 1024 * 1024 * 1024).st_size,
                    "sha256": file_digest(output, 1024 * 1024 * 1024), "editionId": edition_id}

    def receive_project(self, packet, operation_id):
        packet = Path(packet)
        packet_sha = file_digest(packet, 1024 * 1024 * 1024)
        with self.mutex:
            saved = self._begin(operation_id, {"action": "receive", "sha256": packet_sha})
            if saved is not None:
                return saved
            with self.scratch() as temp, zipfile.ZipFile(packet) as archive:
                infos = archive.infolist()
                names = [i.filename for i in infos]
                if len(names) != len(set(names)) or not {"manifest.json", "project.json", "native.zip"} <= set(names):
                    raise InputError("Feed project has missing or duplicate members")
                allowed = re.compile(r"(sources/[0-9a-f]{64}\.xml|http/[0-9a-f]{64}\.body)\Z")
                total = 0
                for info in infos:
                    if info.filename not in ("manifest.json", "project.json", "native.zip") and not allowed.fullmatch(info.filename):
                        raise InputError("Feed project contains an unsupported member path")
                    ceiling = 16 * 1024 * 1024 if info.filename == "manifest.json" else 256 * 1024 * 1024 if info.filename == "project.json" else 512 * 1024 * 1024 if info.filename == "native.zip" else MAX_FEED_BYTES
                    total += info.file_size
                    if (info.flag_bits & 1 or info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or
                        info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or
                        info.file_size > ceiling or total > 1024 * 1024 * 1024):
                        raise InputError("Feed project exceeds its supported member type or complete size")
                    destination = temp / info.filename
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with archive.open(info) as inp:
                        data = inp.read(ceiling + 1)
                    if len(data) > ceiling:
                        raise InputError("Feed project member exceeds its declared size")
                    private_write(destination, data)
                manifest = load_json((temp / "manifest.json").read_bytes())
                if manifest.get("schema") != PACKET or set(manifest.get("files", {})) != set(names) - {"manifest.json"}:
                    raise InputError("Invalid feed project manifest")
                for name, expected in manifest["files"].items():
                    path = temp / name
                    if expected != {"bytes": regular(path, 512 * 1024 * 1024).st_size,
                                    "sha256": file_digest(path, 512 * 1024 * 1024)}:
                        raise InputError(f"Feed project identity differs: {name}")
                body = load_json((temp / "project.json").read_bytes())
                required = {"schema", "edition", "feeds", "captures", "requests", "records", "applications", "reviews", "operations", "operationHistory"}
                if not isinstance(body, dict) or set(body) != required or body["schema"] != PACKET:
                    raise InputError("Unsupported feed project body")
                edition = body["edition"]
                if not isinstance(edition, dict) or edition.get("schema") != EDITION or \
                   digest(json_bytes({k: v for k, v in edition.items() if k != "id"})) != edition.get("id") or \
                   manifest.get("editionId") != edition["id"]:
                    raise InputError("Feed edition identity differs")
                feed_ids = {identifier(f["id"]) for f in body["feeds"]}
                if len(feed_ids) != len(body["feeds"]) or {f["id"] for f in edition["feeds"]} != feed_ids:
                    raise InputError("Feed project declarations are inconsistent")
                captures = {checked_id(c["id"]): c for c in body["captures"]}
                if len(captures) != len(body["captures"]):
                    raise InputError("Feed project has duplicate capture identities")
                parsed = {}
                for capture in captures.values():
                    if capture["feedId"] not in feed_ids:
                        raise InputError("Capture belongs to another feed")
                    for page in capture["pages"]:
                        source = temp / "sources" / (checked_id(page["sourceSha256"]) + ".xml")
                        if file_digest(source, MAX_FEED_BYTES) != page["sourceSha256"]:
                            raise InputError("Capture source bytes differ")
                        key = (page["sourceSha256"], page["url"], capture["config"]["rssIdentity"])
                        parsed[key] = parse_feed(source.read_bytes(), page["url"], capture["config"]["rssIdentity"])
                for row in body["records"]:
                    capture = captures.get(row["captureId"])
                    if row["feedId"] not in feed_ids or not capture or capture["feedId"] != row["feedId"]:
                        raise InputError("Retained record and capture scope differ")
                    item = row["body"]
                    documents = [parsed[(p["sourceSha256"], p["url"], capture["config"]["rssIdentity"])] for p in capture["pages"]]
                    observed = choose_observations(documents).get(checked_id(row["identity"]), [])
                    if not any(x == item for x in observed):
                        raise InputError("Retained record differs from its original captured XML")
                # Reconstruct the selected immutable edition from its exact
                # observations, including historical versions older than current.
                fields = edition.get("fields")
                if not isinstance(fields, list) or not fields or len(set(fields)) != len(fields) or \
                   set(fields) - set(FIELDS) or "key" not in fields:
                    raise InputError("Received edition has another projection contract")
                normalized_root = ET.Element("feed-edition")
                edition_keys = set()
                for lineage in edition["lineage"]:
                    capture = captures.get(lineage["captureId"])
                    if not capture or lineage["feedId"] != capture["feedId"]:
                        raise InputError("Edition lineage belongs to another capture")
                    documents = [parsed[(p["sourceSha256"], p["url"], capture["config"]["rssIdentity"])] for p in capture["pages"]]
                    observed = choose_observations(documents).get(lineage["identity"], [])
                    selected = next((x for x in observed if x["contentHash"] == lineage["contentHash"] and
                                     x["sourceSha256"] == lineage["sourceSha256"]), None)
                    if not selected or selected["deleted"]:
                        raise InputError("Edition lineage does not select an active original observation")
                    projected = self.projection(lineage["feedId"], selected)
                    if projected["key"] != lineage["key"] or projected["key"] in edition_keys:
                        raise InputError("Edition row identity differs or repeats")
                    edition_keys.add(projected["key"])
                    item = ET.SubElement(normalized_root, "item")
                    for field in fields:
                        ET.SubElement(item, field).text = projected[field]
                normalized = ET.tostring(normalized_root, encoding="utf-8", xml_declaration=True)
                if digest(normalized) != edition["sourceId"] or len(edition_keys) != edition["rowCount"]:
                    raise InputError("Edition rows differ from the original XML build source")
                # Resolve every existing identity before mutation. Existing feeds
                # can only be re-received when their complete selected state agrees.
                for feed in body["feeds"]:
                    existing = self.db.execute("SELECT * FROM feed_sources WHERE id=?", (feed["id"],)).fetchone()
                    if existing and self.feed(feed["id"]) != feed:
                        raise InputError(f"Existing feed differs: {feed['id']}; receive into a separate workspace")
                for collection, table, key_columns, make in [
                    (body["captures"], "feed_runs", ("id",),
                     lambda x: (x["id"], x["feedId"], x["state"],
                        json_bytes({k: v for k, v in x.items() if k not in ("id", "state", "created")}).decode(), x["created"])),
                    (body["applications"], "feed_applications", ("capture_id",),
                     lambda x: (x["captureId"], x["feedId"], x["revision"], json_bytes(x["body"]).decode(), x["created"])),
                    (body["records"], "feed_records", ("feed_id", "identity"),
                     lambda x: (x["feedId"], x["identity"], json_bytes(x["body"]).decode(), x["captureId"], x["revision"])),
                    (body["reviews"], "feed_reviews", ("feed_id", "identity", "revision"),
                     lambda x: (x["feedId"], x["identity"], x["revision"], json_bytes(x["body"]).decode(), x["created"])),
                    (body["operations"], "feed_operations", ("id",),
                     lambda x: (x["id"], x["payload"], x["result"], x["created"])),
                    (body["operationHistory"], "feed_operation_history", ("id",),
                     lambda x: (x["id"], x["payload"], x["result"], x["created"])),
                ]:
                    for item in collection:
                        values = make(item)
                        prior = self.db.execute("SELECT * FROM " + table + " WHERE " + " AND ".join(k + "=?" for k in key_columns),
                                                values[:len(key_columns)]).fetchone()
                        if prior is not None and tuple(prior) != values:
                            raise InputError("Existing retained record conflicts; receive into a separate workspace")
                for row in body["operations"]:
                    payload = load_json(row["payload"])
                    result = load_json(row["result"]) if row["result"] else None
                    if payload.get("action") == "edition" and (result is None or result.get("id") != edition["id"]):
                        raise InputError("A replayable edition operation needs its carried native build")
                    if self.db.execute("SELECT 1 FROM feed_operation_history WHERE id=?", (row["id"],)).fetchone():
                        raise InputError("Operation identity is already retained history in this workspace")
                for row in body["operationHistory"]:
                    if self.db.execute("SELECT 1 FROM feed_operations WHERE id=?", (row["id"],)).fetchone():
                        raise InputError("Historical operation identity already exists as an active operation")
                for row in body["requests"]:
                    if row["feedId"] not in feed_ids or row["runId"] not in captures or \
                       captures[row["runId"]]["feedId"] != row["feedId"]:
                        raise InputError("HTTP receipt belongs to another retained capture")
                    validate_url(row["url"])
                for name in names:
                    if name.startswith("sources/"):
                        with (temp / name).open("rb") as inp:
                            self.add_source(inp, "Received original feed", Path(name).name)
                    elif name.startswith("http/"):
                        self._raw((temp / name).read_bytes())
                native = self.import_packet(temp / "native.zip")
                if native["build"]["id"] != edition["buildId"]:
                    raise InputError("Received original dataset has another build identity")
                # Verify selected edition rows against the same original engine
                # through native.import_packet before making them discoverable.
                path = self.root / "feed-editions" / (edition["id"] + ".json")
                if path.exists() and path.read_bytes() != json_bytes(edition):
                    raise InputError("Existing edition conflicts")
                if not path.exists():
                    private_write(path, json_bytes(edition)); sync_dir(path.parent)
                with self.db:
                    for feed in body["feeds"]:
                        self.db.execute("INSERT OR IGNORE INTO feed_sources VALUES(?,?,?,?,?)",
                                        (feed["id"], json_bytes(feed["config"]).decode(), feed["revision"], feed["atomId"], feed["created"]))
                    for capture in body["captures"]:
                        value = {k: v for k, v in capture.items() if k not in ("id", "state", "created")}
                        self.db.execute("INSERT OR IGNORE INTO feed_runs VALUES(?,?,?,?,?)",
                            (capture["id"], capture["feedId"], capture["state"], json_bytes(value).decode(), capture["created"]))
                    for row in body["requests"]:
                        # Surrogate row numbers are local; retain the sender's
                        # original number within the immutable response receipt.
                        value = row["body"] | {"originalRequestId": row["originalRequestId"]}
                        if not self.db.execute("SELECT 1 FROM feed_requests WHERE run_id=? AND body=?",
                                               (row["runId"], json_bytes(value).decode())).fetchone():
                            self.db.execute("INSERT INTO feed_requests(run_id,feed_id,url,body,created) VALUES(?,?,?,?,?)",
                                (row["runId"], row["feedId"], row["url"], json_bytes(value).decode(), row["created"]))
                    for row in body["records"]:
                        self.db.execute("INSERT OR IGNORE INTO feed_records VALUES(?,?,?,?,?)",
                            (row["feedId"], row["identity"], json_bytes(row["body"]).decode(), row["captureId"], row["revision"]))
                    for row in body["applications"]:
                        self.db.execute("INSERT OR IGNORE INTO feed_applications VALUES(?,?,?,?,?)",
                            (row["captureId"], row["feedId"], row["revision"], json_bytes(row["body"]).decode(), row["created"]))
                    for row in body["reviews"]:
                        self.db.execute("INSERT OR IGNORE INTO feed_reviews VALUES(?,?,?,?,?)",
                            (row["feedId"], row["identity"], row["revision"], json_bytes(row["body"]).decode(), row["created"]))
                    for row in body["operations"]:
                        self.db.execute("INSERT OR IGNORE INTO feed_operations VALUES(?,?,?,?)",
                            (row["id"], row["payload"], row["result"], row["created"]))
                    for row in body["operationHistory"]:
                        self.db.execute("INSERT OR IGNORE INTO feed_operation_history VALUES(?,?,?,?)",
                            (row["id"], row["payload"], row["result"], row["created"]))
                    self.db.execute("INSERT OR IGNORE INTO feed_editions VALUES(?,?,?)",
                                    (edition["id"], json_bytes(edition).decode(), time.time()))
                    return self._done(operation_id, {"schema": "stellar-forge.feed-receiving.v1", "packetSha256": packet_sha,
                        "editionId": edition["id"], "buildId": edition["buildId"], "feeds": sorted(feed_ids),
                        "records": len(body["records"]), "captures": len(body["captures"]), "reconstructed": True})

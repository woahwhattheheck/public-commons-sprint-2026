# SPDX-License-Identifier: MIT
"""Durable public GET capture; emits the existing parcel receiving contract."""
from __future__ import annotations
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from .providers import (PROFILE, MAX_BODY, MAX_TOTAL, BATCH, CaptureError, check,
    digest, json_bytes, public_url, initial_jobs, final_jobs, lookup_job,
    union_selection, response_summary)
from ..intake import ParcelIntake, MANIFEST, SCHEMA, read_exact

HEADERS = frozenset(("date", "etag", "last-modified", "content-type", "content-length",
                    "content-encoding", "retry-after", "cache-control", "age", "location"))

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def moment(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

def read_json(path):
    return read_exact(path.read_bytes())

def atomic(path, body, *, immutable=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        check(path.read_bytes() == body, "CAPTURE_CONFLICT", "An immutable capture member differs.", path=str(path))
        return
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", suffix=".partial", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(name, path)
            except FileExistsError:
                check(path.read_bytes() == body, "CAPTURE_CONFLICT", "An immutable capture member differs.", path=str(path))
        else:
            os.replace(name, path)
        if os.name != "nt":
            parent = os.open(path.parent, os.O_RDONLY)
            try: os.fsync(parent)
            finally: os.close(parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)

@contextmanager
def capture_lock(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / ".capture.lock").open("a+b") as stream:
        if os.name == "nt":
            import msvcrt
            if stream.seek(0, os.SEEK_END) == 0:
                stream.write(b"\0"); stream.flush()
            stream.seek(0)
            try: msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise CaptureError("CAPTURE_BUSY", "Another writer owns this same capture.") from error
            try: yield
            finally:
                stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try: fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise CaptureError("CAPTURE_BUSY", "Another writer owns this same capture.") from error
            try: yield
            finally: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

class PublisherRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def retrieve(url, timeout):
    request = urllib.request.Request(public_url(url), headers={
        "User-Agent": "StarforgeParcelCapture/1.0",
        "Accept": "*/*", "Accept-Encoding": "identity"})
    opener = urllib.request.build_opener(PublisherRedirect())
    try:
        response = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        final_url = public_url(response.geturl())
        headers = {name.lower(): value for name, value in response.headers.items() if name.lower() in HEADERS}
        length = response.headers.get("Content-Length")
        if length:
            check(int(length) <= MAX_BODY, "CAPTURE_SIZE", "The original response exceeds 256 MiB.")
        chunks, total = [], 0
        while True:
            chunk = response.read(min(1024 * 1024, MAX_BODY + 1 - total))
            if not chunk: break
            chunks.append(chunk); total += len(chunk)
            check(total <= MAX_BODY, "CAPTURE_SIZE", "The original response exceeds 256 MiB.")
        return {"status": response.status, "finalUrl": final_url, "headers": headers,
                "body": b"".join(chunks), "capturedAt": now()}

def retry_time(headers, attempts, at):
    base = moment(at)
    retry = headers.get("retry-after")
    provider = None
    if retry:
        try:
            seconds = int(retry)
            if seconds >= 0: provider = base + timedelta(seconds=seconds)
        except ValueError:
            try:
                provider = parsedate_to_datetime(retry)
                if provider.tzinfo is None: provider = provider.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError, OverflowError): pass
    fallback = base + timedelta(seconds=min(900, 30 * 2 ** min(attempts, 5)))
    return max(base, provider or fallback).isoformat(timespec="milliseconds").replace("+00:00", "Z")

class CaptureWorkspace:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.config_path = self.root / "capture.json"
        self._verified = {}
        self._selection_cache = None

    def initialize(self, *, label, actor, capture_id=None):
        check(isinstance(label, str) and 1 <= len(label.strip()) <= 200 and
              isinstance(actor, str) and 1 <= len(actor.strip()) <= 200,
              "CAPTURE_IDENTITY", "Name the source capture and responsible operator.")
        with capture_lock(self.root):
            if self.config_path.exists():
                value = read_json(self.config_path)
                check(value["label"] == label and value["actor"] == actor and
                      (capture_id is None or value["captureId"] == capture_id),
                      "CAPTURE_IDENTITY", "Continue the original capture with its original identity.")
            else:
                value = {"schema": "starforge.parcel-publisher-capture.v1", "profile": PROFILE,
                         "captureId": capture_id or str(uuid.uuid4()), "label": label,
                         "actor": actor, "createdAt": now()}
                atomic(self.config_path, json_bytes(value))
        return self.status()

    def config(self):
        check(self.config_path.is_file(), "CAPTURE_MISSING", "Initialize the named publisher capture first.")
        value = read_json(self.config_path)
        check(value.get("schema") == "starforge.parcel-publisher-capture.v1" and value.get("profile") == PROFILE,
              "CAPTURE_SCHEMA", "Use the retained supported publisher capture.")
        return value

    def object(self, body):
        sha = digest(body)
        path = "objects/" + sha[:2] + "/" + sha + ".bin"
        atomic(self.root / path, body)
        return {"path": path, "bytes": len(body), "sha256": sha}

    def verify_body(self, record):
        path = self.root / record["path"]
        stat = path.stat()
        identity = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns,
                    record["bytes"], record["sha256"])
        if self._verified.get(record["path"]) != identity:
            import hashlib
            value = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""): value.update(chunk)
            check(stat.st_size == record["bytes"] and value.hexdigest() == record["sha256"],
                  "CAPTURE_BYTES_CHANGED", "A retained original publisher body differs.", path=record["path"])
            check(path.stat().st_mtime_ns == stat.st_mtime_ns, "CAPTURE_BYTES_CHANGED",
                  "A publisher body changed while checking its original digest.")
            self._verified[record["path"]] = identity

    def body(self, record):
        self.verify_body(record)
        data = (self.root / record["path"]).read_bytes()
        check(len(data) == record["bytes"] and digest(data) == record["sha256"],
              "CAPTURE_BYTES_CHANGED", "A retained original publisher body differs.", path=record["path"])
        return data

    def receipt(self, item):
        path = self.root / "receipts" / (item["id"] + ".json")
        if not path.exists(): return None
        value = read_json(path)
        check(value.get("job") == item and value.get("status") in ("COMPLETE", "SPLIT"),
              "CAPTURE_RECEIPT", "The retained request receipt differs from its original source.")
        self.verify_body(value["body"])
        return value

    def recover_response(self, item):
        """Finish an original durable response after interruption, without another GET."""
        directory = self.root / "attempts" / item["id"]
        responses = []
        for path in directory.glob("*.response.json"):
            value = read_json(path)
            if value.get("job") == item and value.get("status") in ("COMPLETE", "SPLIT"):
                responses.append(value)
        if not responses: return False
        value = sorted(responses, key=lambda row: (row["startedAt"], row["attemptId"]))[0]
        summary = response_summary(item, self.body(value["body"]))
        check(all(value.get(key) == result for key, result in summary.items()),
              "CAPTURE_RECEIPT", "The retained original response summary differs.")
        atomic(self.root / "receipts" / (item["id"] + ".json"), json_bytes(value))
        atomic(self.root / "progress" / (item["id"] + ".json"),
               json_bytes({"status": value["status"], "attemptId": value["attemptId"]}), immutable=False)
        return True

    def blocked(self, item):
        path = self.root / "progress" / (item["id"] + ".json")
        return read_json(path) if path.exists() else None

    def graph(self):
        self.config()
        jobs, pending, complete, split = [], [], [], []
        def visit(item):
            jobs.append(item)
            receipt = self.receipt(item)
            if receipt is None:
                pending.append(item); return
            if receipt["status"] == "SPLIT":
                split.append(receipt)
                pins = item["requestedPins"]; half = len(pins) // 2
                check(half > 0, "CAPTURE_SPLIT", "An indivisible selected response cannot be split.")
                visit(lookup_job(item["kind"], pins[:half], item["id"] + "-a", item.get("recordLimit", 2000)))
                visit(lookup_job(item["kind"], pins[half:], item["id"] + "-b", item.get("recordLimit", 2000)))
            else:
                complete.append(receipt)
        for item in initial_jobs(): visit(item)
        selection, keys = None, []
        city = [value for value in complete if value["job"]["family"].endswith("-csv")]
        if len(city) == 2:
            city_identity = tuple(x["body"]["sha256"] for x in city)
            if self._selection_cache is None or self._selection_cache[0] != city_identity:
                keys, selection = union_selection([(x["job"]["sourceId"], x["job"]["family"], self.body(x["body"])) for x in city])
                self._selection_cache = (city_identity, keys, selection)
            else:
                _, keys, selection = self._selection_cache
            geometry_schema = next((x for x in complete if x["job"]["id"] == "pittsburgh-parcels-catalog-before"), None)
            geometry_limit = min(2000, geometry_schema["metadataIdentity"]["maxRecordCount"]) if geometry_schema else 2000
            for offset in range(0, len(keys), BATCH):
                for kind in ("county", "geometry"):
                    visit(lookup_job(kind, keys[offset:offset + BATCH], geometry_limit=geometry_limit))
            if not pending:
                for item in final_jobs(): visit(item)
        check(len(jobs) < 4900, "CAPTURE_FILES", "The complete capture would exceed the receiving file inventory.")
        return {"jobs": jobs, "pending": pending, "complete": complete, "split": split,
                "selection": selection, "keys": keys}

    def status(self):
        config = self.config()
        graph = self.graph()
        waiting, blocked = [], []
        for item in graph["pending"]:
            progress = self.blocked(item)
            if progress and progress.get("status") == "BLOCKED":
                blocked.append({"jobId": item["id"], **progress})
            elif progress and progress.get("retryAfter") and moment(progress["retryAfter"]) > moment(now()):
                waiting.append({"jobId": item["id"], **progress})
        complete = not graph["pending"] and graph["selection"] is not None
        return {"schema": "starforge.parcel-publisher-capture-status.v1",
            "capture": config, "status": "READY" if complete else "BLOCKED" if blocked else "WAITING" if waiting else "CAPTURING",
            "jobs": len(graph["jobs"]), "completed": len(graph["complete"]), "splitResponses": len(graph["split"]),
            "pending": len(graph["pending"]), "selection": graph["selection"], "waiting": waiting, "blocked": blocked,
            "receivingDirectory": str(self.root / "delivery") if (self.root / "delivery" / MANIFEST).exists() else None}

    def advance(self, *, max_requests=8, timeout=45, transport=retrieve):
        check(type(max_requests) is int and 1 <= max_requests <= 64 and type(timeout) is int and 1 <= timeout <= 120,
              "CAPTURE_BUDGET", "Use 1–64 requests and a 1–120 second per-request timeout.")
        with capture_lock(self.root):
            self.config()
            used = 0
            while used < max_requests:
                graph = self.graph()
                if not graph["pending"]: break
                item = graph["pending"][0]
                if self.recover_response(item): continue
                progress = self.blocked(item) or {}
                if progress.get("status") == "BLOCKED": break
                if progress.get("retryAfter") and moment(progress["retryAfter"]) > moment(now()): break
                attempt_id = str(uuid.uuid4())
                attempt = {"schema": "starforge.parcel-capture-attempt.v1", "attemptId": attempt_id,
                           "job": item, "startedAt": now()}
                attempt_root = self.root / "attempts" / item["id"]
                atomic(attempt_root / (attempt_id + ".request.json"), json_bytes(attempt))
                attempts = len(list(attempt_root.glob("*.request.json")))
                used += 1
                result = None
                try:
                    response = transport(item["sourceUrl"], timeout)
                    check(isinstance(response.get("body"), bytes) and len(response["body"]) <= MAX_BODY,
                          "CAPTURE_TRANSPORT", "Retain the exact bounded original response bytes.")
                    public_url(response["finalUrl"])
                    headers = {str(k).lower(): str(v) for k, v in response.get("headers", {}).items() if str(k).lower() in HEADERS}
                    body = self.object(response["body"])
                    result = {**attempt, "capturedAt": response["capturedAt"], "httpStatus": response["status"],
                              "finalUrl": response["finalUrl"], "headers": headers, "body": body}
                    if response["status"] == 200:
                        check(headers.get("content-encoding", "identity").lower() in ("", "identity"),
                              "CAPTURE_ENCODING", "The publisher ignored identity encoding; retain the original response for review.")
                        summary = response_summary(item, response["body"])
                        result.update(summary)
                        atomic(attempt_root / (attempt_id + ".response.json"), json_bytes(result))
                        atomic(self.root / "receipts" / (item["id"] + ".json"), json_bytes(result))
                        atomic(self.root / "progress" / (item["id"] + ".json"),
                               json_bytes({"status": result["status"], "attemptId": attempt_id}), immutable=False)
                    else:
                        transient = response["status"] in (408, 425, 429, 500, 502, 503, 504)
                        result.update(status="WAITING" if transient else "BLOCKED",
                                      error={"code": "PUBLISHER_HTTP", "status": response["status"]})
                        if transient: result["retryAfter"] = retry_time(headers, attempts, response["capturedAt"])
                        atomic(attempt_root / (attempt_id + ".response.json"), json_bytes(result))
                        atomic(self.root / "progress" / (item["id"] + ".json"), json_bytes(result), immutable=False)
                        break
                except Exception as error:
                    if isinstance(error, CaptureError):
                        detail = error.value(); status = "BLOCKED"
                    elif isinstance(error, (urllib.error.URLError, TimeoutError, OSError)):
                        detail = {"code": "PUBLISHER_TRANSPORT", "message": str(error)}; status = "WAITING"
                    else:
                        detail = {"code": "PUBLISHER_FORMAT", "message": str(error)}; status = "BLOCKED"
                    failed = {**(result or attempt), "status": status, "failedAt": now(), "error": detail}
                    if status == "WAITING": failed["retryAfter"] = retry_time({}, attempts, failed["failedAt"])
                    atomic(attempt_root / (attempt_id + ".failure.json"), json_bytes(failed))
                    atomic(self.root / "progress" / (item["id"] + ".json"), json_bytes(failed), immutable=False)
                    break
        return {"requestsMade": used, **self.status()}

    def retry(self, job_id, reason):
        check(isinstance(reason, str) and reason.strip(), "CAPTURE_REASON", "Record why this blocked publisher request should resume.")
        with capture_lock(self.root):
            graph = self.graph()
            check(job_id in {item["id"] for item in graph["pending"]}, "CAPTURE_JOB", "Select an existing unresolved request.")
            item = next(x for x in graph["pending"] if x["id"] == job_id)
            previous = self.blocked(item) or {}
            check(not previous.get("retryAfter") or moment(previous["retryAfter"]) <= moment(now()),
                  "CAPTURE_COOLDOWN", "Preserve the publisher's actual retry deadline.", retryAfter=previous.get("retryAfter"))
            record = {"jobId": job_id, "reason": reason, "createdAt": now(), "previous": previous}
            atomic(self.root / "retries" / (str(uuid.uuid4()) + ".json"), json_bytes(record))
            atomic(self.root / "progress" / (job_id + ".json"), json_bytes({"status": "READY"}), immutable=False)
        return self.status()

    def finalize(self, *, accept_publisher_change_reason=None):
        with capture_lock(self.root):
            config = self.config()
            graph = self.graph()
            check(graph["selection"] is not None and not graph["pending"], "CAPTURE_INCOMPLETE",
                  "Finish every selected publisher response before producing receiving input.")
            files, changes = [], []
            for value in graph["complete"] + graph["split"]:
                item, body = value["job"], value["body"]
                metadata = value["status"] == "SPLIT"
                entry = {"sourceId": item["sourceId"], "family": "source-metadata" if metadata else item["family"],
                    **body, "filename": item["id"] + (".csv" if item["family"].endswith("-csv") else ".json"),
                    "sourceUrl": item["sourceUrl"], "capturedAt": value["capturedAt"],
                    "finalUrl": value["finalUrl"], "httpStatus": value["httpStatus"]}
                if not metadata:
                    for key in ("requestedPins", "coordinateReferenceSystem"):
                        if key in item: entry[key] = item[key]
                    for key in ("records", "missingKeys"):
                        if key in value: entry[key] = value[key]
                    entry["complete"] = True
                receipt_body = json_bytes(value)
                receipt_record = self.object(receipt_body)
                files.append(entry)
                files.append({"sourceId": item["sourceId"], "family": "source-metadata", **receipt_record,
                    "filename": item["id"] + "-receipt.json", "sourceUrl": item["sourceUrl"],
                    "capturedAt": value["capturedAt"]})
            # A successful lookup may legitimately have the same bytes for several empty scopes.
            # One original object can serve several descriptors only through distinct relative paths.
            for index, entry in enumerate(files):
                entry["objectPath"] = entry.pop("path")
                entry["path"] = "sources/" + str(index).zfill(5) + "-" + entry["filename"]
            by_id = {r["job"]["id"]: r for r in graph["complete"]}
            for item in final_jobs():
                before = by_id[item["id"].replace("-after", "-before")]
                after = by_id[item["id"]]
                if before["metadataIdentity"] != after["metadataIdentity"]:
                    changes.append({"sourceId": item["sourceId"], "before": before["metadataIdentity"], "after": after["metadataIdentity"]})
            check(not changes or isinstance(accept_publisher_change_reason, str) and accept_publisher_change_reason.strip(),
                  "CAPTURE_PUBLISHER_CHANGED", "Publisher metadata changed during this acquisition; review the retained before/after versions.",
                  changes=changes)
            total = sum(f["bytes"] for f in files)
            check(total <= MAX_TOTAL and len(files) <= 10000, "CAPTURE_SIZE", "The complete source edition exceeds the original receiving limits.")
            captures = [r["capturedAt"] for r in graph["complete"] + graph["split"]]
            manifest = {"schema": SCHEMA, "label": config["label"], "createdAt": config["createdAt"],
                "selection": graph["selection"], "files": [{k: v for k, v in f.items() if k != "objectPath"} for f in files],
                "notes": ["Original public responses captured from " + min(captures) + " through " + max(captures) + ".",
                          "Publisher records are source assertions. Review ownership, accountability, assessment and area bases in the original Parcels workspace."],
                "capture": {"schema": config["schema"], "captureId": config["captureId"], "actor": config["actor"],
                    "startedAt": min(captures), "completedAt": max(captures), "publisherChanges": changes,
                    "publisherChangeReview": accept_publisher_change_reason}}
            body = json_bytes(manifest)
            destination = self.root / "delivery"
            if destination.exists():
                check((destination / MANIFEST).read_bytes() == body, "CAPTURE_DELIVERY_CHANGED",
                      "Reopen the exact existing receiving edition with its retained review reason.")
            else:
                staging = self.root / "delivery.partial"
                staging.mkdir(exist_ok=True, mode=0o700)
                try:
                    for entry in files:
                        target = staging / entry["path"]; target.parent.mkdir(parents=True, exist_ok=True)
                        original = self.root / entry["objectPath"]
                        self.body({**entry, "path": entry["objectPath"]})
                        if target.exists():
                            check(target.read_bytes() == original.read_bytes(), "CAPTURE_STAGING_CHANGED",
                                  "A retained receiving member differs from its exact original.", path=entry["path"])
                        else:
                            try: os.link(original, target)
                            except OSError: atomic(target, original.read_bytes())
                    atomic(staging / MANIFEST, body)
                    # Validate through the maintained intake before publishing the directory.
                    ParcelIntake(staging, digest(body)).prepare()
                    os.rename(staging, destination)
                    if os.name != "nt":
                        fd = os.open(self.root, os.O_RDONLY)
                        try: os.fsync(fd)
                        finally: os.close(fd)
                except Exception:
                    # Failed staging remains available for exact inspection and continuation.
                    raise
            prepared = ParcelIntake(destination, digest(body)).prepare()
            receipt = {"schema": "starforge.parcel-publisher-receiving.v1", "captureId": config["captureId"],
                "directory": str(destination), "manifestSha256": digest(body), "manifestBytes": len(body),
                "files": len(files) + 1, "expandedBytes": total + len(body), "summary": prepared["summary"]}
            atomic(self.root / "receiving.json", json_bytes(receipt))
            return receipt

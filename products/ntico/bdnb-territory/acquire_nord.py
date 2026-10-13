#!/usr/bin/env python3
"""Receive the original complete Nord BDNB releases into the existing territory operation.

This is file acquisition for the maintained Analysis importer. It neither imports
rows into another store nor records a business/customer review.
"""
import argparse
import csv
import datetime as dt
import fcntl
import hashlib
import html.parser
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import xml.etree.ElementTree as ET

OPERATION = "BDNB-NORD-SOURCES-2769-20261013"
TABLES = ("batiment_groupe", "adresse", "rel_batiment_groupe_adresse",
          "passage_millesime_batiment_groupe_id", "metadonnees_bdnb_version")
EDITIONS = (
    {"millesime": "2025-07.a", "version": "v0.7.10", "directory": "2025-07-a",
     "page": "https://bdnb.io/archives_data/bdnb_millesime_2025_07_a/"},
    {"millesime": "2026-02.a", "version": "v0.7.11", "directory": "2026-02-a",
     "page": "https://bdnb.io/archives_data/bdnb_millesime_2026_02_a/"},
)
HOSTS = {"bdnb.io", "www.bdnb.io", "www.data.gouv.fr", "data.gouv.fr",
         "open-data.s3.fr-par.scw.cloud"}
BLOCK = 1024 * 1024
MAX_METADATA = 32 * BLOCK
MIN_FREE = 256 * BLOCK
RECEIPT_PREFIX = "__OPENAI_LIBRARY_FILE_WRITE_RECEIPT_V1__="

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def need(condition, message):
    if not condition:
        raise ValueError(message)

def data(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")

def atomic(path, value, binary=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("xb") as out:
            os.chmod(tmp, 0o600)
            out.write(value if binary else data(value))
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)

def identity(path):
    h = hashlib.sha256()
    size = 0
    with Path(path).open("rb") as src:
        for block in iter(lambda: src.read(BLOCK), b""):
            h.update(block)
            size += len(block)
    return {"bytes": size, "sha256": h.hexdigest()}

def read_json(path, default=None):
    return json.loads(Path(path).read_bytes()) if Path(path).exists() else default

def public_url(url):
    parsed = urllib.parse.urlsplit(url)
    need(parsed.scheme == "https" and parsed.hostname in HOSTS and
         not parsed.username and not parsed.password and not parsed.fragment,
         "Unexpected publisher source URL: " + url)
    need(parsed.port in (None, 443), "Unexpected publisher source port")
    return url

class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)

class Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.current = None
    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            self.current = {"href": dict(attrs).get("href", ""), "text": ""}
    def handle_data(self, text):
        if self.current is not None:
            self.current["text"] += text
    def handle_endtag(self, tag):
        if tag.lower() == "a" and self.current is not None:
            self.links.append(self.current)
            self.current = None

class Acquisition:
    def __init__(self, root, library_helper, max_archive_bytes, retained_inputs=None, delivery_mode="library"):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.delivery_mode = delivery_mode
        self.helper = Path(library_helper).resolve() if library_helper else None
        need(delivery_mode in ("library", "native"), "Select the existing delivery route")
        if delivery_mode == "library":
            need(self.helper is not None and self.helper.is_file(),
                 "Select the current original Library upload helper")
        self.retained_inputs = {}
        if retained_inputs:
            supplied = read_json(Path(retained_inputs).resolve())
            need(supplied.get("schema") == "commons.bdnb-retained-originals.v1"
                 and supplied.get("operation_id") == OPERATION
                 and isinstance(supplied.get("inputs"), list), "Retain the original source-input selection")
            for entry in supplied["inputs"]:
                need(isinstance(entry, dict) and isinstance(entry.get("key"), str)
                     and entry["key"] not in self.retained_inputs, "Retained source keys must be unique")
                need(isinstance(entry.get("bytes"), int) and entry["bytes"] > 0,
                     "Retain the original complete source byte count")
                need(not entry.get("sha256") or re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]),
                     "Select the actual original source SHA-256")
                need(isinstance(entry.get("provenance"), dict) and entry["provenance"],
                     "Retain the original file/source receiving reference")
                public_url(entry["requested_url"])
                self.retained_inputs[entry["key"]] = entry
        self.maximum = max_archive_bytes
        self.opener = urllib.request.build_opener(PublicRedirect())
        self.state_path = self.root / "acquisition-state.json"
        self.state = read_json(self.state_path)
        selected = {"operation_id": OPERATION, "department": "59", "editions": list(EDITIONS)}
        if self.state is None:
            self.state = {"schema": "commons.bdnb-nord-acquisition.v1", **selected,
                          "created_at": now(), "downloads": {}, "banks": {}, "events": []}
        else:
            for key, value in selected.items():
                need(self.state.get(key) == value, "The original source selection changed: " + key)
        self.record("OPENED", pid=os.getpid(), root=str(self.root), delivery_mode=delivery_mode)
        if self.retained_inputs:
            atomic(self.root / "retained-input-selection.json", supplied)

    def record(self, event, **fields):
        item = {"at": now(), "event": event, **fields}
        self.state["events"].append(item)
        atomic(self.state_path, self.state)
        print(json.dumps(item, ensure_ascii=False), flush=True)

    def adopt_save_receipts(self, logs, selected):
        receipts = {}
        changed = False
        stderr = logs / "stderr"
        if stderr.exists():
            for line in stderr.read_text(errors="replace").splitlines():
                if not line.startswith(RECEIPT_PREFIX):
                    continue
                try:
                    value = json.loads(line[len(RECEIPT_PREFIX):])
                except ValueError:
                    continue
                if (isinstance(value, dict) and isinstance(value.get("sandbox_path"), str)
                    and re.fullmatch(r"file_[a-f0-9]+", value.get("file_id", ""))
                    and re.fullmatch(r"libfile_[a-f0-9]+", value.get("library_file_id", ""))):
                    receipts[value["sandbox_path"]] = value
        for path, item, key in selected:
            value = receipts.get(str(path))
            if value and key not in self.state["banks"]:
                changed = True
                self.state["banks"][key] = {**item, "saved_at": now(),
                    "file_id": value["file_id"], "library_file_id": value["library_file_id"],
                    "file_name": path.name, "status": "succeeded", "receipt_log": str(stderr.relative_to(self.root))}
                self.state.setdefault("pending_saves", {}).pop(key, None)
        if changed:
            atomic(self.state_path, self.state)

    def bank(self, paths, label):
        selected = []
        for path in paths:
            path = Path(path).resolve()
            need(path.is_relative_to(self.root) and path.is_file() and not path.is_symlink(),
                 "Only whole owned regular files are banked")
            item = {"path": str(path.relative_to(self.root)), **identity(path)}
            key = item["sha256"] + ":" + item["path"]
            if self.delivery_mode == "native":
                if path.name.endswith(".partial"):
                    observations = self.state.setdefault("native_prefix_observations", [])
                    if not any(row["path"] == item["path"] and row["sha256"] == item["sha256"] for row in observations):
                        observations.append({**item, "observed_at": now(), "status": "mutable_prefix",
                            "continuation": "Original downloads slot verifies this prefix before continuing or preserves it under its prior filename"})
                    continue
                if key not in self.state["banks"]:
                    retained_path = path
                    if path.suffix.lower() == ".json":
                        # JSON journals use atomic replacement. Retain their
                        # exact inode before OPENED/BANK events advance them.
                        retained_path = self.root / "native-retained-json" / item["sha256"] / path.name
                        retained_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        if not retained_path.exists():
                            os.link(path, retained_path)
                        need(identity(retained_path) == {"bytes": item["bytes"], "sha256": item["sha256"]},
                             "The retained native JSON changed")
                    self.state["banks"][key] = {**item, "retained_at": now(),
                        "retained_path": str(retained_path.relative_to(self.root)),
                        "status": "retained_local", "delivery_mode": "native"}
                continue
            prior_local = self.state["banks"].get(key)
            if prior_local and prior_local.get("status") == "retained_local":
                self.state.setdefault("earlier_native_retention", []).append(prior_local)
                del self.state["banks"][key]
            if key not in self.state["banks"]:
                pending = self.state.setdefault("pending_saves", {}).get(key)
                if pending:
                    prior = self.root / pending["logs"]
                    self.adopt_save_receipts(prior, [(path, item, key)])
                    if key not in self.state["banks"]:
                        completed = read_json(prior / "result.json")
                        need(completed is not None,
                             "Reconcile the original uncertain Library save before another write: " + str(prior))
                        rows = (completed.get("result") or {}).get("results", [])
                        row = next((row for row in rows if row.get("local_path") == str(path)), None)
                        if row and row.get("status") == "succeeded" and row.get("file_id") and row.get("library_file_id"):
                            self.state["banks"][key] = {**item, "saved_at": now(),
                                **{name: row[name] for name in ("file_id", "library_file_id", "file_name", "status")
                                   if name in row}}
                        else:
                            need(row is not None and row.get("status") == "failed",
                                 "Reconcile the original saved file from its retained provider result: " + str(prior))
                        self.state["pending_saves"].pop(key, None)
                if key not in self.state["banks"]:
                    selected.append((path, item, key))
        if self.delivery_mode == "native":
            self.record("NATIVE_FILES_RETAINED", label=label, files=[str(Path(path).relative_to(self.root)) for path in paths],
                        delivery="Return the complete original persistent root through the accepting host's existing artifact route")
        if not selected:
            return
        stamp = uuid.uuid4().hex
        logs = self.root / "bank" / (label + "-" + stamp)
        logs.mkdir(parents=True, exist_ok=False, mode=0o700)
        uploads = [{"local_path": str(path), "purpose": "create_library_file",
                    "library_artifact_type": "sheet" if path.suffix.lower() in (".xlsx", ".csv")
                    else "other"} for path, _, _ in selected]
        atomic(logs / "selected.json", [item for _, item, _ in selected])
        atomic(logs / "request.json", {"uploads": uploads})
        for path, item, key in selected:
            self.state.setdefault("pending_saves", {})[key] = {
                "logs": str(logs.relative_to(self.root)), "input": item, "started_at": now()}
        self.record("BANK_STARTED", label=label, files=[item for _, item, _ in selected])
        environment = dict(os.environ)
        temporary = self.root / "helper-temporary"
        temporary.mkdir(mode=0o700, exist_ok=True)
        environment["TMPDIR"] = str(temporary)
        with (logs / "stdout").open("wb") as out, (logs / "stderr").open("wb") as err:
            child = subprocess.Popen([sys.executable, "-B", "-u", str(self.helper)],
                stdin=subprocess.PIPE, stdout=out, stderr=err, cwd=self.helper.parent,
                env=environment, shell=False)
            child.stdin.write(data({"uploads": uploads}))
            child.stdin.close()
            relayed = set()
            tick = time.monotonic()
            interrupted = None
            try:
                while child.poll() is None:
                    time.sleep(0.2)
                    for line in (logs / "stderr").read_text(errors="replace").splitlines():
                        if line.startswith(RECEIPT_PREFIX) and line not in relayed:
                            sys.stderr.write(line + "\n")
                            sys.stderr.flush()
                            relayed.add(line)
                    self.adopt_save_receipts(logs, selected)
                    if time.monotonic() - tick >= 15:
                        self.record("BANK_RUNNING", label=label, pid=child.pid)
                        tick = time.monotonic()
            except BaseException as error:
                interrupted = error
                # Drain only this original helper before the parent's failure saver.
                # Its exact receipts are reconciled below even after interruption.
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
        for line in (logs / "stderr").read_text(errors="replace").splitlines():
            if line.startswith(RECEIPT_PREFIX) and line not in relayed:
                sys.stderr.write(line + "\n")
                sys.stderr.flush()
        self.adopt_save_receipts(logs, selected)
        result = None
        for line in reversed((logs / "stdout").read_text(errors="replace").splitlines()):
            try:
                candidate = json.loads(line)
            except ValueError:
                continue
            if isinstance(candidate, dict) and isinstance(candidate.get("results"), list):
                result = candidate
                break
        rows = (result or {}).get("results", [])
        by_path = {row.get("local_path"): row for row in rows}
        for path, item, key in selected:
            row = by_path.get(str(path))
            if row and row.get("status") == "succeeded" and row.get("file_id") and row.get("library_file_id"):
                self.state["banks"][key] = {**item, "saved_at": now(),
                    **{k: row[k] for k in ("file_id", "library_file_id", "file_name", "status")
                       if k in row}}
                self.state.setdefault("pending_saves", {}).pop(key, None)
        atomic(logs / "result.json", {"exit_code": child.returncode, "result": result})
        self.record("BANK_RETURNED", label=label, exit_code=child.returncode,
                    saved=sum(key in self.state["banks"] for _, _, key in selected), selected=len(selected))
        if interrupted is not None:
            raise interrupted
        need(all(key in self.state["banks"] for _, _, key in selected),
             "Source input saving needs continuation at " + str(logs))


    def adopt_retained_input(self, key, url, relative, maximum, slot):
        selected = self.retained_inputs.get(key)
        if selected is None:
            return None
        need(selected["requested_url"] == url, "Retained file belongs to another original public source")
        source = Path(selected["path"])
        need(source.is_absolute() and not source.is_symlink() and source.is_file(),
             "Select the complete original retained regular file")
        original = identity(source)
        need(original["bytes"] == selected["bytes"] and original["bytes"] <= maximum,
             "Retained original byte count differs")
        if selected.get("sha256"):
            need(original["sha256"] == selected["sha256"], "Retained original hash differs")
        target = self.root / relative
        if target.exists():
            need(not target.is_symlink() and target.is_file() and identity(target) == original,
                 "The existing received source differs from the selected original")
        else:
            temporary = target.with_name(target.name + ".retained-" + uuid.uuid4().hex)
            digest = hashlib.sha256()
            count = 0
            with source.open("rb") as incoming, temporary.open("xb") as out:
                os.chmod(temporary, 0o600)
                for block in iter(lambda: incoming.read(BLOCK), b""):
                    need(shutil.disk_usage(target.parent).free > MIN_FREE, "Owned source receiving storage is full")
                    out.write(block)
                    digest.update(block)
                    count += len(block)
                out.flush()
                os.fsync(out.fileno())
            need(count == original["bytes"] and digest.hexdigest() == original["sha256"]
                 and identity(source) == original, "Retained input changed during complete receiving")
            os.replace(temporary, target)
        receipt_path = relative + ".retained.json"
        receipt = {"schema": "commons.bdnb-retained-source.v1", "operation_id": OPERATION,
                   "key": key, "requested_url": url, "path": relative, **original,
                   "received_at": now(), "received_from": str(source),
                   "provenance": selected["provenance"],
                   "verification": "Whole source byte count and SHA-256, complete received copy"}
        atomic(self.root / receipt_path, receipt)
        slot.update({"state": "COMPLETE", "identity": original, "receipt": receipt_path,
                     "retained_original": receipt})
        self.record("RETAINED_ORIGINAL_RECEIVED", key=key, path=relative, **original)
        self.bank([target, self.root / receipt_path], key)
        return slot

    def download(self, key, url, relative, maximum=None):
        public_url(url)
        maximum = self.maximum if maximum is None else maximum
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        slot = self.state["downloads"].setdefault(key, {"requested_url": url,
              "path": relative, "attempts": [], "state": "PREPARED"})
        need(slot["requested_url"] == url and slot["path"] == relative, "Original HTTP input changed")
        if slot["state"] == "COMPLETE":
            need(target.is_file() and identity(target) == slot["identity"], "Retained original file changed")
            self.bank([target, self.root / slot["receipt"]], key)
            return slot
        adopted = self.adopt_retained_input(key, url, relative, maximum, slot)
        if adopted is not None:
            return adopted
        part = target.with_name(target.name + ".partial")
        saved = slot.get("partial", {})
        offset = part.stat().st_size if part.exists() else 0
        validator = saved.get("etag") if (saved.get("etag") or "").startswith('"') else saved.get("last_modified")
        prefix_identity = saved.get("prefix_identity")
        if offset and (not validator or not prefix_identity or identity(part) != prefix_identity):
            old = part.with_name(part.name + "." + uuid.uuid4().hex + ".prior")
            os.replace(part, old)
            self.record("PREFIX_RETAINED", key=key, path=str(old.relative_to(self.root)),
                        reason="Original prefix or validator requires a retained full restart")
            offset = 0
        headers = {"User-Agent": "TJLabs-BDNB-original-acquisition/1.0",
                   "Accept": "*/*", "Accept-Encoding": "identity"}
        if offset:
            headers.update({"Range": "bytes=" + str(offset) + "-", "If-Range": validator})
        attempt = {"started_at": now(), "requested_url": url, "range_start": offset}
        slot["attempts"].append(attempt)
        self.record("HTTP_STARTED", key=key, url=url, offset=offset)
        try:
            with self.opener.open(urllib.request.Request(url, headers=headers), timeout=60) as response:
                public_url(response.url)
                response_headers = {k: v for k, v in response.headers.items()}
                status = response.status
                attempt.update({"status": status, "final_url": response.url, "headers": response_headers})
                need(response.headers.get("Content-Encoding", "identity").lower() == "identity",
                     "Unexpected compressed HTTP transfer representation")
                content_length = response.headers.get("Content-Length")
                response_bytes = int(content_length) if content_length is not None else None
                if offset and status == 206:
                    content_range = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)",
                                                 response.headers.get("Content-Range", ""))
                    need(content_range is not None and int(content_range[1]) == offset,
                         "Range response did not continue the original prefix")
                    total = int(content_range[3])
                    need(int(content_range[2]) == total - 1, "Unexpected partial range response")
                    need(response.url == saved.get("final_url"), "Range response moved to another source")
                    if saved.get("etag"):
                        need(response.headers.get("ETag") == saved["etag"], "Range ETag changed")
                    elif saved.get("last_modified"):
                        need(response.headers.get("Last-Modified") == saved["last_modified"],
                             "Range Last-Modified changed")
                    mode = "ab"
                elif status == 200:
                    total = response_bytes
                    if offset:
                        old = part.with_name(part.name + "." + uuid.uuid4().hex + ".prior")
                        os.replace(part, old)
                        self.record("PREFIX_RETAINED", key=key, path=str(old.relative_to(self.root)),
                                    reason="Publisher returned a complete representation")
                    offset = 0
                    if part.exists() and part.stat().st_size == 0:
                        part.unlink()
                    mode = "xb"
                else:
                    raise ValueError("Unexpected full-source HTTP status " + str(status))
                need(total is None or total <= maximum, "Whole source exceeds selected file capacity")
                need(shutil.disk_usage(target.parent).free >= MIN_FREE,
                     "Insufficient owned storage before download")
                prefix_hash = hashlib.sha256()
                if offset:
                    with part.open("rb") as prior:
                        for block in iter(lambda: prior.read(BLOCK), b""):
                            prefix_hash.update(block)
                slot["partial"] = {"final_url": response.url, "etag": response.headers.get("ETag"),
                    "last_modified": response.headers.get("Last-Modified"), "expected_bytes": total,
                    "prefix_identity": {"bytes": offset, "sha256": prefix_hash.hexdigest()}}
                slot["state"] = "RECEIVING"
                atomic(self.state_path, self.state)
                received = 0
                tick = time.monotonic()
                with part.open(mode) as out:
                    os.chmod(part, 0o600)
                    while True:
                        block = response.read(BLOCK)
                        if not block:
                            break
                        need(offset + received + len(block) <= maximum, "Whole source exceeds file capacity")
                        need(shutil.disk_usage(target.parent).free > MIN_FREE, "Owned storage is full")
                        out.write(block)
                        prefix_hash.update(block)
                        received += len(block)
                        if time.monotonic() - tick >= 15:
                            out.flush()
                            os.fsync(out.fileno())
                            slot["partial"]["prefix_identity"] = {"bytes": offset + received, "sha256": prefix_hash.hexdigest()}
                            self.record("HTTP_PROGRESS", key=key, bytes=offset + received, expected_bytes=total)
                            tick = time.monotonic()
                    out.flush()
                    os.fsync(out.fileno())
                need(response_bytes is None or received == response_bytes, "Incomplete HTTP response")
                need(total is None or part.stat().st_size == total, "Incomplete whole original file")
                item = identity(part)
                os.replace(part, target)
                attempt.update({"completed_at": now(), "received_bytes": received})
                receipt_path = relative + ".http.json"
                receipt = {"schema": "commons.bdnb-source-http.v1", "operation_id": OPERATION,
                    "requested_url": url, "path": relative, **item,
                    "completed_at": now(), "attempts": slot["attempts"]}
                atomic(self.root / receipt_path, receipt)
                slot.update({"state": "COMPLETE", "identity": item, "receipt": receipt_path})
                self.record("HTTP_COMPLETE", key=key, path=relative, **item)
                self.bank([target, self.root / receipt_path], key)
                return slot
        except BaseException as error:
            attempt["error"] = {"type": type(error).__name__, "message": str(error), "at": now()}
            if isinstance(error, urllib.error.HTTPError):
                attempt["error"].update({"status": error.code,
                    "retry_after": error.headers.get("Retry-After")})
            if part.exists():
                slot["partial_bytes"] = part.stat().st_size
                if slot.get("partial"):
                    slot["partial"]["prefix_identity"] = identity(part)
            self.record("HTTP_INTERRUPTED", key=key, error=attempt["error"],
                        partial_bytes=slot.get("partial_bytes", 0))
            raise

    def page_selection(self, edition):
        key = edition["directory"] + "-catalogue"
        page = self.download(key, edition["page"], edition["directory"] + "/catalogue.html", MAX_METADATA)
        parser = Links()
        parser.feed((self.root / page["path"]).read_text(encoding="utf-8"))
        found = [i for i, link in enumerate(parser.links)
                 if link["text"].strip() == "dep_59_csv"]
        need(len(found) == 1, "Select exactly the publisher's Nord59 CSV archive link")
        i = found[0]
        archive = urllib.parse.urljoin(edition["page"], parser.links[i]["href"])
        need(i + 1 < len(parser.links) and "métadonn" in parser.links[i + 1]["text"].lower()
             or i + 1 < len(parser.links) and "metadonn" in parser.links[i + 1]["text"].lower(),
             "Publisher's Nord59 CSV metadata link is missing")
        metadata = urllib.parse.urljoin(edition["page"], parser.links[i + 1]["href"])
        dictionary = ("https://open-data.s3.fr-par.scw.cloud/bdnb_millesime_" + edition["directory"] +
                      "/millesime_" + edition["directory"] + "_doc/documentation.xlsx")
        selected = {**edition, "archive_url": public_url(archive),
                    "metadata_url": public_url(metadata), "dictionary_url": public_url(dictionary),
                    "dictionary_locator": "Version-specific original URL; validate workbook contents before importer selection"}
        path = self.root / edition["directory"] / "selection.json"
        if path.exists():
            need(read_json(path) == selected, "Original catalogue selection changed")
        else:
            atomic(path, selected)
        return selected

    def workbook(self, path, directory):
        destination = directory / "dictionary-members.json"
        members = []
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                safe_member(info.filename)
                need(not stat.S_ISLNK(info.external_attr >> 16), "Workbook member is a symlink")
                if info.is_dir():
                    continue
                members.append({"path": info.filename, "bytes": info.file_size,
                                "compressed_bytes": info.compress_size, "crc32": format(info.CRC, "08x")})
            need("[Content_Types].xml" in archive.namelist() and "xl/workbook.xml" in archive.namelist(),
                 "The version-specific dictionary is not an XLSX workbook")
            for name in ("xl/workbook.xml", "docProps/core.xml", "docProps/app.xml"):
                if name in archive.namelist():
                    raw = archive.read(name)
                    atomic(directory / "dictionary-xml" / name, raw, binary=True)
            shared = []
            if "xl/sharedStrings.xml" in archive.namelist():
                root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
                shared = ["".join(item.itertext()) for item in root.findall("s:si", ns)]
            ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            sheet_rows = []
            for name in archive.namelist():
                if not re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
                    continue
                rows = []
                xml = ET.fromstring(archive.read(name))
                for row in xml.findall("s:sheetData/s:row", ns):
                    cells = []
                    for cell in row.findall("s:c", ns):
                        value = cell.findtext("s:v", default="", namespaces=ns)
                        kind = cell.get("t")
                        if kind == "s":
                            value = shared[int(value)]
                        elif kind == "inlineStr":
                            element = cell.find("s:is", ns)
                            value = "".join(element.itertext()) if element is not None else ""
                        cells.append({"reference": cell.get("r"), "type": kind,
                                      "value": value, "formula": cell.findtext("s:f", namespaces=ns)})
                    rows.append({"row": row.get("r"), "cells": cells})
                sheet_rows.append({"member": name, "rows": rows})
        atomic(destination, {"original": {"path": str(path.relative_to(self.root)), **identity(path)},
                            "members": members, "worksheets": sheet_rows,
                            "meaning": "Complete retained cell values for dictionary review; formulas are preserved, not evaluated."})
        self.bank([destination], directory.name + "-dictionary-index")
        return str(destination.relative_to(self.root))

    def inventory(self, path, directory):
        manifest = directory / "archive-members.json"
        if manifest.exists():
            previous = read_json(manifest)
            need(previous["archive"]["sha256"] == identity(path)["sha256"], "Original archive changed")
            for table in previous["selected_tables"]:
                received_table = self.root / table["path"]
                profile = directory / (table["table"] + ".profile.json")
                need(identity(received_table) == {"bytes": table["bytes"], "sha256": table["sha256"]},
                     "Extracted original CSV changed")
                need(read_json(profile) == table, "Retained original table profile changed")
                self.bank([received_table, profile], directory.name + "-" + table["table"])
            self.bank([manifest], directory.name + "-archive-index")
            return previous
        entries, selected = [], []
        target = directory / "tables"
        target.mkdir(mode=0o700, exist_ok=True)
        seen = set()

        def consume(name, size, stream_factory, attributes):
            safe_member(name)
            need(name not in seen, "Duplicate archive member " + name)
            seen.add(name)
            entries.append({"path": name, "bytes": size, **attributes})
            stem = PurePosixPath(name).name
            if not stem.lower().endswith(".csv"):
                return
            table = stem[:-4]
            if table not in TABLES:
                return
            need(not any(row["table"] == table for row in selected), "Ambiguous complete table " + table)
            output = target / (table + ".csv")
            temporary = output.with_suffix(".csv.receiving")
            if temporary.exists():
                temporary.rename(temporary.with_name(temporary.name + "." + uuid.uuid4().hex + ".prior"))
            if output.exists():
                need(output.is_file() and not output.is_symlink() and output.stat().st_size == size,
                     "Existing extracted file cannot be adopted")
                existing = identity(output)
                incoming = hashlib.sha256()
                count = 0
                with stream_factory() as source:
                    for block in iter(lambda: source.read(BLOCK), b""):
                        count += len(block)
                        incoming.update(block)
                need(count == existing["bytes"] and incoming.hexdigest() == existing["sha256"],
                     "Existing extraction differs from exact archive member")
            else:
                with stream_factory() as source, temporary.open("xb") as out:
                    os.chmod(temporary, 0o600)
                    count = 0
                    for block in iter(lambda: source.read(BLOCK), b""):
                        need(shutil.disk_usage(target).free > MIN_FREE, "Owned extraction storage is full")
                        out.write(block)
                        count += len(block)
                    out.flush()
                    os.fsync(out.fileno())
                need(count == size, "Incomplete original archive member")
                os.replace(temporary, output)
            profile = csv_profile(output)
            selected.append({"table": table, "path": str(output.relative_to(self.root)),
                             "archive_member": name, **identity(output), "observed_csv": profile})
            atomic(directory / (table + ".profile.json"), selected[-1])
            self.bank([output, directory / (table + ".profile.json")], directory.name + "-" + table)

        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                for info in archive.infolist():
                    safe_member(info.filename)
                    need(not stat.S_ISLNK(info.external_attr >> 16), "Archive symlink is not selected")
                    if info.is_dir():
                        entries.append({"path": info.filename, "directory": True})
                    else:
                        consume(info.filename, info.file_size, lambda item=info: archive.open(item),
                                {"compressed_bytes": info.compress_size, "crc32": format(info.CRC, "08x")})
        elif tarfile.is_tarfile(path):
            with tarfile.open(path, "r:*") as archive:
                for member in archive:
                    safe_member(member.name)
                    if member.isdir():
                        entries.append({"path": member.name, "directory": True})
                    elif member.isfile():
                        consume(member.name, member.size, lambda item=member: archive.extractfile(item), {})
                    else:
                        raise ValueError("Unsupported non-regular archive member " + member.name)
        else:
            raise ValueError("Publisher archive needs its actual format adapter; original bytes retained at " + str(path))
        need(any(row["table"] == "batiment_groupe" for row in selected), "Complete original building-group CSV absent")
        result = {"schema": "commons.bdnb-source-archive.v1", "operation_id": OPERATION,
                  "archive": {"path": str(path.relative_to(self.root)), **identity(path)},
                  "members": entries, "selected_tables": selected,
                  "absent_core_tables": [name for name in TABLES if not any(x["table"] == name for x in selected)],
                  "other_members": "Preserved unchanged inside the whole original archive"}
        atomic(manifest, result)
        self.bank([manifest], directory.name + "-archive-index")
        return result

    def publisher_archive_assertion(self, path, selected):
        fields = {}
        expected = {"sha256", "real_size", "zip_size", "s3_link", "s3_link_metadata"}
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            key, separator, value = line.partition(":")
            key, value = key.strip(), value.strip()
            need(separator and key in expected and key not in fields,
                 "Original publisher archive metadata fields changed")
            fields[key] = value
        need(set(fields) == expected, "Original publisher archive metadata is incomplete")
        need(re.fullmatch(r"[0-9a-fA-F]{64}", fields["sha256"]),
             "Original archive SHA-256 assertion is invalid")
        need(re.fullmatch(r"[1-9][0-9]*", fields["zip_size"]),
             "Original archive byte assertion is invalid")
        need(fields["real_size"] == "null" or re.fullmatch(r"[0-9]+", fields["real_size"]),
             "Original expanded-size metadata changed")
        need(fields["s3_link"] == selected["archive_url"] and
             fields["s3_link_metadata"] == selected["metadata_url"],
             "Publisher metadata belongs to another selected archive")
        return {"bytes": int(fields["zip_size"]), "sha256": fields["sha256"].lower(),
                "archive_url": fields["s3_link"], "metadata_url": fields["s3_link_metadata"],
                "declared_real_size": None if fields["real_size"] == "null" else int(fields["real_size"])}

    def run(self):
        dataset = self.download("publisher-dataset-metadata",
            "https://www.data.gouv.fr/api/1/datasets/base-de-donnees-nationale-des-batiments/",
            "publisher-dataset.json", MAX_METADATA)
        metadata_body = read_json(self.root / dataset["path"])
        need(isinstance(metadata_body, dict) and isinstance(metadata_body.get("resources"), list),
             "Original data.gouv dataset response is incomplete")
        results = []
        for edition in EDITIONS:
            chosen = self.page_selection(edition)
            directory = self.root / edition["directory"]
            metadata = self.download(edition["directory"] + "-metadata", chosen["metadata_url"],
                                     edition["directory"] + "/archive-metadata", MAX_METADATA)
            publisher_assertion = self.publisher_archive_assertion(self.root / metadata["path"], chosen)
            workbook = self.download(edition["directory"] + "-dictionary", chosen["dictionary_url"],
                                     edition["directory"] + "/documentation.xlsx", MAX_METADATA)
            matching = [r for r in metadata_body["resources"] if r.get("url") == chosen["dictionary_url"]]
            for resource in matching:
                expected = resource.get("filesize")
                if isinstance(expected, int) and expected > 0:
                    need(workbook["identity"]["bytes"] == expected, "Publisher dictionary byte assertion changed")
                checksum = resource.get("checksum") or {}
                if checksum.get("type") == "sha256" and checksum.get("value"):
                    need(workbook["identity"]["sha256"] == checksum["value"].lower(),
                         "Publisher dictionary checksum assertion changed")
            dictionary_index = self.workbook(self.root / workbook["path"], directory)
            archive = self.download(edition["directory"] + "-archive", chosen["archive_url"],
                                    edition["directory"] + "/publisher-archive",
                                    min(self.maximum, publisher_assertion["bytes"]))
            need(archive["identity"] == {"bytes": publisher_assertion["bytes"], "sha256": publisher_assertion["sha256"]},
                 "Complete archive differs from its original publisher metadata")
            self.record("PUBLISHER_ARCHIVE_MATCHED", edition=edition["directory"], **publisher_assertion)
            inventory = self.inventory(self.root / archive["path"], directory)
            result = {"selected": chosen, "metadata": metadata, "dictionary": workbook,
                      "dictionary_index": dictionary_index, "archive": archive, "inventory": inventory,
                      "publisher_archive_assertion": publisher_assertion}
            atomic(directory / "edition-received.json", result)
            self.bank([directory / "selection.json", directory / "edition-received.json"], edition["directory"] + "-edition")
            results.append(result)
        complete = {"schema": "commons.bdnb-nord-sources-complete.v1", "operation_id": OPERATION,
                    "department": "59", "completed_at": now(), "root": str(self.root),
                    "delivery_mode": self.delivery_mode,
                    "editions": results, "publisher_metadata": dataset, "license": metadata_body.get("license"),
                    "saved_files": list(self.state["banks"].values()),
                    "import_contract": "Original Analysis bdnb.import; selected dictionary/null/geometry semantics remain explicit.",
                    "state": "COMPLETE_SOURCE_RECEIVING"}
        atomic(self.root / "complete.json", complete)
        self.bank([self.root / "complete.json"], "complete-source")
        self.record("COMPLETE_SOURCE_RECEIVING", manifest=str(self.root / "complete.json"),
                    identity=identity(self.root / "complete.json"))
        return complete

def safe_member(name):
    need(isinstance(name, str) and name and "\x00" not in name and "\\" not in name,
         "Invalid archive member name")
    path = PurePosixPath(name)
    need(not path.is_absolute() and ".." not in path.parts and not re.match(r"^[A-Za-z]:", name),
         "Unsafe archive member path")
    return path

def csv_profile(path):
    # Parsing observations never silently declare a null meaning or modify a cell.
    with Path(path).open("r", encoding="utf-8-sig", errors="strict", newline="") as source:
        sample = source.read(128 * 1024)
    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    csv.field_size_limit(16 * BLOCK)
    rows = 0
    blanks, literal_nulls, shapes = {}, {}, {}
    with Path(path).open("r", encoding="utf-8-sig", errors="strict", newline="") as source:
        reader = csv.reader(source, dialect=dialect, strict=True)
        header = next(reader)
        need(header and len(header) == len(set(header)) and all(header), "Invalid actual CSV header")
        blanks = dict.fromkeys(header, 0)
        literal_nulls = {key: {} for key in header}
        for row in reader:
            rows += 1
            need(len(row) == len(header), "CSV width differs at original record " + str(rows))
            for key, value in zip(header, row):
                blanks[key] += value == ""
                if value in ("NULL", "null", "NA", "N/A", r"\N"):
                    count = literal_nulls[key]
                    count[value] = count.get(value, 0) + 1
                if key in ("geom_groupe", "geom", "geom_adresse") and value:
                    label = ("wkt" if re.match(r"^(SRID=\d+;)?[A-Z]+(?:\s+Z|\s+M)?\s*\(", value)
                             else "ewkb-hex" if re.fullmatch(r"(?:\\x)?[0-9a-fA-F]+", value)
                             else "json-text" if value.startswith(("{", "[")) else "other-text")
                    shapes[label] = shapes.get(label, 0) + 1
    return {"encoding": "utf-8-sig", "delimiter": dialect.delimiter, "quotechar": dialect.quotechar,
            "doublequote": dialect.doublequote, "escapechar": dialect.escapechar,
            "header": header, "row_count": rows, "blank_cells": blanks,
            "literal_null_tokens": literal_nulls, "geometry_text_shapes": shapes,
            "null_interpretation": "Unselected: publisher dictionary determines null semantics; all original text is retained."}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--library-helper",
                        help="Actual current unmodified Library upload helper in this native runtime")
    parser.add_argument("--delivery-mode", choices=("library", "native"), default="library",
                        help="Default hosted preservation, or whole persistent files returned by the existing native owner")
    parser.add_argument("--retained-inputs", type=Path,
                        help="Complete original files already acquired for this same source operation")
    parser.add_argument("--max-archive-bytes", type=int, default=64 * 1024**3)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = root / "acquisition.lock"
    with lock.open("a+b") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        runner = Acquisition(root, args.library_helper, args.max_archive_bytes,
                             args.retained_inputs, args.delivery_mode)
        source = Path(__file__).resolve()
        retained_source = root / "acquire_nord.py"
        source_bytes = source.read_bytes()
        previous_source = None
        if retained_source != source and retained_source.exists() and retained_source.read_bytes() != source_bytes:
            previous_source = identity(retained_source)
            need(previous_source in (
                 {"bytes": 39190, "sha256": "e18162e23ed7b3e173c78be3f1a1e6041a4c3cd3d2412bc0e0027b5848779adc"},
                 {"bytes": 48606, "sha256": "613fc130f655a24fe4c73d750595afccff6f4fc0f9b217d305b680a33235e95b"}),
                 "Resume from an exact authorized acquisition predecessor")
            historical = root / "source-history" / previous_source["sha256"] / "acquire_nord.py"
            if historical.exists():
                need(identity(historical) == previous_source, "The retained predecessor changed")
            else:
                atomic(historical, retained_source.read_bytes(), binary=True)
            for saved in runner.state["banks"].values():
                if saved.get("status") == "retained_local" and saved.get("path") == "acquire_nord.py" and saved.get("sha256") == previous_source["sha256"]:
                    saved["retained_path"] = str(historical.relative_to(root))
            runner.state["source_successor"] = {"state": "PREPARED", "previous": previous_source,
                "previous_path": str(historical.relative_to(root)),
                "current": {"bytes": len(source_bytes), "sha256": hashlib.sha256(source_bytes).hexdigest()}}
            runner.record("SOURCE_SUCCESSOR_PREPARED", **runner.state["source_successor"])
            atomic(retained_source, source_bytes, binary=True)
            runner.state["source_successor"]["state"] = "COMPLETE"
            runner.record("SOURCE_SUCCESSOR_RECEIVED", **runner.state["source_successor"])
        elif retained_source != source and not retained_source.exists():
            atomic(retained_source, source_bytes, binary=True)
        pending_successor = runner.state.get("source_successor")
        if pending_successor and pending_successor["state"] == "PREPARED":
            need(identity(retained_source) == pending_successor["current"],
                 "Reconcile the original prepared source receiving")
            runner.state["source_successor"]["state"] = "COMPLETE"
            runner.record("SOURCE_SUCCESSOR_RECEIVED", **runner.state["source_successor"])
        def interrupted(signum, _frame):
            # The first signal enters the normal complete-preservation path.
            # Suppress later signals only while that same path drains its helper.
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            raise InterruptedError("Original acquisition interrupted by signal " + str(signum))
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        try:
            runner.bank([retained_source], "source")
            runner.run()
        except BaseException as error:
            runner.record("INTERRUPTED", error={"type": type(error).__name__, "message": str(error)})
            selected = [runner.state_path] + sorted(root.glob("*/selection.json"))
            partials = [path for path in root.glob("*/*.partial") if path.is_file()]
            try:
                runner.bank(selected + partials, "interrupted")
            except BaseException as saving_error:
                print(json.dumps({"event": "INTERRUPTED_SAVE_ERROR", "root": str(root),
                                  "message": str(saving_error)}), flush=True)
            raise

if __name__ == "__main__":
    main()
